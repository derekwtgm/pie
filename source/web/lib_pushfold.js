(function (EM) {
'use strict';
// Push/fold Nash solver for 2-8 players with blinds + antes, chip EV or ICM.
// Model: action folds to a player who jams or folds; each later player calls or folds;
// the first caller ends the action (all-ins are heads-up). Hand classes (169) with exact
// pairwise card removal from the exhaustive equity table.
const NC = 169;
let TB = null;
const POS8 = ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
function positions(n) { return n === 2 ? ['SB', 'BB'] : POS8.slice(8 - n); }

function initTables() {
  if (TB) return TB;
  const bin = atob(EM.EQ_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const u16 = new Uint16Array(bytes.buffer);
  const W = new Float64Array(NC * NC), T = new Float64Array(NC * NC);
  let k = 0;
  for (let a = 0; a < NC; a++) for (let b = a; b < NC; b++) {
    const w = u16[k++] / 65535, t = u16[k++] / 65535;
    W[a * NC + b] = w; T[a * NC + b] = t;
    if (a !== b) { W[b * NC + a] = Math.max(0, 1 - w - t); T[b * NC + a] = t; }
  }
  const N = new Int32Array(NC * NC);
  const C1 = EM.C1, C2 = EM.C2, CLS = EM.CLS;
  for (let h = 0; h < 1326; h++) {
    const a1 = C1[h], a2 = C2[h], row = CLS[h] * NC;
    for (let v = 0; v < 1326; v++) {
      const b1 = C1[v], b2 = C2[v];
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      N[row + CLS[v]]++;
    }
  }
  const combos = new Float64Array(NC), pi = new Float64Array(NC);
  for (let a = 0; a < NC; a++) { combos[a] = EM.CLASS_NCOMBOS[a]; pi[a] = combos[a] / 1326; }
  const MT = new Float64Array(NC * NC), MWT = new Float64Array(NC * NC), MTT = new Float64Array(NC * NC);
  for (let h = 0; h < NC; h++) for (let c = 0; c < NC; c++) {
    const m = N[h * NC + c] / (combos[h] * 1225);
    MT[c * NC + h] = m; MWT[c * NC + h] = m * W[h * NC + c]; MTT[c * NC + h] = m * T[h * NC + c];
  }
  // equity vs a random hand, used for "top x%" orderings
  const vsRandom = new Float64Array(NC);
  for (let a = 0; a < NC; a++) {
    let s = 0, d = 0;
    for (let b = 0; b < NC; b++) { s += N[a * NC + b] * (W[a * NC + b] + 0.5 * T[a * NC + b]); d += N[a * NC + b]; }
    vsRandom[a] = s / d;
  }
  TB = { W, T, N, combos, pi, MT, MWT, MTT, vsRandom };
  return TB;
}

function classEquity(a, b) { const t = initTables(); return t.W[a * NC + b] + 0.5 * t.T[a * NC + b]; }

function mv3(x, o1, o2, o3) {
  o1.fill(0); o2.fill(0); o3.fill(0);
  const MT = TB.MT, MWT = TB.MWT, MTT = TB.MTT;
  for (let c = 0; c < NC; c++) {
    const xc = x[c];
    if (xc < 1e-12) continue;
    const b = c * NC;
    for (let h = 0; h < NC; h++) { o1[h] += MT[b + h] * xc; o2[h] += MWT[b + h] * xc; o3[h] += MTT[b + h] * xc; }
  }
}

function PushFold(cfg) {
  initTables();
  const n = cfg.n | 0;
  if (n < 2 || n > 8) throw new Error('Choose 2 to 8 players');
  const S = Float64Array.from(cfg.stacks.slice(0, n));
  if (S.length !== n || S.some(x => !(x > 0))) throw new Error('Every seat needs a stack above 0');
  const sbAmt = cfg.sb == null ? 0.5 : +cfg.sb, bbAmt = cfg.bb == null ? 1 : +cfg.bb;
  const anteType = cfg.anteType || EM.MTT_ANTE.anteType, anteAmt = cfg.ante == null ? EM.MTT_ANTE.ante : +cfg.ante;
  const sbSeat = n - 2, bbSeat = n - 1;
  const ante = new Float64Array(n), blind = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    const bl = p === bbSeat ? bbAmt : p === sbSeat ? sbAmt : 0;
    if (anteType === 'classic') { ante[p] = Math.min(anteAmt, S[p]); blind[p] = Math.min(bl, S[p] - ante[p]); }
    else if (anteType === 'bba') { blind[p] = Math.min(bl, S[p]); ante[p] = p === bbSeat ? Math.min(anteAmt, S[p] - blind[p]) : 0; }
    else { blind[p] = Math.min(bl, S[p]); }
  }
  const pos = positions(n);
  for (let p = 0; p < n; p++) if (S[p] - ante[p] - blind[p] <= 1e-9)
    throw new Error(pos[p] + ' is all-in from posting. Give every seat more than blind + ante.');
  const L = new Float64Array(n);
  let sumAnte = 0, sumBlind = 0;
  for (let p = 0; p < n; p++) { L[p] = S[p] - ante[p]; sumAnte += ante[p]; sumBlind += blind[p]; }
  const base = new Float64Array(n);
  for (let p = 0; p < n; p++) base[p] = S[p] - ante[p] - blind[p];

  const icm = cfg.model === 'icm';
  const others = icm ? (cfg.others || []).filter(x => x > 0) : [];
  const payouts = icm ? (cfg.payouts || []).slice() : null;
  if (icm) {
    if (!payouts.length) throw new Error('Enter at least one payout');
    if (n + others.length > 16) throw new Error('ICM supports up to 16 players in total');
  }
  const startAll = icm ? [...S, ...others] : null;
  // bounties (ICM only, in payout units): busting a player pays share k of their bounty now (PKO 0.5, KO 1) and adds the
  // rest to the winner's own bounty; a player's own bounty is worth its amount times their chip share (their chance to win it)
  const BT = icm && cfg.bounty && cfg.bounty.b ? { k: cfg.bounty.kind === 'ko' ? 1 : 0.5, b: Float64Array.from(cfg.bounty.b.slice(0, n), x => +x || 0) } : null;
  if (BT && BT.b.some(x => x < 0)) throw new Error('Bounties cannot be negative');
  const TT = icm ? startAll.reduce((a, b) => a + b, 0) : 1;
  // Future-game simulation: value each end-of-hand stack vector by solving the next hand(s)
  // at the same blind level instead of applying ICM immediately (see lib_fgs.js).
  const fgsDepth = icm && cfg.fgs ? Math.max(0, Math.min(2, cfg.fgs.depth | 0)) : 0;
  const fgs = fgsDepth ? EM.makeFGS({ sb: sbAmt, bb: bbAmt, anteType, ante: anteAmt, payouts, others,
    depth: fgsDepth, iters: cfg.fgs.iters, cache: cfg.fgs.cache }) : null;
  if (fgsDepth > 1 && n > 4 && !cfg.fgs.cache) throw new Error('Two-hand future simulation is limited to 4 players or fewer; use one hand');
  let fgsDone = 0; const fgsTotal = n + 3 * n * (n - 1) / 2;
  function val(v, w = -1, l = -1) {
    if (!icm) return v;
    const e = fgs ? fgs.value(v, S) : EM.icmWithBusts([...v, ...others], startAll, payouts);
    if (fgs && cfg.fgs.onProgress) cfg.fgs.onProgress(++fgsDone, fgsTotal);
    const out = Float64Array.from(e.slice(0, n));
    if (BT) {
      const head = Float64Array.from(BT.b);
      if (w >= 0 && l >= 0 && v[l] <= 1e-9) { out[w] += BT.k * BT.b[l]; head[w] += (1 - BT.k) * BT.b[l]; head[l] = 0; }
      for (let p = 0; p < n; p++) out[p] += head[p] * v[p] / TT;
    }
    return out;
  }
  const VF = [];
  for (let i = 0; i < n; i++) { const v = base.slice(); v[i] += sumAnte + sumBlind; VF.push(val(v)); }
  const VS = [];
  for (let i = 0; i < n; i++) {
    VS.push([]);
    for (let j = 0; j < n; j++) {
      if (j <= i) { VS[i].push(null); continue; }
      const m = Math.min(L[i], L[j]);
      const pot = 2 * m + sumAnte + sumBlind - blind[i] - blind[j];
      const trip = [];
      for (let r = 0; r < 3; r++) {
        const v = base.slice();
        v[i] = S[i] - ante[i] - m; v[j] = S[j] - ante[j] - m;
        if (r === 0) v[i] += pot; else if (r === 1) v[j] += pot; else { v[i] += pot / 2; v[j] += pot / 2; }
        trip.push(r === 0 ? val(v, i, j) : r === 1 ? val(v, j, i) : val(v));
      }
      VS[i].push(trip);
    }
  }

  // decisions
  const dec = [];
  const jamDec = [], callDec = [];
  const mk = (type, i, j) => ({ type, i, j, r0: new Float64Array(NC), r1: new Float64Array(NC),
    s0: new Float64Array(NC), s1: new Float64Array(NC), cur: new Float64Array(NC).fill(0.5), avg: new Float64Array(NC).fill(0.5) });
  for (let i = 0; i < n - 1; i++) { const d = mk('jam', i, -1); jamDec[i] = d; dec.push(d); callDec[i] = []; }
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) { const d = mk('call', i, j); callDec[i][j] = d; dec.push(d); }

  // buffers
  const F64 = () => new Float64Array(NC);
  const RJ = [], WJ = [], TJ = [], PC = [], EW = [], ET = [], EVJ = [], EVC = [], EVFc = [];
  for (let i = 0; i < n - 1; i++) {
    RJ.push(F64()); WJ.push(F64()); TJ.push(F64()); EVJ.push(F64());
    PC.push([]); EW.push([]); ET.push([]); EVC.push([]); EVFc.push([]);
    for (let j = 0; j < n; j++) {
      const ok = j > i;
      PC[i].push(ok ? F64() : null); EW[i].push(ok ? F64() : null); ET[i].push(ok ? F64() : null);
      EVC[i].push(ok ? F64() : null); EVFc[i].push(ok ? F64() : null);
    }
  }
  const Pjam = new Float64Array(n), R = new Float64Array(n);
  const Fr = Array.from({ length: n }, () => new Float64Array(n + 1));
  const FV = new Float64Array(n);
  const FVC = Array.from({ length: n }, () => new Float64Array(n));
  const Eacc = Array.from({ length: n }, () => Array.from({ length: n + 1 }, () => new Float64Array(n)));
  const after = Array.from({ length: n }, () => new Float64Array(n));
  const tmp = new Float64Array(n);
  const pcU = new Float64Array(n + 1);

  function compute(useAvg) {
    const pi = TB.pi;
    for (let i = 0; i < n - 1; i++) {
      const Ji = useAvg ? jamDec[i].avg : jamDec[i].cur;
      mv3(Ji, RJ[i], WJ[i], TJ[i]);
      let pj = 0; for (let c = 0; c < NC; c++) pj += pi[c] * Ji[c];
      Pjam[i] = pj;
      for (let j = i + 1; j < n; j++) mv3(useAvg ? callDec[i][j].avg : callDec[i][j].cur, PC[i][j], EW[i][j], ET[i][j]);
    }
    R[0] = 1; for (let i = 1; i < n - 1; i++) R[i] = R[i - 1] * (1 - Pjam[i - 1]);
    for (let i = 0; i < n - 1; i++) {
      const Ji = useAvg ? jamDec[i].avg : jamDec[i].cur;
      for (let j0 = i + 1; j0 <= n; j0++) Eacc[i][j0].fill(0);
      pcU.fill(0);
      let wsum = 0;
      for (let c = 0; c < NC; c++) {
        const wgt = pi[c] * (Ji[c] + 1e-9);
        wsum += wgt;
        tmp.set(VF[i]);
        let acc = Eacc[i][n]; for (let p = 0; p < n; p++) acc[p] += wgt * tmp[p];
        for (let j0 = n - 1; j0 > i; j0--) {
          const pc = PC[i][j0][c], ew = EW[i][j0][c], et = ET[i][j0][c], el = pc - ew - et, nf = 1 - pc;
          const vw = VS[i][j0][0], vl = VS[i][j0][1], vt = VS[i][j0][2];
          for (let p = 0; p < n; p++) tmp[p] = ew * vw[p] + et * vt[p] + el * vl[p] + nf * tmp[p];
          acc = Eacc[i][j0]; for (let p = 0; p < n; p++) acc[p] += wgt * tmp[p];
          pcU[j0] += wgt * pc;
        }
        EVJ[i][c] = tmp[i];
      }
      for (let j0 = i + 1; j0 <= n; j0++) { const a = Eacc[i][j0]; for (let p = 0; p < n; p++) a[p] /= wsum; }
      Fr[i][i + 1] = 1;
      for (let j = i + 1; j < n; j++) { FVC[i][j] = Eacc[i][j + 1][j]; Fr[i][j + 1] = Fr[i][j] * (1 - pcU[j] / wsum); }
    }
    after[n - 2].set(VF[n - 1]);
    for (let k = n - 2; k >= 1; k--) {
      const a = after[k - 1], e = Eacc[k][k + 1], b = after[k], pj = Pjam[k];
      for (let p = 0; p < n; p++) a[p] = pj * e[p] + (1 - pj) * b[p];
    }
    for (let i = 0; i < n - 1; i++) FV[i] = after[i][i];
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      const vJ = VS[i][j][1][j], vT = VS[i][j][2][j], vI = VS[i][j][0][j], fv = FVC[i][j];
      const ec = EVC[i][j], ef = EVFc[i][j], rj = RJ[i], wj = WJ[i], tj = TJ[i];
      for (let h = 0; h < NC; h++) { ec[h] = wj[h] * vJ + tj[h] * vT + (rj[h] - wj[h] - tj[h]) * vI; ef[h] = rj[h] * fv; }
    }
  }

  const ALPHA = 1.5, GAMMA = 2; // DCFR on the 169-class push/fold game
  let t = 0;
  function updateDecision(d, q1, q0, scale, pd, sd) {
    const cur = d.cur, r0 = d.r0, r1 = d.r1, s0 = d.s0, s1 = d.s1;
    for (let h = 0; h < NC; h++) {
      const a = q1(h) * scale, b = q0(h) * scale, s = cur[h];
      const v = s * a + (1 - s) * b;
      let x = r1[h]; r1[h] = (x > 0 ? x * pd : x * 0.5) + (a - v);
      x = r0[h]; r0[h] = (x > 0 ? x * pd : x * 0.5) + (b - v);
      s1[h] = s1[h] * sd + s; s0[h] = s0[h] * sd + (1 - s);
    }
  }
  function regretMatch() {
    for (const d of dec) {
      const cur = d.cur, r0 = d.r0, r1 = d.r1;
      for (let h = 0; h < NC; h++) {
        const a = r1[h] > 0 ? r1[h] : 0, b = r0[h] > 0 ? r0[h] : 0, s = a + b;
        cur[h] = s > 0 ? a / s : 0.5;
      }
    }
  }
  function refreshAvg() {
    for (const d of dec) {
      const s0 = d.s0, s1 = d.s1, avg = d.avg;
      for (let h = 0; h < NC; h++) { const s = s0[h] + s1[h]; avg[h] = s > 0 ? s1[h] / s : 0.5; }
    }
  }
  function iterate(k) {
    for (let it = 0; it < k; it++) {
      t++;
      regretMatch();
      compute(false);
      const ta = Math.pow(t, ALPHA), pd = ta / (ta + 1), sd = Math.pow((t - 1) / t, GAMMA);
      for (let i = 0; i < n - 1; i++) {
        const ev = EVJ[i], fv = FV[i];
        updateDecision(jamDec[i], h => ev[h], () => fv, R[i], pd, sd);
      }
      for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
        const ec = EVC[i][j], ef = EVFc[i][j];
        updateDecision(callDec[i][j], h => ec[h], h => ef[h], R[i] * Fr[i][j], pd, sd);
      }
    }
    refreshAvg();
  }
  // per-player gain from best-responding to the average profile (per hand dealt)
  function exploitability() {
    refreshAvg();
    compute(true);
    const pi = TB.pi, gains = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) {
      const s = jamDec[i].avg, ev = EVJ[i], fv = FV[i];
      let g = 0;
      for (let h = 0; h < NC; h++) { const a = ev[h], b = fv; g += pi[h] * (Math.max(a, b) - (s[h] * a + (1 - s[h]) * b)); }
      gains[i] += R[i] * g;
    }
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      const s = callDec[i][j].avg, ec = EVC[i][j], ef = EVFc[i][j];
      let g = 0;
      for (let h = 0; h < NC; h++) { const a = ec[h], b = ef[h]; g += pi[h] * (Math.max(a, b) - (s[h] * a + (1 - s[h]) * b)); }
      gains[j] += R[i] * Fr[i][j] * g;
    }
    let mx = 0; for (const g of gains) mx = Math.max(mx, g);
    return { gains, max: mx };
  }
  // scale for convergence targets: bb in chip mode, prize pool share in ICM mode
  const unitScale = icm ? payouts.reduce((a, b) => a + b, 0) : 1;

  function solve(opts = {}) {
    const maxIter = opts.maxIter || 4000, tol = opts.tol == null ? 2e-5 : opts.tol;
    let ex = null;
    while (t < maxIter) {
      iterate(50);
      ex = exploitability();
      if (opts.onProgress) opts.onProgress(t, ex.max / unitScale);
      if (ex.max / unitScale < tol) break;
    }
    return ex;
  }

  // results based on the average strategy
  function results() {
    refreshAvg();
    compute(true);
    const out = { n, positions: pos, model: icm ? 'icm' : 'chip', iterations: t, jam: [], call: [] };
    const pct = f => { let s = 0; for (let h = 0; h < NC; h++) s += TB.pi[h] * f[h]; return s * 100; };
    for (let i = 0; i < n - 1; i++) {
      const freq = Float64Array.from(jamDec[i].avg), ev = new Float64Array(NC);
      for (let h = 0; h < NC; h++) ev[h] = EVJ[i][h] - FV[i];
      out.jam.push({ seat: i, freq, ev, pct: pct(freq), reach: R[i], foldValue: FV[i] });
    }
    for (let i = 0; i < n - 1; i++) {
      out.call.push([]);
      for (let j = 0; j < n; j++) {
        if (j <= i) { out.call[i].push(null); continue; }
        const freq = Float64Array.from(callDec[i][j].avg), ev = new Float64Array(NC);
        for (let h = 0; h < NC; h++) { const r = RJ[i][h]; ev[h] = r > 1e-12 ? (EVC[i][j][h] - EVFc[i][j][h]) / r : 0; }
        out.call[i].push({ jammer: i, seat: j, freq, ev, pct: pct(freq), reach: R[i] * Pjam[i] * Fr[i][j] });
      }
    }
    const ex = exploitability();
    out.exploit = ex.max; out.exploitRel = ex.max / unitScale; out.unitScale = unitScale;
    out.posted = { ante: Array.from(ante), blind: Array.from(blind) };
    return out;
  }

  // Load a known strategy profile (e.g. precomputed) and evaluate EVs only.
  function load(profile) {
    for (let i = 0; i < n - 1; i++) jamDec[i].s1.set(profile.jam[i]), jamDec[i].s0.set(profile.jam[i].map(x => 1 - x));
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      const f = profile.call[i][j]; callDec[i][j].s1.set(f); callDec[i][j].s0.set(f.map(x => 1 - x));
    }
  }

  // expected value of every seat under the average profile (chips, or prize units in ICM mode)
  function values() {
    refreshAvg();
    compute(true);
    const out = new Float64Array(n), e = Eacc[0][1], f = after[0], pj = Pjam[0];
    for (let p = 0; p < n; p++) out[p] = pj * e[p] + (1 - pj) * f[p];
    return out;
  }

  return { iterate, exploitability, solve, results, load, values, positions: pos, fgsDepth, get iterations() { return t; } };
}

Object.assign(EM, { initPushFoldTables: initTables, PushFold, pfPositions: positions, classEquity });
})(globalThis.EM || (globalThis.EM = {}));
