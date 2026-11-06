// Run from any directory with Node 18 or newer.
'use strict';
const assert=require('node:assert/strict'), test=require('node:test');
const path=require('node:path'), fs=require('node:fs'), vm=require('node:vm');
const E=require('../tools/loadlib');
for(const name of ['lib_deep','lib_deeplib','lib_charts','lib_runouts','lib_river','worker']) require('../web/'+name+'.js');
const near=(x,y,e=1e-8)=>assert.ok(Number.isFinite(x) && Math.abs(x-y)<e,x+' vs '+y);
function next(m,labels) {
  let nd=m.nodes[0];
  for(const pattern of labels) {
    const a=nd.acts.find(a=>typeof pattern==='string'?a.label===pattern:pattern.test(a.label));
    assert.ok(a,'Missing '+String(pattern)+' among '+nd.acts.map(a=>a.label));
    nd=m.nodes[m.resolve(a.child)];
  }
  return nd;
}
const river={board:'2c4d7h9sJc',common:10,stacks:[10,10,10],ranges:['AsAd','KsKd','QhQd'],bets:'100',raises:'',maxBets:1};
function follow(g,labels) {
  let path=[];
  for(const label of labels) {
    const v=g.view(path);const a=v.actions.findIndex(x=>x.label===label);
    assert.ok(a>=0,'Missing '+label+' among '+v.actions.map(x=>x.label));path.push(a);
  }
  return g.view(path);
}
test('Preflop skips all-in seats and retains two covering stacks',()=>{
  const m=E.DeepTree({n:8,stacks:[15,40,30,30,30,40,40,15],anteType:'none'});
  const j=next(m,['All-in 15','All-in 40']); assert.equal(j.type,2);
  assert.deepEqual(j.players,[0,1]);assert.equal(j.allIn,true); near(j.pot,31.5);
  const a=next(m,[...Array(5).fill('Fold'),/^Raise /,/^Call /,'All-in 15',/^Call /,/^Call /]);
  assert.equal(a.allIn,false);near(a.pot,45);assert.deepEqual(a.players.map(p=>a.behind[p]),[25,25,0]);near(a.spr,25/45);
  const s=E.DeepTree({n:3,stacks:[15,40,40],open:3,threeBetOOP:3,anteType:'none'});
  const bb=next(s,['Raise 3',/^Call /,'Squeeze 12','All-in 15',/^Call /]);assert.deepEqual(bb.acts.map(v=>v.label),['Fold','Call 3']);
});
test('Each ICM side pot has its own eligible winner; equal starting busts share prizes',()=>{
  const m=E.DeepTree({n:3,stacks:[40,40,15],anteType:'none',icm:{payouts:[60,40]}});
  const nd=next(m,[/^Raise /,/^Call /,'All-in 15','All-in 40','Call all-in']);
  assert.deepEqual(nd.pots,[{amount:45,eligible:[0,1,2]},{amount:50,eligible:[0,1]}]);
  // Ordered finish [1,0,2] is short stack first, button second, small blind third.
  const expected=E.icmWithBusts([50,0,45],[40,40,15],[60,40]);nd.orderU[4].forEach((v,i)=>near(v,expected[i]));
  assert.deepEqual(Array.from(E.icmWithBusts([90,0,0],[30,30,30],[50,30,20])),[50,25,25]);
  m.iterate(5);assert.ok(Number.isFinite(m.exploitability()));
});
test('Deeper preflop prices AA against AA with a separate ICM tie outcome',()=>{
  const m=E.DeepTree({n:3,stacks:[20,20,20],anteType:'none',icm:{payouts:[60,40]}});
  const btn=m.nodes[0];btn.SS.fill(0);btn.SS.fill(1,0,169);
  const sb=next(m,['Fold']);const jam=sb.acts.findIndex(a=>a.label==='All-in 20');sb.SS.fill(0);
  for(let h=0;h<169;h++) sb.SS[(h===0?jam*169:0)+h]=1;
  m.evaluate(); const bb=next(m,['Fold','All-in 20']);const call=bb.acts.findIndex(a=>a.label==='Call all-in');
  near(bb.VA[call][0]/bb.norm[0],33.0435873,0.0005);
});
test('Two-seat and full-table postflop orders and chip/ICM handoff',()=>{
  assert.deepEqual([0,1].sort((a,b)=>E.postflopOrder(a,2)-E.postflopOrder(b,2)),[1,0]);
  assert.deepEqual([0,5,6,7].sort((a,b)=>E.postflopOrder(a,8)-E.postflopOrder(b,8)),[6,7,0,5]);
  const m=E.DeepTree({n:2,stack:25,anteType:'none'}), nd=next(m,[/^Raise /,/^Call /]);
  const bindings={EM:E,deepSol:()=>({m,lib:null,cfg:{}}),DP:{line:nd.line},PO:{icm:{},payoff:'icm',treePicked:true},
    PT:{},TREES:{},NATIVE:true,deepCrumbs:()=>[],setTab:()=>{}};
  const app=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
  const block=app.slice(app.indexOf('function deepToPostflop()'),app.indexOf('function deepToRiver()'));
  vm.runInNewContext(block+'\ndeepToPostflop();',bindings);
  assert.deepEqual(Array.from(bindings.PO.names),['BB','SB']);assert.equal(bindings.PO.raiser,'ip');assert.equal(bindings.PO.payoff,'chip');
});
test('Every freshly trained chart decodes, evaluates, and matches its published local metric',()=>{
  const lib=E.DEEP_LIB;
  assert.equal(lib.depths.length,9);assert.equal(Object.keys(E.CHARTS.data).length,23);
  for(const S of lib.depths) {
    const packed=lib.data[S].replace(/\.(.)(.)/g,(_,s,k)=>s.repeat(4+lib.alph.indexOf(k)));
    const m=E.DeepTree({...lib.base,stack:S});m.load(packed);
    near(m.exploitability(),lib.meta[S].ex,0.0000051);
    assert.equal(m.view(0).type,'dec');
  }
});
test('River awards main, side, folded contributions and tied layers for 3 to 5 seats',()=>{
  const game=E.RiverGame({...river,common:0,prior:[15,40,40],folded:[10],stacks:[0,0,0]});
  assert.deepEqual(game.metrics().ev,[55,50,0]);assert.deepEqual(game.metrics().gain,[0,0,0]);
  const tied=E.RiverGame({...river,board:'AcKcQcJcTc',common:0,prior:[15,40,40],stacks:[0,0,0]});
  assert.deepEqual(tied.metrics().ev,[15,40,40]);
  const five=E.RiverGame({...river,stacks:[0,0,0,0,0],prior:[5,10,20,40,40],common:0,
    ranges:['AsAd','KsKd','QhQd','8c8d','6h6d']});
  assert.deepEqual(five.metrics().ev,[25,20,30,40,0]);
  const active=E.RiverGame({...river,stacks:[5,10,20,40,40],prior:[0,0,0,0,0],ranges:['AsAd','KsKd','QhQd','8c8d','6h6d']});
  active.iterate(5); near(active.metrics().ev.reduce((a,b)=>a+b),10);
});
test('A single short raise closes rights, cumulative short raises reopen them',()=>{
  const base={...river,stacks:[40,15,40,40],ranges:['AsAd','KsKd','QhQd','8c8d'],raises:'a',maxBets:5};
  const single=E.RiverGame(base);
  assert.deepEqual(follow(single,['Bet 10','All-in to 15','Call 15','Call 15']).actions.map(a=>a.label),['Fold','Call 5']);
  const both=E.RiverGame({...base,stacks:[40,15,21,40,40],ranges:[...base.ranges,'6c6d']});
  assert.deepEqual(follow(both,['Bet 10','All-in to 15','All-in to 21','Call 21','Call 21']).actions.map(a=>a.label),['Fold','Call 11','All-in to 40']);
});
test('Three-seat river reproduces a known hidden-card bluff equilibrium',()=>{
  const m=E.RiverGame({...river,stacks:[10,10,0],ranges:['QhQd','AsAd,KsTh','5s3d'],lead:[false,true,false]});
  m.iterate(2000);const status=m.metrics(), attacker=m.view([0]),defender=m.view([0,1]);
  near(attacker.hands.find(h=>h.cards==='KsTh').mix[1],.5,.005);
  near(attacker.hands.find(h=>h.cards==='AsAd').mix[1],1,.001);
  near(defender.hands[0].mix[1],.5,.005);near(status.ev[0],2.5,.005);assert.ok(status.maxGain<.01);
});
test('Reject impossible inputs or excessive trees without truncating ranges',()=>{
  assert.throws(()=>E.RiverGame({...river,ranges:['AsAd','AsKh','QhQd']}),/mutually compatible/);
  assert.throws(()=>E.RiverGame({...river,board:'2c4d7h9s9s'}),/Duplicate|different/);
  assert.throws(()=>E.RiverGame({...river,stacks:[10,-2,50]}),/nonnegative/);
  assert.throws(()=>E.RiverGame({...river,prior:[10,0,0]}),/unmatched/);
  assert.throws(()=>E.RiverGame({...river,ranges:Array(3).fill('22+,A2s+,K2s+,Q2s+')}),/Too many|too large/);
});
test('Complete unilateral best responses match exhaustive pure policies in a genuine three-player game',()=>{
  // One 10 bb bet, no raises. Seat 0 can open; seats 1 and 2 are live callers.
  // Two hand choices per seat. Independently enumerate compatible deals, all
  // terminal actions and 4/4/16 pure policies, without calling solver payoffs or BR.
  const combos=[['AsAd','KsTh'],['QhQd','AsKc'],['JhJd','8c8d']];
  const strength=[[5,0],[4,1],[6,3]]; // set of jacks, AA, QQ, 88, AK, KT on this board
  const weights=[[.75,1],[1,.375],[.875,1]];
  const m=E.RiverGame({...river,ranges:['AsAd:0.75,KsTh','QhQd,AsKc:0.375','JhJd:0.875,8c8d'],lead:[true,false,false]});
  m.iterate(100);
  const result=m.metrics();
  const perm=s=>[s.slice(0,2),s.slice(2)].sort().join('');
  const actionProb=(point,seat)=>combos[seat].map(c=>point.hands.find(h=>perm(h.cards)===perm(c)).mix[1]);
  const sig=[actionProb(m.view([]),0),actionProb(m.view([1]),1),
    [...actionProb(m.view([1,0]),2),...actionProb(m.view([1,1]),2)]];
  function independent(policy) {
    const ev=[0,0,0];let mass=0;
    for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++) {
      if(a===0 && b===1) continue; // shared As
      const chance=weights[0][a]*weights[1][b]*weights[2][c];mass+=chance;
      const score=[strength[0][a],strength[1][b],strength[2][c]];
      const pb=policy[0][a], pc1=policy[1][b];
      const win=score.indexOf(Math.max(...score));ev[win]+=chance*(1-pb)*10;
      for(let i=0;i<2;i++)for(let j=0;j<2;j++) {
        const pc2=policy[2][i*2+c], pr=chance*pb*(i?pc1:1-pc1)*(j?pc2:1-pc2);
        const active=[0];if(i)active.push(1);if(j)active.push(2);
        let best=0;for(const seat of active)if(score[seat]>score[best])best=seat;
        for(const seat of active) ev[seat]-=pr*10;
        ev[best]+=pr*(10+10*active.length);
      }
    }
    return ev.map(v=>v/mass);
  }
  const base=independent(sig);
  for(let p=0;p<3;p++){
    near(result.ev[p],base[p]);
    const policies=2**sig[p].length;let best=-Infinity;
    for(let mask=0;mask<policies;mask++){
      const strategy=sig.slice();strategy[p]=sig[p].map((_,i)=>(mask>>i)&1);
      best=Math.max(best,independent(strategy)[p]);
    }
    near(result.best[p],best);near(result.gain[p],best-base[p]);
  }
});

test('Worker accepts a river solve, can stop it, and returns a navigable strategy',async()=>{
  const pending=new Map(),fake={postMessage(m){
    const job=pending.get(m.id);if(!job)return;
    if(m.type==='progress'){if(job.progress)job.progress(m);return;}
    pending.delete(m.id);m.type==='error'?job.reject(new Error(m.message)):job.resolve(m.result);
  }};
  let seq=0;E.workerMain(fake);
  function ask(type,data,progress){return new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject,progress});fake.onmessage({data:{type,id,...data}});
  });}
  await assert.rejects(ask('river-solve',{cfg:river,maxIter:0,target:0}),/iterations/);
  const running=ask('river-solve',{cfg:river,maxIter:5000,target:0});
  await ask('river-stop',{});
  assert.equal((await running).reason,'stopped');
  const solved=await ask('river-solve',{cfg:river,maxIter:30,target:0});
  assert.ok(solved.metrics.iterations>0);
  assert.equal((await ask('river-node',{path:[0]})).seat,1);
});
test('Five-seat example with mixed hands and the default sizing tree fits the desktop budget',()=>{
  const g=E.RiverGame({...river,common:12,stacks:[16,32,26,30,24],bets:'50,100',raises:'2.5x',maxBets:2,
    ranges:['QhQd,9c9d','AsAd,KsTh','JhJd,8s8d','AcKd,5c5d','AhKh,6s6h']});
  g.iterate(10);const r=g.metrics();assert.equal(r.deals,32);assert.equal(r.gain.length,5);
  near(r.ev.reduce((a,b)=>a+b),12);
});

test('Every dealt player pays 0.1 bb separately from the blinds and other tables',()=>{
  for(const n of [2,6,8]) {
    const m=E.DeepTree({n,stack:25});
    assert.deepEqual(Array.from(m.dead),Array(n).fill(0.1));
    near(m.nodes[0].pot,1.5+n/10);
    const r=E.PushFold({n,stacks:Array(n).fill(25),model:'icm',payouts:[75,25],others:[40]}).results();
    assert.deepEqual(r.posted.ante,Array(n).fill(0.1));
    assert.deepEqual(r.posted.blind,[...Array(n-2).fill(0),0.5,1]);
  }
  for(const cfg of [E.CHARTS,E.DEEP_LIB.base]){
    assert.equal(cfg.ante,0.1);assert.equal(cfg.anteType,'classic');
  }
});

test('Six-way pot accounting keeps every ante live on a tied board and validates dealt seats',()=>{
  const c={...river,board:'AcKcQcJcTc',stacks:Array(6).fill(0),prior:[2,2,2,2,2,2],
    ranges:['AsAd','KsKd','QhQd','8c8d','6h6d','5c5d'],common:0,dealt:8};
  for(const dealt of [6,7,8]){
    const game=E.RiverGame({...c,dealt}),pot=12+dealt/10;
    near(game.view().pot,pot);game.metrics().ev.forEach(v=>near(v,pot/6));
  }
  assert.throws(()=>E.RiverGame({...c,dealt:5}),/dealt/);
  assert.throws(()=>E.RiverGame({...c,dealt:9}),/dealt/);
  assert.throws(()=>E.RiverGame({...c,dealt:6.5}),/dealt/);
  assert.throws(()=>E.RiverGame({...c,dealt:6,folded:[1]}),/dealt/);
  assert.throws(()=>E.RiverGame({...c,stacks:Array(9).fill(0)}),/two to eight/);
});
