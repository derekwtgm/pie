// One independent seven-card hand per lane. Card IDs match lib_cards.js.
__device__ unsigned top(unsigned bits,int count) {
  while(__popc(bits)>count) bits &= bits-1;
  return bits;
}
__device__ unsigned straight(unsigned ranks) {
  for(int hi=12;hi>=4;--hi) if(((ranks>>(hi-4))&31)==31) return hi+1;
  return (ranks&0x100f)==0x100f ? 4 : 0;
}
extern "C" __global__ void score(const unsigned char *cards,int *out,int count) {
  int i=blockIdx.x*blockDim.x+threadIdx.x; if(i>=count) return;
  unsigned suits[4]={},one=0,two=0,three=0,four=0;
  for(int j=0;j<7;j++){
    unsigned c=cards[7*i+j], bit=1u<<(c>>2);
    suits[c&3]|=bit; four|=three&bit; three|=two&bit; two|=one&bit; one|=bit;
  }
  unsigned flush=0;
  for(int j=0;j<4;j++) if(__popc(suits[j])>=5) flush=suits[j];
  unsigned trip=top(three,1), pair=top(two&~trip,1), st=straight(one);
  unsigned value;
  if(flush && straight(flush)) value=(8u<<26)|straight(flush);
  else if(four) value=(7u<<26)|(four<<13)|top(one&~four,1);
  else if(trip && pair) value=(6u<<26)|(trip<<13)|pair;
  else if(flush) value=(5u<<26)|top(flush,5);
  else if(st) value=(4u<<26)|st;
  else if(trip) value=(3u<<26)|(trip<<13)|top(one&~trip,2);
  else if(__popc(two)>=2) { unsigned tp=top(two,2); value=(2u<<26)|(tp<<13)|top(one&~tp,1); }
  else if(two) value=(1u<<26)|(two<<13)|top(one&~two,3);
  else value=top(one,5);
  out[i]=value;
}
