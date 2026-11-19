import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, unlinkSync, chmodSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEBUG_FLAG = '--remote-debugging-port=0';
const HAS_DEBUG_RE = /(?:^|\s)--remote-debugging-port(?:=\S+|\s+\d+|\b)/;
const STRIP_DEBUG_RE = /(?:^|\s+)--remote-debugging-port=0(?=\s|$)/g;
const PROMPT_COOLDOWN_MS = 10 * 60 * 1000;
const FRESH_INSTALL_GRACE_MS = 120 * 1000;

export function injectDebugArg(args = '') {
  const trimmed = String(args || '').trim();
  if (HAS_DEBUG_RE.test(trimmed)) return trimmed;
  return trimmed ? `${trimmed} ${DEBUG_FLAG}` : DEBUG_FLAG;
}

export function removeDebugArg(args = '') {
  return String(args || '').replace(STRIP_DEBUG_RE, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function patchDesktopEntry(content) {
  let changed = false;
  const lines = String(content || '').split(/\r?\n/).map(line => {
    if (!/^Exec\s*=/.test(line) || HAS_DEBUG_RE.test(line)) return line;
    const eq = line.indexOf('=');
    const prefix = line.slice(0, eq + 1);
    const cmd = line.slice(eq + 1).trim();
    if (!/antigravity/i.test(cmd)) return line;
    const match = cmd.match(/^("[^"]+"|\S+)([\s\S]*)$/);
    if (!match) return line;
    changed = true;
    const rest = match[2].trim();
    return `${prefix}${match[1]} ${DEBUG_FLAG}${rest ? ` ${rest}` : ''}`;
  });
  return { content: lines.join('\n'), changed };
}

export function unpatchDesktopEntry(content) {
  let changed = false;
  const lines = String(content || '').split(/\r?\n/).map(line => {
    if (!/^Exec\s*=/.test(line) || !line.includes(DEBUG_FLAG)) return line;
    const next = line.replace(STRIP_DEBUG_RE, ' ').replace(/^(Exec\s*=\s*)/, '$1').replace(/\s{2,}/g, ' ').trimEnd();
    if (next !== line) changed = true;
    return next;
  });
  return { content: lines.join('\n'), changed };
}

function readJson(path, fallback = {}) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function writeJson(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  } catch {}
}

function defaultRunPowerShell(script, env) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 8000,
    env
  });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || '').trim();
}

function windowsShortcutCandidates({ home, env, sandbox, runPowerShell }) {
  const appData = sandbox ? join(home, 'AppData', 'Roaming') : (env.APPDATA || join(home, 'AppData', 'Roaming'));
  const dirs = new Set([
    join(home, 'Desktop'),
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')
  ]);
  if (!sandbox) {
    const out = runPowerShell('[Console]::OutputEncoding=[Text.Encoding]::UTF8; @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs")) | ConvertTo-Json -Compress', env);
    try {
      for (const folder of JSON.parse(out || '[]')) if (typeof folder === 'string' && folder) dirs.add(folder);
    } catch {}
  }
  const files = new Set();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isFile() && /\.lnk$/i.test(entry.name)) files.add(full);
        else if (entry.isDirectory() && /^antigravity$/i.test(entry.name)) {
          for (const sub of readdirSync(full, { withFileTypes: true })) {
            if (sub.isFile() && /\.lnk$/i.test(sub.name)) files.add(join(full, sub.name));
          }
        }
      }
    } catch {}
  }
  return [...files];
}

export function configureLaunchers({
  home = homedir(),
  dataDir,
  platform = process.platform,
  env = process.env,
  sandbox = resolve(home) !== resolve(homedir()),
  systemApplicationsDir = sandbox ? '' : '/usr/share/applications',
  runPowerShell = defaultRunPowerShell
} = {}) {
  const stateFile = dataDir ? join(dataDir, 'launcher-state.json') : '';
  const state = stateFile ? readJson(stateFile, { shortcuts: [], desktopEntries: [], macApps: [] }) : { shortcuts: [], desktopEntries: [], macApps: [] };
  const updated = [];

  if (platform === 'win32') {
    const candidates = windowsShortcutCandidates({ home, env, sandbox, runPowerShell });
    if (candidates.length) {
      const psEnv = { ...env, AGY_LNK_LIST: JSON.stringify(candidates) };
      const script = [
        '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
        '$paths = $env:AGY_LNK_LIST | ConvertFrom-Json',
        '$ws = New-Object -ComObject WScript.Shell',
        '$changed = @()',
        'foreach ($p in $paths) {',
        '  try {',
        '    if (-not (Test-Path -LiteralPath $p)) { continue }',
        '    $s = $ws.CreateShortcut($p)',
        '    $leaf = Split-Path -Leaf $s.TargetPath',
        '    if ($leaf -match "^antigravity\\.exe$") {',
        '      $args = [string]$s.Arguments',
        '      if ($args -notmatch "(?:^|\\s)--remote-debugging-port(?:=\\S+|\\s+\\d+|\\b)") {',
        '        $s.Arguments = ($args + " --remote-debugging-port=0").Trim()',
        '        $s.Save()',
        '        $changed += $p',
        '      }',
        '    }',
        '  } catch {}',
        '}',
        'ConvertTo-Json -Compress @($changed)'
      ].join('\n');
      const out = runPowerShell(script, psEnv);
      try {
        for (const item of JSON.parse(out || '[]')) {
          if (typeof item === 'string' && item) {
            updated.push(item);
            if (!state.shortcuts.includes(item)) state.shortcuts.push(item);
          }
        }
      } catch {}
    }
  } else if (platform === 'linux') {
    const appsDir = join(sandbox ? join(home, '.local', 'share') : (env.XDG_DATA_HOME || join(home, '.local', 'share')), 'applications');
    const userDesktop = join(appsDir, 'antigravity.desktop');
    const systemDesktop = systemApplicationsDir ? join(systemApplicationsDir, 'antigravity.desktop') : '';
    if (existsSync(userDesktop)) {
      const patched = patchDesktopEntry(readFileSync(userDesktop, 'utf8'));
      if (patched.changed) {
        writeFileSync(userDesktop, patched.content, 'utf8');
        updated.push(userDesktop);
        if (!state.desktopEntries.some(e => e.path === userDesktop)) state.desktopEntries.push({ path: userDesktop, mode: 'patched' });
      }
    } else if (systemDesktop && existsSync(systemDesktop)) {
      const patched = patchDesktopEntry(readFileSync(systemDesktop, 'utf8'));
      if (patched.changed) {
        mkdirSync(appsDir, { recursive: true });
        writeFileSync(userDesktop, patched.content, 'utf8');
        updated.push(userDesktop);
        state.desktopEntries = [...state.desktopEntries.filter(e => e.path !== userDesktop), { path: userDesktop, mode: 'created' }];
      }
    }
  } else if (platform === 'darwin') {
    const appDir = join(home, 'Applications', 'Antigravity (Powertools).app');
    const macosDir = join(appDir, 'Contents', 'MacOS');
    const plistPath = join(appDir, 'Contents', 'Info.plist');
    const launcherPath = join(macosDir, 'launcher');
    mkdirSync(macosDir, { recursive: true });
    writeFileSync(plistPath, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      '  <key>CFBundleExecutable</key><string>launcher</string>',
      '  <key>CFBundleIdentifier</key><string>com.whitebr1ck.agy-powertools.launcher</string>',
      '  <key>CFBundleName</key><string>Antigravity (Powertools)</string>',
      '  <key>CFBundlePackageType</key><string>APPL</string>',
      '</dict></plist>'
    ].join('\n'), 'utf8');
    writeFileSync(launcherPath, '#!/bin/sh\nexec open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0 "$@"\n', { mode: 0o755 });
    try { chmodSync(launcherPath, 0o755); } catch {}
    updated.push(appDir);
    if (!state.macApps.includes(appDir)) state.macApps.push(appDir);
  }

  if (stateFile && (updated.length || existsSync(stateFile))) writeJson(stateFile, state);
  return { updated };
}

export function restoreLaunchers({
  home = homedir(),
  dataDir,
  platform = process.platform,
  env = process.env,
  sandbox = resolve(home) !== resolve(homedir()),
  runPowerShell = defaultRunPowerShell
} = {}) {
  const stateFile = dataDir ? join(dataDir, 'launcher-state.json') : '';
  const state = stateFile ? readJson(stateFile, { shortcuts: [], desktopEntries: [], macApps: [] }) : { shortcuts: [], desktopEntries: [], macApps: [] };
  const restored = [];

  if (platform === 'win32') {
    const candidates = [...new Set([...(state.shortcuts || []), ...windowsShortcutCandidates({ home, env, sandbox, runPowerShell })])];
    if (candidates.length) {
      const psEnv = { ...env, AGY_LNK_LIST: JSON.stringify(candidates) };
      const script = [
        '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
        '$paths = $env:AGY_LNK_LIST | ConvertFrom-Json',
        '$ws = New-Object -ComObject WScript.Shell',
        '$changed = @()',
        'foreach ($p in $paths) {',
        '  try {',
        '    if (-not (Test-Path -LiteralPath $p)) { continue }',
        '    $s = $ws.CreateShortcut($p)',
        '    $leaf = Split-Path -Leaf $s.TargetPath',
        '    if ($leaf -match "^antigravity\\.exe$" -and ([string]$s.Arguments) -match "--remote-debugging-port=0") {',
        '      $s.Arguments = (([string]$s.Arguments) -replace "(?:^|\\s+)--remote-debugging-port=0(?=\\s|$)", " ").Trim()',
        '      $s.Save()',
        '      $changed += $p',
        '    }',
        '  } catch {}',
        '}',
        'ConvertTo-Json -Compress @($changed)'
      ].join('\n');
      const out = runPowerShell(script, psEnv);
      try {
        for (const item of JSON.parse(out || '[]')) if (typeof item === 'string' && item) restored.push(item);
      } catch {}
    }
  } else if (platform === 'linux') {
    const fallbackPath = join(sandbox ? join(home, '.local', 'share') : (env.XDG_DATA_HOME || join(home, '.local', 'share')), 'applications', 'antigravity.desktop');
    const entries = state.desktopEntries?.length ? state.desktopEntries : [{ path: fallbackPath, mode: 'patched' }];
    for (const entry of entries) {
      if (!entry?.path || !existsSync(entry.path)) continue;
      if (entry.mode === 'created' && resolve(entry.path).startsWith(resolve(home))) {
        try { unlinkSync(entry.path); restored.push(entry.path); } catch {}
      } else {
        const unpatched = unpatchDesktopEntry(readFileSync(entry.path, 'utf8'));
        if (unpatched.changed) {
          writeFileSync(entry.path, unpatched.content, 'utf8');
          restored.push(entry.path);
        }
      }
    }
  } else if (platform === 'darwin') {
    const targets = state.macApps?.length ? state.macApps : [join(home, 'Applications', 'Antigravity (Powertools).app')];
    for (const appDir of targets) {
      if (appDir && existsSync(appDir) && resolve(appDir).startsWith(resolve(home))) {
        try { rmSync(appDir, { recursive: true, force: true }); restored.push(appDir); } catch {}
      }
    }
  }

  if (stateFile && existsSync(stateFile)) {
    try { unlinkSync(stateFile); } catch {}
  }
  return { restored };
}

export function resolveAntigravityExecutable({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  const agentExe = env.ANTIGRAVITY_AGENTAPI_EXE || '';
  if (platform === 'win32') {
    if (agentExe) {
      const candidate = join(dirname(dirname(dirname(agentExe))), 'Antigravity.exe');
      if (existsSync(candidate)) return candidate;
    }
    const localCandidate = join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs', 'antigravity', 'Antigravity.exe');
    if (existsSync(localCandidate)) return localCandidate;
    return '';
  }
  if (platform === 'darwin') {
    for (let cur = agentExe ? dirname(agentExe) : ''; cur && cur !== dirname(cur); cur = dirname(cur)) {
      if (cur.endsWith('.app') && existsSync(cur)) return cur;
    }
    for (const candidate of ['/Applications/Antigravity.app', join(home, 'Applications', 'Antigravity.app')]) {
      if (existsSync(candidate)) return candidate;
    }
    return '';
  }
  if (env.APPIMAGE && existsSync(env.APPIMAGE)) return env.APPIMAGE;
  if (agentExe) {
    const candidate = join(dirname(dirname(dirname(agentExe))), 'antigravity');
    if (existsSync(candidate)) return candidate;
  }
  for (const candidate of ['/usr/share/antigravity/antigravity', '/opt/Antigravity/antigravity', '/usr/bin/antigravity']) {
    if (existsSync(candidate)) return candidate;
  }
  return '';
}

function cleanGuiEnv(env) {
  const copy = { ...env };
  for (const key of Object.keys(copy)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'NODE_OPTIONS' || key.startsWith('ANTIGRAVITY_SIDECAR_') || key === 'ANTIGRAVITY_LS_ADDRESS' || key === 'ANTIGRAVITY_CSRF_TOKEN' || key === 'ANTIGRAVITY_AGENTAPI_EXE') {
      delete copy[key];
    }
  }
  return copy;
}

export function scheduleRelaunchWithDebugPort({
  dataDir,
  home = homedir(),
  platform = process.platform,
  env = process.env,
  spawnProcess = spawn
} = {}) {
  const target = resolveAntigravityExecutable({ platform, env, home });
  if (!target) throw new Error('未找到 Antigravity 启动程序');
  try { configureLaunchers({ home, dataDir, platform, env }); } catch {}
  if (dataDir) {
    const stateFile = join(dataDir, 'relaunch-state.json');
    const prev = readJson(stateFile, {});
    writeJson(stateFile, { ...prev, lastRelaunchAt: Date.now(), lastPromptLsAddress: env.ANTIGRAVITY_LS_ADDRESS || '' });
  }

  const childEnv = { ...cleanGuiEnv(env), AGY_RELAUNCH_TARGET: target };
  if (platform === 'win32') {
    const script = [
      '$target = $env:AGY_RELAUNCH_TARGET',
      'Remove-Item Env:AGY_RELAUNCH_TARGET -ErrorAction SilentlyContinue',
      '$procs = @(Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ([string]$_.Path).Equals($target, [System.StringComparison]::OrdinalIgnoreCase) })',
      'foreach ($p in $procs) { if ($p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() } }',
      '$deadline = (Get-Date).AddSeconds(12)',
      'while ((Get-Date) -lt $deadline) {',
      '  $alive = @(Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ([string]$_.Path).Equals($target, [System.StringComparison]::OrdinalIgnoreCase) })',
      '  if ($alive.Count -eq 0) { break }',
      '  Start-Sleep -Milliseconds 300',
      '}',
      '$still = @(Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ([string]$_.Path).Equals($target, [System.StringComparison]::OrdinalIgnoreCase) })',
      'if ($still.Count -gt 0) { $still | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 400 }',
      'Start-Sleep -Milliseconds 350',
      'Start-Process -FilePath $target -ArgumentList "--remote-debugging-port=0"'
    ].join('; ');
    const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: childEnv
    });
    child.unref?.();
    return { scheduled: true, target };
  }

  if (platform === 'darwin') {
    const appName = basename(target, '.app');
    const script = [
      `osascript -e 'tell application "${appName.replace(/"/g, '\\"')}" to quit' >/dev/null 2>&1 || true`,
      'i=0; while [ $i -lt 40 ] && pgrep -f "$AGY_RELAUNCH_TARGET/Contents/MacOS/" >/dev/null 2>&1; do sleep 0.3; i=$((i+1)); done',
      'sleep 0.4',
      'target="$AGY_RELAUNCH_TARGET"; unset AGY_RELAUNCH_TARGET',
      'open -n -a "$target" --args --remote-debugging-port=0 >/dev/null 2>&1 &'
    ].join('\n');
    const child = spawnProcess('sh', ['-c', script], { detached: true, stdio: 'ignore', env: childEnv });
    child.unref?.();
    return { scheduled: true, target };
  }

  const script = [
    'pkill -TERM -f "^$AGY_RELAUNCH_TARGET( |$)" >/dev/null 2>&1 || true',
    'i=0; while [ $i -lt 40 ] && pgrep -f "^$AGY_RELAUNCH_TARGET( |$)" >/dev/null 2>&1; do sleep 0.3; i=$((i+1)); done',
    'sleep 0.4',
    'target="$AGY_RELAUNCH_TARGET"; unset AGY_RELAUNCH_TARGET',
    'nohup "$target" --remote-debugging-port=0 >/dev/null 2>&1 &'
  ].join('\n');
  const child = spawnProcess('sh', ['-c', script], { detached: true, stdio: 'ignore', env: childEnv });
  child.unref?.();
  return { scheduled: true, target };
}

export function shouldPromptPostUpdate({
  dataDir,
  installDir,
  env = process.env,
  now = Date.now()
} = {}) {
  if (!env.ANTIGRAVITY_LS_ADDRESS || env.ELECTRON_OZONE_PLATFORM_HINT === 'headless' || env.AGY_POWERTOOLS_NO_PROMPT === '1') {
    return { prompt: false, reason: 'non-interactive' };
  }
  if (installDir) {
    try {
      const mtimeMs = statSync(join(installDir, '.agy-install.json')).mtimeMs;
      if (Number.isFinite(mtimeMs) && now - mtimeMs > -5000 && now - mtimeMs < FRESH_INSTALL_GRACE_MS) {
        return { prompt: false, reason: 'fresh-install' };
      }
    } catch {}
  }
  if (dataDir) {
    const state = readJson(join(dataDir, 'relaunch-state.json'), {});
    if (state.lastPromptLsAddress && state.lastPromptLsAddress === env.ANTIGRAVITY_LS_ADDRESS) {
      return { prompt: false, reason: 'already-prompted-session' };
    }
    if ((state.lastPromptAt && now - state.lastPromptAt < PROMPT_COOLDOWN_MS) ||
        (state.lastRelaunchAt && now - state.lastRelaunchAt < PROMPT_COOLDOWN_MS)) {
      return { prompt: false, reason: 'cooldown' };
    }
  }
  return { prompt: true, reason: 'ready' };
}

export function maybePromptPostUpdateRelaunch({
  dataDir,
  installDir,
  language = 'zh-CN',
  platform = process.platform,
  env = process.env,
  home = homedir(),
  now = Date.now(),
  relaunch = scheduleRelaunchWithDebugPort
} = {}) {
  const decision = shouldPromptPostUpdate({ dataDir, installDir, env, now });
  if (!decision.prompt) return { prompted: false, reason: decision.reason };
  const target = resolveAntigravityExecutable({ platform, env, home });
  if (!target) return { prompted: false, reason: 'executable-not-found' };

  if (dataDir) {
    const stateFile = join(dataDir, 'relaunch-state.json');
    const prev = readJson(stateFile, {});
    writeJson(stateFile, { ...prev, lastPromptAt: now, lastPromptLsAddress: env.ANTIGRAVITY_LS_ADDRESS });
  }

  const en = language === 'en';
  const message = en
    ? 'Antigravity was updated. Restart to re-enable the Powertools plugin?\n\nYour open conversations will be preserved.'
    : '检测到 Antigravity 已升级，请重启以重新启用 Powertools 插件。\n\n是否现在立即重启客户端？（当前会话记录会自动保留）';

  if (platform === 'win32') {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command',
      `$ws = New-Object -ComObject WScript.Shell; $ans = $ws.Popup($env:AGY_PROMPT_TEXT, 0, 'Agy Powertools', 65 + 4096); if ($ans -eq 1) { exit 10 } else { exit 0 }`
    ], { windowsHide: true, stdio: 'ignore', env: { ...env, AGY_PROMPT_TEXT: message } });
    child.on('exit', code => {
      if (code === 10) {
        try { relaunch({ dataDir, home, platform, env }); } catch {}
      }
    });
    child.unref?.();
    return { prompted: true };
  }

  if (platform === 'darwin') {
    const btnLater = en ? 'Later' : '稍后';
    const btnNow = en ? 'Restart Now' : '立即重启';
    const script = `display dialog ${JSON.stringify(message)} with title "Agy Powertools" buttons {${JSON.stringify(btnLater)}, ${JSON.stringify(btnNow)}} default button ${JSON.stringify(btnNow)}`;
    const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', chunk => { out += chunk; });
    child.on('exit', code => {
      if (code === 0 && out.includes(btnNow)) {
        try { relaunch({ dataDir, home, platform, env }); } catch {}
      }
    });
    child.unref?.();
    return { prompted: true };
  }

  return { prompted: false, reason: 'unsupported-dialog-platform' };
}

let lastAttentionAt = 0;
export function notifyTaskbarAttention({
  count = 0,
  platform = process.platform,
  env = process.env,
  home = homedir(),
  spawnProcess = spawn
} = {}) {
  if (platform !== 'win32' || env.ELECTRON_OZONE_PLATFORM_HINT === 'headless') return false;
  const now = Date.now();
  if (count > 0 && now - lastAttentionAt < 1500) return false;
  lastAttentionAt = now;
  const target = resolveAntigravityExecutable({ platform, env, home });
  const flags = count > 0 ? 14 : 0; // FLASHW_TRAY (2) | FLASHW_TIMERNOFG (12), or FLASHW_STOP (0)
  const flashCount = count > 0 ? 3 : 0;
  const script = [
    '$target = $env:AGY_FLASH_TARGET',
    '$flags = [uint32]$env:AGY_FLASH_FLAGS',
    '$count = [uint32]$env:AGY_FLASH_COUNT',
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class AgyFlash {',
    '  [StructLayout(LayoutKind.Sequential)]',
    '  public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }',
    '  [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);',
    '  public static void Flash(IntPtr h, uint f, uint c) {',
    '    var info = new FLASHWINFO { cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO)), hwnd = h, dwFlags = f, uCount = c, dwTimeout = 0 };',
    '    FlashWindowEx(ref info);',
    '  }',
    '}',
    '"@ -ErrorAction SilentlyContinue',
    '$procs = @(Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and (-not $target -or ($_.Path -and ([string]$_.Path).Equals($target, [System.StringComparison]::OrdinalIgnoreCase))) })',
    'foreach ($p in $procs) { [AgyFlash]::Flash($p.MainWindowHandle, $flags, $count) }'
  ].join('\n');
  try {
    const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...env, AGY_FLASH_TARGET: target || '', AGY_FLASH_FLAGS: String(flags), AGY_FLASH_COUNT: String(flashCount) }
    });
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

export function resolveLocalFilePath(uri) {
  if (typeof uri !== 'string' || !uri.trim()) throw new Error('文件路径无效');
  let parsed;
  try {
    parsed = new URL(uri.trim());
  } catch {
    throw new Error('文件路径格式无效');
  }
  if (parsed.protocol !== 'file:') throw new Error('仅支持本地文件链接');
  parsed.hash = '';
  parsed.search = '';
  return fileURLToPath(parsed);
}

export function openLocalFile(
  uri,
  { action = 'open', platform = process.platform, spawnProcess = spawn, exists = existsSync } = {}
) {
  if (action !== 'open' && action !== 'reveal') throw new Error('不支持的文件操作');
  const filePath = resolveLocalFilePath(uri);
  if (!exists(filePath)) throw new Error('文件或文件夹不存在');

  let command;
  let args;
  if (platform === 'win32') {
    command = 'explorer.exe';
    args = action === 'reveal' ? [`/select,${filePath}`] : [filePath];
  } else if (platform === 'darwin') {
    command = 'open';
    args = action === 'reveal' ? ['-R', filePath] : [filePath];
  } else {
    command = 'xdg-open';
    args = [action === 'reveal' ? dirname(filePath) : filePath];
  }

  const child = spawnProcess(command, args, { detached: true, stdio: 'ignore' });
  child?.unref?.();
  return { ok: true, path: filePath };
}

export function copyLocalFile(
  uri,
  { platform = process.platform, spawnSyncProcess = spawnSync, exists = existsSync, env = process.env } = {}
) {
  const filePath = resolveLocalFilePath(uri);
  if (!exists(filePath)) throw new Error('文件或文件夹不存在');

  let result;
  if (platform === 'win32') {
    result = spawnSyncProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Set-Clipboard -LiteralPath $env:AGY_CLIPBOARD_PATH'],
      { windowsHide: true, env: { ...env, AGY_CLIPBOARD_PATH: filePath }, encoding: 'utf8' }
    );
  } else if (platform === 'darwin') {
    result = spawnSyncProcess(
      'osascript',
      ['-e', 'on run argv', '-e', 'set the clipboard to (POSIX file (item 1 of argv))', '-e', 'end run', filePath],
      { encoding: 'utf8' }
    );
  } else {
    const fileUri = new URL(`file://${filePath.startsWith('/') ? '' : '/'}${filePath}`).href + '\n';
    result = spawnSyncProcess('wl-copy', ['--type', 'text/uri-list'], { input: fileUri, encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      result = spawnSyncProcess('xclip', ['-selection', 'clipboard', '-t', 'text/uri-list'], { input: fileUri, encoding: 'utf8' });
    }
  }

  if (result?.error || result?.status !== 0) {
    throw new Error(result?.stderr?.trim() || result?.error?.message || '复制文件失败');
  }
  return { ok: true, path: filePath };
}
