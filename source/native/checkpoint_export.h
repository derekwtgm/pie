// Preserve the original archive format so exports also open in the browser.
int checkpoint_advance_meta(const char *,long long,size_t,char **,char *);
static void cp_put32(unsigned char *p,uint32_t v){for(int i=0;i<4;i++)p[i]=(unsigned char)(v>>(8*i));}
static int cp_zero_run(const unsigned char *p,size_t n,size_t i){return i+2<n && !(p[i]|p[i+1]|p[i+2]);}
static size_t cp_pack(const unsigned char *src,size_t n,unsigned char *out){
  size_t i=0,w=0;
  while(i<n){
    size_t start=i;
    if(cp_zero_run(src,n,i)){
      while(i<n && !src[i] && i-start<128)i++;
      if(w+1>=n)return n;
      out[w++]=(unsigned char)(127+i-start);
    }else{
      do{i++;}while(i<n && i-start<128 && !cp_zero_run(src,n,i));
      size_t count=i-start;if(w+1+count>=n)return n;
      out[w++]=(unsigned char)(count-1);memcpy(out+w,src+start,count);w+=count;
    }
  }return w;
}
static int cp_encode(FILE *in,FILE *archive,uint64_t bytes,const char *meta){
  unsigned char header[24]="EMCP36\r\n",desc[40],digest[32];
  uint32_t ml=(uint32_t)strlen(meta);cp_put32(header+8,1);cp_put32(header+12,ml);
  cp_put32(header+16,(uint32_t)bytes);cp_put32(header+20,(uint32_t)(bytes>>32));
  unsigned char *raw=malloc(CP_BLOCK),*packed=malloc(CP_BLOCK);int rc=503;
  CpSha root;if(!cp_sha_init(&root)){free(raw);free(packed);return 503;}
  if(!raw||!packed)goto done;
  rc=500;
  if(!cp_sha_add(&root,header,24)||!cp_sha_add(&root,meta,ml)||fwrite(header,1,24,archive)!=24||fwrite(meta,1,ml,archive)!=ml)goto done;
  for(uint64_t left=bytes;left;){
    if(cp_stopped()){rc=409;goto done;}
    size_t n=left<CP_BLOCK?(size_t)left:CP_BLOCK;if(fread(raw,1,n,in)!=n)goto done;
    size_t wire=cp_pack(raw,n,packed);cp_put32(desc,(uint32_t)n);cp_put32(desc+4,(uint32_t)wire);
    CpSha block;if(!cp_sha_init(&block)){rc=503;goto done;}
    int ok=cp_sha_add(&block,raw,n)&&cp_sha_end(&block,desc+8);cp_sha_close(&block);
    if(!ok||!cp_sha_add(&root,desc,40)||fwrite(desc,1,40,archive)!=40||fwrite(wire<n?packed:raw,1,wire,archive)!=wire)goto done;
    left-=n;cp_report(bytes-left,bytes);
  }
  if(cp_sha_end(&root,digest)&&fwrite(digest,1,32,archive)==32&&!fflush(archive))rc=200;
done:if(rc==500&&errno==ENOSPC)rc=507;
  cp_sha_close(&root);free(raw);free(packed);return rc;
}
static int save_native_session(const CheckpointPaths *p,Store *st,size_t room,char *err){
  char rawName[1240],arcName[1240],*meta=NULL;
  snprintf(rawName,sizeof rawName,"%s.native.raw",p->temp);snprintf(arcName,sizeof arcName,"%s.native.archive",p->temp);
  size_t bytes=mw_stream_size(MWG);if(!bytes)return 503;if(bytes>cp_limit())return 413;
  int rc=checkpoint_advance_meta(MW_ARCHIVE_META,MW_IT,room,&meta,err);
  FILE *raw=NULL,*archive=NULL;if(rc!=200)goto done;
  if(!cp_space(4ULL*bytes+((bytes+CP_BLOCK-1)/CP_BLOCK)*80+2*strlen(meta)+(4u<<20))){rc=507;goto done;}
  raw=cp_exclusive(rawName);archive=cp_exclusive(arcName);if(!raw||!archive){rc=500;goto done;}
  atomic_store(&cp_phase,CP_ENCODE);cp_report(0,bytes);
  if(!mw_write_stream(MWG,raw,cp_stopped)||cp_seek(raw,0,SEEK_SET)){rc=cp_stopped()?409:errno==ENOSPC?507:500;goto done;}
  rc=cp_encode(raw,archive,bytes,meta);fclose(raw);raw=NULL;remove(rawName);if(rc!=200)goto done;
  int64_t wire=cp_tell(archive);if(wire<=0||cp_seek(archive,0,SEEK_SET)){rc=500;goto done;}
  atomic_store(&cp_phase,CP_COMMIT);rc=save_generation(p,st,NULL,archive,(size_t)wire,room,err);
done:if(raw)fclose(raw);if(archive)fclose(archive);remove(rawName);remove(arcName);free(meta);return rc;
}
