import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getLocalePack } from '../lib/locales/index.mjs';
import { toZhTw } from '../lib/zh-tw.mjs';

const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');

function page(ready = false) {
  const callbacks = new Map();
  const nodes = [];
  const node = () => ({
    dataset: {}, isConnected: false,
    append(child) { child.isConnected = true; },
    setAttribute() {}, addEventListener() {}, remove() { this.isConnected = false; }
  });
  const attrs = new Set();
  const document = {
    readyState: ready ? 'complete' : 'loading',
    head: ready ? node() : null, body: ready ? node() : null,
    documentElement: { toggleAttribute(name, force) { if (force === undefined ? !attrs.has(name) : force) attrs.add(name); else attrs.delete(name); }, removeAttribute(name) { attrs.delete(name); }, hasAttribute(name) { return attrs.has(name); } },
    createElement() { const element = node(); nodes.push(element); return element; },
    addEventListener(event, callback) { if (!callbacks.has(event)) callbacks.set(event, []); callbacks.get(event).push(callback); },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  const context = vm.createContext({
    document, location: { pathname: '/' }, AbortController,
    React: { createElement() { return {}; } }, ReactDOM: { createRoot() { throw new Error('No DOM roots expected'); } }, HC() {},
    __agyNativeAdapter: { wrap() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
  });
  return { context, document, nodes, callbacks, node };
}

test('new-document injection waits for head and body and initializes exactly once', () => {
  const p = page();
  vm.runInContext(source, p.context);
  vm.runInContext(source, p.context);
  assert.equal(p.nodes.length, 0);
  assert.equal(p.context.__agyPowertools, undefined);
  assert.equal(p.callbacks.get('DOMContentLoaded').length, 1);
  p.document.head = p.node(); p.document.body = p.node();
  p.callbacks.get('DOMContentLoaded')[0]();
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(p.context.__agyPowertoolsPending, undefined);
  assert.equal(p.nodes.length, 1);
  vm.runInContext(source, p.context);
  assert.equal(p.nodes.length, 1);
});

test('already-loaded injection initializes without waiting and disposes cleanly', () => {
  const p = page(true);
  vm.runInContext(source, p.context);
  assert.equal(p.callbacks.has('DOMContentLoaded'), false);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-keep-outline'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(p.context.__agyPowertools, undefined);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-keep-outline'), false);
  assert.ok(p.nodes.every(n => !n.isConnected));
});

function fontPage(initial = {}) {
  const p = page(true), properties = new Map(), writes = [];
  let env, stored = { enabled: true, customFont: '', ...initial };
  p.document.documentElement.style = { setProperty: (k, v) => properties.set(k, v), removeProperty: k => properties.delete(k) };
  const create = p.document.createElement;
  p.document.createElement = tag => {
    if (tag !== 'canvas') return create(tag);
    return { getContext: () => ({
      font: '',
      measureText() {
        // 首个等宽基准恰好同宽，第二个基准仍能识别已安装字体。
        return { width: this.font.includes('"Maple Mono NF CN"') ? 100 : this.font.includes('serif') ? 80 : 100 };
      }
    }) };
  };
  vm.runInContext(readFileSync(new URL('../lib/native-fonts.js', import.meta.url),'utf8'), p.context);
  p.context.__agyPanels = value => { env = value; return { dispose() {} }; };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyInitialSettings = stored;
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.set') { writes.push(req.settings); stored = { ...stored, ...req.settings }; }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, req.method.startsWith('settings.') ? stored : {}));
  };
  vm.runInContext(source, p.context);
  return { ...p, properties, writes, env, setStored: patch => { stored = { ...stored, ...patch }; } };
}

test('本地字体保存后立即应用，清空、总开关和卸载均恢复客户端样式', async () => {
  const p = fontPage();
  await new Promise(resolve => setImmediate(resolve));
  await p.env.change({ customFontWeight: 500 });
  assert.equal(p.properties.get('--agy-custom-weight'), '500');
  assert.equal(p.properties.has('--agy-custom-font'), false);
  const densityCss = p.nodes.find(el => el.dataset?.agyDensityStyle === '')?.textContent || '';
  assert.match(densityCss, /html\[data-agy-custom-weight\]\{--agy-fw-light:.*--agy-fw-normal:.*--agy-fw-medium:.*--agy-fw-semibold:.*--agy-fw-bold:/);
  assert.match(densityCss, /html\[data-agy-custom-weight\] body\{--font-weight-light:var\(--agy-fw-light\)!important;.*--font-weight-medium:var\(--agy-fw-medium\)!important;.*--font-weight-semibold:var\(--agy-fw-semibold\)!important;.*--font-weight-bold:var\(--agy-fw-bold\)!important\}/);
  assert.match(densityCss, /html\[data-agy-custom-weight\] :where\(\.font-medium\)\{font-weight:var\(--agy-fw-medium\)\}/);
  assert.match(densityCss, /html\[data-agy-custom-font\] body\{[^}]*font-variation-settings:normal!important/);
  for (const rel of ['../lib/native-panels.js', '../lib/native-sidebar-monitor.js']) {
    const cssSrc = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.equal(/font-weight:(?:400|500|600)(?=[;}!])/.test(cssSrc), false, `${rel} should route CSS font-weight through --agy-fw-* vars`);
  }
  await p.env.change({ customFont: 'Maple Mono NF CN' });
  assert.equal(p.env.settingsError(), '');
  assert.equal(p.context.__agyPowertools.settings.customFont, 'Maple Mono NF CN');
  assert.equal(p.properties.get('--agy-custom-font'), '"Maple Mono NF CN"');
  assert.equal(p.document.documentElement.hasAttribute('data-agy-custom-font'), true);
  await p.env.change({ enabled: false });
  assert.equal(p.properties.has('--agy-custom-font'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-custom-font'), false);
  await p.env.change({ enabled: true });
  assert.equal(p.properties.get('--agy-custom-font'), '"Maple Mono NF CN"');
  await p.env.change({ customFont: '' });
  assert.equal(p.properties.has('--agy-custom-font'), false);
  await p.env.change({ customFont: 'Maple Mono NF CN' });
  p.context.__agyPowertools.dispose();
  assert.equal(p.properties.has('--agy-custom-font'), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-custom-font'), false);
});

test('不存在或格式错误的字体明确报错，不保存、不覆盖已生效字体', async () => {
  const p = fontPage({ customFont: 'Maple Mono NF CN' });
  await new Promise(resolve => setImmediate(resolve));
  for (const customFont of ['Missing Font', 'Maple\nMono', 'Inter;serif', 'Bad\\Font', 123]) {
    await p.env.change({ customFont });
    assert.match(p.env.customFontError(), /字体/);
    assert.equal(p.writes.length, 0);
    assert.equal(p.properties.get('--agy-custom-font'), '"Maple Mono NF CN"');
  }
  await p.env.change({ customFont: '' });
  assert.equal(p.env.settingsError(), '');
  p.context.__agyPowertools.dispose();
});

test('旧设置中的字体在本机不可用时显示错误，清空后可以恢复', async () => {
  const p = fontPage({ customFont: 'Missing Font' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(p.env.customFontError(), /未检测到本地字体/);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-custom-font'), false);
  await p.env.change({ customFont: '' });
  assert.equal(p.env.settingsError(), '');
  p.context.__agyPowertools.dispose();
});

test('字体检测错误不污染代理保存，语言切换及安装后同名重试可恢复', async () => {
  const p = fontPage({ customFont: 'Missing Font' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(p.env.customFontError(), /未检测到/);
  await p.env.change({ proxyUrl: 'http://127.0.0.1:7890', proxyEnabled: true });
  assert.equal(p.env.settingsError(), '');
  assert.equal(p.env.options().proxyUrl, 'http://127.0.0.1:7890');
  await p.env.change({ language: 'en' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(p.env.customFontError(), /Local font/);
  p.context.queryLocalFonts = async () => [{ family: 'Missing Font' }];
  p.context.navigator = { permissions: { query: async () => ({ state: 'granted' }) } };
  await p.env.change({ customFont: 'Missing Font' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.env.customFontError(), '');
  assert.equal(p.document.documentElement.hasAttribute('data-agy-custom-font'), true);
  p.context.__agyPowertools.dispose();
});

test('系统字体清单规范化去重，接受 Canvas 同宽的已安装字体，并保留读取错误', async () => {
  const p = fontPage();
  await new Promise(resolve => setImmediate(resolve));
  p.context.queryLocalFonts = async () => [
    { family: ' Inter ' }, { family: 'Inter' }, { family: 'System' },
    { family: '' }, { family: 'bad\nfont' }, { family: 'x'.repeat(129) }, { family: null }
  ];
  const families = await p.env.loadLocalFonts();
  assert.deepEqual(Array.from(families), ['Inter', 'System']);
  await p.env.change({ customFont: 'inter' });
  assert.equal(p.env.customFontError(), '');
  assert.equal(p.env.options().customFont, 'inter');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.properties.get('--agy-custom-font'), '"inter"');
  p.context.queryLocalFonts = async () => [];
  await assert.rejects(p.env.loadLocalFonts, /未读取到/);
  p.context.queryLocalFonts = async () => { throw new Error('权限被拒绝'); };
  await assert.rejects(p.env.loadLocalFonts, /权限被拒绝/);
  delete p.context.queryLocalFonts;
  await assert.rejects(p.env.loadLocalFonts, /不支持读取/);
  p.context.__agyPowertools.dispose();
});

test('权限接口异常或缺少用户手势时继续核验字形，并保留失败原因', async () => {
  for (const mode of ['unsupported-name', 'missing-method', 'security-error']) {
    const p = fontPage();
    await new Promise(resolve => setImmediate(resolve));
    p.context.queryLocalFonts = async () => { throw new Error('SecurityError: requires user activation'); };
    p.context.navigator = { permissions: mode === 'missing-method' ? {} : {
      query: async () => { if (mode === 'unsupported-name') throw new TypeError('Unsupported permission local-fonts'); return { state: 'granted' }; }
    } };
    await p.env.change({ customFont: 'Maple Mono NF CN' });
    assert.equal(p.env.customFontError(), '');
    assert.equal(p.properties.get('--agy-custom-font'), '"Maple Mono NF CN"');
    if (mode !== 'missing-method') assert.match(p.env.customFontNotice(), /Unsupported permission|SecurityError/);
    await p.env.change({ customFont: 'Missing Font' });
    assert.match(p.env.customFontError(), /未检测到/);
    if (mode !== 'missing-method') assert.match(p.env.customFontError(), /Unsupported permission|SecurityError/);
    assert.equal(p.env.options().customFont, 'Maple Mono NF CN');
    p.context.__agyPowertools.dispose();
  }
});

test('await 字体保存返回后已清除旧运行时错误并完成样式同步', async () => {
  const p = fontPage({ customFont: 'Missing Font' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(p.env.customFontError(), /未检测到/);
  await p.env.change({ customFont: 'Maple Mono NF CN' });
  assert.equal(p.env.customFontError(), '');
  assert.equal(p.properties.get('--agy-custom-font'), '"Maple Mono NF CN"');
  p.context.__agyPowertools.dispose();
});

test('异步字体检测完成后不覆盖已关闭的插件，也不会在卸载后重新加样式', async () => {
  const p = fontPage();
  await new Promise(resolve => setImmediate(resolve));
  let resolveFonts;
  p.context.queryLocalFonts = () => new Promise(resolve => { resolveFonts = resolve; });
  p.context.navigator = { permissions: { query: async () => ({ state: 'granted' }) } };
  // 通过外部同步设置触发检测，而非阻塞保存中的验证。
  p.setStored({ customFont: 'Inter' });
  await p.env.change({ language: 'en' });
  await new Promise(resolve => setImmediate(resolve));
  await p.env.change({ enabled: false });
  resolveFonts([{ family: 'Inter' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.properties.has('--agy-custom-font'), false);
  p.context.__agyPowertools.dispose();
  assert.equal(p.document.documentElement.hasAttribute('data-agy-custom-font'), false);
});

test('multi-pane conversations with multiple composers stay healthy without triggering reload loops', () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-1';
  const renderedRings = [];
  p.context.ReactDOM = { createRoot(mount) { renderedRings.push(mount); return { render() {}, unmount() {} }; } };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const makeComposerTrigger = () => {
    const parent = { insertBefore(child) { child.isConnected = true; } };
    return { isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? {} : null };
  };
  const twoTriggers = [makeComposerTrigger(), makeComposerTrigger()];
  let ringNodes = [{}, {}];
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return twoTriggers;
    if (sel === '[data-testid="agy-context-ring-trigger"]') return ringNodes;
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true };
  vm.runInContext(source, p.context);
  assert.equal(renderedRings.length, 2);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  p.context.__agyPowertools.dispose();
});

test('side-question and split-pane composers fetch and render independent context and telemetry per cascadeId', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/main-conv';
  const renderedByMount = new Map();
  const mountOrder = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  p.context.ReactDOM = {
    createRoot(mount) {
      mountOrder.push(mount);
      return {
        render(el) { renderedByMount.set(mount, el); },
        unmount() {}
      };
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const makeComposerTrigger = cid => {
    const parent = { insertBefore(child) { child.isConnected = true; } };
    const card = { cid };
    return { cid, isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  };
  const mainTrigger = makeComposerTrigger('main-conv');
  const btwTrigger = makeComposerTrigger('btw-conv');
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.composerCascadeId = el => el?.cid || '';
  const stateRequests = [];
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, contextRing: true, speedStats: true }));
      return;
    }
    if (req.method === 'state') {
      stateRequests.push(req.conversationId);
      const reply = req.conversationId === 'btw-conv'
        ? { conversationId: 'btw-conv', contextWindow: { usedPercent: 80.4, usedTokens: 632000, maxTokens: 786432, categories: [] }, telemetry: { tps: 38, latestTps: 60.4 }, turns: [], requests: [] }
        : { conversationId: 'main-conv', contextWindow: { usedPercent: 78.2, usedTokens: 615000, maxTokens: 786432, categories: [] }, telemetry: { tps: 38, latestTps: 51.7 }, turns: [], requests: [] };
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, reply));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [mainTrigger, btwTrigger];
    if (sel === '[data-testid="agy-context-ring-trigger"]') return [{}, {}];
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true, speedStats: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 40));
  assert.ok(stateRequests.includes('main-conv'));
  assert.ok(stateRequests.includes('btw-conv'));
  assert.equal(mountOrder.length, 2);
  const mainData = renderedByMount.get(mountOrder[0])?.props?.data;
  const btwData = renderedByMount.get(mountOrder[1])?.props?.data;
  assert.equal(mainData?.conversationId, 'main-conv');
  assert.equal(mainData?.contextWindow?.usedPercent, 78.2);
  assert.equal(btwData?.conversationId, 'btw-conv');
  assert.equal(btwData?.contextWindow?.usedPercent, 80.4);
  assert.equal(btwData?.telemetry?.latestTps, 60.4);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  p.context.__agyPowertools.dispose();
});

test('accountSwitcher respects multiAccount master switch, toggles native settings hide attr, and cleans up on dispose', () => {
  const pOff = page(true);
  const offMounts = [];
  const offSettingsBtn = { isConnected: true, parentElement: { insertBefore(node) { node.isConnected = true; offMounts.push(node); } } };
  pOff.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  pOff.context.__agyNativeAdapter.installPage = () => true;
  pOff.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} });
  pOff.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? offSettingsBtn : null;
  pOff.context.__agyInitialSettings = { enabled: true, multiAccount: false, accountSwitcher: true };
  vm.runInContext(source, pOff.context);
  assert.equal(offMounts.length, 0);
  assert.equal(pOff.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
  pOff.context.__agyPowertools.dispose();

  const p = page(true);
  const mountedNodes = [];
  const settingsBtn = {
    isConnected: true,
    parentElement: {
      children: [],
      insertBefore(node, before) {
        node.isConnected = true;
        mountedNodes.push({ node, before });
      }
    }
  };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({
    Page: () => null,
    Sidebar: () => null,
    AccountSwitcher: () => null,
    dispose() {}
  });
  p.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? settingsBtn : null;
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, accountSwitcher: true };
  vm.runInContext(source, p.context);
  assert.equal(mountedNodes.length, 1);
  assert.equal(mountedNodes[0].node.dataset.agyPowertoolsRoot, 'account-switcher');
  assert.equal(mountedNodes[0].before, settingsBtn);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(mountedNodes[0].node.isConnected, false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
});

test('renderRoot does not repeatedly call insertBefore when before equals existing mount', () => {
  const p = page(true);
  let insertCount = 0;
  const link = { isConnected: true, nextSibling: null };
  const parent = {
    insertBefore(node) {
      insertCount++;
      node.isConnected = true;
      link.nextSibling = node;
    }
  };
  link.parentElement = parent;
  let observerCb = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  let scheduled = null;
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.document.querySelector = sel => sel === 'a[href="/customizations"]' ? link : null;
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  assert.equal(insertCount, 1);
  // Trigger a second mount cycle after link.nextSibling points to entry.mount
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(insertCount, 1);
  p.context.__agyPowertools.dispose();
});

test('Powertools sidebar entry repositions after /customizations once /customizations mounts later', () => {
  const p = page(true);
  const children = [];
  const syncSiblings = () => {
    for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
  };
  let insertCount = 0;
  const navContainer = {
    isConnected: true,
    insertBefore(node, before) {
      insertCount++;
      const existingIdx = children.indexOf(node);
      if (existingIdx >= 0) children.splice(existingIdx, 1);
      node.isConnected = true;
      if (before && children.includes(before)) children.splice(children.indexOf(before), 0, node);
      else children.push(node);
      syncSiblings();
    }
  };
  const newChat = { id: 'new-chat', isConnected: true, parentElement: navContainer, nextSibling: null };
  children.push(newChat);
  let custLink = null;
  let observerCb = null;
  let scheduled = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.document.querySelector = sel => {
    if (sel === 'a[href="/customizations"]') return custLink;
    if (sel === '[data-testid="sidebar-navigation-items"]') return navContainer;
    return null;
  };
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  assert.equal(children.length, 2);
  assert.equal(children[1].dataset.agyPowertoolsRoot, 'management');

  // Now native React mounts Automations and Customizations after Powertools
  const automations = { id: 'auto', isConnected: true, parentElement: navContainer, nextSibling: null };
  custLink = { id: 'cust', isConnected: true, parentElement: navContainer, nextSibling: null };
  children.push(automations, custLink);
  syncSiblings();
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.deepEqual(children.map(c => c.id || c.dataset?.agyPowertoolsRoot), ['new-chat', 'auto', 'cust', 'management']);
  const countAfterMove = insertCount;

  // Next mount tick must be a no-op (no flicker loop)
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(insertCount, countAfterMove);

  p.context.__agyPowertools.dispose();
  assert.equal(children.find(c => c.dataset?.agyPowertoolsRoot === 'management')?.isConnected, false);
});

test('cold-start proxy prompt banner appears on mismatch, handles unreachable port, dismisses, and cleans up on dispose', async () => {
  const p = page(true);
  const bodyChildren = [];
  const makeEl = () => {
    const listeners = new Map();
    const el = {
      dataset: {},
      children: [],
      isConnected: false,
      textContent: '',
      append(...items) {
        for (const item of items) {
          item.isConnected = true;
          this.children.push(item);
        }
      },
      setAttribute() {},
      addEventListener(type, fn) { listeners.set(type, fn); },
      click() { listeners.get('click')?.(); },
      remove() {
        this.isConnected = false;
        const idx = bodyChildren.indexOf(this);
        if (idx >= 0) bodyChildren.splice(idx, 1);
      }
    };
    return el;
  };
  p.document.createElement = () => makeEl();
  p.document.body = {
    append(el) { el.isConnected = true; bodyChildren.push(el); }
  };

  const sent = [];
  p.context.__agyPowertoolsHost = payload => {
    const req = JSON.parse(payload);
    sent.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' });
      } else if (req.method === 'proxy.status') {
        p.context.__agyPowertoolsReceive(req.id, {
          configured: true,
          configuredUrl: 'http://127.0.0.1:7897',
          configuredDisplayUrl: 'http://127.0.0.1:7897',
          configuredForceHttp1: false,
          active: false,
          mismatch: true,
          reason: 'not-applied',
          canRelaunch: true
        });
      } else if (req.method === 'proxy.relaunch') {
        p.context.__agyPowertoolsReceive(req.id, req.force
          ? { ok: true, relaunching: true, proxyActive: true }
          : { ok: false, portUnreachable: true, message: '代理端口 127.0.0.1:7897 无法连接' });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setTimeout(resolve, 20));

  const findBanner = () => bodyChildren.find(el => el.dataset.testid === 'agy-proxy-prompt-banner');
  const findBtn = (banner, testId) => banner?.children?.flatMap(c => c.children || []).find(b => b.dataset?.testid === testId);

  let banner = findBanner();
  assert.ok(banner);
  assert.ok(banner.children[0].textContent.includes('http://127.0.0.1:7897'));
  assert.equal(banner.children[0].textContent.includes('\u00b7'), false);

  // Clicking relaunch when port is closed warns instead of restarting immediately
  findBtn(banner, 'agy-proxy-banner-relaunch').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  banner = findBanner();
  assert.ok(banner);
  assert.ok(banner.children[0].textContent.includes('无法连接'));
  assert.ok(findBtn(banner, 'agy-proxy-banner-force'));

  // Dismiss removes banner cleanly
  findBtn(banner, 'agy-proxy-banner-dismiss').click();
  assert.equal(findBanner(), undefined);

  p.context.__agyPowertools.dispose();
  assert.equal(bodyChildren.some(el => el.dataset.testid === 'agy-proxy-prompt-banner'), false);
});

test('native-bindings resolves 2.34.0 notification hook without type:"add" and stays optional when absent', () => {
  const bindingsSource = readFileSync(new URL('../lib/native-bindings.js', import.meta.url), 'utf8');
  const makeEnv = (toastHook, jcImpl = null) => {
    const Sy = () => null; Sy.displayName = 'CompactTooltipBaseUi';
    const ctx = vm.createContext({
      React: {},
      createFileRoute: () => opts => opts,
      HC: () => ({ defaultOpen: 1, matchTriggerWidth: 1, disableMobileSheet: 1 }),
      IC: () => ({ startDragTracking: 1, tag: 'popover-trigger-element', asChild: 1 }),
      JC: jcImpl || (() => ({ scrollContainerClassName: 1, arrowNavigable: 1, matchTriggerWidth: 1 })),
      KC: () => ({ asChild: 1, isMobile: 1, setIsOpen: 1 }),
      GC: () => ({ tooltipPlace: 1, secondaryAction: 1, tag: 'main-row-trigger' }),
      Uy: () => ({ paddingClassName: 1, computedAriaLabel: 1, asChild: 1 }),
      XP: () => ({ onCheckedChange: 1, desc: 'aria-describedby', role:"switch" }),
      UP: ({label: a}) => ({ rightElement: a, extraContent: 1, descriptionId: 1 }),
      TP: () => 'agy-card bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border',
      VP: () => ({ headerRight: 1, defaultCollapsed: 1, forceExpanded: 1 }),
      dq: ({name: a}) => ({ cls: 'google-symbols', kind: 'Icon', a }),
      k0: ({trigger: a}) => ({ triggerVisible: a, onCollapseComplete: 1, defaultExpanded: 1 }),
      Sy,
      kT: () => ({ ownsHighlight: 1, onHighlightExit: 1, onSearchQueryChange: 1 }),
      lT: () => ({ asChild: 1, openOnHover: 1, closeDelay: 1, attr: "data-no-drag" }),
      mT: () => ({ collisionBoundary: 1, pad: 1, alignOffset: 1, keepMounted: 1 }),
      nT: () => ({ highlighted: 1, selected: 1, action: 1, description: 1, managedHighlight: 1 }),
      HU: s => s.sourceTrajectoryStepInfo?.stepIndex,
      Kc: x => x,
      resolveFn: () => { const c = Kc(Proto.CascadeConfigSchema, { lookupCustomModelInfo: 1, customModelInfoOverride: 1, checkpointConfig: void 0 }); return c; },
      segmentFn: () => ({ getStepRendererConfig: 1, hasBeenCollapsed: 1, leadingSteps: 1 }),
      menuFn: function m(a,{onRenameClick:b}) { return { b, onRestoreClick: 1, onCreateGroup: 1 }; },
      Proto: { CascadeConfigSchema: {} },
      Wb: x => { const o = Object.create(null); o.$typeName=x.members+'oneof'; return o; },
      IJ: s => { const x = {}; x._dirtyElements=1; x._dirtyLeaves=1; x._parsed=!0; return JSON.parse(s); },
      LN: s => JSON.stringify({ version:1, singleParagraph: s, type:"root" }),
      ...(toastHook ? { kn: toastHook } : {})
    });
    // Ensure resolveFn contains exact matcher literal checkpointConfig=void 0
    vm.runInContext(`resolveFn = function(checkpointConfig=void 0){ const x=Kc(Proto.CascadeConfigSchema, checkpointConfig); return { lookupCustomModelInfo: x, customModelInfoOverride: 1 }; };`, ctx);
    vm.runInContext(bindingsSource, ctx);
    return ctx.__agyResolveNativeBindings([]);
  };

  // 2.34.0 style (action creator Mqa instead of inline type:"add")
  const toast234 = function () { return ({ autoDismissMs: m, plainTextFallback: p, primaryActionLabel: l }) => b.showNotification({ primaryActionLabel: l, autoDismissMs: m, plainTextFallback: p }); };
  const resolved234 = makeEnv(toast234);
  assert.equal(resolved234.names.um, 'kn');
  assert.equal(resolved234.bindings.um, toast234);

  // Absent toast hook degrades gracefully without throwing
  const resolvedNoToast = makeEnv(null);
  assert.equal(resolvedNoToast.bindings.um, undefined);

  // 2.35.0 style JC (scrollContainerClassName removed, keeps arrowNavigable + matchTriggerWidth + collisionAvoidance / contentRef.current=)
  const jc235 = function LQ({ arrowNavigable: l, matchTriggerWidth: k, collisionAvoidance: n }) { const y = { contentRef: {} }; y.contentRef.current = l || k || n; return y; };
  const resolved235 = makeEnv(toast234, jc235);
  assert.equal(resolved235.names.JC, 'JC');
  assert.equal(resolved235.bindings.JC, jc235);
});

test('overview mounts both progress and overviewQuota in stable order without insertBefore ping-pong', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-ov';
  const children = [];
  let insertCount = 0;
  const syncSiblings = () => {
    for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
  };
  const overview = {
    isConnected: true,
    insertBefore(node, before) {
      insertCount++;
      const idx = children.indexOf(node);
      if (idx >= 0) children.splice(idx, 1);
      node.isConnected = true;
      if (before && children.includes(before)) children.splice(children.indexOf(before), 0, node);
      else children.push(node);
      syncSiblings();
    }
  };
  let observerCb = null;
  let scheduled = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, Progress: () => null, OverviewQuota: () => null, dispose() {} });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, progress: true, overviewQuota: true }));
      return;
    }
    if (req.method === 'state') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-ov', turns: [], requests: [], progress: { status: 'complete', tasks: [] } }));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.document.querySelector = sel => sel === '[data-testid="overview-panel"]' ? overview : null;
  p.context.__agyInitialSettings = { enabled: true, progress: true, overviewQuota: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(children.map(c => c.dataset.agyPowertoolsRoot).join(','), 'progress,overview-quota');
  const stableCount = insertCount;
  // Re-trigger mount cycles multiple times -> zero extra insertBefore mutations
  for (let i = 0; i < 4; i++) {
    observerCb?.([{ target: { closest: () => null } }]);
    scheduled?.();
  }
  assert.equal(insertCount, stableCount);
  p.context.__agyPowertools.dispose();
});

test('startAddAccount awaits active sync and calls accounts.completeAdd, and refreshAccount skips quota.observe on credentialMismatch', async () => {
  const p = page(true);
  let capturedEnv = null;
  let currentEmail = 'alpha@example.com';
  const calls = [];
  let mismatchNextSync = false;
  let pendingIgnoredNextSync = false;
  let quotaRemaining = 0.9;

  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({
    email: currentEmail,
    name: currentEmail.split('@')[0],
    plan: 'Google AI Ultra',
    planId: 'g1-ultra-tier'
  });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({
      response: {
        groups: [{
          displayName: 'Gemini Models',
          buckets: [{ bucketId: 'gemini-5h', window: '5h', remaining: { case: 'remainingFraction', value: quotaRemaining }, resetTime: null }]
        }]
      }
    })
  });
  p.context.__agyNativeAdapter.startAccountLogin = async () => {
    currentEmail = 'beta@example.com';
    return { ok: true, email: currentEmail };
  };
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' });
      } else if (req.method === 'accounts.autoSwitchCandidate') {
        p.context.__agyPowertoolsReceive(req.id, { candidate: { id: 'acct-a', email: 'alpha@example.com', name: 'Alpha' }, cooldownRemainingMs: 0 });
      } else if (req.method === 'accounts.prepareAdd') {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, backedUpId: 'acct-a', prevCredHash: 'HASH_A', prevRefreshHash: 'RF_HASH_A', activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'alpha@example.com', hasCredential: true }] });
      } else if (req.method === 'accounts.syncActive') {
        if (mismatchNextSync) {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [{ id: 'acct-b', email: 'beta@example.com', hasCredential: true }],
            credentialMismatch: { uiEmail: 'beta@example.com', credentialEmail: 'alpha@example.com' }
          });
        } else if (pendingIgnoredNextSync) {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [
              { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
              { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
            ],
            pendingSwitchIgnored: true
          });
        } else {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [
              { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
              { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
            ]
          });
        }
      } else if (req.method === 'accounts.completeAdd') {
        p.context.__agyPowertoolsReceive(req.id, {
          ok: true,
          relaunching: false,
          manualRestartRequired: true,
          account: { id: 'acct-b', email: 'beta@example.com', name: 'beta' },
          activeId: 'acct-b',
          accounts: [
            { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
            { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
          ]
        });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(capturedEnv);

  // Even when the newly signed-in account has a depleted bucket and autoSwitchAccount is enabled,
  // startAddAccount suppresses auto-switch so it never races with completeAdd / relaunch.
  quotaRemaining = 0;
  const addRes = await capturedEnv.startAddAccount('Backup');
  assert.equal(addRes.ok, true);
  assert.equal(addRes.manualRestartRequired, true);
  assert.equal(calls.some(c => c.method === 'accounts.autoSwitchCandidate'), false);
  assert.equal(p.context.document.querySelector('[data-testid="agy-autoswitch-banner"]'), null);
  quotaRemaining = 0.9;
  const methods = calls.map(c => c.method);
  const prepIdx = methods.indexOf('accounts.prepareAdd');
  const syncIdx = methods.lastIndexOf('accounts.syncActive');
  const completeIdx = methods.indexOf('accounts.completeAdd');
  assert.ok(prepIdx >= 0 && syncIdx > prepIdx && completeIdx > syncIdx, `Expected prepareAdd -> syncActive -> completeAdd, got ${methods.join(',')}`);
  const completeCall = calls[completeIdx];
  assert.equal(completeCall.email, 'beta@example.com');
  assert.equal(completeCall.prevEmail, 'alpha@example.com');
  assert.equal(completeCall.prevCredHash, 'HASH_A');
  assert.equal(completeCall.prevRefreshHash, 'RF_HASH_A');
  assert.equal(completeCall.relaunch, true);

  // P2 #9: when syncActive returns pendingSwitchIgnored, refreshAccount MUST NOT trigger maybeAutoSwitch even when quota is depleted
  quotaRemaining = 0;
  pendingIgnoredNextSync = true;
  await capturedEnv.refreshAccountQuotas('acct-b');
  assert.equal(calls.some(c => c.method === 'accounts.autoSwitchCandidate'), false);
  pendingIgnoredNextSync = false;
  quotaRemaining = 0.9;

  // When syncActive reports credentialMismatch, refreshAccount MUST NOT call quota.observe
  const beforeObserve = calls.filter(c => c.method === 'quota.observe').length;
  mismatchNextSync = true;
  await capturedEnv.refreshAccountQuotas('acct-b');
  const afterObserve = calls.filter(c => c.method === 'quota.observe').length;
  assert.equal(afterObserve, beforeObserve);

  p.context.__agyPowertools.dispose();
});

test('refreshAccount handles out-of-order concurrency, failure retry without 60s lockout, missing buckets, vaultReason preservation, and loadDashboard(true) override', async () => {
  const p = page(true);
  let capturedEnv = null;
  const calls = [];
  const quotaCalls = [];
  let pendingFirstQuota = null;
  let quotaMode = 'stall-first';
  let failSyncActive = false;
  let pendingDashboard = null;
  let stallFirstDashboard = true;

  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({
    email: 'alice@example.com',
    name: 'Alice',
    plan: 'Google AI Ultra',
    planId: 'g1-ultra-tier'
  });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: opts => {
      quotaCalls.push(opts || {});
      if (quotaMode === 'stall-first') {
        quotaMode = 'fresh-second';
        return new Promise(resolve => { pendingFirstQuota = resolve; });
      }
      if (quotaMode === 'fresh-second') {
        quotaMode = 'normal';
        return Promise.resolve({
          response: {
            groups: [
              { displayName: 'Missing Buckets Group' },
              {
                displayName: 'Gemini Models',
                buckets: [
                  { bucketId: 'g-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.42 }, resetTime: { seconds: 1800000000n } },
                  { bucketId: 'g-untouched', window: 'weekly', remaining: { case: 'remainingFraction', value: 1 }, resetTime: { seconds: 1800600000n }, description: '' },
                  { bucketId: 'g-off', window: '5h', remaining: { case: 'remainingFraction', value: 0 }, disabled: true }
                ]
              }
            ]
          }
        });
      }
      if (quotaMode === 'fail-once') {
        quotaMode = 'normal';
        return Promise.reject(new Error('network blip'));
      }
      return Promise.resolve({
        response: {
          groups: [{
            displayName: 'Gemini Models',
            buckets: [{ bucketId: 'g-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.66 }, resetTime: null }]
          }]
        }
      });
    }
  });
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} };
  };
  const baseAccounts = {
    activeId: 'acct-1',
    vaultSupported: false,
    vaultReason: 'Keyring unavailable in sandbox',
    lastAutoSwitchAtMs: 0,
    accounts: [
      { id: 'acct-1', email: 'alice@example.com', name: 'Alice', hasCredential: true },
      { id: 'acct-2', email: 'bob@example.com', name: 'Bob', hasCredential: true }
    ]
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req);
    if (req.method === 'dashboard' && stallFirstDashboard && !req.force) {
      stallFirstDashboard = false;
      pendingDashboard = () => p.context.__agyPowertoolsReceive(req.id, { requests: [{ id: 'stale-dash' }] });
      return;
    }
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, language: 'zh-CN' });
      } else if (req.method === 'accounts.list' || req.method === 'accounts.rename' || req.method === 'accounts.refreshLocalQuotas') {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, ...baseAccounts });
      } else if (req.method === 'accounts.syncActive') {
        if (failSyncActive) {
          p.context.__agyPowertoolsReceive(req.id, { error: 'syncActive timeout' });
        } else {
          p.context.__agyPowertoolsReceive(req.id, { ...baseAccounts });
        }
      } else if (req.method === 'dashboard') {
        p.context.__agyPowertoolsReceive(req.id, { requests: [{ id: req.force ? 'fresh-dash' : 'normal-dash' }] });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, estimates: [] });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(capturedEnv);
  assert.ok(pendingFirstQuota, 'Initial passive refreshAccount should be in-flight');

  // 1. Trigger forced refreshAccountQuotas('acct-1') while passive refresh is still pending
  const refreshPromise = capturedEnv.refreshAccountQuotas('acct-1');
  await refreshPromise;
  // Fresh forced value (0.42) applied; groups sanitized (missing buckets survived, disabled filtered, untouched 100% description:'' stripped)
  assert.equal(p.context.__agyPowertools.account.groups[1].buckets[0].remaining.value, 0.42);
  const lastSync = calls.filter(c => c.method === 'accounts.syncActive').at(-1);
  assert.equal(lastSync.snapshot.groups.length, 2);
  assert.deepEqual(lastSync.snapshot.groups[0].buckets, []);
  assert.equal(lastSync.snapshot.groups[1].buckets.length, 2);
  assert.equal(lastSync.snapshot.groups[1].buckets[1].resetTimeMs, null);
  // Active-target refresh MUST pass accountId: '' to accounts.refreshLocalQuotas so inactive windows update too
  const lastLocal = calls.filter(c => c.method === 'accounts.refreshLocalQuotas').at(-1);
  assert.equal(lastLocal.accountId, '');

  // Now resolve the stale first passive request with 0.99 -> MUST NOT overwrite 0.42!
  pendingFirstQuota({
    response: {
      groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.99 }, resetTime: null }] }]
    }
  });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(p.context.__agyPowertools.account.groups[1].buckets[0].remaining.value, 0.42);

  // 2. 'live-current' also resolves as active refresh and passes accountId: '' to refreshLocalQuotas
  await capturedEnv.refreshAccountQuotas('live-current');
  assert.equal(calls.filter(c => c.method === 'accounts.refreshLocalQuotas').at(-1).accountId, '');

  // 3. vaultReason is preserved across renameAccount and refreshAccountQuotas
  await capturedEnv.renameAccount('acct-1', 'Work');
  assert.equal(p.context.__agyPowertools.accounts.vaultReason, 'Keyring unavailable in sandbox');

  // 4. Failed retrieveUserQuotaSummary propagates error without locking out immediate retry, and syncActive error rejects refreshAccountQuotas
  quotaMode = 'fail-once';
  await assert.rejects(() => capturedEnv.refreshAccountQuotas('acct-1'), /network blip/);
  await capturedEnv.refreshAccountQuotas('acct-1');
  assert.equal(p.context.__agyPowertools.account.groups[0].buckets[0].remaining.value, 0.66);

  failSyncActive = true;
  await assert.rejects(() => capturedEnv.refreshAccountQuotas('acct-1'), /syncActive timeout/);
  failSyncActive = false;

  // 5. loadDashboard(true) while loadDashboard(false) is in-flight MUST NOT be swallowed, and stale dashboard(false) MUST NOT overwrite dashboard(true)
  const passiveDash = capturedEnv.loadDashboard(false);
  const forcedDash = capturedEnv.loadDashboard(true);
  await forcedDash;
  assert.equal(p.context.__agyPowertools.dashboard.requests[0].id, 'fresh-dash');
  pendingDashboard();
  await passiveDash;
  assert.equal(p.context.__agyPowertools.dashboard.requests[0].id, 'fresh-dash');
  assert.ok(quotaCalls.some(c => c.forceRefresh === true));

  p.context.__agyPowertools.dispose();
});

test('refresh loop triggers forced quota refresh when a conversation turn finishes', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-turn';
  const intervalCbs = [];
  p.context.setInterval = cb => { intervalCbs.push(cb); return intervalCbs.length; };
  let execState = { conversationId: 'conv-turn', status: 2 };
  const quotaCalls = [];
  let fakeNow = 1_795_600_000_000;
  p.context.Date = class extends Date {
    static now() { return fakeNow; }
  };
  p.context.__agyNativeAdapter.executionState = () => execState;
  p.context.__agyNativeAdapter.capabilities = () => ({ email: 'alice@example.com', name: 'Alice' });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: opts => {
      quotaCalls.push(opts || {});
      return Promise.resolve({ response: { groups: [] } });
    }
  });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { enabled: true });
      else if (req.method === 'state') p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-turn', turns: [], requests: [] });
      else p.context.__agyPowertoolsReceive(req.id, { ok: true });
    });
  };
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(quotaCalls.length, 1);
  assert.equal(Boolean(quotaCalls[0].forceRefresh), false);

  // Advance > 15s and finish the running turn -> triggers forced refresh
  fakeNow += 20_000;
  execState = { conversationId: 'conv-turn', status: 1, terminationReason: 0, notFullyIdle: false };
  intervalCbs[0]();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(quotaCalls.length, 2);
  assert.equal(quotaCalls[1].forceRefresh, true);

  // Advance 3 minutes while foreground visible -> periodic poll upgrades to forceRefresh: true
  fakeNow += 180_000;
  intervalCbs[0]();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(quotaCalls.length, 3);
  assert.equal(quotaCalls[2].forceRefresh, true);

  p.context.__agyPowertools.dispose();
});

test('userBubbleStrength updates CSS variables and readable foreground contrast, and worked-for merges split/sibling triggers without duplicates or middle dots', async () => {
  const p = page(true);
  const styleProps = new Map();
  p.document.documentElement.style = {
    setProperty: (k, v) => styleProps.set(k, v),
    removeProperty: k => styleProps.delete(k)
  };
  const renderedCompletions = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  p.context.HU = m => m?.index;
  p.context.ReactDOM = {
    createRoot: mount => ({
      render(el) {
        if (mount.dataset?.agyPowertoolsRoot === 'completion') renderedCompletions.push(el);
      },
      unmount() {}
    })
  };
  p.context.location.pathname = '/c/conv-worked';

  // Build a turn where native worked-for button lives in the enclosing turn scope (not inside agent-response)
  // and has split spans: "Worked for 8m 28s" + "<dot> 4 updates"
  const mainSpan = { isConnected: true, textContent: 'Worked for 8m 28s', contains: () => false };
  const updSpan = { isConnected: true, textContent: '\u00b7 4 updates', contains: () => false };
  const attrs = new Map();
  const workedBtn = {
    isConnected: true,
    get textContent() { return `${mainSpan.textContent} ${updSpan.textContent}`; },
    closest: () => null,
    querySelectorAll: sel => sel === 'span' ? [mainSpan, updSpan] : [],
    getAttribute: k => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: k => attrs.delete(k)
  };
  const response = {
    isConnected: true,
    firstChild: null,
    children: [],
    insertBefore(child) { child.isConnected = true; this.children.unshift(child); },
    closest: sel => sel === '[data-turn-content]' ? turnScopeEl : null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const turnScopeEl = {
    querySelector: () => null,
    querySelectorAll: sel => sel === 'button,[role="button"]' ? [workedBtn] : []
  };
  p.document.querySelectorAll = sel => sel === '[data-testid="agent-response"]' ? [response] : [];
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.onEditChange = () => () => {};
  p.context.__agyNativeAdapter.fiber = () => ({ memoizedProps: { container: { steps: [{ step: { case: 'userInput' }, metadata: { index: 0 } }] } }, return: null });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, {
          enabled: true, timing: true, userBubbleTint: true,
          userBubblePreset: 'custom', userBubbleColor: '#173E76', userBubbleStrength: 100, language: 'zh-CN'
        });
      } else if (req.method === 'state') {
        p.context.__agyPowertoolsReceive(req.id, {
          conversationId: 'conv-worked',
          turns: [{ turnNumber: 1, stepIndexStart: 0, stepIndexEnd: 5, status: 'complete', completedAtIso: '2026-11-24T00:00:00Z', durationMs: 508000, toolCalls: [] }],
          requests: []
        });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = {
    enabled: true, timing: true, userBubbleTint: true,
    userBubblePreset: 'custom', userBubbleColor: '#173E76', userBubbleStrength: 100, language: 'zh-CN'
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));

  // Verify Issue #27 solid tint + readable contrast foreground
  assert.equal(styleProps.get('--agy-bubble-tint'), '#173E76');
  assert.equal(styleProps.get('--agy-bubble-bg'), '100%');
  assert.equal(styleProps.get('--agy-bubble-border'), '100%');
  assert.equal(styleProps.get('--agy-bubble-fg'), '#ffffff');
  assert.equal(p.document.documentElement.hasAttribute('data-agy-bubble-fg'), true);

  // Verify Issue #29 in-place merge without duplicate row or middle dots
  assert.equal(mainSpan.textContent, '用时 8分28秒 4 条进度');
  assert.equal(mainSpan.textContent.includes('\u00b7'), false);
  assert.equal(updSpan.textContent, '');
  assert.equal(attrs.get('data-tooltip-id'), 'agy-completed-conv-worked-1');
  assert.ok(renderedCompletions.length >= 1);
  const findTooltipOnly = node => {
    if (!node || typeof node !== 'object') return undefined;
    if (node.props && 'tooltipOnly' in node.props) return node.props.tooltipOnly;
    for (const c of Array.isArray(node.children) ? node.children : [node.children]) {
      const hit = findTooltipOnly(c);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  assert.equal(findTooltipOnly(renderedCompletions.at(-1)), true);

  // Verify Issue #25 CSS prevents OverviewQuota wrapping
  const panelsSrc = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  assert.ok(panelsSrc.includes('grid-auto-columns:72px'));
  assert.ok(panelsSrc.includes('width:72px;height:21px;padding:0 6px;border-radius:6px;font-size:11px;white-space:nowrap'));

  // Dispose restores both split worked-for spans and clears bubble CSS vars
  p.context.__agyPowertools.dispose();
  assert.equal(mainSpan.textContent, 'Worked for 8m 28s');
  assert.equal(updSpan.textContent, '\u00b7 4 updates');
  assert.equal(attrs.has('data-tooltip-id'), false);
  assert.equal(styleProps.has('--agy-bubble-bg'), false);
  assert.equal(styleProps.has('--agy-bubble-fg'), false);
});

test('titlebarQuickPanel mounts left of titlebar-more-actions, falls back to overview/aux toggles, and unmounts when disabled', async () => {
  const makeTitlebarEnv = (selectors) => {
    const p = page(true);
    const mounts = [];
    let unmounted = 0;
    const parent = {
      children: [],
      insertBefore(node, before) {
        const idx = this.children.indexOf(node);
        if (idx >= 0) this.children.splice(idx, 1);
        node.isConnected = true;
        if (before && this.children.includes(before)) this.children.splice(this.children.indexOf(before), 0, node);
        else this.children.push(node);
        for (let i = 0; i < this.children.length; i++) this.children[i].nextSibling = this.children[i + 1] || null;
        mounts.push({ node, before });
      }
    };
    const anchors = {};
    for (const key of ['more', 'overview', 'aux']) {
      anchors[key] = { id: key, isConnected: true, parentElement: parent, nextSibling: null };
      if (selectors[key]) parent.children.push(anchors[key]);
    }
    for (let i = 0; i < parent.children.length; i++) parent.children[i].nextSibling = parent.children[i + 1] || null;
    p.context.ReactDOM = { createRoot() { return { render() {}, unmount() { unmounted++; } }; } };
    p.context.__agyNativeAdapter.installPage = () => true;
    let capturedEnv = null;
    p.context.__agyPanels = env => {
      capturedEnv = env;
      return { Page: () => null, Sidebar: () => null, QuickPopover: () => null, dispose() {} };
    };
    p.document.querySelector = sel => {
      if (sel === '[data-testid="titlebar-more-actions"]' && selectors.more) return anchors.more;
      if (sel === '[data-testid="toggle-overview-panel"]' && selectors.overview) return anchors.overview;
      if (sel === '[data-testid="toggle-aux-sidebar"]' && selectors.aux) return anchors.aux;
      return null;
    };
    return { p, mounts, anchors, parent, getUnmounted: () => unmounted, getEnv: () => capturedEnv };
  };

  const primary = makeTitlebarEnv({ more: true, overview: true, aux: true });
  let currentSettings = { enabled: true, titlebarQuickPanel: true };
  primary.p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        primary.p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else if (req.method === 'settings.get') {
        primary.p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else {
        primary.p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  primary.p.context.__agyInitialSettings = { enabled: true, titlebarQuickPanel: true };
  vm.runInContext(source, primary.p.context);
  assert.equal(primary.mounts.length, 1);
  assert.equal(primary.mounts[0].node.dataset.agyPowertoolsRoot, 'titlebar-quick');
  assert.equal(primary.mounts[0].before, primary.anchors.more);

  await primary.getEnv().change({ titlebarQuickPanel: false });
  assert.equal(primary.getUnmounted(), 1);
  primary.p.context.__agyPowertools.dispose();

  const fallback = makeTitlebarEnv({ more: false, overview: false, aux: true });
  fallback.p.context.__agyInitialSettings = { enabled: true, titlebarQuickPanel: true };
  vm.runInContext(source, fallback.p.context);
  assert.equal(fallback.mounts.length, 1);
  assert.equal(fallback.mounts[0].before, fallback.anchors.aux);
  fallback.p.context.__agyPowertools.dispose();
});

test('composerWorkingBeam cross-fades with ComposerQuotaHalo when active and stays idle/unmounted cleanly', async () => {
  const p = page(true);
  const renderedTrees = [];
  let unmounted = 0;
  const card = {
    children: [],
    isConnected: true,
    firstChild: null,
    getBoundingClientRect() { return { width: 640, height: 104 }; },
    insertBefore(node, before) {
      const idx = this.children.indexOf(node);
      if (idx >= 0) this.children.splice(idx, 1);
      node.isConnected = true;
      if (before && this.children.includes(before)) this.children.splice(this.children.indexOf(before), 0, node);
      else this.children.push(node);
      this.firstChild = this.children[0] || null;
      for (let i = 0; i < this.children.length; i++) this.children[i].nextSibling = this.children[i + 1] || null;
    }
  };
  const model = {
    isConnected: true,
    textContent: 'Gemini 4 Neon',
    parentElement: { children: [], insertBefore() {} },
    nextSibling: null,
    closest: sel => sel === '.surface-composer-card' ? card : null
  };
  p.context.getComputedStyle = el => el === card ? { borderRadius: '20px', display: 'flex' } : { display: 'flex', color: 'rgb(66, 133, 244)' };
  p.context.React.createElement = (type, props, ...children) => ({ type, props: props || {}, children });
  p.context.React.Fragment = 'fragment';
  p.context.React.useRef = init => ({ current: init });
  p.context.React.useId = () => ':r1:';
  p.context.React.useState = init => [typeof init === 'function' ? init() : init, () => {}];
  p.context.React.useEffect = fn => { fn(); };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(tree) {
          if (mount.dataset?.agyPowertoolsRoot === 'quota-halo') renderedTrees.push(tree);
        },
        unmount() { if (mount.dataset?.agyPowertoolsRoot === 'quota-halo') unmounted++; }
      };
    }
  };
  p.document.querySelectorAll = sel => sel === '[data-testid="model-selector-trigger"]' ? [model] : [];
  let execStatus = 1;
  p.context.__agyNativeAdapter.composerCascadeId = () => 'conv-beam-1';
  p.context.__agyNativeAdapter.executionState = cid => cid === 'conv-beam-1' ? { conversationId: cid, status: execStatus, notFullyIdle: false } : null;
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({
      response: { groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.72 }] }] }
    })
  });
  let currentSettings = { enabled: true, composerQuotaHalo: true, composerWorkingBeam: true, composerWorkingBeamPalette: 'aurora' };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else {
        p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  let capturedPanelsEnv = null;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = env => {
    capturedPanelsEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyInitialSettings = { ...currentSettings };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));

  const renderNode = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(renderNode);
    if (typeof node.type === 'function') {
      const states = [];
      let idx = 0;
      const prevState = p.context.React.useState;
      const prevEffect = p.context.React.useEffect;
      p.context.React.useState = init => {
        const i = idx++;
        if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
        return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
      };
      p.context.React.useEffect = fn => { fn(); };
      try {
        let out = node.type({ ...node.props, children: node.children });
        idx = 0;
        p.context.React.useEffect = () => {};
        out = node.type({ ...node.props, children: node.children });
        return renderNode(out);
      } finally {
        p.context.React.useState = prevState;
        p.context.React.useEffect = prevEffect;
      }
    }
    return { ...node, children: (Array.isArray(node.children) ? node.children : [node.children]).map(renderNode) };
  };
  const findById = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const x of node) { const r = findById(x, id); if (r) return r; } return null; }
    if (node.props?.['data-testid'] === id) return node;
    return findById(node.children, id);
  };

  assert.ok(renderedTrees.length >= 1);
  // 1. Idle state: quota halo full brightness (not dimmed), working beam inactive
  const idleTree = renderNode(renderedTrees.at(-1));
  const idleQuota = findById(idleTree, 'agy-composer-quota-halo');
  const idleBeam = findById(idleTree, 'agy-composer-working-beam');
  assert.ok(idleQuota);
  assert.equal(idleQuota.props['data-dimmed'], undefined);
  assert.ok(idleBeam);
  assert.equal(idleBeam.props['data-active'], 'false');
  assert.equal(idleBeam.props['data-palette'], 'aurora');

  // 2. Preview toggle forces beam active and completely hides quota halo even while idle
  assert.equal(source.includes('.agy-quota-halo-svg[data-dimmed=true]{opacity:0}'), true);
  capturedPanelsEnv.setBeamPreview(true);
  const previewTree = renderNode(renderedTrees.at(-1));
  assert.equal(findById(previewTree, 'agy-composer-quota-halo').props['data-dimmed'], 'true');
  assert.equal(findById(previewTree, 'agy-composer-working-beam').props['data-active'], 'true');
  capturedPanelsEnv.setBeamPreview(false);
  assert.equal(findById(renderNode(renderedTrees.at(-1)), 'agy-composer-working-beam').props['data-active'], 'false');

  // 3. Running state: Plan A cross-fade hides quota halo and activates beam
  execStatus = 2;
  const activeTree = renderNode(renderedTrees.at(-1));
  const activeQuota = findById(activeTree, 'agy-composer-quota-halo');
  const activeBeam = findById(activeTree, 'agy-composer-working-beam');
  assert.equal(activeQuota.props['data-dimmed'], 'true');
  assert.equal(activeBeam.props['data-active'], 'true');

  p.context.__agyPowertools.dispose();
  assert.ok(unmounted >= 1);
});

test('SSH command paste observes setting changes without reinstalling its listener', async () => {
  const p = page(true);
  const settings = { enabled: true };
  p.context.__agyInitialSettings = settings;
  let change, enabled, installs = 0;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = env => { change = env.change; return { Page: () => null, Sidebar: () => null, dispose() {} }; };
  p.context.installSshCommandPaste = (_document, options) => { enabled = options.enabled; installs++; };
  p.context.__agyPowertoolsHost = raw => {
    const { id, method, settings: patch } = JSON.parse(raw);
    if (method === 'settings.set') Object.assign(settings, patch);
    queueMicrotask(() => p.context.__agyPowertoolsReceive?.(id, { ...settings }));
  };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(enabled(), true);
  await change({ sshCommandPaste: false });
  assert.equal(enabled(), false);
  await change({ sshCommandPaste: true });
  assert.equal(enabled(), true);
  assert.equal(installs, 1);
  p.context.__agyPowertools.dispose();
});

test('sidebar folder drop observes setting changes, checks local Electron support, excludes SSH windows, and initializes global toast via sidebar', async () => {
  const p = page(true);
  const settings = { enabled: true };
  p.context.__agyInitialSettings = settings;
  let change, dropOpts, installs = 0;
  const createProjectCalls = [];
  p.context.electronNative = { getPathForFile: f => f?.mockPath || '' };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.createProjectsFromDroppedEntries = (entries, opts) => {
    createProjectCalls.push({ entries, opts });
    return { created: entries, existing: [], skippedFiles: 0, pinned: Boolean(opts?.pin) };
  };
  p.context.__agyPanels = env => { change = env.change; return { Page: () => null, Sidebar: () => null, dispose() {} }; };
  p.context.installSidebarFolderDrop = (_document, opts) => { dropOpts = opts; installs++; };
  p.context.__agyPowertoolsHost = raw => {
    const { id, method, settings: patch } = JSON.parse(raw);
    if (method === 'settings.set') Object.assign(settings, patch);
    queueMicrotask(() => p.context.__agyPowertoolsReceive?.(id, { ...settings }));
  };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(installs, 1);
  assert.equal(dropOpts.enabled(), true);
  assert.equal(dropOpts.pinProject(), false);
  assert.equal(dropOpts.isSupported(), true);
  assert.equal(dropOpts.getPathForFile({ mockPath: '/fixtures/team/app' }), '/fixtures/team/app');
  await change({ sidebarFolderDropPin: true });
  assert.equal(dropOpts.pinProject(), true);
  dropOpts.createProjects([{ path: '/fixtures/team/app' }], { pin: true });
  assert.deepEqual(createProjectCalls.at(-1)?.opts, { pin: true });
  const styleNode = p.nodes.find(n => 'agyDensityStyle' in (n.dataset || {}));
  assert.match(styleNode?.textContent || '', /@keyframes agy-project-drop-highlight/);
  assert.match(styleNode?.textContent || '', /\[data-agy-project-highlight="true"\]/);
  await change({ sidebarFolderDrop: false });
  assert.equal(dropOpts.enabled(), false);
  await change({ sidebarFolderDrop: true });
  assert.equal(dropOpts.enabled(), true);
  p.context.sshRemote = { kind: 'ssh' };
  assert.equal(dropOpts.isSupported(), false);
  p.context.sshRemote = { kind: 'local' };
  assert.equal(dropOpts.isSupported(), true);
  delete p.context.electronNative;
  assert.equal(dropOpts.isSupported(), false);
  p.context.__agyPowertools.dispose();

  // Verify SidebarEntry initializes global toast even without a mounted conversation composer
  const pToast = page(true);
  const toasts = [];
  const custLink = { isConnected: true, nextSibling: null, parentElement: { insertBefore(n) { n.isConnected = true; } } };
  pToast.document.querySelector = sel => sel === 'a[href="/customizations"]' ? custLink : null;
  pToast.context.electronNative = { getPathForFile: f => f?.mockPath || '' };
  pToast.context.React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useEffect: fn => { fn(); }
  };
  pToast.context.ReactDOM = {
    createRoot: () => ({
      render(tree) {
        if (typeof tree?.type === 'function') tree.type(tree.props || {});
      },
      unmount() {}
    })
  };
  pToast.context.um = () => payload => toasts.push(payload);
  let sidebarDropOpts;
  pToast.context.installSidebarFolderDrop = (_document, opts) => { sidebarDropOpts = opts; };
  pToast.context.__agyNativeAdapter.wrap = el => el;
  pToast.context.__agyNativeAdapter.installPage = () => true;
  pToast.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  pToast.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, pToast.context);
  sidebarDropOpts.notify({ title: 'Project created', message: 'demo' });
  assert.deepEqual(toasts, [{ title: 'Project created', message: 'demo' }]);
  pToast.context.__agyPowertools.dispose();
});

test('long-conversation mount skips redundant document style writes, skips unchanged root renders, and defers during IME/touch', async () => {
  const p = page(true);
  let styleWrites = 0;
  const styleProps = new Map();
  p.document.documentElement.style = {
    setProperty(k, v) { styleWrites++; styleProps.set(k, v); },
    removeProperty(k) { styleProps.delete(k); }
  };
  let renderCount = 0;
  const userActions = { children: [], isConnected: true, insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const userStep = { isConnected: true, querySelector: sel => sel === '[data-testid="user-message-actions"]' ? userActions : null };
  p.document.querySelectorAll = sel => sel === '[data-testid="user-input-step"]' ? [userStep] : [];
  p.context.location.pathname = '/c/conv-perf-1';
  p.context.ReactDOM = { createRoot() { return { render() { renderCount++; }, unmount() {} }; } };
  let observerCb = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  const timers = [];
  p.context.setTimeout = (fn, delay) => { const entry = { fn, delay, cleared: false }; timers.push(entry); return entry; };
  p.context.clearTimeout = entry => { if (entry) entry.cleared = true; };
  p.context.__agyInitialSettings = { enabled: true, userBubbleTint: true, userBubblePreset: 'ocean', userBubbleStrength: 40, messageEdit: true };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, p.context.__agyInitialSettings);
      else if (req.method === 'state') p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-perf-1', turns: [{ turnNumber: 1, status: 'complete' }], contextWindow: {} });
      else p.context.__agyPowertoolsReceive(req.id, {});
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const writesAfterBoot = styleWrites;
  const rendersAfterBoot = renderCount;
  assert.ok(writesAfterBoot > 0);
  assert.ok(rendersAfterBoot >= 1);

  // Mutations inside [contenteditable] or [data-markdown-root] should be ignored completely
  const timersBefore = timers.length;
  observerCb([{ target: { closest: sel => sel.includes('[contenteditable]') ? {} : null } }]);
  observerCb([{ target: { closest: sel => sel.includes('[data-markdown-root]') ? {} : null } }]);
  assert.equal(timers.length, timersBefore);

  // During active IME composition, non-ignored mutations defer mount until compositionend
  const compStart = p.callbacks.get('compositionstart')?.[0];
  const compEnd = p.callbacks.get('compositionend')?.[0];
  assert.ok(compStart && compEnd);
  compStart();
  observerCb([{ target: { closest: () => null } }]);
  assert.equal(timers.length, timersBefore);
  compEnd();
  assert.ok(timers.length > timersBefore);
  // Running the deferred mount should do ZERO redundant style writes and ZERO redundant MessageEdit renders
  const lastTimer = timers.at(-1);
  lastTimer.fn();
  assert.equal(styleWrites, writesAfterBoot);
  assert.equal(renderCount, rendersAfterBoot);
  p.context.__agyPowertools.dispose();
});

test('loadDashboard returns local dashboard immediately without blocking on slow remote quota RPC', async () => {
  const p = page(true);
  let capturedEnv = null;
  let resolveQuota = null;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: () => new Promise(resolve => { resolveQuota = resolve; })
  });
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyInitialSettings = { enabled: true };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'dashboard') {
        p.context.__agyPowertoolsReceive(req.id, { requests: [{ id: 'local-fast-1' }], errors: [] });
      } else {
        p.context.__agyPowertoolsReceive(req.id, req.method === 'settings.get' ? { enabled: true } : {});
      }
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  const data = await capturedEnv.loadDashboard(true);
  assert.equal(data.requests[0].id, 'local-fast-1');
  assert.equal(p.context.__agyPowertools.dashboard.requests[0].id, 'local-fast-1');
  resolveQuota?.({ response: { groups: [] } });
  p.context.__agyPowertools.dispose();
});

test('theme-adaptive delegated tooltip lazily mounts, adapts to light/dark CSS, clamps viewport, and cleans up on dispose', () => {
  const listeners = new Map();
  const timers = [];
  const created = [];
  const makeEl = tag => {
    const attrs = new Map();
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      dataset: {},
      style: {},
      children: [],
      isConnected: false,
      offsetWidth: 260,
      offsetHeight: 64,
      append(...items) { for (const c of items) { c.isConnected = true; this.children.push(c); } },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      removeAttribute(k) { attrs.delete(k); },
      getBoundingClientRect() { return { left: 0, top: 0, width: this.offsetWidth, height: this.offsetHeight }; },
      remove() { this.isConnected = false; }
    };
    return el;
  };
  const body = makeEl('body'); body.isConnected = true;
  const head = makeEl('head'); head.isConnected = true;
  const docAttrs = new Set();
  const doc = {
    readyState: 'complete',
    head,
    body,
    documentElement: {
      clientWidth: 1000,
      clientHeight: 700,
      toggleAttribute(name, force) { if (force === undefined ? !docAttrs.has(name) : force) docAttrs.add(name); else docAttrs.delete(name); },
      removeAttribute(name) { docAttrs.delete(name); },
      hasAttribute(name) { return docAttrs.has(name); }
    },
    createElement(tag) { const el = makeEl(tag); created.push(el); return el; },
    addEventListener(type, fn, opts) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
      opts?.signal?.addEventListener?.('abort', () => {
        const list = listeners.get(type) || [];
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }, { once: true });
    },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  const fire = (type, evt) => { for (const fn of [...(listeners.get(type) || [])]) fn(evt); };
  let nextTid = 1;
  const ctx = vm.createContext({
    document: doc,
    location: { pathname: '/' },
    innerWidth: 1000,
    innerHeight: 700,
    AbortController,
    React: { createElement() { return {}; } },
    ReactDOM: { createRoot() { throw new Error('No DOM roots expected'); } },
    HC() {},
    __agyNativeAdapter: { wrap() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: (fn, ms) => { const entry = { id: nextTid++, fn, ms, cleared: false }; timers.push(entry); return entry.id; },
    clearTimeout: id => { const found = timers.find(t => t.id === id); if (found) found.cleared = true; }
  });
  vm.runInContext(source, ctx);

  // Lazy creation: only densityStyle exists at boot, with both light and .dark rules
  assert.equal(created.length, 1);
  assert.match(created[0].textContent, /\.pt-tip-pop\{[^}]*background:var\(--card\)[^}]*color:var\(--foreground\)/);
  assert.match(created[0].textContent, /\.dark \.pt-tip-pop\{/);
  assert.match(created[0].textContent, /\.pt-tip-pop\[data-mono=true\]\{/);

  const makeHost = (attrsMap, rect) => {
    const attrs = new Map(Object.entries(attrsMap));
    const host = {
      isConnected: true,
      getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: k => attrs.delete(k),
      closest: sel => (sel === '[data-pt-tip]' ? host : null),
      getBoundingClientRect: () => rect
    };
    return host;
  };
  const trailNode = makeHost(
    { 'data-pt-tip': 'npm test && node scripts/build-release.mjs', 'data-pt-tip-mono': 'true', 'data-pt-tip-place': 'left' },
    { left: 760, right: 980, top: 320, bottom: 344, width: 220, height: 24 }
  );
  const cellNode = makeHost(
    { 'data-pt-tip': '2026-11-25: 1.2M', 'aria-describedby': 'existing-desc' },
    { left: 20, right: 32, top: 12, bottom: 24, width: 12, height: 12 }
  );

  // Cold hover waits for 180ms intent delay before creating/opening the portal
  fire('pointerover', { target: trailNode });
  assert.equal(created.length, 1);
  const tipTimer = timers.find(t => !t.cleared && t.ms === 180);
  assert.ok(tipTimer);
  tipTimer.fn();

  const pop = body.children.find(c => c.className === 'pt-tip-pop');
  assert.ok(pop);
  assert.equal(pop.dataset.open, 'true');
  assert.equal(pop.dataset.mono, 'true');
  assert.equal(pop.getAttribute('role'), 'tooltip');
  assert.equal(pop.children[0].textContent, 'npm test && node scripts/build-release.mjs');
  assert.equal(trailNode.getAttribute('aria-describedby'), 'agy-pt-tip-pop');
  // Left placement from x=760 with width=260 and gap=8 -> x=492, cleanly within [10, 730]
  assert.equal(pop.style.left, '492px');

  // Moving directly to another tooltip host transitions immediately without waiting, clears mono, clamps top->bottom, preserves existing aria-describedby
  fire('pointerout', { target: trailNode, relatedTarget: cellNode });
  assert.equal(trailNode.getAttribute('aria-describedby'), null);
  assert.equal(pop.dataset.open, 'true');
  assert.equal(pop.dataset.mono, undefined);
  assert.equal(pop.children[0].textContent, '2026-11-25: 1.2M');
  assert.equal(cellNode.getAttribute('aria-describedby'), 'existing-desc');
  assert.equal(pop.style.top, '32px');
  assert.equal(pop.style.left, '10px');

  // Escape and pointerdown hide immediately; dispose removes portal
  fire('keydown', { key: 'Escape' });
  assert.equal(pop.dataset.open, 'false');
  fire('focusin', { target: trailNode });
  assert.equal(pop.dataset.open, 'true');
  fire('pointerdown', { target: trailNode });
  assert.equal(pop.dataset.open, 'false');

  ctx.__agyPowertools.dispose();
  assert.equal(pop.isConnected, false);
});

test('native-panels and native-ui replace raw HTML/SVG title tooltips with theme-adaptive data-pt-tip attributes', () => {
  const panelsSrc = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  const uiSrc = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');
  assert.equal(panelsSrc.includes("h('title'"), false);
  assert.match(panelsSrc, /pt-trail-node'[^\n]*'data-pt-tip':call\.detail\|\|call\.label,'data-pt-tip-mono':call\.detail\?'true':undefined,'data-pt-tip-place':'left'/);
  assert.match(panelsSrc, /pt-donut-segment[^\n]*'data-pt-tip':segTip,'aria-label':segTip/);
  assert.match(uiSrc, /'data-testid': 'agy-subagent-badge',\s*'data-subagent-id': subId,\s*'data-pt-tip':/);
});


test('chat image right-click opens MediaContextMenu with attach, copy, and save actions while ignoring file icons', async () => {
  const listeners = new Map();
  let renderedTree = null;
  const attached = [];
  const makeEl = tag => ({
    tagName: String(tag || 'div').toUpperCase(),
    dataset: {},
    style: {},
    className: '',
    isConnected: true,
    children: [],
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    remove() { this.isConnected = false; },
    click() { this.clicked = true; },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => []
  });
  const doc = {
    readyState: 'complete',
    head: makeEl('head'),
    body: makeEl('body'),
    documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
    createElement: tag => makeEl(tag),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const wrapTag = tag => ({ children, ...p }) => h(tag, p, ...(Array.isArray(children) ? children : [children]));
  const ctx = vm.createContext({
    document: doc,
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800 },
    location: { pathname: '/c/conv-img', href: 'http://127.0.0.1/' },
    AbortController,
    Blob,
    File: class MockFile { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type || ''; this.size = 4; } },
    atob,
    btoa,
    TextEncoder,
    React: { createElement: h, Fragment: 'fragment', useState: v => [typeof v === 'function' ? v() : v, () => {}], useLayoutEffect: () => {}, useEffect: () => {} },
    ReactDOM: { createRoot: () => ({ render(tree) { renderedTree = tree; }, unmount() {} }) },
    HC: wrapTag('HC'), IC: wrapTag('IC'), JC: wrapTag('JC'), KC: wrapTag('KC'), GC: wrapTag('GC'), dq: wrapTag('dq'),
    __agyNativeAdapter: {
      wrap: el => el,
      attachFileToComposer: async info => { attached.push(info); return { ok: true }; },
      fileTreeEntry: () => null,
      executionState: () => null,
      capabilities: () => ({}),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyInitialSettings: { enabled: true, fileContextMenu: true },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
  });
  vm.runInContext(source, ctx);

  const fireContextMenu = target => {
    let prevented = false, stopped = false;
    for (const fn of listeners.get('contextmenu') || []) {
      fn({ target, clientX: 120, clientY: 160, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    }
    return { prevented, stopped };
  };

  // 1. File-type icon (/symbols-icons/...) must NOT trigger MediaContextMenu
  const iconImg = {
    getAttribute: k => (k === 'src' ? '/symbols-icons/icons/files/js.svg' : null),
    closest: sel => (sel.includes('file://') ? null : sel.includes('agent-response') ? {} : sel === 'img' ? iconImg : null)
  };
  assert.equal(fireContextMenu(iconImg).prevented, false);

  // 2. Real user-uploaded JPEG image (even with mislabeled data:image/png header) opens MediaContextMenu
  // Minimal JPEG magic bytes FF D8 FF E0 + 8 bytes -> base64 "/9j/4AAAAAAAAAAA"
  const chatImg = {
    alt: 'User uploaded media 1',
    getAttribute: k => (k === 'src' ? 'data:image/png;base64,/9j/4AAAAAAAAAAA' : null),
    closest: sel => {
      if (sel.includes('file://')) return null;
      if (sel.includes('user-input-step')) return { dataset: { testid: 'user-input-step' } };
      if (sel === 'img') return chatImg;
      return null;
    }
  };
  const res = fireContextMenu(chatImg);
  assert.equal(res.prevented, true);
  assert.equal(res.stopped, true);
  assert.ok(renderedTree);

  // Render MediaContextMenu node and trigger "引用到输入框"
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type({ ...(node.props || {}), children: node.children }));
    return { ...node, children: (node.children || []).map(expand) };
  };
  const findTestId = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (node.props?.['data-testid'] === id) return node;
    for (const c of Array.isArray(node.children) ? node.children : [node.children]) {
      const hit = findTestId(c, id);
      if (hit) return hit;
    }
    return null;
  };
  const menuTree = expand(renderedTree);
  assert.ok(findTestId(menuTree, 'agy-media-context-menu'));
  const attachBtn = findTestId(menuTree, 'agy-media-attach-chat');
  assert.ok(attachBtn);
  assert.ok(findTestId(menuTree, 'agy-media-copy-image'));
  assert.ok(findTestId(menuTree, 'agy-media-save-image'));
  await attachBtn.props.onClick();
  await new Promise(r => setImmediate(r));
  assert.equal(attached.length, 1);
  assert.equal(attached[0].mode, 'media');
  assert.equal(attached[0].mimeType, 'image/jpeg');
  assert.match(attached[0].name, /\.jpg$/);
  assert.equal(attached[0].base64, '/9j/4AAAAAAAAAAA');

  ctx.__agyPowertools.dispose();
});


test('response toolbar Copy button overrides clipboard with only the final response while preserving native check animation (Issue #50)', async () => {
  const listeners = new Map();
  const copiedValues = [];
  const makeEl = () => ({ dataset: {}, style: {}, className: '', isConnected: true, children: [], append() {}, appendChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
  const doc = {
    readyState: 'complete',
    head: makeEl(),
    body: makeEl(),
    documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
    createElement: () => makeEl(),
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const clipProto = { writeText: async text => { copiedValues.push(text); } };
  const clipboard = Object.create(clipProto);
  const ctx = vm.createContext({
    document: doc,
    window: { addEventListener() {}, removeEventListener() {} },
    navigator: { clipboard },
    location: { pathname: '/c/conv-copy' },
    AbortController,
    React: { createElement: () => null },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyNativeAdapter: {
      wrap: el => el,
      finalResponseText: () => ({ finalText: 'Final clean answer only.', hasIntermediate: true }),
      executionState: () => null,
      capabilities: () => ({}),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyInitialSettings: { enabled: true, stageUpdates: true },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
  });
  vm.runInContext(source, ctx);

  const copyBtn = { closest: sel => (sel.includes('cascade-system-message-toolbar') ? copyBtn : null) };
  for (const fn of listeners.get('click') || []) fn({ target: copyBtn });
  // Simulate native onClick writing full turn (intermediate updates + tool logs + final answer)
  await clipboard.writeText('Intermediate update...\nRan npm test\nFinal clean answer only.');
  assert.deepEqual(copiedValues, ['Final clean answer only.']);

  // Normal unrelated clipboard copies are untouched
  await clipboard.writeText('Normal copy text');
  assert.deepEqual(copiedValues, ['Final clean answer only.', 'Normal copy text']);

  ctx.__agyPowertools.dispose();
  assert.equal(Object.prototype.hasOwnProperty.call(clipboard, 'writeText'), false);
});


test('auto-switch waits for background running tabs and interactive banner supports target override, pause/resume, and immediate switch', async () => {
  let runningIds = ['bg-conv-1'];
  const switchedCalls = [];
  const intervals = [];
  const makeEl = tag => {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      dataset: {},
      style: {},
      className: '',
      textContent: '',
      value: '',
      children: [],
      listeners: new Map(),
      isConnected: true,
      append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); return item; },
      remove() { this.isConnected = false; },
      setAttribute() {},
      getAttribute() { return null; },
      removeAttribute() {},
      addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    return el;
  };
  const body = makeEl('body');
  const doc = {
    readyState: 'complete',
    head: makeEl('head'),
    body,
    documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
    createElement: tag => makeEl(tag),
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const candA = { id: 'acct-b', email: 'b@example.com', alias: '备用号B' };
  const candB = { id: 'acct-c', email: 'c@example.com', alias: '备用号C' };
  const ctx = vm.createContext({
    document: doc,
    window: { addEventListener() {}, removeEventListener() {} },
    location: { pathname: '/c/active-conv' },
    AbortController,
    React: { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: (_, g) => g() },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyInitialSettings: { enabled: true, multiAccount: true, autoSwitchAccount: true },
    __agyNativeAdapter: {
      wrap: el => el,
      executionState: () => ({ conversationId: 'active-conv', status: 1 }),
      runningConversationIds: () => runningIds,
      capabilities: () => ({ email: 'a@example.com', model: 'Claude Opus 5.5', models: [{ modelId: 'Claude Opus 5.5' }] }),
      service: () => ({
        retrieveUserQuotaSummary: async () => ({
          response: { groups: [{ displayName: 'Claude and GPT models', buckets: [{ bucketId: '3p-5h', remainingFraction: 0, resetTimeMs: Date.now() + 3600_000 }] }] }
        })
      }),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      if (msg.method === 'settings.get') ctx.__agyPowertoolsReceive(msg.id, { enabled: true, multiAccount: true, autoSwitchAccount: true });
      else if (msg.method === 'accounts.list' || msg.method === 'accounts.syncActive') {
        ctx.__agyPowertoolsReceive(msg.id, { activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'a@example.com' }, candA, candB] });
      } else if (msg.method === 'accounts.autoSwitchCandidate') {
        assert.equal(msg.activeModel, 'Claude Opus 5.5');
        ctx.__agyPowertoolsReceive(msg.id, { candidate: candA, candidates: [candA, candB], cooldownRemainingMs: 0 });
      } else if (msg.method === 'accounts.switch') {
        switchedCalls.push(msg);
        ctx.__agyPowertoolsReceive(msg.id, { ok: true, relaunching: true });
      } else {
        ctx.__agyPowertoolsReceive(msg.id, {});
      }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: (fn, ms) => { const item = { fn, ms, cleared: false }; intervals.push(item); return intervals.length; },
    clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  vm.runInContext(source, ctx);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  // 1. Background tab 'bg-conv-1' is running -> banner must NOT appear yet
  assert.equal(body.children.some(c => c.dataset?.testid === 'agy-autoswitch-banner'), false);

  // 2. Once background tab finishes, next poll opens interactive banner with target dropdown & buttons
  runningIds = [];
  const mainPoll = intervals.find(i => i.ms === 2000 && !i.cleared);
  assert.ok(mainPoll);
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const banner = body.children.find(c => c.dataset?.testid === 'agy-autoswitch-banner' && c.isConnected);
  assert.ok(banner, 'expected interactive autoswitch banner');

  const walk = (node, pred) => {
    if (!node) return null;
    if (pred(node)) return node;
    for (const c of node.children || []) { const hit = walk(c, pred); if (hit) return hit; }
    return null;
  };
  const select = walk(banner, n => n.dataset?.testid === 'agy-autoswitch-target-select');
  const menu = walk(banner, n => n.dataset?.testid === 'agy-autoswitch-target-menu');
  const optC = walk(banner, n => n.dataset?.testid === 'agy-autoswitch-target-option-acct-c');
  const pauseBtn = walk(banner, n => n.dataset?.testid === 'agy-autoswitch-pause');
  const nowBtn = walk(banner, n => n.dataset?.testid === 'agy-autoswitch-now');
  assert.ok(select && menu && optC && pauseBtn && nowBtn);
  assert.equal(select.tagName, 'BUTTON', 'auto-switch banner must use custom Antigravity dropdown rather than native <select>');
  assert.equal(walk(banner, n => n.tagName === 'SELECT'), null);

  // Open custom picker, select candB (acct-c), and pause countdown
  for (const fn of select.listeners.get('click') || []) fn({ stopPropagation() {} });
  for (const fn of optC.listeners.get('click') || []) fn({ stopPropagation() {} });
  for (const fn of pauseBtn.listeners.get('click') || []) fn();
  const countdownTick = intervals.find(i => i.ms === 1000 && !i.cleared);
  for (let i = 0; i < 10; i++) countdownTick.fn();
  assert.equal(switchedCalls.length, 0, 'paused countdown must not switch');

  // Click Switch Now while another background tab starts running -> defers while preserving depletedGroupKey ('claude')
  runningIds = ['bg-conv-2'];
  for (const fn of nowBtn.listeners.get('click') || []) fn();
  await new Promise(r => setImmediate(r));
  assert.equal(switchedCalls.length, 0);

  // Once background tab finishes, deferred resume re-queries candidates with preserved group key and lets us switch
  runningIds = [];
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const banner2 = body.children.find(c => c.dataset?.testid === 'agy-autoswitch-banner' && c.isConnected);
  assert.ok(banner2, 'deferred banner must reappear once background tasks finish');
  const optC2 = walk(banner2, n => n.dataset?.testid === 'agy-autoswitch-target-option-acct-c');
  const nowBtn2 = walk(banner2, n => n.dataset?.testid === 'agy-autoswitch-now');
  for (const fn of optC2.listeners.get('click') || []) fn({ stopPropagation() {} });
  for (const fn of nowBtn2.listeners.get('click') || []) fn();
  await new Promise(r => setImmediate(r));
  assert.equal(switchedCalls.length, 1);
  assert.equal(switchedCalls[0].accountId, 'acct-c');

  ctx.__agyPowertools.dispose();
});

test('native-ui auto-switch resets switchingInProgress when relaunching is false without manualRestartRequired and preserves depletedGroupKey on deferral', async () => {
  const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');
  const intervals = [];
  const candidateGroupKeys = [];
  const switchedCalls = [];
  let runningIds = [];
  let switchReply = { ok: true, unchanged: true, relaunching: false, manualRestartRequired: false };
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
  const candA = { id: 'acct-b', email: 'b@example.com', alias: '备用号B' };
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
    location: { pathname: '/c/active-conv' },
    AbortController,
    React: { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: (_, g) => g() },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyPanels: env => { capturedEnv = env; return { dispose() {} }; },
    __agyInitialSettings: { enabled: true, multiAccount: true, autoSwitchAccount: true },
    __agyNativeAdapter: {
      wrap: el => el,
      installPage: () => true,
      executionState: () => ({ conversationId: 'active-conv', status: 1 }),
      runningConversationIds: () => runningIds,
      capabilities: () => ({ email: 'a@example.com', model: 'Claude Opus 5.5', models: [{ modelId: 'Claude Opus 5.5' }] }),
      service: () => ({
        retrieveUserQuotaSummary: async () => ({
          response: { groups: [{ displayName: 'Claude and GPT models', buckets: [{ bucketId: '3p-5h', remainingFraction: 0, resetTimeMs: Date.now() + 3600_000 }] }] }
        })
      }),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      if (msg.method === 'settings.get') ctx.__agyPowertoolsReceive(msg.id, { enabled: true, multiAccount: true, autoSwitchAccount: true });
      else if (msg.method === 'accounts.list' || msg.method === 'accounts.syncActive') {
        ctx.__agyPowertoolsReceive(msg.id, { activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'a@example.com' }, candA] });
      } else if (msg.method === 'accounts.autoSwitchCandidate') {
        candidateGroupKeys.push(msg.depletedGroupKey);
        ctx.__agyPowertoolsReceive(msg.id, { candidate: candA, candidates: [candA], cooldownRemainingMs: 0 });
      } else if (msg.method === 'accounts.switch') {
        switchedCalls.push(msg);
        ctx.__agyPowertoolsReceive(msg.id, switchReply);
      } else if (msg.method === 'accounts.refreshLocalQuotas') {
        ctx.__agyPowertoolsReceive(msg.id, { ok: true, activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'a@example.com' }, candA] });
      } else {
        ctx.__agyPowertoolsReceive(msg.id, {});
      }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: (fn, ms) => { const item = { fn, ms, cleared: false }; intervals.push(item); return intervals.length; },
    clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  vm.runInContext(source, ctx);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.ok(capturedEnv);

  const walk = (node, pred) => {
    if (!node) return null;
    if (pred(node)) return node;
    for (const c of node.children || []) { const hit = walk(c, pred); if (hit) return hit; }
    return null;
  };
  const banner1 = body.children.find(c => c.dataset?.testid === 'agy-autoswitch-banner' && c.isConnected);
  assert.ok(banner1);
  assert.equal(candidateGroupKeys.at(-1), 'claude');

  // 1. Trigger Switch Now while runningIds becomes non-empty -> defers preserving 'claude'
  runningIds = ['bg-1'];
  const now1 = walk(banner1, n => n.dataset?.testid === 'agy-autoswitch-now');
  for (const fn of now1.listeners.get('click') || []) fn();
  await new Promise(r => setImmediate(r));
  assert.equal(switchedCalls.length, 0);

  // 2. Resume after background task ends -> must pass 'claude' (NOT '') to accounts.autoSwitchCandidate!
  runningIds = [];
  const mainPoll = intervals.find(i => i.ms === 2000 && !i.cleared);
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(candidateGroupKeys.at(-1), 'claude', 'deferred auto-switch must preserve depletedGroupKey');

  // 3. Switch returns unchanged / relaunching: false without manualRestartRequired -> MUST NOT wedge switchingInProgress!
  const banner2 = body.children.find(c => c.dataset?.testid === 'agy-autoswitch-banner' && c.isConnected);
  assert.ok(banner2);
  const now2 = walk(banner2, n => n.dataset?.testid === 'agy-autoswitch-now');
  for (const fn of now2.listeners.get('click') || []) fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(switchedCalls.length, 1);

  // Prove switchingInProgress was cleanly reset: refreshAccountQuotas succeeds instead of skipping!
  const postRefresh = await capturedEnv.refreshAccountQuotas();
  assert.equal(postRefresh.ok, true);
  assert.notEqual(postRefresh.skipped, true);
  ctx.__agyPowertools.dispose();
});

test('long-conversation polling skips ring re-renders, completed response fiber walks, and unchanged refresh mounts (Issue #51)', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-long-51';
  const intervals = [];
  let fakeNow = 1_795_700_000_000;
  p.context.Date = class extends Date { static now() { return fakeNow; } };
  p.context.setInterval = (fn, ms) => { const entry = { fn, ms }; intervals.push(entry); return intervals.length; };
  p.context.clearInterval = () => {};

  const footers = [];
  let footerEnabled = true, thinkingTokens = 1, turnStatus = 'complete';
  let ringRenders = 0;
  let fiberWalks = 0;
  const card = { isConnected: true, children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const flexParent = { isConnected: true, children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const model = {
    isConnected: true,
    textContent: 'Gemini 4 Carbon',
    parentElement: flexParent,
    nextSibling: null,
    closest: sel => sel === '.surface-composer-card' ? card : null
  };
  const actionRow = { isConnected: true, children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const copyBtn = { parentElement: actionRow, closest: () => null };
  const scopeEl = { querySelector: sel => sel === '[aria-label="Bad response"]' ? copyBtn : null, querySelectorAll: () => [] };
  const responseEl = {
    isConnected: true,
    firstChild: null,
    children: [],
    insertBefore(n) { n.isConnected = true; this.children.unshift(n); },
    closest: sel => sel === '[data-turn-content]' ? scopeEl : null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [model];
    if (sel === '[data-testid="agent-response"]') return [responseEl];
    return [];
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  p.context.HU = m => m?.index;
  p.context.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(tree) {
          if (mount.dataset?.agyPowertoolsRoot === 'turn-meta') footers.push(tree.type(tree.props).props['data-pt-tip']);
          if (mount.dataset?.agyPowertoolsRoot === 'ring') ringRenders++; },
        unmount() {}
      };
    }
  };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.composerCascadeId = () => 'conv-long-51';
  p.context.__agyNativeAdapter.fiber = () => {
    fiberWalks++;
    return { memoizedProps: { container: { steps: [{ step: { case: 'userInput' }, metadata: { index: 0 } }] } }, return: null };
  };

  let stateVersion = 1, turnCost = null;
  let stateRequests = 0;
  const makeStateReply = () => ({
    conversationId: 'conv-long-51',
    modelName: 'Gemini 4 Carbon',
    costUsd: 0.12,
    contextWindow: { usedTokens: 42000 * stateVersion, maxTokens: 1000000, usedPercent: 4.2 * stateVersion, inputTokens: 1000, cacheReadTokens: 41000, categories: [] },
    telemetry: { turnCount: 1, stepCount: 5, totalTokens: 45000 * stateVersion, requestCount: 2, errorCount: 0, toolCount: 1, tps: 88, latestTps: 88, cacheHitPercent: 97.6 },
    progress: { status: 'complete', phase: 'done', phaseDetail: '', toolCount: 1, recentActivity: [], tasks: [] },
    turns: [{ turnNumber: 1, stepIndexStart: 0, stepIndexEnd: 4, status: turnStatus, costUsd: turnCost, thinkingTokens, shortModel: 'Fixture', completedAtIso: '2026-11-25T00:00:00Z', durationMs: 4200, toolCalls: [] }],
    requests: [{ id: 'req-1', timestampMs: 1_795_699_995_000 }],
    errors: [],
    settings: { turnMeta: footerEnabled, enabled: true, contextRing: true, speedStats: true, timing: true, responseBranch: true, language: 'zh-CN' }
  });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { enabled: true, contextRing: true, speedStats: true, timing: true, responseBranch: true, language: 'zh-CN' });
      else if (req.method === 'state') { stateRequests++; p.context.__agyPowertoolsReceive(req.id, makeStateReply()); }
      else p.context.__agyPowertoolsReceive(req.id, { ok: true });
    });
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true, speedStats: true, timing: true, responseBranch: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 25));

  const initialRingRenders = ringRenders;
  const initialFiberWalks = fiberWalks;
  const initialStateReqs = stateRequests;
  assert.ok(initialRingRenders >= 1);
  assert.equal(initialFiberWalks, 1);

  const mainPoll = intervals.find(i => i.ms === 2000);
  assert.ok(mainPoll);

  // Idle poll within 6s skips state IPC completely
  fakeNow += 2000;
  mainPoll.fn();
  await new Promise(r => setTimeout(r, 15));
  assert.equal(stateRequests, initialStateReqs);

  // Idle poll after 6s fetches a brand-new JSON object with identical values -> 0 new ring renders and 0 new fiber walks
  fakeNow += 7000;
  mainPoll.fn();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(stateRequests, initialStateReqs + 1);
  assert.equal(ringRenders, initialRingRenders);
  assert.equal(fiberWalks, initialFiberWalks);

  // When token usage actually changes, ring re-renders once while completed historical turn still skips fiber walk!
  stateVersion = 2;
  fakeNow += 7000;
  mainPoll.fn();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(ringRenders, initialRingRenders + 1);
  assert.equal(fiberWalks, initialFiberWalks);

  const poll = async () => {
    fakeNow += 7000;
    mainPoll.fn();
    await new Promise(r => setTimeout(r, 20));
  };
  const footerMount = () => actionRow.children.filter(n => n.isConnected && n.dataset.agyPowertoolsRoot === 'turn-meta');
  turnCost = 0.0035;
  await poll();
  assert.match(footers.at(-1), /费用: \$0\.0035/);
  thinkingTokens = 17;
  await poll();
  assert.match(footers.at(-1), /17/);
  footerEnabled = false;
  await poll();
  assert.equal(footerMount().length, 0);
  turnStatus = 'running'; footerEnabled = true;
  await poll();
  assert.equal(footerMount().length, 0);
  turnStatus = 'complete';
  await poll();
  assert.equal(footerMount().length, 1);
  p.context.__agyPowertools.dispose();
});

test('SSH remote window hides local AccountSwitcher, preserves native settings button, and skips accounts.syncActive (Issue #57)', async () => {
  const p = page(true);
  p.context.sshRemote = { kind: 'ssh', host: 'devbox' };
  const calls = [];
  let mountedSwitcher = 0;
  const settingsParent = { children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const settingsBtn = { isConnected: true, parentElement: settingsParent, nextSibling: null };
  p.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? settingsBtn : null;
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render() { if (mount.dataset?.agyPowertoolsRoot === 'account-switcher') mountedSwitcher++; },
        unmount() {}
      };
    }
  };
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} });
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({ email: 'remote@example.com', name: 'Remote User' });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({ response: { groups: [] } })
  });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req.method);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, accountSwitcher: true });
      else p.context.__agyPowertoolsReceive(req.id, { ok: true, estimates: [] });
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, accountSwitcher: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 25));

  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
  assert.equal(mountedSwitcher, 0);
  assert.equal(calls.includes('accounts.syncActive'), false);
  assert.equal(calls.includes('accounts.list'), false);
  p.context.__agyPowertools.dispose();
});

test('auto-check update banner shows one-click update/dismiss and optional autoInstallUpdates waits for idle same-major only (Issue #45)', async () => {
  const timeouts = [];
  const calls = [];
  let runningIds = ['busy-conv-1'];
  let remoteReply = {
    status: 'available',
    version: '2.17.0',
    releaseUrl: 'https://github.com/WhiteBr1ck/agy-powertools/releases/tag/v2.17.0',
    notes: '## 中文说明\n- **体验优化**：新增低频自动查更新与轻量提醒',
    canInstall: true,
    dismissedVersion: '',
    clientUpgraded: false
  };
  const makeEl = tag => {
    const el = {
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
      setAttribute() {},
      getAttribute: () => null,
      removeAttribute() {},
      addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    return el;
  };
  const body = makeEl('body');
  const intervals = [];
  const settings = { enabled: true, autoCheckUpdates: true, autoInstallUpdates: false, language: 'zh-CN' };
  let capturedEnv = null;
  const ctx = vm.createContext({
    document: {
      readyState: 'complete',
      head: makeEl('head'),
      body,
      documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
      createElement: tag => makeEl(tag),
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: { addEventListener() {}, removeEventListener() {} },
    navigator: { userAgent: 'Antigravity/2.36.0' },
    location: { pathname: '/c/conv-upd' },
    AbortController,
    React: { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: (_, g) => g() },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyPanels: env => { capturedEnv = env; return { dispose() {} }; },
    __agyInitialSettings: { ...settings },
    __agyNativeAdapter: {
      wrap: el => el,
      installPage: () => true,
      executionState: () => ({ conversationId: 'conv-upd', status: 1 }),
      runningConversationIds: () => runningIds,
      capabilities: () => ({}),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      calls.push(msg);
      if (msg.method === 'settings.get') ctx.__agyPowertoolsReceive(msg.id, { ...settings });
      else if (msg.method === 'settings.set') { Object.assign(settings, msg.settings); ctx.__agyPowertoolsReceive(msg.id, { ...settings }); }
      else if (msg.method === 'update.autoCheck') ctx.__agyPowertoolsReceive(msg.id, { ...remoteReply });
      else if (msg.method === 'update.dismiss') { remoteReply.dismissedVersion = msg.version; ctx.__agyPowertoolsReceive(msg.id, { ...remoteReply }); }
      else if (msg.method === 'update.install') ctx.__agyPowertoolsReceive(msg.id, { status: 'preparing', version: msg.version });
      else if (msg.method === 'update.status') ctx.__agyPowertoolsReceive(msg.id, { status: 'completed', version: '2.17.0' });
      else ctx.__agyPowertoolsReceive(msg.id, {});
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: (fn, ms) => { const item = { fn, ms, cleared: false }; intervals.push(item); return intervals.length; },
    clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    setTimeout: (fn, ms) => { const item = { fn, ms, cleared: false }; timeouts.push(item); return timeouts.length; },
    clearTimeout: id => { if (timeouts[id - 1]) timeouts[id - 1].cleared = true; }
  });
  vm.runInContext(source, ctx);
  await new Promise(r => setImmediate(r));

  // Trigger startup 15s update check timer
  const startupCheck = timeouts.find(t => t.ms === 15000 && !t.cleared);
  assert.ok(startupCheck);
  startupCheck.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  const autoReq = calls.find(c => c.method === 'update.autoCheck');
  assert.ok(autoReq);
  assert.equal(autoReq.clientVersion, '2.36.0');
  const banner = body.children.find(c => c.dataset?.testid === 'agy-update-prompt-banner' && c.isConnected);
  assert.ok(banner, 'expected bottom-right update reminder banner');
  const walk = (node, pred) => {
    if (!node) return null;
    if (pred(node)) return node;
    for (const c of node.children || []) { const hit = walk(c, pred); if (hit) return hit; }
    return null;
  };
  assert.ok(walk(banner, n => n.dataset?.testid === 'agy-update-banner-install'));
  const dismissBtn = walk(banner, n => n.dataset?.testid === 'agy-update-banner-dismiss');
  assert.ok(dismissBtn);

  // Clicking dismiss persists update.dismiss and removes banner
  for (const fn of dismissBtn.listeners.get('click') || []) fn();
  await new Promise(r => setImmediate(r));
  assert.equal(calls.some(c => c.method === 'update.dismiss' && c.version === '2.17.0'), true);
  assert.equal(banner.isConnected, false);

  // New version arrives + autoInstallUpdates enabled -> waits while runningIds non-empty, then auto-installs once idle
  remoteReply = { ...remoteReply, version: '2.18.0', dismissedVersion: '' };
  await capturedEnv.change({ autoInstallUpdates: true });
  await capturedEnv.checkForUpdateNotice({ force: true });
  assert.equal(calls.some(c => c.method === 'update.install'), false, 'must wait while a turn is running');

  runningIds = [];
  const mainPoll = intervals.find(i => i.ms === 2000 && !i.cleared);
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(calls.some(c => c.method === 'update.install' && c.version === '2.18.0'), true);

  ctx.__agyPowertools.dispose();
});

test('native-ui retries applyOptions after transient boot failure and re-applies adapter options on remote settingsChanged (Issue #66)', async () => {
  const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');
  const intervals = [];
  let failSetEnabledCount = 3; // Fail initial boot applyOptions + mount() refresh + queued startup refresh
  const applied = { enabled: null, stageUpdates: null, efficientIO: null, contextLimit: null, sidebarProjectLimit: null };
  let remoteSettings = { enabled: true, stageUpdates: true, efficientIO: false, contextLimit: 500000, sidebarProjectLimit: 5 };
  let settingsGetCount = 0;

  const ctx = vm.createContext({
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      title: 'Antigravity (SSH: remote-box)',
      head: { append() {}, appendChild() {}, querySelector: () => null },
      body: { append() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [] },
      documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
      createElement: () => ({ dataset: {}, style: {}, remove() {} }),
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: { addEventListener() {}, removeEventListener() {} },
    navigator: { userAgent: 'Antigravity/2.35.2' },
    location: { pathname: '/c/conv-ssh-66' },
    AbortController,
    React: { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: (_, g) => g() },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyInitialSettings: { ...remoteSettings },
    __agyNativeAdapter: {
      wrap: el => el,
      installPage: () => true,
      executionState: () => ({ conversationId: 'conv-ssh-66', status: 2 }),
      runningConversationIds: () => ['conv-ssh-66'],
      capabilities: () => ({}),
      setEnabled(v) {
        if (failSetEnabledCount > 0) { failSetEnabledCount--; throw new Error('Antigravity conversation service is unavailable'); }
        applied.enabled = v;
      },
      setStageUpdates(v) { applied.stageUpdates = v; },
      setEfficientIO(v) { applied.efficientIO = v; },
      setContextLimit(v) { applied.contextLimit = v; },
      setSidebarProjectLimit(v) { applied.sidebarProjectLimit = v; },
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      if (msg.method === 'settings.get') {
        settingsGetCount++;
        ctx.__agyPowertoolsReceive(msg.id, { ...remoteSettings });
      } else if (msg.method === 'state') {
        ctx.__agyPowertoolsReceive(msg.id, {
          conversationId: 'conv-ssh-66',
          turns: [],
          requests: [],
          errors: [],
          contextWindow: {},
          telemetry: {},
          progress: {},
          settings: { ...remoteSettings }
        });
      } else {
        ctx.__agyPowertoolsReceive(msg.id, {});
      }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: (fn, ms) => { const item = { fn, ms, cleared: false }; intervals.push(item); return intervals.length; },
    clearInterval: id => { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    setTimeout: () => 1,
    clearTimeout() {}
  });

  vm.runInContext(source, ctx);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  // Initial sync applyOptions and startup refresh attempts all threw -> settingsLoaded must remain false so next poll retries.
  assert.ok(settingsGetCount >= 1);
  assert.equal(applied.stageUpdates, null);

  const beforeRetryCount = settingsGetCount;
  const mainPoll = intervals.find(i => i.ms === 2000 && !i.cleared);
  assert.ok(mainPoll);
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  assert.equal(settingsGetCount, beforeRetryCount + 1);
  assert.equal(applied.enabled, true);
  assert.equal(applied.stageUpdates, true);
  assert.equal(applied.efficientIO, false);
  assert.equal(applied.contextLimit, 500000);
  assert.equal(applied.sidebarProjectLimit, 5);

  // Simulate another window updating settings; state poll returns updated settings and must re-apply adapter options.
  remoteSettings = { enabled: true, stageUpdates: false, efficientIO: true, contextLimit: 1000000, sidebarProjectLimit: 3 };
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  assert.equal(applied.stageUpdates, false);
  assert.equal(applied.efficientIO, true);
  assert.equal(applied.contextLimit, 1000000);
  assert.equal(applied.sidebarProjectLimit, 3);

  ctx.__agyPowertools.dispose();
});

test('management Page keeps header and tabs sticky on scroll, toggles scrolled border, and resets scroll on tab switch', () => {
  const panelsCode = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  const styles = [];
  const states = [];
  const refs = [];
  const effects = [];
  const resizeObservers = [];
  let stateIdx = 0;
  let refIdx = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useId: () => 'id-1',
    useState: init => {
      const i = stateIdx++;
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
      return [states[i], val => { states[i] = typeof val === 'function' ? val(states[i]) : val; }];
    },
    useRef: init => {
      const i = refIdx++;
      if (!(i in refs)) refs[i] = { current: init };
      return refs[i];
    },
    useEffect: (fn, deps) => { effects.push({ fn, deps }); },
    useSyncExternalStore: (_, getSnap) => getSnap()
  };
  const wrapTag = name => ({ children, ...p }) => React.createElement(name, p, ...(Array.isArray(children) ? children : [children]));
  let wrapHeight = 66.4;
  const ctx = vm.createContext({
    React,
    Intl,
    URL,
    ResizeObserver: class MockResizeObserver {
      constructor(cb) {
        this.cb = cb;
        this.observed = [];
        this.disconnected = false;
        resizeObservers.push(this);
      }
      observe(el) { this.observed.push(el); }
      disconnect() { this.disconnected = true; }
      trigger() { this.cb([{ target: this.observed[0] }], this); }
    },
    document: {
      createElement: tag => ({ tagName: tag, dataset: {}, textContent: '', remove() {} }),
      head: { append: node => styles.push(node) }
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    __agyDashboard: {
      dateRange: () => ({ preset: 'weeklyQuota', start: 0, end: 1, activePools: [], status: 'unstarted' }),
      summarizeRequests: () => ({ requests: [], success: 0, errors: 0, tokens: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, cost: 0, priced: 0, points: [], models: [] }),
      distributionModels: () => [],
      subscriptionIdentity: () => ({ family: 'pro', style: 'pro', label: 'Pro' }),
      annotateCacheAnomalies: () => new Map()
    },
    setInterval: () => 1,
    clearInterval: () => {},
    Uy: 'button',
    Sy: 'tooltip',
    dq: ({ name }) => ({ type: 'icon', props: { name }, children: [] }),
    kT: wrapTag('kT'),
    lT: wrapTag('lT'),
    mT: wrapTag('mT'),
    nT: wrapTag('nT'),
    HC: wrapTag('HC'),
    IC: wrapTag('IC'),
    JC: wrapTag('JC'),
    VP: wrapTag('VP'),
    TP: wrapTag('TP'),
    UP: wrapTag('UP'),
    XP: wrapTag('XP')
  });
  vm.runInContext(panelsCode, ctx);
  let mockDashboard = null;
  const panels = ctx.__agyPanels({
    t: v => v,
    options: () => ({ enabled: true, titlebarQuickPanel: true, language: 'zh-CN', multiAccount: false }),
    dashboard: () => mockDashboard,
    loadDashboard: () => Promise.resolve(null),
    subscribe: () => () => {},
    revision: () => 0,
    consumeRequestedTab: () => '',
    state: () => null,
    capabilities: () => ({ models: [] })
  });

  assert.equal(styles.length, 1);
  const css = styles[0].textContent;
  assert.match(css, /\.pt-header-wrap\{[^}]*position:sticky;top:0;z-index:20;/);
  assert.match(css, /\.pt-header-wrap\[data-scrolled\]\{border-bottom-color:var\(--border\)\}/);
  assert.match(css, /\.pt-page\[data-sticky-filter=true\] \.pt-header-wrap\[data-scrolled\]\{border-bottom-color:transparent\}/);
  assert.match(css, /\.pt-page \.pt-filter-bar\{[^}]*position:sticky;top:calc\(var\(--pt-header-h,66px\) - 1px\);z-index:19;[^}]*backdrop-filter:blur\(8px\);/);
  assert.match(css, /\.pt-page\[data-sticky-filter=true\]\[data-scrolled\] \.pt-filter-bar\{border-bottom-color:var\(--border\)\}/);
  assert.doesNotMatch(css, /\[data-scrolled=true\]/);
  assert.match(css, /\.pt-page\{[^}]*scroll-padding-top:76px;/);
  assert.match(css, /\.pt-page\[data-sticky-filter=true\]\{scroll-padding-top:calc\(var\(--pt-header-h,66px\) \+ 64px\)\}/);
  assert.doesNotMatch(css, /\.pt-qp[^{]*\.pt-filter-bar/);

  stateIdx = 0;
  refIdx = 0;
  effects.length = 0;
  const tree = panels.Page();
  assert.equal(tree.props['data-testid'], 'agy-management-page');
  assert.equal(tree.props.className, 'pt-page');
  assert.equal(tree.props['data-sticky-filter'], 'true');
  const [headerWrap, content] = tree.children;
  assert.equal(headerWrap.props['data-testid'], 'agy-management-header');
  assert.equal(headerWrap.props.className, 'pt-header-wrap');
  assert.equal(content.props.className, 'pt-content');

  const pageListeners = new Map();
  const pageAttrs = new Map();
  const cssVars = new Map();
  const pageEl = {
    scrollTop: 0,
    style: {
      setProperty: (k, v) => cssVars.set(k, v),
      getPropertyValue: k => cssVars.get(k) || ''
    },
    toggleAttribute: (name, force) => {
      if (force === undefined ? !pageAttrs.has(name) : force) pageAttrs.set(name, '');
      else pageAttrs.delete(name);
    },
    hasAttribute: name => pageAttrs.has(name),
    getAttribute: name => pageAttrs.has(name) ? pageAttrs.get(name) : null,
    addEventListener: (type, fn) => {
      if (!pageListeners.has(type)) pageListeners.set(type, []);
      pageListeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      const list = pageListeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    }
  };
  const wrapAttrs = new Map();
  const headerWrapEl = {
    getBoundingClientRect: () => ({ height: wrapHeight }),
    toggleAttribute: (name, force) => {
      if (force === undefined ? !wrapAttrs.has(name) : force) wrapAttrs.set(name, '');
      else wrapAttrs.delete(name);
    },
    hasAttribute: name => wrapAttrs.has(name),
    getAttribute: name => wrapAttrs.has(name) ? wrapAttrs.get(name) : null
  };
  tree.props.ref.current = pageEl;
  headerWrap.props.ref.current = headerWrapEl;

  const cleanups = effects.map(e => e.fn()).filter(fn => typeof fn === 'function');
  assert.equal(pageListeners.get('scroll')?.length, 1);
  assert.equal(resizeObservers.length, 1);
  assert.deepEqual(resizeObservers[0].observed, [headerWrapEl]);
  assert.equal(cssVars.get('--pt-header-h'), '66px');
  assert.equal(pageEl.hasAttribute('data-scrolled'), false);
  assert.equal(headerWrapEl.hasAttribute('data-scrolled'), false);

  // ResizeObserver updates --pt-header-h when header wraps at narrow widths
  wrapHeight = 104.2;
  resizeObservers[0].trigger();
  assert.equal(cssVars.get('--pt-header-h'), '104px');

  pageEl.scrollTop = 48;
  for (const fn of pageListeners.get('scroll')) fn();
  assert.equal(pageEl.hasAttribute('data-scrolled'), true);
  assert.equal(pageEl.getAttribute('data-scrolled'), '');
  assert.equal(headerWrapEl.hasAttribute('data-scrolled'), true);
  assert.equal(headerWrapEl.getAttribute('data-scrolled'), '');

  pageEl.scrollTop = 2;
  for (const fn of pageListeners.get('scroll')) fn();
  assert.equal(pageEl.hasAttribute('data-scrolled'), false);
  assert.equal(headerWrapEl.hasAttribute('data-scrolled'), false);

  // Switching tabs resets scrollTop and clears data-scrolled on both page and headerWrap
  pageEl.scrollTop = 120;
  for (const fn of pageListeners.get('scroll')) fn();
  assert.equal(pageEl.hasAttribute('data-scrolled'), true);
  assert.equal(headerWrapEl.hasAttribute('data-scrolled'), true);
  const headerNode = headerWrap.children[0];
  const toolbarNode = headerNode.children[1];
  const tabsComp = toolbarNode.children[0];
  const tabsTree = tabsComp.type(tabsComp.props);
  const requestsBtn = tabsTree.children.find(c => c.props?.['data-testid'] === 'agy-tab-requests');
  assert.ok(requestsBtn);
  requestsBtn.props.onClick();
  assert.equal(states[0], 'requests');
  assert.equal(pageEl.scrollTop, 0);
  assert.equal(pageEl.hasAttribute('data-scrolled'), false);
  assert.equal(headerWrapEl.hasAttribute('data-scrolled'), false);

  // Switching to settings clears data-sticky-filter; overview/requests/errors keep it and render .pt-filter-bar
  mockDashboard = { requests: [], errors: [], activeAccountEmail: '' };
  const findByTestId = (node, tid) => {
    if (!node || typeof node !== 'object') return null;
    if (node.props?.['data-testid'] === tid) return node;
    for (const child of Array.isArray(node.children) ? node.children : [node.children]) {
      const hit = findByTestId(child, tid);
      if (hit) return hit;
    }
    return null;
  };
  const renderTab = tabName => {
    states[0] = tabName;
    stateIdx = 0;
    refIdx = 0;
    return panels.Page();
  };
  const reqPage = renderTab('requests');
  assert.equal(reqPage.props['data-sticky-filter'], 'true');
  const reqComp = reqPage.children[1].children[1].children[0];
  stateIdx = 10;
  const reqTree = reqComp.type(reqComp.props);
  assert.match(findByTestId(reqTree, 'agy-requests-filter-bar')?.props?.className || '', /\bpt-filter-bar\b/);

  const errPage = renderTab('errors');
  assert.equal(errPage.props['data-sticky-filter'], 'true');
  const errComp = errPage.children[1].children[1].children[0];
  stateIdx = 20;
  const errTree = errComp.type(errComp.props);
  assert.match(findByTestId(errTree, 'agy-errors-filter-bar')?.props?.className || '', /\bpt-filter-bar\b/);

  const ovPage = renderTab('overview');
  assert.equal(ovPage.props['data-sticky-filter'], 'true');
  const ovComp = ovPage.children[1].children[1].children[0];
  stateIdx = 30;
  const ovTree = ovComp.type(ovComp.props);
  assert.match(findByTestId(ovTree, 'agy-overview-filter-bar')?.props?.className || '', /\bpt-filter-bar\b/);

  const settingsPage = renderTab('settings');
  assert.equal(settingsPage.props['data-sticky-filter'], undefined);

  // QuickPopover uses .pt-qp / .pt-qp-scroll rather than .pt-page, keeping sticky filter bars scoped to .pt-page only
  stateIdx = 50;
  refIdx = 50;
  let qpTree = panels.QuickPopover();
  qpTree.children[0].props.onOpenChange(true);
  stateIdx = 50;
  refIdx = 50;
  qpTree = panels.QuickPopover();
  const qpCard = qpTree.children[0].children[1].children[0];
  assert.equal(qpCard.props.className, 'pt-qp');
  assert.equal(qpCard.props['data-sticky-filter'], undefined);
  assert.equal(qpCard.children[1].props['data-testid'], 'agy-quick-body');
  assert.equal(qpCard.children[1].props.className, 'pt-qp-scroll');
  assert.equal(findByTestId(qpTree, 'agy-management-page'), null);

  for (const cleanup of cleanups) cleanup();
  assert.equal(pageListeners.get('scroll')?.length, 0);
  assert.equal(resizeObservers[0].disconnected, true);
  panels.dispose();
});

test('state polling passes knownRev and short-circuits unchanged replies, conversation switch avoids .pt-outline flash, and running turn cancels stranded inline edit (Issues #62, #74, #70)', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-a';
  const intervals = [];
  const timeouts = [];
  let fakeNow = 1_795_900_000_000;
  p.context.Date = class extends Date { static now() { return fakeNow; } };
  p.context.setInterval = (fn, ms) => { const entry = { fn, ms, cleared: false }; intervals.push(entry); return intervals.length; };
  p.context.clearInterval = id => { if (intervals[id - 1]) intervals[id - 1].cleared = true; };
  p.context.setTimeout = (fn, ms) => { const entry = { fn, ms, cleared: false }; timeouts.push(entry); return timeouts.length; };
  p.context.clearTimeout = id => { if (timeouts[id - 1]) timeouts[id - 1].cleared = true; };

  let outlineRenders = 0;
  let hasNativeNav = false;
  const overviewEl = { isConnected: true, children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const viewEl = {
    isConnected: true,
    children: [],
    insertBefore(n) { n.isConnected = true; this.children.push(n); },
    querySelector: sel => (sel === '[data-testid="conversation-navigator"]' && hasNativeNav ? { isConnected: true } : null)
  };
  p.document.querySelector = sel => {
    if (sel === '[data-testid="overview-panel"]') return overviewEl;
    if (sel === '[data-testid="conversation-view"]') return viewEl;
    return null;
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render() { if (mount.dataset?.agyPowertoolsRoot === 'outline') outlineRenders++; },
        unmount() {}
      };
    }
  };
  let capturedEnv = null;
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, Outline: () => null, Progress: () => null, dispose() {} };
  };
  p.context.__agyNativeAdapter.installPage = () => true;

  let execState = { conversationId: 'conv-a', status: 1 };
  const cancelEditOpts = [];
  let pendingEditObj = { cascadeId: 'conv-a', submitting: false };
  Object.defineProperty(p.context.__agyNativeAdapter, 'pendingEdit', { get: () => pendingEditObj, configurable: true });
  p.context.__agyNativeAdapter.cancelEdit = opts => { cancelEditOpts.push(opts); pendingEditObj = null; };
  p.context.__agyNativeAdapter.executionState = () => execState;

  const stateReqs = [];
  const resetReqs = [];
  let revA = 11;
  let serverSettings = { enabled: true, keepTurnOutline: true, language: 'zh-CN' };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, serverSettings);
      else if (req.method === 'settings.reset') {
        resetReqs.push(req);
        serverSettings = { enabled: true, keepTurnOutline: true, language: 'en' };
        p.context.__agyPowertoolsReceive(req.id, serverSettings);
      }
      else if (req.method === 'state') {
        stateReqs.push(req);
        if (req.conversationId === 'conv-a' && req.knownRev === revA) {
          p.context.__agyPowertoolsReceive(req.id, { unchanged: true, conversationId: 'conv-a', stateRev: revA });
        } else {
          p.context.__agyPowertoolsReceive(req.id, {
            conversationId: req.conversationId,
            stateRev: req.conversationId === 'conv-a' ? revA : 22,
            settings: serverSettings,
            turns: [{ turnNumber: 1, status: 'complete' }, { turnNumber: 2, status: 'complete' }],
            contextWindow: {},
            telemetry: {},
            requests: []
          });
        }
      } else {
        p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  p.context.__agyDefaultSettings = { language: 'en' };
  p.context.__agyInitialSettings = { enabled: true, keepTurnOutline: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  // 1. Issue #62: second poll sends knownRev: 11 and cleanly handles { unchanged: true }
  const mainPoll = intervals.find(i => i.ms === 2000 && !i.cleared);
  fakeNow += 7000;
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(stateReqs.at(-1).knownRev, 11);

  // 1b. Settings-only revision bump (same stateValueSig!) MUST still advance state.stateRev so next poll sends knownRev: 12
  revA = 12;
  serverSettings = { ...serverSettings, compact: false };
  fakeNow += 7000;
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  fakeNow += 7000;
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(stateReqs.at(-1).knownRev, 12, 'settings-only state reply must still advance state.stateRev');

  // 1c. Restore defaults calls backend settings.reset and keeps backend OS default language ('en') instead of hardcoded 'zh-CN'
  assert.equal(capturedEnv.defaults.language, 'en');
  await capturedEnv.resetSettings();
  assert.equal(resetReqs.length, 1);
  assert.equal(capturedEnv.options().language, 'en');

  // 2. Issue #70: when conv-a enters running state while an unsubmitted pendingEdit is open,
  // cancelEdit restores composer home AND preserves pre-edit draft/attachments (restoreDraft: true)
  execState = { conversationId: 'conv-a', status: 2 };
  fakeNow += 7000;
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  assert.equal(cancelEditOpts.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(cancelEditOpts[0])), { restoreDraft: true });

  // 3. Issue #74: switching from conv-a -> conv-b suppresses fallback .pt-outline during the 220ms grace window;
  // when native conversation-navigator mounts within that window, fallback outline is never mounted!
  const rendersBeforeSwitch = outlineRenders;
  execState = { conversationId: 'conv-b', status: 1 };
  p.context.location.pathname = '/c/conv-b';
  fakeNow += 1000;
  mainPoll.fn();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(outlineRenders, rendersBeforeSwitch, 'must not flash fallback .pt-outline immediately on conversation switch');
  hasNativeNav = true;
  fakeNow += 300;
  const graceTimer = timeouts.find(t => t.ms === 230 && !t.cleared);
  if (graceTimer) graceTimer.fn();
  const mountDebounce = timeouts.at(-1);
  if (mountDebounce && !mountDebounce.cleared) mountDebounce.fn();
  assert.equal(outlineRenders, rendersBeforeSwitch, 'native conversation-navigator appeared so fallback outline must stay unmounted');

  p.context.__agyPowertools.dispose();
});

test('composer popover buttons retain accessible names without hover tips', () => {
  for (const id of ['agy-context-ring-trigger', 'agy-subagent-context-ring-trigger', 'agy-speed-stats-trigger']) {
    const index = source.indexOf(`'data-testid': '${id}'`);
    assert.notEqual(index, -1);
    const props = source.slice(source.lastIndexOf('h(Uy, {', index), source.indexOf('}, h(', index));
    assert.match(props, /'aria-label': t\('[^']+'\)/);
    assert.doesNotMatch(props, /data-pt-tip/);
  }
});

test('Issue #89: composer ring skips re-renders on popover-only changes while open popovers stay live', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-ime-89';
  const intervals = [];
  let fakeNow = 1_795_950_000_000;
  p.context.Date = class extends Date { static now() { return fakeNow; } };
  p.context.setInterval = (fn, ms) => { const entry = { fn, ms }; intervals.push(entry); return intervals.length; };
  p.context.clearInterval = () => {};

  let ringRenders = 0;
  let lastRingEl = null;
  const card = { isConnected: true, children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const flexParent = { isConnected: true, children: [], insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const model = {
    isConnected: true,
    textContent: 'Gemini 4 Carbon',
    parentElement: flexParent,
    nextSibling: null,
    closest: sel => sel === '.surface-composer-card' ? card : null
  };
  p.document.querySelectorAll = sel => (sel === '[data-testid="model-selector-trigger"]' ? [model] : []);
  p.context.getComputedStyle = () => ({ display: 'flex' });
  p.context.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useEffect() {},
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useSyncExternalStore: (_, getSnap) => getSnap()
  };
  p.context.HC = () => null;
  p.context.IC = 'IC';
  p.context.JC = 'JC';
  p.context.Uy = 'Uy';
  p.context.k0 = 'k0';
  p.context.__agyDashboard = { cacheObservation: () => null };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(tree) {
          if (mount.dataset?.agyPowertoolsRoot === 'ring') {
            ringRenders++;
            lastRingEl = tree;
          }
        },
        unmount() {}
      };
    }
  };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.composerCascadeId = () => 'conv-ime-89';
  p.context.__agyNativeAdapter.executionState = () => ({ conversationId: 'conv-ime-89', status: 2 });

  const serverState = {
    conversationId: 'conv-ime-89',
    modelName: 'Gemini 4 Carbon',
    costUsd: 0.05,
    contextWindow: {
      usedTokens: 50000,
      maxTokens: 1000000,
      usedPercent: 5,
      inputTokens: 1000,
      cacheReadTokens: 49000,
      compactedPending: false,
      compactions: 0,
      categories: [{ key: 'chat', label: 'Chat Messages', tokens: 50000, percent: 5 }],
      models: []
    },
    telemetry: {
      turnCount: 1,
      stepCount: 3,
      totalTokens: 50000,
      requestCount: 2,
      errorCount: 0,
      toolCount: 1,
      tps: 55,
      peakTps: 60,
      latestTps: 55,
      cacheHitPercent: 98,
      inputTokens: 1000,
      cacheReadTokens: 49000,
      outputTokens: 200,
      thinkingTokens: 0,
      modelTimeMs: 1000,
      toolTimeMs: 500,
      avgTtftMs: 200
    },
    progress: { status: 'running', phase: 'tools', toolCount: 1, recentActivity: [], tasks: [] },
    turns: [{ turnNumber: 1, status: 'running' }],
    requests: [{ id: 'req-1', timestampMs: fakeNow - 2000 }],
    errors: []
  };

  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, contextRing: true, speedStats: true, language: 'zh-CN' });
      } else if (req.method === 'state') {
        p.context.__agyPowertoolsReceive(req.id, JSON.parse(JSON.stringify(serverState)));
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true, speedStats: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 25));

  assert.ok(ringRenders >= 1);
  const initialRingTree = lastRingEl.type(lastRingEl.props);
  const collectText = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(collectText).join(' ');
    if (typeof node === 'object') {
      if (typeof node.type === 'function') return collectText(node.type(node.props));
      return collectText(node.children);
    }
    return '';
  };
  const findNode = (node, pred) => {
    if (!node || typeof node !== 'object') return null;
    if (pred(node)) return node;
    for (const c of Array.isArray(node.children) ? node.children : [node.children]) {
      const hit = findNode(c, pred);
      if (hit) return hit;
    }
    return null;
  };
  const ctxPopup = findNode(initialRingTree, n => n.props?.['data-testid'] === 'agy-context-popup');
  const statsPopup = findNode(initialRingTree, n => n.props?.['data-testid'] === 'agy-stats-popup');
  const ctxDetailsEl = ctxPopup.children[0];
  const statsDetailsEl = statsPopup.children[0];
  assert.equal(typeof ctxDetailsEl.type, 'function');
  assert.equal(typeof statsDetailsEl.type, 'function');

  const mainPoll = intervals.find(i => i.ms === 2000);
  const poll = async () => {
    fakeNow += 2000;
    mainPoll.fn();
    await new Promise(r => setTimeout(r, 20));
  };

  // Mutate popover-only fields (stepCount, toolCount, costUsd, cacheReadTokens, peakTps, compactions)
  // while keeping closed composer trigger values (usedPercent, compactedPending, latestTps) unchanged.
  const rendersBeforePopoverChanges = ringRenders;
  serverState.costUsd = 0.42;
  serverState.contextWindow.cacheReadTokens = 48500;
  serverState.contextWindow.inputTokens = 1500;
  serverState.contextWindow.compactions = 1;
  serverState.telemetry.stepCount = 14;
  serverState.telemetry.toolCount = 9;
  serverState.telemetry.peakTps = 112;
  serverState.telemetry.totalTokens = 92000;
  await poll();

  assert.equal(ringRenders, rendersBeforePopoverChanges, 'popover-only telemetry changes must not re-render composer ring root');

  // Re-rendering already-mounted popovers with their original stale data prop must read fresh live state via stateForConversation()
  const freshCtxText = collectText(ctxDetailsEl.type(ctxDetailsEl.props));
  assert.match(freshCtxText, /已压缩 1 次/);
  assert.match(freshCtxText, /48\.5k/);
  assert.match(freshCtxText, /1\.5k/);

  const freshStatsText = collectText(statsDetailsEl.type(statsDetailsEl.props));
  assert.match(freshStatsText, /1 \/ 14/);
  assert.match(freshStatsText, /92\.0k/);
  assert.match(freshStatsText, /\$0\.42/);
  assert.match(freshStatsText, /112 tok\/s/);

  // Subagent ContextDetails must keep using its own passed stats rather than main conversation state
  const subCtxText = collectText(ctxDetailsEl.type({
    isSubagent: true,
    data: {
      conversationId: 'conv-ime-89',
      contextWindow: { usedTokens: 12000, maxTokens: 200000, usedPercent: 6, compactions: 3, categories: [] },
      telemetry: {}
    }
  }));
  assert.match(subCtxText, /已压缩 3 次/);
  assert.match(subCtxText, /已使用 6%/);

  // Mutating closed-button visible fields MUST re-render the composer ring root
  serverState.contextWindow.usedPercent = 6.5;
  await poll();
  assert.equal(ringRenders, rendersBeforePopoverChanges + 1);

  serverState.contextWindow.compactedPending = true;
  await poll();
  assert.equal(ringRenders, rendersBeforePopoverChanges + 2);

  serverState.telemetry.latestTps = 72;
  await poll();
  assert.equal(ringRenders, rendersBeforePopoverChanges + 3);

  p.context.__agyPowertools.dispose();
});

test('PR #92: update RPC methods use 18000 ms timeout alongside pricing.refresh', async () => {
  const p = page(true);
  const timeoutByMethod = new Map();
  let pendingMs = 0;
  p.context.setTimeout = (_fn, ms) => { pendingMs = ms; return 1; };
  let capturedEnv = null;
  p.context.__agyPanels = env => { capturedEnv = env; return { dispose() {} }; };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (!timeoutByMethod.has(req.method)) timeoutByMethod.set(req.method, pendingMs);
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { ok: true }));
  };
  p.context.__agyInitialSettings = { enabled: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));

  for (const method of ['pricing.refresh', 'update.check', 'update.autoCheck', 'update.install', 'settings.export']) {
    pendingMs = 0;
    await capturedEnv.request(method, { version: '2.17.0' });
  }
  assert.equal(timeoutByMethod.get('pricing.refresh'), 18000);
  assert.equal(timeoutByMethod.get('update.check'), 18000);
  assert.equal(timeoutByMethod.get('update.autoCheck'), 18000);
  assert.equal(timeoutByMethod.get('update.install'), 18000);
  assert.equal(timeoutByMethod.get('settings.export'), 10000);

  p.context.__agyPowertools.dispose();
});

test('Issue #88: exportSettings/importSettings handle downloads, size guards, cross-OS missing fonts, and Settings UI renders clean feedback without middle dots', async () => {
  // Part A: native-ui env.exportSettings & env.importSettings
  const p = fontPage({ enabled: true, compact: true, language: 'zh-CN', pricingMode: 'standard', proxyEnabled: false, proxyUrl: '' });
  const downloads = [];
  const revokedUrls = [];
  let createdBlobText = '';
  p.context.Blob = class MockBlob {
    constructor(parts, opts) { this.parts = parts; this.type = opts?.type || ''; createdBlobText = parts.join(''); }
  };
  p.context.URL = {
    createObjectURL: () => 'blob:mock-settings-1',
    revokeObjectURL: url => { revokedUrls.push(url); }
  };
  const origCreateEl = p.document.createElement;
  p.document.createElement = tag => {
    if (tag === 'a') {
      const a = { tagName: 'A', style: {}, clicked: false, removed: false, click() { this.clicked = true; downloads.push({ href: this.href, download: this.download }); }, remove() { this.removed = true; } };
      return a;
    }
    return origCreateEl(tag);
  };
  const rpcCalls = [];
  let storedSettings = { enabled: true, compact: true, language: 'zh-CN', pricingMode: 'standard', customFont: '', customFontWeight: 0 };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    rpcCalls.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.export') {
        p.context.__agyPowertoolsReceive(req.id, {
          format: 'agy-powertools-settings',
          schemaVersion: 1,
          pluginVersion: '2.16.9',
          exportedAt: '2026-11-27T00:00:00.000Z',
          settings: { ...storedSettings },
          strippedProxyAuth: true
        });
      } else if (req.method === 'settings.import') {
        const parsed = JSON.parse(req.payload);
        storedSettings = { ...storedSettings, ...parsed.settings };
        const importedKeys = Object.keys(parsed.settings || {});
        p.context.__agyPowertoolsReceive(req.id, {
          settings: { ...storedSettings },
          appliedCount: 4,
          importedKeys,
          skippedKeys: ['futureFlag'],
          strippedProxyAuth: true
        });
      } else if (req.method === 'settings.set') {
        storedSettings = { ...storedSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...storedSettings });
      } else if (req.method === 'i18n.pack') {
        p.context.__agyPowertoolsReceive(req.id, { pack: null, custom: [] });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ...storedSettings });
      }
    });
  };
  await new Promise(r => setImmediate(r));

  const expRes = await p.env.exportSettings();
  assert.equal(expRes.ok, true);
  assert.equal(expRes.strippedProxyAuth, true);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].download, 'agy-powertools-settings.json');
  assert.equal(downloads[0].href, 'blob:mock-settings-1');
  assert.ok(createdBlobText.endsWith('\n'));
  const exportedObj = JSON.parse(createdBlobText);
  assert.equal(exportedObj.format, 'agy-powertools-settings');
  assert.equal(exportedObj.schemaVersion, 1);
  assert.equal('strippedProxyAuth' in exportedObj, false);

  await assert.rejects(() => p.env.importSettings('   '), /为空|empty/i);
  await assert.rejects(() => p.env.importSettings('a'.repeat(128 * 1024 + 1)), /128 KB/);

  const importPayload = JSON.stringify({
    format: 'agy-powertools-settings',
    schemaVersion: 1,
    settings: { compact: false, language: 'en', pricingMode: 'promo', customFont: 'PingFang SC', customFontWeight: 500 }
  });
  const impRes = await p.env.importSettings(importPayload);
  assert.equal(impRes.ok, true);
  assert.equal(impRes.appliedCount, 4);
  assert.deepEqual(Array.from(impRes.skippedKeys), ['futureFlag']);
  assert.equal(impRes.strippedProxyAuth, true);
  assert.equal(impRes.missingFont, 'PingFang SC');
  assert.equal(p.env.options().compact, false);
  assert.equal(p.env.options().language, 'en');
  assert.equal(p.env.options().pricingMode, 'promo');
  assert.equal(p.env.options().customFont, '');
  assert.equal(p.env.options().customFontWeight, 0);
  assert.equal(p.env.customFontError(), '');
  assert.ok(rpcCalls.some(c => c.method === 'settings.set' && c.settings?.customFont === '' && c.settings?.customFontWeight === 0));
  p.context.__agyPowertools.dispose();

  // Part B: native-panels Settings renders export/import controls and inline feedback without middle dots
  const panelsCode = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  const states = [];
  const refs = [];
  let stateIdx = 0, refIdx = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useId: () => 'id-88',
    useState: init => {
      const i = stateIdx++;
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
      return [states[i], val => { states[i] = typeof val === 'function' ? val(states[i]) : val; }];
    },
    useRef: init => {
      const i = refIdx++;
      if (!(i in refs)) refs[i] = { current: init };
      return refs[i];
    },
    useEffect() {},
    useSyncExternalStore: (_, getSnap) => getSnap()
  };
  const wrapTag = name => ({ children, ...props }) => React.createElement(name, props, ...(Array.isArray(children) ? children : [children]));
  const panelCtx = vm.createContext({
    React,
    Intl,
    URL,
    document: { createElement: tag => ({ tagName: tag, dataset: {}, textContent: '', remove() {} }), head: { append() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    __agyDashboard: {
      dateRange: () => ({ preset: 'weeklyQuota', start: 0, end: 1, activePools: [], status: 'unstarted' }),
      summarizeRequests: () => ({ requests: [], success: 0, errors: 0, tokens: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, cost: 0, priced: 0, points: [], models: [] }),
      distributionModels: () => [],
      subscriptionIdentity: () => ({ family: 'pro', style: 'pro', label: 'Pro' }),
      annotateCacheAnomalies: () => new Map()
    },
    setInterval: () => 1,
    clearInterval: () => {},
    Uy: 'button',
    Sy: 'tooltip',
    dq: ({ name }) => ({ type: 'icon', props: { name }, children: [] }),
    kT: wrapTag('kT'), lT: wrapTag('lT'), mT: wrapTag('mT'), nT: wrapTag('nT'),
    HC: wrapTag('HC'), IC: wrapTag('IC'), JC: wrapTag('JC'),
    VP: wrapTag('VP'), TP: wrapTag('TP'), UP: wrapTag('UP'), XP: wrapTag('XP')
  });
  vm.runInContext(panelsCode, panelCtx);

  let exportCalls = 0;
  const importPayloads = [];
  let importMode = 'ok';
  const currentOpts = { enabled: true, language: 'zh-CN', multiAccount: false, contextLimit: 0, sidebarProjectLimit: 0, overviewRange: 'weeklyQuota', pricingMode: 'standard' };
  const panels = panelCtx.__agyPanels({
    t: v => v,
    version: '2.16.9',
    defaults: { ...currentOpts },
    project: {},
    options: () => currentOpts,
    dashboard: () => null,
    loadDashboard: () => Promise.resolve(null),
    subscribe: () => () => {},
    revision: () => 0,
    consumeRequestedTab: () => 'settings',
    state: () => ({ contextWindow: { maxTokens: 1000000 } }),
    settingsError: () => '',
    customFontError: () => '',
    customFontNotice: () => '',
    fontInfo: () => ({}),
    capabilities: () => ({ models: [] }),
    change: async () => {},
    resetSettings: async () => {},
    exportSettings: async () => { exportCalls++; return { ok: true, strippedProxyAuth: true }; },
    importSettings: async raw => {
      importPayloads.push(raw);
      if (importMode === 'error') throw new Error('Invalid settings format');
      return { ok: true, appliedCount: 5, skippedKeys: [], strippedProxyAuth: true, missingFont: 'PingFang SC' };
    }
  });

  const findByTestId = (node, tid) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) { const hit = findByTestId(item, tid); if (hit) return hit; }
      return null;
    }
    if (node.props?.['data-testid'] === tid) return node;
    const extras = [node.props?.rightElement, node.props?.extraContent];
    for (const child of [...(Array.isArray(node.children) ? node.children : [node.children]), ...extras]) {
      const hit = findByTestId(child, tid);
      if (hit) return hit;
    }
    return null;
  };
  const renderSettings = () => {
    stateIdx = 0; refIdx = 0;
    const pageTree = panels.Page();
    const settingsComp = pageTree.children[1].children[1].children[0];
    stateIdx = 20; refIdx = 20;
    return settingsComp.type(settingsComp.props);
  };

  let tree = renderSettings();
  findByTestId(tree, 'agy-settings-cat-system').props.onClick();
  tree = renderSettings();
  const exportBtn = findByTestId(tree, 'agy-export-settings-btn');
  const importBtn = findByTestId(tree, 'agy-import-settings-btn');
  const importInput = findByTestId(tree, 'agy-import-settings-input');
  assert.ok(exportBtn);
  assert.ok(importBtn);
  assert.ok(importInput);
  assert.equal(importInput.props.accept, '.json,application/json');

  // Clicking export calls env.exportSettings and renders clean status without middle dots
  exportBtn.props.onClick();
  await new Promise(r => setImmediate(r));
  assert.equal(exportCalls, 1);
  tree = renderSettings();
  const exportStatus = findByTestId(tree, 'agy-settings-transfer-status');
  assert.ok(exportStatus);
  assert.equal(exportStatus.props.role, 'status');
  const exportMsg = exportStatus.children.join('');
  assert.match(exportMsg, /已导出配置/);
  assert.match(exportMsg, /代理账号密码/);
  assert.doesNotMatch(exportMsg, /[\u00b7\u2022\u2027\u30fb]/);

  // Clicking import triggers hidden file input click, and selecting a file calls env.importSettings
  let inputClicked = false;
  importInput.props.ref.current = { click() { inputClicked = true; }, value: 'backup.json' };
  importBtn.props.onClick();
  assert.equal(inputClicked, true);

  await importInput.props.onChange({
    target: {
      value: 'backup.json',
      files: [{ size: 42, text: async () => '{"format":"agy-powertools-settings"}' }]
    }
  });
  assert.deepEqual(importPayloads, ['{"format":"agy-powertools-settings"}']);
  tree = renderSettings();
  const importStatus = findByTestId(tree, 'agy-settings-transfer-status');
  assert.ok(importStatus);
  assert.equal(importStatus.props.role, 'status');
  const importMsg = importStatus.children.join('');
  assert.match(importMsg, /已导入配置/);
  assert.match(importMsg, /5/);
  assert.match(importMsg, /PingFang SC/);
  assert.match(importMsg, /代理账号密码/);
  assert.doesNotMatch(importMsg, /[\u00b7\u2022\u2027\u30fb]/);

  // Invalid file renders inline error alert with zero middle dots
  importMode = 'error';
  await importInput.props.onChange({
    target: {
      value: 'bad.json',
      files: [{ size: 12, text: async () => '{bad' }]
    }
  });
  tree = renderSettings();
  const errStatus = findByTestId(tree, 'agy-settings-transfer-status');
  assert.ok(errStatus);
  assert.equal(errStatus.props.role, 'alert');
  assert.equal(errStatus.props['data-tone'], 'error');
  const errMsg = errStatus.children.join('');
  assert.match(errMsg, /导入失败/);
  assert.match(errMsg, /Invalid settings format/);
  assert.doesNotMatch(errMsg, /[\u00b7\u2022\u2027\u30fb]/);

  panels.dispose();
});

test('partial import without customFont never invokes checkCustomFont or wipes existing customFont', async () => {
  const p = fontPage({ enabled: true, compact: true, language: 'zh-CN', customFont: 'Uninstalled Local Font', customFontWeight: 500 });
  let canvasMeasures = 0;
  const origCreate = p.document.createElement;
  p.document.createElement = tag => {
    if (tag !== 'canvas') return origCreate(tag);
    return {
      getContext: () => ({
        font: '',
        measureText() {
          canvasMeasures++;
          return { width: 100 };
        }
      })
    };
  };
  let stored = { enabled: true, compact: true, language: 'zh-CN', customFont: 'Uninstalled Local Font', customFontWeight: 500 };
  const setCalls = [];
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.import') {
        const parsed = JSON.parse(req.payload);
        stored = { ...stored, ...parsed.settings };
        p.context.__agyPowertoolsReceive(req.id, {
          settings: { ...stored },
          appliedCount: Object.keys(parsed.settings).length,
          importedKeys: Object.keys(parsed.settings),
          skippedKeys: [],
          strippedProxyAuth: false
        });
      } else if (req.method === 'settings.set') {
        setCalls.push(req.settings);
        stored = { ...stored, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...stored });
      } else if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { ...stored });
      } else {
        p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  await new Promise(r => setImmediate(r));
  canvasMeasures = 0;

  const res = await p.env.importSettings(JSON.stringify({
    format: 'agy-powertools-settings',
    schemaVersion: 1,
    settings: { compact: false }
  }));
  await new Promise(r => setImmediate(r));

  assert.equal(res.ok, true);
  assert.equal(res.appliedCount, 1);
  assert.equal(res.missingFont, '');
  assert.equal(canvasMeasures, 0, 'checkCustomFont must not run when customFont is not in importedKeys');
  assert.equal(setCalls.length, 0, 'existing customFont must not be cleared via settings.set');
  assert.equal(p.env.options().compact, false);
  assert.equal(p.env.options().customFont, 'Uninstalled Local Font');
  assert.equal(p.env.options().customFontWeight, 500);
  p.context.__agyPowertools.dispose();
});

test('acceptSettings and refresh fetch i18n.pack when locale pack is missing even if language matches', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-lang-race';
  let env;
  p.context.__agyPanels = value => { env = value; return { dispose() {} }; };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyInitialSettings = { enabled: true, language: 'zh-CN' };
  p.context.__agyLocalePack = null;

  const packRequests = [];
  let failPackOnce = true;
  let stored = { enabled: true, language: 'zh-CN' };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { ...stored });
      } else if (req.method === 'settings.set') {
        stored = { ...stored, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...stored });
      } else if (req.method === 'i18n.pack') {
        packRequests.push(req.language);
        if (failPackOnce && req.language === 'ja') {
          failPackOnce = false;
          p.context.__agyPowertoolsReceive(req.id, { error: 'transient pack failure' });
          return;
        }
        p.context.__agyPowertoolsReceive(req.id, { pack: getLocalePack(req.language), custom: [] });
      } else if (req.method === 'state') {
        p.context.__agyPowertoolsReceive(req.id, {
          conversationId: 'conv-lang-race',
          stateRev: 2,
          settings: { ...stored },
          contextWindow: {},
          telemetry: {},
          turns: [],
          requests: []
        });
      } else {
        p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));

  // 1. Concurrent refresh delivers external language change to 'ja'; first i18n.pack fails transiently
  //    so options.language becomes 'ja' while __agyLocalePack is still null.
  stored = { enabled: true, language: 'ja' };
  await env.refreshState();
  assert.deepEqual(packRequests, ['ja']);
  assert.equal(env.options().language, 'ja');
  assert.equal(p.context.__agyLocalePack, null);

  // 2. Next acceptSettings call with same language ('ja') must STILL fetch i18n.pack because __agyLocalePack?.lang !== 'ja'.
  await env.change({ language: 'ja' });
  assert.deepEqual(packRequests, ['ja', 'ja']);
  assert.equal(p.context.__agyLocalePack?.lang, 'ja');

  // 3. Another external language switch via refresh() to 'fr' fetches and installs the 'fr' pack cleanly.
  stored = { enabled: true, language: 'fr' };
  await env.refreshState();
  assert.deepEqual(packRequests, ['ja', 'ja', 'fr']);
  assert.equal(env.options().language, 'fr');
  assert.equal(p.context.__agyLocalePack?.lang, 'fr');

  p.context.__agyPowertools.dispose();
});

test('import validation error codes localize across zh-TW, en, fr, and ja without raw Simplified Chinese leaks or middle dots', async () => {
  const errorCodes = [
    'too-large',
    'invalid-json',
    'invalid-data',
    'invalid-format',
    'unsupported-version',
    'missing-settings',
    'no-applicable-settings'
  ];
  const simplifiedOnly = /[万与个为义于产仅从仓们价优会传体余侧关内写准减凑凭击划则刚创删务动区协单占却历压参发变号后听启周响唤围图圆场声处备头夹实审对导将尝尽层带帮并广库应开异强归当录径忆态总战执扩扬抢护报担拦择挂换据数断无旧时昵显暂机权条来栏树样档检汇没洁浅测浏滚满点热状独环现电监盘码确碍离积称稳筛签简类紧级线组细织终结给络绝统继续缓编缩网联脑范营补装观规视览触计订认让议记许设访证识诊试话询该详语误说请读调败账费资转轮软载较辅辑输边过运这进远违连迟适选遥邮采钟钥钮链销错键长闭问闲间阅队阶际险随隐静页顶项顺顿预频题额风馈驻验骤麦标彻]/;
  const i18nSrc = readFileSync(new URL('../lib/native-i18n.js', import.meta.url), 'utf8');
  const panelsSrc = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');

  for (const lang of ['zh-TW', 'en', 'fr', 'ja']) {
    // A. Test native-ui importSettings localization with simulated Simplified Chinese host error + errorCode
    const p = fontPage({ enabled: true, language: lang });
    p.context.__agyToZhTw = toZhTw;
    p.context.__agyLocalePack = getLocalePack(lang);
    p.context.NodeFilter = { SHOW_TEXT: 4 };
    p.document.createTreeWalker = () => ({ nextNode: () => null });
    vm.runInContext(i18nSrc, p.context);

    let nextErrCode = 'invalid-format';
    p.context.__agyPowertoolsHost = raw => {
      const req = JSON.parse(raw);
      queueMicrotask(() => {
        if (req.method === 'settings.import') {
          p.context.__agyPowertoolsReceive(req.id, {
            error: '设置导入文件格式无效（原始简体）',
            errorCode: nextErrCode
          });
        } else if (req.method === 'i18n.pack') {
          p.context.__agyPowertoolsReceive(req.id, { pack: getLocalePack(req.language), custom: [] });
        } else {
          p.context.__agyPowertoolsReceive(req.id, { enabled: true, language: lang });
        }
      });
    };
    await new Promise(r => setImmediate(r));

    for (const code of errorCodes) {
      nextErrCode = code;
      let caught = null;
      try {
        await p.env.importSettings('{"format":"test"}');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught && typeof caught.message === 'string', `${lang}/${code}: expected rejection`);
      assert.equal(caught.code, code);
      assert.ok(caught.message.length > 0);
      assert.doesNotMatch(caught.message, /原始简体/, `${lang}/${code}: leaked raw Simplified Chinese host message`);
      assert.doesNotMatch(caught.message, /[\u00b7\u2022\u2027\u30fb]/, `${lang}/${code}: forbidden middle dot`);
      if (lang === 'en' || lang === 'fr') {
        assert.doesNotMatch(caught.message, /[\u4e00-\u9fff]/, `${lang}/${code}: unexpected CJK in "${caught.message}"`);
      } else if (lang === 'zh-TW') {
        assert.doesNotMatch(caught.message, simplifiedOnly, `${lang}/${code}: simplified glyph in "${caught.message}"`);
      }
    }
    p.context.__agyPowertools.dispose();

    // B. Test native-panels Settings renders localized error code in alert banner
    const states = [];
    const refs = [];
    let stateIdx = 0, refIdx = 0;
    const React = {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      Fragment: 'fragment',
      useId: () => 'id-i18n-err',
      useState: init => {
        const i = stateIdx++;
        if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
        return [states[i], val => { states[i] = typeof val === 'function' ? val(states[i]) : val; }];
      },
      useRef: init => {
        const i = refIdx++;
        if (!(i in refs)) refs[i] = { current: init };
        return refs[i];
      },
      useEffect() {},
      useSyncExternalStore: (_, getSnap) => getSnap()
    };
    const wrapTag = name => ({ children, ...props }) => React.createElement(name, props, ...(Array.isArray(children) ? children : [children]));
    const panelDoc = {
      nodeType: 9,
      createElement: tag => ({ tagName: tag, dataset: {}, textContent: '', remove() {} }),
      head: { append() {} },
      createTreeWalker: () => ({ nextNode: () => null }),
      querySelectorAll: () => []
    };
    const panelCtx = vm.createContext({
      React, Intl, URL,
      document: panelDoc,
      NodeFilter: { SHOW_TEXT: 4 },
      MutationObserver: class { observe() {} disconnect() {} },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      __agyToZhTw: toZhTw,
      __agyLocalePack: getLocalePack(lang),
      __agyDashboard: {
        dateRange: () => ({ preset: 'weeklyQuota', start: 0, end: 1, activePools: [], status: 'unstarted' }),
        summarizeRequests: () => ({ requests: [], success: 0, errors: 0, tokens: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, cost: 0, priced: 0, points: [], models: [] }),
        distributionModels: () => [],
        subscriptionIdentity: () => ({ family: 'pro', style: 'pro', label: 'Pro' }),
        annotateCacheAnomalies: () => new Map()
      },
      setInterval: () => 1, clearInterval: () => {},
      Uy: 'button', Sy: 'tooltip', dq: ({ name }) => ({ type: 'icon', props: { name }, children: [] }),
      kT: wrapTag('kT'), lT: wrapTag('lT'), mT: wrapTag('mT'), nT: wrapTag('nT'),
      HC: wrapTag('HC'), IC: wrapTag('IC'), JC: wrapTag('JC'),
      VP: wrapTag('VP'), TP: wrapTag('TP'), UP: wrapTag('UP'), XP: wrapTag('XP')
    });
    vm.runInContext(i18nSrc, panelCtx);
    vm.runInContext(panelsSrc, panelCtx);

    const currentOpts = { enabled: true, language: lang, multiAccount: false, contextLimit: 0, sidebarProjectLimit: 0, overviewRange: 'weeklyQuota', pricingMode: 'standard' };
    const panels = panelCtx.__agyPanels({
      t: v => panelCtx.__agyI18n.t(v, lang),
      version: '2.16.9',
      defaults: { ...currentOpts },
      project: {},
      options: () => currentOpts,
      dashboard: () => null,
      loadDashboard: () => Promise.resolve(null),
      subscribe: () => () => {},
      revision: () => 0,
      consumeRequestedTab: () => 'settings',
      state: () => ({ contextWindow: { maxTokens: 1000000 } }),
      settingsError: () => '',
      customFontError: () => '',
      customFontNotice: () => '',
      fontInfo: () => ({}),
      capabilities: () => ({ models: [] }),
      change: async () => {},
      resetSettings: async () => {},
      exportSettings: async () => ({ ok: true }),
      importSettings: async () => {
        const err = new Error('原始简体兜底');
        err.code = 'no-applicable-settings';
        throw err;
      }
    });
    const findByTestId = (node, tid) => {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node)) {
        for (const item of node) { const hit = findByTestId(item, tid); if (hit) return hit; }
        return null;
      }
      if (node.props?.['data-testid'] === tid) return node;
      const extras = [node.props?.rightElement, node.props?.extraContent];
      for (const child of [...(Array.isArray(node.children) ? node.children : [node.children]), ...extras]) {
        const hit = findByTestId(child, tid);
        if (hit) return hit;
      }
      return null;
    };
    const renderSettings = () => {
      stateIdx = 0; refIdx = 0;
      const pageTree = panels.Page();
      const settingsComp = pageTree.children[1].children[1].children[0];
      stateIdx = 20; refIdx = 20;
      return settingsComp.type(settingsComp.props);
    };
    let tree = renderSettings();
    findByTestId(tree, 'agy-settings-cat-system').props.onClick();
    tree = renderSettings();
    const importInput = findByTestId(tree, 'agy-import-settings-input');
    await importInput.props.onChange({ target: { value: 'empty.json', files: [{ size: 20, text: async () => '{}' }] } });
    tree = renderSettings();
    const errEl = findByTestId(tree, 'agy-settings-transfer-status');
    const rendered = errEl.children.join('');
    assert.doesNotMatch(rendered, /原始简体/);
    assert.doesNotMatch(rendered, /[\u00b7\u2022\u2027\u30fb]/);
    if (lang === 'en') assert.equal(rendered, 'Import failed: No applicable settings found in file');
    else if (lang === 'fr') assert.equal(rendered, 'Échec de l’importation: Aucun paramètre applicable trouvé dans le fichier');
    else if (lang === 'ja') assert.equal(rendered, 'インポートに失敗しました: 適用可能な設定項目が見つかりませんでした');
    else if (lang === 'zh-TW') assert.equal(rendered, '導入失敗: 未找到可應用的有效設定項');
    panels.dispose();
  }
});

test('composerRingSig gates contextWindow and speedStats fields on their respective toggles', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-sig';
  let renderCount = 0;
  p.context.React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  p.context.ReactDOM = {
    createRoot() {
      return {
        render() { renderCount++; },
        unmount() {}
      };
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const parent = { insertBefore(child) { child.isConnected = true; } };
  const card = { cid: 'conv-sig' };
  const trigger = { cid: 'conv-sig', isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  p.document.querySelectorAll = sel => sel === '[data-testid="model-selector-trigger"]' ? [trigger] : [];
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.composerCascadeId = el => el?.cid || '';
  let env;
  p.context.__agyPanels = value => { env = value; return { dispose() {} }; };
  p.context.__agyNativeAdapter.installPage = () => true;

  let curSettings = { enabled: true, contextRing: false, speedStats: true, language: 'en' };
  let curState = { conversationId: 'conv-sig', stateRev: 1, settings: curSettings, contextWindow: { usedPercent: 10, usedTokens: 1000, maxTokens: 10000 }, telemetry: { latestTps: 42 }, turns: [], requests: [] };
  p.context.__agyInitialSettings = { ...curSettings };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { ...curSettings });
      else if (req.method === 'settings.set') { curSettings = { ...curSettings, ...req.settings }; p.context.__agyPowertoolsReceive(req.id, { ...curSettings }); }
      else if (req.method === 'state') p.context.__agyPowertoolsReceive(req.id, { ...curState, settings: { ...curSettings } });
      else p.context.__agyPowertoolsReceive(req.id, {});
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  const baseline = renderCount;

  // Context window changes while contextRing is disabled must not trigger ring re-render
  curState = { ...curState, stateRev: 2, contextWindow: { usedPercent: 75, usedTokens: 7500, maxTokens: 10000 } };
  await env.refreshState();
  assert.equal(renderCount, baseline);

  // Switch toggles: contextRing=true, speedStats=false
  await env.change({ contextRing: true, speedStats: false });
  const afterToggle = renderCount;
  assert.ok(afterToggle > baseline);

  // Telemetry speed changes while speedStats is disabled must not trigger ring re-render
  curState = { ...curState, stateRev: 3, telemetry: { latestTps: 99.5 } };
  await env.refreshState();
  assert.equal(renderCount, afterToggle);

  p.context.__agyPowertools.dispose();
});

test('overview native title tooltips preserve original English key across language switches, restore and pause when disabled, and prune detached hosts', async () => {
  const i18nSrc = readFileSync(new URL('../lib/native-i18n.js', import.meta.url), 'utf8');
  const jaPack = getLocalePack('ja');

  const docListeners = new Map();
  const matchesAtom = (el, atom) => {
    if (!el || el.nodeType !== 1) return false;
    const mEq = atom.match(/^\[([^=\]]+)="([^"]*)"\]$/);
    if (mEq) return el.getAttribute(mEq[1]) === mEq[2];
    const mAttr = atom.match(/^\[([^\]]+)\]$/);
    if (mAttr) return el.hasAttribute(mAttr[1]);
    return false;
  };
  const matchesDescendant = (el, sel) => {
    for (const part of sel.split(',')) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      if (!matchesAtom(el, tokens[tokens.length - 1])) continue;
      let ok = true;
      let cur = el.parentElement;
      for (let i = tokens.length - 2; i >= 0; i--) {
        while (cur && !matchesAtom(cur, tokens[i])) cur = cur.parentElement;
        if (!cur) { ok = false; break; }
        cur = cur.parentElement;
      }
      if (ok) return el;
    }
    return null;
  };
  const makeEl = tag => ({
    nodeType: 1,
    tagName: String(tag || 'div').toUpperCase(),
    attrs: {},
    dataset: {},
    style: {},
    className: '',
    children: [],
    parentElement: null,
    isConnected: true,
    textContent: '',
    getBoundingClientRect: () => ({ top: 200, bottom: 224, left: 600, right: 820, width: 220, height: 24 }),
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
    removeAttribute(k) { delete this.attrs[k]; },
    append(...items) {
      for (const it of items) {
        if (it && typeof it === 'object') { it.parentElement = this; it.isConnected = true; this.children.push(it); }
      }
    },
    appendChild(it) { this.append(it); return it; },
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx, 1);
      }
      this.isConnected = false;
      this.parentElement = null;
    },
    closest(sel) {
      for (let cur = this; cur; cur = cur.parentElement) {
        const hit = matchesDescendant(cur, sel);
        if (hit) return hit;
      }
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => []
  });

  const head = makeEl('head');
  const body = makeEl('body');
  const ovPanel = makeEl('div');
  ovPanel.setAttribute('data-testid', 'overview-panel');
  // Bug 1 fixture: element pre-translated by native-i18n.js before hover
  const preTranslatedRow = makeEl('div');
  preTranslatedRow.setAttribute('data-agy-original-title', 'Modified Files');
  preTranslatedRow.setAttribute('title', '已修改文件');
  const zhRow = makeEl('div');
  zhRow.setAttribute('title', '这是中文产物摘要');
  // Bug 3 fixture: element detached after promotion
  const detachableRow = makeEl('div');
  detachableRow.setAttribute('title', 'Background Tasks');
  const freshRow = makeEl('div');
  freshRow.setAttribute('title', 'Overview');
  // Bug 2 fixture: untouched element hovered while Powertools is disabled
  const disabledRow = makeEl('div');
  disabledRow.setAttribute('title', 'Side Questions');
  // P2 #5 fixture: Overview rows named Folders / Preview must NOT be mistranslated on hover via tAttr
  const foldersRow = makeEl('div');
  foldersRow.setAttribute('title', 'Folders');
  const previewRow = makeEl('div');
  previewRow.setAttribute('title', 'Preview');
  ovPanel.append(preTranslatedRow, zhRow, detachableRow, freshRow, disabledRow, foldersRow, previewRow);
  body.append(ovPanel);

  const document = {
    nodeType: 9,
    head,
    body,
    documentElement: { toggleAttribute() {}, removeAttribute() {}, setAttribute() {}, style: { setProperty() {}, removeProperty() {} }, clientWidth: 1280, clientHeight: 800 },
    readyState: 'complete',
    createElement: tag => makeEl(tag),
    createTreeWalker: () => ({ nextNode: () => null }),
    addEventListener(type, fn) { if (!docListeners.has(type)) docListeners.set(type, []); docListeners.get(type).push(fn); },
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  };

  let stored = { enabled: true, language: 'zh-CN' };
  let env = null;
  const ctx = vm.createContext({
    document,
    window: { addEventListener() {}, removeEventListener() {} },
    innerWidth: 1280,
    innerHeight: 800,
    location: { pathname: '/c/conv-tip' },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    AbortController,
    getComputedStyle: () => ({ display: 'block' }),
    React: { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: (_, g) => g() },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    __agyToZhTw: toZhTw,
    __agyPanels: value => { env = value; return { dispose() {} }; },
    __agyInitialSettings: { ...stored },
    __agyNativeAdapter: {
      wrap: el => el,
      installPage: () => true,
      executionState: () => null,
      runningConversationIds: () => [],
      capabilities: () => ({}),
      service: () => ({}),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const req = JSON.parse(raw);
      queueMicrotask(() => {
        if (req.method === 'settings.get') {
          ctx.__agyPowertoolsReceive(req.id, { ...stored });
        } else if (req.method === 'settings.set') {
          stored = { ...stored, ...req.settings };
          ctx.__agyPowertoolsReceive(req.id, { ...stored });
        } else if (req.method === 'i18n.pack') {
          ctx.__agyPowertoolsReceive(req.id, { pack: req.language === 'ja' ? jaPack : null, custom: [] });
        } else {
          ctx.__agyPowertoolsReceive(req.id, {});
        }
      });
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    queueMicrotask
  });

  vm.runInContext(i18nSrc, ctx);
  vm.runInContext(source, ctx);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(env);

  const fire = (type, evt) => { for (const fn of docListeners.get(type) || []) fn(evt); };

  // Bug 1 check: pre-translated Overview row promotes using data-agy-original-title ("Modified Files"), not Chinese title
  fire('pointerover', { target: preTranslatedRow });
  assert.equal(preTranslatedRow.hasAttribute('title'), false);
  assert.equal(preTranslatedRow.hasAttribute('data-agy-original-title'), false);
  assert.equal(preTranslatedRow.getAttribute('data-agy-native-title'), 'Modified Files');
  assert.equal(preTranslatedRow.getAttribute('data-pt-tip-place'), 'left');
  fire('focusin', { target: preTranslatedRow });

  const pop = body.children.find(c => c.id === 'agy-pt-tip-pop');
  assert.ok(pop);
  assert.equal(pop.dataset.open, 'true');
  assert.equal(pop.children[0].textContent, '已修改文件');

  // Switching to English renders the true original English string instead of staying locked in Chinese
  await env.change({ language: 'en' });
  fire('focusin', { target: preTranslatedRow });
  assert.equal(pop.children[0].textContent, 'Modified Files');

  // Switching to Japanese re-translates cleanly from the preserved English original
  ctx.__agyLocalePack = jaPack;
  await env.change({ language: 'ja' });
  fire('focusin', { target: preTranslatedRow });
  assert.equal(pop.children[0].textContent, jaPack.entries['Modified Files']);
  assert.notEqual(pop.children[0].textContent, 'Modified Files');
  assert.notEqual(pop.children[0].textContent, '已修改文件');

  // Untranslated Chinese row stays intact
  fire('focusin', { target: zhRow });
  assert.equal(zhRow.hasAttribute('title'), false);
  assert.equal(pop.children[0].textContent, '这是中文产物摘要');

  // Bug 3 check: detached promoted host is pruned on subsequent promotion/cleanup and no longer retained
  fire('pointerover', { target: detachableRow });
  assert.equal(detachableRow.getAttribute('data-agy-native-title'), 'Background Tasks');
  detachableRow.remove();
  assert.equal(detachableRow.isConnected, false);
  fire('pointerover', { target: freshRow });
  assert.equal(freshRow.getAttribute('data-agy-native-title'), 'Overview');
  // Re-marking isConnected=true after pruning proves detachableRow was already deleted from promotedNativeTitles
  detachableRow.isConnected = true;

  // Bug 2 check: disabling Powertools restores all connected promoted titles immediately and stops promoting new hovers
  await env.change({ enabled: false });
  assert.equal(preTranslatedRow.getAttribute('title'), 'Modified Files');
  assert.equal(preTranslatedRow.hasAttribute('data-pt-tip'), false);
  assert.equal(preTranslatedRow.hasAttribute('data-agy-native-title'), false);
  assert.equal(zhRow.getAttribute('title'), '这是中文产物摘要');
  assert.equal(freshRow.getAttribute('title'), 'Overview');
  assert.equal(detachableRow.hasAttribute('title'), false);
  assert.equal(pop.dataset.open, 'false');

  fire('pointerover', { target: disabledRow });
  fire('focusin', { target: disabledRow });
  assert.equal(disabledRow.getAttribute('title'), 'Side Questions');
  assert.equal(disabledRow.hasAttribute('data-pt-tip'), false);
  assert.equal(disabledRow.hasAttribute('data-agy-native-title'), false);
  assert.equal(pop.dataset.open, 'false');

  // Re-enabling resumes promotion cleanly and dispose restores remaining promoted rows
  ctx.__agyLocalePack = null;
  await env.change({ enabled: true, language: 'zh-CN' });
  fire('focusin', { target: disabledRow });
  assert.equal(disabledRow.hasAttribute('title'), false);
  assert.equal(disabledRow.getAttribute('data-agy-native-title'), 'Side Questions');
  assert.equal(pop.children[0].textContent, '侧边对话');

  // P2 #5 check: Overview rows named Folders / Preview stay untranslated in promoted tooltips
  fire('focusin', { target: foldersRow });
  assert.equal(pop.children[0].textContent, 'Folders');
  fire('focusin', { target: previewRow });
  assert.equal(pop.children[0].textContent, 'Preview');

  ctx.__agyPowertools.dispose();
  assert.equal(disabledRow.getAttribute('title'), 'Side Questions');
  assert.equal(disabledRow.hasAttribute('data-pt-tip'), false);
  assert.equal(foldersRow.getAttribute('title'), 'Folders');
  assert.equal(previewRow.getAttribute('title'), 'Preview');
  assert.equal(pop.isConnected, false);
});

test('accounts.syncActive switchMismatch surfaces a clear error toast without middle dots (Issue #97)', async () => {
  const p = page(true);
  const toasts = [];
  let env = null;
  const customizations = { isConnected: true, nextSibling: null, parentElement: { insertBefore(n) { n.isConnected = true; } } };
  p.document.querySelector = sel => sel === 'a[href="/customizations"]' ? customizations : null;
  p.context.um = () => payload => { toasts.push(payload); };
  p.context.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useEffect: fn => { fn(); }
  };
  p.context.ReactDOM = {
    createRoot: () => ({
      render(el) { if (typeof el?.type === 'function') el.type(el.props || {}); },
      unmount() {}
    })
  };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({ email: 'old@example.com', name: 'Old', plan: 'Pro', planId: 'pro' });
  p.context.__agyNativeAdapter.service = () => ({ retrieveUserQuotaSummary: async () => ({ response: { groups: [] } }) });
  p.context.__agyPanels = value => { env = value; return { Sidebar: () => null, Page: () => null, dispose() {} }; };

  let lang = 'zh-CN';
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, language: lang });
      } else if (req.method === 'settings.set') {
        if (req.settings?.language) lang = req.settings.language;
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, language: lang });
      } else if (req.method === 'accounts.syncActive') {
        p.context.__agyPowertoolsReceive(req.id, {
          activeId: 'acct-old',
          accounts: [
            { id: 'acct-old', email: 'old@example.com', hasCredential: true },
            { id: 'acct-target', email: 'target@example.com', hasCredential: false }
          ],
          switchMismatch: { expectedEmail: 'target@example.com', actualEmail: 'old@example.com' }
        });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(env);

  await env.refreshAccountQuotas('acct-old');
  const zhToast = toasts.find(t => t.tag === 'agy-account-switch-mismatch');
  assert.ok(zhToast);
  assert.equal(zhToast.message, '切号未生效：当前登录的仍是其他账号，已标记目标凭据失效，请重新登录目标账号。');
  assert.doesNotMatch(zhToast.message, /[\u00b7\u2022\u2027\u30fb]/);

  toasts.length = 0;
  await env.change({ language: 'en' });
  await env.refreshAccountQuotas('acct-old');
  const enToast = toasts.find(t => t.tag === 'agy-account-switch-mismatch');
  assert.ok(enToast);
  assert.equal(enToast.message, 'Account switch failed: logged in as another account. Please re-login the target account.');
  assert.doesNotMatch(enToast.message, /[\u00b7\u2022\u2027\u30fb]/);

  p.context.__agyPowertools.dispose();
});

test('About panel surfaces update.install error message when request rejects (Issue #96)', async () => {
  const panelsSrc = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  const head = { append() {} };
  const states = [];
  let idx = 0;
  const ctx = vm.createContext({
    document: { head, createElement: () => ({ dataset: {}, textContent: '', remove() {} }) },
    URL,
    window: { addEventListener() {}, removeEventListener() {} },
    location: { pathname: '/powertools' },
    React: {
      Fragment: Symbol('Fragment'),
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
      useId: () => 'id-about',
      useState: init => {
        const slot = idx++;
        if (!(slot in states)) states[slot] = typeof init === 'function' ? init() : init;
        return [states[slot], next => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; }];
      },
      useEffect() {},
      useRef: v => ({ current: v }),
      useMemo: fn => fn(),
      useCallback: fn => fn,
      useSyncExternalStore: (_, g) => g()
    },
    HC: ({ children }) => children,
    IC: ({ children }) => children,
    JC: ({ children }) => children,
    KC: ({ children }) => children,
    GC: ({ children }) => children,
    kT: ({ children }) => children,
    lT: ({ children }) => children,
    mT: ({ children }) => children,
    nT: ({ children }) => children,
    Uy: props => ({ type: 'button', props, children: [] }),
    XP: props => ({ type: 'switch', props, children: [] }),
    UP: props => ({ type: 'row', props, children: [props.description, props.rightElement, props.extraContent] }),
    TP: ({ children }) => ({ type: 'card', props: {}, children }),
    VP: ({ children }) => ({ type: 'section', props: {}, children }),
    dq: props => ({ type: 'icon', props, children: [] }),
    Sy: ({ children }) => children,
    Wz: ({ children }) => children
  });
  vm.runInContext(panelsSrc, ctx);
  const panels = ctx.__agyPanels({
    adapter: { router: () => ({ navigate() {} }) },
    t: s => s,
    version: '2.16.10',
    defaults: { enabled: true, language: 'en' },
    project: { name: 'Agy Powertools', githubUrl: 'https://github.com/whitzard0421/agy-powertools', subscriptionUrl: '' },
    options: () => ({ enabled: true, language: 'en' }),
    updateNotice: () => ({ status: 'available', version: '2.16.11', canInstall: true, releaseUrl: 'https://github.com/whitzard0421/agy-powertools/releases/tag/v2.16.11' }),
    updateInstallState: () => ({ status: 'idle' }),
    consumeExpandUpdateNotes: () => false,
    consumeScrollToAbout: () => false,
    request: async method => {
      if (method === 'update.install') throw new Error('EACCES: permission denied');
      return { status: 'idle' };
    },
    subscribe: () => () => {},
    revision: () => 0
  });
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type({ ...(node.props || {}), children: node.children }));
    return { ...node, children: Array.isArray(node.children) ? node.children.map(expand) : node.children };
  };
  const findByTestId = (node, tid) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const c of node) { const hit = findByTestId(c, tid); if (hit) return hit; } return null; }
    if (node.props?.['data-testid'] === tid) return node;
    return findByTestId(node.children, tid);
  };
  const collectText = node => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (!node || typeof node !== 'object') return '';
    if (Array.isArray(node)) return node.map(collectText).join('');
    return collectText(node.children);
  };

  idx = 0;
  let tree = expand(panels.About());
  const installBtn = findByTestId(tree, 'agy-install-update');
  assert.ok(installBtn);
  installBtn.props.onClick();
  await new Promise(r => setImmediate(r));

  idx = 0;
  tree = expand(panels.About());
  const statusEl = findByTestId(tree, 'agy-install-status');
  assert.ok(statusEl);
  assert.match(collectText(statusEl), /EACCES: permission denied/);
  panels.dispose();
});

test('installThemeTooltips ignores non-focus-visible programmatic focusin/focusout while allowing keyboard focus-visible', () => {
  const listeners = new Map();
  const makeEl = tag => ({
    tagName: String(tag || 'div').toUpperCase(),
    dataset: {},
    style: {},
    className: '',
    textContent: '',
    isConnected: true,
    attrs: new Map(),
    children: [],
    append(...items) { this.children.push(...items); },
    remove() { this.isConnected = false; },
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    removeAttribute(k) { this.attrs.delete(k); },
    getBoundingClientRect: () => ({ width: 200, height: 28, left: 0, top: 0, right: 200, bottom: 28 })
  });
  const head = makeEl('head');
  const body = makeEl('body');
  const doc = {
    readyState: 'complete',
    head,
    body,
    documentElement: { toggleAttribute() {}, removeAttribute() {}, style: { setProperty() {}, removeProperty() {} }, clientWidth: 1000, clientHeight: 700 },
    createElement: tag => makeEl(tag),
    addEventListener(type, fn, opts) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
      opts?.signal?.addEventListener?.('abort', () => {
        const list = listeners.get(type) || [];
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }, { once: true });
    },
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const fire = (type, evt) => { for (const fn of [...(listeners.get(type) || [])]) fn(evt); };
  const ctx = vm.createContext({
    document: doc,
    location: { pathname: '/' },
    innerWidth: 1000,
    innerHeight: 700,
    AbortController,
    React: { createElement() { return {}; } },
    ReactDOM: { createRoot() { throw new Error('No DOM roots expected'); } },
    HC() {},
    __agyNativeAdapter: { wrap() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {}
  });
  vm.runInContext(source, ctx);

  const makeFocusableHost = (tip, isFocusVisible) => {
    let focusVisible = isFocusVisible;
    const attrs = new Map([['data-pt-tip', tip]]);
    const host = {
      isConnected: true,
      setFocusVisible(v) { focusVisible = v; },
      matches: sel => (sel === ':focus-visible' ? focusVisible : false),
      getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: k => attrs.delete(k),
      closest: sel => (sel === '[data-pt-tip]' ? host : null),
      getBoundingClientRect: () => ({ left: 200, right: 360, top: 120, bottom: 148, width: 160, height: 28 })
    };
    return host;
  };

  const firstRow = makeFocusableHost('First subagent tooltip', false);
  const secondRow = makeFocusableHost('Second subagent tooltip', false);

  // Programmatic/pointer focus (not :focus-visible) must NOT auto-open tooltip on popover open
  fire('focusin', { target: firstRow });
  assert.equal(body.children.find(c => c.className === 'pt-tip-pop'), undefined);

  // Keyboard Tab focus (:focus-visible === true) MUST open tooltip immediately
  firstRow.setFocusVisible(true);
  fire('focusin', { target: firstRow });
  const pop = body.children.find(c => c.className === 'pt-tip-pop');
  assert.ok(pop);
  assert.equal(pop.dataset.open, 'true');
  assert.equal(pop.children[0].textContent, 'First subagent tooltip');

  // Moving focus programmatically to another non-focus-visible element must hide instead of popping up next tooltip
  fire('focusout', { target: firstRow, relatedTarget: secondRow });
  assert.equal(pop.dataset.open, 'false');

  // Moving keyboard focus to secondRow opens secondRow's tooltip
  secondRow.setFocusVisible(true);
  fire('focusin', { target: secondRow });
  assert.equal(pop.dataset.open, 'true');
  assert.equal(pop.children[0].textContent, 'Second subagent tooltip');

  ctx.__agyPowertools.dispose();
});

test('ContextDetails scopes subagent tooltip to name span only and SessionStatsDetails removes Cache observation while keeping Cache hit', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-ui-polish';
  let lastRingEl = null;
  const flexParent = { children: [], style: {}, append() {}, insertBefore() {} };
  const card = { dataset: {}, querySelector: () => null };
  const model = {
    isConnected: true,
    parentElement: flexParent,
    nextSibling: null,
    closest: sel => (sel === '.surface-composer-card' ? card : null)
  };
  p.document.querySelectorAll = sel => (sel === '[data-testid="model-selector-trigger"]' ? [model] : []);
  p.context.getComputedStyle = () => ({ display: 'flex' });
  p.context.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useEffect() {},
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useSyncExternalStore: (_, getSnap) => getSnap()
  };
  p.context.HC = () => null;
  p.context.IC = 'IC';
  p.context.JC = 'JC';
  p.context.Uy = 'Uy';
  p.context.k0 = 'k0';
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(tree) {
          if (mount.dataset?.agyPowertoolsRoot === 'ring') lastRingEl = tree;
        },
        unmount() {}
      };
    }
  };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.composerCascadeId = () => 'conv-ui-polish';
  p.context.__agyNativeAdapter.executionState = () => ({ conversationId: 'conv-ui-polish', status: 2 });
  p.context.__agyNativeAdapter.subagents = () => ([
    { id: 'sub-1', parentId: 'conv-ui-polish', depth: 1, title: 'Codebase Researcher', status: 'done', stepCount: 4, lastModifiedAtMs: Date.now() }
  ]);

  const nowMs = Date.now();
  const mainState = {
    conversationId: 'conv-ui-polish',
    modelName: 'Gemini 4 Carbon',
    costUsd: 0.12,
    contextWindow: {
      usedTokens: 50000,
      maxTokens: 1000000,
      usedPercent: 5,
      inputTokens: 1000,
      cacheReadTokens: 49000,
      compactedPending: false,
      compactions: 0,
      categories: [{ key: 'chat', label: 'Chat Messages', tokens: 50000, percent: 5 }],
      models: []
    },
    telemetry: {
      turnCount: 2,
      stepCount: 5,
      totalTokens: 50000,
      requestCount: 3,
      errorCount: 0,
      toolCount: 2,
      tps: 62,
      peakTps: 84,
      latestTps: 60,
      cacheHitPercent: 98,
      inputTokens: 1000,
      cacheReadTokens: 49000,
      outputTokens: 300,
      thinkingTokens: 0,
      modelTimeMs: 1200,
      toolTimeMs: 400,
      avgTtftMs: 180
    },
    progress: { status: 'complete', toolCount: 2, recentActivity: [], tasks: [] },
    turns: [{ turnNumber: 1, status: 'complete' }],
    requests: [{ id: 'req-1', model: 'Claude Sonnet 4.6', timestampMs: nowMs - 15000, inputTokens: 1000, cacheReadTokens: 49000 }],
    errors: []
  };
  const subState = {
    conversationId: 'sub-1',
    modelName: 'Gemini 3.1 Pro (High)',
    shortModel: 'G3.1 Pro',
    costUsd: 0.03,
    contextWindow: { usedTokens: 24000, maxTokens: 200000, usedPercent: 12, compactions: 0, categories: [] },
    telemetry: { totalTokens: 28000, inputTokens: 2000, cacheReadTokens: 26000, cacheHitPercent: 92.9, tps: 71, requestCount: 2, toolCount: 3 }
  };

  let stored = { enabled: true, contextRing: true, speedStats: true, subagentTelemetry: true, language: 'zh-CN' };
  let env = null;
  p.context.__agyPanels = value => { env = value; return { dispose() {} }; };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { ...stored });
      } else if (req.method === 'settings.set') {
        stored = { ...stored, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, { ...stored });
      } else if (req.method === 'state') {
        p.context.__agyPowertoolsReceive(req.id, JSON.parse(JSON.stringify(mainState)));
      } else if (req.method === 'subagents.stats') {
        p.context.__agyPowertoolsReceive(req.id, { items: { 'sub-1': subState } });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = { ...stored };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 40));

  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type({ ...(node.props || {}), children: node.children }));
    return { ...node, children: Array.isArray(node.children) ? node.children.map(expand) : node.children };
  };
  const findAll = (node, pred, acc = []) => {
    if (!node || typeof node !== 'object') return acc;
    if (Array.isArray(node)) { for (const c of node) findAll(c, pred, acc); return acc; }
    if (pred(node)) acc.push(node);
    findAll(node.children, pred, acc);
    return acc;
  };
  const collectText = node => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (!node || typeof node !== 'object') return '';
    if (Array.isArray(node)) return node.map(collectText).join(' ');
    return collectText(node.children);
  };

  assert.ok(lastRingEl);
  const ringTree = lastRingEl.type(lastRingEl.props);
  const ctxPopup = findAll(ringTree, n => n.props?.['data-testid'] === 'agy-context-popup')[0];
  const statsPopup = findAll(ringTree, n => n.props?.['data-testid'] === 'agy-stats-popup')[0];
  assert.ok(ctxPopup && statsPopup);

  // 1a: ContextDetails subagent row button has NO data-pt-tip; only the subagent name span has data-pt-tip
  const ctxTree = expand(ctxPopup.children[0]);
  const subRowBtn = findAll(ctxTree, n => n.props?.['data-testid'] === 'agy-subagent-ctx-sub-1')[0];
  assert.ok(subRowBtn);
  assert.equal(subRowBtn.props['data-pt-tip'], undefined);
  const tippedInsideRow = findAll(subRowBtn, n => Boolean(n.props?.['data-pt-tip']));
  assert.equal(tippedInsideRow.length, 1);
  assert.equal(tippedInsideRow[0].type, 'span');
  assert.equal(collectText(tippedInsideRow[0]).trim(), 'Codebase Researcher');
  assert.equal(tippedInsideRow[0].props['data-pt-tip'], 'Codebase Researcher (Gemini 3.1 Pro (High))');

  // 3: SessionStatsDetails removes Cache observation row in zh-CN and en while preserving Cache hit and other stats
  const statsTreeZh = expand(statsPopup.children[0]);
  assert.equal(findAll(statsTreeZh, n => n.props?.['data-testid'] === 'agy-cache-observation').length, 0);
  const statsTextZh = collectText(statsTreeZh);
  assert.equal(statsTextZh.includes('缓存观察'), false);
  assert.equal(statsTextZh.includes('Cache window'), false);
  assert.ok(statsTextZh.includes('缓存命中'));
  assert.ok(statsTextZh.includes('98%'));
  assert.ok(statsTextZh.includes('62 tok/s'));
  assert.equal(statsTextZh.includes('\u00b7'), false);

  await env.change({ language: 'en' });
  const statsTreeEn = expand(statsPopup.children[0]);
  assert.equal(findAll(statsTreeEn, n => n.props?.['data-testid'] === 'agy-cache-observation').length, 0);
  const statsTextEn = collectText(statsTreeEn);
  assert.equal(statsTextEn.includes('Cache window'), false);
  assert.equal(statsTextEn.includes('Cache watch'), false);
  assert.ok(statsTextEn.includes('98%'));

  p.context.__agyPowertools.dispose();
});

test('PR #102: refreshAccount skips quota.observe on pendingSwitchIgnored/syncSkipped and surfaces toast on credentialMismatch.afterSwitch', async () => {
  const p = page(true);
  const calls = [];
  const toasts = [];
  let syncReply = {
    activeId: 'acct-a',
    accounts: [{ id: 'acct-a', email: 'alpha@example.com', hasCredential: true }],
    pendingSwitchIgnored: true,
    syncSkipped: true
  };
  let capturedEnv = null;
  p.context.React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useEffect: fn => { fn(); }
  };
  const custLink = { isConnected: true, nextSibling: null, parentElement: { insertBefore(n) { n.isConnected = true; } } };
  p.document.querySelector = sel => sel === 'a[href="/customizations"]' ? custLink : null;
  p.context.ReactDOM = {
    createRoot: () => ({
      render(tree) { if (typeof tree?.type === 'function') tree.type(tree.props || {}); },
      unmount() {}
    })
  };
  p.context.um = () => payload => toasts.push(payload);
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({ email: 'alpha@example.com', name: 'Alpha' });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({
      response: {
        groups: [{
          displayName: 'Gemini Models',
          buckets: [{ bucketId: 'g-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0 }, resetTime: null }]
        }]
      }
    })
  });
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' });
      } else if (req.method === 'accounts.syncActive') {
        p.context.__agyPowertoolsReceive(req.id, syncReply);
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, activeId: 'acct-a', accounts: syncReply.accounts });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));
  assert.ok(capturedEnv);

  // 1. pendingSwitchIgnored / syncSkipped MUST skip quota.observe and autoSwitchCandidate
  const obsBefore = calls.filter(c => c.method === 'quota.observe').length;
  await capturedEnv.refreshAccountQuotas('acct-a');
  assert.equal(calls.filter(c => c.method === 'quota.observe').length, obsBefore);
  assert.equal(calls.some(c => c.method === 'accounts.autoSwitchCandidate'), false);

  // 2. syncSkipped alone also skips quota.observe
  syncReply = {
    activeId: 'acct-a',
    accounts: [{ id: 'acct-a', email: 'alpha@example.com', hasCredential: true }],
    syncSkipped: true
  };
  await capturedEnv.refreshAccountQuotas('acct-a');
  assert.equal(calls.filter(c => c.method === 'quota.observe').length, obsBefore);

  // 3. credentialMismatch.afterSwitch surfaces switch-mismatch toast and skips quota.observe
  toasts.length = 0;
  syncReply = {
    activeId: 'acct-a',
    accounts: [
      { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
      { id: 'acct-b', email: 'beta@example.com', hasCredential: false }
    ],
    credentialMismatch: { uiEmail: 'alpha@example.com', targetEmail: 'beta@example.com', afterSwitch: true }
  };
  await capturedEnv.refreshAccountQuotas('acct-a');
  assert.equal(calls.filter(c => c.method === 'quota.observe').length, obsBefore);
  const mismatchToast = toasts.find(t => t.tag === 'agy-account-switch-mismatch');
  assert.ok(mismatchToast);
  assert.doesNotMatch(mismatchToast.message, /[\u00b7\u2022\u2027\u30fb]/);

  p.context.__agyPowertools.dispose();
});

test('PR #102 & macOS direct-launch RPCs: native-host guards quota attribution and wires launcher.mac* handlers', async () => {
  const { mkdtempSync, writeFileSync, rmSync, readFileSync: readFs } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { startNativeIntegration } = await import('../lib/native-host.mjs');
  const dataDir = mkdtempSync(join(tmpdir(), 'agy-host-w2-'));
  const portFile = join(dataDir, 'port');
  const origin = 'https://127.0.0.1:5123';
  const fetchBefore = globalThis.fetch;
  let stop, receiveEvent, lastReply;
  const macCalls = [];
  let confirmed = '';
  const fakeAccounts = {
    list: () => ({ activeId: 'a1', accounts: [{ id: 'a1', email: 'a@example.com' }, { id: 'b1', email: 'b@example.com' }], vaultSupported: true }),
    confirmedQuotaEmail: () => confirmed,
    canRecordQuota: (email, { multiAccountEnabled = true } = {}) => {
      if (!multiAccountEnabled) return true;
      const clean = String(email || '').trim().toLowerCase();
      return Boolean(clean && confirmed && confirmed === clean);
    },
    clearConfirmedQuota: () => { confirmed = ''; },
    syncActive: snapshot => {
      if (snapshot?.email === 'pending@example.com') {
        confirmed = '';
        return { activeId: 'a1', accounts: [{ id: 'a1', email: 'a@example.com' }], confirmedQuotaEmail: '', canRecordQuota: false, pendingSwitchIgnored: true, syncSkipped: true };
      }
      confirmed = String(snapshot?.email || '').trim().toLowerCase();
      return { activeId: 'a1', accounts: [{ id: 'a1', email: confirmed }, { id: 'b1', email: 'b@example.com' }], confirmedQuotaEmail: confirmed, canRecordQuota: Boolean(confirmed) };
    },
    completeAdd: async () => {
      confirmed = '';
      return { ok: true, accountChanged: true, relaunching: true, account: { id: 'b1', email: 'b@example.com' }, activeId: 'b1', accounts: [{ id: 'a1', email: 'a@example.com' }, { id: 'b1', email: 'b@example.com' }] };
    },
    switchAccount: async () => {
      confirmed = '';
      return { ok: true, relaunching: true, account: { id: 'b1', email: 'b@example.com' }, activeId: 'b1', accounts: [{ id: 'a1', email: 'a@example.com' }, { id: 'b1', email: 'b@example.com' }] };
    }
  };
  try {
    writeFileSync(portFile, '12345\n');
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ enabled: true, multiAccount: true }));
    globalThis.fetch = async () => ({ json: async () => [{ id: 'w1', type: 'page', title: 'Antigravity', url: origin + '/c/a', webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/a' }] });
    stop = startNativeIntegration({
      portFile,
      dataDir,
      platform: 'darwin',
      home: '/Users/demo',
      accountsStore: fakeAccounts,
      macLauncher: {
        inspect: opts => { macCalls.push({ fn: 'inspect', opts }); return { supported: true, exists: false, cliCommand: 'node launch' }; },
        create: opts => { macCalls.push({ fn: 'create', opts }); return { ok: true, exists: true, appPath: '/Users/demo/Applications/Antigravity (Powertools).app' }; },
        remove: opts => { macCalls.push({ fn: 'remove', opts }); return { ok: true, removed: true, exists: false }; },
        reveal: opts => { macCalls.push({ fn: 'reveal', opts }); return { ok: true, revealed: true }; }
      },
      parseSessionData: () => ({}),
      onStatus: () => {},
      discover: async () => [],
      connect: async () => ({
        socket: { addEventListener() {}, close() {} },
        onEvent(cb) { receiveEvent = cb; },
        async send(method, params) {
          if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame' } } };
          if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script' };
          if (params?.expression?.startsWith('globalThis.__agyPowertoolsReceive?.(')) {
            vm.runInNewContext(params.expression, { __agyPowertoolsReceive: (_id, data) => { lastReply = JSON.parse(JSON.stringify(data)); } });
          }
          return { result: { value: false } };
        }
      })
    });
    await stop.ready;
    await receiveEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 7, origin, auxData: { isDefault: true, frameId: 'frame' } } } });
    const rpc = async (method, payload = {}) => {
      lastReply = null;
      await receiveEvent({ method: 'Runtime.bindingCalled', params: { name: '__agyPowertoolsHost', executionContextId: 7, payload: JSON.stringify({ id: 1, method, ...payload }) } });
      return lastReply;
    };

    // Unconfirmed account: dashboard & quota.observe & switch & completeAdd must NOT write timeline
    await rpc('dashboard', { accountKey: 'unconfirmed@example.com' });
    const obsSkipped = await rpc('quota.observe', { groups: [], accountKey: 'unconfirmed@example.com' });
    assert.equal(obsSkipped.skipped, true);
    await rpc('accounts.switch', { accountId: 'b1' });
    await rpc('accounts.completeAdd', { email: 'b@example.com' });
    await rpc('accounts.syncActive', { snapshot: { email: 'pending@example.com' } });
    let timelineExists = false;
    try { readFs(join(dataDir, 'account-timeline.json'), 'utf8'); timelineExists = true; } catch {}
    assert.equal(timelineExists, false);

    // Confirmed syncActive records quota timeline and allows quota.observe
    await rpc('accounts.syncActive', { snapshot: { email: 'a@example.com' } });
    const timeline = JSON.parse(readFs(join(dataDir, 'account-timeline.json'), 'utf8'));
    assert.equal(timeline.at(-1)?.email, 'a@example.com');
    const obsAllowed = await rpc('quota.observe', { groups: [], accountKey: 'a@example.com' });
    assert.equal(obsAllowed.skipped, undefined);

    // macOS direct-launch RPC handlers forward home, dataDir, pluginDir, platform, nodePath
    assert.equal((await rpc('launcher.macStatus')).exists, false);
    assert.equal((await rpc('launcher.macCreate')).exists, true);
    assert.equal((await rpc('launcher.macReveal')).revealed, true);
    assert.equal((await rpc('launcher.macRemove')).removed, true);
    assert.deepEqual(macCalls.map(c => c.fn), ['inspect', 'create', 'reveal', 'remove']);
    assert.equal(macCalls[0].opts.pluginDir, resolve('.'));
    assert.equal(macCalls[1].opts.nodePath, process.execPath);
    assert.equal(macCalls[1].opts.platform, 'darwin');
    assert.equal(macCalls[1].opts.home, '/Users/demo');
  } finally {
    await stop?.();
    globalThis.fetch = fetchBefore;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Settings macDirectLauncher row renders only on macOS, toggles Create vs Reveal+Delete, copies CLI, handles errors, and has zero middle dots', async () => {
  const panelsSrc = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  const i18nSrc = readFileSync(new URL('../lib/native-i18n.js', import.meta.url), 'utf8');
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type({ ...(node.props || {}), children: node.children }));
    return { ...node, children: Array.isArray(node.children) ? node.children.map(expand) : node.children };
  };
  const findByTestId = (node, tid) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const c of node) { const hit = findByTestId(c, tid); if (hit) return hit; } return null; }
    if (node.props?.['data-testid'] === tid) return node;
    return findByTestId(node.children, tid);
  };
  const collectText = node => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (!node || typeof node !== 'object') return '';
    if (Array.isArray(node)) return node.map(collectText).join(' ');
    return collectText(node.children);
  };

  const renderSettings = ({ platform, language = 'zh-CN', initialStatus = null, createFail = '', copiedOut = [] }) => {
    const states = new Map();
    let currentComp = null;
    let slotIdx = 0;
    let status = initialStatus;
    const calls = [];
    const ctx = vm.createContext({
      document: {
        head: { append() {} },
        createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
        createTreeWalker: () => ({ nextNode: () => null }),
        querySelectorAll: () => []
      },
      NodeFilter: { SHOW_TEXT: 4 },
      MutationObserver: class { observe() {} disconnect() {} },
      URL,
      window: { addEventListener() {}, removeEventListener() {} },
      navigator: {
        platform: platform === 'darwin' ? 'MacIntel' : platform === 'win32' ? 'Win32' : 'Linux x86_64',
        userAgent: '',
        clipboard: { writeText: async txt => { copiedOut.push(txt); } }
      },
      location: { pathname: '/powertools' },
      setTimeout: fn => { fn; return 1; },
      clearTimeout() {},
      __agyToZhTw: toZhTw,
      React: {
        Fragment: Symbol('Fragment'),
        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
        useId: () => 'id-mac',
        useState: init => {
          const key = `${currentComp}:${slotIdx++}`;
          if (!states.has(key)) states.set(key, typeof init === 'function' ? init() : init);
          return [states.get(key), next => { states.set(key, typeof next === 'function' ? next(states.get(key)) : next); }];
        },
        useEffect: fn => { fn(); },
        useRef: v => ({ current: v }),
        useMemo: fn => fn(),
        useCallback: fn => fn,
        useSyncExternalStore: (_, g) => g()
      },
      HC: ({ children }) => children,
      IC: ({ children }) => children,
      JC: ({ children }) => children,
      KC: ({ children }) => children,
      GC: ({ children }) => children,
      kT: ({ children }) => children,
      lT: ({ children }) => children,
      mT: ({ children }) => children,
      nT: ({ children }) => children,
      Uy: props => ({ type: 'button', props, children: props.children || [] }),
      XP: props => ({ type: 'switch', props, children: [] }),
      UP: props => ({ type: 'row', props, children: [props.label, props.description, props.rightElement, props.extraContent] }),
      TP: ({ children }) => ({ type: 'card', props: {}, children }),
      VP: ({ children }) => ({ type: 'section', props: {}, children }),
      dq: props => ({ type: 'icon', props, children: [] }),
      Sy: ({ children }) => children,
      Wz: ({ children }) => children
    });
    const prevExpand = expand;
    const expandStateful = node => {
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) return node.map(expandStateful);
      if (typeof node.type === 'function') {
        const prevComp = currentComp, prevSlot = slotIdx;
        currentComp = node.type.name || 'anon';
        slotIdx = 0;
        const out = node.type({ ...(node.props || {}), children: node.children });
        const res = expandStateful(out);
        currentComp = prevComp;
        slotIdx = prevSlot;
        return res;
      }
      return { ...node, children: Array.isArray(node.children) ? node.children.map(expandStateful) : node.children };
    };
    vm.runInContext(i18nSrc, ctx);
    vm.runInContext(panelsSrc, ctx);
    const panels = ctx.__agyPanels({
      adapter: { router: () => ({ navigate() {} }) },
      t: s => s,
      version: '2.16.11',
      platform,
      defaults: { enabled: true, language },
      project: { name: 'Agy Powertools', githubUrl: '', subscriptionUrl: '' },
      options: () => ({ enabled: true, language, macAutoRelaunch: true }),
      state: () => ({ contextWindow: { maxTokens: 1000000 } }),
      settingsError: () => '',
      proxyStatus: () => null,
      loadProxyStatus: async () => null,
      macDirectLauncher: () => status,
      refreshMacDirectLauncher: async () => { calls.push('refresh'); return status; },
      createMacDirectLauncher: async () => {
        calls.push('create');
        if (createFail) throw new Error(createFail);
        status = { supported: true, exists: true, cliCommand: 'node "$HOME/.gemini/config/plugins/agy-powertools/scripts/launch-macos.mjs"' };
        return status;
      },
      removeMacDirectLauncher: async () => {
        calls.push('remove');
        status = { supported: true, exists: false, cliCommand: 'node "$HOME/.gemini/config/plugins/agy-powertools/scripts/launch-macos.mjs"' };
        return status;
      },
      revealMacDirectLauncher: async () => { calls.push('reveal'); return { ok: true, revealed: true }; },
      change: async () => {},
      subscribe: () => () => {},
      revision: () => 0
    });
    const render = () => expandStateful({ type: panels.Settings, props: {}, children: [] });
    return { panels, render, calls, prevExpand };
  };

  // Hidden completely on Windows & Linux (including under System tab)
  for (const os of ['win32', 'linux']) {
    const view = renderSettings({ platform: os });
    let tree = view.render();
    findByTestId(tree, 'agy-settings-cat-system').props.onClick();
    tree = view.render();
    assert.equal(findByTestId(tree, 'agy-setting-row-macAutoRelaunch'), null);
    assert.equal(findByTestId(tree, 'agy-setting-row-macDirectLauncher'), null);
    view.panels.dispose();
  }

  // Shown on macOS under System tab: Create -> Reveal+Delete -> Delete -> Create, plus Copy CLI & zero middle dots
  const copied = [];
  const mac = renderSettings({
    platform: 'darwin',
    language: 'zh-CN',
    initialStatus: { supported: true, exists: false, cliCommand: 'node "$HOME/.gemini/config/plugins/agy-powertools/scripts/launch-macos.mjs"' },
    copiedOut: copied
  });
  let tree = mac.render();
  findByTestId(tree, 'agy-settings-cat-system').props.onClick();
  tree = mac.render();
  const row = findByTestId(tree, 'agy-setting-row-macDirectLauncher');
  assert.ok(row);
  assert.ok(findByTestId(tree, 'agy-setting-row-macAutoRelaunch'));
  const createBtn = findByTestId(row, 'agy-mac-launcher-create');
  const copyBtn = findByTestId(row, 'agy-mac-launcher-copy-cli');
  assert.ok(createBtn && copyBtn);
  assert.equal(findByTestId(row, 'agy-mac-launcher-reveal'), null);
  assert.equal(findByTestId(row, 'agy-mac-launcher-remove'), null);
  assert.doesNotMatch(collectText(row), /[\u00b7\u2022\u2027\u30fb]/);

  await createBtn.props.onClick();
  await new Promise(r => setImmediate(r));
  tree = mac.render();
  const rowAfterCreate = findByTestId(tree, 'agy-setting-row-macDirectLauncher');
  assert.equal(findByTestId(rowAfterCreate, 'agy-mac-launcher-create'), null);
  const revealBtn = findByTestId(rowAfterCreate, 'agy-mac-launcher-reveal');
  const removeBtn = findByTestId(rowAfterCreate, 'agy-mac-launcher-remove');
  const feedbackOk = findByTestId(rowAfterCreate, 'agy-mac-launcher-feedback');
  assert.ok(revealBtn && removeBtn && feedbackOk);
  assert.equal(feedbackOk.props['data-tone'], 'ok');
  assert.doesNotMatch(collectText(rowAfterCreate), /[\u00b7\u2022\u2027\u30fb]/);

  await revealBtn.props.onClick();
  await copyBtn.props.onClick();
  await new Promise(r => setImmediate(r));
  assert.equal(copied.at(-1), 'node "$HOME/.gemini/config/plugins/agy-powertools/scripts/launch-macos.mjs"');

  await removeBtn.props.onClick();
  await new Promise(r => setImmediate(r));
  tree = mac.render();
  assert.ok(findByTestId(tree, 'agy-mac-launcher-create'));
  assert.equal(findByTestId(tree, 'agy-mac-launcher-remove'), null);
  mac.panels.dispose();

  // Error handling surfaces inline error feedback cleanly
  const errMac = renderSettings({
    platform: 'darwin',
    language: 'en',
    initialStatus: { supported: true, exists: false, cliCommand: 'node launch-macos.mjs' },
    createFail: 'Antigravity.app was not found'
  });
  let errTree = errMac.render();
  findByTestId(errTree, 'agy-settings-cat-system').props.onClick();
  errTree = errMac.render();
  await findByTestId(errTree, 'agy-mac-launcher-create').props.onClick();
  await new Promise(r => setImmediate(r));
  errTree = errMac.render();
  const fbErr = findByTestId(errTree, 'agy-mac-launcher-feedback');
  assert.ok(fbErr);
  assert.equal(fbErr.props['data-tone'], 'error');
  assert.match(collectText(fbErr), /Antigravity\.app was not found/);
  assert.doesNotMatch(collectText(errTree), /[\u00b7\u2022\u2027\u30fb]/);
  errMac.panels.dispose();
});

test('duration carries >= 1h, tokens carry >= 1e9 to B and format zh 万/亿/萬/億, and moneyText converts USD/CNY live across SessionStatsDetails, ContextDetails, and ResponseTurnMeta', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-fmt';
  p.context.__agyToZhTw = toZhTw;
  let capturedEnv = null;
  const renderedByKind = new Map();
  p.context.React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useEffect() {},
    useSyncExternalStore: (_, getSnap) => getSnap()
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(el) { renderedByKind.set(mount.dataset.agyPowertoolsRoot, el); },
        unmount() {}
      };
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  p.context.HC = ({ children }) => ({ type: 'popover', props: {}, children });
  p.context.IC = ({ children }) => ({ type: 'trigger', props: {}, children });
  p.context.JC = props => ({ type: 'dialog', props, children: props.children || [] });
  p.context.Uy = props => ({ type: 'button', props, children: props.children || [] });
  p.context.k0 = props => ({ type: 'disclosure', props, children: [props.trigger, ...(props.children || [])] });
  p.context.Sy = props => ({ type: 'tooltip', props, children: props.children || [] });
  p.context.dq = props => ({ type: 'icon', props, children: [] });
  p.context.HU = m => m?.stepIndex;
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.composerCascadeId = () => 'conv-fmt';
  p.context.__agyPanels = env => { capturedEnv = env; return { Page: () => null, Sidebar: () => null, dispose() {} }; };

  const parent = { insertBefore(child) { child.isConnected = true; } };
  const trigger = { isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? {} : null };
  const feedbackBtn = { parentElement: { insertBefore(child) { child.isConnected = true; } } };
  const responseEl = {
    isConnected: true,
    firstChild: null,
    children: [],
    insertBefore(child) { child.isConnected = true; },
    closest: sel => sel === '[data-turn-content]' ? {
      querySelector: s => s === '[aria-label="Bad response"]' ? feedbackBtn : null,
      querySelectorAll: () => []
    } : null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  p.context.__agyNativeAdapter.fiber = el => el === responseEl ? { memoizedProps: { container: { steps: [{ step: { case: 'userInput' }, metadata: { stepIndex: 1 } }] } }, return: null } : null;
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [trigger];
    if (sel === '[data-testid="agent-response"]') return [responseEl];
    return [];
  };

  let stored = { enabled: true, contextRing: true, speedStats: true, timing: true, turnMeta: true, language: 'zh-CN', tokenUnit: 'compact', currency: 'USD' };
  let serverFxRate;
  const sampleState = {
    conversationId: 'conv-fmt',
    modelName: 'Gemini 4 Carbon',
    costUsd: 10.5,
    contextWindow: {
      usedPercent: 24,
      usedTokens: 237700,
      maxTokens: 1000000,
      inputTokens: 8540,
      cacheReadTokens: 229160,
      categories: [
        { key: 'msgs', label: 'Chat Messages', tokens: 237700, percent: 23.8 },
        { key: 'free', label: '剩余空间', tokens: 762300, percent: 76.2 }
      ]
    },
    telemetry: {
      turnCount: 3,
      stepCount: 20,
      totalTokens: 1183000000,
      inputTokens: 14210000,
      cacheReadTokens: 237700,
      outputTokens: 8540,
      thinkingTokens: 381,
      requestCount: 12,
      errorCount: 0,
      toolCount: 6,
      tps: 54,
      peakTps: 88,
      latestTps: 60,
      cacheHitPercent: 92,
      modelTimeMs: 78798000,
      toolTimeMs: 125000,
      avgTtftMs: 42000
    },
    turns: [{
      turnNumber: 1,
      status: 'done',
      stepIndexStart: 1,
      stepIndexEnd: 5,
      durationMs: 78798000,
      completedAtIso: '2026-11-27T10:00:00Z',
      toolCalls: [],
      toolGroups: [],
      modelName: 'Gemini 4 Carbon',
      shortModel: 'Carbon',
      newInputTokens: 8540,
      cacheReadTokens: 229160,
      totalInputTokens: 237700,
      outputTokens: 15000,
      thinkingTokens: 0,
      cacheHitPercent: 96,
      requestCount: 2,
      tps: 58,
      costUsd: 0.0008
    }],
    requests: [],
    errors: []
  };

  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { ...stored });
      else if (req.method === 'settings.set') { stored = { ...stored, ...req.settings }; p.context.__agyPowertoolsReceive(req.id, { ...stored }); }
      else if (req.method === 'state') {
        const reply = JSON.parse(JSON.stringify(sampleState));
        if (serverFxRate != null) reply.fxRate = serverFxRate;
        p.context.__agyPowertoolsReceive(req.id, reply);
      }
      else p.context.__agyPowertoolsReceive(req.id, { ok: true });
    });
  };
  p.context.__agyInitialSettings = { ...stored };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 25));

  const collectText = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(collectText).join(' ');
    if (typeof node === 'object') {
      if (typeof node.type === 'function') return collectText(node.type({ ...(node.props || {}), children: node.children }));
      return collectText(node.children);
    }
    return '';
  };

  // 1. Default zh-CN + compact + USD: hours carry, >=1e9 carries to B, USD formatted
  let ringText = collectText(renderedByKind.get('ring'));
  let compText = collectText(renderedByKind.get('completion'));
  let metaText = collectText(renderedByKind.get('turn-meta'));
  assert.match(ringText, /1\.18B/);
  assert.match(ringText, /14\.2M/);
  assert.match(ringText, /237\.7k/);
  assert.match(ringText, /\$10\.50/);
  assert.match(ringText, /21小时53分18秒/);
  assert.match(ringText, /2分5秒/);
  assert.match(ringText, /42秒/);
  assert.match(compText, /用时 21小时53分18秒/);
  assert.match(metaText, /\$0\.0008/);
  assert.doesNotMatch(`${ringText} ${compText} ${metaText}`, /[\u00b7\u2022\u2027\u30fb]/);

  // 2. Switch to zh-CN + zh units + CNY with absent live FX rate -> uses silent 6.7 fallback
  assert.equal(capturedEnv.fxRate(), 6.7);
  await capturedEnv.change({ tokenUnit: 'zh', currency: 'CNY' });
  ringText = collectText(renderedByKind.get('ring'));
  metaText = collectText(renderedByKind.get('turn-meta'));
  assert.match(ringText, /11\.83亿/);
  assert.match(ringText, /1421万/);
  assert.match(ringText, /23\.77万 \/ 100万/);
  assert.match(ringText, /\b8540\b/);
  assert.match(ringText, /\b381\b/);
  assert.match(ringText, /¥70\.35/);
  assert.match(metaText, /23\.77万/);
  assert.match(metaText, /1\.5万/);
  assert.match(metaText, /¥0\.0054/);
  assert.doesNotMatch(`${ringText} ${metaText}`, /[\u00b7\u2022\u2027\u30fb]/);

  // 2b. Live FX broadcast (7.5) updates rendered CNY prices silently and instantaneously
  p.context.__agyPowertoolsSetFxRate(7.5);
  assert.equal(capturedEnv.fxRate(), 7.5);
  ringText = collectText(renderedByKind.get('ring'));
  metaText = collectText(renderedByKind.get('turn-meta'));
  assert.match(ringText, /¥78\.75/);
  assert.match(metaText, /¥0\.0060/);

  // 3. Switch to zh-TW + zh units + CNY with state-delivered live FX rate 7.2: Traditional 小時 / 億 / 萬
  serverFxRate = 7.2;
  await capturedEnv.change({ language: 'zh-TW' });
  await capturedEnv.refreshState();
  assert.equal(capturedEnv.fxRate(), 7.2);
  ringText = collectText(renderedByKind.get('ring'));
  compText = collectText(renderedByKind.get('completion'));
  assert.match(ringText, /21小時53分18秒/);
  assert.match(ringText, /11\.83億/);
  assert.match(ringText, /23\.77萬 \/ 100萬/);
  assert.match(ringText, /¥75\.60/);
  assert.match(compText, /21小時53分18秒/);

  // 4. Switch to en + compact + USD: 21h 53m 18s / 2m 5s / 42s / 1.18B / $10.50
  await capturedEnv.change({ language: 'en', tokenUnit: 'compact', currency: 'USD' });
  ringText = collectText(renderedByKind.get('ring'));
  compText = collectText(renderedByKind.get('completion'));
  assert.match(ringText, /21h 53m 18s/);
  assert.match(ringText, /2m 5s/);
  assert.match(ringText, /42s/);
  assert.match(ringText, /1\.18B/);
  assert.match(ringText, /\$10\.50/);
  assert.match(compText, /Worked for 21h 53m 18s/);
  p.context.__agyPowertools.dispose();
});

test('QuickPopover keeps full 940px width when space remains on the left and tracks anchor space across resizes', () => {
  const panelsCode = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  const styles = [];
  const states = [];
  const effects = [];
  const resizeObservers = [];
  const rootProps = new Map();
  const winListeners = new Map();
  let setPropCalls = 0;
  let stateIdx = 0;
  let quickEnabled = true;

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useId: () => 'qp-tip-1',
    useState: init => {
      const i = stateIdx++;
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
      return [states[i], val => { states[i] = typeof val === 'function' ? val(states[i]) : val; }];
    },
    useEffect: (fn, deps) => { effects.push({ fn, deps }); },
    useLayoutEffect: (fn, deps) => { effects.push({ fn, deps }); },
    useSyncExternalStore: (_, getSnap) => getSnap()
  };

  let innerWidth = 1024;
  let anchorRect = { left: 955, right: 983, top: 38, bottom: 66, width: 28, height: 28 };
  let anchorConnected = true;
  const anchorEl = {
    get isConnected() { return anchorConnected; },
    getBoundingClientRect: () => anchorRect,
    closest: () => null,
    parentElement: null
  };

  const ctx = vm.createContext({
    React,
    Intl,
    URL,
    ResizeObserver: class MockResizeObserver {
      constructor(cb) {
        this.cb = cb;
        this.observed = [];
        this.disconnected = false;
        resizeObservers.push(this);
      }
      observe(el) { this.observed.push(el); }
      disconnect() { this.disconnected = true; }
      trigger() { this.cb([], this); }
    },
    get innerWidth() { return innerWidth; },
    window: {
      addEventListener: (type, fn) => {
        if (!winListeners.has(type)) winListeners.set(type, new Set());
        winListeners.get(type).add(fn);
      },
      removeEventListener: (type, fn) => {
        winListeners.get(type)?.delete(fn);
      }
    },
    document: {
      createElement: tag => ({ tagName: tag, dataset: {}, textContent: '', remove() {} }),
      head: { append: node => styles.push(node) },
      body: { nodeName: 'BODY' },
      documentElement: {
        style: {
          getPropertyValue: name => rootProps.get(name) || '',
          setProperty: (name, value) => { setPropCalls++; rootProps.set(name, String(value)); },
          removeProperty: name => { rootProps.delete(name); }
        }
      }
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    __agyDashboard: {
      dateRange: () => ({ preset: 'weeklyQuota', start: 0, end: 1, activePools: [], status: 'unstarted' }),
      summarizeRequests: () => ({ requests: [], success: 0, errors: 0, tokens: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, cost: 0, priced: 0, points: [], models: [] }),
      distributionModels: () => [],
      subscriptionIdentity: () => ({ family: 'pro', style: 'pro', label: 'Pro' }),
      annotateCacheAnomalies: () => new Map()
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    Uy: 'button',
    Sy: 'tooltip',
    dq: ({ name }) => ({ type: 'icon', props: { name }, children: [] }),
    HC: ({ children, ...p }) => React.createElement('popover', p, ...(Array.isArray(children) ? children : [children])),
    IC: ({ children, ...p }) => React.createElement('popover-trigger', p, ...(Array.isArray(children) ? children : [children])),
    JC: ({ children, ...p }) => React.createElement('popover-content', p, ...(Array.isArray(children) ? children : [children])),
    VP: 'section',
    TP: 'card',
    UP: 'row',
    XP: 'switch'
  });

  vm.runInContext(panelsCode, ctx);
  const panels = ctx.__agyPanels({
    t: v => v,
    options: () => ({ enabled: true, titlebarQuickPanel: quickEnabled, language: 'zh-CN' }),
    dashboard: () => null,
    loadDashboard: () => Promise.resolve(null),
    loadProxyStatus: () => Promise.resolve(null),
    subscribe: () => () => {},
    revision: () => 0,
    capabilities: () => ({ models: [] })
  });

  const css = styles[0].textContent;
  assert.doesNotMatch(css, /\.pt-qp-pop\{[^}]*64vw/);
  assert.match(css, /\.pt-qp-pop\{[^}]*width:min\(940px,var\(--pt-qp-max-w,calc\(100vw - 24px\)\)\)!important;max-width:calc\(100vw - 24px\)!important;/);

  const renderAndRunEffects = () => {
    stateIdx = 0;
    effects.length = 0;
    const tree = panels.QuickPopover();
    if (tree?.props?.ref) tree.props.ref(anchorEl);
    const cleanups = effects.map(e => e.fn()).filter(fn => typeof fn === 'function');
    return { tree, cleanups };
  };

  // Closed by default: no width variable or resize listener active
  let pass = renderAndRunEffects();
  assert.equal(rootProps.has('--pt-qp-max-w'), false);
  assert.equal(winListeners.get('resize')?.size || 0, 0);

  // Opening at 1024px window keeps 971px available width so min(940px, 971px) stays at full 940px
  pass.tree.children[0].props.onOpenChange(true);
  assert.equal(rootProps.get('--pt-qp-max-w'), '971px');
  for (const fn of pass.cleanups) fn();
  pass = renderAndRunEffects();
  assert.equal(rootProps.get('--pt-qp-max-w'), '971px');
  assert.equal(winListeners.get('resize')?.size, 1);

  // Redundant trigger at same dimensions avoids duplicate setProperty writes
  const callsBeforeSameSize = setPropCalls;
  resizeObservers.at(-1).trigger();
  assert.equal(setPropCalls, callsBeforeSameSize);

  // Shrinking to 960px (half-screen) caps to 907px (rect.right - 12px left margin) rather than 64vw (614px)
  innerWidth = 960;
  anchorRect = { left: 891, right: 919, top: 38, bottom: 66, width: 28, height: 28 };
  for (const fn of winListeners.get('resize')) fn();
  assert.equal(rootProps.get('--pt-qp-max-w'), '907px');

  // Expanding back to wide 1728px updates available width to 1674px (so min(940px, 1674px) returns to 940px)
  innerWidth = 1728;
  anchorRect = { left: 1658, right: 1686, top: 38, bottom: 66, width: 28, height: 28 };
  resizeObservers.at(-1).trigger();
  assert.equal(rootProps.get('--pt-qp-max-w'), '1674px');

  // Left-half anchor edge case prefers larger right-side space instead of collapsing against left margin
  innerWidth = 1000;
  anchorRect = { left: 20, right: 48, top: 38, bottom: 66, width: 28, height: 28 };
  resizeObservers.at(-1).trigger();
  assert.equal(rootProps.get('--pt-qp-max-w'), '968px');

  // Disconnected or zero-size anchor skips overwriting
  anchorRect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  resizeObservers.at(-1).trigger();
  assert.equal(rootProps.get('--pt-qp-max-w'), '968px');
  anchorConnected = false;
  anchorRect = { left: 955, right: 983, top: 38, bottom: 66, width: 28, height: 28 };
  resizeObservers.at(-1).trigger();
  assert.equal(rootProps.get('--pt-qp-max-w'), '968px');

  // Closing cleans up --pt-qp-max-w, listeners, and observers
  anchorConnected = true;
  pass.tree.children[0].props.onOpenChange(false);
  for (const fn of pass.cleanups) fn();
  pass = renderAndRunEffects();
  assert.equal(rootProps.has('--pt-qp-max-w'), false);
  assert.equal(winListeners.get('resize')?.size || 0, 0);
  assert.equal(resizeObservers.every(ro => ro.disconnected), true);

  // Disabling titlebarQuickPanel while open clears --pt-qp-max-w
  pass.tree.children[0].props.onOpenChange(true);
  for (const fn of pass.cleanups) fn();
  pass = renderAndRunEffects();
  assert.equal(rootProps.get('--pt-qp-max-w'), '971px');
  quickEnabled = false;
  for (const fn of pass.cleanups) fn();
  pass = renderAndRunEffects();
  assert.equal(rootProps.has('--pt-qp-max-w'), false);

  // Disposing panels while open also clears --pt-qp-max-w
  quickEnabled = true;
  for (const fn of pass.cleanups) fn();
  pass = renderAndRunEffects();
  assert.equal(rootProps.get('--pt-qp-max-w'), '971px');
  panels.dispose();
  assert.equal(rootProps.has('--pt-qp-max-w'), false);
});

test('sessionDuration composer badge, per-subagent duration breakdown, and Overview subagent row badge sub-toggles render cleanly without middle dots', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-dur';
  p.context.__agyToZhTw = toZhTw;
  const renderedByKind = new Map();
  let openedSubId = '';
  p.context.React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false) }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect() {},
    useSyncExternalStore: (_, getSnap) => getSnap()
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(el) { renderedByKind.set(`${mount.dataset.agyPowertoolsRoot}:${renderedByKind.size}`, { kind: mount.dataset.agyPowertoolsRoot, el }); renderedByKind.set(mount.dataset.agyPowertoolsRoot, el); },
        unmount() {}
      };
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  p.context.HC = ({ children }) => ({ type: 'popover', props: {}, children });
  p.context.IC = ({ children }) => ({ type: 'trigger', props: {}, children });
  p.context.JC = props => ({ type: 'dialog', props, children: props.children || [] });
  p.context.Uy = props => ({ type: 'button', props, children: props.children || [] });
  p.context.k0 = props => ({ type: 'disclosure', props, children: [props.trigger, ...(props.children || [])] });
  p.context.Sy = props => ({ type: 'tooltip', props, children: props.children || [] });
  p.context.dq = props => ({ type: 'icon', props, children: [] });
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.composerCascadeId = () => 'conv-dur';
  p.context.__agyNativeAdapter.openSubagent = id => { openedSubId = id; return true; };
  p.context.__agyNativeAdapter.subagents = cid => cid === 'conv-dur' ? [{
    id: 'sub-worker-1',
    parentId: 'conv-dur',
    depth: 1,
    typeName: 'browser',
    role: 'UI Verifier',
    title: 'UI Verifier',
    status: 'done',
    stepCount: 8,
    createdAtMs: 1_700_000_010_000,
    lastModifiedAtMs: 1_700_000_310_000
  }] : [];
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });

  const parent = { insertBefore(child) { child.isConnected = true; } };
  const trigger = { isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? {} : null };
  const subNode = { isConnected: true, dataset: { cascadeId: 'sub-worker-1' }, textContent: 'UI Verifier', append(c) { c.isConnected = true; }, insertBefore(c) { c.isConnected = true; } };
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [trigger];
    if (sel.includes('subagent-node')) return [subNode];
    return [];
  };

  const stored = {
    enabled: true,
    contextRing: true,
    speedStats: true,
    sessionDuration: true,
    subagentTelemetry: true,
    subagentBadgeContext: true,
    subagentBadgeDuration: true,
    subagentBadgeTokens: false,
    subagentBadgeModel: true,
    language: 'zh-CN'
  };
  const mainState = {
    conversationId: 'conv-dur',
    modelName: 'Gemini 4 Carbon',
    costUsd: 0.42,
    contextWindow: { usedPercent: 32.1, usedTokens: 160000, maxTokens: 500000, categories: [] },
    telemetry: {
      turnCount: 3,
      stepCount: 24,
      totalTokens: 180000,
      inputTokens: 30000,
      cacheReadTokens: 140000,
      outputTokens: 10000,
      cacheHitPercent: 82.4,
      requestCount: 6,
      errorCount: 0,
      toolCount: 8,
      tps: 55.5,
      latestTps: 58.2,
      avgTtftMs: 1400,
      modelTimeMs: 42000,
      toolTimeMs: 28000,
      workedDurationMs: 95000,
      completedWorkedDurationMs: 95000,
      sessionSpanMs: 620000,
      startedAtMs: 1_700_000_000_000,
      activeStartedAtMs: null
    },
    turns: [],
    requests: [],
    errors: [],
    progress: { status: 'complete', elapsedMs: 35000 }
  };

  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { ...stored });
      else if (req.method === 'state') p.context.__agyPowertoolsReceive(req.id, JSON.parse(JSON.stringify(mainState)));
      else if (req.method === 'subagents.stats') {
        p.context.__agyPowertoolsReceive(req.id, {
          items: {
            'sub-worker-1': {
              conversationId: 'sub-worker-1',
              modelName: 'Gemini 3.8 Flash',
              shortModel: '3.8 Flash',
              costUsd: 0.05,
              contextWindow: { usedPercent: 12.4, usedTokens: 62000, maxTokens: 500000, categories: [] },
              telemetry: {
                stepCount: 8,
                requestCount: 3,
                totalTokens: 45000,
                inputTokens: 15000,
                cacheReadTokens: 28000,
                outputTokens: 2000,
                cacheHitPercent: 65.1,
                toolCount: 4,
                modelTimeMs: 12000,
                toolTimeMs: 18000,
                workedDurationMs: 38000,
                completedWorkedDurationMs: 15000,
                sessionSpanMs: 300000
              }
            }
          }
        });
      } else p.context.__agyPowertoolsReceive(req.id, { ok: true });
    });
  };
  p.context.__agyInitialSettings = { ...stored };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 25));

  const evalNode = node => {
    if (node == null || typeof node === 'boolean') return null;
    if (Array.isArray(node)) return node.map(evalNode).filter(Boolean);
    if (typeof node === 'object') {
      if (typeof node.type === 'function') return evalNode(node.type({ ...(node.props || {}), children: node.children }));
      return { ...node, children: (node.children || []).map(evalNode).flat().filter(Boolean) };
    }
    return node;
  };
  const findTestId = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) { const hit = findTestId(item, id); if (hit) return hit; }
      return null;
    }
    if (node.props?.['data-testid'] === id) return node;
    for (const c of node.children || []) {
      const hit = findTestId(c, id);
      if (hit) return hit;
    }
    return null;
  };
  const collectText = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(collectText).join(' ');
    if (typeof node === 'object') return collectText(node.children);
    return '';
  };

  const ringTree = evalNode(renderedByKind.get('ring'));
  const durTrigger = findTestId(ringTree, 'agy-session-duration-trigger');
  assert.ok(durTrigger, 'expected composer session duration trigger');
  assert.match(collectText(durTrigger), /1m 35s/);

  const durPopup = findTestId(ringTree, 'agy-session-duration-details');
  assert.ok(durPopup, 'expected session duration breakdown popover');
  const popupText = collectText(durPopup);
  assert.match(popupText, /1分35秒/);
  assert.match(popupText, /10分20秒/);
  assert.doesNotMatch(popupText, /[\u00b7\u2022\u2027\u30fb]/);

  const subRowBtn = findTestId(durPopup, 'agy-session-duration-sub-sub-worker-1');
  assert.ok(subRowBtn, 'expected clickable subagent duration row');
  assert.equal(subRowBtn.props['data-pt-tip'], undefined, 'subagent button itself must not carry data-pt-tip');
  assert.match(collectText(subRowBtn), /38秒/);
  assert.match(collectText(subRowBtn), /5m 0s/);
  subRowBtn.props.onClick();
  assert.equal(openedSubId, 'sub-worker-1');

  const badgeTree = evalNode(renderedByKind.get('subagent-badge'));
  const subBadge = findTestId(badgeTree, 'agy-subagent-badge');
  assert.ok(subBadge, 'expected Overview subagent badge');
  assert.ok(findTestId(subBadge, 'agy-subagent-badge-duration'), 'expected duration chip on Overview subagent badge');
  assert.match(collectText(findTestId(subBadge, 'agy-subagent-badge-duration')), /38s/);
  assert.equal(findTestId(subBadge, 'agy-subagent-badge-tokens'), null, 'tokens chip must stay hidden when subagentBadgeTokens is false');

  p.context.__agyPowertools.dispose();
});
