// EightMax 4.3: unit tests for the shared showdown-table building blocks
// (native/showdown_table.hpp) and the CUDA lifecycle of the evaluation tables.
//
//  phase "units" (no driver needed):
//    * fullPattern() equals 4.2's rankPattern() for every seat count 1..8 on
//      random and tie-heavy rows (the dense rank code that the EV arithmetic uses)
//    * FlatHist equals a std::map reference (counts, distinct codes, growth)
//    * autoChoice43(): every branch of the Automatic cost model
//    * TableCache eviction: idle tables are evicted oldest first to fit the
//      request budget; tables still referenced are never evicted
//  phase "lifecycle" (Linux CUDA driver test double via LD_LIBRARY_PATH; it is a
//  simulated driver, not physical GPU validation):
//    * openAsync() opens the device on a background thread, exactly once
//    * the janitor releases pooled buffers after EM_GPU_IDLE_RELEASE_S of idle
//      time, keeps the context, and the device works again afterwards
// Prints one JSON object; exit status 1 on any failure.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <random>
#include <string>
#include <thread>
#include <vector>
#include "cuda_score.hpp"
#include "showdown_table.hpp"
using namespace es;
static std::string checks; static int failures = 0;
static void check(const char *name, bool ok, const std::string &extra = "") {
  if (!ok) failures++;
  if (!checks.empty()) checks += ",";
  checks += std::string("{\"check\":\"") + name + "\",\"passed\":" + (ok ? "true" : "false") + extra + "}";
}
static void units() {
  // fullPattern vs rankPattern
  std::mt19937 g(43); long long rows = 0, mism = 0;
  for (int mod : {3, 7, 40, 1 << 30}) for (int n = 1; n <= 8; n++) for (int r = 0; r < 200000; r++) {
    int32_t sc[8]; for (int i = 0; i < n; i++) sc[i] = (int32_t)(g() % (unsigned)mod);
    int seats[8] = {0, 1, 2, 3, 4, 5, 6, 7}; rows++;
    if (fullPattern(sc, n) != rankPattern(sc, seats, n)) mism++;
  }
  check("fullPattern equals the 4.2 rankPattern for 1-8 seats (random and tie-heavy rows)", mism == 0, ",\"rows\":" + std::to_string(rows) + ",\"mismatches\":" + std::to_string(mism));
  // FlatHist vs map
  FlatHist h; std::map<uint32_t, uint64_t> ref; std::mt19937 g2(7);
  for (int i = 0; i < 3000000; i++) { const uint32_t k = (uint32_t)(g2() % 200000) * 37u & 0xFFFFFFu; const uint32_t c = 1 + g2() % 3; h.add(k, c); ref[k] += c; }
  bool same = h.used == ref.size(); h.each([&](uint32_t k, uint32_t v) { auto it = ref.find(k); same &= it != ref.end() && it->second == v; });
  check("FlatHist equals a std::map reference (3,000,000 additions, growth)", same, ",\"distinct\":" + std::to_string(h.used));
  { FlatHist z; z.add(0); z.add(0); bool ok = false; z.each([&](uint32_t k, uint32_t v) { ok = k == 0 && v == 2; }); check("FlatHist counts the all-tied pattern code 0", ok && z.used == 1); }
  // Automatic cost model
  Auto43In a; a.evals = 3e6; a.threads = 1; a.cpuNs = 10;
  check("auto43: small table stays on the CPU", (a.evals = 1000, autoChoice43(a) == Auto43::CpuSmall)); a.evals = 3e6;
  check("auto43: no start-up before the warm-up", (a.cpuTableSeconds = 0.05, autoChoice43(a) == Auto43::CpuWarmup));
  check("auto43: start-up is requested in the background after the warm-up", (a.cpuTableSeconds = 0.2, autoChoice43(a) == Auto43::StartOpen));
  check("auto43: device being opened -> CPU without waiting", (a.opening = true, autoChoice43(a) == Auto43::CpuOpening)); a.opening = false;
  a.attempted = true; a.available = false;
  check("auto43: unavailable device -> CPU", autoChoice43(a) == Auto43::CpuUnavailable); a.available = true;
  check("auto43: busy device -> CPU", (a.busy = true, autoChoice43(a) == Auto43::CpuBusy)); a.busy = false;
  check("auto43: unverified device, large single-thread table -> verify", autoChoice43(a) == Auto43::Verify);
  a.verified = true; a.gpuNs = 1.6; a.fixedSec = 0.0004;
  check("auto43: measured device much faster than one CPU thread -> GPU", autoChoice43(a) == Auto43::Gpu);
  a.threads = 24;
  check("auto43: 24 CPU threads beat one device batch -> CPU", autoChoice43(a) == Auto43::CpuSlower);
  a.threads = 1; a.gpuNs = 9.5; a.evals = 400000;
  check("auto43: one device batch would take about as long as the CPU alone -> CPU", autoChoice43(a) == Auto43::CpuSlower);
  a.evals = 3e6;
  check("auto43: device as slow as one CPU thread still joins a large table (it pulls batches alongside the CPU)", autoChoice43(a) == Auto43::Gpu);
  // TableCache eviction
  EvControl ctl; TableCache C; C.ctl = &ctl; C.workers = 1;
  auto mk = [&](int tag, long long bytes) { auto t = std::make_shared<ShowTable>(); t->len = 3; t->used = (uint64_t)tag; t->n = 2; t->charged = bytes; t->ready = true; t->stamp = ++C.stamp; return t; };
  bool room = true;
  for (int i = 0; i < 3; i++) { room &= C.makeRoom(100, 350); C.tables.push_back(mk(i, 100)); }
  auto pinned = C.tables[0];   // held elsewhere: must survive
  const bool fit = C.makeRoom(100, 350);
  bool pinnedKept = false, oldestIdleGone = true; for (auto &t : C.tables) { if (t == pinned) pinnedKept = true; if (t->used == 1) oldestIdleGone = false; }
  check("TableCache: idle tables are evicted oldest first to fit the budget; referenced tables are kept", room && fit && pinnedKept && oldestIdleGone && ctl.memoryBytes.load() == 300, ",\"chargedBytes\":" + std::to_string(ctl.memoryBytes.load()));
  C.tables.push_back(mk(9, 100));
  check("TableCache: nothing evictable -> refusal (the caller falls back to per-board enumeration)", ([&] { auto keep = C.tables; return !C.makeRoom(200, 350); })());
}
static void lifecycle() {
  EvGpu &G = EvGpu::get();
  G.openAsync(); G.openAsync();
  for (int i = 0; i < 5000 && !G.attempted.load(); i++) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  check("openAsync opens the device on a background thread exactly once", G.attempted.load() && G.ok.load() && G.opens.load() == 1 && G.asyncOpens.load() == 1, ",\"reason\":\"" + G.reason + "\"");
  std::vector<unsigned char> spec{2, 0, 0}; for (int c : {0, 1, 2, 3}) spec.push_back((unsigned char)c);
  for (int c = 4; c < 52; c++) spec.push_back((unsigned char)c); spec[2] = 48;
  std::vector<unsigned long long> binom(53 * 6); for (int x = 0; x <= 52; x++) for (int r = 0; r <= 5; r++) binom[(size_t)x * 6 + r] = binom64(x, r);
  std::vector<int> out(4096 * 2);
  bool used = false;
  { std::lock_guard<std::mutex> l(G.mu); used = G.dev.boardsBegin(spec, binom, 0, 4096, 2, 512ULL << 20) && G.dev.boardsFinish(out.data()); G.touch(); }
  const size_t held = [&] { std::lock_guard<std::mutex> l(G.mu); return G.dev.heldBytes(); }();
  for (int i = 0; i < 4000 && G.idleReleases.load() == 0; i++) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  const size_t after = [&] { std::lock_guard<std::mutex> l(G.mu); return G.dev.heldBytes(); }();
  check("idle janitor releases pooled device buffers after EM_GPU_IDLE_RELEASE_S", used && held > 0 && G.idleReleases.load() >= 1 && after == 0, ",\"heldBefore\":" + std::to_string(held) + ",\"heldAfter\":" + std::to_string(after));
  std::vector<int> again(4096 * 2); bool ok2 = false;
  { std::lock_guard<std::mutex> l(G.mu); ok2 = G.dev.boardsBegin(spec, binom, 0, 4096, 2, 512ULL << 20) && G.dev.boardsFinish(again.data()); }
  check("device works after the idle release (context kept, buffers re-allocated), identical scores", ok2 && again == out && G.opens.load() == 1);
}
int main(int argc, char **argv) {
  const std::string phase = argc > 1 ? argv[1] : "units";
  if (phase == "units") units(); else lifecycle();
  std::printf("{\"suite\":\"table43\",\"phase\":\"%s\",\"failures\":%d,\"checks\":[%s]}\n", phase.c_str(), failures, checks.c_str());
  return failures ? 1 : 0;
}
