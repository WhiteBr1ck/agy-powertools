import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { aggregateSubagentTotals, estimateRequestsCost, shortSubagentModel, summarizeSubagentSession } from '../lib/subagents.mjs';
import { parseSessionData } from '../sidecars/inspector/main.mjs';

test('shortSubagentModel, summarizeSubagentSession, and aggregateSubagentTotals compute accurate subagent metrics', () => {
  assert.equal(shortSubagentModel('Gemini 4 Hydrogen (High)'), 'Hydrogen');
  assert.equal(shortSubagentModel('Gemini 4 Neon (XHigh)'), 'Neon');
  assert.equal(shortSubagentModel('Gemini 4 Krypton (High)'), 'Krypton');
  assert.equal(shortSubagentModel('Gemini 5 Nova'), 'Nova');
  assert.equal(shortSubagentModel('Gemini 3.8 Flash (High)'), '3.8 Flash');
  assert.equal(shortSubagentModel('gemini-3.8-flash'), '3.8 Flash');
  assert.equal(shortSubagentModel('Gemini 4.5 Flash Lite'), '4.5 Flash Lite');
  assert.equal(shortSubagentModel('Gemini 3.1 Pro (Medium)'), '3.1 Pro');
  assert.equal(shortSubagentModel('Claude Sonnet 4.5 (Thinking)'), 'Sonnet 4.5');
  assert.equal(shortSubagentModel('Orchestrator (Argon)'), 'Orchestrator');
  assert.equal(shortSubagentModel('DeepSeek R2 (High)'), 'DeepSeek R2');
  assert.equal(shortSubagentModel('未知模型'), '');

  const rates = [
    { model: 'gemini-4-hydrogen', input: 0.5, output: 3, cache: 0.05 },
    { model: 'gemini-4-neon', input: 3, output: 15, cache: 0.15 }
  ];
  assert.ok(estimateRequestsCost([{ model: 'Gemini 4 Neon (High)', inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }], rates) === 3);
  assert.equal(estimateRequestsCost([], rates), 0);
  assert.equal(estimateRequestsCost([{ model: 'unknown-model', inputTokens: 1000, outputTokens: 100 }], rates), null);
  const s1 = summarizeSubagentSession({
    conversationId: 'sub-1',
    modelName: 'Gemini 4 Hydrogen (High)',
    contextWindow: { usedTokens: 25600, maxTokens: 512000, usedPercent: 5, categories: [] },
    telemetry: { totalTokens: 78500, inputTokens: 25600, cacheReadTokens: 49150, outputTokens: 3750, cacheHitPercent: 65.7, requestCount: 4, errorCount: 0, toolCount: 3, tps: 54.8 },
    requests: [{ model: 'Gemini 4 Hydrogen (High)', inputTokens: 25600, cacheReadTokens: 49150, outputTokens: 3750 }]
  }, rates);
  assert.equal(s1.shortModel, 'Hydrogen');
  assert.ok(s1.costUsd > 0.02 && s1.costUsd < 0.03);

  const s2 = summarizeSubagentSession({
    conversationId: 'sub-2',
    modelName: 'Gemini 4 Neon (High)',
    contextWindow: { usedTokens: 12000, maxTokens: 1000000, usedPercent: 1.2, categories: [] },
    telemetry: { totalTokens: 21000, inputTokens: 10000, cacheReadTokens: 10000, outputTokens: 1000, cacheHitPercent: 50, requestCount: 2, errorCount: 1, toolCount: 2, tps: 42 },
    requests: [{ model: 'Gemini 4 Neon (High)', inputTokens: 10000, cacheReadTokens: 10000, outputTokens: 1000 }]
  }, rates);

  const totals = aggregateSubagentTotals([s1, s2]);
  assert.equal(totals.count, 2);
  assert.equal(totals.totalTokens, 99500);
  assert.equal(totals.requestCount, 6);
  assert.equal(totals.errorCount, 1);
  assert.equal(totals.toolCount, 5);
  assert.equal(totals.cacheHitPercent, 62.4);
  assert.ok(totals.costUsd > s1.costUsd);
});

test('parseSessionData aggregates tokens, cache hit rate, and tool count for SYSTEM_MESSAGE-rooted subagents', () => {
  const appData = mkdtempSync(join(tmpdir(), 'agy-subagent-parse-'));
  const prevDir = process.env.ANTIGRAVITY_APP_DATA_DIR;
  process.env.ANTIGRAVITY_APP_DATA_DIR = appData;
  try {
    const subId = 'subagent-001';
    const logsDir = join(appData, 'brain', subId, '.system_generated', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const lines = [
      { step_index: 0, type: 'SYSTEM_MESSAGE', content: 'You are a browser subagent', created_at: '2026-11-21T00:00:00Z' },
      { step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 10000, cache_read_tokens: 0, output_tokens: 500, tool_calls: [{ name: 'webview_browser', args: {} }], created_at: '2026-11-21T00:00:01Z' },
      { step_index: 2, type: 'GENERIC', content: 'Created At: 2026-11-21T00:00:02Z\nCompleted At: 2026-11-21T00:00:05Z\npage loaded', created_at: '2026-11-21T00:00:02Z' },
      { step_index: 3, type: 'PLANNER_RESPONSE', input_tokens: 5000, cache_read_tokens: 10000, output_tokens: 300, tool_calls: [{ name: 'send_message', args: {} }], created_at: '2026-11-21T00:00:06Z' },
      { step_index: 4, type: 'GENERIC', content: 'Created At: 2026-11-21T00:00:07Z\nCompleted At: 2026-11-21T00:00:08Z\nsent', created_at: '2026-11-21T00:00:07Z' }
    ];
    writeFileSync(join(logsDir, 'transcript.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const parsed = parseSessionData(subId, { includeSessions: false, strict: true });
    assert.equal(parsed.conversationId, subId);
    assert.equal(parsed.turns.length, 0);
    assert.equal(parsed.telemetry.stepCount, 5);
    assert.equal(parsed.telemetry.inputTokens, 15000);
    assert.equal(parsed.telemetry.cacheReadTokens, 10000);
    assert.equal(parsed.telemetry.outputTokens, 800);
    assert.equal(parsed.telemetry.totalTokens, 25800);
    assert.equal(parsed.telemetry.cacheHitPercent, 40);
    assert.equal(parsed.telemetry.toolCount, 2);
    assert.equal(parsed.telemetry.toolTimeMs, 4000);
  } finally {
    if (prevDir === undefined) delete process.env.ANTIGRAVITY_APP_DATA_DIR;
    else process.env.ANTIGRAVITY_APP_DATA_DIR = prevDir;
    rmSync(appData, { recursive: true, force: true });
  }
});

test('native-client subagents helper collects direct and nested subagents and clicks native subagent-node on openSubagent', () => {
  let clickedId = '';
  const summaries = {
    'main-1': { status: 1, stepCount: 10, trajectoryMetadata: { parentConversationId: '', rootConversationId: 'main-1', nestingDepth: 0 } },
    'sub-a': { status: 2, killed: false, stepCount: 6, summary: 'Browse page', trajectoryMetadata: { parentConversationId: 'main-1', rootConversationId: 'main-1', nestingDepth: 1, createdAt: { seconds: '200' }, subagentSpec: { typeName: 'browser', role: 'X Post Reader' } } },
    'sub-b': { status: 1, killed: true, stepCount: 4, summary: 'Child worker', trajectoryMetadata: { parentConversationId: 'sub-a', rootConversationId: '', nestingDepth: 2, createdAt: { seconds: '250' }, subagentSpec: { typeName: 'research', role: 'Doc Scanner' } } },
    'other-sub': { status: 1, stepCount: 2, trajectoryMetadata: { parentConversationId: 'main-2', rootConversationId: 'main-2', nestingDepth: 1 } }
  };
  const nodeA = { dataset: { cascadeId: 'sub-a' }, click() { clickedId = 'sub-a'; } };
  const store = { getState: () => ({ trajectorySummaries: { summaries } }), dispatch() {} };
  const rootEl = { '__reactFiber$fixture': { tag: 10, type: {}, memoizedProps: { value: { store } }, return: null } };
  const ctx = vm.createContext({
    document: {
      querySelector: () => rootEl,
      querySelectorAll: sel => sel.includes('subagent-node') ? [nodeA] : []
    }
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), ctx);
  const adapter = ctx.__agyNativeAdapter;

  const list = adapter.subagents('main-1');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'sub-a');
  assert.equal(list[0].title, 'X Post Reader');
  assert.equal(list[0].status, 'running');
  assert.equal(list[1].id, 'sub-b');
  assert.equal(list[1].depth, 2);
  assert.equal(list[1].status, 'killed');

  assert.equal(adapter.openSubagent('sub-a'), true);
  assert.equal(clickedId, 'sub-a');
});

test('subagent stats sync prioritizes open composer, visible DOM nodes, and running workers beyond 32 subagents with incremental batching', async () => {
  const uiCode = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');
  const hostCode = readFileSync(new URL('../lib/native-host.mjs', import.meta.url), 'utf8');
  const sshCode = readFileSync(new URL('../lib/ssh-remote.mjs', import.meta.url), 'utf8');
  // Verify backend batch caps were lifted to 64
  assert.equal(hostCode.includes('.slice(0, 64)'), true);
  assert.equal(sshCode.includes('.slice(0, 64)'), true);

  // Build 75 subagents where oldest 0..31 are done, 68..74 are newest (including running #70 and open composer #74)
  const total = 75;
  const subList = Array.from({ length: total }, (_, i) => ({
    id: `sub-${String(i).padStart(3, '0')}`,
    parentId: 'conv-root',
    depth: 1,
    typeName: 'swarm',
    role: `Swarm Worker (worker-${i})`,
    title: `Swarm Worker (worker-${i})`,
    status: i === 70 ? 'running' : i >= 71 ? 'killed' : 'done',
    stepCount: 10 + i,
    createdAtMs: 1_700_000_000_000 + i * 1000,
    lastModifiedAtMs: 1_700_000_000_000 + i * 1000
  }));
  const makeEl = () => ({ dataset: {}, style: { setProperty() {}, removeProperty() {} }, className: '', isConnected: true, remove() {}, append() {}, insertBefore() {}, querySelector: () => null, querySelectorAll: () => [] });
  const domNodes = [subList[70], subList[71], subList[72], subList[73]].map(s => ({ ...makeEl(), dataset: { cascadeId: s.id }, textContent: s.title }));
  const composerCards = [{
    ...makeEl(),
    __cascadeId: subList[74].id
  }];

  const fetchedBatches = [];
  const scheduled = [];
  const ctx = vm.createContext({
    console,
    setTimeout: fn => { scheduled.push(fn); return scheduled.length; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    AbortController,
    location: { pathname: '/c/conv-root' },
    React: {
      createElement: () => null,
      Fragment: 'fragment',
      useSyncExternalStore: (_, g) => g(),
      Component: class {}
    },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    HC: () => null,
    IC: () => null,
    JC: () => null,
    Uy: () => null,
    MutationObserver: class { observe() {} disconnect() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    document: {
      head: { append() {} },
      body: { append() {} },
      documentElement: { setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
      title: '',
      querySelector: () => null,
      querySelectorAll: sel => {
        if (sel.includes('subagent-node')) return domNodes;
        if (sel.includes('surface-composer-card')) return composerCards;
        return [];
      },
      createElement: () => makeEl(),
      addEventListener() {}
    },
    __agyInitialSettings: { enabled: true, subagentTelemetry: true },
    __agyNativeAdapter: {
      subagents: cid => cid === 'conv-root' ? subList : [],
      composerCascadeId: card => card.__cascadeId || '',
      wrap: el => el,
      executionState: () => null,
      capabilities: () => ({}),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      if (msg.method === 'settings.get') {
        ctx.__agyPowertoolsReceive(msg.id, { enabled: true, subagentTelemetry: true });
      } else if (msg.method === 'subagents.stats') {
        fetchedBatches.push(msg.conversationIds);
        const items = {};
        for (const id of msg.conversationIds) {
          items[id] = { conversationId: id, modelName: 'Gemini 4 Carbon', shortModel: 'Carbon', contextWindow: { usedPercent: 42, usedTokens: 42000 }, telemetry: { stepCount: 10, requestCount: 2, totalTokens: 50000 } };
        }
        ctx.__agyPowertoolsReceive(msg.id, { items });
      } else {
        ctx.__agyPowertoolsReceive(msg.id, {});
      }
    }
  });

  vm.runInContext(uiCode, ctx);
  await new Promise(r => setImmediate(r));
  // First batch must be <= 64 and prioritize open composer (#74), visible DOM (#70..#73), and newest workers
  assert.ok(fetchedBatches.length >= 1, 'expected initial subagents.stats batch');
  assert.equal(fetchedBatches[0].length, 64);
  assert.equal(fetchedBatches[0][0], 'sub-074');
  assert.deepEqual(fetchedBatches[0].slice(1, 5), ['sub-070', 'sub-071', 'sub-072', 'sub-073']);

  // Trigger scheduled backfill timer -> second batch fetches the remaining 11 older subagents (+ still-running #70)
  for (const fn of scheduled.splice(0)) fn();
  await new Promise(r => setImmediate(r));
  assert.ok(fetchedBatches.length >= 2, 'expected second incremental backfill batch');
  assert.ok(fetchedBatches[1].includes('sub-000'), 'expected oldest subagent backfilled in batch 2');
  assert.equal(ctx.__agyPowertools.subagents.filter(s => s.stats).length, 75);

  // Subsequent steady-state refresh only polls the running subagent (#70), NOT all 75 completed subagents
  const beforePollCount = fetchedBatches.length;
  for (const fn of scheduled.splice(0)) fn();
  await new Promise(r => setImmediate(r));
  if (fetchedBatches.length > beforePollCount) {
    assert.deepEqual(fetchedBatches.at(-1), ['sub-070']);
  }
  ctx.__agyPowertools.dispose();
});

test('nested Overview subagent rows mount a non-shrinking expand proxy without reparenting native controls (Issue #132)', async () => {
  const uiCode = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');

  class FakeElement {
    constructor(tag = 'div', attrs = {}) {
      this.tagName = String(tag).toUpperCase();
      this.dataset = {};
      this.attrs = new Map();
      this.style = { setProperty() {}, removeProperty() {} };
      this.className = '';
      this.children = [];
      this.parentElement = null;
      this.isConnected = true;
      this.textContent = '';
      this.clickCount = 0;
      for (const [k, v] of Object.entries(attrs)) this.setAttribute(k, v);
    }
    get nextSibling() {
      if (!this.parentElement) return null;
      const i = this.parentElement.children.indexOf(this);
      return i >= 0 ? (this.parentElement.children[i + 1] || null) : null;
    }
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
      if (k === 'data-cascade-id') this.dataset.cascadeId = String(v);
      if (k === 'data-testid') this.dataset.testid = String(v);
    }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    removeAttribute(k) { this.attrs.delete(k); }
    toggleAttribute(k, force) {
      const on = force === undefined ? !this.attrs.has(k) : Boolean(force);
      if (on) this.attrs.set(k, ''); else this.attrs.delete(k);
    }
    append(...nodes) {
      for (const n of nodes) this.insertBefore(n, null);
    }
    insertBefore(node, before) {
      if (node.parentElement) {
        const prevIdx = node.parentElement.children.indexOf(node);
        if (prevIdx >= 0) node.parentElement.children.splice(prevIdx, 1);
      }
      node.parentElement = this;
      node.isConnected = true;
      if (before) {
        const idx = this.children.indexOf(before);
        if (idx >= 0) { this.children.splice(idx, 0, node); return node; }
      }
      this.children.push(node);
      return node;
    }
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
      this.isConnected = false;
    }
    click() { this.clickCount++; }
    closest() { return null; }
    querySelector(sel) {
      const findByTestId = (root, id) => {
        for (const c of root.children) {
          if (c.getAttribute?.('data-testid') === id) return c;
          const hit = findByTestId(c, id);
          if (hit) return hit;
        }
        return null;
      };
      if (sel === '[data-testid="subagent-node-detail"] [data-testid="subagent-expand"]') {
        const detail = findByTestId(this, 'subagent-node-detail');
        return detail ? findByTestId(detail, 'subagent-expand') : null;
      }
      const m = sel.match(/^\[data-testid="([^"]+)"\]$/);
      if (m) return findByTestId(this, m[1]);
      return null;
    }
    querySelectorAll() { return []; }
  }

  // Row A: Overview d6/jrd nested parent subagent (running, with hoverActions)
  const rowA = new FakeElement('div', { 'data-testid': 'subagent-node', 'data-cascade-id': 'sub-parent', 'aria-expanded': 'false' });
  const iconA = new FakeElement('span');
  const labelA = new FakeElement('span');
  labelA.className = 'agy-hover-label min-w-0 truncate';
  labelA.textContent = 'Project Orchestrator (gen3)';
  const detailA = new FakeElement('span', { 'data-testid': 'subagent-node-detail' });
  detailA.className = 'empty:hidden min-w-0 flex-1 basis-0 truncate text-muted-foreground';
  detailA.textContent = '(4 subagents) chevron_right';
  const nativeExpandA = new FakeElement('span', { 'data-testid': 'subagent-expand', 'data-cascade-id': 'sub-parent' });
  nativeExpandA.textContent = 'chevron_right';
  detailA.append(nativeExpandA);
  const hoverActionsA = new FakeElement('div');
  hoverActionsA.className = 'agy-hover-actions absolute top-0 bottom-0 right-0';
  rowA.append(iconA, labelA, detailA, hoverActionsA);

  // Row B: Leaf Overview subagent (no detail / no expand)
  const rowB = new FakeElement('button', { 'data-testid': 'subagent-node', 'data-cascade-id': 'sub-leaf' });
  const labelB = new FakeElement('span');
  labelB.textContent = 'Task Interviewer';
  rowB.append(labelB);

  // Row C: Legacy oYc sidebar node (subagent-expand outside subagent-node-detail)
  const rowC = new FakeElement('div', { 'data-testid': 'subagent-node', 'data-cascade-id': 'sub-legacy' });
  const legacyExpand = new FakeElement('button', { 'data-testid': 'subagent-expand', 'data-cascade-id': 'sub-legacy' });
  rowC.append(legacyExpand);

  const headEl = new FakeElement('head');
  const bodyEl = new FakeElement('body');
  const docEl = new FakeElement('html');
  const mountedRoots = new Map();
  const attrObservers = [];
  let bodyObserverCb = null;
  const scheduled = [];

  const renderElement = (el, hookEnv) => {
    if (!el || typeof el !== 'object') return el;
    if (Array.isArray(el)) return el.map(c => renderElement(c, hookEnv));
    if (typeof el.type === 'function') {
      const states = [];
      let idx = 0;
      const prevState = hookEnv.React.useState;
      const prevEffect = hookEnv.React.useEffect;
      hookEnv.React.useState = init => {
        const i = idx++;
        if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
        return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
      };
      hookEnv.React.useEffect = fn => { fn(); };
      try {
        return renderElement(el.type({ ...(el.props || {}), children: el.children }), hookEnv);
      } finally {
        hookEnv.React.useState = prevState;
        hookEnv.React.useEffect = prevEffect;
      }
    }
    return { ...el, children: Array.isArray(el.children) ? el.children.map(c => renderElement(c, hookEnv)) : el.children };
  };

  const ctx = vm.createContext({
    console,
    setTimeout: fn => { scheduled.push(fn); return scheduled.length; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    AbortController,
    location: { pathname: '/c/conv-root' },
    React: {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      Fragment: 'fragment',
      useSyncExternalStore: (_, g) => g(),
      Component: null
    },
    ReactDOM: {
      createRoot: mount => {
        const rec = { mount, lastElement: null, unmounted: false };
        mountedRoots.set(mount, rec);
        return {
          render(el) { rec.lastElement = el; },
          unmount() { rec.unmounted = true; }
        };
      }
    },
    HC: () => null,
    IC: () => null,
    JC: () => null,
    Uy: () => null,
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe(target, opts) {
        if (target === bodyEl) bodyObserverCb = this.cb;
        if (opts?.attributes) attrObservers.push({ target, cb: this.cb, disconnected: false, obs: this });
      }
      disconnect() {
        for (const o of attrObservers) if (o.obs === this) o.disconnected = true;
      }
    },
    window: { addEventListener() {}, removeEventListener() {} },
    document: {
      head: headEl,
      body: bodyEl,
      documentElement: docEl,
      title: '',
      querySelector: () => null,
      querySelectorAll: sel => sel.includes('subagent-node') ? [rowA, rowB, rowC] : [],
      createElement: tag => new FakeElement(tag),
      addEventListener() {}
    },
    __agyInitialSettings: { enabled: true, subagentTelemetry: true, language: 'zh-CN' },
    __agyNativeAdapter: {
      subagents: () => [],
      composerCascadeId: () => '',
      wrap: el => el,
      executionState: () => null,
      capabilities: () => ({}),
      setEnabled() {}, setStageUpdates() {}, setEfficientIO() {}, setContextLimit() {}, setSidebarProjectLimit() {},
      dispose() {}
    },
    __agyPowertoolsHost: raw => {
      const msg = JSON.parse(raw);
      if (msg.method === 'settings.get') ctx.__agyPowertoolsReceive(msg.id, { enabled: true, subagentTelemetry: true, language: 'zh-CN' });
      else if (msg.method === 'subagents.stats') ctx.__agyPowertoolsReceive(msg.id, { items: {} });
      else ctx.__agyPowertoolsReceive(msg.id, {});
    }
  });

  vm.runInContext(uiCode, ctx);
  await new Promise(r => setImmediate(r));

  // 1. Verify injected two-line CSS Grid layout, compact expand toggle, and hover preservation rules
  const styleText = headEl.children.map(c => c.textContent).join('\n');
  assert.match(styleText, /\[data-testid="subagent-node"\]:has\(> \.agy-hover-label\):has\(> \[data-agy-powertools-root="subagent-badge"\] \[data-testid="agy-subagent-badge"\],> \[data-agy-powertools-root="subagent-expand"\] \[data-testid="agy-subagent-expand-proxy"\]\)\{display:grid;grid-template-columns:auto minmax\(0,1fr\);column-gap:6px;row-gap:2px;align-items:center\}/);
  assert.match(styleText, /\[data-testid="subagent-node"\]:has\(> \.agy-hover-label\):has\(> \[data-agy-powertools-root="subagent-expand"\] \[data-testid="agy-subagent-expand-proxy"\]\)\{grid-template-columns:auto minmax\(0,max-content\) minmax\(max-content,1fr\)\}/);
  assert.match(styleText, /\[data-testid="subagent-node"\]:has\(> \.agy-hover-label\) > \[data-agy-powertools-root="subagent-badge"\]:has\(\[data-testid="agy-subagent-badge"\]\)\{grid-column:2\/-1;grid-row:2;justify-self:start;width:0;min-width:100%;margin-left:-6px\}/);
  assert.match(styleText, /\[data-testid="subagent-node"\]:has\(> \[data-agy-powertools-root="subagent-expand"\] \[data-testid="agy-subagent-expand-proxy"\]\) > \[data-testid="subagent-node-detail"\]\{display:none!important\}/);
  assert.match(styleText, /body\[data-agy-theme\] \.agy-hover-row\[data-testid="subagent-node"\]:has\(> \.agy-hover-label\):is\(:hover,:focus-visible,:has\(:focus-visible\)\) > \.agy-hover-label ~ \[data-agy-powertools-root="subagent-badge"\]\.ml-auto\.shrink-0:has\(\[data-testid="agy-subagent-badge"\]\)\{opacity:1\}/);

  // 2. Row A mounts expand proxy immediately after detailEl (before hoverActions & badge), without reparenting nativeExpandA
  assert.equal(nativeExpandA.parentElement, detailA);
  const expandMountA = rowA.children.find(c => c.dataset.agyPowertoolsRoot === 'subagent-expand');
  const badgeMountA = rowA.children.find(c => c.dataset.agyPowertoolsRoot === 'subagent-badge');
  assert.ok(expandMountA, 'expected subagent-expand mount on nested Overview row');
  assert.ok(badgeMountA, 'expected subagent-badge mount on nested Overview row');
  assert.equal(expandMountA.className.includes('shrink-0'), true);
  assert.equal(expandMountA.className.includes('ml-auto'), false);
  assert.equal(badgeMountA.className.includes('ml-auto'), true);
  assert.deepEqual(rowA.children, [iconA, labelA, detailA, expandMountA, hoverActionsA, badgeMountA]);

  // Leaf Row B and legacy oYc Row C must NOT mount subagent-expand
  assert.equal(rowB.children.some(c => c.dataset.agyPowertoolsRoot === 'subagent-expand'), false);
  assert.equal(rowB.children.some(c => c.dataset.agyPowertoolsRoot === 'subagent-badge'), true);
  assert.equal(rowC.children.some(c => c.dataset.agyPowertoolsRoot === 'subagent-expand'), false);
  assert.equal(rowC.children.some(c => c.dataset.agyPowertoolsRoot === 'subagent-badge'), true);

  // 3. Proxy renders compact count + collapsed chevron, delegates click/keyboard to native expand without bubbling to rowA
  const recA = mountedRoots.get(expandMountA);
  const collapsedTree = renderElement(recA.lastElement, ctx);
  assert.equal(collapsedTree.props['data-testid'], 'agy-subagent-expand-proxy');
  assert.equal(collapsedTree.props['aria-expanded'], 'false');
  assert.equal(collapsedTree.props['data-pt-tip'], '展开子智能体 (4)');
  assert.equal(collapsedTree.children[0].children[0], '4');
  assert.equal(collapsedTree.children[1].props.style.transform, 'rotate(0deg)');

  let stopped = 0, prevented = 0;
  const fakeEvent = (extra = {}) => ({ stopPropagation() { stopped++; }, preventDefault() { prevented++; }, ...extra });
  collapsedTree.props.onMouseDown(fakeEvent());
  collapsedTree.props.onAuxClick(fakeEvent());
  assert.equal(stopped, 2);
  collapsedTree.props.onClick(fakeEvent());
  assert.equal(stopped, 3);
  assert.equal(prevented, 1);
  assert.equal(nativeExpandA.clickCount, 1);
  assert.equal(rowA.clickCount, 0);

  collapsedTree.props.onKeyDown(fakeEvent({ key: 'Enter' }));
  collapsedTree.props.onKeyDown(fakeEvent({ key: ' ' }));
  collapsedTree.props.onKeyDown(fakeEvent({ key: 'Escape' }));
  assert.equal(nativeExpandA.clickCount, 3);

  // 4. Toggling aria-expanded updates proxy label, aria-expanded, and chevron rotation
  rowA.setAttribute('aria-expanded', 'true');
  const expandedTree = renderElement(recA.lastElement, ctx);
  assert.equal(expandedTree.props['aria-expanded'], 'true');
  assert.equal(expandedTree.props['data-pt-tip'], '折叠子智能体 (4)');
  assert.equal(expandedTree.children[0].children[0], '4');
  assert.equal(expandedTree.children[1].props.style.transform, 'rotate(90deg)');

  // 5. Removing detailEl unmounts expand proxy; re-adding detailEl at the end self-heals mount order
  detailA.remove();
  bodyObserverCb?.([{ target: rowA }]);
  for (const fn of scheduled.splice(0)) fn();
  assert.equal(recA.unmounted, true);
  assert.equal(rowA.children.some(c => c.dataset.agyPowertoolsRoot === 'subagent-expand'), false);
  assert.equal(rowA.children.includes(badgeMountA), true);

  // Simulate React appending detailA after badgeMountA when children appear dynamically
  rowA.append(detailA);
  bodyObserverCb?.([{ target: rowA }]);
  for (const fn of scheduled.splice(0)) fn();
  const reExpandMountA = rowA.children.find(c => c.dataset.agyPowertoolsRoot === 'subagent-expand');
  assert.ok(reExpandMountA, 'expected subagent-expand remounted when detail reappears');
  assert.equal(detailA.nextSibling, reExpandMountA);
  assert.equal(rowA.children.at(-1), badgeMountA);

  // 6. Dispose cleans up all mounts
  ctx.__agyPowertools.dispose();
  assert.equal(rowA.children.some(c => c.dataset.agyPowertoolsRoot), false);
  assert.equal(nativeExpandA.parentElement, detailA);
});
