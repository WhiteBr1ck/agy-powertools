import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const betaAiSrc = readFileSync(new URL('../lib/native-beta-ai.js', import.meta.url), 'utf8');

function createFakeDom() {
  const docListeners = [];

  class FakeText {
    constructor(value, ownerDocument) {
      this.nodeType = 3;
      this.nodeName = '#text';
      this.nodeValue = String(value ?? '');
      this.ownerDocument = ownerDocument;
      this.parentElement = null;
      this.isConnected = false;
    }
    get textContent() { return this.nodeValue; }
    set textContent(v) { this.nodeValue = String(v ?? ''); }
    remove() {
      if (this.parentElement) {
        this.parentElement.removeChild(this);
      }
    }
  }

  function matchSingleSelector(el, rawSel) {
    const sel = rawSel.trim();
    if (!sel) return false;
    if (sel === '*') return true;

    // Parse compound simple selector: tag#id.cls1.cls2[attr="val"][attr*="sub"][attr]
    let rest = sel;

    // Tag prefix
    const tagMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
    if (tagMatch) {
      if (el.tagName !== tagMatch[1].toUpperCase()) return false;
      rest = rest.slice(tagMatch[0].length);
    }

    while (rest.length > 0) {
      if (rest[0] === '.') {
        const clsMatch = /^\.([a-zA-Z0-9_-]+)/.exec(rest);
        if (!clsMatch) return false;
        const classes = String(el.className || '').split(/\s+/).filter(Boolean);
        if (!classes.includes(clsMatch[1])) return false;
        rest = rest.slice(clsMatch[0].length);
        continue;
      }
      if (rest[0] === '[') {
        const attrMatch = /^\[([a-zA-Z0-9_-]+)(?:([*^$]?)=["']([^"']*)["'])?\]/.exec(rest);
        if (!attrMatch) return false;
        const [, name, op, expected] = attrMatch;
        const actual = el.getAttribute(name);
        if (op === undefined) {
          if (actual === null) return false;
        } else if (op === '') {
          if (actual !== expected) return false;
        } else if (op === '*') {
          if (actual === null || !actual.includes(expected)) return false;
        } else if (op === '^') {
          if (actual === null || !actual.startsWith(expected)) return false;
        } else if (op === '$') {
          if (actual === null || !actual.endsWith(expected)) return false;
        }
        rest = rest.slice(attrMatch[0].length);
        continue;
      }
      return false;
    }
    return true;
  }

  function matchSelectorChain(el, chain) {
    // Support descendant combinator separated by spaces
    const parts = chain.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    if (!matchSingleSelector(el, parts[parts.length - 1])) return false;
    let cur = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      let found = false;
      while (cur) {
        if (matchSingleSelector(cur, parts[i])) {
          found = true;
          cur = cur.parentElement;
          break;
        }
        cur = cur.parentElement;
      }
      if (!found) return false;
    }
    return true;
  }

  function matchesAny(el, selectorList) {
    return String(selectorList || '').split(',').some(part => matchSelectorChain(el, part));
  }

  function setConnectedTree(node, connected) {
    node.isConnected = connected;
    if (node.childNodes) {
      for (const child of node.childNodes) setConnectedTree(child, connected);
    }
  }

  class FakeElement {
    constructor(tagName, ownerDocument) {
      this.nodeType = 1;
      this.tagName = String(tagName || 'DIV').toUpperCase();
      this.nodeName = this.tagName;
      this.ownerDocument = ownerDocument;
      this._attrs = new Map();
      this.dataset = {};
      this.style = {};
      this.childNodes = [];
      this.parentElement = null;
      this.isConnected = false;
      this._listeners = [];
      this.type = '';
    }

    get innerHTML() {
      throw new Error('innerHTML getter is forbidden');
    }
    set innerHTML(_v) {
      throw new Error('innerHTML setter is forbidden');
    }
    get outerHTML() {
      throw new Error('outerHTML getter is forbidden');
    }
    set outerHTML(_v) {
      throw new Error('outerHTML setter is forbidden');
    }
    insertAdjacentHTML() {
      throw new Error('insertAdjacentHTML is forbidden');
    }

    get className() {
      return this._attrs.get('class') || '';
    }
    set className(val) {
      const s = String(val || '');
      if (s) this._attrs.set('class', s);
      else this._attrs.delete('class');
    }

    get href() {
      return this._attrs.get('href') || '';
    }
    set href(val) {
      this.setAttribute('href', val);
    }

    get children() {
      return this.childNodes.filter(n => n.nodeType === 1);
    }

    get firstChild() {
      return this.childNodes[0] || null;
    }

    get nextSibling() {
      if (!this.parentElement) return null;
      const list = this.parentElement.childNodes;
      const idx = list.indexOf(this);
      return idx >= 0 ? (list[idx + 1] || null) : null;
    }

    get textContent() {
      return this.childNodes.map(n => n.textContent).join('');
    }
    set textContent(val) {
      for (const child of [...this.childNodes]) {
        child.parentElement = null;
        setConnectedTree(child, false);
      }
      this.childNodes.length = 0;
      const str = String(val ?? '');
      if (str) {
        const textNode = new FakeText(str, this.ownerDocument);
        textNode.parentElement = this;
        textNode.isConnected = this.isConnected;
        this.childNodes.push(textNode);
      }
    }

    setAttribute(name, value) {
      const val = String(value);
      this._attrs.set(name, val);
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = val;
      }
    }
    getAttribute(name) {
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }
    hasAttribute(name) {
      return this._attrs.has(name);
    }
    removeAttribute(name) {
      this._attrs.delete(name);
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        delete this.dataset[key];
      }
    }

    appendChild(child) {
      if (!child) return child;
      if (child.parentElement) child.parentElement.removeChild(child);
      child.parentElement = this;
      setConnectedTree(child, this.isConnected);
      this.childNodes.push(child);
      return child;
    }
    append(...nodes) {
      for (const node of nodes) {
        if (typeof node === 'string') this.appendChild(new FakeText(node, this.ownerDocument));
        else if (node) this.appendChild(node);
      }
    }
    insertBefore(child, refNode) {
      if (!child) return child;
      if (child.parentElement) child.parentElement.removeChild(child);
      child.parentElement = this;
      setConnectedTree(child, this.isConnected);
      const idx = refNode ? this.childNodes.indexOf(refNode) : -1;
      if (idx >= 0) this.childNodes.splice(idx, 0, child);
      else this.childNodes.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) {
        this.childNodes.splice(idx, 1);
        child.parentElement = null;
        setConnectedTree(child, false);
      }
      return child;
    }
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
      else setConnectedTree(this, false);
    }

    contains(other) {
      for (let cur = other; cur; cur = cur.parentElement) {
        if (cur === this) return true;
      }
      return false;
    }

    matches(sel) {
      return matchesAny(this, sel);
    }
    closest(sel) {
      for (let cur = this; cur; cur = cur.parentElement) {
        if (cur.nodeType === 1 && cur.matches(sel)) return cur;
      }
      return null;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = node => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (child.matches(sel)) out.push(child);
            walk(child);
          }
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }

    addEventListener(type, fn, capture = false) {
      this._listeners.push({ type, fn, capture: Boolean(capture) });
    }
    removeEventListener(type, fn, capture = false) {
      const idx = this._listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === Boolean(capture));
      if (idx >= 0) this._listeners.splice(idx, 1);
    }
    dispatchEvent(event) {
      const ev = event && typeof event === 'object' ? event : { type: String(event) };
      if (!ev.target) ev.target = this;
      if (typeof ev.preventDefault !== 'function') {
        ev.defaultPrevented = false;
        ev.preventDefault = () => { ev.defaultPrevented = true; };
      }
      if (typeof ev.stopPropagation !== 'function') {
        ev.propagationStopped = false;
        ev.stopPropagation = () => { ev.propagationStopped = true; };
      }
      for (const l of [...this._listeners]) {
        if (l.type === ev.type) l.fn(ev);
      }
      return !ev.defaultPrevented;
    }
    click() {
      this.dispatchEvent({ type: 'click', target: this });
    }
  }

  const document = {
    nodeType: 9,
    activeElement: null,
    head: null,
    body: null,
    documentElement: null,
    createElement(tag) { return new FakeElement(tag, document); },
    createTextNode(text) { return new FakeText(text, document); },
    querySelectorAll(sel) { return document.documentElement.querySelectorAll(sel); },
    querySelector(sel) { return document.documentElement.querySelector(sel); },
    addEventListener(type, fn, capture = false) {
      docListeners.push({ type, fn, capture: Boolean(capture) });
    },
    removeEventListener(type, fn, capture = false) {
      const idx = docListeners.findIndex(l => l.type === type && l.fn === fn && l.capture === Boolean(capture));
      if (idx >= 0) docListeners.splice(idx, 1);
    },
    dispatchEvent(event) {
      const ev = event && typeof event === 'object' ? event : { type: String(event) };
      if (typeof ev.preventDefault !== 'function') {
        ev.defaultPrevented = false;
        ev.preventDefault = () => { ev.defaultPrevented = true; };
      }
      if (typeof ev.stopPropagation !== 'function') {
        ev.propagationStopped = false;
        ev.stopPropagation = () => { ev.propagationStopped = true; };
      }
      for (const l of [...docListeners]) {
        if (l.type === ev.type) l.fn(ev);
      }
      return !ev.defaultPrevented;
    },
    _listenerCount() { return docListeners.length; }
  };

  document.documentElement = new FakeElement('HTML', document);
  document.documentElement.isConnected = true;
  document.head = new FakeElement('HEAD', document);
  document.body = new FakeElement('BODY', document);
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'className') el.className = v;
      else if (k === 'style' && v && typeof v === 'object') Object.assign(el.style, v);
      else if (v !== undefined && v !== null) el.setAttribute(k, v);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      if (typeof child === 'string' || typeof child === 'number') {
        el.appendChild(document.createTextNode(String(child)));
      } else {
        el.appendChild(child);
      }
    }
    return el;
  }

  return { document, h, FakeElement, FakeText };
}

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();

  function setTimeoutFn(fn, ms = 0) {
    const id = nextId++;
    tasks.set(id, { id, fn, runAt: now + Math.max(0, Number(ms) || 0) });
    return id;
  }
  function clearTimeoutFn(id) {
    tasks.delete(id);
  }
  function advance(ms) {
    const target = now + ms;
    while (true) {
      let nextTask = null;
      for (const task of tasks.values()) {
        if (task.runAt <= target && (!nextTask || task.runAt < nextTask.runAt)) {
          nextTask = task;
        }
      }
      if (!nextTask) break;
      tasks.delete(nextTask.id);
      now = nextTask.runAt;
      nextTask.fn();
    }
    now = target;
  }
  return { setTimeout: setTimeoutFn, clearTimeout: clearTimeoutFn, advance, pendingCount: () => tasks.size };
}

function createHarness(initialOpts = {}, { useFakeIO = false, useFakeTimers = false, initialNow = null } = {}) {
  const dom = createFakeDom();
  const timers = useFakeTimers ? createFakeTimers() : null;
  const ioInstances = [];
  const moInstances = [];
  const computedStyles = new WeakMap();
  let fakeNow = typeof initialNow === 'number' ? initialNow : null;
  const DateObj = fakeNow !== null
    ? new Proxy(Date, {
      get(target, prop, receiver) {
        if (prop === 'now') return () => fakeNow;
        return Reflect.get(target, prop, receiver);
      }
    })
    : Date;

  class FakeIntersectionObserver {
    constructor(cb, opts) {
      this.cb = cb;
      this.opts = opts;
      this.observed = new Set();
      this.disconnected = false;
      ioInstances.push(this);
    }
    observe(target) { this.observed.add(target); }
    unobserve(target) { this.observed.delete(target); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
    trigger(target, isIntersecting = true) {
      this.cb([{ target, isIntersecting }]);
    }
  }

  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.disconnected = false;
      moInstances.push(this);
    }
    observe() {}
    disconnect() { this.disconnected = true; }
    trigger(records) { this.cb(records); }
  }

  const windowObj = {
    document: dom.document,
    getComputedStyle: el => computedStyles.get(el) || { display: el?.style?.display || 'block' },
    MutationObserver: FakeMutationObserver,
    ...(useFakeIO ? { IntersectionObserver: FakeIntersectionObserver } : {}),
    ...(timers ? { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } : { setTimeout, clearTimeout })
  };

  const context = vm.createContext({
    document: dom.document,
    window: windowObj,
    URL,
    Promise,
    Set,
    Map,
    WeakMap,
    Object,
    Array,
    RegExp,
    Number,
    String,
    Boolean,
    JSON,
    Math,
    Date: DateObj,
    setTimeout: timers ? timers.setTimeout : setTimeout,
    clearTimeout: timers ? timers.clearTimeout : clearTimeout
  });
  vm.runInContext(betaAiSrc, context);

  let opts = {
    enabled: true,
    language: 'zh-CN',
    betaThinkingTranslate: false,
    betaThinkingEngine: 'free',
    betaThinkingDisplay: 'replace',
    betaThinkingTrigger: 'auto',
    betaComposerPredict: false,
    betaAiProvider: '',
    betaAiModel: '',
    betaAiPredictModel: '',
    ...initialOpts
  };
  let convId = 'conv-1';
  let running = false;
  const subscribers = new Set();
  const requests = [];
  let requestHandler = async () => ({ ok: true });

  const env = {
    document: dom.document,
    window: windowObj,
    adapter: {},
    options: () => opts,
    currentId: () => convId,
    isTurnRunning: () => running,
    subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn); },
    request: (method, params, timeoutMs) => {
      requests.push({ method, params, timeoutMs });
      return Promise.resolve(requestHandler(method, params, timeoutMs));
    },
    uiText: (zh, en) => (opts.language === 'en' ? en : zh),
    t: k => k
  };

  const flushMicrotasks = async (rounds = 6) => {
    for (let i = 0; i < rounds; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
  };

  return {
    dom,
    h: dom.h,
    document: dom.document,
    window: windowObj,
    context,
    api: context.__agyBetaAi,
    env,
    timers,
    ioInstances,
    moInstances,
    computedStyles,
    requests,
    setOptions: patch => { opts = { ...opts, ...patch }; },
    setConvId: id => { convId = id; },
    setRunning: val => { running = Boolean(val); },
    emit: () => { for (const fn of subscribers) fn(); },
    setRequestHandler: fn => { requestHandler = fn; },
    advanceNow: ms => { if (fakeNow !== null) fakeNow += ms; },
    flushMicrotasks
  };
}

// ---------------------------------------------------------------------------
// 1. Static Source Invariants
// ---------------------------------------------------------------------------
test('static invariants: zero middle dots, zero innerHTML, and --agy-fw-* font-weight CSS routing', () => {
  assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(betaAiSrc), false, 'Must contain zero middle dot characters');
  assert.equal(/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/.test(betaAiSrc), false, 'Must be 100% innerHTML-free');
  assert.equal(/font-weight:(?:400|500|600)(?=[;}!])/.test(betaAiSrc), false, 'Must route CSS font-weight via --agy-fw-* vars');

  const harness = createHarness();
  assert.equal(typeof harness.api.mountBetaAi, 'function');
  assert.equal(typeof harness.api.extractThinkingMarkdown, 'function');
  assert.equal(typeof harness.api.renderSafeMarkdown, 'function');
  assert.equal(typeof harness.api.sliceParagraphs, 'function');
});

// ---------------------------------------------------------------------------
// 2. extractThinkingMarkdown
// ---------------------------------------------------------------------------
test('extractThinkingMarkdown preserves headings, paragraphs, bold, italic, inline code, fenced code blocks, links, and lists', () => {
  const { h, api } = createHarness();
  const root = h('div', { 'data-markdown-root': 'true' },
    h('h2', {}, 'Analysis Plan'),
    h('p', {},
      'Inspect ',
      h('code', {}, 'lib/native-ui.js'),
      ' with ',
      h('strong', {}, 'strict'),
      ' ',
      h('em', {}, 'isolation'),
      ' and check ',
      h('a', { href: 'https://example.com/spec' }, 'spec doc'),
      '.'
    ),
    h('pre', {},
      h('button', {}, 'Copy'),
      h('code', { className: 'language-js' }, 'const a = 1;\n\nconst b = 2;\n')
    ),
    h('ul', {},
      h('li', {}, 'First item'),
      h('li', {},
        'Second item',
        h('ul', {}, h('li', {}, 'Nested child'))
      )
    ),
    h('ol', { start: '2' },
      h('li', {}, 'Step two'),
      h('li', {}, 'Step three')
    ),
    h('div', { 'data-agy-powertools-root': 'ignored' }, 'Should not appear')
  );

  const md = api.extractThinkingMarkdown(root);
  assert.equal(md, [
    '## Analysis Plan',
    '',
    'Inspect `lib/native-ui.js` with **strict** *isolation* and check [spec doc](https://example.com/spec).',
    '',
    '```js',
    'const a = 1;',
    '',
    'const b = 2;',
    '```',
    '',
    '- First item',
    '- Second item',
    '  - Nested child',
    '',
    '2. Step two',
    '3. Step three'
  ].join('\n'));
});

// ---------------------------------------------------------------------------
// 3. sliceParagraphs
// ---------------------------------------------------------------------------
test('sliceParagraphs splits fence-safely and holds unstable streaming tail', () => {
  const { api } = createHarness();

  const mdWithCode = [
    'First paragraph.',
    '',
    '```ts',
    'function foo() {',
    '',
    '  return 1;',
    '}',
    '```',
    '',
    'Final paragraph.'
  ].join('\n');

  const done = api.sliceParagraphs(mdWithCode, false);
  assert.equal(done.pendingTail, '');
  assert.equal(done.ready.length, 3);
  assert.equal(done.ready[0], 'First paragraph.');
  assert.equal(done.ready[1], '```ts\nfunction foo() {\n\n  return 1;\n}\n```');
  assert.equal(done.ready[2], 'Final paragraph.');

  // Streaming: holds unfinished tail paragraph
  const streaming = api.sliceParagraphs('First paragraph.\n\nSecond still typing', true);
  assert.deepEqual(Array.from(streaming.ready), ['First paragraph.']);
  assert.equal(streaming.pendingTail, 'Second still typing');

  // Streaming: unclosed code fence with internal blank line stays intact in pendingTail
  const unclosed = api.sliceParagraphs('Intro.\n\n```py\nx = 1\n\ny = 2', true);
  assert.deepEqual(Array.from(unclosed.ready), ['Intro.']);
  assert.equal(unclosed.pendingTail, '```py\nx = 1\n\ny = 2');

  // Streaming: paragraph terminated by trailing blank line outside fence is ready
  const terminated = api.sliceParagraphs('First.\n\nSecond.\n\n', true);
  assert.deepEqual(Array.from(terminated.ready), ['First.', 'Second.']);
  assert.equal(terminated.pendingTail, '');

  // Streaming: single incomplete paragraph held in pendingTail
  const single = api.sliceParagraphs('Only one unfinished line', true);
  assert.deepEqual(Array.from(single.ready), []);
  assert.equal(single.pendingTail, 'Only one unfinished line');
});

// ---------------------------------------------------------------------------
// 4. renderSafeMarkdown
// ---------------------------------------------------------------------------
test('renderSafeMarkdown renders rich markdown safely without innerHTML or unsafe links', () => {
  const { h, document, api } = createHarness();
  const container = h('div');

  const md = [
    '### Summary',
    '',
    'Check **bold**, *italic*, `code_var`, and `my_var_name` plus [Safe](https://example.com/a) and [BadJS](javascript:alert(1)) and [BadHttp](http://insecure.example) and <script>alert(1)</script>.',
    '',
    '```js',
    'const x = "<img onerror=alert(1)>";',
    '```',
    '',
    '- Alpha',
    '- Beta',
    '  - Sub-item',
    '',
    '1. First',
    '2. Second'
  ].join('\n');

  api.renderSafeMarkdown(container, md, document);

  const h3 = container.querySelector('h3');
  assert.ok(h3);
  assert.equal(h3.textContent, 'Summary');

  const p = container.querySelector('p');
  assert.ok(p);
  assert.equal(p.querySelector('strong')?.textContent, 'bold');
  assert.equal(p.querySelector('em')?.textContent, 'italic');
  const inlineCodes = p.querySelectorAll('code');
  assert.equal(inlineCodes.length, 2);
  assert.equal(inlineCodes[0].textContent, 'code_var');
  assert.equal(inlineCodes[1].textContent, 'my_var_name');

  // Only the https: link is rendered as <a>, with rel="noopener noreferrer"
  const links = container.querySelectorAll('a');
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute('href'), 'https://example.com/a');
  assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer');
  assert.equal(links[0].getAttribute('target'), '_blank');
  assert.equal(links[0].textContent, 'Safe');

  // Unsafe links rendered safely as text, raw <script> rendered as inert text (no <script> element)
  assert.equal(container.querySelector('script'), null);
  assert.ok(p.textContent.includes('BadJS'));
  assert.ok(p.textContent.includes('<script>alert(1)</script>'));

  // Fenced code block
  const preCode = container.querySelector('pre code');
  assert.ok(preCode);
  assert.equal(preCode.getAttribute('data-lang'), 'js');
  assert.equal(preCode.textContent, 'const x = "<img onerror=alert(1)>";');

  // Lists including nested list
  const ul = container.querySelector('ul');
  assert.ok(ul);
  assert.equal(ul.children.length, 2);
  assert.equal(ul.querySelector('li ul li')?.textContent, 'Sub-item');

  const ol = container.querySelector('ol');
  assert.ok(ol);
  assert.equal(ol.children.length, 2);
  assert.equal(ol.children[0].textContent, 'First');
});

// ---------------------------------------------------------------------------
// 5. Thinking-Only Translation: Scope, Lazy Viewport, Streaming Deltas, Replace/Bilingual, Toggle
// ---------------------------------------------------------------------------
test('Thinking-only translation respects strict scope, display:contents IntersectionObserver laziness, streaming deltas, replace/bilingual modes, and Original/Translated toggle', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'zh-CN',
    betaThinkingTranslate: true,
    betaThinkingDisplay: 'replace',
    betaThinkingTrigger: 'auto'
  }, { useFakeIO: true });
  const { h, document, api, env, ioInstances, computedStyles, requests, flushMicrotasks } = harness;

  // Build conversation DOM with:
  // 1) An expanded thinking block inside a display:contents wrapper
  // 2) A collapsed thinking block (aria-expanded="false")
  // 3) Tool group, worked-for, stage update, and planner response text (MUST NEVER BE TOUCHED!)
  const thinkingMd = h('div', { 'data-markdown-root': 'true' },
    h('p', {}, 'Inspecting the parser and verifying edge cases.')
  );
  const displayContentsWrap = h('div', { style: { display: 'contents' } }, thinkingMd);
  const thinkingOuter = h('div', { className: 'thinking-block' },
    h('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' }, 'Thought for 3s'),
    displayContentsWrap
  );
  computedStyles.set(displayContentsWrap, { display: 'contents' });
  computedStyles.set(thinkingMd, { display: 'contents' });
  computedStyles.set(thinkingOuter, { display: 'block' });

  const collapsedThinking = h('div', { className: 'thinking-collapsed' },
    h('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'false' }, 'Thought for 1s')
  );
  const toolGroup = h('div', { 'data-testid': 'tool-group-collapsible' },
    h('div', { 'data-markdown-root': 'true' }, h('p', {}, 'Tool output must not translate'))
  );
  const workedFor = h('div', { 'data-testid': 'worked-for-collapsible' }, 'Worked for 4s');
  const stageUpdate = h('div', { className: 'stage-update' }, 'Running verification steps');
  const plannerResponse = h('div', { 'data-testid': 'planner-response-text' },
    h('div', { 'data-markdown-root': 'true' }, h('p', {}, 'Final English answer must not translate.'))
  );

  const convView = h('div', { 'data-testid': 'conversation-view' },
    h('div', { 'data-testid': 'agent-response' },
      thinkingOuter,
      collapsedThinking,
      toolGroup,
      workedFor,
      stageUpdate,
      plannerResponse
    )
  );
  document.body.appendChild(convView);

  let resolveTranslate;
  harness.setRequestHandler((method, params) => {
    if (method === 'beta.translateThinking') {
      return new Promise(resolve => { resolveTranslate = { resolve, params }; });
    }
    return { ok: true };
  });

  const controller = api.mountBetaAi(env);
  await flushMicrotasks();

  // Viewport lazy: offscreen thinking block MUST NOT fire translation before intersection!
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 0);
  assert.equal(ioInstances.length, 1);
  assert.equal(ioInstances[0].opts.rootMargin, '400px 0px');
  // Climbed past display:contents to observe thinkingOuter
  assert.equal(ioInstances[0].observed.has(thinkingOuter), true);

  // Trigger intersection -> now translation starts!
  ioInstances[0].trigger(thinkingOuter, true);
  await flushMicrotasks();

  const translateReqs = requests.filter(r => r.method === 'beta.translateThinking');
  assert.equal(translateReqs.length, 1);
  assert.equal(translateReqs[0].params.text, 'Inspecting the parser and verifying edge cases.');
  assert.equal(translateReqs[0].params.targetLang, 'zh-CN');

  // Native markdown subtree is NEVER mutated
  assert.equal(thinkingMd.textContent, 'Inspecting the parser and verifying edge cases.');

  // Stream partial delta via globalThis.__agyBetaTranslateDelta
  harness.context.__agyBetaTranslateDelta(translateReqs[0].params.reqId, '正在检查解析器');
  assert.equal(thinkingMd.getAttribute('data-agy-translate-hidden'), 'true');
  const translateRoot = displayContentsWrap.querySelector('[data-agy-translate-root="thinking"]');
  assert.ok(translateRoot);
  assert.equal(translateRoot.getAttribute('data-agy-powertools-root'), 'beta-translate');
  assert.ok(translateRoot.querySelector('.agy-beta-translate-body').textContent.includes('正在检查解析器'));

  // Resolve final translation
  resolveTranslate.resolve({
    ok: true,
    text: '正在检查解析器并验证边界情况。',
    cached: false,
    engineUsed: 'ai'
  });
  await flushMicrotasks();

  assert.equal(translateRoot.querySelector('.agy-beta-translate-body').textContent, '正在检查解析器并验证边界情况。');
  assert.equal(thinkingMd.getAttribute('data-agy-translate-hidden'), 'true');
  assert.equal(thinkingMd.hasAttribute('data-agy-translate-bilingual-src'), false);

  // Verify non-thinking blocks were NEVER touched
  assert.equal(toolGroup.querySelector('[data-agy-translate-root]'), null);
  assert.equal(workedFor.textContent, 'Worked for 4s');
  assert.equal(stageUpdate.textContent, 'Running verification steps');
  assert.equal(plannerResponse.querySelector('[data-agy-translate-root]'), null);
  assert.equal(plannerResponse.textContent, 'Final English answer must not translate.');
  assert.equal(collapsedThinking.querySelector('[data-agy-translate-root]'), null);

  // Per-block Original / Translated toggle pill
  const toggleBtn = translateRoot.querySelector('[data-testid="agy-thinking-translate-toggle"]');
  assert.ok(toggleBtn);
  assert.equal(toggleBtn.textContent, '原文');

  toggleBtn.click();
  assert.equal(thinkingMd.hasAttribute('data-agy-translate-hidden'), false);
  assert.equal(translateRoot.querySelector('.agy-beta-translate-body').textContent, '');
  assert.equal(translateRoot.querySelector('[data-testid="agy-thinking-translate-toggle"]').textContent, '译文');

  // Toggle back to translated
  translateRoot.querySelector('[data-testid="agy-thinking-translate-toggle"]').click();
  assert.equal(thinkingMd.getAttribute('data-agy-translate-hidden'), 'true');
  assert.equal(translateRoot.querySelector('.agy-beta-translate-body').textContent, '正在检查解析器并验证边界情况。');

  // Switch display mode to 'bilingual' without making extra RPCs
  harness.setOptions({ betaThinkingDisplay: 'bilingual' });
  controller.sync();
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 1);
  assert.equal(thinkingMd.hasAttribute('data-agy-translate-hidden'), false);
  assert.equal(thinkingMd.getAttribute('data-agy-translate-bilingual-src'), 'true');
  assert.equal(translateRoot.getAttribute('data-agy-translate-mode'), 'bilingual');

  controller.dispose();
});

// ---------------------------------------------------------------------------
// 6. Manual Mode + Subagent Tab Scope
// ---------------------------------------------------------------------------
test('Thinking manual trigger mode waits for user click and supports subagent-tab-conversation', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'zh-CN',
    betaThinkingTranslate: true,
    betaThinkingDisplay: 'replace',
    betaThinkingTrigger: 'manual'
  });
  const { h, document, api, env, requests, flushMicrotasks } = harness;

  const subMd = h('div', { 'data-markdown-root': 'true' },
    h('p', {}, 'Checking subagent search results.')
  );
  const subTab = h('div', { 'data-testid': 'subagent-tab-conversation' },
    h('div', {},
      h('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' }, 'Thought for 2s'),
      h('div', {}, subMd)
    )
  );
  document.body.appendChild(subTab);

  harness.setRequestHandler(method => {
    if (method === 'beta.translateThinking') {
      return { ok: true, text: '正在检查子智能体搜索结果。', cached: false, engineUsed: 'free' };
    }
    return { ok: true };
  });

  const controller = api.mountBetaAi(env);
  await flushMicrotasks();

  // Manual mode MUST NOT auto-translate
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 0);
  const manualBtn = subTab.querySelector('[data-testid="agy-thinking-translate-btn"]');
  assert.ok(manualBtn);
  assert.equal(manualBtn.textContent, '翻译思考过程');
  assert.equal(subMd.hasAttribute('data-agy-translate-hidden'), false);

  // Click triggers translation on demand
  manualBtn.click();
  await flushMicrotasks();

  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 1);
  assert.equal(subMd.getAttribute('data-agy-translate-hidden'), 'true');
  assert.equal(subTab.querySelector('.agy-beta-translate-body').textContent, '正在检查子智能体搜索结果。');
  assert.ok(subTab.querySelector('[data-testid="agy-thinking-translate-toggle"]'));

  controller.dispose();
});

// ---------------------------------------------------------------------------
// 7. Streaming Thinking Block Holds Pending Tail and Flushes After 480ms Idle
// ---------------------------------------------------------------------------
test('Streaming thinking block translates ready paragraphs immediately and flushes pendingTail after 480ms idle', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'zh-CN',
    betaThinkingTranslate: true,
    betaThinkingDisplay: 'replace',
    betaThinkingTrigger: 'auto'
  }, { useFakeTimers: true });
  const { h, document, api, env, timers, requests, flushMicrotasks } = harness;

  const trigger = h('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' },
    h('span', { className: 'animate-spin' }),
    'Thinking...'
  );
  const mdEl = h('div', { 'data-markdown-root': 'true' },
    h('p', {}, 'First finished thought.'),
    h('p', {}, 'Second unstable tail')
  );
  const view = h('div', { 'data-testid': 'conversation-view' },
    h('div', {}, trigger, h('div', {}, mdEl))
  );
  document.body.appendChild(view);

  harness.setRequestHandler((method, params) => {
    if (method === 'beta.translateThinking') {
      return { ok: true, text: `[ZH] ${params.text}`, cached: false, engineUsed: 'free' };
    }
    return { ok: true };
  });

  const controller = api.mountBetaAi(env);
  await flushMicrotasks();

  // Only the ready paragraph is translated immediately; pendingTail is held
  let tReqs = requests.filter(r => r.method === 'beta.translateThinking');
  assert.equal(tReqs.length, 1);
  assert.equal(tReqs[0].params.text, 'First finished thought.');

  // Advance 400ms (< 480ms): still held!
  timers.advance(400);
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 1);

  // Advance another 100ms (total 500ms >= 480ms): pendingTail flushes with contextPrev!
  timers.advance(100);
  await flushMicrotasks();
  tReqs = requests.filter(r => r.method === 'beta.translateThinking');
  assert.equal(tReqs.length, 2);
  assert.equal(tReqs[1].params.text, 'Second unstable tail');
  assert.equal(tReqs[1].params.contextPrev, 'First finished thought.');

  // When streaming completes with same text, already translated paragraphs are NOT re-requested
  trigger.textContent = 'Thought for 4s';
  controller.sync();
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 2);
  assert.ok(view.querySelector('.agy-beta-translate-body').textContent.includes('[ZH] First finished thought.'));
  assert.ok(view.querySelector('.agy-beta-translate-body').textContent.includes('[ZH] Second unstable tail'));

  controller.dispose();
});

// ---------------------------------------------------------------------------
// 8. Composer Ghost Text: Trigger ONLY on running -> idle when empty, Tab accept without send
// ---------------------------------------------------------------------------
test('Composer ghost text triggers only on running -> idle when empty, hides native placeholder via CSS attr, and accepts via Tab without submitting', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'zh-CN',
    betaComposerPredict: true
  });
  const { h, document, api, env, computedStyles, requests, flushMicrotasks } = harness;

  const placeholder = h('div', { className: 'lexical-placeholder' }, 'Ask anything...');
  const editor = h('div', { contenteditable: 'true', role: 'textbox' }, '\u200b'); // Lexical empty zero-width space
  const editorContainer = h('div', { className: 'editor-wrap' }, editor, placeholder);
  const inputBox = h('div', { 'data-testid': 'agent-input-box' }, editorContainer);
  const composerCard = h('div', { className: 'surface-composer-card' }, inputBox);

  // Subagent popup composer & search input should be ignored
  const subagentPopup = h('div', { 'data-testid': 'agy-subagent-popover' },
    h('div', { contenteditable: 'true', role: 'textbox' })
  );
  const searchBox = h('div', { role: 'search' },
    h('div', { contenteditable: 'true', role: 'textbox' })
  );

  const convView = h('div', { 'data-testid': 'conversation-view' },
    h('div', { 'data-testid': 'user-input-step' },
      h('div', { 'data-testid': 'user-message-bubble' }, 'Fix the login bug')
    ),
    h('div', { 'data-testid': 'agent-response' },
      h('div', { 'data-testid': 'planner-response-text' }, 'Fixed the token expiry check in auth.js.')
    ),
    composerCard
  );
  document.body.appendChild(subagentPopup);
  document.body.appendChild(searchBox);
  document.body.appendChild(convView);

  computedStyles.set(editor, {
    fontFamily: 'Inter, sans-serif',
    fontSize: '14px',
    lineHeight: '20px',
    paddingTop: '8px',
    paddingLeft: '12px'
  });

  harness.setRequestHandler(method => {
    if (method === 'beta.predictIntent') {
      return { ok: true, suggestion: '顺便补充一下单元测试' };
    }
    return { ok: true };
  });

  // Mount while idle: MUST NOT trigger prediction!
  const controller = api.mountBetaAi(env);
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 0);

  // Transition idle -> running: still no prediction
  harness.setRunning(true);
  harness.emit();
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 0);

  // Transition running -> idle with empty composer: triggers prediction ONCE!
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();

  const predReqs = requests.filter(r => r.method === 'beta.predictIntent');
  assert.equal(predReqs.length, 1);
  assert.equal(predReqs[0].params.conversationId, 'conv-1');
  assert.equal(predReqs[0].params.language, 'zh-CN');
  assert.deepEqual(JSON.parse(JSON.stringify(predReqs[0].params.turns)), [
    { user: 'Fix the login bug', assistant: 'Fixed the token expiry check in auth.js.' }
  ]);

  // Repeated sync while idle MUST NOT trigger a second prediction for the same turn
  controller.sync();
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 1);

  // Verify ghost overlay visual attributes & typography
  assert.equal(editorContainer.getAttribute('data-agy-ghost-active'), 'true');
  const ghost = editorContainer.querySelector('[data-testid="agy-composer-ghost-text"]');
  assert.ok(ghost);
  assert.equal(ghost.getAttribute('data-agy-powertools-root'), 'beta-ghost');
  assert.equal(ghost.querySelector('.agy-beta-ghost-label')?.textContent, '顺便补充一下单元测试');
  assert.equal(ghost.querySelector('kbd.agy-ghost-tab')?.textContent, 'Tab');
  assert.equal(ghost.style.fontSize, '14px');
  assert.equal(ghost.style.paddingLeft, '12px');
  // Lexical editor DOM was NOT mutated while idle
  assert.equal(editor.textContent, '\u200b');

  // Verify Tab is ignored when focus is outside composer
  document.activeElement = document.body;
  const tabOutside = { type: 'keydown', key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, target: document.body };
  document.dispatchEvent(tabOutside);
  assert.equal(tabOutside.defaultPrevented, false);
  assert.ok(editorContainer.querySelector('[data-testid="agy-composer-ghost-text"]'));

  // Verify Tab is ignored when IME composing
  document.activeElement = editor;
  const tabComposing = { type: 'keydown', key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: true, target: editor };
  document.dispatchEvent(tabComposing);
  assert.equal(tabComposing.defaultPrevented, false);
  assert.ok(editorContainer.querySelector('[data-testid="agy-composer-ghost-text"]'));

  // Verify Shift+Tab is ignored
  const shiftTab = { type: 'keydown', key: 'Tab', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, target: editor };
  document.dispatchEvent(shiftTab);
  assert.equal(shiftTab.defaultPrevented, false);

  // Verify plain Tab accepts suggestion via execCommand('insertText'), clears ghost, and NEVER sends Enter!
  const execCalls = [];
  let enterFired = false;
  editor.addEventListener('keydown', e => { if (e.key === 'Enter') enterFired = true; });
  document.execCommand = (cmd, showUi, val) => {
    execCalls.push({ cmd, showUi, val });
    editor.textContent = val;
    return true;
  };

  const tabAccept = { type: 'keydown', key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, target: editor };
  document.dispatchEvent(tabAccept);
  assert.equal(tabAccept.defaultPrevented, true);
  assert.equal(tabAccept.propagationStopped, true);
  assert.deepEqual(execCalls, [{ cmd: 'insertText', showUi: false, val: '顺便补充一下单元测试' }]);
  assert.equal(editor.textContent, '顺便补充一下单元测试');
  assert.equal(enterFired, false);
  assert.equal(editorContainer.hasAttribute('data-agy-ghost-active'), false);
  assert.equal(editorContainer.querySelector('[data-testid="agy-composer-ghost-text"]'), null);

  controller.dispose();
});

// ---------------------------------------------------------------------------
// 9. Ghost Text Fallback to beforeinput + Hide & Abort on Typing, Chat Switch, Non-Empty Tab
// ---------------------------------------------------------------------------
test('Composer ghost text aborts on typing, compositionstart, and chat switch, falls back to beforeinput, and ignores Tab when non-empty', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'en',
    betaComposerPredict: true
  });
  const { h, document, api, env, requests, flushMicrotasks } = harness;

  const editor = h('div', { contenteditable: 'true', role: 'textbox' });
  const editorWrap = h('div', {}, editor);
  const convView = h('div', { 'data-testid': 'conversation-view' },
    h('div', { 'data-testid': 'user-input-step' }, 'Run tests'),
    h('div', { 'data-testid': 'agent-response' }, 'All tests passed.'),
    h('div', { 'data-testid': 'agent-input-box' }, editorWrap)
  );
  document.body.appendChild(convView);

  let pendingPredict = null;
  harness.setRequestHandler((method, params) => {
    if (method === 'beta.predictIntent') {
      return new Promise(resolve => { pendingPredict = { resolve, reqId: params.reqId }; });
    }
    return { ok: true };
  });

  const controller = api.mountBetaAi(env);

  // Trigger running -> idle
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();

  assert.ok(pendingPredict);
  const firstReqId = pendingPredict.reqId;

  // User starts typing while prediction is in flight -> immediately calls beta.abortPredict!
  editor.textContent = 'H';
  document.dispatchEvent({ type: 'input', target: editor });
  assert.ok(requests.some(r => r.method === 'beta.abortPredict' && r.params.reqId === firstReqId));

  // Stale response resolving after abort MUST NOT mount ghost
  pendingPredict.resolve({ ok: true, suggestion: 'Commit the changes' });
  await flushMicrotasks();
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);

  // Next turn finishes while editor is NON-empty -> MUST NOT trigger prediction
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 1);

  // Clear editor, run a new turn with changed response -> triggers prediction
  editor.textContent = '';
  convView.querySelector('[data-testid="agent-response"]').textContent = 'Build succeeded with zero warnings.';
  pendingPredict = null;
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();

  assert.ok(pendingPredict);
  const secondReqId = pendingPredict.reqId;

  // Switch conversation while in-flight -> aborts prediction
  harness.setConvId('conv-2');
  harness.emit();
  assert.ok(requests.some(r => r.method === 'beta.abortPredict' && r.params.reqId === secondReqId));

  // New turn in conv-2 completes -> shows ghost -> test fallback to beforeinput (no execCommand)
  pendingPredict = null;
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();
  pendingPredict.resolve({ ok: true, suggestion: 'Deploy to staging' });
  await flushMicrotasks();

  assert.ok(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'));

  // If editor becomes non-empty before Tab, Tab is ignored
  document.activeElement = editor;
  editor.textContent = 'Manual text';
  const nonEmptyTab = { type: 'keydown', key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, target: editor };
  document.dispatchEvent(nonEmptyTab);
  assert.equal(nonEmptyTab.defaultPrevented, false);

  // Restore empty editor & verify beforeinput fallback when execCommand is unavailable
  editor.textContent = '';
  const beforeInputs = [];
  editor.addEventListener('beforeinput', e => beforeInputs.push(e));
  const fallbackTab = { type: 'keydown', key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, target: editor };
  document.dispatchEvent(fallbackTab);
  assert.equal(fallbackTab.defaultPrevented, true);
  assert.equal(beforeInputs.length, 1);
  assert.equal(beforeInputs[0].inputType, 'insertText');
  assert.equal(beforeInputs[0].data, 'Deploy to staging');

  // Test compositionstart hides ghost immediately
  convView.querySelector('[data-testid="agent-response"]').textContent = 'Staging deploy finished.';
  pendingPredict = null;
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();
  pendingPredict.resolve({ ok: true, suggestion: 'Run smoke tests' });
  await flushMicrotasks();
  assert.ok(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'));

  document.dispatchEvent({ type: 'compositionstart', target: editor });
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  assert.equal(editorWrap.hasAttribute('data-agy-ghost-active'), false);

  controller.dispose();
});

// ---------------------------------------------------------------------------
// 10. Complete Cleanup on dispose()
// ---------------------------------------------------------------------------
test('dispose() removes styles, observers, listeners, __agyBetaTranslateDelta, DOM roots/attributes, and aborts all in-flight RPCs', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'zh-CN',
    betaThinkingTranslate: true,
    betaThinkingDisplay: 'replace',
    betaThinkingTrigger: 'auto',
    betaComposerPredict: true
  }, { useFakeIO: true, useFakeTimers: true });
  const { h, document, api, env, ioInstances, moInstances, timers, requests, flushMicrotasks } = harness;

  const thinkingMd = h('div', { 'data-markdown-root': 'true' }, h('p', {}, 'Pending thinking block.'));
  const thinkingWrap = h('div', {},
    h('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' }, 'Thought for 1s'),
    h('div', {}, thinkingMd)
  );
  const editor = h('div', { contenteditable: 'true', role: 'textbox' });
  const editorWrap = h('div', {}, editor);
  const convView = h('div', { 'data-testid': 'conversation-view' },
    h('div', { 'data-testid': 'user-input-step' }, 'Hello'),
    h('div', { 'data-testid': 'agent-response' },
      thinkingWrap,
      h('div', { 'data-testid': 'planner-response-text' }, 'Hi there!')
    ),
    h('div', { 'data-testid': 'agent-input-box' }, editorWrap)
  );
  document.body.appendChild(convView);

  // Keep both translateThinking and predictIntent in flight!
  harness.setRequestHandler(method => {
    if (method === 'beta.translateThinking' || method === 'beta.predictIntent') {
      return new Promise(() => {});
    }
    return { ok: true };
  });

  const controller = api.mountBetaAi(env);
  ioInstances[0].trigger(thinkingMd, true);
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();

  const translateReq = requests.find(r => r.method === 'beta.translateThinking');
  const predictReq = requests.find(r => r.method === 'beta.predictIntent');
  assert.ok(translateReq);
  assert.ok(predictReq);

  // Stream partial delta so data-agy-translate-hidden is applied before dispose
  harness.context.__agyBetaTranslateDelta(translateReq.params.reqId, '部分译文');
  assert.equal(thinkingMd.getAttribute('data-agy-translate-hidden'), 'true');
  assert.ok(document.head.querySelector('style[data-agy-beta-ai-style]'));
  assert.equal(typeof harness.context.__agyBetaTranslateDelta, 'function');

  controller.dispose();

  // Style removed
  assert.equal(document.head.querySelector('style[data-agy-beta-ai-style]'), null);
  // Global delta hook removed
  assert.equal(harness.context.__agyBetaTranslateDelta, undefined);
  // Observers disconnected
  assert.ok(ioInstances.every(io => io.disconnected));
  assert.ok(moInstances.every(mo => mo.disconnected));
  // Listeners removed
  assert.equal(document._listenerCount(), 0);
  // Pending timers cleared
  assert.equal(timers.pendingCount(), 0);
  // All DOM nodes & attributes cleaned
  assert.equal(document.querySelector('[data-agy-translate-root="thinking"]'), null);
  assert.equal(document.querySelector('[data-agy-translate-hidden]'), null);
  assert.equal(document.querySelector('[data-agy-translate-bilingual-src]'), null);
  assert.equal(document.querySelector('[data-agy-ghost-active]'), null);
  assert.equal(document.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  // In-flight RPCs aborted
  assert.ok(requests.some(r => r.method === 'beta.abortTranslate' && r.params.reqId === translateReq.params.reqId));
  assert.ok(requests.some(r => r.method === 'beta.abortPredict' && r.params.reqId === predictReq.params.reqId));
});

test('Antigravity 2.35+ pointer-events-none composer placeholder CSS rule and .cursor-edit thinking fallback work cleanly', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'zh-CN',
    betaThinkingTranslate: true,
    betaThinkingDisplay: 'replace',
    betaThinkingTrigger: 'auto',
    betaComposerPredict: true
  });
  const { h, document, api, env, requests, flushMicrotasks } = harness;

  const cursorEdit = h('div', { className: 'cursor-edit group relative text-secondary-foreground pl-2' },
    h('p', {}, 'Checking Antigravity fallback wrapper without data-markdown-root.')
  );
  const scrollWrap = h('div', { className: 'overflow-y-auto pl-3 pt-0.5' }, h('div', {}, cursorEdit));
  const convView = h('div', { 'data-testid': 'conversation-view' },
    h('div', { 'data-testid': 'agent-response' },
      h('div', { className: 'relative' },
        h('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' }, 'Thought for 2s'),
        scrollWrap
      )
    )
  );
  document.body.appendChild(convView);

  harness.setRequestHandler(method => {
    if (method === 'beta.translateThinking') {
      return { ok: true, text: '正在检查不含 data-markdown-root 的思考正文容器。', cached: false, engineUsed: 'free' };
    }
    return { ok: true };
  });

  const controller = api.mountBetaAi(env);
  await flushMicrotasks();

  const styleCss = document.head.querySelector('style[data-agy-beta-ai-style]')?.textContent || '';
  assert.match(styleCss, /\[data-agy-ghost-active="true"\][^}]*\.pointer-events-none/);
  assert.equal(cursorEdit.getAttribute('data-agy-translate-hidden'), 'true');
  const translated = scrollWrap.querySelector('[data-agy-translate-root="thinking"]');
  assert.ok(translated, 'translated root should mount inside the native scroll wrapper next to .cursor-edit');
  assert.equal(translated.parentElement, cursorEdit.parentElement);
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 1);

  controller.dispose();
});

// ---------------------------------------------------------------------------
// 12. Thinking Re-open Zero-Reload Cache (Pre-IO Zero Flash) + Flush-Left Pill CSS
// ---------------------------------------------------------------------------
test('Thinking block re-open after streaming hits cache synchronously before IntersectionObserver fires and uses flush-left pill CSS', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'zh-CN',
    betaThinkingTranslate: true,
    betaThinkingDisplay: 'replace',
    betaThinkingTrigger: 'auto'
  }, { useFakeIO: true, useFakeTimers: true });
  const { h, document, api, env, ioInstances, timers, requests, flushMicrotasks } = harness;

  const trigger = h('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' },
    h('span', { className: 'animate-spin' }),
    'Thinking...'
  );
  const mdEl = h('div', { 'data-markdown-root': 'true' },
    h('p', {}, 'First streamed paragraph.'),
    h('p', {}, 'Second streamed paragraph.')
  );
  const bodyWrap = h('div', {}, mdEl);
  const blockWrap = h('div', {}, trigger, bodyWrap);
  const convView = h('div', { 'data-testid': 'conversation-view' }, blockWrap);
  document.body.appendChild(convView);

  harness.setRequestHandler((method, params) => {
    if (method === 'beta.translateThinking') {
      return { ok: true, text: `[译] ${params.text}`, cached: false, engineUsed: 'free' };
    }
    return { ok: true };
  });

  const controller = api.mountBetaAi(env);
  await flushMicrotasks();

  // Verify flush-left pill CSS and status breathing animation + reduced-motion rules
  const styleCss = document.head.querySelector('style[data-agy-beta-ai-style]')?.textContent || '';
  assert.match(styleCss, /\.agy-beta-pill\{[^}]*margin-left:-6px[^}]*border:1px solid transparent/);
  assert.match(styleCss, /\.agy-beta-translate-btn\{[^}]*margin-left:0/);
  assert.match(styleCss, /\.agy-beta-translate-bar \.agy-beta-pill ~ \.agy-beta-pill[^}]*margin-left:0/);
  assert.match(styleCss, /\.agy-beta-status\{[^}]*animation:agy-ghost-breathe 1\.8s ease-in-out infinite/);
  assert.match(styleCss, /@media \(prefers-reduced-motion: reduce\)\{[^}]*\.agy-beta-status\{animation:none!important\}/);

  // Become visible while streaming -> para 1 translates now, para 2 flushes at 480ms
  ioInstances[0].trigger(mdEl, true);
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 1);

  timers.advance(500);
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 2);

  // Streaming completes -> full joined markdown is stored in memo
  trigger.textContent = 'Thought for 3s';
  controller.sync();
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 2);

  // Collapse thinking block (remove body from DOM, set aria-expanded="false")
  trigger.setAttribute('aria-expanded', 'false');
  bodyWrap.remove();
  controller.sync();
  assert.equal(blockWrap.querySelector('[data-agy-translate-root="thinking"]'), null);

  // Re-expand with a brand-new DOM subtree; do NOT fire IntersectionObserver yet!
  const reopenedMd = h('div', { 'data-markdown-root': 'true' },
    h('p', {}, 'First streamed paragraph.'),
    h('p', {}, 'Second streamed paragraph.')
  );
  const reopenedWrap = h('div', {}, reopenedMd);
  trigger.setAttribute('aria-expanded', 'true');
  blockWrap.appendChild(reopenedWrap);

  controller.sync();
  await flushMicrotasks();

  // Instant 0ms render BEFORE IntersectionObserver fires, with 0 additional RPCs!
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 2);
  assert.equal(reopenedMd.getAttribute('data-agy-translate-hidden'), 'true');
  const reopenedRoot = reopenedWrap.querySelector('[data-agy-translate-root="thinking"]');
  assert.ok(reopenedRoot);
  const reopenedBody = reopenedRoot.querySelector('.agy-beta-translate-body').textContent;
  assert.ok(reopenedBody.includes('[译] First streamed paragraph.'));
  assert.ok(reopenedBody.includes('[译] Second streamed paragraph.'));

  // Firing IntersectionObserver later still triggers 0 additional RPCs
  ioInstances[0].trigger(reopenedMd, true);
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 2);

  // Also test paragraph-join fallback when a block was collapsed before post-stream sync
  const trigger2 = h('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' }, 'Thinking...');
  const md2 = h('div', { 'data-markdown-root': 'true' },
    h('p', {}, 'Alpha thought.'),
    h('p', {}, 'Beta thought.')
  );
  const wrap2 = h('div', {}, md2);
  const block2 = h('div', {}, trigger2, wrap2);
  convView.appendChild(block2);
  controller.sync();
  ioInstances[0].trigger(md2, true);
  await flushMicrotasks();
  timers.advance(500);
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 4);

  // Collapse immediately while still marked streaming, then reopen as finished
  trigger2.setAttribute('aria-expanded', 'false');
  wrap2.remove();
  controller.sync();

  const md2Reopen = h('div', { 'data-markdown-root': 'true' },
    h('p', {}, 'Alpha thought.'),
    h('p', {}, 'Beta thought.')
  );
  trigger2.textContent = 'Thought for 2s';
  trigger2.setAttribute('aria-expanded', 'true');
  block2.appendChild(h('div', {}, md2Reopen));
  controller.sync();
  await flushMicrotasks();

  assert.equal(requests.filter(r => r.method === 'beta.translateThinking').length, 4);
  assert.equal(md2Reopen.getAttribute('data-agy-translate-hidden'), 'true');
  assert.ok(block2.querySelector('.agy-beta-translate-body').textContent.includes('[译] Alpha thought.'));
  assert.ok(block2.querySelector('.agy-beta-translate-body').textContent.includes('[译] Beta thought.'));

  controller.dispose();
});

// ---------------------------------------------------------------------------
// 13. MutationObserver Excludes [contenteditable] Subtrees
// ---------------------------------------------------------------------------
test('MutationObserver ignores mutations inside contenteditable elements while observing normal DOM mutations', () => {
  const harness = createHarness({
    enabled: true,
    betaThinkingTranslate: true,
    betaComposerPredict: true
  }, { useFakeTimers: true });
  const { h, document, api, env, moInstances, timers } = harness;

  const editableChild = h('p', {}, 'Typing...');
  const editorTrue = h('div', { contenteditable: 'true', role: 'textbox' }, editableChild);
  const editorEmptyAttr = h('div', { contenteditable: '' }, h('span', {}, 'Bare attr'));
  const normalNode = h('div', { className: 'conversation-step' }, 'Step');
  document.body.appendChild(editorTrue);
  document.body.appendChild(editorEmptyAttr);
  document.body.appendChild(normalNode);

  const controller = api.mountBetaAi(env);
  assert.equal(moInstances.length, 1);
  assert.equal(timers.pendingCount(), 0);

  // Mutations on or inside contenteditable="true" or contenteditable="" MUST be ignored
  moInstances[0].trigger([{ target: editorTrue }]);
  moInstances[0].trigger([{ target: editableChild }]);
  moInstances[0].trigger([{ target: editableChild.firstChild }]);
  moInstances[0].trigger([{ target: editorEmptyAttr }]);
  moInstances[0].trigger([{ target: editorEmptyAttr.firstChild }]);
  assert.equal(timers.pendingCount(), 0);

  // Mutation outside contenteditable schedules debounced sync
  moInstances[0].trigger([{ target: normalNode }]);
  assert.equal(timers.pendingCount(), 1);

  controller.dispose();
  assert.equal(timers.pendingCount(), 0);
});

// ---------------------------------------------------------------------------
// 14. In-Memory Turn Suggestion Cache, Delete-to-Empty Restore, and Escape Dismissal
// ---------------------------------------------------------------------------
test('Accepting via Tab and deleting back to empty restores cached suggestion with 0 RPCs; Escape dismisses permanently for that turn (ready and loading)', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'zh-CN',
    betaComposerPredict: true
  }, { useFakeTimers: true });
  const { h, document, api, env, timers, requests, flushMicrotasks } = harness;

  const editor = h('div', { contenteditable: 'true', role: 'textbox' });
  const editorWrap = h('div', {}, editor);
  const assistantEl = h('div', { 'data-testid': 'planner-response-text' }, 'Implemented feature A.');
  const convView = h('div', { 'data-testid': 'conversation-view' },
    h('div', { 'data-testid': 'user-input-step' }, 'Build feature A'),
    h('div', { 'data-testid': 'agent-response' }, assistantEl),
    h('div', { 'data-testid': 'agent-input-box' }, editorWrap)
  );
  document.body.appendChild(convView);

  let pendingPredict = null;
  let nextSuggestion = '顺便补充一下单元测试';
  harness.setRequestHandler((method, params) => {
    if (method === 'beta.predictIntent') {
      if (pendingPredict === 'defer') {
        return new Promise(resolve => { pendingPredict = { resolve, reqId: params.reqId }; });
      }
      return { ok: true, suggestion: nextSuggestion };
    }
    return { ok: true };
  });

  const controller = api.mountBetaAi(env);

  // Turn 1 ends -> 1 RPC, ready ghost mounts
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();

  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 1);
  let ghost = editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]');
  assert.ok(ghost);
  assert.equal(ghost.getAttribute('data-agy-ghost-phase'), 'ready');
  assert.equal(ghost.querySelector('.agy-beta-ghost-label')?.textContent, '顺便补充一下单元测试');

  // Accept via Tab
  document.activeElement = editor;
  document.execCommand = (_cmd, _ui, val) => { editor.textContent = val; return true; };
  const tabEv = { type: 'keydown', key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, target: editor };
  document.dispatchEvent(tabEv);
  assert.equal(tabEv.defaultPrevented, true);
  assert.equal(editor.textContent, '顺便补充一下单元测试');
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);

  // User deletes text back to empty -> input event restores cached suggestion with 0 extra RPCs!
  editor.textContent = '';
  document.dispatchEvent({ type: 'input', target: editor });
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 1);
  ghost = editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]');
  assert.ok(ghost);
  assert.equal(ghost.getAttribute('data-agy-ghost-phase'), 'ready');
  assert.equal(ghost.querySelector('.agy-beta-ghost-label')?.textContent, '顺便补充一下单元测试');
  assert.equal(ghost.querySelector('kbd.agy-ghost-tab')?.textContent, 'Tab');

  // Paste hides ghost immediately; deleting back to empty restores it again with 0 extra RPCs
  document.dispatchEvent({ type: 'paste', target: editor });
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  editor.textContent = '';
  document.dispatchEvent({ type: 'input', target: editor });
  assert.ok(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'));
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 1);

  // beforeinput insertText hides immediately; beforeinput delete on empty does NOT hide
  document.dispatchEvent({ type: 'beforeinput', inputType: 'deleteContentBackward', target: editor });
  assert.ok(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'));
  document.dispatchEvent({ type: 'beforeinput', inputType: 'insertText', target: editor });
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  editor.textContent = '';
  document.dispatchEvent({ type: 'input', target: editor });
  assert.ok(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'));

  // Press Escape on ready ghost -> dismisses permanently for Turn 1!
  document.dispatchEvent({ type: 'keydown', key: 'Escape', target: editor });
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);

  // Deleting back to empty or clicking composer MUST NOT restore or re-request for Turn 1
  editor.textContent = '';
  document.dispatchEvent({ type: 'input', target: editor });
  document.dispatchEvent({ type: 'pointerdown', button: 0, isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 1);

  // Turn 2 enters loading state; pressing Escape during loading aborts and permanently dismisses Turn 2!
  assistantEl.textContent = 'Added unit tests for feature A.';
  pendingPredict = 'defer';
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 2);
  const turn2ReqId = pendingPredict.reqId;

  timers.advance(160);
  ghost = editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]');
  assert.ok(ghost);
  assert.equal(ghost.getAttribute('data-agy-ghost-phase'), 'loading');

  document.dispatchEvent({ type: 'keydown', key: 'Escape', target: editor });
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  assert.equal(timers.pendingCount(), 0);
  assert.ok(requests.some(r => r.method === 'beta.abortPredict' && r.params.reqId === turn2ReqId));

  // Late resolution and subsequent clicks MUST NOT show or re-request for Turn 2
  pendingPredict.resolve({ ok: true, suggestion: '推送代码' });
  await flushMicrotasks();
  document.dispatchEvent({ type: 'pointerdown', button: 0, isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 2);

  controller.dispose();
});

// ---------------------------------------------------------------------------
// 15. Option A Triggering: Idle Switch Guard, Pointerdown/Tab Focus, Blur Abort vs Turn-End, Blank Chat
// ---------------------------------------------------------------------------
test('Option A triggering: blank chat and programmatic focus fire 0 RPCs; trusted click/Tab triggers user-focus; blur aborts user-focus without poisoning dedupe but never aborts turn-end', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'en',
    betaComposerPredict: true
  }, { useFakeTimers: true, initialNow: 10000 });
  const { h, document, api, env, timers, requests, advanceNow, flushMicrotasks } = harness;

  const editor = h('div', { contenteditable: 'true', role: 'textbox' });
  const editorWrap = h('div', {}, editor);
  const stepsHost = h('div', { className: 'steps-host' });
  const convView = h('div', { 'data-testid': 'conversation-view' },
    stepsHost,
    h('div', { 'data-testid': 'agent-input-box' }, editorWrap)
  );
  const outsideBtn = h('button', {}, 'Outside');
  document.body.appendChild(outsideBtn);
  document.body.appendChild(convView);

  let deferred = null;
  let nextResp = { ok: true, suggestion: 'Check edge cases next' };
  harness.setRequestHandler((method, params) => {
    if (method === 'beta.predictIntent') {
      if (deferred === 'arm') {
        return new Promise(resolve => { deferred = { resolve, reqId: params.reqId }; });
      }
      return nextResp;
    }
    return { ok: true };
  });

  const controller = api.mountBetaAi(env);
  await flushMicrotasks();

  // 1) Brand-new blank chat (0 turns): trusted click fires 0 RPCs
  document.dispatchEvent({ type: 'pointerdown', button: 0, isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 0);

  // 2) Switch to an unpredicted old idle conversation with existing turns
  stepsHost.appendChild(h('div', { 'data-testid': 'user-input-step' }, 'Explain the cache layer'));
  stepsHost.appendChild(h('div', { 'data-testid': 'agent-response' },
    h('div', { 'data-testid': 'planner-response-text' }, 'The cache uses an in-memory LRU map.')
  ));
  harness.setConvId('conv-old');
  harness.emit();
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 0);

  // Programmatic focusin (no preceding external Tab) fires 0 RPCs
  document.dispatchEvent({ type: 'focusin', isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 0);

  // Untrusted pointerdown or right-click fires 0 RPCs
  document.dispatchEvent({ type: 'pointerdown', button: 0, isTrusted: false, target: editor });
  document.dispatchEvent({ type: 'pointerdown', button: 2, isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 0);

  // Trusted left-click pointerdown on empty composer fires 1 user-focus RPC
  deferred = 'arm';
  document.dispatchEvent({ type: 'pointerdown', button: 0, isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 1);
  const firstUserFocusReqId = deferred.reqId;

  // Let loading appear, then blur composer -> aborts user-focus WITHOUT poisoning dedupe!
  timers.advance(160);
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]')?.getAttribute('data-agy-ghost-phase'), 'loading');
  document.dispatchEvent({ type: 'focusout', target: editor, relatedTarget: outsideBtn });
  assert.ok(requests.some(r => r.method === 'beta.abortPredict' && r.params.reqId === firstUserFocusReqId));
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  assert.equal(timers.pendingCount(), 0);

  // Clicking back retries cleanly and mounts ready ghost!
  deferred = null;
  document.dispatchEvent({ type: 'pointerdown', button: 0, isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 2);
  assert.equal(editorWrap.querySelector('.agy-beta-ghost-label')?.textContent, 'Check edge cases next');

  // 3) Keyboard Tab -> focusin on another unpredicted idle conversation respects 350ms conv-switch guard & 150ms Tab window
  harness.setConvId('conv-old-2');
  harness.emit();
  // Within 350ms of conv switch: blocked even with external Tab
  advanceNow(100);
  document.activeElement = outsideBtn;
  document.dispatchEvent({ type: 'keydown', key: 'Tab', isTrusted: true, target: outsideBtn });
  advanceNow(20);
  document.dispatchEvent({ type: 'focusin', isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 2);

  // After > 350ms from conv switch + trusted external Tab within 150ms: triggers!
  advanceNow(400);
  document.dispatchEvent({ type: 'keydown', key: 'Tab', isTrusted: true, target: outsideBtn });
  advanceNow(50);
  nextResp = { ok: false, error: 'provider timeout' };
  document.dispatchEvent({ type: 'focusin', isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 3);

  // Error cooldown (60s): immediate re-click does NOT spam failing provider
  advanceNow(5000);
  document.dispatchEvent({ type: 'pointerdown', button: 0, isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 3);

  // After 60s cooldown expires, clicking retries
  advanceNow(61000);
  nextResp = { ok: true, suggestion: 'Retry succeeded' };
  document.dispatchEvent({ type: 'pointerdown', button: 0, isTrusted: true, target: editor });
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 4);
  assert.equal(editorWrap.querySelector('.agy-beta-ghost-label')?.textContent, 'Retry succeeded');

  // 4) Blurring during a turn-end prediction MUST NOT abort it!
  harness.setConvId('conv-turn-end');
  harness.emit();
  deferred = 'arm';
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();
  assert.equal(requests.filter(r => r.method === 'beta.predictIntent').length, 5);
  const turnEndReqId = deferred.reqId;

  document.dispatchEvent({ type: 'focusout', target: editor, relatedTarget: outsideBtn });
  assert.equal(requests.some(r => r.method === 'beta.abortPredict' && r.params.reqId === turnEndReqId), false);
  deferred.resolve({ ok: true, suggestion: 'Still mounted after blur' });
  await flushMicrotasks();
  assert.equal(editorWrap.querySelector('.agy-beta-ghost-label')?.textContent, 'Still mounted after blur');

  controller.dispose();
});

// ---------------------------------------------------------------------------
// 16. Playful Rotating Loading Placeholder, Grace Period, Tab Guard, and Cleanup
// ---------------------------------------------------------------------------
test('Loading placeholder waits 160ms grace, hides Tab badge, rotates every 2200ms without repeats, ignores Tab during loading, transitions to ready, and cleans up timers', async () => {
  const harness = createHarness({
    enabled: true,
    language: 'zh-CN',
    betaComposerPredict: true
  }, { useFakeTimers: true });
  const { h, document, api, env, timers, requests, flushMicrotasks } = harness;

  const editor = h('div', { contenteditable: 'true', role: 'textbox' });
  const editorWrap = h('div', {}, editor);
  const assistantEl = h('div', { 'data-testid': 'planner-response-text' }, 'Refactored the scheduler.');
  const convView = h('div', { 'data-testid': 'conversation-view' },
    h('div', { 'data-testid': 'user-input-step' }, 'Refactor scheduler'),
    h('div', { 'data-testid': 'agent-response' }, assistantEl),
    h('div', { 'data-testid': 'agent-input-box' }, editorWrap)
  );
  document.body.appendChild(convView);

  let pending = null;
  harness.setRequestHandler((method, params) => {
    if (method === 'beta.predictIntent') {
      return new Promise(resolve => { pending = { resolve, reqId: params.reqId }; });
    }
    return { ok: true };
  });

  const controller = api.mountBetaAi(env);

  // Trigger turn-end prediction
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();
  assert.ok(pending);

  // Before 160ms grace: no loading overlay mounted yet
  timers.advance(159);
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  assert.equal(editorWrap.hasAttribute('data-agy-ghost-active'), false);

  // At 160ms: loading overlay appears with phase="loading" and NO <kbd>Tab</kbd>
  timers.advance(1);
  assert.equal(editorWrap.getAttribute('data-agy-ghost-active'), 'true');
  let overlay = editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]');
  assert.ok(overlay);
  assert.equal(overlay.getAttribute('data-agy-ghost-phase'), 'loading');
  assert.equal(overlay.querySelector('kbd.agy-ghost-tab'), null);
  const firstPhrase = overlay.querySelector('.agy-beta-ghost-label')?.textContent || '';
  assert.ok(firstPhrase.length > 0);
  assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(firstPhrase), false);

  // Pressing Tab during loading MUST NOT accept or dismiss loading phrase
  document.activeElement = editor;
  let execCalled = false;
  document.execCommand = () => { execCalled = true; return true; };
  const tabDuringLoading = { type: 'keydown', key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, target: editor };
  document.dispatchEvent(tabDuringLoading);
  assert.equal(tabDuringLoading.defaultPrevented, false);
  assert.equal(execCalled, false);
  assert.equal(editor.textContent, '');
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]')?.getAttribute('data-agy-ghost-phase'), 'loading');

  // Rotates at 2200ms with 150ms cross-fade and NEVER repeats back-to-back
  let prevPhrase = firstPhrase;
  for (let i = 0; i < 6; i++) {
    timers.advance(2050);
    assert.equal(overlay.querySelector('.agy-beta-ghost-label')?.style?.opacity, '0');
    timers.advance(150);
    const nextPhrase = overlay.querySelector('.agy-beta-ghost-label')?.textContent || '';
    assert.equal(overlay.querySelector('.agy-beta-ghost-label')?.style?.opacity, '');
    assert.ok(nextPhrase.length > 0);
    assert.notEqual(nextPhrase, prevPhrase);
    assert.equal(/[\u00b7\u2022\u2027\u30fb]/.test(nextPhrase), false);
    prevPhrase = nextPhrase;
  }

  // Resolving RPC transitions cleanly to phase="ready" with <kbd>Tab</kbd> and clears all loading timers
  pending.resolve({ ok: true, suggestion: '跑一下全量测试' });
  await flushMicrotasks();
  assert.equal(timers.pendingCount(), 0);
  overlay = editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]');
  assert.ok(overlay);
  assert.equal(overlay.getAttribute('data-agy-ghost-phase'), 'ready');
  assert.equal(overlay.querySelector('.agy-beta-ghost-label')?.textContent, '跑一下全量测试');
  assert.equal(overlay.querySelector('kbd.agy-ghost-tab')?.textContent, 'Tab');

  // Empty resolution during loading removes loading overlay cleanly so native placeholder returns
  assistantEl.textContent = 'Scheduler tests green.';
  pending = null;
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();
  timers.advance(160);
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]')?.getAttribute('data-agy-ghost-phase'), 'loading');
  pending.resolve({ ok: true, suggestion: '' });
  await flushMicrotasks();
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  assert.equal(editorWrap.hasAttribute('data-agy-ghost-active'), false);
  assert.equal(timers.pendingCount(), 0);

  // Disposing mid cross-fade cleans up every timer and listener cleanly
  assistantEl.textContent = 'Ready for release.';
  pending = null;
  harness.setRunning(true);
  harness.emit();
  harness.setRunning(false);
  harness.emit();
  await flushMicrotasks();
  timers.advance(160 + 2050);
  assert.ok(timers.pendingCount() > 0);

  controller.dispose();
  assert.equal(timers.pendingCount(), 0);
  assert.equal(document._listenerCount(), 0);
  assert.equal(editorWrap.querySelector('[data-testid="agy-composer-ghost-text"]'), null);
  assert.equal(editorWrap.hasAttribute('data-agy-ghost-active'), false);
});
