// EightMax 4.2: CUDA context and resource tests for native/cuda_score.hpp and the
// Automatic-mode rule of native/showdown_table.hpp. Run against the Linux CUDA
// driver test double (tests/cuda_driver_fixture.cpp), which enforces the real
// driver's per-thread current-context rules. This is NOT physical GPU testing.
// Build: g++ -std=c++20 -O2 -I native tests/cuda42.cpp -ldl -lpthread -o cuda42
// Run:   LD_LIBRARY_PATH=<dir of the double's libcuda.so.1> ./cuda42 [phase]
//        phase: all (default) | oom (with EM_FIXTURE_FAULT=allocAfter=N) | create (EM_FIXTURE_FAULT=noprimary)
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>
#include <dlfcn.h>
#include "cuda_score.hpp"
#include "showdown_table.hpp"
using namespace es;
static int failures = 0; static std::string out;
static void check(const char *name, bool ok, const std::string &detail = "") {
  if (!ok) failures++;
  out += (out.empty() ? "" : ",") + std::string("{\"check\":\"") + name + "\",\"passed\":" + (ok ? "true" : "false") + (detail.empty() ? "" : "," + detail) + "}";
}
static int (*getCurrent)(void **) = nullptr;
static bool noneCurrent() { void *c = (void *)1; return getCurrent && !getCurrent(&c) && c == nullptr; }
static std::vector<unsigned long long> binomTable() { std::vector<unsigned long long> b(53 * 6); for (int x = 0; x <= 52; x++) for (int r = 0; r <= 5; r++) b[(size_t)x * 6 + r] = binom64(x, r); return b; }
// Three hands, empty board: the 4.1 validator's equity case.
static std::vector<unsigned char> equitySpec() {
  std::vector<unsigned char> s{3, 0, 46}; for (int c = 0; c < 6; c++) s.push_back((unsigned char)c); for (int c = 6; c < 52; c++) s.push_back((unsigned char)c); return s;
}
// A small showdown table: two seats, river known except one card (46 boards).
static std::vector<unsigned char> boardSpec(unsigned long long &boards) {
  std::vector<unsigned char> s{2, 4, 44}; for (int c : {0, 1, 2, 3}) s.push_back((unsigned char)c); for (int c : {10, 20, 30, 40}) s.push_back((unsigned char)c);
  for (int c = 0; c < 52; c++) if (c > 3 && c != 10 && c != 20 && c != 30 && c != 40) s.push_back((unsigned char)c);
  boards = 44; return s;
}
int main(int argc, char **argv) {
  const std::string phase = argc > 1 ? argv[1] : "all";
  void *lib = dlopen("libcuda.so.1", RTLD_NOW | RTLD_LOCAL); if (lib) getCurrent = (int (*)(void **))dlsym(lib, "cuCtxGetCurrent");
  const auto binom = binomTable();
  if (phase == "all" || phase == "create") {
    // 1. open on this thread; nothing may stay current afterwards
    CudaScore d; const bool ok = d.open();
    check(phase == "create" ? "cuCtxCreate path (no primary context): device opens" : "device opens (primary context)", ok && (phase == "create" ? !d.usesPrimaryContext() : d.usesPrimaryContext()), "\"reason\":\"" + d.info.reason + "\"");
    check("no context is left current on the opening thread", noneCurrent());
    // 2. the same device used from 8 other threads, one after another and serialised (as EvGpu::mu does)
    unsigned long long boards; const auto spec = boardSpec(boards); std::vector<int> ref(boards * 2), got(boards * 2);
    bool all = d.boardsBegin(spec, binom, 0, boards, 2, 64 << 20) && d.boardsFinish(ref.data());
    std::mutex mu; int okCalls = 0, balanced = 0;
    std::vector<std::thread> th;
    for (int t = 0; t < 8; t++) th.emplace_back([&] { std::lock_guard<std::mutex> g(mu); std::vector<int> o(boards * 2);
      if (d.boardsBegin(spec, binom, 0, boards, 2, 64 << 20) && d.boardsFinish(o.data()) && o == ref) okCalls++;
      if (noneCurrent()) balanced++; });
    for (auto &x : th) x.join();
    char b[160]; std::snprintf(b, sizeof b, "\"threads\":8,\"succeeded\":%d,\"balanced\":%d,\"lastError\":\"%s\"", okCalls, balanced, d.error.name.c_str());
    check("one device used from 8 host threads: every call succeeds with identical scores", all && okCalls == 8, b);
    check("context push/pop balanced on every host thread", balanced == 8);
    // 3. concurrent instances (each with its own buffers) on 6 threads sharing the primary context
    std::vector<unsigned long long> totals(6 * 9); int eqOk = 0; std::vector<std::thread> th2;
    const auto es = equitySpec(); const unsigned long long combos = binom64(46, 5);
    for (int t = 0; t < 6; t++) th2.emplace_back([&, t] { CudaScore x; size_t peak = 0; if (x.open() && x.equity(es, binom, combos, &totals[(size_t)t * 9], 1 << 20, peak)) { std::lock_guard<std::mutex> g(mu); eqOk++; } });
    for (auto &x : th2) x.join();
    bool same = true; for (int t = 1; t < 6; t++) same &= std::equal(totals.begin(), totals.begin() + 9, totals.begin() + t * 9);
    check("6 concurrent CudaScore instances on 6 threads: all succeed, identical equity", eqOk == 6 && same && totals[8] == combos);
    // 4. budget below the real request: refused before any allocation, error recorded
    const long long before = CudaLedger::live().load(); size_t peak = 0; unsigned long long o9[9];
    const size_t need = CudaScore::equityBytes(es.size(), binom.size());
    const bool refused = !d.equity(es, binom, combos, o9, need - 1, peak);
    std::snprintf(b, sizeof b, "\"needBytes\":%zu,\"budgetBytes\":%zu,\"error\":\"%s\"", need, need - 1, d.error.name.c_str());
    check("equity with budget = request - 1 byte is refused before allocating (EM_GPU_BUDGET_EXCEEDED)", refused && d.error.code == CudaScore::EM_BUDGET && CudaLedger::live().load() == before, b);
    d.clearError(); peak = 0;
    check("equity with budget = request succeeds and peaks at exactly the request", d.equity(es, binom, combos, o9, need, peak) && peak == need && std::equal(o9, o9 + 9, totals.begin()));
    // 5. showdown-table budget below one chunk
    check("EV-table launch with a budget below its minimum allocation is refused", !d.boardsBegin(spec, binom, 0, boards, 2, 100) && d.error.code == CudaScore::EM_BUDGET);
    d.clearError();
    d.releaseBuffers();
    check("releaseBuffers returns this object's device bytes", d.heldBytes() == 0);
  }
  if (phase == "all") {
    // 6. repeated initialisation: 40 open/use/destroy cycles, ledger back to its start
    const long long start = CudaLedger::live().load(); int opened = 0; unsigned long long boards; const auto spec = boardSpec(boards); std::vector<int> o(boards * 2);
    for (int i = 0; i < 40; i++) { CudaScore x; if (x.open() && x.boardsBegin(spec, binom, 0, boards, 2, 1 << 20) && x.boardsFinish(o.data())) opened++; }
    char b[120]; std::snprintf(b, sizeof b, "\"cycles\":40,\"succeeded\":%d,\"ledgerStart\":%lld,\"ledgerEnd\":%lld,\"peak\":%lld", opened, start, CudaLedger::live().load(), CudaLedger::peak().load());
    check("40 repeated initialisations: all work, device bytes return to the start", opened == 40 && CudaLedger::live().load() == start, b);
    // 7. Automatic-mode rule
    AutoInputs a{1e6, false, false, false, 0, 0, 0.0, 0.3};
    check("auto: small table stays on the CPU", (a.tableEvals = 1000, autoChoice(a) == AutoChoice::CpuSmall)); a.tableEvals = 1e6;
    check("auto: device not opened before the warm-up", (a.cpuTableSeconds = 0.29, autoChoice(a) == AutoChoice::CpuWarmup));
    check("auto: device opened once the warm-up is spent", (a.cpuTableSeconds = 0.31, autoChoice(a) == AutoChoice::OpenAndVerify));
    a.attempted = true; a.available = false;
    check("auto: unavailable device -> CPU", autoChoice(a) == AutoChoice::CpuUnavailable);
    a.available = true;
    check("auto: available but unverified -> verify", autoChoice(a) == AutoChoice::OpenAndVerify);
    a.verified = true; a.gpuNs = 0.95; a.cpuNs = 1.0;
    check("auto: GPU less than 10% faster -> CPU", autoChoice(a) == AutoChoice::CpuSlower);
    a.gpuNs = 0.5;
    check("auto: GPU measured >= 10% faster -> GPU", autoChoice(a) == AutoChoice::Gpu);
    CudaError e; e.code = 2; check("out-of-memory is transient (table to CPU, device kept)", cudaTransient(e));
    e.code = 201; check("invalid context is not transient (device disabled)", !cudaTransient(e));
    e.code = CudaScore::EM_BUDGET; check("budget refusal is transient", cudaTransient(e));
  }
  if (phase == "oom") {
    // allocations after the N-th fail with CUDA_ERROR_OUT_OF_MEMORY; repeated failures must not leak
    CudaScore d; const bool ok = d.open(); unsigned long long boards; const auto spec = boardSpec(boards); std::vector<int> o(boards * 2);
    int failed = 0, succeeded = 0;
    for (int i = 0; i < 25; i++) { const bool r = d.boardsBegin(spec, binom, 0, boards, 2, 1 << 20) && d.boardsFinish(o.data()); (r ? succeeded : failed)++; if (!r) { if (d.error.code != 2) failed += 1000; d.clearError(); d.releaseBuffers(); } }
    char b[200]; std::snprintf(b, sizeof b, "\"attempts\":25,\"succeeded\":%d,\"failed\":%d,\"ledger\":%lld", succeeded, failed, CudaLedger::live().load());
    check("repeated out-of-memory failures are reported as CUDA_ERROR_OUT_OF_MEMORY and leave no device bytes", ok && failed > 0 && failed < 1000 && d.heldBytes() == 0, b);
  }
  std::printf("{\"suite\":\"cuda42\",\"phase\":\"%s\",\"failures\":%d,\"checks\":[%s]}\n", phase.c_str(), failures, out.c_str());
  return failures ? 1 : 0;
}
