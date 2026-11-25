// EightMax 5.11: training for a fixed wall-clock time (the equal-time arms of convergence511.py; the 5.10 tool, unchanged apart from this line).
// Build against a release's native/mw.cpp and json.o (5.9 or 5.10: only the public interface is used):
//   g++ -std=c++20 -O2 -march=x86-64 -ffp-contract=off -I<release>/source/native timed510.cpp mw.o json.o -lpthread -ldl -o timed
// Usage: timed spec.json milliseconds threads out.state memoryMiB
// Trains from the spec's initial state until the first 64-update progress boundary after the deadline (the clock is
// monotonic and starts after the engine has been built), writes the state and prints
// {"seconds","iterations","deals","limitReached"}. The same stopping rule as tools/timed_training.cpp of 5.6.
#include "mw.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
using Clock = std::chrono::steady_clock;
struct Deadline { Clock::time_point end; volatile int stop; long long iterations, deals; };
static void check(void *ctx, long long iterations, long long deals) {
  auto &d = *static_cast<Deadline *>(ctx); d.iterations = iterations; d.deals = deals;
  if (Clock::now() >= d.end) d.stop = 1;
}
int main(int argc, char **argv) {
  if (argc != 6) { std::fprintf(stderr, "usage: timed spec.json milliseconds threads out.state memoryMiB\n"); return 2; }
  std::ifstream file(argv[1]); std::string spec{std::istreambuf_iterator<char>(file), {}};
  char error[512] = {};
  MW *m = mw_create(spec.data(), spec.size(), std::atof(argv[5]), error, sizeof error);
  if (!m) { std::fprintf(stderr, "%s\n", error); return 1; }
  const auto begin = Clock::now(); Deadline d{begin + std::chrono::milliseconds(std::atoll(argv[2])), 0, 0, 0};
  if (!mw_train(m, 10000000, std::atoi(argv[3]), &d.stop, check, &d, error, sizeof error)) { std::fprintf(stderr, "%s\n", error); return 1; }
  const double seconds = std::chrono::duration<double>(Clock::now() - begin).count();
  JB info; jb_init(&info); mw_info(m, &info); const bool limit = info.s && std::strstr(info.s, "\"limitReached\":true"); jb_free(&info);
  unsigned char *state = nullptr; const size_t len = mw_export(m, &state);
  std::ofstream out(argv[4], std::ios::binary); out.write((const char *)state, (std::streamsize)len); free(state); mw_free(m);
  std::printf("{\"seconds\":%.6f,\"iterations\":%lld,\"deals\":%lld,\"limitReached\":%s}\n", seconds, d.iterations, d.deals, limit ? "true" : "false");
  return out.good() && len ? 0 : 1;
}
