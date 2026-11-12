// EightMax 4.5: ICM kernel timing, 4.4 scalar routine (tests/fixtures/icm44_reference.hpp) against
// the 4.5 two-lane routine (native/icm.hpp), same inputs, interleaved repetitions, cache misses only
// (every stack vector is new). Prints nanoseconds per evaluation (minimum and median of the
// repetitions) and checks that both produced identical bits.
// build: g++ -std=c++20 -O2 -ffp-contract=off -Inative -Itests tools/icm_bench45.cpp -o icm_bench45
// usage: icm_bench45 [players 2..8] [evaluations] [repetitions]
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <random>
#include <vector>
#include "icm.hpp"
#include "fixtures/icm44_reference.hpp"
int main(int argc, char **argv) {
  const int n = argc > 1 ? std::atoi(argv[1]) : 8; const long evals = argc > 2 ? std::atol(argv[2]) : 200000; const int reps = argc > 3 ? std::atoi(argv[3]) : 7;
  Tournament t; Tournament44 r; for (int i = 0; i < n; i++) { t.start.push_back(20.0 + i); t.payout.push_back(30.0 - 3 * i); } r.start = t.start; r.payout = t.payout;
  std::vector<double> in((size_t)evals * 8); std::mt19937_64 g(7); for (double &x : in) x = 1.0 + (double)(g() % 1000003) / 1009.0;
  std::vector<double> a((size_t)evals * 8), b((size_t)evals * 8); std::vector<double> tNew, tOld;
  auto now = [] { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); };
  for (int rep = 0; rep < reps; rep++) {
    for (int which = 0; which < 2; which++) {
      const bool isNew = (which ^ rep) & 1;   // alternate the order
      Tournament::Workspace ws; Tournament44::Workspace wr; t.prepare(ws, 1 << 20); r.prepare(wr, 1 << 20);
      std::vector<double> &out = isNew ? a : b; out = in; const double t0 = now();
      if (isNew) for (long i = 0; i < evals; i++) t.evaluate(&out[(size_t)i * 8], n, ws);
      else for (long i = 0; i < evals; i++) r.evaluate(&out[(size_t)i * 8], n, wr);
      (isNew ? tNew : tOld).push_back((now() - t0) / (double)evals * 1e9);
    }
  }
  std::sort(tNew.begin(), tNew.end()); std::sort(tOld.begin(), tOld.end());
  const bool same = !std::memcmp(a.data(), b.data(), a.size() * sizeof(double));
  std::printf("{\"tool\":\"icm_bench45\",\"players\":%d,\"evaluations\":%ld,\"repetitions\":%d,\"nsPerEvaluation\":{\"v44\":{\"min\":%.1f,\"median\":%.1f},\"v45\":{\"min\":%.1f,\"median\":%.1f}},\"speedupAtMedian\":%.3f,\"speedupAtMinimum\":%.3f,\"bitIdentical\":%s}\n",
              n, evals, reps, tOld[0], tOld[tOld.size() / 2], tNew[0], tNew[tNew.size() / 2], tOld[tOld.size() / 2] / tNew[tNew.size() / 2], tOld[0] / tNew[0], same ? "true" : "false");
  return same ? 0 : 1;
}
