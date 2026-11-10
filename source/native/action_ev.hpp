// EightMax 3.9: action-specific expected values and multiplayer response gains
// for native external-sampling studies. Included by mw.cpp after explorer.hpp.
//
// WHAT IS COMPUTED
// For a decision node reached by a validated action path (and the board cards
// dealt on it), and a hand of the acting seat, the EV of action a is
//
//   EV(a | h) = E[ u_actor(z) | actor holds h, node reached, a taken, then every
//               seat follows the continuation policy sigma ]
//
// where the expectation is over (1) the private hands of every other seat,
// including seats that have folded (their cards are dealt and block cards),
// drawn from the posterior  prod_j w_j(x_j) * reach_j(x_j)  restricted to
// mutually compatible hands that do not overlap the board or h; reach_j is the
// product of seat j's sigma probabilities for the actions it took on the path
// (with its own hand and the public cards of that street); (2) future board
// cards, uniform over the remaining deck; (3) every later decision of every
// seat (including the actor) drawn from sigma. Terminal utilities are the
// training utilities of the engine (mw_es_impl.hpp Walker::payoff): main and
// side pots from Rules::pots (EM.potLayers), ties split, unmatched chips
// returned, and with a tournament model the exact ICM finishing-set recursion
// (icm.hpp) on the final stacks, busted players included.
//
// sigma is NAMED by the request and is never switched silently:
//   average - normalized average-strategy sums (the solver output);
//   current - regret matching of stored cumulative regrets.
// Where a row is missing (state never visited for that key, or zero average
// sums) the policy is unavailable there. Default handling ("missing":
// "uniform") substitutes the uniform distribution AND reports the probability
// share of the evaluation that passed through such substitutions
// (fallbackShare); "missing":"refuse" returns 422 instead.
//
// UTILITY CONVENTION (identical for every action at the node)
//   chip EV : net chips of the actor relative to the study root, the training
//             utility: chips collected from pots minus chips the seat puts in
//             from the study root on (plus its own ante in preflop studies).
//             Chips already committed before this decision are sunk and are
//             identical for every action; "fromDecision" adds them back, i.e.
//             chips collected minus ADDITIONAL chips put in from this decision.
//   ICM     : the actor's tournament equity (expected payout, payout units)
//             after the hand. No chip baseline is subtracted.
//
// METHODS
//   exact   - full enumeration of opponent hand tuples, every future board
//             card and every later action, weighted by probability. Used when
//             the estimated work fits maxVisits (auto) or demanded (exact,
//             refused with 422 when it does not fit).
//   sampled - Monte Carlo: opponent hands drawn by rejection sampling from the
//             exact posterior above (no importance weights are needed), the
//             runout drawn uniformly, and later actions either enumerated with
//             their probabilities (small subtrees) or drawn on-policy from
//             sigma (large subtrees); both are unbiased. All actions of a
//             sample share its cards (common random numbers), so EV
//             differences have small variance. Reported: sample count, seed,
//             mean, standard error, normal 95% interval, paired standard error
//             of each action against the best and against the mixed strategy.
//
// RESPONSE GAINS (mw_response_gain)
//   exact   - best response of one seat to the fixed policies of all others,
//             over exact private hands and boards inside the study's betting
//             abstraction (per hand, per public history, maximizing). Gain =
//             BR value - value of sigma, per unit of deal probability. For two
//             seats with chip EV this is exact exploitability (NashConv / 2).
//   sampled - documented response class: one-shot deviations at a single
//             decision node per seat (default: the seat's first decision when
//             every earlier action is slot 0), continuation unchanged. The best
//             action per hand is SELECTED on one sample stream and the gain of
//             that fixed deviation is EVALUATED on an independent stream, so
//             the estimate is not optimistically biased by selection. It is a
//             lower bound on that seat's full best-response gain, not
//             exploitability.
namespace {
namespace es {
struct EvBudget {};
struct EvUnavailable { std::string why; };
enum class Pol { Average, Current };
inline double nowSec() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
inline double nChooseK(int n, int k) { if (k < 0 || n < k) return 0; double r = 1; for (int i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }

struct Evaluator {
  const MW &m; const Game &g; Pol pol; bool refuseMissing; int actor;
  Tournament::Workspace icm; bool tour; LPot pots[24];
  int hand[8] = {}; int cards[5] = {}; uint64_t used = 0;
  long long visits = 0, maxVisits = LLONG_MAX; bool exact = true, sampleActions = false;
  Rng rng{1}; double fbMass = 0, totMass = 0;
  volatile int *cancel = nullptr; double deadline = 1e300;
  struct Key { int hand; uint32_t code; bool ok; };
  std::unordered_map<uint64_t, Key> memo;
  Evaluator(const MW &mm, const Game &gg, Pol p, bool refuse, int seat) : m(mm), g(gg), pol(p), refuseMissing(refuse), actor(seat), tour(!mm.tournament.start.empty()) {
    if (tour) m.tournament.prepare(icm, std::min(m.budgetBytes, 64.0 * 1048576));
  }
  void poll() {
    if ((visits & 4095) == 0) {
      if (cancel && __atomic_load_n(cancel, __ATOMIC_RELAXED)) throw QueryError{409, "Calculation cancelled"};
      if (nowSec() > deadline) throw QueryError{408, "Time limit reached"};
    }
  }
  // Strategy key of (seat, range index) with the first `len` public cards; mirrors rowOf().
  Key key(int seat, int idx, int len) {
    const uint64_t mk = ((uint64_t)seat << 58) | ((uint64_t)idx << 44) | ((uint64_t)len << 40) | (uint64_t)cardsCode(cards, len);
    auto it = memo.find(mk); if (it != memo.end()) return it->second;
    Key k{m.hands[(size_t)seat][(size_t)idx].strategyHand, cardsCode(cards, len), true};
    if (g.groups.on) { k.hand = 0; k.ok = groupKeyAt(m, g.groups, g.startKey, seat, idx, cards, len, k.code); }
    else if (!m.turnGroups.empty()) {
      const int slot = len == 5 ? cards[4] + 1 : 0;
      const int id = m.turnGroups[(size_t)seat][(size_t)slot * m.hands[(size_t)seat].size() + (size_t)idx];
      k.hand = id % 2048; k.code = cardsCode(cards, 4) + (uint32_t)(id / 2048);
    }
    if (memo.size() > 4000000) memo.clear();
    memo.emplace(mk, k); return k;
  }
  // sigma of `seat` at committed state `state`. Returns false when it had to be substituted.
  bool policy(int state, int k, int seat, int idx, int len, double *p) {
    long long row = -1;
    if (state >= 0) { const Key kk = key(seat, idx, len); if (kk.ok) row = m.findRow(rowKey((uint32_t)state, kk.hand, kk.code)); }
    const bool ok = pol == Pol::Average ? averageOf(m, row, k, p) : (row >= 0 && currentOf(m, row, k, p));
    if (ok) return true;
    if (refuseMissing) throw EvUnavailable{"seat " + std::to_string(seat) + " has no stored " + std::string(pol == Pol::Average ? "average" : "current") + " strategy at betting state " + std::to_string(state) + " for one of the evaluated hands"};
    for (int a = 0; a < k; a++) p[a] = 1.0 / k;
    return false;
  }
  static bool contested(const LPot *pots, int np) { for (int q = 0; q < np; q++) if (std::popcount(pots[q].mask) >= 2) return true; return false; }
  // Utility of the actor at a terminal with all five board cards known.
  double scored(const BS &t, int np) {
    const int n = m.n; double util[8]; int score[8];
    for (int p = 0; p < n; p++) { const Hand &h = m.hands[(size_t)p][(size_t)hand[p]]; score[p] = evalSeven(cards, h.a, h.b); util[p] = tour ? t.behind[p] : -t.total[p] - m.anteOf[(size_t)p]; }
    for (int q = 0; q < np; q++) {
      const uint32_t mask = pots[q].mask; int top = INT_MIN, count = 0;
      for (uint32_t x = mask; x; x &= x - 1) { const int e = std::countr_zero(x); if (score[e] > top) { top = score[e]; count = 1; } else if (score[e] == top) count++; }
      if (!count) continue;
      const double share = pots[q].amount / count;
      for (uint32_t x = mask; x; x &= x - 1) { const int e = std::countr_zero(x); if (score[e] == top) util[e] += share; }
    }
    if (tour) m.tournament.evaluate(util, n, icm);
    return util[actor];
  }
  double uncontested(const BS &t, int np) {
    const int n = m.n; double util[8];
    for (int p = 0; p < n; p++) util[p] = tour ? t.behind[p] : -t.total[p] - m.anteOf[(size_t)p];
    for (int q = 0; q < np; q++) if (pots[q].mask) util[std::countr_zero(pots[q].mask)] += pots[q].amount;
    if (tour) m.tournament.evaluate(util, n, icm);
    return util[actor];
  }
  // Exact average over every completion of the board from `len` cards (each
  // unordered set of remaining cards equally likely; card order does not
  // matter at showdown).
  double runout(const BS &t, int np, int len) {
    if (len == 5) { visits++; return scored(t, np); }
    int free[52], nf = 0; for (int x = 0; x < 52; x++) if (!(used >> x & 1)) free[nf++] = x;
    double sum = 0; long long count = 0; const int need = 5 - len;
    std::function<void(int, int)> rec = [&](int from, int at) {
      if (at == 5) { visits++; sum += scored(t, np); count++; if (exact && visits > maxVisits) throw EvBudget{}; return; }
      for (int i = from; i <= nf - (5 - at); i++) { cards[at] = free[i]; rec(i + 1, at + 1); }
    };
    (void)need; rec(0, len);
    return count ? sum / (double)count : 0;
  }
  double terminal(const BS &t, int len, double prob, bool fb) {
    totMass += prob; if (fb) fbMass += prob;
    const int np = g.rules.pots(t, pots);
    if (!contested(pots, np)) return uncontested(t, np);
    if (!exact || len == 5) return scored(t, np);
    return runout(t, np, len);
  }
  int childOf(int state, const BS &t, int a, BS &c) const {
    g.rules.advance(t, a, c);
    return state >= 0 && c.kind != 2 ? g.states.find((uint32_t)state, a) : -1;
  }
  double value(int state, const BS &t, int len, double prob, bool fb) {
    visits++; poll();
    if (exact && visits > maxVisits) throw EvBudget{};
    if (t.kind == 2) return terminal(t, len, prob, fb);
    BS c;
    if (t.kind == 1) {
      const int cs = state >= 0 ? g.states.find((uint32_t)state, CHANCE_SLOT) : -1;
      g.rules.nextStreet(t, c);
      const int need = len == 0 ? 3 : 1;
      if (!exact) return value(cs, c, len + need, prob, fb);
      double sum = 0; int count = 0;
      if (need == 1) {
        for (int x = 0; x < 52; x++) if (!(used >> x & 1)) count++;
        for (int x = 0; x < 52; x++) if (!(used >> x & 1)) { cards[len] = x; used |= 1ULL << x; sum += value(cs, c, len + 1, prob / count, fb); used &= ~(1ULL << x); }
      } else {
        int free[52], nf = 0; for (int x = 0; x < 52; x++) if (!(used >> x & 1)) free[nf++] = x;
        const double combos = nChooseK(nf, 3);
        for (int i = 0; i < nf; i++) for (int j = i + 1; j < nf; j++) for (int l = j + 1; l < nf; l++) {
          cards[0] = free[i]; cards[1] = free[j]; cards[2] = free[l]; const uint64_t b = (1ULL << free[i]) | (1ULL << free[j]) | (1ULL << free[l]);
          used |= b; sum += value(cs, c, 3, prob / combos, fb); used &= ~b; count++;
        }
      }
      return count ? sum / count : 0;
    }
    if (t.k == 1) { const int cs = childOf(state, t, 0, c); return value(cs, c, len, prob, fb); }
    double p[8]; const bool stored = policy(state, t.k, t.actor, hand[t.actor], len, p); const bool fb2 = fb || !stored;
    if (sampleActions && !exact) {
      const double x = rng.next(); double cum = 0; int a = t.k - 1;
      for (int b = 0; b < t.k; b++) { cum += p[b]; if (x < cum) { a = b; break; } }
      while (p[a] <= 0 && a > 0) a--;
      const int cs = childOf(state, t, a, c); return value(cs, c, len, prob, fb2);
    }
    double v = 0;
    for (int a = 0; a < t.k; a++) { if (!(p[a] > 0)) continue; const int cs = childOf(state, t, a, c); v += p[a] * value(cs, c, len, prob * p[a], fb2); }
    return v;
  }
  // Betting-subtree size (chance nodes count once, no cards), capped.
  long long subtree(const BS &t, long long cap) const {
    long long count = 1; if (t.kind == 2) return 1;
    BS c;
    if (t.kind == 1) { g.rules.nextStreet(t, c); return 1 + subtree(c, cap); }
    for (int a = 0; a < t.k && count <= cap; a++) { g.rules.advance(t, a, c); count += subtree(c, cap - count); }
    return count;
  }
};

// Reach weight of every range hand of `seat` at the node: w * prod sigma(own path actions); 0 if blocked by `blocked`.
inline std::vector<double> reachWeights(Evaluator &E, const Resolved &R, int seat, uint64_t blocked, size_t &fallbacks) {
  const auto &range = E.m.hands[(size_t)seat]; std::vector<double> r(range.size(), 0.0); double p[8];
  std::copy_n(R.cards, 5, E.cards);
  for (size_t i = 0; i < range.size(); i++) {
    const Hand &h = range[i]; if ((blocked >> h.a & 1) || (blocked >> h.b & 1)) continue;
    double x = h.w; bool fb = false;
    for (size_t s = 0; s < R.steps.size() && x > 0; s++) {
      const Step &st = R.steps[s]; if (st.seat != seat) continue;
      if (!E.policy(st.state, R.trail[s].k, seat, (int)i, st.length, p)) fb = true;
      x *= p[(size_t)st.slot];
    }
    fallbacks += fb; r[i] = x;
  }
  return r;
}
struct Moments {
  int k = 0; long long n = 0; double s[8] = {}, ss[8][8] = {}, mix = 0, mix2 = 0, vm[8] = {}, fb[8] = {};
  void add(const double *v, const double *sigma, const double *fbShare) {
    n++; double mx = 0; for (int a = 0; a < k; a++) mx += sigma[a] * v[a];
    for (int a = 0; a < k; a++) { s[a] += v[a]; vm[a] += v[a] * mx; fb[a] += fbShare[a]; for (int b = 0; b < k; b++) ss[a][b] += v[a] * v[b]; }
    mix += mx; mix2 += mx * mx;
  }
  double mean(int a) const { return s[a] / (double)n; }
  double var(double sum, double sq) const { if (n < 2) return NAN; const double mu = sum / n; return std::max(0.0, (sq - n * mu * mu) / (n - 1)); }
  double se(int a) const { return std::sqrt(var(s[a], ss[a][a]) / n); }
  double seMix() const { return std::sqrt(var(mix, mix2) / n); }
  double seDiff(int a, int b) const { return std::sqrt(var(s[a] - s[b], ss[a][a] + ss[b][b] - 2 * ss[a][b]) / n); }
  double seVsMix(int a) const { return std::sqrt(var(s[a] - mix, ss[a][a] - 2 * vm[a] + mix2) / n); }
};
inline void jnumOrNull(JB *o, double v) { if (std::isfinite(v)) jb_printf(o, "%.17g", v); else jb_puts(o, "null"); }
inline void jarr(JB *o, const double *v, int k) { jb_putc(o, '['); for (int a = 0; a < k; a++) { if (a) jb_putc(o, ','); jnumOrNull(o, v[a]); } jb_putc(o, ']'); }

// Draws one world: hands of the seats in `seats` from their reach weights, by
// rejection (exact posterior), then the rest of the board. Returns false after `tries` rejections.
struct Sampler {
  std::vector<std::vector<double>> cum; std::vector<int> seats;
  void init(const std::vector<std::vector<double>> &reach, const std::vector<int> &s) {
    seats = s; cum.assign(reach.size(), {});
    for (int p : seats) { auto &c = cum[(size_t)p]; c.resize(reach[(size_t)p].size()); double t = 0; for (size_t i = 0; i < c.size(); i++) { t += reach[(size_t)p][i]; c[i] = t; } }
  }
  bool feasible() const { for (int p : seats) if (cum[(size_t)p].empty() || !(cum[(size_t)p].back() > 0)) return false; return true; }
  bool draw(Evaluator &E, Rng &rng, uint64_t base, int known, long long tries) {
    for (long long t = 0; t < tries; t++) {
      uint64_t u = base; bool ok = true;
      for (int p : seats) {
        const auto &c = cum[(size_t)p]; const double x = rng.next() * c.back();
        size_t i = (size_t)(std::upper_bound(c.begin(), c.end(), x) - c.begin()); if (i >= c.size()) i = c.size() - 1;
        const Hand &h = E.m.hands[(size_t)p][i]; const uint64_t b = (1ULL << h.a) | (1ULL << h.b);
        if (u & b) { ok = false; break; }
        u |= b; E.hand[p] = (int)i;
      }
      if (!ok) continue;
      int len = known;
      while (len < 5) { const int c = (int)std::floor(rng.next() * 52); if (!(u >> c & 1)) { u |= 1ULL << c; E.cards[len++] = c; } }
      if (E.m.startLen == 0 && known == 0) std::sort(E.cards, E.cards + 3);
      E.used = u; return true;
    }
    return false;
  }
};
struct EvParams {
  Pol pol = Pol::Average; bool refuse = false; std::string method = "auto", future = "auto";
  long long samples = 20000, seed = 1, maxVisits = 20000000, timeMs = 60000, enumerateCap = 4096;
};
inline EvParams evParams(const Fields &F, long long defaultTime) {
  EvParams P;
  P.pol = F.choice("policy", {"average", "current"}, "average") == "average" ? Pol::Average : Pol::Current;
  P.refuse = F.choice("missing", {"uniform", "refuse"}, "uniform") == "refuse";
  P.method = F.choice("method", {"auto", "exact", "sampled"}, "auto");
  P.future = F.choice("futureActions", {"auto", "enumerate", "sample"}, "auto");
  P.samples = F.optInt("samples", 16, 2000000, 20000);
  P.seed = F.optInt("seed", 0, 4294967295LL, 1);
  P.maxVisits = F.optInt("maxVisits", 1000, 2000000000LL, 20000000);
  P.timeMs = F.optInt("timeLimitMs", 100, 3600000, defaultTime);
  return P;
}
struct HandResult {
  int index = -1; bool exact = false, unreachable = false; double opponentMass = 0, reach = 0;
  double ev[8], se[8], fb[8], sigma[8], mix = NAN, seMix = NAN, diff[8], seDiffMix[8], seVsBest[8]; bool sigmaStored = true;
  long long samples = 0, visits = 0; std::string note; int best = -1; bool tie[8] = {};
};
// Exact per-hand evaluation. Throws EvBudget when maxVisits is exceeded.
inline void exactHand(Evaluator &E, const Resolved &R, const std::vector<std::vector<double>> &reach, int h, HandResult &out) {
  const BS &t = R.node(); const int k = t.k, n = E.m.n, actor = t.actor;
  E.exact = true; E.sampleActions = false; std::copy_n(R.cards, 5, E.cards); E.hand[actor] = h;
  const Hand &own = E.m.hands[(size_t)actor][(size_t)h];
  std::vector<int> opp; for (int p = 0; p < n; p++) if (p != actor) opp.push_back(p);
  double W = 0, v[8] = {}, fbm[8] = {}, tot[8] = {};
  std::function<void(size_t, uint64_t, double)> rec = [&](size_t j, uint64_t u, double w) {
    if (j == opp.size()) {
      W += w; E.used = u;
      for (int a = 0; a < k; a++) {
        BS c; const int cs = E.childOf(R.state, t, a, c); E.fbMass = E.totMass = 0;
        v[a] += w * E.value(cs, c, R.known, w, false); fbm[a] += E.fbMass; tot[a] += E.totMass;
      }
      return;
    }
    const int p = opp[j]; const auto &range = E.m.hands[(size_t)p];
    for (size_t i = 0; i < range.size(); i++) {
      const double r = reach[(size_t)p][i]; if (!(r > 0)) continue;
      const uint64_t b = (1ULL << range[i].a) | (1ULL << range[i].b); if (u & b) continue;
      E.hand[p] = (int)i; rec(j + 1, u | b, w * r);
    }
  };
  rec(0, R.used | (1ULL << own.a) | (1ULL << own.b), 1.0);
  out.exact = true; out.opponentMass = W; out.visits = E.visits;
  if (!(W > 0)) { out.unreachable = true; out.note = "No compatible opponent holdings reach this node under the policy"; return; }
  for (int a = 0; a < k; a++) { out.ev[a] = v[a] / W; out.se[a] = 0; out.fb[a] = tot[a] > 0 ? fbm[a] / tot[a] : 0; }
}
inline long long countNonzero(const std::vector<double> &r) { long long c = 0; for (double x : r) c += x > 0; return c; }
// Upper estimate of exact work for one hand (opponent tuples x runouts x subtree).
inline double exactCost(Evaluator &E, const Resolved &R, const std::vector<std::vector<double>> &reach, int actor) {
  double tuples = 1; for (int p = 0; p < E.m.n; p++) if (p != actor) tuples *= (double)std::max<long long>(1, countNonzero(reach[(size_t)p]));
  const double deck = 52 - R.known - 2 * E.m.n;
  const double runouts = R.known == 0 ? nChooseK((int)deck, 3) * (deck - 3) * (deck - 4) : R.known == 3 ? deck * (deck - 1) : R.known == 4 ? deck : 1;
  const BS &t = R.node(); double sub = 0; BS c;
  for (int a = 0; a < t.k; a++) { E.g.rules.advance(t, a, c); sub += (double)E.subtree(c, 1000000); }
  return tuples * std::max(1.0, runouts) * sub;
}
} // namespace es
} // namespace

namespace {
namespace es {
inline const char *policyName(Pol p) { return p == Pol::Average ? "average" : "current"; }
inline void nodeJson(JB *out, const MW &m, const Resolved &R) {
  const BS &t = R.node();
  jb_printf(out, "{\"stateId\":%d,\"street\":\"%s\",\"kind\":\"%s\",\"actor\":%d,\"facing\":%s,\"pot\":", R.state, streetName(t.length), t.kind == 0 ? "decision" : t.kind == 1 ? "chance" : "terminal", t.kind == 0 ? t.actor : -1, t.facing ? "true" : "false");
  jb_num(out, t.pot, 10); jb_puts(out, ",\"price\":"); jb_num(out, t.price, 10);
  jb_puts(out, ",\"board\":["); for (int i = 0; i < R.known; i++) jb_printf(out, "%s%d", i ? "," : "", R.cards[i]); jb_puts(out, "]");
  jb_puts(out, ",\"path\":["); bool first = true; for (const Step &s : R.steps) if (s.seat >= 0) { jb_printf(out, "%s%d", first ? "" : ",", s.slot); first = false; } jb_puts(out, "]}");
  (void)m;
}
inline void utilityJson(JB *out, const MW &m) {
  if (m.tournament.start.empty()) jb_puts(out, ",\"utility\":{\"model\":\"chip\",\"unit\":\"BB\",\"convention\":\"ev = net chips of the acting seat relative to the study root (chips collected from main and side pots minus chips it puts in from the study root on, plus its own ante in preflop studies); identical for every action at this node. fromDecision = ev + chips the seat had already committed at this decision (sunk), i.e. chips collected minus ADDITIONAL chips put in from this decision on.\"}");
  else jb_puts(out, ",\"utility\":{\"model\":\"icm\",\"unit\":\"payout units\",\"convention\":\"ev = tournament equity of the acting seat (expected payout under the study's ICM payout table, exact finishing-set recursion, busted players ranked by starting stack) after the hand; chip EV is not substituted.\"}");
}
inline void handJson(JB *out, const MW &m, const BS &t, int actor, const HandResult &r, double sunk, bool chip) {
  const int k = t.k;
  if (r.index >= 0) { const Hand &h = m.hands[(size_t)actor][(size_t)r.index]; jb_printf(out, "{\"i\":%d,\"cards\":[%d,%d],\"weight\":", r.index, h.a, h.b); jb_num(out, h.w, 10); }
  else jb_puts(out, "{\"i\":null");
  jb_puts(out, ",\"reach\":"); jnumOrNull(out, r.reach);
  jb_printf(out, ",\"method\":\"%s\"", r.exact ? "exact" : "sampled");
  if (r.unreachable) { jb_puts(out, ",\"available\":false,\"reason\":"); jb_str(out, r.note.c_str()); jb_putc(out, '}'); return; }
  jb_puts(out, ",\"available\":true");
  if (r.exact) { jb_puts(out, ",\"opponentMass\":"); jnumOrNull(out, r.opponentMass); }
  jb_printf(out, ",\"samples\":%lld,\"visits\":%lld", r.samples, r.visits);
  if (r.index >= 0) { jb_puts(out, ",\"strategy\":"); jarr(out, r.sigma, k); jb_printf(out, ",\"strategyStored\":%s", r.sigmaStored ? "true" : "false"); }
  jb_puts(out, ",\"ev\":"); jarr(out, r.ev, k);
  if (chip && r.index >= 0) { double f[8]; for (int a = 0; a < k; a++) f[a] = r.ev[a] + sunk; jb_puts(out, ",\"fromDecision\":"); jarr(out, f, k); }
  if (r.exact) jb_puts(out, ",\"stdErr\":null,\"ci95\":null");
  else { jb_puts(out, ",\"stdErr\":"); jarr(out, r.se, k); jb_puts(out, ",\"ci95\":["); for (int a = 0; a < k; a++) { if (a) jb_putc(out, ','); jb_putc(out, '['); jnumOrNull(out, r.ev[a] - 1.96 * r.se[a]); jb_putc(out, ','); jnumOrNull(out, r.ev[a] + 1.96 * r.se[a]); jb_putc(out, ']'); } jb_putc(out, ']'); }
  jb_puts(out, ",\"mixed\":"); jnumOrNull(out, r.mix); jb_puts(out, ",\"mixedStdErr\":"); if (r.exact) jb_puts(out, "null"); else jnumOrNull(out, r.seMix);
  jb_puts(out, ",\"diff\":"); jarr(out, r.diff, k); jb_puts(out, ",\"diffStdErr\":"); if (r.exact) jb_puts(out, "null"); else jarr(out, r.seDiffMix, k);
  jb_printf(out, ",\"best\":%d,\"vsBestStdErr\":", r.best); if (r.exact) jb_puts(out, "null"); else jarr(out, r.seVsBest, k);
  jb_puts(out, ",\"equivalentToBest\":["); for (int a = 0; a < k; a++) jb_printf(out, "%s%s", a ? "," : "", r.tie[a] ? "true" : "false"); jb_putc(out, ']');
  jb_puts(out, ",\"fallbackShare\":"); jarr(out, r.fb, k); jb_putc(out, '}');
}
inline void finishResult(HandResult &r, int k) {
  double best = -INFINITY; for (int a = 0; a < k; a++) if (r.ev[a] > best) { best = r.ev[a]; r.best = a; }
  for (int a = 0; a < k; a++) {
    r.diff[a] = r.ev[a] - r.mix;
    if (r.exact) r.tie[a] = std::fabs(r.ev[a] - best) <= 1e-9 * std::max(1.0, std::fabs(best));
    else r.tie[a] = a == r.best || std::fabs(r.ev[a] - best) <= 1.96 * r.seVsBest[a];
  }
}
inline void fromMoments(HandResult &r, const Moments &M, int k) {
  r.samples = M.n;
  for (int a = 0; a < k; a++) { r.ev[a] = M.mean(a); r.se[a] = M.se(a); r.fb[a] = M.fb[a] / M.n; r.seDiffMix[a] = M.seVsMix(a); }
  r.mix = M.mix / M.n; r.seMix = M.seMix();
  int best = 0; for (int a = 1; a < k; a++) if (r.ev[a] > r.ev[best]) best = a;
  for (int a = 0; a < k; a++) r.seVsBest[a] = a == best ? 0 : M.seDiff(a, best);
}
// One sampled world's action values at the node (all actions share the cards).
inline void sampleValues(Evaluator &E, const Resolved &R, double *v, double *fbs) {
  const BS &t = R.node();
  for (int a = 0; a < t.k; a++) { BS c; const int cs = E.childOf(R.state, t, a, c); E.fbMass = E.totMass = 0; v[a] = E.value(cs, c, R.known, 1.0, false); fbs[a] = E.totMass > 0 ? E.fbMass / E.totMass : 0; }
}
} // namespace es
} // namespace

// Cache: bounded per engine, keyed by the full canonical request plus the
// training counters, and cleared by every training call, import and restore.
extern "C" int mw_action_ev(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel) {
  using namespace es;
  if (!m || !m->es) { fail(err, errlen, "Action EVs need a native external-sampling study"); return 400; }
  const Game &g = *m->es; const int n = m->n; const double t0 = nowSec();
  JV *req = nullptr;
  try { req = parseRequest(json, len, err, errlen); } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  struct Free { JV *v; ~Free() { json_free(v); } } freeReq{req};
  try {
    const Fields F(req, {"path", "board", "hands", "range", "policy", "missing", "method", "futureActions", "samples", "seed", "maxVisits", "timeLimitMs", "studyId", "stateId"});
    const std::vector<int> path = F.intArray("path", 0, 7, MAX_DEPTH), dealt = F.intArray("board", 0, 51, 5);
    std::vector<int> hands = F.intArray("hands", 0, 1325, 64);
    bool range = false; if (const JV *v = F.get("range")) { if (v->type != J_BOOL) throw QueryError{400, "range must be true or false"}; range = v->num != 0; }
    const EvParams P = evParams(F, 60000);
    Resolved R = resolvePath(*m, g, path, dealt, cancel);
    checkIdentifiers(*m, F, R);
    const BS &t = R.node();
    if (t.kind != 0) throw QueryError{400, t.kind == 1 ? "The path ends at a chance node: select the board card(s) first" : "The path ends at a terminal state: there is no decision to evaluate"};
    const int actor = t.actor, k = t.k; const auto &arange = m->hands[(size_t)actor];
    if (hands.empty() && !range) throw QueryError{400, "Give hands (range indices of the acting seat, at most 64) and/or range:true"};
    for (size_t i = 0; i < hands.size(); i++) {
      if ((size_t)hands[i] >= arange.size()) throw QueryError{400, "hands[" + std::to_string(i) + "] is not in the acting seat's range (" + std::to_string(arange.size()) + " hands)"};
      for (size_t j = 0; j < i; j++) if (hands[j] == hands[i]) throw QueryError{400, "hands lists hand " + std::to_string(hands[i]) + " twice"};
      const Hand &h = arange[(size_t)hands[i]];
      if ((R.used >> h.a & 1) || (R.used >> h.b & 1)) throw QueryError{400, "hands[" + std::to_string(i) + "] is impossible: it shares a card with the board"};
    }
    // ---- cache ----
    std::string key = std::to_string(m->iterations) + "|" + std::to_string(m->trainingDeals) + "|" + std::to_string(m->rows.size()) + "|" + std::to_string(m->stateVisits) + "|";
    for (int a : path) key += std::to_string(a) + ","; key += "|"; for (int c : dealt) key += std::to_string(c) + ","; key += "|"; for (int h : hands) key += std::to_string(h) + ",";
    key += std::string("|") + (range ? "r" : "") + policyName(P.pol) + (P.refuse ? "R" : "U") + P.method + P.future + "|" + std::to_string(P.samples) + "|" + std::to_string(P.seed) + "|" + std::to_string(P.maxVisits);
    {
      auto it = m->evCache.find(key);
      if (it != m->evCache.end()) { jb_putn(out, it->second.data(), it->second.size() - 1); jb_puts(out, ",\"cache\":{\"hit\":true}}"); return 200; }
    }
    Evaluator E(*m, g, P.pol, P.refuse, actor); E.cancel = cancel; E.deadline = t0 + P.timeMs / 1000.0; E.maxVisits = P.maxVisits;
    std::vector<std::vector<double>> reach((size_t)n); std::vector<size_t> reachFb((size_t)n, 0);
    for (int p = 0; p < n; p++) reach[(size_t)p] = reachWeights(E, R, p, R.used, reachFb[(size_t)p]);
    std::vector<int> opp; for (int p = 0; p < n; p++) if (p != actor) opp.push_back(p);
    for (int p : opp) if (!(countNonzero(reach[(size_t)p]) > 0)) throw QueryError{422, "Seat " + std::to_string(p) + " reaches this node with probability 0 under the " + std::string(policyName(P.pol)) + " policy; no EV is defined"};
    const double cost = exactCost(E, R, reach, actor);
    const double units = (double)hands.size() + (range ? (double)countNonzero(reach[(size_t)actor]) : 0);
    bool useExact = P.method == "exact" || (P.method == "auto" && cost * units <= (double)P.maxVisits);
    long long subtreeNodes = 0; { BS c; for (int a = 0; a < k; a++) { g.rules.advance(t, a, c); subtreeNodes += E.subtree(c, 1000000); } }
    const bool sampleActions = P.future == "sample" || (P.future == "auto" && subtreeNodes > P.enumerateCap);
    std::vector<HandResult> results; HandResult agg; agg.index = -1; bool stopped = false; std::string fellBack;
    const bool chip = m->tournament.start.empty(); const double sunk = t.total[actor] + m->anteOf[(size_t)actor];
    auto evalExact = [&]() {
      results.clear();
      for (int h : hands) { HandResult r; r.index = h; r.reach = reach[(size_t)actor][(size_t)h]; E.visits = 0; exactHand(E, R, reach, h, r);
        if (!r.unreachable) { r.sigmaStored = E.policy(R.state, k, actor, h, R.known, r.sigma); r.mix = 0; for (int a = 0; a < k; a++) r.mix += r.sigma[a] * r.ev[a]; finishResult(r, k); }
        results.push_back(r); }
      if (range) {
        double W = 0, ev[8] = {}, mix = 0, fb[8] = {}; long long vis = 0;
        for (size_t h = 0; h < arange.size(); h++) {
          const double rh = reach[(size_t)actor][h]; if (!(rh > 0)) continue;
          HandResult r; E.visits = 0; exactHand(E, R, reach, (int)h, r); vis += r.visits; if (r.unreachable) continue;
          double sg[8]; E.policy(R.state, k, actor, (int)h, R.known, sg);
          const double w = rh * r.opponentMass; W += w;
          for (int a = 0; a < k; a++) { ev[a] += w * r.ev[a]; mix += w * sg[a] * r.ev[a]; fb[a] += w * r.fb[a]; }
        }
        agg.exact = true; agg.visits = vis; agg.reach = W;
        if (!(W > 0)) { agg.unreachable = true; agg.note = "The acting seat's range cannot reach this node"; }
        else { for (int a = 0; a < k; a++) { agg.ev[a] = ev[a] / W; agg.fb[a] = fb[a] / W; } agg.mix = mix / W; finishResult(agg, k); }
      }
    };
    if (useExact) {
      try { evalExact(); }
      catch (const EvBudget &) {
        if (P.method == "exact") throw QueryError{422, "Exact evaluation exceeds maxVisits (" + std::to_string(P.maxVisits) + " visits); use method sampled or raise maxVisits"};
        useExact = false; fellBack = "exact evaluation exceeded maxVisits; switched to sampling";
      }
    }
    if (!useExact) {
      E.exact = false; E.sampleActions = sampleActions; results.clear();
      auto run = [&](HandResult &r, Sampler &S, uint64_t base, uint32_t seedA, uint32_t seedB, int fixedHand) {
        Moments M; M.k = k; Rng rng{seedA}; E.rng = Rng{seedB}; E.visits = 0; std::copy_n(R.cards, 5, E.cards);
        if (!S.feasible()) { r.unreachable = true; r.note = "No holdings reach this node under the policy"; return; }
        for (long long s = 0; s < P.samples; s++) {
          if (!S.draw(E, rng, base, R.known, 200000)) { if (!M.n) { r.unreachable = true; r.note = "Compatible holdings are too rare to sample at this node"; return; } break; }
          if (fixedHand >= 0) E.hand[actor] = fixedHand;
          double v[8], fbs[8], sg[8];
          try { sampleValues(E, R, v, fbs); }
          catch (const QueryError &e) { if (e.status == 408 && M.n >= 16) { stopped = true; break; } throw; }
          E.policy(R.state, k, actor, E.hand[actor], R.known, sg); M.add(v, sg, fbs);
        }
        if (M.n < 2) { r.unreachable = true; r.note = "Too few samples were completed within the time limit"; return; }
        r.visits = E.visits; fromMoments(r, M, k); finishResult(r, k);
      };
      for (int h : hands) {
        HandResult r; r.index = h; r.reach = reach[(size_t)actor][(size_t)h];
        const Hand &own = arange[(size_t)h]; Sampler S; S.init(reach, opp);
        if (!stopped) run(r, S, R.used | (1ULL << own.a) | (1ULL << own.b), deriveSeed((uint32_t)P.seed, h, 0), deriveSeed((uint32_t)P.seed, h, 1), h);
        else { r.unreachable = true; r.note = "Not evaluated: time limit reached"; }
        if (!r.unreachable) r.sigmaStored = E.policy(R.state, k, actor, h, R.known, r.sigma);
        results.push_back(r);
      }
      if (range) {
        std::vector<int> all; for (int p = 0; p < n; p++) all.push_back(p);
        Sampler S; S.init(reach, all);
        if (!stopped) run(agg, S, R.used, deriveSeed((uint32_t)P.seed, -1, 0), deriveSeed((uint32_t)P.seed, -1, 1), -1);
        else { agg.unreachable = true; agg.note = "Not evaluated: time limit reached"; }
      }
    }
    // ---- response ----
    JB body; jb_init(&body); JB *o = &body;
    jb_puts(o, "{\"engine\":\"native action EV\",\"node\":"); nodeJson(o, *m, R);
    jb_printf(o, ",\"policy\":\"%s\",\"missing\":\"%s\"", policyName(P.pol), P.refuse ? "refuse" : "uniform");
    jb_printf(o, ",\"policyNote\":\"%s\"", P.pol == Pol::Average ? "Every seat (including the actor after this decision, and every seat's earlier actions that define the opponent ranges) follows the stored AVERAGE strategy." : "Every seat follows the CURRENT regret-matching strategy of the stored regrets (uniform where all regrets are non-positive, as in training).");
    utilityJson(o, *m);
    jb_puts(o, ",\"actions\":["); for (int a = 0; a < k; a++) { jb_printf(o, "%s{\"slot\":%d,\"name\":\"%s\",\"to\":", a ? "," : "", a, actionName(t, a)); jb_num(o, t.to[a], 10); jb_putc(o, '}'); } jb_putc(o, ']');
    jb_printf(o, ",\"method\":\"%s\",\"futureActions\":\"%s\",\"seed\":%lld,\"samplesRequested\":%lld,\"exactCostEstimate\":", useExact ? "exact" : "sampled", useExact ? "enumerated" : sampleActions ? "sampled from the policy" : "enumerated", P.seed, useExact ? 0LL : P.samples);
    jnumOrNull(o, cost); jb_printf(o, ",\"subtreeNodes\":%lld", subtreeNodes);
    if (!fellBack.empty()) { jb_puts(o, ",\"note\":"); jb_str(o, fellBack.c_str()); }
    jb_puts(o, ",\"reachFallbackHands\":["); for (int p = 0; p < n; p++) jb_printf(o, "%s%zu", p ? "," : "", reachFb[(size_t)p]); jb_putc(o, ']');
    if (chip) { jb_puts(o, ",\"sunk\":"); jb_num(o, sunk, 10); }
    jb_puts(o, ",\"hands\":["); for (size_t i = 0; i < results.size(); i++) { if (i) jb_putc(o, ','); handJson(o, *m, t, actor, results[i], sunk, chip); } jb_putc(o, ']');
    jb_puts(o, ",\"range\":"); if (range) handJson(o, *m, t, actor, agg, sunk, false); else jb_puts(o, "null");
    jb_printf(o, ",\"stoppedEarly\":%s,\"elapsedMs\":%.1f}", stopped ? "true" : "false", (nowSec() - t0) * 1000);
    if (body.failed) { jb_free(&body); throw std::bad_alloc(); }
    jb_putn(out, body.s, body.n - 1); jb_puts(out, ",\"cache\":{\"hit\":false}}");
    if (!stopped) {
      if (m->evCache.size() >= 32) m->evCache.clear();
      m->evCache.emplace(key, std::string(body.s, body.n));
    }
    jb_free(&body);
    return 200;
  } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  catch (const EvUnavailable &e) { fail(err, errlen, ("Unavailable: " + e.why + " (missing:\"refuse\")").c_str()); return 422; }
  catch (const EvBudget &) { fail(err, errlen, "Exact evaluation exceeds maxVisits"); return 422; }
  catch (const std::bad_alloc &) { fail(err, errlen, "Out of memory"); return 503; }
}

namespace {
namespace es {
// Exact best response of E.actor against the others' fixed policies, from the study root.
struct BrOut { double br = 0, pv = 0, z = 0; };
struct Tup { int hand[8]; uint64_t mask; double w; };
inline std::pair<double, double> brRec(Evaluator &E, int seat, int own, int state, const BS &t, int len, const std::vector<Tup> &T, const std::vector<double> &w) {
  const int n = E.m.n; const Hand &oh = E.m.hands[(size_t)seat][(size_t)own]; const uint64_t ownMask = (1ULL << oh.a) | (1ULL << oh.b);
  E.visits++; E.poll(); if (E.visits > E.maxVisits) throw EvBudget{};
  BS c;
  if (t.kind == 2) {
    double s = 0; uint64_t pub = 0; for (int i = 0; i < len; i++) pub |= 1ULL << E.cards[i];
    for (size_t i = 0; i < T.size(); i++) if (w[i] > 0) {
      for (int p = 0; p < n; p++) if (p != seat) E.hand[p] = T[i].hand[p];
      E.hand[seat] = own; E.used = pub | ownMask | T[i].mask; E.visits++;
      s += w[i] * E.terminal(t, len, 0, false);
    }
    return {s, s};
  }
  if (t.kind == 1) {
    const int cs = state >= 0 ? E.g.states.find((uint32_t)state, CHANCE_SLOT) : -1; E.g.rules.nextStreet(t, c);
    uint64_t pub = 0; for (int i = 0; i < len; i++) pub |= 1ULL << E.cards[i];
    const int deck = 52 - len - 2 * n; double br = 0, pv = 0; std::vector<double> w2(w.size());
    if (len > 0) {
      for (int x = 0; x < 52; x++) {
        if ((pub | ownMask) >> x & 1) continue;
        bool any = false; for (size_t i = 0; i < T.size(); i++) { w2[i] = (T[i].mask >> x & 1) ? 0 : w[i] / deck; any |= w2[i] > 0; }
        if (!any) continue;
        E.cards[len] = x; const auto r = brRec(E, seat, own, cs, c, len + 1, T, w2); br += r.first; pv += r.second;
      }
    } else {
      const double combos = nChooseK(deck, 3);
      for (int a = 0; a < 52; a++) for (int b = a + 1; b < 52; b++) for (int d = b + 1; d < 52; d++) {
        const uint64_t f = (1ULL << a) | (1ULL << b) | (1ULL << d); if (f & ownMask) continue;
        bool any = false; for (size_t i = 0; i < T.size(); i++) { w2[i] = (T[i].mask & f) ? 0 : w[i] / combos; any |= w2[i] > 0; }
        if (!any) continue;
        E.cards[0] = a; E.cards[1] = b; E.cards[2] = d; const auto r = brRec(E, seat, own, cs, c, 3, T, w2); br += r.first; pv += r.second;
      }
    }
    return {br, pv};
  }
  if (t.k == 1) { const int cs = E.childOf(state, t, 0, c); return brRec(E, seat, own, cs, c, len, T, w); }
  double p[8];
  if (t.actor == seat) {
    E.policy(state, t.k, seat, own, len, p); double best = -INFINITY, pv = 0;
    for (int a = 0; a < t.k; a++) { const int cs = E.childOf(state, t, a, c); const auto r = brRec(E, seat, own, cs, c, len, T, w); best = std::max(best, r.first); pv += p[a] * r.second; }
    return {best, pv};
  }
  std::vector<std::vector<double>> wa((size_t)t.k, std::vector<double>(w.size(), 0.0));
  for (size_t i = 0; i < T.size(); i++) if (w[i] > 0) { E.policy(state, t.k, t.actor, T[i].hand[t.actor], len, p); for (int a = 0; a < t.k; a++) wa[(size_t)a][i] = w[i] * p[a]; }
  double br = 0, pv = 0;
  for (int a = 0; a < t.k; a++) {
    bool any = false; for (double x : wa[(size_t)a]) any |= x > 0; if (!any) continue;
    const int cs = E.childOf(state, t, a, c); const auto r = brRec(E, seat, own, cs, c, len, T, wa[(size_t)a]); br += r.first; pv += r.second;
  }
  return {br, pv};
}
inline BrOut exactBestResponse(Evaluator &E, int seat) {
  const MW &m = E.m; const int n = m.n; BrOut out; uint64_t board = 0; for (int i = 0; i < m.startLen; i++) board |= 1ULL << m.board[i];
  std::copy_n(m.board, 5, E.cards);
  for (size_t h = 0; h < m.hands[(size_t)seat].size(); h++) {
    const Hand &oh = m.hands[(size_t)seat][h]; const uint64_t om = (1ULL << oh.a) | (1ULL << oh.b);
    if (!(oh.w > 0) || (om & board)) continue;
    std::vector<Tup> T; Tup cur{}; 
    std::function<void(int, uint64_t, double)> rec = [&](int p, uint64_t u, double w) {
      if (p == n) { cur.mask = u & ~(board | om); cur.w = w; T.push_back(cur); if (T.size() > 2000000) throw EvBudget{}; return; }
      if (p == seat) { rec(p + 1, u, w); return; }
      const auto &rg = m.hands[(size_t)p];
      for (size_t i = 0; i < rg.size(); i++) { const uint64_t b = (1ULL << rg[i].a) | (1ULL << rg[i].b); if ((u & b) || !(rg[i].w > 0)) continue; cur.hand[p] = (int)i; rec(p + 1, u | b, w * rg[i].w); }
    };
    rec(0, board | om, 1.0);
    if (T.empty()) continue;
    std::vector<double> w(T.size()); double z = 0; for (size_t i = 0; i < T.size(); i++) { w[i] = T[i].w; z += w[i]; }
    const auto r = brRec(E, seat, (int)h, 0, E.g.rootState, m.startLen, T, w);
    out.br += oh.w * r.first; out.pv += oh.w * r.second; out.z += oh.w * z;
  }
  return out;
}
// Lexicographically first path (slot 0 = fold/check first) on which `seat` makes its first decision on the study's first street.
inline bool defaultPath(const Game &g, int seat, std::vector<int> &path) {
  std::function<bool(const BS &, int)> dfs = [&](const BS &t, int depth) -> bool {
    if (t.kind != 0 || depth > 64) return false;
    if (t.actor == seat) return true;
    BS c; for (int a = 0; a < t.k; a++) { g.rules.advance(t, a, c); path.push_back(a); if (dfs(c, depth + 1)) return true; path.pop_back(); }
    return false;
  };
  path.clear(); return dfs(g.rootState, 0);
}
} // namespace es
} // namespace

extern "C" int mw_response_gain(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel) {
  using namespace es;
  if (!m || !m->es) { fail(err, errlen, "Response gains need a native external-sampling study"); return 400; }
  const Game &g = *m->es; const int n = m->n; const double t0 = nowSec();
  JV *req = nullptr;
  try { req = parseRequest(json, len, err, errlen); } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  struct Free { JV *v; ~Free() { json_free(v); } } freeReq{req};
  try {
    const Fields F(req, {"method", "seats", "path", "board", "policy", "missing", "samples", "selectionSamples", "reachSamples", "seed", "maxVisits", "timeLimitMs", "futureActions", "studyId"});
    const std::string method = F.choice("method", {"exact", "sampled"}, "sampled");
    std::vector<int> seats = F.intArray("seats", 0, n - 1, 8);
    for (size_t i = 0; i < seats.size(); i++) for (size_t j = 0; j < i; j++) if (seats[i] == seats[j]) throw QueryError{400, "seats lists a seat twice"};
    if (seats.empty()) for (int p = 0; p < n; p++) seats.push_back(p);
    const bool customNode = F.has("path") || F.has("board");
    if (customNode && seats.size() != 1) throw QueryError{400, "path/board select one node: give exactly one seat"};
    if (customNode && method == "exact") throw QueryError{400, "Exact best responses always start at the study root; path/board apply to method sampled"};
    const std::vector<int> cpath = F.intArray("path", 0, 7, MAX_DEPTH), cboard = F.intArray("board", 0, 51, 5);
    EvParams P; P.pol = F.choice("policy", {"average", "current"}, "average") == "average" ? Pol::Average : Pol::Current;
    P.refuse = F.choice("missing", {"uniform", "refuse"}, "uniform") == "refuse";
    P.samples = F.optInt("samples", 64, 2000000, 20000); P.seed = F.optInt("seed", 0, 4294967295LL, 1);
    P.maxVisits = F.optInt("maxVisits", 1000, 2000000000LL, 200000000); P.timeMs = F.optInt("timeLimitMs", 100, 3600000, 120000);
    P.future = F.choice("futureActions", {"auto", "enumerate", "sample"}, "auto");
    const long long selection = F.optInt("selectionSamples", 16, 100000, 200), reachN = F.optInt("reachSamples", 64, 2000000, 20000);
    if (const JV *v = F.get("studyId")) { if (v->type != J_STR) throw QueryError{400, "studyId must be a string"}; if (m->studyId.empty() || m->studyId != v->str) throw QueryError{409, "studyId does not match the open study"}; }
    const bool chip = m->tournament.start.empty();
    JB body; jb_init(&body); JB *o = &body;
    struct FreeB { JB *b; ~FreeB() { jb_free(b); } } freeB{&body};
    jb_printf(o, "{\"engine\":\"native response gain\",\"method\":\"%s\",\"policy\":\"%s\",\"missing\":\"%s\",\"players\":%d,\"updates\":%lld,\"sampledDeals\":%lld", method.c_str(), policyName(P.pol), P.refuse ? "refuse" : "uniform", n, m->iterations, m->trainingDeals);
    utilityJson(o, *m);
    std::vector<double> gains;
    if (method == "exact") {
      jb_puts(o, ",\"responseClass\":\"full best response of one seat over exact private hands and boards inside the study's betting abstraction, all other seats fixed\",\"seats\":[");
      for (size_t i = 0; i < seats.size(); i++) {
        const int seat = seats[i]; Evaluator E(*m, g, P.pol, P.refuse, seat); E.cancel = cancel; E.deadline = t0 + P.timeMs / 1000.0; E.maxVisits = P.maxVisits; E.exact = true;
        BrOut r; try { r = exactBestResponse(E, seat); } catch (const EvBudget &) { throw QueryError{422, "Exact best response exceeds maxVisits (" + std::to_string(P.maxVisits) + "); use method sampled"}; }
        if (!(r.z > 0)) throw QueryError{422, "Seat " + std::to_string(seat) + " has no possible deal"};
        const double gain = (r.br - r.pv) / r.z; gains.push_back(gain);
        jb_printf(o, "%s{\"seat\":%d,\"policyValue\":", i ? "," : "", seat); jnumOrNull(o, r.pv / r.z); jb_puts(o, ",\"bestResponseValue\":"); jnumOrNull(o, r.br / r.z);
        jb_puts(o, ",\"gain\":"); jnumOrNull(o, gain); jb_printf(o, ",\"stdErr\":0,\"visits\":%lld}", E.visits);
      }
      jb_putc(o, ']');
      if (seats.size() == (size_t)n) {
        double sum = 0; for (double x : gains) sum += x;
        jb_puts(o, ",\"nashConv\":"); jnumOrNull(o, sum);
        if (n == 2 && chip) { jb_puts(o, ",\"exploitability\":"); jnumOrNull(o, sum / 2); jb_puts(o, ",\"exploitabilityNote\":\"Two seats with chip EV (constant-sum): exact exploitability of the evaluated policy in this card and betting abstraction = NashConv / 2.\""); }
        else jb_puts(o, ",\"exploitability\":null,\"exploitabilityNote\":\"More than two seats or an ICM utility: the game is not two-player zero-sum, so per-seat gains are reported and no exploitability is claimed.\"");
      }
    } else {
      jb_puts(o, ",\"responseClass\":\"one-shot deviation at one decision node per seat (continuation unchanged); best action per hand selected on an independent sample stream, gain evaluated on another; a lower bound on the seat's best-response gain, not exploitability\",\"seats\":[");
      for (size_t si = 0; si < seats.size(); si++) {
        const int seat = seats[si]; std::vector<int> path = cpath;
        if (si) jb_putc(o, ',');
        if (!customNode && !defaultPath(g, seat, path)) { jb_printf(o, "{\"seat\":%d,\"available\":false,\"reason\":\"The seat has no decision on the study's first street\"}", seat); continue; }
        Resolved R = resolvePath(*m, g, path, cboard, cancel);
        const BS &t = R.node();
        if (t.kind != 0 || t.actor != seat) throw QueryError{400, "The path does not end at a decision of seat " + std::to_string(seat)};
        const int k = t.k;
        Evaluator E(*m, g, P.pol, P.refuse, seat); E.cancel = cancel; E.deadline = t0 + P.timeMs / 1000.0; E.exact = false;
        long long sub = 0; { BS c; for (int a = 0; a < k; a++) { g.rules.advance(t, a, c); sub += E.subtree(c, 1000000); } }
        E.sampleActions = P.future == "sample" || (P.future == "auto" && sub > 4096);
        std::vector<std::vector<double>> reach((size_t)n); size_t fbDummy = 0;
        for (int p = 0; p < n; p++) reach[(size_t)p] = reachWeights(E, R, p, R.used, fbDummy);
        std::vector<int> opp, all; for (int p = 0; p < n; p++) { all.push_back(p); if (p != seat) opp.push_back(p); }
        // 1) selection stream
        const auto &rg = m->hands[(size_t)seat]; std::vector<int> choice(rg.size(), -1);
        Rng selRng{deriveSeed((uint32_t)P.seed, seat, 10)}; E.rng = Rng{deriveSeed((uint32_t)P.seed, seat, 11)};
        Sampler So; So.init(reach, opp);
        size_t deviating = 0, considered = 0;
        if (So.feasible()) for (size_t h = 0; h < rg.size(); h++) {
          if (!(reach[(size_t)seat][h] > 0)) continue;
          const uint64_t base = R.used | (1ULL << rg[h].a) | (1ULL << rg[h].b); Moments M; M.k = k;
          for (long long s = 0; s < selection; s++) { if (!So.draw(E, selRng, base, R.known, 20000)) break; E.hand[seat] = (int)h; double v[8], f[8], sg[8]; sampleValues(E, R, v, f); E.policy(R.state, k, seat, (int)h, R.known, sg); M.add(v, sg, f); }
          if (!M.n) continue;
          int best = 0; for (int a = 1; a < k; a++) if (M.mean(a) > M.mean(best)) best = a;
          choice[h] = best; considered++;
          double sg[8]; E.policy(R.state, k, seat, (int)h, R.known, sg); if (sg[best] < 1 - 1e-12) deviating++;
        }
        // 2) evaluation stream: joint posterior samples of (own hand, opponents)
        Sampler Sj; Sj.init(reach, all); Rng evRng{deriveSeed((uint32_t)P.seed, seat, 20)}; E.rng = Rng{deriveSeed((uint32_t)P.seed, seat, 21)};
        double sd = 0, sd2 = 0; long long cnt = 0; bool stopped = false;
        if (Sj.feasible()) for (long long s = 0; s < P.samples; s++) {
          if (!Sj.draw(E, evRng, R.used, R.known, 200000)) break;
          const int h = E.hand[seat]; if (choice[(size_t)h] < 0) continue;
          double v[8], f[8], sg[8];
          try { sampleValues(E, R, v, f); } catch (const QueryError &e) { if (e.status == 408 && cnt >= 64) { stopped = true; break; } throw; }
          E.policy(R.state, k, seat, h, R.known, sg); double mix = 0; for (int a = 0; a < k; a++) mix += sg[a] * v[a];
          const double d = v[choice[(size_t)h]] - mix; sd += d; sd2 += d * d; cnt++;
        }
        // 3) probability of reaching the node (prior deals compatible with the path's board)
        std::vector<std::vector<double>> prior((size_t)n);
        for (int p = 0; p < n; p++) { prior[(size_t)p].assign(m->hands[(size_t)p].size(), 0.0); for (size_t i = 0; i < prior[(size_t)p].size(); i++) { const Hand &h = m->hands[(size_t)p][i]; if (!((R.used >> h.a & 1) || (R.used >> h.b & 1))) prior[(size_t)p][i] = h.w; } }
        Sampler Sp; Sp.init(prior, all); Rng rRng{deriveSeed((uint32_t)P.seed, seat, 30)}; double rs = 0, rs2 = 0; long long rc = 0;
        if (Sp.feasible()) for (long long s = 0; s < reachN; s++) {
          if (!Sp.draw(E, rRng, R.used, R.known, 200000)) break;
          double x = 1; for (int p = 0; p < n; p++) { const double w0 = prior[(size_t)p][(size_t)E.hand[p]]; x *= w0 > 0 ? reach[(size_t)p][(size_t)E.hand[p]] / w0 : 0; }
          rs += x; rs2 += x * x; rc++;
        }
        jb_printf(o, "{\"seat\":%d,\"available\":%s,\"node\":", seat, cnt >= 2 ? "true" : "false"); nodeJson(o, *m, R);
        jb_printf(o, ",\"futureActions\":\"%s\",\"handsConsidered\":%zu,\"handsWithDeviation\":%zu,\"selectionSamplesPerHand\":%lld,\"evaluationSamples\":%lld,\"stoppedEarly\":%s", E.sampleActions ? "sampled from the policy" : "enumerated", considered, deviating, selection, cnt, stopped ? "true" : "false");
        if (cnt >= 2) {
          const double g1 = sd / cnt, se1 = std::sqrt(std::max(0.0, (sd2 - cnt * g1 * g1) / (cnt - 1)) / cnt);
          const double rp = rc ? rs / rc : NAN, rse = rc > 1 ? std::sqrt(std::max(0.0, (rs2 - rc * rp * rp) / (rc - 1)) / rc) : NAN;
          const double gu = g1 * rp, seu = std::sqrt(std::pow(g1 * rse, 2) + std::pow(rp * se1, 2));
          jb_puts(o, ",\"conditionalGain\":{\"mean\":"); jnumOrNull(o, g1); jb_puts(o, ",\"stdErr\":"); jnumOrNull(o, se1); jb_puts(o, ",\"ci95\":["); jnumOrNull(o, g1 - 1.96 * se1); jb_putc(o, ','); jnumOrNull(o, g1 + 1.96 * se1); jb_puts(o, "]}");
          jb_printf(o, ",\"reachProbability\":{\"samples\":%lld,\"mean\":", rc); jnumOrNull(o, rp); jb_puts(o, ",\"stdErr\":"); jnumOrNull(o, rse); jb_puts(o, ",\"note\":\"probability that the deal and the policies reach this node, given the board cards on the path\"}");
          jb_puts(o, ",\"gain\":{\"mean\":"); jnumOrNull(o, gu); jb_puts(o, ",\"stdErr\":"); jnumOrNull(o, seu); jb_puts(o, ",\"ci95\":["); jnumOrNull(o, gu - 1.96 * seu); jb_putc(o, ','); jnumOrNull(o, gu + 1.96 * seu); jb_puts(o, "]}");
          gains.push_back(gu);
        }
        jb_putc(o, '}');
      }
      jb_putc(o, ']');
    }
    if (!gains.empty()) {
      double mx = -INFINITY, mean = 0; for (double x : gains) { mx = std::max(mx, x); mean += x; } mean /= gains.size();
      jb_puts(o, ",\"summary\":{\"maxSeatGain\":"); jnumOrNull(o, mx); jb_puts(o, ",\"meanSeatGain\":"); jnumOrNull(o, mean); jb_printf(o, ",\"seatsEvaluated\":%zu,\"note\":\"Per-seat values are listed above; the mean does not replace them.\"}", gains.size());
    }
    jb_printf(o, ",\"elapsedMs\":%.1f}", (nowSec() - t0) * 1000);
    if (body.failed) throw std::bad_alloc();
    jb_putn(out, body.s, body.n);
    return 200;
  } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  catch (const EvUnavailable &e) { fail(err, errlen, ("Unavailable: " + e.why + " (missing:\"refuse\")").c_str()); return 422; }
  catch (const EvBudget &) { fail(err, errlen, "Evaluation exceeds maxVisits"); return 422; }
  catch (const std::bad_alloc &) { fail(err, errlen, "Out of memory"); return 503; }
}
