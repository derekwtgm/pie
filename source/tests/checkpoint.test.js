'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../tools/loadlib');
for(const lib of ['lib_runouts','lib_wide','lib_river','lib_quality','worker'])require('../web/'+lib+'.js');
const small={board:'2c4d7h9sJc',common:10,stacks:[10,10,10],ranges:['AsAd,KsTh','QhQd,AsKc','JhJd,8c8d'],bets:'a',raises:'',maxBets:1,privateSeed:17,evaluationDeals:128};
for(const traversal of ['full','external'])for(const abstraction of ['compact','detailed','exact']){
 test(`Wide ${traversal}/${abstraction} checkpoint resumes bit-for-bit`,async()=>{
  const cfg={...small,privateMode:'sampled',traversal,abstraction},g=E.MultiwayGame(cfg);g.iterate(123);
  const text=await E.encodeCheckpoint(g.snapshot(['A','B','C']));const restored=E.restoreCheckpoint(await E.decodeCheckpoint(text)).game;
  assert.deepEqual(restored.metrics(),g.metrics());assert.deepEqual(restored.view(),g.view());
  g.iterate(321);restored.iterate(321);assert.deepEqual(restored.metrics(),g.metrics());assert.deepEqual(restored.snapshot(),g.snapshot());
 });
}
test('Enumerated seeded-turn ICM checkpoints restore regrets, averages and iteration weights',async()=>{
 const cfg={...small,board:'2c4d7h9s',stacks:[2,2,2],runouts:{mode:'sampled',count:2,seed:90},icm:{payouts:[50,30,20]}},g=E.MultiwayGame(cfg);g.iterate(37);
 const restored=E.restoreCheckpoint(await E.decodeCheckpoint(await E.encodeCheckpoint(g.snapshot()))).game;
 g.iterate(63);restored.iterate(63);assert.deepEqual(restored.metrics(),g.metrics());assert.deepEqual(restored.snapshot(),g.snapshot());
});
test('Six-player linked preflop ICM preserves both independent random streams',async()=>{
 const cfg={preflop:{mode:'linked',opens:'2',raises:'',maxBets:1},board:'',dealt:8,common:0,stacks:Array(6).fill(8),ranges:Array(6).fill('random'),privateMode:'sampled',evaluationDeals:128,bets:'50',raises:'',maxBets:1,icm:{payouts:[50,30,20],others:[25,25]}};
 const g=E.MultiwayGame(cfg);g.iterate(21);const copy=E.restoreCheckpoint(await E.decodeCheckpoint(await E.encodeCheckpoint(g.snapshot()))).game;
 g.view([]);const probe=g.responseProbe(0);probe.iterate(100);probe.finish();g.iterate(29);copy.iterate(29);assert.deepEqual(g.metrics(),copy.metrics());
});
test('Eight-player linked preflop-to-river resumes exactly from a checkpoint',async()=>{
 const cfg={preflop:{mode:'linked',opens:'2,a',raises:'2.75x,a',maxBets:3,limps:true},board:'',dealt:8,common:0,stacks:Array(8).fill(24.9),ranges:Array(8).fill('random'),privateMode:'sampled',evaluationDeals:128,
  streets:{flop:{bets:'33,75',raises:'',maxBets:1},turn:{bets:'75',raises:'',maxBets:1},river:{bets:'75,g',raises:'',maxBets:1}}};
 const g=E.MultiwayGame(cfg);g.iterate(300);const copy=E.restoreCheckpoint(await E.decodeCheckpoint(await E.encodeCheckpoint(g.snapshot()))).game;
 g.view([]);g.iterate(200);copy.iterate(200);const m=g.metrics();assert.deepEqual(m,copy.metrics());
 assert.ok(Math.abs(m.ev.reduce((a,b)=>a+b,0))<1e-9,'eight dealt seats are zero-sum');
});
test('Corrupt, incompatible and non-finite checkpoints are rejected',async()=>{
 const g=E.MultiwayGame({...small,privateMode:'sampled'});g.iterate(5);
 const text=await E.encodeCheckpoint(g.snapshot());await assert.rejects(E.decodeCheckpoint(text.replace('"iterations":5','"iterations":6')),/checksum/);
 const bad=g.snapshot();bad.engine='older-engine';assert.throws(()=>E.restoreCheckpoint(bad),/incompatible/);
 const duplicate=g.snapshot();duplicate.state.records.push(duplicate.state.records[0]);assert.throws(()=>E.restoreCheckpoint(duplicate),/incompatible/);
 const wrong=g.snapshot();wrong.state.records[0].path='r666666';assert.throws(()=>E.restoreCheckpoint(wrong),/incompatible/);
 const nan=g.snapshot();const row=nan.state.pools[0],buf=Buffer.from(row.blocks[0],'base64');buf.writeDoubleLE(NaN);row.blocks[0]=buf.toString('base64');assert.throws(()=>E.restoreCheckpoint(nan),/incompatible/);
});
test('A saved memory stop can continue after increasing the budget',()=>{
 const cfg={...small,board:'2c4d7h',stacks:Array(6).fill(20),ranges:Array(6).fill('random'),dealt:8,privateMode:'sampled',traversal:'external',bets:'25,50',raises:'2x',maxBets:2,strategyBudgetMiB:1};
 const g=E.MultiwayGame(cfg);g.iterate(5000);assert.equal(g.limitReached,true);const copy=E.restoreCheckpoint(g.snapshot()).game;
 assert.throws(()=>copy.increaseBudget(.5),/budget/);g.increaseBudget(2);copy.increaseBudget(2);const before=g.iterations;g.iterate(20);copy.iterate(20);assert.ok(g.iterations>before);assert.deepEqual(copy.metrics(),g.metrics());
});
function port(){let id=0;const pending=new Map(),self={postMessage(m){const p=pending.get(m.id);if(!p||m.type==='progress')return;pending.delete(m.id);m.type==='error'?p.reject(Error(m.message)):p.resolve(m.result);}};E.workerMain(self);return(type,data={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});self.onmessage({data:{type,id,...data}});});}
test('Worker export, failed load, successful load and resume preserve the active study',async()=>{
 const ask=port(),cfg={...small,privateMode:'sampled'};
 const original=await ask('multi-solve',{cfg,maxIter:25,target:0}),saved=await ask('multi-export',{labels:['A','B','C']});
 await assert.rejects(ask('multi-load',{text:'bad'}));assert.deepEqual(await ask('multi-node',{path:[]}),original.node);
 const loaded=await ask('multi-load',{text:saved.text});assert.equal(loaded.labels[1],'B');assert.equal(loaded.metrics.iterations,25);
 const resumed=await ask('multi-resume',{iterations:75,target:0,memoryMiB:112}),reference=E.MultiwayGame(cfg);reference.iterate(100);assert.deepEqual(resumed.metrics,reference.metrics());
});
