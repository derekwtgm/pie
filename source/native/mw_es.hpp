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
struct BS {
  int length = 0, kind = 0, actor = -1, k = 0, count = 0;   // kind 0 player, 1 chance, 2 terminal
  bool facing = false;
  double price = 0, full = 1, pot = 0;
  bool live[8];
  double previous[8], put[8], acted[8], total[8], behind[8], to[8];
};
struct LPot { double amount; int count; int seat[16]; };
// 3.3: discounted CFR schedule for external sampling (see EM.dcfrSchedule in
// lib_wide.js, which performs the same operations). Prefix products
// P_t = prod_{u<=t} u^x/(u^x+1) are kept as a mantissa in [0.5,1) and a binary
// exponent; P_t/P_s is one division times an exact power of two, so beta = 0
// (factor 1/2 per iteration) never underflows. Rows store the iteration through
// which their regrets are discounted and catch up when next updated.
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
      out[np].amount = amount; out[np].count = c; std::copy_n(e, c, out[np].seat); np++;
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
inline uint32_t cardsCode(const int *cards, int length) {
  if (length < 3) return 0;
  int f[3] = {cards[0], cards[1], cards[2]}; std::sort(f, f + 3);
  auto c = [](int x, int r) { long v = 1; for (int i = 0; i < r; i++) v = v * (x - i) / (i + 1); return x < r ? 0L : v; };
  uint32_t flop = (uint32_t)(c(f[0], 1) + c(f[1], 2) + c(f[2], 3));
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
class Workers {
  std::vector<std::thread> threads; std::mutex mu; std::condition_variable go, done;
  std::function<void(int)> task; long long generation = 0; int finished = 0; bool quit = false;
public:
  int size = 1;
  explicit Workers(int t) : size(std::max(1, t)) {
    try { for (int i = 1; i < size; i++) threads.emplace_back([this, i] {
      long long seen = 0;
      for (;;) {
        const std::function<void(int)> *job;
        { std::unique_lock<std::mutex> l(mu); go.wait(l, [&] { return quit || generation != seen; }); if (quit) return; seen = generation; job = &task; }
        (*job)(i);
        { std::lock_guard<std::mutex> l(mu); if (++finished == size - 1) done.notify_one(); }
      }
    }); } catch (...) {
      { std::lock_guard<std::mutex> lock(mu); quit=true; }
      go.notify_all(); for(auto &worker:threads)worker.join(); throw;
    }
  }
  void run(const std::function<void(int)> &f, bool parallel) {
    if (!parallel || size == 1) { f(0); return; }
    { std::lock_guard<std::mutex> l(mu); task = f; finished = 0; generation++; }
    go.notify_all(); f(0);
    std::unique_lock<std::mutex> l(mu); done.wait(l, [&] { return finished == size - 1; });
  }
  ~Workers() { { std::lock_guard<std::mutex> l(mu); quit = true; } go.notify_all(); for (auto &t : threads) t.join(); }
};

struct Pending { int parentRef; int slot; uint8_t kind, actor, length, k; };
struct Inc { int ref; int hand; uint32_t code; int k; size_t off; };
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
  bool perDealStreams = false, terminalExpectation = false, terminalBaseline = false;
  double secTraverse = 0, secMerge = 0, secDeal = 0, secScore = 0, secProfiled = 0;   // 3.3: scoring time and total time of profiled updates (1 in 16)
  std::atomic<size_t> scratchPeak{0};
  long long attempts = 0;
  bool dcfr = false, dcfrEager = false; Dcfr schedule;
  GroupKeys groups; std::vector<std::vector<uint32_t>> startKey;   // 3.3 native Compact/Detailed groups   // 3.3 external-sampling DCFR (eager: validation reference)
  size_t unitLimitBytes = 64u << 20;   // transient increments of one deal
};
} // namespace es
} // namespace
