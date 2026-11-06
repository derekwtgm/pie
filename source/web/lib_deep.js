(function (EM) {
'use strict';
// Preflop game-tree model for MTTs: 2-8 players, 10-100bb+ (approximate).
// Tree: first-in players fold, raise or (when shallow) jam. Facing a raise, players fold, call, raise to the
// next level or jam. Levels: open, 3-bet (a squeeze when someone has called), 4-bet, 5-bet all-in.
// At most three players enter a pot, and players who haven't put money in voluntarily fold to 3-bets.
// Preflop is solved with vector CFR over the 169 hand classes, with pairwise card removal. Pots that end
// without an all-in are valued with an equity-realization model (position, playability, stack-to-pot
// ratio) instead of a postflop solve; all-ins use exact heads-up equities; three-way pots combine the
// pairwise results.
const NC = 169;
const FOLD = 0, CALL = 1, RAISE = 2, JAM = 3;
const TRAIN = 0, REC = 1, EXPL = 2;
const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Playability features of a hand class (index 0 = ace): pair, suited, suited ace, connector,
// one-gapper, two-gapper, disconnected offsuit (grows with the gap), weak offsuit kicker, offsuit
// with no card above ten.
const BONUS_DEFAULT = [0.12, 0.22, 0.06, 0.12, 0.07, 0.03, -0.08, -0.06, -0.05];   // 2.4 hand-tuned
const BONUS_FIT = [0.242, 0.158, -0.022, 0.081, 0.072, 0.068, 0.056, -0.08, 0.181]; // fitted to flop solves
function playFeatures(k) {
  const r = (k / 13) | 0, c = k % 13, f = new Float64Array(9);
  if (r === c) { f[0] = 1; return f; }
  const hi = Math.min(r, c), lo = Math.max(r, c), suited = r < c, gap = lo - hi - 1;
  if (suited) { f[1] = 1; if (hi === 0) f[2] = 1; }
  if (gap === 0) f[3] = 1; else if (gap === 1) f[4] = 1; else if (gap === 2) f[5] = 1;
  if (!suited) { if (gap >= 3) f[6] = 1 + 0.5 * Math.min(5, gap - 3); if (lo >= 8) f[7] = lo - 7; if (hi >= 4) f[8] = 1; }
  return f;
}
function playBonus(k, w = BONUS_DEFAULT) {
  // how well a hand plays postflop beyond its raw equity (logit units at full depth)
  const f = playFeatures(k); let b = 0;
  for (let i = 0; i < 9; i++) b += f[i] * w[i];
  return b;
}
const f1 = (x) => (Math.round(x * 10) / 10).toString();

function defaultSizes(S) {
  return { open: S <= 30 ? 2 : S <= 60 ? 2.2 : 2.3, sbOpen: 3, iso: S <= 30 ? 3 : 3.5, threeBetIP: S <= 40 ? 2.75 : 3, threeBetOOP: S <= 40 ? 3.5 : 4, fourBet: 2.3 };
}

function DeepTree(cfg) {
  const TB = EM.initPushFoldTables();
  const n = cfg.n | 0;
  if (n < 2 || n > 8) throw new Error('Choose 2 to 8 players');
  // stacks: one depth for everyone, or one per seat (used with ICM)
  const ST = Float64Array.from({ length: n }, (_, p) => cfg.stacks && cfg.stacks[p] != null ? +cfg.stacks[p] : +cfg.stack);
  if (ST.some(x => !(x >= 5 && x <= 250))) throw new Error('Stacks must be between 5 and 250bb');
  const S = cfg.stacks ? ST.reduce((a, b) => a + b, 0) / n : +cfg.stack;   // table depth for default sizes
  const sbSeat = n - 2, bbSeat = n - 1;
  const anteType = cfg.anteType || EM.MTT_ANTE.anteType, anteAmt = cfg.ante == null ? EM.MTT_ANTE.ante : +cfg.ante;
  const dead = new Float64Array(n), blind = new Float64Array(n), L = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    const bl = p === bbSeat ? 1 : p === sbSeat ? 0.5 : 0;
    if (anteType === 'classic') { dead[p] = Math.min(anteAmt, ST[p]); blind[p] = Math.min(bl, ST[p] - dead[p]); }
    else if (anteType === 'bba') { blind[p] = Math.min(bl, ST[p]); dead[p] = p === bbSeat ? Math.min(anteAmt, ST[p] - blind[p]) : 0; }
    else blind[p] = Math.min(bl, ST[p]);
    L[p] = ST[p] - dead[p];            // chips that can be bet
  }
  // effective depth for jam options: your stack or the biggest other stack, whichever is smaller
  const effS = Float64Array.from({ length: n }, (_, x) => { let m = 0; for (let y = 0; y < n; y++) if (y !== x) m = Math.max(m, ST[y]); return Math.min(ST[x], m); });
  const pos = EM.pfPositions(n);
  const isBlind = (x) => x === sbSeat || x === bbSeat;
  const postOrder = (s) => EM.postflopOrder(s, n);
  const D = defaultSizes(S);
  const sz = {
    open: +cfg.open || D.open, sbOpen: +cfg.sbOpen || D.sbOpen, iso: +cfg.iso || D.iso,
    m3ip: +cfg.threeBetIP || D.threeBetIP, m3oop: +cfg.threeBetOOP || D.threeBetOOP, m4: +cfg.fourBet || D.fourBet
  };
  const openJamMax = cfg.openJamMax != null ? +cfg.openJamMax : 30;
  const threeJamMax = cfg.threeJamMax != null ? +cfg.threeJamMax : 50;
  const GAMMA = cfg.gamma || 3;
  const MAXIN = 3, RAISECAP = 0.45, flatCall = cfg.flatCall !== false, flatRaise = cfg.flatRaise === true, sbLimp = cfg.sbLimp !== false;
  // realization model parameters, fitted (2.5) to EightMax's own postflop solves: 80 flop solves
  // (20 stratified flops x BTN-vs-BB and SB-vs-BB single-raised pots at 25bb and 60bb, 0.5% pot
  // exploitability), least squares on each hand class's pot share. Out-of-sample error on held-out
  // flops fell 14-19% against the 2.4 hand-tuned values (delta .05, aK .6, gK 2.2, kDeep .1, agg 0).
  const RZ = Object.assign({ delta: 0.055, aK: 0.272, gK: 2.233, kDeep: 0.113, agg: 0.041, kRef: 4.5, mK: 0.142, bonus: BONUS_FIT }, cfg.realization || {});
  // ICM payoffs (payout units): prize equity of every seat at each terminal, with players at other tables included
  const ICM = cfg.icm && cfg.icm.payouts && cfg.icm.payouts.length ? { payouts: cfg.icm.payouts.map(Number), others: (cfg.icm.others || []).map(Number).filter(x => x > 0) } : null;
  if (ICM && n + ICM.others.length > 16) throw new Error('ICM supports up to 16 players in total');

  // ---------------- tree ----------------
  const nodes = [];
  const potOf = (cb) => { let s = 0; for (let p = 0; p < n; p++) s += dead[p] + cb[p]; return s; };
  const clone = (st) => ({ acted: st.acted.slice(), fullRaise: st.fullRaise, cb: Float64Array.from(st.cb), inH: Uint8Array.from(st.inH), need: Uint8Array.from(st.need), vol: st.vol.slice(), flat: st.flat.slice(), lvl: st.lvl, bet: st.bet, agg: st.agg });
  function nextActor(st, last) {
    for (let k = 1; k <= n; k++) {
      const x = (last + k + n) % n;
      if (!st.inH[x] || !st.need[x] || st.cb[x] >= L[x] - 1e-9) continue;
      if (st.cb[x] < st.bet - 1e-9 || st.inH.some((v, p) => v && p !== x && st.cb[p] < L[p] - 1e-9)) return x;
    }
    return -1;
  }
  const kOf = (spr) => (spr <= RZ.kRef ? spr / RZ.kRef : 1 + RZ.kDeep * Math.log(spr / RZ.kRef));
  function build(st, last, line) {
    for (;;) {
      let inCount = 0; for (let p = 0; p < n; p++) inCount += st.inH[p];
      if (inCount === 1) {
        const w = st.inH.indexOf(1), nd = { type: 1, w, cb: Float64Array.from(st.cb), line };
        nd.pot = potOf(nd.cb); nd.id = nodes.length; nodes.push(nd); return nd.id;
      }
      const x = nextActor(st, last);
      if (x < 0) return mkShow(st, line);
      const isVol = st.vol.includes(x);
      // uninvolved players fold to 3-bets and to full pots; cold-callers fold to squeezes
      if (st.lvl >= 1 && ((!isVol && (st.lvl >= 2 || st.vol.length >= MAXIN)) || (st.lvl >= 2 && st.flat.includes(x) && !flatCall))) {
        const ns = clone(st); ns.inH[x] = 0; ns.need[x] = 0; ns.vol = ns.vol.filter(y => y !== x); ns.flat = ns.flat.filter(y => y !== x);
        if (!isVol) { st = ns; last = x; continue; }
        // a cold-caller folding to a squeeze: keep a pass-through node so its result is booked
        const nd = { type: 3, x, cb: Float64Array.from(st.cb), vol: st.vol.slice(), line };
        nd.pot = potOf(nd.cb); nd.id = nodes.length; nodes.push(nd);
        nd.child = build(ns, x, line.concat([{ x, kind: FOLD, label: 'Fold', auto: true }]));
        return nd.id;
      }
      return mkDecision(st, x, line);
    }
  }
  function mkShow(st, line) {
    const P = []; for (let p = 0; p < n; p++) if (st.inH[p]) P.push(p);
    const cb = Float64Array.from(st.cb);
    const paid = Array.from({length: n}, (_, p) => p).sort((a, b) => cb[b] - cb[a]);
    if (cb[paid[0]] > cb[paid[1]]) cb[paid[0]] = cb[paid[1]];
    const behind = Array.from(cb, (v, p) => Math.max(0, L[p] - v));
    const left = P.map(p => behind[p]).sort((a,b) => b-a)[1];
    const allIn = left <= 1e-9;
    const pot = potOf(cb), spr = left / pot;
    const pots = EM.potLayers(cb, st.inH, dead.reduce((a,b) => a+b, 0));
    const nd = { type: 2, players: P, cb, behind, pots, pot, allIn, spr, kb: Math.round(kOf(spr) / 0.05), agg: st.agg, line };
    nd.id = nodes.length; nodes.push(nd); return nd.id;
  }
  function mkDecision(st, x, line) {
    const nd = { type: 0, x, acts: [], cb: Float64Array.from(st.cb), vol: st.vol.slice(), lvl: st.lvl, bet: st.bet, line };
    nd.pot = potOf(nd.cb); nd.id = nodes.length; nodes.push(nd);
    const isVol = st.vol.includes(x), left = L[x];
    nd.toCall = Math.max(0, Math.min(st.bet, left) - st.cb[x]);
    let A = [{ kind: FOLD, to: st.cb[x], label: 'Fold' }];
    if (st.lvl === 0 && x === bbSeat && st.vol.length === 1) {
      // the small blind limped: check, isolate or jam
      A = [{ kind: CALL, to: st.bet, label: 'Check' }];
      let jamOk = effS[x] <= openJamMax;
      if (sz.iso <= RAISECAP * left && sz.iso > st.bet) A.push({ kind: RAISE, to: sz.iso, label: 'Raise ' + f1(sz.iso) }); else jamOk = true;
      if (jamOk) A.push({ kind: JAM, to: left, label: 'All-in ' + f1(left) });
    } else if (st.lvl === 0) {
      const O = x === sbSeat && n > 2 ? sz.sbOpen : sz.open;
      let jamOk = effS[x] <= openJamMax;
      if (x === sbSeat && sbLimp && st.bet > st.cb[x]) A.push({ kind: CALL, to: st.bet, label: 'Limp' });
      if (O <= RAISECAP * left && O > st.bet) A.push({ kind: RAISE, to: O, label: 'Raise ' + f1(O) }); else jamOk = true;
      if (jamOk) A.push({ kind: JAM, to: left, label: 'All-in ' + f1(left) });
    } else {
      // calls: anyone already in, a single cold-caller, or the big blind closing a three-way pot
      if (isVol || st.vol.length === 1 || (x === bbSeat && st.lvl === 1 && st.vol.length < MAXIN)) A.push({ kind: CALL, to: Math.min(st.bet, left), label: st.bet >= left - 1e-9 ? 'Call all-in' : 'Call ' + f1(nd.toCall) });
      if (st.bet < left - 1e-9 && !(st.lvl >= 2 && st.flat.includes(x) && !flatRaise)) {
        let R = null, jamOk = false, name = '';
        if (st.lvl === 1) { const callers = st.vol.filter(y => y !== x && y !== st.agg).length; R = st.bet * ((isBlind(x) ? sz.m3oop : sz.m3ip) + callers); jamOk = effS[x] <= threeJamMax; name = callers ? 'Squeeze' : '3-bet'; }
        else if (st.lvl === 2) { R = st.bet * sz.m4; jamOk = left <= 10 * st.bet; name = '4-bet'; }
        else jamOk = true;
        if (R != null) { if (R <= RAISECAP * left) A.push({ kind: RAISE, to: R, label: name + ' ' + f1(R) }); else jamOk = true; }
        if (jamOk) A.push({ kind: JAM, to: left, label: 'All-in ' + f1(left) });
      }
    }
    const canRaise = EM.raiseIsOpen(st.acted[x], st.bet, st.fullRaise) &&
      st.inH.some((v,p) => p !== x && v && L[p] > st.bet + 1e-9);
    A = A.filter(a => a.kind < RAISE || (canRaise && a.to > st.bet + 1e-9));
    for (const a of A) if (a.kind === RAISE) {
      a.to = Math.min(left, Math.max(a.to, st.bet + st.fullRaise));
      if (a.to >= left - 1e-9) { a.kind = JAM; a.label = 'All-in ' + f1(left); }
      else a.label = a.label.split(' ')[0] + ' ' + f1(a.to);
    }
    A = A.filter((a, i) => !A.slice(0,i).some(b => b.kind === a.kind && Math.abs(b.to - a.to) < 1e-9));
    nd.acts = A;
    for (const a of A) {
      const ns = clone(st); ns.need[x] = 0;
      if (a.kind === FOLD) { ns.inH[x] = 0; ns.vol = ns.vol.filter(y => y !== x); ns.flat = ns.flat.filter(y => y !== x); }
      else {
        ns.cb[x] = a.to; if (!isVol) ns.vol.push(x);
        if (a.kind === CALL && st.lvl === 1 && !isVol) ns.flat.push(x); else if (a.kind !== CALL) ns.flat = ns.flat.filter(y => y !== x);
        ns.acted[x] = a.to;
        if (a.to > st.bet + 1e-9) { ns.fullRaise = Math.max(st.fullRaise, a.to - st.bet); ns.bet = a.to; ns.lvl = st.lvl + 1; ns.agg = x; for (let y = 0; y < n; y++) if (y !== x && ns.inH[y]) ns.need[y] = 1; }
      }
      a.child = build(ns, x, line.concat([{ x, kind: a.kind, label: a.label }]));
    }
    return nd.id;
  }
  if (ST.some((v,p) => v <= dead[p] + blind[p] + 1e-9)) throw new Error('For the preflop model every seat must have chips behind after posting.');
  const st0 = { acted: new Float64Array(n).fill(-1), fullRaise: 1, cb: Float64Array.from(blind), inH: new Uint8Array(n).fill(1), need: new Uint8Array(n).fill(1), vol: [], flat: [], lvl: 0, bet: Math.max(...blind), agg: -1 };
  build(st0, -1, []);
  const decs = nodes.filter(d => d.type === 0);
  for (const d of decs) {
    const m = d.acts.length * NC;
    d.R = new Float64Array(m); d.SS = new Float64Array(m); d.cur = new Float64Array(m).fill(1 / d.acts.length); d.avg = Float64Array.from(d.cur);
  }

  // Every weak ranking of three seats, including ties for first, ties for second and a board chop.
  const orders = [[2,1,0],[2,0,1],[1,2,0],[0,2,1],[1,0,2],[0,1,2],
    [1,1,0],[1,0,1],[0,1,1],[0,0,1],[0,1,0],[1,0,0],[0,0,0]];
  const pairs = [[0,1],[0,2],[1,2]];
  const relations = orders.map(row => pairs.map(([i,j]) => 1 + Math.sign(row[i] - row[j])));
  let icmScale = 1;
  if (ICM) {
    const start = [...ST, ...ICM.others], chips = start.reduce((a, b) => a + b, 0);
    icmScale = ICM.payouts.reduce((a,b) => a+b, 0) / chips;
    if (!(icmScale > 0)) throw new Error('Enter a positive prize pool');
    const cache = new Map();
    const icmOf = fin => {
      const key = fin.join(',');
      if (!cache.has(key)) cache.set(key, Float64Array.from(EM.icmWithBusts([...fin, ...ICM.others], start, ICM.payouts).slice(0,n)));
      return cache.get(key);
    };
    for (const nd of nodes) {
      if (nd.type === 1) {
        const f = Float64Array.from({length:n}, (_, p) => L[p] - nd.cb[p]);
        f[nd.w] += nd.pot; nd.U = icmOf(f);
      } else if (nd.type === 2) {
        const scores = new Float64Array(n);
        const outcome = order => {
          nd.players.forEach((p,i) => { scores[p] = order[i]; });
          return icmOf(EM.awardPots(nd.pots, scores, nd.behind));
        };
        if (nd.players.length === 2) {
          nd.UW = { [nd.players[0]]: outcome([1,0]), [nd.players[1]]: outcome([0,1]) };
          nd.UT = outcome([0,0]);
        } else nd.orderU = orders.map(outcome);
      }
    }
  }

  // ---------------- payoff matrices ----------------
  const MT = TB.MT, W = TB.W, T = TB.T, pi = TB.pi;
  const MEQT = new Float64Array(NC * NC);
  for (let k = 0; k < NC * NC; k++) MEQT[k] = TB.MWT[k] + 0.5 * TB.MTT[k];
  const bonus = Float64Array.from({ length: NC }, (_, k) => playBonus(k, RZ.bonus || BONUS_DEFAULT));
  const LG = new Float64Array(NC * NC);
  for (let h = 0; h < NC; h++) for (let y = 0; y < NC; y++) {
    const eq = Math.min(0.999, Math.max(0.001, W[h * NC + y] + 0.5 * T[h * NC + y]));
    LG[h * NC + y] = Math.log(eq / (1 - eq));
  }
  const shareCache = new Map();
  function shareMat(kb, ip, ag, lev = false) {
    // transposed: A[y*NC+h] = P(y|h) * share of the player holding h against y
    // ip: holder of h acts last postflop; ag: +1 holder was the last raiser, -1 the opponent was
    // lev: heads-up chip pots only. Postflop betting lets a hand win more than the pot (or lose
    // part of its stack), so the share spans [-m, 1+m] with m growing with stack-to-pot ratio.
    // The two players' shares still add up to the pot. ICM and three-way pots need a win
    // probability, so they use the plain [0, 1] share.
    const m = lev ? RZ.mK * kb * 0.05 : 0;
    const key = ((kb * 2 + (ip ? 1 : 0)) * 3 + (ag + 1)) * 2 + (m > 0 ? 1 : 0);
    let A = shareCache.get(key);
    if (A) return A;
    const k = kb * 0.05, a = 1 + RZ.aK * k, shift = (ip ? 1 : -1) * RZ.delta * 2.9 * k + ag * RZ.agg * k, gam = RZ.gK * k;
    A = new Float64Array(NC * NC);
    for (let h = 0; h < NC; h++) for (let y = 0; y < NC; y++) {
      const lg = a * LG[h * NC + y] + shift + gam * (bonus[h] - bonus[y]);
      A[y * NC + h] = MT[y * NC + h] * ((1 + 2 * m) / (1 + Math.exp(-lg)) - m);
    }
    shareCache.set(key, A);
    return A;
  }
  const ONES = new Float64Array(NC).fill(1);
  function mv(AT, x, o) {
    o = o || new Float64Array(NC);
    o.fill(0);
    for (let y = 0; y < NC; y++) { const xv = x[y]; if (!(xv > 1e-14)) continue; const b = y * NC; for (let h = 0; h < NC; h++) o[h] += AT[b + h] * xv; }
    return o;
  }
  // per-node scratch so the recursion allocates nothing (each node is visited once per pass)
  function bufs(nd) {
    if (nd.B) return nd.B;
    const nA = nd.type === 0 ? nd.acts.length : 0, B = { out: new Array(n).fill(null), V: [], ex: new Float64Array(n) };
    for (let p = 0; p < n; p++) B.V.push(new Float64Array(NC));
    if (nd.type === 0) { B.nr = []; B.R2 = []; for (let a = 0; a < nA; a++) { B.nr.push(new Float64Array(NC)); B.R2.push(new Float64Array(NC)); } B.env2 = new Float64Array(NC); B.cf = new Float64Array(NC); B.Vx = new Float64Array(NC); B.va = new Float64Array(NC); B.VA = new Array(nA); }
    if (nd.type === 2) { B.t = new Float64Array(NC); B.sh = new Map(); }
    if (nd.type === 3) B.env2 = new Float64Array(NC);
    nd.B = B; return B;
  }

  // ---------------- CFR ----------------
  let t = 0, pd = 1, sd = 1, gain = 0;
  function showVals(nd, reach, Rv, env) {
    const B = bufs(nd), out = B.out, P = nd.players, pot = nd.pot;
    out.fill(null);
    const matFor = (a, b, lev) => (nd.allIn || nd.behind[a] < 1e-9 || nd.behind[b] < 1e-9 ? MEQT : shareMat(nd.kb, postOrder(a) > postOrder(b), nd.agg === a ? 1 : nd.agg === b ? -1 : 0, lev));
    if (P.length === 2) {
      for (let s = 0; s < 2; s++) {
        const a = P[s], b = P[1 - s], tv = mv(matFor(a, b, true), reach[b] || ONES, B.t), Rb = Rv[b] || ONES, base = ST[a] - dead[a] - nd.cb[a];
        const v = B.V[a];
        for (let h = 0; h < NC; h++) v[h] = env[h] * (base * Rb[h] + pot * tv[h]);
        out[a] = v;
      }
      return out;
    }
    const sh = new Map(), sbar = new Map();
    for (const a of P) for (const b of P) if (a !== b) {
      const tv = mv(matFor(a, b), reach[b] || ONES, B.t), Rb = Rv[b] || ONES;
      let s = B.sh.get(a * 8 + b); if (!s) { s = new Float64Array(NC); B.sh.set(a * 8 + b, s); }
      for (let h = 0; h < NC; h++) s[h] = Rb[h] > 1e-12 ? tv[h] / Rb[h] : 0.5;
      sh.set(a * 8 + b, s);
    }
    for (const a of P) for (const b of P) if (a !== b) {
      const ra = reach[a] || ONES, s = sh.get(a * 8 + b); let num = 0, den = 0;
      for (let h = 0; h < NC; h++) { const w = pi[h] * ra[h]; num += w * s[h]; den += w; }
      sbar.set(a * 8 + b, den > 0 ? num / den : 0.5);
    }
    for (const a of P) {
      const [b, c] = P.filter(y => y !== a);
      const sab = sh.get(a * 8 + b), sac = sh.get(a * 8 + c), gbc = sbar.get(b * 8 + c), gcb = sbar.get(c * 8 + b);
      const Rb = Rv[b] || ONES, Rc = Rv[c] || ONES, base = ST[a] - dead[a] - nd.cb[a], v = B.V[a];
      let main = 0, againstB = 0, againstC = 0, guaranteed = 0;
      for (const layer of nd.pots) if (layer.eligible.includes(a)) {
        if (layer.eligible.length === 3) main += layer.amount;
        else if (layer.eligible.length === 1) guaranteed += layer.amount;
        else if (layer.eligible.includes(b)) againstB += layer.amount;
        else againstC += layer.amount;
      }
      for (let h = 0; h < NC; h++) {
        const f = sab[h] * sac[h], s3 = f / Math.max(1e-12, f + (1 - sab[h]) * gbc + (1 - sac[h]) * gcb);
        const won = guaranteed + main * s3 + againstB * sab[h] + againstC * sac[h];
        v[h] = env[h] * Rb[h] * Rc[h] * (base + won);
      }
      out[a] = v;
    }
    return out;
  }
  // Preflop three-way finishing probabilities are approximated from consistent
  // pairwise outcomes. Every actual award uses eligible side pots, including ties.
  function showValsICM(nd, reach, Rv, env) {
    const B = bufs(nd), out = B.out, P = nd.players, ex = B.ex;
    out.fill(null);
    const exactPair = (a,b) => nd.allIn || nd.behind[a] < 1e-9 || nd.behind[b] < 1e-9;
    const share = (a,b) => shareMat(nd.kb, postOrder(a) > postOrder(b), nd.agg === a ? 1 : nd.agg === b ? -1 : 0);
    if (P.length === 2) {
      let pWin0 = 0, pTie = 0;
      for (let s = 0; s < 2; s++) {
        const a = P[s], b = P[1-s], op = reach[b] || ONES, rb = Rv[b] || ONES;
        const wins = mv(nd.allIn ? TB.MWT : share(a,b), op, B.t);
        const ties = nd.allIn ? mv(TB.MTT, op, B.tie || (B.tie = new Float64Array(NC))) : null;
        const uw = nd.UW[a][a], ul = nd.UW[b][a], ut = nd.UT[a], ra = reach[a] || ONES, v = B.V[a];
        let wm = 0, tm = 0, mass = 0;
        for (let h = 0; h < NC; h++) {
          const tie = ties ? ties[h] : 0;
          v[h] = env[h] * (ul * rb[h] + (uw-ul)*wins[h] + (ut-ul)*tie);
          if (s === 0) {
            const r = pi[h] * ra[h] * env[h];
            wm += r * wins[h]; tm += r * tie; mass += r * rb[h];
          }
        }
        if (s === 0) { pWin0 = mass > 0 ? wm / mass : 0.5; pTie = mass > 0 ? tm / mass : 0; }
        out[a] = v;
      }
      for (let p=0; p<n; p++) ex[p] = pWin0*nd.UW[P[0]][p] + pTie*nd.UT[p] + (1-pWin0-pTie)*nd.UW[P[1]][p];
    } else {
      const probs = B.pairProb || (B.pairProb = new Map());
      for (const a of P) for (const b of P) if (a !== b) {
        const key = a * 8 + b;
        let q = probs.get(key);
        if (!q) { q = { w:new Float64Array(NC), t:new Float64Array(NC) }; probs.set(key,q); }
        const actual = exactPair(a,b), rb = Rv[b] || ONES, op = reach[b] || ONES, ra = reach[a] || ONES;
        mv(actual ? TB.MWT : share(a,b),op,q.w);
        if (actual) mv(TB.MTT,op,q.t); else q.t.fill(0);
        let wm=0,tm=0,den=0;
        for (let h=0; h<NC; h++) {
          const mass = pi[h]*ra[h]*env[h];
          wm += mass*q.w[h]; tm += mass*q.t[h]; den += mass*rb[h];
          q.w[h] = rb[h] > 0 ? Math.min(1,q.w[h]/rb[h]) : 0.5;
          q.t[h] = rb[h] > 0 ? Math.min(1-q.w[h],q.t[h]/rb[h]) : 0;
        }
        q.meanWin = den>0 ? wm/den : 0.5; q.meanTie = den>0 ? tm/den : 0;
      }
      const probability = new Float64Array(9), orderMass = new Float64Array(orders.length), totalMass = new Float64Array(orders.length);
      let total = 0;
      P.forEach((a, ia) => {
        const [b,c] = P.filter(v => v !== a), rb = Rv[b] || ONES, rc = Rv[c] || ONES, ra = reach[a] || ONES;
        for (let h=0; h<NC; h++) {
          for (let k=0; k<3; k++) {
            const [i,j]=pairs[k], reverse=j===ia;
            const q=probs.get(reverse ? P[j]*8+P[i] : P[i]*8+P[j]);
            const own=i===ia || reverse;
            const win=own?q.w[h]:q.meanWin, tie=own?q.t[h]:q.meanTie, lose=Math.max(0,1-win-tie);
            probability[3*k]=reverse?win:lose; probability[3*k+1]=tie; probability[3*k+2]=reverse?lose:win;
          }
          let den=0;
          for (let t=0;t<orders.length;t++) {
            const rel=relations[t];
            orderMass[t]=probability[rel[0]]*probability[3+rel[1]]*probability[6+rel[2]];
            den+=orderMass[t];
          }
          if (den<1e-12) { orderMass.fill(0); orderMass.fill(1,0,6); den=6; }
          const cf=env[h]*rb[h]*rc[h], joint=pi[h]*ra[h]*cf;
          let value=0;
          for (let t=0;t<orders.length;t++) {
            const f=orderMass[t]/den; value+=f*nd.orderU[t][a]; totalMass[t]+=joint*f;
          }
          B.V[a][h]=cf*value; total+=joint;
        }
        out[a]=B.V[a];
      });
      ex.fill(0);
      for (let t=0;t<orders.length;t++) for (let p=0;p<n;p++) ex[p]+=(total>0?totalMass[t]/total:1/orders.length)*nd.orderU[t][p];
    }
    out.ex=ex; return out;
  }
  // reach[p]: own reach (null = 1), Rv[p]: P(y|h)-weighted reach of p (null = 1), env: same for folded players.
  // Returns value vectors for the voluntary players still in the hand.
  function walk(id, reach, Rv, env, mode) {
    const nd = nodes[id];
    if (nd.type === 1) {
      const B = bufs(nd), out = B.out, v = B.V[nd.w], val = ICM ? nd.U[nd.w] : ST[nd.w] - dead[nd.w] - nd.cb[nd.w] + nd.pot;
      out.fill(null);
      for (let h = 0; h < NC; h++) v[h] = val * env[h];
      out[nd.w] = v;
      if (ICM) out.ex = nd.U;
      return out;
    }
    if (nd.type === 2) return ICM ? showValsICM(nd, reach, Rv, env) : showVals(nd, reach, Rv, env);
    if (nd.type === 3) {
      const y = nd.x, Ry = Rv[y], B = bufs(nd);
      let env2 = env;
      if (Ry) { env2 = B.env2; for (let h = 0; h < NC; h++) env2[h] = env[h] * Ry[h]; }
      // with ICM a folded player's prize equity still depends on how the hand ends: the child's expected value
      const out = walk(nd.child, reach, Rv, env2, mode), v = B.V[y], val = ICM ? out.ex[y] : ST[y] - dead[y] - nd.cb[y];
      for (let h = 0; h < NC; h++) v[h] = val * env[h];
      for (const z of nd.vol) if (z !== y && Rv[z]) { const r = Rv[z]; for (let h = 0; h < NC; h++) v[h] *= r[h]; }
      out[y] = v; return out;
    }
    const x = nd.x, nA = nd.acts.length, sig = mode === TRAIN ? nd.cur : nd.avg, rx = reach[x] || ONES;
    const B = bufs(nd), cf = B.cf;
    cf.set(env);
    for (const y of nd.vol) if (y !== x && Rv[y]) { const r = Rv[y]; for (let h = 0; h < NC; h++) cf[h] *= r[h]; }
    const out = B.out, Vx = B.Vx, VA = B.VA;
    out.fill(null); Vx.fill(0);
    let pm = 0;
    if (ICM) { B.ex.fill(0); for (let h = 0; h < NC; h++) pm += pi[h] * rx[h]; }
    for (const y of nd.vol) if (y !== x) { out[y] = B.V[y]; out[y].fill(0); }
    for (let a = 0; a < nA; a++) {
      const act = nd.acts[a], nr = B.nr[a], o = a * NC;
      for (let h = 0; h < NC; h++) nr[h] = rx[h] * sig[o + h];
      const R2 = mv(MT, nr, B.R2[a]);
      let child, va;
      if (act.kind === FOLD) {
        const env2 = B.env2; for (let h = 0; h < NC; h++) env2[h] = env[h] * R2[h];
        child = walk(act.child, reach, Rv, env2, mode);
        va = B.va; const val = ICM ? child.ex[x] : ST[x] - dead[x] - nd.cb[x];
        for (let h = 0; h < NC; h++) va[h] = val * cf[h];
      } else {
        const reach2 = reach.slice(), Rv2 = Rv.slice(); reach2[x] = nr; Rv2[x] = R2;
        child = walk(act.child, reach2, Rv2, env, mode);
        va = child[x];
      }
      VA[a] = va;
      if (ICM) { let pa = 0; for (let h = 0; h < NC; h++) pa += pi[h] * rx[h] * sig[o + h]; pa = pm > 0 ? pa / pm : 1 / nA; const ce = child.ex; for (let p = 0; p < n; p++) B.ex[p] += pa * ce[p]; }
      for (let h = 0; h < NC; h++) Vx[h] += sig[o + h] * va[h];
      for (const y of nd.vol) if (y !== x) { const cy = child[y], oy = out[y]; for (let h = 0; h < NC; h++) oy[h] += cy[h]; }
    }
    out[x] = Vx;
    if (ICM) out.ex = B.ex;
    if (mode === TRAIN) {
      const R = nd.R, SS = nd.SS, cur = nd.cur;
      for (let a = 0; a < nA; a++) {
        const va = VA[a], o = a * NC;
        for (let h = 0; h < NC; h++) {
          const i = o + h, r = R[i];
          R[i] = (r > 0 ? r * pd : r * 0.5) + (va[h] - Vx[h]);
          SS[i] = SS[i] * sd + rx[h] * cur[i];
        }
      }
    } else if (mode === REC) { nd.VA = VA.map(v => Float64Array.from(v)); nd.Vx = Float64Array.from(Vx); nd.norm = Float64Array.from(cf); nd.own = Float64Array.from(rx); }
    else {
      for (let h = 0; h < NC; h++) { let best = -Infinity; for (let a = 0; a < nA; a++) if (VA[a][h] > best) best = VA[a][h]; gain += pi[h] * rx[h] * (best - Vx[h]); }
    }
    return out;
  }
  const rootArgs = () => [0, new Array(n).fill(null), new Array(n).fill(null), Float64Array.from(ONES)];
  function regretMatch() {
    for (const d of decs) {
      const nA = d.acts.length, R = d.R, cur = d.cur;
      for (let h = 0; h < NC; h++) {
        let s = 0; for (let a = 0; a < nA; a++) { const r = R[a * NC + h]; if (r > 0) s += r; }
        for (let a = 0; a < nA; a++) { const r = R[a * NC + h]; cur[a * NC + h] = s > 0 ? (r > 0 ? r / s : 0) : 1 / nA; }
      }
    }
  }
  function refreshAvg() {
    for (const d of decs) {
      const nA = d.acts.length;
      for (let h = 0; h < NC; h++) {
        let s = 0; for (let a = 0; a < nA; a++) s += d.SS[a * NC + h];
        for (let a = 0; a < nA; a++) d.avg[a * NC + h] = s > 0 ? d.SS[a * NC + h] / s : d.cur[a * NC + h];
      }
    }
  }
  function iterate(k) {
    for (let it = 0; it < k; it++) {
      t++;
      const ta = Math.pow(t, 1.5); pd = ta / (ta + 1); sd = Math.pow((t - 1) / t, GAMMA);
      regretMatch();
      const [id, r, rv, env] = rootArgs();
      walk(id, r, rv, env, TRAIN);
    }
    refreshAvg();
  }
  // sum over every decision of the gain from best-responding there (bb per hand dealt)
  function exploitability() {
    refreshAvg(); gain = 0;
    const [id, r, rv, env] = rootArgs();
    walk(id, r, rv, env, EXPL);
    return gain / icmScale;
  }
  function solve(opts = {}) {
    const maxIter = opts.maxIter || 4000, tol = opts.tol || 0.002;
    let ex = Infinity;
    while (t < maxIter) {
      iterate(25);
      ex = exploitability();
      if (opts.onProgress) opts.onProgress(t, ex);
      if (ex < tol) break;
    }
    return ex;
  }
  // record values with the average strategy so views can show EVs
  function evaluate() {
    refreshAvg();
    const [id, r, rv, env] = rootArgs();
    walk(id, r, rv, env, REC);
  }

  // ---------------- storage: 6-bit frequencies for hands that can reach each decision ----------------
  function codec(str) {
    let s = '', k = 0;
    (function dfs(id, reach) {
      const nd = nodes[id];
      if (nd.type === 3) { dfs(nd.child, reach); return; }
      if (nd.type !== 0) return;
      const x = nd.x, rx = reach[x] || ONES, nA = nd.acts.length, q = new Float64Array(nA * NC);
      for (let h = 0; h < NC; h++) {
        if (!(rx[h] > 0)) { q[h] = 1; continue; }
        let rest = 63;
        for (let a = 1; a < nA; a++) {
          let v;
          if (str == null) { v = Math.min(rest, Math.round(nd.avg[a * NC + h] * 63)); s += ALPH[v]; }
          else { v = ALPH.indexOf(str[k++]); if (v < 0 || v > rest) throw new Error('Bad preflop library data'); }
          q[a * NC + h] = v / 63; rest -= v;
        }
        q[h] = rest / 63;
      }
      if (str != null) { nd.SS.set(q); nd.avg.set(q); nd.cur.set(q); }
      for (let a = 0; a < nA; a++) {
        const r2 = reach.slice(), nr = new Float64Array(NC);
        for (let h = 0; h < NC; h++) nr[h] = rx[h] * q[a * NC + h];
        r2[x] = nr;
        dfs(nd.acts[a].child, r2);
      }
    })(0, new Array(n).fill(null));
    if (str != null && k !== str.length) throw new Error('Preflop library data does not match this tree');
    return s;
  }
  function pack() { refreshAvg(); return codec(null); }
  function load(str) { codec(str); }

  // ---------------- views ----------------
  function view(id) {
    while (nodes[id].type === 3) id = nodes[id].child;
    const nd = nodes[id];
    const base = { id, line: nd.line, pot: nd.pot };
    if (nd.type === 1) return Object.assign(base, { type: 'fold', winner: nd.w });
    if (nd.type === 2) return Object.assign(base, { type: 'show', players: nd.players, allIn: nd.allIn, spr: nd.spr, left: nd.spr * nd.pot, cb: Array.from(nd.cb), behind: nd.behind, pots: nd.pots, agg: nd.agg });
    if (!nd.VA) evaluate();
    const x = nd.x, nA = nd.acts.length, stack = ST[x] - dead[x] - nd.cb[x];
    const freq = [], ev = [];
    for (let a = 0; a < nA; a++) {
      freq.push(nd.avg.subarray(a * NC, (a + 1) * NC));
      const e = new Float64Array(NC);
      // chip model: chips won compared with folding (your stack now); ICM: payout units compared with the first option
      for (let h = 0; h < NC; h++) { const nm = nd.norm[h]; e[h] = nm > 1e-12 ? nd.VA[a][h] / nm - (ICM ? nd.VA[0][h] / nm : stack) : NaN; }
      ev.push(e);
    }
    let mass = 0; const pf = new Float64Array(nA);
    for (let h = 0; h < NC; h++) { const w = pi[h] * nd.own[h]; mass += w; for (let a = 0; a < nA; a++) pf[a] += w * nd.avg[a * NC + h]; }
    return Object.assign(base, {
      type: 'dec', x, position: pos[x], toCall: nd.toCall, lvl: nd.lvl,
      actions: nd.acts.map((a, i) => { const c = resolve(a.child); return { kind: a.kind, to: a.to, label: a.label, child: c, childType: ['dec', 'fold', 'show'][nodes[c].type], pct: mass > 0 ? pf[i] / mass * 100 : 0 }; }),
      freq, ev, reach: nd.own, rangePct: mass * 100
    });
  }
  function resolve(id) { while (nodes[id].type === 3) id = nodes[id].child; return id; }
  // follow a list of action labels from the root (auto-folds are skipped)
  function follow(labels) {
    let id = 0;
    for (const lab of labels) { id = resolve(id); const nd = nodes[id]; if (nd.type !== 0) return -1; const a = nd.acts.find(x => x.label === lab); if (!a) return -1; id = a.child; }
    return resolve(id);
  }
  // each player's reach (169 classes, null = untouched) after a list of action labels from the root
  function reachAt(labels) {
    const reach = new Array(n).fill(null);
    let id = 0;
    for (const lab of labels) {
      id = resolve(id); const nd = nodes[id];
      if (nd.type !== 0) return null;
      const ai = nd.acts.findIndex(x => x.label === lab);
      if (ai < 0) return null;
      const r = reach[nd.x] ? reach[nd.x] : (reach[nd.x] = new Float64Array(NC).fill(1));
      for (let h = 0; h < NC; h++) r[h] *= nd.avg[ai * NC + h];
      id = nd.acts[ai].child;
    }
    return { id: resolve(id), reach };
  }
  function firstIn(seat) {
    let id = 0;
    for (;;) { const nd = nodes[id]; if (nd.type !== 0 || nd.lvl > 0 || nd.x >= seat) return id; id = nd.acts[0].child; }
  }
  return {
    n, positions: pos, stack: S, stacks: Array.from(ST), sizes: sz, dead, nodes, decisions: decs.length, unit: ICM ? '$' : 'bb', icm: !!ICM,
    iterate, solve, exploitability, evaluate, pack, load, view, firstIn, resolve, follow, reachAt,
    get iterations() { return t; }
  };
}

EM.DeepTree = DeepTree;
EM.deepDefaultSizes = defaultSizes;
EM.deepPlayFeatures = playFeatures;
EM.DEEP_KIND = { FOLD, CALL, RAISE, JAM };
})(globalThis.EM || (globalThis.EM = {}));
