'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const EM=require('../tools/loadlib');
for(const lib of ['lib_runouts','lib_river','worker'])require('../web/'+lib+'.js');
const near=(a,b,tol=1e-8)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<tol,a+' versus '+b);
const plus=(a,b)=>a+b;
const base={common:12,board:'2c4d7h',stacks:[40,40,40],ranges:['AsAd','KsKd','QhQd'],
  bets:'50',raises:'',maxBets:1,runouts:{mode:'sampled',count:3,seed:17}};
function action(game,path,label) {
  const node=game.view(path),i=node.actions.findIndex(a=>a.label===label);
  assert.ok(i>=0,label+' among '+node.actions.map(a=>a.label));return [...path,i];
}
function through(game,path,labels){for(const label of labels)path=action(game,path,label);return path;}

// Independent five-card lexicographic evaluator; use best five from seven.
function rank5(cs) {
  const ranks=cs.map(c=>2+(c>>2)).sort((a,b)=>b-a),groups=new Map();
  for(const r of ranks)groups.set(r,(groups.get(r)||0)+1);
  const counts=[...groups].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const flush=cs.every(c=>(c&3)===(cs[0]&3));
  const straight=groups.size===5?(ranks[0]-ranks[4]===4?ranks[0]:ranks.join()==='14,5,4,3,2'?5:0):0;
  let cat=0,tail=counts.map(([r])=>r);
  if(flush&&straight){cat=8;tail=[straight];}
  else if(counts[0][1]===4)cat=7;
  else if(counts[0][1]===3 && counts[1][1]===2)cat=6;
  else if(flush){cat=5;tail=ranks;}
  else if(straight){cat=4;tail=[straight];}
  else if(counts[0][1]===3)cat=3;
  else if(counts[0][1]===2)cat=counts[1][1]===2?2:1;
  let value=cat;
  for(let i=0;i<5;i++)value=value*15+(tail[i]||0);
  return value;
}
function rank7(cards) {
  let value=0;
  for(let i=0;i<7;i++)for(let j=i+1;j<7;j++)value=Math.max(value,rank5(cards.filter((_,k)=>k!==i&&k!==j)));
  return value;
}
const allCards=Array.from({length:52},(_,c)=>c);
const splitHand=s=>[EM.parseCard(s.slice(0,2)),EM.parseCard(s.slice(2))];
function refPot(scores,seats,amount) {
  const top=Math.max(...seats.map(p=>scores[p])),winners=seats.filter(p=>scores[p]===top);
  return scores.map((_,p)=>winners.includes(p)?amount/winners.length:0);
}
test('Exact three-, five- and six-player flop all-ins match independent runouts and side pots',()=>{
  const spots=[
    {ranges:['AsAd','KsKd','QhQd'], prior:[15,40,40], boards:903,
      layers:[[45,[0,1,2]],[50,[1,2]]]},
    {ranges:['AsAd','KsKd','QhQd','8c8d','6c6d'], prior:[5,10,20,40,40], boards:741,
      layers:[[25,[0,1,2,3,4]],[20,[1,2,3,4]],[30,[2,3,4]],[40,[3,4]]]},
    // Eight dealt, two preflop folds with 0.5 and 1 live chips. All six
    // see the flop and six distinct hands remove twelve cards from the deck.
    {ranges:['AsAd','KsKd','QhQd','8c8d','6c6d','TsTc'], prior:[5,10,15,20,25,25],
      dealt:8, folded:[0.5,1], boards:666,
      layers:[[32.3,[0,1,2,3,4,5]],[25,[1,2,3,4,5]],[20,[2,3,4,5]],[15,[3,4,5]],[10,[4,5]]]}
  ];
  for(const {ranges,prior,boards:expectedBoards,layers,dealt,folded} of spots) {
    const n=ranges.length;
    const board=EM.parseBoard('2c4d7h'),hole=ranges.map(splitHand),rest=allCards.filter(c=>!board.includes(c)&&!hole.flat().includes(c));
    const expected=Array(n).fill(0);let boards=0;
    for(let i=0;i<rest.length;i++)for(let j=i+1;j<rest.length;j++){
      const ranks=hole.map(h=>rank7([...board,rest[i],rest[j],...h]));
      for(const [amount,elig] of layers)refPot(ranks,elig,amount).forEach((v,p)=>expected[p]+=v);
      boards++;
    }
    const g=EM.MultiwayGame({...base,ranges,common:0,prior,dealt,folded,stacks:Array(n).fill(0),runouts:{mode:'exact'}});
    assert.equal(boards,expectedBoards);
    const m=g.metrics();assert.equal(m.nodes,1);assert.equal(m.runoutMode,'exact');
    m.ev.forEach((v,p)=>near(v,expected[p]/boards));assert.ok(m.gain.every(x=>x===0));
    assert.equal(g.view([]).runoutAveraged,true);
  }
});
test('Contributions, stacks, acting order, folds and per-street sizes carry through the river',()=>{
  const game=EM.MultiwayGame({...base,streets:{
    flop:{bets:'50',raises:'',maxBets:1},turn:{bets:'25',raises:'',maxBets:1},river:{bets:'100',raises:'',maxBets:1}}});
  game.iterate(15);game.metrics();
  let p=through(game,[],['Bet 6','Call 6','Call 6']);
  let q=game.view(p);assert.equal(q.kind,'chance');assert.equal(q.nextStreet,'Turn');near(q.pot,30);
  near(q.cards.reduce((a,b)=>a+b.prob,0),1);assert.deepEqual(q.behind,[34,34,34]);
  p=p.concat({card:q.cards[0].card});q=game.view(p);assert.equal(q.seat,0);assert.equal(q.street,'Turn');
  p=through(game,p,['Check','Bet 7.5','Fold','Call 7.5']);q=game.view(p);
  assert.equal(q.nextStreet,'River');near(q.pot,45);assert.deepEqual(q.live,[true,true,false]);assert.deepEqual(q.behind,[26.5,26.5,34]);
  for(const c of q.cards)assert.ok(!base.ranges.flatMap(splitHand).includes(c.card));
  p=p.concat({card:q.cards[0].card});assert.equal(game.view(p).seat,0);
  p=through(game,p,['All-in to 26.5','Call 26.5']);q=game.view(p);assert.equal(q.kind,'terminal');
  near(q.ev.reduce(plus,0),12);assert.equal(q.runoutAveraged,false);
});
test('Range weights, observed actions and folded hole cards determine the next-card odds',()=>{
  const rules={turn:{bets:'25',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}};
  const setup={...base,board:'2c4d7h9s',ranges:['AsAd:0.75,6c6d:0.25','KsKd','QhQd'],streets:rules,runouts:{mode:'exact'}};
  const g=EM.MultiwayGame(setup);g.iterate(60);g.metrics();
  const root=g.view([]),a=root.actions.findIndex(x=>x.label==='Bet 3');
  const p=through(g,[a],['Call 3','Fold']),q=g.view(p);assert.equal(q.kind,'chance');
  const mass=h=>h.mass*h.mix[a],total=root.hands.reduce((s,h)=>s+mass(h),0);
  const low=root.hands.find(h=>h.cards.includes('6c'));
  const pr=s=>q.cards.find(x=>x.card===EM.parseCard(s))?.prob||0;
  near(pr('As'),mass(low)/total/42);near(pr('2h'),1/42);near(pr('Qh'),0);near(pr('Kd'),0);
  near(q.cards.reduce((s,c)=>s+c.prob,0),1);
  const after=g.view(p.concat({card:EM.parseCard('As')}));
  assert.equal(after.hands.length,1);assert.ok(after.hands[0].cards.includes('6c'));
  assert.ok(!q.cards.some(c=>EM.parseBoard(setup.board).includes(c.card)));
});
test('Seeded subsets repeat, normalize for each private deal, and agree between all-in and checkdown',()=>{
  const setup={...base,board:'2c4d7h9s',ranges:['AsAd:0.75,6c6d:0.25','KsKd','QhQd'],bets:'',raises:''};
  let found=false;
  for(let seed=0;seed<100&&!found;seed++){
    const cfg={...setup,runouts:{mode:'sampled',count:1,seed}},g=EM.MultiwayGame(cfg);
    const node=g.view([0,0,0]),cards=node.cards;
    if(cards.length<2)continue;
    found=true;
    const holes=setup.ranges.slice(1).flatMap(splitHand);
    for(const card of cards) {
      let expected=0;
      for(const [h,w] of [['AsAd',.75],['6c6d',.25]]) {
        const used=holes.concat(splitHand(h)),allowed=cards.filter(v=>!used.includes(v.card));
        assert.ok(allowed.length);if(allowed.some(v=>v.card===card.card))expected+=w/allowed.length;
      }
      near(card.prob,expected);
    }
    const again=EM.MultiwayGame(cfg);assert.deepEqual(again.view([0,0,0]).cards,cards);
    const allin=EM.MultiwayGame({...cfg,stacks:[0,0,0]});
    g.metrics().ev.forEach((v,p)=>near(v,allin.metrics().ev[p]));
  }
  assert.ok(found,'coverage extension was exercised');
});
test('All-in seat remains in the main pot while covering seats bet a separate turn and river',()=>{
  const g=EM.MultiwayGame({...base,board:'2c4d7h9s',common:0,prior:[15,15,15],stacks:[0,25,25],bets:'a',runouts:{mode:'exact'}});
  const root=g.view([]);assert.equal(root.seat,1);
  const end=g.view(through(g,[],['All-in to 25','Call 25']));
  assert.equal(end.kind,'terminal');assert.deepEqual(end.pots,[{amount:45,eligible:[0,1,2]},{amount:50,eligible:[1,2]}]);
  near(end.ev.reduce(plus,0),45);assert.equal(end.runoutAveraged,true);
  const q=g.view([0,0]);assert.equal(q.nextStreet,'River');assert.equal(g.view([0,0,{card:q.cards[0].card}]).seat,1);
});
test('Action EVs use the current decision as baseline and the weighted mix gives the root EV',()=>{
  const g=EM.MultiwayGame({...base,board:'2c4d7h9s',common:10,stacks:[10,10,0],ranges:['QhQd','AsAd,KsTh','5s3d'],bets:'100',lead:[false,true,false],runouts:{mode:'exact'}});
  g.iterate(30);const m=g.metrics(),rt=g.view([]);near(rt.actions[0].ev,m.ev[0]);
  const facing=g.view([0,1]);const fold=facing.actions.findIndex(a=>a.label==='Fold');near(facing.actions[fold].ev,0);
  for(const h of facing.hands)near(h.ev[fold],0);
  assert.throws(()=>g.view([0,0,{card:EM.parseCard('2c')}]),/outside/);
  assert.throws(()=>EM.RiverGame({...base,board:'2c4d7h9s'}),/five/);
  assert.throws(()=>EM.MultiwayGame({...base,runouts:{mode:'wrong'}}),/exact or sampled/);
});

// Independent full-strategy oracle for three active seats. The last seat can
// check or shove 10 into 10 on EACH street. Two covering opponents independently
// choose call/fold, with the second seeing the first response. Future cards
// become visible only after all three check. Cards and payoffs are enumerated
// outside the training/evaluation code; only the displayed policy is read.
function checkMultiStreetBR(boardText,runouts) {
  const names=[['AsAd','KsTh'],['QhQd','AsKc'],['JhJd','8c8d']];
  const weights=[[.75,1],[1,.375],[.875,1]];
  const board=EM.parseBoard(boardText);
  const cfg={board:boardText,common:10,stacks:[10,10,10],ranges:['AsAd:0.75,KsTh','QhQd,AsKc:0.375','JhJd:0.875,8c8d'],
    lead:[false,false,true],bets:'a',raises:'',maxBets:1,runouts};
  const g=EM.MultiwayGame(cfg);g.iterate(45);const measured=g.metrics();
  const cache=new Map();
  function view(path) {
    const k=JSON.stringify(path);
    if(!cache.has(k))cache.set(k,g.view(path));
    return cache.get(k);
  }
  const ordered=s=>splitHand(s).sort((a,b)=>a-b).join(',');
  const worlds=[];
  function addWorlds(publicBoard,path,hands,privateCards,weight) {
    if(publicBoard.length===5) {
      worlds.push({hands,w:weight,full:publicBoard,scores:hands.map((h,p)=>rank7(publicBoard.concat(splitHand(names[p][h]))))});return;
    }
    const wait=path.concat(0,0,0);
    const candidates=runouts.mode==='exact'?allCards:view(wait).cards.map(c=>c.card);
    const legal=candidates.filter(c=>!publicBoard.includes(c)&&!privateCards.includes(c));assert.ok(legal.length);
    for(const c of legal)addWorlds([...publicBoard,c],wait.concat({card:c}),hands,privateCards,weight/legal.length);
  }
  for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++){
    const hands=[a,b,c],privateCards=hands.flatMap((h,p)=>splitHand(names[p][h]));
    if(new Set(privateCards).size!==6 || board.some(card=>privateCards.includes(card)))continue;
    addWorlds(board,[],hands,privateCards,weights[0][a]*weights[1][b]*weights[2][c]);
  }
  const normalization=worlds.reduce((s,w)=>s+w.w,0);
  for(const w of worlds)w.w/=normalization;
  function evaluate(focal,respond) {
    function decide(seat,path,group,alternatives) {
      if(!group.length)return 0;
      if(respond && seat===focal) {
        // A single action for each own holding across all hidden opponent
        // combinations AND all as-yet-unseen community cards in the group.
        let result=0;
        for(let h=0;h<2;h++){
          const same=group.filter(s=>s.hands[seat]===h);
          if(same.length)result+=Math.max(...alternatives.map(f=>f(same)));
        }
        return result;
      }
      const policy=view(path).hands;
      const byHand=names[seat].map(h=>policy.find(row=>ordered(row.cards)===ordered(h))?.mix);
      let result=0;
      alternatives.forEach((f,a)=>{
        const sub=[];
        for(const s of group){
          const freq=byHand[s.hands[seat]];
          assert.ok(freq,'reachable public policy for '+JSON.stringify(path));
          if(freq[a]>0)sub.push({...s,w:s.w*freq[a]});
        }
        if(sub.length)result+=f(sub);
      });
      return result;
    }
    function payoff(group,active,bet) {
      let value=0;
      for(const s of group) {
        const chips=refPot(s.scores,active,10+bet*active.length)[focal];
        value+=s.w*(chips-(active.includes(focal)?bet:0));
      }
      return value;
    }
    function round(group,length,path) {
      const btn=path.concat(0,0);
      function checked(sub) {
        if(length===5)return payoff(sub,[0,1,2],0);
        const splits=new Map();
        for(const s of sub) {
          const c=s.full[length];if(!splits.has(c))splits.set(c,[]);
          splits.get(c).push(s);
        }
        let value=0;
        for(const [c,part] of splits)value+=round(part,length+1,btn.concat(0,{card:c}));
        return value;
      }
      function shoved(sub) {
        const sb=btn.concat(1);
        return decide(0,sb,sub,[false,true].map(first=>remaining=>{
          const bb=sb.concat(+first);
          return decide(1,bb,remaining,[false,true].map(second=>w=>{
            const eligible=[2];if(first)eligible.push(0);if(second)eligible.push(1);
            return payoff(w,eligible,10);
          }));
        }));
      }
      return decide(2,btn,group,[checked,shoved]);
    }
    return round(worlds,board.length,[]);
  }
  for(let p=0;p<3;p++){
    const policy=evaluate(p,false),best=evaluate(p,true);
    near(measured.ev[p],policy);near(measured.best[p],best);near(measured.gain[p],best-policy);
  }
  return measured;
}
test('Exact turn-through-river EVs and best responses match an independent whole-strategy oracle for all three seats',()=>{
  const m=checkMultiStreetBR('2c4d7h9s',{mode:'exact'});
  assert.equal(m.deals,6);near(m.ev.reduce(plus,0),10);
});
test('Sampled flop-through-river EVs and best responses match the independent oracle across both public-card reveals',()=>{
  const m=checkMultiStreetBR('2c4d7h',{mode:'sampled',count:4,seed:77});
  assert.equal(m.startStreet,'Flop');assert.ok(m.turnBoards>=4&&m.riverBoards>=16);
});
test('Worker returns a connected flop solve, explains an oversized exact tree, and can solve again',async()=>{
  const pending=new Map(),port={postMessage(m){if(m.type==='progress')return;
    const job=pending.get(m.id);pending.delete(m.id);
    if(m.type==='error')job.reject(new Error(m.message));else job.resolve(m.result);
  }};
  EM.workerMain(port);let seq=0;
  function ask(type,data){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});port.onmessage({data:{type,id,...data}});});}
  await assert.rejects(ask('multi-solve',{cfg:{...base,stacks:[60,60,60,60,60],ranges:['AsAd','KsKd','QhQd','8c8d','6c6d'],
    bets:'25,50,100',raises:'2x,3x,a',maxBets:4,runouts:{mode:'exact'}},maxIter:1,target:0}),/budget/);
  const solved=await ask('multi-solve',{cfg:base,target:0,maxIter:5});
  assert.equal(solved.metrics.iterations,5);assert.equal(solved.metrics.runoutMode,'sampled');
  const turn=await ask('multi-node',{path:[0,0,0]});assert.equal(turn.nextStreet,'Turn');
  const dealt=await ask('multi-node',{path:[0,0,0,{card:turn.cards[0].card}]});assert.equal(dealt.street,'Turn');
});
test('Exact flop with betting on all three streets keeps full ordered turn/river branches',()=>{
  const cfg={...base,common:10,stacks:[10,10,10],bets:'a',lead:[false,false,true],runouts:{mode:'exact'}};
  const g=EM.MultiwayGame(cfg);g.iterate(2);const m=g.metrics();
  assert.equal(m.turnBoards,43);assert.equal(m.riverBoards,43*42);near(m.ev.reduce(plus,0),10);
  const turn=g.view([0,0,0]);assert.equal(turn.cards.length,43);
  const p=[0,0,0,{card:turn.cards[0].card},0,0,0],river=g.view(p);
  assert.equal(river.cards.length,42);
  const r=g.view(p.concat({card:river.cards[0].card},0,0));
  assert.equal(r.street,'River');assert.equal(r.seat,2);assert.deepEqual(r.actions.map(a=>a.label),['Check','All-in to 10']);
});
test('A three-way preflop node transfers its live ranges, pot and action order into the flop solver',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');require('../web/lib_deep.js');
  const m=EM.DeepTree({n:8,stack:25});
  const labels=['Raise 2','Call 2','Fold','Fold','Fold','Fold','Fold','Call 1'];
  const r=m.reachAt(labels),w=m.view(r.id);near(w.pot,7.3);
  let transfer,selected;
  const app=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
  const body=app.slice(app.indexOf('function deepToRiver()'),app.indexOf('function renderDeep('));
  vm.runInNewContext(body+'\ndeepToRiver();',{EM,deepSol:()=>({m}),DP:{line:w.line},
    riverPanel:{importSpot(data){transfer=data;return true;}},setTab:t=>{selected=t;}});
  assert.equal(selected,'river');assert.equal(transfer.board,'');assert.match(transfer.notes,/three-card flop/i);
  assert.deepEqual(Array.from(transfer.seats,s=>s.name),['BB','UTG','UTG+1']);
  assert.deepEqual(Array.from(transfer.seats,s=>Number(s.stack)),[22.9,22.9,22.9]);
  const folded=transfer.folded.split(',').filter(v=>v.trim()).map(Number);
  assert.equal(transfer.dealt,8);assert.equal(Number(transfer.common),0);
  near(EM.tableAntes(transfer.dealt)+Number(transfer.common)+folded.reduce(plus,0)+Array.from(transfer.seats,s=>+s.prior).reduce(plus,0),7.3);
  for(const seat of transfer.seats)assert.ok(EM.parseRange(seat.range).some(v=>v>0));
});
