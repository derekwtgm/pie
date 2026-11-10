# EightMax Windows 4.0

Version 4.0 repairs the action-EV deadline defect, moves large evaluations
into cancellable background jobs, makes exact multiway EVs much faster and
multithreaded, replaces the misleading "equivalent to best" flag with paired
statistical classifications, reports strategy coverage and fallback influence,
and adds a restricted best-response mode. **Training is unchanged**: 4.0 trains
byte-identical states to 3.9 (checked in all ten benchmark scenarios, three
seeds each).

Where things were measured:

| Environment | What ran there |
|---|---|
| Linux, Ubuntu 24.04, 4 logical CPUs (Intel Xeon 2.1 GHz), GCC 13 | builds, full regression suite, sanitizers, all benchmarks |
| Windows x64 executables, MinGW-w64 GCC 13 (posix), Wine 9.0 | `mwcli.exe` deadline and exact-EV parity (bit-identical to Linux) |
| **GitHub Actions `windows-latest` (Windows Server VM, no GPU)**, run [42884730326](https://github.com/derekwtgm/pie/actions/runs/42884730326) | host compiled on Windows from this source; `test_windows.ps1` incl. all 4.0 checks; full regression suite (349 passed, 0 failed, 9 skipped, 0 timed out); `validate_hardware.ps1` CPU paths; PowerShell parse check; package verification |
| CUDA | kernels compiled with NVIDIA NVRTC 12.9 and ptxas to PTX + SASS sm_75/80/86/89; executed only through the Linux CUDA driver test double (the real kernel source run on the CPU) |

**Not done: no physical Windows desktop and no NVIDIA GPU (RTX 4060 Ti or other)
were available. GPU acceleration of EV evaluation is implemented and
correctness-tested through the test double, but its speed on your RTX 4060 Ti
is unmeasured.** Run `Validate CUDA hardware.bat`; its `v40.gpuEvExecutionVerified`
field reports whether CUDA actually scored EV boards on your PC and matched the
CPU bit for bit.

---

## 1. Deadline and cancellation (Priority 1) — fixed

**Defect reproduced.** Eight-player push/fold final table (stacks
30/22/15/40/9/18/25/12, payouts 30/20/14/11/9/7/5/4), fixed hands AA..77,
exact method, `timeLimitMs` 100, `maxVisits` 2·10⁹: 3.9 returned after
**10.2 s** at the root, and at node `[1]` ignored the limit entirely and
returned an "exact" result after 8 s. (A linked preflop study returned at
~0.4 s; the push/fold tree, where every terminal is an all-in with 376,992
runouts, is the pathological case.)

**Cause.** `Evaluator::poll()` checked the clock only when `visits & 4095 == 0`
at entry to `value()`. Runout enumeration inside a terminal added ~377,000
visits without polling, so the bit test hit at random; opponent-tuple loops,
subtree sizing (up to 10⁶ nodes per action, done twice) and best-response
tuple loops never polled.

**Repair** (`native/ev_control.hpp`, `action_ev.hpp`):
- one `EvControl` per request: `steady_clock` (monotonic) deadline, external
  cancel flag, atomic stop code, progress counters;
- `poll(site)` in every expensive loop (tree, runouts, showdown tables,
  pattern counting, chance cards, opponent tuples, reach weights, rejection
  retries, ICM terminals, best-response traversal and tuples, deviation
  selection, subtree sizing, CUDA batches) with an **adaptive** interval
  (halves when two checks are > 1 ms apart, doubles below 0.125 ms);
- the first stop code wins; workers are always joined before returning;
- timed-out exact → HTTP 408 with **no numbers**; cancelled → 409 naming the
  phase; sampled partial results are published only with ≥ `minSamples`
  (default 100) and labelled `partial`;
- subtree sizing done once, capped at what the method decision needs.

**Measured** (query time inside the process):

| Case | 3.9 | 4.0 |
|---|---|---|
| reproduced case, root, 100 ms | 10.2 s | 102.0 ms (Linux), 101.4–101.8 ms (Wine), **101.4 ms (Windows runner, slowest of 5)** |
| 10 consecutive 100 ms timeouts, then a full evaluation | — | all < 250 ms; evaluator stays responsive |
| 100/250/600 ms on push/fold, linked preflop–river, final table exact and sampled | — | all within limit + 150 ms (test tolerance); typical +1 to +4 ms |
| largest gap between deadline checks (full exact run) | — | < 100 ms asserted; typically 5–17 ms |
| external cancel (exact, sampled, response gain, restricted) | — | latency < 100 ms asserted; measured 0.6–2.4 ms |
| fault-injected cancel inside each of 14 phases | — | 409 each, no result |

Documented tolerance: return within `timeLimitMs + 50 ms` on an idle machine.

## 2. Background evaluation jobs (Priority 2) — implemented

`native/ev_jobs.h` + `server.c`; API in `MW-PROTOCOL.md` ("Evaluation jobs").
Jobs carry id, study id, request (node, hands, method, seed, time, visit,
sample and memory budgets), creation time, status (pending, running,
completed, cancelled, timedOut, failed), progress, result or error. Bounded
pool (default 2 workers, threads per job = logical CPUs/2 ≤ 8), FIFO queue
(16), 32 retained jobs, memory pool = ¼ of available RAM (256–2,048 MiB; a
16 GB PC gets ≤ 2 GiB). Requests are validated **before** a job exists.
Jobs and explorer queries read the study concurrently as readers; training,
import, restore, free and init are refused while readers exist, and a queued
job whose study changed fails instead of evaluating another study.

Measured: during a running exact job, explorer node, status, memory and
checkpoint-status requests answered in 2–26 ms (Linux / Windows runner);
cancel → `cancelled` in 8 ms (Linux) / 75 ms (Windows runner, polled every
20 ms); exported solver state byte-identical before and after completed,
cancelled and timed-out jobs; training 200 + jobs + 200 equals 400 updates
without jobs, byte for byte. ThreadSanitizer: no reports over concurrent
exact, sampled, response-gain and restricted tasks with mid-run cancellation,
progress readers and explorer queries.

The explorer now runs EVs as jobs and shows status, elapsed time, samples,
boards scored (CPU/GPU), stage, memory and a Cancel button. No completion
percentage is shown.

## 3. Exact and sampled EVs (Priorities 3, 8, 9, 10)

**Showdown tables.** Per deal, all seats are scored once on every board
completion; per set of contesting seats the table is reduced to an integer
histogram of rank patterns; the terminal utility is Σ count·u(pattern)/boards.
Same expectation as 3.9; only summation order differs. Over budget
(`memoryMiB`, atomic reservation) → per-board enumeration.

Agreement: 3.9 vs 4.0 exact EVs max relative difference ≤ 7.1·10⁻¹³ across
all benchmark scenarios; 4.0 tables vs per-board enumeration < 10⁻⁹ (test);
the 3.9 independent-reference tests (1e-9) all pass unchanged.

**Threads.** Exact work items = (action, first opponent's hand), partial sums
reduced in item order; sampled work in fixed 256-sample blocks with per-block
streams, reduced in block order. Hence **bit-identical results (EVs, SEs,
visits, labels) for every thread count** for a completed run. Time-limited
partial runs depend on which blocks finished. Visits exclude per-worker table
work, so `maxVisits` decisions are thread-independent.

Thread scaling (`validation/4.0/threads40.json`, 4 logical CPUs):

| Case | 1 thread | 2 | 4 | cancel latency |
|---|---|---|---|---|
| 8-player push/fold exact root (2 work items) | 2.35 s | 1.33 s (1.76×) | 1.31 s (1.79×) | 1.6–2.4 ms |
| 8-player final table sampled, 40,000 samples | 1.08 s | 0.51 s (2.13×) | 0.28 s (3.91×), CPU 3.56 | 0.7–2.1 ms |

Fixed-hand spots have only as many work items as actions, which limits
scaling.

**CUDA** (`score.cu` `board_scores`, `cuda_score.hpp`): bounded chunks
(≤ 1 M boards, within `gpuMiB`, VRAM reserve max(1 GiB, 25%)), buffer reuse,
cancellation between chunks, verification against the CPU on the first
65,536 boards of the first table (integer-exact) with measured speeds.
`auto` uses CUDA only for ≥ 262,144 evaluations and only if measured ≥ 10%
faster; `gpu` whenever it works; `hybrid` splits a table GPU/CPU by measured
speed; a busy device leaves the table to the CPU. Test double: CPU, GPU and
hybrid EVs bit-identical; injected faults (alloc, launch, download, mismatch,
missing driver, compute 6.1, VRAM pressure) all fall back with the same EVs
and a `gpuNote`. **RTX 4060 Ti speed: not measured.** Estimate on the CPU: scoring the
eight-player push/fold table (376,992 boards × 8 seats) takes about 0.43 s
single-threaded (measured with the identical workload of `mwcli --equity`),
about 18% of the 2.35 s root evaluation; the rest is pattern counting, ICM and
tree traversal. Even an infinitely fast GPU could therefore save at most
about a fifth of that evaluation.

## 4. Statistics (Priority 4) — repaired

3.9 set `equivalentToBest` when a difference was within 1.96 paired SE. 4.0
classifies each action against the highest estimate using paired
differences (same cards for all actions): `differenceSupported` (95% interval
excludes 0), `differenceUncertain` (it does not: **not** evidence of
equality), `practicallyEquivalent` (only with an explicit
`equivalenceMargin`: two one-sided tests, α = 0.05), `insufficientSamples`
(< `minSamples`); exact results: `highest`, `exactTie`, `withinMargin`,
`lower`. Responses include `vsBest`, `vsBestCi95`, plain-language
interpretations and a statistics note (normal approximation, no multiplicity
adjustment, best selected on the same samples). The interface never shows
overlap as equality (tested).

## 5. Coverage and fallback (Priority 5)

Every result reports policy lookups, stored and fallback lookups, distinct
(fallback) information sets, row coverage, the probability-weighted fallback
share per action and per opponent range, and for sampled runs the share of
samples touched; `influence` none/minor/notable/substantial with
configurable thresholds (5% / 25%) and a warning text. Fallback policy is
selectable (uniform, foldCheck, callCheck, or refuse); `fallbackSensitivity`
recomputes exact EVs under all three and reports whether the best action
changes (labelled "not a confidence interval").

## 6. Strategy-quality evaluation (Priority 6)

Three named modes: `exactBestResponse`, `restrictedBestResponse` (new:
best response on the study's first street by backward induction, exact or
sampled selection; independent evaluation stream for sampled), and
`sampledOneDecisionDeviation`. Per seat: gain, SE/CI, samples, time,
lookups. Validation: restricted (exact selection) **equals the exact best
response to 10⁻⁸ on heads-up river, three-way side pots and three-way ICM**
(single-street studies), and is ≤ the exact best response on the two-street
turn study. Restricted gains are lower bounds, never exploitability.

## 7. Convergence (Priority 7) — investigated, no change

`tools/convergence40.js`, `validation/4.0/convergence40.json`: four games
with exact NashConv, five seeds, 10k–480k sampled deals, existing variants
(linear = default, DCFR 1.5/0/2, DCFR 1.5/0.5/2, CFR+ flooring). Paired 95%
intervals: the default is best or tied at every checkpoint ≥ 40k deals in
all four games; DCFR is better only at 10k deals on the turn study; CFR+
flooring is worse everywhere. Example, heads-up river at 480k deals: linear
0.083 ± 0.014, DCFR 0.164 ± 0.010, CFR+ 0.274 ± 0.007. **No training default
was changed and no convergence improvement is claimed.**

## 8. 3.9 vs 4.0 benchmarks (Priority 16)

`tools/bench40.js`, `validation/4.0/bench40.json`: medians of 3 training
seeds, process wall time in seconds (startup included), same 3.9-compatible
requests to both engines.

| Scenario | Exact EV 3.9 | 4.0, 1 thr | 4.0, 4 thr | Sampled EV 3.9 | 4.0, 1 thr | 4.0, 4 thr | Gain 3.9 | 4.0 | 100 ms limit 3.9 → 4.0 |
|---|---|---|---|---|---|---|---|---|---|
| Heads-up river | 0.006 | 0.006 | 0.007 | 0.149 | 0.136 | 0.044 | 0.006 | 0.005 | done before limit |
| Heads-up turn | 0.008 | 0.008 | 0.009 | 0.150 | 0.118 | 0.045 | 0.007 | 0.007 | done before limit |
| Three-player river | 0.007 | 0.009 | 0.008 | 0.471 | **0.542** | 0.140 | 0.010 | 0.008 | done before limit |
| Four-player flop | 2.11 | 1.75 | 0.59 | 0.323 | 0.335 | 0.092 | 0.216 | 0.237 | 0.107 s → 101.8 ms |
| Six-player flop | 2.29 | 1.92 | 0.98 | 2.16 | **2.40** | 0.68 | 2.28 | **2.52** | 0.108 s → 101.6 ms |
| Eight-player preflop push/fold | 4.76 | 0.86 | 0.47 | 2.03 | 1.99 | 0.53 | 1.68 | 1.79 | **4.64 s → 103 ms** |
| Eight-player linked preflop–river | > 300 (killed) | 408 at 300 s | **91** | 0.457 | 0.039 | 0.030 | 0.990 | 0.435 | 0.559 s → 101.7 ms |
| Multiway short-stack all-ins | 2.16 | 0.54 | 0.28 | 0.344 | 0.348 | 0.115 | 1.30 | 1.17 | **2.19 s → 103 ms** |
| Bubble ICM (random ranges) | exact intractable | | | 0.123 | 0.112 | 0.046 | 0.211 | 0.211 | – |
| Eight-player final-table ICM | exact intractable | | | 0.525 | 0.176 | 0.073 | 11.7 | 11.5 | – |

Regressions (bold): single-threaded sampled evaluation and sampled response
gains are up to ~10–15% slower in the three- and six-player studies (deadline
polling and coverage bookkeeping; reduced from ~20% by replacing a hash set
with a fixed table). Peak RSS is +0.1 to +0.7 MiB. Response gains are
single-threaded in 4.0. Sampled-EV speedups in the linked and final-table
studies come from the capped subtree sizing, not from faster sampling. Peak
VRAM was not measured (no GPU).

## 9. Tests and sanitizers (Priorities 12, 13)

- Regression suite: see `validation/4.0/regression-tests.json` (totals in
  CHANGELOG.md). New: `tests/v40.test.js`, 17 tests: reproduced deadline
  case; deadlines on other games/limits and repeated timeouts; external
  cancellation; cancellation inside 14 phases; table vs per-board parity and
  thread invariance; CUDA test double with 7 injected faults; memory budget;
  sampled thread invariance and uncertainty; statistical classification and
  TOST; coverage, fallback policies and sensitivity; restricted best
  response; desktop jobs (nonblocking, progress, cancel, timeout, queue,
  release, malformed requests, refused mutations, unchanged state); worker
  start failure and bounded workers; deterministic continuation around
  evaluations; eight-handed blinds/antes/2.3 BB pot and side-pot chip
  conservation; ICM hand calculation; explorer presentation. The 341 earlier
  tests are unchanged and pass.
- `tools/sanitize40.sh` (`validation/4.0/sanitizers.log`): ThreadSanitizer and
  ASan+UBSan on the concurrency stress tool and the CPU/GPU/hybrid paths;
  v39 and v40 suites against an ASan+UBSan `mwcli`; cppcheck: no findings in
  4.0 code (two pre-existing findings in unchanged 3.x training/checkpoint
  code are listed).
- Checkpoint utilities from 3.7 (restore sizes, deterministic continuation),
  checkpoint stress, explorer-host and native-host tests re-run by
  `tools/release.sh`.

## 10. Remaining limitations

- No physical Windows desktop or NVIDIA GPU testing; RTX 4060 Ti CUDA speed
  for EV tables unknown. The CUDA path covers showdown tables only; tree
  traversal, ICM and sampling stay on the CPU by design.
- Exact evaluation of large trees (e.g. linked preflop–river with chance
  enumeration) remains expensive; the deadline makes it safe, not fast.
- Response gains for 3+ seats or ICM are per-seat gains / lower bounds, not
  exploitability; nothing here certifies an eight-player Nash equilibrium.
- Sampled confidence intervals are normal approximations without
  multiplicity adjustment; a time-limited sampled run is a valid but
  timing-dependent subset of blocks.
- `maxVisits` does not include showdown-table work (reported separately).
- Training algorithms unchanged; the convergence study found no better
  existing variant.
- Browser full-traversal checkpoint memory limits from 3.9 are unchanged.
- The Windows self-test and hardware scripts were parsed and executed on the
  Windows runner, not on your PC; please run them.
