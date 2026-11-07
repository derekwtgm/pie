// EightMax 3.1: external-sampling training, EMMW4 state export/import and the
// protocol-4 spec parser. Included by mw.cpp after struct MW (see mw_es.hpp).
#pragma once
#include <climits>
namespace {
namespace es {
constexpr int TERMINAL_REF = INT_MAX;
struct Walker {
  const MW &m; const Game &g;
  Unit *u = nullptr; Rng *rng = nullptr; int player = 0; double step = 1;
  std::vector<BS> st; std::vector<double> sig, samp, val;
  Tournament::Workspace icm; double util[8] = {}; LPot pots[24];
  Walker(const MW &mm, const Game &gg) : m(mm), g(gg) {
    st.resize(MAX_DEPTH + 2); sig.resize((MAX_DEPTH + 2) * 8); samp.resize((MAX_DEPTH + 2) * 8); val.resize((MAX_DEPTH + 2) * 8);
    if (!m.tournament.start.empty()) { icm.cache.resize(127); icm.probability.resize(1u << m.tournament.start.size()); }
  }
  int child(int ref, int slot, const BS &c) {
    if (c.kind == 2) return TERMINAL_REF;
    if (ref >= 0) { int id = g.states.find((uint32_t)ref, slot); if (id >= 0) return id; }
    u->pending.push_back({ref, slot, (uint8_t)c.kind, (uint8_t)std::max(0, c.actor), (uint8_t)c.length, (uint8_t)c.k});
    return -(int)u->pending.size();
  }
  void policy(int ref, int k, int hand, uint32_t code, double *s) const {
    long long r = ref >= 0 ? m.findRow(rowKey((uint32_t)ref, hand, code)) : -1;
    double tot = 0;
    for (int a = 0; a < k; a++) { s[a] = r >= 0 ? jsMax0(m.vals[m.rows[(size_t)r].off + (size_t)a]) : 0; tot += s[a]; }
    for (int a = 0; a < k; a++) s[a] = tot ? s[a] / tot : 1.0 / k;
  }
  const double *payoff(const BS &t) {
    const int n = m.n, np = g.rules.pots(t, pots);
    const bool tour = !m.tournament.start.empty();
    for (int p = 0; p < n; p++) util[p] = tour ? t.behind[p] : -t.total[p] - m.anteOf[(size_t)p];
    for (int q = 0; q < np; q++) {
      const LPot &pot = pots[q]; double top = -INFINITY; int count = 0;
      for (int j = 0; j < pot.count; j++) { int e = pot.seat[j]; if (e >= n) continue; double v = u->w.score[e]; if (v > top) { top = v; count = 1; } else if (v == top) count++; }
      if (!count) continue;
      const double share = pot.amount / count;
      for (int j = 0; j < pot.count; j++) { int e = pot.seat[j]; if (e < n && u->w.score[e] == top) util[e] += share; }
    }
    if (tour) m.tournament.evaluate(util, n, icm);
    return util;
  }
  static int choose(const double *q, int k, Rng &r) {
    const double value = r.next(); double cumulative = 0;
    for (int a = 0; a < k; a++) { cumulative += q[a]; if (value < cumulative) return a; }
    return k - 1;
  }
  // lib_wide.js learn(): returns the sampled value for `player`.
  double learn(int d, int ref, double own, double opp, double sp) {
    u->visits++;
    BS &t = st[(size_t)d];
    if (t.kind == 2) return payoff(t)[player];
    if (d + 1 >= MAX_DEPTH || u->overflow) { u->overflow = true; return 0; }
    BS &c = st[(size_t)d + 1];
    if (t.kind == 1) { g.rules.nextStreet(t, c); return learn(d + 1, child(ref, CHANCE_SLOT, c), own, opp, sp); }
    const int k = t.k;
    if (k == 1) { g.rules.advance(t, 0, c); return learn(d + 1, child(ref, 0, c), own, opp, sp); }
    double *s = &sig[(size_t)d * 8], *q = &samp[(size_t)d * 8], *v = &val[(size_t)d * 8];
    const int hand = u->w.seat[t.actor]; const uint32_t code = u->code[t.length];
    policy(ref, k, hand, code, s);
    if (t.actor != player) {
      for (int b = 0; b < k; b++) q[b] = 0.9 * s[b] + 0.1 / k;
      const int a = choose(q, k, *rng);
      g.rules.advance(t, a, c);
      const double ratio = s[a] / q[a];
      return ratio * learn(d + 1, child(ref, a, c), own, opp * s[a], sp * q[a]);
    }
    const size_t off = u->vals.size();
    if ((off + 2 * (size_t)k) * 8 > g.unitLimitBytes) { u->overflow = true; return 0; }
    u->incs.push_back({ref, hand, code, k, off}); u->vals.resize(off + 2 * (size_t)k);
    double mean = 0;
    for (int a = 0; a < k; a++) {
      u->vals[off + (size_t)(k + a)] = step * own * s[a] / sp;
      g.rules.advance(t, a, c);
      v[a] = learn(d + 1, child(ref, a, c), own * s[a], opp, sp);
      mean += s[a] * v[a];
    }
    for (int a = 0; a < k; a++) u->vals[off + (size_t)a] = step * opp / sp * (v[a] - mean);
    return mean;
  }
  void run(Unit &unit, int seat, Rng &r, double stp) {
    u = &unit; rng = &r; player = seat; step = stp;
    st[0] = g.rootState;
    learn(0, 0, 1, 1, 1);
  }
};
inline void codes(Unit &u, int n) {
  (void)n; for (int L : {0, 3, 4, 5}) u.code[L] = cardsCode(u.w.cards, L);
}
// 1: ok, 0: budget, -1: non-finite
inline int merge(MW &m, Game &g, Unit &u, bool immediate) {
  std::vector<int> resolved(u.pending.size(), -1);
  for (size_t i = 0; i < u.pending.size(); i++) {
    const Pending &p = u.pending[i];
    const int par = p.parentRef >= 0 ? p.parentRef : resolved[(size_t)(-p.parentRef - 1)];
    if (par < 0) return 0;
    int id = g.states.find((uint32_t)par, p.slot);
    if (id < 0) id = g.states.add((uint32_t)par, p.slot, p.kind, p.actor, p.length, p.k, m.bytes, m.budgetBytes);
    if (id < 0) return 0;
    resolved[i] = id;
  }
  const int B = m.batchDeals;
  for (const Inc &inc : u.incs) {
    const int sid = inc.ref >= 0 ? inc.ref : resolved[(size_t)(-inc.ref - 1)];
    const long long r = m.getOrCreate(rowKey((uint32_t)sid, inc.hand, inc.code), sid, inc.k);
    if (r < 0) return 0;
    MW::RowMeta &rm = m.rows[(size_t)r]; rm.visited = 1;
    const size_t o = rm.off; const double *x = &u.vals[inc.off]; const int k = inc.k;
    for (int a = 0; a < 2 * k; a++) if (!std::isfinite(x[a])) return -1;
    if (immediate) {
      for (int a = 0; a < k; a++) {
        double v = m.vals[o + (size_t)a] + 0.0; if (m.plus) v = jsMax0(v);
        v = v + x[a]; if (m.plus) v = jsMax0(v);
        m.vals[o + (size_t)a] = v;
        m.vals[o + (size_t)(k + a)] = (m.vals[o + (size_t)(k + a)] + x[k + a]) + 0.0;
      }
    } else {
      if (!rm.marked) { rm.marked = 1; m.touched.push_back((int32_t)r); }
      for (int a = 0; a < k; a++) {
        double &dr = m.delta[o + (size_t)a], &da = m.delta[o + (size_t)(k + a)];
        dr = (dr + 0.0 / B) + x[a] / B;
        da = (da + x[k + a] / B) + 0.0 / B;
      }
    }
  }
  return 1;
}
inline double now() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
inline int train(MW *m, long long iterations, int threads, volatile int *stop, mw_progress_fn progress, void *ctx, char *err, int errlen) {
  Game &g = *m->es;
  const int B = m->batchDeals, n = m->n;
  const bool parallel = B > 1 && g.perDealStreams;
  const int T = parallel ? std::max(1, std::min(threads, B)) : 1;
  m->lastThreads = T;
  auto failMsg = [&](const char *msg) { if (err && errlen > 0) snprintf(err, (size_t)errlen, "%s", msg); return 0; };
  try {
    Workers pool(T);
    std::vector<std::unique_ptr<Walker>> walkers;
    for (int i = 0; i < T; i++) walkers.emplace_back(new Walker(*m, g));
    std::vector<Unit> units((size_t)B);
    // Waking helper threads costs tens of microseconds. A batch is split only
    // when the previous batch's measured state visits make it worthwhile.
    // Results are identical either way.
    double visitsPerDeal = 1e9;
    g.unitLimitBytes = (size_t)std::clamp(m->budgetBytes / 4 / T, 16.0 * 1048576, 1024.0 * 1048576);
    for (long long it = 0; it < iterations && !m->limitReached; it++) {
      if (stop && __atomic_load_n(stop, __ATOMIC_RELAXED)) break;
      const double step = m->linear ? (double)(m->iterations + 1) : 1.0;
      double t0 = now();
      for (int d = 0; d < B; d++) {
        Unit &u = units[(size_t)d]; u.clear();
        if (!m->deal(u.w)) return failMsg("Compatible hands are too rare to sample reliably. Review overlapping ranges or use exact deals.");
        m->trainingDeals++; m->score(u.w); codes(u, n);
      }
      double t1 = now(); g.secDeal += t1 - t0;
      long long visits = 0; int status = 1;
      if (B == 1) {
        Unit &u = units[0];
        Rng own{deriveSeed(g.actionSeed, m->iterations, 0)};
        Rng &r = g.perDealStreams ? own : g.actionRng;
        for (int p = 0; p < n && status == 1; p++) {
          double a = now();
          u.pending.clear(); u.incs.clear(); u.vals.clear();
          walkers[0]->run(u, p, r, step);
          double b = now(); g.secTraverse += b - a;
          if (u.overflow) return failMsg("One sampled traversal exceeds the native transient memory limit. Use fewer bet sizes or a larger budget.");
          status = merge(*m, g, u, true); visits += u.visits; u.visits = 0;
          g.secMerge += now() - b;
        }
      } else {
        std::atomic<int> next{0}; std::atomic<bool> oom{false};
        auto job = [&](int index) {
          try {
            for (;;) {
              const int d = parallel ? next.fetch_add(1) : next++;
              if (d >= B) break;
              Unit &u = units[(size_t)d];
              Rng own{deriveSeed(g.actionSeed, m->iterations, d)};
              Rng &r = g.perDealStreams ? own : g.actionRng;
              for (int p = 0; p < n && !u.overflow; p++) walkers[(size_t)index]->run(u, p, r, step);
            }
          } catch (const std::bad_alloc &) { oom = true; }
        };
        double a = now();
        pool.run(job, parallel && T > 1 && visitsPerDeal * B >= 2000.0);
        m->lastThreads = parallel && T > 1 && visitsPerDeal * B >= 2000.0 ? T : 1;
        double b = now(); g.secTraverse += b - a;
        if (oom) throw std::bad_alloc();
        for (auto &u : units) if (u.overflow) return failMsg("One sampled traversal exceeds the native transient memory limit. Use fewer bet sizes or a larger budget.");
        m->touched.clear();
        for (int d = 0; d < B && status == 1; d++) { status = merge(*m, g, units[(size_t)d], false); visits += units[(size_t)d].visits; }
        if (status == 1) {
          for (int32_t r : m->touched) {
            MW::RowMeta &rm = m->rows[(size_t)r]; const size_t o = rm.off;
            for (int x = 0; x < 2 * rm.k; x++) {
              const double v = m->vals[o + (size_t)x] + m->delta[o + (size_t)x];
              if (!std::isfinite(v)) return failMsg("Non-finite batch strategy value");
              m->vals[o + (size_t)x] = x < rm.k && m->plus ? jsMax0(v) : v; m->delta[o + (size_t)x] = 0;
            }
            rm.marked = 0;
          }
        } else for (int32_t r : m->touched) { MW::RowMeta &rm = m->rows[(size_t)r]; std::fill_n(&m->delta[rm.off], 2 * (size_t)rm.k, 0.0); rm.marked = 0; }
        g.secMerge += now() - b;
      }
      m->stateVisits += visits; visitsPerDeal = (double)visits / B;
      if (status < 0) return failMsg("Non-finite sampled CFR increment");
      if (status == 0) { m->limitReached = true; break; }
      m->iterations++;
      if (progress && (it & 63) == 63) progress(ctx, m->iterations, m->trainingDeals);
    }
  } catch (const std::bad_alloc &) { m->limitReached = true; return failMsg("Out of memory during native external-sampling training"); }
  if (progress) progress(ctx, m->iterations, m->trainingDeals);
  return 1;
}
inline void decodeCards(uint32_t code, int length, uint8_t out[5]) {
  std::fill_n(out, 5, 0);
  if (length < 3) return;
  const int river = (int)(code % 53), turn = (int)(code / 53 % 53); int flop = (int)(code / 2809);
  auto c = [](int x, int r) { long v = 1; for (int i = 0; i < r; i++) v = v * (x - i) / (i + 1); return x < r ? 0L : v; };
  int f[3];
  for (int r = 3; r >= 1; r--) { int x = r - 1; while (c(x + 1, r) <= flop) x++; f[r - 1] = x; flop -= (int)c(x, r); }
  out[0] = (uint8_t)(f[0] + 1); out[1] = (uint8_t)(f[1] + 1); out[2] = (uint8_t)(f[2] + 1);
  out[3] = (uint8_t)turn; out[4] = (uint8_t)river;
}
} // namespace es
} // namespace
