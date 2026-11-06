// Lets gpu_kernels.cl compile as C: every work-item is a thread, barrier() is a real barrier.
#ifndef EM_GPU_EMU_H
#define EM_GPU_EMU_H
#include <math.h>
#include <pthread.h>
#include <stddef.h>
#include <string.h>
typedef unsigned char uchar;
typedef unsigned short ushort;
typedef unsigned int uint;
#define __kernel static
#define __global
#define __local
#define __constant
#define FN static inline
#define CLK_LOCAL_MEM_FENCE 1
#define CLK_GLOBAL_MEM_FENCE 2
typedef struct { int lid, wg, grp, ng; pthread_barrier_t *bar; } EmuItem;
static __thread EmuItem EMU_IT;
static inline size_t get_local_id(int d) { (void)d; return (size_t)EMU_IT.lid; }
static inline size_t get_local_size(int d) { (void)d; return (size_t)EMU_IT.wg; }
static inline size_t get_group_id(int d) { (void)d; return (size_t)EMU_IT.grp; }
static inline size_t get_num_groups(int d) { (void)d; return (size_t)EMU_IT.ng; }
static void emu_barrier(void);   // defined by the file that includes the kernel
#define barrier(f) ((void)(f), emu_barrier())
static inline int atomic_inc(int *p) { return __atomic_fetch_add(p, 1, __ATOMIC_SEQ_CST); }
static inline int atomic_or(int *p, int v) { return __atomic_fetch_or(p, v, __ATOMIC_SEQ_CST); }
static inline int atomic_max(int *p, int v) {
  int old = __atomic_load_n(p, __ATOMIC_SEQ_CST);
  while (old < v && !__atomic_compare_exchange_n(p, &old, v, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)) { }
  return old;
}
static inline int as_int(float f) { int i; memcpy(&i, &f, 4); return i; }
static inline float as_float(int i) { float f; memcpy(&f, &i, 4); return f; }
#endif
