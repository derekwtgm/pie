#include "mw.h"
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
int main(int argc,char **argv){
  if(argc!=4)return 2;
  std::ifstream spec(argv[1]);std::string json((std::istreambuf_iterator<char>(spec)),{});char error[512]={};
  MW *m=mw_create(json.data(),json.size(),std::stod(argv[3]),error,sizeof error);if(!m){std::cerr<<error;return 1;}
  auto advance=[&](int n){return mw_train(m,n,2,nullptr,nullptr,nullptr,error,sizeof error)==1;};
  auto snapshot=[&](std::string name){
    auto path=std::filesystem::path(argv[2])/name;FILE *f=fopen(path.string().c_str(),"w+b");if(!f)return false;
    size_t bytes=mw_write_stream(m,f,nullptr);return fclose(f)==0&&bytes>0;
  };
  for(unsigned target:{128u,256u,512u,1024u,2050u}){
    size_t last=mw_stream_size(m);
    while(last<uint64_t(target)*1048576){
      if(!advance(4000)){std::cerr<<error;mw_free(m);return 1;}size_t next=mw_stream_size(m);
      if(next==last){JB j;jb_init(&j);mw_info(m,&j);std::cout<<"LIMIT "<<target<<" "<<j.s<<std::endl;jb_free(&j);mw_free(m);return 0;}last=next;
    }
    if(!snapshot(std::to_string(target)+".state")){mw_free(m);return 1;}
    JB j;jb_init(&j);mw_info(m,&j);std::cout<<"SAVED "<<target<<" "<<j.s<<std::endl;jb_free(&j);
    if(!advance(1)||!snapshot(std::to_string(target)+".next")){mw_free(m);return 1;}
  }
  mw_free(m);
}
