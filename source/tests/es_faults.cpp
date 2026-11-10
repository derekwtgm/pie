// Linux test executable only. Fail each PMR allocation in the first update
// after a warm checkpoint, once per process-local allocation ordinal.
#include <new>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>
#include <cstdio>
#include "../native/mw.h"
static long countdown=-1;
void *operator new(std::size_t n,std::align_val_t alignment) {
  if(countdown==0){countdown=-1;throw std::bad_alloc();}
  if(countdown>0)--countdown;
  void *p=nullptr;
  const size_t a=std::max(sizeof(void*),(size_t)alignment);
  if(posix_memalign(&p,a,n?n:1))throw std::bad_alloc();
  return p;
}
void operator delete(void *p,std::align_val_t) noexcept {free(p);}
void operator delete(void *p,size_t,std::align_val_t) noexcept {free(p);}
using Bytes=std::vector<unsigned char>;
static Bytes state(MW *m) {
  unsigned char *ptr=nullptr;auto n=mw_export(m,&ptr);
  if(!ptr||!n)std::abort();Bytes out(ptr,ptr+n);free(ptr);return out;
}
int main(int argc,char **argv){
  if(argc!=2)return 2;
  std::ifstream in(argv[1]);std::string spec{std::istreambuf_iterator<char>(in),{}};
  char err[512]={};
  auto create=[&](){auto m=mw_create(spec.data(),spec.size(),128,err,sizeof err);if(!m)std::abort();return m;};
  auto train=[&](MW *m,int its){if(!mw_train(m,its,1,nullptr,nullptr,nullptr,err,sizeof err))std::abort();};
  auto ref=create();train(ref,3);const auto before=state(ref);train(ref,1);const auto after=state(ref);mw_free(ref);
  for(long ordinal=0;ordinal<10000;ordinal++){
    auto m=create();if(!mw_import(m,before.data(),before.size(),err,sizeof err))return 3;
    countdown=ordinal;train(m,1);bool fired=countdown==-1;countdown=-1;
    const auto actual=state(m);mw_free(m);
    if(actual!=(fired?before:after)){fprintf(stderr,"Mismatch at allocation %ld\n",ordinal);return 4;}
    if(!fired){printf("%ld allocation failures rolled back exactly\n",ordinal);return ordinal?0:5;}
    auto resume=create();if(!mw_import(resume,actual.data(),actual.size(),err,sizeof err))return 6;
    train(resume,1);if(state(resume)!=after)return 7;mw_free(resume);
  }
  return 8;
}
