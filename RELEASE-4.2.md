# EightMax Windows 4.2

Development environment for everything below unless stated otherwise: Linux
(Ubuntu 24.04), 4 logical CPUs (Intel Xeon 2.1 GHz), 15 GiB RAM, GCC 13,
MinGW-w64 GCC 13 (posix), Wine 9.0. **No physical Windows desktop and no NVIDIA
GPU were available.** Every CUDA statement below rests on the Linux CUDA driver
test double, which runs the real kernel source on the CPU and, new in 4.2,
enforces the real driver's per-thread current-context rules and tracks every
device allocation. That is strong evidence for host-side logic and none at all
for PTX/SASS execution, driver behaviour, timing or VRAM on your RTX 4060 Ti.
Run `Validate CUDA hardware.bat` on that PC; section 12 lists what it checks.

The three validation reports named in the request (`device-results.json`,
`hardware-validation.json`, `Windows-self-test.json`) were **not in the upload**
(only the 4.1 ZIP was). The 4.1 hardware figures used here are the ones quoted
in the request.

Release build identifier: **`80797f6402bc38b6`** (source, interface, `EightMax.exe`, `mwcli.exe`, `gpustress.exe`).

Starting point re-verified: the 4.1 ZIP rebuilt byte-identically
(`f7370fd5db0b0f52`), and the 4.1 regression suite passed here: 373 passed,
0 failed.

## Summary

| Priority | Result | Evidence |
|---|---|---|
| 1 Coverage accounting | **Fixed and verified.** Reproduced 4.1 defect (2 instead of 1); 4.2 equals an independent `std::set` reference and the end-to-end audit, identical for 1/2/4/8 threads | `coverage42.json`, v42 tests 1-4 |
| 2 GPU budget validation | **Fixed.** Real request measured (2,671 B); request-1 refused before allocation with identical CPU result; request runs on GPU | v42 test 7, `cuda42.json` |
| 3 CUDA context failures | **Root cause established with a strict driver double; fix verified there; not yet confirmed on hardware.** Both 4.1 hardware signatures reproduced | `cuda-context-repro.txt`, v42 tests 5-12 |
| 4 Complete-EV performance | **Exact EVs 4.7-17x faster, exact response gains 24x**, bit-identical. Cause of slow complete EVs found: 96% pattern counting, 3% board scoring | `bench42.json`, `profile42.json` |
| 5 Scheduling / resources | Bounded GPU waits, transient vs fatal failures, warm-up rule, atomic device state, process VRAM ledger | v42 tests 8-12 |
| 6 Response gains | Same values bit for bit, 24x faster, per-seat distinct coverage; seed spread reported | `bench42.json`, `convergence42.json` |
| 7 Convergence | Investigated on eight-player and three-player ICM games, 4k-500k deals, 3 seeds: no alternative better; training unchanged | `convergence42.json` |
| 8 Native performance | Profiled; the pattern-projection change above; training unchanged | `profile42.json` |
| 13 Tests | 4.1 suite kept; 16 new tests + 3 C++ suites + stress tool; ASan/UBSan/TSan | `regression-tests.json` |

## 1. Strategy coverage (Priority 1) — fixed, release-blocking

**Defect (confirmed).** `native/action_ev.hpp` 4.1 stored `key | 1` (0 meant
"empty"). `merge()` re-inserted the *stored* value: `place(43)` starts probing
at `mix(43)`, not at `mix(42)`, where a later `note(42)` looks. Sequence
"observe 42 on a worker, merge, observe 42" reported 2 distinct sets
(reproduced verbatim with the 4.1 code in `tests/coverage42.cpp`). Two more
identity problems were found in the same line:

* `key | 1` makes keys 2k and 2k+1 compare equal; they merge whenever their probe
  sequences meet (reproduced with keys 66814/66815: 4.1 counted 1).
* the caller used `rowKey(state, hand, code) ^ (seat << 62)`, but `rowKey` puts
  the betting state in bits 37-63, so two different states of different seats
  could produce one key (reproduced).

In the real EV path within one `pool.coverage()` call the merges re-hash
consistently, so 4.1's visible error there was mostly *under*counting: the
eight-player push/fold exact EV reported 318 distinct sets, 4.2 and the audit
report 319. Regret tables, strategies and EV arithmetic never used these keys.

**Fix.** `native/coverage.hpp` (no dependencies): 128-bit keys `{id, namespace}`
stored unmodified (row identity `rowKey(...)` + seat, or a separate synthetic
namespace `(state, seat, range index)` for lookups without a strategy key); probe
start always from the original key; merge = set union; growable open-addressing
table (1,024 slots up to 524,288 keys, 8.9 MB at the cap; beyond it counts are
flagged lower bounds). Per key: seen with a stored row / seen with the fallback.

**Reported now** (`coverage` object, `accounting: "4.2"`): `policyLookups`,
`storedLookups`, `fallbackLookups` (visits); `distinctInformationSets`,
`distinctStoredInformationSets`, `distinctFallbackInformationSets`,
`distinctStoredShare` (sets); probability-weighted fallback shares unchanged.
Response-gain seats report their distinct counts too. The explorer shows visits
and distinct sets separately.

**Verification.** `tests/coverage42.cpp` (16 checks, also under ASan+UBSan and
TSan): repeated observations, identical keys on 8 workers, every key in one hash
bucket, four buckets, 1/2/4/8 workers × 3 partition rules × random merge orders
(48 runs, 400,000 observations), repeated and nested merges, 300,000 distinct
keys, the cap — all equal to a `std::map` reference built single-threaded.
End to end, `EM_COVERAGE_AUDIT=1` records every lookup's raw tuple in a
`std::set` (no hashing, no packing): engine = audit for exact and sampled EVs on
a heads-up river and the eight-player ICM study, identical for 1, 2, 4 and 8
threads; response-gain counts identical for 1, 2, 4 threads (exact, restricted,
sampled).

## 2. GPU memory-budget validation (Priority 2) — corrected

The 4.1 validator expected `gpuMiB: 1` to force CPU fallback. Measured: the
three-player preflop equity kernel requests **2,671 bytes** (spec 55 B,
binomial table 2,544 B, totals 72 B), so 1 MiB is legitimately enough. VRAM
protection itself was sound.

4.2 adds `gpuBudgetBytes` (exact bytes, equity and EV requests) and reports
`gpuRequestedBytes`, `gpuBudgetBytes`, `gpuBufferPeakBytes`, `gpuBytesHeldAfter`
and a structured `gpuError`. Budgets are checked **before any driver call**.

| Budget | Result (driver double) |
|---|---|
| 2,670 B (request − 1) | refused, `EM_GPU_BUDGET_EXCEEDED`, 0 device allocations, CPU result identical |
| 2,671 B (= request) | GPU, peak 2,671 B, identical |
| 1 MiB | GPU (the 4.1 assumption was wrong) |
| EV tables, 4,096 B | every table to the CPU, device **not** disabled, identical EVs, error records `requestedBytes > budgetBytes` |
| 25 consecutive out-of-memory failures | each reported as CUDA_ERROR_OUT_OF_MEMORY, 0 bytes held afterwards |

The reserve rule (leave max(1 GiB, 25 %) of VRAM free) is unchanged.

## 3. Multithreaded CUDA context failures (Priority 3)

**Cause (established in the development environment).** The CUDA driver keeps a
*current context per host thread*. 4.1 created its EV context with
`cuCtxCreate` — current only on the creating thread — inside the first EV worker
that needed the GPU, then called `cuMemGetInfo`, `cuMemAlloc`, `cuLaunchKernel`
and `cuMemFree` from other EV worker threads. Those calls fail with
CUDA_ERROR_INVALID_CONTEXT (201); 4.1 reported every such failure as "CUDA
allocation, VRAM reserve or launch failed during an EV table" and disabled the
GPU. Training (`ScoreSchedule`) and standalone equity create a private context
and use it on one thread, which is why those worked on your PC.

The 4.1 test double accepted every call from every thread and hid this. The 4.2
double enforces the driver's rules. Running the **unmodified 4.1 CLI** on the
4.1 validator's complete-EV workload reproduces both signatures of your report
(`validation/4.2/cuda-context-repro.txt`):

* 65,536 GPU boards (= the verification prefix, scored on the opening thread),
  then the generic message — your GPU-preferred and Automatic rows;
* **0** GPU boards when another worker reaches the device first — your Hybrid
  row (two workers raced to verify the device);
* plus 2-5 invalid-context driver calls and 2.0 MB of device memory never freed
  (`cuMemFree` from the wrong thread fails).

This is a reproduction with a simulated driver, consistent with every number
in your report; it becomes a confirmed physical diagnosis only when the 4.2
validator runs cleanly on your PC.

**Fix.** `native/cuda_score.hpp`: the device's *primary* context is retained
(shared by all users in the process; fallback `cuCtxCreate` + `cuCtxPopCurrent`
so it floats) and every public call makes it current through a balanced RAII
guard (`cuCtxPushCurrent` / `cuCtxPopCurrent`) on whichever thread calls.
Buffers are freed with the context current, also in the destructor. In the EV
engine (`showdown_table.hpp`, `action_ev.hpp`): verification runs entirely under
the device lock once per process (no race); device flags are atomics (no thread
blocks on the lock to read them); board counts are committed only after a whole
range succeeded; the CPU rescores every board from the failure point (nothing
counted twice, nothing omitted).

**Diagnostics.** `execution.gpuErrors[]`: operation (e.g. `cuMemAlloc_v2 (EV
table scores)`), result code, error name and description (`cuGetErrorName/String`),
host thread number, context state, requested bytes, free/total VRAM, budget,
reserve, launch grid/block, `cpuFallback`. No device pointers are reported.
Failure classes: budget, VRAM reserve and out-of-memory send one table to the
CPU; anything else (invalid context, launch or copy failure, CPU mismatch)
disables the device for the process.

**Verification with the strict double** (all pass):

| Check | Result |
|---|---|
| gpu/hybrid/auto × 1, 2, 4, 8 threads (and 24 in the repro file) | EVs identical to CPU, 0 invalid-context calls, pushes = pops, 0 bytes at exit |
| GPU-preferred, 8 threads | 688,448 GPU boards + 65,536 CPU verification boards (4.1: 65,536 GPU, rest CPU after failure) |
| one device used from 8 host threads | 8/8 succeed, identical scores, no context left current on any thread |
| 6 concurrent instances on 6 threads | identical equity |
| 40 open/use/destroy cycles | all succeed, process device bytes back to 0 |
| `cuCtxCreate` path (no primary context) | works across threads |
| faults: alloc, allocAfter=N, pressure, launch, download, mismatch | identical EVs, correct class, buffers released |
| cancellation while the GPU is in use (slow-kernel fault) | 409, < 250 ms, 0 bytes held |
| `gpustress`: 25 runs incl. 4 concurrent jobs, 3 cancelled on the GPU, 9 CUDA re-initialisations | all identical to CPU; plain, **TSan** and **ASan+UBSan** builds clean |
| desktop host: concurrent GPU, hybrid and CPU jobs + one cancelled | all completed jobs agree; host and GPU usable afterwards |

`std::timed_mutex` was tried for the bounded wait and replaced with a polled
`std::mutex` after ThreadSanitizer reported it (MinGW winpthreads portability
was the other reason).

## 4. Complete action-EV performance (Priority 4)

**Profile** (`profile42.json`, exact best response of one seat, eight-player ICM
fixture, 1 thread):

| Phase | 4.1 method | 4.2 |
|---|---:|---:|
| board scoring (the part CUDA does) | 0.044 s | 0.044 s |
| rank-pattern counting | 1.826 s (93.1 M operations) | 0.047 s (0.55 M) |
| seat total | 1,888 ms | 85 ms |

So in 4.1 a perfect GPU could have saved at most ~3 % of a complete exact EV:
this, not only the context defect, is why GPU modes never beat the CPU end to
end. **Fix:** the dense ranking of all seats on a board determines the ranking
of every subset, so each table is reduced once to its full-seat pattern
histogram and every subset's histogram is its exact projection. Counts are
integers; results are **bit-identical** (`EM_EV_DIRECT_PATTERNS=1` keeps the 4.1
method; tests compare both on several studies).

**Automatic mode.** A large kernel speed-up is not sufficient: CUDA start-up
(library, context, module) is paid per process. 4.2 opens the device only after
the process has already spent at least the expected start-up time
(`EM_GPU_INIT_ESTIMATE_S`, default 0.3 s) on CPU table work ("ski rental": short
runs never pay start-up; long ones pay at most about twice the optimum), then
verifies it bit for bit on 65,536 boards and uses it only when measured >= 10 %
faster than one CPU worker. Small tables (< 262,144 seat-board evaluations)
stay on the CPU. The 4.1-validator workload now runs **entirely on the CPU in
Automatic mode** (2 tables, decided before the warm-up), which is the right
choice for it. Every result reports `requestedDevice`, `observedDevice`, the
decision counters, `cuda` state (start-up seconds, ns/eval measured, process
device-memory peak) and `profileSeconds` (CPU table scoring, pattern counting,
CUDA start-up, verification, upload+launch, kernel+download, lock wait).

**Not established:** whether the GPU now gives an end-to-end gain on your PC for
any EV workload. With pattern counting fixed, board scoring is about half of the
remaining time in the profile above, so the GPU can matter more *relatively*,
but the absolute time at stake is small (44 ms per seat here). The validator
measures it.

## 5. Scheduling and resources (Priorities 5, 9, 12)

* Device lock: Automatic and Hybrid never wait (busy → CPU); GPU-preferred
  waits at most `gpuWaitMs` (default 2,000 ms, 0-600,000), polling cancellation
  every millisecond, then uses the CPU (`gpuWaitTimeouts`).
* Process-wide device-memory ledger across every CUDA user (training scorer, EV
  tables, equity), reported as current and peak.
* Worker counts: evaluation work items already never start more threads than
  items. The 4.1 observation "8 workers ≈ 24 workers" for response gains is
  explained by the code: seats are the parallel units (8), each seat cost about
  2.4 s here, so the slowest seat bound the wall time. 4.2 cut the seat cost to
  about 0.1 s. The unattended default stays 8 (your measurement supports it); an
  explicit `threads` is honoured. The validator measures 1/2/4/8/12/16/24.
* Not changed: system-RAM accounting (per-request memory budgets and the job
  memory pool as in 4.1).

## 6-7. Response gains and convergence (Priorities 6, 7)

Response-gain values are bit-identical to 4.1 for every method and thread count;
exact eight-seat gains are 24x faster. Methods remain clearly labelled (exact
best response; restricted best response = lower bound; sampled one-decision
deviation = lower bound); none is called exploitability for more than two seats
or for ICM.

`tools/convergence42.js` (`convergence42.json`): default trainer vs DCFR(1,1,2)
at 4,000 / 20,000 / 50,000 / 100,000 / 250,000 / 500,000 sampled deals, seeds
1-3, exact NashConv measured independently of training, per-seat gains with
95 % t intervals, cumulative training seconds (equal-time comparison across
rows), paired differences Holm-adjusted.

| Game | Default NashConv 4k → 500k | DCFR(1,1,2) | Verdict |
|---|---|---|---|
| Eight-player push/fold, fixed hands, ICM | 0.0068 ± 0.020 → 0.0000 (18 s training) | 0.0016 → 0.0000 | no supported difference |
| Three-player river, side pots, ICM | 0.647 ± 0.023 → 0.066 ± 0.048 (1.2 s) | 0.768 → 0.100 | DCFR worse at 50k (Holm), never better |

No training change was made (training states byte-identical to 4.1). The
fixed-hand eight-player game is a small abstraction; reaching NashConv ≈ 0 there
says nothing about full eight-handed No-Limit Hold'em. An eight-player game with
two hands per seat needs about 2,000 showdown tables per exact NashConv (about
5 minutes each here) and was left out of the routine study. EightMax does not
compute an exact eight-player Nash equilibrium.

## 8. 4.1 versus 4.2 benchmarks (Priority 16)

`tools/bench42.js`, 4.1 `mwcli` vs 4.2 `mwcli`, same requests, median of 3 runs
(heavy row: 1 run), CPU only (no GPU here). **Every row: identical numbers /
identical training state.**

| Workload | 4.1 | 4.2 | Ratio |
|---|---:|---:|---:|
| Training: heads-up river, 3-player river, 6-player flop, 8-player preflop, short-stack 8-seat ICM, bubble ICM, final-table ICM | 8-186 ms | 8-167 ms | noise; states byte-identical |
| Equity HU / 3 / 6 / 8 players (CPU) | 0.60 / 0.47 / 0.20 / 0.11 s | 0.61 / 0.46 / 0.22 / 0.11 s | 0.91-1.02 |
| Exact EV, 8-player root (ICM) | 1.26 s | 0.084 s | 14.9x |
| Exact EV, 8-player after two shoves | 0.45 s | 0.081 s | 5.6x |
| Exact EV, 2 hands/seat, root range | 393.5 s | 22.5 s | 17.5x |
| Sampled EV, 8-player | 0.53 s | 0.54 s | 0.98 |
| Exact gains, 8 seats, 1 / 4 threads | 16.7 / 4.31 s | 0.67 / 0.18 s | 24.9x / 23.9x |
| Restricted gains (sampled selection), sampled gains | 0.054 / 0.667 s | 0.055 / 0.666 s | ~1.0 |
| GPU requested, unusable: CPU fallback | 1.29 s | 0.090 s | 14.4x |

Regressions: none measured beyond noise; sampled paths and equity are
unchanged code. GPU rows on real hardware: not measured.

## 9. Tournament rules, checkpoints (Priorities 10, 11)

Unchanged code; all 4.1 tests of antes (0.1 bb per dealt player, 2.3 bb
eight-player pot), side pots, chip conservation, ICM, checkpoint restoration,
deterministic continuation and failure rollback pass. CPU, GPU and hybrid EVs
agree bit for bit in every test.

## 10. Tests (Priority 13)

Full suite on the release build `80797f6402bc38b6` (`validation/4.2/regression-tests.json`,
run by `tools/release.sh`): **389 passed, 0 failed, 0 skipped, 0 timed out**
(373 kept from 4.1 + 16 in v42; 26 hardware-dependent tests ran, all on the Linux
CUDA driver test double or the native host). Every 4.1 test is kept. The release
script also passed the 3.7 restoration and deterministic-continuation utilities,
the checkpoint stress test, the explorer/native-host tests and the UI smoke
tests, and rebuilt the Windows executables twice with identical bytes. New: `tests/v42.test.js`
(16 tests), `tests/coverage42.cpp`, `tests/cuda42.cpp`, `tools/gpu_stress42.cpp`.
Sanitizers: ASan+UBSan and TSan builds of the coverage suite and of the GPU
stress tool run inside the suite; LeakSanitizer on a CPU-only stress run.

**Changed old tests (behaviour changed on purpose):**

* `v40.test.js`, `v41.test.js`: seven tests needed exact evaluations slower than
  their deadline, cancellation delay or queue wait; 4.2 finishes those workloads
  sooner. They now run with `EM_EV_DIRECT_PATTERNS=1` (the retained 4.1 method),
  so their workloads and assertions are unchanged; new 4.2 tests check 100/150 ms
  deadlines, cancellation and queued-job budgets on the projection path with a
  workload that still takes 20-80 s.
* one v41 assertion sums the Automatic scheduler's decision categories; it now
  includes the new `cpuGpuWarmup` category.
* the same applies to the 4.0 deadline and 4.1 GPU-cancellation checks inside
  `Run self-tests.bat` and `Validate CUDA hardware.bat`.

Hardware-dependent tests on Linux use the driver test double and are labelled
"(Linux CUDA test double)"; they are not physical GPU validation. The
PowerShell scripts could not be executed here (no PowerShell available); they
were reviewed by hand.

## 11. Windows release (Priority 15)

`EightMax.exe`, `mwcli.exe` and the new `gpustress.exe` are built with MinGW-w64
(static, deterministic: built twice and compared) and embed the build identifier
checked against `BUILD-INFO.json`. Under Wine (no NVIDIA driver): build id
correct, CUDA reported unavailable, GPU-preferred EV falls back with the reason,
EVs and all eight exact response gains bit-identical to Linux, `gpustress.exe`
passes (`wine-checks.txt`). Not tested: a physical Windows desktop, the desktop
UI in a Windows browser, the RTX 4060 Ti.

## 12. What to run on your PC

1. `Run self-tests.bat` → `Windows-self-test.json` (CPU only; adds coverage audit,
   thread invariance, pattern-projection parity, field validation).
2. `Validate CUDA hardware.bat` → `hardware-validation.json`. Look at:
   * `gpuBudget.ok` — request−1 refused, request runs on the GPU;
   * `v42.evTables[]` — for 1, 2, 4, 8 and all threads and each mode: requested vs
     observed device, GPU/CPU boards, `cudaErrors` (should be empty), time,
     peak VRAM, `identicalToCpu`. A GPU-preferred row with ≤ 65,536 GPU boards is
     flagged as the 4.1 failure signature;
   * `v42.stress` — `gpustress.exe`: concurrent jobs, cancellation on the GPU,
     repeated CUDA start-up, all compared with the CPU;
   * `v42.responseGainThreads` — 1/2/4/8/12/16/24 workers;
   * `physicalNvidiaExecution` — true only if CUDA scored boards on your PC and
     matched the CPU bit for bit.

## 13. Remaining limitations

* The CUDA context fix is verified with a simulated driver only. Until the
  validator runs cleanly on the RTX 4060 Ti, the physical diagnosis is a strong,
  consistent reproduction, not a confirmation.
* GPU end-to-end benefit for complete EVs is unmeasured on real hardware and may
  be small (board scoring is now about half of a small total). Automatic mode
  prefers the CPU unless measured otherwise.
* CUDA kernels were not changed (no CUDA toolkit here); fusing pattern counting
  into the kernel was not attempted.
* Training is unchanged; no convergence improvement is claimed. Response gains
  for more than two seats or ICM are per-seat gains / lower bounds, not
  exploitability.
* System-RAM accounting is unchanged from 4.1.
* Browser limitations for large JavaScript checkpoint formats are unchanged
  (Priority 10 of the request's limitation list was not worked on).
* PowerShell scripts were reviewed, not executed, in this environment.
