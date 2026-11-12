// Command-line driver for the native multiway engine (tests and benchmarks).
// usage: mwcli <spec.json> <iterations> <threads> <out.state> [memoryMiB] [in.state]
//        mwcli --node|--ev|--gain spec.json state request.json [memoryMiB]
//        mwcli --session spec.json state plan.json   (4.3) several EV / response-gain requests in ONE
//              process: cold vs warm CUDA, sequential, concurrent, idle, cancelled, budget-refused runs
//        mwcli --cuda-info            CUDA device probe (JSON)
//        mwcli --equity <spec.json>   exact all-in equity {hands,board,device:cpu|gpu|both,threads,gpuMiB}
// Prints mw_info JSON plus "seconds" (training wall time) on stdout.
#include "mw.h"
#include <cstring>
#ifndef EM_BUILD_ID
#define EM_BUILD_ID "development"
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
    FILE *f = std::fopen(argv[3], "rb"); std::error_code ec; auto size = std::filesystem::file_size(argv[3], ec);
    std::string text((const char *)spec.data(), spec.size()); MW *m = nullptr;
    const bool ok = !spec.empty() && f && !ec && mw_load_stream(f, size, text.c_str(), mib, -1, &m, err, sizeof err, nullptr, nullptr) == 200;
    if (f) std::fclose(f);
    if (!ok) { std::fprintf(stderr, "error: %s\n", err[0] ? err : "Unable to open state"); return 1; }
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
    FILE *f = std::fopen(argv[3], "rb"); std::error_code ec; auto size = std::filesystem::file_size(argv[3], ec);
    std::string text((const char *)spec.data(), spec.size()); MW *m = nullptr;
    const bool ok = f && !ec && mw_load_stream(f, size, text.c_str(), mib, -1, &m, err, sizeof err, nullptr, nullptr) == 200;
    if (f) std::fclose(f);
    if (!ok) { std::fprintf(stderr, "error: %s\n", err[0] ? err : "Unable to open state"); return 1; }
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
      std::fprintf(stderr, ",\"status\":%d}\n", status);
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
    FILE *f = std::fopen(argv[3], "rb"); std::error_code ec; auto size = std::filesystem::file_size(argv[3], ec);
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
  if (argc < 5 || argc > 7) { std::fprintf(stderr, "usage: mwcli spec.json iterations threads out.state [memoryMiB] [in.state]\n"); return 2; }
  // 3.3: strict numeric arguments (atoll/atoi/atof accepted "abc" as 0 and negative thread counts).
  long long iterations = 0, threads = 0; double memoryMiB = 4096;
  if (!wholeArg(argv[2], 0, 10000000, iterations)) { std::fprintf(stderr, "error: iterations must be a whole number from 0 to 10,000,000\n"); return 2; }
  if (!wholeArg(argv[3], 1, 256, threads)) { std::fprintf(stderr, "error: threads must be a whole number from 1 to 256\n"); return 2; }
  if (argc > 5 && !numberArg(argv[5], memoryMiB)) { std::fprintf(stderr, "error: memoryMiB must be a finite number above 0 and at most 65536\n"); return 2; }
  std::vector<unsigned char> spec = slurp(argv[1]);
  if (spec.empty()) { std::fprintf(stderr, "cannot read %s\n", argv[1]); return 2; }
  char err[512] = "";
  MW *m = mw_create((const char *)spec.data(), spec.size(), memoryMiB, err, sizeof err);
  if (!m) { std::fprintf(stderr, "error: %s\n", err); return 1; }
  if (argc > 6) {
    if(mw_is_external(m)){
      FILE *f=fopen(argv[6],"rb");std::error_code ec;auto size=std::filesystem::file_size(argv[6],ec);
      mw_free(m);m=nullptr;std::string text((const char*)spec.data(),spec.size());
      bool ok=f && !ec && mw_load_stream(f,size,text.c_str(),memoryMiB,-1,&m,err,sizeof err,nullptr,nullptr)==200;
      if(f)fclose(f);if(!ok){std::fprintf(stderr,"error: %s\n",err[0]?err:"Unable to open checkpoint");return 1;}
    }else{
      auto st=slurp(argv[6]);
      if(!mw_import(m,st.data(),st.size(),err,sizeof err)){std::fprintf(stderr,"error: %s\n",err);mw_free(m);return 1;}
    }
  }
  auto t0 = std::chrono::steady_clock::now();
  if (!mw_train(m, iterations, (int)threads, nullptr, nullptr, nullptr, err, sizeof err)) { std::fprintf(stderr, "error: %s\n", err); mw_free(m); return 1; }
  double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  bool saved;
  if(mw_is_external(m))saved=saveWith(argv[4],[&](FILE *f){return mw_write_stream(m,f,nullptr)>0;});
  else{unsigned char *buf=nullptr;size_t n=mw_export(m,&buf);saved=saveState(argv[4],buf,n);std::free(buf);}
  if(!saved){std::fprintf(stderr,"cannot write %s\n",argv[4]);mw_free(m);return 1;}
  JB j; jb_init(&j); mw_info(m, &j);
  std::printf("%.*s", (int)j.n - 1, j.s); std::printf(",\"wallSeconds\":%.6f,\"processPeakRssMiB\":%.1f}\n", secs, peakRssMiB());
  jb_free(&j); mw_free(m);
  return 0;
}
