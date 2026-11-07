// GPU backend for the river phase of the postflop solver.
// OpenCL is loaded at run time (OpenCL.dll / libOpenCL.so.1), so the program starts and falls back
// to the CPU engine on machines without a GPU driver. EIGHTMAX_GPU=emu runs the same kernel source
// as C with one thread per work-item and real barriers (used by the tests).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <pthread.h>
#include <time.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmsystem.h>
#else
#include <dlfcn.h>
#endif
#include "gpu.h"
#include "gpu_cl_src.h"

#define EM_EMU
#include "gpu_emu.h"
#include "gpu_kernels.cl"
#undef barrier
static void emu_barrier(void) { pthread_barrier_wait(EMU_IT.bar); }

/* ---------------- minimal OpenCL 1.2 declarations ---------------- */
typedef int32_t cl_int; typedef uint32_t cl_uint; typedef uint64_t cl_ulong; typedef cl_uint cl_bool; typedef cl_ulong cl_bitfield;
typedef struct _cl_platform_id *cl_platform_id; typedef struct _cl_device_id *cl_device_id; typedef struct _cl_context *cl_context;
typedef struct _cl_command_queue *cl_command_queue; typedef struct _cl_mem *cl_mem; typedef struct _cl_program *cl_program;
typedef struct _cl_kernel *cl_kernel; typedef struct _cl_event *cl_event; typedef intptr_t cl_context_properties;
#ifdef _WIN32
#define CLAPI __stdcall
#else
#define CLAPI
#endif
#define CL_SUCCESS 0
#define CL_DEVICE_TYPE_GPU (1 << 2)
#define CL_DEVICE_MAX_COMPUTE_UNITS 0x1002
#define CL_DEVICE_MAX_WORK_GROUP_SIZE 0x1004
#define CL_DEVICE_MAX_MEM_ALLOC_SIZE 0x1010
#define CL_DEVICE_GLOBAL_MEM_SIZE 0x101F
#define CL_DEVICE_LOCAL_MEM_SIZE 0x1023
#define CL_DEVICE_AVAILABLE 0x1027
#define CL_DEVICE_NAME 0x102B
#define CL_DEVICE_VENDOR 0x102C
#define CL_DRIVER_VERSION 0x102D
#define CL_PLATFORM_NAME 0x0902
#define CL_CONTEXT_PLATFORM 0x1084
#define CL_MEM_READ_WRITE (1 << 0)
#define CL_MEM_ALLOC_HOST_PTR (1 << 4)
#define CL_MAP_READ (1 << 0)
#define CL_MAP_WRITE (1 << 1)
#define CL_PROGRAM_BUILD_LOG 0x1183
#define CL_KERNEL_WORK_GROUP_SIZE 0x11B0
#define CL_TRUE 1
#define CL_EVENT_COMMAND_EXECUTION_STATUS 0x11D3

typedef cl_int (CLAPI *t_clGetPlatformIDs)(cl_uint, cl_platform_id *, cl_uint *);
typedef cl_int (CLAPI *t_clGetPlatformInfo)(cl_platform_id, cl_uint, size_t, void *, size_t *);
typedef cl_int (CLAPI *t_clGetDeviceIDs)(cl_platform_id, cl_bitfield, cl_uint, cl_device_id *, cl_uint *);
typedef cl_int (CLAPI *t_clGetDeviceInfo)(cl_device_id, cl_uint, size_t, void *, size_t *);
typedef cl_context (CLAPI *t_clCreateContext)(const cl_context_properties *, cl_uint, const cl_device_id *, void *, void *, cl_int *);
typedef cl_command_queue (CLAPI *t_clCreateCommandQueue)(cl_context, cl_device_id, cl_bitfield, cl_int *);
typedef cl_program (CLAPI *t_clCreateProgramWithSource)(cl_context, cl_uint, const char **, const size_t *, cl_int *);
typedef cl_int (CLAPI *t_clBuildProgram)(cl_program, cl_uint, const cl_device_id *, const char *, void *, void *);
typedef cl_int (CLAPI *t_clGetProgramBuildInfo)(cl_program, cl_device_id, cl_uint, size_t, void *, size_t *);
typedef cl_kernel (CLAPI *t_clCreateKernel)(cl_program, const char *, cl_int *);
typedef cl_int (CLAPI *t_clGetKernelWorkGroupInfo)(cl_kernel, cl_device_id, cl_uint, size_t, void *, size_t *);
typedef cl_mem (CLAPI *t_clCreateBuffer)(cl_context, cl_bitfield, size_t, void *, cl_int *);
typedef cl_int (CLAPI *t_clReleaseMemObject)(cl_mem);
typedef cl_int (CLAPI *t_clSetKernelArg)(cl_kernel, cl_uint, size_t, const void *);
typedef cl_int (CLAPI *t_clEnqueueWriteBuffer)(cl_command_queue, cl_mem, cl_bool, size_t, size_t, const void *, cl_uint, const cl_event *, cl_event *);
typedef cl_int (CLAPI *t_clEnqueueReadBuffer)(cl_command_queue, cl_mem, cl_bool, size_t, size_t, void *, cl_uint, const cl_event *, cl_event *);
typedef cl_int (CLAPI *t_clEnqueueNDRangeKernel)(cl_command_queue, cl_kernel, cl_uint, const size_t *, const size_t *, const size_t *, cl_uint, const cl_event *, cl_event *);
typedef cl_int (CLAPI *t_clFinish)(cl_command_queue);
typedef void *(CLAPI *t_clEnqueueMapBuffer)(cl_command_queue, cl_mem, cl_bool, cl_bitfield, size_t, size_t, cl_uint, const cl_event *, cl_event *, cl_int *);
typedef cl_int (CLAPI *t_clEnqueueUnmapMemObject)(cl_command_queue, cl_mem, void *, cl_uint, const cl_event *, cl_event *);
typedef cl_int (CLAPI *t_clFlush)(cl_command_queue);
typedef cl_int (CLAPI *t_clGetEventInfo)(cl_event, cl_uint, size_t, void *, size_t *);
typedef cl_int (CLAPI *t_clReleaseEvent)(cl_event);
static struct {
  t_clGetPlatformIDs GetPlatformIDs; t_clGetPlatformInfo GetPlatformInfo; t_clGetDeviceIDs GetDeviceIDs; t_clGetDeviceInfo GetDeviceInfo;
  t_clCreateContext CreateContext; t_clCreateCommandQueue CreateCommandQueue; t_clCreateProgramWithSource CreateProgramWithSource;
  t_clBuildProgram BuildProgram; t_clGetProgramBuildInfo GetProgramBuildInfo; t_clCreateKernel CreateKernel;
  t_clGetKernelWorkGroupInfo GetKernelWorkGroupInfo; t_clCreateBuffer CreateBuffer; t_clReleaseMemObject ReleaseMemObject;
  t_clSetKernelArg SetKernelArg; t_clEnqueueWriteBuffer EnqueueWriteBuffer; t_clEnqueueReadBuffer EnqueueReadBuffer;
  t_clEnqueueNDRangeKernel EnqueueNDRangeKernel; t_clFinish Finish; t_clEnqueueMapBuffer EnqueueMapBuffer; t_clEnqueueUnmapMemObject EnqueueUnmapMemObject;
  t_clFlush Flush; t_clGetEventInfo GetEventInfo; t_clReleaseEvent ReleaseEvent;   // optional: waiting without a busy CPU core
} CL;

/* ---------------- state ---------------- */
struct GBuf { cl_mem m; void *p; size_t n; int pinned; };
static int READY = 0, EMU = 0, UNITS = 0, WG = 0, EMU_GROUPS = 0;
static double MEM_MB = 0, MAXALLOC_MB = 0;
static char DESC[256] = "not checked", ERR[512] = "";
static cl_context CTX; static cl_command_queue Q; static cl_program PROG; static cl_kernel KRN; static cl_device_id DEV;

int gpu_ready(void) { return READY; }
int gpu_is_emu(void) { return EMU; }
const char *gpu_desc(void) { return DESC; }
const char *gpu_error(void) { return ERR; }
double gpu_mem_mb(void) { return MEM_MB; }
double gpu_max_alloc_mb(void) { return MAXALLOC_MB; }
int gpu_units(void) { return UNITS; }
int gpu_wg(void) { return WG; }

static const char *clerr(cl_int e) {
  switch (e) {
    case -1: return "device not found"; case -2: return "device not available"; case -3: return "compiler not available";
    case -4: return "out of GPU memory"; case -5: return "out of resources"; case -6: return "out of host memory";
    case -11: return "kernel build failed"; case -30: return "invalid value"; case -36: return "invalid queue"; case -38: return "invalid buffer";
    case -48: return "invalid kernel"; case -51: return "invalid argument size"; case -52: return "invalid kernel arguments";
    case -54: return "invalid work-group size"; case -61: return "buffer too large"; case -1001: return "no OpenCL platform (driver missing)";
    default: return "OpenCL error";
  }
}
static int fail(const char *what, cl_int e) { snprintf(ERR, sizeof ERR, "%s: %s (%d)", what, clerr(e), (int)e); return 0; }

static void *load_cl(void) {
#ifdef _WIN32
  HMODULE h = LoadLibraryA("OpenCL.dll");
  return (void *)h;
#else
  void *h = dlopen("libOpenCL.so.1", RTLD_NOW | RTLD_LOCAL);
  if (!h) h = dlopen("libOpenCL.so", RTLD_NOW | RTLD_LOCAL);
  return h;
#endif
}
static void *sym(void *lib, const char *name) {
#ifdef _WIN32
  return (void *)GetProcAddress((HMODULE)lib, name);
#else
  return dlsym(lib, name);
#endif
}

static int init_emu(const char *spec) {
  // emu:WGxGROUPS[:MAXALLOC_MB[:MEM_MB]] (a small cap tests split buffers, a small memory the 16-bit fallback)
  int wg = 16, groups = 3; double maxAlloc = 2048, mem = 4096;
  if (spec[3] == ':') sscanf(spec + 4, "%dx%d:%lf:%lf", &wg, &groups, &maxAlloc, &mem);
  if (wg < 1) wg = 1;
  if (wg > 256) wg = 256;
  if (groups < 1) groups = 1;
  EMU = 1; READY = 1; WG = wg; UNITS = groups; EMU_GROUPS = groups; MEM_MB = mem > 0 ? mem : 4096; MAXALLOC_MB = maxAlloc > 0 ? maxAlloc : 2048;
  snprintf(DESC, sizeof DESC, "GPU emulator (%d x %d threads)", groups, wg);
  return 1;
}

int gpu_init(void) {
  static int done = 0;
  if (done) return READY;
  done = 1;
  const char *env = getenv("EIGHTMAX_GPU");
  if (env && !strcmp(env, "off")) { snprintf(DESC, sizeof DESC, "turned off (EIGHTMAX_GPU=off)"); return 0; }
  if (env && !strncmp(env, "emu", 3)) return init_emu(env);
  int want = env ? atoi(env) : -1;
  void *lib = load_cl();
  if (!lib) { snprintf(DESC, sizeof DESC, "no OpenCL driver found"); return 0; }
#define LD(n) if (!(*(void **)&CL.n = sym(lib, "cl" #n))) { snprintf(DESC, sizeof DESC, "OpenCL driver lacks cl" #n); return 0; }
  LD(GetPlatformIDs) LD(GetPlatformInfo) LD(GetDeviceIDs) LD(GetDeviceInfo) LD(CreateContext) LD(CreateCommandQueue)
  LD(CreateProgramWithSource) LD(BuildProgram) LD(GetProgramBuildInfo) LD(CreateKernel) LD(GetKernelWorkGroupInfo)
  LD(CreateBuffer) LD(ReleaseMemObject) LD(SetKernelArg) LD(EnqueueWriteBuffer) LD(EnqueueReadBuffer)
  LD(EnqueueNDRangeKernel) LD(Finish) LD(EnqueueMapBuffer) LD(EnqueueUnmapMemObject)
#undef LD
  *(void **)&CL.Flush = sym(lib, "clFlush"); *(void **)&CL.GetEventInfo = sym(lib, "clGetEventInfo"); *(void **)&CL.ReleaseEvent = sym(lib, "clReleaseEvent");
  cl_platform_id plats[16]; cl_uint np = 0;
  cl_int e = CL.GetPlatformIDs(16, plats, &np);
  if (e != CL_SUCCESS || !np) { snprintf(DESC, sizeof DESC, "no OpenCL platform (GPU driver missing?)"); return 0; }
  // pick the GPU with the most memory (or the one EIGHTMAX_GPU names by index)
  cl_device_id best = NULL; cl_platform_id bestP = NULL; cl_ulong bestMem = 0; int idx = 0;
  for (cl_uint i = 0; i < np && i < 16; i++) {
    cl_device_id devs[16]; cl_uint nd = 0;
    if (CL.GetDeviceIDs(plats[i], CL_DEVICE_TYPE_GPU, 16, devs, &nd) != CL_SUCCESS) continue;
    for (cl_uint j = 0; j < nd && j < 16; j++, idx++) {
      cl_bool av = 0; cl_ulong mem = 0;
      CL.GetDeviceInfo(devs[j], CL_DEVICE_AVAILABLE, sizeof av, &av, NULL);
      CL.GetDeviceInfo(devs[j], CL_DEVICE_GLOBAL_MEM_SIZE, sizeof mem, &mem, NULL);
      if (!av) continue;
      if ((want >= 0 && idx == want) || (want < 0 && mem > bestMem)) { best = devs[j]; bestP = plats[i]; bestMem = mem; if (want >= 0) break; }
    }
  }
  if (!best) { snprintf(DESC, sizeof DESC, "no OpenCL GPU found"); return 0; }
  DEV = best;
  char name[128] = "GPU"; cl_uint cu = 0; size_t mwg = 0; cl_ulong maxAlloc = 0, lmem = 0;
  CL.GetDeviceInfo(DEV, CL_DEVICE_NAME, sizeof name - 1, name, NULL); name[sizeof name - 1] = 0;
  CL.GetDeviceInfo(DEV, CL_DEVICE_MAX_COMPUTE_UNITS, sizeof cu, &cu, NULL);
  CL.GetDeviceInfo(DEV, CL_DEVICE_MAX_WORK_GROUP_SIZE, sizeof mwg, &mwg, NULL);
  CL.GetDeviceInfo(DEV, CL_DEVICE_MAX_MEM_ALLOC_SIZE, sizeof maxAlloc, &maxAlloc, NULL);
  CL.GetDeviceInfo(DEV, CL_DEVICE_LOCAL_MEM_SIZE, sizeof lmem, &lmem, NULL);
  for (char *s = name + strlen(name); s > name && s[-1] == ' '; ) *--s = 0;
  if (lmem < 24 * 1024) { snprintf(DESC, sizeof DESC, "%s has too little local memory", name); return 0; }
  cl_context_properties props[3] = { CL_CONTEXT_PLATFORM, (cl_context_properties)bestP, 0 };
  CTX = CL.CreateContext(props, 1, &DEV, NULL, NULL, &e);
  if (e != CL_SUCCESS || !CTX) { snprintf(DESC, sizeof DESC, "%s: cannot create an OpenCL context (%d)", name, (int)e); return 0; }
  Q = CL.CreateCommandQueue(CTX, DEV, 0, &e);
  if (e != CL_SUCCESS || !Q) { snprintf(DESC, sizeof DESC, "%s: cannot create a command queue (%d)", name, (int)e); return 0; }
  const char *src = GPU_CL_SRC; size_t len = strlen(src);
  PROG = CL.CreateProgramWithSource(CTX, 1, &src, &len, &e);
  if (e != CL_SUCCESS || !PROG) { snprintf(DESC, sizeof DESC, "%s: cannot load the kernel (%d)", name, (int)e); return 0; }
  e = CL.BuildProgram(PROG, 1, &DEV, "-cl-std=CL1.2", NULL, NULL);
  if (e != CL_SUCCESS) {
    char log[4096] = ""; CL.GetProgramBuildInfo(PROG, DEV, CL_PROGRAM_BUILD_LOG, sizeof log - 1, log, NULL); log[sizeof log - 1] = 0;
    fprintf(stderr, "GPU kernel build failed:\n%s\n", log);
    snprintf(DESC, sizeof DESC, "%s: kernel build failed (%d)", name, (int)e); return 0;
  }
  KRN = CL.CreateKernel(PROG, "river_solve", &e);
  if (e != CL_SUCCESS || !KRN) { snprintf(DESC, sizeof DESC, "%s: cannot create the kernel (%d)", name, (int)e); return 0; }
  size_t kwg = 0; CL.GetKernelWorkGroupInfo(KRN, DEV, CL_KERNEL_WORK_GROUP_SIZE, sizeof kwg, &kwg, NULL);
  size_t wg = 256;
  if (mwg && wg > mwg) wg = mwg;
  if (kwg && wg > kwg) wg = kwg;
  if (wg >= 64) wg &= ~(size_t)31;
  if (wg < 32) { snprintf(DESC, sizeof DESC, "%s: work-group too small (%d)", name, (int)wg); return 0; }
  WG = (int)wg; UNITS = cu ? (int)cu : 8;
  MEM_MB = (double)bestMem / 1048576.0; MAXALLOC_MB = (double)maxAlloc / 1048576.0;
  snprintf(DESC, sizeof DESC, "%s (%.0f MB)", name, MEM_MB);
  READY = 1;
  return 1;
}

/* ---------------- buffers ---------------- */
GBuf *gpu_alloc(size_t bytes) {
  if (!READY) return NULL;
  GBuf *b = (GBuf *)calloc(1, sizeof(GBuf));
  if (!b) return NULL;
  if (!bytes) bytes = 4;
  b->n = bytes;
  if (EMU) { b->p = calloc(1, bytes); if (!b->p) { free(b); snprintf(ERR, sizeof ERR, "out of memory"); return NULL; } return b; }
  cl_int e = 0;
  b->m = CL.CreateBuffer(CTX, CL_MEM_READ_WRITE, bytes, NULL, &e);
  if (e != CL_SUCCESS || !b->m) { fail("allocate GPU buffer", e); free(b); return NULL; }
  return b;
}
void gpu_free(GBuf *b) {
  if (!b) return;
  if (EMU) free(b->p); else if (b->m) CL.ReleaseMemObject(b->m);
  free(b);
}
int gpu_write(GBuf *b, size_t off, const void *src, size_t n) {
  if (!b || off + n > b->n) { snprintf(ERR, sizeof ERR, "GPU write out of range"); return 0; }
  if (!n) return 1;
  if (EMU) { memcpy((char *)b->p + off, src, n); return 1; }
  cl_int e = CL.EnqueueWriteBuffer(Q, b->m, CL_TRUE, off, n, src, 0, NULL, NULL);
  return e == CL_SUCCESS ? 1 : fail("upload to GPU", e);
}
int gpu_read(GBuf *b, size_t off, void *dst, size_t n) {
  if (!b || off + n > b->n) { snprintf(ERR, sizeof ERR, "GPU read out of range"); return 0; }
  if (!n) return 1;
  if (EMU) { memcpy(dst, (char *)b->p + off, n); return 1; }
  cl_int e = CL.EnqueueReadBuffer(Q, b->m, CL_TRUE, off, n, dst, 0, NULL, NULL);
  return e == CL_SUCCESS ? 1 : fail("download from GPU", e);
}
void *gpu_host_alloc(size_t bytes, GBuf **pin) {
  *pin = NULL;
  if (!bytes) bytes = 4;
  if (READY && !EMU) {
    cl_int e = 0;
    cl_mem m = CL.CreateBuffer(CTX, CL_MEM_READ_WRITE | CL_MEM_ALLOC_HOST_PTR, bytes, NULL, &e);
    if (e == CL_SUCCESS && m) {
      void *p = CL.EnqueueMapBuffer(Q, m, CL_TRUE, CL_MAP_READ | CL_MAP_WRITE, 0, bytes, 0, NULL, NULL, &e);
      GBuf *b = e == CL_SUCCESS && p ? (GBuf *)calloc(1, sizeof(GBuf)) : NULL;
      if (b) { b->m = m; b->p = p; b->n = bytes; b->pinned = 1; *pin = b; return p; }
      if (e == CL_SUCCESS && p) CL.EnqueueUnmapMemObject(Q, m, p, 0, NULL, NULL);
      CL.ReleaseMemObject(m);
    }
  }
  return malloc(bytes);
}
void gpu_host_free(void *p, GBuf *pin) {
  if (!pin) { free(p); return; }
  CL.EnqueueUnmapMemObject(Q, pin->m, pin->p, 0, NULL, NULL);
  CL.Finish(Q);
  CL.ReleaseMemObject(pin->m);
  free(pin);
}

/* ---------------- kernel launch ---------------- */
// kernel arguments in signature order: 0 buffer, 1 int, 2 float, 3 local (bytes)
typedef struct { int kind; GBuf *b; int i; float f; size_t bytes; } KA;
#define NARGS 59
static int build_args(const GRiver *a, KA *A) {
  int n = 0;
  GBuf *bufs[] = { a->TY, a->PL, a->NN, a->CS, a->CHN, a->DO, a->NX, a->NC0, a->NC1, a->SEND, a->RS, a->R0, a->S0, a->R1, a->S1, a->LR, a->LS, a->RSC, a->SSC,
    a->HL1, a->HL2, a->HSAME, a->HWOFF, a->HWDAT, a->BDAT, a->BOFF, a->BM, a->CDAT, a->COFF,
    a->SLOTS, a->ENT, a->EQV, a->PHD, a->PHO, a->REQ, a->RO, a->VOUT, a->SCR, a->SCRI, a->CTR, a->CUM, a->ICMT };
  for (size_t i = 0; i < sizeof bufs / sizeof bufs[0]; i++) { if (!bufs[i]) { snprintf(ERR, sizeof ERR, "missing GPU buffer %d", (int)i); return 0; } A[n].kind = 0; A[n++].b = bufs[i]; }
  A[n].kind = 3; A[n++].bytes = sizeof(float) * (3984 + 2 * (size_t)WG + 8);
  A[n].kind = 3; A[n++].bytes = sizeof(int) * 16;
  const int ints[] = { a->r1, a->p, a->mode, a->t, a->icm, a->maxSub, a->maxN, a->NP, a->NO, a->hoffP, (int)a->spl, a->comp };
  for (size_t i = 0; i < sizeof ints / sizeof ints[0]; i++) { A[n].kind = 1; A[n++].i = ints[i]; }
  const float fl[] = { a->gamma, a->P0H, a->w };
  for (size_t i = 0; i < sizeof fl / sizeof fl[0]; i++) { A[n].kind = 2; A[n++].f = fl[i]; }
  return n == NARGS;
}

// every work-item waits at a start gate until all threads exist (1 = run); if one can't be created the gate
// opens with 2 and everyone leaves, so no group is left waiting at a barrier for a missing thread
static pthread_mutex_t EMU_MU = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t EMU_CV = PTHREAD_COND_INITIALIZER;
typedef struct { EmuItem it; const KA *A; void *L, *LI; int *gate; } EmuTask;
static void *emu_main(void *arg) {
  EmuTask *T = (EmuTask *)arg;
  pthread_mutex_lock(&EMU_MU);
  while (*T->gate == 0) pthread_cond_wait(&EMU_CV, &EMU_MU);
  const int go = *T->gate == 1;
  pthread_mutex_unlock(&EMU_MU);
  if (!go) return NULL;
  EMU_IT = T->it;
  const KA *A = T->A;
#define B(k) (A[k].b->p)
#define I(k) (A[k].i)
#define F(k) (A[k].f)
  river_solve(B(0), B(1), B(2), B(3), B(4), B(5), B(6), B(7), B(8), B(9), B(10), B(11), B(12), B(13), B(14), B(15), B(16), B(17), B(18),
    B(19), B(20), B(21), B(22), B(23), B(24), B(25), B(26), B(27), B(28),
    B(29), B(30), B(31), B(32), B(33), B(34), B(35), B(36), B(37), B(38), B(39), B(40), B(41),
    T->L, T->LI,
    I(44), I(45), I(46), I(47), I(48), I(49), I(50), I(51), I(52), I(53), (unsigned)I(54), I(55), F(56), F(57), F(58));
#undef B
#undef I
#undef F
  return NULL;
}
static int emu_run(const KA *A, int groups) {
  const int wg = WG, nt = groups * wg;
  pthread_t *th = (pthread_t *)calloc((size_t)nt, sizeof(pthread_t));
  EmuTask *tk = (EmuTask *)calloc((size_t)nt, sizeof(EmuTask));
  pthread_barrier_t *bar = (pthread_barrier_t *)calloc((size_t)groups, sizeof(pthread_barrier_t));
  void **L = (void **)calloc((size_t)groups * 2, sizeof(void *));
  int gate = 0, made = 0;
  for (int g = 0; g < groups; g++) { pthread_barrier_init(&bar[g], NULL, (unsigned)wg); L[2 * g] = calloc(1, A[42].bytes); L[2 * g + 1] = calloc(1, A[43].bytes); }
  pthread_attr_t at; pthread_attr_init(&at); pthread_attr_setstacksize(&at, 256 << 10);
  for (int i = 0; i < nt; i++) {
    const int g = i / wg;
    tk[i].it.lid = i % wg; tk[i].it.wg = wg; tk[i].it.grp = g; tk[i].it.ng = groups; tk[i].it.bar = &bar[g];
    tk[i].A = A; tk[i].L = L[2 * g]; tk[i].LI = L[2 * g + 1]; tk[i].gate = &gate;
    if (pthread_create(&th[i], &at, emu_main, &tk[i])) break;
    made++;
  }
  const int ok = made == nt;
  if (!ok) snprintf(ERR, sizeof ERR, "GPU emulator could not start its threads");
  pthread_mutex_lock(&EMU_MU); gate = ok ? 1 : 2; pthread_cond_broadcast(&EMU_CV); pthread_mutex_unlock(&EMU_MU);
  for (int i = 0; i < made; i++) pthread_join(th[i], NULL);
  pthread_attr_destroy(&at);
  for (int g = 0; g < groups; g++) { pthread_barrier_destroy(&bar[g]); free(L[2 * g]); free(L[2 * g + 1]); }
  free(L); free(bar); free(tk); free(th);
  return ok;
}

// Waiting for a kernel: clFinish makes some drivers (NVIDIA's among them) spin a CPU core at 100% for the
// whole kernel. Instead the queue is flushed and the event polled with short sleeps.
static double DUTY = 1.0;
void gpu_set_duty(double duty) { DUTY = duty < 0.1 ? 0.1 : duty > 1 ? 1 : duty; }
static double wall(void) {
#ifdef _WIN32
  static LARGE_INTEGER f; LARGE_INTEGER c; if (!f.QuadPart) QueryPerformanceFrequency(&f); QueryPerformanceCounter(&c); return (double)c.QuadPart / (double)f.QuadPart;
#else
  struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts); return (double)ts.tv_sec + ts.tv_nsec * 1e-9;
#endif
}
static void nap_ms(int ms) {
#ifdef _WIN32
  Sleep((DWORD)ms);
#else
  struct timespec ts = { ms / 1000, (long)(ms % 1000) * 1000000L }; nanosleep(&ts, NULL);
#endif
}
static int wait_kernel(cl_event ev) {
  if (!ev || !CL.Flush || !CL.GetEventInfo) { if (ev && CL.ReleaseEvent) CL.ReleaseEvent(ev); cl_int e = CL.Finish(Q); return e == CL_SUCCESS ? 1 : fail("GPU kernel", e); }
#ifdef _WIN32
  timeBeginPeriod(1);   // 1 ms sleeps instead of the default 15.6 ms timer
#endif
  cl_int e = CL.Flush(Q), st = 1;
  while (e == CL_SUCCESS) {
    e = CL.GetEventInfo(ev, CL_EVENT_COMMAND_EXECUTION_STATUS, sizeof st, &st, NULL);
    if (e != CL_SUCCESS || st <= 0) break;   // 0 = complete, < 0 = the command failed
    nap_ms(1);
  }
#ifdef _WIN32
  timeEndPeriod(1);
#endif
  if (CL.ReleaseEvent) CL.ReleaseEvent(ev);
  if (e != CL_SUCCESS) return fail("GPU kernel", e);
  if (st < 0) return fail("GPU kernel", st);
  return 1;
}
int gpu_river(const GRiver *a) {
  if (!READY) { snprintf(ERR, sizeof ERR, "no GPU"); return 0; }
  if (a->r1 <= a->r0) return 1;
  KA A[NARGS + 2];
  if (!build_args(a, A)) { if (!ERR[0]) snprintf(ERR, sizeof ERR, "bad kernel arguments"); return 0; }
  int ctr = a->r0;
  if (!gpu_write(a->CTR, 0, &ctr, sizeof ctr)) return 0;
  int groups = a->groups > 0 ? a->groups : 1;
  if (groups > a->r1 - a->r0) groups = a->r1 - a->r0;
  if (EMU) return emu_run(A, groups < EMU_GROUPS ? groups : EMU_GROUPS);
  for (int i = 0; i < NARGS; i++) {
    cl_int e;
    if (A[i].kind == 0) e = CL.SetKernelArg(KRN, (cl_uint)i, sizeof(cl_mem), &A[i].b->m);
    else if (A[i].kind == 1) e = CL.SetKernelArg(KRN, (cl_uint)i, sizeof(int), &A[i].i);
    else if (A[i].kind == 2) e = CL.SetKernelArg(KRN, (cl_uint)i, sizeof(float), &A[i].f);
    else e = CL.SetKernelArg(KRN, (cl_uint)i, A[i].bytes, NULL);
    if (e != CL_SUCCESS) { char w[64]; snprintf(w, sizeof w, "set kernel argument %d", i); return fail(w, e); }
  }
  size_t local = (size_t)WG, global = (size_t)groups * local;
  cl_event ev = NULL;
  const double t0 = wall();
  cl_int e = CL.EnqueueNDRangeKernel(Q, KRN, 1, NULL, &global, &local, 0, NULL, CL.GetEventInfo ? &ev : NULL);
  if (e != CL_SUCCESS) return fail("run GPU kernel", e);
  if (!wait_kernel(ev)) return 0;
  // lighter power modes leave the GPU idle for a while after each launch
  if (DUTY < 0.999) { const double dt = wall() - t0; const int ms = (int)(dt * (1.0 / DUTY - 1.0) * 1000.0); if (ms > 0) nap_ms(ms > 2000 ? 2000 : ms); }
  return 1;
}
