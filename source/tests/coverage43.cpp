// EightMax 4.3: large-scale strategy-coverage accounting (native/coverage.hpp).
//
// Reference: an independent exact count from a sorted, de-duplicated vector of
// (namespace, id, flag) tuples (std::sort + linear scan; no hashing).
//
// Checks, for 100,000 / 500,000 / 1,000,000 / 2,000,000 distinct information
// sets (each observed about 1.5 times, with stored and fallback observations):
//   * 1, 2, 4, 8 and 16 workers, keys partitioned three ways (round robin,
//     blocks, by hash), worker tables merged in a shuffled order: distinct,
//     stored and fallback distinct counts and lookup counts equal the reference;
//     the table is not capped and stays within the byte pool;
//   * a key limit below the true count: capped, distinctCountKind lower bound
//     (counts <= reference and == the limit), HyperLogLog estimate within
//     4 standard errors of the reference;
//   * a byte pool too small for the workers' tables: capped (never silently
//     exact), counts are lower bounds, pool bytes returned when tables die.
// usage: coverage43 [maxDistinct]   (default 2,000,000)
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <random>
#include <string>
#include <thread>
#include <tuple>
#include <vector>
#include "coverage.hpp"
using emcov::Coverage; using emcov::Key;
static int failures = 0; static std::string out;
static void check(const std::string &name, bool ok, const std::string &detail = "") {
  if (!ok) failures++;
  out += std::string(out.empty() ? "" : ",") + "{\"check\":\"" + name + "\",\"passed\":" + (ok ? "true" : "false") + (detail.empty() ? "" : "," + detail) + "}";
}
struct Obs { Key k; bool ok; };
struct Ref { size_t distinct = 0, stored = 0, fallback = 0; long long lookups = 0, sl = 0, fl = 0; };
static Ref reference(const std::vector<Obs> &obs) {
  std::vector<std::tuple<uint64_t, uint64_t, int>> v; v.reserve(obs.size()); Ref r;
  for (auto &o : obs) { v.emplace_back(o.k.ns, o.k.id, o.ok ? 1 : 2); r.lookups++; (o.ok ? r.sl : r.fl)++; }
  std::sort(v.begin(), v.end());
  for (size_t i = 0; i < v.size();) {
    size_t j = i; int f = 0; while (j < v.size() && std::get<0>(v[j]) == std::get<0>(v[i]) && std::get<1>(v[j]) == std::get<1>(v[i])) f |= std::get<2>(v[j++]);
    r.distinct++; if (f & 1) r.stored++; if (f & 2) r.fallback++; i = j;
  }
  return r;
}
// Observations shaped like the evaluator's: row keys of 8 seats over many states, synthetic keys, repeats.
static std::vector<Obs> make(size_t distinct, uint32_t seed) {
  std::mt19937_64 g(seed); std::vector<Obs> obs; obs.reserve(distinct * 3 / 2 + 16);
  for (size_t i = 0; i < distinct; i++) {
    const int seat = (int)(i % 8);
    const Key k = (i % 5 == 4) ? emcov::synthKeyOf((int)(i / 5), seat, (int)(g() % 1326))
                               : emcov::rowKeyOf(((uint64_t)(i / 8) << 37) | ((g() % 1326) << 26) | (g() & 0x3FFFFFF), seat);
    obs.push_back({k, g() % 3 != 0});
    if (g() % 2) obs.push_back({k, g() % 4 == 0});
  }
  std::shuffle(obs.begin(), obs.end(), g);
  return obs;
}
static int part(int rule, size_t i, const Key &k, int workers, size_t n) {
  if (rule == 0) return (int)(i % (size_t)workers);
  if (rule == 1) return (int)std::min<size_t>((size_t)workers - 1, i * (size_t)workers / std::max<size_t>(1, n));
  return (int)(emcov::hashOf(k) % (uint64_t)workers);
}
int main(int argc, char **argv) {
  const size_t maxN = argc > 1 ? (size_t)std::atoll(argv[1]) : 2000000;
  for (size_t n : {100000ul, 500000ul, 1000000ul, 2000000ul}) {
    if (n > maxN) continue;
    const auto obs = make(n, (uint32_t)n); const Ref r = reference(obs);
    for (int workers : {1, 2, 4, 8, 16}) for (int rule = 0; rule < 3; rule++) for (int tight = 0; tight < 2; tight++) {
      if (n >= 1000000 && rule == 1 && workers != 8) continue;   // keep the run short; every rule still covered
      // generous: worst case (every worker could see every observation; growth briefly holds the old
      // and the doubled table). tight: 32 bytes per true key, shared by all workers.
      size_t slotsWorst = 1024; while (slotsWorst < 2 * obs.size()) slotsWorst *= 2;   // one worker may see every observation
      const long long poolBytes = tight ? (long long)(r.distinct * 32) : (long long)((size_t)workers * slotsWorst * 16 * 3 / 2);   // + transient old table while doubling
      auto pool = std::make_shared<std::atomic<long long>>(poolBytes);
      std::vector<Coverage> w((size_t)workers);
      for (auto &c : w) { c.limit = (size_t)1 << 26; c.pool = pool; }
      std::vector<std::thread> th;
      for (int t = 0; t < workers; t++) th.emplace_back([&, t] { for (size_t i = 0; i < obs.size(); i++) if (part(rule, i, obs[i].k, workers, obs.size()) == t) w[(size_t)t].note(obs[i].k, obs[i].ok); });
      for (auto &x : th) x.join();
      std::vector<int> order((size_t)workers); for (int i = 0; i < workers; i++) order[(size_t)i] = i;
      std::shuffle(order.begin(), order.end(), std::mt19937(workers * 31 + rule));
      Coverage total; total.limit = (size_t)1 << 26;
      for (int i : order) total.merge(w[(size_t)i]);
      const bool exact = total.distinct == r.distinct && total.distinctStored == r.stored && total.distinctMissing == r.fallback && total.lookups == r.lookups && total.stored == r.sl && total.missing == r.fl;
      const bool lowerBounds = total.capped && total.distinct <= r.distinct && total.distinctStored <= r.stored && total.distinctMissing <= r.fallback && total.lookups == r.lookups;
      const long long used = poolBytes - pool->load();
      char d[256]; std::snprintf(d, sizeof d, "\"distinct\":%zu,\"reference\":%zu,\"capped\":%s,\"poolBytes\":%lld,\"poolBytesUsed\":%lld,\"mergedBytes\":%zu", total.distinct, r.distinct, total.capped ? "true" : "false", poolBytes, used, total.bytes());
      const std::string what = std::to_string(n) + " information sets, " + std::to_string(workers) + " workers, partition " + std::to_string(rule);
      if (!tight) check(what + ": exact counts equal the sorted reference", exact && !total.capped && used <= poolBytes, d);
      else check(what + ", pool of 32 bytes per key: exact, or flagged lower bounds (never silently inexact)", ((exact && !total.capped) || lowerBounds) && used <= poolBytes, d);
    }
    // key limit below the true count -> lower bounds + estimate
    {
      Coverage c; c.limit = r.distinct / 2; for (auto &o : obs) c.note(o.k, o.ok);
      const double est = c.estimateDistinct(), tol = 4 * emcov::Hll::relativeStdError() * (double)r.distinct;
      char d[256]; std::snprintf(d, sizeof d, "\"limit\":%zu,\"lowerBound\":%zu,\"reference\":%zu,\"estimate\":%.0f,\"tolerance\":%.0f", c.limit, c.distinct, r.distinct, est, tol);
      check(std::to_string(n) + ": key limit reached -> capped, exact lower bounds, HyperLogLog estimate within 4 standard errors",
            c.capped && c.distinct == c.limit && c.distinctStored <= r.stored && c.distinctMissing <= r.fallback && std::fabs(est - (double)r.distinct) <= tol &&
            std::fabs(c.estimateStored() - (double)r.stored) <= 4 * emcov::Hll::relativeStdError() * (double)r.stored + 1 &&
            std::fabs(c.estimateFallback() - (double)r.fallback) <= 4 * emcov::Hll::relativeStdError() * (double)r.fallback + 1, d);
      // capped worker tables merged: the merged estimate still sees every key
      Coverage a, b; a.limit = b.limit = r.distinct / 8; size_t i = 0; for (auto &o : obs) (i++ % 2 ? a : b).note(o.k, o.ok);
      Coverage m; m.limit = r.distinct / 4; m.merge(a); m.merge(b);
      const double e2 = m.estimateDistinct();
      check(std::to_string(n) + ": capped worker tables merge into a capped lower bound whose estimate covers the union", m.capped && m.distinct <= r.distinct && std::fabs(e2 - (double)r.distinct) <= tol,
            "\"estimate\":" + std::to_string((long long)e2) + ",\"reference\":" + std::to_string(r.distinct));
    }
    // byte pool too small
    {
      auto pool = std::make_shared<std::atomic<long long>>((long long)(r.distinct * 8));   // a quarter of what is needed
      long long before = pool->load(); bool lower = true, cappedAny = false;
      { std::vector<Coverage> w(4); for (auto &c : w) { c.limit = (size_t)1 << 26; c.pool = pool; }
        size_t i = 0; for (auto &o : obs) w[i++ % 4].note(o.k, o.ok);
        for (auto &c : w) { cappedAny |= c.capped; lower &= c.distinct <= r.distinct; }
        lower &= before - pool->load() <= before; }
      check(std::to_string(n) + ": byte pool too small -> capped lower bounds, pool never overdrawn, bytes returned afterwards", cappedAny && lower && pool->load() == before);
    }
  }
  std::printf("{\"suite\":\"coverage43\",\"failures\":%d,\"checks\":[%s]}\n", failures, out.c_str());
  return failures ? 1 : 0;
}
