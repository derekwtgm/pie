# EightMax Windows 3.1

Extract the ZIP, open the EightMax folder and run EightMax.exe (desktop host with the
native engines) or EightMax-Offline.html (browser only). Balanced remains the default
accuracy preset and CPU Only the default scoring device.

**Where this release was built and tested.** Everything below was compiled and
measured on Linux (Ubuntu 24.04, 4 vCPU Intel Xeon Platinum 8573C VM, Node 22.23,
GCC 13). The Windows executables were **cross-compiled** with MinGW-w64 GCC 13
(winpthreads) and exercised **under Wine 9 on Linux**, which is not a Windows
validation. **No NVIDIA GPU was available**: CUDA kernels were compiled and assembled
for sm_75/80/86/89 and executed only through a CPU test double of the driver API.
No figure in this document comes from the owner's i7 / RTX 4060 Ti machine; run
`Validate CUDA hardware.bat` there to produce those.

## 1. What changed

| Area | 3.0 | 3.1 |
|---|---|---|
| Native coverage | Full betting trees built by JavaScript, at most 250,000 states; sampled betting, larger trees and every preflop study trained in JavaScript | Native betting-rule generator + external-sampling MCCFR (spec protocol 4): any tree size within the memory budget; preflop (linked, shove/call), flop, turn, river; 2-8 seats; unequal stacks, multiple all-ins and side pots; chip EV and ICM |
| Automatic full-tree decision | Built up to 250,000 JS states (~290 MiB heap, ~1.3 s), then discarded them and fell back | Counts the tree without keeping it (~0.1 s, ~3 MiB); full traversal up to 20,000 states, native external sampling above |
| Parallel sampled betting | — | Per-deal action streams: deals of a frozen batch run on all cores; result independent of thread count |
| State format | EMMW1/EMMW3 | + EMMW4 (state table + rows, CRC32, study tag, full rules replay on import) |
| CUDA module | NVRTC 12.9 PTX only (needs a CUDA 12.9+ driver to JIT) | PTX + SASS for sm_75/80/86/89 (any CUDA 12 driver); device probe; compute capability ≥ 7.5 check; exact all-in equity kernel |
| Diagnostics | Engine name, device path | Engine, algorithm, players, street, utility, device path and fallback reason, threads, native/browser memory, VRAM buffers, visited states, CUDA status, JS-fallback reason |
| Tests | 172 | {{TESTS}} |

## 2. Native configuration matrix (tested)

"Bit-identical" means the native regrets and average weights equal the JavaScript
reference byte for byte after the same number of iterations, and the derived metrics,
views and visit counters are equal (tests/v31.test.js; the Windows build under Wine
gives the same bytes).

| Configuration | Native algorithm | Status |
|---|---|---|
| 3-player river, 1 deal/update; batches of 4 with per-deal streams on 4 threads | external sampling | bit-identical |
| 3-player flop, unequal stacks, geometric sizing, all-ins | external sampling | bit-identical |
| 3-player flop, CFR+, batches of 8 | external sampling | bit-identical |
| 3-player flop, ICM with an off-table stack | external sampling | bit-identical |
| Heads-up flop, out-of-position seat may not lead | external sampling | bit-identical |
| 8-seat linked preflop → river, unequal stacks (24.9 to 55 bb) | external sampling | bit-identical |
| 8-seat linked preflop, batches of 16, per-deal streams, 4 threads, CFR+ | external sampling | bit-identical |
| 8-seat linked preflop, big-blind ante, limping disabled | external sampling | bit-identical |
| 8-seat shove/call, ICM | external sampling | bit-identical |
| 6-seat flop, earlier and folded wagers, weighted ranges, multiway all-ins | external sampling | bit-identical |
| 6-seat flop, uniform weighting | external sampling | bit-identical |
| River/turn/flop/linked full trees, simultaneous/alternating/enumerate, stratified, ICM (3.0 coverage) | full traversal | bit-identical (v29, unchanged) |
| Compact or Detailed hand groups | — | JavaScript; the result names the reason |
| DCFR, stratified batches with external sampling | — | refused by protocol 4 |

Complete native coverage is **not** claimed: grouped abstractions remain JavaScript.

## 3. Accuracy per second (exactly evaluable games)

Metric: the largest exact unilateral best-response gain of any seat against the trained
average strategy in the configured finite game (`exactCheckSampled`). For three players
this is not an equilibrium certificate. Means ± 95% Student-t half-widths over 5
independent seeds. Timings: single process, 4-vCPU Linux VM; equal-time runs stop at the
first 64-update boundary after the deadline. Source: validation/3.1/bench31.json
(`node tools/bench31.js ...`).

{{BENCH}}

Reading the tables:

- **External-sampling studies (3.0 trained these in JavaScript).** At equal wall time,
  3.1 native external sampling reaches a 2.2-2.5× lower exact gain: 3-player river at 1 s
  0.081 ± 0.020 vs 0.204 ± 0.054 BB; heads-up turn at 1 s 0.44 ± 0.04 vs 1.02 ± 0.09 BB,
  at 4 s 0.21 ± 0.03 vs 0.46 ± 0.05 BB. At equal deal counts the two are identical, as
  expected for a bit-identical port.
- **Full traversal (3.0 native).** Strategies are byte-identical to 3.0 at every
  checkpoint. Repeated interleaved timings show no measurable speed difference (median
  1.269 s vs 1.294 s for 100,000 heads-up turn updates; VM noise ±15%). No accuracy-per-
  second improvement is claimed for this path.
- **Full traversal vs external sampling on small trees.** Full traversal is more accurate
  per second on both games (heads-up turn 1 s: 0.27 vs 0.44 BB). This is why automatic
  native traversal keeps full traversal for trees up to 20,000 states. On ~930-state
  river trees the two were statistically indistinguishable at 4 s, while full-traversal
  throughput falls roughly in proportion to tree size (28,500 deals/s at 928 states).
- **Variants at 1 s on the 3-player river (5 seeds):** linear CFR batch 4 (3.0 default)
  0.073 ± 0.021; batch 1 0.058 ± 0.021; batch 16 0.063 ± 0.012; stratified batch 16
  0.052 ± 0.009; DCFR(1.5,0,2) 0.084 ± 0.002; CFR+ 0.156 ± 0.009; own-hand enumeration
  0.110 ± 0.030. No variant beat the default with non-overlapping intervals, so no default
  was changed.
- Thresholds reached first: mean gain below 0.1 BB on the 3-player river took 100,000
  deals with full traversal and 250,000 with external sampling.

## 4. Large games (exact evaluation intractable)

Six scenarios, 5 seeds, equal wall time. Source: validation/3.1/large31.json
(`node tools/large31.js ...`). The 3.0 path for all of them was JavaScript external
sampling; the 3.1 shared-stream engine runs the identical algorithm. "Root dispersion" is
the mean over the first decision's actions of the standard deviation of the action
frequency across seeds (lower = more settled). It is a stability diagnostic, not an
exploitability bound. The trained-response probe was also tried on the 8-player linked
study and was too noisy to report (gain −0.03 ± 0.11 BB).

{{LARGE}}

## 5. Throughput, threads and memory

8-seat linked preflop → river, 25 bb, two opening sizes, external sampling with batches
of 16 and per-deal streams (validation/3.1/thread-scaling.json):

{{THREADS}}

## 6. CUDA and the hybrid scheduler

- `score.cu` audited against the CPU evaluator; unchanged except that `score7` is now a
  shared device function. A new `equity` kernel enumerates every board completion and
  accumulates 840 integer share units per board, so CPU and GPU totals must be equal
  exactly (not within a tolerance).
- Build: NVRTC 12.9 → compute_75 PTX (ISA 8.8) and ptxas 12.9 → SASS for sm_75, sm_80,
  sm_86 and sm_89. On an RTX 4060 Ti (Ada, sm_89) the host loads the sm_89 image, which
  any CUDA 12 driver accepts. `equity` uses 40 registers and a 128-byte stack frame on
  sm_89, `score` 25 registers (validation/3.1/cuda-build.log).
- VRAM: total and free memory are read before every allocation; buffers stay under the
  configurable cap (default 512 MiB) and leave max(1 GiB, 25%) free, i.e. 2 GiB on an 8 GiB
  card. Buffers are reused and freed on failure and on exit.
- Fallbacks tested with the driver test double: driver missing, no device, compute
  capability 6.1, VRAM pressure, allocation, launch and copy failures, and a deliberately
  corrupted score. Every case returns CPU-identical results with a reason.
- Scheduler change: river starts no longer send batches to the GPU (their scores are
  precomputed per hand). External sampling stays on the CPU: hand scoring is a few
  evaluations per deal against hundreds of state visits, so no GPU advantage is possible
  there. Automatic still calibrates turn/flop scoring with real timings.
- **Not done:** physical GPU execution, GPU utilization, transfer timing, a GPU regret
  reduction and an end-to-end hybrid advantage. Hybrid mode is **not** advertised as
  faster. Changing the scoring device never changes training results (tested).

## 7. Tests

{{TESTDETAIL}}

Two 2.9-era assertions were changed because 3.1 changes the behaviour on purpose:
`studies outside native support` now expects native support (protocol 4) for sampled
betting, and the up-front native table refusal test now requests an explicit full tree
(automatic traversal routes that 8-player river to external sampling). No test was
removed or skipped.

Slow suites: v29's extra time was compilation (native CLI) and a full UI + host rebuild
for one host test. Both are now built once per source fingerprint and shared across
suites. The two push/fold oracle tests (~10 s each) are genuine equilibrium computations.

Sanitizers and static analysis (validation/3.1/sanitizers.log): `-Wall -Wextra -Wshadow
-Werror` clean; ThreadSanitizer and AddressSanitizer + UBSan clean on full-traversal and
external-sampling fixtures, and v29 + v31 (60 tests) pass against an ASan/UBSan build;
cppcheck 2.13 reports no findings for the native engine, CLI, JSON parser and host.

## 8. Checkpoints and recovery

- EMMW4 preserves regrets, averages, the state table, both random generators, counters and
  the study tag; `.emstudy` files (SHA-256) preserve the same through JavaScript.
- Tested: JS → native (3 threads) → native (2 threads) equals uninterrupted JS training
  byte for byte; `.emstudy` round trip then JS continuation equals uninterrupted training;
  memory-budget stop then resume with a larger budget; corrupted, truncated, foreign-study
  and tampered (valid CRC, illegal action) states rejected by both readers; a 3.0
  checkpoint of a 20k-250k-state automatic full-tree study restores.
- Deterministic continuation is not guaranteed across a **memory-budget stop** between
  engines: JavaScript and native account storage differently, so they stop at different
  points. Results before the stop are identical.

## 9. Windows

- `EightMax.exe` and `mwcli.exe` rebuilt from source (PE32+ x64, static; imports
  KERNEL32, SHELL32, WINMM, WS2_32, msvcrt only; `nvcuda.dll` is loaded at run time).
- Under Wine: `mwcli.exe` reproduced the JavaScript reference on all ten external-sampling
  parity cases and the resume/corruption checks; host checks: see VALIDATION-3.1.json.
- Not done: execution on physical Windows, the owner's hardware, Authenticode signing
  (neither executable is signed).

## 10. Known limitations

- Compact/Detailed groups, the heads-up native path and charts are unchanged and train in
  JavaScript or their existing engines.
- No full eight-handed game is solved to an exact Nash equilibrium. Multiplayer figures are
  unilateral-gain measurements in finite abstractions or stability diagnostics.
- External sampling on very small trees is less accurate per second than full traversal.
- The equity kernel is not yet used by the solvers; it is exposed through `/api/equity`,
  `mwcli --equity` and the hardware validation.
