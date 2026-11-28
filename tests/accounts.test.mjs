import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import {
  quotaGroupMeta,
  accountBucketStatus,
  summarizeAccountQuota,
  formatRelativeTime,
  formatResetCountdown,
  formatCompactCountdown,
  accountInitials,
  selectAutoSwitchCandidate
} from '../lib/account-helpers.mjs';
import { createAccountsStore } from '../lib/accounts.mjs';
import { createQuotaTracker } from '../lib/quota.mjs';
import { toZhTw } from '../lib/zh-tw.mjs';

function createFakeVault(initial = {}) {
  const slots = new Map(Object.entries(initial));
  const hashOf = v => `H_${String(v)}`;
  return {
    supported: true,
    slots,
    has(target) { return slots.has(target); },
    inspect(target) {
      const value = slots.get(target);
      const owner = ({ 'token-A': 'alpha', 'token-B': 'beta', 'tok-a': 'alpha', 'tok-b': 'beta', 'tok-alpha': 'alpha', 'tok-beta': 'beta' })[value];
      return slots.has(target) ? { exists: true, hash: hashOf(value), ...(owner ? { email: `${owner}@example.com` } : {}) } : { exists: false, hash: '' };
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

test('accountBucketStatus, countdowns, and selectAutoSwitchCandidate work accurately without middle dots', () => {
  const now = 1_700_000_000_000;
  const rawOk = { bucketId: 'g-5h', window: '5h', remainingFraction: 0.72, resetTimeMs: now + 3600_000 };
  const rawWarn = { bucketId: 'g-5h', window: '5h', remainingFraction: 0.18, resetTimeMs: now + 3600_000 };
  const rawCrit = { bucketId: 'c-5h', window: '5h', remainingFraction: 0.05, resetTimeMs: now + 3600_000 };
  const rawReset = { bucketId: 'c-5h', window: '5h', remainingFraction: 0.12, resetTimeMs: now - 60_000 };

  assert.equal(accountBucketStatus(rawOk, now).tone, 'ok');
  assert.equal(accountBucketStatus(rawWarn, now).tone, 'warning');
  assert.equal(accountBucketStatus(rawCrit, now).tone, 'critical');
  const reset = accountBucketStatus(rawReset, now);
  assert.equal(reset.isReset, true);
  assert.equal(reset.effectiveFraction, 1);
  assert.equal(reset.tone, 'ok');

  const summary = summarizeAccountQuota({
    groups: [
      { displayName: 'Gemini Models', buckets: [rawOk] },
      { displayName: 'Claude and GPT models', buckets: [rawCrit, rawReset] },
      { displayName: 'Gemini 4 Argon', buckets: [{ bucketId: 'gemini-argon-wtu-weekly', window: 'weekly', remainingFraction: 1, resetTimeMs: now + 6 * 86400_000 }] }
    ]
  }, now);
  assert.equal(summary.overallTone, 'critical');
  assert.equal(summary.hasResetBucket, true);
  assert.deepEqual(summary.groups.map(g => g.key), ['gemini', 'claude', 'argon']);
  assert.deepEqual(summary.groups.map(g => g.shortName), ['Gemini', 'Claude / GPT', 'Argon']);
  assert.deepEqual(quotaGroupMeta({ displayName: 'Gemini 4 Argon', buckets: [{ bucketId: 'gemini-argon-wtu-weekly' }] }), { key: 'argon', shortName: 'Argon', compactName: 'Argon' });

  assert.equal(formatResetCountdown(now - 1000, now, 'zh-CN'), '');
  assert.equal(formatCompactCountdown(now - 1000, now), '');
  assert.equal(formatCompactCountdown(now + 4 * 3600_000 + 56 * 60_000, now), '4h 56m');
  assert.equal(formatCompactCountdown(now + 3 * 86400_000 + 2 * 3600_000, now), '3d 2h');
  for (const s of [
    formatRelativeTime(now - 20_000, now, 'zh-CN'),
    formatRelativeTime(now - 5 * 60_000, now, 'en'),
    formatResetCountdown(now + 2 * 3600_000 + 15 * 60_000, now, 'zh-CN')
  ]) {
    assert.equal(s.includes('\u00b7'), false);
  }
  assert.equal(accountInitials({ name: 'Alice Chen', alias: '主力', email: 'alice@example.com' }), 'A');

  const candidates = [
    { id: 'active', disabled: false, hasCredential: true, lastUsedAtMs: 10, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0, resetTimeMs: now + 3600_000 }] }] },
    { id: 'disabled-high', disabled: true, hasCredential: true, lastUsedAtMs: 1, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1, resetTimeMs: now + 3600_000 }] }] },
    { id: 'no-cred', disabled: false, hasCredential: false, lastUsedAtMs: 1, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1, resetTimeMs: now + 3600_000 }] }] },
    { id: 'low', disabled: false, hasCredential: true, lastUsedAtMs: 2, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.04, resetTimeMs: now + 3600_000 }] }] },
    { id: 'medium', disabled: false, hasCredential: true, lastUsedAtMs: 3, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.65, resetTimeMs: now + 3600_000 }] }] },
    { id: 'expired-full', disabled: false, hasCredential: true, lastUsedAtMs: 4, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.1, resetTimeMs: now - 10_000 }] }] }
  ];
  assert.equal(selectAutoSwitchCandidate(candidates, 'active', 'gemini', now).id, 'expired-full');
});

test('createAccountsStore strips legacy preview seeds, syncs real avatars/profiles, backs up credentials, switches, and enforces auto-switch guards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-accounts-v2-'));
  let clock = 1_700_000_000_000;
  let relaunches = 0;
  const vault = createFakeVault({ 'gemini:antigravity': 'token-A' });
  try {
    // Seed legacy preview state and confirm migration discards preview entries cleanly
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({
      version: 1,
      mode: 'preview',
      activeId: 'preview-ultra-main',
      accounts: [{ id: 'preview-ultra-main', email: 'fake@example.com', source: 'preview' }]
    }));

    const store = createAccountsStore(dir, { now: () => clock, vault, relaunch: () => { relaunches++; } });
    assert.deepEqual(store.list().accounts, []);

    const avatar = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const first = store.syncActive({
      email: 'alpha@example.com',
      name: 'Alice Chen',
      avatarUrl: avatar,
      tier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' },
      groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.85, resetTimeMs: clock + 3600_000 }] }]
    });
    assert.equal(first.accounts.length, 1);
    assert.equal(first.accounts[0].name, 'Alice Chen');
    assert.equal(first.accounts[0].avatarUrl, avatar);
    assert.equal(first.accounts[0].hasCredential, true);
    assert.equal(vault.slots.get(`agy-powertools:account:${first.activeId}`), 'token-A');

    // Reject unsafe avatar URLs
    const unsafe = store.syncActive({ email: 'alpha@example.com', avatarUrl: 'javascript:alert(1)' });
    assert.equal(unsafe.accounts[0].avatarUrl, avatar);

    // Prepare add backs up current active account and stores pendingAlias
    const prep = store.prepareAdd({ pendingAlias: '公司备用' });
    assert.equal(prep.backedUpId, first.activeId);

    // Simulate logging into second Google account
    vault.slots.set('gemini:antigravity', 'token-B');
    clock += 10_000;
    const second = store.syncActive({
      email: 'beta@example.com',
      name: 'Beta User',
      tier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
      groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.95, resetTimeMs: clock + 3600_000 }] }]
    });
    assert.equal(second.accounts.length, 2);
    const betaAcct = second.accounts.find(a => a.email === 'beta@example.com');
    const alphaAcct = second.accounts.find(a => a.email === 'alpha@example.com');
    assert.equal(betaAcct.alias, '公司备用');
    assert.equal(vault.slots.get(`agy-powertools:account:${betaAcct.id}`), 'token-B');

    // Switch back to alpha -> saves active beta slot, restores alpha slot, sets pendingSwitch lock, triggers relaunch
    const sw = store.switchAccount(alphaAcct.id);
    assert.equal(sw.ok, true);
    assert.equal(sw.relaunching, true);
    assert.equal(relaunches, 1);
    assert.equal(vault.slots.get('gemini:antigravity'), 'token-A');

    // Anti-clobber guard: stale syncActive from the closing old beta UI MUST NOT overwrite beta's vault slot with token-A
    const ignored = store.syncActive({ email: 'beta@example.com', name: 'Beta User' });
    assert.equal(ignored.activeId, alphaAcct.id);
    assert.equal(vault.slots.get(`agy-powertools:account:${betaAcct.id}`), 'token-B');

    // Once relaunched Antigravity boots as alpha, syncActive clears pendingSwitch cleanly
    const confirmed = store.syncActive({ email: 'alpha@example.com', name: 'Alice Chen' });
    assert.equal(confirmed.activeId, alphaAcct.id);

    // Custom account ordering persists across store reloads
    const reordered = store.reorderAccounts([betaAcct.id, alphaAcct.id]);
    assert.deepEqual(reordered.accounts.map(a => a.id), [betaAcct.id, alphaAcct.id]);
    assert.deepEqual(createAccountsStore(dir, { now: () => clock, vault }).list().accounts.map(a => a.id), [betaAcct.id, alphaAcct.id]);

    // Disable beta -> blocks BOTH manual and auto switching
    store.setDisabled(betaAcct.id, true);
    assert.equal(store.pickAutoSwitch('gemini').candidate, null);
    assert.throws(() => store.switchAccount(betaAcct.id), /禁用/);
    assert.throws(() => store.switchAccount(betaAcct.id, { auto: true }), /禁用/);

    // refreshLocalQuotas updates expired reset windows on inactive accounts without dropping active data
    clock += 4_000_000;
    const localRefreshed = store.refreshLocalQuotas({ accountId: betaAcct.id });
    assert.equal(localRefreshed.ok, true);
    assert.equal(localRefreshed.accounts.find(a => a.id === betaAcct.id).groups[0].buckets[0].remainingFraction, 1);

    // refreshCredentials validates OS keyring slots globally and per-account
    const credAll = store.refreshCredentials();
    assert.equal(credAll.ok, true);
    assert.equal(credAll.checked, 2);
    assert.equal(credAll.valid, 2);
    assert.equal(credAll.invalid, 0);
    const credOne = store.refreshCredentials({ accountId: betaAcct.id });
    assert.equal(credOne.ok, true);
    assert.equal(credOne.account.hasCredential, true);

    // Re-enable beta -> auto switch candidate resolves and enforces 120s cooldown
    store.setDisabled(betaAcct.id, false);
    assert.equal(store.pickAutoSwitch('gemini').candidate.id, betaAcct.id);
    store.switchAccount(betaAcct.id, { auto: true });
    assert.ok(store.pickAutoSwitch('gemini').cooldownRemainingMs > 0);
    assert.throws(() => store.switchAccount(alphaAcct.id, { auto: true }), /冷却/);

    // Duplicate credential hash detection rejects switching into a clobbered slot and marks hasCredential false
    vault.slots.set(`agy-powertools:account:${alphaAcct.id}`, 'token-B');
    store.syncActive({ email: 'beta@example.com', name: 'Beta User' });
    assert.throws(() => store.switchAccount(alphaAcct.id), /重新登录/);
    assert.equal(store.list().accounts.find(a => a.id === alphaAcct.id).hasCredential, false);

    // Migrated account without stored credHash whose vault slot matches active hash is flagged immediately on syncActive
    const rawJson = JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8'));
    const rawAlpha = rawJson.accounts.find(a => a.id === alphaAcct.id);
    rawAlpha.hasCredential = true;
    rawAlpha.credHash = '';
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify(rawJson, null, 2));
    store.syncActive({ email: 'beta@example.com', name: 'Beta User' });
    assert.equal(store.list().accounts.find(a => a.id === alphaAcct.id).hasCredential, false);

    // Cannot remove active account; removing inactive cleans vault slot too
    assert.throws(() => store.removeAccount(betaAcct.id), /切换/);
    store.removeAccount(alphaAcct.id);
    assert.equal(vault.hasSaved(alphaAcct.id), false);
    assert.equal(store.list().accounts.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quota tracker isolates cycle samples by accountKey without cross-account bleed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-quota-iso-'));
  try {
    const tracker = createQuotaTracker(dir);
    const now = 1_700_000_000_000;
    const reqs = [{ model: 'gemini-4-neon', timestampMs: now - 600_000, inputTokens: 1000, cacheReadTokens: 0, outputTokens: 500 }];
    const rates = [{ model: 'gemini-4-neon', input: 3, output: 15, cache: 0.15 }];
    tracker.observe([{ buckets: [{ bucketId: 'gemini-5h', remainingFraction: 0.8, resetTimeMs: now + 3600_000 }] }], reqs, rates, now, 'alpha@example.com');
    tracker.observe([{ buckets: [{ bucketId: 'gemini-5h', remainingFraction: 0.5, resetTimeMs: now + 7200_000 }] }], reqs, rates, now + 1000, 'beta@example.com');

    const saved = JSON.parse(readFileSync(join(dir, 'quota-samples.json'), 'utf8'));
    assert.equal(saved.some(s => s.id === 'alpha@example.com::gemini-5h'), true);
    assert.equal(saved.some(s => s.id === 'beta@example.com::gemini-5h'), true);
    assert.deepEqual(tracker.samples('alpha@example.com', now).map(s => s.resetTimeMs), [now + 3600_000]);
    assert.deepEqual(tracker.samples('beta@example.com', now).map(s => s.resetTimeMs), [now + 7200_000]);
    assert.deepEqual(tracker.samples('charlie@example.com', now), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createPanelHarness(accountsData, opts = {}, hooks = {}) {
  const componentStates = new Map();
  let activeComponent = 'default';
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
    useEffect: (fn, deps) => {
      if (typeof hooks.useEffect === 'function') hooks.useEffect(fn, deps);
    },
    useSyncExternalStore: (_, getSnap) => getSnap()
  };
  const dashboardCode = readFileSync(new URL('../lib/dashboard.mjs', import.meta.url), 'utf8').replaceAll('export function', 'function');
  const helperCode = readFileSync(new URL('../lib/account-helpers.mjs', import.meta.url), 'utf8').replaceAll('export function', 'function');
  const panelsCode = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    React,
    Intl,
    URL,
    __agyToZhTw: toZhTw,
    window: { addEventListener() {}, removeEventListener() {} },
    location: { pathname: '/' },
    ...(hooks.localStorage ? { localStorage: hooks.localStorage } : {}),
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} }, querySelector: hooks.querySelector || (() => null) },
    setInterval: hooks.setInterval || (() => 1),
    clearInterval: hooks.clearInterval || (() => {}),
    UP: 'row',
    TP: 'card',
    VP: 'section',
    Uy: 'button',
    XP: 'switch',
    k0: 'disclosure',
    dq: ({ name }) => ({ type: 'icon', props: { name }, children: [] }),
    Sy: 'tooltip',
    navigator: hooks.navigator ?? { clipboard: { writeText: async text => { hooks.onClipboardWrite?.(text); } } },
    HC: hooks.Popover || 'popover',
    IC: 'popover-trigger',
    JC: 'popover-content',
    kT: 'select',
    lT: 'select-trigger',
    mT: 'select-menu',
    nT: 'select-item'
  });
  vm.runInContext(`(() => { ${dashboardCode}\n${helperCode}\nglobalThis.__agyDashboard = { modelIdentity, timestampToMs, resolveWeeklyQuotaWindow, dateRange, summarizeRequests, subscriptionIdentity, distributionModels }; globalThis.__agyAccounts = { quotaGroupMeta, accountBucketStatus, summarizeAccountQuota, formatRelativeTime, formatResetCountdown, formatCompactCountdown, accountInitials, selectAutoSwitchCandidate }; })();`, context);
  vm.runInContext(panelsCode, context);
  const currentOpts = { enabled: true, language: 'zh-CN', overviewRange: 'weeklyQuota', titlebarQuickPanel: true, multiAccount: true, accountSwitcher: true, accountViewMode: 'list', accountQuotaWindow: '5h', autoSwitchAccount: false, proxyEnabled: false, ...opts };
  const panels = context.__agyPanels({
    version: '2.15.0',
    t: v => v,
    defaults: currentOpts,
    options: () => currentOpts,
    fxRate: () => (typeof hooks.fxRate === 'function' ? hooks.fxRate() : hooks.fxRate),
    settingsError: () => '',
    state: () => ({ contextWindow: { maxTokens: 200000 } }),
    accounts: () => accountsData,
    account: () => hooks.account ?? null,
    accountFetchedAt: () => hooks.accountFetchedAt ?? null,
    dashboard: () => typeof hooks.dashboard === 'function' ? hooks.dashboard() : (hooks.dashboard ?? null),
    proxyStatus: () => typeof hooks.proxyStatus === 'function' ? hooks.proxyStatus() : (hooks.proxyStatus ?? null),
    capabilities: () => hooks.capabilities ?? { plan: 'Google AI Ultra', planId: 'g1-ultra-tier', email: 'alice@example.com', name: 'Alice Chen' },
    estimates: () => hooks.estimates ?? [],
    subscribe: () => () => {},
    revision: () => 0,
    request: () => Promise.resolve({ status: 'idle' }),
    change: patch => { Object.assign(currentOpts, patch); hooks.onChange?.(patch); return Promise.resolve(); },
    loadDashboard: force => { hooks.onLoadDashboard?.(force); return Promise.resolve(typeof hooks.dashboard === 'function' ? hooks.dashboard() : hooks.dashboard); },
    loadAccounts: () => { hooks.onLoadAccounts?.(); return Promise.resolve(accountsData); },
    loadProxyStatus: () => { hooks.onLoadProxyStatus?.(); return Promise.resolve(typeof hooks.proxyStatus === 'function' ? hooks.proxyStatus() : hooks.proxyStatus); },
    beamPreview: () => typeof hooks.beamPreview === 'function' ? hooks.beamPreview() : Boolean(hooks.beamPreview),
    setBeamPreview: v => hooks.onSetBeamPreview?.(v),
    openManagementTab: tab => hooks.onOpenManagementTab?.(tab),
    openNativeSettings: () => hooks.onOpenSettings?.(),
    refreshAccountQuotas: id => {
      hooks.onRefreshQuotas?.(id);
      return hooks.refreshAccountQuotasImpl ? hooks.refreshAccountQuotasImpl(id) : Promise.resolve({ ok: true });
    },
    refreshAccountCredentials: id => { hooks.onRefreshCredentials?.(id); return Promise.resolve({ ok: true }); },
    switchAccount: id => (hooks.switchAccountImpl ? hooks.switchAccountImpl(id) : Promise.resolve({ ok: true })),
    startAddAccount: alias => (hooks.startAddAccountImpl ? hooks.startAddAccountImpl(alias) : Promise.resolve({ ok: true })),
    loginSession: () => (hooks.loginSession ? hooks.loginSession() : { active: false, authUrl: '', mode: 'none' }),
    onLoginSessionChange: cb => (hooks.onLoginSessionChange ? hooks.onLoginSessionChange(cb) : () => {}),
    cancelAccountLogin: () => hooks.onCancelAccountLogin?.(),
    updateNotice: () => (typeof hooks.updateNotice === 'function' ? hooks.updateNotice() : (hooks.updateNotice ?? null)),
    updateInstallState: () => (hooks.updateInstallState ?? { status: 'idle' }),
    consumeExpandUpdateNotes: () => Boolean(hooks.expandUpdateNotes),
    consumeScrollToAbout: () => Boolean(hooks.scrollToAbout),
    openUpdateSettings: () => hooks.onOpenUpdateSettings?.(),
    syncUpdateResult: res => hooks.onSyncUpdateResult?.(res),
    isTurnRunning: () => Boolean(hooks.isTurnRunning?.()),
    betaProviders: () => (typeof hooks.betaProviders === 'function' ? hooks.betaProviders() : hooks.betaProviders),
    betaProvidersList: () => (hooks.betaProvidersList ? hooks.betaProvidersList() : Promise.resolve({ ok: true, providers: [] })),
    betaProviderSave: payload => (hooks.betaProviderSave ? hooks.betaProviderSave(payload) : Promise.resolve({ ok: true, provider: payload, providers: [payload] })),
    betaProviderDelete: id => (hooks.betaProviderDelete ? hooks.betaProviderDelete(id) : Promise.resolve({ ok: true, removed: true, providers: [] })),
    betaAiListModels: params => (hooks.betaAiListModels ? hooks.betaAiListModels(params) : Promise.resolve({ ok: true, models: [] })),
    betaAiTest: params => (hooks.betaAiTest ? hooks.betaAiTest(params) : Promise.resolve({ ok: true, latencyMs: 42, model: params?.model || '' })),
    betaClearTranslateCache: () => (hooks.betaClearTranslateCache ? hooks.betaClearTranslateCache() : Promise.resolve({ ok: true }))
  });
  function renderChild(node) {
    const prevComp = activeComponent;
    const prevIdx = hookIdx;
    activeComponent = `${prevComp}>${node.type.name || 'fn'}:${node.props?.key ?? ''}`;
    hookIdx = 0;
    try {
      return node.type({ ...node.props, children: node.children });
    } finally {
      activeComponent = prevComp;
      hookIdx = prevIdx;
    }
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
  function findAll(node, pred, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { for (const item of node) findAll(item, pred, out); return out; }
    if (pred(node)) out.push(node);
    if (typeof node.type === 'function') return findAll(renderChild(node), pred, out);
    for (const value of [...(Array.isArray(node.children) ? node.children : [node.children]), node.props?.label, node.props?.rightElement, node.props?.extraContent]) {
      findAll(value, pred, out);
    }
    return out;
  }
  return {
    renderOverview: dashboard => { activeComponent = 'overview'; hookIdx = 0; return panels.Overview({ dashboard }); },
    renderEventTable: (dashboard, errors = false) => { activeComponent = errors ? 'errors' : 'requests'; hookIdx = 0; return panels.EventTable({ dashboard, errors }); },
    renderSwitcher: () => { activeComponent = 'switcher'; hookIdx = 0; return panels.AccountSwitcher(); },
    renderQuickPopover: () => { activeComponent = 'quick-popover'; hookIdx = 0; return panels.QuickPopover(); },
    renderPage: () => { activeComponent = 'page'; hookIdx = 0; return panels.Page(); },
    renderOverviewQuota: () => { activeComponent = 'overview-quota'; hookIdx = 0; return panels.OverviewQuota(); },
    renderQuotas: () => { activeComponent = 'quotas'; hookIdx = 0; return panels.Quotas(); },
    renderPricing: dashboard => { activeComponent = 'pricing'; hookIdx = 0; return panels.Pricing({ dashboard }); },
    renderSettings: () => { activeComponent = 'settings'; hookIdx = 0; return panels.Settings(); },
    renderSidebar: () => { activeComponent = 'sidebar'; hookIdx = 0; return panels.Sidebar(); },
    renderAbout: () => { activeComponent = 'about'; hookIdx = 0; return panels.About(); },
    unmountComponent: name => { for (const k of [...componentStates.keys()]) if (k === name || k.startsWith(`${name}>`)) componentStates.delete(k); },
    collectText,
    find,
    findAll
  };
}

test('AccountSwitcher, Quotas, and Settings implement master switch risk warning, Argon group, integrated native settings, and refresh controls', () => {
  const now = Date.now();
  const realAccounts = [
    {
      id: 'acct-1',
      email: 'alice@example.com',
      name: 'Alice Chen',
      alias: '主力号',
      avatarUrl: 'data:image/jpeg;base64,AAAA',
      tier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' },
      disabled: false,
      hasCredential: true,
      syncedAtMs: now,
      lastUsedAtMs: now,
      groups: [
        { displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.86, resetTimeMs: now + 3600_000 }, { bucketId: 'g-w', window: 'weekly', remainingFraction: 0.42, resetTimeMs: now + 4 * 86400_000 }] },
        { displayName: 'Claude and GPT models', buckets: [{ bucketId: 'c-5h', window: '5h', remainingFraction: 0.94, resetTimeMs: now + 3600_000 }, { bucketId: 'c-w', window: 'weekly', remainingFraction: 0.77, resetTimeMs: now + 5 * 86400_000 }] }
      ]
    },
    {
      id: 'acct-2',
      email: 'bob@example.com',
      name: 'Bob Lin',
      alias: '',
      avatarUrl: '',
      tier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
      disabled: false,
      hasCredential: true,
      syncedAtMs: now - 300_000,
      lastUsedAtMs: now - 300_000,
      groups: [
        { displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 1, resetTimeMs: now + 3600_000 }] },
        { displayName: 'Claude and GPT models', buckets: [{ bucketId: 'c-5h', window: '5h', remainingFraction: 1, resetTimeMs: now + 3600_000 }] },
        { displayName: 'Gemini 4 Argon', buckets: [{ bucketId: 'gemini-argon-wtu-weekly', window: 'weekly', remainingFraction: 1, resetTimeMs: now + 6 * 86400_000 }] }
      ]
    },
    {
      id: 'acct-3',
      email: 'backup@example.com',
      name: 'Backup Dev',
      alias: '',
      avatarUrl: '',
      tier: { id: 'g1-plus-tier', name: 'Google AI Plus' },
      disabled: true,
      hasCredential: true,
      syncedAtMs: now - 600_000,
      lastUsedAtMs: now - 600_000,
      groups: [
        { displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.1, resetTimeMs: now - 60_000 }] }
      ]
    }
  ];

  // Master switch OFF: hides switcher & accounts management, Settings opens risk confirmation dialog before enabling
  const changes = [];
  const offUi = createPanelHarness({ activeId: 'acct-1', accounts: realAccounts }, { multiAccount: false }, { onChange: p => changes.push(p) });
  assert.equal(offUi.renderSwitcher(), null);
  assert.equal(offUi.find(offUi.renderQuotas(), 'agy-accounts-overview'), null);
  let settingsTree = offUi.renderSettings();
  offUi.find(settingsTree, 'agy-settings-cat-accounts').props.onClick();
  settingsTree = offUi.renderSettings();
  const masterToggle = offUi.find(settingsTree, 'agy-setting-multiAccount');
  assert.ok(masterToggle);
  assert.equal(offUi.find(settingsTree, 'agy-setting-accountSwitcher'), null);
  masterToggle.props.onCheckedChange(true);
  assert.equal(changes.length, 0);
  settingsTree = offUi.renderSettings();
  const riskDialog = offUi.find(settingsTree, 'agy-multi-account-risk-dialog');
  assert.ok(riskDialog);
  assert.ok(offUi.collectText(riskDialog).includes('Google'));
  offUi.find(riskDialog, 'agy-multi-account-risk-confirm').props.onClick();
  assert.deepEqual(changes.map(c => ({ ...c })), [{ multiAccount: true }]);

  // Master switch ON: test Switcher trigger & popover
  let settingsOpened = 0;
  const refreshedQuotas = [];
  const refreshedCreds = [];
  const listUi = createPanelHarness(
    { activeId: 'acct-1', accounts: realAccounts },
    { multiAccount: true, accountViewMode: 'list' },
    {
      onOpenSettings: () => settingsOpened++,
      onRefreshQuotas: id => refreshedQuotas.push(id),
      onRefreshCredentials: id => refreshedCreds.push(id)
    }
  );
  let swTree = listUi.renderSwitcher();
  const trigger = listUi.find(swTree, 'agy-account-switcher-trigger');
  assert.ok(trigger);
  const triggerImgs = listUi.findAll(trigger, n => n.type === 'img');
  assert.equal(triggerImgs.length, 1);
  assert.equal(triggerImgs[0].props.src, 'data:image/jpeg;base64,AAAA');
  const triggerText = listUi.collectText(trigger);
  assert.ok(triggerText.includes('Alice Chen'));
  assert.ok(triggerText.includes('主力号'));
  assert.equal(/\b周\s*\d+%/.test(triggerText), false);
  assert.equal(triggerText.includes('20x'), false);
  assert.equal(triggerText.includes('\u00b7'), false);

  // Open switcher popover: verify Argon + inline 5h/周 tags, window toggle + icon-only refresh button, native Settings entry, disabled row non-clickable
  trigger.props.onClick();
  swTree = listUi.renderSwitcher();
  const popText = listUi.collectText(swTree);
  assert.ok(popText.includes('Alice Chen'));
  assert.ok(popText.includes('Bob Lin'));
  assert.ok(popText.includes('Argon'));
  assert.ok(popText.includes('5h'));
  assert.ok(popText.includes('周'));
  assert.ok(popText.includes('86%'));
  assert.ok(popText.includes('更新于 '));
  assert.ok(popText.includes('设置'));
  assert.equal(popText.includes('刷新全部额度'), false);
  assert.equal(popText.includes('切换账号'), false);
  assert.equal(popText.includes('5H 限额'), false);
  assert.equal(popText.includes('实时同步'), false);
  assert.equal(popText.includes('已重置'), false);
  assert.equal(listUi.find(swTree, 'agy-account-row-acct-3').props.disabled, true);
  assert.equal(listUi.collectText(listUi.find(swTree, 'agy-account-row-acct-2')).includes('切换'), false);
  const popWinTabs = listUi.find(swTree, 'agy-popover-window-tabs');
  assert.ok(popWinTabs);
  // Switching popover window to weekly updates both popover and list view immediately
  popWinTabs.children[1].props.onClick();
  swTree = listUi.renderSwitcher();
  assert.ok(listUi.collectText(swTree).includes('42%'));
  const weeklyListText = listUi.collectText(listUi.renderQuotas());
  assert.ok(weeklyListText.includes('42%'));
  popWinTabs.children[0].props.onClick();
  swTree = listUi.renderSwitcher();
  assert.ok(listUi.collectText(swTree).includes('86%'));
  const acctSettingsTree = listUi.renderSettings();
  listUi.find(acctSettingsTree, 'agy-settings-cat-accounts').props.onClick();
  const acctTabTree = listUi.renderSettings();
  assert.ok(listUi.find(acctTabTree, 'agy-setting-accountSwitcher'));
  assert.equal(listUi.find(acctTabTree, 'agy-account-quota-window'), null);
  assert.equal(listUi.find(acctTabTree, 'agy-account-view-mode'), null);

  listUi.find(swTree, 'agy-popover-refresh-quotas').props.onClick();
  listUi.find(swTree, 'agy-account-open-settings').props.onClick();
  assert.deepEqual(refreshedQuotas, ['acct-1']);
  assert.equal(settingsOpened, 1);
  assert.equal(listUi.findAll(swTree, n => n.type === 'icon' && (n.props?.name === 'person_add' || n.props?.name === 'tune')).length, 0);

  // Quotas list view: Argon label, disabled hides switch button, active-only quota refresh without redundant cred/inactive refresh buttons
  const listQuotas = listUi.renderQuotas();
  assert.ok(listUi.find(listQuotas, 'agy-accounts-table'));
  assert.equal(listUi.find(listQuotas, 'agy-accounts-cards'), null);
  assert.equal(listUi.find(listQuotas, 'agy-accounts-refresh-quotas'), null);
  assert.equal(listUi.find(listQuotas, 'agy-accounts-refresh-creds'), null);
  assert.ok(listUi.find(listQuotas, 'agy-refresh-quota-acct-1'));
  assert.equal(listUi.find(listQuotas, 'agy-refresh-cred-acct-1'), null);
  assert.equal(listUi.find(listQuotas, 'agy-refresh-quota-acct-2'), null);
  assert.equal(listUi.find(listQuotas, 'agy-refresh-cred-acct-2'), null);
  assert.ok(listUi.find(listQuotas, 'agy-switch-account-acct-2'));
  assert.equal(listUi.find(listQuotas, 'agy-switch-account-acct-3'), null);
  const listText = listUi.collectText(listQuotas);
  assert.ok(listText.indexOf('当前账号额度') < listText.indexOf('账号管理与切换'));
  assert.ok(listText.includes('Argon'));
  assert.ok(listText.includes('Plus 1'));
  assert.ok(listText.includes('账号已禁用'));
  assert.equal(listText.includes('实时同步'), false);
  assert.equal(listText.includes('\u00b7'), false);
  listUi.find(listQuotas, 'agy-refresh-quota-acct-1').props.onClick();
  assert.deepEqual(refreshedQuotas, ['acct-1', 'acct-1']);

  // Quotas card view: icon-only action buttons (no mixed text labels), Argon label, disabled hides switch button, zero middle dots
  const cardUi = createPanelHarness({ activeId: 'acct-1', accounts: realAccounts }, { multiAccount: true, accountViewMode: 'card' });
  const cardQuotas = cardUi.renderQuotas();
  assert.ok(cardUi.find(cardQuotas, 'agy-accounts-cards'));
  assert.equal(cardUi.find(cardQuotas, 'agy-accounts-table'), null);
  assert.ok(cardUi.find(cardQuotas, 'agy-refresh-quota-acct-1'));
  assert.equal(cardUi.find(cardQuotas, 'agy-refresh-quota-acct-2'), null);
  assert.equal(cardUi.find(cardQuotas, 'agy-refresh-cred-acct-2'), null);
  assert.equal(cardUi.find(cardQuotas, 'agy-switch-account-acct-3'), null);
  assert.equal(cardUi.collectText(cardUi.find(cardQuotas, 'agy-switch-account-acct-2')), '');
  assert.equal(cardUi.collectText(cardUi.find(cardQuotas, 'agy-rename-account-acct-2')), '');
  const cardText = cardUi.collectText(cardQuotas);
  assert.ok(cardText.includes('Argon'));
  assert.ok(cardText.includes('更新于 '));
  for (const banned of ['实时同步', '额度充裕', '部分限额接近耗尽', '切入后自动刷新最新额度', '5 小时已回满', '已重置（预计 100%）', '\u00b7']) {
    assert.equal(cardText.includes(banned), false, `Unexpected text: ${banned}`);
  }
});


test('Overview defaults to Current weekly quota (本轮周限额内用量), displays exact reset timestamps without middle dots, and exposes Settings control', () => {
  const now = Date.now();
  const resetSec = Math.floor((now + 6 * 86400_000 + 15 * 3600_000) / 1000);
  const cycleStartMs = resetSec * 1000 - 7 * 86400_000;

  const ui = createPanelHarness(
    null,
    { multiAccount: false },
    {
      account: {
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              { bucketId: 'gemini-weekly', window: 'weekly', remaining: { case: 'remainingFraction', value: 0.99 }, resetTime: { seconds: BigInt(resetSec), nanos: 0 } }
            ]
          },
          {
            displayName: 'Claude and GPT models',
            buckets: [
              { bucketId: 'claude-weekly', window: 'weekly', remaining: { case: 'remainingFraction', value: 1 }, resetTime: null }
            ]
          }
        ]
      },
      accountFetchedAt: now
    }
  );

  const overviewTree = ui.renderOverview({
    requests: [
      // Pre-cycle Gemini request -> excluded
      { id: 'pre', model: 'Gemini 4 Carbon (High)', timestampMs: cycleStartMs - 60_000, durationMs: 1000, inputTokens: 9_000_000, cacheReadTokens: 0, outputTokens: 1000, costUsd: 18, status: 'success' },
      // Cycle-triggering request starting 400ms before cycleStartMs -> included & safe in Health buckets
      { id: 'trig', model: 'Gemini 4 Carbon (High)', timestampMs: cycleStartMs - 400, durationMs: 1200, inputTokens: 100_000, cacheReadTokens: 50_000, outputTokens: 50_000, costUsd: 0.71, status: 'success' }
    ]
  });

  const rangeBtn = ui.find(overviewTree, 'agy-range');
  assert.ok(rangeBtn);
  assert.ok(ui.collectText(rangeBtn).includes('本轮周限额内用量'));
  assert.ok(ui.find(overviewTree, 'agy-range-weeklyQuota'));

  const summaryEl = ui.find(overviewTree, 'agy-range-summary');
  const summaryText = ui.collectText(summaryEl);
  assert.ok(summaryText.includes('重置'));
  assert.equal(summaryText.includes('\u00b7'), false);

  const tokenTotal = ui.collectText(ui.find(overviewTree, 'agy-distribution-tokens-total'));
  assert.equal(tokenTotal, '200K');

  const settingsTree = ui.renderSettings();
  // Redundant overviewRange row is removed from Settings (Overview retains its own live range picker)
  assert.equal(ui.find(settingsTree, 'agy-setting-row-overviewRange'), null);
  // User bubble tint defaults to off and hides color swatch row until enabled
  assert.ok(ui.find(settingsTree, 'agy-setting-row-userBubbleTint'));
  assert.equal(ui.find(settingsTree, 'agy-setting-row-userBubbleColor'), null);
  const bubbleUi = createPanelHarness(null, { multiAccount: false, userBubbleTint: true, userBubblePreset: 'ocean' });
  const bubbleSettings = bubbleUi.renderSettings();
  assert.ok(bubbleUi.find(bubbleSettings, 'agy-setting-row-userBubbleColor'));
  assert.ok(bubbleUi.find(bubbleSettings, 'agy-bubble-preset-accent'));
  assert.ok(bubbleUi.find(bubbleSettings, 'agy-bubble-preset-ocean'));
  assert.ok(bubbleUi.find(bubbleSettings, 'agy-bubble-preview'));

  // Untouched 100% weekly quota across all pools renders explicit 100% untouched label
  const untouchedUi = createPanelHarness(
    null,
    { multiAccount: false },
    {
      account: {
        groups: [
          { displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remaining: { case: 'remainingFraction', value: 1 }, resetTime: null }] }
        ]
      },
      accountFetchedAt: now
    }
  );
  const untouchedTree = untouchedUi.renderOverview({ requests: [] });
  const untouchedText = untouchedUi.collectText(untouchedUi.find(untouchedTree, 'agy-range-summary'));
  assert.ok(untouchedText.includes('本轮周限额尚未开始消耗（剩余 100%）'));
  assert.equal(untouchedText.includes('\u00b7'), false);

  // Loading state (dashboard === null) shows equal-height skeleton instead of fake zeros or empty text
  const skelOverview = untouchedUi.renderOverview(null);
  assert.ok(untouchedUi.find(skelOverview, 'agy-overview-skeleton'));
  assert.equal(untouchedUi.find(skelOverview, 'agy-usage-heatmap'), null);
  const skelEvents = untouchedUi.renderEventTable(null, false);
  assert.ok(untouchedUi.find(skelEvents, 'agy-events-skeleton'));
  assert.equal(untouchedUi.find(skelEvents, 'agy-requests-table'), null);
});

test('quota tracker account timeline isolates multi-account quota estimates and guards pre-upgrade mixed history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-quota-timeline-'));
  try {
    const tracker = createQuotaTracker(dir);
    const base = 1_795_000_000_000;
    const rates = [{ model: 'gemini-4-neon', input: 2, output: 12, cache: 0.2 }];
    const makeReq = (id, ts, inputTokens = 500_000) => ({
      id,
      model: 'Gemini 4 Neon (High)',
      timestampMs: ts,
      durationMs: 1000,
      inputTokens,
      cacheReadTokens: 0,
      outputTokens: 10_000
    });

    // Account A (Ultra) uses 4 large requests in the first hour
    const ultraReqs = [1, 2, 3, 4].map(i => makeReq(`u${i}`, base + i * 60_000, 1_000_000));
    const ultraRes = tracker.observe(
      [{ buckets: [{ bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.9, resetTimeMs: base + 5 * 3600_000 }] }],
      ultraReqs,
      rates,
      base + 5 * 60_000,
      'ultra@example.com'
    );
    assert.equal(ultraRes.estimates[0].observedRequests, 4);
    assert.equal(tracker.emailAt(base + 60_000), 'ultra@example.com');

    // Switch to Account B (Plus) at base + 10 min; Plus makes 3 small requests
    const switchAt = base + 10 * 60_000;
    tracker.recordAccount('plus@example.com', switchAt);
    const plusReqs = [1, 2, 3].map(i => makeReq(`p${i}`, switchAt + i * 60_000, 100_000));
    const plusRes = tracker.observe(
      [{ buckets: [{ bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.8, resetTimeMs: switchAt + 5 * 3600_000 }] }],
      [...ultraReqs, ...plusReqs],
      rates,
      switchAt + 5 * 60_000,
      'plus@example.com'
    );
    // Plus MUST count only its own 3 small requests, NOT Ultra's 4 large requests
    assert.equal(plusRes.estimates[0].observedRequests, 3);
    assert.ok(plusRes.estimates[0].estimateUsd < ultraRes.estimates[0].estimateUsd);
    assert.deepEqual(tracker.accounts(), ['plus@example.com', 'ultra@example.com']);

    // Reload from disk preserves timeline
    const reloaded = createQuotaTracker(dir);
    assert.equal(reloaded.emailAt(base + 60_000), 'ultra@example.com');
    assert.equal(reloaded.emailAt(switchAt + 60_000), 'plus@example.com');

    // Pre-upgrade existing multi-account user (knownAccountCount > 1 on empty timeline) keeps old requests unattributed
    const dirUpgrade = mkdtempSync(join(tmpdir(), 'agy-quota-upgrade-'));
    try {
      const upgraded = createQuotaTracker(dirUpgrade);
      const upgradeNow = base + 30 * 60_000;
      const upRes = upgraded.observe(
        [{ buckets: [{ bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.9, resetTimeMs: upgradeNow + 5 * 3600_000 }] }],
        ultraReqs,
        rates,
        upgradeNow,
        'plus@example.com',
        { knownAccountCount: 2 }
      );
      assert.equal(upgraded.emailAt(base + 60_000), '');
      assert.equal(upRes.estimates[0].observedRequests, 0);
      assert.equal(upRes.estimates[0].estimateUsd, null);
    } finally {
      rmSync(dirUpgrade, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EventTable and Overview filter requests by account when multiple accounts exist and stay clean for single account', () => {
  const now = Date.now();
  const accountsData = {
    activeId: 'a1',
    accounts: [
      { id: 'a1', email: 'alice@example.com', name: 'Alice', alias: '主力号' },
      { id: 'a2', email: 'bob@example.com', name: 'Bob', alias: '备用号' }
    ]
  };
  const ui = createPanelHarness(accountsData, { multiAccount: true });
  const multiDash = {
    activeAccountEmail: 'alice@example.com',
    accountEmails: ['alice@example.com', 'bob@example.com'],
    requests: [
      { id: 'r1', model: 'Gemini 4 Neon', timestampMs: now - 20_000, status: 'success', inputTokens: 1000, cacheReadTokens: 0, outputTokens: 200, costUsd: 0.01, accountEmail: 'alice@example.com' },
      { id: 'r2', model: 'Claude Opus 5.5', timestampMs: now - 10_000, status: 'success', inputTokens: 2000, cacheReadTokens: 0, outputTokens: 300, costUsd: 0.02, accountEmail: 'bob@example.com' }
    ]
  };

  // Defaults to active account (alice@example.com) when active account has rows (hides redundant per-row account subtitle)
  const reqTree = ui.renderEventTable(multiDash, false);
  const acctFilter = ui.find(reqTree, 'agy-account-filter');
  assert.ok(acctFilter);
  assert.ok(ui.collectText(acctFilter).includes('主力号 (alice@example.com)'));
  assert.equal(ui.findAll(reqTree, n => n.type === 'tr' && typeof n.props?.key === 'string' && n.props.key.startsWith('req:')).length, 1);
  assert.equal(ui.findAll(reqTree, n => n.props?.['data-testid'] === 'agy-request-account').length, 0);

  // Switching account filter to all shows both accounts with their aliases
  const allOption = ui.find(reqTree, 'agy-account-filter-all');
  assert.ok(allOption);
  allOption.props.onClick();
  const reqTreeAll = ui.renderEventTable(multiDash, false);
  const badges = ui.findAll(reqTreeAll, n => n.props?.['data-testid'] === 'agy-request-account').map(n => ui.collectText(n));
  assert.deepEqual(badges, ['主力号', '备用号']);

  // Single-account mode hides account filter cleanly
  const singleUi = createPanelHarness(null, { multiAccount: false });
  const singleTree = singleUi.renderEventTable({
    activeAccountEmail: 'alice@example.com',
    accountEmails: ['alice@example.com'],
    requests: [{ id: 'r1', model: 'Gemini 4 Neon', timestampMs: now - 5_000, status: 'success', inputTokens: 1000, cacheReadTokens: 0, outputTokens: 100, accountEmail: 'alice@example.com' }]
  }, false);
  assert.equal(singleUi.find(singleTree, 'agy-account-filter'), null);
});

test('quota tracker backfills multi-account timeline from existing quota-samples.json and accounts.json without affecting single-account users', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-timeline-backfill-'));
  try {
    const tOther = 1_795_200_000_000;
    const tActiveFirst = tOther + 3600_000;
    const tColdStart = tActiveFirst + 24 * 3600_000;
    writeFileSync(join(dir, 'quota-samples.json'), JSON.stringify([
      { id: 'bob@example.com::gemini-5h', resetTimeMs: tOther + 18000_000, active: true, lastAt: tOther + 2000 },
      { id: 'alice@example.com::gemini-5h', resetTimeMs: tActiveFirst + 18000_000, active: true, lastAt: tActiveFirst },
      { id: 'alice@example.com::gemini-weekly', resetTimeMs: tColdStart + 5 * 86400_000, active: true, lastAt: tColdStart - 60_000 }
    ]));
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({
      activeId: 'a1',
      accounts: [
        { id: 'a1', email: 'alice@example.com', lastUsedAtMs: tColdStart },
        { id: 'a2', email: 'bob@example.com', lastUsedAtMs: tOther }
      ]
    }));
    // Simulate cold-start timeline that only had the post-upgrade timestamp
    writeFileSync(join(dir, 'account-timeline.json'), JSON.stringify([
      { email: 'alice@example.com', sinceMs: tColdStart }
    ]));

    const tracker = createQuotaTracker(dir);
    assert.deepEqual(tracker.timeline(), [
      { email: 'bob@example.com', sinceMs: tOther },
      { email: 'alice@example.com', sinceMs: tActiveFirst }
    ]);
    assert.equal(tracker.emailAt(tOther - 1000), '');
    assert.equal(tracker.emailAt(tOther + 10_000), 'bob@example.com');
    assert.equal(tracker.emailAt(tActiveFirst + 60_000), 'alice@example.com');
    assert.equal(tracker.emailAt(tColdStart - 10_000), 'alice@example.com');

    // Single-account user with quota-samples.json is NOT prematurely bounded
    const singleDir = mkdtempSync(join(tmpdir(), 'agy-timeline-single-'));
    try {
      writeFileSync(join(singleDir, 'quota-samples.json'), JSON.stringify([
        { id: 'solo@example.com::gemini-5h', resetTimeMs: tColdStart + 18000_000, active: true, lastAt: tActiveFirst }
      ]));
      const solo = createQuotaTracker(singleDir);
      assert.deepEqual(solo.timeline(), []);
      solo.recordAccount('solo@example.com', tColdStart, { knownAccountCount: 1 });
      assert.deepEqual(solo.timeline(), [{ email: 'solo@example.com', sinceMs: 0 }]);
      assert.equal(solo.emailAt(tOther - 86400_000), 'solo@example.com');
    } finally {
      rmSync(singleDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quota tracker uses incremental checkpoint calibration when cross-device usage occurs and OverviewQuota renders compact 5h/weekly pills', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-quota-multidev-'));
  try {
    const tracker = createQuotaTracker(dir);
    const base = 1_795_400_000_000;
    const weeklyReset = base + 6 * 86400_000;
    const rates = [{ model: 'gemini-4-neon', input: 2, output: 12, cache: 0.2 }];
    const mkReq = (id, ts, inputTokens = 1_000_000) => ({
      id, model: 'Gemini 4 Neon (High)', timestampMs: ts, durationMs: 1000,
      inputTokens, cacheReadTokens: 0, outputTokens: 50_000 // cost = $2 + $0.6 = $2.60
    });

    // Step 1: Another device (Mac) already spent 20% of the weekly quota before Windows starts (fraction = 0.80, 0 local requests)
    const first = tracker.observe(
      [{ buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.80, resetTimeMs: weeklyReset }] }],
      [],
      rates,
      base,
      'alice@example.com'
    );
    assert.equal(first.estimates[0].estimateUsd, null);

    // Step 2: Windows runs 4 local requests ($10.40 total) and weekly fraction drops 0.80 -> 0.72 (local delta = 0.08)
    // True 100% weekly budget = $10.40 / 0.08 = $130 (naive whole-cycle would wrongly give $10.40 / 0.28 = $37.14!)
    const winReqs = [1, 2, 3, 4].map(i => mkReq(`w${i}`, base + i * 60_000));
    const second = tracker.observe(
      [{ buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.72, resetTimeMs: weeklyReset }] }],
      winReqs,
      rates,
      base + 10 * 60_000,
      'alice@example.com'
    );
    assert.equal(second.estimates[0].observedRequests, 4);
    assert.ok(Math.abs(second.estimates[0].estimateUsd - 130) < 0.01, `Expected ~$130, got ${second.estimates[0].estimateUsd}`);

    // Step 3: Another device spends 10% more mid-week (0.72 -> 0.62) with ZERO new local requests -> ignored cleanly!
    const third = tracker.observe(
      [{ buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.62, resetTimeMs: weeklyReset }] }],
      winReqs,
      rates,
      base + 3600_000,
      'alice@example.com'
    );
    assert.ok(Math.abs(third.estimates[0].estimateUsd - 130) < 0.01);

    // Step 4: OverviewQuota renders compact 5h + weekly pills when enabled and stays hidden when disabled
    const accountMock = {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            { bucketId: 'gemini-weekly', window: 'weekly', remaining: { case: 'remainingFraction', value: 0.72 }, resetTime: { seconds: BigInt(Math.floor(weeklyReset / 1000)) } },
            { bucketId: 'gemini-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.85 }, resetTime: { seconds: BigInt(Math.floor((base + 14400_000) / 1000)) } }
          ]
        }
      ]
    };
    const offUi = createPanelHarness(null, { multiAccount: false, overviewQuota: false }, { account: accountMock });
    assert.equal(offUi.renderOverviewQuota(), null);
    const onUi = createPanelHarness(null, { multiAccount: false, overviewQuota: true }, { account: accountMock });
    const qTree = onUi.renderOverviewQuota();
    assert.ok(qTree);
    const qText = onUi.collectText(qTree);
    assert.ok(qText.includes('Gemini'));
    assert.ok(qText.includes('85%'));
    assert.ok(qText.includes('72%'));
    assert.equal(qText.includes('\u00b7'), false);
    const qToggle = onUi.find(qTree, 'agy-overview-quota-toggle');
    assert.ok(qToggle);
    assert.equal(qToggle.props['aria-expanded'], true);
    qToggle.props.onClick();
    const collapsedTree = onUi.renderOverviewQuota();
    const collapsedToggle = onUi.find(collapsedTree, 'agy-overview-quota-toggle');
    assert.equal(collapsedToggle.props['aria-expanded'], false);
    const collapsedText = onUi.collectText(collapsedTree);
    assert.ok(collapsedText.includes('当前额度'));
    assert.ok(collapsedText.includes('72%'));
    assert.ok(!collapsedText.includes('Gemini'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createAccountsStore blocks cross-account credential clobbering on email mismatch and relaunches cleanly on completeAdd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-accounts-mismatch-'));
  let clock = 1_795_400_000_000;
  let relaunches = 0;
  const makeToken = (email, rev) => JSON.stringify({
    token: { access_token: `acc-${email}-${rev}`, refresh_token: `rt-${email}` },
    auth_method: 'consumer',
    id_token_email: email
  });
  const emailOf = raw => {
    try { return JSON.parse(raw).id_token_email.toLowerCase(); } catch { return ''; }
  };
  const slots = new Map([['gemini:antigravity', makeToken('alpha@example.com', 1)]]);
  const hashOf = v => `H_${String(v)}`;
  const vault = {
    supported: true,
    slots,
    has: t => slots.has(t),
    inspect(t) {
      if (!slots.has(t)) return { exists: false, hash: '' };
      const raw = slots.get(t);
      const email = emailOf(raw);
      return { exists: true, hash: hashOf(raw), ...(email ? { email } : {}) };
    },
    copy(from, to, { expectedEmail = '' } = {}) {
      if (!slots.has(from)) return { ok: false, error: 'missing source' };
      const raw = slots.get(from);
      const actualEmail = emailOf(raw);
      const expected = String(expectedEmail || '').trim().toLowerCase();
      if (expected && actualEmail && actualEmail !== expected) {
        return { ok: false, mismatch: true, actualEmail, expectedEmail: expected, error: 'mismatch' };
      }
      slots.set(to, raw);
      return { ok: true, bytes: raw.length, hash: hashOf(raw), ...(actualEmail ? { email: actualEmail } : {}) };
    },
    remove: t => { slots.delete(t); return { ok: true }; },
    saveActiveTo(id, opts) { return this.copy('gemini:antigravity', `agy-powertools:account:${id}`, opts); },
    restoreToActive(id, opts) { return this.copy(`agy-powertools:account:${id}`, 'gemini:antigravity', opts); },
    hasSaved(id) { return this.has(`agy-powertools:account:${id}`); },
    inspectSaved(id) { return this.inspect(`agy-powertools:account:${id}`); },
    inspectActive() { return this.inspect('gemini:antigravity'); },
    removeSaved(id) { return this.remove(`agy-powertools:account:${id}`); }
  };

  try {
    const store = createAccountsStore(dir, {
      now: () => clock,
      vault,
      relaunch: () => { relaunches++; return { scheduled: true }; }
    });

    // 1. Initial sync of alpha
    const s1 = store.syncActive({
      email: 'alpha@example.com',
      name: 'Alpha',
      groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.14, resetTimeMs: clock + 86400_000 }] }]
    });
    const alphaId = s1.activeId;

    // 2. prepareAdd -> sign in as beta -> syncActive -> completeAdd triggers relaunch + pendingSwitch lock
    const prep = store.prepareAdd({ pendingAlias: 'Ultra 20X' });
    assert.equal(prep.backedUpId, alphaId);
    assert.ok(prep.prevCredHash);
    slots.set('gemini:antigravity', makeToken('beta@example.com', 1));
    clock += 5_000;
    const s2 = store.syncActive({
      email: 'beta@example.com',
      name: 'Beta',
      groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.95, resetTimeMs: clock + 7 * 86400_000 }] }]
    });
    const betaId = s2.activeId;
    assert.notEqual(betaId, alphaId);
    assert.equal(s2.accounts.find(a => a.id === betaId).alias, 'Ultra 20X');

    const completed = store.completeAdd({ email: 'beta@example.com', prevEmail: 'alpha@example.com', prevCredHash: prep.prevCredHash });
    assert.equal(completed.ok, true);
    assert.equal(completed.relaunching, true);
    assert.equal(completed.manualRestartRequired, false);
    assert.equal(relaunches, 1);

    // Stale alpha UI poll during shutdown is ignored by pendingSwitch
    const duringShutdown = store.syncActive({ email: 'alpha@example.com', name: 'Alpha' });
    assert.equal(duringShutdown.activeId, betaId);
    // Relaunched as beta clears pendingSwitch
    store.syncActive({ email: 'beta@example.com', name: 'Beta' });

    // 3. Simulate stale language_server refresh overwriting active keyring with a NEW alpha token (different hash!) while UI still displays beta
    slots.set('gemini:antigravity', makeToken('alpha@example.com', 2));
    clock += 3000_000;
    const drifted = store.syncActive({
      email: 'beta@example.com',
      name: 'Beta',
      groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.08, resetTimeMs: clock + 86400_000 }] }]
    });
    assert.deepEqual(drifted.credentialMismatch, { uiEmail: 'beta@example.com', credentialEmail: 'alpha@example.com' });
    // Beta's vault slot and saved 95% quota MUST remain intact!
    assert.equal(emailOf(slots.get(`agy-powertools:account:${betaId}`)), 'beta@example.com');
    assert.equal(drifted.accounts.find(a => a.id === betaId).groups[0].buckets[0].remainingFraction, 0.95);

    // When UI later catches up and flips to alpha, beta's vault slot stays valid (not wiped by duplicate hash!)
    const reverted = store.syncActive({ email: 'alpha@example.com', name: 'Alpha' });
    assert.equal(reverted.accounts.find(a => a.id === betaId).hasCredential, true);
    assert.equal(reverted.accounts.find(a => a.id === alphaId).hasCredential, true);

    // 4. Even if beta's slot was previously corrupted with an alpha token of a DIFFERENT hash, refreshCredentials & switchAccount catch it via id_token_email
    slots.set(`agy-powertools:account:${betaId}`, makeToken('alpha@example.com', 3));
    const check = store.refreshCredentials({ accountId: betaId });
    assert.equal(check.valid, 0);
    assert.equal(check.invalid, 1);
    assert.equal(check.account.hasCredential, false);
    assert.throws(() => store.switchAccount(betaId), /不一致|重新登录/);

    // 5. prepareAdd does not deadlock when active keyring already mismatches displayed account
    slots.set('gemini:antigravity', makeToken('alpha@example.com', 4));
    const prepMismatch = store.prepareAdd();
    assert.equal(prepMismatch.ok, true);

    // 6. completeAdd does NOT relaunch when nothing changed (cancelled login), and DOES relaunch on same-email token rotation
    const unchanged = store.completeAdd({
      email: 'alpha@example.com',
      prevEmail: 'alpha@example.com',
      prevCredHash: vault.inspectActive().hash
    });
    assert.equal(unchanged.relaunching, false);
    assert.equal(relaunches, 1);

    const prevHash = vault.inspectActive().hash;
    slots.set('gemini:antigravity', makeToken('alpha@example.com', 5));
    const rotated = store.completeAdd({
      email: 'alpha@example.com',
      prevEmail: 'alpha@example.com',
      prevCredHash: prevHash
    });
    assert.equal(rotated.relaunching, true);
    assert.equal(relaunches, 2);

    // Clear pendingSwitch from rotation before testing slow-Redux add
    store.syncActive({ email: 'alpha@example.com', name: 'Alpha' });

    // 7. Slow-Redux race: OAuth wrote gamma@example.com to OS keyring before UI capabilities().email left alpha@example.com.
    // completeAdd MUST adopt gamma instead of restoring alpha's backup over gamma's fresh credential.
    const prepSlow = store.prepareAdd({ pendingAlias: 'Slow UI' });
    slots.set('gemini:antigravity', makeToken('gamma@example.com', 1));
    clock += 6_000;
    const slowComplete = store.completeAdd({
      email: 'alpha@example.com',
      prevEmail: 'alpha@example.com',
      prevCredHash: prepSlow.prevCredHash
    });
    assert.equal(slowComplete.ok, true);
    assert.equal(slowComplete.accountChanged, true);
    assert.equal(slowComplete.relaunching, true);
    assert.equal(relaunches, 3);
    assert.equal(slowComplete.account.email, 'gamma@example.com');
    assert.equal(slowComplete.account.alias, 'Slow UI');
    assert.equal(emailOf(slots.get('gemini:antigravity')), 'gamma@example.com');
    assert.equal(emailOf(slots.get(`agy-powertools:account:${slowComplete.activeId}`)), 'gamma@example.com');
    // Relaunching into gamma clears pendingSwitch and hydrates name cleanly
    const gammaSynced = store.syncActive({ email: 'gamma@example.com', name: 'Gamma' });
    assert.equal(gammaSynced.activeId, slowComplete.activeId);

    // 8. Cancelled login while pre-drifted (UI=gamma, keyring=alpha, hash unchanged) MUST NOT throw or clobber keyring, and clears stale pendingAlias
    slots.set('gemini:antigravity', makeToken('alpha@example.com', 6));
    const prepCancel = store.prepareAdd({ pendingAlias: 'Cancelled Alias' });
    const cancelled = store.completeAdd({
      email: 'gamma@example.com',
      prevEmail: 'gamma@example.com',
      prevCredHash: prepCancel.prevCredHash
    });
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.relaunching, false);
    assert.equal(cancelled.manualRestartRequired, false);
    assert.equal(relaunches, 3);
    assert.equal(emailOf(slots.get('gemini:antigravity')), 'alpha@example.com');
    // Subsequent new account sync does not inherit the cancelled alias
    slots.set('gemini:antigravity', makeToken('delta@example.com', 1));
    const deltaSynced = store.syncActive({ email: 'delta@example.com', name: 'Delta' });
    assert.equal(deltaSynced.accounts.find(a => a.email === 'delta@example.com').alias, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accountBucketStatus, summarizeAccountQuota, and accounts store guard unknown/active/skewed resets, disabled buckets, and untouched 100% countdowns', () => {
  const now = 1_795_500_000_000;

  // 1. Unknown rawFraction (null) MUST NOT be fabricated as 100% when resetTimeMs has passed
  const unknownExpired = accountBucketStatus({ bucketId: 'g-5h', window: '5h', remainingFraction: null, resetTimeMs: now - 30_000 }, now);
  assert.equal(unknownExpired.isReset, false);
  assert.equal(unknownExpired.effectiveFraction, null);
  assert.equal(unknownExpired.tone, 'unknown');

  // 2. Active account MUST NOT override live fraction to 100% under slight clock/cache skew
  const activeSkewed = accountBucketStatus({ bucketId: 'g-5h', window: '5h', remainingFraction: 0.34, resetTimeMs: now - 15_000 }, now, { isActive: true });
  assert.equal(activeSkewed.isReset, false);
  assert.equal(activeSkewed.effectiveFraction, 0.34);
  assert.equal(activeSkewed.tone, 'ok');

  // 3. Inactive account snapshot captured AFTER resetTimeMs (syncedAtMs >= resetTimeMs) MUST NOT falsely reset
  const inactiveSkewed = accountBucketStatus(
    { bucketId: 'g-5h', window: '5h', remainingFraction: 0.22, resetTimeMs: now - 20_000 },
    now,
    { isActive: false, syncedAtMs: now - 10_000 }
  );
  assert.equal(inactiveSkewed.isReset, false);
  assert.equal(inactiveSkewed.effectiveFraction, 0.22);
  assert.equal(inactiveSkewed.tone, 'warning');

  // 4. Untouched 100% bucket with explicit description: '' strips placeholder resetTimeMs, while legacy fixture without description keeps it
  const untouchedPlaceholder = accountBucketStatus({ bucketId: 'g-5h', window: '5h', remainingFraction: 1, resetTimeMs: now + 18_000_000, description: '' }, now);
  assert.equal(untouchedPlaceholder.resetTimeMs, null);
  const legacyFull = accountBucketStatus({ bucketId: 'g-5h', window: '5h', remainingFraction: 1, resetTimeMs: now + 18_000_000 }, now);
  assert.equal(legacyFull.resetTimeMs, now + 18_000_000);

  // 5. summarizeAccountQuota filters disabled buckets and propagates syncedAtMs
  const summary = summarizeAccountQuota({
    syncedAtMs: now - 5_000,
    groups: [{
      displayName: 'Gemini Models',
      buckets: [
        { bucketId: 'g-disabled', window: '5h', remainingFraction: 0, resetTimeMs: now + 3600_000, disabled: true },
        { bucketId: 'g-5h', window: '5h', remainingFraction: 0.4, resetTimeMs: now - 10_000 }
      ]
    }]
  }, now);
  assert.equal(summary.groups[0].buckets.length, 1);
  assert.equal(summary.groups[0].buckets[0].bucketId, 'g-5h');
  assert.equal(summary.groups[0].buckets[0].isReset, false);
  assert.equal(summary.groups[0].buckets[0].effectiveFraction, 0.4);

  // 6. Store syncActive with empty groups preserves existing groups and syncedAtMs, and refreshLocalQuotas respects syncedAtMs >= resetTimeMs
  const dir = mkdtempSync(join(tmpdir(), 'agy-accounts-accuracy-'));
  let clock = now;
  const vault = createFakeVault({ 'gemini:antigravity': 'tok-a' });
  try {
    const store = createAccountsStore(dir, { now: () => clock, vault });
    const s1 = store.syncActive({
      email: 'alpha@example.com',
      name: 'Alpha',
      groups: [{
        displayName: 'Gemini Models',
        buckets: [
          { bucketId: 'g-5h', window: '5h', remainingFraction: 0.55, resetTimeMs: clock - 5_000 },
          { bucketId: 'g-untouched', window: 'weekly', remainingFraction: 1, resetTimeMs: clock + 604_800_000, description: '' },
          { bucketId: 'g-off', window: '5h', remainingFraction: 0, resetTimeMs: clock + 3600_000, disabled: true }
        ]
      }]
    });
    const alpha = s1.accounts[0];
    assert.equal(alpha.syncedAtMs, now);
    assert.equal(alpha.groups[0].buckets.length, 2);
    assert.equal(alpha.groups[0].buckets[1].resetTimeMs, null);

    // Subsequent syncActive with groups: [] (e.g. startAddAccount fallback) preserves groups and syncedAtMs
    clock += 120_000;
    const s2 = store.syncActive({ email: 'alpha@example.com', name: 'Alpha', groups: [] });
    assert.equal(s2.accounts[0].groups[0].buckets[0].remainingFraction, 0.55);
    assert.equal(s2.accounts[0].syncedAtMs, now);
    assert.equal(s2.accounts[0].lastUsedAtMs, clock);

    // Switch to beta so alpha becomes inactive, then run refreshLocalQuotas -> alpha's skewed bucket (syncedAtMs >= resetTimeMs) stays 0.55
    vault.slots.set('gemini:antigravity', 'tok-b');
    store.syncActive({
      email: 'beta@example.com',
      name: 'Beta',
      groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.9, resetTimeMs: clock + 3600_000 }] }]
    });
    clock += 60_000;
    const refreshed = store.refreshLocalQuotas({ accountId: '' });
    assert.equal(refreshed.accounts.find(a => a.email === 'alpha@example.com').groups[0].buckets[0].remainingFraction, 0.55);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Quotas and AccountSwitcher fuse live active data, fix header identity drift, show popover errors, tick countdowns while open, and flag weekly risk on 5H view', async () => {
  const now = Date.now();
  const accountsData = {
    activeId: 'acct-1',
    accounts: [
      {
        id: 'acct-1',
        email: 'alice@example.com',
        name: 'Alice Chen',
        alias: '主力号',
        tier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' },
        disabled: false,
        hasCredential: true,
        syncedAtMs: now - 120_000,
        lastUsedAtMs: now - 120_000,
        // Stale store snapshot has 90%, while live env.account() has 35% with slightly past resetTime
        groups: [
          { displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.9, resetTimeMs: now + 3600_000 }] }
        ]
      },
      {
        id: 'acct-2',
        email: 'bob@example.com',
        name: 'Bob Lin',
        alias: '',
        tier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
        disabled: false,
        hasCredential: true,
        syncedAtMs: now - 7_200_000,
        lastUsedAtMs: now - 7_200_000,
        // Expired 5h (estimated 100%) but critical weekly (5%)
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              { bucketId: 'g-5h', window: '5h', remainingFraction: 0.1, resetTimeMs: now - 60_000 },
              { bucketId: 'g-weekly', window: 'weekly', remainingFraction: 0.05, resetTimeMs: now + 3 * 86400_000 }
            ]
          }
        ]
      }
    ]
  };

  const liveAccount = {
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [
          { bucketId: 'gemini-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.35 }, resetTime: { seconds: BigInt(Math.floor((now - 5_000) / 1000)) } },
          { bucketId: 'gemini-weekly-pool', remainingFraction: 0.62, resetTimeMs: now + 4 * 86400_000 },
          { bucketId: 'gemini-untouched', window: '5h', remainingFraction: 1, resetTimeMs: now + 18_000_000, description: '' },
          { bucketId: 'gemini-disabled', window: '5h', remainingFraction: 0, resetTimeMs: now + 3600_000, disabled: true }
        ]
      }
    ]
  };

  let intervalCount = 0;
  let clearedCount = 0;
  let lastEffectOpen = undefined;
  let activeCleanup = null;
  const ui = createPanelHarness(
    accountsData,
    { multiAccount: true, accountViewMode: 'list', accountQuotaWindow: '5h' },
    {
      account: liveAccount,
      accountFetchedAt: now,
      useEffect: (fn, deps) => {
        if (!Array.isArray(deps) || deps.length !== 1 || typeof deps[0] !== 'boolean') return;
        if (deps[0] === lastEffectOpen) return;
        lastEffectOpen = deps[0];
        activeCleanup?.();
        activeCleanup = fn() || null;
      },
      setInterval: () => ++intervalCount,
      clearInterval: () => { clearedCount++; },
      refreshAccountQuotasImpl: () => Promise.reject(new Error('刷新接口超时'))
    }
  );

  // 1. Quotas top cards filter disabled bucket, classify weekly via bucketId regex, support remainingFraction,
  //    and fuse live 35% (NOT 90% stale store, NOT 100% false reset) into active row!
  const qTree = ui.renderQuotas();
  const qText = ui.collectText(qTree);
  assert.ok(qText.includes('35.0%'));
  assert.ok(qText.includes('62.0%'));
  assert.ok(qText.includes('100.0%'));
  assert.ok(qText.includes('周限额'));
  assert.equal(/(?:^|[^\d])0\.0%/.test(qText), false);
  const quotaBuckets = ui.findAll(qTree, n => n.props?.className === 'pt-quota');
  assert.equal(quotaBuckets.length, 3);
  assert.equal(ui.collectText(quotaBuckets[2]).includes(':'), false);
  const activeRow = ui.find(qTree, 'agy-account-row-acct-1');
  assert.ok(ui.collectText(activeRow).includes('35%'));
  assert.equal(ui.collectText(activeRow).includes('90%'), false);

  // Inactive row in 5H view shows weekly risk escalation (data-weekly-risk="critical") + ≈100% + 周 5% with zero banned words
  const bobRow = ui.find(qTree, 'agy-account-row-acct-2');
  const bobChip = ui.findAll(bobRow, n => n.props?.className === 'pt-acct-quota-chip')[0];
  assert.equal(bobChip.props['data-estimated'], 'true');
  assert.equal(bobChip.props['data-weekly-risk'], 'critical');
  assert.equal(bobChip.props['data-tone'], 'critical');
  assert.ok(ui.collectText(bobChip).includes('≈100%'));
  assert.ok(ui.collectText(bobChip).includes('周 5%'));
  for (const banned of ['实时同步', '额度充裕', '部分限额接近耗尽', '切入后自动刷新最新额度', '5 小时已回满', '已重置（预计 100%）', '已重置', '\u00b7']) {
    assert.equal(qText.includes(banned), false, `Unexpected banned text in Quotas: ${banned}`);
  }

  // 2. AccountSwitcher: live fusion, periodic now timer while open with cleanup, and inline error display on failed refresh
  let swTree = ui.renderSwitcher();
  assert.equal(intervalCount, 0);
  ui.find(swTree, 'agy-account-switcher-trigger').props.onClick();
  swTree = ui.renderSwitcher();
  assert.equal(intervalCount, 1);
  const swActiveRow = ui.find(swTree, 'agy-account-row-acct-1');
  assert.ok(ui.collectText(swActiveRow).includes('35%'));
  await ui.find(swTree, 'agy-popover-refresh-quotas').props.onClick();
  await new Promise(r => setTimeout(r, 10));
  swTree = ui.renderSwitcher();
  const popErr = ui.find(swTree, 'agy-popover-error');
  assert.ok(popErr);
  assert.ok(ui.collectText(popErr).includes('刷新接口超时'));
  // Closing popover clears the periodic timer and stale error
  ui.find(swTree, 'agy-account-switcher-trigger').props.onClick();
  swTree = ui.renderSwitcher();
  assert.equal(clearedCount, 1);
  assert.equal(ui.find(swTree, 'agy-popover-error'), null);

  // 3. Quotas top header identity follows capabilities().email when store.activeId temporarily drifts,
  //    and does NOT leak live groups into the mismatched store.activeId row.
  const driftUi = createPanelHarness(
    accountsData,
    { multiAccount: true, accountViewMode: 'list' },
    {
      account: liveAccount,
      capabilities: { plan: 'Google AI Pro', planId: 'g1-pro-tier', email: 'bob@example.com', name: 'Bob Lin' }
    }
  );
  const driftQuotas = driftUi.renderQuotas();
  const topPlanRow = driftUi.find(driftQuotas, 'agy-setting-row-current-plan');
  assert.ok(driftUi.collectText(topPlanRow).includes('bob@example.com'));
  assert.equal(driftUi.collectText(topPlanRow).includes('alice@example.com'), false);
  const driftedAcct1Row = driftUi.find(driftQuotas, 'agy-account-row-acct-1');
  assert.ok(driftUi.collectText(driftedAcct1Row).includes('90%'));
  assert.equal(driftUi.collectText(driftedAcct1Row).includes('35%'), false);
});

test('QuickPopover reuses full panels across all 6 tabs with lazy loading, badge guards, tab memory, and zero middle dots', async () => {
  const now = Date.now();
  const dashboardLoads = [];
  let proxyLoads = 0;
  const openedTabs = [];
  const sampleDashboard = {
    activeAccountEmail: 'alice@example.com',
    accountEmails: ['alice@example.com'],
    pricing: { rates: [{ model: 'gemini-4-neon', input: 2, output: 12, cache: 0.2 }] },
    requests: [
      { id: 'r1', timestampMs: now - 3600_000, model: 'Gemini 4 Neon', inputTokens: 1000, cacheReadTokens: 3000, outputTokens: 500, costUsd: 0.12, status: 'success', tps: 42, ttftMs: 1200, cacheHitPercent: 75, conversationId: 'conv-1', accountEmail: 'alice@example.com' }
    ],
    errors: [
      { id: 'e1', timestampMs: now - 3200_000, model: 'Claude Sonnet 4', error: 'HTTP 429 rate limited', status: 'error', conversationId: 'conv-1', accountEmail: 'alice@example.com' }
    ]
  };
  const accountsData = {
    activeId: 'acct-1',
    accounts: [{
      id: 'acct-1',
      email: 'alice@example.com',
      name: 'Alice Chen',
      tier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' },
      disabled: false,
      hasCredential: true,
      groups: [
        { displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.82, resetTimeMs: now + 3600_000 }] },
        { displayName: 'Claude and GPT models', buckets: [{ bucketId: 'c-5h', window: '5h', remainingFraction: 0.18, resetTimeMs: now + 3600_000 }] },
        { displayName: 'Disabled Pool', buckets: [{ bucketId: 'd-5h', window: '5h', disabled: true, remainingFraction: 0.01, resetTimeMs: now + 3600_000 }] }
      ]
    }]
  };

  const ui = createPanelHarness(
    accountsData,
    { enabled: true, titlebarQuickPanel: true, multiAccount: true, overviewRange: '24h' },
    {
      dashboard: sampleDashboard,
      proxyStatus: () => ({ reason: 'active', mismatch: false }),
      onLoadDashboard: force => dashboardLoads.push(force),
      onLoadProxyStatus: () => { proxyLoads++; },
      onOpenManagementTab: tab => openedTabs.push(tab)
    }
  );

  // Settings exposes single titlebarQuickPanel toggle on general tab and composerWorkingBeam on beams tab (default off, hides palette row)
  const settingsTree = ui.renderSettings();
  assert.ok(ui.find(settingsTree, 'agy-setting-titlebarQuickPanel'));
  assert.equal(ui.find(settingsTree, 'agy-setting-row-titlebarQuickPanelMode'), null);
  ui.find(settingsTree, 'agy-settings-cat-beams').props.onClick();
  const beamsSettingsTree = ui.renderSettings();
  assert.ok(ui.find(beamsSettingsTree, 'agy-setting-composerWorkingBeam'));
  assert.equal(ui.find(beamsSettingsTree, 'agy-setting-row-composerWorkingBeamPalette'), null);
  let previewOn = false;
  const beamUi = createPanelHarness(
    accountsData,
    { enabled: true, composerWorkingBeam: true, composerWorkingBeamPalette: 'aurora' },
    { beamPreview: () => previewOn, onSetBeamPreview: v => { previewOn = Boolean(v); } }
  );
  let beamSettings = beamUi.renderSettings();
  beamUi.find(beamSettings, 'agy-settings-cat-beams').props.onClick();
  beamSettings = beamUi.renderSettings();
  assert.ok(beamUi.find(beamSettings, 'agy-setting-row-composerWorkingBeamPalette'));
  assert.equal(beamUi.find(beamSettings, 'agy-beam-palette-aurora')?.props?.['aria-pressed'], true);
  const previewBtn = beamUi.find(beamSettings, 'agy-beam-preview-toggle');
  assert.ok(previewBtn);
  assert.equal(previewBtn.props['aria-pressed'], false);
  previewBtn.props.onClick();
  assert.equal(previewOn, true);
  assert.equal(beamUi.find(beamUi.renderSettings(), 'agy-beam-preview-toggle')?.props?.['aria-pressed'], true);
  // Restore ui back to general tab so subsequent quick-badge assertions inspect default tab cleanly
  ui.find(beamsSettingsTree, 'agy-settings-cat-general').props.onClick();

  // Closed by default: zero lazy loads; ignores disabled 1% bucket, warns on 18% active bucket and shows multiline tooltip + first-time alert callout
  let tree = ui.renderQuickPopover();
  const trigger = ui.find(tree, 'agy-titlebar-quick-trigger');
  assert.ok(trigger);
  assert.equal(ui.find(tree, 'agy-quick-trigger-badge')?.props?.['data-tone'], 'warning');
  assert.equal(trigger.props['aria-label'], 'Powertools 快捷概览（低额度：Claude/GPT 5h 18%）');
  const tipNode = ui.find(tree, 'agy-quick-trigger-tooltip');
  assert.ok(tipNode);
  const tipRows = ui.findAll(tipNode, n => n.props?.className === 'pt-qp-tip-row');
  assert.equal(tipRows.length, 1);
  assert.equal(tipRows[0].props['data-tone'], 'warning');
  assert.equal(ui.collectText(tipRows[0]).trim(), '低额度：Claude/GPT 5h 18%');
  assert.ok(ui.find(tree, 'agy-quick-alert-callout'));
  assert.equal(ui.find(tree, 'agy-quick-popover'), null);
  assert.equal(dashboardLoads.length, 0);
  assert.equal(proxyLoads, 0);

  // Clicking "我知道了" hides both the callout and the corner dot for the current alert event
  ui.find(tree, 'agy-quick-alert-ack').props.onClick();
  tree = ui.renderQuickPopover();
  assert.equal(ui.find(tree, 'agy-quick-alert-callout'), null);
  assert.equal(ui.find(tree, 'agy-quick-trigger-badge'), null);
  assert.ok(ui.find(tree, 'agy-quick-trigger-tooltip'));

  // Multiline tooltip covers critical + warning + pending proxy and "不再提醒" mutes until restored in Settings
  const critProxyUi = createPanelHarness(
    {
      activeId: 'acct-1',
      accounts: [{
        id: 'acct-1',
        email: 'alice@example.com',
        name: 'Alice Chen',
        groups: [
          { displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.06 }] },
          { displayName: 'Claude and GPT models', buckets: [{ bucketId: 'c-w', window: 'weekly', remainingFraction: 0.19 }] }
        ]
      }]
    },
    { enabled: true, titlebarQuickPanel: true, language: 'zh-CN' },
    { proxyStatus: () => ({ reason: 'not-applied', mismatch: true }) }
  );
  let critTree = critProxyUi.renderQuickPopover();
  assert.equal(critProxyUi.find(critTree, 'agy-quick-trigger-badge')?.props?.['data-tone'], 'critical');
  assert.ok(critProxyUi.find(critTree, 'agy-quick-alert-callout'));
  const critTipBox = critProxyUi.find(critTree, 'agy-quick-trigger-tooltip');
  const critRows = critProxyUi.findAll(critTipBox, n => n.props?.className === 'pt-qp-tip-row');
  assert.deepEqual(
    critRows.map(r => [r.props['data-tone'], critProxyUi.collectText(r).trim()]),
    [
      ['critical', '额度告急：Gemini 5h 6%'],
      ['warning', '低额度：Claude/GPT 周 19%'],
      ['warning', '独立代理待重启生效']
    ]
  );
  const critText = critProxyUi.collectText(critTipBox);
  for (const forbidden of ['\u00b7', '\u2022', '\u2027', '\u30fb']) assert.equal(critText.includes(forbidden), false);
  assert.equal(critProxyUi.find(critProxyUi.renderSettings(), 'agy-setting-row-quickBadgeMuted'), null);
  critProxyUi.find(critTree, 'agy-quick-alert-mute').props.onClick();
  critTree = critProxyUi.renderQuickPopover();
  assert.equal(critProxyUi.find(critTree, 'agy-quick-alert-callout'), null);
  assert.equal(critProxyUi.find(critTree, 'agy-quick-trigger-badge'), null);
  const unmuteBtn = critProxyUi.find(critProxyUi.renderSettings(), 'agy-quick-badge-unmute');
  assert.ok(unmuteBtn);
  unmuteBtn.props.onClick();
  critTree = critProxyUi.renderQuickPopover();
  assert.equal(critProxyUi.find(critTree, 'agy-quick-trigger-badge')?.props?.['data-tone'], 'critical');
  assert.ok(critProxyUi.find(critTree, 'agy-quick-alert-callout'));

  const healthyUi = createPanelHarness(
    { activeId: 'acct-1', accounts: [{ id: 'acct-1', email: 'alice@example.com', groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.9 }] }] }] },
    { enabled: true, titlebarQuickPanel: true, language: 'zh-CN' },
    { proxyStatus: () => ({ reason: 'disabled', mismatch: false }) }
  );
  const healthyTree = healthyUi.renderQuickPopover();
  assert.equal(healthyUi.find(healthyTree, 'agy-quick-trigger-badge'), null);
  assert.equal(healthyUi.find(healthyTree, 'agy-quick-alert-callout'), null);
  assert.equal(healthyUi.find(healthyTree, 'agy-quick-trigger-tooltip'), null);
  assert.equal(healthyUi.find(healthyTree, 'agy-titlebar-quick-trigger')?.props?.['aria-label'], 'Powertools 快捷概览');

  // Open -> lazy loads once; all 6 full native components render cleanly with zero middle dots
  trigger.props.onClick();
  assert.deepEqual(dashboardLoads, [false]);
  assert.equal(proxyLoads, 1);

  tree = ui.renderQuickPopover();
  assert.ok(ui.find(tree, 'agy-usage-heatmap'));
  for (const [tabKey, expectedTestId] of [
    ['overview', 'agy-usage-heatmap'],
    ['requests', 'agy-requests-table'],
    ['errors', 'agy-errors-table'],
    ['quota', 'agy-accounts-overview'],
    ['pricing', 'agy-price-table'],
    ['settings', 'agy-about-version']
  ]) {
    ui.find(ui.renderQuickPopover(), `agy-quick-tab-${tabKey}`).props.onClick();
    const pop = ui.find(ui.renderQuickPopover(), 'agy-quick-popover');
    assert.ok(ui.find(pop, expectedTestId), `Expected ${expectedTestId} inside QuickPopover tab ${tabKey}`);
    const tabText = ui.collectText(pop);
    for (const forbidden of ['\u00b7', '\u2022', '\u2027', '\u30fb']) {
      assert.equal(tabText.includes(forbidden), false, `Forbidden middle dot in tab ${tabKey}`);
    }
  }

  // Manual refresh + open full page remembers active tab ('settings')
  await ui.find(ui.renderQuickPopover(), 'agy-quick-refresh').props.onClick();
  assert.deepEqual(dashboardLoads, [false, true]);
  ui.find(ui.renderQuickPopover(), 'agy-quick-open-full').props.onClick();
  assert.deepEqual(openedTabs, ['settings']);
  assert.equal(ui.find(ui.renderQuickPopover(), 'agy-quick-popover'), null);

  // Reopen restores last tab ('settings')
  ui.find(ui.renderQuickPopover(), 'agy-titlebar-quick-trigger').props.onClick();
  assert.ok(ui.find(ui.renderQuickPopover(), 'agy-about-version'));

  // Disabled toggle renders null
  const offUi = createPanelHarness(accountsData, { enabled: true, titlebarQuickPanel: false });
  assert.equal(offUi.renderQuickPopover(), null);
});

test('Pricing provides standard vs API promo basis switch, clean single-row rates, promo expiry badge, and Overview/Settings integration without middle dots', () => {
  const changes = [];
  const futureUntil = '2099-12-01';
  const sampleDash = {
    pricing: {
      mode: 'standard',
      status: 'live',
      checkedAt: '2026-11-24T10:00:00Z',
      rates: [
        { model: 'gemini-4-carbon', input: 2, output: 10, cache: 0.1, until: futureUntil, next: { input: 4, output: 20, cache: 0.2 }, source: 'https://aistudio.google.com/docs/pricing' },
        { model: 'gemini-4-neon', input: 3, output: 15, cache: 0.15, source: 'https://aistudio.google.com/docs/pricing' }
      ]
    },
    requests: [
      { id: 'r1', model: 'Gemini 4 Carbon (High)', status: 'success', timestampMs: Date.now() - 1000, inputTokens: 1000, cacheReadTokens: 0, outputTokens: 500, costUsd: 0.014 }
    ],
    errors: []
  };
  const ui = createPanelHarness(
    { activeId: 'acct-1', accounts: [{ id: 'acct-1', email: 'alice@example.com', name: 'Alice Chen', tier: { id: 'g1-ultra-tier', name: 'Google AI Ultra 20x' }, groups: [] }] },
    { enabled: true, language: 'zh-CN', pricingMode: 'standard', overviewRange: '24h' },
    { onChange: patch => changes.push(patch) }
  );

  // 1. Default standard mode: clean toolbar without bloated context banner, single-line standard prices ($4/$20/$0.2), no promo tag noise
  let priceTree = ui.renderPricing(sampleDash);
  assert.equal(ui.find(priceTree, 'agy-price-context'), null);
  assert.equal(ui.find(priceTree, 'agy-pricing-mode-standard')?.props?.['aria-pressed'], true);
  assert.equal(ui.find(priceTree, 'agy-pricing-mode-promo')?.props?.['aria-pressed'], false);

  const carbonRow = ui.findAll(priceTree, n => n.type === 'tr' && n.props?.['data-model'] === 'gemini-4-carbon')[0];
  const neonRow = ui.findAll(priceTree, n => n.type === 'tr' && n.props?.['data-model'] === 'gemini-4-neon')[0];
  assert.ok(carbonRow && neonRow);
  const carbonText = ui.collectText(carbonRow);
  assert.equal(ui.find(carbonRow, 'agy-price-promo-tag'), null);
  assert.equal(carbonText.includes('API 优惠至'), false);
  assert.ok(carbonText.includes('$4'));
  assert.ok(carbonText.includes('$20'));
  assert.equal(carbonText.includes('API 优惠 $2'), false);
  assert.equal(ui.find(carbonRow, 'agy-price-alt'), null);
  assert.equal(ui.find(neonRow, 'agy-price-promo-tag'), null);
  for (const forbidden of ['\u00b7', '\u2022', '\u2027', '\u30fb']) {
    assert.equal(ui.collectText(priceTree).includes(forbidden), false);
  }

  // 2. The request table retains the pricing tooltip.
  const ovStd = ui.renderOverview(sampleDash);
  assert.equal(ui.find(ovStd, 'agy-overview-cost-basis'), null);
  const costCard = ui.findAll(ovStd, n => n.props?.className === 'pt-card pt-metric' && ui.collectText(n).includes('费用'))[0];
  assert.ok(ui.collectText(costCard).includes('单次均价'));
  assert.equal(costCard.props['data-pt-tip'], undefined);
  const overviewCostHeader = ui.findAll(ovStd, n => n.type === 'th' && ui.collectText(n) === '费用')[0];
  assert.ok(overviewCostHeader);
  assert.equal(overviewCostHeader.props['data-pt-tip'], undefined);
  const reqStd = ui.renderEventTable(sampleDash, false);
  const costTh = ui.findAll(reqStd, n => n.type === 'th' && n.props?.className?.includes('pt-cost-th'))[0];
  assert.ok(costTh?.props?.['data-pt-tip']?.includes('正式标准单价'));
  let settingsTree = ui.renderSettings();
  ui.find(settingsTree, 'agy-settings-cat-features').props.onClick();
  settingsTree = ui.renderSettings();
  assert.ok(ui.find(settingsTree, 'agy-setting-row-pricingMode'));
  assert.equal(ui.find(settingsTree, 'agy-pricing-mode-select-standard')?.props?.selected, true);
  assert.ok(ui.collectText(ui.find(settingsTree, 'agy-pricing-mode-select')).includes('正式标准价'));

  // 3. Switch to promo mode via segmented control: shows $2/$10/$0.1 single-row values and active expiry tag
  ui.find(priceTree, 'agy-pricing-mode-promo').props.onClick();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].pricingMode, 'promo');
  priceTree = ui.renderPricing({ ...sampleDash, pricing: { ...sampleDash.pricing, mode: 'promo' } });
  assert.equal(ui.find(priceTree, 'agy-pricing-mode-promo')?.props?.['aria-pressed'], true);
  const promoCarbonRow = ui.findAll(priceTree, n => n.type === 'tr' && n.props?.['data-model'] === 'gemini-4-carbon')[0];
  const promoTag = ui.find(promoCarbonRow, 'agy-price-promo-tag');
  assert.equal(promoTag?.props?.['data-active'], 'true');
  const promoText = ui.collectText(promoCarbonRow);
  assert.ok(promoText.includes('API 优惠至 2099-11-30'));
  assert.ok(promoText.includes('$2'));
  assert.ok(promoText.includes('$10'));
  assert.equal(promoText.includes('正式 $4'), false);
  assert.equal(ui.find(ui.renderOverview(sampleDash), 'agy-overview-cost-basis'), null);

  // 4. English locale in promo mode shows clean expiry badge with zero middle dots (and hides it in standard mode)
  const enUi = createPanelHarness(
    { activeId: 'acct-1', accounts: [{ id: 'acct-1', email: 'alice@example.com', tier: { id: 'g1-pro-tier', name: 'Google AI Pro' }, groups: [] }] },
    { enabled: true, language: 'en', pricingMode: 'promo' }
  );
  const enTree = enUi.renderPricing({ ...sampleDash, pricing: { ...sampleDash.pricing, mode: 'promo' } });
  const enText = enUi.collectText(enTree);
  assert.ok(enText.includes('API promo thru 2099-11-30'));
  assert.equal(enText.includes('API promo $2'), false);
  for (const forbidden of ['\u00b7', '\u2022', '\u2027', '\u30fb']) {
    assert.equal(enText.includes(forbidden), false);
  }
});

test('Overview and EventTable do not hide remote SSH or unattributed requests behind an empty activeAccountEmail filter (Issue #49)', () => {
  const now = Date.now();
  const remoteDash = {
    isRemoteSsh: true,
    activeAccountEmail: 'alice@example.com',
    accountEmails: [],
    requests: [
      { id: 'r1', model: 'Gemini 4 Carbon (High)', status: 'success', timestampMs: now - 30000, inputTokens: 12000, cacheReadTokens: 0, outputTokens: 1500, costUsd: 0.078, accountEmail: '' },
      { id: 'r2', model: 'Gemini 4 Carbon (High)', status: 'success', timestampMs: now - 10000, inputTokens: 8000, cacheReadTokens: 0, outputTokens: 1000, costUsd: 0.052, accountEmail: '' }
    ],
    errors: []
  };
  const ui = createPanelHarness(
    { activeId: 'acct-1', accounts: [{ id: 'acct-1', email: 'alice@example.com', tier: { id: 'g1-pro-tier', name: 'Google AI Pro' }, groups: [] }] },
    { enabled: true, language: 'zh-CN', multiAccount: true, overviewRange: 'weeklyQuota' }
  );
  const ovTree = ui.renderOverview(remoteDash);
  // Filter hidden on SSH remote dashboard and both requests are counted instead of showing 0
  assert.equal(ui.find(ovTree, 'agy-overview-account-filter'), null);
  const ovText = ui.collectText(ovTree);
  assert.ok(ovText.includes('2 成功'));
  assert.ok(ovText.includes('$0.13'));

  // Local multi-account with only unattributed history (hasActiveRows=false) also falls back to 'all' instead of empty 0s
  const localUnattributed = { ...remoteDash, isRemoteSsh: false };
  const localOv = ui.renderOverview(localUnattributed);
  assert.ok(ui.find(localOv, 'agy-overview-account-filter'));
  assert.ok(ui.collectText(localOv).includes('2 成功'));
});


test('accountSupportsModel blocks incompatible Free/model accounts and rankAutoSwitchCandidates prefers active weekly timers over untouched 100% accounts', async () => {
  const { accountSupportsModel, rankAutoSwitchCandidates } = await import('../lib/account-helpers.mjs');
  const now = 1_700_000_000_000;
  const freeAcct = {
    id: 'free-1', email: 'free@example.com', disabled: false, hasCredential: true,
    tier: { id: 'g1-free-tier', name: 'Free' },
    groups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: 1, resetTimeMs: null }, { window: 'weekly', remainingFraction: 1, resetTimeMs: null }] }]
  };
  const proUntouched = {
    id: 'pro-fresh', email: 'fresh@example.com', disabled: false, hasCredential: true,
    tier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
    availableModels: ['Gemini 4 Carbon (High)', 'Claude Opus 5.5'],
    groups: [
      { displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: 1, resetTimeMs: null }, { window: 'weekly', remainingFraction: 1, resetTimeMs: null }] },
      { displayName: 'Claude and GPT models', buckets: [{ window: '5h', remainingFraction: 1, resetTimeMs: null }, { window: 'weekly', remainingFraction: 1, resetTimeMs: null }] }
    ]
  };
  const proTicking = {
    id: 'pro-ticking', email: 'ticking@example.com', disabled: false, hasCredential: true,
    tier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
    availableModels: ['Gemini 4 Carbon (High)', 'Claude Opus 5.5'],
    groups: [
      { displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: 0.7, resetTimeMs: now + 3600_000 }, { window: 'weekly', remainingFraction: 0.6, resetTimeMs: now + 3 * 86400_000 }] },
      { displayName: 'Claude and GPT models', buckets: [{ window: '5h', remainingFraction: 0.7, resetTimeMs: now + 3600_000 }, { window: 'weekly', remainingFraction: 0.6, resetTimeMs: now + 3 * 86400_000 }] }
    ]
  };
  const noClaude = {
    id: 'gemini-only', email: 'gonly@example.com', disabled: false, hasCredential: true,
    tier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
    availableModels: ['Gemini 4 Carbon (High)'],
    groups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: 1, resetTimeMs: null }] }]
  };

  assert.equal(accountSupportsModel(freeAcct, 'Claude Opus 5.5', 'claude'), false);
  assert.equal(accountSupportsModel(freeAcct, 'Orchestrator (Claude Opus 5.5)', 'claude'), false);
  assert.equal(accountSupportsModel(freeAcct, 'Gemini 4 Carbon (High)', 'gemini'), false);
  assert.equal(accountSupportsModel(noClaude, 'Claude Opus 5.5', 'claude'), false);
  assert.equal(accountSupportsModel(proTicking, 'Orchestrator (Claude Opus 5.5)', 'claude'), true);

  // Ranking prefers pro-ticking (active weekly timer, 60% remaining) over pro-fresh (untouched 100%) and excludes freeAcct/noClaude
  const ranked = rankAutoSwitchCandidates([freeAcct, noClaude, proUntouched, proTicking], 'active', 'claude', now, 0.05, { activeModel: 'Claude Opus 5.5' });
  assert.deepEqual(ranked.map(r => r.acct.id), ['pro-ticking', 'pro-fresh']);
});

test('SwitchConfirmModal clarifies cross-tab running turns and AccountSwitcher surfaces manualRestartRequired notice without middle dots', async () => {
  const accountsData = {
    activeId: 'acct-a',
    vaultSupported: true,
    accounts: [
      { id: 'acct-a', email: 'alpha@example.com', name: 'Alpha', hasCredential: true, disabled: false, groups: [] },
      { id: 'acct-b', email: 'beta@example.com', name: 'Beta', hasCredential: true, disabled: false, groups: [] }
    ]
  };
  const ui = createPanelHarness(accountsData, { enabled: true, multiAccount: true, language: 'zh-CN' }, {
    isTurnRunning: () => true,
    switchAccountImpl: async () => ({ ok: true, relaunching: false, manualRestartRequired: true })
  });

  // 1. Open AccountSwitcher popover & click non-active account -> SwitchConfirmModal warns accurately about active or background turns
  let swTree = ui.renderSwitcher();
  const trigger = ui.find(swTree, 'agy-account-switcher-trigger');
  assert.ok(trigger);
  trigger.props.onClick?.();
  swTree = ui.renderSwitcher();
  const rowB = ui.find(swTree, 'agy-account-row-acct-b');
  assert.ok(rowB);
  rowB.props.onClick();
  swTree = ui.renderSwitcher();
  const warn = ui.find(swTree, 'agy-switch-running-warning');
  assert.ok(warn);
  const warnText = ui.collectText(warn);
  assert.ok(warnText.includes('当前或后台仍有会话正在执行'));
  for (const forbidden of ['\u00b7', '\u2022', '\u2027', '\u30fb']) {
    assert.equal(warnText.includes(forbidden), false);
  }

  // 2. Confirm switch returning manualRestartRequired -> AccountSwitcher displays visible notice inside popover
  const confirmBtn = ui.find(swTree, 'agy-switch-confirm');
  assert.ok(confirmBtn);
  confirmBtn.props.onClick();
  await new Promise(r => setImmediate(r));
  swTree = ui.renderSwitcher();
  const notice = ui.find(swTree, 'agy-popover-manual-restart');
  assert.ok(notice);
  assert.ok(ui.collectText(notice).includes('手动重启 Antigravity'));
});

test('AddAccountModal exposes copyable OAuth login link while sign-in is active and supports cancel (Issue #56)', async () => {
  const oauthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=agy&state=xyz';
  let resolveLogin = null;
  let cancelled = 0;
  const copied = [];
  const accountsData = {
    activeId: 'acct-a',
    vaultSupported: true,
    accounts: [{ id: 'acct-a', email: 'alpha@example.com', name: 'Alpha', hasCredential: true, disabled: false, groups: [] }]
  };
  const ui = createPanelHarness(accountsData, { enabled: true, multiAccount: true, language: 'zh-CN' }, {
    loginSession: () => ({ active: true, authUrl: oauthUrl, mode: 'redirect' }),
    onCancelAccountLogin: () => { cancelled++; resolveLogin?.({ ok: false, cancelled: true }); },
    onClipboardWrite: text => copied.push(text),
    startAddAccountImpl: () => new Promise(resolve => { resolveLogin = resolve; })
  });

  // Open AddAccountModal from Quotas page and start sign-in
  let qTree = ui.renderQuotas();
  ui.find(qTree, 'agy-add-account').props.onClick();
  qTree = ui.renderQuotas();
  const dialog = ui.find(qTree, 'agy-add-account-dialog');
  assert.ok(dialog);
  const form = ui.findAll(dialog, n => n.type === 'form')[0];
  form.props.onSubmit({ preventDefault() {} });

  // While busy, OAuth URL box & Copy button render cleanly and copy exact raw URL
  qTree = ui.renderQuotas();
  const oauthBox = ui.find(qTree, 'agy-add-account-oauth-box');
  assert.ok(oauthBox);
  assert.equal(ui.collectText(ui.find(oauthBox, 'agy-add-account-oauth-url')), oauthUrl);
  const copyBtn = ui.find(oauthBox, 'agy-add-account-copy-url');
  assert.ok(copyBtn);
  copyBtn.props.onClick();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(copied, [oauthUrl]);
  for (const forbidden of ['\u00b7', '\u2022', '\u2027', '\u30fb']) {
    assert.equal(ui.collectText(oauthBox).includes(forbidden), false);
  }

  // Cancel button cancels active login session cleanly
  const cancelBtn = ui.find(qTree, 'agy-add-account-cancel');
  assert.equal(cancelBtn.props.disabled, false);
  cancelBtn.props.onClick();
  assert.equal(cancelled, 1);
});

test('AccountSwitcher and Quotas isolate SSH remote windows and prefer live capabilities email over stale activeId (Issue #57)', () => {
  // 1. SSH remote store: AccountSwitcher returns null, Quotas shows SSH notice and hides local accounts list
  const sshUi = createPanelHarness(
    { isRemoteSsh: true, activeId: '', accounts: [], vaultSupported: false },
    { enabled: true, multiAccount: true, accountSwitcher: true, language: 'zh-CN' },
    { capabilities: { email: 'remote@example.com', name: 'Remote Dev', plan: 'Google AI Pro', planId: 'g1-pro-tier' } }
  );
  assert.equal(sshUi.renderSwitcher(), null);
  const sshQuotas = sshUi.renderQuotas();
  assert.ok(sshUi.find(sshQuotas, 'agy-accounts-ssh-notice'));
  assert.equal(sshUi.find(sshQuotas, 'agy-accounts-overview'), null);
  assert.ok(sshUi.collectText(sshQuotas).includes('remote@example.com'));

  // 2. Local store: AccountSwitcher prefers live cap.email when store.activeId lags behind
  const localUi = createPanelHarness(
    {
      activeId: 'acct-old',
      accounts: [
        { id: 'acct-old', email: 'old@example.com', name: 'Old Local', groups: [] },
        { id: 'acct-live', email: 'live@example.com', name: 'Live Window', groups: [] }
      ]
    },
    { enabled: true, multiAccount: true, accountSwitcher: true, language: 'zh-CN' },
    { capabilities: { email: 'live@example.com', name: 'Live Window' } }
  );
  const swTree = localUi.renderSwitcher();
  const triggerText = localUi.collectText(localUi.find(swTree, 'agy-account-switcher-trigger'));
  assert.ok(triggerText.includes('Live Window'));
  assert.ok(triggerText.includes('live@example.com'));
});

test('createAccountsStore tracks onboarding acceptance from app_storage.json and passes onboardingSync only for accepted accounts (Issue #59)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-onboarding-59-'));
  try {
    const appStoragePath = join(dir, 'app_storage.json');
    const vault = createFakeVault({ 'gemini:antigravity': 'tok-alpha' });
    const relaunchCalls = [];
    const store = createAccountsStore(dir, {
      vault,
      appStoragePath,
      relaunch: opts => { relaunchCalls.push(opts || null); return { scheduled: true }; }
    });

    // Account A has accepted onboarding in app_storage.json with isGcpTos = false
    writeFileSync(appStoragePath, JSON.stringify({
      'agy.onboarding.lastLoginUsername': 'alpha@example.com',
      'agy.onboarding.lastLoginIsGcpTos': 'false'
    }));
    const s1 = store.syncActive({ email: 'alpha@example.com', name: 'Alpha', groups: [{ displayName: 'Gemini', buckets: [] }] });
    assert.equal(s1.accounts[0].onboardingAccepted, true);
    assert.equal(s1.accounts[0].isGcpTos, false);

    // Prepare add and completeAdd for brand-new account B (not yet accepted in app_storage.json)
    const prep = store.prepareAdd({ pendingAlias: 'NewB' });
    vault.slots.set('gemini:antigravity', 'tok-beta');
    const added = store.completeAdd({ email: 'beta@example.com', prevEmail: 'alpha@example.com', prevCredHash: prep.prevCredHash, triggerRelaunch: true });
    assert.equal(added.accountChanged, true);
    // Brand-new account must NOT suppress its first-time ToS dialog
    assert.equal(relaunchCalls.at(-1), null);

    // After user accepts ToS for B (isGcpTos = true) and enters main UI, syncActive captures B's onboarding state
    writeFileSync(appStoragePath, JSON.stringify({
      'agy.onboarding.lastLoginUsername': 'beta@example.com',
      'agy.onboarding.lastLoginIsGcpTos': 'true'
    }));
    const s2 = store.syncActive({ email: 'beta@example.com', name: 'Beta', groups: [{ displayName: 'Gemini', buckets: [] }] });
    const acctA = s2.accounts.find(a => a.email === 'alpha@example.com');
    const acctB = s2.accounts.find(a => a.email === 'beta@example.com');
    assert.equal(acctB.onboardingAccepted, true);
    assert.equal(acctB.isGcpTos, true);

    // Switching from B -> A passes A's saved onboardingSync (isGcpTos: false)
    store.switchAccount(acctA.id, { triggerRelaunch: true });
    assert.deepEqual(relaunchCalls.at(-1), { onboardingSync: { email: 'alpha@example.com', isGcpTos: false } });

    // Simulate A active again and switch A -> B -> passes B's saved onboardingSync (isGcpTos: true)
    writeFileSync(appStoragePath, JSON.stringify({ 'agy.onboarding.lastLoginUsername': 'alpha@example.com', 'agy.onboarding.lastLoginIsGcpTos': 'false' }));
    store.syncActive({ email: 'alpha@example.com', name: 'Alpha' });
    store.switchAccount(acctB.id, { triggerRelaunch: true });
    assert.deepEqual(relaunchCalls.at(-1), { onboardingSync: { email: 'beta@example.com', isGcpTos: true } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('快捷浮窗内的字体弹层搜索、重新读取及 Escape 不关闭外层', () => {
  let nestedOpen = true;
  const ui = createPanelHarness(null, { multiAccount: false }, {
    Popover: props => ({ type: 'popover', props, children: props.children }),
    querySelector: selector => nestedOpen && selector.includes('[data-testid="agy-font-picker"]') ? {} : null
  });
  const popover = ui.findAll(ui.renderQuickPopover(), node => node.type === 'popover')[0];
  popover.props.onOpenChange(true);
  for (const type of ['pointerdown', 'keydown']) {
    let canceled = false;
    popover.props.onOpenChange(false, { event: { type, key: 'Escape', target: { closest: () => null } }, cancel: () => { canceled = true; } });
    assert.equal(canceled, true);
    assert.equal(ui.findAll(ui.renderQuickPopover(), node => node.type === 'popover')[0].props.open, true);
  }
  nestedOpen = false;
  popover.props.onOpenChange(false, { event: { target: { closest: () => null } } });
  assert.equal(ui.findAll(ui.renderQuickPopover(), node => node.type === 'popover')[0].props.open, false);
});

test('Sidebar badge, QuickPopover info dot, and About toggles reflect discovered updates cleanly without middle dots (Issue #45)', () => {
  const changes = [];
  let openedUpdateSettings = 0;
  const ui = createPanelHarness(
    { activeId: 'a1', accounts: [{ id: 'a1', email: 'alice@example.com', groups: [] }] },
    { enabled: true, titlebarQuickPanel: true, autoCheckUpdates: true, autoInstallUpdates: false, language: 'zh-CN' },
    {
      onChange: p => changes.push(p),
      onOpenUpdateSettings: () => openedUpdateSettings++,
      updateNotice: {
        status: 'available',
        version: '2.17.0',
        releaseUrl: 'https://github.com/WhiteBr1ck/agy-powertools/releases/tag/v2.17.0',
        notes: '## 中文说明\n- **新功能**：自动检查更新',
        canInstall: true,
        dismissedVersion: ''
      }
    }
  );
  // 1. Sidebar displays compact update pill and clicking it jumps directly to Settings -> About
  const sidebarTree = ui.renderSidebar();
  const sideBadge = ui.find(sidebarTree, 'agy-sidebar-update-badge');
  assert.ok(sideBadge);
  assert.equal(ui.collectText(sideBadge), '新版');
  let prevented = false, stopped = false;
  sideBadge.props.onClick({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(openedUpdateSettings, 1);

  // 2. QuickPopover displays calm info dot (no top-right callout banner) with update tooltip row
  const qpTree = ui.renderQuickPopover();
  const qpDot = ui.find(qpTree, 'agy-quick-trigger-badge');
  assert.ok(qpDot);
  assert.equal(qpDot.props['data-tone'], 'info');
  assert.equal(ui.find(qpTree, 'agy-quick-alert-callout'), null);
  assert.ok(ui.collectText(ui.find(qpTree, 'agy-quick-trigger-tooltip')).includes('发现新版本 v2.17.0'));

  // 3. About pre-populates discovered release, install button, release notes, and update switches
  const aboutTree = ui.renderAbout();
  assert.ok(ui.find(aboutTree, 'agy-install-update'));
  assert.ok(ui.collectText(ui.find(aboutTree, 'agy-install-update')).includes('更新至 v2.17.0'));
  assert.ok(ui.find(aboutTree, 'agy-setting-autoCheckUpdates'));
  assert.ok(ui.find(aboutTree, 'agy-setting-autoInstallUpdates'));
  ui.find(aboutTree, 'agy-setting-autoInstallUpdates').props.onCheckedChange(true);
  assert.deepEqual(changes.map(c => ({ ...c })), [{ autoInstallUpdates: true }]);
  for (const forbidden of ['\u00b7', '\u2022', '\u2027', '\u30fb']) {
    assert.equal(ui.collectText(aboutTree).includes(forbidden), false);
  }

  // 4. Dismissed version hides Sidebar badge and QuickPopover info dot
  const dismissedUi = createPanelHarness(
    { activeId: 'a1', accounts: [{ id: 'a1', email: 'alice@example.com', groups: [] }] },
    { enabled: true, titlebarQuickPanel: true, autoCheckUpdates: true, language: 'zh-CN' },
    {
      updateNotice: { status: 'available', version: '2.17.0', canInstall: true, dismissedVersion: '2.17.0' }
    }
  );
  assert.equal(dismissedUi.find(dismissedUi.renderSidebar(), 'agy-sidebar-update-badge'), null);
  assert.equal(dismissedUi.find(dismissedUi.renderQuickPopover(), 'agy-quick-trigger-badge'), null);
});

test('createAccountsStore blocks chimera refreshHash collisions, self-heals switchMismatch via fromLsAddress, and defers Windows restore to relaunch-worker (Issue #97)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-accounts-97-'));
  let clock = 1_796_000_000_000;
  const makeToken = (email, access, refresh) => JSON.stringify({
    token: { access_token: access, refresh_token: refresh },
    auth_method: 'consumer',
    id_token_email: email
  });
  const parseMeta = raw => {
    try {
      const obj = JSON.parse(raw);
      return {
        email: String(obj.id_token_email || '').trim().toLowerCase(),
        refreshHash: obj.token?.refresh_token ? `rf_${obj.token.refresh_token}` : ''
      };
    } catch {
      return { email: '', refreshHash: '' };
    }
  };
  const slots = new Map([['gemini:antigravity', makeToken('alpha@example.com', 'at-a1', 'rt-alpha')]]);
  let restoreCalls = 0;
  const makeVault = ({ backend = 'darwin-keychain' } = {}) => ({
    supported: true,
    backend,
    slots,
    probe: () => ({ supported: true, backend, reason: '' }),
    has: t => slots.has(t),
    inspect(t) {
      if (!slots.has(t)) return { exists: false, hash: '' };
      const raw = slots.get(t);
      const { email, refreshHash } = parseMeta(raw);
      return { exists: true, hash: `H_${raw}`, ...(email ? { email } : {}), ...(refreshHash ? { refreshHash } : {}) };
    },
    copy(from, to, { expectedEmail = '' } = {}) {
      if (!slots.has(from)) return { ok: false, error: 'missing source' };
      const raw = slots.get(from);
      const { email, refreshHash } = parseMeta(raw);
      const expected = String(expectedEmail || '').trim().toLowerCase();
      if (expected && email && email !== expected) {
        return { ok: false, mismatch: true, actualEmail: email, expectedEmail: expected, error: 'mismatch' };
      }
      slots.set(to, raw);
      return { ok: true, bytes: raw.length, hash: `H_${raw}`, ...(email ? { email } : {}), ...(refreshHash ? { refreshHash } : {}) };
    },
    remove: t => { slots.delete(t); return { ok: true }; },
    saveActiveTo(id, opts) { return this.copy('gemini:antigravity', `agy-powertools:account:${id}`, opts); },
    restoreToActive(id, opts) { restoreCalls++; return this.copy(`agy-powertools:account:${id}`, 'gemini:antigravity', opts); },
    hasSaved(id) { return this.has(`agy-powertools:account:${id}`); },
    inspectSaved(id) { return this.inspect(`agy-powertools:account:${id}`); },
    inspectActive() { return this.inspect('gemini:antigravity'); },
    removeSaved(id) { return this.remove(`agy-powertools:account:${id}`); }
  });

  try {
    // 1. Chimera detection in syncActive, completeAdd, switchAccount, and refreshCredentials + snapshot stripping
    const env = { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:41001' };
    const vault = makeVault({ backend: 'darwin-keychain' });
    const store = createAccountsStore(dir, {
      now: () => clock,
      vault,
      env,
      appStoragePath: join(dir, 'app_storage.json'),
      relaunch: () => ({ scheduled: true })
    });

    const s1 = store.syncActive({ email: 'alpha@example.com', name: 'Alpha' });
    const alphaId = s1.activeId;
    // Internal hash fields MUST be stripped from snapshotResponse()
    assert.equal('credHash' in s1.accounts[0], false);
    assert.equal('refreshHash' in s1.accounts[0], false);
    assert.equal('invalidCredHash' in s1.accounts[0], false);
    assert.equal('invalidRefreshHash' in s1.accounts[0], false);

    // Chimera #1 in syncActive: UI claims beta, active token has beta email BUT alpha's refresh_token
    slots.set('gemini:antigravity', makeToken('beta@example.com', 'at-chimera', 'rt-alpha'));
    const chimeraSync = store.syncActive({ email: 'beta@example.com', name: 'Beta' });
    assert.deepEqual(chimeraSync.credentialMismatch, { uiEmail: 'beta@example.com', credentialEmail: 'alpha@example.com' });
    assert.equal(chimeraSync.accounts.length, 1);

    // Restore alpha cleanly, then test completeAdd chimera guards
    slots.set('gemini:antigravity', makeToken('alpha@example.com', 'at-a1', 'rt-alpha'));
    const prep = store.prepareAdd({ pendingAlias: 'Beta' });
    assert.equal(prep.prevRefreshHash, 'rf_rt-alpha');

    // Chimera #2 in completeAdd: refresh_token changed to rt-new, but id_token_email still alpha while UI says beta
    slots.set('gemini:antigravity', makeToken('alpha@example.com', 'at-b1', 'rt-new'));
    assert.throws(
      () => store.completeAdd({ email: 'beta@example.com', prevEmail: 'alpha@example.com', prevCredHash: prep.prevCredHash, prevRefreshHash: prep.prevRefreshHash }),
      /混合登录凭据/
    );

    // Chimera #3 in completeAdd: id_token_email says beta, but refresh_token is still rt-alpha
    slots.set('gemini:antigravity', makeToken('beta@example.com', 'at-b2', 'rt-alpha'));
    assert.throws(
      () => store.completeAdd({ email: 'beta@example.com', prevEmail: 'alpha@example.com', prevCredHash: prep.prevCredHash, prevRefreshHash: prep.prevRefreshHash }),
      /刷新令牌/
    );

    // Clean beta login succeeds
    slots.set('gemini:antigravity', makeToken('beta@example.com', 'at-b3', 'rt-beta'));
    const added = store.completeAdd({ email: 'beta@example.com', prevEmail: 'alpha@example.com', prevCredHash: prep.prevCredHash, prevRefreshHash: prep.prevRefreshHash });
    assert.equal(added.ok, true);
    const betaId = added.activeId;
    assert.notEqual(betaId, alphaId);

    // Pre-restart poll with SAME lsAddress returns pendingSwitchIgnored: true
    const preRestart = store.syncActive({ email: 'alpha@example.com', name: 'Alpha' });
    assert.equal(preRestart.pendingSwitchIgnored, true);
    assert.equal(preRestart.activeId, betaId);

    // Post-restart into WRONG account (DIFFERENT lsAddress!) self-heals immediately:
    // clears pendingSwitch, invalidates beta slot with invalidCredHash/invalidRefreshHash, aligns activeId to alpha without overwriting alpha's vault slot
    const alphaBefore = slots.get(`agy-powertools:account:${alphaId}`);
    slots.set('gemini:antigravity', makeToken('alpha@example.com', 'at-a-restarted', 'rt-alpha'));
    env.ANTIGRAVITY_LS_ADDRESS = '127.0.0.1:41002';
    const mismatched = store.syncActive({ email: 'alpha@example.com', name: 'Alpha' });
    assert.deepEqual(mismatched.switchMismatch, { expectedEmail: 'beta@example.com', actualEmail: 'alpha@example.com' });
    assert.equal(mismatched.activeId, alphaId);
    assert.equal(mismatched.accounts.find(a => a.id === betaId).hasCredential, false);
    assert.equal('invalidCredHash' in mismatched.accounts.find(a => a.id === betaId), false);
    assert.equal('invalidRefreshHash' in mismatched.accounts.find(a => a.id === betaId), false);
    assert.equal(slots.get(`agy-powertools:account:${alphaId}`), alphaBefore);

    // refreshCredentials MUST NOT falsely flip the quarantined/poisoned beta slot back to hasCredential: true
    const afterRefresh = store.refreshCredentials();
    assert.equal(afterRefresh.accounts.find(a => a.id === betaId).hasCredential, false);
    assert.throws(() => store.switchAccount(betaId), /隔离|失效|串号|重新登录/);
    // syncActive alone CANNOT clear quarantine on beta even with a new token (must come from fresh completeAdd with matching UI email + new refreshHash)
    slots.set('gemini:antigravity', makeToken('beta@example.com', 'at-b4', 'rt-beta-fresh'));
    const blockedSyncRecover = store.syncActive({ email: 'beta@example.com', name: 'Beta' });
    assert.ok(blockedSyncRecover.credentialMismatch);
    assert.equal(blockedSyncRecover.canRecordQuota, false);
    assert.equal(blockedSyncRecover.confirmedQuotaEmail, '');
    assert.equal(store.canRecordQuota('beta@example.com'), false);
    // completeAdd with old refresh_token OR non-matching UI email cannot clear quarantine
    slots.set('gemini:antigravity', makeToken('beta@example.com', 'at-b-same-rt', 'rt-beta'));
    assert.throws(
      () => store.completeAdd({ email: 'beta@example.com', prevEmail: 'alpha@example.com', prevCredHash: 'H_old' }),
      /重新登录/
    );
    slots.set('gemini:antigravity', makeToken('beta@example.com', 'at-b4', 'rt-beta-fresh'));
    assert.throws(
      () => store.completeAdd({ email: 'alpha@example.com', prevEmail: 'alpha@example.com', prevCredHash: 'H_old' }),
      /重新登录/
    );
    // Fresh completeAdd with matching UI email + new hash + new refreshHash clears quarantine cleanly
    const recoveredAdd = store.completeAdd({ email: 'beta@example.com', prevEmail: 'alpha@example.com', prevCredHash: 'H_old', triggerRelaunch: false });
    assert.equal(recoveredAdd.account.hasCredential, true);
    const recovered = store.syncActive({ email: 'beta@example.com', name: 'Beta' });
    assert.equal(recovered.accounts.find(a => a.id === betaId).hasCredential, true);
    assert.equal(recovered.canRecordQuota, true);
    assert.equal(recovered.confirmedQuotaEmail, 'beta@example.com');
    assert.equal(store.canRecordQuota('beta@example.com'), true);
    assert.equal(store.canRecordQuota('alpha@example.com'), false);
    assert.equal(store.canRecordQuota('alpha@example.com', { multiAccountEnabled: false }), true);

    // Different access_token (different credHash) but SAME refresh_token (same refreshHash) on alpha slot is caught by refreshCredentials & switchAccount
    slots.set(`agy-powertools:account:${alphaId}`, makeToken('alpha@example.com', 'at-different', 'rt-beta-fresh'));
    const dupRf = store.refreshCredentials({ accountId: alphaId });
    assert.equal(dupRf.valid, 0);
    assert.equal(dupRf.invalid, 1);
    assert.equal(dupRf.account.hasCredential, false);
    assert.throws(() => store.switchAccount(alphaId), /重复|重新登录/);

    // Mismatch during prepareAdd does NOT auto-backup into ownerAcct's slot (prevents chimera contamination)
    slots.set(`agy-powertools:account:${alphaId}`, makeToken('alpha@example.com', 'at-a-clean', 'rt-alpha'));
    const alphaSlotBeforeMismatch = slots.get(`agy-powertools:account:${alphaId}`);
    slots.set('gemini:antigravity', makeToken('alpha@example.com', 'at-chimera-overwrite', 'rt-alpha-sus'));
    const prepMismatchNoClobber = store.prepareAdd();
    assert.equal(prepMismatchNoClobber.ok, true);
    assert.equal(prepMismatchNoClobber.backedUpId, '');
    assert.equal(slots.get(`agy-powertools:account:${alphaId}`), alphaSlotBeforeMismatch);

    // 2. Native Windows switchAccount defers restoreToActive to relaunch-worker, threads switchId & profileDir,
    //    guards concurrent switches, NEVER falls back to live restoreInPlace() when blocked/manual, and does NOT mutate activeId prematurely
    const winDir = join(dir, 'win-store');
    mkdirSync(winDir, { recursive: true });
    const winScopePath = join(winDir, 'credential-user-scope');
    writeFileSync(winScopePath, 'old-scope');
    slots.set('gemini:antigravity', makeToken('alpha@example.com', 'at-wa1', 'rt-wa'));
    const winVault = makeVault({ backend: 'win32-credman' });
    const winRelaunchOpts = [];
    let nextRelaunchRes = { scheduled: true };
    const winEnv = { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:42001' };
    const winStore = createAccountsStore(winDir, {
      now: () => clock,
      vault: winVault,
      platform: 'win32',
      env: winEnv,
      appStoragePath: join(winDir, 'app_storage.json'),
      scopePath: winScopePath,
      relaunch: async opts => {
        winRelaunchOpts.push(opts);
        return nextRelaunchRes;
      }
    });
    const ws1 = winStore.syncActive({ email: 'alpha@example.com', name: 'Alpha' });
    const wAlphaId = ws1.activeId;
    slots.set('gemini:antigravity', makeToken('beta@example.com', 'at-wb1', 'rt-wb'));
    const ws2 = winStore.syncActive({ email: 'beta@example.com', name: 'Beta' });
    const wBetaId = ws2.activeId;

    restoreCalls = 0;
    const swDeferred = await winStore.switchAccount(wAlphaId, { triggerRelaunch: true });
    assert.equal(swDeferred.ok, true);
    assert.equal(swDeferred.relaunching, true);
    assert.equal(swDeferred.activeId, wBetaId, 'native Windows must NOT mutate activeId before relaunch confirms');
    assert.equal(winStore.confirmedQuotaEmail(), '');
    assert.equal(restoreCalls, 0, 'native Windows relaunch must defer restoreToActive to relaunch-worker');
    const lastOpts = winRelaunchOpts.at(-1);
    assert.equal(lastOpts.credentialSwitch.accountId, wAlphaId);
    assert.equal(lastOpts.credentialSwitch.expectedEmail, 'alpha@example.com');
    assert.ok(lastOpts.credentialSwitch.switchId);
    assert.ok(lastOpts.profileDir);
    assert.equal(lastOpts.clearScopePath, winScopePath);
    assert.equal(existsSync(winScopePath), true, 'scope file stays untouched until worker post-exit');

    // Concurrent switch and prepareAdd are rejected while pendingSwitch is live on native Windows
    assert.throws(() => winStore.switchAccount(wAlphaId, { triggerRelaunch: true }), /正在切换账号/);
    assert.throws(() => winStore.prepareAdd(), /正在切换账号/);

    // Worker ACK with failedSwitchId clears pendingSwitch cleanly WITHOUT quarantining target slot
    writeFileSync(join(winDir, 'relaunch-ack.json'), JSON.stringify({
      nonce: '11111111-2222-3333-4444-555555555555',
      state: 'launched',
      failedSwitchId: lastOpts.credentialSwitch.switchId
    }));
    winEnv.ANTIGRAVITY_LS_ADDRESS = '127.0.0.1:42002';
    const afterWorkerFail = winStore.syncActive({ email: 'beta@example.com', name: 'Beta' });
    assert.equal(afterWorkerFail.switchMismatch.restoreFailed, true);
    assert.equal(afterWorkerFail.credentialMismatch.afterSwitch, true);
    assert.equal(afterWorkerFail.canRecordQuota, false);
    assert.equal(winStore.list().accounts.find(a => a.id === wAlphaId).hasCredential, true, 'failedSwitchId must NOT falsely quarantine unapplied target');

    // Blocked or disabled relaunch on native Windows throws without live restoreInPlace(), leaves active cred & scope untouched, and clears pendingSwitch
    nextRelaunchRes = { scheduled: false, manualRestartRequired: true, reason: 'relaunch-blocked' };
    restoreCalls = 0;
    await assert.rejects(() => winStore.switchAccount(wAlphaId, { triggerRelaunch: true }), /未执行凭据切换/);
    assert.throws(() => winStore.switchAccount(wAlphaId, { triggerRelaunch: false }), /未执行凭据切换/);
    assert.equal(restoreCalls, 0, 'blocked native Windows switch must NEVER fall back to live restoreInPlace');
    assert.equal(parseMeta(slots.get('gemini:antigravity')).email, 'beta@example.com');
    assert.equal(existsSync(winScopePath), true, 'blocked native Windows switch must leave scope file untouched');
    assert.equal(winStore.list().activeId, wBetaId);
    assert.equal(JSON.parse(readFileSync(join(winDir, 'accounts.json'), 'utf8')).pendingSwitch, null);

    // 3. P2 #8: publicAccount strips internal hash & quarantine fields across ALL single-account & pickAutoSwitch RPC responses
    const assertPublicOnly = (acct, label) => {
      assert.ok(acct && typeof acct === 'object', `${label}: expected account object`);
      for (const field of ['credHash', 'refreshHash', 'invalidCredHash', 'invalidRefreshHash', 'quarantined']) {
        assert.equal(field in acct, false, `${label}: leaked internal field ${field}`);
      }
    };
    assertPublicOnly(swDeferred.account, 'switchAccount');
    const renamed = store.renameAccount(alphaId, 'Work');
    assertPublicOnly(renamed.account, 'renameAccount');
    const disabled = store.setDisabled(alphaId, true);
    assertPublicOnly(disabled.account, 'setDisabled');
    store.setDisabled(alphaId, false);
    const refreshedSingle = store.refreshCredentials({ accountId: betaId });
    assertPublicOnly(refreshedSingle.account, 'refreshCredentials');
    const unchangedSwitch = store.switchAccount(betaId);
    assertPublicOnly(unchangedSwitch.account, 'switchAccount(unchanged)');
    const prepNoop = store.prepareAdd();
    const noopAdd = store.completeAdd({
      email: 'beta@example.com',
      prevEmail: 'beta@example.com',
      prevCredHash: prepNoop.prevCredHash,
      prevRefreshHash: prepNoop.prevRefreshHash
    });
    assertPublicOnly(noopAdd.account, 'completeAdd(noop)');
    const autoPick = store.pickAutoSwitch('gemini');
    for (const cand of autoPick.candidates) assertPublicOnly(cand, 'pickAutoSwitch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Settings renders 5 category tabs, live cross-category search, nested subordinate toggles, removes 3 redundant rows, keeps About visible, and hides nav when disabled', () => {
  const ui = createPanelHarness(
    null,
    {
      enabled: true,
      language: 'zh-CN',
      multiAccount: true,
      composerWorkingBeam: true,
      composerQuotaHalo: true,
      sidebarRunningBeam: true,
      sidebarHideNativeSpinner: true,
      timing: true,
      toolDetails: true,
      sidebarFolderDrop: true,
      sidebarFolderDropPin: false,
      proxyEnabled: false
    }
  );

  // 1. All 5 category tabs render with tablist/tab semantics, default to general, and keep About pinned across every tab
  let tree = ui.renderSettings();
  const catNav = ui.find(tree, 'agy-settings-categories');
  assert.ok(catNav);
  assert.equal(catNav.props.role, 'tablist');
  const expectedCats = [
    ['general', '常规与外观', 'agy-setting-row-language'],
    ['beams', '动效与侧栏', 'agy-setting-row-composerWorkingBeam'],
    ['features', '统计与增强', 'agy-setting-row-pricingMode'],
    ['accounts', '账号与网络', 'agy-setting-row-multiAccount'],
    ['system', '系统与维护', 'agy-setting-row-configTransfer']
  ];
  for (const [id, label] of expectedCats) {
    const tabBtn = ui.find(tree, `agy-settings-cat-${id}`);
    assert.ok(tabBtn, `Missing category tab ${id}`);
    assert.equal(tabBtn.props.role, 'tab');
    assert.equal(ui.collectText(tabBtn).trim(), label);
  }
  assert.equal(ui.find(tree, 'agy-settings-cat-general').props['aria-selected'], true);
  assert.equal(ui.find(tree, 'agy-settings-cat-general').props['aria-current'], 'page');
  assert.ok(ui.find(tree, 'agy-setting-enabled'));
  assert.ok(ui.find(tree, 'agy-setting-row-customFont'));
  assert.ok(ui.find(tree, 'agy-setting-row-titlebarQuickPanel'));
  assert.equal(ui.find(tree, 'agy-setting-row-composerWorkingBeam'), null);
  assert.ok(ui.find(tree, 'agy-about-version'));

  for (const [id, , markerTestId] of expectedCats) {
    ui.find(tree, `agy-settings-cat-${id}`).props.onClick();
    tree = ui.renderSettings();
    assert.equal(ui.find(tree, `agy-settings-cat-${id}`).props['aria-selected'], true);
    assert.equal(ui.find(tree, `agy-settings-cat-${id}`).props['aria-current'], 'page');
    assert.ok(ui.find(tree, markerTestId), `Expected ${markerTestId} on category ${id}`);
    assert.ok(ui.find(tree, 'agy-about-version'), `Expected About visible on category ${id}`);
    // The 3 redundant page-level view preferences never render on any Settings category
    assert.equal(ui.find(tree, 'agy-setting-row-overviewRange'), null);
    assert.equal(ui.find(tree, 'agy-setting-row-accountViewMode'), null);
    assert.equal(ui.find(tree, 'agy-setting-row-accountQuotaWindow'), null);
    assert.equal(ui.find(tree, 'agy-account-view-mode'), null);
    assert.equal(ui.find(tree, 'agy-account-quota-window'), null);
    const tabText = ui.collectText(tree);
    assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(tabText), false, `Forbidden dot on category ${id}`);
  }

  // 2. Live cross-category search works from general tab across all 5 categories & preserves nested sub-panels
  ui.find(tree, 'agy-settings-cat-general').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-settings-search-clear'), null);

  // Search '代理' finds NetworkProxySection while activeCat is 'general'
  ui.find(tree, 'agy-settings-search').props.onChange({ target: { value: '代理' } });
  tree = ui.renderSettings();
  assert.ok(ui.find(tree, 'agy-settings-search-clear'));
  assert.ok(ui.find(tree, 'agy-setting-proxyEnabled'));
  assert.equal(ui.find(tree, 'agy-setting-row-compact'), null);
  assert.ok(ui.find(tree, 'agy-about-version'));

  // Search English 'proxy' also finds NetworkProxySection
  ui.find(tree, 'agy-settings-search').props.onChange({ target: { value: 'proxy' } });
  tree = ui.renderSettings();
  assert.ok(ui.find(tree, 'agy-setting-proxyEnabled'));

  // Search '流光' finds both composer & sidebar beams with their nested sub-panels intact
  ui.find(tree, 'agy-settings-search').props.onChange({ target: { value: '流光' } });
  tree = ui.renderSettings();
  assert.ok(ui.find(tree, 'agy-setting-composerWorkingBeam'));
  assert.ok(ui.find(tree, 'agy-setting-row-composerWorkingBeamPalette'));
  assert.ok(ui.find(tree, 'agy-setting-sidebarRunningBeam'));
  assert.ok(ui.find(tree, 'agy-setting-row-sidebarRunningBeamPalette'));
  assert.ok(ui.find(tree, 'agy-setting-sidebarHideNativeSpinner'));

  // Search 'export' finds System config backup/reset row
  ui.find(tree, 'agy-settings-search').props.onChange({ target: { value: 'export' } });
  tree = ui.renderSettings();
  assert.ok(ui.find(tree, 'agy-export-settings-btn'));
  assert.ok(ui.find(tree, 'agy-import-settings-btn'));

  // Nonsense query shows clean empty state with zero middle dots; clear button restores active category
  ui.find(tree, 'agy-settings-search').props.onChange({ target: { value: 'zzz-nonexistent-setting-xyz' } });
  tree = ui.renderSettings();
  const emptyCard = ui.find(tree, 'agy-settings-search-empty');
  assert.ok(emptyCard);
  assert.ok(ui.collectText(emptyCard).includes('未找到匹配的设置项'));
  assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(ui.collectText(emptyCard)), false);
  ui.find(tree, 'agy-settings-search-clear').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-settings-search-empty'), null);
  assert.equal(ui.find(tree, 'agy-settings-search-clear'), null);
  assert.ok(ui.find(tree, 'agy-setting-row-language'));

  // 3. Nested subordinate toggles/controls appear inside pt-bubble-panel when parent is ON and disappear when parent is OFF
  ui.find(tree, 'agy-settings-cat-beams').props.onClick();
  tree = ui.renderSettings();
  assert.ok(ui.find(tree, 'agy-setting-row-composerQuotaHaloWindow'));
  assert.equal(ui.find(tree, 'agy-setting-row-composerQuotaHaloWindow').props.className, 'pt-bubble-panel');
  const sbDrawer = ui.find(tree, 'agy-setting-row-sidebarRunningBeamPalette');
  assert.ok(ui.find(sbDrawer, 'agy-setting-row-sidebarHideNativeSpinner'));
  assert.ok(ui.find(sbDrawer, 'agy-setting-sidebarHideNativeSpinner'));

  ui.find(tree, 'agy-settings-cat-features').props.onClick();
  tree = ui.renderSettings();
  assert.ok(ui.find(tree, 'agy-setting-row-toolDetails'));
  assert.ok(ui.find(tree, 'agy-setting-toolDetails'));
  assert.ok(ui.find(tree, 'agy-setting-row-sidebarFolderDropPin'));
  assert.ok(ui.find(tree, 'agy-setting-sidebarFolderDropPin'));

  const parentOffUi = createPanelHarness(null, {
    enabled: true,
    language: 'zh-CN',
    composerQuotaHalo: false,
    sidebarRunningBeam: false,
    timing: false,
    sidebarFolderDrop: false
  });
  let offTree = parentOffUi.renderSettings();
  parentOffUi.find(offTree, 'agy-settings-cat-beams').props.onClick();
  offTree = parentOffUi.renderSettings();
  assert.equal(parentOffUi.find(offTree, 'agy-setting-row-composerQuotaHaloWindow'), null);
  assert.equal(parentOffUi.find(offTree, 'agy-setting-sidebarHideNativeSpinner'), null);
  parentOffUi.find(offTree, 'agy-settings-cat-features').props.onClick();
  offTree = parentOffUi.renderSettings();
  assert.equal(parentOffUi.find(offTree, 'agy-setting-row-toolDetails'), null);
  assert.equal(parentOffUi.find(offTree, 'agy-setting-toolDetails'), null);
  assert.equal(parentOffUi.find(offTree, 'agy-setting-row-sidebarFolderDropPin'), null);
  assert.equal(parentOffUi.find(offTree, 'agy-setting-sidebarFolderDropPin'), null);

  // 4. Master switch OFF hides pt-settings-nav and renders ONLY master enabled toggle + About
  const disabledUi = createPanelHarness(null, { enabled: false, language: 'zh-CN' });
  const disabledTree = disabledUi.renderSettings();
  assert.equal(disabledUi.find(disabledTree, 'agy-settings-nav'), null);
  assert.equal(disabledUi.find(disabledTree, 'agy-settings-categories'), null);
  assert.equal(disabledUi.find(disabledTree, 'agy-settings-search'), null);
  assert.ok(disabledUi.find(disabledTree, 'agy-setting-enabled'));
  assert.ok(disabledUi.find(disabledTree, 'agy-about-version'));
  assert.equal(disabledUi.find(disabledTree, 'agy-setting-row-language'), null);
});

test('Token unit (compact/zh), silent live FX currency display (USD/CNY with 6.7 fallback), and Settings UI / search work seamlessly', () => {
  const now = Date.now();
  const sampleDash = {
    pricing: {
      mode: 'standard',
      rates: [
        { model: 'gemini-4-carbon', input: 4, output: 20, cache: 0.2, cacheWrite: 5, until: '2099-01-01', next: { input: 4, output: 20, cache: 0.2, cacheWrite: 5 } }
      ]
    },
    requests: [
      { id: 'r1', model: 'Gemini 4 Carbon', timestampMs: now - 10_000, durationMs: 1500, inputTokens: 1_183_000_000, cacheReadTokens: 237_700, outputTokens: 8_540, costUsd: 10, status: 'success' }
    ]
  };

  // 1. Default compact + USD in Overview and Pricing
  const usdUi = createPanelHarness(null, { enabled: true, language: 'zh-CN', overviewRange: '24h', tokenUnit: 'compact', currency: 'USD', multiAccount: false });
  const usdOv = usdUi.renderOverview(sampleDash);
  const usdOvText = usdUi.collectText(usdOv);
  assert.ok(usdOvText.includes('1.18B'));
  assert.ok(usdOvText.includes('费用 (USD)'));
  assert.ok(usdOvText.includes('$10.00'));
  const usdPrice = usdUi.renderPricing(sampleDash);
  const usdPriceText = usdUi.collectText(usdPrice);
  assert.ok(usdPriceText.includes('每百万 Token 单价 (USD)'));
  assert.equal(usdUi.find(usdPrice, 'agy-price-cny-rate-note'), null);
  assert.ok(usdPriceText.includes('$4'));
  assert.ok(usdPriceText.includes('$20'));

  // 2. zh-CN + zh token unit + CNY with silent live env.fxRate() = 7.5 across Overview, EventTable, and Pricing (no rate note shown!)
  const cnyUi = createPanelHarness(null, { enabled: true, language: 'zh-CN', overviewRange: '24h', tokenUnit: 'zh', currency: 'CNY', multiAccount: false }, { fxRate: 7.5 });
  const cnyOv = cnyUi.renderOverview(sampleDash);
  const cnyOvText = cnyUi.collectText(cnyOv);
  assert.ok(cnyOvText.includes('11.83亿'));
  assert.ok(cnyOvText.includes('23.77万'));
  assert.ok(cnyOvText.includes('8540'));
  assert.ok(cnyOvText.includes('费用 (CNY)'));
  assert.ok(cnyOvText.includes('¥75.00'));
  assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(cnyOvText), false);

  const cnyReqText = cnyUi.collectText(cnyUi.renderEventTable(sampleDash, false));
  assert.ok(cnyReqText.includes('11.83亿'));
  assert.ok(cnyReqText.includes('23.77万'));
  assert.ok(cnyReqText.includes('8540'));
  assert.ok(cnyReqText.includes('¥75.00'));

  const cnyPrice = cnyUi.renderPricing(sampleDash);
  const cnyPriceText = cnyUi.collectText(cnyPrice);
  assert.ok(cnyPriceText.includes('每百万 Token 单价 (CNY)'));
  assert.equal(cnyUi.find(cnyPrice, 'agy-price-cny-rate-note'), null);
  assert.equal(cnyPriceText.includes('参考汇率'), false);
  assert.ok(cnyPriceText.includes('¥30.00'));
  assert.ok(cnyPriceText.includes('¥150.00'));
  assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(cnyPriceText), false);

  // 3. zh-TW + zh token unit + CNY with absent fxRate uses silent 6.7 fallback
  const twUi = createPanelHarness(null, { enabled: true, language: 'zh-TW', overviewRange: '24h', tokenUnit: 'zh', currency: 'CNY', multiAccount: false });
  const twOvText = twUi.collectText(twUi.renderOverview(sampleDash));
  assert.ok(twOvText.includes('11.83億'));
  assert.ok(twOvText.includes('23.77萬'));
  assert.ok(twOvText.includes('¥67.00'));
  const twPrice = twUi.renderPricing(sampleDash);
  const twPriceText = twUi.collectText(twPrice);
  assert.equal(twUi.find(twPrice, 'agy-price-cny-rate-note'), null);
  assert.ok(twPriceText.includes('¥26.80'));
  assert.ok(twPriceText.includes('¥134.00'));

  // 4. Settings UI: tokenUnit & currency rows in 统计与进度, NO manual cnyRate sub-row even when CNY is selected, and live Settings search
  const changes = [];
  const setUi = createPanelHarness(null, { enabled: true, language: 'zh-CN', tokenUnit: 'compact', currency: 'USD', multiAccount: false }, { onChange: p => changes.push(p) });
  let tree = setUi.renderSettings();
  setUi.find(tree, 'agy-settings-cat-features').props.onClick();
  tree = setUi.renderSettings();
  assert.ok(setUi.find(tree, 'agy-setting-row-tokenUnit'));
  assert.ok(setUi.find(tree, 'agy-token-unit-select'));
  assert.ok(setUi.find(tree, 'agy-setting-row-currency'));
  assert.ok(setUi.find(tree, 'agy-currency-select'));
  assert.equal(setUi.find(tree, 'agy-setting-row-cnyRate'), null);

  // Select CNY -> saves currency and renders NO manual rate panel/input
  setUi.find(tree, 'agy-currency-select-CNY').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { currency: 'CNY' });
  tree = setUi.renderSettings();
  assert.equal(setUi.find(tree, 'agy-setting-row-cnyRate'), null);
  assert.equal(setUi.find(tree, 'agy-cny-rate-input'), null);
  assert.equal(setUi.collectText(tree).includes('参考汇率'), false);

  // Live Settings search from default general tab finds both rows via Chinese & English keywords
  setUi.find(tree, 'agy-settings-cat-general').props.onClick();
  tree = setUi.renderSettings();
  setUi.find(tree, 'agy-settings-search').props.onChange({ target: { value: '人民币' } });
  tree = setUi.renderSettings();
  assert.ok(setUi.find(tree, 'agy-setting-row-currency'));
  assert.equal(setUi.find(tree, 'agy-setting-row-cnyRate'), null);
  assert.equal(setUi.find(tree, 'agy-setting-row-tokenUnit'), null);

  setUi.find(tree, 'agy-settings-search').props.onChange({ target: { value: '亿' } });
  tree = setUi.renderSettings();
  assert.ok(setUi.find(tree, 'agy-setting-row-tokenUnit'));
  assert.equal(setUi.find(tree, 'agy-setting-row-currency'), null);
  assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(setUi.collectText(tree)), false);
});

test('Issues #115/#116: Settings places halo tone, indicator tone/compact, composerQuota + nested composerQuotaWindow, and Motion & Sidebar tab cleanly', () => {
  // 1. Settings UI placement: composerQuotaHaloTone inside composerQuotaHalo sub-drawer; composerIndicatorTone + compact + composerQuota + composerQuotaWindow in 统计与进度
  const changes = [];
  const ui = createPanelHarness(null, {
    enabled: true,
    language: 'zh-CN',
    composerQuotaHalo: true,
    composerQuotaHaloTone: 'semantic',
    contextRing: true,
    speedStats: true,
    composerIndicatorTone: 'semantic',
    composerIndicatorCompact: false,
    composerQuota: true,
    composerQuotaWindow: 'auto'
  }, { onChange: p => changes.push(p) });

  let tree = ui.renderSettings();
  assert.equal(ui.collectText(ui.find(tree, 'agy-settings-cat-beams')).trim(), '动效与侧栏');
  ui.find(tree, 'agy-settings-cat-beams').props.onClick();
  tree = ui.renderSettings();
  const haloDrawer = ui.find(tree, 'agy-setting-row-composerQuotaHaloWindow');
  assert.ok(haloDrawer);
  assert.equal(haloDrawer.props.className, 'pt-bubble-panel');
  assert.ok(ui.find(haloDrawer, 'agy-setting-row-composerQuotaHaloTone'));
  assert.ok(ui.find(haloDrawer, 'agy-halo-tone-select'));
  assert.equal(ui.find(haloDrawer, 'agy-halo-tone-select-semantic')?.props?.selected, true);
  assert.equal(ui.find(haloDrawer, 'agy-halo-tone-select-monochrome')?.props?.selected, false);
  ui.find(haloDrawer, 'agy-halo-tone-select-monochrome').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { composerQuotaHaloTone: 'monochrome' });

  ui.find(tree, 'agy-settings-cat-features').props.onClick();
  tree = ui.renderSettings();
  const indRow = ui.find(tree, 'agy-setting-row-composerIndicatorTone');
  assert.ok(indRow);
  assert.ok(ui.find(indRow, 'agy-composer-tone-select'));
  assert.equal(ui.find(indRow, 'agy-composer-tone-select-semantic')?.props?.selected, true);
  assert.equal(ui.find(indRow, 'agy-composer-tone-select-muted')?.props?.selected, false);
  ui.find(indRow, 'agy-composer-tone-select-muted').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { composerIndicatorTone: 'muted' });
  const compactToggle = ui.find(indRow, 'agy-setting-composerIndicatorCompact');
  assert.ok(compactToggle);
  compactToggle.props.onCheckedChange(true);
  assert.deepEqual({ ...changes.at(-1) }, { composerIndicatorCompact: true });
  assert.ok(ui.find(tree, 'agy-setting-row-composerQuota'));
  const quotaWinDrawer = ui.find(tree, 'agy-setting-row-composerQuotaWindow');
  assert.ok(quotaWinDrawer);
  assert.equal(quotaWinDrawer.props.className, 'pt-bubble-panel');
  assert.ok(ui.find(quotaWinDrawer, 'agy-composer-quota-window'));
  ui.find(quotaWinDrawer, 'agy-composer-quota-window-5h').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { composerQuotaWindow: '5h' });
  ui.find(quotaWinDrawer, 'agy-composer-quota-window-weekly').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { composerQuotaWindow: 'weekly' });
  ui.find(quotaWinDrawer, 'agy-composer-quota-window-both').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { composerQuotaWindow: 'both' });
  ui.find(tree, 'agy-setting-composerQuota').props.onCheckedChange(false);
  assert.deepEqual({ ...changes.at(-1) }, { composerQuota: false });
  ui.find(tree, 'agy-setting-composerQuota').props.onCheckedChange(true);
  assert.deepEqual({ ...changes.at(-1) }, { composerQuota: true });
  assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(ui.collectText(tree)), false);

  // 2. zh-TW & en render updated Motion & Sidebar tab label cleanly
  const twUi = createPanelHarness(null, { enabled: true, language: 'zh-TW' });
  assert.equal(twUi.collectText(twUi.find(twUi.renderSettings(), 'agy-settings-cat-beams')).trim(), '動效與側欄');
  const enUi = createPanelHarness(null, { enabled: true, language: 'en' });
  assert.equal(enUi.collectText(enUi.find(enUi.renderSettings(), 'agy-settings-cat-beams')).trim(), 'Motion & Sidebar');

  // 3. Indicator style row and composerQuotaWindow drawer hide cleanly when parent toggles are off
  const hiddenUi = createPanelHarness(null, {
    enabled: true,
    language: 'zh-CN',
    composerQuotaHalo: false,
    contextRing: false,
    speedStats: false,
    composerQuota: false
  });
  let hTree = hiddenUi.renderSettings();
  hiddenUi.find(hTree, 'agy-settings-cat-beams').props.onClick();
  hTree = hiddenUi.renderSettings();
  assert.equal(hiddenUi.find(hTree, 'agy-setting-row-composerQuotaHaloTone'), null);
  hiddenUi.find(hTree, 'agy-settings-cat-features').props.onClick();
  hTree = hiddenUi.renderSettings();
  assert.equal(hiddenUi.find(hTree, 'agy-setting-row-composerIndicatorTone'), null);
  assert.equal(hiddenUi.find(hTree, 'agy-setting-row-composerQuotaWindow'), null);

  // 4. Cross-category search with bilingual keywords finds all settings immediately
  ui.find(tree, 'agy-settings-cat-general').props.onClick();
  tree = ui.renderSettings();
  for (const [query, expectedTestId] of [
    ['codex', 'agy-setting-row-composerIndicatorTone'],
    ['静谧', 'agy-setting-row-composerIndicatorTone'],
    ['monochrome', 'agy-setting-row-composerQuotaHaloTone'],
    ['图标', 'agy-setting-composerIndicatorCompact'],
    ['composer quota', 'agy-setting-row-composerQuota'],
    ['quota window', 'agy-setting-row-composerQuotaWindow'],
    ['额度周期', 'agy-setting-row-composerQuotaWindow']
  ]) {
    ui.find(tree, 'agy-settings-search').props.onChange({ target: { value: query } });
    tree = ui.renderSettings();
    assert.ok(ui.find(tree, expectedTestId), `Search "${query}" must find ${expectedTestId}`);
    assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(ui.collectText(tree)), false, `Search "${query}" must not render middle dots`);
  }
});

test('Advanced tab, inline (Beta) tags, uniform Select dropdowns, Custom Providers modal/list, Model Selection pickers, and UI tab persistence work cleanly without middle dots', async () => {
  const changes = [];
  let savedProviders = [];
  const listModelsCalls = [];
  const testConnCalls = [];
  const deletedIds = [];

  const ui = createPanelHarness(
    null,
    {
      enabled: true,
      language: 'zh-CN',
      sidebarRunningBeam: true,
      sidebarRunningBeamStyle: 'sweep',
      betaThinkingTranslate: true,
      betaThinkingEngine: 'free',
      betaThinkingDisplay: 'replace',
      betaThinkingTrigger: 'auto',
      betaComposerPredict: false,
      betaAiModel: '',
      betaAiTranslateModel: '',
      betaAiPredictModel: ''
    },
    {
      onChange: p => changes.push(p),
      betaProviders: () => savedProviders,
      betaProvidersList: async () => ({ ok: true, providers: savedProviders }),
      betaProviderSave: async payload => {
        const provider = { ...payload, id: payload.id || `prov-${savedProviders.length + 1}` };
        const idx = savedProviders.findIndex(p => p.id === provider.id);
        savedProviders = idx >= 0 ? savedProviders.map(p => (p.id === provider.id ? provider : p)) : [...savedProviders, provider];
        return { ok: true, provider, providers: savedProviders };
      },
      betaProviderDelete: async id => {
        deletedIds.push(id);
        savedProviders = savedProviders.filter(p => p.id !== id);
        return { ok: true, removed: true, providers: savedProviders };
      },
      betaAiListModels: async params => {
        listModelsCalls.push(params);
        return { ok: true, models: ['gpt-4o-mini', 'gpt-4.1', 'gemini-2.5-flash'] };
      },
      betaAiTest: async params => {
        testConnCalls.push(params);
        return { ok: true, latencyMs: 128, model: params.model || 'gpt-4o-mini' };
      }
    }
  );

  // 1. 6th category renamed to 高级功能 / 進階功能 / Advanced; sidebar beam style uses Select dropdown
  let tree = ui.renderSettings();
  assert.equal(ui.collectText(ui.find(tree, 'agy-settings-cat-beta')).trim(), '高级功能');
  const twAdvUi = createPanelHarness(null, { enabled: true, language: 'zh-TW' });
  assert.equal(twAdvUi.collectText(twAdvUi.find(twAdvUi.renderSettings(), 'agy-settings-cat-beta')).trim(), '進階功能');
  const enAdvUi = createPanelHarness(null, { enabled: true, language: 'en' });
  const enSettings0 = enAdvUi.renderSettings();
  assert.equal(enAdvUi.collectText(enAdvUi.find(enSettings0, 'agy-settings-cat-beta')).trim(), 'Advanced');

  // Sidebar beam style converted to Select dropdown (agy-sb-style-select)
  ui.find(tree, 'agy-settings-cat-beams').props.onClick();
  tree = ui.renderSettings();
  assert.ok(ui.find(tree, 'agy-sb-style-select'));
  assert.equal(ui.find(tree, 'agy-sb-style-select-sweep')?.props?.selected, true);
  ui.find(tree, 'agy-sb-style-select-pulse-inner').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { sidebarRunningBeamStyle: 'pulse-inner' });
  ui.find(tree, 'agy-sb-style-select-pulse-outside').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { sidebarRunningBeamStyle: 'pulse-outside' });

  // 2. Switch to 高级功能 (beta): no notice banner, inline (Beta) on both toggles, updated composer predict copy, and 3 Select dropdowns
  ui.find(tree, 'agy-settings-cat-beta').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-beta-notice'), null);
  const thinkRow = ui.find(tree, 'agy-setting-row-betaThinkingTranslate');
  const predictRow = ui.find(tree, 'agy-setting-row-betaComposerPredict');
  assert.ok(thinkRow && predictRow);
  assert.equal(ui.collectText(ui.find(thinkRow, 'agy-inline-beta-tag')).trim(), '(Beta)');
  assert.equal(ui.collectText(ui.find(predictRow, 'agy-inline-beta-tag')).trim(), '(Beta)');
  assert.equal(predictRow.props.description, '默认关闭。空闲且输入框为空时在行内显示续写建议，按 Tab 采纳；需在下方配置自定义 AI 模型。');

  // Verify English copy for composer intent prediction too
  enAdvUi.find(enSettings0, 'agy-settings-cat-beta').props.onClick();
  const enBetaTree = enAdvUi.renderSettings();
  assert.equal(
    enAdvUi.find(enBetaTree, 'agy-setting-row-betaComposerPredict').props.description,
    'Disabled by default. Shows an inline continuation suggestion when idle and the composer is empty, accepted via Tab; requires a custom AI model below.'
  );

  // Thinking translation options use Select dropdowns
  assert.ok(ui.find(tree, 'agy-beta-engine-select'));
  assert.ok(ui.find(tree, 'agy-beta-display-select'));
  assert.ok(ui.find(tree, 'agy-beta-trigger-select'));
  ui.find(tree, 'agy-beta-engine-select-ai').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { betaThinkingEngine: 'ai' });
  ui.find(tree, 'agy-beta-display-select-bilingual').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { betaThinkingDisplay: 'bilingual' });
  ui.find(tree, 'agy-beta-trigger-select-manual').props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { betaThinkingTrigger: 'manual' });

  // 3. Empty providers list + disabled model assignment triggers
  assert.ok(ui.find(tree, 'agy-ai-providers-empty'));
  assert.equal(ui.find(tree, 'agy-model-assign-trigger-default').props.disabled, true);
  assert.ok(ui.collectText(ui.find(tree, 'agy-model-assign-trigger-default')).includes('请先添加供应商'));
  assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(ui.collectText(tree)), false);

  // 4. Open Add Provider modal: 4 protocols reusing .pt-price-mode, eye key toggle, fetch models picker, test connection, and save
  ui.find(tree, 'agy-ai-provider-add').props.onClick();
  tree = ui.renderSettings();
  const modal = ui.find(tree, 'agy-ai-provider-modal');
  assert.ok(modal);
  const protoBar = ui.find(modal, 'agy-provider-protocol');
  assert.ok(protoBar.props.className.includes('pt-price-mode'));
  for (const proto of ['openai', 'openai-responses', 'anthropic', 'gemini']) {
    const btn = ui.find(protoBar, `agy-provider-proto-${proto}`);
    assert.ok(btn, `Missing protocol button ${proto}`);
    assert.ok(btn.props.className.includes('pt-price-mode-btn'));
  }

  // Switch protocol to anthropic & verify Base URL placeholder updates, then to openai-responses
  ui.find(modal, 'agy-provider-proto-anthropic').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-provider-base-url').props.placeholder, 'https://api.anthropic.com/v1');
  ui.find(tree, 'agy-provider-proto-gemini').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-provider-base-url').props.placeholder, 'https://generativelanguage.googleapis.com/v1beta');
  ui.find(tree, 'agy-provider-proto-openai-responses').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-provider-base-url').props.placeholder, 'https://api.openai.com/v1');

  // Fill fields and toggle eye button to reveal/hide API key
  ui.find(tree, 'agy-provider-name').props.onChange({ target: { value: 'My Relay' } });
  ui.find(tree, 'agy-provider-base-url').props.onChange({ target: { value: 'https://relay.example.com/v1' } });
  ui.find(tree, 'agy-provider-api-key').props.onChange({ target: { value: 'sk-live-secret-123' } });
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-provider-api-key').props.type, 'password');
  assert.equal(ui.find(tree, 'agy-provider-key-toggle').props['aria-pressed'], false);
  ui.find(tree, 'agy-provider-key-toggle').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-provider-api-key').props.type, 'text');
  assert.equal(ui.find(tree, 'agy-provider-key-toggle').props['aria-pressed'], true);

  // Fetch models -> searchable picker -> select models & test connection
  ui.find(tree, 'agy-provider-fetch-models').props.onClick();
  await new Promise(r => setImmediate(r));
  tree = ui.renderSettings();
  assert.equal(listModelsCalls.length, 1);
  assert.equal(listModelsCalls[0].protocol, 'openai-responses');
  assert.equal(listModelsCalls[0].baseUrl, 'https://relay.example.com/v1');
  assert.equal(listModelsCalls[0].apiKey, 'sk-live-secret-123');
  const fetchedList = ui.find(tree, 'agy-provider-fetched-list');
  assert.ok(fetchedList);
  ui.find(fetchedList, 'agy-provider-fetched-search').props.onChange({ target: { value: 'gpt' } });
  tree = ui.renderSettings();
  ui.find(tree, 'agy-provider-fetched-select-all').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-provider-models').props.value, 'gpt-4o-mini, gpt-4.1');

  // Test connection inside modal
  ui.find(tree, 'agy-provider-test-conn').props.onClick();
  await new Promise(r => setImmediate(r));
  tree = ui.renderSettings();
  assert.equal(testConnCalls.length, 1);
  assert.equal(testConnCalls[0].model, 'gpt-4o-mini');
  assert.ok(ui.collectText(ui.find(tree, 'agy-provider-feedback')).includes('128 ms'));

  // Save provider -> modal closes, provider row appears with hostname + model count badge, zero middle dots
  const modalForm = ui.findAll(ui.find(tree, 'agy-ai-provider-modal'), n => n.type === 'form')[0];
  modalForm.props.onSubmit({ preventDefault() {} });
  await new Promise(r => setImmediate(r));
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-ai-provider-modal'), null);
  const provRow = ui.find(tree, 'agy-ai-provider-row-prov-1');
  assert.ok(provRow);
  const provRowText = ui.collectText(provRow);
  assert.ok(provRowText.includes('My Relay'));
  assert.ok(provRowText.includes('OpenAI Responses'));
  assert.ok(provRowText.includes('relay.example.com'));
  assert.ok(provRowText.includes('2 个模型'));
  assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(provRowText), false);

  // 5. Edit existing provider pre-fills API key and reveals it on eye toggle
  ui.find(tree, 'agy-ai-provider-edit-prov-1').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-provider-api-key').props.value, 'sk-live-secret-123');
  assert.equal(ui.find(tree, 'agy-provider-api-key').props.type, 'password');
  ui.find(tree, 'agy-provider-key-toggle').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-provider-api-key').props.type, 'text');
  ui.find(tree, 'agy-provider-cancel').props.onClick();
  tree = ui.renderSettings();
  assert.equal(ui.find(tree, 'agy-ai-provider-modal'), null);

  // 6. Unified Model Selection pickers assign "providerId::modelId" and support "Follow default model"
  const defTrigger = ui.find(tree, 'agy-model-assign-trigger-default');
  assert.equal(defTrigger.props.disabled, false);
  defTrigger.props.onClick();
  tree = ui.renderSettings();
  const defPicker = ui.find(tree, 'agy-model-assign-picker-default');
  assert.ok(defPicker);
  const defOpts = ui.findAll(defPicker, n => n.props?.['data-testid'] === 'agy-model-assign-option-default');
  assert.equal(defOpts.length, 2);
  defOpts[0].props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { betaAiModel: 'prov-1::gpt-4o-mini' });

  tree = ui.renderSettings();
  ui.find(tree, 'agy-model-assign-trigger-translate').props.onClick();
  tree = ui.renderSettings();
  const trPicker = ui.find(tree, 'agy-model-assign-picker-translate');
  assert.ok(ui.find(trPicker, 'agy-model-assign-follow-translate'));
  const trOpts = ui.findAll(trPicker, n => n.props?.['data-testid'] === 'agy-model-assign-option-translate');
  trOpts[1].props.onClick();
  assert.deepEqual({ ...changes.at(-1) }, { betaAiTranslateModel: 'prov-1::gpt-4.1' });

  // Delete provider updates list cleanly
  tree = ui.renderSettings();
  ui.find(tree, 'agy-ai-provider-delete-prov-1').props.onClick();
  await new Promise(r => setImmediate(r));
  tree = ui.renderSettings();
  assert.deepEqual(deletedIds, ['prov-1']);
  assert.ok(ui.find(tree, 'agy-ai-providers-empty'));

  // 7. QuickPopover nested overlay guard protects ai-provider-modal and model-assign-picker
  for (const selectorMatch of ['[data-testid="agy-ai-provider-modal"]', '[data-testid^="agy-model-assign-picker"]']) {
    const guardUi = createPanelHarness(null, { enabled: true, titlebarQuickPanel: true }, {
      Popover: props => ({ type: 'popover', props, children: props.children }),
      querySelector: sel => (sel.includes(selectorMatch) ? {} : null)
    });
    const pop = guardUi.findAll(guardUi.renderQuickPopover(), n => n.type === 'popover')[0];
    pop.props.onOpenChange(true);
    let canceled = false;
    pop.props.onOpenChange(false, { event: { target: { closest: () => null } }, cancel: () => { canceled = true; } });
    assert.equal(canceled, true, `QuickPopover must stay open when ${selectorMatch} is active`);
  }

  // 8. QuickPopover tab, Page tab, and Settings category persist across unmount/remount and across localStorage
  const lsMap = new Map();
  const mockLs = {
    getItem: k => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => { lsMap.set(k, String(v)); },
    removeItem: k => { lsMap.delete(k); }
  };
  const persistUi = createPanelHarness(null, { enabled: true, titlebarQuickPanel: true, language: 'zh-CN' }, { localStorage: mockLs });
  // Open QuickPopover -> switch to settings -> switch Settings category to beta
  persistUi.find(persistUi.renderQuickPopover(), 'agy-titlebar-quick-trigger').props.onClick();
  persistUi.find(persistUi.renderQuickPopover(), 'agy-quick-tab-settings').props.onClick();
  let qpTree = persistUi.renderQuickPopover();
  persistUi.find(qpTree, 'agy-settings-cat-beta').props.onClick();
  qpTree = persistUi.renderQuickPopover();
  assert.equal(persistUi.find(qpTree, 'agy-settings-cat-beta').props['aria-selected'], true);

  // Switch Page tab to pricing
  let pageTree = persistUi.renderPage();
  persistUi.find(pageTree, 'agy-tab-pricing').props.onClick();
  assert.equal(lsMap.get('agy_powertools_quick_tab'), 'settings');
  assert.equal(lsMap.get('agy_powertools_page_tab'), 'pricing');
  assert.equal(lsMap.get('agy_powertools_settings_cat'), 'beta');

  // Unmount and remount QuickPopover, Settings, and Page in same harness
  persistUi.unmountComponent('quick-popover');
  persistUi.unmountComponent('settings');
  persistUi.unmountComponent('page');
  persistUi.find(persistUi.renderQuickPopover(), 'agy-titlebar-quick-trigger').props.onClick();
  qpTree = persistUi.renderQuickPopover();
  assert.equal(persistUi.find(qpTree, 'agy-quick-tab-settings').props['aria-current'], 'page');
  assert.equal(persistUi.find(qpTree, 'agy-settings-cat-beta').props['aria-selected'], true);
  pageTree = persistUi.renderPage();
  assert.equal(persistUi.find(pageTree, 'agy-tab-pricing').props['aria-current'], 'page');

  // Brand-new harness instance reading from same localStorage also restores all 3 states
  const freshUi = createPanelHarness(null, { enabled: true, titlebarQuickPanel: true, language: 'zh-CN' }, { localStorage: mockLs });
  freshUi.find(freshUi.renderQuickPopover(), 'agy-titlebar-quick-trigger').props.onClick();
  const freshQp = freshUi.renderQuickPopover();
  assert.equal(freshUi.find(freshQp, 'agy-quick-tab-settings').props['aria-current'], 'page');
  assert.equal(freshUi.find(freshQp, 'agy-settings-cat-beta').props['aria-selected'], true);
  assert.equal(freshUi.find(freshUi.renderPage(), 'agy-tab-pricing').props['aria-current'], 'page');
});
