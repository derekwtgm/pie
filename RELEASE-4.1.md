# EightMax Windows 4.1

Version 4.1 repairs unsafe numeric conversions on every input path, traces the
intermittent 4.0 Windows test failure to its cause, makes action-EV
comparisons account for multiple actions and for selecting the highest
estimate, adds complete work accounting with a board-evaluation budget,
evaluates response gains in parallel, adds a strategy-quality panel, and makes
CPU/GPU scheduling decisions visible. **Training is unchanged**: 4.1 trains
byte-identical states to 4.0 (all ten benchmark scenarios, three seeds each),
and a new convergence study found no setting that beats the default.

Where things were measured:

| Environment | What ran there |
|---|---|
| Linux, Ubuntu 24.04, 4 logical CPUs (Intel Xeon 2.1 GHz), GCC 13 | builds, full regression suite, UBSan/ASan/TSan, statistical simulations, convergence study, all benchmarks |
| Windows x64 executables, MinGW-w64 GCC 13 (posix), cross-compiled on Linux | `EightMax.exe`, `mwcli.exe` in this package (not executed on Linux; no Wine was available) |
| **GitHub Actions `windows-latest` (Windows Server VM, no GPU)** | host compiled on Windows from this source; `test_windows.ps1` incl. the 4.1 checks; full regression suite; repeated concurrency stress; `validate_hardware.ps1` CPU paths; PowerShell parse check (see `validation/4.1/windows-runner.md`) |
| CUDA | CUDA source unchanged; executed only through the Linux CUDA driver test double (the real kernel source run on the CPU) |

**Not done: no physical Windows desktop and no NVIDIA GPU (RTX 4060 Ti or
other) were available. Nothing in this release was executed on an RTX 4060 Ti;
no GPU speed is claimed.** `Validate CUDA hardware.bat` now records
`physicalNvidiaExecution` (true only when CUDA scored boards on your PC and
matched the CPU bit for bit), complete-workload CPU/GPU/hybrid/auto times, peak
VRAM, the scheduler's decisions and Wine/virtual-machine indicators.

---

## 1. Unsafe numeric conversions (Priority 1) — fixed, release-blocking

**Reproduced.** A desktop host built with
`-fsanitize=undefined,float-cast-overflow -fno-sanitize-recover=all`
(`tools/build_sanitized_host.sh`) aborted on `POST /api/mw/jobs/ev
{"hands":[0],"memoryMiB":1e300}`:

```
ev_jobs.h:153:84: runtime error: 1e+300 is outside the range of representable values of type 'long long int'
```

**Audit.** `tools/numeric_ub_probe41.js` sends one malformed number per input
path to a fresh sanitized host. On 4.0, **10 of 16 paths performed undefined
behaviour** (the job API's `memoryMiB`/`timeLimitMs` for both job kinds,
`/api/equity` threads and cards, `/api/build` `iso`, `/api/solve` `maxIter`
and `power`, `/api/node` `path`, `/api/report` flop weights;
`validation/4.1/numeric-ub-probe-4.0.json`). Further unchecked sites were fixed
without being reachable in the probe: `(float)` narrowing of lock strategies
and ICM utilities, legacy-checkpoint fields from untrusted files, the
`--port=` and `EIGHTMAX_GPU` `atoi` calls, `isInt()` accepting infinities,
casts before range checks in the spec parser (bet-size kinds, hand fields,
tree nodes), and the explorer/checkpoint helpers comparing against
`(double)LLONG_MAX` / `double(UINT64_MAX)`, which round up to 2^63 / 2^64.

**Repair.** `native/num_safe.h`: type → finiteness → integer → representable
(against exact powers of two) → caller's range, then the cast; float narrowing
checked against FLT_MAX; overflow-checked add/multiply and MiB→bytes. The job
API validates the whole request **before** converting anything. Invalid input
gets 400 (413 for a valid memory request above the pool) with the field named;
nothing is clamped and no default replaces a present-but-invalid value. The
one documented clamp (`maxIter` above 49,000 → 49,000, legacy since 2.x) is
kept and documented in `MW-PROTOCOL.md`, which lists every range.

**Evidence.** 4.1 probe: 16/16 refused with 400, 0 UBSan reports
(`numeric-ub-probe-4.1.json`); `tests/num_safe41.c`: boundary cases and 2,000,000
property-test values under UBSan+ASan; `tests/v41.test.js`: every numeric field
of every route with 1e300, -1e300, 1e999, 2^63-1, 2^63, -2^63-1, 2^64, 1e19,
0.5, -1, null, "512", true, [] and {}, range boundaries, defaults, negative
memory, invalid workers, and "no job was created". The v39/v40/v41 suites ran
against the UBSan+ASan host and CLI (`tools/sanitize41.sh`).

## 2. Intermittent Windows startup-test failure (Priority 2) — cause found

**Reproduced on Linux** under CPU load (1 failure in 12 loaded runs of the 4.0
binary; `validation/4.1/v34-intermittent-repro-4.0.log`). The failing
assertion was the test's `deepEqual` of `/api/status` before and after a
failed start: the object contains `residentMiB`, a **live RSS measurement**
(6.63 → 6.66 MiB). This is a timing-sensitive test assumption, not a
synchronization defect. The test now compares every job-state field exactly
and requires the measurement to be a finite number; it was not weakened.

**Audit of the real synchronization** (job creation, worker ownership, the job
table, id generation, state transitions, cancellation during startup,
completion, cleanup, error propagation; legacy solve/report/train starts):
no data race was found by inspection or by ThreadSanitizer. Two genuine defects
were found and fixed:

- **Queued jobs lost their time budget.** `EvControl` started its clock when
  the job was *submitted*; a job that waited in the queue had the waiting time
  subtracted from its `timeLimitMs` and could time out the moment it started.
  The clock now starts when the evaluation starts (atomic, read concurrently by
  progress). Test: a 500 ms job queued for 1.2 s completes in full.
- A cancel that arrived while a job was briefly returned to the queue
  re-queued it; it now finishes as `cancelled` immediately.

**Stress tests** (`tests/v41.test.js`, all under the TSan host with reports
captured to files — log capture verified with a planted race): 25 rounds of 8
simultaneous solve/report starts and 20 rounds of 6 simultaneous training
starts (exactly one 200 each round, none stuck), 6 rounds of 12 rapid job
creations with immediate/delayed cancellation (no stale entries, no
readers/memory left), repeated host shutdown with running and queued jobs,
worker-start failure, parallel response-gain cancellation. **0 ThreadSanitizer
reports.** On Windows, CI repeats every startup/concurrency/job test five times
in a row without reruns, and `test_windows.ps1` runs 10 rounds of 8 concurrent
starts.

## 3. Action-EV statistics (Priority 3) — multiplicity and selection adjusted

Sampling design: every sample evaluates every action on the same cards (common
random numbers), so estimates are paired and correlated, sample counts are
equal, and sampling stops on a target, deadline or budget — never on the
observed values. `native/action_stats.hpp`:

1. simultaneous intervals for all k(k−1)/2 pairwise differences, single-step
   max-|t| critical value simulated from the **estimated joint covariance**
   (multivariate t, n−1 df, 20,000 deterministic draws, conservative order
   statistic);
2. Hsu MCB-form bounds for D_a = μ_a − max_{b≠a} μ_b, valid whichever action is
   truly best (accounts for picking the highest estimate);
3. Holm-adjusted p-values over all pairs as a correlation-free cross-check;
4. classes: `supportedBest`, `highestEstimate` (advantage not established),
   `practicallyEquivalent` (only with `equivalenceMargin`; simultaneous
   interval inside ±margin), `differenceSupported`, `differenceUncertain`
   (never evidence of equality), `insufficientSamples`.

EVs and standard errors are bit-identical to 4.0; only the labels changed. The
per-action ± intervals stay and are labelled unadjusted.

**Validation** (`tests/stats41.cpp`, `validation/4.1/statistics41.json`,
2,000 replications per scenario, known true values; FWE = share of runs with
at least one false claim, Wilson 95% intervals):

| Scenario | 4.1 FWE | 4.1 coverage | 4.0 rule FWE |
|---|---|---|---|
| 4 equal actions, correlation 0.8 | 5.2% [4.3, 6.3] | 94.8% | 21.4% [19.7, 23.3] |
| 4 equal, independent | 4.3% | 95.7% | 20.1% |
| 8 equal, correlation 0.5 | **5.9% [5.0, 7.1]** | 94.0% | 50.4% |
| 2 equal | 5.3% | 94.8% | 5.7% |
| 4 equal, n = 100 | 5.1% | 95.0% | 21.7% |
| 5 actions, two tied best | 0.5% | 97.9% | 5.7% |
| equivalence, equal values, margin 0.1 | 4.7% | 95.3% | 12.6% |
| equivalence at the margin boundary | 2.2% | 95.7% | 5.3% |
| rare payoff (p = 0.002, ×500), n = 1,000 / 20,000 | 4.4% / 5.2% | 95.6% / 94.8% | 12.6% / 11.8% |
| data-dependent stopping, fixed α each look | 26.3% | – | – |
| data-dependent stopping, α spending 6α/(π²j²) | 2.6% | – | – |

Power: large differences (0.3 σ) are detected in 100% of runs by both; a small
difference (0.02 σ, n = 2,000) is established in 21% of runs by 4.1 versus 36%
of "all others lower" claims by the 4.0 rule — the price of controlling false
claims. The 8-action case is at most slightly above nominal (lower confidence
bound 5.0%); this is listed under limitations.

## 4. Work accounting and budgets (Priority 4)

Per-site counters flushed from per-worker pollers (no contention): tree visits,
chance cards, opponent tuples, reach weights, board runouts, **board
evaluations**, showdown tables and cache hits, pattern counts, terminal
utilities, ICM evaluations, samples, rejected sampling attempts, best-response
nodes/tuples, selection steps, subtree sizing, GPU batches/boards, worker tasks
(`work` and `budgets` in every EV and response-gain result). Kinds are never
added together. New budget `maxBoardEvaluations`: tables charged in full
before they are built, single boards every 256; exhausted → exact **422 with
no numbers**, sampled → `partial` only with ≥ `minSamples`, `stoppedBy:
"maxBoardEvaluations"`. Example: the eight-player push/fold node `[1,1]` does
753,984 board evaluations, which 4.0's `maxVisits` (126 tree visits) did not
see. Deadline and cancellation behaviour unchanged (101–102 ms for a 100 ms
limit in every benchmark scenario, cancel latency 0.7–1.9 ms).

## 5–6. Response gains: parallel, per seat (Priorities 5, 6)

Seats are evaluated concurrently (`threads`, default as for action EVs), each
with random streams derived from (seed, seat, purpose) and its own control
block whose memory and board charges go to the request; buffers are merged in
seat order, so **results are bit-identical for every thread count and to 4.0**
(checked in all ten scenarios). Exact best response, eight seats, push/fold:
19.1 s (1 thread) → 9.7 s (2) → 4.7 s (4). The three modes remain distinct
(`exactBestResponse`, `restrictedBestResponse`, `sampledOneDecisionDeviation`)
and the restricted/sampled ones are labelled lower bounds. The 4.0 validation
(restricted = exact best response to 1e-8 on single-street studies) still
passes. New interface panel (§9).

## 7. Convergence (Priority 7) — investigated, no change

`tools/convergence41.js`, `validation/4.1/convergence41.json`: DCFR(1,1,1),
(1,1,2), (1,1,3), (3,1,2) against the default on four games with exact NashConv
(heads-up river and turn, three-player river chip EV and ICM side pots), five
paired seeds, 10k–480k deals, Holm over 64 comparisons. **No setting was better
at any checkpoint.** DCFR(1,1,2) and (1,1,3) were significantly worse on the
heads-up turn (e.g. +0.139 and +0.316 BB at 480k, Holm p 0.025 / 0.010).
DCFR(1,1,1) — mathematically linear CFR with linear averaging — reproduced the
default to rounding at every checkpoint, an independent check of the
discount-schedule implementation. **No training default was changed and no
convergence improvement is claimed.**

## 8. CPU/GPU (Priorities 8, 9)

CUDA kernels are unchanged (no CUDA toolkit or GPU here; `score_ptx.hpp` not
regenerated). Scheduling is now transparent: `execution.scheduling` counts
each table's decision (forced CPU, small table, GPU measured slower, GPU
unavailable, GPU busy, after GPU failure), `gpuVerificationBoards`, and
`gpuPeakMiB`. Fixed: the one-time 65,536-board verification was counted as a
GPU table. Test double: CPU, GPU, hybrid and auto EVs bit-identical, every
table accounted for by exactly one decision, peak VRAM within `gpuMiB`. The
4.0 estimate stands: scoring is ~18% of the push/fold root evaluation, so a GPU
can save at most about a fifth of it.

## 9. Interface (Priority 14)

Explorer: new Board-evaluation limit and Memory (MiB) controls; work summary;
the stopping reason of partial results; adjusted labels ("best (supported)",
"highest estimate (not established)") with simultaneous intervals and Holm
p-values in the tooltip. New **Strategy quality** panel: background
response-gain job (sampled / restricted / exact), progress and Cancel, per-seat
table (UTG…BB) with evaluator, gain, 95% interval, samples, fallback share and
time, training updates and deals, seed and threads, exploitability only for
two-seat chip-EV exact results, a session history of measurements, and the
lower-bound caveat.

## 10. 4.0 versus 4.1 benchmarks (Priority 16)

`tools/bench41.js`, `validation/4.1/bench41.json`: medians of 3 training seeds,
process wall time (startup included), identical requests and states, 150 s
limit per run.

| Scenario | Exact 4.0 → 4.1 (1 thr) / 4.1 (4 thr) | Sampled 4.0 → 4.1 (1) / (4) | Response gain 4.0 → 4.1 (1) / (4) |
|---|---|---|---|
| Heads-up river | 0.005 → 0.005 / 0.006 | 0.137 → **0.146** / 0.055 | 0.005 → 0.004 / 0.005 |
| Heads-up turn | 0.006 → 0.006 / 0.007 | 0.122 → **0.132** / 0.048 | 0.005 → 0.006 / 0.006 |
| Three-player river | 0.007 → 0.007 / 0.007 | 0.480 → 0.503 / 0.153 | 0.007 → 0.007 / 0.006 |
| Four-player flop | 1.78 → 1.85 / 0.73 | 0.309 → 0.327 / 0.100 | 0.251 → 0.225 / **0.083** |
| Six-player flop | 1.92 → 1.97 / 1.10 | 2.41 → 2.44 / 0.69 | 2.59 → 2.53 / **0.87** |
| Eight-player push/fold | 0.92 → 0.84 / 0.52 | 2.34 → 2.25 / 0.80 | 1.86 → 1.88 / **0.95** |
| Eight-player linked preflop–river | > 150 → > 150 / 121.5 | 0.044 → 0.051 / 0.032 | 0.475 → 0.501 / 0.435 |
| Short-stack all-ins (chip) | 0.54 → 0.51 / 0.31 | 0.425 → 0.433 / 0.129 | 1.37 → 1.32 / **0.75** |
| Bubble ICM | – | 0.112 → **0.137** / 0.053 | 0.244 → 0.249 / 0.138 |
| Final-table ICM | – | 0.197 → **0.217** / 0.102 | 12.3 → 12.2 / **9.2** |

Regressions (bold in the sampled column): single-threaded sampled evaluations
are 2–22% slower (largest: bubble ICM +22%, final table +10%, heads-up
+7–8%), from the per-hand simultaneous-interval simulation (20,000 draws per
hand) and the work counters; at these sizes process start-up is a large share.
Peak RSS +0.2–0.4 MiB. Response gains with several threads are 1.3–3× faster;
single-threaded gains are unchanged within noise. Deadline: 101.1–102.1 ms
(4.0) and 101.3–102.0 ms (4.1) for 100 ms. Peak VRAM: not measured (no GPU).

## 11. Tests and sanitizers (Priorities 11–13)

- Regression suite: see §12 totals and `validation/4.1/regression-tests.json`.
  New: `tests/v41.test.js` (numeric safety ×3 incl. the UBSan property test,
  concurrency ×4, statistics ×2, work budgets ×2, parallel response gains ×2,
  CUDA scheduling ×1, explorer ×1) and the two compiled harnesses
  `tests/num_safe41.c`, `tests/stats41.cpp`. Changed 4.0 tests: v34
  "startup failure" (no longer compares the live RSS measurement, §2) and v40
  "statistics" (checks the 4.1 contract against the simultaneous intervals,
  §3). No test was removed or skipped.
- `tools/sanitize41.sh`: UBSan(+float-cast-overflow)+ASan desktop host and CLI
  (num_safe property tests, the 16-path probe, v39/v40/v41 suites), TSan
  desktop host (all concurrency/job/startup tests, 0 reports), TSan stress tool
  and parallel response gains; cppcheck if installed (it was not installed
  here: static analysis by cppcheck was **not** run for 4.1).
- Checkpoint and MCCFR invariants: training code is unchanged; the 3.x/4.0
  checkpoint tests (rollback on allocation failure, cancellation, worker
  failure, interrupted streaming saves, damaged/missing/truncated indexes,
  failed restores, incompatible imports, deterministic continuation) all pass;
  evaluations — including parallel and cancelled response-gain jobs — leave the
  exported state byte-identical (tested).

## 12. Remaining limitations

- No physical Windows desktop, no Wine, no NVIDIA GPU: RTX 4060 Ti CUDA
  execution and speed are unverified; Windows evidence comes from the GitHub
  Windows Server VM (no GPU).
- Full eight-player NLHE is not solved; multiway and ICM response gains are
  per-seat lower bounds (restricted/sampled) or exact gains in small
  abstractions, never exploitability certificates.
- The simultaneous comparison measured 5.9% family-wise error with 8 actions
  at n = 1,000 (nominal 5%); intervals rely on the central limit theorem;
  data-dependent re-running is not covered (the spending rule is documented).
- Sampled one-decision gains scale to about 2 threads on push/fold studies
  (a few seats dominate).
- Exact evaluation of large linked games is still expensive (121.5 s with 4
  threads for the linked preflop–river node; not finished in 150 s with 1).
- Single-threaded sampled EVs are up to 22% slower (§10).
- `maxBoardEvaluations` may overshoot by at most 256 boards per worker.
- Training algorithms unchanged; no convergence improvement.
- Browser full-traversal checkpoint memory limits unchanged.
- cppcheck was not available.
