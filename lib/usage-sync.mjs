import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { usageDashboard } from './analytics.mjs';
import { antigravityUserDataDir } from './paths.mjs';
import { discoverKnownSshHosts, validateSshDestination } from './ssh-remote.mjs';

export const SYNC_FORMAT = 'agy-powertools-usage-sync';
export const SYNC_SCHEMA_VERSION = 1;
export const SYNC_RETENTION_MS = 90 * 86400000;
export const SYNC_MAX_REQUESTS = 20000;
export const SYNC_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const SSH_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

const DEVICE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{3,127}$/;
const PEER_FILE_RE = /^(?:device|ssh)-[a-zA-Z0-9._-]+\.json$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;
const WIN_UNC_RE = /^\\\\[^\\/]+[\\/][^\\/]+/;

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function normalizeEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : '';
}

function safeLstat(targetPath) {
  try {
    return lstatSync(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

export function sanitizeDeviceName(raw, fallback = 'local-device') {
  const clean = String(raw || '').replace(CONTROL_CHARS_RE, '').trim().slice(0, 64);
  if (clean) return clean;
  const fb = String(fallback || 'local-device').replace(CONTROL_CHARS_RE, '').trim().slice(0, 64);
  return fb || 'local-device';
}

export function ensureDeviceIdentity(dataDir, { deviceName = '', env = process.env, hostnameFn = hostname } = {}) {
  const resolvedDataDir = resolve(dataDir);
  const filePath = join(resolvedDataDir, 'device.json');
  let record = null;
  try {
    const st = safeLstat(filePath);
    if (st && st.isFile() && !st.isSymbolicLink()) {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      if (parsed && typeof parsed.deviceId === 'string' && DEVICE_ID_RE.test(parsed.deviceId)) {
        record = {
          deviceId: parsed.deviceId,
          createdAtMs: Number.isFinite(parsed.createdAtMs) ? parsed.createdAtMs : Date.now()
        };
      }
    }
  } catch { /* Regenerate device.json when missing or corrupted. */ }

  if (!record) {
    record = { deviceId: randomUUID(), createdAtMs: Date.now() };
    const tempPath = join(resolvedDataDir, `.device-${randomUUID()}.tmp`);
    try {
      mkdirSync(resolvedDataDir, { recursive: true, mode: 0o700 });
      writeFileSync(tempPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      renameSync(tempPath, filePath);
    } catch { /* Non-fatal if profile directory is read-only. */ }
    finally { try { rmSync(tempPath, { force: true }); } catch {} }
  }

  let hostDefault = 'local-device';
  try { hostDefault = sanitizeDeviceName(hostnameFn(), 'local-device'); } catch {}
  const envName = typeof env?.AGY_POWERTOOLS_DEVICE_NAME === 'string' ? env.AGY_POWERTOOLS_DEVICE_NAME : '';
  const defaultDeviceName = sanitizeDeviceName(envName || hostDefault, 'local-device');
  const resolvedName = sanitizeDeviceName(deviceName || defaultDeviceName, defaultDeviceName);

  return {
    deviceId: record.deviceId,
    deviceName: resolvedName,
    defaultDeviceName,
    createdAtMs: record.createdAtMs
  };
}

export function resolveSyncDir(rawSyncDir, { home = homedir(), env = process.env } = {}) {
  const candidate = typeof rawSyncDir === 'string' && rawSyncDir.trim()
    ? rawSyncDir.trim()
    : (typeof env?.AGY_POWERTOOLS_SYNC_DIR === 'string' ? env.AGY_POWERTOOLS_SYNC_DIR.trim() : '');
  if (!candidate) return '';
  let expanded = candidate;
  if (candidate === '~') {
    expanded = home;
  } else if (candidate.startsWith('~/') || candidate.startsWith('~\\')) {
    expanded = join(home, candidate.slice(2));
  }
  if (!isAbsolute(expanded) && !WIN_UNC_RE.test(expanded)) return '';
  return WIN_UNC_RE.test(expanded) ? expanded.replace(/[\\/]+$/, '') || expanded : resolve(expanded);
}

export function parseSyncSshHosts(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const seen = new Set();
  const hosts = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      const valid = validateSshDestination(trimmed);
      if (!seen.has(valid)) {
        seen.add(valid);
        hosts.push(valid);
        if (hosts.length >= 16) break;
      }
    } catch { /* Skip invalid SSH host entry. */ }
  }
  return hosts;
}

export function preparePeerRequests(requests = [], { deviceId, deviceName, emailAt, fallbackEmail = '', privacyMode = false, now = Date.now() } = {}) {
  const cutoff = now - SYNC_RETENTION_MS;
  const fallback = normalizeEmail(fallbackEmail);
  const out = [];
  for (const r of Array.isArray(requests) ? requests : []) {
    if (!r || typeof r.id !== 'string' || !r.id) continue;
    if (!Number.isFinite(r.timestampMs) || r.timestampMs < cutoff) continue;
    const resolvedEmail = normalizeEmail(r.accountEmail)
      || (typeof emailAt === 'function' ? normalizeEmail(emailAt(r.timestampMs)) : '')
      || fallback;
    const rawConvId = typeof r.conversationId === 'string' ? r.conversationId : '';
    const conversationId = privacyMode
      ? (rawConvId ? `anon-${sha256Hex(`conv:${rawConvId}`).slice(0, 16)}` : '')
      : rawConvId;
    out.push({
      id: r.id,
      conversationId,
      stepIndex: Number.isInteger(r.stepIndex) ? r.stepIndex : null,
      timestampMs: r.timestampMs,
      model: typeof r.model === 'string' ? r.model : '',
      role: typeof r.role === 'string' ? r.role : '',
      inputTokens: Number.isFinite(r.inputTokens) ? r.inputTokens : 0,
      cacheReadTokens: Number.isFinite(r.cacheReadTokens) ? r.cacheReadTokens : 0,
      outputTokens: Number.isFinite(r.outputTokens) ? r.outputTokens : 0,
      cacheHitPercent: Number.isFinite(r.cacheHitPercent) ? r.cacheHitPercent : null,
      thinkingTokens: Number.isFinite(r.thinkingTokens) ? r.thinkingTokens : 0,
      responseTokens: Number.isFinite(r.responseTokens) ? r.responseTokens : 0,
      ttftMs: Number.isFinite(r.ttftMs) ? r.ttftMs : null,
      streamingMs: Number.isFinite(r.streamingMs) ? r.streamingMs : null,
      durationMs: Number.isFinite(r.durationMs) ? r.durationMs : null,
      tpsDurationMs: Number.isFinite(r.tpsDurationMs) ? r.tpsDurationMs : null,
      tps: Number.isFinite(r.tps) ? r.tps : null,
      wholeTps: Number.isFinite(r.wholeTps) ? r.wholeTps : null,
      tpsMode: typeof r.tpsMode === 'string' ? r.tpsMode : null,
      error: privacyMode ? '' : (typeof r.error === 'string' ? r.error : ''),
      status: typeof r.status === 'string' ? r.status : 'recorded',
      retries: Number.isFinite(r.retries) ? r.retries : 0,
      retryErrors: privacyMode ? [] : (Array.isArray(r.retryErrors) ? r.retryErrors.filter(e => typeof e === 'string') : []),
      accountEmail: resolvedEmail,
      deviceId,
      deviceName
    });
  }
  return out.sort((a, b) => b.timestampMs - a.timestampMs).slice(0, SYNC_MAX_REQUESTS);
}

export function buildPeerSnapshot({ deviceId, deviceName, kind = 'device', privacyMode = false, requests = [], now = Date.now() }) {
  const cleanRequests = Array.isArray(requests) ? requests : [];
  const contentSig = sha256Hex(JSON.stringify({
    format: SYNC_FORMAT,
    schemaVersion: SYNC_SCHEMA_VERSION,
    kind,
    deviceId,
    deviceName,
    privacyMode: Boolean(privacyMode),
    requests: cleanRequests
  }));
  return {
    format: SYNC_FORMAT,
    schemaVersion: SYNC_SCHEMA_VERSION,
    kind,
    deviceId,
    deviceName,
    privacyMode: Boolean(privacyMode),
    updatedAtMs: now,
    contentSig,
    requests: cleanRequests
  };
}

export function writePeerSnapshot(targetDir, fileName, snapshot) {
  if (!targetDir || !PEER_FILE_RE.test(fileName)) throw new Error('Invalid sync snapshot path');
  mkdirSync(targetDir, { recursive: true });
  const dirStat = safeLstat(targetDir);
  if (!dirStat || !dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    throw new Error('Sync target directory cannot be a symbolic link');
  }
  const filePath = join(targetDir, fileName);
  const existingStat = safeLstat(filePath);
  if (existingStat) {
    if (existingStat.isSymbolicLink() || !existingStat.isFile()) {
      throw new Error('Sync snapshot target is not a regular file');
    }
    try {
      const existing = JSON.parse(readFileSync(filePath, 'utf8'));
      if (existing?.contentSig && existing.contentSig === snapshot.contentSig) {
        return { written: false, path: filePath, contentSig: snapshot.contentSig };
      }
    } catch { /* Overwrite unreadable or outdated snapshot. */ }
  }

  const serialized = JSON.stringify(snapshot);
  const tempPath = join(targetDir, `.${fileName}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, serialized, { flag: 'wx', mode: 0o600 });
    try {
      renameSync(tempPath, filePath);
    } catch (error) {
      if (!['EPERM', 'EXDEV', 'EACCES'].includes(error?.code)) throw error;
      if (safeLstat(filePath)?.isSymbolicLink()) throw new Error('Sync snapshot target cannot be a symbolic link');
      writeFileSync(filePath, serialized, { mode: 0o600 });
    }
    return { written: true, path: filePath, contentSig: snapshot.contentSig };
  } finally {
    try { rmSync(tempPath, { force: true }); } catch {}
  }
}

export function readPeerSnapshots(dirs = [], { excludeDeviceIds = new Set(), now = Date.now() } = {}) {
  const cutoff = now - SYNC_RETENTION_MS;
  const seenDirs = new Set();
  const byDevice = new Map();

  for (const rawDir of Array.isArray(dirs) ? dirs : []) {
    if (typeof rawDir !== 'string' || !rawDir.trim()) continue;
    const dir = WIN_UNC_RE.test(rawDir.trim()) ? rawDir.trim().replace(/[\\/]+$/, '') : resolve(rawDir.trim());
    const dirKey = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seenDirs.has(dirKey)) continue;
    seenDirs.add(dirKey);

    let entries;
    try {
      const dirStat = safeLstat(dir);
      if (!dirStat || !dirStat.isDirectory() || dirStat.isSymbolicLink()) continue;
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const fileName of entries) {
      if (!PEER_FILE_RE.test(fileName)) continue;
      const filePath = join(dir, fileName);
      try {
        const st = safeLstat(filePath);
        if (!st || !st.isFile() || st.isSymbolicLink() || st.size <= 0 || st.size > SYNC_MAX_FILE_BYTES) continue;
        const payload = JSON.parse(readFileSync(filePath, 'utf8'));
        if (
          payload?.format !== SYNC_FORMAT ||
          payload?.schemaVersion !== SYNC_SCHEMA_VERSION ||
          typeof payload.deviceId !== 'string' ||
          !DEVICE_ID_RE.test(payload.deviceId) ||
          !Array.isArray(payload.requests)
        ) {
          continue;
        }
        if (excludeDeviceIds.has(payload.deviceId)) continue;
        const updatedAtMs = Number.isFinite(payload.updatedAtMs) ? payload.updatedAtMs : st.mtimeMs;
        const existing = byDevice.get(payload.deviceId);
        if (existing && existing.updatedAtMs >= updatedAtMs) continue;

        const peerName = sanitizeDeviceName(payload.deviceName, payload.deviceId);
        const peerKind = payload.kind === 'ssh' ? 'ssh' : 'device';
        const validRequests = [];
        for (const r of payload.requests) {
          if (!r || typeof r.id !== 'string' || !r.id || !Number.isFinite(r.timestampMs) || r.timestampMs < cutoff) continue;
          validRequests.push({
            ...r,
            accountEmail: normalizeEmail(r.accountEmail),
            deviceId: payload.deviceId,
            deviceName: peerName,
            isRemotePeer: true
          });
        }
        byDevice.set(payload.deviceId, {
          deviceId: payload.deviceId,
          deviceName: peerName,
          kind: peerKind,
          isLocal: false,
          privacyMode: Boolean(payload.privacyMode),
          updatedAtMs,
          requestCount: validRequests.length,
          requests: validRequests
        });
      } catch { /* Ignore unreadable or malformed peer snapshot files. */ }
    }
  }

  const peers = [];
  const requests = [];
  const sortedPeers = [...byDevice.values()].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0) || a.deviceName.localeCompare(b.deviceName));
  for (const peer of sortedPeers) {
    peers.push({
      deviceId: peer.deviceId,
      deviceName: peer.deviceName,
      kind: peer.kind,
      isLocal: false,
      privacyMode: peer.privacyMode,
      updatedAtMs: peer.updatedAtMs,
      requestCount: peer.requestCount
    });
    requests.push(...peer.requests);
  }
  return { peers, requests };
}

function summarizeDaysAndErrors(requests) {
  const days = new Map();
  for (const r of requests) {
    if (!r.timestampMs) continue;
    const date = new Date(r.timestampMs);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!days.has(key)) days.set(key, { date: key, requests: 0, tokens: 0 });
    const day = days.get(key);
    day.requests++;
    day.tokens += (r.inputTokens || 0) + (r.cacheReadTokens || 0) + (r.outputTokens || 0);
  }
  const errors = requests.flatMap(r => [
    ...(r.error ? [r] : []),
    ...(Array.isArray(r.retryErrors) ? r.retryErrors : [])
      .filter(error => error && String(error).trim() && error !== r.error)
      .map((error, index) => ({ ...r, id: `${r.id}:retry:${index}`, status: 'error', error }))
  ]);
  return { days: [...days.values()], errors };
}

export function sshPeerDeviceId(host) {
  return `ssh-${sha256Hex(`ssh:${host}`).slice(0, 12)}`;
}

export function buildAgentSyncPrompt({ syncDir = '', sshHosts = [], privacyMode = false } = {}) {
  const cleanDir = typeof syncDir === 'string' ? syncDir.trim() : '';
  const cleanHosts = Array.isArray(sshHosts)
    ? sshHosts.map(h => String(h || '').trim()).filter(Boolean)
    : parseSyncSshHosts(String(sshHosts || ''));
  const parts = [
    'Configure Agy Powertools multi-device usage sync on this machine.',
    'First read ~/.gemini/config/plugins/agy-powertools/docs/SYNC_AGENT.md (or docs/SYNC_AGENT.md in the repo).',
    'Then run ~/.gemini/config/plugins/agy-powertools/scripts/sync.mjs init --enable'
  ];
  if (cleanDir) parts.push(`--dir "${cleanDir}"`);
  if (cleanHosts.length) parts.push(`--ssh "${cleanHosts.join(', ')}"`);
  if (privacyMode) parts.push('--privacy on');
  parts.push('using local Node.js (>= 22.13) or Antigravity agy-node.');
  if (!cleanDir) parts.push('Ask me for the shared sync folder path (OneDrive, Syncthing, or NAS SMB share) if needed.');
  parts.push('Keep all other plugins, accounts, and chats intact, verify with sync.mjs status --json, and show me the detected devices.');
  return parts.join(' ');
}

export function createUsageSyncCoordinator({
  dataDir,
  appDataDirGetter,
  settingsGetter,
  quotaTracker,
  remoteBridge,
  env = process.env,
  hostnameFn = hostname,
  home = homedir(),
  userDataDir = antigravityUserDataDir({ env, home }),
  discoverSshHosts = discoverKnownSshHosts
} = {}) {
  const resolvedDataDir = resolve(dataDir);
  const localPeersDir = join(resolvedDataDir, 'sync-peers');
  let lastSyncedAtMs = 0;
  let lastSshSyncAtMs = 0;
  let lastError = '';
  let sshSyncPromise = null;

  const currentContext = () => {
    const curSettings = typeof settingsGetter === 'function' ? (settingsGetter() || {}) : {};
    const identity = ensureDeviceIdentity(resolvedDataDir, {
      deviceName: curSettings.syncDeviceName || '',
      env,
      hostnameFn
    });
    const resolvedSyncDir = resolveSyncDir(curSettings.syncDir || '', { env });
    const sshHosts = parseSyncSshHosts(curSettings.syncSshHosts || '');
    return {
      curSettings,
      identity,
      resolvedSyncDir,
      sshHosts,
      enabled: Boolean(curSettings.syncEnabled),
      privacyMode: Boolean(curSettings.syncPrivacyMode)
    };
  };

  const exportLocalSnapshot = ({ localRequests, ctx, fallbackEmail = '', now = Date.now() }) => {
    if (!ctx.resolvedSyncDir) return { written: false, skipped: true };
    const prepared = preparePeerRequests(localRequests, {
      deviceId: ctx.identity.deviceId,
      deviceName: ctx.identity.deviceName,
      emailAt: ts => quotaTracker?.emailAt?.(ts) || '',
      fallbackEmail,
      privacyMode: ctx.privacyMode,
      now
    });
    const snapshot = buildPeerSnapshot({
      deviceId: ctx.identity.deviceId,
      deviceName: ctx.identity.deviceName,
      kind: 'device',
      privacyMode: ctx.privacyMode,
      requests: prepared,
      now
    });
    return writePeerSnapshot(ctx.resolvedSyncDir, `device-${ctx.identity.deviceId}.json`, snapshot);
  };

  const collectSshPeers = async ({ ctx, activeEmail = '', forceDashboard = true } = {}) => {
    if (!ctx.sshHosts.length || !remoteBridge || typeof remoteBridge.dashboard !== 'function') return [];
    if (sshSyncPromise) return sshSyncPromise;
    sshSyncPromise = (async () => {
      const collected = [];
      const errors = [];
      for (const host of ctx.sshHosts) {
        try {
          const remoteDash = await remoteBridge.dashboard(host, { force: forceDashboard });
          const deviceId = sshPeerDeviceId(host);
          const deviceName = sanitizeDeviceName(host, deviceId);
          const now = Date.now();
          const prepared = preparePeerRequests(remoteDash?.requests || [], {
            deviceId,
            deviceName,
            emailAt: ts => quotaTracker?.emailAt?.(ts) || '',
            fallbackEmail: activeEmail,
            privacyMode: ctx.privacyMode,
            now
          });
          const snapshot = buildPeerSnapshot({
            deviceId,
            deviceName,
            kind: 'ssh',
            privacyMode: ctx.privacyMode,
            requests: prepared,
            now
          });
          const fileName = `${deviceId}.json`;
          writePeerSnapshot(localPeersDir, fileName, snapshot);
          if (ctx.resolvedSyncDir) {
            writePeerSnapshot(ctx.resolvedSyncDir, fileName, snapshot);
          }
          collected.push({ host, deviceId, deviceName, requestCount: prepared.length });
        } catch (err) {
          errors.push(`${host}: ${err?.message || String(err)}`);
        }
      }
      lastSshSyncAtMs = Date.now();
      if (errors.length) lastError = errors.join('; ');
      else if (collected.length) lastError = '';
      return collected;
    })();
    try {
      return await sshSyncPromise;
    } finally {
      sshSyncPromise = null;
    }
  };

  const buildStatus = (ctx, peerResult) => {
    let discoveredSshHosts = [];
    try {
      discoveredSshHosts = discoverSshHosts({ userDataDir, home });
    } catch { /* Non-fatal if SSH discovery metadata is unavailable. */ }
    return {
      enabled: ctx.enabled,
      deviceId: ctx.identity.deviceId,
      deviceName: ctx.identity.deviceName,
      defaultDeviceName: ctx.identity.defaultDeviceName,
      syncDir: ctx.curSettings.syncDir || '',
      resolvedSyncDir: ctx.resolvedSyncDir,
      sshHosts: ctx.sshHosts,
      discoveredSshHosts,
      privacyMode: ctx.privacyMode,
      agentPrompt: buildAgentSyncPrompt({
        syncDir: ctx.curSettings.syncDir || '',
        sshHosts: ctx.sshHosts,
        privacyMode: ctx.privacyMode
      }),
      peers: peerResult ? peerResult.peers : [],
      lastSyncedAtMs,
      lastError,
      sshSyncing: Boolean(sshSyncPromise)
    };
  };

  return {
    identity() {
      return currentContext().identity;
    },

    status() {
      const ctx = currentContext();
      const peerResult = readPeerSnapshots(
        [ctx.resolvedSyncDir, localPeersDir],
        { excludeDeviceIds: new Set([ctx.identity.deviceId]) }
      );
      return buildStatus(ctx, peerResult);
    },

    async syncNow({ activeEmail = '', forceSsh = true, forceDashboard = true, fallbackEmail = '' } = {}) {
      const ctx = currentContext();
      const appDataDir = typeof appDataDirGetter === 'function' ? appDataDirGetter() : '';
      const local = appDataDir ? usageDashboard(appDataDir, { force: forceDashboard }) : { requests: [] };
      const now = Date.now();
      let exported = null;
      const syncErrors = [];
      try {
        exported = exportLocalSnapshot({
          localRequests: local.requests,
          ctx,
          fallbackEmail: fallbackEmail || activeEmail,
          now
        });
      } catch (err) {
        syncErrors.push(err?.message || String(err));
      }
      let sshCollected = [];
      if (forceSsh && ctx.sshHosts.length > 0) {
        sshCollected = await collectSshPeers({ ctx, activeEmail: fallbackEmail || activeEmail, forceDashboard });
        if (lastError) syncErrors.push(lastError);
      }
      lastSyncedAtMs = Date.now();
      lastError = syncErrors.join('; ');
      const peerResult = readPeerSnapshots(
        [ctx.resolvedSyncDir, localPeersDir],
        { excludeDeviceIds: new Set([ctx.identity.deviceId]), now: lastSyncedAtMs }
      );
      return {
        ok: syncErrors.length === 0,
        exported,
        sshCollected,
        localRequestCount: local.requests.length,
        status: buildStatus(ctx, peerResult)
      };
    },

    mergedDashboard({ force = false, activeEmail = '', multiAccount = false, knownAccountCount = 0 } = {}) {
      const ctx = currentContext();
      const appDataDir = typeof appDataDirGetter === 'function' ? appDataDirGetter() : '';
      const local = usageDashboard(appDataDir, { force });
      const now = Date.now();
      const annotatedLocal = local.requests.map(r => ({
        ...r,
        accountEmail: normalizeEmail(r.accountEmail) || normalizeEmail(quotaTracker?.emailAt?.(r.timestampMs)),
        deviceId: ctx.identity.deviceId,
        deviceName: ctx.identity.deviceName,
        isRemotePeer: false
      }));

      const localDevice = {
        deviceId: ctx.identity.deviceId,
        deviceName: ctx.identity.deviceName,
        kind: 'local',
        isLocal: true,
        requestCount: annotatedLocal.length,
        updatedAtMs: now
      };

      if (!ctx.enabled) {
        return {
          ...local,
          requests: annotatedLocal,
          localDevice: { deviceId: ctx.identity.deviceId, deviceName: ctx.identity.deviceName },
          devices: [localDevice],
          syncStatus: buildStatus(ctx, { peers: [] })
        };
      }

      try {
        exportLocalSnapshot({ localRequests: annotatedLocal, ctx, fallbackEmail: '', now });
        if (ctx.resolvedSyncDir) lastError = '';
      } catch (err) {
        lastError = err?.message || String(err);
      }

      if (ctx.sshHosts.length > 0 && now - lastSshSyncAtMs >= SSH_SYNC_COOLDOWN_MS && !sshSyncPromise) {
        void collectSshPeers({ ctx, activeEmail, forceDashboard: true }).catch(() => {});
      }

      const peerResult = readPeerSnapshots(
        [ctx.resolvedSyncDir, localPeersDir],
        { excludeDeviceIds: new Set([ctx.identity.deviceId]), now }
      );
      lastSyncedAtMs = now;

      const byId = new Map();
      for (const r of annotatedLocal) {
        byId.set(r.id, r);
      }
      for (const r of peerResult.requests) {
        if (byId.has(r.id)) continue;
        let email = normalizeEmail(r.accountEmail);
        if (!email && !multiAccount && knownAccountCount <= 1) {
          email = normalizeEmail(quotaTracker?.emailAt?.(r.timestampMs)) || normalizeEmail(activeEmail);
        }
        byId.set(r.id, { ...r, accountEmail: email });
      }

      const requests = [...byId.values()].sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
      const { days, errors } = summarizeDaysAndErrors(requests);

      return {
        requests,
        totalRequests: requests.length,
        errors,
        totalErrors: errors.length,
        days,
        updatedAtMs: now,
        localDevice: { deviceId: ctx.identity.deviceId, deviceName: ctx.identity.deviceName },
        devices: [localDevice, ...peerResult.peers],
        syncStatus: buildStatus(ctx, peerResult)
      };
    }
  };
}
