(function (EM) {
'use strict';

// Public chance histories are shared by different betting lines. Strategy tables
// are separate for every betting history AND every sequence of observed cards.
function multiwayBoards(start, hands, hole, dealCount, options) {
  const n = hands.length, D = dealCount;
  if (start.length===5) options={};  // Future-card fields have no effect on a fixed river.
  const mode = options.mode || 'exact';
  const sampleCount = options.count == null ? 4 : options.count;
  const seed = options.seed == null ? 17 : options.seed;
  if (mode !== 'exact' && mode !== 'sampled') throw new Error('Select exact or sampled public cards');
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 20)
    throw new Error('Choose 1 to 20 sampled cards per street');
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
    throw new Error('The seed must be a whole number from 0 to 4294967295');

  const blocked = Array.from({length:52}, () => new Uint8Array(D));
  for (let p=0; p<n; p++) for (let d=0; d<D; d++) {
    const h=hands[p][hole[p][d]];
    blocked[h.a][d]=blocked[h.b][d]=1;
  }
  const counts=[0,0,0,0,0,0], finalBoards=new Map();
  let bytes=0;
  function reserve(amount) {
    bytes+=amount;
    if (bytes>64*1024*1024) throw new Error('The runout tables exceed the memory budget. Use fewer sampled cards or narrower ranges.');
  }
  function context(cards,valid) {
    reserve(D+120); counts[cards.length]++;
    return {cards, valid, edges:null, inverse:null, equities:null, final:null};
  }
  const root=context(start.slice(),new Uint8Array(D).fill(1));
  function shuffled(cards, board) {
    // The seed and public board alone determine the ordering, independent of bets.
    let state=(seed ^ 0x9e3779b9)>>>0;
    for (const c of board.slice().sort((a,b)=>a-b)) state=Math.imul(state^(c+1),16777619)>>>0;
    function random() {
      state=(state+0x6d2b79f5)>>>0;
      let t=Math.imul(state^(state>>>15),state|1);
      t^=t+Math.imul(t^(t>>>7),t|61);
      return ((t^(t>>>14))>>>0)/4294967296;
    }
    for (let i=cards.length-1;i>0;i--) {
      const j=Math.floor(random()*(i+1));
      [cards[i],cards[j]]=[cards[j],cards[i]];
    }
  }
  function edges(ctx) {
    if (ctx.edges) return ctx.edges;
    if (ctx.cards.length===5) throw new Error('The board is complete');
    const candidates=Array.from({length:52},(_,i)=>i).filter(c=>!ctx.cards.includes(c));
    if (mode==='sampled') shuffled(candidates,ctx.cards);
    const list=[], available=new Uint8Array(D);
    let uncovered=ctx.valid.reduce((a,b)=>a+b,0);
    for(const c of candidates) {
      const valid=new Uint8Array(D); let deals=0;
      for(let d=0;d<D;d++) if(ctx.valid[d] && !blocked[c][d]) {
        valid[d]=1;deals++;
        if (available[d]++===0) uncovered--;
      }
      if (deals) list.push({card:c,ctx:context([...ctx.cards,c],valid)});
      // If a particular private deal blocks all selected cards, add cards until
      // each possible deal has a normalized next-card distribution.
      if (mode==='sampled' && list.length>=sampleCount && uncovered===0) break;
    }
    if (uncovered || !list.length) throw new Error('No legal next card for a private deal');
    reserve(D*8);
    ctx.inverse=Float64Array.from(available,k=>k?1/k:0);
    ctx.edges=list.sort((a,b)=>a.card-b.card);
    return ctx.edges;
  }
  function final(ctx) {
    if(ctx.final) return ctx.final;
    // Ranking is the same on turn X / river Y as on turn Y / river X.
    // Only evaluator data are shared; the observed-card histories stay distinct.
    const key=ctx.cards.slice().sort((a,b)=>a-b).join(',');
    let table=finalBoards.get(key);
    if(!table) {
      const ranks=hands.map(hs=>{
        reserve(4*hs.length);
        return Uint32Array.from(hs,h=>ctx.cards.includes(h.a)||ctx.cards.includes(h.b)?0:EM.evalCards([...ctx.cards,h.a,h.b]));
      });
      table={ranks,winners:new Map()}; finalBoards.set(key,table);
    }
    ctx.final=table;return table;
  }
  const pop=Uint8Array.from({length:1<<n},(_,i)=>i.toString(2).replace(/0/g,'').length);
  function winners(ctx,mask) {
    const table=final(ctx);
    if(table.winners.has(mask))return table.winners.get(mask);
    reserve(D);
    const result=new Uint8Array(D);
    for(let d=0;d<D;d++) if(ctx.valid[d]) {
      let best=-1, tied=0;
      for(let p=0;p<n;p++) if(mask&(1<<p)) {
        const score=table.ranks[p][hole[p][d]];
        if(score>best){best=score;tied=1<<p;} else if(score===best)tied|=1<<p;
      }
      result[d]=tied;
    }
    table.winners.set(mask,result);return result;
  }
  function equity(ctx,mask) {
    if(!ctx.equities)ctx.equities=new Map();
    if(ctx.equities.has(mask))return ctx.equities.get(mask);
    reserve(8*n*D);
    const result=new Float64Array(n*D);
    for(const edge of edges(ctx)) {
      if(edge.ctx.cards.length===5) {
        const win=winners(edge.ctx,mask);
        for(let d=0;d<D;d++) if(win[d]) {
          const w=ctx.inverse[d]/pop[win[d]];
          for(let p=0;p<n;p++) if(win[d]&(1<<p))result[p*D+d]+=w;
        }
      } else {
        const child=equity(edge.ctx,mask);
        for(let p=0;p<n;p++) if(mask&(1<<p))
          for(let d=0;d<D;d++) result[p*D+d]+=ctx.inverse[d]*child[p*D+d];
      }
    }
    ctx.equities.set(mask,result);return result;
  }
  // Add a single side pot to the per-deal payoff. This also handles a pre-river
  // all-in without allocating betting decisions on streets nobody can play.
  function award(ctx,table,pot) {
    const seats=pot.eligible;
    if(seats.length===1) {
      const row=table[seats[0]];
      if(row) for(let d=0;d<D;d++)row[d]+=pot.amount;
      return;
    }
    const mask=seats.reduce((m,p)=>m|(1<<p),0);
    if(ctx.cards.length===5) {
      const win=winners(ctx,mask);
      for(let d=0;d<D;d++) if(win[d]) {
        const part=pot.amount/pop[win[d]];
        for(const p of seats) if(win[d]&(1<<p))table[p][d]+=part;
      }
    } else {
      const shares=equity(ctx,mask);
      for(const p of seats) for(let d=0;d<D;d++) table[p][d]+=pot.amount*shares[p*D+d];
    }
  }
  function utilities(ctx,t,icm) {
    const result=Array.from({length:n},()=>new Float64Array(D));
    const contested=t.pots.some(p=>p.eligible.length>1);
    function add(current,weight) {
      if(contested && current.cards.length<5) {
        const children=edges(current),next=Float64Array.from(weight,(v,d)=>v*current.inverse[d]);
        for(const edge of children)add(edge.ctx,next);
        return;
      }
      const ranks=contested?final(current).ranks:null;
      for(let d=0;d<D;d++)if(current.valid[d]) {
        const scores=ranks?ranks.map((row,p)=>row[hole[p][d]]):Array(n).fill(0);
        const value=icm.evaluate(EM.awardPots(t.pots,scores,t.behind));
        for(let p=0;p<n;p++)result[p][d]+=weight[d]*value[p];
      }
    }
    add(ctx,new Float64Array(D).fill(1));return result;
  }
  return {root,edges,award,utilities,counts,mode:start.length===5?'fixed':mode,sampleCount,seed};
}
EM.multiwayBoards=multiwayBoards;
})(globalThis.EM || (globalThis.EM = {}));
