'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const N=require('../src/native-jobs.js'),A=require('../src/study-adapter.js'),EM=require('./load-solver.cjs'),harness=require('./ui-harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x)),options={threads:2,memoryMiB:256,timeoutSeconds:60,chunkUpdates:1000};
const request={config:A.EXAMPLES.practice2,iterations:20,timeMs:1000};
const fixture=()=>A.nativeJob(A.prepare(EM,request),'native-test');
const data=async h=>JSON.parse(await h.blobs.get(h.downloads.at(-1).href).text());
async function exported(h=harness()) {const p=h.get('export-native-job').click(),worker=h.workers.at(-1);worker.result(A.nativeJob(A.prepare(EM,worker.data.request),worker.data.id));await p;assert.match(h.get('study-status').textContent,/Native job exported/);return data(h);}

test('native controls enforce numeric resource bounds and bind a job to its originating slot',()=>{
 const j=N.bind(fixture(),3,'request-1',options);assert.equal(j.workbench.slot,3);assert.equal(j.chunkUpdates,1000);assert.equal(N.same(j,clone(j),3),true);
 for(const change of [x=>x.threads=5,x=>x.memoryMiB=16385,x=>x.memoryMiB=31,x=>x.timeoutSeconds=0,x=>x.timeoutSeconds=604801,x=>x.chunkUpdates='1000',x=>x.chunkUpdates=1000001,x=>x.convergence={method:'fast'},x=>x.convergence={targetPctPot:0}]){const x={...options};change(x);assert.throws(()=>N.options(x));}
 const changed=clone(j);changed.workbench.token='different';assert.throws(()=>N.same(j,changed,3),/latest exported/);assert.throws(()=>N.same(j,j,2),/different/);
});
test('native status snapshots validate stage, update counts and bounded metadata without executing work',()=>{
 const s={format:'eightmax-native-job-status',version:1,build:A.ENGINE.build,id:'native-test',workbench:{slot:1,token:'request-1'},stage:'training',committedUpdates:10,targetUpdates:20,elapsedMs:100,message:'Checkpoint saved',checkpoint:'C:\\example\\checkpoint-0.state'};
 assert.equal(N.status(s).stage,'training');for(const change of [x=>x.stage='unknown',x=>x.committedUpdates=21,x=>x.elapsedMs=-1,x=>x.checkpoint='x'.repeat(2001)]){const x=clone(s);change(x);assert.throws(()=>N.status(x));}
});
test('dashboard exports native resource controls and preserves the bound export in whole-workspace backup',async()=>{
 const markup=fs.readFileSync(path.join(__dirname,'../START.html'),'utf8');for(const id of ['native-threads','native-memory','native-timeout','native-chunk','native-job-status','native-status-open'])assert.ok(markup.includes('id=\"'+id+'\"'),'Missing native control '+id);
 const h=harness();h.get('native-threads').value='4';h.get('native-memory').value='64';h.get('native-timeout').value='15';h.get('native-chunk').value='20';const j=await exported(h);
 assert.equal(j.threads,4);assert.equal(j.memoryMiB,64);assert.equal(j.timeoutSeconds,15);assert.equal(j.chunkUpdates,20);assert.equal(typeof j.id,'string');assert.equal(j.workbench.slot,1);
 await h.get('workspace-save').click();const saved=await data(h);assert.deepEqual(saved.studies.slots[0].nativeJob,j);assert.equal(h.c.workbench.coordinator.totalActions,0);
});
test('status import accepts only a snapshot matching the current slot and latest exported token',async()=>{
 const h=harness(),j=await exported(h),s={format:'eightmax-native-job-status',version:1,build:A.ENGINE.build,id:j.id,workbench:j.workbench,stage:'complete',committedUpdates:1000,targetUpdates:1000,elapsedMs:1000,message:'Finished',checkpoint:'checkpoint-1.state'};
 h.get('native-status-file').files=[{size:1000,text:async()=>JSON.stringify(s)}];await h.get('native-status-file').onchange();assert.match(h.get('native-job-status').textContent,/Finished/);
 s.workbench={...s.workbench,token:'old'};h.get('native-status-file').files=[{size:1000,text:async()=>JSON.stringify(s)}];await h.get('native-status-file').onchange();assert.match(h.get('native-job-status').textContent,/does not match/);
});
test('native result import refuses wrong bindings and exports invalidated by a newly loaded study',async()=>{
 const h=harness(),j=await exported(h),wrong=clone(j);wrong.workbench.token='old';const r={format:'eightmax-workbench-native-result',job:wrong};
 h.get('study-result-file').files=[{size:1000,text:async()=>JSON.stringify(r)}];await h.get('study-result-file').onchange();assert.match(h.get('study-status').textContent,/latest exported job/);assert.equal(h.get('study-results').innerHTML,'');
 h.get('load-example').click();r.job=j;h.get('study-result-file').files=[{size:1000,text:async()=>JSON.stringify(r)}];await h.get('study-result-file').onchange();assert.match(h.get('study-status').textContent,/No matching exported/);
});
test('changing reviewed or ordinary study inputs clears exported native bindings',async()=>{
 const h=harness();await exported(h);h.get('guided-stack-0').value='40';h.get('guided-form').oninput();assert.equal(h.c.WorkspaceStudies.capture().slots[0].nativeJob,null);
 await exported(h);h.get('observation-verified-demo').click();h.get('observation-step').click();h.get('observation-step').click();h.get('observation-ranges').value='AA\nKK';h.get('observation-to-study').click();assert.equal(h.c.WorkspaceStudies.capture().slots[0].nativeJob,null);
});
const native=process.env.EIGHTMAX_TEST_CLI;
test('native checkpoint chunks/resume reproduce uninterrupted root policies and cumulative targets',{skip:!native},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eightmax-native-manager-'));
 const invoke=args=>JSON.parse(cp.execFileSync(native,args,{encoding:'utf8',timeout:30000}));
 try{for(const name of ['river3','flop6']){
  const p=A.prepare(EM,{config:A.EXAMPLES[name],iterations:150,timeMs:1000}),spec=path.join(dir,name+'.json'),full=path.join(dir,name+'-full.state'),query=path.join(dir,'query.json');fs.writeFileSync(spec,JSON.stringify(p.spec));fs.writeFileSync(query,'{"path":[],"board":[],"offset":0,"limit":1326}');
  invoke([spec,'150','2',full,'256']);let latest=null,total=0,training;
  for(const [i,count] of [30,40,80].entries()){const out=path.join(dir,name+'-'+i%2+'.state'),args=[spec,String(count),'2',out,'256'];if(latest)args.push(latest);training=invoke(args);latest=out;total+=count;assert.equal(training.iterations,total);assert.equal(invoke(['--restore',spec,latest,'256']).iterations,total);}
  const a=invoke(['--node',spec,full,query,'256']),b=invoke(['--node',spec,latest,query,'256']);assert.deepEqual(b.hands.items.map(h=>h.average),a.hands.items.map(h=>h.average));
  training.requestedTotalUpdates=150;const normalized=A.validateResult(A.normalizeNative(A.nativeJob(p,'resume-test'),b,training,10));assert.equal(normalized.requestedUpdates,150);assert.equal(normalized.updates,150);assert.equal(normalized.stopped,'updates-complete');
  const partial=clone(b);partial.study.updates=149;assert.equal(A.normalizeNative(A.nativeJob(p,'resume-test'),partial,training,10).stopped,'time-budget');training.requestedTotalUpdates=10000001;assert.throws(()=>A.normalizeNative(A.nativeJob(p,'resume-test'),b,training,10));
 }}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('native restore rejects an incompatible study without modifying the last completed checkpoint',{skip:!native},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eightmax-resume-refusal-'));try{
  const spec=path.join(dir,'spec.json'),state=path.join(dir,'saved.state'),changed=path.join(dir,'different.json');fs.writeFileSync(spec,JSON.stringify(A.prepare(EM,request).spec));cp.execFileSync(native,[spec,'20','2',state,'256'],{timeout:30000});
  const spec2=A.prepare(EM,{...request,config:{...request.config,common:12}}).spec;fs.writeFileSync(changed,JSON.stringify(spec2));const before=crypto.createHash('sha256').update(fs.readFileSync(state)).digest('hex');
  const refused=cp.spawnSync(native,['--restore',changed,state,'256'],{encoding:'utf8',timeout:30000});assert.notEqual(refused.status,0);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(state)).digest('hex'),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
