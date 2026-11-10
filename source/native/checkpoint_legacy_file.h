// Verify legacy base64 EMMW4 envelopes without instantiating a QuickJS string
// for the strategy. The exact original JSON payload and native CRC are checked.
int checkpoint_legacy_meta(const char *,size_t,size_t,char **,char *);
static int cp_legacy_native(FILE *f,uint64_t size,size_t room,char *err,NativeRestore *restore){
  const char marker[]="\"nativeEMMW4\":\"";int64_t origin=cp_tell(f);
  size_t span=size<CP_META_MAX?(size_t)size:CP_META_MAX;
  char *small=malloc(2*span+2),*result=NULL,*spec=NULL;FILE *raw=NULL;JV *fields=NULL;int rc=503,it=0;char tmp[1200];
  if(!small)return rc;
  if(fread(small,1,span,f)!=span){rc=500;goto done;}small[span]=0;
  char *key=strstr(small,marker);if(!key){rc=204;goto done;}
  uint64_t first=(uint64_t)(key-small)+sizeof marker-1,end=size>span?size-span:0;if(end<first)end=first;
  if(cp_seek(f,origin+end,SEEK_SET)){rc=500;goto done;}
  size_t tail=size-end;if(fread(small+first,1,tail,f)!=tail){rc=500;goto done;}
  char *quote=memchr(small+first,'"',tail);if(!quote){rc=400;goto done;}
  size_t skip=(size_t)(quote-(small+first));uint64_t chars=end+skip-first;
  if(!chars||chars%4){rc=400;goto done;}
  memmove(small+first,quote,tail-skip);size_t shortLen=(size_t)first+tail-skip;small[shortLen]=0;
  rc=checkpoint_legacy_meta(small,shortLen,room,&result,err);if(rc!=200)goto done;
  fields=json_parse(result,strlen(result),err,256);if(!fields){rc=400;goto done;}
  uint64_t start=(uint64_t)jnum(jget(fields,"start"),0),payload=(uint64_t)jnum(jget(fields,"emptyLength"),0)+chars;
  double expected=jnum(jget(fields,"length"),-1);
  if((uint64_t)jnum(jget(fields,"marker"),0)!=first||start>size||payload>size-start||(expected!=-1&&expected!=payload)){rc=400;goto done;}
  char hash[65];if(cp_seek(f,origin+start,SEEK_SET)){rc=500;goto done;}
  rc=cp_filehash(f,payload,hash);if(rc!=200)goto done;
  if(strcmp(hash,jstr(jget(fields,"sha256")))){rc=400;strcpy(err,"Legacy payload SHA-256 mismatch");goto done;}
  const char *meta=jstr(jget(fields,"meta"));rc=checkpoint_spec(meta,strlen(meta),room,&spec,&it,err,256);if(rc!=200)goto done;
  if(!cp_space(chars/4*3)){rc=507;goto done;}
  snprintf(tmp,sizeof tmp,"%s%sautosave.verify.raw",SAVE_DIR,PATHSEP);raw=cp_exclusive(tmp);
  if(!raw||cp_seek(f,origin+first,SEEK_SET)){rc=500;goto done;}
  unsigned char buf[CP_BUFFER];int map[256];for(int i=0;i<256;i++)map[i]=-1;
  const char alphabet[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";for(int i=0;i<64;i++)map[(unsigned char)alphabet[i]]=i;
  uint64_t decoded=0;
  for(uint64_t left=chars;left;){
    if(cp_stopped()){rc=409;goto done;}size_t n=left<sizeof buf?(size_t)left:sizeof buf;
    if(fread(buf,1,n,f)!=n){rc=500;goto done;}size_t w=0;
    for(size_t i=0;i<n;i+=4){
      int a=map[buf[i]],b=map[buf[i+1]],c=map[buf[i+2]],d=map[buf[i+3]];
      if(a<0||b<0||(c<0&&(buf[i+2]!='='||buf[i+3]!='='||(b&15)))||(d<0&&(buf[i+3]!='='||(c>=0&&(c&3))))||
         ((c<0||d<0)&&i+4!=left)){rc=400;goto done;}
      buf[w++]=(unsigned char)(a<<2|b>>4);if(c>=0)buf[w++]=(unsigned char)(b<<4|c>>2);if(d>=0)buf[w++]=(unsigned char)(c<<6|d);
    }
    if(fwrite(buf,1,w,raw)!=w){rc=errno==ENOSPC?507:500;goto done;}decoded+=w;left-=n;
  }
  if(fflush(raw)||cp_seek(raw,0,SEEK_SET)){rc=500;goto done;}
  if(restore){
    atomic_store(&cp_phase,CP_RESTORE);cp_report(0,decoded);
    rc=mw_load_stream(raw,decoded,spec,restore->budget,it,&restore->game,err,256,cp_stopped,cp_report);
    if(rc==200){restore->meta=strdup(meta);if(!restore->meta)rc=503;}
  }else rc=mw_verify_stream(raw,decoded,spec,it,SAVE_DIR,err,256,cp_stopped,cp_space);
done:free(small);free(spec);free(result);if(fields)json_free(fields);if(raw){fclose(raw);remove(tmp);}cp_seek(f,origin,SEEK_SET);return rc;
}
