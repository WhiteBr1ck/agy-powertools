import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SUPPORTED_LANGUAGES } from './locales/index.mjs';

export const TRANSLATION_ENGINES = Object.freeze(['free', 'openai', 'gemini']);
export const TRANSLATION_DISPLAY_MODES = Object.freeze(['replace', 'bilingual']);
const TARGET_LANG_META = Object.freeze({
  'zh-CN': Object.freeze({ google: 'zh-CN', bing: 'zh-Hans', llmLabel: '简体中文' }),
  'zh-TW': Object.freeze({ google: 'zh-TW', bing: 'zh-Hant', llmLabel: '繁體中文（台灣科技與軟體開發常用術語）' }),
  fr: Object.freeze({ google: 'fr', bing: 'fr', llmLabel: 'French (natural, concise technical French)' }),
  ja: Object.freeze({ google: 'ja', bing: 'ja', llmLabel: 'Japanese (natural, concise technical Japanese)' }),
  ko: Object.freeze({ google: 'ko', bing: 'ko', llmLabel: 'Korean (natural, concise technical Korean)' }),
  de: Object.freeze({ google: 'de', bing: 'de', llmLabel: 'German (natural, concise technical German)' }),
  es: Object.freeze({ google: 'es', bing: 'es', llmLabel: 'Spanish (natural, concise technical Spanish)' }),
  ru: Object.freeze({ google: 'ru', bing: 'ru', llmLabel: 'Russian (natural, concise technical Russian)' })
});
const targetLangMeta = lang => TARGET_LANG_META[lang] || TARGET_LANG_META['zh-CN'];

export const LLM_PRESETS = Object.freeze({
  openai: Object.freeze({ engine: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }),
  deepseek: Object.freeze({ engine: 'openai', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
  gemini: Object.freeze({ engine: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' }),
  openrouter: Object.freeze({ engine: 'openai', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' }),
  ollama: Object.freeze({ engine: 'openai', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' })
});

const MAX_CACHE_ENTRIES = 4000;
const FREE_CHUNK_LIMIT = 1400;
const FREE_CONCURRENCY = 3;
const FREE_COOLDOWN_MS = 60_000;
const BENCHMARK_TTL_MS = 10 * 60_000;
const BING_SESSION_TTL_MS = 20 * 60_000;
const HTTP_TIMEOUT_FREE_MS = 8_000;
const HTTP_TIMEOUT_PROBE_MS = 4_500;
const HTTP_TIMEOUT_LLM_MS = 20_000;
const DESKTOP_EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const FREE_PROVIDER_LABELS = Object.freeze({
  'google-clients5': 'Google (clients5)',
  'google-gtx': 'Google (gtx)',
  'microsoft-bing': 'Bing'
});

export function normalizeTranslationBaseUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${path}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

export function isValidTranslationBaseUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 300 || /[\s"'<>\x00-\x1f]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password || parsed.hash) return false;
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function normalizeTranslationModel(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isValidTranslationModel(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return trimmed.length <= 120 && !/[\s\x00-\x1f"'<>]/.test(trimmed);
}

export function maskApiKey(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  if (!key) return '';
  if (key.length < 8) return '***';
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

// Single-pass token pattern ordered from broadest structural constructs to short refs.
const TECHNICAL_TOKEN_RE = /```[\s\S]*?```|`[^`\r\n]+`|https?:\/\/[^\s)>"'`\],;]+(?<![.,;:])|(?:(?<=^|[\s(\["'`=:,])(?:~|\.{1,2})?\/(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\/)*(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_.-]+\/){2,}(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_.-]+\\)+(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_-]*[0-9_.-][a-zA-Z0-9_.-]*\/(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)|[a-zA-Z0-9_.-]+\/(?:[a-zA-Z0-9_-]*[0-9_-][a-zA-Z0-9_.-]*|[a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+))(?:#L\d+(?:-L?\d+)?)?|[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+#L\d+(?:-L?\d+)?)|\b[a-zA-Z0-9_-]+\.(?:[mc]?js|tsx?|jsx?|py|go|rs|java|c|cpp|h|hpp|json|ya?ml|toml|md|css|scss|html|sh|bash|zsh|ps1|log|txt|sql|vue|svelte|mjs|cjs|mts|cts)(?:#L\d+(?:-L?\d+)?)?\b|(?:^|(?<=[\s(,]))--[a-zA-Z0-9][a-zA-Z0-9_-]*(?:=[^\s,;)]+)?|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|@[a-zA-Z0-9_.-]+|#\d+\b|\bv\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?\b/g;

function chooseMarkerPair(text) {
  const candidates = [
    ['⟦', '⟧'],
    ['⟨', '⟩'],
    ['〚', '〛']
  ];
  for (const [open, close] of candidates) {
    if (!text.includes(open) && !text.includes(close)) return [open, close];
  }
  return ['⟦', '⟧'];
}

export function maskTechnicalTokens(text) {
  if (typeof text !== 'string' || !text) {
    return { masked: String(text || ''), tokens: [], open: '⟦', close: '⟧' };
  }
  const [open, close] = chooseMarkerPair(text);
  const tokens = [];
  const masked = text.replace(TECHNICAL_TOKEN_RE, match => {
    const idx = tokens.length;
    tokens.push(match);
    return `${open}${idx}${close}`;
  });
  return { masked, tokens, open, close };
}

export function unmaskTechnicalTokens(translated, tokens = [], { open = '⟦', close = '⟧' } = {}) {
  if (typeof translated !== 'string') return { text: '', intact: tokens.length === 0, missingCount: tokens.length };
  if (!Array.isArray(tokens) || !tokens.length) return { text: translated, intact: true, missingCount: 0 };
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(open)}\\s*(\\d+)\\s*${esc(close)}`, 'g');
  const seen = new Set();
  const restored = translated.replace(re, (full, rawIdx) => {
    const idx = Number(rawIdx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= tokens.length) return full;
    seen.add(idx);
    return tokens[idx];
  });
  const missingCount = tokens.length - seen.size;
  return { text: restored, intact: missingCount === 0, missingCount };
}

const LEADING_ACTION_VERB_RE = /^(?:check|read|edit|updat|creat|delet|remov|verif|test|build|runn|ran|start|stopp|install|compil|search|explor|list|inspect|fetch|load|writ|pars|patch|fix|debug|reinstall|rebuild|restart|sync|wait|ask|open|clos|generat|format|lint|migrat|deploy|configur|monitor|prob|scann|watch|upgrad|download|upload|clean)/i;

export function shouldSkipTranslation(text, targetLang = 'zh-CN') {
  if (typeof text !== 'string' || !text.trim() || targetLang === 'en') return true;
  const plainNoNums = text.replace(/\b\d+(?:\.\d+)?\b/g, ' ').trim();
  const stripped = text
    .replace(TECHNICAL_TOKEN_RE, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .trim();
  if (!stripped) return true;
  const hadTechToken = stripped !== plainNoNums;
  const enWords = stripped.match(/\b[A-Za-z][A-Za-z'-]{1,}\b/g) || [];
  const latinChars = (stripped.match(/[A-Za-z]/g) || []).length;
  if (targetLang === 'ja') {
    const kanaChars = (stripped.match(/[\u3040-\u30ff]/g) || []).length;
    if (kanaChars >= 4 && enWords.length <= 4) return true;
  } else if (targetLang === 'ko') {
    const hangulChars = (stripped.match(/[\uac00-\ud7af]/g) || []).length;
    if (hangulChars >= 4 && enWords.length <= 4) return true;
  } else if (targetLang === 'ru') {
    const cyrillicChars = (stripped.match(/[\u0400-\u04ff]/g) || []).length;
    if (cyrillicChars >= 4 && enWords.length <= 4) return true;
  }
  if (enWords.length < 2 || latinChars < 5) {
    if (enWords.length === 1 && latinChars >= 5 && hadTechToken && LEADING_ACTION_VERB_RE.test(enWords[0])) {
      return false;
    }
    return true;
  }
  if (targetLang === 'zh-CN' || targetLang === 'zh-TW') {
    const cjkChars = (stripped.match(/[\u4e00-\u9fff]/g) || []).length;
    if (cjkChars >= 4 && enWords.length <= 4) {
      const ratio = cjkChars / (cjkChars + enWords.length * 2);
      if (ratio >= 0.45) return true;
    }
  }
  return false;
}

export function splitForFreeTranslate(text, maxLen = FREE_CHUNK_LIMIT) {
  if (typeof text !== 'string' || text.length <= maxLen) return text ? [text] : [];
  const chunks = [];
  const pushPiece = piece => {
    if (!piece) return;
    if (chunks.length && chunks[chunks.length - 1].length + piece.length <= maxLen) {
      chunks[chunks.length - 1] += piece;
    } else if (piece.length <= maxLen) {
      chunks.push(piece);
    } else {
      let rest = piece;
      while (rest.length > maxLen) {
        let cut = maxLen;
        const space = rest.lastIndexOf(' ', maxLen);
        if (space > maxLen * 0.4) cut = space + 1;
        // Avoid cutting inside placeholder brackets ⟦123⟧
        const open = rest.lastIndexOf('⟦', cut);
        const close = open >= 0 ? rest.indexOf('⟧', open) : -1;
        if (open >= 0 && (close < 0 || close >= cut) && open > 0) cut = open;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      if (rest) chunks.push(rest);
    }
  };
  for (const para of text.split(/(\n\n+)/)) {
    if (para.length <= maxLen) {
      pushPiece(para);
      continue;
    }
    for (const line of para.split(/(\n)/)) {
      if (line.length <= maxLen) {
        pushPiece(line);
        continue;
      }
      for (const sent of line.split(/(?<=[.!?])\s+/)) {
        pushPiece(sent + (sent.endsWith('\n') || sent.endsWith(' ') ? '' : ' '));
      }
    }
  }
  return chunks.map(c => c.trimEnd()).filter(Boolean);
}

function normalizePromptText(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function cacheKey(scope, targetLang, text, context = '') {
  return createHash('sha256')
    .update(`${scope}\0${targetLang}\0${context ? context.slice(-160) : ''}\0${normalizePromptText(text)}`)
    .digest('hex');
}

function safeJsonRead(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicWriteJson(file, data, mode) {
  const dir = join(file, '..');
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', ...(mode ? { mode } : {}) });
  if (mode && process.platform !== 'win32') {
    try { chmodSync(tmp, mode); } catch {}
  }
  renameSync(tmp, file);
  if (mode && process.platform !== 'win32') {
    try { chmodSync(file, mode); } catch {}
  }
}

function createSemaphore(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < limit && queue.length) {
      const task = queue.shift();
      if (task.signal?.aborted) {
        task.reject(task.signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        continue;
      }
      active++;
      Promise.resolve()
        .then(task.fn)
        .then(task.resolve, task.reject)
        .finally(() => {
          active--;
          next();
        });
    }
  };
  return (fn, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const entry = { fn, resolve, reject, signal };
    queue.push(entry);
    next();
  });
}

function combineSignals(outerSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!outerSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([outerSignal, timeoutSignal]);
  const controller = new AbortController();
  const forward = sig => {
    if (!controller.signal.aborted) controller.abort(sig.reason);
  };
  if (outerSignal.aborted) forward(outerSignal);
  else outerSignal.addEventListener('abort', () => forward(outerSignal), { once: true });
  timeoutSignal.addEventListener('abort', () => forward(timeoutSignal), { once: true });
  return controller.signal;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function buildLlmPrompts(text, { targetLang = 'zh-CN', context = '' } = {}) {
  const langLabel = targetLangMeta(targetLang).llmLabel;
  const system = [
    `You are a precise technical translator translating AI coding agent reasoning and tool logs into natural, concise ${langLabel}.`,
    'Rules:',
    '1. Preserve ALL Markdown structure (headings, lists, blockquotes, bold/italic, links) exactly.',
    '2. Keep fenced code blocks, inline `code`, file paths, line references (#L1-L20), symbol names, CLI flags, ALL_CAPS constants, @mentions, #numbers, URLs, and model names completely unchanged.',
    '3. Output ONLY the translation with zero preamble, notes, or surrounding quotes.',
    '4. If already mostly in the target language, polish awkward literal fragments minimally while keeping technical terms intact.'
  ].join('\n');
  const trimmedCtx = typeof context === 'string' ? context.trim() : '';
  const user = trimmedCtx
    ? `<previous_translation_context>\n${trimmedCtx.slice(-300)}\n</previous_translation_context>\nTranslate ONLY the following segment (use the context above strictly for terminology and pronoun continuity; NEVER repeat the context):\n\n${text}`
    : text;
  return { system, user };
}

function buildOpenAiEndpoint(baseUrl) {
  const clean = normalizeTranslationBaseUrl(baseUrl) || 'https://api.openai.com/v1';
  if (/\/chat\/completions(?:\?|$)/i.test(clean)) return clean;
  return `${clean}/chat/completions`;
}

function buildGeminiEndpoint(baseUrl, model) {
  const cleanBase = normalizeTranslationBaseUrl(baseUrl) || 'https://generativelanguage.googleapis.com/v1beta';
  const cleanModel = (normalizeTranslationModel(model) || 'gemini-2.5-flash').replace(/^models\//, '');
  if (/\/models\/.+:(?:stream)?GenerateContent/i.test(cleanBase)) return cleanBase;
  return `${cleanBase}/models/${encodeURIComponent(cleanModel)}:streamGenerateContent?alt=sse`;
}

async function readSseStream(response, extractDelta, onDelta, signal) {
  const ctype = (response.headers?.get?.('content-type') || '').toLowerCase();
  if (!response.body || (ctype.includes('application/json') && !ctype.includes('event-stream'))) {
    const payload = await response.json();
    const full = extractDelta(payload);
    if (full) onDelta?.(full);
    return full || '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let sawAnyEvent = false;
  const rawChunks = [];

  const handleEventLines = block => {
    const dataLines = [];
    for (const rawLine of block.split(/\r?\n/)) {
      if (rawLine.startsWith('data:')) {
        dataLines.push(rawLine.slice(5).trimStart());
      }
    }
    if (!dataLines.length) return;
    sawAnyEvent = true;
    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') return;
    let json;
    try { json = JSON.parse(data); } catch { return; }
    if (json?.error?.message) throw new Error(json.error.message);
    const delta = extractDelta(json);
    if (delta) {
      fullText += delta;
      onDelta?.(delta);
    }
  };

  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
      const { value, done } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true });
      rawChunks.push(decoded);
      buffer += decoded;
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';
      for (const block of parts) handleEventLines(block);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleEventLines(buffer);
    // Fallback if a proxy served plain JSON with text/plain or missing content-type header
    if (!sawAnyEvent && !fullText && rawChunks.length) {
      const whole = rawChunks.join('').trim();
      try {
        const json = JSON.parse(whole);
        if (json?.error?.message) throw new Error(json.error.message);
        const text = extractDelta(json);
        if (text) {
          fullText = text;
          onDelta?.(text);
        }
      } catch (err) {
        if (err && !/JSON/.test(err.message)) throw err;
      }
    }
    return fullText;
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

export function createTranslatorStore(
  dataDir = join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-powertools'),
  { getSettings = () => ({}), fetchImpl = globalThis.fetch } = {}
) {
  const secretsFile = join(dataDir, 'translation-secrets.json');
  const cacheFile = join(dataDir, 'translation-cache.json');
  const runFree = createSemaphore(FREE_CONCURRENCY);

  const cache = new Map();
  let cacheLoaded = false;
  let flushTimer = null;
  let lastDegraded = null;
  const cooldowns = new Map();
  const freeStats = new Map();
  const probeControllers = new Set();
  let bingSession = null;

  function statFor(id) {
    let s = freeStats.get(id);
    if (!s) {
      s = { ewmaMs: null, lastMs: null, successes: 0, failures: 0, lastSampleAt: 0 };
      freeStats.set(id, s);
    }
    return s;
  }

  function recordProviderSample(id, latencyMs, { ok = true, cooldown = false } = {}) {
    const s = statFor(id);
    if (ok && Number.isFinite(latencyMs)) {
      const ms = Math.max(1, Math.round(latencyMs));
      s.lastMs = ms;
      s.ewmaMs = s.ewmaMs == null ? ms : Math.round(s.ewmaMs * 0.7 + ms * 0.3);
      s.successes++;
      s.lastSampleAt = Date.now();
      cooldowns.delete(id);
      if (ms > 2500) {
        for (const [otherId, otherStat] of freeStats) {
          if (otherId !== id && !isCoolingDown(otherId) && otherStat.ewmaMs != null && otherStat.ewmaMs < ms * 0.65) {
            s.lastSampleAt = 0;
            break;
          }
        }
      }
      return;
    }
    s.failures++;
    if (cooldown || s.failures >= 2) {
      markCooldown(id);
    }
  }

  function freeBenchmarksSummary() {
    return freeProviders.map(p => {
      const s = statFor(p.id);
      return {
        id: p.id,
        label: FREE_PROVIDER_LABELS[p.id] || p.id,
        ewmaMs: s.ewmaMs,
        lastMs: s.lastMs,
        available: !isCoolingDown(p.id),
        lastSampleAt: s.lastSampleAt
      };
    }).sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return (a.ewmaMs ?? Infinity) - (b.ewmaMs ?? Infinity);
    });
  }

  function ensureCacheLoaded() {
    if (cacheLoaded) return;
    cacheLoaded = true;
    const raw = safeJsonRead(cacheFile, null);
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    for (const entry of entries.slice(-MAX_CACHE_ENTRIES)) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1]?.text === 'string') {
        cache.set(entry[0], entry[1]);
      }
    }
  }

  function flushCache() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!cacheLoaded) return;
    try {
      atomicWriteJson(cacheFile, { version: 1, entries: [...cache.entries()].slice(-MAX_CACHE_ENTRIES) });
    } catch { /* Non-fatal persistence failure. */ }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushCache();
    }, 1500);
    flushTimer.unref?.();
  }

  function getCached(key) {
    ensureCacheLoaded();
    const hit = cache.get(key);
    if (!hit) return null;
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  function putCached(key, text, provider) {
    if (!text) return;
    ensureCacheLoaded();
    cache.delete(key);
    cache.set(key, { text, provider, at: Date.now() });
    while (cache.size > MAX_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }
    scheduleFlush();
  }

  function readApiKey() {
    const raw = safeJsonRead(secretsFile, {});
    return typeof raw?.apiKey === 'string' ? raw.apiKey.trim() : '';
  }

  function setSecret({ apiKey } = {}) {
    if (typeof apiKey !== 'string') throw new Error('API Key 格式无效');
    const clean = apiKey.trim();
    if (clean.length > 512 || /[\r\n\x00-\x1f]/.test(clean)) throw new Error('API Key 包含非法字符');
    atomicWriteJson(secretsFile, { apiKey: clean }, 0o600);
    return status();
  }

  function status() {
    ensureCacheLoaded();
    const apiKey = readApiKey();
    const benchmarks = freeBenchmarksSummary();
    const best = benchmarks.find(b => b.available && b.ewmaMs != null) || benchmarks.find(b => b.available) || null;
    return {
      hasApiKey: Boolean(apiKey),
      maskedKey: maskApiKey(apiKey),
      cacheEntries: cache.size,
      lastDegraded,
      activeFreeProvider: best?.id || '',
      activeFreeLabel: best?.label || '',
      activeFreeLatencyMs: best?.ewmaMs ?? null,
      freeBenchmarks: benchmarks
    };
  }

  function clearCache() {
    ensureCacheLoaded();
    cache.clear();
    flushCache();
    return { ok: true, cacheEntries: 0 };
  }

  function isCoolingDown(provider) {
    const until = cooldowns.get(provider) || 0;
    if (until > Date.now()) return true;
    cooldowns.delete(provider);
    return false;
  }

  function markCooldown(provider) {
    cooldowns.set(provider, Date.now() + FREE_COOLDOWN_MS);
  }

  async function translateViaGoogleGtx(chunk, targetLang, signal) {
    const tl = targetLangMeta(targetLang).google;
    const base = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t`;
    const usePost = encodeURIComponent(chunk).length > 1400;
    const reqInit = usePost
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ q: chunk }).toString(),
          signal: combineSignals(signal, HTTP_TIMEOUT_FREE_MS)
        }
      : {
          method: 'GET',
          signal: combineSignals(signal, HTTP_TIMEOUT_FREE_MS)
        };
    const res = await fetchImpl(usePost ? base : `${base}&q=${encodeURIComponent(chunk)}`, reqInit);
    if (!res.ok) throw Object.assign(new Error(`Google gtx HTTP ${res.status}`), { httpStatus: res.status });
    const data = await res.json();
    const parts = Array.isArray(data?.[0]) ? data[0] : [];
    const text = parts.map(item => (Array.isArray(item) && typeof item[0] === 'string' ? item[0] : '')).join('');
    if (!text) throw new Error('Google gtx empty translation');
    return text;
  }

  async function translateViaGoogleClients5(chunk, targetLang, signal) {
    const tl = targetLangMeta(targetLang).google;
    const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(chunk)}`;
    const res = await fetchImpl(url, { method: 'GET', signal: combineSignals(signal, HTTP_TIMEOUT_FREE_MS) });
    if (!res.ok) throw Object.assign(new Error(`Google clients5 HTTP ${res.status}`), { httpStatus: res.status });
    const data = await res.json();
    if (Array.isArray(data)) {
      if (typeof data[0] === 'string') return data[0];
      if (Array.isArray(data[0]) && typeof data[0][0] === 'string') return data.map(row => row?.[0] || '').join('');
    }
    if (typeof data?.sentences?.[0]?.trans === 'string') {
      return data.sentences.map(s => s.trans || '').join('');
    }
    throw new Error('Google clients5 unexpected payload');
  }

  async function ensureBingSession(signal, force = false) {
    if (!force && bingSession && bingSession.expiresAt > Date.now()) return bingSession;
    const res = await fetchImpl('https://www.bing.com/translator', {
      method: 'GET',
      headers: { 'User-Agent': DESKTOP_EDGE_UA },
      redirect: 'follow',
      signal: combineSignals(signal, HTTP_TIMEOUT_FREE_MS)
    });
    if (!res.ok) throw Object.assign(new Error(`Bing session HTTP ${res.status}`), { httpStatus: res.status });
    let origin = 'https://www.bing.com';
    try {
      if (res.url) origin = new URL(res.url).origin;
    } catch {}
    const setCookies = typeof res.headers?.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    const cookie = setCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');
    const html = await res.text();
    const ig = html.match(/IG:"([^"]+)"/)?.[1] || '';
    const iid = html.match(/data-iid="([^"]+)"/)?.[1] || 'translator.5028';
    const params = html.match(/params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)"/) || html.match(/params_RichTranslateHelper\s*=\s*\[(\d+),"([^"]+)"/);
    if (!ig || !params) throw new Error('Bing translator token parse failed');
    bingSession = {
      origin,
      ig,
      iid,
      key: params[1],
      token: params[2],
      cookie,
      count: 0,
      expiresAt: Date.now() + BING_SESSION_TTL_MS
    };
    return bingSession;
  }

  async function translateViaBing(chunk, targetLang, signal) {
    const to = targetLangMeta(targetLang).bing;
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await ensureBingSession(signal, attempt > 0);
      session.count++;
      const origin = session.origin || 'https://www.bing.com';
      const url = `${origin}/ttranslatev3?isVertical=1&IG=${encodeURIComponent(session.ig)}&IID=${encodeURIComponent(`${session.iid}.${session.count}`)}`;
      const body = new URLSearchParams({
        fromLang: 'auto-detect',
        to,
        text: chunk,
        token: session.token,
        key: session.key
      }).toString();
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': DESKTOP_EDGE_UA,
          Origin: origin,
          Referer: `${origin}/translator`,
          ...(session.cookie ? { Cookie: session.cookie } : {})
        },
        body,
        signal: combineSignals(signal, HTTP_TIMEOUT_FREE_MS)
      });
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        bingSession = null;
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`Bing HTTP ${res.status}`), { httpStatus: res.status });
      const data = await res.json();
      if (data?.statusCode && data.statusCode >= 400 && attempt === 0) {
        bingSession = null;
        continue;
      }
      const text = data?.[0]?.translations?.[0]?.text;
      if (typeof text !== 'string' || !text) throw new Error('Bing empty translation');
      return text;
    }
    throw new Error('Bing translation unavailable');
  }

  const freeProviders = [
    { id: 'google-clients5', fn: translateViaGoogleClients5 },
    { id: 'google-gtx', fn: translateViaGoogleGtx },
    { id: 'microsoft-bing', fn: translateViaBing }
  ];

  async function raceFreeSingleChunk(chunk, tokens, open, close, targetLang, candidates, outerSignal) {
    const bgCtrl = new AbortController();
    probeControllers.add(bgCtrl);
    const bgTimer = setTimeout(() => bgCtrl.abort(), HTTP_TIMEOUT_PROBE_MS);
    bgTimer.unref?.();
    const probeSignal = outerSignal ? combineSignals(outerSignal, HTTP_TIMEOUT_PROBE_MS) : bgCtrl.signal;

    let remaining = candidates.length;
    let settledWinner = false;
    let lastErr = null;

    return new Promise((resolve, reject) => {
      const doneAll = [];
      for (const provider of candidates) {
        const startedAt = Date.now();
        const task = Promise.resolve()
          .then(() => provider.fn(chunk, targetLang, probeSignal))
          .then(piece => {
            const latency = Date.now() - startedAt;
            const unmasked = unmaskTechnicalTokens(piece, tokens, { open, close });
            if (!unmasked.intact && tokens.length > 0 && unmasked.missingCount / tokens.length > 0.34) {
              throw new Error(`${provider.id} corrupted technical placeholders (${unmasked.missingCount}/${tokens.length})`);
            }
            recordProviderSample(provider.id, latency, { ok: true });
            if (!settledWinner) {
              settledWinner = true;
              resolve({ text: unmasked.text, provider: provider.id, latencyMs: Math.max(1, latency) });
            }
          })
          .catch(error => {
            if (!isAbortError(error) || outerSignal?.aborted) {
              lastErr = error;
              const isRateOrServer = error?.httpStatus === 429 || (error?.httpStatus >= 500 && error?.httpStatus < 600);
              recordProviderSample(provider.id, Date.now() - startedAt, { ok: false, cooldown: isRateOrServer });
            }
            remaining--;
            if (!settledWinner && remaining === 0) {
              reject(lastErr || new Error('免费翻译服务暂时不可用'));
            }
          });
        doneAll.push(task);
      }
      Promise.allSettled(doneAll).finally(() => {
        clearTimeout(bgTimer);
        probeControllers.delete(bgCtrl);
      });
    });
  }

  async function translateFreeText(text, { targetLang = 'zh-CN', signal } = {}) {
    const { masked, tokens, open, close } = maskTechnicalTokens(text);
    const chunks = splitForFreeTranslate(masked);
    if (!chunks.length) return { text, provider: 'free' };

    const active = freeProviders.filter(p => !isCoolingDown(p.id));
    const now = Date.now();
    const shouldRace = chunks.length === 1 && active.length >= 2 && active.some(p => {
      const s = statFor(p.id);
      return s.ewmaMs == null || (now - s.lastSampleAt > BENCHMARK_TTL_MS);
    });
    if (shouldRace) {
      return await raceFreeSingleChunk(chunks[0], tokens, open, close, targetLang, active, signal);
    }

    const sortActive = list => [...list].sort((a, b) => (statFor(a.id).ewmaMs ?? Infinity) - (statFor(b.id).ewmaMs ?? Infinity));
    const ordered = [
      ...sortActive(active),
      ...freeProviders.filter(p => isCoolingDown(p.id))
    ];
    let lastErr = null;
    for (const provider of ordered) {
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
      const startedAt = Date.now();
      try {
        const translatedParts = [];
        for (const chunk of chunks) {
          const piece = await runFree(() => provider.fn(chunk, targetLang, signal), signal);
          translatedParts.push(piece);
        }
        const combined = translatedParts.join('\n\n');
        const unmasked = unmaskTechnicalTokens(combined, tokens, { open, close });
        if (!unmasked.intact && tokens.length > 0 && unmasked.missingCount / tokens.length > 0.34) {
          lastErr = new Error(`${provider.id} corrupted technical placeholders (${unmasked.missingCount}/${tokens.length})`);
          recordProviderSample(provider.id, Date.now() - startedAt, { ok: false });
          continue;
        }
        recordProviderSample(provider.id, Date.now() - startedAt, { ok: true });
        return { text: unmasked.text, provider: provider.id };
      } catch (error) {
        if (isAbortError(error) && signal?.aborted) throw error;
        lastErr = error;
        const isRateOrServer = error?.httpStatus === 429 || (error?.httpStatus >= 500 && error?.httpStatus < 600);
        recordProviderSample(provider.id, Date.now() - startedAt, { ok: false, cooldown: isRateOrServer });
      }
    }
    throw lastErr || new Error('免费翻译服务暂时不可用');
  }

  async function translateOpenAi(text, { targetLang, context, baseUrl, model, apiKey, onDelta, signal }) {
    const endpoint = buildOpenAiEndpoint(baseUrl);
    const { system, user } = buildLlmPrompts(text, { targetLang, context });
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: normalizeTranslationModel(model) || 'gpt-4o-mini',
        stream: true,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }),
      signal: combineSignals(signal, HTTP_TIMEOUT_LLM_MS)
    });
    if (!res.ok) {
      let detail = `OpenAI HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody?.error?.message) detail = `${detail}: ${errBody.error.message}`;
      } catch {}
      throw new Error(detail);
    }
    const full = await readSseStream(
      res,
      json => {
        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') return delta;
        const msg = json?.choices?.[0]?.message?.content;
        return typeof msg === 'string' ? msg : '';
      },
      onDelta,
      signal
    );
    if (!full.trim()) throw new Error('OpenAI returned empty content');
    return full;
  }

  async function translateGemini(text, { targetLang, context, baseUrl, model, apiKey, onDelta, signal }) {
    if (!apiKey) throw new Error('Gemini 引擎需要配置 API Key');
    const endpoint = buildGeminiEndpoint(baseUrl, model);
    const { system, user } = buildLlmPrompts(text, { targetLang, context });
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.1 }
      }),
      signal: combineSignals(signal, HTTP_TIMEOUT_LLM_MS)
    });
    if (!res.ok) {
      let detail = `Gemini HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody?.error?.message) detail = `${detail}: ${errBody.error.message}`;
      } catch {}
      throw new Error(detail);
    }
    const extractGeminiParts = payload => {
      const candidates = Array.isArray(payload) ? payload : [payload];
      let out = '';
      for (const item of candidates) {
        const parts = item?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) continue;
        for (const p of parts) {
          if (typeof p?.text === 'string' && !p?.thought) out += p.text;
        }
      }
      return out;
    };
    const full = await readSseStream(res, extractGeminiParts, onDelta, signal);
    if (!full.trim()) throw new Error('Gemini returned empty content');
    return full;
  }

  function resolveConfig(override = {}) {
    const cfg = getSettings() || {};
    const requestedLang = override.targetLang || cfg.language;
    const targetLang = SUPPORTED_LANGUAGES.includes(requestedLang) ? requestedLang : 'zh-CN';
    const engine = TRANSLATION_ENGINES.includes(override.engine || cfg.detailTranslationEngine)
      ? (override.engine || cfg.detailTranslationEngine)
      : 'free';
    const baseUrl = override.baseUrl !== undefined ? normalizeTranslationBaseUrl(override.baseUrl) : normalizeTranslationBaseUrl(cfg.detailTranslationBaseUrl);
    const model = override.model !== undefined ? normalizeTranslationModel(override.model) : normalizeTranslationModel(cfg.detailTranslationModel);
    const fallback = override.fallback !== undefined ? override.fallback !== false : cfg.detailTranslationFallback !== false;
    return { targetLang, engine, baseUrl, model, fallback };
  }

  async function translateSegment({ text, targetLang: reqLang, context = '', engine: reqEngine, skipCache = false, onDelta, signal } = {}) {
    const clean = normalizePromptText(text);
    const cfg = resolveConfig({ targetLang: reqLang, engine: reqEngine });
    if (shouldSkipTranslation(clean, cfg.targetLang)) {
      return { text: clean, provider: 'skipped', cached: false, skipped: true, degraded: false };
    }
    const scope = cfg.engine === 'free' ? 'free' : `${cfg.engine}:${cfg.baseUrl}:${cfg.model}`;
    const key = cacheKey(scope, cfg.targetLang, clean, cfg.engine === 'free' ? '' : context);
    if (!skipCache) {
      const hit = getCached(key);
      if (hit) {
        return { text: hit.text, provider: hit.provider, cached: true, skipped: false, degraded: false };
      }
    }

    if (cfg.engine === 'openai' || cfg.engine === 'gemini') {
      const apiKey = readApiKey();
      let emitted = false;
      const forwardDelta = chunk => {
        if (!chunk) return;
        emitted = true;
        onDelta?.(chunk);
      };
      try {
        const translated = cfg.engine === 'openai'
          ? await translateOpenAi(clean, { targetLang: cfg.targetLang, context, baseUrl: cfg.baseUrl, model: cfg.model, apiKey, onDelta: forwardDelta, signal })
          : await translateGemini(clean, { targetLang: cfg.targetLang, context, baseUrl: cfg.baseUrl, model: cfg.model, apiKey, onDelta: forwardDelta, signal });
        lastDegraded = null;
        putCached(key, translated, cfg.engine);
        return { text: translated, provider: cfg.engine, cached: false, skipped: false, degraded: false };
      } catch (error) {
        if (isAbortError(error) && signal?.aborted) throw error;
        if (!cfg.fallback || emitted) throw error;
        const freeRes = await translateFreeText(clean, { targetLang: cfg.targetLang, signal });
        lastDegraded = { from: cfg.engine, to: freeRes.provider, reason: error.message || 'LLM request failed', at: Date.now() };
        onDelta?.(freeRes.text);
        return {
          text: freeRes.text,
          provider: freeRes.provider,
          cached: false,
          skipped: false,
          degraded: true,
          degradedFrom: cfg.engine,
          reason: lastDegraded.reason
        };
      }
    }

    const freeRes = await translateFreeText(clean, { targetLang: cfg.targetLang, signal });
    onDelta?.(freeRes.text);
    putCached(key, freeRes.text, freeRes.provider);
    return { text: freeRes.text, provider: freeRes.provider, cached: false, skipped: false, degraded: false };
  }

  async function translateBatch({ items = [], targetLang: reqLang, signal } = {}) {
    const list = Array.isArray(items) ? items.slice(0, 40) : [];
    const results = new Array(list.length);
    const { targetLang, engine } = resolveConfig({ targetLang: reqLang });

    // Translate sequentially on same chunk? No, small bounded concurrency via Promise pool (3 workers).
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
        const idx = cursor++;
        const raw = list[idx];
        const id = typeof raw?.id === 'string' ? raw.id : String(idx);
        const text = typeof raw?.text === 'string' ? raw.text : '';
        try {
          const out = await translateSegment({ text, targetLang, engine, signal });
          results[idx] = { id, ...out };
        } catch (error) {
          if (isAbortError(error) && signal?.aborted) throw error;
          results[idx] = { id, text, error: error.message || '翻译失败' };
        }
      }
    };
    const workers = Array.from({ length: Math.min(FREE_CONCURRENCY, Math.max(1, list.length)) }, () => worker());
    await Promise.all(workers);
    return { results };
  }

  async function testConnection({ engine, baseUrl, model, targetLang, fallback } = {}) {
    const cfg = resolveConfig({ engine, baseUrl, model, targetLang, fallback: false });
    const sample = 'Verifying `lib/native-ui.js#L10-L20` with `--dry-run` before continuing.';
    const startedAt = Date.now();
    let streamed = '';
    const apiKey = readApiKey();
    let result;
    if (cfg.engine === 'openai') {
      const text = await translateOpenAi(sample, {
        targetLang: cfg.targetLang === 'en' ? 'zh-CN' : cfg.targetLang,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        apiKey,
        onDelta: chunk => { streamed += chunk; }
      });
      result = { provider: 'openai', text: text || streamed, latencyMs: Date.now() - startedAt };
    } else if (cfg.engine === 'gemini') {
      const text = await translateGemini(sample, {
        targetLang: cfg.targetLang === 'en' ? 'zh-CN' : cfg.targetLang,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        apiKey,
        onDelta: chunk => { streamed += chunk; }
      });
      result = { provider: 'gemini', text: text || streamed, latencyMs: Date.now() - startedAt };
    } else {
      const targetLangClean = cfg.targetLang === 'en' ? 'zh-CN' : cfg.targetLang;
      const { masked, tokens, open, close } = maskTechnicalTokens(sample);
      const probeSignal = AbortSignal.timeout(6000);
      const settled = await Promise.all(freeProviders.map(async p => {
        const t0 = Date.now();
        try {
          const piece = await p.fn(masked, targetLangClean, probeSignal);
          const unmasked = unmaskTechnicalTokens(piece, tokens, { open, close });
          if (!unmasked.intact && tokens.length > 0 && unmasked.missingCount / tokens.length > 0.34) {
            throw new Error('corrupted placeholders');
          }
          const latencyMs = Math.max(1, Date.now() - t0);
          recordProviderSample(p.id, latencyMs, { ok: true });
          return { id: p.id, label: FREE_PROVIDER_LABELS[p.id] || p.id, ok: true, latencyMs, text: unmasked.text };
        } catch (err) {
          const isRateOrServer = err?.httpStatus === 429 || (err?.httpStatus >= 500 && err?.httpStatus < 600);
          recordProviderSample(p.id, Date.now() - t0, { ok: false, cooldown: isRateOrServer });
          return { id: p.id, label: FREE_PROVIDER_LABELS[p.id] || p.id, ok: false, latencyMs: Date.now() - t0, error: err?.message || 'failed' };
        }
      }));
      const winners = settled.filter(s => s.ok).sort((a, b) => a.latencyMs - b.latencyMs);
      if (!winners.length) {
        throw new Error(settled.map(s => `${s.label}: ${s.error}`).join('; ') || '机器翻译连接失败');
      }
      const winner = winners[0];
      result = {
        provider: winner.id,
        latencyMs: winner.latencyMs,
        text: winner.text,
        benchmarks: settled.map(({ id, label, ok, latencyMs, error }) => ({ id, label, ok, latencyMs, ...(error ? { error } : {}) }))
      };
    }
    return {
      ok: true,
      engine: cfg.engine,
      provider: result.provider,
      latencyMs: result.latencyMs ?? (Date.now() - startedAt),
      sample: result.text,
      ...(result.benchmarks ? { benchmarks: result.benchmarks } : {})
    };
  }

  function dispose() {
    for (const ctrl of probeControllers) ctrl.abort();
    probeControllers.clear();
    flushCache();
  }

  return {
    translateSegment,
    translateBatch,
    testConnection,
    status,
    setSecret,
    clearCache,
    dispose
  };
}
