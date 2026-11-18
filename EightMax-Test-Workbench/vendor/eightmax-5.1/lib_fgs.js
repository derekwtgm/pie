(function (EM) {
'use strict';
// Future Game Simulation (FGS) for ICM push/fold spots.
// Plain ICM values a stack the moment the hand ends, so it ignores that the blinds keep
// coming: a short stack about to post the big blind is worth less than ICM says, and the
// player who just passed the blinds is worth more. FGS fixes this by playing out the next
// hand(s) at the same blind level. For every end-of-hand stack vector:
//   1. players who busted keep the payout for their finishing place;
//   2. the button moves one seat (seat 0 becomes the new big blind);
//   3. the next hand is solved as an ICM push/fold game among the survivors, and its
//      equilibrium values replace ICM (recursively, for depth > 1).
// Players at other tables keep their stacks. If a survivor cannot post the next hand
// (all-in from the blinds) or fewer than two remain at the table, plain ICM is used.
function makeFGS(o) {
  const depth = Math.max(0, Math.min(2, o.depth | 0));
  const iters = o.iters || (depth > 1 ? 60 : 120);
  const others = (o.others || []).filter(x => x > 0), payouts = o.payouts.slice();
  const cache = o.cache || new Map();
  let solves = 0;
  function value(v, start) {
    const n = v.length;
    const startAll = [...start, ...others];
    const icm = EM.icmWithBusts([...v, ...others], startAll, payouts);
    const res = Float64Array.from(icm.slice(0, n));
    if (!depth) return res;
    // next hand in position order: old seats 1..n-1 then 0 (the old UTG posts the new BB)
    const order = [];
    for (let k = 1; k <= n; k++) { const p = k % n; if (v[p] > 1e-9) order.push(p); }
    if (order.length < 2) return res;
    const left = order.length + others.length;
    const pays = payouts.slice(0, left);
    if (!pays.some(x => x > 0) || pays.every(x => Math.abs(x - pays[0]) < 1e-12 && left <= pays.length))
      return res;
    const stacks = order.map(p => v[p]);
    const key = depth + '|' + stacks.map(x => x.toFixed(6)).join(',') + '|' + o.sb + ',' + o.bb + ',' + o.anteType + ',' + o.ante + '|' + others.join(',') + '|' + pays.join(',');
    let val = cache.get(key);
    if (!val) {
      try {
        const g = EM.PushFold({ n: order.length, stacks, sb: o.sb, bb: o.bb, anteType: o.anteType, ante: o.ante,
          model: 'icm', payouts: pays, others, fgs: depth > 1 ? { depth: depth - 1, iters: o.innerIters || 60, cache } : null });
        g.solve({ maxIter: iters, tol: 1e-7 });
        val = g.values(); solves++;
      } catch (e) {
        val = null; // cannot post the next hand: fall back to ICM
      }
      if (cache.size > 20000) cache.clear();
      cache.set(key, val || 'icm');
    }
    if (val && val !== 'icm') order.forEach((p, k) => { res[p] = val[k]; });
    return res;
  }
  return { value, depth, get solves() { return solves; } };
}
Object.assign(EM, { makeFGS });
})(globalThis.EM || (globalThis.EM = {}));
