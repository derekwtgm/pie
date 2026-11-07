'use strict';
// EightMax 2.6 regressions: automatic private-range mode for 2- to 8-player
// postflop presets, tournament antes for 2-8 dealt players (including short
// stacks), exact cross-checks of sampled strategies and strategy normalization.
const assert=require('node:assert/strict'),test=require('node:test');
const E=require('../tools/loadlib');
for(const lib of ['lib_runouts','lib_wide','lib_river','lib_quality','lib_river_ui'])require('../web/'+lib+'.js');
const sum=a=>a.reduce((x,y)=>x+y,0);
const near=(x,y,t=1e-8)=>assert.ok(Number.isFinite(x)&&Math.abs(x-y)<t,`${x} vs ${y}`);

for(const n of [2,3,4,5,6,7,8])for(const start of ['Flop','Turn','River']){
  test(`${n}-player ${start} preset initializes and trains without a tree-limit error`,()=>{
    const spot=E.multiwayExample(n,start,8);
    assert.equal(spot.privateMode,'auto');
    const cfg=E.multiwaySpotConfig(spot),g=E.MultiwayGame(cfg),sel=g.modeSelection;
    assert.ok(['exact','sampled'].includes(sel.chosen),sel.reason);
    if(n>=7)assert.equal(sel.chosen,'sampled','7- and 8-player presets must not default to exact enumeration');
    assert.equal(g.resolvedConfig.privateMode,sel.chosen);
    g.iterate(sel.chosen==='exact'?3:60);
    const m=g.metrics();
    assert.equal(m.modeSelection.chosen,sel.chosen);
    assert.equal(m.ev.length,n);assert.ok(m.ev.every(Number.isFinite));
    // Chip EV from the start of the spot sums to the starting pot.
    const pot=n*2+0.8;
    if(sel.chosen==='exact')near(sum(m.ev),pot,1e-6);
    else assert.ok(Math.abs(sum(m.ev)-pot)<1e-6,'sampled payoffs conserve chips per deal');
    const root=g.view([]);
    if(root.actions)for(const h of root.hands||[])near(sum(h.mix),1,1e-9);
  });
}

test('automatic mode keeps exact enumeration for small spots and reports why',()=>{
  const cfg={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],privateMode:'auto',
    ranges:['AhKh,KdQd,8s8h','AsKd,KcJc,5d5c','Kc9c,QsQc,7d7c'],streets:{river:{bets:'50',raises:'',maxBets:1}}};
  const plan=E.planMultiwayMode(cfg);
  assert.equal(plan.chosen,'exact');assert.ok(plan.deals>0 && plan.publicStates>0 && plan.work>0);
  const wide=E.planMultiwayMode({...cfg,ranges:Array(3).fill('random')});
  assert.equal(wide.chosen,'sampled');assert.match(wide.reason,/deals|budget|search/i);
  assert.equal(E.planMultiwayMode({...cfg,preflop:{mode:'linked'},board:'',dealt:8,common:0,ranges:Array(3).fill('random')}).chosen,'sampled');
});

test('seven- and eight-player presets with exact enumeration forced still report the budget error',()=>{
  for(const n of [7,8]){
    const cfg={...E.multiwaySpotConfig(E.multiwayExample(n,'River',8)),privateMode:'exact'};
    assert.throws(()=>E.MultiwayGame(cfg),/desktop budget|Too many compatible|too large/);
  }
});

// ---- Tournament antes ----
for(let dealt=2;dealt<=8;dealt++){
  test(`classic 0.1 bb antes: ${dealt} dealt players put ${(dealt/10).toFixed(1)} bb in`,()=>{
    near(E.tableAntes(dealt),dealt*0.1,1e-12);
    const model=E.anteModel({});
    assert.equal(model.type,'classic');near(model.amount,0.1,1e-12);near(model.total(dealt),dealt*0.1,1e-12);
    // Postflop: the root pot is the itemized pot plus every dealt player's ante.
    const n=Math.min(dealt,3);
    const post={board:'2c4d7h9sJc',dealt,common:1,stacks:Array(n).fill(10),prior:Array(n).fill(2),
      ranges:['AsAd','KsKd','QhQd'].slice(0,n),bets:'50',raises:'',maxBets:1};
    const g=E.MultiwayGame(post);near(g.view([]).pot,1+2*n+dealt*0.1,1e-9);
    g.iterate(2);near(sum(g.metrics().ev),1+2*n+dealt*0.1,1e-9);
    // Preflop: blinds plus one ante per dealt player.
    if(dealt>=2){
      const live=Math.min(dealt,3);
      const pre={preflop:{mode:'linked',opens:'2',raises:'',maxBets:1},board:'',dealt,common:0,stacks:Array(live).fill(20),
        ranges:Array(live).fill('random'),privateMode:'sampled',evaluationDeals:128,bets:'50',raises:'',maxBets:1};
      near(E.MultiwayGame(pre).view([]).pot,1.5+dealt*0.1,1e-9);
    }
  });
}

test('big blind ante is separate: posted once by the big blind, blind first when short',()=>{
  const base={preflop:{mode:'shove'},board:'',dealt:8,common:0,ranges:Array(3).fill('random'),privateMode:'sampled',evaluationDeals:128};
  near(E.MultiwayGame({...base,anteType:'bba',stacks:[20,20,20]}).view([]).pot,1.5+1,1e-9);
  // BB with 1.4 bb posts the 1 bb blind first and 0.4 bb of the ante.
  const short=E.MultiwayGame({...base,anteType:'bba',stacks:[20,20,1.4]}).view([]);
  near(short.pot,1.5+0.4,1e-9);near(short.behind[2],0,1e-12);
  near(E.MultiwayGame({...base,anteType:'none',stacks:[20,20,20]}).view([]).pot,1.5,1e-9);
});

test('short stacks post a partial ante all-in and can win only what they matched',()=>{
  // Seat 0 has 0.05 bb: it posts it as its ante and is all-in. Two dead seats add 0.2 bb.
  const cfg={preflop:{mode:'shove'},board:'',dealt:5,common:0,stacks:[0.05,20,20],ranges:['AsAd','7c2d','8h3s'],
    privateMode:'sampled',evaluationDeals:128};
  const g=E.MultiwayGame(cfg),root=g.view([]);
  near(root.pot,0.05+0.1+0.1+0.5+1+0.2,1e-9);near(root.behind[0],0,1e-12);
  // SB folds, BB wins without a showdown against the folded SB; seat 0 (aces) is
  // still in and wins the layer it matched: 0.05 x 3 contributors + the dead 0.2.
  let path=[],v=g.view(path);
  while(v.kind==='player'){
    const fold=v.actions.findIndex(a=>a.label==='Fold'),check=v.actions.findIndex(a=>/^Check|^Call/.test(a.label));
    path=[...path,v.seat===1&&fold>=0?fold:check>=0?check:0];v=g.view(path);
  }
  assert.equal(v.kind,'terminal');
  const main=v.pots[0];near(main.amount,0.2+0.05*3,1e-9);assert.deepEqual(main.eligible,[0,2]);
  near(sum(v.pots.map(p=>p.amount)),v.pot,1e-9);
});

test('side pots: three unequal all-ins split into main and side layers',()=>{
  const pots=E.potLayers([5,12,20,20],[true,true,true,false],0.8);
  near(pots[0].amount,0.8+5*4,1e-12);assert.deepEqual(pots[0].eligible,[0,1,2]);
  near(pots[1].amount,7*3,1e-12);assert.deepEqual(pots[1].eligible,[1,2]);
  near(pots[2].amount,8*2,1e-12);assert.deepEqual(pots[2].eligible,[2]);
  const chips=E.awardPots(pots,[9,5,1,0],[0,0,0,0]);
  near(chips[0],20.8,1e-12);near(chips[1],21,1e-12);near(chips[2],16,1e-12);
});

// ---- Exact cross-check of sampled training ----
test('exact cross-check measures sampled strategies in the enumerated game and improves with training',()=>{
  const base={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],
    ranges:['AhKh,KdQd,8s8h,JsTs','AsKd,KcJc,5d5c,8h7h','Kc9c,QsQc,7d7c,Ah5s'],
    streets:{river:{bets:'50',raises:'',maxBets:1}},privateMode:'sampled',abstraction:'exact',evaluationDeals:128,privateSeed:5};
  const g=E.MultiwayGame(base);
  g.iterate(200);const early=E.exactCheckSampled(base,g);
  g.iterate(8000);const late=E.exactCheckSampled(base,g);
  assert.ok(early.available && late.available);
  assert.equal(late.gain.length,3);assert.ok(late.gain.every(x=>x>=0));
  assert.ok(late.maxGain<early.maxGain,`${late.maxGain} < ${early.maxGain}`);
  // The exact solver's own strategy is far closer to a fixed point than sampled training.
  const ex=E.MultiwayGame({...base,privateMode:'exact'});ex.iterate(2000);
  assert.ok(ex.metrics().maxGain<0.01);
  assert.ok(ex.metrics().maxGain<late.maxGain);
});

test('response probe on a full-traversal tree tracks the exact best-response gain',()=>{
  const base={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],
    ranges:['AhKh,KdQd,8s8h,JsTs','AsKd,KcJc,5d5c,8h7h','Kc9c,QsQc,7d7c,Ah5s'],
    streets:{river:{bets:'50,125',raises:'',maxBets:1}},privateMode:'sampled',abstraction:'exact',evaluationDeals:2048,privateSeed:3,traversal:'full'};
  const g=E.MultiwayGame(base);g.iterate(300);
  const exact=E.exactCheckSampled(base,g);
  for(const seat of [0,1,2]){
    const probe=g.responseProbe(seat);probe.iterate(1500);const r=probe.finish();
    // A tested response is a lower bound: it should not exceed the exact gain by more than its noise.
    assert.ok(r.gain<=exact.gain[seat]+4*r.se+0.02,`seat ${seat}: probe ${r.gain}±${r.se} vs exact ${exact.gain[seat]}`);
    assert.ok(r.gain>0.25*exact.gain[seat]-4*r.se,`seat ${seat}: probe ${r.gain} far below exact ${exact.gain[seat]}`);
  }
});

test('strategy normalization: every exact and sampled average strategy row sums to one',()=>{
  const cfg={board:'2c4d7h9sJc',common:10,stacks:[20,20,20],ranges:['QhQd,9c9d','AsAd,KsTh','JhJd,8s8d'],bets:'50,100',raises:'2.5x',maxBets:2};
  for(const privateMode of ['exact','sampled']){
    const g=E.MultiwayGame({...cfg,privateMode,evaluationDeals:128});g.iterate(privateMode==='exact'?50:500);
    const stack=[[]];
    while(stack.length){
      const path=stack.pop(),v=g.view(path);
      if(v.kind!=='player')continue;
      near(sum(v.actions.map(a=>a.frequency??0)),v.prob>0?1:0,1e-6);
      for(const h of v.hands)near(sum(h.mix),1,1e-9);
      if(path.length<4)v.actions.forEach((_,a)=>stack.push([...path,a]));
    }
  }
});

test('legal betting actions: no raise is offered once the cap is reached, all-ins are capped by stacks',()=>{
  const g=E.MultiwayGame({board:'2c4d7h9sJc',common:10,stacks:[8,30,30],ranges:['AsAd','KsKd','QhQd'],bets:'100',raises:'3x',maxBets:2});
  let v=g.view([]);assert.deepEqual(v.actions.map(a=>a.label),['Check','All-in to 8']);
  v=g.view([1]);assert.ok(v.actions.some(a=>a.label==='Fold') && v.actions.some(a=>/^Call/.test(a.label)));
  const raise=v.actions.findIndex(a=>/^Raise|^All-in/.test(a.label));assert.ok(raise>=0);
  const after=g.view([1,raise]);
  assert.ok(after.actions.every(a=>!/^Raise|^All-in/.test(a.label)),'second raise exceeds the two-bet cap');
});
