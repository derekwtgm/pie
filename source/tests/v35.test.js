'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),test=require('node:test'),crypto=require('crypto');
const {withHost,home}=require('./checkpoint_host'),{execFileSync}=require('child_process');
const E=require('../tools/loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const fixture=require('./fixtures/checkpoints-2.5.json'),a=fixture.exact.text,b=fixture.wide.text;
const envelope=p=>{const raw=JSON.stringify(p);return JSON.stringify({payload:p,sha256:crypto.createHash('sha256').update(raw).digest('hex'),payloadBytes:Buffer.byteLength(raw)});};
function variant(label){const p=JSON.parse(a).payload;p.labels=p.labels.map((_,i)=>label+i);return envelope(p);}
const c=variant('C'),d=variant('D');
const status=async api=>(await api('checkpoint/status')).json();
const write=(api,v)=>api('checkpoint/write',v);
const dir=async api=>(await(await api('info')).json()).saveDir;
const slot=(f,i)=>path.join(f,'autosave.'+i+'.em35');
async function save(api,...vs){for(const v of vs){const r=await write(api,v);assert.equal(r.status,200,await r.text());}}
async function read(api,k){const r=await api('checkpoint/'+k);assert.equal(r.status,200);return r.text();}
for(const mode of ['missing','stale','corrupt','truncated'])test('index recovery: '+mode,async t=>withHost(home(t),{},async api=>{
 const f=await dir(api),index=path.join(f,'autosave.index');await save(api,a,b);
 const stale=fs.readFileSync(index);await save(api,c,d);
 const before=[0,1,2].map(i=>fs.readFileSync(slot(f,i)));
 if(mode==='missing')fs.unlinkSync(index);else fs.writeFileSync(index,mode==='stale'?stale:mode==='corrupt'?'junk':'1');
 for(let i=0;i<3;i++)fs.utimesSync(slot(f,i),100,100);
 const health=await status(api);assert.equal(health.reconstructed,true);assert.equal(health.generation,'4');
 assert.deepEqual([0,1,2].map(i=>fs.readFileSync(slot(f,i))),before);
 assert.equal(await read(api,'latest'),d);assert.equal(await read(api,'previous'),c);
 await save(api,b);assert.equal(await read(api,'previous'),d);
}));
test('ambiguous legacy remains downloadable and explicitly adoptable without overwrites',async t=>withHost(home(t),{},async api=>{
 const f=await dir(api),p=['autosave.emstudy','autosave.previous.emstudy','autosave.third.emstudy'].map(n=>path.join(f,n));
 [a,b,c].forEach((v,i)=>fs.writeFileSync(p[i],v));assert.equal((await status(api)).indexHealth,'ambiguous');
 assert.equal((await write(api,d)).status,409);assert.equal((await api('checkpoint/latest')).status,409);
 for(const [i,v] of [a,b,c].entries())assert.equal(await read(api,'legacy-'+i),v);
 assert.equal((await api('checkpoint/adopt-1','{}')).status,200);await save(api,d);
 assert.equal(await read(api,'previous'),b);assert.deepEqual(p.map(x=>fs.readFileSync(x,'utf8')),[a,b,c]);
}));
test('healthy 3.4 index migrates with original files retained',async t=>withHost(home(t),{},async api=>{
 const f=await dir(api);fs.writeFileSync(path.join(f,'autosave.index'),'10');
 fs.writeFileSync(path.join(f,'autosave.emstudy'),a);fs.writeFileSync(path.join(f,'autosave.previous.emstudy'),b);
 await save(api,c);assert.equal(await read(api,'previous'),b);assert.equal(await read(api,'legacy-0'),a);assert.equal(await read(api,'legacy-1'),b);
}));
test('damage and removal skip invalid generations while retaining the previous high-water mark',async t=>withHost(home(t),{},async api=>{
 await save(api,a,b,c);const f=await dir(api);fs.unlinkSync(slot(f,1));fs.writeFileSync(slot(f,2),'bad');
 assert.equal(await read(api,'latest'),a);await save(api,d);assert.equal((await status(api)).generation,'4');assert.equal(fs.readFileSync(slot(f,2),'utf8'),'bad');
}));
test('multiple corruptions fail closed and preserve survivors',async t=>withHost(home(t),{},async api=>{
 await save(api,a,b,c);const f=await dir(api);fs.unlinkSync(path.join(f,'autosave.index'));const frame=fs.readFileSync(slot(f,2));frame[80]^=1;fs.writeFileSync(slot(f,2),frame);
 assert.equal((await status(api)).indexHealth,'incomplete history');assert.equal(await read(api,'latest'),b);assert.equal(await read(api,'previous'),a);assert.equal((await write(api,d)).status,409);assert.ok(frame.equals(fs.readFileSync(slot(f,2))));
}));
test('duplicate sequences expose candidates without rotating',async t=>withHost(home(t),{},async api=>{
 await save(api,a,b);const f=await dir(api);fs.copyFileSync(slot(f,1),slot(f,2));
 assert.equal((await status(api)).indexHealth,'ambiguous');assert.equal((await write(api,c)).status,409);assert.equal(await read(api,'slot-2'),b);
}));
test('concurrent hosts serialize acknowledged commits; rejected requests can retry',async t=>{
 const h=home(t);await withHost(h,{},first=>withHost(h,{},async second=>{
  const rs=await Promise.all(Array.from({length:12},(_,i)=>write(i%2?first:second,variant(String(i)))));
  const accepted=rs.filter(r=>r.status===200).length;assert.ok(accepted>0);assert.equal((await status(first)).generation,String(accepted));
  for(const [i,r] of rs.entries())if(r.status!==200){assert.equal(r.status,503);await save(first,variant(String(i)));}
  assert.deepEqual((await status(first)).sequences.map(Number).sort((x,y)=>x-y),[10,11,12]);
 }));
});
for(const fault of ['validation','temp-create','write','flush','rotation','replace','after-slot','published','index-update','ack','reconstruction'])
test('interruption at '+fault,async t=>{
 const h=home(t);let index;
 await withHost(h,{},async api=>{await save(api,a,b,c);index=path.join(await dir(api),'autosave.index');});
 if(fault==='reconstruction')fs.unlinkSync(index);
 await withHost(h,{EIGHTMAX_TEST_CHECKPOINT_FAULT:fault},async api=>{
  if(['ack','published','after-slot'].includes(fault))await assert.rejects(write(api,d));else assert.ok((await write(api,d)).status>=500);
 });
 await withHost(h,{},async api=>{
  const committed=['ack','published','index-update'].includes(fault);
  assert.equal(await read(api,'latest'),committed?d:c);assert.equal(await read(api,'previous'),committed?c:b);
  await save(api,a);assert.equal((await status(api)).generation,committed?'5':'4');
 });
});
test('six-player 2 MiB stop, interrupted autosave, index recovery and byte-identical native continuation',async t=>{
 const h=home(t),cfg={board:'Td7c2h',dealt:8,common:1.5,stacks:[20,35,8,50,14,26],prior:Array(6).fill(2.5),folded:[1,2.5],ranges:Array(6).fill('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.6'),privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:128,streets:{flop:{bets:'33',raises:'',maxBets:1},turn:{bets:'50',raises:'',maxBets:1},river:{bets:'75',raises:'',maxBets:1}},batchDeals:4,actionStreams:'deal'};
 const cli=process.env.EM_TEST_MWCLI||require('./native_build').cli().cli,g=E.MultiwayGame(cfg),file=n=>path.join(h,n);fs.writeFileSync(file('spec'),JSON.stringify(g.nativeSpec()));
 const run=(it,mib,name,from)=>JSON.parse(execFileSync(cli,[file('spec'),String(it),'2',file(name),String(mib),...(from?[file(from)]:[])]));
 const low=run(5000,2,'low');assert.ok(low.limitReached);assert.equal(low.trainingDeals,low.iterations*4);g.importNative(fs.readFileSync(file('low')));
 const text=envelope(g.snapshot());let index;
 await withHost(h,{},async api=>{await save(api,b,text);index=path.join(await dir(api),'autosave.index');});
 await withHost(h,{EIGHTMAX_TEST_CHECKPOINT_FAULT:'after-slot'},async api=>{await assert.rejects(write(api,a));});
 fs.unlinkSync(index);await withHost(h,{},async api=>{const saved=await read(api,'latest');assert.equal(saved,text);fs.writeFileSync(file('restored'),E.restoreCheckpoint(JSON.parse(saved).payload).game.exportNative(true));});
 run(5,256,'resumed','restored');run(low.iterations+5,256,'direct');assert.ok(fs.readFileSync(file('resumed')).equals(fs.readFileSync(file('direct'))));
});
test('JavaScript calibrated turn respects manual and restored traversal',()=>{
 const cfg={board:'Qs9h4d2c',common:10,stacks:[24,24],ranges:['AsQd:0.6,KhQh,9s9c,JhTh,8d7d,AhKd','QcJc,TdTc,As4s,KdJd,6s5s,9d8d'],bets:'60',raises:'',maxBets:1,privateMode:'sampled',abstraction:'detailed',batchDeals:4,engine:'javascript',evaluationDeals:128};
 const auto=E.MultiwayGame(cfg),full=E.MultiwayGame({...cfg,traversal:'full'});assert.equal(auto.traversalSelection.chosen,'full traversal');
 assert.equal(E.MultiwayGame(cfg,{restoredExternal:true}).traversalSelection.chosen,'external sampling');auto.iterate(100);full.iterate(100);assert.deepEqual(auto.snapshot().state,full.snapshot().state);
});
test('CUDA driver fixture enforces reduced VRAM budgets on reused batches',{skip:process.platform!=='linux'},t=>{
 const exe=path.join(home(t),'budget');
 execFileSync('g++',['-std=c++20','-O2','-I'+path.join(__dirname,'../native'),path.join(__dirname,'score_budget35.cpp'),'-ldl','-o',exe]);
 execFileSync(exe,[],{env:{...process.env,LD_LIBRARY_PATH:require('./native_build').cli().fixtureDir}});
});
