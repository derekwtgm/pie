// Streaming SHA-256 using the platform crypto provider. One context per transfer.
#pragma once
#include <stdint.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
typedef struct {BCRYPT_ALG_HANDLE alg; BCRYPT_HASH_HANDLE hash;} CpSha;
static void cp_sha_close(CpSha *s){if(s->hash)BCryptDestroyHash(s->hash);if(s->alg)BCryptCloseAlgorithmProvider(s->alg,0);memset(s,0,sizeof *s);}
static int cp_sha_init(CpSha *s){memset(s,0,sizeof *s);if(BCryptOpenAlgorithmProvider(&s->alg,BCRYPT_SHA256_ALGORITHM,NULL,0)==0 &&
  BCryptCreateHash(s->alg,&s->hash,NULL,0,NULL,0,0)==0)return 1;cp_sha_close(s);return 0;}
static int cp_sha_add(CpSha *s,const void *p,size_t n){return n<=UINT32_MAX&&BCryptHashData(s->hash,(PUCHAR)p,(ULONG)n,0)==0;}
static int cp_sha_end(CpSha *s,unsigned char out[32]){return BCryptFinishHash(s->hash,out,32,0)==0;}
#else
#include <openssl/evp.h>
typedef struct {EVP_MD_CTX *ctx;} CpSha;
static void cp_sha_close(CpSha *s){EVP_MD_CTX_free(s->ctx);s->ctx=NULL;}
static int cp_sha_init(CpSha *s){s->ctx=EVP_MD_CTX_new();if(s->ctx&&EVP_DigestInit_ex(s->ctx,EVP_sha256(),NULL))return 1;cp_sha_close(s);return 0;}
static int cp_sha_add(CpSha *s,const void *p,size_t n){return EVP_DigestUpdate(s->ctx,p,n)==1;}
static int cp_sha_end(CpSha *s,unsigned char out[32]){unsigned n;return EVP_DigestFinal_ex(s->ctx,out,&n)==1&&n==32;}
#endif
static void cp_hex(const unsigned char *bytes,char out[65]){
  const char digits[]="0123456789abcdef";for(int i=0;i<32;i++){out[i*2]=digits[bytes[i]>>4];out[i*2+1]=digits[bytes[i]&15];}out[64]=0;
}
