'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),
  os=require('node:os'),net=require('node:net'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process'),build=require('./native_build');
const E=require('../tools/loadlib');for(const lib of ['lib_runouts','lib_wide','lib_river'])require('../web/'+lib);
const legacy=require('./fixtures/checkpoints-2.5.json'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const slots=[0,1,2].map(i=>'autosave.'+i+'.em35');
const base={board:'Qs9h4d2c7s',stacks:[12,21,32],common:6,ranges:['22+,KJs+:0.35','44+,AJs+:0.75','66+,KQs:0.5'],privateMode:'sampled',traversal:'full',batchDeals:4,bets:'50,a',raises:'',maxBets:1,evaluationDeals:128};
const {withHost,home}=require('./checkpoint_host');
function envelope(p){const b=JSON.stringify(p);return {sha256:crypto.createHash('sha256').update(b).digest('hex'),payloadBytes:Buffer.byteLength(b),payload:p};}
test('checkpoint rejects damaged envelopes, semantics and lengths while preserving both generations',async t=>{
 await withHost(home(t),{EIGHTMAX_CHECKPOINT_MIB:"64"},async(api,url)=>{
  const write=text=>api('checkpoint/write',text),latest=legacy.exact.text,previous=legacy.wide.text;
  assert.equal((await write(previous)).status,200);assert.equal((await write(latest)).status,200);
  async function unchanged(){for(const [slot,value] of [['latest',latest],['previous',previous]])assert.equal(await (await api('checkpoint/'+slot)).text(),value);}
  const p=JSON.parse(latest).payload;
  for(const bad of ['{',latest.slice(0,-1),{}, {...envelope(p),sha256:'0'.repeat(64)},{...envelope(p),sha256:'?'.repeat(64)},
    {...envelope(p),payloadBytes:0},{...envelope(p),path:'../save'},envelope({...p,labels:null}),envelope({...p,version:2}),
    envelope({...p,state:{...p.state,records:[]}}),envelope({...p,cfg:{...p.cfg,stacks:[]}})]){
    assert.equal((await write(bad)).status,400);await unchanged();
  }
  const netRequest=require('node:http').request;
  const code=await new Promise((resolve,reject)=>{const req=netRequest(url+'/api/checkpoint/write',{method:'POST',headers:{'X-EightMax':'1','Content-Length':67108865}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(code,413);await unchanged();
  assert.equal((await api('checkpoint/bad-path','{}')).status,404);
 });
});
test('failed disk writes, file replacement and process interruption preserve the last committed pair',async t=>{
 const h=home(t);let dir,index,free;
 await withHost(h,{},async api=>{
   dir=(await(await api('info')).json()).saveDir;
   for(const x of [legacy.wide.text,legacy.exact.text])assert.equal((await api('checkpoint/write',x)).status,200);
   index=fs.readFileSync(path.join(dir,'autosave.index'),'utf8');
   free=path.join(dir,slots[3-Number(index[0])-Number(index[1])]);fs.rmSync(free,{force:true});fs.mkdirSync(free);
   assert.equal((await api('checkpoint/write',legacy.wide.text)).status,500);fs.rmdirSync(free);
 });
 for(const fault of ['replace','after-slot']){
   await withHost(h,{EIGHTMAX_TEST_CHECKPOINT_FAULT:fault},async api=>{
     if(fault==='replace')assert.equal((await api('checkpoint/write',legacy.wide.text)).status,500);
     else await assert.rejects(api('checkpoint/write',legacy.wide.text));
   });
   assert.equal(fs.readFileSync(path.join(dir,'autosave.index'),'utf8'),index);
   assert.equal(fs.readFileSync(path.join(dir,slots[+index[0]]),'utf8').slice(111),legacy.exact.text);
   assert.equal(fs.readFileSync(path.join(dir,slots[+index[1]]),'utf8').slice(111),legacy.wide.text);
 }
 await withHost(h,{},async api=>{
   fs.writeFileSync(path.join(dir,slots[+index[0]]),'torn');
   assert.equal(await(await api('checkpoint/latest')).text(),legacy.wide.text);
   assert.equal((await api('checkpoint/previous')).status,404);
   assert.equal((await api('checkpoint/write',legacy.exact.text)).status,200);
   assert.equal(await(await api('checkpoint/previous')).text(),legacy.wide.text);
 });
});
for(const route of ['solve','report','mw/train'])test(route+' startup failure rolls back and supports concurrent retry/cancel',async t=>{
 await withHost(home(t),{EIGHTMAX_TEST_FAIL_JOB_ONCE:'1'},async api=>{
   const weights=Array.from({length:1326},(_,i)=>i>1250?1:0),cfg={board:[0,9,22,31,36],pot:10,stack:10,ranges:[weights,weights],sizes:{bet:[["",""],["",""],["","100"]],raise:[["",""],["",""],["",""]]},maxBets:1};
   let body={maxIter:1000};
   if(route==='mw/train'){
     assert.equal((await api('mw/init',E.MultiwayGame({...base,abstraction:'exact'}).nativeSpec())).status,200);
     body={iterations:40000,threads:2};
   }else if(route==='report')body={cfg:JSON.stringify(cfg),flops:[[0,9,22,1]],maxIter:1};
   else assert.equal((await api('build',cfg)).status,200);
   const status=route==='mw/train'?'mw/status':route==='report'?'report':'status';
   // 4.1: /api/status carries residentMiB, a live RSS measurement that changes
   // between two reads when the machine is busy. Comparing it made this test
   // intermittent (reproduced: 1 of 12 runs under CPU load, 6.63 -> 6.66 MiB;
   // the same signature as the 4.0 Windows-runner failures). Every job-state
   // field is still compared exactly; the measurement must be a finite number.
   const job=async()=>{const j=await(await api(status)).json();if('residentMiB' in j){assert.ok(Number.isFinite(j.residentMiB));delete j.residentMiB;}return j;};
   const old=await job();
   assert.equal((await api(route,body)).status,503);
   assert.deepEqual(await job(),old);
   const codes=await Promise.all(Array.from({length:4},async()=>(await api(route,body)).status));
   assert.ok(codes.includes(200));assert.ok(codes.every(n=>n===200||n===409));
   await api(route==='mw/train'?'mw/stop':'stop',{});
   for(let i=0;i<500;i++){if(!(await(await api(status)).json()).running)return;await pause(20);}
   assert.fail('job remained active');
 });
});
function native(cfg,it,env,dir,input){
 const g=E.MultiwayGame(cfg),spec=path.join(dir,'spec'),state=path.join(dir,'state');fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));
 const info=JSON.parse(execFileSync(process.env.EM_TEST_MWCLI||build.cli().cli,[spec,String(it),'2',state,'512',...(input?[input]:[])],{env}));
 return {bytes:fs.readFileSync(state),info};
}
for(const board of ['','Qs9h4d','Qs9h4d2c','Qs9h4d2c7s'])for(const abstraction of ['compact','detailed'])
test('grouped full strategy and resumed state match JS on '+board+' '+abstraction,t=>{
 const dir=home(t),cfg={...base,board,abstraction,fullTreeStates:250000,...(board.length===6?{icm:{payouts:[50,30,20],others:[15]}}:{}),...(!board?{preflop:{mode:'linked',opens:'2',raises:'',maxBets:1},dealt:3,common:0,bets:'a',stacks:[4,5,6]}:{})},js=E.MultiwayGame(cfg),loaded=E.MultiwayGame(cfg);
 js.iterate(24);const run=native(cfg,24,process.env,dir);loaded.importNative(run.bytes);
 // Compare every key and every binary64 value, independently of allocation order.
 function rows(g){
  const {pools,records}=g.snapshot().state;
  return records.flatMap(r=>r.rows.map(([key,ix])=>{
   const b=Buffer.from(pools.find(p=>p.k===r.k).blocks[ix>>8],'base64');
   return [r.path,key,b.subarray((ix%256)*16*r.k,(ix%256+1)*16*r.k).toString('hex')].join('|');})).sort();
 }
 assert.deepEqual(rows(loaded),rows(js));
 const f=path.join(dir,'js-state');fs.writeFileSync(f,loaded.exportNative());
 loaded.importNative(native(cfg,8,process.env,dir,f).bytes);js.iterate(8);assert.deepEqual(rows(loaded),rows(js));
});
test('external sampled hybrid scoring and CUDA failure reproduce CPU strategy, RNG and counters',{skip:process.platform!=='linux'},t=>{
 const dir=home(t),cfg={...base,board:'Qs9h4d2c',abstraction:'exact',traversal:'external',batchDeals:64,actionStreams:'deal'};
 const cpu=native(cfg,4,process.env,dir);
 for(const fault of ['','oldgpu']){
  const result=native({...cfg,processingMode:'hybrid'},4,{...process.env,LD_LIBRARY_PATH:build.cli().fixtureDir,EM_FIXTURE_FAULT:fault},dir);
  assert.deepEqual(result.bytes,cpu.bytes);
  assert.match(result.info.devicePath,fault?/CPU/:/Hybrid|CPU scoring \(measured faster/);
  if(!fault)assert.ok(result.info.gpuBufferPeakBytes>0);
 }
});
