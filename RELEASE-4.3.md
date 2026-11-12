# EightMax Windows 4.3

Development environment for everything below unless stated otherwise: Linux
(Ubuntu 24.04), **4 logical CPUs**, 15 GiB RAM, GCC 13.3, MinGW-w64 GCC 13 (posix),
Node 22, Wine 9.0. **No physical Windows desktop and no NVIDIA GPU were available.**
Every CUDA statement below rests on the Linux CUDA driver test double (the real
kernel source run on the CPU; it enforces per-thread current contexts and tracks
every device allocation). That is evidence for host-side logic, context
ownership, fallback and numerical parity, and **none** for physical driver
behaviour, timing or VRAM on your RTX 4060 Ti. `Validate CUDA hardware.bat`
measures those on your PC (section 9 is new: cold vs warm CUDA in one process).

Inputs used: `EightMax-Windows-4.2.zip` and your three reports
(`hardware-validation.json`, `Windows-self-test.json`, `device-results.json`,
build `80797f6402bc38b6`, RTX 4060 Ti, 24 logical processors).

Starting point re-verified: the 4.2 sources rebuild `EightMax.exe`, `mwcli.exe`
and `gpustress.exe` **byte-identically** to the shipped executables, and the
4.2 regression suite passes here in an optimized build: **389 passed, 0 failed,
0 timed out** (the full suite now completes in about 8 minutes; the two suites
that hit time limits in the previous independent run complete).

## What your hardware report showed (Phase 1)

| Observation in `hardware-validation.json` (4.2) | Cause found in the code |
|---|---|
| Exact EV, ≥ 2 threads: **753,984** boards scored for a **376,992**-board table (1 thread: 376,992) | each worker built its **own copy** of the same showdown table |
| 8-seat exact response gains: pattern counting ~0.25 s regardless of 1–24 workers | each seat rebuilt the **same** table: 8 × 376,992 = 3,015,936 boards |
| GPU modes, ≥ 2 threads: `gpuLockWait` 0.074–0.086 s | the second worker waited on the device lock while the first opened CUDA (63–73 ms) and verified it — for a duplicate table |
| CPU rows: pattern counting 0.030 s ≈ table scoring 0.029 s per table | full-seat rank pattern via insertion sort + `std::unordered_map` per board |
| GPU kernel+download 1.5 ms vs start-up 63–73 ms | start-up paid inside the request, once per process (`mwcli` = one process per measurement) |
| Response gains: 8 workers ≈ 24 workers | seats were the parallel unit (8) and each seat's work was the same duplicated table |

## Summary

| Priority | Status | Evidence |
|---|---|---|
| 1 CUDA start-up / reuse | **Implemented, verified with the driver double; physical timing pending.** One primary context + module per process (unchanged 4.2 guard), verified once per process; background start-up (`openAsync`, `EM_GPU_PREWARM=1` for the desktop host); pooled buffers kept warm and released after `EM_GPU_IDLE_RELEASE_S` (default 60 s) idle; in-process session mode for cold/warm measurement | `tests/v43.test.js` lifecycle tests, `table43.cpp lifecycle`, `validation/4.3/session-ev-gpu-double.json` |
| 2 Batching / amortisation | **Implemented.** One table per request (shared by workers and seats), built in 16,384-board chunks; the device pulls 8-chunk batches, CPU threads pull single chunks; CPU threads pattern-count device-scored chunks while the next kernel runs | bit-identical results; boards scored halved / ÷8 |
| 3 Automatic scheduling | **New cost model** (`autoChoice43`, unit-tested): predicted CPU table time (measured ns/eval ÷ threads that build it) vs one measured device batch (upload + kernel + download); start-up never inside a table; busy/opening device → CPU without waiting | `table43.cpp` (11 decision checks) |
| 4 GPU lock contention | **Root cause removed**: duplicate tables. GPU-mode 8-seat gains on the double: 4.2 **2.48 s** summed lock wait and 2,950,400 GPU boards → 4.3 **0 s** and 376,992 boards | v43 test 10 |
| 5 Coverage capacity | **Implemented and verified to 2,000,000 information sets**: configurable `coverageMiB` (default 64 → 2,097,152 exact keys), shared byte pool, 16-byte slots, exact lower bounds + labelled HyperLogLog estimates when capped | `tests/coverage43.cpp` 116/116 checks |
| 6 Native CPU | **Implemented**: shared tables, fused score + full-seat pattern (5.8× faster rank code, flat histogram), board suit masks shared by all seats, helper threads within the thread budget | `bench43.json` |
| 7 Convergence | **Investigated with 10 seeds, 3 games, 6 variants, 160 Holm-adjusted comparisons. No variant is better on every game; default retained.** | `convergence43.json` |
| 8 Multiway postflop | Shared-table parity tests on 8-player two-hand preflop, 3-player flop (linked turn/river), 4-player turn with side pots; 4-player-turn and 3-player-flop convergence study. Rules unchanged | v43 test 3 |
| 9 Response gains | Exact: 3.9–5.1× faster, bit-identical to 4.2 for 1–8 threads; per-seat distinct-count kind reported | `bench43.json` |
| 10 Checkpoints | **Unchanged** (no code change); all checkpoint/restoration suites pass | regression suite |
| 11/12 Rules, MCCFR continuation | **Unchanged** (training states byte-identical to 4.2 for all 9 training benchmarks) | `bench43.json` training rows |
| 13 Tests | 389 inherited + **15 new** tests: **404 passed, 0 failed**; ASan+UBSan, TSan (one real race found and fixed) | `validation/4.3/regression-tests.json` |
| 14 Physical validation | **Pending on your PC** — utilities updated | `Validate CUDA hardware.bat`, `Run self-tests.bat` |
| 16 Release | Rebuilt; Windows executables built twice and compared byte for byte; build ids match | `BUILD-INFO.json`, `SHA256SUMS.txt` |

## 1. Shared, cooperatively built showdown tables (Priorities 2, 4, 6, 9)

`native/showdown_table.hpp`, `native/action_ev.hpp`.

* **TableCache** (one per request; response-gain seats share the parent's):
  a table is identified exactly as before (board prefix, dead cards, every
  seat's hole cards). The first worker that needs it becomes its owner; others
  that need it **help** instead of building their own copy.
* **Chunks**: 16,384 boards; claimed from an atomic counter by the owner, by
  helper threads (spawned only up to the request's thread budget minus the
  workers already running), and by any other worker needing the table.
* **Fused patterns**: right after a row is scored, its full-seat dense rank code
  is computed (`fullPattern`, branch-free, 26.8 vs 155.9 ns for 4.2's
  `rankPattern` on 8 seats) and added to a per-thread open-addressing histogram
  (`FlatHist`). Histograms merge as integer sums, so **who scored which chunk
  cannot change any count**: results are bit-identical by construction. Subset
  histograms are still exact projections (4.2).
* **Device as a participant**: the thread holding the device claims 8-chunk
  batches (131,072 boards; `EM_GPU_BATCH_CHUNKS`), split further so a launch
  never exceeds `gpuBudgetBytes` (4.2 rule). In GPU-preferred mode CPU threads
  only pattern-count device-scored chunks while the next kernel runs; in hybrid
  and Automatic they also score chunks (dynamic balance replaces 4.2's static
  split). The verification chunks (and in GPU/hybrid mode the first device
  batch) are reserved before helpers start; whatever the device does not score
  is scored on the CPU (chunk states: nothing twice, nothing omitted).
* Tables smaller than one chunk (turn/river completions) stay per worker as in
  4.2 — sharing them only added lock traffic (measured, then fixed: four-player
  turn gains were 7% slower before this).
* Waiting threads check deadline/cancellation without counting it as work
  (`Poller::waitCheck`); work accounting stays exact (a v41 test caught this).
* A/B switches: `EM_EV_PRIVATE_TABLES=1` (4.2 private tables),
  `EM_EV_DIRECT_PATTERNS=1` (4.1 subset counting), `EM_EV_NO_TABLES=1` (3.9).

**Correctness evidence**: eight-player ICM fixture exact EV
`15.020151348500445, 15.670177585564113` and eight-seat exact gains equal the
4.2 release bit for bit for 1/2/4/8 threads, with private tables, with the 4.1
pattern method; 3-player flop, 4-player turn and 8-player two-hand studies
identical across threads and private tables and within 1e-9 of 3.9's per-board
enumeration (summation order); 34-case device × threads × fault matrix on the
driver double identical; ThreadSanitizer and ASan+UBSan builds clean
(`gpustress` plain/TSan/ASan, sanitized `mwcli` EV and gains on 8 threads,
cancellation inside cooperative construction).

**ThreadSanitizer finding (fixed)**: the cache's LRU clock was incremented
outside the cache lock (a race, benign in effect). Now atomic; TSan clean.

## 2. CUDA lifecycle (Priority 1)

The 4.2 context design (primary context, RAII push/pop per call, process
ledger, failure classes) is **unchanged** — it passed on your hardware. Added:

| Mechanism | What it does |
|---|---|
| process lifetime | context and module opened once per process; verification (65,536 boards, bit for bit) once per process; pooled buffers reused across tables, requests and jobs |
| `openAsync()` | start-up on a background thread; Automatic requests it once the warm-up is spent (`EM_GPU_INIT_ESTIMATE_S`, default 0.3 s of CPU table time) and keeps scoring on the CPU meanwhile — no table ever waits for start-up (4.2 paid 63–73 ms inside the request) |
| `EM_GPU_PREWARM=1` | desktop host opens the device in the background at launch |
| idle janitor | frees pooled buffers (not the context) after `EM_GPU_IDLE_RELEASE_S` idle (default 60 s, 0 = never); re-allocated on next use |
| `GET /api/mw/gpu-status` | opens, background opens, verifications, uses, idle releases, seconds since last use, device bytes, measured rates |
| `mwcli --session` | one process, many requests: cold, warm, sequential, concurrent, after idle, cancelled, after cancellation, budget refusal, after refusal |

Driver-double session (`validation/4.3/session-ev-gpu-double.json`, GPU-preferred,
8 threads, 21 evaluations): **1 primary-context retain, 1 open, 1
verification**; warm runs score all 376,992 boards on the device; idle release
after 1 s then normal use; cancelled run 409 then normal use; budget refusal
`EM_GPU_BUDGET_EXCEEDED` → identical CPU result, device stays available; 0
invalid-context calls, pushes = pops, 0 bytes at exit. (Timings on the double
are meaningless: its "GPU" is the kernel source run on the CPU.)

**What this means for your PC (expectation, not measurement):** your report
measured warm GPU table work at ~1.5–3 ms per table and start-up at 63–73 ms.
With shared tables and all CPU threads building a table, the CPU now finishes
the 376,992-board table in a few milliseconds on 24 threads, so Automatic
should still prefer the CPU for this workload; the device should matter for
larger or more numerous tables, fewer free CPU threads, or a warm desktop host.
Section 9 of the validator measures exactly this (all four modes × 1/2/4/8/24
threads, cold vs warm). **No GPU speed-up is claimed by this release.**

## 3. Automatic cost model (Priority 3)

`autoChoice43()` (pure function; `tests/table43.cpp`):
small (< 262,144 seat-board evaluations) → CPU; device unavailable → CPU;
not yet attempted → warm-up, then background start-up; opening/busy → CPU
without waiting; unverified → verify only if CPU time > 2× a conservative
batch estimate; verified → device joins when CPU time of the table > 1.25×
one measured batch (it pulls batches next to the CPU threads, so it can only
shorten the table). Example checks: 24 CPU threads → CPU; one thread and a
device 6× faster → GPU. Reported: `scheduling.cpuGpuOpening`,
`gpuBackgroundOpens`, `cuda.batchFixedSeconds`, `cuda.cpuFusedNsPerEval`.

## 4. Coverage capacity (Priority 5)

`native/coverage.hpp` (4.2 key semantics unchanged; `accounting` stays "4.2",
`capacityModel` "4.3"): 16-byte slots, `coverageMiB` (1–4096, default
min(64, memoryMiB/4)) sets the exact key limit (32 bytes a key) and a shared
byte pool for all worker tables (48 bytes a key transiently while doubling);
the merged table has its own allowance. Once capped: `distinctCountKind:
"lowerBound"` (exact counts of keys seen before the limit) plus
`distinctEstimates` (HyperLogLog, 2^14 registers, relative standard error
0.81%, labelled approximate). Sketches cost nothing while exact: they start at
the first cap, back-filled from the table. `tests/coverage43.cpp` (116 checks):
100,000 / 500,000 / 1,000,000 / 2,000,000 information sets × 1/2/4/8/16
workers × 3 partition rules × shuffled merge order = sorted-vector reference;
tight pools always give flagged lower bounds; estimates within 4 standard
errors. The 4.2 suite (`coverage42.cpp`) still passes. Engine counts on the
fixture equal the audit (371 / 159 / 212, as on your PC).

## 5. Performance: 4.2 vs 4.3 (Priority 15)

`tools/bench43.js`, `validation/4.3/bench43.json` — same specs, seeds,
requests and thread counts; 5 runs, median (min–max and IQR in the JSON);
process wall time end to end; **4 logical CPUs, CPU only**. Every row's
numbers are **identical** between versions; every training row produces a
**byte-identical** state.

See the table in `validation/4.3/README.md` (generated from the final run).
Headline rows (final build): exact 8-player ICM root EV 1/2/4 threads
1.18× / 1.65× / 2.76×; after two shoves 2.80×; two hands per seat range EV
22.3 s → 10.2 s (2.18×); exact 8-seat response gains 5.10× (1 thread) – 3.94×
(4 threads); three-player flop gains 1.22×. Equity, sampled EVs, restricted
gains and training unchanged within noise (interleaved A/B: ±2%).
**One reproducible regression: sampled one-decision response gains about 5%
slower** (0.530 → 0.558 s, 11 interleaved runs; ~2% traced to the coverage
table, the rest not isolated).

Scaling on your 24-thread CPU was not measured here (4 CPUs). The 4.2 report
showed no gain beyond 8 workers because work was duplicated per worker/seat;
with shared tables extra threads help build the table, so more scaling is
expected — section 9 of the validator and `Run self-tests.bat` (4.3 checks
print per-thread times) measure it.

## 6. Convergence (Priority 7)

`tools/convergence43.js`, `validation/4.3/convergence43.json`: 10 seeds;
exact NashConv (sum of exact per-seat best-response gains, measured
independently of training) at each checkpoint; mean, median, SD, 95% t
interval, per-seat gains, training and evaluation seconds, peak RSS; paired
comparisons with the default at equal samples and at **equal training time**
(log NashConv interpolated at the default's time), Holm over all 160.

| Game | Default NashConv at the last checkpoint (mean ± 95% CI) | Significant after Holm |
|---|---|---|
| 8-player push/fold, fixed hands, ICM, 500k deals | 5.5e-7 ± 6.0e-7 | **DCFR(1,1,2) better** at equal time (log-NashConv −2.3 … −6.9, p ≤ 0.004); RM+ worse |
| 3-player river, side pots, ICM, 500k deals | 0.061 ± 0.010 | **DCFR(1,1,2) worse** (equal time +0.42 at 500k, p = 0.006); RM+ worse |
| 4-player turn, side pots, chip EV, 100k deals | 1.49 ± 0.07 (chips) | **DCFR(1,1,2) worse** at 100k (p < 0.001); RM+ worse |

`terminalBaseline` and `terminalExpectation` (both unbiased; audited) had lower
mean NashConv at equal samples in most rows (e.g. river 0.043 vs 0.061) but no
difference survived Holm, and they cost 5–65% more time per deal. **Verdict:
no variant is better on every game; the default (linear averaging, standard
regret matching) is retained; training code is unchanged.** DCFR(1,1,2)
remains selectable and is the stronger choice for preflop push/fold-type
games *in this study*. NashConv here describes these abstractions only; for
more than two seats or ICM it is not exploitability, and nothing here
establishes an eight-handed No-Limit Hold'em equilibrium.

## 7. Tests changed (Priority 13) — full disclosure

No test was removed. Two **assertions** encoding deliberately replaced 4.2
behaviour were amended (annotated "4.3 amendment" in the files):

* `v41.test.js` "CUDA scheduling": the Automatic rule text may now be the 4.3
  cost model; the decision-sum includes the new `cpuGpuOpening` category.
* `v42.test.js` "Automatic mode": once the warm-up is spent the device must be
  started **in the background** with no table waiting (`gpuBackgroundOpens ≥ 1`,
  `cudaStartup = 0`) instead of being opened and verified inside the request.

Two engine defects were caught by existing tests during development and fixed
(wait polls counted as table work; hybrid giving the device no share).

New: `tests/v43.test.js` (15 tests), `tests/table43.cpp`,
`tests/coverage43.cpp`, `tools/sessions43/*.json`.

**Note — a last-digit difference in your 4.2 report (not an engine difference):**
`hardware-validation.json` shows seat 2's eight-seat gain as
`0.0074652466318276814`, which parses to a double one unit in the last place
below the Linux result `0.0074652466318276822`. Run under Wine, both the 4.2
and the 4.3 **Windows** executables print the Linux value, so the engine agrees
across platforms; the string most likely comes from PowerShell 5.1's `"R"`
format (.NET Framework's "R" is documented not to round-trip every double).
The Windows self-test compares strings formatted the same way on the same PC.

## 8. Windows tools

* `Run self-tests.bat` → `validation/4.3/windows-release.ps1` → `test_windows.ps1`
  adds: one table per request for 1/2/4/8/all threads (times printed), EVs and
  eight-seat gains bit-identical to your 4.2 Windows values, private-table A/B,
  `coverageMiB` validation and reporting, an in-process session.
* `Validate CUDA hardware.bat` adds section 9 (`v43` in
  `hardware-validation.json`): sessions for CPU/GPU/hybrid/auto × 1/2/4/8/all
  threads — cold, warm, ten sequential, four concurrent, after 1.5 s idle,
  cancelled, after cancellation, budget refusal, after refusal — with medians,
  start-up, verification, upload, kernel+download, lock wait, boards per device,
  CUDA errors, opens and verifications per process (must be ≤ 1), plus
  response-gain sessions. Fails on any value mismatch or hard CUDA error.
* `Compare processing modes.bat` (`device-results.json`) unchanged (training scorer).

## Known limitations

* No physical GPU or Windows desktop here: all CUDA timing claims await your
  validator run. The embedded CUDA module is unchanged (rebuilding it was not
  possible in this environment; a fused on-device pattern kernel remains a
  candidate if your measurements show the GPU can win end to end).
* Coverage beyond the exact limit is a lower bound plus an approximate
  estimate; exact external-memory counting was not implemented.
* Sampled one-decision response gains are about 5% slower than 4.2
  (reproducible in interleaved runs; cause only partly isolated).
* Exact best responses for eight seats with two or more hands per seat still
  take minutes; six-player flop exact EVs with ranges take minutes.
* Convergence results hold for the three studied abstractions only.
* Browser full-traversal restoration limit (2 GiB decoded) unchanged.
