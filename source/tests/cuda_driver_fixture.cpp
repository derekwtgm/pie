// Linux test double for the CUDA driver API. Runs the actual kernel source
// (native/score.cu) on the CPU, so it checks dispatch, partitioning, exact
// CPU/GPU result parity and recovery. It cannot validate PTX/SASS or timing,
// and it is NOT physical GPU validation.
//
// 4.2: the double now enforces the driver's context rules, as the real driver
// does: a context is current per host thread (a thread-local stack); every
// memory, copy, launch and synchronize call fails with CUDA_ERROR_INVALID_CONTEXT
// (201) when the calling thread has no current context or the current context
// was destroyed; cuCtxCreate pushes the new context on the creating thread only;
// primary contexts are reference counted and never current until pushed. 4.1's
// double accepted every call from every thread, which hid the 4.1 EV failure.
// It also tracks every allocation (live bytes, peak, count, leaks) and, when
// EM_FIXTURE_STATS names a file, writes them as JSON at process exit.
//
// EM_FIXTURE_FAULT selects one injected failure:
//   missing  cuInit fails            pressure  little free VRAM
//   alloc    cuMemAlloc fails (OOM)  download  device->host copy fails
//   mismatch corrupt one score       oldgpu    compute capability 6.1
//   launch   kernel launch fails     nodevice  zero devices
//   slow     10 ms per launch        allocAfter=N  allocations after the N-th fail (OOM)
//   noprimary  no primary-context entry points (cuCtxCreate path)
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <bit>
#include <atomic>
#include <thread>
#include <chrono>
#include <map>
#include <mutex>
#include <set>
#include <vector>
#define __device__
#define __global__
#define __popc(x) std::popcount(x)
struct Dim {unsigned x;};
static Dim blockIdx{},threadIdx{},blockDim{128},gridDim{1};
static unsigned long long atomicAdd(unsigned long long *p,unsigned long long v){unsigned long long o=*p;*p+=v;return o;}
#include "../native/score.cu"
static bool fault(const char *name){const char *f=std::getenv("EM_FIXTURE_FAULT");return f && !std::strcmp(f,name);}
static long long allocAfter(){const char *f=std::getenv("EM_FIXTURE_FAULT");return f&&!std::strncmp(f,"allocAfter=",11)?std::atoll(f+11):-1;}
enum { OK=0, OOM=2, NOT_INIT=3, INVALID_VALUE=1, INVALID_CONTEXT=201, CONTEXT_ALREADY_CURRENT=202, LAUNCH_FAILED=719, UNKNOWN=999 };
// State is immortal (never destroyed): the host's static CUDA objects may be
// destroyed after this library's statics at process exit.
static std::mutex &mu=*new std::mutex;            // driver state (the real driver is thread-safe)
static std::mutex &launchMu=*new std::mutex;      // the emulated kernels use the static blockIdx/threadIdx above
static std::atomic<long long> live{0},peak{0},allocs{0},frees{0},failedAllocs{0},invalidContextCalls{0},launches{0},pushes{0},pops{0},creates{0},destroys{0},retains{0},releases{0};
static std::map<uint64_t,size_t> &blocks=*new std::map<uint64_t,size_t>;
static std::set<uintptr_t> &alive=*new std::set<uintptr_t>;        // live context handles
static std::map<uintptr_t,int> &primaryRefs=*new std::map<uintptr_t,int>;
static uintptr_t nextCtx=0x100;
static const uintptr_t PRIMARY=0x10;
// Per-thread context stack, never destroyed (static destructors may still call the driver at exit).
static thread_local std::vector<uintptr_t> &stack=*new std::vector<uintptr_t>;
static std::set<std::thread::id> &threadsSeen=*new std::set<std::thread::id>;
static int requireCtx(){
  std::lock_guard<std::mutex> g(mu); threadsSeen.insert(std::this_thread::get_id());
  if(stack.empty()||!alive.count(stack.back())){invalidContextCalls++;return INVALID_CONTEXT;}
  return OK;
}
static std::atomic<long long> inits{0};   // 5.0: driver initialisations (distinguishes "never opened" from "opened and fell back")
// ELF destructor: runs after every C++ static destructor of the host.
__attribute__((destructor)) static void report(){{
  const char *f=std::getenv("EM_FIXTURE_STATS"); if(!f)return; FILE *o=std::fopen(f,"w"); if(!o)return;
  std::fprintf(o,"{\"cuInitCalls\":%lld,\"liveBytesAtExit\":%lld,\"leakedBlocks\":%zu,\"peakBytes\":%lld,\"allocations\":%lld,\"frees\":%lld,\"failedAllocations\":%lld,\"invalidContextCalls\":%lld,\"launches\":%lld,\"pushes\":%lld,\"pops\":%lld,\"contextsCreated\":%lld,\"contextsDestroyed\":%lld,\"primaryRetains\":%lld,\"primaryReleases\":%lld,\"contextsAliveAtExit\":%zu,\"driverThreads\":%zu}\n",
    inits.load(),live.load(),blocks.size(),peak.load(),allocs.load(),frees.load(),failedAllocs.load(),invalidContextCalls.load(),launches.load(),pushes.load(),pops.load(),creates.load(),destroys.load(),retains.load(),releases.load(),alive.size(),threadsSeen.size());
  std::fclose(o);
}}
extern "C" {
int cuInit(unsigned){inits++;return fault("missing")?100:0;}
int cuDeviceGetCount(int *n){*n=fault("nodevice")?0:1;return 0;}
int cuDeviceGet(int *d,int){*d=0;return 0;}
int cuDeviceGetName(char *s,int len,int){std::strncpy(s,"EightMax CUDA test double (CPU)",(size_t)len);return 0;}
int cuDeviceGetAttribute(int *v,int attr,int){*v=attr==75?(fault("oldgpu")?6:8):attr==76?(fault("oldgpu")?1:9):0;return 0;}
int cuDeviceTotalMem_v2(size_t *t,int){*t=8ULL<<30;return 0;}
int cuDriverGetVersion(int *v){*v=12090;return 0;}
int cuGetErrorName(int e,const char **s){
  *s=e==0?"CUDA_SUCCESS":e==1?"CUDA_ERROR_INVALID_VALUE":e==2?"CUDA_ERROR_OUT_OF_MEMORY":e==3?"CUDA_ERROR_NOT_INITIALIZED":e==100?"CUDA_ERROR_NO_DEVICE":e==201?"CUDA_ERROR_INVALID_CONTEXT":e==202?"CUDA_ERROR_CONTEXT_ALREADY_CURRENT":e==719?"CUDA_ERROR_LAUNCH_FAILED":"CUDA_ERROR_UNKNOWN";return 0;}
int cuGetErrorString(int e,const char **s){
  *s=e==0?"no error":e==1?"invalid argument":e==2?"out of memory":e==3?"initialization error":e==100?"no CUDA-capable device is detected":e==201?"invalid device context":e==202?"context already in use":e==719?"unspecified launch failure":"unknown error";return 0;}
int cuCtxCreate_v2(void **p,unsigned,int){std::lock_guard<std::mutex> g(mu);const uintptr_t c=nextCtx++;alive.insert(c);stack.push_back(c);creates++;pushes++;/* the implicit push of cuCtxCreate counts as a push */*p=(void*)c;return 0;}
int cuCtxDestroy_v2(void *c){std::lock_guard<std::mutex> g(mu);if(!alive.erase((uintptr_t)c))return INVALID_CONTEXT;destroys++;if(!stack.empty()&&stack.back()==(uintptr_t)c)stack.pop_back();return 0;}
int cuCtxPushCurrent_v2(void *c){std::lock_guard<std::mutex> g(mu);if(!alive.count((uintptr_t)c))return INVALID_CONTEXT;stack.push_back((uintptr_t)c);pushes++;return 0;}
int cuCtxPopCurrent_v2(void **c){std::lock_guard<std::mutex> g(mu);if(stack.empty())return INVALID_CONTEXT;if(c)*c=(void*)stack.back();stack.pop_back();pops++;return 0;}
int cuCtxGetCurrent(void **c){std::lock_guard<std::mutex> g(mu);*c=stack.empty()?nullptr:(void*)stack.back();return 0;}
int cuDevicePrimaryCtxRetain(void **p,int){if(fault("noprimary"))return UNKNOWN;std::lock_guard<std::mutex> g(mu);if(!primaryRefs[PRIMARY]++)alive.insert(PRIMARY);retains++;*p=(void*)PRIMARY;return 0;}
int cuDevicePrimaryCtxRelease_v2(int){std::lock_guard<std::mutex> g(mu);auto &r=primaryRefs[PRIMARY];if(r<=0)return INVALID_CONTEXT;releases++;if(!--r)alive.erase(PRIMARY);return 0;}
int cuCtxSynchronize(){return requireCtx();}
int cuModuleLoadData(void **p,const void*){if(int e=requireCtx())return e;*p=(void*)1;return 0;}
int cuModuleUnload(void*){return requireCtx();}
int cuModuleGetFunction(void **p,void*,const char *name){if(int e=requireCtx())return e;*p=(void*)(uintptr_t)(!std::strcmp(name,"equity")?2:!std::strcmp(name,"score_deals")?3:!std::strcmp(name,"board_scores")?4:1);return 0;}
int cuMemGetInfo_v2(size_t *available,size_t *total){if(int e=requireCtx())return e;*total=8ULL<<30;*available=fault("pressure")?50000:*total-(size_t)live.load();return 0;}
int cuMemAlloc_v2(uint64_t *p,size_t len){
  if(int e=requireCtx())return e;
  const long long n=allocs.load(),after=allocAfter();
  if(fault("alloc")||(after>=0&&n>=after)){failedAllocs++;return OOM;}
  void *q=std::malloc(len?len:1);if(!q){failedAllocs++;return OOM;}
  std::lock_guard<std::mutex> g(mu);*p=(uint64_t)q;blocks[*p]=len;allocs++;
  const long long now=live+=(long long)len;long long pk=peak.load();while(now>pk&&!peak.compare_exchange_weak(pk,now)){}
  return 0;
}
int cuMemFree_v2(uint64_t p){
  if(int e=requireCtx())return e;
  std::lock_guard<std::mutex> g(mu);auto it=blocks.find(p);if(it==blocks.end())return INVALID_VALUE;
  live-=(long long)it->second;blocks.erase(it);frees++;std::free((void*)p);return 0;
}
int cuMemcpyHtoD_v2(uint64_t p,const void *q,size_t n){if(int e=requireCtx())return e;std::memcpy((void*)p,q,n);return 0;}
int cuMemcpyDtoH_v2(void *p,uint64_t q,size_t n){if(int e=requireCtx())return e;if(fault("download"))return LAUNCH_FAILED;std::memcpy(p,(void*)q,n);return 0;}
int cuLaunchKernel(void *f,unsigned gx,unsigned,unsigned,unsigned bx,unsigned,unsigned,unsigned,void*,void **args,void**){
 if(int e=requireCtx())return e;
 if(fault("slow"))std::this_thread::sleep_for(std::chrono::milliseconds(10));
 if(fault("launch"))return LAUNCH_FAILED;
 std::lock_guard<std::mutex> lk(launchMu); launches++;
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
 // 5.1: controllable device cost for route-selection tests: EM_FIXTURE_LAUNCH_US per score launch
 // (fixed overhead) + EM_FIXTURE_LANE_NS per lane, busy-waited. Default 0 (unchanged behaviour).
 {static const long long fixedUs=std::getenv("EM_FIXTURE_LAUNCH_US")?std::atoll(std::getenv("EM_FIXTURE_LAUNCH_US")):0,laneNs=std::getenv("EM_FIXTURE_LANE_NS")?std::atoll(std::getenv("EM_FIXTURE_LANE_NS")):0;
  const long long ns=fixedUs*1000+laneNs*(long long)n;if(ns>0){const auto end=std::chrono::steady_clock::now()+std::chrono::nanoseconds(ns);while(std::chrono::steady_clock::now()<end){}}}
 for(int i=0;i<n;i++){blockIdx.x=(unsigned)i/bx;threadIdx.x=(unsigned)i%bx;if(f==(void*)3)score_deals(input,output,n,*(int*)args[3]);else score(input,output,n);}
 if(fault("mismatch"))output[0]^=1;
 return 0;
}
}
