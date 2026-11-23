import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractTranscriptGoal, resolveConversationGoal, createGoalsStore } from '../lib/goals.mjs';

test('extractTranscriptGoal tracks /goal activation, completion, and cancellation markers', () => {
  const activeSteps = [
    { step_index: 0, type: 'USER_INPUT', created_at: '2026-11-24T05:00:00Z', content: '<USER_REQUEST>\n/goal 把全部测试修绿并清理无用导入\n</USER_REQUEST>' },
    { step_index: 1, type: 'PLANNER_RESPONSE', created_at: '2026-11-24T05:01:00Z', content: '正在修复第 1 组测试…' }
  ];
  const txActive = extractTranscriptGoal(activeSteps);
  assert.equal(txActive.status, 'active');
  assert.equal(txActive.text, '把全部测试修绿并清理无用导入');
  assert.equal(txActive.stepIndex, 0);

  const completedSteps = [
    ...activeSteps,
    { step_index: 2, type: 'PLANNER_RESPONSE', created_at: '2026-11-24T05:05:00Z', content: '全部通过！\n<!-- GOAL_COMPLETE -->' }
  ];
  const txCompleted = extractTranscriptGoal(completedSteps);
  assert.equal(txCompleted.status, 'completed');
  assert.equal(txCompleted.completedStepIndex, 2);

  const cancelledSteps = [
    ...activeSteps,
    { step_index: 3, type: 'PLANNER_RESPONSE', created_at: '2026-11-24T05:06:00Z', content: '已取消\n<!-- GOAL_CANCELLED -->' }
  ];
  assert.equal(extractTranscriptGoal(cancelledSteps).status, 'cleared');
});

test('createGoalsStore and resolveConversationGoal support live edits, pause/resume elapsed time, and clearing native goals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-goals-'));
  try {
    const store = createGoalsStore(dir);
    const txGoal = {
      text: '原始目标内容',
      status: 'active',
      stepIndex: 2,
      startedAtMs: 1000,
      updatedAtMs: 1000,
      completedStepIndex: null
    };

    const initial = resolveConversationGoal(txGoal, store.get('conv-1'));
    assert.equal(initial.status, 'active');
    assert.equal(initial.text, '原始目标内容');
    assert.equal(initial.custom, false);

    store.save('conv-1', { text: '/goal 修改后的新目标内容', sourceStepIndex: 2, currentStepIndex: 4, startedAtMs: 1000, now: 5000 });
    const edited = resolveConversationGoal(txGoal, store.get('conv-1'));
    assert.equal(edited.status, 'active');
    assert.equal(edited.text, '修改后的新目标内容');
    assert.equal(edited.startedAtMs, 1000);
    assert.equal(edited.updatedAtMs, 5000);
    assert.equal(edited.custom, true);

    store.setStatus('conv-1', 'paused', { now: 9000 });
    const paused = resolveConversationGoal(txGoal, store.get('conv-1'));
    assert.equal(paused.status, 'paused');
    assert.equal(paused.pausedElapsedMs, 8000);

    store.setStatus('conv-1', 'active', { now: 20000 });
    const resumed = resolveConversationGoal(txGoal, store.get('conv-1'));
    assert.equal(resumed.status, 'active');
    assert.equal(resumed.startedAtMs, 12000);

    store.setStatus('conv-1', 'cleared', { sourceStepIndex: 2, now: 25000 });
    const cleared = resolveConversationGoal(txGoal, store.get('conv-1'));
    assert.equal(cleared.status, 'cleared');
    assert.equal(cleared.clearedNative, true);

    assert.throws(() => store.save('../bad', { text: 'x' }), /无效/);
    assert.throws(() => store.save('conv-1', { text: '   ' }), /不能为空/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
