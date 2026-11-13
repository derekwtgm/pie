// EightMax 4.4 native/icm.hpp, UNMODIFIED except that the type is named Tournament44: the scalar
// reference for tests/icm45.cpp (the 4.5 two-lane kernel must return identical bit patterns).
// Exact finishing-set recursion. Each worker owns its cache and probability table.
#include <array>
#include <algorithm>
#include <bit>
#include <cstdint>
#include <vector>
#include <memory>
#include <cstdlib>
#include <new>
struct Tournament44 {
  std::vector<double> start, others, payout;
  struct Entry { std::array<double,8> key, value; };
  // 3.8: entries are raw storage; only the validity bytes are initialized, so a
  // short study does not fault in the whole cache.
  struct Workspace {
    struct Free { void operator()(Entry *p) const { std::free(p); } };
    std::unique_ptr<Entry[],Free> cache; size_t entries=0; std::vector<uint8_t> valid;
    std::vector<double> probability, removed; std::vector<uint8_t> place;
  };
  // 3.8: terminal ICM results cached per worker (exact keys). 3.7 used 127
  // entries; on the eight-player final-table benchmark that hit 23% of calls,
  // while 32,749 entries hit 56%. The size scales with the study's memory
  // budget and is charged to it by the callers through workspaceBytes().
  static size_t cacheEntries(double budgetBytes){
    return budgetBytes>=1024*1048576.0?32749:budgetBytes>=256*1048576.0?16381:budgetBytes>=16*1048576.0?4093:127;
  }
  static size_t workspaceBytes(size_t players,double budgetBytes){return cacheEntries(budgetBytes)*(sizeof(Entry)+1)+((sizeof(double)*2+1)<<players);}
  void prepare(Workspace &ws,double budgetBytes) const {
    const size_t states=(size_t)1<<start.size();
    ws.entries=cacheEntries(budgetBytes); ws.cache.reset(static_cast<Entry*>(std::malloc(ws.entries*sizeof(Entry)))); if(!ws.cache) throw std::bad_alloc(); ws.valid.assign(ws.entries,0); ws.probability.assign(states,0.0); ws.removed.assign(states,0.0); ws.place.assign(states,0);
  }
  void evaluate(double *chips,int n,Workspace &ws) const {
    uint64_t hash=0;
    for(int i=0;i<n;i++) hash=(hash^std::bit_cast<uint64_t>(chips[i]))*1099511628211ULL;
    const size_t slot=(hash^(hash>>32))%ws.entries; auto &entry=ws.cache[slot];
    if(ws.valid[slot] && std::equal(chips,chips+n,entry.key.begin())) {
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
    // 3.8: removed-chip sums and finishing places are built incrementally from
    // the mask without its lowest set bit. The sum is still accumulated from the
    // highest set bit down to the lowest (0 + s_hi + ... + s_lo), so every value
    // is bit-identical to the 3.7 per-mask loop, without its O(n) rescan and the
    // libgcc popcount call that -march=x86-64 builds emit.
    auto &removedOf=ws.removed; auto &placeOf=ws.place;
    if(removedOf.size()<states){removedOf.resize(states);placeOf.resize(states);}
    removedOf[0]=0; placeOf[0]=0;
    for(unsigned mask=1;mask<states;++mask){
      const unsigned low=mask&(0u-mask),rest=mask^low;
      removedOf[mask]=removedOf[rest]+stack[live[std::countr_zero(low)]];
      placeOf[mask]=(uint8_t)(placeOf[rest]+1);
    }
    std::fill_n(prob.begin(),states,0.0); prob[0]=1;
    const int paid=(int)payout.size();
    for(unsigned mask=0;mask<states;++mask) {
      const int place=placeOf[mask];
      if(prob[mask]==0 || place>=paid || place>=alive) continue;
      const double removed=removedOf[mask],pm=prob[mask],pay=payout[place];
      for(int j=0;j<alive;++j) if(!(mask&(1u<<j))) {
        double p=pm*stack[live[j]]/(total-removed);
        result[live[j]]+=p*pay; prob[mask|(1u<<j)]+=p;
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
    std::copy_n(result.begin(),n,chips); std::copy_n(chips,n,entry.value.begin()); ws.valid[slot]=1;
  }
};
