# EightMax Windows 5.1

Build **7d08acc7eb4577ee**. The two Windows builds are byte-identical, and EightMax.exe, mwcli.exe, gpustress.exe, BUILD-INFO.json and the source fingerprint all report this build. The fingerprinted source (native, web, wasm, tools, workflow, VERSION) last changed in commit f94a1d7. The last test change is 7609665 (`tests/v40.test.js`, `tests/v51.test.js`; tests are not fingerprinted). Later commits add only documentation and evidence, so the fingerprint is unchanged.

**Baseline check (done first).** The 5.0 archive verified against its `SHA256SUMS.txt` (1,167 files OK, 0 failed), and mwcli.exe reports build 9ee5a8be32f5146e. The figures from `device-results(7).json` used below (CPU 65.2 ms, Automatic 65.1 ms, GPU 170.7 ms, Hybrid 159.5 ms, 96 calibrations, one checksum) are taken from your request. That file is not in this environment, so I could not re-check its exe hashes here. `Windows-self-test(7).json` and `hardware-validation(7).json` were named in the request but not attached. Your device results (RTX 4060 Ti, 24 logical CPUs) are therefore the only physical-GPU evidence, and they describe **5.0**.

**Measurement machine.** Every 5.1 timing below was measured on one machine: an Intel Xeon @ 2.10 GHz with 4 logical CPUs, Linux, and **no NVIDIA GPU**. The "test double" is a simulated CUDA driver (`source/tests/cuda_driver_fixture.cpp`). Windows numbers come from GitHub Actions `windows-latest` (no GPU) or Wine 9.0.

## Answers

| Question | Answer |
|---|---|
| **1. Did the six-player candidate improve quality at equal time? By how much, and how certain?** | **Yes on the six-player games, but it is not promoted, because a control failed the pre-registered margin.** The candidate is `warm-4-256`: batches start at 4 deals and double every 256 committed updates, up to 64, on 4 threads. It was chosen on development seeds 601–610 and frozen in commit b2db957 before confirmation. On 40 fresh paired seeds (701–740), the NashConv ratio vs the 5.0 default at 1 s of training was **flop6 0.69 [0.56, 0.85]** (Holm p = 0.0008) and **flop6w 0.61 [0.54, 0.68]** (Holm p = 4e-10). At 0.3 s it was 0.61 and 0.71. The control river3 was worse at 0.01, 0.03 and 0.1 s (ratios 1.08, 1.13 and 1.08). Their 95 % upper bounds (1.22, 1.21, 1.21) exceed the pre-registered non-inferiority margin of 1.15. **The 5.0 default (batchDeals 1) is unchanged, and `batchSchedule` is an opt-in native/CLI option.** These figures were measured with 4 training threads on the 4-CPU machine, not on your 24-thread i7. NashConv here is the sum of exact best-response gains inside each abstraction, not exploitability of the full game. |
| **2. How many calibrations remain on the original fixture, and how did process time change?** | On the original 2,400-deal turn with the test double, **GPU Preferred and Hybrid now perform 1 calibration each instead of 96** on the measurement machine; the other 99 batches reuse it. When CPU and device measure within 1.35× of each other, the rule measures again at each new largest batch size: 5 times on the GitHub runner, and at most 8 in a cost sweep. The Wine run of the Windows exe gives the same count. Calibration time is 5.0 ms → 0.05 ms (GPU Preferred) and 8.6 ms → 0.09 ms (Hybrid). That is the simulated driver's cost, not the RTX's. Process time on the simulated driver, median of 9 interleaved rounds: GPU Preferred 0.144 → 0.149 s, Hybrid 0.150 → 0.139 s. Run-to-run variation (the IQR) is as large as these differences, so no speedup is claimed. Strategy bytes and RNG equal CPU Only in every mode (`91786e3a…`). **Not measured on your RTX 4060 Ti.** Your 5.0 report puts calibration at 7.6 ms (GPU) and 10.9 ms (Hybrid) of a 105–94 ms gap to CPU Only. 5.1 can remove at most about that much. The rest is CUDA driver initialisation and the GPU route itself, which 5.1 does not change. Explicit-mode probing, measured CPU fallback and the Automatic shortcut are preserved. |
| **3. Do old and new adaptive checkpoints resume deterministically?** | **Yes.** 4.9 and 5.0 checkpoints (raw and EMZ1), written by the release binaries, resume in 5.1 to the golden states: `aa809741…` for the ICM final table, and es 120 `d7821ad6…` for the 5.0 six-player state. A schedule state saved before, at and after every batch-size change resumes byte-identically to an uninterrupted run on 1 and 4 workers. Those save points are 4, 5, 6, 9, 10, 11, 14, 15, 16 and 23, including a short final batch, plus EMZ1 and 24 single-update calls. Identical means regrets, average strategy, both RNGs, deal and update counters, and schedule state. Cancellation and a memory-budget stop inside an uncommitted batch both leave the last committed state, which continues identically. A mismatched schedule is refused. No wall-clock value enters any deterministic decision. |
| **4. Windows tests: passed, failed, skipped? Which 5.1 results are from physical NVIDIA hardware?** | Windows CI run 61 on the final test commit 7609665 (GitHub `windows-latest`, no GPU) ran the full regression against the shipped `mwcli.exe` and `EightMax.exe`: **478 passed, 0 failed, 33 skipped, 0 timed out**. The concurrency stress (5 × 9), the release verification (1,237 SHA-256 entries) and the GCC and Clang compiler jobs all passed. The 33 skips are 26 Linux-only CUDA test-double tests (on Windows, the DLL test double covers this path in v50/v51), 4 sanitizer suites (run on Linux in `sanitize51.sh`), 1 Linux-only allocation fault injection and 1 POSIX permission test. Three earlier runs of this release failed, and each cause is fixed and listed in `validation/5.1/windows-ci/run61-summary.json`. **No 5.1 result was measured on physical NVIDIA hardware.** Every GPU-path result uses the simulated driver, on Linux, Wine or the Windows runner. |

## 1. Six-player quality per second (requirement 1)

**Why parallel64 was faster without a confirmed gain.** The data is in `validation/5.1/six-player/diagnosis.json`: seed 601, 64,000 deals, median of 5 interleaved runs.

| flop6w | µs / deal | committed updates | threads |
|---|---|---|---|
| default | 9.22 | 64,000 | 1 |
| parallel64, 1 thread | 8.13 | 1,000 | 1 |
| parallel64, 4 threads | 4.22 | 1,000 | 4 |
| warm-4-256, 4 threads | 4.52 | 1,784 | 4 |

- **Where the speed comes from.** About 1.9× comes from the threads. Another 12–30 % comes from batching itself, because merges run 64 times less often.
- **What it costs.** Updates become visible 64 times less often. Each committed update averages 64 deals played against a frozen policy, so quality per deal is lower early on.
- **Why small games regress.** In river3 a batch never reaches the 2,000-visit threshold for parallel execution: parallel64 used 1 thread there. It pays the batching cost and gets no threading gain, which is the early regression 5.0 reported (equal time at 0.01 s: 1.73 [1.53, 1.96] vs default).
- **Determinism.** parallel64 gives the same strategy bytes on 1 and 4 threads.

**Candidate.** A batch schedule that grows after warm-up (`batchSchedule: {start, doubleEvery}`). Batch t has min(batchDeals, start·2^⌊t/doubleEvery⌋) deals.
- **Deal weighting.** Increments are weighted by deals (divided by batchDeals), and the linear-averaging step counts deals. Development round 1 weighted by updates, which overweighted the warm-up: turn4 came out 20–180× worse. That is kept in `development-round1-update-weighted.json`.
- **Equivalence.** A schedule that starts at batchDeals is byte-identical to the fixed batch (test).
- **Restrictions.** Requires per-deal action streams, protocol 4 and start ≥ 2, and rejects DCFR.

**Protocol.** Frozen in `preregistration.json` before confirmation.
- **Primary metric:** paired ln(NashConv candidate / NashConv default) at equal training time. The four primaries are flop6 and flop6w at 0.3 s and 1 s, Holm-adjusted.
- **Promotion rule:**
  - estimate ≤ 0.80 and Holm p < 0.05 at both 1 s primaries;
  - no primary estimate above 1;
  - every control budget (river3 0.01–0.3 s, turn4 0.01–0.3 s) with a 95 % upper bound ≤ 1.15.
- **Seed count:** 40, justified by a development SD of 0.35–0.55 and a 20 % minimum meaningful effect.
- **Equal time:** log-log interpolation inside observed ranges; seeds outside a range are excluded and counted, never clamped. Budgets with more than 25 % excluded seeds do not count; only turn4 at 0.01 s, with 38 of 40 excluded.
- **Evaluator and memory:** one evaluator for every arm (`mwcli --gain method=exact`, separate process) and the same table budget for every arm.

**Confirmation** (`confirmation.json`, `decision.json`; ratios vs the 5.0 default; lower is better):

| game | 0.01 / 0.03 s | 0.1 s | 0.3 s | 1 s |
|---|---|---|---|---|
| flop6 warm-4-256 | 0.92 [0.82, 1.04] (0.03 s) | 0.71 [0.60, 0.83] | **0.61 [0.50, 0.74]** | **0.69 [0.56, 0.85]** |
| flop6w warm-4-256 | 1.03 [0.94, 1.12] (0.03 s) | 0.85 [0.79, 0.92] | **0.71 [0.66, 0.77]** | **0.61 [0.54, 0.68]** |
| river3 warm-4-256 | 1.08 [0.95, **1.22**] / 1.13 [1.05, **1.21**] | 1.08 [0.96, **1.21**] | 1.02 [0.94, 1.11] | – |
| turn4 warm-4-256 | excluded / 0.79 [0.64, 0.96] | 0.48 [0.37, 0.62] | 0.49 [0.40, 0.60] | – |
| flop6 parallel64 | 0.68 (0.03 s) | 0.55 | 0.55 | 0.75 |
| flop6w parallel64 | 0.77 (0.03 s) | 0.72 | 0.67 | 0.56 |
| river3 parallel64 | 1.73 / 1.42 | 1.08 | 1.06 | – |
| turn4 parallel64 | 0.95 / 0.49 | 0.38 | 0.46 | – |

- **warm-4-256 vs parallel64** (secondary): it removes most of parallel64's early river3 regression (0.62× parallel64 at 0.01 s). It is worse early on the six-player games (1.36× at 0.03 s on flop6) and equivalent at 1 s (flop6 0.93 [0.78, 1.10], flop6w 1.08 [0.97, 1.21]).
- **Equal deals:** close to 1 on the six-player games (0.90–1.09), worse on river3 (1.14–1.34).
- **Resources:** per-seat gains, deals, committed updates, training time, evaluation time and peak RSS for every arm are in `decision.json` and `confirmation.json`. Training peak RSS was about 8 MiB for every arm.
- **Decision:** the rule fails on river3, so the default is kept.
- **New finding:** with 40 seeds, fixed parallel64 is also significantly better than the default at equal time on the six-player games on this 4-CPU machine. Its river3 regression is larger still, so it remains opt-in as well.

## 2. CUDA calibration reuse (requirement 2)

**Rule** (`native/route_reuse.hpp`, `native/score_schedule.hpp`).
- **What is stored.** A measurement at batch size u0 stores the route (CPU or device), the CPU and device seconds and ρ = device/CPU. Measurements are kept per engine (up to 16), keyed by device mode and GPU budget.
- **CPU record.** Covers [u0/4, u0·min(4, max(1, ρ/(0.9·1.5)))]: it extends upward only as far as the measured CPU margin allows, with a safety factor of 1.5 around the 0.90 crossover.
- **Device record.** Covers [u0·max(¼, min(1, 1.5ρ/0.9)), 2·u0].
- **When it recalibrates.** Outside every window, after 256 uses, on a different mode or budget, and after any device failure. A failure falls back to the CPU and clears all records.
- **Report.** Every recalibration reason is counted in the device report.
- **Diagnostic switch.** `EM_ROUTE_REUSE=0` restores exact-size reuse.

**Device report** (`mw_info` `scheduling`, `test_devices.ps1 -Repeats N`, `tools/devices51.js`). It adds per-call batches scored, batch size range, calibrations, reuses, recalibration reasons, driver initialisation seconds, scoring seconds, device transfer+kernel seconds, measurements held and the reuse rule. Training time, process time, peak GPU bytes and the checksum are kept.

**Tests** (`tests/v51.test.js` part 1, `tests/route51.cpp`).
- **Affine cost model, 240 jobs:** 48,240 batches, 3,299 measured, 44,941 reused, 0 reused decisions different from an exact measurement.
- **Original fixture:** parity with CPU Only, and far fewer calibrations than exact-size reuse. The count depends on the measured CPU/device ratio, so the test checks a timing-independent property instead: no measurement is repeated where an earlier one guarantees reuse. A CPU record covers at least [u0/4, u0] and a device record at least [u0, 2u0]. The count is 1 on the development machine. On the GitHub GCC runner, Hybrid measured 5 times: the simulated device and the CPU were within 1.35×, so a CPU record is deliberately not extended to larger batches, and each new largest batch size is measured. In a sweep of simulated CPU costs, the count stayed between 1 and 8 of 100 batches, with no redundant measurement. The first version of this test assumed ≤ 3 and failed on that runner (run 57). The assumption came from one machine's timing, so it was replaced by the property above.
- **GPU-profitable costs:** CUDA or Hybrid on every batch.
- **CPU-profitable costs:** CPU throughout.
- **Crossover inside one job:** both routes, no CPU batch above 1.06× the smallest GPU batch, fewer than 20 calibrations. The device benchmark switched at 157/158 units.
- **ES parity.**
- **Launch, download and checksum faults:** all fall back to the CPU with identical bytes.
- **Test-only switches:** the controllable test double (`EM_FIXTURE_LAUNCH_US`, `EM_FIXTURE_LANE_NS`) and the CPU cost switch (`EM_TEST_CPU_SCORE_NS`).

**5.0 vs 5.1** (`validation/5.1/scheduling/devices51.json`, 9 interleaved rounds). The only fair cross-version environments are no driver and the plain test double. 5.0 ignores the 5.1 cost switches, so in the "gpu-profitable" and "crossover" environments only the 5.1 rows are meaningful. There, 5.1 chose CUDA, Hybrid or the per-size route, with 1–6 calibrations, and every state was identical to CPU Only. Results on the plain test double are in Answer 2. The 2,560-deal external-sampling workload already made 1 calibration in 5.0 and is unchanged.

## 3. Deterministic continuation (requirement 3)

**Persistent state.**
- regrets and the average strategy;
- the sampling and action RNGs;
- `iterations` (committed updates) and `trainingDeals`;
- the schedule (`batchSchedule` in the spec);
- the consistency check `trainingDeals == dealsBefore(iterations)`, verified at load.

The current batch size is derived from these, never stored separately, and no timing value is stored. Tests in `tests/v51.test.js` part 2 cover the points in Answer 3. The fixtures in `validation/5.1/fixtures/` were written by the release 5.0 Linux binary. The memory-budget stop test (3 MiB) asserts that the output file equals the uninterrupted state at the last committed update, and that continuing from it equals the uninterrupted run.

## 4. Intermittent v40 deadline test (requirement 4)

**What is recoverable from run 53.** Only the test name: "4.0 deadlines hold for other limits and games, and the evaluator stays responsive after repeated timeouts". The artifact host is blocked from this environment, so the exact assertion and timing are lost. `tools/run_tests.js` now prints each failing assertion's message, expected and actual values and location in the log. The v40 messages now include the evaluator's telemetry: stop observed, longest check gap, its site and time.

**Repeats** (`tools/deadline51.js`, `validation/5.1/deadline/`). The script repeats every assertion of the test and records, per query:
- process start and load time (the queue/start delay);
- query time;
- when the stop was observed;
- the return delay after the observation;
- the longest gap between deadline checks, with its site and end time;
- any overlapping stall seen by an independent 1 ms sleeper (`tests/stall51.c`).

Results, by run:

| run | trials | failing | overshoot max (p95) | stop observed after limit, max |
|---|---|---|---|---|
| idle, first run (Linux) | 20 | **1** | 162.6 ms (8.7) | 4.3 ms |
| 8 busy processes on 4 CPUs | 20 | 0 | 42 ms (18) | 12.9 ms |
| idle, with stall detector | 100 | 0 | 29.6 ms (8.0) | 0.6 ms |
| 8 busy processes, with stall detector | 100 | 0 | 51.9 ms (18.1) | 20.7 ms |
| failing query alone (`icmFinal` exact, 100 ms) | 3,000 runs | 0 | 26.7 ms (p99.9: 7.2) | – |

**The one failure.**
- **Where:** ICM final table, exact method, 100 ms limit.
- **What happened:** the query took 262.6 ms. The evaluator observed the stop at 100.0 ms, but one worker went 211 ms between two deadline checks, so the join waited for it.

**Conclusion.** Cancellation itself was observed promptly in every one of the 5,280 deadline queries of the test mix and the 3,000 isolated runs. The failure is a single long gap in one worker, seen once in those 5,280 queries, and it did not recur in 200 further trials or the 3,000 isolated runs.
- With so few events I cannot attribute it reliably to the app, the test or the runner.
- No code path produced a gap over 80 ms idle in 200 trials, and the detector saw no machine stall alongside any long gap.
- The candidates are a worker descheduled by the host (the first run had no detector), or a rare long uninterrupted unit of work.

**Second failure mode, found by CI on the final commit (run 60): a test defect, now fixed.** With the new failure details, the Windows log showed `expected: 408, actual: 200` in the same test. An exact evaluation that the test expected to time out returned a completed result inside its limit. The cause is the test's workload assumption. Unlimited, the push8 exact evaluation takes about 1.4 s here (1.37–1.59 s over 5 runs), so a faster runner can finish it inside 600 ms or even 250 ms. linked8 takes about 100 s and icmFinal over 10 minutes, so those can never finish. A completed exact result inside the limit is correct behaviour, not a missed deadline.

The test now:
- still requires a timeout (408) for every exact case at 100 ms, and for linked8 and icmFinal at every limit;
- accepts a completed result for push8 at 250 and 600 ms, provided the result is complete and finite;
- keeps the time assertion (limit + 150 ms) unchanged for every case.

Run 53's lost assertion was very likely this one: the same test, on a Windows runner. That cannot be proven without its log.

**Action.** The 150 ms tolerance is unchanged. The test now reports the telemetry needed to attribute the next occurrence. The 95 % upper bound on the per-run failure rate of this test on this machine is 2.3 % (1 in 240 trials, Clopper-Pearson).

## 5. Validation and preserved behaviour (requirement 5)

**Preserved behaviour.**
- MTT defaults: 0.5 SB, 1 BB, 0.1 BB ante, 2.3 BB pot.
- Weighted ranges, multiple bet sizes, 6-player postflop, chip EV and ICM, side pots.
- The four processing modes and all checkpoint formats.
- Training code for every existing option: default and parallel64 states are byte-identical to release 5.0, and golden `aa809741…` is unchanged.

**Weighted six-player response evaluator** (`validation/5.1/bench/brbench-flop6w-50-vs-51.json`, same machine, 5 interleaved rounds). Results are bit-identical to 5.0. Time is ×1.022 [0.994, 1.051], with no supported difference. Peak RSS is 28.5 MiB vs 28.9 MiB.

**Sanitizers** (`tools/sanitize51.sh`, `validation/5.1/sanitizers/`). All passed. The run includes:
- the whole 5.0 pass;
- `tests/v51.test.js` under ASan+UBSan: 13 passed;
- route reuse across consecutive calls under ASan+UBSan and TSan: calls 2 and 3 reuse every measurement;
- the parallel warm-up schedule under ASan+UBSan and TSan, with state bodies equal across builds.

**Linux regression.** Full suite from a clean clone: **510 passed, 0 failed, 1 skipped**. The skip is the read-only-folder test, because permissions are not enforced as root. The two test files changed afterwards (v40, v51) were rerun at the final commit: 30 passed, 0 failed.

**Wine.** `mwcli.exe --selftest47/48/49`: 10 + 9 + 15 checks passed. The Windows exe with the test-double DLL makes 1 calibration and 99 reuses in GPU Preferred and Hybrid, with bodies identical to CPU Only (`91786e3a…`).

**Windows CI.** See Answer 4 and `validation/5.1/windows-ci/`.

## Limitations

- **No GPU in any 5.1 measurement.** The calibration saving on your RTX is expected to be at most the 7.6 / 10.9 ms that your 5.0 report attributes to calibration. That is not verified. Run `Compare processing modes.bat` to measure it; in 5.1 it runs 5 interleaved rounds per mode (`test_devices.ps1 -Repeats 5`) and reports medians.
- **Thread count.** Six-player results used 4 threads. On 24 threads both batched trainers parallelise further. The river3 regression comes from batching without parallelism, so it would not shrink.
- **Deadline failure.** One failure in 240 trials remains unexplained (section 4).
