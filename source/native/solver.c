// EightMax native postflop solver: vector-form Discounted CFR (alpha 1.5, beta 0, gamma 3 by default)
// with alternating updates, lazy discounting, zero-reach pruning, O(n) showdowns with
// card removal, node locking, a thread pool that splits work at the top chance nodes,
// optional 16-bit storage, and save/load. Compiled once per instruction set.
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdio.h>
#include <stdint.h>
#include <pthread.h>
#include <time.h>
#include "solver.h"
#include "gpu.h"

#ifndef SFX
#define SFX gen
#endif
#define CAT2(a, b) a##b
#define CAT(a, b) CAT2(a, b)
#define VTNAME CAT(solver_vt_, SFX)
#define STR2(x) #x
#define STR(x) STR2(x)

typedef float f32; typedef double f64; typedef uint8_t u8; typedef uint16_t u16; typedef int16_t i16; typedef int32_t i32; typedef uint32_t u32; typedef int64_t i64;
enum { T_PLAYER = 0, T_CHANCE = 1, T_FOLD = 2, T_SHOW = 3, T_ALLIN = 4 };
enum { A_FOLD = 0, A_CHECK = 1, A_CALL = 2, A_BET = 3, A_RAISE = 4, A_ALLIN = 5 };
static const char *TYPE_NAMES[] = { "player", "chance", "fold", "showdown", "allin" };

/* ---------------- evaluator + combos ---------------- */
static u8 POP[8192], STRT[8192], CC1[1326], CC2[1326];
static i16 PIDX52[52 * 52]; static u8 PERM[24][4], PINV[24][4];   // suit permutations, 0 = identity
static inline int pcard(const u8 *pm, int c) { return (c & ~3) | pm[c & 3]; }
static void tables_init(void) {
  for (int m = 0; m < 8192; m++) {
    POP[m] = (u8)__builtin_popcount((unsigned)m);
    int st = 0;
    for (int hi = 12; hi >= 4; hi--) { int w = 0x1F << (hi - 4); if ((m & w) == w) { st = hi + 1; break; } }
    if (!st && (m & 0x100F) == 0x100F) st = 4;
    STRT[m] = (u8)st;
  }
  int k = 0;
  for (int a = 0; a < 52; a++) for (int b = a + 1; b < 52; b++) { CC1[k] = (u8)a; CC2[k] = (u8)b; k++; }
  for (int i = 0; i < 52 * 52; i++) PIDX52[i] = -1;
  for (int i = 0; i < 1326; i++) PIDX52[CC1[i] * 52 + CC2[i]] = PIDX52[CC2[i] * 52 + CC1[i]] = (i16)i;
  int np = 0;
  for (int a = 0; a < 4; a++) for (int b = 0; b < 4; b++) for (int c = 0; c < 4; c++) for (int d = 0; d < 4; d++) {
    if (a == b || a == c || a == d || b == c || b == d || c == d) continue;
    PERM[np][0] = (u8)a; PERM[np][1] = (u8)b; PERM[np][2] = (u8)c; PERM[np][3] = (u8)d;
    for (int x = 0; x < 4; x++) PINV[np][PERM[np][x]] = (u8)x;
    np++;
  }
}
static inline uint32_t topbits(uint32_t m, int n) { while (POP[m] > n) m &= m - 1; return m; }
static uint32_t eval7(uint32_t s0, uint32_t s1, uint32_t s2, uint32_t s3) {
  uint32_t fl = 0;
  if (POP[s0] >= 5) fl = s0; else if (POP[s1] >= 5) fl = s1; else if (POP[s2] >= 5) fl = s2; else if (POP[s3] >= 5) fl = s3;
  if (fl) { uint32_t st = STRT[fl]; if (st) return (8u << 26) | st; return (5u << 26) | topbits(fl, 5); }
  uint32_t ranks = s0 | s1 | s2 | s3, quads = s0 & s1 & s2 & s3;
  if (quads) return (7u << 26) | (quads << 13) | topbits(ranks & ~quads, 1);
  uint32_t t3 = (s0 & s1 & s2) | (s0 & s1 & s3) | (s0 & s2 & s3) | (s1 & s2 & s3);
  uint32_t t2 = (s0 & s1) | (s0 & s2) | (s0 & s3) | (s1 & s2) | (s1 & s3) | (s2 & s3);
  uint32_t pairs = t2 & ~t3;
  if (t3) { uint32_t top = topbits(t3, 1), rest = (t3 & ~top) | pairs; if (rest) return (6u << 26) | (top << 13) | topbits(rest, 1); }
  uint32_t st = STRT[ranks];
  if (st) return (4u << 26) | st;
  if (t3) return (3u << 26) | (t3 << 13) | topbits(ranks & ~t3, 2);
  int np = POP[pairs];
  if (np >= 2) { uint32_t tp = topbits(pairs, 2); return (2u << 26) | (tp << 13) | topbits(ranks & ~tp, 1); }
  if (np == 1) return (1u << 26) | (pairs << 13) | topbits(ranks & ~pairs, 3);
  return topbits(ranks, 5);
}

/* ---------------- thread pool ---------------- */
typedef struct Ctx { int tid, inPar, D, N, A; f32 *RB, *TB, *SB, *OB, *SUMB, *ALLT, *part, *SDT; } Ctx;
typedef void (*ItemFn)(Ctx *c, int k, void *arg);
static struct {
  int n, active, started; pthread_t *th; Ctx **ctx;   // active: threads that take work (power modes use fewer)
  pthread_mutex_t mu; pthread_cond_t cv, done;
  int gen, pending; ItemFn fn; void *arg; int items; int next;
} POOL;
static void run_items(Ctx *c) {
  if (c->tid >= __atomic_load_n(&POOL.active, __ATOMIC_RELAXED)) return;
  const int old = c->inPar; c->inPar = 1;
  ItemFn fn = POOL.fn; void *arg = POOL.arg; const int n = POOL.items;
  for (;;) { int k = __atomic_fetch_add(&POOL.next, 1, __ATOMIC_ACQ_REL); if (k >= n) break; fn(c, k, arg); }
  c->inPar = old;
}
static void *worker_main(void *a) {
  Ctx *c = (Ctx *)a; int seen = 0;
  for (;;) {
    pthread_mutex_lock(&POOL.mu);
    while (POOL.gen == seen) pthread_cond_wait(&POOL.cv, &POOL.mu);
    seen = POOL.gen;
    pthread_mutex_unlock(&POOL.mu);
    run_items(c);
    pthread_mutex_lock(&POOL.mu);
    if (--POOL.pending == 0) pthread_cond_signal(&POOL.done);
    pthread_mutex_unlock(&POOL.mu);
  }
  return NULL;
}
static void pool_run(ItemFn fn, void *arg, int items, int clearN) {
  for (int i = 0; i < POOL.n; i++) memset(POOL.ctx[i]->part, 0, sizeof(f32) * (size_t)clearN);
  pthread_mutex_lock(&POOL.mu);
  POOL.fn = fn; POOL.arg = arg; POOL.items = items; __atomic_store_n(&POOL.next, 0, __ATOMIC_RELEASE);
  POOL.pending = POOL.n - 1; POOL.gen++;
  pthread_cond_broadcast(&POOL.cv);
  pthread_mutex_unlock(&POOL.mu);
  run_items(POOL.ctx[0]);
  pthread_mutex_lock(&POOL.mu);
  while (POOL.pending > 0) pthread_cond_wait(&POOL.done, &POOL.mu);
  pthread_mutex_unlock(&POOL.mu);
}
static void ctx_reserve(Ctx *c, int D, int N, int A) {
  if (c->D >= D && c->N >= N && c->A >= A) return;
  if (D < c->D) D = c->D;
  if (N < c->N) N = c->N;
  if (A < c->A) A = c->A;
  free(c->RB); free(c->TB); free(c->SB); free(c->OB); free(c->SUMB); free(c->ALLT); free(c->part); free(c->SDT);
  c->D = D; c->N = N; c->A = A;
  c->RB = (f32 *)calloc((size_t)D * N, sizeof(f32)); c->TB = (f32 *)calloc((size_t)D * N, sizeof(f32));
  c->SB = (f32 *)calloc((size_t)D * A * N, sizeof(f32)); c->OB = (f32 *)calloc((size_t)D * A * N, sizeof(f32));
  c->SUMB = (f32 *)calloc((size_t)N, sizeof(f32)); c->ALLT = (f32 *)calloc((size_t)N, sizeof(f32)); c->part = (f32 *)calloc((size_t)N, sizeof(f32));
  c->SDT = (f32 *)calloc((size_t)N, sizeof(f32));
}
static void s_init(int threads) {
  static int done = 0;
  if (done) return;
  done = 1;
  tables_init();
  if (threads < 1) threads = 1;
  if (threads > 256) threads = 256;
  POOL.n = threads; POOL.active = threads;
  POOL.ctx = (Ctx **)calloc((size_t)threads, sizeof(Ctx *));
  POOL.th = (pthread_t *)calloc((size_t)threads, sizeof(pthread_t));
  pthread_mutex_init(&POOL.mu, NULL); pthread_cond_init(&POOL.cv, NULL); pthread_cond_init(&POOL.done, NULL);
  for (int i = 0; i < threads; i++) { POOL.ctx[i] = (Ctx *)calloc(1, sizeof(Ctx)); POOL.ctx[i]->tid = i; ctx_reserve(POOL.ctx[i], 8, 64, 4); }
  for (int i = 1; i < threads; i++) pthread_create(&POOL.th[i], NULL, worker_main, POOL.ctx[i]);
}
static int s_threads(void) { return POOL.n; }
static void s_set_threads(int n) { if (n < 1) n = 1; if (n > POOL.n) n = POOL.n; __atomic_store_n(&POOL.active, n, __ATOMIC_RELAXED); }

/* ---------------- game ---------------- */
typedef struct { u16 *ord[2], *lt[2], *le[2]; int m[2]; } Board;
typedef struct { i32 *ids; int n; f32 w; int key; } Runout;
struct Game {
  GameCfg cfg;
  int nb, startStreet; f32 P0, S, P0H, forceAllin; int maxBets;
  int N[2]; u16 G[2][1326]; u8 L1[2][1326], L2[2][1326]; f32 W[2][1326]; i32 SAME[2][1326];
  i32 WOFF[2][53]; i32 *WDAT[2];
  int maxN;
  int nBoards; Board *boards; i32 boardIdx[52 * 52]; int rest[52], nRest;
  int nRun; Runout run[64];
  int nNodes, capN; u8 *TY, *ST; signed char *PL; f32 *NC0, *NC1, *BASE; i32 *CS, *NN, *NX; i64 *DO;
  int nCh, capC; i32 *CHN; signed char *CHC; u8 *CHK; f32 *CHA;
  i64 dataSize; int maxDepth, maxA, nPlayer, nChance, nTerm;
  int comp, allocated, viewOnly; f32 *R32, *S32; i16 *R16; u16 *S16; f32 *RSC, *SSC; i32 *LR, *LS;
  f64 *CUM; int cumCap; int t;
  f32 **LOCK; int nLocks;
  f64 Z; f32 *OUT0, *OUT1;
  int failed;
  int iso; u8 symOK[24]; i16 *PH[24][2]; u8 *CHP; i16 G2L[2][1326];   // suit isomorphism
  int phase;                     // 0 CPU only; GPU passes: 1 collect river requests top-down, 2 finish bottom-up
  struct GpuState *gs;           // river phase on the GPU (NULL = CPU)
  int gpuFailed, nRiverLocks; char gpuWhy[640];
  i64 riverData; int riverSlots, riverMaxSub;   // river part of the tree (GPU memory estimate)
  int walkShared;                // the last walk() passed a turn/river card whose subtree is shared with suit twins
};

static int newNode(Game *g, int type, int player, f32 c0, f32 c1, int street, f32 base) {
  if (g->nNodes >= 40000000) { g->failed = 1; return 0; }
  if (g->nNodes == g->capN) {
    int c = g->capN ? g->capN * 2 : 4096;
    g->TY = (u8 *)realloc(g->TY, (size_t)c); g->ST = (u8 *)realloc(g->ST, (size_t)c); g->PL = (signed char *)realloc(g->PL, (size_t)c);
    g->NC0 = (f32 *)realloc(g->NC0, sizeof(f32) * (size_t)c); g->NC1 = (f32 *)realloc(g->NC1, sizeof(f32) * (size_t)c); g->BASE = (f32 *)realloc(g->BASE, sizeof(f32) * (size_t)c);
    g->CS = (i32 *)realloc(g->CS, sizeof(i32) * (size_t)c); g->NN = (i32 *)realloc(g->NN, sizeof(i32) * (size_t)c); g->NX = (i32 *)realloc(g->NX, sizeof(i32) * (size_t)c);
    g->DO = (i64 *)realloc(g->DO, sizeof(i64) * (size_t)c);
    g->capN = c;
  }
  int id = g->nNodes++;
  g->TY[id] = (u8)type; g->PL[id] = (signed char)player; g->NC0[id] = c0; g->NC1[id] = c1; g->ST[id] = (u8)street; g->BASE[id] = base;
  g->CS[id] = -1; g->NN[id] = 0; g->NX[id] = -1; g->DO[id] = -1;
  return id;
}
static int reserveCh(Game *g, int k) {
  while (g->nCh + k > g->capC) {
    int c = g->capC ? g->capC * 2 : 8192;
    g->CHN = (i32 *)realloc(g->CHN, sizeof(i32) * (size_t)c); g->CHC = (signed char *)realloc(g->CHC, (size_t)c);
    g->CHK = (u8 *)realloc(g->CHK, (size_t)c); g->CHA = (f32 *)realloc(g->CHA, sizeof(f32) * (size_t)c); g->CHP = (u8 *)realloc(g->CHP, (size_t)c);
    g->capC = c;
  }
  int s = g->nCh; g->nCh += k; return s;
}
static int cmpu64(const void *a, const void *b) { uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b; return x < y ? -1 : x > y; }
static void mkBoard(Game *g, Board *B, const int *cards5) {
  uint32_t bs[4] = { 0, 0, 0, 0 }; u8 used[52] = { 0 };
  for (int i = 0; i < 5; i++) { bs[cards5[i] & 3] |= 1u << (cards5[i] >> 2); used[cards5[i]] = 1; }
  uint64_t *keys = (uint64_t *)malloc(sizeof(uint64_t) * 1326);
  uint32_t *str[2];
  for (int p = 0; p < 2; p++) {
    int m = 0;
    for (int h = 0; h < g->N[p]; h++) {
      int a = g->L1[p][h], b = g->L2[p][h];
      if (used[a] || used[b]) continue;
      uint32_t s[4] = { bs[0], bs[1], bs[2], bs[3] };
      s[a & 3] |= 1u << (a >> 2); s[b & 3] |= 1u << (b >> 2);
      keys[m++] = ((uint64_t)eval7(s[0], s[1], s[2], s[3]) << 11) | (uint64_t)h;
    }
    qsort(keys, (size_t)m, sizeof(uint64_t), cmpu64);
    B->m[p] = m;
    B->ord[p] = (u16 *)malloc(sizeof(u16) * (size_t)(m ? m : 1) * 3);
    B->lt[p] = B->ord[p] + m; B->le[p] = B->ord[p] + 2 * m;
    str[p] = (uint32_t *)malloc(sizeof(uint32_t) * (size_t)(m ? m : 1));
    for (int i = 0; i < m; i++) { B->ord[p][i] = (u16)(keys[i] & 2047); str[p][i] = (uint32_t)(keys[i] >> 11); }
  }
  for (int p = 0; p < 2; p++) {
    const uint32_t *sp = str[p], *so = str[1 - p]; int mo = B->m[1 - p], j = 0, k = 0;
    for (int i = 0; i < B->m[p]; i++) {
      while (j < mo && so[j] < sp[i]) j++;
      while (k < mo && so[k] <= sp[i]) k++;
      B->lt[p][i] = (u16)j; B->le[p][i] = (u16)k;
    }
  }
  free(str[0]); free(str[1]); free(keys);
}
static int boardIdOf(Game *g, const int *dealt, int nd) {
  (void)nd;
  if (g->nb == 5) return 0;
  if (g->nb == 4) return g->boardIdx[dealt[0]];
  return g->boardIdx[dealt[0] * 52 + dealt[1]];
}
static int runoutFor(Game *g, int street, const int *dealt) {
  int key = street == 0 ? -1 : (g->nb == 4 ? 100 : dealt[0]);
  for (int i = 0; i < g->nRun; i++) if (g->run[i].key == key) return i;
  if (g->nRun >= 64) { g->failed = 1; return 0; }
  Runout *R = &g->run[g->nRun];
  R->key = key;
  if (street == 0 || g->nb == 4) {
    R->n = g->nBoards; R->ids = (i32 *)malloc(sizeof(i32) * (size_t)R->n);
    for (int i = 0; i < R->n; i++) R->ids[i] = i;
  } else {
    int t = dealt[0]; R->ids = (i32 *)malloc(sizeof(i32) * 52); R->n = 0;
    for (int i = 0; i < g->nRest; i++) { int r = g->rest[i]; if (r != t) R->ids[R->n++] = g->boardIdx[t * 52 + r]; }
  }
  R->w = street == 0 ? 1.f / 990.f : 1.f / 44.f;
  return g->nRun++;
}
// prevAgg: who made the last bet or raise on the previous street (-1 none); agg: the same on this street
typedef struct { int street; f32 base, c0, c1; int actor, nBets, facing; f32 lastInc; int nd; int dealt[2]; int prevAgg, agg; } BSt;
static int bAction(Game *g, BSt st, int depth);
static int bStreetEnd(Game *g, int street, f32 c, const int *dealt, int nd, int depth, int agg) {
  if (g->failed) return 0;
  if (c >= g->S - 1e-6f && street < 2) { int id = newNode(g, T_ALLIN, -1, c, c, street, c); g->nTerm++; g->NX[id] = runoutFor(g, street, dealt); return id; }
  if (street == 2) { int id = newNode(g, T_SHOW, -1, c, c, street, c); g->nTerm++; g->NX[id] = boardIdOf(g, dealt, nd); return id; }
  int id = newNode(g, T_CHANCE, -1, c, c, street, c); g->nChance++;
  u8 used[52] = { 0 };
  for (int i = 0; i < g->nb; i++) used[g->cfg.board[i]] = 1;
  for (int i = 0; i < nd; i++) used[dealt[i]] = 1;
  int cards[52], nc = 0;
  for (int k = 0; k < 52; k++) if (!used[k]) cards[nc++] = k;
  int s = reserveCh(g, nc);
  g->CS[id] = s; g->NN[id] = nc;
  // suit permutations that keep this board and both ranges unchanged: equivalent cards share one subtree
  int grp[24], ng = 0;
  if (g->iso) for (int si = 1; si < 24; si++) {
    if (!g->symOK[si]) continue;
    int ok = 1;
    for (int x = 0; x < 52 && ok; x++) if (used[x] && !used[pcard(PERM[si], x)]) ok = 0;
    if (ok) grp[ng++] = si;
  }
  for (int k = 0; k < nc; k++) {
    int can = cards[k];
    for (int j = 0; j < ng; j++) { int x = pcard(PERM[grp[j]], cards[k]); if (x < can) can = x; }
    if (can != cards[k]) {
      int kc = -1, pid = 0;
      for (int j = 0; j < k; j++) if (cards[j] == can) { kc = j; break; }
      for (int j = 0; j < ng; j++) if (pcard(PERM[grp[j]], can) == cards[k]) { pid = grp[j]; break; }
      g->CHN[s + k] = g->CHN[s + kc]; g->CHC[s + k] = (signed char)cards[k]; g->CHK[s + k] = 255; g->CHA[s + k] = 0; g->CHP[s + k] = (u8)pid;
      continue;
    }
    BSt ns; memset(&ns, 0, sizeof ns);
    ns.street = street + 1; ns.base = c; ns.c0 = c; ns.c1 = c; ns.actor = 0; ns.nd = nd + 1; ns.prevAgg = agg; ns.agg = -1;
    for (int i = 0; i < nd; i++) ns.dealt[i] = dealt[i];
    ns.dealt[nd] = cards[k];
    int child = bAction(g, ns, depth + 1);
    if (g->failed) return 0;
    g->CHN[s + k] = child; g->CHC[s + k] = (signed char)cards[k]; g->CHK[s + k] = 255; g->CHA[s + k] = 0; g->CHP[s + k] = 0;
  }
  return id;
}
static f32 allinRule(Game *g, f32 to) {
  if (to >= g->S - 1e-6f) return g->S;
  if (g->S - to <= g->forceAllin * (g->P0 + 2 * to)) return g->S;
  return to;
}
typedef struct { int kind; f32 to; } Act;
static int cmpAct(const void *a, const void *b) { f32 x = ((const Act *)a)->to, y = ((const Act *)b)->to; return x < y ? -1 : x > y; }
static int bAction(Game *g, BSt st, int depth) {
  if (g->failed) return 0;
  if (depth > g->maxDepth) g->maxDepth = depth;
  const int p = st.actor, o = 1 - p, street = st.street;
  f32 c[2] = { st.c0, st.c1 };
  const f32 pot = g->P0 + c[0] + c[1], left = g->S - c[p], oppLeft = g->S - c[o];
  Act fixed[3], agg[24]; int nf = 0, ng = 0;
  if (!st.facing) {
    fixed[nf++] = (Act){ A_CHECK, c[p] };
    // OOP leading into the player who bet the last street (after calling it) uses the donk sizes
    const int donk = p == 0 && street >= 1 && st.prevAgg == 1 && g->cfg.hasDonk;
    const int nsz = donk ? g->cfg.ndonk[street] : g->cfg.nbet[street][p];
    const float *szs = donk ? g->cfg.donk[street] : g->cfg.bet[street][p];
    if (left > 1e-6f && st.nBets < g->maxBets)
      for (int i = 0; i < nsz && ng < 24; i++) {
        const f32 sz = szs[i];
        f32 amt;
        if (sz == SZ_ALLIN) amt = left;
        else if (sz == SZ_GEO) { const int k = 3 - street; amt = (f32)((pow(1.0 + 2.0 * left / pot, 1.0 / k) - 1.0) / 2.0 * pot); }
        else amt = sz / 100.f * pot;
        f32 mn = left < 1.f ? left : 1.f; if (amt < mn) amt = mn;
        f32 to = allinRule(g, c[p] + amt);
        agg[ng++] = (Act){ to >= g->S - 1e-6f ? A_ALLIN : A_BET, to };
      }
  } else {
    fixed[nf++] = (Act){ A_FOLD, c[p] };
    fixed[nf++] = (Act){ A_CALL, c[o] < g->S ? c[o] : g->S };
    const f32 toCall = c[o] - c[p];
    // facing a raise (a 3-bet or more) the re-raise can be limited to all-in
    const int onlyAllin = g->cfg.reraiseAllin && st.nBets >= 2;
    const int nsz = onlyAllin ? 1 : g->cfg.nraise[street][p];
    if (st.nBets < g->maxBets && left > toCall + 1e-6f && oppLeft > 1e-6f)
      for (int i = 0; i < nsz && ng < 24; i++) {
        const f32 sz = onlyAllin ? SZ_ALLIN : g->cfg.raise[street][p][i];
        f32 to;
        if (sz == SZ_ALLIN) to = g->S;
        else if (SZ_IS_X(sz)) to = st.base + SZ_XMUL(sz) * (c[o] - st.base);
        else to = c[o] + sz / 100.f * (pot + toCall);
        f32 inc = st.lastInc > 1.f ? st.lastInc : 1.f;
        if (to < c[o] + inc) to = c[o] + inc;
        if (to > g->S) to = g->S;
        to = allinRule(g, to);
        agg[ng++] = (Act){ to >= g->S - 1e-6f ? A_ALLIN : A_RAISE, to };
      }
  }
  qsort(agg, (size_t)ng, sizeof(Act), cmpAct);
  Act list[27]; int nA = 0;
  for (int i = 0; i < nf; i++) list[nA++] = fixed[i];
  for (int i = 0; i < ng; i++) if (nA == nf || agg[i].to - list[nA - 1].to > 0.005f) list[nA++] = agg[i];
  int id = newNode(g, T_PLAYER, p, c[0], c[1], street, st.base); g->nPlayer++;
  if (nA > g->maxA) g->maxA = nA;
  g->DO[id] = g->dataSize; g->dataSize += (i64)nA * g->N[p];
  if (street == 2) g->riverData += (i64)nA * g->N[p];
  int s = reserveCh(g, nA);
  g->CS[id] = s; g->NN[id] = nA;
  for (int k = 0; k < nA; k++) {
    const Act a = list[k];
    int child;
    if (a.kind == A_CHECK) {
      if (p == 0) { BSt ns = st; ns.actor = 1; ns.facing = 0; child = bAction(g, ns, depth + 1); }
      else child = bStreetEnd(g, street, c[0], st.dealt, st.nd, depth + 1, -1);
    } else if (a.kind == A_FOLD) { child = newNode(g, T_FOLD, p, c[0], c[1], street, st.base); g->nTerm++; }
    else if (a.kind == A_CALL) child = bStreetEnd(g, street, a.to, st.dealt, st.nd, depth + 1, st.agg);
    else {
      BSt ns = st; f32 nc[2] = { c[0], c[1] }; nc[p] = a.to;
      ns.c0 = nc[0]; ns.c1 = nc[1]; ns.actor = o; ns.nBets = st.nBets + 1; ns.facing = 1; ns.lastInc = a.to - c[o]; ns.agg = p;
      child = bAction(g, ns, depth + 1);
    }
    if (g->failed) return 0;
    g->CHN[s + k] = child; g->CHC[s + k] = -1; g->CHK[s + k] = (u8)a.kind; g->CHA[s + k] = a.to - st.base; g->CHP[s + k] = 0;
  }
  return id;
}

static void gpu_teardown(Game *g);
static void game_free_impl(Game *g) {
  if (!g) return;
  gpu_teardown(g);
  for (int i = 0; i < g->nBoards; i++) { free(g->boards[i].ord[0]); free(g->boards[i].ord[1]); }
  free(g->boards);
  for (int i = 0; i < g->nRun; i++) free(g->run[i].ids);
  free(g->WDAT[0]); free(g->WDAT[1]);
  free(g->TY); free(g->ST); free(g->PL); free(g->NC0); free(g->NC1); free(g->BASE); free(g->CS); free(g->NN); free(g->NX); free(g->DO);
  free(g->CHN); free(g->CHC); free(g->CHK); free(g->CHA); free(g->CHP);
  for (int si = 0; si < 24; si++) { free(g->PH[si][0]); free(g->PH[si][1]); }
  free(g->R32); free(g->S32); free(g->R16); free(g->S16); free(g->RSC); free(g->SSC); free(g->LR); free(g->LS); free(g->CUM);
  if (g->LOCK) { for (int i = 0; i < g->nNodes; i++) free(g->LOCK[i]); free(g->LOCK); }
  free(g->OUT0); free(g->OUT1);
  free(g);
}

static Game *s_build(const GameCfg *cfg, char *err, int errlen) {
  Game *g = (Game *)calloc(1, sizeof(Game));
  if (!g) { snprintf(err, (size_t)errlen, "Out of memory"); return NULL; }
  g->cfg = *cfg;
  g->nb = cfg->nb;
  if (g->nb < 3 || g->nb > 5) { snprintf(err, (size_t)errlen, "Board needs 3, 4 or 5 cards"); free(g); return NULL; }
  g->startStreet = g->nb - 3;
  g->P0 = (f32)cfg->pot; g->S = (f32)cfg->stack; g->P0H = g->P0 * 0.5f;
  g->maxBets = cfg->maxBets > 0 ? cfg->maxBets : 3; g->forceAllin = (f32)cfg->forceAllin;
  if (!(g->P0 > 0) || !isfinite(g->P0)) { snprintf(err, (size_t)errlen, "Pot must be above 0"); free(g); return NULL; }
  if (!(g->S >= 0) || !isfinite(g->S)) { snprintf(err, (size_t)errlen, "Stack must be 0 or more"); free(g); return NULL; }
  if (!(cfg->gamma >= 0 && cfg->gamma <= 10)) { snprintf(err, (size_t)errlen, "Averaging exponent must be between 0 and 10"); free(g); return NULL; }
  u8 onB[52] = { 0 };
  for (int i = 0; i < g->nb; i++) {
    int c = cfg->board[i];
    if (c < 0 || c > 51 || onB[c]) { snprintf(err, (size_t)errlen, "Bad or duplicate board card"); free(g); return NULL; }
    onB[c] = 1;
  }
  for (int p = 0; p < 2; p++) {
    int n = 0;
    for (int i = 0; i < 1326; i++) {
      f32 w = cfg->ranges[p][i];
      if (w > 0 && isfinite(w) && !onB[CC1[i]] && !onB[CC2[i]]) { g->G[p][n] = (u16)i; g->W[p][n] = w; g->L1[p][n] = CC1[i]; g->L2[p][n] = CC2[i]; n++; }
    }
    if (!n) { snprintf(err, (size_t)errlen, "%s range has no hands that fit this board", p ? "IP" : "OOP"); free(g); return NULL; }
    g->N[p] = n;
  }
  g->maxN = g->N[0] > g->N[1] ? g->N[0] : g->N[1];
  for (int p = 0; p < 2; p++) {
    i16 loc[1326];
    for (int i = 0; i < 1326; i++) loc[i] = -1;
    for (int h = 0; h < g->N[1 - p]; h++) loc[g->G[1 - p][h]] = (i16)h;
    for (int h = 0; h < g->N[p]; h++) g->SAME[p][h] = loc[g->G[p][h]];
    int cnt[52] = { 0 };
    for (int h = 0; h < g->N[p]; h++) { cnt[g->L1[p][h]]++; cnt[g->L2[p][h]]++; }
    g->WOFF[p][0] = 0;
    for (int c = 0; c < 52; c++) g->WOFF[p][c + 1] = g->WOFF[p][c] + cnt[c];
    g->WDAT[p] = (i32 *)malloc(sizeof(i32) * (size_t)(g->N[p] * 2));
    int fill[52]; for (int c = 0; c < 52; c++) fill[c] = g->WOFF[p][c];
    for (int h = 0; h < g->N[p]; h++) { g->WDAT[p][fill[g->L1[p][h]]++] = h; g->WDAT[p][fill[g->L2[p][h]]++] = h; }
  }
  for (int c = 0; c < 52; c++) if (!onB[c]) g->rest[g->nRest++] = c;
  for (int i = 0; i < 52 * 52; i++) g->boardIdx[i] = -1;
  int cards[5];
  for (int i = 0; i < g->nb; i++) cards[i] = cfg->board[i];
  if (g->nb == 5) { g->boards = (Board *)calloc(1, sizeof(Board)); mkBoard(g, &g->boards[0], cards); g->nBoards = 1; }
  else if (g->nb == 4) {
    g->boards = (Board *)calloc((size_t)g->nRest, sizeof(Board));
    for (int i = 0; i < g->nRest; i++) { cards[4] = g->rest[i]; g->boardIdx[g->rest[i]] = g->nBoards; mkBoard(g, &g->boards[g->nBoards++], cards); }
  } else {
    g->boards = (Board *)calloc((size_t)(g->nRest * (g->nRest - 1) / 2), sizeof(Board));
    for (int i = 0; i < g->nRest; i++) for (int j = i + 1; j < g->nRest; j++) {
      int t = g->rest[i], r = g->rest[j];
      cards[3] = t; cards[4] = r;
      g->boardIdx[t * 52 + r] = g->boardIdx[r * 52 + t] = g->nBoards;
      mkBoard(g, &g->boards[g->nBoards++], cards);
    }
  }
  for (int p = 0; p < 2; p++) { for (int i = 0; i < 1326; i++) g->G2L[p][i] = -1; for (int h = 0; h < g->N[p]; h++) g->G2L[p][g->G[p][h]] = (i16)h; }
  g->iso = cfg->iso; g->symOK[0] = 1;
  for (int si = 1; si < 24; si++) {
    int ok = g->iso;
    for (int i = 0; ok && i < g->nb; i++) if (!onB[pcard(PERM[si], cfg->board[i])]) ok = 0;
    for (int p = 0; ok && p < 2; p++) for (int i = 0; ok && i < 1326; i++) {
      const int j = PIDX52[pcard(PERM[si], CC1[i]) * 52 + pcard(PERM[si], CC2[i])];
      const f32 d = cfg->ranges[p][i] - cfg->ranges[p][j];
      if (d > 1e-6f || d < -1e-6f) ok = 0;
    }
    for (int p = 0; ok && p < 2; p++) {
      g->PH[si][p] = (i16 *)malloc(sizeof(i16) * (size_t)g->N[p]);
      for (int h = 0; h < g->N[p]; h++) {
        const int gi = g->G[p][h], j = PIDX52[pcard(PINV[si], CC1[gi]) * 52 + pcard(PINV[si], CC2[gi])];
        g->PH[si][p][h] = g->G2L[p][j];
        if (g->PH[si][p][h] < 0) ok = 0;
      }
    }
    if (!ok) { free(g->PH[si][0]); free(g->PH[si][1]); g->PH[si][0] = g->PH[si][1] = NULL; }
    g->symOK[si] = (u8)ok;
  }
  BSt st; memset(&st, 0, sizeof st);
  st.street = g->startStreet; st.prevAgg = -1; st.agg = -1;
  bAction(g, st, 0);
  if (g->failed) { snprintf(err, (size_t)errlen, "Tree too large (over 40 million nodes). Use fewer bet sizes or start from a later street."); game_free_impl(g); return NULL; }
  g->LOCK = (f32 **)calloc((size_t)g->nNodes, sizeof(f32 *));
  // river subgames (one per canonical river card): how many and the largest, for the GPU memory estimate
  {
    i32 *send = (i32 *)malloc(sizeof(i32) * (size_t)g->nNodes);
    for (int n = g->nNodes - 1; n >= 0; n--) {
      int e = n + 1;
      if (g->TY[n] == T_PLAYER || g->TY[n] == T_CHANCE) for (int k = 0; k < g->NN[n]; k++) { const int x = send[g->CHN[g->CS[n] + k]]; if (x > e) e = x; }
      send[n] = e;
    }
    for (int n = 0; n < g->nNodes; n++) if (g->TY[n] == T_CHANCE && g->ST[n] == 1) {
      g->riverSlots++;
      for (int k = 0; k < g->NN[n]; k++) { const int r = g->CHN[g->CS[n] + k], sz = send[r] - r; if (sz > g->riverMaxSub) g->riverMaxSub = sz; }
    }
    free(send);
  }
  // compatible mass normaliser
  f64 Z = 0;
  {
    f64 cs[52] = { 0 }, tot = 0;
    for (int c = 0; c < g->N[1]; c++) { f64 r = g->W[1][c]; tot += r; cs[g->L1[1][c]] += r; cs[g->L2[1][c]] += r; }
    for (int h = 0; h < g->N[0]; h++) { int k = g->SAME[0][h]; Z += g->W[0][h] * (tot - cs[g->L1[0][h]] - cs[g->L2[0][h]] + (k >= 0 ? g->W[1][k] : 0)); }
  }
  g->Z = Z;
  if (!(Z > 0)) { snprintf(err, (size_t)errlen, "The two ranges have no compatible hands on this board"); game_free_impl(g); return NULL; }
  g->OUT0 = (f32 *)calloc((size_t)g->maxN, sizeof(f32)); g->OUT1 = (f32 *)calloc((size_t)g->maxN, sizeof(f32));
  return g;
}
static void s_free(Game *g) { game_free_impl(g); }

static double mem_bytes(Game *g, int comp) {
  double b = (double)g->dataSize * (comp ? 4 : 8) + (double)g->nNodes * 48 + (double)g->nCh * 10;
  for (int i = 0; i < g->nBoards; i++) b += (double)(g->boards[i].m[0] + g->boards[i].m[1]) * 6;
  b += (double)POOL.n * (g->maxDepth + 4) * g->maxN * 4.0 * (2 + 2 * g->maxA);
  return b;
}
// GPU memory for the river phase with one work-group (the minimum gpu_setup accepts); eb = bytes per regret
static double gpu_need(const Game *g, int eb) {
  return 2.0 * (double)g->riverData * eb + 2.0 * g->riverSlots * g->maxN * 4.0 + (double)g->nNodes * 58 + (double)g->nCh * 4
    + (double)g->nBoards * 2 * (9.0 * 1326 * 2 + 106) + (double)g->riverMaxSub * g->maxN * 8 + (double)g->riverMaxSub * 4;
}
static int gpu_fits(const Game *g, int eb) {
  if (!gpu_ready() || !g->riverSlots) return 0;
  const double budget = gpu_mem_mb() * 1048576.0 * 0.85, mx = gpu_max_alloc_mb() * 1048576.0;
  if ((double)g->riverData * eb > 1.96 * mx || 1.0 * g->riverSlots * g->maxN * 4 > mx) return 0;   // one array spans at most two buffers
  return gpu_need(g, eb) <= budget;
}
static int decide_comp(Game *g) {
  if (g->cfg.compress >= 0) return g->cfg.compress;
  int comp = (double)g->dataSize * 8 > g->cfg.compressAboveMB * 1048576.0;
  // the GPU is several times faster than the CPU: store the tree in 16-bit when only that fits the graphics card
  if (!comp && g->cfg.gpu && g->nb < 5 && !gpu_fits(g, 4) && gpu_fits(g, 2)) comp = 1;
  return comp;
}
static double s_mem_mb(Game *g) { return mem_bytes(g, decide_comp(g)) / 1048576.0; }
static void s_stats(Game *g, JB *o) {
  int comp = g->allocated ? g->comp : decide_comp(g);
  jb_printf(o, "{\"nodes\":%d,\"decisions\":%d,\"chance\":%d,\"terminals\":%d,\"combos\":[%d,%d],\"floats\":%lld,\"boards\":%d,\"compressed\":%s,\"memMB\":",
    g->nNodes, g->nPlayer, g->nChance, g->nTerm, g->N[0], g->N[1], (long long)g->dataSize, g->nBoards, comp ? "true" : "false");
  jb_num(o, mem_bytes(g, comp) / 1048576.0, 1);
  if (g->riverSlots && g->nb < 5) { jb_puts(o, ",\"gpuMB\":"); jb_num(o, gpu_need(g, comp ? 2 : 4) / 1048576.0, 1); }
  jb_printf(o, ",\"threads\":%d}", POOL.n);
}
static void cum_grow(Game *g, int need) {
  if (g->cumCap > need) return;
  int cap = need + 1024;
  f64 *c = (f64 *)realloc(g->CUM, sizeof(f64) * (size_t)cap);
  if (!g->cumCap) { c[0] = 1; g->cumCap = 1; }
  for (int k = g->cumCap; k < cap; k++) { f64 ta = (f64)k * __builtin_sqrt((f64)k); c[k] = c[k - 1] * ta / (ta + 1); }
  g->CUM = c; g->cumCap = cap;
}
static int s_alloc(Game *g, char *err, int errlen) {
  if (g->allocated && (g->R32 || g->R16)) return 1;
  int comp = g->allocated ? g->comp : decide_comp(g);
  size_t n = (size_t)g->dataSize;
  if (!g->allocated) {
    g->comp = comp;
    if (comp) { g->S16 = (u16 *)calloc(n ? n : 1, 2); } else { g->S32 = (f32 *)calloc(n ? n : 1, 4); }
    g->RSC = (f32 *)malloc(sizeof(f32) * (size_t)g->nNodes); g->SSC = (f32 *)malloc(sizeof(f32) * (size_t)g->nNodes);
    g->LR = (i32 *)calloc((size_t)g->nNodes, sizeof(i32)); g->LS = (i32 *)calloc((size_t)g->nNodes, sizeof(i32));
    if ((comp ? (void *)g->S16 : (void *)g->S32) == NULL || !g->RSC || !g->SSC || !g->LR || !g->LS) {
      snprintf(err, (size_t)errlen, "Not enough memory for this tree (%.0f MB). Use fewer bet sizes or narrower ranges.", mem_bytes(g, comp) / 1048576.0); return 0;
    }
    for (int i = 0; i < g->nNodes; i++) { g->RSC[i] = 1; g->SSC[i] = 1; }
    g->allocated = 1;
  }
  if (g->comp) g->R16 = (i16 *)calloc(n ? n : 1, 2); else g->R32 = (f32 *)calloc(n ? n : 1, 4);
  if (!(g->comp ? (void *)g->R16 : (void *)g->R32)) { snprintf(err, (size_t)errlen, "Not enough memory for this tree (%.0f MB). Use fewer bet sizes or narrower ranges.", mem_bytes(g, g->comp) / 1048576.0); return 0; }
  for (int i = 0; i < POOL.n; i++) ctx_reserve(POOL.ctx[i], g->maxDepth + 4, g->maxN, g->maxA);
  cum_grow(g, 1024);
  return 1;
}

/* ---------------- kernels ---------------- */
// compatible opponent mass for every hand of p: total minus the hands sharing a card (per-card sums come from
// the per-card hand lists, so there are no dependent scattered updates), plus the identical combo
static void compatMass(const Game *g, int p, const f32 *ro, f32 *restrict out, f32 pay) {
  const int o = 1 - p, nO = g->N[o], nP = g->N[p];
  const i32 *woff = g->WOFF[o], *wdat = g->WDAT[o], *same = g->SAME[p];
  const u8 *c1P = g->L1[p], *c2P = g->L2[p];
  f32 cs[52], tot = 0.f;
  for (int c = 0; c < nO; c++) tot += ro[c];
  for (int k = 0; k < 52; k++) { f32 a = 0.f; for (int q = woff[k]; q < woff[k + 1]; q++) a += ro[wdat[q]]; cs[k] = a; }
  for (int h = 0; h < nP; h++) { const int k = same[h]; out[h] = pay * (tot - cs[c1P[h]] - cs[c2P[h]] + (k >= 0 ? ro[k] : 0.f)); }
}
// out = pw * (opponent mass we beat) + pl * (mass we lose to) + ut * (all compatible mass on this board).
// The "beat" sweep (ascending) and the "lose to" sweep (descending) run interleaved: two independent
// dependency chains instead of one long one.
static void showdown(const Game *g, Ctx *cx, int bid, int p, const f32 *ro, f32 *restrict out, f32 pw, f32 pl, f32 ut) {
  const int o = 1 - p; const Board *B = &g->boards[bid];
  const int mP = B->m[p], mO = B->m[o];
  const u16 *ordP = B->ord[p], *ordO = B->ord[o], *lt = B->lt[p], *le = B->le[p];
  const u8 *c1P = g->L1[p], *c2P = g->L2[p], *c1O = g->L1[o], *c2O = g->L2[o];
  const int nP = g->N[p];
  f32 *restrict lose = cx->SDT;
  if (mP < nP) memset(out, 0, sizeof(f32) * (size_t)nP);   // hands that hold a board card
  f32 cw[52], cl[52];
  memset(cw, 0, sizeof cw); memset(cl, 0, sizeof cl);
  f32 tw = 0.f, tl = 0.f; int j = 0, k = mO - 1;
  for (int i = 0, i2 = mP - 1; i < mP; i++, i2--) {
    const int lim = lt[i], lim2 = le[i2];
    while (j < lim) { const int c = ordO[j++]; const f32 r = ro[c]; tw += r; cw[c1O[c]] += r; cw[c2O[c]] += r; }
    while (k >= lim2) { const int c = ordO[k--]; const f32 r = ro[c]; tl += r; cl[c1O[c]] += r; cl[c2O[c]] += r; }
    const int h = ordP[i], h2 = ordP[i2];
    out[h] = tw - cw[c1P[h]] - cw[c2P[h]];
    lose[h2] = tl - cl[c1P[h2]] - cl[c2P[h2]];
  }
  for (int i = 0; i < mP; i++) { const int h = ordP[i]; out[h] = pw * out[h] + pl * lose[h]; }
  if (ut != 0.f) {
    // board-compatible mass: the opponent hands on this board, minus card overlaps, plus the identical combo
    f32 cs[52], tot = 0.f;
    memset(cs, 0, sizeof cs);
    for (int q = 0; q < mO; q++) { const int c = ordO[q]; const f32 r = ro[c]; tot += r; cs[c1O[c]] += r; cs[c2O[c]] += r; }
    const i32 *same = g->SAME[p];
    for (int i = 0; i < mP; i++) { const int h = ordP[i], q = same[h]; out[h] += ut * (tot - cs[c1P[h]] - cs[c2P[h]] + (q >= 0 ? ro[q] : 0.f)); }
  }
}
static void foldTerm(const Game *g, int p, const f32 *ro, f32 *restrict out, f32 pay) { compatMass(g, p, ro, out, pay); }
typedef struct { const Game *g; int p; const f32 *ro; const i32 *ids; f32 pw, pl, ut; } AllinJob;
static void allin_item(Ctx *c, int k, void *arg) {
  AllinJob *J = (AllinJob *)arg; const int nP = J->g->N[J->p];
  showdown(J->g, c, J->ids[k], J->p, J->ro, c->ALLT, J->pw, J->pl, J->ut);
  for (int h = 0; h < nP; h++) c->part[h] += c->ALLT[h];
}
static void allinTerm(const Game *g, Ctx *c, int node, int p, const f32 *ro, f32 *restrict out, f32 pw, f32 pl, f32 ut) {
  const Runout *R = &g->run[g->NX[node]];
  const int nP = g->N[p];
  if (!c->inPar && POOL.n > 1 && R->n >= 32) {
    AllinJob J = { g, p, ro, R->ids, pw, pl, ut };
    pool_run(allin_item, &J, R->n, nP);
    for (int h = 0; h < nP; h++) { f32 s = 0; for (int t = 0; t < POOL.n; t++) s += POOL.ctx[t]->part[h]; out[h] = s * R->w; }
    return;
  }
  for (int h = 0; h < nP; h++) out[h] = 0.f;
  for (int k = 0; k < R->n; k++) { showdown(g, c, R->ids[k], p, ro, c->ALLT, pw, pl, ut); for (int h = 0; h < nP; h++) out[h] += c->ALLT[h]; }
  for (int h = 0; h < nP; h++) out[h] *= R->w;
}
// ICM: tournament equity of player p when OOP finishes the hand with x chips (linear interpolation of the table)
static f32 icmU(const Game *g, int p, f64 x) {
  const int n = g->cfg.icmN;
  f64 f = (x - g->cfg.icmX0) / g->cfg.icmDx; if (!(f > 0)) f = 0; if (f > n - 1) f = n - 1;
  int i = (int)f; if (i > n - 2) i = n - 2;
  const f64 w = f - i; const float *u = g->cfg.icmU[p];
  return (f32)(u[i] + (u[i + 1] - u[i]) * w);
}
static f32 icmFold(const Game *g, int p, f32 c0, f32 c1) { return icmU(g, p, p == 0 ? g->cfg.icmB0 - c0 : g->cfg.icmB0 - c0 + g->P0 + c0 + c1); }
static void terminal(const Game *g, Ctx *c, int node, int p, const f32 *ro, f32 *out) {
  const int ty = g->TY[node];
  if (g->cfg.icm) {
    const f64 c0 = g->NC0[node], pot = g->P0 + c0 + g->NC1[node], xl = g->cfg.icmB0 - c0, xw = xl + pot;
    if (ty == T_FOLD) { foldTerm(g, p, ro, out, icmU(g, p, g->PL[node] == 0 ? xl : xw)); return; }
    const f32 uw = icmU(g, p, p == 0 ? xw : xl), ul = icmU(g, p, p == 0 ? xl : xw), ut = icmU(g, p, xl + 0.5 * pot);
    if (ty == T_SHOW) showdown(g, c, g->NX[node], p, ro, out, uw - ut, ul - ut, ut); else allinTerm(g, c, node, p, ro, out, uw - ut, ul - ut, ut);
    return;
  }
  if (ty == T_FOLD) {
    const int f = g->PL[node]; const f32 cf = f == 0 ? g->NC0[node] : g->NC1[node];
    foldTerm(g, p, ro, out, (f == p ? -1.f : 1.f) * (g->P0H + cf));
  } else if (ty == T_SHOW) { const f32 pay = g->P0H + g->NC0[node]; showdown(g, c, g->NX[node], p, ro, out, pay, -pay, 0.f); }
  else { const f32 pay = g->P0H + g->NC0[node]; allinTerm(g, c, node, p, ro, out, pay, -pay, 0.f); }
}
static void regretMatch(const Game *g, Ctx *cx, i64 off, int nA, int nq, f32 *restrict st) {
  f32 *restrict sum = cx->SUMB;
  for (int h = 0; h < nq; h++) sum[h] = 0.f;
  if (g->comp) for (int a = 0; a < nA; a++) {
    const i16 *restrict r = g->R16 + off + (i64)a * nq; f32 *restrict s = st + a * nq;
    for (int h = 0; h < nq; h++) { const f32 v = (f32)r[h]; const f32 x = v > 0.f ? v : 0.f; s[h] = x; sum[h] += x; }
  } else for (int a = 0; a < nA; a++) {
    const f32 *restrict r = g->R32 + off + (i64)a * nq; f32 *restrict s = st + a * nq;
    for (int h = 0; h < nq; h++) { const f32 v = r[h]; const f32 x = v > 0.f ? v : 0.f; s[h] = x; sum[h] += x; }
  }
  const f32 u = 1.f / (f32)nA;
  for (int h = 0; h < nq; h++) sum[h] = sum[h] > 0.f ? 1.f / sum[h] : 0.f;
  for (int a = 0; a < nA; a++) { f32 *restrict s = st + a * nq; for (int h = 0; h < nq; h++) s[h] = sum[h] > 0.f ? s[h] * sum[h] : u; }
}
static void avgStrat(const Game *g, Ctx *cx, int node, f32 *restrict dst) {
  const int q = g->PL[node], nA = g->NN[node], nq = g->N[q];
  const i64 off = g->DO[node];
  if (g->LOCK[node]) { memcpy(dst, g->LOCK[node], sizeof(f32) * (size_t)(nA * nq)); return; }
  f32 *restrict sum = cx->SUMB;
  for (int h = 0; h < nq; h++) sum[h] = 0.f;
  if (g->comp) for (int a = 0; a < nA; a++) { const u16 *restrict s = g->S16 + off + (i64)a * nq; for (int h = 0; h < nq; h++) sum[h] += (f32)s[h]; }
  else for (int a = 0; a < nA; a++) { const f32 *restrict s = g->S32 + off + (i64)a * nq; for (int h = 0; h < nq; h++) sum[h] += s[h]; }
  const f32 u = 1.f / (f32)nA;
  for (int h = 0; h < nq; h++) sum[h] = sum[h] > 0.f ? 1.f / sum[h] : 0.f;
  if (g->comp) for (int a = 0; a < nA; a++) { const u16 *restrict s = g->S16 + off + (i64)a * nq; f32 *restrict o = dst + a * nq; for (int h = 0; h < nq; h++) o[h] = sum[h] > 0.f ? (f32)s[h] * sum[h] : u; }
  else for (int a = 0; a < nA; a++) { const f32 *restrict s = g->S32 + off + (i64)a * nq; f32 *restrict o = dst + a * nq; for (int h = 0; h < nq; h++) o[h] = sum[h] > 0.f ? s[h] * sum[h] : u; }
}

static void cfr(Game *g, Ctx *c, int node, int p, const f32 *ro, f32 *restrict out, int d);
static void evalT(Game *g, Ctx *c, int node, int p, const f32 *ro, f32 *restrict out, int d, int br);
static void gpu_io(Game *g, int node, int p, const f32 *ro, f32 *out);
typedef struct { Game *g; int node, p, d, mode, br; const f32 *ro; } ChanceJob;
static void chance_child(Game *g, Ctx *c, int node, int k, int p, const f32 *ro, int d, int mode, int br, f32 *acc) {
  const int o = 1 - p, nO = g->N[o], nP = g->N[p], s = g->CS[node], card = g->CHC[s + k];
  if (g->CHP[s + k]) return;   // an equivalent card: added with its canonical card below
  f32 *restrict r2 = c->RB + (size_t)d * c->N, *restrict tmp = c->TB + (size_t)d * c->N;
  memcpy(r2, ro, sizeof(f32) * (size_t)nO);
  for (int q = g->WOFF[o][card]; q < g->WOFF[o][card + 1]; q++) r2[g->WDAT[o][q]] = 0.f;
  if (mode == 0) cfr(g, c, g->CHN[s + k], p, r2, tmp, d + 1); else evalT(g, c, g->CHN[s + k], p, r2, tmp, d + 1, br);
  if (g->phase == 1) return;
  for (int q = g->WOFF[p][card]; q < g->WOFF[p][card + 1]; q++) tmp[g->WDAT[p][q]] = 0.f;
  for (int h = 0; h < nP; h++) acc[h] += tmp[h];
  const int nc = g->NN[node], child = g->CHN[s + k];
  for (int k2 = k + 1; k2 < nc; k2++) if (g->CHP[s + k2] && g->CHN[s + k2] == child) {
    const i16 *restrict ph = g->PH[g->CHP[s + k2]][p];
    for (int h = 0; h < nP; h++) acc[h] += tmp[ph[h]];
  }
}
static void chance_item(Ctx *c, int k, void *arg) {
  ChanceJob *J = (ChanceJob *)arg;
  chance_child(J->g, c, J->node, k, J->p, J->ro, J->d, J->mode, J->br, c->part);
}
static void chanceNode(Game *g, Ctx *c, int node, int p, const f32 *ro, f32 *restrict out, int d, int mode, int br) {
  const int nP = g->N[p], nc = g->NN[node], collect = g->phase == 1;
  const f32 w = g->ST[node] == 0 ? 1.f / 45.f : 1.f / 44.f;
  if (!c->inPar && POOL.n > 1) {
    ChanceJob J = { g, node, p, d, mode, br, ro };
    pool_run(chance_item, &J, nc, nP);
    if (collect) return;
    for (int h = 0; h < nP; h++) { f32 s = 0; for (int t = 0; t < POOL.n; t++) s += POOL.ctx[t]->part[h]; out[h] = s * w; }
    return;
  }
  if (!collect) for (int h = 0; h < nP; h++) out[h] = 0.f;
  for (int k = 0; k < nc; k++) chance_child(g, c, node, k, p, ro, d, mode, br, out);
  if (!collect) for (int h = 0; h < nP; h++) out[h] *= w;
}

// phase 0 is the plain CPU engine. With the GPU, a traversal runs twice: phase 1 walks the flop and
// turn top-down (opponent strategy sums, reach) and queues each river chance node it reaches; the GPU
// solves those; phase 2 recomputes the same reach and finishes bottom-up with the GPU's river values.
static void cfr(Game *g, Ctx *c, int node, int p, const f32 *ro, f32 *restrict out, int d) {
  const int ty = g->TY[node], ph = g->phase;
  if (ty >= T_FOLD) { if (ph != 1) terminal(g, c, node, p, ro, out); return; }
  if (ty == T_CHANCE) { if (ph && g->ST[node] == 1) gpu_io(g, node, p, ro, out); else chanceNode(g, c, node, p, ro, out, d, 0, 0); return; }
  const int q = g->PL[node], nA = g->NN[node], s0 = g->CS[node], nq = g->N[q], nP = g->N[p];
  if (ph == 1 && q == p) { for (int a = 0; a < nA; a++) cfr(g, c, g->CHN[s0 + a], p, ro, out, d + 1); return; }
  const i64 off = g->DO[node];
  const int N = c->N;
  f32 *restrict st = c->SB + (size_t)d * c->A * N;
  const f32 *lk = g->LOCK[node];
  if (lk) memcpy(st, lk, sizeof(f32) * (size_t)(nA * nq)); else regretMatch(g, c, off, nA, nq, st);
  if (q == p) {
    f32 *ob = c->OB + (size_t)d * c->A * N;
    for (int a = 0; a < nA; a++) cfr(g, c, g->CHN[s0 + a], p, ro, ob + (size_t)a * N, d + 1);
    for (int h = 0; h < nP; h++) out[h] = 0.f;
    for (int a = 0; a < nA; a++) { const f32 *restrict o = ob + (size_t)a * N, *restrict s = st + a * nq; for (int h = 0; h < nP; h++) out[h] += s[h] * o[h]; }
    if (lk) return;
    const int last = g->LR[node];
    const f32 fp = last > 0 ? (f32)(g->CUM[g->t - 1] / g->CUM[last - 1]) : 1.f;
    f32 fn = 1.f; if (last > 0) { const int e = g->t - last; fn = e >= 60 ? 0.f : (f32)(1.0 / (f64)(1ULL << e)); }
    g->LR[node] = g->t;
    if (!g->comp) {
      for (int a = 0; a < nA; a++) {
        const f32 *restrict o = ob + (size_t)a * N; f32 *restrict r = g->R32 + off + (i64)a * nq;
        for (int h = 0; h < nq; h++) { const f32 x = r[h]; r[h] = (x > 0.f ? x * fp : x * fn) + (o[h] - out[h]); }
      }
      return;
    }
    const f32 sc = g->RSC[node]; f32 mx = 0.f;
    for (int a = 0; a < nA; a++) {
      const f32 *restrict o = ob + (size_t)a * N; const i16 *restrict r = g->R16 + off + (i64)a * nq; f32 *restrict tr = st + a * nq;
      for (int h = 0; h < nq; h++) { const f32 x0 = (f32)r[h] * sc; const f32 x = (x0 > 0.f ? x0 * fp : x0 * fn) + (o[h] - out[h]); tr[h] = x; const f32 ax = x < 0.f ? -x : x; mx = ax > mx ? ax : mx; }
    }
    const f32 ns = mx > 0.f ? mx / 32767.f : 1.f, inv = 1.f / ns;
    for (int a = 0; a < nA; a++) { const f32 *restrict tr = st + a * nq; i16 *restrict r = g->R16 + off + (i64)a * nq; for (int h = 0; h < nq; h++) { const f32 y = tr[h] * inv; r[h] = (i16)(y >= 0.f ? y + 0.5f : y - 0.5f); } }
    g->RSC[node] = ns;
  } else {
    if (ph != 1) for (int h = 0; h < nP; h++) out[h] = 0.f;
    f32 *restrict rq = c->RB + (size_t)d * N, *restrict tmp = c->TB + (size_t)d * N;
    if (!lk && ph != 2) {
      const int last = g->LS[node];
      f32 fs = 0.f; if (last > 0) { const f64 x = (f64)last / (f64)g->t; fs = (f32)(g->cfg.gamma == 3 ? x * x * x : g->cfg.gamma == 2 ? x * x : pow(x, g->cfg.gamma)); }
      g->LS[node] = g->t;
      if (!g->comp) {
        for (int a = 0; a < nA; a++) { const f32 *restrict s = st + a * nq; f32 *restrict ss = g->S32 + off + (i64)a * nq; for (int h = 0; h < nq; h++) ss[h] = ss[h] * fs + ro[h] * s[h]; }
      } else {
        const f32 sc = g->SSC[node] * fs; f32 *restrict tmpS = c->OB + (size_t)d * c->A * N; f32 mx = 0.f;
        for (int a = 0; a < nA; a++) { const f32 *restrict s = st + a * nq; const u16 *restrict ss = g->S16 + off + (i64)a * nq; f32 *restrict ts = tmpS + a * nq; for (int h = 0; h < nq; h++) { const f32 x = (f32)ss[h] * sc + ro[h] * s[h]; ts[h] = x; mx = x > mx ? x : mx; } }
        const f32 ns = mx > 0.f ? mx / 65535.f : 1.f, inv = 1.f / ns;
        for (int a = 0; a < nA; a++) { const f32 *restrict ts = tmpS + a * nq; u16 *restrict ss = g->S16 + off + (i64)a * nq; for (int h = 0; h < nq; h++) ss[h] = (u16)(ts[h] * inv + 0.5f); }
        g->SSC[node] = ns;
      }
    }
    for (int a = 0; a < nA; a++) {
      const f32 *restrict s = st + a * nq; f32 any = 0.f;
      for (int h = 0; h < nq; h++) { const f32 v = ro[h] * s[h]; rq[h] = v; any += v; }
      if (any == 0.f) continue;
      cfr(g, c, g->CHN[s0 + a], p, rq, tmp, d + 1);
      if (ph != 1) for (int h = 0; h < nP; h++) out[h] += tmp[h];
    }
  }
}
static void evalT(Game *g, Ctx *c, int node, int p, const f32 *ro, f32 *restrict out, int d, int br) {
  const int ty = g->TY[node], ph = g->phase;
  if (ty >= T_FOLD) { if (ph != 1) terminal(g, c, node, p, ro, out); return; }
  if (ty == T_CHANCE) { if (ph && g->ST[node] == 1) gpu_io(g, node, p, ro, out); else chanceNode(g, c, node, p, ro, out, d, 1, br); return; }
  const int q = g->PL[node], nA = g->NN[node], s0 = g->CS[node], nq = g->N[q], nP = g->N[p], N = c->N;
  f32 *restrict tmp = c->TB + (size_t)d * N;
  if (ph == 1 && q == p) { for (int a = 0; a < nA; a++) evalT(g, c, g->CHN[s0 + a], p, ro, tmp, d + 1, br); return; }
  f32 *restrict st = c->SB + (size_t)d * c->A * N;
  avgStrat(g, c, node, st);
  if (q == p) {
    const int useMax = br && !g->LOCK[node];
    for (int a = 0; a < nA; a++) {
      evalT(g, c, g->CHN[s0 + a], p, ro, tmp, d + 1, br);
      const f32 *restrict s = st + a * nq;
      if (useMax) { if (a == 0) for (int h = 0; h < nP; h++) out[h] = tmp[h]; else for (int h = 0; h < nP; h++) out[h] = tmp[h] > out[h] ? tmp[h] : out[h]; }
      else { if (a == 0) for (int h = 0; h < nP; h++) out[h] = s[h] * tmp[h]; else for (int h = 0; h < nP; h++) out[h] += s[h] * tmp[h]; }
    }
  } else {
    if (ph != 1) for (int h = 0; h < nP; h++) out[h] = 0.f;
    f32 *restrict rq = c->RB + (size_t)d * N;
    for (int a = 0; a < nA; a++) {
      const f32 *restrict s = st + a * nq; f32 any = 0.f;
      for (int h = 0; h < nq; h++) { const f32 v = ro[h] * s[h]; rq[h] = v; any += v; }
      if (any == 0.f) continue;
      evalT(g, c, g->CHN[s0 + a], p, rq, tmp, d + 1, br);
      if (ph != 1) for (int h = 0; h < nP; h++) out[h] += tmp[h];
    }
  }
}

/* ---------------- GPU river phase ---------------- */
typedef struct GpuState {
  int nSlots, nEnt, maxSub, groups, chunk, nAct, missing, dirty, cumUp, eSplit, eb;   // eb: bytes per regret (4, or 2 in 16-bit)
  i32 *slotOf, *entRoot, *entSize; i64 *entCpu, *entLen; u32 *entGpu; i64 gpuData; u32 spl;
  GBuf *TY, *PL, *NN, *CS, *CHN, *DO, *NX, *NC0, *NC1, *SEND, *RS[2], *R0, *S0, *R1, *S1, *LR, *LS, *RSC, *SSC;
  GBuf *HL1, *HL2, *HSAME, *HWOFF, *HWDAT, *BDAT, *BOFF, *BM, *CDAT, *COFF;
  GBuf *SLOTS, *ENT, *EQV, *PHD, *PHO, *REQ, *RO, *VOUT, *SCR, *SCRI, *CTR, *CUM, *ICMT;
  f32 *hRO, *hVOUT; GBuf *pinRO, *pinVOUT; i32 *reqSlot, *cidx;
  double secGpu, secAll; long long launches; double mb;
} GpuState;
static double now_sec(void) {
  struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}
static void gpu_teardown(Game *g) {
  GpuState *gs = g->gs;
  if (!gs) return;
  GBuf *bufs[] = { gs->TY, gs->PL, gs->NN, gs->CS, gs->CHN, gs->DO, gs->NX, gs->NC0, gs->NC1, gs->SEND, gs->RS[0], gs->RS[1], gs->R0, gs->S0, gs->R1, gs->S1, gs->LR, gs->LS, gs->RSC, gs->SSC,
    gs->HL1, gs->HL2, gs->HSAME, gs->HWOFF, gs->HWDAT, gs->BDAT, gs->BOFF, gs->BM, gs->CDAT, gs->COFF,
    gs->SLOTS, gs->ENT, gs->EQV, gs->PHD, gs->PHO, gs->REQ, gs->RO, gs->VOUT, gs->SCR, gs->SCRI, gs->CTR, gs->CUM, gs->ICMT };
  for (size_t i = 0; i < sizeof bufs / sizeof bufs[0]; i++) gpu_free(bufs[i]);
  if (gs->hRO) gpu_host_free(gs->hRO, gs->pinRO);
  if (gs->hVOUT) gpu_host_free(gs->hVOUT, gs->pinVOUT);
  free(gs->slotOf); free(gs->entRoot); free(gs->entSize); free(gs->entCpu); free(gs->entLen); free(gs->entGpu); free(gs->reqSlot); free(gs->cidx);
  free(gs); g->gs = NULL;
}
// moves the river blocks of entries [e0, e1) between the CPU arrays and one device buffer that starts at GPU
// offset base; offsets count elements of eb bytes (4, or 2 for 16-bit trees)
static int gpu_move(GpuState *gs, int e0, int e1, GBuf *dev, i64 base, char *host, int up, char *stage, i64 CH) {
  const size_t eb = (size_t)gs->eb;
  int e = e0; i64 done = 0;
  while (e < e1) {
    const i64 start = gs->entGpu[e] + done - base;
    int e2 = e; i64 d2 = done, n = 0;
    while (e2 < e1 && n < CH) { i64 take = gs->entLen[e2] - d2; if (take > CH - n) take = CH - n; n += take; d2 += take; if (d2 == gs->entLen[e2]) { e2++; d2 = 0; } }
    if (!up && !gpu_read(dev, (size_t)start * eb, stage, (size_t)n * eb)) return 0;
    i64 k = 0;
    while (k < n) {
      i64 take = gs->entLen[e] - done; if (take > n - k) take = n - k;
      if (up) memcpy(stage + (size_t)k * eb, host + (size_t)(gs->entCpu[e] + done) * eb, (size_t)take * eb);
      else memcpy(host + (size_t)(gs->entCpu[e] + done) * eb, stage + (size_t)k * eb, (size_t)take * eb);
      k += take; done += take;
      if (done == gs->entLen[e]) { e++; done = 0; }
    }
    if (up && !gpu_write(dev, (size_t)start * eb, stage, (size_t)n * eb)) return 0;
  }
  return 1;
}
static int gpu_move_all(Game *g, int up) {
  GpuState *gs = g->gs;
  const i64 CH = (i64)1 << 24;
  char *stage = (char *)malloc((size_t)CH * 4);
  int ok = stage != NULL;
  for (int pass = 0; ok && pass < 2; pass++) {
    char *host = g->comp ? (char *)(pass ? (void *)g->S16 : (void *)g->R16) : (char *)(pass ? g->S32 : g->R32);
    ok = gpu_move(gs, 0, gs->eSplit, pass ? gs->S0 : gs->R0, 0, host, up, stage, CH)
      && (gs->eSplit == gs->nEnt || gpu_move(gs, gs->eSplit, gs->nEnt, pass ? gs->S1 : gs->R1, gs->spl, host, up, stage, CH));
  }
  free(stage);
  return ok;
}
// copy the river regrets and strategy sums back into the CPU arrays (views, saves, CPU fallback)
static int gpu_sync(Game *g) {
  GpuState *gs = g->gs;
  if (!gs || !gs->dirty) return 1;
  i32 *lr = (i32 *)malloc(sizeof(i32) * (size_t)g->nNodes), *ls = (i32 *)malloc(sizeof(i32) * (size_t)g->nNodes);
  f32 *rsc = g->comp ? (f32 *)malloc(sizeof(f32) * (size_t)g->nNodes) : NULL, *ssc = g->comp ? (f32 *)malloc(sizeof(f32) * (size_t)g->nNodes) : NULL;
  int ok = lr && ls && (!g->comp || (rsc && ssc)) && gpu_move_all(g, 0);
  ok = ok && gpu_read(gs->LR, 0, lr, sizeof(i32) * (size_t)g->nNodes) && gpu_read(gs->LS, 0, ls, sizeof(i32) * (size_t)g->nNodes);
  if (ok && g->comp) ok = gpu_read(gs->RSC, 0, rsc, sizeof(f32) * (size_t)g->nNodes) && gpu_read(gs->SSC, 0, ssc, sizeof(f32) * (size_t)g->nNodes);
  for (int e = 0; ok && e < gs->nEnt; e++) {
    const size_t r = (size_t)gs->entRoot[e], n = (size_t)gs->entSize[e];
    memcpy(g->LR + r, lr + r, n * 4); memcpy(g->LS + r, ls + r, n * 4);
    if (g->comp) { memcpy(g->RSC + r, rsc + r, n * 4); memcpy(g->SSC + r, ssc + r, n * 4); }
  }
  free(lr); free(ls); free(rsc); free(ssc);
  if (ok) gs->dirty = 0;
  return ok;
}
static void gpu_fallback(Game *g, const char *why) {
  if (g->gs) gpu_sync(g);
  gpu_teardown(g);
  g->gpuFailed = 1;
  snprintf(g->gpuWhy, sizeof g->gpuWhy, "GPU stopped (%s), continuing on the CPU", why);
  fprintf(stderr, "  %s\n", g->gpuWhy);
}
static int gpu_eligible(Game *g) {
  const char *why = NULL;
  if (g->gpuFailed) return 0;
  if (!g->cfg.gpu) why = "GPU turned off for this solve";
  else if (!gpu_ready()) why = gpu_desc();
  else if (g->nb == 5) why = "river spots are solved on the CPU";
  else if (g->viewOnly) why = "loaded solution";
  else if (g->nRiverLocks) why = "locked river decisions are solved on the CPU";
  else if (g->maxA > 16) why = "too many bet sizes for the GPU";
  if (why) { snprintf(g->gpuWhy, sizeof g->gpuWhy, "%s", why); return 0; }
  return 1;
}
static int lower_u16(const u16 *a, int n, int x) { int lo = 0, hi = n; while (lo < hi) { int m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
#define GPUT(field, ptr, bytes) do { gs->field = gpu_alloc(bytes); if (!gs->field || !gpu_write(gs->field, 0, (ptr), (bytes))) { ok = 0; goto done; } } while (0)
#define GNEW(field, bytes) do { gs->field = gpu_alloc(bytes); if (!gs->field) { ok = 0; goto done; } } while (0)
static int gpu_setup(Game *g) {
  GpuState *gs = (GpuState *)calloc(1, sizeof(GpuState));
  const int nn = g->nNodes;
  gs->eb = g->comp ? 2 : 4;
  int ok = 1;
  i32 *SEND = (i32 *)malloc(sizeof(i32) * (size_t)nn), *RS[2] = { (i32 *)calloc((size_t)nn, 4), (i32 *)calloc((size_t)nn, 4) };
  u32 *gDO = (u32 *)calloc((size_t)nn, 4);
  i32 *SL = NULL, *ENT = NULL, *EP = NULL;
  u16 *BD = NULL, *CD = NULL; i32 *BO = NULL, *BMv = NULL, *CO = NULL;
  u8 *hl1 = NULL, *hl2 = NULL; i32 *hsame = NULL, *hwdat = NULL, hwoff[106];
  i32 *phd = NULL, pho[48];
  f32 *icmt = NULL, *cum = NULL;
  char why[160] = "";
  g->gs = gs;
  for (int n = nn - 1; n >= 0; n--) {
    int e = n + 1;
    if (g->TY[n] == T_PLAYER || g->TY[n] == T_CHANCE) for (int k = 0; k < g->NN[n]; k++) { const int x = SEND[g->CHN[g->CS[n] + k]]; if (x > e) e = x; }
    SEND[n] = e;
  }
  // requests are river chance nodes; each canonical river card is one subgame
  gs->slotOf = (i32 *)malloc(sizeof(i32) * (size_t)nn);
  int nEnt = 0, nPerm = 0;
  for (int n = 0; n < nn; n++) {
    gs->slotOf[n] = -1;
    if (g->TY[n] != T_CHANCE || g->ST[n] != 1) continue;
    gs->slotOf[n] = gs->nSlots++;
    for (int k = 0; k < g->NN[n]; k++) if (!g->CHP[g->CS[n] + k]) nEnt++; else nPerm++;
  }
  if (!gs->nSlots) { snprintf(why, sizeof why, "no river in this tree"); ok = 0; goto done; }
  SL = (i32 *)malloc(sizeof(i32) * 2 * (size_t)gs->nSlots); ENT = (i32 *)malloc(sizeof(i32) * 5 * (size_t)nEnt); EP = (i32 *)malloc(sizeof(i32) * (size_t)(nPerm + 1));
  gs->entRoot = (i32 *)malloc(sizeof(i32) * (size_t)nEnt); gs->entSize = (i32 *)malloc(sizeof(i32) * (size_t)nEnt);
  gs->entCpu = (i64 *)malloc(sizeof(i64) * (size_t)nEnt); gs->entLen = (i64 *)malloc(sizeof(i64) * (size_t)nEnt); gs->entGpu = (u32 *)malloc(sizeof(u32) * (size_t)nEnt);
  {
    int e = 0, pe = 0; i64 gd = 0;
    for (int n = 0; n < nn; n++) {
      const int sl = gs->slotOf[n];
      if (sl < 0) continue;
      const int s = g->CS[n], nc = g->NN[n];
      SL[2 * sl] = e;
      for (int k = 0; k < nc; k++) {
        if (g->CHP[s + k]) continue;
        const int root = g->CHN[s + k], size = SEND[root] - root;
        ENT[5 * e] = root; ENT[5 * e + 1] = size; ENT[5 * e + 2] = g->CHC[s + k]; ENT[5 * e + 3] = pe;
        for (int k2 = k + 1; k2 < nc; k2++) if (g->CHP[s + k2] && g->CHN[s + k2] == root) EP[pe++] = g->CHP[s + k2];
        ENT[5 * e + 4] = pe - ENT[5 * e + 3];
        if (size > gs->maxSub) gs->maxSub = size;
        // the subtree's data is one contiguous block on the CPU; on the GPU blocks are packed in entry order
        const i64 base = g->DO[root]; i64 len = 0;
        for (int x = root; x < root + size; x++) if (g->TY[x] == T_PLAYER) {
          const i64 end = g->DO[x] - base + (i64)g->NN[x] * g->N[g->PL[x]];
          if (g->DO[x] < base) { snprintf(why, sizeof why, "unexpected tree layout"); ok = 0; goto done; }
          if (end > len) len = end;
          gDO[x] = (u32)(gd + g->DO[x] - base);
        }
        if (len <= 0) { snprintf(why, sizeof why, "unexpected tree layout"); ok = 0; goto done; }
        gs->entRoot[e] = root; gs->entSize[e] = size; gs->entCpu[e] = base; gs->entLen[e] = len; gs->entGpu[e] = (u32)gd;
        gd += len;
        if (gd >= ((i64)1 << 32)) { snprintf(why, sizeof why, "tree too big for the GPU"); ok = 0; goto done; }
        // reach buffers: children of the traverser's own nodes read their parent's
        for (int p = 0; p < 2; p++) {
          RS[p][root] = 0;
          for (int x = root; x < root + size; x++) if (g->TY[x] == T_PLAYER) for (int a = 0; a < g->NN[x]; a++) { const int ch = g->CHN[g->CS[x] + a]; RS[p][ch] = g->PL[x] == p ? RS[p][x] : ch - root; }
        }
        e++;
      }
      SL[2 * sl + 1] = e - SL[2 * sl];
    }
    gs->nEnt = e; gs->gpuData = gd;
  }
  {
    // sum the river data lengths and check against what the GPU can hold
    // (river offsets are stored as 32-bit element indexes)
    if (gs->gpuData > (i64)0xFFFFFFFFu) { snprintf(why, sizeof why, "tree too big for GPU offsets (%.0f MB of river regrets)", (double)gs->gpuData * gs->eb / 1048576.0); ok = 0; goto done; }
    const double mx = gpu_max_alloc_mb() * 1048576.0, budget = gpu_mem_mb() * 1048576.0 * 0.85;
    const double rs = (double)gs->gpuData * gs->eb, io = (double)gs->nSlots * g->maxN * 4;
    double other = rs * 2 + io * 2 + (double)nn * 50 + (double)g->nCh * 4 + (double)g->nBoards * 2 * (9.0 * 1326 * 2 + 106);
    const double perGroup = (double)gs->maxSub * g->maxN * 8 + (double)gs->maxSub * 4;
    // the river data may span two buffers, split at a subgame boundary
    const i64 cap = (i64)(mx / gs->eb);
    gs->eSplit = gs->nEnt; gs->spl = 0xFFFFFFFFu;
    if (gs->gpuData > cap) {
      int e = 0; while (e < gs->nEnt && (i64)gs->entGpu[e] + gs->entLen[e] <= cap) e++;
      gs->eSplit = e; gs->spl = gs->entGpu[e];
      if (gs->gpuData - (i64)gs->spl > cap) { snprintf(why, sizeof why, "tree too big for GPU memory (%.0f MB of regrets, card allows 2 x %.0f MB)", rs / 1048576.0, mx / 1048576.0); ok = 0; goto done; }
    }
    if (io > mx) { snprintf(why, sizeof why, "too many river spots for GPU memory (%.0f MB buffer, card allows %.0f MB)", io / 1048576.0, mx / 1048576.0); ok = 0; goto done; }
    int groups = gpu_units() * 6;
    if (groups > gs->nSlots) groups = gs->nSlots;
    while (groups > 1 && (other + perGroup * groups > budget || perGroup * groups > mx)) groups--;
    if (other + perGroup * groups > budget) { snprintf(why, sizeof why, "tree too big for GPU memory (needs %.0f MB of %.0f MB)", (other + perGroup) / 1048576.0, budget / 1048576.0); ok = 0; goto done; }
    gs->groups = groups;
    gs->mb = (other + perGroup * groups) / 1048576.0;
  }
  // hand tables
  {
    const int N0 = g->N[0], N1 = g->N[1];
    hl1 = (u8 *)malloc((size_t)(N0 + N1)); hl2 = (u8 *)malloc((size_t)(N0 + N1)); hsame = (i32 *)malloc(sizeof(i32) * (size_t)(N0 + N1));
    hwdat = (i32 *)malloc(sizeof(i32) * (size_t)(2 * (N0 + N1)));
    for (int q = 0; q < 2; q++) {
      const int ho = q ? N0 : 0, wo = q ? 2 * N0 : 0;
      for (int h = 0; h < g->N[q]; h++) { hl1[ho + h] = g->L1[q][h]; hl2[ho + h] = g->L2[q][h]; hsame[ho + h] = g->SAME[q][h]; }
      for (int c = 0; c < 53; c++) hwoff[q * 53 + c] = wo + g->WOFF[q][c];
      memcpy(hwdat + wo, g->WDAT[q], sizeof(i32) * (size_t)(2 * g->N[q]));
    }
  }
  // boards: strength order, lt/le, and per-card position lists for O(n) showdowns with card removal
  {
    size_t nbd = 0, ncd = 0;
    for (int b = 0; b < g->nBoards; b++) for (int q = 0; q < 2; q++) { nbd += 7 * (size_t)g->boards[b].m[q]; ncd += 53 + 2 * (size_t)g->boards[b].m[q]; }
    BD = (u16 *)malloc(sizeof(u16) * (nbd + 1)); CD = (u16 *)malloc(sizeof(u16) * (ncd + 1));
    BO = (i32 *)malloc(sizeof(i32) * 2 * (size_t)g->nBoards); BMv = (i32 *)malloc(sizeof(i32) * 2 * (size_t)g->nBoards); CO = (i32 *)malloc(sizeof(i32) * 2 * (size_t)g->nBoards);
    size_t bp = 0, cp = 0;
    for (int b = 0; b < g->nBoards; b++) {
      const Board *B = &g->boards[b];
      for (int q = 0; q < 2; q++) {
        // q's own card lists (positions in q's strength order)
        const int m = B->m[q];
        u16 *cb = CD + cp; int cnt[52] = { 0 };
        for (int i = 0; i < m; i++) { const int h = B->ord[q][i]; cnt[g->L1[q][h]]++; cnt[g->L2[q][h]]++; }
        cb[0] = 0; for (int c = 0; c < 52; c++) cb[c + 1] = (u16)(cb[c] + cnt[c]);
        int fill[52]; for (int c = 0; c < 52; c++) fill[c] = cb[c];
        for (int i = 0; i < m; i++) { const int h = B->ord[q][i]; cb[53 + fill[g->L1[q][h]]++] = (u16)i; cb[53 + fill[g->L2[q][h]]++] = (u16)i; }
        CO[b * 2 + q] = (i32)cp; cp += 53 + 2 * (size_t)m;
      }
      for (int q = 0; q < 2; q++) {
        const int m = B->m[q], x = 1 - q;
        const u16 *cbx = CD + CO[b * 2 + x];
        u16 *d = BD + bp;
        BO[b * 2 + q] = (i32)bp; BMv[b * 2 + q] = m;
        for (int i = 0; i < m; i++) {
          const int h = B->ord[q][i], c1 = g->L1[q][h], c2 = g->L2[q][h], lt = B->lt[q][i], le = B->le[q][i];
          d[i] = (u16)h; d[m + i] = (u16)lt; d[2 * m + i] = (u16)le;
          d[3 * m + i] = (u16)lower_u16(cbx + 53 + cbx[c1], cbx[c1 + 1] - cbx[c1], lt);
          d[4 * m + i] = (u16)lower_u16(cbx + 53 + cbx[c2], cbx[c2 + 1] - cbx[c2], lt);
          d[5 * m + i] = (u16)lower_u16(cbx + 53 + cbx[c1], cbx[c1 + 1] - cbx[c1], le);
          d[6 * m + i] = (u16)lower_u16(cbx + 53 + cbx[c2], cbx[c2 + 1] - cbx[c2], le);
        }
        bp += 7 * (size_t)m;
      }
    }
    GPUT(BDAT, BD, sizeof(u16) * (nbd + 1)); GPUT(CDAT, CD, sizeof(u16) * (ncd + 1));
    GPUT(BOFF, BO, sizeof(i32) * 2 * (size_t)g->nBoards); GPUT(BM, BMv, sizeof(i32) * 2 * (size_t)g->nBoards); GPUT(COFF, CO, sizeof(i32) * 2 * (size_t)g->nBoards);
  }
  {
    size_t np = 0;
    for (int si = 1; si < 24; si++) if (g->symOK[si]) np += (size_t)(g->N[0] + g->N[1]);
    phd = (i32 *)malloc(sizeof(i32) * (np + 1)); np = 0;
    for (int si = 0; si < 24; si++) for (int q = 0; q < 2; q++) {
      pho[si * 2 + q] = 0;
      if (!si || !g->symOK[si]) continue;
      pho[si * 2 + q] = (i32)np;
      for (int h = 0; h < g->N[q]; h++) phd[np++] = g->PH[si][q][h];
    }
    GPUT(PHD, phd, sizeof(i32) * (np + 1)); GPUT(PHO, pho, sizeof pho);
  }
  {
    const int n = g->cfg.icm ? g->cfg.icmN : 2;
    icmt = (f32 *)calloc((size_t)(5 + 2 * n), sizeof(f32));
    icmt[0] = (f32)g->cfg.icmX0; icmt[1] = g->cfg.icm ? (f32)g->cfg.icmDx : 1.f; icmt[2] = (f32)g->cfg.icmB0; icmt[3] = g->P0; icmt[4] = (f32)n;
    if (g->cfg.icm) for (int i = 0; i < n; i++) { icmt[5 + i] = g->cfg.icmU[0][i]; icmt[5 + n + i] = g->cfg.icmU[1][i]; }
    GPUT(ICMT, icmt, sizeof(f32) * (size_t)(5 + 2 * n));
  }
  {
    cum = (f32 *)malloc(sizeof(f32) * (size_t)g->cumCap);
    for (int i = 0; i < g->cumCap; i++) cum[i] = (f32)g->CUM[i];
    GPUT(CUM, cum, sizeof(f32) * (size_t)g->cumCap); gs->cumUp = g->cumCap;
  }
  {
    // tree arrays
    GPUT(TY, g->TY, (size_t)nn); GPUT(PL, g->PL, (size_t)nn);
    GPUT(NN, g->NN, sizeof(i32) * (size_t)nn); GPUT(CS, g->CS, sizeof(i32) * (size_t)nn); GPUT(CHN, g->CHN, sizeof(i32) * (size_t)g->nCh);
    GPUT(DO, gDO, sizeof(u32) * (size_t)nn); GPUT(NX, g->NX, sizeof(i32) * (size_t)nn);
    GPUT(NC0, g->NC0, sizeof(f32) * (size_t)nn); GPUT(NC1, g->NC1, sizeof(f32) * (size_t)nn);
    GPUT(SEND, SEND, sizeof(i32) * (size_t)nn); GPUT(RS[0], RS[0], sizeof(i32) * (size_t)nn); GPUT(RS[1], RS[1], sizeof(i32) * (size_t)nn);
    GPUT(LR, g->LR, sizeof(i32) * (size_t)nn); GPUT(LS, g->LS, sizeof(i32) * (size_t)nn);
    if (g->comp) { GPUT(RSC, g->RSC, sizeof(f32) * (size_t)nn); GPUT(SSC, g->SSC, sizeof(f32) * (size_t)nn); }
    else { GNEW(RSC, 4); GNEW(SSC, 4); }
    const int N0 = g->N[0], N1 = g->N[1];
    GPUT(HL1, hl1, (size_t)(N0 + N1)); GPUT(HL2, hl2, (size_t)(N0 + N1)); GPUT(HSAME, hsame, sizeof(i32) * (size_t)(N0 + N1));
    GPUT(HWOFF, hwoff, sizeof hwoff); GPUT(HWDAT, hwdat, sizeof(i32) * (size_t)(2 * (N0 + N1)));
    GPUT(SLOTS, SL, sizeof(i32) * 2 * (size_t)gs->nSlots); GPUT(ENT, ENT, sizeof(i32) * 5 * (size_t)gs->nEnt); GPUT(EQV, EP, sizeof(i32) * (size_t)(nPerm + 1));
  }
  // regrets and strategy sums of every river subtree, packed in entry order
  {
    const size_t n0 = (size_t)(gs->eSplit == gs->nEnt ? gs->gpuData : (i64)gs->spl), n1 = (size_t)(gs->gpuData - (i64)n0);
    GNEW(R0, n0 * (size_t)gs->eb); GNEW(S0, n0 * (size_t)gs->eb);
    if (n1) { GNEW(R1, n1 * (size_t)gs->eb); GNEW(S1, n1 * (size_t)gs->eb); }
    if (!gpu_move_all(g, 1)) { ok = 0; goto done; }
  }
  GNEW(REQ, sizeof(i32) * (size_t)gs->nSlots); GNEW(RO, sizeof(f32) * (size_t)gs->nSlots * g->maxN); GNEW(VOUT, sizeof(f32) * (size_t)gs->nSlots * g->maxN);
  GNEW(SCR, sizeof(f32) * (size_t)gs->groups * gs->maxSub * g->maxN * 2); GNEW(SCRI, sizeof(i32) * (size_t)gs->groups * gs->maxSub); GNEW(CTR, 64);
  gs->hRO = (f32 *)gpu_host_alloc(sizeof(f32) * (size_t)gs->nSlots * g->maxN, &gs->pinRO);
  gs->hVOUT = (f32 *)gpu_host_alloc(sizeof(f32) * (size_t)gs->nSlots * g->maxN, &gs->pinVOUT);
  gs->reqSlot = (i32 *)malloc(sizeof(i32) * (size_t)gs->nSlots); gs->cidx = (i32 *)malloc(sizeof(i32) * (size_t)gs->nSlots);
  if (!gs->hRO || !gs->hVOUT || !gs->reqSlot || !gs->cidx) { snprintf(why, sizeof why, "out of memory"); ok = 0; goto done; }
  gs->chunk = gs->groups * 8 > 256 ? gs->groups * 8 : 256;
done:
  free(SEND); free(RS[0]); free(RS[1]); free(gDO); free(SL); free(ENT); free(EP); free(BD); free(CD); free(BO); free(BMv); free(CO);
  free(hl1); free(hl2); free(hsame); free(hwdat); free(phd); free(icmt); free(cum);
  if (!ok) {
    if (!why[0]) snprintf(why, sizeof why, "%s", gpu_error()[0] ? gpu_error() : "GPU setup failed");
    gpu_teardown(g);
    snprintf(g->gpuWhy, sizeof g->gpuWhy, "%s", why);
    return 0;
  }
  snprintf(g->gpuWhy, sizeof g->gpuWhy, "river on the GPU: %d requests, %d subgames, %.0f MB%s%s", gs->nSlots, gs->nEnt, gs->mb, g->comp ? ", 16-bit" : "", gs->eSplit < gs->nEnt ? " (2 buffers)" : "");
  return 1;
}
#undef GPUT
#undef GNEW
// GPU active for this game (sets it up on first use); 0 = use the CPU engine
static int gpu_use(Game *g) {
  if (g->gs) {
    if (gpu_eligible(g)) return 1;
    gpu_sync(g); gpu_teardown(g); return 0;
  }
  if (!gpu_eligible(g)) return 0;
  if (gpu_setup(g)) return 1;
  // a setup failure won't fix itself during this solve: report it once and stay on the CPU
  g->gpuFailed = 1;
  fprintf(stderr, "  GPU not used: %s\n", g->gpuWhy);
  return 0;
}
static void gpu_io(Game *g, int node, int p, const f32 *ro, f32 *out) {
  GpuState *gs = g->gs; const int slot = gs->slotOf[node];
  if (g->phase == 1) {
    const int r = __atomic_fetch_add(&gs->nAct, 1, __ATOMIC_RELAXED), nO = g->N[1 - p];
    gs->reqSlot[r] = slot; gs->cidx[slot] = r;
    memcpy(gs->hRO + (size_t)r * nO, ro, sizeof(f32) * (size_t)nO);
  } else {
    const int r = gs->cidx[slot], nP = g->N[p];
    if (r < 0) { __atomic_fetch_add(&gs->missing, 1, __ATOMIC_RELAXED); memset(out, 0, sizeof(f32) * (size_t)nP); return; }
    memcpy(out, gs->hVOUT + (size_t)r * nP, sizeof(f32) * (size_t)nP);
  }
}
static char PASS_ERR[512];
// one traverser pass with the river on the GPU; mode 0 = CFR update, 1 = average-strategy values, 2 = best response
static int gpu_pass(Game *g, Ctx *c, int p, const f32 *ro, f32 *out, int mode) {
  GpuState *gs = g->gs;
  const double t0 = now_sec();
  gs->nAct = 0; gs->missing = 0;
  for (int i = 0; i < gs->nSlots; i++) gs->cidx[i] = -1;
  g->phase = 1;
  if (mode == 0) cfr(g, c, 0, p, ro, out, 0); else evalT(g, c, 0, p, ro, out, 0, mode == 2);
  g->phase = 0;
  const int n = gs->nAct, NP = g->N[p], NO = g->N[1 - p];
  double tg = now_sec();
  int ok = 1;
  if (mode == 0 && gs->cumUp < g->cumCap) {
    f32 *cum = (f32 *)malloc(sizeof(f32) * (size_t)g->cumCap);
    for (int i = 0; i < g->cumCap; i++) cum[i] = (f32)g->CUM[i];
    gpu_free(gs->CUM); gs->CUM = gpu_alloc(sizeof(f32) * (size_t)g->cumCap);
    ok = gs->CUM && gpu_write(gs->CUM, 0, cum, sizeof(f32) * (size_t)g->cumCap);
    free(cum); gs->cumUp = g->cumCap;
  }
  if (ok && n > 0) {
    ok = gpu_write(gs->REQ, 0, gs->reqSlot, sizeof(i32) * (size_t)n) && gpu_write(gs->RO, 0, gs->hRO, sizeof(f32) * (size_t)n * NO);
    GRiver a; memset(&a, 0, sizeof a);
    a.TY = gs->TY; a.PL = gs->PL; a.NN = gs->NN; a.CS = gs->CS; a.CHN = gs->CHN; a.DO = gs->DO; a.NX = gs->NX; a.NC0 = gs->NC0; a.NC1 = gs->NC1;
    a.SEND = gs->SEND; a.RS = gs->RS[p]; a.R0 = gs->R0; a.S0 = gs->S0; a.R1 = gs->R1 ? gs->R1 : gs->R0; a.S1 = gs->S1 ? gs->S1 : gs->S0; a.LR = gs->LR; a.LS = gs->LS; a.spl = gs->spl;
    a.RSC = gs->RSC; a.SSC = gs->SSC; a.comp = g->comp;
    a.HL1 = gs->HL1; a.HL2 = gs->HL2; a.HSAME = gs->HSAME; a.HWOFF = gs->HWOFF; a.HWDAT = gs->HWDAT;
    a.BDAT = gs->BDAT; a.BOFF = gs->BOFF; a.BM = gs->BM; a.CDAT = gs->CDAT; a.COFF = gs->COFF;
    a.SLOTS = gs->SLOTS; a.ENT = gs->ENT; a.EQV = gs->EQV; a.PHD = gs->PHD; a.PHO = gs->PHO;
    a.REQ = gs->REQ; a.RO = gs->RO; a.VOUT = gs->VOUT; a.SCR = gs->SCR; a.SCRI = gs->SCRI; a.CTR = gs->CTR; a.CUM = gs->CUM; a.ICMT = gs->ICMT;
    a.p = p; a.mode = mode; a.t = g->t; a.icm = g->cfg.icm; a.maxSub = gs->maxSub; a.maxN = g->maxN; a.NP = NP; a.NO = NO; a.hoffP = p ? g->N[0] : 0;
    a.gamma = (float)g->cfg.gamma; a.P0H = g->P0H; a.w = 1.f / 44.f; a.groups = gs->groups;
    // launch in slices short enough to stay clear of the Windows GPU watchdog
    for (int r0 = 0; ok && r0 < n; ) {
      int r1 = r0 + gs->chunk; if (r1 > n) r1 = n;
      a.r0 = r0; a.r1 = r1;
      const double k0 = now_sec();
      ok = gpu_river(&a);
      const double dt = now_sec() - k0;
      gs->launches++;
      if (ok && r1 - r0 >= gs->groups && dt > 0) {
        double want = (double)(r1 - r0) * 0.15 / dt;
        if (want > gs->chunk * 2.0) want = gs->chunk * 2.0;
        if (want < gs->groups) want = gs->groups;
        gs->chunk = (int)want;
      }
      r0 = r1;
    }
    ok = ok && gpu_read(gs->VOUT, 0, gs->hVOUT, sizeof(f32) * (size_t)n * NP);
  }
  const double tg1 = now_sec();
  if (!ok) { snprintf(PASS_ERR, sizeof PASS_ERR, "%s", gpu_error()); return 0; }
  g->phase = 2;
  if (mode == 0) cfr(g, c, 0, p, ro, out, 0); else evalT(g, c, 0, p, ro, out, 0, mode == 2);
  g->phase = 0;
  if (gs->missing) { snprintf(PASS_ERR, sizeof PASS_ERR, "request bookkeeping mismatch"); return 0; }
  if (mode == 0) gs->dirty = 1;
  gs->secGpu += tg1 - tg; gs->secAll += now_sec() - t0;
  return 1;
}
static void s_gpu_info(Game *g, JB *o) {
  jb_printf(o, "{\"available\":%s,\"device\":", gpu_ready() ? "true" : "false"); jb_str(o, gpu_desc());
  if (gpu_ready()) { jb_puts(o, ",\"memMB\":"); jb_num(o, gpu_mem_mb(), 0); jb_puts(o, ",\"budgetMB\":"); jb_num(o, gpu_mem_mb() * 0.85, 0); }
  jb_printf(o, ",\"on\":%s,\"why\":", g && g->gs ? "true" : "false"); jb_str(o, g ? g->gpuWhy : "");
  if (g && g->gs) { jb_puts(o, ",\"gpuShare\":"); jb_num(o, g->gs->secAll > 0 ? g->gs->secGpu / g->gs->secAll : 0, 3); jb_puts(o, ",\"mb\":"); jb_num(o, g->gs->mb, 0); }
  jb_putc(o, '}');
}

static void debug_dump(Game *g) {
  // test hook: EIGHTMAX_DUMP=prefix writes regrets, strategy sums and visit times after every iteration
  static const char *pre = (const char *)1;
  if (pre == (const char *)1) pre = getenv("EIGHTMAX_DUMP");
  if (!pre || g->comp) return;
  if (g->gs) gpu_sync(g);
  char fn[512]; snprintf(fn, sizeof fn, "%s.%d", pre, g->t);
  FILE *f = fopen(fn, "wb"); if (!f) return;
  i32 hd[3] = { g->nNodes, (i32)g->dataSize, g->t }; fwrite(hd, 4, 3, f);
  fwrite(g->TY, 1, (size_t)g->nNodes, f); fwrite(g->ST, 1, (size_t)g->nNodes, f); fwrite(g->PL, 1, (size_t)g->nNodes, f);
  fwrite(g->DO, 8, (size_t)g->nNodes, f); fwrite(g->NN, 4, (size_t)g->nNodes, f); fwrite(g->LR, 4, (size_t)g->nNodes, f); fwrite(g->LS, 4, (size_t)g->nNodes, f);
  fwrite(g->R32, 4, (size_t)g->dataSize, f); fwrite(g->S32, 4, (size_t)g->dataSize, f);
  fclose(f);
}
static void s_iterate(Game *g) {
  if (g->viewOnly) return;
  g->t++;
  cum_grow(g, g->t + 2);
  Ctx *c = POOL.ctx[0];
  gpu_use(g);
  for (int p = 0; p < 2; p++) {
    f32 *out = p ? g->OUT1 : g->OUT0;
    if (g->gs && gpu_pass(g, c, p, g->W[1 - p], out, 0)) continue;
    if (g->gs) gpu_fallback(g, PASS_ERR);
    cfr(g, c, 0, p, g->W[1 - p], out, 0);
  }
  debug_dump(g);
}
// root values for traverser p against the average strategy (br = best response)
static f64 evalRoot(Game *g, Ctx *c, int p, int br) {
  f32 *out = p ? g->OUT1 : g->OUT0;
  static int evalCpu = -1;   // test hook: EIGHTMAX_EVAL_CPU=1 scores a GPU-trained tree with the CPU evaluator
  if (evalCpu < 0) evalCpu = getenv("EIGHTMAX_EVAL_CPU") != NULL;
  if (evalCpu && g->gs) { gpu_sync(g); evalT(g, c, 0, p, g->W[1 - p], out, 0, br); }
  else if (!(g->gs && gpu_pass(g, c, p, g->W[1 - p], out, br ? 2 : 1))) {
    if (g->gs) gpu_fallback(g, PASS_ERR);
    evalT(g, c, 0, p, g->W[1 - p], out, 0, br);
  }
  f64 v = 0; for (int h = 0; h < g->N[p]; h++) v += (f64)g->W[p][h] * out[h];
  return v;
}
static void s_exploit(Game *g, double *pct, double *chips) {
  Ctx *c = POOL.ctx[0];
  if (!g->viewOnly) gpu_use(g);
  const f64 b0 = evalRoot(g, c, 0, 1), b1 = evalRoot(g, c, 1, 1);
  if (g->cfg.icm) {
    // general-sum: each player's gain from best-responding, in tournament equity; % of what the starting pot is worth
    const f64 v0 = evalRoot(g, c, 0, 0), v1 = evalRoot(g, c, 1, 0);
    const f64 e = ((b0 - v0) + (b1 - v1)) / 2 / g->Z;
    f64 scale = (f64)icmU(g, 0, g->cfg.icmB0 + g->P0) - (f64)icmU(g, 0, g->cfg.icmB0); if (!(scale > 1e-9)) scale = 1e-9;
    if (chips) *chips = e;
    if (pct) *pct = e / scale * 100;
    return;
  }
  f64 e = (b0 + b1) / 2 / g->Z;
  if (chips) *chips = e;
  if (pct) *pct = e / g->P0 * 100;
}
static int s_iterations(Game *g) { return g->t; }
static void s_reset(Game *g) {
  size_t n = (size_t)g->dataSize;
  gpu_teardown(g); g->gpuFailed = 0;
  if (!g->allocated) return;
  if (g->comp) { if (g->R16) memset(g->R16, 0, n * 2); memset(g->S16, 0, n * 2); }
  else { if (g->R32) memset(g->R32, 0, n * 4); memset(g->S32, 0, n * 4); }
  for (int i = 0; i < g->nNodes; i++) { g->RSC[i] = 1; g->SSC[i] = 1; g->LR[i] = 0; g->LS[i] = 0; }
  g->t = 0; g->viewOnly = 0;
}

/* ---------------- node info ---------------- */
static void fmtAmt(char *b, size_t n, f32 x) { snprintf(b, n, "%.2f", (double)x); size_t k = strlen(b); while (k > 1 && b[k - 1] == '0') b[--k] = 0; if (k && b[k - 1] == '.') b[--k] = 0; }
static void actLabel(char *b, size_t n, int kind, f32 amt, f32 toCall) {
  char a[32];
  switch (kind) {
    case A_FOLD: snprintf(b, n, "Fold"); break;
    case A_CHECK: snprintf(b, n, "Check"); break;
    case A_CALL: fmtAmt(a, sizeof a, toCall); snprintf(b, n, "Call %s", a); break;
    case A_BET: fmtAmt(a, sizeof a, amt); snprintf(b, n, "Bet %s", a); break;
    case A_RAISE: fmtAmt(a, sizeof a, amt); snprintf(b, n, "Raise %s", a); break;
    default: fmtAmt(a, sizeof a, amt); snprintf(b, n, "All-in %s", a); break;
  }
}
// walk a path; entries are action indices at player nodes and card ids at chance nodes
// tau maps suits of the stored (canonical) subtree to the suits the user picked; dealt holds canonical cards, udealt the user's
static int walk(Game *g, const int *path, int np, int *nodeOut, f32 *r0, f32 *r1, int *dealt, int *nd, JB *line, char *err, int errlen, u8 *tau, int *udealt) {
  int node = 0; *nd = 0; g->walkShared = 0;
  for (int x = 0; x < 4; x++) tau[x] = (u8)x;
  memcpy(r0, g->W[0], sizeof(f32) * (size_t)g->N[0]); memcpy(r1, g->W[1], sizeof(f32) * (size_t)g->N[1]);
  f32 *r[2] = { r0, r1 };
  Ctx *c = POOL.ctx[0];
  f32 *tmp = (f32 *)malloc(sizeof(f32) * (size_t)(g->maxA * g->maxN));
  if (line) jb_putc(line, '[');
  for (int i = 0; i < np; i++) {
    const int k = path[i], ty = g->TY[node];
    if (line && i) jb_putc(line, ',');
    if (ty == T_PLAYER) {
      const int q = g->PL[node], nq = g->N[q], nA = g->NN[node];
      if (k < 0 || k >= nA) { snprintf(err, (size_t)errlen, "Bad action in path"); free(tmp); return 0; }
      if (g->allocated) { avgStrat(g, c, node, tmp); for (int h = 0; h < nq; h++) r[q][h] *= tmp[k * nq + h]; }
      if (line) { jb_printf(line, "{\"player\":%d,\"kind\":%d,\"street\":%d,\"amt\":", q, g->CHK[g->CS[node] + k], g->ST[node]); jb_num(line, g->CHA[g->CS[node] + k], 2); jb_puts(line, ",\"pot\":"); jb_num(line, g->P0 + g->NC0[node] + g->NC1[node], 2); jb_putc(line, '}'); }
      node = g->CHN[g->CS[node] + k];
    } else if (ty == T_CHANCE) {
      const int s = g->CS[node], nc = g->NN[node]; int idx = -1;
      u8 tinv[4]; for (int x = 0; x < 4; x++) tinv[tau[x]] = (u8)x;
      const int cc = (k >= 0 && k < 52) ? pcard(tinv, k) : -1;
      for (int j = 0; cc >= 0 && j < nc; j++) if (g->CHC[s + j] == cc) { idx = j; break; }
      if (idx < 0) { snprintf(err, (size_t)errlen, "Card not available"); free(tmp); return 0; }
      int can = cc;
      if (g->CHP[s + idx]) { const int si = g->CHP[s + idx]; can = pcard(PINV[si], cc); u8 nt[4]; for (int x = 0; x < 4; x++) nt[x] = tau[PERM[si][x]]; memcpy(tau, nt, 4); }
      for (int p = 0; p < 2; p++) for (int q = g->WOFF[p][can]; q < g->WOFF[p][can + 1]; q++) r[p][g->WDAT[p][q]] = 0.f;
      for (int j = 0; j < nc; j++) if (j != idx && g->CHN[s + j] == g->CHN[s + idx]) { g->walkShared = 1; break; }
      udealt[*nd] = k; dealt[(*nd)++] = can;
      if (line) jb_printf(line, "{\"card\":%d,\"street\":%d}", k, g->ST[node] + 1);
      node = g->CHN[s + idx];
    } else { snprintf(err, (size_t)errlen, "Path goes past the end of the hand"); free(tmp); return 0; }
  }
  if (line) jb_putc(line, ']');
  free(tmp);
  *nodeOut = node;
  return 1;
}
static void equityInto(Game *g, const int *dealt, int nd, f32 *const r[2], f32 *eq0, f32 *eq1) {
  int known = g->nb + nd;
  int *ids = (int *)malloc(sizeof(int) * (size_t)(g->nBoards ? g->nBoards : 1)); int nids = 0;
  if (known == 5) ids[nids++] = boardIdOf(g, dealt, nd);
  else if (known == 4) {
    if (g->nb == 4) for (int i = 0; i < g->nBoards; i++) ids[nids++] = i;
    else { int t = dealt[0]; for (int i = 0; i < g->nRest; i++) if (g->rest[i] != t) ids[nids++] = g->boardIdx[t * 52 + g->rest[i]]; }
  } else for (int i = 0; i < g->nBoards; i++) ids[nids++] = i;
  for (int p = 0; p < 2; p++) {
    const int o = 1 - p, nP = g->N[p];
    const f32 *ro = r[o];
    f64 *W = (f64 *)calloc((size_t)nP, sizeof(f64)), *Lo = (f64 *)calloc((size_t)nP, sizeof(f64)), *Cm = (f64 *)calloc((size_t)nP, sizeof(f64));
    const u8 *c1P = g->L1[p], *c2P = g->L2[p], *c1O = g->L1[o], *c2O = g->L2[o];
    for (int bi = 0; bi < nids; bi++) {
      const Board *B = &g->boards[ids[bi]];
      const u16 *ordP = B->ord[p], *ordO = B->ord[o], *lt = B->lt[p], *le = B->le[p];
      const int mP = B->m[p], mO = B->m[o];
      f64 cs[52]; memset(cs, 0, sizeof cs); f64 tot = 0;
      for (int j = 0; j < mO; j++) { int c = ordO[j]; f64 v = ro[c]; if (v != 0) { tot += v; cs[c1O[c]] += v; cs[c2O[c]] += v; } }
      for (int i = 0; i < mP; i++) { int h = ordP[i], k = g->SAME[p][h]; Cm[h] += tot - cs[c1P[h]] - cs[c2P[h]] + (k >= 0 ? ro[k] : 0); }
      memset(cs, 0, sizeof cs); tot = 0; int j = 0;
      for (int i = 0; i < mP; i++) { while (j < lt[i]) { int c = ordO[j++]; f64 v = ro[c]; if (v != 0) { tot += v; cs[c1O[c]] += v; cs[c2O[c]] += v; } } int h = ordP[i]; W[h] += tot - cs[c1P[h]] - cs[c2P[h]]; }
      memset(cs, 0, sizeof cs); tot = 0; j = mO - 1;
      for (int i = mP - 1; i >= 0; i--) { while (j >= le[i]) { int c = ordO[j--]; f64 v = ro[c]; if (v != 0) { tot += v; cs[c1O[c]] += v; cs[c2O[c]] += v; } } int h = ordP[i]; Lo[h] += tot - cs[c1P[h]] - cs[c2P[h]]; }
    }
    f32 *eq = p ? eq1 : eq0;
    for (int h = 0; h < nP; h++) eq[h] = Cm[h] > 1e-12 ? (f32)((W[h] + 0.5 * (Cm[h] - W[h] - Lo[h])) / Cm[h]) : -1.f;
    free(W); free(Lo); free(Cm);
  }
  free(ids);
}
static void farr_m(JB *o, const f32 *a, int n, int dig, const int *mp) {
  if (!mp) { jb_farr(o, a, n, dig); return; }
  jb_putc(o, '['); for (int i = 0; i < n; i++) { if (i) jb_putc(o, ','); jb_num(o, a[mp[i]], dig); } jb_putc(o, ']');
}
static void putEq(JB *o, const f32 *a, int n, const int *mp) {
  jb_putc(o, '[');
  for (int i = 0; i < n; i++) { const f32 v = a[mp ? mp[i] : i]; if (i) jb_putc(o, ','); if (v < 0) jb_puts(o, "null"); else jb_num(o, v, 4); }
  jb_putc(o, ']');
}
// full=1: per-combo arrays (UI); full=0: range-weighted summary only (reports)
static int s_node_info(Game *g, const int *path, int np, int full, JB *o, char *err, int errlen) {
  if (!g->allocated) { snprintf(err, (size_t)errlen, "Not solved yet"); return 0; }
  if (g->gs && !gpu_sync(g)) gpu_fallback(g, gpu_error());
  const int N = g->maxN;
  f32 *r0 = (f32 *)malloc(sizeof(f32) * (size_t)N), *r1 = (f32 *)malloc(sizeof(f32) * (size_t)N);
  int dealt[2], udealt[2], nd = 0, node = 0; u8 tau[4];
  JB line; jb_init(&line);
  if (!walk(g, path, np, &node, r0, r1, dealt, &nd, &line, err, errlen, tau, udealt)) { free(r0); free(r1); jb_free(&line); return 0; }
  // per-hand arrays are computed in the stored suits; mp maps each of the user's hands to its stored twin
  int *mp[2] = { NULL, NULL };
  if (tau[0] != 0 || tau[1] != 1 || tau[2] != 2 || tau[3] != 3) {
    u8 tinv[4]; for (int x = 0; x < 4; x++) tinv[tau[x]] = (u8)x;
    for (int p = 0; p < 2; p++) {
      mp[p] = (int *)malloc(sizeof(int) * (size_t)g->N[p]);
      for (int h = 0; h < g->N[p]; h++) { const int gi = g->G[p][h]; mp[p][h] = g->G2L[p][PIDX52[pcard(tinv, CC1[gi]) * 52 + pcard(tinv, CC2[gi])]]; }
    }
  }
  f32 *r[2] = { r0, r1 };
  Ctx *c = POOL.ctx[0];
  const int ty = g->TY[node];
  const f32 pot = g->P0 + g->NC0[node] + g->NC1[node];
  jb_printf(o, "{\"type\":\"%s\",\"street\":%d,\"pot\":", TYPE_NAMES[ty], g->ST[node]); jb_num(o, pot, 3);
  jb_puts(o, ",\"c\":["); jb_num(o, g->NC0[node], 3); jb_putc(o, ','); jb_num(o, g->NC1[node], 3);
  jb_puts(o, "],\"stack\":["); jb_num(o, g->S - g->NC0[node], 3); jb_putc(o, ','); jb_num(o, g->S - g->NC1[node], 3);
  jb_puts(o, "],\"board\":[");
  for (int i = 0; i < g->nb; i++) { if (i) jb_putc(o, ','); jb_printf(o, "%d", g->cfg.board[i]); }
  for (int i = 0; i < nd; i++) jb_printf(o, ",%d", udealt[i]);
  jb_puts(o, "],\"line\":"); jb_puts(o, line.s); jb_free(&line);
  f32 *eq0 = NULL, *eq1 = NULL;
  if (ty == T_PLAYER || ty == T_CHANCE) {
    eq0 = (f32 *)malloc(sizeof(f32) * (size_t)N); eq1 = (f32 *)malloc(sizeof(f32) * (size_t)N);
    equityInto(g, dealt, nd, r, eq0, eq1);
  }
  if (full) { jb_puts(o, ",\"reach\":["); farr_m(o, r0, g->N[0], 5, mp[0]); jb_putc(o, ','); farr_m(o, r1, g->N[1], 5, mp[1]); jb_putc(o, ']'); }
  if (ty == T_PLAYER) {
    const int q = g->PL[node], ox = 1 - q, nA = g->NN[node], s0 = g->CS[node], nq = g->N[q];
    const f32 cq = q == 0 ? g->NC0[node] : g->NC1[node], co = q == 0 ? g->NC1[node] : g->NC0[node], toCall = co - cq;
    jb_printf(o, ",\"player\":%d,\"locked\":%s,\"icm\":%s,\"toCall\":", q, g->LOCK[node] ? "true" : "false", g->cfg.icm ? "true" : "false"); jb_num(o, toCall, 3);
    jb_puts(o, ",\"actions\":[");
    for (int a = 0; a < nA; a++) {
      const int kind = g->CHK[s0 + a], ch = g->CHN[s0 + a]; const f32 amt = g->CHA[s0 + a];
      char lab[64]; actLabel(lab, sizeof lab, kind, amt, toCall);
      if (a) jb_putc(o, ',');
      jb_printf(o, "{\"kind\":%d,\"amt\":", kind); jb_num(o, amt, 3); jb_puts(o, ",\"label\":"); jb_str(o, lab);
      if (kind >= A_BET) {
        const f32 mine = cq - g->BASE[node], theirs = co - g->BASE[node];
        const f32 pct = toCall > 1e-6f ? (amt - theirs) / (pot + toCall) * 100.f : (amt - mine) / pot * 100.f;
        jb_printf(o, ",\"pctPot\":%d", (int)(pct + 0.5f));
        // facing a bet: the raise as a multiple of it (3x = raise to three times the bet)
        if (toCall > 1e-6f && theirs > 1e-6f) { jb_puts(o, ",\"xBet\":"); jb_num(o, amt / theirs, 1); }
      } else jb_puts(o, ",\"pctPot\":null");
      jb_printf(o, ",\"childType\":\"%s\"}", TYPE_NAMES[g->TY[ch]]);
    }
    jb_putc(o, ']');
    f32 *st = (f32 *)malloc(sizeof(f32) * (size_t)(nA * nq));
    avgStrat(g, c, node, st);
    // EVs per action for the acting player, and the opponent's EV at this node
    f32 *cm = (f32 *)malloc(sizeof(f32) * (size_t)N), *buf = (f32 *)malloc(sizeof(f32) * (size_t)N), *ev = (f32 *)calloc((size_t)N, sizeof(f32));
    f32 *evA = (f32 *)malloc(sizeof(f32) * (size_t)(nA * nq));
    foldTerm(g, q, r[ox], cm, 1.f);
    for (int a = 0; a < nA; a++) {
      evalT(g, c, g->CHN[s0 + a], q, r[ox], buf, 0, 0);
      const f32 base = g->cfg.icm ? -icmFold(g, q, g->NC0[node], g->NC1[node]) : g->P0H + cq;
      for (int h = 0; h < nq; h++) evA[a * nq + h] = cm[h] > 1e-9f ? buf[h] / cm[h] + base : -1e30f;
    }
    for (int h = 0; h < nq; h++) { f32 v = 0; for (int a = 0; a < nA; a++) v += st[a * nq + h] * evA[a * nq + h]; ev[h] = cm[h] > 1e-9f ? v : -1e30f; }
    f32 *cmo = (f32 *)malloc(sizeof(f32) * (size_t)N), *evo = (f32 *)malloc(sizeof(f32) * (size_t)N);
    foldTerm(g, ox, r[q], cmo, 1.f);
    evalT(g, c, node, ox, r[q], buf, 0, 0);
    const f32 baseO = g->cfg.icm ? -icmFold(g, ox, g->NC0[node], g->NC1[node]) : g->P0H + co;
    for (int h = 0; h < g->N[ox]; h++) evo[h] = cmo[h] > 1e-9f ? buf[h] / cmo[h] + baseO : -1e30f;
    if (full) {
      jb_puts(o, ",\"strategy\":");
      if (!mp[q]) jb_farr(o, st, nA * nq, 4);
      else { jb_putc(o, '['); for (int a = 0; a < nA; a++) for (int h = 0; h < nq; h++) { if (a || h) jb_putc(o, ','); jb_num(o, st[a * nq + mp[q][h]], 4); } jb_putc(o, ']'); }
      jb_puts(o, ",\"evActions\":[");
      for (int a = 0; a < nA; a++) { if (a) jb_putc(o, ','); jb_putc(o, '['); for (int h = 0; h < nq; h++) { if (h) jb_putc(o, ','); f32 v = evA[a * nq + (mp[q] ? mp[q][h] : h)]; if (v < -1e29f) jb_puts(o, "null"); else jb_num(o, v, 3); } jb_putc(o, ']'); }
      jb_puts(o, "],\"ev\":[");
      for (int pp = 0; pp < 2; pp++) {
        const f32 *e = pp == q ? ev : evo; const int n = g->N[pp];
        if (pp) jb_putc(o, ',');
        jb_putc(o, '['); for (int h = 0; h < n; h++) { if (h) jb_putc(o, ','); const f32 ev1 = e[mp[pp] ? mp[pp][h] : h]; if (ev1 < -1e29f) jb_puts(o, "null"); else jb_num(o, ev1, 3); } jb_putc(o, ']');
      }
      jb_putc(o, ']');
    } else {
      // range-weighted summary (weights: reach x compatible opponent mass)
      f64 wt = 0, evs = 0, eqs = 0, *fr = (f64 *)calloc((size_t)nA, sizeof(f64));
      const f32 *eqq = q == 0 ? eq0 : eq1;
      for (int h = 0; h < nq; h++) {
        f64 w = (f64)r[q][h] * cm[h]; if (w <= 0) continue;
        wt += w; evs += w * ev[h]; if (eqq[h] >= 0) eqs += w * eqq[h];
        for (int a = 0; a < nA; a++) fr[a] += w * st[a * nq + h];
      }
      jb_puts(o, ",\"freq\":[");
      for (int a = 0; a < nA; a++) { if (a) jb_putc(o, ','); jb_num(o, wt > 0 ? fr[a] / wt : 0, 5); }
      jb_puts(o, "],\"evAvg\":"); jb_num(o, wt > 0 ? evs / wt : 0, 4); jb_puts(o, ",\"eqAvg\":"); jb_num(o, wt > 0 ? eqs / wt : 0, 5);
      f64 wo = 0, evso = 0, eqso = 0; const f32 *eqo = ox == 0 ? eq0 : eq1;
      for (int h = 0; h < g->N[ox]; h++) { f64 w = (f64)r[ox][h] * cmo[h]; if (w <= 0) continue; wo += w; evso += w * evo[h]; if (eqo[h] >= 0) eqso += w * eqo[h]; }
      jb_puts(o, ",\"evOpp\":"); jb_num(o, wo > 0 ? evso / wo : 0, 4); jb_puts(o, ",\"eqOpp\":"); jb_num(o, wo > 0 ? eqso / wo : 0, 5);
      free(fr);
    }
    free(st); free(cm); free(buf); free(ev); free(evA); free(cmo); free(evo);
  } else if (ty == T_CHANCE) {
    jb_puts(o, ",\"cards\":[");
    for (int i = 0; i < g->NN[node]; i++) { if (i) jb_putc(o, ','); jb_printf(o, "%d", pcard(tau, g->CHC[g->CS[node] + i])); }
    jb_putc(o, ']');
  }
  if (eq0 && full) { jb_puts(o, ",\"equity\":["); putEq(o, eq0, g->N[0], mp[0]); jb_putc(o, ','); putEq(o, eq1, g->N[1], mp[1]); jb_putc(o, ']'); }
  jb_putc(o, '}');
  free(eq0); free(eq1); free(r0); free(r1); free(mp[0]); free(mp[1]);
  return 1;
}

/* ---------------- runout reports ---------------- */
// for every card at a chance node: the first decision's action mix, both players' EV and equity (range averages,
// weighted by reach x compatible opponent mass). Suit-equivalent cards share a subtree and are computed once.
static int s_runouts(Game *g, const int *path, int np, JB *o, char *err, int errlen) {
  if (!g->allocated) { snprintf(err, (size_t)errlen, "Not solved yet"); return 0; }
  if (g->gs && !gpu_sync(g)) gpu_fallback(g, gpu_error());
  const int N = g->maxN;
  f32 *r0 = (f32 *)malloc(sizeof(f32) * (size_t)N), *r1 = (f32 *)malloc(sizeof(f32) * (size_t)N);
  int dealt[2], udealt[2], nd = 0, node = 0; u8 tau[4];
  if (!walk(g, path, np, &node, r0, r1, dealt, &nd, NULL, err, errlen, tau, udealt)) { free(r0); free(r1); return 0; }
  free(r0); free(r1);
  if (g->TY[node] != T_CHANCE) { snprintf(err, (size_t)errlen, "Runout reports start at a turn or river card"); return 0; }
  const int s = g->CS[node], nc = g->NN[node];
  int *p2 = (int *)malloc(sizeof(int) * (size_t)(np + 1));
  if (np) memcpy(p2, path, sizeof(int) * (size_t)np);
  f32 *q0 = (f32 *)malloc(sizeof(f32) * (size_t)N), *q1 = (f32 *)malloc(sizeof(f32) * (size_t)N), *r[2] = { q0, q1 };
  f32 *cm = (f32 *)malloc(sizeof(f32) * (size_t)N), *buf = (f32 *)malloc(sizeof(f32) * (size_t)N), *st = (f32 *)malloc(sizeof(f32) * (size_t)(g->maxA * N));
  f32 *eq[2] = { (f32 *)malloc(sizeof(f32) * (size_t)N), (f32 *)malloc(sizeof(f32) * (size_t)N) };
  char **memo = (char **)calloc((size_t)nc, sizeof(char *));
  Ctx *c = POOL.ctx[0];
  int ok = 1;
  jb_putc(o, '[');
  for (int k = 0; k < nc && ok; k++) {
    int kc = k;
    if (g->CHP[s + k]) for (int j = 0; j < nc; j++) if (!g->CHP[s + j] && g->CHN[s + j] == g->CHN[s + k]) { kc = j; break; }
    if (!memo[kc]) {
      int ch = 0, d2[2], ud2[2], nd2 = 0; u8 t2[4];
      p2[np] = pcard(tau, g->CHC[s + kc]);
      if (!walk(g, p2, np + 1, &ch, q0, q1, d2, &nd2, NULL, err, errlen, t2, ud2)) { ok = 0; break; }
      JB t; jb_init(&t);
      if (g->TY[ch] != T_PLAYER) jb_puts(&t, "null");
      else {
        const int q = g->PL[ch], ox = 1 - q, nA = g->NN[ch], s0 = g->CS[ch], nq = g->N[q];
        const f32 cq = q == 0 ? g->NC0[ch] : g->NC1[ch], co = q == 0 ? g->NC1[ch] : g->NC0[ch];
        avgStrat(g, c, ch, st);
        equityInto(g, d2, nd2, r, eq[0], eq[1]);
        f64 res[2][3];   // per player: weight, EV sum, equity sum
        f64 *fr = (f64 *)calloc((size_t)nA, sizeof(f64));
        for (int pp = 0; pp < 2; pp++) {
          const int pq = pp ? ox : q; const f32 cc = pp ? co : cq;
          foldTerm(g, pq, r[1 - pq], cm, 1.f);
          evalT(g, c, ch, pq, r[1 - pq], buf, 0, 0);
          const f32 base = g->cfg.icm ? -icmFold(g, pq, g->NC0[ch], g->NC1[ch]) : g->P0H + cc;
          f64 w = 0, ev = 0, eqs = 0;
          for (int h = 0; h < g->N[pq]; h++) {
            const f64 wh = (f64)r[pq][h] * cm[h]; if (!(wh > 0)) continue;
            w += wh; ev += (f64)r[pq][h] * (buf[h] + base * cm[h]); if (eq[pq][h] >= 0) eqs += wh * eq[pq][h];
            if (!pp) for (int a = 0; a < nA; a++) fr[a] += wh * st[a * nq + h];
          }
          res[pp][0] = w; res[pp][1] = ev; res[pp][2] = eqs;
        }
        jb_printf(&t, "{\"player\":%d,\"pot\":", q); jb_num(&t, g->P0 + g->NC0[ch] + g->NC1[ch], 3); jb_puts(&t, ",\"actions\":[");
        for (int a = 0; a < nA; a++) {
          char lab[64]; actLabel(lab, sizeof lab, g->CHK[s0 + a], g->CHA[s0 + a], co - cq);
          if (a) jb_putc(&t, ',');
          jb_printf(&t, "{\"kind\":%d,\"label\":", g->CHK[s0 + a]); jb_str(&t, lab); jb_putc(&t, '}');
        }
        jb_puts(&t, "],\"freq\":[");
        for (int a = 0; a < nA; a++) { if (a) jb_putc(&t, ','); jb_num(&t, res[0][0] > 0 ? fr[a] / res[0][0] : 0, 5); }
        jb_puts(&t, "],\"evAvg\":"); jb_num(&t, res[0][0] > 0 ? res[0][1] / res[0][0] : 0, 4);
        jb_puts(&t, ",\"eqAvg\":"); jb_num(&t, res[0][0] > 0 ? res[0][2] / res[0][0] : 0, 5);
        jb_puts(&t, ",\"evOpp\":"); jb_num(&t, res[1][0] > 0 ? res[1][1] / res[1][0] : 0, 4);
        jb_puts(&t, ",\"eqOpp\":"); jb_num(&t, res[1][0] > 0 ? res[1][2] / res[1][0] : 0, 5);
        jb_putc(&t, '}');
        free(fr);
      }
      memo[kc] = t.s;
    }
    if (k) jb_putc(o, ',');
    jb_printf(o, "{\"card\":%d,\"info\":%s}", pcard(tau, g->CHC[s + k]), memo[kc]);
  }
  jb_putc(o, ']');
  for (int k = 0; k < nc; k++) free(memo[k]);
  free(memo); free(p2); free(q0); free(q1); free(cm); free(buf); free(st); free(eq[0]); free(eq[1]);
  return ok;
}

/* ---------------- locks ---------------- */
static int s_lock(Game *g, const int *path, int np, const float *strat, int n, char *err, int errlen) {
  const int N = g->maxN;
  if (g->gs && !gpu_sync(g)) gpu_fallback(g, gpu_error());
  f32 *r0 = (f32 *)malloc(sizeof(f32) * (size_t)N), *r1 = (f32 *)malloc(sizeof(f32) * (size_t)N);
  int dealt[2], udealt[2], nd = 0, node = 0; u8 tau[4];
  int ok = walk(g, path, np, &node, r0, r1, dealt, &nd, NULL, err, errlen, tau, udealt);
  free(r0); free(r1);
  if (!ok) return 0;
  if (g->TY[node] != T_PLAYER) { snprintf(err, (size_t)errlen, "Only decision points can be locked"); return 0; }
  // with suit isomorphism, a node after a turn or river card is shared with that card's suit twins:
  // a lock here would also apply to them, which changes a different spot than the one chosen
  if (strat && g->walkShared) { snprintf(err, (size_t)errlen, "This turn/river node is shared with suit-equivalent cards. Turn off suit isomorphism and rebuild to lock it."); return 0; }
  const int nA = g->NN[node], nq = g->N[g->PL[node]];
  if (!strat) { if (g->LOCK[node]) { free(g->LOCK[node]); g->LOCK[node] = NULL; g->nLocks--; if (g->ST[node] == 2) g->nRiverLocks--; } return 1; }
  if (n != nA * nq) { snprintf(err, (size_t)errlen, "Lock needs %d values, got %d", nA * nq, n); return 0; }
  f32 *L = (f32 *)malloc(sizeof(f32) * (size_t)n);
  const int q = g->PL[node];
  for (int h = 0; h < nq; h++) {
    // the lock arrives in the user's suits: read each stored hand from its twin
    const int gi = g->G[q][h], hu = g->G2L[q][PIDX52[pcard(tau, CC1[gi]) * 52 + pcard(tau, CC2[gi])]];
    f64 s = 0; for (int a = 0; a < nA; a++) { f32 v = strat[a * nq + (hu >= 0 ? hu : h)]; if (!(v > 0)) v = 0; L[a * nq + h] = v; s += v; }
    for (int a = 0; a < nA; a++) L[a * nq + h] = s > 0 ? (f32)(L[a * nq + h] / s) : 1.f / (f32)nA;
  }
  if (!g->LOCK[node]) { g->nLocks++; if (g->ST[node] == 2) g->nRiverLocks++; } else free(g->LOCK[node]);
  g->LOCK[node] = L;
  return 1;
}
static int s_nlocks(Game *g) { return g->nLocks; }

/* ---------------- save / load ---------------- */
static int s_save(Game *g, const char *file, const char *cfgJson, double ex, char *err, int errlen) {
  if (!g->allocated) { snprintf(err, (size_t)errlen, "Nothing to save yet"); return 0; }
  if (g->gs && !gpu_sync(g)) gpu_fallback(g, gpu_error());
  FILE *f = fopen(file, "wb");
  if (!f) { snprintf(err, (size_t)errlen, "Cannot write %s", file); return 0; }
  uint32_t L = (uint32_t)strlen(cfgJson);
  fwrite("EM8SOL2", 1, 8, f); fwrite(&L, 4, 1, f); fwrite(cfgJson, 1, L, f);
  i32 isoFlag = g->iso; fwrite(&isoFlag, 4, 1, f);
  i64 ds = g->dataSize; i32 nn = g->nNodes, t = g->t; fwrite(&ds, 8, 1, f); fwrite(&nn, 4, 1, f); fwrite(&t, 4, 1, f); fwrite(&ex, 8, 1, f);
  // average strategy as 16-bit with a per-node scale
  f32 *sc = (f32 *)malloc(sizeof(f32) * (size_t)nn);
  u16 *buf = (u16 *)malloc(sizeof(u16) * (size_t)(g->maxA * g->maxN));
  for (int i = 0; i < nn; i++) sc[i] = g->comp ? g->SSC[i] : 1.f;
  if (!g->comp) for (int i = 0; i < nn; i++) {
    if (g->TY[i] != T_PLAYER) continue;
    const i64 off = g->DO[i]; const int n = g->NN[i] * g->N[g->PL[i]]; f32 mx = 0;
    for (int k = 0; k < n; k++) if (g->S32[off + k] > mx) mx = g->S32[off + k];
    sc[i] = mx > 0 ? mx / 65535.f : 1.f;
  }
  fwrite(sc, 4, (size_t)nn, f);
  for (int i = 0; i < nn; i++) {
    if (g->TY[i] != T_PLAYER) continue;
    const i64 off = g->DO[i]; const int n = g->NN[i] * g->N[g->PL[i]];
    if (g->comp) fwrite(g->S16 + off, 2, (size_t)n, f);
    else { const f32 inv = 1.f / sc[i]; for (int k = 0; k < n; k++) buf[k] = (u16)(g->S32[off + k] * inv + 0.5f); fwrite(buf, 2, (size_t)n, f); }
  }
  uint32_t nl = (uint32_t)g->nLocks; fwrite(&nl, 4, 1, f);
  for (int i = 0; i < nn; i++) if (g->LOCK[i]) { i32 id = i, n = g->NN[i] * g->N[g->PL[i]]; fwrite(&id, 4, 1, f); fwrite(&n, 4, 1, f); fwrite(g->LOCK[i], 4, (size_t)n, f); }
  free(sc); free(buf);
  int bad = ferror(f); fclose(f);
  if (bad) { snprintf(err, (size_t)errlen, "Write failed (disk full?)"); return 0; }
  return 1;
}
static Game *s_load(const char *file, char **cfgJson, double *ex, char *err, int errlen) {
  FILE *f = fopen(file, "rb");
  if (!f) { snprintf(err, (size_t)errlen, "Cannot open %s", file); return NULL; }
  char magic[8]; uint32_t L = 0;
  if (fread(magic, 1, 8, f) != 8 || (memcmp(magic, "EM8SOL1", 8) && memcmp(magic, "EM8SOL2", 8)) || fread(&L, 4, 1, f) != 1 || L > 50000000) { fclose(f); snprintf(err, (size_t)errlen, "Not an EightMax solution file"); return NULL; }
  const int v2 = !memcmp(magic, "EM8SOL2", 8);
  char *js = (char *)malloc(L + 1);
  if (fread(js, 1, L, f) != L) { fclose(f); free(js); snprintf(err, (size_t)errlen, "File is truncated"); return NULL; }
  js[L] = 0;
  GameCfg cfg;
  if (!solver_parse_cfg(js, &cfg, err, errlen)) { fclose(f); free(js); return NULL; }
  cfg.compress = 1;
  { i32 isoFlag = 0; if (v2 && fread(&isoFlag, 4, 1, f) != 1) { fclose(f); free(js); snprintf(err, (size_t)errlen, "File is truncated"); return NULL; } cfg.iso = isoFlag; }
  Game *g = s_build(&cfg, err, errlen);
  if (!g) { fclose(f); free(js); return NULL; }
  i64 ds; i32 nn, t; double e;
  if (fread(&ds, 8, 1, f) != 1 || fread(&nn, 4, 1, f) != 1 || fread(&t, 4, 1, f) != 1 || fread(&e, 8, 1, f) != 1 || ds != g->dataSize || nn != g->nNodes) {
    fclose(f); free(js); game_free_impl(g); snprintf(err, (size_t)errlen, "Solution file does not match its tree"); return NULL;
  }
  g->comp = 1; g->allocated = 1; g->viewOnly = 1; g->t = t;
  g->S16 = (u16 *)calloc((size_t)(ds ? ds : 1), 2); g->SSC = (f32 *)malloc(sizeof(f32) * (size_t)nn); g->RSC = (f32 *)malloc(sizeof(f32) * (size_t)nn);
  g->LR = (i32 *)calloc((size_t)nn, sizeof(i32)); g->LS = (i32 *)calloc((size_t)nn, sizeof(i32));
  if (!g->S16 || !g->SSC || !g->RSC || !g->LR || !g->LS) { fclose(f); free(js); game_free_impl(g); snprintf(err, (size_t)errlen, "Not enough memory to load this solution"); return NULL; }
  for (int i = 0; i < nn; i++) g->RSC[i] = 1;
  int okr = fread(g->SSC, 4, (size_t)nn, f) == (size_t)nn;
  for (int i = 0; okr && i < nn; i++) {
    if (g->TY[i] != T_PLAYER) continue;
    const int n = g->NN[i] * g->N[g->PL[i]];
    if (fread(g->S16 + g->DO[i], 2, (size_t)n, f) != (size_t)n) okr = 0;
  }
  uint32_t nl = 0;
  if (okr && fread(&nl, 4, 1, f) == 1) {
    for (uint32_t k = 0; k < nl; k++) {
      i32 id, n;
      if (fread(&id, 4, 1, f) != 1 || fread(&n, 4, 1, f) != 1 || id < 0 || id >= nn || g->TY[id] != T_PLAYER || n != g->NN[id] * g->N[g->PL[id]]) { okr = 0; break; }
      g->LOCK[id] = (f32 *)malloc(sizeof(f32) * (size_t)n);
      if (fread(g->LOCK[id], 4, (size_t)n, f) != (size_t)n) { okr = 0; break; }
      g->nLocks++; if (g->ST[id] == 2) g->nRiverLocks++;
    }
  }
  fclose(f);
  if (!okr) { free(js); game_free_impl(g); snprintf(err, (size_t)errlen, "Solution file is damaged"); return NULL; }
  for (int i = 0; i < POOL.n; i++) ctx_reserve(POOL.ctx[i], g->maxDepth + 4, g->maxN, g->maxA);
  cum_grow(g, t + 1024);
  *cfgJson = js; *ex = e;
  return g;
}
static int s_combos(Game *g, int p, const uint16_t **out) { *out = g->G[p]; return g->N[p]; }
static int s_view_only(Game *g) { return g->viewOnly; }

static const SolverVT VT = {
  .name = STR(SFX), .init = s_init, .threads = s_threads, .build = s_build, .free_game = s_free, .stats = s_stats, .mem_mb = s_mem_mb,
  .alloc = s_alloc, .iterate = s_iterate, .exploit = s_exploit, .iterations = s_iterations, .reset = s_reset,
  .node_info = s_node_info, .lock = s_lock, .nlocks = s_nlocks, .save = s_save, .load = s_load, .combos = s_combos, .view_only = s_view_only, .gpu_info = s_gpu_info, .runouts = s_runouts, .set_threads = s_set_threads
};
const SolverVT *VTNAME(void) { return &VT; }
