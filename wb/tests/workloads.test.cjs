'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Workloads}=require('../src/workloads.js'),H=require('../src/desktop-host.js'),A=require('../src/study-adapter.js'),harness=require('./ui-harness.cjs');
const tick=()=>new Promise(setImmediate),copy=x=>JSON.parse(JSON.stringify(x)),secret='e'.repeat(64);
const fixture=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/native-reviewed-demo-result.json'),'utf8'));
function reply(v){const text=JSON.stringify(v);return {ok:true,headers:{get:()=>String(Buffer.byteLength(text))},text:async()=>text};}
function desktop({running=false,delay=false,offline=false}={}){
 const calls=[],raw=fixture(),health={format:'eightmax-desktop-health',version:1,appVersion:'0.16.0',build:A.ENGINE.build,nativeCPU:true,liveClientConnected:false,currentJob:true,cancelIntents:true,revisionedJobs:true},s={format:'eightmax-desktop-job',version:2,id:'a'.repeat(32),revision:1,stage:'training',running:true,resumable:false,resultAvailable:false,binding:raw.job.workbench,targetUpdates:raw.job.iterations,nativeStatus:null,message:'training'};
 const m={calls,release:null},current={format:'eightmax-desktop-current',version:1,job:running?raw.job:null,status:running?s:null};
 m.current=current;m.fetch=async(u,o)=>{calls.push({route:u.slice(H.ORIGIN.length),...o});if(offline)throw Error('host offline');if(u.endsWith('/health'))return reply(health);if(u.endsWith('/current'))return delay?new Promise(r=>m.release=()=>r(reply(m.current))):reply(m.current);throw Error('Unexpected mutation');};
 m.page={location:{origin:H.ORIGIN,hash:'#desktop-token='+secret,pathname:'/'},history:{replaceState(){}},sessionStorage:{getItem(){return null;},setItem(){}},fetch:m.fetch};return m;
}
function select(h,slot){h.get('study-slot').value=String(slot);h.get('study-slot').onchange();}
function snapshots(h){return copy(h.c.workbenchWorkloads.snapshot());}

test('ten browser study slots share ownership while exclusive workflows are refused',()=>{
 const w=new Workloads(),leases=[];for(let i=1;i<=10;i++)leases.push(w.acquire('study',i,'Queued'));assert.equal(w.snapshot().length,10);for(const mode of ['native','benchmark','diagnostics','images'])assert.throws(()=>w.acquire(mode,mode==='native'?1:null),/Stop CPU studies/);assert.equal(w.snapshot().length,10);for(const lease of leases)w.release(lease);assert.deepEqual(w.snapshot(),[]);
});
test('stale releases and forged tokens cannot remove a newer slot or exclusive owner',()=>{
 const w=new Workloads(),old=w.acquire('study',1),next=w.acquire('study',1);assert.equal(w.owns(old),false);assert.equal(w.release(old),false);assert.equal(w.release({id:next.id}),false);assert.equal(w.snapshot().length,1);w.clear('study');const benchmark=w.acquire('benchmark');assert.equal(w.release(next),false);assert.equal(w.owns(benchmark),true);
});
test('invalid ownership requests are atomic and snapshots contain no mutable leases',()=>{
 const w=new Workloads(),lease=w.acquire('study',2);for(const call of [()=>w.acquire('study',0),()=>w.acquire('study',11),()=>w.acquire('unknown'),()=>w.acquire('study',1,'x'.repeat(161))])assert.throws(call);const row=w.snapshot()[0];row.kind='native';row.phase='changed';assert.equal(w.snapshot()[0].kind,'study');assert.equal(w.snapshot()[0].phase,'Preparing');assert.deepEqual(Object.keys(row).sort(),['kind','label','phase','slot']);assert.equal(w.owns(lease),true);
});
test('a display failure cannot lose ownership and clearing one slot preserves other jobs',()=>{
 const w=new Workloads(()=>{throw Error('display');}),a=w.acquire('study',1),b=w.acquire('study',2);w.update(a,'Training · 100 updates');assert.equal(w.clear('study',1),1);assert.equal(w.owns(a),false);assert.equal(w.owns(b),true);assert.equal(w.update(a,'late'),false);assert.throws(()=>w.acquire('native',2));
});
test('the activity display shows queued slots and one running study worker',async()=>{
 const h=harness(),first=h.get('solve-study').click();select(h,2);const second=h.get('solve-study').click();assert.equal(h.workers.length,1);assert.match(h.get('compute-activity-list').innerHTML,/slot 1.*Running CPU worker/);assert.match(h.get('compute-activity-list').innerHTML,/slot 2.*Queued/);assert.equal(snapshots(h).length,2);h.c.stopStudies();await Promise.all([first,second]);assert.equal(h.workers[0].dead,true);assert.equal(snapshots(h).length,0);assert.match(h.get('compute-activity-status').textContent,/No managed/);
});
test('native preparation excludes studies, diagnostics, image validation and capacity workers before submission',async()=>{
 const m=desktop(),h=harness({page:m.page}),pending=h.get('desktop-run-native').click(),worker=h.workers[0];assert.equal(worker.data.mode,'native-job');await h.get('solve-study').click();await h.get('browser-checks').click();await h.get('run-benchmark').click();h.get('image-validation-demo').click();await h.get('image-validation-run').click();assert.equal(h.workers.length,1);assert.equal(worker.dead,undefined);assert.equal(m.calls.length,0);assert.equal(snapshots(h)[0].kind,'native');assert.match(h.get('image-validation-status').textContent,/managed native/);h.get('cancel-study').click();await pending;assert.equal(worker.dead,true);assert.equal(snapshots(h).length,0);
});
test('browser diagnostics retain ownership while studies and native work are refused',async()=>{
 const h=harness(),pending=h.get('browser-checks').click();await h.get('solve-study').click();await h.get('desktop-run-native').click();assert.equal(h.workers.length,1);assert.equal(snapshots(h)[0].kind,'diagnostics');assert.match(h.get('desktop-status').textContent,/browser checks/);h.c.cancelWorkspaceChecks();await pending;assert.equal(h.workers[0].dead,true);assert.equal(snapshots(h).length,0);
});
test('image validation cannot cancel a diagnostic worker, and runs after explicit diagnostic cancellation',async()=>{
 const h=harness();h.get('image-validation-demo').click();const pending=h.get('browser-checks').click();await h.get('image-validation-run').click();assert.match(h.get('image-validation-status').textContent,/browser checks/);assert.equal(h.workers[0].dead,undefined);h.c.cancelWorkspaceChecks();await pending;h.c.setTimeout=(fn,ms)=>{if(ms===0)fn();return 1;};await h.get('image-validation-run').click();assert.match(h.get('image-validation-status').textContent,/Validation finished/);assert.equal(snapshots(h).length,0);
});
test('starting capacity testing cancels ordinary queued studies without a stale release clearing its owner',async()=>{
 const h=harness(),first=h.get('solve-study').click();select(h,2);const second=h.get('solve-study').click(),benchmark=h.get('run-benchmark').click();await Promise.all([first,second]);assert.equal(h.workers[0].dead,true);assert.equal(h.workers.length,2);assert.equal(snapshots(h).length,1);assert.equal(snapshots(h)[0].kind,'benchmark');h.get('cancel-benchmark').click();await benchmark;assert.equal(snapshots(h).length,0);
});
test('browser checks can replace a capacity test without its late cleanup stopping the new worker',async()=>{
 const h=harness(),benchmark=h.get('run-benchmark').click(),diagnostic=h.get('browser-checks').click();await benchmark;assert.equal(h.workers.length,2);assert.equal(h.workers[0].dead,true);assert.equal(h.workers[1].dead,undefined);assert.equal(snapshots(h)[0].kind,'diagnostics');h.c.cancelWorkspaceChecks();await diagnostic;assert.equal(snapshots(h).length,0);
});
test('CPU checkpoint import is refused before reading a file during exclusive compute work',async()=>{
 const h=harness(),checks=h.get('browser-checks').click();let reads=0;h.get('cpu-checkpoint-file').files=[{size:10,arrayBuffer:async()=>{reads++;return new ArrayBuffer(10);}}];await h.get('cpu-checkpoint-file').onchange();assert.equal(reads,0);assert.match(h.get('cpu-checkpoint-status').textContent,/browser checks/);assert.equal(h.workers.length,1);h.c.cancelWorkspaceChecks();await checks;
});
test('a reload discovers host work before a browser study can allocate a worker',async()=>{
 const m=desktop({running:true}),h=harness({page:m.page});await h.get('solve-study').click();assert.equal(h.workers.length,0);assert.equal(m.calls.filter(c=>c.method==='POST').length,0);assert.ok(m.calls.some(c=>c.route.endsWith('/current')));assert.match(h.get('study-status').textContent,/recover or stop/);assert.match(h.get('compute-activity-list').innerHTML,/Managed native study/);assert.equal(h.c.workbenchDesktopNativeBusy(),true);assert.equal(snapshots(h).length,0);
});
test('capacity, image validation and diagnostics preflight a newly opened desktop session read-only',async()=>{
 for(const id of ['run-benchmark','image-validation-run','browser-checks']){const m=desktop({running:true}),h=harness({page:m.page});if(id==='image-validation-run')h.get('image-validation-demo').click();await h.get(id).click();assert.equal(h.workers.length,0,id);assert.equal(m.calls.filter(c=>c.method==='POST').length,0,id);assert.ok(m.calls.some(c=>c.route.endsWith('/current')),id);assert.equal(snapshots(h).length,0,id);assert.equal(h.c.workbenchBenchmarkBusy===true,false);assert.equal(h.c.workbenchImageValidationBusy===true,false);}
});
test('a slow native-idle preflight reserves compute and emergency Stop blocks a late worker start',async()=>{
 const m=desktop({delay:true}),h=harness({page:m.page}),study=h.get('solve-study').click();await tick();assert.ok(m.release);assert.equal(snapshots(h)[0].kind,'study');await h.get('desktop-run-native').click();assert.equal(h.workers.length,0);h.get('stop').click();m.release();await study;assert.equal(h.workers.length,0);assert.equal(snapshots(h).length,0);assert.equal(h.c.workbench.coordinator.stopped,true);
});
test('stopping a pending capacity preflight cannot resurrect its queue or clear a later owner',async()=>{
 const m=desktop({delay:true}),h=harness({page:m.page}),benchmark=h.get('run-benchmark').click();await tick();h.get('cancel-benchmark').click();const newer=h.c.workbenchWorkloads.acquire('diagnostics',null,'New owner');m.release();await benchmark;assert.equal(h.workers.length,0);assert.equal(h.c.workbenchWorkloads.owns(newer),true);h.c.workbenchWorkloads.release(newer);
});
test('cancelling browser diagnostics during preflight prevents any late diagnostic worker',async()=>{
 const m=desktop({delay:true}),h=harness({page:m.page}),checks=h.get('browser-checks').click();await tick();h.c.cancelWorkspaceChecks();m.release();await checks;assert.equal(h.workers.length,0);assert.equal(snapshots(h).length,0);assert.match(h.get('diagnostics-status').textContent,/cancelled/);
});
test('cancelling image validation during preflight prevents decoding and clears its owner',async()=>{
 const m=desktop({delay:true}),h=harness({page:m.page});h.get('image-validation-demo').click();const run=h.get('image-validation-run').click();await tick();h.c.stopImageValidation();m.release();await run;assert.equal(h.workers.length,0);assert.equal(snapshots(h).length,0);assert.equal(h.c.workbenchImageValidationBusy,false);assert.match(h.get('image-validation-status').textContent,/stopped/);
});
test('a disconnected host blocks compute startup and releases the failed reservation',async()=>{
 const m=desktop({offline:true}),h=harness({page:m.page});await h.get('solve-study').click();assert.equal(h.workers.length,0);assert.equal(snapshots(h).length,0);assert.match(h.get('study-status').textContent,/offline/);assert.equal(m.calls.length,1);
});
test('native recovery cannot replace a slot while another CPU study is active',async()=>{
 const m=desktop(),h=harness({page:m.page}),study=h.get('solve-study').click();await tick();assert.equal(h.workers.length,1);const raw=fixture(),record={format:'eightmax-desktop-current',version:1,job:raw.job,status:{format:'eightmax-desktop-job',version:2,id:'a'.repeat(32),revision:1,stage:'complete',running:false,resumable:false,resultAvailable:true,binding:raw.job.workbench,targetUpdates:raw.job.iterations,nativeStatus:null,message:'complete'}};
 m.current=record;const before=h.get('study-config').value;await h.get('desktop-find-native').click();await h.get('desktop-recover-native').click();assert.match(h.get('desktop-status').textContent,/CPU studies/);assert.equal(h.get('study-slot').value,'1');assert.equal(h.get('study-config').value,before);assert.equal(h.workers[0].dead,undefined);assert.equal(snapshots(h)[0].kind,'study');assert.equal(m.calls.filter(c=>c.method==='POST').length,0);
 h.get('cancel-study').click();await study;assert.equal(snapshots(h).length,0);
});
test('compute ownership is transient and excluded from saved workspace files',async()=>{
 const h=harness(),study=h.get('solve-study').click();await h.get('workspace-save').click();const text=await h.blobs.get(h.downloads.at(-1).href).text();assert.equal(text.includes('computeLease'),false);assert.equal(text.includes('workbenchWorkloads'),false);assert.equal(text.includes('Running CPU worker'),false);h.c.stopStudies();await study;
});
test('native restoring status must keep the original job target and bounded counters',()=>{
 const job=fixture().job,base={format:'eightmax-native-job-status',version:1,build:A.ENGINE.build,id:job.id,workbench:job.workbench,stage:'restoring',committedUpdates:0,targetUpdates:job.iterations,elapsedMs:1,message:'restoring',checkpoint:''},s={format:'eightmax-desktop-job',version:2,id:'a'.repeat(32),revision:2,stage:'restoring',running:true,resumable:false,resultAvailable:false,binding:job.workbench,targetUpdates:job.iterations,nativeStatus:base,message:'restoring'};assert.equal(H.status(s,job).nativeStatus.targetUpdates,job.iterations);assert.throws(()=>H.status({...s,nativeStatus:{...base,targetUpdates:50000}},job),/another job/);assert.throws(()=>H.status({...s,nativeStatus:{...base,committedUpdates:job.iterations+1}},job),/counters/);
});

test('Stop managed native study also cancels browser preparation before the host request exists',async()=>{
 const m=desktop(),h=harness({page:m.page}),pending=h.get('desktop-run-native').click(),worker=h.workers[0];assert.equal(snapshots(h)[0].kind,'native');await h.get('desktop-cancel-native').click();await pending;assert.equal(worker.dead,true);assert.equal(snapshots(h).length,0);assert.equal(m.calls.length,0);worker.result(fixture().job);await tick();assert.equal(h.get('study-results').innerHTML,'');assert.equal(m.calls.length,0);assert.match(h.get('study-status').textContent,/stop requested/);
});
