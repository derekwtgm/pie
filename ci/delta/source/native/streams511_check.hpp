// EightMax 5.11: checks of the counter-based training streams (streams511.hpp) that have no command-line surface,
// the stream printer for the independent implementation, and the counter audit. Included at the end of mw.cpp.
#pragma once
#include <algorithm>
#include <map>

extern "C" int mw_stream511(unsigned long long seed, int domain, int purpose, long long t, long long d, int count, JB *out) {
  if (domain < 0 || domain > 8 || purpose < 1 || purpose > 3 || t < 0 || d < 0 || count < 1 || count > 4096) return 400;
  em511::Key key; key.on = true; key.k[0] = seed; key.k[1] = domain == 0 ? em511::DOMAIN_TRAIN : (em511::DOMAIN_RESPONSE | (uint64_t)(domain - 1));
  Rng r{0}; r.address(key, (uint64_t)purpose, (uint64_t)t, (uint64_t)d);
  jb_printf(out, "{\"method\":\"%s\",\"seed\":\"%016llx\",\"key1\":\"%016llx\",\"domain\":%d,\"purpose\":%d,\"t\":%lld,\"d\":%lld,\"unit\":[", em511::ALGORITHM, seed, (unsigned long long)key.k[1], domain, purpose, t, d);
  std::vector<double> u((size_t)count);
  for (int i = 0; i < count; i++) { u[(size_t)i] = r.next(); jb_printf(out, "%s%.17g", i ? "," : "", u[(size_t)i]); }
  jb_puts(out, "],\"unitBits\":[");
  for (int i = 0; i < count; i++) { uint64_t b; std::memcpy(&b, &u[(size_t)i], 8); jb_printf(out, "%s\"%016llx\"", i ? "," : "", (unsigned long long)b); }
  jb_puts(out, "]}"); return 200;
}

extern "C" int mw_streams511_audit_begin(MW *m) {
  if (!m || !m->wide.on) return 0;
  delete m->wide.audit; m->wide.audit = new em511::Audit(); return 1;
}
// What the audit states about the counters recorded since mw_streams511_audit_begin:
//   blocks      how many groups of four numbers the generator produced
//   distinct    how many different 256-bit counters that was (blocks - distinct = duplicates)
//   streams     how many different (purpose, t, d)
//   gaps        streams whose j values are not exactly 0, 1, ..., count-1
//   outOfRange  counters with a purpose other than 1..3, d >= 64 (cards, actions) or >= 8 (Latin: a seat),
//               or t beyond the committed updates of the engine
// A training without a rolled-back update has duplicates == 0; a rolled-back update is repeated with the same
// addresses (the same numbers again), and a Latin permutation is recomputed after a restore.
extern "C" int mw_streams511_audit_end(MW *m, JB *out) {
  if (!m || !m->wide.on || !m->wide.audit) return 0;
  std::vector<std::array<uint64_t, 4>> used; { std::lock_guard<std::mutex> lock(m->wide.audit->mu); used.swap(m->wide.audit->used); }
  delete m->wide.audit; m->wide.audit = nullptr; m->rng.audit = nullptr;
  const size_t blocks = used.size();
  // order: purpose, t, d, j
  std::sort(used.begin(), used.end(), [](const auto &a, const auto &b) { if (a[3] != b[3]) return a[3] < b[3]; if (a[1] != b[1]) return a[1] < b[1]; if (a[2] != b[2]) return a[2] < b[2]; return a[0] < b[0]; });
  size_t duplicates = 0, streams = 0, gaps = 0, outOfRange = 0, perPurpose[4] = {0, 0, 0, 0}, dupPurpose[4] = {0, 0, 0, 0}, streamsPurpose[4] = {0, 0, 0, 0}; uint64_t longest = 0, maxT = 0;
  for (size_t i = 0; i < blocks;) {
    size_t e = i; while (e < blocks && used[e][3] == used[i][3] && used[e][1] == used[i][1] && used[e][2] == used[i][2]) e++;
    const uint64_t purpose = used[i][3], t = used[i][1], d = used[i][2];
    streams++; maxT = std::max(maxT, t);
    const bool known = purpose >= 1 && purpose <= 3;
    if (!known || d >= (purpose == em511::LATIN ? 8u : 64u) || (purpose != em511::LATIN && t > (uint64_t)m->iterations)) outOfRange += e - i;
    uint64_t expect = 0; bool gap = false;
    for (size_t x = i; x < e; x++) {
      if (x > i && used[x][0] == used[x - 1][0]) { duplicates++; if (known) dupPurpose[purpose]++; continue; }
      if (used[x][0] != expect) gap = true;
      expect = used[x][0] + 1;
    }
    if (known) { perPurpose[purpose] += e - i; streamsPurpose[purpose]++; }
    gaps += gap; longest = std::max<uint64_t>(longest, expect);
    i = e;
  }
  jb_printf(out, "{\"method\":\"%s\",\"blocks\":%zu,\"numbers\":%zu,\"distinct\":%zu,\"duplicates\":%zu,\"streams\":%zu,\"gaps\":%zu,\"outOfRange\":%zu,\"longestStreamBlocks\":%llu,\"largestUpdateIndex\":%llu,\"committedUpdates\":%lld,"
            "\"byPurpose\":{\"cards\":%zu,\"actions\":%zu,\"latin\":%zu},\"duplicatesByPurpose\":{\"cards\":%zu,\"actions\":%zu,\"latin\":%zu},\"streamsByPurpose\":{\"cards\":%zu,\"actions\":%zu,\"latin\":%zu}}",
            em511::ALGORITHM, blocks, blocks * 4, blocks - duplicates, duplicates, streams, gaps, outOfRange, (unsigned long long)longest, (unsigned long long)maxT, m->iterations,
            perPurpose[1], perPurpose[2], perPurpose[3], dupPurpose[1], dupPurpose[2], dupPurpose[3], streamsPurpose[1], streamsPurpose[2], streamsPurpose[3]);
  return 1;
}

extern "C" int mw_selftest511(JB *out) {
  int passed = 0, failed = 0; bool first = true;
  auto item = [&](const char *id, const char *name, bool ok, const std::string &detail) {
    ok ? passed++ : failed++;
    jb_puts(out, first ? "{\"id\":" : ",{\"id\":"); first = false; jb_str(out, id); jb_puts(out, ",\"name\":"); jb_str(out, name);
    jb_printf(out, ",\"passed\":%s,\"detail\":", ok ? "true" : "false"); jb_str(out, detail.c_str()); jb_putc(out, '}');
  };
  auto hex = [](uint64_t v) { char b[20]; std::snprintf(b, sizeof b, "%016llx", (unsigned long long)v); return std::string(b); };
  uint64_t sm = 0x511aa11c0ffee511ULL; auto next = [&] { sm += 0x9E3779B97F4A7C15ULL; uint64_t z = sm; z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL; z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL; return z ^ (z >> 31); };
  jb_puts(out, "{\"checks\":[");
  { // G1: the known-answer vectors of the reference implementation (Random123 kat_vectors, "philox4x64 10").
    struct Kat { uint64_t c[4], k[2], want[4]; };
    const Kat kats[3] = {
      {{0, 0, 0, 0}, {0, 0}, {0x16554d9eca36314cULL, 0xdb20fe9d672d0fdcULL, 0xd7e772cee186176bULL, 0x7e68b68aec7ba23bULL}},
      {{~0ULL, ~0ULL, ~0ULL, ~0ULL}, {~0ULL, ~0ULL}, {0x87b092c3013fe90bULL, 0x438c3c67be8d0224ULL, 0x9cc7d7c69cd777b6ULL, 0xa09caebf594f0ba0ULL}},
      {{0x243f6a8885a308d3ULL, 0x13198a2e03707344ULL, 0xa4093822299f31d0ULL, 0x082efa98ec4e6c89ULL}, {0x452821e638d01377ULL, 0xbe5466cf34e90c6cULL}, {0xa528f45403e61d95ULL, 0x38c72dbd566e9788ULL, 0xa5a1610e72fd18b5ULL, 0x57bd43b5e52b7fe6ULL}}};
    int bad = 0; std::string got;
    for (const Kat &t : kats) { uint64_t o[4]; em511::block(t.c, t.k, o); for (int i = 0; i < 4; i++) bad += o[i] != t.want[i]; got += (got.empty() ? "" : "; ") + hex(o[0]) + " " + hex(o[1]) + " " + hex(o[2]) + " " + hex(o[3]); }
    item("G1", "generator: Philox4x64-10 of the training streams reproduces the three known-answer vectors of its reference implementation", bad == 0, std::to_string(bad) + " of 12 output words differ; computed: " + got);
  }
  { // G2: the training generator and the 5.9 evaluation generator are two source texts of one function.
    int bad = 0; const int N = 100000;
    for (int i = 0; i < N; i++) { const uint64_t c[4] = {next(), next(), next(), next()}, k[2] = {next(), next()}; uint64_t a[4], b[4]; em511::block(c, k, a); es::Philox4x64::block(c, k, b); bad += std::memcmp(a, b, sizeof a) != 0; }
    item("G2", "generator: the same 256 bits as the 5.9 evaluation generator (a second source text of the function) for 100,000 random counters and keys", bad == 0, std::to_string(bad) + " of " + std::to_string(N) + " blocks differ");
  }
  { // G3: bijection. unblock(block(c)) == c shows block is injective on the sample; block(unblock(y)) == y shows
    // every sampled y has a preimage. The whole-domain statement is the algebra in streams511.hpp: M0, M1 odd.
    int bad1 = 0, bad2 = 0; const int N = 100000; const uint64_t I0 = em511::inverse64(em511::M0), I1 = em511::inverse64(em511::M1);
    for (int i = 0; i < N; i++) {
      const uint64_t c[4] = {next(), next(), next(), next()}, k[2] = {next(), next()}; uint64_t y[4], back[4], z[4];
      em511::block(c, k, y); em511::unblock(y, k, back); bad1 += std::memcmp(c, back, sizeof back) != 0;
      em511::unblock(c, k, z); em511::block(z, k, y); bad2 += std::memcmp(c, y, sizeof y) != 0;
    }
    const bool inverses = em511::M0 * I0 == 1 && em511::M1 * I1 == 1 && (em511::M0 & 1) && (em511::M1 & 1);
    item("G3", "generator: the map counter -> block is inverted in both directions (a bijection of the 256-bit counters for a fixed key); the two multipliers are odd and their inverses modulo 2^64 are exact", bad1 == 0 && bad2 == 0 && inverses,
         "inverse after forward: " + std::to_string(bad1) + " failures; forward after inverse: " + std::to_string(bad2) + " failures of " + std::to_string(N) + "; M0*I0 = " + std::to_string((unsigned long long)(em511::M0 * I0)) + ", M1*I1 = " + std::to_string((unsigned long long)(em511::M1 * I1)));
  }
  { // A1: the address IS the counter: stream (purpose, t, d) of key (seed, domain) draws block (j, t, d, purpose).
    int bad = 0, cases = 0;
    for (int i = 0; i < 2000; i++) {
      em511::Key key; key.on = true; key.k[0] = next(); key.k[1] = (i & 1) ? em511::DOMAIN_TRAIN : (em511::DOMAIN_RESPONSE | (uint64_t)(i % 8));
      const uint64_t purpose = 1 + (uint64_t)(i % 3), t = (i % 5 == 0) ? (uint64_t)em511::MAX_UPDATES - (uint64_t)(i % 7) : next() >> (i % 64), d = next() % 64;
      Rng r{0}; r.address(key, purpose, t, d);
      for (uint64_t j = 0; j < 5; j++) {
        const uint64_t c[4] = {j, t, d, purpose}; uint64_t want[4]; em511::block(c, key.k, want);
        for (int w = 0; w < 4; w++) { cases++; const double x = r.next(), y = (double)(want[w] >> 11) * (1.0 / 9007199254740992.0); bad += std::memcmp(&x, &y, 8) != 0; }
      }
    }
    item("A1", "address: the numbers of stream (purpose, t, d) are the words of Philox(counter = (j, t, d, purpose), key = (seed, domain)), j = 0, 1, 2, ...; each field has a counter word of its own, up to the largest update index", bad == 0, std::to_string(bad) + " of " + std::to_string(cases) + " numbers differ");
  }
  { // A2: different addresses, different blocks (the theorem, observed): all blocks of a grid of addresses are distinct,
    // also against the response domains of the same seed.
    std::vector<std::array<uint64_t, 4>> all; const uint64_t seed = 0x5eed511;
    const uint64_t ts[] = {0, 1, 2, 9999999, 10000000, 10000001, 4294967295ULL, 4294967296ULL, 4294967297ULL, (uint64_t)em511::MAX_UPDATES - 1, (uint64_t)em511::MAX_UPDATES};
    for (int dom = 0; dom < 3; dom++) for (uint64_t purpose = 1; purpose <= 3; purpose++) for (uint64_t t : ts) for (uint64_t d = 0; d < 64; d++) for (uint64_t j = 0; j < 4; j++) {
      const uint64_t k[2] = {seed, dom == 0 ? em511::DOMAIN_TRAIN : (em511::DOMAIN_RESPONSE | (uint64_t)(dom - 1))}, c[4] = {j, t, d, purpose}; uint64_t o[4]; em511::block(c, k, o); all.push_back({o[0], o[1], o[2], o[3]});
    }
    const size_t n = all.size(); std::sort(all.begin(), all.end()); const size_t distinct = (size_t)(std::unique(all.begin(), all.end()) - all.begin());
    // single 64-bit words may coincide by chance (birthday bound n^2 * 16 / 2^65, far below one); whole blocks may not.
    item("A2", "address: every block of a grid of addresses (3 key domains x 3 purposes x 11 update indices around 10,000,000, 2^32 and the largest x 64 deals x 4 groups) is different from every other", distinct == n, std::to_string(distinct) + " distinct of " + std::to_string(n) + " blocks");
  }
  { // N1: numbers: [0, 1), multiples of 2^-53, first two moments of a million numbers.
    em511::Key key; key.on = true; key.k[0] = 511; key.k[1] = em511::DOMAIN_TRAIN; Rng r{0}; r.address(key, em511::CARDS, 0, 0);
    const int N = 1000000; double sum = 0, sq = 0; int bad = 0; double lo = 1, hi = 0;
    for (int i = 0; i < N; i++) { const double x = r.next(); bad += !(x >= 0 && x < 1) || x * 9007199254740992.0 != std::floor(x * 9007199254740992.0); sum += x; sq += x * x; lo = std::min(lo, x); hi = std::max(hi, x); }
    const double mean = sum / N, var = sq / N - mean * mean, zMean = (mean - 0.5) / std::sqrt(1.0 / 12 / N), zVar = (var - 1.0 / 12) / std::sqrt(1.0 / 180 / N);
    char d[256]; std::snprintf(d, sizeof d, "%d numbers outside [0, 1) or off the 2^-53 grid; mean %.9f (z %.2f), variance %.9f (z %.2f), smallest %.3g, largest 1 - %.3g", bad, mean, zMean, var, zVar, lo, 1 - hi);
    item("N1", "numbers: a million numbers of one stream lie in [0, 1) on the 2^-53 grid, with mean and variance within 4.5 standard errors of 1/2 and 1/12", bad == 0 && std::fabs(zMean) < 4.5 && std::fabs(zVar) < 4.5, d);
  }
  { // L1: the 5.10 generator is untouched: its first outputs for state 17 and for the largest state.
    Rng a{17}, b{4294967295u}; const double x0 = a.next(), x1 = a.next(), x2 = a.next(), y0 = b.next();
    const uint64_t want[4] = {0x3fe5ab3719000000ULL, 0x3fc8a8fb64000000ULL, 0x3fe10118d2800000ULL, 0x3fecaf7e7a600000ULL}; const double got[4] = {x0, x1, x2, y0};
    int bad = 0; std::string s; for (int i = 0; i < 4; i++) { uint64_t bits; std::memcpy(&bits, &got[i], 8); bad += bits != want[i]; s += (i ? " " : "") + hex(bits); }
    item("L1", "5.10 generator: a stream without an address draws the numbers of the 32-bit generator of 5.10 (values computed by the JavaScript reference randomStream and by a Python port)", bad == 0 && a.state == 17u + 3u * 0x6d2b79f5u, s);
  }
  jb_printf(out, "],\"passed\":%d,\"failed\":%d}", passed, failed);
  return failed == 0;
}
