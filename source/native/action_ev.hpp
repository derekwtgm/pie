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
};
// Distinct information sets are counted in a fixed open-addressing table
// (32,768 slots, filled to at most 50%) instead of std::unordered_set: the
// 3.9-to-4.0 benchmark showed the node-based set costing 10-15% of sampled
// evaluation time. Beyond 16,384 distinct keys the counts are lower bounds
// ("distinctCountCapped").
struct Coverage {
  static constexpr size_t SLOTS = 32768, LIMIT = SLOTS / 2;
  long long lookups = 0, stored = 0, missing = 0; bool capped = false; size_t distinct = 0, distinctMissing = 0;
  std::vector<uint64_t> slot; std::vector<uint8_t> miss;
  static uint64_t mix(uint64_t x) { x ^= x >> 33; x *= 0xff51afd7ed558ccdULL; x ^= x >> 33; x *= 0xc4ceb9fe1a85ec53ULL; return x ^ (x >> 33); }
  // returns the slot of key (inserting it), or SIZE_MAX when the table is full
  size_t place(uint64_t key) {
    if (slot.empty()) { slot.assign(SLOTS, 0); miss.assign(SLOTS, 0); }
    const uint64_t k = key | 1;   // 0 marks an empty slot
    for (size_t i = mix(key) & (SLOTS - 1);; i = (i + 1) & (SLOTS - 1)) {
      if (slot[i] == k) return i;
      if (!slot[i]) { if (distinct >= LIMIT) { capped = true; return SIZE_MAX; } slot[i] = k; distinct++; return i; }
    }
  }
  void note(uint64_t key, bool ok) {
    lookups++; (ok ? stored : missing)++;
    const size_t i = place(key); if (i != SIZE_MAX && !ok && !miss[i]) { miss[i] = 1; distinctMissing++; }
  }
  void merge(const Coverage &o) {
    lookups += o.lookups; stored += o.stored; missing += o.missing; capped |= o.capped;
    for (size_t i = 0; i < o.slot.size(); i++) if (o.slot[i]) { const size_t j = place(o.slot[i]); if (j != SIZE_MAX && o.miss[i] && !miss[j]) { miss[j] = 1; distinctMissing++; } }
  }
};

struct Evaluator {
  const MW &m; const Game &g; Pol pol; bool refuseMissing; int actor; EvShared *sh;
  Tournament::Workspace icm; bool tour; LPot pots[24];
  int hand[8] = {}; int cards[5] = {}; uint64_t used = 0;
  long long visits = 0; bool exact = true, sampleActions = false;
  Rng rng{1}; double fbMass = 0, totMass = 0;
  Poller poller; Coverage cov;
  // restricted best response: pure actions of devSeat at (state, hand)
  const std::unordered_map<uint64_t, int> *dev = nullptr; int devSeat = -1;
  struct Key { int hand; uint32_t code; bool ok; };
  std::unordered_map<uint64_t, Key> memo; size_t memoCap = 4000000;
  std::array<std::unique_ptr<ShowTable>, 3> tables; long long tableStamp = 0;
  Evaluator(const MW &mm, const Game &gg, Pol p, bool refuse, int seat, EvShared *shared) : m(mm), g(gg), pol(p), refuseMissing(refuse), actor(seat), sh(shared), tour(!mm.tournament.start.empty() && !shared->forceChip) {
    poller.ctl = &sh->ctl; poller.fault = sh->ctl.faultSite;
    if (tour) m.tournament.prepare(icm, std::min(m.budgetBytes, 64.0 * 1048576));
    memoCap = (size_t)std::clamp<long long>(sh->memoryBudget / 16 / 96, 4096, 262144);
  }
  ~Evaluator() { poller.flushWork(); for (auto &t : tables) if (t) sh->ctl.release(t->charged); }
  inline void poll(int site) { poller(site, visits); }
  static uint64_t devKey(int state, int h) { return ((uint64_t)(uint32_t)state << 16) | (uint64_t)(uint32_t)h; }
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
    if (memo.size() > memoCap) memo.clear();
    memo.emplace(mk, k); return k;
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
    cov.note(state >= 0 && kk.ok ? rowKey((uint32_t)state, kk.hand, kk.code) ^ ((uint64_t)seat << 62) : (0xFFFFFFFFULL << 32) ^ ((uint64_t)seat << 62) ^ ((uint64_t)idx << 20) ^ (uint64_t)(uint32_t)state, ok);
    if (ok) return true;
    if (refuseMissing) throw EvUnavailable{"seat " + std::to_string(seat) + " has no stored " + std::string(pol == Pol::Average ? "average" : "current") + " strategy at betting state " + std::to_string(state) + " for one of the evaluated hands"};
    fallbackPolicy(t, k, p);
    return false;
  }
  static bool contested(const LPot *pots, int np) { for (int q = 0; q < np; q++) if (std::popcount(pots[q].mask) >= 2) return true; return false; }
  // Utility of the actor at a terminal given every contesting seat's score.
  double utilityWithScores(const BS &t, int np, const int *score) {
    const int n = m.n; double util[8];
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
  double scored(const BS &t, int np) {
    int score[8];
    for (int p = 0; p < m.n; p++) { const Hand &h = m.hands[(size_t)p][(size_t)hand[p]]; score[p] = evalSeven(cards, h.a, h.b); }
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
  // ---- showdown tables ----
  void cpuScores(ShowTable &T, unsigned long long first, unsigned long long end) {
    const int need = 5 - T.len; int x[5]; int b[5]; std::copy_n(T.prefix, T.len, b);
    unrankColex(first, need, T.deckCount, x);
    for (unsigned long long i = first; i < end; i++) {
      for (int r = 0; r < need; r++) b[T.len + r] = T.deck[x[r]];
      int32_t *row = T.scores.data() + (size_t)(i * (unsigned long long)T.n);
      for (int p = 0; p < T.n; p++) row[p] = evalSeven(b, T.holes[2 * p], T.holes[2 * p + 1]);
      poll(SITE_TABLE);   // table work is reported as boards, not visits (each worker may build its own table)
      if (i + 1 < end) nextColex(x, need, T.deckCount);
    }
  }
  bool gpuScores(ShowTable &T, unsigned long long first, unsigned long long end, bool waitForLock, bool hybrid) {
    EvGpu &G = EvGpu::get();
    std::unique_lock<std::mutex> lock(G.mu, std::defer_lock);
    if (waitForLock) lock.lock(); else if (!lock.try_lock()) return false;
    if (!G.open()) { sh->show.note("CUDA unavailable: " + G.reason); return false; }
    std::vector<unsigned char> spec; spec.push_back((unsigned char)T.n); spec.push_back((unsigned char)T.len); spec.push_back((unsigned char)T.deckCount);
    for (int i = 0; i < 2 * T.n; i++) spec.push_back((unsigned char)T.holes[i]);
    for (int i = 0; i < T.len; i++) spec.push_back((unsigned char)T.prefix[i]);
    for (int i = 0; i < T.deckCount; i++) spec.push_back((unsigned char)T.deck[i]);
    std::vector<unsigned long long> binom(53 * 6); for (int x = 0; x <= 52; x++) for (int r = 0; r <= 5; r++) binom[(size_t)x * 6 + r] = binom64(x, r);
    // Chunks bound VRAM use and give cancellation points between kernels.
    const unsigned long long chunk = std::max<unsigned long long>(4096, std::min<unsigned long long>(1ULL << 20, sh->gpuBudget / 2 / (4ULL * (unsigned long long)T.n)));
    unsigned long long cpuFrom = end;
    if (hybrid) {   // GPU takes the first share, the CPU the rest concurrently
      const double share = G.gpuNsPerEval > 0 && G.cpuNsPerEval > 0 ? (1 / G.gpuNsPerEval) / (1 / G.gpuNsPerEval + 1 / G.cpuNsPerEval) : 0.5;
      cpuFrom = first + (unsigned long long)std::clamp(share * (double)(end - first), 1.0, (double)(end - first - 1));
      if (cpuFrom - first > chunk) cpuFrom = first + chunk;
    }
    for (unsigned long long a = first; a < cpuFrom; a += chunk) {
      const unsigned long long b = std::min(cpuFrom, a + chunk);
      poller.now(SITE_GPU, visits);
      if (!G.dev.boardsBegin(spec, binom, a, b, T.n, sh->gpuBudget)) { sh->show.gpuFailures++; G.disable("CUDA allocation, VRAM reserve or launch failed during an EV table"); sh->show.note(G.reason); return false; }
      if (hybrid) cpuScores(T, cpuFrom, end);
      if (!G.dev.boardsFinish(T.scores.data() + (size_t)(a * (unsigned long long)T.n))) { sh->show.gpuFailures++; G.disable("CUDA download failed during an EV table"); sh->show.note(G.reason); return false; }
      sh->show.gpuBoards += (long long)(b - a);
      const long long peak = (long long)G.dev.allocated(); long long cur = sh->show.gpuPeakBytes.load(); while (peak > cur && !sh->show.gpuPeakBytes.compare_exchange_weak(cur, peak)) {}
    }
    if (hybrid) { sh->show.hybridTables++; sh->show.cpuBoards += (long long)(end - cpuFrom); } else sh->show.gpuTables++;
    return true;
  }
  // Verifies the device against the CPU on the first boards of a table (exact
  // integer equality) and measures both; returns the number of boards of T
  // already scored (0 if the device is unusable).
  unsigned long long verifyGpu(ShowTable &T) {
    EvGpu &G = EvGpu::get();
    { std::lock_guard<std::mutex> lk(G.mu); if (!G.open()) { sh->show.note("CUDA unavailable: " + G.reason); return 0; } if (G.verified) return 0; }
    const unsigned long long prefix = std::min<unsigned long long>(T.boards, 65536);
    const double t0 = nowSec(); cpuScores(T, 0, prefix); const double cpu = nowSec() - t0;
    std::vector<int32_t> ref(T.scores.begin(), T.scores.begin() + (long)(prefix * (unsigned long long)T.n));
    const double t1 = nowSec(); const bool ok = gpuScores(T, 0, prefix, true, false); const double gpu = nowSec() - t1;
    if (ok) { sh->show.gpuTables--; sh->show.verificationBoards += (long long)prefix; }   // 4.1: verification is not a scheduling decision
    std::lock_guard<std::mutex> lk(G.mu);
    if (!ok) return 0;
    if (!std::equal(ref.begin(), ref.end(), T.scores.begin())) { G.disable("CUDA showdown scores differed from the CPU reference; GPU disabled for EV tables"); sh->show.note(G.reason); std::copy(ref.begin(), ref.end(), T.scores.begin()); sh->show.gpuBoards -= (long long)prefix; return prefix; }
    G.verified = true; const double evals = (double)prefix * T.n; G.cpuNsPerEval = cpu * 1e9 / evals; G.gpuNsPerEval = gpu * 1e9 / evals;
    return prefix;
  }
  ShowTable *table(int len) {
    int holes[16]; for (int p = 0; p < m.n; p++) { const Hand &h = m.hands[(size_t)p][(size_t)hand[p]]; holes[2 * p] = h.a; holes[2 * p + 1] = h.b; }
    for (auto &t : tables) if (t && t->matches(used, len, cards, holes, m.n)) { t->stamp = ++tableStamp; sh->show.reused++; return t.get(); }
    int deckCount = 0; int deck[52]; for (int x = 0; x < 52; x++) if (!(used >> x & 1)) deck[deckCount++] = x;
    const unsigned long long boards = binom64(deckCount, 5 - len); const long long bytes = (long long)(boards * (unsigned long long)m.n * 4);
    // evict the least recently used table first
    size_t slot = 0; for (size_t i = 0; i < tables.size(); i++) { if (!tables[i]) { slot = i; break; } if (tables[i]->stamp < tables[slot]->stamp) slot = i; }
    if (tables[slot]) { sh->ctl.release(tables[slot]->charged); tables[slot].reset(); }
    // 4.1: a new table is charged to maxBoardEvaluations in full before any board is scored.
    if (!sh->ctl.chargeBoards((long long)boards)) { sh->ctl.raise(6, SITE_TABLE); sh->ctl.rethrowStop(); }
    if (!sh->ctl.tryCharge(bytes, sh->memoryBudget)) return nullptr;
    std::unique_ptr<ShowTable> T;
    try { T = std::make_unique<ShowTable>(); T->scores.resize((size_t)boards * (size_t)m.n); } catch (const std::bad_alloc &) { sh->ctl.release(bytes); return nullptr; }
    T->used = used; T->len = len; T->n = m.n; std::copy_n(cards, len, T->prefix); std::copy_n(holes, 2 * m.n, T->holes); T->boards = boards;
    std::copy_n(deck, deckCount, T->deck); T->deckCount = deckCount; T->stamp = ++tableStamp;
    T->charged = bytes;
    // Scheduling: small tables always use the CPU (transfers and launches cost
    // more than they save); "auto" uses CUDA only for large tables and only
    // after the device has been verified against the CPU and measured at least
    // 10% faster; "gpu" uses it whenever it works; "hybrid" splits a table
    // between the GPU and this CPU thread in proportion to measured speed.
    // Any device failure falls back to the CPU for the unscored boards.
    const double evals = (double)boards * m.n; Device d = sh->device; unsigned long long from = 0;
    ShowdownStats &st = sh->show;
    if (d == Device::Cpu) st.cpuForced++;
    else if (boards < 2 || (d == Device::Auto && evals < 262144)) st.cpuSmall++;   // launch and transfer overhead dominate small tables
    else {
      EvGpu &G = EvGpu::get(); bool verified; { std::lock_guard<std::mutex> lk(G.mu); verified = G.verified; }
      if (!verified) from = verifyGpu(*T);
      double gns, cns; { std::lock_guard<std::mutex> lk(G.mu); verified = G.verified; gns = G.gpuNsPerEval; cns = G.cpuNsPerEval; }
      if (!verified) st.cpuUnavailable++;
      else if (from < boards) {
        bool ok = false; const long long failures = st.gpuFailures.load();
        if (d == Device::Gpu) ok = gpuScores(*T, from, boards, true, false);
        else if (d == Device::Hybrid) ok = boards - from >= 2 && gpuScores(*T, from, boards, false, true);
        else if (gns < 0.9 * cns) ok = gpuScores(*T, from, boards, false, false);
        else st.cpuSlower++;   // measured end to end (upload, kernel, download) on the verification table
        if (!ok && (d != Device::Auto || gns < 0.9 * cns)) (st.gpuFailures.load() > failures ? st.cpuAfterFailure : st.cpuBusy)++;
        if (ok) from = boards;
      }
    }
    if (from < boards) { cpuScores(*T, from, boards); sh->show.cpuBoards += (long long)(boards - from); }
    sh->show.tables++; sh->show.boards += (long long)boards; sh->ctl.tables++; sh->ctl.boards += (long long)boards;
    tables[slot] = std::move(T); return tables[slot].get();
  }
  const std::vector<std::pair<uint32_t, uint32_t>> &patterns(ShowTable &T, uint32_t mask) {
    for (auto &h : T.hist) if (h.mask == mask) return h.patterns;
    int seats[8], c = 0; for (uint32_t x = mask; x; x &= x - 1) seats[c++] = std::countr_zero(x);
    std::unordered_map<uint32_t, uint32_t> count; count.reserve(256);
    for (unsigned long long b = 0; b < T.boards; b++) { count[rankPattern(T.scores.data() + (size_t)(b * (unsigned long long)T.n), seats, c)]++; poll(SITE_PATTERN); }
    ShowTable::Hist H; H.mask = mask; H.patterns.assign(count.begin(), count.end()); std::sort(H.patterns.begin(), H.patterns.end());
    const long long bytes = (long long)(H.patterns.size() * 8 + 64); T.charged += bytes; sh->ctl.charge(bytes);
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
  Coverage coverage() const { Coverage c; for (auto &e : ev) if (e) c.merge(e->cov); return c; }
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
  long long samples = 20000, seed = 1, maxVisits = 20000000, timeMs = 60000, enumerateCap = 4096, minSamples = 100, threads = 0, memoryMiB = 512, gpuMiB = 512;
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
  P.gpuMiB = F.optInt("gpuMiB", 16, 6144, 512);
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
  jb_puts(out, ",\"ev\":"); jarr(out, r.ev, k);
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
inline void showdownJson(JB *o, EvShared &S) {
  ShowdownStats &s = S.show;
  jb_printf(o, ",\"execution\":{\"device\":\"%s\",\"showdownTables\":%lld,\"tablesReused\":%lld,\"boardsScored\":%lld,\"cpuBoards\":%lld,\"gpuBoards\":%lld,\"gpuTables\":%lld,\"hybridTables\":%lld,\"patternSets\":%lld,\"perBoardTerminals\":%lld,\"gpuFailures\":%lld",
            deviceName(S.device), s.tables.load(), s.reused.load(), s.boards.load(), s.cpuBoards.load(), s.gpuBoards.load(), s.gpuTables.load(), s.hybridTables.load(), s.patternSets.load(), s.directTerminals.load(), s.gpuFailures.load());
  jb_printf(o, ",\"peakEvaluationMiB\":%.3f,\"gpuPeakMiB\":%.3f", S.ctl.peakMemoryBytes.load() / 1048576.0, s.gpuPeakBytes.load() / 1048576.0);
  jb_printf(o, ",\"scheduling\":{\"cpuForced\":%lld,\"cpuSmallTable\":%lld,\"cpuGpuSlower\":%lld,\"cpuGpuUnavailable\":%lld,\"cpuGpuBusy\":%lld,\"cpuAfterGpuFailure\":%lld,\"gpuVerificationBoards\":%lld,\"rule\":\"auto: GPU only for tables of at least 262,144 seat-board evaluations, after the device matched the CPU bit for bit on 65,536 boards and was measured at least 10%% faster end to end (upload, kernel, download); a busy device leaves the table to the CPU. gpu: always when it works. hybrid: split by measured speed.\"}",
            s.cpuForced.load(), s.cpuSmall.load(), s.cpuSlower.load(), s.cpuUnavailable.load(), s.cpuBusy.load(), s.cpuAfterFailure.load(), s.verificationBoards.load());
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
  jb_printf(o, ",\"deadline\":{\"timeLimitMs\":%lld,\"clock\":\"steady (monotonic)\",\"checks\":%lld,\"maxCheckGapMs\":%.3f}", timeMs, S.ctl.checks.load(), S.ctl.maxGapNs.load() / 1e6);
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
                         "minSamples", "threads", "memoryMiB", "gpuMiB", "device", "equivalenceMargin", "fallback", "fallbackWarnShare", "fallbackSevereShare", "fallbackSensitivity", "utility", "maxBoardEvaluations"});
    const std::string utility = F.choice("utility", {"study", "chip", "icm"}, "study");
    if (utility == "icm" && m->tournament.start.empty()) throw QueryError{400, "utility icm needs a study with a tournament payout table"};
    S.forceChip = utility == "chip" && !m->tournament.start.empty();
    const std::vector<int> path = F.intArray("path", 0, 7, MAX_DEPTH), dealt = F.intArray("board", 0, 51, 5);
    std::vector<int> hands = F.intArray("hands", 0, 1325, 64);
    bool range = false; if (const JV *v = F.get("range")) { if (v->type != J_BOOL) throw QueryError{400, "range must be true or false"}; range = v->num != 0; }
    const EvParams P = evParams(F, 60000);
    S.ctl.setDeadline(P.timeMs); S.device = P.device; S.gpuBudget = (size_t)P.gpuMiB << 20; S.memoryBudget = P.memoryMiB << 20; S.fallback = P.fallback; S.ctl.maxBoards = P.maxBoards;
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
    std::vector<HandResult> results; HandResult agg; agg.index = -1; bool stopped = false, boardBudgetHit = false; std::string fellBack;
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
      S.ctl.unitsTotal += blocks; S.ctl.stage = SITE_SAMPLE;
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
            sampleValues(X, R, v, fbs);
            X.policy(R.state, k, actor, X.hand[actor], R.known, sg, &t); part[b].add(v, sg, fbs); S.ctl.samples++;
          }
          vis[b] = X.visits - v0; S.ctl.unitsDone++;
        });
      } catch (const EvStop &e) { if (e.code != 2 && e.code != 6) throw; timeUp = true; if (e.code == 6) boardBudgetHit = true; }
      Moments M; M.k = k; bool anyRare = false; long long visits = 0;
      for (long long b = 0; b < blocks; b++) { M.merge(part[(size_t)b]); anyRare |= rare[(size_t)b]; visits += vis[(size_t)b]; }
      if (timeUp) { stopped = true; r.partial = true; S.ctl.stop = 0; }
      if (!M.n) { r.unreachable = true; r.note = anyRare ? "Compatible holdings are too rare to sample at this node" : "No sample was completed within the time limit"; return; }
      if (timeUp && M.n < P.minSamples) { r.unreachable = true; r.note = "Only " + std::to_string(M.n) + " samples were completed within the time limit (minSamples " + std::to_string(P.minSamples) + "); no estimate is reported"; return; }
      if (M.n < 2) { r.unreachable = true; r.note = "Too few samples were completed"; return; }
      r.visits = visits; fromMoments(r, M, k); finishResult(r, k, P.margin, P.minSamples);
      if (anyRare) r.note = "Rejection sampling gave up in some blocks (compatible holdings are rare); fewer samples than requested";
    };
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
    const Coverage cov = pool.coverage();
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
    jb_printf(o, ",\"coverage\":{\"fallbackPolicy\":\"%s\",\"fallbackDescription\":\"%s\",\"policyLookups\":%lld,\"storedLookups\":%lld,\"fallbackLookups\":%lld,\"distinctInformationSets\":%zu,\"distinctFallbackInformationSets\":%zu,\"distinctCountCapped\":%s",
              fallbackName(P.fallback), fallbackText(P.fallback), cov.lookups, cov.stored, cov.missing, cov.distinct, cov.distinctMissing, cov.capped ? "true" : "false");
    jb_puts(o, ",\"rowCoverage\":"); jnumOrNull(o, cov.lookups ? (double)cov.stored / (double)cov.lookups : 1.0);
    jb_puts(o, ",\"maxActionFallbackShare\":"); jnumOrNull(o, maxFb); jb_puts(o, ",\"maxOpponentReachFallbackShare\":"); jnumOrNull(o, maxReachFb);
    jb_puts(o, ",\"opponentReachFallbackShare\":["); for (int p = 0; p < n; p++) { if (p) jb_putc(o, ','); jnumOrNull(o, reachAllW[(size_t)p] > 0 ? reachFbW[(size_t)p] / reachAllW[(size_t)p] : 0); } jb_putc(o, ']');
    if (!useExact) { jb_printf(o, ",\"samplesEvaluated\":%lld,\"samplesWithFallback\":%lld,\"sampleFallbackShare\":", sampledN, affected); jnumOrNull(o, sampledN ? (double)affected / (double)sampledN : 0); }
    jb_printf(o, ",\"warnShare\":%.6g,\"severeShare\":%.6g,\"influence\":\"%s\",\"warning\":", P.warnShare, P.severeShare, level);
    if (!std::strcmp(level, "substantial") || !std::strcmp(level, "notable")) {
      char msg[512]; std::snprintf(msg, sizeof msg, "Up to %.1f%% of the probability mass of this evaluation passed through states with no stored %s strategy, where the %s fallback policy was substituted. These EVs depend on that assumption and do not represent a fully trained strategy.", 100 * influence, policyName(P.pol), fallbackName(P.fallback));
      jb_str(o, msg);
    } else jb_puts(o, "null");
    jb_puts(o, ",\"note\":\"rowCoverage counts policy lookups; the shares are probability-weighted (fallback share of each action's terminal probability mass, and posterior weight of opponent hands whose path reach used the fallback).\"}");
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
                         "selection", "maxNodes", "memoryMiB", "device", "fallback", "maxBoardEvaluations", "threads"});
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
    P.maxBoards = F.optInt("maxBoardEvaluations", 1000, 1000000000000000LL, LLONG_MAX);
    P.threads = F.optInt("threads", 1, 64, 0);   // 4.1: per-seat parallel response evaluation
    const long long selection = F.optInt("selectionSamples", 16, 100000, 200), reachN = F.optInt("reachSamples", 64, 2000000, 20000), maxNodes = F.optInt("maxNodes", 1, 4096, 256);
    const std::string selMode = F.choice("selection", {"auto", "exact", "sampled"}, "auto");
    if (method != "restricted" && (F.has("selection") || F.has("maxNodes"))) throw QueryError{400, "selection and maxNodes apply to method restricted"};
    if (const JV *v = F.get("studyId")) { if (v->type != J_STR) throw QueryError{400, "studyId must be a string"}; if (m->studyId.empty() || m->studyId != v->str) throw QueryError{409, "studyId does not match the open study"}; }
    S.ctl.setDeadline(P.timeMs); S.device = P.device; S.memoryBudget = P.memoryMiB << 20; S.fallback = P.fallback; S.ctl.maxVisits = method == "sampled" ? LLONG_MAX : P.maxVisits; S.ctl.maxBoards = P.maxBoards;
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
        K.device = S.device; K.gpuBudget = S.gpuBudget; K.memoryBudget = S.memoryBudget; K.fallback = S.fallback; K.forceChip = S.forceChip;
      }
      auto merge = [&](EvShared &K) {
        EvControl &c = S.ctl, &d = K.ctl;
        c.visits += d.visits.load(); c.samples += d.samples.load(); c.unitsDone += d.unitsDone.load() + 1; c.tables += d.tables.load(); c.boards += d.boards.load(); c.checks += d.checks.load();
        c.maxGapNs.store(std::max(c.maxGapNs.load(), d.maxGapNs.load()));
        for (int st = 0; st < SITE_COUNT; st++) c.work[st] += d.work[st].load();
        ShowdownStats &a = S.show, &b = K.show;
        a.tables += b.tables.load(); a.boards += b.boards.load(); a.cpuBoards += b.cpuBoards.load(); a.gpuBoards += b.gpuBoards.load(); a.gpuTables += b.gpuTables.load(); a.hybridTables += b.hybridTables.load();
        a.patternSets += b.patternSets.load(); a.directTerminals += b.directTerminals.load(); a.gpuFailures += b.gpuFailures.load(); a.reused += b.reused.load();
        a.cpuForced += b.cpuForced.load(); a.cpuSmall += b.cpuSmall.load(); a.cpuSlower += b.cpuSlower.load(); a.cpuUnavailable += b.cpuUnavailable.load(); a.cpuBusy += b.cpuBusy.load(); a.cpuAfterFailure += b.cpuAfterFailure.load(); a.verificationBoards += b.verificationBoards.load();
        a.gpuPeakBytes.store(std::max(a.gpuPeakBytes.load(), b.gpuPeakBytes.load()));
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
        jb_puts(o, ",\"gain\":"); jnumOrNull(o, gain); jb_printf(o, ",\"stdErr\":0,\"visits\":%lld,\"elapsedMs\":%.1f,\"fallbackLookups\":%lld,\"policyLookups\":%lld}", E.visits, (nowSec() - ts) * 1000, E.cov.missing, E.cov.lookups);
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
        jb_printf(o, ",\"elapsedMs\":%.1f,\"fallbackLookups\":%lld,\"policyLookups\":%lld}", (nowSec() - ts) * 1000, E.cov.missing, E.cov.lookups);
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
        jb_printf(o, ",\"elapsedMs\":%.1f,\"fallbackLookups\":%lld,\"policyLookups\":%lld}", (nowSec() - ts) * 1000, E.cov.missing, E.cov.lookups);
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
