// Exact finishing-set recursion. Each worker owns its cache and probability table.
#include <array>
#include <algorithm>
#include <bit>
struct Tournament {
  std::vector<double> start, others, payout;
  struct Entry { std::array<double,8> key{}, value{}; bool valid=false; };
  struct Workspace { std::vector<Entry> cache; std::vector<double> probability; };

  void evaluate(double *chips,int n,Workspace &ws) const {
    uint64_t hash=0;
    for(int i=0;i<n;i++) hash=(hash^std::bit_cast<uint64_t>(chips[i]))*1099511628211ULL;
    auto &entry=ws.cache[(hash^(hash>>32))%ws.cache.size()];
    if(entry.valid && std::equal(chips,chips+n,entry.key.begin())) {
      std::copy_n(entry.value.begin(),n,chips); return;
    }
    std::copy_n(chips,n,entry.key.begin());
    std::array<double,16> stack{}, result{};
    std::array<int,16> live{}, busted{};
    int alive=0,dead=0;
    std::copy_n(chips,n,stack.begin());
    std::copy(others.begin(),others.end(),stack.begin()+n);
    double total=0;
    for(int i=0;i<(int)start.size();++i) {
      if(stack[i]>1e-9) { live[alive++]=i; total+=stack[i]; }
      else busted[dead++]=i;
    }
    const unsigned states=1u<<alive;
    auto &prob=ws.probability;
    std::fill_n(prob.begin(),states,0.0); prob[0]=1;
    for(unsigned mask=0;mask<states;++mask) {
      int place=std::popcount(mask);
      if(prob[mask]==0 || place>=(int)payout.size() || place>=alive) continue;
      double removed=0;
      for(int j=alive-1;j>=0;--j) if(mask&(1u<<j)) removed+=stack[live[j]];
      for(int j=0;j<alive;++j) if(!(mask&(1u<<j))) {
        double p=prob[mask]*stack[live[j]]/(total-removed);
        result[live[j]]+=p*payout[place]; prob[mask|(1u<<j)]+=p;
      }
    }
    std::sort(busted.begin(),busted.begin()+dead,[&](int a,int b){return start[a]>start[b];});
    for(int k=0;k<dead;) {
      int end=k+1; double pool=0;
      while(end<dead && std::abs(start[busted[k]]-start[busted[end]])<1e-9) ++end;
      for(int j=k;j<end && alive+j<(int)payout.size();++j) pool+=payout[alive+j];
      for(int j=k;j<end;++j) result[busted[j]]=pool/(end-k);
      k=end;
    }
    std::copy_n(result.begin(),n,chips); std::copy_n(chips,n,entry.value.begin()); entry.valid=true;
  }
};
