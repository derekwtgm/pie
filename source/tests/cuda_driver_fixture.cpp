// Linux test double for the driver API. Runs the actual kernel source on the CPU.
// This exercises dispatch, split coverage and recovery; it cannot validate PTX.
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <bit>
#define __device__
#define __global__
#define __popc(x) std::popcount(x)
struct Dim {int x;};
static Dim blockIdx{},threadIdx{},blockDim{128};
#include "../native/score.cu"
static bool fault(const char *name){const char *f=std::getenv("EM_FIXTURE_FAULT");return f && !std::strcmp(f,name);}
extern "C" {
int cuInit(unsigned){return fault("missing");}
int cuDeviceGet(int *d,int){*d=0;return 0;}
int cuCtxCreate_v2(void **p,unsigned,int){*p=(void*)1;return 0;}
int cuCtxDestroy_v2(void*){return 0;}
int cuModuleLoadData(void **p,const void*){*p=(void*)1;return 0;}
int cuModuleGetFunction(void **p,void*,const char*){*p=(void*)1;return 0;}
int cuMemGetInfo_v2(size_t *available,size_t *total){*total=8ULL<<30;*available=fault("pressure")?50000:*total;return 0;}
int cuMemAlloc_v2(uint64_t *p,size_t len){if(fault("alloc"))return 1;*p=(uint64_t)std::malloc(len);return !*p;}
int cuMemFree_v2(uint64_t p){std::free((void*)p);return 0;}
int cuMemcpyHtoD_v2(uint64_t p,const void *q,size_t n){std::memcpy((void*)p,q,n);return 0;}
int cuMemcpyDtoH_v2(void *p,uint64_t q,size_t n){if(fault("download"))return 1;std::memcpy(p,(void*)q,n);return 0;}
int cuLaunchKernel(void*,unsigned,unsigned,unsigned,unsigned,unsigned,unsigned,unsigned,void*,void **args,void**){
 auto input=(unsigned char*)*(uint64_t*)args[0];auto output=(int*)*(uint64_t*)args[1];int n=*(int*)args[2];
 for(int i=0;i<n;i++){blockIdx.x=i/128;threadIdx.x=i%128;score(input,output,n);}
 if(fault("mismatch"))output[0]^=1;
 return 0;
}
}
