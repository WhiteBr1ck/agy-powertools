import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import {
  DEFAULT_PROXY_BYPASS,
  checkProxyPortOpen,
  chromiumProxyArgs,
  createProxyFetcher,
  httpsGetThroughProxy,
  httpsRequestThroughProxy,
  inspectProxyRuntime,
  isValidProxyBypass,
  isValidProxyUrl,
  maskProxyUrl,
  normalizeProxyBypass,
  normalizeProxyUrl,
  probeProxyConnectivity,
  proxySpecFromSettings,
  resolveEffectiveProxyConfig,
  shouldBypassProxy
} from '../lib/proxy.mjs';

function listenTcp(onConnection) {
  return new Promise((resolve, reject) => {
    const sockets = new Set();
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      onConnection(socket);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise(done => {
          server.close(() => done());
          for (const socket of sockets) socket.destroy();
        })
      });
    });
  });
}

test('normalizeProxyUrl, normalizeProxyBypass, and chromiumProxyArgs sanitize safely and reject injections', () => {
  assert.equal(normalizeProxyUrl('http://127.0.0.1:7897/'), 'http://127.0.0.1:7897');
  assert.equal(normalizeProxyUrl('socks5h://127.0.0.1:1080'), 'socks5h://127.0.0.1:1080');
  assert.equal(normalizeProxyUrl('http://user:pass@127.0.0.1:7890'), 'http://user:pass@127.0.0.1:7890');
  assert.equal(maskProxyUrl('http://user:secret@127.0.0.1:7890'), 'http://***@127.0.0.1:7890');
  assert.equal(maskProxyUrl('http://127.0.0.1:7897'), 'http://127.0.0.1:7897');
  assert.equal(isValidProxyUrl(''), true);

  for (const bad of [
    'ftp://127.0.0.1:21',
    'http://127.0.0.1:7897/path',
    'http://127.0.0.1:7897?a=1',
    'http://127.0.0.1:7897;calc',
    'http://127.0.0.1:7897" --foo',
    'http://127.0.0.1:99999',
    'not a url'
  ]) {
    assert.equal(isValidProxyUrl(bad), false, `expected invalid: ${bad}`);
  }

  assert.equal(normalizeProxyBypass('192.168.0.0/16; .internal.local, localhost'), 'localhost,127.0.0.1,::1,192.168.0.0/16,.internal.local');
  assert.equal(isValidProxyBypass('localhost,127.0.0.1,::1'), true);
  assert.equal(isValidProxyBypass('localhost"$(whoami)'), false);
  // Combined bypass string after prepending loopback entries must stay <= 480 chars (Issue #93)
  const overLimitBypass = Array.from({ length: 17 }, (_, i) => `internal-host-${String(i).padStart(2, '0')}.corp.local`).join(',');
  assert.ok(overLimitBypass.length <= 512 && `${DEFAULT_PROXY_BYPASS},${overLimitBypass}`.length > 480);
  assert.equal(normalizeProxyBypass(overLimitBypass), null);
  assert.equal(isValidProxyBypass(overLimitBypass), false);
  const okBypass = Array.from({ length: 15 }, (_, i) => `svc-${String(i).padStart(2, '0')}.corp.local`).join(',');
  assert.ok(normalizeProxyBypass(okBypass).length <= 480);

  const spec = proxySpecFromSettings({
    proxyEnabled: true,
    proxyUrl: 'socks5h://127.0.0.1:7897/',
    proxyBypass: '10.0.0.0/8',
    proxyForceHttp1: true
  });
  assert.equal(spec.enabled, true);
  assert.equal(spec.bypass, `${DEFAULT_PROXY_BYPASS},10.0.0.0/8`);
  assert.deepEqual(chromiumProxyArgs(spec), [
    '--proxy-server=socks5://127.0.0.1:7897',
    '--proxy-bypass-list=localhost;127.0.0.1;[::1];10.0.0.0/8'
  ]);
});

test('inspectProxyRuntime classifies disabled, not-applied, active, config-changed, and needs-disable states', () => {
  const off = inspectProxyRuntime({ proxyEnabled: false, proxyUrl: '' }, {});
  assert.equal(off.reason, 'disabled');
  assert.equal(off.mismatch, false);

  // External OS proxy while plugin proxy is disabled must not trigger needs-disable prompt
  const osProxy = inspectProxyRuntime({ proxyEnabled: false, proxyUrl: '' }, { HTTPS_PROXY: 'http://127.0.0.1:7890' });
  assert.equal(osProxy.reason, 'disabled');
  assert.equal(osProxy.mismatch, false);

  // Cold start without proxy env while plugin proxy is enabled
  const cold = inspectProxyRuntime({ proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: false }, {});
  assert.equal(cold.reason, 'not-applied');
  assert.equal(cold.mismatch, true);
  assert.equal(cold.managedByPowertools, false);

  // External HTTP_PROXY matching proxyUrl WITHOUT AGY_POWERTOOLS_PROXY_SPEC is still 'not-applied' because Chromium missed --proxy-server (Issue #93)
  const externalSame = inspectProxyRuntime(
    { proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: false },
    { HTTP_PROXY: 'http://127.0.0.1:7897' }
  );
  assert.equal(externalSame.reason, 'not-applied');
  assert.equal(externalSame.mismatch, true);
  assert.equal(externalSame.managedByPowertools, false);

  // External OS proxy conflicting with configured Powertools proxy reports 'config-changed' with managedByPowertools: false (Issue #93)
  const externalConflict = inspectProxyRuntime(
    { proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: false },
    { HTTPS_PROXY: 'http://127.0.0.1:7890' }
  );
  assert.equal(externalConflict.reason, 'config-changed');
  assert.equal(externalConflict.mismatch, true);
  assert.equal(externalConflict.managedByPowertools, false);

  // Active managed session matches exactly
  const spec = proxySpecFromSettings({ proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: true });
  const active = inspectProxyRuntime(
    { proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: true },
    { HTTPS_PROXY: 'http://127.0.0.1:7897', GODEBUG: 'http2client=0', AGY_POWERTOOLS_PROXY_SPEC: spec.specKey }
  );
  assert.equal(active.reason, 'active');
  assert.equal(active.mismatch, false);
  assert.equal(active.managedByPowertools, true);

  // User changes proxy port or HTTP/1.1 toggle
  const changed = inspectProxyRuntime(
    { proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7898', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: true },
    { HTTPS_PROXY: 'http://127.0.0.1:7897', GODEBUG: 'http2client=0', AGY_POWERTOOLS_PROXY_SPEC: spec.specKey }
  );
  assert.equal(changed.reason, 'config-changed');
  assert.equal(changed.mismatch, true);

  // User turns proxy off while current window is still running Powertools proxy
  const needsDisable = inspectProxyRuntime(
    { proxyEnabled: false, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: false },
    { HTTPS_PROXY: 'http://127.0.0.1:7897', AGY_POWERTOOLS_PROXY_SPEC: spec.specKey }
  );
  assert.equal(needsDisable.reason, 'needs-disable');
  assert.equal(needsDisable.mismatch, true);
});

test('probeProxyConnectivity verifies HTTP CONNECT, HTTP 407, SOCKS5 handshake, and closed ports', async () => {
  // 1. Mock HTTP CONNECT proxy returning 200
  const seenRequests = [];
  const httpProxy = await listenTcp(socket => {
    socket.once('data', chunk => {
      const req = chunk.toString('utf8');
      seenRequests.push(req);
      if (req.includes('Basic dXNlcjpwYXNz')) {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      } else if (req.includes('407.test')) {
        socket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      } else {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      }
    });
  });

  // 2. Mock SOCKS5 proxy returning success
  const socksProxy = await listenTcp(socket => {
    let step = 0;
    socket.on('data', chunk => {
      if (step === 0 && chunk[0] === 0x05) {
        step = 1;
        socket.write(Buffer.from([0x05, 0x00]));
      } else if (step === 1 && chunk[0] === 0x05 && chunk[1] === 0x01) {
        step = 2;
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));
      }
    });
  });

  // 3. Allocate a closed loopback port
  const temp = await listenTcp(() => {});
  const closedPort = temp.port;
  await temp.close();

  try {
    const okHttp = await probeProxyConnectivity(`http://user:pass@127.0.0.1:${httpProxy.port}`, { targetHost: 'example.com', targetPort: 443 });
    assert.equal(okHttp.ok, true);
    assert.equal(okHttp.tunnelOk, true);
    assert.equal(okHttp.url, `http://***@127.0.0.1:${httpProxy.port}`);
    assert.ok(seenRequests[0].includes('CONNECT example.com:443 HTTP/1.1'));
    assert.ok(seenRequests[0].includes('Proxy-Authorization: Basic dXNlcjpwYXNz'));

    const authFail = await probeProxyConnectivity(`http://127.0.0.1:${httpProxy.port}`, { targetHost: '407.test', targetPort: 443 });
    assert.equal(authFail.ok, false);
    assert.equal(authFail.reachable, true);
    assert.ok(authFail.error.includes('407'));

    const okSocks = await probeProxyConnectivity(`socks5://127.0.0.1:${socksProxy.port}`, { targetHost: 'example.com', targetPort: 443 });
    assert.equal(okSocks.ok, true);
    assert.equal(okSocks.tunnelOk, true);

    const closed = await checkProxyPortOpen(`http://127.0.0.1:${closedPort}`, 500);
    assert.equal(closed.ok, false);
    assert.equal(closed.reachable, false);
  } finally {
    await httpProxy.close();
    await socksProxy.close();
  }
});

function createSelfSignedCert(hostnames) {
  const names = Array.isArray(hostnames) ? hostnames : [hostnames];
  const primary = names[0];
  const derLen = len => {
    if (len < 0x80) return Buffer.from([len]);
    const bytes = [];
    for (let n = len; n > 0; n >>= 8) bytes.unshift(n & 0xff);
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  };
  const derTag = (tag, body) => Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
  const derSeq = (...items) => derTag(0x30, Buffer.concat(items));
  const derSet = (...items) => derTag(0x31, Buffer.concat(items));
  const derInt = num => {
    const bytes = [];
    let n = BigInt(num);
    do { bytes.unshift(Number(n & 0xffn)); n >>= 8n; } while (n > 0n);
    if (bytes[0] & 0x80) bytes.unshift(0x00);
    return derTag(0x02, Buffer.from(bytes));
  };
  const derOid = oid => {
    const parts = oid.split('.').map(Number);
    const out = [parts[0] * 40 + parts[1]];
    for (let i = 2; i < parts.length; i++) {
      let v = parts[i];
      const enc = [v & 0x7f];
      while ((v >>= 7) > 0) enc.unshift(0x80 | (v & 0x7f));
      out.push(...enc);
    }
    return derTag(0x06, Buffer.from(out));
  };
  const derBitString = buf => derTag(0x03, Buffer.concat([Buffer.from([0x00]), buf]));
  const derUtcTime = date => {
    const pad = n => String(n).padStart(2, '0');
    const s = `${String(date.getUTCFullYear()).slice(-2)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
    return derTag(0x17, Buffer.from(s, 'ascii'));
  };

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const sigAlg = derSeq(derOid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256
  const name = derSeq(derSet(derSeq(derOid('2.5.4.3'), derTag(0x0c, Buffer.from(primary, 'utf8')))));
  const now = Date.now();
  const validity = derSeq(derUtcTime(new Date(now - 86_400_000)), derUtcTime(new Date(now + 86_400_000)));
  const sanExt = derSeq(
    derOid('2.5.29.17'),
    derTag(0x04, derSeq(...names.map(h => derTag(0x82, Buffer.from(h, 'ascii')))))
  );
  const extensions = derTag(0xa3, derSeq(sanExt));
  const tbs = derSeq(
    derTag(0xa0, derInt(2)), // v3
    derInt(1),
    sigAlg,
    name,
    validity,
    name,
    spki,
    extensions
  );
  const sig = crypto.sign('sha256', tbs, privateKey);
  const certDer = derSeq(tbs, sigAlg, derBitString(sig));
  const b64 = certDer.toString('base64').match(/.{1,64}/g).join('\n');
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`
  };
}

function listenHttps(options, handler) {
  return new Promise((resolve, reject) => {
    const server = https.createServer(options, handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise(done => {
          server.close(() => done());
          server.closeAllConnections?.();
        })
      });
    });
  });
}

test('createProxyFetcher tunnels HTTPS requests through HTTP CONNECT and SOCKS5 proxies without bypassing via direct connection', async () => {
  const targetHost = 'proxy-only.test';
  const { key, cert } = createSelfSignedCert(targetHost);
  const seenHttpsRequests = [];
  let slowBodyClosedResolve;
  const slowBodyClosed = new Promise(resolve => { slowBodyClosedResolve = resolve; });
  const slowTimers = new Set();

  const httpsServer = await listenHttps({ key, cert }, (req, res) => {
    seenHttpsRequests.push({ path: req.url, host: req.headers.host, accept: req.headers.accept });
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: `https://${targetHost}/releases/latest` });
      res.end();
      return;
    }
    if (req.url === '/redirect-http') {
      res.writeHead(302, { Location: `http://${targetHost}/insecure` });
      res.end();
      return;
    }
    if (req.url === '/slow-body') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.write('chunk-1\n');
      const timer = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) res.write('trickle\n');
      }, 2000);
      slowTimers.add(timer);
      const onClose = () => {
        clearInterval(timer);
        slowTimers.delete(timer);
        slowBodyClosedResolve?.();
      };
      res.once('close', onClose);
      req.once('close', onClose);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tag_name: 'v2.16.9' }));
  });

  const connectTargets = [];
  const httpProxy = await listenTcp(clientSocket => {
    let buf = Buffer.alloc(0);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      const endIdx = buf.indexOf('\r\n\r\n');
      if (endIdx === -1) return;
      clientSocket.off('data', onData);
      const firstLine = buf.subarray(0, buf.indexOf('\r\n')).toString('latin1');
      const match = firstLine.match(/^CONNECT\s+([^\s]+)\s+HTTP/i);
      if (!match) {
        clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      connectTargets.push(match[1]);
      const leftover = buf.subarray(endIdx + 4);
      const upstream = net.connect(httpsServer.port, '127.0.0.1', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (leftover.length) upstream.write(leftover);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
      upstream.on('close', () => clientSocket.destroy());
      clientSocket.on('close', () => upstream.destroy());
    };
    clientSocket.on('data', onData);
  });

  const socksTargets = [];
  const socksProxy = await listenTcp(clientSocket => {
    let stage = 0;
    let buf = Buffer.alloc(0);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0 && buf.length >= 2) {
        const nmethods = buf[1];
        if (buf.length < 2 + nmethods) return;
        buf = buf.subarray(2 + nmethods);
        stage = 1;
        clientSocket.write(Buffer.from([0x05, 0x00]));
      }
      if (stage === 1 && buf.length >= 5) {
        const atyp = buf[3];
        if (atyp !== 0x03) { clientSocket.destroy(); return; }
        const hostLen = buf[4];
        const needed = 5 + hostLen + 2;
        if (buf.length < needed) return;
        const host = buf.subarray(5, 5 + hostLen).toString('ascii');
        const port = buf.readUInt16BE(5 + hostLen);
        const leftover = buf.subarray(needed);
        socksTargets.push(`${host}:${port}`);
        clientSocket.off('data', onData);
        const upstream = net.connect(httpsServer.port, '127.0.0.1', () => {
          clientSocket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
          if (leftover.length) upstream.write(leftover);
          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);
        });
        upstream.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstream.destroy());
      }
    };
    clientSocket.on('data', onData);
  });

  try {
    let fallbackCalls = 0;
    const forbiddenFallback = async () => {
      fallbackCalls++;
      throw new Error('direct fallback must not be invoked when proxy tunnel works');
    };

    // 1. HTTP CONNECT proxy request
    const httpFetcher = createProxyFetcher({
      home: '/nonexistent-home-for-proxy-test',
      env: { HTTPS_PROXY: `http://127.0.0.1:${httpProxy.port}` },
      fallback: forbiddenFallback,
      tlsOptions: { ca: cert }
    });
    const res1 = await httpFetcher(`https://${targetHost}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      redirect: 'error',
      timeoutMs: 5000
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.status, 200);
    assert.deepEqual(JSON.parse(await res1.text()), { tag_name: 'v2.16.9' });
    assert.equal(fallbackCalls, 0);
    assert.deepEqual(connectTargets, [`${targetHost}:443`]);
    assert.equal(seenHttpsRequests[0].accept, 'application/vnd.github+json');

    // 2. Follow 302 redirect through HTTP CONNECT proxy
    const res2 = await httpFetcher(`https://${targetHost}/redirect`, {
      redirect: 'follow',
      timeoutMs: 5000
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.url, `https://${targetHost}/releases/latest`);
    assert.deepEqual(JSON.parse(await res2.text()), { tag_name: 'v2.16.9' });
    assert.equal(fallbackCalls, 0);

    // 3. Disallowed redirect fails cleanly without invoking direct fallback
    await assert.rejects(
      () => httpFetcher(`https://${targetHost}/redirect`, { redirect: 'error', timeoutMs: 5000 }),
      /不允许重定向/
    );
    assert.equal(fallbackCalls, 0);

    // 4. Redirect to non-HTTPS URL fails cleanly without invoking direct fallback
    await assert.rejects(
      () => httpFetcher(`https://${targetHost}/redirect-http`, { redirect: 'follow', timeoutMs: 5000 }),
      /仅支持 HTTPS 地址/
    );
    assert.equal(fallbackCalls, 0);

    // 5. Pre-aborted AbortSignal rejects immediately without hanging or falling back
    const ac = new AbortController();
    ac.abort(new Error('already aborted'));
    await assert.rejects(
      () => httpFetcher(`https://${targetHost}/releases/latest`, { signal: ac.signal, timeoutMs: 5000 }),
      /already aborted/
    );
    assert.equal(fallbackCalls, 0);

    // 6. Mid-body AbortSignal interrupts streaming response promptly and destroys tlsSocket cleanly
    const midAc = new AbortController();
    const slowRes = await httpFetcher(`https://${targetHost}/slow-body`, {
      signal: midAc.signal,
      timeoutMs: 10000
    });
    assert.equal(slowRes.status, 200);
    const receivedChunks = [];
    let abortedAt = 0;
    await assert.rejects(async () => {
      for await (const chunk of slowRes.body) {
        receivedChunks.push(Buffer.from(chunk).toString('utf8'));
        if (receivedChunks.length === 1) {
          abortedAt = Date.now();
          midAc.abort(new Error('mid-body cancel'));
        }
      }
    }, /mid-body cancel/);
    assert.deepEqual(receivedChunks, ['chunk-1\n']);
    assert.ok(abortedAt > 0 && Date.now() - abortedAt < 1500, 'mid-body abort must interrupt stream promptly');
    assert.equal(slowRes.body.destroyed, true);
    assert.equal(slowRes.body.socket?.destroyed ?? true, true);
    await Promise.race([
      slowBodyClosed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('upstream slow-body socket did not close after abort')), 1500))
    ]);
    assert.equal(fallbackCalls, 0);

    // 7. SOCKS5 proxy request
    const socksFetcher = createProxyFetcher({
      home: '/nonexistent-home-for-proxy-test',
      env: { HTTPS_PROXY: `socks5://127.0.0.1:${socksProxy.port}` },
      fallback: forbiddenFallback,
      tlsOptions: { ca: cert }
    });
    const res3 = await socksFetcher(`https://${targetHost}/releases/latest`, {
      redirect: 'error',
      timeoutMs: 5000
    });
    assert.equal(res3.status, 200);
    assert.deepEqual(JSON.parse(await res3.text()), { tag_name: 'v2.16.9' });
    assert.equal(fallbackCalls, 0);
    assert.deepEqual(socksTargets, [`${targetHost}:443`]);
  } finally {
    for (const timer of slowTimers) clearInterval(timer);
    await httpProxy.close();
    await socksProxy.close();
    await httpsServer.close();
  }
});

test('shouldBypassProxy matches loopback, CIDR ranges, domain suffixes/wildcards, exact hosts, and handles empty inputs', () => {
  // Loopback is always bypassed even when bypassCsv is empty or omitted
  for (const loopbackUrl of [
    'http://localhost:11434/api/chat',
    'https://localhost/v1/models',
    'http://127.0.0.1:11434/api/generate',
    'http://[::1]:11434/api/tags',
    'http://ollama.localhost:8080/v1'
  ]) {
    assert.equal(shouldBypassProxy(loopbackUrl, ''), true, `loopback must bypass: ${loopbackUrl}`);
    assert.equal(shouldBypassProxy(loopbackUrl, undefined), true, `loopback must bypass with default: ${loopbackUrl}`);
    assert.equal(shouldBypassProxy(loopbackUrl, null), true, `loopback must bypass with null: ${loopbackUrl}`);
  }

  // Empty bypass does not bypass public hosts
  assert.equal(shouldBypassProxy('https://api.openai.com/v1/chat/completions', ''), false);
  assert.equal(shouldBypassProxy('https://api.openai.com/v1/chat/completions', null), false);
  assert.equal(shouldBypassProxy('not-a-valid-url', '*'), false);

  // Wildcard and leading-dot domain suffixes
  const domainRules = '*.internal, .corp.local; exact.lan, port-only.lan:11434';
  assert.equal(shouldBypassProxy('https://api.internal/v1', domainRules), true);
  assert.equal(shouldBypassProxy('https://a.b.internal/v1', domainRules), true);
  assert.equal(shouldBypassProxy('https://internal/v1', domainRules), false);
  assert.equal(shouldBypassProxy('https://notinternal/v1', domainRules), false);

  assert.equal(shouldBypassProxy('https://svc.corp.local/v1', domainRules), true);
  assert.equal(shouldBypassProxy('https://deep.svc.corp.local/v1', domainRules), true);
  assert.equal(shouldBypassProxy('https://corp.local/v1', domainRules), true);
  assert.equal(shouldBypassProxy('https://evilcorp.local/v1', domainRules), false);

  // Exact host and port-scoped host
  assert.equal(shouldBypassProxy('https://exact.lan/v1', domainRules), true);
  assert.equal(shouldBypassProxy('https://sub.exact.lan/v1', domainRules), false);
  assert.equal(shouldBypassProxy('https://port-only.lan:11434/v1', domainRules), true);
  assert.equal(shouldBypassProxy('https://port-only.lan:8443/v1', domainRules), false);

  // IPv4 CIDR ranges
  const cidrRules = '10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12';
  assert.equal(shouldBypassProxy('https://10.0.0.1/v1', cidrRules), true);
  assert.equal(shouldBypassProxy('https://10.255.255.254/v1', cidrRules), true);
  assert.equal(shouldBypassProxy('https://11.0.0.1/v1', cidrRules), false);

  assert.equal(shouldBypassProxy('https://192.168.1.42:8443/v1', cidrRules), true);
  assert.equal(shouldBypassProxy('https://192.169.1.42/v1', cidrRules), false);

  assert.equal(shouldBypassProxy('https://172.16.0.1/v1', cidrRules), true);
  assert.equal(shouldBypassProxy('https://172.31.255.254/v1', cidrRules), true);
  assert.equal(shouldBypassProxy('https://172.15.255.255/v1', cidrRules), false);
  assert.equal(shouldBypassProxy('https://172.32.0.1/v1', cidrRules), false);

  // Malformed CIDR must fail closed (never act as /0)
  assert.equal(shouldBypassProxy('https://8.8.8.8/', '10.0.0.0/, 10.0.0.0/33, 10..0.1/8'), false);
  assert.equal(shouldBypassProxy('https://any.example.com/', '*'), true);
});

test('httpsRequestThroughProxy supports POST JSON, Fetch headers/arrayBuffer, SSE streaming, AbortSignal, cross-origin header stripping, and strictProxy', async () => {
  const hostA = 'origin-a.test';
  const hostB = 'origin-b.test';
  const { key, cert } = createSelfSignedCert([hostA, hostB]);
  const received = [];
  const sseTimers = new Set();

  const httpsServer = await listenHttps({ key, cert }, (req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      received.push({
        method: req.method,
        host: req.headers.host,
        url: req.url,
        headers: { ...req.headers },
        body: rawBody
      });

      if (req.url === '/api/chat' && req.method === 'POST') {
        const parsed = JSON.parse(rawBody);
        res.writeHead(200, 'OK', {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Request-Id': 'req-42'
        });
        res.end(JSON.stringify({
          echo: parsed.prompt,
          contentLength: req.headers['content-length'],
          auth: req.headers.authorization || ''
        }));
        return;
      }

      if (req.url === '/api/binary' && req.method === 'PUT') {
        res.writeHead(200, 'OK', { 'Content-Type': 'application/octet-stream' });
        res.end(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
        return;
      }

      if (req.url === '/api/sse') {
        res.writeHead(200, 'OK', {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache'
        });
        res.write('data: {"delta":"你"}\n\n');
        const t1 = setTimeout(() => {
          if (!res.destroyed && !res.writableEnded) res.write('data: {"delta":"好"}\n\n');
        }, 25);
        const t2 = setTimeout(() => {
          if (!res.destroyed && !res.writableEnded) {
            res.write('data: [DONE]\n\n');
            res.end();
          }
        }, 55);
        sseTimers.add(t1);
        sseTimers.add(t2);
        return;
      }

      if (req.url === '/api/sse-abort') {
        res.writeHead(200, 'OK', { 'Content-Type': 'text/event-stream' });
        res.write('data: first\n\n');
        const iv = setInterval(() => {
          if (!res.destroyed && !res.writableEnded) res.write('data: keepalive\n\n');
        }, 500);
        sseTimers.add(iv);
        res.once('close', () => clearInterval(iv));
        return;
      }

      if (req.url === '/redirect-cross-origin') {
        res.writeHead(302, { Location: `https://${hostB}/landing` });
        res.end();
        return;
      }

      if (req.url === '/redirect-same-origin') {
        res.writeHead(302, { Location: `https://${hostA}/landing` });
        res.end();
        return;
      }

      if (req.url === '/landing') {
        res.writeHead(200, 'OK', { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          method: req.method,
          host: req.headers.host,
          authorization: req.headers.authorization || null,
          xGoogApiKey: req.headers['x-goog-api-key'] || null,
          ocpKey: req.headers['ocp-apim-subscription-key'] || null,
          cookie: req.headers.cookie || null,
          traceId: req.headers['x-trace-id'] || null,
          body: rawBody
        }));
        return;
      }

      res.writeHead(200, 'OK', { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, method: req.method }));
    });
  });

  const connectTargets = [];
  const httpProxy = await listenTcp(clientSocket => {
    let buf = Buffer.alloc(0);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      const endIdx = buf.indexOf('\r\n\r\n');
      if (endIdx === -1) return;
      clientSocket.off('data', onData);
      const firstLine = buf.subarray(0, buf.indexOf('\r\n')).toString('latin1');
      const match = firstLine.match(/^CONNECT\s+([^\s]+)\s+HTTP/i);
      if (!match) {
        clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      connectTargets.push(match[1]);
      const leftover = buf.subarray(endIdx + 4);
      const upstream = net.connect(httpsServer.port, '127.0.0.1', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (leftover.length) upstream.write(leftover);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
      upstream.on('close', () => clientSocket.destroy());
      clientSocket.on('close', () => upstream.destroy());
    };
    clientSocket.on('data', onData);
  });

  // Closed proxy port to test strictProxy fail-closed vs legacy fallback
  const deadProxy = await listenTcp(() => {});
  const deadPort = deadProxy.port;
  await deadProxy.close();

  const proxyUrl = `http://127.0.0.1:${httpProxy.port}`;

  try {
    // 1. POST JSON body with UTF-8 multi-byte characters, .json(), .headers.get(), plain header access, statusText
    const payload = JSON.stringify({ prompt: '翻译这段中文文本' });
    const postRes = await httpsRequestThroughProxy(`https://${hostA}/api/chat`, proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-proxy-test'
      },
      body: payload,
      tlsOptions: { ca: cert },
      timeoutMs: 5000
    });
    assert.equal(postRes.ok, true);
    assert.equal(postRes.status, 200);
    assert.equal(postRes.statusText, 'OK');
    assert.equal(postRes.headers.get('X-Request-Id'), 'req-42');
    assert.equal(postRes.headers.get('x-request-id'), 'req-42');
    assert.equal(postRes.headers.get('x-missing'), null);
    assert.equal(postRes.headers['x-request-id'], 'req-42');
    assert.equal(postRes.headers.has('Content-Type'), true);
    const postJson = await postRes.json();
    assert.equal(postJson.echo, '翻译这段中文文本');
    assert.equal(postJson.contentLength, String(Buffer.byteLength(payload, 'utf8')));
    assert.equal(postJson.auth, 'Bearer sk-proxy-test');

    // 2. PUT Uint8Array body + .arrayBuffer() + httpsGetThroughProxy alias
    const putRes = await httpsRequestThroughProxy(`https://${hostA}/api/binary`, proxyUrl, {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3, 4]),
      tlsOptions: { ca: cert },
      timeoutMs: 5000
    });
    const ab = await putRes.arrayBuffer();
    assert.deepEqual(Array.from(new Uint8Array(ab)), [0xde, 0xad, 0xbe, 0xef]);

    const aliasRes = await httpsGetThroughProxy(`https://${hostA}/ping`, proxyUrl, {
      tlsOptions: { ca: cert },
      timeoutMs: 5000
    });
    assert.deepEqual(await aliasRes.json(), { ok: true, method: 'GET' });

    // 3. SSE streaming over HTTP CONNECT proxy using Web ReadableStream getReader()
    const sseRes1 = await httpsRequestThroughProxy(`https://${hostA}/api/sse`, proxyUrl, {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: JSON.stringify({ stream: true }),
      tlsOptions: { ca: cert },
      timeoutMs: 5000
    });
    assert.equal(sseRes1.ok, true);
    assert.equal(typeof sseRes1.body.getReader, 'function');
    const reader = sseRes1.body.getReader();
    const decoder = new TextDecoder();
    const sseChunks1 = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseChunks1.push(decoder.decode(value, { stream: true }));
    }
    assert.ok(sseChunks1.length >= 2, 'SSE chunks should arrive incrementally via getReader()');
    assert.equal(sseChunks1.join(''), 'data: {"delta":"你"}\n\ndata: {"delta":"好"}\n\ndata: [DONE]\n\n');

    // 4. SSE streaming using for-await async iteration
    const sseRes2 = await httpsRequestThroughProxy(`https://${hostA}/api/sse`, proxyUrl, {
      tlsOptions: { ca: cert },
      timeoutMs: 5000
    });
    let sseCombined = '';
    for await (const chunk of sseRes2.body) {
      sseCombined += Buffer.from(chunk).toString('utf8');
    }
    assert.equal(sseCombined, 'data: {"delta":"你"}\n\ndata: {"delta":"好"}\n\ndata: [DONE]\n\n');

    // 5. AbortSignal interrupts getReader() SSE stream promptly
    const sseAc = new AbortController();
    const abortSseRes = await httpsRequestThroughProxy(`https://${hostA}/api/sse-abort`, proxyUrl, {
      signal: sseAc.signal,
      tlsOptions: { ca: cert },
      timeoutMs: 5000
    });
    const abortReader = abortSseRes.body.getReader();
    const firstRead = await abortReader.read();
    assert.equal(Buffer.from(firstRead.value).toString('utf8'), 'data: first\n\n');
    sseAc.abort(new Error('sse aborted by user'));
    await assert.rejects(() => abortReader.read(), /sse aborted by user/);
    assert.equal(abortSseRes.body.destroyed, true);

    // 6. Cross-origin redirect strips Authorization, X-Goog-API-Key, Ocp-Apim-Subscription-Key, Cookie; downgrades POST->GET
    const crossRes = await httpsRequestThroughProxy(`https://${hostA}/redirect-cross-origin`, proxyUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer top-secret',
        'X-Goog-API-Key': 'goog-secret',
        'Ocp-Apim-Subscription-Key': 'azure-secret',
        Cookie: 'session=abc',
        'X-Trace-Id': 'trace-123'
      },
      body: '{"secret":true}',
      redirect: 'follow',
      tlsOptions: { ca: cert },
      timeoutMs: 5000
    });
    assert.equal(crossRes.url, `https://${hostB}/landing`);
    const crossData = await crossRes.json();
    assert.equal(crossData.method, 'GET');
    assert.equal(crossData.authorization, null);
    assert.equal(crossData.xGoogApiKey, null);
    assert.equal(crossData.ocpKey, null);
    assert.equal(crossData.cookie, null);
    assert.equal(crossData.traceId, 'trace-123');
    assert.equal(crossData.body, '');

    // 7. Same-origin redirect preserves Authorization
    const sameRes = await httpsRequestThroughProxy(`https://${hostA}/redirect-same-origin`, proxyUrl, {
      headers: {
        Authorization: 'Bearer same-origin-token',
        'X-Trace-Id': 'trace-456'
      },
      redirect: 'follow',
      tlsOptions: { ca: cert },
      timeoutMs: 5000
    });
    const sameData = await sameRes.json();
    assert.equal(sameData.authorization, 'Bearer same-origin-token');
    assert.equal(sameData.traceId, 'trace-456');

    // 8. createProxyFetcher respects shouldBypassProxy (localhost / *.internal skip proxy -> direct fallback)
    const directCalls = [];
    const mockFallback = async (url, opts) => {
      directCalls.push({ url, method: opts?.method || 'GET' });
      return { ok: true, status: 200, async json() { return { direct: true }; } };
    };
    const bypassEnv = {
      HTTPS_PROXY: proxyUrl,
      NO_PROXY: 'localhost,127.0.0.1,::1,*.internal,10.0.0.0/8'
    };
    const cfg = resolveEffectiveProxyConfig({ home: '/nonexistent-home', env: bypassEnv });
    assert.equal(cfg.proxyUrl, proxyUrl);
    const fetcherWithBypass = createProxyFetcher({
      home: '/nonexistent-home',
      env: bypassEnv,
      fallback: mockFallback,
      tlsOptions: { ca: cert },
      strictProxy: true
    });
    const prevConnectCount = connectTargets.length;
    await fetcherWithBypass('http://127.0.0.1:11434/api/chat', { method: 'POST', body: '{}' });
    await fetcherWithBypass('https://localhost:8443/api/chat', { method: 'POST', body: '{}' });
    await fetcherWithBypass('https://ollama.internal/v1/models');
    await fetcherWithBypass('https://10.1.2.3/v1/models');
    assert.equal(connectTargets.length, prevConnectCount, 'bypassed URLs must never hit proxy');
    assert.equal(directCalls.length, 4);

    // 9. strictProxy: true fails closed when configured proxy fails (never leaks to direct fallback!)
    let strictFallbackHits = 0;
    const strictFetcher = createProxyFetcher({
      home: '/nonexistent-home',
      env: { HTTPS_PROXY: `http://127.0.0.1:${deadPort}` },
      fallback: async () => {
        strictFallbackHits++;
        return { ok: true, status: 200, async text() { return 'leaked'; } };
      },
      strictProxy: true
    });
    await assert.rejects(
      () => strictFetcher(`https://${hostA}/api/chat`, { method: 'POST', body: '{}', timeoutMs: 1500 }),
      /ECONNREFUSED|connect|代理|timeout/i
    );
    assert.equal(strictFallbackHits, 0, 'strictProxy: true must NEVER fall back to direct fetch');

    // 10. Default strictProxy: false still falls back to direct fetch when proxy is unreachable
    let legacyFallbackHits = 0;
    const legacyFetcher = createProxyFetcher({
      home: '/nonexistent-home',
      env: { HTTPS_PROXY: `http://127.0.0.1:${deadPort}` },
      fallback: async () => {
        legacyFallbackHits++;
        return { ok: true, status: 200, async text() { return 'fallback-ok'; } };
      }
    });
    const fallbackRes = await legacyFetcher(`https://${hostA}/api/chat`, { timeoutMs: 1500 });
    assert.equal(legacyFallbackHits, 1);
    assert.equal(await fallbackRes.text(), 'fallback-ok');
  } finally {
    for (const timer of sseTimers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    await httpProxy.close();
    await httpsServer.close();
  }
});
