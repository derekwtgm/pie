(function (EM) {
'use strict';
// Heads-up postflop solver: vector-form Discounted CFR (alpha 1.5, beta 0, gamma 3)
// with alternating updates, lazy discounting, zero-reach pruning and O(n) showdowns
// with exact card removal. Player 0 = OOP, 1 = IP.
const T_PLAYER = 0, T_CHANCE = 1, T_FOLD = 2, T_SHOW = 3, T_ALLIN = 4;
const A_FOLD = 0, A_CHECK = 1, A_CALL = 2, A_BET = 3, A_RAISE = 4, A_ALLIN = 5;
const ALPHA = 1.5, GAMMA = 3;

class Grow {
  constructor(Type, n = 4096) { this.T = Type; this.a = new Type(n); this.n = 0; }
  ensure(k) { if (this.n + k > this.a.length) { let m = this.a.length * 2; while (m < this.n + k) m *= 2; const b = new this.T(m); b.set(this.a); this.a = b; } }
  push(v) { this.ensure(1); this.a[this.n] = v; return this.n++; }
  reserve(k) { this.ensure(k); const s = this.n; this.n += k; return s; }
  final() { return this.a.slice(0, this.n); }
}

// Size tokens: 33 or 33% (of the pot), 2.5x (raises: times the bet faced), g (bets: geometric, the same
// fraction of the pot on every street left gets the stacks in by the river), a (all-in).
// Parsed to the native engine's codes: > 0 % of pot, -1 all-in, -2 geometric, -100*m for m x.
const SZ_ALLIN = -1, SZ_GEO = -2;
function parseSizes(str, isRaise) {
  const out = [];
  for (const tok of String(str || '').split(/[\s,;]+/).filter(Boolean)) {
    const t = tok.toLowerCase();
    if (out.length >= 8) throw new Error('Up to 8 sizes per box');
    if (t[0] === 'a') { out.push(SZ_ALLIN); continue; }
    if (t === 'g' || t === 'geo') {
      if (isRaise) throw new Error('Bad raise size "' + tok + '": g (geometric) is for bets');
      out.push(SZ_GEO); continue;
    }
    const m = /^(\d+(?:\.\d+)?|\.\d+)(x|%)?$/.exec(t);
    const v = m ? parseFloat(m[1]) : NaN;
    if (m && m[2] === 'x') {
      if (!isRaise) throw new Error('Bad bet size "' + tok + '": multiples like 3x are for raises');
      if (!(v >= 1.5 && v <= 20)) throw new Error('Bad raise size "' + tok + '": use 1.5x to 20x');
      out.push(-100 * v); continue;
    }
    if (!(v > 0) || v > 2000) throw new Error('Bad size "' + tok + '": use % of pot like 33 or 75, ' + (isRaise ? 'a multiple like 3x, ' : 'g (geometric), ') + 'or a for all-in');
    out.push(v);
  }
  return out;
}
const fmtSizeCode = (v) => v === SZ_ALLIN ? 'a' : v === SZ_GEO ? 'g' : v <= -100 ? (-v / 100) + 'x' : String(v);
// the app's spot (size strings) -> engine config
function engineCfg(c, board) {
  const sz = c.sizes;
  return {
    board: (board || c.board).slice(), pot: c.pot, stack: c.stack, maxBets: c.maxBets, forceAllin: c.forceAllin,
    ranges: [Float32Array.from(c.ranges[0]), Float32Array.from(c.ranges[1])],
    sizes: {
      bet: sz.bet.map(r => r.map(s => parseSizes(s, false))),
      raise: sz.raise.map(r => r.map(s => parseSizes(s, true))),
      donk: Array.isArray(sz.donk) ? [0, 1, 2].map(s => parseSizes(sz.donk[s] || '', false)) : null
    },
    reraise: c.reraise, engine: c.engine, compressAboveMB: c.compressAboveMB, icm: c.icm, iso: c.iso
  };
}

function PostflopGame(cfg) {
  const C1 = EM.C1, C2 = EM.C2;
  const board = cfg.board.slice();
  const nb = board.length;
  if (nb < 3 || nb > 5) throw new Error('Board needs 3, 4 or 5 cards');
  const P0 = +cfg.pot, S = +cfg.stack;
  if (!(P0 > 0) || !Number.isFinite(P0)) throw new Error('Pot must be above 0');
  if (!(S >= 0) || !Number.isFinite(S)) throw new Error('Stack must be 0 or more');
  // 3.3: the same strict checks as the native host (cfg.c): whole, distinct card
  // identifiers and finite, nonnegative weights for all 1326 combinations.
  if (board.some(c => !Number.isInteger(c) || c < 0 || c > 51) || new Set(board).size !== nb) throw new Error('Bad or duplicate board card');
  if (!Array.isArray(cfg.ranges) && !ArrayBuffer.isView(cfg.ranges) || cfg.ranges.length !== 2) throw new Error('Missing ranges');
  for (let p = 0; p < 2; p++) {
    const r = cfg.ranges[p];
    if (!r || r.length !== 1326) throw new Error('Range needs 1326 weights');
    for (let i = 0; i < 1326; i++) if (typeof r[i] !== 'number' || !Number.isFinite(r[i]) || r[i] < 0)
      throw new Error('Range weights must be finite and nonnegative (' + (p ? 'IP' : 'OOP') + ', combo ' + i + ')');
  }
  const startStreet = nb - 3;
  // ICM: u[p][i] is player p's tournament equity when OOP finishes the hand with x0 + i*dx chips
  // (the two players' chips are conserved, so OOP's final stack fixes IP's too)
  const ICM = cfg.icm && cfg.icm.u0 && cfg.icm.u0.length >= 2 ? { x0: +cfg.icm.x0, dx: +cfg.icm.dx, b0: +cfg.icm.b0, n: cfg.icm.u0.length, u: [Float64Array.from(cfg.icm.u0), Float64Array.from(cfg.icm.u1)] } : null;
  function icmU(p, x) {
    let f = (x - ICM.x0) / ICM.dx; if (!(f > 0)) f = 0; if (f > ICM.n - 1) f = ICM.n - 1;
    const i = Math.min(ICM.n - 2, Math.floor(f)), w = f - i, u = ICM.u[p];
    return u[i] + (u[i + 1] - u[i]) * w;
  }
  // a player's equity if they fold now (OOP: loses what is in; IP: OOP wins the pot)
  const icmFold = (p, c0, c1) => icmU(p, p === 0 ? ICM.b0 - c0 : ICM.b0 - c0 + P0 + c0 + c1);
  const maxBets = Math.max(1, cfg.maxBets | 0 || 3);
  const forceAllin = cfg.forceAllin == null ? 0.2 : Math.min(1, Math.max(0, +cfg.forceAllin || 0));
  // sizes.bet[street][player], sizes.raise[street][player], sizes.donk[street] -> arrays of size codes
  const sizes = cfg.sizes, donkSizes = sizes.donk || null, reraiseAllin = cfg.reraise === 'allin';
  const onBoard = new Uint8Array(52);
  for (const c of board) onBoard[c] = 1;

  // ---- combos ----
  const G = [], WT = [], L1 = [], L2 = [], NCB = [], G2L = [];
  for (let p = 0; p < 2; p++) {
    const g = [], w = [];
    const src = cfg.ranges[p];
    for (let i = 0; i < 1326; i++) {
      const v = src[i];
      if (v > 0 && !onBoard[C1[i]] && !onBoard[C2[i]]) { g.push(i); w.push(v); }
    }
    if (!g.length) throw new Error((p ? 'IP' : 'OOP') + ' range has no hands that fit this board');
    G.push(Int16Array.from(g)); WT.push(Float32Array.from(w)); NCB.push(g.length);
    L1.push(Uint8Array.from(g.map(i => C1[i]))); L2.push(Uint8Array.from(g.map(i => C2[i])));
    const m = new Int16Array(1326).fill(-1); g.forEach((gi, k) => { m[gi] = k; }); G2L.push(m);
  }
  const SAME = [0, 1].map(p => Int32Array.from(G[p], gi => G2L[1 - p][gi]));
  const WITH = [0, 1].map(p => {
    const lists = Array.from({ length: 52 }, () => []);
    for (let h = 0; h < NCB[p]; h++) { lists[L1[p][h]].push(h); lists[L2[p][h]].push(h); }
    return lists.map(l => Int32Array.from(l));
  });
  const maxN = Math.max(NCB[0], NCB[1]);

  // ---- suit isomorphism: permutations that keep the board and both ranges unchanged ----
  const PERMS = [], PINV = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) for (let d = 0; d < 4; d++) {
    if (new Set([a, b, c, d]).size < 4) continue;
    const pm = [a, b, c, d], iv = [0, 0, 0, 0]; pm.forEach((x, i) => { iv[x] = i; });
    PERMS.push(pm); PINV.push(iv);
  }
  const pcard = (pm, c) => (c & ~3) | pm[c & 3];
  const symOK = new Uint8Array(24); symOK[0] = 1;
  const PH = Array.from({ length: 24 }, () => [null, null]);   // PH[si][p][h]: stored twin of hand h under permutation si
  for (let si = 1; si < 24 && cfg.iso !== false && cfg.iso !== 0; si++) {
    const pm = PERMS[si];
    let ok = board.every(c => onBoard[pcard(pm, c)]);
    for (let p = 0; ok && p < 2; p++) {
      const src = cfg.ranges[p];
      for (let i = 0; ok && i < 1326; i++) if (Math.abs(src[i] - src[EM.PIDX[pcard(pm, C1[i]) * 52 + pcard(pm, C2[i])]]) > 1e-6) ok = false;
    }
    if (!ok) continue;
    const maps = [0, 1].map(p => Int32Array.from(G[p], gi => G2L[p][EM.PIDX[pcard(PINV[si], C1[gi]) * 52 + pcard(PINV[si], C2[gi])]]));
    if (maps.some(m => m.some(x => x < 0))) continue;
    symOK[si] = 1; PH[si] = maps;
  }

  // ---- river boards ----
  const boards = [];
  const boardIdx = new Int32Array(52 * 52).fill(-1);
  function mkBoard(cards5) {
    const bs = [0, 0, 0, 0], used = new Uint8Array(52);
    for (const c of cards5) { bs[c & 3] |= 1 << (c >> 2); used[c] = 1; }
    const B = { cards: cards5, ord: [], str: [] };
    for (let p = 0; p < 2; p++) {
      const keys = [];
      for (let h = 0; h < NCB[p]; h++) {
        const a = L1[p][h], b = L2[p][h];
        if (used[a] || used[b]) continue;
        const s = [bs[0], bs[1], bs[2], bs[3]];
        s[a & 3] |= 1 << (a >> 2); s[b & 3] |= 1 << (b >> 2);
        keys.push(EM.evalMasks(s[0], s[1], s[2], s[3]) * 2048 + h);
      }
      const k = Float64Array.from(keys).sort();
      const ord = new Uint16Array(k.length), str = new Int32Array(k.length);
      for (let i = 0; i < k.length; i++) { ord[i] = k[i] % 2048; str[i] = Math.floor(k[i] / 2048); }
      B.ord.push(ord); B.str.push(str);
    }
    // merge positions: lt[p][i] = #opp entries weaker than p's i-th; le[p][i] = #opp entries weaker or equal
    B.lt = []; B.le = [];
    for (let p = 0; p < 2; p++) {
      const sp = B.str[p], so = B.str[1 - p], lt = new Uint16Array(sp.length), le = new Uint16Array(sp.length);
      let j = 0, k2 = 0;
      for (let i = 0; i < sp.length; i++) {
        while (j < so.length && so[j] < sp[i]) j++;
        while (k2 < so.length && so[k2] <= sp[i]) k2++;
        lt[i] = j; le[i] = k2;
      }
      B.lt.push(lt); B.le.push(le);
    }
    return B;
  }
  const rest = []; for (let c = 0; c < 52; c++) if (!onBoard[c]) rest.push(c);
  if (nb === 5) boards.push(mkBoard(board));
  else if (nb === 4) for (const r of rest) { boardIdx[r] = boards.length; boards.push(mkBoard([...board, r])); }
  else for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
    const t = rest[i], r = rest[j];
    boardIdx[t * 52 + r] = boardIdx[r * 52 + t] = boards.length; boards.push(mkBoard([...board, t, r]));
  }
  function boardIdOf(dealt) {
    if (nb === 5) return 0;
    if (nb === 4) return boardIdx[dealt[0]];
    return boardIdx[dealt[0] * 52 + dealt[1]];
  }
  // runout lists for all-in before the river
  const runouts = []; // {ids: Int32Array, w}
  const runoutKey = new Map();
  function runoutFor(street, dealt) {
    // street = street where the all-in happened (0 flop, 1 turn)
    const key = street === 0 ? 'f' : (nb === 4 ? 't' : 't' + dealt[0]);
    if (runoutKey.has(key)) return runoutKey.get(key);
    let ids;
    if (street === 0) { ids = Int32Array.from(boards.keys()); }
    else if (nb === 4) { ids = Int32Array.from(boards.keys()); }
    else { const t = dealt[0]; ids = Int32Array.from(rest.filter(r => r !== t).map(r => boardIdx[t * 52 + r])); }
    const w = street === 0 ? 1 / 990 : 1 / 44;
    runouts.push({ ids, w });
    runoutKey.set(key, runouts.length - 1);
    return runouts.length - 1;
  }

  // ---- tree ----
  const Nt = new Grow(Uint8Array), Np = new Grow(Int8Array), Nc0 = new Grow(Float32Array), Nc1 = new Grow(Float32Array),
    Nst = new Grow(Uint8Array), Ncs = new Grow(Int32Array), Nnc = new Grow(Uint8Array), Nd = new Grow(Int32Array),
    Nx = new Grow(Int32Array), Nbase = new Grow(Float32Array);
  const Cn = new Grow(Int32Array), Ccard = new Grow(Int8Array), Ckind = new Grow(Uint8Array), Camt = new Grow(Float32Array), Cperm = new Grow(Uint8Array);
  let dataSize = 0, maxDepth = 0, maxA = 1, nPlayer = 0, nChance = 0, nTerm = 0;
  const NODE_LIMIT = cfg.nodeLimit || 6000000;
  const COMPRESS_ABOVE = (cfg.compressAboveMB || 200) * 1048576;

  function newNode(type, player, c0, c1, street, base) {
    if (Nt.n >= NODE_LIMIT) throw new Error('Tree too large (over ' + NODE_LIMIT.toLocaleString() + ' nodes). Use fewer bet sizes or a later street.');
    const id = Nt.push(type);
    Np.push(player); Nc0.push(c0); Nc1.push(c1); Nst.push(street); Ncs.push(-1); Nnc.push(0); Nd.push(-1); Nx.push(-1); Nbase.push(base);
    return id;
  }
  function reserveChildren(k) {
    const s = Cn.reserve(k); Ccard.reserve(k); Ckind.reserve(k); Camt.reserve(k); Cperm.reserve(k);
    return s;
  }
  function allinRule(to, p, c) {
    if (to >= S - 1e-9) return S;
    if (S - to <= forceAllin * (P0 + 2 * to)) return S;
    return to;
  }
  function streetEnd(street, c, dealt, depth, agg) {
    if (c >= S - 1e-9 && street < 2) {
      const id = newNode(T_ALLIN, -1, c, c, street, c); nTerm++;
      Nx.a[id] = runoutFor(street, dealt);
      return id;
    }
    if (street === 2) {
      const id = newNode(T_SHOW, -1, c, c, street, c); nTerm++;
      Nx.a[id] = boardIdOf(dealt);
      return id;
    }
    const id = newNode(T_CHANCE, -1, c, c, street, c); nChance++;
    const used = new Uint8Array(52);
    for (const x of board) used[x] = 1; for (const x of dealt) used[x] = 1;
    const cards = []; for (let k = 0; k < 52; k++) if (!used[k]) cards.push(k);
    const s = reserveChildren(cards.length);
    Ncs.a[id] = s; Nnc.a[id] = cards.length;
    // cards that a symmetry maps onto a lower card share that card's subtree
    const grp = [];
    for (let si = 1; si < 24; si++) if (symOK[si] && cards.every(x => !used[pcard(PERMS[si], x)])) grp.push(si);
    for (let k = 0; k < cards.length; k++) {
      let can = cards[k];
      for (const si of grp) { const x = pcard(PERMS[si], cards[k]); if (x < can) can = x; }
      if (can !== cards[k]) {
        const kc = cards.indexOf(can), si = grp.find(q => pcard(PERMS[q], can) === cards[k]);
        Cn.a[s + k] = Cn.a[s + kc]; Ccard.a[s + k] = cards[k]; Ckind.a[s + k] = 255; Camt.a[s + k] = 0; Cperm.a[s + k] = si;
        continue;
      }
      const child = action({ street: street + 1, base: c, c: [c, c], actor: 0, nBets: 0, facing: false, lastInc: 0, dealt: [...dealt, cards[k]], prevAgg: agg, agg: -1 }, depth + 1);
      Cn.a[s + k] = child; Ccard.a[s + k] = cards[k]; Ckind.a[s + k] = 255; Camt.a[s + k] = 0; Cperm.a[s + k] = 0;
    }
    return id;
  }
  function action(st, depth) {
    if (depth > maxDepth) maxDepth = depth;
    const p = st.actor, o = 1 - p, c = st.c, street = st.street;
    const pot = P0 + c[0] + c[1];
    const left = S - c[p], oppLeft = S - c[o];
    const acts = [];
    if (!st.facing) {
      acts.push({ kind: A_CHECK, to: c[p] });
      // OOP leading into the player who bet the last street (after calling it) uses the donk sizes
      const list = p === 0 && street >= 1 && st.prevAgg === 1 && donkSizes ? donkSizes[street] : sizes.bet[street][p];
      if (left > 1e-9 && st.nBets < maxBets) {
        for (const sz of list) {
          let amt = sz === SZ_ALLIN ? left : sz === SZ_GEO ? (Math.pow(1 + 2 * left / pot, 1 / (3 - street)) - 1) / 2 * pot : sz / 100 * pot;
          amt = Math.max(amt, Math.min(1, left));
          const to = allinRule(c[p] + amt);
          acts.push({ kind: to >= S - 1e-9 ? A_ALLIN : A_BET, to });
        }
      }
    } else {
      acts.push({ kind: A_FOLD, to: c[p] });
      acts.push({ kind: A_CALL, to: Math.min(c[o], S) });
      const toCall = c[o] - c[p];
      // facing a raise (a 3-bet or more) the re-raise can be limited to all-in
      const list = reraiseAllin && st.nBets >= 2 ? [SZ_ALLIN] : sizes.raise[street][p];
      if (st.nBets < maxBets && left > toCall + 1e-9 && oppLeft > 1e-9) {
        const potAfter = pot + toCall;
        for (const sz of list) {
          let to = sz === SZ_ALLIN ? S : sz <= -100 ? st.base + (-sz / 100) * (c[o] - st.base) : c[o] + sz / 100 * potAfter;
          to = Math.max(to, c[o] + Math.max(st.lastInc, 1));
          to = allinRule(Math.min(to, S));
          acts.push({ kind: to >= S - 1e-9 ? A_ALLIN : A_RAISE, to });
        }
      }
    }
    // dedupe aggressive actions by amount
    const fixed = acts.filter(a => a.kind === A_CHECK || a.kind === A_FOLD || a.kind === A_CALL);
    const agg = acts.filter(a => a.kind >= A_BET).sort((x, y) => x.to - y.to);
    const uniq = [];
    for (const a of agg) if (!uniq.length || a.to - uniq[uniq.length - 1].to > 0.005) uniq.push(a);
    const list = fixed.concat(uniq);
    const id = newNode(T_PLAYER, p, c[0], c[1], street, st.base); nPlayer++;
    const nA = list.length;
    if (nA > maxA) maxA = nA;
    Nd.a[id] = dataSize; dataSize += nA * NCB[p];
    const s = reserveChildren(nA);
    Ncs.a[id] = s; Nnc.a[id] = nA;
    for (let k = 0; k < nA; k++) {
      const a = list[k];
      let child;
      if (a.kind === A_CHECK) {
        child = p === 0 ? action({ ...st, actor: 1, facing: false }, depth + 1) : streetEnd(street, c[0], st.dealt, depth + 1, -1);
      } else if (a.kind === A_FOLD) {
        child = newNode(T_FOLD, p, c[0], c[1], street, st.base); nTerm++;
      } else if (a.kind === A_CALL) {
        child = streetEnd(street, a.to, st.dealt, depth + 1, st.agg);
      } else {
        const nc = c.slice(); nc[p] = a.to;
        child = action({ street, base: st.base, c: nc, actor: o, nBets: st.nBets + 1, facing: true, lastInc: a.to - c[o], dealt: st.dealt, prevAgg: st.prevAgg, agg: p }, depth + 1);
      }
      Cn.a[s + k] = child; Ccard.a[s + k] = -1; Ckind.a[s + k] = a.kind; Camt.a[s + k] = a.to - st.base; Cperm.a[s + k] = 0;
    }
    return id;
  }
  const root = action({ street: startStreet, base: 0, c: [0, 0], actor: 0, nBets: 0, facing: false, lastInc: 0, dealt: [], prevAgg: -1, agg: -1 }, 0);
  const TY = Nt.final(), PL = Np.final(), NC0 = Nc0.final(), NC1 = Nc1.final(), ST = Nst.final(), CS = Ncs.final(),
    NN = Nnc.final(), DO = Nd.final(), NX = Nx.final(), BASE = Nbase.final();
  const CHN = Cn.final(), CHC = Ccard.final(), CHK = Ckind.final(), CHA = Camt.final(), CHP = Cperm.final();
  const nNodes = TY.length;

  let boardBytes = 0; for (const B of boards) boardBytes += (B.ord[0].length + B.ord[1].length) * 6;
  const stats = {
    nodes: nNodes, decisions: nPlayer, chance: nChance, terminals: nTerm, combos: [NCB[0], NCB[1]],
    floats: dataSize, memMB: (dataSize * (cfg.engine === 'js' || dataSize * 8 <= COMPRESS_ABOVE ? 8 : 4) + boardBytes * 2 + nNodes * 40) / 1048576, boards: boards.length,
    compressed: cfg.engine !== 'js' && dataSize * 8 > COMPRESS_ABOVE
  };

  // ---- solver state (allocated on demand) ----
  let R = null, SS = null, lastR = null, lastS = null, t = 0;
  let cumPos = new Float64Array(1);
  cumPos[0] = 1;
  function alloc() {
    if (R) return;
    R = new Float32Array(dataSize); SS = new Float32Array(dataSize);
    lastR = new Int32Array(nNodes); lastS = new Int32Array(nNodes);
  }
  function growCum(n) {
    if (cumPos.length > n) return;
    const m = Math.max(n + 1, cumPos.length * 2);
    const c = new Float64Array(m); c.set(cumPos);
    for (let k = cumPos.length; k < m; k++) { const ta = Math.pow(k, ALPHA); c[k] = c[k - 1] * ta / (ta + 1); }
    cumPos = c;
  }

  // buffers per depth
  const D = maxDepth + 4;
  const RB = [], TBf = [], SB = [], OB = [];
  for (let d = 0; d < D; d++) {
    RB.push(new Float64Array(maxN)); TBf.push(new Float64Array(maxN)); SB.push(new Float64Array(maxA * maxN));
    const ob = []; for (let a = 0; a < maxA; a++) ob.push(new Float64Array(maxN)); OB.push(ob);
  }
  const CSUM = new Float64Array(52);
  const ALLTMP = new Float64Array(maxN);
  const LOCKS = new Map();   // node -> Float64Array(nA*nq) fixed strategy
  const SUMB = new Float64Array(maxN);
  const W64 = [Float64Array.from(WT[0]), Float64Array.from(WT[1])];

  function showdown(bid, p, ro, out, pw, pl = -pw, ut = 0) {
    const B = boards[bid];
    const o = 1 - p, ordP = B.ord[p], ordO = B.ord[o], lt = B.lt[p], le = B.le[p];
    const nP = NCB[p], c1P = L1[p], c2P = L2[p], c1O = L1[o], c2O = L2[o];
    for (let h = 0; h < nP; h++) out[h] = 0;
    const cs = CSUM; cs.fill(0);
    const mP = ordP.length, mO = ordO.length;
    let tot = 0, j = 0;
    for (let i = 0; i < mP; i++) {
      const lim = lt[i];
      while (j < lim) { const c = ordO[j++]; const r = ro[c]; if (r !== 0) { tot += r; cs[c1O[c]] += r; cs[c2O[c]] += r; } }
      const h = ordP[i];
      out[h] = tot - cs[c1P[h]] - cs[c2P[h]];
    }
    cs.fill(0); tot = 0; j = mO - 1;
    for (let i = mP - 1; i >= 0; i--) {
      const lim = le[i];
      while (j >= lim) { const c = ordO[j--]; const r = ro[c]; if (r !== 0) { tot += r; cs[c1O[c]] += r; cs[c2O[c]] += r; } }
      const h = ordP[i];
      out[h] = pw * out[h] + pl * (tot - cs[c1P[h]] - cs[c2P[h]]);
    }
    if (ut !== 0) {   // ties: every compatible opponent hand on this board, weighted by the tie payoff
      cs.fill(0); tot = 0;
      for (let k = 0; k < mO; k++) { const c = ordO[k]; const r = ro[c]; if (r !== 0) { tot += r; cs[c1O[c]] += r; cs[c2O[c]] += r; } }
      const same = SAME[p];
      for (let i = 0; i < mP; i++) { const h = ordP[i], k = same[h]; out[h] += ut * (tot - cs[c1P[h]] - cs[c2P[h]] + (k >= 0 ? ro[k] : 0)); }
    }
  }
  function foldTerm(p, ro, out, pay) {
    const o = 1 - p, nO = NCB[o], nP = NCB[p], c1O = L1[o], c2O = L2[o], c1P = L1[p], c2P = L2[p], same = SAME[p];
    const cs = CSUM; cs.fill(0);
    let tot = 0;
    for (let c = 0; c < nO; c++) { const r = ro[c]; if (r !== 0) { tot += r; cs[c1O[c]] += r; cs[c2O[c]] += r; } }
    for (let h = 0; h < nP; h++) { const k = same[h]; out[h] = pay * (tot - cs[c1P[h]] - cs[c2P[h]] + (k >= 0 ? ro[k] : 0)); }
  }
  function allinTerm(node, p, ro, out, pw = P0 / 2 + NC0[node], pl = -pw, ut = 0) {
    const ru = runouts[NX[node]], ids = ru.ids, nP = NCB[p];
    for (let h = 0; h < nP; h++) out[h] = 0;
    const tmp = ALLTMP;
    for (let k = 0; k < ids.length; k++) {
      showdown(ids[k], p, ro, tmp, pw, pl, ut);
      for (let h = 0; h < nP; h++) out[h] += tmp[h];
    }
    const w = ru.w;
    for (let h = 0; h < nP; h++) out[h] *= w;
  }
  function chanceW(node) { return (3 + ST[node]) === 3 ? 1 / 45 : 1 / 44; }

  function terminal(node, p, ro, out) {
    const ty = TY[node];
    if (ICM) {
      const c0 = NC0[node], pot = P0 + c0 + NC1[node], xl = ICM.b0 - c0, xw = xl + pot;
      if (ty === T_FOLD) { foldTerm(p, ro, out, icmU(p, PL[node] === 0 ? xl : xw)); return; }
      const uw = icmU(p, p === 0 ? xw : xl), ul = icmU(p, p === 0 ? xl : xw), ut = icmU(p, xl + pot / 2);
      if (ty === T_SHOW) showdown(NX[node], p, ro, out, uw - ut, ul - ut, ut); else allinTerm(node, p, ro, out, uw - ut, ul - ut, ut);
      return;
    }
    if (ty === T_FOLD) {
      const f = PL[node], cf = f === 0 ? NC0[node] : NC1[node];
      foldTerm(p, ro, out, (f === p ? -1 : 1) * (P0 / 2 + cf));
    } else if (ty === T_SHOW) showdown(NX[node], p, ro, out, P0 / 2 + NC0[node]);
    else allinTerm(node, p, ro, out);
  }

  function chanceCfr(node, p, ro, out, d) {
    const o = 1 - p, nO = NCB[o], nP = NCB[p];
    for (let h = 0; h < nP; h++) out[h] = 0;
    const r2 = RB[d], tmp = TBf[d], s = CS[node], nc = NN[node];
    const wo = WITH[o], wp = WITH[p];
    for (let k = 0; k < nc; k++) {
      if (CHP[s + k]) continue;
      const card = CHC[s + k];
      for (let c = 0; c < nO; c++) r2[c] = ro[c];
      const bl = wo[card]; for (let q = 0; q < bl.length; q++) r2[bl[q]] = 0;
      cfr(CHN[s + k], p, r2, tmp, d + 1);
      const bp = wp[card]; for (let q = 0; q < bp.length; q++) tmp[bp[q]] = 0;
      for (let h = 0; h < nP; h++) out[h] += tmp[h];
      for (let k2 = k + 1; k2 < nc; k2++) if (CHP[s + k2] && CHN[s + k2] === CHN[s + k]) { const ph = PH[CHP[s + k2]][p]; for (let h = 0; h < nP; h++) out[h] += tmp[ph[h]]; }
    }
    const w = chanceW(node);
    for (let h = 0; h < nP; h++) out[h] *= w;
  }
  function chanceEval(node, p, ro, out, d, br) {
    const o = 1 - p, nO = NCB[o], nP = NCB[p];
    for (let h = 0; h < nP; h++) out[h] = 0;
    const r2 = RB[d], tmp = TBf[d], s = CS[node], nc = NN[node];
    const wo = WITH[o], wp = WITH[p];
    for (let k = 0; k < nc; k++) {
      if (CHP[s + k]) continue;
      const card = CHC[s + k];
      for (let c = 0; c < nO; c++) r2[c] = ro[c];
      const bl = wo[card]; for (let q = 0; q < bl.length; q++) r2[bl[q]] = 0;
      evalT(CHN[s + k], p, r2, tmp, d + 1, br);
      const bp = wp[card]; for (let q = 0; q < bp.length; q++) tmp[bp[q]] = 0;
      for (let h = 0; h < nP; h++) out[h] += tmp[h];
      for (let k2 = k + 1; k2 < nc; k2++) if (CHP[s + k2] && CHN[s + k2] === CHN[s + k]) { const ph = PH[CHP[s + k2]][p]; for (let h = 0; h < nP; h++) out[h] += tmp[ph[h]]; }
    }
    const w = chanceW(node);
    for (let h = 0; h < nP; h++) out[h] *= w;
  }
  // regret matching into st (contiguous per action)
  function regretMatch(off, nA, nq, st) {
    const sum = SUMB;
    for (let h = 0; h < nq; h++) sum[h] = 0;
    for (let a = 0; a < nA; a++) {
      const b = off + a * nq, sb = a * nq;
      for (let h = 0; h < nq; h++) { const v = R[b + h]; const x = v > 0 ? v : 0; st[sb + h] = x; sum[h] += x; }
    }
    const u = 1 / nA;
    for (let h = 0; h < nq; h++) { const x = sum[h]; sum[h] = x > 0 ? 1 / x : 0; }
    for (let a = 0; a < nA; a++) {
      const sb = a * nq;
      for (let h = 0; h < nq; h++) { const inv = sum[h]; st[sb + h] = inv > 0 ? st[sb + h] * inv : u; }
    }
  }
  function cfr(node, p, ro, out, d) {
    const ty = TY[node];
    if (ty >= T_FOLD) { terminal(node, p, ro, out); return; }
    if (ty === T_CHANCE) { chanceCfr(node, p, ro, out, d); return; }
    const q = PL[node], nA = NN[node], off = DO[node], s0 = CS[node], nq = NCB[q], nP = NCB[p];
    const st = SB[d];
    const lk = LOCKS.get(node);
    if (lk) { for (let i = 0; i < nA * nq; i++) st[i] = lk[i]; } else regretMatch(off, nA, nq, st);
    if (q === p) {
      const ob = OB[d];
      for (let a = 0; a < nA; a++) cfr(CHN[s0 + a], p, ro, ob[a], d + 1);
      for (let h = 0; h < nP; h++) out[h] = 0;
      for (let a = 0; a < nA; a++) {
        const o = ob[a], b = a * nq;
        for (let h = 0; h < nP; h++) out[h] += st[b + h] * o[h];
      }
      if (lk) return;
      const last = lastR[node];
      const fp = last > 0 ? cumPos[t - 1] / cumPos[last - 1] : 1, fn = last > 0 ? Math.pow(0.5, t - last) : 1;
      lastR[node] = t;
      for (let a = 0; a < nA; a++) {
        const o = ob[a], b = off + a * nq;
        for (let h = 0; h < nq; h++) { const r = R[b + h]; R[b + h] = (r > 0 ? r * fp : r * fn) + (o[h] - out[h]); }
      }
    } else {
      for (let h = 0; h < nP; h++) out[h] = 0;
      const rq = RB[d], tmp = TBf[d];
      const last = lastS[node];
      const fs = last > 0 ? Math.pow(last / t, GAMMA) : 0;
      if (!lk) lastS[node] = t;
      for (let a = 0; a < nA; a++) {
        const b = a * nq, bo = off + b;
        let any = 0;
        if (lk) { for (let h = 0; h < nq; h++) { const v = ro[h] * st[b + h]; rq[h] = v; any += v; } }
        else for (let h = 0; h < nq; h++) { const v = ro[h] * st[b + h]; rq[h] = v; any += v; SS[bo + h] = SS[bo + h] * fs + v; }
        if (any === 0) continue;
        cfr(CHN[s0 + a], p, rq, tmp, d + 1);
        for (let h = 0; h < nP; h++) out[h] += tmp[h];
      }
    }
  }

  function avgStrat(node, dst) {
    const q = PL[node], nA = NN[node], off = DO[node], nq = NCB[q];
    const lk = LOCKS.get(node);
    if (lk) { for (let i = 0; i < nA * nq; i++) dst[i] = lk[i]; return; }
    const sum = SUMB;
    for (let h = 0; h < nq; h++) sum[h] = 0;
    for (let a = 0; a < nA; a++) { const b = off + a * nq; for (let h = 0; h < nq; h++) sum[h] += SS[b + h]; }
    const u = 1 / nA;
    for (let h = 0; h < nq; h++) { const x = sum[h]; sum[h] = x > 0 ? 1 / x : 0; }
    for (let a = 0; a < nA; a++) {
      const b = off + a * nq, sb = a * nq;
      for (let h = 0; h < nq; h++) { const inv = sum[h]; dst[sb + h] = inv > 0 ? SS[b + h] * inv : u; }
    }
  }

  // evaluation with average strategies; br=true: player p best-responds
  function evalT(node, p, ro, out, d, br) {
    const ty = TY[node];
    if (ty >= T_FOLD) { terminal(node, p, ro, out); return; }
    if (ty === T_CHANCE) { chanceEval(node, p, ro, out, d, br); return; }
    const q = PL[node], nA = NN[node], s0 = CS[node], nq = NCB[q], nP = NCB[p];
    const st = SB[d];
    avgStrat(node, st);
    if (q === p) {
      const tmp = TBf[d];
      const useMax = br && !LOCKS.has(node);
      for (let a = 0; a < nA; a++) {
        evalT(CHN[s0 + a], p, ro, tmp, d + 1, br);
        const b = a * nq;
        if (useMax) { if (a === 0) for (let h = 0; h < nP; h++) out[h] = tmp[h]; else for (let h = 0; h < nP; h++) if (tmp[h] > out[h]) out[h] = tmp[h]; }
        else { if (a === 0) for (let h = 0; h < nP; h++) out[h] = st[b + h] * tmp[h]; else for (let h = 0; h < nP; h++) out[h] += st[b + h] * tmp[h]; }
      }
    } else {
      for (let h = 0; h < nP; h++) out[h] = 0;
      const rq = RB[d], tmp = TBf[d];
      for (let a = 0; a < nA; a++) {
        const b = a * nq; let any = false;
        for (let h = 0; h < nq; h++) { const v = ro[h] * st[b + h]; rq[h] = v; if (v !== 0) any = true; }
        if (!any) continue;
        evalT(CHN[s0 + a], p, rq, tmp, d + 1, br);
        for (let h = 0; h < nP; h++) out[h] += tmp[h];
      }
    }
  }

  // compatible opponent mass for each of p's combos
  function compatMass(p, ro, out) { foldTerm(p, ro, out, 1); }
  const ROOT0 = new Float64Array(maxN), ROOT1 = new Float64Array(maxN);
  let Z = 0;
  { compatMass(0, W64[1], ROOT0); for (let h = 0; h < NCB[0]; h++) Z += W64[0][h] * ROOT0[h]; }
  if (!(Z > 0)) throw new Error('The two ranges have no compatible hands on this board');

  // ---- cores: WebAssembly (SIMD) when available, JS reference otherwise ----
  const jsCore = {
    kind: 'js',
    iterate(tt) { alloc(); t = tt; growCum(t + 1); cfr(root, 0, W64[1], ROOT0, 0); cfr(root, 1, W64[0], ROOT1, 0); },
    exploit() {
      alloc();
      evalT(root, 0, W64[1], ROOT0, 0, true);
      let b0 = 0; for (let h = 0; h < NCB[0]; h++) b0 += W64[0][h] * ROOT0[h];
      evalT(root, 1, W64[0], ROOT1, 0, true);
      let b1 = 0; for (let h = 0; h < NCB[1]; h++) b1 += W64[1][h] * ROOT1[h];
      if (!ICM) return [b0, b1];
      evalT(root, 0, W64[1], ROOT0, 0, false);
      let v0 = 0; for (let h = 0; h < NCB[0]; h++) v0 += W64[0][h] * ROOT0[h];
      evalT(root, 1, W64[0], ROOT1, 0, false);
      let v1 = 0; for (let h = 0; h < NCB[1]; h++) v1 += W64[1][h] * ROOT1[h];
      return [b0, b1, v0, v1];
    },
    avgStrat(node) { alloc(); const q = PL[node]; const st = new Float64Array(NN[node] * NCB[q]); avgStrat(node, st); return st; },
    evalNode(node, p, ro, out) { alloc(); evalT(node, p, ro, out, 0, false); },
    compat(p, ro, out) { compatMass(p, ro, out); },
    memBytes() { return R ? dataSize * 8 : 0; },
    lock(node, strat) { if (strat) LOCKS.set(node, Float64Array.from(strat)); else LOCKS.delete(node); },
    isLocked(node) { return LOCKS.has(node); },
    nLocks() { return LOCKS.size; },
    reset() { if (R) { R.fill(0); SS.fill(0); lastR.fill(0); lastS.fill(0); } t = 0; }
  };
  function makeWasmCore() {
    if (!EM.PF_WASM_B64 || typeof WebAssembly === 'undefined') return null;
    if (!EM._pfModule) {
      const dec = (b64) => { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes; };
      try { EM._pfModule = new WebAssembly.Module(dec(EM.PF_WASM_B64)); EM._pfKind = 'wasm-simd'; }
      catch (e) { EM._pfModule = new WebAssembly.Module(dec(EM.PF_WASM_SCALAR_B64)); EM._pfKind = 'wasm'; }
    }
    const inst = new WebAssembly.Instance(EM._pfModule, {});
    const X = inst.exports, mem = X.memory;
    let top = (X.__heap_base.value + 15) & ~15;
    const plan = [];
    const al = (bytes) => { const at = top; top = (top + bytes + 15) & ~15; return at; };
    const MAXIT = 50002;
    const nCh = CHN.length;
    // collect board data
    let bdLen = 0; for (const B of boards) for (let p = 0; p < 2; p++) bdLen += B.ord[p].length * 3;
    let rdLen = 0; for (const ru of runouts) rdLen += ru.ids.length;
    const off = {
      TY: al(nNodes), PL: al(nNodes), NC0: al(nNodes * 4), NC1: al(nNodes * 4), ST: al(nNodes), CS: al(nNodes * 4), NN: al(nNodes * 4),
      DO: al(nNodes * 4), NX: al(nNodes * 4), LR: al(nNodes * 4), LS: al(nNodes * 4), CHN: al(nCh * 4), CHC: al(nCh),
      L1: [al(NCB[0]), al(NCB[1])], L2: [al(NCB[0]), al(NCB[1])], SAME: [al(NCB[0] * 4), al(NCB[1] * 4)],
      WOFF: [al(53 * 4), al(53 * 4)], WDAT: [al(NCB[0] * 2 * 4), al(NCB[1] * 2 * 4)],
      BOFF: al(boards.length * 6 * 4), BLEN: al(boards.length * 2 * 4), BD: al(bdLen * 2),
      ROFF: al((runouts.length + 1) * 4), RDAT: al(Math.max(1, rdLen) * 4), RW: al(Math.max(1, runouts.length) * 4),
      CUM: al(MAXIT * 8),
      RB: al(D * maxN * 4), TB: al(D * maxN * 4), SB: al(D * maxA * maxN * 4), OB: al(D * maxA * maxN * 4), SUMB: al(maxN * 4), ALLT: al(maxN * 4),
      W0: al(maxN * 4), W1: al(maxN * 4), O0: al(maxN * 4), O1: al(maxN * 4), RO: al(maxN * 4), OUT: al(maxN * 4), STB: al(maxA * maxN * 4),
      HDR: al(64 * 4), LOCKP: al(nNodes * 4), CHP: al(nCh), PHOFF: al(48 * 4),
      ICMP: al(4 * 4), U0: al((ICM ? ICM.n : 2) * 4), U1: al((ICM ? ICM.n : 2) * 4)
    };
    for (let si = 1; si < 24; si++) if (symOK[si]) off['PH' + si] = [al(NCB[0] * 4), al(NCB[1] * 4)];
    // full-precision storage when it fits comfortably, 16-bit with per-node scales otherwise
    const COMP = cfg.compress != null ? (cfg.compress ? 1 : 0) : (dataSize * 8 > COMPRESS_ABOVE ? 1 : 0);
    off.RSC = al(nNodes * 4); off.SSC = al(nNodes * 4);
    off.R = al(dataSize * (COMP ? 2 : 4)); off.SS = al(dataSize * (COMP ? 2 : 4));
    const need = top;
    let lockTop = top;
    const have = mem.buffer.byteLength;
    if (need > have) {
      const pages = Math.ceil((need - have) / 65536);
      try { mem.grow(pages); } catch (e) { throw new Error('Not enough memory for this tree (' + Math.round(need / 1048576) + ' MB). Use fewer bet sizes or narrower ranges.'); }
    }
    const u8 = (o, n) => new Uint8Array(mem.buffer, o, n), i8 = (o, n) => new Int8Array(mem.buffer, o, n), i32 = (o, n) => new Int32Array(mem.buffer, o, n),
      f32 = (o, n) => new Float32Array(mem.buffer, o, n), f64 = (o, n) => new Float64Array(mem.buffer, o, n), u16 = (o, n) => new Uint16Array(mem.buffer, o, n);
    u8(off.TY, nNodes).set(TY); i8(off.PL, nNodes).set(PL); f32(off.NC0, nNodes).set(NC0); f32(off.NC1, nNodes).set(NC1);
    u8(off.ST, nNodes).set(ST); i32(off.CS, nNodes).set(CS); i32(off.NN, nNodes).set(NN); i32(off.DO, nNodes).set(DO); i32(off.NX, nNodes).set(NX);
    i32(off.CHN, nCh).set(CHN); i8(off.CHC, nCh).set(CHC); u8(off.CHP, nCh).set(CHP);
    if (ICM) { f32(off.ICMP, 4).set([ICM.x0, ICM.dx, ICM.b0, P0]); f32(off.U0, ICM.n).set(ICM.u[0]); f32(off.U1, ICM.n).set(ICM.u[1]); }
    { const po = i32(off.PHOFF, 48); po.fill(0); for (let si = 1; si < 24; si++) if (symOK[si]) for (let p = 0; p < 2; p++) { i32(off['PH' + si][p], NCB[p]).set(PH[si][p]); po[si * 2 + p] = off['PH' + si][p]; } }
    for (let p = 0; p < 2; p++) {
      u8(off.L1[p], NCB[p]).set(L1[p]); u8(off.L2[p], NCB[p]).set(L2[p]); i32(off.SAME[p], NCB[p]).set(SAME[p]);
      const wo = i32(off.WOFF[p], 53), wd = i32(off.WDAT[p], NCB[p] * 2);
      let k = 0; for (let c = 0; c < 52; c++) { wo[c] = k; wd.set(WITH[p][c], k); k += WITH[p][c].length; } wo[52] = k;
    }
    { const bo = i32(off.BOFF, boards.length * 6), bl = i32(off.BLEN, boards.length * 2), bd = u16(off.BD, bdLen);
      let k = 0;
      boards.forEach((B, b) => {
        for (let p = 0; p < 2; p++) { bo[b * 6 + p] = k; bd.set(B.ord[p], k); k += B.ord[p].length; bl[b * 2 + p] = B.ord[p].length; }
        for (let p = 0; p < 2; p++) { bo[b * 6 + 2 + p] = k; bd.set(B.lt[p], k); k += B.lt[p].length; }
        for (let p = 0; p < 2; p++) { bo[b * 6 + 4 + p] = k; bd.set(B.le[p], k); k += B.le[p].length; }
      });
    }
    { const ro = i32(off.ROFF, runouts.length + 1), rd = i32(off.RDAT, Math.max(1, rdLen)), rw = f32(off.RW, Math.max(1, runouts.length));
      let k = 0; runouts.forEach((ru, i) => { ro[i] = k; rd.set(ru.ids, k); k += ru.ids.length; rw[i] = ru.w; }); ro[runouts.length] = k; }
    growCum(MAXIT); f64(off.CUM, MAXIT).set(cumPos.subarray(0, MAXIT));
    f32(off.W0, NCB[0]).set(WT[0]); f32(off.W1, NCB[1]).set(WT[1]);
    const hdr = [off.TY, off.PL, off.NC0, off.NC1, off.ST, off.CS, off.NN, off.DO, off.NX, off.LR, off.LS, off.CHN, off.CHC];
    for (let p = 0; p < 2; p++) hdr.push(NCB[p], off.L1[p], off.L2[p], off.SAME[p], off.WOFF[p], off.WDAT[p]);
    f32(off.RSC, nNodes).fill(1); f32(off.SSC, nNodes).fill(1);
    hdr.push(off.BOFF, off.BLEN, off.BD, off.ROFF, off.RDAT, off.RW, COMP, off.R, off.SS, off.RSC, off.SSC, off.CUM, maxN, maxA,
      off.RB, off.TB, off.SB, off.OB, off.SUMB, off.ALLT, off.LOCKP, off.CHP, off.PHOFF, ICM ? 1 : 0, off.ICMP, ICM ? ICM.n : 0, off.U0, off.U1);
    i32(off.HDR, hdr.length).set(hdr);
    X.init(off.HDR, P0);
    const nLock = new Set();
    let views = null;
    const V = () => { if (!views || views.buf !== mem.buffer) views = { buf: mem.buffer, O0: f32(off.O0, maxN), O1: f32(off.O1, maxN), RO: f32(off.RO, maxN), OUT: f32(off.OUT, maxN) }; return views; };
    return {
      kind: EM._pfKind + (COMP ? '-16bit' : ''),
      iterate(tt) { if (tt >= MAXIT - 1) throw new Error('Iteration limit reached'); t = tt; X.iterate(tt, root, off.W0, off.W1, off.O0, off.O1); },
      exploit() {
        X.evalNode(root, 0, off.W1, off.O0, 1);
        const O0 = V().O0; let b0 = 0; for (let h = 0; h < NCB[0]; h++) b0 += WT[0][h] * O0[h];
        X.evalNode(root, 1, off.W0, off.O1, 1);
        const O1 = V().O1; let b1 = 0; for (let h = 0; h < NCB[1]; h++) b1 += WT[1][h] * O1[h];
        if (!ICM) return [b0, b1];
        X.evalNode(root, 0, off.W1, off.O0, 0);
        let v0 = 0; { const O = V().O0; for (let h = 0; h < NCB[0]; h++) v0 += WT[0][h] * O[h]; }
        X.evalNode(root, 1, off.W0, off.O1, 0);
        let v1 = 0; { const O = V().O1; for (let h = 0; h < NCB[1]; h++) v1 += WT[1][h] * O[h]; }
        return [b0, b1, v0, v1];
      },
      avgStrat(node) { const n = NN[node] * NCB[PL[node]]; X.avgStrat(node, off.STB); return Float64Array.from(f32(off.STB, n)); },
      evalNode(node, p, ro, out) { const v = V(), no = NCB[1 - p]; for (let i = 0; i < no; i++) v.RO[i] = ro[i]; X.evalNode(node, p, off.RO, off.OUT, 0); const w = V(); for (let i = 0; i < NCB[p]; i++) out[i] = w.OUT[i]; },
      compat(p, ro, out) { const v = V(), no = NCB[1 - p]; for (let i = 0; i < no; i++) v.RO[i] = ro[i]; X.compat(p, off.RO, off.OUT); const w = V(); for (let i = 0; i < NCB[p]; i++) out[i] = w.OUT[i]; },
      memBytes() { return need; },
      lock(node, strat) {
        const lp = i32(off.LOCKP, nNodes);
        if (!strat) { lp[node] = 0; nLock.delete(node); return; }
        const bytes = strat.length * 4;
        if (lockTop + bytes > mem.buffer.byteLength) mem.grow(Math.ceil((lockTop + bytes - mem.buffer.byteLength) / 65536) + 1);
        f32(lockTop, strat.length).set(strat);
        i32(off.LOCKP, nNodes)[node] = lockTop; nLock.add(node);
        lockTop = (lockTop + bytes + 15) & ~15;
      },
      isLocked(node) { return nLock.has(node); },
      nLocks() { return nLock.size; },
      reset() {
        u8(off.R, dataSize * (COMP ? 2 : 4)).fill(0); u8(off.SS, dataSize * (COMP ? 2 : 4)).fill(0);
        i32(off.LR, nNodes).fill(0); i32(off.LS, nNodes).fill(0); f32(off.RSC, nNodes).fill(1); f32(off.SSC, nNodes).fill(1);
        t = 0;
      }
    };
  }
  let core = null;
  function getCore() {
    if (core) return core;
    if (cfg.engine !== 'js') { try { core = makeWasmCore(); } catch (e) { if (/memory/i.test(e.message)) throw e; core = null; } }
    if (!core) core = jsCore;
    return core;
  }

  function iterate(k) {
    const c = getCore();
    for (let i = 0; i < k; i++) c.iterate(t + 1);
  }
  function exploitability() {
    const [b0, b1, v0, v1] = getCore().exploit();
    if (ICM) {
      // general-sum: each player's gain from best-responding, in tournament equity; % of what the starting pot is worth
      const e = ((b0 - v0) + (b1 - v1)) / 2 / Z, scale = Math.max(1e-9, icmU(0, ICM.b0 + P0) - icmU(0, ICM.b0));
      return { chips: e, pct: e / scale * 100, br: [b0 / Z, b1 / Z], icm: true };
    }
    const e = (b0 / Z + b1 / Z) / 2;
    return { chips: e, pct: e / P0 * 100, br: [b0 / Z, b1 / Z] };
  }

  // equity of each combo vs the opponent's reach, over all runouts of the current board
  function equity(dealt, r) {
    let ids;
    const cardsKnown = nb + dealt.length;
    if (cardsKnown === 5) ids = [boardIdOf(dealt)];
    else if (cardsKnown === 4) {
      if (nb === 4) ids = Array.from(boards.keys());
      else { const tc = dealt[0]; ids = rest.filter(x => x !== tc).map(x => boardIdx[tc * 52 + x]); }
    } else ids = Array.from(boards.keys());
    const res = [];
    for (let p = 0; p < 2; p++) {
      const o = 1 - p, ro = r[o], nP = NCB[p];
      const W = new Float64Array(nP), Lo = new Float64Array(nP), Cm = new Float64Array(nP);
      const c1P = L1[p], c2P = L2[p], c1O = L1[o], c2O = L2[o], same = SAME[p];
      for (const bid of ids) {
        const B = boards[bid], ordP = B.ord[p], strP = B.str[p], ordO = B.ord[o], strO = B.str[o];
        const cs = CSUM; cs.fill(0);
        let tot = 0;
        for (let j = 0; j < ordO.length; j++) { const c = ordO[j], v = ro[c]; if (v) { tot += v; cs[c1O[c]] += v; cs[c2O[c]] += v; } }
        for (let i = 0; i < ordP.length; i++) { const h = ordP[i], k = same[h]; Cm[h] += tot - cs[c1P[h]] - cs[c2P[h]] + (k >= 0 ? ro[k] : 0); }
        cs.fill(0); tot = 0; let j = 0;
        for (let i = 0; i < ordP.length; i++) {
          const s = strP[i];
          while (j < ordO.length && strO[j] < s) { const c = ordO[j], v = ro[c]; if (v) { tot += v; cs[c1O[c]] += v; cs[c2O[c]] += v; } j++; }
          const h = ordP[i]; W[h] += tot - cs[c1P[h]] - cs[c2P[h]];
        }
        cs.fill(0); tot = 0; j = ordO.length - 1;
        for (let i = ordP.length - 1; i >= 0; i--) {
          const s = strP[i];
          while (j >= 0 && strO[j] > s) { const c = ordO[j], v = ro[c]; if (v) { tot += v; cs[c1O[c]] += v; cs[c2O[c]] += v; } j--; }
          const h = ordP[i]; Lo[h] += tot - cs[c1P[h]] - cs[c2P[h]];
        }
      }
      const eq = new Float32Array(nP);
      for (let h = 0; h < nP; h++) eq[h] = Cm[h] > 1e-12 ? (W[h] + 0.5 * (Cm[h] - W[h] - Lo[h])) / Cm[h] : NaN;
      res.push(eq);
    }
    return res;
  }

  function actionLabel(kind, amt, pot) {
    const pct = pot > 0 ? Math.round(amt / pot * 100) : 0;
    switch (kind) {
      case A_FOLD: return 'Fold';
      case A_CHECK: return 'Check';
      case A_CALL: return 'Call';
      case A_BET: return 'Bet ' + fmt(amt);
      case A_RAISE: return 'Raise ' + fmt(amt);
      case A_ALLIN: return 'All-in ' + fmt(amt);
    }
    return '?';
  }
  function fmt(x) { return (Math.round(x * 100) / 100).toString(); }

  // walk a path from the root: entries are action indices at player nodes and card ids at chance nodes
  // tau maps suits of the stored subtree to the suits the user picked; dealt holds stored cards, udealt the user's
  function walk(path) {
    let node = root, tau = [0, 1, 2, 3], shared = false;
    const r = [Float64Array.from(WT[0]), Float64Array.from(WT[1])];
    const dealt = [], udealt = [], line = [];
    for (const k of path) {
      const ty = TY[node];
      if (ty === T_PLAYER) {
        const q = PL[node], nq = NCB[q], nA = NN[node];
        if (!(k >= 0 && k < nA)) throw new Error('Bad action in path');
        const tmp = getCore().avgStrat(node);
        for (let h = 0; h < nq; h++) r[q][h] *= tmp[k * nq + h];
        line.push({ player: q, kind: CHK[CS[node] + k], amt: CHA[CS[node] + k], street: ST[node], pot: P0 + NC0[node] + NC1[node],
          toCall: Math.abs(NC0[node] - NC1[node]) });
        node = CHN[CS[node] + k];
      } else if (ty === T_CHANCE) {
        const s = CS[node], nc = NN[node];
        const tinv = [0, 0, 0, 0]; tau.forEach((x, i) => { tinv[x] = i; });
        const cc = k >= 0 && k < 52 ? pcard(tinv, k) : -1;
        let idx = -1; for (let i = 0; i < nc; i++) if (CHC[s + i] === cc) { idx = i; break; }
        if (idx < 0) throw new Error('Card not available');
        let can = cc;
        if (CHP[s + idx]) { const si = CHP[s + idx]; can = pcard(PINV[si], cc); tau = PERMS[si].map(x => tau[x]); }
        for (let p = 0; p < 2; p++) { const bl = WITH[p][can]; for (let i = 0; i < bl.length; i++) r[p][bl[i]] = 0; }
        for (let j = 0; j < nc && !shared; j++) if (j !== idx && CHN[s + j] === CHN[s + idx]) shared = true;
        dealt.push(can); udealt.push(k); line.push({ card: k, street: ST[node] + 1 });
        node = CHN[s + idx];
      } else throw new Error('Path goes past the end of the hand');
    }
    return { node, r, dealt, udealt, line, tau, shared };
  }
  // for each of the user's hands, the index of its stored twin (null when no suits were swapped)
  function twinMaps(tau) {
    if (tau[0] === 0 && tau[1] === 1 && tau[2] === 2 && tau[3] === 3) return null;
    const tinv = [0, 0, 0, 0]; tau.forEach((x, i) => { tinv[x] = i; });
    return [0, 1].map(p => Int32Array.from(G[p], gi => G2L[p][EM.PIDX[pcard(tinv, C1[gi]) * 52 + pcard(tinv, C2[gi])]]));
  }
  const remap = (arr, mp) => (mp && arr ? (arr instanceof Float32Array ? Float32Array : Float64Array).from(mp, j => arr[j]) : arr);

  function lock(path, strat) {
    const core = getCore();
    const { node, tau, shared } = walk(path);
    if (TY[node] !== T_PLAYER) throw new Error('Only decision points can be locked');
    // a node after a turn/river card is shared with that card's suit twins under isomorphism
    if (strat && shared) throw new Error('This turn/river node is shared with suit-equivalent cards. Turn off suit isomorphism and rebuild to lock it.');
    if (strat) {
      const nA = NN[node], nq = NCB[PL[node]], mp = twinMaps(tau);
      if (strat.length !== nA * nq) throw new Error('Lock needs ' + nA * nq + ' values');
      // the lock arrives in the user's suits: read each stored hand from its twin
      const src = new Int32Array(nq); for (let h = 0; h < nq; h++) src[mp ? mp[PL[node]][h] : h] = h;
      const L = new Float32Array(nA * nq);
      for (let h = 0; h < nq; h++) {
        let s = 0; for (let a = 0; a < nA; a++) { const v = Math.max(0, +strat[a * nq + src[h]] || 0); L[a * nq + h] = v; s += v; }
        for (let a = 0; a < nA; a++) L[a * nq + h] = s > 0 ? L[a * nq + h] / s : 1 / nA;
      }
      core.lock(node, L);
    } else core.lock(node, null);
    return core.nLocks();
  }
  function reset() { getCore().reset(); t = 0; }
  function nodeInfo(path, opts = {}) {
    const core = getCore();
    const { node, r, dealt, udealt, line, tau } = walk(path);
    const mp = twinMaps(tau);
    const ty = TY[node];
    const info = {
      type: ['player', 'chance', 'fold', 'showdown', 'allin'][ty], street: ST[node], pot: P0 + NC0[node] + NC1[node],
      c: [NC0[node], NC1[node]], stack: [S - NC0[node], S - NC1[node]], board: board.concat(udealt), line,
      reach: mp ? [remap(r[0], mp[0]), remap(r[1], mp[1])] : r, combos: [G[0], G[1]]
    };
    if (ty === T_PLAYER) {
      const q = PL[node], nA = NN[node], s0 = CS[node], nq = NCB[q], o = 1 - q;
      info.player = q;
      if (ICM) info.icm = true;
      info.locked = core.isLocked(node);
      const pot = P0 + NC0[node] + NC1[node];
      const cq0 = q === 0 ? NC0[node] : NC1[node], co0 = q === 0 ? NC1[node] : NC0[node];
      const toCall = co0 - cq0;
      info.toCall = toCall;
      info.actions = [];
      for (let a = 0; a < nA; a++) {
        const kind = CHK[s0 + a], amt = CHA[s0 + a], ch = CHN[s0 + a];
        let pct = null, xBet = null;
        if (kind >= A_BET) {
          const mine = cq0 - BASE[node], theirs = co0 - BASE[node];
          pct = toCall > 1e-9 ? (amt - theirs) / (pot + toCall) * 100 : (amt - mine) / pot * 100;
          if (toCall > 1e-9 && theirs > 1e-9) xBet = Math.round(amt / theirs * 10) / 10;   // the raise as a multiple of the bet faced
        }
        const label = kind === A_CALL ? 'Call ' + fmt(toCall) : actionLabel(kind, amt, pot);
        info.actions.push({ kind, amt, label, pctPot: pct == null ? null : Math.round(pct), xBet,
          childType: ['player', 'chance', 'fold', 'showdown', 'allin'][TY[ch]] });
      }
      const st = core.avgStrat(node);
      info.strategy = mp ? Float32Array.from({ length: nA * nq }, (_, i) => st[((i / nq) | 0) * nq + mp[q][i % nq]]) : st;
      if (opts.ev !== false) {
        const cm = new Float64Array(maxN);
        core.compat(q, r[o], cm);
        const cq = q === 0 ? NC0[node] : NC1[node];
        const evA = [];
        const buf = new Float64Array(maxN);
        for (let a = 0; a < nA; a++) {
          core.evalNode(CHN[s0 + a], q, r[o], buf);
          const e = new Float32Array(nq);
          const base = ICM ? -icmFold(q, NC0[node], NC1[node]) : P0 / 2 + cq;
          for (let h = 0; h < nq; h++) e[h] = cm[h] > 1e-12 ? buf[h] / cm[h] + base : NaN;
          evA.push(e);
        }
        info.evActions = mp ? evA.map(e => remap(e, mp[q])) : evA;
        const ev = new Float32Array(nq);
        for (let h = 0; h < nq; h++) { let v = 0; for (let a = 0; a < nA; a++) v += st[a * nq + h] * evA[a][h]; ev[h] = v; }
        const cmo = new Float64Array(maxN);
        core.compat(o, r[q], cmo);
        core.evalNode(node, o, r[q], buf);
        const co = o === 0 ? NC0[node] : NC1[node];
        const evo = new Float32Array(NCB[o]);
        const baseO = ICM ? -icmFold(o, NC0[node], NC1[node]) : P0 / 2 + co;
        for (let h = 0; h < NCB[o]; h++) evo[h] = cmo[h] > 1e-12 ? buf[h] / cmo[h] + baseO : NaN;
        info.ev = q === 0 ? [ev, evo] : [evo, ev];
        if (mp) info.ev = [remap(info.ev[0], mp[0]), remap(info.ev[1], mp[1])];
      }
    } else if (ty === T_CHANCE) {
      const s = CS[node], nc = NN[node];
      info.cards = Array.from(CHC.subarray(s, s + nc), c => pcard(tau, c));
    }
    if (opts.equity !== false && (ty === T_PLAYER || ty === T_CHANCE)) { info.equity = equity(dealt, r); if (mp) info.equity = [remap(info.equity[0], mp[0]), remap(info.equity[1], mp[1])]; }
    return info;
  }

  // runout report: for every card at a chance node, the first decision's action mix and both players' EV and equity
  // (range averages weighted by reach x compatible opponent mass). Suit-equivalent cards share a subtree: computed once.
  function runoutReport(path) {
    const core = getCore(), w0 = walk(path);
    if (TY[w0.node] !== T_CHANCE) throw new Error('Runout reports start at a turn or river card');
    const s = CS[w0.node], nc = NN[w0.node], memo = new Map(), out = [];
    const cm = new Float64Array(maxN), buf = new Float64Array(maxN);
    for (let k = 0; k < nc; k++) {
      const card = pcard(w0.tau, CHC[s + k]), child = CHN[s + k];
      if (!memo.has(child)) {
        const { node, r, dealt } = walk(path.concat([card]));
        let res = null;
        if (TY[node] === T_PLAYER) {
          const q = PL[node], o = 1 - q, nA = NN[node], s0 = CS[node], nq = NCB[q], st = core.avgStrat(node), eq = equity(dealt, r);
          const cq = q === 0 ? NC0[node] : NC1[node], co = q === 0 ? NC1[node] : NC0[node], pot = P0 + NC0[node] + NC1[node];
          const fr = new Float64Array(nA), agg = [];
          for (const pq of [q, o]) {
            core.compat(pq, r[1 - pq], cm);
            core.evalNode(node, pq, r[1 - pq], buf);
            const base = ICM ? -icmFold(pq, NC0[node], NC1[node]) : P0 / 2 + (pq === q ? cq : co);
            let w = 0, ev = 0, eqs = 0;
            for (let h = 0; h < NCB[pq]; h++) {
              const wh = r[pq][h] * cm[h]; if (!(wh > 0)) continue;
              w += wh; ev += r[pq][h] * (buf[h] + base * cm[h]); if (eq[pq][h] >= 0) eqs += wh * eq[pq][h];
              if (pq === q) for (let a = 0; a < nA; a++) fr[a] += wh * st[a * nq + h];
            }
            agg.push([w, ev, eqs]);
          }
          res = { player: q, pot, actions: Array.from({ length: nA }, (_, a) => ({ kind: CHK[s0 + a], label: CHK[s0 + a] === A_CALL ? 'Call ' + fmt(co - cq) : actionLabel(CHK[s0 + a], CHA[s0 + a], pot) })),
            freq: Array.from(fr, x => agg[0][0] > 0 ? x / agg[0][0] : 0), evAvg: agg[0][0] > 0 ? agg[0][1] / agg[0][0] : 0, eqAvg: agg[0][0] > 0 ? agg[0][2] / agg[0][0] : 0,
            evOpp: agg[1][0] > 0 ? agg[1][1] / agg[1][0] : 0, eqOpp: agg[1][0] > 0 ? agg[1][2] / agg[1][0] : 0 };
        }
        memo.set(child, res);
      }
      out.push({ card, info: memo.get(child) });
    }
    return out;
  }

  return {
    stats, iterate, exploitability, nodeInfo, runouts: runoutReport, lock, reset, P0, S, board, combos: G, weights: WT,
    get iterations() { return t; }, get engine() { return getCore().kind; }, memBytes: () => getCore().memBytes(),
    // for tests
    _internal: { root, TY, PL, CS, NN, CHN, CHK, CHA, NCB, avgStrat, walk }
  };
}

EM.PostflopGame = PostflopGame;
EM.parseSizes = parseSizes;
EM.postflopEngineCfg = engineCfg;
EM.fmtSizeCode = fmtSizeCode;
EM.ACT = { A_FOLD, A_CHECK, A_CALL, A_BET, A_RAISE, A_ALLIN };
})(globalThis.EM || (globalThis.EM = {}));
