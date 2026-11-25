// EightMax 3.1 native betting rules and external-sampling MCCFR (spec protocol 4).
//
// Version 3.0 could only train a betting tree that JavaScript had built in full
// and serialised (at most 250,000 states). Protocol 4 sends the betting RULES
// instead: stacks, earlier wagers, blinds/antes, the per-street bet and raise
// abstraction and the raise caps. This file generates every betting state on
// demand with the same operations as lib_river.js build()/advance()/
// nextStreet() and EM.potLayers(), and trains it with the external-sampling
// update of lib_wide.js learn():
//   - the updating seat enumerates its actions; every other seat samples one
//     action from q = 0.9 sigma + 0.1/k;
//   - an opponent node returns sigma(a)/q(a) times the sampled child value, and
//     an updating node scales its regret increment by
//     pi_-i(h)/q_-i(h) (opponentReach/sampleReach), so each opponent sampling
//     ratio is applied exactly once and the estimate is unbiased;
//   - the average strategy is accumulated at the updating seat's nodes with
//     weight own reach * sigma(a) / q_-i(h) (stochastically weighted averaging).
// Only visited states receive an identifier, so storage grows with the sampled
// part of the game rather than the full tree. Identifiers are assigned while
// increments are merged, in deal order, so results never depend on the number
// of threads.
//
// Action random streams:
//   shared  - one stream for the whole study, consumed in JavaScript order.
//             Bit-identical to lib_wide.js; deals are traversed one at a time.
//   deal    - each (iteration, deal) has its own stream derived from the study
//             seed. Also implemented in lib_wide.js (bit-identical). With
//             several deals per frozen batch the deals are traversed in
//             parallel.
#pragma once
#include "es_memory.hpp"
#include <thread>
#include <atomic>
#include <chrono>
#include <exception>
#include <mutex>
#include <condition_variable>
#include <functional>
#include <memory>
#include <algorithm>
#include <string>
#include <unordered_map>
namespace {
namespace es {
constexpr double EPS = 1e-8;
constexpr int CHANCE_SLOT = 7, MAX_DEPTH = 480;
struct Size { int kind = 0; double value = 0; };   // 0 jam, 1 geometric, 2 pot fraction, 3 raise multiple, 4 absolute
struct Street { std::vector<Size> bets, raises; int cap = 2; bool present = false; };
// One betting state. Mirrors the template object of lib_river.js build().
#include "es_groups.hpp"
#include "es_rbes510.hpp"
struct BS {
  int length = 0, kind = 0, actor = -1, k = 0, count = 0;   // kind 0 player, 1 chance, 2 terminal
  bool facing = false;
  double price = 0, full = 1, pot = 0;
  bool live[8];
  double previous[8], put[8], acted[8], total[8], behind[8], to[8];
};
struct LPot { double amount; int count; int seat[16]; uint32_t mask; };   // 3.8 mask: dealt seats (< n) of seat[]
// 3.3: discounted CFR schedule for external sampling (see EM.dcfrSchedule in
// lib_wide.js, which performs the same operations). Prefix products
// P_t = prod_{u<=t} u^x/(u^x+1) are kept as a mantissa in [0.5,1) and a binary
// exponent; P_t/P_s is one division times an exact power of two, so beta = 0
// (factor 1/2 per iteration) never underflows. Rows store the iteration through
// which their regrets are discounted and catch up when next updated.
#ifndef EM_STATE_STORE_MIB
#define EM_STATE_STORE_MIB 16
#endif
struct Dcfr {
  double alpha = 1.5, beta = 0, gamma = 2;
  std::vector<double> mant[2]; std::vector<int64_t> expo[2]; double two[1001] = {};
  static double powExact(double u, double x) {
    if (x == 0) return 1;
    if (x == 1) return u;
    if (x == 2) return u * u;
    if (x == 3) return u * u * u;
    if (x == 0.5) return std::sqrt(u);
    if (x == 1.5) return u * std::sqrt(u);
    return std::pow(u, x);
  }
  void init(double a, double b, double g) {
    alpha = a; beta = b; gamma = g; two[0] = 1; for (int i = 1; i <= 1000; i++) two[i] = two[i - 1] * 0.5;
    for (int t = 0; t < 2; t++) { mant[t].assign(1, 1.0); expo[t].assign(1, 0); }
  }
  size_t bytes() const { return mant[0].capacity() * 32; }
  // Extends both tables through iteration t. Returns false when the growth would exceed `room` bytes.
  bool extend(long long t, double room) {
    if ((long long)mant[0].size() > t) return true;
    if ((double)(t + 1) * 32 * 2 > room) return false;   // capacity doubling worst case
    for (int b = 0; b < 2; b++) {
      const double x = b ? beta : alpha;
      while ((long long)mant[b].size() <= t) {
        const double u = (double)mant[b].size(), pu = powExact(u, x);
        double m = mant[b].back() * (pu / (pu + 1)); int64_t e = expo[b].back();
        if (m > 0) { while (m < 0.5) { m *= 2; e--; } while (m >= 1) { m *= 0.5; e++; } }
        mant[b].push_back(m); expo[b].push_back(e);
      }
    }
    return true;
  }
  double ratio(int b, long long s, long long t) const {
    const long long d = (long long)expo[b][(size_t)s] - expo[b][(size_t)t];
    if (!(mant[b][(size_t)t] > 0) || d > 1075) return 0;
    if(d>1000)return (mant[b][(size_t)t]/mant[b][(size_t)s]*two[1000])*two[d-1000];
    return mant[b][(size_t)t] / mant[b][(size_t)s] * two[d];
  }
  double averageWeight(double t) const { return powExact(t, gamma); }
};
// 3.8: live memory of a restored external-sampling study, from the counts in
// its archive header, before any large allocation. Mirrors the allocations of
// the loader (checkpoint_native.hpp) and the table/hash growth rules: values
// (+ equal frozen-batch delta when batchDeals > 1, + reserve headroom), row
// metadata, the row hash (power of two >= 2 x rows, 12 bytes per bucket), the
// betting-state arrays (9 bytes per state, vector growth up to 2x) and the
// state hash (power of two, kept at most half full, 12 bytes per bucket).
struct RestoreEstimate { double values = 0, rowMeta = 0, rowHash = 0, states = 0, stateHash = 0, total = 0; };
inline size_t pow2AtLeast(size_t x, size_t lo) { size_t b = lo; while (b < x) b *= 2; return b; }
inline RestoreEstimate restoreEstimate(uint64_t stateCount, uint64_t rowCount, uint64_t valueCount, int batchDeals, double rowMetaBytes) {
  RestoreEstimate e;
  const double headroom = (double)std::min<uint64_t>(valueCount / 256 + 16, 131072);
  e.values = ((double)valueCount + headroom) * 8.0 * (batchDeals > 1 ? 2 : 1);
  e.rowMeta = ((double)rowCount + (double)std::min<uint64_t>(rowCount / 256 + 4, 16384)) * rowMetaBytes;
  e.rowHash = (double)pow2AtLeast(2 * (rowCount + 1), 1024) * 12.0;
  e.states = (double)pow2AtLeast(stateCount, 1) * 9.0;
  e.stateHash = (double)pow2AtLeast(2 * stateCount, 4096) * 12.0;
  e.total = e.values + e.rowMeta + e.rowHash + e.states + e.stateHash;
  return e;
}
inline double jsMax0(double v) { return v > 0 ? v : 0.0; }   // Math.max(0, v) for finite v (returns +0 for -0)

struct Rules {
  int n = 2, rootLength = 5;
  bool pre = false, shove = false, noLimp = false;
  double stacks[8] = {}, prior[8] = {}, ownAnte[8] = {}, posted[8] = {}, common = 0, pot0 = 0;
  std::vector<double> folded;
  bool open[8] = {};
  Street sizes[6];

  void build(BS &s, int length, const double *previous, const double *put, const bool *live, const double *acted,
             double price, double full, int count, int last) const {
    s.length = length; s.count = count; s.full = full;
    bool acting[8]; int liveCount = 0, left = 0; double sum = 0;
    for (int p = 0; p < n; p++) {
      s.previous[p] = previous[p]; s.put[p] = put[p]; s.acted[p] = acted[p]; s.live[p] = live[p];
      s.total[p] = previous[p] + put[p];sum+=s.total[p];
      s.behind[p] = std::max(0.0, stacks[p] - s.total[p]);
      acting[p] = live[p] && s.behind[p] > EPS; liveCount += live[p]; left += acting[p];
    }
    if (length == 0 && left <= 1) {
      double m = -INFINITY; for (int p = 0; p < n; p++) if (live[p]) m = std::max(m, put[p]);
      price = std::min(price, m);
    }
    s.pot = pot0 + sum; s.price = price; s.actor = -1; s.k = 0; s.facing = false;
    int next=last;
    if (liveCount > 1) for (int i = 0; i < n; i++) {
      if(++next==n)next=0;
      int p=next;
      if (acting[p] && (put[p] < price - EPS || (left > 1 && acted[p] < 0))) { s.actor = p; break; }
    }
    if (s.actor < 0) {
      s.kind = (liveCount > 1 && left >= 2 && length < 5 && !(shove && length == 0)) ? 1 : 2;
      return;
    }
    s.kind = 0;
    const int p = s.actor;
    const double remaining = stacks[p] - previous[p], call = std::min(price, remaining);
    const bool facing = price > put[p] + EPS; s.facing = facing;
    int k = 0;
    if (facing) { s.to[k++] = put[p]; s.to[k++] = call; } else s.to[k++] = put[p];
    bool allInOpponent = false, respondent = false;
    for (int i = 0; i < n; i++) if (live[i] && i != p) {
      if (s.behind[i] <= EPS && put[i] > EPS) allInOpponent = true;
      if (stacks[i] - previous[i] > price + EPS) respondent = true;
    }
    if (length == 0 && count == 0 && facing && remaining > price + EPS && left > 1 && !allInOpponent && (shove || noLimp)) k = 1;
    const Street &row = sizes[length];
    if (respondent && count < row.cap && (facing || open[p]) && (acted[p] < 0 || price - acted[p] >= full - EPS)) {
      const std::vector<Size> &list = length == 0 ? (count ? row.raises : row.bets) : (facing ? row.raises : row.bets);
      double amounts[8]; int na = 0;
      for (const Size &size : list) {
        double to = remaining;
        if (size.kind == 4) to = size.value;
        if (size.kind == 3) to = size.value * price;
        if (size.kind == 2) to = price + size.value * (s.pot + (facing ? price - put[p] : 0));
        if (size.kind == 1) {
          double mo = -INFINITY;
          for (int i = 0; i < n; i++) mo = std::max(mo, live[i] && i != p ? s.behind[i] : 0.0);
          const double eff = std::min(s.behind[p], mo);
          const int kk = length == 0 ? 1 : 6 - length;
          to = price + (std::pow(1 + 2 * eff / s.pot, 1.0 / kk) - 1) / 2 * s.pot;
        }
        to = std::min(remaining, std::max(price + full, to));
        bool dup = false; for (int j = 0; j < na; j++) if (std::fabs(amounts[j] - to) < EPS) dup = true;
        if (to > price + EPS && !dup) amounts[na++] = to;
      }
      // At most six distinct targets. Avoid stable_sort's temporary allocation in every betting state.
      for(int j=1;j<na;j++){const double v=amounts[j];int i=j;while(i&&amounts[i-1]>v){amounts[i]=amounts[i-1];--i;}amounts[i]=v;}
      for (int j = 0; j < na; j++) s.to[k++] = amounts[j];
    }
    s.k = k;
  }
  void root(BS &s) const {
    double z[8] = {}, a[8]; bool live[8];
    for (int p = 0; p < 8; p++) { a[p] = -1; live[p] = true; }
    build(s, rootLength, z, posted, live, a, pre ? 1 : 0, 1, 0, -1);
  }
  void advance(const BS &t, int a, BS &out) const {
    bool live[8]; double put[8], acted[8];
    for (int p = 0; p < n; p++) { live[p] = t.live[p]; put[p] = t.put[p]; acted[p] = t.acted[p]; }
    const int p = t.actor; const double to = t.to[a];
    if (t.facing && a == 0) live[p] = false;
    put[p] = to; acted[p] = to;
    const bool increase = to > t.price + EPS;
    build(out, t.length, t.previous, put, live, acted, increase ? to : t.price,
          increase ? std::max(t.full, to - t.price) : t.full, t.count + (increase ? 1 : 0), p);
  }
  void nextStreet(const BS &t, BS &out) const {
    const int first = pre ? (n == 2 ? 1 : n - 2) : 0;
    double z[8] = {}, a[8]; for (int p = 0; p < 8; p++) a[p] = -1;
    build(out, t.length == 0 ? 3 : t.length + 1, t.total, z, t.live, a, 0, 1, 0, first - 1);
  }
  // EM.potLayers(prior + total (+ own ante preflop) ++ folded, live ++ false, common)
  int pots(const BS &t, LPot *out) const {
    double committed[16]; bool live[16]; int m = n;
    for (int p = 0; p < n; p++) { committed[p] = prior[p] + t.total[p] + (pre ? ownAnte[p] : 0); live[p] = t.live[p]; }
    for (double f : folded) { committed[m] = f; live[m++] = false; }
    int active[16], na = 0; for (int i = 0; i < m; i++) if (live[i]) active[na++] = i;
    int np = 0;
    auto add = [&](double amount, const int *e, int c) {
      if (amount <= EPS) return;
      if (np && out[np - 1].count == c && std::equal(e, e + c, out[np - 1].seat)) { out[np - 1].amount += amount; return; }
      uint32_t mask = 0; for (int j = 0; j < c; j++) if (e[j] < n) mask |= 1u << e[j];
      out[np].amount = amount; out[np].count = c; out[np].mask = mask; std::copy_n(e, c, out[np].seat); np++;
    };
    add(common, active, na);
    if(m==n && na && std::all_of(committed+1,committed+m,[&](double x){return x==committed[0];})){
      if(committed[0]>EPS)add(committed[0]*m,active,na);
      return np;
    }
    double levels[16]; std::copy_n(committed, m, levels);
    std::sort(levels, levels + m); int nl = (int)(std::unique(levels, levels + m) - levels);
    double last = 0;
    for (int l = 0; l < nl; l++) {
      const double level = levels[l];
      if (level <= last + EPS) continue;
      int paid[16], np2 = 0, elig[16], ne = 0;
      for (int i = 0; i < m; i++) if (committed[i] >= level - EPS) { paid[np2++] = i; if (live[i]) elig[ne++] = i; }
      if (np2 == 1) add((level - last) * np2, paid, np2);
      else if (!ne) {
        double top = -INFINITY; for (int j = 0; j < na; j++) top = std::max(top, committed[active[j]]);
        int w[16], nw = 0; for (int j = 0; j < na; j++) if (committed[active[j]] >= top - EPS) w[nw++] = active[j];
        add((level - last) * np2, w, nw);
      } else add((level - last) * np2, elig, ne);
      last = level;
    }
    return np;
  }
};

// Card code of the public cards visible at a street: sorted flop combination
// index, then turn and river (+1, 0 none). Fits in 26 bits.
// 5.7: the flop is ordered by a three-element network and the binomials are written out (as codes() in
// mw_es_impl.hpp has done for training since 5.6). The evaluators call this for every strategy lookup; std::sort and
// the loops were about a tenth of the instructions of a sampled evaluation. cardsCodeReference() is the 5.6
// function, kept for the exhaustive comparison in mwcli --selftest57 (every flop in every order, every street).
inline uint32_t cardsCodeReference(const int *cards, int length) {
  if (length < 3) return 0;
  int f[3] = {cards[0], cards[1], cards[2]}; std::sort(f, f + 3);
  auto c = [](int x, int r) { long v = 1; for (int i = 0; i < r; i++) v = v * (x - i) / (i + 1); return x < r ? 0L : v; };
  uint32_t flop = (uint32_t)(c(f[0], 1) + c(f[1], 2) + c(f[2], 3));
  return (flop * 53 + (length > 3 ? cards[3] + 1 : 0)) * 53 + (length > 4 ? cards[4] + 1 : 0);
}
inline uint32_t cardsCode(const int *cards, int length) {
  if (length < 3) return 0;
  long a = cards[0], b = cards[1], c = cards[2];
  if (a > b) std::swap(a, b);
  if (b > c) std::swap(b, c);
  if (a > b) std::swap(a, b);
  const uint32_t flop = (uint32_t)(a + b * (b - 1) / 2 + c * (c - 1) / 2 * (c - 2) / 3);
  return (flop * 53 + (length > 3 ? cards[3] + 1 : 0)) * 53 + (length > 4 ? cards[4] + 1 : 0);
}
inline uint64_t rowKey(uint32_t state, int hand, uint32_t code) { return ((uint64_t)state << 37) | ((uint64_t)hand << 26) | code; }
inline uint32_t deriveSeed(uint32_t base, long long iteration, int deal) {
  return base ^ (uint32_t)((uint32_t)(iteration + 1) * 0x9e3779b1u) ^ (uint32_t)((uint32_t)(deal + 1) * 0x85ebca6bu);
}

// Visited betting states: (parent, action slot) -> identifier. Read-only during
// traversal; extended only while increments are merged.
struct StateTable {
  std::pmr::vector<uint32_t> parent;
  std::pmr::vector<uint8_t> slot, kind, actor, length, k;
  std::pmr::vector<uint64_t> keys;
  std::pmr::vector<int32_t> ids;
  size_t count=0;
  explicit StateTable(std::pmr::memory_resource *r):parent(r),slot(r),kind(r),actor(r),length(r),k(r),keys(r),ids(r){}
  static uint64_t mix(uint64_t x) { x ^= x >> 33; x *= 0xff51afd7ed558ccdULL; x ^= x >> 33; x *= 0xc4ceb9fe1a85ec53ULL; x ^= x >> 33; return x; }
  int find(uint32_t par, int s) const {
    if (keys.empty()) return -1;
    const uint64_t key = ((uint64_t)par << 3 | (uint64_t)s) + 1; size_t mask = keys.size() - 1, i = mix(key) & mask;
    while (keys[i]) { if (keys[i] == key) return ids[i]; i = (i + 1) & mask; }
    return -1;
  }
  static constexpr double bytesPerState = 9 + 2 * 12.0;
  // Returns false if a new table would exceed the remaining byte budget.
  bool grow(double &bytes, double budget) {
    size_t cap = keys.empty() ? 4096 : keys.size() * 2;
    double extra = (double)(cap - keys.size()) * 12;
    if (bytes + extra > budget) return false;
    std::pmr::vector<uint64_t> k2(cap, 0, keys.get_allocator()); std::pmr::vector<int32_t> i2(cap, -1, ids.get_allocator());
    for (size_t i = 0; i < keys.size(); i++) if (keys[i]) { size_t j = mix(keys[i]) & (cap - 1); while (k2[j]) j = (j + 1) & (cap - 1); k2[j] = keys[i]; i2[j] = ids[i]; }
    keys.swap(k2); ids.swap(i2); bytes += extra; return true;
  }
  int add(uint32_t par, int s, int kd, int ac, int len, int kk, double &bytes, double budget) {
    if ((count + 1) * 2 > keys.size() && !grow(bytes, budget)) return -1;
    if (bytes + 9 > budget || parent.size() >= (1u << 27)) return -1;
    const int id = (int)parent.size();
    parent.push_back(par); slot.push_back((uint8_t)s); kind.push_back((uint8_t)kd); actor.push_back((uint8_t)std::max(0, ac));
    length.push_back((uint8_t)len); k.push_back((uint8_t)kk); bytes += 9;
    if (par != 0xffffffffu) {
      const uint64_t key = ((uint64_t)par << 3 | (uint64_t)s) + 1; size_t mask = keys.size() - 1, i = mix(key) & mask;
      while (keys[i]) i = (i + 1) & mask;
      keys[i] = key; ids[i] = id; count++;
    }
    return id;
  }
};

// Persistent worker threads for one training call.
//
// 5.7: the workers stay runnable between the parallel stages of consecutive updates. Through 5.6 every frozen
// batch woke its helpers through a condition variable and put them back to sleep when the batch was done. One
// batch of 64 deals is 100 to 1500 microseconds of traversal; waking a sleeping thread costs tens of microseconds
// (more inside a virtual machine), so on most games several threads were no faster, and often slower, than one.
// A helper now polls an atomic ticket for a bounded time (spinSeconds) after its last piece of work and only then
// blocks; the caller wakes sleeping helpers only when it needs them, and waits for the helpers the same way.
// The pool only schedules: which thread runs which deal never changes a computed number (see train()).
class Workers {
  struct alignas(64) Slot { std::atomic<bool> asleep{false}; };
  std::vector<std::thread> threads; std::unique_ptr<Slot[]> slots; std::mutex mu; std::condition_variable go, done;
  const std::function<void(int)> *task = nullptr;
  alignas(64) std::atomic<uint64_t> ticket{0};      // (generation << 16) | helpers-and-caller that take part in it
  alignas(64) std::atomic<int> pending{0};          // helpers that have not finished the current generation
  std::atomic<bool> quit{false}, callerWaits{false};
  uint64_t generation = 0;
  static void relax() {
#if defined(__x86_64__) || defined(__i386__)
    __builtin_ia32_pause();
#else
    std::this_thread::yield();
#endif
  }
  static double clock() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
  void loop(int i) {
    uint64_t seen = 0; double idleSince = clock(); unsigned spins = 0;
    for (;;) {
      uint64_t t = ticket.load(std::memory_order_acquire);
      if (quit.load(std::memory_order_acquire)) return;
      if (t == seen || (int)(t & 0xffff) <= i) {     // nothing new, or a generation this helper takes no part in
        seen = t;
        if ((++spins & 127) || clock() - idleSince < spinSeconds) { relax(); continue; }
        std::unique_lock<std::mutex> l(mu);
        slots[i].asleep.store(true);
        go.wait(l, [&] { const uint64_t now = ticket.load(); return quit.load() || (now != seen && (int)(now & 0xffff) > i); });
        slots[i].asleep.store(false);
        parks.fetch_add(1, std::memory_order_relaxed);
        continue;
      }
      seen = t;
      (*task)(i);
      if (pending.fetch_sub(1) == 1 && callerWaits.load()) { std::lock_guard<std::mutex> l(mu); done.notify_one(); }
      idleSince = clock(); spins = 0;
    }
  }
public:
  int size = 1; double spinSeconds = 200e-6; long long dispatches = 0; std::atomic<long long> parks{0};
  explicit Workers(int t) : size(std::max(1, std::min(t, 0xffff))) {
    if (size > 1) slots.reset(new Slot[(size_t)size]);
    try { for (int i = 1; i < size; i++) threads.emplace_back([this, i] { loop(i); }); } catch (...) {
      { std::lock_guard<std::mutex> lock(mu); quit.store(true); }
      go.notify_all(); for(auto &worker:threads)worker.join(); throw;
    }
  }
  // Runs f(0) on the caller and f(1) .. f(use - 1) on helpers; returns when all of them have returned.
  void run(const std::function<void(int)> &f, int use) {
    use = std::max(1, std::min(use, size));
    if (use == 1) { f(0); return; }
    task = &f; pending.store(use - 1); dispatches++;
    ticket.store((++generation << 16) | (uint64_t)use);
    bool wake = false; for (int i = 1; i < use && !wake; i++) wake = slots[i].asleep.load();
    if (wake) { { std::lock_guard<std::mutex> l(mu); } go.notify_all(); }
    std::exception_ptr failure;
    try { f(0); } catch (...) { failure = std::current_exception(); }   // helpers still hold references into the caller's frame
    const double start = clock(); unsigned spins = 0;
    while (pending.load(std::memory_order_acquire) != 0) {
      if ((++spins & 127) || clock() - start < 10 * spinSeconds) { relax(); continue; }
      std::unique_lock<std::mutex> l(mu);
      callerWaits.store(true);
      done.wait(l, [&] { return pending.load() == 0; });
      callerWaits.store(false);
    }
    if (failure) std::rethrow_exception(failure);
  }
  void run(const std::function<void(int)> &f, bool parallel) { run(f, parallel ? size : 1); }
  ~Workers() { { std::lock_guard<std::mutex> l(mu); quit.store(true); } go.notify_all(); for (auto &t : threads) t.join(); }
};

// 5.7: how many of the available threads the parallel stages of an update use. The answer never changes a result
// (states are identical for every thread count), so it is chosen from measurements of the running workload:
// seconds per state visit of whole updates, for the counts T, T/2, T/4 .. 1 on first use and for the current choice
// and its two neighbours afterwards, re-measured after 256, 512 .. 4096 updates. A count must be 3% faster than the
// current choice to replace it. The tuner belongs to the engine object and is not part of any saved state.
struct ThreadTuner {
  int ladder[20] = {}, nl = 0, top = 0;         // candidate counts, descending; `top` = thread count they were built for
  int best = -1;                                // index into ladder; -1 before the first calibration
  int trial[3] = {}, nt = 0, at = 0; bool calibrating = false;
  double seconds = 0, rate[3] = {}; long long visits = 0, updates = 0, hold = 0, period = 256, calibrations = 0;
  long long used[20] = {};                      // updates run with each ladder entry
  int cur = 0;
  int choose(int T) {
    if (T <= 1) return 1;
    if (top != T) { nl = 0; for (int c = T; ; c = (c + 1) / 2) { ladder[nl++] = c; if (c == 1 || nl == 20) break; } top = T; best = -1; calibrating = false; hold = 0; period = 256; }
    if (!calibrating && hold > 0) { hold--; cur = best; return ladder[best]; }
    if (!calibrating) {
      nt = 0;
      if (best < 0) { for (int i = 0; i < nl && nt < 3; i++) trial[nt++] = i; }   // first use: the top of the ladder; lower counts follow as neighbours
      else { trial[nt++] = best; if (best > 0) trial[nt++] = best - 1; if (best + 1 < nl) trial[nt++] = best + 1; }
      calibrating = true; at = 0; seconds = 0; visits = 0; updates = 0; calibrations++;
    }
    cur = trial[at]; return ladder[cur];
  }
  void record(double sec, long long vis) {
    if (top <= 1) return;
    used[cur]++;
    if (!calibrating) return;
    seconds += sec; visits += vis; updates++;
    if (updates < 4 || seconds < 1e-3) return;
    rate[at] = visits > 0 ? seconds / (double)visits : 1e300;
    seconds = 0; visits = 0; updates = 0;
    if (++at < nt) return;
    int win = 0;
    if (best < 0) { for (int i = 1; i < nt; i++) if (rate[i] < rate[win]) win = i; }
    else for (int i = 1; i < nt; i++) if (rate[i] < 0.97 * rate[0] && rate[i] < rate[win]) win = i;   // trial[0] is the current choice
    const bool moved = best < 0 || trial[win] != best;
    best = trial[win]; calibrating = false;
    // While the choice keeps moving along the ladder, look again soon; once it holds, look less and less often.
    if (moved && nt > 1) { period = 256; hold = 32; } else { hold = period; period = std::min<long long>(period * 2, 4096); }
  }
  int selected() const { return best >= 0 ? ladder[best] : 0; }
};
// 5.7: whether one of the short stages of a frozen-batch update (preparing the deals, merging the increments) is
// spread over the threads of the update or run on the calling thread. Handing a stage of a few microseconds to other
// cores costs more than it saves (the deals' buffers have to travel between the cores' caches), and a stage of a
// hundred microseconds gains. Like ThreadTuner this is decided from measurements of the running workload (seconds
// per unit of work with the stage spread and not spread; re-measured after 256, 512 .. 4096 updates) and never
// changes a result.
struct StageSwitch {
  bool spread = false; int phase = 0;           // phase 0: holding; 1: measuring spread; 2: measuring serial
  double seconds = 0, work = 0, rate[2] = {}; long long updates = 0, hold = 0, period = 256, spreadUpdates = 0, serialUpdates = 0;
  bool choose() {
    if (phase == 0) { if (hold > 0) { hold--; return spread; } phase = 1; seconds = 0; work = 0; updates = 0; }
    return phase == 1;
  }
  void record(bool wasSpread, double sec, double units) {
    (wasSpread ? spreadUpdates : serialUpdates)++;
    if (phase == 0) return;
    seconds += sec; work += units; updates++;
    if (updates < 4 || seconds < 2e-4) return;
    rate[phase - 1] = work > 0 ? seconds / work : 1e300; seconds = 0; work = 0; updates = 0;
    if (phase == 1) { phase = 2; return; }
    const bool was = spread;
    spread = spread ? rate[0] < 1.03 * rate[1] : rate[0] < 0.97 * rate[1];   // 3% in favour of the current choice
    phase = 0;
    if (spread != was) { period = 256; hold = 64; } else { hold = period; period = std::min<long long>(period * 2, 4096); }
  }
};
// 5.7: the deals of one update for the threads of one parallel stage. Each thread first takes the deals of its own
// contiguous share, so the same thread works on the same deals (and their buffers stay in that core's cache) from
// update to update; a thread that has finished its share takes deals that other threads have not started yet. Every
// deal is handed out exactly once. Which thread handles a deal never changes a result.
struct DealQueue {
  struct alignas(64) Share { std::atomic<int> next{0}; int end = 0; };
  std::unique_ptr<Share[]> shares; int parts = 1, cap = 0;
  explicit DealQueue(int threads) : shares(new Share[(size_t)std::max(1, threads)]), cap(std::max(1, threads)) {}
  void reset(int deals, int threads) {
    parts = std::max(1, std::min(threads, cap));
    for (int t = 0; t < parts; t++) { shares[t].next.store((int)((long long)deals * t / parts), std::memory_order_relaxed); shares[t].end = (int)((long long)deals * (t + 1) / parts); }
  }
  // The next deal for thread `index`, or -1 when none is left.
  int take(int index) {
    for (int i = 0; i < parts; i++) {
      Share &s = shares[(index + i) % parts];
      if (s.next.load(std::memory_order_relaxed) >= s.end) continue;
      const int d = s.next.fetch_add(1, std::memory_order_relaxed);
      if (d < s.end) return d;
    }
    return -1;
  }
};

struct Pending { int parentRef; int slot; uint8_t kind, actor, length, k; };
// 5.6: `row` is the table row found while the strategy was read during traversal (-1: no row yet). Rows are only
// appended while a training call runs, so the index stays valid until the increment is merged and the merge does
// not repeat the hash lookup. hand < 2048 (11 bits of the row key) and k <= 8, so the record keeps its 24 bytes
// and the transient-memory accounting of a deal is unchanged.
struct Inc { int ref; uint32_t code; size_t off; int32_t row; uint16_t hand; uint8_t k; };
static_assert(sizeof(Inc) == 24, "Inc must keep its 5.5 size: Unit::room() accounting depends on it");
struct CPot { double amount; uint32_t mask; };
// 5.6: a terminal betting state reached by one action from a stored state, with its pot layout (see Game::links).
constexpr int MAX_CACHED_POTS = 12;
struct TermRec { BS state; int np; CPot pot[MAX_CACHED_POTS]; };
struct Link { int32_t kid[8]; };   // per action slot (7: next street): >= 0 stored child id, -1 unknown, <= -2 terminal record -(kid + 2)
// Output of one deal (or one seat of one deal): new states, increments.
struct Unit {
  World w{}; uint32_t code[6] = {};
  uint32_t gk[6][8] = {};   // 3.3 grouped key ids per street length and seat
  std::pmr::vector<Pending> pending; std::pmr::vector<Inc> incs; std::pmr::vector<double> vals;
  explicit Unit(ScratchBudget &budget):pending(&budget),incs(&budget),vals(&budget){}
  long long visits = 0; bool overflow = false;
  // Upper bound geometric vector growth, old storage during reallocation,
  // and the temporary pending-to-canonical state map needed by the merger.
  bool room(size_t np, size_t ni, size_t nv, size_t limit) const {
    auto growth=[](const auto &v, size_t append) {
      return append+v.size() <= v.capacity() ? v.capacity() :
        v.capacity()+std::max(2*v.capacity(),v.size()+append);
    };
    return growth(pending,np)*(sizeof(Pending)+sizeof(int)) +
      growth(incs,ni)*sizeof(Inc) + growth(vals,nv)*sizeof(double) <= limit;
  }
  void clear() { pending.clear(); incs.clear(); vals.clear(); visits = 0; overflow = false; }
};
struct Game {
  Rules rules;
  StateTable states;
  explicit Game(std::pmr::memory_resource *resource):states(resource){}
  BS rootState{};
  Rng actionRng{0};
  uint32_t actionSeed = 0;
  double exploreKeep = 0.9, exploreMix = 0.1;   // opponent sampling q = keep * sigma + mix / k (4.5: configurable for experiments)
  bool perDealStreams = false, terminalExpectation = false, terminalBaseline = false;
  // 5.5 (experimental, opt-in: spec "opponentEnumeration":"river"). At an opponent's decision on the FINAL street
  // (street length 5) every action is traversed and the child values are combined with the opponent's current
  // strategy, instead of sampling one action and reweighting it by sigma/q. This replaces a one-sample estimate of
  // sum_a sigma(a) v(a) by the sum itself (Rao-Blackwellisation over the opponent's river actions): the expected
  // regret and average-strategy increments are those of the default estimator, their variance is lower, and each
  // deal visits the whole river betting tree. See mw_es_impl.hpp Walker::learn. 0 = off.
  int enumerateFrom = 0;
  // 5.6 (experimental, opt-in; both require enumerateFrom). How the fully enumerated final-street subgame is used:
  //   0  "river"         5.5: one traversal per updating seat; only that seat's information sets are updated.
  //   1  "river-shared"  when the whole game is on the final street (nothing is sampled after the deal), ONE traversal
  //                      per deal computes every seat's counterfactual values and updates every seat (5.5 walked the
  //                      same tree once per seat). Per-seat increments are those of "river" for the same table; the
  //                      seats are updated simultaneously instead of in turn. Games that start earlier: as "river".
  //   2  "river-cross"   as 1, and in games that start earlier each seat's traversal also updates the OTHER seats'
  //                      final-street information sets, importance-weighted by the probability with which the
  //                      traversal reached them; each of the n traversals contributes weight 1/n, so the expected
  //                      increments are unchanged. See Walker::learnAll.
  int enumShare = 0;
  bool wholeGameEnumerated() const { return enumShare && enumerateFrom && rootState.length >= enumerateFrom; }
  // 5.8 (trained response, response58.hpp): when >= 0 only this seat's information sets are updated; every other
  // seat is traversed as an opponent whose strategy never changes. -1 (always, outside a response training): every
  // seat is updated in turn, exactly as before.
  int onlySeat = -1;
  // 4.7 (experimental, opt-in: spec "ownHandEnumeration":true). The updating seat's private hand is
  // enumerated over every hand of its range compatible with the sampled opponents' hands and board,
  // with conditional chance weight w(h) / sum w (Rao-Blackwellisation of the hand that external
  // sampling would otherwise sample). The expected increments equal those of the default estimator;
  // only their variance (and the cost per deal) changes. See mw_es_impl.hpp Walker::runVec.
  bool ownHands = false;
  // 5.10 (experimental, opt-in: spec "estimator":"rbes"): Rao-Blackwellised external sampling. One traversal per
  // (deal, updating seat) carries every hand of the seat's range that is compatible with the sampled opponents'
  // hands and board (rule R1), and an opponent's terminal children are taken in expectation instead of sampled
  // (rule R2; rbTerminals = false keeps the default's sampling of every action, for comparisons). See
  // es_rbes510.hpp and es_rbes510_walk.hpp. The key cache and the counters are not part of any saved state.
  bool rbes = false, rbTerminals = true, rbReference = false;
  RbKeyMemo rbMemo;
  struct RbStats { long long seatWalks = 0, hands = 0, rows = 0, exactTerminals = 0, sampled = 0, unsampled = 0; } rbStats;
  static const char *rbesId(bool terminals) { return terminals ? "rbes-5.10-v1" : "rbes-5.10-v1-sampled-terminals"; }
  double secTraverse = 0, secMerge = 0, secDeal = 0, secScore = 0, secProfiled = 0;   // 3.3: scoring time and total time of profiled updates (1 in 16)
  // 5.7: the stages of frozen-batch updates (see train()). deal = sampling the deals in order (serial); prepare =
  // scores, card codes and hand-group lookups (parallel); fixup = hand groups that had to be interned in deal order
  // (serial); traverse (parallel); resolve = new betting states and table rows in deal order (serial); accumulate and
  // apply = the row-partitioned merge (parallel). secDeal and secMerge remain the sums they were in 5.6.
  struct BatchStages { double deal = 0, prepare = 0, fixup = 0, traverse = 0, resolve = 0, accumulate = 0, apply = 0;
    long long updates = 0, threadUpdates = 0, fixedDeals = 0, dispatches = 0, parks = 0; } stages;
  ThreadTuner tuner; StageSwitch prepareSwitch, mergeSwitch;
  std::atomic<size_t> scratchPeak{0};
  long long attempts = 0;
  bool dcfr = false, dcfrEager = false; Dcfr schedule;
  GroupKeys groups; std::vector<std::vector<uint32_t>> startKey;   // 3.3 native Compact/Detailed groups   // 3.3 external-sampling DCFR (eager: validation reference)
  size_t unitLimitBytes = 64u << 20;   // transient increments of one deal
  // 3.8: betting state of every committed state id (up to a cap), built once
  // in deal order while increments are merged (single-threaded) and read-only
  // while workers traverse. A BS depends only on its action path, so stored
  // entries equal what Rules::advance/nextStreet rebuilt on every visit in 3.7.
  // The store has its own allowance (1/32 of the table budget, at most
  // EM_STATE_STORE_MIB, default 16 MiB)
  // and is NOT charged to the table budget, so when a study reaches its table
  // limit is unchanged. It is reported as stateCacheMiB and rebuilt after a
  // restore; a rolled-back update truncates it with the state table.
  std::vector<BS> store; size_t storeCap = 0;
  // 5.6: child links of the stored states. 5.5 looked every child up in the state hash on every visit and rebuilt
  // every terminal child (terminal states have no identifier) through the per-worker edge cache, copying a
  // 440-byte betting state and recomputing or re-reading its pot layout. links[id].kid[a] names the stored child
  // directly; terminal children are built once, here, by the same Rules::advance/nextStreet and Rules::pots calls
  // the traversal would make, so every value read during traversal is identical. Like the store, the links are
  // written only between updates (single-threaded) and are read-only while workers traverse. Terminal records
  // have their own allowance equal to the store's and are not charged to the table budget (reported as
  // linkCache). When an allocation fails the links are dropped and traversal uses the 5.5 path.
  std::vector<Link> links; std::vector<TermRec> terms; size_t termCap = 0; bool linksOff = false;
  void clearStore() { store.clear(); links.clear(); terms.clear(); }
  void linkTerminal(size_t id, int slot, const BS &c) {
    if (c.kind != 2 || terms.size() >= termCap) return;
    LPot pots[24]; const int np = rules.pots(c, pots);
    if (np > MAX_CACHED_POTS) return;
    TermRec r; r.state = c; r.np = np; for (int q = 0; q < np; q++) r.pot[q] = {pots[q].amount, pots[q].mask};
    terms.push_back(r); links[id].kid[slot] = -(int32_t)terms.size() - 1;   // record index terms.size()-1 -> -(index + 2)
  }
  void linkState(size_t id) {
    if (linksOff) return;
    try {
      Link l; std::fill_n(l.kid, 8, -1); links.push_back(l);
      if (id) { const uint32_t par = states.parent[id]; if (par < links.size()) links[par].kid[states.slot[id]] = (int32_t)id; }
      const BS s = store[id]; BS c;
      if (s.kind == 0) for (int a = 0; a < s.k; a++) { rules.advance(s, a, c); linkTerminal(id, a, c); }
      else if (s.kind == 1) { rules.nextStreet(s, c); linkTerminal(id, CHANCE_SLOT, c); }
    } catch (const std::bad_alloc &) { linksOff = true; links.clear(); links.shrink_to_fit(); terms.clear(); terms.shrink_to_fit(); }
  }
  double linkBytes() const { return links.capacity() * (double)sizeof(Link) + terms.capacity() * (double)sizeof(TermRec); }
  // Ids are assigned in first-visit order, so a prefix holds the most revisited
  // top of the tree. Storing every state cost 2.8x the table in RAM on the
  // eight-player linked benchmark and ran slower (random DRAM reads of mostly
  // once-visited states); a small prefix keeps the gain on hot states.
  static size_t storeBytesFor(double budgetBytes) { return (size_t)std::min(budgetBytes / 32, (double)EM_STATE_STORE_MIB * 1048576); }
  void setStoreCap(double budgetBytes) { storeCap = storeBytesFor(budgetBytes) / sizeof(BS); termCap = storeBytesFor(budgetBytes) / sizeof(TermRec); }
  // Enabled once states are revisited (state visits >= 16 x states): while most
  // states are new, building and faulting in their stored copies cost more
  // wall time than the rebuilds they saved (validation/3.8/native-timing.json).
  void extendStore(long long stateVisits) {
    if (store.size() > states.parent.size() || links.size() > store.size()) clearStore();   // defensive: tables replaced
    if (store.empty() && (double)stateVisits < 16.0 * (double)states.parent.size()) return;
    const size_t want = std::min(states.parent.size(), storeCap);
    if (store.size() >= want) return;
    try { if (store.capacity() < want) store.reserve(std::min(storeCap, std::max(want + want / 2, store.capacity() * 2))); } catch (const std::bad_alloc &) { storeCap = store.size(); return; }
    while (store.size() < want) {
      const size_t id = store.size();
      if (id == 0) { store.push_back(rootState); linkState(id); continue; }
      const uint32_t par = states.parent[id]; const int slot = states.slot[id];
      BS c; if (slot == CHANCE_SLOT) rules.nextStreet(store[par], c); else rules.advance(store[par], slot, c);
      store.push_back(c); linkState(id);
    }
  }
  double storeMiB() const { return store.capacity() * (double)sizeof(BS) / 1048576.0; }
};
// 5.10: a saved state names the training algorithm when it is not the default one ("estimator" in the EMMW4 header;
// default states have no such field and keep their 5.9 bytes). A state continues only under the algorithm that
// trained it. Returns the refusal, or nullptr when the header's algorithm is the engine's.
inline const char *estimatorMismatch(const Game &g, const char *inHeader) {
  const char *mine = g.rbes ? Game::rbesId(g.rbTerminals) : nullptr;
  if (!inHeader && !mine) return nullptr;
  if (inHeader && mine && !std::strcmp(inHeader, mine)) return nullptr;
  if (inHeader && !mine) return "State was trained by an experimental training algorithm (see its \"estimator\" header field) and cannot be continued by the default trainer; open it with the same \"estimator\" setting";
  if (!inHeader) return "State was trained by the default trainer and cannot be continued by the experimental estimator (rbes); start a new training or remove the \"estimator\" setting";
  return "State was trained by a different version of the experimental estimator and cannot be continued by this one";
}
// 5.11: the same rule for the training streams. A state of the counter-based streams names them and its seed in the
// header ("trainingStreams", "trainingSeed") and has no "rng"/"actionRng"; a state of the 5.10 streams has the 5.10
// header. Returns the refusal, or nullptr when the header's streams are the engine's.
inline const char *streamsMismatch(bool wide, const char *seed, const char *inHeader, const char *seedInHeader, bool generatorState) {
  if (!wide) return inHeader ? "State was trained with the counter-based training streams (see its \"trainingStreams\" header field) and cannot be continued with the 5.10 streams; open it with \"trainingStreams\":\"philox64\" and its seed" : nullptr;
  if (!inHeader) return "State was trained with the 5.10 training streams and cannot be continued with the counter-based streams; open it without \"trainingStreams\" (it then continues under the rules and the 10,000,000-update limit that made it)";
  if (std::strcmp(inHeader, em511::ALGORITHM)) return "State was trained with a different version of the counter-based training streams and cannot be continued by this one";
  if (generatorState) return "State header names the counter-based training streams and carries a 32-bit generator state; it was not written by this program";
  if (!seedInHeader || std::strcmp(seedInHeader, seed)) return "State was trained with a different training seed; its streams are a function of the seed, so it continues only under the seed that trained it";
  return nullptr;
}
// The study identifier of states trained by an experimental algorithm: a 64-bit mix of the spec's identifier and the
// FNV-1a hash of the algorithm identifier, as 16 hexadecimal digits. An earlier program version, which knows nothing
// of the "estimator" field, compares study identifiers and therefore refuses such a state too.
inline std::string rbStudyId(const std::string &base, const char *algorithm) {
  uint64_t x = 0; for (char c : base) x = x * 16 + (uint64_t)(c <= '9' ? c - '0' : c - 'a' + 10);
  uint64_t f = 1469598103934665603ULL; for (const char *p = algorithm; *p; p++) { f ^= (unsigned char)*p; f *= 1099511628211ULL; }
  const uint64_t y = StateTable::mix(x ^ f);
  char out[17]; snprintf(out, sizeof out, "%016llx", (unsigned long long)y); return out;
}
} // namespace es
} // namespace
