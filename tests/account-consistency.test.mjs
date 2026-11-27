import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountsStore } from '../lib/accounts.mjs';
import { parseCredentialWriterPids, runRelaunchJob, validateRelaunchJob } from '../scripts/relaunch-worker.mjs';

const alpha = {id:'a', email:'a@example.invalid', hash:'AAAAAAAAAAAA', refreshHash:'111111111111', exists:true};
const beta = {id:'b', email:'b@example.invalid', hash:'BBBBBBBBBBBB', refreshHash:'222222222222', exists:true};

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agy-consistency-'));
  t.after(() => rmSync(dir, { recursive:true, force:true }));
  const slots = new Map([[alpha.id, alpha], [beta.id, beta]]);
  const ops = [];
  const vault = { supported:true, backend:'win32-credman', active:alpha,
    inspectSaved:id => slots.get(id), inspectActive() { return this.active; },
    saveActiveTo(id, opts) { ops.push('backup:' + id); assert.equal(opts.expectedHash,this.active.hash); slots.set(id,this.active); return {ok:true,hash:this.active.hash}; },
    restoreToActive(id, opts) { ops.push('restore:' + id); assert.equal(opts.expectedHash,slots.get(id).hash); assert.equal(opts.expectedEmail,slots.get(id).email); this.active = slots.get(id); return {ok:true}; }
  };
  writeFileSync(join(dir,'accounts.json'), JSON.stringify({ activeId:'a', accounts:[alpha,beta].map(a=>({id:a.id,email:a.email,credHash:a.hash,refreshHash:a.refreshHash,hasCredential:true})) }));
  const state = () => JSON.parse(readFileSync(join(dir,'accounts.json'),'utf8'));
  const profile = join(dir, 'custom profile');
  mkdirSync(profile);
  const store = (lsAddress, relaunch) => createAccountsStore(dir, {vault, lsAddress, relaunch, userDataDir:profile, appStoragePath:''});
  return {dir, profile, slots, ops, vault, state, store};
}

test('Windows blocked or disabled restart leaves the active slot and reported account alone', async t => {
  const f = setup(t);
  const s = f.store('old', async () => ({scheduled:false,manualRestartRequired:true}));
  await assert.rejects(s.switchAccount('b'), /未执行凭据切换/);
  assert.throws(() => s.switchAccount('b',{triggerRelaunch:false}), /未执行凭据切换/);
  assert.equal(f.state().pendingSwitch,null);
  assert.equal(f.state().activeId,'a');
  assert.equal(f.vault.active,alpha);
  assert.ok(!f.ops.includes('restore:b'));
});

test('shared refresh fingerprint or unknown identity never overwrites a backup', t => {
  const f = setup(t);
  const s = f.store('old');
  for (const info of [{...alpha, refreshHash:beta.refreshHash,hash:'CCCCCCCCCCCC'}, {...alpha,email:''}]) {
    f.vault.active = info;
    assert.ok(s.syncActive({email:alpha.email}).credentialMismatch);
    assert.equal(f.ops.length,0);
  }
  f.slots.set('b',{...beta,refreshHash:alpha.refreshHash});
  assert.equal(s.refreshCredentials({accountId:'b'}).account.hasCredential,false);
  assert.throws(()=>s.switchAccount('b'), /重新登录/);
});

test('Windows worker gates restore and startup on writer exit, then wrong-session login quarantines the target', async t => {
  for (const mode of ['success','writer-timeout','unknown','restore-failed','cancelled','missing-profile','different-profile']) await t.test(mode, async t => {
    const f = setup(t);
    let credentialSwitch;
    const s = f.store('old', opts => { credentialSwitch = opts.credentialSwitch; return {scheduled:true}; });
    const sw = s.switchAccount('b');
    assert.equal(sw.activeId,'a');
    assert.ok(s.syncActive({email:alpha.email}).syncSkipped);
    assert.equal(f.vault.active,alpha);
    const target = join(f.dir,'Antigravity.exe'), jobPath = join(f.dir,'relaunch-job.json'), ackPath = join(f.dir,'relaunch-ack.json');
    writeFileSync(target,'');
    const scope = join(f.profile,'credential-user-scope');
    writeFileSync(scope,'mock');
    const explorerProfile = join(f.dir,'Antigravity');
    mkdirSync(explorerProfile);
    const explorerScope = join(explorerProfile,'credential-user-scope');
    writeFileSync(explorerScope,'keep');
    const profileDir = mode === 'different-profile' ? explorerProfile : mode === 'missing-profile' ? join(f.dir,'absent') : f.state().pendingSwitch.profileDir;
    const job = { format:1,nonce:'11111111-2222-3333-4444-555555555555',requestedAt:Date.now(),target,args:[],ackPath,credentialSwitch,profileDir };
    assert.equal(validateRelaunchJob({...job, credentialSwitch:{...credentialSwitch,extra:'unexpected'}},{jobPath}).valid,false);
    for (const invalid of [undefined,'relative']) assert.equal(validateRelaunchJob({...job,profileDir:invalid},{jobPath}).valid,false);
    writeFileSync(jobPath,JSON.stringify(job));
    if (mode === 'cancelled') writeFileSync(join(f.dir,'accounts.json'),JSON.stringify({...f.state(),pendingSwitch:null}));
    if (mode === 'restore-failed') f.vault.restoreToActive = () => ({ok:false});
    let n = 0;
    const result = await runRelaunchJob(jobPath,{vault:f.vault,env:{APPDATA:f.dir},
      listTargetPids:()=>{ assert.ok(!mode.endsWith('-profile')); return f.ops.includes('spawn') ? [11111] : []; }, gracefulClosePid:()=>assert.fail('unexpected close'), forceKillPid:()=>assert.fail('unexpected kill'), listWriterPids:()=>{
        if (mode === 'unknown') throw new Error('mock enumeration failed');
        if (mode === 'writer-timeout' || n++ === 0) { assert.equal(f.vault.active,alpha); return [123]; }
        return [];
      }, settleMs:0, postExitSettleMs:0, writerTimeoutMs:mode === 'writer-timeout' ? 0 : 2000, pollMs:1, verifyDelayMs:0,
      spawnProcess:(_target,_args,{env})=>{ assert.equal(env.ANTIGRAVITY_USER_DATA_DIR,profileDir); assert.equal(f.vault.active,beta); assert.equal(existsSync(scope),false); f.ops.push('spawn'); return {}; }
    });
    assert.equal(readFileSync(explorerScope,'utf8'),'keep');
    if (mode !== 'success') {
      assert.equal(result.ok,false);
      assert.equal(f.vault.active,alpha);
      assert.ok(!f.ops.includes('spawn'));
      assert.ok(existsSync(scope));
      assert.equal(JSON.parse(readFileSync(ackPath)).state,'failed');
      return;
    }
    assert.equal(result.ok,true);
    assert.deepEqual(f.ops,['backup:a','restore:b','spawn']);
    const newSession = f.store('new');
    const wrong = newSession.syncActive({email:alpha.email});
    assert.ok(wrong.credentialMismatch.afterSwitch);
    assert.equal(wrong.activeId,'a');
    assert.equal(f.state().pendingSwitch,null);
    assert.equal(newSession.refreshCredentials({accountId:'b'}).account.hasCredential,false);
    assert.throws(()=>newSession.switchAccount('b'), /隔离/);
    assert.deepEqual(f.ops,['backup:a','restore:b','spawn']);
    f.vault.active = {...beta,hash:'CCCCCCCCCCCC'};
    assert.throws(()=>newSession.completeAdd({email:beta.email,prevEmail:alpha.email,prevCredHash:alpha.hash}), /重新登录/);
    f.vault.active = {...beta,hash:'DDDDDDDDDDDD',refreshHash:'333333333333'};
    for (const email of [alpha.email,'']) {
      assert.throws(()=>newSession.completeAdd({email,prevEmail:alpha.email,prevCredHash:alpha.hash}),/重新登录/);
      assert.equal(f.slots.get('b'),beta);
      assert.equal(f.state().accounts.find(a=>a.id==='b').quarantined,true);
      assert.deepEqual(f.ops,['backup:a','restore:b','spawn']);
    }
    const fresh = f.store('new',()=>({scheduled:true})).completeAdd({email:beta.email,prevEmail:alpha.email,prevCredHash:alpha.hash});
    assert.equal(fresh.account.hasCredential,true);
    assert.equal(fresh.account.refreshHash,undefined);
    assert.equal(f.slots.get('b').hash,'DDDDDDDDDDDD');
  });
});

test('writer enumeration includes GUI, LS and CLI without treating diagnostics as an empty snapshot', () => {
  const rows = ['Antigravity.exe','language_server.exe','language_server_windows_x64.exe','agy.exe','node.exe'].map((name,i) => `"${name}","${i+10}","Console","1","200 K"`);
  assert.deepEqual(parseCredentialWriterPids(rows.join('\r\n'),10),[11,12,13]);
  for (const output of ['', 'diagnostic', rows[0]+'\ntruncated']) assert.throws(()=>parseCredentialWriterPids(output,10));
});
