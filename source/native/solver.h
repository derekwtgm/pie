#ifndef EM_SOLVER_H
#define EM_SOLVER_H
#include <stdint.h>
#include "json.h"
// Heads-up postflop DCFR solver with a thread pool. Compiled once per instruction set
// (AVX2 / SSE4.2); main() picks the table that matches the CPU.
// bet/raise size codes: > 0 = % of the pot, SZ_ALLIN, SZ_GEO (bets: the same fraction of the pot on every
// remaining street gets the stacks in by the river), SZ_X(m) (raises: m times the bet faced)
#define SZ_ALLIN (-1.f)
#define SZ_GEO (-2.f)
#define SZ_X(m) (-100.f * (float)(m))
#define SZ_IS_X(v) ((v) <= -100.f)
#define SZ_XMUL(v) (-(v) / 100.f)
typedef struct GameCfg {
  int nb; int board[5];
  double pot, stack;
  float ranges[2][1326];
  int nbet[3][2]; float bet[3][2][8];       // size codes above
  int nraise[3][2]; float raise[3][2][8];
  int hasDonk, ndonk[3]; float donk[3][8];  // OOP's lead after calling IP's bet on the previous street (turn, river)
  int reraiseAllin;                         // 3-bets and later are all-in only
  int maxBets; double forceAllin;
  int compress;                             // -1 auto, 0 float32, 1 16-bit
  double compressAboveMB;
  int iso;                                  // share subtrees of suit-isomorphic turn/river cards
  int icm, icmN; double icmX0, icmDx, icmB0;  // ICM payoffs: equity tables over OOP's final stack
  float icmU[2][1024];
  double gamma;                             // strategy-averaging exponent (weights t^gamma)
  int gpu;                                  // solve the river phase on the GPU when one is available
} GameCfg;
typedef struct Game Game;
typedef struct SolverVT {
  const char *name;
  void (*init)(int threads);
  int (*threads)(void);
  Game *(*build)(const GameCfg *cfg, char *err, int errlen);
  void (*free_game)(Game *g);
  void (*stats)(Game *g, JB *out);
  double (*mem_mb)(Game *g);
  int (*alloc)(Game *g, char *err, int errlen);
  void (*iterate)(Game *g);
  void (*exploit)(Game *g, double *pct, double *chips);
  int (*iterations)(Game *g);
  void (*reset)(Game *g);
  int (*node_info)(Game *g, const int *path, int npath, int full, JB *out, char *err, int errlen);
  int (*lock)(Game *g, const int *path, int npath, const float *strat, int n, char *err, int errlen);
  int (*nlocks)(Game *g);
  int (*save)(Game *g, const char *file, const char *cfgJson, double exploitPct, char *err, int errlen);
  Game *(*load)(const char *file, char **cfgJson, double *exploitPct, char *err, int errlen);
  int (*combos)(Game *g, int p, const uint16_t **out);
  int (*view_only)(Game *g);
  void (*gpu_info)(Game *g, JB *out);       // {"available","device","on","why",...}; g may be NULL
  int (*runouts)(Game *g, const int *path, int npath, JB *out, char *err, int errlen);   // per-card summaries at a chance node
  void (*set_threads)(int n);               // how many pool threads take work (power modes)
} SolverVT;
const SolverVT *solver_vt_avx2(void);
const SolverVT *solver_vt_sse(void);
const SolverVT *solver_vt_gen(void);
int solver_parse_cfg(const char *json, GameCfg *cfg, char *err, int errlen);
#endif
