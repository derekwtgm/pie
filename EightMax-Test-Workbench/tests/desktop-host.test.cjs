'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const H=require('../src/desktop-host.js'),A=require('../src/study-adapter.js'),N=require('../src/native-jobs.js'),Q=require('../src/reviewed-study.js'),E=require('./load-solver.cjs'),harness=require('./ui-harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x)),secret='c'.repeat(64),id='a'.repeat(32),tick=()=>new Promise(setImmediate);
const fixture=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/native-reviewed-demo-result.json'),'utf8'));
const health={format:'eightmax-desktop-health',version:1,appVersion:'0.14.0',build:A.ENGINE.build,nativeCPU:true,liveClientConnected:false};
function status(job,stage='complete'){return {format:'eightmax-desktop-job',version:1,id,stage,running:['starting','restoring','training','querying'].includes(stage),resumable:stage==='cancelled',resultAvailable:stage==='complete',binding:clone(job.workbench),targetUpdates:job.iterations,nativeStatus:null,message:stage};}
function response(value,ok=true,declared=null){const text=typeof value==='string'?value:JSON.stringify(value);return {ok,headers:{get:()=>declared===null?String(Buffer.byteLength(text)):String(declared)},text:async()=>text};}
function transport(stages=['complete']){const calls=[];let job=fixture().job,at=0,readyRaw=null;return {calls,set raw(v){readyRaw=v;},get job(){return job;},fetch:async(url,options)=>{const route=url.slice(H.ORIGIN.length);calls.push({route,...options});if(route==='/api/desktop/health')return response(health);if(route==='/api/native/jobs'){job=JSON.parse(options.body);at=0;return response(status(job,stages[at]));}if(route.endsWith('/cancel'))return response(status(job,'cancelled'));if(route.endsWith('/resume')){at=stages.length-1;return response(status(job,'complete'));}if(route.endsWith('/result')){const raw=readyRaw||fixture();raw.job=clone(job);return response(raw);}if(route==='/api/native/jobs/'+id){at=Math.min(at+1,stages.length-1);return response(status(job,stages[at]));}return response({error:'unexpected'},false);}};}
function client(t,extra={}){return new H.Client({token:secret,fetch:t.fetch,delay:async()=>{},...extra});}
function page(t){const session=new Map();return {location:{origin:H.ORIGIN,hash:'#desktop-token='+secret,pathname:'/'},history:{replaceState(){}},sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v)},fetch:t.fetch};}
async function ui(t=transport()){const h=harness({page:page(t)});h.get('observation-study-demo').click();h.get('observation-all').click();h.get('observation-history-to-study').click();return {t,h};}
async function finishWorker(h){const w=h.workers.at(-1),p=A.prepare(E,w.data.request),mapped=w.data.request.reviewed?Q.replay(E,p,w.data.request.reviewed):null;w.result(mapped?N.reviewedJob(E,p,mapped,w.data.id):A.nativeJob(p,w.data.id));await tick();}

test('desktop page context requires exact loopback origin and a private session token',()=>{
 assert.equal(H.fromPage({location:{origin:'file://',hash:'#desktop-token='+secret}}),null);assert.equal(H.fromPage({location:{origin:'https://example.invalid',hash:'#desktop-token='+secret}}),null);assert.throws(()=>new H.Client({origin:'http://localhost:48713',token:secret,fetch:async()=>{}}));assert.throws(()=>new H.Client({token:'wrong',fetch:async()=>{}}));const p=page(transport());let replaced=false;p.history.replaceState=()=>replaced=true;const c=H.fromPage(p);assert.ok(c);assert.equal(replaced,true);p.location.hash='';assert.ok(H.fromPage(p));
});
test('health checks do not start jobs and send session credentials only in same-origin headers',async()=>{
 const t=transport(),c=client(t);await c.connect();assert.equal(t.calls.length,1);const call=t.calls[0];assert.equal(call.route,'/api/desktop/health');assert.equal(call.headers['X-EightMax-Session'],secret);assert.equal(call.credentials,'omit');assert.equal(call.redirect,'error');assert.equal(call.mode,'same-origin');assert.equal(call.body,undefined);assert.equal(c.task,null);
});
test('wrong engine, live capability and malformed health replies are refused',async()=>{
 for(const change of [h=>h.build='other',h=>h.liveClientConnected=true,h=>h.nativeCPU=false,h=>h.version=2]){const h=clone(health);change(h);const c=client({fetch:async()=>response(h)});await assert.rejects(c.connect(),/Unsupported/);assert.equal(c.connected,false);}
});
test('native desktop status is bound to the request and rejects contradictory stages',()=>{
 const job=fixture().job;for(const change of [s=>s.id='bad',s=>s.binding.token='old',s=>s.targetUpdates--,s=>s.running=true,s=>s.resultAvailable=false,s=>s.stage='unknown']){const s=status(job);change(s);assert.throws(()=>H.status(s,job,id));}
});
test('client progresses a mocked native job and validates the complete bound result',async()=>{
 const t=transport(['starting','training','querying','complete']),c=client(t),seen=[],job=fixture().job,raw=await c.run(job,s=>seen.push(s.stage));assert.deepEqual(seen,['starting','training','querying','complete']);N.same(job,raw.job,job.workbench.slot);assert.equal(N.result(raw).reviewedNode.path,'r1');assert.equal(c.task,null);assert.ok(t.calls.every(c=>!c.route.includes(secret)));
});
test('wrong-result bindings are refused and cancellation is attempted',async()=>{
 const t=transport(),base=t.fetch;t.fetch=async(u,o)=>{const r=await base(u,o);if(u.endsWith('/result')){const raw=fixture();raw.job.workbench.token='old';return response(raw);}return r;};const c=client(t);await assert.rejects(c.run(fixture().job),/latest exported/);assert.ok(t.calls.some(x=>x.route.endsWith('/cancel')));assert.equal(c.task,null);
});
test('simultaneous submissions cannot pass through the connection gap',async()=>{
 const t=transport();let release;const c=client({...t,fetch:async(u,o)=>u.endsWith('/health')?new Promise(r=>release=()=>r(response(health))):t.fetch(u,o)}),first=c.run(fixture().job);await assert.rejects(c.run(fixture().job),/already active/);release();await first;assert.equal(t.calls.filter(c=>c.route==='/api/native/jobs').length,1);
});
test('cancellation while submission is in flight cancels the newly acknowledged native job',async()=>{
 const t=transport(['starting']);let release;const base=t.fetch;t.fetch=async(u,o)=>u.endsWith('/jobs')?new Promise(r=>release=async()=>r(await base(u,o))):base(u,o);const c=client(t);await c.connect();const pending=c.run(fixture().job),rejected=assert.rejects(pending,/cancelled/);await tick();await c.cancel();release();await rejected;assert.ok(t.calls.some(c=>c.route.endsWith('/cancel')));assert.equal(c.task,null);
});
test('cancellation before connection completes never submits native work',async()=>{
 let release;const t=transport(),c=client({...t,fetch:async(u,o)=>u.endsWith('/health')?new Promise(r=>release=()=>r(response(health))):t.fetch(u,o)}),pending=c.run(fixture().job),rejected=assert.rejects(pending,/cancelled/);await c.cancel();release();await rejected;assert.equal(t.calls.length,0);
});
test('cancelling one study slot does not cancel another slot and resume keeps the binding',async()=>{
 const t=transport(['training']);let wait;const c=client(t,{delay:()=>new Promise(r=>wait=r)});await c.connect();const pending=c.run(fixture().job),rejected=assert.rejects(pending,/cancelled/);await tick();assert.equal(await c.cancel(1),false);assert.equal(await c.cancel(2),true);wait();await rejected;assert.equal(c.last.status.resumable,true);const raw=await c.run(c.last.job,()=>{},true);assert.equal(raw.query.node.actor,1);assert.ok(t.calls.some(x=>x.route.endsWith('/resume')));const changed=clone(c.last.job);changed.workbench.token='new';await assert.rejects(c.run(changed,()=>{},true),/compatible/);
});
test('connection failures report when native cancellation cannot be confirmed',async()=>{
 let calls=0;const job=fixture().job,c=client({fetch:async(u)=>{if(u.endsWith('/health'))return response(health);if(++calls===1)return response(status(job,'training'));throw Error('connection lost');}});await assert.rejects(c.run(job),/cancellation could not be confirmed/);assert.equal(c.task,null);
});
test('deadline expiry requests cancellation and preserves the last managed checkpoint status',async()=>{
 const t=transport(['training']);let time=0;const c=client(t,{now:()=>time+=100,timeoutMs:150});await assert.rejects(c.run(fixture().job),/deadline/);assert.ok(t.calls.some(x=>x.route.endsWith('/cancel')));assert.equal(c.last.status.resumable,true);
});
test('desktop request and response file limits and route allow-list are enforced',async()=>{
 const c=client(transport());await assert.rejects(c.call('/api/anything'),/Unknown/);await assert.rejects(c.call('/api/native/jobs','POST',{extra:'x'.repeat(1000001)}),/1 MB/);const large=client({fetch:async()=>response('{}',true,N.MAX_RESULT_BYTES+1)});await assert.rejects(large.connect(),/6 MB/);const bad=client({fetch:async()=>response('invalid')});await assert.rejects(bad.connect(),/invalid JSON/);
});
test('portable page explains the desktop launcher and does not probe localhost',async()=>{
 const h=harness();assert.match(h.get('desktop-status').textContent,/START-DESKTOP/);await h.get('desktop-connect').click();assert.match(h.get('desktop-status').textContent,/START-DESKTOP/);await h.get('desktop-run-native').click();assert.equal(h.workers.length,0);assert.match(h.get('study-status').textContent,/START-DESKTOP/);
});
test('dashboard submits reviewed native work and receives its validated result without file exchange',async()=>{
 const {t,h}=await ui(),pending=h.get('desktop-run-native').click();assert.equal(h.workers.at(-1).data.mode,'native-review-job');await finishWorker(h);await pending;assert.match(h.get('reviewed-position-results').innerHTML,/Native CPU/);assert.match(h.get('reviewed-position-results').innerHTML,/Original seat 1/);assert.equal(h.downloads.length,0);assert.equal(h.c.workbench.coordinator.totalActions,0);await h.get('workspace-save').click();const json=await h.blobs.get(h.downloads.at(-1).href).text();assert.equal(json.includes(secret),false);assert.ok(t.calls.some(c=>c.route.endsWith('/result')));
});
test('input changes cancel in-flight managed work and block late policy commits',async()=>{
 const t=transport();let release;const base=t.fetch;t.fetch=async(u,o)=>u.endsWith('/result')?new Promise(r=>release=async()=>r(await base(u,o))):base(u,o);const {h}=await ui(t);const pending=h.get('desktop-run-native').click();await finishWorker(h);await tick();assert.ok(release);h.get('study-config').value='{later';h.get('study-config').oninput();await tick();release();await pending;assert.equal(h.get('study-config').value,'{later');assert.equal(h.get('reviewed-position-results').innerHTML,'');assert.ok(t.calls.some(x=>x.route.endsWith('/cancel')));
});
test('browser emergency stop cancels managed native work and rejects its late result',async()=>{
 const t=transport();let release;const base=t.fetch;t.fetch=async(u,o)=>u.endsWith('/result')?new Promise(r=>release=async()=>r(await base(u,o))):base(u,o);const {h}=await ui(t),pending=h.get('desktop-run-native').click();await finishWorker(h);await tick();assert.ok(release);await h.get('run-benchmark').click();assert.match(h.get('benchmark-status').textContent,/managed native/);assert.equal(h.workers.length,1);h.get('stop').click();await tick();release();await pending;assert.equal(h.c.workbench.coordinator.stopped,true);assert.equal(h.get('reviewed-position-results').innerHTML,'');assert.ok(t.calls.some(x=>x.route.endsWith('/cancel')));
});
test('integrated native root jobs preserve the version-1 result route',async()=>{
 const {t,h}=await ui(),raw=fixture();raw.version=1;raw.query=raw.rootQuery;delete raw.rootQuery;t.raw=raw;h.get('clear-reviewed-position').click();const pending=h.get('desktop-run-native').click();assert.equal(h.workers.at(-1).data.mode,'native-job');await finishWorker(h);await pending;assert.equal(t.job.version,1);assert.match(h.get('study-results').innerHTML,/native-cli-cpu/);assert.equal(h.get('reviewed-position-results').innerHTML,'');
});
test('new desktop controls exist in generated markup and portable exports still work',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../START.html'),'utf8');for(const id of ['desktop-connect','desktop-run-native','desktop-resume-native','desktop-cancel-native','desktop-status'])assert.ok(html.includes('id="'+id+'"'),id);const h=harness();assert.equal(typeof h.get('export-native-job').onclick,'function');assert.equal(typeof h.get('cpu-continue').onclick,'function');
});
test('Windows desktop package supplies first-run compilation, install/uninstall and real acceptance paths',()=>{
 const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');for(const f of ['START-DESKTOP.cmd','INSTALL-WINDOWS.cmd','UNINSTALL-WINDOWS.cmd','RUN-DESKTOP-CHECKS.cmd','desktop/DesktopHost.cs','windows/Start-Desktop.ps1','windows/Install-Workbench.ps1','windows/Test-Desktop.ps1'])assert.ok(fs.existsSync(path.join(root,f)),f);
 assert.match(read('windows/Start-Desktop.ps1'),/CompileAssemblyFromSource/);assert.match(read('windows/Start-Desktop.ps1'),/platform:x64/);assert.match(read('windows/Install-Workbench.ps1'),/HKCU:/);assert.match(read('windows/Install-Workbench.ps1'),/NativeJobs, Diagnostics, browser recovery and saved study files were preserved/);assert.match(read('windows/Test-Desktop.ps1'),/Managed reviewed CPU workflow/);assert.match(read('windows/Test-Desktop.ps1'),/Native resume to cumulative target/);assert.match(read('desktop/DesktopHost.cs'),/IPAddress.Loopback/);assert.match(read('desktop/DesktopHost.cs'),/0x2000/);assert.match(read('desktop/DesktopHost.cs'),/0x08000004/);assert.match(read('desktop/DesktopHost.cs'),/AssignProcessToJobObject/);assert.match(read('native/Run-Native-Study.ps1'),/\[switch\]\$Headless/);
});
