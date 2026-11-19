import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  injectDebugArg,
  removeDebugArg,
  patchDesktopEntry,
  unpatchDesktopEntry,
  configureLaunchers,
  restoreLaunchers,
  resolveAntigravityExecutable,
  shouldPromptPostUpdate,
  scheduleRelaunchWithDebugPort
} from '../lib/launcher.mjs';
import { startSidecarWebUi, renderAuxPaneHtml } from '../lib/sidecar-ui.mjs';

test('injectDebugArg and removeDebugArg preserve user arguments and avoid duplicates', () => {
  assert.equal(injectDebugArg(''), '--remote-debugging-port=0');
  assert.equal(injectDebugArg('--wsl-distro=Ubuntu'), '--wsl-distro=Ubuntu --remote-debugging-port=0');
  assert.equal(injectDebugArg('--remote-debugging-port=9222'), '--remote-debugging-port=9222');
  assert.equal(removeDebugArg('--remote-debugging-port=0'), '');
  assert.equal(removeDebugArg('--wsl-distro=Ubuntu --remote-debugging-port=0 --flag'), '--wsl-distro=Ubuntu --flag');
  assert.equal(removeDebugArg('--remote-debugging-port=9222'), '--remote-debugging-port=9222');
});

test('Linux desktop launcher override patches and restores cleanly in sandbox', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-launcher-linux-'));
  try {
    const home = join(root, 'home'), dataDir = join(root, 'data'), sysApps = join(root, 'sys-apps');
    mkdirSync(sysApps, { recursive: true });
    writeFileSync(join(sysApps, 'antigravity.desktop'), '[Desktop Entry]\nName=Antigravity\nExec=/opt/Antigravity/antigravity %U\nType=Application\n');
    const created = configureLaunchers({ home, dataDir, platform: 'linux', sandbox: true, systemApplicationsDir: sysApps });
    const userFile = join(home, '.local', 'share', 'applications', 'antigravity.desktop');
    assert.equal(created.updated.length, 1);
    assert.match(readFileSync(userFile, 'utf8'), /Exec=\/opt\/Antigravity\/antigravity --remote-debugging-port=0 %U/);

    const restored = restoreLaunchers({ home, dataDir, platform: 'linux', sandbox: true });
    assert.equal(restored.restored.length, 1);
    assert.equal(existsSync(userFile), false);

    mkdirSync(join(home, '.local', 'share', 'applications'), { recursive: true });
    writeFileSync(userFile, '[Desktop Entry]\nExec="/opt/Antigravity App/antigravity" --ozone-platform=wayland %U\n');
    configureLaunchers({ home, dataDir, platform: 'linux', sandbox: true });
    assert.match(readFileSync(userFile, 'utf8'), /Exec="\/opt\/Antigravity App\/antigravity" --remote-debugging-port=0 --ozone-platform=wayland %U/);
    restoreLaunchers({ home, dataDir, platform: 'linux', sandbox: true });
    assert.equal(readFileSync(userFile, 'utf8'), '[Desktop Entry]\nExec="/opt/Antigravity App/antigravity" --ozone-platform=wayland %U\n');
    assert.equal(patchDesktopEntry('[Desktop Entry]\nExec=/usr/bin/firefox %u\n').changed, false);
    assert.equal(unpatchDesktopEntry('[Desktop Entry]\nExec=/usr/bin/firefox %u\n').changed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('macOS launcher app is created in ~/Applications and removed on restore', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-launcher-mac-'));
  try {
    const home = join(root, 'home'), dataDir = join(root, 'data');
    const res = configureLaunchers({ home, dataDir, platform: 'darwin', sandbox: true });
    const appDir = join(home, 'Applications', 'Antigravity (Powertools).app');
    assert.equal(res.updated[0], appDir);
    assert.ok(readFileSync(join(appDir, 'Contents', 'MacOS', 'launcher'), 'utf8').includes('--remote-debugging-port=0'));
    restoreLaunchers({ home, dataDir, platform: 'darwin', sandbox: true });
    assert.equal(existsSync(appDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows .lnk shortcuts targeting Antigravity.exe are updated and restored without touching unrelated shortcuts', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-launcher-win-'));
  try {
    const home = join(root, 'home'), dataDir = join(root, 'data');
    const desktop = join(home, 'Desktop');
    mkdirSync(desktop, { recursive: true });
    const fakeAgy = join(root, 'Antigravity.exe'), fakeOther = join(root, 'Other.exe');
    writeFileSync(fakeAgy, ''); writeFileSync(fakeOther, '');
    const agyLnk = join(desktop, 'Antigravity.lnk'), otherLnk = join(desktop, 'Other.lnk');
    spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$ws = New-Object -ComObject WScript.Shell; $s1 = $ws.CreateShortcut($env:L1); $s1.TargetPath = $env:T1; $s1.Arguments = '--wsl-distro=Ubuntu'; $s1.Save(); $s2 = $ws.CreateShortcut($env:L2); $s2.TargetPath = $env:T2; $s2.Save()`
    ], { env: { ...process.env, L1: agyLnk, T1: fakeAgy, L2: otherLnk, T2: fakeOther }, windowsHide: true });

    const configured = configureLaunchers({ home, dataDir, platform: 'win32', sandbox: true });
    assert.deepEqual(configured.updated, [agyLnk]);
    const readArgs = lnk => spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject WScript.Shell).CreateShortcut($env:L).Arguments`
    ], { env: { ...process.env, L: lnk }, encoding: 'utf8', windowsHide: true }).stdout.trim();
    assert.equal(readArgs(agyLnk), '--wsl-distro=Ubuntu --remote-debugging-port=0');
    assert.equal(readArgs(otherLnk), '');

    const second = configureLaunchers({ home, dataDir, platform: 'win32', sandbox: true });
    assert.deepEqual(second.updated, []);

    const restored = restoreLaunchers({ home, dataDir, platform: 'win32', sandbox: true });
    assert.deepEqual(restored.restored, [agyLnk]);
    assert.equal(readArgs(agyLnk), '--wsl-distro=Ubuntu');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('executable discovery, post-update prompt guards, and relaunch scheduling prevent loops', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-'));
  try {
    const appRoot = join(root, 'Programs', 'antigravity');
    const binDir = join(appRoot, 'resources', 'bin');
    mkdirSync(binDir, { recursive: true });
    const exe = join(appRoot, 'Antigravity.exe'), lsExe = join(binDir, 'language_server.exe');
    writeFileSync(exe, ''); writeFileSync(lsExe, '');
    assert.equal(resolveAntigravityExecutable({ platform: 'win32', env: { ANTIGRAVITY_AGENTAPI_EXE: lsExe }, home: root }), exe);

    const installDir = join(root, 'installed'), dataDir = join(root, 'data');
    mkdirSync(installDir, { recursive: true }); mkdirSync(dataDir, { recursive: true });
    const receipt = join(installDir, '.agy-install.json');
    writeFileSync(receipt, '{}');
    const now = Date.now();
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: {}, now }).reason, 'non-interactive');
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000', ELECTRON_OZONE_PLATFORM_HINT: 'headless' }, now }).reason, 'non-interactive');
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000' }, now }).reason, 'fresh-install');

    const oldDate = new Date(now - 5 * 60 * 1000);
    utimesSync(receipt, oldDate, oldDate);
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000' }, now }).prompt, true);

    const spawned = [];
    const res = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { ANTIGRAVITY_AGENTAPI_EXE: lsExe, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000', ELECTRON_RUN_AS_NODE: '1' },
      spawnProcess(cmd, args, opts) { spawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(res.scheduled, true);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].opts.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(spawned[0].opts.env.AGY_RELAUNCH_TARGET, exe);
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000' }, now: now + 1000 }).prompt, false);
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:6000' }, now: now + 1000 }).reason, 'cooldown');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('macOS relaunch script waits for ancestor Antigravity process without pgrep -f and passes debug port', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-mac-'));
  try {
    const appBundle = join(root, 'Antigravity.app');
    const binDir = join(appBundle, 'Contents', 'Resources', 'bin');
    mkdirSync(binDir, { recursive: true });
    const lsExe = join(binDir, 'language_server');
    writeFileSync(lsExe, '');

    const spawned = [];
    const res = scheduleRelaunchWithDebugPort({
      dataDir: join(root, 'data'),
      home: root,
      platform: 'darwin',
      env: { ANTIGRAVITY_AGENTAPI_EXE: lsExe, ELECTRON_RUN_AS_NODE: '1' },
      spawnProcess(cmd, args, opts) { spawned.push({ cmd, args, opts }); return { unref() {} }; }
    });

    assert.equal(res.scheduled, true);
    assert.equal(res.target, appBundle);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].cmd, 'sh');
    assert.equal(spawned[0].args[0], '-c');
    assert.equal(spawned[0].opts.detached, true);
    assert.equal(spawned[0].opts.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(spawned[0].opts.env.AGY_RELAUNCH_TARGET, appBundle);

    const script = spawned[0].args[1];
    assert.ok(script.includes("trap '' HUP TERM"));
    assert.ok(script.includes('/bin/ps -axo args='));
    assert.ok(!script.includes('pgrep -f'));
    assert.ok(script.includes('/usr/bin/open -n -a "$target" --args --remote-debugging-port=0 >/dev/null 2>&1'));
    assert.ok(!script.includes('--remote-debugging-port=0 >/dev/null 2>&1 &'));

    if (process.platform !== 'win32') {
      const check = spawnSync('sh', ['-n', '-c', script], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Sidecar Aux Pane Web UI serves post-update prompt copy, enforces token auth, and triggers relaunch', async () => {
  const freePort = await new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
  let relaunched = 0;
  const close = await startSidecarWebUi({
    port: freePort,
    token: 'secret-token',
    version: '2.12.5',
    getStatus: async () => ({ healthy: false, enabled: true, language: 'zh-CN' }),
    onRelaunch: async () => { relaunched++; return { scheduled: true }; }
  });
  try {
    const html = renderAuxPaneHtml({ version: '2.12.5', language: 'zh-CN' });
    assert.ok(html.includes('检测到 Antigravity 已升级，请重启以重新启用 Powertools 插件'));

    const unauth = await fetch(`http://127.0.0.1:${freePort}/api/status`);
    assert.equal(unauth.status, 401);

    const statusRes = await fetch(`http://127.0.0.1:${freePort}/api/status?token=secret-token`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.healthy, false);
    assert.equal(statusJson.version, '2.12.5');

    const badPost = await fetch(`http://127.0.0.1:${freePort}/api/relaunch`, { method: 'POST' });
    assert.equal(badPost.status, 401);
    assert.equal(relaunched, 0);

    const okPost = await fetch(`http://127.0.0.1:${freePort}/api/relaunch`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token' }
    });
    assert.equal(okPost.status, 200);
    assert.equal(relaunched, 1);
  } finally {
    await close();
  }
});
