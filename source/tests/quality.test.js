'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const E=require('../tools/loadlib');
for(const lib of ['lib_runouts','lib_wide','lib_river','lib_quality','worker'])require('../web/'+lib+'.js');
const near=(a,b,t=1e-8)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<t,a+' versus '+b);
const river={board:'2c4d7h9sJc',common:10,stacks:[10,10,0],ranges:['QhQd','AsAd,KsTh','5s3d'],
  lead:[false,true,false],bets:'a',maxBets:1,privateMode:'sampled',privateSeed:17};
const large={board:'2c4d7h',dealt:8,common:0,stacks:Array(6).fill(22.9),prior:Array(6).fill(2),
  ranges:Array(6).fill('22+,A2s+,K2s+,Q4s+,J7s+,87s,76s,65s,AJo+'),privateMode:'sampled',
  privateSeed:39,bets:'25,50',raises:'2.5x',maxBets:2,evaluationDeals:128};

test('External sampling reproduces the known river bluff equilibrium',()=>{
  const g=E.MultiwayGame({...river,traversal:'external'});g.iterate(50000);
  near(g.view([0]).hands.find(h=>h.cards==='KsTh').mix[1],.5,.035);
  near(g.view([0,1]).hands[0].mix[1],.5,.035);
  const m=g.metrics();near(m.ev[0],2.5,4*m.se[0]);assert.equal(m.algorithm,'external');
});
test('Six-player small bets and raises train beyond the previous full-tree limit',()=>{
  assert.throws(()=>E.MultiwayGame({...large,traversal:'full'}),/2,200/);
  const g=E.MultiwayGame(large);g.iterate(500);
  const m=g.metrics();assert.equal(m.algorithm,'external');assert.equal(m.iterations,500);
  near(m.ev.reduce((a,b)=>a+b),12.8);assert.ok(m.strategyMiB<20);
  const root=g.view();assert.deepEqual(root.actions.map(a=>a.label),['Check','Bet 3.2','Bet 6.4']);
  assert.ok(g.view([1]).actions.some(a=>a.label.startsWith('Raise')));
});
test('A memory stop leaves a finite, inspectable profile and terminates further training',()=>{
  const g=E.MultiwayGame({...large,strategyBudgetMiB:1});g.iterate(5000);
  assert.equal(g.limitReached,true);const done=g.iterations;g.iterate(100);assert.equal(g.iterations,done);
  const m=g.metrics();assert.ok(m.strategyMiB<=1);near(m.ev.reduce((a,b)=>a+b),12.8);
  near(g.view().actions.reduce((sum,a)=>sum+a.frequency,0),1);
});
test('Response training finds the analytic uniform-policy leak without altering the original strategy',()=>{
  const g=E.MultiwayGame({...river,traversal:'external'}),before=g.metrics();
  const probe=g.responseProbe(1);probe.iterate(5000);const result=probe.finish();
  // With a 50% bluff/call policy, betting AA always adds 1.25 bb to seat one's EV.
  near(result.gain,1.25,4*result.se);assert.ok(result.gain>1.96*result.se);
  assert.deepEqual(g.metrics(),before);
});
test('Seed planning validates extra sizes, handles card arrays, and expands raise caps explicitly',()=>{
  const c={...large,board:E.parseBoard('2c4d7h'),privateMode:'exact',runouts:{mode:'sampled',seed:99}};
  const plan=E.multiwayCheckPlan(c,{runs:3,extra:{flop:{bets:'25%,75',raises:'3x'}}});
  assert.equal(plan.seeds.length,3);assert.equal(plan.expanded.streets.flop.bets,'25,50,75');
  assert.equal(c.bets,'25,50');assert.equal(c.streets,undefined);
  const fixed=E.multiwayCheckPlan({...river,privateMode:'exact'},{extra:{river:{raises:'2x'}}});
  assert.equal(fixed.seeds.length,1);assert.equal(fixed.expanded.streets.river.maxBets,2);
  assert.throws(()=>E.multiwayCheckPlan(river,{runs:0}),/1 to 5/);
  assert.throws(()=>E.multiwayCheckPlan(river,{extra:{river:{bets:'25,50,75,125,150'}}}),/five combined/);
});
function port(){
  const pending=new Map();let seq=0;
  const self={postMessage(m){
    const job=pending.get(m.id);if(!job)return;
    if(m.type==='progress'){job.progress?.(m);return;}
    pending.delete(m.id);m.type==='error'?job.reject(new Error(m.message)):job.resolve(m.result);
  }};
  E.workerMain(self);
  return (type,data={},progress)=>new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject,progress});self.onmessage({data:{type,id,...data}});
  });
}
test('Worker completes paired seed and bet-size checks and preserves the original explorer',async()=>{
  const ask=port(),cfg={...river,lead:[true,true,false],bets:'50',evaluationDeals:256};
  const original=await ask('multi-solve',{cfg,maxIter:150,target:0});
  const result=await ask('multi-check',{options:{runs:3,responseIterations:100,extra:{river:{bets:'100'}}}});
  assert.equal(result.audit.status,'completed');assert.equal(result.audit.runs.length,6);
  assert.equal(result.audit.responses.length,3);assert.equal(result.audit.summary.pairedRuns,3);
  assert.ok(result.audit.summary.actions.some(a=>a.label==='All-in to 10'));
  assert.deepEqual(await ask('multi-node',{path:[]}),original.node);
  assert.deepEqual(result.metrics,original.metrics);
});
test('Invalid and cancelled accuracy checks retain the solved profile and permit a retry',async()=>{
  const ask=port(),original=await ask('multi-solve',{cfg:{...river,evaluationDeals:128},maxIter:25,target:0});
  await assert.rejects(ask('multi-check',{options:{runs:7}}),/1 to 5/);
  assert.deepEqual(await ask('multi-node',{path:[]}),original.node);
  let stopped=false;
  const result=await ask('multi-check',{options:{runs:3,responseIterations:100}},()=>{
    if(!stopped){stopped=true;ask('multi-stop');}
  });
  assert.equal(result.audit.status,'stopped');
  assert.deepEqual(await ask('multi-node',{path:[]}),original.node);
  const retry=await ask('multi-check',{options:{runs:1,responseIterations:100}});
  assert.equal(retry.audit.status,'completed');
});
test('An expanded exact tree that exceeds limits is reported without losing the original solve',async()=>{
  const ask=port();
  const cfg={...large,privateMode:'exact',ranges:['QhQd','AsAd','JhJd','AcKd','AhKh','TsTc'],bets:'',raises:'',maxBets:1,
    runouts:{mode:'sampled',count:1,seed:17}};
  const original=await ask('multi-solve',{cfg,maxIter:1,target:0});
  const result=await ask('multi-check',{options:{runs:1,responseIterations:100,
    extra:{flop:{bets:'25,50,75',raises:'2x,3x,a'},turn:{bets:'25,50,75',raises:'2x,3x,a'},river:{bets:'25,50,75',raises:'2x,3x,a'}}}});
  assert.equal(result.audit.status,'completed with errors');assert.equal(result.audit.errors.length,1);
  assert.deepEqual(await ask('multi-node',{path:[]}),original.node);
});

test('External multiplayer profile and trained response agree with an independent exhaustive oracle',()=>{
  // One 10 bb bet, no raises. Seat 0 can open; seats 1 and 2 are live callers.
  // Two hand choices per seat. Independently enumerate compatible deals, all
  // terminal actions and 4/4/16 pure policies, without calling solver payoffs or BR.
  const combos=[['AsAd','KsTh'],['QhQd','AsKc'],['JhJd','8c8d']];
  const strength=[[5,0],[4,1],[6,3]]; // set of jacks, AA, QQ, 88, AK, KT on this board
  const weights=[[.75,1],[1,.375],[.875,1]];
  const m=E.MultiwayGame({...river,privateMode:'sampled',traversal:'external',stacks:[10,10,10],evaluationDeals:8192,ranges:['AsAd:0.75,KsTh','QhQd,AsKc:0.375','JhJd:0.875,8c8d'],lead:[true,false,false]});
  m.iterate(30000);
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
    near(result.ev[p],base[p],4*result.se[p]+0.02);
    const policies=2**sig[p].length;let best=-Infinity;
    for(let mask=0;mask<policies;mask++){
      const strategy=sig.slice();strategy[p]=sig[p].map((_,i)=>(mask>>i)&1);
      best=Math.max(best,independent(strategy)[p]);
    }
    const probe=m.responseProbe(p);probe.iterate(5000);const response=probe.finish();
    near(response.gain,best-base[p],Math.max(0.05,4*response.se));
  }
});
