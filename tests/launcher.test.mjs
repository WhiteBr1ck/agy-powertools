import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import {
  injectDebugArg,
  removeDebugArg,
  patchDesktopEntry,
  unpatchDesktopEntry,
  configureLaunchers,
  restoreLaunchers,
  resolveAntigravityExecutable,
  manualLaunchCommand,
  shouldPromptPostUpdate,
  shouldAutoRelaunchMac,
  maybeAutoRelaunchMac,
  recordDebugPortReady,
  scheduleRelaunchWithDebugPort,
  isRemoteSshEnvironment,
  resolveLocalFilePath,
  resolveVerifiedLocalFilePath,
  isWindowsRunnableFile,
  openLocalFile,
  copyLocalFile,
  readLocalFileForAttach,
  parseFileUriAnchor,
  discoverOpenWithApps,
  openFileWithApp
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
    assert.equal(created.macApp, undefined);
    assert.equal(created.iconConfigured, undefined);
    assert.equal(existsSync(join(home, 'Applications', 'Antigravity (Powertools).app')), false);
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

test('macOS removes legacy duplicate launcher app, auto-relaunches with circuit breaker, and respects opt-out', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-launcher-mac-'));
  try {
    const home = join(root, 'home'), dataDir = join(root, 'data');
    const legacyApp = join(home, 'Applications', 'Antigravity (Powertools).app');
    mkdirSync(join(legacyApp, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(legacyApp, 'Contents', 'MacOS', 'launcher'), '#!/bin/sh\n', 'utf8');

    // configureLaunchers on macOS no longer creates a duplicate .app and cleans up legacy ones
    const res = configureLaunchers({ home, dataDir, platform: 'darwin', sandbox: true });
    assert.deepEqual(res.updated, []);
    assert.deepEqual(res.removedLegacyMacApps, [legacyApp]);
    assert.equal(existsSync(legacyApp), false);

    // Second run stays clean without creating any wrapper app
    const res2 = configureLaunchers({ home, dataDir, platform: 'darwin', sandbox: true });
    assert.deepEqual(res2.removedLegacyMacApps, []);
    assert.equal(existsSync(legacyApp), false);

    // Auto-relaunch guards: disabled / non-interactive / same session / cooldown / 2x circuit breaker / reset
    const appBundle = join(root, 'Antigravity.app');
    const lsExe = join(appBundle, 'Contents', 'Resources', 'bin', 'language_server');
    mkdirSync(join(appBundle, 'Contents', 'Resources', 'bin'), { recursive: true });
    writeFileSync(lsExe, '');

    const now = 1_700_000_000_000;
    const baseEnv = { ANTIGRAVITY_AGENTAPI_EXE: lsExe, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5001' };
    assert.equal(shouldAutoRelaunchMac({ dataDir, platform: 'darwin', env: baseEnv, enabled: true, macAutoRelaunch: false, now }).reason, 'disabled');
    assert.equal(shouldAutoRelaunchMac({ dataDir, platform: 'win32', env: baseEnv, enabled: true, macAutoRelaunch: true, now }).reason, 'not-darwin');
    assert.equal(shouldAutoRelaunchMac({ dataDir, platform: 'darwin', env: {}, enabled: true, macAutoRelaunch: true, now }).reason, 'non-interactive');

    let launches = 0;
    const fakeRelaunch = () => { launches++; return { scheduled: true }; };
    const first = maybeAutoRelaunchMac({ dataDir, home, platform: 'darwin', env: baseEnv, enabled: true, macAutoRelaunch: true, now, relaunch: fakeRelaunch });
    assert.equal(first.relaunched, true);
    assert.equal(launches, 1);

    // Same session blocked
    const sameSession = maybeAutoRelaunchMac({ dataDir, home, platform: 'darwin', env: baseEnv, enabled: true, macAutoRelaunch: true, now: now + 5000, relaunch: fakeRelaunch });
    assert.equal(sameSession.relaunched, false);
    assert.equal(sameSession.reason, 'already-attempted-session');

    // New session within 120s cooldown blocked
    const cool = maybeAutoRelaunchMac({ dataDir, home, platform: 'darwin', env: { ...baseEnv, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5002' }, enabled: true, macAutoRelaunch: true, now: now + 30_000, relaunch: fakeRelaunch });
    assert.equal(cool.relaunched, false);
    assert.equal(cool.reason, 'cooldown');

    // Second consecutive attempt after cooldown succeeds, then 3rd trips circuit breaker
    const second = maybeAutoRelaunchMac({ dataDir, home, platform: 'darwin', env: { ...baseEnv, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5002' }, enabled: true, macAutoRelaunch: true, now: now + 130_000, relaunch: fakeRelaunch });
    assert.equal(second.relaunched, true);
    assert.equal(launches, 2);

    const tripped = maybeAutoRelaunchMac({ dataDir, home, platform: 'darwin', env: { ...baseEnv, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5003' }, enabled: true, macAutoRelaunch: true, now: now + 260_000, relaunch: fakeRelaunch });
    assert.equal(tripped.relaunched, false);
    assert.equal(tripped.reason, 'circuit-open');

    // Successful debug port connection resets circuit breaker
    recordDebugPortReady({ dataDir });
    const recovered = maybeAutoRelaunchMac({ dataDir, home, platform: 'darwin', env: { ...baseEnv, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5004' }, enabled: true, macAutoRelaunch: true, now: now + 390_000, relaunch: fakeRelaunch });
    assert.equal(recovered.relaunched, true);
    assert.equal(launches, 3);
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
    assert.equal(resolveAntigravityExecutable({ platform: 'win32', env: { ANTIGRAVITY_AGENTAPI_EXE: lsExe }, home: root, execPath: '' }), exe);
    assert.equal(resolveAntigravityExecutable({ platform: 'win32', env: {}, home: root, execPath: exe }), exe);
    assert.equal(manualLaunchCommand({ platform: 'win32', env: {}, home: root, execPath: exe }), `"${exe}" --remote-debugging-port=0`);

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
    assert.equal(res.launchMethod, 'node-worker');
    assert.ok(res.nonce && res.ackPath && res.jobPath);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].opts.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(spawned[0].opts.env.ANTIGRAVITY_LS_ADDRESS, undefined);
    assert.equal(/powershell/i.test(spawned[0].cmd), false);
    assert.ok(spawned[0].args[0].endsWith('relaunch-worker.mjs'));
    assert.equal(spawned[0].args[1], res.jobPath);
    assert.ok(existsSync(res.jobPath));
    assert.equal(existsSync(join(dataDir, 'relaunch-antigravity.ps1')), false);
    assert.equal(existsSync(join(dataDir, 'relaunch-antigravity.lnk')), false);
    const job = JSON.parse(readFileSync(res.jobPath, 'utf8'));
    assert.equal(job.format, 1);
    assert.equal(job.nonce, res.nonce);
    assert.equal(job.target, exe);
    assert.deepEqual(job.args, ['--remote-debugging-port=0']);
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
    assert.ok(!script.includes('osascript'));
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

test('Linux relaunch script protects against HUP/TERM and matches executable via ps/awk without pgrep -f', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-linux-'));
  try {
    const exe = join(root, 'antigravity');
    writeFileSync(exe, '');
    const spawned = [];
    const res = scheduleRelaunchWithDebugPort({
      dataDir: join(root, 'data'),
      home: root,
      platform: 'linux',
      env: { APPIMAGE: exe, ELECTRON_RUN_AS_NODE: '1' },
      spawnProcess(cmd, args, opts) { spawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(res.scheduled, true);
    assert.equal(res.target, exe);
    const script = spawned[0].args[1];
    assert.ok(script.includes("trap '' HUP TERM"));
    assert.ok(script.includes('ps -eo args='));
    assert.ok(!script.includes('pgrep -f'));
    assert.ok(script.includes('--remote-debugging-port=0'));
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
  let relaunched = 0, checked = 0, installedVer = '', savedMacAuto = true;
  const close = await startSidecarWebUi({
    port: freePort,
    token: 'secret-token',
    version: '2.13.0',
    getStatus: async () => ({
      healthy: false,
      compatibilityError: 'Antigravity compatibility: um (missing)',
      clientVersion: '2.34.0',
      connected: true,
      enabled: true,
      macAutoRelaunch: savedMacAuto,
      language: 'zh-CN'
    }),
    onRelaunch: async () => { relaunched++; return { scheduled: true }; },
    onSetSettings: async patch => { savedMacAuto = Boolean(patch.macAutoRelaunch); return { macAutoRelaunch: savedMacAuto }; },
    onCheckUpdate: async () => { checked++; return { status: 'available', version: '2.13.1', canInstall: true, releaseUrl: 'https://github.com/WhiteBr1ck/agy-powertools/releases/tag/v2.13.1' }; },
    onInstallUpdate: async ({ version }) => { installedVer = version; return { status: 'preparing', version }; },
    onUpdateStatus: async () => ({ status: installedVer ? 'installing' : 'idle', version: installedVer })
  });
  try {
    const html = renderAuxPaneHtml({ version: '2.13.0', language: 'zh-CN' });
    assert.ok(html.includes('需要重启 Antigravity 以启用 Powertools 插件'));
    assert.ok(html.includes('复制启动命令'));
    assert.ok(html.includes('检查插件更新'));
    assert.ok(html.includes('复制诊断信息'));
    assert.ok(html.includes('id="mac-auto-relaunch-row"'));
    assert.ok(html.includes('id="mac-auto-relaunch-toggle"'));
    assert.ok(html.includes("data.platform === 'darwin'"));
    assert.ok(!html.includes('Antigravity (Powertools).app'));
    assert.ok(html.includes('[hidden] { display: none !important; }'));
    assert.equal(html.includes('\u00b7'), false);
    const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
    assert.ok(inlineScript);
    new Function(inlineScript);

    assert.equal((await fetch(`http://127.0.0.1:${freePort}/api/settings`, { method: 'POST', body: '{"macAutoRelaunch":false}' })).status, 401);
    const badSettings = await fetch(`http://127.0.0.1:${freePort}/api/settings`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'Content-Type': 'application/json' },
      body: '{"other":1}'
    });
    assert.equal(badSettings.status, 400);
    const okSettings = await fetch(`http://127.0.0.1:${freePort}/api/settings`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'Content-Type': 'application/json' },
      body: '{"macAutoRelaunch":false}'
    });
    assert.equal(okSettings.status, 200);
    assert.equal(savedMacAuto, false);

    const unauth = await fetch(`http://127.0.0.1:${freePort}/api/status`);
    assert.equal(unauth.status, 401);

    const statusRes = await fetch(`http://127.0.0.1:${freePort}/api/status?token=secret-token`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.healthy, false);
    assert.equal(statusJson.version, '2.13.0');
    assert.equal(statusJson.compatibilityError, 'Antigravity compatibility: um (missing)');
    assert.equal(statusJson.clientVersion, '2.34.0');

    const badPost = await fetch(`http://127.0.0.1:${freePort}/api/relaunch`, { method: 'POST' });
    assert.equal(badPost.status, 401);
    assert.equal(relaunched, 0);

    const okPost = await fetch(`http://127.0.0.1:${freePort}/api/relaunch`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token' }
    });
    assert.equal(okPost.status, 200);
    assert.equal(relaunched, 1);

    assert.equal((await fetch(`http://127.0.0.1:${freePort}/api/update/check`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${freePort}/api/update/install`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${freePort}/api/update/status`)).status, 401);

    const checkRes = await fetch(`http://127.0.0.1:${freePort}/api/update/check`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(checkRes.status, 200);
    assert.equal((await checkRes.json()).version, '2.13.1');
    assert.equal(checked, 1);

    const installRes = await fetch(`http://127.0.0.1:${freePort}/api/update/install`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '2.13.1' })
    });
    assert.equal(installRes.status, 200);
    assert.equal(installedVer, '2.13.1');

    const updStatusRes = await fetch(`http://127.0.0.1:${freePort}/api/update/status?token=secret-token`);
    assert.equal(updStatusRes.status, 200);
    assert.equal((await updStatusRes.json()).status, 'installing');
  } finally {
    await close();
  }
});

test('resolveLocalFilePath and resolveVerifiedLocalFilePath verify non-global IPs via DNS without domain suffix hardcoding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-file-uri-'));
  try {
    const file = join(dir, 'sample #1.md');
    writeFileSync(file, 'hello', 'utf8');
    const fileUri = `${pathToFileURL(file).href}#L10-L20`;
    assert.equal(resolveLocalFilePath(fileUri), file);
    // Unescaped '#' in directory/file names (e.g. project-C#/app.exe) must not be truncated as URL hash
    const hashDir = join(dir, 'project-C#');
    mkdirSync(hashDir);
    const hashFile = join(hashDir, 'app.exe');
    writeFileSync(hashFile, 'bin', 'utf8');
    const rawHashUri = pathToFileURL(hashFile).href.replaceAll('%23', '#');
    assert.equal(resolveLocalFilePath(rawHashUri), hashFile);
    assert.equal(resolveLocalFilePath(`${rawHashUri}#L10-L20`), hashFile);
    // Antigravity URI serializer encodes '/' and second '#' inside the fragment as %2F and %23
    const fragStart = rawHashUri.indexOf('#');
    const encodedFragUri = `${rawHashUri.slice(0, fragStart + 1)}${rawHashUri.slice(fragStart + 1).replaceAll('/', '%2F')}`;
    assert.equal(resolveLocalFilePath(encodedFragUri), hashFile);
    assert.equal(resolveLocalFilePath(`${encodedFragUri}%23L10-L20`), hashFile);
    const readmeInHashDir = join(hashDir, 'README.md');
    writeFileSync(readmeInHashDir, '# hi', 'utf8');
    const rawReadmeUri = pathToFileURL(readmeInHashDir).href.replaceAll('%23', '#');
    assert.equal(resolveLocalFilePath(`${rawReadmeUri}#installation`), readmeInHashDir);
    const readmeFragStart = rawReadmeUri.indexOf('#');
    const encodedReadmeUri = `${rawReadmeUri.slice(0, readmeFragStart + 1)}${rawReadmeUri.slice(readmeFragStart + 1).replaceAll('/', '%2F')}%23installation`;
    assert.equal(resolveLocalFilePath(encodedReadmeUri), readmeInHashDir);
    assert.throws(() => resolveLocalFilePath('https://example.com/a.md'), /仅支持本地文件链接/);
    assert.throws(() => resolveLocalFilePath('file://evil.example/share/a.md'), /仅支持本机或局域网文件路径/);
    assert.throws(() => resolveLocalFilePath('file://8.8.8.8/share/a.md', { platform: 'win32' }), /仅支持本机或局域网文件路径/);
    assert.throws(() => resolveLocalFilePath('file://192.168.1.10/share/a.md', { platform: 'darwin' }), /仅支持本机或局域网文件路径/);
    assert.equal(resolveLocalFilePath('file://192.168.1.10/share/%E4%BA%AE%E5%BA%A6%20%E5%AF%B9%E6%AF%94%E5%BA%A6.png', { platform: 'win32' }), '\\\\192.168.1.10\\share\\亮度 对比度.png');
    assert.equal(resolveLocalFilePath('file:////192.168.1.10/share/shot.png', { platform: 'win32' }), '\\\\192.168.1.10\\share\\shot.png');
    assert.equal(resolveLocalFilePath('file://100.64.1.2/media/clip.mp4', { platform: 'win32' }), '\\\\100.64.1.2\\media\\clip.mp4');
    assert.equal(resolveLocalFilePath('file://wsl.localhost/Ubuntu-24.04/home/dev/a.txt', { platform: 'win32' }), '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\a.txt');
    assert.equal(resolveLocalFilePath('file://wsl$/Ubuntu-24.04/home/dev/a.txt', { platform: 'win32' }), '\\\\wsl$\\Ubuntu-24.04\\home\\dev\\a.txt');
    assert.throws(() => resolveLocalFilePath(''), /文件路径无效/);

    // Async DNS-before-SMB verification allows any hostname resolving strictly to non-global IPs (custom split-DNS, Tailscale MagicDNS, NetBIOS)
    const dnsCalls = [];
    const fakeLookup = async host => {
      dnsCalls.push(host);
      if (host === 'nas') return [{ address: '192.168.1.20', family: 4 }];
      if (host === 'nas.mycompany.com') return [{ address: '10.20.30.40', family: 4 }];
      if (host === 'synology.tail1a2b.ts.net') return [{ address: '100.64.2.9', family: 4 }, { address: 'fd7a:115c:a1e0::1', family: 6 }];
      if (host === 'evil.example') return [{ address: '93.184.216.34', family: 4 }];
      if (host === 'dual.example') return [{ address: '192.168.1.10', family: 4 }, { address: '8.8.8.8', family: 4 }];
      throw new Error('ENOTFOUND');
    };
    assert.equal(await resolveVerifiedLocalFilePath('file://192.168.1.10/share/a.png', { platform: 'win32', lookup: fakeLookup }), '\\\\192.168.1.10\\share\\a.png');
    assert.equal(dnsCalls.length, 0); // Literal IPs skip DNS completely
    assert.equal(await resolveVerifiedLocalFilePath('file://nas/photos/test.png', { platform: 'win32', lookup: fakeLookup }), '\\\\nas\\photos\\test.png');
    assert.equal(await resolveVerifiedLocalFilePath('file://nas.mycompany.com/share/doc.pdf', { platform: 'win32', lookup: fakeLookup }), '\\\\nas.mycompany.com\\share\\doc.pdf');
    assert.equal(await resolveVerifiedLocalFilePath('file://synology.tail1a2b.ts.net/media/a.png', { platform: 'win32', lookup: fakeLookup }), '\\\\synology.tail1a2b.ts.net\\media\\a.png');
    await assert.rejects(() => resolveVerifiedLocalFilePath('file://evil.example/share/a.md', { platform: 'win32', lookup: fakeLookup }), /仅支持本机或局域网文件路径/);
    await assert.rejects(() => resolveVerifiedLocalFilePath('file://dual.example/share/a.md', { platform: 'win32', lookup: fakeLookup }), /仅支持本机或局域网文件路径/);
    await assert.rejects(() => resolveVerifiedLocalFilePath('file://unknown-host/share/a.md', { platform: 'win32', lookup: fakeLookup }), /无法解析局域网主机路径/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('openLocalFile dispatches platform commands and blocks runnable Windows files on open', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-open-file-'));
  try {
    const doc = join(dir, 'notes.md');
    const commaFile = join(dir, 'a,b.txt');
    const script = join(dir, 'run.js');
    writeFileSync(doc, '# hi', 'utf8');
    writeFileSync(commaFile, 'x', 'utf8');
    writeFileSync(script, 'console.log(1)', 'utf8');
    const calls = [];
    const fakeSpawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { unref() {} };
    };

    await openLocalFile(pathToFileURL(doc).href, { action: 'open', platform: 'win32', spawnProcess: fakeSpawn });
    await openLocalFile(pathToFileURL(doc).href, { action: 'reveal', platform: 'win32', spawnProcess: fakeSpawn });
    await openLocalFile(pathToFileURL(commaFile).href, { action: 'reveal', platform: 'win32', spawnProcess: fakeSpawn });
    await openLocalFile(pathToFileURL(doc).href, { action: 'reveal', platform: 'darwin', spawnProcess: fakeSpawn });
    await openLocalFile(pathToFileURL(doc).href, { action: 'reveal', platform: 'linux', spawnProcess: fakeSpawn });
    await openLocalFile(pathToFileURL(script).href, { action: 'reveal', platform: 'win32', spawnProcess: fakeSpawn });

    assert.deepEqual(calls[0], { cmd: 'explorer.exe', args: [doc], opts: { detached: true, stdio: 'ignore' } });
    assert.deepEqual(calls[1], { cmd: 'explorer.exe', args: [`/select,"${doc}"`], opts: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true } });
    assert.deepEqual(calls[2], { cmd: 'explorer.exe', args: [`/select,"${commaFile}"`], opts: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true } });
    assert.deepEqual(calls[3], { cmd: 'open', args: ['-R', doc], opts: { detached: true, stdio: 'ignore' } });
    assert.deepEqual(calls[4], { cmd: 'xdg-open', args: [dir], opts: { detached: true, stdio: 'ignore' } });
    assert.deepEqual(calls[5], { cmd: 'explorer.exe', args: [`/select,"${script}"`], opts: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true } });

    // Windows local drive paths with spaces and Unicode quote only the path after /select,
    await openLocalFile('file:///D:/work/2026%20%E9%A1%B9%E7%9B%AE%E5%BD%92%E6%A1%A3/demo-%E5%8E%9F%E5%9B%BE.gif', {
      action: 'reveal',
      platform: 'win32',
      spawnProcess: fakeSpawn,
      exists: () => true,
      stat: () => ({ isDirectory: () => false })
    });
    assert.deepEqual(calls[6], {
      cmd: 'explorer.exe',
      args: ['/select,"D:\\work\\2026 项目归档\\demo-原图.gif"'],
      opts: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }
    });

    // Windows LAN UNC paths with spaces quote cleanly for explorer /select
    await openLocalFile('file://192.168.1.10/share/a%20b.png', {
      action: 'reveal',
      platform: 'win32',
      spawnProcess: fakeSpawn,
      exists: () => true,
      stat: () => ({ isDirectory: () => false })
    });
    assert.deepEqual(calls[7], {
      cmd: 'explorer.exe',
      args: ['/select,"\\\\192.168.1.10\\share\\a b.png"'],
      opts: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }
    });

    // Drive roots open directly without /select
    await openLocalFile('file:///D:/', {
      action: 'reveal',
      platform: 'win32',
      spawnProcess: fakeSpawn,
      exists: () => true,
      stat: () => ({ isDirectory: () => true })
    });
    assert.deepEqual(calls[8], {
      cmd: 'explorer.exe',
      args: ['D:\\'],
      opts: { detached: true, stdio: 'ignore' }
    });

    assert.equal(isWindowsRunnableFile(script), true);
    assert.equal(isWindowsRunnableFile(doc), false);
    await assert.rejects(() => openLocalFile(pathToFileURL(script).href, { action: 'open', platform: 'win32', spawnProcess: fakeSpawn }), /可能直接执行/);
    await assert.rejects(() => openLocalFile(pathToFileURL(doc).href, { action: 'delete', spawnProcess: fakeSpawn }), /不支持的文件操作/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('copyLocalFile runs asynchronously across platforms with safe URI encoding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-copy-file-'));
  try {
    const file = join(dir, 'shot #1.png');
    writeFileSync(file, 'png', 'utf8');
    const fileUri = pathToFileURL(file).href;
    const calls = [];
    const fakeSpawn = (cmd, args, opts) => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      let written = '';
      child.stdin = { on() {}, end(chunk) { written += String(chunk || ''); } };
      child.kill = () => {};
      const entry = { cmd, args, opts, get stdin() { return written; } };
      calls.push(entry);
      queueMicrotask(() => {
        if (cmd === 'wl-copy') child.emit('error', new Error('ENOENT'));
        else child.emit('close', 0);
      });
      return child;
    };

    await copyLocalFile(fileUri, { platform: 'win32', spawnProcess: fakeSpawn, env: {} });
    await copyLocalFile(fileUri, { platform: 'darwin', spawnProcess: fakeSpawn, env: {} });
    await copyLocalFile(fileUri, { platform: 'linux', spawnProcess: fakeSpawn, env: {} });

    assert.equal(calls[0].cmd, 'powershell.exe');
    assert.equal(calls[0].args.includes('-WindowStyle'), false);
    assert.equal(calls[0].args.includes('-ExecutionPolicy'), false);
    assert.equal(calls[0].opts.env.AGY_CLIPBOARD_PATH, file);
    assert.equal(calls[1].cmd, 'osascript');
    assert.equal(calls[1].opts.env.AGY_CLIPBOARD_PATH, file);
    assert.equal(calls[2].cmd, 'wl-copy');
    assert.equal(calls[3].cmd, 'xclip');
    assert.equal(calls[3].stdin, `${pathToFileURL(file).href}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isRemoteSshEnvironment detects headless SSH remote hosts without false positives on local desktop', () => {
  assert.equal(isRemoteSshEnvironment({ platform: 'linux', env: { SSH_CONNECTION: '1.2.3.4 22', ANTIGRAVITY_VSCODE_HOST: '1' } }), true);
  assert.equal(isRemoteSshEnvironment({ platform: 'linux', env: { ANTIGRAVITY_VSCODE_HOST: '1' } }), true);
  assert.equal(isRemoteSshEnvironment({ platform: 'linux', env: { SSH_CONNECTION: '1.2.3.4 22', DISPLAY: ':0' } }), false);
  assert.equal(isRemoteSshEnvironment({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } }), false);
  assert.equal(isRemoteSshEnvironment({ platform: 'win32', env: { SSH_CONNECTION: '1.2.3.4 22' } }), false);
  const html = renderAuxPaneHtml({ version: '2.12.8', language: 'zh-CN' });
  assert.ok(html.includes('当前处于 SSH 远端模式'));
});

test('scheduleRelaunchWithDebugPort reads saved proxy settings across platforms without creating shortcuts', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-proxy-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
      proxyEnabled: true,
      proxyUrl: 'socks5h://127.0.0.1:7897',
      proxyBypass: '192.168.0.0/16',
      proxyForceHttp1: true
    }));

    // Windows: reads settings.json automatically (so account switch & update relaunch preserve proxy)
    const winExe = join(root, 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe');
    mkdirSync(join(root, 'AppData', 'Local', 'Programs', 'antigravity'), { recursive: true });
    writeFileSync(winExe, '');
    const winSpawned = [];
    const winRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local') },
      spawnProcess(cmd, args, opts) { winSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(winRes.proxyActive, true);
    const winJob = JSON.parse(readFileSync(winRes.jobPath, 'utf8'));
    assert.equal(winJob.proxyEnabled, true);
    assert.equal(winJob.forceHttp1, true);
    assert.equal(winJob.proxyEnv.HTTPS_PROXY, 'socks5h://127.0.0.1:7897');
    assert.equal(winJob.proxyEnv.NO_PROXY, 'localhost,127.0.0.1,::1,192.168.0.0/16');
    assert.equal(winJob.proxyEnv.GODEBUG, 'http2client=0');
    assert.deepEqual(winJob.args, [
      '--remote-debugging-port=0',
      '--proxy-server=socks5://127.0.0.1:7897',
      '--proxy-bypass-list=localhost;127.0.0.1;[::1];192.168.0.0/16'
    ]);

    // macOS: injects env + --env flags + Chromium proxy args and clears helper vars
    const macApp = join(root, 'Antigravity.app');
    mkdirSync(join(macApp, 'Contents', 'Resources', 'bin'), { recursive: true });
    const macLs = join(macApp, 'Contents', 'Resources', 'bin', 'language_server');
    writeFileSync(macLs, '');
    const macSpawned = [];
    const macRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'darwin',
      env: { ANTIGRAVITY_AGENTAPI_EXE: macLs },
      spawnProcess(cmd, args, opts) { macSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(macRes.proxyActive, true);
    assert.equal(macSpawned[0].opts.env.AGY_PROXY_URL, 'socks5h://127.0.0.1:7897');
    assert.equal(macSpawned[0].opts.env.AGY_PROXY_CHROME_SERVER, 'socks5://127.0.0.1:7897');
    assert.ok(macSpawned[0].args[1].includes('--env "HTTPS_PROXY=$p_url"'));
    assert.ok(macSpawned[0].args[1].includes('--proxy-server=$p_chrome'));
    assert.ok(macSpawned[0].args[1].includes('unset AGY_PROXY_URL'));

    // Linux: exports env + passes Chromium args
    const linExe = join(root, 'antigravity');
    writeFileSync(linExe, '');
    const linSpawned = [];
    const linRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'linux',
      env: { APPIMAGE: linExe },
      spawnProcess(cmd, args, opts) { linSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(linRes.proxyActive, true);
    assert.ok(linSpawned[0].args[1].includes('export HTTP_PROXY="$p_url"'));
    assert.ok(linSpawned[0].args[1].includes('--proxy-server=$p_chrome'));

    // Disabled proxy: Windows relaunch explicitly clears stale proxy env vars
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ proxyEnabled: false, proxyUrl: 'http://127.0.0.1:7897' }));
    const offSpawned = [];
    const offRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local') },
      spawnProcess(cmd, args, opts) { offSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(offRes.proxyActive, false);
    const offJob = JSON.parse(readFileSync(offRes.jobPath, 'utf8'));
    assert.equal(offJob.proxyEnabled, false);
    assert.equal(offJob.proxyEnv, null);
    assert.deepEqual(offJob.args, ['--remote-debugging-port=0']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readLocalFileForAttach returns base64 media for images/PDFs, mentions for code/folders/oversized, and rejects missing or remote URIs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-attach-'));
  try {
    const imgPath = join(dir, 'sample.png');
    const imgBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    writeFileSync(imgPath, imgBytes);
    const pdfPath = join(dir, 'spec.pdf');
    writeFileSync(pdfPath, Buffer.from('%PDF-1.7\n'));
    const codePath = join(dir, 'index.mjs');
    writeFileSync(codePath, 'export const ok = true;\n');
    const subDir = join(dir, 'folder');
    mkdirSync(subDir);

    const imgRes = await readLocalFileForAttach(pathToFileURL(imgPath).href);
    assert.equal(imgRes.mode, 'media');
    assert.equal(imgRes.mimeType, 'image/png');
    assert.equal(imgRes.name, 'sample.png');
    assert.equal(imgRes.base64, imgBytes.toString('base64'));

    const pdfRes = await readLocalFileForAttach(pathToFileURL(pdfPath).href);
    assert.equal(pdfRes.mode, 'media');
    assert.equal(pdfRes.mimeType, 'application/pdf');

    const oversizedRes = await readLocalFileForAttach(pathToFileURL(imgPath).href, { maxMediaBytes: 4 });
    assert.equal(oversizedRes.mode, 'mention');
    assert.equal(oversizedRes.oversized, true);
    assert.equal(oversizedRes.base64, undefined);

    const codeRes = await readLocalFileForAttach(pathToFileURL(codePath).href);
    assert.equal(codeRes.mode, 'mention');
    assert.equal(codeRes.kind, 'file');
    assert.equal(codeRes.isDirectory, false);

    const dirRes = await readLocalFileForAttach(pathToFileURL(subDir).href);
    assert.equal(dirRes.mode, 'mention');
    assert.equal(dirRes.kind, 'directory');
    assert.equal(dirRes.isDirectory, true);

    await assert.rejects(() => readLocalFileForAttach(pathToFileURL(join(dir, 'missing.png')).href), /不存在/);
    await assert.rejects(() => readLocalFileForAttach('https://example.com/a.png'), /仅支持本地文件/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseFileUriAnchor, discoverOpenWithApps, and openFileWithApp detect installed local apps, jump to exact lines, open terminals in parent dir, and guard Windows .cmd', async () => {
  assert.deepEqual(parseFileUriAnchor('file:///repo/a.js#L42'), { line: 42, column: null });
  assert.deepEqual(parseFileUriAnchor('file:///repo/a.js#L18C7-L25'), { line: 18, column: 7 });
  assert.deepEqual(parseFileUriAnchor('file:///repo/a.js#L9:3'), { line: 9, column: 3 });
  assert.deepEqual(parseFileUriAnchor('file:///repo/README.md#overview'), { line: null, column: null });
  // PR #98: trailing :line[:col] suffixes and %3A-encoded suffixes
  assert.deepEqual(parseFileUriAnchor('file:///repo/get_search_suggest.go:371'), { line: 371, column: null });
  assert.deepEqual(parseFileUriAnchor('file:///repo/get_search_suggest.go:2386-2446'), { line: 2386, column: null });
  assert.deepEqual(parseFileUriAnchor('file:///repo/get_search_suggest.go:371:12'), { line: 371, column: 12 });
  assert.deepEqual(parseFileUriAnchor('file:///repo/get_search_suggest.go:10:2-20:5'), { line: 10, column: 2 });
  assert.deepEqual(parseFileUriAnchor('file:///repo/get_search_suggest.go%3A371'), { line: 371, column: null });
  assert.equal(resolveLocalFilePath('file:///repo/get_search_suggest.go:371', { platform: 'darwin' }), '/repo/get_search_suggest.go');
  assert.equal(resolveLocalFilePath('file:///repo/get_search_suggest.go:2386-2446', { platform: 'darwin' }), '/repo/get_search_suggest.go');
  assert.equal(resolveLocalFilePath('file:///repo/get_search_suggest.go:371:12', { platform: 'darwin' }), '/repo/get_search_suggest.go');
  assert.equal(resolveLocalFilePath('file:///C:/repo/a.go:371:8', { platform: 'win32' }), 'C:\\repo\\a.go');
  // Edge Case 1: '#' in directory names & :line + #heading & #L precedence
  assert.equal(resolveLocalFilePath('file:///dir/project-C#/app.go:42:3', { platform: 'linux' }), '/dir/project-C#/app.go');
  assert.deepEqual(parseFileUriAnchor('file:///dir/project-C#/app.go:42:3'), { line: 42, column: 3 });
  assert.equal(resolveLocalFilePath('file:///dir/project-C#%2Fapp.go:42:3', { platform: 'linux' }), '/dir/project-C#/app.go');
  assert.deepEqual(parseFileUriAnchor('file:///dir/project-C#%2Fapp.go:42:3'), { line: 42, column: 3 });
  assert.equal(resolveLocalFilePath('file:///dir/README.md:10#heading', { platform: 'linux' }), '/dir/README.md');
  assert.deepEqual(parseFileUriAnchor('file:///dir/README.md:10#heading'), { line: 10, column: null });
  assert.equal(resolveLocalFilePath('file:///dir/project-C#/README.md:10#heading', { platform: 'linux' }), '/dir/project-C#/README.md');
  assert.deepEqual(parseFileUriAnchor('file:///dir/project-C#/README.md:10#heading'), { line: 10, column: null });
  assert.deepEqual(parseFileUriAnchor('file:///dir/app.go:5#L10'), { line: 10, column: null });
  // Edge Case 3: invalid :0 / col === 0 / endLine === 0 / endCol === 0 is NOT stripped, and #L anchor skips colon stripping
  assert.equal(resolveLocalFilePath('file:///dir/app.go:0', { platform: 'linux' }), '/dir/app.go:0');
  assert.equal(resolveLocalFilePath('file:///dir/app.go:0:4', { platform: 'linux' }), '/dir/app.go:0:4');
  assert.equal(resolveLocalFilePath('file:///dir/log:12:00', { platform: 'linux' }), '/dir/log:12:00');
  assert.equal(resolveLocalFilePath('file:///dir/file:12-0', { platform: 'linux' }), '/dir/file:12-0');
  assert.equal(resolveLocalFilePath('file:///dir/file:12:1-15:0', { platform: 'linux' }), '/dir/file:12:1-15:0');
  assert.equal(resolveLocalFilePath('file:///dir/server:8080#L10', { platform: 'linux' }), '/dir/server:8080');
  assert.deepEqual(parseFileUriAnchor('file:///dir/app.go:0'), { line: null, column: null });
  assert.deepEqual(parseFileUriAnchor('file:///dir/app.go:0:4'), { line: null, column: null });
  assert.deepEqual(parseFileUriAnchor('file:///dir/log:12:00'), { line: null, column: null });
  assert.deepEqual(parseFileUriAnchor('file:///dir/file:12-0'), { line: null, column: null });
  assert.deepEqual(parseFileUriAnchor('file:///dir/file:12:1-15:0'), { line: null, column: null });
  assert.deepEqual(parseFileUriAnchor('file:///dir/server:8080#L10'), { line: 10, column: null });

  const wslResolved = resolveLocalFilePath('file://wsl.localhost/Ubuntu/home/dev/app.ts#L12', { platform: 'linux' });
  assert.equal(wslResolved, '/home/dev/app.ts');
  const encodedWinDrive = resolveLocalFilePath('file:///d%3A/repo/lib/launcher.mjs', { platform: 'win32' });
  assert.equal(encodedWinDrive, 'd:\\repo\\lib\\launcher.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'agy-editor-'));
  try {
    const posixBin = '/mock/bin';
    const cursorBin = join(posixBin, 'cursor');
    const zedBin = join(posixBin, 'zed');
    const kittyBin = join(posixBin, 'kitty');
    const posixFile = '/workspace/main.mjs';
    const linuxExists = p => p === posixFile || p === cursorBin || p === zedBin || p === kittyBin;

    const linuxApps = discoverOpenWithApps({ platform: 'linux', env: { PATH: posixBin }, home: '/mock/home', exists: linuxExists, readdir: () => [] });
    assert.deepEqual(linuxApps.map(a => a.id), ['cursor', 'zed', 'default', 'explorer', 'kitty']);

    const calls = [];
    const fakeSpawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { on() {}, unref() {} };
    };

    const uriWithLine = 'file:///workspace/main.mjs#L27C4';
    const resCursor = await openFileWithApp(uriWithLine, 'cursor', {
      platform: 'linux',
      env: { PATH: posixBin },
      home: '/mock/home',
      exists: linuxExists,
      readdir: () => [],
      stat: () => ({ isDirectory: () => false }),
      spawnProcess: fakeSpawn
    });
    assert.equal(resCursor.appId, 'cursor');
    assert.equal(resCursor.line, 27);
    assert.equal(resCursor.column, 4);
    assert.deepEqual(calls[0].args, ['-g', `${posixFile}:27:4`]);

    const resZed = await openFileWithApp(uriWithLine, 'zed', {
      platform: 'linux',
      env: { PATH: posixBin },
      home: '/mock/home',
      exists: linuxExists,
      readdir: () => [],
      stat: () => ({ isDirectory: () => false }),
      spawnProcess: fakeSpawn
    });
    assert.equal(resZed.appId, 'zed');
    assert.deepEqual(calls[1].args, [`${posixFile}:27:4`]);

    const golandBin = join(posixBin, 'goland');
    const resGoland = await openFileWithApp('file:///workspace/main.mjs:371:12', 'goland', {
      platform: 'linux',
      env: { PATH: posixBin },
      home: '/mock/home',
      exists: p => linuxExists(p) || p === golandBin,
      readdir: () => [],
      stat: () => ({ isDirectory: () => false }),
      spawnProcess: fakeSpawn
    });
    assert.equal(resGoland.appId, 'goland');
    assert.equal(resGoland.path, posixFile);
    assert.equal(resGoland.line, 371);
    assert.equal(resGoland.column, 12);
    assert.deepEqual(calls[2].args, ['--line', '371', '--column', '12', posixFile]);

    // Edge Case 2: POSIX filename legitimately containing :digit (e.g. /workspace/backup-12:30) is preserved untouched and colon anchor suppressed
    const literalColonFile = '/workspace/backup-12:30';
    const literalRes = await openFileWithApp('file:///workspace/backup-12:30', 'goland', {
      platform: 'linux',
      env: { PATH: posixBin },
      home: '/mock/home',
      exists: p => p === literalColonFile || p === golandBin,
      readdir: () => [],
      stat: () => ({ isDirectory: () => false }),
      spawnProcess: fakeSpawn
    });
    assert.equal(literalRes.path, literalColonFile);
    assert.equal(literalRes.line, null);
    assert.equal(literalRes.column, null);
    assert.deepEqual(calls[3].args, [literalColonFile]);

    // Hash anchor #L7 still works on a literal :digit filename
    const literalHashRes = await openFileWithApp('file:///workspace/backup-12:30#L7', 'goland', {
      platform: 'linux',
      env: { PATH: posixBin },
      home: '/mock/home',
      exists: p => p === literalColonFile || p === golandBin,
      readdir: () => [],
      stat: () => ({ isDirectory: () => false }),
      spawnProcess: fakeSpawn
    });
    assert.equal(literalHashRes.path, literalColonFile);
    assert.equal(literalHashRes.line, 7);
    assert.deepEqual(calls[4].args, ['--line', '7', literalColonFile]);

    // FS-aware openLocalFile, copyLocalFile, and readLocalFileForAttach preserve literal :digit filenames on POSIX
    const openLiteral = await openLocalFile('file:///workspace/backup-12:30', {
      action: 'open',
      platform: 'linux',
      exists: p => p === literalColonFile,
      stat: () => ({ isDirectory: () => false }),
      spawnProcess: fakeSpawn
    });
    assert.equal(openLiteral.path, literalColonFile);
    const attachLiteral = await readLocalFileForAttach('file:///workspace/backup-12:30', {
      platform: 'linux',
      exists: p => p === literalColonFile,
      stat: () => ({ isDirectory: () => false, size: 12 })
    });
    assert.equal(attachLiteral.path, literalColonFile);
    const copyCalls = [];
    const copyLiteral = await copyLocalFile('file:///workspace/backup-12:30', {
      platform: 'darwin',
      exists: p => p === literalColonFile,
      spawnProcess: (cmd, args, opts) => {
        const child = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        copyCalls.push({ cmd, args, env: opts.env });
        queueMicrotask(() => child.emit('close', 0));
        return child;
      },
      env: {}
    });
    assert.equal(copyLiteral.path, literalColonFile);
    assert.equal(copyCalls[0].env.AGY_CLIPBOARD_PATH, literalColonFile);

    await openFileWithApp(uriWithLine, 'kitty', {
      platform: 'linux',
      env: { PATH: posixBin },
      home: '/mock/home',
      exists: linuxExists,
      readdir: () => [],
      stat: () => ({ isDirectory: () => false }),
      spawnProcess: fakeSpawn
    });
    assert.equal(calls[6].opts.cwd, '/workspace');

    await assert.rejects(
      () => openFileWithApp(uriWithLine, 'windsurf', {
        platform: 'linux',
        env: { PATH: posixBin },
        home: '/mock/home',
        exists: linuxExists,
        readdir: () => [],
        stat: () => ({ isDirectory: () => false }),
        spawnProcess: fakeSpawn
      }),
      /未在本机检测到/
    );

    // Windows .cmd fallback blocks shell metacharacters (&, |, %, etc.) to prevent cmd.exe injection
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    const winCmd = join(binDir, 'code.cmd');
    writeFileSync(winCmd, '@echo off\r\n');
    const unsafeFile = join(dir, 'a&calc.js');
    writeFileSync(unsafeFile, '');
    await assert.rejects(
      () => openFileWithApp(pathToFileURL(unsafeFile).href, 'vscode', {
        platform: 'win32',
        env: { PATH: binDir },
        home: dir,
        exists: p => p === winCmd || p === unsafeFile,
        readdir: () => [],
        stat: () => ({ isDirectory: () => false }),
        spawnProcess: fakeSpawn
      }),
      /敏感字符/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('maybeAutoRelaunchProxy automatically relaunches once on cold start when non-TUN proxy is configured and reachable, skips when unreachable, and guards against loops', async () => {
  const { maybeAutoRelaunchProxy, recordProxyReady } = await import('../lib/launcher.mjs');
  const root = mkdtempSync(join(tmpdir(), 'agy-proxy-auto-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    let relaunchedCount = 0;
    const fakeRelaunch = () => { relaunchedCount++; return { scheduled: true }; };
    const env = { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:41001', LOCALAPPDATA: root };
    const fakeExe = join(root, 'Programs', 'antigravity', 'Antigravity.exe');
    mkdirSync(join(root, 'Programs', 'antigravity'), { recursive: true });
    writeFileSync(fakeExe, '');

    // 1. Proxy port unreachable -> must NOT relaunch
    const rUnreach = await maybeAutoRelaunchProxy({
      dataDir, home: root, platform: 'win32', env,
      enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied', now: 1_000_000,
      checkPort: async () => ({ ok: false, error: 'closed' }),
      relaunch: fakeRelaunch
    });
    assert.equal(rUnreach.relaunched, false);
    assert.equal(rUnreach.reason, 'proxy-unreachable');
    assert.equal(relaunchedCount, 0);

    // 2. Proxy port open -> relaunches once
    const rOk = await maybeAutoRelaunchProxy({
      dataDir, home: root, platform: 'win32', env,
      enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied', now: 1_000_000,
      checkPort: async () => ({ ok: true }),
      relaunch: fakeRelaunch
    });
    assert.equal(rOk.relaunched, true);
    assert.equal(relaunchedCount, 1);

    // 3. Same LS session -> blocked by already-attempted-session
    const rSame = await maybeAutoRelaunchProxy({
      dataDir, home: root, platform: 'win32', env,
      enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied', now: 1_500_000,
      checkPort: async () => ({ ok: true }),
      relaunch: fakeRelaunch
    });
    assert.equal(rSame.relaunched, false);
    assert.equal(rSame.reason, 'already-attempted-session');

    // 4. New session within cooldown -> blocked by cooldown
    const rCool = await maybeAutoRelaunchProxy({
      dataDir, home: root, platform: 'win32', env: { ...env, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:41002' },
      enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied', now: 1_030_000,
      checkPort: async () => ({ ok: true }),
      relaunch: fakeRelaunch
    });
    assert.equal(rCool.relaunched, false);
    assert.equal(rCool.reason, 'cooldown');

    // 5. Second consecutive failure opens circuit breaker on 3rd attempt; recordProxyReady resets it
    await maybeAutoRelaunchProxy({
      dataDir, home: root, platform: 'win32', env: { ...env, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:41003' },
      enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied', now: 1_300_000,
      checkPort: async () => ({ ok: true }),
      relaunch: fakeRelaunch
    });
    assert.equal(relaunchedCount, 2);
    const rCircuit = await maybeAutoRelaunchProxy({
      dataDir, home: root, platform: 'win32', env: { ...env, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:41004' },
      enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied', now: 1_600_000,
      checkPort: async () => ({ ok: true }),
      relaunch: fakeRelaunch
    });
    assert.equal(rCircuit.relaunched, false);
    assert.equal(rCircuit.reason, 'circuit-open');

    recordProxyReady({ dataDir });
    const rReset = await maybeAutoRelaunchProxy({
      dataDir, home: root, platform: 'win32', env: { ...env, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:41005' },
      enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied', now: 1_900_000,
      checkPort: async () => ({ ok: true }),
      relaunch: fakeRelaunch
    });
    assert.equal(rReset.relaunched, true);
    assert.equal(relaunchedCount, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relaunch scripts escalate lingering POSIX processes to SIGKILL, resolve Linux symlinks, and preserve user system proxy env when plugin proxy is off', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-harden-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ proxyEnabled: false }));

    // 1. Linux: symlink target resolves realpath, targets main Electron PID before helpers, escalates to SIGKILL, and guards proxy unset
    const realExe = join(root, 'opt-antigravity');
    const symExe = join(root, 'bin-antigravity');
    writeFileSync(realExe, '');
    if (process.platform !== 'win32') symlinkSync(realExe, symExe);
    const linSpawned = [];
    const linRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'linux',
      env: { APPIMAGE: process.platform !== 'win32' ? symExe : realExe },
      spawnProcess(cmd, args, opts) { linSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(linRes.scheduled, true);
    assert.equal(linSpawned[0].opts.env.AGY_RELAUNCH_REAL, realpathSync(realExe));
    const linScript = linSpawned[0].args[1];
    assert.ok(linScript.includes('index($0, " --type=") == 0 && index($0, " --import=") == 0'));
    assert.ok(linScript.includes('kill -KILL $rem_pids'));
    assert.ok(linScript.includes('if [ -n "$AGY_POWERTOOLS_PROXY_SPEC" ]; then unset HTTP_PROXY'));
    assert.ok(linScript.includes('unset AGY_RELAUNCH_TARGET AGY_RELAUNCH_REAL'));
    if (process.platform !== 'win32') {
      assert.equal(spawnSync('sh', ['-n', '-c', linScript], { encoding: 'utf8' }).status, 0);
    }

    // 2. macOS: escalates lingering processes to SIGKILL and guards proxy unset behind AGY_POWERTOOLS_PROXY_SPEC
    const macApp = join(root, 'Antigravity.app');
    mkdirSync(join(macApp, 'Contents', 'Resources', 'bin'), { recursive: true });
    const macLs = join(macApp, 'Contents', 'Resources', 'bin', 'language_server');
    writeFileSync(macLs, '');
    const macSpawned = [];
    scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'darwin',
      env: { ANTIGRAVITY_AGENTAPI_EXE: macLs },
      spawnProcess(cmd, args, opts) { macSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    const macScript = macSpawned[0].args[1];
    assert.ok(macScript.includes('kill -KILL $pids'));
    assert.ok(macScript.includes('Contents/Resources/bin/language_server'));
    assert.ok(macScript.includes('if [ -n "$AGY_POWERTOOLS_PROXY_SPEC" ]; then unset HTTP_PROXY'));
    if (process.platform !== 'win32') {
      assert.equal(spawnSync('sh', ['-n', '-c', macScript], { encoding: 'utf8' }).status, 0);
    }

    // 3. Windows: writes proxyEnabled=false and proxyEnv=null so relaunch-worker preserves user system proxy when AGY_POWERTOOLS_PROXY_SPEC is absent
    const winExe = join(root, 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe');
    mkdirSync(join(root, 'AppData', 'Local', 'Programs', 'antigravity'), { recursive: true });
    writeFileSync(winExe, '');
    const winSpawned = [];
    const winRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local') },
      spawnProcess(cmd, args, opts) { winSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    const winJob = JSON.parse(readFileSync(winRes.jobPath, 'utf8'));
    assert.equal(winJob.proxyEnabled, false);
    assert.equal(winJob.proxyEnv, null);
    assert.deepEqual(winJob.args, ['--remote-debugging-port=0']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows relaunch uses AV-clean static explorer-cmd / node-worker architecture (zero PowerShell/.ps1/.lnk) with proxy, onboarding sync, and legacy cleanup (Issues #53, #59 & #61)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-win-relaunch-53-'));
  try {
    const stdDataDir = join(root, '.gemini', 'antigravity', 'plugin_data', 'agy-powertools');
    mkdirSync(stdDataDir, { recursive: true });
    writeFileSync(join(stdDataDir, 'settings.json'), JSON.stringify({
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:7897',
      proxyBypass: '192.168.0.0/16',
      proxyForceHttp1: false
    }));
    // Seed legacy artifacts from older versions to verify automatic cleanup
    writeFileSync(join(stdDataDir, 'relaunch-antigravity.ps1'), 'legacy');
    writeFileSync(join(stdDataDir, 'relaunch-antigravity.lnk'), 'legacy');
    writeFileSync(join(stdDataDir, 'relaunch-antigravity.ack'), 'legacy');

    const winExe = join(root, 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe');
    mkdirSync(join(root, 'AppData', 'Local', 'Programs', 'antigravity'), { recursive: true });
    writeFileSync(winExe, '');
    const appStoragePath = join(root, 'AppData', 'Roaming', 'Antigravity', 'app_storage.json');
    mkdirSync(join(root, 'AppData', 'Roaming', 'Antigravity'), { recursive: true });
    writeFileSync(appStoragePath, JSON.stringify({ 'agy.onboarding.lastLoginUsername': 'old@example.com', 'agy.onboarding.lastLoginIsGcpTos': 'false' }));

    // 1. Standard plugin_data dir -> explorer.exe launches static shipped scripts/relaunch-antigravity.cmd (Job Object escape, zero PowerShell/.lnk)
    const stdSpawned = [];
    const stdRes = scheduleRelaunchWithDebugPort({
      dataDir: stdDataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local') },
      onboardingSync: { email: 'bob@example.com', isGcpTos: true },
      appStoragePath,
      spawnProcess(cmd, args, opts) { stdSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(stdRes.scheduled, true);
    assert.equal(stdRes.proxyActive, true);
    assert.equal(stdRes.launchMethod, 'explorer-cmd');
    assert.ok(stdRes.nonce && stdRes.ackPath && stdRes.jobPath);
    assert.equal(stdSpawned.length, 1);
    assert.match(stdSpawned[0].cmd, /explorer\.exe$/i);
    assert.ok(stdSpawned[0].args[0].endsWith('relaunch-antigravity.cmd'));
    assert.equal(existsSync(join(stdDataDir, 'relaunch-antigravity.ps1')), false);
    assert.equal(existsSync(join(stdDataDir, 'relaunch-antigravity.lnk')), false);
    assert.equal(existsSync(join(stdDataDir, 'relaunch-antigravity.ack')), false);

    const stdJob = JSON.parse(readFileSync(stdRes.jobPath, 'utf8'));
    assert.equal(stdJob.format, 1);
    assert.equal(stdJob.nonce, stdRes.nonce);
    assert.equal(stdJob.target, winExe);
    assert.deepEqual(stdJob.args, [
      '--remote-debugging-port=0',
      '--proxy-server=http://127.0.0.1:7897',
      '--proxy-bypass-list=localhost;127.0.0.1;[::1];192.168.0.0/16'
    ]);
    assert.equal(stdJob.proxyEnabled, true);
    assert.equal(stdJob.forceHttp1, false);
    assert.equal(stdJob.proxyEnv.HTTPS_PROXY, 'http://127.0.0.1:7897');
    assert.equal(stdJob.proxyEnv.GODEBUG, undefined);
    assert.deepEqual(stdJob.onboardingSync, {
      email: 'bob@example.com',
      isGcpTos: true,
      appStoragePath
    });

    // 2. Custom dataDir -> spawns static scripts/relaunch-worker.mjs directly via node-worker (still zero PowerShell/.lnk)
    const customDataDir = join(root, 'custom-data');
    mkdirSync(customDataDir, { recursive: true });
    const customSpawned = [];
    const customRes = scheduleRelaunchWithDebugPort({
      dataDir: customDataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local') },
      spawnProcess(cmd, args, opts) { customSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(customRes.launchMethod, 'node-worker');
    assert.equal(customSpawned[0].cmd, process.execPath);
    assert.ok(customSpawned[0].args[0].endsWith('relaunch-worker.mjs'));
    assert.equal(customSpawned[0].args[1], customRes.jobPath);
    assert.equal(customSpawned[0].opts.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(/powershell/i.test(customSpawned[0].cmd), false);

    // 3. POSIX macOS/Linux relaunch still injects post-exit onboarding sync safely via env vars
    const linExe = join(root, 'antigravity-lin');
    writeFileSync(linExe, '');
    const linSpawned = [];
    scheduleRelaunchWithDebugPort({
      dataDir: customDataDir,
      home: root,
      platform: 'linux',
      env: { APPIMAGE: linExe },
      onboardingSync: { email: 'bob@example.com', isGcpTos: false },
      appStoragePath: join(root, 'lin_storage.json'),
      spawnProcess(cmd, args, opts) { linSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(linSpawned[0].opts.env.AGY_ONBOARDING_EMAIL, 'bob@example.com');
    assert.equal(linSpawned[0].opts.env.AGY_ONBOARDING_GCP_TOS, 'false');
    assert.ok(linSpawned[0].args[1].includes('agy.onboarding.lastLoginUsername'));
    if (process.platform !== 'win32') {
      assert.equal(spawnSync('sh', ['-n', '-c', linSpawned[0].args[1]], { encoding: 'utf8' }).status, 0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recordDebugPortReady and recordProxyReady clear relaunch cooldown timestamps on success so reopening within 120s still auto-relaunches (Issue #64)', async () => {
  const { maybeAutoRelaunchMac, maybeAutoRelaunchProxy, recordDebugPortReady, recordProxyReady } = await import('../lib/launcher.mjs');
  const root = mkdtempSync(join(tmpdir(), 'agy-cooldown-reset-64-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    const macApp = join(root, 'Applications', 'Antigravity.app');
    mkdirSync(macApp, { recursive: true });

    let relaunches = 0;
    const fakeRelaunch = () => { relaunches++; return { scheduled: true }; };

    // 1. macAutoRelaunch triggers once, then succeeds (recordDebugPortReady clears cooldown)
    const r1 = maybeAutoRelaunchMac({
      dataDir, home: root, platform: 'darwin',
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:51001' },
      enabled: true, macAutoRelaunch: true, now: 1_000_000, relaunch: fakeRelaunch
    });
    assert.equal(r1.relaunched, true);
    recordDebugPortReady({ dataDir });

    // Reopening 20 seconds later (< 120s cooldown) with a new LS address MUST still auto-relaunch!
    const r2 = maybeAutoRelaunchMac({
      dataDir, home: root, platform: 'darwin',
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:51002' },
      enabled: true, macAutoRelaunch: true, now: 1_020_000, relaunch: fakeRelaunch
    });
    assert.equal(r2.relaunched, true);
    assert.equal(relaunches, 2);

    // 2. Proxy auto-relaunch also clears cooldown after recordProxyReady
    const p1 = await maybeAutoRelaunchProxy({
      dataDir, home: root, platform: 'darwin',
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:52001' },
      enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied', now: 2_000_000,
      checkPort: async () => ({ ok: true }), relaunch: fakeRelaunch
    });
    assert.equal(p1.relaunched, true);
    recordProxyReady({ dataDir });

    const p2 = await maybeAutoRelaunchProxy({
      dataDir, home: root, platform: 'darwin',
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:52002' },
      enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied', now: 2_025_000,
      checkPort: async () => ({ ok: true }), relaunch: fakeRelaunch
    });
    assert.equal(p2.relaunched, true);
    assert.equal(relaunches, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cold-start proxy probe and missing-debug-port macOS check coordinate so concurrent triggers schedule at most one relaunch (Issue #64)', async () => {
  const { createColdStartRelaunchCoordinator, maybeAutoRelaunchMac, maybeAutoRelaunchProxy } = await import('../lib/launcher.mjs');
  const root = mkdtempSync(join(tmpdir(), 'agy-race-64-'));
  try {
    const macApp = join(root, 'Applications', 'Antigravity.app');
    mkdirSync(macApp, { recursive: true });

    // Case 1: Coordinator defers macOS check during async proxy checkPort; when proxy is reachable, only 1 relaunch fires.
    const dataDir1 = join(root, 'd1');
    mkdirSync(dataDir1, { recursive: true });
    let resolvePort1;
    let calls1 = 0;
    const coord1 = createColdStartRelaunchCoordinator({
      dataDir: dataDir1,
      home: root,
      platform: 'darwin',
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:53001' },
      now: () => 3_000_000,
      checkPort: () => new Promise(res => { resolvePort1 = res; }),
      relaunch: () => { calls1++; return { scheduled: true }; }
    });
    const proxyPromise1 = coord1.attemptProxy({
      enabled: true,
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied'
    });
    assert.equal(coord1.isProxyProbeInFlight(), true);
    const macDuringProbe1 = coord1.attemptMac({ enabled: true, macAutoRelaunch: true });
    assert.equal(macDuringProbe1.relaunched, false);
    assert.equal(macDuringProbe1.reason, 'deferred-for-proxy-probe');
    resolvePort1({ ok: true });
    const proxyRes1 = await proxyPromise1;
    assert.equal(proxyRes1.relaunched, true);
    assert.equal(calls1, 1);
    const macAfter1 = coord1.attemptMac({ enabled: true, macAutoRelaunch: true });
    assert.equal(macAfter1.relaunched, false);
    assert.equal(calls1, 1);

    // Case 2: Proxy is unreachable -> deferred macOS check runs immediately after probe finishes, still exactly 1 relaunch.
    const dataDir2 = join(root, 'd2');
    mkdirSync(dataDir2, { recursive: true });
    let resolvePort2;
    let calls2 = 0;
    const coord2 = createColdStartRelaunchCoordinator({
      dataDir: dataDir2,
      home: root,
      platform: 'darwin',
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:53002' },
      now: () => 3_100_000,
      checkPort: () => new Promise(res => { resolvePort2 = res; }),
      relaunch: () => { calls2++; return { scheduled: true }; }
    });
    const proxyPromise2 = coord2.attemptProxy({
      enabled: true,
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied'
    });
    coord2.attemptMac({ enabled: true, macAutoRelaunch: true });
    resolvePort2({ ok: false, error: 'ECONNREFUSED' });
    const proxyRes2 = await proxyPromise2;
    assert.equal(proxyRes2.relaunched, false);
    assert.equal(calls2, 1);

    // Case 3: Direct low-level race without coordinator — maybeAutoRelaunchProxy re-reads relaunch-state.json after await checkPort.
    const dataDir3 = join(root, 'd3');
    mkdirSync(dataDir3, { recursive: true });
    let resolvePort3;
    let calls3 = 0;
    const fakeRelaunch3 = () => { calls3++; return { scheduled: true }; };
    const env3 = { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:53003' };
    const lowProxyPromise = maybeAutoRelaunchProxy({
      dataDir: dataDir3, home: root, platform: 'darwin', env: env3,
      enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'not-applied', now: 3_200_000,
      checkPort: () => new Promise(res => { resolvePort3 = res; }),
      relaunch: fakeRelaunch3
    });
    const lowMacRes = maybeAutoRelaunchMac({
      dataDir: dataDir3, home: root, platform: 'darwin', env: env3,
      enabled: true, macAutoRelaunch: true, now: 3_200_000, relaunch: fakeRelaunch3
    });
    assert.equal(lowMacRes.relaunched, true);
    resolvePort3({ ok: true });
    const lowProxyRes = await lowProxyPromise;
    assert.equal(lowProxyRes.relaunched, false);
    assert.equal(lowProxyRes.reason, 'already-attempted-session');
    assert.equal(calls3, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shouldAutoRelaunchProxy handles unmanaged external proxy conflicts, ready hooks cross-clear cooldowns, and Windows relaunch writes credentialSwitch/clearScopePath (Issues #93 & #97)', async () => {
  const { createColdStartRelaunchCoordinator, shouldAutoRelaunchProxy, recordDebugPortReady, recordProxyReady } = await import('../lib/launcher.mjs');
  const root = mkdtempSync(join(tmpdir(), 'agy-93-97-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    const env = { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:59001' };

    // Issue #93: external OS proxy conflict (config-changed + runtimeProxyManaged: false) triggers auto-relaunch,
    // whereas managed Powertools config-changed (runtimeProxyManaged: true or omitted) does not
    assert.equal(shouldAutoRelaunchProxy({
      dataDir, platform: 'win32', env, enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'config-changed', runtimeProxyManaged: false, now: 5_000_000
    }).relaunch, true);
    assert.equal(shouldAutoRelaunchProxy({
      dataDir, platform: 'win32', env, enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'config-changed', runtimeProxyManaged: true, now: 5_000_000
    }).relaunch, false);
    assert.equal(shouldAutoRelaunchProxy({
      dataDir, platform: 'win32', env, enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'config-changed', now: 5_000_000
    }).relaunch, false);

    // P0 #1: createColdStartRelaunchCoordinator().attemptProxy forwards runtimeProxyManaged (and managedByPowertools alias)
    const coordDir = join(root, 'coord-data');
    mkdirSync(coordDir, { recursive: true });
    const fakeWinExe = join(root, 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe');
    mkdirSync(join(root, 'AppData', 'Local', 'Programs', 'antigravity'), { recursive: true });
    writeFileSync(fakeWinExe, '');
    const coordEnv = { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:59099', LOCALAPPDATA: join(root, 'AppData', 'Local') };
    let coordRelaunches = 0;
    const coordManaged = createColdStartRelaunchCoordinator({
      dataDir: coordDir,
      home: root,
      platform: 'win32',
      env: coordEnv,
      now: () => 5_100_000,
      checkPort: async () => ({ ok: true }),
      relaunch: () => { coordRelaunches++; return { scheduled: true }; }
    });
    const skippedManaged = await coordManaged.attemptProxy({
      enabled: true,
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'config-changed',
      runtimeProxyManaged: true
    });
    assert.equal(skippedManaged.relaunched, false);
    assert.equal(coordRelaunches, 0);
    const triggeredUnmanaged = await coordManaged.attemptProxy({
      enabled: true,
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:7897',
      runtimeProxyReason: 'config-changed',
      runtimeProxyManaged: false
    });
    assert.equal(triggeredUnmanaged.relaunched, true);
    assert.equal(coordRelaunches, 1);

    // P1 #3: recordDebugPortReady({ preserveBlocked: true }) clears cooldowns without wiping lastRelaunchBlockedAt
    const stateFile = join(dataDir, 'relaunch-state.json');
    writeFileSync(stateFile, JSON.stringify({
      lastProxyAutoRelaunchAt: 12345,
      lastAutoRelaunchAt: 67890,
      lastRelaunchAt: 54321,
      lastRelaunchBlockedAt: 999000,
      lastRelaunchBlockedReason: 'relaunch-blocked'
    }));
    recordDebugPortReady({ dataDir, preserveBlocked: true });
    const afterPreserve = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(afterPreserve.lastProxyAutoRelaunchAt, 0);
    assert.equal(afterPreserve.lastAutoRelaunchAt, 0);
    assert.equal(afterPreserve.lastRelaunchAt, 0);
    assert.equal(afterPreserve.lastRelaunchBlockedAt, 999000);
    assert.equal(afterPreserve.lastRelaunchBlockedReason, 'relaunch-blocked');

    // recordDebugPortReady (default preserveBlocked: false) clears BOTH cooldowns and lastRelaunchBlockedAt; recordProxyReady does the same
    writeFileSync(stateFile, JSON.stringify({ lastProxyAutoRelaunchAt: 12345, lastAutoRelaunchAt: 67890, lastRelaunchBlockedAt: 999 }));
    recordDebugPortReady({ dataDir });
    const afterDebug = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(afterDebug.lastProxyAutoRelaunchAt, 0);
    assert.equal(afterDebug.lastAutoRelaunchAt, 0);
    assert.equal(afterDebug.lastRelaunchBlockedAt, 0);

    writeFileSync(stateFile, JSON.stringify({ lastProxyAutoRelaunchAt: 12345, lastAutoRelaunchAt: 67890, lastRelaunchBlockedAt: 999 }));
    recordProxyReady({ dataDir });
    const afterProxy = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(afterProxy.lastProxyAutoRelaunchAt, 0);
    assert.equal(afterProxy.lastAutoRelaunchAt, 0);
    assert.equal(afterProxy.lastRelaunchBlockedAt, 0);

    // Issue #97: scheduleRelaunchWithDebugPort writes sanitized credentialSwitch & clearScopePath into relaunch-job.json
    const winExe = fakeWinExe;
    const scopePath = join(root, 'AppData', 'Roaming', 'Antigravity', 'credential-user-scope');
    const res = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local') },
      credentialSwitch: { accountId: 'acct-b', expectedEmail: 'beta@example.com' },
      clearScopePath: scopePath,
      spawnProcess: () => ({ unref() {} })
    });
    const job = JSON.parse(readFileSync(res.jobPath, 'utf8'));
    assert.deepEqual(job.credentialSwitch, { accountId: 'acct-b', expectedEmail: 'beta@example.com' });
    assert.equal(job.clearScopePath, scopePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scripts/launch-macos.mjs builds live-config plans, scrubs env, uses open --env with inherited-env fallback, and redacts credentials in output (Issues #87 & #101)', async () => {
  const {
    buildMacDirectLaunchPlan,
    launchMacDirect,
    sanitizeLaunchPlanForOutput,
    parseMacLaunchCliArgs
  } = await import('../scripts/launch-macos.mjs');
  const { inspectProxyRuntime } = await import('../lib/proxy.mjs');
  const { createSettingsStore } = await import('../lib/settings.mjs');
  const root = mkdtempSync(join(tmpdir(), 'agy-mac-direct-'));
  try {
    const home = join(root, 'home');
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    const store = createSettingsStore(dataDir);
    const app = '/Applications/Antigravity.app';

    // 1. Proxy disabled preserves user external proxy and does not add --env flags
    const offPlan = buildMacDirectLaunchPlan({
      platform: 'darwin',
      home,
      dataDir,
      sourceApp: app,
      env: {
        HTTPS_PROXY: 'http://user-corp-proxy:8080',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: '--inspect',
        NODE_USE_ENV_PROXY: '1',
        ANTIGRAVITY_SIDECAR_TOKEN: 'secret-tok',
        ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000',
        GITHUB_TOKEN: 'ghp_must_not_leak'
      }
    });
    assert.equal(offPlan.command, '/usr/bin/open');
    assert.equal(offPlan.usesEnvFlags, false);
    assert.deepEqual(offPlan.primaryArgs, ['-a', app, '--args', '--remote-debugging-port=0']);
    assert.deepEqual(offPlan.fallbackArgs, ['-a', app, '--args', '--remote-debugging-port=0']);
    assert.equal(offPlan.env.HTTPS_PROXY, 'http://user-corp-proxy:8080');
    assert.equal(offPlan.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(offPlan.env.NODE_OPTIONS, undefined);
    assert.equal(offPlan.env.NODE_USE_ENV_PROXY, undefined);
    assert.equal(offPlan.env.ANTIGRAVITY_SIDECAR_TOKEN, undefined);
    assert.equal(offPlan.env.ANTIGRAVITY_LS_ADDRESS, undefined);
    assert.equal(inspectProxyRuntime(store.get(), offPlan.env).reason, 'disabled');

    // 2. Proxy enabled with credentials + proxyForceHttp1 -> dynamic settings, --env primary + fallbackArgs, sidecar match, credential redaction
    const authUrl = 'socks5h://alice:super-secret-pw@127.0.0.1:7897';
    const enabledSettings = store.set({
      proxyEnabled: true,
      proxyUrl: authUrl,
      proxyBypass: '.internal, 10.0.0.0/8',
      proxyForceHttp1: true
    });
    const onPlan = buildMacDirectLaunchPlan({
      platform: 'darwin',
      home,
      dataDir,
      sourceApp: app,
      env: {
        HTTPS_PROXY: 'http://user-corp-proxy:8080',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_USE_ENV_PROXY: '1',
        ANTIGRAVITY_SIDECAR_PORT: '9999',
        GITHUB_TOKEN: 'ghp_must_not_leak'
      },
      extraArgs: ['-psn_0_123456', '/Users/dev/project']
    });
    assert.equal(onPlan.usesEnvFlags, true);
    assert.deepEqual(onPlan.appArgs, [
      '--remote-debugging-port=0',
      '--proxy-server=socks5://127.0.0.1:7897',
      '--proxy-bypass-list=localhost;127.0.0.1;[::1];.internal;10.0.0.0/8',
      '/Users/dev/project'
    ]);
    assert.deepEqual(onPlan.fallbackArgs, [
      '-a', app, '--args',
      '--remote-debugging-port=0',
      '--proxy-server=socks5://127.0.0.1:7897',
      '--proxy-bypass-list=localhost;127.0.0.1;[::1];.internal;10.0.0.0/8',
      '/Users/dev/project'
    ]);
    assert.ok(onPlan.primaryArgs.includes('--env'));
    assert.ok(onPlan.primaryArgs.includes(`HTTPS_PROXY=${authUrl}`));
    assert.ok(onPlan.primaryArgs.includes(`https_proxy=${authUrl}`));
    assert.ok(onPlan.primaryArgs.includes('GODEBUG=http2client=0'));
    assert.ok(onPlan.primaryArgs.indexOf('--env') < onPlan.primaryArgs.indexOf('-a'));
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      assert.equal(onPlan.env[k], authUrl);
    }
    assert.equal(onPlan.env.NO_PROXY, 'localhost,127.0.0.1,::1,.internal,10.0.0.0/8');
    assert.equal(onPlan.env.no_proxy, onPlan.env.NO_PROXY);
    assert.equal(onPlan.env.GODEBUG, 'http2client=0');
    assert.equal(onPlan.env.NODE_USE_ENV_PROXY, undefined);
    assert.equal(onPlan.env.ANTIGRAVITY_SIDECAR_PORT, undefined);
    const rtOn = inspectProxyRuntime(enabledSettings, onPlan.env);
    assert.equal(rtOn.managedByPowertools, true);
    assert.equal(rtOn.reason, 'active');

    // Sanitized output never leaks proxy password or unrelated env secrets
    const safeOut = sanitizeLaunchPlanForOutput(onPlan);
    const safeJson = JSON.stringify(safeOut);
    assert.equal(safeJson.includes('super-secret-pw'), false);
    assert.equal(safeJson.includes('ghp_must_not_leak'), false);
    assert.equal(safeOut.proxy.displayUrl, 'socks5h://***@127.0.0.1:7897');
    assert.equal(safeOut.proxyEnv.HTTPS_PROXY, 'socks5h://***@127.0.0.1:7897');
    assert.ok(safeOut.primaryArgs.includes('HTTPS_PROXY=socks5h://***@127.0.0.1:7897'));

    // 3. Updating settings & disabling proxy clears plugin-managed proxy env and GODEBUG dynamically
    const h2Settings = store.set({ proxyUrl: 'http://127.0.0.1:4567', proxyForceHttp1: false });
    const updatedPlan = buildMacDirectLaunchPlan({ platform: 'darwin', home, dataDir, sourceApp: app, env: onPlan.env });
    assert.equal(updatedPlan.env.GODEBUG, undefined);
    assert.ok(updatedPlan.appArgs.includes('--proxy-server=http://127.0.0.1:4567'));
    assert.equal(inspectProxyRuntime(h2Settings, updatedPlan.env).reason, 'active');

    const disabledSettings = store.set({ proxyEnabled: false });
    const clearedPlan = buildMacDirectLaunchPlan({ platform: 'darwin', home, dataDir, sourceApp: app, env: onPlan.env });
    assert.equal(clearedPlan.usesEnvFlags, false);
    assert.equal(clearedPlan.env.HTTPS_PROXY, undefined);
    assert.equal(clearedPlan.env.AGY_POWERTOOLS_PROXY_SPEC, undefined);
    assert.equal(clearedPlan.env.GODEBUG, undefined);
    assert.equal(inspectProxyRuntime(disabledSettings, clearedPlan.env).reason, 'disabled');

    // 4. launchMacDirect: dryRun skips spawn; primary --env succeeds; older macOS --env failure falls back cleanly to inherited env
    store.set({ proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyForceHttp1: false });
    let dryCalls = 0;
    const dryRes = launchMacDirect({
      platform: 'darwin', home, dataDir, sourceApp: app, dryRun: true, env: {},
      run: () => { dryCalls++; return { status: 0 }; }
    });
    assert.equal(dryRes.ok, true);
    assert.equal(dryRes.dryRun, true);
    assert.equal(dryRes.launched, false);
    assert.equal(dryCalls, 0);

    const primaryCalls = [];
    const primaryRes = launchMacDirect({
      platform: 'darwin', home, dataDir, sourceApp: app, env: {},
      run(cmd, args, opts) { primaryCalls.push({ cmd, args, opts }); return { status: 0 }; }
    });
    assert.equal(primaryRes.ok, true);
    assert.equal(primaryRes.usedFallback, false);
    assert.equal(primaryCalls.length, 1);
    assert.equal(primaryCalls[0].cmd, '/usr/bin/open');
    assert.ok(primaryCalls[0].args.includes('--env'));

    const fallbackCalls = [];
    const fallbackRes = launchMacDirect({
      platform: 'darwin', home, dataDir, sourceApp: app, env: {},
      run(cmd, args, opts) {
        fallbackCalls.push({ cmd, args, opts });
        if (args.includes('--env')) return { status: 1, stderr: 'unrecognized option --env' };
        return { status: 0 };
      }
    });
    assert.equal(fallbackRes.ok, true);
    assert.equal(fallbackRes.usedFallback, true);
    assert.equal(fallbackCalls.length, 2);
    assert.equal(fallbackCalls[1].cmd, '/usr/bin/open');
    assert.equal(fallbackCalls[1].args.includes('--env'), false);
    assert.equal(fallbackCalls[1].opts.env.HTTPS_PROXY, 'http://127.0.0.1:7897');

    // 5. Platform, missing app, recursive wrapper guard, and CLI arg parsing
    assert.throws(() => buildMacDirectLaunchPlan({ platform: 'linux', home, dataDir, sourceApp: app }), /requires macOS/);
    assert.throws(() => buildMacDirectLaunchPlan({ platform: 'darwin', home, dataDir, resolveApp: () => '' }), /not found/);
    assert.throws(
      () => buildMacDirectLaunchPlan({ platform: 'darwin', home, dataDir, resolveApp: () => join(home, 'Applications', 'Antigravity (Powertools).app') }),
      /not found/
    );
    assert.throws(
      () => launchMacDirect({ platform: 'darwin', home, dataDir, sourceApp: app, env: {}, run: () => ({ status: 1, stderr: 'LSOpenURLsWithRole failed' }) }),
      /LSOpenURLsWithRole failed/
    );

    const parsedCli = parseMacLaunchCliArgs(['--dry-run', '--json', '--data-dir', '/tmp/d', '-psn_0_999', '--', '--verbose', '/tmp/proj']);
    assert.deepEqual(parsedCli, {
      dryRun: true,
      json: true,
      newInstance: false,
      help: false,
      dataDir: '/tmp/d',
      extraArgs: ['--verbose', '/tmp/proj']
    });
    assert.throws(() => parseMacLaunchCliArgs(['--unknown-flag']), /Unknown option/);

    // Direct CLI --help invocation works via main-module guard
    const cliHelp = spawnSync(process.execPath, [join('scripts', 'launch-macos.mjs'), '--help'], { encoding: 'utf8' });
    assert.equal(cliHelp.status, 0, cliHelp.stderr);
    assert.match(cliHelp.stdout, /Usage: node launch-macos\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('macOS direct launcher skips the Electron Helper and repairs an existing wrapper (Issue #126)', async () => {
  const { createMacDirectLauncher } = await import('../lib/launcher.mjs');
  const home = mkdtempSync(join(tmpdir(), 'agy-mac-launcher-helper-'));
  try {
    const dataDir = join(home, 'data');
    const sourceApp = join(home, 'Applications', "Antigravity's Build.app");
    const helper = join(sourceApp, 'Contents', 'Frameworks', 'Antigravity Helper.app', 'Contents', 'MacOS', 'Antigravity Helper');
    mkdirSync(sourceApp, { recursive: true });
    const options = { home, dataDir, platform: 'darwin', sandbox: true, env: {}, execPath: helper, macSourceApp: sourceApp };
    const created = createMacDirectLauncher({ ...options, nodePath: helper });
    const launcher = join(created.appPath, 'Contents', 'MacOS', 'launcher');
    const fixed = readFileSync(launcher, 'utf8');
    assert.match(fixed, /^RECORDED_NODE=''$/m);

    const escapedHelper = helper.replaceAll("'", "'\\''");
    const legacy = fixed.replace("RECORDED_NODE=''", `RECORDED_NODE='${escapedHelper}'`);
    writeFileSync(launcher, legacy);
    const repaired = configureLaunchers(options);
    assert.deepEqual(repaired.updated, [created.appPath]);
    assert.equal(repaired.preservedMacDirectLauncher, true);
    assert.equal(readFileSync(launcher, 'utf8'), fixed);
    assert.deepEqual(configureLaunchers(options).updated, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('macOS opt-in direct launcher .app API creates, inspects, reveals, preserves/refreshes icon on upgrade, and cleans up on remove/uninstall (Issues #87 & #101)', async () => {
  const {
    MAC_DIRECT_LAUNCHER_BUNDLE_ID,
    macDirectLauncherPath,
    inspectMacDirectLauncher,
    createMacDirectLauncher,
    removeMacDirectLauncher,
    revealMacDirectLauncher
  } = await import('../lib/launcher.mjs');
  const root = mkdtempSync(join(tmpdir(), 'agy-mac-optin-app-'));
  try {
    const home = join(root, 'home');
    const dataDir = join(root, 'data');
    const pluginDir = join(home, '.gemini', 'config', 'plugins', 'agy-powertools');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(pluginDir, 'scripts'), { recursive: true });

    // Non-darwin checks
    const winInspect = inspectMacDirectLauncher({ home, dataDir, platform: 'win32' });
    assert.equal(winInspect.supported, false);
    assert.equal(winInspect.exists, false);
    assert.throws(() => createMacDirectLauncher({ home, dataDir, platform: 'win32' }), /only supported on macOS/);
    assert.throws(() => removeMacDirectLauncher({ home, dataDir, platform: 'win32' }), /only supported on macOS/);
    assert.equal(revealMacDirectLauncher({ home, platform: 'win32' }).reason, 'not-darwin');

    // Missing Antigravity.app fails clearly
    assert.throws(
      () => createMacDirectLauncher({ home, dataDir, platform: 'darwin', sandbox: true, env: {}, execPath: '' }),
      /not found/
    );

    // Seed fake Antigravity.app with Info.plist and .icns icon
    const sourceApp = join(home, 'Applications', 'Antigravity.app');
    const sourceRes = join(sourceApp, 'Contents', 'Resources');
    mkdirSync(sourceRes, { recursive: true });
    writeFileSync(join(sourceApp, 'Contents', 'Info.plist'), '<plist><dict><key>CFBundleIconFile</key><string>Antigravity</string></dict></plist>', 'utf8');
    const sourceIcon = join(sourceRes, 'Antigravity.icns');
    writeFileSync(sourceIcon, Buffer.from('ICNS_V1_DATA'));

    // Seed pre-existing fields in launcher-state.json to verify preservation
    const stateFile = join(dataDir, 'launcher-state.json');
    writeFileSync(stateFile, JSON.stringify({ shortcuts: ['keep-me'], desktopEntries: [], customFlag: 42 }), 'utf8');

    const expectedAppPath = macDirectLauncherPath({ home });
    assert.equal(expectedAppPath, join(home, 'Applications', 'Antigravity (Powertools).app'));

    const before = inspectMacDirectLauncher({ home, dataDir, platform: 'darwin', sandbox: true, env: {}, execPath: '' });
    assert.equal(before.supported, true);
    assert.equal(before.exists, false);
    assert.equal(before.optIn, false);
    assert.equal(before.sourceApp, sourceApp);
    assert.equal(before.iconUpToDate, false);
    assert.equal(before.cliCommand, 'node "$HOME/.gemini/config/plugins/agy-powertools/scripts/launch-macos.mjs"');

    // Create opt-in launcher .app
    const createCmds = [];
    const created = createMacDirectLauncher({
      home,
      dataDir,
      pluginDir,
      nodePath: '/opt/custom/bin/node',
      platform: 'darwin',
      sandbox: true,
      env: {},
      execPath: '',
      runCommand: (cmd, args) => { createCmds.push({ cmd, args }); return { status: 0 }; }
    });
    assert.equal(created.ok, true);
    assert.equal(created.exists, true);
    assert.equal(created.optIn, true);
    assert.equal(created.appPath, expectedAppPath);
    assert.equal(created.iconConfigured, true);
    assert.equal(created.iconUpToDate, true);

    // Verify Info.plist, LSUIElement, marker, icon.icns, and shell launcher script
    const plist = readFileSync(join(expectedAppPath, 'Contents', 'Info.plist'), 'utf8');
    assert.ok(plist.includes('<key>CFBundleExecutable</key>\n  <string>launcher</string>'));
    assert.ok(plist.includes(`<string>${MAC_DIRECT_LAUNCHER_BUNDLE_ID}</string>`));
    assert.ok(plist.includes('<key>CFBundleName</key>\n  <string>Antigravity (Powertools)</string>'));
    assert.ok(plist.includes('<key>CFBundleDisplayName</key>\n  <string>Antigravity (Powertools)</string>'));
    assert.ok(plist.includes('<key>CFBundlePackageType</key>\n  <string>APPL</string>'));
    assert.ok(plist.includes('<key>CFBundleIconFile</key>\n  <string>icon</string>'));
    assert.ok(plist.includes('<key>LSUIElement</key>\n  <true/>'));

    const marker = readFileSync(join(expectedAppPath, 'Contents', 'Resources', '.agy-powertools-launcher'), 'utf8').trim();
    assert.equal(marker, MAC_DIRECT_LAUNCHER_BUNDLE_ID);
    assert.deepEqual(readFileSync(join(expectedAppPath, 'Contents', 'Resources', 'icon.icns')), Buffer.from('ICNS_V1_DATA'));

    const launcherScript = readFileSync(join(expectedAppPath, 'Contents', 'MacOS', 'launcher'), 'utf8');
    assert.ok(launcherScript.startsWith('#!/bin/sh\n'));
    assert.equal(launcherScript.includes('\r\n'), false);
    assert.ok(launcherScript.includes("RECORDED_NODE='/opt/custom/bin/node'"));
    const idxRecorded = launcherScript.indexOf('"$RECORDED_NODE"');
    const idxAgyNode = launcherScript.indexOf('"$HOME/Library/Application Support/Antigravity/bin/agy-node"');
    const idxBrew = launcherScript.indexOf('"/opt/homebrew/bin/node"');
    const idxUsrLocal = launcherScript.indexOf('"/usr/local/bin/node"');
    const idxCmdV = launcherScript.indexOf('command -v node');
    assert.ok(idxRecorded > 0 && idxRecorded < idxAgyNode && idxAgyNode < idxBrew && idxBrew < idxUsrLocal && idxUsrLocal < idxCmdV);
    assert.ok(launcherScript.includes('exec "$NODE_BIN" "$LAUNCH_SCRIPT" "$@"'));
    assert.ok(launcherScript.includes('exec /usr/bin/open -a "$SOURCE_APP"'));
    if (process.platform !== 'win32') {
      const shCheck = spawnSync('sh', ['-n', join(expectedAppPath, 'Contents', 'MacOS', 'launcher')], { encoding: 'utf8' });
      assert.equal(shCheck.status, 0, shCheck.stderr);
    }

    // Verify lsregister -f and mdimport were invoked
    assert.equal(createCmds.some(c => c.cmd.endsWith('lsregister') && c.args[0] === '-f' && c.args[1] === expectedAppPath), true);
    assert.equal(createCmds.some(c => c.cmd === '/usr/bin/mdimport' && c.args[0] === expectedAppPath), true);

    // Verify launcher-state.json preserved unrelated fields and recorded opt-in + icon signature
    const stateAfterCreate = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(stateAfterCreate.macDirectLauncherOptIn, true);
    assert.equal(stateAfterCreate.macDirectLauncherAppPath, expectedAppPath);
    assert.ok(stateAfterCreate.macDirectLauncherIconSig);
    assert.deepEqual(stateAfterCreate.shortcuts, ['keep-me']);
    assert.equal(stateAfterCreate.customFlag, 42);

    const inspected = inspectMacDirectLauncher({ home, dataDir, platform: 'darwin', sandbox: true, env: {}, execPath: '' });
    assert.equal(inspected.exists, true);
    assert.equal(inspected.optIn, true);
    assert.equal(inspected.iconUpToDate, true);

    // Reveal calls /usr/bin/open -R
    const revealCmds = [];
    const revealed = revealMacDirectLauncher({
      home,
      platform: 'darwin',
      runCommand: (cmd, args) => { revealCmds.push({ cmd, args }); return { status: 0 }; }
    });
    assert.equal(revealed.ok, true);
    assert.equal(revealed.revealed, true);
    assert.deepEqual(revealCmds, [{ cmd: '/usr/bin/open', args: ['-R', expectedAppPath] }]);

    // configureLaunchers preserves opted-in .app without refreshing when icon unchanged
    const cfgCmds1 = [];
    const cfg1 = configureLaunchers({
      home, dataDir, platform: 'darwin', sandbox: true, env: {}, execPath: '',
      runCommand: (cmd, args) => { cfgCmds1.push({ cmd, args }); return { status: 0 }; }
    });
    assert.deepEqual(cfg1.removedLegacyMacApps, []);
    assert.equal(cfg1.preservedMacDirectLauncher, true);
    assert.equal(cfg1.iconRefreshed, false);
    assert.equal(existsSync(expectedAppPath), true);
    assert.equal(cfgCmds1.length, 0);

    // Updating Antigravity.app icon causes inspect -> iconUpToDate: false and configureLaunchers -> silent icon refresh + lsregister -f
    writeFileSync(sourceIcon, Buffer.from('ICNS_V2_UPDATED_LONGER_PAYLOAD'));
    const future = new Date(Date.now() + 5000);
    utimesSync(sourceIcon, future, future);
    assert.equal(inspectMacDirectLauncher({ home, dataDir, platform: 'darwin', sandbox: true, env: {}, execPath: '' }).iconUpToDate, false);

    const cfgCmds2 = [];
    const cfg2 = configureLaunchers({
      home, dataDir, platform: 'darwin', sandbox: true, env: {}, execPath: '',
      runCommand: (cmd, args) => { cfgCmds2.push({ cmd, args }); return { status: 0 }; }
    });
    assert.equal(cfg2.preservedMacDirectLauncher, true);
    assert.equal(cfg2.iconRefreshed, true);
    assert.deepEqual(readFileSync(join(expectedAppPath, 'Contents', 'Resources', 'icon.icns')), Buffer.from('ICNS_V2_UPDATED_LONGER_PAYLOAD'));
    assert.equal(cfgCmds2.some(c => c.cmd.endsWith('lsregister') && c.args[0] === '-f' && c.args[1] === expectedAppPath), true);
    assert.equal(inspectMacDirectLauncher({ home, dataDir, platform: 'darwin', sandbox: true, env: {}, execPath: '' }).iconUpToDate, true);

    // removeMacDirectLauncher runs lsregister -u, deletes .app, clears opt-in while preserving other state
    const removeCmds = [];
    const removed = removeMacDirectLauncher({
      home, dataDir, platform: 'darwin', sandbox: true,
      runCommand: (cmd, args) => { removeCmds.push({ cmd, args }); return { status: 0 }; }
    });
    assert.equal(removed.ok, true);
    assert.equal(removed.removed, true);
    assert.equal(existsSync(expectedAppPath), false);
    assert.equal(removeCmds.some(c => c.cmd.endsWith('lsregister') && c.args[0] === '-u' && c.args[1] === expectedAppPath), true);
    const stateAfterRemove = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(stateAfterRemove.macDirectLauncherOptIn, false);
    assert.equal(stateAfterRemove.customFlag, 42);
    assert.equal(revealMacDirectLauncher({ home, platform: 'darwin', runCommand: () => assert.fail('must not call open') }).reason, 'not-found');

    // Fail-safe: removeMacDirectLauncher refuses to delete an unrecognized app bundle lacking our marker/bundleId
    mkdirSync(join(expectedAppPath, 'Contents'), { recursive: true });
    writeFileSync(join(expectedAppPath, 'Contents', 'Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>com.other.app</string></dict></plist>', 'utf8');
    assert.throws(
      () => removeMacDirectLauncher({ home, dataDir, platform: 'darwin', sandbox: true }),
      /unrecognized app bundle/
    );
    assert.equal(existsSync(expectedAppPath), true);
    rmSync(expectedAppPath, { recursive: true, force: true });

    // Uninstall via restoreLaunchers ALWAYS removes opted-in .app (running lsregister -u first) and clears launcher-state.json
    createMacDirectLauncher({ home, dataDir, pluginDir, platform: 'darwin', sandbox: true, env: {}, execPath: '', runCommand: () => ({ status: 0 }) });
    assert.equal(existsSync(expectedAppPath), true);
    const restoreCmds = [];
    const restored = restoreLaunchers({
      home, dataDir, platform: 'darwin', sandbox: true,
      runCommand: (cmd, args) => { restoreCmds.push({ cmd, args }); return { status: 0 }; }
    });
    assert.deepEqual(restored.restored, [expectedAppPath]);
    assert.equal(existsSync(expectedAppPath), false);
    assert.equal(existsSync(stateFile), false);
    assert.equal(restoreCmds.some(c => c.cmd.endsWith('lsregister') && c.args[0] === '-u' && c.args[1] === expectedAppPath), true);
    const afterUninstall = inspectMacDirectLauncher({ home, dataDir, platform: 'darwin', sandbox: true, env: {}, execPath: '' });
    assert.equal(afterUninstall.exists, false);
    assert.equal(afterUninstall.optIn, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifyRelaunchStarted fails immediately on ack.state === "failed" or ack.ok === false, cleans stale job, and clears lastRelaunchAt (PR #102)', async () => {
  const { verifyRelaunchStarted } = await import('../lib/launcher.mjs');
  const root = mkdtempSync(join(tmpdir(), 'agy-verify-failed-ack-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    const stateFile = join(dataDir, 'relaunch-state.json');
    const jobPath = join(dataDir, 'relaunch-job.json');
    const ackPath = join(dataDir, 'relaunch-ack.json');
    const nonce1 = 'aaaa1111-bbbb-2222-cccc-3333dddd4444';

    // 1. ack.state === 'failed' with explicit reason fails immediately, deletes stale job, clears lastRelaunchAt without setting lastRelaunchBlockedAt
    writeFileSync(stateFile, JSON.stringify({ lastRelaunchAt: 1_760_000_000_000, keepField: 'ok' }));
    writeFileSync(jobPath, '{"format":1}');
    writeFileSync(ackPath, JSON.stringify({ nonce: nonce1, pid: 77111, state: 'failed', reason: 'switch-cancelled', at: Date.now() }));
    const res1 = await verifyRelaunchStarted(
      { scheduled: true, jobPath, ackPath, nonce: nonce1, target: 'C:\\Antigravity.exe' },
      { dataDir, timeoutMs: 2000, pollIntervalMs: 20 }
    );
    assert.equal(res1.scheduled, false);
    assert.equal(res1.confirmed, false);
    assert.equal(res1.manualRestartRequired, true);
    assert.equal(res1.reason, 'switch-cancelled');
    assert.equal(res1.workerPid, 77111);
    assert.equal(existsSync(jobPath), false);
    const saved1 = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(saved1.lastRelaunchAt, 0);
    assert.equal(saved1.keepField, 'ok');
    assert.equal(saved1.lastRelaunchBlockedAt, undefined);

    // 2. ack.ok === false (e.g. elevated-process-running) also fails immediately
    const nonce2 = 'bbbb2222-cccc-3333-dddd-4444eeee5555';
    writeFileSync(stateFile, JSON.stringify({ lastRelaunchAt: 1_760_000_100_000 }));
    writeFileSync(jobPath, '{"format":1}');
    writeFileSync(ackPath, JSON.stringify({ nonce: nonce2, pid: 77222, state: 'launched', ok: false, reason: 'elevated-process-running', at: Date.now() }));
    const res2 = await verifyRelaunchStarted(
      { scheduled: true, jobPath, ackPath, nonce: nonce2, target: 'C:\\Antigravity.exe' },
      { dataDir, timeoutMs: 2000, pollIntervalMs: 20 }
    );
    assert.equal(res2.scheduled, false);
    assert.equal(res2.confirmed, false);
    assert.equal(res2.manualRestartRequired, true);
    assert.equal(res2.reason, 'elevated-process-running');
    assert.equal(existsSync(jobPath), false);
    assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).lastRelaunchAt, 0);

    // 3. ack.state === 'failed' without reason defaults to 'relaunch-failed'
    const nonce3 = 'cccc3333-dddd-4444-eeee-5555ffff6666';
    writeFileSync(jobPath, '{"format":1}');
    writeFileSync(ackPath, JSON.stringify({ nonce: nonce3, pid: 77333, state: 'failed', at: Date.now() }));
    const res3 = await verifyRelaunchStarted(
      { scheduled: true, jobPath, ackPath, nonce: nonce3, target: 'C:\\Antigravity.exe' },
      { dataDir, timeoutMs: 2000, pollIntervalMs: 20 }
    );
    assert.equal(res3.scheduled, false);
    assert.equal(res3.confirmed, false);
    assert.equal(res3.manualRestartRequired, true);
    assert.equal(res3.reason, 'relaunch-failed');
    assert.equal(existsSync(jobPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scheduleRelaunchWithDebugPort forwards expectedHash, switchId, and canonical profileDir into relaunch-job.json passing validateRelaunchJob (PR #102)', async () => {
  const { validateRelaunchJob } = await import('../scripts/relaunch-worker.mjs');
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-pr102-'));
  try {
    const dataDir = join(root, 'data');
    const profileDir = join(root, 'AppData', 'Roaming', 'Antigravity');
    const appDir = join(root, 'AppData', 'Local', 'Programs', 'antigravity');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });
    const winExe = join(appDir, 'Antigravity.exe');
    writeFileSync(winExe, '');

    const switchId = '11111111-2222-3333-4444-555555555555';
    const expectedHash = 'a1b2c3d4e5f6';
    const res1 = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local'), APPDATA: join(root, 'AppData', 'Roaming') },
      onboardingSync: { email: 'bob@example.com', isGcpTos: true },
      credentialSwitch: {
        accountId: 'acct-bob',
        expectedEmail: 'bob@example.com',
        expectedHash,
        switchId
      },
      profileDir,
      clearScopePath: join(profileDir, 'credential-user-scope'),
      spawnProcess() { return { unref() {} }; }
    });
    assert.equal(res1.scheduled, true);
    const job1 = JSON.parse(readFileSync(res1.jobPath, 'utf8'));
    const canonicalProfile = realpathSync.native ? realpathSync.native(profileDir) : realpathSync(profileDir);
    assert.deepEqual(job1.credentialSwitch, {
      accountId: 'acct-bob',
      expectedEmail: 'bob@example.com',
      expectedHash,
      switchId
    });
    assert.equal(job1.profileDir, canonicalProfile);
    assert.equal(job1.onboardingSync.appStoragePath, join(canonicalProfile, 'app_storage.json'));
    assert.equal(job1.clearScopePath, join(canonicalProfile, 'credential-user-scope'));
    assert.deepEqual(validateRelaunchJob(job1, { jobPath: res1.jobPath }), { valid: true });

    // Omitting explicit profileDir on native Windows with credentialSwitch derives canonical antigravityUserDataDir
    const res2 = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local'), APPDATA: join(root, 'AppData', 'Roaming') },
      onboardingSync: { email: 'bob@example.com', isGcpTos: false },
      credentialSwitch: {
        accountId: 'acct-bob',
        expectedEmail: 'bob@example.com',
        expectedHash,
        switchId
      },
      spawnProcess() { return { unref() {} }; }
    });
    const job2 = JSON.parse(readFileSync(res2.jobPath, 'utf8'));
    assert.equal(job2.profileDir, canonicalProfile);
    assert.equal(job2.onboardingSync.appStoragePath, join(canonicalProfile, 'app_storage.json'));
    assert.deepEqual(validateRelaunchJob(job2, { jobPath: res2.jobPath }), { valid: true });

    // Invalid expectedHash or switchId fails closed (omits credentialSwitch instead of downgrading checks)
    const resBad = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local'), APPDATA: join(root, 'AppData', 'Roaming') },
      credentialSwitch: {
        accountId: 'acct-bob',
        expectedEmail: 'bob@example.com',
        expectedHash: 'not-valid-hash!',
        switchId: 'bad-uuid'
      },
      spawnProcess() { return { unref() {} }; }
    });
    const jobBad = JSON.parse(readFileSync(resBad.jobPath, 'utf8'));
    assert.equal(jobBad.credentialSwitch, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scheduleRelaunchWithDebugPort keeps native Windows jobs free of wslMode/--wsl-distro and equips WSL2 jobs with wslMode, --wsl-distro, and %TEMP% worker copy (Issue #113)', async () => {
  const { validateRelaunchJob } = await import('../scripts/relaunch-worker.mjs');
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-113-'));
  try {
    const dataDir = join(root, 'data');
    const appDir = join(root, 'AppData', 'Local', 'Programs', 'antigravity');
    const winTempDir = join(root, 'win-temp');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });
    mkdirSync(winTempDir, { recursive: true });
    const winExe = join(appDir, 'Antigravity.exe');
    writeFileSync(winExe, '');

    // Native Windows omits wslMode and --wsl-distro even if WSL_DISTRO_NAME happens to exist in env
    const winRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local'), WSL_DISTRO_NAME: 'Ubuntu-24.04' },
      spawnProcess() { return { unref() {} }; }
    });
    const winJob = JSON.parse(readFileSync(winRes.jobPath, 'utf8'));
    assert.equal(winJob.wslMode, undefined);
    assert.deepEqual(winJob.args, ['--remote-debugging-port=0']);
    assert.deepEqual(validateRelaunchJob(winJob, { jobPath: winRes.jobPath }), { valid: true });

    // WSL2 reads saved proxy settings.json, adds --wsl-distro & wslMode: true, copies worker to %TEMP%, and sets cwd
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:7897',
      proxyBypass: '10.0.0.0/8',
      proxyForceHttp1: false
    }));
    let wslSpawn = null;
    const wslRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
      wsl: true,
      resolveWslExe: () => ({ winPath: 'C:\\Users\\dev\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe', wslPath: '' }),
      resolveWslTemp: () => ({ winPath: 'C:\\Users\\dev\\AppData\\Local\\Temp', wslPath: winTempDir }),
      resolveWslNode: () => ({ command: '/mnt/c/Program Files/nodejs/node.exe', extraEnv: {} }),
      spawnProcess(cmd, args, opts) { wslSpawn = { cmd, args, opts }; return { unref() {} }; }
    });
    assert.equal(wslRes.proxyActive, true);
    assert.equal(wslSpawn.args[0], 'C:\\Users\\dev\\AppData\\Local\\Temp\\agy-powertools-relaunch-worker.mjs');
    assert.equal(wslSpawn.opts.cwd, winTempDir);
    const wslJob = JSON.parse(readFileSync(join(winTempDir, 'agy-powertools-relaunch-job.json'), 'utf8'));
    assert.equal(wslJob.wslMode, true);
    assert.equal(wslJob.forceHttp1, false);
    assert.equal(wslJob.proxyEnv.GODEBUG, undefined);
    assert.deepEqual(wslJob.args, [
      '--remote-debugging-port=0',
      '--wsl-distro=Ubuntu-24.04',
      '--proxy-server=http://127.0.0.1:7897',
      '--proxy-bypass-list=localhost;127.0.0.1;[::1];10.0.0.0/8'
    ]);
    assert.deepEqual(validateRelaunchJob(wslJob, { exists: () => true }), { valid: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
