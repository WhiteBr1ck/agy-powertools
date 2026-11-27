import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchMacOS } from '../scripts/launch-macos.mjs';
import { inspectProxyRuntime } from '../lib/proxy.mjs';
import { createSettingsStore } from '../lib/settings.mjs';

test('direct cold start picks up saved proxy changes and matches the sidecar runtime check', t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agy-mac-launch-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const store = createSettingsStore(dataDir);
  const app = '/Applications/Antigravity Preview.app';
  const prefix = ['-a', app, '--args', '--remote-debugging-port=0'];
  function capture(env) {
    const calls = [];
    launchMacOS({ platform: 'darwin', env, dataDir, resolveApp: () => app,
      run(cmd, args, opts) { calls.push({ cmd, args, env: opts.env }); return { status: 0 }; } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, '/usr/bin/open');
    return calls[0];
  }

  const external = capture({ HTTPS_PROXY: 'http://user-proxy:8000' });
  assert.deepEqual(external.args, prefix);
  assert.equal(external.env.HTTPS_PROXY, 'http://user-proxy:8000');

  const url = 'socks5h://user:example-secret@127.0.0.1:3000';
  const settings = store.set({ proxyEnabled: true, proxyUrl: url, proxyForceHttp1: true, proxyBypass: '.internal' });
  const enabled = capture({ ...external.env, ELECTRON_RUN_AS_NODE: '1' });
  assert.deepEqual(enabled.args, [...prefix, '--proxy-server=socks5://127.0.0.1:3000', '--proxy-bypass-list=localhost;127.0.0.1;[::1];.internal']);
  for (const name of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) assert.equal(enabled.env[name], url);
  assert.equal(enabled.env.NO_PROXY, 'localhost,127.0.0.1,::1,.internal');
  assert.equal(enabled.env.no_proxy, enabled.env.NO_PROXY);
  assert.equal(enabled.env.GODEBUG, 'http2client=0');
  assert.equal(enabled.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(inspectProxyRuntime(settings, enabled.env).managedByPowertools, true);
  assert.equal(inspectProxyRuntime(settings, enabled.env).reason, 'active');

  const updated = store.set({ proxyUrl: 'http://localhost:4567', proxyForceHttp1: false });
  const changed = capture(enabled.env);
  assert.ok(changed.args.includes('--proxy-server=http://localhost:4567'));
  assert.equal(changed.env.GODEBUG, undefined);
  assert.equal(inspectProxyRuntime(updated, changed.env).reason, 'active');

  const off = store.set({ proxyEnabled: false });
  const disabled = capture(changed.env);
  assert.deepEqual(disabled.args, prefix);
  assert.equal(disabled.env.HTTPS_PROXY, undefined);
  assert.equal(inspectProxyRuntime(off, disabled.env).reason, 'disabled');
});

test('unsupported platform or missing app never calls open; launch errors are reported', t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agy-mac-launch-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const options = { platform: 'darwin', dataDir, env: {}, resolveApp: () => '', run: () => assert.fail('unexpected launch') };
  assert.throws(() => launchMacOS({ ...options, platform: 'linux' }), /requires macOS/);
  assert.throws(() => launchMacOS(options), /not found/);
  assert.throws(() => launchMacOS({ ...options, resolveApp: () => '/Applications/Antigravity.app', run: () => ({ status: 1 }) }), /could not open/);
});
