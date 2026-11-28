import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { annotateCacheAnomalies } from '../lib/dashboard.mjs';
import { createQuotaTracker } from '../lib/quota.mjs';
import { createSettingsStore } from '../lib/settings.mjs';
import { discoverKnownSshHosts } from '../lib/ssh-remote.mjs';
import {
  buildPeerSnapshot,
  createUsageSyncCoordinator,
  ensureDeviceIdentity,
  preparePeerRequests,
  readPeerSnapshots,
  SYNC_FORMAT,
  SYNC_SCHEMA_VERSION,
  writePeerSnapshot
} from '../lib/usage-sync.mjs';
import { runSyncCli } from '../scripts/sync.mjs';

function seedConversationDb(baseDir, convId, { requestId, model, inTok, cacheTok, outTok, sec, error = '', retryError = '' }) {
  const varint = value => {
    const bytes = [];
    let n = BigInt(value);
    do {
      let b = Number(n & 127n);
      n >>= 7n;
      if (n) b |= 128;
      bytes.push(b);
    } while (n);
    return Buffer.from(bytes);
  };
  const integer = (n, value) => Buffer.concat([varint(n * 8), varint(value)]);
  const bytesField = (n, value) => {
    const buf = Buffer.from(value);
    return Buffer.concat([varint(n * 8 + 2), varint(buf.length), buf]);
  };
  const concat = (...parts) => Buffer.concat(parts);

  const convDir = join(baseDir, 'conversations');
  mkdirSync(convDir, { recursive: true });
  const db = new DatabaseSync(join(convDir, `${convId}.db`));
  try {
    db.exec('CREATE TABLE IF NOT EXISTS gen_metadata(idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE IF NOT EXISTS steps(idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB);');
    const reqMeta = concat(bytesField(1, 'request_id'), bytesField(2, requestId));
    const retryMeta = retryError ? bytesField(17, bytesField(3, retryError)) : Buffer.alloc(0);
    const chat = concat(
      bytesField(4, concat(integer(2, inTok), integer(3, outTok), integer(5, cacheTok))),
      bytesField(11, integer(1, 1)),
      bytesField(12, integer(1, 2)),
      retryMeta,
      bytesField(20, reqMeta),
      bytesField(21, model)
    );
    const gen = concat(bytesField(1, chat), integer(2, 1), bytesField(4, convId), ...(error ? [bytesField(5, error)] : []));
    db.prepare('INSERT OR REPLACE INTO gen_metadata(idx, data) VALUES (0, ?)').run(gen);
    const stepMeta = concat(bytesField(1, integer(1, sec)), bytesField(8, integer(1, sec + 3)));
    db.prepare('INSERT OR REPLACE INTO steps(idx, step_type, metadata) VALUES (1, 2, ?)').run(stepMeta);
  } finally {
    db.close();
  }
}

test('ensureDeviceIdentity persists stable UUID and resolves name precedence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-sync-id-'));
  try {
    const first = ensureDeviceIdentity(dir, { env: {}, hostnameFn: () => 'HOST-A' });
    const second = ensureDeviceIdentity(dir, { env: { AGY_POWERTOOLS_DEVICE_NAME: 'ENV-NAME' }, hostnameFn: () => 'HOST-B' });
    const third = ensureDeviceIdentity(dir, { deviceName: 'Custom-PC', env: { AGY_POWERTOOLS_DEVICE_NAME: 'ENV-NAME' }, hostnameFn: () => 'HOST-B' });

    assert.equal(first.deviceId, second.deviceId);
    assert.equal(second.deviceId, third.deviceId);
    assert.equal(first.deviceName, 'HOST-A');
    assert.equal(second.deviceName, 'ENV-NAME');
    assert.equal(third.deviceName, 'Custom-PC');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('multi-machine sync merges 3 machines sharing one accountEmail, deduplicates by id, and avoids no-op rewrites', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-sync-3pc-'));
  try {
    const sharedSyncDir = join(root, 'shared-nas-sync');
    const pc1AppDir = join(root, 'pc1', '.gemini', 'antigravity');
    const pc1DataDir = join(pc1AppDir, 'plugin_data', 'agy-powertools');
    const pc2DataDir = join(root, 'pc2', 'plugin_data');
    mkdirSync(sharedSyncDir, { recursive: true });
    mkdirSync(pc1DataDir, { recursive: true });
    mkdirSync(pc2DataDir, { recursive: true });

    const daySec = Math.floor(Date.now() / 1000) - 120;
    const nowMs = Date.now();

    // Machine 1 (PC-Perso): Desktop + CLI SQLite DBs
    seedConversationDb(pc1AppDir, 'pc1-conv-1', {
      requestId: 'req-pc1-desktop',
      model: 'Gemini 4 Carbon (High)',
      inTok: 1000,
      cacheTok: 2000,
      outTok: 300,
      sec: daySec
    });
    seedConversationDb(join(root, 'pc1', '.gemini', 'antigravity-cli'), 'pc1-cli-1', {
      requestId: 'req-pc1-cli',
      model: 'Gemini 4 Flash',
      inTok: 400,
      cacheTok: 600,
      outTok: 100,
      sec: daySec + 10
    });

    // Machine 2 (PC-Boulot): writes its peer snapshot into sharedSyncDir, including one duplicate requestId
    const pc2Identity = ensureDeviceIdentity(pc2DataDir, { deviceName: 'PC-Boulot', env: {} });
    const pc2Requests = preparePeerRequests([
      {
        id: 'req-pc2-work',
        conversationId: 'conv-work-1',
        timestampMs: nowMs - 30000,
        model: 'Gemini 4 Carbon (High)',
        inputTokens: 2000,
        cacheReadTokens: 3000,
        outputTokens: 500,
        status: 'success',
        error: '',
        retryErrors: [],
        accountEmail: 'user@example.com'
      },
      {
        id: 'req-pc1-desktop',
        conversationId: 'pc1-conv-1',
        timestampMs: daySec * 1000,
        model: 'Gemini 4 Carbon (High)',
        inputTokens: 9999,
        cacheReadTokens: 0,
        outputTokens: 0,
        status: 'success',
        error: '',
        retryErrors: [],
        accountEmail: 'user@example.com'
      }
    ], {
      deviceId: pc2Identity.deviceId,
      deviceName: 'PC-Boulot',
      now: nowMs
    });
    const pc2Snapshot = buildPeerSnapshot({
      deviceId: pc2Identity.deviceId,
      deviceName: 'PC-Boulot',
      requests: pc2Requests,
      now: nowMs
    });
    const write1 = writePeerSnapshot(sharedSyncDir, `device-${pc2Identity.deviceId}.json`, pc2Snapshot);
    assert.equal(write1.written, true);
    const mtime1 = statSync(write1.path).mtimeMs;
    const write2 = writePeerSnapshot(sharedSyncDir, `device-${pc2Identity.deviceId}.json`, { ...pc2Snapshot, updatedAtMs: nowMs + 5000 });
    assert.equal(write2.written, false);
    assert.equal(statSync(write1.path).mtimeMs, mtime1);

    // Machine 3 (NAS headless): collected via mocked SSH bridge
    const quota = createQuotaTracker(pc1DataDir);
    quota.recordAccount('user@example.com', daySec * 1000 - 60000, { knownAccountCount: 1 });
    const settings = createSettingsStore(pc1DataDir);
    settings.set({
      syncEnabled: true,
      syncDir: sharedSyncDir,
      syncDeviceName: 'PC-Perso',
      syncSshHosts: 'nas'
    });

    const remoteBridge = {
      async dashboard(host) {
        assert.equal(host, 'nas');
        return {
          requests: [
            {
              id: 'req-nas-1',
              conversationId: 'nas-conv-1',
              timestampMs: nowMs - 15000,
              model: 'Gemini 4 Neon (High)',
              inputTokens: 500,
              cacheReadTokens: 1500,
              outputTokens: 250,
              status: 'error',
              error: 'NAS timeout',
              retryErrors: []
            }
          ]
        };
      }
    };

    const coordinator = createUsageSyncCoordinator({
      dataDir: pc1DataDir,
      appDataDirGetter: () => pc1AppDir,
      settingsGetter: () => settings.get(),
      quotaTracker: quota,
      remoteBridge,
      env: {}
    });

    const syncRes = await coordinator.syncNow({ activeEmail: 'user@example.com', forceSsh: true, forceDashboard: true });
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.sshCollected.length, 1);

    const merged = coordinator.mergedDashboard({ force: true, activeEmail: 'user@example.com', multiAccount: false, knownAccountCount: 1 });
    assert.equal(merged.totalRequests, 4);
    assert.equal(merged.devices.length, 3);
    assert.deepEqual(merged.devices.map(d => d.deviceName).sort(), ['nas', 'PC-Boulot', 'PC-Perso'].sort());

    // Local wins on duplicate request id ('req-pc1-desktop')
    const dupRow = merged.requests.find(r => r.id === 'req-pc1-desktop');
    assert.equal(dupRow.inputTokens, 1000);
    assert.equal(dupRow.isRemotePeer, false);

    // Every request across all 3 devices keeps accountEmail 'user@example.com'
    for (const r of merged.requests) {
      assert.equal(r.accountEmail, 'user@example.com');
    }
    assert.equal(merged.totalErrors, 1);
    assert.equal(merged.errors[0].error, 'NAS timeout');

    // Local snapshot file was exported to sharedSyncDir without overwriting again when unchanged
    const pc1Id = coordinator.identity().deviceId;
    const localSnapshotPath = join(sharedSyncDir, `device-${pc1Id}.json`);
    const exportedPayload = JSON.parse(readFileSync(localSnapshotPath, 'utf8'));
    assert.equal(exportedPayload.format, SYNC_FORMAT);
    assert.equal(exportedPayload.schemaVersion, SYNC_SCHEMA_VERSION);
    assert.equal(exportedPayload.deviceName, 'PC-Perso');
    assert.equal(exportedPayload.requests.length, 2);

    const localMtime = statSync(localSnapshotPath).mtimeMs;
    coordinator.mergedDashboard({ force: false, activeEmail: 'user@example.com' });
    assert.equal(statSync(localSnapshotPath).mtimeMs, localMtime);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('privacy mode strips error messages, clears retryErrors, and hashes conversationId', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-sync-priv-'));
  try {
    const now = Date.now();
    const prepared = preparePeerRequests([
      {
        id: 'req-err-1',
        conversationId: 'secret-company-conv-uuid',
        timestampMs: now - 1000,
        model: 'Gemini 4 Carbon (High)',
        inputTokens: 100,
        cacheReadTokens: 0,
        outputTokens: 20,
        status: 'error',
        error: 'Secret internal path C:\\work\\secret',
        retryErrors: ['Sensitive retry detail']
      }
    ], {
      deviceId: 'dev-priv-1234',
      deviceName: 'Work-PC',
      fallbackEmail: 'user@example.com',
      privacyMode: true,
      now
    });

    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].status, 'error');
    assert.equal(prepared[0].error, '');
    assert.deepEqual(prepared[0].retryErrors, []);
    assert.match(prepared[0].conversationId, /^anon-[0-9a-f]{16}$/);
    assert.equal(prepared[0].conversationId.includes('secret-company'), false);

    const snapshot = buildPeerSnapshot({
      deviceId: 'dev-priv-1234',
      deviceName: 'Work-PC',
      privacyMode: true,
      requests: prepared,
      now
    });
    writePeerSnapshot(dir, 'device-dev-priv-1234.json', snapshot);
    const read = readPeerSnapshots([dir], { now });
    assert.equal(read.peers.length, 1);
    assert.equal(read.peers[0].privacyMode, true);
    assert.equal(read.requests[0].error, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('annotateCacheAnomalies isolates requests by deviceId so parallel machines do not trigger false drops', () => {
  const baseMs = Date.now() - 60000;
  const crossMachine = [
    {
      id: 'm1-req-1',
      deviceId: 'pc-perso',
      conversationId: 'same-conv-id',
      model: 'Gemini 4 Carbon (High)',
      timestampMs: baseMs,
      inputTokens: 1000,
      cacheReadTokens: 19000,
      outputTokens: 100,
      status: 'success'
    },
    {
      id: 'm2-req-1',
      deviceId: 'pc-boulot',
      conversationId: 'same-conv-id',
      model: 'Gemini 4 Carbon (High)',
      timestampMs: baseMs + 10000,
      inputTokens: 18000,
      cacheReadTokens: 0,
      outputTokens: 100,
      status: 'success'
    }
  ];
  assert.equal(annotateCacheAnomalies(crossMachine).size, 0);

  const sameMachine = [
    crossMachine[0],
    { ...crossMachine[1], id: 'm1-req-2', deviceId: 'pc-perso' }
  ];
  const detected = annotateCacheAnomalies(sameMachine);
  assert.equal(detected.size, 1);
  assert.equal(detected.get('m1-req-2')?.kind, 'cleared');
});

test('scripts/sync.mjs CLI supports init, set-dir, add-ssh, remove-ssh, sync, and status --json without middle dots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-sync-cli-'));
  try {
    const fakeHome = join(root, 'home');
    const syncDir = join(root, 'sync-target');
    const appDataDir = join(fakeHome, '.gemini', 'antigravity');
    mkdirSync(appDataDir, { recursive: true });
    seedConversationDb(appDataDir, 'cli-test-conv', {
      requestId: 'req-cli-host',
      model: 'Gemini 4 Carbon (High)',
      inTok: 800,
      cacheTok: 1200,
      outTok: 200,
      sec: Math.floor(Date.now() / 1000) - 60
    });

    const initRes = await runSyncCli(['init', '--home', fakeHome, '--name', 'Home-PC', '--privacy', 'on', '--json'], { env: {} });
    assert.equal(initRes.payload.ok, true);
    assert.equal(initRes.payload.status.deviceName, 'Home-PC');
    assert.equal(initRes.payload.status.privacyMode, true);

    const setDirRes = await runSyncCli(['set-dir', syncDir, '--home', fakeHome, '--email', 'user@example.com', '--json'], { env: {} });
    assert.equal(setDirRes.payload.ok, true);
    assert.equal(setDirRes.payload.status.enabled, true);
    assert.equal(setDirRes.payload.localRequestCount, 1);

    const addSshRes = await runSyncCli(['add-ssh', 'nas-tailscale', '--home', fakeHome, '--json'], { env: {} }).catch(err => ({ error: err }));
    // Remote SSH won't connect in test, or reports ok:false; either way host is saved in settings
    assert.ok(addSshRes);
    const statusAfterAdd = await runSyncCli(['status', '--home', fakeHome, '--json'], { env: {} });
    assert.deepEqual(statusAfterAdd.payload.status.sshHosts, ['nas-tailscale']);

    const remSshRes = await runSyncCli(['remove-ssh', 'nas-tailscale', '--home', fakeHome, '--json'], { env: {} });
    assert.deepEqual(remSshRes.payload.status.sshHosts, []);

    const syncRes = await runSyncCli(['sync', '--home', fakeHome, '--email', 'user@example.com', '--json'], { env: {} });
    assert.equal(syncRes.payload.ok, true);
    assert.equal(JSON.stringify(syncRes.payload).includes('\u00b7'), false);

    const promptRes = await runSyncCli(['prompt', '--home', fakeHome, '--dir', syncDir, '--ssh', 'nas-tailscale', '--privacy', 'on', '--json'], { env: {} });
    assert.equal(promptRes.payload.ok, true);
    assert.match(promptRes.payload.prompt, /SYNC_AGENT\.md/);
    assert.match(promptRes.payload.prompt, /--ssh "nas-tailscale"/);
    assert.match(promptRes.payload.prompt, /--privacy on/);
    assert.equal(promptRes.payload.prompt.includes('\u00b7'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('discoverKnownSshHosts collects unique valid hosts from ssh_windows.json, app_storage.json, and ~/.ssh/config', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-ssh-discover-'));
  try {
    const userDataDir = join(root, 'Antigravity');
    const home = join(root, 'home');
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(join(home, '.ssh'), { recursive: true });

    writeFileSync(join(userDataDir, 'ssh_windows.json'), JSON.stringify({
      windows: [{ host: 'nas-tailscale' }, { host: '-bad-host' }]
    }));
    writeFileSync(join(userDataDir, 'app_storage.json'), JSON.stringify({
      'ssh.recentConnections': JSON.stringify([{ host: 'work-vps' }, { host: 'nas-tailscale' }])
    }));
    writeFileSync(join(home, '.ssh', 'config'), [
      '# Commented host',
      'Host * !bastion *.internal',
      'Host nas-tailscale media-nas # trailing comment',
      '  User macu',
      'Host db;bad'
    ].join('\n'));

    const discovered = discoverKnownSshHosts({ userDataDir, home });
    assert.deepEqual(discovered, ['nas-tailscale', 'work-vps', 'media-nas']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
