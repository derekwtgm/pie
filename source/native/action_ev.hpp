// EightMax 3.9/4.0: action-specific expected values and multiplayer response
// gains for native external-sampling studies. Included by mw.cpp after
// explorer.hpp, ev_control.hpp and showdown_table.hpp.
//
// WHAT IS COMPUTED (unchanged from 3.9)
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
// Where a row is missing the policy is unavailable there. "missing":"uniform"
// (default) substitutes the FALLBACK POLICY ("fallback": uniform | foldCheck |
// callCheck, default uniform) and reports how much of the evaluation passed
// through substitutions (4.0: the "coverage" object, row counts AND
// probability-weighted shares, with warnings); "missing":"refuse" returns 422.
//
// UTILITY CONVENTION (identical for every action at the node)
//   chip EV : net chips of the actor relative to the study root, the training
//             utility. "fromDecision" adds back chips already committed (sunk).
//   ICM     : the actor's tournament equity (expected payout) after the hand.
//
// METHODS
//   exact   - full enumeration of opponent hand tuples, every future board
//             card and every later action, weighted by probability.
//             4.0: runouts use cached showdown tables (showdown_table.hpp; CPU,
//             CUDA or both), and independent work items (action x first
//             opponent's hand) run on `threads` workers with per-item partial
//             sums reduced in item order, so the result does not depend on the
//             thread count. A timed-out or cancelled exact evaluation returns
//             408/409 and NO numbers: an incomplete exact sum is never
//             published.
//   sampled - Monte Carlo from the exact posterior (rejection sampling, uniform
//             runouts, later actions enumerated or drawn on-policy). All
//             actions of a sample share its cards (common random numbers).
//             4.0: samples are drawn in fixed blocks of 256 with per-block
//             random streams (deriveSeed(seed, block)) and reduced in block
//             order, so a completed run gives identical numbers for every
//             thread count. A run stopped by the time limit is labelled
//             "partial" and is published only when at least minSamples samples
//             were completed.
//
// STATISTICS (4.1; see action_stats.hpp for the method and its validation)
// Each sample yields one value per action (common random numbers), so the k
// estimates are correlated and paired. 4.0 compared each action with the
// highest estimate using unadjusted 95% intervals, which overstated evidence
// for the highest estimate (family-wise error 20-49% with 4-8 equal actions).
// 4.1 classifies sampled results with simultaneous intervals for all pairwise
// differences and for D_a = mu_a - max_{b!=a} mu_b (family-wise 95%):
//   supportedBest         better than every other action
//   highestEstimate       largest estimate, advantage not established
//   practicallyEquivalent only with equivalenceMargin delta: interval for D_a
//                         inside (-delta, delta)
//   differenceSupported   lower than at least one other action
//   differenceUncertain   ordering not established (NOT evidence of equality)
//   insufficientSamples   fewer than minSamples samples
// Exact results: highest | exactTie | withinMargin (|d| < delta) | lower.
// stdErr/ci95/vsBestCi95 remain per-action unadjusted values (labelled so);
// "multipleComparisons" carries the adjusted intervals and Holm p-values.
// "equivalentToBest" is kept for compatibility: true for the highest estimate,
// exact ties, exact differences within the margin, or practicallyEquivalent.
//
// RESPONSE GAINS (mw_response_gain) - three clearly distinguished modes
//   exact      - exact best response of one seat to the fixed policies of all
//                others over exact private hands and boards inside the betting
//                abstraction. Heads-up chip EV: exploitability (NashConv/2).
//   restricted - 4.0: best response restricted to the seat's decisions on the
//                study's FIRST street (later streets follow sigma), computed by
//                backward induction over the seat's first-street decision nodes
//                (deepest first; each choice evaluated with the deeper choices in
//                place). With selection:"exact" the gain is the exact value of
//                that restricted best response (equal to the full best response
//                for single-street studies, verified in tests); with
//                selection:"sampled" choices are made on one stream and the gain
//                is evaluated from the root on an independent stream. Unvisited
//                betting states (state -1) keep the fallback policy. A lower
//                bound on the full best-response gain.
//   sampled    - one-shot deviation at one decision node per seat (3.9).
// None of these is exact multiplayer exploitability for 3+ seats.
#include <climits>
#include <cmath>
#include <map>
#include <memory>
#include <unordered_set>
#include "coverage.hpp"
#include <optional>
#include <map>
#include <set>
#include <tuple>
namespace {
namespace es {
struct EvUnavailable { std::string why; };
enum class Pol { Average, Current };
enum class Fallback { Uniform, FoldCheck, CallCheck };
inline const char *fallbackName(Fallback f) { return f == Fallback::Uniform ? "uniform" : f == Fallback::FoldCheck ? "foldCheck" : "callCheck"; }
inline const char *fallbackText(Fallback f) { return f == Fallback::Uniform ? "uniform over the legal actions" : f == Fallback::FoldCheck ? "fold when facing a bet, otherwise check (slot 0)" : "call when facing a bet, otherwise check"; }
inline double nowSec() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
inline double nChooseK(int n, int k) { if (k < 0 || n < k) return 0; double r = 1; for (int i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }
// Process-wide cap on evaluation worker threads (the desktop host lowers it so
// concurrent jobs and training share the CPU; see server.c).
inline std::atomic<int> &evThreadCap() { static std::atomic<int> cap{std::max(1, (int)std::thread::hardware_concurrency())}; return cap; }

// Everything one request shares between its worker threads.
struct EvShared {
  EvControl ctl; ShowdownStats show; Device device = Device::Auto; size_t gpuBudget = 512ULL << 20; long long memoryBudget = 512LL << 20;
  // EM_EV_NO_TABLES=1 (tests, benchmarks): use the 3.9 per-board runout enumeration.
  bool noTables = std::getenv("EM_EV_NO_TABLES") != nullptr;
  // utility:"chip" in a tournament study evaluates net chips instead of ICM equity.
  bool forceChip = false;
  Fallback fallback = Fallback::Uniform;
  // 4.2: longest wait of a GPU-preferred table for a busy device before it is
  // scored on the CPU instead (cancellation is observed while waiting).
  long long gpuWaitMs = 2000;
  // 4.2: expected CUDA start-up for the Automatic warm-up rule (EM_GPU_INIT_ESTIMATE_S).
  double gpuInitEstimate = [] { const char *e = std::getenv("EM_GPU_INIT_ESTIMATE_S"); const double v = e ? std::atof(e) : 0.1; return v >= 0 && v < 1e6 ? v : 0.1; }();   // 4.4: 0.1 s (4.3: 0.3 s); the measured open on the RTX 4060 Ti was 0.064-0.098 s
  // 4.3: request-wide shared showdown tables (showdown_table.hpp). Per-seat
  // children of a response-gain request point at their parent's cache.
  // EM_EV_PRIVATE_TABLES=1 restores 4.2's private per-worker tables (A/B tests).
  // 4.8: the request-wide cache keeps up to EM_EV_TABLE_CAP tables (default 64) instead of
  // max(4, 3 x workers); bytes stay governed by the request memory budget (makeRoom). 4.7 rebuilt
  // the same preflop all-in tables hundreds of times in exact best responses (528 tables for the
  // 16 deals of the four-player bubble study). EM_EV_TABLE_CAP=0 restores the 4.7 rule.
  std::shared_ptr<TableCache> cache = [this] { auto c = std::make_shared<TableCache>(); c->ctl = &ctl; c->countCap = sharedTableCap(); return c; }();
  static size_t sharedTableCap() { static const size_t c = [] { const char *e = std::getenv("EM_EV_TABLE_CAP"); const long v = e ? std::strtol(e, nullptr, 10) : 64; return v <= 0 ? (size_t)0 : (size_t)std::clamp<long>(v, 4, 65536); }(); return c; }
  // 4.4: EM_GPU_AUTO_MODEL=4.3 keeps the 4.3 Automatic rule (model only, pull split) for A/B runs.
  bool autoModel43 = [] { const char *e = std::getenv("EM_GPU_AUTO_MODEL"); return e && !std::strcmp(e, "4.3"); }();
  bool privateTables = std::getenv("EM_EV_PRIVATE_TABLES") != nullptr;
  // 4.3: rows per GPU batch (chunks of 16,384 boards); EM_GPU_BATCH_CHUNKS overrides.
  int gpuBatchChunks = [] { const char *e = std::getenv("EM_GPU_BATCH_CHUNKS"); const int v = e ? std::atoi(e) : 8; return v >= 1 && v <= 64 ? v : 8; }();
  // 4.3: coverage capacity (coverage.hpp). coverageMiB bounds the slot memory of all
  // worker tables together (shared pool) and sets the exact key limit (32 bytes a key).
  size_t coverageKeys = size_t(1) << 21; long long coverageBytes = 64LL << 20;
  std::shared_ptr<std::atomic<long long>> coveragePool = std::make_shared<std::atomic<long long>>(64LL << 20);
  void setCoverage(long long mib) { coverageBytes = mib << 20; coverageKeys = (size_t)std::max<long long>(1024, coverageBytes / 32); coveragePool->store(coverageBytes); }
  // 4.4: request-wide exact coverage set filled concurrently by the workers (coverage.hpp,
  // SharedCoverage); when present nothing is merged after the workers stop. Action-EV
  // requests create it; response-gain seats keep one private table per seat evaluator.
  // EM_EV_MERGED_COVERAGE=1 restores the 4.3 per-worker tables and final merge (A/B tests).
  std::shared_ptr<emcov::SharedCoverage> covSet;
  // 4.5: coverageMiB is a hard ceiling on the LIVE bytes of the request's coverage component
  // (coverage.hpp, Budget): every tier including retired ones, the tier descriptors, the sketches,
  // the set object with its lock cells and every worker's filter are reserved in covLedger before
  // they are allocated. 1/16 of the budget is set aside for the worker filters (their size follows
  // from the worker count); the table plan uses the rest and does not depend on the worker count.
  std::shared_ptr<emcov::Budget> covLedger; size_t covFilterEntries = 0;
  void shareCoverage(int workers = 1) {
    if (std::getenv("EM_EV_MERGED_COVERAGE")) return;
    const size_t budget = (size_t)coverageBytes, filterBytes = budget / 16;
    covLedger = std::make_shared<emcov::Budget>(budget);
    covSet = std::make_shared<emcov::SharedCoverage>(covLedger, budget - filterBytes, coverageKeys); covSet->stop = &ctl.stop;
    covFilterEntries = emcov::WorkerFilter::entriesFor(filterBytes, (size_t)std::max(1, workers));
  }
  // Sets the request's thread budget and the number of top-level workers about to run.
  void plan(int budget, int workers) { cache->threadBudget = std::max(1, budget); cache->workers = std::max(1, workers); }
};
inline long long nsSince(double t0) { return (long long)((nowSec() - t0) * 1e9); }
// 4.2: distinct information sets are counted by emcov::Coverage (coverage.hpp):
// unmodified 128-bit keys, merge = set union, growable table. See that header
// for the 4.1 double-counting defect this replaces.
using Coverage = emcov::Coverage;

struct Evaluator {
  const MW &m; const Game &g; Pol pol; bool refuseMissing; int actor; EvShared *sh;
  Tournament::Workspace icm; bool tour; LPot pots[24];
  int hand[8] = {}; int cards[5] = {}; uint64_t used = 0;
  long long visits = 0; bool exact = true, sampleActions = false;
  Rng rng{1}; double fbMass = 0, totMass = 0;
  Poller poller; Coverage cov; emcov::WorkerFilter covFilter;   // 4.4: cov holds only visit counters when sh->covSet is set
  // 4.2: EM_COVERAGE_AUDIT=1 records every lookup's raw identity tuple in a
  // std::set (no hashing, no key packing) as an independent reference for the
  // distinct counts; tests compare it with `cov`. Off by default (slow).
  using AuditRow = std::tuple<int, int, int, int, uint32_t, bool>;   // synthetic?, seat, state, hand|index, code, stored
  std::unique_ptr<std::set<AuditRow>> audit{std::getenv("EM_COVERAGE_AUDIT") ? new std::set<AuditRow> : nullptr};
  // restricted best response: pure actions of devSeat at (state, hand)
  const std::unordered_map<uint64_t, int> *dev = nullptr; int devSeat = -1;
  struct Key { int hand; uint32_t code; bool ok; };
  // 4.4: the key memo is a direct-mapped cache in one flat array (4.3: std::unordered_map with up
  // to 262,144 nodes per worker, all freed one by one on the calling thread AFTER the response was
  // built: about 40 ms past a 10 s limit with 4 workers, more with more workers). key() is a pure
  // function of (seat, range index, first `len` cards), so what is cached, evicted or recomputed
  // cannot change a result. It starts with 1,024 entries (24 KiB) and is quadrupled when half of
  // it has been written, up to memoCap entries, so a short request touches little memory; it is
  // released with one call.
  struct MemoEntry { uint64_t mk; int hand; uint32_t code; uint32_t state; };   // state 0 empty, 1 ok=false, 2 ok=true
  struct MemoFree { void operator()(MemoEntry *p) const { std::free(p); } };
  std::unique_ptr<MemoEntry[], MemoFree> memo; size_t memoSlots = 0, memoUsed = 0, memoCap = 262144; bool memoOff = false;
  void memoGrow() {
    const size_t n = memoSlots ? std::min(std::bit_ceil(memoCap), memoSlots * 4) : std::min<size_t>(1024, std::bit_ceil(memoCap));
    MemoEntry *fresh = static_cast<MemoEntry *>(std::calloc(n, sizeof(MemoEntry)));
    if (!fresh) { if (!memo) memoOff = true; else memoCap = memoSlots; return; }   // keep what there is
    size_t used = 0;
    for (size_t i = 0; i < memoSlots; i++) if (memo[i].state) { MemoEntry &d = fresh[(size_t)emcov::mix64(memo[i].mk) & (n - 1)]; used += d.state == 0; d = memo[i]; }
    memo.reset(fresh); memoSlots = n; memoUsed = used;
  }
  Evaluator(const MW &mm, const Game &gg, Pol p, bool refuse, int seat, EvShared *shared) : m(mm), g(gg), pol(p), refuseMissing(refuse), actor(seat), sh(shared), tour(!mm.tournament.start.empty() && !shared->forceChip) {
    poller.ctl = &sh->ctl; poller.fault = sh->ctl.faultSite;
    if (tour) m.tournament.prepare(icm, std::min(m.budgetBytes, 64.0 * 1048576));
    memoCap = (size_t)std::clamp<long long>(sh->memoryBudget / 16 / 96, 4096, 262144);
    cov.limit = sh->coverageKeys; cov.pool = sh->coveragePool;   // 4.3
    if (sh->covSet) covFilter.configure(sh->covLedger, sh->covFilterEntries);   // 4.5: the filter is inside the coverage budget
  }
  ~Evaluator() { poller.flushWork(); }
  Evaluator(const Evaluator &) = delete; Evaluator &operator=(const Evaluator &) = delete;
  inline void poll(int site) { poller(site, visits); }
  static uint64_t devKey(int state, int h) { return ((uint64_t)(uint32_t)state << 16) | (uint64_t)(uint32_t)h; }
  // Strategy key of (seat, range index) with the first `len` public cards; mirrors rowOf().
  Key key(int seat, int idx, int len) {
    const uint64_t mk = ((uint64_t)seat << 58) | ((uint64_t)idx << 44) | ((uint64_t)len << 40) | (uint64_t)cardsCode(cards, len);
    if (!memoOff && (!memo || (2 * memoUsed >= memoSlots && memoSlots < std::bit_ceil(memoCap)))) memoGrow();
    MemoEntry *e = memo ? &memo[(size_t)emcov::mix64(mk) & (memoSlots - 1)] : nullptr;
    if (e && e->state && e->mk == mk) return Key{e->hand, e->code, e->state == 2};
    Key k{m.hands[(size_t)seat][(size_t)idx].strategyHand, cardsCode(cards, len), true};
    if (g.groups.on) { k.hand = 0; k.ok = groupKeyAt(m, g.groups, g.startKey, seat, idx, cards, len, k.code); }
    else if (!m.turnGroups.empty()) {
      const int slot = len == 5 ? cards[4] + 1 : 0;
      const int id = m.turnGroups[(size_t)seat][(size_t)slot * m.hands[(size_t)seat].size() + (size_t)idx];
      k.hand = id % 2048; k.code = cardsCode(cards, 4) + (uint32_t)(id / 2048);
    }
    if (e) { memoUsed += e->state == 0; *e = MemoEntry{mk, k.hand, k.code, k.ok ? 2u : 1u}; }
    return k;
  }
  void fallbackPolicy(const BS *t, int k, double *p) const {
    if (sh->fallback == Fallback::Uniform || !t) { for (int a = 0; a < k; a++) p[a] = 1.0 / k; return; }
    for (int a = 0; a < k; a++) p[a] = 0;
    if (sh->fallback == Fallback::FoldCheck || !t->facing || k < 2) p[0] = 1; else p[1] = 1;
  }
  // sigma of `seat` at committed state `state`. Returns false when it had to be substituted.
  bool policy(int state, int k, int seat, int idx, int len, double *p, const BS *t = nullptr) {
    long long row = -1; Key kk{0, 0, false};
    if (state >= 0) { kk = key(seat, idx, len); if (kk.ok) row = m.findRow(rowKey((uint32_t)state, kk.hand, kk.code)); }
    const bool ok = pol == Pol::Average ? averageOf(m, row, k, p) : (row >= 0 && currentOf(m, row, k, p));
    const emcov::Key ck = state >= 0 && kk.ok ? emcov::rowKeyOf(rowKey((uint32_t)state, kk.hand, kk.code), seat) : emcov::synthKeyOf(state, seat, idx);
    if (emcov::SharedCoverage *cs = sh->covSet.get()) {   // 4.4: no merge after the workers stop
      cov.countOnly(ok); const uint8_t what = ok ? Coverage::STORED : Coverage::FALLBACK; const uint64_t h = cs->hash(ck);
      if (covFilter.miss(ck, what, h)) cs->markHashed(ck, what, h);
    } else cov.note(ck, ok);
    if (audit) audit->insert({state >= 0 && kk.ok ? 0 : 1, seat, state, state >= 0 && kk.ok ? kk.hand : idx, state >= 0 && kk.ok ? kk.code : 0u, ok});
    if (ok) return true;
    if (refuseMissing) throw EvUnavailable{"seat " + std::to_string(seat) + " has no stored " + std::string(pol == Pol::Average ? "average" : "current") + " strategy at betting state " + std::to_string(state) + " for one of the evaluated hands"};
    fallbackPolicy(t, k, p);
    return false;
  }
  static bool contested(const LPot *pots, int np) { for (int q = 0; q < np; q++) if (std::popcount(pots[q].mask) >= 2) return true; return false; }
  // Utility of the actor at a terminal given every contesting seat's score.
  double utilityWithScores(const BS &t, int np, const int *score) {
    const int n = m.n; double util[8];
    if (!tour && !rankCacheOff()) {
      // 4.8: chip EV needs only the actor's entry: the same start value and the same additions in
      // the same pot order as the loop below (so the same double); the other seats are skipped.
      double u = -t.total[actor] - m.anteOf[(size_t)actor];
      for (int q = 0; q < np; q++) {
        const uint32_t mask = pots[q].mask; if (!(mask >> actor & 1)) continue;
        int top = INT_MIN, count = 0;
        for (uint32_t x = mask; x; x &= x - 1) { const int e = std::countr_zero(x); if (score[e] > top) { top = score[e]; count = 1; } else if (score[e] == top) count++; }
        if (score[actor] == top) u += pots[q].amount / count;
      }
      return u;
    }
    for (int p = 0; p < n; p++) util[p] = tour ? t.behind[p] : -t.total[p] - m.anteOf[(size_t)p];
    for (int q = 0; q < np; q++) {
      const uint32_t mask = pots[q].mask; int top = INT_MIN, count = 0;
      for (uint32_t x = mask; x; x &= x - 1) { const int e = std::countr_zero(x); if (score[e] > top) { top = score[e]; count = 1; } else if (score[e] == top) count++; }
      if (!count) continue;
      const double share = pots[q].amount / count;
      for (uint32_t x = mask; x; x &= x - 1) { const int e = std::countr_zero(x); if (score[e] == top) util[e] += share; }
    }
    if (tour) { poll(SITE_ICM); m.tournament.evaluate(util, n, icm); }
    return util[actor];
  }
  // Utility of the actor at a terminal with all five board cards known.
  // 4.8: per-board rank cache. A seat's seven-card rank depends only on the five board cards
  // and its hole cards, but exact traversals (best responses, exact EVs) reach the same river
  // board through many betting sequences and opponent-hand tuples and re-evaluated every hand
  // each time (36.8 million evalSeven calls for one seat of the six-player flop study). The
  // cache stores evalSeven's own result per (seat, range index) for the current board and is
  // invalidated by a generation stamp when the board changes, so every score - and therefore
  // every utility and every printed bit - is the one evalSeven returns. Memory: one 8-byte
  // entry per range hand per seat (at most 8 x 1326), allocated once per evaluator.
  // EM_EV_NO_RANK_CACHE=1 restores the 4.7 path (used by the 4.8 bit-identity tests).
  struct RankSlot { uint32_t gen; int score; };
  std::vector<std::vector<RankSlot>> rankCache; uint64_t rankBoard = ~0ULL; uint32_t rankGen = 0; long long rankHits = 0, rankMisses = 0;
  static bool rankCacheOff() { static const bool off = std::getenv("EM_EV_NO_RANK_CACHE") != nullptr; return off; }
  int seatScore(int p) {
    const Hand &h = m.hands[(size_t)p][(size_t)hand[p]];
    if (rankCacheOff()) return evalSeven(cards, h.a, h.b);
    if (rankCache.empty()) { rankCache.resize((size_t)m.n); for (int q = 0; q < m.n; q++) rankCache[(size_t)q].assign(m.hands[(size_t)q].size(), RankSlot{0, 0}); }
    RankSlot &r = rankCache[(size_t)p][(size_t)hand[p]];
    if (r.gen == rankGen && rankGen != 0) { rankHits++; return r.score; }
    rankMisses++; r.score = evalSeven(cards, h.a, h.b); r.gen = rankGen; return r.score;
  }
  void rankBoardIs() {
    if (rankCacheOff()) return;
    const uint64_t b = (1ULL << cards[0]) | (1ULL << cards[1]) | (1ULL << cards[2]) | (1ULL << cards[3]) | (1ULL << cards[4]);
    if (b != rankBoard || rankGen == 0) { rankBoard = b; if (++rankGen == 0) { for (auto &v : rankCache) for (auto &x : v) x.gen = 0; rankGen = 1; } }
  }
  double scored(const BS &t, int np) {
    int score[8]; rankBoardIs();
    if (rankCacheOff()) { for (int p = 0; p < m.n; p++) score[p] = seatScore(p); }
    else { uint32_t inPot = 0; for (int q = 0; q < np; q++) inPot |= pots[q].mask; for (int p = 0; p < m.n; p++) score[p] = (inPot >> p & 1) ? seatScore(p) : 0; }   // a seat in no pot is never read
    // 4.1: one board evaluation (all seats scored on one board); checked every
    // 256 boards so the overshoot of maxBoardEvaluations is at most 256 per worker.
    if (++poller.boards - poller.boardsFlushed >= 256 && !poller.flushWork()) { sh->ctl.raise(6, SITE_RUNOUT); sh->ctl.rethrowStop(); }
    return utilityWithScores(t, np, score);
  }
  double uncontested(const BS &t, int np) {
    const int n = m.n; double util[8];
    for (int p = 0; p < n; p++) util[p] = tour ? t.behind[p] : -t.total[p] - m.anteOf[(size_t)p];
    for (int q = 0; q < np; q++) if (pots[q].mask) util[std::countr_zero(pots[q].mask)] += pots[q].amount;
    if (tour) { poll(SITE_ICM); m.tournament.evaluate(util, n, icm); }
    return util[actor];
  }
  // ---- showdown tables (4.3: shared, cooperatively built) ----
  // Scores the boards of chunk `c` on the CPU and adds every board's full-seat
  // rank pattern to `local` while the row is still in cache. Static: also run by
  // helper threads that have no Evaluator (own Poller, the owner's statistics).
  static void scoreChunk(ShowTable &T, unsigned long long c, Poller &pl, long long visits, ShowdownStats &st, FlatHist &local) {
    const double t0 = nowSec();
    const unsigned long long first = c * ShowTable::CHUNK, end = std::min(T.boards, first + ShowTable::CHUNK);
    const int need = 5 - T.len; int x[5]; int b[5]; std::copy_n(T.prefix, T.len, b);
    unrankColex(first, need, T.deckCount, x);
    for (unsigned long long i = first; i < end; i++) {
      for (int r = 0; r < need; r++) b[T.len + r] = T.deck[x[r]];
      int32_t *row = T.scores.data() + (size_t)(i * (unsigned long long)T.n);
      // 4.3: the board's suit masks are built once and shared by every seat (evalSeven() per seat rebuilt them)
      int bm[4] = {0, 0, 0, 0}; for (int q = 0; q < 5; q++) bm[b[q] & 3] |= 1 << (b[q] >> 2);
      for (int p = 0; p < T.n; p++) {
        int sm[4] = {bm[0], bm[1], bm[2], bm[3]}; const int h1 = T.holes[2 * p], h2 = T.holes[2 * p + 1];
        sm[h1 & 3] |= 1 << (h1 >> 2); sm[h2 & 3] |= 1 << (h2 >> 2);
        row[p] = evalMasks(sm[0], sm[1], sm[2], sm[3]);
      }
      local.add(fullPattern(row, T.n));
      pl(SITE_TABLE, visits); pl(SITE_PATTERN, visits);
      if (i + 1 < end) nextColex(x, need, T.deckCount);
    }
    const long long ns = nsSince(t0); st.nsCpuTables += ns; cpuTableNanos() += ns;
    noteRate(cpuFusedNsPerEval(), (double)ns / ((double)(end - first) * T.n));
    st.cpuBoards += (long long)(end - first);
  }
  // Full-seat patterns of a chunk scored by the device.
  static void patternChunk(ShowTable &T, unsigned long long c, Poller &pl, long long visits, ShowdownStats &st, FlatHist &local) {
    const double t0 = nowSec();
    const unsigned long long first = c * ShowTable::CHUNK, end = std::min(T.boards, first + ShowTable::CHUNK);
    for (unsigned long long i = first; i < end; i++) { local.add(fullPattern(T.scores.data() + (size_t)(i * (unsigned long long)T.n), T.n)); pl(SITE_PATTERN, visits); }
    st.nsPatterns += nsSince(t0); st.patternChunksForGpu++;
  }
  static void finishChunk(ShowTable &T, unsigned long long c) {
    T.chunkState[c].store(ShowTable::C_DONE, std::memory_order_release);
    if (T.chunksDone.fetch_add(1) + 1 == T.chunks) { std::lock_guard<std::mutex> g(T.buildMu); T.buildCv.notify_all(); }
  }
  static void mergeLocal(ShowTable &T, FlatHist &local) {
    if (!local.used) return;
    std::lock_guard<std::mutex> g(T.buildMu);
    if (!T.fullAcc.used) { T.fullAcc.swap(local); local.clear(); return; }   // first contributor: no copy
    local.each([&](uint32_t k, uint32_t v) { T.fullAcc.add(k, v); }); local.clear();
  }
  // Takes part in building T until no work is left: scores free chunks (when the
  // CPU may score), else pattern-counts chunks the device has scored. Returns
  // when every chunk is done or the build was aborted. Every participant merges
  // its local histogram before leaving; integer counts make the merged histogram
  // independent of who did which chunk.
  static void participate(ShowTable &T, Poller &pl, long long visits, ShowdownStats &st) {
    T.participants++;
    struct Leave { ShowTable &T; FlatHist local; ~Leave() { try { mergeLocal(T, local); } catch (...) { T.abort = true; } T.participants--; std::lock_guard<std::mutex> g(T.buildMu); T.buildCv.notify_all(); } } leave{T, {}};
    try {
      while (!T.abort.load()) {
        if (T.chunksDone.load() >= T.chunks) return;
        if (T.cpuMayScore.load()) {
          const unsigned long long c = T.nextChunk.fetch_add(1);
          if (c < T.chunks) { T.chunkState[c] = ShowTable::C_SCORING; scoreChunk(T, c, pl, visits, st, leave.local); finishChunk(T, c); continue; }
        }
        bool found = false;
        for (unsigned long long c = 0; c < T.chunks && !T.abort.load(); c++) {
          uint8_t e = ShowTable::C_SCORED;
          if (T.chunkState[c].load(std::memory_order_acquire) == ShowTable::C_SCORED && T.chunkState[c].compare_exchange_strong(e, ShowTable::C_PATTERN)) { patternChunk(T, c, pl, visits, st, leave.local); finishChunk(T, c); found = true; }
        }
        if (found) continue;
        if (T.chunksDone.load() >= T.chunks) return;
        { std::unique_lock<std::mutex> l(T.buildMu); T.buildCv.wait_for(l, std::chrono::microseconds(500)); }
        pl.waitCheck(SITE_TABLE, visits);
      }
    } catch (...) { T.abort = true; throw; }
  }
  // 4.2: acquire the device. wait=false: only if free now. wait=true: up to
  // sh->gpuWaitMs, retried every millisecond, polling for cancellation between slices.
  bool lockGpu(std::unique_lock<std::mutex> &lock, bool wait) {
    const double t0 = nowSec();
    if (!wait) { if (!lock.try_lock()) return false; }
    else for (;;) {
      if (lock.try_lock()) break;
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
      poller.now(SITE_GPU, visits);   // throws EvStop on cancellation or deadline (lock not held)
      if ((nowSec() - t0) * 1000 >= (double)sh->gpuWaitMs) { sh->show.gpuWaitTimeouts++; sh->show.nsGpuLockWait += nsSince(t0); return false; }
    }
    sh->show.nsGpuLockWait += nsSince(t0); return true;
  }
  // A failed device call: record it, then either leave this table to the CPU
  // (budget, reserve, out of memory) or disable the device for the process.
  void gpuFailed(EvGpu &G, const char *stage) {
    CudaError e = G.dev.error; G.lastError = e; sh->show.gpuFailures++;
    sh->show.error(e, true);
    if (e.set && cudaTransient(e)) { sh->show.gpuTransient++; sh->show.note(std::string("GPU declined one table (") + stage + "): " + e.summary() + "; the table was scored on the CPU"); }
    else { const std::string why = std::string("CUDA failure during an EV table (") + stage + "): " + (e.set ? e.summary() : "unknown"); G.disable(why); sh->show.note(why + "; GPU disabled for EV tables, unscored boards finished on the CPU"); }
    G.dev.clearError();
  }
  std::vector<unsigned char> gpuSpec(const ShowTable &T) const {
    std::vector<unsigned char> spec; spec.push_back((unsigned char)T.n); spec.push_back((unsigned char)T.len); spec.push_back((unsigned char)T.deckCount);
    for (int i = 0; i < 2 * T.n; i++) spec.push_back((unsigned char)T.holes[i]);
    for (int i = 0; i < T.len; i++) spec.push_back((unsigned char)T.prefix[i]);
    for (int i = 0; i < T.deckCount; i++) spec.push_back((unsigned char)T.deck[i]);
    return spec;
  }
  static const std::vector<unsigned long long> &binomTable() { static const std::vector<unsigned long long> b = [] { std::vector<unsigned long long> v(53 * 6); for (int x = 0; x <= 52; x++) for (int r = 0; r <= 5; r++) v[(size_t)x * 6 + r] = binom64(x, r); return v; }(); return b; }
  // Device scores of boards [a,b) into dst (rows of T.n). Call with G.mu held.
  // Launches are split so one launch never needs more device memory than the
  // request's GPU budget allows (4.2 rule; at least 4,096 rows: a budget below
  // that is refused before any driver call and the table goes to the CPU).
  bool gpuRange(EvGpu &G, const ShowTable &T, const std::vector<unsigned char> &spec, unsigned long long a, unsigned long long b, int32_t *dst, bool overlapCpu, ShowTable *coop, FlatHist *local) {
    const size_t fixedBytes = spec.size() + binomTable().size() * 8, per = 4ULL * (size_t)T.n;
    const unsigned long long room = sh->gpuBudget > fixedBytes ? (unsigned long long)((sh->gpuBudget - fixedBytes) / per) : 0;
    const unsigned long long piece = std::max<unsigned long long>(4096, room);
    for (unsigned long long x = a; x < b; x += piece) {
      const unsigned long long y = std::min(b, x + piece);
      poller.now(SITE_GPU, visits);
      double t0 = nowSec();
      if (!G.dev.boardsBegin(spec, binomTable(), x, y, T.n, sh->gpuBudget)) { gpuFailed(G, "allocation, upload or launch"); return false; }
      sh->show.nsGpuUploadLaunch += nsSince(t0);
      // 4.3: while the kernel runs this thread scores one CPU chunk (hybrid/auto pull)
      if (overlapCpu && coop && coop->cpuMayScore.load()) { const unsigned long long c = coop->nextChunk.fetch_add(1); if (c < coop->chunks) { coop->chunkState[c] = ShowTable::C_SCORING; scoreChunk(*coop, c, poller, visits, sh->show, *local); finishChunk(*coop, c); } }
      t0 = nowSec();
      if (!G.dev.boardsFinish(dst + (size_t)((x - a) * (unsigned long long)T.n))) { gpuFailed(G, "download"); return false; }
      sh->show.nsGpuDownload += nsSince(t0); sh->show.gpuBatches++;
      const long long peak = (long long)G.dev.allocated(); long long cur = sh->show.gpuPeakBytes.load(); while (peak > cur && !sh->show.gpuPeakBytes.compare_exchange_weak(cur, peak)) {}
    }
    G.touch();
    return true;
  }
  // The device's part of building T (owner thread, device lock held): verify once
  // per process (65,536 boards scored on both and compared bit for bit; the CPU
  // scores are kept), then pull batches of chunks until none is left. Any failure
  // lets the CPU score everything not yet scored by the device (the failed batch
  // is rescored on the CPU here: nothing counted twice, nothing omitted).
  void cpuScoreRange(ShowTable &T, unsigned long long c0, unsigned long long c1, FlatHist &local) {
    for (unsigned long long c = c0; c < c1; c++) { T.chunkState[c] = ShowTable::C_SCORING; scoreChunk(T, c, poller, visits, sh->show, local); finishChunk(T, c); }
  }
  // reserved [r0,r1): verification chunks claimed by the owner before any helper
  // started (so the device is verified even when CPU threads are fast); scored
  // here on the CPU in every case (and compared with the device when it is open).
  void gpuBuild(ShowTable &T, Device d, FlatHist &local, unsigned long long r0, unsigned long long r1, bool &reservedDone, unsigned long long reservedEnd) {
    EvGpu &G = EvGpu::get(); ShowdownStats &st = sh->show;
    const std::vector<unsigned char> spec = gpuSpec(T);
    auto cpuFallback = [&](unsigned long long c0, unsigned long long c1) {
      T.cpuMayScore = true; { std::lock_guard<std::mutex> g(T.buildMu); T.buildCv.notify_all(); }
      cpuScoreRange(T, c0, c1, local);
    };
    if (!G.verified) {
      if (r1 <= r0) return;
      const unsigned long long c0 = r0, c1 = r1, a = c0 * ShowTable::CHUNK, b = std::min(T.boards, c1 * ShowTable::CHUNK); reservedDone = true;
      const double tv = nowSec(), tc = nowSec();
      for (unsigned long long c = c0; c < c1; c++) { T.chunkState[c] = ShowTable::C_SCORING; scoreChunk(T, c, poller, visits, st, local); }
      const double cpu = nowSec() - tc;
      std::vector<int32_t> mine((size_t)(b - a) * (size_t)T.n);
      const double tg = nowSec(); const bool ok = gpuRange(G, T, spec, a, b, mine.data(), false, nullptr, nullptr); const double gpu = nowSec() - tg;
      for (unsigned long long c = c0; c < c1; c++) finishChunk(T, c);
      st.nsGpuVerify += nsSince(tv); G.verifications++;
      if (ok) st.verificationBoards += (long long)(b - a);
      if (!ok) { T.cpuMayScore = true; return; }
      if (!std::equal(mine.begin(), mine.end(), T.scores.begin() + (long)(a * (unsigned long long)T.n))) {
        CudaError e; e.set = true; e.op = "verification (" + std::to_string(b - a) + " boards)"; e.code = 0; e.name = "EM_GPU_MISMATCH"; e.text = "device scores differed from the CPU reference"; e.thread = cudaHostThread(); e.context = "current";
        st.error(e, true); st.gpuFailures++;
        G.disable("CUDA showdown scores differed from the CPU reference; GPU disabled for EV tables"); st.note(G.reason); T.cpuMayScore = true; return;
      }
      const double evals = (double)(b - a) * T.n;
      G.cpuNsPerEval = cpu * 1e9 / evals; G.gpuNsPerEval = gpu * 1e9 / evals; noteRate(G.gpuBatchFixedSec, std::max(0.0, gpu - evals * 1.0e-9));
      G.verified = true;
      if (d == Device::Auto) {   // re-decide with the measured rates
        Auto43In in = autoInputs(T); if (autoChoice43(in) != Auto43::Gpu) { st.cpuSlower++; T.cpuMayScore = true; return; }
      }
    }
    const bool overlap = d != Device::Gpu;   // gpu-preferred: the CPU threads only pattern-count
    long long boardsOnGpu = 0; bool reservedBatch = reservedEnd > r1;
    for (;;) {
      const unsigned long long k = (unsigned long long)std::max(1, sh->gpuBatchChunks);
      // the reserved first batch, then batches pulled from the shared counter
      const unsigned long long c0 = reservedBatch ? r1 : T.nextChunk.fetch_add(k);
      const unsigned long long cEnd = reservedBatch ? reservedEnd : c0 + k; reservedBatch = false;
      if (c0 >= T.chunks) break;
      const unsigned long long c1 = std::min(T.chunks, cEnd), a = c0 * ShowTable::CHUNK, b = std::min(T.boards, c1 * ShowTable::CHUNK);
      for (unsigned long long c = c0; c < c1; c++) T.chunkState[c] = ShowTable::C_SCORING;
      const double tg = nowSec();
      if (!gpuRange(G, T, spec, a, b, T.scores.data() + (size_t)(a * (unsigned long long)T.n), overlap, &T, &local)) {
        st.cpuAfterFailure++; cpuFallback(c0, c1); break;
      }
      noteRate(G.gpuNsPerEval, (nowSec() - tg) * 1e9 / ((double)(b - a) * T.n));
      boardsOnGpu += (long long)(b - a);
      for (unsigned long long c = c0; c < c1; c++) T.chunkState[c].store(ShowTable::C_SCORED, std::memory_order_release);
      { std::lock_guard<std::mutex> g(T.buildMu); T.buildCv.notify_all(); }
    }
    st.gpuBoards += boardsOnGpu;
    if (boardsOnGpu) { if (d == Device::Gpu) st.gpuTables++; else st.hybridTables++; }
  }
  Auto43In autoInputs(const ShowTable &T) const {
    EvGpu &G = EvGpu::get(); Auto43In in;
    in.evals = (double)T.boards * T.n; in.cpuNs = cpuFusedNsPerEval().load();
    in.threads = 1 + helperCount(T) + std::max(0, cache().workers.load() - 1);
    in.attempted = G.attempted.load(); in.opening = G.opening.load(); in.available = G.ok.load(); in.verified = G.verified.load();
    in.gpuNs = G.gpuNsPerEval.load(); in.fixedSec = G.gpuBatchFixedSec.load(); in.cpuTableSeconds = cpuTableNanos().load() / 1e9; in.initEstimateSec = sh->gpuInitEstimate;
    in.batchEvals = (double)ShowTable::CHUNK * sh->gpuBatchChunks * T.n;
    return in;
  }
  std::shared_ptr<TableCache> ownCache;   // EM_EV_PRIVATE_TABLES=1
  TableCache &cache() const { return *(sh->privateTables && ownCache ? ownCache : sh->cache); }   // the request's cache (private: this worker's)
  int helperCount(const ShowTable &T) const {
    const TableCache &C = cache();
    if (T.chunks < 4) return 0;
    return (int)std::clamp<long long>((long long)C.threadBudget.load() - std::max(1, C.workers.load()), 0, (long long)T.chunks - 1);
  }
  // Owner: decide the device, spawn helper threads within the request's thread
  // budget, build, finalise (sorted full-seat histogram), publish `ready`.
  void build(ShowTable &T) {
    ShowdownStats &st = sh->show; const Device d = sh->device;
    // device decision (T.chunks and T.chunkState were set before the table was published)
    bool useGpu = false, waitLock = false;
    // 4.4: Automatic picks the arm (cpu / gpuPull / gpuPreferred) for a warm, verified device from
    // measured whole-table times of this (thread budget, table size) class; see showdown_table.hpp.
    const double tBuild0 = nowSec(), armEvals = (double)T.boards * T.n; int arm = -1; bool armValid = false, preferGpu = false;
    const int armThreads = cache().threadBudget.load();
    const long long failuresBefore = st.gpuFailures.load() + st.gpuTransient.load() + st.cpuBusy.load() + st.cpuUnavailable.load() + st.cpuAfterFailure.load();
    if (d == Device::Cpu) st.cpuForced++;
    else if (T.boards < 2) st.cpuSmall++;
    else if (d == Device::Auto) {
      Auto43In in = autoInputs(T);
      in.busy = false;
      switch (autoChoice43(in)) {
        case Auto43::CpuSmall: st.cpuSmall++; break;
        case Auto43::CpuWarmup: st.cpuWarmup++; arm = (int)Arm44::Cpu; armValid = true; break;
        case Auto43::StartOpen: st.cpuWarmup++; st.gpuBackgroundOpens++; EvGpu::get().openAsync(); break;
        case Auto43::CpuOpening: st.cpuOpening++; break;
        case Auto43::CpuUnavailable: st.cpuUnavailable++; break;
        case Auto43::CpuBusy: st.cpuBusy++; break;
        case Auto43::Verify: useGpu = true; break;
        case Auto43::CpuSlower: case Auto43::Gpu: {
          // 4.4: once the device is verified the measured arms decide (the 4.3 model only decides
          // whether an unverified device is worth verifying). EM_GPU_AUTO_MODEL=4.3 keeps the 4.3 rule.
          if (sh->autoModel43 || !in.verified) { if (autoChoice43(in) == Auto43::Gpu) useGpu = true; else st.cpuSlower++; break; }
          const Arm44 a = AutoArms44::get().next(armThreads, armEvals); arm = (int)a; armValid = true; st.autoArm[arm]++;
          if (a == Arm44::Cpu) st.cpuMeasuredFaster++; else { useGpu = true; preferGpu = a == Arm44::GpuPreferred; }
          break;
        }
      }
    } else { useGpu = true; waitLock = d == Device::Gpu; }
    // 4.3: reserve the verification chunks before helpers start (device not yet verified)
    // and, in GPU-preferred / hybrid mode, the device's first batch (a guaranteed share;
    // Automatic is pure pull). Reserved chunks the device does not score are scored on
    // the CPU by this thread afterwards (chunk states: nothing twice, nothing omitted).
    unsigned long long r0 = 0, r1 = 0, reservedEnd = 0; bool reservedDone = false;
    if (useGpu && !EvGpu::get().verified.load()) r1 = std::min<unsigned long long>(4, T.chunks);
    const Device eff = preferGpu ? Device::Gpu : d;   // 4.4: Automatic's gpuPreferred arm schedules like device "gpu" (but never waits for a busy device)
    if (useGpu) { reservedEnd = eff == Device::Auto ? r1 : std::min<unsigned long long>(T.chunks, r1 + (unsigned long long)std::max(1, sh->gpuBatchChunks)); T.nextChunk.store(reservedEnd); }
    T.cpuMayScore = !(useGpu && eff == Device::Gpu);
    // helpers
    std::vector<std::thread> helpers; std::exception_ptr helperError; std::mutex herr;
    const int nh = helperCount(T);
    for (int i = 0; i < nh; i++) {
      try {
        helpers.emplace_back([&T, &st, &helperError, &herr, this] {
          Poller hp; hp.ctl = &sh->ctl; hp.fault = sh->ctl.faultSite;
          try { participate(T, hp, 0, st); hp.flushWork(); }
          catch (...) { std::lock_guard<std::mutex> g(herr); if (!helperError) helperError = std::current_exception(); T.abort = true; }
        });
        st.helperThreads++; cache().helpersSpawned++;
      } catch (...) { break; }
    }
    struct Join { std::vector<std::thread> &h; ShowTable &T; ~Join() { for (auto &t : h) if (t.joinable()) t.join(); } } join{helpers, T};
    try {
      FlatHist local;
      if (useGpu) {
        EvGpu &G = EvGpu::get();
        std::unique_lock<std::mutex> lock(G.mu, std::defer_lock);
        if (!lockGpu(lock, waitLock)) { st.cpuBusy++; T.cpuMayScore = true; }
        else {
          if (!G.attempted) { const double t0 = nowSec(); G.open(); st.nsGpuOpen += nsSince(t0); }
          if (!G.ok) { st.note("CUDA unavailable: " + G.reason); st.cpuUnavailable++; T.cpuMayScore = true; }
          else gpuBuild(T, eff, local, r0, r1, reservedDone, reservedEnd);
          T.cpuMayScore = true;   // anything the device left (budget, failure, nothing claimed) goes to the CPU
        }
        { std::lock_guard<std::mutex> g(T.buildMu); T.buildCv.notify_all(); }
        for (unsigned long long c = 0; c < reservedEnd; c++) if (T.chunkState[c].load() == ShowTable::C_FREE) cpuScoreRange(T, c, c + 1, local);   // reserved, not scored by the device
        (void)reservedDone;
      }
      mergeLocal(T, local);
      participate(T, poller, visits, st);
      // wait for the other participants to finish their chunks and merge
      for (;;) {
        if (T.abort.load()) break;
        if (T.chunksDone.load() >= T.chunks && T.participants.load() == 0) break;
        { std::unique_lock<std::mutex> l(T.buildMu); T.buildCv.wait_for(l, std::chrono::microseconds(500)); }
        poller.waitCheck(SITE_TABLE, visits);
      }
    } catch (...) { T.abort = true; { std::lock_guard<std::mutex> g(T.buildMu); T.buildCv.notify_all(); } for (auto &t : helpers) if (t.joinable()) t.join(); throw; }
    for (auto &t : helpers) if (t.joinable()) t.join();
    if (T.abort.load()) { if (helperError) std::rethrow_exception(helperError); sh->ctl.rethrowStop(); }
    // 4.4: one whole-table measurement for the arm that built it (not when the device part failed, was busy or fell back)
    if (arm >= 0 && armValid && d == Device::Auto && armEvals >= 262144 &&
        failuresBefore == st.gpuFailures.load() + st.gpuTransient.load() + st.cpuBusy.load() + st.cpuUnavailable.load() + st.cpuAfterFailure.load())
      AutoArms44::get().record(armThreads, armEvals, (Arm44)arm, nowSec() - tBuild0);
    const double tp = nowSec();
    { std::lock_guard<std::mutex> g(T.buildMu);
      ShowTable::Hist H; H.mask = T.n >= 32 ? ~0u : (1u << T.n) - 1; H.patterns.reserve(T.fullAcc.used); T.fullAcc.each([&](uint32_t k, uint32_t v) { H.patterns.emplace_back(k, v); }); std::sort(H.patterns.begin(), H.patterns.end());
      FlatHist(1).swap(T.fullAcc);
      const long long bytes = (long long)(H.patterns.size() * 8 + 64);
      if (bytes > T.histReserve) { T.charged += bytes - T.histReserve; sh->ctl.charge(bytes - T.histReserve); }   // never with the 4.8 bound; kept for safety
      std::lock_guard<std::mutex> h(T.histMu); T.hist.push_back(std::move(H)); }
    st.nsPatterns += nsSince(tp); st.patternSets++;
  }
  // 4.8: count cap of the private small-table cache (default 1024; EM_EV_SMALL_TABLE_CAP=4 reproduces 4.7).
  static size_t smallTableCap() { static const size_t c = [] { const char *e = std::getenv("EM_EV_SMALL_TABLE_CAP"); const long v = e ? std::strtol(e, nullptr, 10) : 1024; return (size_t)std::clamp<long>(v, 4, 65536); }(); return c; }
  std::array<std::shared_ptr<ShowTable>, 2> mru; long long mruStamp = 0;
  ShowTable *table(int len) {
    int holes[16]; for (int p = 0; p < m.n; p++) { const Hand &h = m.hands[(size_t)p][(size_t)hand[p]]; holes[2 * p] = h.a; holes[2 * p + 1] = h.b; }
    for (auto &t : mru) if (t && t->matches(used, len, cards, holes, m.n)) { sh->show.reused++; return t.get(); }
    // 4.3: tables smaller than one chunk (river/turn completions: <= 1,081 boards) gain nothing
    // from sharing but would pay the shared-cache lock on every miss: they stay per worker (as in 4.2).
    int freeCards = 0; for (int x = 0; x < 52; x++) freeCards += !(used >> x & 1);
    const bool small = binom64(freeCards, 5 - len) < ShowTable::CHUNK;
    if ((sh->privateTables || small) && !ownCache) { ownCache = std::make_shared<TableCache>(); ownCache->ctl = &sh->ctl; ownCache->threadBudget = 1; ownCache->workers = 1; ownCache->countCap = sh->privateTables ? 0 : smallTableCap(); }
    TableCache &C = (sh->privateTables || small) ? *ownCache : *sh->cache;
    for (int attempt = 0; attempt < 3; attempt++) {
      std::shared_ptr<ShowTable> T; bool owner = false;
      {
        std::lock_guard<std::mutex> g(C.mu);
        T = C.find(used, len, cards, holes, m.n);
        if (T && T->failed.load()) { C.eraseTable(T); T.reset(); }
        if (!T) {
          int deckCount = 0; int deck[52]; for (int x = 0; x < 52; x++) if (!(used >> x & 1)) deck[deckCount++] = x;
          // 4.8: the full-seat rank histogram built with the table (at most one entry per board and
          // per ordered rank pattern of the seats: Fubini number) is charged here with the scores, so a
          // table never exceeds the request budget after admission (4.7 charged it unconditionally).
          static const unsigned long long fubini[9] = {1, 1, 3, 13, 75, 541, 4683, 47293, 545835};
          const unsigned long long boards = binom64(deckCount, 5 - len); const long long reserve = (long long)(std::min(boards, fubini[std::clamp(m.n, 0, 8)]) * 8 + 64);
          const long long bytes = (long long)(boards * (unsigned long long)m.n * 4) + reserve;
          // 4.1: a new table is charged to maxBoardEvaluations in full before any board is scored.
          if (!sh->ctl.chargeBoards((long long)boards)) { sh->ctl.raise(6, SITE_TABLE); sh->ctl.rethrowStop(); }
          for (auto &x : mru) x.reset();   // our own references must not pin old tables
          if (!C.makeRoom(bytes, sh->memoryBudget)) return nullptr;
          try { T = std::make_shared<ShowTable>(); T->scores.resize((size_t)boards * (size_t)m.n); } catch (const std::bad_alloc &) { C.ctl->release(bytes); return nullptr; }
          T->histReserve = reserve; T->used = used; T->len = len; T->n = m.n; std::copy_n(cards, len, T->prefix); std::copy_n(holes, 2 * m.n, T->holes); T->boards = boards;
          std::copy_n(deck, deckCount, T->deck); T->deckCount = deckCount; T->stamp = ++C.stamp; T->charged = bytes;
          T->chunks = (boards + ShowTable::CHUNK - 1) / ShowTable::CHUNK;
          T->chunkState.reset(new std::atomic<uint8_t>[T->chunks]); for (unsigned long long c = 0; c < T->chunks; c++) T->chunkState[c] = ShowTable::C_FREE;
          T->cpuMayScore = false;   // until the owner has chosen the device
          C.push(T); owner = true; C.built++;
        } else C.shared++;
      }
      if (owner) {
        try { build(*T); }
        catch (...) {
          T->failed = true; { std::lock_guard<std::mutex> g(T->buildMu); T->buildCv.notify_all(); }
          { std::lock_guard<std::mutex> g(C.mu); C.eraseTable(T); }
          throw;
        }
        T->ready.store(true, std::memory_order_release);
        { std::lock_guard<std::mutex> g(T->buildMu); T->buildCv.notify_all(); }
        sh->show.tables++; sh->show.boards += (long long)T->boards; sh->ctl.tables++; sh->ctl.boards += (long long)T->boards;
      } else if (!T->ready.load(std::memory_order_acquire)) {
        // 4.3: another worker is building this table: help, then wait for it.
        const double tw = nowSec(); sh->show.tableWaits++;
        if (T->chunks) participate(*T, poller, visits, sh->show);
        while (!T->ready.load(std::memory_order_acquire) && !T->failed.load()) {
          { std::unique_lock<std::mutex> l(T->buildMu); T->buildCv.wait_for(l, std::chrono::microseconds(500)); }
          poller.waitCheck(SITE_TABLE, visits);
          if (!T->ready.load() && !T->failed.load() && T->chunks && T->chunksDone.load() < T->chunks) participate(*T, poller, visits, sh->show);
        }
        sh->show.nsTableWait += nsSince(tw);
        if (!T->ready.load()) { if (sh->ctl.stop.load()) sh->ctl.rethrowStop(); continue; }   // the owner failed: build it ourselves
        sh->show.sharedTableHits++;
      } else sh->show.sharedTableHits++;
      T->stamp = ++C.stamp;
      size_t slot = 0; for (size_t i = 0; i < mru.size(); i++) if (!mru[i]) { slot = i; break; } else if (mru[i]->stamp < mru[slot]->stamp) slot = i;
      mru[slot] = T; return T.get();
    }
    return nullptr;
  }
  // Histogram of rank patterns of the seats in `mask` over every board of T.
  // 4.2: the full-seat histogram projected onto the subset (bit-identical to the
  // per-board method). 4.3: the full-seat histogram is built during scoring
  // (build()); subset histograms are computed outside the lock and published
  // under T.histMu (concurrent readers keep stable references into the list).
  std::vector<std::pair<uint32_t, uint32_t>> scratchPatterns;   // 4.8: an uncached subset histogram (over budget)
  const std::vector<std::pair<uint32_t, uint32_t>> &patterns(ShowTable &T, uint32_t mask) {
    { std::lock_guard<std::mutex> g(T.histMu); for (auto &h : T.hist) if (h.mask == mask) return h.patterns; }
    int seats[8], c = 0; for (uint32_t x = mask; x; x &= x - 1) seats[c++] = std::countr_zero(x);
    const double tp = nowSec(); struct Timer { double t0; ShowdownStats &s; ~Timer() { s.nsPatterns += nsSince(t0); } } timer{tp, sh->show};
    static const bool direct = std::getenv("EM_EV_DIRECT_PATTERNS") != nullptr;
    FlatHist count;
    const uint32_t all = T.n >= 32 ? ~0u : (1u << T.n) - 1;
    if (direct) {
      for (unsigned long long b = 0; b < T.boards; b++) { count.add(rankPattern(T.scores.data() + (size_t)(b * (unsigned long long)T.n), seats, c)); poll(SITE_PATTERN); }
    } else {
      const auto &F = patterns(T, all);   // full-seat histogram (built with the table)
      for (const auto &q : F) {
        // ranks of the subset's seats in the full pattern, then dense re-ranking
        int r[8], d[8], nd = 0;
        for (int i = 0; i < c; i++) { r[i] = (int)((q.first >> (3 * seats[i])) & 7); int j = 0; while (j < nd && d[j] < r[i]) j++; if (j < nd && d[j] == r[i]) continue; for (int z = nd; z > j; z--) d[z] = d[z - 1]; d[j] = r[i]; nd++; }
        uint32_t code = 0; for (int i = 0; i < c; i++) { int k = 0; while (d[k] != r[i]) k++; code |= (uint32_t)k << (3 * i); }
        count.add(code, q.second); poll(SITE_PATTERN);
      }
    }
    ShowTable::Hist H; H.mask = mask; count.each([&](uint32_t k, uint32_t v) { H.patterns.emplace_back(k, v); }); std::sort(H.patterns.begin(), H.patterns.end());
    std::lock_guard<std::mutex> g(T.histMu);
    for (auto &h : T.hist) if (h.mask == mask) return h.patterns;   // another worker published it first (identical)
    const long long bytes = (long long)(H.patterns.size() * 8 + 64);
    // 4.8: a subset histogram is cached only when it fits the request budget; otherwise it is used
    // once from this evaluator's scratch vector (same values, not reused). 4.7 charged it
    // unconditionally, which let cached tables plus histograms exceed memoryMiB.
    if (!sh->ctl.tryCharge(bytes, sh->memoryBudget)) { scratchPatterns = std::move(H.patterns); sh->show.patternSets++; return scratchPatterns; }
    T.charged += bytes;
    sh->show.patternSets++;
    T.hist.push_back(std::move(H)); return T.hist.back().patterns;
  }
  // Exact average over every completion of the board from `len` cards.
  double runout(const BS &t, int np, int len) {
    if (len == 5) { visits++; return scored(t, np); }
    if (ShowTable *T = sh->noTables ? nullptr : table(len)) {
      uint32_t mask = 0; for (int q = 0; q < np; q++) mask |= pots[q].mask;
      int seats[8], c = 0; for (uint32_t x = mask; x; x &= x - 1) seats[c++] = std::countr_zero(x);
      const auto &P = patterns(*T, mask); double sum = 0; int score[8] = {};
      for (const auto &q : P) {
        for (int i = 0; i < c; i++) score[seats[i]] = 8 - (int)((q.first >> (3 * i)) & 7);
        sum += (double)q.second * utilityWithScores(t, np, score);
      }
      return sum / (double)T->boards;
    }
    // Table over the memory budget: 3.9 per-board enumeration, polled per board.
    sh->show.directTerminals++;
    int free[52], nf = 0; for (int x = 0; x < 52; x++) if (!(used >> x & 1)) free[nf++] = x;
    double sum = 0; long long count = 0;
    std::function<void(int, int)> rec = [&](int from, int at) {
      if (at == 5) { visits++; poll(SITE_RUNOUT); sum += scored(t, np); count++; return; }
      for (int i = from; i <= nf - (5 - at); i++) { cards[at] = free[i]; rec(i + 1, at + 1); }
    };
    rec(0, len);
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
    visits++; poll(SITE_TREE);
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
        for (int x = 0; x < 52; x++) if (!(used >> x & 1)) { poll(SITE_CHANCE); cards[len] = x; used |= 1ULL << x; sum += value(cs, c, len + 1, prob / count, fb); used &= ~(1ULL << x); }
      } else {
        int free[52], nf = 0; for (int x = 0; x < 52; x++) if (!(used >> x & 1)) free[nf++] = x;
        const double combos = nChooseK(nf, 3);
        for (int i = 0; i < nf; i++) for (int j = i + 1; j < nf; j++) for (int l = j + 1; l < nf; l++) {
          poll(SITE_CHANCE);
          cards[0] = free[i]; cards[1] = free[j]; cards[2] = free[l]; const uint64_t b = (1ULL << free[i]) | (1ULL << free[j]) | (1ULL << free[l]);
          used |= b; sum += value(cs, c, 3, prob / combos, fb); used &= ~b; count++;
        }
      }
      return count ? sum / count : 0;
    }
    if (t.k == 1) { const int cs = childOf(state, t, 0, c); return value(cs, c, len, prob, fb); }
    double p[8]; const bool stored = policy(state, t.k, t.actor, hand[t.actor], len, p, &t); bool fb2 = fb || !stored;
    if (dev && t.actor == devSeat && state >= 0) {
      auto it = dev->find(devKey(state, hand[t.actor]));
      if (it != dev->end()) { for (int a = 0; a < t.k; a++) p[a] = a == it->second ? 1.0 : 0.0; fb2 = fb; }
    }
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
  long long subtree(const BS &t, long long cap) {
    long long count = 1; if (t.kind == 2) return 1;
    poll(SITE_SUBTREE);
    BS c;
    if (t.kind == 1) { g.rules.nextStreet(t, c); return 1 + subtree(c, cap); }
    for (int a = 0; a < t.k && count <= cap; a++) { g.rules.advance(t, a, c); count += subtree(c, cap - count); }
    return count;
  }
};
// One evaluator per worker thread, created lazily by the worker itself.
struct EvalPool {
  const MW &m; const Game &g; Pol pol; bool refuse; int actor; EvShared *sh; int threads;
  std::vector<std::unique_ptr<Evaluator>> ev;
  EvalPool(const MW &mm, const Game &gg, Pol p, bool r, int a, EvShared *s, int t) : m(mm), g(gg), pol(p), refuse(r), actor(a), sh(s), threads(std::max(1, t)), ev((size_t)std::max(1, t)) { ev[0] = std::make_unique<Evaluator>(m, g, pol, refuse, actor, sh); }
  Evaluator &at(int w) { auto &e = ev[(size_t)w]; if (!e) e = std::make_unique<Evaluator>(m, g, pol, refuse, actor, sh); return *e; }
  Evaluator &main() { return *ev[0]; }
  // 4.4: the request's coverage. With the shared set (default) this only adds the workers'
  // visit counters; with EM_EV_MERGED_COVERAGE=1 it merges the per-worker tables as 4.3 did.
  struct CovSummary { long long lookups = 0, stored = 0, missing = 0; size_t distinct = 0, distinctStored = 0, distinctMissing = 0, tableBytes = 0, keyLimit = 0; bool capped = false, shared = false; double estDistinct = 0, estStored = 0, estFallback = 0;
    // 4.5 memory ledger of the coverage component (bytes): budget, peak and live totals; the set's own share and its retired tiers; worker filters.
    size_t budgetBytes = 0, peakBytes = 0, liveBytes = 0, setBytes = 0, retiredBytes = 0, filterBytes = 0, refusals = 0, tiers = 0; int status = 0; };
  CovSummary coverage() const {
    CovSummary r;
    if (emcov::SharedCoverage *cs = sh->covSet.get()) {
      for (auto &e : ev) if (e) { r.lookups += e->cov.lookups; r.stored += e->cov.stored; r.missing += e->cov.missing; }
      cs->finalize();
      r.distinct = cs->distinct.load(); r.distinctStored = cs->distinctStored.load(); r.distinctMissing = cs->distinctMissing.load(); r.capped = cs->capped.load(); r.tableBytes = cs->nominalBytes(r.distinct); r.keyLimit = cs->limit; r.shared = true;   // nominal: independent of the thread count
      r.status = cs->status.load(); r.setBytes = cs->liveBytes(); r.retiredBytes = cs->retiredBytes(); r.tiers = cs->tierCount();
      if (const emcov::Budget *b = sh->covLedger.get()) { r.budgetBytes = b->limit; r.peakBytes = b->peak.load(); r.liveBytes = b->live.load(); r.refusals = b->refusals.load(); }
      for (auto &e : ev) if (e) r.filterBytes += e->covFilter.bytes();
      if (r.capped) { r.estDistinct = cs->estimateDistinct(); r.estStored = cs->estimateStored(); r.estFallback = cs->estimateFallback(); }
      return r;
    }
    // 4.5: the merged table draws from the SAME pool as the worker tables (which are still alive
    // here), so worker tables + merged table + sketches stay within coverageMiB; 4.3/4.4 gave it a
    // second, unpooled allowance (peak up to twice the budget).
    Coverage c; c.limit = sh->coverageKeys; c.pool = sh->coveragePool; for (auto &e : ev) if (e) c.merge(e->cov);
    r.budgetBytes = (size_t)sh->coverageBytes; r.liveBytes = r.peakBytes = (size_t)(sh->coverageBytes - std::max(0LL, sh->coveragePool->load())); r.status = c.capped ? emcov::COV_KEY_LIMIT : emcov::COV_OK;
    r.lookups = c.lookups; r.stored = c.stored; r.missing = c.missing; r.distinct = c.distinct; r.distinctStored = c.distinctStored; r.distinctMissing = c.distinctMissing; r.capped = c.capped; r.tableBytes = c.bytes(); r.keyLimit = c.limit;
    if (r.capped) { r.estDistinct = c.estimateDistinct(); r.estStored = c.estimateStored(); r.estFallback = c.estimateFallback(); }
    return r;
  }
  // Reference distinct counts from the audit sets: {distinct, stored, fallback}; {-1,-1,-1} when auditing is off.
  std::array<long long, 3> auditCounts() const {
    std::set<Evaluator::AuditRow> all; bool on = false;
    for (auto &e : ev) if (e && e->audit) { on = true; all.insert(e->audit->begin(), e->audit->end()); }
    if (!on) return {-1, -1, -1};
    std::map<std::tuple<int, int, int, int, uint32_t>, int> keyFlags;
    for (auto &[syn, seat, st, h, code, ok] : all) keyFlags[{syn, seat, st, h, code}] |= ok ? 1 : 2;
    long long d = 0, a = 0, b = 0; for (auto &kv : keyFlags) { d++; if (kv.second & 1) a++; if (kv.second & 2) b++; }
    return {d, a, b};
  }
  void flushWork() { for (auto &e : ev) if (e) e->poller.flushWork(); }
};

// Reach weight of every range hand of `seat` at the node: w * prod sigma(own path actions); 0 if blocked by `blocked`.
inline std::vector<double> reachWeights(Evaluator &E, const Resolved &R, int seat, uint64_t blocked, size_t &fallbacks, double *fbWeight = nullptr, double *allWeight = nullptr) {
  const auto &range = E.m.hands[(size_t)seat]; std::vector<double> r(range.size(), 0.0); double p[8];
  std::copy_n(R.cards, 5, E.cards);
  for (size_t i = 0; i < range.size(); i++) {
    E.poll(SITE_REACH);
    const Hand &h = range[i]; if ((blocked >> h.a & 1) || (blocked >> h.b & 1)) continue;
    double x = h.w; bool fb = false;
    for (size_t s = 0; s < R.steps.size() && x > 0; s++) {
      const Step &st = R.steps[s]; if (st.seat != seat) continue;
      if (!E.policy(st.state, R.trail[s].k, seat, (int)i, st.length, p, &R.trail[s])) fb = true;
      x *= p[(size_t)st.slot];
    }
    fallbacks += fb; r[i] = x;
    if (allWeight) *allWeight += x;
    if (fb && fbWeight) *fbWeight += x;
  }
  return r;
}
struct Moments {
  int k = 0; long long n = 0, affected = 0; double s[8] = {}, ss[8][8] = {}, mix = 0, mix2 = 0, vm[8] = {}, fb[8] = {};
  void add(const double *v, const double *sigma, const double *fbShare) {
    n++; double mx = 0; bool any = false; for (int a = 0; a < k; a++) mx += sigma[a] * v[a];
    for (int a = 0; a < k; a++) { s[a] += v[a]; vm[a] += v[a] * mx; fb[a] += fbShare[a]; any |= fbShare[a] > 0; for (int b = 0; b < k; b++) ss[a][b] += v[a] * v[b]; }
    mix += mx; mix2 += mx * mx; affected += any;
  }
  void merge(const Moments &o) {
    n += o.n; affected += o.affected; mix += o.mix; mix2 += o.mix2;
    for (int a = 0; a < k; a++) { s[a] += o.s[a]; vm[a] += o.vm[a]; fb[a] += o.fb[a]; for (int b = 0; b < k; b++) ss[a][b] += o.ss[a][b]; }
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
  bool draw(Evaluator &E, Rng &rng, uint64_t base, int known, long long tries) const {
    for (long long t = 0; t < tries; t++) {
      E.poll(SITE_RETRY);
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
  long long samples = 20000, seed = 1, maxVisits = 20000000, timeMs = 60000, enumerateCap = 4096, minSamples = 100, threads = 0, memoryMiB = 512, coverageMiB = 64, gpuMiB = 512, gpuBudgetBytes = 0, gpuWaitMs = 2000;
  long long maxBoards = LLONG_MAX;   // 4.1 maxBoardEvaluations (absent: unlimited)
  double margin = NAN, warnShare = 0.05, severeShare = 0.25; Fallback fallback = Fallback::Uniform; Device device = Device::Auto; bool sensitivity = false;
};
inline double optNumber(const Fields &F, const char *name, double lo, double hi, double def) {
  const JV *v = F.get(name); if (!v) return def;
  if (v->type != J_NUM || !std::isfinite(v->num)) throw QueryError{400, std::string(name) + " must be a finite number, not " + Fields::typeName(v)};
  if (v->num < lo || v->num > hi) throw QueryError{400, std::string(name) + " must be from " + std::to_string(lo) + " to " + std::to_string(hi)};
  return v->num;
}
inline bool optBool(const Fields &F, const char *name, bool def) { const JV *v = F.get(name); if (!v) return def; if (v->type != J_BOOL) throw QueryError{400, std::string(name) + " must be true or false"}; return v->num != 0; }
inline Device deviceOf(const Fields &F) { const std::string d = F.choice("device", {"auto", "cpu", "gpu", "hybrid"}, "auto"); return d == "cpu" ? Device::Cpu : d == "gpu" ? Device::Gpu : d == "hybrid" ? Device::Hybrid : Device::Auto; }
inline Fallback fallbackOf(const Fields &F) { const std::string f = F.choice("fallback", {"uniform", "foldCheck", "callCheck"}, "uniform"); return f == "foldCheck" ? Fallback::FoldCheck : f == "callCheck" ? Fallback::CallCheck : Fallback::Uniform; }
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
  P.minSamples = F.optInt("minSamples", 16, 2000000, 100);
  P.threads = F.optInt("threads", 1, 64, 0);
  P.memoryMiB = F.optInt("memoryMiB", 16, 4096, 512);
  P.coverageMiB = F.optInt("coverageMiB", 1, 4096, std::clamp<long long>(P.memoryMiB / 4, 4, 64));   // 4.3
  P.gpuMiB = F.optInt("gpuMiB", 16, 6144, 512);
  // 4.2: exact GPU budget in bytes (overrides gpuMiB; small values let the hardware
  // validator force a genuine budget refusal) and the GPU-preferred wait bound.
  P.gpuBudgetBytes = F.optInt("gpuBudgetBytes", 1, 6144LL << 20, 0);
  P.gpuWaitMs = F.optInt("gpuWaitMs", 0, 600000, 2000);
  P.maxBoards = F.optInt("maxBoardEvaluations", 1000, 1000000000000000LL, LLONG_MAX);
  P.margin = optNumber(F, "equivalenceMargin", 1e-12, 1e9, NAN);
  P.warnShare = optNumber(F, "fallbackWarnShare", 0, 1, 0.05);
  P.severeShare = optNumber(F, "fallbackSevereShare", 0, 1, 0.25);
  if (P.severeShare < P.warnShare) throw QueryError{400, "fallbackSevereShare must not be below fallbackWarnShare"};
  P.fallback = fallbackOf(F); P.device = deviceOf(F); P.sensitivity = optBool(F, "fallbackSensitivity", false);
  return P;
}
inline int effectiveThreads(long long requested) {
  const int cap = std::max(1, evThreadCap().load());
  return (int)std::clamp<long long>(requested > 0 ? requested : std::min(cap, 8), 1, cap);
}
struct HandResult {
  int index = -1; bool exact = false, unreachable = false, partial = false; double opponentMass = 0, reach = 0;
  double ev[8], se[8], fb[8], sigma[8], mix = NAN, seMix = NAN, diff[8], seDiffMix[8], seVsBest[8]; bool sigmaStored = true;
  long long samples = 0, visits = 0, affected = 0; std::string note; int best = -1; bool tie[8] = {};
  const char *cls[8] = {}; bool supported[8] = {}, equivalent[8] = {};
  // 4.1: joint covariance of the per-sample action values and the
  // multiplicity/selection-adjusted comparison (action_stats.hpp)
  double cov[8][8] = {}; bool hasCov = false; emstats::Result mc; bool hasMc = false;
};
// Exact per-hand evaluation on the worker pool. Throws EvBudget when maxVisits is exceeded.
// Work items are (action, first opponent's hand); partial sums are reduced in item order.
inline void exactHand(EvalPool &pool, const Resolved &R, const std::vector<std::vector<double>> &reach, int h, HandResult &out, long long maxVisits) {
  const BS &t = R.node(); const int k = t.k, n = pool.m.n, actor = t.actor; EvControl &ctl = pool.sh->ctl;
  const Hand &own = pool.m.hands[(size_t)actor][(size_t)h];
  std::vector<int> opp; for (int p = 0; p < n; p++) if (p != actor) opp.push_back(p);
  const uint64_t base = R.used | (1ULL << own.a) | (1ULL << own.b);
  struct Item { int a, i0; double W = 0, v = 0, fbm = 0, tot = 0; long long visits = 0; };
  std::vector<Item> items; const auto &r0 = pool.m.hands[(size_t)opp[0]];
  for (int a = 0; a < k; a++) for (size_t i = 0; i < r0.size(); i++) {
    if (!(reach[(size_t)opp[0]][i] > 0)) continue; const uint64_t b = (1ULL << r0[i].a) | (1ULL << r0[i].b); if (base & b) continue;
    items.push_back({a, (int)i});
  }
  // Visits already counted by each worker's poller belong to earlier units.
  for (auto &e : pool.ev) if (e) e->poller.flushed = e->visits;
  ctl.maxVisits = maxVisits; ctl.unitVisits = 0; ctl.unitsTotal += (long long)items.size();
  pool.sh->plan(pool.threads, (int)std::min<size_t>((size_t)pool.threads, std::max<size_t>(1, items.size())));   // 4.3: spare threads help build shared tables
  parallelFor(ctl, pool.threads, items.size(), [&](int w, size_t idx) {
    Evaluator &E = pool.at(w); Item &it = items[idx];
    E.exact = true; E.sampleActions = false; std::copy_n(R.cards, 5, E.cards); E.hand[actor] = h;
    if (w > 0) { E.dev = pool.main().dev; E.devSeat = pool.main().devSeat; }   // restricted responses share the deviation map
    const long long v0 = E.visits;
    BS c; const int cs = E.childOf(R.state, t, it.a, c);
    const auto &rg0 = E.m.hands[(size_t)opp[0]]; const uint64_t b0 = (1ULL << rg0[(size_t)it.i0].a) | (1ULL << rg0[(size_t)it.i0].b);
    E.hand[opp[0]] = it.i0;
    std::function<void(size_t, uint64_t, double)> rec = [&](size_t j, uint64_t u, double wgt) {
      E.poll(SITE_OPPONENTS);
      if (j == opp.size()) {
        std::copy_n(R.cards, 5, E.cards); E.used = u; it.W += wgt; E.fbMass = E.totMass = 0;
        it.v += wgt * E.value(cs, c, R.known, wgt, false); it.fbm += E.fbMass; it.tot += E.totMass;
        return;
      }
      const int p = opp[j]; const auto &range = E.m.hands[(size_t)p];
      for (size_t i = 0; i < range.size(); i++) {
        const double r = reach[(size_t)p][i]; if (!(r > 0)) continue;
        const uint64_t b = (1ULL << range[i].a) | (1ULL << range[i].b); if (u & b) continue;
        E.hand[p] = (int)i; rec(j + 1, u | b, wgt * r);
      }
    };
    rec(1, base | b0, reach[(size_t)opp[0]][(size_t)it.i0]);
    it.visits = E.visits - v0; ctl.unitsDone++;
  });
  double W = 0, v[8] = {}, fbm[8] = {}, tot[8] = {}; long long vis = 0;
  for (const Item &it : items) { if (it.a == 0) W += it.W; v[it.a] += it.v; fbm[it.a] += it.fbm; tot[it.a] += it.tot; vis += it.visits; }
  if (vis > maxVisits) throw EvBudget{};
  out.exact = true; out.opponentMass = W; out.visits = vis;
  if (!(W > 0)) { out.unreachable = true; out.note = "No compatible opponent holdings reach this node under the policy"; return; }
  for (int a = 0; a < k; a++) { out.ev[a] = v[a] / W; out.se[a] = 0; out.fb[a] = tot[a] > 0 ? fbm[a] / tot[a] : 0; }
}
inline long long countNonzero(const std::vector<double> &r) { long long c = 0; for (double x : r) c += x > 0; return c; }
// Upper estimate of exact work for one hand (opponent tuples x runouts x subtree).
// 4.0: the betting subtree is sized once, and only as far as the two decisions
// that use it need (auto exact-vs-sampled against maxVisits/units, and
// enumerate-vs-sample against enumerateCap); 3.9 sized it twice with a cap of
// 10^6 nodes per action, which alone could take longer than a short time limit.
inline double exactCost(Evaluator &E, const Resolved &R, const std::vector<std::vector<double>> &reach, int actor, double budget, long long enumerateCap, long long &subtreeNodes, bool &capped) {
  double tuples = 1; for (int p = 0; p < E.m.n; p++) if (p != actor) tuples *= (double)std::max<long long>(1, countNonzero(reach[(size_t)p]));
  const double deck = 52 - R.known - 2 * E.m.n;
  const double runouts = R.known == 0 ? nChooseK((int)deck, 3) * (deck - 3) * (deck - 4) : R.known == 3 ? deck * (deck - 1) : R.known == 4 ? deck : 1;
  const double work = tuples * std::max(1.0, runouts);
  const long long cap = (long long)std::clamp(std::max((double)enumerateCap + 1, std::ceil(budget / work) + 1), 1.0, 1000000.0);
  const BS &t = R.node(); long long sub = 0; BS c;
  for (int a = 0; a < t.k && sub <= cap; a++) { E.g.rules.advance(t, a, c); sub += E.subtree(c, cap - sub); }
  capped = sub > cap; subtreeNodes = sub;
  return work * (double)sub;
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
inline void utilityJson(JB *out, const MW &m, bool forceChip = false) {
  if (m.tournament.start.empty() || forceChip) jb_puts(out, ",\"utility\":{\"model\":\"chip\",\"unit\":\"BB\",\"convention\":\"ev = net chips of the acting seat relative to the study root (chips collected from main and side pots minus chips it puts in from the study root on, plus its own ante in preflop studies); identical for every action at this node. fromDecision = ev + chips the seat had already committed at this decision (sunk), i.e. chips collected minus ADDITIONAL chips put in from this decision on.\"}");
  else jb_puts(out, ",\"utility\":{\"model\":\"icm\",\"unit\":\"payout units\",\"convention\":\"ev = tournament equity of the acting seat (expected payout under the study's ICM payout table, exact finishing-set recursion, busted players ranked by starting stack) after the hand; chip EV is not substituted.\"}");
}
inline const char *interpretation(const char *c) {
  if (!std::strcmp(c, "highest")) return "highest EV";
  if (!std::strcmp(c, "highestEstimate")) return "highest point estimate; its advantage over the other actions is NOT statistically established (the ordering is uncertain)";
  if (!std::strcmp(c, "supportedBest")) return "statistically supported best: higher than every other action (simultaneous intervals, family-wise 95%, adjusted for multiple actions and for selecting the highest estimate)";
  if (!std::strcmp(c, "exactTie")) return "exactly equal to the highest EV";
  if (!std::strcmp(c, "withinMargin")) return "exactly computed; below the highest EV by less than the equivalence margin";
  if (!std::strcmp(c, "lower")) return "exactly computed; lower than the highest EV";
  if (!std::strcmp(c, "differenceSupported")) return "lower than at least one other action (simultaneous paired intervals, family-wise 95%)";
  if (!std::strcmp(c, "differenceUncertain")) return "ordering not established: the simultaneous interval includes zero. This is NOT evidence that the EVs are equal";
  if (!std::strcmp(c, "practicallyEquivalent")) return "practically equivalent to the best of the other actions: the simultaneous interval lies inside the equivalence margin (family-wise 95%)";
  if (!std::strcmp(c, "insufficientSamples")) return "too few samples for a statistical comparison";
  return "";
}
inline void handJson(JB *out, const MW &m, const BS &t, int actor, const HandResult &r, double sunk, bool chip, double margin) {
  const int k = t.k;
  if (r.index >= 0) { const Hand &h = m.hands[(size_t)actor][(size_t)r.index]; jb_printf(out, "{\"i\":%d,\"cards\":[%d,%d],\"weight\":", r.index, h.a, h.b); jb_num(out, h.w, 10); }
  else jb_puts(out, "{\"i\":null");
  jb_puts(out, ",\"reach\":"); jnumOrNull(out, r.reach);
  jb_printf(out, ",\"method\":\"%s\"", r.exact ? "exact" : "sampled");
  if (r.unreachable) { jb_puts(out, ",\"available\":false,\"status\":\"unavailable\",\"reason\":"); jb_str(out, r.note.c_str()); jb_putc(out, '}'); return; }
  jb_printf(out, ",\"available\":true,\"status\":\"%s\"", r.partial ? "partial" : "completed");
  if (r.exact) { jb_puts(out, ",\"opponentMass\":"); jnumOrNull(out, r.opponentMass); }
  jb_printf(out, ",\"samples\":%lld,\"visits\":%lld", r.samples, r.visits);
  if (!r.exact) jb_printf(out, ",\"samplesWithFallback\":%lld", r.affected);
  if (r.index >= 0) { jb_puts(out, ",\"strategy\":"); jarr(out, r.sigma, k); jb_printf(out, ",\"strategyStored\":%s", r.sigmaStored ? "true" : "false"); }
  jb_puts(out, ",\"ev\":"); jarr(out, r.ev, k); jb_puts(out, ",\"evBits\":"); jbitsArr(out, r.ev, k);   // 4.4: IEEE 754 patterns for bit-exact comparisons
  if (chip && r.index >= 0) { double f[8]; for (int a = 0; a < k; a++) f[a] = r.ev[a] + sunk; jb_puts(out, ",\"fromDecision\":"); jarr(out, f, k); }
  if (r.exact) jb_puts(out, ",\"stdErr\":null,\"ci95\":null");
  else { jb_puts(out, ",\"stdErr\":"); jarr(out, r.se, k); jb_puts(out, ",\"ci95\":["); for (int a = 0; a < k; a++) { if (a) jb_putc(out, ','); jb_putc(out, '['); jnumOrNull(out, r.ev[a] - 1.96 * r.se[a]); jb_putc(out, ','); jnumOrNull(out, r.ev[a] + 1.96 * r.se[a]); jb_putc(out, ']'); } jb_putc(out, ']'); }
  jb_puts(out, ",\"mixed\":"); jnumOrNull(out, r.mix); jb_puts(out, ",\"mixedStdErr\":"); if (r.exact) jb_puts(out, "null"); else jnumOrNull(out, r.seMix);
  jb_puts(out, ",\"diff\":"); jarr(out, r.diff, k); jb_puts(out, ",\"diffStdErr\":"); if (r.exact) jb_puts(out, "null"); else jarr(out, r.seDiffMix, k);
  jb_printf(out, ",\"best\":%d,\"vsBestStdErr\":", r.best); if (r.exact) jb_puts(out, "null"); else jarr(out, r.seVsBest, k);
  double d[8]; for (int a = 0; a < k; a++) d[a] = r.ev[a] - r.ev[r.best];
  jb_puts(out, ",\"vsBest\":"); jarr(out, d, k);
  if (!r.exact) { jb_puts(out, ",\"vsBestCi95\":["); for (int a = 0; a < k; a++) { if (a) jb_putc(out, ','); jb_putc(out, '['); jnumOrNull(out, d[a] - 1.96 * r.seVsBest[a]); jb_putc(out, ','); jnumOrNull(out, d[a] + 1.96 * r.seVsBest[a]); jb_putc(out, ']'); } jb_putc(out, ']'); }
  jb_puts(out, ",\"classification\":["); for (int a = 0; a < k; a++) jb_printf(out, "%s\"%s\"", a ? "," : "", r.cls[a] ? r.cls[a] : ""); jb_putc(out, ']');
  jb_puts(out, ",\"interpretation\":["); for (int a = 0; a < k; a++) { if (a) jb_putc(out, ','); jb_str(out, interpretation(r.cls[a] ? r.cls[a] : "")); } jb_putc(out, ']');
  jb_puts(out, ",\"differenceSupported\":["); for (int a = 0; a < k; a++) jb_printf(out, "%s%s", a ? "," : "", r.supported[a] ? "true" : "false"); jb_putc(out, ']');
  jb_puts(out, ",\"practicallyEquivalent\":"); if (std::isfinite(margin)) { jb_putc(out, '['); for (int a = 0; a < k; a++) jb_printf(out, "%s%s", a ? "," : "", r.equivalent[a] ? "true" : "false"); jb_putc(out, ']'); } else jb_puts(out, "null");
  jb_puts(out, ",\"equivalentToBest\":["); for (int a = 0; a < k; a++) jb_printf(out, "%s%s", a ? "," : "", r.tie[a] ? "true" : "false"); jb_putc(out, ']');
  jb_puts(out, ",\"fallbackShare\":"); jarr(out, r.fb, k);
  if (!r.exact && r.hasMc) {
    // 4.1: simultaneous (family-wise 95%) comparisons; see action_stats.hpp.
    const emstats::Result &c = r.mc;
    jb_puts(out, ",\"multipleComparisons\":{\"familyConfidence\":0.95,\"criticalValue\":"); jnumOrNull(out, c.crit);
    jb_printf(out, ",\"unadjustedCriticalValue\":1.959963984540054,\"pairs\":%d,\"simulationDraws\":%d", c.pairs, c.draws);
    jb_puts(out, ",\"supportedBest\":"); if (c.supportedBest >= 0) jb_printf(out, "%d", c.supportedBest); else jb_puts(out, "null");
    jb_puts(out, ",\"vsBestOfOthers\":"); jarr(out, c.est, k);
    jb_puts(out, ",\"vsBestOfOthersCi\":["); for (int a = 0; a < k; a++) { if (a) jb_putc(out, ','); jb_putc(out, '['); jnumOrNull(out, c.lo[a]); jb_putc(out, ','); jnumOrNull(out, c.hi[a]); jb_putc(out, ']'); } jb_putc(out, ']');
    jb_puts(out, ",\"holmAdjustedPvsHighest\":"); jarr(out, c.holmP, k);
    jb_puts(out, ",\"pairwiseCi\":["); for (int a = 0; a < k; a++) { if (a) jb_putc(out, ','); jb_putc(out, '['); for (int b = 0; b < k; b++) { if (b) jb_putc(out, ','); if (a == b) jb_puts(out, "null"); else { jb_putc(out, '['); jnumOrNull(out, c.pairLo[a][b]); jb_putc(out, ','); jnumOrNull(out, c.pairHi[a][b]); jb_putc(out, ']'); } } jb_putc(out, ']'); } jb_putc(out, ']');
    jb_putc(out, '}');
  }
  jb_putc(out, '}');
}
// Classification (see the header). `margin` is NaN when no equivalence test was requested.
inline void finishResult(HandResult &r, int k, double margin, long long minSamples) {
  double best = -INFINITY; for (int a = 0; a < k; a++) if (r.ev[a] > best) { best = r.ev[a]; r.best = a; }
  const bool hasMargin = std::isfinite(margin);
  for (int a = 0; a < k; a++) {
    r.diff[a] = r.ev[a] - r.mix; const double d = r.ev[a] - best;
    r.supported[a] = false; r.equivalent[a] = false;
    if (r.exact) {
      const bool tie = std::fabs(d) <= 1e-9 * std::max(1.0, std::fabs(best));
      r.equivalent[a] = hasMargin && std::fabs(d) < margin; r.supported[a] = !tie;
      r.cls[a] = a == r.best ? "highest" : tie ? "exactTie" : r.equivalent[a] ? "withinMargin" : "lower";
      r.tie[a] = tie || r.equivalent[a];
      continue;
    }
    // 4.1: sampled results use simultaneous, selection-adjusted comparisons
    // (action_stats.hpp). The 4.0 per-action rule (unadjusted 95% interval
    // against the highest estimate) had a family-wise error of 20-49% with
    // 4-8 equal actions in tests/stats41.cpp.
    if (!r.hasCov) { r.cls[a] = "insufficientSamples"; r.tie[a] = false; continue; }
    if (!r.hasMc) { r.mc = emstats::compare(k, r.samples, r.ev, r.cov, margin, minSamples); r.hasMc = true; }
    r.cls[a] = r.mc.cls[a]; r.supported[a] = r.mc.supported[a]; r.equivalent[a] = r.mc.equivalent[a];
    r.tie[a] = a == r.best || r.equivalent[a];
  }
}
inline void fromMoments(HandResult &r, const Moments &M, int k) {
  r.samples = M.n; r.affected = M.affected;
  for (int a = 0; a < k; a++) { r.ev[a] = M.mean(a); r.se[a] = M.se(a); r.fb[a] = M.fb[a] / M.n; r.seDiffMix[a] = M.seVsMix(a); }
  r.mix = M.mix / M.n; r.seMix = M.seMix();
  int best = 0; for (int a = 1; a < k; a++) if (r.ev[a] > r.ev[best]) best = a;
  for (int a = 0; a < k; a++) r.seVsBest[a] = a == best ? 0 : M.seDiff(a, best);
  for (int a = 0; a < k; a++) for (int b = 0; b < k; b++) r.cov[a][b] = emstats::covFromSums(M.n, M.s[a], M.s[b], M.ss[a][b]);
  r.hasCov = true;
}
// One sampled world's action values at the node (all actions share the cards).
inline void sampleValues(Evaluator &E, const Resolved &R, double *v, double *fbs) {
  const BS &t = R.node();
  for (int a = 0; a < t.k; a++) { BS c; const int cs = E.childOf(R.state, t, a, c); E.fbMass = E.totMass = 0; v[a] = E.value(cs, c, R.known, 1.0, false); fbs[a] = E.totMass > 0 ? E.fbMass / E.totMass : 0; }
}
// 4.3: how the distinct counts may be read: exact, or exact lower bounds plus a
// labelled HyperLogLog estimate once the coverage table hit its key limit or byte budget.
inline void coverageCapacityJson(JB *o, const EvalPool::CovSummary &cov, const EvShared &S) {
  jb_printf(o, ",\"distinctCountKind\":\"%s\",\"capacity\":{\"exactKeyLimit\":%zu,\"coverageMiB\":%lld,\"tableBytes\":%zu,\"bytesPerKey\":32,\"note\":\"exact while distinctCountKind is exact; once capped the distinct* fields are exact LOWER BOUNDS (keys counted before the limit) and estimates are HyperLogLog approximations (2^14 registers), never exact counts. Raise coverageMiB (1-4096) for larger exact counts.\"}",
            cov.capped ? "lowerBound" : "exact", cov.shared ? cov.keyLimit : S.coverageKeys, S.coverageBytes >> 20, cov.tableBytes);
  // 4.5: budget semantics and outcome. Only values that do not depend on the worker count are printed inside
  // "coverage" (inherited tests compare this object across thread counts); the byte figures of the ledger, which
  // depend on the number of worker filters, are in execution.coverageMemory.
  jb_printf(o, ",\"memory\":{\"semantics\":\"coverageMiB is a hard ceiling on LIVE allocated bytes of the coverage component: every table generation (current, replacement being built, retired ones kept for lock-free readers), table metadata, the three sketches, the synchronisation state and all worker-local filters. Showdown tables/memo (memoryMiB) and GPU buffers (gpuMiB) have their own budgets. Byte figures: execution.coverageMemory.\",\"budgetBytes\":%zu,\"withinBudget\":%s,\"status\":\"%s\",\"countsExact\":%s}",
            cov.budgetBytes, cov.peakBytes <= cov.budgetBytes ? "true" : "false", emcov::statusName(cov.status), cov.capped ? "false" : "true");
  jb_printf(o, ",\"structure\":\"%s\"", cov.shared ? "request-wide concurrent set (4.4): filled while the workers run, nothing is merged after they stop" : "per-worker tables merged after the workers stop (EM_EV_MERGED_COVERAGE)");
  if (cov.capped) {
    jb_printf(o, ",\"distinctEstimates\":{\"method\":\"HyperLogLog (approximate)\",\"relativeStdError\":%.4f,\"distinctInformationSets\":%.0f,\"distinctStoredInformationSets\":%.0f,\"distinctFallbackInformationSets\":%.0f}",
              emcov::Hll::relativeStdError(), cov.estDistinct, cov.estStored, cov.estFallback);
  }
}
inline void showdownJson(JB *o, EvShared &S) {
  ShowdownStats &s = S.show;
  jb_printf(o, ",\"execution\":{\"device\":\"%s\",\"showdownTables\":%lld,\"tablesReused\":%lld,\"boardsScored\":%lld,\"cpuBoards\":%lld,\"gpuBoards\":%lld,\"gpuTables\":%lld,\"hybridTables\":%lld,\"patternSets\":%lld,\"perBoardTerminals\":%lld,\"gpuFailures\":%lld",
            deviceName(S.device), s.tables.load(), s.reused.load(), s.boards.load(), s.cpuBoards.load(), s.gpuBoards.load(), s.gpuTables.load(), s.hybridTables.load(), s.patternSets.load(), s.directTerminals.load(), s.gpuFailures.load());
  jb_printf(o, ",\"peakEvaluationMiB\":%.3f,\"gpuPeakMiB\":%.3f", S.ctl.peakMemoryBytes.load() / 1048576.0, s.gpuPeakBytes.load() / 1048576.0);
  // 4.5: the coverage ledger in bytes. peakBytes is the maximum of live bytes over the request (set, parked replacement and
  // every worker filter) and is <= budgetBytes by construction: reservations are refused, never granted and checked afterwards.
  if (S.covSet && S.covLedger) jb_printf(o, ",\"coverageMemory\":{\"budgetBytes\":%zu,\"peakBytes\":%zu,\"tablePeakBytes\":%zu,\"tableBytes\":%zu,\"retiredGenerationBytes\":%zu,\"parkedReplacementBytes\":%zu,\"generations\":%zu,\"workerFilterEntries\":%zu,\"workerFilterBytesEach\":%zu,\"refusedReservations\":%zu,\"withinBudget\":%s}",
    S.covLedger->limit, S.covLedger->peak.load(), S.covSet->peakBytes(), S.covSet->liveBytes(), S.covSet->retiredBytes(), S.covSet->spareBytes(), S.covSet->tierCount(), S.covFilterEntries, S.covFilterEntries * 16, S.covLedger->refusals.load(), S.covLedger->peak.load() <= S.covLedger->limit ? "true" : "false");
  if (S.covSet) jb_printf(o, ",\"coverageSetBytes\":%zu", S.covSet->bytes());   // 4.4: memory actually allocated for the coverage set (can be one tier above coverage.capacity.tableBytes)
  jb_printf(o, ",\"scheduling\":{\"cpuForced\":%lld,\"cpuSmallTable\":%lld,\"cpuGpuWarmup\":%lld,\"cpuGpuSlower\":%lld,\"cpuGpuUnavailable\":%lld,\"cpuGpuBusy\":%lld,\"cpuAfterGpuFailure\":%lld,\"gpuDeclinedTransient\":%lld,\"gpuWaitTimeouts\":%lld,\"gpuVerificationBoards\":%lld,\"gpuWaitMs\":%lld,\"gpuInitEstimateSeconds\":%.3f,\"cpuGpuOpening\":%lld,\"gpuBackgroundOpens\":%lld,\"rule\":\"auto (4.3): tables below 262,144 seat-board evaluations stay on the CPU. CUDA start-up is never paid inside a table: once this process has spent gpuInitEstimateSeconds scoring tables on the CPU the device is opened on a background thread (cpuGpuWarmup / cpuGpuOpening count tables decided before it was ready). A table then uses the device only if the predicted CPU time of the table (measured ns per evaluation divided by the threads that build it) exceeds 1.25x one measured device batch (upload, kernel, download); the device is verified bit for bit once per process first. The device pulls batches of chunks while CPU threads pull single chunks, so the split adapts to measured speed. gpu: the device scores every chunk it can (a busy device is awaited up to gpuWaitMs) while CPU threads count rank patterns of scored chunks. hybrid: device and CPU threads both pull chunks. A refusal for the GPU budget, the VRAM reserve or out-of-memory sends only that table to the CPU; any other CUDA failure disables the device for the process.\"}",
            s.cpuForced.load(), s.cpuSmall.load(), s.cpuWarmup.load(), s.cpuSlower.load(), s.cpuUnavailable.load(), s.cpuBusy.load(), s.cpuAfterFailure.load(), s.gpuTransient.load(), s.gpuWaitTimeouts.load(), s.verificationBoards.load(), S.gpuWaitMs, S.gpuInitEstimate, s.cpuOpening.load(), s.gpuBackgroundOpens.load());
  jb_printf(o, ",\"tables43\":{\"sharing\":\"%s\",\"sharedTableHits\":%lld,\"tablesBuiltByThisRequest\":%lld,\"waitsForAnotherWorker\":%lld,\"waitSeconds\":%.4f,\"helperThreads\":%lld,\"gpuBatches\":%lld,\"gpuScoredChunksPatternedByCpu\":%lld,\"chunkBoards\":%llu,\"gpuBatchChunks\":%d,\"threadBudget\":%d}",
            S.privateTables ? "private per worker (EM_EV_PRIVATE_TABLES)" : "request-wide", s.sharedTableHits.load(), S.cache->built.load(), s.tableWaits.load(), s.nsTableWait.load() / 1e9, s.helperThreads.load(), s.gpuBatches.load(), s.patternChunksForGpu.load(), ShowTable::CHUNK, S.gpuBatchChunks, S.cache->threadBudget.load());
  // 4.4: Automatic's measured arm statistics (process-wide, per thread budget and table-size class)
  {
    AutoArms44 &A = AutoArms44::get(); std::lock_guard<std::mutex> g(A.mu);
    jb_printf(o, ",\"auto44\":{\"rule\":\"%s\",\"thisRequest\":{\"cpu\":%lld,\"gpuPull\":%lld,\"gpuPreferred\":%lld,\"cpuMeasuredFaster\":%lld},\"classes\":[", S.autoModel43 ? "4.3 model (EM_GPU_AUTO_MODEL=4.3)" : "measured whole-table time per arm; arms with fewer than 2 measurements are tried first, then the fastest, with 2 of every 32 decisions re-measuring the others",
              s.autoArm[0].load(), s.autoArm[1].load(), s.autoArm[2].load(), s.cpuMeasuredFaster.load());
    bool first = true;
    for (auto &kv : A.cls) {
      const ArmStats44 &x = kv.second; const int b = x.best();
      jb_printf(o, "%s{\"threads\":%d,\"log2Evaluations\":%d,\"decisions\":%lld,\"fastest\":%s%s%s,\"arms\":[", first ? "" : ",", kv.first.first, kv.first.second, x.decisions, b < 0 ? "" : "\"", b < 0 ? "null" : armName(b), b < 0 ? "" : "\""); first = false;
      for (int a = 0; a < 3; a++) jb_printf(o, "%s{\"arm\":\"%s\",\"measurements\":%lld,\"chosen\":%lld,\"meanNsPerEvaluation\":%.4f}", a ? "," : "", armName(a), x.n[a], x.chosen[a], x.mean[a] * 1e9);
      jb_puts(o, "]}");
    }
    jb_puts(o, "]}");
  }
  // 4.2: what actually ran (not the requested mode)
  const bool usedGpu = s.gpuBoards.load() > 0 || s.hybridTables.load() > 0;
  const char *observed = s.tables.load() == 0 ? "no showdown tables" : usedGpu ? (s.cpuBoards.load() > 0 ? "cpu+gpu" : "gpu") : "cpu";
  jb_printf(o, ",\"requestedDevice\":\"%s\",\"observedDevice\":\"%s\",\"gpuBudgetBytes\":%zu", deviceName(S.device), observed, S.gpuBudget);
  EvGpu &G = EvGpu::get();
  jb_printf(o, ",\"cuda\":{\"attempted\":%s,\"available\":%s,\"verified\":%s,\"primaryContext\":%s,\"openSeconds\":%.4f,\"cpuNsPerEval\":%.3f,\"gpuNsPerEval\":%.3f,\"processDeviceBytes\":%lld,\"processPeakDeviceBytes\":%lld,\"opens\":%d,\"backgroundOpens\":%lld,\"verifications\":%lld,\"uses\":%lld,\"idleBufferReleases\":%lld,\"idleReleaseSeconds\":%.3f,\"heldBytes\":%lld,\"batchFixedSeconds\":%.6f,\"cpuFusedNsPerEval\":%.3f}",
            G.attempted ? "true" : "false", G.ok ? "true" : "false", G.verified ? "true" : "false", G.dev.usesPrimaryContext() ? "true" : "false", G.openSeconds.load(), G.cpuNsPerEval.load(), G.gpuNsPerEval.load(), CudaLedger::live().load(), CudaLedger::peak().load(),
            G.opens.load(), G.asyncOpens.load(), G.verifications.load(), G.uses.load(), G.idleReleases.load(), G.idleReleaseSec, CudaLedger::live().load(), G.gpuBatchFixedSec.load(), cpuFusedNsPerEval().load());
  jb_printf(o, ",\"profileSeconds\":{\"note\":\"summed over worker threads (CPU-seconds), so parts can exceed the wall time\",\"cpuTableScoring\":%.4f,\"patternCounting\":%.4f,\"cudaStartup\":%.4f,\"gpuVerification\":%.4f,\"gpuUploadAndLaunch\":%.4f,\"gpuKernelAndDownload\":%.4f,\"gpuLockWait\":%.4f,\"sharedTableWait\":%.4f}",
            s.nsCpuTables.load() / 1e9, s.nsPatterns.load() / 1e9, s.nsGpuOpen.load() / 1e9, s.nsGpuVerify.load() / 1e9, s.nsGpuUploadLaunch.load() / 1e9, s.nsGpuDownload.load() / 1e9, s.nsGpuLockWait.load() / 1e9, s.nsTableWait.load() / 1e9);
  { std::lock_guard<std::mutex> g(s.mu);
    jb_puts(o, ",\"gpuErrors\":[");
    for (size_t i = 0; i < s.errors.size(); i++) { const CudaError &e = s.errors[i];
      jb_printf(o, "%s{\"operation\":", i ? "," : ""); jb_str(o, e.op.c_str()); jb_printf(o, ",\"code\":%d,\"name\":", e.code); jb_str(o, e.name.c_str()); jb_puts(o, ",\"description\":"); jb_str(o, e.text.c_str());
      jb_printf(o, ",\"hostThread\":%d,\"context\":", e.thread); jb_str(o, e.context.c_str());
      jb_printf(o, ",\"requestedBytes\":%zu,\"freeBytes\":%zu,\"totalBytes\":%zu,\"budgetBytes\":%zu,\"reserveBytes\":%zu,\"grid\":%u,\"block\":%u,\"cpuFallback\":%s}", e.requested, e.freeBytes, e.totalBytes, e.budget, e.reserve, e.grid, e.block, s.errorFallback[i] ? "true" : "false"); }
    jb_putc(o, ']'); }
  if (!s.gpuNote.empty()) { jb_puts(o, ",\"gpuNote\":"); jb_str(o, s.gpuNote.c_str()); }
  jb_putc(o, '}');
}
// 4.1: complete work accounting and the budgets that applied (ev_control.hpp).
inline void workJson(JB *o, EvShared &S, long long maxVisits, long long samples, long long timeMs, long long memoryMiB) {
  const EvControl &c = S.ctl; auto w = [&](int site) { return c.work[site].load(); };
  jb_printf(o, ",\"work\":{\"units\":\"counts of work items of each kind; kinds have different costs and are never added together\",\"treeVisits\":%lld,\"treeNodePolls\":%lld,\"chanceCards\":%lld,\"opponentTuples\":%lld,\"reachWeights\":%lld,"
               "\"boardRunouts\":%lld,\"boardEvaluations\":%lld,\"showdownTables\":%lld,\"tableCacheHits\":%lld,\"tableBoardsCpu\":%lld,\"patternCounts\":%lld,\"terminalUtilities\":%lld,\"icmEvaluations\":%lld,"
               "\"samples\":%lld,\"rejectedSamplingAttempts\":%lld,\"bestResponseNodes\":%lld,\"responseTuples\":%lld,\"selectionSteps\":%lld,\"subtreeSizingNodes\":%lld,\"gpuBatches\":%lld,\"gpuBoards\":%lld,\"workerTasks\":%lld}",
            c.visits.load(), w(SITE_TREE), w(SITE_CHANCE), w(SITE_OPPONENTS), w(SITE_REACH), w(SITE_RUNOUT), c.boardEvals.load(), S.show.tables.load(), S.show.reused.load(), w(SITE_TABLE), w(SITE_PATTERN),
            S.show.patternSets.load() + S.show.directTerminals.load(), w(SITE_ICM), c.samples.load(), w(SITE_RETRY), w(SITE_BR), w(SITE_TUPLES), w(SITE_SELECTION), w(SITE_SUBTREE), w(SITE_GPU), S.show.gpuBoards.load(), c.unitsDone.load());
  jb_printf(o, ",\"budgets\":{\"maxVisits\":%lld,\"maxBoardEvaluations\":", maxVisits);
  if (c.maxBoards == LLONG_MAX) jb_puts(o, "null"); else jb_printf(o, "%lld", c.maxBoards);
  jb_printf(o, ",\"samples\":%lld,\"timeLimitMs\":%lld,\"memoryMiB\":%lld,\"boardBudgetExhausted\":%s}", samples, timeMs, memoryMiB, c.maxBoards != LLONG_MAX && c.boardEvals.load() > c.maxBoards ? "true" : "false");
}
inline void deadlineJson(JB *o, EvShared &S, long long timeMs) {
  // 4.4: phasesMs attributes the request's time: ms after the start at which each phase ended
  // (null = not reached). stopRaised is when a worker first published the stop; workEnd is when
  // every worker had returned; the remainder is statistics, coverage merging and this response.
  const EvControl &c = S.ctl; const long long sn = c.stopNs.load();
  jb_printf(o, ",\"deadline\":{\"timeLimitMs\":%lld,\"clock\":\"steady (monotonic)\",\"checks\":%lld,\"maxCheckGapMs\":%.3f,\"phasesMs\":{\"workBegin\":", timeMs, c.checks.load(), c.maxGapNs.load() / 1e6);
  jnumOrNull(o, c.markWorkBegin >= 0 ? c.markWorkBegin : NAN); jb_puts(o, ",\"stopRaised\":"); jnumOrNull(o, sn >= 0 ? sn / 1e6 : NAN);
  jb_puts(o, ",\"workEnd\":"); jnumOrNull(o, c.markWorkEnd >= 0 ? c.markWorkEnd : NAN); jb_puts(o, ",\"statistics\":"); jnumOrNull(o, c.markStats >= 0 ? c.markStats : NAN);
  jb_puts(o, ",\"coverageMerged\":"); jnumOrNull(o, c.markCoverage >= 0 ? c.markCoverage : NAN); jb_printf(o, ",\"responseBuilt\":%.3f}}", c.elapsedMs());
}
} // namespace es
} // namespace

// Cache: bounded per engine, keyed by the full canonical request plus the
// training counters, and cleared by every training call, import and restore.
// 4.0: guarded by a mutex because desktop evaluation jobs run concurrently.
static std::mutex &evCacheMutex() { static std::mutex mu; return mu; }
static int actionEvImpl(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel, es::EvShared *shared) {
  using namespace es;
  if (!m || !m->es) { fail(err, errlen, "Action EVs need a native external-sampling study"); return 400; }
  const Game &g = *m->es; const int n = m->n; const double t0 = nowSec();
  EvShared local; EvShared &S = shared ? *shared : local; S.ctl.cancel = cancel;
  JV *req = nullptr;
  try { req = parseRequest(json, len, err, errlen); } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  struct Free { JV *v; ~Free() { json_free(v); } } freeReq{req};
  try {
    const Fields F(req, {"path", "board", "hands", "range", "policy", "missing", "method", "futureActions", "samples", "seed", "maxVisits", "timeLimitMs", "studyId", "stateId",
                         "minSamples", "threads", "memoryMiB", "coverageMiB", "gpuMiB", "gpuBudgetBytes", "gpuWaitMs", "device", "equivalenceMargin", "fallback", "fallbackWarnShare", "fallbackSevereShare", "fallbackSensitivity", "utility", "maxBoardEvaluations"});
    const std::string utility = F.choice("utility", {"study", "chip", "icm"}, "study");
    if (utility == "icm" && m->tournament.start.empty()) throw QueryError{400, "utility icm needs a study with a tournament payout table"};
    S.forceChip = utility == "chip" && !m->tournament.start.empty();
    const std::vector<int> path = F.intArray("path", 0, 7, MAX_DEPTH), dealt = F.intArray("board", 0, 51, 5);
    std::vector<int> hands = F.intArray("hands", 0, 1325, 64);
    bool range = false; if (const JV *v = F.get("range")) { if (v->type != J_BOOL) throw QueryError{400, "range must be true or false"}; range = v->num != 0; }
    const EvParams P = evParams(F, 60000);
    S.ctl.setDeadline(P.timeMs); S.device = P.device; S.gpuBudget = P.gpuBudgetBytes ? (size_t)P.gpuBudgetBytes : (size_t)P.gpuMiB << 20; S.gpuWaitMs = P.gpuWaitMs; S.memoryBudget = P.memoryMiB << 20; S.fallback = P.fallback; S.ctl.maxBoards = P.maxBoards; S.setCoverage(P.coverageMiB);
    const int threads = effectiveThreads(P.threads);
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
    if (S.ctl.validateOnly) { jb_puts(out, "{\"valid\":true}"); return 200; }
    // ---- cache (thread count, device and memory do not change results) ----
    std::string key = std::to_string(m->iterations) + "|" + std::to_string(m->trainingDeals) + "|" + std::to_string(m->rows.size()) + "|" + std::to_string(m->stateVisits) + "|";
    for (int a : path) key += std::to_string(a) + ","; key += "|"; for (int c : dealt) key += std::to_string(c) + ","; key += "|"; for (int h : hands) key += std::to_string(h) + ",";
    key += std::string("|") + (range ? "r" : "") + policyName(P.pol) + (P.refuse ? "R" : "U") + P.method + P.future + "|" + std::to_string(P.samples) + "|" + std::to_string(P.seed) + "|" + std::to_string(P.maxVisits) + "|" + std::to_string(P.maxBoards) +
           "|" + std::to_string(P.minSamples) + "|" + (S.forceChip ? "chip|" : "") + fallbackName(P.fallback) + "|" + (std::isfinite(P.margin) ? std::to_string(P.margin) : "-") + "|" + std::to_string(P.warnShare) + "|" + std::to_string(P.severeShare) + (P.sensitivity ? "S" : "");
    {
      std::lock_guard<std::mutex> lk(evCacheMutex());
      auto it = m->evCache.find(key);
      if (it != m->evCache.end()) { jb_putn(out, it->second.data(), it->second.size() - 1); jb_puts(out, ",\"cache\":{\"hit\":true}}"); return 200; }
    }
    S.shareCoverage(threads);   // 4.4; 4.5: strict byte ledger
    EvalPool pool(*m, g, P.pol, P.refuse, actor, &S, threads); Evaluator &E = pool.main();
    S.ctl.stage = SITE_REACH;
    std::vector<std::vector<double>> reach((size_t)n); std::vector<size_t> reachFb((size_t)n, 0); std::vector<double> reachFbW((size_t)n, 0), reachAllW((size_t)n, 0);
    for (int p = 0; p < n; p++) reach[(size_t)p] = reachWeights(E, R, p, R.used, reachFb[(size_t)p], &reachFbW[(size_t)p], &reachAllW[(size_t)p]);
    std::vector<int> opp; for (int p = 0; p < n; p++) if (p != actor) opp.push_back(p);
    for (int p : opp) if (!(countNonzero(reach[(size_t)p]) > 0)) throw QueryError{422, "Seat " + std::to_string(p) + " reaches this node with probability 0 under the " + std::string(policyName(P.pol)) + " policy; no EV is defined"};
    const double units = (double)hands.size() + (range ? (double)countNonzero(reach[(size_t)actor]) : 0);
    long long subtreeNodes = 0; bool subtreeCapped = false;
    S.ctl.stage = SITE_SUBTREE;
    const double cost = exactCost(E, R, reach, actor, (double)P.maxVisits / std::max(1.0, units), P.enumerateCap, subtreeNodes, subtreeCapped);
    bool useExact = P.method == "exact" || (P.method == "auto" && cost * units <= (double)P.maxVisits);
    const bool sampleActions = P.future == "sample" || (P.future == "auto" && subtreeNodes > P.enumerateCap);
    std::vector<HandResult> results; HandResult agg; agg.index = -1; bool stopped = false, boardBudgetHit = false; std::string fellBack; long long discardedInProgress = 0;
    const bool chip = m->tournament.start.empty() || S.forceChip; const double sunk = t.total[actor] + m->anteOf[(size_t)actor];
    auto evalExact = [&]() {
      S.ctl.stage = SITE_OPPONENTS; results.clear();
      for (int h : hands) { HandResult r; r.index = h; r.reach = reach[(size_t)actor][(size_t)h]; exactHand(pool, R, reach, h, r, P.maxVisits);
        if (!r.unreachable) { r.sigmaStored = E.policy(R.state, k, actor, h, R.known, r.sigma, &t); r.mix = 0; for (int a = 0; a < k; a++) r.mix += r.sigma[a] * r.ev[a]; finishResult(r, k, P.margin, P.minSamples); }
        results.push_back(r); }
      if (range) {
        double W = 0, ev[8] = {}, mix = 0, fb[8] = {}; long long vis = 0;
        for (size_t h = 0; h < arange.size(); h++) {
          const double rh = reach[(size_t)actor][h]; if (!(rh > 0)) continue;
          HandResult r; exactHand(pool, R, reach, (int)h, r, P.maxVisits); vis += r.visits; if (r.unreachable) continue;
          double sg[8]; E.policy(R.state, k, actor, (int)h, R.known, sg, &t);
          const double w = rh * r.opponentMass; W += w;
          for (int a = 0; a < k; a++) { ev[a] += w * r.ev[a]; mix += w * sg[a] * r.ev[a]; fb[a] += w * r.fb[a]; }
        }
        agg.exact = true; agg.visits = vis; agg.reach = W;
        if (!(W > 0)) { agg.unreachable = true; agg.note = "The acting seat's range cannot reach this node"; }
        else { for (int a = 0; a < k; a++) { agg.ev[a] = ev[a] / W; agg.fb[a] = fb[a] / W; } agg.mix = mix / W; finishResult(agg, k, P.margin, P.minSamples); }
      }
    };
    // Sampled evaluation in fixed blocks; returns false if stopped by the time limit.
    constexpr long long BLOCK = 256;
    auto runSampled = [&](HandResult &r, const Sampler &Sm, uint64_t base, uint32_t seedA, uint32_t seedB, int fixedHand) {
      if (!Sm.feasible()) { r.unreachable = true; r.note = "No holdings reach this node under the policy"; return; }
      const long long blocks = (P.samples + BLOCK - 1) / BLOCK;
      std::vector<Moments> part((size_t)blocks); std::vector<char> rare((size_t)blocks, 0); std::vector<long long> vis((size_t)blocks, 0);
      for (auto &M : part) M.k = k;
      std::atomic<bool> timeUp{false};
      // 4.4: samples in progress when the stop arrives are discarded whole (never half-counted);
      // inFlight counts them (at most one per worker) for the partial-result report.
      std::atomic<long long> inFlight{0};
      S.ctl.unitsTotal += blocks; S.ctl.stage = SITE_SAMPLE;
      S.plan(threads, (int)std::min<long long>(threads, blocks));
      try {
        parallelFor(S.ctl, threads, (size_t)blocks, [&](int w, size_t b) {
          Evaluator &X = pool.at(w); X.exact = false; X.sampleActions = sampleActions; X.dev = nullptr;
          Rng rng{deriveSeed(seedA, (long long)b, 2)}; X.rng = Rng{deriveSeed(seedB, (long long)b, 3)};
          const long long count = std::min(BLOCK, P.samples - (long long)b * BLOCK); const long long v0 = X.visits;
          for (long long s = 0; s < count; s++) {
            std::copy_n(R.cards, 5, X.cards);
            if (!Sm.draw(X, rng, base, R.known, 200000)) { rare[b] = 1; break; }
            if (fixedHand >= 0) X.hand[actor] = fixedHand;
            X.poll(SITE_SAMPLE);
            double v[8], fbs[8], sg[8];
            inFlight.fetch_add(1, std::memory_order_relaxed);
            sampleValues(X, R, v, fbs);
            X.policy(R.state, k, actor, X.hand[actor], R.known, sg, &t); part[b].add(v, sg, fbs); S.ctl.samples++;
            inFlight.fetch_sub(1, std::memory_order_relaxed);
          }
          vis[b] = X.visits - v0; S.ctl.unitsDone++;
        });
      } catch (const EvStop &e) { if (e.code != 2 && e.code != 6) throw; timeUp = true; if (e.code == 6) boardBudgetHit = true; }
      Moments M; M.k = k; bool anyRare = false; long long visits = 0;
      // 4.4: only blocks that hold samples are merged (a partial run touches a small prefix of the blocks)
      for (long long b = 0; b < blocks; b++) { if (part[(size_t)b].n) M.merge(part[(size_t)b]); anyRare |= rare[(size_t)b]; visits += vis[(size_t)b]; }
      if (timeUp) { stopped = true; r.partial = true; S.ctl.stop = 0; discardedInProgress += inFlight.load(); }
      if (!M.n) { r.unreachable = true; r.note = anyRare ? "Compatible holdings are too rare to sample at this node" : "No sample was completed within the time limit"; return; }
      if (timeUp && M.n < P.minSamples) { r.unreachable = true; r.note = "Only " + std::to_string(M.n) + " samples were completed within the time limit (minSamples " + std::to_string(P.minSamples) + "); no estimate is reported"; return; }
      if (M.n < 2) { r.unreachable = true; r.note = "Too few samples were completed"; return; }
      r.visits = visits; fromMoments(r, M, k); finishResult(r, k, P.margin, P.minSamples);
      if (anyRare) r.note = "Rejection sampling gave up in some blocks (compatible holdings are rare); fewer samples than requested";
    };
    S.ctl.markWorkBegin = S.ctl.elapsedMs();
    if (useExact) {
      try { evalExact(); }
      catch (const EvBudget &) {
        S.ctl.stop = 0;
        if (P.method == "exact") throw QueryError{422, "Exact evaluation exceeds maxVisits (" + std::to_string(P.maxVisits) + " visits); use method sampled or raise maxVisits"};
        useExact = false; fellBack = "exact evaluation exceeded maxVisits; switched to sampling";
      }
    }
    if (!useExact) {
      S.ctl.maxVisits = LLONG_MAX; results.clear();
      for (int h : hands) {
        HandResult r; r.index = h; r.reach = reach[(size_t)actor][(size_t)h];
        const Hand &own = arange[(size_t)h]; Sampler Sm; Sm.init(reach, opp);
        if (!stopped) runSampled(r, Sm, R.used | (1ULL << own.a) | (1ULL << own.b), deriveSeed((uint32_t)P.seed, h, 0), deriveSeed((uint32_t)P.seed, h, 1), h);
        else { r.unreachable = true; r.note = "Not evaluated: time limit reached"; }
        if (!r.unreachable) r.sigmaStored = E.policy(R.state, k, actor, h, R.known, r.sigma, &t);
        results.push_back(r);
      }
      if (range) {
        std::vector<int> all; for (int p = 0; p < n; p++) all.push_back(p);
        Sampler Sm; Sm.init(reach, all);
        if (!stopped) runSampled(agg, Sm, R.used, deriveSeed((uint32_t)P.seed, -1, 0), deriveSeed((uint32_t)P.seed, -1, 1), -1);
        else { agg.unreachable = true; agg.note = "Not evaluated: time limit reached"; }
      }
    }
    S.ctl.markWorkEnd = S.ctl.elapsedMs();
    // ---- optional fallback sensitivity (exact only; same deadline) ----
    struct Sens { Fallback f; std::vector<std::array<double, 8>> ev; std::vector<int> best; std::string error; };
    std::vector<Sens> sens;
    if (P.sensitivity && !P.refuse) {
      for (Fallback f : {Fallback::Uniform, Fallback::FoldCheck, Fallback::CallCheck}) {
        Sens s{f, {}, {}, ""};
        if (!useExact) { s.error = "sensitivity analysis needs an exact evaluation"; sens.push_back(s); continue; }
        EvShared S2; S2.ctl.cancel = cancel; S2.ctl.deadline = S.ctl.deadline; S2.device = S.device; S2.gpuBudget = S.gpuBudget; S2.memoryBudget = S.memoryBudget; S2.fallback = f; S2.forceChip = S.forceChip;
        EvalPool p2(*m, g, P.pol, false, actor, &S2, threads);
        std::vector<std::vector<double>> reach2((size_t)n); size_t dummy = 0;
        for (int p = 0; p < n; p++) reach2[(size_t)p] = reachWeights(p2.main(), R, p, R.used, dummy);
        for (int h : hands) {
          HandResult r; exactHand(p2, R, reach2, h, r, P.maxVisits); std::array<double, 8> e{}; int b = -1;
          if (!r.unreachable) { for (int a = 0; a < k; a++) { e[(size_t)a] = r.ev[a]; if (b < 0 || r.ev[a] > r.ev[b]) b = a; } }
          s.ev.push_back(e); s.best.push_back(b);
        }
        sens.push_back(s);
      }
    }
    // ---- coverage ----
    S.ctl.markStats = S.ctl.elapsedMs();
    const EvalPool::CovSummary cov = pool.coverage();
    S.ctl.markCoverage = S.ctl.elapsedMs();
    double maxFb = 0, maxReachFb = 0; long long sampledN = 0, affected = 0;
    auto scan = [&](const HandResult &r) { if (r.unreachable) return; for (int a = 0; a < k; a++) maxFb = std::max(maxFb, r.fb[a]); sampledN += r.samples; affected += r.affected; };
    for (auto &r : results) scan(r); if (range) scan(agg);
    for (int p = 0; p < n; p++) if (reachAllW[(size_t)p] > 0) maxReachFb = std::max(maxReachFb, reachFbW[(size_t)p] / reachAllW[(size_t)p]);
    const double influence = std::max(maxFb, maxReachFb);
    const char *level = influence >= P.severeShare && influence > 0 ? "substantial" : influence >= P.warnShare && influence > 0 ? "notable" : influence > 0 ? "minor" : "none";
    // ---- response ----
    JB body; jb_init(&body); JB *o = &body;
    jb_puts(o, "{\"engine\":\"native action EV\",\"version\":\"4.0\",\"node\":"); nodeJson(o, *m, R);
    jb_printf(o, ",\"policy\":\"%s\",\"missing\":\"%s\",\"fallback\":\"%s\"", policyName(P.pol), P.refuse ? "refuse" : "uniform", fallbackName(P.fallback));
    jb_printf(o, ",\"policyNote\":\"%s\"", P.pol == Pol::Average ? "Every seat (including the actor after this decision, and every seat's earlier actions that define the opponent ranges) follows the stored AVERAGE strategy." : "Every seat follows the CURRENT regret-matching strategy of the stored regrets (uniform where all regrets are non-positive, as in training).");
    utilityJson(o, *m, S.forceChip);
    jb_puts(o, ",\"actions\":["); for (int a = 0; a < k; a++) { jb_printf(o, "%s{\"slot\":%d,\"name\":\"%s\",\"to\":", a ? "," : "", a, actionName(t, a)); jb_num(o, t.to[a], 10); jb_putc(o, '}'); } jb_putc(o, ']');
    jb_printf(o, ",\"method\":\"%s\",\"status\":\"%s\",\"futureActions\":\"%s\",\"seed\":%lld,\"samplesRequested\":%lld,\"minSamples\":%lld,\"threads\":%d,\"exactCostEstimate\":", useExact ? "exact" : "sampled", stopped ? "partial" : "completed", useExact ? "enumerated" : sampleActions ? "sampled from the policy" : "enumerated", P.seed, useExact ? 0LL : P.samples, P.minSamples, threads);
    jnumOrNull(o, cost); jb_printf(o, ",\"subtreeNodes\":%lld,\"subtreeNodesIsLowerBound\":%s", subtreeNodes, subtreeCapped ? "true" : "false");
    if (!fellBack.empty()) { jb_puts(o, ",\"note\":"); jb_str(o, fellBack.c_str()); }
    jb_puts(o, ",\"reachFallbackHands\":["); for (int p = 0; p < n; p++) jb_printf(o, "%s%zu", p ? "," : "", reachFb[(size_t)p]); jb_putc(o, ']');
    jb_puts(o, ",\"statistics\":{\"version\":\"4.1\",\"design\":\"common random numbers: every sample evaluates all actions on the same cards, so every action has the same sample count and the estimates are correlated; the joint covariance is estimated from the samples\",\"comparison\":\"simultaneous paired intervals for all pairwise differences (single-step max-|t|, critical value simulated from the estimated joint covariance, multivariate t with n-1 degrees of freedom) and comparisons with the best of the other actions (Hsu MCB form), family-wise 95%: valid whichever action is truly best, so selecting the highest estimate is accounted for\",\"crossCheck\":\"Holm-adjusted p-values over all pairs\",\"equivalenceTest\":");
    if (std::isfinite(P.margin)) { jb_puts(o, "\"the simultaneous interval for (action minus best of the others) lies inside +/- margin (intersection-union, family-wise 95%)\",\"equivalenceMargin\":"); jnumOrNull(o, P.margin); }
    else jb_puts(o, "null,\"equivalenceMargin\":null");
    jb_puts(o, ",\"unadjustedFields\":\"stdErr, ci95, vsBestStdErr and vsBestCi95 are per-action and unadjusted (95% for one pre-specified comparison); use multipleComparisons for claims about which action is best\",\"stopping\":\"sampling stops at the sample target, the time limit or a budget, never on the observed values, so fixed-n intervals apply; re-running until an interval excludes zero is not covered\",\"note\":\"supportedBest is claimed only when the action beats every other action with family-wise 95% confidence. highestEstimate means the largest point estimate whose advantage is not established. differenceUncertain is never evidence of equality; practical equivalence is only claimed with an explicit equivalenceMargin. Intervals rely on the central limit theorem; with rare large payoffs and few samples coverage can be below nominal.\"}");
    jb_printf(o, ",\"coverage\":{\"fallbackPolicy\":\"%s\",\"fallbackDescription\":\"%s\",\"policyLookups\":%lld,\"storedLookups\":%lld,\"fallbackLookups\":%lld,\"distinctInformationSets\":%zu,\"distinctStoredInformationSets\":%zu,\"distinctFallbackInformationSets\":%zu,\"distinctCountCapped\":%s,\"accounting\":\"4.2\",\"capacityModel\":\"4.3\"",
              fallbackName(P.fallback), fallbackText(P.fallback), cov.lookups, cov.stored, cov.missing, cov.distinct, cov.distinctStored, cov.distinctMissing, cov.capped ? "true" : "false");
    jb_puts(o, ",\"distinctStoredShare\":"); jnumOrNull(o, cov.distinct ? (double)cov.distinctStored / (double)cov.distinct : 1.0);
    coverageCapacityJson(o, cov, S);
    if (const auto ac = pool.auditCounts(); ac[0] >= 0) jb_printf(o, ",\"audit\":{\"distinctInformationSets\":%lld,\"distinctStoredInformationSets\":%lld,\"distinctFallbackInformationSets\":%lld}", ac[0], ac[1], ac[2]);
    jb_puts(o, ",\"rowCoverage\":"); jnumOrNull(o, cov.lookups ? (double)cov.stored / (double)cov.lookups : 1.0);
    jb_puts(o, ",\"maxActionFallbackShare\":"); jnumOrNull(o, maxFb); jb_puts(o, ",\"maxOpponentReachFallbackShare\":"); jnumOrNull(o, maxReachFb);
    jb_puts(o, ",\"opponentReachFallbackShare\":["); for (int p = 0; p < n; p++) { if (p) jb_putc(o, ','); jnumOrNull(o, reachAllW[(size_t)p] > 0 ? reachFbW[(size_t)p] / reachAllW[(size_t)p] : 0); } jb_putc(o, ']');
    if (!useExact) { jb_printf(o, ",\"samplesEvaluated\":%lld,\"samplesWithFallback\":%lld,\"sampleFallbackShare\":", sampledN, affected); jnumOrNull(o, sampledN ? (double)affected / (double)sampledN : 0); }
    jb_printf(o, ",\"warnShare\":%.6g,\"severeShare\":%.6g,\"influence\":\"%s\",\"warning\":", P.warnShare, P.severeShare, level);
    if (!std::strcmp(level, "substantial") || !std::strcmp(level, "notable")) {
      char msg[512]; std::snprintf(msg, sizeof msg, "Up to %.1f%% of the probability mass of this evaluation passed through states with no stored %s strategy, where the %s fallback policy was substituted. These EVs depend on that assumption and do not represent a fully trained strategy.", 100 * influence, policyName(P.pol), fallbackName(P.fallback));
      jb_str(o, msg);
    } else jb_puts(o, "null");
    jb_puts(o, ",\"note\":\"rowCoverage counts policy lookups (visits); distinct* fields count information sets once each however often they are visited (an information set used both with and without a stored row, possible only with the current policy, counts in both distinct subsets); the shares are probability-weighted (fallback share of each action's terminal probability mass, and posterior weight of opponent hands whose path reach used the fallback).\"}");
    if (!sens.empty()) {
      jb_puts(o, ",\"fallbackSensitivity\":{\"note\":\"EVs recomputed under alternative fallback policies for untrained states. The spread shows dependence on that assumption; it is not a confidence interval.\",\"policies\":[");
      bool changes = false;
      for (size_t i = 0; i < sens.size(); i++) {
        if (i) jb_putc(o, ','); jb_printf(o, "{\"fallback\":\"%s\"", fallbackName(sens[i].f));
        if (!sens[i].error.empty()) { jb_puts(o, ",\"error\":"); jb_str(o, sens[i].error.c_str()); jb_putc(o, '}'); continue; }
        jb_puts(o, ",\"hands\":["); for (size_t h = 0; h < sens[i].ev.size(); h++) { if (h) jb_putc(o, ','); jb_puts(o, "{\"ev\":"); jarr(o, sens[i].ev[h].data(), k); jb_printf(o, ",\"best\":%d}", sens[i].best[h]); if (sens[i].best[h] != sens[0].best[h]) changes = true; }
        jb_puts(o, "]}");
      }
      jb_printf(o, "],\"bestActionChanges\":%s}", changes ? "true" : "false");
    }
    if (chip) { jb_puts(o, ",\"sunk\":"); jb_num(o, sunk, 10); }
    jb_puts(o, ",\"hands\":["); for (size_t i = 0; i < results.size(); i++) { if (i) jb_putc(o, ','); handJson(o, *m, t, actor, results[i], sunk, chip, P.margin); } jb_putc(o, ']');
    jb_puts(o, ",\"range\":"); if (range) handJson(o, *m, t, actor, agg, sunk, false, P.margin); else jb_puts(o, "null");
    pool.flushWork();
    if (useExact && S.ctl.boardEvals.load() > S.ctl.maxBoards) throw EvStop{6, SITE_TREE};   // never publish an exact result past its budget
    showdownJson(o, S); deadlineJson(o, S, P.timeMs); workJson(o, S, P.maxVisits, useExact ? 0 : P.samples, P.timeMs, P.memoryMiB);
    if (!useExact && stopped) {
      // 4.4: what a partial sampled estimate is. Samples are i.i.d. draws; every completed sample is kept with weight 1 and
      // samples that were being evaluated when the stop arrived are dropped whole.
      jb_printf(o, ",\"partialResult\":{\"samplesCompleted\":%lld,\"samplesDiscardedInProgress\":%lld,\"weights\":\"equal (every completed sample has weight 1)\",\"uncertainty\":\"standard errors and simultaneous intervals are computed from the completed samples with their own count n; they are fixed-n formulas applied to a time-stopped n\",\"limitation\":\"the stop time does not depend on the sampled values, but a sample that takes longer to evaluate is more likely to be the one in progress at the stop and be dropped; if evaluation cost is correlated with value this biases the estimate by at most (samplesDiscardedInProgress / samplesCompleted) x the range of the per-sample values, negligible against the reported standard error unless very few samples completed (minSamples guards that case)\"}", sampledN, discardedInProgress);
    }
    jb_printf(o, ",\"stoppedEarly\":%s,\"stoppedBy\":%s,\"elapsedMs\":%.1f}", stopped ? "true" : "false", !stopped ? "null" : boardBudgetHit ? "\"maxBoardEvaluations\"" : "\"timeLimit\"", (nowSec() - t0) * 1000);
    if (body.failed) { jb_free(&body); throw std::bad_alloc(); }
    jb_putn(out, body.s, body.n - 1); jb_puts(out, ",\"cache\":{\"hit\":false}}");
    if (!stopped) {
      std::lock_guard<std::mutex> lk(evCacheMutex());
      if (m->evCache.size() >= 32) m->evCache.clear();
      m->evCache.emplace(key, std::string(body.s, body.n));
    }
    jb_free(&body);
    return 200;
  } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  catch (const EvStop &e) {
    char msg[300];
    if (e.code == 1) { std::snprintf(msg, sizeof msg, "Calculation cancelled (during %s); no result is reported", siteName(e.site)); fail(err, errlen, msg); return 409; }
    if (e.code == 6) { std::snprintf(msg, sizeof msg, "Board-evaluation budget (maxBoardEvaluations) exhausted during %s before the evaluation completed; an incomplete exact result is never reported", siteName(e.site)); fail(err, errlen, msg); return 422; }
    std::snprintf(msg, sizeof msg, "Time limit reached (during %s) before the evaluation completed; an incomplete exact result is never reported", siteName(e.site)); fail(err, errlen, msg); return 408;
  }
  catch (const EvUnavailable &e) { fail(err, errlen, ("Unavailable: " + e.why + " (missing:\"refuse\")").c_str()); return 422; }
  catch (const EvBudget &) { fail(err, errlen, "Exact evaluation exceeds maxVisits"); return 422; }
  catch (const EvMemory &) { fail(err, errlen, "Evaluation memory budget exceeded"); return 503; }
  catch (const std::bad_alloc &) { fail(err, errlen, "Out of memory"); return 503; }
}
extern "C" void mw_gpu_prewarm(void) { es::EvGpu::get().openAsync(); }
extern "C" void mw_ev_cache_clear(MW *m) { if (!m) return; std::lock_guard<std::mutex> lk(evCacheMutex()); m->evCache.clear(); }
extern "C" void mw_gpu_status(JB *o) {
  using namespace es; EvGpu &G = EvGpu::get();
  const long long last = G.lastUseNs.load();
  jb_printf(o, "{\"attempted\":%s,\"opening\":%s,\"available\":%s,\"verified\":%s,\"opens\":%d,\"backgroundOpens\":%lld,\"openSeconds\":%.4f,\"verifications\":%lld,\"uses\":%lld,\"idleBufferReleases\":%lld,\"idleReleaseSeconds\":%.3f,\"secondsSinceLastUse\":",
            G.attempted ? "true" : "false", G.opening ? "true" : "false", G.ok ? "true" : "false", G.verified ? "true" : "false", G.opens.load(), G.asyncOpens.load(), G.openSeconds.load(), G.verifications.load(), G.uses.load(), G.idleReleases.load(), G.idleReleaseSec);
  if (last) jb_printf(o, "%.3f", (EvGpu::monoNs() - last) / 1e9); else jb_puts(o, "null");
  jb_printf(o, ",\"processDeviceBytes\":%lld,\"processPeakDeviceBytes\":%lld,\"cpuNsPerEval\":%.3f,\"gpuNsPerEval\":%.3f,\"batchFixedSeconds\":%.6f,\"cpuFusedNsPerEval\":%.3f}",
            CudaLedger::live().load(), CudaLedger::peak().load(), G.cpuNsPerEval.load(), G.gpuNsPerEval.load(), G.gpuBatchFixedSec.load(), cpuFusedNsPerEval().load());
}
extern "C" int mw_action_ev(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel) { return actionEvImpl(m, json, len, out, err, errlen, cancel, nullptr); }

namespace {
namespace es {
// Exact best response of E.actor against the others' fixed policies, from the study root.
// 4.0: with `firstStreetOnly` the seat maximizes only on the study's first street
// (later decisions follow sigma): the exact "restricted" response class. With
// a deviation map E.dev the seat follows those pure actions and sigma elsewhere
// (value of a fixed deviation policy).
struct BrOut { double br = 0, pv = 0, z = 0; };
struct Tup { int hand[8]; uint64_t mask; double w; };
inline std::pair<double, double> brRec(Evaluator &E, int seat, int own, int state, const BS &t, int len, const std::vector<Tup> &T, const std::vector<double> &w, int maxLen) {
  const int n = E.m.n; const Hand &oh = E.m.hands[(size_t)seat][(size_t)own]; const uint64_t ownMask = (1ULL << oh.a) | (1ULL << oh.b);
  E.visits++; E.poll(SITE_BR); if (E.visits > E.sh->ctl.maxVisits) throw EvBudget{};
  BS c;
  if (t.kind == 2) {
    double s = 0; uint64_t pub = 0; for (int i = 0; i < len; i++) pub |= 1ULL << E.cards[i];
    // 4.8: the pot layout depends only on the betting state, so it is computed once per terminal
    // node instead of once per opponent-hand tuple (6.1 million Rules::pots calls, 28% of one
    // six-player flop best response in 4.7). An uncontested pot pays the same for every tuple: its
    // value is computed once and accumulated in the same order, so the sum is bit-identical.
    // EM_BR_NO_HOIST=1 restores the 4.7 loop (bit-identity tests).
    static const bool noHoist = std::getenv("EM_BR_NO_HOIST") != nullptr;
    if (noHoist) {
      for (size_t i = 0; i < T.size(); i++) if (w[i] > 0) {
        for (int p = 0; p < n; p++) if (p != seat) E.hand[p] = T[i].hand[p];
        E.hand[seat] = own; E.used = pub | ownMask | T[i].mask; E.visits++;
        s += w[i] * E.terminal(t, len, 0, false);
      }
      return {s, s};
    }
    const int np = E.g.rules.pots(t, E.pots);
    if (!Evaluator::contested(E.pots, np)) {
      bool any = false; for (size_t i = 0; i < T.size(); i++) if (w[i] > 0) { any = true; break; }
      if (!any) return {0.0, 0.0};
      for (size_t i = 0; i < T.size(); i++) if (w[i] > 0) { for (int p = 0; p < n; p++) if (p != seat) E.hand[p] = T[i].hand[p]; E.hand[seat] = own; E.used = pub | ownMask | T[i].mask; break; }
      const double u = E.uncontested(t, np);
      for (size_t i = 0; i < T.size(); i++) if (w[i] > 0) { E.visits++; s += w[i] * u; }
      return {s, s};
    }
    for (size_t i = 0; i < T.size(); i++) if (w[i] > 0) {
      for (int p = 0; p < n; p++) if (p != seat) E.hand[p] = T[i].hand[p];
      E.hand[seat] = own; E.used = pub | ownMask | T[i].mask; E.visits++;
      s += w[i] * ((!E.exact || len == 5) ? E.scored(t, np) : E.runout(t, np, len));
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
        E.cards[len] = x; const auto r = brRec(E, seat, own, cs, c, len + 1, T, w2, maxLen); br += r.first; pv += r.second;
      }
    } else {
      const double combos = nChooseK(deck, 3);
      for (int a = 0; a < 52; a++) for (int b = a + 1; b < 52; b++) for (int d = b + 1; d < 52; d++) {
        const uint64_t f = (1ULL << a) | (1ULL << b) | (1ULL << d); if (f & ownMask) continue;
        E.poll(SITE_CHANCE);
        bool any = false; for (size_t i = 0; i < T.size(); i++) { w2[i] = (T[i].mask & f) ? 0 : w[i] / combos; any |= w2[i] > 0; }
        if (!any) continue;
        E.cards[0] = a; E.cards[1] = b; E.cards[2] = d; const auto r = brRec(E, seat, own, cs, c, 3, T, w2, maxLen); br += r.first; pv += r.second;
      }
    }
    return {br, pv};
  }
  if (t.k == 1) { const int cs = E.childOf(state, t, 0, c); return brRec(E, seat, own, cs, c, len, T, w, maxLen); }
  double p[8];
  if (t.actor == seat) {
    // p: sigma (the evaluated policy, for the second value); pd: what the
    // responder plays (a fixed deviation where one is given, else sigma).
    E.policy(state, t.k, seat, own, len, p, &t);
    double pd[8]; std::copy_n(p, t.k, pd);
    if (E.dev && state >= 0) { auto it = E.dev->find(Evaluator::devKey(state, own)); if (it != E.dev->end()) for (int a = 0; a < t.k; a++) pd[a] = a == it->second ? 1.0 : 0.0; }
    const bool maximize = !E.dev && t.length <= maxLen;
    double best = -INFINITY, pv = 0, follow = 0;
    for (int a = 0; a < t.k; a++) {
      if (!maximize && !(p[a] > 0) && !(pd[a] > 0)) continue;
      const int cs = E.childOf(state, t, a, c); const auto r = brRec(E, seat, own, cs, c, len, T, w, maxLen);
      best = std::max(best, r.first); pv += p[a] * r.second; follow += pd[a] * r.first;
    }
    return {maximize ? best : follow, pv};
  }
  std::vector<std::vector<double>> wa((size_t)t.k, std::vector<double>(w.size(), 0.0));
  for (size_t i = 0; i < T.size(); i++) if (w[i] > 0) { E.poll(SITE_BR); E.policy(state, t.k, t.actor, T[i].hand[t.actor], len, p, &t); for (int a = 0; a < t.k; a++) wa[(size_t)a][i] = w[i] * p[a]; }
  double br = 0, pv = 0;
  for (int a = 0; a < t.k; a++) {
    bool any = false; for (double x : wa[(size_t)a]) any |= x > 0; if (!any) continue;
    const int cs = E.childOf(state, t, a, c); const auto r = brRec(E, seat, own, cs, c, len, T, wa[(size_t)a], maxLen); br += r.first; pv += r.second;
  }
  return {br, pv};
}
inline BrOut exactBestResponse(Evaluator &E, int seat, int maxLen = 99) {
  const MW &m = E.m; const int n = m.n; BrOut out; uint64_t board = 0; for (int i = 0; i < m.startLen; i++) board |= 1ULL << m.board[i];
  std::copy_n(m.board, 5, E.cards);
  const long long tupleCap = std::max<long long>(1000, std::min<long long>(2000000, E.sh->memoryBudget / 4 / (long long)sizeof(Tup)));
  for (size_t h = 0; h < m.hands[(size_t)seat].size(); h++) {
    const Hand &oh = m.hands[(size_t)seat][h]; const uint64_t om = (1ULL << oh.a) | (1ULL << oh.b);
    if (!(oh.w > 0) || (om & board)) continue;
    std::vector<Tup> T; Tup cur{};
    std::function<void(int, uint64_t, double)> rec = [&](int p, uint64_t u, double w) {
      E.poll(SITE_TUPLES);
      if (p == n) { cur.mask = u & ~(board | om); cur.w = w; T.push_back(cur); if ((long long)T.size() > tupleCap) throw EvBudget{}; return; }
      if (p == seat) { rec(p + 1, u, w); return; }
      const auto &rg = m.hands[(size_t)p];
      for (size_t i = 0; i < rg.size(); i++) { const uint64_t b = (1ULL << rg[i].a) | (1ULL << rg[i].b); if ((u & b) || !(rg[i].w > 0)) continue; cur.hand[p] = (int)i; rec(p + 1, u | b, w * rg[i].w); }
    };
    rec(0, board | om, 1.0);
    if (T.empty()) continue;
    std::vector<double> w(T.size()); double z = 0; for (size_t i = 0; i < T.size(); i++) { w[i] = T[i].w; z += w[i]; }
    std::copy_n(m.board, 5, E.cards);
    const auto r = brRec(E, seat, (int)h, 0, E.g.rootState, m.startLen, T, w, maxLen);
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
// Every decision node of `seat` on the study's first street with a committed betting state (state >= 0).
struct SeatNode { std::vector<int> path; int state, depth; };
inline std::vector<SeatNode> seatNodes(Evaluator &E, int seat, size_t cap, bool &truncated) {
  std::vector<SeatNode> out; std::vector<int> path; truncated = false;
  std::function<void(const BS &, int)> dfs = [&](const BS &t, int state) {
    E.poll(SITE_SUBTREE);
    if (t.kind != 0 || state < 0) return;
    if (t.actor == seat) { if (out.size() >= cap) { truncated = true; return; } out.push_back({path, state, (int)path.size()}); }
    BS c; for (int a = 0; a < t.k; a++) { const int cs = E.childOf(state, t, a, c); path.push_back(a); dfs(c, cs); path.pop_back(); }
  };
  dfs(E.g.rootState, 0);
  std::stable_sort(out.begin(), out.end(), [](const SeatNode &a, const SeatNode &b) { return a.depth > b.depth; });
  return out;
}
} // namespace es
} // namespace

static int responseGainImpl(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel, es::EvShared *shared) {
  using namespace es;
  if (!m || !m->es) { fail(err, errlen, "Response gains need a native external-sampling study"); return 400; }
  const Game &g = *m->es; const int n = m->n; const double t0 = nowSec();
  EvShared local; EvShared &S = shared ? *shared : local; S.ctl.cancel = cancel;
  JV *req = nullptr;
  try { req = parseRequest(json, len, err, errlen); } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  struct Free { JV *v; ~Free() { json_free(v); } } freeReq{req};
  try {
    const Fields F(req, {"method", "seats", "path", "board", "policy", "missing", "samples", "selectionSamples", "reachSamples", "seed", "maxVisits", "timeLimitMs", "futureActions", "studyId",
                         "selection", "maxNodes", "memoryMiB", "coverageMiB", "device", "fallback", "maxBoardEvaluations", "threads"});
    const std::string method = F.choice("method", {"exact", "sampled", "restricted"}, "sampled");
    std::vector<int> seats = F.intArray("seats", 0, n - 1, 8);
    for (size_t i = 0; i < seats.size(); i++) for (size_t j = 0; j < i; j++) if (seats[i] == seats[j]) throw QueryError{400, "seats lists a seat twice"};
    if (seats.empty()) for (int p = 0; p < n; p++) seats.push_back(p);
    const bool customNode = F.has("path") || F.has("board");
    if (customNode && seats.size() != 1) throw QueryError{400, "path/board select one node: give exactly one seat"};
    if (customNode && method != "sampled") throw QueryError{400, "Exact and restricted best responses always start at the study root; path/board apply to method sampled"};
    const std::vector<int> cpath = F.intArray("path", 0, 7, MAX_DEPTH), cboard = F.intArray("board", 0, 51, 5);
    EvParams P; P.pol = F.choice("policy", {"average", "current"}, "average") == "average" ? Pol::Average : Pol::Current;
    P.refuse = F.choice("missing", {"uniform", "refuse"}, "uniform") == "refuse";
    P.samples = F.optInt("samples", 64, 2000000, 20000); P.seed = F.optInt("seed", 0, 4294967295LL, 1);
    P.maxVisits = F.optInt("maxVisits", 1000, 2000000000LL, 200000000); P.timeMs = F.optInt("timeLimitMs", 100, 3600000, 120000);
    P.future = F.choice("futureActions", {"auto", "enumerate", "sample"}, "auto");
    P.memoryMiB = F.optInt("memoryMiB", 16, 4096, 512); P.device = deviceOf(F); P.fallback = fallbackOf(F);
    P.coverageMiB = F.optInt("coverageMiB", 1, 4096, std::clamp<long long>(P.memoryMiB / 4, 4, 64));
    P.maxBoards = F.optInt("maxBoardEvaluations", 1000, 1000000000000000LL, LLONG_MAX);
    P.threads = F.optInt("threads", 1, 64, 0);   // 4.1: per-seat parallel response evaluation
    const long long selection = F.optInt("selectionSamples", 16, 100000, 200), reachN = F.optInt("reachSamples", 64, 2000000, 20000), maxNodes = F.optInt("maxNodes", 1, 4096, 256);
    const std::string selMode = F.choice("selection", {"auto", "exact", "sampled"}, "auto");
    if (method != "restricted" && (F.has("selection") || F.has("maxNodes"))) throw QueryError{400, "selection and maxNodes apply to method restricted"};
    if (const JV *v = F.get("studyId")) { if (v->type != J_STR) throw QueryError{400, "studyId must be a string"}; if (m->studyId.empty() || m->studyId != v->str) throw QueryError{409, "studyId does not match the open study"}; }
    S.ctl.setDeadline(P.timeMs); S.device = P.device; S.memoryBudget = P.memoryMiB << 20; S.setCoverage(P.coverageMiB); S.fallback = P.fallback; S.ctl.maxVisits = method == "sampled" ? LLONG_MAX : P.maxVisits; S.ctl.maxBoards = P.maxBoards;
    if (S.ctl.validateOnly) { jb_puts(out, "{\"valid\":true}"); return 200; }
    const bool chip = m->tournament.start.empty();
    JB body; jb_init(&body); JB *o = &body;
    struct FreeB { JB *b; ~FreeB() { jb_free(b); } } freeB{&body};
    const char *mode = method == "exact" ? "exactBestResponse" : method == "restricted" ? "restrictedBestResponse" : "sampledOneDecisionDeviation";
    const int seatThreads = std::max(1, std::min<int>(effectiveThreads(P.threads), (int)std::max<size_t>(1, seats.size())));
    jb_printf(o, "{\"engine\":\"native response gain\",\"version\":\"4.1\",\"threads\":%d,\"method\":\"%s\",\"mode\":\"%s\",\"policy\":\"%s\",\"missing\":\"%s\",\"fallback\":\"%s\",\"players\":%d,\"updates\":%lld,\"sampledDeals\":%lld,\"seed\":%lld", seatThreads, method.c_str(), mode, policyName(P.pol), P.refuse ? "refuse" : "uniform", fallbackName(P.fallback), n, m->iterations, m->trainingDeals, P.seed);
    utilityJson(o, *m);
    jb_printf(o, ",\"abstraction\":{\"startStreet\":\"%s\",\"bettingAbstraction\":\"the study's solved action menu; unsolved bet sizes are never synthesized\"}", streetName(m->startLen));
    std::vector<double> gains;
    // 4.1: seats are evaluated concurrently (threads, default as for action EVs).
    // Every per-seat random stream is derived from (seed, seat, purpose), each
    // seat gets its own control block (child of S: memory and board budgets stay
    // request totals, cancellation and the deadline are shared) and writes its
    // JSON to its own buffer; buffers and gains are merged in seat order, so the
    // result is bit-identical for every thread count (unless the memory budget
    // forces per-board enumeration for a seat, which changes only summation order).
    auto runSeats = [&](auto &&body) {
      const size_t ns = seats.size();
      std::vector<JB> outs(ns); std::vector<std::vector<double>> gs(ns); std::vector<std::unique_ptr<EvShared>> kids(ns);
      for (size_t i = 0; i < ns; i++) {
        jb_init(&outs[i]); kids[i] = std::make_unique<EvShared>(); EvShared &K = *kids[i];
        K.ctl.parent = &S.ctl; K.ctl.cancel = S.ctl.cancel; K.ctl.deadline = S.ctl.deadline; K.ctl.maxVisits = S.ctl.maxVisits; K.ctl.maxBoards = S.ctl.maxBoards;
        K.device = S.device; K.gpuBudget = S.gpuBudget; K.memoryBudget = S.memoryBudget; K.fallback = S.fallback; K.forceChip = S.forceChip; K.gpuWaitMs = S.gpuWaitMs;
        K.cache = S.cache; K.gpuBatchChunks = S.gpuBatchChunks; K.coverageKeys = S.coverageKeys; K.coverageBytes = S.coverageBytes; K.coveragePool = S.coveragePool;   // 4.3: one table cache for every seat of the request
      }
      S.plan(effectiveThreads(P.threads), seatThreads);
      auto merge = [&](EvShared &K) {
        EvControl &c = S.ctl, &d = K.ctl;
        c.visits += d.visits.load(); c.samples += d.samples.load(); c.unitsDone += d.unitsDone.load() + 1; c.tables += d.tables.load(); c.boards += d.boards.load(); c.checks += d.checks.load();
        c.maxGapNs.store(std::max(c.maxGapNs.load(), d.maxGapNs.load()));
        for (int st = 0; st < SITE_COUNT; st++) c.work[st] += d.work[st].load();
        ShowdownStats &a = S.show, &b = K.show;
        a.tables += b.tables.load(); a.boards += b.boards.load(); a.cpuBoards += b.cpuBoards.load(); a.gpuBoards += b.gpuBoards.load(); a.gpuTables += b.gpuTables.load(); a.hybridTables += b.hybridTables.load();
        a.patternSets += b.patternSets.load(); a.directTerminals += b.directTerminals.load(); a.gpuFailures += b.gpuFailures.load(); a.reused += b.reused.load();
        for (int x = 0; x < 3; x++) a.autoArm[x] += b.autoArm[x].load(); a.cpuMeasuredFaster += b.cpuMeasuredFaster.load(); a.cpuForced += b.cpuForced.load(); a.cpuSmall += b.cpuSmall.load(); a.cpuSlower += b.cpuSlower.load(); a.cpuUnavailable += b.cpuUnavailable.load(); a.cpuBusy += b.cpuBusy.load(); a.cpuAfterFailure += b.cpuAfterFailure.load(); a.verificationBoards += b.verificationBoards.load();
        a.gpuPeakBytes.store(std::max(a.gpuPeakBytes.load(), b.gpuPeakBytes.load()));
        a.cpuWarmup += b.cpuWarmup.load(); a.gpuTransient += b.gpuTransient.load(); a.gpuWaitTimeouts += b.gpuWaitTimeouts.load();
        a.sharedTableHits += b.sharedTableHits.load(); a.tableWaits += b.tableWaits.load(); a.nsTableWait += b.nsTableWait.load(); a.helperThreads += b.helperThreads.load(); a.cpuOpening += b.cpuOpening.load(); a.gpuBackgroundOpens += b.gpuBackgroundOpens.load(); a.gpuBatches += b.gpuBatches.load(); a.patternChunksForGpu += b.patternChunksForGpu.load();
        a.nsCpuTables += b.nsCpuTables.load(); a.nsPatterns += b.nsPatterns.load(); a.nsGpuOpen += b.nsGpuOpen.load(); a.nsGpuVerify += b.nsGpuVerify.load(); a.nsGpuUploadLaunch += b.nsGpuUploadLaunch.load(); a.nsGpuDownload += b.nsGpuDownload.load(); a.nsGpuLockWait += b.nsGpuLockWait.load();
        { std::lock_guard<std::mutex> g1(b.mu); for (size_t e = 0; e < b.errors.size(); e++) a.error(b.errors[e], b.errorFallback[e] != 0); }
        if (a.gpuNote.empty() && !b.gpuNote.empty()) a.gpuNote = b.gpuNote;
      };
      S.ctl.unitsTotal += (long long)ns;
      try { parallelFor(S.ctl, seatThreads, ns, [&](int, size_t i) { body(i, &outs[i], *kids[i], gs[i]); }); }
      catch (...) { for (auto &b : outs) jb_free(&b); throw; }
      bool oom = false;
      for (size_t i = 0; i < ns; i++) { oom |= outs[i].failed; jb_putn(o, outs[i].s, outs[i].n); jb_free(&outs[i]); gains.insert(gains.end(), gs[i].begin(), gs[i].end()); merge(*kids[i]); }
      if (oom) throw std::bad_alloc();
    };
    if (method == "exact") {
      jb_puts(o, ",\"responseClass\":\"full best response of one seat over exact private hands and boards inside the study's betting abstraction, all other seats fixed\",\"seats\":[");
      runSeats([&](size_t i, JB *o, EvShared &S, std::vector<double> &gains) {
        const int seat = seats[i]; const double ts = nowSec(); Evaluator E(*m, g, P.pol, P.refuse, seat, &S); E.exact = true; S.ctl.unitVisits = 0;
        BrOut r; try { r = exactBestResponse(E, seat); } catch (const EvBudget &) { throw QueryError{422, "Exact best response exceeds maxVisits (" + std::to_string(P.maxVisits) + ") or its memory budget; use method restricted or sampled"}; }
        if (!(r.z > 0)) throw QueryError{422, "Seat " + std::to_string(seat) + " has no possible deal"};
        const double gain = (r.br - r.pv) / r.z; gains.push_back(gain);
        jb_printf(o, "%s{\"seat\":%d,\"policyValue\":", i ? "," : "", seat); jnumOrNull(o, r.pv / r.z); jb_puts(o, ",\"bestResponseValue\":"); jnumOrNull(o, r.br / r.z);
        jb_puts(o, ",\"gain\":"); jnumOrNull(o, gain); jb_puts(o, ",\"gainBits\":"); jbits(o, gain); jb_printf(o, ",\"stdErr\":0,\"visits\":%lld,\"elapsedMs\":%.1f,\"fallbackLookups\":%lld,\"policyLookups\":%lld,\"distinctInformationSets\":%zu,\"distinctFallbackInformationSets\":%zu,\"distinctCountKind\":\"%s\"}", E.visits, (nowSec() - ts) * 1000, E.cov.missing, E.cov.lookups, E.cov.distinct, E.cov.distinctMissing, E.cov.capped ? "lowerBound" : "exact");
      });
      jb_putc(o, ']');
      if (seats.size() == (size_t)n) {
        double sum = 0; for (double x : gains) sum += x;
        jb_puts(o, ",\"nashConv\":"); jnumOrNull(o, sum);
        if (n == 2 && chip) { jb_puts(o, ",\"exploitability\":"); jnumOrNull(o, sum / 2); jb_puts(o, ",\"exploitabilityNote\":\"Two seats with chip EV (constant-sum): exact exploitability of the evaluated policy in this card and betting abstraction = NashConv / 2.\""); }
        else jb_puts(o, ",\"exploitability\":null,\"exploitabilityNote\":\"More than two seats or an ICM utility: the game is not two-player zero-sum, so per-seat gains are reported and no exploitability is claimed.\"");
      }
    } else if (method == "restricted") {
      jb_puts(o, ",\"responseClass\":\"best response restricted to the seat's decisions on the study's first street (later streets follow the evaluated policy), by backward induction over those decision nodes; unvisited betting states keep the fallback policy. A lower bound on the full best-response gain, not exploitability.\",\"seats\":[");
      runSeats([&](size_t si, JB *o, EvShared &S, std::vector<double> &gains) {
        const int seat = seats[si]; const double ts = nowSec(); if (si) jb_putc(o, ',');
        S.ctl.maxVisits = P.maxVisits; S.ctl.unitVisits = 0;
        EvalPool pool(*m, g, P.pol, P.refuse, seat, &S, 1); Evaluator &E = pool.main();
        bool truncated = false; std::vector<SeatNode> nodes = seatNodes(E, seat, (size_t)maxNodes, truncated);
        std::unordered_map<uint64_t, int> devMap; long long decided = 0, changed = 0; bool exactSel = selMode != "sampled";
        Rng selRng{deriveSeed((uint32_t)P.seed, seat, 40)}; E.rng = Rng{deriveSeed((uint32_t)P.seed, seat, 41)};
        std::string selNote;
        for (const SeatNode &N : nodes) {
          Resolved R = resolvePath(*m, g, N.path, {}, cancel);
          const BS &t = R.node(); const int k = t.k;
          std::vector<std::vector<double>> reach((size_t)n); size_t fbd = 0;
          E.dev = nullptr; for (int p = 0; p < n; p++) reach[(size_t)p] = reachWeights(E, R, p, R.used, fbd);
          std::vector<int> opp; for (int p = 0; p < n; p++) if (p != seat) opp.push_back(p);
          bool feasible = true; for (int p : opp) feasible &= countNonzero(reach[(size_t)p]) > 0;
          if (!feasible) continue;
          const auto &rg = m->hands[(size_t)seat];
          for (size_t h = 0; h < rg.size(); h++) {
            const Hand &oh = rg[h]; if (!(oh.w > 0) || (R.used >> oh.a & 1) || (R.used >> oh.b & 1)) continue;
            E.poll(SITE_SELECTION);
            double v[8]; bool ok = false;
            if (exactSel) {
              try {
                E.dev = &devMap; E.devSeat = seat; HandResult r; std::copy_n(R.cards, 5, E.cards); E.hand[seat] = (int)h;
                // exactHand on a one-worker pool with the deviation map in place
                Evaluator &X = pool.at(0); X.dev = &devMap; X.devSeat = seat;
                exactHand(pool, R, reach, (int)h, r, P.maxVisits);
                if (!r.unreachable) { std::copy_n(r.ev, k, v); ok = true; }
              } catch (const EvBudget &) {
                if (selMode == "exact") throw QueryError{422, "Exact restricted best response exceeds maxVisits; use selection sampled"};
                S.ctl.stop = 0; S.ctl.maxVisits = LLONG_MAX; exactSel = false; selNote = "exact selection exceeded maxVisits; switched to sampled selection";
              }
            }
            if (!exactSel) {
              Sampler So; So.init(reach, opp); if (!So.feasible()) continue;
              Moments M; M.k = k; E.exact = false; E.sampleActions = true; E.dev = &devMap; E.devSeat = seat;
              const uint64_t base = R.used | (1ULL << oh.a) | (1ULL << oh.b);
              for (long long s = 0; s < selection; s++) { std::copy_n(R.cards, 5, E.cards); if (!So.draw(E, selRng, base, R.known, 20000)) break; E.hand[seat] = (int)h; double vv[8], f[8], sg[8]; sampleValues(E, R, vv, f); for (int a = 0; a < k; a++) sg[a] = 1.0 / k; M.add(vv, sg, f); }
              if (!M.n) continue;
              for (int a = 0; a < k; a++) v[a] = M.mean(a); ok = true;
            }
            if (!ok) continue;
            int best = 0; for (int a = 1; a < k; a++) if (v[a] > v[best]) best = a;
            double sg[8]; E.dev = nullptr; E.policy(N.state, k, seat, (int)h, R.known, sg, &t);
            devMap[Evaluator::devKey(N.state, (int)h)] = best; decided++; if (sg[best] < 1 - 1e-12) changed++;
          }
        }
        // Evaluate the fixed deviation policy against sigma.
        double gain = NAN, se = NAN, pvOut = NAN, dvOut = NAN; long long cnt = 0; bool exactEval = exactSel;
        if (exactSel) {
          try {
            S.ctl.unitVisits = 0; Evaluator X(*m, g, P.pol, P.refuse, seat, &S); X.exact = true; X.dev = &devMap; X.devSeat = seat;
            BrOut r = exactBestResponse(X, seat);
            if (r.z > 0) { gain = (r.br - r.pv) / r.z; se = 0; pvOut = r.pv / r.z; dvOut = r.br / r.z; }
          } catch (const EvBudget &) { exactEval = false; S.ctl.stop = 0; S.ctl.maxVisits = LLONG_MAX; selNote += selNote.empty() ? "exact evaluation exceeded maxVisits; gain sampled" : "; gain sampled"; }
        }
        if (!exactEval) {
          std::vector<std::vector<double>> prior((size_t)n); std::vector<int> all;
          uint64_t board = 0; for (int i = 0; i < m->startLen; i++) board |= 1ULL << m->board[i];
          for (int p = 0; p < n; p++) { all.push_back(p); prior[(size_t)p].assign(m->hands[(size_t)p].size(), 0.0); for (size_t i = 0; i < prior[(size_t)p].size(); i++) { const Hand &h = m->hands[(size_t)p][i]; if (!((board >> h.a & 1) || (board >> h.b & 1))) prior[(size_t)p][i] = h.w; } }
          Sampler Sp; Sp.init(prior, all); Rng evRng{deriveSeed((uint32_t)P.seed, seat, 50)}; double sd = 0, sd2 = 0;
          if (Sp.feasible()) {
            try {
              for (long long s = 0; s < P.samples; s++) {
                std::copy_n(m->board, 5, E.cards); if (!Sp.draw(E, evRng, board, m->startLen, 200000)) break;
                const uint32_t streamSeed = deriveSeed((uint32_t)P.seed, seat, 51 + (int)(s & 0x3fffffff));
                int handsCopy[8]; std::copy_n(E.hand, 8, handsCopy); int cardsCopy[5]; std::copy_n(E.cards, 5, cardsCopy); const uint64_t usedCopy = E.used;
                E.exact = false; E.sampleActions = true; E.actor = seat;
                E.dev = &devMap; E.devSeat = seat; E.rng = Rng{streamSeed}; const double dv = E.value(0, g.rootState, m->startLen, 1.0, false);
                std::copy_n(handsCopy, 8, E.hand); std::copy_n(cardsCopy, 5, E.cards); E.used = usedCopy;
                E.dev = nullptr; E.rng = Rng{streamSeed}; const double pv = E.value(0, g.rootState, m->startLen, 1.0, false);
                const double d = dv - pv; sd += d; sd2 += d * d; cnt++; S.ctl.samples++;
              }
            } catch (const EvStop &e) { if ((e.code != 2 && e.code != 6) || cnt < 64) throw; S.ctl.stop = 0; selNote += selNote.empty() ? "evaluation stopped at the time limit" : "; evaluation stopped at the time limit"; }
          }
          if (cnt >= 2) { gain = sd / cnt; se = std::sqrt(std::max(0.0, (sd2 - cnt * gain * gain) / (cnt - 1)) / cnt); }
        }
        jb_printf(o, "{\"seat\":%d,\"available\":%s,\"mode\":\"restrictedBestResponse\",\"selection\":\"%s\",\"evaluation\":\"%s\",\"decisionNodes\":%zu,\"nodesTruncated\":%s,\"handDecisions\":%lld,\"handDecisionsChanged\":%lld",
                  seat, std::isfinite(gain) ? "true" : "false", exactSel ? "exact" : "sampled", exactEval ? "exact" : "sampled from the root on an independent stream (common random numbers for the deviation and the policy)", nodes.size(), truncated ? "true" : "false", decided, changed);
        if (!selNote.empty()) { jb_puts(o, ",\"note\":"); jb_str(o, selNote.c_str()); }
        if (std::isfinite(gain)) {
          jb_puts(o, ",\"gain\":{\"mean\":"); jnumOrNull(o, gain); jb_puts(o, ",\"stdErr\":"); jnumOrNull(o, se); jb_puts(o, ",\"ci95\":"); if (se > 0) { jb_putc(o, '['); jnumOrNull(o, gain - 1.96 * se); jb_putc(o, ','); jnumOrNull(o, gain + 1.96 * se); jb_putc(o, ']'); } else jb_puts(o, "null");
          jb_printf(o, ",\"samples\":%lld}", cnt);
          if (exactEval) { jb_puts(o, ",\"policyValue\":"); jnumOrNull(o, pvOut); jb_puts(o, ",\"restrictedResponseValue\":"); jnumOrNull(o, dvOut); }
          gains.push_back(gain);
        }
        jb_printf(o, ",\"elapsedMs\":%.1f,\"fallbackLookups\":%lld,\"policyLookups\":%lld,\"distinctInformationSets\":%zu,\"distinctFallbackInformationSets\":%zu,\"distinctCountKind\":\"%s\"}", (nowSec() - ts) * 1000, E.cov.missing, E.cov.lookups, E.cov.distinct, E.cov.distinctMissing, E.cov.capped ? "lowerBound" : "exact");
      });
      jb_putc(o, ']');
    } else {
      jb_puts(o, ",\"responseClass\":\"one-shot deviation at one decision node per seat (continuation unchanged); best action per hand selected on an independent sample stream, gain evaluated on another; a lower bound on the seat's best-response gain, not exploitability\",\"seats\":[");
      runSeats([&](size_t si, JB *o, EvShared &S, std::vector<double> &gains) {
        const int seat = seats[si]; std::vector<int> path = cpath; const double ts = nowSec();
        if (si) jb_putc(o, ',');
        if (!customNode && !defaultPath(g, seat, path)) { jb_printf(o, "{\"seat\":%d,\"available\":false,\"reason\":\"The seat has no decision on the study's first street\"}", seat); return; }
        Resolved R = resolvePath(*m, g, path, cboard, cancel);
        const BS &t = R.node();
        if (t.kind != 0 || t.actor != seat) throw QueryError{400, "The path does not end at a decision of seat " + std::to_string(seat)};
        const int k = t.k;
        Evaluator E(*m, g, P.pol, P.refuse, seat, &S); E.exact = false;
        long long sub = 0; { BS c; for (int a = 0; a < k && sub <= 4096; a++) { g.rules.advance(t, a, c); sub += E.subtree(c, 4097 - sub); } }
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
          for (long long s = 0; s < selection; s++) { std::copy_n(R.cards, 5, E.cards); if (!So.draw(E, selRng, base, R.known, 20000)) break; E.hand[seat] = (int)h; double v[8], f[8], sg[8]; sampleValues(E, R, v, f); E.policy(R.state, k, seat, (int)h, R.known, sg, &t); M.add(v, sg, f); }
          if (!M.n) continue;
          int best = 0; for (int a = 1; a < k; a++) if (M.mean(a) > M.mean(best)) best = a;
          choice[h] = best; considered++;
          double sg[8]; E.policy(R.state, k, seat, (int)h, R.known, sg, &t); if (sg[best] < 1 - 1e-12) deviating++;
        }
        // 2) evaluation stream: joint posterior samples of (own hand, opponents)
        Sampler Sj; Sj.init(reach, all); Rng evRng{deriveSeed((uint32_t)P.seed, seat, 20)}; E.rng = Rng{deriveSeed((uint32_t)P.seed, seat, 21)};
        double sd = 0, sd2 = 0; long long cnt = 0; bool stopped = false;
        if (Sj.feasible()) for (long long s = 0; s < P.samples; s++) {
          std::copy_n(R.cards, 5, E.cards);
          if (!Sj.draw(E, evRng, R.used, R.known, 200000)) break;
          const int h = E.hand[seat]; if (choice[(size_t)h] < 0) continue;
          double v[8], f[8], sg[8];
          try { sampleValues(E, R, v, f); } catch (const EvStop &e) { if ((e.code == 2 || e.code == 6) && cnt >= 64) { stopped = true; S.ctl.stop = 0; break; } throw; }
          E.policy(R.state, k, seat, h, R.known, sg, &t); double mix = 0; for (int a = 0; a < k; a++) mix += sg[a] * v[a];
          const double d = v[choice[(size_t)h]] - mix; sd += d; sd2 += d * d; cnt++; S.ctl.samples++;
        }
        // 3) probability of reaching the node (prior deals compatible with the path's board)
        std::vector<std::vector<double>> prior((size_t)n);
        for (int p = 0; p < n; p++) { prior[(size_t)p].assign(m->hands[(size_t)p].size(), 0.0); for (size_t i = 0; i < prior[(size_t)p].size(); i++) { const Hand &h = m->hands[(size_t)p][i]; if (!((R.used >> h.a & 1) || (R.used >> h.b & 1))) prior[(size_t)p][i] = h.w; } }
        Sampler Sp; Sp.init(prior, all); Rng rRng{deriveSeed((uint32_t)P.seed, seat, 30)}; double rs = 0, rs2 = 0; long long rc = 0;
        if (Sp.feasible() && !stopped) {
          try {
            for (long long s = 0; s < reachN; s++) {
              std::copy_n(R.cards, 5, E.cards);
              if (!Sp.draw(E, rRng, R.used, R.known, 200000)) break;
              double x = 1; for (int p = 0; p < n; p++) { const double w0 = prior[(size_t)p][(size_t)E.hand[p]]; x *= w0 > 0 ? reach[(size_t)p][(size_t)E.hand[p]] / w0 : 0; }
              rs += x; rs2 += x * x; rc++;
            }
          } catch (const EvStop &e) { if ((e.code != 2 && e.code != 6) || rc < 64) throw; stopped = true; S.ctl.stop = 0; }
        }
        jb_printf(o, "{\"seat\":%d,\"available\":%s,\"mode\":\"sampledOneDecisionDeviation\",\"node\":", seat, cnt >= 2 && rc >= 2 ? "true" : "false"); nodeJson(o, *m, R);
        jb_printf(o, ",\"futureActions\":\"%s\",\"handsConsidered\":%zu,\"handsWithDeviation\":%zu,\"selectionSamplesPerHand\":%lld,\"evaluationSamples\":%lld,\"stoppedEarly\":%s", E.sampleActions ? "sampled from the policy" : "enumerated", considered, deviating, selection, cnt, stopped ? "true" : "false");
        if (cnt >= 2 && rc >= 2) {
          const double g1 = sd / cnt, se1 = std::sqrt(std::max(0.0, (sd2 - cnt * g1 * g1) / (cnt - 1)) / cnt);
          const double rp = rs / rc, rse = std::sqrt(std::max(0.0, (rs2 - rc * rp * rp) / (rc - 1)) / rc);
          const double gu = g1 * rp, seu = std::sqrt(std::pow(g1 * rse, 2) + std::pow(rp * se1, 2));
          jb_puts(o, ",\"conditionalGain\":{\"mean\":"); jnumOrNull(o, g1); jb_puts(o, ",\"stdErr\":"); jnumOrNull(o, se1); jb_puts(o, ",\"ci95\":["); jnumOrNull(o, g1 - 1.96 * se1); jb_putc(o, ','); jnumOrNull(o, g1 + 1.96 * se1); jb_puts(o, "]}");
          jb_printf(o, ",\"reachProbability\":{\"samples\":%lld,\"mean\":", rc); jnumOrNull(o, rp); jb_puts(o, ",\"stdErr\":"); jnumOrNull(o, rse); jb_puts(o, ",\"note\":\"probability that the deal and the policies reach this node, given the board cards on the path\"}");
          jb_puts(o, ",\"gain\":{\"mean\":"); jnumOrNull(o, gu); jb_puts(o, ",\"stdErr\":"); jnumOrNull(o, seu); jb_puts(o, ",\"ci95\":["); jnumOrNull(o, gu - 1.96 * seu); jb_putc(o, ','); jnumOrNull(o, gu + 1.96 * seu); jb_puts(o, "]}");
          gains.push_back(gu);
        }
        jb_printf(o, ",\"elapsedMs\":%.1f,\"fallbackLookups\":%lld,\"policyLookups\":%lld,\"distinctInformationSets\":%zu,\"distinctFallbackInformationSets\":%zu,\"distinctCountKind\":\"%s\"}", (nowSec() - ts) * 1000, E.cov.missing, E.cov.lookups, E.cov.distinct, E.cov.distinctMissing, E.cov.capped ? "lowerBound" : "exact");
      });
      jb_putc(o, ']');
    }
    if (!gains.empty()) {
      double mx = -INFINITY, mean = 0; for (double x : gains) { mx = std::max(mx, x); mean += x; } mean /= gains.size();
      jb_puts(o, ",\"summary\":{\"maxSeatGain\":"); jnumOrNull(o, mx); jb_puts(o, ",\"meanSeatGain\":"); jnumOrNull(o, mean); jb_printf(o, ",\"seatsEvaluated\":%zu,\"note\":\"Per-seat values are listed above; the mean does not replace them.\"}", gains.size());
    }
    if (method == "exact" && S.ctl.boardEvals.load() > S.ctl.maxBoards) throw EvStop{6, SITE_BR};   // 4.1: exact gains are never published past the budget
    showdownJson(o, S); deadlineJson(o, S, P.timeMs); workJson(o, S, P.maxVisits, P.samples, P.timeMs, P.memoryMiB);
    jb_printf(o, ",\"elapsedMs\":%.1f}", (nowSec() - t0) * 1000);
    if (body.failed) throw std::bad_alloc();
    jb_putn(out, body.s, body.n);
    return 200;
  } catch (const QueryError &e) { fail(err, errlen, e.message.c_str()); return e.status; }
  catch (const EvStop &e) {
    char msg[300];
    if (e.code == 1) { std::snprintf(msg, sizeof msg, "Calculation cancelled (during %s); no result is reported", siteName(e.site)); fail(err, errlen, msg); return 409; }
    if (e.code == 6) { std::snprintf(msg, sizeof msg, "Board-evaluation budget (maxBoardEvaluations) exhausted during %s before the evaluation completed; an incomplete exact result is never reported", siteName(e.site)); fail(err, errlen, msg); return 422; }
    std::snprintf(msg, sizeof msg, "Time limit reached (during %s) before the evaluation completed", siteName(e.site)); fail(err, errlen, msg); return 408;
  }
  catch (const EvUnavailable &e) { fail(err, errlen, ("Unavailable: " + e.why + " (missing:\"refuse\")").c_str()); return 422; }
  catch (const EvBudget &) { fail(err, errlen, "Evaluation exceeds maxVisits"); return 422; }
  catch (const EvMemory &) { fail(err, errlen, "Evaluation memory budget exceeded"); return 503; }
  catch (const std::bad_alloc &) { fail(err, errlen, "Out of memory"); return 503; }
}
extern "C" int mw_response_gain(MW *m, const char *json, size_t len, JB *out, char *err, int errlen, volatile int *cancel) { return responseGainImpl(m, json, len, out, err, errlen, cancel, nullptr); }
