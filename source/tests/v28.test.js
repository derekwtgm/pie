'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../tools/loadlib');
for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l+'.js');
const cfg={board:'2c4d7h9sJc',common:10,stacks:[11,20,32],ranges:['QhQd:0.8,9c9d','AsAd,KsTh:0.4','JhJd,8s8d'],privateMode:'sampled',abstraction:'exact',bets:'50,100',raises:'a',maxBets:2,evaluationDeals:128,privateSeed:21,batchDeals:4};
test('stratified weighted river preserves RNG and regret state across checkpoint',async()=>{
 const g=E.MultiwayGame({...cfg,riverStrata:true});g.iterate(90);
 assert.equal(g.metrics().dealSampler,'stratified joint river');
 const r=E.restoreCheckpoint(await E.decodeCheckpoint(await E.encodeCheckpoint(g.snapshot()))).game;
 g.iterate(60);r.iterate(60);assert.deepEqual(g.snapshot(),r.snapshot());assert.equal(g.trainingDeals,600);
 assert.ok(Number.isFinite(E.exactCheckSampled({...cfg,riverStrata:true},g).maxGain));
});
test('actual private deal counter includes seat-specific alternate traversals',()=>{
 const g=E.MultiwayGame({...cfg,updates:'alternating'});g.iterate(3);assert.equal(g.trainingDeals,36);
 const before=g.trainingDeals;g.metrics();g.rootFrequencies();assert.equal(g.trainingDeals,before);
});
test('intermediate root diagnostics normalize without changing training state',()=>{
 const g=E.MultiwayGame(cfg);g.iterate(32);const a=g.snapshot(),acts=g.rootFrequencies();
 assert.ok(Math.abs(acts.reduce((sum,x)=>sum+x.frequency,0)-1)<1e-10);assert.deepEqual(a,g.snapshot());
});
test('large ranges and external traversal report independent sampling',()=>{
 const g=E.MultiwayGame({...cfg,riverStrata:true,traversal:'external'});g.iterate(5);
 assert.equal(g.metrics().dealSampler,'independent rejection');
});
