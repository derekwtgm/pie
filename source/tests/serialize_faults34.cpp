// Inject an allocation failure at each ordinal while exporting a trained study.
// Reset injection before checking that a second export exactly matches the first.
#include "../native/mw.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <new>
#include <string>
#include <vector>
static int countdown=-1;
static bool deny(){if(countdown<0)return false;if(countdown--==0){countdown=-1;return true;}return false;}
extern "C" void *__real_malloc(size_t);
extern "C" void *__real_realloc(void*,size_t);
extern "C" void *__wrap_malloc(size_t n){return deny()?nullptr:__real_malloc(n);}
extern "C" void *__wrap_realloc(void *p,size_t n){return deny()?nullptr:__real_realloc(p,n);}
void *operator new(size_t n){if(!deny())if(void *p=__real_malloc(n?n:1))return p;throw std::bad_alloc();}
void operator delete(void *p) noexcept{std::free(p);}
void operator delete(void *p,size_t) noexcept{std::free(p);}
int main(int argc,char **argv){
 if(argc!=2)return 2;
 std::ifstream f(argv[1]);std::string spec{std::istreambuf_iterator<char>(f),{}};
 char error[256]={};auto m=mw_create(spec.data(),spec.size(),128,error,sizeof error);
 if(!m||!mw_train(m,5,1,nullptr,nullptr,nullptr,error,sizeof error))return 3;
 unsigned char *bytes=nullptr;size_t n=mw_export(m,&bytes);if(!n)return 4;
 std::vector<unsigned char> before(bytes,bytes+n);std::free(bytes);int failures=0;
 for(int ordinal=0;ordinal<1024;ordinal++){
   countdown=ordinal;bytes=nullptr;size_t got=mw_export(m,&bytes);bool exhausted=countdown>=0;countdown=-1;
   if(!got){if(bytes)return 5;failures++;}
   else if(got!=n || std::memcmp(bytes,before.data(),n))return 6;
   std::free(bytes);
   got=mw_export(m,&bytes);if(got!=n || std::memcmp(bytes,before.data(),n))return 7;std::free(bytes);
   if(exhausted)break;
 }
 mw_free(m);std::printf("Rejected %d allocations; every retry bit-identical\n",failures);
 return failures>0?0:8;
}
