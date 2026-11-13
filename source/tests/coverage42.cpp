// EightMax 4.2: strategy-coverage accounting tests (native/coverage.hpp).
// Every check compares against an independent reference: a std::map from the
// ORIGINAL key to its flags, built single-threaded from the same observation
// stream. Output: one JSON document; exit status 0 only if every check passed.
// Build: g++ -std=c++20 -O2 -I native tests/coverage42.cpp -o coverage42 -lpthread
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <map>
#include <random>
#include <string>
#include <thread>
#include <vector>
#include "coverage.hpp"
using emcov::Coverage; using emcov::Key;

// ---- the 4.1 implementation, verbatim, to reproduce the reported defect ----
struct Coverage41 {
  static constexpr size_t SLOTS = 32768, LIMIT = SLOTS / 2;
  long long lookups = 0, stored = 0, missing = 0; bool capped = false; size_t distinct = 0, distinctMissing = 0;
  std::vector<uint64_t> slot; std::vector<uint8_t> miss;
  static uint64_t mix(uint64_t x) { x ^= x >> 33; x *= 0xff51afd7ed558ccdULL; x ^= x >> 33; x *= 0xc4ceb9fe1a85ec53ULL; return x ^ (x >> 33); }
  size_t place(uint64_t key) {
    if (slot.empty()) { slot.assign(SLOTS, 0); miss.assign(SLOTS, 0); }
    const uint64_t k = key | 1;
    for (size_t i = mix(key) & (SLOTS - 1);; i = (i + 1) & (SLOTS - 1)) {
      if (slot[i] == k) return i;
      if (!slot[i]) { if (distinct >= LIMIT) { capped = true; return SIZE_MAX; } slot[i] = k; distinct++; return i; }
    }
  }
  void note(uint64_t key, bool ok) { lookups++; (ok ? stored : missing)++; const size_t i = place(key); if (i != SIZE_MAX && !ok && !miss[i]) { miss[i] = 1; distinctMissing++; } }
  void merge(const Coverage41 &o) {
    lookups += o.lookups; stored += o.stored; missing += o.missing; capped |= o.capped;
    for (size_t i = 0; i < o.slot.size(); i++) if (o.slot[i]) { const size_t j = place(o.slot[i]); if (j != SIZE_MAX && o.miss[i] && !miss[j]) { miss[j] = 1; distinctMissing++; } }
  }
};
static uint64_t rowKey(uint32_t state, int hand, uint32_t code) { return ((uint64_t)state << 37) | ((uint64_t)hand << 26) | code; }

struct Obs { Key k; bool ok; };
struct Ref { size_t distinct = 0, stored = 0, missing = 0; long long lookups = 0, sl = 0, ml = 0; };
static Ref reference(const std::vector<Obs> &obs) {
  std::map<Key, int> m; Ref r;
  for (auto &o : obs) { m[o.k] |= o.ok ? 1 : 2; r.lookups++; (o.ok ? r.sl : r.ml)++; }
  for (auto &[k, f] : m) { r.distinct++; if (f & 1) r.stored++; if (f & 2) r.missing++; }
  return r;
}
static bool same(const Coverage &c, const Ref &r) {
  return c.distinct == r.distinct && c.distinctStored == r.stored && c.distinctMissing == r.missing && c.lookups == r.lookups && c.stored == r.sl && c.missing == r.ml && !c.capped;
}
static int failures = 0; static std::string out;
static void check(const char *name, bool ok, const std::string &detail = "") {
  if (!ok) failures++;
  char b[512]; std::snprintf(b, sizeof b, "%s{\"check\":\"%s\",\"passed\":%s%s%s}", out.empty() ? "" : ",", name, ok ? "true" : "false", detail.empty() ? "" : ",", detail.c_str());
  out += b;
}
static uint64_t oneBucket(const Key &) { return 7; }   // every key in one bucket: worst-case collisions
static uint64_t fewBuckets(const Key &k) { return k.id & 3; }

// Observations as the evaluator produces them: rowKey identities of several
// seats/states plus synthetic keys, with many repeats.
static std::vector<Obs> stream(size_t n, size_t universe, uint64_t seed) {
  std::mt19937_64 g(seed); std::vector<Obs> v; v.reserve(n);
  for (size_t i = 0; i < n; i++) {
    const uint64_t u = g() % universe; const int seat = (int)(u % 8); const uint32_t state = (uint32_t)(u / 8 % 5000);
    Obs o;
    if (u % 11 == 0) o.k = emcov::synthKeyOf((int)state - 1, seat, (int)(u % 1326));
    else o.k = emcov::rowKeyOf(rowKey(state, (int)(u % 169), (uint32_t)(u % 977)), seat);
    o.ok = (u % 7) != 0;   // a key's stored/fallback status is a property of the key (average policy)
    v.push_back(o);
  }
  return v;
}
// Split obs over `workers` threads by a partition rule, each thread with its own
// table (as EvalPool does), then merge in `order`.
static Coverage partitioned(const std::vector<Obs> &obs, int workers, int rule, const std::vector<int> &order, uint64_t (*h)(const Key &) = emcov::hashOf) {
  std::vector<Coverage> w((size_t)workers); for (auto &c : w) c.hash = h;
  std::vector<std::thread> th;
  for (int t = 0; t < workers; t++) th.emplace_back([&, t] {
    for (size_t i = 0; i < obs.size(); i++) {
      const int owner = rule == 0 ? (int)(i % (size_t)workers) : rule == 1 ? (int)(i * (size_t)workers / obs.size()) : (int)(emcov::mix64(i) % (uint64_t)workers);
      if (owner == t) w[(size_t)t].note(obs[i].k, obs[i].ok);
    }
  });
  for (auto &x : th) x.join();
  Coverage total; total.hash = h;
  for (int t : order) total.merge(w[(size_t)t]);
  return total;
}

int main() {
  // 1. Reproduction of the reported 4.1 defect and the 4.2 result.
  {
    Coverage41 worker, total; worker.note(42, true); total.merge(worker); total.note(42, true);
    Coverage w2, t2; w2.note(emcov::rowKeyOf(42, 0), true); t2.merge(w2); t2.note(emcov::rowKeyOf(42, 0), true);
    char d[160]; std::snprintf(d, sizeof d, "\"v41Distinct\":%zu,\"v42Distinct\":%zu,\"expected\":1", total.distinct, t2.distinct);
    check("reported 4.1 defect reproduced (42 seen, merged, seen again)", total.distinct == 2, d);
    check("4.2: one information set observed, merged and observed again counts once", t2.distinct == 1 && t2.lookups == 2, d);
    // key|1 makes 2k and 2k+1 compare equal; they merge whenever their probe
    // sequences meet (here: the same start slot, found by search).
    uint64_t ev = 0; for (uint64_t x = 2;; x += 2) if ((Coverage41::mix(x) & (Coverage41::SLOTS - 1)) == (Coverage41::mix(x + 1) & (Coverage41::SLOTS - 1))) { ev = x; break; }
    Coverage41 a; a.note(ev, true); a.note(ev + 1, true);
    Coverage b; b.note(emcov::rowKeyOf(ev, 0), true); b.note(emcov::rowKeyOf(ev + 1, 0), true);
    std::snprintf(d, sizeof d, "\"keys\":[%llu,%llu],\"v41Distinct\":%zu,\"v42Distinct\":%zu", (unsigned long long)ev, (unsigned long long)ev + 1, a.distinct, b.distinct);
    check("4.1 merged keys 2k and 2k+1 when their probes met (key|1); 4.2 keeps them distinct", a.distinct == 1 && b.distinct == 2, d);
    // 4.1 caller: rowKey(state) ^ seat<<62 -- states differing in bits 25-26 collided across seats.
    const uint64_t k1 = rowKey(1u << 25, 3, 5) ^ (0ULL << 62), k2 = rowKey(0, 3, 5) ^ (1ULL << 62);
    Coverage c; c.note(emcov::rowKeyOf(rowKey(1u << 25, 3, 5), 0), true); c.note(emcov::rowKeyOf(rowKey(0, 3, 5), 1), true);
    std::snprintf(d, sizeof d, "\"v41KeysEqual\":%s,\"v42Distinct\":%zu", k1 == k2 ? "true" : "false", c.distinct);
    check("4.1 seat XOR overwrote state bits; 4.2 key keeps state and seat", k1 == k2 && c.distinct == 2, d);
    Coverage s; s.note(emcov::synthKeyOf(-1, 2, 7), false); s.note(emcov::rowKeyOf(((uint64_t)0xFFFFFFFFu << 32) | 7, 2), true);
    check("synthetic and row key spaces never alias", s.distinct == 2 && s.distinctMissing == 1 && s.distinctStored == 1);
    Coverage z; z.note(Key{0, emcov::NS_ROW}, true); z.note(Key{0, emcov::NS_ROW}, true);
    check("key value 0 is an ordinary key (no reserved empty marker)", z.distinct == 1);
  }
  // 2. Repeated observations of one key; distinct vs visits.
  {
    Coverage c; for (int i = 0; i < 100000; i++) c.note(emcov::rowKeyOf(rowKey(9, 1, 2), 3), i % 3 != 0);
    check("100,000 visits of one information set: distinct 1, visits 100,000", c.distinct == 1 && c.lookups == 100000 && c.distinctStored == 1 && c.distinctMissing == 1 && c.stored + c.missing == 100000);
  }
  // 3. Forced hash collisions (one bucket, four buckets) vs reference.
  {
    const auto obs = stream(20000, 3000, 11); const Ref r = reference(obs);
    for (auto h : {oneBucket, fewBuckets}) {
      Coverage c; c.hash = h; for (auto &o : obs) c.note(o.k, o.ok);
      check(h == oneBucket ? "every key in one hash bucket matches the reference" : "keys sharing four buckets match the reference", same(c, r));
    }
    const Coverage p = partitioned(obs, 8, 2, {7, 3, 0, 5, 1, 6, 2, 4}, oneBucket);
    check("one-bucket hashing, 8 workers, shuffled merge matches the reference", same(p, r));
  }
  // 4. Workers 1, 2, 4, 8 x partition rules x merge orders vs single-thread reference.
  {
    const auto obs = stream(400000, 60000, 5); const Ref r = reference(obs); bool all = true; int runs = 0; std::mt19937 g(3);
    for (int workers : {1, 2, 4, 8}) for (int rule = 0; rule < 3; rule++) for (int rep = 0; rep < 4; rep++) {
      std::vector<int> order(workers); for (int i = 0; i < workers; i++) order[(size_t)i] = i; std::shuffle(order.begin(), order.end(), g);
      all &= same(partitioned(obs, workers, rule, order), r); runs++;
    }
    char d[200]; std::snprintf(d, sizeof d, "\"runs\":%d,\"observations\":400000,\"referenceDistinct\":%zu,\"referenceFallbackDistinct\":%zu", runs, r.distinct, r.missing);
    check("1/2/4/8 workers, 3 partition rules, random merge orders: identical to the single-thread reference", all, d);
  }
  // 5. Repeated and nested merging: union is idempotent for distinct counts.
  {
    const auto obs = stream(50000, 8000, 9); const Ref r = reference(obs);
    Coverage a; for (auto &o : obs) a.note(o.k, o.ok);
    Coverage t; t.merge(a); t.merge(a); t.merge(a);
    check("merging the same worker three times: distinct counts unchanged, visits tripled", t.distinct == r.distinct && t.distinctMissing == r.missing && t.distinctStored == r.stored && t.lookups == 3 * r.lookups);
    Coverage l, rr, x, y; for (size_t i = 0; i < obs.size(); i++) (i % 2 ? l : rr).note(obs[i].k, obs[i].ok);
    x.merge(l); x.merge(rr); Coverage x2; x2.merge(x);   // (L u R)
    y.merge(rr); Coverage y2; y2.merge(l); y2.merge(y);  // (L u (R))
    check("merge is associative and commutative", same(x2, r) && same(y2, r));
  }
  // 6. Large collection: growth past many resizes up to 300,000 distinct keys.
  {
    std::vector<Obs> obs; for (uint64_t i = 0; i < 300000; i++) obs.push_back({emcov::rowKeyOf(rowKey((uint32_t)(i / 169), (int)(i % 169), 0), (int)(i % 8)), i % 5 != 0});
    for (uint64_t i = 0; i < 300000; i += 3) obs.push_back(obs[i]);
    const Ref r = reference(obs); const Coverage p = partitioned(obs, 8, 2, {0, 1, 2, 3, 4, 5, 6, 7});
    char d[160]; std::snprintf(d, sizeof d, "\"distinct\":%zu,\"slots\":%zu,\"bytes\":%zu", p.distinct, p.slots(), p.bytes());
    check("300,000 distinct information sets over 8 workers match the reference", same(p, r), d);
  }
  // 7. Cap: beyond MAX_DISTINCT counts are lower bounds and flagged.
  {
    Coverage c; for (uint64_t i = 0; i < Coverage::MAX_DISTINCT + 10; i++) c.note(Key{i, emcov::NS_ROW}, true);
    check("cap reached: capped flag set, distinct = cap (a lower bound)", c.capped && c.distinct == Coverage::MAX_DISTINCT && c.lookups == (long long)Coverage::MAX_DISTINCT + 10);
  }
  // 8. Concurrency: every worker observes the SAME keys (identical-key workers).
  {
    const auto obs = stream(100000, 5000, 21); const Ref r = reference(obs);
    std::vector<Coverage> w(8); std::vector<std::thread> th;
    for (int t = 0; t < 8; t++) th.emplace_back([&, t] { for (auto &o : obs) w[(size_t)t].note(o.k, o.ok); });
    for (auto &x : th) x.join();
    Coverage tot; for (auto &c : w) tot.merge(c);
    check("8 workers observing identical keys: distinct counted once, visits 8x", tot.distinct == r.distinct && tot.distinctMissing == r.missing && tot.lookups == 8 * r.lookups);
  }
  std::printf("{\"suite\":\"coverage42\",\"failures\":%d,\"checks\":[%s]}\n", failures, out.c_str());
  return failures ? 1 : 0;
}
