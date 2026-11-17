// EMCP36 v1. Hash the fixed header, metadata and each ordered block descriptor.
// Each descriptor contains the SHA-256 of its decoded bytes.
#pragma once
#define CP_BLOCK (256u*1024)
int checkpoint_spec(const char *,size_t,size_t,char **,int *,char *,size_t);
int checkpoint_verify_tables(FILE *,const char *,size_t,size_t,char *,size_t,int (*)(void));
int mw_verify_stream(FILE *,uint64_t,const char *,int,const char *,char *,int,int (*)(void),int (*)(uint64_t));
static int cp_stopped(void){return atomic_load(&cp_active)&&atomic_load(&cp_cancel);}
static uint32_t cp_u32(const unsigned char *p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static int cp_unpack(const unsigned char *in,size_t len,unsigned char *out,size_t size){
  size_t pos=0,w=0;while(pos<len){unsigned cmd=in[pos++],n=(cmd&127)+1;
    if(n>size-w)return 0;
    if(cmd&128)memset(out+w,0,n);
    else{if(n>len-pos)return 0;memcpy(out+w,in+pos,n);pos+=n;}w+=n;
  }return w==size;
}
typedef struct {double budget;MW *game;char *meta;} NativeRestore;
static int cp_read_archive(FILE *f,uint64_t bytes,size_t room,char *err,int writing,NativeRestore *restore){
  unsigned char header[24],desc[40],digest[32],stored[32];int rc=400,it=0;
  char *meta=NULL,*spec=NULL,tmp[1200];unsigned char *packed=NULL,*raw=NULL;FILE *decoded=NULL;
  CpSha root;if(!cp_sha_init(&root))return 503;
  strcpy(err,"Invalid or incomplete streaming checkpoint");
  if(bytes<56||fread(header,1,24,f)!=24||memcmp(header,"EMCP36\r\n",8)||cp_u32(header+8)!=1)goto done;
  uint32_t metaLen=cp_u32(header+12);uint64_t total=(uint64_t)cp_u32(header+20)<<32|cp_u32(header+16);
  if(!total||!metaLen||metaLen>CP_META_MAX||metaLen>bytes-56)goto done;
  if(total>(writing?cp_limit():(UINT64_C(16384)<<20))){rc=413;goto done;}
  meta=malloc(metaLen+1);raw=malloc(CP_BLOCK);packed=malloc(CP_BLOCK);
  if(!meta||!raw||!packed){rc=503;goto done;}meta[metaLen]=0;
  if(fread(meta,1,metaLen,f)!=metaLen||!cp_sha_add(&root,header,24)||!cp_sha_add(&root,meta,metaLen))goto done;
  rc=checkpoint_spec(meta,metaLen,room,&spec,&it,err,256);if(rc!=200)goto done;
  if(restore && !strcmp(spec,"#tables1")){strcpy(err,"This table-format study opens with Load saved training or Recover automatic checkpoint");rc=422;goto done;}
  if(!restore && writing && !strcmp(spec,"#tables1") && total>(UINT64_C(2)<<30)){strcpy(err,"Table-format checkpoint exceeds the browser restoration policy");rc=422;goto done;}
  if(restore){atomic_store(&cp_phase,CP_DECODE);cp_report(0,total);}
  if(!cp_space(total)){rc=507;goto done;}
  snprintf(tmp,sizeof tmp,"%s%sautosave.verify.raw",SAVE_DIR,PATHSEP);
  decoded=cp_exclusive(tmp);if(!decoded){rc=500;goto done;}
  uint64_t consumed=24+metaLen;
  for(uint64_t left=total;left;){
    rc=400;if(cp_stopped()){rc=409;goto done;}
    if(bytes-consumed<72||fread(desc,1,40,f)!=40)goto done;
    uint32_t n=cp_u32(desc),wire=cp_u32(desc+4);
    if(n!=(left<CP_BLOCK?(uint32_t)left:CP_BLOCK)||wire==0||wire>n||wire>bytes-consumed-72)goto done;
    if(fread(packed,1,wire,f)!=wire)goto done;
    unsigned char *data=packed;if(wire<n){if(!cp_unpack(packed,wire,raw,n))goto done;data=raw;}
    CpSha block;if(!cp_sha_init(&block)){rc=503;goto done;}
    int ok=cp_sha_add(&block,data,n)&&cp_sha_end(&block,digest);cp_sha_close(&block);
    if(!ok||memcmp(digest,desc+8,32)||!cp_sha_add(&root,desc,40)){strcpy(err,"Streaming block checksum mismatch");goto done;}
    if(!cp_space(n)){rc=507;goto done;}
    if(fwrite(data,1,n,decoded)!=n){rc=errno==ENOSPC?507:500;goto done;}
    consumed+=40+wire;left-=n;if(restore)cp_report(total-left,total);
  }
  rc=400;if(bytes-consumed!=32||fread(stored,1,32,f)!=32||!cp_sha_end(&root,digest)||memcmp(digest,stored,32)){
    strcpy(err,"Streaming checkpoint final SHA-256 mismatch");goto done;}
  if(fflush(decoded)||cp_seek(decoded,0,SEEK_SET)){rc=errno==ENOSPC?507:500;goto done;}
  if(restore){
    atomic_store(&cp_phase,CP_RESTORE);cp_report(0,total);
    rc=mw_load_stream(decoded,total,spec,restore->budget,it,&restore->game,err,256,cp_stopped,cp_report);
    if(rc==200){restore->meta=meta;meta=NULL;}
  }else rc=!strcmp(spec,"#tables1")?checkpoint_verify_tables(decoded,meta,metaLen,room,err,256,cp_stopped):mw_verify_stream(decoded,total,spec,it,SAVE_DIR,err,256,cp_stopped,cp_space);
done:
  cp_sha_close(&root);free(raw);free(packed);free(meta);free(spec);
  if(decoded){fclose(decoded);remove(tmp);}return rc;
}

static int cp_verify_archive(FILE *f,uint64_t bytes,size_t room,char *err,int writing){
  return cp_read_archive(f,bytes,room,err,writing,NULL);
}
