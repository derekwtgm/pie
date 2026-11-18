#ifndef EM_GPU_H
#define EM_GPU_H
#include <stddef.h>
// GPU backend: OpenCL loaded at run time (no SDK needed), or a CPU emulator that runs the same
// kernel source with one thread per work-item (EIGHTMAX_GPU=emu, for testing).
typedef struct GBuf GBuf;
int gpu_init(void);                 // probe once; 1 when a device is ready. EIGHTMAX_GPU=off|emu|emu:WGxGROUPS|<device index>
int gpu_ready(void);
int gpu_is_emu(void);
const char *gpu_desc(void);         // device name, or why there is no GPU
const char *gpu_error(void);        // last error
double gpu_mem_mb(void);            // device memory
double gpu_max_alloc_mb(void);      // largest single buffer
int gpu_units(void);                // compute units (SMs)
int gpu_wg(void);                   // work-group size
GBuf *gpu_alloc(size_t bytes);
void gpu_free(GBuf *b);
int gpu_write(GBuf *b, size_t off, const void *src, size_t n);
int gpu_read(GBuf *b, size_t off, void *dst, size_t n);
void *gpu_host_alloc(size_t bytes, GBuf **pin);   // page-locked host memory when the driver offers it
void gpu_host_free(void *p, GBuf *pin);
typedef struct {
  GBuf *TY, *PL, *NN, *CS, *CHN, *DO, *NX, *NC0, *NC1, *SEND, *RS, *R0, *S0, *R1, *S1, *LR, *LS, *RSC, *SSC;
  GBuf *HL1, *HL2, *HSAME, *HWOFF, *HWDAT, *BDAT, *BOFF, *BM, *CDAT, *COFF;
  GBuf *SLOTS, *ENT, *EQV, *PHD, *PHO, *REQ, *RO, *VOUT, *SCR, *SCRI, *CTR, *CUM, *ICMT;
  int r0, r1, p, mode, t, icm, maxSub, maxN, NP, NO, hoffP; unsigned spl; int comp;   // comp: 16-bit regrets/sums
  float gamma, P0H, w;
  int groups;
} GRiver;
int gpu_river(const GRiver *a);     // solves requests [r0, r1); 0 on error
void gpu_set_duty(double duty);     // share of the time the GPU may work (1 = flat out; less leaves it idle between launches)
#endif
