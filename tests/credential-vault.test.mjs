import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTIVE_TARGET,
  ACTIVE_USERNAME,
  SECRET_SERVICE,
  VAULT_SERVICE,
  buildMacKeychainReadScript,
  buildMacKeychainWriteScript,
  createCredentialVault,
  deleteSecret,
  extractCredentialEmail,
  extractCredentialMeta,
  extractCredentialRefreshHash,
  readSecret,
  secretTargetFor,
  vaultTargetFor,
  writeSecret
} from '../lib/credential-vault.mjs';

test('vaultTargetFor validates account IDs and rejects invalid or injection-like names', () => {
  assert.equal(vaultTargetFor('acct-123_ab'), 'agy-powertools:account:acct-123_ab');
  for (const bad of ['', '   ', '../etc', 'a b', 'acct:1', 'a"b', 'x'.repeat(65)]) {
    assert.throws(() => vaultTargetFor(bad), /账号标识/);
  }
});

test('Windows credential vault passes target names via environment variables and avoids leaking secrets', () => {
  const calls = [];
  const vault = createCredentialVault({
    platform: 'win32',
    runSpawn(cmd, args, opts) {
      calls.push({ cmd, args, env: opts.env });
      const op = opts.env.AGY_CRED_OP;
      if (op === 'has' || op === 'inspect') return { status: 0, stdout: '{"ok":true,"exists":true,"bytes":512,"hash":"AABBCCDDEEFF"}\n', stderr: '' };
      if (op === 'copy') return { status: 0, stdout: '{"ok":true,"bytes":512,"hash":"AABBCCDDEEFF"}\n', stderr: '' };
      return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
  });
  assert.equal(vault.supported, true);
  assert.equal(vault.hasSaved('acct-1'), true);
  assert.deepEqual(vault.inspectSaved('acct-1'), { exists: true, hash: 'AABBCCDDEEFF' });
  assert.equal(calls[0].cmd, 'powershell.exe');
  assert.equal(calls[0].env.AGY_CRED_SRC, 'agy-powertools:account:acct-1');

  const saved = vault.saveActiveTo('acct-1');
  assert.deepEqual(saved, { ok: true, bytes: 512, hash: 'AABBCCDDEEFF' });
  assert.equal(calls[2].env.AGY_CRED_SRC, ACTIVE_TARGET);
  assert.equal(calls[2].env.AGY_CRED_DST, 'agy-powertools:account:acct-1');

  const restored = vault.restoreToActive('acct-1');
  assert.deepEqual(restored, { ok: true, bytes: 512, hash: 'AABBCCDDEEFF' });
  assert.equal(calls[3].env.AGY_CRED_SRC, 'agy-powertools:account:acct-1');
  assert.equal(calls[3].env.AGY_CRED_DST, ACTIVE_TARGET);
  assert.equal(calls[3].env.AGY_CRED_USER, ACTIVE_USERNAME);

  assert.deepEqual(vault.removeSaved('acct-1'), { ok: true });
  assert.equal(calls[4].env.AGY_CRED_OP, 'remove');
});

test('macOS and Linux credential vaults use stdin pipes for secrets and never pass tokens in CLI args', () => {
  const macCalls = [];
  const macVault = createCredentialVault({
    platform: 'darwin',
    runSpawn(cmd, args, opts) {
      macCalls.push({ cmd, args, input: opts?.input });
      if (args.includes('-w')) return { status: 0, stdout: Buffer.from('secret-refresh-token\n') };
      return { status: 0, stdout: '' };
    }
  });
  assert.equal(macVault.hasSaved('acct-mac'), true);
  const macCopy = macVault.saveActiveTo('acct-mac');
  assert.equal(macCopy.ok, true);
  assert.equal(macCalls[1].cmd, '/usr/bin/security');
  assert.equal(macCalls[2].args[0], '-i');
  assert.equal(macCalls[2].args.includes('secret-refresh-token'), false);
  assert.ok(String(macCalls[2].input).includes('agy-powertools-account'));

  const linuxCalls = [];
  const linuxVault = createCredentialVault({
    platform: 'linux',
    wsl: false,
    runSpawn(cmd, args, opts) {
      linuxCalls.push({ cmd, args, inputText: opts?.input ? Buffer.from(opts.input).toString('utf8') : '' });
      if (args[0] === 'lookup') return { status: 0, stdout: Buffer.from('linux-token') };
      return { status: 0, stdout: '' };
    }
  });
  assert.equal(linuxVault.hasSaved('acct-lin'), true);
  assert.equal(linuxVault.restoreToActive('acct-lin').ok, true);
  assert.equal(linuxCalls[2].args.includes('linux-token'), false);
  assert.equal(linuxCalls[2].inputText, 'linux-token');
});

test('credential vault extracts id_token_email and blocks mismatched writes across Linux, macOS, and Windows', () => {
  const alphaPayload = JSON.stringify({
    token: { access_token: 'tok-a', refresh_token: 'rt-a' },
    auth_method: 'consumer',
    id_token_email: 'Alpha@Example.com'
  });
  const wslEnvelope = JSON.stringify({
    v: 1,
    token: Buffer.from(alphaPayload, 'utf8').toString('base64'),
    scope: null
  });
  assert.equal(extractCredentialEmail(alphaPayload), 'alpha@example.com');
  assert.equal(extractCredentialEmail(Buffer.from(wslEnvelope, 'utf8')), 'alpha@example.com');
  assert.equal(extractCredentialEmail('opaque-non-json-token'), '');

  // Linux: inspect returns email, and mismatched saveActiveTo refuses without calling secret-tool store
  const linuxOps = [];
  const linuxVault = createCredentialVault({
    platform: 'linux',
    wsl: false,
    runSpawn(cmd, args) {
      linuxOps.push(args[0]);
      if (args[0] === 'lookup') return { status: 0, stdout: Buffer.from(alphaPayload, 'utf8') };
      return { status: 0, stdout: '' };
    }
  });
  const inspected = linuxVault.inspectActive();
  assert.equal(inspected.exists, true);
  assert.equal(inspected.email, 'alpha@example.com');
  const blocked = linuxVault.saveActiveTo('acct-beta', { expectedEmail: 'beta@example.com' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.mismatch, true);
  assert.equal(blocked.actualEmail, 'alpha@example.com');
  assert.equal(blocked.expectedEmail, 'beta@example.com');
  assert.equal(linuxOps.includes('store'), false);
  const allowed = linuxVault.saveActiveTo('acct-alpha', { expectedEmail: 'alpha@example.com' });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.email, 'alpha@example.com');
  assert.equal(linuxOps.includes('store'), true);

  // macOS: mismatched restoreToActive refuses without calling security -i
  const macOps = [];
  const macVault = createCredentialVault({
    platform: 'darwin',
    runSpawn(_cmd, args) {
      macOps.push(args[0]);
      if (args.includes('-w')) return { status: 0, stdout: Buffer.from(alphaPayload + '\n', 'utf8') };
      return { status: 0, stdout: '' };
    }
  });
  assert.equal(macVault.inspectSaved('acct-alpha').email, 'alpha@example.com');
  const macBlocked = macVault.restoreToActive('acct-beta', { expectedEmail: 'beta@example.com' });
  assert.equal(macBlocked.ok, false);
  assert.equal(macBlocked.mismatch, true);
  assert.equal(macOps.includes('-i'), false);

  // Windows: forwards AGY_CRED_EXPECTED_EMAIL (and clears inherited value when omitted) and surfaces mismatch JSON cleanly
  const winEnvs = [];
  const winVault = createCredentialVault({
    platform: 'win32',
    env: { AGY_CRED_EXPECTED_EMAIL: 'stale@example.com' },
    runSpawn(_cmd, _args, opts) {
      winEnvs.push(opts.env);
      if (opts.env.AGY_CRED_OP === 'inspect') {
        return { status: 0, stdout: '{"ok":true,"exists":true,"bytes":128,"hash":"AABBCCDDEEFF","email":"alpha@example.com"}\n', stderr: '' };
      }
      return {
        status: 1,
        stdout: '{"ok":false,"mismatch":true,"actualEmail":"alpha@example.com","expectedEmail":"beta@example.com","error":"credential email mismatch"}\n',
        stderr: ''
      };
    }
  });
  assert.deepEqual(winVault.inspectSaved('acct-alpha'), { exists: true, hash: 'AABBCCDDEEFF', email: 'alpha@example.com' });
  assert.equal(winEnvs[0].AGY_CRED_EXPECTED_EMAIL, '');
  const winBlocked = winVault.saveActiveTo('acct-beta', { expectedEmail: 'Beta@Example.com' });
  assert.equal(winBlocked.ok, false);
  assert.equal(winBlocked.mismatch, true);
  assert.equal(winBlocked.actualEmail, 'alpha@example.com');
  assert.equal(winBlocked.expectedEmail, 'beta@example.com');
  assert.equal(winEnvs[1].AGY_CRED_EXPECTED_EMAIL, 'beta@example.com');
});

test('Windows PowerShell WIN32_SCRIPT compiles Add-Type and extracts id_token_email across direct JSON, decoy keys, and WSL envelopes', { skip: process.platform !== 'win32' }, () => {
  let capturedScript = '';
  const probeVault = createCredentialVault({
    platform: 'linux',
    wsl: true,
    runSpawn(cmd, args, opts) {
      capturedScript = args[args.indexOf('-Command') + 1];
      return spawnSync(cmd, args, { ...opts, timeout: 20000 });
    }
  });
  const probed = probeVault.probe({ force: true });
  assert.equal(probed.supported, true, `WIN32_SCRIPT probe failed: ${probed.reason}`);
  assert.ok(capturedScript.includes('class AgyWinCred'));

  const endMatch = capturedScript.match(/^"@/m);
  assert.ok(endMatch && typeof endMatch.index === 'number');
  const addTypeBlock = capturedScript.slice(0, endMatch.index + endMatch[0].length);
  const directPayload = JSON.stringify({
    token: { access_token: 'tok-a', refresh_token: 'rt-a' },
    id_token_email: 'Alpha@Example.com'
  });
  const decoyPayload = JSON.stringify({
    note: 'id_token_email',
    other: 'decoy@example.com',
    id_token_email: 'Real@Example.com'
  });
  const wslEnvelope = JSON.stringify({
    v: 1,
    token: Buffer.from(JSON.stringify({ id_token_email: 'Beta@Example.com', token: { refresh_token: 'rt-beta-123' } }), 'utf8').toString('base64'),
    scope: null
  });
  const goKeyringSingle = `go-keyring-base64:${Buffer.from(JSON.stringify({
    id_token_email: 'Mac@Example.com',
    token: { refresh_token: 'rt-mac-001' }
  }), 'utf8').toString('base64')}`;
  const goKeyringDouble = `go-keyring-base64:${Buffer.from(goKeyringSingle, 'utf8').toString('base64')}`;
  const goKeyringTriple = `go-keyring-base64:${Buffer.from(goKeyringDouble, 'utf8').toString('base64')}`;
  const escapedDecoyPayload = JSON.stringify({
    note: '"id_token_email":"fake@example.com","refresh_token":"rt-fake"',
    id_token_email: 'Escaped@Example.com',
    token: { refresh_token: 'rt-escaped-1' }
  });
  const expectedRfA = createHash('sha256').update('rt-a').digest('hex').slice(0, 12);
  const expectedRfBeta = createHash('sha256').update('rt-beta-123').digest('hex').slice(0, 12);
  const expectedRfMac = createHash('sha256').update('rt-mac-001').digest('hex').slice(0, 12);
  const expectedRfEscaped = createHash('sha256').update('rt-escaped-1').digest('hex').slice(0, 12);
  const verifyScript = [
    addTypeBlock,
    '$cases = @($env:AGY_TEST_C1, $env:AGY_TEST_C2, $env:AGY_TEST_C3, $env:AGY_TEST_C4, $env:AGY_TEST_C5, $env:AGY_TEST_C6, $env:AGY_TEST_C7, $env:AGY_TEST_C8, $env:AGY_TEST_C9)',
    '$out = foreach ($c in $cases) {',
    '  $b = [System.Text.Encoding]::UTF8.GetBytes($c)',
    '  ([AgyWinCred]::ExtractEmail($b)) + ":" + ([AgyWinCred]::ExtractRefreshHash($b))',
    '}',
    'Write-Output ($out -join "|")'
  ].join('\n');
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', verifyScript],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      env: {
        ...process.env,
        AGY_TEST_C1: directPayload,
        AGY_TEST_C2: decoyPayload,
        AGY_TEST_C3: wslEnvelope,
        AGY_TEST_C4: 'opaque-non-json-token',
        AGY_TEST_C5: goKeyringSingle,
        AGY_TEST_C6: goKeyringDouble,
        AGY_TEST_C7: goKeyringTriple,
        AGY_TEST_C8: 'go-keyring-base64:!!!not-base64!!!',
        AGY_TEST_C9: escapedDecoyPayload
      }
    }
  );
  assert.equal(res.status, 0, res.stderr || res.error?.message || 'powershell failed');
  const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
  assert.equal(
    line,
    `alpha@example.com:${expectedRfA}|real@example.com:|beta@example.com:${expectedRfBeta}|:|mac@example.com:${expectedRfMac}|mac@example.com:${expectedRfMac}|:|:|escaped@example.com:${expectedRfEscaped}`
  );
});

test('PR #102: credential vault fails closed on unextractable email, invalid expectedEmail, and expectedHash mismatch across backends', () => {
  const raw = JSON.stringify({ id_token_email: 'Test@example.invalid', token: { refresh_token: 'rt-1' } });
  const wrap = text => 'go-keyring-base64:' + Buffer.from(text).toString('base64');
  let macSecret = wrap(raw);
  const macWrites = [];
  const macVault = createCredentialVault({
    platform: 'darwin',
    runSpawn(cmd, args, opts) {
      if (cmd === '/usr/bin/osascript') return { status: 1 };
      if (args.includes('-w')) return { status: 0, stdout: Buffer.from(macSecret + '\n') };
      macWrites.push(opts.input);
      return { status: 0 };
    }
  });
  const okHash = macVault.inspectActive().hash;
  assert.equal(macVault.saveActiveTo('acct-test', { expectedEmail: 'test@example.invalid', expectedHash: okHash }).ok, true);
  assert.equal(macWrites.length, 1);
  // expectedHash mismatch blocks write
  const staleHashRes = macVault.saveActiveTo('acct-test', { expectedEmail: 'test@example.invalid', expectedHash: '000000000000' });
  assert.equal(staleHashRes.ok, false);
  assert.match(staleHashRes.error, /changed/);
  // Invalid expectedEmail fails closed before reading
  assert.equal(macVault.saveActiveTo('acct-test', { expectedEmail: 'not-an-email' }).ok, false);
  // Opaque / malformed / missing-email / over-nested secrets MUST fail closed with mismatch: true
  for (const bad of [wrap(raw) + '!', wrap('opaque'), wrap(JSON.stringify({})), wrap(wrap(wrap(raw)))]) {
    macSecret = bad;
    assert.equal(macVault.inspectActive().email, undefined);
    const res = macVault.restoreToActive('acct-test', { expectedEmail: 'test@example.invalid' });
    assert.equal(res.ok, false);
    assert.equal(res.mismatch, true);
    assert.equal(res.actualEmail, '');
  }
  assert.equal(macWrites.length, 1);

  // Linux: opaque token fails closed when expectedEmail is specified
  const linuxOps = [];
  const linuxVault = createCredentialVault({
    platform: 'linux',
    wsl: false,
    runSpawn(_cmd, args) {
      linuxOps.push(args[0]);
      if (args[0] === 'lookup') return { status: 0, stdout: Buffer.from('opaque-token') };
      return { status: 0, stdout: '' };
    }
  });
  const linuxBlocked = linuxVault.saveActiveTo('acct-test', { expectedEmail: 'test@example.invalid' });
  assert.equal(linuxBlocked.ok, false);
  assert.equal(linuxBlocked.mismatch, true);
  assert.equal(linuxBlocked.actualEmail, '');
  assert.equal(linuxOps.includes('store'), false);

  // Windows: forwards AGY_CRED_EXPECTED_HASH and fails closed on empty actualEmail mismatch JSON
  const winEnvs = [];
  const winVault = createCredentialVault({
    platform: 'win32',
    runSpawn(_cmd, _args, opts) {
      winEnvs.push(opts.env);
      return {
        status: 1,
        stdout: '{"ok":false,"mismatch":true,"actualEmail":"","expectedEmail":"test@example.invalid","error":"credential email mismatch"}\n',
        stderr: ''
      };
    }
  });
  const winBlocked = winVault.restoreToActive('acct-test', { expectedEmail: 'test@example.invalid', expectedHash: 'AABBCCDDEEFF' });
  assert.equal(winBlocked.ok, false);
  assert.equal(winBlocked.mismatch, true);
  assert.equal(winBlocked.actualEmail, '');
  assert.equal(winEnvs[0].AGY_CRED_EXPECTED_HASH, 'AABBCCDDEEFF');
});

test('extractCredentialMeta unwraps go-keyring-base64: with depth <= 2, computes refreshHash, and blocks mismatched macOS writes (Issues #95 & #97)', () => {
  const rawJson = JSON.stringify({
    id_token_email: 'MacUser@Example.com',
    token: { access_token: 'at-1', refresh_token: '  rt-mac-secret-1  ' }
  });
  const topLevelRtJson = JSON.stringify({
    id_token_email: 'Top@Example.com',
    refresh_token: 'rt-top-secret'
  });
  const expectedRfMac = createHash('sha256').update('rt-mac-secret-1').digest('hex').slice(0, 12);
  const expectedRfTop = createHash('sha256').update('rt-top-secret').digest('hex').slice(0, 12);

  const wrapped1 = `go-keyring-base64:${Buffer.from(rawJson, 'utf8').toString('base64')}`;
  const wrapped2 = `go-keyring-base64:${Buffer.from(wrapped1, 'utf8').toString('base64')}`;
  const wrapped3 = `go-keyring-base64:${Buffer.from(wrapped2, 'utf8').toString('base64')}`;

  assert.equal(extractCredentialEmail(wrapped1), 'macuser@example.com');
  assert.equal(extractCredentialRefreshHash(wrapped1), expectedRfMac);
  assert.deepEqual(extractCredentialMeta(wrapped1), { email: 'macuser@example.com', refreshHash: expectedRfMac });
  assert.deepEqual(extractCredentialMeta(Buffer.from(wrapped2, 'utf8')), { email: 'macuser@example.com', refreshHash: expectedRfMac });
  assert.deepEqual(extractCredentialMeta(topLevelRtJson), { email: 'top@example.com', refreshHash: expectedRfTop });
  // Depth > 2 and malformed payloads fail closed cleanly
  assert.deepEqual(extractCredentialMeta(wrapped3), { email: '', refreshHash: '' });
  assert.deepEqual(extractCredentialMeta('go-keyring-base64:'), { email: '', refreshHash: '' });
  assert.deepEqual(extractCredentialMeta('go-keyring-base64:!!!invalid!!!'), { email: '', refreshHash: '' });
  assert.deepEqual(extractCredentialMeta(`go-keyring-base64:${Buffer.from('not-json', 'utf8').toString('base64')}`), { email: '', refreshHash: '' });

  // macOS vault inspectActive, inspectSaved, saveActiveTo, and restoreToActive unwrap go-keyring-base64:
  const ops = [];
  const macVault = createCredentialVault({
    platform: 'darwin',
    runSpawn(_cmd, args) {
      ops.push(args[0]);
      if (args.includes('-w')) return { status: 0, stdout: Buffer.from(wrapped1 + '\n', 'utf8') };
      return { status: 0, stdout: '' };
    }
  });
  const act = macVault.inspectActive();
  assert.equal(act.exists, true);
  assert.equal(act.email, 'macuser@example.com');
  assert.equal(act.refreshHash, expectedRfMac);
  const saved = macVault.inspectSaved('acct-mac');
  assert.equal(saved.email, 'macuser@example.com');
  assert.equal(saved.refreshHash, expectedRfMac);

  const blockedSave = macVault.saveActiveTo('acct-other', { expectedEmail: 'other@example.com' });
  assert.equal(blockedSave.ok, false);
  assert.equal(blockedSave.mismatch, true);
  assert.equal(blockedSave.actualEmail, 'macuser@example.com');
  assert.equal(ops.includes('-i'), false);

  const blockedRestore = macVault.restoreToActive('acct-other', { expectedEmail: 'other@example.com' });
  assert.equal(blockedRestore.ok, false);
  assert.equal(blockedRestore.mismatch, true);
  assert.equal(ops.includes('-i'), false);

  const okSave = macVault.saveActiveTo('acct-mac', { expectedEmail: 'macuser@example.com' });
  assert.equal(okSave.ok, true);
  assert.equal(okSave.email, 'macuser@example.com');
  assert.equal(okSave.refreshHash, expectedRfMac);
  assert.equal(ops.includes('-i'), true);
});

test('macOS credential vault keeps secrets out of argv across small, medium (2.6KB), and >4KB OAuth payloads and round-trips cleanly (Issue #75)', () => {
  const smallSecret = JSON.stringify({
    id_token_email: 'small@example.com',
    token: { access_token: 'S'.repeat(64) }
  });
  const mediumSecret = JSON.stringify({
    id_token_email: 'mid@example.com',
    token: { access_token: 'M'.repeat(1400), refresh_token: 'N'.repeat(1100) }
  });
  const bigSecret = JSON.stringify({
    id_token_email: 'big@example.com',
    token: { access_token: 'A'.repeat(2400), refresh_token: 'R'.repeat(2200) }
  });
  assert.ok(Buffer.byteLength(mediumSecret, 'utf8') > 2200 && Buffer.byteLength(mediumSecret, 'utf8') < 3600);
  assert.ok(Buffer.byteLength(bigSecret, 'utf8') > 4096, 'test payload must exceed 4 KB raw');

  const store = new Map();
  const calls = [];
  const vault = createCredentialVault({
    platform: 'darwin',
    runSpawn(cmd, args, opts) {
      calls.push({ cmd, args, input: opts?.input, env: opts?.env });
      if (cmd === '/usr/bin/security' && args[0] === 'find-generic-password') {
        const svc = args[args.indexOf('-s') + 1];
        const acct = args[args.indexOf('-a') + 1];
        const val = store.get(`${svc}\0${acct}`);
        if (val == null) return { status: 44, stdout: '', stderr: 'not found' };
        return { status: 0, stdout: Buffer.from(val + '\n', 'utf8') };
      }
      if (cmd === '/usr/bin/security' && args[0] === '-i') {
        const line = String(opts?.input || '');
        const hexM = line.match(/^add-generic-password -U -s ("[^"]+") -a ("[^"]+") -X ([0-9a-f]+)\n$/i);
        if (hexM) {
          store.set(`${JSON.parse(hexM[1])}\0${JSON.parse(hexM[2])}`, Buffer.from(hexM[3], 'hex').toString('utf8'));
          return { status: 0, stdout: '' };
        }
        const rawM = line.match(/^add-generic-password -U -s ("[^"]+") -a ("[^"]+") -w '([^']*)'\n$/);
        assert.ok(rawM, 'security -i input must be well-formed -X or -w command');
        store.set(`${JSON.parse(rawM[1])}\0${JSON.parse(rawM[2])}`, rawM[3]);
        return { status: 0, stdout: '' };
      }
      if (cmd === '/usr/bin/osascript' && args[0] === '-l' && args[1] === 'JavaScript') {
        const script = String(opts?.input || '');
        const svcM = script.match(/const service = \$\(([^\n]+)\);/);
        const acctM = script.match(/const account = \$\(([^\n]+)\);/);
        assert.ok(svcM && acctM, 'osascript stdin must carry service and account');
        const key = `${JSON.parse(svcM[1])}\0${JSON.parse(acctM[1])}`;
        if (script.includes('SecItemCopyMatching')) {
          const val = store.get(key);
          if (val == null) return { status: 1, stdout: '', stderr: 'copy-matching OSStatus -25300' };
          return { status: 0, stdout: Buffer.from(Buffer.from(val, 'utf8').toString('base64') + '\n', 'utf8') };
        }
        const b64M = script.match(/initWithBase64EncodedStringOptions\(\$\(([^\n]+)\), 0\)/);
        assert.ok(b64M, 'osascript write stdin must carry base64 payload');
        store.set(key, Buffer.from(JSON.parse(b64M[1]), 'base64').toString('utf8'));
        return { status: 0, stdout: '' };
      }
      return { status: 1, stdout: '', stderr: `unexpected command: ${cmd}` };
    }
  });

  // 1. Small payload uses `/usr/bin/security -i` (-X hex) via stdin, never passing secret in argv
  store.set('gemini\0antigravity', smallSecret);
  assert.equal(vault.saveActiveTo('acct-small', { expectedEmail: 'small@example.com' }).ok, true);
  const smallWrite = calls.at(-1);
  assert.equal(smallWrite.cmd, '/usr/bin/security');
  assert.deepEqual(smallWrite.args, ['-i']);
  assert.ok(String(smallWrite.input).includes(' -X '));

  // 2. Medium (~2.6 KB) printable OAuth JSON uses `/usr/bin/security -i` (-w raw) via stdin (keeps native security ACL, zero argv leak)
  store.set('gemini\0antigravity', mediumSecret);
  assert.equal(vault.saveActiveTo('acct-mid', { expectedEmail: 'mid@example.com' }).ok, true);
  const midWrite = calls.at(-1);
  assert.equal(midWrite.cmd, '/usr/bin/security');
  assert.deepEqual(midWrite.args, ['-i']);
  assert.ok(String(midWrite.input).includes(" -w '"));
  assert.equal(store.get('agy-powertools-account\0acct-mid'), mediumSecret);

  // 3. Oversized (> 4 KB) payload uses `/usr/bin/osascript -l JavaScript` via stdin, never leaking secret/hex/base64 into argv
  store.set('gemini\0antigravity', bigSecret);
  const saved = vault.saveActiveTo('acct-big', { expectedEmail: 'big@example.com' });
  assert.equal(saved.ok, true);
  assert.equal(saved.bytes, Buffer.byteLength(bigSecret, 'utf8'));
  const bigWrite = calls.at(-1);
  assert.equal(bigWrite.cmd, '/usr/bin/osascript');
  assert.deepEqual(bigWrite.args, ['-l', 'JavaScript']);
  const joinedArgs = bigWrite.args.join(' ');
  assert.equal(joinedArgs.includes('big@example.com'), false);
  assert.equal(joinedArgs.includes('AAAA'), false);
  assert.equal(joinedArgs.includes(Buffer.from(bigSecret, 'utf8').toString('hex')), false);
  assert.equal(joinedArgs.includes(Buffer.from(bigSecret, 'utf8').toString('base64')), false);

  // 4. Round-trip restore back to active slot recovers the exact > 4 KB OAuth payload via non-interactive JXA read
  store.set('gemini\0antigravity', smallSecret);
  const restored = vault.restoreToActive('acct-big', { expectedEmail: 'big@example.com' });
  assert.equal(restored.ok, true);
  assert.equal(store.get('gemini\0antigravity'), bigSecret);
});

test('large Keychain writes fail closed when the reader, ACL, partition or protected add fails', () => {
  const script = buildMacKeychainWriteScript({ service: 'test', account: 'test', dataBase64: 'YQ==' });
  const makeRef = value => ({ [Symbol.toStringTag]: 'Ref', value });
  for (const failure of ['reader', 'acl', 'partition', 'add']) {
    const writes = [];
    const bound = [];
    const dictionary = {
      setObjectForKey(v, k) {
        assert.notEqual(Object.prototype.toString.call(v), '[object Ref]', 'dict value must be cast from Ref to ObjC object');
        assert.notEqual(Object.prototype.toString.call(k), '[object Ref]', 'dict key must be cast from Ref to ObjC object');
      },
      get mutableCopy() { return this; }
    };
    const bridge = Object.assign(value => value, {
      kSecClass: makeRef('class'),
      kSecClassGenericPassword: makeRef('genp'),
      kSecAttrService: makeRef('svce'),
      kSecAttrAccount: makeRef('acct'),
      kSecValueData: makeRef('v_Data'),
      kSecAttrAccess: makeRef('accs'),
      kSecACLAuthorizationPartitionID: makeRef('ACLAuthorizationPartitionID'),
      NSData: { alloc: { initWithBase64EncodedStringOptions: () => ({ isNil: () => false }) } },
      NSMutableDictionary: { alloc: { init: dictionary } },
      NSMutableArray: {
        alloc: {
          init: {
            addObject(obj) {
              assert.notEqual(Object.prototype.toString.call(obj), '[object Ref]', 'array element must be cast from Ref to ObjC object');
            }
          }
        }
      },
      SecItemUpdate: (q, a) => {
        assert.equal(q, dictionary);
        assert.equal(a, dictionary);
        return -25300;
      },
      SecTrustedApplicationCreateFromPath(path, ref) {
        assert.equal(typeof path, 'string');
        ref[0] = makeRef(path);
        return path === '/usr/bin/security' && failure === 'reader' ? -1 : 0;
      },
      SecAccessCreate(service, list, ref) {
        assert.equal(service, 'test');
        assert.ok(list);
        ref[0] = makeRef('access');
        return failure === 'acl' ? -1 : 0;
      },
      SecAccessCopyMatchingACLList() { return null; },
      SecACLCreateWithSimpleContents(access, apps, xml, prompt, ref) {
        assert.equal(access, 'access');
        assert.equal(apps, null);
        assert.match(String(xml), /apple-tool:/);
        assert.equal(prompt, 0);
        ref[0] = makeRef('acl');
        return failure === 'partition' ? -1 : 0;
      },
      SecACLUpdateAuthorizations(acl) {
        assert.equal(acl, 'acl');
        return 0;
      },
      SecItemAdd(q) {
        assert.equal(q, dictionary);
        writes.push('add');
        return -1;
      },
      exit(code) { throw Error(`exit ${code}`); }
    });
    const ObjC = {
      import() {},
      bindFunction: (name, sig) => bound.push([name, sig]),
      castRefToObject: r => r.value,
      unwrap: o => String(o)
    };
    assert.throws(() => runInNewContext(script, { $: bridge, Ref: () => [], ObjC, console: { log() {} } }), /exit 1/);
    assert.deepEqual(writes, failure === 'add' ? ['add'] : []);
    assert.ok(bound.some(([name]) => name === 'SecItemAdd'));
    assert.ok(bound.some(([name]) => name === 'SecAccessCreate'));
    assert.ok(bound.some(([name]) => name === 'SecACLCreateWithSimpleContents'));
  }
});

if (process.platform === 'darwin') {
  test('live macOS Keychain round-trip verifies 2.6KB security -i -w and >4KB JXA Security.framework create/read/update/read', async t => {
    const service = `agy-powertools-ci-test-${process.pid}-${Date.now()}`;
    const midAccount = 'medium-payload';
    const largeAccount = 'large-payload';
    const midPayload = JSON.stringify({
      id_token_email: 'ci-mid@example.com',
      token: { access_token: 'M'.repeat(1400), refresh_token: 'N'.repeat(1100) }
    });
    const largePayload = JSON.stringify({
      id_token_email: 'ci-large@example.com',
      token: { access_token: 'A'.repeat(2400), refresh_token: 'R'.repeat(2200) }
    });
    assert.ok(Buffer.byteLength(midPayload, 'utf8') > 2200 && Buffer.byteLength(midPayload, 'utf8') < 3600);
    assert.ok(Buffer.byteLength(largePayload, 'utf8') > 4096);
    try {
      // 1. Medium (~2.6 KB) printable OAuth JSON via `/usr/bin/security -i -w '...'` -> read via `/usr/bin/security -w`
      const midCmd = `add-generic-password -U -s ${JSON.stringify(service)} -a ${JSON.stringify(midAccount)} -w '${midPayload}'\n`;
      const midWrite = spawnSync('/usr/bin/security', ['-i'], {
        input: midCmd,
        stdio: ['pipe', 'ignore', 'pipe'],
        timeout: 10000
      });
      if (midWrite.status !== 0 && /-25308|-25293|interaction not allowed/i.test(String(midWrite.stderr || ''))) {
        t.skip('macOS runner login keychain is locked in headless environment');
        return;
      }
      assert.equal(midWrite.status, 0, String(midWrite.stderr || 'security -i -w failed'));
      const midRead = spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', midAccount, '-w'], {
        encoding: 'utf8',
        timeout: 10000
      });
      assert.equal(midRead.status, 0, String(midRead.stderr || 'security medium read failed'));
      assert.equal(String(midRead.stdout || '').replace(/[\r\n]+$/, ''), midPayload);

      // 2. Oversized (> 4 KB) payload via JXA Security.framework create -> read -> update -> read (non-interactive)
      for (const currentPayload of [largePayload, largePayload.replace('ci-large@example.com', 'updated@example.com')]) {
        const writeScript = buildMacKeychainWriteScript({
          service,
          account: largeAccount,
          dataBase64: Buffer.from(currentPayload, 'utf8').toString('base64')
        });
        const writeRes = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript'], {
          input: writeScript,
          stdio: ['pipe', 'ignore', 'pipe'],
          timeout: 10000
        });
        if (writeRes.status !== 0 && /-25308|-25293/.test(String(writeRes.stderr || ''))) {
          t.skip('macOS runner login keychain is locked in headless environment');
          return;
        }
        assert.equal(writeRes.status, 0, String(writeRes.stderr || 'osascript write failed'));
        const readScript = buildMacKeychainReadScript({ service, account: largeAccount });
        const readRes = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript'], {
          input: readScript,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000
        });
        assert.equal(readRes.status, 0, String(readRes.stderr || 'osascript read failed'));
        const decoded = Buffer.from(Buffer.from(readRes.stdout || '').toString('utf8').trim(), 'base64').toString('utf8');
        assert.equal(decoded, currentPayload);
      }
    } finally {
      spawnSync('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', midAccount], { stdio: 'ignore', timeout: 5000 });
      spawnSync('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', largeAccount], { stdio: 'ignore', timeout: 5000 });
    }
  });
}

test('secretTargetFor generates deterministic SHA-256 keys under SECRET_SERVICE isolated from account OAuth slots', () => {
  assert.equal(SECRET_SERVICE, 'agy-powertools-secret');
  const expectedOpenAi = `agy-powertools-secret:${createHash('sha256').update('ai:openai', 'utf8').digest('hex').slice(0, 32)}`;
  assert.equal(secretTargetFor('ai:openai'), expectedOpenAi);
  assert.equal(secretTargetFor('  ai:openai  '), expectedOpenAi);
  assert.notEqual(secretTargetFor('ai:openai'), secretTargetFor('ai:anthropic'));
  assert.equal(
    secretTargetFor('ai:openai', { wslDistro: 'Ubuntu-24.04' }),
    `agy-powertools-secret:wsl:Ubuntu-24.04:${createHash('sha256').update('ai:openai', 'utf8').digest('hex').slice(0, 32)}`
  );

  // Even hostile scope keys matching account targets stay strictly isolated under SECRET_SERVICE
  const hostileActive = secretTargetFor(ACTIVE_TARGET);
  const hostileAcct = secretTargetFor(vaultTargetFor('acct-1'));
  assert.ok(hostileActive.startsWith(`${SECRET_SERVICE}:`));
  assert.notEqual(hostileActive, ACTIVE_TARGET);
  assert.ok(hostileAcct.startsWith(`${SECRET_SERVICE}:`));
  assert.notEqual(hostileAcct, vaultTargetFor('acct-1'));

  for (const bad of ['', '   ', null, undefined, 123, 'bad\nkey', 'bad\0key', 'x'.repeat(257)]) {
    assert.throws(() => secretTargetFor(bad), /凭据标识/);
  }
});

test('writeSecret, readSecret, and deleteSecret round-trip across Windows, WSL2, macOS, and Linux without leaking secrets in argv or touching account OAuth slots', () => {
  // 1. Windows Credential Manager + isolation from account OAuth slots
  const winStore = new Map([[ACTIVE_TARGET, Buffer.from('{"id_token_email":"oauth@example.com"}').toString('base64')]]);
  const winCalls = [];
  const winOpts = {
    platform: 'win32',
    runSpawn(cmd, args, opts) {
      winCalls.push({ cmd, args, env: opts.env, input: opts.input });
      const op = opts.env.AGY_CRED_OP;
      if (op === 'write') {
        winStore.set(opts.env.AGY_CRED_DST, opts.input);
        return { status: 0, stdout: '{"ok":true,"bytes":16,"hash":"112233445566"}\n', stderr: '' };
      }
      if (op === 'read') {
        const val = winStore.get(opts.env.AGY_CRED_SRC);
        return {
          status: 0,
          stdout: JSON.stringify(val ? { ok: true, exists: true, bytes: 16, hash: '112233445566', data: val } : { ok: true, exists: false, hash: '', data: '' }) + '\n',
          stderr: ''
        };
      }
      if (op === 'remove') {
        winStore.delete(opts.env.AGY_CRED_SRC);
        return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
      }
      if (op === 'has' || op === 'inspect') {
        const val = winStore.get(opts.env.AGY_CRED_SRC);
        return { status: 0, stdout: JSON.stringify({ ok: true, exists: Boolean(val), hash: val ? 'AABBCCDDEEFF' : '' }) + '\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    }
  };
  assert.deepEqual(readSecret('ai:openai', winOpts), { ok: true, exists: false, value: '', available: true, reason: '' });
  assert.deepEqual(writeSecret('ai:openai', 'sk-win-secret-999', winOpts), { ok: true, available: true, reason: '' });
  assert.equal(winCalls.at(-1).args.join(' ').includes('sk-win-secret-999'), false);
  assert.equal(winCalls.at(-1).env.AGY_CRED_DST, secretTargetFor('ai:openai'));
  assert.deepEqual(readSecret('ai:openai', winOpts), { ok: true, exists: true, value: 'sk-win-secret-999', available: true, reason: '' });
  assert.deepEqual(deleteSecret('ai:openai', winOpts), { ok: true, available: true, reason: '' });
  assert.deepEqual(readSecret('ai:openai', winOpts), { ok: true, exists: false, value: '', available: true, reason: '' });
  // Account OAuth slot remained completely untouched
  assert.equal(winStore.has(ACTIVE_TARGET), true);
  assert.equal(createCredentialVault(winOpts).has(ACTIVE_TARGET), true);

  // 2. WSL2 hybrid Win32 CredMan
  const wslStore = new Map();
  const wslOpts = {
    platform: 'linux',
    wsl: true,
    env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
    runSpawn(_cmd, _args, opts) {
      const op = opts.env.AGY_CRED_OP;
      assert.ok(opts.env.WSLENV.includes('AGY_CRED_OP'));
      if (op === 'write') {
        wslStore.set(opts.env.AGY_CRED_DST, opts.input);
        return { status: 0, stdout: '{"ok":true,"bytes":12,"hash":"AABBCCDDEEFF"}\n', stderr: '' };
      }
      if (op === 'read') {
        const val = wslStore.get(opts.env.AGY_CRED_SRC);
        return { status: 0, stdout: JSON.stringify({ ok: true, exists: Boolean(val), data: val || '' }) + '\n', stderr: '' };
      }
      if (op === 'remove') {
        wslStore.delete(opts.env.AGY_CRED_SRC);
        return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    }
  };
  assert.equal(writeSecret('translate:azure', 'az-wsl-key', wslOpts).ok, true);
  assert.equal(wslStore.has(secretTargetFor('translate:azure', { wslDistro: 'Ubuntu-24.04' })), true);
  assert.equal(readSecret('translate:azure', wslOpts).value, 'az-wsl-key');
  assert.equal(deleteSecret('translate:azure', wslOpts).ok, true);
  assert.equal(readSecret('translate:azure', wslOpts).value, '');

  // 3. macOS Keychain (distinct service = SECRET_SERVICE, never touches VAULT_SERVICE)
  const macStore = new Map([[`${VAULT_SERVICE}\0acct-1`, 'oauth-account-token']]);
  const macCalls = [];
  const macOpts = {
    platform: 'darwin',
    runSpawn(cmd, args, opts) {
      macCalls.push({ cmd, args, input: opts?.input });
      if (cmd === '/usr/bin/security' && args[0] === 'find-generic-password') {
        const svc = args[args.indexOf('-s') + 1];
        const acct = args[args.indexOf('-a') + 1];
        const val = macStore.get(`${svc}\0${acct}`);
        if (val == null) return { status: 44, stdout: '', stderr: 'not found' };
        return { status: 0, stdout: Buffer.from(val + '\n', 'utf8') };
      }
      if (cmd === '/usr/bin/security' && args[0] === '-i') {
        const line = String(opts?.input || '');
        const hexM = line.match(/^add-generic-password -U -s ("[^"]+") -a ("[^"]+") -X ([0-9a-f]+)\n$/i);
        assert.ok(hexM, 'expected -X hex write for short secret');
        macStore.set(`${JSON.parse(hexM[1])}\0${JSON.parse(hexM[2])}`, Buffer.from(hexM[3], 'hex').toString('utf8'));
        return { status: 0, stdout: '' };
      }
      if (cmd === '/usr/bin/security' && args[0] === 'delete-generic-password') {
        const svc = args[args.indexOf('-s') + 1];
        const acct = args[args.indexOf('-a') + 1];
        macStore.delete(`${svc}\0${acct}`);
        return { status: 0, stdout: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    }
  };
  assert.equal(writeSecret('ai:gemini', 'AIza-mac-key', macOpts).ok, true);
  assert.equal(macCalls.at(-1).args.join(' ').includes('AIza-mac-key'), false);
  const macKeyHash = secretTargetFor('ai:gemini').slice(`${SECRET_SERVICE}:`.length);
  assert.equal(macStore.get(`${SECRET_SERVICE}\0${macKeyHash}`), 'AIza-mac-key');
  assert.equal(readSecret('ai:gemini', macOpts).value, 'AIza-mac-key');
  assert.equal(deleteSecret('ai:gemini', macOpts).ok, true);
  assert.equal(readSecret('ai:gemini', macOpts).value, '');
  assert.equal(macStore.get(`${VAULT_SERVICE}\0acct-1`), 'oauth-account-token');

  // 4. Linux secret-tool (requires desktop keyring env, passes secret via stdin, uses SECRET_SERVICE)
  const linuxStore = new Map([[`${VAULT_SERVICE}\0acct-1`, 'linux-oauth-token']]);
  const linuxCalls = [];
  const linuxOpts = {
    platform: 'linux',
    wsl: false,
    env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
    runSpawn(cmd, args, opts) {
      linuxCalls.push({ cmd, args, input: opts?.input ? Buffer.from(opts.input).toString('utf8') : '' });
      const svc = args[args.indexOf('service') + 1];
      const acct = args[args.indexOf('username') + 1];
      if (args[0] === 'store') {
        linuxStore.set(`${svc}\0${acct}`, Buffer.from(opts.input).toString('utf8'));
        return { status: 0, stdout: '' };
      }
      if (args[0] === 'lookup') {
        const val = linuxStore.get(`${svc}\0${acct}`);
        if (val == null) return { status: 1, stdout: '', stderr: '' };
        return { status: 0, stdout: Buffer.from(val, 'utf8') };
      }
      if (args[0] === 'clear') {
        linuxStore.delete(`${svc}\0${acct}`);
        return { status: 0, stdout: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    }
  };
  assert.equal(writeSecret('ai:anthropic', 'sk-ant-linux-1', linuxOpts).ok, true);
  assert.equal(linuxCalls.at(-1).args.includes('sk-ant-linux-1'), false);
  assert.equal(linuxCalls.at(-1).args[linuxCalls.at(-1).args.indexOf('service') + 1], SECRET_SERVICE);
  assert.equal(readSecret('ai:anthropic', linuxOpts).value, 'sk-ant-linux-1');
  assert.equal(deleteSecret('ai:anthropic', linuxOpts).ok, true);
  assert.equal(readSecret('ai:anthropic', linuxOpts).value, '');
  assert.equal(linuxStore.get(`${VAULT_SERVICE}\0acct-1`), 'linux-oauth-token');
});

test('generic secret vault fails closed with vault-unavailable across OS backends and never writes plaintext files to disk', () => {
  const scratchHome = mkdtempSync(join(tmpdir(), 'agy-secret-failclosed-'));
  try {
    // 1. Unsupported platform
    const unsupWrite = writeSecret('ai:openai', 'sk-never-disk', { platform: 'freebsd', home: scratchHome });
    assert.equal(unsupWrite.ok, false);
    assert.equal(unsupWrite.available, false);
    assert.equal(unsupWrite.reason, 'vault-unavailable');
    const unsupRead = readSecret('ai:openai', { platform: 'freebsd', home: scratchHome });
    assert.equal(unsupRead.ok, false);
    assert.equal(unsupRead.available, false);
    assert.equal(unsupRead.reason, 'vault-unavailable');
    assert.equal(unsupRead.value, '');

    // 2. Headless Linux without D-Bus / DISPLAY / WAYLAND_DISPLAY
    let spawnCalled = false;
    const headlessOpts = {
      platform: 'linux',
      wsl: false,
      home: scratchHome,
      env: {},
      runSpawn() { spawnCalled = true; return { status: 0 }; }
    };
    const headlessWrite = writeSecret('ai:openai', 'sk-never-disk', headlessOpts);
    assert.equal(headlessWrite.ok, false);
    assert.equal(headlessWrite.available, false);
    assert.equal(headlessWrite.reason, 'vault-unavailable');
    assert.equal(spawnCalled, false);

    // 3. Linux without secret-tool (ENOENT)
    const noToolOpts = {
      platform: 'linux',
      wsl: false,
      home: scratchHome,
      env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
      runSpawn: () => ({ status: null, error: Object.assign(new Error('spawn secret-tool ENOENT'), { code: 'ENOENT' }) })
    };
    assert.equal(writeSecret('ai:openai', 'sk-never-disk', noToolOpts).reason, 'vault-unavailable');
    assert.equal(readSecret('ai:openai', noToolOpts).reason, 'vault-unavailable');
    assert.equal(deleteSecret('ai:openai', noToolOpts).reason, 'vault-unavailable');

    // 4. macOS locked keychain (-25308 / interaction not allowed)
    const lockedMacOpts = {
      platform: 'darwin',
      home: scratchHome,
      runSpawn: () => ({ status: 36, stdout: '', stderr: 'security: SecKeychainItemCopyContent: User interaction is not allowed. (-25308)' })
    };
    const macWrite = writeSecret('ai:openai', 'sk-never-disk', lockedMacOpts);
    assert.equal(macWrite.ok, false);
    assert.equal(macWrite.available, false);
    assert.equal(macWrite.reason, 'vault-unavailable');
    const macRead = readSecret('ai:openai', lockedMacOpts);
    assert.equal(macRead.ok, false);
    assert.equal(macRead.available, false);
    assert.equal(macRead.reason, 'vault-unavailable');

    // 5. Windows / WSL2 with powershell.exe unavailable (ENOENT)
    const noPsOpts = {
      platform: 'win32',
      home: scratchHome,
      runSpawn: () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' }) })
    };
    assert.equal(writeSecret('ai:openai', 'sk-never-disk', noPsOpts).reason, 'vault-unavailable');
    assert.equal(readSecret('ai:openai', noPsOpts).reason, 'vault-unavailable');
    assert.equal(deleteSecret('ai:openai', noPsOpts).reason, 'vault-unavailable');

    // 6. Validation errors (empty secret, invalid scope)
    const validOpts = { platform: 'win32', runSpawn: () => ({ status: 0, stdout: '{"ok":true}\n', stderr: '' }) };
    assert.equal(writeSecret('ai:openai', '', validOpts).reason, 'invalid-value');
    assert.equal(readSecret('', validOpts).reason, 'invalid-scope');
    assert.equal(deleteSecret('bad\nscope', validOpts).reason, 'invalid-scope');

    // 7. Zero plaintext files created on disk in home directory!
    assert.deepEqual(readdirSync(scratchHome), []);
  } finally {
    rmSync(scratchHome, { recursive: true, force: true });
  }
});
