'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const E=require('./load-solver.cjs'),A=require('../src/study-adapter.js'),C=require('../src/cpu-checkpoints.js'),Q=require('../src/reviewed-study.js'),S=require('../src/review-session.js'),D=require('../src/reviewed-demo.js'),W=require('../src/workspace.js'),{Cache}=require('../src/cache.js'),harness=require('./ui-harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(setImmediate);
function prepared(name='practice2',updates=100,target=300){const p=A.prepare(E,{config:A.EXAMPLES[name],iterations:target,timeMs:1000});p.game.iterate(updates);return p;}
function reviewed(updates=100,target=300){const s=new S.Session(D.create());s.batch();const d=Q.draft(s.trajectory(1),['AsAd','KsKd']),p=A.prepare(E,{config:d.config,iterations:target,timeMs:1000});p.game.iterate(updates);return {p,proof:d.proof};}
function reply(request,mode='solve',count=null){const p=A.prepare(E,request),proof=request.reviewed||null,from=request.cpuCheckpoint?C.restore(p,request.cpuCheckpoint,proof):0;if(mode!=='inspect-cpu-checkpoint')p.game.iterate(count===null?request.iterations-from:count);const r=A.result(E,p,1);if(proof)r.reviewedNode=Q.query(E,p,Q.replay(E,p,proof));r.cpuContinuation={version:1,operation:mode==='inspect-cpu-checkpoint'?'inspect':mode==='resume-study'?'resume':'fresh',fromUpdates:from,addedUpdates:p.game.iterations-from};if(mode==='inspect-cpu-checkpoint')r.stopped='checkpoint-opened';r.cpuCheckpoint=C.capture(p,proof);return r;}
async function trained(h=harness(),count=100){h.get('study-example').value='practice2';h.get('load-example').click();h.get('study-updates').value='300';h.get('study-updates').oninput();h.get('study-budget').value='1000';h.get('study-budget').oninput();const p=h.get('solve-study').click(),w=h.workers.at(-1);assert.equal(w.data.request.retainCPU,true);w.result(reply(w.data.request,w.data.mode,count));await p;return h;}
async function savedCPU(h){h.get('cpu-save').click();return new Uint8Array(await h.blobs.get(h.downloads.at(-1).href).arrayBuffer());}
function file(bytes){return {size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}
async function startOpen(h,bytes){h.get('cpu-checkpoint-file').files=[file(bytes)];const pending=h.get('cpu-checkpoint-file').onchange();await tick();return {pending,w:h.workers.at(-1)};}
const exportedJSON=async h=>JSON.parse(await h.blobs.get(h.downloads.at(-1).href).text());

test('binary CPU container round trips metadata and state with standard CRC32',()=>{
 assert.equal(C.crc32(new TextEncoder().encode('123456789')),0xcbf43926);const snapshot=C.capture(prepared()),encoded=C.encode(snapshot),decoded=C.decode(encoded);assert.deepEqual(decoded.meta,snapshot.meta);assert.deepEqual(decoded.bytes,snapshot.bytes);assert.equal(String.fromCharCode(...encoded.subarray(0,8)),'EMWBCP1\n');
});
test('checkpoints reject bad engine, incompatible settings, counters and malformed containers',()=>{
 const good=C.capture(prepared());for(const change of [s=>s.meta.engine.build='wrong',s=>s.meta.updates=101,s=>s.meta.trainingDeals=99,s=>s.meta.requestedUpdates=99,s=>s.meta.decisionReady=true,s=>s.meta.extra=true,s=>s.meta.config.engine='gpu']){const s={meta:clone(good.meta),bytes:good.bytes};change(s);assert.throws(()=>C.validate(s));}
 const file=C.encode(good);for(const bytes of [file.subarray(0,file.length-1),new Uint8Array([...file,0]),file.map((v,i)=>i===0?v^1:v),file.map((v,i)=>i===file.length-1?v^1:v)])assert.throws(()=>C.decode(bytes));
});
test('metadata and row-count allocation bounds are checked before native parsing',()=>{
 const s=C.capture(prepared()),b=s.bytes.slice(),v=new DataView(b.buffer),offset=12+v.getUint32(8,true);v.setUint32(offset,C.MAX_STATES+1,true);assert.throws(()=>C.preflight(b),/state count/);
 const c=s.bytes.slice(),d=new DataView(c.buffer),at=12+d.getUint32(8,true),states=d.getUint32(at,true);d.setUint32(at+4+9*states,C.MAX_ROWS+1,true);assert.throws(()=>C.preflight(c),/row count/);
 const tiny=s.bytes.subarray(0,10);assert.throws(()=>C.preflight(tiny));assert.throws(()=>C.metadata({...s.meta,config:{...s.meta.config,ranges:['x'.repeat(2001),'KK']}}));
});
test('correct container CRC does not bypass the original engine row checksum',()=>{
 const p=prepared(),s=C.capture(p),bad={meta:s.meta,bytes:s.bytes.slice()};bad.bytes[bad.bytes.length-1]^=1;const decoded=C.decode(C.encode(bad)),fresh=A.prepare(E,{config:s.meta.config,iterations:300,timeMs:1000});assert.throws(()=>C.restore(fresh,decoded),/checksum/);assert.equal(fresh.game.iterations,0);
});
test('different root, seed or captured history cannot resume a checkpoint',()=>{
 const f=reviewed(),s=C.capture(f.p,f.proof);for(const edit of [c=>c.common++,c=>c.privateSeed++,c=>c.ranges[0]='QhQd']){const config=clone(s.meta.config);edit(config);const p=A.prepare(E,{config,iterations:300,timeMs:1000});assert.throws(()=>C.restore(p,s,f.proof),/different study settings/);assert.equal(p.game.iterations,0);}
 const p=A.prepare(E,{config:s.meta.config,iterations:300,timeMs:1000});assert.throws(()=>C.restore(p,s),/captured position/);const proof=clone(f.proof);proof.hand='other';assert.throws(()=>C.restore(p,s,proof),/captured position/);
});
test('a changed but valid saved configuration is refused by the native study identity',()=>{
 const s=C.capture(prepared());s.meta.config.common++;const decoded=C.decode(C.encode(s)),p=A.prepare(E,{config:decoded.meta.config,iterations:300,timeMs:1000});assert.throws(()=>C.restore(p,decoded),/different engine study/);assert.equal(p.game.iterations,0);
});
test('resume target cannot precede committed updates and restore requires a fresh game',()=>{
 const s=C.capture(prepared()),small=A.prepare(E,{config:s.meta.config,iterations:99,timeMs:1000});assert.throws(()=>C.restore(small,s),/below/);const running=prepared('practice2',20),before=running.game.exportNative();assert.throws(()=>C.restore(running,s),/fresh worker/);assert.deepEqual(running.game.exportNative(),before);
});
test('interrupted root studies resume byte-for-byte on two-, three-, six- and eight-player profiles',()=>{
 for(const name of ['practice2','river3','flop6','preflop8']){const full=prepared(name,300),part=prepared(name,100),snapshot=C.decode(C.encode(C.capture(part))),next=A.prepare(E,{config:snapshot.meta.config,iterations:300,timeMs:1000});C.restore(next,snapshot);next.game.iterate(200);assert.deepEqual(next.game.exportNative(),full.game.exportNative(),name);assert.deepEqual(snapshot.bytes,C.capture(part).bytes);}
});
test('reviewed checkpoint continuation retains the same path and acting-seat policies',()=>{
 const f=reviewed(),snapshot=C.decode(C.encode(C.capture(f.p,f.proof))),p=A.prepare(E,{config:f.p.options.config,iterations:300,timeMs:1000});C.restore(p,snapshot,f.proof);p.game.iterate(200);const full=reviewed(300),a=Q.query(E,p,Q.replay(E,p,f.proof)),b=Q.query(E,full.p,Q.replay(E,full.p,full.proof));assert.equal(a.path,'r1');assert.equal(a.actor,1);assert.deepEqual(a.hands,b.hands);assert.deepEqual(p.game.exportNative(),full.p.game.exportNative());
});
test('bounded retained-state store evicts the oldest slot and owns its bytes',()=>{
 const snapshot=C.capture(prepared()),cost=snapshot.bytes.length+new TextEncoder().encode(JSON.stringify(snapshot.meta)).length,store=new C.Store(2*cost);assert.deepEqual(store.put(1,snapshot),[]);const saved=store.get(1).bytes.slice();snapshot.bytes[0]=0;assert.deepEqual(store.get(1).bytes,saved);const valid=C.capture(prepared());store.put(2,valid);assert.deepEqual(store.put(3,valid),[1]);assert.equal(store.get(1),null);assert.ok(store.used<=store.limit);const before=store.get(2);assert.throws(()=>store.put(2,{meta:{},bytes:valid.bytes}));assert.equal(store.get(2),before);store.clear();assert.equal(store.used,0);
});
test('runtime checkpoint data never becomes an ordinary strategy report or cached continuation',()=>{
 const s=C.capture(prepared()),r=reply({config:s.meta.config,iterations:300,timeMs:1000,cpuCheckpoint:s},'resume-study');assert.throws(()=>A.validateResult(r),/separate checkpoint/);const cp=r.cpuCheckpoint;delete r.cpuCheckpoint;C.report(r,cp);assert.equal(new Cache().put({config:r.config,iterations:300,timeMs:1000},r),false);r.cpuContinuation.addedUpdates++;assert.throws(()=>A.validateResult(r),/continuation counters/);
});
test('fresh UI study retains a state, exports a separate file and keeps report/workspace JSON byte-free',async()=>{
 const h=await trained();assert.match(h.get('cpu-checkpoint-status').textContent,/100 committed updates/);const bytes=await savedCPU(h);assert.equal(C.decode(bytes).meta.updates,100);h.get('export-study-result').click();const report=await exportedJSON(h);assert.equal(report.cpuCheckpoint,undefined);assert.equal(report.cpuContinuation.addedUpdates,100);await h.get('workspace-save').click();const workspace=await exportedJSON(h);assert.equal(workspace.version,3);assert.ok(workspace.studies.slots.every(s=>!s.result||s.result.cpuCheckpoint===undefined));W.load(JSON.stringify(workspace));
});
test('changing only target/time retains the CPU state and Continue adds only the missing updates',async()=>{
 const h=await trained();h.get('study-updates').value='400';h.get('study-updates').oninput();h.get('study-budget').value='2000';h.get('study-budget').oninput();assert.match(h.get('cpu-checkpoint-status').textContent,/100 committed/);const pending=h.get('cpu-continue').click(),w=h.workers.at(-1);assert.equal(w.data.mode,'resume-study');assert.equal(w.data.request.cpuCheckpoint.meta.updates,100);w.result(reply(w.data.request,w.data.mode));await pending;const saved=C.decode(await savedCPU(h));assert.equal(saved.meta.updates,400);assert.equal(saved.meta.requestedUpdates,400);assert.match(h.get('study-results').innerHTML,/300 updates added/);assert.equal(h.c.workbench.coordinator.totalActions,0);
});
test('cancelling continuation retains the previous checkpoint and ignores its late result',async()=>{
 const h=await trained(),before=await savedCPU(h),pending=h.get('cpu-continue').click(),w=h.workers.at(-1),late=reply(w.data.request,w.data.mode);h.get('cancel-study').click();w.result(late);await pending;assert.ok(w.dead);assert.deepEqual(await savedCPU(h),before);
});
test('physical draft edits discard the retained CPU state while study slots stay independent',async()=>{
 const h=await trained();h.get('study-slot').value='2';h.get('study-slot').onchange();assert.match(h.get('cpu-checkpoint-status').textContent,/No CPU training/);await h.get('cpu-continue').click();assert.equal(h.workers.length,1);h.get('study-slot').value='1';h.get('study-slot').onchange();assert.match(h.get('cpu-checkpoint-status').textContent,/100 committed/);h.get('guided-range-0').value='QhQd';h.get('guided-form').oninput();assert.match(h.get('cpu-checkpoint-status').textContent,/No CPU training/);
});
test('opening a CPU checkpoint validates in a worker and does not train automatically',async()=>{
 const bytes=C.encode(C.capture(prepared())),h=harness(),{pending,w}=await startOpen(h,bytes);assert.equal(w.data.mode,'inspect-cpu-checkpoint');assert.equal(w.data.request.cpuCheckpoint.meta.updates,100);w.result(reply(w.data.request,w.data.mode));await pending;assert.match(h.get('study-status').textContent,/No new training/);assert.match(h.get('cpu-checkpoint-status').textContent,/100 committed/);assert.equal(h.workers.length,1);assert.equal(h.c.workbench.coordinator.totalActions,0);
});
test('a reviewed file opens with its captured proof and can continue the same non-root position',async()=>{
 const f=reviewed(),h=harness(),{pending,w}=await startOpen(h,C.encode(C.capture(f.p,f.proof)));w.result(reply(w.data.request,w.data.mode));await pending;assert.match(h.get('reviewed-position-note').textContent,/reviewed-demo/);assert.match(h.get('reviewed-position-results').innerHTML,/Original seat 1/);const next=h.get('cpu-continue').click(),worker=h.workers.at(-1);assert.equal(worker.data.request.reviewed.hand,'reviewed-demo');worker.result(reply(worker.data.request,worker.data.mode));await next;assert.equal(C.decode(await savedCPU(h)).meta.updates,300);
});
test('bad containers, oversized files and failed engine validation preserve the prior study/state',async()=>{
 const h=await trained(),before=await savedCPU(h),draft=h.get('study-config').value,bad=before.slice();bad[bad.length-1]^=1;
 h.get('cpu-checkpoint-file').files=[file(bad)];await h.get('cpu-checkpoint-file').onchange();assert.match(h.get('cpu-checkpoint-status').textContent,/checksum/);assert.equal(h.get('study-config').value,draft);assert.deepEqual(await savedCPU(h),before);
 h.get('cpu-checkpoint-file').files=[{size:C.MAX_FILE_BYTES+1,arrayBuffer:async()=>{throw Error('must not read');}}];await h.get('cpu-checkpoint-file').onchange();assert.match(h.get('cpu-checkpoint-status').textContent,/exceeds/);
 const nativeBad=C.capture(prepared());nativeBad.bytes[nativeBad.bytes.length-1]^=1;const {pending,w}=await startOpen(h,C.encode(nativeBad));let error;try{reply(w.data.request,w.data.mode);}catch(e){error=e;}assert.ok(error);w.onmessage({data:{id:w.data.id,kind:'error',message:error.message}});await pending;assert.equal(h.get('study-config').value,draft);assert.deepEqual(await savedCPU(h),before);
});
test('stale asynchronous checkpoint reads and worker replies cannot replace later user edits',async()=>{
 const h=harness(),bytes=C.encode(C.capture(prepared()));let release;h.get('cpu-checkpoint-file').files=[{size:bytes.length,arrayBuffer:()=>new Promise(r=>release=r)}];const pending=h.get('cpu-checkpoint-file').onchange();h.get('study-example').value='preflop8';h.get('load-example').click();release(bytes.buffer);await pending;assert.equal(h.workers.length,0);assert.ok(JSON.parse(h.get('study-config').value).preflop);
 const next=await startOpen(h,bytes),late=reply(next.w.data.request,next.w.data.mode);h.get('study-config').value='{unfinished';h.get('study-config').oninput();next.w.result(late);await next.pending;assert.equal(h.get('study-config').value,'{unfinished');assert.match(h.get('cpu-checkpoint-status').textContent,/No CPU training/);
});
test('workspace restore drops in-memory CPU states and cached reports cannot recreate them',async()=>{
 const h=await trained(harness(),300);await h.get('workspace-save').click();const text=await h.blobs.get(h.downloads.at(-1).href).text();h.get('workspace-file').files=[{size:Buffer.byteLength(text),text:async()=>text}];await h.get('workspace-file').onchange();assert.match(h.get('cpu-checkpoint-status').textContent,/No CPU training/);const workers=h.workers.length;await h.get('solve-study').click();assert.equal(h.workers.length,workers);assert.match(h.get('study-status').textContent,/cache hit/);assert.match(h.get('cpu-checkpoint-status').textContent,/No CPU training/);
});
test('checkpoint controls exist in generated page and retained state is optional for fresh studies',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../START.html'),'utf8');for(const id of ['cpu-retain','cpu-continue','cpu-save','cpu-open','cpu-clear','cpu-checkpoint-file','cpu-checkpoint-status'])assert.ok(html.includes('id="'+id+'"'),id);const h=harness();h.get('cpu-retain').checked=false;const pending=h.get('solve-study').click(),w=h.workers[0];assert.equal(w.data.request.retainCPU,false);const p=A.prepare(E,w.data.request);p.game.iterate(20);w.result(A.result(E,p,1));await pending;assert.match(h.get('cpu-checkpoint-status').textContent,/No CPU training/);
});
const native=process.env.EIGHTMAX_TEST_CLI;
test('exported CPU state also resumes through the independent native engine at the same policy',{skip:!native},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eightmax-cpu-state-'));try{const p=prepared('river3',100,300),state=C.capture(p),spec=path.join(dir,'spec.json'),saved=path.join(dir,'saved.state'),out=path.join(dir,'next.state'),query=path.join(dir,'query.json');fs.writeFileSync(spec,JSON.stringify(p.spec));fs.writeFileSync(saved,state.bytes);fs.writeFileSync(query,'{"path":[],"board":[],"offset":0,"limit":1326}');const t=JSON.parse(cp.execFileSync(native,[spec,'200','2',out,'256',saved],{encoding:'utf8',timeout:30000}));assert.equal(t.iterations,300);const q=JSON.parse(cp.execFileSync(native,['--node',spec,out,query,'256'],{encoding:'utf8',timeout:30000})),full=A.result(E,prepared('river3',300),1);assert.deepEqual(q.hands.items.map(h=>h.average),full.hands.map(h=>h.average));assert.deepEqual(new Uint8Array(fs.readFileSync(saved)),state.bytes);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
