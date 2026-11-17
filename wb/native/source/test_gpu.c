// Compares the GPU river path (emulated: EIGHTMAX_GPU=emu:WGxGROUPS) against the CPU engine.
// usage: test_gpu <spot> <iterations>   spots: turn, turn_icm, flop, flop_iso, flop_icm (add _c16 for 16-bit storage)
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include "solver.h"
#include "gpu.h"

static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec * 1e-9; }
static int card(const char *s) {
  const char *R = "23456789TJQKA", *S = "cdhs";
  return (int)(strchr(R, s[0]) - R) * 4 + (int)(strchr(S, s[1]) - S);
}
static unsigned rng = 12345;
static double rnd(void) { rng = rng * 1103515245u + 12345u; return ((rng >> 8) & 0xFFFF) / 65536.0; }
static void ranges(GameCfg *c, double frac0, double frac1, int symmetric) {
  // hand weights depend only on ranks and suitedness when symmetric (so suit isomorphism applies)
  static double rankW[13][13][2]; int init = 0;
  if (!init) { for (int a = 0; a < 13; a++) for (int b = 0; b < 13; b++) for (int s = 0; s < 2; s++) rankW[a][b][s] = rnd(); init = 1; }
  int k = 0;
  for (int a = 0; a < 52; a++) for (int b = a + 1; b < 52; b++, k++) {
    const int ra = a >> 2, rb = b >> 2, su = (a & 3) == (b & 3);
    double w0 = symmetric ? rankW[ra][rb][su] : rnd(), w1 = symmetric ? rankW[rb][ra][su] : rnd();
    c->ranges[0][k] = w0 < frac0 ? (float)(0.3 + w0) : 0.f;
    c->ranges[1][k] = w1 < frac1 ? (float)(0.3 + w1) : 0.f;
  }
}
static void sizes(GameCfg *c, int nb, const float *b, int nr, const float *r) {
  for (int s = 0; s < 3; s++) for (int p = 0; p < 2; p++) {
    c->nbet[s][p] = nb; for (int i = 0; i < nb; i++) c->bet[s][p][i] = b[i];
    c->nraise[s][p] = nr; for (int i = 0; i < nr; i++) c->raise[s][p][i] = r[i];
  }
}
static void icm(GameCfg *c) {
  // a bubble-ish curve over OOP's final stack: concave tournament equity
  c->icm = 1; c->icmN = 200; c->icmX0 = 0; c->icmDx = 1.0; c->icmB0 = 60;
  for (int i = 0; i < 200; i++) { double x = i / 199.0; c->icmU[0][i] = (float)(0.5 * (1 - exp(-3 * x)) / (1 - exp(-3.0))); c->icmU[1][i] = (float)(0.5 - 0.45 * pow(x, 0.8)); }
}
static int mkspot(const char *spot, GameCfg *c) {
  memset(c, 0, sizeof *c);
  if (strstr(spot, ".json")) {
    FILE *f = fopen(spot, "rb"); if (!f) return 0;
    static char buf[1 << 22]; size_t n = fread(buf, 1, sizeof buf - 1, f); buf[n] = 0; fclose(f);
    char err[256]; if (!solver_parse_cfg(buf, c, err, sizeof err)) { fprintf(stderr, "%s\n", err); return 0; }
    c->compress = 0; c->gpu = 1; return 1;
  }
  c->maxBets = 3; c->forceAllin = 0.2; c->compress = 0; c->compressAboveMB = 1e9; c->iso = 1; c->gamma = 3; c->gpu = 1;
  const float b1[] = { 50 }, b2[] = { 33, 75 }, r1[] = { 60 }, ra[] = { -1 };
  const int c16 = strstr(spot, "_c16") != NULL;   // 16-bit storage on both engines
  if (c16) c->compress = 1;
  if (!strncmp(spot, "turn", 4)) {
    const char *bd[] = { "Ks", "7h", "2d", "5c" };
    c->nb = 4; for (int i = 0; i < 4; i++) c->board[i] = card(bd[i]);
    c->pot = 10; c->stack = 40;
    ranges(c, 0.35, 0.4, 0);
    sizes(c, 2, b2, 1, r1);
    if (!strncmp(spot, "turn_icm", 8)) icm(c);
    return 1;
  }
  if (!strncmp(spot, "flop", 4)) {
    const int iso = !strncmp(spot, "flop_iso", 8) || !strncmp(spot, "flop_icm", 8);
    const char *bd[] = { "Ks", "7s", "2s" }, *bd2[] = { "Kh", "8d", "3c" };
    c->nb = 3; for (int i = 0; i < 3; i++) c->board[i] = card(iso ? bd[i] : bd2[i]);
    c->pot = 6; c->stack = 20;
    ranges(c, 0.08, 0.1, iso);
    sizes(c, 1, b1, 1, ra);
    if (!strncmp(spot, "flop_icm", 8)) icm(c);
    return 1;
  }
  return 0;
}
int main(int argc, char **argv) {
  const char *spot = argc > 1 ? argv[1] : "turn";
  int iters = argc > 2 ? atoi(argv[2]) : 30;
  const SolverVT *VT = solver_vt_gen();
  VT->init(2);
  gpu_init();
  printf("GPU: %s (ready %d)\n", gpu_desc(), gpu_ready());
  GameCfg cfg; if (!mkspot(spot, &cfg)) { fprintf(stderr, "unknown spot\n"); return 2; }
  char err[512];
  double ex[2] = { 0, 0 }, chips[2], secs[2]; int its[2];
  float *strat[2] = { NULL, NULL }; int nstrat = 0;
  const char *only = getenv("ONLY");
  for (int run = 0; run < 2; run++) {
    if (only && atoi(only) != run) { ex[run] = 0; continue; }
    GameCfg c = cfg; c.gpu = run;   // run 0 = CPU, run 1 = GPU path
    Game *g = VT->build(&c, err, sizeof err);
    if (!g || !VT->alloc(g, err, sizeof err)) { fprintf(stderr, "build: %s\n", err); return 1; }
    if (!strcmp(spot, "turn_lock")) { /* reserved */ }
    const double t0 = now();
    for (int i = 0; i < iters; i++) VT->iterate(g);
    secs[run] = now() - t0;
    VT->exploit(g, &ex[run], &chips[run]);
    its[run] = VT->iterations(g);
    JB gi; jb_init(&gi); VT->gpu_info(g, &gi);
    printf("%s: it %d  exploitability %.6f%%  (%.6f)  %.2fs  gpu %s\n", run ? "GPU" : "CPU", its[run], ex[run], chips[run], secs[run], gi.s); jb_free(&gi);
    // root strategy summary via node_info (forces a sync on the GPU run)
    JB o; jb_init(&o);
    if (VT->node_info(g, NULL, 0, 1, &o, err, sizeof err)) {
      const char *p = strstr(o.s, "\"strategy\":[");
      if (p) { p += 12; int n = 0; float *a = (float *)malloc(sizeof(float) * 200000); while (*p && *p != ']' && n < 200000) { a[n++] = strtof(p, (char **)&p); if (*p == ',') p++; } strat[run] = a; nstrat = n; }
    }
    jb_free(&o);
    // a river node deep in the tree: check-check on the turn, then the first river card
    int path[3] = { 0, 0, 0 };
    jb_init(&o);
    if (cfg.nb == 4 && VT->node_info(g, path, 3, 1, &o, err, sizeof err)) { const char *p = strstr(o.s, "\"strategy\":["); if (p) printf("  river node strategy head: %.60s\n", p + 12); }
    jb_free(&o);
    VT->free_game(g);
  }
  if (only) return 0;
  double md = 0; for (int i = 0; i < nstrat; i++) { double d = fabs(strat[0][i] - strat[1][i]); if (d > md) md = d; }
  const double rel = fabs(ex[0] - ex[1]) / (fabs(ex[0]) > 1e-9 ? fabs(ex[0]) : 1e-9);
  printf("root strategy max diff %.5f over %d values; exploitability rel diff %.4f\n", md, nstrat, rel);
  const int pass = md < 0.05 && rel < 0.02;   // early iterates are sensitive to f32 vs f64 rounding; aggregates agree closely
  printf("%s\n", pass ? "PASS" : "FAIL");
  return pass ? 0 : 1;
}
