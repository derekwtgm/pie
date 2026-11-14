// EightMax 4.2: in-process CUDA stress for exact action-EV evaluation.
//
// usage: gpustress spec.json state [rounds] [maxThreads]
//
// One process, one study, the process-wide CUDA device of the EV engine
// (EvGpu) shared by every job, exactly as in the desktop host. Phases:
//   1. serial CPU reference (device "cpu");
//   2. worker scaling: device gpu, hybrid and auto with 1, 2, 4, 8 ... maxThreads
//      evaluation threads (each job uses those threads concurrently on the device);
//   3. concurrent jobs: per round, several gpu/hybrid/auto jobs with different
//      thread counts run at the same time, one job is cancelled while it uses the
//      GPU, and the device is probed (CUDA re-initialised: mw_cuda_info opens and
//      closes a separate CudaScore) while the jobs run;
//   4. a final gpu job after all of that (the device must still work or have
//      been disabled with a recorded reason, never hang).
// Every completed result must equal the CPU reference bit for bit; cancelled
// jobs must return 409. Prints one JSON document; exit status 0 only if every
// check passed. On Linux the CUDA driver test double (tests/cuda_driver_fixture.cpp)
// stands in for the driver: that is NOT physical GPU validation.
#include "../native/mw.h"
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#ifndef EM_BUILD_ID
#define EM_BUILD_ID "development"
#endif
static const char BUILD_TAG[] = "EightMaxBuild=" EM_BUILD_ID;
static std::string slurp(const char *f) { std::string s; FILE *fp = std::fopen(f, "rb"); if (!fp) return s; char b[65536]; size_t n; while ((n = std::fread(b, 1, sizeof b, fp)) > 0) s.append(b, n); std::fclose(fp); return s; }
static double now() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
// The "ev" arrays of every hand, verbatim (the result's numbers).
static std::string evs(const std::string &j) {
  std::string out; size_t p = 0;
  while ((p = j.find("\"ev\":[", p)) != std::string::npos) { const size_t e = j.find(']', p); out += j.substr(p, e - p + 1) + ";"; p = e; }
  return out;
}
static long long field(const std::string &j, const char *name) {
  const std::string k = std::string("\"") + name + "\":"; const size_t p = j.find(k); return p == std::string::npos ? -1 : std::atoll(j.c_str() + p + k.size());
}
static std::string sfield(const std::string &j, const char *name) {
  const std::string k = std::string("\"") + name + "\":\""; const size_t p = j.find(k); if (p == std::string::npos) return ""; const size_t e = j.find('"', p + k.size()); return j.substr(p + k.size(), e - p - k.size());
}
static std::string esc(const std::string &s) { std::string o; for (char c : s) { if (c == '"' || c == '\\') o += '\\'; if ((unsigned char)c >= 32) o += c; } return o; }
struct Run { int status = 0; std::string json, err; double seconds = 0; };
static Run run(MW *m, const std::string &q, MwEvalTask *t) {
  JB out; jb_init(&out); char err[512] = ""; Run r; const double t0 = now();
  r.status = mw_eval_run(m, 0, q.data(), q.size(), &out, err, sizeof err, t); r.seconds = now() - t0;
  if (r.status == 200) r.json.assign(out.s, out.n); else r.err = err;
  jb_free(&out); return r;
}
static std::atomic<long long> uniq{0};
// maxVisits differs per request so the per-study EV cache never answers.
static std::string query(const char *device, int threads, const std::string &extra = "") {
  return std::string("{\"path\":[],\"hands\":[0],\"method\":\"exact\",\"device\":\"") + device + "\",\"threads\":" + std::to_string(threads) +
         ",\"timeLimitMs\":600000,\"gpuMiB\":2048,\"maxVisits\":" + std::to_string(2000000000LL - uniq++) + extra + "}";
}
int main(int argc, char **argv) {
  if (argc == 2 && !std::strcmp(argv[1], "--build-id")) { std::puts(BUILD_TAG); return 0; }
  if (argc < 3) { std::fprintf(stderr, "usage: gpustress spec.json state [rounds] [maxThreads]\n"); return 2; }
  const std::string spec = slurp(argv[1]); const int rounds = argc > 3 ? std::atoi(argv[3]) : 3;
  int maxThreads = argc > 4 ? std::atoi(argv[4]) : (int)std::thread::hardware_concurrency(); if (maxThreads < 1) maxThreads = 1;
  char err[512] = ""; FILE *f = std::fopen(argv[2], "rb"); std::error_code ec; auto size = std::filesystem::file_size(argv[2], ec); MW *m = nullptr;
  if (!f || ec || mw_load_stream(f, size, spec.c_str(), 2048, -1, &m, err, sizeof err, nullptr, nullptr) != 200) { std::fprintf(stderr, "open failed: %s\n", err); return 1; }
  std::fclose(f);
  std::mutex outMu; std::string rows; int failures = 0; auto fail = [&](const std::string &why) { std::lock_guard<std::mutex> g(outMu); failures++; std::fprintf(stderr, "FAIL: %s\n", why.c_str()); };
  auto row = [&](const std::string &r) { std::lock_guard<std::mutex> g(outMu); rows += (rows.empty() ? "" : ",") + r; };
  // 1. reference
  MwEvalTask *t0 = mw_eval_task_new(); const Run ref = run(m, query("cpu", 1), t0); mw_eval_task_free(t0);
  if (ref.status != 200) { std::fprintf(stderr, "reference failed: %s\n", ref.err.c_str()); return 1; }
  const std::string refEv = evs(ref.json);
  auto describe = [&](const char *phase, const char *dev, int threads, const Run &r) {
    char b[1400]; const bool same = r.status == 200 && evs(r.json) == refEv;
    std::snprintf(b, sizeof b, "{\"phase\":\"%s\",\"device\":\"%s\",\"threads\":%d,\"status\":%d,\"seconds\":%.4f,\"identicalToCpu\":%s,\"observedDevice\":\"%s\",\"gpuBoards\":%lld,\"cpuBoards\":%lld,\"gpuFailures\":%lld,\"gpuTables\":%lld,\"hybridTables\":%lld,\"cpuGpuBusy\":%lld,\"cpuAfterGpuFailure\":%lld,\"gpuWaitTimeouts\":%lld,\"gpuNote\":\"%s\"}",
                  phase, dev, threads, r.status, r.seconds, same ? "true" : "false", esc(sfield(r.json, "observedDevice")).c_str(), field(r.json, "gpuBoards"), field(r.json, "cpuBoards"), field(r.json, "gpuFailures"), field(r.json, "gpuTables"), field(r.json, "hybridTables"),
                  field(r.json, "cpuGpuBusy"), field(r.json, "cpuAfterGpuFailure"), field(r.json, "gpuWaitTimeouts"), esc(sfield(r.json, "gpuNote")).c_str());
    return std::string(b);
  };
  // 2. worker scaling
  std::vector<int> counts; for (int t : {1, 2, 4, 8, 12, 16, 24, 32}) if (t <= maxThreads) counts.push_back(t); if (counts.back() != maxThreads) counts.push_back(maxThreads);
  for (const char *dev : {"gpu", "hybrid", "auto"}) for (int t : counts) {
    MwEvalTask *task = mw_eval_task_new(); const Run r = run(m, query(dev, t), task); mw_eval_task_free(task);
    row(describe("scaling", dev, t, r));
    if (r.status != 200) fail(std::string("scaling ") + dev + " status " + std::to_string(r.status) + ": " + r.err);
    else if (evs(r.json) != refEv) fail(std::string("scaling ") + dev + " result differs from the CPU");
  }
  // 3. concurrent jobs, cancellation while on the GPU, re-initialisation while running
  int cancelled = 0, probes = 0;
  for (int round = 0; round < rounds; round++) {
    std::vector<std::thread> th; const char *devs[] = {"gpu", "hybrid", "auto", "gpu"}; const int ths[] = {1, 2, 4, std::min(8, maxThreads)};
    for (int j = 0; j < 4; j++) th.emplace_back([&, j] {
      MwEvalTask *task = mw_eval_task_new(); const Run r = run(m, query(devs[j], ths[j]), task); mw_eval_task_free(task);
      row(describe("concurrent", devs[j], ths[j], r));
      if (r.status != 200) fail("concurrent job status " + std::to_string(r.status) + ": " + r.err); else if (evs(r.json) != refEv) fail("concurrent job result differs from the CPU");
    });
    th.emplace_back([&] {   // cancelled while the device is in use
      MwEvalTask *task = mw_eval_task_new();
      std::thread c([&] { std::this_thread::sleep_for(std::chrono::milliseconds(20 + 15 * round)); mw_eval_cancel(task); });
      const double t1 = now(); const Run r = run(m, query("gpu", std::min(4, maxThreads)), task); c.join(); mw_eval_task_free(task);
      std::lock_guard<std::mutex> g(outMu);
      if (r.status == 409) cancelled++; else if (r.status == 200 && evs(r.json) == refEv) {} else { failures++; std::fprintf(stderr, "FAIL: cancelled job returned %d\n", r.status); }
      (void)t1;
    });
    th.emplace_back([&] { for (int k = 0; k < 3; k++) { JB b; jb_init(&b); mw_cuda_info(&b); jb_free(&b); std::lock_guard<std::mutex> g(outMu); probes++; } });
    for (auto &x : th) x.join();
  }
  // 4. the device still answers (or was disabled with a reason) after everything
  MwEvalTask *tf = mw_eval_task_new(); const Run last = run(m, query("gpu", maxThreads), tf); mw_eval_task_free(tf);
  row(describe("final", "gpu", maxThreads, last));
  if (last.status != 200 || evs(last.json) != refEv) fail("final job failed or differs");
  JB info; jb_init(&info); mw_cuda_info(&info); const std::string cuda(info.s ? info.s : "null", info.n); jb_free(&info);
  std::printf("{\"tool\":\"gpustress 4.2\",\"build\":\"%s\",\"rounds\":%d,\"maxThreads\":%d,\"referenceCpuSeconds\":%.4f,\"cancelledJobs\":%d,\"cudaReinitialisations\":%d,\"failures\":%d,\"cuda\":%s,\"runs\":[%s]}\n",
              BUILD_TAG + 14, rounds, maxThreads, ref.seconds, cancelled, probes, failures, cuda.c_str(), rows.c_str());
  mw_free(m);
  return failures ? 1 : 0;
}
