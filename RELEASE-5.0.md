# EightMax Windows 5.0

Build **9ee5a8be32f5146e**, commit @@COMMIT@@. EightMax.exe, mwcli.exe, gpustress.exe, BUILD-INFO.json
and the source fingerprint agree. Two independent Windows builds are byte-identical.

The 4.9 baseline was checked before any work started. The archive's `SHA256SUMS.txt` verified, and the
build was 278035e3bb5bcaa6. The executable SHA-256 values in your `Windows-self-test.json` equal the
shipped 4.9 executables, so your reports describe exactly that build. `hardware-validation.json`
records a physical RTX 4060 Ti (compute 8.9, `physicalNvidiaExecution: true`).

## Answers

| Question | Answer |
|---|---|
| Does Automatic now skip CUDA on the exact workload? | **Yes.** The 2,400-deal three-player turn from "Compare processing modes" never loads the CUDA driver library in 5.0 Automatic. The test double records 0 `cuInit` calls (4.9: 1), 0 calibrations and 0 GPU bytes (4.9: 3,979 B, the same figure as your RTX report). It produces the same strategy bytes and RNG as CPU Only. The regression test fails on 4.9 and passes on 5.0. |
| What changed in training and process time, and on which hardware? | Measured only on a 4-CPU Xeon Linux machine with a **simulated** CUDA driver (no GPU), over 9 interleaved rounds. Turn workload in Automatic mode: training median 0.1169 s on 4.9 vs 0.1096 s on 5.0; process median 0.1321 s vs 0.1242 s. That is about 7 ms here, but this is only the cost of the test double; the real cost of opening CUDA is much larger. **Not measured on your RTX 4060 Ti.** Your 4.9 report shows 172.9 ms Automatic vs 63.2 ms CPU, and 5.0 should land near CPU Only, but that needs your PC to confirm. The 2,560-deal external-sampling workload was already skipped by 4.9 and is unchanged. |
| Did the final Windows regression pass, and what was skipped? | @@WINANSWER@@ |
| Do existing checkpoints resume to the same state? | **Yes.** A 150-update state written by 4.9, both raw and EMZ1, resumes in 5.0 to the golden 300-update state `aa80974199182afa…`. Self-tests 47/48/49 pass, covering 150+150, 500+500 and 1000+1000, compressed and uncompressed inputs, corrupted and truncated inputs, the temp-folder fallback and concurrent restores. They pass on Linux, under Wine, on the Windows runner and under ASan+UBSan. A failed restore leaves the existing output unchanged. Training code and state bytes are unchanged from 4.9. |
| Did the six-player candidate improve strategy quality per second? | **Not demonstrated.** Candidate `parallel64` trains with 64 deals per batch across 4 threads. It cut training time 31–44 % on the six-player flops. At equal time its NashConv was 25 % lower on flop6 and 31 % lower on flop6w at the final budget, but neither result was significant after Holm adjustment (flop6w unadjusted p = 0.02). On fresh seeds it was **worse in 4 of 64 comparisons**: the first checkpoint on river3 and turn4, at equal deals and again at equal time. It was better in 0. **Not promoted; the default trainer is unchanged.** |
| Which results are physically verified, and which remain unmeasured? | See the last section. |

## 1. Automatic scheduling (requirement 1)

**Cause.** In 4.9 the Automatic small-job rule lived in `ScoreSchedule::run` (`native/score_schedule.hpp`) and
required `plannedUpdates > 0`. Only the external-sampling path (`es::train`) set `plannedUpdates`. The
sampled-deal paths in `mw_train` (simultaneous, alternating and enumerated updates, which is the
"Compare processing modes" workload) left it at zero. As a result, Automatic always opened CUDA, calibrated
and then usually fell back to the CPU. The fallback itself was correct, which is why the strategy bytes
were already identical.

**Repair.** A new function, `beginScoringCall(MW&, iterations, path)`, runs at the start of every training
call on both paths. It sets the planned updates, resets every per-call diagnostic (decision, reason,
calibrations, calibration seconds, peak GPU bytes, whether CUDA was opened) and records the training path.
- **Resumed calls:** a resumed call counts only its own updates. The projection uses the cached per-update
  CPU time when one exists; otherwise it projects from the first measured batch.
- **Short final batches:** these count at their actual size.
- **Threshold:** still configurable through `EM_AUTO_MIN_SCORE_SECONDS` (default 0.5 s).
- **Other modes unchanged:** GPU Preferred and Hybrid still open CUDA and measure, and may still fall back
  to the CPU. CPU Only never opens CUDA.

**Tests** (`tests/v50.test.js`, 7 tests). Each test checks the canonical strategy body, RNG, deals and
visits against CPU Only. Driver use is checked through the test double's statistics: the statistics
file is written only if the driver library was loaded, and it now includes a `cuInitCalls` counter. A
timing assertion alone would not be enough.
1. **Turn workload, below the threshold:** the driver is never loaded, with zero calibrations and zero
   GPU bytes. This is the test that **fails on 4.9** (`validation/5.0/scheduling/v50-on-4.9.tap`: driver
   loaded, cuInit 1).
2. **Above the threshold** (threshold 0): Automatic opens and measures.
3. **GPU Preferred and Hybrid:** they open, calibrate and keep their measured CPU fallback.
4. **External-sampling shortcut** (`es-six-weighted`, batch 64, 40 updates = 2,560 deals): still skipped.
5. **One engine, consecutive calls** of 10, 20,000 and 10 updates (`tests/sched50.cpp`): short → skip,
   long → open, short → skip. Diagnostics reset each call, and the final strategy matches CPU Only.
6. **Scheduling report:** the block is present on both paths.
7. **Checkpoints:** 4.9 checkpoints resume to golden, and a corrupted EMZ1 restore keeps the existing
   output.

On Windows, CI builds the test double as `nvcuda-fixture.dll`. It is loaded only when the test-only
variable `EM_TEST_CUDA_LIBRARY` holds an absolute path; normal loading is still System32 `nvcuda.dll`
only. This means tests 1–6 also run on the real Windows runner.

## 2. Device report (requirement 2)

`mw_info` (and therefore `test_devices.ps1`, "Compare processing modes" and `validate_hardware.ps1`) now
includes a `scheduling` block with the following fields:
- `trainingPath`, `requestedDevice`, `plannedUpdates`
- `projectedCpuScoreSeconds`, `thresholdSeconds`
- `automaticSkippedCuda`, `cudaOpenedThisCall`
- `calibrationsThisCall`, `calibrationSecondsThisCall`, `gpuBufferPeakBytesThisCall`
- `decision` (for example "CPU without opening CUDA", "CPU after measuring CUDA", "CUDA" or "Hybrid") and
  `reason`

The `test_devices.ps1` rows also add `rng`, the training time, the process time and the state checksum.

`tools/devices50.js` compares 4.9 and 5.0 over 9 interleaved rounds, rotating the order each round. Both
workloads ran in two environments: no driver, and the simulated driver. The table shows medians with
the interquartile range in brackets (`validation/5.0/scheduling/devices50.json`; Xeon 2.1 GHz, 4 logical
CPUs).

| Workload, environment, mode | 4.9 training s | 5.0 training s | 4.9 process s | 5.0 process s | Driver loaded 4.9 → 5.0 |
|---|---|---|---|---|---|
| turn 2,400, simulated driver, **auto** | 0.1169 [0.1168–0.1218] | **0.1096** [0.1066–0.1104] | 0.1321 | **0.1242** | yes (cuInit 1, 3,979 B) → **no** |
| turn, simulated driver, cpu | 0.1094 | 0.1081 | 0.1237 | 0.1228 | no → no |
| turn, simulated driver, gpu | 0.1389 | 0.1428 | 0.1532 | 0.1585 | yes → yes (96 calibrations) |
| turn, simulated driver, hybrid | 0.1312 | 0.1216 | 0.1458 | 0.1379 | yes → yes |
| turn, no driver, auto | 0.1116 | 0.1120 | 0.1256 | 0.1269 | no → no |
| ES 2,560, simulated driver, auto | 0.0588 | 0.0567 | 0.0947 | 0.0929 | no → no (already skipped in 4.9) |
| ES, simulated driver, gpu | 0.0601 | 0.0621 | 0.0957 | 0.0989 | yes → yes (1 calibration) |

Every row has the same state body and RNG as CPU Only, and is consistent across rounds. The turn workload
in GPU Preferred and Hybrid runs 96 calibrations because enumerated batches vary in size. This is the same
as 4.9 and was recorded, not changed. **No RTX timing was measured.**

## 3. Windows release validation (requirement 3)

**Toolchain identification.** A CI step, "Identify the release toolchain and its dependencies", pins the
MSYS2 UCRT64 g++ and records it in `windows-toolchain.json`. That file holds the path, version, target,
thread model, and the zlib and bcrypt link dependencies. The step exports `EM_TEST_CXX` and `EM_TEST_CC`,
so the compiler-dependent tests use exactly that compiler. A separate `compilers` job (Ubuntu) runs
`tests/v49.test.js` and `tests/v50.test.js` built with GCC and with Clang.

**Skip audit.** Windows CI run 52 (4.9 tests plus v50) had 36 skips, now all named in the log by
`run_tests.js`. Three of them, the v43 unit programs, the v44 coverage units and the v44 Automatic-arm
units, now run on Windows through `EM_TEST_CXX`. @@SKIPS@@

**Final runs (after the last source and test change, commit @@COMMIT@@):**

@@FINALRUNS@@

## 4. Checkpoint recovery (requirement 4)

| Check | Linux | Wine | Windows runner | ASan+UBSan |
|---|---|---|---|---|
| `--selftest47` (10) | pass | @@W47@@ | @@CI47@@ | 10/10 |
| `--selftest48` (9) | pass | @@W48@@ | @@CI48@@ | 9/9 |
| `--selftest49` (15: EMZ1 levels, 150+150, 500+500, 1000+1000, temp fallback, Unicode/long temp, corrupted/truncated/SHA-mismatch refused, 4 concurrent restores, no leftover) | pass | @@W49@@ | @@CI49@@ | 15/15 |
| 4.9-written raw + EMZ1 checkpoint → golden (v50 test 7) | pass | – | @@CIV50@@ | pass |
| EMZ1 fuzz, 300 flips/truncations | – | – | – | 300/300 refused, nothing written |

Comparisons cover the canonical state (header-independent body SHA-256), RNG, counters and strategy
bytes. The 4.9 150-update state `1ff8be8d…` equals `icm45a.state` from your Windows self-test.

**Sanitizer coverage.** `tools/sanitize50.sh`, log at `validation/5.0/sanitizers/` (@@SANSTATUS@@). The
pass covers:
- ASan+UBSan builds of mwcli running the three self-tests, the EMZ1 fuzz, and `v49` plus `v50` against
  the sanitized CLI.
- `sched50` (scheduler, `ScoreSchedule`, `beginScoringCall`, the driver path through the test double)
  under ASan+UBSan and under ThreadSanitizer, in Automatic and GPU Preferred modes with 4 threads.

It does not cover:
- the CUDA kernels, since there is no GPU;
- the Windows-only code (`LoadLibraryExW`, `temp_file.hpp` Win32 branch), because MinGW has no ASan;
- the GUI and web front end.

## 5. Six-player research (requirement 5)

**Choosing the candidate.** The 4.9 raw results showed that the default trainer is not limited by the
estimator on the six-player flops. No estimator variant beat it at equal time. What does limit it is
**wall time per sampled deal**: training is single-threaded at the default batch size, because the ES
path parallelises only when `visitsPerDeal × batch ≥ 2000`. The candidate `parallel64` (64 deals per
batch, deal-indexed action streams, 4 training threads) targets that bottleneck. The estimator is
unchanged; only the batching and thread scheduling differ. `parallel16` was tried first and stayed
single-threaded.

**Stage A (reproduction).** On seeds 401–403, flop6 with the default trainer reproduced the 4.9
`convergence48` figures exactly (`stageA-reproduction.json`).

**Stage B (fresh confirmation).**
- Seeds 501–510, paired, on six games: flop6, flop6w (weighted ranges, multiple bet sizes), hu-river,
  river3-chip, turn4 and bubble4.
- Budgets of 4k, 20k, 50k, 100k and 250k deals (500k for the smaller games), with a 512 MiB table budget.
- Evaluation is an exact best response for every seat at each checkpoint, run separately from training
  and deterministic, on 4 threads.
- Comparisons are paired ln-NashConv differences at equal deals and at **equal time**, using a Student t
  test, with Holm adjustment over 64 comparisons.

The equal-time method was corrected in 5.0. In 4.9, the faster arm's curve was clamped, which made
equal time collapse into equal deals. Both curves are now interpolated (log-log) at the earlier of the
two arms' times, and extrapolated seeds are counted. The first, clamped run is kept as
`stageB-first-run-clamped-equal-time.json`.

| Game (final budget) | Default NashConv (±95 %) | parallel64 | Training s, default → p64 | Equal-time ratio | Equal-deal ratio | Eval s | Peak RSS |
|---|---|---|---|---|---|---|---|
| flop6, 250k | 0.0621 ± 0.0152 | 0.0621 ± 0.0219 | 1.36 → 0.93 | 0.75 (n.s.) | 0.92 (n.s.) | 0.73 | 7.6 MiB |
| flop6w, 250k | 0.2280 ± 0.0317 | 0.2384 ± 0.0642 | 1.98 → 1.10 | 0.69 (p 0.02, Holm 1.0) | 0.99 (n.s.) | 10.4 | 7.1 / 8.0 MiB |

Result: 0 better, and 4 worse (river3-chip and turn4 at the first 4k checkpoint, at both equal deals and
equal time; equal time is extrapolated there). Every other comparison was not significant.
Per-seat gains, per-seed values, training and evaluation times and peak RAM are in
`stageB-confirmation.json`. **Exactness:**
- NashConv and the per-seat gains are **exact** best-response values. They are measured *inside each
  abstraction* (restricted game), so they are **not exploitability**.
- The training itself is sampled.
- The uncertainty comes from seeds.

**Decision:** `parallel64` stays experimental (`batchDeals` and `actionStreams` remain opt-in), and
the default is unchanged.

## 6. Preserved behaviour and packaging (requirement 6)

The following are unchanged:
- MTT defaults: 0.5/1 blinds, 0.1 BB antes, 2.3 BB pot.
- Weighted ranges, multiple bet sizes, and up to six-player postflop play.
- Chip EV, ICM and side pots.
- Checkpoint formats (raw and EMZ1), and the training code and its state bytes (golden hash).
- All four device modes.

**Weighted six-player response-evaluation benchmark, 4.9 vs 5.0** (`validation/5.0/bench/`):
- **flop6w:** 10.51 s / 28.9 MiB on 4.9 vs 10.15 s / 28.5 MiB on 5.0 (ratio 0.978, n.s.), with
  identical result bits.
- **flop6:** a recheck over 11 rounds gave a ratio of 1.006 (n.s.).

The packaged 4.9 reference (7.50 s, 28.3 MiB) was measured on a faster day of this shared machine. The
relevant comparison is the paired one above, and it shows equivalence.

## What is physically verified, and what is not

| Verified | Where |
|---|---|
| Automatic skips CUDA on the turn workload, with parity to CPU Only | Linux test double, and the real Windows runner with the test-double DLL (v50) |
| Full regression | Linux clean checkout; real Windows Server runner (GitHub Actions) |
| Self-tests 47/48/49, 4.9 checkpoint resume | Linux, Wine, Windows runner, ASan+UBSan |
| Byte-identical Windows builds, ZIP manifest and smoke test | build machine (section "Package") |
| Response-evaluation equivalence 4.9 = 5.0 | Linux, Xeon 4 CPUs |
| Six-player study | Linux, Xeon 4 CPUs |

| **Unmeasured** | Why |
|---|---|
| Automatic timing on your RTX 4060 Ti (expected to fall from 172.9 ms toward the 63.2 ms CPU time) | no NVIDIA GPU here; run "Compare processing modes.bat" |
| Any real CUDA execution, kernels or GPU memory of 5.0 | no GPU; 5.0 does not change the kernels |
| Timing on a 13th-generation i7 with 24 threads | not available; the six-player speed-up depends on core count |
| Windows-only code under sanitizers | MinGW has no ASan |
