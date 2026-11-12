(function(EM){
'use strict';
// Keep legacy base64 conversion bounded to a single binary result plus a block.
function legacyNativeBytes(text){
  if(/[\t\n\f\r ]/.test(text))text=text.replace(/[\t\n\f\r ]/g,'');
  if(typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(text);
  const pad=text.endsWith('==')?2:text.endsWith('=')?1:0,chars=text.length-pad;
  if(chars%4===1 || (pad&&text.length%4!==0) || (text.indexOf('=')>=0&&text.indexOf('=')!==chars))EM.checkpointFail();
  const out=new Uint8Array(Math.floor(chars*3/4));let offset=0;
  for(let i=0;i<text.length;i+=65536){
    const part=atob(text.slice(i,i+65536));
    for(let j=0;j<part.length;j++)out[offset++]=part.charCodeAt(j);
  }
  if(offset!==out.length)EM.checkpointFail();
  return out;
}
function randomStream(seed) {
  let state=seed>>>0;
  const next=()=>{state=(state+0x6d2b79f5)>>>0;let x=Math.imul(state^(state>>>15),state|1);
    x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};
  next.state=()=>state;next.restore=value=>{state=EM.checkpointInteger(value,4294967295);};return next;
}
// 3.3: discounted CFR (Brown & Sandholm 2019) for external sampling.
// After iteration u, DCFR multiplies positive cumulative regrets by
// u^alpha/(u^alpha+1), negative ones by u^beta/(u^beta+1), and the average
// strategy by (u/(u+1))^gamma. Sampled training touches a small part of the
// table per iteration, so each row stores the iteration count through which its
// regrets are discounted ("sync") and catches up when it is next updated:
//   R <- R * prod_{u=sync+1..t} f_u      (positive and negative separately).
// Regret matching only uses the positive part, which a common factor does not
// change, so reading a row that has not caught up yields the same policy as
// eager discounting. The products are prefix tables P_t = prod f_u held as a
// mantissa in [0.5,1) and a binary exponent; the ratio P_t/P_s is one division
// and an exact power of two, so beta = 0 (factor 1/2 per iteration) cannot
// underflow the table. The average discount telescopes: prod (u/(u+1))^gamma
// over u = s..T-1 equals (s/T)^gamma, so weighting iteration t's average
// contribution by t^gamma is the same normalized average strategy. The native
// engine (mw_es_impl.hpp) uses the identical operations; with the default
// alpha 1.5, beta 0 and gamma 2 only correctly rounded IEEE operations are used
// (no pow), so both produce bit-identical tables.
const TWO_NEG=(()=>{const t=new Float64Array(1001);t[0]=1;for(let i=1;i<=1000;i++)t[i]=t[i-1]*0.5;return t;})();
function powExact(u,x){
  if(x===0)return 1;if(x===1)return u;if(x===2)return u*u;if(x===3)return u*u*u;
  if(x===0.5)return Math.sqrt(u);if(x===1.5)return u*Math.sqrt(u);return Math.pow(u,x);
}
function dcfrSchedule(alpha,beta,gamma){
  for(const [name,v] of [['alpha',alpha],['beta',beta],['gamma',gamma]])
    if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>16)throw Error('DCFR '+name+' must be a finite number from -16 to 16');
  if(alpha<0||gamma<0)throw Error('DCFR alpha and gamma must be nonnegative');
  const tables=[alpha,beta].map(x=>({x,m:[1],e:[0]}));
  function extend(t){
    for(const tb of tables)while(tb.m.length<=t){
      const u=tb.m.length,pu=powExact(u,tb.x);let m=tb.m[u-1]*(pu/(pu+1)),e=tb.e[u-1];
      if(m>0){while(m<0.5){m*=2;e--;}while(m>=1){m*=0.5;e++;}}
      tb.m.push(m);tb.e.push(e);
    }
  }
  function ratio(tb,s,t){
    const d=tb.e[s]-tb.e[t];
    if(!(tb.m[t]>0)||d>1075)return 0;
    if(d>1000)return (tb.m[t]/tb.m[s]*TWO_NEG[1000])*TWO_NEG[d-1000];
    return tb.m[t]/tb.m[s]*TWO_NEG[d];
  }
  return {alpha,beta,gamma,
    // Factors that bring regrets discounted through iteration s to iteration t.
    factors(s,t){extend(t);return [ratio(tables[0],s,t),ratio(tables[1],s,t)];},
    averageWeight:t=>powExact(t,gamma),
    bytes:()=>tables[0].m.length*32};
}
EM.dcfrSchedule=dcfrSchedule;
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
EM.wideGame=function({cfg,board,hands,tree,n,streetName,nodes,external,advance,nextStreet,icm,utilityMeta,ownAnte,rules}){
  const anteOf=ownAnte||Array(n).fill(cfg.preflop?0.1:0);
  // 3.3: the per-seat antes reach terminal utilities and the native spec; refuse
  // malformed lists, negative, non-finite or implausible amounts (EM.anteModel caps antes at 10 bb).
  if(!Array.isArray(anteOf)||anteOf.length!==n||anteOf.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>10))
    throw Error('Each seat needs a finite ante from 0 to 10 bb');
  const seed=cfg.privateSeed??17, evaluationSeed=cfg.evaluationSeed??(seed^0xad90777d)>>>0;
  for(const value of [seed,evaluationSeed])
    if(!Number.isInteger(value)||value<0||value>4294967295)throw Error('Enter a whole sampling seed between 0 and 4294967295');
  const dealRandom=randomStream(seed),draw=dealer(hands,board,dealRandom), actionRandom=randomStream(seed^0x7138ab94);
  // Sampled-betting action streams. 'shared' (default) draws every opponent
  // action from one study stream. 'deal' gives each (iteration, deal) its own
  // stream derived from the seed, so the deals of a frozen batch are
  // independent and the native engine can traverse them in parallel. Both are
  // reproduced bit for bit by the native engine.
  const actionStreams=cfg.actionStreams??'shared', actionSeed=(seed^0x7138ab94)>>>0;
  if(!['shared','deal'].includes(actionStreams))throw Error('Choose shared or per-deal action streams');
  const dealStream=(it,d)=>randomStream((actionSeed^Math.imul(it+1,0x9e3779b1)^Math.imul(d+1,0x85ebca6b))>>>0);
  const holdout=cfg.evaluationDeals??4096;
  if(!Number.isInteger(holdout)||holdout<128||holdout>8192)throw Error('Evaluation deals must be between 128 and 8192');
  if(cfg.terminalBaseline!==undefined && typeof cfg.terminalBaseline!=='boolean')throw Error('Invalid terminal baseline setting');
  if(cfg.terminalExpectation!==undefined && typeof cfg.terminalExpectation!=='boolean')throw Error('Invalid terminal expectation setting');
  // 4.5 experimental trainer options, implemented by the native engine only (the JavaScript trainer refuses them).
  if(cfg.chanceSampling!==undefined && !['independent','latin'].includes(cfg.chanceSampling))throw Error('Choose independent or latin chance sampling');
  if(cfg.opponentExploration!==undefined && !(typeof cfg.opponentExploration==='number' && cfg.opponentExploration>=0 && cfg.opponentExploration<=0.5))throw Error('Opponent exploration must be 0 to 0.5');
  const nativeOnly=cfg.chanceSampling==='latin' || (cfg.opponentExploration!==undefined && cfg.opponentExploration!==0.1);
  if(nativeOnly && cfg.traversal!=='external')throw Error('Latin chance sampling and opponent exploration require external sampling');
  const abstraction=cfg.abstraction || 'detailed';
  if(!['compact','detailed','exact'].includes(abstraction))throw Error('Choose Compact, Detailed or Exact cards grouping');
  const budget=cfg.strategyBudgetMiB??112;
  // Native training keeps its own tables; the JavaScript mirror that receives
  // them may follow the larger native budget (3.1).
  const budgetCap=cfg.engine==='native'?2048:256;
  if(!Number.isFinite(budget)||budget<1||budget>budgetCap)throw Error('Strategy budget must be between 1 and '+budgetCap+' MiB');
  // Linear MCCFR (Brown & Sandholm 2019): iteration t's regret and average-strategy
  // contributions are weighted by t, so early, poorly informed iterations fade out.
  // Studies saved by 2.3 continue with their original uniform weighting.
  const weighting=cfg.weighting??'linear';
  if(!['linear','uniform','dcfr'].includes(weighting))throw Error('Choose linear, uniform or DCFR iteration weighting');
  // 3.3: DCFR is implemented for external sampling, where every row keeps its own discount schedule.
  if(weighting==='dcfr' && !external)throw Error('DCFR weighting requires external-sampling traversal');
  const dcfr=weighting==='dcfr'?dcfrSchedule(cfg.dcfrAlpha??1.5,cfg.dcfrBeta??0,cfg.dcfrGamma??2):null;
  // Per-row discount iteration (block buffer -> Uint32Array of 256 rows).
  const syncOf=new WeakMap();
  function catchUp(buffer,offset,k){
    const sync=syncOf.get(buffer),index=offset/(2*k);
    if(sync[index]===iterations)return;
    const [pos,neg]=dcfr.factors(sync[index],iterations);
    for(let a=0;a<k;a++){const v=buffer[offset+a];buffer[offset+a]=v>0?v*pos:v<0?v*neg:v;}
    sync[index]=iterations;
  }
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
      if(journal){
        let offsets=journal.saved.get(row.buffer);
        if(!offsets){offsets=new Map();journal.saved.set(row.buffer,offsets);}
        if(!offsets.has(row.offset)){
          offsets.set(row.offset,row.buffer.slice(row.offset,row.offset+2*k));
          if(dcfr)(journal.syncs||(journal.syncs=[])).push([row.buffer,row.offset/(2*k),syncOf.get(row.buffer)[row.offset/(2*k)]]);
        }
      }
      if(dcfr)catchUp(row.buffer,row.offset,k);
      if(!Number.isFinite(row.buffer[i]+regret)||!Number.isFinite(row.buffer[i+k]+average))throw Error('Non-finite sampled strategy value');
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
    // 3.3: check every committed value first. 3.2 could apply part of a batch
    // before a non-finite value threw, and that partial batch then survived the rollback.
    if(commit)for(const b of pending)for(let j=0;j<b.count;j++){
      const row=b.indices[j],start=row*2*b.k;
      let pos=1,neg=1;
      if(dcfr){const sync=syncOf.get(b.buffer);[pos,neg]=dcfr.factors(sync[row],iterations);}
      for(let a=0;a<2*b.k;a++){
        let v=b.buffer[start+a];if(dcfr&&a<b.k)v=v>0?v*pos:v<0?v*neg:v;
        if(!Number.isFinite(v+b.delta[start+a])){finishBatch(false);throw Error('Non-finite batch strategy value');}
      }
    }
    for(const b of pending){
      for(let j=0;j<b.count;j++){
        const row=b.indices[j],start=row*2*b.k;
        if(commit&&dcfr)catchUp(b.buffer,start,b.k);
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
  let step=1,averageStep=1;
  const updates=cfg.updates??'simultaneous';
  if(!['simultaneous','alternating','enumerate'].includes(updates))throw Error('Unknown update scheme');
  let profile=newStore(budget),journal=null;
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
      const extra=56+(typeof key==='string'?key.length*2:0)+(node?0:192+2*t.path.length)+(allocate?(256*16*k*(batchDeals>1?2:1)+(batchDeals>1?512:0)+(dcfr?1024:0)):0);
      if(store.bytes+extra>store.limit)throw memoryError;
      if(journal && store===profile)journal.insertions.push({path:t.path,key,k,newNode:!node,allocate,extra});
      if(!node){node={rows:new Map(),k};store.nodes.set(t.path,node);}
      store.pools[k]=pool;
      if(allocate){pool.blocks.push(new Float64Array(256*2*k));if(dcfr)syncOf.set(pool.blocks[pool.blocks.length-1],new Uint32Array(256));}
      index=pool.count++;
      // A new DCFR row has nothing to discount yet.
      if(dcfr && store===profile)syncOf.get(pool.blocks[Math.floor(index/256)])[index%256]=iterations;node.rows.set(key,index);store.infos++;store.bytes+=extra;
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
  // A fixed turn and physical hole cards determine the entire river feature history.
  const riverKeys=board.length===4 && abstraction!=='exact' &&
    52*hands.reduce((sum,r)=>sum+r.length,0)<=Math.min(2048,budget*32)
    ? hands.map(()=>new Map()) : null;
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
        if(riverKeys && length===5){
          const id=h.id*52+publicCards[4],cache=riverKeys[p];let entry=cache.get(id);
          if(!entry){
            const score=EM.evalCards([...publicCards,h.a,h.b]);
            entry={score,key:seatKey(p,h,publicCards,prev[p],score)};cache.set(id,entry);
          }
          finalScores[p]=entry.score;return entry.key;
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
    if(!fixed&&cfg.terminalExpectation&&!icm&&!t.live[player]){
      const paid=p=>rules.prior[p]+t.total[p]+(rules.pre?rules.ownAnte[p]:0);
      for(let p=0;p<n;p++)if(p!==player&&paid(p)>=paid(player))return -t.total[player]-anteOf[player];
    }
    if(t.kind==='terminal')return payoff(t,w)[player];
    if(t.kind==='chance')return learn(nextStreet(t),w,player,own,opponentReach,sampleReach,store,rng,fixed);
    const k=t.actions.length;
    if(k===1)return learn(advance(t,0),w,player,own,opponentReach,sampleReach,store,rng,fixed);
    if(t.actor!==player){
      const sig=probabilities(t,w,fixed?profile:store,fixed);
      const sampling=t.sampling||(t.sampling=new Float64Array(k));
      for(let b=0;b<k;b++)sampling[b]=0.9*sig[b]+0.1/k;
      const a=choose(sampling,rng);
      if(!fixed&&cfg.terminalBaseline&&t.actions[0].kind==='fold'){
        const fold=advance(t,0);
        if(fold.kind==='terminal'){
          const baseline=payoff(fold,w)[player];let known=baseline;
          stateVisits++;
          let chosen=a===0?fold:null;
          for(let i=1;i<k;i++){
            const child=advance(t,i);if(i===a)chosen=child;
            if(child.kind==='terminal'){known+=sig[i]*(payoff(child,w)[player]-baseline);stateVisits++;}
          }
          if(chosen.kind==='terminal')return known;
          const value=learn(chosen,w,player,own,opponentReach*sig[a],sampleReach*sampling[a],store,rng,fixed);
          return known+sig[a]/sampling[a]*(value-baseline);
        }
      }
      if(!fixed&&cfg.terminalExpectation&&k===2&&t.actions[0].kind==='fold'){
        const called=advance(t,1);
        if(called.kind==='terminal'){const folded=advance(t,0);
          if(folded.kind==='terminal'){stateVisits+=2;return sig[0]*payoff(folded,w)[player]+sig[1]*payoff(called,w)[player];}}
      }
      return sig[a]/sampling[a]*learn(advance(t,a),w,player,own,opponentReach*sig[a],
        sampleReach*sampling[a],store,rng,fixed);
    }
    const sig=probabilities(t,w,store,false,true), row=record(t,w,store,false);
    const values=t.values||(t.values=new Float64Array(k));let mean=0;
    for(let a=0;a<k;a++){
      if(fixed)row.buffer[row.offset+k+a]+=step*own*sig[a]/sampleReach;
      else add(row,k,a,0,averageStep*own*sig[a]/sampleReach);
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
  const wantsStrata=external?cfg.externalRiverStrata===true:cfg.riverStrata===true;
  const stratify=wantsStrata && board.length===5 && batchDeals>1 &&
    updates==='simultaneous' && hands.reduce((a,r)=>a*r.length,1)<=1024;
  if(external && wantsStrata && !stratify)throw Error('External stratification requires a fixed river, a frozen batch, simultaneous updates and at most 1024 private tuples');
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
  let nativeContinuation=null;
  function iterate(count=1){
    if(!Number.isSafeInteger(count)||count<0||count>10000000||iterations+count>10000000)throw Error('Iteration count must fit the 10 million iteration limit');
    if(nativeOnly&&count>0)throw Error('This study uses a native-only trainer option (chanceSampling or opponentExploration); train it with the native engine');
    for(let i=0;i<count && !limitReached;i++){
      const dealBefore=dealRandom.state(),actionBefore=actionRandom.state(),visitsBefore=stateVisits,dealsBefore=trainingDeals;
      if(external)journal={insertions:[],saved:new Map()};
      try{
        step=weighting==='linear'?iterations+1:1;
        averageStep=weighting==='linear'?step:dcfr?dcfr.averageWeight(iterations+1):1;
        for(let batch=0;batch<batchDeals;batch++){
        const w=stratify?stratumWorld(batch):trainingWorld();
        if(external){const rng=actionStreams==='deal'?dealStream(iterations,batch):actionRandom;for(let p=0;p<n;p++)learn(tree,w,p,1,1,1,profile,rng);}
        else if(updates==='enumerate')enumerateOwn(w);
        else if(updates==='alternating')for(let p=0;p<n;p++)walk(tree,p?trainingWorld():w,reach,{seat:p,weight:1});
        else walk(tree,w,reach,true);
        }
        if(batchDeals>1)finishBatch(true);
        iterations++;nativeContinuation=null;
      }catch(e){
        finishBatch(false);
        if(journal){
          for(const [buffer,offsets] of journal.saved)for(const [at,old] of offsets)buffer.set(old,at);
          if(journal.syncs)for(const [buffer,index,value] of journal.syncs)syncOf.get(buffer)[index]=value;
          for(const item of journal.insertions.reverse()){
            const pool=profile.pools[item.k],node=profile.nodes.get(item.path);
            node.rows.delete(item.key);pool.count--;
            if(item.allocate)pool.blocks.pop();
            if(!pool.count)delete profile.pools[item.k];
            if(item.newNode)profile.nodes.delete(item.path);
            profile.infos--;profile.bytes-=item.extra;
          }
          profile.gen++;stateVisits=visitsBefore;trainingDeals=dealsBefore;
          dealRandom.restore(dealBefore);actionRandom.restore(actionBefore);
        }
        if(e!==memoryError)throw e;
        reach.fill(1);limitReached=true;
      }finally{journal=null;}
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
      runoutMode:'fresh',deals:iterations,algorithm:external?'external':'full',...(external?{actionStreams}:{}),stateVisits,limitReached};
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
  // Save numerical blocks in their original pool slots. Sorted keys allow
  // bounded duplicate detection without rebuilding another strategy at save time.
  function tableArchive(labels){
    const counts=profile.pools.flatMap((p,k)=>p?[[k,p.count]]:[]);
    const meta=EM.checkpointPayload({...cfg,abstraction,weighting,batchDeals,regretMatching,strategyBudgetMiB:profile.limit/1048576},
      {kind:'wide',codec:'tables1',external,iterations,stateVisits,trainingDeals,limitReached,dealState:dealRandom.state(),actionState:actionRandom.state(),counts},labels);
    function* entries(){
      for(const [k,count] of counts){const pool=profile.pools[k];
        for(let b=0;b<pool.blocks.length;b++){const len=Math.min(256,count-256*b),block=pool.blocks[b];
          yield ['p',k,b,EM.packTrainingValues(block.subarray(0,len*2*k)),dcfr?Array.from(syncOf.get(block).subarray(0,len)):null];}}
      for(const path of [...profile.nodes.keys()].sort()){
        const node=profile.nodes.get(path);yield ['n',path,node.k,node.rows.size];
        const rows=[...node.rows].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
        for(let i=0;i<rows.length;i+=64)yield ['r',rows.slice(i,i+64)];
      }
      yield ['e'];
    }
    return {meta,entries};
  }
  function tableReader(s,verifyOnly=false){
    const bad=EM.checkpointFail,int=EM.checkpointInteger;
    if(s.kind!=='wide'||s.external!==external||typeof s.limitReached!=='boolean'||!Array.isArray(s.counts)||s.counts.length>6)bad();
    int(s.iterations);int(s.stateVisits,Number.MAX_SAFE_INTEGER);int(s.trainingDeals,Number.MAX_SAFE_INTEGER);
    if(external&&s.trainingDeals!==s.iterations*batchDeals)bad();int(s.dealState,4294967295);int(s.actionState,4294967295);
    let allocated=0,expectedRows=0,poolIndex=0,blockIndex=0,prevK=1,lastPath='',lastKey=null,node=null,remaining=0,ended=false,seenRows=0;
    const pools=[],seen=[],nodes=new Map(),cache=new Map([['r',tree]]);
    for(const pair of s.counts){if(!Array.isArray(pair)||pair.length!==2)bad();const [k,count]=pair;
      if(!Number.isInteger(k)||k<=prevK||k>7||!int(count,3000000))bad();prevK=k;expectedRows+=count;
      allocated+=Math.ceil(count/256)*(256*16*k*(batchDeals>1?2:1)+(batchDeals>1?512:0)+(dcfr?1024:0));
      if(allocated>profile.limit)bad();pools[k]={count,blocks:[]};seen[k]=new Uint8Array(Math.ceil(count/8));
    }
    function closeNode(){
      if(remaining)bad();
      if(node&&!verifyOnly)node.rows=new Map([...node.rows].sort((a,b)=>a[1]-b[1]));
      node=null;
    }
    function row(line){
      if(ended||!Array.isArray(line))bad();const [tag,a,b,c,d]=line;
      if(poolIndex<s.counts.length){
        const [k,count]=s.counts[poolIndex],length=Math.min(256,count-256*blockIndex);
        if(tag!=='p'||line.length!==5||a!==k||b!==blockIndex)bad();
        const vals=EM.unpackTrainingValues(c,length*2*k);
        for(let j=0;j<vals.length;j++)if(j%(2*k)>=k&&vals[j]<0)bad();
        if(dcfr?(!Array.isArray(d)||d.length!==length||d.some(x=>!Number.isInteger(x)||x<0||x>s.iterations)):d!==null)bad();
        if(!verifyOnly){const block=new Float64Array(256*2*k);block.set(vals);pools[k].blocks.push(block);
          if(dcfr){const sync=new Uint32Array(256);sync.set(d);syncOf.set(block,sync);}}
        if(++blockIndex===Math.ceil(count/256)){blockIndex=0;poolIndex++;}return;
      }
      if(tag==='n'){
        closeNode();if(line.length!==4||typeof a!=='string'||a.length>512||!/^r[0-6c]*$/.test(a)||a<=lastPath||!Number.isInteger(b)||!pools[b]||!int(c,pools[b].count))bad();
        if(cache.size>4096){cache.clear();cache.set('r',tree);}const t=pathState(a,cache);
        if(t.kind!=='player'||t.actions.length!==b)bad();
        allocated+=192+2*a.length;if(allocated>profile.limit)bad();
        node={k:b,rows:verifyOnly?null:new Map()};if(!verifyOnly)nodes.set(a,node);
        lastPath=a;lastKey=null;remaining=c;return;
      }
      if(tag==='r'){
        if(line.length!==2||!Array.isArray(a)||!a.length||a.length>64||a.length>remaining||!node)bad();
        const k=node.k;
        for(const pair of a){if(!Array.isArray(pair)||pair.length!==2)bad();const [key,ix]=pair;
          if(abstraction==='compact'?!Number.isSafeInteger(key)||key<0:typeof key!=='string'||!key.length||key.length>1024||!/^[a-zA-Z0-9:.,/]+$/.test(key))bad();
          if(lastKey!==null&&key<=lastKey||!Number.isInteger(ix)||ix<0||ix>=pools[k].count)bad();lastKey=key;
          const bit=1<<(ix&7);if(seen[k][ix>>3]&bit)bad();seen[k][ix>>3]|=bit;seenRows++;
          allocated+=56+(typeof key==='string'?2*key.length:0);if(allocated>profile.limit)bad();
          if(!verifyOnly)node.rows.set(key,ix);
        }
        remaining-=a.length;return;
      }
      if(tag!=='e'||line.length!==1||seenRows!==expectedRows)bad();closeNode();ended=true;
    }
    function finish(){
      if(!ended)bad();if(verifyOnly)return;
      profile.nodes=nodes;profile.pools=pools;profile.bytes=allocated;profile.infos=seenRows;profile.gen++;
      trainingDeals=s.trainingDeals;iterations=s.iterations;stateVisits=s.stateVisits;limitReached=s.limitReached;
      dealRandom.restore(s.dealState);actionRandom.restore(s.actionState);
    }
    return {row,finish};
  }
  function archiveState(labels){
    if(!nativeContinuation)return tableArchive(labels);
    const bytes=nativeContinuation;
    return {bytes,meta:EM.checkpointPayload({...cfg,strategyBudgetMiB:profile.limit/1048576},{kind:'wide',external:true,iterations},labels)};
  }
  function snapshot(labels){
    if(nativeContinuation){
      const chunks=[];
      for(let i=0;i<nativeContinuation.length;i+=24576)
        chunks.push(btoa(String.fromCharCode(...nativeContinuation.subarray(i,i+24576))));
      return EM.checkpointPayload({...cfg,strategyBudgetMiB:profile.limit/1048576},{kind:'wide',external:true,iterations,nativeEMMW4:chunks.join('')},labels);
    }
    const pools=[];
    for(let k=2;k<profile.pools.length;k++){
      const pool=profile.pools[k];if(!pool)continue;
      pools.push({k,count:pool.count,blocks:pool.blocks.map((block,i)=>EM.packTrainingValues(block.subarray(0,Math.min(256,pool.count-i*256)*2*k))),
        ...(dcfr?{syncs:pool.blocks.map((block,i)=>Array.from(syncOf.get(block).subarray(0,Math.min(256,pool.count-i*256))))}:{})});
    }
    const records=[...profile.nodes].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,node])=>({path,k:node.k,rows:[...node.rows]}));
    return EM.checkpointPayload({...cfg,abstraction,weighting,batchDeals,regretMatching,strategyBudgetMiB:profile.limit/1048576},{kind:'wide',external,iterations,stateVisits,trainingDeals,limitReached,
      dealState:dealRandom.state(),actionState:actionRandom.state(),pools,records},labels);
  }
  function restoreState(state){
    const bad=EM.checkpointFail;
    if(state.nativeEMMW4!==undefined){
      if(!external||iterations||profile.infos||typeof state.nativeEMMW4!=='string')bad();
      const bytes=legacyNativeBytes(state.nativeEMMW4);
      if(importNative(bytes,true).iterations!==state.iterations)bad();
      return;
    }
    if(iterations||profile.infos||state.kind!=='wide'||state.external!==external||typeof state.limitReached!=='boolean')bad();
    EM.checkpointInteger(state.iterations);EM.checkpointInteger(state.stateVisits,Number.MAX_SAFE_INTEGER);
    EM.checkpointInteger(state.dealState,4294967295);EM.checkpointInteger(state.actionState,4294967295);
    if(!Array.isArray(state.pools)||state.pools.length>6||!Array.isArray(state.records))bad();
    const pools=[],seen=[];let bytes=0,infos=0;
    for(const row of state.pools){
      if(!Number.isInteger(row.k)||row.k<2||row.k>7||pools[row.k])bad();
      EM.checkpointInteger(row.count,3000000);if(!row.count||!Array.isArray(row.blocks)||row.blocks.length!==Math.ceil(row.count/256))bad();
      bytes+=row.blocks.length*(256*16*row.k*(batchDeals>1?2:1)+(batchDeals>1?512:0));if(bytes>profile.limit)bad();
      // 3.3: DCFR rows carry the iteration through which their regrets are discounted.
      if(dcfr){
        if(!Array.isArray(row.syncs)||row.syncs.length!==row.blocks.length)bad();
        row.syncs.forEach((list,i)=>{if(!Array.isArray(list)||list.length!==Math.min(256,row.count-i*256)||list.some(v=>!Number.isInteger(v)||v<0||v>state.iterations))bad();});
        bytes+=row.blocks.length*1024;
      }else if(row.syncs!==undefined)bad();
      pools[row.k]={count:row.count,encoded:row.blocks,syncs:row.syncs};seen[row.k]=new Uint8Array(row.count);
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
        for(let j=0;j<values.length;j++)if(j%(2*k)>=k && values[j]<0)bad();block.set(values);
        if(dcfr){const sync=new Uint32Array(256);sync.set(pool.syncs[i]);syncOf.set(block,sync);}
        return block;
      });delete pool.encoded;delete pool.syncs;
    }
    profile.nodes=nodes;profile.pools=pools;profile.bytes=bytes;profile.infos=infos;profile.gen++;
    trainingDeals=state.trainingDeals??state.iterations*batchDeals*(!external&&updates!=='simultaneous'?n:1);
    EM.checkpointInteger(trainingDeals,Number.MAX_SAFE_INTEGER);
    if(external && trainingDeals!==state.iterations*batchDeals)throw Error("Inconsistent external checkpoint committed deal count");
    iterations=state.iterations;stateVisits=state.stateVisits;limitReached=state.limitReached;
    dealRandom.restore(state.dealState);actionRandom.restore(state.actionState);
  }
  function increaseBudget(mib){
    if(!Number.isFinite(mib)||mib<profile.limit/1048576||mib>budgetCap)throw Error('Resume memory budget must be at least the current budget and at most '+budgetCap+' MiB');
    if(mib>profile.limit/1048576){profile.limit=mib*1048576;limitReached=false;}
  }
  // ---- native engine bridge (protocol 1, see source/native/MW-PROTOCOL.md) ----
  // The native engine trains exactly this game: the betting tree below, the same
  // ranges, random stream and batch rules. Its regrets and averages come back as
  // ordinary rows of this JavaScript profile, so evaluation, the explorer, exact
  // cross-checks and .emstudy checkpoints work unchanged.
  // For a known river the JS feature function is evaluated once for every
  // unblocked physical hand. Only the strategy index is grouped. The dealer,
  // weighted rejection and terminal evaluation always use the physical hand.
  const groupedRiver=board.length===5 && abstraction!=='exact';
  let groups=null;
  function riverGroups(){
    if(!groups)groups=hands.map((range,p)=>{
      const first=new Map(),keys=[],representatives=[];
      for(const [i,h] of range.entries()){
        const key=seatKey(p,h,board,0,EM.evalCards([...board,h.a,h.b]));
        if(!first.has(key))first.set(key,i);
        keys.push(key);representatives.push(first.get(key));
      }
      return {first,keys,representatives};
    });
    return groups;
  }
  // Enumerate only single-card river extensions. Canonical representatives
  // may lie on another river board if the full abstract history is identical.
  const groupedTurn=abstraction!=='exact' && board.length===4 &&
    53*hands.reduce((sum,r)=>sum+r.length,0)<=32768;
  let turnMapping=null;
  function turnGroups(){
    if(turnMapping)return turnMapping;
    turnMapping=hands.map((range,p)=>{
      const first=new Map(),keys=[],reps=[],opening=[];
      for(let slot=0;slot<=52;slot++){
        const cards=slot?board.concat(slot-1):board;
        for(const [i,h] of range.entries()){
          const loc=slot*2048+i;
          if(slot&&(board.includes(slot-1)||h.a===slot-1||h.b===slot-1)){reps.push(-1);continue;}
          const key=seatKey(p,h,cards,slot?opening[i]:0,EM.evalCards([...cards,h.a,h.b]));
          if(!slot)opening[i]=key;
          if(!first.has(key))first.set(key,loc);
          keys[loc]=key;reps.push(first.get(key));
        }
      }
      return {keys,first,reps};
    });
    return turnMapping;
  }
  // 3.3: every other grouped external-sampling study (flop and preflop starts, large
  // turns) trains natively with keys computed by the engine itself (es_groups.hpp);
  // grouped state files carry the key text of each row.
  const groupedKeys=abstraction!=='exact' && !groupedRiver && !groupedTurn && !stratify;
  function nativeSupport(){
    if(abstraction!=='exact' && !groupedRiver && !groupedTurn && !groupedKeys)return 'native training uses Exact cards grouping or external sampling (Compact and Detailed hand groups with full traversal are computed in JavaScript)';
    if(external && !rules)return 'native external sampling needs the betting rules of a multiway study';
    if(external && tree.kind!=='player')return 'the starting state has no decision';
    return null;
  }
  let nativeNodes=null;
  function nativeTree(){
    if(nativeNodes)return nativeNodes;
    const list=[],ids=new Map();
    (function visit(t){
      ids.set(t,list.length);list.push(t);
      if(t.kind==='player')for(let a=0;a<t.actions.length;a++)visit(advance(t,a));
      else if(t.kind==='chance')visit(nextStreet(t));
    })(tree);
    return nativeNodes={list,ids,byPath:new Map(list.map((t,i)=>[t.path,i]))};
  }
  let studyId;
  function nativeSpec(){
    const why=nativeSupport();if(why)throw Error(why);
    if(external)return withStudyId({protocol:4,...(cfg.terminalBaseline?{terminalBaseline:true}:{}),...(cfg.chanceSampling==='latin'?{chanceSampling:'latin'}:{}),...(cfg.opponentExploration!==undefined&&cfg.opponentExploration!==0.1?{opponentExploration:cfg.opponentExploration}:{}),...(cfg.terminalExpectation?{terminalExpectation:true}:{}),...(stratify?{stratified:true}:{}),...(groupedKeys?{abstraction,groupKeys:{abstraction,small:hands.map(r=>r.length<=12)}}:{}),...(groupedTurn?{abstraction,turnGroups:turnGroups().map(g=>g.reps)}:{}),...(groupedRiver?{abstraction,riverGroups:riverGroups().map(g=>g.representatives)}:{}),algorithm:'external',engine:'EightMax multiway',n,board:board.slice(),anteOf:anteOf.slice(),...(icm?{icm:icm.native}:{}),
      device:cfg.processingMode||'cpu',gpuMiB:cfg.gpuMiB??512,hands:hands.map(r=>r.map(h=>[h.id,h.a,h.b,h.w])),rules,batchDeals,weighting,...(dcfr?{dcfrAlpha:dcfr.alpha,dcfrBeta:dcfr.beta,dcfrGamma:dcfr.gamma}:{}),regretMatching,
      actionStreams,actionSeed,state:{rng:dealRandom.state(),actionRng:actionRandom.state(),iterations,trainingDeals,stateVisits}});
    const {list,ids}=nativeTree();
    const nodes=list.map(t=>t.kind==='player'?[0,t.actor,t.length,t.actions.map((_,a)=>ids.get(advance(t,a)))]:
      t.kind==='chance'?[1,t.length,ids.get(nextStreet(t))]:[2,Array.from(t.total),t.pots.map(pot=>[pot.amount,pot.eligible.slice()]),...(icm?[Array.from(t.behind)]:[])]);
    const spec={...(groupedKeys?{groupKeys:{abstraction,small:hands.map(r=>r.length<=12)},shoveOnly:cfg.preflop?.mode==='shove'}:{}),...(groupedTurn?{turnGroups:turnGroups().map(g=>g.reps)}:{}),...(groupedRiver?{riverGroups:riverGroups().map(g=>g.representatives)}:{}),protocol:(icm||stratify||!board.length)?3:1,stratified:stratify,...(icm?{icm:icm.native}:{}),engine:'EightMax multiway',n,board:board.slice(),anteOf:anteOf.slice(),
      device:cfg.processingMode||"cpu",gpuMiB:cfg.gpuMiB??512,hands:hands.map(r=>r.map(h=>[h.id,h.a,h.b,h.w])),nodes,batchDeals,weighting,regretMatching,updates,
      state:{rng:dealRandom.state(),iterations,trainingDeals,stateVisits}};
    return withStudyId(spec);
  }
  function withStudyId(spec){
    if(!studyId){
      // A content tag for accidental cross-study imports; .emstudy files also
      // have a full SHA-256 integrity check. Device settings do not affect identity.
      const {device,gpuMiB,state,...game}=spec;
      const text=JSON.stringify(game);let hi=0x811c9dc5,lo=0x9e3779b9;
      for(let i=0;i<text.length;i++){hi=Math.imul(hi^text.charCodeAt(i),16777619);lo=Math.imul(lo^text.charCodeAt(i),1597334677);}
      studyId=[hi,lo].map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
    }
    return {...spec,studyId};
  }
  const keyCards=(t,extra)=>board.concat(extra).slice(0,t.length);
  function nativeRow(t,key){
    // record() reads the key from a world; a one-entry world addresses this row.
    const keys={};keys[t.length]=[];keys[t.length][t.actor]=key;
    return record(t,{keys},profile,true);
  }
  function rowChecksum(bytes){
    const table=EM.crcTable||(EM.crcTable=Int32Array.from({length:256},(_,i)=>{let c=i;for(let b=0;b<8;b++)c=(c>>>1)^((c&1)?0xedb88320:0);return c;}));
    let crc=-1;
    for(let i=0;i<bytes.length;i++)crc=table[(crc^bytes[i])&255]^(crc>>>8);
    return ((~crc)>>>0).toString(16).padStart(8,'0');
  }
  function importNative(bytes,takeOwnership=false){
    const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
    const previous=profile;
    profile=newStore(previous.limit/1048576);profile.gen=previous.gen+1;
    try{return external?importExternal(u8,dv,takeOwnership):importFull(u8,dv);}
    catch(e){previous.gen=profile.gen+1;profile=previous;throw e;}
  }
  function importFull(u8,dv){
    if(u8.length<16||String.fromCharCode(...u8.subarray(0,5))!==(groupedKeys?'EMMWG':board.length?'EMMW1':'EMMW3'))throw Error('Not a native training state');
    const hl=dv.getUint32(8,true),head=JSON.parse(new TextDecoder().decode(u8.subarray(12,12+hl)));
    if(!studyId)nativeSpec();
    if(head.rowCrc32!==undefined && head.rowCrc32!==rowChecksum(u8.subarray(12+hl)))throw Error('Native state checksum failed');
    for(const field of ['iterations','trainingDeals','stateVisits','rng'])
      if(!Number.isSafeInteger(head[field])||head[field]<0)throw Error('Invalid native counters');
    if(head.rng>4294967295||head.iterations>10000000)throw Error('Invalid native counters');
    if(head.studyId && head.studyId!==studyId)throw Error('Native state belongs to a different study');
    if(head.protocol!==1)throw Error('Unsupported native protocol');
    const {list}=nativeTree();let p=12+hl;const count=dv.getUint32(p,true);p+=4;
    for(let i=0;i<count;i++){
      if(groupedKeys){
        const node=dv.getUint32(p,true),length=dv.getUint16(p+4,true),t=list[node];p+=6;
        if(!length || length>1024 || p+length+1>u8.length)throw Error('Truncated grouped state');
        const text=new TextDecoder().decode(u8.subarray(p,p+length));p+=length;
        const k=u8[p++],key=abstraction==='compact'?Number(text):text;
        if(!t || t.kind!=='player'||k!==t.actions.length || (abstraction==='compact'?
          !Number.isSafeInteger(key)||key<0||String(key)!==text:!/^0\/[a-z0-9:.,/]+$/.test(text)))throw Error('Invalid grouped row');
        const before=profile.infos,row=nativeRow(t,key);
        if(before===profile.infos)throw Error('Duplicate grouped strategy row');
        for(let a=0;a<2*k;a++){const v=dv.getFloat64(p,true);p+=8;if(!Number.isFinite(v)||(a>=k && v<0))throw Error('Invalid grouped values');row.buffer[row.offset+a]=v;}
        continue;
      }
      const node=dv.getUint32(p,true),hand=dv.getUint16(p+4,true),e1=u8[p+6],e2=u8[p+7],k=u8[p+8];p+=9;
      const t=list[node];
      if(!t||t.kind!=='player'||t.actions.length!==k||!hands[t.actor][hand])throw Error('Native state does not match this game');
      const extra=[e1,e2,...(board.length?[]:u8.subarray(p,p+=3))].filter(e=>e>0).map(e=>e-1);
      const key=groupedRiver?riverGroups()[t.actor].keys[hand]:groupedTurn?
        turnGroups()[t.actor].keys[e1*2048+hand]:EM.exactHandKey(hands[t.actor][hand],keyCards(t,extra));
      if(key===undefined)throw Error('Invalid grouped strategy row');
      const row=nativeRow(t,key);
      for(let a=0;a<2*k;a++){row.buffer[row.offset+a]=dv.getFloat64(p,true);p+=8;}
    }
    if(p!==u8.length)throw Error('Native state has trailing data');
    iterations=head.iterations;trainingDeals=head.trainingDeals;stateVisits=head.stateVisits;dealRandom.restore(head.rng);
    limitReached=false;
    return head;
  }
  // ---- EMMW4: external-sampling state (see MW-PROTOCOL.md) ----
  // States are listed parent-first as (parent, action slot; 7 = next street) and
  // reproduce the JavaScript action paths. JavaScript checks the description of
  // every state (up to 20,000, otherwise an evenly spaced sample) against its
  // own betting tree before accepting any row.
  function pathState(path,cache){
    let t=cache.get(path);if(t)return t;
    const parent=pathState(path.slice(0,-1),cache),c=path[path.length-1];
    t=c==='c'?(parent.kind==='chance'?nextStreet(parent):null):(parent&&parent.kind==='player'&&+c<parent.actions.length?advance(parent,+c):null);
    if(!t)throw Error('Native state does not match this game');
    cache.set(path,t);return t;
  }
  function importExternal(u8,dv,takeOwnership){
    if(u8.length<20||String.fromCharCode(...u8.subarray(0,5))!=='EMMW4')throw Error('Not a native external-sampling state');
    const hl=dv.getUint32(8,true),head=JSON.parse(new TextDecoder().decode(u8.subarray(12,12+hl)));
    if(!studyId)nativeSpec();
    if(head.rowCrc32!==rowChecksum(u8.subarray(12+hl)))throw Error('Native state checksum failed');
    for(const field of ['iterations','trainingDeals','stateVisits','rng','actionRng'])
      if(!Number.isSafeInteger(head[field])||head[field]<0)throw Error('Invalid native counters');
    if(head.trainingDeals!==head.iterations*batchDeals)throw Error("Inconsistent external checkpoint committed deal count");
    if(head.rng>4294967295||head.actionRng>4294967295||head.iterations>10000000)throw Error('Invalid native counters');
    if(head.studyId!==studyId)throw Error('Native state belongs to a different study');
    if(head.protocol!==1)throw Error('Unsupported native protocol');
    // 3.3: DCFR states append each row's discount iteration (u32) after its values.
    if((head.rowSync===1)!==!!dcfr||(head.rowSync!==undefined&&head.rowSync!==1))throw Error('Native state does not match this study\'s weighting');
    if((head.rowKeys===1)!==groupedKeys||(head.rowKeys!==undefined&&head.rowKeys!==1))throw Error('Native state does not match this study\'s hand grouping');
    let p=12+hl;const sc=dv.getUint32(p,true);p+=4;
    if(sc<1||sc*9>u8.length-p)throw Error('Invalid native state table');
    const stubs=new Array(sc),stride=sc<=20000?1:Math.ceil(sc/20000),cache=new Map([['r',tree]]);
    for(let i=0;i<sc;i++){
      const parent=dv.getUint32(p,true),slot=u8[p+4],kind=u8[p+5],actor=u8[p+6],length=u8[p+7],k=u8[p+8];p+=9;
      if(i===0?parent!==0xffffffff:parent>=i)throw Error('Invalid native state table');
      const path=i===0?'r':stubs[parent].path+(slot===7?'c':String(slot));
      stubs[i]={path,kind,actor,length,actions:{length:k}};
      if(i%stride===0){
        const t=pathState(path,cache),expect=t.kind==='player'?0:t.kind==='chance'?1:2;
        if(expect!==kind||t.length!==length||(kind===0&&(t.actor!==actor||t.actions.length!==k)))throw Error('Native state does not match this game');
        if(cache.size>50000)cache.clear(),cache.set('r',tree);
      }
    }
    const count=dv.getUint32(p,true);p+=4;
    const limit=profile.limit;profile.limit=budgetCap*1048576;
    try{
      const decoder0=new TextDecoder();
      for(let i=0;groupedKeys&&i<count;i++){
        const state=dv.getUint32(p,true),len=dv.getUint16(p+4,true),t=stubs[state];
        const text=decoder0.decode(u8.subarray(p+6,p+6+len)),k=u8[p+6+len];p+=7+len;
        if(!t||t.kind!==0||t.actions.length!==k||!len||len>1024)throw Error('Native state does not match this game');
        if(abstraction==='compact'?!/^(0|[1-9][0-9]{0,15})$/.test(text):!/^0\/[a-z0-9:.,/]+$/.test(text))throw Error('Invalid grouped native row key');
        const key=abstraction==='compact'?Number(text):text;
        if(abstraction==='compact'&&!Number.isSafeInteger(key))throw Error('Invalid grouped native row key');
        const before=profile.infos,row=nativeRow(t,key);
        if(profile.infos===before)throw Error('Duplicate native strategy row');
        for(let a=0;a<2*k;a++){
          const v=dv.getFloat64(p,true);p+=8;
          if(!Number.isFinite(v)||(a>=k && v<0))throw Error('Invalid native strategy value');
          row.buffer[row.offset+a]=v;
        }
        if(dcfr){const sync=dv.getUint32(p,true);p+=4;if(sync>head.iterations)throw Error('Invalid native discount iteration');syncOf.get(row.buffer)[row.offset/(2*k)]=sync;}
      }
      for(let i=0;!groupedKeys&&i<count;i++){
        const state=dv.getUint32(p,true),hand=dv.getUint16(p+4,true),k=u8[p+11],t=stubs[state];
        if(!t||t.kind!==0||t.actions.length!==k||!hands[t.actor][hand])throw Error('Native state does not match this game');
        const cards=[...u8.subarray(p+6,p+11)].filter(c=>c>0).map(c=>c-1);p+=12;
        if(cards.length!==t.length)throw Error('Native state does not match this game');
        const before=profile.infos;
        const key=groupedTurn?turnGroups()[t.actor].keys[(cards.length===5?cards[4]+1:0)*2048+hand]:null;
        if(groupedTurn && key===undefined)throw Error("Invalid grouped turn row");
        const row=nativeRow(t,groupedTurn?key:groupedRiver?riverGroups()[t.actor].keys[hand]:EM.exactHandKey(hands[t.actor][hand],cards));
        if(profile.infos===before)throw Error('Duplicate native strategy row');
        for(let a=0;a<2*k;a++){
          const v=dv.getFloat64(p,true);p+=8;
          if(!Number.isFinite(v)||(a>=k && v<0))throw Error('Invalid native strategy value');
          row.buffer[row.offset+a]=v;
        }
        if(dcfr){
          const sync=dv.getUint32(p,true);p+=4;
          if(sync>head.iterations)throw Error('Invalid native discount iteration');
          syncOf.get(row.buffer)[row.offset/(2*k)]=sync;
        }
      }
    }finally{profile.limit=Math.max(limit,profile.bytes);}
    if(p!==u8.length)throw Error('Native state has trailing data');
    iterations=head.iterations;trainingDeals=head.trainingDeals;stateVisits=head.stateVisits;
    dealRandom.restore(head.rng);actionRandom.restore(head.actionRng);limitReached=false;
    nativeContinuation=takeOwnership?u8:new Uint8Array(u8);
    return head;
  }
  function exportExternal(){
    const ids=new Map([['r',0]]),states=[[0xffffffff,0,0,tree.actor,tree.length,tree.actions.length]],cache=new Map([['r',tree]]);
    const index=hands.map(r=>new Map(r.map((h,i)=>[h.id,i]))),parts=[];let count=0;
    const paths=[...profile.nodes.keys()].sort((a,b)=>a.length-b.length||(a<b?-1:a>b?1:0));
    for(const path of paths)for(let i=2;i<=path.length;i++){
      const prefix=path.slice(0,i);if(ids.has(prefix))continue;
      const t=pathState(prefix,cache),c=prefix[i-1];
      ids.set(prefix,states.length);
      states.push([ids.get(prefix.slice(0,-1)),c==='c'?7:+c,t.kind==='player'?0:1,Math.max(0,t.actor),t.length,t.kind==='player'?t.actions.length:0]);
    }
    const encoder0=new TextEncoder();
    for(const path of paths){
      const node=profile.nodes.get(path),id=ids.get(path),t=pathState(path,cache),k=node.k,pool=profile.pools[k];
      if(groupedKeys){
        // u32 state | u16 key length | key text | u8 k | values (| u32 DCFR discount iteration)
        for(const [key,ix] of node.rows){
          const text=encoder0.encode(String(key)),rec=new Uint8Array(7+text.length+16*k+(dcfr?4:0)),dv=new DataView(rec.buffer);
          dv.setUint32(0,id,true);dv.setUint16(4,text.length,true);rec.set(text,6);rec[6+text.length]=k;
          const buf=pool.blocks[Math.floor(ix/256)],off=ix%256*2*k;
          for(let a=0;a<2*k;a++)dv.setFloat64(7+text.length+8*a,buf[off+a],true);
          if(dcfr)dv.setUint32(7+text.length+16*k,syncOf.get(buf)[ix%256],true);
          parts.push(rec);count++;
        }
        continue;
      }
      for(const [key,ix] of node.rows){
        const [hid,cardText]=String(key).split(':');
        const turnRef=groupedTurn?turnGroups()[t.actor].first.get(key):0;
        const slot=Math.floor(turnRef/2048);
        const groupedBoard=slot?board.concat(slot-1):board;
        const pub=groupedTurn||groupedRiver?groupedBoard.slice(0,3).sort((a,b)=>a-b).concat(groupedBoard.slice(3)):cardText?cardText.split('.').map(Number):[];
        const rec=new Uint8Array(12+16*k+(dcfr?4:0)),dv=new DataView(rec.buffer);
        dv.setUint32(0,id,true);dv.setUint16(4,groupedTurn?turnRef%2048:groupedRiver?riverGroups()[t.actor].first.get(key):index[t.actor].get(+hid),true);
        for(let j=0;j<5;j++)rec[6+j]=j<pub.length?pub[j]+1:0;rec[11]=k;
        const buf=pool.blocks[Math.floor(ix/256)],off=ix%256*2*k;
        for(let a=0;a<2*k;a++)dv.setFloat64(12+8*a,buf[off+a],true);
        if(dcfr)dv.setUint32(12+16*k,syncOf.get(buf)[ix%256],true);
        parts.push(rec);count++;
      }
    }
    if(!studyId)nativeSpec();
    const encoder=new TextEncoder(),header={protocol:1,specProtocol:4,studyId,iterations,trainingDeals,stateVisits,rng:dealRandom.state(),actionRng:actionRandom.state(),rows:count,states:states.length,...(dcfr?{rowSync:1}:{}),...(groupedKeys?{rowKeys:1}:{}),rowCrc32:'00000000'};
    const head=encoder.encode(JSON.stringify(header)),stateBytes=4+9*states.length;
    const out=new Uint8Array(12+head.length+stateBytes+4+parts.reduce((a,b)=>a+b.length,0)),dv=new DataView(out.buffer);
    out.set([69,77,77,87,52,0,0,0]);dv.setUint32(8,head.length,true);out.set(head,12);
    let p=12+head.length;dv.setUint32(p,states.length,true);p+=4;
    for(const [parent,slot,kind,actor,length,k] of states){dv.setUint32(p,parent,true);out.set([slot,kind,actor,length,k],p+4);p+=9;}
    dv.setUint32(p,count,true);p+=4;
    for(const r of parts){out.set(r,p);p+=r.length;}
    out.set(encoder.encode(rowChecksum(out.subarray(12+head.length))),12+head.length-10);
    return out;
  }
  function exportNative(preserveNativeOrder=false){
    if(preserveNativeOrder && nativeContinuation)return nativeContinuation.slice();
    const why=nativeSupport();if(why)throw Error(why);
    if(external)return exportExternal();
    const {byPath}=nativeTree(),index=hands.map(r=>new Map(r.map((h,i)=>[h.id,i]))),parts=[];let count=0;
    for(const [path,node] of profile.nodes){
      const id=byPath.get(path);if(id===undefined)continue;
      const t=nativeTree().list[id],k=node.k,pool=profile.pools[k];
      for(const [key,ix] of node.rows){
        if(groupedKeys){
          const text=new TextEncoder().encode(String(key)),rec=new Uint8Array(7+text.length+16*k),dv=new DataView(rec.buffer);
          dv.setUint32(0,id,true);dv.setUint16(4,text.length,true);rec.set(text,6);rec[6+text.length]=k;
          const buf=pool.blocks[ix>>8],off=(ix%256)*2*k;
          for(let a=0;a<2*k;a++)dv.setFloat64(7+text.length+8*a,buf[off+a],true);
          parts.push(rec);count++;continue;
        }
        const [hid,cards]=String(key).split(':'),pub=cards?cards.split('.').map(Number):[],extra=pub.slice(board.length);
        const rec=new Uint8Array((board.length?9:12)+16*k),dv=new DataView(rec.buffer);
        dv.setUint32(0,id,true);const rep=groupedTurn?turnGroups()[t.actor].first.get(key):groupedRiver?riverGroups()[t.actor].first.get(key):null;
        dv.setUint16(4,rep===null?index[t.actor].get(+hid):rep%2048,true);rec[6]=rep===null?(extra.length?extra[0]+1:0):Math.floor(rep/2048);rec[7]=extra.length>1?extra[1]+1:0;rec[8]=k;
        if(!board.length)for(let j=2;j<5;j++)rec[7+j]=j<extra.length?extra[j]+1:0;
        const buf=pool.blocks[Math.floor(ix/256)],off=ix%256*2*k;
        for(let a=0;a<2*k;a++)dv.setFloat64((board.length?9:12)+8*a,buf[off+a],true);
        parts.push(rec);count++;
      }
    }
    if(!studyId)nativeSpec();
    const encoder=new TextEncoder(),header={protocol:1,studyId,iterations,trainingDeals,stateVisits,rng:dealRandom.state(),rows:count,rowCrc32:'00000000'};
    const head=encoder.encode(JSON.stringify(header));
    const out=new Uint8Array(16+head.length+parts.reduce((a,b)=>a+b.length,0)),dv=new DataView(out.buffer);
    out.set([69,77,77,87,groupedKeys?71:board.length?49:51,0,0,0]);dv.setUint32(8,head.length,true);out.set(head,12);dv.setUint32(12+head.length,count,true);
    let p=16+head.length;for(const r of parts){out.set(r,p);p+=r.length;}
    out.set(encoder.encode(rowChecksum(out.subarray(12+head.length))),12+head.length-10);
    return out;
  }
  // Cheap, reliably measurable facts for the progress display (no evaluation).
  function diagnostics(){
    return {players:n,startStreet:streetName(board.length),algorithm:external?(dcfr?'external-sampling DCFR':'external-sampling MCCFR'):'chance-sampled CFR, full betting traversal',
      abstraction,batchDeals,weighting,...(dcfr?{dcfr:{alpha:dcfr.alpha,beta:dcfr.beta,gamma:dcfr.gamma}}:{}),regretMatching,
      handGroups:abstraction==='exact'?'exact cards':(groupedKeys||groupedRiver||groupedTurn)?'grouped policy lookup (native-capable); deals and showdowns use physical cards':'grouped policy lookup (JavaScript only)',
      // 3.3: speed and quality are reported separately.
      measures:{throughput:'deals per second and state visits per second measure calculation speed only',
        quality:n===2?'exact exploitability is available only through the exact cross-check on enumerable games':'multiway gains are approximate unilateral response estimates, not exact exploitability or a Nash certificate'},...(external?{actionStreams}:{}),utility:icm?'ICM':'chip EV',
      strategyMiB:profile.bytes/1048576,budgetMiB:profile.limit/1048576,iterations,trainingDeals,stateVisits,limitReached};
  }
  return {diagnostics,rootFrequencies,get trainingDeals(){return trainingDeals;},get strategyMiB(){return profile.bytes/1048576;},iterate,metrics,view,responseProbe,snapshot,archiveState,tableReader,restoreState,increaseBudget,averageAt,nativeSupport,nativeSpec,importNative,exportNative,get iterations(){return iterations;},get limitReached(){return limitReached;}};
};
})(globalThis.EM || (globalThis.EM = {}));
