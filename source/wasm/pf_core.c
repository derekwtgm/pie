// Postflop CFR core (compiled to WebAssembly). Mirrors the JS reference core.
// Vector-form Discounted CFR (alpha 1.5, beta 0, gamma 2), alternating updates,
// lazy discounting, zero-reach pruning, O(n) showdowns with card removal.
// Regrets are stored as int16 and strategy sums as uint16, each with a per-node scale.
typedef unsigned char u8; typedef unsigned short u16; typedef int i32; typedef float f32; typedef double f64;
#define EXPORT(n) __attribute__((export_name(n)))
enum { T_PLAYER = 0, T_CHANCE = 1, T_FOLD = 2, T_SHOW = 3, T_ALLIN = 4 };

static const u8 *TY; static const signed char *PL; static const f32 *NC0, *NC1; static const u8 *ST;
static const i32 *CS, *NN, *DO, *NX; static i32 *LASTR, *LASTS;
static const i32 *CHN; static const signed char *CHC;
static i32 NCB[2]; static const u8 *L1[2], *L2[2]; static const i32 *SAME[2];
static const i32 *WOFF[2], *WDAT[2];
static const i32 *BOFF, *BLEN; static const u16 *BDATA;
static const i32 *ROFF, *RDAT; static const f32 *RW;
static short *R; static u16 *SS; static f32 *RSC, *SSC; static f32 *R32, *S32; static i32 COMP; static const f64 *CUM;
static f32 P0H;
static i32 MAXN, MAXA;
static f32 *RB, *TB, *SB, *OB, *SUMB, *ALLT;
static i32 T;
static const i32 *LOCKP;   // per node: address of a locked strategy (nA*nq floats) or 0
static const u8 *CHP;      // per child: suit permutation id for cards that share a twin's subtree (0 = own subtree)
static const i32 *PHOFF;   // [perm*2+player]: address of the hand map for that permutation
static i32 ICMON, ICMN; static const f32 *ICMP, *ICMU[2];   // ICM: params {x0, dx, b0, P0} and equity tables over OOP's final stack

EXPORT("init") void init(const i32 *h, f32 p0) {
  int k = 0;
  TY = (const u8 *)h[k++]; PL = (const signed char *)h[k++]; NC0 = (const f32 *)h[k++]; NC1 = (const f32 *)h[k++];
  ST = (const u8 *)h[k++]; CS = (const i32 *)h[k++]; NN = (const i32 *)h[k++]; DO = (const i32 *)h[k++]; NX = (const i32 *)h[k++];
  LASTR = (i32 *)h[k++]; LASTS = (i32 *)h[k++]; CHN = (const i32 *)h[k++]; CHC = (const signed char *)h[k++];
  for (int p = 0; p < 2; p++) {
    NCB[p] = h[k++]; L1[p] = (const u8 *)h[k++]; L2[p] = (const u8 *)h[k++]; SAME[p] = (const i32 *)h[k++];
    WOFF[p] = (const i32 *)h[k++]; WDAT[p] = (const i32 *)h[k++];
  }
  BOFF = (const i32 *)h[k++]; BLEN = (const i32 *)h[k++]; BDATA = (const u16 *)h[k++];
  ROFF = (const i32 *)h[k++]; RDAT = (const i32 *)h[k++]; RW = (const f32 *)h[k++];
  COMP = h[k++];
  if (COMP) { R = (short *)h[k++]; SS = (u16 *)h[k++]; } else { R32 = (f32 *)h[k++]; S32 = (f32 *)h[k++]; }
  RSC = (f32 *)h[k++]; SSC = (f32 *)h[k++]; CUM = (const f64 *)h[k++];
  MAXN = h[k++]; MAXA = h[k++];
  RB = (f32 *)h[k++]; TB = (f32 *)h[k++]; SB = (f32 *)h[k++]; OB = (f32 *)h[k++]; SUMB = (f32 *)h[k++]; ALLT = (f32 *)h[k++];
  LOCKP = (const i32 *)h[k++];
  CHP = (const u8 *)h[k++]; PHOFF = (const i32 *)h[k++];
  ICMON = h[k++]; ICMP = (const f32 *)h[k++]; ICMN = h[k++]; ICMU[0] = (const f32 *)h[k++]; ICMU[1] = (const f32 *)h[k++];
  P0H = p0 * 0.5f;
  T = 0;
}

// out = pw * (opponent mass we beat) + pl * (mass we lose to) + ut * (all compatible mass on this board)
static void showdown(int bid, int p, const f32 *ro, f32 *restrict out, f32 pw, f32 pl, f32 ut) {
  const int o = 1 - p;
  const i32 *bo = BOFF + bid * 6;
  const int mP = BLEN[bid * 2 + p], mO = BLEN[bid * 2 + o];
  const u16 *ordP = BDATA + bo[p], *ordO = BDATA + bo[o], *lt = BDATA + bo[2 + p], *le = BDATA + bo[4 + p];
  const int nP = NCB[p];
  const u8 *c1P = L1[p], *c2P = L2[p], *c1O = L1[o], *c2O = L2[o];
  for (int h = 0; h < nP; h++) out[h] = 0.f;
  f64 cs[52]; for (int k = 0; k < 52; k++) cs[k] = 0;
  f64 tot = 0; int j = 0;
  for (int i = 0; i < mP; i++) {
    const int lim = lt[i];
    while (j < lim) { const int c = ordO[j++]; const f32 r = ro[c]; if (r != 0.f) { tot += r; cs[c1O[c]] += r; cs[c2O[c]] += r; } }
    const int h = ordP[i];
    out[h] = (f32)(tot - cs[c1P[h]] - cs[c2P[h]]);
  }
  for (int k = 0; k < 52; k++) cs[k] = 0;
  tot = 0; j = mO - 1;
  for (int i = mP - 1; i >= 0; i--) {
    const int lim = le[i];
    while (j >= lim) { const int c = ordO[j--]; const f32 r = ro[c]; if (r != 0.f) { tot += r; cs[c1O[c]] += r; cs[c2O[c]] += r; } }
    const int h = ordP[i];
    out[h] = (f32)(pw * out[h] + pl * (tot - cs[c1P[h]] - cs[c2P[h]]));
  }
  if (ut != 0.f) {
    for (int k = 0; k < 52; k++) cs[k] = 0;
    tot = 0;
    for (int k = 0; k < mO; k++) { const int c = ordO[k]; const f32 r = ro[c]; if (r != 0.f) { tot += r; cs[c1O[c]] += r; cs[c2O[c]] += r; } }
    const i32 *same = SAME[p];
    for (int i = 0; i < mP; i++) { const int h = ordP[i], k = same[h]; out[h] += (f32)(ut * (tot - cs[c1P[h]] - cs[c2P[h]] + (k >= 0 ? ro[k] : 0.f))); }
  }
}

static void foldTerm(int p, const f32 *ro, f32 *restrict out, f32 pay) {
  const int o = 1 - p, nO = NCB[o], nP = NCB[p];
  const u8 *c1O = L1[o], *c2O = L2[o], *c1P = L1[p], *c2P = L2[p];
  const i32 *same = SAME[p];
  f64 cs[52]; for (int k = 0; k < 52; k++) cs[k] = 0;
  f64 tot = 0;
  for (int c = 0; c < nO; c++) { const f32 r = ro[c]; if (r != 0.f) { tot += r; cs[c1O[c]] += r; cs[c2O[c]] += r; } }
  for (int h = 0; h < nP; h++) {
    const int k = same[h];
    out[h] = (f32)(pay * (tot - cs[c1P[h]] - cs[c2P[h]] + (k >= 0 ? ro[k] : 0.f)));
  }
}

static void allinTerm(int node, int p, const f32 *ro, f32 *restrict out, f32 pw, f32 pl, f32 ut) {
  const int rid = NX[node];
  const i32 *ids = RDAT + ROFF[rid];
  const int nid = ROFF[rid + 1] - ROFF[rid];
  const f32 w = RW[rid];
  const int nP = NCB[p];
  for (int h = 0; h < nP; h++) out[h] = 0.f;
  for (int k = 0; k < nid; k++) {
    showdown(ids[k], p, ro, ALLT, pw, pl, ut);
    for (int h = 0; h < nP; h++) out[h] += ALLT[h];
  }
  for (int h = 0; h < nP; h++) out[h] *= w;
}

static f32 icmU(int p, f32 x) {
  f32 f = (x - ICMP[0]) / ICMP[1]; if (!(f > 0.f)) f = 0.f; if (f > (f32)(ICMN - 1)) f = (f32)(ICMN - 1);
  int i = (int)f; if (i > ICMN - 2) i = ICMN - 2;
  const f32 w = f - (f32)i, *u = ICMU[p];
  return u[i] + (u[i + 1] - u[i]) * w;
}
static void terminal(int node, int p, const f32 *ro, f32 *out) {
  const int ty = TY[node];
  if (ICMON) {
    const f32 c0 = NC0[node], pot = ICMP[3] + c0 + NC1[node], xl = ICMP[2] - c0, xw = xl + pot;
    if (ty == T_FOLD) { foldTerm(p, ro, out, icmU(p, PL[node] == 0 ? xl : xw)); return; }
    const f32 uw = icmU(p, p == 0 ? xw : xl), ul = icmU(p, p == 0 ? xl : xw), ut = icmU(p, xl + 0.5f * pot);
    if (ty == T_SHOW) showdown(NX[node], p, ro, out, uw - ut, ul - ut, ut); else allinTerm(node, p, ro, out, uw - ut, ul - ut, ut);
    return;
  }
  if (ty == T_FOLD) {
    const int f = PL[node];
    const f32 cf = f == 0 ? NC0[node] : NC1[node];
    foldTerm(p, ro, out, (f == p ? -1.f : 1.f) * (P0H + cf));
  } else if (ty == T_SHOW) { const f32 pay = P0H + NC0[node]; showdown(NX[node], p, ro, out, pay, -pay, 0.f); }
  else { const f32 pay = P0H + NC0[node]; allinTerm(node, p, ro, out, pay, -pay, 0.f); }
}

static inline f32 chanceW(int node) { return ST[node] == 0 ? 1.f / 45.f : 1.f / 44.f; }

static void cfr(int node, int p, const f32 *ro, f32 *out, int d);
static void evalT(int node, int p, const f32 *ro, f32 *out, int d, int br);

static void chanceNode(int node, int p, const f32 *ro, f32 *restrict out, int d, int mode, int br) {
  const int o = 1 - p, nO = NCB[o], nP = NCB[p];
  for (int h = 0; h < nP; h++) out[h] = 0.f;
  f32 *restrict r2 = RB + d * MAXN, *restrict tmp = TB + d * MAXN;
  const int s = CS[node], nc = NN[node];
  for (int k = 0; k < nc; k++) {
    if (CHP[s + k]) continue;
    const int card = CHC[s + k];
    for (int c = 0; c < nO; c++) r2[c] = ro[c];
    { const i32 *bl = WDAT[o] + WOFF[o][card]; const int nb = WOFF[o][card + 1] - WOFF[o][card]; for (int q = 0; q < nb; q++) r2[bl[q]] = 0.f; }
    if (mode == 0) cfr(CHN[s + k], p, r2, tmp, d + 1); else evalT(CHN[s + k], p, r2, tmp, d + 1, br);
    { const i32 *bl = WDAT[p] + WOFF[p][card]; const int nb = WOFF[p][card + 1] - WOFF[p][card]; for (int q = 0; q < nb; q++) tmp[bl[q]] = 0.f; }
    for (int h = 0; h < nP; h++) out[h] += tmp[h];
    for (int k2 = k + 1; k2 < nc; k2++) if (CHP[s + k2] && CHN[s + k2] == CHN[s + k]) {
      const i32 *ph = (const i32 *)PHOFF[CHP[s + k2] * 2 + p];
      for (int h = 0; h < nP; h++) out[h] += tmp[ph[h]];
    }
  }
  const f32 w = chanceW(node);
  for (int h = 0; h < nP; h++) out[h] *= w;
}

// current strategy by regret matching (the per-node scale cancels out)
static void regretMatch(int off, int nA, int nq, f32 *restrict st) {
  f32 *restrict sum = SUMB;
  for (int h = 0; h < nq; h++) sum[h] = 0.f;
  if (COMP) for (int a = 0; a < nA; a++) {
    const short *restrict r = R + off + a * nq; f32 *restrict s = st + a * nq;
    for (int h = 0; h < nq; h++) { const f32 v = (f32)r[h]; const f32 x = v > 0.f ? v : 0.f; s[h] = x; sum[h] += x; }
  } else for (int a = 0; a < nA; a++) {
    const f32 *restrict r = R32 + off + a * nq; f32 *restrict s = st + a * nq;
    for (int h = 0; h < nq; h++) { const f32 v = r[h]; const f32 x = v > 0.f ? v : 0.f; s[h] = x; sum[h] += x; }
  }
  const f32 u = 1.f / (f32)nA;
  for (int h = 0; h < nq; h++) sum[h] = sum[h] > 0.f ? 1.f / sum[h] : 0.f;
  for (int a = 0; a < nA; a++) {
    f32 *restrict s = st + a * nq;
    for (int h = 0; h < nq; h++) s[h] = sum[h] > 0.f ? s[h] * sum[h] : u;
  }
}

static void avgStratInto(int node, f32 *restrict dst) {
  const int q = PL[node], nA = NN[node], off = DO[node], nq = NCB[q];
  if (LOCKP[node]) { const f32 *lk = (const f32 *)LOCKP[node]; for (int i = 0; i < nA * nq; i++) dst[i] = lk[i]; return; }
  f32 *restrict sum = SUMB;
  for (int h = 0; h < nq; h++) sum[h] = 0.f;
  if (COMP) for (int a = 0; a < nA; a++) { const u16 *restrict s = SS + off + a * nq; for (int h = 0; h < nq; h++) sum[h] += (f32)s[h]; }
  else for (int a = 0; a < nA; a++) { const f32 *restrict s = S32 + off + a * nq; for (int h = 0; h < nq; h++) sum[h] += s[h]; }
  const f32 u = 1.f / (f32)nA;
  for (int h = 0; h < nq; h++) sum[h] = sum[h] > 0.f ? 1.f / sum[h] : 0.f;
  if (COMP) for (int a = 0; a < nA; a++) {
    const u16 *restrict s = SS + off + a * nq; f32 *restrict o = dst + a * nq;
    for (int h = 0; h < nq; h++) o[h] = sum[h] > 0.f ? (f32)s[h] * sum[h] : u;
  } else for (int a = 0; a < nA; a++) {
    const f32 *restrict s = S32 + off + a * nq; f32 *restrict o = dst + a * nq;
    for (int h = 0; h < nq; h++) o[h] = sum[h] > 0.f ? s[h] * sum[h] : u;
  }
}

static void cfr(int node, int p, const f32 *ro, f32 *restrict out, int d) {
  const int ty = TY[node];
  if (ty >= T_FOLD) { terminal(node, p, ro, out); return; }
  if (ty == T_CHANCE) { chanceNode(node, p, ro, out, d, 0, 0); return; }
  const int q = PL[node], nA = NN[node], off = DO[node], s0 = CS[node], nq = NCB[q], nP = NCB[p];
  f32 *restrict st = SB + d * MAXA * MAXN;
  const f32 *lk = LOCKP[node] ? (const f32 *)LOCKP[node] : 0;
  if (lk) { for (int i = 0; i < nA * nq; i++) st[i] = lk[i]; } else regretMatch(off, nA, nq, st);
  if (q == p) {
    f32 *ob = OB + d * MAXA * MAXN;
    for (int a = 0; a < nA; a++) cfr(CHN[s0 + a], p, ro, ob + a * MAXN, d + 1);
    for (int h = 0; h < nP; h++) out[h] = 0.f;
    for (int a = 0; a < nA; a++) {
      const f32 *restrict o = ob + a * MAXN, *restrict s = st + a * nq;
      for (int h = 0; h < nP; h++) out[h] += s[h] * o[h];
    }
    if (lk) return;
    const int last = LASTR[node];
    const f32 fp = last > 0 ? (f32)(CUM[T - 1] / CUM[last - 1]) : 1.f;
    f32 fn = 1.f; if (last > 0) { const int e = T - last; fn = e >= 60 ? 0.f : (f32)(1.0 / (f64)(1ULL << e)); }
    LASTR[node] = T;
    if (!COMP) {
      for (int a = 0; a < nA; a++) {
        const f32 *restrict o = ob + a * MAXN; f32 *restrict r = R32 + off + a * nq;
        for (int h = 0; h < nq; h++) { const f32 x = r[h]; r[h] = (x > 0.f ? x * fp : x * fn) + (o[h] - out[h]); }
      }
      return;
    }
    const f32 sc = RSC[node];
    f32 mx = 0.f;
    for (int a = 0; a < nA; a++) {   // st is free now: reuse it for the decoded regrets
      const f32 *restrict o = ob + a * MAXN; const short *restrict r = R + off + a * nq; f32 *restrict tr = st + a * nq;
      for (int h = 0; h < nq; h++) {
        const f32 x0 = (f32)r[h] * sc;
        const f32 x = (x0 > 0.f ? x0 * fp : x0 * fn) + (o[h] - out[h]);
        tr[h] = x; const f32 ax = x < 0.f ? -x : x; mx = ax > mx ? ax : mx;
      }
    }
    const f32 ns = mx > 0.f ? mx / 32767.f : 1.f, inv = 1.f / ns;
    for (int a = 0; a < nA; a++) {
      const f32 *restrict tr = st + a * nq; short *restrict r = R + off + a * nq;
      for (int h = 0; h < nq; h++) { const f32 y = tr[h] * inv; r[h] = (short)(y >= 0.f ? y + 0.5f : y - 0.5f); }
    }
    RSC[node] = ns;
  } else {
    for (int h = 0; h < nP; h++) out[h] = 0.f;
    f32 *restrict rq = RB + d * MAXN, *restrict tmp = TB + d * MAXN;
    const int last = LASTS[node];
    f32 fs = 0.f;
    if (last > 0) { const f64 x = (f64)last / (f64)T; fs = (f32)(x * x * x); }
    if (!lk) LASTS[node] = T;
    if (lk) {
    } else if (!COMP) {
      for (int a = 0; a < nA; a++) {
        const f32 *restrict s = st + a * nq; f32 *restrict ss = S32 + off + a * nq;
        for (int h = 0; h < nq; h++) ss[h] = ss[h] * fs + ro[h] * s[h];
      }
    } else {
      const f32 sc = SSC[node] * fs;
      f32 *restrict tmpS = OB + d * MAXA * MAXN;   // OB is unused at opponent nodes
      f32 mx = 0.f;
      for (int a = 0; a < nA; a++) {
        const f32 *restrict s = st + a * nq; const u16 *restrict ss = SS + off + a * nq; f32 *restrict ts = tmpS + a * nq;
        for (int h = 0; h < nq; h++) { const f32 x = (f32)ss[h] * sc + ro[h] * s[h]; ts[h] = x; mx = x > mx ? x : mx; }
      }
      const f32 ns = mx > 0.f ? mx / 65535.f : 1.f, inv = 1.f / ns;
      for (int a = 0; a < nA; a++) {
        const f32 *restrict ts = tmpS + a * nq; u16 *restrict ss = SS + off + a * nq;
        for (int h = 0; h < nq; h++) ss[h] = (u16)(ts[h] * inv + 0.5f);
      }
      SSC[node] = ns;
    }
    for (int a = 0; a < nA; a++) {
      const f32 *restrict s = st + a * nq;
      f32 any = 0.f;
      for (int h = 0; h < nq; h++) { const f32 v = ro[h] * s[h]; rq[h] = v; any += v; }
      if (any == 0.f) continue;
      cfr(CHN[s0 + a], p, rq, tmp, d + 1);
      for (int h = 0; h < nP; h++) out[h] += tmp[h];
    }
  }
}

static void evalT(int node, int p, const f32 *ro, f32 *restrict out, int d, int br) {
  const int ty = TY[node];
  if (ty >= T_FOLD) { terminal(node, p, ro, out); return; }
  if (ty == T_CHANCE) { chanceNode(node, p, ro, out, d, 1, br); return; }
  const int q = PL[node], nA = NN[node], s0 = CS[node], nq = NCB[q], nP = NCB[p];
  f32 *restrict st = SB + d * MAXA * MAXN;
  avgStratInto(node, st);
  f32 *restrict tmp = TB + d * MAXN;
  if (q == p) {
    const int useMax = br && !LOCKP[node];
    for (int a = 0; a < nA; a++) {
      evalT(CHN[s0 + a], p, ro, tmp, d + 1, br);
      const f32 *restrict s = st + a * nq;
      if (useMax) { if (a == 0) for (int h = 0; h < nP; h++) out[h] = tmp[h]; else for (int h = 0; h < nP; h++) out[h] = tmp[h] > out[h] ? tmp[h] : out[h]; }
      else { if (a == 0) for (int h = 0; h < nP; h++) out[h] = s[h] * tmp[h]; else for (int h = 0; h < nP; h++) out[h] += s[h] * tmp[h]; }
    }
  } else {
    for (int h = 0; h < nP; h++) out[h] = 0.f;
    f32 *restrict rq = RB + d * MAXN;
    for (int a = 0; a < nA; a++) {
      const f32 *restrict s = st + a * nq;
      f32 any = 0.f;
      for (int h = 0; h < nq; h++) { const f32 v = ro[h] * s[h]; rq[h] = v; any += v; }
      if (any == 0.f) continue;
      evalT(CHN[s0 + a], p, rq, tmp, d + 1, br);
      for (int h = 0; h < nP; h++) out[h] += tmp[h];
    }
  }
}

// one DCFR iteration t: traversal for player 0 then player 1
EXPORT("iterate") void iterate(int t, int root, const f32 *w0, const f32 *w1, f32 *out0, f32 *out1) {
  T = t;
  cfr(root, 0, w1, out0, 0);
  cfr(root, 1, w0, out1, 0);
}
EXPORT("evalNode") void evalNode(int node, int p, const f32 *ro, f32 *out, int br) { evalT(node, p, ro, out, 0, br); }
EXPORT("avgStrat") void avgStrat(int node, f32 *dst) { avgStratInto(node, dst); }
EXPORT("compat") void compat(int p, const f32 *ro, f32 *out) { foldTerm(p, ro, out, 1.f); }
