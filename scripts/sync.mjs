import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installationPaths } from '../lib/lifecycle.mjs';
import { createQuotaTracker } from '../lib/quota.mjs';
import { createSettingsStore } from '../lib/settings.mjs';
import { createRemoteTelemetryBridge, validateSshDestination } from '../lib/ssh-remote.mjs';
import { buildAgentSyncPrompt, createUsageSyncCoordinator, parseSyncSshHosts, resolveSyncDir } from '../lib/usage-sync.mjs';

function parseCliArgs(argv) {
  const positionals = [];
  const flags = {
    json: false,
    home: '',
    dataDir: '',
    appDataDir: '',
    name: '',
    dir: '',
    ssh: '',
    privacy: null,
    enable: false,
    disable: false,
    email: ''
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--enable') {
      flags.enable = true;
    } else if (arg === '--disable') {
      flags.disable = true;
    } else if (arg === '--home' && i + 1 < argv.length) {
      flags.home = argv[++i];
    } else if (arg.startsWith('--home=')) {
      flags.home = arg.slice(7);
    } else if (arg === '--data-dir' && i + 1 < argv.length) {
      flags.dataDir = argv[++i];
    } else if (arg.startsWith('--data-dir=')) {
      flags.dataDir = arg.slice(11);
    } else if (arg === '--app-data-dir' && i + 1 < argv.length) {
      flags.appDataDir = argv[++i];
    } else if (arg.startsWith('--app-data-dir=')) {
      flags.appDataDir = arg.slice(15);
    } else if (arg === '--name' && i + 1 < argv.length) {
      flags.name = argv[++i];
    } else if (arg.startsWith('--name=')) {
      flags.name = arg.slice(7);
    } else if (arg === '--dir' && i + 1 < argv.length) {
      flags.dir = argv[++i];
    } else if (arg.startsWith('--dir=')) {
      flags.dir = arg.slice(6);
    } else if (arg === '--ssh' && i + 1 < argv.length) {
      flags.ssh = argv[++i];
    } else if (arg.startsWith('--ssh=')) {
      flags.ssh = arg.slice(6);
    } else if (arg === '--privacy' && i + 1 < argv.length) {
      const val = argv[++i].trim().toLowerCase();
      if (!['on', 'true', '1', 'off', 'false', '0'].includes(val)) {
        throw new Error(`Invalid --privacy value: ${val}`);
      }
      flags.privacy = ['on', 'true', '1'].includes(val);
    } else if (arg.startsWith('--privacy=')) {
      const val = arg.slice(10).trim().toLowerCase();
      if (!['on', 'true', '1', 'off', 'false', '0'].includes(val)) {
        throw new Error(`Invalid --privacy value: ${val}`);
      }
      flags.privacy = ['on', 'true', '1'].includes(val);
    } else if (arg === '--email' && i + 1 < argv.length) {
      flags.email = argv[++i].trim().toLowerCase();
    } else if (arg.startsWith('--email=')) {
      flags.email = arg.slice(8).trim().toLowerCase();
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  const command = (positionals[0] || 'status').toLowerCase();
  return { command, args: positionals.slice(1), flags };
}

function formatTextReport(result) {
  if (result?.command === 'prompt' && typeof result.prompt === 'string') {
    return result.prompt;
  }
  const st = result.status || result;
  const lines = [
    `Device: ${st.deviceName} (${st.deviceId})`,
    `Sync enabled: ${st.enabled ? 'yes' : 'no'}`,
    `Sync folder: ${st.resolvedSyncDir || st.syncDir || '(not set)'}`,
    `SSH hosts: ${st.sshHosts?.length ? st.sshHosts.join(', ') : '(none)'}`,
    `Privacy mode: ${st.privacyMode ? 'on' : 'off'}`
  ];
  if (Number.isFinite(result.localRequestCount)) {
    lines.push(`Local requests: ${result.localRequestCount}`);
  }
  if (Number.isFinite(result.totalMergedRequests)) {
    lines.push(`Merged requests: ${result.totalMergedRequests}`);
  }
  const peers = Array.isArray(st.peers) ? st.peers : [];
  lines.push(`Peers discovered: ${peers.length}`);
  for (const peer of peers) {
    lines.push(`  - ${peer.deviceName} [${peer.kind}] (${peer.deviceId}): ${peer.requestCount} requests`);
  }
  if (st.lastError) {
    lines.push(`Last error: ${st.lastError}`);
  }
  return lines.join('\n');
}

export async function runSyncCli(argv = process.argv.slice(2), { env = process.env } = {}) {
  const { command, args, flags } = parseCliArgs(argv);
  const paths = installationPaths(flags.home || homedir());
  const dataDir = flags.dataDir ? resolve(flags.dataDir) : paths.data;
  const appDataDir = flags.appDataDir
    ? resolve(flags.appDataDir)
    : (env.ANTIGRAVITY_APP_DATA_DIR || join(paths.root, 'antigravity'));

  const settings = createSettingsStore(dataDir);
  const quota = createQuotaTracker(dataDir);
  const remoteBridge = createRemoteTelemetryBridge();
  const coordinator = createUsageSyncCoordinator({
    dataDir,
    appDataDirGetter: () => appDataDir,
    settingsGetter: () => settings.get(),
    quotaTracker: quota,
    remoteBridge,
    env,
    home: paths.home
  });

  let payload;
  if (command === 'status') {
    const merged = coordinator.mergedDashboard({ force: false });
    payload = {
      ok: true,
      command,
      localRequestCount: merged.requests.filter(r => !r.isRemotePeer).length,
      totalMergedRequests: merged.totalRequests,
      status: merged.syncStatus
    };
  } else if (command === 'init') {
    const patch = {};
    if (flags.name) patch.syncDeviceName = flags.name;
    if (flags.dir) {
      const resolved = resolveSyncDir(flags.dir, { home: paths.home, env });
      if (!resolved) throw new Error('Sync folder must be an absolute path');
      patch.syncDir = resolved;
    }
    if (flags.ssh) patch.syncSshHosts = flags.ssh;
    if (flags.privacy !== null) patch.syncPrivacyMode = flags.privacy;
    if (flags.disable) patch.syncEnabled = false;
    else if (flags.enable || flags.dir || flags.ssh) patch.syncEnabled = true;

    const nextSettings = Object.keys(patch).length ? settings.set(patch) : settings.get();
    if (nextSettings.syncEnabled) {
      const syncResult = await coordinator.syncNow({
        activeEmail: flags.email,
        fallbackEmail: flags.email,
        forceSsh: true,
        forceDashboard: true
      });
      const merged = coordinator.mergedDashboard({ force: false, activeEmail: flags.email });
      payload = {
        ...syncResult,
        command,
        localRequestCount: merged.requests.filter(r => !r.isRemotePeer).length,
        totalMergedRequests: merged.totalRequests
      };
    } else {
      payload = { ok: true, command, status: coordinator.status() };
    }
  } else if (command === 'set-dir') {
    const rawDir = args[0] || flags.dir;
    if (!rawDir) throw new Error('Usage: sync.mjs set-dir <path>');
    const resolved = resolveSyncDir(rawDir, { home: paths.home, env });
    if (!resolved) throw new Error('Sync folder must be an absolute path');
    settings.set({ syncDir: resolved, syncEnabled: !flags.disable });
    const syncResult = await coordinator.syncNow({
      activeEmail: flags.email,
      fallbackEmail: flags.email,
      forceSsh: true,
      forceDashboard: true
    });
    const merged = coordinator.mergedDashboard({ force: false, activeEmail: flags.email });
    payload = {
      ...syncResult,
      command,
      localRequestCount: merged.requests.filter(r => !r.isRemotePeer).length,
      totalMergedRequests: merged.totalRequests
    };
  } else if (command === 'add-ssh') {
    const rawHost = args[0];
    if (!rawHost) throw new Error('Usage: sync.mjs add-ssh <host>');
    const host = validateSshDestination(rawHost);
    const currentHosts = parseSyncSshHosts(settings.get().syncSshHosts);
    if (!currentHosts.includes(host)) currentHosts.push(host);
    settings.set({ syncSshHosts: currentHosts.join(', '), syncEnabled: !flags.disable });
    const syncResult = await coordinator.syncNow({
      activeEmail: flags.email,
      fallbackEmail: flags.email,
      forceSsh: true,
      forceDashboard: true
    });
    const merged = coordinator.mergedDashboard({ force: false, activeEmail: flags.email });
    payload = {
      ...syncResult,
      command,
      localRequestCount: merged.requests.filter(r => !r.isRemotePeer).length,
      totalMergedRequests: merged.totalRequests
    };
  } else if (command === 'remove-ssh') {
    const rawHost = args[0];
    if (!rawHost) throw new Error('Usage: sync.mjs remove-ssh <host>');
    const host = validateSshDestination(rawHost);
    const remaining = parseSyncSshHosts(settings.get().syncSshHosts).filter(item => item !== host);
    settings.set({ syncSshHosts: remaining.join(', ') });
    payload = { ok: true, command, status: coordinator.status() };
  } else if (command === 'sync' || command === 'export') {
    const syncResult = await coordinator.syncNow({
      activeEmail: flags.email,
      fallbackEmail: flags.email,
      forceSsh: true,
      forceDashboard: true
    });
    const merged = coordinator.mergedDashboard({ force: false, activeEmail: flags.email });
    payload = {
      ...syncResult,
      command,
      localRequestCount: merged.requests.filter(r => !r.isRemotePeer).length,
      totalMergedRequests: merged.totalRequests
    };
  } else if (command === 'prompt') {
    const st = coordinator.status();
    const prompt = buildAgentSyncPrompt({
      syncDir: flags.dir || st.syncDir || '',
      sshHosts: flags.ssh || st.sshHosts || [],
      privacyMode: flags.privacy !== null ? flags.privacy : st.privacyMode
    });
    payload = { ok: true, command, prompt, status: st };
  } else {
    throw new Error(`Unknown sync command: ${command}`);
  }

  return { payload, json: flags.json };
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  runSyncCli()
    .then(({ payload, json }) => {
      console.log(json ? JSON.stringify(payload, null, 2) : formatTextReport(payload));
      if (payload && payload.ok === false) process.exitCode = 1;
    })
    .catch(error => {
      console.error(`Sync failed: ${error?.message || String(error)}`);
      process.exitCode = 1;
    });
}
