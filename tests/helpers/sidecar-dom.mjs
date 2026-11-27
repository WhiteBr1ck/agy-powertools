import assert from 'node:assert/strict';
import vm from 'node:vm';

export function createSidecarDomSandbox(html, { fetchImpl, clock = Date }) {
  const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scriptMatches.length >= 1, 'Expected inline script in sidecar HTML');
  const elements = new Map();
  for (const [tag, id] of html.matchAll(/<[^<>]*?\bid="([^"]+)"[^<>]*>/g)) {
    elements.set(id, {
      id, hidden: /\shidden\b/.test(tag), disabled: false, checked: false,
      textContent: '', href: '', dataset: {}, listeners: new Map(),
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
      },
      async trigger(type) {
        for (const fn of this.listeners.get(type) || []) await fn();
      }
    });
  }
  const timeouts = [], intervals = [];
  const schedule = timers => (fn, ms) => timers.push({ id: timers.length + 1, fn, ms, cleared: false });
  const clear = timers => id => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  vm.runInNewContext(scriptMatches.at(-1)[1], {
    Date: clock,
    URLSearchParams,
    location: { search: '?token=test-tok', reload() {} },
    document: { documentElement: { lang: 'zh-CN' }, getElementById: id => elements.get(id) || null },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: fetchImpl,
    setTimeout: schedule(timeouts), clearTimeout: clear(timeouts),
    setInterval: schedule(intervals), clearInterval: clear(intervals)
  });
  return { elements, timeouts, intervals };
}
