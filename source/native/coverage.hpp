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
    if (o.capped) { capOut(); hAll.merge(o.hAll); hStored.merge(o.hStored); hFallback.merge(o.hFallback); }
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
    capped(o.capped), limit(o.limit), pool(nullptr), sketch(o.sketch), hAll(o.hAll), hStored(o.hStored), hFallback(o.hFallback), hash(o.hash), slot(o.slot) {}
  Coverage &operator=(const Coverage &) = delete;
  ~Coverage() { if (pool) pool->fetch_add((long long)(slot.size() * SLOT_BYTES)); }

 private:
  struct Slot { uint64_t id, nsf; };   // nsf == 0: empty
  std::vector<Slot> slot;
  static uint8_t flagsOf(uint64_t nsf) { return (uint8_t)(((nsf & F_STORED) ? STORED : 0) | ((nsf & F_FALLBACK) ? FALLBACK : 0)); }
  size_t find(const Key &k, bool &found) const {
    const size_t mask = slot.size() - 1;
    for (size_t i = (size_t)hash(k) & mask;; i = (i + 1) & mask) {
      if (!slot[i].nsf) { found = false; return i; }
      if (slot[i].id == k.id && (slot[i].nsf & NS_MASK) == k.ns) { found = true; return i; }
    }
  }
  bool grow() {
    const size_t n = slot.empty() ? MIN_SLOTS : slot.size() * 2;
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
    if (!sketch) return;
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
  std::unique_ptr<std::atomic<uint8_t>[]> r{new std::atomic<uint8_t>[Hll::M]()};
  void add(uint64_t h) {
    const size_t idx = (size_t)(h >> (64 - Hll::P)); const uint64_t w = (h << Hll::P) | (uint64_t(1) << (Hll::P - 1));
    const uint8_t rank = (uint8_t)(__builtin_clzll(w) + 1); uint8_t cur = r[idx].load(std::memory_order_relaxed);
    while (rank > cur && !r[idx].compare_exchange_weak(cur, rank, std::memory_order_relaxed)) {}
  }
  double estimate() const {
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
struct SharedCoverage {
  static constexpr uint64_t F_STORED = Coverage::F_STORED, F_FALLBACK = Coverage::F_FALLBACK, NS_MASK = Coverage::NS_MASK, BUSY = uint64_t(1) << 63;
  static constexpr size_t FIRST_SLOTS = 4096, GROWTH = 4;
  struct Slot { std::atomic<uint64_t> id, nsf; };
  static_assert(sizeof(Slot) == 16, "16-byte slots");
  // One tier: a slot array that never moves. Tiers are only added (the newest is `cur`) and all are
  // freed together by the destructor, so a reader holding an older tier always reads valid memory.
  struct Table { Slot *slot; size_t slots; };
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
  explicit SharedCoverage(size_t keyLimit) {
    limit = std::max<size_t>(1, keyLimit);
    maxSlots = Coverage::MIN_SLOTS; while (maxSlots < 2 * limit) maxSlots <<= 1;
    Table *t = makeTable(std::min(FIRST_SLOTS, maxSlots));
    if (!t) { maxSlots = 0; limit = 0; }
    cur.store(t);
  }
  SharedCoverage(const SharedCoverage &) = delete; SharedCoverage &operator=(const SharedCoverage &) = delete;
  ~SharedCoverage() { for (Table *t : tiers) { freePages(t->slot, t->slots * sizeof(Slot)); delete t; } }
  // Slot memory of every tier plus the sketches. At most about 4/3 of the largest tier
  // (16 bytes a slot, 2 slots a key at the key limit).
  size_t bytes() const { std::lock_guard<std::mutex> g(lock.writers); size_t b = 3 * Hll::M; for (const Table *t : tiers) b += t->slots * sizeof(Slot); return b; }
  size_t slotsNow() const { const Table *t = cur.load(); return t ? t->slots : 0; }
  // Slot and sketch memory the growth rule needs for `keys` keys (tiers up to the first that is less
  // than half full). A pure function of the key count, so reports do not depend on the number of
  // threads; bytes() can be one tier ahead of it because threads reserve the key limit in blocks.
  size_t nominalBytes(size_t keys) const {
    if (!maxSlots) return 3 * Hll::M;
    size_t slots = std::min(FIRST_SLOTS, maxSlots), total = slots;
    while (slots < maxSlots && 2 * keys >= slots) { slots = std::min(maxSlots, slots * GROWTH); total += slots; }
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
      const size_t mask = t->slots - 1;
      for (size_t i = (size_t)h & mask;; i = (i + 1) & mask) {
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
        if (!t) { capOut(nullptr); overflow(k, what); return; }
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
  alignas(64) std::atomic<bool> growing{false};
  std::mutex hmu; AtomicHll hAll, hStored, hFallback; bool backfilled = false;
  static uint8_t flagsOf(uint64_t nsf) { return (uint8_t)(((nsf & F_STORED) ? Coverage::STORED : 0) | ((nsf & F_FALLBACK) ? Coverage::FALLBACK : 0)); }
  // Caller holds lock.writers (or is the constructor). abortable: gives up (returns null, *failed
  // stays false) when a stop becomes pending while the pages are being touched.
  Table *makeTable(size_t n, bool abortable = false, bool *failed = nullptr) {
    Slot *s = static_cast<Slot *>(zeroPages(n * sizeof(Slot))); if (!s) { if (failed) *failed = true; return nullptr; }
    // Touch every page now, from this one thread, before the tier is visible. Otherwise the workers
    // first-touch the pages concurrently (and a lookup that reads an untouched page maps the shared
    // zero page, which the next insert must replace): measured 0.09 s of kernel time for an 82,000-key
    // request on four threads against 0.004 s with the pages touched here.
    {
      volatile char *page = reinterpret_cast<volatile char *>(s);
      for (size_t off = 0; off < n * sizeof(Slot); off += 4096) {
        page[off] = 0;
        if (abortable && (off & 0x3ffff) == 0 && stopPending()) { freePages(s, n * sizeof(Slot)); return nullptr; }   // checked every 64 pages
      }
    }
    Table *t = new (std::nothrow) Table{s, n}; if (!t) { freePages(s, n * sizeof(Slot)); if (failed) *failed = true; return nullptr; }
    try { tiers.push_back(t); } catch (...) { freePages(s, n * sizeof(Slot)); delete t; if (failed) *failed = true; return nullptr; }
    return t;
  }
  // Called inside lock.enter()/leave(): `t` is the current tier and cannot be replaced meanwhile. Every
  // thread that inserts or adds a flag does it here, on the same tier, so the claim protocol
  // (compare-and-swap to BUSY, publish) makes concurrent inserts of one key find each other.
  void insertOrFlag(Table &t, SlotLock::Cell &c, const Key &k, uint8_t what, uint64_t add, uint64_t h) {
    const size_t mask = t.slots - 1; Slot *slot = t.slot;
    for (size_t i = (size_t)h & mask;;) {
      uint64_t nsf = slot[i].nsf.load(std::memory_order_acquire);
      if (nsf == BUSY) { std::this_thread::yield(); continue; }   // another thread is writing this slot
      if (nsf == 0) {
        if (capped.load()) { overflow(k, what); return; }
        uint64_t expect = 0;
        if (!slot[i].nsf.compare_exchange_strong(expect, BUSY)) continue;   // lost the race: look at the slot again
        if (!takeUnit(c)) { slot[i].nsf.store(0); capOut(&t); overflow(k, what); return; }   // the key limit: release the claim
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
      i = (i + 1) & mask;
    }
  }
  // Promotion to a tier GROWTH times larger, by one thread at a time.
  //  1. The new tier is allocated and its pages touched WITHOUT excluding anybody: other threads
  //     keep inserting into the present tier meanwhile (allocating and touching 64 MiB takes tens
  //     of milliseconds; when that was inside the exclusive section every worker was stalled and
  //     a deadline falling into it was noticed up to 30 ms late).
  //  2. Exclusive section (no insert or flag update in progress, no slot BUSY): every key is copied
  //     with its flags and `cur` is switched. This is the only stall: a copy of the keys held.
  // If the larger tier cannot be allocated the present tier becomes the last one and the exact key
  // limit shrinks to its half (counts beyond it are then lower bounds, labelled as such).
  // Returns false if another thread is promoting (the caller then inserts into the present tier or,
  // if that is nearly full, tries again). A promotion is abandoned when a stop becomes pending while
  // the new tier is being prepared; the prepared memory is released with the set.
  bool grow() {
    std::unique_lock<std::mutex> g(lock.writers, std::try_to_lock); if (!g.owns_lock()) return false;
    Table *t = cur.load(); if (!t || !needsGrowth(*t)) return true;
    growing.store(true); struct Done { std::atomic<bool> &f; ~Done() { f.store(false); } } done{growing};
    // A promotion may be abandoned for a pending stop only while the present tier still has room
    // (below 15/16, where inserts continue into it); a nearly full tier is always promoted.
    const bool mayAbandon = 16 * std::min(reserved.load(), limit) < 15 * t->slots;
    bool failed = false;
    Table *n = makeTable(std::min(maxSlots, t->slots * GROWTH), mayAbandon, &failed);
    if (!n) { if (failed) { lock.beginExclusive(); maxSlots = t->slots; limit = std::min(limit, t->slots / 2); lock.endExclusive(); } return true; }
    if (mayAbandon && stopPending()) return true;
    lock.beginExclusive(); struct End { SlotLock &l; ~End() { l.endExclusive(); } } end{lock};
    const size_t mask = n->slots - 1;
    for (size_t i = 0; i < t->slots; i++) {
      // A stop that arrives during the copy abandons the promotion (the present tier is intact and
      // still current; the half-filled new tier is never published and is released with the set).
      if (mayAbandon && (i & 0xfff) == 0 && stopPending()) return true;
      const uint64_t nsf = t->slot[i].nsf.load(std::memory_order_relaxed); if (!nsf) continue;
      const uint64_t id = t->slot[i].id.load(std::memory_order_relaxed);
      size_t j = (size_t)hash(Key{id, nsf & NS_MASK}) & mask; while (n->slot[j].nsf.load(std::memory_order_relaxed)) j = (j + 1) & mask;
      n->slot[j].id.store(id, std::memory_order_relaxed); n->slot[j].nsf.store(nsf, std::memory_order_relaxed);
    }
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
  void capOut(Table *t) {
    bool was = false; if (!capped.compare_exchange_strong(was, true)) return;
    std::lock_guard<std::mutex> g(hmu); backfill(t);
  }
  void backfill(const Table *t) {   // hmu held
    if (backfilled || !sketch) return;
    backfilled = true; if (!t) return;
    for (size_t i = 0; i < t->slots; i++) { const uint64_t nsf = t->slot[i].nsf.load(); if (nsf && nsf != BUSY) sketchAdd(Key{t->slot[i].id.load(std::memory_order_relaxed), nsf & NS_MASK}, flagsOf(nsf)); }
  }
};
// Per-worker cache of observations already reported to the SharedCoverage.
struct WorkerFilter {
  static constexpr size_t SIZE = size_t(1) << 15;   // 32,768 entries, 512 KiB a worker
  struct Entry { uint64_t id, nsf; };
  std::vector<Entry> e;
  // True if (k, what) must be reported; remembers it.
  bool miss(const Key &k, uint8_t what, uint64_t h) {
    if (e.empty()) e.assign(SIZE, Entry{0, 0});
    Entry &x = e[(size_t)(h >> 17) & (SIZE - 1)];
    const uint64_t bit = (what & Coverage::STORED) ? Coverage::F_STORED : Coverage::F_FALLBACK;
    if (x.id == k.id && (x.nsf & Coverage::NS_MASK) == k.ns) { if (x.nsf & bit) return false; x.nsf |= bit; return true; }
    x.id = k.id; x.nsf = k.ns | bit; return true;
  }
};
}  // namespace emcov
