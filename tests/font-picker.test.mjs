import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_SETTINGS } from '../lib/settings.mjs';

function picker(loadLocalFonts, fontError = '') {
  let states = [], index = 0, options = { ...DEFAULT_SETTINGS };
  const calls = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'fragment',
    useState(initial) { const n = index++; if (!(n in states)) states[n] = initial; return [states[n], value => { states[n] = value; }]; },
    useEffect() {}, useSyncExternalStore: (_, snapshot) => snapshot()
  };
  const context = vm.createContext({ React, window: {},
    document: { createElement: () => ({ dataset: {} }), head: { append() {} } },
    HC: 'popover', IC: 'trigger', JC: 'content', Uy: 'button', UP: 'row', TP: 'card', VP: 'section', XP: 'switch', dq: 'icon'
  });
  vm.runInContext(readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8'), context);
  const panels = context.__agyPanels({ options: () => options, t: value => value, settingsError: () => '', customFontError: () => fontError, loadLocalFonts, state: () => null,
    async change(patch) { calls.push(JSON.parse(JSON.stringify(patch))); options = { ...options, ...patch }; }
  });
  function all(node, predicate) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(value => all(value, predicate));
    return [...predicate(node) ? [node] : [], ...all(node.children, predicate)];
  }
  const component = all(panels.Settings(), node => node.type?.name === 'CustomFontSetting')[0].type;
  states = [];
  const render = () => { index = 0; return component(); };
  const byId = (tree, id) => all(tree, node => node.props?.['data-testid'] === id);
  const open = tree => all(tree, node => node.type === 'popover')[0].props.onOpenChange(true);
  return { render, all, byId, open, calls };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('已安装字体搜索和选择，选择本身不保存，应用后才保存', async () => {
  let queries = 0;
  const ui = picker(async () => { queries++; return ['Arial', 'Maple Mono NF CN', 'Menlo']; });
  ui.open(ui.render());
  await tick();
  let tree = ui.render();
  assert.equal(ui.byId(tree, 'agy-font-picker-option').length, 3);
  ui.byId(tree, 'agy-font-picker-search')[0].props.onChange({ target: { value: 'mApLe' } });
  tree = ui.render();
  const matches = ui.byId(tree, 'agy-font-picker-option');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].props['data-font-family'], 'Maple Mono NF CN');
  matches[0].props.onClick();
  tree = ui.render();
  assert.equal(ui.byId(tree, 'agy-custom-font-input')[0].props.value, 'Maple Mono NF CN');
  assert.deepEqual(ui.calls, []);
  ui.all(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await tick();
  assert.deepEqual(ui.calls, [{ customFont: 'Maple Mono NF CN' }]);
  ui.open(ui.render());
  await tick();
  assert.equal(queries, 1);
});

test('读取失败、权限拒绝及 API 不可用均明确显示错误，允许主动重试', async () => {
  for (const query of [async () => { throw new Error('此客户端不支持读取已安装字体列表'); }, async () => { throw new Error('用户拒绝字体读取权限'); }, async () => { throw '字体枚举异常'; }]) {
    const ui = picker(query);
    ui.open(ui.render());
    await tick();
    const tree = ui.render();
    assert.equal(ui.byId(tree, 'agy-font-picker-error').length, 1);
    assert.match(ui.byId(tree, 'agy-font-picker-error')[0].children[0], /读取字体失败/);
    assert.equal(ui.byId(tree, 'agy-font-picker-option').length, 0);
  }
  let allowed = false;
  const ui = picker(async () => { if (!allowed) throw new Error('权限被拒绝'); return ['Menlo']; });
  ui.open(ui.render());
  await tick();
  allowed = true;
  ui.byId(ui.render(), 'agy-font-picker-refresh')[0].props.onClick();
  await tick();
  const tree = ui.render();
  assert.equal(ui.byId(tree, 'agy-font-picker-error').length, 0);
  assert.equal(ui.byId(tree, 'agy-font-picker-option').length, 1);
});

test('字体错误就近展示并允许同名重试，弹层包含观察器和翻译隔离标记', async () => {
  const ui = picker(async () => ['System', 'Terminal'], '字体尚未安装');
  let tree = ui.render();
  assert.equal(ui.byId(tree, 'agy-custom-font-error')[0].children[0], '字体尚未安装');
  assert.equal(ui.byId(tree, 'agy-custom-font-save')[0].props.disabled, false);
  assert.equal(ui.byId(tree, 'agy-custom-font-reset')[0].props.disabled, false);
  ui.all(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await tick();
  assert.deepEqual(ui.calls, [{ customFont: '' }]);
  ui.open(ui.render());
  await tick();
  tree = ui.render();
  assert.equal(ui.all(ui.byId(tree, 'agy-font-picker')[0], node => node.props['data-agy-powertools-root'] === 'font-picker').length, 1);
  assert.deepEqual(ui.byId(tree, 'agy-font-picker-option').map(node => node.children[0].children[0]), ['System', 'Terminal']);
  assert.ok(ui.byId(tree, 'agy-font-picker-option').every(node => node.children[0].type === 'samp' && node.children[0].props.translate === 'no'));
});

test('字体列表支持上下循环与 Home、End 导航', async () => {
  const ui = picker(async () => ['Arial', 'Inter', 'Menlo']);
  ui.open(ui.render());
  await tick();
  const tree = ui.render(), options = ui.byId(tree, 'agy-font-picker-option');
  let focused = -1;
  const nodes = options.map((_, i) => ({ focus: () => { focused = i; } }));
  nodes.forEach(node => { node.parentElement = { querySelectorAll: () => nodes }; });
  for (const [index, key, expected] of [[0, 'ArrowUp', 2], [2, 'ArrowDown', 0], [1, 'Home', 0], [0, 'End', 2]]) {
    options[index].props.onKeyDown({ key, preventDefault() {}, currentTarget: nodes[index] });
    assert.equal(focused, expected);
  }
});
