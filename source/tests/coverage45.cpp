// EightMax 4.5: strict memory budget of the concurrent coverage set
// (native/coverage.hpp: Budget, SharedCoverage, WorkerFilter).
//
// The 4.4 header is compiled next to the 4.5 one (tests/fixtures/
// coverage44_reference.hpp, namespace emcov44, otherwise unmodified) so that the
// audit's scenario is reproduced against the code that had the defect:
//   coverage allowance 1 MiB (1,048,576 bytes), 32,768 distinct information sets
//   4.4: 1,425,408 bytes live (three tiers + sketches), +35.9 %
//   4.5: every budgeted byte (tiers incl. retired, descriptors, sketches, the
//        object with its lock cells, worker filters) stays <= 1,048,576, and the
//        count is still exact.
//
// Every "within budget" check reads the ledger's PEAK (the maximum of live bytes
// over the whole run, updated by the same compare-and-swap that grants a
// reservation), not a value sampled afterwards. In addition every tier
// allocation is cross-checked from outside the code under test: the test
// recomputes the bytes from the tier list and compares them with the ledger.
//
// usage: coverage45 [quick]     (quick: smaller sets, for sanitizer builds)
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <random>
#include <string>
#include <thread>
#include <vector>
#include "coverage.hpp"
#include "fixtures/coverage44_reference.hpp"
using emcov::Budget; using emcov::Coverage; using emcov::Key; using emcov::SharedCoverage; using emcov::WorkerFilter;
static int failures = 0; static std::string out;
static void check(const std::string &name, bool ok, const std::string &detail = "") {
  if (!ok) failures++;
  out += std::string(out.empty() ? "" : ",") + "{\"check\":\"" + name + "\",\"passed\":" + (ok ? "true" : "false") + (detail.empty() ? "" : "," + detail) + "}";
}
static std::string kv(const char *k, size_t v) { return std::string("\"") + k + "\":" + std::to_string(v); }
struct Obs { Key k; bool ok; };
using RefMap = std::map<std::pair<uint64_t, uint64_t>, uint8_t>;
struct Ref { RefMap m; size_t distinct = 0, stored = 0, fallback = 0; };
static Ref reference(const std::vector<Obs> &obs) {
  Ref r; for (auto &o : obs) r.m[{o.k.ns, o.k.id}] |= o.ok ? Coverage::STORED : Coverage::FALLBACK;
  r.distinct = r.m.size(); for (auto &e : r.m) { r.stored += (e.second & Coverage::STORED) != 0; r.fallback += (e.second & Coverage::FALLBACK) != 0; }
  return r;
}
// Every key held is a reference key with a subset of... exactly the reference flags when `exact`.
static bool subsetOf(const SharedCoverage &s, const RefMap &m, bool exact, size_t *held = nullptr) {
  size_t n = 0; bool ok = true; std::map<std::pair<uint64_t, uint64_t>, int> seen;
  s.each([&](const Key &k, uint8_t f) {
    n++; if (++seen[{k.ns, k.id}] > 1) ok = false;   // a key held twice
    auto it = m.find({k.ns, k.id}); if (it == m.end()) { ok = false; return; }
    const uint8_t want = (uint8_t)(it->second | Coverage::USED);
    if (exact ? f != want : (f & ~want) != 0) ok = false;
  });
  if (held) *held = n;
  return ok && (!exact || n == m.size());
}
static std::vector<Obs> observations(size_t distinct, uint64_t seed) {
  std::mt19937_64 g(seed); std::vector<Obs> o; o.reserve(distinct * 2);
  for (size_t i = 0; i < distinct; i++) {
    Key k = (i % 7 == 0) ? emcov::synthKeyOf((int)(g() % 5000), (int)(i % 8), (int)(i / 7)) : emcov::rowKeyOf(g() << 8 | (i & 255) | (uint64_t)i << 40, (int)(i % 8));
    const int kind = (int)(g() % 10);
    if (kind <= 5 || kind >= 8) o.push_back({k, true});
    if (kind >= 6) o.push_back({k, false});
    if (g() % 3 == 0) o.push_back({k, kind <= 5 || kind >= 8});
  }
  std::shuffle(o.begin(), o.end(), g); return o;
}
static uint64_t collide(const Key &k) { return 0xABCDEF0000000000ULL ^ (k.id & 3); }   // four probe chains
// The evaluator's arrangement: one ledger, table allowance = budget - budget/16, filters from the rest.
struct Job {
  std::shared_ptr<Budget> ledger; std::unique_ptr<SharedCoverage> set; size_t filterEntries = 0; std::atomic<int> stop{0};
  Job(size_t budgetBytes, int workers, bool filters = true) {
    ledger = std::make_shared<Budget>(budgetBytes);
    const size_t filterBytes = filters ? budgetBytes / 16 : 0;
    set = std::make_unique<SharedCoverage>(ledger, budgetBytes - filterBytes, budgetBytes / 32);
    set->stop = &stop; filterEntries = filters ? WorkerFilter::entriesFor(filterBytes, (size_t)workers) : 0;
  }
  void fill(const std::vector<Obs> &obs, int threads, std::atomic<bool> *quit = nullptr) {
    std::vector<std::thread> pool;
    for (int w = 0; w < threads; w++) pool.emplace_back([&, w] {
      WorkerFilter f; f.configure(ledger, filterEntries);
      for (size_t i = (size_t)w; i < obs.size(); i += (size_t)threads) {
        if (quit && quit->load(std::memory_order_relaxed)) break;
        const uint8_t what = obs[i].ok ? Coverage::STORED : Coverage::FALLBACK; const uint64_t h = set->hash(obs[i].k);
        if (f.miss(obs[i].k, what, h)) set->markHashed(obs[i].k, what, h);
        if (i % 5 == 0 && i + 1 < obs.size()) { const Obs &o = obs[i + 1]; set->mark(o.k, o.ok ? Coverage::STORED : Coverage::FALLBACK); }   // the neighbour's key too
      }
    });
    for (auto &t : pool) t.join();
  }
};
static std::string mem(const Job &j) {
  return kv("budgetBytes", j.ledger->limit) + "," + kv("peakBytes", j.ledger->peak.load()) + "," + kv("liveBytes", j.ledger->live.load()) + "," + kv("tableLiveBytes", j.set->liveBytes()) + "," + kv("retiredTierBytes", j.set->retiredBytes()) +
         "," + kv("tiers", j.set->tierCount()) + "," + kv("promotions", j.set->promotions.load()) + "," + kv("exactKeyLimit", j.set->limit) + "," + kv("distinct", j.set->distinct.load()) + ",\"status\":\"" + emcov::statusName(j.set->status.load()) + "\"";
}
int main(int argc, char **argv) {
  const bool quick = argc > 1 && std::string(argv[1]) == "quick";
  const size_t MiB = size_t(1) << 20;
  // ---------------------------------------------------------------- 1. the audit's scenario
  {
    std::vector<Obs> obs; for (size_t i = 0; i < 32768; i++) obs.push_back({emcov::rowKeyOf(0x9E3779B97F4A7C15ULL * (i + 1), (int)(i % 8)), i % 3 != 0});
    // 4.4, as its evaluator configured it: key limit = coverageMiB * 2^20 / 32.
    size_t bytes44 = 0, distinct44 = 0;
    {
      emcov44::SharedCoverage old(MiB / 32);
      for (auto &o : obs) old.mark(emcov44::Key{o.k.id, o.k.ns}, o.ok ? emcov44::Coverage::STORED : emcov44::Coverage::FALLBACK);
      bytes44 = old.bytes(); distinct44 = old.distinct.load();
    }
    check("REFERENCE 4.4 (archived header): 1 MiB allowance, 32,768 information sets -> 1,425,408 bytes live, 35.9 % above the allowance (the audited defect, reproduced)",
          bytes44 == 1425408 && distinct44 == 32768, kv("allowanceBytes", MiB) + "," + kv("allocatedBytes44", bytes44) + ",\"overPercent\":" + std::to_string(100.0 * ((double)bytes44 / (double)MiB - 1)));
    for (int threads : {1, 4, 8, 16}) for (int filters = 0; filters < 2; filters++) {
      Job j(MiB, threads, filters != 0); j.fill(obs, threads);
      const bool within = j.ledger->peak.load() <= MiB, exact = !j.set->capped.load() && j.set->distinct.load() == 32768 && j.set->status.load() == emcov::COV_OK;
      check("4.5: 1 MiB budget, 32,768 information sets, " + std::to_string(threads) + " workers" + (filters ? " with worker filters" : ", no filters") + ": peak live bytes <= 1,048,576, count exact, at least two promotions",
            within && exact && j.set->promotions.load() >= 2 && j.set->liveBytes() <= j.set->ceilingBytes(), mem(j));
    }
  }
  // ---------------------------------------------------------------- 2. budgets 1, 2, 8, 32 MiB: exact up to the limit, lower bounds beyond
  for (size_t mib : {size_t(1), size_t(2), size_t(8), size_t(32)}) {
    if (quick && mib > 2) continue;
    const size_t B = mib * MiB, keys = B / 32;
    for (int over = 0; over < 2; over++) {
      const size_t n = over ? keys + keys / 2 : keys - keys / 8;
      const std::vector<Obs> obs = observations(n, 45 + mib + (size_t)over); const Ref ref = reference(obs);
      for (int threads : {1, 8}) {
        Job j(B, threads); j.fill(obs, threads); j.set->finalize();
        const bool within = j.ledger->peak.load() <= B; size_t held = 0;
        if (!over) check(std::to_string(mib) + " MiB budget, " + std::to_string(ref.distinct) + " information sets (below the key limit), " + std::to_string(threads) + " workers: within budget, exact counts and flags",
                         within && !j.set->capped.load() && j.set->distinct.load() == ref.distinct && j.set->distinctStored.load() == ref.stored && j.set->distinctMissing.load() == ref.fallback && subsetOf(*j.set, ref.m, true), mem(j));
        else {
          const double est = j.set->estimateDistinct(), se = emcov::Hll::relativeStdError() * (double)ref.distinct;
          check(std::to_string(mib) + " MiB budget, " + std::to_string(ref.distinct) + " information sets (above the key limit " + std::to_string(keys) + "), " + std::to_string(threads) + " workers: within budget, capped, exact lower bound = limit, status keyLimitReached, estimate within 4 standard errors, no key invented or duplicated",
                within && j.set->capped.load() && j.set->distinct.load() == keys && j.set->status.load() == emcov::COV_KEY_LIMIT && j.set->distinctStored.load() <= ref.stored && j.set->distinctMissing.load() <= ref.fallback &&
                subsetOf(*j.set, ref.m, false, &held) && held == keys && std::fabs(est - (double)ref.distinct) <= 4 * se, mem(j) + ",\"estimate\":" + std::to_string(est) + "," + kv("reference", ref.distinct));
        }
      }
    }
  }
  // ---------------------------------------------------------------- 3. the plan itself: every planned tier sequence fits, for many allowances
  {
    bool ok = true; size_t worst = 0, checked = 0; std::mt19937_64 g(5);
    for (int i = 0; i < 20000 && ok; i++) {
      const size_t allowance = i < 64 ? (size_t)i * 4096 : (size_t)(g() % (i % 3 == 0 ? (size_t(4096) << 20) : (64 * MiB)));
      const std::vector<size_t> plan = SharedCoverage::planFor(allowance); checked++;
      if (plan.empty()) { if (allowance >= SharedCoverage::minimumBytes() + SharedCoverage::MAX_TIERS * sizeof(SharedCoverage::Table)) ok = false; continue; }
      const size_t total = SharedCoverage::fixedBytes() + SharedCoverage::planBytes(plan);
      if (total > allowance) ok = false;
      for (size_t t = 1; t < plan.size(); t++) if (plan[t] < 4 * plan[t - 1]) ok = false;   // retired tiers <= 1/3 of the last
      if (allowance >= MiB) worst = std::max(worst, (size_t)(1000.0 * (1.0 - (double)(plan.back() * 16) / (double)allowance)));
    }
    check("planFor: for 20,000 allowances (0 bytes to 4 GiB) the fixed bytes plus ALL tiers of the plan (retired ones included) never exceed the allowance; from 1 MiB up at least 70 % of it is the final table", ok && worst <= 300, kv("allowancesChecked", checked) + "," + kv("worstOverheadPerMille", worst));
    check("planFor: an allowance below the minimum plans no table (nothing is allocated for it)", SharedCoverage::planFor(0).empty() && SharedCoverage::planFor(SharedCoverage::fixedBytes()).empty());
  }
  // ---------------------------------------------------------------- 4. arithmetic overflow in the ledger
  {
    Budget b(1000); const bool a = b.reserve(600), c = !b.reserve(SIZE_MAX), d = !b.reserve(SIZE_MAX - 500), e = !b.reserve(401), f = b.reserve(400);
    check("Budget: reserve() refuses without wrapping (SIZE_MAX, SIZE_MAX-500, limit+1) and grants up to exactly the limit; refusals are counted", a && c && d && e && f && b.live.load() == 1000 && b.peak.load() == 1000 && b.refusals.load() == 3);
    b.release(1000); check("Budget: release returns the ledger to zero, peak is kept", b.live.load() == 0 && b.peak.load() == 1000);
    check("pageRound saturates instead of wrapping", emcov::pageRound(SIZE_MAX) == SIZE_MAX && emcov::pageRound(SIZE_MAX - 4095) == SIZE_MAX - 4095 && emcov::pageRound(1) == 4096 && emcov::pageRound(0) == 0);
    Budget many(1 << 20); std::vector<std::thread> pool; std::atomic<size_t> granted{0};
    for (int w = 0; w < 16; w++) pool.emplace_back([&] { for (int i = 0; i < 20000; i++) if (many.reserve(4096)) { granted.fetch_add(4096); if (i % 3) { many.release(4096); granted.fetch_sub(4096); } } });
    for (auto &t : pool) t.join();
    check("Budget: 16 threads reserving and releasing concurrently never push live or peak above the limit, and the ledger equals the bytes actually granted", many.peak.load() <= many.limit && many.live.load() == granted.load() && many.live.load() <= many.limit, kv("peak", many.peak.load()) + "," + kv("refusals", many.refusals.load()));
  }
  // ---------------------------------------------------------------- 5. forced hash collisions, repeated growth
  {
    const std::vector<Obs> obs = observations(quick ? 3000 : 12000, 9); const Ref ref = reference(obs);
    Job j(MiB, 8); j.set->hash = collide; j.fill(obs, 8);
    check("forced collisions (four probe chains for every key), 8 workers, growth through every tier: within budget, exact", j.ledger->peak.load() <= MiB && !j.set->capped.load() && j.set->distinct.load() == ref.distinct && subsetOf(*j.set, ref.m, true), mem(j));
  }
  // ---------------------------------------------------------------- 6. cancellation during growth: abandoned tiers are released, nothing lost
  {
    const size_t B = quick ? 2 * MiB : 8 * MiB; const std::vector<Obs> obs = observations(B / 40, 11); const Ref ref = reference(obs);
    bool ok = true; size_t abandonedTotal = 0, worstPeak = 0;
    for (int round = 0; round < (quick ? 2 : 6); round++) {
      Job j(B, 8); std::atomic<bool> done{false};
      std::thread toggler([&] { while (!done.load()) { j.stop.store(1); std::this_thread::sleep_for(std::chrono::microseconds(150 + 40 * round)); j.stop.store(0); std::this_thread::sleep_for(std::chrono::microseconds(120)); } });
      j.fill(obs, 8); done.store(true); toggler.join(); j.stop.store(0);
      // one more pass with no stop pending: everything that was deferred is now inserted
      j.fill(obs, 2);
      abandonedTotal += j.set->abandoned.load(); worstPeak = std::max(worstPeak, j.ledger->peak.load());
      size_t tierSum = 0; for (size_t i = 0; i < j.set->tierCount(); i++) tierSum += SharedCoverage::tierBytes(j.set->tierPlan()[i]);
      ok = ok && j.ledger->peak.load() <= B && !j.set->capped.load() && j.set->distinct.load() == ref.distinct && subsetOf(*j.set, ref.m, true) &&
           j.set->liveBytes() == SharedCoverage::fixedBytes() + tierSum;   // exactly the published tiers remain: no abandoned tier is still allocated
    }
    check("a stop raised and cleared continuously while 8 workers promote the set: peak within budget, abandoned replacement tiers released at once (ledger == fixed bytes + published tiers), exact, nothing lost or duplicated", ok, kv("budgetBytes", B) + "," + kv("worstPeakBytes", worstPeak) + "," + kv("abandonedPromotions", abandonedTotal));
    // 4.4 reference under the same pattern: abandoned tiers accumulate until destruction.
    emcov44::SharedCoverage old(B / 32); std::atomic<int> stop44{0}; old.stop = &stop44; std::atomic<bool> done{false}; size_t peak44 = 0;
    std::thread toggler([&] { while (!done.load()) { stop44.store(1); std::this_thread::sleep_for(std::chrono::microseconds(150)); stop44.store(0); std::this_thread::sleep_for(std::chrono::microseconds(120)); } });
    std::vector<std::thread> pool; for (int w = 0; w < 8; w++) pool.emplace_back([&, w] { for (size_t i = (size_t)w; i < obs.size(); i += 8) old.mark(emcov44::Key{obs[i].k.id, obs[i].k.ns}, obs[i].ok ? emcov44::Coverage::STORED : emcov44::Coverage::FALLBACK); });
    for (auto &t : pool) t.join(); done.store(true); toggler.join(); peak44 = old.bytes();
    check("REFERENCE 4.4 under the same stop pattern (informational: bytes held when the workers finished)", true, kv("allowanceBytes", B) + "," + kv("allocatedBytes44", peak44) + ",\"aboveAllowance\":" + (peak44 > B ? "true" : "false"));
  }
  // ---------------------------------------------------------------- 7. cancellation: a pending stop is not delayed by the budget code
  {
    const size_t B = quick ? 8 * MiB : 64 * MiB; const std::vector<Obs> obs = observations(B / 64, 13);
    Job j(B, 8); std::atomic<bool> quit{false}; double waited = 0;
    std::thread stopper([&] { std::this_thread::sleep_for(std::chrono::milliseconds(15)); const auto t0 = std::chrono::steady_clock::now(); j.stop.store(1); quit.store(true); (void)t0; });
    const auto t0 = std::chrono::steady_clock::now(); j.fill(obs, 8, &quit); stopper.join();
    waited = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count() - 15;
    size_t held = 0; const Ref ref = reference(obs);
    check("a stop 15 ms into an 8-worker fill of a " + std::to_string(B >> 20) + " MiB set: workers return within 60 ms of it, the set is a consistent subset, within budget", waited < 60 && j.ledger->peak.load() <= B && subsetOf(*j.set, ref.m, false, &held) && held == j.set->distinct.load(), mem(j) + ",\"msAfterStop\":" + std::to_string(waited));
  }
  // ---------------------------------------------------------------- 8. memory exhaustion: a shared ledger overdrawn by somebody else
  {
    const size_t B = 2 * MiB; const std::vector<Obs> obs = observations(40000, 17); const Ref ref = reference(obs);
    auto ledger = std::make_shared<Budget>(B);
    SharedCoverage s(ledger, B, B / 32);                      // the plan assumes the whole ledger ...
    const size_t hog = B - ledger->live.load() - 8192; const bool hogged = ledger->reserve(hog);   // ... but another consumer takes nearly all of it
    std::vector<std::thread> pool; for (int w = 0; w < 8; w++) pool.emplace_back([&, w] { for (size_t i = (size_t)w; i < obs.size(); i += 8) s.mark(obs[i].k, obs[i].ok ? Coverage::STORED : Coverage::FALLBACK); });
    for (auto &t : pool) t.join(); s.finalize();
    size_t held = 0; const bool sub = subsetOf(s, ref.m, false, &held);
    check("ledger exhausted by another consumer during growth: reservation refused BEFORE allocating, status budgetExhausted, set capped with exact lower bounds, no key invented/duplicated, never above the budget, estimate still covers all keys",
          hogged && ledger->peak.load() <= B && ledger->refusals.load() >= 1 && s.capped.load() && s.status.load() == emcov::COV_BUDGET_EXHAUSTED && sub && held == s.distinct.load() && s.distinct.load() < ref.distinct &&
          s.distinctStored.load() <= ref.stored && std::fabs(s.estimateDistinct() - (double)ref.distinct) <= 4 * emcov::Hll::relativeStdError() * (double)ref.distinct,
          kv("budgetBytes", B) + "," + kv("peakBytes", ledger->peak.load()) + "," + kv("refusals", ledger->refusals.load()) + "," + kv("lowerBound", s.distinct.load()) + "," + kv("reference", ref.distinct) + ",\"estimate\":" + std::to_string(s.estimateDistinct()));
    ledger->release(hog);
  }
  {
    // a budget too small for any table: explicit status, counts 0 (lower bound), nothing allocated beyond the object
    auto ledger = std::make_shared<Budget>(8192); SharedCoverage s(ledger, 8192, 256);
    for (uint64_t i = 0; i < 1000; i++) s.mark(emcov::rowKeyOf(i * 77 + 1, 0), Coverage::STORED);
    check("a budget below the minimum: no table, no sketch, capped from the first observation with status budgetExhausted, distinct = 0 (a true lower bound), ledger within its limit", s.capped.load() && s.distinct.load() == 0 && s.status.load() == emcov::COV_BUDGET_EXHAUSTED && ledger->peak.load() <= 8192 && s.tierCount() == 0, kv("peakBytes", ledger->peak.load()) + "," + kv("minimumBytes", SharedCoverage::minimumBytes()));
  }
  // ---------------------------------------------------------------- 9. failed allocation (fault injection)
  for (int failAt = 0; failAt < 3; failAt++) {
    const size_t B = 2 * MiB; const std::vector<Obs> obs = observations(30000, 19 + (uint64_t)failAt); const Ref ref = reference(obs);
    Job j(B, 4, false);
    // let `failAt` promotions succeed, then fail every later tier allocation
    std::vector<Obs> head(obs.begin(), obs.begin() + (failAt == 0 ? 100 : failAt == 1 ? 700 : 2500)); j.fill(head, 1);
    const size_t tiersBefore = j.set->tierCount(), liveBefore = j.set->liveBytes(); j.set->failAllocations.store(-1);
    j.fill(obs, 4); j.set->finalize(); size_t held = 0;
    check("operating-system allocation of the next tier fails after " + std::to_string(tiersBefore - 1) + " promotion(s): reservation returned (ledger unchanged), present tier stays valid and becomes the last, status allocationFailed, capped lower bounds, no corruption",
          j.set->tierCount() == tiersBefore && j.set->liveBytes() == liveBefore && j.set->status.load() == emcov::COV_ALLOCATION_FAILED && j.set->capped.load() && subsetOf(*j.set, ref.m, false, &held) && held == j.set->distinct.load() &&
          j.set->distinct.load() <= ref.distinct && j.ledger->peak.load() <= B, mem(j) + "," + kv("reference", ref.distinct));
  }
  // ---------------------------------------------------------------- 10. concurrent lock-free readers during resizing
  {
    const size_t B = quick ? 2 * MiB : 8 * MiB; const std::vector<Obs> obs = observations(B / 40, 23); const Ref ref = reference(obs);
    Job j(B, 8, false); std::atomic<bool> done{false}; std::atomic<size_t> reads{0};
    // readers re-mark keys that are already present (the lock-free fast path, possibly on a retired tier)
    std::vector<std::thread> readers; for (int r = 0; r < 4; r++) readers.emplace_back([&, r] {
      size_t n = 0; std::mt19937_64 g((uint64_t)r + 1);
      while (!done.load(std::memory_order_relaxed)) { const Obs &o = obs[g() % (obs.size() / 8)]; j.set->mark(o.k, o.ok ? Coverage::STORED : Coverage::FALLBACK); n++; }
      reads.fetch_add(n);
    });
    j.fill(obs, 4); done.store(true); for (auto &t : readers) t.join();
    check("4 readers re-observing present keys (lock-free path, tiers being retired under them) while 4 writers grow the set: exact, within budget, retired tiers still accounted", j.ledger->peak.load() <= B && !j.set->capped.load() && j.set->distinct.load() == ref.distinct && subsetOf(*j.set, ref.m, true) && j.set->retiredBytes() > 0 && j.set->liveBytes() >= j.set->retiredBytes(), mem(j) + "," + kv("readerObservations", reads.load()));
  }
  // ---------------------------------------------------------------- 11. destruction and repeated jobs
  {
    auto ledger = std::make_shared<Budget>(4 * MiB); const std::vector<Obs> obs = observations(20000, 29); bool ok = true; size_t worst = 0;
    for (int job = 0; job < (quick ? 20 : 200) && ok; job++) {
      {
        SharedCoverage s(ledger, 4 * MiB - 4 * MiB / 16, 4 * MiB / 32); std::vector<std::thread> pool;
        for (int w = 0; w < 4; w++) pool.emplace_back([&, w] { WorkerFilter f; f.configure(ledger, WorkerFilter::entriesFor(4 * MiB / 16, 4)); for (size_t i = (size_t)w; i < obs.size(); i += 4) { const uint64_t h = s.hash(obs[i].k); const uint8_t what = obs[i].ok ? Coverage::STORED : Coverage::FALLBACK; if (f.miss(obs[i].k, what, h)) s.markHashed(obs[i].k, what, h); } });
        for (auto &t : pool) t.join(); worst = std::max(worst, ledger->live.load());
      }
      ok = ledger->live.load() == 0;   // tiers, sketches, object and filters all returned
    }
    check("200 evaluation jobs on one ledger: after each job (set and filters destroyed) the ledger is exactly 0; peak never above the budget", ok && ledger->peak.load() <= ledger->limit, kv("peakBytes", ledger->peak.load()) + "," + kv("worstLiveBytes", worst));
  }
  // ---------------------------------------------------------------- 12. worker filters
  {
    check("WorkerFilter::entriesFor: power of two, <= 32,768, workers * entries * 16 <= allowance; 0 when a worker's share is below 256 entries",
          WorkerFilter::entriesFor(65536, 4) == 1024 && WorkerFilter::entriesFor(4 * MiB, 8) == 32768 && WorkerFilter::entriesFor(4 * MiB, 24) == 8192 && WorkerFilter::entriesFor(65536, 24) == 0 && WorkerFilter::entriesFor(0, 1) == 0);
    auto ledger = std::make_shared<Budget>(20000); WorkerFilter a, b; a.configure(ledger, 1024); b.configure(ledger, 1024);
    const Key k = emcov::rowKeyOf(5, 1); const uint64_t h = emcov::hashOf(k);
    const bool a1 = a.miss(k, Coverage::STORED, h), a2 = a.miss(k, Coverage::STORED, h), b1 = b.miss(k, Coverage::STORED, h), b2 = b.miss(k, Coverage::STORED, h);
    check("a WorkerFilter the ledger cannot grant is not allocated and reports every observation (correct, only slower); the granted one filters repeats", a1 && !a2 && b1 && b2 && b.bytes() == 0 && ledger->live.load() == 16384 && ledger->refusals.load() == 1);
  }
  // ---------------------------------------------------------------- 13. the 4.4 key-limit interface now has an enforced ceiling as well
  {
    const std::vector<Obs> obs = observations(quick ? 20000 : 100000, 31); const Ref ref = reference(obs);
    SharedCoverage s(ref.distinct + 10); std::atomic<int> stop{0}; s.stop = &stop; std::atomic<bool> done{false};
    std::thread toggler([&] { while (!done.load()) { stop.store(1); std::this_thread::sleep_for(std::chrono::microseconds(200)); stop.store(0); std::this_thread::sleep_for(std::chrono::microseconds(150)); } });
    std::vector<std::thread> pool; for (int w = 0; w < 8; w++) pool.emplace_back([&, w] { for (size_t i = (size_t)w; i < obs.size(); i += 8) s.mark(obs[i].k, obs[i].ok ? Coverage::STORED : Coverage::FALLBACK); });
    for (auto &t : pool) t.join(); done.store(true); toggler.join(); stop.store(0);
    for (auto &o : obs) s.mark(o.k, o.ok ? Coverage::STORED : Coverage::FALLBACK);
    check("key-limit constructor (4.4 interface): peak live bytes <= ceilingBytes() (fixed + every tier of the power-of-two sequence) even with promotions abandoned by stops; exact", s.peakBytes() <= s.ceilingBytes() && s.budget->peak.load() <= s.budget->limit && !s.capped.load() && s.distinct.load() == ref.distinct && subsetOf(s, ref.m, true),
          kv("ceilingBytes", s.ceilingBytes()) + "," + kv("peakBytes", s.peakBytes()) + "," + kv("abandonedPromotions", s.abandoned.load()));
  }
  // ---------------------------------------------------------------- 14. pooled per-worker tables (response-gain seats, EM_EV_MERGED_COVERAGE): sketches inside the pool
  {
    const long long B = 1 << 20; auto pool = std::make_shared<std::atomic<long long>>(B); long long low = B; size_t total = 0; bool anyCapped = false;
    {
      std::vector<std::unique_ptr<Coverage>> seats; for (int i = 0; i < 8; i++) { seats.push_back(std::make_unique<Coverage>()); seats.back()->pool = pool; seats.back()->limit = (size_t)(B / 32); }
      std::mt19937_64 g(3);
      for (int i = 0; i < 400000; i++) { Coverage &c = *seats[(size_t)(g() % 8)]; c.note(emcov::rowKeyOf(g() % 60000, (int)(g() % 8)), g() % 2 == 0); low = std::min(low, pool->load()); }
      for (auto &c : seats) { total += c->bytes(); anyCapped |= c->capped; }
    }
    check("8 pooled per-seat tables on a 1 MiB pool: slot AND sketch bytes are drawn from the pool, the pool never goes negative, the tables' real bytes never exceed it, capped tables are labelled, and everything is returned on destruction",
          low >= 0 && total <= (size_t)B && anyCapped && pool->load() == B, kv("poolBytes", (size_t)B) + "," + kv("allocatedBytes", total) + "," + kv("lowestPoolBalance", (size_t)low));
  }
  std::printf("{\"suite\":\"coverage45\",\"failures\":%d,\"checks\":[%s]}\n", failures, out.c_str());
  return failures ? 1 : 0;
}
