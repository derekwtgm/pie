// EightMax.exe --gpu-test: checks the GPU river engine against the CPU engine on a turn spot (full precision and
// 16-bit storage), then times both on a flop spot. Prints a verdict the user can share.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include "solver.h"
#include "gpu.h"
#ifdef _WIN32
#include <windows.h>
static double st_now(void) { static LARGE_INTEGER f; LARGE_INTEGER c; if (!f.QuadPart) QueryPerformanceFrequency(&f); QueryPerformanceCounter(&c); return (double)c.QuadPart / (double)f.QuadPart; }
#else
static double st_now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (double)t.tv_sec + (double)t.tv_nsec * 1e-9; }
#endif

static int st_card(const char *s) { const char *R = "23456789TJQKA", *S = "cdhs"; return (int)(strchr(R, s[0]) - R) * 4 + (int)(strchr(S, s[1]) - S); }
// a range from a rank/suitedness score: the top `frac` of hands, weighted by how close they are to the cut
static void st_range(float *w, double frac, int seed) {
  unsigned r = 2166136261u ^ (unsigned)seed;
  double sc[13][13][2];
  for (int a = 0; a < 13; a++) for (int b = 0; b < 13; b++) for (int s = 0; s < 2; s++) {
    r = r * 16777619u + 12345u;
    const int hi = a > b ? a : b, lo = a > b ? b : a;
    sc[a][b][s] = (hi * 2.0 + lo + (a == b ? 9 : 0) + (s ? 2.5 : 0)) / 46.0 + ((r >> 9) & 1023) / 1023.0 * 0.15;
  }
  int k = 0;
  for (int x = 0; x < 52; x++) for (int y = x + 1; y < 52; y++, k++) {
    const double v = sc[x >> 2][y >> 2][(x & 3) == (y & 3)];
    w[k] = v > 1.0 - frac ? (float)(0.4 + 0.6 * fmin(1.0, (v - (1.0 - frac)) * 4)) : 0.f;
  }
}
static void st_sizes(GameCfg *c, const float *bet, int nb, const float *raise, int nr) {
  for (int s = 0; s < 3; s++) for (int p = 0; p < 2; p++) {
    c->nbet[s][p] = nb; for (int i = 0; i < nb; i++) c->bet[s][p][i] = bet[i];
    c->nraise[s][p] = nr; for (int i = 0; i < nr; i++) c->raise[s][p][i] = raise[i];
  }
}
static void st_spot(GameCfg *c, int flop) {
  memset(c, 0, sizeof *c);
  c->maxBets = 3; c->forceAllin = 0.2; c->compress = 0; c->compressAboveMB = 1e9; c->iso = 1; c->gamma = 3; c->gpu = 1;
  const float b2[] = { 33, 75 }, r1[] = { 60 };
  if (!flop) {
    const char *bd[] = { "Ks", "7h", "2d", "5c" };
    c->nb = 4; for (int i = 0; i < 4; i++) c->board[i] = st_card(bd[i]);
    c->pot = 10; c->stack = 40;
    st_range(c->ranges[0], 0.40, 1); st_range(c->ranges[1], 0.48, 2);
    st_sizes(c, b2, 2, r1, 1);
  } else {
    const char *bd[] = { "Kh", "8d", "3c" };
    c->nb = 3; for (int i = 0; i < 3; i++) c->board[i] = st_card(bd[i]);
    // about 1.6 GB: one bet size and one raise on every street (EIGHTMAX_SELFTEST_SMALL: about 0.5 GB)
    const float b1[] = { 50 }, b66[] = { 66 }, rj[] = { -1 };
    c->pot = 6; c->stack = 40;
    st_range(c->ranges[0], 0.30, 3); st_range(c->ranges[1], 0.36, 4);
    if (getenv("EIGHTMAX_SELFTEST_SMALL")) st_sizes(c, b66, 1, rj, 1); else st_sizes(c, b1, 1, r1, 1);
  }
}
// runs `its` iterations; returns exploitability (% pot) and seconds per iteration
static int st_run(const SolverVT *VT, GameCfg *c, int its, double *ex, double *spi, int *onGpu, char *why, size_t whyLen) {
  char err[512];
  Game *g = VT->build(c, err, sizeof err);
  if (!g || !VT->alloc(g, err, sizeof err)) { printf("    could not build the spot: %s\n", err); if (g) VT->free_game(g); return 0; }
  if (c->nb == 3 && !c->gpu) printf("    tree: %.0f MB\n", VT->mem_mb(g));
  VT->iterate(g);   // first iteration sets the GPU up; not timed
  const double t0 = st_now();
  for (int i = 1; i < its; i++) VT->iterate(g);
  *spi = its > 1 ? (st_now() - t0) / (its - 1) : 0;
  double chips;
  VT->exploit(g, ex, &chips);
  JB o; jb_init(&o); VT->gpu_info(g, &o);
  *onGpu = o.s && strstr(o.s, "\"on\":true") != NULL;
  const char *w = o.s ? strstr(o.s, "\"why\":\"") : NULL;
  if (w) { w += 7; size_t k = 0; while (w[k] && w[k] != '"' && k + 1 < whyLen) { why[k] = w[k]; k++; } why[k] = 0; } else why[0] = 0;
  jb_free(&o);
  VT->free_game(g);
  return 1;
}
int gpu_selftest(const SolverVT *VT) {
  // test hook: EIGHTMAX_SELFTEST_QUICK runs the long accuracy checks for 12 iterations instead of 60 (for the emulator)
  const int LONG = getenv("EIGHTMAX_SELFTEST_QUICK") ? 12 : 60;
  printf("\n  EightMax GPU self-test\n  ----------------------\n");
  printf("  GPU: %s\n", gpu_ready() ? gpu_desc() : "none");
  if (!gpu_ready()) { printf("  No usable GPU: %s\n  The solver will use the CPU engine.\n", gpu_desc()); return 2; }
  GameCfg c; double exC, exG, sC, sG; int onC, onG; char why[300];
  int pass = 1;
  // 1. correctness: after two iterations both engines must agree to rounding; after 40 the solves must be close
  printf("\n  1. Accuracy (turn spot, river on the GPU)\n");
  st_spot(&c, 0); c.gpu = 0;
  if (!st_run(VT, &c, 2, &exC, &sC, &onC, why, sizeof why)) return 1;
  st_spot(&c, 0); c.gpu = 1;
  if (!st_run(VT, &c, 2, &exG, &sG, &onG, why, sizeof why)) return 1;
  if (!onG) { printf("    The GPU was not used: %s\n", why); return 1; }
  const double d2 = fabs(exC - exG) / fmax(1e-9, fabs(exC));
  printf("    after 2 iterations:  CPU %.5f%%  GPU %.5f%%  (difference %.4f%%) %s\n", exC, exG, d2 * 100, d2 < 0.002 ? "ok" : "MISMATCH");
  pass &= d2 < 0.002;
  st_spot(&c, 0); c.gpu = 0; st_run(VT, &c, LONG, &exC, &sC, &onC, why, sizeof why);
  st_spot(&c, 0); c.gpu = 1; st_run(VT, &c, LONG, &exG, &sG, &onG, why, sizeof why);
  const double d60 = fabs(exC - exG) / fmax(1e-9, fabs(exC));
  printf("    after %d iterations: CPU %.4f%%  GPU %.4f%%  %s\n", LONG, exC, exG, d60 < 0.15 ? "ok" : "MISMATCH");
  pass &= d60 < 0.15;
  // the same with 16-bit storage (used for trees too big for the card in full precision)
  printf("\n  1b. Accuracy with 16-bit storage\n");
  st_spot(&c, 0); c.gpu = 0; c.compress = 1; st_run(VT, &c, 2, &exC, &sC, &onC, why, sizeof why);
  st_spot(&c, 0); c.gpu = 1; c.compress = 1; st_run(VT, &c, 2, &exG, &sG, &onG, why, sizeof why);
  if (!onG) { printf("    The GPU was not used: %s\n", why); pass = 0; }
  else {
    const double e2 = fabs(exC - exG) / fmax(1e-9, fabs(exC));
    printf("    after 2 iterations:  CPU %.5f%%  GPU %.5f%%  (difference %.4f%%) %s\n", exC, exG, e2 * 100, e2 < 0.002 ? "ok" : "MISMATCH");
    pass &= e2 < 0.002;
    st_spot(&c, 0); c.gpu = 0; c.compress = 1; st_run(VT, &c, LONG, &exC, &sC, &onC, why, sizeof why);
    st_spot(&c, 0); c.gpu = 1; c.compress = 1; st_run(VT, &c, LONG, &exG, &sG, &onG, why, sizeof why);
    const double e60 = fabs(exC - exG) / fmax(1e-9, fabs(exC));
    printf("    after %d iterations: CPU %.4f%%  GPU %.4f%%  %s\n", LONG, exC, exG, e60 < 0.15 ? "ok" : "MISMATCH");
    pass &= e60 < 0.15;
  }
  // 2. speed on a flop spot
  printf("\n  2. Speed (flop spot, 40bb, one bet size and one raise per street)\n");
  st_spot(&c, 1); c.gpu = 0;
  if (!st_run(VT, &c, 4, &exC, &sC, &onC, why, sizeof why)) return 1;
  st_spot(&c, 1); c.gpu = 1;
  if (!st_run(VT, &c, 4, &exG, &sG, &onG, why, sizeof why)) return 1;
  printf("    CPU %.2f s per iteration, GPU %.2f s per iteration%s\n", sC, sG, onG ? "" : " (GPU not used)");
  if (onG && sG > 0) printf("    speed-up %.1fx\n", sC / sG);
  if (!onG) printf("    The GPU was not used: %s\n", why);
  else {
    double ex16, s16; int on16;
    st_spot(&c, 1); c.gpu = 1; c.compress = 1;
    if (st_run(VT, &c, 4, &ex16, &s16, &on16, why, sizeof why) && on16) printf("    GPU with 16-bit storage %.2f s per iteration (half the memory)\n", s16);
  }
  printf("\n  %s\n", pass ? "PASS: the GPU engine agrees with the CPU engine." : "FAIL: the GPU results differ. Solve with \"CPU only\" and please report this output.");
  return pass ? 0 : 1;
}
