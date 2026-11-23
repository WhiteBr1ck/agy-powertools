import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VALID_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const VALID_STATUSES = new Set(['active', 'paused', 'completed', 'cleared']);

function normalizeGoalText(raw) {
  return String(raw || '').replace(/\r\n/g, '\n').replace(/^\/goal\b\s*/i, '').trim().slice(0, 8000);
}

export function extractTranscriptGoal(steps = [], database = null) {
  if (!Array.isArray(steps) || !steps.length) return null;
  let current = null;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== 'object') continue;
    const timing = database?.times?.get?.(step.step_index);
    const stepMs = timing?.createdMs ?? (step.created_at ? Date.parse(step.created_at) : null);

    if (step.type === 'USER_INPUT') {
      const content = typeof step.content === 'string' ? step.content : '';
      if (/^Error: The stream was interrupted/i.test(content)) continue;
      const reqMatch = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      const userReq = (reqMatch ? reqMatch[1] : content).trim();
      const hasSlashGoal = /^\/goal(?:\s|$)/i.test(userReq) || content.includes('/goal is a [Slash Command]:');
      if (hasSlashGoal) {
        const text = normalizeGoalText(userReq) || '目标任务';
        current = {
          text,
          status: 'active',
          stepIndex: Number.isInteger(step.step_index) ? step.step_index : i,
          startedAtMs: Number.isFinite(stepMs) ? stepMs : null,
          updatedAtMs: Number.isFinite(stepMs) ? stepMs : null,
          completedStepIndex: null
        };
      }
      continue;
    }

    if (current && step.type === 'PLANNER_RESPONSE') {
      const reply = typeof step.content === 'string' ? step.content : '';
      if (reply.includes('<!-- GOAL_COMPLETE -->')) {
        current.status = 'completed';
        current.completedStepIndex = Number.isInteger(step.step_index) ? step.step_index : i;
      } else if (reply.includes('<!-- GOAL_CANCELLED -->')) {
        current.status = 'cleared';
        current.completedStepIndex = Number.isInteger(step.step_index) ? step.step_index : i;
      }
    }
  }
  return current;
}

export function resolveConversationGoal(transcriptGoal, storedEntry) {
  const tx = transcriptGoal && typeof transcriptGoal === 'object' ? transcriptGoal : null;
  const saved = storedEntry && typeof storedEntry === 'object' ? storedEntry : null;

  if (saved) {
    const txStep = Number.isInteger(tx?.stepIndex) ? tx.stepIndex : -1;
    const savedStep = Number.isInteger(saved.sourceStepIndex) ? saved.sourceStepIndex : -1;
    if (tx && txStep > savedStep) {
      if (tx.status !== 'active') return null;
      return {
        text: tx.text,
        status: 'active',
        startedAtMs: tx.startedAtMs || Date.now(),
        updatedAtMs: tx.updatedAtMs || tx.startedAtMs || Date.now(),
        stepIndex: txStep,
        custom: false
      };
    }
    if (saved.status === 'cleared' || saved.status === 'completed') {
      return saved.status === 'cleared' ? { status: 'cleared', clearedNative: Boolean(tx && tx.status === 'active'), text: '' } : null;
    }
    if (tx?.status === 'completed' && Number.isInteger(tx.completedStepIndex) && tx.completedStepIndex > (saved.editedAfterStepIndex ?? -1)) {
      return null;
    }
    const baseStart = saved.startedAtMs || tx?.startedAtMs || saved.updatedAtMs || Date.now();
    const pausedAccum = Number(saved.pausedElapsedMs) > 0 ? Number(saved.pausedElapsedMs) : null;
    return {
      text: saved.text,
      status: saved.status === 'paused' ? 'paused' : 'active',
      startedAtMs: baseStart,
      updatedAtMs: saved.updatedAtMs || baseStart,
      pausedElapsedMs: saved.status === 'paused' ? pausedAccum : null,
      stepIndex: Math.max(txStep, savedStep),
      custom: true
    };
  }

  if (tx && tx.status === 'active') {
    const ts = tx.startedAtMs || Date.now();
    return {
      text: tx.text,
      status: 'active',
      startedAtMs: ts,
      updatedAtMs: tx.updatedAtMs || ts,
      pausedElapsedMs: null,
      stepIndex: tx.stepIndex,
      custom: false
    };
  }
  return null;
}

export function createGoalsStore(directory = join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-powertools')) {
  const filePath = join(directory, 'goals.json');

  function readAll() {
    try {
      if (!existsSync(filePath)) return {};
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeAll(map) {
    mkdirSync(directory, { recursive: true });
    const entries = Object.entries(map)
      .filter(([id, item]) => VALID_ID_RE.test(id) && item && typeof item === 'object' && VALID_STATUSES.has(item.status))
      .sort((a, b) => (Number(b[1].updatedAtMs) || 0) - (Number(a[1].updatedAtMs) || 0))
      .slice(0, 200);
    const clean = Object.fromEntries(entries);
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n', 'utf8');
    renameSync(tmp, filePath);
    return clean;
  }

  function ensureValidId(conversationId) {
    const id = String(conversationId || '').trim();
    if (!VALID_ID_RE.test(id)) throw new Error('无效的会话标识');
    return id;
  }

  return {
    get(conversationId) {
      if (!VALID_ID_RE.test(String(conversationId || ''))) return null;
      return readAll()[conversationId] || null;
    },
    save(conversationId, { text, sourceStepIndex = -1, currentStepIndex = -1, startedAtMs = null, now = Date.now() } = {}) {
      const id = ensureValidId(conversationId);
      const normalized = normalizeGoalText(text);
      if (!normalized) throw new Error('目标内容不能为空');
      const all = readAll();
      const prev = all[id];
      const startMs = (prev && prev.status !== 'cleared' && Number.isFinite(prev.startedAtMs))
        ? prev.startedAtMs
        : (Number.isFinite(startedAtMs) && startedAtMs > 0 ? startedAtMs : now);
      const next = {
        text: normalized,
        status: prev?.status === 'paused' ? 'paused' : 'active',
        startedAtMs: startMs,
        updatedAtMs: now,
        pausedElapsedMs: prev?.status === 'paused' ? (prev.pausedElapsedMs ?? Math.max(0, now - startMs)) : null,
        sourceStepIndex: Math.max(Number.isInteger(prev?.sourceStepIndex) ? prev.sourceStepIndex : -1, Number.isInteger(sourceStepIndex) ? sourceStepIndex : -1),
        editedAfterStepIndex: Number.isInteger(currentStepIndex) ? currentStepIndex : -1
      };
      all[id] = next;
      writeAll(all);
      return next;
    },
    setStatus(conversationId, status, { fallbackText = '', sourceStepIndex = -1, startedAtMs = null, now = Date.now() } = {}) {
      const id = ensureValidId(conversationId);
      if (!['active', 'paused', 'cleared'].includes(status)) throw new Error('不支持的目标状态');
      const all = readAll();
      const prev = all[id];
      if (status === 'cleared') {
        const next = {
          text: '',
          status: 'cleared',
          startedAtMs: null,
          updatedAtMs: now,
          pausedElapsedMs: null,
          sourceStepIndex: Math.max(Number.isInteger(prev?.sourceStepIndex) ? prev.sourceStepIndex : -1, Number.isInteger(sourceStepIndex) ? sourceStepIndex : -1),
          editedAfterStepIndex: -1
        };
        all[id] = next;
        writeAll(all);
        return next;
      }
      const text = normalizeGoalText(prev?.text || fallbackText);
      if (!text) throw new Error('当前没有可操作的目标');
      const prevStart = Number.isFinite(prev?.startedAtMs) && prev.startedAtMs > 0
        ? prev.startedAtMs
        : (Number.isFinite(startedAtMs) && startedAtMs > 0 ? startedAtMs : now);
      let nextStart = prevStart;
      let pausedElapsedMs = null;
      if (status === 'paused') {
        pausedElapsedMs = prev?.status === 'paused' && Number.isFinite(prev.pausedElapsedMs)
          ? prev.pausedElapsedMs
          : Math.max(0, now - prevStart);
      } else if (prev?.status === 'paused' && Number.isFinite(prev.pausedElapsedMs)) {
        nextStart = Math.max(1, now - prev.pausedElapsedMs);
      }
      const next = {
        text,
        status,
        startedAtMs: nextStart,
        updatedAtMs: now,
        pausedElapsedMs,
        sourceStepIndex: Math.max(Number.isInteger(prev?.sourceStepIndex) ? prev.sourceStepIndex : -1, Number.isInteger(sourceStepIndex) ? sourceStepIndex : -1),
        editedAfterStepIndex: prev?.editedAfterStepIndex ?? -1
      };
      all[id] = next;
      writeAll(all);
      return next;
    }
  };
}
