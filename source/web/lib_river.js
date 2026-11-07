(function (EM) {
'use strict';
const EPS = 1e-8;
const MAX_DEALS = 4096, MAX_NODES = 4000, MAX_PAIRS = 180000;
const formatted = new Map();
const format = x => { let s = formatted.get(x); if (s === undefined) { s = String(+x.toFixed(3)); if (formatted.size > 50000) formatted.clear(); formatted.set(x, s); } return s; };
function numbers(values, n, label) {
  if (!Array.isArray(values) || values.length !== n || values.some(v => !Number.isFinite(v) || v < 0))
    throw new Error('Enter ' + n + ' nonnegative numbers for ' + label);
  return values.slice();
}
function sizeList(text, raising) {
  const words = String(text || '').trim().split(/[\s,]+/).filter(Boolean);
  if (words.length > 5) throw new Error('Use at most five sizes in each box');
  return words.map(word => {
    if (/^(a|all-in)$/i.test(word)) return { kind:'jam' };
    if (/^(g|geo)$/i.test(word)) {
      if (raising) throw new Error('Geometric sizing (g) is for bets, not raises');
      return { kind:'geo' };
    }
    const m = /^(\d+(?:\.\d+)?)(%|x)?$/i.exec(word);
    if (!m || !(+m[1] > 0) || +m[1] > 2000) throw new Error('Unrecognized size ' + word);
    if (m[2] && m[2].toLowerCase() === 'x') {
      if (!raising || +m[1] <= 1) throw new Error('Use a multiple greater than 1 for raises');
      return { kind:'multiple', value:+m[1] };
    }
    return { kind:'pot', value:+m[1] / 100 };
  });
}

// Resource limits for automatic private-range mode selection. Exact enumeration
// is kept when the joint deal tree fits the desktop budget and a 500-iteration
// solve is expected to finish within about a minute on a desktop CPU.
const AUTO_MAX_WORK=2.5e6;            // deal-node visits per iteration (all seats)
const budgetCode=e=>{e.code='EM_BUDGET';return e;};
function buildMultiway(input, opts={}) {
  const cfg=EM.copyStudyConfig(input);
  const pre=cfg.preflop || null, shove=pre?.mode==='shove';
  const n = cfg.stacks && cfg.stacks.length;
  if (!Number.isInteger(n) || n < 2 || n > 8) throw new Error('Use two to eight seats');
  if(pre && !['linked','shove'].includes(pre.mode))throw Error('Choose linked preflop or shove/call mode');
  const entered=numbers(cfg.stacks,n,pre?'stacks before posting':'stacks behind');
  const antes=EM.anteModel(cfg);
  // Each live seat's own ante: preflop seats are in action order with the BB last. A postflop
  // study can name the live seat that posted a big blind ante (anteSeat), for ICM start stacks.
  const ownAnte=Array.from({length:n},(_,p)=>cfg.dealt===undefined?0:antes.seat(pre?p===n-1:p===cfg.anteSeat));
  if(pre && (cfg.dealt===undefined || entered.some((s,p)=>s<ownAnte[p]||!(s>0))))throw Error(antes.type==='classic'?'Preflop needs dealt seats and starting stacks of at least '+antes.amount+' bb':'Preflop needs dealt seats and starting stacks that cover each ante');
  const stacks=pre?entered.map((s,p)=>s-ownAnte[p]):entered;
  const prior = numbers(cfg.prior || Array(n).fill(0), n, 'earlier contributions');
  const folded = numbers(cfg.folded || [], (cfg.folded || []).length, 'folded contributions');
  if (folded.length + n > 8) throw new Error('At most eight seats can have contributed');
  // A tournament setup itemizes the starting pot. Older API callers supplied
  // the full common pot, including any antes, without a dealt-seat count.
  if (cfg.dealt !== undefined) EM.tableAntes(cfg.dealt);   // validates the dealt count
  const antePot = cfg.dealt === undefined ? 0 : antes.total(cfg.dealt);
  if (cfg.dealt !== undefined && n + folded.length > cfg.dealt)
    throw new Error('Players dealt in must include every live seat and each listed folded wager.');
  if (!Number.isFinite(cfg.common) || cfg.common < 0) throw new Error('Enter a nonnegative common pot');
  const common = cfg.common + antePot, pot0 = common + [...prior, ...folded].reduce((sum,v) => sum+v,0);
  if (!Number.isFinite(common) || common < 0 || !(pot0 > 0 || pre) || !Number.isFinite(stacks.reduce((a,b)=>a+b,pot0))) throw new Error('Enter a positive starting pot');
  const paid = [...prior,...folded].sort((a,b)=>b-a);
  if (paid[0] > paid[1]+EPS) throw new Error('Return unmatched earlier contributions before the starting street');
  if (folded.some(v=>v>Math.max(...prior)+EPS)) throw new Error('Earlier folded wagers need a matching live contribution');
  if(pre && (prior.some(x=>x!==0) || folded.length || cfg.common!==0))
    throw Error('Preflop posts blinds and antes automatically; leave earlier wagers and other common chips at zero');
  const board = typeof cfg.board === 'string' ? EM.parseBoard(cfg.board) : cfg.board;
  if (!Array.isArray(board) || (pre?board.length!==0:(board.length < 3 || board.length > 5)) || new Set(board).size !== board.length ||
      board.some(c => !Number.isInteger(c) || c<0 || c>51)) throw new Error(pre?'Leave the board empty for preflop':'Enter three, four or five different board cards');
  if (!Array.isArray(cfg.ranges) || cfg.ranges.length !== n) throw new Error('Enter a range for every seat');
  const open = cfg.lead || Array(n).fill(true);
  if (open.length !== n) throw new Error('Opening permissions do not match the seats');
  const streetName = length => length===0?'Preflop':['Flop','Turn','River'][length-3];
  const icm=EM.multiwayICM(pre?{...cfg,icm:cfg.icm?{...cfg.icm,startStacks:entered}:null}:cfg,stacks,prior,n,ownAnte);
  const utilityMeta=icm?{utility:'icm',unit:icm.unit,prizePool:icm.prizePool,reportThreshold:icm.reportThreshold,icmPlayers:icm.players}:{utility:'chips',unit:'bb',reportThreshold:0.1};
  // Flat configuration remains supported for saved river setups and callers.
  function treeSizes(length) {
    const key=streetName(length).toLowerCase();
    const row=cfg.streets && cfg.streets[key] || cfg;
    const cap=row.maxBets==null?2:row.maxBets;
    if(!Number.isInteger(cap) || cap<1 || cap>5) throw new Error('Choose one to five bets on the '+key);
    return {bets:sizeList(row.bets,false),raises:sizeList(row.raises,true),cap};
  }
  const sizes={};
  for(let k=Math.max(3,board.length);k<=5;k++) sizes[k]=treeSizes(k);
  if(pre) {
    const cap=pre.maxBets??3;
    if(!Number.isInteger(cap)||cap<1||cap>5)throw Error('Choose one to five preflop raises');
    const opens=String(pre.opens??'2').split(/[\s,]+/).filter(Boolean).map(x=>{
      if(/^(a|all-in)$/i.test(x))return {kind:'jam'};
      const value=Number(x);if(!Number.isFinite(value)||value<2||value>250)throw Error('Preflop opening sizes must be 2 to 250 bb or a');
      return {kind:'absolute',value};
    });
    if(opens.length>5)throw Error('Use at most five preflop opening sizes');
    sizes[0]={bets:shove?[{kind:'jam'}]:opens,raises:shove?[{kind:'jam'}]:sizeList(pre.raises??'3x,a',true),cap:shove?8:cap};
  }
  const hands = cfg.ranges.map((input,p) => {
    const range = typeof input === 'string' ? EM.parseRange(input) : input;
    if (!range || range.length !== 1326) throw new Error('Bad range at seat ' + (p+1));
    const choices = [];
    for (let i=0; i<1326; i++) {
      const w=range[i], a=EM.C1[i], b=EM.C2[i];
      if (!Number.isFinite(w) || w<0 || w>1) throw new Error('Range weights must be between 0 and 1');
      if (w>0 && !board.includes(a) && !board.includes(b))
        choices.push({a,b,w,id:i});
    }
    if (!choices.length) throw new Error('Seat '+(p+1)+' has no hands compatible with the board');
    return choices;
  });

  const wide=cfg.privateMode==='sampled';
  if(pre && !wide)throw Error('Preflop studies require Wide ranges sampling');
  const traversal=cfg.traversal || 'auto';
  if(!['auto','full','external'].includes(traversal))throw new Error('Unknown traversal mode');
  // Fine card histories create many rows across future streets. Automatic
  // traversal samples betting branches before those rows exhaust the budget.
  let external=wide && (traversal==='external' || Boolean(pre) ||
    (traversal==='auto' && board.length<5 && (cfg.abstraction||'detailed')!=='compact'));
  const fullTreeLimit=new Error('Full traversal exceeds 2,200 betting states. Choose automatic traversal.');

  const maxStates=board.length===5?MAX_NODES:60000;
  const maxDealStates=board.length===5?MAX_PAIRS:750000;
  const budgetError=()=>budgetCode(new Error('This betting tree exceeds the desktop budget. Use fewer bet sizes or raises, narrower ranges, sampled public cards, or Automatic / Wide ranges private-card mode.'));
  const zeros=()=>Array(n).fill(0);
  const sum=a=>a.reduce((s,v)=>s+v,0);

  // Small games reuse their full betting tree. Large sampled games recreate
  // only the visited states, using the same transitions and legal actions.
  const byStreet={0:[],3:[],4:[],5:[]};
  let templateCount=0;
  function build(length,previous,put,live,acted,price,full,count,last,path='r') {
    if(!external && ++templateCount>(wide?2200:maxStates))throw wide?fullTreeLimit:budgetError();
    const total=put.map((v,p)=>previous[p]+v);
    const behind=stacks.map((v,p)=>Math.max(0,v-total[p]));
    const acting=live.map((v,p)=>v && behind[p]>EPS);
    const liveCount=live.filter(Boolean).length, left=acting.filter(Boolean).length;
    // A short blind cannot create a call obligation once every opponent is all-in.
    if(length===0 && left<=1)price=Math.min(price,Math.max(...put.filter((_,p)=>live[p])));
    const tpl={length,live,behind,total,pot:pot0+sum(total),actor:-1,path};
    if(!external)byStreet[length].push(tpl);
    if(liveCount>1) for(let i=1;i<=n;i++) {
      const p=(last+i+n)%n;
      if(acting[p] && (put[p]<price-EPS || (left>1 && acted[p]<0))){tpl.actor=p;break;}
    }
    if(tpl.actor<0) {
      if(liveCount>1 && left>=2 && length<5 && !(shove && length===0)) {
        tpl.kind='chance';
        if(!external)tpl.next=nextStreet(tpl);
      } else {
        tpl.kind='terminal';
        const committed=prior.map((v,p)=>v+total[p]).concat(folded);
        tpl.pots=EM.potLayers(committed,live.concat(folded.map(()=>false)),common);
      }
      return tpl;
    }
    tpl.kind='player';
    const p=tpl.actor, remaining=stacks[p]-previous[p], call=Math.min(price,remaining);
    const facing=price>put[p]+EPS, row=sizes[length];
    let actions=facing
      ? [{kind:'fold',to:put[p],label:'Fold'},{kind:'call',to:call,label:'Call '+format(call-put[p])}]
      : [{kind:'check',to:put[p],label:'Check'}];
    const allInOpponent=live.some((v,i)=>v && i!==p && behind[i]<=EPS && put[i]>EPS);
    if(length===0 && count===0 && facing && remaining>price+EPS && left>1 && !allInOpponent && (shove || pre.limps===false))actions=actions.filter(a=>a.kind!=='call');
    const respondent=live.some((v,i)=>v && i!==p && stacks[i]-previous[i]>price+EPS);
    if(respondent && count<row.cap && (facing || open[p]) && EM.raiseIsOpen(acted[p],price,full)) {
      const amounts=[];
      for(const size of (length===0?(count?row.raises:row.bets):(facing?row.raises:row.bets))) {
        let to=remaining;
        if(size.kind==='absolute')to=size.value;
        if(size.kind==='multiple')to=size.value*price;
        if(size.kind==='pot')to=price+size.value*(tpl.pot+(facing?price-put[p]:0));
        if(size.kind==='geo'){
          // The same pot fraction on this and every later street gets the effective stack in by the
          // river if one opponent calls each bet (multiway pots grow faster, so it then reaches all-in sooner).
          const others=live.map((v,i)=>v&&i!==p?behind[i]:0), eff=Math.min(behind[p],Math.max(...others));
          const k=length===0?1:6-length;
          to=price+(Math.pow(1+2*eff/tpl.pot,1/k)-1)/2*tpl.pot;
        }
        to=Math.min(remaining,Math.max(price+full,to));
        if(to>price+EPS && !amounts.some(v=>Math.abs(v-to)<EPS))amounts.push(to);
      }
      for(const to of amounts.sort((a,b)=>a-b)) {
        const jam=Math.abs(to-remaining)<EPS;
        actions.push({kind:'aggressive',to,label:(jam?'All-in to ':facing?'Raise to ':'Bet ')+format(to)});
      }
    }
    tpl.actions=actions;
    tpl.state={previous,put,acted,price,full,count};
    if(!external){
      tpl.children=actions.map((_,a)=>advance(tpl,a));
      delete tpl.state;
    }
    return tpl;
  }
  function nextStreet(t) {
    if(t.next)return t.next;
    const first=pre?(n===2?1:n-2):0;
    return build(t.length===0?3:t.length+1,t.total,zeros(),t.live,Array(n).fill(-1),0,1,0,first-1,t.path+'c');
  }
  function advance(t,a) {
    if(t.children)return t.children[a];
    const {previous,put,acted,price,full,count}=t.state, p=t.actor, action=t.actions[a];
    const live=t.live.slice(),nextPut=put.slice(),nextActed=acted.slice();
    if(action.kind==='fold')live[p]=false;
    nextPut[p]=action.to;nextActed[p]=action.to;
    const increase=action.to>price+EPS;
    return build(t.length,previous,nextPut,live,nextActed,increase?action.to:price,
      increase?Math.max(full,action.to-price):full,count+(increase?1:0),p,t.path+a);
  }
  let tree;
  const posted=pre?stacks.map((s,p)=>Math.min(s,p===n-1?1:p===n-2?0.5:0)):zeros();
  const makeRoot=()=>build(board.length,zeros(),posted,Array(n).fill(true),Array(n).fill(-1),pre?1:0,1,0,-1);
  try {tree=makeRoot();}
  catch(e){
    if(e!==fullTreeLimit || traversal!=='auto')throw e;
    external=true;
    Object.values(byStreet).forEach(list=>list.length=0);
    templateCount=0;
    tree=makeRoot();
  }
  if(wide)return EM.wideGame({cfg,board,hands,tree,n,streetName,nodes:templateCount,external,advance,nextStreet,icm,utilityMeta,ownAnte:pre?ownAnte:Array(n).fill(0)});
  // Enumerate the conditional joint deal once. Private cards in folded river
  // hands still block other hands; seats never see their opponents' hole cards.
  const deals=[], weights=[], picked=Array(n), used=new Uint8Array(52);
  board.forEach(c=>{used[c]=1;});
  const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>hands[a].length-hands[b].length);
  let visited=0, mass=0;
  function deal(k,weight) {
    if (k===n) {
      if (deals.length>=MAX_DEALS) throw budgetCode(new Error('Too many compatible deals. Narrow a range or use exact two-card hands (limit 4,096 deals).'));
      deals.push(picked.slice()); weights.push(weight); mass+=weight; return;
    }
    const p=order[k];
    for (let h=0;h<hands[p].length;h++) {
      if (++visited>2000000) throw budgetCode(new Error('Range combination search is too large. Narrow the ranges.'));
      const hand=hands[p][h];
      if (used[hand.a] || used[hand.b]) continue;
      used[hand.a]=used[hand.b]=1; picked[p]=h; deal(k+1,weight*hand.w); used[hand.a]=used[hand.b]=0;
    }
  }
  deal(0,1);
  const D=deals.length;
  if (!(mass>0)) throw new Error('The ranges have no mutually compatible private hands');
  const chance=Float64Array.from(weights,w=>w/mass);
  // Remove individually possible hands that have no compatible joint deal.
  // This keeps storage proportional to the range actually used in the solve.
  const hole=hands.map((hs,p)=>{
    const map=new Map(), compact=[];
    const ids=Uint16Array.from(deals,deal=>{
      const old=deal[p];
      if(!map.has(old)){map.set(old,compact.length);compact.push(hs[old]);}
      return map.get(old);
    });
    hands[p]=compact;return ids;
  });
  const deck=EM.multiwayBoards(board,hands,hole,D,cfg.runouts || {});
  // Reject over-budget configurations before allocating the per-board strategies.
  let publicStates=0, estimatedBytes=0, work=0, contexts=[deck.root];
  for(let length=board.length;length<=5;length++) {
    const templates=byStreet[length];
    publicStates+=contexts.length*templates.length;
    if(publicStates>maxStates || publicStates*D>maxDealStates)throw budgetError();
    for(const t of templates) {
      const k=t.actions?t.actions.length:0;
      const strategy=k>1?hands[t.actor].length*(40*k+9):0;
      const payoff=t.kind==='terminal'?8*n*D:0;
      estimatedBytes+=contexts.length*(16*D+320+strategy+payoff);
    }
    if(estimatedBytes>150*1024*1024)throw budgetError();
    for(const t of templates)if(t.kind!=='chance')work+=contexts.length*D*n;
    if(length===5 || !byStreet[length+1].length)break;
    const next=[];
    for(const ctx of contexts) for(const edge of deck.edges(ctx))next.push(edge.ctx);
    contexts=next;
  }

  if(opts.planOnly)return {deals:D,publicStates,estimatedMiB:estimatedBytes/1048576,work,players:n};
  const decisions=[], seatNodes=hands.map(()=>[]);
  function instantiate(t,ctx) {
    const node={t,ctx,reach:new Float64Array(D)};
    const forced=t.kind==='player' && t.actions.length===1;
    if(!forced)node.out=new Float64Array(D);
    if(t.kind==='terminal') {
      if(icm)node.pay=deck.utilities(ctx,t,icm);
      else {
        node.pay=t.total.map(v=>new Float64Array(D).fill(-v));
        for(const pot of t.pots)deck.award(ctx,node.pay,pot);
      }
    } else if(t.kind==='chance') {
      node.edges=deck.edges(ctx);
      node.children=node.edges.map(e=>instantiate(t.next,e.ctx));
    } else {
      const p=t.actor,k=t.actions.length;
      node.children=t.children.map(child=>instantiate(child,ctx));
      if(forced)node.out=node.children[0].out;
      else {
        const size=hands[p].length*k;
        node.regret=new Float64Array(size);node.sum=new Float64Array(size);
        node.policy=new Float64Array(size).fill(1/k);node.average=new Float64Array(size).fill(1/k);
        node.byAction=new Float64Array(size);node.best=new Uint8Array(hands[p].length);
        node.ownChild=new Float64Array(hands[p].length);
        decisions.push(node);seatNodes[p].push(node);
      }
    }
    return node;
  }
  const root=instantiate(tree,deck.root);
  const ownInit=hands.map(hs=>new Float64Array(hs.length).fill(1));
  let iterations=0;

  // Counterfactual reach includes both opponent actions and chance. An own
  // decision has one choice per known hand across every compatible hidden deal.
  function walk(nd,p,reach,own,mode) {
    const out=nd.out,t=nd.t;
    if(t.kind==='terminal') {
      for(let d=0;d<D;d++)out[d]=reach[d]*nd.pay[p][d];
      return out;
    }
    if(t.kind==='player' && t.actions.length===1)return walk(nd.children[0],p,reach,own,mode);
    out.fill(0);
    if(t.kind==='chance') {
      for(const child of nd.children) {
        const next=child.reach,valid=child.ctx.valid,inv=nd.ctx.inverse;
        for(let d=0;d<D;d++)next[d]=valid[d]?reach[d]*inv[d]:0;
        const value=walk(child,p,next,own,mode);
        for(let d=0;d<D;d++)out[d]+=value[d];
      }
      return out;
    }
    const actor=t.actor,k=t.actions.length,ids=hole[actor],train=mode==='train';
    const sig=train?nd.policy:nd.average;
    if(actor!==p) {
      for(let a=0;a<k;a++) {
        const child=nd.children[a],next=child.reach;
        for(let d=0;d<D;d++)next[d]=reach[d]*sig[ids[d]*k+a];
        const value=walk(child,p,next,own,mode);
        for(let d=0;d<D;d++)out[d]+=value[d];
      }
      return out;
    }
    const values=nd.byAction;values.fill(0);
    for(let a=0;a<k;a++) {
      const next=nd.ownChild;
      if(train)for(let h=0;h<own.length;h++) {
        const i=h*k+a;next[h]=own[h]*sig[i];nd.sum[i]+=iterations*next[h];
      }
      const v=walk(nd.children[a],p,reach,train?next:own,mode);
      for(let d=0;d<D;d++){
        const ix=ids[d]*k+a;values[ix]+=v[d];if(mode!=='best')out[d]+=sig[ix]*v[d];
      }
    }
    if(mode==='best'){
      for(let h=0;h<hands[p].length;h++) {
        const offset=h*k;let best=0;
        for(let a=1;a<k;a++)if(values[offset+a]>values[offset+best])best=a;
        nd.best[h]=best;
      }
      for(let d=0;d<D;d++)out[d]=nd.children[nd.best[ids[d]]].out[d];
    } else if(train) {
      for(let h=0;h<own.length;h++) {
        const offset=h*k;let mean=0;
        for(let a=0;a<k;a++)mean+=sig[offset+a]*values[offset+a];
        for(let a=0;a<k;a++)nd.regret[offset+a]=Math.max(0,nd.regret[offset+a]+values[offset+a]-mean);
      }
    }
    return out;
  }
  function normalize(source,dest,k) {
    for(let i=0;i<source.length;i+=k) {
      let total=0;for(let a=0;a<k;a++)total+=source[i+a];
      for(let a=0;a<k;a++)dest[i+a]=total>0?source[i+a]/total:1/k;
    }
  }
  function iterate(count=1) {
    for(let j=0;j<count;j++) {
      iterations++;
      for(let p=0;p<n;p++) {
        walk(root,p,chance,ownInit[p],'train');
        for(const nd of seatNodes[p])normalize(nd.regret,nd.policy,nd.t.actions.length);
      }
    }
  }
  function metrics() {
    for(const nd of decisions)normalize(nd.sum,nd.average,nd.t.actions.length);
    const ev=[],best=[],gain=[];
    for(let p=0;p<n;p++) {
      ev.push(sum(walk(root,p,chance,ownInit[p],'average')));
      best.push(sum(walk(root,p,chance,ownInit[p],'best')));
      gain.push(Math.max(0,best[p]-ev[p]));
    }
    return {...utilityMeta,iterations,ev,best,gain,maxGain:Math.max(...gain),deals:D,nodes:publicStates,
      startStreet:streetName(board.length),runoutMode:deck.mode,seed:deck.seed,sampleCount:deck.sampleCount,
      turnBoards:deck.counts[4],riverBoards:deck.counts[5]};
  }
  function view(path=[]) {
    let nd=root;
    const reach=chance.slice(),line=[];
    for(const step of path) {
      const t=nd.t;
      if(t.kind==='chance') {
        const i=step && typeof step==='object'?nd.edges.findIndex(e=>e.card===step.card):-1;
        if(i<0)throw new Error('This card is outside the solved runout tree');
        const child=nd.children[i],card=nd.edges[i].card;
        for(let d=0;d<D;d++)reach[d]=child.ctx.valid[d]?reach[d]*nd.ctx.inverse[d]:0;
        line.push({kind:'card',card,label:streetName(child.ctx.cards.length)+' '+EM.cardStr(card)});
        nd=child;
      } else {
        if(t.kind!=='player' || !Number.isInteger(step) || step<0 || step>=t.actions.length)throw new Error('Invalid postflop action path');
        line.push({kind:'action',seat:t.actor,label:t.actions[step].label});
        const k=t.actions.length;
        if(k>1) for(let d=0;d<D;d++)reach[d]*=nd.average[hole[t.actor][d]*k+step];
        nd=nd.children[step];
      }
    }
    const t=nd.t,prob=sum(reach);
    const result={...utilityMeta,kind:t.kind,line,seat:t.actor,prob,pot:t.pot,board:nd.ctx.cards.slice(),
      street:streetName(nd.ctx.cards.length),behind:t.behind.slice(),live:t.live.slice()};
    if(t.kind==='terminal') {
      result.pots=t.pots;
      result.ev=nd.pay.map(pay=>prob>0?pay.reduce((v,y,d)=>v+reach[d]*y,0)/prob:null);
      result.runoutAveraged=t.length<5 && t.pots.some(pot=>pot.eligible.length>1);
    } else if(t.kind==='chance') {
      result.nextStreet=streetName(t.length+1);
      result.cards=nd.edges.map(edge=>{
        let mass=0;for(let d=0;d<D;d++)if(edge.ctx.valid[d])mass+=reach[d]*nd.ctx.inverse[d];
        return {card:edge.card,label:EM.cardStr(edge.card),prob:prob>0?mass/prob:null};
      });
    } else {
      const p=t.actor,k=t.actions.length,mass=new Float64Array(hands[p].length);
      for(let d=0;d<D;d++)mass[hole[p][d]]+=reach[d];
      // A counterfactual action followed by the displayed continuation strategy.
      // Adding chips already committed since the root makes folding here worth zero.
      const handEV=t.actions.map((_,a)=>{
        const weighted=walk(nd.children[a],p,reach,ownInit[p],'average');
        const byHand=new Float64Array(hands[p].length);
        for(let d=0;d<D;d++)byHand[hole[p][d]]+=weighted[d];
        return byHand;
      });
      result.actions=t.actions.map((action,i)=>({
        label:action.label,
        frequency:prob>0?(k===1?1:mass.reduce((v,w,h)=>v+w*nd.average[h*k+i],0)/prob):null,
        ev:prob>0?sum(handEV[i])/prob+(icm?0:t.total[p]):null
      }));
      result.hands=hands[p].map((h,i)=>({cards:EM.comboStr(h.id),mass:mass[i],
        mix:k===1?[1]:Array.from(nd.average.subarray(i*k,(i+1)*k)),
        ev:handEV.map(values=>mass[i]>0?values[i]/mass[i]+(icm?0:t.total[p]):null)})).filter(h=>h.mass>0);
    }
    return result;
  }
  function snapshot(labels){
    return EM.checkpointPayload(cfg,{kind:'exact',iterations,records:decisions.map(nd=>({path:nd.t.path,board:nd.ctx.cards,
      regret:EM.packTrainingValues(nd.regret),sum:EM.packTrainingValues(nd.sum)}))},labels);
  }
  function restoreState(state){
    const bad=EM.checkpointFail;EM.checkpointInteger(state.iterations);
    if(iterations || state.kind!=='exact'||!Array.isArray(state.records)||state.records.length!==decisions.length)bad();
    const buffers=decisions.map((nd,i)=>{
      const row=state.records[i];if(!row||row.path!==nd.t.path||JSON.stringify(row.board)!==JSON.stringify(nd.ctx.cards))bad();
      return [EM.unpackTrainingValues(row.regret,nd.regret.length,true),EM.unpackTrainingValues(row.sum,nd.sum.length,true)];
    });
    decisions.forEach((nd,i)=>{nd.regret.set(buffers[i][0]);nd.sum.set(buffers[i][1]);normalize(nd.regret,nd.policy,nd.t.actions.length);normalize(nd.sum,nd.average,nd.t.actions.length);});
    iterations=state.iterations;
  }
  // Replace the average strategy with one supplied by another solver (for
  // example a sampled study), so metrics() measures that strategy's exact
  // best-response gains in this enumerated game. lookup(path, publicCards, seat,
  // hand) returns action probabilities or null (treated as uniform).
  function importAverage(lookup){
    let missing=0,total=0;
    for(const nd of decisions){
      const k=nd.t.actions.length,p=nd.t.actor;
      hands[p].forEach((hand,h)=>{
        total++;const probs=lookup(nd.t.path,nd.ctx.cards.slice(),p,hand);
        for(let a=0;a<k;a++)nd.sum[h*k+a]=probs?probs[a]:1/k;
        if(!probs)missing++;
      });
    }
    return {missing,total};
  }
  return {iterate,metrics,view,snapshot,restoreState,importAverage,get iterations(){return iterations;}};
}
// Choose exact deal enumeration or sampled (Wide ranges) training. The exact
// plan runs the same betting-tree, deal-enumeration and budget checks as an exact
// solve, without allocating strategies, so a spot is enumerated only when an
// exact solve would actually be accepted and finish in practical time.
function planMultiwayMode(input) {
  const base={requested:'auto'};
  if(input && input.preflop)return {...base,chosen:'sampled',reason:'Preflop studies always use sampled deals'};
  let plan;
  try{plan=buildMultiway({...input,privateMode:'exact'},{planOnly:true});}
  catch(e){
    if(e && e.code==='EM_BUDGET')return {...base,chosen:'sampled',reason:'Exact enumeration exceeds the desktop limit: '+e.message};
    throw e;
  }
  if(plan.work>AUTO_MAX_WORK)return {...base,chosen:'sampled',...plan,
    reason:'Exact enumeration fits in memory but needs about '+Math.round(plan.work/1e3)+'k deal-node visits per iteration (limit '+AUTO_MAX_WORK/1e3+'k)'};
  return {...base,chosen:'exact',...plan,reason:'Exact enumeration fits: '+plan.deals+' deals, '+plan.publicStates+' public states, about '+plan.estimatedMiB.toFixed(1)+' MiB'};
}
function MultiwayGame(input) {
  if(!input || input.privateMode!=='auto')return buildMultiway(input);
  const selection=planMultiwayMode(input);
  const resolved={...input,privateMode:selection.chosen};
  const game=buildMultiway(resolved);
  const metrics=game.metrics;
  game.metrics=(...a)=>({...metrics(...a),modeSelection:selection});
  game.modeSelection=selection;game.resolvedConfig=EM.copyStudyConfig(resolved);
  return game;
}
EM.MultiwayGame=MultiwayGame;
EM.planMultiwayMode=planMultiwayMode;
// Independent exact evaluation of a sampled (Wide ranges) study: when the same
// spot can be enumerated, its average strategy is copied into the exact game and
// each seat's full best response is computed there. This is an exact
// unilateral-deviation gain for the configured tree (not an equilibrium
// certificate for the multiplayer game).
function exactCheckSampled(cfg,game){
  if(!game || typeof game.averageAt!=='function')return {available:false,reason:'Only sampled studies need an exact cross-check'};
  if(cfg.abstraction && cfg.abstraction!=='exact' && cfg.abstraction!=='detailed' && cfg.abstraction!=='compact')return {available:false,reason:'Unknown abstraction'};
  const plan=planMultiwayMode({...cfg,privateMode:'auto'});
  if(plan.chosen!=='exact')return {available:false,reason:plan.reason};
  const exact=buildMultiway({...cfg,privateMode:'exact'});
  const coverage=exact.importAverage(game.averageAt), m=exact.metrics();
  return {available:true,kind:'exact best response in the enumerated game',iterations:game.iterations,
    gain:m.gain,maxGain:m.maxGain,ev:m.ev,best:m.best,unit:m.unit,deals:m.deals,
    unvisitedInformationSets:coverage.missing,informationSets:coverage.total};
}
EM.exactCheckSampled=exactCheckSampled;
EM.multiwaySizeList=sizeList;
EM.RiverGame=function(cfg) {
  const board=typeof cfg.board==='string'?EM.parseBoard(cfg.board):cfg.board;
  if(!board || board.length!==5)throw new Error('Enter five different board cards');
  return MultiwayGame(cfg);
};
})(globalThis.EM || (globalThis.EM = {}));
