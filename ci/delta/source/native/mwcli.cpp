// Command-line driver for the native multiway engine (tests and benchmarks).
// usage: mwcli <spec.json> <iterations> <threads> <out.state> [memoryMiB] [in.state]
//        mwcli --node|--ev|--gain spec.json state request.json [memoryMiB]
//        mwcli --session spec.json state plan.json   (4.3) several EV / response-gain requests in ONE
//              process: cold vs warm CUDA, sequential, concurrent, idle, cancelled, budget-refused runs
//        mwcli --cuda-info            CUDA device probe (JSON)
//        mwcli --state-info state    (4.6) header fields, size, SHA-256 of file and body
//        mwcli --verify spec.json state [key=value ...]          (4.7) strategy-quality report (modes A-D)
//        mwcli --compare specA.json stateA stateB [key=value ...] (4.7) checkpoint comparison
//        mwcli --monitor spec.json out-dir [key=value ...]       (4.7) training with adaptive quality monitoring
//        mwcli --compress in.state out.emz [level] | --decompress in.emz out.state   (4.7) lossless EMZ1
//        (4.7) every command that reads a checkpoint also accepts an EMZ1 file)
//        mwcli --continuation-suite spec.json work-dir [quick|standard|full] [threads]   (4.6)
//        mwcli --selftest510 studies-dir work-dir [all|estimator|training|checkpoint|limits]   (5.10) the experimental estimator "rbes"
//              against exact targets, the default trainer against the states of 5.9, checkpoint rules of the estimator, refused
//              configurations and the table limit ("Run 5.10 focused validation.bat")
//        mwcli --estimator-check spec.json updates deals [seed]   (5.10) the exact expectation of the rbes estimator's increments
//              against a brute-force walk of the whole betting tree, on the tables after `updates` updates
//        mwcli --selftest59 studies-dir work-dir [all|engine|statistics|response]   (5.9) the confidence statements of the trained
//              response, the counter-based evaluation streams, the response summary against exact values ("Run 5.9 Windows validation.bat")
//        mwcli --streams59 seed seat block purpose count   (5.9) the numbers of one evaluation stream, for independent implementations
//        mwcli --selftest58 studies-dir work-dir [all|engine|response|limits]   (5.8) trained response against exact values, the
//              large-study limit refused before training, the ICM cache, evaluation random numbers ("Run 5.8 Windows validation.bat")
//        mwcli --selftest571 studies-dir work-dir [all|checkpoint|memory] [keep]   (5.7.1) checkpoint corruption, previous-generation
//              recovery and process-memory-budget checks ("Run 5.7.1 focused validation.bat")
//        mwcli --selftest49 fixtures-dir work-dir   (4.9) compressed-checkpoint restoration checks ("Run 4.9 checks.bat")
//        mwcli --selftest48 fixtures-dir work-dir   (4.8) recorded checks of the 4.8 changes ("Run 4.8 checks.bat")
//        exit codes of training: 0 ok, 1 engine/refused input, 2 usage, 3 input checkpoint unreadable, 4 save failed
//        mwcli --study fixture.json out.json [key=value ...]   (5.2) decision study: action frequencies, EVs, EV gap,
//              quality metric, time and memory per seed and budget, sensitivity across the fixture's variants
//        mwcli --response spec.json state request.json [memoryMiB]   (5.8) trained response per seat: a lower bound of each
//              seat's best-response gain, measured on independent deals (and exactly on small games)
//              (5.9) with a simultaneous distribution-free lower bound of NashConv over the seats (summary.simultaneous)
//        mwcli --equity <spec.json>   exact all-in equity {hands,board,device:cpu|gpu|both,threads,gpuMiB}
// Prints mw_info JSON plus "seconds" (training wall time) on stdout.
#include "mw.h"
#include <cstring>
#ifndef EM_BUILD_ID
#define EM_BUILD_ID "development"
#endif
#ifndef EM_VERSION
#define EM_VERSION "development"
#endif
#include <chrono>
#include <atomic>
#include <thread>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <string>
#include <initializer_list>
#include <functional>
#include "state_file.hpp"
#include "ckpt_suite.hpp"
static std::vector<unsigned char> slurp(const char *f) {
  std::vector<unsigned char> b; FILE *fp = std::fopen(f, "rb"); if (!fp) return b;
  unsigned char tmp[65536]; size_t n; while ((n = std::fread(tmp, 1, sizeof tmp, fp)) > 0) b.insert(b.end(), tmp, tmp + n);
  std::fclose(fp); return b;
}
#include <cerrno>
#include <cmath>
#ifdef _WIN32
#define PSAPI_VERSION 2
#include <windows.h>
#include <psapi.h>
#else
#include <sys/resource.h>
#endif
// 3.3: peak resident memory of the whole process (tables, scratch, allocator and runtime).
static double peakRssMiB() {
#ifdef _WIN32
  PROCESS_MEMORY_COUNTERS pmc; if (K32GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof pmc)) return pmc.PeakWorkingSetSize / 1048576.0;
  return -1;
#else
  struct rusage ru; if (!getrusage(RUSAGE_SELF, &ru)) return ru.ru_maxrss / 1024.0;
  return -1;
#endif
}
static bool wholeArg(const char *s, long long lo, long long hi, long long &out) {
  if (!s || !*s) return false;
  char *end = nullptr; errno = 0;
  const long long v = std::strtoll(s, &end, 10);
  if (errno || *end || v < lo || v > hi) return false;
  out = v; return true;
}
static bool numberArg(const char *s, double &out) {
  if (!s || !*s) return false;
  char *end = nullptr; errno = 0;
  const double v = em_parse_double(s, &end);   // 4.5: correctly rounded on every platform
  if (errno || *end || !std::isfinite(v) || !(v > 0) || v > 65536) return false;
  out = v; return true;
}

// ---- 4.3: in-process session (cold/warm CUDA measurements) ----
static void jvWrite(JB *o, const JV *v) {
  if (!v || v->type == J_NULL) { jb_puts(o, "null"); return; }
  if (v->type == J_BOOL) { jb_puts(o, v->num != 0 ? "true" : "false"); return; }
  if (v->type == J_NUM) { jb_printf(o, "%.17g", v->num); return; }
  if (v->type == J_STR) { jb_str(o, v->str); return; }
  jb_putc(o, v->type == J_ARR ? '[' : '{');
  for (int i = 0; i < v->n; i++) { if (i) jb_putc(o, ','); if (v->type == J_OBJ) { jb_str(o, v->keys[i]); jb_putc(o, ':'); } jvWrite(o, v->items[i]); }
  jb_putc(o, v->type == J_ARR ? ']' : '}');
}
static std::string jvText(const JV *v) { JB b; jb_init(&b); jvWrite(&b, v); std::string s(b.s ? b.s : "", b.n); jb_free(&b); return s; }
static const JV *jpath(const JV *v, std::initializer_list<const char *> keys) { for (const char *k : keys) { if (!v || v->type != J_OBJ) return nullptr; v = jget(v, k); } return v; }
#include "emz.hpp"   // 4.7: optional lossless compressed checkpoints (EMZ1)
#include "temp_file.hpp"   // 4.9: secure anonymous temporary files
// 4.7: opens a checkpoint for reading. An EMZ1 file is decompressed and fully verified into an
// anonymous temporary file first (bounded memory); `size` is the EMMW4 size. Returns nullptr
// and sets `why` on failure.
static FILE *openCheckpoint(const char *path, uint64_t &size, std::string &why) {
  FILE *f = std::fopen(path, "rb"); if (!f) { why = std::strerror(errno); return nullptr; }
  unsigned char magic[8] = {}; const size_t got = std::fread(magic, 1, 8, f); std::rewind(f);
  std::error_code ec; size = std::filesystem::file_size(path, ec); if (ec) { why = ec.message(); std::fclose(f); return nullptr; }
  if (got < 8 || !emz::isEMZ(magic, 8)) return f;
  // 4.9: a secure anonymous temporary file (native/temp_file.hpp) instead of std::tmpfile(), which on
  // Windows (msvcrt) is created in the root of the drive and failed for standard accounts.
  std::string tmpWhy; const std::string hint = std::filesystem::path(path).parent_path().string();
  FILE *t = emtmp::openAnonymous(hint, tmpWhy); if (!t) { why = "cannot create a temporary file for decompression (tried: " + tmpWhy + ")"; std::fclose(f); return nullptr; }
  uint64_t maxRaw = 16ULL << 30; if (const char *e = std::getenv("EM_EMZ_MAX_MIB")) { const double v = std::atof(e); if (v > 0) maxRaw = (uint64_t)(v * 1048576.0); }
  const emz::Result r = emz::decompress(f, t, maxRaw); std::fclose(f);
  if (!r.ok) { why = "compressed checkpoint: " + r.error; std::fclose(t); return nullptr; }
  std::fflush(t); std::rewind(t); size = r.rawBytes; return t;
}
static std::vector<unsigned char> slurpCheckpoint(const char *path) {
  uint64_t size = 0; std::string why; FILE *f = openCheckpoint(path, size, why); std::vector<unsigned char> b; if (!f) return b;
  b.resize((size_t)size); if (size && std::fread(b.data(), 1, (size_t)size, f) != size) b.clear(); std::fclose(f); return b;
}
#include "mwcli_analytics.hpp"   // 4.7: --verify, --compare, --monitor
#include "mwcli_selftest47.hpp"  // 4.7: --selftest47
#include "mwcli_selftest48.hpp"  // 4.8: --selftest48
#include "mwcli_selftest49.hpp"  // 4.9: --selftest49 (EMZ1 restoration)
#include "mwcli_selftest57.hpp"  // 5.7: --selftest57 (parallel training, evaluator path tree)
#include "mwcli_selftest571.hpp" // 5.7.1: --selftest571 (checkpoint integrity and the process memory budget)
#include "mwcli_study52.hpp"     // 5.2: --study (decision studies)
#include "response_stats59.hpp"   // 5.9: simultaneous confidence statements of the trained response
#include "mwcli_response59.hpp"  // 5.8, 5.9: --response (trained response: a lower bound of best-response gains in large games)
#include "mwcli_selftest58.hpp"  // 5.8: --selftest58 (trained response, large-study limit, ICM cache, evaluation random numbers)
#include "mwcli_selftest59.hpp"  // 5.9: --selftest59 (confidence statements, counter-based evaluation streams, the response summary against exact values)
#include "mwcli_selftest510.hpp" // 5.10: --selftest510 (the experimental estimator against exact targets, golden states of both trainers, checkpoint rules, limits)
#include "mwcli_selftest511.hpp" // 5.11: --selftest511 (the counter-based training streams: generator, addresses, counter audit, golden states, checkpoint rules, limits)
static int runSession(MW *m, const JV *plan) {
  const JV *base = jget(plan, "request"), *steps = jget(plan, "steps"); const char *mode = jstr(jget(plan, "mode"));
  if (!base || base->type != J_OBJ || !steps || steps->type != J_ARR) { std::fprintf(stderr, "error: plan needs request (object) and steps (array)\n"); return 2; }
  const bool gain = mode && !std::strcmp(mode, "gain");
  auto *query = gain ? mw_response_gain : mw_action_ev;
  if (jget(plan, "prewarm") && jget(plan, "prewarm")->num != 0) mw_gpu_prewarm();
  JB out; jb_init(&out); jb_printf(&out, "{\"tool\":\"mwcli session 4.3\",\"build\":\"%s\",\"mode\":\"%s\",\"steps\":[", EM_BUILD_ID, gain ? "gain" : "ev");
  std::string reference; int failures = 0; const auto s0 = std::chrono::steady_clock::now();
  for (int si = 0; si < steps->n; si++) {
    const JV *st = steps->items[si]; const char *label = jstr(jget(st, "label"));
    const int repeat = (int)jnum(jget(st, "repeat"), 1), conc = (int)jnum(jget(st, "concurrent"), 1);
    const long long idleMs = (long long)jnum(jget(st, "idleMs"), 0), cancelAfter = (long long)jnum(jget(st, "cancelAfterMs"), -1);
    const JV *rq = jget(st, "request"); const std::string text = jvText(rq && rq->type == J_OBJ ? rq : base);
    if (idleMs > 0) std::this_thread::sleep_for(std::chrono::milliseconds(idleMs));
    jb_printf(&out, "%s{\"label\":", si ? "," : ""); jb_str(&out, label ? label : ""); jb_printf(&out, ",\"concurrent\":%d,\"idleMsBefore\":%lld,\"runs\":[", conc, idleMs);
    for (int r = 0; r < repeat; r++) {
      mw_ev_cache_clear(m);
      struct One { JB j; int status = 0; double ms = 0, cancelMs = -1; char err[512] = ""; volatile int cancel = 0; };
      std::vector<One> runs((size_t)std::max(1, conc));
      const auto w0 = std::chrono::steady_clock::now();
      std::vector<std::thread> pool;
      for (auto &x : runs) { jb_init(&x.j); }
      auto body = [&](One &x) {
        std::atomic<bool> done{false}; std::thread canceller; std::chrono::steady_clock::time_point raised{};
        if (cancelAfter >= 0) canceller = std::thread([&] { const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(cancelAfter);
          while (!done.load() && std::chrono::steady_clock::now() < until) std::this_thread::sleep_for(std::chrono::microseconds(200));
          if (!done.load()) { raised = std::chrono::steady_clock::now(); __atomic_store_n(&x.cancel, 1, __ATOMIC_RELAXED); } });
        const auto q0 = std::chrono::steady_clock::now();
        x.status = query(m, text.c_str(), text.size(), &x.j, x.err, sizeof x.err, &x.cancel);
        const auto q1 = std::chrono::steady_clock::now(); done = true; if (canceller.joinable()) canceller.join();
        x.ms = std::chrono::duration<double, std::milli>(q1 - q0).count();
        if (raised != std::chrono::steady_clock::time_point{}) x.cancelMs = std::chrono::duration<double, std::milli>(q1 - raised).count();
      };
      for (size_t i = 1; i < runs.size(); i++) pool.emplace_back(body, std::ref(runs[i]));
      body(runs[0]); for (auto &t : pool) t.join();
      const double wall = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - w0).count();
      jb_printf(&out, "%s{\"wallMs\":%.3f,\"results\":[", r ? "," : "", wall);
      for (size_t i = 0; i < runs.size(); i++) {
        One &x = runs[i]; jb_printf(&out, "%s{\"status\":%d,\"queryMs\":%.3f", i ? "," : "", x.status, x.ms);
        if (x.cancelMs >= 0) jb_printf(&out, ",\"cancelLatencyMs\":%.3f", x.cancelMs);
        if (x.status == 200) {
          char e2[256] = ""; JV *res = json_parse(x.j.s, x.j.n, e2, sizeof e2);
          if (res) {
            const JV *ex = jget(res, "execution"); std::string values;
            if (gain) { const JV *seats = jget(res, "seats"); JB b; jb_init(&b); jb_putc(&b, '['); for (int k = 0; seats && k < seats->n; k++) { if (k) jb_putc(&b, ','); jvWrite(&b, jget(seats->items[k], "gain")); } jb_putc(&b, ']'); values.assign(b.s, b.n); jb_free(&b); }
            else { const JV *h = jget(res, "hands"); values = jvText(h && h->n ? jget(h->items[0], "ev") : nullptr); }
            if (reference.empty()) reference = values;
            const bool same = values == reference; if (!same) failures++;
            jb_puts(&out, ",\"values\":"); jb_puts(&out, values.c_str());
            // 4.4: the same values as IEEE 754 bit patterns (strings: no reader can re-round them)
            { JB b; jb_init(&b); jb_putc(&b, '[');
              if (gain) { const JV *seats = jget(res, "seats"); for (int k = 0; seats && k < seats->n; k++) { if (k) jb_putc(&b, ','); jvWrite(&b, jget(seats->items[k], "gainBits")); } }
              else { const JV *h = jget(res, "hands"); const JV *eb = h && h->n ? jget(h->items[0], "evBits") : nullptr; for (int k = 0; eb && k < eb->n; k++) { if (k) jb_putc(&b, ','); jvWrite(&b, eb->items[k]); } }
              jb_putc(&b, ']'); jb_puts(&out, ",\"valueBits\":"); jb_puts(&out, b.s); jb_free(&b); } jb_printf(&out, ",\"identicalToFirst\":%s", same ? "true" : "false");
            for (const char *k : {"observedDevice", "gpuBoards", "cpuBoards", "gpuErrors", "gpuNote"}) { if (const JV *v = jget(ex, k)) { jb_printf(&out, ",\"%s\":", k); jvWrite(&out, v); } }
            for (const char *k : {"profileSeconds", "scheduling", "tables43", "auto44"}) { if (const JV *v = jget(ex, k)) { jb_printf(&out, ",\"%s\":", k); jvWrite(&out, v); } }
            if (const JV *c = jpath(res, {"execution", "cuda"})) { jb_puts(&out, ",\"cuda\":"); jvWrite(&out, c); }
            json_free(res);
          }
        } else jb_puts(&out, ",\"error\":"), jb_str(&out, x.err);
        jb_putc(&out, '}'); jb_free(&x.j);
      }
      jb_puts(&out, "]}");
    }
    jb_puts(&out, "],\"gpuAfter\":"); mw_gpu_status(&out); jb_putc(&out, '}');
  }
  jb_printf(&out, "],\"sessionSeconds\":%.4f,\"mismatches\":%d}", std::chrono::duration<double>(std::chrono::steady_clock::now() - s0).count(), failures);
  std::printf("%.*s\n", (int)out.n, out.s); jb_free(&out);
  return failures ? 1 : 0;
}
int main(int argc, char **argv) {
  if (argc == 2 && !std::strcmp(argv[1], "--build-id")) { std::puts("EightMaxBuild=" EM_BUILD_ID); return 0; }
  if (argc == 2 && !std::strcmp(argv[1], "--cuda-info")) { JB j; jb_init(&j); mw_cuda_info(&j); std::printf("%.*s\n", (int)j.n, j.s); jb_free(&j); return 0; }
  if (argc == 3 && !std::strcmp(argv[1], "--equity")) {
    std::vector<unsigned char> spec = slurp(argv[2]); char err[512] = "";
    JB j; jb_init(&j);
    if (!mw_equity((const char *)spec.data(), spec.size(), &j, err, sizeof err)) { std::fprintf(stderr, "error: %s\n", err); jb_free(&j); return 1; }
    std::printf("%.*s\n", (int)j.n, j.s); jb_free(&j); return 0;
  }
  // 3.8: mwcli --node spec.json state.emmw request.json [memoryMiB]  (strategy explorer query)
  if ((argc == 5 || argc == 6) && !std::strcmp(argv[1], "--session")) {
    std::vector<unsigned char> spec = slurp(argv[2]), plan = slurp(argv[4]); char err[512] = ""; double mib = 4096;
    if (argc == 6 && !numberArg(argv[5], mib)) { std::fprintf(stderr, "error: bad memoryMiB\n"); return 2; }
    uint64_t size = 0; std::string openWhy; FILE *f = openCheckpoint(argv[3], size, openWhy); std::error_code ec;
    std::string text((const char *)spec.data(), spec.size()); MW *m = nullptr;
    const bool ok = !spec.empty() && f && !ec && mw_load_stream(f, size, text.c_str(), mib, -1, &m, err, sizeof err, nullptr, nullptr) == 200;
    if (f) std::fclose(f);
    if (!ok) { std::fprintf(stderr, "error: %s\n", err[0] ? err : !openWhy.empty() ? openWhy.c_str() : "Unable to open state"); return 1; }
    JV *p = json_parse((const char *)plan.data(), plan.size(), err, sizeof err);
    if (!p) { std::fprintf(stderr, "error: plan: %s\n", err); mw_free(m); return 2; }
    const int rc = runSession(m, p); json_free(p); mw_free(m); return rc;
  }
  // 4.4: mwcli --ieee            prints the IEEE 754 probe table (bits, %.17g value, digit text)
  //      mwcli --ieee-verify f   parses a probe document with the engine's JSON reader; exit 1 on any mismatch
  if (argc == 2 && !std::strcmp(argv[1], "--ieee")) { JB j; jb_init(&j); mw_ieee_probe(&j); std::printf("%.*s\n", (int)j.n, j.s); jb_free(&j); return 0; }
  // 4.5: mwcli --ieee-sweep [count] [seed]   print/parse round trip of `count` generated doubles (default 200000, seed 45); exit 1 on any mismatch
  if (argc >= 2 && argc <= 4 && !std::strcmp(argv[1], "--ieee-sweep")) {
    JB j; jb_init(&j); const int st = mw_ieee_sweep(&j, argc > 2 ? std::atoll(argv[2]) : 200000, argc > 3 ? std::strtoull(argv[3], nullptr, 10) : 45ULL);
    if (!st) { std::fprintf(stderr, "usage: mwcli --ieee-sweep [count 1..50000000] [seed]\n"); jb_free(&j); return 2; }
    std::printf("%.*s\n", (int)j.n, j.s); jb_free(&j); return st == 1 ? 0 : 1;
  }
  if (argc == 3 && !std::strcmp(argv[1], "--ieee-verify")) {
    std::vector<unsigned char> doc = slurp(argv[2]); char err[512] = ""; JB j; jb_init(&j);
    // a UTF-8 byte-order mark (Windows PowerShell 5.1 "Set-Content -Encoding UTF8") is not JSON
    size_t skip = doc.size() >= 3 && doc[0] == 0xEF && doc[1] == 0xBB && doc[2] == 0xBF ? 3 : 0;
    const int st = mw_ieee_verify((const char *)doc.data() + skip, doc.size() - skip, &j, err, sizeof err);
    if (st != 200) { std::fprintf(stderr, "error %d: %s\n", st, err); jb_free(&j); return 2; }
    std::printf("%.*s\n", (int)j.n, j.s); const bool bad = std::strstr(j.s, "\"identical\":false") != nullptr; jb_free(&j); return bad ? 1 : 0;
  }
  // 3.9: mwcli --ev | --gain spec.json state.emmw request.json [memoryMiB]  (action EVs, response gains)
  if (argc >= 5 && argc <= 6 && (!std::strcmp(argv[1], "--node") || !std::strcmp(argv[1], "--ev") || !std::strcmp(argv[1], "--gain"))) {
    std::vector<unsigned char> spec = slurp(argv[2]), req = slurp(argv[4]); char err[512] = ""; double mib = 4096;
    if (argc == 6 && !numberArg(argv[5], mib)) { std::fprintf(stderr, "error: bad memoryMiB\n"); return 2; }
    if (spec.empty()) { std::fprintf(stderr, "cannot read %s\n", argv[2]); return 2; }
    uint64_t size = 0; std::string openWhy; FILE *f = openCheckpoint(argv[3], size, openWhy); std::error_code ec;
    std::string text((const char *)spec.data(), spec.size()); MW *m = nullptr;
    const bool ok = f && !ec && mw_load_stream(f, size, text.c_str(), mib, -1, &m, err, sizeof err, nullptr, nullptr) == 200;
    if (f) std::fclose(f);
    if (!ok) { std::fprintf(stderr, "error: %s\n", err[0] ? err : !openWhy.empty() ? openWhy.c_str() : "Unable to open state"); return 1; }
    JB j; jb_init(&j); req.push_back(0);
    auto *query = !std::strcmp(argv[1], "--ev") ? mw_action_ev : !std::strcmp(argv[1], "--gain") ? mw_response_gain : mw_node_query;
    // 4.0: EM_CANCEL_AFTER_MS=N raises the cancellation flag N ms after the
    // query starts (tests measure cancellation latency); the time from the
    // request to the return is printed to stderr as "cancelLatencyMs".
    static volatile int cancel = 0; long long cancelAfter = -1;
    if (const char *c = std::getenv("EM_CANCEL_AFTER_MS")) { if (!wholeArg(c, 0, 3600000, cancelAfter)) { std::fprintf(stderr, "error: bad EM_CANCEL_AFTER_MS\n"); return 2; } }
    std::chrono::steady_clock::time_point raised{};
    std::atomic<bool> done{false}; std::thread canceller;
    if (cancelAfter >= 0) canceller = std::thread([&] {
      const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(cancelAfter);
      while (!done.load() && std::chrono::steady_clock::now() < until) std::this_thread::sleep_for(std::chrono::microseconds(200));
      if (!done.load()) { raised = std::chrono::steady_clock::now(); __atomic_store_n(&cancel, 1, __ATOMIC_RELAXED); }
    });
    const auto q0 = std::chrono::steady_clock::now();
    const int status = query(m, (const char *)req.data(), req.size() - 1, &j, err, sizeof err, &cancel);
    const auto q1 = std::chrono::steady_clock::now(); done = true; if (canceller.joinable()) canceller.join();
    if (cancelAfter >= 0 || std::getenv("EM_QUERY_TIMING")) {
      std::fprintf(stderr, "{\"queryMs\":%.3f", std::chrono::duration<double, std::milli>(q1 - q0).count());
      if (raised != std::chrono::steady_clock::time_point{}) std::fprintf(stderr, ",\"cancelLatencyMs\":%.3f", std::chrono::duration<double, std::milli>(q1 - raised).count());
      char tel[800]; mw_last_query_telemetry(tel, sizeof tel);   // 5.1: deadline observation and check gaps
      std::fprintf(stderr, ",\"status\":%d,\"evaluator\":%s}\n", status, tel);
    }
    if (status != 200) { std::fprintf(stderr, "error %d: %s\n", status, err); jb_free(&j); mw_free(m); return 1; }
    std::printf("%.*s\n", (int)j.n, j.s); jb_free(&j); mw_free(m); return 0;
  }
  // 3.8: mwcli --restore spec.json state [memoryMiB]: restore only; prints the
  // pre-allocation estimate, the live table capacity and the process peak RSS.
  if ((argc == 4 || argc == 5) && !std::strcmp(argv[1], "--restore")) {
    std::vector<unsigned char> spec = slurp(argv[2]); char err[512] = ""; double mib = 4096;
    if (argc == 5 && !numberArg(argv[4], mib)) { std::fprintf(stderr, "error: bad memoryMiB\n"); return 2; }
    const double before = peakRssMiB();
    uint64_t size = 0; std::string openWhy; FILE *f = openCheckpoint(argv[3], size, openWhy); std::error_code ec;
    std::string text((const char *)spec.data(), spec.size()); MW *m = nullptr;
    auto t0 = std::chrono::steady_clock::now();
    const int status = f && !ec ? mw_load_stream(f, size, text.c_str(), mib, -1, &m, err, sizeof err, nullptr, nullptr) : 404;
    if (f) std::fclose(f);
    const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    if (status != 200) { std::printf("{\"status\":%d,\"error\":\"%s\",\"seconds\":%.3f,\"processPeakRssMiB\":%.1f}\n", status, err, secs, peakRssMiB()); return 1; }
    JB j; jb_init(&j); mw_info(m, &j);
    std::printf("%.*s,\"restoreSeconds\":%.3f,\"rssBeforeMiB\":%.1f,\"processPeakRssMiB\":%.1f,\"fileBytes\":%llu}\n", (int)j.n - 1, j.s, secs, before, peakRssMiB(), (unsigned long long)size);
    jb_free(&j); mw_free(m); return 0;
  }
  // 4.6: checkpoint diagnostics (see ckpt_suite.hpp)
  // 4.7: lossless compressed checkpoints. --compress in.state out.emz [level 1-9]; --decompress in.emz out.state
  if ((argc == 4 || argc == 5) && (!std::strcmp(argv[1], "--compress") || !std::strcmp(argv[1], "--decompress"))) {
    const bool pack = !std::strcmp(argv[1], "--compress"); long long level = 6;
    if (argc == 5 && (!pack || !wholeArg(argv[4], 1, 9, level))) { std::fprintf(stderr, "usage: mwcli --compress in.state out.emz [level 1-9] | --decompress in.emz out.state\n"); return 2; }
    FILE *in = std::fopen(argv[2], "rb"); if (!in) { std::fprintf(stderr, "error: cannot read '%s': %s\n", argv[2], std::strerror(errno)); return 3; }
    std::error_code ec; const uint64_t inSize = std::filesystem::file_size(argv[2], ec);
    emz::Result r; const auto t0 = std::chrono::steady_clock::now(); SaveReport rep;
    saveWithReport(argv[3], [&](FILE *out) { r = pack ? emz::compress(in, inSize, out, (int)level) : emz::decompress(in, out); return r.ok; }, rep);
    std::fclose(in);
    const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    if (!r.ok) { std::fprintf(stderr, "error: %s (nothing was written to '%s')\n", r.error.c_str(), argv[3]); return 1; }
    if (!rep.ok) { std::fprintf(stderr, "error: cannot write '%s': %s\n", argv[3], rep.text().c_str()); return 4; }
    std::printf("{\"operation\":\"%s\",\"format\":\"EMZ1 (deflate per block, row values optionally byte-shuffled; lossless)\",\"stateBytes\":%llu,\"compressedBytes\":%llu,\"ratio\":%.4f,\"blocks\":%llu,\"rowBlocksPlain\":%llu,\"rowBlocksShuffled\":%llu,\"stateSha256\":\"%s\",\"seconds\":%.4f,\"processPeakRssMiB\":%.1f}\n",
      pack ? "compress" : "decompress", (unsigned long long)r.rawBytes, (unsigned long long)(pack ? r.packedBytes : inSize), r.rawBytes ? (double)(pack ? r.packedBytes : inSize) / (double)r.rawBytes : 0.0, (unsigned long long)r.blocks, (unsigned long long)r.plainRowBlocks, (unsigned long long)r.shuffledRowBlocks, r.rawSha256.c_str(), secs, peakRssMiB());
    return 0;
  }
  if (argc >= 2 && !std::strcmp(argv[1], "--study")) return st52::run(argc, argv);   // 5.2 decision study
  if (argc >= 2 && !std::strcmp(argv[1], "--selftest47")) return st47::run(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--selftest48")) return st48::run(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--selftest49")) return st49::run(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--selftest57")) return st57::run(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--selftest571")) return st571::run(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--selftest58")) return st58::run(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--selftest59")) return st59::run(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--selftest510")) return st510::run(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--selftest511")) return st511::run(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--streams511")) {   // 5.11: numbers of one training stream (for independent implementations)
    long long domain = 0, purpose = 0, t = 0, d = 0, count = 0; unsigned long long seed = 0; char *end = nullptr;
    if (argc == 8) { errno = 0; seed = std::strtoull(argv[2], &end, 16); }
    if (argc != 8 || !end || *end || end == argv[2] || std::strlen(argv[2]) > 16 || errno || !wholeArg(argv[3], 0, 8, domain) || !wholeArg(argv[4], 1, 3, purpose) || !wholeArg(argv[5], 0, MW_MAX_UPDATES_WIDE, t) || !wholeArg(argv[6], 0, 63, d) || !wholeArg(argv[7], 1, 4096, count)) {
      std::fprintf(stderr, "usage: mwcli --streams511 seedHex domain purpose t d count   (seed 1 to 16 hex digits; domain 0 training, 1 + seat response; purpose 1 cards, 2 actions, 3 Latin; t update index; d 0 to 63; count 1 to 4096)\n"); return 2; }
    JB b; jb_init(&b); const int st = mw_stream511(seed, (int)domain, (int)purpose, t, d, (int)count, &b);
    if (st == 200) std::printf("%.*s\n", (int)b.n, b.s); jb_free(&b); return st == 200 ? 0 : 2;
  }
  // 5.10: mwcli --estimator-check spec.json updates deals [seed]: trains `updates` updates with the spec's estimator
  // (which must be "rbes"), then compares, for `deals` sampled deals, the exact expectation of the estimator's
  // increments with a brute-force walk of the whole betting tree (mw_rbes_check). Exit 0 agreed, 1 disagreed or
  // refused, 2 usage.
  if (argc >= 2 && !std::strcmp(argv[1], "--estimator-check")) {
    long long updates = 0, deals = 0, seed = 1296;
    if (argc < 5 || argc > 6 || !wholeArg(argv[3], 0, MW_MAX_UPDATES, updates) || !wholeArg(argv[4], 1, 100000, deals) || (argc == 6 && !wholeArg(argv[5], 0, 4294967295LL, seed))) { std::fprintf(stderr, "usage: mwcli --estimator-check spec.json updates deals [seed]\n"); return 2; }
    std::vector<unsigned char> spec = slurp(argv[2]); if (spec.empty()) { std::fprintf(stderr, "cannot read %s\n", argv[2]); return 2; }
    char err[512] = ""; MW *m = mw_create((const char *)spec.data(), spec.size(), 1024, err, sizeof err);
    if (!m) { std::fprintf(stderr, "error: %s\n", err); return 1; }
    if (!mw_train(m, updates, 1, nullptr, nullptr, nullptr, err, sizeof err)) { std::fprintf(stderr, "error: training failed: %s\n", err); mw_free(m); return 1; }
    const std::string rq = "{\"deals\":" + std::to_string(deals) + ",\"seed\":" + std::to_string(seed) + "}"; JB out; jb_init(&out);
    const int st = mw_rbes_check(m, rq.c_str(), rq.size(), &out, err, sizeof err); mw_free(m);
    if (st != 200) { std::fprintf(stderr, "error %d: %s\n", st, err); jb_free(&out); return 1; }
    const std::string text(out.s ? out.s : "", out.n); jb_free(&out); std::printf("%s\n", text.c_str());
    return text.find("\"passed\":true") != std::string::npos ? 0 : 1;
  }
  if (argc >= 2 && !std::strcmp(argv[1], "--streams59")) {   // 5.9: numbers of one evaluation stream (for independent implementations)
    long long seed = 0, seat = 0, block = 0, purpose = 0, count = 0;
    if (argc != 7 || !wholeArg(argv[2], 0, 4294967295LL, seed) || !wholeArg(argv[3], 0, 7, seat) || !wholeArg(argv[4], 0, 1000000000LL, block) || !wholeArg(argv[5], 0, 1, purpose) || !wholeArg(argv[6], 1, 4096, count)) {
      std::fprintf(stderr, "usage: mwcli --streams59 seed seat block purpose count   (seed 0 to 4294967295, seat 0 to 7, purpose 0 cards or 1 actions, count 1 to 4096)\n"); return 2; }
    JB b; jb_init(&b); const int st = mw_stream59((unsigned long long)seed, (int)seat, block, (int)purpose, (int)count, &b);
    if (st == 200) std::printf("%.*s\n", (int)b.n, b.s); jb_free(&b); return st == 200 ? 0 : 2;
  }
  if (argc >= 2 && !std::strcmp(argv[1], "--response")) return rsp59::run(argc, argv);   // 5.8 trained response; 5.9 simultaneous confidence statements
  if (argc >= 2 && !std::strcmp(argv[1], "--verify")) return mwa::verify(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--compare")) return mwa::compare(argc, argv);
  if (argc >= 2 && !std::strcmp(argv[1], "--monitor")) return mwa::monitor(argc, argv);
  if (argc == 3 && !std::strcmp(argv[1], "--state-info")) {
    const ckpt::StateInfo s = ckpt::inspect(argv[2]);
    std::printf("{\"path\":%s,\"state\":%s}\n", ckpt::jsonStr(argv[2]).c_str(), ckpt::infoJson(s).c_str());
    return s.exists && s.validHeader && s.readable ? 0 : 1;
  }
  if (argc >= 4 && argc <= 6 && !std::strcmp(argv[1], "--continuation-suite")) {
    ckpt::Suite suite; suite.self = ckpt::selfPath(argv[0]);
    std::error_code ec; suite.spec = std::filesystem::absolute(argv[2], ec).string(); suite.dir = std::filesystem::absolute(argv[3], ec).string();
    const std::string level = argc > 4 ? argv[4] : "standard";
    if (level != "quick" && level != "standard" && level != "full") { std::fprintf(stderr, "usage: mwcli --continuation-suite spec.json work-dir [quick|standard|full] [threads]\n"); return 2; }
    long long t = 4; if (argc > 5 && !wholeArg(argv[5], 1, 256, t)) { std::fprintf(stderr, "error: threads must be 1 to 256\n"); return 2; }
    suite.threads = (int)t;
    if (!std::filesystem::exists(suite.spec, ec)) { std::fprintf(stderr, "error: cannot read %s\n", suite.spec.c_str()); return 2; }
    return suite.run(level);
  }
  if (argc < 5 || argc > 7) { std::fprintf(stderr, "usage: mwcli spec.json iterations threads out.state [memoryMiB] [in.state]\n"); return 2; }
  // 3.3: strict numeric arguments (atoll/atoi/atof accepted "abc" as 0 and negative thread counts).
  long long iterations = 0, threads = 0; double memoryMiB = 4096;
  // 5.11: the bound depends on the training streams of the spec (mw_max_updates): 10,000,000 for the 5.10 streams,
  // 140,737,488,355,327 for "trainingStreams":"philox64". More than 10,000,000 is accepted here only to be checked
  // against the engine's own bound below, before anything is trained or written.
  const char *const iterationsUsage = "error: iterations must be a whole number from 0 to 10,000,000 (to 140,737,488,355,327 for a spec with \"trainingStreams\":\"philox64\")\n";
  if (!wholeArg(argv[2], 0, MW_MAX_UPDATES_WIDE, iterations)) { std::fputs(iterationsUsage, stderr); return 2; }
  if (!wholeArg(argv[3], 1, 256, threads)) { std::fprintf(stderr, "error: threads must be a whole number from 1 to 256\n"); return 2; }
  if (argc > 5 && !numberArg(argv[5], memoryMiB)) { std::fprintf(stderr, "error: memoryMiB must be a finite number above 0 and at most 65536\n"); return 2; }
  std::vector<unsigned char> spec = slurp(argv[1]);
  if (spec.empty()) { if (iterations > MW_MAX_UPDATES) std::fputs(iterationsUsage, stderr); std::fprintf(stderr, "cannot read %s\n", argv[1]); return 2; }
  char err[512] = "";
  MW *m = mw_create((const char *)spec.data(), spec.size(), memoryMiB, err, sizeof err);
  if (!m) { std::fprintf(stderr, "error: %s\n", err); return 1; }
  if (iterations > mw_max_updates(m)) { std::fputs(iterationsUsage, stderr); std::fprintf(stderr, "error: this spec trains with the 5.10 streams (or DCFR), whose states hold at most 10,000,000 updates; nothing was trained\n"); mw_free(m); return 2; }
  if (argc > 6) {
    // 4.6: an unreadable input checkpoint is reported with its path and the OS reason (exit 3)
    std::error_code ec; const bool present = std::filesystem::exists(argv[6], ec);
    if (!present) { std::fprintf(stderr, "error: input checkpoint '%s' does not exist%s%s\n", argv[6], ec ? ": " : "", ec ? ec.message().c_str() : ""); mw_free(m); return 3; }
    if(mw_is_external(m)){
      uint64_t size = 0; std::string why; FILE *f = openCheckpoint(argv[6], size, why);
      if (!f) { std::fprintf(stderr, "error: cannot read input checkpoint '%s': %s\n", argv[6], why.c_str()); mw_free(m); return 3; }
      mw_free(m);m=nullptr;std::string text((const char*)spec.data(),spec.size());
      const int st=mw_load_stream(f,size,text.c_str(),memoryMiB,-1,&m,err,sizeof err,nullptr,nullptr);
      fclose(f);if(st!=200){std::fprintf(stderr,"error: input checkpoint '%s' was refused (status %d): %s\n",argv[6],st,err[0]?err:"Unable to open checkpoint");return 1;}
    }else{
      auto st=slurp(argv[6]);
      if (st.empty()) { std::fprintf(stderr, "error: cannot read input checkpoint '%s' (empty or unreadable)\n", argv[6]); mw_free(m); return 3; }
      if(!mw_import(m,st.data(),st.size(),err,sizeof err)){std::fprintf(stderr,"error: input checkpoint '%s' was refused: %s\n",argv[6],err);mw_free(m);return 1;}
    }
  }
  // 4.6 (tests): EM_TRAIN_CANCEL_AFTER_MS=N raises the training stop flag after N ms, as the
  // desktop Stop button does. Committed updates are kept and saved; the update in progress is discarded.
  static volatile int trainStop = 0; long long trainCancelMs = -1;
  if (const char *c = std::getenv("EM_TRAIN_CANCEL_AFTER_MS")) { if (!wholeArg(c, 0, 3600000, trainCancelMs)) { std::fprintf(stderr, "error: bad EM_TRAIN_CANCEL_AFTER_MS\n"); mw_free(m); return 2; } }
  std::atomic<bool> trainDone{false}; std::thread trainCanceller;
  if (trainCancelMs >= 0) trainCanceller = std::thread([&] {
    const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(trainCancelMs);
    while (!trainDone.load() && std::chrono::steady_clock::now() < until) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    if (!trainDone.load()) __atomic_store_n(&trainStop, 1, __ATOMIC_RELAXED);
  });
  auto t0 = std::chrono::steady_clock::now();
  const int trained = mw_train(m, iterations, (int)threads, trainCancelMs >= 0 ? &trainStop : nullptr, nullptr, nullptr, err, sizeof err);
  trainDone = true; if (trainCanceller.joinable()) trainCanceller.join();
  if (!trained) { std::fprintf(stderr, "error: training failed: %s (nothing was written to '%s')\n", err, argv[4]); mw_free(m); return 1; }
  double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  SaveReport rep;
  if(mw_is_external(m))saveWithReport(argv[4],[&](FILE *f){return mw_write_stream(m,f,nullptr)>0;},rep);
  else{unsigned char *buf=nullptr;size_t n=mw_export(m,&buf);if(buf&&n)saveWithReport(argv[4],[&](FILE *f){return fwrite(buf,1,n,f)==n;},rep);else{rep.stage="export";rep.message="the engine produced no state bytes";}std::free(buf);}
  // 4.6: say which stage failed and why (4.5 printed only "cannot write"); exit 4
  if(!rep.ok){std::fprintf(stderr,"error: cannot write checkpoint '%s': %s. The previous file at that path, if any, is unchanged.\n",argv[4],rep.text().c_str());mw_free(m);return 4;}
  if(rep.replaceRetries)std::fprintf(stderr,"note: replacing '%s' succeeded after %d transient retries (file in use by another program)\n",argv[4],rep.replaceRetries);
  JB j; jb_init(&j); mw_info(m, &j);
  std::printf("%.*s", (int)j.n - 1, j.s); std::printf(",\"wallSeconds\":%.6f,\"processPeakRssMiB\":%.1f,\"cancelled\":%s,\"saveReplaceRetries\":%d}\n", secs, peakRssMiB(), trainStop ? "true" : "false", rep.replaceRetries);
  jb_free(&j); mw_free(m);
  return 0;
}
