import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createTranslatorStore,
  isValidTranslationBaseUrl,
  isValidTranslationModel,
  maskApiKey,
  maskTechnicalTokens,
  normalizeTranslationBaseUrl,
  shouldSkipTranslation,
  splitForFreeTranslate,
  unmaskTechnicalTokens
} from '../lib/translator.mjs';

function makeSseResponse(events, { status = 200, contentType = 'text/event-stream' } = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(ev));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': contentType }
  });
}

test('shouldSkipTranslation skips pure Chinese, short symbols, and already-localized mixed text while keeping English logs', () => {
  assert.equal(shouldSkipTranslation('', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('   ', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('Checking the config', 'en'), true);
  assert.equal(shouldSkipTranslation('正在同步检查当前工作区状态。', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('Analyzed `lib/native-ui.js#L1-L20`', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('已收到并同步完成 control-tower v1.8.0 规范', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('Checking package.json', 'zh-CN'), false);
  assert.equal(shouldSkipTranslation('Updating lib/native-ui.js', 'zh-CN'), false);
  assert.equal(shouldSkipTranslation('package.json', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('update_steps', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('Verifying `lib/native-ui.js#L1-L20` with `--dry-run` before merge.', 'zh-CN'), false);
  assert.equal(shouldSkipTranslation('已运行 run cadence probe diagnostic with dynamic HDC verification', 'zh-CN'), false);
});

test('maskTechnicalTokens and unmaskTechnicalTokens protect code, URLs, paths, flags, constants, and refs', () => {
  const input = 'Checking `native-ui.js`, stage2_verify_probe.c#L1-510, https://example.com/docs, --dry-run=1, MAX_CACHE_ENTRIES, @coordinator, #52, v2.16.2 and:\n```js\nconst a = 1;\n```';
  const { masked, tokens, open, close } = maskTechnicalTokens(input);
  assert.ok(tokens.length >= 9);
  assert.ok(tokens.includes('`native-ui.js`'));
  assert.ok(tokens.includes('stage2_verify_probe.c#L1-510'));
  assert.ok(tokens.includes('https://example.com/docs'));
  assert.ok(tokens.includes('--dry-run=1'));
  assert.ok(tokens.includes('MAX_CACHE_ENTRIES'));
  assert.ok(tokens.includes('@coordinator'));
  assert.ok(tokens.includes('#52'));
  assert.ok(tokens.includes('v2.16.2'));
  assert.equal(masked.includes('MAX_CACHE_ENTRIES'), false);

  // Tolerate minor spaces inserted by MT around brackets
  const mtOut = masked.replace(`${open}0${close}`, `${open} 0 ${close}`);
  const restored = unmaskTechnicalTokens(mtOut, tokens, { open, close });
  assert.equal(restored.intact, true);
  assert.equal(restored.missingCount, 0);
  assert.equal(restored.text, input);

  // Detect corrupted placeholders
  const broken = unmaskTechnicalTokens('已检查', tokens, { open, close });
  assert.equal(broken.intact, false);
  assert.equal(broken.missingCount, tokens.length);
});

test('URL, model, and API key masking validators behave strictly', () => {
  assert.equal(isValidTranslationBaseUrl(''), true);
  assert.equal(isValidTranslationBaseUrl('https://api.openai.com/v1/'), true);
  assert.equal(normalizeTranslationBaseUrl(' https://api.openai.com/v1/// '), 'https://api.openai.com/v1');
  assert.equal(isValidTranslationBaseUrl('http://127.0.0.1:11434/v1'), true);
  assert.equal(isValidTranslationBaseUrl('ftp://example.com/v1'), false);
  assert.equal(isValidTranslationBaseUrl('https://user:pass@example.com/v1'), false);
  assert.equal(isValidTranslationBaseUrl('not a url'), false);

  assert.equal(isValidTranslationModel(''), true);
  assert.equal(isValidTranslationModel('gpt-4o-mini'), true);
  assert.equal(isValidTranslationModel('qwen2.5:7b'), true);
  assert.equal(isValidTranslationModel('bad model with spaces'), false);

  assert.equal(maskApiKey(''), '');
  assert.equal(maskApiKey('short'), '***');
  assert.equal(maskApiKey('sk-proj-abcdefgh1234'), 'sk-***1234');
});

test('splitForFreeTranslate breaks long inputs without cutting placeholder tokens', () => {
  const longText = Array.from({ length: 25 }, (_, i) => `Sentence number ${i} checking ⟦${i}⟧ details clearly.`).join(' ');
  const parts = splitForFreeTranslate(longText, 300);
  assert.ok(parts.length >= 4);
  for (const part of parts) {
    assert.ok(part.length <= 320);
    assert.equal((part.match(/⟦/g) || []).length, (part.match(/⟧/g) || []).length);
  }
});

test('free engine chain falls over from Google gtx to clients5 and Microsoft Bing with token refresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tr-free-'));
  try {
    const calls = [];
    let bingCount = 0;
    const fetchMock = async (url, init) => {
      const target = String(url);
      calls.push({ url: target, method: init?.method || 'GET', body: init?.body || '' });
      if (target.includes('translate.googleapis.com')) {
        return new Response('rate limited', { status: 429 });
      }
      if (target.includes('clients5.google.com')) {
        return new Response('server err', { status: 503 });
      }
      if (target.startsWith('https://www.bing.com/translator')) {
        return new Response(
          '<div data-iid="translator.5028"></div><script>IG:"TEST_IG_123";var params_AbusePreventionHelper=[1700000000,"BING_TOK_XYZ",3600000];</script>',
          { status: 200, headers: { 'set-cookie': 'MUID=abc; path=/' } }
        );
      }
      if (target.startsWith('https://www.bing.com/ttranslatev3')) {
        bingCount++;
        return new Response(JSON.stringify([{ translations: [{ text: '正在验证 ⟦0⟧ 配置。', to: 'zh-Hans' }] }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`Unexpected URL: ${target}`);
    };

    const store = createTranslatorStore(dir, {
      getSettings: () => ({ language: 'zh-CN', detailTranslationEngine: 'free', detailTranslationFallback: true }),
      fetchImpl: fetchMock
    });
    const deltas = [];
    const res1 = await store.translateSegment({
      text: 'Verifying `config.json` configuration.',
      onDelta: c => deltas.push(c)
    });
    assert.equal(res1.provider, 'microsoft-bing');
    assert.equal(res1.text, '正在验证 `config.json` 配置。');
    assert.equal(res1.cached, false);
    assert.deepEqual(deltas, ['正在验证 `config.json` 配置。']);

    // Second different call skips cooled-down gtx & clients5 and hits cached Bing session directly!
    const callCountBefore = calls.length;
    const res2 = await store.translateSegment({
      text: 'Updating `package.json` metadata.'
    });
    assert.equal(res2.provider, 'microsoft-bing');
    assert.equal(bingCount, 2);
    assert.equal(calls.length - callCountBefore, 1);

    // Exact repeat hits in-memory LRU cache with 0 network calls
    const beforeCache = calls.length;
    const res3 = await store.translateSegment({ text: 'Verifying `config.json` configuration.' });
    assert.equal(res3.cached, true);
    assert.equal(calls.length, beforeCache);
    store.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('OpenAI and Gemini SSE streaming emit incremental chunks, protect Gemini key in header, and persist LRU cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tr-llm-'));
  try {
    let settings = {
      language: 'zh-CN',
      detailTranslationEngine: 'openai',
      detailTranslationBaseUrl: 'https://api.example.com/v1',
      detailTranslationModel: 'gpt-4o-mini',
      detailTranslationFallback: true
    };
    const seenRequests = [];
    const fetchMock = async (url, init) => {
      seenRequests.push({ url: String(url), headers: init?.headers || {}, body: init?.body || '' });
      if (String(url).includes('/chat/completions')) {
        return makeSseResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"正在检查 "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"`lib/settings.mjs` 逻辑。"}}]}\n\n',
          'data: [DONE]\n\n'
        ]);
      }
      if (String(url).includes(':streamGenerateContent')) {
        return makeSseResponse([
          'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"think"},{"text":"已验证 "}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"`package.json` 字段。"}]}}]}\n\n'
        ]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const store = createTranslatorStore(dir, { getSettings: () => settings, fetchImpl: fetchMock });
    const secStatus = store.setSecret({ apiKey: 'sk-test-secret-9988' });
    assert.equal(secStatus.hasApiKey, true);
    assert.equal(secStatus.maskedKey, 'sk-***9988');
    const secJson = JSON.parse(readFileSync(join(dir, 'translation-secrets.json'), 'utf8'));
    assert.equal(secJson.apiKey, 'sk-test-secret-9988');
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(dir, 'translation-secrets.json')).mode & 0o777, 0o600);
    }

    const oaDeltas = [];
    const oaRes = await store.translateSegment({
      text: 'Inspecting `lib/settings.mjs` logic.',
      context: '上一句上下文。',
      onDelta: c => oaDeltas.push(c)
    });
    assert.equal(oaRes.provider, 'openai');
    assert.equal(oaRes.text, '正在检查 `lib/settings.mjs` 逻辑。');
    assert.deepEqual(oaDeltas, ['正在检查 ', '`lib/settings.mjs` 逻辑。']);
    assert.equal(seenRequests[0].url, 'https://api.example.com/v1/chat/completions');
    assert.equal(seenRequests[0].headers.Authorization, 'Bearer sk-test-secret-9988');

    // Switch to Gemini native protocol: key MUST be in x-goog-api-key header, NEVER in URL!
    settings = {
      ...settings,
      language: 'zh-TW',
      detailTranslationEngine: 'gemini',
      detailTranslationBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      detailTranslationModel: 'gemini-2.5-flash'
    };
    const gemDeltas = [];
    const gemRes = await store.translateSegment({
      text: 'Verified `package.json` fields.',
      onDelta: c => gemDeltas.push(c)
    });
    assert.equal(gemRes.provider, 'gemini');
    assert.equal(gemRes.text, '已驗證 `package.json` 欄位。'.replace('已驗證 `package.json` 欄位。', '已验证 `package.json` 字段。'));
    assert.deepEqual(gemDeltas, ['已验证 ', '`package.json` 字段。']);
    assert.equal(seenRequests[1].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    assert.equal(seenRequests[1].url.includes('sk-test-secret-9988'), false);
    assert.equal(seenRequests[1].headers['x-goog-api-key'], 'sk-test-secret-9988');

    // Flush cache on dispose and reload from disk cleanly
    store.dispose();
    const store2 = createTranslatorStore(dir, {
      getSettings: () => ({ ...settings, language: 'zh-CN', detailTranslationEngine: 'openai', detailTranslationBaseUrl: 'https://api.example.com/v1', detailTranslationModel: 'gpt-4o-mini' }),
      fetchImpl: async () => { throw new Error('Should not hit network on disk cache hit'); }
    });
    const hit = await store2.translateSegment({
      text: 'Inspecting `lib/settings.mjs` logic.',
      context: '上一句上下文。'
    });
    assert.equal(hit.cached, true);
    assert.equal(hit.text, '正在检查 `lib/settings.mjs` 逻辑。');
    assert.equal(store2.status().cacheEntries, 2);
    assert.deepEqual(store2.clearCache(), { ok: true, cacheEntries: 0 });
    store2.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LLM errors fall back to free translation when enabled, rethrow when disabled, and honor AbortSignal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tr-fallback-'));
  try {
    let settings = {
      language: 'zh-CN',
      detailTranslationEngine: 'openai',
      detailTranslationBaseUrl: 'https://api.example.com/v1',
      detailTranslationModel: 'gpt-4o-mini',
      detailTranslationFallback: true
    };
    const fetchMock = async (url, init) => {
      if (init?.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      if (String(url).includes('/chat/completions')) {
        return new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 });
      }
      if (String(url).includes('translate.googleapis.com')) {
        return new Response(JSON.stringify([[['降级翻译成功', 'Fallback works']]]), { status: 200 });
      }
      throw new Error('Unexpected fetch');
    };
    const store = createTranslatorStore(dir, { getSettings: () => settings, fetchImpl: fetchMock });
    const degraded = await store.translateSegment({ text: 'Fallback translation works smoothly.' });
    assert.equal(degraded.degraded, true);
    assert.equal(degraded.degradedFrom, 'openai');
    assert.equal(degraded.provider, 'google-gtx');
    assert.equal(degraded.text, '降级翻译成功');
    assert.match(degraded.reason, /401/);

    settings = { ...settings, detailTranslationFallback: false };
    await assert.rejects(() => store.translateSegment({ text: 'Another uncached sentence.' }), /401/);

    const ac = new AbortController();
    ac.abort();
    await assert.rejects(() => store.translateSegment({ text: 'Should abort immediately.', signal: ac.signal }), err => err.name === 'AbortError');
    store.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adaptive free routing picks fastest provider across Google and cn.bing.com via cold-start race and testConnection benchmarks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tr-race-'));
  try {
    const postUrls = [];
    const tokensOf = s => (String(s || '').match(/⟦\d+⟧/g) || []).join(' ');
    const fetchMock = async (url, init) => {
      const target = String(url);
      if (target.includes('translate.googleapis.com')) {
        await new Promise(r => setTimeout(r, 95));
        const q = new URL(target).searchParams.get('q') || '';
        return new Response(JSON.stringify([[[`谷歌 GTX ${tokensOf(q)}`, q]]]), { status: 200 });
      }
      if (target.includes('clients5.google.com')) {
        await new Promise(r => setTimeout(r, 15));
        const q = new URL(target).searchParams.get('q') || '';
        return new Response(JSON.stringify([`客户端5直达 ${tokensOf(q)} 测试。`]), { status: 200 });
      }
      if (target.startsWith('https://www.bing.com/translator')) {
        await new Promise(r => setTimeout(r, 35));
        const res = new Response(
          '<div data-iid="translator.5028"></div><script>IG:"CN_IG";var params_AbusePreventionHelper=[1700000000,"CN_TOK",3600000];</script>',
          { status: 200 }
        );
        Object.defineProperty(res, 'url', { value: 'https://cn.bing.com/translator' });
        return res;
      }
      if (target.startsWith('https://cn.bing.com/ttranslatev3')) {
        postUrls.push(target);
        await new Promise(r => setTimeout(r, 35));
        const q = new URLSearchParams(init?.body || '').get('text') || '';
        return new Response(JSON.stringify([{ translations: [{ text: `国内必应 ${tokensOf(q)} 译文` }] }]), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${target}`);
    };

    const store = createTranslatorStore(dir, {
      getSettings: () => ({ language: 'zh-CN', detailTranslationEngine: 'free' }),
      fetchImpl: fetchMock
    });

    // Cold-start race should resolve immediately with fastest valid provider (google-clients5 at ~15ms)
    const first = await store.translateSegment({ text: 'Fastest `lib/translator.mjs` route wins.' });
    assert.equal(first.provider, 'google-clients5');
    assert.equal(first.text, '客户端5直达 `lib/translator.mjs` 测试。');

    // Give slower background benchmark probes ~130ms to record their latencies too
    await new Promise(r => setTimeout(r, 140));
    const st = store.status();
    assert.equal(st.activeFreeProvider, 'google-clients5');
    assert.ok(postUrls.some(u => u.startsWith('https://cn.bing.com/ttranslatev3')));

    // testConnection probes all 3 providers concurrently and returns full benchmarks
    const tested = await store.testConnection({ engine: 'free', targetLang: 'zh-CN' });
    assert.equal(tested.ok, true);
    assert.equal(tested.provider, 'google-clients5');
    assert.equal(tested.benchmarks.length, 3);
    assert.ok(tested.benchmarks.every(b => b.ok));
    store.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('path masking preserves plain English slash pairs like symbols/strings while still protecting real paths', () => {
  assert.equal(shouldSkipTranslation('Compare symbols/strings cleanly.'), false);
  assert.equal(shouldSkipTranslation('Check read/write behavior.'), false);
  assert.equal(shouldSkipTranslation('lib/native-ui.js'), true);

  const plainMask = maskTechnicalTokens('Compare symbols/strings and check read/write.', 'free');
  assert.deepEqual(plainMask.tokens, []);
  assert.equal(plainMask.masked, 'Compare symbols/strings and check read/write.');

  const pathMask = maskTechnicalTokens(
    'Inspect lib/native-ui.js, ~/foo/bar, ./a/b, /etc/hosts, a/b/c, stage2_probe/run, foo\\bar, and SKILL.md#L1-243.',
    'free'
  );
  assert.deepEqual(pathMask.tokens, [
    'lib/native-ui.js',
    '~/foo/bar',
    './a/b',
    '/etc/hosts',
    'a/b/c',
    'stage2_probe/run',
    'foo\\bar',
    'SKILL.md#L1-243'
  ]);
});

test('translator supports all 8 non-English v2.16.10 locales across free MT, LLM prompts, and shouldSkipTranslation', async () => {
  assert.equal(shouldSkipTranslation('設定ファイルとテストを確認しています。', 'ja'), true);
  assert.equal(shouldSkipTranslation('Checking `lib/translator.mjs` ファイルの更新を確認しています。', 'ja'), true);
  assert.equal(shouldSkipTranslation('구성 파일과 테스트를 확인하는 중입니다.', 'ko'), true);
  assert.equal(shouldSkipTranslation('Проверяем конфигурацию и результаты тестов.', 'ru'), true);
  assert.equal(shouldSkipTranslation('Checking configuration and running verification suite.', 'fr'), false);
  assert.equal(shouldSkipTranslation('Checking configuration and running verification suite.', 'de'), false);
  assert.equal(shouldSkipTranslation('Checking configuration and running verification suite.', 'es'), false);
  assert.equal(shouldSkipTranslation('Checking configuration and running verification suite.', 'ja'), false);

  const dir = mkdtempSync(join(tmpdir(), 'agy-tr-8lang-'));
  try {
    const tokensOf = s => (String(s || '').match(/⟦\d+⟧/g) || []).join(' ');
    const seen = { gtx: [], clients5: [], bing: [], llm: [] };
    let engine = 'free';
    let language = 'fr';
    const fetchMock = async (url, init) => {
      const target = String(url);
      if (target.includes('translate.googleapis.com')) {
        const u = new URL(target);
        const tl = u.searchParams.get('tl');
        const q = u.searchParams.get('q') || '';
        seen.gtx.push(tl);
        return new Response(JSON.stringify([[[`tr-${tl} ${tokensOf(q)}`, 'src']]]), { status: 200 });
      }
      if (target.includes('clients5.google.com')) {
        const u = new URL(target);
        const tl = u.searchParams.get('tl');
        const q = u.searchParams.get('q') || '';
        seen.clients5.push(tl);
        return new Response(JSON.stringify([`c5-${tl} ${tokensOf(q)}`]), { status: 200 });
      }
      if (target.startsWith('https://www.bing.com/translator')) {
        return new Response(
          '<div data-iid="translator.5028"></div><script>IG:"IG8";var params_AbusePreventionHelper=[1700000000,"TOK8",3600000];</script>',
          { status: 200 }
        );
      }
      if (target.startsWith('https://www.bing.com/ttranslatev3')) {
        const params = new URLSearchParams(init?.body || '');
        const to = params.get('to');
        const q = params.get('text') || '';
        seen.bing.push(to);
        return new Response(JSON.stringify([{ translations: [{ text: `bing-${to} ${tokensOf(q)}` }] }]), { status: 200 });
      }
      if (target.includes('/chat/completions')) {
        const body = JSON.parse(init?.body || '{}');
        seen.llm.push(body.messages?.[0]?.content || '');
        return makeSseResponse([
          'data: {"choices":[{"delta":{"content":"Translated sample."}}]}\n\n',
          'data: [DONE]\n\n'
        ]);
      }
      throw new Error(`Unexpected URL: ${target}`);
    };

    const store = createTranslatorStore(dir, {
      getSettings: () => ({ language, detailTranslationEngine: engine, detailTranslationBaseUrl: 'https://api.example.com/v1', detailTranslationModel: 'gpt-4o-mini' }),
      fetchImpl: fetchMock
    });

    for (const [lang, expectedBing] of [['zh-CN', 'zh-Hans'], ['zh-TW', 'zh-Hant'], ['fr', 'fr'], ['ja', 'ja'], ['ko', 'ko'], ['de', 'de'], ['es', 'es'], ['ru', 'ru']]) {
      language = lang;
      engine = 'free';
      const probed = await store.testConnection({ engine: 'free', targetLang: lang });
      assert.equal(probed.ok, true);
      assert.equal(seen.gtx.at(-1), lang);
      assert.equal(seen.clients5.at(-1), lang);
      assert.equal(seen.bing.at(-1), expectedBing);

      engine = 'openai';
      await store.translateSegment({ text: `Checking pipeline status for ${lang}.`, targetLang: lang, skipCache: true });
    }
    assert.ok(seen.llm.some(p => /French/.test(p)));
    assert.ok(seen.llm.some(p => /Japanese/.test(p)));
    assert.ok(seen.llm.some(p => /Korean/.test(p)));
    assert.ok(seen.llm.some(p => /German/.test(p)));
    assert.ok(seen.llm.some(p => /Spanish/.test(p)));
    assert.ok(seen.llm.some(p => /Russian/.test(p)));
    store.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
