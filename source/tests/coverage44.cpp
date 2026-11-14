// EightMax 4.4: the request-wide concurrent coverage set (native/coverage.hpp,
// SharedCoverage + WorkerFilter) against an independent exact reference.
//
// Reference: std::map<(ns,id), flags> filled single-threaded from the same
// observations (no hashing shared with the code under test).
//
// Checks
//   * 1, 2, 4, 8 and 16 writer threads, observations partitioned three ways
//     (round robin, contiguous blocks, by hash) and each key observed again by
//     other threads: distinct / stored / fallback counts equal the reference
//     and every key is held once with the reference flags (no lost or
//     duplicated key under concurrent insertion of the SAME key);
//   * through WorkerFilter (the evaluator's path): same result, and the filter
//     passes every first observation;
//   * forced hash collisions (every key in one bucket), 8 threads: exact;
//   * merge-order / worker-count independence: all thread counts give the same
//     set as one thread;
//   * key limit below the true count: capped, counts are exact lower bounds
//     (<= reference, == limit), never above the limit, HyperLogLog estimate
//     within 4 standard errors, with and without finalize() (the sketches are
//     back-filled by the writer that reaches the limit, not after the stop);
//   * stop in the middle (writers abandon their work at a flag, as a timeout or
//     cancellation does): the set equals the reference of exactly the
//     observations that were reported;
//   * agreement with the 4.3 Coverage table merged from per-worker tables;
//   * tiers: an empty set holds 64 KiB whatever the key limit, promotions under
//     16 writers lose and duplicate nothing, memory stays within 4/3 of the
//     current tier.
// usage: coverage44 [distinctKeys]   (default 300000). Build with -fsanitize=thread for the race check.
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <random>
#include <string>
#include <thread>
#include <vector>
#include "coverage.hpp"
using emcov::Coverage; using emcov::Key; using emcov::SharedCoverage; using emcov::WorkerFilter;
static int failures = 0; static std::string out;
static void check(const std::string &name, bool ok, const std::string &detail = "") {
  if (!ok) failures++;
  out += std::string(out.empty() ? "" : ",") + "{\"check\":\"" + name + "\",\"passed\":" + (ok ? "true" : "false") + (detail.empty() ? "" : "," + detail) + "}";
}
struct Obs { Key k; bool ok; };
using RefMap = std::map<std::pair<uint64_t, uint64_t>, uint8_t>;
struct Ref { RefMap m; size_t distinct = 0, stored = 0, fallback = 0; };
static Ref reference(const std::vector<Obs> &obs, size_t count = SIZE_MAX) {
  Ref r; size_t i = 0;
  for (auto &o : obs) { if (i++ >= count) break; r.m[{o.k.ns, o.k.id}] |= o.ok ? Coverage::STORED : Coverage::FALLBACK; }
  r.distinct = r.m.size(); for (auto &kv : r.m) { r.stored += (kv.second & Coverage::STORED) != 0; r.fallback += (kv.second & Coverage::FALLBACK) != 0; }
  return r;
}
static bool sameSet(const SharedCoverage &s, const RefMap &m) {
  size_t n = 0; bool ok = true;
  s.each([&](const Key &k, uint8_t f) { n++; auto it = m.find({k.ns, k.id}); if (it == m.end() || (uint8_t)(it->second | Coverage::USED) != f) ok = false; });
  return ok && n == m.size();
}
static std::vector<Obs> observations(size_t distinct, uint64_t seed) {
  std::mt19937_64 g(seed); std::vector<Obs> o; o.reserve(distinct * 2);
  for (size_t i = 0; i < distinct; i++) {
    Key k = (i % 7 == 0) ? emcov::synthKeyOf((int)(g() % 5000), (int)(i % 8), (int)(i / 7)) : emcov::rowKeyOf(g() << 8 | (i & 255) | (uint64_t)i << 40, (int)(i % 8));
    const int kind = (int)(g() % 10);   // 0-5 stored only, 6-7 fallback only, 8-9 both
    if (kind <= 5 || kind >= 8) o.push_back({k, true});
    if (kind >= 6) o.push_back({k, false});
    if (g() % 3 == 0) o.push_back({k, kind <= 5 || kind >= 8});   // repeated observation
  }
  std::shuffle(o.begin(), o.end(), g); return o;
}
static uint64_t collide(const Key &) { return 12345; }
// Runs `threads` writers. mode 0 round robin, 1 blocks, 2 by hash; every thread also re-reports a slice owned by its neighbour.
static void fill(SharedCoverage &s, const std::vector<Obs> &obs, int threads, int mode, bool filter, std::atomic<size_t> *reported = nullptr, std::atomic<bool> *stop = nullptr) {
  std::vector<std::thread> pool;
  for (int w = 0; w < threads; w++) pool.emplace_back([&, w] {
    WorkerFilter f; size_t mine = 0;
    auto put = [&](const Obs &o) {
      const uint8_t what = o.ok ? Coverage::STORED : Coverage::FALLBACK; const uint64_t h = s.hash(o.k);
      if (!filter || f.miss(o.k, what, h)) s.markHashed(o.k, what, h);
    };
    const size_t n = obs.size(), block = (n + (size_t)threads - 1) / (size_t)threads;
    for (size_t i = 0; i < n; i++) {
      if (stop && stop->load(std::memory_order_relaxed)) break;
      const int owner = mode == 0 ? (int)(i % (size_t)threads) : mode == 1 ? (int)(i / block) : (int)(emcov::hashOf(obs[i].k) % (uint64_t)threads);
      if (owner == w) { put(obs[i]); mine++; }
      else if (!stop && owner == (w + 1) % threads && i % 4 == 0) put(obs[i]);   // the same key from another thread
    }
    if (reported) reported->fetch_add(mine);
  });
  for (auto &t : pool) t.join();
}
int main(int argc, char **argv) {
  const size_t N = argc > 1 ? (size_t)std::atoll(argv[1]) : 300000;
  const std::vector<Obs> obs = observations(N, 44); const Ref ref = reference(obs);
  // ---- exact under concurrency ----
  for (int threads : {1, 2, 4, 8, 16}) for (int mode = 0; mode < 3; mode++) for (int filter = 0; filter < 2; filter++) {
    SharedCoverage s(N + 1000); fill(s, obs, threads, mode, filter != 0); s.finalize();
    const bool ok = !s.capped.load() && s.distinct.load() == ref.distinct && s.distinctStored.load() == ref.stored && s.distinctMissing.load() == ref.fallback && sameSet(s, ref.m);
    check("exact counts and flags, " + std::to_string(threads) + " threads, partition " + std::to_string(mode) + (filter ? ", through WorkerFilter" : ", direct"), ok,
          "\"distinct\":" + std::to_string(s.distinct.load()) + ",\"reference\":" + std::to_string(ref.distinct) + ",\"stored\":" + std::to_string(s.distinctStored.load()) + ",\"fallback\":" + std::to_string(s.distinctMissing.load()));
  }
  // ---- forced collisions ----
  {
    const std::vector<Obs> small = observations(3000, 7); const Ref r = reference(small);
    SharedCoverage s(4096); s.hash = collide; fill(s, small, 8, 0, false);
    check("every key forced into one probe chain, 8 threads", !s.capped.load() && s.distinct.load() == r.distinct && s.distinctStored.load() == r.stored && s.distinctMissing.load() == r.fallback && sameSet(s, r.m), "\"distinct\":" + std::to_string(s.distinct.load()));
  }
  // ---- the same single key from many threads ----
  {
    SharedCoverage s(1024); const Key k = emcov::rowKeyOf(42, 3); std::vector<std::thread> pool;
    for (int w = 0; w < 16; w++) pool.emplace_back([&, w] { for (int i = 0; i < 20000; i++) s.mark(k, (w + i) % 2 ? Coverage::STORED : Coverage::FALLBACK); });
    for (auto &t : pool) t.join();
    check("one key observed 320,000 times by 16 threads is one information set, counted once per flag", s.distinct.load() == 1 && s.distinctStored.load() == 1 && s.distinctMissing.load() == 1);
  }
  // ---- key limit: capped, lower bounds, estimates ----
  for (int threads : {1, 8}) {
    const size_t limit = N / 4; SharedCoverage s(limit); fill(s, obs, threads, 0, true); s.finalize();
    const double est = s.estimateDistinct(), se = emcov::Hll::relativeStdError() * (double)ref.distinct;
    check("key limit " + std::to_string(limit) + " with " + std::to_string(threads) + " threads: capped, exact lower bound, never above the limit", s.capped.load() && s.distinct.load() == limit && s.distinctStored.load() <= ref.stored && s.distinctMissing.load() <= ref.fallback,
          "\"distinct\":" + std::to_string(s.distinct.load()));
    check("capped estimate within 4 standard errors (" + std::to_string(threads) + " threads)", std::fabs(est - (double)ref.distinct) <= 4 * se, "\"estimate\":" + std::to_string(est) + ",\"reference\":" + std::to_string(ref.distinct));
    size_t held = 0; bool subset = true; s.each([&](const Key &k, uint8_t) { held++; if (!ref.m.count({k.ns, k.id})) subset = false; });
    check("capped table holds only observed keys (" + std::to_string(threads) + " threads)", subset && held == limit);
  }
  // ---- the sketches are complete as soon as the writers stop: no finalize() (nothing is left to do after a deadline) ----
  {
    const size_t limit = N / 4; SharedCoverage s(limit); fill(s, obs, 8, 2, true);
    const double est = s.estimateDistinct(), se = emcov::Hll::relativeStdError() * (double)ref.distinct;
    check("capped by 8 writers, finalize() not called: the estimate is already within 4 standard errors (sketches back-filled when the limit was reached)", s.capped.load() && s.distinct.load() == limit && std::fabs(est - (double)ref.distinct) <= 4 * se,
          "\"estimate\":" + std::to_string(est) + ",\"reference\":" + std::to_string(ref.distinct));
  }
  // ---- stop in the middle (timeout / cancellation): single writer, deterministic prefix ----
  {
    for (size_t cut : {size_t(1), obs.size() / 3, obs.size() - 1}) {
      SharedCoverage s(N + 1000); WorkerFilter f;
      for (size_t i = 0; i < cut; i++) { const uint8_t what = obs[i].ok ? Coverage::STORED : Coverage::FALLBACK; const uint64_t h = s.hash(obs[i].k); if (f.miss(obs[i].k, what, h)) s.markHashed(obs[i].k, what, h); }
      const Ref r = reference(obs, cut);
      check("stopped after " + std::to_string(cut) + " observations: the set is exactly what was reported", s.distinct.load() == r.distinct && s.distinctStored.load() == r.stored && s.distinctMissing.load() == r.fallback && sameSet(s, r.m));
    }
    // concurrent writers stopped by a flag: no torn slot, every held key was observed, counts match the held flags
    SharedCoverage s(N + 1000); std::atomic<bool> stop{false}; std::atomic<size_t> reported{0};
    std::thread killer([&] { std::this_thread::sleep_for(std::chrono::milliseconds(3)); stop = true; });
    fill(s, obs, 8, 0, true, &reported, &stop); killer.join();
    size_t held = 0, st = 0, fb = 0; bool subset = true;
    s.each([&](const Key &k, uint8_t fl) { held++; st += (fl & Coverage::STORED) != 0; fb += (fl & Coverage::FALLBACK) != 0; auto it = ref.m.find({k.ns, k.id}); if (it == ref.m.end() || (fl & ~(it->second | Coverage::USED))) subset = false; });
    check("8 writers stopped mid-run: consistent set (counts equal the held keys and flags, every key was observed)", subset && held == s.distinct.load() && st == s.distinctStored.load() && fb == s.distinctMissing.load() && held <= ref.distinct,
          "\"held\":" + std::to_string(held) + ",\"observationsReported\":" + std::to_string(reported.load()));
  }
  // ---- agreement with the 4.3 merged per-worker tables ----
  {
    const int threads = 8; std::vector<Coverage> part((size_t)threads);
    for (auto &c : part) c.limit = N + 1000;
    for (size_t i = 0; i < obs.size(); i++) part[i % (size_t)threads].note(obs[i].k, obs[i].ok);
    Coverage merged; merged.limit = N + 1000; for (auto &c : part) merged.merge(c);
    SharedCoverage s(N + 1000); fill(s, obs, threads, 0, true);
    check("shared set equals the 4.3 merge of per-worker tables", merged.distinct == s.distinct.load() && merged.distinctStored == s.distinctStored.load() && merged.distinctMissing == s.distinctMissing.load() && !merged.capped && !s.capped.load());
  }
  // ---- memory: reserved once, bounded by the key limit ----
  {
    SharedCoverage s(size_t(1) << 21);
    check("an empty 2,097,152-key set holds one 64 KiB tier (memory follows the keys, not the limit)", s.bytes() == 4096 * 16 + 3 * emcov::Hll::M && s.limit == (size_t(1) << 21) && s.slotsNow() == 4096);
    check("nominal memory is a function of the key count only: 64 KiB tier up to 2,047 keys, the next tier from 2,048", s.nominalBytes(0) == 4096 * 16 + 3 * emcov::Hll::M && s.nominalBytes(2047) == s.nominalBytes(0) && s.nominalBytes(2048) == (4096 + 16384) * 16 + 3 * emcov::Hll::M && s.nominalBytes(size_t(1) << 21) == (4096 + 16384 + 65536 + 262144 + 1048576 + 4194304) * 16 + 3 * emcov::Hll::M);
    fill(s, obs, 8, 0, true);
    // tiers quadruple at half full: the current tier has at most 8 slots a key, all tiers together at most 4/3 of it
    const size_t d = s.distinct.load();
    check("after " + std::to_string(d) + " keys from 8 writers: promoted through tiers, exact, at most 8 slots a key and 4/3 of the current tier in total", d == ref.distinct && !s.capped.load() && s.slotsNow() >= 2 * d && s.slotsNow() <= 8 * d && s.bytes() <= s.slotsNow() * 16 * 4 / 3 + 3 * emcov::Hll::M + 4096 * 16 && s.bytes() >= s.nominalBytes(d) && sameSet(s, ref.m),
          "\"slots\":" + std::to_string(s.slotsNow()) + ",\"bytes\":" + std::to_string(s.bytes()));
    SharedCoverage full(64); const std::vector<Obs> few = observations(64, 3); for (auto &o : few) full.mark(o.k, o.ok ? Coverage::STORED : Coverage::FALLBACK);
    check("a small key limit (64) uses the minimum tier and is exact up to the limit", full.distinct.load() == reference(few).distinct && !full.capped.load() && full.slotsNow() == 1024);
  }
  // ---- a pending stop: no promotion is started, observations still go into the present tier, and promotion resumes afterwards ----
  {
    std::atomic<int> stop{0}; SharedCoverage s(200000); s.stop = &stop;   // key limit well above the 23,000 keys used here, whatever N is
    const std::vector<Obs> few = observations(3000, 11); const Ref r = reference(few);
    size_t i = 0; for (; i < few.size() / 2; i++) s.mark(few[i].k, few[i].ok ? Coverage::STORED : Coverage::FALLBACK);
    const size_t before = s.slotsNow(); stop = 2;
    for (; i < few.size(); i++) s.mark(few[i].k, few[i].ok ? Coverage::STORED : Coverage::FALLBACK);
    const bool held = s.slotsNow() == before && s.distinct.load() == r.distinct && sameSet(s, r.m);
    stop = 0; const std::vector<Obs> more = observations(20000, 12); for (auto &o : more) s.mark(o.k, o.ok ? Coverage::STORED : Coverage::FALLBACK);
    // a stop raised while 8 writers are pushing the set through promotions: abandoned promotions must not lose or duplicate a key
    for (int round = 0; round < 3; round++) {
      std::atomic<int> st2{0}; SharedCoverage c(N + 1000); c.stop = &st2;
      std::thread flip([&] { for (int j = 0; j < 40; j++) { std::this_thread::sleep_for(std::chrono::microseconds(300 + 200 * round)); st2 = j % 2 ? 0 : 2; } st2 = 0; });
      fill(c, obs, 8, round, true); flip.join();
      check("stop raised and cleared 20 times while 8 writers promote the set, round " + std::to_string(round) + ": exact, nothing lost or duplicated", !c.capped.load() && c.distinct.load() == ref.distinct && c.distinctStored.load() == ref.stored && c.distinctMissing.load() == ref.fallback && sameSet(c, ref.m));
    }
    check("while a stop is pending the tier is not promoted and no observation is lost; promotion resumes when it is cleared", held && s.slotsNow() > before && !s.capped.load(), "\"slotsWhileStopped\":" + std::to_string(before) + ",\"slotsAfter\":" + std::to_string(s.slotsNow()));
  }
  // ---- promotion races: many writers pushing the set through every tier while re-reporting each other's keys ----
  for (int round = 0; round < 3; round++) {
    SharedCoverage s(N + 1000); fill(s, obs, 16, 2 - round % 3, round % 2 == 0);
    check("16 writers through five promotions, round " + std::to_string(round) + ": no key lost or duplicated", !s.capped.load() && s.distinct.load() == ref.distinct && s.distinctStored.load() == ref.stored && s.distinctMissing.load() == ref.fallback && sameSet(s, ref.m));
  }
  std::printf("{\"tool\":\"coverage44\",\"distinctKeys\":%zu,\"observations\":%zu,\"failures\":%d,\"checks\":[%s]}\n", ref.distinct, obs.size(), failures, out.c_str());
  return failures ? 1 : 0;
}
