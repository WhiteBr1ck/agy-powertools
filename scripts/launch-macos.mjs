import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DEBUG_FLAG, resolveAntigravityExecutable } from '../lib/launcher.mjs';
import { chromiumProxyArgs, proxySpecFromSettings } from '../lib/proxy.mjs';
import { createSettingsStore } from '../lib/settings.mjs';
import { buildCleanTargetEnv } from './relaunch-worker.mjs';

export function launchMacOS({ platform = process.platform, env = process.env, dataDir,
  resolveApp = resolveAntigravityExecutable, run = spawnSync } = {}) {
  if (platform !== 'darwin') throw new Error('This launcher requires macOS.');
  const app = resolveApp({ platform, env });
  if (!app) throw new Error('Antigravity.app was not found in /Applications or ~/Applications.');

  const spec = proxySpecFromSettings(createSettingsStore(dataDir).get());
  const proxyEnv = spec.enabled ? {
    HTTP_PROXY: spec.url, HTTPS_PROXY: spec.url, ALL_PROXY: spec.url,
    http_proxy: spec.url, https_proxy: spec.url, all_proxy: spec.url,
    NO_PROXY: spec.bypass, no_proxy: spec.bypass, AGY_POWERTOOLS_PROXY_SPEC: spec.specKey,
    ...(spec.forceHttp1 ? { GODEBUG: 'http2client=0' } : {})
  } : {};
  const targetEnv = buildCleanTargetEnv(env, { proxyEnabled: spec.enabled, forceHttp1: spec.forceHttp1, proxyEnv });

  // open passes its environment to newly launched apps. Keep proxy credentials
  // in that environment, never in the process list (including the spec marker).
  const args = ['-a', app, '--args', DEBUG_FLAG, ...chromiumProxyArgs(spec)];
  const result = run('/usr/bin/open', args, { env: targetEnv, stdio: 'ignore' });
  if (result.error || result.status !== 0) throw new Error('macOS could not open Antigravity.app.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length > 2) throw new Error('Usage: node launch-macos.mjs');
    launchMacOS();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
