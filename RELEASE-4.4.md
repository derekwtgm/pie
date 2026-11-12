# EightMax Windows 4.4

Development environment for everything below unless stated otherwise: Linux
(Ubuntu 24.04), **4 logical CPUs**, 15 GiB RAM, GCC 13.3, MinGW-w64 GCC 13
(posix), Node 22, Python 3.13, Wine 9.0. **No physical Windows desktop, no
Windows PowerShell and no NVIDIA GPU were available.** What that means for each
kind of evidence:

| Label used below | What actually ran |
|---|---|
| Linux native | the engine compiled for Linux, on the 4-CPU build machine |
| Windows cross-compilation | `EightMax.exe`, `mwcli.exe`, `gpustress.exe` built with MinGW-w64; built twice, byte-identical |
| Wine | those `.exe` files run through Wine 9.0 on Linux. Wine is not Windows |
| CUDA test double | the Linux driver test double from 4.2/4.3 (the real kernel source run on the CPU, per-thread context rules, allocation ledger). Simulated driver, **no timing or VRAM meaning** |
| arithmetic model | `tools/ps_number_model.py`: exact integer/IEEE arithmetic reproducing what PowerShell 5.1 does to a number. Not a PowerShell run |
| your reports | `Windows-self-test(2).json`, `hardware-validation(2).json`, `device-results(2).json` from your PC (4.3, build `cb158d2375848dd8`) |
| **not run** | Windows PowerShell 5.1; the edited `.ps1` scripts; anything on a physical GPU; anything on Windows itself |

Nothing in this release was executed on Windows or on your RTX 4060 Ti.
`Run self-tests.bat` and `Validate CUDA hardware.bat` produce that evidence on
your PC (section 9).

Inputs: `EightMax-Windows-4.3.zip` and your three 4.3 reports. **The 4.2
sources were not supplied**, so 4.2 could not be rebuilt; every benchmark below
compares the unmodified 4.3 with 4.4 (section 8).

Starting point re-verified here: the 4.3 sources reproduce build id
`cb158d2375848dd8` and rebuild `EightMax.exe`, `mwcli.exe` and `gpustress.exe`
**byte-identically** to the shipped files; the 4.3 suite passes on this machine
(404 passed, 0 failed) — its sampled-EV timing failure is intermittent, and was
reproduced directly instead (section 2).

## Summary

| Priority | Status | Evidence |
|---|---|---|
| 1 Windows numerical validation | **Cause identified: the test harness, not the solver.** Windows PowerShell 5.1 reads the JSON number as `System.Decimal`; the test's `[double]` cast rounds twice and lands on the neighbouring double. Engine now prints IEEE 754 bit patterns (`evBits`, `gainBits`); both PowerShell scripts compare those. No assertion removed, no tolerance added. A failed check no longer hides later checks. **The repaired script has not been run on Windows.** | section 1, `validation/4.4/NUMERIC-POLICY.md`, `tests/v44.test.js` 1–5 |
| 2 Sampled-EV deadline | **Cause identified and repaired.** After the stop, 4.3 merged every worker's coverage table (8–98 ms measured, growing with the limit and the thread count) and freed per-worker memo nodes one by one. 4.4 fills one concurrent set while the workers run and releases worker caches in one call; nothing proportional to the work remains after the stop. Tolerances unchanged (50 ms idle / 150 ms loaded). | section 2, `validation/4.4/deadline/` |
| 3 Shared showdown tables | **Preserved, audited, not changed.** One table per request, bit-identical results, 376,992 boards for every thread count (Linux and Wine). Profile shows scoring is 82% of a one-thread request; no faster scoring was implemented. | section 3 |
| 4 Warm RTX 4060 Ti | **Scheduling changed on the evidence of your report; effect on your GPU unmeasured.** Your 4.3 report shows Automatic never chose the faster warm-GPU mode. 4.4 Automatic measures whole-table time for CPU / GPU-pull / GPU-preferred and uses the fastest. Verified with the decision unit tests and the CUDA test double only. | section 4 |
| 5 GTO convergence | **No improvement in equilibrium quality is claimed.** Ten seeds, six games (two with exact exploitability), ten trainer variants, 360 Holm-adjusted comparisons: no variant beats the default on every game; four further candidates were worse or equal. **The default trainer is unchanged** (4.3 and 4.4 write identical state bytes). The primary mathematical objective — a demonstrated improvement — was **not achieved**; the measurement basis was extended. | section 5, `validation/4.4/convergence/` |
| 6 Six-player postflop accuracy | **New independent checks, all passing.** A rules walk over ~700 explorer nodes in 10 trees (6-player flop to 8-player preflop) against rules written independently of the engine; chip conservation; ICM prize-pool sums; two independent evaluators agreeing to 1e-10; sampling vs exact. No engine defect found. | section 6, `tests/v44_postflop.test.js` |
| 7 CPU multithreading | **Coverage merge removed (helps every sampled request); otherwise measured, not changed.** No persistent worker pool, no change to thread selection. | sections 2, 3, 8 |
| 8 Large-state coverage | **Preserved and tightened.** Exactness now depends on the union of keys, not on how many workers saw them; concurrent-set unit tests (1–16 threads, collisions, key limit, stop mid-run) incl. ThreadSanitizer. Probability-weighted fallback shares and exact/lower-bound labels as in 4.3. | section 7, `tests/coverage44.cpp` |
| 9 Response gains | **Preserved.** Gains carry `gainBits`; modes and labels unchanged; conservation and cross-evaluator checks added. No speed change claimed. | sections 6, 8 |
| 10 Eight-handed tournament maths | **Preserved, re-tested.** Individual 0.1 bb antes (0.8 bb), 0.5/1 blinds, 2.3 bb starting pot; big-blind-ante option intact; ICM sums. | `tests/v44_postflop.test.js` test 2 and 4 |
| 11 Checkpoints | **Preserved.** Inherited checkpoint suites pass; 4.3 and 4.4 write byte-identical states for the same spec and seed (Linux; Wine build identical to Linux); 134 MB streamed restore and continuation re-run. | section 8, `validation/4.4/native-continuation.json` |
| 12 Regression and safety | **424 passed, 0 failed, 0 skipped, 0 timed out** (404 inherited + 20 new). ASan+UBSan and ThreadSanitizer clean; cppcheck clean for the evaluation code. | section 10 |
| 13 Windows / RTX validation | **Executables rebuilt; Wine checks pass; physical validation not performed.** Utilities updated for your PC. | sections 9, 10 |
| 14 4.3 vs 4.4 benchmarks | **Done for CPU workloads** (interleaved, 7 repetitions, identical specs/seeds). CUDA cold/warm timings cannot be produced here. | section 8 |
| 15 Release | `EightMax-Windows-4.4.zip`, build `b1b5764df465ea31`, 931 files in the SHA-256 manifest. | section 10 |

## 1. Windows numerical validation (Priority 1)

**Observed (your report):** check `4.3 exact EVs bit-identical to 4.2 for every
thread count` failed; the report shows `15.670177585564112` where 4.2 printed
`15.670177585564113`.

**Investigation, in the order of the data path:**

1. *Native result.* Linux build: `0x402F57218439052D`. Windows build under
   Wine: the same bits, for 1, 2, 4 and 8 threads.
2. *JSON serialization.* `%.17g` prints `15.670177585564113`; 17 significant
   digits identify a double uniquely. Checked for 26 probe values (one-ULP
   neighbours, negative, subnormal, 1e±300, above 2^53, largest finite) by
   printing, then parsing with the engine's reader and, independently, with
   JavaScript: identical bits in every case (Linux native and Wine).
3. *Desktop API / CLI.* Both carry the digits unchanged (character-identical
   probe documents; test 5).
4. *PowerShell parsing.* In your own report `v42.patternProjection.projectionEv`
   — written from the parsed object without a cast — reads
   `15.670177585564113`. So the parsed value was still exact: PowerShell 5.1's
   `ConvertFrom-Json` keeps a JSON fraction as `System.Decimal`.
5. *PowerShell conversion.* The failing line did `'{0:R}' -f [double]$_`.
   Decimal → Double in .NET Framework divides the 96-bit integer
   `15670177585564113` (which exceeds 2^53, so it is rounded when converted) by
   `1e15` (rounded again). The exact-arithmetic model gives
   `0x402F57218439052C` = `15.670177585564112`: your report's value. Of the ten
   reference values in the self-test the model changes exactly this one, which
   is also the only one your report shows changed.
6. *Comparison.* A string compare of that re-rounded number with a literal.

**Conclusion:** the discrepancy is created by the test's number conversion. The
solver output was correct. This conclusion rests on your report's internal
evidence (items 4–5) and the model; the 4.4 self-test records what your
PowerShell really does (`v44.powershell.referenceCastBits`, expected
`402f57218439052c` on Windows PowerShell 5.1), so the model is checked on your
machine by the next run.

**A second finding.** The 4.2/4.3 "identical for every thread count" checks and
the hardware validator's CPU-vs-GPU checks compared re-rounded numbers with
each other. They passed, but could have missed a real one-ULP difference. They
now compare bit patterns.

**Repairs**

* `native/ieee_probe.hpp`: `evBits`, `gainBits`, `valueBits`; `mwcli --ieee`,
  `mwcli --ieee-verify`; `GET /api/mw/ieee-probe`.
* `tools/test_windows.ps1`: every exact comparison uses the bit strings; the
  4.2 references are the patterns `402e0a51470d8f36,402f57218439052d` and eight
  gain patterns (seats 2 and 5 of the 4.3 script's decimal reference string were
  themselves PowerShell-rounded renderings; the patterns come from the Linux
  4.2 values); failures are collected and the run continues; new section `v44`
  (native round trip, raw tokens, desktop API, what this PowerShell does per
  probe, bit-string survival through parse / serialize / file, the EV of the
  failure re-evaluated from raw output, sampled deadline runs).
* `tools/validate_hardware.ps1`: same change; equity comparisons use the exact
  integer `shareUnits`.
* Policy and precision guarantee: `validation/4.4/NUMERIC-POLICY.md`.

**Not verified:** the edited PowerShell was not executed (no PowerShell here).
It was proof-read line by line; `tests/v44.test.js` test 4 checks its structure.
If a line misbehaves the report's `failures` array names it and the remaining
checks still run.

## 2. Sampled-EV deadline (Priority 2)

**Reproduced** with the audit's request (eight-handed linked preflop-to-river
ICM study, one hand then the range, sampled, 2,000,000 samples requested) on
the unmodified 4.3 build. The overrun grew with the limit **and** with the
thread count, which pointed at work after the stop that is proportional to the
work done.

**Located** by adding phase timestamps to the response
(`deadline.phasesMs`). 4.3-equivalent code, milliseconds after the request
started:

| limit, threads | stop published | workers returned | coverage merged | response built | returned |
|---|---:|---:|---:|---:|---:|
| 100 ms, 1 | 100.2 | 104.0 | **111.8** | 111.9 | 112.5 |
| 100 ms, 4 | 100.0 | 104.0 | **124.9** | 125.0 | 127.1 |
| 600 ms, 1 | 600.1 | 604.0 | **636.7** | 636.8 | 639.1 |
| 600 ms, 4 | 600.0 | 604.3 | **702.4** | 702.7 | 710.5 |

The deadline itself was honoured within 0.2 ms (monotonic clock, adaptive
polling: unchanged). The time went into `EvalPool::coverage()`: after the
workers stopped, every key of every worker's coverage table was re-inserted
into a merged table (random memory access per key), then the tables were freed.
4.3 raised the exact key limit from 524,288 to 2,097,152, so more keys were
kept and merged than in 4.2 — consistent with the audit's 4.2 → 4.3 difference.

**Repair** (`native/coverage.hpp`, `SharedCoverage` + `WorkerFilter`): one
set per request, written by the workers as they go. Looking up a key that is
already present takes no lock and writes nothing shared; a new key or flag is
inserted under a shared lock (claim a slot by compare-and-swap, publish, flags
by `fetch_or`; exact counts under any interleaving; key limit enforced by
rollback); the set starts at 64 KiB and is promoted to a table four times
larger, under an exclusive lock, whenever it is half full. Each worker keeps a
512 KiB filter of keys it already reported. At the stop nothing is merged. Also: only sample blocks that hold
samples are merged; samples in progress at the stop are counted and reported.
No thread is terminated; workers are joined as before. `EM_EV_MERGED_COVERAGE=1`
selects the 4.3 path for A/B runs; coverage counts are identical on both paths
and for every thread count (test 10).

**Two more post-stop costs found while measuring longer limits** (both
existed in 4.3 and were hidden there behind the merge):

* When a long run reached the coverage key limit, the approximate-count
  sketches were completed from the whole table after the stop (25 ms after a
  3 s limit in a 4.4 development build). They are now back-filled by the
  worker that reaches the limit, while the run continues, and updated without
  a lock afterwards.
* Every worker kept a node-based memo of strategy-key lookups (up to 262,144
  nodes), freed node by node on the calling thread after the response was
  built: about 40 ms after a 10 s limit with 4 workers, and it scales with the
  number of workers. It is now a flat direct-mapped cache that grows with use
  and is released by one call. The memo caches a pure function, so results are
  unchanged (all exact reference bit patterns and the seeded sampled results
  are identical; section 8).

**Regressions I introduced and removed before release.** The interleaved
benchmark (section 8) was run on each candidate build and rejected two of
them, although every result was bit-identical:

* The first complete build reserved the whole coverage table (64 MiB) and
  each worker's memo (6 MiB) up front. Sparse first touches of that memory
  made short requests slower than 4.3 (exact EV at 4 threads 33 → 41 ms, a
  3,000-sample sampled EV 41 → 219 ms). Both structures now start small and
  grow with the number of keys.
* The second build was 54% slower than 4.3 on a four-thread sampled request
  that creates more than two million information sets (three players, wide
  ranges). Measured causes, in order of size: several threads first-touching
  the pages of a newly allocated table at once (0.09 s of kernel time for an
  82,000-key request against 0.004 s) — each new table is now touched once by
  the thread that creates it; a key counter written by every thread on every
  insert — replaced by per-thread blocks of the key limit, with the limit
  still reached exactly; a lock taken for every key beyond the limit — such
  lookups now take no lock.

* The release gate then failed twice on the third build: the reported
  coverage memory differed between thread counts (more threads reserve blocks
  of the key limit earlier and promote the table earlier) — `tableBytes` is now
  the thread-independent amount the growth rule needs for the reported number
  of keys, and the actual allocation is `execution.coverageSetBytes`; and about
  one run in eight a deadline fell while one thread was preparing a 64 MiB
  table and the others queued behind it (stop published 29–32 ms late). The
  next table is now prepared while the other threads keep inserting, only the
  copy of the keys is exclusive, and no promotion is started or continued
  while a stop is pending. The deadline test then passed 24 of 24 repetitions.
* In the 240-run deadline benchmark of the fourth build one run returned 43 ms
  after a 3 s limit (the other 239: at most 23 ms): a worker was copying about
  a million keys into a larger table when the stop arrived. The copy is now
  abandoned when a stop is pending.
* My sanitizer script ignored a failing unit run (a `&&` chain under `set -e`);
  the release gate's own sanitizer test caught the failure, which was a
  mis-sized check I had just added. The script now stops on any failing run.

Section 8 is measured on the final build.

**Result**, interleaved 4.3 / 4.4, 8 repetitions per cell, Linux native, 4 CPUs
(thread counts above 4 are oversubscribed here). Overrun past the limit in ms:
minimum / median / 90th percentile / maximum.

| Limit | Threads | 4.3 overrun (min / median / p90 / max) | 4.4 overrun (min / median / p90 / max) |
|---:|---:|---|---|
| 100 ms | 1 | 12.9 / 13.6 / 18.9 / 18.9 | 3.9 / 4.0 / 4.1 / 4.1 |
| 100 ms | 2 | 17.4 / 23.3 / 23.9 / 23.9 | 4.4 / 6.5 / 7.2 / 7.2 |
| 100 ms | 4 | 30.0 / 31.3 / 34.2 / 34.2 | 5.1 / 5.8 / 6.1 / 6.1 |
| 100 ms | 8 | 30.2 / 32.7 / 38.6 / 38.6 | 5.1 / 5.3 / 5.8 / 5.8 |
| 100 ms | 16 | 30.4 / 33.0 / 41.0 / 41.0 | 5.0 / 5.6 / 8.8 / 8.8 |
| 100 ms | 24 | 30.3 / 32.4 / 35.3 / 35.3 | 5.2 / 5.6 / 8.2 / 8.2 |
| 250 ms | 1 | 22.9 / 24.4 / 35.9 / 35.9 | 4.5 / 5.3 / 8.1 / 8.1 |
| 250 ms | 2 | 36.6 / 43.8 / 53.8 / 53.8 | 4.8 / 5.5 / 7.6 / 7.6 |
| 250 ms | 4 | 58.2 / 62.3 / 72.5 / 72.5 | 5.4 / 5.7 / 6.4 / 6.4 |
| 250 ms | 8 | 58.7 / 60.4 / 73.7 / 73.7 | 5.1 / 5.7 / 8.0 / 8.0 |
| 250 ms | 16 | 60.5 / 61.3 / 67.9 / 67.9 | 5.1 / 5.5 / 5.9 / 5.9 |
| 250 ms | 24 | 59.1 / 60.0 / 83.0 / 83.0 | 5.2 / 5.6 / 6.2 / 6.2 |
| 600 ms | 1 | 39.8 / 41.7 / 54.4 / 54.4 | 4.5 / 4.9 / 7.2 / 7.2 |
| 600 ms | 2 | 56.1 / 82.5 / 88.9 / 88.9 | 5.0 / 5.7 / 17.6 / 17.6 |
| 600 ms | 4 | 119.7 / 123.8 / 159.2 / 159.2 | 8.1 / 9.9 / 13.5 / 13.5 |
| 600 ms | 8 | 117.7 / 128.0 / 146.0 / 146.0 | 7.8 / 9.9 / 14.0 / 14.0 |
| 600 ms | 16 | 113.0 / 123.6 / 136.0 / 136.0 | 8.2 / 9.6 / 9.9 / 9.9 |
| 600 ms | 24 | 107.1 / 124.5 / 159.1 / 159.1 | 7.6 / 9.2 / 15.0 / 15.0 |
| 1000 ms | 1 | 44.6 / 48.4 / 58.3 / 58.3 | 4.6 / 4.9 / 6.7 / 6.7 |
| 1000 ms | 2 | 90.7 / 92.5 / 98.9 / 98.9 | 7.3 / 8.8 / 14.3 / 14.3 |
| 1000 ms | 4 | 136.2 / 187.4 / 195.1 / 195.1 | 7.9 / 8.9 / 15.5 / 15.5 |
| 1000 ms | 8 | 129.5 / 183.7 / 203.2 / 203.2 | 8.3 / 9.9 / 11.9 / 11.9 |
| 1000 ms | 16 | 129.4 / 189.7 / 221.5 / 221.5 | 8.1 / 10.3 / 16.4 / 16.4 |
| 1000 ms | 24 | 138.8 / 149.8 / 191.0 / 191.0 | 7.9 / 10.0 / 12.0 / 12.0 |
| 3000 ms | 1 | 92.1 / 96.3 / 119.4 / 119.4 | 8.0 / 8.8 / 11.5 / 11.5 |
| 3000 ms | 2 | 176.5 / 196.8 / 213.7 / 213.7 | 8.8 / 10.1 / 10.5 / 10.5 |
| 3000 ms | 4 | 196.3 / 209.9 / 279.1 / 279.1 | 9.5 / 10.7 / 17.2 / 17.2 |
| 3000 ms | 8 | 202.8 / 217.7 / 283.0 / 283.0 | 9.6 / 10.9 / 14.4 / 14.4 |
| 3000 ms | 16 | 197.1 / 201.4 / 232.1 / 232.1 | 9.4 / 11.4 / 17.6 / 17.6 |
| 3000 ms | 24 | 199.3 / 206.9 / 209.4 / 209.4 | 9.8 / 10.3 / 12.8 / 12.8 |

Over all 240 runs per build: 4.3 median 90.7 ms, maximum 283.0 ms, 165 runs at or above 50 ms; 4.4 median 7.9 ms, maximum 17.6 ms, 0 runs at or above 50 ms. Every run of both builds returned a labelled partial result (0 exceptions).

What remains after the stop in 4.4 is 5–15 ms: joining the workers, the
20,000-draw simulation of the simultaneous critical value (unchanged statistics
from 4.1), writing the response, releasing memory.

**Documented tolerance** (unchanged from 4.0; not widened): limit + 50 ms on an
idle machine, + 150 ms under load.

**Repeated runs.** The three timing-sensitive tests of `tests/v40.test.js` (including "4.0 deadlines hold for other limits and games", the test that failed in the audit) and the three of `tests/v44.test.js` were each run 12 times independently on 4.4: **72 passed, 0 failed** (`deadline/repeated-timing-tests.txt`). The audit's test run 12 times on the unmodified 4.3 on this machine: 11 passed, 1 failed (`deadline/repeated-timing-tests-4.3.txt`); its failures are intermittent because its largest limit is 600 ms with a 150 ms allowance.

**Partial results.** Completed samples only, weight 1 each; samples in progress
are dropped whole and counted (`partialResult.samplesDiscardedInProgress`, at
most one per worker per hand); standard errors use the completed count; the
response states the residual limitation (a slower-to-evaluate sample is more
likely to be the dropped one; bias bounded by dropped/completed × value range).
A partial result is never cached; an exact evaluation still returns HTTP 408
and no numbers. Response-gain deadlines were measured too and were already
within 6–19 ms in 4.3 (no coverage merge on that path); unchanged.

## 3. Shared showdown tables (Priority 3) and CPU scheduling (Priority 7)

Audit of the 4.3 table cache (ownership by `shared_ptr` in the request cache,
chunk states `FREE → SCORING → SCORED`, `ready` published under the build mutex
after the histogram is sorted, abort flag observed by every participant,
waiters polling the deadline): no stale or partially initialised table can be
read; ThreadSanitizer runs of exact EV and eight-seat gains with 8 threads are
clean. The architecture is unchanged in 4.4 and the 4.3 tests pass unchanged.

Profile of one exact request (final-table fixture, 1 thread, callgrind,
instruction counts): chunk scoring 55.9%, seven-card evaluation 26.0%, ICM
evaluation 7.6%, pattern projection 5.6%, everything else < 5%. Scoring is
already spread over all threads by the shared table; the serial remainder
(ICM over patterns, tree) is about 13% of a one-thread request. Parallelising
that remainder would require changing the order in which fallback-mass sums are
accumulated (they are order dependent), i.e. changing reported digits; it was
not done. **No scoring or scheduling speed-up is claimed for exact
evaluations**; section 8 shows 4.4 within noise of 4.3 on them.

Not implemented: persistent worker pool, work stealing, workload-specific
thread counts, table reuse across requests. The 24-thread plateau in your
report (12.6 ms vs 14.7 ms at 8 threads) is consistent with the serial
remainder plus thread start-up; this machine has 4 CPUs and cannot measure it.

## 4. Warm CUDA and Automatic mode (Priority 4)

**What your 4.3 report shows** (`hardware-validation(2).json`, `v43.summary`),
complete exact-EV request, warm device:

| Threads | CPU only | hybrid (pull) | GPU preferred | Automatic, warm |
|---:|---:|---:|---:|---|
| 1 | 48.4 ms | 29.8 ms | 28.3 ms | 48.4 ms, ran on **cpu**; "after idle" step 35.5 ms on cpu+gpu |
| 4 | 19.6 ms | 15.1 ms | 14.0 ms | 18.4 ms, cpu |
| 8 | 14.7 ms | 13.4 ms | 12.0 ms | 14.8 ms, cpu |
| 24 | 12.6 ms | 13.3 ms | 12.8 ms | 13.4 ms, cpu |

Two defects in the 4.3 Automatic rule follow from these numbers: (a) it waited
for 0.3 s of CPU table work before opening the device although the measured
start-up was 0.064–0.098 s; (b) once warm it only ever used the pull split,
which your report shows is slower than GPU-preferred at every thread count, and
it chose between CPU and device from a model that assumes linear thread scaling
(your CPU's measured speed-up at 24 threads is about 11×).

**Change.** Once the device is open and verified, Automatic builds each
eligible table by one of three arms — CPU, GPU pull (4.3), GPU preferred — and
keeps, per (thread budget, table size) class, a running mean of the measured
time of whole tables. Unmeasured arms are tried twice, then the fastest is
used; 2 of every 32 decisions re-measure the others (an arm more than 3× slower,
8× less often). A table whose device part failed, was busy or fell back is not
recorded. The warm-up estimate is 0.1 s (`EM_GPU_INIT_ESTIMATE_S`). Every arm
produces the same integer scores (bit-verified once per process as before);
context guard, budget checks and fallback classes are unchanged.
`EM_GPU_AUTO_MODEL=4.3` restores the 4.3 rule. Short single requests still never
open CUDA (test 15).

**Evidence here** — decision logic only:
`tests/auto44.cpp` feeds the selector the timings of your report: it settles on
GPU preferred at 1, 4 and 8 threads and on the CPU at 24, and follows a change
of the fastest arm within two probe cycles. On the CUDA test double a warm
40-request Automatic session measures all three arms, returns bit-identical
EVs whichever arm built the table, scores every board exactly once, and leaves
no context errors or device memory; device faults in Automatic fall back with
identical EVs.

**Not measured:** any timing on a GPU. Whether Automatic now matches the best
mode on your machine is exactly what section 10 of `Validate CUDA hardware.bat`
measures (per thread count: settled Automatic median against CPU-only,
GPU-preferred and the 4.3 rule, in the same process). No GPU speed-up is
claimed. Cold starts are unchanged: the first request still pays nothing for
CUDA and stays on the CPU.

Not implemented: changes to the kernels, buffers, batching or transfers.

## 5. Convergence (Priority 5)

**Audit.** The external-sampling update in `native/mw_es_impl.hpp` was read
against the definitions: opponents sampled from `q = 0.9σ + 0.1/k` with the
return multiplied by `σ/q`; regret increments weighted by opponent reach over
sampling probability; average-strategy increments by own reach × σ over
sampling probability (unbiased because public actions identify the opponent
sequence); `terminalBaseline` is an unbiased control variate (expectation
re-derived); chance probabilities and range weights enter through the deal
sampler. No inconsistency was found and **training code is unchanged**.

**Study** (`tools/convergence44.js`, `validation/4.4/convergence/`): ten seeds;
exact best response of every seat after each checkpoint, independent of
training; paired comparisons with the default at equal sampled deals and at
equal training time; Holm adjustment over all 360 comparisons.

| Game | Metric | Default at the last checkpoint (mean ± 95% CI over seeds) |
|---|---|---|
| Heads-up river, chip EV | exploitability (exact), chips | 0.0161 ± 0.0033 after 1,000,000 deals (4,000 deals: 0.331) |
| Heads-up turn and river, chip EV | exploitability (exact), chips | 0.0272 ± 0.0026 after 1,000,000 deals (4,000 deals: 0.424) |
| Three-player river, unequal stacks, side pots, chip EV | NashConv, chips (not exploitability) | 0.0168 ± 0.0025 after 1,000,000 deals (4,000 deals: 0.372) |
| Four-player bubble push/fold, weighted two-hand ranges, short stack (ICM: 3 paid) | NashConv, payout units (not exploitability) | 0.00000217 ± 0.0000022 after 250,000 deals (4,000 deals: 0.00835) |
| Six-player flop, unequal stacks (3 to 50 bb), all-in or fold, two hands a seat, side pots, chip EV | NashConv, chips (not exploitability) | 0.0656 ± 0.026 after 250,000 deals (4,000 deals: 1.48) |
| Eight-player final table push/fold, fixed hands (ICM: 8 paid) | NashConv, payout units (not exploitability) | 0.00000220 ± 0.0000024 after 250,000 deals (4,000 deals: 0.00970) |

Variants compared with the default (linear averaging, regret matching):

| Variant | Supported better | Supported worse | of comparisons |
|---|---:|---:|---:|
| terminalBaseline (control variate) | 0 | 0 | 72 |
| terminalExpectation | 0 | 0 | 72 |
| both | 0 | 0 | 72 |
| regret matching+ | 0 | 72 | 72 |
| DCFR(1,1,2) | 9 | 19 | 72 |

* DCFR(1,1,2) is better only at equal time on the two ICM push/fold
  games (as in 4.3) and worse on both heads-up postflop games and, at equal
  time, the three-player river.
* The two variance-reduction options have no supported difference anywhere.
* Regret matching+ is worse everywhere.
* Four further candidates on the heads-up river and three-player river
  (quadratic and cubic averaging, linear CFR, DCFR(1.5,0,2);
  `candidates44.json`): higher-power averaging and DCFR(1.5,0,2) are worse,
  linear CFR is indistinguishable from the default.

**Verdict.** No method improves strategy quality across these games, so the
validated default is kept and **4.4 does not produce stronger strategies than
4.3** — they are the same strategies (identical state bytes). What is new is
that two-player results are exact exploitability, six- and four-player
situations are covered, and 1,000,000-deal checkpoints exist for four games.

Limits of these numbers: NashConv for more than two players or ICM is a sum of
unilateral deviation gains inside the abstraction, not exploitability; all
games use small explicit ranges; nothing here is a statement about full
eight-handed No-Limit Hold'em, and no exact equilibrium is claimed. Stratified
or variance-reduced samplers that would need new trainer code were not
implemented. The flop, final-table and bubble games ran while compilers were
also running on the machine: equal-sample results are unaffected, equal-time
results for those three games carry that extra noise.

## 6. Multiway postflop accuracy (Priority 6)

`tests/v44_postflop.test.js`, scenarios: six-player flop (stacks 3–50 bb,
earlier wagers, folded money; all-in/fold and a two-size + raises + turn +
river version), five-player flop with weighted ranges, four-player turn with
two sizes and raises, three-player river (chip EV and ICM), heads-up turn and
river (three bet sizes, two raise sizes, weighted ranges), four-player ICM
bubble with a 4 bb stack, eight-player final table.

* **Rules walk** (explorer nodes checked against rules coded in the test):
  pot = starting pot + wagers; stack = chips behind + wagers; actor live with
  chips; fold only when facing a bet, check only when not; call = min(price,
  stack); every bet/raise above the price and within the stack; "All-in" is
  exactly the stack; non-all-in raises at least the previous raise; child
  states follow from the action; street changes deal distinct new cards, reset
  street wagers and keep the pot; blockers flagged; range weights equal the
  specification; every average and current strategy sums to 1. About 700
  nodes; no violation.
* **Chip conservation:** in all six chip-EV trees the seats' exact values sum
  to the starting pot (|difference| < 1e-9).
* **ICM:** bubble (3 paid) and final table (8 paid) sum to the prize pool
  (100); with a player at another table the three seats hold less than the
  pool.
* **Two evaluators:** the root actor's value from the best-response evaluator
  equals the range-aggregate mixed EV from the action-EV evaluator (relative
  < 1e-10) in all eight exact scenarios.
* **Two methods:** shared tables vs per-board enumeration within 1e-12; 1 vs 4
  threads bit-identical; every exact unilateral gain ≥ 0.
* **Sampling vs exact** within 5 standard errors on five scenarios; sampled
  estimates identical for 1 and 3 threads at the same seed.

These support correctness inside each abstraction. They do not address what a
different abstraction (other bet sizes, full ranges) would give. Exact
best-response evaluation of the six-player multi-street tree was too large to
run (stopped after 10 minutes); that tree is covered by the rules walk only.

## 7. Coverage (Priority 8)

Counts keep their 4.3 meaning (`distinctCountKind` exact / lowerBound,
HyperLogLog estimates labelled approximate once capped, probability-weighted
fallback shares). The concurrent set makes one thing stricter: in 4.3 the
workers' tables shared one byte pool, so several workers that each saw the
same keys could exhaust it and report `lowerBound` although the union was
below the limit; in 4.4 the limit applies to the union. Memory follows the
keys: 64 KiB for an empty set, at most 8 slots (128 bytes) per key while
growing and 32 bytes per key at the limit, earlier tiers kept until the request
ends (about one third more: up to ~85 MiB at the default 64 MiB / 2,097,152-key
limit), plus 512 KiB per worker; the per-worker growable tables and the merged
copy of 4.3 are gone. Inserting threads share no lock word and no per-key
counter (per-thread reader slots and per-thread blocks of the key limit); the
set is capped only when the number of keys held equals the limit. A larger
table is prepared by one thread while the others keep inserting; only the copy
of the keys excludes them, and nothing is promoted while a stop is pending. `tests/coverage44.cpp`: 55 checks against `std::map` —
1–16 writers, three partitionings, repeated observations from other threads,
forced hash collisions, one key from 16 threads, promotions through every tier
under 16 writers, key limit (exact lower bounds, estimate within 4 SE with and
without a final pass), stop mid-run, a stop raised and cleared repeatedly
during promotions, agreement with the 4.3 merge, memory bounds — also under
ThreadSanitizer and ASan+UBSan. End to end: counts equal the independent
`EM_COVERAGE_AUDIT` set for 1–8 threads, sampled and exact, complete and
timed-out (test 10). The 2,000,000-key test of 4.3 (`tests/coverage43.cpp`)
still passes against the unchanged `Coverage` class.

## 8. 4.3 versus 4.4 (Priority 14)

`tools/bench44.js`: interleaved, order rotating with the repetition, 7
repetitions, the same specification, state, seed and request for both builds;
Linux native, 4 CPUs, CPU only. Times are the engine's own request time in ms
(median [min–max]); ratio = 4.4 median / 4.3 median.

| Workload | 4.3 | 4.4 | ratio | identical |
|---|---:|---:|---:|---|
| Exact action EV, eight-player final-table ICM (4.0 fixture), 1 thread | 84.3 [75.0–121.4] | 83.7 [73.6–108.5] | 0.99 | true |
| same, 2 threads | 46.5 [42.6–61.1] | 47.2 [44.3–60.4] | 1.01 | true |
| same, 4 threads | 33.6 [31.4–40.4] | 35.6 [32.2–41.0] | 1.06 | true |
| Exact response gains, all eight seats, final-table ICM, 4 threads | 55.2 [50.7–57.3] | 56.1 [53.1–64.9] | 1.02 | true |
| Exact response gains, four-player bubble ICM, weighted ranges, 4 threads | 2937.8 [1768.7–4478.0] | 4451.9 [2544.0–5291.9] | 1.51 | true |
| Exact response gains, six-player flop, multiway all-ins, 4 threads | 3899.5 [3740.8–4061.3] | 3845.4 [3602.8–4051.9] | 0.99 | true |
| Exact response gains, eight-player short-stack all-ins (3-12 bb), chip EV, 4 threads | 46.5 [40.8–53.0] | 47.6 [38.7–51.5] | 1.02 | true |
| Exact range EV, three-player river with side pots, 2 threads | 1.5 [1.2–1.8] | 1.7 [1.5–2.3] | 1.17 | true |
| Exact best response, heads-up river, 2 threads | 0.3 [0.2–0.5] | 0.3 [0.2–0.4] | 0.98 | true |
| Sampled range EV, eight-player linked preflop-to-river ICM, 3,000 samples (complete), 4 threads | 41.4 [38.7–51.8] | 35.8 [30.6–40.7] | 0.86 | true |
| same, 1 thread, 1,000 samples | 34.3 [32.8–42.5] | 33.3 [30.6–50.8] | 0.97 | true |
| Sampled range EV, three-player flop with wide weighted ranges (about 150 combos a seat), 20,000 samples, 4 threads | 1189.9 [1104.5–1258.5] | 1031.4 [996.4–1116.0] | 0.87 | true |
| Sampled one-decision response gains, eight-player linked ICM, seats 0 and 3, 256 samples, 4 threads | 8477.1 [7794.3–8661.5] | 8048.6 [7454.7–8295.7] | 0.95 | true |
| Sampled EV stopped by a 250 ms limit (hand, then range), 4 threads: time is the response time | 313.2 [309.2–328.4] | 256.2 [255.4–258.7] | 0.82 | n/a (time-stopped) |
| Sampled EV for 3 s, 4 threads: time is the response time, medianSamples the samples completed (more = faster) | 3199.2 [3190.8–3217.0] | 3010.3 [3009.9–3014.8] | 0.94 | samples completed: 383,784 vs 389,127 |
| same, 1 thread | 3092.0 [3090.4–3106.8] | 3008.3 [3007.2–3008.5] | 0.97 | samples completed: 103,162 vs 94,749 |
| Sampled EV cancelled after 150 ms, 4 threads: time is the cancellation latency | 3.6 [3.1–3.9] | 2.4 [1.8–3.1] | 0.67 | n/a (time-stopped) |
| Training, eight-player final-table ICM push/fold, 20,000 updates, 4 threads | 905.9 [847.8–1001.7] | 869.2 [789.9–973.8] | 0.96 | true |
| Training, six-player flop, 20,000 updates, 4 threads | 157.1 [140.4–179.0] | 152.6 [144.5–187.3] | 0.97 | true |
| Training, eight-player linked preflop-to-river ICM, 300 updates, 4 threads | 173.4 [168.3–186.3] | 196.3 [171.4–231.0] | 1.13 | true |

Reading: every comparable result is identical between 4.3 and 4.4. Exact
evaluations, response gains and training are unchanged within run-to-run
noise (ratios 0.97–1.06; the two sub-2 ms requests differ by 0.2 ms or less).
The four-player bubble row is not a difference between the builds: that
workload varies about 2.5× from run to run in both (12 further interleaved
runs each: 4.3 median 4.32 s, range 2.4–5.3 s; 4.4 median 4.55 s, range
1.9–5.7 s; `bench/bubble4-repeat.txt`). Sampled evaluations are 3–14% faster
at 4 threads (no merge), equal at 1 thread; in 3 s the two builds complete the
same number of samples at 4 threads and 4.4 about 8% fewer at 1 thread in this
run, while 4.3 returns 90–200 ms after the limit. Deadline responses are 57 ms
closer to the limit and cancellation is about 1 ms faster. Training time for
the linked eight-player game (ratio 1.13) is noise: the training code is
unchanged and the states are byte-identical. Where "identical" is `true`, every run of both builds printed the
same values; for training it means the SHA-256 of the saved state is the same
for 4.3 and 4.4 in every run (deterministic continuation across the two
versions). Full rows (seeds, threads, devices, board counts, samples, standard
errors, peak RSS, hashes): `validation/4.4/bench/bench-4.3-vs-4.4.json`.

Not measured here: every CUDA row of the brief's list (cold start, warm
start, kernel / transfer / synchronisation time, peak VRAM). They are recorded
by `Validate CUDA hardware.bat` on your PC. A 4.2 column is missing because the
4.2 sources were not supplied.

## 9. What to run on your PC

1. `Run self-tests.bat` → `Windows-self-test.json`. New in the report: `v44`
   (see section 1) and `failures`. Expected on Windows PowerShell 5.1:
   `passed: true`, `v44.powershell.castMismatches` ≥ 1 with
   `referenceCastBits = 402f57218439052c` (that is the 4.3 failure, now recorded
   instead of asserted on).
2. `Validate CUDA hardware.bat` → `hardware-validation.json` and
   `device-results.json`. New section 10 (`v44`): per thread count the settled
   Automatic median, the CPU-only and GPU-preferred references, the 4.3-rule
   median and the arm statistics.

Please send the three files; they are the only source of physical Windows and
RTX 4060 Ti evidence for 4.4.

## 10. Tests and release

* Regression suite, clean build, Linux native: **424 passed, 0 failed, 0
  skipped, 0 timed out**; 40 hardware-dependent tests ran (compiler, native
  host, CUDA test double), none skipped. 404 are the inherited 4.3 tests,
  unchanged; 15 are `tests/v44.test.js`; 5 are `tests/v44_postflop.test.js`.
  `validation/4.4/regression-tests.json`.
* Timing-sensitive tests repeated independently: section 2.
* Sanitizers (`tools/sanitize44.sh`, `validation/4.4/sanitize44.txt`):
  UBSan+ASan host and CLI on the non-timing 4.4 tests and the postflop tests;
  ThreadSanitizer CLI on the stop path, exact EV, exact and sampled gains with
  8 threads; `coverage44` under both: no reports. cppcheck: no findings in the
  evaluation code (one pre-existing warning in the unchanged trainer:
  `Walker::cpots` not initialised in the constructor; it is scratch storage
  written before use).
* Development failures, for the record: my first versions of two new tests read
  the wrong response fields, one asserted a timing-dependent property of the
  simulated device, and the rules walk initially assumed call-of-the-blind in
  push/fold trees and gross stacks; all were errors in the tests and were
  corrected. No engine defect was found by the new tests.
* Wine (Windows executables, CPU): `mwcli.exe` 13 of 13 checks passed (wine-9.0 (Ubuntu 9.0~repack-4build3)): build id, probe document identical to Linux, print/parse round trip, exact EV and eight-seat gain bit patterns for 1–8 threads, coverage counts, training state bytes equal to the Linux build, 12 sampled deadline runs (worst overrun 18.1 ms, including Wine's own overhead), cancellation latency 3.061 ms, a seeded sampled result bit-identical to Linux (`wine/wine-windows-cli.json`). Desktop host under Wine: `wine/native-host-wine.json`, `wine/native-mw-wine.json`, `wine/explorer-host-wine.json`. Wine is not Windows.
* Checkpoints: inherited suites pass; `native-continuation.json` (134 MB
  eight-seat state: streamed restore, continuation, byte and RNG equivalence),
  `native-restore-sizes.json`, `checkpoint-sizes.json` regenerated on Linux.
* Windows executables: built twice, byte-identical; build id `b1b5764df465ea31` in
  `BUILD-INFO.json`, `mwcli.exe --build-id`, the desktop host and the interface.

## 11. Limitations and unverified items

* **Not run on Windows.** The PowerShell scripts were edited without being
  executed. The Windows numerical failure is explained by evidence and a model,
  not by a run of the repaired script.
* **No GPU.** The Automatic change is validated for logic and numerical parity
  only. It may or may not improve end-to-end time on your RTX 4060 Ti.
* **No convergence improvement.** Strategies are those of 4.3.
* **No CPU speed-up for exact evaluations**, no persistent thread pool, no
  workload-specific thread count.
* **4.2 not rebuilt** (sources not supplied).
* 16/24-thread deadline rows here are oversubscribed runs on 4 CPUs, not
  measurements of a 24-thread machine.
* The partial-result length bias is bounded and reported, not removed.
* Browser full-traversal memory limits were not investigated.
* Convergence and accuracy results hold for the stated abstractions only. No
  eight-player Nash equilibrium is claimed, and multiway response gains are
  unilateral deviation gains, not exploitability.
