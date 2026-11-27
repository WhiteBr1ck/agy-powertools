import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync,symlinkSync,unlinkSync,lstatSync,renameSync,realpathSync} from 'node:fs';
import {join,resolve,parse as parsePath} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {collectPackage,writePackage,encodePackage,decodePackage,validatePackage,sha256,releaseName} from '../lib/package.mjs';
import {installationPaths,maintenancePaths,installPlugin,uninstallPlugin,atomicJson,assertOwnedPath} from '../lib/lifecycle.mjs';
import {runUpdateJob,updateStatus,updateState,startUpdate} from '../lib/update-manager.mjs';
import {serveRuntime,stopRuntimes,waitForRuntime,runtimeRecords} from '../lib/runtime-control.mjs';
import {createPricingStore} from '../lib/pricing.mjs';

const original=collectPackage(resolve('.')),stop=async()=>{};
test('发布包排除本地字体验证记录和效果图目录', () => {
  assert.ok(!original.files.some(file => file.path.startsWith('docs/local-font/') || file.path.startsWith('docs/images/')));
});
function variant(version){const copy=structuredClone(original);copy.version=version;for(const file of copy.files){
  let text=Buffer.from(file.data,'base64').toString('utf8');
  if(['package.json','plugin.json','package-lock.json'].includes(file.path)){const value=JSON.parse(text);value.version=version;if(value.packages?.[''])value.packages[''].version=version;text=JSON.stringify(value);}
  if(file.path==='sidecars/inspector/sidecar.json'){const value=JSON.parse(text);value.env.AGY_POWERTOOLS_VERSION=version;text=JSON.stringify(value);}
  if(['lib/native-client.js','lib/native-ui.js'].includes(file.path))text=text.replaceAll(original.version,version);
  const bytes=Buffer.from(text);file.data=bytes.toString('base64');file.sha256=sha256(bytes);
}return validatePackage(copy);}
const older=variant('2.11.0'),newer=variant('2.14.0');
function sandbox(){const root=mkdtempSync(join(tmpdir(),'agy-lifecycle-')),home=join(root,'home'),paths=installationPaths(home);mkdirSync(join(paths.root,'config'),{recursive:true});atomicJson(paths.config,{plugins:{other:{enabled:true}},userSettings:{language:'zh-CN'},sidecars:{'other/tool':{keep:true}}});return{root,home,paths,clean:()=>rmSync(root,{recursive:true,force:true})};}

test('install replaces obsolete files, preserves settings and other plugins, and records a usable backup',async()=>{
  const s=sandbox();try{
    await installPlugin({bundle:older,home:s.home,stop});mkdirSync(s.paths.data,{recursive:true});const settings='{"language":"zh-CN","contextLimit":1000000}';writeFileSync(join(s.paths.data,'settings.json'),settings);writeFileSync(join(s.paths.installed,'obsolete.txt'),'old');
    const result=await installPlugin({bundle:original,home:s.home,stop});assert.equal(result.version,original.version);assert.ok(existsSync(join(result.backup,'obsolete.txt')));assert.equal(existsSync(join(s.paths.installed,'obsolete.txt')),false);assert.equal(readFileSync(join(s.paths.data,'settings.json'),'utf8'),settings);
    const config=JSON.parse(readFileSync(s.paths.config));assert.deepEqual(config.plugins.other,{enabled:true});assert.equal(config.userSettings.language,'zh-CN');assert.equal(config.plugins['agy-powertools'].enabled,true);
    assert.ok(!readdirSync(join(s.paths.root,'config','plugins')).some(name=>name.startsWith('.agy-powertools-stage')));
  }finally{s.clean();}
});

test('startup failure restores old plugin and original registration without changing chat data',async()=>{
  const s=sandbox();try{
    await installPlugin({bundle:older,home:s.home,stop});mkdirSync(join(s.paths.brain,'chat'),{recursive:true});writeFileSync(join(s.paths.brain,'chat','history.db'),'original chat');
    const before=readFileSync(join(s.paths.installed,'plugin.json'));await assert.rejects(()=>installPlugin({bundle:newer,home:s.home,stop,verify:async()=>{throw Error('startup failed');}}),error=>error.rolledBack===true);
    assert.deepEqual(readFileSync(join(s.paths.installed,'plugin.json')),before);assert.equal(JSON.parse(readFileSync(s.paths.config)).plugins['agy-powertools'].enabled,true);assert.equal(readFileSync(join(s.paths.brain,'chat','history.db'),'utf8'),'original chat');
  }finally{s.clean();}
});

test('purge removes owned files, runtime data and registration while preserving native chats and unrelated logs',async()=>{
  const s=sandbox();try{
    await installPlugin({bundle:original,home:s.home,stop});mkdirSync(s.paths.sidecars,{recursive:true});writeFileSync(join(s.paths.sidecars,'sidecar.log'),'plugin');
    const logs=join(s.paths.brain,'chat','.system_generated','logs');mkdirSync(logs,{recursive:true});writeFileSync(join(logs,'transcript.jsonl'),'native transcript');writeFileSync(join(logs,'powertools-telemetry.jsonl'),JSON.stringify({pluginId:'agy-powertools'}));writeFileSync(join(logs,'telemetry.jsonl'),JSON.stringify({belongs:'another plugin'}));
    atomicJson(s.paths.config,{plugins:{other:{enabled:true},'agy-powertools':{enabled:true}},sidecars:{'agy-powertools/inspector':{},'other/tool':{keep:true}},userSettings:{keep:true}});
    const result=await uninstallPlugin({home:s.home,stop});assert.equal(result.retained.length,1);assert.equal(existsSync(s.paths.installed),false);assert.equal(existsSync(s.paths.data),false);assert.equal(existsSync(s.paths.sidecars),false);assert.equal(existsSync(join(logs,'powertools-telemetry.jsonl')),false);assert.equal(readFileSync(join(logs,'transcript.jsonl'),'utf8'),'native transcript');assert.equal(existsSync(join(logs,'telemetry.jsonl')),true);
    const config=JSON.parse(readFileSync(s.paths.config));assert.equal(config.plugins['agy-powertools'],undefined);assert.deepEqual(config.plugins.other,{enabled:true});assert.equal(config.sidecars['agy-powertools/inspector'],undefined);assert.deepEqual(config.sidecars['other/tool'],{keep:true});assert.deepEqual(config.userSettings,{keep:true});
    await uninstallPlugin({home:s.home,stop});assert.equal(existsSync(s.paths.data),false);
  }finally{s.clean();}
});

test('keep-settings uninstall retains preferences and removes the installed plugin',async()=>{
  const s=sandbox();try{await installPlugin({bundle:original,home:s.home,stop});writeFileSync(join(s.paths.data,'settings.json'),'{}');await uninstallPlugin({home:s.home,purge:false,stop});assert.equal(existsSync(s.paths.installed),false);assert.equal(readFileSync(join(s.paths.data,'settings.json'),'utf8'),'{}');}finally{s.clean();}
});

test('legacy installer backups are purged only when registered and identified as this plugin',async()=>{
  const s=sandbox();try{
    const source=join(s.root,'source');writePackage(original,source);const owned=join(source,'.backups','installed-2026-11-15T00-00-00-000Z'),foreign=join(source,'.backups','installed-2026-11-14T00-00-00-000Z');mkdirSync(owned,{recursive:true});mkdirSync(foreign,{recursive:true});atomicJson(join(owned,'plugin.json'),{name:'agy-powertools'});atomicJson(join(foreign,'plugin.json'),{name:'other'});
    await installPlugin({source,home:s.home,stop});await uninstallPlugin({home:s.home,stop});assert.equal(existsSync(owned),false);assert.equal(existsSync(foreign),true);assert.equal(existsSync(join(source,'package.json')),true);
  }finally{s.clean();}
});

test('invalid package paths, checksums, versions and symlink destinations cannot overwrite other files',async()=>{
  const s=sandbox();try{
    for(const path of ['../outside','lib/../../outside','lib/CON','lib/x.','lib/C:\\outside']){const broken=structuredClone(original);broken.files[0].path=path;assert.throws(()=>validatePackage(broken));}
    const broken=structuredClone(original);broken.files[0].sha256='0'.repeat(64);assert.throws(()=>validatePackage(broken),/校验/);assert.throws(()=>decodePackage(encodePackage(original),'9.9.9'),/信息/);
    const external=join(s.root,'external');mkdirSync(external);mkdirSync(join(s.paths.root,'config','plugins'),{recursive:true});symlinkSync(external,s.paths.installed,process.platform==='win32'?'junction':'dir');
    await assert.rejects(()=>installPlugin({bundle:original,home:s.home,stop}),/符号链接/);assert.deepEqual(readdirSync(external),[]);
  }finally{s.clean();}
});

test('corrupt configuration is not overwritten during installation',async()=>{
  const s=sandbox();try{writeFileSync(s.paths.config,'{incomplete');await assert.rejects(()=>installPlugin({bundle:original,home:s.home,stop}));assert.equal(readFileSync(s.paths.config,'utf8'),'{incomplete');}finally{s.clean();}
});

test('verified update installs in a sandbox; bad downloads leave the existing version untouched',async()=>{
  const s=sandbox();try{
    await installPlugin({bundle:older,home:s.home,stop});const bytes=encodePackage(newer),job=join(s.paths.data,'jobs','test');mkdirSync(job,{recursive:true});
    const plan={format:1,home:s.home,version:newer.version,job,asset:{name:releaseName(newer.version),url:'https://github.com/test/project/releases/download/v2.14.0/package.bundle.gz',sha256:sha256(bytes)}};
    await runUpdateJob(plan,{fetcher:async()=>new Response(bytes),verify:async({paths,version})=>assert.equal(JSON.parse(readFileSync(join(paths.installed,'plugin.json'))).version,version)});
    assert.equal(updateStatus(s.home).status,'completed');assert.equal(existsSync(job),false);
    mkdirSync(job,{recursive:true});await assert.rejects(()=>runUpdateJob({...plan,asset:{...plan.asset,sha256:'0'.repeat(64)}},{fetcher:async()=>new Response(bytes),verify:async()=>{throw Error('should not install');}}),/校验/);assert.equal(JSON.parse(readFileSync(join(s.paths.installed,'plugin.json'))).version,newer.version);
  }finally{s.clean();}
});

test('update startup failure rolls back and reports rollback instead of success',async()=>{
  const s=sandbox();try{
    await installPlugin({bundle:older,home:s.home,stop});const bytes=encodePackage(newer),job=join(s.paths.data,'jobs','failure');mkdirSync(job,{recursive:true});
    await assert.rejects(()=>runUpdateJob({format:1,home:s.home,version:newer.version,job,asset:{name:releaseName(newer.version),url:'https://github.com/test/project/releases/download/v2.14.0/package.bundle.gz',sha256:sha256(bytes)}},{fetcher:async()=>new Response(bytes),verify:async()=>{throw Error('cannot start');}}));
    assert.equal(updateStatus(s.home).status,'rolled-back');assert.equal(JSON.parse(readFileSync(join(s.paths.installed,'plugin.json'))).version,older.version);
  }finally{s.clean();}
});

test('update preparation refuses unconfigured repositories and stale user-selected versions',async()=>{
  const s=sandbox();try{
    await assert.rejects(()=>startUpdate({home:s.home,currentVersion:original.version,expectedVersion:'2.14.0',project:{githubUrl:''}}),/版本/);
    assert.equal(existsSync(join(s.paths.data,'jobs')),false);
  }finally{s.clean();}
});

test('update handoff copies a self-contained helper and rejects concurrent jobs',async()=>{
  const s=sandbox();try{
    await installPlugin({bundle:older,home:s.home,stop});const bytes=encodePackage(newer),name=releaseName(newer.version);let captured;
    const fetcher=async()=>new Response(JSON.stringify({tag_name:'v'+newer.version,assets:[{name,state:'uploaded',digest:'sha256:'+sha256(bytes)}]}));
    const result=await startUpdate({home:s.home,currentVersion:older.version,expectedVersion:newer.version,project:{githubUrl:'https://github.com/test/project'},fetcher,launch:async(script,path)=>{captured={script,path};return process.pid;}});
    assert.equal(result.status,'preparing');assert.ok(existsSync(captured.script));assert.ok(captured.script.startsWith(join(s.paths.data,'jobs')));assert.ok(!captured.script.startsWith(s.paths.installed));
    await assert.rejects(()=>startUpdate({home:s.home,currentVersion:older.version,expectedVersion:newer.version,project:{githubUrl:'https://github.com/test/project'},fetcher}),/更新正在进行/);
    const plan=JSON.parse(readFileSync(captured.path));await runUpdateJob(plan,{fetcher:async()=>new Response(bytes),verify:async()=>{}});assert.equal(existsSync(join(s.paths.data,'update.lock')),false);
  }finally{s.clean();}
});

test('checksum-file fallback verifies the exact release asset and cleans partial jobs on error',async()=>{
  const s=sandbox();try{
    await installPlugin({bundle:older,home:s.home,stop});const bytes=encodePackage(newer),name=releaseName(newer.version),job=join(s.paths.data,'jobs','checksum');mkdirSync(job,{recursive:true});
    const plan={format:1,home:s.home,version:newer.version,job,asset:{name,url:'https://github.com/test/project/releases/download/v2.14.0/package.bundle.gz',checksumUrl:'https://github.com/test/project/releases/download/v2.14.0/package.bundle.gz.sha256'}};
    await runUpdateJob(plan,{fetcher:async url=>new Response(url.endsWith('.sha256')?sha256(bytes)+'  '+name+'\n':bytes),verify:async()=>{}});assert.equal(updateStatus(s.home).status,'completed');
    mkdirSync(job,{recursive:true});await assert.rejects(()=>runUpdateJob(plan,{fetcher:async()=>new Response(sha256(bytes)+'  another-file\n'),verify:async()=>{}}),/校验/);assert.equal(existsSync(job),false);
  }finally{s.clean();}
});

test('runtime shutdown uses a private local endpoint and never kills a process by stored pid',async()=>{
  const s=sandbox();let close,stopped=false,exited=false;try{
    const directory=join(s.paths.data,'runtime');close=await serveRuntime({directory,version:original.version,stop:async()=>{stopped=true;},health:async()=>({healthy:true}),exit:()=>{exited=true;}});
    const record=runtimeRecords(directory)[0];assert.equal((await fetch(`http://127.0.0.1:${record.port}/health`)).status,403);
    assert.equal((await waitForRuntime(directory,original.version,{timeout:1000})).healthy,true);
    await stopRuntimes(directory,{purge:true});assert.equal(stopped,true);assert.equal(exited,true);assert.equal(runtimeRecords(directory).length,0);
  }finally{await close?.();s.clean();}
});

test('Windows occupied working directories use verified file replacement and retain rollback support',{skip:process.platform!=='win32'},async()=>{
  const s=sandbox();let child;
  try{
    await installPlugin({bundle:older,home:s.home,stop});mkdirSync(join(s.paths.installed,'lib','type-change'));writeFileSync(join(s.paths.installed,'lib','type-change','old'),'old');
    child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:join(s.paths.installed,'sidecars','inspector'),windowsHide:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    const changed=structuredClone(original),data=Buffer.from('new file');changed.files.push({path:'lib/type-change',data:data.toString('base64'),sha256:sha256(data)});
    const result=await installPlugin({bundle:changed,home:s.home,stop});assert.equal(result.replacement,'in-place');assert.equal(readFileSync(join(s.paths.installed,'lib','type-change'),'utf8'),'new file');
    await assert.rejects(()=>installPlugin({bundle:newer,home:s.home,stop,verify:async()=>{throw Error('bad startup');}}),error=>error.rolledBack===true);
    assert.equal(JSON.parse(readFileSync(join(s.paths.installed,'plugin.json'))).version,original.version);
  }finally{if(child?.pid){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}s.clean();}
});

test('a separate update helper survives replacing its installed origin and confirms a restarted runtime',async()=>{
  const s=sandbox();let oldClose,newClose,timer,childPromise;
  try{
    await installPlugin({bundle:older,home:s.home,stop});const directory=join(s.paths.data,'runtime');
    oldClose=await serveRuntime({directory,version:older.version,stop:async()=>{},health:async()=>({healthy:true}),exit:()=>{}});
    const bytes=encodePackage(newer),fetchModule=join(s.root,'fake-github.mjs');
    writeFileSync(fetchModule,`const original=globalThis.fetch;globalThis.fetch=async(url,options)=>String(url).startsWith('https://github.com/test/project/releases/download/')?new Response(Buffer.from('${bytes.toString('base64')}','base64')):original(url,options);`);
    let starting=false;
    timer=setInterval(async()=>{try{if(!newClose&&!starting&&JSON.parse(readFileSync(join(s.paths.installed,'plugin.json'))).version===newer.version&&JSON.parse(readFileSync(s.paths.config)).plugins['agy-powertools'].enabled){starting=true;newClose=await serveRuntime({directory,version:newer.version,stop:async()=>{},health:async()=>({healthy:true}),exit:()=>{}});}}catch{}},25);
    const name=releaseName(newer.version);
    await startUpdate({home:s.home,currentVersion:older.version,expectedVersion:newer.version,project:{githubUrl:'https://github.com/test/project'},fetcher:async()=>new Response(JSON.stringify({tag_name:'v'+newer.version,assets:[{name,state:'uploaded',digest:'sha256:'+sha256(bytes)}]})),launch:async(script,plan)=>{
      const child=spawn(process.execPath,['--import',pathToFileURL(fetchModule).href,script,plan],{cwd:s.root,windowsHide:true,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>{error+=chunk;});childPromise=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(error||'worker failed')));});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});return child.pid;
    }});
    await childPromise;assert.equal(updateStatus(s.home).status,'completed');assert.equal(JSON.parse(readFileSync(join(s.paths.installed,'plugin.json'))).version,newer.version);assert.ok(newClose);assert.equal(readdirSync(join(s.paths.data,'jobs')).length,0);
  }finally{clearInterval(timer);await oldClose?.();await newClose?.();s.clean();}
});

test('packaged README files strip remote badge images for Antigravity plugin overview',()=>{
  for(const name of ['README.md','README_EN.md']){
    const entry=original.files.find(file=>file.path===name);
    assert.ok(entry);
    const text=Buffer.from(entry.data,'base64').toString('utf8');
    assert.equal(text.includes('img.shields.io'),false);
    assert.equal(text.includes('/badge.svg'),false);
    assert.equal(text.includes('plugin-badges:start'),false);
    assert.equal(text.includes('\u00b7'),false);
    assert.ok(text.includes(`v${original.version} | MIT License`));
  }
  assert.ok(readFileSync(resolve('README.md'),'utf8').includes('img.shields.io'));
});

test('package excludes docs/images screenshots, bootstrap copies all worker imports, updateStatus clears stale completed state (Issue #47), and waitForRuntime accepts booted sidecar without compat error', async () => {
  // 1. Package excludes docs/images/ so bundle.gz stays lightweight (~250KB instead of ~5MB)
  assert.equal(original.files.some(f => f.path.startsWith('docs/images/')), false);

  // 2. Every transitive local .mjs import of scripts/update-worker.mjs is included in update-manager bootstrap list
  const seen = new Set();
  const walk = rel => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = readFileSync(resolve(rel), 'utf8');
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const target = join(resolve(rel, '..'), m[1]);
      walk(target.slice(resolve('.').length + 1).replaceAll('\\', '/'));
    }
  };
  walk('scripts/update-worker.mjs');
  const umSrc = readFileSync(resolve('lib/update-manager.mjs'), 'utf8');
  for (const mod of seen) {
    if (mod.startsWith('lib/') && mod.endsWith('.mjs')) {
      const name = mod.slice(4, -4);
      assert.ok(umSrc.includes(`'${name}'`), `Missing lib/${name}.mjs in update-manager bootstrap copy list`);
    }
  }

  // 3. Issue #47: updateStatus auto-clears stale completed state once currentVersion >= recorded version, and external installPlugin clears stale state
  const s = sandbox();
  let close;
  try {
    mkdirSync(s.paths.data, { recursive: true });
    atomicJson(join(s.paths.data, 'update-state.json'), { status: 'completed', version: '2.15.1', at: Date.now() });
    assert.equal(updateStatus(s.home, '2.15.0').status, 'completed');
    assert.equal(updateStatus(s.home, '2.15.5').status, 'idle');
    assert.equal(existsSync(join(s.paths.data, 'update-state.json')), false);

    atomicJson(join(s.paths.data, 'update-state.json'), { status: 'completed', version: '2.15.1', at: Date.now() });
    await installPlugin({ bundle: original, home: s.home, stop });
    assert.equal(existsSync(join(s.paths.data, 'update-state.json')), false);

    // 4. waitForRuntime accepts a cleanly booted sidecar with healthy=false & no compatibilityError (e.g. awaiting debug port restart)
    const dir = join(s.paths.data, 'runtime');
    close = await serveRuntime({ directory: dir, version: original.version, stop: async () => {}, health: async () => ({ healthy: false, compatibilityError: '' }), exit: () => {} });
    const booted = await waitForRuntime(dir, original.version, { timeout: 4500 });
    assert.equal(booted.version, original.version);
  } finally {
    await close?.();
    s.clean();
  }
});

test('release includes locale modules, static Windows relaunch scripts, and omits localized repository guides', () => {
  const names = new Set(original.files.map(file=>file.path));
  for (const lang of ['index','fr','ja','ko','de','es','ru','vi','pt-BR']) assert.ok(names.has(`lib/locales/${lang}.mjs`));
  assert.ok(names.has('scripts/relaunch-worker.mjs'));
  assert.ok(names.has('scripts/relaunch-antigravity.cmd'));
  assert.ok(names.has('scripts/launch-macos.mjs'));
  assert.ok(![...names].some(name=>/^docs\/README_/.test(name)));
});

function relocateGemini(s){
  const target=join(s.root,'relocated gemini');
  renameSync(s.paths.root,target);
  symlinkSync(target,s.paths.root,process.platform==='win32'?'junction':'dir');
  return target;
}

test('Issue #96: Windows relocated .gemini junction supports install, update handoff, mid-operation TOCTOU pinning, and uninstall while rejecting inner/dangling/root links', { skip: process.platform !== 'win32' }, async () => {
  const s = sandbox();
  try {
    const targetGemini = relocateGemini(s);
    const marker = join(targetGemini, 'keep.txt');
    writeFileSync(marker, 'keep');

    // installationPaths keeps logical paths.root; maintenancePaths pins real destination
    const realTargetGemini = realpathSync.native ? realpathSync.native(targetGemini) : realpathSync(targetGemini);
    assert.equal(s.paths.root, join(resolve(s.home), '.gemini'));
    assert.equal(lstatSync(s.paths.root).isSymbolicLink(), true);
    assert.equal(maintenancePaths(s.home).root, realTargetGemini);

    // 1. Fresh install + startUpdate + runUpdateJob through .gemini junction succeed
    const installed = await installPlugin({ bundle: older, home: s.home, stop });
    assert.equal(installed.version, older.version);
    assert.equal(JSON.parse(readFileSync(join(targetGemini, 'config', 'plugins', 'agy-powertools', 'plugin.json'), 'utf8')).version, older.version);

    const bytes = encodePackage(newer), name = releaseName(newer.version);
    let plan;
    await startUpdate({
      home: s.home,
      currentVersion: older.version,
      expectedVersion: newer.version,
      project: { githubUrl: 'https://github.com/test/project' },
      fetcher: async () => Response.json({ tag_name: 'v' + newer.version, assets: [{ name, state: 'uploaded', digest: 'sha256:' + sha256(bytes) }] }),
      launch: async (script, file) => {
        assert.ok(existsSync(script));
        plan = JSON.parse(readFileSync(file, 'utf8'));
        return process.pid;
      }
    });
    assert.equal(plan.home, s.home);
    assert.equal(plan.expectedRoot, realTargetGemini);
    assert.equal(updateStatus(s.home).status, 'preparing');
    await runUpdateJob(plan, {
      fetcher: async () => new Response(bytes),
      verify: async ({ paths: p, version }) => {
        assert.equal(JSON.parse(readFileSync(join(p.installed, 'plugin.json'), 'utf8')).version, version);
      }
    });
    assert.equal(updateStatus(s.home).status, 'completed');
    assert.equal(existsSync(plan.job), false);
    assert.equal(JSON.parse(readFileSync(join(targetGemini, 'config', 'plugins', 'agy-powertools', 'plugin.json'), 'utf8')).version, newer.version);

    // 2. Mid-operation TOCTOU junction swap is caught by assertPinnedPath without touching swapped target
    const swappedTarget = join(s.root, 'swapped-gemini');
    mkdirSync(join(swappedTarget, 'config', 'plugins', 'agy-powertools'), { recursive: true });
    writeFileSync(join(swappedTarget, 'sentinel.txt'), 'untouched');
    await assert.rejects(() => installPlugin({
      bundle: original,
      home: s.home,
      stop: async () => {
        unlinkSync(s.paths.root);
        symlinkSync(swappedTarget, s.paths.root, 'junction');
      }
    }), /目录已更改/);
    assert.equal(readFileSync(join(swappedTarget, 'sentinel.txt'), 'utf8'), 'untouched');
    // Restore original junction and verify uninstall leaves junction + marker intact
    unlinkSync(s.paths.root);
    symlinkSync(targetGemini, s.paths.root, 'junction');

    const removed = await uninstallPlugin({ home: s.home, purge: true, stop });
    assert.equal(removed.removed, true);
    assert.equal(lstatSync(s.paths.root).isSymbolicLink(), true);
    assert.equal(readFileSync(marker, 'utf8'), 'keep');
    assert.equal(existsSync(s.paths.installed), false);
    assert.equal(existsSync(s.paths.data), false);
  } finally {
    s.clean();
  }
});

test('Issue #96 & PR #103: nested data links, home symlinks, dangling/volume-root links, and POSIX .gemini symlinks are strictly rejected', async () => {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';

  // 1. Nested data link (including updateStatus cleanup) stays strictly off limits on all platforms
  const s1 = sandbox();
  try {
    if (process.platform === 'win32') relocateGemini(s1);
    const external = join(s1.root, 'external');
    const stateFile = join(external, 'plugin_data', 'agy-powertools', 'update-state.json');
    atomicJson(stateFile, { status: 'completed', version: older.version });
    symlinkSync(external, join(s1.paths.root, 'antigravity'), linkType);
    assert.equal(updateStatus(s1.home, older.version).status, 'idle');
    assert.equal(existsSync(stateFile), true, 'updateStatus must not unlink through a nested symlink');
    assert.throws(() => updateState(s1.home, { status: 'preparing' }), /符号链接/);
    await assert.rejects(() => startUpdate({ home: s1.home }), /符号链接/);
    await assert.rejects(() => installPlugin({ bundle: older, home: s1.home, stop }), /符号链接/);
    await assert.rejects(() => uninstallPlugin({ home: s1.home, stop }), /符号链接/);
    assert.deepEqual(readdirSync(join(external, 'plugin_data', 'agy-powertools')), ['update-state.json']);
  } finally {
    s1.clean();
  }

  // 2. update worker rejects a linked ancestor before cleaning up its job
  const s2 = sandbox();
  try {
    const external = join(s2.root, 'external');
    const job = join(s2.paths.data, 'jobs', 'example');
    mkdirSync(join(external, 'plugin_data', 'agy-powertools', 'jobs', 'example'), { recursive: true });
    symlinkSync(external, join(s2.paths.root, 'antigravity'), linkType);
    await assert.rejects(() => runUpdateJob({ format: 1, home: s2.home, version: newer.version, asset: { name: 'bundle' }, job }), /符号链接/);
    assert.equal(existsSync(job), true);
  } finally {
    s2.clean();
  }

  // 3. Symlinked home directory is rejected by maintenancePaths / installPlugin
  const s3 = sandbox();
  try {
    const linkedHome = join(s3.root, 'linked-home');
    symlinkSync(s3.home, linkedHome, linkType);
    assert.throws(() => maintenancePaths(linkedHome), /符号链接/);
    await assert.rejects(() => installPlugin({ bundle: older, home: linkedHome, stop }), /符号链接/);
  } finally {
    s3.clean();
  }

  // 4. Direct assertOwnedPath allowRootLink checks (dangling, volume-root, inner link, strict default)
  const root = mkdtempSync(join(tmpdir(), 'agy-owned-link-'));
  try {
    const targetGemini = join(root, 'target-gemini');
    mkdirSync(join(targetGemini, 'config', 'plugins', 'agy-powertools'), { recursive: true });
    const home = join(root, 'home');
    mkdirSync(home, { recursive: true });
    const paths = installationPaths(home);
    symlinkSync(targetGemini, paths.root, linkType);
    assert.throws(() => assertOwnedPath(paths.root, paths.installed), /符号链接/);
    const innerExternal = join(root, 'inner-external');
    mkdirSync(innerExternal, { recursive: true });
    const innerLink = join(paths.installed, 'evil-link');
    symlinkSync(innerExternal, innerLink, linkType);
    assert.throws(() => assertOwnedPath(paths.root, join(innerLink, 'file.txt'), { allowRootLink: true }), /符号链接/);
    unlinkSync(innerLink);

    const danglingHome = join(root, 'dangling-home');
    mkdirSync(danglingHome, { recursive: true });
    const danglingPaths = installationPaths(danglingHome);
    symlinkSync(join(root, 'does-not-exist'), danglingPaths.root, linkType);
    assert.throws(() => assertOwnedPath(danglingPaths.root, danglingPaths.installed, { allowRootLink: true }), /符号链接/);
    unlinkSync(danglingPaths.root);

    const fsRootHome = join(root, 'fsroot-home');
    mkdirSync(fsRootHome, { recursive: true });
    const fsRootPaths = installationPaths(fsRootHome);
    const fsRoot = parsePath(resolve(root)).root;
    symlinkSync(fsRoot, fsRootPaths.root, linkType);
    try {
      assert.throws(() => assertOwnedPath(fsRootPaths.root, fsRootPaths.installed, { allowRootLink: true }), /根目录/);
      assert.throws(() => maintenancePaths(fsRootHome, { allowRootLink: true }), /根目录/);
    } finally {
      unlinkSync(fsRootPaths.root);
    }
    unlinkSync(paths.root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a POSIX .gemini symlink is still rejected', { skip: process.platform === 'win32' }, async () => {
  const s = sandbox();
  try {
    relocateGemini(s);
    await assert.rejects(() => installPlugin({ bundle: older, home: s.home, stop }), /符号链接/);
    await assert.rejects(() => uninstallPlugin({ home: s.home, stop }), /符号链接/);
    assert.throws(() => updateState(s.home, { status: 'preparing' }), /符号链接/);
    assert.equal(updateStatus(s.home).status, 'idle');
  } finally {
    s.clean();
  }
});

test('Issue #93 & PR #105: sidecar.json and update-manager explicitly disable NODE_USE_ENV_PROXY=0 so SOCKS5h proxies never crash bootstrap, and pricing store supports proxy-aware injectable fetcher', async () => {
  const sidecarCfg = JSON.parse(readFileSync(resolve('sidecars/inspector/sidecar.json'), 'utf8'));
  assert.equal(sidecarCfg.env?.NODE_USE_ENV_PROXY, '0');
  const umSrc = readFileSync(resolve('lib/update-manager.mjs'), 'utf8');
  assert.equal(/NODE_USE_ENV_PROXY\s*:\s*['"]1['"]/.test(umSrc), false);
  assert.match(umSrc, /NODE_USE_ENV_PROXY\s*:\s*['"]0['"]/);

  // Verify manifest env overrides an inherited NODE_USE_ENV_PROXY=1 + socks5h:// proxy cleanly
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/proxy|node_options/i.test(key)));
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createServer } from 'node:http';
    const server = createServer((_req, res) => res.end('local-cdp'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/json/list');
      console.log(await response.text());
    } finally { server.close(); }
  `], {
    env: {
      ...cleanEnv,
      NODE_USE_ENV_PROXY: '1',
      HTTP_PROXY: 'socks5h://127.0.0.1:1',
      HTTPS_PROXY: 'socks5h://127.0.0.1:1',
      ...sidecarCfg.env
    },
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true
  });
  assert.equal(probe.status, 0, probe.error?.message || probe.stderr);
  assert.equal(probe.stdout.trim(), 'local-cdp');

  const dir = mkdtempSync(join(tmpdir(), 'agy-pricing-fetch-'));
  try {
    const requested = [];
    const store = createPricingStore(dir, {
      fetcher: async (url, opts) => {
        requested.push({ url, opts });
        if (String(url).includes('aistudio.google.com')) {
          return {
            ok: true,
            status: 200,
            async text() {
              return '## Gemini 4 Neon {% id="gemini-4-neon" %}\n{% tab title="Standard" %}\n* Input price\n* $3.50\n---\n* Output price\n* $16.00\n---\n* Context caching price\n* $0.20\n---\n{% /tab %}';
            }
          };
        }
        return { ok: true, status: 200, async text() { return ''; } };
      }
    });
    const refreshed = await store.refresh();
    assert.equal(refreshed.status, 'live');
    assert.equal(requested.length, 2);
    assert.equal(requested[0].opts.timeoutMs, 10000);
    assert.equal(requested[1].opts.timeoutMs, 8000);
    const neon = refreshed.rates.find(r => r.model === 'gemini-4-neon');
    assert.equal(neon.input, 3.5);
    assert.equal(neon.output, 16);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
