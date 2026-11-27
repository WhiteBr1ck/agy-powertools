import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAuxPaneHtml } from '../lib/sidecar-ui.mjs';
import { createSidecarDomSandbox } from './helpers/sidecar-dom.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const idle = { status: 'idle' };
const available = { status: 'available', version: '2.0.0', canInstall: true, notes: 'Release notes', releaseUrl: 'https://example.org/release' };

async function sidecar(initial = idle, clock) {
  const replies = {
    '/api/status': { healthy: true, update: initial },
    '/api/update/check': available,
    '/api/update/install': { status: 'preparing' },
    '/api/update/status': idle
  };
  const { elements, intervals } = createSidecarDomSandbox(renderAuxPaneHtml({ language: 'en' }), {
    clock,
    fetchImpl: async url => {
      const data = await replies[url.split('?')[0]];
      return { ok: !data.error || !!data.status, json: async () => data };
    }
  });
  await tick();
  const el = id => elements.get(id);
  return {
    replies, el, check: el('check-update-btn'), install: el('install-update-btn'), feedback: el('update-feedback'),
    click: async btn => { await btn.trigger('click'); await tick(); },
    fastPoll: () => intervals.find(i => i.ms === 900 && !i.cleared),
    poll: () => intervals.find(i => i.ms === 3000).fn()
  };
}

test('a restarted sidecar clears observed installation progress even if it never sees completed (#100)', async () => {
  const ui = await sidecar({ status: 'installing' });
  assert.match(ui.feedback.textContent, /Installing/);
  assert.equal(ui.check.disabled, true);
  ui.replies['/api/status'].update = idle;
  await ui.poll();
  assert.equal(ui.feedback.hidden, true);
  assert.equal(ui.feedback.textContent, '');
  assert.equal(ui.check.disabled, false);
});

test('install submission, slow status and fast progress polls can finish out of order', async () => {
  const ui = await sidecar();
  await ui.click(ui.check);
  const post = Promise.withResolvers();
  ui.replies['/api/update/install'] = post.promise;
  await ui.click(ui.install);
  await ui.poll(); // idle while the POST is still pending
  assert.equal(ui.check.disabled, true);
  assert.equal(ui.install.disabled, true);

  const delayed = Promise.withResolvers();
  ui.replies['/api/status'] = delayed.promise;
  const oldIdle = ui.poll();
  post.resolve({ status: 'preparing' });
  await tick();
  delayed.resolve({ healthy: true, update: idle });
  await oldIdle;
  assert.match(ui.feedback.textContent, /Preparing/);
  assert.equal(ui.check.disabled, true);

  const stale = Promise.withResolvers();
  ui.replies['/api/status'] = stale.promise;
  const oldProgress = ui.poll();
  const fast = ui.fastPoll();
  await fast.fn(); // dedicated update/status returns idle
  stale.resolve({ healthy: true, update: { status: 'installing' } });
  await oldProgress;
  assert.equal(fast.cleared, true);
  assert.equal(ui.feedback.hidden, true);
  assert.equal(ui.check.disabled, false);
  for (const id of ['install-update-btn', 'download-link', 'update-notes']) assert.equal(ui.el(id).hidden, true, id);
});

test('idle preserves failure details and newer manual check feedback', async () => {
  for (const status of ['failed', 'rolled-back']) {
    const ui = await sidecar();
    await ui.click(ui.check);
    const availableMessage = ui.feedback.textContent;
    await ui.poll();
    assert.equal(ui.feedback.textContent, availableMessage);
    assert.equal(ui.install.hidden, false);
    await ui.click(ui.install);
    ui.replies['/api/update/status'] = { status, error: 'disk full' };
    const fast = ui.fastPoll();
    await fast.fn();
    await ui.poll();
    assert.match(ui.feedback.textContent, /disk full/);
    assert.equal(ui.feedback.hidden, false);
    assert.equal(ui.install.disabled, false);
    assert.equal(fast.cleared, true);

    ui.replies['/api/update/check'] = { status: 'current' };
    await ui.click(ui.check);
    await ui.poll();
    assert.match(ui.feedback.textContent, /Up to date/);
    assert.equal(ui.feedback.hidden, false);
  }
});

test('idle dismisses completed feedback but preserves an install POST error for retry', async () => {
  const ui = await sidecar({ status: 'completed' });
  assert.match(ui.feedback.textContent, /completed/i);
  ui.replies['/api/status'].update = idle;
  await ui.poll();
  assert.equal(ui.feedback.hidden, true);

  await ui.click(ui.check);
  ui.replies['/api/update/install'] = { error: 'Worker could not start' };
  await ui.click(ui.install);
  await ui.poll();
  assert.equal(ui.feedback.textContent, 'Worker could not start');
  assert.equal(ui.feedback.hidden, false);
  assert.equal(ui.install.hidden, false);
  assert.equal(ui.install.disabled, false);
  assert.equal(ui.fastPoll(), undefined);
});

test('a previous persisted failure cannot replace the error from a later install retry', async () => {
  let now = 1000;
  const ui = await sidecar(idle, { now: () => now });
  await ui.click(ui.check);
  await ui.click(ui.install);

  now += 100;
  const previousFailure = { status: 'failed', at: now, error: 'Invalid package' };
  ui.replies['/api/update/status'] = previousFailure;
  await ui.fastPoll().fn();
  assert.match(ui.feedback.textContent, /Invalid package/);

  now += 100;
  ui.replies['/api/update/install'] = { error: 'Worker could not start' };
  await ui.click(ui.install);
  ui.replies['/api/status'].update = previousFailure;
  await ui.poll();
  assert.equal(ui.feedback.textContent, 'Worker could not start');
  assert.equal(ui.install.disabled, false);
});
