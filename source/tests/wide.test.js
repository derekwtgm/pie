'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../tools/loadlib');
for(const lib of ['lib_runouts','lib_wide','lib_river','lib_deep','lib_deeplib','worker'])require('../web/'+lib+'.js');
const near=(x,y,t)=>assert.ok(Number.isFinite(x)&&Math.abs(x-y)<t,x+' versus '+y);
const cfg={board:'2c4d7h9sJc',common:10,stacks:[10,10,0],ranges:['QhQd','AsAd,KsTh','5s3d'],lead:[false,true,false],bets:'a',maxBets:1,privateMode:'sampled',privateSeed:17};
test('Fresh-deal training approximates the independently known pot-size bluff game',()=>{
 const g=E.MultiwayGame(cfg);g.iterate(30000);const m=g.metrics();
 near(g.view([0]).hands.find(h=>h.cards==='KsTh').mix[1],.5,.035);
 near(g.view([0,1]).hands[0].mix[1],.5,.035);
 near(m.ev[0],2.5,3*m.se[0]);assert.equal(m.maxGain,undefined);assert.equal(m.evaluationDeals,4096);
});
test('Whole-tuple resampling preserves weighted blocker-conditioned marginals',()=>{
 const g=E.MultiwayGame({...cfg,lead:[true,true,true],ranges:['AsAd:0.75,KsTh:0.25','AsKc,QhQd','5s3d'],evaluationDeals:8192});
 const r=g.view();near(r.hands.find(h=>h.cards==='AsAd').mass/8192,.6,.024);
 assert.throws(()=>E.MultiwayGame({...cfg,ranges:['AsAd','AsKc','5s3d']}).iterate(1),/Compatible hands/);
});
test('Sampled full-deck flop runouts reproduce exact equity including unequal side pots',()=>{
 const c={...cfg,board:'2c4d7h',stacks:[0,0,0],prior:[15,40,40],ranges:['AsAd','KsKd','QhQd'],common:0};
 const x=E.MultiwayGame({...c,privateMode:'exact'}).metrics(),s=E.MultiwayGame(c).metrics();
 s.ev.forEach((v,i)=>near(v,x.ev[i],4*s.se[i]));near(s.ev.reduce((a,b)=>a+b),95,1e-8);
});
test('Inspection uses an independent random stream and leaves training deterministic',()=>{
 const a=E.MultiwayGame(cfg), b=E.MultiwayGame(cfg);a.iterate(100);a.metrics();a.view();a.iterate(100);b.iterate(200);
 assert.deepEqual(a.metrics(),b.metrics());
});
test('25bb chart reaches a button open and two blind calls with all three full ranges',()=>{
 const m=E.DeepTree({n:8,stack:25}),lib=E.DEEP_LIB;
 m.load(lib.data[25].replace(/\.(.)(.)/g,(_,c,i)=>c.repeat(4+lib.alph.indexOf(i))));
 const r=m.reachAt([...Array(5).fill('Fold'),'Raise 2','Call 1.5','Call 1']),w=m.view(r.id),ps=[6,7,5];
 const c={...cfg,board:'2c4d7h',common:0,dealt:8,prior:ps.map(p=>w.cb[p]),stacks:ps.map(p=>w.behind[p]),
 ranges:ps.map(p=>Float32Array.from(E.CLS,h=>r.reach[p][h])),bets:'50',lead:[true,true,true],evaluationDeals:128};
 assert.deepEqual(c.ranges.map(range=>range.filter(x=>x>0).length),[76,472,550]);
 assert.throws(()=>E.MultiwayGame({...c,privateMode:'exact'}),/Too many compatible/);
 const g=E.MultiwayGame(c);g.iterate(75);near(g.metrics().ev.reduce((a,b)=>a+b),6.8,1e-8);
});
test('Wide explorer preserves folded card removal and supports a five-way side-pot line',()=>{
 const g=E.MultiwayGame({...cfg,board:'2c4d7h9s',stacks:[0,4,4,4,4],prior:[3,3,3,3,3],common:0,
 ranges:['AsAd','KsKd','QhQd','8c8d','6h6s'],lead:Array(5).fill(true),bets:'a',evaluationDeals:128});
 g.iterate(20);const q=g.view([0,0,0,0]);assert.equal(q.kind,'chance');assert.equal(q.cards.length,38);
 near(q.cards.reduce((s,c)=>s+c.prob,0),1,1e-10);
 const terminal=g.view([1,1,0,0]);assert.equal(terminal.kind,'terminal');
 assert.deepEqual(terminal.pots,[{amount:15,eligible:[0,1,2]},{amount:8,eligible:[1,2]}]);
});

test('Wide six-way play retains folded cards and gives seat six the contested side pot',()=>{
 const c={...cfg,board:'2c4d7h9s',stacks:[0,4,4,4,4,4],prior:Array(6).fill(2),common:0,dealt:8,
   folded:[0.5,1],ranges:['AsAd','KsKd','QhQd','8c8d','6h6s','TsTc'],lead:Array(6).fill(true),bets:'a',evaluationDeals:256};
 const g=E.MultiwayGame(c);g.iterate(20);const root=g.view();
 near(root.pot,14.3,1e-9);
 const afterChecks=g.view([0,0,0,0,0]);assert.equal(afterChecks.cards.length,36);
 const p=[1,0,0,0,1]; // Seat two shoves, seats three to five fold, seat six calls.
 const terminal=g.view(p);assert.deepEqual(terminal.live,[true,true,false,false,false,true]);
 assert.deepEqual(terminal.pots.map(x=>x.eligible),[[0,1,5],[1,5]]);
 near(terminal.pots[0].amount,14.3,1e-9);near(terminal.pots[1].amount,8,1e-9);
 const river={...c,board:'2c4d7h9sTh'};
 for(const privateMode of ['exact','sampled']){
   const game=E.MultiwayGame({...river,privateMode});const awarded=game.view(p);
   near(awarded.ev[5],18.3,1e-8);near(awarded.ev[1],-4,1e-9);
 }
});
