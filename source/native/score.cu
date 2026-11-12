// EightMax CUDA kernels (PTX built with NVRTC for compute_75; runs on sm_75+ incl. Ada sm_89).
// Card IDs match lib_cards.js: rank = card >> 2, suit = card & 3. Integer-only arithmetic.
__device__ unsigned top(unsigned bits,int count) {
  while(__popc(bits)>count) bits &= bits-1;
  return bits;
}
__device__ unsigned straight(unsigned ranks) {
  for(int hi=12;hi>=4;--hi) if(((ranks>>(hi-4))&31)==31) return hi+1;
  return (ranks&0x100f)==0x100f ? 4 : 0;
}
// Seven-card score with the same encoding as lib_eval.js / mw.cpp evalMasks().
__device__ unsigned score7(const unsigned char *c) {
  unsigned suits[4]={0,0,0,0},one=0,two=0,three=0,four=0;
  for(int j=0;j<7;j++){
    unsigned bit=1u<<(c[j]>>2);
    suits[c[j]&3]|=bit; four|=three&bit; three|=two&bit; two|=one&bit; one|=bit;
  }
  unsigned flush=0;
  for(int j=0;j<4;j++) if(__popc(suits[j])>=5) flush=suits[j];
  unsigned trip=top(three,1), pair=top(two&~trip,1), st=straight(one);
  if(flush && straight(flush)) return (8u<<26)|straight(flush);
  if(four) return (7u<<26)|(four<<13)|top(one&~four,1);
  if(trip && pair) return (6u<<26)|(trip<<13)|pair;
  if(flush) return (5u<<26)|top(flush,5);
  if(st) return (4u<<26)|st;
  if(trip) return (3u<<26)|(trip<<13)|top(one&~trip,2);
  if(__popc(two)>=2) { unsigned tp=top(two,2); return (2u<<26)|(tp<<13)|top(one&~tp,1); }
  if(two) return (1u<<26)|(two<<13)|top(one&~two,3);
  return top(one,5);
}
// One independent seven-card hand per lane.
extern "C" __global__ void score(const unsigned char *cards,int *out,int count) {
  int i=blockIdx.x*blockDim.x+threadIdx.x; if(i>=count) return;
  out[i]=(int)score7(cards+7*i);
}
// Shared board representation: five public cards once per sampled deal and
// two private cards per seat. Every lane still evaluates exactly one hand.
extern "C" __global__ void score_deals(const unsigned char *deals,int *out,int count,int seats) {
  int i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=count)return;
  const unsigned char *d=deals+(i/seats)*(5+2*seats);
  unsigned char hand[7];for(int c=0;c<5;c++)hand[c]=d[c];
  int off=5+2*(i%seats);hand[5]=d[off];hand[6]=d[off+1];out[i]=(int)score7(hand);
}
// Exact multiway all-in equity by complete board enumeration.
// spec: [n, boardLen, deckCount, hole0a, hole0b, ..., board..., deck...]
// Board completions are the `need = 5 - boardLen` element combinations of the
// deck, indexed in colexicographic order (index -> combination by combinadic).
// Each board awards 840 share units split equally among tied winners
// (840 is divisible by 1..8), so per-hand totals are exact integers and the
// result does not depend on reduction order. out[p] += units, out[8] += boards.
extern "C" __global__ void equity(const unsigned char *spec,const unsigned long long *binom,unsigned long long combos,
                                  unsigned long long first,unsigned long long *out) {
  const int n=spec[0],boardLen=spec[1],deckCount=spec[2],need=5-boardLen;
  unsigned long long index=first+(unsigned long long)blockIdx.x*blockDim.x+threadIdx.x;
  unsigned long long mine[9]={0,0,0,0,0,0,0,0,0};
  const unsigned long long stride=(unsigned long long)gridDim.x*blockDim.x;
  for(;index<combos;index+=stride){
    unsigned char seven[7]; unsigned char boardCards[5];
    for(int j=0;j<boardLen;j++) boardCards[j]=spec[3+2*n+j];
    unsigned long long rest=index;
    int upper=deckCount;
    for(int r=need;r>=1;--r){       // largest x with C(x,r) <= rest
      int lo=r-1,hi=upper;while(lo+1<hi){int mid=lo+(hi-lo)/2;if(binom[mid*6+r]<=rest)lo=mid;else hi=mid;}
      int x=lo;upper=x;
      rest-=binom[x*6+r]; boardCards[boardLen+r-1]=spec[3+2*n+boardLen+x];
    }
    unsigned best=0,scores[8]; int winners=0;
    for(int p=0;p<n;p++){
      seven[0]=spec[3+2*p];seven[1]=spec[4+2*p];
      for(int j=0;j<5;j++) seven[2+j]=boardCards[j];
      scores[p]=score7(seven);
      if(scores[p]>best){best=scores[p];winners=1;} else if(scores[p]==best) winners++;
    }
    const unsigned share=840u/winners;
    for(int p=0;p<n;p++) if(scores[p]==best) mine[p]+=share;
    mine[8]++;
  }
  for(int p=0;p<9;p++) if(mine[p]) atomicAdd(out+p,mine[p]);
}
// 4.0: showdown table for exact action-EV runouts. Same board decoding as
// `equity`; writes every seat's score for board completions [first,end):
// out[(index-first)*n+p]. The host turns the scores into rank patterns (exact
// integers), so CPU, GPU and hybrid tables are identical.
extern "C" __global__ void board_scores(const unsigned char *spec,const unsigned long long *binom,unsigned long long first,
                                        unsigned long long end,int *out) {
  const int n=spec[0],boardLen=spec[1],deckCount=spec[2],need=5-boardLen;
  const unsigned long long stride=(unsigned long long)gridDim.x*blockDim.x;
  for(unsigned long long index=first+(unsigned long long)blockIdx.x*blockDim.x+threadIdx.x;index<end;index+=stride){
    unsigned char seven[7]; unsigned char boardCards[5];
    for(int j=0;j<boardLen;j++) boardCards[j]=spec[3+2*n+j];
    unsigned long long rest=index;
    int upper=deckCount;
    for(int r=need;r>=1;--r){
      int lo=r-1,hi=upper;while(lo+1<hi){int mid=lo+(hi-lo)/2;if(binom[mid*6+r]<=rest)lo=mid;else hi=mid;}
      int x=lo;upper=x;
      rest-=binom[x*6+r]; boardCards[boardLen+r-1]=spec[3+2*n+boardLen+x];
    }
    for(int p=0;p<n;p++){
      seven[0]=spec[3+2*p];seven[1]=spec[4+2*p];
      for(int j=0;j<5;j++) seven[2+j]=boardCards[j];
      out[(index-first)*n+p]=(int)score7(seven);
    }
  }
}
