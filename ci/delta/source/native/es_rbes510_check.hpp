// EightMax 5.10: exact checks of the experimental RB-ES estimator (es_rbes510.hpp) against a brute-force walk of
// the whole betting tree. Included by mw.cpp (namespace es is closed there); used by mw_rbes_check (mwcli
// --selftest510, so the shipped Windows program tests its own estimator) and by tests/rbes510.cpp.
//
// For a deal (board, every seat's hand) and an updating seat p, against the engine's current tables (nothing is
// merged, so every traversal reads the same table):
//   estimate = sum over EVERY outcome of the traversal's sampled opponent actions of
//              P(outcome) * (the increments the traversal writes)
//              [the estimator's own code; the outcomes are enumerated through Walker::rbScript, their probabilities
//               are the ones the traversal used, and they must sum to 1]
//   target   = sum over the hands x of p compatible with the board and the opponents' hands of
//              c(x) * [ regret:  step * prod_{i != p} pi_i(h) * (v_p(h,a) - v_p(h))
//                       average: step * pi_p(h) * sigma(a) ]
//              by a walk of the WHOLE betting tree for the deal (x, opponents' hands, board): no sampling, no
//              vectors, no shared values, the default trainer's row keys (worldGroups) and the engine's all-seat
//              payoff; c(x) = w(x) / sum of w over the compatible hands, computed here.
// The two must agree to rounding for every table entry: "E[RB-ES increment | board, opponents' hands] = E[target |
// board, opponents' hands]", without statistics. Every outcome is also run through the other walk (reference or
// production) and the two walks' increments are compared entry by entry.
#pragma once
#include <map>
namespace {
namespace es {
struct RbCheck {
  MW *m; Game &g; ScratchBudget budget; Walker walker; Unit u, u2; RbDeal rd; double step = 1, avgStep = 1; size_t N = 0; double scale = 1;
  explicit RbCheck(MW *mm) : m(mm), g(*mm->es), budget((size_t)512 << 20, g.scratchPeak), walker(*mm, g, budget), u(budget), u2(budget) {}
  void freeze() {
    N = m->vals.size(); g.setStoreCap(m->budgetBytes); g.extendStore(m->stateVisits); g.unitLimitBytes = (size_t)128 << 20;
    step = m->linear ? (double)(m->iterations + 1) : 1.0; avgStep = step;
    double chips = 1; for (int p = 0; p < m->n; p++) chips += g.rules.stacks[p]; chips += g.rules.pot0;
    scale = step * chips;
  }
  // score, card codes, default group keys and the RB-ES entries of the deal in u.w
  bool prepare(Unit &unit, bool rb) {
    m->score(unit.w); codes(unit, m->n);
    if (g.groups.on && !groupCodes(*m, g, unit)) return false;
    if (rb && !rbPrepareDeal(*m, g, unit, rd)) return false;
    return true;
  }
  long long rowOf(const Inc &inc) const { return inc.ref < 0 ? -1 : m->findRow(rowKey((uint32_t)inc.ref, inc.hand, inc.code)); }
  // An entry is identified by the betting path of its state, the hand field and the code field of its row key, so
  // states and rows that the frozen table does not hold yet (a new state plays uniformly and its increments would
  // create it) are compared like every other.
  typedef std::map<std::string, std::vector<long double>> Acc;
  std::map<int, std::string> pathCache;
  const std::string &pathOf(int ref) {
    auto it = pathCache.find(ref); if (it != pathCache.end()) return it->second;
    std::string rev; for (uint32_t i = (uint32_t)ref; i != 0 && i != 0xffffffffu; i = g.states.parent[i]) rev += (char)('0' + g.states.slot[i]);
    return pathCache[ref] = std::string(rev.rbegin(), rev.rend());
  }
  static std::string keyOf(const std::string &path, int hand, uint32_t code) { return path + "|" + std::to_string(hand) + "|" + std::to_string(code); }
  // ---- brute-force conditional target of seat p for the deal in u2 (see the header) ----
  std::vector<BS> st = std::vector<BS>((size_t)MAX_DEPTH + 2); std::vector<double> val = std::vector<double>(((size_t)MAX_DEPTH + 2) * 72);
  std::string path;
  const double *full(int d, int ref, const BS &t, const double *reach, int p, double c, Acc &tgt) {
    const int n = m->n; double *out = &val[(size_t)d * 72];
    if (t.kind == 2) { const double *v = walker.payoff(t); std::copy_n(v, n, out); return out; }
    BS &c1 = st[(size_t)d + 1];
    auto child = [&](int a) { return ref < 0 || c1.kind == 2 ? -1 : g.states.find((uint32_t)ref, a); };
    if (t.kind == 1 || t.k == 1) {
      const int a = t.kind == 1 ? CHANCE_SLOT : 0; if (t.kind == 1) g.rules.nextStreet(t, c1); else g.rules.advance(t, 0, c1);
      path += (char)('0' + a); const double *v = full(d + 1, child(a), c1, reach, p, c, tgt); path.pop_back(); std::copy_n(v, n, out); return out;
    }
    const int k = t.k, j = t.actor, physical = u2.w.seat[j];
    int hand = m->hands[(size_t)j][(size_t)physical].strategyHand; uint32_t code = u2.code[t.length];
    if (g.groups.on) { hand = 0; code = u2.gk[t.length][j]; }
    double s[8], V[8][8], cr[8]; walker.policy(ref, k, hand, code, s);
    std::copy_n(reach, n, cr);
    for (int a = 0; a < k; a++) {
      cr[j] = reach[j] * s[a]; g.rules.advance(t, a, c1);
      path += (char)('0' + a); const double *v = full(d + 1, child(a), c1, cr, p, c, tgt); path.pop_back(); std::copy_n(v, n, V[a]);
    }
    for (int i = 0; i < n; i++) { double mean = 0; for (int a = 0; a < k; a++) mean += s[a] * V[a][i]; out[i] = mean; }
    if (j == p) {
      double others = 1; for (int i = 0; i < n; i++) if (i != p) others *= reach[i];
      auto &e = tgt[keyOf(path, hand, code)]; if (e.empty()) e.assign(2 * (size_t)k, 0);
      for (int a = 0; a < k; a++) { e[(size_t)a] += (long double)c * step * others * (V[a][p] - out[p]); e[(size_t)(k + a)] += (long double)c * avgStep * reach[p] * s[a]; }
    }
    return out;
  }
  // target of seat p given the board and the opponents' hands of the deal in u.w, accumulated into tgt with weight w
  bool target(int p, double w, Acc &tgt, int &compatible) {
    uint8_t used[52] = {0};
    for (int i = 0; i < 5; i++) used[u.w.cards[i]] = 1;
    for (int jx = 0; jx < m->n; jx++) if (jx != p) { const Hand &h = m->hands[(size_t)jx][(size_t)u.w.seat[jx]]; used[h.a] = used[h.b] = 1; }
    const auto &range = m->hands[(size_t)p]; double tot = 0; std::vector<int> list;
    for (size_t i = 0; i < range.size(); i++) { const Hand &h = range[i]; if (used[h.a] || used[h.b] || !(h.w > 0)) continue; list.push_back((int)i); tot += h.w; }
    compatible = (int)list.size(); const double ones[8] = {1, 1, 1, 1, 1, 1, 1, 1};
    for (int x : list) {
      u2.w = u.w; u2.w.seat[p] = x; if (!prepare(u2, false)) return false;
      walker.u = &u2; path.clear();
      full(0, 0, g.rootState, ones, p, w * range[(size_t)x].w / tot, tgt);
    }
    return true;
  }
  // ---- exact expectation of what the traversal of seat p writes for the deal in u.w (weight w) ----
  struct Run { std::vector<std::pair<std::string, std::vector<double>>> v; };
  bool traverse(int p, Run &out) {
    Rng none{1};
    u.pending.clear(); u.incs.clear(); u.vals.clear(); walker.rbDeal = &rd;
    walker.run(u, p, none, step, avgStep);
    if (u.overflow) return false;
    std::vector<std::string> pend(u.pending.size());
    for (size_t i = 0; i < u.pending.size(); i++) { const Pending &q = u.pending[i]; pend[i] = (q.parentRef >= 0 ? pathOf(q.parentRef) : pend[(size_t)(-q.parentRef - 1)]) + (char)('0' + q.slot); }
    out.v.clear();
    for (const Inc &inc : u.incs) {
      const std::string &ph = inc.ref >= 0 ? pathOf(inc.ref) : pend[(size_t)(-inc.ref - 1)];
      out.v.emplace_back(keyOf(ph, inc.hand, inc.code), std::vector<double>(u.vals.begin() + (long)inc.off, u.vals.begin() + (long)inc.off + 2 * inc.k));
    }
    u.visits = 0; return true;
  }
  long long scripts = 0; long double worstPair = 0; double worstProb = 0;
  bool expectation(int p, double w, Acc &est, bool pair) {
    Walker::RbScript sc; walker.rbScript = &sc; Run a, b; long double probSum = 0; const bool refWalk = g.rbReference;
    do {
      sc.at = 0; sc.prob = 1;
      if (!traverse(p, a)) { walker.rbScript = nullptr; return false; }
      const double prob = sc.prob; const size_t used = sc.at;
      if (pair) {   // the same outcome through the other walk
        g.rbReference = !refWalk; sc.at = 0; sc.prob = 1; const bool ok = traverse(p, b); g.rbReference = refWalk;
        if (!ok || sc.at != used) { walker.rbScript = nullptr; return false; }
        Acc sa, sb;
        for (auto &e : a.v) { auto &x = sa[e.first]; if (x.empty()) x.assign(e.second.size(), 0); for (size_t i = 0; i < e.second.size(); i++) x[i] += e.second[i]; }
        for (auto &e : b.v) { auto &x = sb[e.first]; if (x.empty()) x.assign(e.second.size(), 0); for (size_t i = 0; i < e.second.size(); i++) x[i] += e.second[i]; }
        if (sa.size() != sb.size()) worstPair = 1;
        for (auto &e : sa) { auto it = sb.find(e.first); if (it == sb.end() || it->second.size() != e.second.size()) { worstPair = 1; continue; } for (size_t i = 0; i < e.second.size(); i++) worstPair = std::max(worstPair, fabsl(e.second[i] - it->second[i]) / scale); }
      }
      for (auto &e : a.v) { auto &x = est[e.first]; if (x.empty()) x.assign(e.second.size(), 0); for (size_t i = 0; i < e.second.size(); i++) x[i] += (long double)w * prob * e.second[i]; }
      probSum += prob; scripts++;
      sc.choice.resize(used); sc.options.resize(used);
      while (!sc.choice.empty() && ++sc.choice.back() >= sc.options.back()) { sc.choice.pop_back(); sc.options.pop_back(); }
    } while (!sc.choice.empty());
    walker.rbScript = nullptr; worstProb = std::max(worstProb, (double)fabsl(probSum - 1));
    return true;
  }
  // largest |est - tgt| / scale over the union of the entries; counts them
  void compare(const Acc &est, const Acc &tgt, long double &worst, long double &worstRel, long long &entries) const {
    for (const auto &e : est) {
      auto it = tgt.find(e.first);
      for (size_t i = 0; i < e.second.size(); i++) {
        const long double t = it != tgt.end() && i < it->second.size() ? it->second[i] : 0, d = fabsl(e.second[i] - t), big = std::max(fabsl(e.second[i]), fabsl(t));
        worst = std::max(worst, d / scale); if (big > 1e-6L * scale) worstRel = std::max(worstRel, d / big); entries++;
      }
      if (it != tgt.end() && it->second.size() != e.second.size()) worst = 1;
    }
    for (const auto &e : tgt) if (!est.count(e.first)) for (long double x : e.second) { worst = std::max(worst, fabsl(x) / scale); entries++; }
  }
  // The conditional check of one engine (see the header): `deals` sampled deals from the deal stream seeded by
  // `seed`; fills the counters above and returns false when a traversal overflowed or the dictionary did not fit.
  long double worst = 0, worstRel = 0; long long entries = 0, seatDeals = 0, hands = 0;
  bool conditional(long long deals, uint32_t seed) {
    for (long long s = 0; s < deals; s++) {
      m->rng.state = study53::mix((uint32_t)s * 2654435761u + seed);
      u.clear(); if (!m->deal(u.w, 0)) return false;
      if (!prepare(u, true)) return false;
      for (int p = 0; p < m->n; p++) {
        Acc est, tgt; int compatible = 0;
        if (!expectation(p, 1.0, est, true) || !target(p, 1.0, tgt, compatible)) return false;
        seatDeals++; hands += compatible; compare(est, tgt, worst, worstRel, entries);
      }
    }
    return true;
  }
  bool passed() const { return entries > 0 && worst <= 1e-11L && worstPair <= 1e-11L && worstProb <= 1e-9; }
  void describeRow(FILE *out, const MW::RowMeta &r) {
    const uint32_t state = (uint32_t)(r.key >> 37); const int hand = (int)((r.key >> 26) & 2047); const uint32_t code = (uint32_t)(r.key & ((1u << 26) - 1));
    std::vector<int> path; for (uint32_t i = state; i != 0 && i != 0xffffffffu; i = g.states.parent[i]) path.push_back(g.states.slot[i]);
    uint8_t cards[5] = {0, 0, 0, 0, 0}; if (!g.groups.on) decodeCards(code, g.states.length[state], cards);
    std::fprintf(out, "{\"path\":["); for (size_t i = path.size(); i-- > 0;) std::fprintf(out, "%d%s", path[i], i ? "," : "");
    std::fprintf(out, "],\"seat\":%d,\"hand\":%d,\"length\":%d,\"cards\":[%d,%d,%d,%d,%d],\"k\":%d,\"frozen\":[", (int)g.states.actor[state], hand, (int)g.states.length[state], cards[0] - 1, cards[1] - 1, cards[2] - 1, cards[3] - 1, cards[4] - 1, r.k);
    for (int a = 0; a < 2 * r.k; a++) std::fprintf(out, "%s%.17g", a ? "," : "", m->vals[r.off + (size_t)a]);
    std::fprintf(out, "]");
  }
};
} // namespace es
} // namespace
// {deals (1 to 100000, default 20), seed (default 1296)} -> the result of RbCheck::conditional as JSON. The engine's
// tables, counters and random streams are left as they were (keys interned for the check are removed again).
extern "C" int mw_rbes_check(MW *m, const char *json, size_t len, JB *out, char *err, int errlen) {
  using namespace es;
  if (!m || !m->es || !m->es->rbes) { fail(err, errlen, "The estimator check needs an engine with \"estimator\":\"rbes\""); return 400; }
  if (!(m->es->exploreMix > 0)) { fail(err, errlen, "The estimator check needs a positive opponent exploration"); return 400; }
  long long deals = 20; uint32_t seed = 1296;
  if (json && len) {
    JV *req = json_parse(json, len, err, errlen); if (!req) return 400;
    const JV *d = jget(req, "deals"), *s = jget(req, "seed"); bool bad = req->type != J_OBJ;
    if (d) { if (!isInt(d) || d->num < 1 || d->num > 100000) bad = true; else deals = (long long)d->num; }
    if (s) { if (!isInt(s) || s->num < 0 || s->num > 4294967295.0) bad = true; else seed = (uint32_t)s->num; }
    json_free(req); if (bad) { fail(err, errlen, "Invalid estimator check request"); return 400; }
  }
  // 5.11: the check draws its own deals from its own seed with the 5.10 generator, for a state of either kind of
  // training streams; it never takes a number of a training stream.
  const bool wideOn = m->wide.on; m->wide.on = false; m->rng.wide = false;
  Game &g = *m->es; const uint32_t rng = m->rng.state; const size_t keys = g.groups.text.size(); const double bytes = m->bytes; bool ok = false; double seconds = now();
  try {
    RbCheck H(m); H.freeze(); ok = H.conditional(deals, seed); seconds = now() - seconds;
    if (ok) jb_printf(out, "{\"test\":\"conditional\",\"estimator\":\"%s\",\"walk\":\"%s\",\"opponentTerminalChildren\":\"%s\",\"updatesOfTheTable\":%lld,\"deals\":%lld,\"seatDeals\":%lld,\"handsPerSeatDeal\":%.4f,\"traversalOutcomesEnumerated\":%lld,\"entriesCompared\":%lld,\"step\":%.17g,\"scale\":%.17g,"
                      "\"largestDifferenceOverScale\":%.6Lg,\"largestRelativeDifference\":%.6Lg,\"largestProductionReferenceDifferenceOverScale\":%.6Lg,\"largestOutcomeProbabilityError\":%.6g,\"tolerance\":1e-11,\"rows\":%zu,\"players\":%d,\"seconds\":%.3f,\"passed\":%s}",
                   Game::rbesId(g.rbTerminals), g.rbReference ? "reference" : "production", g.rbTerminals ? "exact" : "sampled", m->iterations, deals, H.seatDeals, (double)H.hands / (double)std::max<long long>(1, H.seatDeals), H.scripts, H.entries, H.step, H.scale,
                   H.worst, H.worstRel, H.worstPair, H.worstProb, m->rows.size(), m->n, seconds, H.passed() ? "true" : "false");
  } catch (const std::bad_alloc &) { ok = false; }
  m->rng.state = rng; m->wide.on = wideOn; g.groups.truncate(keys); m->bytes = bytes; g.rbMemo.clear();
  if (!ok) { fail(err, errlen, "The estimator check could not run (a traversal overflowed its buffers, or memory was insufficient)"); return 507; }
  return 200;
}
