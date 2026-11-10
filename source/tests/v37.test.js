'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {withHost,home}=require('./checkpoint_host'),E=require('../tools/loadlib');
for(const l of ['lib_runouts','lib_wide','lib_river','lib_archive','lib_select'])require('../web/'+l);
const archive=fs.readFileSync(path.join(__dirname,'../../validation/3.7/fixtures/eight-seat-3.6.emstudy'));
const upload=(url,route,data)=>fetch(url+'/api/checkpoint/'+route,{method:'POST',headers:{'X-EightMax':'1'},body:data});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cfg={board:'Qs9h4d2c7s',common:8,stacks:[18,20],ranges:['AsQd,KhQh,9s9c','QcJc,TdTc,As4s'],bets:'50,a',raises:'2.5x',maxBets:2,privateMode:'sampled',abstraction:'exact',evaluationDeals:128,batchDeals:4};
async function train(api,n){assert.equal((await api('mw/desktop-train',{iterations:n,threads:2})).status,200);let s;do{await wait(5);s=await(await api('mw/status')).json();}while(s.running);assert.ok(!s.error);return s.engine;}
test('trained 3.6 file resumes, publishes and survives a deleted generation index',async t=>{
 await withHost(home(t),{},async(api,url)=>{
  assert.equal((await upload(url,'native-upload',archive)).status,200);assert.equal((await api('mw/free','')).status,409);
  const s=await train(api,4);assert.equal(s.iterations,12);assert.equal((await api('checkpoint/native-save','')).status,200);
  const restored=await E.loadStudyFile(await(await api('checkpoint/latest')).blob()),ref=(await E.loadStudyFile(new Blob([archive]))).game;
  ref.iterate(4);assert.deepEqual(Buffer.from(restored.game.exportNative()),Buffer.from(ref.exportNative()));
  const dir=(await(await api('info')).json()).saveDir;fs.unlinkSync(path.join(dir,'autosave.index'));
  assert.equal((await api('checkpoint/native-latest','')).status,200);assert.equal((await(await api('mw/status')).json()).engine.rng,s.rng);
 });
});
test('corrupt native restoration preserves the open study and previous save',async t=>{
 await withHost(home(t),{},async(api,url)=>{
  assert.equal((await upload(url,'write',archive)).status,200);assert.equal((await api('checkpoint/native-latest','')).status,200);
  const old=(await(await api('mw/status')).json()).engine,bad=Buffer.from(archive);bad[bad.length-1]^=1;
  assert.equal((await upload(url,'native-upload',bad)).status,400);assert.deepEqual((await(await api('mw/status')).json()).engine,old);
  assert.deepEqual(Buffer.from(await(await api('checkpoint/latest')).arrayBuffer()),archive);
 });
});
test('two-generation retention keeps the previous valid generation',async t=>{
 await withHost(home(t),{EIGHTMAX_CHECKPOINT_GENERATIONS:'2'},async(api,url)=>{
  for(let i=0;i<4;i++)assert.equal((await upload(url,'write',archive)).status,200);
  const s=await(await api('checkpoint/status')).json();assert.equal(s.generation,'4');assert.equal(s.retainedGenerations,2);assert.equal(s.slots.filter(x=>x===200).length,2);
  assert.equal((await api('checkpoint/native-previous','')).status,200);
 });
});
test('insufficient live table RAM leaves the generation available',async t=>{
 const game=(await E.loadStudyFile(new Blob([archive]))).game;game.iterate(96);game.importNative(game.exportNative());
 const encoded=await E.archiveBlob(game.archiveState(['UTG','UTG+1','MP','HJ','CO','BTN','SB','BB']));const large=Buffer.from(await encoded.blob.arrayBuffer());
 await withHost(home(t),{EIGHTMAX_RESTORE_MIB:'1'},async(api,url)=>{
  assert.equal((await upload(url,'write',large)).status,200);
  const r=await api('checkpoint/native-latest','');assert.equal(r.status,503);
  assert.deepEqual(Buffer.from(await(await api('checkpoint/latest')).arrayBuffer()),large);
 });
});
test('disk forecast with compressed expansion preserves predecessor',async t=>{
 await withHost(home(t),{EIGHTMAX_CHECKPOINT_RESERVE_MIB:'0',EIGHTMAX_TEST_CHECKPOINT_DISK_BYTES:String(40*1048576)},async(api,url)=>{
  assert.equal((await upload(url,'write',archive)).status,200);
  const bad=Buffer.from(archive);bad.writeBigUInt64LE(64n*1048576n,16);assert.equal((await upload(url,'write',bad)).status,507);
  const s=await(await api('checkpoint/status')).json();assert.equal(s.generation,'1');assert.ok(s.estimatedNextSaveBytes>s.sizeBytes);
 });
});
test('restoring a truncated native file keeps the open engine',async t=>{
 await withHost(home(t),{},async(api,url)=>{
  assert.equal((await upload(url,'native-upload',archive)).status,200);assert.equal((await upload(url,'native-upload',archive.subarray(0,-7))).status,400);
  assert.equal((await(await api('mw/status')).json()).engine.iterations,8);
 });
});
test('long DCFR discounts include binary64 subnormals',()=>{
 const d=E.dcfrSchedule(1.5,0,2);for(const n of [1,999,1000,1001,1022,1073,1074,1075])assert.equal(d.factors(0,n)[1],2**-n);
});
test('optional fold baseline agrees across engines and resumes byte-exactly',t=>{
 const dir=home(t),config={...cfg,terminalBaseline:true,traversal:'external',actionStreams:'deal',privateSeed:839};
 const g=E.MultiwayGame(config),spec=path.join(dir,'spec'),state=path.join(dir,'state'),continued=path.join(dir,'continued');
 const cli=process.env.EM_TEST_MWCLI||require('./native_build').cli().cli;fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));
 cp.execFileSync(cli,[spec,'80','2',state,'256']);g.iterate(80);const ref=E.MultiwayGame(config);ref.importNative(fs.readFileSync(state));
 assert.deepEqual(E.exactCheckSampled(config,ref).gain,E.exactCheckSampled(config,g).gain);
 cp.execFileSync(cli,[spec,'10','1',continued,'256',state]);cp.execFileSync(cli,[spec,'90','1',state,'256']);assert.deepEqual(fs.readFileSync(continued),fs.readFileSync(state));
});
test('the selector skips short studies and fully constrained manual choices',async()=>{
 const run=()=>{throw Error('unexpected pilot');};assert.ok((await E.selectByTrials(cfg,run,undefined,undefined,{updates:8,backend:'cpu'})).earlyExit);
 const r=await E.selectByTrials({...cfg,traversal:'full',regretMatching:'standard',weighting:'linear'},run,undefined,undefined,{updates:1500,backend:'cpu'});assert.ok(r.earlyExit);assert.equal(r.cfg.traversal,'full');
});
test('measured calibration is reused only for matching configurations',async()=>{
 const c={...cfg,traversal:'external',weighting:'linear',regretMatching:'standard'},study={updates:10000,backend:{device:'cpu',threads:1}};let calls=0;
 const pilot=async g=>{calls++;g.iterate(4);return {seconds:.01};};
 const first=await E.selectByTrials(c,pilot,undefined,undefined,study);assert.ok(first.trials.length>=6);const n=calls;
 const next=await E.selectByTrials({...c},pilot,undefined,undefined,study);assert.ok(next.reused);assert.equal(calls,n);
 await E.selectByTrials({...c,common:9},pilot,undefined,undefined,study);assert.ok(calls>n);
});
test('desktop root hand probabilities correspond to the native checkpoint average tables',async t=>{
 await withHost(home(t),{},async(api,url)=>{
  assert.equal((await upload(url,'native-upload',archive)).status,200);const s=await(await api('mw/desktop-policy')).json();
  assert.equal(s.hands.length,1326);assert.ok(s.hands.some(h=>h.observed));for(const h of s.hands)assert.ok(Math.abs(h.probabilities.reduce((a,b)=>a+b,0)-1)<1e-12);
  const g=(await E.loadStudyFile(new Blob([archive]))).game,raw=Buffer.from(g.exportNative(true)),base=12+raw.readUInt32LE(8);
  let p=base+4+9*raw.readUInt32LE(base),n=raw.readUInt32LE(p),compared=0;p+=4;
  for(let j=0;j<n;j++){
   const sid=raw.readUInt32LE(p),hand=raw.readUInt16LE(p+4),k=raw[p+11];p+=12;
   if(sid===0){const vals=Array.from({length:k},(_,a)=>raw.readDoubleLE(p+8*(k+a))),sum=vals.reduce((a,b)=>a+b,0);
    if(sum){for(let a=0;a<k;a++)assert.ok(Math.abs(s.hands[hand].probabilities[a]-vals[a]/sum)<1e-12);compared++;}}
   p+=16*k;
  }assert.ok(compared);
 });
});
