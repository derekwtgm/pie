// pfeq.c - exhaustive preflop hand-class equities (169x169).
// Board-major enumeration over suit-canonical 5-card boards; per board, every
// live hole-card combo is ranked and win/tie counts are accumulated per class pair
// with exact card-removal correction. Output: W, T (avg probabilities) and N (combo pairs).
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <pthread.h>

static uint8_t POP[8192], STRAIGHT[8192];
static void init_tables(void){
  for(int m=0;m<8192;m++){
    POP[m]=__builtin_popcount(m);
    int st=0;
    for(int hi=12;hi>=4;hi--){int w=0x1F<<(hi-4); if((m&w)==w){st=hi+1;break;}}
    if(!st && (m&0x100F)==0x100F) st=4;
    STRAIGHT[m]=st;
  }
}
static inline uint32_t topbits(uint32_t m,int n){ while(POP[m]>n) m&=m-1; return m; }
static inline uint32_t eval7(uint32_t s0,uint32_t s1,uint32_t s2,uint32_t s3){
  uint32_t fl=0;
  if(POP[s0]>=5) fl=s0; else if(POP[s1]>=5) fl=s1; else if(POP[s2]>=5) fl=s2; else if(POP[s3]>=5) fl=s3;
  if(fl){ uint32_t st=STRAIGHT[fl]; if(st) return (8u<<26)|st; return (5u<<26)|topbits(fl,5); }
  uint32_t ranks=s0|s1|s2|s3;
  uint32_t quads=s0&s1&s2&s3;
  if(quads) return (7u<<26)|(quads<<13)|topbits(ranks&~quads,1);
  uint32_t t3=(s0&s1&s2)|(s0&s1&s3)|(s0&s2&s3)|(s1&s2&s3);
  uint32_t t2=(s0&s1)|(s0&s2)|(s0&s3)|(s1&s2)|(s1&s3)|(s2&s3);
  uint32_t pairs=t2&~t3;
  if(t3){ uint32_t top=topbits(t3,1); uint32_t rest=(t3&~top)|pairs; if(rest) return (6u<<26)|(top<<13)|topbits(rest,1); }
  uint32_t st=STRAIGHT[ranks];
  if(st) return (4u<<26)|st;
  if(t3) return (3u<<26)|(t3<<13)|topbits(ranks&~t3,2);
  int np=POP[pairs];
  if(np>=2){ uint32_t tp=topbits(pairs,2); return (2u<<26)|(tp<<13)|topbits(ranks&~tp,1); }
  if(np==1) return (1u<<26)|(pairs<<13)|topbits(ranks&~pairs,3);
  return topbits(ranks,5);
}

static int cls_of(int c1,int c2){
  int r1=c1>>2,r2=c2>>2,s1=c1&3,s2=c2&3;
  if(r1<r2){int t=r1;r1=r2;r2=t;}
  int hi=12-r1, lo=12-r2;
  if(r1==r2) return hi*13+hi;
  if(s1==s2) return hi*13+lo;
  return lo*13+hi;
}

static int CC1[1326],CC2[1326],CCLS[1326];
static int PERM[24][4];
#define NC 169
#define BOARDS48 1712304.0

typedef struct { int tid,nth; int64_t *W,*T; int64_t boards, orbits; } Job;

static int cmpu64(const void*a,const void*b){ uint64_t x=*(const uint64_t*)a,y=*(const uint64_t*)b; return x<y?-1:x>y; }

static void* worker(void*arg){
  Job*J=(Job*)arg;
  int32_t *W32=malloc(sizeof(int32_t)*NC*NC), *T32=malloc(sizeof(int32_t)*NC*NC);
  static __thread int32_t cnt[NC], cc[52][NC], gcnt[NC], gc[52][NC];
  uint64_t keys[1326];
  int64_t bi=-1;
  for(int a=0;a<48;a++)for(int b=a+1;b<49;b++)for(int c=b+1;c<50;c++)for(int d=c+1;d<51;d++)for(int e=d+1;e<52;e++){
    uint32_t bs[4]={0,0,0,0}; int cards[5]={a,b,c,d,e};
    for(int k=0;k<5;k++) bs[cards[k]&3]|=1u<<(cards[k]>>2);
    uint64_t key=((uint64_t)bs[0]<<39)|((uint64_t)bs[1]<<26)|((uint64_t)bs[2]<<13)|bs[3];
    int stab=0, canon=1;
    for(int p=0;p<24;p++){
      uint32_t ns[4]; for(int s=0;s<4;s++) ns[PERM[p][s]]=bs[s];
      uint64_t k2=((uint64_t)ns[0]<<39)|((uint64_t)ns[1]<<26)|((uint64_t)ns[2]<<13)|ns[3];
      if(k2>key){canon=0;break;} if(k2==key) stab++;
    }
    if(!canon) continue;
    bi++; if(bi%J->nth!=J->tid) continue;
    int orbit=24/stab; J->boards++; J->orbits+=orbit;
    uint64_t bm=(1ULL<<a)|(1ULL<<b)|(1ULL<<c)|(1ULL<<d)|(1ULL<<e);
    int m=0;
    for(int h=0;h<1326;h++){
      if((bm>>CC1[h])&1ULL || (bm>>CC2[h])&1ULL) continue;
      uint32_t s[4]={bs[0],bs[1],bs[2],bs[3]};
      s[CC1[h]&3]|=1u<<(CC1[h]>>2); s[CC2[h]&3]|=1u<<(CC2[h]>>2);
      uint32_t v=eval7(s[0],s[1],s[2],s[3]);
      keys[m++]=((uint64_t)v<<11)|h;
    }
    qsort(keys,m,sizeof(uint64_t),cmpu64);
    memset(W32,0,sizeof(int32_t)*NC*NC); memset(T32,0,sizeof(int32_t)*NC*NC);
    memset(cnt,0,sizeof cnt); memset(cc,0,sizeof cc);
    int i=0;
    while(i<m){
      uint32_t v=(uint32_t)(keys[i]>>11); int j=i; while(j<m && (uint32_t)(keys[j]>>11)==v) j++;
      // wins vs strictly weaker
      for(int k=i;k<j;k++){
        int h=keys[k]&2047, x=CC1[h], y=CC2[h]; int32_t*row=W32+CCLS[h]*NC; const int32_t*cx=cc[x],*cy=cc[y];
        for(int bcl=0;bcl<NC;bcl++) row[bcl]+=cnt[bcl]-cx[bcl]-cy[bcl];
      }
      if(j-i>1){
        for(int k=i;k<j;k++){int h=keys[k]&2047; gcnt[CCLS[h]]++; gc[CC1[h]][CCLS[h]]++; gc[CC2[h]][CCLS[h]]++;}
        for(int k=i;k<j;k++){
          int h=keys[k]&2047, x=CC1[h], y=CC2[h], a2=CCLS[h]; int32_t*row=T32+a2*NC; const int32_t*gx=gc[x],*gy=gc[y];
          for(int bcl=0;bcl<NC;bcl++) row[bcl]+=gcnt[bcl]-gx[bcl]-gy[bcl];
          row[a2]+=1;
        }
        for(int k=i;k<j;k++){int h=keys[k]&2047; gcnt[CCLS[h]]--; gc[CC1[h]][CCLS[h]]--; gc[CC2[h]][CCLS[h]]--;}
      }
      for(int k=i;k<j;k++){int h=keys[k]&2047; cnt[CCLS[h]]++; cc[CC1[h]][CCLS[h]]++; cc[CC2[h]][CCLS[h]]++;}
      i=j;
    }
    for(int q=0;q<NC*NC;q++){ J->W[q]+=(int64_t)orbit*W32[q]; J->T[q]+=(int64_t)orbit*T32[q]; }
  }
  free(W32); free(T32);
  return NULL;
}

// direct enumeration for one matchup (validation)
static void direct(int h1,int h2,int v1,int v2,double*win,double*tie){
  uint64_t used=(1ULL<<h1)|(1ULL<<h2)|(1ULL<<v1)|(1ULL<<v2);
  int rem[48],n=0; for(int c=0;c<52;c++) if(!((used>>c)&1ULL)) rem[n++]=c;
  long w=0,t=0,tot=0;
  for(int a=0;a<44;a++)for(int b=a+1;b<45;b++)for(int c=b+1;c<46;c++)for(int d=c+1;d<47;d++)for(int e=d+1;e<48;e++){
    uint32_t s[4]={0,0,0,0}; int cs[5]={rem[a],rem[b],rem[c],rem[d],rem[e]};
    for(int k=0;k<5;k++) s[cs[k]&3]|=1u<<(cs[k]>>2);
    uint32_t p[4]={s[0],s[1],s[2],s[3]}, q[4]={s[0],s[1],s[2],s[3]};
    p[h1&3]|=1u<<(h1>>2); p[h2&3]|=1u<<(h2>>2); q[v1&3]|=1u<<(v1>>2); q[v2&3]|=1u<<(v2>>2);
    uint32_t x=eval7(p[0],p[1],p[2],p[3]), y=eval7(q[0],q[1],q[2],q[3]);
    if(x>y) w++; else if(x==y) t++; tot++;
  }
  *win=(double)w/tot; *tie=(double)t/tot;
}

int main(int argc,char**argv){
  init_tables();
  int n=0; for(int c1=0;c1<52;c1++) for(int c2=c1+1;c2<52;c2++){CC1[n]=c1;CC2[n]=c2;CCLS[n]=cls_of(c1,c2);n++;}
  int p=0; for(int a=0;a<4;a++)for(int b=0;b<4;b++)for(int c=0;c<4;c++)for(int d=0;d<4;d++){
    if(a==b||a==c||a==d||b==c||b==d||c==d) continue; PERM[p][0]=a;PERM[p][1]=b;PERM[p][2]=c;PERM[p][3]=d;p++; }
  // evaluator sanity: category counts over all 7-card hands (optional, argv[1]=="cats")
  if(argc>1 && !strcmp(argv[1],"cats")){
    long cat[9]={0};
    int c[7];
    for(c[0]=0;c[0]<46;c[0]++)for(c[1]=c[0]+1;c[1]<47;c[1]++)for(c[2]=c[1]+1;c[2]<48;c[2]++)for(c[3]=c[2]+1;c[3]<49;c[3]++)
    for(c[4]=c[3]+1;c[4]<50;c[4]++)for(c[5]=c[4]+1;c[5]<51;c[5]++)for(c[6]=c[5]+1;c[6]<52;c[6]++){
      uint32_t s[4]={0,0,0,0}; for(int k=0;k<7;k++) s[c[k]&3]|=1u<<(c[k]>>2);
      cat[eval7(s[0],s[1],s[2],s[3])>>26]++;
    }
    const char*nm[9]={"high","pair","2pair","trips","straight","flush","fullhouse","quads","strflush"};
    for(int k=0;k<9;k++) printf("%-10s %ld\n",nm[k],cat[k]);
    return 0;
  }
  int nth=2; pthread_t th[8]; Job jobs[8];
  for(int t=0;t<nth;t++){ jobs[t].tid=t; jobs[t].nth=nth; jobs[t].W=calloc(NC*NC,8); jobs[t].T=calloc(NC*NC,8); jobs[t].boards=0; jobs[t].orbits=0; pthread_create(&th[t],0,worker,&jobs[t]); }
  int64_t *W=calloc(NC*NC,8),*T=calloc(NC*NC,8); int64_t boards=0,orbits=0;
  for(int t=0;t<nth;t++){ pthread_join(th[t],0); for(int q=0;q<NC*NC;q++){W[q]+=jobs[t].W[q];T[q]+=jobs[t].T[q];} boards+=jobs[t].boards; orbits+=jobs[t].orbits; }
  fprintf(stderr,"canonical boards %ld, orbit sum %ld (expect 2598960)\n",(long)boards,(long)orbits);
  // N
  static int32_t N[NC*NC];
  for(int h=0;h<1326;h++) for(int v=0;v<1326;v++){
    if(CC1[h]==CC1[v]||CC1[h]==CC2[v]||CC2[h]==CC1[v]||CC2[h]==CC2[v]) continue;
    N[CCLS[h]*NC+CCLS[v]]++;
  }
  // identity check
  long bad=0;
  for(int a=0;a<NC;a++) for(int b=0;b<NC;b++){
    int64_t lhs=W[a*NC+b]+T[a*NC+b]+W[b*NC+a]; int64_t rhs=(int64_t)N[a*NC+b]*1712304LL;
    if(lhs!=rhs || T[a*NC+b]!=T[b*NC+a]) bad++;
  }
  fprintf(stderr,"identity violations: %ld\n",bad);
  FILE*f=fopen("pfeq.bin","wb");
  double *Wd=malloc(8*NC*NC),*Td=malloc(8*NC*NC);
  for(int q=0;q<NC*NC;q++){ Wd[q]=W[q]/((double)N[q]*BOARDS48); Td[q]=T[q]/((double)N[q]*BOARDS48); }
  fwrite(Wd,8,NC*NC,f); fwrite(Td,8,NC*NC,f); fwrite(N,4,NC*NC,f); fclose(f);
  // validation vs direct enumeration on sample class pairs
  const char* R="AKQJT98765432";
  int tests[][2]={{0*13+0,1*13+1},{0*13+1,2*13+2},{12*13+12,1*13+0},{7*13+12,0*13+0},{3*13+4,1*13+0},{0*13+9,2*13+1},{12*13+12,12*13+12}};
  for(int ti=0;ti<7;ti++){
    int a=tests[ti][0], b=tests[ti][1]; double sw=0,st=0; int cntp=0;
    for(int h=0;h<1326;h++){ if(CCLS[h]!=a) continue; for(int v=0;v<1326;v++){ if(CCLS[v]!=b) continue;
      if(CC1[h]==CC1[v]||CC1[h]==CC2[v]||CC2[h]==CC1[v]||CC2[h]==CC2[v]) continue;
      double w,t; direct(CC1[h],CC2[h],CC1[v],CC2[v],&w,&t); sw+=w; st+=t; cntp++; } }
    printf("class %c%c%s vs %c%c%s: table W=%.6f T=%.6f | direct W=%.6f T=%.6f (pairs %d/%d)\n",
      R[a/13<a%13?a/13:a%13],R[a/13<a%13?a%13:a/13],a/13==a%13?"":(a/13<a%13?"s":"o"),
      R[b/13<b%13?b/13:b%13],R[b/13<b%13?b%13:b/13],b/13==b%13?"":(b/13<b%13?"s":"o"),
      Wd[a*NC+b],Td[a*NC+b],sw/cntp,st/cntp,cntp,N[a*NC+b]);
  }
  // equity vs random hand for a few classes
  int show[]={0,14,12*13+12,7*13+12,12*13+11,1*13+0,0*13+1};
  for(int k=0;k<7;k++){ int a=show[k]; double num=0,den=0; for(int b=0;b<NC;b++){ num+=N[a*NC+b]*(Wd[a*NC+b]+0.5*Td[a*NC+b]); den+=N[a*NC+b]; }
    printf("vs random class %d: %.4f\n",a,num/den); }
  return 0;
}
