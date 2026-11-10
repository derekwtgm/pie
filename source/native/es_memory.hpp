#pragma once
#include <memory_resource>
#include <atomic>
// One training call owns one resource shared by every sampled deal and worker.
// Reserve before allocation. Reallocation charges both the old and new block.
class ScratchBudget final : public std::pmr::memory_resource {
  size_t limit;
  std::atomic<size_t> used{0};
  std::atomic<size_t> &peak;
  void *do_allocate(size_t bytes, size_t alignment) override {
    const size_t charge=bytes+64; // allocator metadata and alignment allowance
    size_t before=used.load();
    do {
      if(before>limit || charge>limit-before) throw std::bad_alloc();
    } while(!used.compare_exchange_weak(before,before+charge));
    try {
      void *p=std::pmr::new_delete_resource()->allocate(bytes,alignment);
      size_t hi=peak.load();
      while(hi<before+charge && !peak.compare_exchange_weak(hi,before+charge)) {}
      return p;
    } catch(...) { used.fetch_sub(charge); throw; }
  }
  void do_deallocate(void *p,size_t bytes,size_t alignment) override {
    std::pmr::new_delete_resource()->deallocate(p,bytes,alignment);
    used.fetch_sub(bytes+64);
  }
  bool do_is_equal(const std::pmr::memory_resource &other) const noexcept override {return this==&other;}
public:
  void setLimit(size_t cap){limit=cap;}
  ScratchBudget(size_t cap,std::atomic<size_t> &high):limit(cap),peak(high){}
};
