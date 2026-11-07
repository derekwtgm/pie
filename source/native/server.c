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
        unsigned c=row->Processor.EfficiencyClass;
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

static volatile int JOB_RUNNING = 0, JOB_STOP = 0;
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
static void init_save_dir(void) {
#ifdef _WIN32
  const char *home = getenv("USERPROFILE");
  if (home) { char docs[900]; snprintf(docs, sizeof docs, "%s\\Documents", home); ensure_dir(docs); snprintf(SAVE_DIR, sizeof SAVE_DIR, "%s\\EightMax", docs); }
  else snprintf(SAVE_DIR, sizeof SAVE_DIR, "EightMax solutions");
#else
  const char *home = getenv("HOME");
  snprintf(SAVE_DIR, sizeof SAVE_DIR, "%s/EightMax", home ? home : ".");
#endif
  ensure_dir(SAVE_DIR);
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
static int start_job(void *(*fn)(void *), void *arg, int kind) {
  pthread_mutex_lock(&STATE_MU);
  if (JOB_RUNNING || G_BUSY) { pthread_mutex_unlock(&STATE_MU); return 0; }
  JOB_RUNNING = 1; JOB_STOP = 0; JOB_KIND = kind; P_DONE = 0; P_STOPPED = 0; P_ERR[0] = 0; P_IT = 0; P_EX = -1; P_ELAPSED = 0; P_GPU[0] = 0;
  pthread_mutex_unlock(&STATE_MU);
  pthread_t th; pthread_attr_t at; pthread_attr_init(&at); pthread_attr_setdetachstate(&at, PTHREAD_CREATE_DETACHED);
  pthread_attr_setstacksize(&at, 16 << 20);
  pthread_create(&th, &at, fn, arg); pthread_attr_destroy(&at);
  return 1;
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
static pthread_mutex_t checkpoint_mu=PTHREAD_MUTEX_INITIALIZER;
static int move_checkpoint(const char *src,const char *dest){
#ifdef _WIN32
  return MoveFileExA(src,dest,MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)!=0;
#else
  return rename(src,dest)==0;
#endif
}
static void checkpoint_api(sock_t s,const char *method,const char *part,const char *body,size_t n){
  char latest[1200],previous[1200],tmp[1200];
  snprintf(latest,sizeof latest,"%s%sautosave.emstudy",SAVE_DIR,PATHSEP);
  snprintf(previous,sizeof previous,"%s%sautosave.previous.emstudy",SAVE_DIR,PATHSEP);
#ifdef _WIN32
  long pid=(long)GetCurrentProcessId();
#else
  long pid=(long)getpid();
#endif
  snprintf(tmp,sizeof tmp,"%s%sautosave.%ld.tmp",SAVE_DIR,PATHSEP,pid);
  if(!strcmp(method,"POST")&&!strcmp(part,"write")){
    if(!body||n<90||strncmp(body,"{\"sha256\":\"",11)||body[n-1]!='}'){
      respond_err(s,400,"Invalid checkpoint envelope");return;
    }
    pthread_mutex_lock(&checkpoint_mu);
    FILE *f=fopen(tmp,"wb");int ok=0;
    if(f){
      ok=fwrite(body,1,n,f)==n && fflush(f)==0;
#ifdef _WIN32
      if(ok)ok=_commit(_fileno(f))==0;
#else
      if(ok)ok=fsync(fileno(f))==0;
#endif
      if(fclose(f))ok=0;
    }
    if(ok){
      FILE *old=fopen(latest,"rb");
      if(old){fclose(old);ok=move_checkpoint(latest,previous);}
      if(ok)ok=move_checkpoint(tmp,latest);
#ifndef _WIN32
      if(ok){int fd=open(SAVE_DIR,O_RDONLY);if(fd>=0){ok=fsync(fd)==0;close(fd);}else ok=0;}
#endif
    }
    if(!ok)remove(tmp);
    pthread_mutex_unlock(&checkpoint_mu);
    if(ok)respond_ok(s);else respond_err(s,500,"Checkpoint write failed; recover previous save");return;
  }
  if(strcmp(method,"GET")||(strcmp(part,"latest")&&strcmp(part,"previous"))){respond_err(s,404,"Unknown checkpoint");return;}
  pthread_mutex_lock(&checkpoint_mu);
  FILE *f=fopen(!strcmp(part,"latest")?latest:previous,"rb");
  if(!f){pthread_mutex_unlock(&checkpoint_mu);respond_err(s,404,"No saved checkpoint");return;}
  long bytes=-1;if(fseek(f,0,SEEK_END)==0)bytes=ftell(f);
  char *data=NULL;
  if(bytes>0 && bytes<=(64L<<20) && fseek(f,0,SEEK_SET)==0)data=malloc((size_t)bytes);
  int ok=data && fread(data,1,(size_t)bytes,f)==(size_t)bytes;
  fclose(f);pthread_mutex_unlock(&checkpoint_mu);
  if(ok)respond(s,200,"application/json",data,(size_t)bytes);else respond_err(s,500,"Cannot read checkpoint");
  free(data);
}
static void api(sock_t s, const char *method, const char *path, const char *body, size_t blen) {
  char err[512] = "";
  if(!strncmp(path,"/api/checkpoint/",16)){checkpoint_api(s,method,path+16,body,blen);return;}
  if (!strcmp(path, "/api/info")) {
    JB b; jb_init(&b);
    jb_printf(&b, "{\"native\":true,\"build\":\"%s\",\"version\":\"%s\",\"threads\":%d,\"power\":%d,\"ramMB\":%.0f,\"engine\":\"%s\",\"saveDir\":", EM_BUILD_ID, VERSION, THREADS, POWER, RAM_MB, VT->name);
    jb_str(&b, SAVE_DIR);
    jb_printf(&b,",\"physicalCores\":%d,\"performanceCores\":%d,\"efficiencyCores\":%d",PHYSICAL_CORES,PERFORMANCE_CORES,EFFICIENCY_CORES);
    jb_printf(&b,",\"logicalCPUs\":%d,\"processLimitMiB\":%ld,\"residentMiB\":%.2f",LOGICAL_CPUS,PROCESS_LIMIT_MIB,resident_mib()); jb_puts(&b, ",\"hasGame\":"); jb_puts(&b, G ? "true" : "false");
    jb_puts(&b, ",\"gpu\":"); VT->gpu_info(NULL, &b); jb_putc(&b, '}');
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
    if (jget(v, "power")) apply_power((int)jnum(jget(v, "power"), 1));
    if (A->maxIter < 1) A->maxIter = 1;
    if (A->maxIter > 49000) A->maxIter = 49000;
    json_free(v);
    if (!start_job(solve_job, A, 1)) { free(A); respond_err(s, 409, "A solve is already running"); return; }
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
    if (!cj.n || !solver_parse_cfg(cj.s, &A->base, err, sizeof err)) { jb_free(&cj); json_free(v); free(A); respond_err(s, 400, err[0] ? err : "Bad spot"); return; }
    jb_free(&cj);
    A->n = fl->n; A->flops = (int (*)[4])malloc(sizeof(int[4]) * (size_t)fl->n);
    for (int i = 0; i < fl->n; i++) for (int k = 0; k < 4; k++) A->flops[i][k] = (int)jnum(fl->items[i]->type == J_ARR && k < fl->items[i]->n ? fl->items[i]->items[k] : NULL, 1);
    A->target = jnum(jget(v, "target"), 1); A->maxIter = (int)jnum(jget(v, "maxIter"), 300);
    if (A->maxIter < 1) A->maxIter = 1;
    if (A->maxIter > 49000) A->maxIter = 49000;
    if (jget(v, "power")) apply_power((int)jnum(jget(v, "power"), 1));
    json_free(v);
    pthread_mutex_lock(&STATE_MU); jb_free(&R_RESULTS); jb_init(&R_RESULTS); R_DONE = 0; R_TOTAL = A->n; R_CUR_IT = 0; R_CUR_EX = -1; pthread_mutex_unlock(&STATE_MU);
    if (!start_job(report_job, A, 2)) { free(A->flops); free(A); respond_err(s, 409, "Another job is running"); return; }
    respond_ok(s); return;
  }
  json_free(v);
  respond_err(s, 404, "Not found");
}

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
  const char *cl = find_header(buf, "Content-Length");
  size_t blen = cl ? (size_t)strtoul(cl, NULL, 10) : 0;
  if (blen > (64u << 20)) { respond_err(s, 400, "Request too large"); free(buf); return; }
  if (hlen + blen > cap) { cap = hlen + blen; char *grown = (char *)realloc(buf, cap + 1); if (!grown) { respond_err(s, 503, "Out of memory"); free(buf); return; } buf = grown; }
  while (n < hlen + blen) { int k = recv(s, buf + n, (int)(hlen + blen - n), 0); if (k <= 0) { free(buf); return; } n += (size_t)k; }
  buf[hlen + blen] = 0;
  // only same-machine pages may talk to us: check Host, and require a custom header on POST
  const char *host = find_header(buf, "Host");
  char want1[64], want2[64];
  snprintf(want1, sizeof want1, "127.0.0.1:%d", PORT); snprintf(want2, sizeof want2, "localhost:%d", PORT);
  // exact match only: a prefix test would also accept hosts such as "127.0.0.1:8708.example"
  size_t hostLen = 0; if (host) while (host[hostLen] && host[hostLen] != '\r' && host[hostLen] != '\n') hostLen++;
  while (hostLen && (host[hostLen - 1] == ' ' || host[hostLen - 1] == '\t')) hostLen--;
  if (!host || !((hostLen == strlen(want1) && !strncmp(host, want1, hostLen)) || (hostLen == strlen(want2) && !strncasecmp(host, want2, hostLen)))) { respond_err(s, 403, "Forbidden host"); free(buf); return; }
  char *q = strchr(path, '?'); if (q) *q = 0;
  if (!strcmp(method, "GET") && (!strcmp(path, "/") || !strcmp(path, "/index.html"))) {
    respond(s, 200, "text/html; charset=utf-8", (const char *)UI_HTML, UI_HTML_LEN);
  } else if (!strncmp(path, "/api/", 5)) {
    if (!strcmp(method, "POST")) {
      const char *x = find_header(buf, "X-EightMax");
      if (!x || x[0] != '1') { respond_err(s, 403, "Missing app header"); free(buf); return; }
    }
    api(s, method, path, blen ? buf + hlen : NULL, blen);
  } else if (!strcmp(path, "/favicon.ico")) {
    respond(s, 404, "text/plain", "", 0);
  } else respond_err(s, 404, "Not found");
  free(buf);
}
static void *conn_main(void *a) {
  sock_t s = (sock_t)(intptr_t)a;
  handle(s);
#ifdef _WIN32
  shutdown(s, SD_SEND);
#else
  shutdown(s, SHUT_WR);
#endif
  CLOSESOCK(s);
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
  init_save_dir();
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
    pthread_t th; pthread_attr_t at; pthread_attr_init(&at); pthread_attr_setdetachstate(&at, PTHREAD_CREATE_DETACHED);
    pthread_attr_setstacksize(&at, 8 << 20);
    if (pthread_create(&th, &at, conn_main, (void *)(intptr_t)c)) CLOSESOCK(c);
    pthread_attr_destroy(&at);
  }
  return 0;
}
