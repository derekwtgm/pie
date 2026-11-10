// CUDA driver ABI, resolved at run time. No CUDA runtime DLL or toolkit is required.
// 3.1: device probing (name, compute capability, VRAM, driver), refusal of
// devices older than compute capability 7.5, SASS cubin selection with PTX JIT
// fallback, reusable buffers within a configurable VRAM cap that always leaves
// max(1 GiB, 25% of device memory) free, and the exact all-in equity kernel.
#pragma once
#include <algorithm>
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
class CudaScore {
  void *library=nullptr,*context=nullptr,*module=nullptr,*kernel=nullptr,*equityKernel=nullptr,*dealsKernel=nullptr;
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
  template<class T> bool bind(T &fn,const char *name) {
#ifdef _WIN32
    fn=reinterpret_cast<T>(GetProcAddress(static_cast<HMODULE>(library),name));
#else
    fn=reinterpret_cast<T>(dlsym(library,name));
#endif
    return fn!=nullptr;
  }
  void clear() {
    if(input) release(input);
    if(output) release(output);
    input=output=0; capacity=inputCapacity=0; allocatedBytes=0;
  }
  bool fail(const char *why){info.reason=why;info.available=false;return false;}
  // Leave max(1 GiB, 25% of the device) for Windows display and other programs.
  bool fits(size_t need,size_t budget){
    size_t available=0,total=0;
    if(memory(&available,&total)) return false;
    info.freeBytes=available; info.totalBytes=total;
    const size_t reserve=std::max<size_t>(1024ULL<<20,total/4);
    return available>=reserve && need<=available-reserve && need<=budget;
  }
public:
  CudaInfo info;
  static constexpr int MIN_MAJOR=7, MIN_MINOR=5;
  bool open() {
#ifdef _WIN32
    library=LoadLibraryExW(L"nvcuda.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);
#else
    library=dlopen("libcuda.so.1",RTLD_LOCAL|RTLD_NOW);
#endif
    if(!library) return fail("NVIDIA driver library not found");
    if(!bind(init,"cuInit") || !bind(getDevice,"cuDeviceGet") || !bind(create,"cuCtxCreate_v2") || !bind(destroy,"cuCtxDestroy_v2") ||
       !bind(load,"cuModuleLoadData") || !bind(function,"cuModuleGetFunction") || !bind(memory,"cuMemGetInfo_v2") ||
       !bind(allocate,"cuMemAlloc_v2") || !bind(release,"cuMemFree_v2") || !bind(upload,"cuMemcpyHtoD_v2") ||
       !bind(download,"cuMemcpyDtoH_v2") || !bind(launch,"cuLaunchKernel")) return fail("NVIDIA driver is missing required CUDA entry points");
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
    if(create(&context,0,device)) return fail("could not create a CUDA context");
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
    size_t freeBytes=0,total=0; if(!memory(&freeBytes,&total)){info.freeBytes=freeBytes; if(total) info.totalBytes=total;}
    info.available=true; info.reason="available";
    return true;
  }
  bool packedDeals()const{return dealsKernel!=nullptr;}
  bool begin(const unsigned char *cards,int count,size_t budget,int seats=0) {
    if(count<=0||seats<0||seats>8||(seats&&(!dealsKernel||count%seats)))return false;
    const size_t bytes=seats?(size_t)(count/seats)*(5+2*seats):7ULL*count;
    const size_t need=bytes+4ULL*count;if(need>budget)return false;
    if(allocatedBytes>budget||bytes>inputCapacity||(size_t)count>capacity){
      clear();if(!fits(need,budget))return false;
      if(allocate(&input,bytes)||allocate(&output,4ULL*count)){clear();return false;}
      inputCapacity=bytes;capacity=count;allocatedBytes=need;
    }else if(!fits(0,budget)){clear();return false;}
    void *args[]={&input,&output,&count,&seats};
    return !upload(input,cards,bytes)&&!launch(seats?dealsKernel:kernel,(count+127)/128,1,1,128,1,1,0,nullptr,args,nullptr);
  }
  bool finish(int *scores,int count){return !download(scores,output,4ULL*count);}
  size_t allocated() const {return allocatedBytes;}
  void releaseBuffers(){ if(context) clear(); }
  // Exact equity units: out[0..n-1] share units (840 per board), out[8] boards.
  bool equity(const std::vector<unsigned char> &spec,const std::vector<unsigned long long> &binom,unsigned long long combos,
              unsigned long long out[9],size_t budget,size_t &peak){
    if(!equityKernel) return false;
    uint64_t dSpec=0,dBinom=0,dOut=0; const size_t need=spec.size()+binom.size()*8+9*8;
    if(!fits(need,budget)) return false;
    bool ok=!allocate(&dSpec,spec.size()) && !allocate(&dBinom,binom.size()*8) && !allocate(&dOut,9*8);
    std::vector<unsigned long long> zero(9,0);
    ok=ok && !upload(dSpec,spec.data(),spec.size()) && !upload(dBinom,binom.data(),binom.size()*8) && !upload(dOut,zero.data(),9*8);
    // Fixed grid; each thread strides through board indices. Chunked launches
    // keep each kernel short so the Windows display watchdog never fires.
    const unsigned blocks=1024,threads=128; const unsigned long long chunk=(unsigned long long)blocks*threads*64;
    for(unsigned long long first=0;ok && first<combos;first+=chunk){
      unsigned long long end=std::min(combos,first+chunk);
      void *args[]={&dSpec,&dBinom,&end,&first,&dOut};
      const unsigned activeBlocks=(unsigned)std::min<unsigned long long>(blocks,(end-first+threads-1)/threads);
      ok=!launch(equityKernel,activeBlocks,1,1,threads,1,1,0,nullptr,args,nullptr) && (!synchronize || !synchronize());
    }
    ok=ok && !download(out,dOut,9*8);
    if(dSpec) release(dSpec);
    if(dBinom) release(dBinom);
    if(dOut) release(dOut);
    peak=std::max(peak,need);
    return ok;
  }
  ~CudaScore(){
    if(context){clear(); if(module && unload) unload(module); destroy(context);}
    if(library){
#ifdef _WIN32
      FreeLibrary(static_cast<HMODULE>(library));
#else
      dlclose(library);
#endif
    }
  }
};
