// EightMax GPU kernel (OpenCL C 1.2). The same source compiles as C for the built-in emulator
// (EM_EMU), which runs every work-item as a real thread with real barriers, so logic and
// synchronisation are checked without a GPU.
//
// River regrets/strategy sums may span two buffers (R0/S0 below SPL, R1/S1 from SPL on): one
// buffer is capped at a quarter of GPU memory by NVIDIA's OpenCL. A node never straddles the split.
// With comp = 1 they are 16-bit like the CPU's compact mode: regrets as short times a per-node scale
// (RSC), strategy sums as ushort times SSC; each update finds the node's new maximum first (a
// work-group reduction) and then rewrites the node with the new scale.
//
// river_solve: each work-group takes requests (river chance nodes reached by the CPU pass) from a
// shared counter. For every canonical river card it walks the river subtree (contiguous node ids,
// parents first):
//   top-down:  opponent reach (and the opponent's strategy sums when training); children of the
//              traverser's own nodes share their parent's reach buffer; subtrees no opponent hand
//              reaches are flagged and skipped, like the CPU engine's zero-reach pruning
//   bottom-up: traverser values (and regrets when training); mode 1 = average strategy, 2 = best response
// and adds the card's values (plus its suit-isomorphic twins) into the request's output row.
#ifdef EM_EMU
#include "gpu_emu.h"
#else
#define FN
#endif

#define T_PLAYER 0
#define T_FOLD 2
#define T_SHOW 3
#define MAXA 16
// local ints: 0 request, 2-4 action-mask slots, 5-7 maximum slots (rotating), 8 bottom-up maximum
// local float layout: prefix sums (up to 3 x 1326 + 1), then two scan buffers of one float per work-item
#define L_P 0
#define L_PA 3984

FN float icm_u(__global const float *T, const int p, const float x) {
  // T: x0, dx, b0, P0, n, then u0[n], u1[n]
  const int n = (int)T[4];
  float f = (x - T[0]) / T[1];
  if (!(f > 0.f)) f = 0.f;
  if (f > (float)(n - 1)) f = (float)(n - 1);
  int i = (int)f;
  if (i > n - 2) i = n - 2;
  const float wt = f - (float)i;
  __global const float *u = T + 5 + p * n;
  return u[i] + (u[i + 1] - u[i]) * wt;
}

// value k of the gathered sequence: showdown (sd = 1): opponent reach in strength order, then per-card
// lists of positions; fold (sd = 0): opponent reach by hand, then the per-card hand lists
FN float gat(const int sd, const int k, const int n1, __global const float *rj, __global const ushort *ordO, __global const ushort *cl, __global const int *wd) {
  if (sd) return k < n1 ? rj[ordO[k]] : rj[ordO[cl[k - n1]]];
  return k < n1 ? rj[k] : rj[wd[k - n1]];
}
// exclusive prefix sums P[0..n] of the gathered sequence (P[n] = total); every work-item must call it
FN void block_scan(__local float *P, __local float *PA, __local float *PB, const int n, const int lid, const int wg,
    const int sd, const int n1, __global const float *rj, __global const ushort *ordO, __global const ushort *cl, __global const int *wd) {
  const int chunk = (n + wg - 1) / wg, lo0 = lid * chunk, lo = lo0 < n ? lo0 : n, hi0 = lo + chunk, hi = hi0 < n ? hi0 : n;
  float s = 0.f;
  for (int k = lo; k < hi; k++) s += gat(sd, k, n1, rj, ordO, cl, wd);
  PA[lid] = s;
  barrier(CLK_LOCAL_MEM_FENCE);
  __local float *src = PA;
  __local float *dst = PB;
  for (int off = 1; off < wg; off <<= 1) {   // Hillis-Steele inclusive scan of the per-item sums
    dst[lid] = lid >= off ? src[lid] + src[lid - off] : src[lid];
    barrier(CLK_LOCAL_MEM_FENCE);
    __local float *tq = src; src = dst; dst = tq;
  }
  float acc = lid ? src[lid - 1] : 0.f;
  for (int k = lo; k < hi; k++) { P[k] = acc; acc += gat(sd, k, n1, rj, ordO, cl, wd); }
  if (lid == wg - 1) P[n] = src[wg - 1];
  barrier(CLK_LOCAL_MEM_FENCE);
}

__kernel void river_solve(
    __global const uchar *TY, __global const char *PL, __global const int *NN, __global const int *CS, __global const int *CHN,
    __global const uint *DO, __global const int *NX, __global const float *NC0, __global const float *NC1,
    __global const int *SEND, __global const int *RS,
    __global float *R0, __global float *S0, __global float *R1, __global float *S1, __global int *LR, __global int *LS,
    __global float *RSC, __global float *SSC,
    __global const uchar *HL1, __global const uchar *HL2, __global const int *HSAME, __global const int *HWOFF, __global const int *HWDAT,
    __global const ushort *BDAT, __global const int *BOFF, __global const int *BM, __global const ushort *CDAT, __global const int *COFF,
    __global const int *SLOTS, __global const int *ENT, __global const int *EQV, __global const int *PHD, __global const int *PHO,
    __global const int *REQ, __global const float *RO, __global float *VOUT,
    __global float *SCR, __global int *SCRI, __global int *CTR,
    __global const float *CUM, __global const float *ICMT,
    __local float *L, __local int *LI,
    const int r1, const int p, const int mode, const int t, const int icm, const int maxSub, const int maxN,
    const int NP, const int NO, const int hoffP, const uint SPL, const int comp, const float gamma, const float P0H, const float w) {
  const int lid = (int)get_local_id(0), wg = (int)get_local_size(0), grp = (int)get_group_id(0), o = 1 - p;
  __global float *REACH = SCR + (size_t)grp * (size_t)maxSub * (size_t)maxN * 2;
  __global float *VAL = REACH + (size_t)maxSub * (size_t)maxN;
  __global int *FLG = SCRI + (size_t)grp * (size_t)maxSub;
  __local float *P = L + L_P;
  __local float *PA = L + L_PA;
  __local float *PB = PA + wg;
  int nOpp = 0;
  for (;;) {
    if (lid == 0) LI[0] = atomic_inc(CTR);
    barrier(CLK_LOCAL_MEM_FENCE);
    const int r = LI[0];
    barrier(CLK_LOCAL_MEM_FENCE);
    if (r >= r1) break;
    const int slot = REQ[r];
    __global const float *ro = RO + (size_t)r * (size_t)NO;
    __global float *vout = VOUT + (size_t)r * (size_t)NP;
    for (int h = lid; h < NP; h += wg) vout[h] = 0.f;
    const int e0 = SLOTS[2 * slot], e1 = e0 + SLOTS[2 * slot + 1];
    for (int e = e0; e < e1; e++) {
      const int root = ENT[5 * e], size = ENT[5 * e + 1], card = ENT[5 * e + 2], pe0 = ENT[5 * e + 3], pe1 = pe0 + ENT[5 * e + 4];
      // reach entering the subgame: the request's opponent reach without hands that hold the river card
      for (int h = lid; h < NO; h += wg) REACH[h] = ro[h];
      for (int j = lid; j < size; j += wg) FLG[j] = 1;
      if (lid == 0) { LI[2] = 0; LI[3] = 0; LI[4] = 0; LI[5] = 0; LI[6] = 0; LI[7] = 0; }
      nOpp = 0;
      barrier(CLK_GLOBAL_MEM_FENCE | CLK_LOCAL_MEM_FENCE);
      for (int q = HWOFF[o * 53 + card] + lid; q < HWOFF[o * 53 + card + 1]; q += wg) REACH[HWDAT[q]] = 0.f;
      barrier(CLK_GLOBAL_MEM_FENCE);
      // ---- top-down: opponent reach ----
      for (int j = 0; j < size; j++) {
        const int n = root + j;
        if (TY[n] != T_PLAYER || PL[n] == p || !FLG[j]) continue;
        const int nA = NN[n], s0 = CS[n];
        const uint o0 = DO[n], off = o0 < SPL ? o0 : o0 - SPL;
        __global float *R = o0 < SPL ? R0 : R1;
        __global float *S = o0 < SPL ? S0 : S1;
        __global const short *R16 = (__global const short *)R;
        __global ushort *S16 = (__global ushort *)S;
        __global const float *rj = REACH + (size_t)RS[n] * (size_t)NO;
        float fs = 0.f;
        if (mode == 0) {
          const int last = LS[n];
          if (last > 0) { const float x = (float)last / (float)t; fs = gamma == 3.f ? x * x * x : pow(x, gamma); }
        }
        const float ssc = comp ? SSC[n] * fs : 0.f;   // 16-bit: old sums are S16 * ssc
        int m = 0; float mx = 0.f;
        for (int h = lid; h < NO; h += wg) {
          float st[MAXA], sum = 0.f;
          for (int a = 0; a < nA; a++) {
            const uint ix = off + (uint)(a * NO + h);
            float x = mode == 0 ? (comp ? (float)R16[ix] : R[ix]) : (comp ? (float)S16[ix] : S[ix]);
            if (!(x > 0.f)) x = 0.f;
            st[a] = x; sum += x;
          }
          const float rh = rj[h];
          for (int a = 0; a < nA; a++) {
            const float v = rh * (sum > 0.f ? st[a] / sum : 1.f / (float)nA);
            REACH[(size_t)(CHN[s0 + a] - root) * (size_t)NO + h] = v;
            if (v != 0.f) m |= 1 << a;
            if (mode == 0) {
              const uint ix = off + (uint)(a * NO + h);
              if (comp) { const float x = (float)S16[ix] * ssc + v; mx = x > mx ? x : mx; }
              else S[ix] = S[ix] * fs + v;
            }
          }
        }
        // which actions any opponent hand takes (and, 16-bit, the node's new largest sum). Three rotating
        // slots: the next node's slot is cleared before this node's barrier; everyone finished reading it two
        // nodes ago, and nobody writes it before that barrier
        __local int *slot = LI + 2 + nOpp % 3;
        __local int *mslot = LI + 5 + nOpp % 3;
        if (lid == 0) { LI[2 + (nOpp + 1) % 3] = 0; LI[5 + (nOpp + 1) % 3] = 0; }
        nOpp++;
        if (m) atomic_or(slot, m);
        if (comp && mode == 0 && mx > 0.f) atomic_max(mslot, as_int(mx));
        barrier(CLK_LOCAL_MEM_FENCE);
        const int M = *slot;
        if (comp && mode == 0) {
          // rewrite the sums with the new scale (the reach just written is this iteration's contribution)
          const float nmx = as_float(*mslot), ns = nmx > 0.f ? nmx / 65535.f : 1.f, inv = 1.f / ns;
          for (int h = lid; h < NO; h += wg)
            for (int a = 0; a < nA; a++) {
              const uint ix = off + (uint)(a * NO + h);
              const float x = (float)S16[ix] * ssc + REACH[(size_t)(CHN[s0 + a] - root) * (size_t)NO + h];
              S16[ix] = (ushort)(x * inv + 0.5f);
            }
          if (lid == 0) SSC[n] = ns;
        }
        if (M != (1 << nA) - 1) {
          // no opponent hand takes these actions: skip their whole subtrees
          for (int a = 0; a < nA; a++) if (!((M >> a) & 1)) {
            const int c0 = CHN[s0 + a], c1 = SEND[c0];
            for (int x = c0 + lid; x < c1; x += wg) FLG[x - root] = 0;
          }
          barrier(CLK_GLOBAL_MEM_FENCE);
        }
      }
      barrier(CLK_GLOBAL_MEM_FENCE);
      // ---- bottom-up: traverser values ----
      for (int j = size - 1; j >= 0; j--) {
        if (!FLG[j]) continue;
        const int n = root + j, ty = TY[n];
        __global float *vj = VAL + (size_t)j * (size_t)NP;
        if (ty == T_FOLD || ty == T_SHOW) {
          __global const float *rj = REACH + (size_t)RS[n] * (size_t)NO;
          float pw, pl, ut = 0.f, pay = 0.f;
          if (icm) {
            const float c0 = NC0[n], pot = ICMT[3] + c0 + NC1[n], xl = ICMT[2] - c0, xw = xl + pot;
            if (ty == T_FOLD) pay = icm_u(ICMT, p, PL[n] == 0 ? xl : xw);
            const float uw = icm_u(ICMT, p, p == 0 ? xw : xl), ul = icm_u(ICMT, p, p == 0 ? xl : xw);
            ut = icm_u(ICMT, p, xl + 0.5f * pot);
            pw = uw - ut; pl = ul - ut;
          } else {
            if (ty == T_FOLD) { const int f = PL[n]; pay = (f == p ? -1.f : 1.f) * (P0H + (f == 0 ? NC0[n] : NC1[n])); }
            pw = P0H + NC0[n]; pl = -pw;
          }
          if (ty == T_FOLD) {
            // compatible opponent mass: everything minus the hands sharing a card with ours (one gathered scan)
            const int wb = HWOFF[o * 53];
            block_scan(P, PA, PB, 3 * NO, lid, wg, 0, NO, rj, CDAT, CDAT, HWDAT + wb);
            const float tot = P[NO];
            for (int h = lid; h < NP; h += wg) {
              const int k = HSAME[hoffP + h], c1 = HL1[hoffP + h], c2 = HL2[hoffP + h];
              const float m1 = P[NO + HWOFF[o * 53 + c1 + 1] - wb] - P[NO + HWOFF[o * 53 + c1] - wb];
              const float m2 = P[NO + HWOFF[o * 53 + c2 + 1] - wb] - P[NO + HWOFF[o * 53 + c2] - wb];
              vj[h] = pay * (tot - m1 - m2 + (k >= 0 ? rj[k] : 0.f));
            }
            barrier(CLK_LOCAL_MEM_FENCE | CLK_GLOBAL_MEM_FENCE);
          } else {
            // showdown: one scan over opponent reach in strength order followed by the per-card position lists;
            // a card's partial sums are differences of that prefix array
            const int b = NX[n], mO = BM[b * 2 + o], mP = BM[b * 2 + p];
            __global const ushort *ordO = BDAT + BOFF[b * 2 + o];
            __global const ushort *bp = BDAT + BOFF[b * 2 + p];
            __global const ushort *cb = CDAT + COFF[b * 2 + o];
            for (int h = lid; h < NP; h += wg) vj[h] = 0.f;   // hands that cannot be held on this board
            block_scan(P, PA, PB, 3 * mO, lid, wg, 1, mO, rj, ordO, cb + 53, HWDAT);
            barrier(CLK_GLOBAL_MEM_FENCE);
            const float tot = P[mO];
            for (int i = lid; i < mP; i += wg) {
              const int h = bp[i], c1 = HL1[hoffP + h], c2 = HL2[hoffP + h];
              const int s1 = mO + cb[c1], e1 = mO + cb[c1 + 1], s2 = mO + cb[c2], e2 = mO + cb[c2 + 1];
              const float Wm = P[bp[mP + i]] - (P[s1 + bp[3 * mP + i]] - P[s1]) - (P[s2 + bp[4 * mP + i]] - P[s2]);
              const float Lm = (tot - P[bp[2 * mP + i]]) - (P[e1] - P[s1 + bp[5 * mP + i]]) - (P[e2] - P[s2 + bp[6 * mP + i]]);
              float v = pw * Wm + pl * Lm;
              if (ut != 0.f) { const int k = HSAME[hoffP + h]; v += ut * (tot - (P[e1] - P[s1]) - (P[e2] - P[s2]) + (k >= 0 ? rj[k] : 0.f)); }
              vj[h] = v;
            }
            barrier(CLK_LOCAL_MEM_FENCE | CLK_GLOBAL_MEM_FENCE);
          }
        } else if (ty == T_PLAYER) {
          const int q = PL[n], nA = NN[n], s0 = CS[n];
          const uint o0 = DO[n], off = o0 < SPL ? o0 : o0 - SPL;
          __global float *R = o0 < SPL ? R0 : R1;
          __global float *S = o0 < SPL ? S0 : S1;
          __global short *R16 = (__global short *)R;
          __global const ushort *S16 = (__global const ushort *)S;
          if (q == p) {
            float fp = 1.f, fn = 1.f;
            if (mode == 0) {
              const int last = LR[n];
              if (last > 0) { fp = CUM[t - 1] / CUM[last - 1]; const int ex = t - last; fn = ex >= 60 ? 0.f : ldexp(1.f, -ex); }
            }
            const float rsc = comp ? RSC[n] : 1.f;   // 16-bit: regrets are R16 * rsc
            float mx = 0.f;
            for (int h = lid; h < NP; h += wg) {
              float st[MAXA], sum = 0.f, v = 0.f;
              if (mode == 2) {
                v = -3.0e38f;
                for (int a = 0; a < nA; a++) { const float cv = VAL[(size_t)(CHN[s0 + a] - root) * (size_t)NP + h]; if (cv > v) v = cv; }
              } else {
                for (int a = 0; a < nA; a++) {
                  const uint ix = off + (uint)(a * NP + h);
                  float x = mode == 0 ? (comp ? (float)R16[ix] : R[ix]) : (comp ? (float)S16[ix] : S[ix]);
                  if (!(x > 0.f)) x = 0.f;
                  st[a] = x; sum += x;
                }
                for (int a = 0; a < nA; a++) v += (sum > 0.f ? st[a] / sum : 1.f / (float)nA) * VAL[(size_t)(CHN[s0 + a] - root) * (size_t)NP + h];
              }
              vj[h] = v;
              if (mode == 0) for (int a = 0; a < nA; a++) {
                const uint ix = off + (uint)(a * NP + h);
                const float cv = VAL[(size_t)(CHN[s0 + a] - root) * (size_t)NP + h] - v;
                if (comp) { const float x0 = (float)R16[ix] * rsc, x = (x0 > 0.f ? x0 * fp : x0 * fn) + cv, ax = x < 0.f ? -x : x; mx = ax > mx ? ax : mx; }
                else { const float x = R[ix]; R[ix] = (x > 0.f ? x * fp : x * fn) + cv; }
              }
            }
            if (comp && mode == 0) {
              // 16-bit: the node's largest new regret sets the new scale, then every regret is rewritten
              barrier(CLK_LOCAL_MEM_FENCE);
              if (lid == 0) LI[8] = 0;
              barrier(CLK_LOCAL_MEM_FENCE);
              if (mx > 0.f) atomic_max(LI + 8, as_int(mx));
              barrier(CLK_LOCAL_MEM_FENCE);
              const float nmx = as_float(LI[8]), ns = nmx > 0.f ? nmx / 32767.f : 1.f, inv = 1.f / ns;
              for (int h = lid; h < NP; h += wg) {
                const float v = vj[h];
                for (int a = 0; a < nA; a++) {
                  const uint ix = off + (uint)(a * NP + h);
                  const float x0 = (float)R16[ix] * rsc, x = (x0 > 0.f ? x0 * fp : x0 * fn) + (VAL[(size_t)(CHN[s0 + a] - root) * (size_t)NP + h] - v);
                  const float y = x * inv;
                  R16[ix] = (short)(y >= 0.f ? y + 0.5f : y - 0.5f);
                }
              }
              if (lid == 0) RSC[n] = ns;
            }
          } else {
            for (int h = lid; h < NP; h += wg) {
              float v = 0.f;
              for (int a = 0; a < nA; a++) { const int jc = CHN[s0 + a] - root; if (FLG[jc]) v += VAL[(size_t)jc * (size_t)NP + h]; }
              vj[h] = v;
            }
          }
        }
      }
      barrier(CLK_GLOBAL_MEM_FENCE);
      // traverser hands that hold the river card get nothing from this card
      for (int q = HWOFF[p * 53 + card] + lid; q < HWOFF[p * 53 + card + 1]; q += wg) VAL[HWDAT[q]] = 0.f;
      if (mode == 0) for (int j = lid; j < size; j += wg) {
        const int n = root + j;
        if (FLG[j] && TY[n] == T_PLAYER) { if (PL[n] == p) LR[n] = t; else LS[n] = t; }
      }
      barrier(CLK_GLOBAL_MEM_FENCE);
      for (int h = lid; h < NP; h += wg) {
        float v = VAL[h];
        for (int k = pe0; k < pe1; k++) v += VAL[PHD[PHO[EQV[k] * 2 + p] + h]];
        vout[h] += v;
      }
      barrier(CLK_GLOBAL_MEM_FENCE);
    }
    for (int h = lid; h < NP; h += wg) vout[h] *= w;
  }
}
