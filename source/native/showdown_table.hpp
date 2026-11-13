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
#include <map>
#include <cmath>
#include <algorithm>
#include <algorithm>
#include <memory>
#include <mutex>
#include <atomic>
#include <chrono>
#include <string>
#include <vector>
#include <unordered_map>
#include "ev_control.hpp"   // 4.3: TableCache charges the request's EvControl
#include <list>
#include <condition_variable>
#include <climits>
#include <cstdint>
#include <cmath>
#include <cstdlib>
#include <thread>
namespace {
namespace es {
inline unsigned long long binom64(int n, int k) { if (k < 0 || n < k) return 0; unsigned long long r = 1; for (int i = 1; i <= k; i++) r = r * (unsigned long long)(n - k + i) / (unsigned long long)i; return r; }
// Process-wide CUDA device for evaluation tables (one user at a time; a worker
// that finds it busy scores its table on the CPU, so CPU and GPU run together).
// 4.2: GPU-preferred requests wait a bounded time for a busy device (then use
// the CPU) and observe cancellation while waiting: try_lock polled every
// millisecond (a plain mutex; std::timed_mutex is avoided for MinGW
// winpthreads and ThreadSanitizer portability).
// 4.3 LIFECYCLE. The device stays open for the life of the process (the desktop
// host reuses one primary context for every job; nothing is destroyed between
// compatible jobs). New in 4.3:
//  * openAsync(): CUDA start-up (driver library, primary context, module: 63-73 ms
//    measured on the RTX 4060 Ti) runs on a background thread while the request
//    keeps scoring on the CPU, so Automatic never stalls a table on start-up.
//    EM_GPU_PREWARM=1 (desktop host) starts it at launch.
//  * idle release: a janitor thread frees the pooled device buffers (not the
//    context or the module) after EM_GPU_IDLE_RELEASE_S seconds without use
//    (default 60; 0 disables). The next table re-allocates them (counted).
//  * use/open/trim counters and timestamps for the cold/warm reports.
struct EvGpu {
  // Written under mu; atomics so schedulers can read them without waiting for the lock.
  std::mutex mu; CudaScore dev; std::atomic<bool> attempted{false}, ok{false}, verified{false}, opening{false}; std::string reason = "not probed";
  std::atomic<double> cpuNsPerEval{0}, gpuNsPerEval{0};   // measured on the verification table
  std::atomic<double> gpuBatchFixedSec{0};                // 4.3: measured fixed cost of one batch (launch + sync), EWMA
  std::atomic<double> openSeconds{0};          // measured CUDA start-up (library, primary context, module)
  std::atomic<int> opens{0}, disables{0};
  std::atomic<long long> uses{0}, idleReleases{0}, asyncOpens{0}, verifications{0};
  std::atomic<long long> lastUseNs{0};
  CudaError lastError;                          // last driver/budget failure (copied from dev.error)
  std::thread opener, janitor; std::mutex jmu; std::condition_variable jcv; bool stopping = false;
  double idleReleaseSec = [] { const char *e = std::getenv("EM_GPU_IDLE_RELEASE_S"); const double v = e ? std::atof(e) : 60.0; return v >= 0 && v < 1e7 ? v : 60.0; }();
  static EvGpu &get() { static EvGpu g; return g; }
  static long long monoNs() { return std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
  void touch() { uses++; lastUseNs = monoNs(); }
  bool open() {   // call with mu held
    if (!attempted) {
      const auto t0 = std::chrono::steady_clock::now();
      const bool r = dev.open(); reason = dev.info.reason; opens++;
      openSeconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      bool good = r;
      if (good && !dev.hasBoards()) { good = false; reason = "embedded CUDA module lacks the board_scores kernel"; }
      if (!good && dev.error.set) lastError = dev.error;
      ok = good; attempted = true;   // published last: readers of `attempted` see a final `ok`
      if (good) startJanitor();
    }
    return ok;
  }
  // 4.3: start-up on a background thread; returns at once. Safe to call repeatedly.
  void openAsync() {
    bool expected = false;
    if (attempted || !opening.compare_exchange_strong(expected, true)) return;
    std::lock_guard<std::mutex> g(jmu);
    if (opener.joinable() || stopping) { opening = false; return; }
    asyncOpens++;
    try { opener = std::thread([this] { { std::lock_guard<std::mutex> l(mu); open(); } opening = false; }); }
    catch (...) { opening = false; }
  }
  void startJanitor() {   // with mu held, after a successful open
    if (!(idleReleaseSec > 0)) return;
    std::lock_guard<std::mutex> g(jmu);
    if (janitor.joinable() || stopping) return;
    try {
      janitor = std::thread([this] {
        std::unique_lock<std::mutex> l(jmu);
        while (!stopping) {
          jcv.wait_for(l, std::chrono::milliseconds((long long)std::clamp(idleReleaseSec * 250.0, 20.0, 1000.0)));
          if (stopping) break;
          const long long idle = monoNs() - lastUseNs.load();
          if (idle < (long long)(idleReleaseSec * 1e9) || lastUseNs.load() == 0) continue;
          l.unlock();
          { std::unique_lock<std::mutex> d(mu, std::try_to_lock); if (d.owns_lock() && dev.heldBytes() && monoNs() - lastUseNs.load() >= (long long)(idleReleaseSec * 1e9)) { dev.releaseBuffers(); idleReleases++; } }
          l.lock();
        }
      });
    } catch (...) {}
  }
  void disable(const std::string &why) { ok = false; reason = why; disables++; dev.releaseBuffers(); }
  ~EvGpu() {
    { std::lock_guard<std::mutex> g(jmu); stopping = true; }
    jcv.notify_all();
    if (opener.joinable()) opener.join();
    if (janitor.joinable()) janitor.join();
  }
};
// 4.3: process-wide measured CPU cost of one seat-board evaluation in a fused
// table chunk (score + full-seat pattern), per thread (EWMA over chunks).
inline std::atomic<double> &cpuFusedNsPerEval() { static std::atomic<double> v{0}; return v; }
inline void noteRate(std::atomic<double> &r, double sample) { if (!(sample > 0) || !std::isfinite(sample)) return; double cur = r.load(); const double next = cur > 0 ? 0.8 * cur + 0.2 * sample : sample; r.store(next); }
// 4.3: Automatic-mode cost model (pure; unit-tested in tests/table43.cpp).
// Times are end to end for ONE table:
//   CPU   tCpu = evals * cpuNs / threads   (threads that can score this table: the
//         owner, spawned helpers and other workers needing it)
//   GPU   one batch: tBatch = fixed + min(evals, batchEvals) * gpuNs  (upload, kernel,
//         download, synchronise; measured on the verification batch)
// The device PULLS batches while the CPU threads pull chunks, so enabling it can
// only shorten the table if one batch finishes well before the CPU alone would:
// Gpu when tCpu > 1.25 * tBatch. Verification (65,536 boards scored on both and
// compared bit for bit; the CPU half is useful work) is attempted when
// tCpu > 2 * tBatch with a conservative unmeasured GPU estimate. Start-up is
// never paid inside a table: once the process has spent `initEstimateSec` on CPU
// tables (ski rental), the device is opened in the BACKGROUND (StartOpen; this
// table stays on the CPU). A device being opened or held by another table leaves
// the table to the CPU (no waiting in Automatic).
enum class Auto43 { CpuSmall, CpuWarmup, StartOpen, CpuOpening, CpuUnavailable, CpuBusy, Verify, Gpu, CpuSlower };
struct Auto43In {
  double evals = 0; int threads = 1; double cpuNs = 0;
  bool attempted = false, opening = false, available = false, verified = false, busy = false;
  double gpuNs = 0, fixedSec = 0, cpuTableSeconds = 0, initEstimateSec = 0.1;
  double smallEvals = 262144, batchEvals = 131072.0 * 8;
};
inline double auto43CpuSeconds(const Auto43In &a) { const double ns = a.cpuNs > 0 ? a.cpuNs : 20.0; return a.evals * ns * 1e-9 / std::max(1, a.threads); }
inline double auto43BatchSeconds(const Auto43In &a, bool measured) {
  const double ns = measured && a.gpuNs > 0 ? a.gpuNs : 4.0, fixed = measured && a.fixedSec > 0 ? a.fixedSec : 0.0005;
  return fixed + std::min(a.evals, a.batchEvals) * ns * 1e-9;
}
inline Auto43 autoChoice43(const Auto43In &a) {
  if (a.evals < a.smallEvals) return Auto43::CpuSmall;
  if (a.attempted && !a.available) return Auto43::CpuUnavailable;
  if (!a.attempted) return a.opening ? Auto43::CpuOpening : a.cpuTableSeconds >= a.initEstimateSec ? Auto43::StartOpen : Auto43::CpuWarmup;
  if (a.busy) return Auto43::CpuBusy;
  const double tCpu = auto43CpuSeconds(a);
  if (!a.verified) return tCpu > 2 * auto43BatchSeconds(a, false) ? Auto43::Verify : Auto43::CpuSlower;
  return tCpu > 1.25 * auto43BatchSeconds(a, true) ? Auto43::Gpu : Auto43::CpuSlower;
}
// ============================================================================
// 4.4: Automatic mode chooses HOW a warm device is used from measured end-to-end
// table times, not from a model.
//
// WHY (physical RTX 4060 Ti + 24-thread i7 report of 4.3, validation/4.3). With a
// warm device the complete action-EV request took, CPU / hybrid pull / GPU-preferred:
//   1 thread 48.4 / 29.8 / 28.3 ms, 4 threads 19.6 / 15.1 / 14.0 ms,
//   8 threads 14.7 / 13.4 / 12.0 ms, 24 threads 12.6 / 13.3 / 12.8 ms.
// 4.3 Automatic, once warm, always used the pull split (its "after idle" step:
// 35.5 ms at 1 thread where GPU-preferred took 28.3 ms) and decided CPU-vs-device
// from a linear threads model that the hybrid P/E-core CPU does not follow.
//
// RULE. Three ways ("arms") to build one eligible table when the device is open,
// verified and free:
//   Cpu           CPU threads score and count patterns (fused chunks)
//   GpuPull       device pulls batches, CPU threads pull chunks (4.3 Automatic)
//   GpuPreferred  device scores every chunk, CPU threads only count patterns
// For each (thread budget, table size) class the process keeps an exponentially
// weighted mean of the measured build time per seat-board evaluation of every arm
// (whole table: scoring, transfers, synchronisation, pattern counting, waiting).
// An arm with fewer than MIN_SAMPLES measurements is tried first (device arms
// first; the CPU has usually been measured during warm-up). After that the arm
// with the lowest mean is used; 2 of every PROBE_EVERY decisions re-measure the
// other arms so that a change (other load, idle buffers released) is noticed; an
// arm measured more than 3x slower than the best is re-measured 8x less often. A device
// arm is never used for a table that 4.3's eligibility rule keeps on the CPU
// (small tables, device not open/verified/free), and a table whose device part
// failed or fell back is not recorded. The choice never changes results: every
// arm produces the same integer scores (verified bit for bit once per process).
// Regret is bounded: at most MIN_SAMPLES tables per arm and class to learn, then
// 2 of every PROBE_EVERY tables on a non-best arm.
// ============================================================================
enum class Arm44 { Cpu = 0, GpuPull = 1, GpuPreferred = 2 };
inline const char *armName(int a) { return a == 0 ? "cpu" : a == 1 ? "gpuPull" : "gpuPreferred"; }
struct ArmStats44 {
  static constexpr int MIN_SAMPLES = 2, PROBE_EVERY = 32;
  double mean[3] = {0, 0, 0}; long long n[3] = {0, 0, 0}, decisions = 0, chosen[3] = {0, 0, 0};
  void record(Arm44 arm, double secondsPerEval) {
    if (!(secondsPerEval > 0) || !std::isfinite(secondsPerEval)) return;
    const int a = (int)arm; mean[a] = n[a] ? 0.7 * mean[a] + 0.3 * secondsPerEval : secondsPerEval; n[a]++;
  }
  // Pure decision for the next table of this class (does not modify the statistics).
  Arm44 choose() const {
    if (n[2] < MIN_SAMPLES) return Arm44::GpuPreferred;
    if (n[1] < MIN_SAMPLES) return Arm44::GpuPull;
    if (n[0] < MIN_SAMPLES) return Arm44::Cpu;
    int order[3] = {0, 1, 2};
    std::sort(order, order + 3, [&](int x, int y) { return mean[x] != mean[y] ? mean[x] < mean[y] : x < y; });
    const long long phase = decisions % PROBE_EVERY;
    // An arm measured more than 3x slower than the best is re-measured 8x less often.
    const bool rare = (decisions / PROBE_EVERY) % 8 == 7;
    auto worth = [&](int arm) { return rare || mean[arm] <= 3 * mean[order[0]]; };
    if (phase == PROBE_EVERY / 2 && worth(order[1])) return (Arm44)order[1];
    if (phase == PROBE_EVERY - 1 && worth(order[2])) return (Arm44)order[2];
    return (Arm44)order[0];
  }
  Arm44 next() { const Arm44 a = choose(); decisions++; chosen[(int)a]++; return a; }
  int best() const { int b = -1; for (int a = 0; a < 3; a++) if (n[a] && (b < 0 || mean[a] < mean[b])) b = a; return b; }
};
// Process-wide statistics per (thread budget, log2 table evaluations) class.
struct AutoArms44 {
  std::mutex mu; std::map<std::pair<int, int>, ArmStats44> cls;
  static AutoArms44 &get() { static AutoArms44 a; return a; }
  static std::pair<int, int> key(int threads, double evals) { return {std::clamp(threads, 1, 256), (int)std::floor(std::log2(std::max(1.0, evals)))}; }
  Arm44 next(int threads, double evals) { std::lock_guard<std::mutex> g(mu); return cls[key(threads, evals)].next(); }
  void record(int threads, double evals, Arm44 arm, double seconds) { std::lock_guard<std::mutex> g(mu); cls[key(threads, evals)].record(arm, seconds / std::max(1.0, evals)); }
  void reset() { std::lock_guard<std::mutex> g(mu); cls.clear(); }
};
// 4.2: failure classes. A request that does not fit the GPU budget or the VRAM
// reserve, or a driver out-of-memory result, only sends THAT table to the CPU;
// any other driver failure (invalid context, launch failure, failed copy) or a
// CPU/GPU mismatch disables the device for the process.
inline bool cudaTransient(const CudaError &e) { return e.code == CudaScore::EM_BUDGET || e.code == CudaScore::EM_RESERVE || e.code == 2 /* CUDA_ERROR_OUT_OF_MEMORY */; }
// 4.2: Automatic-mode decision (a pure function, unit-tested in tests/schedule42.cpp).
//  * tables below `smallEvals` seat-board evaluations stay on the CPU: fixed
//    upload/launch/download/synchronise costs exceed the saving;
//  * the device is OPENED only after this process has already spent at least
//    the expected CUDA start-up time (`initEstimateSec`, or the measured value)
//    scoring tables on the CPU ("ski rental": a run that ends before that never
//    pays the start-up, a longer one pays at most about twice the optimum);
//  * once open and verified it is used only if measured at least 10% faster
//    than one CPU worker end to end on the verification table (the GPU serves
//    one table while the other workers continue on the CPU);
//  * a busy device leaves the table to the CPU.
enum class AutoChoice { CpuSmall, CpuWarmup, OpenAndVerify, Gpu, CpuSlower, CpuUnavailable };
struct AutoInputs { double tableEvals; bool attempted, available, verified; double gpuNs, cpuNs, cpuTableSeconds, initEstimateSec; double smallEvals = 262144; };
inline AutoChoice autoChoice(const AutoInputs &a) {
  if (a.tableEvals < a.smallEvals) return AutoChoice::CpuSmall;
  if (a.attempted && !a.available) return AutoChoice::CpuUnavailable;
  if (!a.attempted) return a.cpuTableSeconds >= a.initEstimateSec ? AutoChoice::OpenAndVerify : AutoChoice::CpuWarmup;
  if (!a.verified) return AutoChoice::OpenAndVerify;
  return a.gpuNs > 0 && a.cpuNs > 0 && a.gpuNs < 0.9 * a.cpuNs ? AutoChoice::Gpu : AutoChoice::CpuSlower;
}
// Process-wide CPU time spent scoring EV tables (input of the warm-up rule).
inline std::atomic<long long> &cpuTableNanos() { static std::atomic<long long> v{0}; return v; }
enum class Device { Auto, Cpu, Gpu, Hybrid };
inline const char *deviceName(Device d) { return d == Device::Cpu ? "cpu" : d == Device::Gpu ? "gpu" : d == Device::Hybrid ? "hybrid" : "auto"; }
struct ShowdownStats {
  std::atomic<long long> tables{0}, boards{0}, cpuBoards{0}, gpuBoards{0}, gpuTables{0}, hybridTables{0}, patternSets{0}, directTerminals{0}, gpuFailures{0}, reused{0};
  // 4.1: why each new table was scored where it was (auto/hybrid scheduling transparency)
  std::atomic<long long> cpuForced{0}, cpuSmall{0}, cpuSlower{0}, cpuUnavailable{0}, cpuBusy{0}, cpuAfterFailure{0}, verificationBoards{0};
  std::atomic<long long> gpuPeakBytes{0};   // largest device allocation observed during the request
  // 4.2: warm-up decisions, transient refusals, and per-phase time (nanoseconds, summed over workers)
  std::atomic<long long> cpuWarmup{0}, gpuTransient{0}, gpuWaitTimeouts{0};
  // 4.3: shared tables, cooperative construction and the background device start-up
  std::atomic<long long> autoArm[3] = {}, cpuMeasuredFaster{0};   // 4.4: Automatic arm decisions of this request
  std::atomic<long long> sharedTableHits{0}, tableWaits{0}, nsTableWait{0}, helperThreads{0}, cpuOpening{0}, gpuBackgroundOpens{0}, gpuBatches{0}, patternChunksForGpu{0};
  std::atomic<long long> nsCpuTables{0}, nsPatterns{0}, nsGpuOpen{0}, nsGpuVerify{0}, nsGpuUploadLaunch{0}, nsGpuDownload{0}, nsGpuLockWait{0};
  std::mutex mu; std::string gpuNote; std::vector<CudaError> errors; std::vector<int> errorFallback;
  void note(const std::string &s) { std::lock_guard<std::mutex> g(mu); if (gpuNote.empty()) gpuNote = s; }
  void error(const CudaError &e, bool cpuFallback) { std::lock_guard<std::mutex> g(mu); if (errors.size() < 8) { errors.push_back(e); errorFallback.push_back(cpuFallback ? 1 : 0); } }
};
// 4.3: flat open-addressing histogram of pattern codes (codes use <= 24 bits, so
// 0xFFFFFFFF marks an empty slot). Replaces std::unordered_map in the hot loop.
struct FlatHist {
  std::vector<uint32_t> key, val; size_t used = 0;
  explicit FlatHist(size_t slots = 64) { key.assign(slots, 0xFFFFFFFFu); val.assign(slots, 0); }   // power of two
  static inline uint32_t h(uint32_t x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; return x ^ (x >> 16); }
  inline void add(uint32_t code, uint32_t c = 1) {
    size_t mask = key.size() - 1, i = h(code) & mask;
    while (key[i] != code) { if (key[i] == 0xFFFFFFFFu) { if (2 * (used + 1) > key.size()) { grow(); add(code, c); return; } key[i] = code; used++; break; } i = (i + 1) & mask; }
    val[i] += c;
  }
  void grow() {
    std::vector<uint32_t> k2(key.size() * 2, 0xFFFFFFFFu), v2(key.size() * 2, 0); const size_t mask = k2.size() - 1;
    for (size_t i = 0; i < key.size(); i++) if (key[i] != 0xFFFFFFFFu) { size_t j = h(key[i]) & mask; while (k2[j] != 0xFFFFFFFFu) j = (j + 1) & mask; k2[j] = key[i]; v2[j] = val[i]; }
    key.swap(k2); val.swap(v2);
  }
  template <class F> void each(F &&f) const { for (size_t i = 0; i < key.size(); i++) if (key[i] != 0xFFFFFFFFu) f(key[i], val[i]); }
  void clear() { std::fill(key.begin(), key.end(), 0xFFFFFFFFu); std::fill(val.begin(), val.end(), 0u); used = 0; }
  void swap(FlatHist &o) { key.swap(o.key); val.swap(o.val); std::swap(used, o.used); }
};
// 4.3: tables are shared by every worker (and every response-gain seat) of a
// request through TableCache below, so a table is built once per request instead
// of once per worker (the RTX 4060 Ti report: 753,984 boards scored for a
// 376,992-board exact EV on >= 2 threads; 3,015,936 for 8-seat response gains).
// `scores`, the board/deck fields and `full` (the full-seat pattern histogram,
// built during scoring) are immutable once `ready`; subset histograms are added
// under `histMu` to a list (stable references for concurrent readers).
struct ShowTable {
  uint64_t used = 0; int len = -1, n = 0; int prefix[5] = {}; int holes[16] = {}; unsigned long long boards = 0;
  int deck[52] = {}; int deckCount = 0; std::atomic<long long> stamp{0}; std::atomic<long long> charged{0};
  std::vector<int32_t> scores;
  struct Hist { uint32_t mask; std::vector<std::pair<uint32_t, uint32_t>> patterns; };
  std::mutex histMu; std::list<Hist> hist;   // stable references; no allocation while empty
  bool matches(uint64_t u, int l, const int *cards, const int *h, int nn) const {
    if (len != l || used != u || n != nn) return false;
    for (int i = 0; i < l; i++) if (prefix[i] != cards[i]) return false;
    for (int i = 0; i < 2 * nn; i++) if (holes[i] != h[i]) return false;
    return true;
  }
  // ---- 4.3 cooperative construction state ----
  static constexpr unsigned long long CHUNK = 16384;
  enum : uint8_t { C_FREE = 0, C_SCORING = 1, C_SCORED = 2, C_PATTERN = 3, C_DONE = 4 };
  unsigned long long chunks = 0;
  std::unique_ptr<std::atomic<uint8_t>[]> chunkState;
  std::atomic<unsigned long long> nextChunk{0};      // score-claim counter (may run past `chunks`)
  std::atomic<unsigned long long> chunksDone{0};
  std::atomic<int> participants{0};
  std::atomic<bool> cpuMayScore{true}, abort{false}, failed{false}, ready{false};
  std::mutex buildMu; std::condition_variable buildCv;
  std::vector<std::pair<uint32_t, uint32_t>> fullMerged;   // merged under buildMu, sorted at finalisation
  FlatHist fullAcc;                                        // merge accumulator (buildMu)
};
// 4.3: dense rank code of ALL n seats (3 bits per seat, seat order): rank = number
// of distinct scores strictly above the seat's score. Identical to
// rankPattern(sc, {0..n-1}, n) (tested in tests/table43.cpp), branch-free.
inline uint32_t fullPattern(const int32_t *sc, int n) {
  int first[8];   // 1 if seat j holds the first occurrence of its score
  for (int j = 0; j < n; j++) { int f = 1; for (int k = 0; k < j; k++) f &= sc[k] != sc[j]; first[j] = f; }
  uint32_t code = 0;
  for (int i = 0; i < n; i++) {
    int r = 0; const int32_t v = sc[i];
    for (int j = 0; j < n; j++) r += first[j] & (sc[j] > v);
    code |= (uint32_t)r << (3 * i);
  }
  return code;
}
// 4.3: request-wide table cache. Shared (shared_ptr) by the request's EvShared
// and every per-seat child, so all workers of one request reuse one table.
// Memory is charged to the request's root control; a table is evicted only when
// nobody else holds it (use_count) and it is not being built.
struct TableCache {
  std::mutex mu; std::vector<std::shared_ptr<ShowTable>> tables; std::atomic<long long> stamp{0};   // LRU clock (also bumped outside mu)
  EvControl *ctl = nullptr;            // request root control (memory charges)
  std::atomic<int> threadBudget{1};    // effective threads of the request
  std::atomic<int> workers{1};         // top-level workers currently running (parallelFor)
  std::atomic<long long> shared{0}, built{0}, helpersSpawned{0}, waitNs{0};
  // 4.8: countCap (when nonzero) replaces the count cap. The private cache of small tables
  // (fewer boards than one chunk: flop and turn all-in runouts) had the 4.3 cap of 4 tables, but
  // an exact best response visits the tables of every opponent-hand tuple at every all-in node
  // in turn (32 tuples in the six-player flop study, 243 in the weighted one), so the LRU evicted and rebuilt them over
  // and over (35% of the run). Bytes stay governed by makeRoom/tryCharge (the request budget).
  size_t countCap = 0;
  size_t maxTables() const { return countCap ? countCap : (size_t)std::max(4, 3 * std::max(1, workers.load())); }
  // 4.8: usedKeys[i] == tables[i]->used, kept in step by push()/eraseAt(); find() scans this
  // contiguous array and dereferences a table only on a key hit (1,024 small tables are scanned
  // in a few microseconds instead of 1,024 cache misses). Same table found as by 4.7's scan.
  std::vector<uint64_t> usedKeys;
  void syncKeys() { if (usedKeys.size() != tables.size()) { usedKeys.clear(); for (auto &t : tables) usedKeys.push_back(t->used); } }   // tables pushed directly (tests)
  std::shared_ptr<ShowTable> find(uint64_t u, int l, const int *cards, const int *h, int nn) {
    syncKeys();
    for (size_t i = 0; i < usedKeys.size(); i++) if (usedKeys[i] == u && tables[i]->matches(u, l, cards, h, nn)) { tables[i]->stamp = ++stamp; return tables[i]; }
    return nullptr;
  }
  void push(const std::shared_ptr<ShowTable> &t) { syncKeys(); tables.push_back(t); usedKeys.push_back(t->used); }
  void eraseAt(size_t i) { syncKeys(); tables.erase(tables.begin() + (long)i); usedKeys.erase(usedKeys.begin() + (long)i); }
  bool eraseTable(const std::shared_ptr<ShowTable> &t) { for (size_t i = 0; i < tables.size(); i++) if (tables[i] == t) { ctl->release(t->charged.load()); eraseAt(i); return true; } return false; }
  // Drops idle tables (not referenced elsewhere, not building) oldest first until `need`
  // bytes fit `budget` and the count cap holds. Call with mu held.
  bool makeRoom(long long need, long long budget) {
    for (;;) {
      const bool countOk = tables.size() < maxTables();
      if (countOk && ctl->tryCharge(need, budget)) return true;
      long long best = LLONG_MAX; size_t at = SIZE_MAX;
      for (size_t i = 0; i < tables.size(); i++) { auto &t = tables[i]; if (t.use_count() == 1 && (t->ready || t->failed) && t->stamp < best) { best = t->stamp; at = i; } }
      if (at == SIZE_MAX) { if (!countOk && ctl->tryCharge(need, budget)) return true; return false; }
      ctl->release(tables[at]->charged.load()); eraseAt(at);
    }
  }
  ~TableCache() { if (ctl) for (auto &t : tables) ctl->release(t->charged.load()); }
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
