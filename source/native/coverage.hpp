// EightMax 4.2/4.3: strategy-coverage accounting for action-EV and response-gain
// evaluations (used by action_ev.hpp; no other dependencies, so the regression
// suite tests it in isolation against std::set / std::map references:
// tests/coverage42.cpp and tests/coverage43.cpp).
//
// 4.1 defect (repaired in 4.2). The 4.1 table stored `key | 1` (0 marked an empty
// slot) and, when worker tables were merged, re-inserted the STORED value, which
// hashes to a different probe start than the original key. Observing key 42 on a
// worker, merging, then observing 42 again reported two distinct information
// sets. `key | 1` also identified keys 2k and 2k+1, and the 4.1 caller XOR-ed the
// seat into bits 62-63 of rowKey(), whose state field occupies bits 37-63, so two
// different betting states could share one key.
//
// 4.2 design (unchanged in 4.3):
//  * A key is 128 bits: {id, ns}. ns names the key space and is never 0, so
//    occupancy needs no reserved key value and keys are stored UNMODIFIED.
//      ns = NS_ROW  | seat << 8 : id = rowKey(state, hand, code), the identity of
//                                 a stored strategy row
//      ns = NS_SYNTH| seat << 8 : id = state << 32 | range index; lookups that
//                                 have no strategy key
//  * The probe start is a pure function of the ORIGINAL key, in note() and in
//    merge() alike, so the set is a true set and merging is a set union:
//    independent of worker partitioning, merge order and repeated merges.
//  * Per key two flags: seen with a stored row, seen with the fallback policy.
//    Distinct counts (sets) are kept separate from lookup counts (visits) and
//    from the probability-weighted shares computed by the evaluator.
//
// 4.3 CAPACITY. 4.2 stopped at a fixed 524,288 keys (17 bytes a slot), after
// which counts were lower bounds. 4.3:
//  * 16-byte slots: the two flags live in bits 61-62 of the stored namespace
//    word (key namespaces use < 2^61; ns values are tiny), so an exact table
//    costs 32 bytes a key at the maximum load of 1/2.
//  * `limit` (keys) is configurable per table; the evaluator derives it from the
//    request's coverageMiB (default 64 MiB: 2,097,152 exact keys).
//  * An optional shared BYTE POOL bounds the slot memory of all worker tables of
//    one request together (a table may grow only if the pool grants the new
//    slots; doubling briefly holds the old and the new table, i.e. up to 48
//    bytes a key while growing); the merged result table gets its own
//    allowance, so the peak is at most twice the configured budget.
//  * Beyond the limit or the pool the table stops inserting (`capped`): the
//    distinct counts are then EXACT LOWER BOUNDS of the true counts, never
//    reported as exact. Three HyperLogLog sketches (2^14 registers, relative
//    standard error 1.04/sqrt(16384) = 0.81%) see every key, merge by register
//    maximum, and give `estimate*` values that are labelled approximate and are
//    reported only alongside the lower bounds. The sketches cost nothing while
//    the table is exact: they are started when the table first caps, back-filled
//    from the table (which then still holds every key seen), and updated with
//    every key from then on, so they always describe the full union.
#pragma once
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>
#include <cstdint>
namespace emcov {
struct Key {
  uint64_t id = 0, ns = 0;
  bool operator==(const Key &o) const { return id == o.id && ns == o.ns; }
  bool operator<(const Key &o) const { return ns != o.ns ? ns < o.ns : id < o.id; }
};
constexpr uint64_t NS_ROW = 1, NS_SYNTH = 2;
inline Key rowKeyOf(uint64_t rowIdentity, int seat) { return {rowIdentity, NS_ROW | ((uint64_t)(uint32_t)seat << 8)}; }
inline Key synthKeyOf(int state, int seat, int rangeIndex) { return {((uint64_t)(uint32_t)state << 32) | (uint32_t)rangeIndex, NS_SYNTH | ((uint64_t)(uint32_t)seat << 8)}; }
inline uint64_t mix64(uint64_t x) { x ^= x >> 33; x *= 0xff51afd7ed558ccdULL; x ^= x >> 33; x *= 0xc4ceb9fe1a85ec53ULL; return x ^ (x >> 33); }
inline uint64_t hashOf(const Key &k) { return mix64(k.id ^ mix64(k.ns + 0x9e3779b97f4a7c15ULL)); }

// 4.3: HyperLogLog distinct-count sketch (approximate; used only once exact counting stopped).
struct Hll {
  static constexpr int P = 14; static constexpr size_t M = size_t(1) << P;
  std::vector<uint8_t> r;
  void add(uint64_t h) {
    if (r.empty()) r.assign(M, 0);
    const size_t idx = (size_t)(h >> (64 - P)); const uint64_t w = (h << P) | (uint64_t(1) << (P - 1));
    const uint8_t rank = (uint8_t)(__builtin_clzll(w) + 1); if (rank > r[idx]) r[idx] = rank;
  }
  void merge(const Hll &o) { if (o.r.empty()) return; if (r.empty()) { r = o.r; return; } for (size_t i = 0; i < M; i++) r[i] = std::max(r[i], o.r[i]); }
  double estimate() const {
    if (r.empty()) return 0;
    double sum = 0; size_t zeros = 0; for (uint8_t x : r) { sum += std::ldexp(1.0, -(int)x); zeros += x == 0; }
    const double m = (double)M, alpha = 0.7213 / (1 + 1.079 / m), e = alpha * m * m / sum;
    if (e <= 2.5 * m && zeros) return m * std::log(m / (double)zeros);   // linear counting for small sets
    return e;
  }
  static constexpr double relativeStdError() { return 1.04 / 128.0; }   // 1.04 / sqrt(2^14)
};

struct Coverage {
  static constexpr size_t MIN_SLOTS = 1024, MAX_DISTINCT = size_t(1) << 19;   // 4.2 default limit (tests); the evaluator sets `limit`
  static constexpr uint8_t USED = 1, STORED = 2, FALLBACK = 4;
  static constexpr uint64_t F_STORED = uint64_t(1) << 61, F_FALLBACK = uint64_t(1) << 62, NS_MASK = (uint64_t(1) << 61) - 1;
  static constexpr size_t SLOT_BYTES = 16;
  // visits (lookups)
  long long lookups = 0, stored = 0, missing = 0;
  // distinct information sets (exact while !capped; exact lower bounds once capped)
  size_t distinct = 0, distinctStored = 0, distinctMissing = 0;
  bool capped = false;
  size_t limit = MAX_DISTINCT;                       // keys this table may hold
  std::shared_ptr<std::atomic<long long>> pool;      // shared slot-byte budget (null: unlimited)
  bool sketch = true;                                // build HyperLogLog sketches once capped
  Hll hAll, hStored, hFallback;
  // Test hook: a hash override lets tests force every key into one bucket.
  uint64_t (*hash)(const Key &) = hashOf;

  void note(const Key &k, bool ok) {
    lookups++; (ok ? stored : missing)++;
    mark(k, ok ? STORED : FALLBACK);
  }
  // 4.4: visit counters only (the distinct set is kept by a SharedCoverage).
  void countOnly(bool ok) { lookups++; (ok ? stored : missing)++; }
  // Set union with another worker's table; visit counts add; sketches merge.
  void merge(const Coverage &o) {
    lookups += o.lookups; stored += o.stored; missing += o.missing;
    if (o.capped) { capOut(); if (sketchOk()) { hAll.merge(o.hAll); hStored.merge(o.hStored); hFallback.merge(o.hFallback); } }
    for (size_t i = 0; i < o.slot.size(); i++) if (o.slot[i].nsf) mark(Key{o.slot[i].id, o.slot[i].nsf & NS_MASK}, flagsOf(o.slot[i].nsf));
  }
  size_t slots() const { return slot.size(); }
  size_t bytes() const { return slot.capacity() * SLOT_BYTES + (hAll.r.capacity() + hStored.r.capacity() + hFallback.r.capacity()); }
  // Every distinct key with its flags (tests, diagnostics).
  template<class F> void each(F &&f) const { for (auto &s : slot) if (s.nsf) f(Key{s.id, s.nsf & NS_MASK}, (uint8_t)(USED | flagsOf(s.nsf))); }
  // 4.3 reporting: approximate distinct counts (only meaningful when capped).
  double estimateDistinct() const { return std::max((double)distinct, hAll.estimate()); }
  double estimateStored() const { return std::max((double)distinctStored, hStored.estimate()); }
  double estimateFallback() const { return std::max((double)distinctMissing, hFallback.estimate()); }
  Coverage() = default;
  Coverage(const Coverage &o) : lookups(o.lookups), stored(o.stored), missing(o.missing), distinct(o.distinct), distinctStored(o.distinctStored), distinctMissing(o.distinctMissing),
    capped(o.capped), limit(o.limit), pool(nullptr), sketch(o.sketch || o.sketchHeld), hAll(o.hAll), hStored(o.hStored), hFallback(o.hFallback), hash(o.hash), slot(o.slot) {}
  Coverage &operator=(const Coverage &) = delete;
  ~Coverage() { if (pool) pool->fetch_add((long long)(slot.size() * SLOT_BYTES + (sketchHeld ? SKETCH_BYTES : 0))); }
  // 4.5: with a pool, the three sketches (49,152 bytes) are part of the pooled bytes: they are
  // reserved together with the first table and, if the pool cannot grant them, no sketch is built
  // (the estimates then equal the lower bounds). 4.3/4.4 allocated them outside the pool.
  static constexpr size_t SKETCH_BYTES = 3 * Hll::M;

 private:
  struct Slot { uint64_t id, nsf; };   // nsf == 0: empty
  std::vector<Slot> slot; bool sketchHeld = false;
  bool sketchOk() {
    if (!sketch) return false;
    if (!pool || sketchHeld) return true;
    long long cur = pool->load(); const long long need = (long long)SKETCH_BYTES;
    do { if (cur < need) { sketch = false; return false; } } while (!pool->compare_exchange_weak(cur, cur - need));
    return sketchHeld = true;
  }
  static uint8_t flagsOf(uint64_t nsf) { return (uint8_t)(((nsf & F_STORED) ? STORED : 0) | ((nsf & F_FALLBACK) ? FALLBACK : 0)); }
  size_t find(const Key &k, bool &found) const {
    const size_t mask = slot.size() - 1;
    for (size_t i = (size_t)hash(k) & mask;; i = (i + 1) & mask) {
      if (!slot[i].nsf) { found = false; return i; }
      if (slot[i].id == k.id && (slot[i].nsf & NS_MASK) == k.ns) { found = true; return i; }
    }
  }
  bool grow() {
    if (slot.size() > SIZE_MAX / (2 * SLOT_BYTES)) return false;
    const size_t n = slot.empty() ? MIN_SLOTS : slot.size() * 2;
    if (slot.empty()) sketchOk();   // 4.5: sketch bytes first, so that a capped table can always estimate
    if (pool) {   // reserve the new table before releasing the old one
      const long long need = (long long)(n * SLOT_BYTES);
      long long cur = pool->load(); do { if (cur < need) return false; } while (!pool->compare_exchange_weak(cur, cur - need));
    }
    std::vector<Slot> old; old.swap(slot);
    try { slot.assign(n, Slot{0, 0}); } catch (...) { slot.swap(old); if (pool) pool->fetch_add((long long)(n * SLOT_BYTES)); return false; }
    for (auto &s : old) if (s.nsf) { bool f; const size_t j = find(Key{s.id, s.nsf & NS_MASK}, f); slot[j] = s; }
    if (pool) pool->fetch_add((long long)(old.size() * SLOT_BYTES));
    return true;
  }
  void sketchAdd(const Key &k, uint8_t what) {
    if (!sketchOk()) return;
    const uint64_t h = mix64(hashOf(k) + 0x632be59bd9b4e019ULL);
    hAll.add(h); if (what & STORED) hStored.add(h); if (what & FALLBACK) hFallback.add(h);
  }
  // Exact counting stops: start the sketches from every key held (all keys seen so far).
  void capOut() {
    if (capped) return;
    capped = true;
    for (auto &s : slot) if (s.nsf) sketchAdd(Key{s.id, s.nsf & NS_MASK}, flagsOf(s.nsf));
  }
  void mark(const Key &k, uint8_t what) {
    if (capped) sketchAdd(k, what);
    if (slot.empty() && !grow()) { capOut(); sketchAdd(k, what); return; }
    bool found; size_t i = find(k, found);
    if (!found) {
      if (distinct >= limit) { capOut(); sketchAdd(k, what); return; }
      if (2 * (distinct + 1) > slot.size()) { if (!grow()) { capOut(); sketchAdd(k, what); return; } i = find(k, found); }
      slot[i] = Slot{k.id, k.ns & NS_MASK}; distinct++;
    }
    const uint64_t add = ((what & STORED) ? F_STORED : 0) | ((what & FALLBACK) ? F_FALLBACK : 0);
    const uint64_t added = add & ~slot[i].nsf;
    if (added & F_STORED) distinctStored++;
    if (added & F_FALLBACK) distinctMissing++;
    slot[i].nsf |= add;
  }
};

}  // namespace emcov
// ============================================================================
// 4.4: SharedCoverage - one exact set per request, filled concurrently.
//
// WHY (4.3 sampled-EV deadline regression, measured: validation/4.4/deadline/).
// In 4.2/4.3 every worker kept a private Coverage table and the request merged
// them AFTER the workers had stopped. The merge re-inserts every key of every
// worker (random memory accesses), so its cost grows with the work done: for the
// audit's eight-handed range-sampled request it took 8 ms after a 100 ms limit
// on one thread and 98 ms after a 600 ms limit on four threads - all of it after
// the deadline. 4.3 made it worse than 4.2 by raising the exact key limit from
// 524,288 to 2,097,152 (more keys kept, more keys merged).
//
// DESIGN
//  * One open-addressing set per request, written by all workers; no merge at
//    the end. It is a sequence of TIERS: it starts with 4,096 slots (64 KiB)
//    and is promoted to a tier four times larger whenever it is half full, up
//    to 2 slots per key of the request's key limit (16 bytes a slot: the
//    request's coverageMiB). Memory therefore follows the number of keys: a
//    request with a few hundred information sets touches 64 KiB. (A first 4.4
//    development build reserved the whole table at once; sparse first touches
//    of 64 MiB cost about 10 ms per request and were removed.)
//  * Lookup of a key that is present with the observed flag - the common case -
//    takes no lock and writes nothing shared: it reads the current tier.
//  * Insert / new flag: under a SHARED hold on the current tier (SlotLock: a
//    counter in a per-thread cache line plus a read of the writer flag, so
//    inserting threads share no written lock word; a mutex-based reader lock
//    cost 54% on a four-thread run with over two million new keys). Claim an empty
//    slot by compare-and-swap of its namespace word from 0 to BUSY, reserve one
//    unit of the key limit, write the id, then publish the namespace word. A
//    thread that meets a BUSY slot waits for it (a few instructions). Flags are
//    added with fetch_or; a key is counted in distinctStored / distinctFallback
//    by the thread whose fetch_or first set that flag, so every count is exact
//    whatever the interleaving.
//  * 4.5: all of this memory is under a strict byte ledger (Budget, below); the
//    tier sizes are planned so that every tier, retired ones included, fits.
//  * Promotion: one thread allocates and touches the larger tier while the
//    others keep inserting; then, under the EXCLUSIVE hold (no insert in
//    progress), every key is copied with its flags and the tier pointer is
//    switched.
//    Older tiers stay allocated until the set is destroyed, so a lock-free
//    reader that still holds one reads valid, never-modified memory; a miss
//    there falls through to the locked path on the current tier.
//  * Key limit: a claim that would exceed `limit` is rolled back, the set is
//    marked capped and the key goes to three HyperLogLog sketches with atomic
//    registers. Once capped, a lookup of a key that is not in the table takes
//    no lock at all. The thread that first reaches the limit back-fills
//    the sketches from the table at that moment, while the workers run, so
//    that nothing proportional to the table remains to be done after a stop;
//    keys published during that scan add themselves. The meaning of the counts
//    is the 4.3 one: exact while not capped, exact lower bounds plus labelled
//    estimates once capped.
//  * Each worker keeps a small direct-mapped filter (WorkerFilter) of keys it
//    already reported with the same flags, so repeated visits cost one private
//    array probe and never touch shared memory. The filter is a cache, not a
//    set: evicting an entry only causes a redundant (idempotent) report.
//  * The result is independent of the number of workers and of scheduling: it
//    is the set union of all observations (tests/coverage44.cpp compares it
//    with std::map under 1..16 threads, forced hash collisions, repeated
//    observations, the key limit and ThreadSanitizer).
// ============================================================================
#include <mutex>
#include <new>
#include <thread>
#include <cstdlib>
#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <sys/mman.h>
#endif
namespace emcov {
// Zero-filled pages on demand (not touched until written).
inline void *zeroPages(size_t bytes) {
#ifdef _WIN32
  return VirtualAlloc(nullptr, bytes, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
#else
  void *p = mmap(nullptr, bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0); return p == MAP_FAILED ? nullptr : p;
#endif
}
inline void freePages(void *p, size_t bytes) {
  if (!p) return;
#ifdef _WIN32
  (void)bytes; VirtualFree(p, 0, MEM_RELEASE);
#else
  munmap(p, bytes);
#endif
}
// HyperLogLog with atomic registers (register = maximum rank seen): concurrent adds need no lock.
struct AtomicHll {
  std::unique_ptr<std::atomic<uint8_t>[]> r;
  AtomicHll() : r(new std::atomic<uint8_t>[Hll::M]()) {}
  // 4.5: registers allocated later by init(), after their bytes were reserved in the budget.
  explicit AtomicHll(std::nullptr_t) {}
  bool init() { r.reset(new (std::nothrow) std::atomic<uint8_t>[Hll::M]()); return r != nullptr; }
  void add(uint64_t h) {
    if (!r) return;
    const size_t idx = (size_t)(h >> (64 - Hll::P)); const uint64_t w = (h << Hll::P) | (uint64_t(1) << (Hll::P - 1));
    const uint8_t rank = (uint8_t)(__builtin_clzll(w) + 1); uint8_t cur = r[idx].load(std::memory_order_relaxed);
    while (rank > cur && !r[idx].compare_exchange_weak(cur, rank, std::memory_order_relaxed)) {}
  }
  double estimate() const {
    if (!r) return 0;
    double sum = 0; size_t zeros = 0; for (size_t i = 0; i < Hll::M; i++) { const uint8_t x = r[i].load(std::memory_order_relaxed); sum += std::ldexp(1.0, -(int)x); zeros += x == 0; }
    const double m = (double)Hll::M, alpha = 0.7213 / (1 + 1.079 / m), e = alpha * m * m / sum;
    if (e <= 2.5 * m && zeros) return m * std::log(m / (double)zeros);
    return e;
  }
};
// Reader-writer exclusion for the coverage set with NO shared write on the reader side: each reader
// (an inserting worker) raises a counter in one of 64 cache-line-sized slots chosen by its thread
// and then checks the writer flag; the writer (a promotion, rare) raises the flag and waits until
// every slot is zero. Sequentially consistent stores/loads make this the usual two-flag handshake:
// either the reader sees the flag and backs off, or the writer sees the reader's slot and waits.
// The same slots carry the per-thread distinct-flag counts, so inserting threads do not share them.
struct SlotLock {
  // quota: units of the key limit this thread may still use without touching the shared reserve
  // (taken and returned with atomic operations, because another thread may take over an unused
  // rest when the limit is nearly reached); used: keys this thread inserted.
  struct alignas(64) Cell { std::atomic<int> active{0}; std::atomic<long long> quota{0}; std::atomic<size_t> used{0}, stored{0}, missing{0}; };
  Cell cell[64]; alignas(64) std::atomic<bool> writing{false}; std::mutex writers;
  static size_t self() { static std::atomic<size_t> next{0}; thread_local const size_t id = next.fetch_add(1, std::memory_order_relaxed); return id & 63; }
  Cell &enter() {
    Cell &c = cell[self()];
    for (;;) {
      c.active.fetch_add(1);
      if (!writing.load()) return c;
      c.active.fetch_sub(1);
      while (writing.load()) std::this_thread::yield();
    }
  }
  static void leave(Cell &c) { c.active.fetch_sub(1); }
  // Exclusive section of the thread that holds `writers`: no reader is inside between these calls.
  void beginExclusive() { writing.store(true); for (Cell &c : cell) while (c.active.load()) std::this_thread::yield(); }
  void endExclusive() { writing.store(false); }
  size_t used() const { size_t n = 0; for (const Cell &c : cell) n += c.used.load(std::memory_order_relaxed); return n; }
  size_t stored() const { size_t n = 0; for (const Cell &c : cell) n += c.stored.load(std::memory_order_relaxed); return n; }
  size_t missing() const { size_t n = 0; for (const Cell &c : cell) n += c.missing.load(std::memory_order_relaxed); return n; }
};
// ============================================================================
// 4.5: STRICT MEMORY BUDGET (Budget) - repair of the 4.4 overrun.
//
// 4.4 defect (independent audit, reproduced by tests/coverage45.cpp against the
// archived 4.4 header): the key limit was derived as coverageMiB / 32 bytes and
// the LARGEST tier alone was sized to the whole allowance (2 slots a key, 16
// bytes a slot). The smaller tiers stay allocated until the set is destroyed
// (lock-free readers may still hold them), the three sketches were allocated
// unconditionally, and neither was counted against the allowance. For
// coverageMiB = 1 and 32,768 keys: 65,536 + 262,144 + 1,048,576 bytes of tiers
// + 49,152 bytes of sketches = 1,425,408 bytes live for a 1,048,576-byte
// allowance (+35.9%). A promotion abandoned for a pending stop left its
// half-built tier allocated as well, and every worker's 512 KiB WorkerFilter
// was outside any allowance.
//
// 4.5 semantics. coverageMiB is a HARD CEILING ON LIVE ALLOCATED BYTES of the
// coverage component of one request - not a reserved capacity and not a logical
// content size. The ledger (Budget) counts, while they are allocated:
//   * every tier (slot array, rounded up to whole 4 KiB pages): the current
//     one, the replacement being built during a promotion, and every retired
//     tier (retired tiers are kept until the set is destroyed so that lock-free
//     readers always read valid memory; they are budgeted, not hidden);
//   * the tier descriptors and the tier list (hash-table metadata);
//   * the three sketches (49,152 bytes);
//   * the set object itself, which contains the synchronisation state (the
//     64-cell SlotLock, mutexes, counters);
//   * every worker's WorkerFilter.
// Every allocation is preceded by Budget::reserve(), which checks
// `live + bytes <= limit` without overflow and refuses otherwise: nothing is
// allocated first and checked afterwards. The tier sizes are PLANNED when the
// set is created so that the whole sequence, including all retired tiers, fits
// (planFor); a refusal can therefore only come from a failed operating-system
// allocation or from a caller that shares the ledger and overdraws it, and is
// then handled like a failed allocation: the present tier becomes the last one,
// nothing half-built is published, the set is marked capped, the counts become
// exact lower bounds and `status` names the reason.
// Not covered by coverageMiB (separate budgets, reported separately): the
// evaluator's showdown tables and memo (memoryMiB), GPU buffers (gpuMiB), and
// the per-worker visit counters (three integers).
// ============================================================================
struct Budget {
  const size_t limit;                              // bytes; SIZE_MAX = unlimited (accounting only)
  std::atomic<size_t> live{0}, peak{0}, refusals{0};
  explicit Budget(size_t bytes) : limit(bytes) {}
  // Reserves `bytes` if the ceiling allows it. Never computes live + bytes unless it fits.
  bool reserve(size_t bytes) noexcept {
    size_t cur = live.load(std::memory_order_relaxed);
    for (;;) {
      if (bytes > limit || cur > limit - bytes) { refusals.fetch_add(1, std::memory_order_relaxed); return false; }
      if (live.compare_exchange_weak(cur, cur + bytes)) break;
    }
    const size_t now = cur + bytes; size_t p = peak.load(std::memory_order_relaxed);
    while (now > p && !peak.compare_exchange_weak(p, now)) {}
    return true;
  }
  void release(size_t bytes) noexcept { live.fetch_sub(bytes); }
};
inline size_t pageRound(size_t bytes) { return bytes > SIZE_MAX - 4095 ? SIZE_MAX : (bytes + 4095) & ~size_t(4095); }
enum : int { COV_OK = 0, COV_KEY_LIMIT = 1, COV_BUDGET_EXHAUSTED = 2, COV_ALLOCATION_FAILED = 3 };
inline const char *statusName(int s) { return s == COV_OK ? "ok" : s == COV_KEY_LIMIT ? "keyLimitReached" : s == COV_BUDGET_EXHAUSTED ? "budgetExhausted" : "allocationFailed"; }
struct SharedCoverage {
  static constexpr uint64_t F_STORED = Coverage::F_STORED, F_FALLBACK = Coverage::F_FALLBACK, NS_MASK = Coverage::NS_MASK, BUSY = uint64_t(1) << 63;
  static constexpr size_t FIRST_SLOTS = 4096, GROWTH = 4, MAX_TIERS = 32, PAGE_SLOTS = 256, PLAN_FIRST = 1024;
  struct Slot { std::atomic<uint64_t> id, nsf; };
  static_assert(sizeof(Slot) == 16, "16-byte slots");
  // One tier: a slot array that never moves. Tiers are only added (the newest is `cur`) and all are
  // freed together by the destructor, so a reader holding an older tier always reads valid memory.
  // 4.5: a tier may have any number of slots (the last tier of a byte budget takes what is left), so
  // the probe start is the multiply-shift reduction of the hash instead of a power-of-two mask.
  struct Table { Slot *slot; size_t slots; size_t start(uint64_t h) const { return (size_t)(((unsigned __int128)h * slots) >> 64); } size_t next(size_t i) const { return ++i == slots ? 0 : i; } };
  static size_t tierBytes(size_t slots) { return pageRound(slots * sizeof(Slot)) + sizeof(Table); }
  size_t limit = 0, maxSlots = 0;
  // Written by inserting threads; each on its own cache line, away from the read-mostly fields, so
  // lookups of keys already present (the common case) touch no line that another thread writes.
  // Units of the key limit handed out to threads (in blocks, see takeUnit): an upper bound of the
  // number of keys held, written once per block instead of once per key.
  alignas(64) std::atomic<size_t> reserved{0};
  alignas(64) std::atomic<bool> capped{false};
  // Distinct keys / keys seen with a stored row / with the fallback policy: summed over the per-thread cells.
  struct Sum { const SlotLock *l; int what; size_t load() const { return what == 0 ? l->used() : what == 1 ? l->stored() : l->missing(); } operator size_t() const { return load(); } };
  Sum distinct{&lock, 0}, distinctStored{&lock, 1}, distinctMissing{&lock, 2};
  alignas(64) std::atomic<Table *> cur{nullptr};
  uint64_t (*hash)(const Key &) = hashOf;   // test hook (forced collisions)
  bool sketch = true;
  // The request's stop code (deadline, cancellation, budget), if the owner provides it: while it
  // is non-zero no tier is promoted, so that a stop is never delayed by preparing a large tier.
  const std::atomic<int> *stop = nullptr;
  bool stopPending() const { return stop && stop->load(std::memory_order_relaxed) != 0; }
  // 4.5: why exact counting stopped (COV_OK while exact) and the ledger this set draws from.
  std::atomic<int> status{COV_OK};
  std::shared_ptr<Budget> budget;
  // Fault injection (tests): the next `failAllocations` tier allocations fail as if the operating
  // system had refused them; -1 = fail every one.
  std::atomic<int> failAllocations{0};
  // Promotions completed / abandoned for a stop (their half-built tier is released at once).
  std::atomic<size_t> promotions{0}, abandoned{0};

  // Bytes that do not depend on the number of keys: the object (with its lock cells), the tier
  // list and plan, and the sketches.
  static size_t fixedBytes(bool withSketch = true) { return sizeof(SharedCoverage) + 64 /* shared_ptr control block, allocator header */ + MAX_TIERS * (sizeof(Table *) + sizeof(size_t)) + (withSketch ? 3 * Hll::M : 0); }
  // Smallest allowance that gives an exact table at all (one page of slots).
  static size_t minimumBytes() { return fixedBytes() + tierBytes(PAGE_SLOTS); }
  // The tier sizes (slots) for a byte allowance: 1,024 slots, then four times larger each, and a
  // LAST tier that takes everything the allowance leaves after all earlier tiers (they stay
  // allocated) and the fixed bytes. A further power-of-four tier is inserted only while the last
  // tier stays at least four times larger than it, so the retired tiers cost at most a third of
  // the last one and at least ~3/4 of the slot memory is the final table.
  static std::vector<size_t> planFor(size_t allowanceBytes) {
    std::vector<size_t> plan; plan.reserve(MAX_TIERS);
    const size_t fixed = fixedBytes() + MAX_TIERS * sizeof(Table);
    if (allowanceBytes < fixed + PAGE_SLOTS * sizeof(Slot)) return plan;
    const size_t avail = (allowanceBytes - fixed) / sizeof(Slot) / PAGE_SLOTS * PAGE_SLOTS;   // whole pages
    size_t sum = 0, e = PLAN_FIRST;
    while (plan.size() + 1 < MAX_TIERS && avail > sum + e && (avail - sum - e) / GROWTH >= e) { plan.push_back(e); sum += e; if (e > SIZE_MAX / GROWTH) break; e *= GROWTH; }
    plan.push_back(avail - sum);
    return plan;
  }
  static size_t planBytes(const std::vector<size_t> &plan) { size_t b = 0; for (size_t s : plan) b += tierBytes(s); return b; }

  // 4.4 interface: a KEY limit (2 slots a key in the largest tier, powers of two). The implied
  // byte ceiling - every tier of the sequence, the sketches and the fixed bytes - is enforced by a
  // private ledger, so this path cannot exceed its documented bound (ceilingBytes()) either.
  explicit SharedCoverage(size_t keyLimit) {
    limit = std::max<size_t>(1, keyLimit);
    size_t top = Coverage::MIN_SLOTS; while (top < 2 * limit) top <<= 1;
    plan.reserve(MAX_TIERS);
    for (size_t s = std::min(FIRST_SLOTS, top);; s = std::min(top, s * GROWTH)) { plan.push_back(s); if (s == top) break; }
    budget = std::make_shared<Budget>(fixedBytes() + planBytes(plan));
    open();
  }
  // 4.5 interface: a hard ceiling on live bytes. `ledger` may be shared with the worker filters of
  // the same request; `tableAllowance` is the part of it this set may use (fixed bytes and every
  // tier); keyCap additionally bounds the exact key count (the evaluator passes coverageMiB / 32
  // bytes, the documented 4.3 capacity). The last tier is filled to at most 3/4.
  SharedCoverage(std::shared_ptr<Budget> ledger, size_t tableAllowance, size_t keyCap = SIZE_MAX) : budget(std::move(ledger)) {
    plan = planFor(tableAllowance);
    limit = plan.empty() ? 0 : std::min(keyCap, plan.back() / 4 * 3);
    if (limit == 0) plan.clear();
    open();
  }
  SharedCoverage(const SharedCoverage &) = delete; SharedCoverage &operator=(const SharedCoverage &) = delete;
  ~SharedCoverage() {
    for (Table *t : tiers) { freePages(t->slot, t->slots * sizeof(Slot)); delete t; }
    if (budget) budget->release(accounted.load());
  }
  // Slot memory of every live tier plus the sketches (the 4.4 figure, kept for comparison).
  size_t bytes() const { std::lock_guard<std::mutex> g(lock.writers); size_t b = sketchBytes(); for (const Table *t : tiers) b += t->slots * sizeof(Slot); return b; }
  // 4.5: every byte this set holds in the ledger right now (tiers incl. retired, descriptors, sketches, object).
  size_t liveBytes() const { return accounted.load(); }
  size_t peakBytes() const { return peakAccounted.load(); }
  size_t retiredBytes() const { std::lock_guard<std::mutex> g(lock.writers); const Table *c = cur.load(); size_t b = 0; for (const Table *t : tiers) if (t != c) b += tierBytes(t->slots); return b; }
  size_t sketchBytes() const { return hAll.r ? 3 * Hll::M : 0; }
  // The most this set can ever hold: fixed bytes and every planned tier.
  size_t ceilingBytes() const { return fixedBytes(sketch) + planBytes(plan); }
  size_t tierCount() const { std::lock_guard<std::mutex> g(lock.writers); return tiers.size(); }
  const std::vector<size_t> &tierPlan() const { return plan; }
  size_t slotsNow() const { const Table *t = cur.load(); return t ? t->slots : 0; }
  // Slot and sketch memory the growth rule needs for `keys` keys (tiers up to the first that is less
  // than half full). A pure function of the key count, so reports do not depend on the number of
  // threads; bytes() can be one tier ahead of it because threads reserve the key limit in blocks.
  size_t nominalBytes(size_t keys) const {
    if (plan.empty()) return sketchBytes();
    size_t total = plan[0];
    for (size_t i = 0; i + 1 < plan.size() && 2 * keys >= plan[i]; i++) total += plan[i + 1];
    return total * sizeof(Slot) + 3 * Hll::M;
  }
  // Records one observation of `k` (what = Coverage::STORED or Coverage::FALLBACK). Thread-safe.
  void mark(const Key &k, uint8_t what) { markHashed(k, what, hash(k)); }
  void markHashed(const Key &k, uint8_t what, uint64_t h) {
    const uint64_t add = ((what & Coverage::STORED) ? F_STORED : 0) | ((what & Coverage::FALLBACK) ? F_FALLBACK : 0);
    // Fast path, no lock and no shared write: the key is present with this flag in the tier this
    // thread sees. A tier that has since been replaced still gives a correct "present" answer
    // (keys and flags are never removed; they were copied to the newer tier); anything else,
    // including a slot being written, goes to the locked path.
    if (const Table *t = cur.load(std::memory_order_acquire)) {
      for (size_t i = t->start(h);; i = t->next(i)) {
        const uint64_t nsf = t->slot[i].nsf.load(std::memory_order_acquire);
        if (nsf == BUSY) break;
        if (nsf == 0) {
          // Absent, and the set is capped: it will never be inserted (the capped tier is the last
          // one), so the key only goes to the sketches. No lock: this is every lookup of a key
          // beyond the limit. (A thread inserting this very key right now adds it itself.)
          if (capped.load(std::memory_order_acquire)) { overflow(k, what); return; }
          break;
        }
        if ((nsf & NS_MASK) == (k.ns & NS_MASK) && t->slot[i].id.load(std::memory_order_relaxed) == k.id) { if (!(add & ~nsf)) return; break; }
      }
    }
    for (;;) {
      {
        SlotLock::Cell &c = lock.enter();   // inserts and flag updates: shared; promotion: exclusive
        struct Leave { SlotLock::Cell &c; ~Leave() { SlotLock::leave(c); } } leave{c};
        Table *t = cur.load();
        if (!t) { capOut(nullptr, COV_BUDGET_EXHAUSTED); overflow(k, what); return; }
        // Half full: promote. If another thread is already preparing the larger tier this thread
        // keeps inserting into the present one (it is at most 7/8 full: otherwise wait for the tier).
        // While a stop is pending (deadline, cancellation) nothing is promoted: the few observations
        // still arriving go into the present tier (up to 15/16 full).
        const size_t load8 = 8 * std::min(reserved.load(std::memory_order_relaxed), limit);
        if (!needsGrowth(*t) || (growing.load(std::memory_order_relaxed) && load8 < 7 * t->slots) || (stopPending() && 2 * load8 < 15 * t->slots)) { insertOrFlag(*t, c, k, what, add, h); return; }
      }
      if (!grow()) std::this_thread::yield();   // another thread is promoting and this tier is nearly full
    }
  }
  // After every writer has stopped. The sketches of a capped set were already back-filled when the
  // limit was reached (capOut), so this normally does nothing; it is kept as a safeguard and is idempotent.
  void finalize() { if (capped.load()) { std::lock_guard<std::mutex> h(hmu); backfill(cur.load()); } }
  double estimateDistinct() const { return std::max((double)lock.used(), hAll.estimate()); }
  double estimateStored() const { return std::max((double)lock.stored(), hStored.estimate()); }
  double estimateFallback() const { return std::max((double)lock.missing(), hFallback.estimate()); }
  // Every key held with its flags (single-threaded: tests, diagnostics).
  template<class F> void each(F &&f) const {
    const Table *t = cur.load(); if (!t) return;
    for (size_t i = 0; i < t->slots; i++) { const uint64_t nsf = t->slot[i].nsf.load(std::memory_order_relaxed); if (nsf && nsf != BUSY) f(Key{t->slot[i].id.load(std::memory_order_relaxed), nsf & NS_MASK}, (uint8_t)(Coverage::USED | flagsOf(nsf))); }
  }
 private:
  mutable SlotLock lock; std::vector<Table *> tiers;   // tiers: guarded by lock.writers
  std::vector<size_t> plan; size_t planned = 0;         // plan[planned] is the next tier to create (guarded by lock.writers)
  std::atomic<size_t> accounted{0}, peakAccounted{0};   // this set's share of the ledger
  alignas(64) std::atomic<bool> growing{false};
  std::mutex hmu; AtomicHll hAll{nullptr}, hStored{nullptr}, hFallback{nullptr}; bool backfilled = false;
  static uint8_t flagsOf(uint64_t nsf) { return (uint8_t)(((nsf & F_STORED) ? Coverage::STORED : 0) | ((nsf & F_FALLBACK) ? Coverage::FALLBACK : 0)); }
  bool take(size_t bytes) {
    if (!budget->reserve(bytes)) return false;
    const size_t now = accounted.fetch_add(bytes) + bytes; size_t p = peakAccounted.load();
    while (now > p && !peakAccounted.compare_exchange_weak(p, now)) {}
    return true;
  }
  void give(size_t bytes) { accounted.fetch_sub(bytes); budget->release(bytes); }
  // Constructor tail: reserve the fixed bytes, then the sketches, then the first tier - each one
  // reserved in the ledger BEFORE it is allocated. Whatever cannot be reserved is not allocated.
  void open() {
    if (!budget) budget = std::make_shared<Budget>(SIZE_MAX);
    try { tiers.reserve(MAX_TIERS); } catch (...) { plan.clear(); }
    if (!take(fixedBytes(false))) { plan.clear(); sketch = false; }   // not even the object fits: nothing more is allocated
    else if (take(3 * Hll::M)) {
      if (!hAll.init() || !hStored.init() || !hFallback.init()) { hAll.r.reset(); hStored.r.reset(); hFallback.r.reset(); give(3 * Hll::M); sketch = false; }
    } else sketch = false;
    maxSlots = plan.empty() ? 0 : plan.back();
    bool failed = false; int why = COV_ALLOCATION_FAILED;
    Table *t = plan.empty() ? nullptr : makeTable(plan[0], false, &failed, &why);
    if (!t) { maxSlots = 0; limit = 0; status.store(plan.empty() ? COV_BUDGET_EXHAUSTED : why); } else planned = 1;
    cur.store(t);
  }
  // Caller holds lock.writers (or is the constructor). abortable: gives up (returns null, *failed
  // stays false) when a stop becomes pending while the pages are being touched. The tier's bytes
  // are reserved in the ledger first; on any failure they are returned and nothing stays allocated.
  Table *makeTable(size_t n, bool abortable = false, bool *failed = nullptr, int *why = nullptr) {
    const size_t bytes = tierBytes(n);
    if (n > SIZE_MAX / sizeof(Slot) || !take(bytes)) { if (failed) *failed = true; if (why) *why = COV_BUDGET_EXHAUSTED; return nullptr; }
    int inject = failAllocations.load(); while (inject > 0 && !failAllocations.compare_exchange_weak(inject, inject - 1)) {}
    Slot *s = inject != 0 ? nullptr : static_cast<Slot *>(zeroPages(n * sizeof(Slot)));
    if (!s) { give(bytes); if (failed) *failed = true; if (why) *why = COV_ALLOCATION_FAILED; return nullptr; }
    // Touch every page now, from this one thread, before the tier is visible. Otherwise the workers
    // first-touch the pages concurrently (and a lookup that reads an untouched page maps the shared
    // zero page, which the next insert must replace): measured 0.09 s of kernel time for an 82,000-key
    // request on four threads against 0.004 s with the pages touched here.
    {
      volatile char *page = reinterpret_cast<volatile char *>(s);
      for (size_t off = 0; off < n * sizeof(Slot); off += 4096) {
        page[off] = 0;
        if (abortable && (off & 0x3ffff) == 0 && stopPending()) { freePages(s, n * sizeof(Slot)); give(bytes); return nullptr; }   // checked every 64 pages
      }
    }
    Table *t = new (std::nothrow) Table{s, n};
    if (!t) { freePages(s, n * sizeof(Slot)); give(bytes); if (failed) *failed = true; if (why) *why = COV_ALLOCATION_FAILED; return nullptr; }
    tiers.push_back(t);   // capacity reserved by open(): cannot allocate
    return t;
  }
  // 4.5: a tier that was prepared but never published (abandoned promotion). No reader can hold it,
  // so it is released at once instead of staying allocated until the set is destroyed. Caller holds lock.writers.
  void discard(Table *t) {
    tiers.pop_back();   // it is the newest
    freePages(t->slot, t->slots * sizeof(Slot)); give(tierBytes(t->slots)); delete t; abandoned.fetch_add(1);
  }
  // Called inside lock.enter()/leave(): `t` is the current tier and cannot be replaced meanwhile. Every
  // thread that inserts or adds a flag does it here, on the same tier, so the claim protocol
  // (compare-and-swap to BUSY, publish) makes concurrent inserts of one key find each other.
  void insertOrFlag(Table &t, SlotLock::Cell &c, const Key &k, uint8_t what, uint64_t add, uint64_t h) {
    Slot *slot = t.slot;
    for (size_t i = t.start(h);;) {
      uint64_t nsf = slot[i].nsf.load(std::memory_order_acquire);
      if (nsf == BUSY) { std::this_thread::yield(); continue; }   // another thread is writing this slot
      if (nsf == 0) {
        if (capped.load()) { overflow(k, what); return; }
        uint64_t expect = 0;
        if (!slot[i].nsf.compare_exchange_strong(expect, BUSY)) continue;   // lost the race: look at the slot again
        if (!takeUnit(c)) { slot[i].nsf.store(0); capOut(&t, COV_KEY_LIMIT); overflow(k, what); return; }   // the key limit: release the claim
        c.used.fetch_add(1, std::memory_order_relaxed);
        slot[i].id.store(k.id, std::memory_order_relaxed);
        slot[i].nsf.store((k.ns & NS_MASK) | add);   // publish (sequentially consistent with the capped flag below)
        if (add & F_STORED) c.stored.fetch_add(1, std::memory_order_relaxed);
        if (add & F_FALLBACK) c.missing.fetch_add(1, std::memory_order_relaxed);
        // A slot published while another thread was back-filling the sketches may have been skipped
        // by that scan (it was BUSY): add the key here. If the flag is still false the scan has not
        // started and will see the published slot.
        if (capped.load()) overflow(k, what);
        return;
      }
      if ((nsf & NS_MASK) == (k.ns & NS_MASK) && slot[i].id.load(std::memory_order_relaxed) == k.id) {
        if (add & ~nsf) {
          const uint64_t old = slot[i].nsf.fetch_or(add), added = add & ~old;
          if (added & F_STORED) c.stored.fetch_add(1, std::memory_order_relaxed);
          if (added & F_FALLBACK) c.missing.fetch_add(1, std::memory_order_relaxed);
          if (added && capped.load()) overflow(k, what);   // a flag set after the back-fill scan read this slot
        }
        return;
      }
      i = t.next(i);
    }
  }
  // Promotion to the next planned tier, by one thread at a time.
  //  1. The new tier is reserved in the ledger, allocated and its pages touched WITHOUT excluding
  //     anybody: other threads keep inserting into the present tier meanwhile (allocating and
  //     touching 64 MiB takes tens of milliseconds; when that was inside the exclusive section every
  //     worker was stalled and a deadline falling into it was noticed up to 30 ms late).
  //  2. Exclusive section (no insert or flag update in progress, no slot BUSY): every key is copied
  //     with its flags and `cur` is switched. This is the only stall: a copy of the keys held.
  // If the larger tier cannot be reserved or allocated the present tier becomes the last one and the
  // exact key limit shrinks to its half (counts beyond it are then lower bounds, labelled as such,
  // and `status` records whether the ledger or the operating system refused).
  // Returns false if another thread is promoting (the caller then inserts into the present tier or,
  // if that is nearly full, tries again). A promotion is abandoned when a stop becomes pending while
  // the new tier is being prepared; 4.5 releases the prepared memory immediately (4.4 kept it until
  // the set was destroyed, and a later promotion then allocated the tier a second time).
  bool grow() {
    std::unique_lock<std::mutex> g(lock.writers, std::try_to_lock); if (!g.owns_lock()) return false;
    Table *t = cur.load(); if (!t || !needsGrowth(*t)) return true;
    growing.store(true); struct Done { std::atomic<bool> &f; ~Done() { f.store(false); } } done{growing};
    // A promotion may be abandoned for a pending stop only while the present tier still has room
    // (below 15/16, where inserts continue into it); a nearly full tier is always promoted.
    const bool mayAbandon = 16 * std::min(reserved.load(), limit) < 15 * t->slots;
    bool failed = false; int why = COV_ALLOCATION_FAILED;
    Table *n = planned < plan.size() ? makeTable(plan[planned], mayAbandon, &failed, &why) : (failed = true, why = COV_BUDGET_EXHAUSTED, nullptr);
    if (!n) { if (failed) { lock.beginExclusive(); maxSlots = t->slots; limit = std::min(limit, t->slots / 2); status.store(why); lock.endExclusive(); } return true; }
    if (mayAbandon && stopPending()) { discard(n); return true; }
    lock.beginExclusive(); struct End { SlotLock &l; ~End() { l.endExclusive(); } } end{lock};
    for (size_t i = 0; i < t->slots; i++) {
      // A stop that arrives during the copy abandons the promotion (the present tier is intact and
      // still current; the half-filled new tier was never published and is released here).
      if (mayAbandon && (i & 0xfff) == 0 && stopPending()) { discard(n); return true; }
      const uint64_t nsf = t->slot[i].nsf.load(std::memory_order_relaxed); if (!nsf) continue;
      const uint64_t id = t->slot[i].id.load(std::memory_order_relaxed);
      size_t j = n->start(hash(Key{id, nsf & NS_MASK})); while (n->slot[j].nsf.load(std::memory_order_relaxed)) j = n->next(j);
      n->slot[j].id.store(id, std::memory_order_relaxed); n->slot[j].nsf.store(nsf, std::memory_order_relaxed);
    }
    planned++; promotions.fetch_add(1);
    cur.store(n);
    return true;
  }
  void sketchAdd(const Key &k, uint8_t what) {
    const uint64_t h = mix64(hashOf(k) + 0x632be59bd9b4e019ULL);
    hAll.add(h); if (what & Coverage::STORED) hStored.add(h); if (what & Coverage::FALLBACK) hFallback.add(h);
  }
  // Half full (counted by the units handed out, which can exceed the keys held by one block per
  // thread: a tier is then promoted slightly early, never late).
  bool needsGrowth(const Table &t) const { return t.slots < maxSlots && 2 * std::min(reserved.load(std::memory_order_relaxed), limit) >= t.slots; }
  // One unit of the key limit for the thread that owns cell `c`. Units are taken from the shared
  // reserve in blocks (one shared write per block instead of one per key: a per-key shared counter
  // halved four-thread insert throughput in tools measurements). When the reserve is exhausted the
  // unused rest of other threads' blocks is taken over, and the set is capped only when the number
  // of keys held equals the limit: exactly the 4.3 meaning of the limit.
  bool takeUnit(SlotLock::Cell &c) {
    if (c.quota.fetch_sub(1) > 0) return true;
    c.quota.fetch_add(1);
    const size_t block = std::clamp<size_t>(limit / 256, 1, 256);
    for (;;) {
      size_t r = reserved.load();
      if (r >= limit) {
        long long got = 0;
        for (SlotLock::Cell &o : lock.cell) { if (&o == &c) continue; long long x = o.quota.load(); while (x > 0 && !o.quota.compare_exchange_weak(x, 0)) {} if (x > 0) got += x; }
        if (got > 0) { if (got > 1) c.quota.fetch_add(got - 1); return true; }
        // Nothing to take over. The limit is reached only if every unit has become a key; otherwise
        // some thread is between taking a unit and counting its key, or holds units it took over a
        // moment ago: look again. (The count of keys never exceeds the units handed out, so reading
        // the per-thread counts one by one can only under-report: equality is certain.)
        if (lock.used() >= limit) return false;
        std::this_thread::yield();
        continue;
      }
      const size_t want = std::min(block, limit - r);
      if (reserved.compare_exchange_weak(r, r + want)) { if (want > 1) c.quota.fetch_add((long long)want - 1); return true; }
    }
  }
  void overflow(const Key &k, uint8_t what) { if (sketch) sketchAdd(k, what); }   // lock-free (atomic registers)
  // The key limit was reached: the first thread to notice back-fills the sketches from the table
  // WHILE THE WORKERS RUN (a 4.4 development build did this after the stop: 25 ms past a 3 s limit).
  // Sketch registers are atomic maxima, so other threads keep adding their overflow keys without a
  // lock while the scan runs; keys and flags published during the scan add themselves (see
  // insertOrFlag), so the sketches cover every key and flag whatever the interleaving. Called by an
  // inserting thread (the tier cannot change); the limit is only reached on the last tier.
  void capOut(Table *t, int why) {
    bool was = false; if (!capped.compare_exchange_strong(was, true)) return;
    int ok = COV_OK; status.compare_exchange_strong(ok, why);   // keep an earlier, more specific reason
    std::lock_guard<std::mutex> g(hmu); backfill(t);
  }
  void backfill(const Table *t) {   // hmu held
    if (backfilled || !sketch) return;
    backfilled = true; if (!t) return;
    for (size_t i = 0; i < t->slots; i++) { const uint64_t nsf = t->slot[i].nsf.load(); if (nsf && nsf != BUSY) sketchAdd(Key{t->slot[i].id.load(std::memory_order_relaxed), nsf & NS_MASK}, flagsOf(nsf)); }
  }
};
// Per-worker cache of observations already reported to the SharedCoverage.
// 4.5: the filter is part of the coverage budget. configure() names the ledger and the
// number of entries (a power of two, at most SIZE; 0 = no filter); the bytes are reserved before
// the array is allocated and returned by the destructor. Without a filter every observation is
// reported to the set, which is slower but gives the identical result (the filter is a cache).
// A default-constructed filter (tests, 4.4 behaviour) holds SIZE entries and is not budgeted.
struct WorkerFilter {
  static constexpr size_t SIZE = size_t(1) << 15;   // 32,768 entries, 512 KiB a worker
  struct Entry { uint64_t id, nsf; };
  std::vector<Entry> e; size_t entries = SIZE; std::shared_ptr<Budget> budget; size_t held = 0; bool off = false;
  WorkerFilter() = default; WorkerFilter(const WorkerFilter &) = delete; WorkerFilter &operator=(const WorkerFilter &) = delete;
  ~WorkerFilter() { if (budget && held) budget->release(held); }
  void configure(std::shared_ptr<Budget> ledger, size_t n) { budget = std::move(ledger); entries = n; off = n == 0; }
  // Largest power-of-two entry count (<= SIZE) such that `workers` filters fit in `bytes`; 0 if fewer than 256.
  static size_t entriesFor(size_t bytes, size_t workers) {
    const size_t each = bytes / std::max<size_t>(1, workers) / sizeof(Entry); size_t n = SIZE;
    while (n > each) n >>= 1;
    return n < 256 ? 0 : n;
  }
  size_t bytes() const { return e.capacity() * sizeof(Entry); }
  bool start() {
    if (budget) { if (!budget->reserve(entries * sizeof(Entry))) { off = true; return false; } held = entries * sizeof(Entry); }
    try { e.assign(entries, Entry{0, 0}); } catch (...) { if (budget) { budget->release(held); held = 0; } off = true; return false; }
    return true;
  }
  // True if (k, what) must be reported; remembers it.
  bool miss(const Key &k, uint8_t what, uint64_t h) {
    if (e.empty()) { if (off || !start()) return true; }
    Entry &x = e[(size_t)(h >> 17) & (entries - 1)];
    const uint64_t bit = (what & Coverage::STORED) ? Coverage::F_STORED : Coverage::F_FALLBACK;
    if (x.id == k.id && (x.nsf & Coverage::NS_MASK) == k.ns) { if (x.nsf & bit) return false; x.nsf |= bit; return true; }
    x.id = k.id; x.nsf = k.ns | bit; return true;
  }
};
}  // namespace emcov
