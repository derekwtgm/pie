// HTTP body reader. The upload and the disk record have independent length and hash checks.
#pragma once
#include "checkpoint_sha.h"
#ifndef _WIN32
#include <sys/statvfs.h>
#endif
enum { CP_BUFFER=65536, CP_META_MAX=1048576 };
#ifdef _WIN32
#define cp_seek _fseeki64
#define cp_tell _ftelli64
#else
#define cp_seek fseeko
#define cp_tell ftello
#endif
static uint64_t policy_value(const char *key,uint64_t fallback,uint64_t min,uint64_t max){
  const char *s=getenv(key);if(!s||!*s||s[strspn(s,"0123456789")])return fallback;
  errno=0;unsigned long long v=strtoull(s,NULL,10);return !errno && v>=min && v<=max?v:fallback;
}
static uint64_t cp_limit(void){return policy_value("EIGHTMAX_CHECKPOINT_MIB",2048,1,16384)<<20;}
static uint64_t cp_reserve(void){return policy_value("EIGHTMAX_CHECKPOINT_RESERVE_MIB",128,0,1048576)<<20;}
static uint64_t cp_available(void){
#ifdef _WIN32
  ULARGE_INTEGER avail;if(!GetDiskFreeSpaceExA(SAVE_DIR,&avail,NULL,NULL))return 0;uint64_t freeBytes=avail.QuadPart;
#else
  struct statvfs fs;if(statvfs(SAVE_DIR,&fs))return 0;uint64_t freeBytes=(uint64_t)fs.f_bavail*fs.f_frsize;
#endif
  // Fault injection can lower the reported capacity only.
  if(getenv("EIGHTMAX_TEST_CHECKPOINT_DISK_BYTES")){
    uint64_t test=policy_value("EIGHTMAX_TEST_CHECKPOINT_DISK_BYTES",freeBytes,0,UINT64_MAX);
    if(test<freeBytes)freeBytes=test;
  }
  return freeBytes;
}
static int cp_space(uint64_t amount){
  uint64_t freeBytes=cp_available(),reserve=cp_reserve();
  return freeBytes>=reserve && freeBytes-reserve>=amount;
}
static unsigned cp_retention(void){return (unsigned)policy_value("EIGHTMAX_CHECKPOINT_GENERATIONS",3,2,3);}
static uint64_t cp_forecast(uint64_t wire,uint64_t decoded){
  // Existing generations already occupy their disk blocks. Never count a future
  // rotation as free space. Decoded verification and external merge runs coexist.
  uint64_t blocks=(decoded+262143)/262144;
  return (wire?wire:decoded+40*blocks+CP_META_MAX+56)+3*decoded+(4u<<20);

}
static void cp_socket_timeout(sock_t s,int option,int seconds){
#ifdef _WIN32
  DWORD ms=seconds*1000;setsockopt(s,SOL_SOCKET,option,(const char*)&ms,sizeof ms);
#else
  struct timeval tv={seconds,0};setsockopt(s,SOL_SOCKET,option,&tv,sizeof tv);
#endif
}
typedef struct {
  sock_t socket;const char *initial;size_t available;uint64_t length,total;int chunked;
  unsigned char buf[CP_BUFFER];size_t start,end;double deadline,lastByte,idleSeconds;
} CpRequest;
static _Atomic unsigned long long cp_progress,cp_expected;
static _Atomic int cp_active,cp_cancel;
enum {CP_TRANSFER,CP_VERIFY,CP_DECODE,CP_RESTORE,CP_ENCODE,CP_COMMIT};
static const char *cp_phases[]={"transfer","verify","decompress","rebuild tables","encode","commit"};
static _Atomic int cp_phase;
static void cp_report(uint64_t done,uint64_t total){atomic_store(&cp_expected,total);atomic_store(&cp_progress,done);}
static void cp_begin(uint64_t total){atomic_store(&cp_cancel,0);atomic_store(&cp_phase,CP_TRANSFER);cp_report(0,total);atomic_store(&cp_active,1);}
static int cp_read(CpRequest *r,const unsigned char **ptr,size_t wanted){
  if(atomic_load(&cp_cancel))return -409;
  if(now_s()>r->deadline)return -408;
  if(r->available){size_t n=r->available<wanted?r->available:wanted;*ptr=(const unsigned char*)r->initial;r->initial+=n;r->available-=n;return (int)n;}
  if(r->start==r->end){
    for(;;){
      int n=recv(r->socket,(char*)r->buf,sizeof r->buf,0);
      if(atomic_load(&cp_cancel))return -409;
      double now=now_s();if(now>r->deadline)return -408;
      if(n>0){r->lastByte=now;r->start=0;r->end=(size_t)n;break;}
      if(n==0)return -400;
#ifdef _WIN32
      int e=WSAGetLastError();if(e!=WSAETIMEDOUT && e!=WSAEWOULDBLOCK && e!=WSAEINTR)return -400;
#else
      if(errno!=EAGAIN && errno!=EWOULDBLOCK && errno!=EINTR)return -400;
#endif
      if(now-r->lastByte>=r->idleSeconds)return -408;
    }
  }
  size_t n=r->end-r->start;if(n>wanted)n=wanted;*ptr=r->buf+r->start;r->start+=n;return (int)n;
}
static int cp_line(CpRequest *r,char out[32]){
  for(unsigned i=0;i<31;i++){const unsigned char *v;int n=cp_read(r,&v,1);if(n<0)return -n;
    if(*v=='\r'){n=cp_read(r,&v,1);if(n<0)return -n;out[i]=0;return *v=='\n'?200:400;}
    if(*v<32||*v>126)return 400;out[i]=(char)*v;
  }return 400;
}
static int cp_receive(CpRequest *r,FILE *f,CpSha *sha){
  uint64_t limit=cp_limit(),roomChecked=0;
  unsigned char header[24];size_t collected=0;
  r->lastByte=now_s();r->idleSeconds=(double)policy_value("EIGHTMAX_CHECKPOINT_IDLE_SECONDS",15,1,300);
  cp_socket_timeout(r->socket,SO_RCVTIMEO,1);
  r->deadline=now_s()+policy_value("EIGHTMAX_CHECKPOINT_SECONDS",900,1,7200);
  do{
    uint64_t left=r->length;
    if(r->chunked){char line[32];int rc=cp_line(r,line);if(rc!=200)return rc;
      size_t digits=strspn(line,"0123456789abcdefABCDEF");if(!digits||digits>16||line[digits])return 400;
      left=strtoull(line,NULL,16);if(!left){rc=cp_line(r,line);return rc!=200?rc:*line||!r->total||r->available||r->end>r->start?400:200;}
    }
    if(left>limit-r->total)return 413;
    while(left){
      if(!roomChecked){roomChecked=left<(4u<<20)?left:(4u<<20);if(!cp_space(roomChecked))return 507;}
      const unsigned char *bytes;size_t want=left<CP_BUFFER?(size_t)left:CP_BUFFER;if(want>roomChecked)want=(size_t)roomChecked;
      int n=cp_read(r,&bytes,want);if(n<0)return -n;
      if(collected<sizeof header){
        size_t take=(size_t)n<sizeof header-collected?(size_t)n:sizeof header-collected;
        memcpy(header+collected,bytes,take);collected+=take;
        if(collected==sizeof header && !memcmp(header,"EMCP36\r\n",8)){
          uint64_t decoded=0;for(unsigned j=0;j<8;j++)decoded|=(uint64_t)header[16+j]<<(8*j);
          if(!decoded||decoded>limit)return 413;
          if(!cp_space(cp_forecast(r->length,decoded)))return 507;
        }
      }
      if(fwrite(bytes,1,n,f)!=(size_t)n || fault("write"))return errno==ENOSPC?507:500;
      if(!cp_sha_add(sha,bytes,n))return 503;
      left-=n;roomChecked-=n;r->total+=n;atomic_store(&cp_progress,r->total);
    }
    if(r->chunked){char line[32];int rc=cp_line(r,line);if(rc!=200||*line)return rc==200?400:rc;}
  }while(r->chunked);
  return r->total&&r->total==r->length&&!r->available&&r->start==r->end?200:400;
}
static FILE *cp_exclusive(const char *path){
  if(remove(path)&&errno!=ENOENT)return NULL;
#ifdef _WIN32
  int fd=_open(path,_O_RDWR|_O_CREAT|_O_EXCL|_O_BINARY,_S_IREAD|_S_IWRITE);if(fd<0)return NULL;FILE *f=_fdopen(fd,"w+b");if(!f)_close(fd);
#else
  int fd=open(path,O_RDWR|O_CREAT|O_EXCL,0600);if(fd<0)return NULL;FILE *f=fdopen(fd,"w+b");if(!f)close(fd);
#endif
  return f;
}
static int cp_flush(FILE *f){
  if(fflush(f)||fault("flush"))return 0;
#ifdef _WIN32
  return _commit(_fileno(f))==0;
#else
  return fsync(fileno(f))==0;
#endif
}
