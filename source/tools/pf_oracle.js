'use strict';
// Independent three-handed push/fold oracle.
// Rebuilds the push/fold game from its rules (first-in jam or fold, later seats call or fold,
// the first caller ends the action heads-up) without using the solver's payoff code, ICM code,
// removal matrices or best-response code. Deals are counted exactly: for every pair of disjoint
// two-card hands for the first two seats, the third seat's hands of each class that avoid all
// four cards are counted. Showdown odds come from the shared class-versus-class equity table.
// It returns each seat's EV under the solver's average strategy, its best-response EV, and
// the gain, so the solver's own exploitability report can be checked against it.
const NC = 169;

// Malmuth-Harville by brute force over finishing orders. Busted players take the lowest
// places, the bigger starting stack finishing higher; equal starting stacks split.
function icmBrute(stacks, start, payouts) {
  const n = stacks.length, out = new Array(n).fill(0);
  const alive = [], busted = [];
  for (let i = 0; i < n; i++) (stacks[i] > 1e-9 ? alive : busted).push(i);
  const perms = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms(arr.filter((_, j) => j !== i)).map(p => [x, ...p]));
  for (const order of perms(alive)) {
    let p = 1, left = alive.reduce((s, i) => s + stacks[i], 0);
    for (const i of order) { p *= stacks[i] / left; left -= stacks[i]; }
    order.forEach((i, place) => { out[i] += p * (payouts[place] || 0); });
  }
  busted.sort((a, b) => start[b] - start[a]);
  for (let k = 0; k < busted.length;) {
    let e = k + 1; while (e < busted.length && Math.abs(start[busted[e]] - start[busted[k]]) < 1e-9) e++;
    let pool = 0; for (let j = k; j < e; j++) pool += payouts[alive.length + j] || 0;
    for (let j = k; j < e; j++) out[busted[j]] = pool / (e - k);
    k = e;
  }
  return out;
}

function oracle(EM, cfg, sol) {
  if (cfg.n !== 3) throw Error('oracle is three-handed');
  const TB = EM.initPushFoldTables();
  const S = cfg.stacks, sb = cfg.sb ?? 0.5, bb = cfg.bb ?? 1, at = cfg.anteType || 'classic', aa = cfg.ante ?? 0.1;
  const ante = [0, 0, 0], blind = [0, sb, bb];
  if (at === 'classic') for (let p = 0; p < 3; p++) ante[p] = aa;
  if (at === 'bba') ante[2] = aa;
  const posted = ante.reduce((a, b) => a + b, 0) + sb + bb;
  const icm = cfg.model === 'icm';
  const util = new Map();
  const U = (v) => {
    if (!icm) return v;
    const key = v.map(x => x.toFixed(9)).join(',');
    let r = util.get(key);
    if (!r) { r = icmBrute(v, S, cfg.payouts); util.set(key, r); }
    return r;
  };
  const base = S.map((s, p) => s - ante[p] - blind[p]);
  const wins = (i) => { const v = base.slice(); v[i] += posted; return U(v); };
  const hu = (i, j) => { // outcome vectors when i jams and j calls: i wins, j wins, tie
    const m = Math.min(S[i] - ante[i], S[j] - ante[j]), pot = 2 * m + posted - blind[i] - blind[j];
    const mk = (si, sj) => { const v = base.slice(); v[i] = S[i] - ante[i] - m + si; v[j] = S[j] - ante[j] - m + sj; return U(v); };
    return [mk(pot, 0), mk(0, pot), mk(pot / 2, pot / 2)];
  };
  const VF = [wins(0), wins(1), wins(2)], H = { '01': hu(0, 1), '02': hu(0, 2), '12': hu(1, 2) };

  // exact class-triple deal counts with card removal
  const C1 = EM.C1, C2 = EM.C2, CLS = EM.CLS;
  const byCard = Array.from({ length: 52 }, () => new Int32Array(NC)); // combos of class c containing card x
  const pairClass = new Int16Array(52 * 52).fill(-1);
  for (let h = 0; h < 1326; h++) { byCard[C1[h]][CLS[h]]++; byCard[C2[h]][CLS[h]]++; pairClass[C1[h] * 52 + C2[h]] = pairClass[C2[h] * 52 + C1[h]] = CLS[h]; }
  const N3 = new Float64Array(NC * NC * NC), tot = EM.CLASS_NCOMBOS;
  const cnt = new Int32Array(NC);
  for (let h0 = 0; h0 < 1326; h0++) for (let h1 = 0; h1 < 1326; h1++) {
    const a = C1[h0], b = C2[h0], c = C1[h1], d = C2[h1];
    if (a === c || a === d || b === c || b === d) continue;
    const ba = byCard[a], bb2 = byCard[b], bc = byCard[c], bd = byCard[d];
    for (let k = 0; k < NC; k++) cnt[k] = tot[k] - ba[k] - bb2[k] - bc[k] - bd[k];
    const cards = [a, b, c, d];
    for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) { const k = pairClass[cards[x] * 52 + cards[y]]; if (k >= 0) cnt[k]++; }
    const row = (CLS[h0] * NC + CLS[h1]) * NC;
    for (let k = 0; k < NC; k++) N3[row + k] += cnt[k];
  }
  let deals = 0; for (let i = 0; i < N3.length; i++) deals += N3[i];

  const J0 = sol.jam[0].freq, J1 = sol.jam[1].freq, C01 = sol.call[0][1].freq, C02 = sol.call[0][2].freq, C12 = sol.call[1][2].freq;
  const W = TB.W, T = TB.T;
  const ev = [0, 0, 0];
  // action values per information set: [seat][decision][class][action]
  const A = { j0: new Float64Array(NC * 2), j1: new Float64Array(NC * 2), c01: new Float64Array(NC * 2), c02: new Float64Array(NC * 2), c12: new Float64Array(NC * 2) };
  const show = (key, x, y) => { // expected vector when the jammer holds class x and the caller class y
    const w = W[x * NC + y], t = T[x * NC + y], l = 1 - w - t, o = H[key];
    return [0, 1, 2].map(p => w * o[0][p] + l * o[1][p] + t * o[2][p]);
  };
  for (let x = 0; x < NC; x++) for (let y = 0; y < NC; y++) for (let z = 0; z < NC; z++) {
    const q = N3[(x * NC + y) * NC + z] / deals; if (!q) continue;
    const s01 = show('01', x, y), s02 = show('02', x, z), s12 = show('12', y, z);
    // after seat 0 jams and seat 1 folds
    const after01f = [0, 1, 2].map(p => C02[z] * s02[p] + (1 - C02[z]) * VF[0][p]);
    const jam0 = [0, 1, 2].map(p => C01[y] * s01[p] + (1 - C01[y]) * after01f[p]);
    const jam1 = [0, 1, 2].map(p => C12[z] * s12[p] + (1 - C12[z]) * VF[1][p]);
    const fold0 = [0, 1, 2].map(p => J1[y] * jam1[p] + (1 - J1[y]) * VF[2][p]);
    for (let p = 0; p < 3; p++) ev[p] += q * (J0[x] * jam0[p] + (1 - J0[x]) * fold0[p]);
    A.j0[x * 2 + 1] += q * jam0[0]; A.j0[x * 2] += q * fold0[0];
    const r1 = q * (1 - J0[x]);
    A.j1[y * 2 + 1] += r1 * jam1[1]; A.j1[y * 2] += r1 * VF[2][1];
    const r01 = q * J0[x];
    A.c01[y * 2 + 1] += r01 * s01[1]; A.c01[y * 2] += r01 * after01f[1];
    const r02 = q * J0[x] * (1 - C01[y]);
    A.c02[z * 2 + 1] += r02 * s02[2]; A.c02[z * 2] += r02 * VF[0][2];
    const r12 = q * (1 - J0[x]) * J1[y];
    A.c12[z * 2 + 1] += r12 * s12[2]; A.c12[z * 2] += r12 * VF[1][2];
  }
  // A seat acts at most once on any path, so its best response picks the better action in
  // each information set independently. Gain = (best - current) summed over its sets.
  const gainOf = (arr, freq) => { let g = 0; for (let h = 0; h < NC; h++) { const f = arr[h * 2], j = arr[h * 2 + 1]; g += Math.max(f, j) - (freq[h] * j + (1 - freq[h]) * f); } return g; };
  const gain = [gainOf(A.j0, J0), gainOf(A.j1, J1) + gainOf(A.c01, C01), gainOf(A.c02, C02) + gainOf(A.c12, C12)];
  return { ev, gain, best: ev.map((e, p) => e + gain[p]), deals };
}
module.exports = { oracle, icmBrute };
