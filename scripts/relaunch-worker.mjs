import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NONCE_RE = /^[a-f0-9-]{16,64}$/i;
const JOB_TTL_MS = 60_000;
const TARGET_BASENAME_RE = /^antigravity\.exe$/i;
const ALLOWED_ARG_PATTERNS = [
  /^--remote-debugging-port=0$/,
  /^--proxy-server=(?:https?|socks5):\/\/[^\x00-\x1f\x7f\s'"`\\;$|&<>]{1,256}$/,
  /^--proxy-bypass-list=[^\x00-\x1f\x7f'"`\\$|&<>]{1,512}$/
];
const ALLOWED_PROXY_ENV_KEYS = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
  'AGY_POWERTOOLS_PROXY_SPEC',
  'GODEBUG'
]);
const PROXY_URL_VALUE_RE = /^(?:https?|socks5h?):\/\/[^\x00-\x1f\x7f\s'"`\\;$|&<>]{1,256}$/;
const NO_PROXY_VALUE_RE = /^[^\x00-\x1f\x7f'"`\\$|&<>]{0,512}$/;
const PROXY_SPEC_VALUE_RE = /^[^\x00-\x1f\x7f'"`\\$&<>]{1,768}$/;
const SAFE_EMAIL_RE = /^[^\s@"'`\\;|$<>]{1,120}@[^\s@"'`\\;|$<>]{1,120}\.[^\s@"'`\\;|$<>]{1,63}$/;
const SCRUB_ENV_EXACT = new Set([
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS',
  'ANTIGRAVITY_LS_ADDRESS',
  'ANTIGRAVITY_CSRF_TOKEN',
  'ANTIGRAVITY_AGENTAPI_EXE'
]);
const CLEAR_PROXY_ENV_UPPER = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'AGY_POWERTOOLS_PROXY_SPEC'
]);

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, Math.max(0, ms)));
}

function isInsideDir(baseDir, candidatePath) {
  if (!baseDir || !candidatePath || typeof candidatePath !== 'string') return false;
  if (/[\x00-\x1f\x7f]/.test(candidatePath)) return false;
  const resolvedBase = resolve(baseDir);
  const resolvedCandidate = resolve(candidatePath);
  const cmpBase = process.platform === 'win32' ? resolvedBase.toLowerCase() : resolvedBase;
  const cmpCand = process.platform === 'win32' ? resolvedCandidate.toLowerCase() : resolvedCandidate;
  const rel = relative(cmpBase, cmpCand);
  if (!rel || isAbsolute(rel)) return false;
  const segments = rel.split(/[\\/]+/);
  return segments.every(seg => seg && seg !== '.' && seg !== '..');
}

function atomicWriteJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(value) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(tmpPath, filePath);
  } finally {
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch {}
  }
}

function formatTimestamp(date = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function validateRelaunchJob(
  job,
  { jobPath = '', now = Date.now, exists = existsSync, allowAnyTargetForTest = false } = {}
) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    return { valid: false, reason: 'invalid-job-object' };
  }
  if (job.format !== 1) {
    return { valid: false, reason: 'invalid-format' };
  }
  if (typeof job.nonce !== 'string' || !NONCE_RE.test(job.nonce)) {
    return { valid: false, reason: 'invalid-nonce' };
  }
  const nowMs = typeof now === 'function' ? now() : Number(now);
  if (!Number.isFinite(job.requestedAt) || !Number.isFinite(nowMs) || Math.abs(nowMs - job.requestedAt) > JOB_TTL_MS) {
    return { valid: false, reason: 'expired-job' };
  }
  if (typeof job.target !== 'string' || !job.target.trim() || job.target.length > 512 || /[\x00-\x1f\x7f]/.test(job.target)) {
    return { valid: false, reason: 'invalid-target' };
  }
  if (!allowAnyTargetForTest && !TARGET_BASENAME_RE.test(win32.basename(job.target))) {
    return { valid: false, reason: 'disallowed-target' };
  }
  if (!exists(job.target)) {
    return { valid: false, reason: 'target-not-found' };
  }
  if (!Array.isArray(job.args) || job.args.length > 10) {
    return { valid: false, reason: 'invalid-args' };
  }
  for (const arg of job.args) {
    if (typeof arg !== 'string' || !ALLOWED_ARG_PATTERNS.some(re => re.test(arg))) {
      return { valid: false, reason: 'disallowed-arg' };
    }
  }
  if (job.proxyEnv !== undefined && job.proxyEnv !== null) {
    if (typeof job.proxyEnv !== 'object' || Array.isArray(job.proxyEnv)) {
      return { valid: false, reason: 'invalid-proxy-env' };
    }
    for (const [key, value] of Object.entries(job.proxyEnv)) {
      if (!ALLOWED_PROXY_ENV_KEYS.has(key)) {
        return { valid: false, reason: 'disallowed-env-key' };
      }
      if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) {
        return { valid: false, reason: 'invalid-env-value' };
      }
      if (key === 'GODEBUG') {
        if (value !== 'http2client=0') return { valid: false, reason: 'disallowed-godebug' };
      } else if (key === 'NO_PROXY' || key === 'no_proxy') {
        if (!NO_PROXY_VALUE_RE.test(value)) return { valid: false, reason: 'invalid-no-proxy' };
      } else if (key === 'AGY_POWERTOOLS_PROXY_SPEC') {
        if (!PROXY_SPEC_VALUE_RE.test(value)) return { valid: false, reason: 'invalid-proxy-spec' };
      } else {
        if (!PROXY_URL_VALUE_RE.test(value)) return { valid: false, reason: 'invalid-proxy-url' };
      }
    }
  }
  if (typeof job.ackPath !== 'string' || !job.ackPath.trim()) {
    return { valid: false, reason: 'invalid-ack-path' };
  }
  if (jobPath && !isInsideDir(dirname(resolve(jobPath)), job.ackPath)) {
    return { valid: false, reason: 'ack-path-traversal' };
  }
  if (job.logPath !== undefined && job.logPath !== null && job.logPath !== '') {
    if (typeof job.logPath !== 'string' || (jobPath && !isInsideDir(dirname(resolve(jobPath)), job.logPath))) {
      return { valid: false, reason: 'log-path-traversal' };
    }
  }
  if (job.onboardingSync !== undefined && job.onboardingSync !== null) {
    const sync = job.onboardingSync;
    if (typeof sync !== 'object' || Array.isArray(sync)) {
      return { valid: false, reason: 'invalid-onboarding-sync' };
    }
    if (typeof sync.email !== 'string' || !SAFE_EMAIL_RE.test(sync.email.trim())) {
      return { valid: false, reason: 'invalid-onboarding-email' };
    }
    if (sync.isGcpTos !== null && sync.isGcpTos !== undefined && typeof sync.isGcpTos !== 'boolean') {
      return { valid: false, reason: 'invalid-onboarding-tos' };
    }
    if (typeof sync.appStoragePath !== 'string' || !/^app_storage\.json$/i.test(win32.basename(sync.appStoragePath))) {
      return { valid: false, reason: 'invalid-onboarding-storage' };
    }
  }
  if (job.credentialSwitch !== undefined) {
    const sw = job.credentialSwitch;
    if (!sw || typeof sw !== 'object' || Object.keys(sw).length !== 4 ||
        typeof sw.accountId !== 'string' || !/^[\w-]{1,64}$/.test(sw.accountId) ||
        typeof sw.expectedEmail !== 'string' || !SAFE_EMAIL_RE.test(sw.expectedEmail) ||
        typeof sw.expectedHash !== 'string' || !/^[0-9a-f]{12}$/i.test(sw.expectedHash) ||
        typeof sw.switchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sw.switchId)) {
      return { valid: false, reason: 'invalid-credential-switch' };
    }
    if (typeof job.profileDir !== 'string' || !isAbsolute(job.profileDir) ||
        (job.onboardingSync && job.onboardingSync.appStoragePath !== join(job.profileDir, 'app_storage.json'))) {
      return { valid: false, reason: 'invalid-switch-profile' };
    }
  }
  return { valid: true };
}

export function parseTasklistPids(stdout, { excludePids = new Set() } = {}) {
  const pids = [];
  const seen = new Set();
  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^"antigravity\.exe","(\d+)"/i);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isInteger(pid) || pid <= 0 || excludePids.has(pid) || seen.has(pid)) continue;
    seen.add(pid);
    pids.push(pid);
  }
  return pids;
}

export function buildCleanTargetEnv(baseEnv, job) {
  const env = { ...(baseEnv || {}) };
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (SCRUB_ENV_EXACT.has(upper) || upper.startsWith('ANTIGRAVITY_SIDECAR_') || (job?.credentialSwitch && upper === 'ANTIGRAVITY_USER_DATA_DIR')) {
      delete env[key];
    }
  }
  if (job?.credentialSwitch) env.ANTIGRAVITY_USER_DATA_DIR = job.profileDir;
  if (job?.proxyEnabled) {
    if (job.proxyEnv && typeof job.proxyEnv === 'object') {
      for (const [key, value] of Object.entries(job.proxyEnv)) {
        if (typeof value === 'string') env[key] = value;
      }
    }
    if (!job.forceHttp1) {
      for (const key of Object.keys(env)) {
        if (key.toUpperCase() === 'GODEBUG' && env[key] === 'http2client=0') {
          delete env[key];
        }
      }
    }
  } else {
    const hasPluginProxySpec = Object.keys(env).some(
      key => key.toUpperCase() === 'AGY_POWERTOOLS_PROXY_SPEC' && Boolean(env[key])
    );
    if (hasPluginProxySpec) {
      for (const key of Object.keys(env)) {
        const upper = key.toUpperCase();
        if (CLEAR_PROXY_ENV_UPPER.has(upper) || (upper === 'GODEBUG' && env[key] === 'http2client=0')) {
          delete env[key];
        }
      }
    }
  }
  return env;
}

function defaultListAntigravityPids(excludePids) {
  const res = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    timeout: 8000
  });
  if (res.error || res.status !== 0) return [];
  return parseTasklistPids(res.stdout, { excludePids });
}

// Use an unfiltered CSV listing: an error, localized diagnostic or truncated row
// is not evidence that all writers exited. Observe LS/CLI; never kill them by name.
export function parseCredentialWriterPids(stdout, selfPid) {
  const lines = String(stdout || '').trim().split(/\r?\n/);
  const pids = [];
  for (const line of lines) {
    const match = /^"([^"]+)","(\d+)","[^"]*","\d+","[^"]*"$/.exec(line.trim());
    if (!match) throw new Error('process-list-unavailable');
    if (/^(?:antigravity|language_server(?:_windows(?:_[\w-]+)?)?|agy)\.exe$/i.test(match[1]) && +match[2] !== selfPid) pids.push(+match[2]);
  }
  return pids;
}

function defaultListWriterPids() {
  const res = spawnSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  if (res.error || res.status !== 0) throw new Error('process-list-unavailable');
  return parseCredentialWriterPids(res.stdout, process.pid);
}

function defaultGracefulClosePids(pids) {
  if (!pids?.length) return;
  try {
    spawnSync('taskkill.exe', pids.flatMap(pid => ['/PID', String(pid)]), {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5000
    });
  } catch {}
}

function defaultGracefulClosePid(pid) {
  defaultGracefulClosePids([pid]);
}

function defaultForceKillPid(pid) {
  try {
    process.kill(pid);
  } catch {}
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

export async function runRelaunchJob(jobPath, deps = {}) {
  if (!jobPath || typeof jobPath !== 'string' || !existsSync(jobPath)) {
    return { ok: false, reason: 'job-not-found' };
  }
  let job;
  try {
    job = JSON.parse(readFileSync(jobPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'job-parse-error' };
  }

  const now = deps.now || Date.now;
  const exists = deps.exists || existsSync;
  const allowAnyTargetForTest = Boolean(deps.allowAnyTargetForTest);
  const validation = validateRelaunchJob(job, { jobPath, now, exists, allowAnyTargetForTest });
  if (!validation.valid) {
    return { ok: false, reason: validation.reason };
  }

  const excludePids = new Set([process.pid, process.ppid].filter(n => Number.isInteger(n) && n > 0));
  const listTargetPids = deps.listTargetPids || (() => defaultListAntigravityPids(excludePids));
  const gracefulClosePid = deps.gracefulClosePid || defaultGracefulClosePid;
  const forceKillPid = deps.forceKillPid || defaultForceKillPid;
  const spawnProcess = deps.spawnProcess || spawn;
  const baseEnv = deps.env || process.env;
  const settleMs = deps.settleMs ?? 350;
  const gracefulTimeoutMs = deps.gracefulTimeoutMs ?? 3000;
  const forceTimeoutMs = deps.forceTimeoutMs ?? 6000;
  const postExitSettleMs = deps.postExitSettleMs ?? 450;
  const verifyDelayMs = deps.verifyDelayMs ?? 1200;
  const pollMs = deps.pollMs ?? 250;
  const leadingArgsForTest = Array.isArray(deps.leadingArgsForTest) ? deps.leadingArgsForTest : [];

  const appendLog = message => {
    if (!job.logPath) return;
    try {
      mkdirSync(dirname(job.logPath), { recursive: true });
      appendFileSync(job.logPath, `${formatTimestamp()} ${message}\n`, 'utf8');
    } catch {}
  };

  const sw = job.credentialSwitch;
  const stillRequested = () => {
    const state = JSON.parse(readFileSync(join(dirname(jobPath), 'accounts.json'), 'utf8'));
    const target = state.accounts.find(a => a.id === sw.accountId);
    return state.pendingSwitch?.switchId === sw.switchId && state.pendingSwitch.targetId === sw.accountId &&
      state.pendingSwitch.profileDir === job.profileDir &&
      target?.email === sw.expectedEmail && target.credHash === sw.expectedHash && !target.disabled && !target.quarantined;
  };
  const fail = reason => {
    appendLog(reason);
    try { atomicWriteJson(job.ackPath, { nonce: job.nonce, pid: process.pid, state: 'failed', failedSwitchId: sw?.switchId, reason, at: Date.now() }); } catch {}
    try { if (JSON.parse(readFileSync(jobPath, 'utf8')).nonce === job.nonce) unlinkSync(jobPath); } catch {}
    return { ok: false, reason };
  };

  // Explorer may start us with a different environment than the app. Only use
  // the canonical profile pinned by the initiating app and its pending intent.
  let verifiedProfile;
  if (sw) {
    try {
      const { verifiedSwitchProfileDir } = await import('../lib/paths.mjs');
      verifiedProfile = () => verifiedSwitchProfileDir(job.profileDir) === job.profileDir;
      if (!verifiedProfile() || !stillRequested()) return fail('switch-cancelled');
    } catch { return fail('invalid-switch-profile'); }
  }

  // 1. Immediately write ACK JSON atomically so the caller confirms AV/EDR did not block launch
  try {
    atomicWriteJson(job.ackPath, {
      nonce: job.nonce,
      pid: process.pid,
      state: 'ready',
      at: Date.now()
    });
  } catch (err) {
    appendLog(`ack write err: ${err?.message || err}`);
    if (sw) return fail('ack-write-failed');
  }
  appendLog(`worker started pid=${process.pid} ppid=${process.ppid}`);

  // 2. Brief settle pause so caller reads ACK before Antigravity begins closing
  await sleep(settleMs);
  if (sw) {
    try { if (!stillRequested()) return fail('switch-cancelled'); } catch { return fail('switch-cancelled'); }
  }

  // 3-4. Find running non-self Antigravity.exe PIDs and send graceful WM_CLOSE in a single taskkill.exe call (no /F)
  const initialPids = listTargetPids().filter(pid => !excludePids.has(pid));
  if (initialPids.length) {
    appendLog(`graceful close pids=${initialPids.join(',')}`);
    if (deps.gracefulClosePid) {
      for (const pid of initialPids) gracefulClosePid(pid);
    } else {
      defaultGracefulClosePids(initialPids);
    }
    const gracefulDeadline = Date.now() + gracefulTimeoutMs;
    while (Date.now() < gracefulDeadline) {
      if (listTargetPids().filter(pid => !excludePids.has(pid)).length === 0) break;
      await sleep(pollMs);
    }
  }

  // 5. Escalate any lingering non-self PIDs via Node built-in process.kill (TerminateProcess)
  const remainingPids = listTargetPids().filter(pid => !excludePids.has(pid));
  if (remainingPids.length) {
    appendLog(`force kill pids=${remainingPids.join(',')}`);
    for (const pid of remainingPids) {
      forceKillPid(pid);
    }
    const forceDeadline = Date.now() + forceTimeoutMs;
    while (Date.now() < forceDeadline) {
      if (listTargetPids().filter(pid => !excludePids.has(pid)).length === 0) break;
      await sleep(pollMs);
    }
  }

  await sleep(postExitSettleMs);

  if (sw) {
    try {
      // Resolve the backend first, then take the last process snapshot immediately before restore.
      const vault = deps.vault || (await import('../lib/credential-vault.mjs')).createCredentialVault();
      if (vault.backend !== 'win32-credman') return fail('unsupported-credential-backend');
      const listWriters = deps.listWriterPids || defaultListWriterPids;
      const deadline = Date.now() + (deps.writerTimeoutMs ?? 10000);
      while (listWriters().length) {
        if (Date.now() >= deadline) return fail('credential-writers-still-running');
        await sleep(pollMs);
      }
      if (!stillRequested() || !verifiedProfile()) return fail('switch-cancelled');
      if (!vault.restoreToActive(sw.accountId, { expectedEmail: sw.expectedEmail, expectedHash: sw.expectedHash })?.ok) return fail('credential-restore-failed');
      try { unlinkSync(join(job.profileDir, 'credential-user-scope')); } catch (err) { if (err.code !== 'ENOENT') return fail('scope-reset-failed'); }
      atomicWriteJson(job.ackPath, { nonce: job.nonce, pid: process.pid, state: 'restored', appliedSwitchId: sw.switchId, at: Date.now() });
    } catch { return fail('credential-switch-failed'); }
  }

  // 6. Post-exit atomic app_storage.json onboarding sync in pure Node.js
  if (job.onboardingSync?.appStoragePath && exists(job.onboardingSync.appStoragePath)) {
    const storagePath = job.onboardingSync.appStoragePath;
    try {
      const raw = readFileSync(storagePath, 'utf8');
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        obj['agy.onboarding.lastLoginUsername'] = job.onboardingSync.email.trim();
        if (typeof job.onboardingSync.isGcpTos === 'boolean') {
          obj['agy.onboarding.lastLoginIsGcpTos'] = String(job.onboardingSync.isGcpTos);
        }
        const tmpStorage = `${storagePath}.agy.tmp`;
        writeFileSync(tmpStorage, JSON.stringify(obj, null, 2), 'utf8');
        renameSync(tmpStorage, storagePath);
        appendLog('synced onboarding app_storage');
      }
    } catch (err) {
      appendLog(`onboarding sync err: ${err?.message || err}`);
    }
  }

  // 7. Build clean target env (scrubbing Electron/sidecar vars and applying/clearing proxy vars)
  const targetEnv = buildCleanTargetEnv(baseEnv, job);

  // 8. Spawn Antigravity.exe detached with NUL stdio so Windows Terminal / ConPTY never attaches
  const spawnArgs = [...leadingArgsForTest, ...job.args];
  appendLog(`spawning ${job.target} args=${JSON.stringify(job.args)}`);
  let child = null;
  let spawnError = null;
  try {
    child = spawnProcess(job.target, spawnArgs, {
      cwd: dirname(job.target),
      env: targetEnv,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child?.on?.('error', err => { spawnError = err; });
    child?.unref?.();
  } catch (err) {
    spawnError = err;
  }

  // 9. Verify launch, write final ACK JSON, append log, and delete ONLY relaunch-job.json
  await sleep(verifyDelayMs);
  let verified = false;
  if (!spawnError) {
    if (child?.pid && isPidAlive(child.pid)) {
      verified = true;
    } else if (!allowAnyTargetForTest) {
      verified = listTargetPids().filter(pid => !excludePids.has(pid)).length > 0;
    } else if (child?.pid) {
      verified = true;
    }
  }

  try {
    atomicWriteJson(job.ackPath, {
      nonce: job.nonce,
      pid: process.pid,
      childPid: child?.pid || null,
      state: 'launched',
      ...(sw ? { appliedSwitchId: sw.switchId } : {}),
      ok: verified,
      at: Date.now()
    });
  } catch {}
  appendLog(`done childPid=${child?.pid || 0} verified=${verified}${spawnError ? ` err=${spawnError.message}` : ''}`);

  try {
    if (existsSync(jobPath)) unlinkSync(jobPath);
  } catch {}

  return { ok: verified, childPid: child?.pid || null, verified };
}

function isSameModulePath(a, b) {
  if (!a || !b) return false;
  let ra = resolve(a);
  let rb = resolve(b);
  try { ra = realpathSync(ra); } catch {}
  try { rb = realpathSync(rb); } catch {}
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

const isDirectRun = isSameModulePath(process.argv[1], fileURLToPath(import.meta.url));
if (isDirectRun) {
  runRelaunchJob(process.argv[2]).then(
    res => { process.exitCode = res?.ok ? 0 : 1; },
    () => { process.exitCode = 1; }
  );
}
