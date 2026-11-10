// Verified slot records are the commit point. The index is a reconstructible cache.
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
static double available_memory_mib(void);
int checkpoint_hash(const char *,size_t,char[65]);
static int fault(const char *name){const char *f=getenv("EIGHTMAX_TEST_CHECKPOINT_FAULT");return f && !strcmp(name,f);}
#ifndef _WIN32
#include <sys/file.h>
#endif
int checkpoint_valid(const char *,size_t,size_t,char *,size_t);
static pthread_mutex_t checkpoint_mu=PTHREAD_MUTEX_INITIALIZER;
typedef struct {char paths[3][1200],legacy[3][1200],index[1200],temp[1200],lock[1200];} CheckpointPaths;
static int replace_file(const char *from,const char *to){
#ifdef _WIN32
  return MoveFileExA(from,to,MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)!=0;
#else
  return rename(from,to)==0;
#endif
}
static int durable_write(const char *path,const void *data,size_t size){
  if(fault("temp-create"))return 0;
  // Exclusive creation prevents following a stale link over a committed generation.
  #ifdef _WIN32
  if(_unlink(path) && errno!=ENOENT)return 0;
#else
  if(unlink(path) && errno!=ENOENT)return 0;
#endif
#ifdef _WIN32
  int fd=_open(path,_O_WRONLY|_O_CREAT|_O_EXCL|_O_BINARY,_S_IREAD|_S_IWRITE);
  FILE *f=fd<0?NULL:_fdopen(fd,"wb");
  if(!f){if(fd>=0)_close(fd);return 0;}
#else
  int fd=open(path,O_WRONLY|O_CREAT|O_EXCL,0600);
  FILE *f=fd<0?NULL:fdopen(fd,"wb");
  if(!f){if(fd>=0)close(fd);return 0;}
#endif
  int ok=fwrite(data,1,fault("write")?size/2:size,f)==size && fflush(f)==0 && !fault("flush");
#ifdef _WIN32
  if(ok)ok=_commit(_fileno(f))==0;
#else
  if(ok)ok=fsync(fileno(f))==0;
#endif
  return fclose(f)==0 && ok;
}
static int sync_directory(void){
#ifdef _WIN32
  return 1;
#else
  int fd=open(SAVE_DIR,O_RDONLY);if(fd<0)return 0;
  int ok=fsync(fd)==0;close(fd);return ok;
#endif
}
static int read_file(const char *path,size_t limit,char **data,size_t *n){
  *data=NULL;*n=0;
  struct stat info;
  if(stat(path,&info))return errno==ENOENT?404:500;
  if(!S_ISREG(info.st_mode))return 500;
  FILE *f=fopen(path,"rb");if(!f)return errno==ENOENT?404:500;
  long bytes=-1;if(!fseek(f,0,SEEK_END))bytes=ftell(f);
  int rc=400;
  if(bytes>0 && (unsigned long)bytes<=limit && !fseek(f,0,SEEK_SET)){
    *data=malloc((size_t)bytes+1);*n=(size_t)bytes;
    rc=*data && fread(*data,1,*n,f)==*n && fgetc(f)==EOF && !ferror(f)?200:500;
    if(rc==200)(*data)[*n]=0;
  }
  fclose(f);return rc;
}
#include "checkpoint_io.h"
#include "checkpoint_archive.h"
#define PREFIX 69
#define HEADER 111
typedef unsigned long long Sequence;
typedef struct { int status; Sequence seq,when,bytes; int archive; } Slot;
typedef struct {
  Slot slots[3],legacy[3];
  int latest,previous,oldLatest,oldPrevious,ambiguous,uncertain,rebuilt,repairError,scanError;
  Sequence high;
} Store;
static Sequence lastRepair=0;
static int lastWriteStatus=0;
static int number20(const char *s,Sequence *out){
  Sequence v=0;
  for(int i=0;i<20;i++){
    unsigned digit=(unsigned)(s[i]-'0');
    if(digit>9 || v>(ULLONG_MAX-digit)/10)return 0;
    v=v*10+digit;
  }
  *out=v;return s[20]=='\n';
}
static int cp_filehash(FILE *f,uint64_t n,char hex[65]){
  unsigned char buf[CP_BUFFER],out[32];CpSha sha;
  if(!cp_sha_init(&sha))return 503;int rc=200;
  while(n){size_t want=n<sizeof buf?(size_t)n:sizeof buf;
    if(fread(buf,1,want,f)!=want){rc=ferror(f)?500:400;break;}
    if(cp_stopped()){rc=409;break;}
    if(!cp_sha_add(&sha,buf,want)){rc=503;break;}n-=want;
  }
  if(rc==200 && !cp_sha_end(&sha,out))rc=503;
  cp_sha_close(&sha);if(rc==200)cp_hex(out,hex);return rc;
}
#include "checkpoint_legacy_file.h"
static int cp_open_study(FILE *f,uint64_t bytes,size_t room,char *err,NativeRestore *candidate){
  int64_t pos=cp_tell(f);unsigned char magic[8];int isArchive=fread(magic,1,8,f)==8&&!memcmp(magic,"EMCP36\r\n",8);
  if(pos<0||cp_seek(f,pos,SEEK_SET))return 500;
  if(isArchive)return cp_read_archive(f,bytes,room,err,0,candidate);
  int rc=cp_legacy_native(f,bytes,room,err,candidate);
  if(rc==204){strcpy(err,"Use browser recovery for this table-format legacy study");return 422;}return rc;
}
static uint64_t cp_description(const char *path,int *native){
  *native=0;FILE *f=fopen(path,"rb");if(!f)return 0;
  unsigned char h[24];uint64_t decoded=0;
  if(!cp_seek(f,HEADER,SEEK_SET)&&fread(h,1,24,f)==24&&!memcmp(h,"EMCP36\r\n",8)){
    uint32_t n=cp_u32(h+12);
    if(n && n<=CP_META_MAX){char *text=malloc(n+1);if(text&&fread(text,1,n,f)==n){
      char err[64];JV *v=json_parse(text,n,err,sizeof err);if(v){
        *native=jget(jget(v,"state"),"codec")==NULL;
        decoded=((uint64_t)cp_u32(h+20)<<32)|cp_u32(h+16);
        json_free(v);}
    }free(text);}
  }fclose(f);return decoded;
}
static int cp_validate(FILE *f,uint64_t bytes,size_t room,char *err,int *archive,int writing){
  unsigned char magic[8];int64_t pos=cp_tell(f);
  *archive=bytes>=8 && fread(magic,1,8,f)==8 && !memcmp(magic,"EMCP36\r\n",8);
  if(pos<0||cp_seek(f,pos,SEEK_SET))return 500;
  if(*archive)return cp_verify_archive(f,bytes,room,err,writing);
  if(bytes>8u*1024*1024){int rc=cp_legacy_native(f,bytes,room,err,NULL);if(rc!=204)return rc;}
  // Historical JSON requires canonical JSON and the complete legacy restore oracle.
  // Large studies produced by 3.6 use the record format below instead.
  if(bytes>room/3){strcpy(err,"Legacy JSON exceeds the configured verification workspace. Open the study and save in the streaming format.");return 503;}
  char *buf=malloc((size_t)bytes+1);if(!buf)return 503;
  int rc=500;if(fread(buf,1,(size_t)bytes,f)==bytes){buf[bytes]=0;
    int ok=checkpoint_valid(buf,(size_t)bytes,room-(size_t)bytes,err,256);rc=ok==1?200:ok<0?503:400;}
  free(buf);return rc;
}
// Guarded by checkpoint_mu. Unknown digests must pass the full restore oracle,
// including after a process restart or manual edits to a slot and its outer hash.
static char cp_verified[8][65];static unsigned cp_next_verified;
static void cp_remember(const char *hash){memcpy(cp_verified[cp_next_verified++%8],hash,65);}
static int cp_known(const char *hash){for(int i=0;i<8;i++)if(!strcmp(cp_verified[i],hash))return 1;return 0;}
static int inspect(const char *path,int legacy,Slot *slot,size_t room,FILE **out,size_t *size,char *err){
  struct stat info;if(stat(path,&info))return slot->status=errno==ENOENT?404:500;
  if(!S_ISREG(info.st_mode))return slot->status=500;
  FILE *f=fopen(path,"rb");if(!f)return slot->status=500;
  char head[HEADER],hash[65];int rc=400;size_t off=legacy?0:HEADER;
  if(cp_seek(f,0,SEEK_END))goto done;
  int64_t length=cp_tell(f);if(length<=(int64_t)off||cp_seek(f,0,SEEK_SET))goto done;
  slot->bytes=(uint64_t)length-off;
  if(!legacy){
    if(fread(head,1,HEADER,f)!=HEADER || (memcmp(head,"EM35",4)&&memcmp(head,"EM36",4)) ||head[68]!='\n'||
       !number20(head+PREFIX,&slot->seq)||!slot->seq||!number20(head+PREFIX+21,&slot->when))goto done;
    if(cp_seek(f,PREFIX,SEEK_SET))goto done;
    rc=cp_filehash(f,length-PREFIX,hash);if(rc!=200)goto done;
    if(memcmp(hash,head+4,64)){rc=400;goto done;}
  }
  if(cp_seek(f,off,SEEK_SET)){rc=500;goto done;}
  if(legacy||!cp_known(hash)){
    rc=cp_validate(f,slot->bytes,room,err,&slot->archive,0);if(rc==200&&!legacy)cp_remember(hash);
  }else{unsigned char magic[8];slot->archive=fread(magic,1,8,f)==8&&!memcmp(magic,"EMCP36\r\n",8);rc=200;}
  if(rc==200 && out){if(cp_seek(f,off,SEEK_SET))rc=500;else{*out=f;f=NULL;*size=(size_t)slot->bytes;}}
done:if(f)fclose(f);if(rc!=200)slot->seq=slot->when=0;return slot->status=rc;
}
static int publish(const CheckpointPaths *p,const char *to,const char *data,size_t n,int index){
  if(!durable_write(p->temp,data,n))return 500;
  if(!index && fault("after-slot"))_Exit(87);
  if(fault(index?"index-update":"replace") || (!index && fault("rotation")))return 500;
  if(!replace_file(p->temp,to))return 500;
  if(!index && fault("published"))_Exit(88);
  if(!sync_directory())return 503;
  char *verify=NULL;size_t size=0;int rc=read_file(to,n,&verify,&size);
  int ok=rc==200 && size==n && !memcmp(data,verify,n);free(verify);return ok?200:503;
}
static Sequence index_high(const char *s,size_t n){
  Sequence v=0;char hash[65];
  if(n!=94 || memcmp(s+2," EM35 ",6) || s[n-1]!='\n' || !number20(s+8,&v) ||
     !checkpoint_hash(s,29,hash) || memcmp(hash,s+29,64))return 0;
  return v;
}
static int discover(const CheckpointPaths *p,Store *st,size_t room,char *err){
  memset(st,0,sizeof *st);st->latest=st->previous=st->oldLatest=st->oldPrevious=-1;
  char *index=NULL;size_t len=0;int ir=read_file(p->index,200,&index,&len);
  int rc=200,oldCount=0,invalid=0;
  if(ir>=500){rc=ir;goto done;}
  if(ir==200)st->high=index_high(index,len);
  for(int i=0;i<3;i++){
    Slot *g=&st->slots[i];int result=inspect(p->paths[i],0,g,room,NULL,NULL,err);
    if(result==409){rc=result;goto done;}
    if(result>=500){st->scanError=result;continue;}
    if(result==400)invalid=1;
    if(result!=200)continue;
    for(int j=0;j<i;j++)if(st->slots[j].seq==g->seq)st->ambiguous=1;
    if(st->latest<0 || g->seq>st->slots[st->latest].seq){st->previous=st->latest;st->latest=i;}
    else if(st->previous<0 || g->seq>st->slots[st->previous].seq)st->previous=i;
  }
  st->uncertain=(invalid || st->scanError) && !st->high;
  for(int i=0;i<3;i++){
    int r=inspect(p->legacy[i],1,&st->legacy[i],room,NULL,NULL,err);
    if(r>=500 && st->latest<0){rc=r;goto done;}
    if(r==200){oldCount++;st->oldLatest=i;}
  }
  if(st->latest<0 && oldCount>1){
    int a=len==2?index[0]-'0':-1,b=len==2?index[1]-'0':-1;
    if(a>=0 && a<3 && b>=0 && b<3 && a!=b && st->legacy[a].status==200 && st->legacy[b].status==200){
      st->oldLatest=a;st->oldPrevious=b;
    }else {st->ambiguous=1;st->oldLatest=-1;}
  }
  if(st->latest>=0){
    Sequence latest=st->slots[st->latest].seq;if(st->high<latest)st->high=latest;
    if(!st->ambiguous && !st->uncertain && !st->scanError){
      char record[96],hash[65];
      snprintf(record,sizeof record,"%d%d EM35 %020llu\n",st->latest,st->previous<0?3:st->previous,st->high);
      if(!checkpoint_hash(record,29,hash)){rc=503;goto done;}
      memcpy(record+29,hash,64);record[93]='\n';
      if(len!=94 || memcmp(index,record,94)){
        st->repairError=fault("reconstruction")?500:publish(p,p->index,record,94,1);
        if(st->repairError==200){st->repairError=0;st->rebuilt=1;lastRepair=(Sequence)time(NULL);}
      }
    }
  }
done:free(index);return rc;
}
static int save_generation(const CheckpointPaths *p,Store *st,CpRequest *req,FILE *source,size_t sourceSize,size_t room,char *err){
  if(st->scanError||st->repairError)return st->scanError?st->scanError:st->repairError;
  if(st->uncertain||st->high==ULLONG_MAX){strcpy(err,"Generation history is incomplete. Archive the damaged files first.");return 409;}
  int target=-1;
  for(int i=0;i<3;i++)if(st->slots[i].status==404){target=i;break;}
  if(target<0)for(int i=0;i<3;i++)if(i!=st->latest&&i!=st->previous&&st->slots[i].status==200){target=i;break;}
  if(target<0){strcpy(err,"No safe rotation slot. Archive damaged files first.");return 409;}
  uint64_t expected=req?req->length:sourceSize;
  if(expected>cp_limit())return 413;
  if(!cp_space(expected+HEADER))return 507;
  if(fault("temp-create")||fault("validation"))return 500;
  char tmp[1232];snprintf(tmp,sizeof tmp,"%s.body",p->temp);
  FILE *f=cp_exclusive(tmp);if(!f)return 500;
  char head[HEADER+1]={0},hex[65],readBack[65];unsigned char digest[32];
  snprintf(head+PREFIX,43,"%020llu\n%020llu\n",st->high+1,(Sequence)time(NULL));
  memcpy(head,"EM36",4);head[68]='\n';
  int archive=0,rc=500;CpSha sha;
  if(!cp_sha_init(&sha)){fclose(f);remove(tmp);return 503;}
  if(fwrite(head,1,HEADER,f)!=HEADER||!cp_sha_add(&sha,head+PREFIX,42))goto cleanup;
  uint64_t n=expected;
  if(req){rc=cp_receive(req,f,&sha);n=req->total;if(rc==400)strcpy(err,"Incomplete upload or invalid chunk framing");}
  else{unsigned char buf[CP_BUFFER];rc=200;
    for(uint64_t left=n;left;){size_t take=left<sizeof buf?(size_t)left:sizeof buf;
      if(fread(buf,1,take,source)!=take||fwrite(buf,1,take,f)!=take||!cp_sha_add(&sha,buf,take)){rc=500;break;}left-=take;}}
  if(rc!=200)goto cleanup;
  if(!cp_sha_end(&sha,digest)){rc=503;goto cleanup;}cp_hex(digest,hex);
  if(cp_seek(f,4,SEEK_SET)||fwrite(hex,1,64,f)!=64||!cp_flush(f)){rc=errno==ENOSPC?507:500;goto cleanup;}
  if(cp_seek(f,HEADER,SEEK_SET)){rc=500;goto cleanup;}
  rc=cp_validate(f,n,room,err,&archive,1);if(rc!=200)goto cleanup;
  if(cp_seek(f,PREFIX,SEEK_SET)){rc=500;goto cleanup;}
  rc=cp_filehash(f,n+42,readBack);if(rc!=200||strcmp(hex,readBack)){rc=500;goto cleanup;}
  if(atomic_load(&cp_cancel)){rc=409;goto cleanup;}
  if(req && now_s()>req->deadline){rc=408;goto cleanup;}
  if(fclose(f)){f=NULL;rc=500;goto cleanup;}f=NULL;
  if(fault("after-slot"))_Exit(87);
  if(fault("rotation")||fault("replace")||!replace_file(tmp,p->paths[target])){rc=500;goto cleanup;}
  if(fault("published"))_Exit(88);
  if(!sync_directory()){rc=503;goto cleanup;}
  cp_remember(hex);
  st->previous=st->latest;st->latest=target;st->high++;
  st->slots[target]=(Slot){200,st->high,0,n,archive};number20(head+PREFIX+21,&st->slots[target].when);
  char idx[96],ih[65];snprintf(idx,sizeof idx,"%d%d EM35 %020llu\n",target,st->previous<0?3:st->previous,st->high);
  if(!checkpoint_hash(idx,29,ih)){rc=503;goto cleanup;}memcpy(idx+29,ih,64);idx[93]='\n';
  rc=publish(p,p->index,idx,94,1);
  if(rc==200 && cp_retention()==2 && !st->ambiguous){
    for(int i=0;i<3;i++)if(i!=st->latest&&i!=st->previous&&st->slots[i].status==200){
      if(!remove(p->paths[i])){st->slots[i]=(Slot){0};st->slots[i].status=404;sync_directory();}
    }
  }
  if(rc==200 && fault("ack"))_Exit(89);
cleanup:cp_sha_close(&sha);if(f)fclose(f);remove(tmp);return rc;
}
#include "checkpoint_export.h"
static void cp_send(sock_t s,FILE *f,size_t bytes,int archive){
  char header[256];int len=snprintf(header,sizeof header,"HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %zu\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",archive?"application/vnd.eightmax.checkpoint":"application/json",bytes);
  cp_socket_timeout(s,SO_SNDTIMEO,15);if(!send_all(s,header,(size_t)len))return;
  unsigned char buf[CP_BUFFER];while(bytes){size_t n=bytes<sizeof buf?bytes:sizeof buf;
    if(fread(buf,1,n,f)!=n||!send_all(s,(const char*)buf,n))return;bytes-=n;}
}
static void cp_cleanup_scratch(const CheckpointPaths *p){
  char file[1300];const char *tails[]={".import",".native.raw",".native.archive"};
  for(size_t i=0;i<3;i++){snprintf(file,sizeof file,"%s%s",p->temp,tails[i]);remove(file);}
  remove(p->temp);snprintf(file,sizeof file,"%s.body",p->temp);remove(file);
  snprintf(file,sizeof file,"%s%sautosave.verify.raw",SAVE_DIR,PATHSEP);remove(file);
  snprintf(file,sizeof file,"%s%sautosave.migration.tmp",SAVE_DIR,PATHSEP);remove(file);
  const char prefix[]="autosave.verify.sort.";
#ifdef _WIN32
  snprintf(file,sizeof file,"%s%sautosave.verify.sort.*",SAVE_DIR,PATHSEP);
  WIN32_FIND_DATAA item;HANDLE list=FindFirstFileA(file,&item);if(list==INVALID_HANDLE_VALUE)return;
  do{const char *name=item.cFileName;
#else
  DIR *list=opendir(SAVE_DIR);if(!list)return;struct dirent *item;
  while((item=readdir(list))){const char *name=item->d_name;
#endif
    if(!strncmp(name,prefix,sizeof prefix-1)){const char *tail=name+sizeof prefix-1;
      if(*tail&&!tail[strspn(tail,"0123456789")]){snprintf(file,sizeof file,"%s%s%s",SAVE_DIR,PATHSEP,name);remove(file);}}
#ifdef _WIN32
  }while(FindNextFileA(list,&item));FindClose(list);
#else
  }closedir(list);
#endif
}
static void checkpoint_api(sock_t s,const char *method,const char *part,CpRequest *request){
  int get=!strcmp(method,"GET"),post=!strcmp(method,"POST");
  int write=post&&!strcmp(part,"write"),status=get&&!strcmp(part,"status"),prev=!strcmp(part,"previous");
  int legacy=!strncmp(part,"legacy-",7),adopt=post&&!strncmp(part,"adopt-",6);
  int id=-1;
  int native=post&&!strncmp(part,"native-",7);
  int nativeSave=native&&!strcmp(part+7,"save"),nativeUpload=native&&!strcmp(part+7,"upload");
  if(native){part+=7;prev=!strcmp(part,"previous");}
  if(legacy||adopt||!strncmp(part,"slot-",5)){
    const char *v=part+(legacy?7:adopt?6:5);if(strlen(v)==1 && *v>='0' && *v<='2')id=*v-'0';
  }
  if(native && !(nativeSave||nativeUpload||id>=0||prev||!strcmp(part,"latest"))){respond_err(s,404,"Unknown native checkpoint command");return;}
  if(!native && !write && !(adopt&&id>=0) && !(get&&(id>=0||status||prev||!strcmp(part,"latest")))){respond_err(s,404,"Unknown checkpoint");return;}
  NativeRestore candidate={0};
  if(native){
    if(!claim_game()){respond_err(s,409,"Another solver job is active");return;}
    pthread_mutex_lock(&MW_MU);
    if(MW_RUNNING||MW_RESTORING||(nativeSave && !MW_ARCHIVE_META)){
      pthread_mutex_unlock(&MW_MU);release_game();respond_err(s,409,"Stop training or open a native checkpoint first");return;
    }
    // 4.0: a restore replaces MWG, so it waits for no evaluation to be reading it.
    if(!nativeSave && MW_READERS){pthread_mutex_unlock(&MW_MU);release_game();respond_err(s,409,"Evaluations are reading the open study; cancel them or wait for them to finish first");return;}
    MW_RESTORING=1;candidate.budget=fmin(restore_budget_mib(),policy_value("EIGHTMAX_RESTORE_MIB",65536,1,65536));
    pthread_mutex_unlock(&MW_MU);
  }
  CheckpointPaths p;
  const char *names[]={"autosave.emstudy","autosave.previous.emstudy","autosave.third.emstudy"};
  for(int i=0;i<3;i++){
    snprintf(p.paths[i],1200,"%s%sautosave.%d.em35",SAVE_DIR,PATHSEP,i);
    snprintf(p.legacy[i],1200,"%s%s%s",SAVE_DIR,PATHSEP,names[i]);
  }
  snprintf(p.temp,1200,"%s%sautosave.index.tmp",SAVE_DIR,PATHSEP);
  snprintf(p.index,1200,"%s%sautosave.index",SAVE_DIR,PATHSEP);
  snprintf(p.lock,1200,"%s%sautosave.lock",SAVE_DIR,PATHSEP);
  pthread_mutex_lock(&checkpoint_mu);
#ifdef _WIN32
  HANDLE lock=CreateFileA(p.lock,GENERIC_READ|GENERIC_WRITE,0,NULL,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL,NULL);
  int locked=lock!=INVALID_HANDLE_VALUE;
#else
  int lock=open(p.lock,O_CREAT|O_RDWR,0600);int locked=lock>=0 && flock(lock,LOCK_EX)==0;
#endif
  FILE *data=NULL; char err[256]="Checkpoint storage or verification memory unavailable",report[1200];
  size_t bytes=0;int rc=503;Store st;Slot selected={0};
  double mib=fmin(512,PROCESS_LIMIT_MIB-resident_mib()-192),available=available_memory_mib();
  if(available>=0)mib=fmin(mib,available/2-128);
  if(locked && mib>=32){
    size_t room=(size_t)mib<<20;cp_cleanup_scratch(&p);
    if(nativeUpload){
      char importPath[1232];snprintf(importPath,sizeof importPath,"%s.import",p.temp);
      FILE *upload=cp_exclusive(importPath);CpSha digest;
      rc=!upload?500:!cp_sha_init(&digest)?503:200;
      if(rc==200){rc=cp_receive(request,upload,&digest);cp_sha_close(&digest);}
      if(rc==200){if(cp_seek(upload,0,SEEK_SET))rc=500;else rc=cp_open_study(upload,request->total,room,err,&candidate);}
      if(upload){fclose(upload);remove(importPath);}
    }else if((get||native) && id>=0)rc=inspect(legacy?p.legacy[id]:p.paths[id],legacy,&selected,room,&data,&bytes,err);
    else if((rc=discover(&p,&st,room,err))==200){
      if(nativeSave){
        if(st.ambiguous||st.uncertain){rc=409;strcpy(err,"Resolve checkpoint generation ambiguity before saving");}
        else rc=save_native_session(&p,&st,room,err);
      }else if(status){
        int isNative=0;Sequence decoded=st.latest<0?0:cp_description(p.paths[st.latest],&isNative);
        bytes=snprintf(report,sizeof report,"{\"estimatedNextSaveBytes\":%llu,\"decodedBytes\":%llu,\"latestNative\":%s,\"latestCodec\":\"%s\",\"freeBytes\":%llu,\"retainedGenerations\":%u,\"occupiedBytes\":%llu,\"sizeBytes\":%llu,\"maxBytes\":%llu,\"reserveBytes\":%llu,\"transferBufferBytes\":%d,\"generation\":\"%llu\",\"lastSaveUnix\":%llu,\"latestSlot\":%d,\"previousSlot\":%d,\"indexHealth\":\"%s\",\"reconstructed\":%s,\"lastRepairUnix\":%llu,\"lastWriteError\":%d,\"slots\":[%d,%d,%d],\"sequences\":[\"%llu\",\"%llu\",\"%llu\"],\"legacySlots\":[%d,%d,%d]}",
          decoded?(Sequence)cp_forecast(st.slots[st.latest].bytes,decoded):0ULL,decoded,isNative?"true":"false",decoded?"EMCP36 lossless zero runs or raw blocks":"legacy JSON or empty",(Sequence)cp_available(),cp_retention(),(Sequence)(st.slots[0].bytes+st.slots[1].bytes+st.slots[2].bytes),
          st.latest<0?0ULL:st.slots[st.latest].bytes,(Sequence)cp_limit(),(Sequence)cp_reserve(),CP_BUFFER,st.latest<0?0ULL:st.slots[st.latest].seq,st.latest<0?0ULL:st.slots[st.latest].when,st.latest,st.previous,st.scanError?"slot unreadable":st.uncertain?"incomplete history":st.ambiguous?"ambiguous":st.repairError?"repair failed":st.latest>=0?"verified":st.oldLatest>=0?"legacy":"empty",st.rebuilt?"true":"false",lastRepair,lastWriteStatus,
          st.slots[0].status,st.slots[1].status,st.slots[2].status,st.slots[0].seq,st.slots[1].seq,st.slots[2].seq,st.legacy[0].status,st.legacy[1].status,st.legacy[2].status);
      }else if(adopt && (st.latest>=0||st.legacy[id].status!=200)){rc=409;strcpy(err,"Candidate unavailable or already migrated.");}
      else if(st.ambiguous && !adopt){rc=409;strcpy(err,"Checkpoint order is ambiguous. Open Checkpoint recovery details and choose a candidate.");}
      else if(write || adopt){
        int old=adopt?id:st.latest<0?st.oldLatest:-1;
        // Validate an inbound body before a legacy migration has any visible effect.
        FILE *incoming=NULL;size_t incomingSize=0;char mig[1200];snprintf(mig,sizeof mig,"%s%sautosave.migration.tmp",SAVE_DIR,PATHSEP);
        if(old>=0&&write){
          CpSha sha;
          if(!cp_space(request->length))rc=507;
          else if(!(incoming=cp_exclusive(mig)))rc=500;
          else if(!cp_sha_init(&sha))rc=503;
          else {rc=cp_receive(request,incoming,&sha);cp_sha_close(&sha);incomingSize=(size_t)request->total;
            int arc=0;if(rc==200){if(cp_seek(incoming,0,SEEK_SET))rc=500;else rc=cp_validate(incoming,incomingSize,room,err,&arc,1);}
            if(rc==200&&cp_seek(incoming,0,SEEK_SET))rc=500;}
        }
        if(old>=0 && rc==200){
          rc=inspect(p.legacy[old],1,&selected,room,&data,&bytes,err);
          if(rc==200)rc=save_generation(&p,&st,NULL,data,bytes,room,err);
          if(data){fclose(data);data=NULL;}
        }
        if(write && rc==200)rc=save_generation(&p,&st,incoming?NULL:request,incoming,incomingSize,room,err);
        if(incoming){fclose(incoming);remove(mig);}
      }else{
        legacy=st.latest<0;id=legacy?(prev?st.oldPrevious:st.oldLatest):(prev?st.previous:st.latest);
        rc=id<0?(st.scanError?st.scanError:404):inspect(legacy?p.legacy[id]:p.paths[id],legacy,&selected,room,&data,&bytes,err);
      }
    }
    if(native && !nativeSave && !nativeUpload && rc==200){
      rc=cp_open_study(data,bytes,room,err,&candidate);
    }
  }
  if(native){
    pthread_mutex_lock(&MW_MU);
    if(rc==200 && !nativeSave && cp_stopped()){rc=409;strcpy(err,"Restoration cancelled");}
    if(rc==200 && candidate.game){
      JB b;jb_init(&b);mw_info(candidate.game,&b);
      char parseError[64];JV *v=b.failed?NULL:json_parse(b.s,b.n,parseError,sizeof parseError);
      if(!v){rc=503;strcpy(err,"Insufficient memory for restored study status");}
      else{
        mw_free(MWG);free(MW_ARCHIVE_META);MW_GEN++;
        MWG=candidate.game;candidate.game=NULL;MW_ARCHIVE_META=candidate.meta;candidate.meta=NULL;
        {long long x=0;MW_IT=em_jv_i64(jget(v,"iterations"),0,LLONG_MAX,&x)==EM_NUM_OK?x:0;x=0;MW_TARGET=MW_IT;MW_DEALS=em_jv_i64(jget(v,"trainingDeals"),0,LLONG_MAX,&x)==EM_NUM_OK?x:0;}
        MW_TABLE_MIB=jnum(jget(v,"tableMiB"),0);MW_ERR[0]=0;MW_ELAPSED=0;
      }json_free(v);jb_free(&b);
    }
    MW_RESTORING=0;pthread_mutex_unlock(&MW_MU);release_game();mw_free(candidate.game);free(candidate.meta);
  }
#ifdef _WIN32
  if(locked)CloseHandle(lock);
#else
  if(lock>=0)close(lock);
#endif
  if(write||adopt||nativeSave)lastWriteStatus=rc==200?0:rc;
  pthread_mutex_unlock(&checkpoint_mu);
  if(rc==200 && (write||adopt||native))respond_ok(s);
  else if(rc==200 && status)respond(s,200,"application/json",report,bytes);
  else if(rc==200)cp_send(s,data,bytes,selected.archive);
  else respond_err(s,rc,rc==507?"Insufficient checkpoint disk space or configured free-space reserve":rc==413?"Checkpoint exceeds configured storage limit":rc==408?"Checkpoint transfer timed out":rc==409&&atomic_load(&cp_cancel)?"Checkpoint save cancelled":rc==404?"No saved checkpoint":rc==500?"Checkpoint file operation failed. Check storage space and permissions.":err);
  if(data)fclose(data);
}
