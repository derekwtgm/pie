// EightMax 4.4: Automatic-mode arm selection (native/showdown_table.hpp,
// ArmStats44 / AutoArms44) - pure decision logic, no device needed.
//
// Checks
//   * exploration: each device arm is tried until it has MIN_SAMPLES
//     measurements (GPU-preferred first), then the CPU if unmeasured;
//   * exploitation: with the timings of the physical RTX 4060 Ti report of 4.3
//     (ms per request, CPU / pull / GPU-preferred) the selector settles on
//     GPU-preferred at 1, 4 and 8 threads and on the CPU at 24 threads;
//   * a slow device (the Linux test double: device arms 2-5x slower) settles on
//     the CPU and spends at most 2 of every 32 decisions re-measuring, less
//     once an arm is more than 3x slower;
//   * adaptation: when the measured cost of the chosen arm rises (another
//     process takes the device), the selector moves to the faster arm within
//     two probe cycles;
//   * classes are independent (thread budget, table size) and invalid samples
//     (0, negative, NaN, infinity) are ignored;
//   * choose() is pure (no state change) and deterministic.
#include <cmath>
#include <cstdio>
#include <string>
#include <climits>
#include "cuda_score.hpp"
#include "showdown_table.hpp"
using namespace es;
static int failures = 0; static std::string out;
static void check(const std::string &name, bool ok, const std::string &detail = "") {
  if (!ok) failures++;
  out += std::string(out.empty() ? "" : ",") + "{\"check\":\"" + name + "\",\"passed\":" + (ok ? "true" : "false") + (detail.empty() ? "" : "," + detail) + "}";
}
// Runs `decisions` tables with fixed true costs per arm; returns how often each arm was used.
static void simulate(ArmStats44 &s, const double cost[3], int decisions, long long used[3]) {
  for (int i = 0; i < decisions; i++) { const Arm44 a = s.next(); used[(int)a]++; s.record(a, cost[(int)a]); }
}
int main() {
  { // exploration order
    ArmStats44 s; std::string order;
    for (int i = 0; i < 6; i++) { const Arm44 a = s.next(); order += std::to_string((int)a); s.record(a, 1e-8); }
    check("unmeasured arms are tried first: GPU-preferred twice, pull twice, CPU twice", order == "221100", "\"order\":\"" + order + "\"");
  }
  { // CPU measured during warm-up: only the device arms are explored
    ArmStats44 s; for (int i = 0; i < 5; i++) s.record(Arm44::Cpu, 1e-8);
    std::string order; for (int i = 0; i < 4; i++) { const Arm44 a = s.next(); order += std::to_string((int)a); s.record(a, 2e-8); }
    check("with CPU samples from warm-up the first four decisions measure the device arms", order == "2211", "\"order\":\"" + order + "\"");
    check("then the fastest measured arm (CPU) is used", s.choose() == Arm44::Cpu);
  }
  { // physical report: {cpu, pull(hybrid), gpuPreferred} request milliseconds
    const double ms[4][3] = {{48.4, 29.8, 28.3}, {19.6, 15.1, 14.0}, {14.7, 13.4, 12.0}, {12.6, 13.3, 12.8}};
    const int threads[4] = {1, 4, 8, 24}; const int want[4] = {2, 2, 2, 0};
    for (int r = 0; r < 4; r++) {
      ArmStats44 s; long long used[3] = {0, 0, 0}; const double cost[3] = {ms[r][0] * 1e-3, ms[r][1] * 1e-3, ms[r][2] * 1e-3};
      simulate(s, cost, 320, used);
      const long long other = 320 - used[want[r]];
      check("RTX 4060 Ti report timings, " + std::to_string(threads[r]) + " threads: settles on " + armName(want[r]), s.best() == want[r] && used[want[r]] >= 290 && other <= 30,
            "\"cpu\":" + std::to_string(used[0]) + ",\"gpuPull\":" + std::to_string(used[1]) + ",\"gpuPreferred\":" + std::to_string(used[2]));
    }
  }
  { // slow device
    ArmStats44 s; long long used[3] = {0, 0, 0}; const double cost[3] = {9e-9, 18e-9, 48e-9};
    simulate(s, cost, 640, used);
    check("slow device: CPU is used for at least 93% of 640 tables; the >3x slower arm is re-measured rarely", s.best() == 0 && used[0] >= 595 && used[2] <= 6 && used[1] >= 10,
          "\"cpu\":" + std::to_string(used[0]) + ",\"gpuPull\":" + std::to_string(used[1]) + ",\"gpuPreferred\":" + std::to_string(used[2]));
  }
  { // adaptation
    ArmStats44 s; long long used[3] = {0, 0, 0}; double cost[3] = {20e-9, 15e-9, 10e-9};
    simulate(s, cost, 100, used); const int before = s.best();
    cost[2] = 40e-9;   // the device became slow in GPU-preferred mode
    long long used2[3] = {0, 0, 0}; simulate(s, cost, 100, used2);
    check("when the chosen arm becomes slower the selector moves to the next best", before == 2 && s.best() == 1 && used2[1] >= 80, "\"after\":\"" + std::string(armName(s.best())) + "\",\"pullUsed\":" + std::to_string(used2[1]));
  }
  { // invalid samples, purity, classes
    ArmStats44 s; s.record(Arm44::Cpu, 0); s.record(Arm44::Cpu, -1); s.record(Arm44::Cpu, NAN); s.record(Arm44::Cpu, INFINITY);
    check("zero, negative and non-finite measurements are ignored", s.n[0] == 0);
    const Arm44 a = s.choose(), b = s.choose(); check("choose() does not change the statistics", a == b && s.decisions == 0);
    AutoArms44 &A = AutoArms44::get(); A.reset();
    A.record(1, 3e6, Arm44::Cpu, 0.03); A.record(24, 3e6, Arm44::Cpu, 0.004); A.record(1, 3e5, Arm44::Cpu, 0.003);
    check("statistics are kept per (thread budget, table-size class)", A.cls.size() == 3 && AutoArms44::key(1, 3e6) != AutoArms44::key(24, 3e6) && AutoArms44::key(1, 3e6) == AutoArms44::key(1, 3.9e6));
    A.reset();
  }
  std::printf("{\"tool\":\"auto44\",\"failures\":%d,\"checks\":[%s]}\n", failures, out.c_str());
  return failures ? 1 : 0;
}
