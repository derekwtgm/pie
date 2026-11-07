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

struct Hand { int id, a, b; double w, cum; };
struct Pot { double amount; std::vector<int> eligible; };
struct Node {
  int kind = 0;         // 0 player, 1 chance, 2 terminal
  int actor = -1, len = 0, k = 0;
  int child0 = 0;       // index into children
  int term = -1;        // terminal index
  long long rowBase = -1; // dense tables
};
struct Terminal { std::vector<double> total; std::vector<Pot> pots; };

struct World { int seat[8]; int cards[5]; int score[8]; };
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
  std::vector<double> u, av, sig;   // per depth: n, kmax, kmax
  std::vector<double> reach;
};

} // namespace

struct MW {
  int n = 0, startLen = 5, kmax = 1, maxDepth = 1;
  int board[5] = {0, 0, 0, 0, 0};
  std::vector<std::vector<Hand>> hands;
  std::vector<double> total;         // per seat cumulative weight
  std::vector<double> anteOf;
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
  std::vector<double> vals, delta;
  struct RowMeta { uint64_t key; int node; int k; size_t off; uint8_t visited, marked; };
  std::vector<RowMeta> rows;
  std::vector<int64_t> hkeys; std::vector<int32_t> hrow; size_t hcount = 0; // hash: key -> row
  std::vector<int32_t> touched;
  double budgetBytes = 0, bytes = 0;
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
    if (bytes + extra > budgetBytes) return false;
    std::vector<int64_t> k2(cap, -1); std::vector<int32_t> r2(cap, -1);
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
    rows.push_back({key, node, k, off, 0, 0});
    size_t mask = hkeys.size() - 1, i = mix(key) & mask;
    while (hkeys[i] != -1) i = (i + 1) & mask;
    hkeys[i] = (int64_t)key; hrow[i] = (int32_t)(rows.size() - 1); hcount++; bytes += extra;
    return (long long)rows.size() - 1;
  }
  uint64_t keyOf(const World &w, int node, int seat) const {
    const Node &nd = nodes[node];
    if (dense) return (uint64_t)(nd.rowBase + w.seat[seat]);
    int e1 = nd.len > startLen ? w.cards[startLen] + 1 : 0, e2 = nd.len > startLen + 1 ? w.cards[startLen + 1] + 1 : 0;
    return ((uint64_t)node << 32) | ((uint64_t)w.seat[seat] << 16) | ((uint64_t)e1 << 8) | (uint64_t)e2;
  }

  // ---- deals ----
  bool deal(World &w) {
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
      score(w);
      return true;
    }
    return false;
  }

  void score(World &w) const { for (int p = 0; p < n; p++) { const Hand &h = hands[(size_t)p][(size_t)w.seat[p]]; w.score[p] = evalSeven(w.cards, h.a, h.b); } }
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
      for (int p = 0; p < n; p++) u[p] = -t.total[p] - anteOf[p];
      for (const Pot &pot : t.pots) {
        double top = -INFINITY; int count = 0;
        for (int p : pot.eligible) { double v = w.score[p]; if (v > top) { top = v; count = 1; } else if (v == top) count++; }
        for (int p : pot.eligible) if (w.score[p] == top) u[p] += pot.amount / count;
      }
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
    Scratch s; s.u.assign((size_t)(maxDepth + 2) * n, 0); s.av.assign((size_t)(maxDepth + 2) * kmax, 0);
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
    for (;;) { size_t d = lo + (size_t)next.fetch_add(1); if (d >= hi) break; m->runDeal((*work)[d], scratch[(size_t)index], step); }
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
  bool start(MW *mm, int t) {
    m = mm; threads = t; scratch.clear();
    for (int i = 0; i < t; i++) scratch.push_back(m->makeScratch());
    args.resize((size_t)t); ids.resize((size_t)t);
    for (int i = 1; i < t; i++) {
      args[(size_t)i] = {this, i};
      if (pthread_create(&ids[(size_t)i], nullptr, &Pool::main, &args[(size_t)i])) { threads = i; break; }
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

extern "C" MW *mw_create(const char *json, size_t len, double memoryMiB, char *err, int errlen) {
  JV *root = json_parse(json, len, err, errlen);
  if (!root) return nullptr;
  MW *m = new (std::nothrow) MW();
  if (!m) { json_free(root); fail(err, errlen, "Out of memory"); return nullptr; }
  auto bad = [&](const char *msg) -> MW * { json_free(root); delete m; fail(err, errlen, msg); return nullptr; };
  try {
    if (jnum(jget(root, "protocol"), 0) != MW_PROTOCOL) return bad("Unsupported native protocol version");
    JV *nv = jget(root, "n"); if (!isInt(nv) || nv->num < 2 || nv->num > 8) return bad("Native engine needs 2 to 8 seats");
    m->n = (int)nv->num;
    JV *bd = jget(root, "board"); if (!bd || bd->type != J_ARR || bd->n < 3 || bd->n > 5) return bad("Native engine needs a 3-5 card board");
    m->startLen = bd->n;
    uint8_t onBoard[52] = {0};
    for (int i = 0; i < bd->n; i++) { if (!isInt(bd->items[i]) || bd->items[i]->num < 0 || bd->items[i]->num > 51) return bad("Bad board card"); m->board[i] = (int)bd->items[i]->num; if (onBoard[m->board[i]]++) return bad("Duplicate board card"); }
    JV *hs = jget(root, "hands"); if (!hs || hs->type != J_ARR || hs->n != m->n) return bad("Hands do not match the seats");
    m->hands.resize((size_t)m->n); m->total.assign((size_t)m->n, 0);
    for (int p = 0; p < m->n; p++) {
      JV *r = hs->items[p]; if (r->type != J_ARR || r->n < 1 || r->n > 1326) return bad("Bad range");
      double tot = 0;
      for (int i = 0; i < r->n; i++) {
        JV *h = r->items[i]; if (h->type != J_ARR || h->n != 4) return bad("Bad hand");
        for (int q = 0; q < 3; q++) if (!isInt(h->items[q])) return bad("Bad hand");
        Hand x{(int)h->items[0]->num, (int)h->items[1]->num, (int)h->items[2]->num, h->items[3]->num, 0};
        if (x.id < 0 || x.id > 1325 || x.a < 0 || x.a > 51 || x.b < 0 || x.b > 51 || x.a == x.b || !(x.w > 0) || !std::isfinite(x.w)) return bad("Bad hand");
        if (onBoard[x.a] || onBoard[x.b]) continue;   // dealer() drops board-blocked hands
        tot += x.w; x.cum = tot; m->hands[(size_t)p].push_back(x);
      }
      if (m->hands[(size_t)p].empty()) return bad("A range is blocked on this board");
      m->total[(size_t)p] = tot;
    }
    JV *an = jget(root, "anteOf"); m->anteOf.assign((size_t)m->n, 0);
    if (an && an->type == J_ARR && an->n == m->n) for (int p = 0; p < m->n; p++) m->anteOf[(size_t)p] = jnum(an->items[p], 0);
    JV *nd = jget(root, "nodes"); if (!nd || nd->type != J_ARR || nd->n < 1 || nd->n > 2000000) return bad("Bad tree");
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
        o.len = (int)jnum(x->items[1], 0); o.child0 = (int)m->children.size(); m->children.push_back((int)x->items[2]->num);
      } else if (o.kind == 2) {
        if (x->n != 3 || x->items[1]->type != J_ARR || x->items[1]->n != m->n || x->items[2]->type != J_ARR) return bad("Bad terminal");
        Terminal t; for (int p = 0; p < m->n; p++) t.total.push_back(jnum(x->items[1]->items[p], 0));
        for (int q = 0; q < x->items[2]->n; q++) {
          JV *pt = x->items[2]->items[q]; if (pt->type != J_ARR || pt->n != 2 || pt->items[1]->type != J_ARR) return bad("Bad pot");
          Pot pot; pot.amount = jnum(pt->items[0], 0);
          for (int e = 0; e < pt->items[1]->n; e++) { int s = (int)jnum(pt->items[1]->items[e], -1); if (s < 0 || s >= m->n) return bad("Bad pot seat"); pot.eligible.push_back(s); }
          if (!std::isfinite(pot.amount) || pot.eligible.empty()) return bad("Bad pot");
          t.pots.push_back(pot);
        }
        o.term = (int)m->terms.size(); m->terms.push_back(t);
      } else return bad("Unknown node kind");
    }
    // depth (children follow parents, so a reverse pass computes heights)
    std::vector<int> height((size_t)nd->n, 0);
    for (int i = nd->n - 1; i >= 0; i--) {
      Node &o = m->nodes[(size_t)i]; int h = 0;
      int cnt = o.kind == 0 ? o.k : o.kind == 1 ? 1 : 0;
      for (int a = 0; a < cnt; a++) h = std::max(h, height[(size_t)m->children[(size_t)(o.child0 + a)]] + 1);
      height[(size_t)i] = h;
    }
    m->maxDepth = height[0] + 1;
    m->batchDeals = (int)jnum(jget(root, "batchDeals"), 1);
    if (m->batchDeals < 1 || m->batchDeals > 64) return bad("Batch deals must be 1 to 64");
    const char *up = jstr(jget(root, "updates"));
    if (up && !strcmp(up, "alternating")) m->updates = 1; else if (up && !strcmp(up, "enumerate")) m->updates = 2;
    else if (up && strcmp(up, "simultaneous")) return bad("Unknown update scheme");
    const char *wt = jstr(jget(root, "weighting")); m->linear = !wt || !strcmp(wt, "linear");
    m->dcfr = wt && !strcmp(wt, "dcfr");
    if (wt && strcmp(wt, "linear") && strcmp(wt, "uniform") && strcmp(wt, "dcfr")) return bad("Unknown weighting");
    if (m->dcfr) { m->dA = jnum(jget(root, "dcfrAlpha"), 1.5); m->dB = jnum(jget(root, "dcfrBeta"), 0); m->dG = jnum(jget(root, "dcfrGamma"), 2); }
    const char *rm = jstr(jget(root, "regretMatching")); m->plus = rm && !strcmp(rm, "plus");
    if (rm && strcmp(rm, "plus") && strcmp(rm, "standard")) return bad("Unknown regret matching");
    JV *st = jget(root, "state");
    if (st) {
      m->rng.state = (uint32_t)jnum(jget(st, "rng"), 17);
      m->iterations = (long long)jnum(jget(st, "iterations"), 0);
      m->trainingDeals = (long long)jnum(jget(st, "trainingDeals"), 0);
      m->stateVisits = (long long)jnum(jget(st, "stateVisits"), 0);
    }
    if (m->iterations < 0 || m->iterations > 10000000LL) return bad("Bad iteration count");
    // tables
    m->budgetBytes = memoryMiB * 1048576.0;
    m->dense = m->startLen == 5;
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
  if (iterations < 0 || m->iterations + iterations > 10000000LL) { fail(err, errlen, "Iteration count must fit the 10 million iteration limit"); return 0; }
  if (threads < 1) threads = 1;
  if (threads > 256) threads = 256;
  if (m->updates == 0 && threads > m->batchDeals) threads = m->batchDeals;   // more threads than deals per update cannot help
  m->lastThreads = threads;
  Pool pool;
  try {
    std::vector<DealWork> work; work.reserve((size_t)m->batchDeals * 64);
    std::vector<DealWork> phaseWork;
    pool.start(m, threads);
    const int B = m->batchDeals;
    double avgVisits = 1e9;   // unknown before the first update: allow threads
    for (long long it = 0; it < iterations && !m->limitReached; it++) {
      if (stop && *stop) break;
      double step = m->linear ? (double)(m->iterations + 1) : 1.0;
      // Draw every deal of this update first, in the JavaScript order (deals do not
      // depend on the policy). Units of one phase share one frozen policy.
      auto clk = [] { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); };
      double tA = clk();
      size_t units = 0; bool ok = true;
      auto unit = [&](const World &w, int seat, double weight, int phase) {
        if (units >= work.size()) work.emplace_back();
        DealWork &u = work[units++]; u.w = w; u.seat = seat; u.weight = weight; u.phase = phase;
      };
      for (int d = 0; d < B && ok; d++) {
        World w0; if (!m->deal(w0)) { ok = false; break; } m->trainingDeals++;
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
            World x = w; x.seat[p] = (int)hi; m->score(x); unit(x, p, h.w / tot, phase);
          }
        }
      }
      if (!ok) { pool.stop(); fail(err, errlen, "Compatible hands are too rare to sample reliably. Review overlapping ranges or use exact deals."); return 0; }
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
        double tC = clk(); m->secTraverse += tC - tB;
        // Parallel merge (dense tables, several deals per update): thread i applies the
        // rows in its contiguous block of the table, scanning deals in order, so every value receives its
        // increments in exactly the sequential order.
        if (B > 1 && m->dense && pool.threads > 1 && estimate >= 60000.0) {
          struct Ctx { MW *m; std::vector<DealWork> *w; size_t first, last; int T, B; std::atomic<int> bad{0}; } ctx{m, &work, first, last, pool.threads, B};
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
          }, &ctx, work);
          if (ctx.bad) { pool.stop(); fail(err, errlen, "Non-finite sampled CFR increment"); return 0; }
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
        m->limitReached = true; break;
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
  pool.stop();
  if (progress) progress(ctx, m->iterations, m->trainingDeals);
  return 1;
}

// EMMW1: "EMMW1\0\0\0", u32 header length, header JSON, u32 row count, then per row:
// u32 node, u16 hand index, u8 extra card 1 (+1, 0 none), u8 extra card 2, u8 k, then 2k float64.
static void put(std::vector<unsigned char> &b, const void *p, size_t n) { const unsigned char *c = (const unsigned char *)p; b.insert(b.end(), c, c + n); }
extern "C" void mw_info(MW *m, JB *out) {
  size_t visited = 0; for (auto &r : m->rows) visited += r.visited;
  jb_printf(out, "{\"protocol\":%d,\"iterations\":%lld,\"trainingDeals\":%lld,\"stateVisits\":%lld,\"rng\":%u,\"rows\":%zu,\"tableMiB\":", MW_PROTOCOL, m->iterations, m->trainingDeals, m->stateVisits, m->rng.state, visited);
  jb_num(out, m->bytes / 1048576.0, 3);
  jb_printf(out, ",\"limitReached\":%s,\"threads\":%d,\"batchDeals\":%d,\"seconds\":{\"deal\":%.4f,\"traverse\":%.4f,\"merge\":%.4f}}", m->limitReached ? "true" : "false", m->lastThreads, m->batchDeals, m->secDeal, m->secTraverse, m->secMerge);
}
extern "C" size_t mw_export(MW *m, unsigned char **out) {
  std::vector<unsigned char> b; put(b, "EMMW1\0\0\0", 8);
  JB h; jb_init(&h); mw_info(m, &h); uint32_t hl = (uint32_t)h.n; put(b, &hl, 4); put(b, h.s, h.n); jb_free(&h);
  uint32_t cnt = 0; size_t at = b.size(); put(b, &cnt, 4);
  for (size_t r = 0; r < m->rows.size(); r++) {
    const MW::RowMeta &rm = m->rows[r]; if (!rm.visited) continue;
    uint32_t node = (uint32_t)rm.node; uint16_t hand; uint8_t e1 = 0, e2 = 0, k = (uint8_t)rm.k;
    if (m->dense) hand = (uint16_t)(rm.key - (uint64_t)m->nodes[(size_t)rm.node].rowBase);
    else { hand = (uint16_t)((rm.key >> 16) & 0xffff); e1 = (uint8_t)((rm.key >> 8) & 0xff); e2 = (uint8_t)(rm.key & 0xff); }
    put(b, &node, 4); put(b, &hand, 2); put(b, &e1, 1); put(b, &e2, 1); put(b, &k, 1);
    put(b, &m->vals[m->off((long long)r)], 16 * (size_t)rm.k); cnt++;
  }
  std::memcpy(&b[at], &cnt, 4);
  *out = (unsigned char *)malloc(b.size()); if (!*out) return 0;
  std::memcpy(*out, b.data(), b.size()); return b.size();
}
extern "C" int mw_import(MW *m, const unsigned char *buf, size_t len, char *err, int errlen) {
  if (len < 16 || std::memcmp(buf, "EMMW1\0\0\0", 8)) { fail(err, errlen, "Not an EMMW1 state"); return 0; }
  uint32_t hl; std::memcpy(&hl, buf + 8, 4); if ((size_t)hl + 16 > len) { fail(err, errlen, "Truncated state"); return 0; }
  JV *h = json_parse((const char *)buf + 12, hl, err, errlen); if (!h) return 0;
  long long it = (long long)jnum(jget(h, "iterations"), -1), deals = (long long)jnum(jget(h, "trainingDeals"), -1), visits = (long long)jnum(jget(h, "stateVisits"), -1);
  double rs = jnum(jget(h, "rng"), -1); json_free(h);
  if (it < 0 || it > 10000000LL || deals < 0 || visits < 0 || rs < 0 || rs > 4294967295.0) { fail(err, errlen, "Bad state header"); return 0; }
  size_t p = 12 + hl; uint32_t cnt; std::memcpy(&cnt, buf + p, 4); p += 4;
  // validate fully before changing anything
  struct R { long long row; size_t at; int k; uint64_t key; int node; };
  std::vector<R> list; list.reserve(cnt);
  for (uint32_t i = 0; i < cnt; i++) {
    if (p + 9 > len) { fail(err, errlen, "Truncated state"); return 0; }
    uint32_t node; uint16_t hand; uint8_t e1, e2, k;
    std::memcpy(&node, buf + p, 4); std::memcpy(&hand, buf + p + 4, 2); e1 = buf[p + 6]; e2 = buf[p + 7]; k = buf[p + 8]; p += 9;
    if (node >= m->nodes.size() || m->nodes[node].kind != 0 || m->nodes[node].k != k || k < 2 || hand >= m->hands[(size_t)m->nodes[node].actor].size() || e1 > 52 || e2 > 52 || p + 16 * (size_t)k > len) { fail(err, errlen, "State does not match this game"); return 0; }
    for (int a = 0; a < 2 * k; a++) { double v; std::memcpy(&v, buf + p + 8 * (size_t)a, 8); if (!std::isfinite(v) || (a >= k && v < 0)) { fail(err, errlen, "State has invalid values"); return 0; } }
    uint64_t key = m->dense ? (uint64_t)(m->nodes[node].rowBase + hand) : (((uint64_t)node << 32) | ((uint64_t)hand << 16) | ((uint64_t)e1 << 8) | e2);
    list.push_back({-1, p, k, key, (int)node}); p += 16 * (size_t)k;
  }
  if (p != len) { fail(err, errlen, "Trailing data in state"); return 0; }
  for (R &r : list) {
    long long row = m->getOrCreate(r.key, r.node, r.k);
    if (row < 0) { fail(err, errlen, "State exceeds the native memory budget"); return 0; }
    std::memcpy(&m->vals[m->off(row)], buf + r.at, 16 * (size_t)r.k); m->rows[(size_t)row].visited = 1;
  }
  m->iterations = it; m->trainingDeals = deals; m->stateVisits = visits; m->rng.state = (uint32_t)rs; m->limitReached = false;
  return 1;
}
