#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "quickjs/quickjs.h"
#include "checkpoint_bundle.h"
#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#else
#include <openssl/sha.h>
#endif
int checkpoint_hash(const char *body,size_t size,char out[65]){
 unsigned char bytes[32];int ok=1;
#ifdef _WIN32
    BCRYPT_ALG_HANDLE alg=NULL;
    if(ok)ok=BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,NULL,0)==0;
    if(ok)ok=BCryptHash(alg,NULL,0,(PUCHAR)body,(ULONG)size,bytes,32)==0;
    if(alg)BCryptCloseAlgorithmProvider(alg,0);
#else
    if(ok)ok=SHA256((const unsigned char *)body,size,bytes)!=NULL;
#endif
    const char digits[]="0123456789abcdef";
    if(!ok)return 0;
    for(int i=0;i<32;i++){out[i*2]=digits[bytes[i]>>4];out[i*2+1]=digits[bytes[i]&15];}
    out[64]=0;return 1;
}
static JSValue digest(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    size_t size=0;
    const char *body=JS_ToCStringLen(ctx,&size,args[0]);
    const char *expected=JS_ToCString(ctx,args[1]);
    int64_t length=0;
    int ok=body && expected && strlen(expected)==64 && !JS_ToInt64(ctx,&length,args[2]) &&
        (length==-1 || length==(int64_t)size);
    char hex[65];if(ok)ok=checkpoint_hash(body,size,hex) && !strcmp(expected,hex);
    JS_FreeCString(ctx,expected);JS_FreeCString(ctx,body);
    return JS_NewBool(ctx,ok);
}
static JSValue base64(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    size_t n;const char *s=JS_ToCStringLen(ctx,&n,args[0]);
    if(!s)return JS_EXCEPTION;
    const char *alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    unsigned acc=0,bits=0;size_t used=0;
    unsigned char *out=js_malloc(ctx,n+1);
    if(!out){JS_FreeCString(ctx,s);return JS_EXCEPTION;}
    size_t end=n;while(end && s[end-1]=='=')end--;
    int ok=n%4==0 && n-end<=2 && end%4!=1;
    for(size_t i=0;ok && i<end;i++){
        const char *p=strchr(alphabet,s[i]);if(!s[i]||!p){ok=0;break;}
        acc=(acc<<6)|(unsigned)(p-alphabet);bits+=6;
        if(bits>=8){bits-=8;out[used++]=(acc>>bits)&255;}
    }
    JSValue value=ok?JS_NewArrayBufferCopy(ctx,out,used):JS_ThrowTypeError(ctx,"Invalid base64");
    js_free(ctx,out);JS_FreeCString(ctx,s);return value;
}
static int expired(JSRuntime *rt,void *deadline){return time(NULL)>*(time_t*)deadline;}
int checkpoint_valid(const char *body,size_t n,size_t memory,char *err,size_t cap){
    if(!body||!n)return 0;
    JSRuntime *rt=JS_NewRuntime();if(!rt)return -1;
    JS_SetMemoryLimit(rt,memory);
    time_t deadline=time(NULL)+45;JS_SetInterruptHandler(rt,expired,&deadline);
    JSContext *ctx=JS_NewContext(rt);int ok=-1;
    if(ctx){
        JSValue global=JS_GetGlobalObject(ctx);
        JS_SetPropertyStr(ctx,global,"verifyDigest",JS_NewCFunction(ctx,digest,"verifyDigest",3));
        JS_SetPropertyStr(ctx,global,"decodeBase64",JS_NewCFunction(ctx,base64,"decodeBase64",1));
        JSValue result=JS_Eval(ctx,(const char*)UI_HTML,UI_HTML_LEN,"checkpoint.js",JS_EVAL_TYPE_GLOBAL);
        if(!JS_IsException(result)){
            JSValue fn=JS_GetPropertyStr(ctx,global,"verifyEnvelope");
            JSValue input=JS_NewStringLen(ctx,body,n);
            size_t encoded=0;
            const char *roundtrip=JS_ToCStringLen(ctx,&encoded,input);
            int utf8=roundtrip && encoded==n && !memcmp(body,roundtrip,n);
            JS_FreeCString(ctx,roundtrip);
            JS_FreeValue(ctx,result);
            result=utf8?JS_Call(ctx,fn,JS_UNDEFINED,1,&input):JS_ThrowTypeError(ctx,"Invalid UTF-8");
            JS_FreeValue(ctx,input);JS_FreeValue(ctx,fn);
        }
        ok=!JS_IsException(result);
        if(!ok){JSValue e=JS_GetException(ctx);const char *m=JS_ToCString(ctx,e);
            if(!m || strstr(m,"out of memory") || strstr(m,"interrupted") || strstr(m,"stack overflow"))ok=-1;
            if(m)snprintf(err,cap,"Checkpoint verification failed: %.180s",m);
            JS_FreeCString(ctx,m);JS_FreeValue(ctx,e);}
        JS_FreeValue(ctx,result);JS_FreeValue(ctx,global);JS_FreeContext(ctx);
    }
    JS_FreeRuntime(rt);return ok;
}

// The bounded metadata oracle never receives the binary strategy payload.
static int checkpoint_meta(const char *fnName,const char *text,size_t n,size_t memory,char **spec,int *it,char *err,size_t cap){
  *spec=NULL;JSRuntime *rt=JS_NewRuntime();if(!rt)return 503;
  JS_SetMemoryLimit(rt,memory<96u*1024*1024?memory:96u*1024*1024);
  time_t deadline=time(NULL)+45;JS_SetInterruptHandler(rt,expired,&deadline);
  JSContext *ctx=JS_NewContext(rt);int rc=503;
  if(ctx){
    JSValue result=JS_Eval(ctx,(const char*)UI_HTML,UI_HTML_LEN,"checkpoint.js",JS_EVAL_TYPE_GLOBAL);
    JSValue global=JS_GetGlobalObject(ctx);
    if(!JS_IsException(result)){
      JS_FreeValue(ctx,result);JSValue input=JS_NewStringLen(ctx,text,n);
      size_t nn=0;const char *round=JS_ToCStringLen(ctx,&nn,input);int utf8=round&&nn==n&&!memcmp(round,text,n);JS_FreeCString(ctx,round);
      JSValue fn=JS_GetPropertyStr(ctx,global,fnName);result=utf8?JS_Call(ctx,fn,JS_UNDEFINED,1,&input):JS_ThrowTypeError(ctx,"Invalid UTF-8");
      JS_FreeValue(ctx,fn);JS_FreeValue(ctx,input);
    }
    if(JS_IsException(result)){
      JSValue ex=JS_GetException(ctx);const char *msg=JS_ToCString(ctx,ex);
      if(msg){snprintf(err,cap,"Invalid study metadata: %.180s",msg);rc=strstr(msg,"out of memory")||strstr(msg,"interrupted")?503:400;}
      JS_FreeCString(ctx,msg);JS_FreeValue(ctx,ex);
    }else{
      size_t len;const char *s=JS_ToCStringLen(ctx,&len,result);
      if(s&&len<=8u*1024*1024){*spec=malloc(len+1);if(*spec){memcpy(*spec,s,len+1);
        rc=200;if(it){JSValue meta=JS_ParseJSON(ctx,text,n,"metadata"),state=JS_GetPropertyStr(ctx,meta,"state"),v=JS_GetPropertyStr(ctx,state,"iterations");
        rc=JS_ToInt32(ctx,it,v)?400:200;JS_FreeValue(ctx,v);JS_FreeValue(ctx,state);JS_FreeValue(ctx,meta);}}}
      JS_FreeCString(ctx,s);
    }
    JS_FreeValue(ctx,global);JS_FreeValue(ctx,result);JS_FreeContext(ctx);
  }JS_FreeRuntime(rt);return rc;
}
typedef struct {FILE *file;char *buf;int (*stop)(void);int failure;} TableInput;
enum { TABLE_LINE=262144 };
static JSValue next_line(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
  TableInput *in=JS_GetContextOpaque(ctx);
  if(in->stop()){in->failure=409;return JS_ThrowTypeError(ctx,"Checkpoint cancelled");}
  if(!fgets(in->buf,TABLE_LINE+2,in->file)){
    if(feof(in->file))return JS_NULL;in->failure=500;return JS_ThrowTypeError(ctx,"Table read failed");
  }
  size_t n=strlen(in->buf);if(n<2||in->buf[n-1]!='\n')return JS_ThrowTypeError(ctx,"Invalid table record length");
  JSValue value=JS_NewStringLen(ctx,in->buf,n-1);size_t length=0;const char *encoded=JS_ToCStringLen(ctx,&length,value);
  int ok=encoded&&length==n-1&&!memcmp(encoded,in->buf,length);JS_FreeCString(ctx,encoded);
  if(!ok){JS_FreeValue(ctx,value);return JS_ThrowTypeError(ctx,"Invalid table record encoding");}return value;
}
int checkpoint_verify_tables(FILE *f,const char *meta,size_t size,size_t room,char *err,size_t cap,int(*stop)(void)){
  TableInput in={f,malloc(TABLE_LINE+2),stop,0};if(!in.buf)return 503;
  JSRuntime *rt=JS_NewRuntime();if(!rt){free(in.buf);return 503;}
  JS_SetMemoryLimit(rt,room<128u*1024*1024?room:128u*1024*1024);
  time_t deadline=time(NULL)+900;JS_SetInterruptHandler(rt,expired,&deadline);
  JSContext *ctx=JS_NewContext(rt);int rc=503;
  if(ctx){
    JS_SetContextOpaque(ctx,&in);JSValue global=JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx,global,"nextCheckpointLine",JS_NewCFunction(ctx,next_line,"nextCheckpointLine",0));
    JS_SetPropertyStr(ctx,global,"decodeBase64",JS_NewCFunction(ctx,base64,"decodeBase64",1));
    JSValue r=JS_Eval(ctx,(const char*)UI_HTML,UI_HTML_LEN,"checkpoint.js",JS_EVAL_TYPE_GLOBAL);
    if(!JS_IsException(r)){JS_FreeValue(ctx,r);JSValue input=JS_NewStringLen(ctx,meta,size),fn=JS_GetPropertyStr(ctx,global,"verifyTableStream");
      r=JS_Call(ctx,fn,JS_UNDEFINED,1,&input);JS_FreeValue(ctx,fn);JS_FreeValue(ctx,input);}
    if(JS_IsException(r)){JSValue ex=JS_GetException(ctx);const char *m=JS_ToCString(ctx,ex);
      rc=in.failure?in.failure:!m||strstr(m,"out of memory")?503:strstr(m,"interrupted")?408:400;
      if(m)snprintf(err,cap,"Invalid streamed strategy: %.170s",m);JS_FreeCString(ctx,m);JS_FreeValue(ctx,ex);
    }else rc=200;
    JS_FreeValue(ctx,r);JS_FreeValue(ctx,global);JS_FreeContext(ctx);
  }
  JS_FreeRuntime(rt);free(in.buf);return rc;
}

int checkpoint_spec(const char *text,size_t n,size_t room,char **spec,int *it,char *err,size_t cap){
  return checkpoint_meta("streamSpec",text,n,room,spec,it,err,cap);
}
int checkpoint_legacy_meta(const char *text,size_t n,size_t room,char **out,char *err){
  return checkpoint_meta("legacyNativeMeta",text,n,room,out,NULL,err,256);
}
int checkpoint_advance_meta(const char *meta,long long updates,size_t room,char **out,char *err){
  size_t capacity=strlen(meta)+48;char *input=malloc(capacity);if(!input)return 503;
  int n=snprintf(input,capacity,"[%s,%lld]",meta,updates);
  int rc=checkpoint_meta("advanceArchive",input,n,room,out,NULL,err,256);free(input);return rc;
}
