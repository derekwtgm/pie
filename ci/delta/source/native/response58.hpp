// EightMax 5.8: TRAINED RESPONSE - a lower bound of one seat's best-response gain in games too large to enumerate.
//
// WHAT WAS MISSING. An exact best response (action_ev.hpp exactBestResponse) enumerates every tuple of opponent
// hands for every hand of the responding seat; it exists only for small games. For everything else 5.7 had two
// measures of ONE fixed alternative strategy of a seat: a deviation at one decision node ("sampled") and a best
// response restricted to the first street ("restricted"). On games where the exact answer is known they found between
// 4% and 100% of it (CONVERGENCE-5.7.md, section 5): in a game with several streets a seat that may change one
// decision, or one street, is far from a best response.
//
// WHAT THIS DOES. With the other seats' strategies fixed, the responding seat faces a one-player decision problem with
// perfect recall. Regret minimisation in such a problem converges to its optimum: the seat's AVERAGE strategy has a
// value within (average regret) of the best-response value (Zinkevich et al. 2007, applied to one player against a
// fixed environment; the value is linear in the seat's realisation plan and the average strategy is the average
// of the plans). So the engine's own external-sampling trainer, run with only this seat learning and every other seat
// frozen at its trained average strategy, produces a response strategy R that may deviate at EVERY decision on EVERY
// street. Its quality is not assumed: it is measured afterwards.
//
// WHAT IS REPORTED, AND IN WHICH DIRECTION. For seat i, strategies sigma (the evaluated profile) and response R:
//     gain(R) = V_i(R, sigma_-i) - V_i(sigma)  <=  max over all strategies of seat i  =  best-response gain of seat i.
// The inequality holds for every R, good or bad, by the definition of a maximum. gain(R) is therefore a LOWER BOUND
// of the seat's best-response gain, and the sum over the seats a lower bound of NashConv, inside the study's betting
// abstraction (the action menu) with exact private cards and boards. With hand groups the response is restricted to
// the same grouping; it is still a strategy of the ungrouped game, so the direction is unchanged. It is never an upper
// bound: a small value shows that this response found little, not that none exists. Nothing here is "exploitability"
// for more than two seats or an ICM utility.
//
// HOW gain(R) IS MEASURED. Exactly (the existing exact evaluator computes V_i of both profiles) when the game is small
// enough, and otherwise on deals that were never used to train R: one walk per deal enumerates the seat's own actions
// under R and under sigma at once and samples every other seat's action once, so both values share the deal and the
// opponents' actions (pairValue below). Each sample is the difference of two expectations of terminal utilities, so
// it lies within the proven utility range; the samples are i.i.d. with equal weights and their number is fixed in
// advance, which are the conditions of the bounded-payoff interval of study_stats55.hpp. Because the evaluation deals
// are independent of everything that selected R, the sample mean is an unbiased estimate of gain(R) for the R that
// was trained - there is no selection bias to correct.
//
// HOW IT IS STORED. One engine object, no new format. mw_response_begin turns a loaded training state into the
// response problem of one seat, in place:
//     other seats:   regret slot := their average strategy (regret matching over non-negative numbers proportional
//                    to sigma plays sigma, with the same divisions as the evaluator's averageOf), so the unchanged
//                    trainer samples them from sigma; their rows are never written again (onlySeat);
//     this seat:     regret and average slots := 0; the average is kept aside.
// mw_train then trains (linear external sampling, the default estimator; experimental estimators are switched off).
// mw_response_end restores the seat's own trained average into its REGRET slot and, for information sets the
// response never reached, into the average slot too. Afterwards one state holds both profiles:
//     policy "average" = (R_i, sigma_-i)        policy "current" = sigma
// and every existing evaluator works on it. Information sets without a stored strategy play uniformly in both
// profiles (the evaluators' default fallback); the other fallbacks are refused for this measure.
//
// RANDOM NUMBERS. Training uses the engine's streams, reseeded from the response seed. The evaluation uses its own
// 64-bit generator (SplitMix64), two streams (deals, actions) per block of 1,024 deals, derived from (seed, seat,
// block). The engine's 32-bit generator has 2^32 states on one cycle, so thousands of block streams cut from it would
// overlap. SplitMix64 has 2^64 states on one cycle; B blocks whose streams draw at most L numbers each overlap
// somewhere with probability about 4 B^2 L / 2^64: below 1e-8 for the default request (196 blocks, L below a
// million) and below 1e-4 up to sixteen million deals. For the largest request the engine accepts (a billion deals)
// some pair of the million blocks will share a stretch of numbers; that is a dependence between two blocks in a
// million, and is stated here rather than called impossible (MATHEMATICAL-VALIDATION-5.8.md, section 2).
// Blocks are evaluated by any number of threads and added in block order: the result does not depend on the threads.
#pragma once
namespace {
namespace es {
struct Rng64 {
  uint64_t s;
  uint64_t bits() { uint64_t z = (s += 0x9e3779b97f4a7c15ULL); z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; return z ^ (z >> 31); }
  double next() { return (double)(bits() >> 11) * (1.0 / 9007199254740992.0); }   // 53 random bits, in [0, 1)
};
inline uint64_t seed58(uint64_t seed, uint64_t seat, uint64_t block, uint64_t purpose) {
  Rng64 r{seed * 0x9e3779b97f4a7c15ULL + 0x5800000058ULL};
  r.s = r.bits() ^ ((seat + 1) * 0xd6e8feb86659fd93ULL); r.s = r.bits() ^ ((block + 1) * 0xa0761d6478bd642fULL); r.s = r.bits() ^ ((purpose + 1) * 0xe7037ed1a0b428dbULL);
  return r.bits();
}
// One deal from the study's own distribution: every seat's hand from its range weights, the whole tuple rejected when
// two hands share a card (or a card of the study board), then the remaining board cards without replacement. The
// distribution of Sampler::draw and of the trainer's MW::deal.
template <class RNG> inline bool drawDeal58(Evaluator &E, const std::vector<std::vector<double>> &cum, RNG &rng, uint64_t board, int known, long long tries) {
  const int n = E.m.n;
  for (long long t = 0; t < tries; t++) {
    E.poll(SITE_RETRY);
    uint64_t u = board; bool ok = true;
    for (int p = 0; p < n; p++) {
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
// Value of `seat` on the evaluator's current deal under both profiles of a finished response state:
//   r: (response, sigma_-seat) = policy average        s: sigma = policy current
// The seat's own actions are enumerated (each child is walked once and serves both sums); every other seat's action is
// sampled once from its strategy, which is the same in both profiles. E[r] and E[s] over the opponents' actions are
// the two values for this deal, so r - s is an unbiased sample of gain(R) and, being a difference of two convex
// combinations of terminal utilities, lies within [-(hi - lo), hi - lo] of the utility bounds.
// When the betting tree is small (futureActions "enumerate", or "auto" with at most 4,096 betting states) the other
// seats' actions are not sampled either: the walk returns the two values of the deal exactly, and only the cards are
// random. This matters where a strategy takes an action with a probability far below one in the number of samples:
// a sample that never draws it also never sees its variance, and a normal interval is then too narrow (the rare-tail
// failure described in study_stats55.hpp). Enumeration removes that source; the bounded interval covers the rest.
struct Pair58 { double r, s; };
template <class RNG> inline Pair58 pairValue(Evaluator &E, int seat, int state, const BS &t, int len, RNG &rng, const PathTree::TermPots *trec = nullptr, int node = -1) {
  E.visits++; E.poll(SITE_TREE);
  if (t.kind == 2) { const double v = E.terminal(t, len, 1.0, false, trec); return {v, v}; }
  BS buf; int cs, cn; const PathTree::TermPots *rec;
  if (t.kind == 1) { const BS &c = *E.childAt(state, node, t, CHANCE_SLOT, buf, cs, rec, cn); return pairValue(E, seat, cs, c, len + (len == 0 ? 3 : 1), rng, rec, cn); }
  if (t.k == 1) { const BS &c = *E.childAt(state, node, t, 0, buf, cs, rec, cn); return pairValue(E, seat, cs, c, len, rng, rec, cn); }
  const int k = t.k;
  if (t.actor != seat) {
    double p[8]; E.pol = Pol::Average; E.policy(state, k, t.actor, E.hand[t.actor], len, p, &t);
    if (!E.sampleActions) {   // small betting tree: the expectation over this seat's actions itself (no action is sampled at all)
      Pair58 out{0, 0};
      for (int a = 0; a < k; a++) {
        if (!(p[a] > 0)) continue;
        const BS &c = *E.childAt(state, node, t, a, buf, cs, rec, cn); const Pair58 v = pairValue(E, seat, cs, c, len, rng, rec, cn);
        out.r += p[a] * v.r; out.s += p[a] * v.s;
      }
      return out;
    }
    const double x = rng.next(); double cum = 0; int a = k - 1;
    for (int b = 0; b < k; b++) { cum += p[b]; if (x < cum) { a = b; break; } }
    while (p[a] <= 0 && a > 0) a--;
    const BS &c = *E.childAt(state, node, t, a, buf, cs, rec, cn); return pairValue(E, seat, cs, c, len, rng, rec, cn);
  }
  double pr[8], ps[8];
  E.pol = Pol::Average; E.policy(state, k, seat, E.hand[seat], len, pr, &t);
  E.pol = Pol::Current; E.policy(state, k, seat, E.hand[seat], len, ps, &t);
  E.pol = Pol::Average;
  Pair58 out{0, 0};
  for (int a = 0; a < k; a++) {
    if (!(pr[a] > 0) && !(ps[a] > 0)) continue;
    const BS &c = *E.childAt(state, node, t, a, buf, cs, rec, cn); const Pair58 v = pairValue(E, seat, cs, c, len, rng, rec, cn);
    out.r += pr[a] * v.r; out.s += ps[a] * v.s;
  }
  return out;
}
struct Block58 { long long n = 0; double d = 0, d2 = 0, r = 0, r2 = 0, s = 0, s2 = 0, mn = INFINITY, mx = -INFINITY, vmn = INFINITY, vmx = -INFINITY; bool failed = false; };
} // namespace es
} // namespace

extern "C" int mw_response_begin(MW *m, const char *json, size_t len, JB *out, char *err, int errlen) {
  using namespace es;
  if (!m || !m->es) { fail(err, errlen, "A trained response needs a native external-sampling study"); return 400; }
  if (m->response.seat >= 0) { fail(err, errlen, "This engine already holds a response problem; load the trained state again"); return 409; }
  JV *req = nullptr;
  try { req = parseRequest(json, len, err, errlen); } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  struct Free { JV *v; ~Free() { json_free(v); } } freeReq{req};
  try {
    const Fields F(req, {"seat", "seed", "estimator"});
    if (!F.has("seat")) throw QueryError{400, "seat is required"};
    // 5.10 (opt-in): the response of the seat may be trained by the experimental estimator "rbes" (es_rbes510.hpp)
    // instead of the default one. Whatever trains it, a response is a strategy of the seat and its gain is measured
    // afterwards on deals independent of its training, so the result remains a lower bound of the seat's
    // best-response gain; a better trainer gives a larger (tighter) one for the same training time.
    bool responseRbes = false;
    if (const JV *e = F.get("estimator")) {
      if (e->type != J_STR || (std::strcmp(e->str, "external") && std::strcmp(e->str, "rbes"))) throw QueryError{400, "estimator must be \"external\" or \"rbes\""};
      responseRbes = !std::strcmp(e->str, "rbes");
      if (responseRbes && (!m->turnGroups.empty() || !m->joint.empty())) throw QueryError{400, "estimator rbes is not available for turn or river representative groups or stratified deals"};
      if (responseRbes && !(m->es->exploreMix > 0)) throw QueryError{400, "estimator rbes needs a positive opponentExploration"};
    }
    const int seat = (int)F.optInt("seat", 0, m->n - 1, 0); const uint32_t seed = (uint32_t)F.optInt("seed", 0, 4294967295LL, 1);
    Game &g = *m->es; MW::Response58 &R = m->response;
    size_t seatRows = 0, seatValues = 0, otherRows = 0, otherEmpty = 0;
    for (const MW::RowMeta &rm : m->rows) { if ((size_t)rm.node >= g.states.actor.size()) throw QueryError{500, "A table row names an unknown betting state"}; if (g.states.actor[(size_t)rm.node] == seat) { seatRows++; seatValues += (size_t)rm.k; } }
    R.backup.assign(seatValues, 0.0); R.backupAt.assign(m->rows.size(), SIZE_MAX);
    size_t at = 0;
    for (size_t r = 0; r < m->rows.size(); r++) {
      MW::RowMeta &rm = m->rows[r]; const int k = rm.k; double *reg = m->vals.data() + rm.off, *avg = reg + k;
      if (g.states.actor[(size_t)rm.node] == seat) {
        R.backupAt[r] = at; for (int a = 0; a < k; a++) { R.backup[at + (size_t)a] = avg[a]; reg[a] = 0; avg[a] = 0; } at += (size_t)k;
      } else {
        // Regret matching divides max(0, x) by the sum; with x = the stored average (non-negative) that is the
        // evaluator's averageOf, value for value. A row whose average is all zero plays uniformly in both.
        double total = 0; for (int a = 0; a < k; a++) total += avg[a];
        for (int a = 0; a < k; a++) reg[a] = total > 0 ? avg[a] : 0.0;
        otherRows++; otherEmpty += !(total > 0);
      }
      rm.sync = 0;
    }
    R.seat = seat; R.finished = false; R.rowsBefore = m->rows.size(); R.seatRowsBefore = seatRows; R.sourceUpdates = m->iterations; R.sourceDeals = m->trainingDeals; R.seed = seed;
    // The response is trained by the default estimator (linear external sampling, every action of the learning seat
    // enumerated, one sampled action per opponent decision). Estimators that update several seats in one walk, or
    // that are experimental, are switched off; none of them is needed for a valid response.
    g.onlySeat = seat; g.enumerateFrom = 0; g.enumShare = 0; g.ownHands = false; g.dcfr = false; g.dcfrEager = false;
    g.rbes = responseRbes; g.rbTerminals = true; g.rbReference = false; g.terminalBaseline = g.terminalBaseline && !responseRbes; g.terminalExpectation = g.terminalExpectation && !responseRbes;
    m->linear = true; m->plus = false; m->dcfr = false; m->latin = false; m->batchStart = 0; m->batchDoubleEvery = 0;
    m->iterations = 0; m->trainingDeals = 0; m->limitReached = false;
    m->rng.state = deriveSeed(seed, 5800, seat); g.actionSeed = deriveSeed(seed, 5801, seat); g.actionRng.state = deriveSeed(seed, 5802, seat);
    // 5.11: a state of the counter-based streams trains its response with counter-based streams of the response
    // seed and a key domain of their own (one per seat), so they are no streams of the training.
    if (m->wide.on) { m->wide.k[0] = seed; m->wide.k[1] = em511::DOMAIN_RESPONSE | (uint64_t)seat; }
    m->evCache.clear();
    jb_printf(out, "{\"seat\":%d,\"seed\":%u,\"sourceUpdates\":%lld,\"sourceDeals\":%lld,\"seatInformationSets\":%zu,\"otherInformationSets\":%zu,\"otherInformationSetsWithoutAverage\":%zu,\"deals\":\"%s\"",
              seat, seed, R.sourceUpdates, R.sourceDeals, seatRows, otherRows, otherEmpty, m->batchDeals > 1 ? "frozen batches as in the study" : "one deal per update");
    if (responseRbes) jb_printf(out, ",\"estimator\":\"%s\"", Game::rbesId(true));   // 5.10: the default estimator leaves the 5.9 object unchanged
    jb_puts(out, "}");
    return 200;
  } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  catch (const std::bad_alloc &) { fail(err, errlen, "Out of memory"); return 503; }
}

extern "C" int mw_response_end(MW *m, JB *out, char *err, int errlen) {
  using namespace es;
  if (!m || !m->es || m->response.seat < 0) { fail(err, errlen, "No response problem is open"); return 409; }
  if (m->response.finished) { fail(err, errlen, "The response was already finished"); return 409; }
  Game &g = *m->es; MW::Response58 &R = m->response; const int seat = R.seat;
  size_t trained = 0, kept = 0, fresh = 0, changed = 0;
  for (size_t r = 0; r < m->rows.size(); r++) {
    MW::RowMeta &rm = m->rows[r]; if (g.states.actor[(size_t)rm.node] != seat) continue;
    const int k = rm.k; double *reg = m->vals.data() + rm.off, *avg = reg + k;
    double total = 0; for (int a = 0; a < k; a++) total += avg[a];
    const double *old = r < R.rowsBefore && R.backupAt[r] != SIZE_MAX ? R.backup.data() + R.backupAt[r] : nullptr;
    if (!old) { for (int a = 0; a < k; a++) reg[a] = 0; fresh += total > 0; continue; }   // sigma has no row here: uniform in both profiles
    double oldTotal = 0; for (int a = 0; a < k; a++) oldTotal += old[a];
    if (total > 0) {
      trained++;
      int bestNew = 0, bestOld = 0; for (int a = 1; a < k; a++) { if (avg[a] > avg[bestNew]) bestNew = a; if (old[a] > old[bestOld]) bestOld = a; }
      changed += oldTotal > 0 ? bestNew != bestOld : 1;
    } else { for (int a = 0; a < k; a++) avg[a] = old[a]; kept++; }   // never reached by the response: it keeps sigma there
    for (int a = 0; a < k; a++) reg[a] = oldTotal > 0 ? old[a] : 0.0;
  }
  R.finished = true; R.backup.clear(); R.backup.shrink_to_fit(); R.backupAt.clear(); R.backupAt.shrink_to_fit();
  g.onlySeat = -1; m->evCache.clear();
  jb_printf(out, "{\"seat\":%d,\"responseUpdates\":%lld,\"responseDeals\":%lld,\"tableLimitReached\":%s,\"seatInformationSetsOfSigma\":%zu,\"trained\":%zu,\"keptFromSigma\":%zu,\"newInformationSets\":%zu,\"mostFrequentActionChanged\":%zu}",
            seat, m->iterations, m->trainingDeals, m->limitReached ? "true" : "false", R.seatRowsBefore, trained, kept, fresh, changed);
  return 200;
}

// 5.9: mw_response_value (the sampled evaluation of a finished response state) is in response59.hpp. With
// {"streams":"5.8"} it draws the 5.8 streams defined above and reproduces the 5.8 estimate bit for bit.

// ---- 5.8: in-engine checks of parts that have no command-line surface (see mw.h; used by mwcli --selftest58) ----
extern "C" int mw_selftest58(JB *out) {
  using namespace es; int failed = 0; bool first = true;
  auto item = [&](const char *name, bool ok, const std::string &detail) {
    if (!ok) failed++;
    jb_puts(out, first ? "{\"name\":" : ",{\"name\":"); first = false; jb_str(out, name);
    jb_printf(out, ",\"passed\":%s,\"detail\":", ok ? "true" : "false"); jb_str(out, detail.c_str()); jb_putc(out, '}');
  };
  jb_putc(out, '[');
  try {
    { // The evaluation generator against the published SplitMix64 outputs (seed 0 and seed 1234567; the constants
      // were also recomputed with independent integer arithmetic in Python: MATHEMATICAL-VALIDATION-5.8.md).
      Rng64 a{0}, b{1234567}; const uint64_t wa[3] = {0xe220a8397b1dcdafULL, 0x6e789e6aa1b965f4ULL, 0x06c45d188009454fULL}, wb[3] = {0x599ed017fb08fc85ULL, 0x2c73f08458540fa5ULL, 0x883ebce5a3f27c77ULL};
      int bad = 0; for (int i = 0; i < 3; i++) { bad += a.bits() != wa[i]; bad += b.bits() != wb[i]; }
      Rng64 u{58}; double lo = 1, hi = 0, sum = 0; const int N = 1000000; for (int i = 0; i < N; i++) { const double x = u.next(); lo = std::min(lo, x); hi = std::max(hi, x); sum += x; }
      const double mean = sum / N;   // uniform on [0,1): mean 1/2, standard error 1/sqrt(12 N) = 0.00029
      item("evaluation random numbers: SplitMix64 reproduces its published outputs; values lie in [0, 1)", bad == 0 && lo >= 0 && hi < 1 && std::fabs(mean - 0.5) < 0.0015,
           std::to_string(bad) + " of 6 outputs differ; 1,000,000 draws in [" + std::to_string(lo) + ", " + std::to_string(hi) + "], mean " + std::to_string(mean));
    }
    { // Block streams: (seed, seat, block, purpose) must not give two blocks the same stream.
      std::vector<uint64_t> seeds; seeds.reserve(8 * 20000 * 2);
      for (uint64_t seat = 0; seat < 8; seat++) for (uint64_t block = 0; block < 20000; block++) for (uint64_t purpose = 0; purpose < 2; purpose++) seeds.push_back(seed58(58, seat, block, purpose));
      for (uint64_t s = 0; s < 1000; s++) seeds.push_back(seed58(s, 0, 0, 0));
      const size_t n = seeds.size(); std::sort(seeds.begin(), seeds.end()); const size_t distinct = (size_t)(std::unique(seeds.begin(), seeds.end()) - seeds.begin());
      // 58 itself is among the 1,000 study seeds, so exactly one stream appears twice.
      item("evaluation random numbers: every (seed, seat, block, purpose) has its own stream", distinct == n - 1, std::to_string(n) + " streams, " + std::to_string(distinct) + " distinct (one deliberate repeat)");
    }
    { // ICM: a cached answer is the answer of the recursion, bit for bit, through hits, fills and evictions, with a
      // small cache (127 entries: 31 sets of four) and with a large one; 2 to 8 seats, busted seats, equal stacks.
      long long calls = 0, different = 0, hits = 0, misses = 0, evictions = 0; uint64_t x = 0x5800c0de5800c0deULL;
      auto next = [&] { x ^= x << 13; x ^= x >> 7; x ^= x << 17; return x; };
      for (int n = 2; n <= 8; n++) for (int cacheKind = 0; cacheKind < 2; cacheKind++) {
        Tournament T; T.start.assign((size_t)n, 0.0); for (int i = 0; i < n; i++) T.start[(size_t)i] = 5 + (double)(next() % 40);
        for (int i = 0; i < n; i++) T.payout.push_back((double)(n - i) * (1 + (double)(next() % 5)));
        std::sort(T.payout.begin(), T.payout.end(), std::greater<double>());
        if (n > 3 && (next() & 1)) T.payout.resize((size_t)n - 2);   // fewer places paid than players
        Tournament::Workspace cached; T.prepare(cached, cacheKind ? 2048.0 * 1048576 : 1048576.0);
        std::vector<std::array<double, 8>> keys;
        for (int k = 0; k < 600; k++) { std::array<double, 8> c{}; double total = 0; for (int i = 0; i < n; i++) total += T.start[(size_t)i];
          // redistribute the chips: random shares, sometimes a busted seat, sometimes the starting stacks themselves
          double left = total; for (int i = 0; i < n; i++) { const double take = i + 1 == n ? left : std::floor(left * (double)(next() % 1000) / 1000.0 * 2) / 2; c[(size_t)i] = (next() % 7 == 0 && i + 1 < n) ? 0.0 : std::min(left, take); left -= c[(size_t)i]; }
          c[(size_t)n - 1] += left; if (k % 97 == 0) for (int i = 0; i < n; i++) c[(size_t)i] = T.start[(size_t)i];
          keys.push_back(c); }
        for (int round = 0; round < 6; round++) for (size_t k = 0; k < keys.size(); k++) {
          const auto &key = keys[(size_t)((k * 7 + (size_t)round * 13) % keys.size())];
          double a[8], b[8]; std::copy_n(key.begin(), 8, a); std::copy_n(key.begin(), 8, b);
          T.evaluate(a, n, cached);
          Tournament::Workspace fresh; T.prepare(fresh, 1048576.0); T.evaluate(b, n, fresh);   // an empty cache: the recursion itself
          calls++; different += std::memcmp(a, b, sizeof(double) * (size_t)n) != 0;
        }
        hits += cached.hits; misses += cached.misses; evictions += cached.evictions;
      }
      item("ICM: cached prize equities equal the recursion bit for bit (hits, fills and evictions; 2 to 8 seats)", different == 0 && hits > 0 && evictions > 0,
           std::to_string(calls) + " evaluations, " + std::to_string(different) + " differ; " + std::to_string(hits) + " hits, " + std::to_string(misses) + " misses, " + std::to_string(evictions) + " evictions");
    }
    { // ICM against an independent definition: the Malmuth-Harville finishing probabilities written out for three
      // players, P(i first) = s_i / S, P(j second | i first) = s_j / (S - s_i).
      Tournament T; T.start = {30, 50, 20}; T.payout = {50, 30, 20}; Tournament::Workspace ws; T.prepare(ws, 1048576.0);
      double c[8] = {30, 50, 20}; T.evaluate(c, 3, ws); const double s[3] = {30, 50, 20}, S = 100; double want[3] = {0, 0, 0};
      for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) if (j != i) { const int k = 3 - i - j; const double p = s[i] / S * s[j] / (S - s[i]); want[i] += p * 50; want[j] += p * 30; want[k] += p * 20; }
      double worst = 0; for (int i = 0; i < 3; i++) worst = std::max(worst, std::fabs(want[i] - c[i]));
      item("ICM: three-player prize equities equal the finishing-order formula written out", worst < 1e-12, "largest difference " + std::to_string(worst) + "; equities " + std::to_string(c[0]) + ", " + std::to_string(c[1]) + ", " + std::to_string(c[2]) + " (sum " + std::to_string(c[0] + c[1] + c[2]) + ")");
    }
  } catch (const std::exception &e) { item("in-engine checks ran to the end", false, e.what()); }
  jb_putc(out, ']');
  return failed;
}
