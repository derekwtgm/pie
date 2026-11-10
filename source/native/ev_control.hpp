// EightMax 4.0: shared deadline, cooperative cancellation and progress for
// action-EV and response-gain evaluations (action_ev.hpp). Included by mw.cpp.
//
// WHY (3.9 defect, reproduced): Evaluator::poll() only looked at the clock when
// `visits & 4095` was zero at entry to value(). Exhaustive runouts inside a
// terminal added ~377,000 visits at once without polling, so the bit test hit
// at random and an eight-player push/fold ICM study with a 100 ms limit ran for
// 10.2 s (validation/4.0/deadline-repro-3.9.json); at another node 3.9 ignored
// the limit entirely and returned an "exact" result after 8 s.
//
// DESIGN
//  * One EvControl per request, shared by every worker thread: the deadline on
//    std::chrono::steady_clock (monotonic: wall-clock changes cannot move it),
//    an external cancellation flag, an atomic stop code and progress counters.
//  * Every expensive loop calls poll(site) once per unit of work (board runout,
//    opponent tuple, tree node, ICM terminal, rejection try, response-tuple...).
//    poll() is a countdown; when it reaches zero it reads the clock and the
//    flags. The countdown ADAPTS to measured work per check: if the time
//    between two checks exceeded 1 ms the interval halves, if it was under
//    0.125 ms it doubles (1..65,536 units). The interval therefore tracks the
//    cost of the current loop instead of a fixed visit count, and the expected
//    gap between checks stays near 0.25-1 ms on any CPU.
//  * When any worker sees a stop condition it publishes it (first code wins);
//    every other worker throws at its next poll. Workers are always joined
//    before the request returns: no thread outlives its request.
//  * Stop codes: 1 cancelled (HTTP 409), 2 time limit (408), 3 maxVisits
//    budget (EvBudget), 4 failure in another worker (the failing worker's own
//    exception is rethrown), 5 memory budget (503), 6 board-evaluation budget
//    (4.1: maxBoardEvaluations; exact -> 422 with no numbers, sampled -> a
//    labelled partial estimate when at least minSamples samples completed).
//  * 4.1 WORK ACCOUNTING. Every poll(site) is one unit of work of that site
//    (tree node, board runout, table board, pattern count, chance card,
//    opponent tuple, reach weight, sample, rejected sampling attempt, ICM
//    terminal, best-response node/tuple, selection step, subtree-sizing node,
//    GPU batch). Pollers count per site locally and flush into `work` at each
//    clock check and when an evaluator ends, so the totals are exact counts
//    without cross-thread contention. "Board evaluations" (one board scored for
//    every seat of the hand: a scored() call, a showdown-table row or a GPU
//    board) are the unit of maxBoardEvaluations; tables are charged in full
//    BEFORE they are built, single boards at each check (overshoot at most one
//    check interval, <= 65,536 boards per worker). Units of different sites are
//    never added together: they are reported separately.
//  * EM_EV_FAULT=<site>:<n> (tests only) raises a cancellation at the n-th poll
//    of that site, so the regression suite proves that cancellation is honoured
//    inside each expensive phase.
#pragma once
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
namespace {
namespace es {
enum EvSite { SITE_TREE, SITE_RUNOUT, SITE_TABLE, SITE_PATTERN, SITE_CHANCE, SITE_OPPONENTS, SITE_REACH, SITE_SAMPLE, SITE_RETRY, SITE_ICM, SITE_BR, SITE_TUPLES, SITE_SELECTION, SITE_SUBTREE, SITE_GPU, SITE_COUNT };
inline const char *siteName(int s) {
  static const char *names[] = {"game-tree traversal", "board runout enumeration", "showdown table construction", "showdown pattern counting", "chance-card enumeration", "opponent-hand enumeration", "reach-weight computation", "sampled evaluation", "rejection-sampling retries", "ICM terminal evaluation", "best-response traversal", "best-response tuple enumeration", "deviation selection", "betting-subtree sizing", "GPU batch"};
  return s >= 0 && s < SITE_COUNT ? names[s] : "evaluation";
}
inline const char *siteKey(int s) {
  static const char *keys[] = {"tree", "runout", "table", "pattern", "chance", "opponents", "reach", "sample", "retry", "icm", "br", "tuples", "selection", "subtree", "gpu"};
  return s >= 0 && s < SITE_COUNT ? keys[s] : "unknown";
}
struct EvStop { int code; int site; };
struct EvBudget {};
struct EvMemory {};
struct EvControl {
  using Clock = std::chrono::steady_clock;
  volatile int *cancel = nullptr;
  // 4.1: `start` is atomic and restarted by setDeadline() when the evaluation
  // actually begins. 4.0 set it when the job's task was CREATED (at submission),
  // so a job that waited in the queue lost the queue time from its own
  // timeLimitMs (it could time out the moment it started) and its progress
  // elapsedMs included queue time; the desktop API reads elapsedMs from another
  // thread, hence atomic.
  std::atomic<Clock::rep> startTicks{Clock::now().time_since_epoch().count()};
  Clock::time_point deadline = Clock::time_point::max();
  Clock::time_point start() const { return Clock::time_point(Clock::duration(startTicks.load(std::memory_order_acquire))); }
  std::atomic<int> stop{0}, stopSite{-1};
  // progress (read by the desktop job API while the evaluation runs)
  std::atomic<long long> visits{0}, samples{0}, unitsDone{0}, unitsTotal{0}, tables{0}, boards{0}, gpuBoards{0};
  std::atomic<int> stage{0};             // EvSite of the current phase
  std::atomic<long long> memoryBytes{0}, peakMemoryBytes{0};
  std::atomic<long long> work[SITE_COUNT] = {};   // 4.1: units of work per site
  std::atomic<long long> boardEvals{0}; long long maxBoards = LLONG_MAX;
  // 4.1: a per-seat child control (parallel response gains) forwards memory and
  // board-budget charges to the request's control, so request budgets stay totals.
  EvControl *parent = nullptr;
  bool chargeBoards(long long n) { if (parent) return parent->chargeBoards(n); return boardEvals.fetch_add(n, std::memory_order_relaxed) + n <= maxBoards; }
  long long maxVisits = LLONG_MAX;       // budget of the current exact unit (hand)
  std::atomic<long long> unitVisits{0};
  // measured deadline behaviour
  std::atomic<long long> checks{0}, maxGapNs{0};
  bool validateOnly = false;             // jobs: check the request, do no work
  // fault injection (tests)
  int faultSite = -1; long long faultAt = 0; std::atomic<long long> faultCount{0}; int faultFlag = 0;
  EvControl() {
    if (const char *f = std::getenv("EM_EV_FAULT")) {
      const char *colon = std::strchr(f, ':'); std::string site = colon ? std::string(f, (size_t)(colon - f)) : std::string(f);
      for (int s = 0; s < SITE_COUNT; s++) if (site == siteKey(s)) faultSite = s;
      faultAt = colon ? std::atoll(colon + 1) : 1; if (faultAt < 1) faultAt = 1;
    }
  }
  void setDeadline(long long ms) { const auto now = Clock::now(); startTicks.store(now.time_since_epoch().count(), std::memory_order_release); deadline = now + std::chrono::milliseconds(ms); }
  double elapsedMs() const { return std::chrono::duration<double, std::milli>(Clock::now() - start()).count(); }
  void raise(int code, int site) { int z = 0; if (stop.compare_exchange_strong(z, code)) stopSite.store(site); }
  void charge(long long bytes) { if (parent) { parent->charge(bytes); return; } const long long now = memoryBytes.fetch_add(bytes) + bytes; long long p = peakMemoryBytes.load(); while (now > p && !peakMemoryBytes.compare_exchange_weak(p, now)) {} }
  void release(long long bytes) { if (parent) { parent->release(bytes); return; } memoryBytes.fetch_sub(bytes); }
  // Reserves `bytes` only if the total stays within `budget` (atomic: concurrent
  // workers cannot both pass the check and overshoot the budget together).
  bool tryCharge(long long bytes, long long budget) {
    if (parent) return parent->tryCharge(bytes, budget);
    long long cur = memoryBytes.load();
    do { if (cur + bytes > budget) return false; } while (!memoryBytes.compare_exchange_weak(cur, cur + bytes));
    long long p = peakMemoryBytes.load(); while (cur + bytes > p && !peakMemoryBytes.compare_exchange_weak(p, cur + bytes)) {}
    return true;
  }
  // Throws the exception that matches a published stop code.
  [[noreturn]] void rethrowStop() const {
    const int c = stop.load();
    if (c == 3) throw EvBudget{};
    if (c == 5) throw EvMemory{};
    if (c == 6) throw EvStop{6, stopSite.load()};
    throw EvStop{c, stopSite.load()};
  }
};
// Per-worker poller: cheap countdown, adaptive clock checks.
struct Poller {
  EvControl *ctl = nullptr; unsigned interval = 64, countdown = 64; EvControl::Clock::time_point last = EvControl::Clock::now(); int fault = -1;
  long long flushed = 0;   // visits already added to ctl->unitVisits
  long long local[SITE_COUNT] = {}, localFlushed[SITE_COUNT] = {}, boards = 0, boardsFlushed = 0;   // 4.1 work accounting
  void reset() { interval = countdown = 64; last = EvControl::Clock::now(); flushed = 0; }
  // (A fault-injection site is checked on every poll so tests hit it deterministically.)
  inline void operator()(int site, long long visits) { local[site]++; if (--countdown && site != fault) return; slow(site, visits); }
  // Publishes local work counts; returns false when the board budget is exceeded.
  bool flushWork() {
    if (!ctl) return true;
    for (int s = 0; s < SITE_COUNT; s++) if (local[s] != localFlushed[s]) { ctl->work[s].fetch_add(local[s] - localFlushed[s], std::memory_order_relaxed); localFlushed[s] = local[s]; }
    bool ok = true; if (boards != boardsFlushed) { ok = ctl->chargeBoards(boards - boardsFlushed); boardsFlushed = boards; }
    return ok;
  }
  void slow(int site, long long visits) {
    EvControl &c = *ctl; const auto now = EvControl::Clock::now();
    if (!flushWork()) c.raise(6, site);
    if (c.parent) { const int ps = c.parent->stop.load(std::memory_order_relaxed); if (ps) c.raise(ps, site); }   // another seat failed or the request stopped
    const long long gap = std::chrono::duration_cast<std::chrono::nanoseconds>(now - last).count(); last = now;
    if (gap > 1000000 && interval > 1) interval >>= 1; else if (gap < 125000 && interval < 65536) interval <<= 1;
    countdown = interval;
    c.checks.fetch_add(1, std::memory_order_relaxed);
    long long m = c.maxGapNs.load(std::memory_order_relaxed); while (gap > m && !c.maxGapNs.compare_exchange_weak(m, gap)) {}
    c.stage.store(site, std::memory_order_relaxed);
    if (visits > flushed) { c.visits.fetch_add(visits - flushed, std::memory_order_relaxed); if (c.unitVisits.fetch_add(visits - flushed) + (visits - flushed) > c.maxVisits) c.raise(3, site); flushed = visits; }
    if (c.faultSite == site && c.faultCount.fetch_add(1) + 1 >= c.faultAt) __atomic_store_n(&c.faultFlag, 1, __ATOMIC_RELAXED);
    if (__atomic_load_n(&c.faultFlag, __ATOMIC_RELAXED) || (c.cancel && __atomic_load_n(c.cancel, __ATOMIC_RELAXED))) c.raise(1, site);
    if (now >= c.deadline) c.raise(2, site);
    if (c.stop.load(std::memory_order_relaxed)) c.rethrowStop();
  }
  // Forces a check now (phase boundaries).
  void now(int site, long long visits) { countdown = 1; operator()(site, visits); }
};
// Runs fn(worker, item) for items [0, count) on `threads` workers (inline for
// one). The first exception is kept, the others are told to stop through the
// control, every worker is joined, then the first exception is rethrown.
template <class Fn> void parallelFor(EvControl &ctl, int threads, size_t count, Fn fn) {
  if (count == 0) return;
  threads = (int)std::min<size_t>((size_t)std::max(1, threads), count);
  if (threads == 1) { for (size_t i = 0; i < count; i++) fn(0, i); return; }
  std::atomic<size_t> next{0}; std::exception_ptr first; std::mutex mu;
  auto body = [&](int w) {
    try { for (size_t i; (i = next.fetch_add(1)) < count;) { if (ctl.stop.load(std::memory_order_relaxed)) ctl.rethrowStop(); fn(w, i); } }
    catch (...) { std::lock_guard<std::mutex> g(mu); if (!first) first = std::current_exception(); ctl.raise(4, -1); }
  };
  std::vector<std::thread> pool; pool.reserve((size_t)threads - 1);
  try { for (int w = 1; w < threads; w++) pool.emplace_back(body, w); }
  catch (...) { /* thread creation failed: continue with the workers we have */ }
  body(0);
  for (auto &t : pool) t.join();
  if (first) {
    // A worker that stopped only because another one failed rethrows that one's cause.
    std::rethrow_exception(first);
  }
}
} // namespace es
} // namespace
