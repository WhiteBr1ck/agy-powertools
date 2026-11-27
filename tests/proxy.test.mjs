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
  inspectProxyRuntime,
  isValidProxyBypass,
  isValidProxyUrl,
  maskProxyUrl,
  normalizeProxyBypass,
  normalizeProxyUrl,
  probeProxyConnectivity,
  proxySpecFromSettings
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

  // Active managed session matches exactly
  const spec = proxySpecFromSettings({ proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: true });
  const active = inspectProxyRuntime(
    { proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: true },
    { HTTPS_PROXY: 'http://127.0.0.1:7897', GODEBUG: 'http2client=0', AGY_POWERTOOLS_PROXY_SPEC: spec.specKey }
  );
  assert.equal(active.reason, 'active');
  assert.equal(active.mismatch, false);

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

function createSelfSignedCert(hostname) {
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
  const name = derSeq(derSet(derSeq(derOid('2.5.4.3'), derTag(0x0c, Buffer.from(hostname, 'utf8')))));
  const now = Date.now();
  const validity = derSeq(derUtcTime(new Date(now - 86_400_000)), derUtcTime(new Date(now + 86_400_000)));
  const sanExt = derSeq(
    derOid('2.5.29.17'),
    derTag(0x04, derSeq(derTag(0x82, Buffer.from(hostname, 'ascii'))))
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
  const httpsServer = await listenHttps({ key, cert }, (req, res) => {
    seenHttpsRequests.push({ path: req.url, host: req.headers.host, accept: req.headers.accept });
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: `https://${targetHost}/releases/latest` });
      res.end();
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

    // 4. Pre-aborted AbortSignal rejects immediately without hanging or falling back
    const ac = new AbortController();
    ac.abort(new Error('already aborted'));
    await assert.rejects(
      () => httpFetcher(`https://${targetHost}/releases/latest`, { signal: ac.signal, timeoutMs: 5000 }),
      /already aborted/
    );
    assert.equal(fallbackCalls, 0);

    // 5. SOCKS5 proxy request
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
    await httpProxy.close();
    await socksProxy.close();
    await httpsServer.close();
  }
});
