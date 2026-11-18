'use strict';
// Protocol model and in-memory UI tests. These do not execute the C# Windows host.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const H=require('../src/desktop-host.js'),A=require('../src/study-adapter.js'),N=require('../src/native-jobs.js'),harness=require('./ui-harness.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),secret='d'.repeat(64),tick=()=>new Promise(setImmediate);
const fixture=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/native-reviewed-demo-result.json'),'utf8'));
const health={format:'eightmax-desktop-health',version:1,appVersion:'0.15.0',build:A.ENGINE.build,nativeCPU:true,liveClientConnected:false,currentJob:true,cancelIntents:true,revisionedJobs:true,idempotentJobs:true,maxBindings:256,maxRevision:256};
const key=j=>j.workbench.slot+':'+j.workbench.token;
function status(job,stage='complete',rev=1,id='a'.repeat(32)){return {format:'eightmax-desktop-job',version:2,id,revision:rev,stage,running:['starting','restoring','training','querying'].includes(stage),resumable:['cancelled','failed'].includes(stage),resultAvailable:stage==='complete',binding:copy(job.workbench),targetUpdates:job.iterations,nativeStatus:null,message:stage};}
function response(v,code=200){const text=JSON.stringify(v);return {ok:code<400,status:code,headers:{get:()=>String(Buffer.byteLength(text))},text:async()=>text};}
function host({stage='complete'}={}){
 const m={record:null,starts:0,serial:0,calls:[],ledger:new Map(),fences:new Set()};
 m.envelope=()=>({format:'eightmax-desktop-current',version:1,job:m.record?copy(m.record.job):null,status:m.record?copy(m.record.status):null});
 m.seed=(job=fixture().job,s=stage,rev=1)=>{m.record={job:copy(job),status:status(job,s,rev,(++m.serial).toString(16).padStart(32,'0'))};m.ledger.set(key(job),A.canonical(job));return copy(m.record);};
 m.fetch=async(url,o)=>{
  const route=url.slice(H.ORIGIN.length),body=o.body?JSON.parse(o.body):null;m.calls.push({route,...o});
  if(o.headers['X-EightMax-Session']!==secret)return response({error:'session'},403);
  if(route==='/api/desktop/health')return response(health);
  if(route==='/api/native/current')return response(m.envelope());
  if(route==='/api/native/jobs'||route==='/api/native/cancel-intent'){
   const job=N.job(body),k=key(job),hash=A.canonical(job),known=m.ledger.has(k);if(known&&m.ledger.get(k)!==hash)return response({error:'binding already used for different job settings'},409);
   if(route.endsWith('cancel-intent')){
    const r=Number(o.headers['X-EightMax-Revision']);if(!Number.isInteger(r)||r<1||r>256)return response({error:'revision'},400);
    if(!known&&m.ledger.size<256)m.ledger.set(k,hash);if(m.ledger.has(k))m.fences.add(k+'@'+r);
    if(m.record&&key(m.record.job)===k){const s=m.record.status;if(s.revision===r&&s.running)m.record.status=status(job,'cancelled',r,s.id);else if(s.revision+1===r&&s.resumable)m.record.status=status(job,'cancelled',r,s.id);}
    return response({format:'eightmax-desktop-cancel-intent',version:1,binding:job.workbench,revision:r,fenced:true,current:m.envelope()});
   }
   if(known){if(m.record&&key(m.record.job)===k)return response(m.record.status);return response({error:'older or cancelled submission'},409);}
   if(m.ledger.size>=256)return response({error:'ledger is full'},503);m.ledger.set(k,hash);
   if(m.record?.status.running){m.fences.add(k+'@1');return response({error:'already running'},409);}
   m.starts++;m.record={job:copy(job),status:status(job,stage,1,(++m.serial).toString(16).padStart(32,'0'))};return response(m.record.status,202);
  }
  const prefix=m.record?'/api/native/jobs/'+m.record.status.id:'';
  if(m.record&&route===prefix&&o.method==='GET')return response(m.record.status);
  if(m.record&&route===prefix+'/result'){if(m.record.status.stage!=='complete')return response({error:'not complete'},409);const raw=fixture();raw.job=copy(m.record.job);return response(raw);}
  if(m.record&&route===prefix+'/cancel'){
   if(body?.revision!==m.record.status.revision)return response({error:'attempt changed'},409);
   if(m.record.status.running)m.record.status=status(m.record.job,'cancelled',body.revision,m.record.status.id);return response(m.record.status);
  }
  if(m.record&&route===prefix+'/resume'){
   const s=m.record.status;if(body?.revision+1===s.revision)return response(s);
   if(body?.revision!==s.revision||!s.resumable||s.revision>=256)return response({error:'no unchanged checkpoint'},409);
   if(m.fences.has(key(m.record.job)+'@'+(s.revision+1)))m.record.status=status(m.record.job,'cancelled',s.revision+1,s.id);
   else{m.starts++;m.record.status=status(m.record.job,stage,s.revision+1,s.id);}return response(m.record.status,202);
  }
  return response({error:'unknown route'},404);
 };return m;
}
const client=(m,extra={})=>new H.Client({token:secret,fetch:m.fetch,delay:async()=>{},...extra});
function page(m){return {location:{origin:H.ORIGIN,hash:'#desktop-token='+secret,pathname:'/'},history:{replaceState(){}},sessionStorage:{getItem(){return null;},setItem(){}},fetch:m.fetch};}
const mutations=m=>m.calls.filter(c=>c.method==='POST');

test('recovery discovery is read only, handles an empty host and validates both record halves',async()=>{
 const m=host(),c=client(m);assert.equal(await c.findCurrent(),null);assert.equal(mutations(m).length,0);assert.equal(c.busy,false);
 const r=m.seed();assert.deepEqual(await c.findCurrent(),r);assert.equal(mutations(m).length,0);
 for(const bad of [{...m.envelope(),job:null},{...m.envelope(),extra:true},{...m.envelope(),status:{...r.status,revision:0}},{...m.envelope(),status:{...r.status,targetUpdates:2}}])assert.throws(()=>H.current(bad));
});
test('reloading a client recovers a completed reviewed result without submitting or resuming',async()=>{
 const m=host(),first=client(m);await first.run(fixture().job);const before=mutations(m).length,c=client(m),found=await c.findCurrent(),r=await c.attach(found);
 assert.equal(r.status.revision,1);assert.equal(N.result(r.result).reviewedNode.path,'r1');assert.equal(m.starts,1);assert.equal(mutations(m).length,before);assert.equal(c.busy,false);
});
test('recovering a running job polls to completion and does not restart training',async()=>{
 const m=host();m.seed(fixture().job,'training');const c=client(m,{delay:async()=>{m.record.status=status(m.record.job,'complete',1,m.record.status.id);}}),r=await c.attach(await c.findCurrent());assert.ok(r.result);assert.equal(m.starts,0);assert.equal(mutations(m).length,0);
});
test('interrupted and failed studies are adopted without training; continuation remains explicit',async()=>{
 for(const stopped of ['cancelled','failed']){const m=host();m.seed(fixture().job,stopped,3);const c=client(m),r=await c.attach(await c.findCurrent());assert.equal(r.result,null);assert.equal(c.last.status.resumable,true);assert.equal(mutations(m).length,0);await c.run(c.last.job,()=>{},true);assert.equal(m.starts,1);assert.equal(c.last.status.revision,4);const resume=mutations(m)[0];assert.deepEqual(JSON.parse(resume.body),{revision:3});}
});
test('idempotent submissions accept reordered fields and refuse changes under the same binding',async()=>{
 const m=host(),c=client(m),j=fixture().job,s=await c.call('/api/native/jobs','POST',j);const reordered=Object.fromEntries(Object.entries(j).reverse());assert.deepEqual(await c.call('/api/native/jobs','POST',reordered),s);assert.equal(m.starts,1);const changed=copy(j);changed.threads=1;await assert.rejects(c.call('/api/native/jobs','POST',changed),/different job/);assert.equal(m.starts,1);
});
test('a lost submission reply fences and cancels work without retrying the training request',async()=>{
 const m=host({stage:'training'}),base=m.fetch;m.fetch=async(u,o)=>{const r=await base(u,o);if(u.endsWith('/jobs'))throw Error('reply lost');return r;};const c=client(m);await assert.rejects(c.run(fixture().job),/reply lost/);assert.equal(m.starts,1);assert.equal(m.record.status.running,false);assert.equal(m.calls.filter(x=>x.route==='/api/native/jobs').length,1);assert.equal(c.unknown,null);assert.equal(c.busy,false);
});
test('cancelling before submission arrives fences the delayed request before any training starts',async()=>{
 const m=host({stage:'training'}),base=m.fetch;let release;m.fetch=(u,o)=>u.endsWith('/jobs')?new Promise(r=>release=async()=>r(await base(u,o))):base(u,o);const c=client(m);await c.connect();const pending=c.run(fixture().job),rejected=assert.rejects(pending,/cancelled/);await tick();await c.cancel();await release();await rejected;assert.equal(m.starts,0);assert.equal(c.unknown,null);assert.ok(m.fences.has(key(fixture().job)+'@1'));
});
test('unconfirmed work blocks new submissions until cancellation is confirmed',async()=>{
 const m=host({stage:'training'}),base=m.fetch;let offline=true;m.fetch=async(u,o)=>{if(u.endsWith('/health'))return base(u,o);if(u.endsWith('/jobs')){await base(u,o);throw Error('reply lost');}if(offline)throw Error('offline');return base(u,o);};const c=client(m);await assert.rejects(c.run(fixture().job),/could not be confirmed/);assert.equal(c.busy,true);await assert.rejects(c.run(fixture().job),/unconfirmed/);offline=false;assert.equal(await c.cancel(),true);assert.equal(c.unknown,null);assert.equal(c.busy,false);assert.equal(m.starts,1);
});
test('finding an empty host does not erase an unconfirmed pending submission',async()=>{
 const m=host(),c=client(m);c.unknown={job:fixture().job,id:null,revision:1};assert.equal(await c.findCurrent(),null);assert.equal(c.busy,true);await c.cancel();assert.equal(c.busy,false);assert.ok(m.fences.has(key(fixture().job)+'@1'));
});
test('a stale cancel and its fallback fence cannot stop a newer resumed attempt',async()=>{
 const m=host();const old=m.seed(fixture().job,'cancelled',1),c=client(m);await c.connect();c.last=old;m.record.status=status(m.record.job,'training',2,old.status.id);const task={...c._task(old.job,old.status.id,1),submitted:true,acknowledged:true};await c._stop(task);assert.equal(m.record.status.running,true);assert.equal(m.record.status.revision,2);assert.ok(m.fences.has(key(old.job)+'@1'));
});
test('duplicate compare-and-swap resumes launch only one additional attempt',async()=>{
 const m=host(),r=m.seed(fixture().job,'cancelled',1),c=client(m),route='/api/native/jobs/'+r.status.id+'/resume';const s=await c.call(route,'POST',{revision:1});assert.equal(s.revision,2);assert.equal((await c.call(route,'POST',{revision:1})).revision,2);assert.equal(m.starts,1);
});
test('cancelling an unacknowledged resume skips its attempt and keeps the next resume possible',async()=>{
 const m=host(),r=m.seed(fixture().job,'cancelled',1),c=client(m);await c.attach(r);const base=m.fetch;let release,delayed=true;c.fetcher=(u,o)=>u.endsWith('/resume')&&delayed?new Promise(resolve=>release=async()=>resolve(await base(u,o))):base(u,o);
 const pending=c.run(r.job,()=>{},true),rejected=assert.rejects(pending,/cancelled/);await tick();await c.cancel();assert.equal(m.record.status.revision,2);assert.equal(m.starts,0);await release();await rejected;delayed=false;await c.run(r.job,()=>{},true);assert.equal(m.record.status.revision,3);assert.equal(m.starts,1);
});
test('recovering uncertain work fences its pending attempt before accepting a current record',async()=>{
 const m=host(),r=m.seed(fixture().job,'cancelled',1),c=client(m);await c.connect();c.unknown={job:r.job,id:r.status.id,revision:2};await assert.rejects(c.attach(r),/changed/);assert.equal(m.record.status.revision,2);assert.equal(c.unknown,null);assert.equal(m.starts,0);const adopted=await c.attach(await c.findCurrent());assert.equal(adopted.result,null);assert.equal(c.last.status.revision,2);
});
test('recovery refuses a replaced job and never stops its newer running replacement',async()=>{
 const m=host(),r=m.seed(),c=client(m);await c.findCurrent();const next=copy(r.job);next.workbench.token='replacement';m.seed(next,'training');await assert.rejects(c.attach(r),/changed/);assert.equal(m.record.status.running,true);assert.equal(m.record.job.workbench.token,'replacement');assert.equal(m.starts,0);
});
test('cancellation during recovery preflight cancels the owned existing attempt',async()=>{
 const m=host();const r=m.seed(fixture().job,'training'),c=client(m);await c.connect();const base=m.fetch;let release;c.fetcher=(u,o)=>u.endsWith('/current')?new Promise(resolve=>release=async()=>resolve(await base(u,o))):base(u,o);const pending=c.attach(r),rejected=assert.rejects(pending,/cancelled/);await tick();await c.cancel();await release();await rejected;assert.equal(m.record.status.running,false);assert.equal(m.starts,0);
});
test('attempt limits and contradictory status revisions are rejected',async()=>{
 const m=host(),r=m.seed(fixture().job,'cancelled',256),c=client(m);await c.attach(r);await assert.rejects(c.run(r.job,()=>{},true),/attempt limit/);assert.equal(m.starts,0);for(const rev of [0,257,1.2,'1'])assert.throws(()=>H.status({...r.status,revision:rev},r.job));assert.throws(()=>H.status(r.status,r.job,null,255),/changed/);
});
test('an observed running study blocks another submission until it is stopped or recovered',async()=>{
 const m=host({stage:'training'});m.seed();const c=client(m);await c.findCurrent();await assert.rejects(c.run(fixture().job),/still running/);await c.cancel();assert.equal(m.record.status.running,false);assert.equal(c.busy,false);
});
test('discovery reconciles stale running state when the host already completed',async()=>{
 const m=host(),r=m.seed(fixture().job,'training'),c=client(m);c.last=r;m.record.status=status(r.job,'complete',1,r.status.id);await c.findCurrent();assert.equal(c.busy,false);assert.equal(c.last.status.resultAvailable,true);
});
test('a full host ledger refuses new work without forgetting earlier cancellation fences',async()=>{
 const m=host(),c=client(m),j=fixture().job;for(let i=0;i<256;i++){const job=copy(j);job.workbench.token='fence-'+i;await c.call('/api/native/cancel-intent','POST',job,1);}const extra=copy(j);extra.workbench.token='full';const r=await c.call('/api/native/cancel-intent','POST',extra,1);assert.equal(r.fenced,true);await assert.rejects(c.call('/api/native/jobs','POST',extra),/full/);const old=copy(j);old.workbench.token='fence-0';await assert.rejects(c.call('/api/native/jobs','POST',old),/cancelled/);assert.equal(m.starts,0);assert.equal(m.ledger.size,256);
});
test('a valid fragment session still connects when session storage is blocked',async()=>{
 const m=host(),p=page(m);let changed=false;p.history.replaceState=()=>changed=true;p.sessionStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};const c=H.fromPage(p);assert.ok(c);await c.connect();assert.equal(changed,false);assert.equal(p.location.hash,'#desktop-token='+secret);
});
test('dashboard discovery is read only and recovery restores the original slot, proof and result',async()=>{
 const m=host();m.seed();const h=harness({page:page(m)});await h.get('desktop-find-native').click();assert.match(h.get('desktop-recovery-status').textContent,/slot 2/);assert.equal(h.workers.length,0);assert.equal(mutations(m).length,0);await h.get('desktop-recover-native').click();assert.equal(h.get('study-slot').value,'2');assert.match(h.get('reviewed-position-results').innerHTML,/Native CPU/);assert.equal(h.workers.length,0);assert.equal(mutations(m).length,0);const saved=h.c.WorkspaceStudies.capture();assert.equal(saved.slots.find(s=>s.slot===2).reviewedProof.hand,fixture().job.reviewed.proof.hand);assert.equal(JSON.stringify(saved).includes(secret),false);assert.equal(JSON.stringify(saved).includes('eightmax-desktop-job'),false);
});
test('interrupted dashboard recovery prepares explicit Resume without starting training',async()=>{
 const m=host();m.seed(fixture().job,'cancelled',2);const h=harness({page:page(m)});await h.get('desktop-find-native').click();await h.get('desktop-recover-native').click();assert.match(h.get('study-status').textContent,/Use Resume/);assert.equal(h.get('study-slot').value,'2');assert.equal(mutations(m).length,0);await h.get('desktop-resume-native').click();assert.equal(m.starts,1);assert.equal(m.record.status.revision,3);assert.equal(h.workers.length,0);assert.match(h.get('reviewed-position-results').innerHTML,/Native CPU/);
});
test('malformed discovery is atomic and does not overwrite the current draft',async()=>{
 const m=host();m.seed();const base=m.fetch;m.fetch=(u,o)=>u.endsWith('/current')?response({...m.envelope(),status:{...m.record.status,binding:{slot:1,token:'wrong'}}}):base(u,o);const h=harness({page:page(m)}),before=h.get('study-config').value;await h.get('desktop-find-native').click();await h.get('desktop-recover-native').click();assert.equal(h.get('study-config').value,before);assert.equal(h.get('study-slot').value,'1');assert.equal(h.workers.length,0);assert.equal(mutations(m).length,0);
});
test('editing a draft invalidates a recovery preview and late discovery is ignored',async()=>{
 const m=host();m.seed();const h=harness({page:page(m)});await h.get('desktop-find-native').click();h.get('study-updates').value='1200';h.get('study-updates').oninput();await h.get('desktop-recover-native').click();assert.equal(h.get('study-slot').value,'1');assert.equal(h.get('study-updates').value,'1200');assert.equal(mutations(m).length,0);
 const base=m.fetch;let release;
 const delayed={fetch:(u,o)=>u.endsWith('/current')?new Promise(r=>release=()=>r(response(m.envelope()))):base(u,o)},h2=harness({page:page(delayed)}),pending=h2.get('desktop-find-native').click();await tick();h2.get('study-slot').value='3';h2.get('study-slot').onchange();release();await pending;assert.equal(h2.get('desktop-recover-native').disabled,true);assert.equal(h2.get('study-slot').value,'3');assert.equal(mutations(m).length,0);
});
test('observed work blocks dashboard capacity tests and emergency Stop cancels it',async()=>{
 const m=host();m.seed(fixture().job,'training');const h=harness({page:page(m)});await h.get('desktop-find-native').click();assert.equal(h.c.workbenchDesktopNativeBusy(),true);await h.get('run-benchmark').click();assert.match(h.get('benchmark-status').textContent,/managed native/);assert.equal(h.workers.length,0);h.get('stop').click();await tick();assert.equal(m.record.status.running,false);assert.equal(h.get('desktop-recover-native').disabled,true);assert.equal(m.starts,0);
});
test('portable recovery controls explain the launcher without probing the local host',async()=>{
 const h=harness();await h.get('desktop-find-native').click();assert.match(h.get('desktop-recovery-status').textContent,/START-DESKTOP/);await h.get('desktop-recover-native').click();assert.equal(h.workers.length,0);
});
test('dashboard retains an unconfirmed submission, blocks another run and lets emergency Stop resolve it',async()=>{
 const m=host({stage:'training'}),base=m.fetch;let offline=true;m.fetch=async(u,o)=>{if(u.endsWith('/health'))return base(u,o);if(u.endsWith('/jobs')){await base(u,o);throw Error('reply lost');}if(offline)throw Error('offline');return base(u,o);};const h=harness({page:page(m)}),pending=h.get('desktop-run-native').click(),worker=h.workers.at(-1),E=require('./load-solver.cjs'),prepared=A.prepare(E,worker.data.request);worker.result(A.nativeJob(prepared,worker.data.id));await pending;assert.match(h.get('desktop-status').textContent,/could not be confirmed/);assert.equal(h.c.workbenchDesktopNativeBusy(),true);
 await h.get('desktop-run-native').click();assert.equal(h.workers.length,1);await h.get('run-benchmark').click();assert.equal(h.workers.length,1);assert.match(h.get('benchmark-status').textContent,/managed native/);offline=false;h.get('stop').click();await tick();assert.equal(m.record.status.running,false);assert.equal(h.c.workbenchDesktopNativeBusy(),false);
});
test('a draft edit during recovery preflight cannot be overwritten by the late attachment',async()=>{
 const m=host();m.seed();const base=m.fetch;let delayed=false,release;m.fetch=(u,o)=>u.endsWith('/current')&&delayed?new Promise(r=>release=()=>r(response(m.envelope()))):base(u,o);const h=harness({page:page(m)});await h.get('desktop-find-native').click();delayed=true;const pending=h.get('desktop-recover-native').click();await tick();h.get('study-config').value='{unfinished';h.get('study-config').oninput();release();await pending;assert.equal(h.get('study-slot').value,'1');assert.equal(h.get('study-config').value,'{unfinished');assert.equal(h.get('reviewed-position-results').innerHTML,'');assert.equal(m.starts,0);
});
test('recovery of a legacy root job keeps root results and removes a prior reviewed link',async()=>{
 const raw=fixture();raw.version=1;raw.query=raw.rootQuery;delete raw.rootQuery;const job=raw.job;job.version=1;job.query={path:[],board:[],offset:0,limit:1326};delete job.reviewed;delete job.rootActions;N.job(job);const m=host();m.seed(job);const base=m.fetch;m.fetch=(u,o)=>u.endsWith('/result')?response(raw):base(u,o);const h=harness({page:page(m)});h.get('study-slot').value='2';h.get('study-slot').onchange();h.get('observation-study-demo').click();h.get('observation-all').click();h.get('observation-history-to-study').click();assert.ok(h.c.WorkspaceStudies.capture().slots.find(s=>s.slot===2).reviewedProof);await h.get('desktop-find-native').click();await h.get('desktop-recover-native').click();assert.match(h.get('study-results').innerHTML,/native-cli-cpu/);assert.equal(h.get('reviewed-position-results').innerHTML,'');assert.equal(h.c.WorkspaceStudies.capture().slots.find(s=>s.slot===2).reviewedProof,null);assert.equal(mutations(m).length,0);
});
