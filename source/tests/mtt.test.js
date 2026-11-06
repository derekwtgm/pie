'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const E=require('../tools/loadlib');
for(const lib of ['lib_runouts','lib_wide','lib_river','lib_quality','worker'])require('../web/'+lib+'.js');
const sum=a=>a.reduce((x,y)=>x+y,0);
const near=(x,y,t=1e-8)=>assert.ok(Number.isFinite(x)&&Math.abs(x-y)<t,`${x} vs ${y}`);
const holes=['AsAd','KsKd','QhQd','JsJd','TsTd','9s9d','8s8d','7s7d'];
const cards=s=>E.parseBoard(s);
// Independent payout recursion, including equal-stack simultaneous eliminations.
function prize(final,start,payouts){
  const out=final.map(()=>0),alive=final.map((_,i)=>i).filter(i=>final[i]>1e-9);
  function finish(left,place,prob){
    if(!left.length)return;
    const total=sum(left.map(i=>final[i]));
    for(const i of left){const q=prob*final[i]/total;out[i]+=q*(payouts[place]||0);finish(left.filter(j=>j!==i),place+1,q);}
  }
  finish(alive,0,1);
  const dead=final.map((_,i)=>i).filter(i=>final[i]<=1e-9).sort((a,b)=>start[b]-start[a]);
  for(let j=0;j<dead.length;){let end=j+1;while(end<dead.length&&start[dead[j]]===start[dead[end]])end++;
    const split=sum(dead.slice(j,end).map((_,k)=>payouts[alive.length+j+k]||0))/(end-j);
    for(let k=j;k<end;k++)out[dead[k]]=split;j=end;}
  return out;
}
// A separate lexicographic five-card evaluator, choosing all 21 subsets.
function rank5(cs){
  const r=cs.map(c=>2+(c>>2)).sort((a,b)=>b-a),counts=new Map();for(const x of r)counts.set(x,(counts.get(x)||0)+1);
  const g=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]),flush=cs.every(c=>(c&3)===(cs[0]&3));
  const straight=counts.size===5?(r[0]-r[4]===4?r[0]:r.join()==='14,5,4,3,2'?5:0):0;
  let cat=0,tail=g.map(x=>x[0]);
  if(flush&&straight){cat=8;tail=[straight];}else if(g[0][1]===4)cat=7;else if(g[0][1]===3&&g[1][1]===2)cat=6;
  else if(flush){cat=5;tail=r;}else if(straight){cat=4;tail=[straight];}else if(g[0][1]===3)cat=3;else if(g[0][1]===2)cat=g[1][1]===2?2:1;
  for(let i=0;i<5;i++)cat=cat*15+(tail[i]||0);return cat;
}
function rank7(cs){let best=0;for(let a=0;a<7;a++)for(let b=a+1;b<7;b++)best=Math.max(best,rank5(cs.filter((_,i)=>i!==a&&i!==b)));return best;}
function share(final,scores,seats,amount){const top=Math.max(...seats.map(p=>scores[p])),win=seats.filter(p=>scores[p]===top);for(const p of win)final[p]+=amount/win.length;}
function choose(g,path,label){const v=g.view(path),a=v.actions.findIndex(x=>typeof label==='string'?x.label===label:label.test(x.label));assert.ok(a>=0,JSON.stringify(v.actions));return [...path,a];}
function pre(n,mode='linked',more={}){return {preflop:{mode,opens:'2',raises:'3x,a',maxBets:3},board:'',dealt:Math.max(8,n),common:0,
  stacks:Array(n).fill(25),ranges:holes.slice(0,n),privateMode:'sampled',evaluationDeals:128,bets:'50',raises:'',maxBets:1,...more};}

test('ICM integrates joint side-pot outcomes before averaging and includes folded seats',()=>{
  const board=cards('2c4d7h9s'),hs=holes.slice(0,3).map(cards),blocked=[...board,...hs.flat()];
  const cfg={board,common:0,dealt:4,prior:[4,8,8],stacks:[0,0,0],ranges:holes.slice(0,3),bets:'',raises:'',icm:{payouts:[60,25,15],others:[20]}};
  const expected=[0,0,0],average=[0,0,0,20],deck=Array.from({length:52},(_,c)=>c).filter(c=>!blocked.includes(c));
  for(const c of deck){const scores=hs.map(h=>rank7([...board,c,...h])),fin=[0,0,0,20];share(fin,scores,[0,1,2],12.4);share(fin,scores,[1,2],8);
    const u=prize(fin,[4.1,8.1,8.1,20],cfg.icm.payouts);for(let p=0;p<3;p++){expected[p]+=u[p]/deck.length;average[p]+=fin[p]/deck.length;}}
  const g=E.MultiwayGame(cfg),m=g.metrics();assert.equal(m.utility,'icm');expected.forEach((v,p)=>near(v,m.ev[p]));
  const wrong=prize(average,[4.1,8.1,8.1,20],cfg.icm.payouts);assert.ok(expected.some((v,p)=>Math.abs(v-wrong[p])>0.1));
});

test('Six-player ICM agrees with independent tied-pot and simultaneous-bust calculations',()=>{
  const cfg={board:'AcKcQcJcTc',common:0,dealt:6,prior:[2,3,4,5,6,6],stacks:Array(6).fill(0),ranges:['AsAd','KsKd','QhQd','JsJd','TsTd','9s9d'],bets:'',raises:'',icm:{payouts:[60,25,15]}};
  const g=E.MultiwayGame(cfg),fin=cfg.prior.map(x=>x+0.1),expected=prize(fin,fin,cfg.icm.payouts);
  g.metrics().ev.forEach((v,p)=>near(v,expected[p]));near(sum(g.metrics().ev),100);
  const eliminated={...cfg,board:'2c4d7h9hJc',ranges:['AsAd','KsKd','QhQd','JsJd','TsTd','9s9d']};
  const scores=eliminated.ranges.map(h=>rank7([...cards(eliminated.board),...cards(h)])),out=Array(6).fill(0);
  share(out,scores,[0,1,2,3,4,5],12.6);share(out,scores,[1,2,3,4,5],5);share(out,scores,[2,3,4,5],4);share(out,scores,[3,4,5],3);share(out,scores,[4,5],2);
  E.MultiwayGame(eliminated).metrics().ev.forEach((v,p)=>near(v,prize(out,fin,cfg.icm.payouts)[p]));
  const equalBusts=E.MultiwayGame({...eliminated,prior:[2,3,4,6,6,6]}).metrics();
  equalBusts.ev.forEach((v,p)=>near(v,[0,0,0,60,20,20][p]));
});

test('Wide ICM uses the same settlements and payout scaling preserves strategy',()=>{
  const cfg={board:'2c4d7h9sJc',common:10,stacks:[5,7,9],ranges:['AsAd','KsKd','QhQd'],bets:'a',raises:'',maxBets:1,icm:{payouts:[60,30,10]}};
  const a=E.MultiwayGame(cfg),b=E.MultiwayGame({...cfg,icm:{payouts:[6000,3000,1000]}});
  a.iterate(100);b.iterate(100);a.metrics().ev.forEach((v,p)=>near(v*100,b.metrics().ev[p],1e-6));
  a.view([]).actions.forEach((v,i)=>near(v.frequency,b.view([]).actions[i].frequency,1e-7));
  const dead={...cfg,stacks:[0,0,0],prior:[5,7,7]};
  const exact=E.MultiwayGame(dead),wide=E.MultiwayGame({...dead,privateMode:'sampled',evaluationDeals:128});
  exact.metrics().ev.forEach((v,p)=>near(v,wide.metrics().ev[p]));
});

test('ICM rejects inconsistent payouts, omitted remaining seats and invalid stacks',()=>{
  const cfg={board:'2c4d7h9sJc',common:10,stacks:[5,5],ranges:['AsAd','KsKd'],bets:'',raises:''};
  for(const icm of [{payouts:[10,20]},{payouts:[Infinity]},{payouts:[0,0]},{payouts:[10],others:[-1]},{payouts:[10],others:Array(15).fill(20)},{payouts:[10],startStacks:[1,1]}])assert.throws(()=>E.MultiwayGame({...cfg,icm}),/ICM|payouts/);
  assert.throws(()=>E.MultiwayGame({...cfg,dealt:8,icm:{payouts:[10]}}),/other remaining/);
  assert.throws(()=>E.MultiwayGame({...cfg,prior:[2,2],folded:[2],icm:{payouts:[10]}}),/other remaining/);
});

test('Four, five and six live preflop players continue through all postflop streets',()=>{
  for(const n of [4,5,6]){
    const g=E.MultiwayGame(pre(n));let path=choose(g,[],'Raise to 2');
    for(let i=1;i<n;i++)path=choose(g,path,/^Call /);
    const flop=g.view(path);assert.equal(flop.nextStreet,'Flop');near(flop.pot,2*n+0.8);flop.behind.forEach(v=>near(v,22.9));
    path.push({cards:cards('2c4d7h')});assert.equal(g.view(path).seat,n-2);
    for(const card of ['9c','Tc']){for(let i=0;i<n;i++)path=choose(g,path,'Check');assert.equal(g.view(path).kind,'chance');path.push({card:E.parseCard(card)});assert.equal(g.view(path).seat,n-2);}
    for(let i=0;i<n;i++)path=choose(g,path,'Check');const end=g.view(path);assert.equal(end.kind,'terminal');near(sum(end.ev),0.1*(8-n));
  }
});

test('Heads-up preflop starts with SB and postflop starts with BB',()=>{
  const g=E.MultiwayGame(pre(2));assert.equal(g.view([]).seat,0);let p=choose(g,[],'Call 0.5');p=choose(g,p,'Check');p.push({cards:cards('2c4d7h')});assert.equal(g.view(p).seat,1);
  assert.throws(()=>g.view([...p.slice(0,-1),{cards:cards('As4d7h')}]),/blocked|rare/);
});

test('Eight-way shove/call retains every overcaller and conserves all chips and antes',()=>{
  const g=E.MultiwayGame(pre(8,'shove',{stacks:Array(8).fill(8),bets:'',raises:''}));let p=choose(g,[],/^All-in/);
  for(let i=1;i<8;i++){assert.equal(g.view(p).seat,i);p=choose(g,p,/^Call/);}
  const end=g.view(p);assert.equal(end.kind,'terminal');assert.equal(end.live.filter(Boolean).length,8);near(end.pot,64);near(sum(end.ev),0,1e-6);
});

test('Unequal preflop all-ins form three correct side pots without ending at the first call',()=>{
  const g=E.MultiwayGame(pre(4,'shove',{dealt:4,stacks:[4,8,12,16]}));let p=[];
  for(let i=0;i<3;i++)p=choose(g,p,/^All-in/);p=choose(g,p,/^Call/);
  const end=g.view(p);assert.equal(end.kind,'terminal');assert.deepEqual(end.pots.map(p=>p.eligible),[[0,1,2,3],[1,2,3],[2,3]]);
  end.pots.forEach((p,i)=>near(p.amount,[16,12,8][i]));near(end.behind[3],4);near(sum(end.ev),0,1e-6);
});

test('Short blind all-ins return excess and do not force a sole live player to fold',()=>{
  const short=E.MultiwayGame(pre(3,'shove',{dealt:3,stacks:[0.7,10,10]}));
  let path=choose(short,[],'Call 0.6');path=choose(short,path,'Call 0.5');path=choose(short,path,'Check');near(sum(short.view(path).ev),0,1e-6);
  for(const stacks of [[25,0.5],[0.1,25],[0.6,1.1]]){
    const g=E.MultiwayGame(pre(2,'shove',{dealt:2,stacks}));const root=g.view([]);
    if(root.kind==='player')assert.ok(root.actions.some(a=>a.label.startsWith('Call')));
    else {assert.equal(root.kind,'terminal');near(sum(root.ev),0,1e-6);}
  }
});

test('Short preflop raises do not reopen a previous raiser',()=>{
  const g=E.MultiwayGame(pre(3,'linked',{stacks:[20,2.6,20]}));let p=choose(g,[],'Raise to 2');p=choose(g,p,'All-in to 2.5');p=choose(g,p,/^Call/);
  const root=g.view(p);assert.equal(root.seat,0);assert.deepEqual(root.actions.map(a=>a.label),['Fold','Call 0.5']);
});

test('Preflop decisions use postflop continuation values and keep future cards hidden',()=>{
  const cfg=pre(3,'linked',{evaluationDeals:8192,preflop:{mode:'linked',opens:'',raises:'',maxBets:1},bets:'',raises:''});
  const a=E.MultiwayGame(cfg),b=E.MultiwayGame({...cfg,bets:'a'});
  const av=a.view([]),bv=b.view([]);assert.equal(av.hands.length,1);assert.deepEqual(av.actions.map(x=>x.label),['Fold','Call 1']);
  near(av.actions[0].ev,0);assert.ok(Math.abs(av.actions[1].ev-bv.actions[1].ev)>0.1);
  // The root has one private information set for each updating seat, independent
  // of the unseen sampled flop. Revealing cards in the explorer cannot retrain it.
  b.iterate(50);const before=b.metrics();b.view([1,1,0,{cards:cards('2c4d7h')}]);assert.deepEqual(b.metrics(),before);
});

test('Preflop ICM supports eight seats and checks do not alter the configured action model',()=>{
  const cfg=pre(8,'shove',{stacks:Array(8).fill(0.1),icm:{payouts:[50,30,20]}}),g=E.MultiwayGame(cfg);
  near(sum(g.metrics().ev),100,1e-6);assert.equal(g.metrics().unit,'prize units');
  const plan=E.multiwayCheckPlan(cfg,{runs:3,extra:{flop:{bets:'100'}}});assert.equal(plan.expanded,null);assert.equal(plan.seeds.length,3);
  const linked=E.multiwayCheckPlan(pre(6),{runs:2,extra:{flop:{bets:'100'}}});assert.equal(linked.expanded.preflop.mode,'linked');assert.equal(linked.added[0].street,'flop');
  assert.throws(()=>E.MultiwayGame({...pre(6),privateMode:'exact'}),/Wide ranges/);
  const seven=E.MultiwayGame(pre(7));seven.iterate(5);near(sum(seven.metrics().ev),0.1,1e-9);
  assert.throws(()=>E.MultiwayGame(pre(9)),/two to eight|dealt/);
});

test('ICM profile EV and unilateral gains match independent exhaustive three-player policies',()=>{
  const combos=[['AsAd','KsTh'],['QhQd','AsKc'],['JhJd','8c8d']],strength=[[5,0],[4,1],[6,3]],weights=[[.75,1],[1,.375],[.875,1]],payouts=[60,30,10];
  const cfg={board:'2c4d7h9sJc',common:10,stacks:[10,10,10],ranges:['AsAd:0.75,KsTh','QhQd,AsKc:0.375','JhJd:0.875,8c8d'],lead:[true,false,false],bets:'a',raises:'',maxBets:1,icm:{payouts}};
  const g=E.MultiwayGame(cfg);g.iterate(500);const m=g.metrics();
  const perm=s=>[s.slice(0,2),s.slice(2)].sort().join('');
  const policy=(v,p)=>combos[p].map(c=>v.hands.find(h=>perm(h.cards)===perm(c)).mix[1]);
  const sig=[policy(g.view([]),0),policy(g.view([1]),1),[...policy(g.view([1,0]),2),...policy(g.view([1,1]),2)]];
  function oracle(s){
    let mass=0;const out=[0,0,0];
    function put(fin,prob){prize(fin,[10,10,10],payouts).forEach((v,p)=>out[p]+=prob*v);}
    for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++){
      if(a===0&&b===1)continue;const chance=weights[0][a]*weights[1][b]*weights[2][c];mass+=chance;
      const score=[strength[0][a],strength[1][b],strength[2][c]],bet=s[0][a],call=s[1][b];
      const fin=[10,10,10];fin[score.indexOf(Math.max(...score))]+=10;put(fin,chance*(1-bet));
      for(let x=0;x<2;x++)for(let y=0;y<2;y++){
        const pc=s[2][x*2+c],pr=chance*bet*(x?call:1-call)*(y?pc:1-pc),active=[0];if(x)active.push(1);if(y)active.push(2);
        const f=[10,10,10];let winner=0;for(const p of active){f[p]=0;if(score[p]>score[winner])winner=p;}f[winner]=10+active.length*10;put(f,pr);
      }
    }
    return out.map(v=>v/mass);
  }
  const base=oracle(sig);for(let p=0;p<3;p++){
    near(m.ev[p],base[p]);let best=-Infinity;
    for(let mask=0;mask<2**sig[p].length;mask++){const s=sig.slice();s[p]=sig[p].map((_,i)=>(mask>>i)&1);best=Math.max(best,oracle(s)[p]);}
    near(m.gain[p],Math.max(0,best-base[p]));
  }
});
