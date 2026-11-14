// CUDA driver ABI, resolved at run time. No CUDA runtime DLL or toolkit is required.
// 3.1: device probing (name, compute capability, VRAM, driver), refusal of
// devices older than compute capability 7.5, SASS cubin selection with PTX JIT
// fallback, reusable buffers within a configurable VRAM cap that always leaves
// max(1 GiB, 25% of device memory) free, and the exact all-in equity kernel.
// 4.2: CONTEXT RULES. The CUDA driver keeps a "current context" per host
// thread. 4.1 created its context with cuCtxCreate (current only on the
// creating thread) and then called the driver from EV worker threads with no
// current context: allocation, memory-info and launch calls failed with
// CUDA_ERROR_INVALID_CONTEXT, reported as "allocation, VRAM reserve or launch
// failed", and buffers could not be freed. 4.2 retains the device's PRIMARY
// context (shared by every CudaScore in the process; cuCtxCreate + pop when the
// driver lacks it) and makes it current only for the duration of each public
// call through a balanced RAII push/pop guard (CtxGuard), on whichever thread
// calls. Callers still serialise use of one CudaScore (EvGpu::mu, or a single
// training thread). Every failure is recorded in `error` (driver call, result
// code, error name/description, host thread, context state, requested bytes,
// free/total VRAM, budget, reserve, launch geometry). A process-wide ledger
// counts device bytes held by all CudaScore objects (current and peak).
#pragma once
#include <algorithm>
#include <atomic>
#include <mutex>
#include <thread>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif
#include "score_ptx.hpp"
struct CudaInfo {
  bool available = false; std::string reason = "not probed", name, image;
  int major = 0, minor = 0, driver = 0; size_t totalBytes = 0, freeBytes = 0;
};
// Small sequential id of the calling host thread (diagnostics only).
inline int cudaHostThread() { static std::atomic<int> next{0}; thread_local int id = next++; return id; }
struct CudaError {
  bool set = false; std::string op; int code = 0; std::string name, text;
  int thread = -1; std::string context; size_t requested = 0, freeBytes = 0, totalBytes = 0, budget = 0, reserve = 0;
  unsigned grid = 0, block = 0; long long count = 0;   // count: failures recorded on this object
  std::string summary() const {
    if (!set) return "";
    char b[640]; std::snprintf(b, sizeof b, "%s failed: %s (%d: %s); host thread %d; context %s; requested %zu bytes; budget %zu bytes; free %.0f MiB of %.0f MiB; reserve %.0f MiB%s",
      op.c_str(), name.c_str(), code, text.c_str(), thread, context.c_str(), requested, budget, freeBytes / 1048576.0, totalBytes / 1048576.0, reserve / 1048576.0,
      grid ? (" ; launch " + std::to_string(grid) + "x" + std::to_string(block)).c_str() : "");
    return b;
  }
};
// Device bytes held by every CudaScore in the process.
struct CudaLedger {
  static std::atomic<long long> &live() { static std::atomic<long long> v{0}; return v; }
  static std::atomic<long long> &peak() { static std::atomic<long long> v{0}; return v; }
  static void add(long long b) { const long long now = live() += b; long long p = peak().load(); while (now > p && !peak().compare_exchange_weak(p, now)) {} }
};
class CudaScore {
  void *library=nullptr,*context=nullptr,*module=nullptr,*kernel=nullptr,*equityKernel=nullptr,*dealsKernel=nullptr,*boardsKernel=nullptr;
  // 4.0: reusable buffers of the showdown-table kernel (board_scores).
  uint64_t bSpec=0,bBinom=0,bOut=0; size_t bSpecCap=0,bOutCap=0,bBytes=0; unsigned long long bCount=0; int bSeats=0;
  uint64_t input=0,output=0;
  size_t capacity=0,inputCapacity=0,allocatedBytes=0;
  using Device=int;
  Device device=0;
  int (*init)(unsigned)=nullptr;
  int (*getDevice)(Device*,int)=nullptr;
  int (*getCount)(int*)=nullptr;
  int (*getName)(char*,int,Device)=nullptr;
  int (*getAttribute)(int*,int,Device)=nullptr;
  int (*totalMem)(size_t*,Device)=nullptr;
  int (*driverVersion)(int*)=nullptr;
  int (*create)(void**,unsigned,Device)=nullptr;
  int (*destroy)(void*)=nullptr;
  int (*load)(void**,const void*)=nullptr;
  int (*unload)(void*)=nullptr;
  int (*function)(void**,void*,const char*)=nullptr;
  int (*memory)(size_t*,size_t*)=nullptr;
  int (*allocate)(uint64_t*,size_t)=nullptr;
  int (*release)(uint64_t)=nullptr;
  int (*upload)(uint64_t,const void*,size_t)=nullptr;
  int (*download)(void*,uint64_t,size_t)=nullptr;
  int (*synchronize)()=nullptr;
  int (*launch)(void*,unsigned,unsigned,unsigned,unsigned,unsigned,unsigned,unsigned,void*,void**,void**)=nullptr;
  int (*pushCtx)(void*)=nullptr;
  int (*popCtx)(void**)=nullptr;
  int (*getCurrent)(void**)=nullptr;
  int (*primaryRetain)(void**,Device)=nullptr;
  int (*primaryRelease)(Device)=nullptr;
  int (*errorName)(int,const char**)=nullptr;
  int (*errorString)(int,const char**)=nullptr;
  bool primary=false;
  size_t bBinomBytes=0;
  // Balanced push/pop of this object's context on the calling thread.
  struct CtxGuard {
    CudaScore &s; bool ok=false;
    CtxGuard(CudaScore &x,const char *op):s(x){
      if(!s.context){s.record(op,999,0,"no context (device not open)");return;}
      const int r=s.pushCtx(s.context); ok=!r; if(r) s.record("cuCtxPushCurrent_v2",r,0,"could not be made current on this thread");
    }
    ~CtxGuard(){ if(ok){ void *was=nullptr; s.popCtx(&was); } }
    CtxGuard(const CtxGuard&)=delete; CtxGuard &operator=(const CtxGuard&)=delete;
  };
  void record(const char *op,int code,size_t requested=0,const char *contextState="current (pushed for this call)",unsigned grid=0,unsigned block=0){
    error.set=true; error.op=op; error.code=code; error.requested=requested; error.context=contextState; error.grid=grid; error.block=block; error.thread=cudaHostThread(); error.count++;
    const char *n=nullptr,*t=nullptr;
    if(code==EM_BUDGET){n="EM_GPU_BUDGET_EXCEEDED";t="the request is larger than the configured GPU memory budget";}
    else if(code==EM_RESERVE){n="EM_VRAM_RESERVE";t="the allocation would leave less free VRAM than the reserve kept for Windows and other programs";}
    else if(code==999&&!errorName){n="EM_NO_CONTEXT";t="no CUDA context";}
    else { if(errorName) errorName(code,&n); if(errorString) errorString(code,&t); }
    error.name=n?n:"CUDA_ERROR_UNKNOWN"; error.text=t?t:"no description from the driver";
    error.budget=lastBudget; error.reserve=lastReserve; error.freeBytes=info.freeBytes; error.totalBytes=info.totalBytes;
  }
  bool call(int r,const char *op,size_t requested=0,unsigned grid=0,unsigned block=0){ if(r) record(op,r,requested,"current (pushed for this call)",grid,block); return !r; }
  bool alloc(uint64_t &p,size_t n,const char *what){ if(!call(allocate(&p,n),what,n)){p=0;return false;} CudaLedger::add((long long)n); return true; }
  void freeBuf(uint64_t &p,size_t n){ if(p){ if(call(release(p),"cuMemFree_v2")) CudaLedger::add(-(long long)n); p=0; } }
  size_t lastBudget=0,lastReserve=0;
  template<class T> bool bind(T &fn,const char *name) {
#ifdef _WIN32
    fn=reinterpret_cast<T>(GetProcAddress(static_cast<HMODULE>(library),name));
#else
    fn=reinterpret_cast<T>(dlsym(library,name));
#endif
    return fn!=nullptr;
  }
  // Call with the context current (CtxGuard).
  void clear() {
    freeBuf(input,inputCapacity); freeBuf(output,4ULL*capacity);
    capacity=inputCapacity=0; allocatedBytes=0;
    clearBoards();
  }
  void clearBoards() {
    freeBuf(bSpec,bSpecCap); freeBuf(bBinom,bBinomBytes); freeBuf(bOut,bOutCap);
    bSpecCap=bOutCap=bBytes=bBinomBytes=0;
  }
  bool fail(const char *why){info.reason=why;info.available=false;return false;}
  // Leave max(1 GiB, 25% of the device) for Windows display and other programs.
  // 4.2: the budget is checked before the driver is asked (no driver call for a
  // request that can never fit), and every refusal is recorded with its reason.
  bool fits(size_t need,size_t budget){
    lastBudget=budget;
    if(need>budget){ record("budget check",EM_BUDGET,need,"current (pushed for this call)"); return false; }
    size_t available=0,total=0;
    if(!call(memory(&available,&total),"cuMemGetInfo_v2",need)) return false;
    info.freeBytes=available; info.totalBytes=total;
    const size_t reserve=std::max<size_t>(1024ULL<<20,total/4); lastReserve=reserve;
    if(!(available>=reserve && need<=available-reserve)){ record("VRAM reserve check",EM_RESERVE,need); return false; }
    return true;
  }
public:
  static constexpr int EM_BUDGET=-1, EM_RESERVE=-2;
  CudaInfo info; CudaError error;
  void clearError(){ error=CudaError{}; }
  bool usesPrimaryContext() const { return primary; }
  static constexpr int MIN_MAJOR=7, MIN_MINOR=5;
  bool open() {
#ifdef _WIN32
    // 5.0 test hook: EM_TEST_CUDA_LIBRARY = full path of a CUDA driver test double (tests/cuda_driver_fixture.cpp
    // built as a DLL) so the Windows scheduling tests can tell "never opened" from "opened and fell back" on CI
    // runners without an NVIDIA driver. Only an absolute path set in the process environment is honoured; the
    // normal path still loads nvcuda.dll from System32 only (no DLL search-order planting).
    if(const wchar_t *t=_wgetenv(L"EM_TEST_CUDA_LIBRARY"); t && *t && t[1]==L':') library=LoadLibraryExW(t,nullptr,LOAD_WITH_ALTERED_SEARCH_PATH);
    else library=LoadLibraryExW(L"nvcuda.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);
#else
    library=dlopen("libcuda.so.1",RTLD_LOCAL|RTLD_NOW);
#endif
    if(!library) return fail("NVIDIA driver library not found");
    if(!bind(init,"cuInit") || !bind(getDevice,"cuDeviceGet") || !bind(create,"cuCtxCreate_v2") || !bind(destroy,"cuCtxDestroy_v2") ||
       !bind(load,"cuModuleLoadData") || !bind(function,"cuModuleGetFunction") || !bind(memory,"cuMemGetInfo_v2") ||
       !bind(allocate,"cuMemAlloc_v2") || !bind(release,"cuMemFree_v2") || !bind(upload,"cuMemcpyHtoD_v2") ||
       !bind(download,"cuMemcpyDtoH_v2") || !bind(launch,"cuLaunchKernel") || !bind(pushCtx,"cuCtxPushCurrent_v2") || !bind(popCtx,"cuCtxPopCurrent_v2"))
      return fail("NVIDIA driver is missing required CUDA entry points");
    bind(getCurrent,"cuCtxGetCurrent"); bind(primaryRetain,"cuDevicePrimaryCtxRetain"); bind(primaryRelease,"cuDevicePrimaryCtxRelease_v2");
    if(!primaryRelease) bind(primaryRelease,"cuDevicePrimaryCtxRelease");
    bind(errorName,"cuGetErrorName"); bind(errorString,"cuGetErrorString");
    // Optional entry points (older test doubles may lack them).
    bind(getCount,"cuDeviceGetCount"); bind(getName,"cuDeviceGetName"); bind(getAttribute,"cuDeviceGetAttribute");
    bind(totalMem,"cuDeviceTotalMem_v2"); bind(driverVersion,"cuDriverGetVersion"); bind(synchronize,"cuCtxSynchronize"); bind(unload,"cuModuleUnload");
    if(init(0)) return fail("cuInit failed (no usable NVIDIA GPU or driver)");
    int count=1; if(getCount && (getCount(&count) || count<1)) return fail("no CUDA device present");
    if(getDevice(&device,0)) return fail("cuDeviceGet failed");
    char name[256]="NVIDIA GPU"; if(getName) getName(name,sizeof name,device); info.name=name;
    if(driverVersion) driverVersion(&info.driver);
    if(totalMem) totalMem(&info.totalBytes,device);
    if(!getAttribute || getAttribute(&info.major,75,device) || getAttribute(&info.minor,76,device))
      return fail("CUDA driver could not report compute capability");
    if(info.major<MIN_MAJOR || (info.major==MIN_MAJOR && info.minor<MIN_MINOR)) {
      char why[160]; snprintf(why,sizeof why,"unsupported GPU: compute capability %d.%d is below 7.5",info.major,info.minor); return fail(why);
    }
    // 4.2: the primary context is shared by all users in the process and is not
    // current on any thread until pushed. Without it: cuCtxCreate (which makes
    // the context current on THIS thread) followed by a pop, so it floats too.
    if(primaryRetain && primaryRelease && !primaryRetain(&context,device)) primary=true;
    else {
      context=nullptr; const int r=create(&context,0,device);
      if(r){ context=nullptr; record("cuCtxCreate_v2",r,0,"not created"); return fail("could not create a CUDA context"); }
      void *was=nullptr; if(popCtx(&was)){ record("cuCtxPopCurrent_v2",1,0,"could not be detached"); return fail("could not detach the new CUDA context from the opening thread"); }
    }
    CtxGuard guard(*this,"open");
    if(!guard.ok) return fail("could not make the CUDA context current");
    // Prefer SASS for the device's architecture family, else JIT the PTX.
    const ScoreCubin *pick=nullptr;
    for(int i=0;i<scoreCubinCount;i++){ const ScoreCubin &c=scoreCubins[i];
      if(c.data && c.major==info.major && c.minor<=info.minor && (!pick || c.minor>pick->minor)) pick=&c; }
    if(pick && !load(&module,pick->data)) { char t[32]; snprintf(t,sizeof t,"sm_%d%d SASS",pick->major,pick->minor); info.image=t; }
    else if(!load(&module,scorePTX)) info.image="compute_75 PTX (JIT)";
    else return fail("CUDA module did not load (driver too old for the embedded PTX and no matching SASS)");
    if(function(&kernel,module,"score")) return fail("score kernel missing");
    if(function(&dealsKernel,module,"score_deals"))dealsKernel=nullptr;
    if(function(&equityKernel,module,"equity")) equityKernel=nullptr;
    if(function(&boardsKernel,module,"board_scores")) boardsKernel=nullptr;
    size_t freeBytes=0,total=0; if(!memory(&freeBytes,&total)){info.freeBytes=freeBytes; if(total) info.totalBytes=total;}
    info.available=true; info.reason="available";
    return true;
  }
  bool packedDeals()const{return dealsKernel!=nullptr;}
  bool begin(const unsigned char *cards,int count,size_t budget,int seats=0) {
    if(count<=0||seats<0||seats>8||(seats&&(!dealsKernel||count%seats)))return false;
    CtxGuard g(*this,"score batch"); if(!g.ok) return false;
    const size_t bytes=seats?(size_t)(count/seats)*(5+2*seats):7ULL*count;
    const size_t need=bytes+4ULL*count;
    if(allocatedBytes>budget||bytes>inputCapacity||(size_t)count>capacity){
      clear();if(!fits(need,budget))return false;
      if(!alloc(input,bytes,"cuMemAlloc_v2 (deal batch input)")||!alloc(output,4ULL*count,"cuMemAlloc_v2 (deal batch scores)")){inputCapacity=input?bytes:0;capacity=output?count:0;clear();return false;}
      inputCapacity=bytes;capacity=count;allocatedBytes=need;
    }else if(!fits(0,budget)){clear();return false;}
    void *args[]={&input,&output,&count,&seats};
    const unsigned grid=(unsigned)(count+127)/128;
    return call(upload(input,cards,bytes),"cuMemcpyHtoD_v2 (deal batch)",bytes)&&call(launch(seats?dealsKernel:kernel,grid,1,1,128,1,1,0,nullptr,args,nullptr),"cuLaunchKernel (score)",0,grid,128);
  }
  bool finish(int *scores,int count){CtxGuard g(*this,"score batch download"); return g.ok&&call(download(scores,output,4ULL*count),"cuMemcpyDtoH_v2 (deal batch)",4ULL*count);}
  size_t allocated() const {return allocatedBytes+bBytes;}
  // 4.0: showdown table for action-EV runouts. Scores every seat's seven-card
  // hand on the board completions [first,end) (colexicographic combinadic order,
  // the same as `equity`) into out[(index-first)*seats+p]. boardsBegin uploads
  // and launches without waiting; boardsFinish downloads (and so synchronizes).
  // Buffers are reused between tables and stay inside `budget` and the VRAM
  // reserve of fits(). Any failure returns false and the caller uses the CPU.
  bool hasBoards() const { return boardsKernel!=nullptr; }
  // Minimum device bytes of one board_scores launch of `boards` boards.
  static size_t boardBytes(size_t specBytes,size_t binomBytes,unsigned long long boards,int seats){ return specBytes+binomBytes+(size_t)boards*(size_t)seats*4; }
  bool boardsBegin(const std::vector<unsigned char> &spec,const std::vector<unsigned long long> &binom,unsigned long long first,unsigned long long end,int seats,size_t budget){
    if(!boardsKernel||end<=first||seats<1||seats>8) return false;
    CtxGuard g(*this,"EV table"); if(!g.ok) return false;
    const size_t outBytes=(size_t)(end-first)*(size_t)seats*4, binomBytes=binom.size()*8;
    const size_t need=std::max(spec.size(),bSpecCap)+binomBytes+std::max(outBytes,bOutCap);
    if(spec.size()>bSpecCap||outBytes>bOutCap||!bBinom||need>budget){
      clearBoards(); if(!fits(spec.size()+binomBytes+outBytes,budget)) return false;
      const bool ok=alloc(bSpec,spec.size(),"cuMemAlloc_v2 (EV table spec)") && (bSpecCap=spec.size(),alloc(bBinom,binomBytes,"cuMemAlloc_v2 (EV table binomials)")) && (bBinomBytes=binomBytes,alloc(bOut,outBytes,"cuMemAlloc_v2 (EV table scores)"));
      if(!ok){clearBoards();return false;}
      bOutCap=outBytes; bBytes=bSpecCap+binomBytes+bOutCap;
      if(!call(upload(bBinom,binom.data(),binomBytes),"cuMemcpyHtoD_v2 (binomials)",binomBytes)){clearBoards();return false;}
    } else if(!fits(0,budget)) { clearBoards(); return false; }
    if(!call(upload(bSpec,spec.data(),spec.size()),"cuMemcpyHtoD_v2 (EV table spec)",spec.size())) return false;
    const unsigned threads=128; const unsigned long long lanes=end-first;
    const unsigned blocks=(unsigned)std::min<unsigned long long>(4096,(lanes+threads-1)/threads);
    void *args[]={&bSpec,&bBinom,&first,&end,&bOut};
    bCount=lanes; bSeats=seats;
    return call(launch(boardsKernel,blocks,1,1,threads,1,1,0,nullptr,args,nullptr),"cuLaunchKernel (board_scores)",0,blocks,threads);
  }
  bool boardsFinish(int *out){ CtxGuard g(*this,"EV table download"); return g.ok&&call(download(out,bOut,(size_t)bCount*(size_t)bSeats*4),"cuMemcpyDtoH_v2 (EV table scores)",(size_t)bCount*(size_t)bSeats*4); }
  void releaseBuffers(){ if(context){ CtxGuard g(*this,"release buffers"); if(g.ok) clear(); } }
  // Bytes this object holds on the device now.
  size_t heldBytes() const { return inputCapacity+4ULL*capacity+bSpecCap+bBinomBytes+bOutCap; }
  // Exact equity units: out[0..n-1] share units (840 per board), out[8] boards.
  static size_t equityBytes(size_t specBytes,size_t binomCount){ return specBytes+binomCount*8+9*8; }
  bool equity(const std::vector<unsigned char> &spec,const std::vector<unsigned long long> &binom,unsigned long long combos,
              unsigned long long out[9],size_t budget,size_t &peak){
    if(!equityKernel) return false;
    CtxGuard g(*this,"equity"); if(!g.ok) return false;
    uint64_t dSpec=0,dBinom=0,dOut=0; const size_t need=equityBytes(spec.size(),binom.size());
    if(!fits(need,budget)) return false;
    bool ok=alloc(dSpec,spec.size(),"cuMemAlloc_v2 (equity spec)") && alloc(dBinom,binom.size()*8,"cuMemAlloc_v2 (equity binomials)") && alloc(dOut,9*8,"cuMemAlloc_v2 (equity totals)");
    std::vector<unsigned long long> zero(9,0);
    ok=ok && call(upload(dSpec,spec.data(),spec.size()),"cuMemcpyHtoD_v2 (equity spec)",spec.size()) && call(upload(dBinom,binom.data(),binom.size()*8),"cuMemcpyHtoD_v2 (binomials)",binom.size()*8) && call(upload(dOut,zero.data(),9*8),"cuMemcpyHtoD_v2 (totals)",72);
    // Fixed grid; each thread strides through board indices. Chunked launches
    // keep each kernel short so the Windows display watchdog never fires.
    const unsigned blocks=1024,threads=128; const unsigned long long chunk=(unsigned long long)blocks*threads*64;
    for(unsigned long long first=0;ok && first<combos;first+=chunk){
      unsigned long long end=std::min(combos,first+chunk);
      void *args[]={&dSpec,&dBinom,&end,&first,&dOut};
      const unsigned activeBlocks=(unsigned)std::min<unsigned long long>(blocks,(end-first+threads-1)/threads);
      ok=call(launch(equityKernel,activeBlocks,1,1,threads,1,1,0,nullptr,args,nullptr),"cuLaunchKernel (equity)",0,activeBlocks,threads) && (!synchronize || call(synchronize(),"cuCtxSynchronize (equity)"));
    }
    ok=ok && call(download(out,dOut,9*8),"cuMemcpyDtoH_v2 (equity totals)",72);
    freeBuf(dSpec,spec.size()); freeBuf(dBinom,binom.size()*8); freeBuf(dOut,9*8);
    if(ok) peak=std::max(peak,need);
    return ok;
  }
  CudaScore()=default;
  CudaScore(const CudaScore&)=delete; CudaScore &operator=(const CudaScore&)=delete;
  ~CudaScore(){
    if(context){
      { CtxGuard g(*this,"shutdown"); if(g.ok){ clear(); if(module && unload) unload(module); } }
      if(primary) primaryRelease(device); else destroy(context);
      context=nullptr;
    }
    if(library){
#ifdef _WIN32
      FreeLibrary(static_cast<HMODULE>(library));
#else
      dlclose(library);
#endif
    }
  }
};
