// EightMax 4.0: cached showdown tables for exact action-EV runouts.
//
// 3.9 enumerated every board completion separately at every terminal of the
// evaluated subtree: for one eight-player preflop deal that is 376,992 boards
// x 8 seven-card evaluations x one ICM call PER TERMINAL, although every
// terminal of the same deal sees the same boards and the same hole cards.
//
// 4.0 scores each deal's board completions once (a "table": all seats' scores
// per board, CPU or CUDA) and, per set of contesting seats, reduces it to a
// histogram of RANK PATTERNS: the dense rank of every contesting seat among the
// contesting seats (ties share a rank). Pot distribution depends on the scores
// only through this pattern (every pot's winners are the best-ranked eligible
// seats), so the terminal utility is
//     sum over patterns q:  count(q) * u(q) / boards
// which is the same exact expectation as the per-board average of 3.9 (only
// the floating-point summation order differs; tests require 1e-9 relative
// agreement with the independent JavaScript reference). Counts are integers,
// so CPU, CUDA and hybrid tables give bit-identical EVs.
//
// Memory: a table is boards x seats x 4 bytes (at most ~14 MB: two seats on an
// empty board, C(48,5) boards). Tables are charged to the request's memory
// budget; when a table does not fit, the terminal falls back to the 3.9
// per-board enumeration (with polling). Each worker keeps its 3 most recent
// tables.
#pragma once
#include <algorithm>
#include <memory>
#include <mutex>
#include <unordered_map>
namespace {
namespace es {
inline unsigned long long binom64(int n, int k) { if (k < 0 || n < k) return 0; unsigned long long r = 1; for (int i = 1; i <= k; i++) r = r * (unsigned long long)(n - k + i) / (unsigned long long)i; return r; }
// Process-wide CUDA device for evaluation tables (one user at a time; a worker
// that finds it busy scores its table on the CPU, so CPU and GPU run together).
struct EvGpu {
  std::mutex mu; CudaScore dev; bool attempted = false, ok = false, verified = false; std::string reason = "not probed";
  double cpuNsPerEval = 0, gpuNsPerEval = 0;   // measured on the verification table
  static EvGpu &get() { static EvGpu g; return g; }
  bool open() {   // call with mu held
    if (!attempted) { attempted = true; ok = dev.open(); reason = dev.info.reason; if (ok && !dev.hasBoards()) { ok = false; reason = "embedded CUDA module lacks the board_scores kernel"; } }
    return ok;
  }
  void disable(const char *why) { ok = false; reason = why; dev.releaseBuffers(); }
};
enum class Device { Auto, Cpu, Gpu, Hybrid };
inline const char *deviceName(Device d) { return d == Device::Cpu ? "cpu" : d == Device::Gpu ? "gpu" : d == Device::Hybrid ? "hybrid" : "auto"; }
struct ShowdownStats {
  std::atomic<long long> tables{0}, boards{0}, cpuBoards{0}, gpuBoards{0}, gpuTables{0}, hybridTables{0}, patternSets{0}, directTerminals{0}, gpuFailures{0}, reused{0};
  std::mutex mu; std::string gpuNote;
  void note(const std::string &s) { std::lock_guard<std::mutex> g(mu); if (gpuNote.empty()) gpuNote = s; }
};
struct ShowTable {
  uint64_t used = 0; int len = -1, n = 0; int prefix[5] = {}; int holes[16] = {}; unsigned long long boards = 0;
  int deck[52] = {}; int deckCount = 0; long long stamp = 0; long long charged = 0;
  std::vector<int32_t> scores;
  struct Hist { uint32_t mask; std::vector<std::pair<uint32_t, uint32_t>> patterns; };
  std::vector<Hist> hist;
  bool matches(uint64_t u, int l, const int *cards, const int *h, int nn) const {
    if (len != l || used != u || n != nn) return false;
    for (int i = 0; i < l; i++) if (prefix[i] != cards[i]) return false;
    for (int i = 0; i < 2 * nn; i++) if (holes[i] != h[i]) return false;
    return true;
  }
};
// colexicographic successor of a combination x[0] < ... < x[r-1] of {0..N-1}
inline bool nextColex(int *x, int r, int N) {
  for (int i = 0; i < r; i++) {
    const int limit = i + 1 < r ? x[i + 1] : N;
    if (x[i] + 1 < limit) { x[i]++; for (int j = 0; j < i; j++) x[j] = j; return true; }
  }
  return false;
}
inline void unrankColex(unsigned long long index, int r, int N, int *x) {
  int upper = N;
  for (int k = r; k >= 1; --k) { int v = k - 1; while (v + 1 < upper && binom64(v + 1, k) <= index) ++v; index -= binom64(v, k); x[k - 1] = v; upper = v; }
}
// Dense rank pattern of the contesting seats on one board (3 bits per seat, in seat order).
inline uint32_t rankPattern(const int32_t *sc, const int *seats, int c) {
  int32_t d[8]; int nd = 0;
  for (int i = 0; i < c; i++) { const int32_t v = sc[seats[i]]; int j = 0; while (j < nd && d[j] > v) j++; if (j < nd && d[j] == v) continue; for (int q = nd; q > j; q--) d[q] = d[q - 1]; d[j] = v; nd++; }
  uint32_t code = 0;
  for (int i = 0; i < c; i++) { const int32_t v = sc[seats[i]]; int r = 0; while (d[r] != v) r++; code |= (uint32_t)r << (3 * i); }
  return code;
}
} // namespace es
} // namespace
