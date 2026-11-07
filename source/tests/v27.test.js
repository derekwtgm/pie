'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../tools/loadlib');
for(const l of ['lib_runouts','lib_wide','lib_river','lib_river_ui'])require('../web/'+l+'.js');
const base={board:'2c4d7h9sJc',common:10,stacks:[10,10,10],ranges:['QhQd,9c9d','AsAd,KsTh','JhJd,8s8d'],bets:'50',raises:'',maxBets:1,privateMode:'sampled',abstraction:'exact',evaluationDeals:128,privateSeed:9};
for(const traversal of ['full','external'])for(const regretMatching of ['standard','plus']){
 test(`batch ${traversal}/${regretMatching}: deterministic, normalized, resumable`,async()=>{
  const cfg={...base,traversal,regretMatching,batchDeals:4},g=E.MultiwayGame(cfg),b=E.MultiwayGame(cfg);
  g.iterate(300);b.iterate(300);assert.deepEqual(g.snapshot(),b.snapshot());
  assert.equal(g.metrics().trainingDeals,1200);assert.equal(g.metrics().batchDeals,4);
  for(const h of g.view([]).hands)assert.ok(Math.abs(h.mix.reduce((s,v)=>s+v,0)-1)<1e-12);
  const {game:r}=E.restoreCheckpoint(await E.decodeCheckpoint(await E.encodeCheckpoint(g.snapshot())));
  g.iterate(100);r.iterate(100);assert.deepEqual(r.snapshot(),g.snapshot());
  if(regretMatching==='plus')for(const pool of g.snapshot().state.pools)for(const block of pool.blocks){const values=E.unpackTrainingValues(block,Math.min(256,pool.count)*2*pool.k);for(let i=0;i<values.length;i++)if(i%(2*pool.k)<pool.k)assert.ok(values[i]>=0);}
 });
}
test('batch and update limits reject invalid inputs without starting work',()=>{
 for(const batchDeals of [0,-1,1.5,65,NaN,Infinity])assert.throws(()=>E.MultiwayGame({...base,batchDeals}),/Batch/);
 assert.throws(()=>E.MultiwayGame({...base,regretMatching:'invalid'}),/regret/);
 const g=E.MultiwayGame(base);for(const c of [-1,1.2,Infinity,NaN,10000001])assert.throws(()=>g.iterate(c),/Iteration/);assert.equal(g.iterations,0);
});
test('one deterministic deal: frozen batch matches single-deal CFR',()=>{
 const cfg={...base,ranges:['QhQd','AsAd','JhJd'],traversal:'full'},a=E.MultiwayGame(cfg),b=E.MultiwayGame({...cfg,batchDeals:4});a.iterate(200);b.iterate(200);
 const av=a.view([]).hands[0].mix,bv=b.view([]).hands[0].mix;av.forEach((v,i)=>assert.ok(Math.abs(v-bv[i])<1e-12));
});
test('batch scratch allocation is accounted for and bounded',()=>{
 const a=E.MultiwayGame({...base,batchDeals:1}),b=E.MultiwayGame({...base,batchDeals:4});a.iterate(20);b.iterate(20);
 assert.ok(b.metrics().strategyMiB>a.metrics().strategyMiB);assert.ok(b.metrics().strategyMiB<=b.metrics().memoryBudgetMiB);
});
test('Balanced preset transfers explicit batch and budget settings',()=>{
 const p=E.multiwayExample(8,'River',8),c=E.multiwaySpotConfig(p);assert.equal(p.precision,'balanced');assert.equal(c.batchDeals,4);assert.equal(c.strategyBudgetMiB,112);
});
test('batched eight-player memory stop is recoverable and budgeted',async()=>{
 const c={...E.multiwaySpotConfig(E.multiwayExample(8,'Flop',8)),privateMode:'sampled',batchDeals:4,strategyBudgetMiB:1,evaluationDeals:128};
 const g=E.MultiwayGame(c);g.iterate(2000);assert.equal(g.limitReached,true);assert.ok(g.metrics().strategyMiB<=1);
 const {game:r}=E.restoreCheckpoint(await E.decodeCheckpoint(await E.encodeCheckpoint(g.snapshot())));
 g.increaseBudget(8);r.increaseBudget(8);g.iterate(10);r.iterate(10);assert.deepEqual(JSON.parse(JSON.stringify(g.snapshot())),JSON.parse(JSON.stringify(r.snapshot())));
});
