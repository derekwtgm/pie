(function(EM){
'use strict';
function randomStream(seed) {
  let state=seed>>>0;
  const next=()=>{state=(state+0x6d2b79f5)>>>0;let x=Math.imul(state^(state>>>15),state|1);
    x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};
  next.state=()=>state;next.restore=value=>{state=EM.checkpointInteger(value,4294967295);};return next;
}
// Reject the entire independent tuple on a collision. Retrying just the
// colliding seat would bias earlier seats' hand probabilities.
function dealer(hands, visible, rng) {
  const boardSet=new Set(visible);
  const distributions=hands.map(range=>{
    let total=0;
    const rows=range.filter(h=>!boardSet.has(h.a)&&!boardSet.has(h.b)).map(h=>({h,cum:total+=h.w}));
    if(!rows.length)throw Error('A range is blocked on this board');
    return {rows,total};
  });
  const used=new Uint32Array(52);let stamp=0;
  return ()=>{
    for(let tries=0;tries<4096;tries++){
      if(++stamp>=4294967295){used.fill(0);stamp=1;}
      visible.forEach(c=>used[c]=stamp);
      const seats=[];
      for(const {rows,total} of distributions){
        const x=rng()*total;let lo=0,hi=rows.length-1;
        while(lo<hi){const mid=(lo+hi)>>1;if(x<rows[mid].cum)hi=mid;else lo=mid+1;}
        const h=rows[lo].h;if(used[h.a]===stamp||used[h.b]===stamp)break;
        seats.push(h);used[h.a]=used[h.b]=stamp;
      }
      if(seats.length!==hands.length)continue;
      const cards=visible.slice();while(cards.length<5){const c=Math.floor(rng()*52);if(used[c]!==stamp){used[c]=stamp;cards.push(c);}}
      return {seats,cards};
    }
    throw Error('Compatible hands are too rare to sample reliably. Review overlapping ranges or use exact deals.');
  };
}
function strengthGroup(h,cards,score) {
  const category=score>>>26, detail=(score>>>13)&8191;
  const top=31-Math.clz32(detail || (score&8191));
  const suits=[0,0,0,0];let ranks=0;
  for(const c of [...cards,h.a,h.b]){suits[c&3]++;ranks|=1<<(c>>2);}
  const flushDraw=cards.length<5 && suits.includes(4);
  let straightDraw=false;
  if(cards.length<5 && category<4)for(let hi=4;hi<=13;hi++){
    const window=hi===13?0x100f:31<<(hi-4);
    if(EM.POP13[ranks&window]===4){straightDraw=true;break;}
  }
  return ((category*5+Math.floor(Math.max(0,top)/3))*2+Number(flushDraw))*2+Number(straightDraw);
}
EM.wideGame=function({cfg,board,hands,tree,n,streetName,nodes,external,advance,nextStreet,icm,utilityMeta,ownAnte}){
  const anteOf=ownAnte||Array(n).fill(cfg.preflop?0.1:0);
  const seed=cfg.privateSeed??17, evaluationSeed=cfg.evaluationSeed??(seed^0xad90777d)>>>0;
  for(const value of [seed,evaluationSeed])
    if(!Number.isInteger(value)||value<0||value>4294967295)throw Error('Enter a whole sampling seed between 0 and 4294967295');
  const dealRandom=randomStream(seed),draw=dealer(hands,board,dealRandom), actionRandom=randomStream(seed^0x7138ab94);
  const holdout=cfg.evaluationDeals??4096;
  if(!Number.isInteger(holdout)||holdout<128||holdout>8192)throw Error('Evaluation deals must be between 128 and 8192');
  const abstraction=cfg.abstraction || 'detailed';
  if(!['compact','detailed','exact'].includes(abstraction))throw Error('Choose Compact, Detailed or Exact cards grouping');
  const budget=cfg.strategyBudgetMiB??112;
  if(!Number.isFinite(budget)||budget<1||budget>256)throw Error('Strategy budget must be between 1 and 256 MiB');
  // Linear MCCFR (Brown & Sandholm 2019): iteration t's regret and average-strategy
  // contributions are weighted by t, so early, poorly informed iterations fade out.
  // Studies saved by 2.3 continue with their original uniform weighting.
  const weighting=cfg.weighting??'linear';
  if(!['linear','uniform'].includes(weighting))throw Error('Choose linear or uniform iteration weighting');
  const batchDeals=cfg.batchDeals??1;
  if(!Number.isInteger(batchDeals)||batchDeals<1||batchDeals>64)throw Error('Batch deals must be an integer from 1 to 64');
  const regretMatching=cfg.regretMatching??'standard';
  if(!['standard','plus'].includes(regretMatching))throw Error('Unknown regret matching rule');
  // Freeze the strategy within each batch. Average unbiased chance-sampled
  // increments before applying regret matching (and optional CFR+ clipping).
  // Scratch arrays are budgeted alongside the persistent strategy arrays.
  const pending=new Set(), scratch=new WeakMap();
  function add(row,k,a,regret,average){
    if(!Number.isFinite(regret)||!Number.isFinite(average))throw Error('Non-finite sampled CFR increment');
    const i=row.offset+a;
    if(batchDeals===1){
      row.buffer[i]=regretMatching==='plus'?Math.max(0,row.buffer[i]+regret):row.buffer[i]+regret;
      row.buffer[i+k]+=average;return;
    }
    let block=scratch.get(row.buffer);
    if(!block){
      block={buffer:row.buffer,k,delta:new Float64Array(row.buffer.length),
        marked:new Uint8Array(256),indices:new Uint8Array(256),count:0};
      scratch.set(row.buffer,block);
    }
    const index=row.offset/(2*k);
    if(!block.marked[index]){
      block.marked[index]=1;block.indices[block.count++]=index;pending.add(block);
    }
    block.delta[i]+=regret/batchDeals;block.delta[i+k]+=average/batchDeals;
  }
  function finishBatch(commit){
    for(const b of pending){
      for(let j=0;j<b.count;j++){
        const row=b.indices[j],start=row*2*b.k;
        for(let a=0;a<2*b.k;a++){
          const i=start+a;
          if(commit){
            const value=b.buffer[i]+b.delta[i];
            if(!Number.isFinite(value))throw Error('Non-finite batch strategy value');
            b.buffer[i]=a<b.k && regretMatching==='plus'?Math.max(0,value):value;
          }
          b.delta[i]=0;
        }
        b.marked[row]=0;
      }
      b.count=0;
    }
    pending.clear();
  }
  let step=1;
  const updates=cfg.updates??'simultaneous';
  if(!['simultaneous','alternating','enumerate'].includes(updates))throw Error('Unknown update scheme');
  const profile=newStore(budget);
  let iterations=0, limitReached=false, stateVisits=0;
  const memoryError=new Error('Strategy memory budget reached');
  function newStore(limit){return {nodes:new Map(),pools:[],infos:0,bytes:0,limit:limit*1048576,gen:1};}
  function record(t,w,store,create){
    let node=store===profile && t.profileGen===profile.gen?t.profileNode:store.nodes.get(t.path);
    const key=w.keys[t.length][t.actor], k=t.actions.length;
    let index=node?.rows.get(key), pool=store.pools[k];
    if(index===undefined && create){
      if(!pool)pool={blocks:[],count:0};
      const allocate=pool.count%256===0;
      const extra=56+(typeof key==='string'?key.length*2:0)+(node?0:192+2*t.path.length)+(allocate?(256*16*k*(batchDeals>1?2:1)+(batchDeals>1?512:0)):0);
      if(store.bytes+extra>store.limit)throw memoryError;
      if(!node){node={rows:new Map(),k};store.nodes.set(t.path,node);}
      store.pools[k]=pool;
      if(allocate)pool.blocks.push(new Float64Array(256*2*k));
      index=pool.count++;node.rows.set(key,index);store.infos++;store.bytes+=extra;
    }
    if(index===undefined)return null;
    // A betting history occurs once in a traversal. Its scratch row pointer
    // stays valid while descendants use their own history entries.
    node.buffer=pool.blocks[Math.floor(index/256)];node.offset=index%256*2*k;
    if(store===profile){t.profileNode=node;t.profileGen=profile.gen;}
    return node;
  }
  function probabilities(t,w,store,average,create=false){
    const k=t.actions.length, sig=t.sig || (t.sig=new Float64Array(k));
    if(k===1){sig[0]=1;return sig;}
    const row=record(t,w,store,create), offset=average?k:0;
    let total=0;
    for(let a=0;a<k;a++){sig[a]=row?Math.max(0,row.buffer[row.offset+offset+a]):0;total+=sig[a];}
    if(!Number.isFinite(total))throw Error('Invalid strategy normalization');
    for(let a=0;a<k;a++)sig[a]=total?sig[a]/total:1/k;
    return sig;
  }
  const streetLengths=board.length===0?(cfg.preflop.mode==='shove'?[0,5]:[0,3,4,5]):[3,4,5].filter(k=>k>=board.length);
  function seatKey(p,h,publicCards,previous,score){
    if(abstraction==='exact')return EM.exactHandKey(h,publicCards);
    const length=publicCards.length;
    const signal=length===board.length && hands[p].length<=12?256+h.id:length===0?EM.CLS[h.id]:
      abstraction==='compact'?strengthGroup(h,publicCards,score):EM.handFeatures(h,publicCards,score).key;
    return abstraction==='compact'?previous*2048+signal:previous+'/'+signal;
  }
  // The starting public board and a seat's range are immutable within a game.
  // Cache only that street. Later-street keys retain the entire public history.
  const startingHands=hands.map(()=>new Map());
  function world(raw){
    const {seats,cards}=raw, keys={}, finalScores=[];
    let prev=seats.map(()=>0);
    for(const length of streetLengths){
      const publicCards=cards.slice(0,length);
      prev=seats.map((h,p)=>{
        if(length===board.length){
          let cached=startingHands[p].get(h.id);
          if(!cached){
            const score=length?EM.evalCards([...publicCards,h.a,h.b]):0;
            cached={score,key:seatKey(p,h,publicCards,0,score)};startingHands[p].set(h.id,cached);
          }
          if(length===5)finalScores[p]=cached.score;
          return cached.key;
        }
        const score=length===0?0:EM.evalCards([...publicCards,h.a,h.b]);
        if(length===5)finalScores[p]=score;
        return seatKey(p,h,publicCards,prev[p],score);
      });
      keys[length]=prev;
    }
    let order=0;
    if(cacheRiverPayoffs)for(let p=0;p<n;p++)for(let q=0;q<p;q++)
      order=order*3+1+Math.sign(finalScores[p]-finalScores[q]);
    return {seats,cards,keys,finalScores,order};
  }
  // The trained average strategy of one seat's information set, as the solver
  // itself would look it up. Used to evaluate sampled training independently in
  // the exact enumerated game. Returns null for information sets never visited.
  function averageAt(path,publicCards,p,h){
    let key=0;
    for(const length of streetLengths){
      if(length>publicCards.length)break;
      const cards=publicCards.slice(0,length);
      key=seatKey(p,h,cards,key,length===0?0:EM.evalCards([...cards,h.a,h.b]));
    }
    const node=profile.nodes.get(path),index=node?.rows.get(key);
    if(index===undefined)return null;
    const k=node.k,pool=profile.pools[k],buffer=pool.blocks[Math.floor(index/256)],offset=index%256*2*k+k;
    const out=new Float64Array(k);let total=0;
    for(let a=0;a<k;a++){out[a]=Math.max(0,buffer[offset+a]);total+=out[a];}
    for(let a=0;a<k;a++)out[a]=total?out[a]/total:1/k;
    return out;
  }
  const cacheRiverPayoffs=!external && !icm && board.length===5 && n<=4;
  let cachedPayoffs=0;
  function payoff(t,w){
    if(cacheRiverPayoffs){const hit=t.payByOrder?.get(w.order);if(hit)return hit;}
    if(icm)return icm.evaluate(EM.awardPots(t.pots,w.finalScores,t.behind));
    const u=t.u || (t.u=new Float64Array(n));
    for(let p=0;p<n;p++)u[p]=-t.total[p]-anteOf[p];
    for(const pot of t.pots){
      let top=-Infinity,count=0;
      for(const p of pot.eligible){
        const value=w.finalScores[p];
        if(value>top){top=value;count=1;}else if(value===top)count++;
      }
      for(const p of pot.eligible)if(w.finalScores[p]===top)u[p]+=pot.amount/count;
    }
    if(cacheRiverPayoffs && cachedPayoffs<8192){
      if(!t.payByOrder)t.payByOrder=new Map();
      t.payByOrder.set(w.order,u.slice());cachedPayoffs++;
    }
    return u;
  }
  function choose(sig,rng){
    const value=rng();let cumulative=0;
    for(let a=0;a<sig.length;a++){cumulative+=sig[a];if(value<cumulative)return a;}
    return sig.length-1;
  }
  // A full chance-sampled update remains the reference on compact trees.
  // train: false (evaluate the average), true (update every seat), or an
  // object {seat, weight} that updates one seat with a chance weight.
  function walk(t,w,reach,train){
    if(train)stateVisits++;
    if(t.kind==='terminal')return payoff(t,w);
    if(t.kind==='chance')return walk(nextStreet(t),w,reach,train);
    const k=t.actions.length;
    if(k===1)return walk(advance(t,0),w,reach,train);
    const p=t.actor, sig=probabilities(t,w,profile,!train,Boolean(train)), old=reach[p];
    const u=t.u || (t.u=new Float64Array(n));u.fill(0);
    const actionValues=t.actionValues || (t.actionValues=new Float64Array(k));
    for(let a=0;a<k;a++){
      reach[p]=old*sig[a];
      const v=walk(advance(t,a),w,reach,train);
      actionValues[a]=v[p];
      for(let j=0;j<n;j++)u[j]+=sig[a]*v[j];
    }
    reach[p]=old;
    if(train===true || (train && train.seat===p)){
      const row=record(t,w,profile,false), cw=train===true?1:train.weight;
      let others=1;for(let j=0;j<n;j++)if(j!==p)others*=reach[j];
      for(let a=0;a<k;a++){
        add(row,k,a,step*cw*others*(actionValues[a]-u[p]),step*cw*old*sig[a]);
      }
    }
    return u;
  }
  // Enumerate the updating player's actions and sample other players with
  // positive exploration. Ratios correct both counterfactual regret and the
  // own-reach average for ALL sampled opponents, including multiplayer games.
  function learn(t,w,player,own,opponentReach,sampleReach,store,rng,fixed=false){
    if(!fixed)stateVisits++;
    if(t.kind==='terminal')return payoff(t,w)[player];
    if(t.kind==='chance')return learn(nextStreet(t),w,player,own,opponentReach,sampleReach,store,rng,fixed);
    const k=t.actions.length;
    if(k===1)return learn(advance(t,0),w,player,own,opponentReach,sampleReach,store,rng,fixed);
    if(t.actor!==player){
      const sig=probabilities(t,w,fixed?profile:store,fixed);
      const sampling=t.sampling||(t.sampling=new Float64Array(k));
      for(let b=0;b<k;b++)sampling[b]=0.9*sig[b]+0.1/k;
      const a=choose(sampling,rng);
      return sig[a]/sampling[a]*learn(advance(t,a),w,player,own,opponentReach*sig[a],
        sampleReach*sampling[a],store,rng,fixed);
    }
    const sig=probabilities(t,w,store,false,true), row=record(t,w,store,false);
    const values=t.values||(t.values=new Float64Array(k));let mean=0;
    for(let a=0;a<k;a++){
      if(fixed)row.buffer[row.offset+k+a]+=step*own*sig[a]/sampleReach;
      else add(row,k,a,0,step*own*sig[a]/sampleReach);
      values[a]=learn(advance(t,a),w,player,own*sig[a],opponentReach,sampleReach,store,rng,fixed);
      mean+=sig[a]*values[a];
    }
    for(let a=0;a<k;a++){
      const delta=step*opponentReach/sampleReach*(values[a]-mean);
      if(fixed)row.buffer[row.offset+a]+=delta;else add(row,k,a,delta,0);
    }
    return mean;
  }
  // A trained response plays greedily: the action with the largest cumulative
  // regret, which with fixed opponents is the action with the largest estimated
  // value. (The response's average strategy still contains its early uniform
  // play and understates how much the seat can gain.)
  function greedy(t,w,store){
    const k=t.actions.length, sig=t.sig || (t.sig=new Float64Array(k));
    sig.fill(0);
    const row=record(t,w,store,false);
    if(!row){sig.fill(1/k);return sig;}
    let best=0;for(let a=1;a<k;a++)if(row.buffer[row.offset+a]>row.buffer[row.offset+best])best=a;
    sig[best]=1;return sig;
  }
  // Expected value for response.seat (or the seat the probe measures when
  // response is null) with every action enumerated.
  function expectation(t,w,response,seat=response?response.seat:probeSeat){
    if(t.kind==='terminal')return payoff(t,w)[seat];
    if(t.kind==='chance')return expectation(nextStreet(t),w,response,seat);
    const k=t.actions.length;
    if(k===1)return expectation(advance(t,0),w,response,seat);
    const sig=Float64Array.from(response && response.seat===t.actor?greedy(t,w,response.store):probabilities(t,w,profile,true));
    let v=0;for(let a=0;a<k;a++)if(sig[a]>0)v+=sig[a]*expectation(advance(t,a),w,response,seat);
    return v;
  }
  let probeSeat=0;
  // Best-response training on full-traversal trees: opponents' average actions
  // are enumerated rather than sampled, and the responding seat accumulates
  // action values for a greedy (pure) response.
  function respondFull(t,w,seat,weight,store){
    if(t.kind==='terminal')return payoff(t,w)[seat];
    if(t.kind==='chance')return respondFull(nextStreet(t),w,seat,weight,store);
    const k=t.actions.length;
    if(k===1)return respondFull(advance(t,0),w,seat,weight,store);
    if(t.actor!==seat){
      const sig=Float64Array.from(probabilities(t,w,profile,true));let v=0;
      for(let a=0;a<k;a++)if(sig[a]>0)v+=sig[a]*respondFull(advance(t,a),w,seat,weight*sig[a],store);
      return v;
    }
    record(t,w,store,true);
    const values=new Float64Array(k);
    for(let a=0;a<k;a++)values[a]=respondFull(advance(t,a),w,seat,weight,store);
    const row=record(t,w,store,false);
    let best=0;for(let a=0;a<k;a++){row.buffer[row.offset+a]+=weight*values[a];if(row.buffer[row.offset+a]>row.buffer[row.offset+best])best=a;}
    return values[best];
  }
  function rollout(t,w,rng,response=null){
    while(t.kind!=='terminal'){
      if(t.kind==='chance'){t=nextStreet(t);continue;}
      const mine=response && response.seat===t.actor;
      const sig=mine?(t.actions.length===1?probabilities(t,w,profile,true):greedy(t,w,response.store)):probabilities(t,w,profile,true);
      t=advance(t,choose(sig,rng));
    }
    return payoff(t,w);
  }
  const reach=new Float64Array(n).fill(1);
  // Own-hand enumeration (self chance enumeration): for each updating seat the
  // other seats' private cards and the board come from one sampled deal, and
  // every compatible hand of the updating seat is traversed with its exact
  // conditional probability. This is unbiased and removes the variance from
  // sampling the updating seat's own cards.
  let trainingDeals=0;
  function trainingWorld(){const raw=draw();trainingDeals++;return world(raw);}
  // One independent sample per equal-probability stratum of the joint range.
  // With a frozen full-traversal policy their mean has the correct expectation.
  // Enumeration is bounded before any joint table is allocated.
  const stratify=cfg.riverStrata===true && board.length===5 && batchDeals>1 &&
    !external && updates==='simultaneous' && hands.reduce((a,r)=>a*r.length,1)<=1024;
  const joint=[],cumulative=[];let jointMass=0;
  if(stratify){
    const used=new Set(board),seats=[];
    function enumerate(seat,mass){
      if(seat===n){
        jointMass+=mass;joint.push(seats.slice());cumulative.push(jointMass);return;
      }
      for(const h of hands[seat]){
        if(used.has(h.a)||used.has(h.b))continue;
        used.add(h.a);used.add(h.b);seats.push(h);
        enumerate(seat+1,mass*h.w);
        seats.pop();used.delete(h.a);used.delete(h.b);
      }
    }
    enumerate(0,1);
    if(!(jointMass>0)||!Number.isFinite(jointMass))throw Error('Invalid joint range mass');
  }
  function stratumWorld(index){
    const x=(index+dealRandom())*jointMass/batchDeals;
    let lo=0,hi=joint.length-1;
    while(lo<hi){const mid=(lo+hi)>>>1;if(x<cumulative[mid])hi=mid;else lo=mid+1;}
    trainingDeals++;return world({seats:joint[lo],cards:board});
  }
  function enumerateOwn(w0){
    for(let p=0;p<n;p++){
      const w=p?trainingWorld():w0, used=new Uint8Array(52);
      for(const c of w.cards)used[c]=1;
      w.seats.forEach((h,j)=>{if(j!==p)used[h.a]=used[h.b]=1;});
      const options=hands[p].filter(h=>!used[h.a]&&!used[h.b]);
      let total=0;for(const h of options)total+=h.w;
      for(const h of options){
        const seats=w.seats.slice();seats[p]=h;
        walk(tree,world({seats,cards:w.cards}),reach,{seat:p,weight:h.w/total});
      }
    }
  }
  function iterate(count=1){
    if(!Number.isSafeInteger(count)||count<0||count>10000000||iterations+count>10000000)throw Error('Iteration count must fit the 10 million iteration limit');
    for(let i=0;i<count && !limitReached;i++){
      try{
        step=weighting==='linear'?iterations+1:1;
        for(let batch=0;batch<batchDeals;batch++){
        const w=stratify?stratumWorld(batch):trainingWorld();
        if(external)for(let p=0;p<n;p++)learn(tree,w,p,1,1,1,profile,actionRandom);
        else if(updates==='enumerate')enumerateOwn(w);
        else if(updates==='alternating')for(let p=0;p<n;p++)walk(tree,p?trainingWorld():w,reach,{seat:p,weight:1});
        else walk(tree,w,reach,true);
        }
        if(batchDeals>1)finishBatch(true);
        iterations++;
      }catch(e){
        finishBatch(false);
        if(e!==memoryError)throw e;
        reach.fill(1);limitReached=true;
      }
    }
  }
  function metrics(samples=holdout){
    if(!Number.isInteger(samples)||samples<128||samples>8192)throw Error('Invalid evaluation sample count');
    const evalDraw=dealer(hands,board,randomStream(evaluationSeed)), rng=randomStream(evaluationSeed^0x543e981a);
    const ev=Array(n).fill(0),m2=Array(n).fill(0);
    for(let i=1;i<=samples;i++){
      const w=world(evalDraw()),v=external?rollout(tree,w,rng):walk(tree,w,reach,false);
      for(let p=0;p<n;p++){const d=v[p]-ev[p];ev[p]+=d/i;m2[p]+=d*(v[p]-ev[p]);}
    }
    return {...utilityMeta,wide:true,ev,se:m2.map(x=>Math.sqrt(Math.max(0,x)/(samples-1)/samples)),iterations,
      abstraction,weighting,batchDeals,regretMatching,trainingDeals,dealSampler:stratify?'stratified joint river':'independent rejection',memoryBudgetMiB:profile.limit/1048576,strategyMiB:profile.bytes/1048576,evaluationDeals:samples,infos:profile.infos,
      nodes:external?profile.nodes.size:nodes,seed,evaluationSeed,startStreet:streetName(board.length),
      runoutMode:'fresh',deals:iterations,algorithm:external?'external':'full',stateVisits,limitReached};
  }
  function rootFrequencies(){
    if(tree.kind!=='player')return [];
    const sample=dealer(hands,board,randomStream(evaluationSeed)),counts=new Float64Array(tree.actions.length);
    for(let i=0;i<256;i++){
      const sig=probabilities(tree,world(sample()),profile,true);
      for(let a=0;a<counts.length;a++)counts[a]+=sig[a];
    }
    return tree.actions.map((action,a)=>({label:action.label,frequency:counts[a]/256}));
  }
  function view(path=[]){
    const visible=board.slice(),line=[],history=[];let t=tree;
    for(const step of path){
      if(t.kind==='chance'){
        const cards=t.length===0?step?.cards:[step?.card];
        if(!Array.isArray(cards)||cards.length!==(t.length===0?3:1)||new Set(cards).size!==cards.length||cards.some(c=>!Number.isInteger(c)||c<0||c>51||visible.includes(c)))throw Error('Choose three different flop cards or one legal next card');
        visible.push(...cards);line.push({kind:'card',cards,label:streetName(visible.length)+' '+cards.map(EM.cardStr).join(' ')});t=nextStreet(t);
      }else{
        if(t.kind!=='player'||!Number.isInteger(step)||step<0||step>=t.actions.length)throw Error('Invalid action path');
        line.push({kind:'action',seat:t.actor,label:t.actions[step].label});history.push([t,step]);t=advance(t,step);
      }
    }
    const sample=dealer(hands,visible,randomStream(evaluationSeed)),rng=randomStream(evaluationSeed^0x75c1a982);
    const combos=new Map(),cards=new Float64Array(52),tot=Array(n).fill(0);
    const k=t.actions?.length||0, freq=new Float64Array(k),values=new Float64Array(k);
    let mass=0,mass2=0;
    for(let i=0;i<holdout;i++){
      const w=world(sample());let wt=1;
      for(const [prev,a] of history)wt*=probabilities(prev,w,profile,true)[a];
      if(!wt)continue;mass+=wt;mass2+=wt*wt;
      if(t.kind==='chance'){
        const excluded=new Set([...visible,...w.seats.flatMap(h=>[h.a,h.b])]);
        for(let c=0;c<52;c++)if(!excluded.has(c))cards[c]+=wt/(52-excluded.size);
      }else if(t.kind==='terminal'){
        const v=payoff(t,w);for(let p=0;p<n;p++)tot[p]+=wt*v[p];
      }else{
        const p=t.actor,h=w.seats[p],sig=probabilities(t,w,profile,true);
        let r=combos.get(h.id);
        if(!r){r={cards:EM.comboStr(h.id),mass:0,sumSquares:0,mix:Array(k).fill(0),ev:Array(k).fill(0)};combos.set(h.id,r);}
        r.mass+=wt;r.sumSquares+=wt*wt;
        for(let a=0;a<k;a++){
          const child=advance(t,a);
          const v=(external?rollout(child,w,rng):walk(child,w,reach,false))[p]+(icm?0:t.total[p]+anteOf[p]);
          r.ev[a]+=wt*v;r.mix[a]+=wt*sig[a];freq[a]+=wt*sig[a];values[a]+=wt*v;
        }
      }
    }
    const out={...utilityMeta,kind:t.kind,seat:t.actor,line,board:visible,street:streetName(visible.length),pot:t.pot,behind:t.behind,live:t.live,
      prob:mass/holdout,effectiveSamples:mass2?mass*mass/mass2:0};
    if(t.kind==='terminal'){out.pots=t.pots;out.ev=tot.map(x=>mass?x/mass:null);out.runoutAveraged=visible.length<5&&t.pots.some(l=>l.eligible.length>1);}
    else if(t.kind==='chance'){
      out.nextStreet=streetName(visible.length===0?3:visible.length+1);
      out.flopInput=visible.length===0;
      out.cards=Array.from(cards,(x,c)=>({card:c,label:EM.cardStr(c),prob:mass?x/mass:null})).filter(x=>x.prob>0);
    }else{
      out.actions=t.actions.map((a,i)=>({label:a.label,frequency:mass?freq[i]/mass:null,ev:mass?values[i]/mass:null}));
      out.hands=[...combos.values()].sort((a,b)=>b.mass-a.mass).map(r=>({...r,effectiveSamples:r.mass*r.mass/r.sumSquares,mix:r.mix.map(v=>v/r.mass),ev:r.ev.map(v=>v/r.mass)}));
    }
    return out;
  }
  function responseProbe(seat){
    if(!Number.isInteger(seat)||seat<0||seat>=n)throw Error('Invalid response seat');
    const store=newStore(32), trainSeed=(seed^0x94731adf^Math.imul(seat+1,7919))>>>0;
    const responseDraw=dealer(hands,board,randomStream(trainSeed)),rng=randomStream(trainSeed^0x4129cab7);
    let done=0,limited=false;
    return {
      get iterations(){return done;},get limitReached(){return limited;},
      iterate(count=1){
        for(let i=0;i<count && !limited;i++){
          try{step=1;const w=world(responseDraw());if(external)learn(tree,w,seat,1,1,1,store,rng,true);else respondFull(tree,w,seat,1,store);done++;}
          catch(e){if(e!==memoryError)throw e;limited=true;}
        }
      },
      finish(){
        probeSeat=seat;
        const sample=dealer(hands,board,randomStream(evaluationSeed^0xe72cd498));
        let mean=0,m2=0;
        for(let i=1;i<=holdout;i++){
          const w=world(sample()),pairedSeed=(evaluationSeed^Math.imul(i,16777619))>>>0;
          // Small (full-traversal) trees: exact expectation over every action;
          // large trees: paired rollouts.
          const base=external?rollout(tree,w,randomStream(pairedSeed))[seat]:expectation(tree,w,null);
          const response=external?rollout(tree,w,randomStream(pairedSeed),{seat,store})[seat]:expectation(tree,w,{seat,store});
          const delta=response-base-mean;mean+=delta/i;m2+=delta*(response-base-mean);
        }
        return {seat,gain:mean,se:Math.sqrt(Math.max(0,m2)/(holdout-1)/holdout),
          trainingDeals:done,evaluationDeals:holdout,limitReached:limited};
      }
    };
  }
  function snapshot(labels){
    const pools=[];
    for(let k=2;k<profile.pools.length;k++){
      const pool=profile.pools[k];if(!pool)continue;
      pools.push({k,count:pool.count,blocks:pool.blocks.map((block,i)=>EM.packTrainingValues(block.subarray(0,Math.min(256,pool.count-i*256)*2*k)))});
    }
    const records=[...profile.nodes].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,node])=>({path,k:node.k,rows:[...node.rows]}));
    return EM.checkpointPayload({...cfg,abstraction,weighting,batchDeals,regretMatching,strategyBudgetMiB:profile.limit/1048576},{kind:'wide',external,iterations,stateVisits,trainingDeals,limitReached,
      dealState:dealRandom.state(),actionState:actionRandom.state(),pools,records},labels);
  }
  function restoreState(state){
    const bad=EM.checkpointFail;
    if(iterations||profile.infos||state.kind!=='wide'||state.external!==external||typeof state.limitReached!=='boolean')bad();
    EM.checkpointInteger(state.iterations);EM.checkpointInteger(state.stateVisits,Number.MAX_SAFE_INTEGER);
    EM.checkpointInteger(state.dealState,4294967295);EM.checkpointInteger(state.actionState,4294967295);
    if(!Array.isArray(state.pools)||state.pools.length>6||!Array.isArray(state.records))bad();
    const pools=[],seen=[];let bytes=0,infos=0;
    for(const row of state.pools){
      if(!Number.isInteger(row.k)||row.k<2||row.k>7||pools[row.k])bad();
      EM.checkpointInteger(row.count,3000000);if(!row.count||!Array.isArray(row.blocks)||row.blocks.length!==Math.ceil(row.count/256))bad();
      bytes+=row.blocks.length*(256*16*row.k*(batchDeals>1?2:1)+(batchDeals>1?512:0));if(bytes>profile.limit)bad();
      pools[row.k]={count:row.count,encoded:row.blocks};seen[row.k]=new Uint8Array(row.count);
    }
    if(state.records.length>bytes/16+1)bad();
    const records=state.records.slice().sort((a,b)=>String(a.path)<String(b.path)?-1:1),nodes=new Map();
    let previous='r',chain=[tree];
    for(const row of records){
      if(typeof row.path!=='string'||row.path.length>512||!/^r[0-6c]*$/.test(row.path)||nodes.has(row.path)||!pools[row.k]||!Array.isArray(row.rows)||!row.rows.length)bad();
      let shared=0;while(shared<Math.min(previous.length,row.path.length)&&previous[shared]===row.path[shared])shared++;
      chain.length=shared;
      for(let i=shared;i<row.path.length;i++){
        const parent=chain[i-1],c=row.path[i];
        if(c==='c'){if(parent.kind!=='chance')bad();chain.push(nextStreet(parent));}
        else {const a=Number(c);if(parent.kind!=='player'||a>=parent.actions.length)bad();chain.push(advance(parent,a));}
      }
      previous=row.path;const node=chain[chain.length-1];if(node.kind!=='player'||node.actions.length!==row.k)bad();
      const restored={k:row.k,rows:new Map()};bytes+=192+2*row.path.length;
      for(const entry of row.rows){
        if(!Array.isArray(entry)||entry.length!==2)bad();const [key,index]=entry;
        if(typeof key==='string'){if(!key.length||key.length>1024||!/^[a-zA-Z0-9:.,/]+$/.test(key))bad();}
        else if(!Number.isSafeInteger(key)||key<0)bad();
        if((abstraction==='compact')!==(typeof key==='number')||restored.rows.has(key)||!Number.isInteger(index)||index<0||index>=pools[row.k].count||seen[row.k][index])bad();
        restored.rows.set(key,index);seen[row.k][index]=1;infos++;bytes+=56+(typeof key==='string'?2*key.length:0);
      }
      if(bytes>profile.limit)bad();nodes.set(row.path,restored);
      if(!external){node.profileNode=restored;node.profileGen=profile.gen+1;}
    }
    for(let k=2;k<pools.length;k++)if(pools[k]){
      const pool=pools[k];if(seen[k].some(x=>!x))bad();
      pool.blocks=pool.encoded.map((text,i)=>{
        const count=Math.min(256,pool.count-i*256),values=EM.unpackTrainingValues(text,count*2*k),block=new Float64Array(256*2*k);
        for(let j=0;j<values.length;j++)if(j%(2*k)>=k && values[j]<0)bad();block.set(values);return block;
      });delete pool.encoded;
    }
    profile.nodes=nodes;profile.pools=pools;profile.bytes=bytes;profile.infos=infos;profile.gen++;
    trainingDeals=state.trainingDeals??state.iterations*batchDeals*(!external&&updates!=='simultaneous'?n:1);
    EM.checkpointInteger(trainingDeals,Number.MAX_SAFE_INTEGER);
    iterations=state.iterations;stateVisits=state.stateVisits;limitReached=state.limitReached;
    dealRandom.restore(state.dealState);actionRandom.restore(state.actionState);
  }
  function increaseBudget(mib){
    if(!Number.isFinite(mib)||mib<profile.limit/1048576||mib>256)throw Error('Resume memory budget must be at least the current budget and at most 256 MiB');
    if(mib>profile.limit/1048576){profile.limit=mib*1048576;limitReached=false;}
  }
  return {rootFrequencies,get trainingDeals(){return trainingDeals;},get strategyMiB(){return profile.bytes/1048576;},iterate,metrics,view,responseProbe,snapshot,restoreState,increaseBudget,averageAt,get iterations(){return iterations;},get limitReached(){return limitReached;}};
};
})(globalThis.EM || (globalThis.EM = {}));
