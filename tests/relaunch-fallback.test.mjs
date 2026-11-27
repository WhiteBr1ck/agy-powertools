import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import vm from 'node:vm';
import { createSidecarDomSandbox } from './helpers/sidecar-dom.mjs';
import { createAccountsStore } from '../lib/accounts.mjs';
import { renderAuxPaneHtml, startSidecarWebUi } from '../lib/sidecar-ui.mjs';
import { getLocalePack, SUPPORTED_LANGUAGES } from '../lib/locales/index.mjs';
import { startNativeIntegration } from '../lib/native-host.mjs';

const FORBIDDEN_DOTS = /[\u00b7\u2022\u2027\u30fb]/u;

function createFakeVault(initial = {}) {
  const slots = new Map(Object.entries(initial));
  const hashOf = v => `H_${String(v)}`;
  return {
    supported: true,
    slots,
    has(target) { return slots.has(target); },
    inspect(target) {
      return slots.has(target) ? { exists: true, hash: hashOf(slots.get(target)) } : { exists: false, hash: '' };
    },
    copy(from, to) {
      if (!slots.has(from)) return { ok: false, error: 'missing source' };
      const val = slots.get(from);
      slots.set(to, val);
      return { ok: true, bytes: 128, hash: hashOf(val) };
    },
    remove(target) { slots.delete(target); return { ok: true }; },
    saveActiveTo(id) { return this.copy('gemini:antigravity', `agy-powertools:account:${id}`); },
    restoreToActive(id) { return this.copy(`agy-powertools:account:${id}`, 'gemini:antigravity'); },
    hasSaved(id) { return this.has(`agy-powertools:account:${id}`); },
    inspectSaved(id) { return this.inspect(`agy-powertools:account:${id}`); },
    inspectActive() { return this.inspect('gemini:antigravity'); },
    removeSaved(id) { return this.remove(`agy-powertools:account:${id}`); }
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

test('accounts.switchAccount and completeAdd return manualRestartRequired when relaunch returns blocked without throwing (sync and async)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-relaunch-fallback-acct-'));
  const manualCmd = '"/opt/antigravity/Antigravity" --remote-debugging-port=9222';
  try {
    // 1. Synchronous relaunch mock returning { scheduled: false, manualRestartRequired: true, reason: 'relaunch-blocked' }
    const syncVault = createFakeVault({ 'gemini:antigravity': 'tok-alpha' });
    const syncStore = createAccountsStore(join(dir, 'sync'), {
      vault: syncVault,
      relaunch: () => ({ scheduled: false, confirmed: false, manualRestartRequired: true, reason: 'relaunch-blocked', manualCommand: manualCmd })
    });
    const s1 = syncStore.syncActive({ email: 'alpha@example.com', name: 'Alpha' });
    const alphaId = s1.activeId;
    const prep = syncStore.prepareAdd({ pendingAlias: 'Beta' });
    syncVault.slots.set('gemini:antigravity', 'tok-beta');
    const addedSync = syncStore.completeAdd({
      email: 'beta@example.com',
      prevEmail: 'alpha@example.com',
      prevCredHash: prep.prevCredHash,
      triggerRelaunch: true
    });
    assert.equal(addedSync.ok, true);
    assert.equal(addedSync.accountChanged, true);
    assert.equal(addedSync.relaunching, false);
    assert.equal(addedSync.manualRestartRequired, true);
    assert.equal(addedSync.relaunchReason, 'relaunch-blocked');
    assert.equal(addedSync.manualCommand, manualCmd);

    const switchedSync = syncStore.switchAccount(alphaId, { triggerRelaunch: true });
    assert.equal(switchedSync.ok, true);
    assert.equal(switchedSync.relaunching, false);
    assert.equal(switchedSync.manualRestartRequired, true);
    assert.equal(switchedSync.relaunchReason, 'relaunch-blocked');
    assert.equal(switchedSync.manualCommand, manualCmd);
    assert.equal(syncVault.slots.get('gemini:antigravity'), 'tok-alpha');

    // 2. Async relaunch mock resolving to blocked without throwing, and rejecting on failure
    const asyncVault = createFakeVault({ 'gemini:antigravity': 'tok-a' });
    let nextAsyncMode = 'blocked';
    const asyncStore = createAccountsStore(join(dir, 'async'), {
      vault: asyncVault,
      relaunch: async () => {
        if (nextAsyncMode === 'blocked') {
          return { scheduled: false, confirmed: false, manualRestartRequired: true, reason: 'relaunch-blocked', manualCommand: manualCmd };
        }
        if (nextAsyncMode === 'reject') {
          throw new Error('AV quarantined launcher');
        }
        return { scheduled: true, confirmed: true, manualRestartRequired: false };
      }
    });
    const a1 = asyncStore.syncActive({ email: 'a@example.com', name: 'A' });
    const aId = a1.activeId;
    const prepA = asyncStore.prepareAdd();
    asyncVault.slots.set('gemini:antigravity', 'tok-b');

    const addedAsync = await asyncStore.completeAdd({
      email: 'b@example.com',
      prevEmail: 'a@example.com',
      prevCredHash: prepA.prevCredHash,
      triggerRelaunch: true
    });
    assert.equal(addedAsync.ok, true);
    assert.equal(addedAsync.relaunching, false);
    assert.equal(addedAsync.manualRestartRequired, true);
    assert.equal(addedAsync.relaunchReason, 'relaunch-blocked');
    assert.equal(addedAsync.manualCommand, manualCmd);

    const switchedBlocked = await asyncStore.switchAccount(aId, { triggerRelaunch: true });
    assert.equal(switchedBlocked.ok, true);
    assert.equal(switchedBlocked.relaunching, false);
    assert.equal(switchedBlocked.manualRestartRequired, true);
    assert.equal(switchedBlocked.relaunchReason, 'relaunch-blocked');
    assert.equal(switchedBlocked.manualCommand, manualCmd);

    // Clear pendingSwitch as if user restarted into A, then switch to B with rejected async relaunch
    asyncStore.syncActive({ email: 'a@example.com', name: 'A' });
    const bId = asyncStore.list().accounts.find(a => a.email === 'b@example.com').id;
    nextAsyncMode = 'reject';
    const switchedReject = await asyncStore.switchAccount(bId, { triggerRelaunch: true });
    assert.equal(switchedReject.ok, true);
    assert.equal(switchedReject.relaunching, false);
    assert.equal(switchedReject.manualRestartRequired, true);
    assert.equal(switchedReject.relaunchReason, 'relaunch-failed');
    assert.ok(switchedReject.relaunchError.includes('AV quarantined launcher'));

    // Clear pendingSwitch and confirm positive ACK sets relaunching: true
    asyncStore.syncActive({ email: 'b@example.com', name: 'B' });
    nextAsyncMode = 'ok';
    const switchedOk = await asyncStore.switchAccount(aId, { triggerRelaunch: true });
    assert.equal(switchedOk.ok, true);
    assert.equal(switchedOk.relaunching, true);
    assert.equal(switchedOk.manualRestartRequired, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderAuxPaneHtml includes relaunchBlocked copy across all 9 languages and preserves blocked/timeout feedback across healthy polls', async () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const html = renderAuxPaneHtml({ version: '2.18.0', language: lang });
    assert.ok(html.includes('relaunchBlocked'), `${lang} HTML missing relaunchBlocked`);
    const pack = getLocalePack(lang);
    if (pack) {
      assert.ok(pack.sidecar?.relaunchBlocked?.trim(), `${lang} pack missing sidecar.relaunchBlocked`);
      assert.doesNotMatch(pack.sidecar.relaunchBlocked, FORBIDDEN_DOTS, `${lang} sidecar.relaunchBlocked has forbidden dot`);
      assert.ok(html.includes(JSON.stringify(pack.sidecar.relaunchBlocked)), `${lang} HTML should embed localized relaunchBlocked`);
    }
  }

  // Case 1: Proxy mismatch + relaunch-blocked -> shows relaunchBlocked + manual command immediately,
  // persists across subsequent healthy+proxy-mismatch 3s polls, and clears once proxy resolves!
  let statusPayload = {
    healthy: true,
    enabled: true,
    language: 'zh-CN',
    manualCommand: 'Antigravity.exe --remote-debugging-port=9222',
    proxy: { configured: true, mismatch: true }
  };
  let relaunchResponse = {
    ok: true,
    scheduled: false,
    manualRestartRequired: true,
    reason: 'relaunch-blocked'
  };
  const sb1 = createSidecarDomSandbox(renderAuxPaneHtml({ version: '2.18.0', language: 'zh-CN' }), {
    fetchImpl: async url => {
      if (String(url).startsWith('/api/status')) return { ok: true, json: async () => statusPayload };
      if (String(url).startsWith('/api/relaunch')) return { ok: true, json: async () => relaunchResponse };
      return { ok: true, json: async () => ({}) };
    }
  });
  await new Promise(r => setImmediate(r));

  const btn1 = sb1.elements.get('relaunch-btn');
  const feedback1 = sb1.elements.get('feedback');
  const cmdBox1 = sb1.elements.get('cmd-box');
  const copyBtn1 = sb1.elements.get('copy-cmd-btn');
  const pollInterval1 = sb1.intervals.find(i => i.ms === 3000);
  assert.ok(pollInterval1);

  await btn1.trigger('click');
  assert.equal(btn1.disabled, false, 'Button must re-enable immediately when relaunch is blocked');
  assert.equal(feedback1.hidden, false);
  assert.ok(feedback1.textContent.includes('安全软件拦截'));
  assert.equal(cmdBox1.hidden, false);
  assert.equal(cmdBox1.textContent, 'Antigravity.exe --remote-debugging-port=9222');
  assert.equal(copyBtn1.hidden, false);

  // Subsequent 3s poll with healthy: true & proxy still pending MUST NOT wipe feedback or cmdBox
  await pollInterval1.fn();
  assert.equal(feedback1.hidden, false, '3s poll must not hide blocked feedback');
  assert.equal(cmdBox1.hidden, false, '3s poll must not hide manual command box');
  assert.equal(copyBtn1.hidden, false, '3s poll must not hide copy command button');

  // Once proxy mismatch is resolved, 3s poll clears the proxy relaunch notice cleanly
  statusPayload = { ...statusPayload, proxy: { configured: true, mismatch: false } };
  await pollInterval1.fn();
  assert.equal(feedback1.hidden, true, 'Resolved proxy mismatch should clear feedback');
  assert.equal(cmdBox1.hidden, true, 'Resolved proxy mismatch should hide cmdBox');
  assert.equal(copyBtn1.hidden, true, 'Resolved proxy mismatch should hide copyBtn');

  // Case 2: Non-proxy timeout preserves feedback + cmdBox even when a later poll returns healthy: true
  let statusPayload2 = {
    healthy: false,
    enabled: true,
    language: 'en',
    manualCommand: '/Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=9222'
  };
  const sb2 = createSidecarDomSandbox(renderAuxPaneHtml({ version: '2.18.0', language: 'en' }), {
    fetchImpl: async url => {
      if (String(url).startsWith('/api/status')) return { ok: true, json: async () => statusPayload2 };
      if (String(url).startsWith('/api/relaunch')) return { ok: true, json: async () => ({ ok: true, scheduled: true }) };
      return { ok: true, json: async () => ({}) };
    }
  });
  await new Promise(r => setImmediate(r));
  await sb2.elements.get('relaunch-btn').trigger('click');
  const relaunchTimeoutEntry = sb2.timeouts.find(t => t.ms === 15000 && !t.cleared);
  assert.ok(relaunchTimeoutEntry, 'Expected 15s relaunch timeout');
  relaunchTimeoutEntry.fn();

  assert.equal(sb2.elements.get('feedback').hidden, false);
  assert.ok(sb2.elements.get('feedback').textContent.includes('Relaunch timed out'));
  assert.equal(sb2.elements.get('cmd-box').hidden, false);
  assert.equal(sb2.elements.get('copy-cmd-btn').hidden, false);

  statusPayload2 = { ...statusPayload2, healthy: true };
  await sb2.intervals.find(i => i.ms === 3000).fn();
  assert.equal(sb2.elements.get('feedback').hidden, false, 'Healthy poll must preserve timeout notice');
  assert.equal(sb2.elements.get('cmd-box').hidden, false, 'Healthy poll must preserve manual command box');
  assert.equal(sb2.elements.get('copy-cmd-btn').hidden, false, 'Healthy poll must preserve copy button');

  // Case 3: startSidecarWebUi /api/relaunch forwards async manualRestartRequired response verbatim
  const port = await getFreePort();
  const close = await startSidecarWebUi({
    port,
    token: 'tok-fallback',
    version: '2.18.0',
    getStatus: async () => ({ healthy: false, enabled: true, language: 'en' }),
    onRelaunch: async () => ({ scheduled: false, confirmed: false, manualRestartRequired: true, reason: 'relaunch-blocked' })
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/relaunch`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'tok-fallback', 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.scheduled, false);
    assert.equal(body.manualRestartRequired, true);
    assert.equal(body.reason, 'relaunch-blocked');
  } finally {
    await close();
  }
});

test('native-ui resets switchingInProgress on manualRestartRequired across switch, completeAdd, autoSwitch, proxy relaunch, and 20s safety timeout', async () => {
  const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');
  const timeouts = [];
  const notifications = [];
  let switchReply = {
    ok: true,
    relaunching: false,
    manualRestartRequired: true,
    relaunchReason: 'relaunch-blocked',
    relaunchError: 'relaunch-blocked',
    account: { id: 'acct-b', email: 'b@example.com', name: 'Beta' },
    activeId: 'acct-b',
    accounts: [
      { id: 'acct-a', email: 'a@example.com', name: 'Alpha' },
      { id: 'acct-b', email: 'b@example.com', name: 'Beta' }
    ]
  };
  let completeAddReply = {
    ok: true,
    accountChanged: true,
    relaunching: false,
    manualRestartRequired: true,
    relaunchReason: 'relaunch-blocked',
    account: { id: 'acct-c', email: 'c@example.com', name: 'Gamma' },
    activeId: 'acct-c',
    accounts: [
      { id: 'acct-a', email: 'a@example.com', name: 'Alpha' },
      { id: 'acct-b', email: 'b@example.com', name: 'Beta' },
      { id: 'acct-c', email: 'c@example.com', name: 'Gamma' }
    ]
  };
  let proxyRelaunchReply = {
    ok: false,
    relaunching: false,
    manualRestartRequired: true,
    reason: 'relaunch-blocked',
    manualCommand: 'Antigravity.exe --remote-debugging-port=9222'
  };
  let capEmail = 'a@example.com';

  const makeEl = tag => ({
    tagName: String(tag || 'div').toUpperCase(),
    dataset: {},
    style: {},
    className: '',
    textContent: '',
    children: [],
    listeners: new Map(),
    isConnected: true,
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    remove() { this.isConnected = false; },
    contains() { return false; },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); },
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  });
  const body = makeEl('body');
  let capturedEnv = null;

  const ctx = vm.createContext({
    document: {
      readyState: 'complete',
      head: makeEl('head'),
      body,
      documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
      createElement: tag => makeEl(tag),
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: { addEventListener() {}, removeEventListener() {} },
    location: { pathname: '/c/conv-fallback' },
    AbortController,
    React: { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: (_, g) => g() },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyPanels: env => { capturedEnv = env; return { dispose() {} }; },
    __agyInitialSettings: { enabled: true, multiAccount: true, autoSwitchAccount: false, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' },
    __agyNativeAdapter: {
      wrap: el => el,
      installPage: () => true,
      executionState: () => ({ conversationId: 'conv-fallback', status: 1 }),
      runningConversationIds: () => [],
      capabilities: () => ({ email: capEmail, name: 'User', model: 'Claude Opus 5.5' }),
      notify: payload => { notifications.push(payload); },
      startAccountLogin: async () => { capEmail = 'c@example.com'; },
      service: () => ({
        retrieveUserQuotaSummary: async () => ({
          response: { groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', remainingFraction: 0.8, resetTimeMs: Date.now() + 3600_000 }] }] }
        })
      }),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      queueMicrotask(() => {
        if (msg.method === 'settings.get') {
          ctx.__agyPowertoolsReceive(msg.id, { enabled: true, multiAccount: true, autoSwitchAccount: false, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' });
        } else if (msg.method === 'proxy.status') {
          ctx.__agyPowertoolsReceive(msg.id, {
            configured: true,
            configuredUrl: 'http://127.0.0.1:7897',
            configuredDisplayUrl: 'http://127.0.0.1:7897',
            configuredForceHttp1: false,
            active: false,
            mismatch: true,
            reason: 'not-applied',
            canRelaunch: true
          });
        } else if (msg.method === 'proxy.relaunch') {
          ctx.__agyPowertoolsReceive(msg.id, proxyRelaunchReply);
        } else if (msg.method === 'accounts.list' || msg.method === 'accounts.syncActive' || msg.method === 'accounts.refreshLocalQuotas') {
          ctx.__agyPowertoolsReceive(msg.id, {
            ok: true,
            activeId: 'acct-a',
            accounts: [
              { id: 'acct-a', email: 'a@example.com', name: 'Alpha' },
              { id: 'acct-b', email: 'b@example.com', name: 'Beta' }
            ]
          });
        } else if (msg.method === 'accounts.prepareAdd') {
          ctx.__agyPowertoolsReceive(msg.id, { ok: true, prevCredHash: 'H_a' });
        } else if (msg.method === 'accounts.switch') {
          ctx.__agyPowertoolsReceive(msg.id, switchReply);
        } else if (msg.method === 'accounts.completeAdd') {
          ctx.__agyPowertoolsReceive(msg.id, completeAddReply);
        } else {
          ctx.__agyPowertoolsReceive(msg.id, {});
        }
      });
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn, ms) => {
      const item = { id: timeouts.length + 1, fn, ms, cleared: false };
      timeouts.push(item);
      return item.id;
    },
    clearTimeout: id => {
      const item = timeouts.find(t => t.id === id);
      if (item) item.cleared = true;
    }
  });
  vm.runInContext(source, ctx);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(capturedEnv);

  // 1. switchAccount returning manualRestartRequired resets switchingInProgress cleanly
  const swRes = await capturedEnv.switchAccount('acct-b');
  assert.equal(swRes.manualRestartRequired, true);
  const afterSwitch = await capturedEnv.refreshAccountQuotas();
  assert.equal(afterSwitch.ok, true, 'switchingInProgress must reset when switchAccount returns manualRestartRequired');

  // 2. startAddAccount (completeAdd) returning manualRestartRequired resets switchingInProgress cleanly
  const addRes = await capturedEnv.startAddAccount('Gamma');
  assert.equal(addRes.manualRestartRequired, true);
  const afterAdd = await capturedEnv.refreshAccountQuotas();
  assert.equal(afterAdd.ok, true, 'switchingInProgress must reset when completeAdd returns manualRestartRequired');

  // 3. relaunchWithProxy returning manualRestartRequired resets switchingInProgress, returns structured fallback, and shows error banner
  const proxyRes = await capturedEnv.relaunchWithProxy();
  assert.equal(proxyRes.ok, false);
  assert.equal(proxyRes.relaunching, false);
  assert.equal(proxyRes.manualRestartRequired, true);
  assert.equal(proxyRes.reason, 'relaunch-blocked');
  assert.equal(proxyRes.manualCommand, 'Antigravity.exe --remote-debugging-port=9222');
  const afterProxy = await capturedEnv.refreshAccountQuotas();
  assert.equal(afterProxy.ok, true, 'switchingInProgress must reset when relaunchWithProxy returns manualRestartRequired');
  const proxyBanner = body.children.filter(c => c.dataset?.testid === 'agy-proxy-prompt-banner' && c.isConnected).at(-1);
  assert.ok(proxyBanner, 'Proxy error banner must stay visible on manualRestartRequired');
  assert.ok(proxyBanner.children[0].textContent.includes('安全软件拦截'));
  assert.doesNotMatch(proxyBanner.children[0].textContent, FORBIDDEN_DOTS);

  // 4. 20s safety timeout: when relaunching: true never actually closes Antigravity, safety timer unwedges switchingInProgress
  switchReply = { ...switchReply, relaunching: true, manualRestartRequired: false };
  await capturedEnv.switchAccount('acct-b');
  const whileSwitching = await capturedEnv.refreshAccountQuotas();
  assert.equal(whileSwitching.ok, false, 'switchingInProgress should be active while awaiting relaunch');
  assert.equal(whileSwitching.synced, false, 'refreshAccount must be skipped while switchingInProgress is true');
  const safetyTimer = timeouts.filter(t => t.ms === 20000 && !t.cleared).at(-1);
  assert.ok(safetyTimer, 'Expected 20s safety timeout for switchingInProgress');
  safetyTimer.fn();
  const afterSafety = await capturedEnv.refreshAccountQuotas();
  assert.equal(afterSafety.ok, true, '20s safety timer must reset switchingInProgress if Antigravity stayed open');

  ctx.__agyPowertools.dispose();
});

test('ProxySettings surfaces error feedback and never wedges on green relaunching text when relaunchWithProxy returns manualRestartRequired', async () => {
  const componentStates = new Map();
  let activeComponent = 'settings';
  let hookIdx = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useId: () => 'tip-1',
    useState: init => {
      if (!componentStates.has(activeComponent)) componentStates.set(activeComponent, []);
      const states = componentStates.get(activeComponent);
      const i = hookIdx++;
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
      return [states[i], val => { states[i] = typeof val === 'function' ? val(states[i]) : val; }];
    },
    useEffect: () => {},
    useSyncExternalStore: (_, getSnap) => getSnap()
  };
  const dashboardCode = readFileSync(new URL('../lib/dashboard.mjs', import.meta.url), 'utf8').replaceAll('export function', 'function');
  const helperCode = readFileSync(new URL('../lib/account-helpers.mjs', import.meta.url), 'utf8').replaceAll('export function', 'function');
  const panelsCode = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    React,
    Intl,
    URL,
    window: { addEventListener() {}, removeEventListener() {} },
    location: { pathname: '/' },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} }, querySelector: () => null },
    setInterval: () => 1,
    clearInterval: () => {},
    UP: 'row', TP: 'card', VP: 'section', Uy: 'button', XP: 'switch', k0: 'disclosure',
    dq: ({ name }) => ({ type: 'icon', props: { name }, children: [] }),
    Sy: 'tooltip',
    navigator: { clipboard: { writeText: async () => {} } },
    HC: 'popover', IC: 'popover-trigger', JC: 'popover-content',
    kT: 'select', lT: 'select-trigger', mT: 'select-menu', nT: 'select-item'
  });
  vm.runInContext(`(() => { ${dashboardCode}\n${helperCode}\nglobalThis.__agyDashboard = { modelIdentity, timestampToMs, resolveWeeklyQuotaWindow, dateRange, summarizeRequests, subscriptionIdentity, distributionModels }; globalThis.__agyAccounts = { quotaGroupMeta, accountBucketStatus, summarizeAccountQuota, formatRelativeTime, formatResetCountdown, formatCompactCountdown, accountInitials, selectAutoSwitchCandidate }; })();`, context);
  vm.runInContext(panelsCode, context);

  const opts = {
    enabled: true,
    language: 'zh-CN',
    proxyEnabled: true,
    proxyUrl: 'http://127.0.0.1:7897',
    proxyBypass: 'localhost,127.0.0.1,::1',
    proxyForceHttp1: false
  };
  const panels = context.__agyPanels({
    version: '2.18.0',
    t: v => v,
    defaults: opts,
    options: () => opts,
    settingsError: () => '',
    state: () => ({ contextWindow: { maxTokens: 200000 } }),
    accounts: () => null,
    account: () => null,
    accountFetchedAt: () => null,
    dashboard: () => null,
    proxyStatus: () => ({
      configured: true,
      configuredDisplayUrl: 'http://127.0.0.1:7897',
      mismatch: true,
      reason: 'not-applied',
      canRelaunch: true
    }),
    relaunchWithProxy: async () => ({
      ok: false,
      relaunching: false,
      manualRestartRequired: true,
      reason: 'relaunch-blocked'
    }),
    capabilities: () => ({}),
    estimates: () => [],
    subscribe: () => () => {},
    revision: () => 0,
    request: () => Promise.resolve({ status: 'idle' }),
    change: async patch => { Object.assign(opts, patch); },
    loadDashboard: async () => null,
    loadAccounts: async () => null,
    loadProxyStatus: async () => null,
    isTurnRunning: () => false
  });

  function renderChild(node) {
    const prevComp = activeComponent;
    const prevIdx = hookIdx;
    activeComponent = `${prevComp}>${node.type.name || 'fn'}:${node.props?.key ?? ''}`;
    hookIdx = 0;
    try { return node.type({ ...node.props, children: node.children }); }
    finally { activeComponent = prevComp; hookIdx = prevIdx; }
  }
  function collectText(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(collectText).join(' ');
    if (typeof node === 'object') {
      if (typeof node.type === 'function') return collectText(renderChild(node));
      const children = Array.isArray(node.children) ? node.children : [node.children];
      return [collectText(children), collectText(node.props?.label), collectText(node.props?.rightElement), collectText(node.props?.extraContent)].filter(Boolean).join(' ');
    }
    return '';
  }
  function find(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const item of node) { const r = find(item, id); if (r) return r; } return null; }
    if (node.props?.['data-testid'] === id) return node;
    if (typeof node.type === 'function') return find(renderChild(node), id);
    for (const value of [...(Array.isArray(node.children) ? node.children : [node.children]), node.props?.label, node.props?.rightElement, node.props?.extraContent]) {
      const r = find(value, id);
      if (r) return r;
    }
    return null;
  }

  const renderSettings = () => { activeComponent = 'settings'; hookIdx = 0; return panels.Settings(); };
  let tree = renderSettings();
  const applyBtn = find(tree, 'agy-proxy-apply-btn');
  assert.ok(applyBtn);

  applyBtn.props.onClick();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  tree = renderSettings();
  const fb = find(tree, 'agy-proxy-feedback');
  assert.ok(fb, 'Expected proxy feedback element after blocked relaunch');
  assert.equal(fb.props['data-tone'], 'error');
  assert.equal(fb.props.role, 'alert');
  const fbText = collectText(fb);
  assert.ok(fbText.includes('安全软件拦截'), `Expected blocked relaunch message, got: ${fbText}`);
  assert.equal(fbText.includes('正在重启 Antigravity'), false);
  assert.doesNotMatch(fbText, FORBIDDEN_DOTS);
  assert.equal(find(tree, 'agy-proxy-apply-btn').props.disabled, false);
});

test('native-host proxy.relaunch returns fail-closed manualRestartRequired with manualCommand and clears relaunchPendingUntil immediately when blocked', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agy-host-relaunch-fallback-'));
  const portFile = join(dataDir, 'port');
  const origin = 'https://127.0.0.1:5055';
  const fetchBefore = globalThis.fetch;
  let stop, receiveEvent, lastReply, verifyCalls = 0;
  try {
    writeFileSync(portFile, '12345\n');
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ enabled: true, proxyEnabled: false, language: 'zh-CN' }));
    globalThis.fetch = async () => ({
      json: async () => [{
        id: 'win-1',
        type: 'page',
        title: 'Antigravity',
        url: origin + '/c/a',
        webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/a'
      }]
    });
    stop = startNativeIntegration({
      portFile,
      dataDir,
      parseSessionData: () => ({}),
      onStatus: () => {},
      discover: async () => [],
      scheduleRelaunch: () => ({ scheduled: true, target: join(dataDir, 'Antigravity.exe'), ackFile: join(dataDir, 'relaunch-ack.json') }),
      verifyRelaunch: async scheduled => {
        verifyCalls++;
        return { ...scheduled, scheduled: false, confirmed: false, manualRestartRequired: true, reason: 'relaunch-blocked' };
      },
      connect: async () => ({
        socket: { addEventListener() {}, close() {} },
        onEvent(cb) { receiveEvent = cb; },
        async send(method, params) {
          if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame' } } };
          if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script' };
          if (params?.expression?.startsWith('globalThis.__agyPowertoolsReceive?.(')) {
            vm.runInNewContext(params.expression, {
              __agyPowertoolsReceive: (id, data) => { lastReply = JSON.parse(JSON.stringify(data)); }
            });
          }
          return { result: { value: false } };
        }
      })
    });
    await stop.ready;
    await receiveEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 10, origin, auxData: { isDefault: true, frameId: 'frame' } } } });

    // First call blocked -> fails closed with manualRestartRequired, manualCommand, and NO error lock
    lastReply = null;
    await receiveEvent({ method: 'Runtime.bindingCalled', params: { name: '__agyPowertoolsHost', executionContextId: 10, payload: JSON.stringify({ id: 1, method: 'proxy.relaunch', force: true }) } });
    assert.equal(verifyCalls, 1);
    assert.equal(lastReply.ok, false);
    assert.equal(lastReply.relaunching, false);
    assert.equal(lastReply.manualRestartRequired, true);
    assert.equal(lastReply.reason, 'relaunch-blocked');
    assert.equal(typeof lastReply.manualCommand, 'string');
    assert.ok(lastReply.manualCommand.includes('--remote-debugging-port'));

    // Immediate retry must NOT fail with the 10s "正在重启 Antigravity，请稍候" lockout
    lastReply = null;
    await receiveEvent({ method: 'Runtime.bindingCalled', params: { name: '__agyPowertoolsHost', executionContextId: 10, payload: JSON.stringify({ id: 2, method: 'proxy.relaunch', force: true }) } });
    assert.equal(verifyCalls, 2);
    assert.equal(lastReply.error, undefined);
    assert.equal(lastReply.manualRestartRequired, true);
  } finally {
    await stop?.();
    globalThis.fetch = fetchBefore;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
