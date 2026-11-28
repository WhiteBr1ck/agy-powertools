import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

import {
  AI_PROTOCOLS,
  AI_PROVIDERS,
  DEFAULT_BASE_URLS,
  completeText,
  isLoopbackHost,
  listModels,
  streamText,
  testConnection,
  validateAiEndpoint
} from '../lib/ai-provider.mjs';

import {
  createAiProvidersStore,
  formatModelRef,
  parseModelRef
} from '../lib/ai-providers-store.mjs';

import {
  TRANSLATE_ENGINES,
  createThinkingTranslator,
  mapTargetLang,
  maskTechnicalMarkdown,
  shouldSkipTranslation,
  translateGoogleGtx,
  translateGoogleHtml,
  translateMicrosoftEdge,
  unmaskTechnicalMarkdown
} from '../lib/translator.mjs';

import {
  buildMinimalContextSummary,
  createIntentPredictor,
  parsePredictedIntent
} from '../lib/intent-predictor.mjs';

import { createSettingsStore } from '../lib/settings.mjs';
import { startNativeIntegration } from '../lib/native-host.mjs';

function makeJsonResponse(data, { status = 200, headers = { 'content-type': 'application/json' } } = {}) {
  const raw = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    async json() { return JSON.parse(raw); },
    async text() { return raw; }
  };
}

function makeWebStreamResponse(chunks, { status = 200, contentType = 'text/event-stream' } = {}) {
  const encoder = new TextEncoder();
  let idx = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (idx >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[idx++];
      controller.enqueue(chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk)));
    }
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { 'content-type': contentType },
    body
  };
}

// ============================================================================
// 1. lib/ai-provider.mjs tests (4 protocols: openai, openai-responses, anthropic, gemini)
// ============================================================================

test('AI_PROTOCOLS, AI_PROVIDERS alias, DEFAULT_BASE_URLS, and isLoopbackHost enforce strict checks', () => {
  assert.deepEqual(AI_PROTOCOLS, ['openai', 'openai-responses', 'anthropic', 'gemini']);
  assert.equal(AI_PROVIDERS, AI_PROTOCOLS);
  assert.equal(Object.isFrozen(AI_PROTOCOLS), true);
  assert.equal(DEFAULT_BASE_URLS.openai, 'https://api.openai.com/v1');
  assert.equal(DEFAULT_BASE_URLS['openai-responses'], 'https://api.openai.com/v1');
  assert.equal(DEFAULT_BASE_URLS.anthropic, 'https://api.anthropic.com/v1');
  assert.equal(DEFAULT_BASE_URLS.gemini, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(Object.hasOwn(DEFAULT_BASE_URLS, 'ollama'), false);
  assert.equal(Object.isFrozen(DEFAULT_BASE_URLS), true);

  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.0.0.2', '127.255.255.254', '::1', '[::1]']) {
    assert.equal(isLoopbackHost(host), true, `expected ${host} to be loopback`);
  }
  for (const host of [
    '',
    '   ',
    '0.0.0.0',
    '127.0.0.256',
    '127.01.0.1',
    '127.0.0.1.evil.com',
    'localhost.evil.com',
    '10.0.0.1',
    '192.168.1.1',
    'api.openai.com',
    '::ffff:127.0.0.1',
    null,
    undefined
  ]) {
    assert.equal(isLoopbackHost(host), false, `expected ${String(host)} NOT to be loopback`);
  }
});

test('validateAiEndpoint supports all 4 protocols, accepts protocol or provider, and enforces URL & key invariants', () => {
  // Invariant 1: remote http: strictly forbidden even WITH apiKey
  for (const protocol of AI_PROTOCOLS) {
    const res = validateAiEndpoint({ protocol, baseUrl: 'http://api.example.com/v1', apiKey: 'sk-test' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'remote-http-disallowed');
  }
  assert.equal(
    validateAiEndpoint({ protocol: 'openai', baseUrl: 'http://127.0.0.1.nip.io/v1', apiKey: 'sk-test' }).code,
    'remote-http-disallowed'
  );

  // Invariant 2: non-loopback endpoints strictly require non-empty apiKey when requireKeyForRemote === true
  for (const protocol of AI_PROTOCOLS) {
    const res = validateAiEndpoint({ protocol, baseUrl: 'https://remote.example.com/v1', apiKey: '   ' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'api-key-required');
  }

  // Opt-out flag permits keyless remote URL validation (used when saving provider drafts)
  const optOut = validateAiEndpoint({
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1/',
    apiKey: '',
    requireKeyForRemote: false
  });
  assert.equal(optOut.ok, true);
  assert.equal(optOut.protocol, 'anthropic');
  assert.equal(optOut.provider, 'anthropic');
  assert.equal(optOut.baseUrl, 'https://api.anthropic.com/v1');

  // Loopback allows http: AND keyless across protocols (e.g. local OpenAI-compatible relay)
  const localRelay = validateAiEndpoint({ protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1/' });
  assert.equal(localRelay.ok, true);
  assert.equal(localRelay.isLoopback, true);
  assert.equal(localRelay.origin, 'http://127.0.0.1:11434');
  assert.equal(localRelay.baseUrl, 'http://127.0.0.1:11434/v1');

  const localV6 = validateAiEndpoint({ provider: 'openai-responses', baseUrl: 'http://[::1]:8080/v1/', apiKey: '' });
  assert.equal(localV6.ok, true);
  assert.equal(localV6.isLoopback, true);
  assert.equal(localV6.protocol, 'openai-responses');
  assert.equal(localV6.provider, 'openai-responses');
  assert.equal(localV6.origin, 'http://[::1]:8080');
  assert.equal(localV6.baseUrl, 'http://[::1]:8080/v1');

  const localSubnet = validateAiEndpoint({ protocol: 'gemini', baseUrl: 'http://127.10.20.30:3000/v1beta' });
  assert.equal(localSubnet.ok, true);
  assert.equal(localSubnet.isLoopback, true);

  // Remote HTTPS with apiKey succeeds and returns exact expected shape
  const remoteOpenAi = validateAiEndpoint({ provider: 'openai', apiKey: 'sk-live-123' });
  assert.deepEqual(remoteOpenAi, {
    ok: true,
    provider: 'openai',
    protocol: 'openai',
    origin: 'https://api.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    isLoopback: false
  });

  const remoteAnthropic = validateAiEndpoint({ protocol: 'ANTHROPIC', apiKey: 'sk-ant-123' });
  assert.deepEqual(remoteAnthropic, {
    ok: true,
    provider: 'anthropic',
    protocol: 'anthropic',
    origin: 'https://api.anthropic.com',
    baseUrl: 'https://api.anthropic.com/v1',
    isLoopback: false
  });

  // Rejects removed ollama, userinfo, query strings, hashes, non-http protocols, invalid URLs, CRLF keys
  assert.equal(validateAiEndpoint({ protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434' }).code, 'invalid-provider');
  assert.equal(validateAiEndpoint({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434' }).code, 'invalid-provider');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'https://user:pass@api.openai.com/v1', apiKey: 'sk-1' }).code, 'credentials-in-url-disallowed');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'https://@api.openai.com/v1', apiKey: 'sk-1' }).code, 'credentials-in-url-disallowed');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1?key=123', apiKey: 'sk-1' }).code, 'query-disallowed');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1?', apiKey: 'sk-1' }).code, 'query-disallowed');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1#section', apiKey: 'sk-1' }).code, 'hash-disallowed');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1#', apiKey: 'sk-1' }).code, 'hash-disallowed');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'ftp://api.openai.com/v1', apiKey: 'sk-1' }).code, 'unsupported-protocol');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'file:///etc/passwd', apiKey: 'sk-1' }).code, 'unsupported-protocol');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'not-a-url', apiKey: 'sk-1' }).code, 'invalid-url');
  assert.equal(validateAiEndpoint({ protocol: 'openai', apiKey: 'sk-bad\r\nX-Injected: 1' }).code, 'invalid-api-key');
});

test('listModels works across all 4 protocols (openai, openai-responses, anthropic, gemini) and redacts keys on error', async () => {
  const seen = [];

  // 1. OpenAI
  const openaiRes = await listModels({
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1/',
    apiKey: 'sk-openai-secret',
    fetcher: async (url, init) => {
      seen.push({ url, init });
      return makeJsonResponse({
        data: [
          { id: 'gpt-4o-mini' },
          { id: 'gpt-4o' },
          { id: 'gpt-4o-mini' }
        ]
      });
    }
  });
  assert.equal(openaiRes.ok, true);
  assert.deepEqual(openaiRes.models, ['gpt-4o', 'gpt-4o-mini']);
  assert.equal(seen[0].url, 'https://api.openai.com/v1/models');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer sk-openai-secret');

  // 2. OpenAI Responses
  const responsesRes = await listModels({
    protocol: 'openai-responses',
    baseUrl: 'https://relay.example.com/v1',
    apiKey: 'sk-resp-secret',
    fetcher: async (url, init) => {
      seen.push({ url, init });
      return makeJsonResponse({
        data: [
          { id: 'o4-mini' },
          { id: 'gpt-4.1-mini' },
          { id: 'o4-mini' }
        ]
      });
    }
  });
  assert.equal(responsesRes.ok, true);
  assert.deepEqual(responsesRes.models, ['gpt-4.1-mini', 'o4-mini']);
  assert.equal(seen[1].url, 'https://relay.example.com/v1/models');
  assert.equal(seen[1].init.headers.Authorization, 'Bearer sk-resp-secret');

  // 3. Anthropic (verifies /v1 appended when omitted)
  const anthropicRes = await listModels({
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-ant-secret',
    fetcher: async (url, init) => {
      seen.push({ url, init });
      return makeJsonResponse({
        data: [
          { id: 'claude-3-7-sonnet-20250219' },
          { id: 'claude-3-5-haiku-20241022' },
          { id: 'claude-3-7-sonnet-20250219' }
        ]
      });
    }
  });
  assert.equal(anthropicRes.ok, true);
  assert.deepEqual(anthropicRes.models, ['claude-3-5-haiku-20241022', 'claude-3-7-sonnet-20250219']);
  assert.equal(seen[2].url, 'https://api.anthropic.com/v1/models');
  assert.equal(seen[2].init.headers['x-api-key'], 'sk-ant-secret');
  assert.equal(seen[2].init.headers['anthropic-version'], '2023-06-01');

  // 4. Gemini (filters generateContent when supportedGenerationMethods present, keeps relays omitting it, strips models/)
  const geminiRes = await listModels({
    protocol: 'gemini',
    apiKey: 'AIza-test-key',
    fetcher: async (url, init) => {
      seen.push({ url, init });
      return makeJsonResponse({
        models: [
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-relay-custom' }
        ]
      });
    }
  });
  assert.equal(geminiRes.ok, true);
  assert.deepEqual(geminiRes.models, ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-relay-custom']);
  assert.equal(seen[3].url, 'https://generativelanguage.googleapis.com/v1beta/models');
  assert.equal(seen[3].init.headers['x-goog-api-key'], 'AIza-test-key');

  // Error path redacts leaked API key
  const errRes = await listModels({
    protocol: 'anthropic',
    apiKey: 'sk-super-secret-value',
    fetcher: async () => makeJsonResponse(
      { error: { message: 'Invalid key sk-super-secret-value' } },
      { status: 401 }
    )
  });
  assert.equal(errRes.ok, false);
  assert.equal(errRes.status, 401);
  assert.equal(errRes.error.includes('sk-super-secret-value'), false);
  assert.ok(errRes.error.includes('[REDACTED]'));
});

test('testConnection verifies connectivity across all 4 protocols with maxTokens 16 and without model', async () => {
  // OpenAI with model
  const openaiRes = await testConnection({
    protocol: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'sk-1',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'gpt-4o-mini');
      assert.equal(body.max_tokens, 16);
      return makeJsonResponse({ choices: [{ message: { content: 'OK' } }] });
    }
  });
  assert.equal(openaiRes.ok, true);
  assert.equal(openaiRes.model, 'gpt-4o-mini');
  assert.equal(typeof openaiRes.latencyMs, 'number');

  // OpenAI Responses with model
  const responsesRes = await testConnection({
    protocol: 'openai-responses',
    model: 'gpt-4.1-mini',
    apiKey: 'sk-resp-1',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'gpt-4.1-mini');
      assert.equal(body.max_output_tokens, 16);
      return makeJsonResponse({ output_text: 'OK' });
    }
  });
  assert.equal(responsesRes.ok, true);
  assert.equal(responsesRes.model, 'gpt-4.1-mini');

  // Anthropic with model
  const anthropicRes = await testConnection({
    protocol: 'anthropic',
    model: 'claude-3-5-haiku-latest',
    apiKey: 'sk-ant-1',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(init.headers['x-api-key'], 'sk-ant-1');
      assert.equal(init.headers['anthropic-version'], '2023-06-01');
      const body = JSON.parse(init.body);
      assert.equal(body.max_tokens, 16);
      return makeJsonResponse({ content: [{ type: 'text', text: 'OK' }] });
    }
  });
  assert.equal(anthropicRes.ok, true);
  assert.equal(anthropicRes.model, 'claude-3-5-haiku-latest');

  // Gemini without model (falls back to listModels)
  const geminiRes = await testConnection({
    protocol: 'gemini',
    apiKey: 'AIza-1',
    fetcher: async url => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models');
      return makeJsonResponse({
        models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }]
      });
    }
  });
  assert.equal(geminiRes.ok, true);
  assert.equal(geminiRes.model, 'gemini-2.5-flash');

  // Loopback keyless without model
  const loopbackRes = await testConnection({
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:8080/v1',
    fetcher: async url => {
      assert.equal(url, 'http://127.0.0.1:8080/v1/models');
      return makeJsonResponse({ data: [{ id: 'local-qwen' }] });
    }
  });
  assert.equal(loopbackRes.ok, true);
  assert.equal(loopbackRes.model, 'local-qwen');

  // Invalid remote HTTP fails cleanly
  const invalid = await testConnection({ protocol: 'openai', baseUrl: 'http://remote.example.com/v1', apiKey: 'sk-1' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'remote-http-disallowed');
});

test('completeText handles all 4 protocols and filters thinking / reasoning blocks cleanly', async () => {
  // 1. OpenAI (ignores reasoning_content and reasoning content parts)
  const openaiText = await completeText({
    protocol: 'openai',
    model: 'gpt-4o-mini',
    system: 'Be concise.',
    prompt: 'Say hi',
    apiKey: 'sk-1',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      const payload = JSON.parse(init.body);
      assert.equal(payload.stream, false);
      assert.equal(payload.messages[0].role, 'system');
      assert.equal(payload.messages[1].content, 'Say hi');
      return makeJsonResponse({
        choices: [{
          message: {
            reasoning_content: 'hidden thought',
            content: [
              { type: 'reasoning', text: 'skip me' },
              { type: 'text', text: 'Hello there' }
            ]
          }
        }]
      });
    }
  });
  assert.equal(openaiText, 'Hello there');

  // 2a. OpenAI Responses with output_text
  const respDirect = await completeText({
    protocol: 'openai-responses',
    model: 'gpt-4.1-mini',
    system: 'Translate cleanly.',
    prompt: 'Hello',
    maxTokens: 64,
    temperature: 0.1,
    apiKey: 'sk-resp-1',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(init.headers.Authorization, 'Bearer sk-resp-1');
      const payload = JSON.parse(init.body);
      assert.equal(payload.model, 'gpt-4.1-mini');
      assert.equal(payload.instructions, 'Translate cleanly.');
      assert.equal(payload.input, 'Hello');
      assert.equal(payload.max_output_tokens, 64);
      assert.equal(payload.temperature, 0.1);
      assert.equal(payload.stream, false);
      return makeJsonResponse({ output_text: '你好' });
    }
  });
  assert.equal(respDirect, '你好');

  // 2b. OpenAI Responses fallback walking output[] and ignoring reasoning items
  const respOutput = await completeText({
    protocol: 'openai-responses',
    model: 'o4-mini',
    prompt: 'Explain',
    apiKey: 'sk-resp-2',
    fetcher: async (_url, init) => {
      const payload = JSON.parse(init.body);
      assert.equal(Object.hasOwn(payload, 'instructions'), false);
      return makeJsonResponse({
        output: [
          { type: 'reasoning', summary: [{ type: 'summary_text', text: 'hidden chain of thought' }] },
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'refusal', refusal: 'ignored' },
              { type: 'output_text', text: 'Clean ' },
              { type: 'output_text', text: 'answer.' }
            ]
          }
        ]
      });
    }
  });
  assert.equal(respOutput, 'Clean answer.');

  // 3. Anthropic (concatenates text blocks and ignores thinking & redacted_thinking blocks)
  const anthropicText = await completeText({
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-7-sonnet-20250219',
    system: 'Translate cleanly.',
    prompt: 'Hi',
    maxTokens: 256,
    temperature: 0.2,
    apiKey: 'sk-ant-1',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(init.headers['x-api-key'], 'sk-ant-1');
      assert.equal(init.headers['anthropic-version'], '2023-06-01');
      const payload = JSON.parse(init.body);
      assert.equal(payload.model, 'claude-3-7-sonnet-20250219');
      assert.equal(payload.system, 'Translate cleanly.');
      assert.deepEqual(payload.messages, [{ role: 'user', content: 'Hi' }]);
      assert.equal(payload.max_tokens, 256);
      assert.equal(payload.stream, false);
      return makeJsonResponse({
        content: [
          { type: 'thinking', thinking: 'internal reasoning...' },
          { type: 'redacted_thinking', data: 'opaque' },
          { type: 'text', text: '你好，' },
          { type: 'text', text: '世界' }
        ]
      });
    }
  });
  assert.equal(anthropicText, '你好，世界');

  // 4. Gemini (filters part.thought === true)
  const geminiText = await completeText({
    protocol: 'gemini',
    model: 'models/gemini-2.5-flash',
    system: 'Translate cleanly.',
    prompt: 'Hello',
    apiKey: 'AIza-key',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      assert.equal(init.headers['x-goog-api-key'], 'AIza-key');
      const payload = JSON.parse(init.body);
      assert.equal(payload.systemInstruction.parts[0].text, 'Translate cleanly.');
      return makeJsonResponse({
        candidates: [{
          content: {
            parts: [
              { text: 'Internal chain of thought...', thought: true },
              { text: '你好' },
              { text: '世界' }
            ]
          }
        }]
      });
    }
  });
  assert.equal(geminiText, '你好世界');

  // Security check rejects before fetching
  let called = false;
  await assert.rejects(
    () => completeText({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      prompt: 'Hi',
      apiKey: '',
      fetcher: async () => { called = true; return makeJsonResponse({}); }
    }),
    err => err.code === 'api-key-required'
  );
  assert.equal(called, false);
});

test('completeText passes strictProxy: true to createProxyFetcher and fails closed without bypassing dead proxy', async () => {
  const emptyHome = mkdtempSync(join(tmpdir(), 'agy-strict-proxy-'));
  const deadProxy = net.createServer(sock => sock.destroy());
  await new Promise(resolve => deadProxy.listen(0, '127.0.0.1', resolve));
  const { port } = deadProxy.address();
  try {
    await assert.rejects(
      () => completeText({
        protocol: 'openai',
        baseUrl: 'https://nonexistent.invalid/v1',
        model: 'gpt-4o-mini',
        prompt: 'Hi',
        apiKey: 'sk-strict-test',
        home: emptyHome,
        env: { HTTPS_PROXY: `http://127.0.0.1:${port}` },
        timeoutMs: 3000
      }),
      err => /代理|断开|closed|socket|ECONN|request-failed/i.test(err.message || err.code || '')
    );
  } finally {
    await new Promise(resolve => deadProxy.close(resolve));
    rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('streamText streams OpenAI, OpenAI Responses, Anthropic, Gemini SSE (filtering thinking/reasoning), UTF-8 splits, and AbortSignal', async () => {
  // 1. OpenAI SSE with multi-byte UTF-8 split across chunks
  const utf8Event = Buffer.from(
    'data: {"choices":[{"delta":{"reasoning_content":"secret"}}]}\n\n'
    + 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n'
    + 'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n'
    + 'data: [DONE]\n\n',
    'utf8'
  );
  const splitIdx = utf8Event.indexOf(Buffer.from('你好', 'utf8')) + 2;
  const openaiDeltas = [];
  const openaiOut = await streamText({
    protocol: 'openai',
    model: 'gpt-4o-mini',
    prompt: 'Greet',
    apiKey: 'sk-1',
    onDelta: d => openaiDeltas.push(d),
    fetcher: async () => makeWebStreamResponse([
      utf8Event.subarray(0, splitIdx),
      utf8Event.subarray(splitIdx)
    ])
  });
  assert.deepEqual(openaiDeltas, ['你好', '世界']);
  assert.equal(openaiOut, '你好世界');

  // 2a. OpenAI Responses SSE with reasoning deltas ignored and output_text deltas emitted
  const respDeltas = [];
  const respOut = await streamText({
    protocol: 'openai-responses',
    model: 'o4-mini',
    prompt: 'Translate',
    apiKey: 'sk-resp-1',
    onDelta: d => respDeltas.push(d),
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(JSON.parse(init.body).stream, true);
      return makeWebStreamResponse([
        'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"secret reasoning"}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"第一"}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"句。"}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"output_text":"第一句。"}}\n\n'
      ]);
    }
  });
  assert.deepEqual(respDeltas, ['第一', '句。']);
  assert.equal(respOut, '第一句。');

  // 2b. OpenAI Responses SSE handles response.completed cleanly when no deltas were emitted
  const respFallbackDeltas = [];
  const respFallbackOut = await streamText({
    protocol: 'openai-responses',
    model: 'gpt-4.1-mini',
    prompt: 'Short',
    apiKey: 'sk-resp-2',
    onDelta: d => respFallbackDeltas.push(d),
    fetcher: async () => makeWebStreamResponse([
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"reasoning","summary":[]},{"type":"message","content":[{"type":"output_text","text":"Only completed"}]}]}}\n\n'
    ])
  });
  assert.deepEqual(respFallbackDeltas, ['Only completed']);
  assert.equal(respFallbackOut, 'Only completed');

  // 3. Anthropic SSE emits text_delta and ignores thinking_delta / signature_delta
  const antDeltas = [];
  const antOut = await streamText({
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-7-sonnet-20250219',
    prompt: 'Explain',
    apiKey: 'sk-ant-1',
    onDelta: d => antDeltas.push(d),
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(init.headers['x-api-key'], 'sk-ant-1');
      assert.equal(init.headers['anthropic-version'], '2023-06-01');
      assert.equal(JSON.parse(init.body).stream, true);
      return makeWebStreamResponse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hidden thoughts"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"abc"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Anthropic "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"works!"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n'
      ]);
    }
  });
  assert.deepEqual(antDeltas, ['Anthropic ', 'works!']);
  assert.equal(antOut, 'Anthropic works!');

  // 4. Gemini SSE filtering part.thought === true
  const geminiDeltas = [];
  const geminiOut = await streamText({
    protocol: 'gemini',
    model: 'gemini-2.5-flash',
    prompt: 'Explain',
    apiKey: 'AIza-key',
    onDelta: d => geminiDeltas.push(d),
    fetcher: async url => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
      return makeWebStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"thinking...","thought":true}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"still thinking","thought":true},{"text":"第一段"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"，第二段"}]}}]}\n\n'
      ]);
    }
  });
  assert.deepEqual(geminiDeltas, ['第一段', '，第二段']);
  assert.equal(geminiOut, '第一段，第二段');

  // 5. Non-streaming JSON fallback for proxies ignoring stream: true
  const antJsonOut = await streamText({
    protocol: 'anthropic',
    model: 'claude-3-5-haiku-latest',
    prompt: 'Hi',
    apiKey: 'sk-ant-2',
    fetcher: async () => makeJsonResponse({
      content: [
        { type: 'thinking', thinking: 'skip' },
        { type: 'text', text: 'JSON fallback OK' }
      ]
    })
  });
  assert.equal(antJsonOut, 'JSON fallback OK');

  // 6. AbortSignal cleanly cancels mid-stream
  const ac = new AbortController();
  const seenBeforeAbort = [];
  await assert.rejects(
    () => streamText({
      protocol: 'openai',
      model: 'gpt-4o-mini',
      prompt: 'Stream long',
      apiKey: 'sk-1',
      signal: ac.signal,
      onDelta: chunk => {
        seenBeforeAbort.push(chunk);
        ac.abort();
      },
      fetcher: async () => makeWebStreamResponse([
        'data: {"choices":[{"delta":{"content":"chunk1"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"chunk2"}}]}\n\n'
      ])
    }),
    err => err.name === 'AbortError'
  );
  assert.deepEqual(seenBeforeAbort, ['chunk1']);
});

// ============================================================================
// 2. lib/ai-providers-store.mjs tests
// ============================================================================

test('parseModelRef, formatModelRef, and createAiProvidersStore manage CRUD, validation, 0600 file, and resolution', () => {
  assert.deepEqual(parseModelRef('prov_abc123::gpt-4o-mini'), { providerId: 'prov_abc123', model: 'gpt-4o-mini' });
  assert.deepEqual(parseModelRef('  prov_abc123 :: org::model-v2  '), { providerId: 'prov_abc123', model: 'org::model-v2' });
  assert.deepEqual(parseModelRef('gpt-4o-mini'), { providerId: '', model: 'gpt-4o-mini' });
  assert.deepEqual(parseModelRef('   '), { providerId: '', model: '' });
  assert.equal(formatModelRef('prov_abc123', 'gpt-4o-mini'), 'prov_abc123::gpt-4o-mini');
  assert.equal(formatModelRef('', 'gpt-4o-mini'), '');
  assert.equal(formatModelRef('prov_abc123', ''), '');

  const dir = mkdtempSync(join(tmpdir(), 'agy-providers-store-'));
  try {
    const store = createAiProvidersStore(dir);
    assert.deepEqual(store.list(), []);
    assert.equal(store.get('missing'), null);

    // Create provider with comma/newline models, default baseUrl, empty key allowed on save
    const created = store.upsert({
      name: '  Anthropic Main  ',
      protocol: 'anthropic',
      baseUrl: '',
      apiKey: '  sk-ant-secret  ',
      models: 'claude-3-7-sonnet-20250219, claude-3-5-haiku-20241022\nclaude-3-7-sonnet-20250219\n  '
    });
    assert.equal(created.ok, true);
    assert.match(created.provider.id, /^prov_[0-9a-f]{12}$/);
    assert.equal(created.provider.name, 'Anthropic Main');
    assert.equal(created.provider.protocol, 'anthropic');
    assert.equal(created.provider.baseUrl, 'https://api.anthropic.com/v1');
    assert.equal(created.provider.apiKey, 'sk-ant-secret');
    assert.deepEqual(created.provider.models, ['claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022']);
    assert.equal(created.providers.length, 1);

    // Separate file ai-providers.json exists with 0600 on POSIX, settings.json untouched
    const storeFile = join(dir, 'ai-providers.json');
    assert.equal(existsSync(storeFile), true);
    assert.equal(existsSync(join(dir, 'settings.json')), false);
    if (process.platform !== 'win32') {
      assert.equal(statSync(storeFile).mode & 0o777, 0o600);
    }

    // Update preserves createdAt and updates fields
    const updated = store.upsert({
      id: created.provider.id,
      name: 'Anthropic Updated',
      protocol: 'anthropic',
      baseUrl: 'https://relay.example.com/anthropic/',
      apiKey: 'sk-ant-updated',
      models: ['claude-3-5-haiku-20241022']
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.provider.id, created.provider.id);
    assert.equal(updated.provider.createdAt, created.provider.createdAt);
    assert.ok(updated.provider.updatedAt >= created.provider.updatedAt);
    assert.equal(updated.provider.baseUrl, 'https://relay.example.com/anthropic');
    assert.deepEqual(updated.provider.models, ['claude-3-5-haiku-20241022']);

    // Create loopback local provider without API key
    const localProv = store.upsert({
      name: 'Local Relay',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:8080/v1/',
      apiKey: '',
      models: ['local-model']
    });
    assert.equal(localProv.ok, true);
    assert.equal(localProv.provider.baseUrl, 'http://127.0.0.1:8080/v1');
    assert.equal(localProv.provider.apiKey, '');

    // resolveModel resolves valid ref and rejects invalid refs cleanly
    const ref = formatModelRef(created.provider.id, 'claude-3-5-haiku-20241022');
    const resolved = store.resolveModel(ref);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.protocol, 'anthropic');
    assert.equal(resolved.baseUrl, 'https://relay.example.com/anthropic');
    assert.equal(resolved.apiKey, 'sk-ant-updated');
    assert.equal(resolved.model, 'claude-3-5-haiku-20241022');

    assert.equal(store.resolveModel('').code, 'model-required');
    assert.equal(store.resolveModel('bare-model-only').code, 'provider-required');
    assert.equal(store.resolveModel('prov_missing::gpt-4o').code, 'provider-not-found');

    // Rejects invalid inputs (empty name, ollama protocol, remote HTTP, query/creds in URL, control chars in key)
    assert.equal(store.upsert({ name: '   ', protocol: 'openai' }).code, 'invalid-name');
    assert.equal(store.upsert({ name: 'Ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434' }).code, 'invalid-protocol');
    assert.equal(store.upsert({ name: 'Bad HTTP', protocol: 'openai', baseUrl: 'http://remote.example.com/v1' }).code, 'remote-http-disallowed');
    assert.equal(store.upsert({ name: 'Bad Creds', protocol: 'openai', baseUrl: 'https://user:pass@api.openai.com/v1' }).code, 'credentials-in-url-disallowed');
    assert.equal(store.upsert({ name: 'Bad Query', protocol: 'openai', baseUrl: 'https://api.openai.com/v1?x=1' }).code, 'query-disallowed');
    assert.equal(store.upsert({ name: 'Bad Key', protocol: 'openai', apiKey: 'sk-1\r\nX: 1' }).code, 'invalid-api-key');

    // Enforce max 50 providers
    for (let i = store.list().length; i < 50; i++) {
      const r = store.upsert({ name: `Provider ${i}`, protocol: 'openai-responses', apiKey: '' });
      assert.equal(r.ok, true);
    }
    assert.equal(store.list().length, 50);
    const overLimit = store.upsert({ name: 'Provider 51', protocol: 'openai' });
    assert.equal(overLimit.ok, false);
    assert.equal(overLimit.code, 'max-providers');

    // Remove provider
    const removed = store.remove(created.provider.id);
    assert.equal(removed.ok, true);
    assert.equal(removed.removed, true);
    assert.equal(removed.providers.length, 49);
    assert.equal(store.get(created.provider.id), null);

    const removeMissing = store.remove('prov_doesnotexist');
    assert.equal(removeMissing.ok, true);
    assert.equal(removeMissing.removed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 3. lib/translator.mjs tests
// ============================================================================

test('mapTargetLang maps all 10 Powertools languages accurately for Google and Edge', () => {
  assert.deepEqual(TRANSLATE_ENGINES, ['free', 'ai']);
  assert.deepEqual(mapTargetLang('zh-CN'), { lang: 'zh-CN', google: 'zh-CN', edge: 'zh-Hans', label: 'Simplified Chinese' });
  assert.deepEqual(mapTargetLang('zh-TW'), { lang: 'zh-TW', google: 'zh-TW', edge: 'zh-Hant', label: 'Traditional Chinese' });
  for (const code of ['en', 'fr', 'ja', 'ko', 'de', 'es', 'ru', 'vi']) {
    const mapped = mapTargetLang(code);
    assert.equal(mapped.lang, code);
    assert.equal(mapped.google, code);
    assert.equal(mapped.edge, code);
  }
  assert.equal(mapTargetLang('zh_HK').edge, 'zh-Hant');
  assert.equal(mapTargetLang('en-US').google, 'en');
  assert.equal(mapTargetLang('ja-JP').edge, 'ja');
});

test('maskTechnicalMarkdown and unmaskTechnicalMarkdown are collision-free, preserve $& safely, and audit dropped tokens', () => {
  const sample = [
    'Template {{0}} calls `replace("$&", $1)` on C:\\Users\\dev\\app.mjs and lib/ai-provider.mjs.',
    'Check https://example.com/docs/v1_(beta). Also keep input/output and HTTP/1.1 untouched.',
    '---',
    '```js',
    'const price = "$& $$ $1 {{0}}";',
    '```'
  ].join('\n');

  const { masked, tokens } = maskTechnicalMarkdown(sample);
  assert.ok(masked.includes('Template {{0}}'));
  assert.equal(tokens.some(t => t.index === 0), false);
  assert.equal(masked.includes('const price'), false);
  assert.equal(masked.includes('https://example.com'), false);
  assert.equal(masked.includes('C:\\Users\\dev\\app.mjs'), false);
  assert.equal(masked.includes('lib/ai-provider.mjs'), false);
  assert.ok(masked.includes('input/output'));
  assert.ok(masked.includes('HTTP/1.1'));

  const mangledSpaces = masked
    .replace('{{1}}', '{{ 1 }}')
    .replace('{{2}}', '｛｛2｝｝');
  const restored = unmaskTechnicalMarkdown(mangledSpaces, tokens);
  assert.equal(restored.ok, true);
  assert.equal(restored.intact, true);
  assert.equal(restored.missing.length, 0);
  assert.equal(restored.text, sample);

  const dropped = masked.replace(tokens[0].placeholder, '');
  const audited = unmaskTechnicalMarkdown(dropped, tokens);
  assert.equal(audited.ok, false);
  assert.equal(audited.missing.length, 1);
  assert.equal(audited.missing[0].placeholder, tokens[0].placeholder);
});

test('shouldSkipTranslation skips empty, code-only, symbol-only, and same-language text while translating foreign text', () => {
  assert.equal(shouldSkipTranslation('', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('   \n\t  ', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('```ts\nexport const x = 1;\n```', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('12345.67 + 890 = 13235.67', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('---', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('https://example.com/a/b', 'zh-CN'), true);

  assert.equal(shouldSkipTranslation('先检查 `lib/proxy.mjs` 中的 HTTP 和 JSON 代理逻辑。', 'zh-CN'), true);
  assert.equal(shouldSkipTranslation('這是一段繁體中文思考內容。', 'zh-TW'), true);

  assert.equal(shouldSkipTranslation('Let us inspect the proxy settings carefully.', 'zh-CN'), false);
  assert.equal(shouldSkipTranslation('CHECK THE PROXY SETTINGS NOW', 'zh-CN'), false);
  assert.equal(shouldSkipTranslation('Let us inspect the proxy settings carefully.', 'en'), true);
  assert.equal(shouldSkipTranslation('先检查代理设置。', 'en'), false);

  assert.equal(shouldSkipTranslation('これは日本語のテスト文章です。', 'zh-CN'), false);
  assert.equal(shouldSkipTranslation('これは日本語のテスト文章です。', 'ja'), true);
  assert.equal(shouldSkipTranslation('이것은 한국어 테스트 문장입니다.', 'ko'), true);
  assert.equal(shouldSkipTranslation('Это тестовое предложение на русском языке.', 'ru'), true);
});

test('translateGoogleHtml, translateGoogleGtx, and translateMicrosoftEdge format requests properly and unescape HTML once', async () => {
  let capturedHtmlReq;
  const gHtml = await translateGoogleHtml('Line 1 & <br>\n\nLine 2 "ok"', 'zh-CN', {
    fetcher: async (url, init) => {
      capturedHtmlReq = { url, init };
      return makeJsonResponse([['第一行 &amp; &lt;br&gt;<br><br>第二行 &quot;ok&quot; &amp;lt;tag&amp;gt;'], ['en']]);
    }
  });
  assert.equal(capturedHtmlReq.url, 'https://translate-pa.googleapis.com/v1/translateHtml');
  assert.equal(capturedHtmlReq.init.method, 'POST');
  assert.equal(capturedHtmlReq.init.headers['Content-Type'], 'application/json+protobuf');
  assert.ok(capturedHtmlReq.init.headers['X-Goog-API-Key'].startsWith('AIza'));
  assert.ok(capturedHtmlReq.init.headers['User-Agent'].includes('Mozilla/5.0'));
  const htmlBody = JSON.parse(capturedHtmlReq.init.body);
  assert.equal(htmlBody[0][0][0], 'Line 1 &amp; &lt;br&gt;<br><br>Line 2 &quot;ok&quot;');
  assert.equal(htmlBody[0][1], 'auto');
  assert.equal(htmlBody[0][2], 'zh-CN');
  assert.equal(htmlBody[1], 'wt_lib');
  assert.equal(gHtml, '第一行 & <br>\n\n第二行 "ok" &lt;tag&gt;');

  let capturedGtxReq;
  const gGtx = await translateGoogleGtx('Hello world', 'zh-TW', {
    fetcher: async (url, init) => {
      capturedGtxReq = { url, init };
      return makeJsonResponse([[['哈囉', 'Hello'], ['世界', ' world']]]);
    }
  });
  assert.equal(capturedGtxReq.url, 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t');
  assert.equal(capturedGtxReq.init.method, 'POST');
  assert.ok(capturedGtxReq.init.headers['Content-Type'].includes('application/x-www-form-urlencoded'));
  assert.equal(capturedGtxReq.init.body, 'q=Hello%20world');
  assert.equal(gGtx, '哈囉世界');

  let capturedEdgeReq;
  const edgeOut = await translateMicrosoftEdge('Hello <world> & friends', 'zh-CN', {
    fetcher: async (url, init) => {
      capturedEdgeReq = { url, init };
      return makeJsonResponse(['你好 &lt;世界&gt; &amp; 朋友 &amp;quot;']);
    }
  });
  assert.equal(capturedEdgeReq.url, 'https://edge.microsoft.com/translate/translatetext?from=&to=zh-Hans&isEnterpriseClient=false');
  assert.equal(capturedEdgeReq.init.method, 'POST');
  assert.equal(capturedEdgeReq.init.headers['Content-Type'], 'application/json');
  assert.equal(capturedEdgeReq.init.headers.Authorization, undefined);
  assert.equal(capturedEdgeReq.init.body, JSON.stringify(['Hello &lt;world&gt; &amp; friends']));
  assert.equal(edgeOut, '你好 <世界> & 朋友 &quot;');
});

test('createThinkingTranslator handles free fallback chain, sticky winning transport, AI streaming across protocols, 0600 disk cache, 7d TTL, and purgeCache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-tr-test-'));
  try {
    let fakeNow = 1_700_000_000_000;
    const calledUrls = [];

    const fallbackFetcher = async (url, init) => {
      calledUrls.push(url);
      if (url.includes('translate-pa.googleapis.com')) {
        throw new Error('ECONNRESET');
      }
      if (url.includes('translate.googleapis.com')) {
        return makeJsonResponse({}, { status: 429 });
      }
      if (url.includes('edge.microsoft.com')) {
        const [raw] = JSON.parse(init.body);
        return makeJsonResponse([`[ZH] ${raw}`]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const translator = createThinkingTranslator({
      dataDir: dir,
      fetcher: fallbackFetcher,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      now: () => fakeNow
    });

    const deltas = [];
    const input = 'First paragraph with `code()`.\n\nSecond paragraph referencing lib/proxy.mjs.';
    const res1 = await translator.translate({
      text: input,
      targetLang: 'zh-CN',
      engine: 'free',
      onDelta: chunk => deltas.push(chunk)
    });

    assert.equal(res1.ok, true);
    assert.equal(res1.cached, false);
    assert.equal(res1.transport, 'edge');
    assert.equal(res1.text, '[ZH] First paragraph with `code()`.\n\n[ZH] Second paragraph referencing lib/proxy.mjs.');
    assert.equal(deltas.join(''), res1.text);
    assert.equal(calledUrls.length, 4);
    assert.ok(calledUrls[3].includes('edge.microsoft.com'));
    assert.equal(translator.getPreferredTransport(), 'edge');

    const cacheFile = join(dir, 'thinking-translate-cache.json');
    assert.equal(existsSync(cacheFile), true);
    if (process.platform !== 'win32') {
      assert.equal(statSync(cacheFile).mode & 0o777, 0o600);
    }

    const callCountBeforeHit = calledUrls.length;
    const resHit = await translator.translate({ text: input, targetLang: 'zh-CN', engine: 'free' });
    assert.equal(resHit.cached, true);
    assert.equal(resHit.text, res1.text);
    assert.equal(calledUrls.length, callCountBeforeHit);

    fakeNow += 6 * 24 * 60 * 60 * 1000;
    const reloaded = createThinkingTranslator({
      dataDir: dir,
      fetcher: fallbackFetcher,
      now: () => fakeNow
    });
    const resReloaded = await reloaded.translate({ text: input, targetLang: 'zh-CN', engine: 'free' });
    assert.equal(resReloaded.cached, true);
    assert.equal(resReloaded.text, res1.text);

    fakeNow += 2 * 24 * 60 * 60 * 1000;
    const expiredReload = createThinkingTranslator({
      dataDir: dir,
      fetcher: fallbackFetcher,
      now: () => fakeNow
    });
    assert.equal(expiredReload.cacheSize(), 0);
    const resAfterExpiry = await reloaded.translate({ text: input, targetLang: 'zh-CN', engine: 'free' });
    assert.equal(resAfterExpiry.cached, false);

    // AI streaming engine test with Anthropic protocol
    const aiDeltas = [];
    const aiRes = await translator.translate({
      text: 'Inspect the network stack.',
      targetLang: 'zh-CN',
      engine: 'ai',
      aiConfig: {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-3-5-haiku-latest',
        apiKey: 'sk-ant-ai-key',
        fetcher: async () => makeWebStreamResponse([
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"检查"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"网络栈。"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        ])
      },
      onDelta: d => aiDeltas.push(d)
    });
    assert.equal(aiRes.ok, true);
    assert.equal(aiRes.engine, 'ai');
    assert.equal(aiRes.text, '检查网络栈。');
    assert.deepEqual(aiDeltas, ['检查', '网络栈。']);

    translator.purgeCache();
    assert.equal(translator.cacheSize(), 0);
    assert.equal(existsSync(cacheFile), false);
    assert.deepEqual(translator.clearCache(), { ok: true, cleared: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createThinkingTranslator chunks oversized >3500-char paragraphs safely without breaking {{n}} tokens', async () => {
  const sentChunks = [];
  const translator = createThinkingTranslator({
    dataDir: null,
    fetcher: async (url, init) => {
      if (url.includes('translate-pa.googleapis.com')) {
        const body = JSON.parse(init.body);
        const rawHtml = body[0][0][0];
        sentChunks.push(rawHtml);
        return makeJsonResponse([[`TR:${rawHtml}`], ['en']]);
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  });
  const sentence = 'Checking `validateAiEndpoint()` in lib/ai-provider.mjs carefully while reviewing every branch. ';
  const hugeParagraph = sentence.repeat(80);
  assert.ok(maskTechnicalMarkdown(hugeParagraph).masked.length > 3500);

  const res = await translator.translate({ text: hugeParagraph, targetLang: 'zh-CN', engine: 'free' });
  assert.equal(res.ok, true);
  assert.equal(res.tokensIntact, true);
  assert.ok(sentChunks.length >= 2, 'oversized paragraph must be split into multiple chunks');
  for (const chunk of sentChunks) {
    assert.ok(chunk.length <= 3600, `chunk too large: ${chunk.length}`);
  }
  assert.ok(res.text.includes('`validateAiEndpoint()`'));
  assert.ok(res.text.includes('lib/ai-provider.mjs'));
});

// ============================================================================
// 4. lib/intent-predictor.mjs tests
// ============================================================================

test('buildMinimalContextSummary keeps only last 1-2 turns, strips code blocks and tool logs, and enforces maxChars', () => {
  const turns = [
    { user: 'Old turn 1 question', assistant: 'Old turn 1 answer' },
    { user: 'Old turn 2 question', assistant: 'Old turn 2 answer' },
    {
      user: 'Please refactor the translator module.',
      assistant: [
        'Sure, I updated the code:',
        '```js',
        'function secretLongCode() { return 42; }',
        '```',
        '<tool_call>{"name":"run_command","args":"npm test"}</tool_call>',
        '[tool] running tests',
        'Command exited with code 0',
        'All unit tests are green. Ready for the UI wiring step.'
      ].join('\n')
    },
    {
      user: 'Now verify cache permissions.',
      assistant: 'Verified 0600 permissions and 7-day TTL cleanup. Would you like me to wire the IPC endpoint next?'
    }
  ];

  const summary = buildMinimalContextSummary({ turns, maxChars: 1800 });
  assert.equal(summary.includes('Old turn 1'), false);
  assert.equal(summary.includes('Old turn 2'), false);
  assert.equal(summary.includes('secretLongCode'), false);
  assert.equal(summary.includes('<tool_call>'), false);
  assert.equal(summary.includes('[tool] running tests'), false);
  assert.ok(summary.includes('[code block]'));
  assert.ok(summary.includes('Now verify cache permissions.'));
  assert.ok(summary.includes('wire the IPC endpoint next?'));
  assert.ok(summary.length <= 1800);

  const longRoleTurns = [
    { role: 'system', content: 'System prompt should be ignored' },
    { role: 'tool', content: 'Tool output should be ignored' },
    { role: 'user', content: 'Fix the failing test in ai-provider.' },
    { role: 'assistant', content: `${'A'.repeat(2500)} Final conclusion: all tests pass now.` }
  ];
  const compact = buildMinimalContextSummary({ turns: longRoleTurns, maxChars: 220 });
  assert.equal(compact.includes('System prompt'), false);
  assert.equal(compact.includes('Tool output'), false);
  assert.ok(compact.length <= 220);
  assert.ok(compact.includes('Final conclusion: all tests pass now.'));
});

test('parsePredictedIntent cleans formatting/prefixes/quotes, clamps <= 90 chars, and rejects refusal/meta noise', () => {
  assert.equal(parsePredictedIntent('  "Run the full test suite now"  '), 'Run the full test suite now');
  assert.equal(parsePredictedIntent('- Next prompt: "Wire up the settings UI"'), 'Wire up the settings UI');
  assert.equal(parsePredictedIntent('建议：「帮我补全设置面板的交互逻辑」'), '帮我补全设置面板的交互逻辑');
  assert.equal(parsePredictedIntent('Suggested follow-up:\n1. **Add edge-case tests for SSE**'), 'Add edge-case tests for SSE');
  assert.equal(parsePredictedIntent(''), '');
  assert.equal(parsePredictedIntent('   ...  '), '');
  assert.equal(parsePredictedIntent('As an AI, I cannot predict what the user will say.'), '');
  assert.equal(parsePredictedIntent('抱歉，我无法预测用户下一步输入。'), '');
  assert.equal(parsePredictedIntent('N/A'), '');

  const veryLong = 'Please write comprehensive integration tests covering every single provider and edge case across Windows, macOS, and Linux environments right now';
  const clamped = parsePredictedIntent(veryLong);
  assert.ok(clamped.length >= 1 && clamped.length <= 90);
});

test('createIntentPredictor is strictly memory-only, caches by full key, deduplicates in-flight calls, and handles clear()', async () => {
  const src = readFileSync(new URL('../lib/intent-predictor.mjs', import.meta.url), 'utf8');
  assert.equal(/node:fs|\bfs\b/.test(src), false, 'intent-predictor.mjs must not use filesystem persistence');

  const tmpDir = mkdtempSync(join(tmpdir(), 'agy-intent-mem-'));
  try {
    let fetchCalls = 0;
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });

    const fetcher = async (_url, init) => {
      fetchCalls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.max_output_tokens, 70);
      assert.equal(body.temperature, 0.25);
      if (fetchCalls === 1) await firstGate;
      return makeJsonResponse({
        output_text: `"Next action #${fetchCalls}"`
      });
    };

    const predictor = createIntentPredictor({ maxCache: 2 });
    const baseReq = {
      conversationId: 'conv-1',
      turnId: 'turn-1',
      language: 'en',
      turns: [{ user: 'Build backend', assistant: 'Done building backend modules.' }],
      aiConfig: {
        provider: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        apiKey: 'sk-1'
      },
      home: tmpDir,
      fetcher
    };

    const p1 = predictor.predict(baseReq);
    const p2 = predictor.predict(baseReq);
    releaseFirst();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(fetchCalls, 1);
    assert.equal(r1.ok, true);
    assert.equal(r1.suggestion, 'Next action #1');
    assert.equal(r2.ok, true);
    assert.equal(r2.suggestion, 'Next action #1');

    const r3 = await predictor.predict(baseReq);
    assert.equal(r3.ok, true);
    assert.equal(r3.cached, true);
    assert.equal(r3.suggestion, 'Next action #1');
    assert.equal(fetchCalls, 1);

    const r4 = await predictor.predict({ ...baseReq, turnId: 'turn-2' });
    assert.equal(r4.ok, true);
    assert.equal(r4.suggestion, 'Next action #2');
    assert.equal(fetchCalls, 2);

    const skipped = await predictor.predict({ ...baseReq, turnId: 'turn-3', turns: [] });
    assert.deepEqual(skipped, { ok: true, suggestion: '', skipped: true });
    assert.equal(fetchCalls, 2);

    predictor.clear();
    assert.equal(predictor.cacheSize(), 0);
    const r5 = await predictor.predict(baseReq);
    assert.equal(r5.ok, true);
    assert.equal(r5.cached, false);
    assert.equal(fetchCalls, 3);

    assert.deepEqual(readdirSync(tmpDir), []);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createIntentPredictor handles independent abort on shared in-flight request cleanly', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let underlyingAborted = false;

  const predictor = createIntentPredictor();
  const baseReq = {
    conversationId: 'conv-abort',
    turnId: 'turn-1',
    language: 'en',
    turns: [{ user: 'Hello', assistant: 'How can I help next?' }],
    aiConfig: {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-1'
    },
    fetcher: async (_url, init) => {
      init.signal?.addEventListener('abort', () => { underlyingAborted = true; });
      await gate;
      return makeJsonResponse({ choices: [{ message: { content: 'Run tests' } }] });
    }
  };

  const ac1 = new AbortController();
  const ac2 = new AbortController();
  const p1 = predictor.predict({ ...baseReq, signal: ac1.signal });
  const p2 = predictor.predict({ ...baseReq, signal: ac2.signal });

  ac1.abort();
  const res1 = await p1;
  assert.equal(res1.ok, false);
  assert.equal(res1.aborted, true);
  assert.equal(underlyingAborted, false);

  release();
  const res2 = await p2;
  assert.equal(res2.ok, true);
  assert.equal(res2.suggestion, 'Run tests');
});

// ============================================================================
// 5. lib/native-host.mjs Beta AI provider RPC tests
// ============================================================================

test('native-host Beta AI RPCs manage providers, model discovery, tests, translateThinking, predictIntent, and deletion cleanup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-beta-rpc-'));
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const portFile = join(dir, 'DevToolsActivePort');
  writeFileSync(portFile, '12351\n/devtools/browser/test\n');
  const originalFetch = globalThis.fetch;
  const target = {
    id: 'beta-rpc-win',
    type: 'page',
    title: 'Local - Antigravity',
    url: 'https://127.0.0.1:5018/c/conv-beta',
    webSocketDebuggerUrl: 'ws://127.0.0.1:12351/devtools/page/beta-rpc-win'
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => [target] });

  const listCalls = [];
  const testCalls = [];
  const translateCalls = [];
  const predictCalls = [];
  let capturedClient = null;
  let stop;

  try {
    stop = startNativeIntegration({
      portFile,
      dataDir,
      wsl: false,
      onStatus() {},
      parseSessionData: () => ({}),
      discover: async () => ['sampleNativeName'],
      aiProvider: {
        validateAiEndpoint,
        async listModels(args) {
          listCalls.push(args);
          if (args.apiKey === 'sk-fail-leak') {
            return { ok: false, code: 'http-error', error: 'Unauthorized with sk-fail-leak', models: [] };
          }
          return { ok: true, models: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-20250219'] };
        },
        async testConnection(args) {
          testCalls.push(args);
          if (args.apiKey === 'sk-fail-leak') {
            return { ok: false, code: 'http-error', latencyMs: 12, error: 'Bad key sk-fail-leak' };
          }
          return { ok: true, latencyMs: 42, model: args.model || 'gpt-4.1-mini' };
        }
      },
      translator: {
        async translate(args) {
          translateCalls.push(args);
          args.onDelta?.('翻译结果', '翻译结果');
          return { ok: true, text: '翻译结果', engine: args.engine, cached: false };
        },
        purgeCache() {}
      },
      intentPredictor: {
        async predict(args) {
          predictCalls.push(args);
          return { ok: true, suggestion: 'Run the test suite next', cached: false };
        },
        clear() {}
      },
      connect: async () => {
        const listeners = new Set();
        const replies = [];
        const client = {
          listeners,
          replies,
          onEvent(fn) { listeners.add(fn); },
          emit(event) { return Promise.all([...listeners].map(fn => fn(event))); },
          socket: { addEventListener() {}, close() {} },
          async send(method, params = {}) {
            if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main-frame' } } };
            if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script-1' };
            if (method === 'Runtime.evaluate') {
              const expr = String(params.expression || '');
              if (expr.includes('navigator.userAgent')) {
                return { result: { value: { ua: 'Antigravity/2.35.2', sshKind: '', sshHost: '', title: target.title } } };
              }
              if (expr.includes('globalThis.__agyPowertoolsReceive')) {
                const match = expr.match(/globalThis\.__agyPowertoolsReceive\?\.\((\d+),([\s\S]+)\)$/);
                if (match) replies.push({ id: Number(match[1]), payload: JSON.parse(match[2]) });
                return { result: { value: true } };
              }
              return { result: { value: false } };
            }
            return {};
          }
        };
        capturedClient = client;
        return client;
      }
    });

    await stop.ready;
    await capturedClient.emit({
      method: 'Runtime.executionContextCreated',
      params: { context: { id: 11, origin: 'https://127.0.0.1:5018', auxData: { isDefault: true, frameId: 'main-frame' } } }
    });

    let seq = 0;
    const rpc = async body => {
      const id = ++seq;
      await capturedClient.emit({
        method: 'Runtime.bindingCalled',
        params: { name: '__agyPowertoolsHost', executionContextId: 11, payload: JSON.stringify({ id, ...body }) }
      });
      return capturedClient.replies.find(r => r.id === id)?.payload;
    };

    // 1. Initially empty provider list
    assert.deepEqual(await rpc({ method: 'beta.providersList' }), { ok: true, providers: [] });

    // 2. Save two providers (Anthropic & OpenAI Responses) and reject invalid protocol
    const badSave = await rpc({
      method: 'beta.providerSave',
      provider: { name: 'Old Ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434' }
    });
    assert.equal(badSave.ok, false);
    assert.equal(badSave.code, 'invalid-protocol');

    const savedAnt = await rpc({
      method: 'beta.providerSave',
      provider: {
        name: 'Claude Primary',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1/',
        apiKey: 'sk-ant-live',
        models: ['claude-3-5-haiku-latest']
      }
    });
    assert.equal(savedAnt.ok, true);
    assert.equal(savedAnt.provider.protocol, 'anthropic');
    assert.equal(savedAnt.provider.baseUrl, 'https://api.anthropic.com/v1');
    const antId = savedAnt.provider.id;

    const savedResp = await rpc({
      method: 'beta.providerSave',
      provider: {
        name: 'OpenAI Responses',
        protocol: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-resp-live',
        models: ['gpt-4.1-mini']
      }
    });
    assert.equal(savedResp.ok, true);
    const respId = savedResp.provider.id;

    // Flat providerSave fallback must ignore top-level numeric JSON-RPC request.id and support providerId
    const flatCreated = await rpc({
      method: 'beta.providerSave',
      name: 'Flat Local Relay',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: '',
      models: ['local-a']
    });
    assert.equal(flatCreated.ok, true);
    assert.match(flatCreated.provider.id, /^prov_[0-9a-f]{12}$/);
    const flatId = flatCreated.provider.id;

    const flatUpdated = await rpc({
      method: 'beta.providerSave',
      providerId: flatId,
      name: 'Flat Local Relay Updated',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: '',
      models: ['local-b']
    });
    assert.equal(flatUpdated.ok, true);
    assert.equal(flatUpdated.provider.id, flatId);
    assert.equal(flatUpdated.provider.name, 'Flat Local Relay Updated');

    const delFlat = await rpc({ method: 'beta.providerDelete', providerId: flatId });
    assert.equal(delFlat.ok, true);
    assert.equal(delFlat.removed, true);

    const listedProviders = await rpc({ method: 'beta.providersList' });
    assert.equal(listedProviders.ok, true);
    assert.equal(listedProviders.providers.length, 2);

    // 3. beta.aiListModels via saved providerId AND inline draft + key redaction
    const modelsById = await rpc({ method: 'beta.aiListModels', providerId: antId });
    assert.equal(modelsById.ok, true);
    assert.deepEqual(modelsById.models, ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-20250219']);
    assert.equal(listCalls[0].protocol, 'anthropic');
    assert.equal(listCalls[0].apiKey, 'sk-ant-live');

    const modelsDraftFail = await rpc({
      method: 'beta.aiListModels',
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-fail-leak'
    });
    assert.equal(modelsDraftFail.ok, false);
    assert.equal(modelsDraftFail.error.includes('sk-fail-leak'), false);
    assert.ok(modelsDraftFail.error.includes('[REDACTED]'));

    const modelsKeylessRemote = await rpc({
      method: 'beta.aiListModels',
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: ''
    });
    assert.equal(modelsKeylessRemote.ok, false);
    assert.equal(modelsKeylessRemote.code, 'api-key-required');

    // 4. beta.aiTest via saved providerId AND inline draft + key redaction
    const testById = await rpc({ method: 'beta.aiTest', providerId: respId, model: 'gpt-4.1-mini' });
    assert.equal(testById.ok, true);
    assert.equal(testById.latencyMs, 42);
    assert.equal(testById.model, 'gpt-4.1-mini');
    assert.equal(testCalls[0].protocol, 'openai-responses');
    assert.equal(testCalls[0].apiKey, 'sk-resp-live');

    const testDraftFail = await rpc({
      method: 'beta.aiTest',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-fail-leak',
      model: 'claude-3-5-haiku-latest'
    });
    assert.equal(testDraftFail.ok, false);
    assert.equal(testDraftFail.error.includes('sk-fail-leak'), false);
    assert.ok(testDraftFail.error.includes('[REDACTED]'));

    // 5. Configure settings and test beta.translateThinking (AI) + beta.predictIntent
    const settingsStore = createSettingsStore(dataDir);
    settingsStore.set({
      betaThinkingTranslate: true,
      betaThinkingEngine: 'ai',
      betaComposerPredict: true,
      betaAiModel: `${antId}::claude-3-5-haiku-latest`,
      betaAiTranslateModel: `${antId}::claude-3-5-haiku-latest`,
      betaAiPredictModel: `${respId}::gpt-4.1-mini`
    });

    const trRes = await rpc({
      method: 'beta.translateThinking',
      reqId: 'tr-1',
      text: 'Check provider store wiring.',
      targetLang: 'zh-CN'
    });
    assert.equal(trRes.ok, true);
    assert.equal(trRes.text, '翻译结果');
    assert.equal(translateCalls.length, 1);
    assert.deepEqual(translateCalls[0].aiConfig, {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-haiku-latest',
      apiKey: 'sk-ant-live'
    });

    const prRes = await rpc({
      method: 'beta.predictIntent',
      reqId: 'pr-1',
      conversationId: 'conv-beta',
      turnId: 'turn-1',
      language: 'en',
      turns: [{ user: 'Done with backend', assistant: 'Backend is ready.' }]
    });
    assert.equal(prRes.ok, true);
    assert.equal(prRes.suggestion, 'Run the test suite next');
    assert.equal(predictCalls.length, 1);
    assert.deepEqual(predictCalls[0].aiConfig, {
      provider: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: 'sk-resp-live'
    });

    // 6. beta.providerDelete uses providerId (never top-level numeric request.id), removes provider, and clears only matching settings
    const delNoId = await rpc({ method: 'beta.providerDelete' });
    assert.equal(delNoId.ok, true);
    assert.equal(delNoId.removed, false);
    assert.equal(delNoId.providers.length, 2);

    const delRes = await rpc({ method: 'beta.providerDelete', providerId: antId });
    assert.equal(delRes.ok, true);
    assert.equal(delRes.removed, true);
    assert.equal(delRes.providers.length, 1);
    assert.equal(delRes.providers[0].id, respId);
    assert.equal(delRes.settings.betaAiModel, '');
    assert.equal(delRes.settings.betaAiTranslateModel, '');
    assert.equal(delRes.settings.betaAiPredictModel, `${respId}::gpt-4.1-mini`);

    // 7. Legacy secret-vault RPCs are removed
    for (const removedMethod of ['beta.aiSecretStatus', 'beta.aiSaveKey', 'beta.aiClearKey']) {
      const legacyReply = await rpc({ method: removedMethod });
      assert.equal(legacyReply.error, '不支持的操作');
    }
  } finally {
    await stop?.();
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 6. Repository rule: 0 middle dot characters across all owned files
// ============================================================================

test('all backend AI-assist files and tests contain zero forbidden middle dot characters', () => {
  const middleDotRe = /[\u00b7\u2022\u2027\u30fb]/;
  const files = [
    '../lib/ai-provider.mjs',
    '../lib/ai-providers-store.mjs',
    '../lib/settings.mjs',
    '../lib/package.mjs',
    '../lib/native-host.mjs',
    '../lib/translator.mjs',
    '../lib/intent-predictor.mjs',
    './ai-assist.test.mjs',
    './settings.test.mjs'
  ];
  for (const rel of files) {
    const content = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.equal(middleDotRe.test(content), false, `Found middle dot character in ${rel}`);
  }
});
