// Native multiway sampled-CFR engine. See mw.h and MW-PROTOCOL.md.
//
// Mirrors lib_wide.js (full betting traversal, simultaneous updates, exact-card
// information sets, chip-EV payoffs):
//   - randomStream()/dealer(): identical 32-bit generator, cumulative-weight
//     search and whole-tuple rejection, then fresh board cards;
//   - walk(): identical recursion and floating-point operation order, so the
//     regret and average increments are bit-identical (compile without fast-math
//     and with -ffp-contract=off);
//   - frozen batches: every deal of a batch reads the same committed policy; the
//     increments are added to a delta table in deal order (as JavaScript does),
//     divided by the batch size, and committed once.
// Threads: the deals of a batch are traversed concurrently (each into its own
// increment list, policy tables are read-only meanwhile) and merged in deal
// order, so results do not depend on the thread count. With one deal per update
// there is nothing to parallelize without changing the algorithm, and the engine
// runs those updates on one thread.
#include "mw.h"
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <string>
#include <vector>
#include <atomic>
#include <pthread.h>
#include <chrono>
#include <unordered_map>
#include <functional>
#include <climits>
#include <bit>
#include "icm.hpp"
#include "cuda_score.hpp"

namespace {

// ---------------- hand evaluation (port of lib_eval.js; same score encoding) ----------------
uint8_t POP[8192], STRAIGHT[8192];
struct EvalInit {
  EvalInit() {
    for (int m = 0; m < 8192; m++) {
      int p = 0, x = m; while (x) { x &= x - 1; p++; } POP[m] = (uint8_t)p;
      int st = 0;
      for (int hi = 12; hi >= 4; hi--) { int w = 0x1F << (hi - 4); if ((m & w) == w) { st = hi + 1; break; } }
      if (!st && (m & 0x100F) == 0x100F) st = 4;
      STRAIGHT[m] = (uint8_t)st;
    }
  }
} evalInit;
inline int topbits(int m, int n) { while (POP[m] > n) m &= m - 1; return m; }
int evalMasks(int s0, int s1, int s2, int s3) {
  int fl = 0;
  if (POP[s0] >= 5) fl = s0; else if (POP[s1] >= 5) fl = s1; else if (POP[s2] >= 5) fl = s2; else if (POP[s3] >= 5) fl = s3;
  if (fl) { int st = STRAIGHT[fl]; if (st) return (8 << 26) | st; return (5 << 26) | topbits(fl, 5); }
  int ranks = s0 | s1 | s2 | s3, quads = s0 & s1 & s2 & s3;
  if (quads) return (7 << 26) | (quads << 13) | topbits(ranks & ~quads, 1);
  int t3 = (s0 & s1 & s2) | (s0 & s1 & s3) | (s0 & s2 & s3) | (s1 & s2 & s3);
  int t2 = (s0 & s1) | (s0 & s2) | (s0 & s3) | (s1 & s2) | (s1 & s3) | (s2 & s3);
  int pairs = t2 & ~t3;
  if (t3) { int top = topbits(t3, 1); int rest = (t3 & ~top) | pairs; if (rest) return (6 << 26) | (top << 13) | topbits(rest, 1); }
  int st = STRAIGHT[ranks];
  if (st) return (4 << 26) | st;
  if (t3) return (3 << 26) | (t3 << 13) | topbits(ranks & ~t3, 2);
  int np = POP[pairs];
  if (np >= 2) { int tp = topbits(pairs, 2); return (2 << 26) | (tp << 13) | topbits(ranks & ~tp, 1); }
  if (np == 1) return (1 << 26) | (pairs << 13) | topbits(ranks & ~pairs, 3);
  return topbits(ranks, 5);
}
int evalSeven(const int *board, int a, int b) {
  int s[4] = {0, 0, 0, 0};
  for (int i = 0; i < 5; i++) s[board[i] & 3] |= 1 << (board[i] >> 2);
  s[a & 3] |= 1 << (a >> 2); s[b & 3] |= 1 << (b >> 2);
  return evalMasks(s[0], s[1], s[2], s[3]);
}

// ---------------- random stream (port of randomStream) ----------------
struct Rng {
  uint32_t state;
  double next() {
    state = state + 0x6d2b79f5u;
    uint32_t x = (state ^ (state >> 15)) * (state | 1u);
    x ^= x + (x ^ (x >> 7)) * (x | 61u);
    return (double)(x ^ (x >> 14)) / 4294967296.0;
  }
};

struct Hand { int id, a, b; double w, cum; int riverScore=0, strategyHand=0; };
struct Pot { double amount; std::vector<int> eligible; };
struct Node {
  int kind = 0;         // 0 player, 1 chance, 2 terminal
  int actor = -1, len = 0, k = 0;
  int child0 = 0;       // index into children
  int term = -1;        // terminal index
  long long rowBase = -1; // dense tables
};
struct Terminal { std::vector<double> total, behind; std::vector<Pot> pots; };

struct GroupedWorld { uint32_t ids[6][8]; };
struct World { int seat[8]; int cards[5]; int score[8]; const GroupedWorld *grouped=nullptr; };
struct IncRow { uint64_t key; int node, k; size_t off; };
struct DealWork {
  World w;
  int seat = -1;          // -1: update every seat (train === true); else only this seat
  double weight = 1;      // chance weight of this traversal (own-hand enumeration)
  int phase = 0;
  std::vector<IncRow> rows;
  std::vector<double> vals;   // per row: k regret increments then k average increments
  long long visits = 0;
};

struct Engine;
struct Scratch {
  Tournament::Workspace icm;
  std::vector<double> u, av, sig;   // per depth: n, kmax, kmax
  std::vector<double> reach;
};

} // namespace
#include "mw_es.hpp"

struct MW {
  std::atomic<size_t> tablePeak{0};
  ScratchBudget arena{SIZE_MAX,tablePeak};
  explicit MW(std::pmr::memory_resource *tableMemory=nullptr):
    vals(tableMemory?tableMemory:&arena),delta(vals.get_allocator()),rows(vals.get_allocator()),
    hkeys(vals.get_allocator()),hrow(vals.get_allocator()),touched(vals.get_allocator()) {}
  es::RestoreEstimate restoreEstimate;   // 3.8: set by a native restore
  // 3.9: bounded action-EV result cache (action_ev.hpp). Keys hold the full
  // request and the training counters; cleared by training and imports.
  std::unordered_map<std::string,std::string> evCache;
  std::shared_ptr<es::Game> es;   // protocol 4: native betting rules + external sampling
  Tournament tournament;
  std::string mode="cpu",studyId;
  std::string route="CPU scoring"; CudaInfo cuda;
  size_t gpuBudget=512ULL<<20,peakGpuBytes=0;
  size_t cpuScoreUnits=0;unsigned cpuScoreReuse=0,scoreCalibrations=0;
  double scoreCalibrationSeconds=0,cpuScoreProbeSeconds=0,bestDeviceScoreSeconds=0;
  int n = 0, startLen = 5, kmax = 1, maxDepth = 1;
  int board[5] = {0, 0, 0, 0, 0};
  es::GroupKeys fullGroups;
  std::vector<std::vector<uint32_t>> fullStart;
  std::vector<std::vector<int>> turnGroups;
  std::vector<std::vector<Hand>> hands;
  std::vector<double> total;         // per seat cumulative weight
  std::vector<double> anteOf;
  std::vector<std::array<int,8>> joint;
  std::vector<double> cumulative;
  void enumerateJoint(int seat,uint64_t used,double mass,std::array<int,8> &tuple){
    if(seat==n){joint.push_back(tuple);cumulative.push_back((cumulative.empty()?0:cumulative.back())+mass);return;}
    for(size_t i=0;i<hands[seat].size();++i){
      const auto &h=hands[seat][i];uint64_t mask=(1ULL<<h.a)|(1ULL<<h.b);
      if(!(used&mask)){tuple[seat]=(int)i;enumerateJoint(seat+1,used|mask,mass*h.w,tuple);}
    }
  }
  std::vector<Node> nodes;
  std::vector<int> children;
  std::vector<Terminal> terms;
  int batchDeals = 1; int updates = 0; /* 0 simultaneous, 1 alternating, 2 enumerate */ bool linear = true, plus = false, dcfr = false; double dA = 1.5, dB = 0, dG = 2;
  // state
  Rng rng{17};
  long long iterations = 0, trainingDeals = 0, stateVisits = 0;
  bool limitReached = false;
  // tables
  bool dense = true;
  std::pmr::vector<double> vals, delta;
  struct RowMeta { uint64_t key; int node; int k; size_t off; uint8_t visited, marked; uint32_t sync = 0; };   // sync: DCFR discount iteration (3.3)
  std::pmr::vector<RowMeta> rows;
  std::pmr::vector<int64_t> hkeys; std::pmr::vector<int32_t> hrow; size_t hcount = 0; // hash: key -> row
  std::pmr::vector<int32_t> touched;
  double budgetBytes = 0, bytes = 0, workBytesPerDeal=sizeof(DealWork);
  int lastThreads = 1;
  double secTraverse = 0, secMerge = 0, secDeal = 0;   // diagnostics

  // ---- tables ----
  static uint64_t mix(uint64_t x) { x ^= x >> 33; x *= 0xff51afd7ed558ccdULL; x ^= x >> 33; x *= 0xc4ceb9fe1a85ec53ULL; x ^= x >> 33; return x; }
  long long findRow(uint64_t key) const {
    if (dense) return (long long)key;
    if (hkeys.empty()) return -1;
    size_t mask = hkeys.size() - 1, i = mix(key) & mask;
    while (hkeys[i] != -1) { if ((uint64_t)hkeys[i] == key) return hrow[i]; i = (i + 1) & mask; }
    return -1;
  }
  bool grow() {
    size_t cap = hkeys.empty() ? 1024 : hkeys.size() * 2;
    double extra = (double)(cap - hkeys.size()) * 12;
    if (bytes + cap*12.0 > budgetBytes) return false;
    std::pmr::vector<int64_t> k2(cap, -1, hkeys.get_allocator()); std::pmr::vector<int32_t> r2(cap, -1, hrow.get_allocator());
    for (size_t i = 0; i < hkeys.size(); i++) if (hkeys[i] != -1) {
      size_t j = mix((uint64_t)hkeys[i]) & (cap - 1);
      while (k2[j] != -1) j = (j + 1) & (cap - 1);
      k2[j] = hkeys[i]; r2[j] = hrow[i];
    }
    hkeys.swap(k2); hrow.swap(r2); bytes += extra; return true;
  }
  // -1: budget exhausted
  long long getOrCreate(uint64_t key, int node, int k) {
    long long r = findRow(key);
    if (r >= 0 || dense) return r;
    if ((hcount + 1) * 2 > hkeys.size() && !grow()) return -1;
    double extra = 2.0 * k * 8 * (batchDeals > 1 ? 2 : 1) + sizeof(RowMeta);
    if (bytes + extra > budgetBytes) return -1;
    size_t off = vals.size();
    vals.resize(off + 2 * (size_t)k, 0.0);
    if (batchDeals > 1) delta.resize(off + 2 * (size_t)k, 0.0);
    rows.push_back({key, node, k, off, 0, 0, (uint32_t)iterations});
    size_t mask = hkeys.size() - 1, i = mix(key) & mask;
    while (hkeys[i] != -1) i = (i + 1) & mask;
    hkeys[i] = (int64_t)key; hrow[i] = (int32_t)(rows.size() - 1); hcount++; bytes += extra;
    return (long long)rows.size() - 1;
  }
  uint64_t keyOf(const World &w, int node, int seat) const {
    const Node &nd = nodes[node];
    if(fullGroups.on)return ((uint64_t)node<<32)|w.grouped->ids[nd.len][seat];
    int hand = hands[seat][w.seat[seat]].strategyHand;
    if (dense) return (uint64_t)(nd.rowBase + hand);
    if (!turnGroups.empty()) {
      int slot=nd.len==5?w.cards[4]+1:0;
      int rep=turnGroups[seat][slot*hands[seat].size()+w.seat[seat]];
      return ((uint64_t)node<<32) | ((uint64_t)(rep%2048)<<16) | ((uint64_t)(rep/2048)<<8);
    }
    if (!startLen) {
      uint64_t key=((uint64_t)node<<11)|w.seat[seat];
      for(int i=0;i<5;i++) key=(key<<6)|(i<nd.len?w.cards[i]+1:0);
      return key;
    }
    int e1 = nd.len > startLen ? w.cards[startLen] + 1 : 0, e2 = nd.len > startLen + 1 ? w.cards[startLen + 1] + 1 : 0;
    return ((uint64_t)node << 32) | ((uint64_t)hand << 16) | ((uint64_t)e1 << 8) | (uint64_t)e2;
  }

  // ---- deals ----
  bool deal(World &w,int stratum=0) {
    if(!joint.empty()){
      double x=(stratum+rng.next())*cumulative.back()/batchDeals;
      auto idx=std::min(joint.size()-1,(size_t)(std::upper_bound(cumulative.begin(),cumulative.end(),x)-cumulative.begin()));
      std::copy_n(joint[idx].begin(),n,w.seat);std::copy_n(board,5,w.cards);return true;
    }
    uint8_t used[52];
    for (int tries = 0; tries < 4096; tries++) {
      std::memset(used, 0, sizeof used);
      for (int i = 0; i < startLen; i++) used[board[i]] = 1;
      int got = 0;
      for (int p = 0; p < n; p++) {
        const std::vector<Hand> &hs = hands[p];
        double x = rng.next() * total[p];
        int lo = 0, hi = (int)hs.size() - 1;
        while (lo < hi) { int mid = (lo + hi) >> 1; if (x < hs[mid].cum) hi = mid; else lo = mid + 1; }
        const Hand &h = hs[lo];
        if (used[h.a] || used[h.b]) break;
        w.seat[p] = lo; used[h.a] = used[h.b] = 1; got++;
      }
      if (got != n) continue;
      for (int i = 0; i < startLen; i++) w.cards[i] = board[i];
      int len = startLen;
      while (len < 5) { int c = (int)std::floor(rng.next() * 52); if (!used[c]) { used[c] = 1; w.cards[len++] = c; } }
      if (!startLen) std::sort(w.cards,w.cards+3);

      return true;
    }
    return false;
  }

  void score(World &w) const { for (int p = 0; p < n; p++) { const Hand &h = hands[(size_t)p][(size_t)w.seat[p]]; w.score[p] = startLen==5 ? h.riverScore : evalSeven(w.cards, h.a, h.b); } }
  // ---- traversal (mirrors lib_wide.js walk with train === true or {seat, weight}) ----
  void policy(const World &w, int node, int seat, double *sig) const {
    const Node &nd = nodes[node]; int k = nd.k;
    long long r = findRow(keyOf(w, node, seat));
    double tot = 0;
    for (int a = 0; a < k; a++) { double v = r >= 0 ? vals[off(r) + a] : 0; sig[a] = v > 0 ? v : 0; tot += sig[a]; }
    for (int a = 0; a < k; a++) sig[a] = tot ? sig[a] / tot : 1.0 / k;
  }
  size_t off(long long r) const { return dense ? denseOff[(size_t)r] : rows[(size_t)r].off; }
  std::vector<size_t> denseOff;

  const double *walk(int node, int depth, const World &w, Scratch &s, DealWork &out, double step) const {
    out.visits++;
    const Node &nd = nodes[node];
    double *u = &s.u[(size_t)depth * n];
    if (nd.kind == 2) {
      const Terminal &t = terms[nd.term];
      for (int p = 0; p < n; p++) u[p] = t.behind.empty() ? -t.total[p] - anteOf[p] : t.behind[p];
      for (const Pot &pot : t.pots) {
        double top = -INFINITY; int count = 0;
        for (int p : pot.eligible) { double v = w.score[p]; if (v > top) { top = v; count = 1; } else if (v == top) count++; }
        for (int p : pot.eligible) if (w.score[p] == top) u[p] += pot.amount / count;
      }
      if (!t.behind.empty()) tournament.evaluate(u,n,s.icm);
      return u;
    }
    if (nd.kind == 1) return walk(children[nd.child0], depth + 1, w, s, out, step);
    int k = nd.k;
    if (k == 1) return walk(children[nd.child0], depth + 1, w, s, out, step);
    int p = nd.actor;
    double *sig = &s.sig[(size_t)depth * kmax], *av = &s.av[(size_t)depth * kmax];
    policy(w, node, p, sig);
    double old = s.reach[p];
    for (int j = 0; j < n; j++) u[j] = 0;
    for (int a = 0; a < k; a++) {
      s.reach[p] = old * sig[a];
      const double *v = walk(children[nd.child0 + a], depth + 1, w, s, out, step);
      av[a] = v[p];
      for (int j = 0; j < n; j++) u[j] += sig[a] * v[j];
    }
    s.reach[p] = old;
    if (out.seat >= 0 && out.seat != p) return u;
    double others = 1; for (int j = 0; j < n; j++) if (j != p) others *= s.reach[j];
    const double cw = out.weight;
    IncRow ir{keyOf(w, node, p), node, k, out.vals.size()};
    out.rows.push_back(ir);
    for (int a = 0; a < k; a++) out.vals.push_back(step * cw * others * (av[a] - u[p]));
    for (int a = 0; a < k; a++) out.vals.push_back(step * cw * old * sig[a]);
    return u;
  }
  void runDeal(DealWork &dw, Scratch &s, double step) const {
    dw.rows.clear(); dw.vals.clear(); dw.visits = 0;
    for (int p = 0; p < n; p++) s.reach[p] = 1;
    walk(0, 0, dw.w, s, dw, step);
  }
  Scratch makeScratch() const {
    Scratch s;
    if (!tournament.start.empty()) tournament.prepare(s.icm,budgetBytes);
    s.u.assign((size_t)(maxDepth + 2) * n, 0); s.av.assign((size_t)(maxDepth + 2) * kmax, 0);
    s.sig.assign((size_t)(maxDepth + 2) * kmax, 0); s.reach.assign(n, 1); return s;
  }
};

namespace {
// ---------------- thread pool for one batch ----------------
struct Pool {
  MW *m = nullptr; int threads = 1, active = 1;
  std::vector<pthread_t> ids; std::vector<Scratch> scratch;
  pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER; pthread_cond_t go = PTHREAD_COND_INITIALIZER, done = PTHREAD_COND_INITIALIZER;
  long long gen = 0; int finished = 0; bool quit = false;
  std::vector<DealWork> *work = nullptr; std::atomic<int> next{0}; double step = 1;
  void (*task)(Pool *, int) = nullptr; void *taskCtx = nullptr;   // optional per-thread task (parallel merge)
  struct Arg { Pool *pool; int index; };
  std::vector<Arg> args;
  void process(int index) {
    if (task) { task(this, index); return; }
    for (;;) { size_t d = lo + (size_t)next.fetch_add(1); if (d >= hi) break; try { m->runDeal((*work)[d], scratch[(size_t)index], step); }
      catch(const std::bad_alloc &){exhausted.store(true);return;} }
  }
  static void *main(void *v) {
    Arg *a = (Arg *)v; Pool *p = a->pool; long long seen = 0;
    for (;;) {
      pthread_mutex_lock(&p->mu);
      while (p->gen == seen && !p->quit) pthread_cond_wait(&p->go, &p->mu);
      if (p->quit) { pthread_mutex_unlock(&p->mu); return nullptr; }
      seen = p->gen; pthread_mutex_unlock(&p->mu);
      p->process(a->index);
      pthread_mutex_lock(&p->mu); if (++p->finished == p->threads - 1) pthread_cond_signal(&p->done); pthread_mutex_unlock(&p->mu);
    }
  }
  std::atomic<bool> exhausted{false};
  bool start(MW *mm, int t) {
    m = mm; threads = 1; scratch.clear();
    for (int i = 0; i < t; i++) scratch.push_back(m->makeScratch());
    args.resize((size_t)t); ids.resize((size_t)t);
    for (int i = 1; i < t; i++) {
      args[(size_t)i] = {this, i};
      if (pthread_create(&ids[(size_t)i], nullptr, &Pool::main, &args[(size_t)i])) break;
      threads=i+1;
    }
    return true;
  }
  size_t lo = 0, hi = 0;
  void runRange(std::vector<DealWork> &w, size_t a, size_t b, double s) { lo = a; hi = b; task = nullptr; run(w, s); }
  void runTask(void (*t)(Pool *, int), void *ctx, std::vector<DealWork> &w) { task = t; taskCtx = ctx; active = threads; run(w, step); task = nullptr; }
  void run(std::vector<DealWork> &w, double s) {
    work = &w; step = s; next.store(0);
    const bool fan = active > 1 && threads > 1;
    if (fan) { pthread_mutex_lock(&mu); finished = 0; gen++; pthread_cond_broadcast(&go); pthread_mutex_unlock(&mu); }
    process(0);
    if (fan) { pthread_mutex_lock(&mu); while (finished < threads - 1) pthread_cond_wait(&done, &mu); pthread_mutex_unlock(&mu); }
    if (fan) fanned++;
  }
  long long fanned = 0;
  void stop() {
    pthread_mutex_lock(&mu); quit = true; pthread_cond_broadcast(&go); pthread_mutex_unlock(&mu);
    for (int i = 1; i < threads; i++) pthread_join(ids[(size_t)i], nullptr);
  }
};

void fail(char *err, int errlen, const char *msg) { if (err && errlen > 0) snprintf(err, (size_t)errlen, "%s", msg); }
bool isInt(const JV *v) { return v && v->type == J_NUM && std::floor(v->num) == v->num; }
} // namespace
#include "score_schedule.hpp"
#include "mw_es_impl.hpp"
// Protocol 4 betting rules (lib_wide.js nativeSpec() for sampled betting).
static const char *parseRules(MW *m, JV *spec) {
  using namespace es;
  JV *r = jget(spec, "rules");
  if (!r || r->type != J_OBJ) return "Missing betting rules";
  auto g = std::make_shared<Game>(&m->arena); Rules &R = g->rules; R.n = m->n; R.rootLength = m->startLen;
  auto arr = [&](const char *name, double *out, bool allowNeg) -> bool {
    JV *v = jget(r, name); if (!v || v->type != J_ARR || v->n != m->n) return false;
    for (int i = 0; i < m->n; i++) { JV *x = v->items[i]; if (x->type != J_NUM || !std::isfinite(x->num) || (!allowNeg && x->num < 0)) return false; out[i] = x->num; }
    return true;
  };
  if (!arr("stacks", R.stacks, false) || !arr("prior", R.prior, false) || !arr("ownAnte", R.ownAnte, false) || !arr("posted", R.posted, false)) return "Invalid stacks or wagers in betting rules";
  JV *open = jget(r, "open"); if (!open || open->type != J_ARR || open->n != m->n) return "Invalid opening permissions";
  for (int i = 0; i < m->n; i++) { if (open->items[i]->type != J_BOOL) return "Invalid opening permissions"; R.open[i] = open->items[i]->num != 0; }
  JV *folded = jget(r, "folded"); if (!folded || folded->type != J_ARR || folded->n + m->n > 8) return "Invalid folded wagers";
  for (int i = 0; i < folded->n; i++) { JV *x = folded->items[i]; if (x->type != J_NUM || !(x->num >= 0) || !std::isfinite(x->num)) return "Invalid folded wagers"; R.folded.push_back(x->num); }
  R.common = jnum(jget(r, "common"), -1); R.pot0 = jnum(jget(r, "pot0"), -1);
  if (!(R.common >= 0) || !std::isfinite(R.common) || !(R.pot0 >= 0) || !std::isfinite(R.pot0)) return "Invalid starting pot";
  auto flag = [&](const char *name) { JV *v = jget(r, name); return v && v->type == J_BOOL && v->num != 0; };
  R.pre = flag("pre"); R.shove = flag("shove"); R.noLimp = flag("noLimp");
  if (R.pre != (m->startLen == 0)) return "Preflop rules need an empty board";
  // 3.3 tournament accounting checks (mirrors lib_river.js buildMultiway()).
  {
    double sum = R.common, stackSum = 0;
    for (int p = 0; p < m->n; p++) {
      if (R.ownAnte[p] > 10) return "Invalid ante: each seat's ante must be from 0 to 10 bb";
      // A short stack never posts more than it has; postflop roots have no new blinds.
      if (R.posted[p] > R.stacks[p] + EPS) return "A seat cannot post more chips than its stack";
      if (!R.pre && R.posted[p] != 0) return "Blinds are only posted at a preflop root";
      if (R.pre && R.prior[p] != 0) return "Preflop roots cannot have earlier contributions";
      sum += R.prior[p] + (R.pre ? R.ownAnte[p] : 0); stackSum += R.stacks[p];
      // The dealt-in antes subtracted at terminals are this seat's own ante preflop and none postflop.
      if (m->anteOf[(size_t)p] != (R.pre ? R.ownAnte[p] : 0.0)) return "Ante list does not match the betting rules";
    }
    double topPrior = 0; for (int p = 0; p < m->n; p++) topPrior = std::max(topPrior, R.prior[p]);
    for (double f : R.folded) { sum += f; if (f > topPrior + EPS) return "Earlier folded wagers need a matching live contribution"; }
    if (R.pre && !R.folded.empty()) return "Preflop roots cannot have folded wagers";
    if (!std::isfinite(sum) || !std::isfinite(stackSum + sum)) return "Chip totals overflow";
    if (std::fabs(R.pot0 - sum) > 1e-9 * std::max(1.0, std::fabs(sum))) return "Starting pot does not equal the common pot plus every contribution (chips are not conserved)";
    if (!(R.pot0 > 0) && !R.pre) return "Enter a positive starting pot";
  }
  JV *sizes = jget(r, "sizes"); if (!sizes || sizes->type != J_OBJ) return "Missing bet sizes";
  for (int L : {0, 3, 4, 5}) {
    if (L && L < m->startLen) continue;
    if (!L && !R.pre) continue;
    char key[2] = {(char)('0' + L), 0};
    JV *row = jget(sizes, key); if (!row || row->type != J_OBJ) return "Missing bet sizes for a street";
    Street &st = R.sizes[L]; st.present = true;
    JV *cap = jget(row, "cap"); if (!isInt(cap) || cap->num < 1 || cap->num > 8) return "Invalid raise cap";
    st.cap = (int)cap->num;
    for (int which = 0; which < 2; which++) {
      JV *list = jget(row, which ? "raises" : "bets"); if (!list || list->type != J_ARR || list->n > 5) return "Invalid size list";
      for (int i = 0; i < list->n; i++) {
        JV *e = list->items[i]; if (e->type != J_ARR || e->n != 2 || !isInt(e->items[0])) return "Invalid size";
        Size z{(int)e->items[0]->num, jnum(e->items[1], NAN)};
        if (z.kind < 0 || z.kind > 4 || !std::isfinite(z.value) || z.value < 0) return "Invalid size";
        (which ? st.raises : st.bets).push_back(z);
      }
    }
  }
  const char *streams = jstr(jget(spec, "actionStreams"));
  if (streams && strcmp(streams, "shared") && strcmp(streams, "deal")) return "Unknown action stream mode";
  if(JV *v=jget(spec,"terminalBaseline")){if(v->type!=J_BOOL)return "Invalid terminal baseline flag";g->terminalBaseline=v->num!=0;}
  if(JV *v=jget(spec,"terminalExpectation")){if(v->type!=J_BOOL)return "Invalid terminal expectation flag";g->terminalExpectation=v->num!=0;}
  g->perDealStreams = streams && !strcmp(streams, "deal");
  JV *seed = jget(spec, "actionSeed"); if (!isInt(seed) || seed->num < 0 || seed->num > 4294967295.0) return "Invalid action seed";
  g->actionSeed = (uint32_t)seed->num;
  R.root(g->rootState);
  if (g->rootState.kind != 0) return "The betting rules have no decision";
  m->es = g;
  return nullptr;
}

extern "C" MW *mw_create(const char *json, size_t len, double memoryMiB, char *err, int errlen) {
  if(!std::isfinite(memoryMiB) || memoryMiB<=0 || memoryMiB>65536){fail(err,errlen,"Invalid RAM budget");return nullptr;}
  JV *root = json_parse(json, len, err, errlen);
  if (!root) return nullptr;
  MW *m = new (std::nothrow) MW();
  if (!m) { json_free(root); fail(err, errlen, "Out of memory"); return nullptr; }
  auto bad = [&](const char *msg) -> MW * { json_free(root); delete m; fail(err, errlen, msg); return nullptr; };
  try {
    JV *pv=jget(root,"protocol");
    if(!isInt(pv)) return bad("Unsupported native protocol version");
    double protocol=pv->num;
    if (protocol!=1 && protocol!=3 && protocol!=4) return bad("Unsupported native protocol version");
    JV *nv = jget(root, "n"); if (!isInt(nv) || nv->num < 2 || nv->num > 8) return bad("Native engine needs 2 to 8 seats");
    m->n = (int)nv->num;
    JV *bd = jget(root, "board"); if (!bd || bd->type != J_ARR || (bd->n < 3 && !(protocol>=3 && bd->n==0)) || bd->n > 5) return bad("Native engine needs a 3-5 card board");
    m->startLen = bd->n;
    uint8_t onBoard[52] = {0};
    for (int i = 0; i < bd->n; i++) { if (!isInt(bd->items[i]) || bd->items[i]->num < 0 || bd->items[i]->num > 51) return bad("Bad board card"); m->board[i] = (int)bd->items[i]->num; if (onBoard[m->board[i]]++) return bad("Duplicate board card"); }
    if (JV *mode=jget(root,"device")) {
      if(!jstr(mode)) return bad("Invalid processing mode");
      m->mode=jstr(mode);
      if(m->mode!="cpu" && m->mode!="gpu" && m->mode!="hybrid" && m->mode!="auto") return bad("Unknown processing mode");
    }
    if(JV *limit=jget(root,"gpuMiB")) {
      if(!isInt(limit) || limit->num<1 || limit->num>8192) return bad("GPU budget must be 1 to 8192 MiB");
      m->gpuBudget=(size_t)limit->num<<20;
    }
    if(auto *id=jget(root,"studyId")){
      const char *hex=jstr(id);
      if(!hex || strlen(hex)!=16 || strspn(hex,"0123456789abcdef")!=16)return bad("Invalid study identifier");
      m->studyId=hex;
    }
    JV *hs = jget(root, "hands"); if (!hs || hs->type != J_ARR || hs->n != m->n) return bad("Hands do not match the seats");
    m->hands.resize((size_t)m->n); m->total.assign((size_t)m->n, 0);
    for (int p = 0; p < m->n; p++) {
      JV *r = hs->items[p]; if (r->type != J_ARR || r->n < 1 || r->n > 1326) return bad("Bad range");
      double tot = 0; std::vector<unsigned char> seenPair(52 * 52, 0);
      for (int i = 0; i < r->n; i++) {
        JV *h = r->items[i]; if (h->type != J_ARR || h->n != 4) return bad("Bad hand");
        for (int q = 0; q < 3; q++) if (!isInt(h->items[q])) return bad("Bad hand");
        Hand x{(int)h->items[0]->num, (int)h->items[1]->num, (int)h->items[2]->num, h->items[3]->num, 0};
        if (x.id < 0 || x.id > 1325 || x.a < 0 || x.a > 51 || x.b < 0 || x.b > 51 || x.a == x.b || !(x.w > 0) || !std::isfinite(x.w) || h->items[3]->type != J_NUM) return bad("Bad hand");
        if (x.id != es::comboId(x.a, x.b)) return bad("Hand identifier does not match its cards");   // 3.3
        { const int lo = std::min(x.a, x.b), hi = std::max(x.a, x.b), pair = lo * 52 + hi;   // 3.3: one entry per card pair
          if (seenPair[pair]) return bad("Duplicate hand in a range");
          seenPair[pair] = 1; }
        if (onBoard[x.a] || onBoard[x.b]) continue;   // dealer() drops board-blocked hands
        if(m->startLen==5) x.riverScore=evalSeven(m->board,x.a,x.b);
        x.strategyHand=(int)m->hands[p].size();
        tot += x.w; x.cum = tot; m->hands[(size_t)p].push_back(x);
      }
      if (m->hands[(size_t)p].empty()) return bad("A range is blocked on this board");
      if (!std::isfinite(tot)) return bad("Range weights overflow");
      m->total[(size_t)p] = tot;
    }
    if(JV *groups=jget(root,"turnGroups")){
      if(m->startLen!=4 || groups->type!=J_ARR || groups->n!=m->n || jget(root,"riverGroups"))
        return bad("Invalid turn grouping");
      m->turnGroups.resize(m->n);size_t entries=0;
      for(int p=0;p<m->n;p++){
        auto &map=m->turnGroups[p];const auto &range=m->hands[p];JV *row=groups->items[p];
        entries+=53*range.size();
        if(entries>32768 || row->type!=J_ARR || (size_t)row->n!=53*range.size())return bad("Invalid turn mapping dimensions");
        for(int slot=0;slot<=52;slot++)for(size_t h=0;h<range.size();h++){
          JV *v=row->items[slot*range.size()+h];
          if(!isInt(v)||v->num < -1 || v->num>52*2048+1325)return bad("Invalid turn representative");
          int id=(int)v->num;
          bool blocked=slot && (onBoard[slot-1] || range[h].a==slot-1 || range[h].b==slot-1);
          if(blocked!=(id==-1))return bad("Inconsistent turn group blockers");
          if(id>=0){
            int s=id/2048;size_t index=id%2048,offset=s*range.size()+index;
            if((s==0)!=(slot==0)||index>=range.size()||offset>map.size()||
               (offset<map.size()&&map[offset]!=id))return bad("Invalid turn group representative");
          }
          map.push_back(id);
        }
      }
    }
    if (JV *groups=jget(root,"riverGroups")) {
      if (m->startLen!=5 || groups->type!=J_ARR || groups->n!=m->n)
        return bad("Invalid grouped river study");
      for (int p=0;p<m->n;p++) {
        JV *range=groups->items[p];
        if (range->type!=J_ARR || (size_t)range->n!=m->hands[p].size()) return bad("Invalid river group range");
        for(int i=0;i<range->n;i++){
          JV *id=range->items[i];
          if(!isInt(id) || id->num<0 || id->num>i || range->items[(int)id->num]->num!=id->num)
            return bad("Invalid river group representative");
          m->hands[p][i].strategyHand=(int)id->num;
        }
      }
    }
    // 3.3: per-seat antes subtracted at terminals. Before 3.3 a malformed array was
    // ignored and a negative or non-numeric entry was accepted, which shifted the
    // reported chip EV of that seat. Each entry must now be a finite, nonnegative
    // number no larger than the 10 bb ante limit of the interface (EM.anteModel).
    JV *an = jget(root, "anteOf"); m->anteOf.assign((size_t)m->n, 0);
    if (an) {
      if (an->type != J_ARR || an->n != m->n) return bad("Ante list must have one entry per seat");
      for (int p = 0; p < m->n; p++) {
        JV *x = an->items[p];
        if (x->type != J_NUM || !std::isfinite(x->num) || x->num < 0 || x->num > 10) return bad("Invalid ante: each seat's ante must be a finite amount from 0 to 10 bb");
        m->anteOf[(size_t)p] = x->num;
      }
    }
    if (JV *icm=jget(root,"icm")) {
      auto numbers=[](JV *v,std::vector<double> &out,bool positive) {
        if(!v || v->type!=J_ARR || v->n>16) return false;
        for(int i=0;i<v->n;i++) {
          JV *x=v->items[i];
          if(x->type!=J_NUM || !std::isfinite(x->num) || x->num<0 || (positive && x->num==0)) return false;
          out.push_back(x->num);
        }
        return true;
      };
      auto &t=m->tournament;
      if(protocol<3 || !numbers(jget(icm,"start"),t.start,true) || !numbers(jget(icm,"others"),t.others,true) ||
         !numbers(jget(icm,"payouts"),t.payout,false) || t.start.size()!=m->n+t.others.size() ||
         t.payout.empty() || t.payout.front()<=0 || t.payout.size()>t.start.size() ||
         !std::is_sorted(t.payout.rbegin(),t.payout.rend())) return bad("Invalid ICM configuration");
    }
    if (protocol == 4) {
      const char *alg = jstr(jget(root, "algorithm"));
      if (!alg || strcmp(alg, "external")) return bad("Protocol 4 supports external sampling only");
    }
    JV *nd = protocol == 4 ? nullptr : jget(root, "nodes");
    if (protocol != 4) {
    if (!nd || nd->type != J_ARR || nd->n < 1 || nd->n > 2000000) return bad("Bad tree");
    m->nodes.resize((size_t)nd->n);
    for (int i = 0; i < nd->n; i++) {
      JV *x = nd->items[i]; Node &o = m->nodes[(size_t)i];
      if (x->type != J_ARR || x->n < 1 || !isInt(x->items[0])) return bad("Bad tree node");
      o.kind = (int)x->items[0]->num;
      if (o.kind == 0) {
        if (x->n != 4 || !isInt(x->items[1]) || !isInt(x->items[2]) || x->items[3]->type != J_ARR) return bad("Bad decision node");
        o.actor = (int)x->items[1]->num; o.len = (int)x->items[2]->num; o.k = x->items[3]->n;
        if (o.actor < 0 || o.actor >= m->n || o.k < 1 || o.k > 16 || o.len < m->startLen || o.len > 5) return bad("Bad decision node");
        o.child0 = (int)m->children.size();
        for (int a = 0; a < o.k; a++) { JV *c = x->items[3]->items[a]; if (!isInt(c) || c->num <= i || c->num >= nd->n) return bad("Tree children must follow their parent"); m->children.push_back((int)c->num); }
        if (o.k > m->kmax) m->kmax = o.k;
      } else if (o.kind == 1) {
        if (x->n != 3 || !isInt(x->items[2]) || x->items[2]->num <= i || x->items[2]->num >= nd->n) return bad("Bad chance node");
        if (!isInt(x->items[1]) || x->items[1]->num < m->startLen || x->items[1]->num > 4 || (x->items[1]->num > 0 && x->items[1]->num < 3)) return bad("Bad chance node");
        o.len = (int)x->items[1]->num; o.child0 = (int)m->children.size(); m->children.push_back((int)x->items[2]->num);
      } else if (o.kind == 2) {
        if (x->n != (m->tournament.start.empty()?3:4) || x->items[1]->type != J_ARR || x->items[1]->n != m->n || x->items[2]->type != J_ARR) return bad("Bad terminal");
        Terminal t;
        for (int p = 0; p < m->n; p++) {
          JV *c = x->items[1]->items[p];
          if (c->type != J_NUM || !std::isfinite(c->num) || c->num < 0) return bad("Terminal contributions must be finite and nonnegative");
          t.total.push_back(c->num);
        }
        for (int q = 0; q < x->items[2]->n; q++) {
          JV *pt = x->items[2]->items[q]; if (pt->type != J_ARR || pt->n != 2 || pt->items[1]->type != J_ARR) return bad("Bad pot");
          if (pt->items[0]->type != J_NUM) return bad("Bad pot");
          Pot pot; pot.amount = pt->items[0]->num;
          unsigned seen = 0;
          for (int e = 0; e < pt->items[1]->n; e++) {
            JV *sv = pt->items[1]->items[e];
            if (!isInt(sv) || sv->num < 0 || sv->num >= m->n || (seen >> (int)sv->num & 1)) return bad("Bad pot seat");
            seen |= 1u << (int)sv->num; pot.eligible.push_back((int)sv->num);
          }
          if (!std::isfinite(pot.amount) || pot.amount < 0 || pot.eligible.empty()) return bad("Bad pot");
          t.pots.push_back(pot);
        }
        if(x->n==4) {
          JV *v=x->items[3]; if(v->type!=J_ARR || v->n!=m->n) return bad("Invalid ICM stacks behind");
          for(int p=0;p<m->n;p++){JV *s=v->items[p]; if(s->type!=J_NUM || s->num<0 || !std::isfinite(s->num)) return bad("Invalid ICM stack"); t.behind.push_back(s->num);}
        }
        o.term = (int)m->terms.size(); m->terms.push_back(t);
      } else return bad("Unknown node kind");
    }
    // Generated games are trees. Refuse shared children: a compact DAG can
    // otherwise expand exponentially when traversed as if it were a tree.
    std::vector<unsigned char> parentCount(m->nodes.size(),0);
    for(int child:m->children) if(++parentCount[child]!=1)return bad("Shared betting-tree child");
    if(m->children.size()+1!=m->nodes.size())return bad("Unreachable betting-tree node");
    for(const auto &node:m->nodes)if(node.kind==0 && node.k>1)
      m->workBytesPerDeal+=2*(sizeof(IncRow)+16.0*node.k);
    // depth (children follow parents, so a reverse pass computes heights)
    std::vector<int> height((size_t)nd->n, 0);
    for (int i = nd->n - 1; i >= 0; i--) {
      Node &o = m->nodes[(size_t)i]; int h = 0;
      int cnt = o.kind == 0 ? o.k : o.kind == 1 ? 1 : 0;
      for (int a = 0; a < cnt; a++) h = std::max(h, height[(size_t)m->children[(size_t)(o.child0 + a)]] + 1);
      height[(size_t)i] = h;
    }
    m->maxDepth = height[0] + 1;
    if(m->maxDepth>512) return bad("Betting tree exceeds the native recursion limit");
    } // protocol != 4
    if (JV *bdv = jget(root, "batchDeals")) { if (!isInt(bdv) || bdv->num < 1 || bdv->num > 64) return bad("Batch deals must be 1 to 64"); }
    m->batchDeals = (int)jnum(jget(root, "batchDeals"), 1);
    if (m->batchDeals < 1 || m->batchDeals > 64) return bad("Batch deals must be 1 to 64");
    const char *up = jstr(jget(root, "updates"));
    if (up && !strcmp(up, "alternating")) m->updates = 1; else if (up && !strcmp(up, "enumerate")) m->updates = 2;
    else if (up && strcmp(up, "simultaneous")) return bad("Unknown update scheme");
    if(jnum(jget(root,"stratified"),0)){
      size_t combinations=1;
      for(const auto &range:m->hands){combinations*=range.size();if(combinations>1024)return bad("Stratified joint range exceeds 1024 tuples");}
      if((protocol!=3 && protocol!=4) || m->startLen!=5 || m->updates!=0 || m->batchDeals<2)return bad("Incompatible stratified game");
      std::array<int,8> tuple{};m->enumerateJoint(0,0,1,tuple);
      if(m->joint.empty() || !(m->cumulative.back()>0) || !std::isfinite(m->cumulative.back()))return bad("Invalid joint mass");
    }
    const char *wt = jstr(jget(root, "weighting")); m->linear = !wt || !strcmp(wt, "linear");
    m->dcfr = wt && !strcmp(wt, "dcfr");
    if (wt && strcmp(wt, "linear") && strcmp(wt, "uniform") && strcmp(wt, "dcfr")) return bad("Unknown weighting");
    if (m->dcfr) {
      for (const char *name : {"dcfrAlpha", "dcfrBeta", "dcfrGamma"}) if (JV *x = jget(root, name)) {
        if (x->type != J_NUM || !std::isfinite(x->num) || std::fabs(x->num) > 16) return bad("DCFR parameters must be finite numbers from -16 to 16");
      }
      m->dA = jnum(jget(root, "dcfrAlpha"), 1.5); m->dB = jnum(jget(root, "dcfrBeta"), 0); m->dG = jnum(jget(root, "dcfrGamma"), 2);
      if (m->dA < 0 || m->dG < 0) return bad("DCFR alpha and gamma must be nonnegative");
    }
    const char *rm = jstr(jget(root, "regretMatching")); m->plus = rm && !strcmp(rm, "plus");
    if (rm && strcmp(rm, "plus") && strcmp(rm, "standard")) return bad("Unknown regret matching");
    JV *st = jget(root, "state"); uint32_t actionRng = 0;
    if (st) {
      if (st->type != J_OBJ) return bad("Invalid training state");
      for (const char *name : {"rng", "actionRng", "iterations", "trainingDeals", "stateVisits"}) if (JV *x = jget(st, name)) {
        const double hi = (!strcmp(name, "rng") || !strcmp(name, "actionRng")) ? 4294967295.0 : 9007199254740991.0;
        if (!isInt(x) || x->num < 0 || x->num > hi) return bad("Invalid training state counter");
      }
      m->rng.state = (uint32_t)jnum(jget(st, "rng"), 17);
      m->iterations = (long long)jnum(jget(st, "iterations"), 0);
      m->trainingDeals = (long long)jnum(jget(st, "trainingDeals"), 0);
      m->stateVisits = (long long)jnum(jget(st, "stateVisits"), 0);
      if (protocol == 4) actionRng = (uint32_t)jnum(jget(st, "actionRng"), 0);
    }
    if (m->iterations < 0 || m->iterations > 10000000LL) return bad("Bad iteration count");
    // tables
    m->budgetBytes = memoryMiB * 1048576.0;
    m->dense = m->startLen == 5 && protocol != 4 && !jget(root,"riverGroups");
    if (protocol == 4) {
      m->arena.setLimit((size_t)m->budgetBytes);
      if (m->trainingDeals!=m->iterations*m->batchDeals) return bad("Inconsistent external checkpoint committed deal count");
      if (const char *why = parseRules(m, root)) return bad(why);
      // 3.3: external-sampling DCFR with per-row discount schedules (mw_es.hpp Dcfr).
      if (m->dcfr) { m->es->dcfr = true; m->es->schedule.init(m->dA, m->dB, m->dG); }
    }
      if (JV *gk = jget(root, "groupKeys")) {
        es::GroupKeys &G = m->es?m->es->groups:m->fullGroups;
        if (gk->type != J_OBJ || !m->turnGroups.empty() || jget(root, "riverGroups") || !m->joint.empty()) return bad("Invalid grouped-key study");
        const char *ab = jstr(jget(gk, "abstraction"));
        if (!ab || (strcmp(ab, "compact") && strcmp(ab, "detailed"))) return bad("Grouped keys need Compact or Detailed grouping");
        G.detailed = !strcmp(ab, "detailed");
        JV *sm = jget(gk, "small"); if (!sm || sm->type != J_ARR || sm->n != m->n) return bad("Invalid grouped-key range sizes");
        for (int p = 0; p < m->n; p++) { if (sm->items[p]->type != J_BOOL) return bad("Invalid grouped-key range sizes"); G.small[p] = sm->items[p]->num != 0; if(G.small[p]!=(m->hands[p].size()<=12))return bad("Grouped range size mismatch"); }
        G.start = m->startLen; G.nl = 0;
        if (m->startLen == 0) { G.lengths[G.nl++] = 0; if (!(m->es?m->es->rules.shove:jget(root,"shoveOnly") && jget(root,"shoveOnly")->num)) { G.lengths[G.nl++] = 3; G.lengths[G.nl++] = 4; } G.lengths[G.nl++] = 5; }
        else for (int L = m->startLen; L <= 5; L++) G.lengths[G.nl++] = L;
        G.on = true;
        if (!es::groupStartInto(*m,G,m->es?m->es->startKey:m->fullStart,m->bytes,m->budgetBytes)) return bad("Native budget is too small for the hand-group dictionary");
      }
    if(protocol==4){
      // Validation reference only: textbook eager DCFR (every row discounted after every
      // iteration, average strategy discounted by (t/(t+1))^gamma). O(rows) per update.
      if (JV *eager = jget(root, "dcfrEager")) {
        if (eager->type != J_BOOL || !m->dcfr) return bad("dcfrEager needs DCFR weighting");
        m->es->dcfrEager = eager->num != 0;
      }
      m->es->actionRng.state = actionRng;
      const auto &r = m->es->rootState;
      if (m->es->states.add(0xffffffffu, 0, r.kind, r.actor, r.length, r.k, m->bytes, m->budgetBytes) != 0) return bad("Native budget is too small for the betting state table");
    }
    if (m->dense) {
      long long base = 0; double need = 0;
      for (Node &o : m->nodes) if (o.kind == 0 && o.k > 1) { o.rowBase = base; base += (long long)m->hands[(size_t)o.actor].size(); need += (double)m->hands[(size_t)o.actor].size() * (2.0 * o.k * 8 * (m->batchDeals > 1 ? 2 : 1) + sizeof(MW::RowMeta) + 8); }
      if (need > m->budgetBytes) {
        char msg[256]; snprintf(msg, sizeof msg, "Native strategy tables need about %.0f MiB, more than the %.0f MiB native budget. Use fewer bet sizes, narrower ranges or a larger budget.", need / 1048576.0, memoryMiB);
        return bad(msg);
      }
      size_t offv = 0;
      m->rows.reserve((size_t)base); m->denseOff.reserve((size_t)base);
      for (int i = 0; i < (int)m->nodes.size(); i++) {
        Node &o = m->nodes[(size_t)i];
        if (o.kind != 0 || o.k == 1) continue;
        for (size_t h = 0; h < m->hands[(size_t)o.actor].size(); h++) {
          m->rows.push_back({(uint64_t)m->rows.size(), i, o.k, offv, 0, 0}); m->denseOff.push_back(offv); offv += 2 * (size_t)o.k;
        }
      }
      m->vals.assign(offv, 0.0); if (m->batchDeals > 1) m->delta.assign(offv, 0.0);
      m->bytes = need;
    }
  } catch (const std::bad_alloc &) { return bad("Out of memory building the native engine"); }
  json_free(root);
  return m;
}

extern "C" void mw_free(MW *m) { delete m; }


extern "C" int mw_train(MW *m, long long iterations, int threads, volatile int *stop, mw_progress_fn progress, void *ctx, char *err, int errlen) {
  if (m) m->evCache.clear();   // 3.9: cached action EVs describe the previous state
  if (iterations < 0 || m->iterations + iterations > 10000000LL) { fail(err, errlen, "Iteration count must fit the 10 million iteration limit"); return 0; }
  if (threads < 1) threads = 1;
  if (threads > 256) threads = 256;
  if (m->es) return es::train(m, iterations, threads, stop, progress, ctx, err, errlen);
  if (m->updates == 0 && threads > m->batchDeals) threads = m->batchDeals;   // more threads than deals per update cannot help
  m->lastThreads = threads;
  Pool pool;
  ScoreSchedule scorer;
  try {
    std::vector<DealWork> work;
    std::vector<GroupedWorld> grouped;
    const double totalBudget=m->budgetBytes;
    struct BudgetReset { MW *m; double bytes; ~BudgetReset(){m->budgetBytes=bytes;} } reset{m,totalBudget};
    const double icmScratch=m->tournament.start.empty()?0:(double)Tournament::workspaceBytes(m->tournament.start.size(),m->budgetBytes);
    const double workerScratch=(icmScratch+(m->maxDepth+2)*(m->n+2*m->kmax)*8.0+1024)*threads;
    std::vector<DealWork> phaseWork;
    pool.start(m, threads);
    const int B = m->batchDeals;
    double avgVisits = 1e9;   // unknown before the first update: allow threads
    for (long long it = 0; it < iterations && !m->limitReached; it++) {
      if (stop && __atomic_load_n(stop,__ATOMIC_RELAXED)) break;
      double step = m->linear ? (double)(m->iterations + 1) : 1.0;
      // Draw every deal of this update first, in the JavaScript order (deals do not
      // depend on the policy). Units of one phase share one frozen policy.
      auto clk = [] { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); };
      double tA = clk();
      const uint32_t rngBefore=m->rng.state; const long long dealsBefore=m->trainingDeals;
      size_t units = 0; bool ok = true; bool pressure=false;
      auto unit = [&](const World &w, int seat, double weight, int phase) {
        if(workerScratch+(units+1)*m->workBytesPerDeal+m->bytes>totalBudget){pressure=true;return;}
        if (units >= work.size()) work.emplace_back();
        DealWork &u = work[units++]; u.w = w;
        u.seat = seat; u.weight = weight; u.phase = phase;
      };
      for (int d = 0; d < B && ok && !pressure; d++) {
        World w0{}; if (!m->deal(w0,d)) { ok = false; break; } m->trainingDeals++;
        if (m->updates == 0) { unit(w0, -1, 1, 0); continue; }
        for (int p = 0; p < m->n && ok; p++) {
          World w = w0; if (p) { if (!m->deal(w)) { ok = false; break; } m->trainingDeals++; }
          int phase = B == 1 ? p : 0;   // one deal per update applies each seat's increments at once in JavaScript
          if (m->updates == 1) { unit(w, p, 1, phase); continue; }
          uint8_t used[52] = {0};
          for (int i = 0; i < 5; i++) used[w.cards[i]] = 1;
          for (int j = 0; j < m->n; j++) if (j != p) { const Hand &h = m->hands[(size_t)j][(size_t)w.seat[j]]; used[h.a] = used[h.b] = 1; }
          double tot = 0; for (const Hand &h : m->hands[(size_t)p]) if (!used[h.a] && !used[h.b]) tot += h.w;
          for (size_t hi = 0; hi < m->hands[(size_t)p].size(); hi++) {
            const Hand &h = m->hands[(size_t)p][hi]; if (used[h.a] || used[h.b]) continue;
            World x = w; x.seat[p] = (int)hi; unit(x, p, h.w / tot, phase);
          }
        }
      }
      if(m->fullGroups.on && ok && !pressure){
        if(workerScratch+units*(m->workBytesPerDeal+sizeof(GroupedWorld))+m->bytes>totalBudget)pressure=true;
        else {
          grouped.resize(units);
          for(size_t d=0;d<units;d++){
            if(!es::worldGroups(*m,m->fullGroups,m->fullStart,work[d].w,grouped[d].ids)){pressure=true;break;}
            work[d].w.grouped=&grouped[d];
          }
        }
      }
      if(pressure){m->rng.state=rngBefore;m->trainingDeals=dealsBefore;m->limitReached=true;break;}
      m->budgetBytes=totalBudget-workerScratch-work.size()*m->workBytesPerDeal-grouped.capacity()*sizeof(GroupedWorld);
      if (!ok) { m->rng.state=rngBefore;m->trainingDeals=dealsBefore;pool.stop(); fail(err, errlen, "Compatible hands are too rare to sample reliably. Review overlapping ranges or use exact deals."); return 0; }
      // Provision all sparse rows before an immediate update or a DCFR
      // discount can mutate policy. Frozen batches already have a delta table.
      if(!m->dense && (B==1 || m->dcfr)){
        for(size_t d=0;d<units && !pressure;d++)for(size_t i=0;i<m->nodes.size();i++){
          auto &nd=m->nodes[i];if(nd.kind || nd.k<2 || (work[d].seat>=0 && work[d].seat!=nd.actor))continue;
          if(m->getOrCreate(m->keyOf(work[d].w,(int)i,nd.actor),(int)i,nd.k)<0){pressure=true;break;}
        }
        if(pressure){m->rng.state=rngBefore;m->trainingDeals=dealsBefore;m->limitReached=true;break;}
      }
      scorer.run(*m,work,units);
      if (m->dcfr && m->iterations > 0) {   // DCFR: discount values accumulated through t-1; a uniform per-row factor on positive regrets leaves this update's policy unchanged (experimental)
        double t = (double)m->iterations, pa = std::pow(t, m->dA), pos = pa / (pa + 1), pb = std::pow(t, m->dB), neg = pb / (pb + 1), avg = std::pow(t / (t + 1), m->dG);
        for (size_t ri = 0; ri < m->rows.size(); ri++) { MW::RowMeta &rw = m->rows[ri]; if (!rw.visited) continue; size_t o = m->off((long long)ri);
          for (int a = 0; a < rw.k; a++) { double &v = m->vals[o + (size_t)a]; v *= v > 0 ? pos : neg; m->vals[o + (size_t)(rw.k + a)] *= avg; } }
      }
      m->secDeal += clk() - tA;
      long long visits = 0; bool budget = true;
      m->touched.clear();
      int phases = B == 1 && m->updates ? m->n : 1;
      size_t first = 0;
      for (int ph = 0; ph < phases && budget; ph++) {
        size_t last = first; while (last < units && work[last].phase == ph) last++;
        phaseWork.clear();
        // Adaptive threading: waking helper threads costs tens of microseconds, so a
        // phase is split only when its estimated work (state visits, measured on the
        // previous update) is large enough. Results are identical either way.
        double estimate = avgVisits * (double)(last - first);
        pool.active = estimate >= 60000.0 ? pool.threads : 1;
        double tB = clk();
        pool.runRange(work, first, last, step);
        if(pool.exhausted.load())throw std::bad_alloc();
        double tC = clk(); m->secTraverse += tC - tB;
        // Parallel merge (dense tables, several deals per update): thread i applies the
        // rows in its contiguous block of the table, scanning deals in order, so every value receives its
        // increments in exactly the sequential order.
        if (B > 1 && m->dense && pool.threads > 1 && estimate >= 60000.0) {
          struct Ctx { MW *m; std::vector<DealWork> *w; size_t first, last; int T, B; std::atomic<int> bad{0}; } mctx{m, &work, first, last, pool.threads, B};
          pool.runTask([](Pool *pl, int index) {
            Ctx &c = *(Ctx *)pl->taskCtx;
            for (size_t d = c.first; d < c.last; d++) {
              DealWork &dw = (*c.w)[d];
              for (const IncRow &ir : dw.rows) {
                long long r = (long long)ir.key; if ((int)((size_t)r * (size_t)c.T / c.m->rows.size()) != index) continue;   // contiguous blocks avoid false sharing
                MW::RowMeta &rm = c.m->rows[(size_t)r]; rm.visited = 1;
                size_t o = c.m->off(r); const double *x = &dw.vals[ir.off]; int k = ir.k;
                for (int a = 0; a < 2 * k; a++) if (!std::isfinite(x[a])) c.bad = 1;
                rm.marked = 1;
                for (int a = 0; a < k; a++) { c.m->delta[o + (size_t)a] += x[a] / c.B; c.m->delta[o + (size_t)(k + a)] += x[k + a] / c.B; }
              }
            }
          }, &mctx, work);
          if (mctx.bad) { pool.stop(); fail(err, errlen, "Non-finite sampled CFR increment"); return 0; }
          for (size_t d = first; d < last; d++) visits += work[d].visits;
          for (size_t d = first; d < last; d++) for (const IncRow &ir : work[d].rows) { MW::RowMeta &rm = m->rows[(size_t)ir.key]; if (rm.marked == 1) { rm.marked = 2; m->touched.push_back((int32_t)ir.key); } }
          for (int32_t r : m->touched) m->rows[(size_t)r].marked = 1;
          first = last; m->secMerge += clk() - tC; continue;
        }
        for (size_t d = first; d < last && budget; d++) {
          DealWork &dw = work[d]; visits += dw.visits;
          for (const IncRow &ir : dw.rows) {
            long long r = m->getOrCreate(ir.key, ir.node, ir.k);
            if (r < 0) { budget = false; break; }
            MW::RowMeta &rm = m->rows[(size_t)r]; rm.visited = 1;
            size_t o = m->off(r); const double *x = &dw.vals[ir.off]; int k = ir.k;
            for (int a = 0; a < 2 * k; a++) if (!std::isfinite(x[a])) { pool.stop(); fail(err, errlen, "Non-finite sampled CFR increment"); return 0; }
            if (B == 1) {
              for (int a = 0; a < k; a++) { double v = m->vals[o + (size_t)a] + x[a]; m->vals[o + (size_t)a] = m->plus ? std::fmax(0.0, v) : v; m->vals[o + (size_t)(k + a)] += x[k + a]; }
            } else {
              if (!rm.marked) { rm.marked = 1; m->touched.push_back((int32_t)r); }
              for (int a = 0; a < k; a++) { m->delta[o + (size_t)a] += x[a] / B; m->delta[o + (size_t)(k + a)] += x[k + a] / B; }
            }
          }
        }
        first = last; m->secMerge += clk() - tC;
      }
      if (!budget) {   // like JavaScript: discard the incomplete batch and stop at the budget
        for (int32_t r : m->touched) { MW::RowMeta &rm = m->rows[(size_t)r]; size_t o = m->off(r); for (int a = 0; a < 2 * rm.k; a++) m->delta[o + (size_t)a] = 0; rm.marked = 0; }
        m->rng.state=rngBefore;m->trainingDeals=dealsBefore;m->limitReached = true; break;
      }
      for (int32_t r : m->touched) {
        MW::RowMeta &rm = m->rows[(size_t)r]; size_t o = m->off(r);
        for (int a = 0; a < 2 * rm.k; a++) {
          double v = m->vals[o + (size_t)a] + m->delta[o + (size_t)a];
          if (!std::isfinite(v)) { pool.stop(); fail(err, errlen, "Non-finite batch strategy value"); return 0; }
          m->vals[o + (size_t)a] = a < rm.k && m->plus ? std::fmax(0.0, v) : v; m->delta[o + (size_t)a] = 0;
        }
        rm.marked = 0;
      }
      if (units) avgVisits = (double)visits / (double)units;
      m->stateVisits += visits; m->iterations++;
      if (progress && (it & 63) == 63) progress(ctx, m->iterations, m->trainingDeals);
    }
  } catch (const std::bad_alloc &) { pool.stop(); m->limitReached = true; fail(err, errlen, "Out of memory during native training"); return 0; }
  m->lastThreads=pool.threads;
  pool.stop();
  if (progress) progress(ctx, m->iterations, m->trainingDeals);
  return 1;
}

// EMMW1: "EMMW1\0\0\0", u32 header length, header JSON, u32 row count, then per row:
// u32 node, u16 hand index, u8 extra card 1 (+1, 0 none), u8 extra card 2, u8 k, then 2k float64.
static void put(std::vector<unsigned char> &b, const void *p, size_t n) { const unsigned char *c = (const unsigned char *)p; b.insert(b.end(), c, c + n); }
extern "C" void mw_root_policy(MW *m,JB *out){
  const auto &g=*m->es;const auto &s=g.rootState;
  if(s.kind!=0||s.actor<0){jb_puts(out,"{\"actions\":[],\"hands\":[]}");return;}
  const int seat=s.actor,k=s.k;
  const auto &range=m->hands[seat];
  jb_printf(out,"{\"seat\":%d,\"actions\":[",seat);
  for(int a=0;a<k;a++){
    if(a)jb_putc(out,',');
    const bool call=s.facing&&a==1&&s.to[a]<=s.price+1e-9;
    const char *name=s.facing?(a==0?"Fold":call?"Call":"Raise to"):(a==0?"Check":"Bet to");
    jb_printf(out,"{\"name\":\"%s\",\"to\":",name);jb_num(out,s.to[a],10);jb_putc(out,'}');
  }
  jb_puts(out,"],\"hands\":[");
  for(size_t i=0;i<range.size();i++){
    const auto &h=range[i];int hand=h.strategyHand;uint32_t code=es::cardsCode(m->board,m->startLen);
    if(g.groups.on){hand=0;code=g.startKey[seat][i];}
    else if(!m->turnGroups.empty()){
      const int id=m->turnGroups[seat][i];hand=id%2048;code=es::cardsCode(m->board,4)+id/2048;
    }
    long long r=m->findRow(es::rowKey(0,hand,code));double total=0;const double *avg=nullptr;
    if(r>=0){avg=&m->vals[m->rows[(size_t)r].off+k];for(int a=0;a<k;a++)total+=avg[a];}
    if(i)jb_putc(out,',');
    jb_printf(out,"{\"cards\":[%d,%d],\"observed\":%s,\"probabilities\":[",h.a,h.b,total>0?"true":"false");
    for(int a=0;a<k;a++){if(a)jb_putc(out,',');jb_printf(out,"%.17g",total>0?avg[a]/total:1.0/k);}
    jb_puts(out,"]}");
  }
  jb_puts(out,"]}");
}
#include "explorer.hpp"
#include "ev_control.hpp"
#include "showdown_table.hpp"
#include "action_ev.hpp"
// ---- 4.0: evaluation tasks for the desktop job API (server.c) ----
struct MwEvalTask { es::EvShared shared; volatile int cancel = 0; };
extern "C" MwEvalTask *mw_eval_task_new(void) { try { return new MwEvalTask(); } catch (...) { return nullptr; } }
extern "C" void mw_eval_task_free(MwEvalTask *t) { delete t; }
extern "C" void mw_eval_cancel(MwEvalTask *t) { if (t) __atomic_store_n(&t->cancel, 1, __ATOMIC_RELAXED); }
extern "C" int mw_eval_run(MW *m, int kind, const char *json, size_t len, JB *out, char *err, int errlen, MwEvalTask *t) {
  if (!t) { fail(err, errlen, "No evaluation task"); return 500; }
  return kind == 0 ? actionEvImpl(m, json, len, out, err, errlen, &t->cancel, &t->shared) : responseGainImpl(m, json, len, out, err, errlen, &t->cancel, &t->shared);
}
extern "C" void mw_eval_progress(MwEvalTask *t, JB *out) {
  if (!t) { jb_puts(out, "null"); return; }
  const es::EvControl &c = t->shared.ctl;
  jb_printf(out, "{\"stage\":\"%s\",\"elapsedMs\":%.1f,\"visits\":%lld,\"samples\":%lld,\"unitsDone\":%lld,\"unitsTotal\":%lld,\"showdownTables\":%lld,\"boardsScored\":%lld,\"gpuBoards\":%lld,\"evaluationMiB\":%.3f,\"peakEvaluationMiB\":%.3f,\"cancelRequested\":%s,\"note\":\"unitsDone/unitsTotal count work items scheduled so far (more may be added); they are not a completion percentage\"}",
            es::siteName(c.stage.load()), c.elapsedMs(), c.visits.load(), c.samples.load(), c.unitsDone.load(), c.unitsTotal.load(), c.tables.load(), c.boards.load(), t->shared.show.gpuBoards.load(),
            c.memoryBytes.load() / 1048576.0, c.peakMemoryBytes.load() / 1048576.0, __atomic_load_n(&t->cancel, __ATOMIC_RELAXED) ? "true" : "false");
}
extern "C" int mw_eval_validate(MW *m, int kind, const char *json, size_t len, char *err, int errlen) {
  MwEvalTask t; t.shared.ctl.validateOnly = true; JB out; jb_init(&out);
  const int rc = mw_eval_run(m, kind, json, len, &out, err, errlen, &t); jb_free(&out); return rc;
}
extern "C" void mw_set_eval_threads(int cap) { es::evThreadCap().store(cap < 1 ? 1 : cap > 256 ? 256 : cap); }
extern "C" int mw_eval_threads(void) { return es::evThreadCap().load(); }
extern "C" void mw_info(MW *m, JB *out) {
  size_t visited = 0; for (auto &r : m->rows) visited += r.visited;
  if (m->es) {
    const es::Game &g = *m->es;
    jb_printf(out, "{\"protocol\":%d,\"specProtocol\":4,\"algorithm\":\"external\",\"actionStreams\":\"%s\",\"iterations\":%lld,\"trainingDeals\":%lld,\"stateVisits\":%lld,\"rng\":%u,\"actionRng\":%u,\"rows\":%zu,\"states\":%zu,\"tableMiB\":",
      MW_PROTOCOL, g.perDealStreams ? "deal" : "shared", m->iterations, m->trainingDeals, m->stateVisits, m->rng.state, g.actionRng.state, visited, g.states.parent.size());
    jb_num(out, m->bytes / 1048576.0, 3);
    const auto &st=g.states;
    const size_t persistent=m->vals.capacity()*8+m->delta.capacity()*8+m->rows.capacity()*sizeof(MW::RowMeta)+
      m->hkeys.capacity()*8+m->hrow.capacity()*4+m->touched.capacity()*4+st.parent.capacity()*4+
      st.slot.capacity()+st.kind.capacity()+st.actor.capacity()+st.length.capacity()+st.k.capacity()+
      st.keys.capacity()*8+st.ids.capacity()*4;
    jb_printf(out,",\"weighting\":\"%s\"",g.dcfr?"dcfr":m->linear?"linear":"uniform");
    if(g.groups.on)jb_printf(out,",\"handGroups\":{\"abstraction\":\"%s\",\"keys\":%zu,\"dictionaryBytes\":%.0f,\"native\":true}",g.groups.detailed?"detailed":"compact",g.groups.text.size(),g.groups.bytes);
    else if(!m->turnGroups.empty())jb_puts(out,",\"handGroups\":{\"representatives\":\"turn\",\"native\":true}");
    if(g.dcfr){jb_puts(out,",\"dcfr\":{\"alpha\":");jb_num(out,g.schedule.alpha,6);jb_puts(out,",\"beta\":");jb_num(out,g.schedule.beta,6);
      jb_puts(out,",\"gamma\":");jb_num(out,g.schedule.gamma,6);jb_printf(out,",\"scheduleBytes\":%zu,\"lazyRowDiscount\":true}",g.schedule.bytes());}
    jb_printf(out,",\"tablePeakBytes\":%zu",m->tablePeak.load());
    if(m->restoreEstimate.total>0)jb_printf(out,",\"restoreEstimate\":{\"totalBytes\":%.0f,\"valueBytes\":%.0f,\"rowMetaBytes\":%.0f,\"rowHashBytes\":%.0f,\"stateBytes\":%.0f,\"stateHashBytes\":%.0f}",m->restoreEstimate.total,m->restoreEstimate.values,m->restoreEstimate.rowMeta,m->restoreEstimate.rowHash,m->restoreEstimate.states,m->restoreEstimate.stateHash);
    jb_printf(out,",\"stateCache\":{\"states\":%zu,\"capStates\":%zu,\"bytes\":%.0f,\"chargedToTableBudget\":false}",g.store.size(),g.storeCap,g.storeMiB()*1048576.0);
    jb_printf(out,",\"tableCapacityBytes\":%zu,\"scratchPeakBytes\":%zu,\"scratchBudgetBytes\":%zu",persistent,g.scratchPeak.load(),(size_t)m->budgetBytes);
    jb_printf(out, ",\"attemptedDealsThisSession\":%lld,\"transientLimitPerDealBytes\":%zu", g.attempts, g.unitLimitBytes);
    jb_puts(out, ",\"budgetMiB\":"); jb_num(out, m->budgetBytes / 1048576.0, 1);
    jb_printf(out,",\"scoreCalibrations\":%u,\"scoreCalibrationSeconds\":%.7f,\"cpuScoreProbeSeconds\":%.7f,\"bestDeviceScoreSeconds\":%.7f",m->scoreCalibrations,m->scoreCalibrationSeconds,m->cpuScoreProbeSeconds,m->bestDeviceScoreSeconds);
    if (!m->studyId.empty()) jb_printf(out, ",\"studyId\":\"%s\"", m->studyId.c_str());
    // 3.3: external sampling scores hands on the CPU. The profile below bounds what any GPU
    // offload of hand scoring could save (Amdahl): at most scoringShare of the training time,
    // before PCIe transfer and synchronization costs.
    const double share = g.secProfiled > 0 ? std::min(1.0, g.secScore / g.secProfiled) : 0;
    jb_puts(out,",\"devicePath\":");jb_str(out,m->route.c_str());
    jb_printf(out,",\"requestedDevice\":\"%s\",\"gpuBufferPeakBytes\":%zu,\"gpuStageBound\":{\"scoringShare\":%.4f,\"maxSavingFraction\":%.4f}",m->mode.c_str(),m->peakGpuBytes,share,share);
    jb_printf(out, ",\"limitReached\":%s,\"threads\":%d,\"batchDeals\":%d,\"seconds\":{\"deal\":%.4f,\"traverse\":%.4f,\"merge\":%.4f,\"profiledUpdates\":%.4f,\"scoreInProfiledUpdates\":%.4f}}",
      m->limitReached ? "true" : "false", m->lastThreads, m->batchDeals, g.secDeal, g.secTraverse, g.secMerge, g.secProfiled, g.secScore);
    return;
  }
  jb_printf(out, "{\"protocol\":%d,\"iterations\":%lld,\"trainingDeals\":%lld,\"stateVisits\":%lld,\"rng\":%u,\"rows\":%zu,\"tableMiB\":", MW_PROTOCOL, m->iterations, m->trainingDeals, m->stateVisits, m->rng.state, visited);
  jb_num(out, m->bytes / 1048576.0, 3);
  if(!m->studyId.empty())jb_printf(out,",\"studyId\":\"%s\"",m->studyId.c_str());
  jb_printf(out,",\"devicePath\":\"%s\",\"gpuBufferPeakBytes\":%zu",m->route.c_str(),m->peakGpuBytes);
  jb_printf(out, ",\"limitReached\":%s,\"threads\":%d,\"batchDeals\":%d,\"seconds\":{\"deal\":%.4f,\"traverse\":%.4f,\"merge\":%.4f}}", m->limitReached ? "true" : "false", m->lastThreads, m->batchDeals, m->secDeal, m->secTraverse, m->secMerge);
}
static uint32_t crcUpdate(uint32_t crc,const unsigned char *data,size_t n) {
  static const auto table=[]{
    std::array<uint32_t,256> t{};
    for(uint32_t i=0;i<256;i++){uint32_t c=i;for(int bit=0;bit<8;bit++)c=(c>>1)^((c&1)?0xedb88320U:0);t[i]=c;}
    return t;
  }();
  for(size_t i=0;i<n;i++)crc=table[(crc^data[i])&255]^(crc>>8);
  return crc;
}
static uint32_t rowChecksum(const unsigned char *data,size_t n){return ~crcUpdate(~0u,data,n);
}
static size_t esExport(MW *m,unsigned char **out,FILE *file=nullptr,int(*stop)()=nullptr);
static int esImport(MW *m, const unsigned char *buf, size_t len, char *err, int errlen);
static size_t exportState(MW *m, unsigned char **out) {
  if (m->es) return esExport(m, out);
  std::vector<unsigned char> b; put(b, m->fullGroups.on?"EMMWG\0\0\0":m->startLen?"EMMW1\0\0\0":"EMMW3\0\0\0", 8);
  JB h; jb_init(&h);
  struct HeaderOwner { JB *p; ~HeaderOwner(){jb_free(p);} } owner{&h};
  mw_info(m,&h);if(h.failed || !h.n)return 0;h.n--;jb_puts(&h,",\"rowCrc32\":\"00000000\"}");
  if(h.failed)return 0;
  uint32_t hl = (uint32_t)h.n; put(b, &hl, 4); put(b, h.s, h.n);
  uint32_t cnt = 0; size_t at = b.size(); put(b, &cnt, 4);
  for (size_t r = 0; r < m->rows.size(); r++) {
    const MW::RowMeta &rm = m->rows[r]; if (!rm.visited) continue;
    uint32_t node = (uint32_t)rm.node; uint16_t hand; uint8_t e1 = 0, e2 = 0, k = (uint8_t)rm.k;
    if(m->fullGroups.on){
      const auto &key=*m->fullGroups.text[(uint32_t)rm.key];
      uint16_t length=(uint16_t)key.size();
      put(b,&node,4);put(b,&length,2);put(b,key.data(),length);put(b,&k,1);
      put(b,&m->vals[m->off((long long)r)],16*(size_t)k);cnt++;continue;
    }
    if (m->dense) hand = (uint16_t)(rm.key - (uint64_t)m->nodes[(size_t)rm.node].rowBase);
    else if(!m->startLen) { hand=(rm.key>>30)&2047; e1=(rm.key>>24)&63; e2=(rm.key>>18)&63; }
    else { hand = (uint16_t)((rm.key >> 16) & 0xffff); e1 = (uint8_t)((rm.key >> 8) & 0xff); e2 = (uint8_t)(rm.key & 0xff); }
    put(b, &node, 4); put(b, &hand, 2); put(b, &e1, 1); put(b, &e2, 1); put(b, &k, 1);
    if(!m->startLen) for(int j=2;j>=0;--j){uint8_t card=(rm.key>>(6*j))&63; put(b,&card,1);}
    put(b, &m->vals[m->off((long long)r)], 16 * (size_t)rm.k); cnt++;
  }
  std::memcpy(&b[at], &cnt, 4);
  char crc[9];snprintf(crc,sizeof(crc),"%08x",rowChecksum(b.data()+at,b.size()-at));
  memcpy(b.data()+12+hl-10,crc,8);
  *out = (unsigned char *)malloc(b.size()); if (!*out) return 0;
  std::memcpy(*out, b.data(), b.size()); return b.size();
}
extern "C" size_t mw_export(MW *m,unsigned char **out){
  *out=nullptr;
  try{return exportState(m,out);}
  catch(const std::bad_alloc &){return 0;}
}
static int importState(MW *m, const unsigned char *buf, size_t len, char *err, int errlen) {
  if (m->es) {
    try { return esImport(m,buf,len,err,errlen); }
    catch(const std::bad_alloc &){fail(err,errlen,"Insufficient memory to stage checkpoint import");return 0;}
  }
  if (len < 16 || std::memcmp(buf, m->fullGroups.on?"EMMWG\0\0\0":m->startLen?"EMMW1\0\0\0":"EMMW3\0\0\0", 8)) { fail(err, errlen, "Not an EMMW1 state"); return 0; }
  uint32_t hl; std::memcpy(&hl, buf + 8, 4); if ((size_t)hl + 16 > len) { fail(err, errlen, "Truncated state"); return 0; }
  JV *h = json_parse((const char *)buf + 12, hl, err, errlen); if (!h) return 0;
  // 3.3: counters must be whole, nonnegative numbers (fractions were truncated before).
  for(const char *name:{"iterations","trainingDeals","stateVisits","rng"}){
    const JV *v=jget(h,name);
    if(!isInt(v) || v->num<0 || v->num>9007199254740991.0){json_free(h);fail(err,errlen,"Invalid checkpoint counter");return 0;}
  }
  long long it = (long long)jnum(jget(h, "iterations"), -1), deals = (long long)jnum(jget(h, "trainingDeals"), -1), visits = (long long)jnum(jget(h, "stateVisits"), -1);
  if(JV *field=jget(h,"rowCrc32")){
    char crc[9];snprintf(crc,sizeof(crc),"%08x",rowChecksum(buf+12+hl,len-12-hl));
    if(!jstr(field) || strcmp(crc,jstr(field))){json_free(h);fail(err,errlen,"State has invalid values (row checksum failed)");return 0;}
  }
  const char *study=jstr(jget(h,"studyId"));
  if(study && !m->studyId.empty() && m->studyId!=study){json_free(h);fail(err,errlen,"State belongs to a different study");return 0;}
  double rs = jnum(jget(h, "rng"), -1); json_free(h);
  if (it < 0 || it > 10000000LL || deals < 0 || visits < 0 || rs < 0 || rs > 4294967295.0) { fail(err, errlen, "Bad state header"); return 0; }
  size_t p = 12 + hl; uint32_t cnt; std::memcpy(&cnt, buf + p, 4); p += 4;
  // validate fully before changing anything
  struct R { long long row; size_t at; int k; uint64_t key; int node; };
  // Sparse imports build a replacement off to the side. A malformed final
  // row or an allocation failure cannot consume active dictionary IDs.
  MW staged(&m->arena);
  staged.dense=false;staged.batchDeals=m->batchDeals;staged.budgetBytes=m->budgetBytes;
  if(m->fullGroups.on){
    auto &g=staged.fullGroups;const auto &old=m->fullGroups;
    g.on=true;g.start=old.start;g.nl=old.nl;g.detailed=old.detailed;
    std::copy_n(old.lengths,4,g.lengths);std::copy_n(old.small,8,g.small);
    if(!es::groupStartInto(*m,g,staged.fullStart,staged.bytes,staged.budgetBytes)){fail(err,errlen,"Grouped dictionary exceeds budget");return 0;}
  }
  if(cnt>(len-p)/(m->fullGroups.on?40:41)){fail(err,errlen,"Invalid state row count");return 0;}
  std::vector<R> list; list.reserve(cnt);
  for (uint32_t i = 0; i < cnt; i++) {
    if(m->fullGroups.on){
      if(p+7>len){fail(err,errlen,"Truncated grouped row");return 0;}
      uint32_t node;uint16_t length;memcpy(&node,buf+p,4);memcpy(&length,buf+p+4,2);p+=6;
      if(!length || length>1024 || p+length+1>len || node>=m->nodes.size()){fail(err,errlen,"Invalid grouped row");return 0;}
      std::string key((const char*)buf+p,length);p+=length;int k=buf[p++];
      auto &nd=m->nodes[node];auto &groups=staged.fullGroups;
      if(nd.kind || nd.k!=k || k<2 || p+16*(size_t)k>len){fail(err,errlen,"Invalid grouped actions");return 0;}
      unsigned long long num=0;
      if(groups.detailed){
        int depth=0;for(int j=0;j<groups.nl && groups.lengths[j]<=nd.len;j++)depth++;
        if(key.rfind("0/",0)!=0 || std::count(key.begin(),key.end(),'/')!=depth ||
           key.find_first_not_of("0123456789abcdefghijklmnopqrstuvwxyz:.,/")!=std::string::npos){fail(err,errlen,"Invalid Detailed key");return 0;}
      }else{
        if(length>16 || (length>1 && key[0]=='0') || key.find_first_not_of("0123456789")!=std::string::npos){fail(err,errlen,"Invalid Compact key");return 0;}
        for(char c:key)num=num*10+(unsigned)(c-'0');
        if(num>9007199254740991ULL){fail(err,errlen,"Invalid Compact key");return 0;}
      }
      for(int a=0;a<2*k;a++){double v;memcpy(&v,buf+p+8*a,8);if(!std::isfinite(v)||(a>=k && v<0)){fail(err,errlen,"Invalid grouped values");return 0;}}
      uint32_t id=groups.intern(key,num,staged.bytes,staged.budgetBytes);
      if(id==UINT32_MAX){fail(err,errlen,"Grouped dictionary exceeds budget");return 0;}
      list.push_back({-1,p,k,((uint64_t)node<<32)|id,(int)node});p+=16*(size_t)k;continue;
    }
    if (p + 9 > len) { fail(err, errlen, "Truncated state"); return 0; }
    uint32_t node; uint16_t hand; uint8_t e1, e2, k;
    std::memcpy(&node, buf + p, 4); std::memcpy(&hand, buf + p + 4, 2); e1 = buf[p + 6]; e2 = buf[p + 7]; k = buf[p + 8]; p += 9;
    if (node >= m->nodes.size() || m->nodes[node].kind != 0 || m->nodes[node].k != k || k < 2 || hand >= m->hands[(size_t)m->nodes[node].actor].size() || e1 > 52 || e2 > 52 || p + 16 * (size_t)k > len) { fail(err, errlen, "State does not match this game"); return 0; }
    uint64_t linked=((uint64_t)node<<11)|hand;
    if(!m->startLen) {
      if(p+3+16*(size_t)k>len){fail(err,errlen,"Truncated linked state");return 0;}
      uint8_t cards[5]={e1,e2,buf[p],buf[p+1],buf[p+2]}; p+=3;
      uint64_t seen=0;
      for(int j=0;j<5;j++){
        unsigned c=cards[j]; if(c>52 || (c!=0)!=(j<m->nodes[node].len) || (c && (seen&(1ULL<<c)))){fail(err,errlen,"Bad linked board");return 0;}
        seen|=1ULL<<c; linked=(linked<<6)|c;
      }
    }
    if(m->startLen){
      const auto &nd=m->nodes[node];const auto &range=m->hands[nd.actor];const auto &hole=range[hand];
      if((e1!=0)!=(nd.len>m->startLen) || (e2!=0)!=(nd.len>m->startLen+1) || (e1 && e1==e2) ||
         hole.strategyHand!=hand || (!m->turnGroups.empty() && m->turnGroups[nd.actor][e1*range.size()+hand]!=e1*2048+hand)){
        fail(err,errlen,"Invalid canonical full traversal row");return 0;
      }
      for(int card:{(int)e1-1,(int)e2-1})if(card>=0 && (hole.a==card || hole.b==card || std::find(m->board,m->board+m->startLen,card)!=m->board+m->startLen)){
        fail(err,errlen,"Blocked full traversal row");return 0;
      }
    }
    for (int a = 0; a < 2 * k; a++) { double v; std::memcpy(&v, buf + p + 8 * (size_t)a, 8); if (!std::isfinite(v) || (a >= k && v < 0)) { fail(err, errlen, "State has invalid values"); return 0; } }
    uint64_t key = m->dense ? (uint64_t)(m->nodes[node].rowBase + hand) : (((uint64_t)node << 32) | ((uint64_t)hand << 16) | ((uint64_t)e1 << 8) | e2);
    list.push_back({-1, p, k, m->startLen?key:linked, (int)node}); p += 16 * (size_t)k;
  }
  if (p != len) { fail(err, errlen, "Trailing data in state"); return 0; }
  if(m->dense){
    std::vector<bool> seen(m->rows.size());
    for(const auto &r:list){if(seen[r.key]){fail(err,errlen,"Duplicate strategy row");return 0;}seen[r.key]=true;}
    std::fill(m->vals.begin(),m->vals.end(),0.0);
    for(auto &row:m->rows)row.visited=0;
  }
  MW &target=m->dense?*m:staged;
  for(const auto &r:list){
    long long row=target.getOrCreate(r.key,r.node,r.k);
    if(row<0){fail(err,errlen,"State exceeds the native memory budget");return 0;}
    auto &meta=target.rows[(size_t)row];
    if(meta.visited){fail(err,errlen,"Duplicate strategy row");return 0;}
    std::memcpy(&target.vals[target.off(row)],buf+r.at,16*(size_t)r.k);meta.visited=1;
  }
  if(!m->dense){
    m->rows.swap(staged.rows);m->hkeys.swap(staged.hkeys);m->hrow.swap(staged.hrow);
    m->vals.swap(staged.vals);m->delta.swap(staged.delta);m->touched.clear();
    m->hcount=staged.hcount;m->bytes=staged.bytes;
    if(m->fullGroups.on){m->fullGroups=std::move(staged.fullGroups);m->fullStart=std::move(staged.fullStart);}
  }
  m->iterations = it; m->trainingDeals = deals; m->stateVisits = visits; m->rng.state = (uint32_t)rs; m->limitReached = false;
  return 1;
}

extern "C" int mw_import(MW *m,const unsigned char *buf,size_t len,char *err,int errlen){if(m)m->evCache.clear();
  try{return importState(m,buf,len,err,errlen);}
  catch(const std::bad_alloc &){fail(err,errlen,"Insufficient memory to stage checkpoint import");return 0;}
}

// EMMW4: "EMMW4\0\0\0" | u32 header length | header JSON | u32 state count |
// states x (u32 parent (0xffffffff root) | u8 slot (7 = next street) | u8 kind | u8 actor | u8 street length | u8 actions) |
// u32 row count | rows x (u32 state | u16 hand index | u8 x5 public cards +1 (0 unrevealed, flop sorted) | u8 k | 2k f64)
// rowCrc32 covers everything after the header.
static size_t esExport(MW *m,unsigned char **out,FILE *file,int(*stop)()) {
  const es::StateTable &S = m->es->states;
  JB h; jb_init(&h);
  jb_printf(&h,"{\"protocol\":1,\"specProtocol\":4,\"iterations\":%lld,\"trainingDeals\":%lld,\"stateVisits\":%lld,\"rng\":%u,\"actionRng\":%u,\"studyId\":",m->iterations,m->trainingDeals,m->stateVisits,m->rng.state,m->es->actionRng.state);
  jb_str(&h,m->studyId.c_str());
  const bool rowSync=m->es->dcfr;   // 3.3: DCFR rows end with their u32 discount iteration
  if(rowSync)jb_puts(&h,",\"rowSync\":1");
  const bool rowKeys=m->es->groups.on;   // 3.3: grouped rows carry their key text
  if(rowKeys)jb_puts(&h,",\"rowKeys\":1");
  jb_puts(&h,",\"rowCrc32\":\"00000000\"}");
  if(h.failed || h.n<10){jb_free(&h);return 0;}
  const uint32_t hl=(uint32_t)h.n, sc=(uint32_t)S.parent.size(); uint32_t cnt=0;
  size_t total=20+hl+9ULL*sc;
  for(const auto &row:m->rows)if(row.visited){
    total+=16*(size_t)row.k+(rowSync?4:0)+(rowKeys?7+m->es->groups.text[(size_t)(row.key&((1u<<26)-1))]->size():12);cnt++;}
  if(!out&&!file){jb_free(&h);return total;}
  unsigned char *cursor=nullptr;
  if(out){cursor=*out=(unsigned char*)malloc(total);if(!cursor){jb_free(&h);return 0;}}
  bool ok=true,body=false;uint32_t crc=~0u;
  auto write=[&](const void *p,size_t n){
    if(file){if(ok)ok=fwrite(p,1,n,file)==n;}else{memcpy(cursor,p,n);cursor+=n;}
    if(body)crc=crcUpdate(crc,(const unsigned char*)p,n);
  };
  write("EMMW4\0\0\0",8);write(&hl,4);write(h.s,hl);jb_free(&h);
  body=true;write(&sc,4);
  for(size_t i=0;i<sc;i++){
    if(file && !(i%8192) && (!ok||(stop&&stop())))return 0;
    write(&S.parent[i],4);
    const uint8_t x[]={S.slot[i],S.kind[i],S.actor[i],S.length[i],S.k[i]};write(x,5);
  }
  write(&cnt,4);
  for (size_t r = 0; r < m->rows.size(); r++) {
    if(file && !(r%8192) && (!ok||(stop&&stop())))return 0;
    const MW::RowMeta &rm = m->rows[r]; if (!rm.visited) continue;
    uint32_t state = (uint32_t)(rm.key >> 37); uint16_t hand = (uint16_t)((rm.key >> 26) & 2047); uint8_t cards[5], k = (uint8_t)rm.k;
    if(rowKeys){
      // u32 state | u16 key length | key text | u8 k | values
      const std::string &key=*m->es->groups.text[(size_t)(rm.key&((1u<<26)-1))];const uint16_t kl=(uint16_t)key.size();
      write(&state,4);write(&kl,2);write(key.data(),kl);write(&k,1);write(&m->vals[rm.off],16*(size_t)rm.k);
      if(rowSync)write(&rm.sync,4);
      continue;
    }
    es::decodeCards((uint32_t)(rm.key & ((1u << 26) - 1)), S.length[state], cards);
    write(&state,4);write(&hand,2);write(cards,5);write(&k,1);write(&m->vals[rm.off],16*(size_t)rm.k);
    if(rowSync)write(&rm.sync,4);
  }
  char hex[9];snprintf(hex,sizeof hex,"%08x",~crc);
  if(file){
    if(!ok||fseek(file,(long)(12+hl-10),SEEK_SET)||fwrite(hex,1,8,file)!=8||fflush(file))return 0;
  }else memcpy(*out+12+hl-10,hex,8);
  return total;
}
extern "C" int mw_is_external(const MW *m){return m && bool(m->es);}
extern "C" size_t mw_stream_size(MW *m){return mw_is_external(m)?esExport(m,nullptr,nullptr,nullptr):0;}
extern "C" size_t mw_write_stream(MW *m,FILE *f,int(*stop)()){
  return f&&mw_is_external(m)?esExport(m,nullptr,f,stop):0;
}
static int esImport(MW *m, const unsigned char *buf, size_t len, char *err, int errlen) {
  using namespace es;
  Game &g = *m->es;
  if (len < 20 || std::memcmp(buf, "EMMW4\0\0\0", 8)) { fail(err, errlen, "Not an EMMW4 external-sampling state"); return 0; }
  uint32_t hl; std::memcpy(&hl, buf + 8, 4); if ((size_t)hl + 20 > len) { fail(err, errlen, "Truncated state"); return 0; }
  JV *h = json_parse((const char *)buf + 12, hl, err, errlen); if (!h) return 0;
  {
    char crc[9]; snprintf(crc, sizeof(crc), "%08x", rowChecksum(buf + 12 + hl, len - 12 - hl));
    const char *field = jstr(jget(h, "rowCrc32"));
    if (!field || strcmp(crc, field)) { json_free(h); fail(err, errlen, "State has invalid values (row checksum failed)"); return 0; }
  }
  const char *study = jstr(jget(h, "studyId"));
  if (!m->studyId.empty() && (!study || m->studyId != study)) { json_free(h); fail(err, errlen, "State belongs to a different study"); return 0; }
  for(const char *name:{"iterations","trainingDeals","stateVisits","rng","actionRng"}){
    const JV *v=jget(h,name);
    if(!isInt(v) || v->num<0 || v->num>9007199254740991.0){json_free(h);fail(err,errlen,"Invalid checkpoint counter");return 0;}
  }
  const long long it = (long long)jnum(jget(h, "iterations"), -1), deals = (long long)jnum(jget(h, "trainingDeals"), -1), visits = (long long)jnum(jget(h, "stateVisits"), -1);
  if (it >= 0 && it <= 10000000 && deals != it*m->batchDeals) { json_free(h); fail(err, errlen, "Inconsistent external checkpoint committed deal count"); return 0; }
  const double rs = jnum(jget(h, "rng"), -1), ar = jnum(jget(h, "actionRng"), -1);
  const JV *syncField = jget(h, "rowSync");
  const JV *keysValue = jget(h, "rowKeys"); const bool keysField = keysValue != nullptr;
  const bool rowKeys = keysValue && keysValue->type == J_NUM && keysValue->num == 1;   // read before json_free
  const bool rowSync = syncField && syncField->type == J_NUM && syncField->num == 1;
  const bool syncValid = !syncField || rowSync;
  json_free(h);
  if (!syncValid || rowSync != m->es->dcfr) { fail(err, errlen, "State does not match this study's weighting (DCFR discount rows)"); return 0; }
  if ((keysField && !rowKeys) || rowKeys != m->es->groups.on) { fail(err, errlen, "State does not match this study's hand grouping"); return 0; }
  if (it < 0 || it > 10000000LL || deals < 0 || visits < 0 || !(rs >= 0 && rs <= 4294967295.0) || !(ar >= 0 && ar <= 4294967295.0)) { fail(err, errlen, "Bad state header"); return 0; }
  size_t p = 12 + hl; uint32_t sc; std::memcpy(&sc, buf + p, 4); p += 4;
  if (sc < 1 || sc > (len - p) / 9 || sc >= (1u << 27)) { fail(err, errlen, "Invalid state count"); return 0; }
  std::vector<uint32_t> parent(sc); std::vector<uint8_t> slot(sc), kind(sc), actor(sc), length(sc), kk(sc);
  for (uint32_t i = 0; i < sc; i++) {
    std::memcpy(&parent[i], buf + p, 4); slot[i] = buf[p + 4]; kind[i] = buf[p + 5]; actor[i] = buf[p + 6]; length[i] = buf[p + 7]; kk[i] = buf[p + 8]; p += 9;
    if (i == 0 ? parent[i] != 0xffffffffu : parent[i] >= i) { fail(err, errlen, "States must follow their parent"); return 0; }
  }
  // Replay every state from the rules and require the stored description to match.
  std::vector<std::vector<uint32_t>> kids(sc);
  for (uint32_t i = 1; i < sc; i++) kids[parent[i]].push_back(i);
  {
    std::vector<BS> stack(MAX_DEPTH + 2); std::vector<std::pair<uint32_t, int>> todo{{0u, 0}};
    while (!todo.empty()) {
      auto [id, depth] = todo.back(); todo.pop_back();
      if (depth > MAX_DEPTH) { fail(err, errlen, "State tree too deep"); return 0; }
      BS &s = stack[(size_t)depth];
      if (id == 0) s = g.rootState;
      else {
        const BS &par = stack[(size_t)depth - 1];
        if (slot[id] == CHANCE_SLOT) { if (par.kind != 1) { fail(err, errlen, "State does not match the betting rules"); return 0; } g.rules.nextStreet(par, s); }
        else { if (par.kind != 0 || slot[id] >= par.k) { fail(err, errlen, "State does not match the betting rules"); return 0; } g.rules.advance(par, slot[id], s); }
      }
      if (s.kind == 2 || s.kind != kind[id] || (s.kind == 0 && (s.actor != actor[id] || s.k != kk[id])) || s.length != length[id]) { fail(err, errlen, "State does not match the betting rules"); return 0; }
      // Children must be distinct actions. LIFO order finishes a node's subtree
      // before any sibling reuses its stack slot.
      uint8_t used[8]={};
      for (uint32_t c : kids[id]) { if (slot[c] >= 8 || used[slot[c]]++) { fail(err, errlen, "Duplicate state"); return 0; } }
      for (size_t j = kids[id].size(); j-- > 0;) todo.push_back({kids[id][j], depth + 1});
    }
  }
  if (p + 4 > len) { fail(err, errlen, "Truncated state"); return 0; }
  uint32_t cnt; std::memcpy(&cnt, buf + p, 4); p += 4;
  struct R { uint64_t key; uint32_t state; int k; size_t at; uint32_t sync; };
  std::vector<R> list; if (cnt > (len - p) / 44) { fail(err, errlen, "Invalid row count"); return 0; }
  list.reserve(cnt);
  int board[5]; std::copy_n(m->board, 5, board); std::sort(board, board + std::min(3, m->startLen));
  // 3.3 grouped rows: stage a fresh dictionary (starting-street keys first, as at creation).
  es::GroupKeys stagedGroups; std::vector<std::vector<uint32_t>> stagedStart; double groupBytes = 0;
  if (rowKeys) {
    const es::GroupKeys &G = m->es->groups;
    stagedGroups.on = true; stagedGroups.detailed = G.detailed; stagedGroups.nl = G.nl; stagedGroups.start = G.start;
    std::copy_n(G.lengths, 4, stagedGroups.lengths); std::copy_n(G.small, 8, stagedGroups.small);
    if (!es::groupStartInto(*m, stagedGroups, stagedStart, groupBytes, m->budgetBytes)) { fail(err, errlen, "State exceeds the native memory budget"); return 0; }
  }
  for (uint32_t i = 0; rowKeys && i < cnt; i++) {
    if (p + 7 > len) { fail(err, errlen, "Truncated state"); return 0; }
    uint32_t state; uint16_t kl; std::memcpy(&state, buf + p, 4); std::memcpy(&kl, buf + p + 4, 2); p += 6;
    if (kl < 1 || kl > 1024 || p + kl + 1 > len) { fail(err, errlen, "Invalid grouped row key"); return 0; }
    std::string key((const char *)buf + p, kl); p += kl; const int k = buf[p++];
    if (state >= sc || kind[state] != 0 || kk[state] != k || k < 2 || p + 16 * (size_t)k + (rowSync ? 4 : 0) > len) { fail(err, errlen, "State does not match this game"); return 0; }
    // Key syntax and depth: Detailed keys have one '/'-separated signal per street so far.
    const es::GroupKeys &G = stagedGroups; int depth = -1;
    for (int j = 0; j < G.nl; j++) if (G.lengths[j] == length[state]) depth = j;
    if (depth < 0) { fail(err, errlen, "Invalid grouped row street"); return 0; }
    unsigned long long num = 0;
    if (G.detailed) {
      int slashes = 0; bool ok = key.rfind("0/", 0) == 0;
      for (char ch : key) { if (ch == '/') slashes++; else if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || ch == ':' || ch == '.' || ch == ',')) ok = false; }
      if (!ok || slashes != depth + 1) { fail(err, errlen, "Invalid grouped row key"); return 0; }
    } else {
      if (kl > 16 || (kl > 1 && key[0] == '0')) { fail(err, errlen, "Invalid grouped row key"); return 0; }
      for (char ch : key) { if (ch < '0' || ch > '9') { fail(err, errlen, "Invalid grouped row key"); return 0; } num = num * 10 + (unsigned)(ch - '0'); }
      if (num > 9007199254740991ULL) { fail(err, errlen, "Invalid grouped row key"); return 0; }
    }
    for (int a = 0; a < 2 * k; a++) { double v; std::memcpy(&v, buf + p + 8 * (size_t)a, 8); if (!std::isfinite(v) || (a >= k && v < 0)) { fail(err, errlen, "State has invalid values"); return 0; } }
    const uint32_t id = stagedGroups.intern(key, num, groupBytes, m->budgetBytes);
    if (id == UINT32_MAX) { fail(err, errlen, "State exceeds the native memory budget"); return 0; }
    uint32_t sync = 0;
    if (rowSync) { std::memcpy(&sync, buf + p + 16 * (size_t)k, 4); if ((long long)sync > it) { fail(err, errlen, "Invalid DCFR discount iteration"); return 0; } }
    list.push_back({rowKey(state, 0, id), state, k, p, sync}); p += 16 * (size_t)k + (rowSync ? 4 : 0);
  }
  for (uint32_t i = 0; !rowKeys && i < cnt; i++) {
    if (p + 12 > len) { fail(err, errlen, "Truncated state"); return 0; }
    uint32_t state; uint16_t hand; std::memcpy(&state, buf + p, 4); std::memcpy(&hand, buf + p + 4, 2);
    const uint8_t *cards = buf + p + 6; const int k = buf[p + 11]; p += 12;
    if (state >= sc || kind[state] != 0 || kk[state] != k || k < 2 || hand >= m->hands[actor[state]].size() || p + 16 * (size_t)k > len) { fail(err, errlen, "State does not match this game"); return 0; }
    int c[5]; uint64_t seen = 0; const int L = length[state];
    for (int j = 0; j < 5; j++) {
      if ((cards[j] != 0) != (j < L) || cards[j] > 52) { fail(err, errlen, "Bad public cards"); return 0; }
      c[j] = cards[j] - 1;
      if (cards[j]) { if (seen >> c[j] & 1) { fail(err, errlen, "Bad public cards"); return 0; } seen |= 1ULL << c[j]; }
      if (j < m->startLen && c[j] != board[j]) { fail(err, errlen, "Public cards do not match the board"); return 0; }
    }
    if (L >= 3 && !(c[0] < c[1] && c[1] < c[2])) { fail(err, errlen, "Bad public cards"); return 0; }
    for (int a = 0; a < 2 * k; a++) { double v; std::memcpy(&v, buf + p + 8 * (size_t)a, 8); if (!std::isfinite(v) || (a >= k && v < 0)) { fail(err, errlen, "State has invalid values"); return 0; } }
    if(!m->turnGroups.empty()){
      const int runout=L==5?c[4]+1:0;
      if(m->turnGroups[actor[state]][runout*m->hands[actor[state]].size()+hand]!=runout*2048+hand){
        fail(err,errlen,"Noncanonical turn strategy hand");return 0;
      }
    }
    const auto &hole=m->hands[actor[state]][hand];
    if ((seen & ((1ULL<<hole.a)|(1ULL<<hole.b))) || hole.strategyHand!=hand) { fail(err,errlen,"Blocked or noncanonical strategy hand");return 0; }
    uint32_t sync = 0;
    if (rowSync) {
      if (p + 16 * (size_t)k + 4 > len) { fail(err, errlen, "Truncated state"); return 0; }
      std::memcpy(&sync, buf + p + 16 * (size_t)k, 4);
      if ((long long)sync > it) { fail(err, errlen, "Invalid DCFR discount iteration"); return 0; }
    }
    list.push_back({rowKey(state, hand, cardsCode(c, L)), state, k, p, sync}); p += 16 * (size_t)k + (rowSync ? 4 : 0);
  }
  if (p != len) { fail(err, errlen, "Trailing data in state"); return 0; }
  // Estimate before replacing anything.
  double need = sc * (StateTable::bytesPerState + 12) + 4096 * 12.0 + groupBytes;
  for (const R &r : list) need += 2.0 * r.k * 8 * (m->batchDeals > 1 ? 2 : 1) + sizeof(MW::RowMeta) + 24;
  if (need > m->budgetBytes) { fail(err, errlen, "State exceeds the native memory budget"); return 0; }
  StateTable fresh(&m->arena); double bytes = 0;
  for (uint32_t i = 0; i < sc; i++) if (fresh.add(parent[i], slot[i], kind[i], actor[i], length[i], kk[i], bytes, m->budgetBytes) != (int)i) { fail(err, errlen, "State exceeds the native memory budget"); return 0; }
  MW staged(&m->arena);
  staged.dense=false; staged.batchDeals=m->batchDeals; staged.budgetBytes=m->budgetBytes; staged.bytes=bytes+groupBytes;
  for (const R &r : list) {
    const auto row=staged.getOrCreate(r.key,(int)r.state,r.k);
    if(row<0){fail(err,errlen,"State exceeds the native memory budget");return 0;}
    auto &meta=staged.rows[(size_t)row];
    if(meta.visited){fail(err,errlen,"Duplicate strategy row");return 0;}
    meta.visited=1; meta.sync=r.sync;
    std::memcpy(staged.vals.data()+meta.off,buf+r.at,16*(size_t)r.k);
  }
  g.states=std::move(fresh); g.store.clear();
  if (rowKeys) { g.groups = std::move(stagedGroups); g.startKey = std::move(stagedStart); }
  m->rows.swap(staged.rows); m->hkeys.swap(staged.hkeys); m->hrow.swap(staged.hrow);
  m->vals.swap(staged.vals); m->delta.swap(staged.delta); m->touched.clear();
  m->hcount=staged.hcount;m->bytes=staged.bytes+(double)g.schedule.bytes();
  m->iterations = it; m->trainingDeals = deals; m->stateVisits = visits; m->rng.state = (uint32_t)rs; g.actionRng.state = (uint32_t)ar; m->limitReached = false;
  return 1;
}

// ---------------- 3.1: CUDA probe and exact multiway all-in equity ----------------
static void cudaJson(JB *out, const CudaInfo &i) {
  std::string name, why; for (char c : i.name) if (c != '"' && c != '\\' && (unsigned char)c >= 32) name += c;
  for (char c : i.reason) if (c != '"' && c != '\\' && (unsigned char)c >= 32) why += c;
  jb_printf(out, "{\"available\":%s,\"reason\":\"%s\",\"name\":\"%s\",\"computeCapability\":\"%d.%d\",\"driverVersion\":%d,\"image\":\"%s\",\"totalMiB\":%.0f,\"freeMiB\":%.0f,\"reserveMiB\":%.0f,\"defaultBufferCapMiB\":512}",
    i.available ? "true" : "false", why.c_str(), name.c_str(), i.major, i.minor, i.driver, i.image.c_str(), i.totalBytes / 1048576.0, i.freeBytes / 1048576.0,
    std::max(1024.0, i.totalBytes / 4.0 / 1048576.0));
}
extern "C" void mw_cuda_info(JB *out) { CudaScore d; d.open(); cudaJson(out, d.info); }
static unsigned long long binomial(int x, int r) { if (r < 0 || x < r) return 0; unsigned long long v = 1; for (int i = 0; i < r; i++) v = v * (unsigned long long)(x - i) / (unsigned long long)(i + 1); return v; }
extern "C" int mw_equity(const char *json, size_t len, JB *out, char *err, int errlen) {
  JV *root = json_parse(json, len, err, errlen); if (!root) return 0;
  auto bad = [&](const char *m) { json_free(root); fail(err, errlen, m); return 0; };
  JV *hs = jget(root, "hands"), *bd = jget(root, "board");
  if (!hs || hs->type != J_ARR || hs->n < 2 || hs->n > 8) return bad("Give 2 to 8 hands");
  uint64_t used = 0; std::vector<int> cards;
  for (int p = 0; p < hs->n; p++) { JV *h = hs->items[p]; if (h->type != J_ARR || h->n != 2) return bad("Each hand needs two cards");
    for (int j = 0; j < 2; j++) { int c = (int)jnum(h->items[j], -1); if (c < 0 || c > 51 || (used >> c & 1)) return bad("Invalid or duplicate card"); used |= 1ULL << c; cards.push_back(c); } }
  std::vector<int> board;
  if (bd) { if (bd->type != J_ARR || bd->n > 5 || bd->n == 1 || bd->n == 2) return bad("Board must have 0, 3, 4 or 5 cards");
    for (int j = 0; j < bd->n; j++) { int c = (int)jnum(bd->items[j], -1); if (c < 0 || c > 51 || (used >> c & 1)) return bad("Invalid or duplicate card"); used |= 1ULL << c; board.push_back(c); } }
  const char *dv = jstr(jget(root, "device")); std::string device = dv ? dv : "cpu";
  if (device != "cpu" && device != "gpu" && device != "both") return bad("device must be cpu, gpu or both");
  int threads = (int)jnum(jget(root, "threads"), 1); threads = std::clamp(threads, 1, 256);
  double gpuMiB = jnum(jget(root, "gpuMiB"), 512); if (!(gpuMiB >= 1 && gpuMiB <= 8192)) return bad("gpuMiB must be 1 to 8192");
  json_free(root);
  const int n = (int)cards.size() / 2, need = 5 - (int)board.size();
  std::vector<int> deck; for (int c = 0; c < 52; c++) if (!(used >> c & 1)) deck.push_back(c);
  const unsigned long long combos = binomial((int)deck.size(), need);
  std::vector<unsigned long long> binom(53 * 6); for (int x = 0; x <= 52; x++) for (int r = 0; r <= 5; r++) binom[(size_t)x * 6 + r] = binomial(x, r);
  auto clk = [] { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); };
  unsigned long long cpu[9] = {0}, gpu[9] = {0}; double cpuSec = -1, gpuSec = -1; bool gpuOk = false; size_t peak = 0; CudaInfo info;
  auto runCpu = [&] {
    double t = clk(); std::vector<std::array<unsigned long long, 9>> part((size_t)threads); std::vector<std::thread> pool;
    for (int w = 0; w < threads; w++) pool.emplace_back([&, w] {
      auto &acc = part[(size_t)w]; acc.fill(0);
      for (unsigned long long index = (unsigned long long)w; index < combos; index += (unsigned long long)threads) {
        int b[5]; for (size_t j = 0; j < board.size(); j++) b[j] = board[j];
        unsigned long long rest = index;
        for (int r = need; r >= 1; --r) { int x = r - 1; while (x + 1 < (int)deck.size() && binomial(x + 1, r) <= rest) ++x; rest -= binomial(x, r); b[board.size() + (size_t)r - 1] = deck[(size_t)x]; }
        int best = -1, winners = 0, sc[8];
        for (int p = 0; p < n; p++) { sc[p] = evalSeven(b, cards[(size_t)2 * p], cards[(size_t)2 * p + 1]); if (sc[p] > best) { best = sc[p]; winners = 1; } else if (sc[p] == best) winners++; }
        for (int p = 0; p < n; p++) if (sc[p] == best) acc[(size_t)p] += 840u / (unsigned)winners;
        acc[8]++;
      }
    });
    for (auto &th : pool) th.join();
    for (auto &a : part) for (int i = 0; i < 9; i++) cpu[i] += a[(size_t)i];
    cpuSec = clk() - t;
  };
  if (device != "cpu") {
    CudaScore d;
    if (d.open()) {
      std::vector<unsigned char> spec{(unsigned char)n, (unsigned char)board.size(), (unsigned char)deck.size()};
      for (int c : cards) spec.push_back((unsigned char)c);
      for (int c : board) spec.push_back((unsigned char)c);
      for (int c : deck) spec.push_back((unsigned char)c);
      double t = clk(); gpuOk = d.equity(spec, binom, combos, gpu, (size_t)(gpuMiB * 1048576), peak); gpuSec = clk() - t;
    }
    info = d.info;
  }
  std::string gpuError;
  if (device != "cpu" && !gpuOk) gpuError = info.available ? "GPU task failed (allocation, VRAM reserve, launch or copy); CPU result reported" : "CUDA unavailable: " + info.reason;
  if (device != "gpu" || !gpuOk) runCpu();
  const unsigned long long *ref = device == "gpu" && gpuOk ? gpu : cpu;
  jb_printf(out, "{\"players\":%d,\"boards\":%llu,\"equity\":[", n, combos);
  for (int p = 0; p < n; p++) { if (p) jb_putc(out, ','); jb_num(out, (double)ref[p] / (840.0 * (double)combos), 9); }
  jb_puts(out, "],\"shareUnits\":[");
  for (int p = 0; p < n; p++) { if (p) jb_putc(out, ','); jb_printf(out, "%llu", ref[p]); }
  jb_printf(out, "],\"cpuSeconds\":%.6f,\"cpuThreads\":%d,\"gpuSeconds\":%.6f,\"gpuUsed\":%s", cpuSec, threads, gpuSec, gpuOk ? "true" : "false");
  if (device == "both" && gpuOk) { bool same = true; for (int i = 0; i < n; i++) same &= cpu[i] == gpu[i]; same &= cpu[8] == gpu[8]; jb_printf(out, ",\"gpuMatchesCpu\":%s", same ? "true" : "false"); }
  jb_printf(out, ",\"gpuBufferPeakBytes\":%zu", peak);
  if (!gpuError.empty()) jb_printf(out, ",\"gpuFallbackReason\":\"%s\"", gpuError.c_str());
  if (device != "cpu") { jb_puts(out, ",\"cuda\":"); cudaJson(out, info); }
  jb_putc(out, '}');
  return 1;
}

#include "checkpoint_native.hpp"
