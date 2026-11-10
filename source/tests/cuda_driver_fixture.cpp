// Linux test double for the CUDA driver API. Runs the actual kernel source
// (native/score.cu) on the CPU, so it checks dispatch, partitioning, exact
// CPU/GPU result parity and recovery. It cannot validate PTX/SASS or timing.
// EM_FIXTURE_FAULT selects one injected failure:
//   missing  cuInit fails            pressure  little free VRAM
//   alloc    cuMemAlloc fails        download  device->host copy fails
//   mismatch corrupt one score       oldgpu    compute capability 6.1
//   launch   kernel launch fails     nodevice  zero devices
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <bit>
#include <atomic>
#include <thread>
#include <chrono>
#define __device__
#define __global__
#define __popc(x) std::popcount(x)
struct Dim {unsigned x;};
static Dim blockIdx{},threadIdx{},blockDim{128},gridDim{1};
static unsigned long long atomicAdd(unsigned long long *p,unsigned long long v){unsigned long long o=*p;*p+=v;return o;}
#include "../native/score.cu"
static bool fault(const char *name){const char *f=std::getenv("EM_FIXTURE_FAULT");return f && !std::strcmp(f,name);}
static std::atomic<long long> live{0};
extern "C" {
int cuInit(unsigned){return fault("missing");}
int cuDeviceGetCount(int *n){*n=fault("nodevice")?0:1;return 0;}
int cuDeviceGet(int *d,int){*d=0;return 0;}
int cuDeviceGetName(char *s,int len,int){std::strncpy(s,"EightMax CUDA test double (CPU)",(size_t)len);return 0;}
int cuDeviceGetAttribute(int *v,int attr,int){*v=attr==75?(fault("oldgpu")?6:8):attr==76?(fault("oldgpu")?1:9):0;return 0;}
int cuDeviceTotalMem_v2(size_t *t,int){*t=8ULL<<30;return 0;}
int cuDriverGetVersion(int *v){*v=12090;return 0;}
int cuCtxCreate_v2(void **p,unsigned,int){*p=(void*)1;return 0;}
int cuCtxDestroy_v2(void*){return 0;}
int cuCtxSynchronize(){return 0;}
int cuModuleLoadData(void **p,const void*){*p=(void*)1;return 0;}
int cuModuleUnload(void*){return 0;}
int cuModuleGetFunction(void **p,void*,const char *name){*p=(void*)(uintptr_t)(!std::strcmp(name,"equity")?2:!std::strcmp(name,"score_deals")?3:!std::strcmp(name,"board_scores")?4:1);return 0;}
int cuMemGetInfo_v2(size_t *available,size_t *total){*total=8ULL<<30;*available=fault("pressure")?50000:*total-(size_t)live.load();return 0;}
int cuMemAlloc_v2(uint64_t *p,size_t len){if(fault("alloc"))return 1;*p=(uint64_t)std::malloc(len);live+=(long long)len;return !*p;}
int cuMemFree_v2(uint64_t p){std::free((void*)p);return 0;}
int cuMemcpyHtoD_v2(uint64_t p,const void *q,size_t n){std::memcpy((void*)p,q,n);return 0;}
int cuMemcpyDtoH_v2(void *p,uint64_t q,size_t n){if(fault("download"))return 1;std::memcpy(p,(void*)q,n);return 0;}
int cuLaunchKernel(void *f,unsigned gx,unsigned,unsigned,unsigned bx,unsigned,unsigned,unsigned,void*,void **args,void**){
 if(fault("slow"))std::this_thread::sleep_for(std::chrono::milliseconds(10));
 if(fault("launch"))return 1;
 gridDim.x=gx;blockDim.x=bx;
 if(f==(void*)2){
  auto spec=(const unsigned char*)*(uint64_t*)args[0];auto binom=(const unsigned long long*)*(uint64_t*)args[1];
  unsigned long long combos=*(unsigned long long*)args[2],first=*(unsigned long long*)args[3];auto out=(unsigned long long*)*(uint64_t*)args[4];
  for(unsigned b=0;b<gx;b++)for(unsigned t=0;t<bx;t++){blockIdx.x=b;threadIdx.x=t;equity(spec,binom,combos,first,out);}
  return 0;
 }
 if(f==(void*)4){   // 4.0 board_scores (showdown tables)
  auto spec=(const unsigned char*)*(uint64_t*)args[0];auto binom=(const unsigned long long*)*(uint64_t*)args[1];
  unsigned long long first=*(unsigned long long*)args[2],end=*(unsigned long long*)args[3];auto out=(int*)*(uint64_t*)args[4];
  for(unsigned b=0;b<gx;b++)for(unsigned t=0;t<bx;t++){blockIdx.x=b;threadIdx.x=t;board_scores(spec,binom,first,end,out);}
  if(fault("mismatch"))out[0]^=1;
  return 0;
 }
 auto input=(unsigned char*)*(uint64_t*)args[0];auto output=(int*)*(uint64_t*)args[1];int n=*(int*)args[2];
 for(int i=0;i<n;i++){blockIdx.x=(unsigned)i/bx;threadIdx.x=(unsigned)i%bx;if(f==(void*)3)score_deals(input,output,n,*(int*)args[3]);else score(input,output,n);}
 if(fault("mismatch"))output[0]^=1;
 return 0;
}
}
