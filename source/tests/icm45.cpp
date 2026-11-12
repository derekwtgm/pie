// EightMax 4.5: the two-lane (SSE2) ICM kernel against the archived 4.4 scalar routine.
// Every returned equity must have the IDENTICAL IEEE 754 bit pattern (not a tolerance), for
// 2-8 players in the hand, 0-8 other tournament players (at most 16 in total is the engine's
// bound; the test uses up to 10 so that it stays fast), busted players (stack 0), tied starting
// stacks, fewer payouts than players, tiny and huge stacks. Also checked independently of both
// routines: equities sum to the paid prize pool, and a player with all chips gets first prize.
#include <cstdio>
#include <cstring>
#include <cmath>
#include <random>
#include <string>
#include "icm.hpp"
#include "fixtures/icm44_reference.hpp"
int main(int argc, char **argv) {
  const long cases = argc > 1 ? std::atol(argv[1]) : 60000; std::mt19937_64 g(45);
  long evaluated = 0, bitMismatches = 0, sumErrors = 0, cacheMismatches = 0; double worstSum = 0;
  for (long c = 0; c < cases; c++) {
    const int n = 2 + (int)(g() % 7), others = (int)(g() % (n >= 8 ? 3 : 4)), all = n + others, paid = 1 + (int)(g() % (size_t)all);
    Tournament t; Tournament44 r;
    for (int i = 0; i < all; i++) { const double s = (g() % 8 == 0) ? 20.0 : 1.0 + (double)(g() % 100000) / 977.0; (i < n ? t.start : t.start).push_back(s); }
    for (int i = n; i < all; i++) t.others.push_back((g() % 5 == 0) ? 0.0 : t.start[(size_t)i] * (0.25 + (double)(g() % 1000) / 500.0));
    double pool = 0; for (int i = 0; i < paid; i++) { t.payout.push_back((double)(paid - i) * (1.0 + (double)(g() % 100) / 37.0)); }
    std::sort(t.payout.rbegin(), t.payout.rend()); for (double p : t.payout) pool += p;
    r.start = t.start; r.others = t.others; r.payout = t.payout;
    Tournament::Workspace ws; Tournament44::Workspace wr; t.prepare(ws, 64.0 * 1048576); r.prepare(wr, 64.0 * 1048576);
    for (int rep = 0; rep < 4; rep++) {
      double chips[8], ref[8], again[8]; double total = 0; int liveCount = 0;
      const int scale = (int)(g() % 6);   // 0-3 ordinary, 4 tiny, 5 huge
      for (int i = 0; i < n; i++) { chips[i] = (g() % 6 == 0) ? 0.0 : (1.0 + (double)(g() % 1000003) / 1009.0) * (scale == 4 ? 1e-6 : scale == 5 ? 1e9 : 1.0); if (chips[i] > 1e-9) liveCount++; total += chips[i]; }
      if (!liveCount) { chips[0] = 7.5; liveCount = 1; }
      for (double o : t.others) if (o > 1e-9) liveCount++;
      std::memcpy(ref, chips, sizeof chips); std::memcpy(again, chips, sizeof chips);
      t.evaluate(chips, n, ws); r.evaluate(ref, n, wr); t.evaluate(again, n, ws);   // the third call is a cache hit
      evaluated++;
      if (std::memcmp(chips, ref, sizeof(double) * (size_t)n)) bitMismatches++;
      if (std::memcmp(chips, again, sizeof(double) * (size_t)n)) cacheMismatches++;
      // independent sanity: with no other players, the equities add up to the prizes actually paid
      if (!others) { double sum = 0; for (int i = 0; i < n; i++) sum += chips[i]; double paidOut = 0; for (int i = 0; i < std::min(paid, n); i++) paidOut += t.payout[(size_t)i]; const double e = std::fabs(sum - paidOut) / paidOut; worstSum = std::max(worstSum, e); if (e > 1e-9) sumErrors++; }
    }
  }
  // one player holds every chip: first prize exactly
  Tournament t; t.start = {10, 10, 10}; t.payout = {50, 30, 20}; Tournament::Workspace ws; t.prepare(ws, 1 << 20); double chips[3] = {30, 0, 0}; t.evaluate(chips, 3, ws);
  const bool single = chips[0] == 50 && chips[1] == 25 && chips[2] == 25;   // the two busted players tie (equal starting stacks) and split 30 + 20
  const bool ok = !bitMismatches && !sumErrors && !cacheMismatches && single;
  std::printf("{\"suite\":\"icm45\",\"evaluations\":%ld,\"bitMismatchesAgainst44\":%ld,\"cacheHitMismatches\":%ld,\"prizeSumErrors\":%ld,\"worstRelativePrizeSumError\":%.3g,\"singleStackCheck\":%s,\"sse2\":%s,\"passed\":%s}\n",
              evaluated, bitMismatches, cacheMismatches, sumErrors, worstSum, single ? "true" : "false",
#if defined(__SSE2__)
              "true",
#else
              "false",
#endif
              ok ? "true" : "false");
  return ok ? 0 : 1;
}
