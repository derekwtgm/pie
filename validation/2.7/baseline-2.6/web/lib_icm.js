(function (EM) {
'use strict';
// Malmuth-Harville ICM, exact via dynamic programming over finishing sets.
function icmRaw(stacks, payouts) {
  const n = stacks.length;
  const res = new Float64Array(n);
  if (n === 0) return res;
  if (n > 16) throw new Error('ICM supports up to 16 players');
  const P = Math.min(payouts.length, n);
  let total = 0; for (const s of stacks) total += s;
  const size = 1 << n;
  const prob = new Float64Array(size), msum = new Float64Array(size), pc = new Uint8Array(size);
  prob[0] = 1;
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask, rest = mask ^ low;
    msum[mask] = msum[rest] + stacks[31 - Math.clz32(low)];
    pc[mask] = pc[rest] + 1;
  }
  for (let mask = 0; mask < size; mask++) {
    const pm = prob[mask];
    if (pm === 0) continue;
    const k = pc[mask];
    if (k >= P) continue;
    const rem = total - msum[mask];
    if (rem <= 1e-12) continue;
    const pay = payouts[k];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue;
      const p = pm * stacks[i] / rem;
      if (p === 0) continue;
      res[i] += p * pay;
      prob[mask | (1 << i)] += p;
    }
  }
  return res;
}

// finalStacks may contain busted (0) players; they take the lowest open places,
// ordered by starting stack (bigger starting stack finishes higher).
function icmWithBusts(finalStacks, startStacks, payouts) {
  const n = finalStacks.length;
  const alive = [], busted = [];
  for (let i = 0; i < n; i++) (finalStacks[i] > 1e-9 ? alive : busted).push(i);
  const res = new Float64Array(n);
  const eq = icmRaw(alive.map(i => finalStacks[i]), payouts.slice(0, alive.length));
  alive.forEach((p, k) => { res[p] = eq[k]; });
  busted.sort((a, b) => startStacks[b] - startStacks[a]);
  for (let k = 0; k < busted.length;) {
    let end = k + 1;
    while (end < busted.length && Math.abs(startStacks[busted[end]] - startStacks[busted[k]]) < 1e-9) end++;
    let pool = 0;
    for (let j = k; j < end; j++) pool += payouts[alive.length + j] || 0;
    for (let j = k; j < end; j++) res[busted[j]] = pool / (end - k);
    k = end;
  }
  return res;
}

function parseNumberList(str) {
  return (str || '').split(/[\s,;]+/).filter(Boolean).map(x => {
    const v = parseFloat(x.replace(/[$%]/g, ''));
    if (!(v >= 0)) throw new Error('Not a number: "' + x + '"');
    return v;
  });
}

// Tournament utility is applied to each complete chip outcome, never to an
// average chip stack. Other players retain their entered stacks throughout.
function multiwayICM(cfg, stacks, prior, n, ownAnte) {
  if (!cfg.icm) return null;
  const payouts=cfg.icm.payouts, others=cfg.icm.others || [], count=n+others.length;
  if (!Array.isArray(others) || others.some(x=>!Number.isFinite(x)||x<=0) || count>16)
    throw Error('ICM needs positive other-player stacks and at most 16 players total');
  if (count<Math.max(cfg.dealt??n,n+(cfg.folded?.length||0)))
    throw Error('Include all other remaining players in ICM, including the seats that folded');
  if (!Array.isArray(payouts) || !payouts.length || payouts.length>count ||
      payouts.some((x,i)=>!Number.isFinite(x)||x<0||(i && x>payouts[i-1])) || !(payouts[0]>0))
    throw Error('Enter positive, descending remaining payouts; use zero for unpaid places');
  const own=ownAnte || Array.from({length:n},()=>cfg.dealt===undefined?0:0.1);
  const original=cfg.icm.startStacks || stacks.map((s,p)=>s+prior[p]+own[p]);
  if (!Array.isArray(original)||original.length!==n||original.some((s,p)=>!Number.isFinite(s)||s<=0||s+1e-8<stacks[p]+prior[p]+own[p]))
    throw Error('ICM hand-start stacks must cover the chips behind and earlier wagers');
  const start=[...original,...others], cache=new Map(), pool=payouts.reduce((a,b)=>a+b,0);
  function evaluate(final) {
    const key=Array.from(final).join(',');
    let value=cache.get(key);
    if (!value) {
      value=Float64Array.from(icmWithBusts([...final,...others],start,payouts).slice(0,n));
      if(cache.size>=65536)cache.delete(cache.keys().next().value); // about 10 MB for six seats
      cache.set(key,value);
    }
    return value;
  }
  return {evaluate,unit:'prize units',utility:'icm',prizePool:pool,
    reportThreshold:pool*0.001,players:count};
}
Object.assign(EM, { icmRaw, icmWithBusts, parseNumberList, multiwayICM });
})(globalThis.EM || (globalThis.EM = {}));
