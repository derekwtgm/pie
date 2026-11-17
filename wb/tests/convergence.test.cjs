'use strict';
// 0.18 convergence checks and raised limits. Native cases run the Linux CLI compiled from the supplied
// EightMax 5.1 source (EIGHTMAX_TEST_CLI); `runNative` mirrors what native/Run-Native-Study.ps1 does
// (chunked training, `mwcli --gain` with auto fallback, saved block). PowerShell itself is not executed.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const C=require('../src/convergence.js'),N=require('../src/native-jobs.js'),A=require('../src/study-adapter.js'),W=require('../src/workspace.js'),EM=require('./load-solver.cjs'),harness=require('./ui-harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x)),native=process.env.EIGHTMAX_TEST_CLI;
const base={threads:2,memoryMiB:256,timeoutSeconds:600,chunkUpdates:500};
function job(example,iterations,convergence,o={}){const p=A.prepare(EM,{config:A.EXAMPLES[example],iterations,timeMs:3000});return N.bind(A.nativeJob(p,'conv-'+example),1,'conv-'+example,{...base,...o,convergence});}
function runNative(j){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eightmax-conv-')),run=(args,timeout=120000)=>cp.execFileSync(native,args,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']});
 try{
  const spec=path.join(dir,'spec.json'),query=path.join(dir,'query.json'),req=path.join(dir,'gain.json'),s=C.settings(j.convergence),methods=C.plan(s),measurements=[];
  fs.writeFileSync(spec,JSON.stringify(j.spec));fs.writeFileSync(query,JSON.stringify(j.query));
  const measure=(updates,latest)=>{const t=Date.now(),attempts=[];let response=null;
   for(const method of methods){fs.writeFileSync(req,JSON.stringify(C.request(method,s,j.threads)));
    try{response=JSON.parse(run(['--gain',spec,latest,req,String(j.memoryMiB)],(s.timeLimitSeconds+30)*1000));delete response.execution;if(response.utility)delete response.utility.convention;break;}
    catch(e){attempts.push({method,error:('Native gain-'+updates+'-'+method+' failed ('+e.status+'): '+String(e.stderr||e.message)).trim().slice(0,600)});}}
   return {updates,elapsedMs:Date.now()-t,attempts,response};};
  let committed=0,latest=null,batch=0,training=null;
  while(committed<j.iterations){const count=Math.min(j.chunkUpdates,j.iterations-committed),state=path.join(dir,'checkpoint-'+(batch%2)+'.state'),args=[spec,String(count),String(j.threads),state,String(j.memoryMiB)];if(latest)args.push(latest);
   training=JSON.parse(run(args));assert.ok(training.iterations>committed);committed=training.iterations;latest=state;batch++;
   if(methods.length&&s.everyChunks>0&&batch%s.everyChunks===0&&committed<j.iterations&&measurements.length<50)measurements.push(measure(committed,latest));}
  training.requestedTotalUpdates=j.iterations;const q=JSON.parse(run(['--node',spec,latest,query,String(j.memoryMiB)]));
  if(methods.length)measurements.push(measure(committed,latest));
  return {format:'eightmax-workbench-native-result',version:1,build:A.ENGINE.build,job:j,training,query:q,elapsedMs:1,convergence:{format:'eightmax-native-convergence',version:1,settings:s,measurements}};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('convergence settings default for older jobs and reject unknown or out-of-range values',()=>{
 assert.deepEqual(C.settings(undefined),{method:'auto',everyChunks:0,timeLimitSeconds:30,targetPctPot:1});
 assert.deepEqual(C.plan({method:'auto'}),['exact','restricted','sampled']);assert.deepEqual(C.plan({method:'off'}),[]);assert.deepEqual(C.plan({method:'sampled'}),['sampled']);
 for(const bad of [{method:'fast'},{everyChunks:-1},{everyChunks:1001},{timeLimitSeconds:4},{timeLimitSeconds:3601},{targetPctPot:0},{targetPctPot:101},{targetPctPot:'1'},{extra:1},[]])assert.throws(()=>C.settings(bad));
 assert.deepEqual(C.request('exact',{timeLimitSeconds:12},2),{method:'exact',timeLimitMs:12000,threads:2});
});
test('raised limits: 10M native updates, 16 GiB, 7-day time limit, 1M checkpoint interval; browser 10-minute budget',()=>{
 const j=job('practice2',10000000,undefined,{memoryMiB:16384,timeoutSeconds:604800,chunkUpdates:1000000});assert.equal(j.iterations,10000000);assert.equal(j.memoryMiB,16384);assert.deepEqual(j.convergence,C.DEFAULTS);
 assert.throws(()=>A.input({config:A.EXAMPLES.practice2,iterations:10000001}),/10,000,000/);assert.throws(()=>A.input({config:A.EXAMPLES.practice2,timeMs:600001}),/600,000/);
 assert.equal(A.input({config:A.EXAMPLES.practice2,iterations:1000000,timeMs:600000}).iterations,1000000);
 assert.equal(N.status({format:'eightmax-native-job-status',version:1,build:A.ENGINE.build,id:'x',stage:'training',committedUpdates:6000000,targetUpdates:10000000,elapsedMs:1,message:'',checkpoint:''}).committedUpdates,6000000);
});
test('runner, host and browser validators agree on the new bounds',()=>{
 const ps=fs.readFileSync(path.join(__dirname,'../native/Run-Native-Study.ps1'),'utf8'),cs=fs.readFileSync(path.join(__dirname,'../desktop/DesktopHost.cs'),'utf8');
 for(const text of ["$script:job.iterations 1 10000000","$script:job.memoryMiB 32 16384","$script:job.timeoutSeconds 1 604800","$script:job.chunkUpdates 1 1000000","$conv.everyChunks 0 1000","$conv.timeLimitSeconds 5 3600","'--gain '"])assert.ok(ps.includes(text),'runner: '+text);
 for(const text of ['const int MaxUpdates=10000000;','"memoryMiB"),32,16384','"timeoutSeconds"),1,604800','"chunkUpdates"),1,1000000','ValidateConvergence(Get(job,"convergence"))'])assert.ok(cs.includes(text),'host: '+text);
 assert.equal(cs.includes('50000'),false);assert.equal(N.LIMITS.updates,10000000);assert.deepEqual(N.LIMITS.memoryMiB,[32,16384]);
});
test('heads-up exact convergence falls with training and reports exploitability',{skip:!native},()=>{
 const raw=runNative(job('practice2',3000,{method:'exact',everyChunks:1,timeLimitSeconds:30,targetPctPot:0.01})),r=N.result(raw),c=r.convergence;
 assert.equal(c.curve.length,6);assert.ok(c.curve.every(p=>p.available&&p.method==='exact'));assert.equal(c.final.updates,3000);assert.equal(c.final.bound,'exact');
 assert.ok(c.curve[5].maxPctPot<c.curve[0].maxPctPot/10,'gain should fall by more than 10x from 500 to 3000 updates');
 assert.ok(c.final.exploitability>0&&Math.abs(c.final.exploitability-c.final.nashConv/2)<1e-15);assert.equal(c.final.seats.length,2);
 assert.equal(c.verdict.code,c.final.maxPctPot<=0.01?'within-target':'above-target');assert.ok(c.trend&&c.trend.ratio<1);
});
test('three-seat exact check reports per-seat gains and keeps training below an unmet target',{skip:!native},()=>{
 const r=N.result(runNative(job('river3',2000,{method:'auto',everyChunks:2,timeLimitSeconds:30,targetPctPot:0.001}))),c=r.convergence;
 assert.equal(c.final.method,'exact');assert.equal(c.final.attempts.length,0);assert.equal(c.final.seats.length,3);assert.equal(c.final.exploitability,null,'exploitability is only claimed heads-up');
 assert.ok(c.final.seats.every(s=>s.gain>=0&&Math.abs(s.pctPot-100*s.gain/12)<1e-9),'percent of the 12 BB starting pot');
 assert.equal(c.verdict.code,'above-target');assert.match(c.verdict.text,/Keep training/);assert.ok(c.curve[0].maxPctPot>c.final.maxPctPot);
});
test('auto falls back to a lower bound on trees too large for exact and never claims convergence',{skip:!native},()=>{
 const r=N.result(runNative(job('flop6',300,{method:'auto',everyChunks:0,timeLimitSeconds:8,targetPctPot:50},{chunkUpdates:300}))),f=r.convergence.final;
 assert.equal(f.attempts[0].method,'exact');assert.match(f.attempts[0].error,/422|maxVisits/);assert.equal(f.available,true);assert.equal(f.bound,'lower-bound');
 assert.notEqual(r.convergence.verdict.code,'within-target');assert.match(r.convergence.verdict.text,/lower bound|at least/);
});
test('a check that cannot run is reported as unavailable without failing the study',{skip:!native},()=>{
 const r=N.result(runNative(job('preflop8',200,{method:'exact',everyChunks:0,timeLimitSeconds:5,targetPctPot:1},{chunkUpdates:200})));
 assert.equal(r.updates,200);assert.equal(r.convergence.final.available,false);assert.equal(r.convergence.verdict.code,'unavailable');assert.match(r.convergence.verdict.text,/could not be measured/);
});
test('training continues past the former 50,000-update cap through chunked checkpoints',{skip:!native},()=>{
 const r=N.result(runNative(job('practice2',60000,{method:'exact',everyChunks:0,timeLimitSeconds:30,targetPctPot:0.01},{chunkUpdates:20000})));
 assert.equal(r.updates,60000);assert.equal(r.requestedUpdates,60000);assert.equal(r.stopped,'updates-complete');assert.equal(r.convergence.final.updates,60000);assert.equal(r.convergence.verdict.code,'within-target');
});
test('tampered or inconsistent convergence blocks are refused',{skip:!native},()=>{
 const raw=runNative(job('practice2',1000,{method:'exact',everyChunks:1,timeLimitSeconds:30,targetPctPot:1}));N.result(clone(raw));
 const bad=[v=>v.convergence.measurements.at(-1).updates=999,v=>v.convergence.measurements.at(-1).response.updates=1,v=>v.convergence.measurements.at(-1).response.players=3,v=>v.convergence.settings.targetPctPot=5,
  v=>v.convergence.measurements.reverse(),v=>v.convergence.measurements.pop(),v=>v.convergence.measurements.at(-1).response.mode='guess',v=>v.convergence.measurements.at(-1).response=null,
  v=>v.convergence.format='other',v=>{v.convergence.settings.method='off';v.job.convergence.method='off';}];
 for(const change of bad){const v=clone(raw);change(v);assert.throws(()=>N.result(v),undefined,String(change));}
});
test('dashboard exports convergence controls, shows the verdict on import and keeps it in workspace backups',{skip:!native},async()=>{
 const h=harness();h.get('load-example').click();h.get('study-example').value='practice2';h.get('load-example').click();h.get('study-updates').value='1500';
 h.get('native-conv-method').value='exact';h.get('native-conv-every').value='1';h.get('native-conv-target').value='0.05';h.get('native-chunk').value='500';h.get('native-timeout').value='600';
 const pending=h.get('export-native-job').click(),worker=h.workers.at(-1);worker.result(A.nativeJob(A.prepare(EM,worker.data.request),worker.data.id));await pending;
 const j=JSON.parse(await h.blobs.get(h.downloads.at(-1).href).text());assert.deepEqual(j.convergence,{method:'exact',everyChunks:1,timeLimitSeconds:30,targetPctPot:0.05});assert.equal(j.iterations,1500);
 const raw=runNative(j);h.get('study-result-file').files=[{size:1000,text:async()=>JSON.stringify(raw)}];await h.get('study-result-file').onchange();
 const html=h.get('study-results').innerHTML;assert.match(html,/Convergence · exact/);assert.match(html,/Heads-up exploitability/);assert.match(html,/conv-curve/);assert.match(html,/Gain by deviating/);
 await h.get('workspace-save').click();const saved=JSON.parse(await h.blobs.get(h.downloads.at(-1).href).text()),row=saved.studies.slots.find(s=>s.result);
 assert.equal(row.result.convergence.verdict.code,N.result(raw).convergence.verdict.code);assert.equal(saved.studies.nativeControls.convMethod,'exact');
 const copy=clone(row.result);copy.convergence.verdict.code='proven-nash';assert.throws(()=>A.validateResult(copy));
 const fresh=harness();fresh.get('workspace-file').files=[{size:2000000,text:async()=>JSON.stringify(saved)}];await fresh.get('workspace-file').onchange();
 for(let i=0;i<5&&!/restored/.test(fresh.get('workspace-status').textContent);i++)await new Promise(setImmediate);
 assert.match(fresh.get('workspace-status').textContent,/restored/);assert.equal(fresh.get('native-conv-method').value,'exact');assert.equal(fresh.get('native-conv-target').value,'0.05');
});
test('browser results and pre-0.18 native results say they were not convergence-checked',async()=>{
 const r=A.runSync(EM,{config:A.EXAMPLES.practice2,iterations:50,timeMs:1000});assert.equal(r.convergence,undefined);assert.throws(()=>A.validateResult({...r,convergence:{format:'eightmax-convergence-summary'}}));
 const h=harness();h.get('study-example').value='practice2';h.get('load-example').click();h.get('study-updates').value='20';const p=h.get('solve-study').click();for(let i=0;i<5&&!h.workers.length;i++)await new Promise(setImmediate);const w=h.workers.at(-1);assert.ok(w&&w.data,'a browser worker should start');
 w.result(A.runSync(EM,w.data.request));await p;for(let i=0;i<5&&!h.get('study-results').innerHTML;i++)await new Promise(setImmediate);assert.match(h.get('study-results').innerHTML,/Browser studies are not convergence-checked/);assert.doesNotMatch(h.get('study-results').innerHTML,/conv-curve/);
});
