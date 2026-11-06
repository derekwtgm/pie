'use strict';
// 2.4 upgrades: ante structures, geometric sizing, linear MCCFR weighting, lock guard.
const test=require('node:test'),assert=require('node:assert/strict');
process.env.EXTRA_LIBS='lib_postflop.js';
const E=require('../tools/loadlib');
for(const lib of ['lib_runouts','lib_wide','lib_river','worker'])require('../web/'+lib+'.js');
const near=(x,y,t=1e-9)=>assert.ok(Number.isFinite(x)&&Math.abs(x-y)<t,x+' versus '+y);
const R='23456789TJQKA',S='cdhs',card=s=>R.indexOf(s[0])*4+S.indexOf(s[1]);
const shove={preflop:{mode:'shove'},dealt:8,common:0,board:'',privateMode:'sampled',stacks:[10,10,10],ranges:['random','random','random']};

test('Big blind ante posts once from the BB; no-ante posts only blinds',()=>{
  const bba=E.MultiwayGame({...shove,anteType:'bba',ante:1}).view([]);
  near(bba.pot,2.5);assert.deepEqual(bba.behind.map(x=>+x.toFixed(6)),[10,9.5,8]);
  const none=E.MultiwayGame({...shove,anteType:'none'}).view([]);near(none.pot,1.5);
  const classic=E.MultiwayGame(shove).view([]);near(classic.pot,2.3);
});
test('Chip EV sums to the dead antes of folded dealt seats',()=>{
  for(const [anteType,dead] of [['classic',0.5],['bba',0],['none',0]]){
    const g=E.MultiwayGame({...shove,anteType});g.iterate(200);
    near(g.metrics().ev.reduce((a,b)=>a+b),dead,1e-8);
  }
});
test('Push/fold accepts a big blind ante',()=>{
  const g=E.PushFold({n:2,stacks:[10,10],anteType:'bba',ante:1});g.solve({maxIter:3000,tol:1e-6});
  const r=g.results();assert.deepEqual(r.posted.ante,[0,1]);assert.ok(r.jam[0].pct>58);
});
test('Geometric bets reach all-in on the river at a constant pot fraction',()=>{
  const g=E.MultiwayGame({board:'2c4d7h',common:10,stacks:[45,45],ranges:['AsAd','KsKd'],runouts:{mode:'sampled',count:1,seed:3},
    streets:{flop:{bets:'g',raises:'',maxBets:1},turn:{bets:'g',raises:'',maxBets:1},river:{bets:'g',raises:'',maxBets:1}}});
  const f=Math.cbrt(10)-1;
  assert.equal(g.view([]).actions[1].label,'Bet '+String(+(f/2*10).toFixed(3)));
  let p=[1,1];p.push({card:g.view(p).cards[0].card});p.push(1,1);p.push({card:g.view(p).cards[0].card});
  assert.match(g.view(p).actions[1].label,/^All-in/);
  assert.throws(()=>E.MultiwayGame({board:'2c4d7h',common:10,stacks:[45,45],ranges:['AsAd','KsKd'],bets:'50',raises:'g'}),/Geometric/);
});
test('Linear weighting is the default and 2.3 checkpoints resume uniformly',async()=>{
  const cfg={board:'2c4d7h9sJc',common:10,stacks:[10,10,0],ranges:['QhQd','AsAd,KsTh','5s3d'],lead:[false,true,false],bets:'a',maxBets:1,privateMode:'sampled'};
  const g=E.MultiwayGame(cfg);g.iterate(50);assert.equal(g.metrics().weighting,'linear');
  const snap=g.snapshot(['A','B','C']);assert.equal(snap.engine,'multiway-2.4');assert.equal(snap.cfg.weighting,'linear');
  const old=E.MultiwayGame({...cfg,weighting:'uniform'});old.iterate(50);
  const legacy=old.snapshot(['A','B','C']);legacy.engine='multiway-2.3';delete legacy.cfg.weighting;
  const back=E.restoreCheckpoint(legacy);assert.equal(back.cfg.weighting,'uniform');
  back.game.iterate(50);old.iterate(50);assert.deepEqual(back.game.metrics(),old.metrics());
  assert.throws(()=>E.MultiwayGame({...cfg,weighting:'square'}),/weighting/);
});
test('Locks after a suit-twin turn card are refused unless isomorphism is off',()=>{
  const rng=Array(1326).fill(0);for(let i=0;i<1326;i++)if((E.C1[i]>>2)>=9&&(E.C2[i]>>2)>=9)rng[i]=1;
  for(const iso of [1,0]){
    const g=E.PostflopGame({board:['Ks','7s','2s'].map(card),pot:6,stack:20,maxBets:2,forceAllin:0.2,ranges:[rng,rng],iso,
      sizes:{bet:[[[50],[50]],[[75],[75]],[[75],[75]]],raise:[[[],[]],[[],[]],[[],[]]]}});
    g.iterate(2);const path=[0,0,card('Ah')],info=g.nodeInfo(path,true),st=new Float32Array(info.strategy.length).fill(1/info.actions.length);
    if(iso)assert.throws(()=>g.lock(path,st),/suit-equivalent/);else g.lock(path,st);
  }
});
