// CUDA driver ABI, resolved at runtime. No CUDA runtime DLL or toolkit is required.
#pragma once
#include <algorithm>
#include <cstdint>
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
class CudaScore {
  void *library=nullptr,*context=nullptr,*module=nullptr,*kernel=nullptr;
  uint64_t input=0,output=0;
  size_t capacity=0;
  using Device=int;
  int (*init)(unsigned);
  int (*getDevice)(Device*,int);
  int (*create)(void**,unsigned,Device);
  int (*destroy)(void*);
  int (*load)(void**,const void*);
  int (*function)(void**,void*,const char*);
  int (*memory)(size_t*,size_t*);
  int (*allocate)(uint64_t*,size_t);
  int (*release)(uint64_t);
  int (*upload)(uint64_t,const void*,size_t);
  int (*download)(void*,uint64_t,size_t);
  int (*launch)(void*,unsigned,unsigned,unsigned,unsigned,unsigned,unsigned,unsigned,void*,void**,void**);
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
    input=output=capacity=0;
  }
public:
  bool open() {
#ifdef _WIN32
    library=LoadLibraryExW(L"nvcuda.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);
#else
    library=dlopen("libcuda.so.1",RTLD_LOCAL|RTLD_NOW);
#endif
    if(!library || !bind(init,"cuInit") || !bind(getDevice,"cuDeviceGet") ||
       !bind(create,"cuCtxCreate_v2") || !bind(destroy,"cuCtxDestroy_v2") ||
       !bind(load,"cuModuleLoadData") || !bind(function,"cuModuleGetFunction") ||
       !bind(memory,"cuMemGetInfo_v2") || !bind(allocate,"cuMemAlloc_v2") ||
       !bind(release,"cuMemFree_v2") || !bind(upload,"cuMemcpyHtoD_v2") ||
       !bind(download,"cuMemcpyDtoH_v2") || !bind(launch,"cuLaunchKernel")) return false;
    Device device;
    return !init(0) && !getDevice(&device,0) && !create(&context,0,device) &&
      !load(&module,scorePTX) && !function(&kernel,module,"score");
  }
  bool begin(const unsigned char *cards,int count,size_t budget) {
    if((size_t)count>capacity){
      clear(); size_t available=0,total=0;
      if(memory(&available,&total)) return false;
      const size_t reserve=std::max<size_t>(1024ULL<<20,total/4),need=(size_t)count*11;
      if(available<reserve || need>available-reserve || need>budget) return false;
      if(allocate(&input,7ULL*count) || allocate(&output,4ULL*count)){clear();return false;}
      capacity=count;
    }
    void *args[]={&input,&output,&count};
    return !upload(input,cards,7ULL*count) &&
      !launch(kernel,(count+127)/128,1,1,128,1,1,0,nullptr,args,nullptr);
  }
  bool finish(int *scores,int count){return !download(scores,output,4ULL*count);}
  size_t allocated() const {return capacity*11;}
  ~CudaScore(){
    if(context){clear();destroy(context);}
    if(library){
#ifdef _WIN32
      FreeLibrary(static_cast<HMODULE>(library));
#else
      dlclose(library);
#endif
    }
  }
};
