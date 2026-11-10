// EightMax desktop: a local web server (127.0.0.1 only) that serves the app and a JSON API
// for the native multi-core postflop solver, flop reports and saved solutions.
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <psapi.h>
#include <io.h>
#include <shellapi.h>
#include <direct.h>
typedef SOCKET sock_t;
#define CLOSESOCK closesocket
#define PATHSEP "\\"
#else
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <dirent.h>
#include <signal.h>
typedef int sock_t;
#define CLOSESOCK close
#define INVALID_SOCKET (-1)
#define PATHSEP "/"
#endif
#include <pthread.h>
#include <errno.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <math.h>
#include <sys/stat.h>
#include "json.h"
#include "solver.h"
#include "gpu.h"
#include "ui_html.h"
#include "mw.h"

#ifndef EM_VERSION
#error "Build with -DEM_VERSION (see native/build.sh, which reads source/VERSION)"
#endif
#ifndef EM_BUILD_ID
#define EM_BUILD_ID "unknown"
#endif
#define VERSION EM_VERSION
static const SolverVT *VT;
static int PORT = 0, THREADS = 1;
static double RAM_MB = 0;
static long PROCESS_LIMIT_MIB=6144;
// Whole-application budget: native host + the browser memory the interface reports.
// Default: half of physical RAM, at most 8 GiB (8,192 MiB on a 16 GB PC). EIGHTMAX_APP_MIB overrides.
static long APP_LIMIT_MIB=0;
static int LOGICAL_CPUS=1,PHYSICAL_CORES=0,PERFORMANCE_CORES=0,EFFICIENCY_CORES=0;
#ifdef _WIN32
static void detect_core_classes(void){
  DWORD size=0;
  GetLogicalProcessorInformationEx(RelationProcessorCore,NULL,&size);
  if(!size)return;
  unsigned char *data=malloc(size);if(!data)return;
  if(GetLogicalProcessorInformationEx(RelationProcessorCore,(PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX)data,&size)){
    int classes[256]={0},highest=0;
    for(DWORD off=0;off<size;){
      PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX row=(void *)(data+off);
      if(!row->Size||row->Size>size-off)break;
      if(row->Relationship==RelationProcessorCore){
        unsigned c=((const BYTE *)&row->Processor)[1];   // EfficiencyClass (second byte; older SDK headers call it Reserved[0])
        classes[c]++;PHYSICAL_CORES++;if((int)c>highest)highest=(int)c;
      }
      off+=row->Size;
    }
    if(classes[highest]<PHYSICAL_CORES){PERFORMANCE_CORES=classes[highest];EFFICIENCY_CORES=PHYSICAL_CORES-classes[highest];}
  }
  free(data);
}
#endif
static double resident_mib(void){
#ifdef _WIN32
  PROCESS_MEMORY_COUNTERS pm;
  if(GetProcessMemoryInfo(GetCurrentProcess(),&pm,sizeof(pm)))return pm.WorkingSetSize/1048576.0;
#else
  FILE *f=fopen("/proc/self/statm","r");long pages=0,total=0;
  if(f){int fields=fscanf(f,"%ld %ld",&total,&pages);fclose(f);if(fields==2)return pages*(double)sysconf(_SC_PAGESIZE)/1048576.0;}
#endif
  return -1;
}
static char SAVE_DIR[1024];

static pthread_mutex_t GAME_MU = PTHREAD_MUTEX_INITIALIZER;   // serialises every solver call
static pthread_mutex_t STATE_MU = PTHREAD_MUTEX_INITIALIZER;  // guards job/report status
static Game *G = NULL;
static char *G_CFG = NULL;
static double LAST_EX = -1;

static _Atomic int JOB_RUNNING = 0, JOB_STOP = 0;
static int G_BUSY = 0;   // a request is replacing or editing G; no job may start meanwhile (guarded by STATE_MU)
static int JOB_KIND = 0;                   // 1 solve, 2 report
static int P_IT = 0, P_DONE = 0, P_STOPPED = 0;
static double P_EX = -1, P_ELAPSED = 0, P_CHIPS = 0;
static char P_ERR[512];
static char P_GPU[1024];                    // GPU status of the running/last solve (JSON)
// power: 0 full speed, 1 balanced (all threads, but other programs go first), 2 quiet (half the threads,
// lowest priority, GPU idle half the time)
static int POWER = 1;
static void apply_power(int mode) {
  if (mode < 0 || mode > 2) mode = 1;
  POWER = mode;
  VT->set_threads(mode == 2 ? (THREADS + 1) / 2 : THREADS);
  gpu_set_duty(mode == 2 ? 0.5 : 1.0);
#ifdef _WIN32
  SetPriorityClass(GetCurrentProcess(), mode == 0 ? NORMAL_PRIORITY_CLASS : mode == 1 ? BELOW_NORMAL_PRIORITY_CLASS : IDLE_PRIORITY_CLASS);
#endif
}
// report
static JB R_RESULTS; static int R_DONE = 0, R_TOTAL = 0, R_CUR_IT = 0; static double R_CUR_EX = -1; static int R_CUR_FLOP[3];

static double now_s(void) {
#ifdef _WIN32
  static LARGE_INTEGER f; LARGE_INTEGER c; if (!f.QuadPart) QueryPerformanceFrequency(&f); QueryPerformanceCounter(&c); return (double)c.QuadPart / (double)f.QuadPart;
#else
  struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts); return (double)ts.tv_sec + ts.tv_nsec * 1e-9;
#endif
}
static void sleep_ms(int ms) {
#ifdef _WIN32
  Sleep((DWORD)ms);
#else
  struct timespec ts = { ms / 1000, (long)(ms % 1000) * 1000000L }; nanosleep(&ts, NULL);
#endif
}

/* ---------------- HTTP ---------------- */
static int send_all(sock_t s, const char *b, size_t n) {
  while (n) { int k = send(s, b, (int)(n > 1 << 20 ? 1 << 20 : n), 0); if (k <= 0) return 0; b += k; n -= (size_t)k; }
  return 1;
}
static void respond(sock_t s, int code, const char *type, const char *body, size_t n) {
  char h[512];
  const char *msg = code == 200 ? "OK" : code == 400 ? "Bad Request" : code == 403 ? "Forbidden" : code == 404 ? "Not Found" : code == 409 ? "Conflict" : "Error";
  int k = snprintf(h, sizeof h, "HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n", code, msg, type, n);
  send_all(s, h, (size_t)k);
  if (n) send_all(s, body, n);
}
static void respond_json(sock_t s, int code, JB *b) { if(b->failed){respond(s,503,"application/json","{}",2);return;} respond(s, code, "application/json; charset=utf-8", b->s, b->n); }
static void respond_err(sock_t s, int code, const char *msg) {
  JB b; jb_init(&b); jb_puts(&b, "{\"error\":"); jb_str(&b, msg); jb_putc(&b, '}'); respond_json(s, code, &b); jb_free(&b);
}
static void respond_ok(sock_t s) { respond(s, 200, "application/json", "{\"ok\":true}", 11); }

static const char *find_header(const char *hdr, const char *name) {
  size_t n = strlen(name);
  for (const char *p = hdr; *p; ) {
    const char *e = strstr(p, "\r\n"); if (!e) break;
    if(e==p)break;
    if ((size_t)(e - p) > n && !strncasecmp(p, name, n) && p[n] == ':') { p += n + 1; while (*p == ' ') p++; return p; }
    p = e + 2;
  }
  return NULL;
}

/* ---------------- helpers ---------------- */
static int path_from(JV *v, int *path, int max) {
  JV *a = jget(v, "path"); int n = 0;
  if (!a || a->type != J_ARR) return 0;
  for (int i = 0; i < a->n && n < max; i++) path[n++] = (int)jnum(a->items[i], -1);
  return n;
}
static void game_meta(JB *b, Game *g) {
  jb_puts(b, "{\"stats\":"); VT->stats(g, b);
  for (int p = 0; p < 2; p++) {
    const uint16_t *c; int n = VT->combos(g, p, &c);
    jb_puts(b, p ? ",[" : ",\"combos\":[[");
    for (int i = 0; i < n; i++) { if (i) jb_putc(b, ','); jb_printf(b, "%u", c[i]); }
    jb_putc(b, ']');
  }
  jb_putc(b, ']');
}
static int safe_name(const char *in, char *out, size_t cap) {
  size_t k = 0;
  for (const char *p = in; *p && k + 1 < cap && k < 60; p++) {
    char c = *p;
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ' ' || c == '-' || c == '_' || c == '.') out[k++] = c;
  }
  while (k && (out[k - 1] == ' ' || out[k - 1] == '.')) k--;
  out[k] = 0;
  if (!k) return 0;
  // Windows reserves these device names even with an extension (con.em8 is the console)
  static const char *dev[] = { "con", "prn", "aux", "nul", "clock$" };
  size_t stem = 0; while (stem < k && out[stem] != '.') stem++;
  while (stem && out[stem - 1] == ' ') stem--;
  char low[8] = {0};
  if (stem < sizeof low) for (size_t i = 0; i < stem; i++) low[i] = (char)(out[i] >= 'A' && out[i] <= 'Z' ? out[i] + 32 : out[i]);
  for (size_t i = 0; i < sizeof dev / sizeof *dev; i++) if (!strcmp(low, dev[i])) return 0;
  if (stem == 4 && (!strncmp(low, "com", 3) || !strncmp(low, "lpt", 3)) && low[3] >= '0' && low[3] <= '9') return 0;
  return 1;
}
static void ensure_dir(const char *d) {
#ifdef _WIN32
  _mkdir(d);
#else
  mkdir(d, 0755);
#endif
}
static int init_save_dir(void) {
#ifdef _WIN32
  const char *home = getenv("USERPROFILE");
  if (home && strlen(home)>880)return 0;
  if (home) { char docs[900]; snprintf(docs, sizeof docs, "%s\\Documents", home); ensure_dir(docs); snprintf(SAVE_DIR, sizeof SAVE_DIR, "%s\\EightMax", docs); }
  else snprintf(SAVE_DIR, sizeof SAVE_DIR, "EightMax solutions");
#else
  const char *home = getenv("HOME");
  if(home && strlen(home)+10>=sizeof SAVE_DIR)return 0;
  snprintf(SAVE_DIR, sizeof SAVE_DIR, "%s/EightMax", home ? home : ".");
#endif
  ensure_dir(SAVE_DIR);return 1;
}

/* ---------------- solve job ---------------- */
typedef struct { double target; int maxIter; int reset; } SolveArgs;
static void set_err(const char *m) { pthread_mutex_lock(&STATE_MU); snprintf(P_ERR, sizeof P_ERR, "%s", m); pthread_mutex_unlock(&STATE_MU); }
// iterate g until target/maxIter/stop; progress written through cb
// Exploitability checks cost about as much as an iteration, so they are scheduled: after two checks the
// decay rate predicts when the target will be reached and the next check lands there (no wasted
// iterations past the target), with checks kept to a small share of the time otherwise.
static int next_check(int it, double ex, int it0, double ex0, double target, double checkCost, double iterCost) {
  if (iterCost <= 0) iterCost = 1e-3;
  const double r = checkCost / iterCost;
  int gapMin = (int)(12 * r + 0.999); if (gapMin < 3) gapMin = 3;             // checks <= ~8% of the time
  // but at least one every ~8 s, and at most +50% iterations per check: early decay rates under-predict
  // how fast the solve speeds up, so long jumps would overshoot the target
  int gapMax = (int)(8.0 / iterCost); if (gapMax > it / 2) gapMax = it / 2;
  if (gapMax > 400) gapMax = 400;
  if (gapMax < gapMin) gapMax = gapMin;
  int gap = gapMin;
  if (it0 > 0 && ex0 > ex && ex > target && it > it0) {
    const double k = log(ex0 / ex) / log((double)it / it0);   // ex ~ it^-k
    if (k > 0.2) {
      double pred = it * pow(ex / target, 1.0 / k);
      // a slow decay or a tiny target can predict billions of iterations; clamp before converting to int
      if (!(pred < (double)it + 1e6)) pred = (double)it + 1e6;
      int want = (int)ceil(pred) - it;
      int lo = gapMin / 4; if (lo < 1) lo = 1;
      gap = want < lo ? lo : want > gapMax ? gapMax : want;
    }
  }
  return it + gap;
}
// returns 1 when the exploitability in *exOut / *chipsOut was measured at the final iteration
static int run_iterations(Game *g, double target, int maxIter, int report, double *exOut, double *chipsOut) {
  double t0 = now_s(), checkCost = 0, iterCost = 0, ex = -1, chips = 0, lastEx = -1; int lastIt = 0, nextCheck = 3;
  for (;;) {
    if (JOB_STOP) break;
    if(resident_mib()>=PROCESS_LIMIT_MIB){set_err("Native process memory limit reached");JOB_STOP=1;return 0;}
    pthread_mutex_lock(&GAME_MU);
    double cs = now_s(); const int itStart = VT->iterations(g);
    do { VT->iterate(g); } while (now_s() - cs < 0.25 && VT->iterations(g) < maxIter && VT->iterations(g) < nextCheck);
    int it = VT->iterations(g);
    if (it > itStart) { const double c = (now_s() - cs) / (it - itStart); iterCost = iterCost > 0 ? 0.7 * iterCost + 0.3 * c : c; }
    JB gi; jb_init(&gi); VT->gpu_info(g, &gi);
    int due = it >= maxIter || it >= nextCheck;
    if (due) {
      double c0 = now_s();
      VT->exploit(g, &ex, &chips); checkCost = now_s() - c0;
      nextCheck = next_check(it, ex, lastIt, lastEx, target, checkCost, iterCost);
      lastIt = it; lastEx = ex;
    }
    pthread_mutex_unlock(&GAME_MU);
    pthread_mutex_lock(&STATE_MU);
    snprintf(P_GPU, sizeof P_GPU, "%s", gi.s ? gi.s : ""); jb_free(&gi);
    if (report) { R_CUR_IT = it; R_CUR_EX = ex; } else { P_IT = it; if (due) { P_EX = ex; P_CHIPS = chips; } P_ELAPSED = now_s() - t0; }
    pthread_mutex_unlock(&STATE_MU);
    if ((due && ex <= target && it >= 10) || it >= maxIter) { *exOut = ex; *chipsOut = chips; return due; }
    sleep_ms(1);
  }
  return 0;
}
static int allocate_for_job(Game *g,char *err,int len){
  if(resident_mib()+VT->mem_mb(g)>PROCESS_LIMIT_MIB){
    snprintf(err,(size_t)len,"Native process estimate exceeds %ld MiB budget. Reduce tree size or EIGHTMAX_THREADS.",PROCESS_LIMIT_MIB);return 0;
  }
  return VT->alloc(g,err,len);
}
static void *solve_job(void *a) {
  pthread_mutex_lock(&STATE_MU);pthread_mutex_unlock(&STATE_MU);
  SolveArgs A = *(SolveArgs *)a; free(a);
  char err[512] = "";
  double t0 = now_s();
  pthread_mutex_lock(&GAME_MU);
  Game *g = G;   // G cannot be replaced while this job runs (build/load refuse, see claim_game)
  int ok = g && allocate_for_job(g,err,sizeof err);
  if (ok && A.reset) VT->reset(g);
  pthread_mutex_unlock(&GAME_MU);
  double ex = -1, chips = 0;
  if (!ok) set_err(err[0] ? err : "Set up the spot first");
  else if (!run_iterations(g, A.target, A.maxIter, 0, &ex, &chips) && resident_mib()<PROCESS_LIMIT_MIB) { pthread_mutex_lock(&GAME_MU); VT->exploit(g, &ex, &chips); pthread_mutex_unlock(&GAME_MU); }
  if (ok) LAST_EX = ex;
  pthread_mutex_lock(&STATE_MU);
  if (ok) { P_EX = ex; P_CHIPS = chips; P_IT = VT->iterations(g); }
  P_ELAPSED = now_s() - t0; P_DONE = 1; P_STOPPED = JOB_STOP; JOB_RUNNING = 0;
  pthread_mutex_unlock(&STATE_MU);
  return NULL;
}
typedef struct { GameCfg base; int n; int (*flops)[4]; double target; int maxIter; } ReportArgs;
static void *report_job(void *a) {
  pthread_mutex_lock(&STATE_MU);pthread_mutex_unlock(&STATE_MU);
  ReportArgs *A = (ReportArgs *)a;
  for (int i = 0; i < A->n && !JOB_STOP; i++) {
    GameCfg cfg = A->base; cfg.nb = 3;
    for (int k = 0; k < 3; k++) cfg.board[k] = A->flops[i][k];
    pthread_mutex_lock(&STATE_MU); memcpy(R_CUR_FLOP, A->flops[i], sizeof R_CUR_FLOP); R_CUR_IT = 0; R_CUR_EX = -1; pthread_mutex_unlock(&STATE_MU);
    char err[512] = "";
    double t0 = now_s();
    pthread_mutex_lock(&GAME_MU);
    Game *g = VT->build(&cfg, err, sizeof err);
    int ok = g && allocate_for_job(g,err,sizeof err);
    pthread_mutex_unlock(&GAME_MU);
    if (!ok) { if (g) { pthread_mutex_lock(&GAME_MU); VT->free_game(g); pthread_mutex_unlock(&GAME_MU); } set_err(err); break; }
    double ex = 0, chips = 0;
    const int measured = run_iterations(g, A->target, A->maxIter, 1, &ex, &chips);
    if (JOB_STOP) { pthread_mutex_lock(&GAME_MU); VT->free_game(g); pthread_mutex_unlock(&GAME_MU); break; }
    JB r; jb_init(&r);
    pthread_mutex_lock(&GAME_MU);
    if (!measured) VT->exploit(g, &ex, &chips);
    jb_printf(&r, "{\"board\":[%d,%d,%d],\"weight\":%d,\"it\":%d,\"ex\":", cfg.board[0], cfg.board[1], cfg.board[2], A->flops[i][3], VT->iterations(g));
    jb_num(&r, ex, 3); jb_puts(&r, ",\"secs\":"); jb_num(&r, now_s() - t0, 1); jb_puts(&r, ",\"root\":");
    int p0[1] = { 0 };
    if (!VT->node_info(g, NULL, 0, 0, &r, err, sizeof err)) jb_puts(&r, "null");
    // IP decision after an OOP check (the usual c-bet spot)
    jb_puts(&r, ",\"afterCheck\":");
    JB tmp; jb_init(&tmp);
    if (VT->node_info(g, p0, 1, 0, &tmp, err, sizeof err) && strstr(tmp.s, "\"type\":\"player\"")) jb_puts(&r, tmp.s); else jb_puts(&r, "null");
    jb_free(&tmp);
    jb_putc(&r, '}');
    VT->free_game(g);
    pthread_mutex_unlock(&GAME_MU);
    pthread_mutex_lock(&STATE_MU);
    if (R_DONE) jb_putc(&R_RESULTS, ',');
    jb_puts(&R_RESULTS, r.s); R_DONE++;
    pthread_mutex_unlock(&STATE_MU);
    jb_free(&r);
  }
  pthread_mutex_lock(&STATE_MU); JOB_RUNNING = 0; P_DONE = 1; P_STOPPED = JOB_STOP; pthread_mutex_unlock(&STATE_MU);
  free(A->flops); free(A);
  return NULL;
}
// The parent holds the job mutex until successful creation and publication.
static int launch_thread(void *(*fn)(void *),void *arg,int stack){
  pthread_attr_t at;pthread_t th;
  int rc=pthread_attr_init(&at);if(rc)return rc;
  rc=pthread_attr_setdetachstate(&at,PTHREAD_CREATE_DETACHED);
  if(!rc)rc=pthread_attr_setstacksize(&at,stack);
  if(!rc)rc=pthread_create(&th,&at,fn,arg);
  pthread_attr_destroy(&at);return rc;
}
static int launch_job_thread(void *(*fn)(void *),void *arg){
  static int injected=0;
  if(getenv("EIGHTMAX_TEST_FAIL_JOB_ONCE") && !__atomic_exchange_n(&injected,1,__ATOMIC_RELAXED))return EAGAIN;
  return launch_thread(fn,arg,16<<20);
}
static int start_job(void *(*fn)(void *), void *arg, int kind,int power) {
  pthread_mutex_lock(&STATE_MU);
  int rc=409;
  if(!JOB_RUNNING && !G_BUSY){
    // Preserve prior diagnostics and report contents on a failed launch.
    int count=kind==2?((ReportArgs*)arg)->n:0;
    rc=launch_job_thread(fn,arg)?503:200;
    if(rc==200){
      if(power>=0)apply_power(power);
      JOB_RUNNING=1;JOB_STOP=0;JOB_KIND=kind;P_DONE=P_STOPPED=P_IT=0;
      P_ERR[0]=P_GPU[0]=0;P_EX=-1;P_ELAPSED=0;
      if(kind==2){jb_free(&R_RESULTS);jb_init(&R_RESULTS);R_DONE=0;R_TOTAL=count;R_CUR_IT=0;R_CUR_EX=-1;}
    }
  }
  pthread_mutex_unlock(&STATE_MU);return rc;
}

// check "no job running" and block new jobs in one step, so a solve cannot start while G is being replaced
static int claim_game(void) {
  pthread_mutex_lock(&STATE_MU);
  const int ok = !JOB_RUNNING && !G_BUSY; if (ok) G_BUSY = 1;
  pthread_mutex_unlock(&STATE_MU);
  return ok;
}
static void release_game(void) { pthread_mutex_lock(&STATE_MU); G_BUSY = 0; pthread_mutex_unlock(&STATE_MU); }

/* ---------------- routes ---------------- */

/* ---------------- native multiway engine (protocol MW_PROTOCOL, see MW-PROTOCOL.md) ---------------- */
static pthread_mutex_t MW_MU = PTHREAD_MUTEX_INITIALIZER;   // guards MWG and the fields below
static MW *MWG = NULL;
static volatile int MW_RUNNING = 0, MW_STOP = 0, MW_QUERY_CANCEL = 0;
static long long MW_IT = 0, MW_DEALS = 0, MW_TARGET = 0;
static double MW_T0 = 0, MW_ELAPSED = 0, MW_TABLE_MIB = 0;
static int MW_THREADS = 1;
static char MW_ERR[512];
static double BROWSER_MIB = 0;          // last memory figure reported by the interface (if any)
// One application budget for the native host: process threshold minus what is already
// resident; the multiway tables get what is left after a safety margin.
static double available_memory_mib(void) {
#ifdef _WIN32
  MEMORYSTATUSEX ms={0};ms.dwLength=sizeof ms;
  return GlobalMemoryStatusEx(&ms)?ms.ullAvailPhys/1048576.0:-1;
#else
#ifdef __linux__
  FILE *mem=fopen("/proc/meminfo","r");
  if(mem){char line[160];unsigned long long kib;
    while(fgets(line,sizeof line,mem))if(sscanf(line,"MemAvailable: %llu kB",&kib)==1){fclose(mem);return kib/1024.0;}
    fclose(mem);
  }
#endif
  long pages=sysconf(_SC_AVPHYS_PAGES);
  return pages>0?pages*(double)sysconf(_SC_PAGESIZE)/1048576.0:-1;
#endif
}
static double mw_budget_mib(void) {
  double resident = resident_mib(); if (resident < 0) resident = 0;
  double room = (double)PROCESS_LIMIT_MIB - resident - 256.0;
  double app = (double)APP_LIMIT_MIB - resident - BROWSER_MIB - 256.0;   // leave a margin for transient allocations
  if (app < room) room = app;
  double available=available_memory_mib();
  if(available>=0 && available/2<room)room=available/2;
  // Tables, sampled workspace, vector capacity, and a checkpoint export can
  // coexist. Leave three shares of the detected room for these other costs.
  return room < 0 ? 0 : room/4;
}
// A restored study stays in the host. Only status and commands cross the UI boundary.
static int MW_RESTORING;
static char *MW_ARCHIVE_META;
static double restore_budget_mib(void){
  double resident=fmax(0,resident_mib());
  double room=fmin(PROCESS_LIMIT_MIB-resident,APP_LIMIT_MIB-resident-BROWSER_MIB)-256;
  double available=available_memory_mib();
  if(available>=0)room=fmin(room,available-512);
  return fmax(0,room*.85);
}
#include "checkpoint_store.h"
static void mw_progress(void *ctx, long long it, long long deals) {
  (void)ctx; pthread_mutex_lock(&MW_MU); MW_IT = it; MW_DEALS = deals; MW_ELAPSED = now_s() - MW_T0; pthread_mutex_unlock(&MW_MU);
}
typedef struct { long long iterations; int threads; } MwArgs;
static void *mw_job(void *a) {
  pthread_mutex_lock(&MW_MU);pthread_mutex_unlock(&MW_MU);
  MwArgs A = *(MwArgs *)a; free(a);
  char err[512] = "";
  int ok = mw_train(MWG, A.iterations, A.threads, &MW_STOP, mw_progress, NULL, err, sizeof err);
  pthread_mutex_lock(&MW_MU);
  if (!ok) snprintf(MW_ERR, sizeof MW_ERR, "%s", err);
  MW_ELAPSED = now_s() - MW_T0; MW_RUNNING = 0;
  pthread_mutex_unlock(&MW_MU);
  return NULL;
}
static void mw_status_json(JB *b) {
  pthread_mutex_lock(&MW_MU);
  jb_printf(b, "{\"protocol\":%d,\"loaded\":%s,\"running\":%s,\"iterations\":%lld,\"trainingDeals\":%lld,\"target\":%lld,\"elapsed\":", MW_PROTOCOL, MWG ? "true" : "false", MW_RUNNING ? "true" : "false", MW_IT, MW_DEALS, MW_TARGET);
  jb_num(b, MW_ELAPSED, 3); jb_printf(b, ",\"threads\":%d,\"error\":", MW_THREADS);
  if (MW_ERR[0]) jb_str(b, MW_ERR); else jb_puts(b, "null");
  jb_printf(b,",\"desktopStudy\":%s,\"restoring\":%s",MW_ARCHIVE_META?"true":"false",MW_RESTORING?"true":"false");
  jb_puts(b, ",\"engine\":");
  if (MWG && !MW_RUNNING) mw_info(MWG, b); else jb_puts(b, "null");
  pthread_mutex_unlock(&MW_MU);
  jb_putc(b, '}');
}
static void memory_json(JB *b) {
  pthread_mutex_lock(&MW_MU); double table = MW_TABLE_MIB, browser = BROWSER_MIB; pthread_mutex_unlock(&MW_MU);
  double resident = resident_mib();
  jb_printf(b, "{\"appLimitMiB\":%ld,\"processLimitMiB\":%ld,\"residentMiB\":", APP_LIMIT_MIB, PROCESS_LIMIT_MIB); jb_num(b, resident, 1);
  jb_puts(b, ",\"multiwayTablesMiB\":"); jb_num(b, table, 1);
  jb_puts(b, ",\"browserReportedMiB\":"); jb_num(b, browser, 1);
  jb_puts(b, ",\"availableForTablesMiB\":"); jb_num(b, mw_budget_mib(), 1);
  jb_puts(b,",\"availableSystemMiB\":");jb_num(b,available_memory_mib(),1);
  jb_printf(b, ",\"systemRamMiB\":%.0f}", RAM_MB);
}
// Returns 1 when the route was handled.
static int mw_api(sock_t s, const char *method, const char *path, const char *body, size_t blen) {
  char err[512] = "";
  if (!strcmp(path, "/api/memory")) {
    if (!strcmp(method, "POST")) {   // the interface reports its own (browser) memory use
      JV *v = json_parse(body ? body : "{}", body ? blen : 2, err, sizeof err);
      if (!v) { respond_err(s, 400, err); return 1; }
      double mib = jnum(jget(v, "browserMiB"), -1); json_free(v);
      if (!(mib >= 0 && mib < 1e6)) { respond_err(s, 400, "browserMiB must be a nonnegative number"); return 1; }
      pthread_mutex_lock(&MW_MU); BROWSER_MIB = mib; pthread_mutex_unlock(&MW_MU);
    }
    JB b; jb_init(&b); memory_json(&b); respond_json(s, 200, &b); jb_free(&b); return 1;
  }
  if (strncmp(path, "/api/mw/", 8)) return 0;
  const char *r = path + 8;
  if (!strcmp(r, "status")) { JB b; jb_init(&b); mw_status_json(&b); respond_json(s, 200, &b); jb_free(&b); return 1; }
  if(!strcmp(r,"desktop-policy")&&!strcmp(method,"GET")){
    pthread_mutex_lock(&MW_MU);
    if(!MW_ARCHIVE_META||!MWG||MW_RUNNING||MW_RESTORING){pthread_mutex_unlock(&MW_MU);respond_err(s,409,"Open an idle desktop study first");return 1;}
    JB b;jb_init(&b);mw_root_policy(MWG,&b);pthread_mutex_unlock(&MW_MU);respond_json(s,200,&b);jb_free(&b);return 1;
  }
  // 3.8: native strategy explorer. Reads one node of the open (desktop or
  // live) native study under the engine lock; the response is bounded by the
  // acting range (at most 1,326 hands) and the requested page.
  if(!strcmp(r,"node-cancel")&&!strcmp(method,"POST")){__atomic_store_n(&MW_QUERY_CANCEL,1,__ATOMIC_RELAXED);respond_ok(s);return 1;}
  if(!strcmp(r,"node")&&!strcmp(method,"POST")){
    pthread_mutex_lock(&MW_MU);
    if(!MWG||MW_RUNNING||MW_RESTORING){pthread_mutex_unlock(&MW_MU);respond_err(s,409,MWG?"Stop training before exploring the study":"Open a native study first");return 1;}
    __atomic_store_n(&MW_QUERY_CANCEL,0,__ATOMIC_RELAXED);
    JB b;jb_init(&b);int status=mw_node_query(MWG,body,blen,&b,err,sizeof err,&MW_QUERY_CANCEL);
    pthread_mutex_unlock(&MW_MU);
    if(status==200)respond_json(s,200,&b);else respond_err(s,status,err[0]?err:"Query failed");
    jb_free(&b);return 1;
  }
  if (!strcmp(r, "state") && !strcmp(method, "GET")) {
    pthread_mutex_lock(&MW_MU);
    if (MW_ARCHIVE_META || MW_RESTORING) { pthread_mutex_unlock(&MW_MU); respond_err(s,409,"Use Save native checkpoint to export this desktop study");return 1; }
    if (!MWG || MW_RUNNING) { pthread_mutex_unlock(&MW_MU); respond_err(s, 409, MWG ? "Training is running" : "No native multiway study"); return 1; }
    unsigned char *buf = NULL; size_t n = mw_export(MWG, &buf);
    pthread_mutex_unlock(&MW_MU);
    if (!n) { respond_err(s, 503, "Out of memory"); return 1; }
    respond(s, 200, "application/octet-stream", (const char *)buf, n); free(buf); return 1;
  }
  if (strcmp(method, "POST")) { respond_err(s, 404, "Not found"); return 1; }
  if (!strcmp(r, "stop")) { __atomic_store_n(&MW_STOP,1,__ATOMIC_RELAXED); respond_ok(s); return 1; }
  pthread_mutex_lock(&MW_MU);
  if (MW_RUNNING || MW_RESTORING) { pthread_mutex_unlock(&MW_MU); respond_err(s, 409, "Native multiway training is running; stop it first"); return 1; }
  if(MW_ARCHIVE_META && strcmp(r,"desktop-release") && strcmp(r,"desktop-train")){
    pthread_mutex_unlock(&MW_MU);respond_err(s,409,"A restored desktop study is open. Close it first.");return 1;
  }
  if(!strncmp(r,"desktop-",8)&&!MW_ARCHIVE_META){
    pthread_mutex_unlock(&MW_MU);respond_err(s,409,"No restored desktop study");return 1;
  }
  if (!strcmp(r,"desktop-release")){free(MW_ARCHIVE_META);MW_ARCHIVE_META=NULL;r="free";}
  if (!strcmp(r,"desktop-train"))r="train";
  if (!strcmp(r, "free")) { mw_free(MWG); MWG = NULL; MW_TABLE_MIB = 0; MW_ERR[0] = 0; pthread_mutex_unlock(&MW_MU); respond_ok(s); return 1; }
  if (!strcmp(r, "init")) {
    if (!body || !blen) { pthread_mutex_unlock(&MW_MU); respond_err(s, 400, "Empty native spec"); return 1; }
    double budget = mw_budget_mib();
    JV *request=json_parse(body,blen,err,sizeof err);
    if(request){double requested=jnum(jget(request,"tableLimitMiB"),budget);json_free(request);if(requested>0 && requested<budget)budget=requested;}
    if(budget<1){pthread_mutex_unlock(&MW_MU);respond_err(s,503,"Insufficient process or application RAM budget");return 1;}
    MW *m = mw_create(body, blen, budget, err, sizeof err);
    if (!m) { pthread_mutex_unlock(&MW_MU); respond_err(s, 400, err); return 1; }
    mw_free(MWG);MWG=m;MW_TABLE_MIB=0; MW_ERR[0] = 0; MW_IT = MW_DEALS = MW_TARGET = 0; MW_ELAPSED = 0;
    JB b; jb_init(&b); mw_info(m, &b);
    { JV *iv = json_parse(b.s, b.n, err, sizeof err); if (iv) { MW_TABLE_MIB = jnum(jget(iv, "tableMiB"), 0); MW_IT = (long long)jnum(jget(iv, "iterations"), 0); MW_DEALS = (long long)jnum(jget(iv, "trainingDeals"), 0); json_free(iv); } }
    jb_free(&b); jb_init(&b); jb_puts(&b, "{\"ok\":true,\"budgetMiB\":"); jb_num(&b, budget, 1); jb_puts(&b, ",\"engine\":"); mw_info(m, &b); jb_putc(&b, '}');
    pthread_mutex_unlock(&MW_MU);
    respond_json(s, 200, &b); jb_free(&b); return 1;
  }
  if (!strcmp(r, "import")) {
    if (!MWG) { pthread_mutex_unlock(&MW_MU); respond_err(s, 400, "Initialize the native study first"); return 1; }
    int ok = body && mw_import(MWG, (const unsigned char *)body, blen, err, sizeof err);
    pthread_mutex_unlock(&MW_MU);
    if (!ok) { respond_err(s, 400, err[0] ? err : "Empty state"); return 1; }
    respond_ok(s); return 1;
  }
  if (!strcmp(r, "train")) {
    JV *v = json_parse(body ? body : "{}", body ? blen : 2, err, sizeof err);
    if (!v) { pthread_mutex_unlock(&MW_MU); respond_err(s, 400, err); return 1; }
    double it = jnum(jget(v, "iterations"), -1), th = jnum(jget(v, "threads"), THREADS); json_free(v);
    if (!MWG) { pthread_mutex_unlock(&MW_MU); respond_err(s, 400, "Initialize the native study first"); return 1; }
    if (!(it >= 1 && it <= 10000000) || floor(it) != it) { pthread_mutex_unlock(&MW_MU); respond_err(s, 400, "iterations must be an integer from 1 to 10,000,000"); return 1; }
    if (!(th >= 1 && th <= 256) || floor(th) != th) { pthread_mutex_unlock(&MW_MU); respond_err(s, 400, "threads must be an integer from 1 to 256"); return 1; }
    MwArgs *A = (MwArgs *)malloc(sizeof *A);
    if (!A) { pthread_mutex_unlock(&MW_MU); respond_err(s, 503, "Out of memory"); return 1; }
    if(MW_IT+(long long)it>10000000){free(A);pthread_mutex_unlock(&MW_MU);respond_err(s,400,"Checkpoint update count limit would be exceeded");return 1;}
    A->iterations = (long long)it; A->threads = (int)th > LOGICAL_CPUS ? LOGICAL_CPUS : (int)th;
    if (launch_job_thread(mw_job,A)) { free(A); pthread_mutex_unlock(&MW_MU); respond_err(s,503,"Could not start a training thread"); return 1; }
    MW_THREADS = A->threads; __atomic_store_n(&MW_STOP,0,__ATOMIC_RELAXED); MW_RUNNING = 1; MW_ERR[0] = 0; MW_T0 = now_s(); MW_ELAPSED = 0; MW_TARGET = MW_IT + A->iterations;
    pthread_mutex_unlock(&MW_MU);
    respond_ok(s); return 1;
  }
  pthread_mutex_unlock(&MW_MU);
  respond_err(s, 404, "Not found"); return 1;
}

static pthread_mutex_t CUDA_MU = PTHREAD_MUTEX_INITIALIZER; static JB CUDA_INFO;
static void api(sock_t s, const char *method, const char *path, const char *body, size_t blen) {
  if (mw_api(s, method, path, body, blen)) return;
  char err[512] = "";
  if(!strncmp(path,"/api/checkpoint/",16)){checkpoint_api(s,method,path+16,NULL);return;}
  if (!strcmp(path, "/api/info")) {
    JB b; jb_init(&b);
    jb_printf(&b, "{\"native\":true,\"build\":\"%s\",\"version\":\"%s\",\"threads\":%d,\"power\":%d,\"ramMB\":%.0f,\"engine\":\"%s\",\"saveDir\":", EM_BUILD_ID, VERSION, THREADS, POWER, RAM_MB, VT->name);
    jb_str(&b, SAVE_DIR);
    jb_printf(&b,",\"physicalCores\":%d,\"performanceCores\":%d,\"efficiencyCores\":%d",PHYSICAL_CORES,PERFORMANCE_CORES,EFFICIENCY_CORES);
    jb_printf(&b,",\"multiwayProtocol\":%d",MW_PROTOCOL); jb_printf(&b,",\"logicalCPUs\":%d,\"processLimitMiB\":%ld,\"residentMiB\":%.2f",LOGICAL_CPUS,PROCESS_LIMIT_MIB,resident_mib()); jb_puts(&b, ",\"hasGame\":"); jb_puts(&b, G ? "true" : "false");
    jb_puts(&b, ",\"gpu\":"); VT->gpu_info(NULL, &b);
    jb_printf(&b, ",\"multiwaySpecProtocols\":[1,3,4]");
    /* 3.1: CUDA probe for the multiway engine, cached after the first request. */
    pthread_mutex_lock(&CUDA_MU);
    if (!CUDA_INFO.s) { jb_init(&CUDA_INFO); mw_cuda_info(&CUDA_INFO); }
    jb_puts(&b, ",\"cuda\":"); jb_puts(&b, CUDA_INFO.s ? CUDA_INFO.s : "null");
    pthread_mutex_unlock(&CUDA_MU);
    jb_putc(&b, '}');
    respond_json(s, 200, &b); jb_free(&b); return;
  }
  if (!strcmp(path, "/api/equity") && !strcmp(method, "POST")) {
    /* Exact multiway all-in equity (CPU, GPU or both with an exact comparison). */
    char err[256] = ""; JB b; jb_init(&b);
    if (!body || !mw_equity(body, blen, &b, err, sizeof err)) { jb_free(&b); respond_err(s, 400, err[0] ? err : "Invalid equity request"); return; }
    respond_json(s, 200, &b); jb_free(&b); return;
  }
  if (!strcmp(path, "/api/status")) {
    JB b; jb_init(&b);
    pthread_mutex_lock(&STATE_MU);
    jb_printf(&b, "{\"running\":%s,\"kind\":%d,\"it\":%d,\"done\":%s,\"stopped\":%s,\"ex\":", JOB_RUNNING ? "true" : "false", JOB_KIND, P_IT, P_DONE ? "true" : "false", P_STOPPED ? "true" : "false");
    if (P_EX >= 0) jb_num(&b, P_EX, 4); else jb_puts(&b, "null");
    jb_printf(&b,",\"residentMiB\":%.2f",resident_mib());
    jb_puts(&b, ",\"chips\":"); jb_num(&b, P_CHIPS, 4); jb_puts(&b, ",\"elapsed\":"); jb_num(&b, P_ELAPSED, 2);
    jb_puts(&b, ",\"error\":"); if (P_ERR[0]) jb_str(&b, P_ERR); else jb_puts(&b, "null");
    jb_printf(&b, ",\"engine\":\"native-%s\",\"gpu\":", VT->name); jb_puts(&b, P_GPU[0] ? P_GPU : "null"); jb_putc(&b, '}');
    pthread_mutex_unlock(&STATE_MU);
    respond_json(s, 200, &b); jb_free(&b); return;
  }
  if (!strcmp(path, "/api/report") && !strcmp(method, "GET")) {
    JB b; jb_init(&b);
    pthread_mutex_lock(&STATE_MU);
    jb_printf(&b, "{\"running\":%s,\"done\":%d,\"total\":%d,\"stopped\":%s,\"error\":", JOB_RUNNING && JOB_KIND == 2 ? "true" : "false", R_DONE, R_TOTAL, P_STOPPED ? "true" : "false");
    if (P_ERR[0]) jb_str(&b, P_ERR); else jb_puts(&b, "null");
    jb_printf(&b, ",\"current\":{\"flop\":[%d,%d,%d],\"it\":%d,\"ex\":", R_CUR_FLOP[0], R_CUR_FLOP[1], R_CUR_FLOP[2], R_CUR_IT);
    if (R_CUR_EX >= 0) jb_num(&b, R_CUR_EX, 3); else jb_puts(&b, "null");
    jb_puts(&b, "},\"results\":["); if (R_RESULTS.s) jb_puts(&b, R_RESULTS.s); jb_puts(&b, "]}");
    pthread_mutex_unlock(&STATE_MU);
    respond_json(s, 200, &b); jb_free(&b); return;
  }
  if (!strcmp(path, "/api/saves")) {
    JB b; jb_init(&b); jb_putc(&b, '['); int n = 0;
#ifdef _WIN32
    char pat[1100]; snprintf(pat, sizeof pat, "%s\\*.em8", SAVE_DIR);
    WIN32_FIND_DATAA fd; HANDLE h = FindFirstFileA(pat, &fd);
    if (h != INVALID_HANDLE_VALUE) {
      do {
        char nm[300]; snprintf(nm, sizeof nm, "%s", fd.cFileName); size_t L = strlen(nm); if (L > 4) nm[L - 4] = 0;
        ULARGE_INTEGER sz; sz.LowPart = fd.nFileSizeLow; sz.HighPart = fd.nFileSizeHigh;
        ULARGE_INTEGER ft; ft.LowPart = fd.ftLastWriteTime.dwLowDateTime; ft.HighPart = fd.ftLastWriteTime.dwHighDateTime;
        double unix_s = (double)(ft.QuadPart / 10000000ULL) - 11644473600.0;
        if (n++) jb_putc(&b, ',');
        jb_puts(&b, "{\"name\":"); jb_str(&b, nm); jb_printf(&b, ",\"bytes\":%.0f,\"time\":%.0f}", (double)sz.QuadPart, unix_s);
      } while (FindNextFileA(h, &fd));
      FindClose(h);
    }
#else
    DIR *d = opendir(SAVE_DIR);
    if (d) {
      struct dirent *e;
      while ((e = readdir(d))) {
        size_t L = strlen(e->d_name); if (L < 5 || strcmp(e->d_name + L - 4, ".em8")) continue;
        char full[1400]; snprintf(full, sizeof full, "%s/%s", SAVE_DIR, e->d_name); struct stat stt; if (stat(full, &stt)) continue;
        char nm[300]; snprintf(nm, sizeof nm, "%s", e->d_name); nm[L - 4] = 0;
        if (n++) jb_putc(&b, ',');
        jb_puts(&b, "{\"name\":"); jb_str(&b, nm); jb_printf(&b, ",\"bytes\":%.0f,\"time\":%.0f}", (double)stt.st_size, (double)stt.st_mtime);
      }
      closedir(d);
    }
#endif
    jb_putc(&b, ']'); respond_json(s, 200, &b); jb_free(&b); return;
  }
  if (strcmp(method, "POST")) { respond_err(s, 404, "Not found"); return; }

  if (!strcmp(path, "/api/stop") || !strcmp(path, "/api/report/stop")) { JOB_STOP = 1; respond_ok(s); return; }
  JV *v = json_parse(body ? body : "{}", body ? blen : 2, err, sizeof err);
  if (!v) { respond_err(s, 400, err); return; }
  if (!strcmp(path, "/api/build")) {
    GameCfg cfg;
    if (!solver_parse_cfg(body, &cfg, err, sizeof err)) { json_free(v); respond_err(s, 400, err); return; }
    if (!claim_game()) { json_free(v); respond_err(s, 409, "Stop the current solve first"); return; }
    pthread_mutex_lock(&GAME_MU);
    if (G) { VT->free_game(G); G = NULL; }
    free(G_CFG); G_CFG = NULL; LAST_EX = -1;
    G = VT->build(&cfg, err, sizeof err);
    if (G && body) { G_CFG = (char *)malloc(blen + 1); if (G_CFG) { memcpy(G_CFG, body, blen); G_CFG[blen] = 0; } }
    JB b; jb_init(&b);
    if (G) { game_meta(&b, G); jb_putc(&b, '}'); }
    const int built = G != NULL;
    pthread_mutex_unlock(&GAME_MU);
    release_game();
    if (built) respond_json(s, 200, &b); else respond_err(s, 400, err);
    jb_free(&b); json_free(v); return;
  }
  if (!strcmp(path, "/api/estimate")) {
    // build the tree to report its size, without touching the loaded solution
    GameCfg cfg;
    if (!solver_parse_cfg(body, &cfg, err, sizeof err)) { json_free(v); respond_err(s, 400, err); return; }
    json_free(v);
    Game *g = VT->build(&cfg, err, sizeof err);
    if (!g) { respond_err(s, 400, err); return; }
    JB b; jb_init(&b); jb_puts(&b, "{\"stats\":"); VT->stats(g, &b); jb_putc(&b, '}');
    VT->free_game(g);
    respond_json(s, 200, &b); jb_free(&b); return;
  }
  if (!strcmp(path, "/api/solve")) {
    if (!G) { json_free(v); respond_err(s, 400, "Set up the spot first"); return; }
    SolveArgs *A = (SolveArgs *)malloc(sizeof *A);
    if (!A) { json_free(v); respond_err(s, 503, "Out of memory"); return; }
    A->target = jnum(jget(v, "target"), 0.5); A->maxIter = (int)jnum(jget(v, "maxIter"), 1000); A->reset = (int)jnum(jget(v, "reset"), 0);
    int power=jget(v,"power")?(int)jnum(jget(v,"power"),1):-1;
    if (A->maxIter < 1) A->maxIter = 1;
    if (A->maxIter > 49000) A->maxIter = 49000;
    json_free(v);
    int rc=start_job(solve_job,A,1,power);
    if (rc!=200) { free(A); respond_err(s, rc, rc==503?"Could not start solve thread":"A solve is already running"); return; }
    respond_ok(s); return;
  }
  if (!strcmp(path, "/api/node")) {
    int pth[64]; int n = path_from(v, pth, 64); json_free(v);
    if (!G) { respond_err(s, 400, "No solution loaded"); return; }
    JB b; jb_init(&b);
    pthread_mutex_lock(&GAME_MU);
    int ok = VT->node_info(G, pth, n, 1, &b, err, sizeof err);
    pthread_mutex_unlock(&GAME_MU);
    if (ok) respond_json(s, 200, &b); else respond_err(s, 400, err);
    jb_free(&b); return;
  }
  if (!strcmp(path, "/api/runouts")) {
    int pth[64]; int n = path_from(v, pth, 64); json_free(v);
    if (!G) { respond_err(s, 400, "No solution loaded"); return; }
    JB b; jb_init(&b);
    pthread_mutex_lock(&GAME_MU);
    int ok = VT->runouts(G, pth, n, &b, err, sizeof err);
    pthread_mutex_unlock(&GAME_MU);
    if (ok) respond_json(s, 200, &b); else respond_err(s, 400, err);
    jb_free(&b); return;
  }
  if (!strcmp(path, "/api/lock")) {
    int pth[64]; int n = path_from(v, pth, 64);
    JV *st = jget(v, "strategy");
    float *arr = NULL; int na = 0;
    if (st && st->type == J_ARR) { na = st->n; arr = (float *)malloc(sizeof(float) * (size_t)(na ? na : 1)); for (int i = 0; i < na; i++) arr[i] = (float)jnum(st->items[i], 0); }
    json_free(v);
    if (!G) { free(arr); respond_err(s, 400, "No solution loaded"); return; }
    if (!claim_game()) { free(arr); respond_err(s, 409, "Stop the current solve first"); return; }
    pthread_mutex_lock(&GAME_MU);
    int ok = VT->lock(G, pth, n, arr, na, err, sizeof err);
    int nl = VT->nlocks(G);
    pthread_mutex_unlock(&GAME_MU);
    release_game();
    free(arr);
    if (!ok) { respond_err(s, 400, err); return; }
    JB b; jb_init(&b); jb_printf(&b, "{\"ok\":true,\"locks\":%d}", nl); respond_json(s, 200, &b); jb_free(&b); return;
  }
  if (!strcmp(path, "/api/save")) {
    char nm[128];
    int good = safe_name(jstr(jget(v, "name")) ? jstr(jget(v, "name")) : "", nm, sizeof nm); json_free(v);
    if (!good) { respond_err(s, 400, "Use letters, numbers, spaces and dashes in the name, and not a reserved Windows name such as CON or NUL"); return; }
    if (!G) { respond_err(s, 400, "Nothing to save yet"); return; }
    if (!claim_game()) { respond_err(s, 409, "Stop the current solve first"); return; }
    char file[1400]; snprintf(file, sizeof file, "%s" PATHSEP "%s.em8", SAVE_DIR, nm);
    pthread_mutex_lock(&GAME_MU);
    int ok = VT->save(G, file, G_CFG, LAST_EX, err, sizeof err);
    pthread_mutex_unlock(&GAME_MU);
    release_game();
    if (!ok) { respond_err(s, strncmp(err, "Nothing to save", 15) ? 500 : 400, strncmp(err, "Nothing to save", 15) ? err : "Solve the spot before saving it"); return; }
    JB b; jb_init(&b); jb_puts(&b, "{\"ok\":true,\"file\":"); jb_str(&b, file); jb_putc(&b, '}'); respond_json(s, 200, &b); jb_free(&b); return;
  }
  if (!strcmp(path, "/api/load") || !strcmp(path, "/api/delete")) {
    char nm[128];
    int good = safe_name(jstr(jget(v, "name")) ? jstr(jget(v, "name")) : "", nm, sizeof nm); json_free(v);
    if (!good) { respond_err(s, 400, "Bad name"); return; }
    if (!claim_game()) { respond_err(s, 409, "Stop the current solve first"); return; }
    char file[1400]; snprintf(file, sizeof file, "%s" PATHSEP "%s.em8", SAVE_DIR, nm);
    if (!strcmp(path, "/api/delete")) { release_game(); if (remove(file)) respond_err(s, 404, "Could not delete that file"); else respond_ok(s); return; }
    char *cfgJson = NULL; double ex = -1;
    pthread_mutex_lock(&GAME_MU);
    Game *g = VT->load(file, &cfgJson, &ex, err, sizeof err);
    JB b; jb_init(&b);
    if (g) {
      if (G) VT->free_game(G);
      G = g; free(G_CFG); G_CFG = cfgJson; LAST_EX = ex;
      game_meta(&b, G); jb_puts(&b, ",\"cfg\":"); jb_puts(&b, G_CFG); jb_printf(&b, ",\"it\":%d,\"ex\":", VT->iterations(G)); jb_num(&b, ex, 4); jb_putc(&b, '}');
      pthread_mutex_lock(&STATE_MU); P_IT = VT->iterations(G); P_EX = ex; P_DONE = 1; pthread_mutex_unlock(&STATE_MU);
    }
    pthread_mutex_unlock(&GAME_MU);
    release_game();
    if (g) respond_json(s, 200, &b); else respond_err(s, 400, err);
    jb_free(&b); return;
  }
  if (!strcmp(path, "/api/report")) {
    JV *cfgv = jget(v, "cfg"), *fl = jget(v, "flops");
    if (!cfgv || !fl || fl->type != J_ARR || !fl->n) { json_free(v); respond_err(s, 400, "Report needs a spot and flops"); return; }
    // re-serialise the cfg object for the shared parser
    JB cj; jb_init(&cj);
    {
      // the cfg was sent as a JSON string to keep parsing in one place
      const char *raw = jstr(cfgv);
      if (raw) jb_puts(&cj, raw);
    }
    ReportArgs *A = (ReportArgs *)calloc(1, sizeof *A);
    if(!A){jb_free(&cj);json_free(v);respond_err(s,503,"Out of memory");return;}
    if (!cj.n || !solver_parse_cfg(cj.s, &A->base, err, sizeof err)) { jb_free(&cj); json_free(v); free(A); respond_err(s, 400, err[0] ? err : "Bad spot"); return; }
    jb_free(&cj);
    A->n = fl->n; A->flops = (int (*)[4])malloc(sizeof(int[4]) * (size_t)fl->n);
    if(!A->flops){free(A);json_free(v);respond_err(s,503,"Out of memory");return;}
    for (int i = 0; i < fl->n; i++) for (int k = 0; k < 4; k++) A->flops[i][k] = (int)jnum(fl->items[i]->type == J_ARR && k < fl->items[i]->n ? fl->items[i]->items[k] : NULL, 1);
    A->target = jnum(jget(v, "target"), 1); A->maxIter = (int)jnum(jget(v, "maxIter"), 300);
    if (A->maxIter < 1) A->maxIter = 1;
    if (A->maxIter > 49000) A->maxIter = 49000;
    int power=jget(v,"power")?(int)jnum(jget(v,"power"),1):-1;
    json_free(v);
    int rc=start_job(report_job,A,2,power);
    if (rc!=200) { free(A->flops); free(A); respond_err(s, rc, rc==503?"Could not start report thread":"Another job is running"); return; }
    respond_ok(s); return;
  }
  json_free(v);
  respond_err(s, 404, "Not found");
}

static pthread_mutex_t checkpoint_body_mu=PTHREAD_MUTEX_INITIALIZER;
static void handle(sock_t s) {
  size_t cap = 65536, n = 0; char *buf = (char *)malloc(cap + 1);
  if(!buf){respond_err(s,503,"Out of memory");return;}
  char *hend = NULL;
  while (!hend) {
    if (n >= cap) { free(buf); return; }
    int k = recv(s, buf + n, (int)(cap - n), 0);
    if (k <= 0) { free(buf); return; }
    n += (size_t)k; buf[n] = 0;
    hend = strstr(buf, "\r\n\r\n");
  }
  size_t hlen = (size_t)(hend - buf) + 4;
  char method[8] = "", path[256] = "";
  if (sscanf(buf, "%7s %255s", method, path) != 2) { free(buf); return; }
  int checkpoint=0; size_t blen=0;
  // only same-machine pages may talk to us: check Host, and require a custom header on POST
  const char *host = find_header(buf, "Host");
  char want1[64], want2[64];
  snprintf(want1, sizeof want1, "127.0.0.1:%d", PORT); snprintf(want2, sizeof want2, "localhost:%d", PORT);
  // exact match only: a prefix test would also accept hosts such as "127.0.0.1:8708.example"
  size_t hostLen = 0; if (host) while (host[hostLen] && host[hostLen] != '\r' && host[hostLen] != '\n') hostLen++;
  while (hostLen && (host[hostLen - 1] == ' ' || host[hostLen - 1] == '\t')) hostLen--;
  if (!host || !((hostLen == strlen(want1) && !strncmp(host, want1, hostLen)) || (hostLen == strlen(want2) && !strncasecmp(host, want2, hostLen)))) { respond_err(s, 403, "Forbidden host"); goto finish_request; }
  char *q = strchr(path, '?'); if (q) *q = 0;
  int post=!strcmp(method,"POST");
  if(post){const char *token=find_header(buf,"X-EightMax");if(!token||strncmp(token,"1\r\n",3)){respond_err(s,403,"Missing app header");goto finish_request;}}
  const char *cl=find_header(buf,"Content-Length"),*te=find_header(buf,"Transfer-Encoding");
  if(cl){size_t d=strspn(cl,"0123456789");errno=0;unsigned long long value=strtoull(cl,NULL,10);
    if(!d||errno||value>SIZE_MAX||strncmp(cl+d,"\r\n",2)||find_header(cl+d+2,"Content-Length")){respond_err(s,400,"Invalid Content-Length");goto finish_request;}blen=(size_t)value;
  }
  if(!strcmp(path,"/api/checkpoint/progress") && !post){
    char report[224];int k=snprintf(report,sizeof report,"{\"phase\":\"%s\",\"active\":%s,\"receivedBytes\":%llu,\"expectedBytes\":%llu}",cp_phases[atomic_load(&cp_phase)],atomic_load(&cp_active)?"true":"false",atomic_load(&cp_progress),atomic_load(&cp_expected));respond(s,200,"application/json",report,k);goto finish_request;
  }
  if(!strcmp(path,"/api/checkpoint/cancel") && post){if(atomic_load(&cp_active))atomic_store(&cp_cancel,1);respond_ok(s);goto finish_request;}
  int nativeUpload=!strcmp(path,"/api/checkpoint/native-upload");
  if(post && !strncmp(path,"/api/checkpoint/native-",23) && !nativeUpload){
    if(te||blen||n!=hlen){respond_err(s,400,"Native checkpoint command requires an empty body");goto finish_request;}
    if(pthread_mutex_trylock(&checkpoint_body_mu)){respond_err(s,409,"Another checkpoint operation is active");goto finish_request;}
    checkpoint=1;cp_begin(0);checkpoint_api(s,method,path+16,NULL);goto finish_request;
  }
  if(post && (!strcmp(path,"/api/checkpoint/write")||nativeUpload)){
    if((!!cl==!!te)||(cl&&n-hlen>blen)||(te&&(strncasecmp(te,"chunked\r\n",9)||find_header(te+9,"Transfer-Encoding")))){respond_err(s,400,"Invalid checkpoint transfer framing");goto finish_request;}
    if(blen>cp_limit()){respond_err(s,413,"Checkpoint exceeds configured storage limit");goto finish_request;}
    if(pthread_mutex_trylock(&checkpoint_body_mu)){respond_err(s,503,"Another checkpoint write is in progress");goto finish_request;}
    checkpoint=1;cp_begin(blen);
    CpRequest request={.socket=s,.initial=buf+hlen,.available=n-hlen,.length=blen,.chunked=te!=NULL};
    checkpoint_api(s,method,nativeUpload?"native-upload":"write",&request);goto finish_request;
  }
  size_t limit=64u<<20;
  if(!strcmp(path,"/api/mw/import")){double mib=fmin(2048,APP_LIMIT_MIB/2.0);if(mib>64)limit=(size_t)(mib*1048576);}
  if(te||blen>limit||n-hlen>blen){respond_err(s,400,"Invalid request length or transfer framing");goto finish_request;}
  if(hlen+blen>cap){char *grown=realloc(buf,hlen+blen+1);if(!grown){respond_err(s,503,"Out of memory");goto finish_request;}buf=grown;}
  while(n<hlen+blen){int k=recv(s,buf+n,(int)fmin(hlen+blen-n,1048576),0);if(k<=0){respond_err(s,400,"Incomplete request body");goto finish_request;}n+=k;}
  buf[hlen+blen]=0;
  if (!strcmp(method, "GET") && (!strcmp(path, "/") || !strcmp(path, "/index.html"))) {
    respond(s, 200, "text/html; charset=utf-8", (const char *)UI_HTML, UI_HTML_LEN);
  } else if (!strncmp(path, "/api/", 5)) {
    if (!strcmp(method, "POST")) {
      const char *x = find_header(buf, "X-EightMax");
      if (!x || x[0] != '1') { respond_err(s, 403, "Missing app header"); goto finish_request; }
    }
    api(s, method, path, blen ? buf + hlen : NULL, blen);
  } else if (!strcmp(path, "/favicon.ico")) {
    respond(s, 404, "text/plain", "", 0);
  } else respond_err(s, 404, "Not found");
finish_request:
  if(checkpoint){atomic_store(&cp_active,0);pthread_mutex_unlock(&checkpoint_body_mu);}
  free(buf);
}
static _Atomic int http_connections=0;
static void *conn_main(void *a) {
  sock_t s = (sock_t)(intptr_t)a;
  cp_socket_timeout(s,SO_RCVTIMEO,15);
  handle(s);
#ifdef _WIN32
  shutdown(s, SD_SEND);
#else
  shutdown(s, SHUT_WR);
#endif
  CLOSESOCK(s);atomic_fetch_sub(&http_connections,1);
  return NULL;
}

static int cpu_has_avx2(void) {
#if defined(__x86_64__) || defined(_M_X64)
  __builtin_cpu_init();
  return __builtin_cpu_supports("avx2") && __builtin_cpu_supports("fma");
#else
  return 0;
#endif
}

int gpu_selftest(const SolverVT *VT);
int main(int argc, char **argv) {
    if(argc==2 && !strcmp(argv[1],"--build-id")) { puts("EightMaxBuild=" EM_BUILD_ID); return 0; }
  int noBrowser = 0, wantPort = 8708, gpuTest = 0;
  for (int i = 1; i < argc; i++) { if (!strcmp(argv[i], "--no-browser")) noBrowser = 1; else if (!strncmp(argv[i], "--port=", 7)) wantPort = atoi(argv[i] + 7); else if (!strcmp(argv[i], "--gpu-test")) gpuTest = 1; }
#ifdef _WIN32
  WSADATA wsa; WSAStartup(MAKEWORD(2, 2), &wsa);
  SYSTEM_INFO si; GetSystemInfo(&si); THREADS = (int)si.dwNumberOfProcessors;
  DWORD_PTR affinity=0,systemMask=0;
  if(GetProcessAffinityMask(GetCurrentProcess(),&affinity,&systemMask)&&affinity)THREADS=__builtin_popcountll((unsigned long long)affinity);
  detect_core_classes();
  MEMORYSTATUSEX ms; ms.dwLength = sizeof ms; GlobalMemoryStatusEx(&ms); RAM_MB = (double)ms.ullTotalPhys / 1048576.0;
  SetConsoleTitleA("EightMax solver");
#else
  signal(SIGPIPE, SIG_IGN);
  THREADS = (int)sysconf(_SC_NPROCESSORS_ONLN); RAM_MB = (double)sysconf(_SC_PHYS_PAGES) * (double)sysconf(_SC_PAGESIZE) / 1048576.0;
#endif
  LOGICAL_CPUS=THREADS>0?THREADS:1;
  const char *limit=getenv("EIGHTMAX_PROCESS_MIB");
  if(limit){char *end=NULL;long value=strtol(limit,&end,10);
    if(end==limit||*end||value<64||value>32768){fprintf(stderr,"EIGHTMAX_PROCESS_MIB must be 64 to 32768\n");return 2;}
    PROCESS_LIMIT_MIB=value;
  }
  APP_LIMIT_MIB=(long)(RAM_MB/2);if(APP_LIMIT_MIB>8192)APP_LIMIT_MIB=8192;if(APP_LIMIT_MIB<512)APP_LIMIT_MIB=512;
  const char *app=getenv("EIGHTMAX_APP_MIB");
  if(app){char *end=NULL;long value=strtol(app,&end,10);
    if(end==app||*end||value<256||value>65536){fprintf(stderr,"EIGHTMAX_APP_MIB must be 256 to 65536\n");return 2;}
    APP_LIMIT_MIB=value;
  }
  if(PROCESS_LIMIT_MIB>APP_LIMIT_MIB)PROCESS_LIMIT_MIB=APP_LIMIT_MIB;
  const char *te = getenv("EIGHTMAX_THREADS");
  if(te){char *end=NULL;long requested=strtol(te,&end,10);
    if(end==te || *end || requested<1 || requested>256){fprintf(stderr,"EIGHTMAX_THREADS must be an integer from 1 to 256\n");return 2;}
    THREADS=requested>LOGICAL_CPUS?LOGICAL_CPUS:(int)requested;
  }
  if (THREADS < 1) THREADS = 1;
#ifdef EM_DUAL
  VT = cpu_has_avx2() ? solver_vt_avx2() : solver_vt_sse();
#else
  (void)cpu_has_avx2; VT = solver_vt_gen();
#endif
  VT->init(THREADS);
  THREADS=VT->threads();
  gpu_init();
  apply_power(gpuTest ? 0 : 1);
  if (gpuTest) {
    const int rc = gpu_selftest(VT);
    fflush(stdout);
#ifdef _WIN32
    printf("\n  Press Enter to close.\n"); fflush(stdout); getchar();
#endif
    return rc;
  }
  if(!init_save_dir()){fprintf(stderr,"Save directory path too long\n");return 2;}
  jb_init(&R_RESULTS);
  sock_t ls = INVALID_SOCKET;
  for (int p = wantPort; p < wantPort + 20; p++) {
    ls = socket(AF_INET, SOCK_STREAM, 0);
    if (ls == INVALID_SOCKET) continue;
    struct sockaddr_in a; memset(&a, 0, sizeof a); a.sin_family = AF_INET; a.sin_port = htons((unsigned short)p); a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
#ifndef _WIN32
    int one = 1; setsockopt(ls, SOL_SOCKET, SO_REUSEADDR, (const char *)&one, sizeof one);
#endif
    if (bind(ls, (struct sockaddr *)&a, sizeof a) == 0 && listen(ls, 64) == 0) { PORT = p; break; }
    CLOSESOCK(ls); ls = INVALID_SOCKET;
  }
  if (ls == INVALID_SOCKET) { fprintf(stderr, "Could not open a local port (8708-8727).\n"); return 1; }
  char url[64]; snprintf(url, sizeof url, "http://127.0.0.1:%d/", PORT);
  printf("\n  EightMax %s (build %s)  -  8-max MTT solver\n  ------------------------------------------\n", VERSION, EM_BUILD_ID);
  printf("  Open:     %s\n  Engine:   %s, %d threads\n  GPU:      %s%s\n  Memory:   %.1f GB RAM\n  Saves:    %s\n\n  Keep this window open while you use EightMax. Close it to quit.\n\n",
    url, VT->name, THREADS, gpu_ready() ? "" : "none - ", gpu_desc(), RAM_MB / 1024.0, SAVE_DIR);
  fflush(stdout);
#ifdef _WIN32
  if (!noBrowser) ShellExecuteA(NULL, "open", url, NULL, NULL, SW_SHOWNORMAL);
#else
  (void)noBrowser;
#endif
  for (;;) {
    struct sockaddr_in ca; socklen_t cl = sizeof ca;
    sock_t c = accept(ls, (struct sockaddr *)&ca, &cl);
    if (c == INVALID_SOCKET) continue;
    if(atomic_fetch_add(&http_connections,1)>=32){
      atomic_fetch_sub(&http_connections,1);respond_err(c,503,"Desktop connection limit reached");CLOSESOCK(c);continue;
    }
    if(launch_thread(conn_main,(void *)(intptr_t)c,8<<20)){atomic_fetch_sub(&http_connections,1);CLOSESOCK(c);}
  }
  return 0;
}
