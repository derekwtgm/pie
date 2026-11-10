// Build against either release's mw.cpp and json.o. Stops at the first
// 64-update progress boundary after the monotonic wall-clock deadline.
#include "mw.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <string>
using Clock=std::chrono::steady_clock;
struct Deadline {Clock::time_point end; volatile int stop;};
static void check(void *ctx,long long,long long){
  auto &d=*static_cast<Deadline*>(ctx);
  if(Clock::now()>=d.end)d.stop=1;
}
int main(int argc,char **argv){
  if(argc!=5)return 2;
  std::ifstream file(argv[1]);std::string spec{std::istreambuf_iterator<char>(file),{}};
  char error[512]={};
  auto m=mw_create(spec.data(),spec.size(),512,error,sizeof(error));
  if(!m){std::fprintf(stderr,"%s\n",error);return 1;}
  auto begin=Clock::now();Deadline d{begin+std::chrono::milliseconds(std::stoi(argv[2])),0};
  if(!mw_train(m,10000000,std::stoi(argv[3]),&d.stop,check,&d,error,sizeof(error)))return 1;
  auto seconds=std::chrono::duration<double>(Clock::now()-begin).count();
  unsigned char *state=nullptr;auto len=mw_export(m,&state);std::ofstream out(argv[4],std::ios::binary);
  out.write((char*)state,len);free(state);mw_free(m);std::printf("%.6f\n",seconds);return !out.good();
}
