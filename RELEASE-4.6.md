# EightMax Windows 4.6

Release focus: the Windows self-test that stopped on your PC in 4.5 (release blocker), a test
harness that cannot lose a native error again, a process-wide memory reservation ledger, a
measurement correction for Automatic CPU/GPU mode, and an independent convergence study.

**What has and has not run where**

| Environment | What ran | Status |
|---|---|---|
| Linux build machine (4 logical CPUs, 15 GiB, GCC 13.3, no GPU) | builds, regression suite, sanitizers, cppcheck, convergence study, benchmarks | done |
| Windows executables of this release under Wine 9.0 (not Windows) | `mwcli.exe --continuation-suite` (25 checks, Win32 process/file code paths), golden training hash | done (section 1) |
| The **4.5** Windows executables (rebuilt here byte-identical to your download) under Wine | the exact failing 4.5 sequence | **passed** (section 1) |
| Windows PowerShell | **not available here** (no PowerShell could be installed in this environment). The edited `.ps1` scripts were checked by a static bracket/string balance checker (`tools/ps_balance.py`), not executed | **pending on your PC** |
| Your PC (i7 13th gen, 24 logical processors, RTX 4060 Ti, 16 GB) | nothing in 4.6 | **pending** |
| Any physical NVIDIA GPU | nothing in 4.6 | **pending** |

No GPU timing, VRAM figure or CUDA result in this document was measured by us.

## Summary

| Priority | Result |
|---|---|
| 1 Windows checkpoint continuation (blocker) | **Explained as far as the evidence allows, harness defect repaired, native diagnostics added.** The 4.5 report cannot show why `icm45b.state` was missing: the script discarded every message from `mwcli.exe`, never read an exit code, and hashed `icm45a.state` while errors were set to *continue*, so even a missing *first* checkpoint was hidden. The failing sequence passes here with your exact 4.5 binaries (rebuilt byte-identical) under Wine, on Linux, and on a hosted Windows VM in 4.5's own CI; and 150+150 = 300 holds byte for byte. The native cause on your PC is **not yet known**. 4.6 records it if it happens again (section 1). |
| 2 Harness reliability | Every native call recorded (command, folder, exit code, stdout, stderr, ms); files checked before hashing; sections isolated (one failure no longer stops the rest); a run passes only if all 8 required sections completed; totals, timestamps, artifacts' SHA-256, evidence folder kept on failure. |
| 3 Process-wide memory | **New reservation ledger** (`native/em_ledger.h`): open study tables, checkpoint restore, synchronous evaluations and background jobs reserve from one budget before allocating. Refusals leave state byte-identical, leak nothing and are reported (`GET /api/mw/memory`). It is a ceiling on *governed* allocations, **not** a hard RSS ceiling (exclusions listed in section 3). |
| 4 Coverage budgets | Preserved; extended to 16 and 24 workers (peak ≤ budget at 1/2/8/32 MiB, exact counts = audit, EVs identical). |
| 5 Automatic scheduling | **No scheduler change; the 4.5 "21% slower" verdict was a measurement artifact.** Automatic does not load the CUDA driver for a cold single-table request (verified). The validator now interleaves modes over 9 rounds with a bootstrap interval. |
| 6 CUDA for longer workloads | **Not done.** Nothing can be measured on a GPU here; no acceleration is claimed. |
| 7 Convergence | Independent 10-seed study (seeds 101–110) of opponent exploration 0.05 / 0.075 / 0.15 against the default 0.1 on six games with exact best responses: **0 better, 0 worse in 216 Holm-adjusted comparisons.** The 4.5 final-table hint did not replicate. Default unchanged; **no improvement in strategy quality is claimed.** |
| 8 Multiway validation | New invariant tests on five-player flop, four-player turn, three-player river (three sizes), multiway short-stack bubble ICM, heads-up river: gains ≥ 0, NashConv = sum, value conservation, thread-count bit-identity. |
| 9 Response gains | Exact gains bit-identical for 1, 2, 4, 8, 16, 24 threads on five games; classification (exact / restricted / sampled) unchanged and labelled in every answer. |
| 10–11 Rules, determinism | Unchanged and re-verified: 0.5/1 blinds, 0.1 bb individual antes, 2.3 bb eight-player pot, optional big-blind ante; training writes the 4.4/4.5 golden state bytes. |
| 12 Regression | **449 passed, 0 failed, 0 skipped, 0 timed out** (434 inherited + 15 new) on the final build; ASan+UBSan, TSan and cppcheck clean after fixing two vendored-QuickJS UB sites found by the new tests. |
| 13 Physical validation | Scripts updated; **pending on your PC**. |
| 14 4.5 vs 4.6 | Identical strategies, EVs, gains and resumed states in all 12 scenarios; times within noise (engine object byte-identical). No speed-up claimed. |
| 15 Future formats | Review only (`validation/4.6/ARCHITECTURE-REVIEW.md`); no solver change. |

## 1. Windows checkpoint continuation (Priority 1)

### What the 4.5 report does and does not show

The failing block of `source/tools/test_windows.ps1` (4.5) was:

```
$ErrorActionPreference = 'Continue'
$null = (& $cli $spec45 150 4 $a45 512 2>&1)                 # output discarded, exit code ignored
$null = (& $cli --ev $spec45 $a45 $q 2>&1)                   # output discarded, exit code ignored
$hashA = (Get-FileHash -Algorithm SHA256 -LiteralPath $a45).Hash   # missing file = silent, non-terminating error
$null = (& $cli $spec45 150 4 $b45 512 $a45 2>&1)            # output discarded, exit code ignored
$ErrorActionPreference = 'Stop'
$hashB = (Get-FileHash ... -LiteralPath $b45)                # <- the reported error
```

So the report says only that the **last** file was missing. Either the first segment or the
resumed segment failed (or the save failed), and the native error text that would say which and
why was thrown away. `hashA` is not in the report either. This is a confirmed harness defect.

### Investigation done here

* The 4.5 Windows executables were rebuilt from the 4.5 source with this machine's MinGW-w64
  toolchain and are **byte-identical** to the ones in your ZIP (`EightMax.exe`, `mwcli.exe`,
  `gpustress.exe`). Every Wine run below uses the same binaries you ran.
* The exact sequence (150 updates → deadline-limited evaluation → +150 resumed) with those
  binaries under Wine: all three steps exit 0; the resumed state is `aa809741…`, identical to
  300 uninterrupted updates and to the golden hash your PC produced for the 300-update run.
* The same on Linux, and under AddressSanitizer + UBSan (no report).
* 4.5's own CI ran this section on a hosted Windows VM (UCRT build) and passed.
* Candidate causes eliminated by reading the code: environment variables inherited from the
  self-test (`EIGHTMAX_THREADS`, `USERPROFILE`, `EIGHTMAX_GPU`) are not read by training or
  restore; the desktop host running in the same folder writes only under `Documents\EightMax`;
  restore reads the input with shared read access.
* Remaining candidates **that only your PC can decide**: a native failure specific to that
  machine (crash, memory), a failed save (for example an on-access scanner holding the just-closed
  temporary file so that `MoveFileExW` fails), or a failure of the first segment.

### What 4.6 changes

* `mwcli` training now distinguishes and explains every failure: exit **3** with the path and OS
  reason when an input checkpoint does not exist or cannot be read; exit **1** with the engine's
  reason when it is refused (truncated, wrong study, too large); exit **4** when the output
  cannot be written, naming the failed stage (`create-temp`, `open-temp`, `write`, `flush`,
  `commit`, `close`, `replace`) and the Win32 error code and text. A failed save never touches
  the previous file (`native/state_file.hpp`).
* On Windows the final atomic replace is retried for up to ~3 s on `ERROR_ACCESS_DENIED`,
  `ERROR_SHARING_VIOLATION` and `ERROR_LOCK_VIOLATION` (a scanner or indexer briefly opening the
  file). Still atomic: the destination is either the old or the new checkpoint. The number of
  retries is reported (`saveReplaceRetries`). This is a robustness measure, **not a confirmed fix**
  of your failure.
* `mwcli --state-info <state>`: header counters (`iterations`, `trainingDeals`, `stateVisits`),
  both RNG states, row checksum, study id, file and body SHA-256.
* `mwcli --continuation-suite <spec> <dir> [quick|standard|full]`: every segment is a separate
  process (a cold start of the engine, like restarting the application). Each process is recorded
  (command, working directory, input/output existence, size, SHA-256 and header before and after,
  exit code, stdout, stderr, ms) and written to `<dir>/continuation-suite.json` before the verdict.
  25 checks at `standard`:
  - 150+150 vs 300 with the 4.5 deadline-limited evaluation between segments (the failing step);
  - 500+500 vs 1,000; 1,000+1,000 vs 2,000;
  - four sequential generations with an evaluation between generations 2 and 3, vs uninterrupted (also generation 2);
  - restore + save with 0 updates reproduces the file byte for byte, twice; continuing from it = uninterrupted;
  - resumed segment with 1 and with 8 worker threads = uninterrupted;
  - interrupted saves (injected failure before the replace, during the write, and a hard process exit
    after the temporary file is complete): nonzero exit, previous checkpoint intact, no temporary file
    left (one orphan allowed after the hard exit), continuing from the preserved file = uninterrupted;
  - training cancelled after 300 ms: exactly the committed updates are kept (= an uninterrupted run of that length);
  - missing and truncated input checkpoints: refused with a reason, no output.
  "Equivalent" means byte-identical EMMW4 files: counters, both RNG states, row checksum, and every
  betting state, regret and average-strategy value. On a difference the suite reports each header
  field that differs and the first differing byte.
* Results: **25/25 on Linux; 25/25 with the 4.6 `mwcli.exe` under Wine** (work folder with a space in
  its path); 24/24 at `quick` under ASan+UBSan. Linux and Windows builds write identical bytes
  (e.g. 2,000 updates: `f71d95fd…` on both).
* `Run self-tests.bat` now runs the old 4.5 sequence with full recording, then the whole suite.

## 2. Windows test harness (Priority 2)

`source/tools/test_windows.ps1`, `validation/4.6/windows-release.ps1`, `Run self-tests.bat`:

* `Invoke-Native` runs native programs through `System.Diagnostics.Process` with both streams read
  asynchronously (no deadlock), a time limit (a hung process is killed and counted as timed out),
  and records command, folder, exit code, stdout, stderr and duration. `Cli-Json` throws with the
  native error text on a nonzero exit. The ten JSON-parsing CLI calls of the 4.0–4.3 sections use it.
* `File-Facts` checks existence before hashing; no file is hashed blind.
* Eight sections (core, v40 … v46) each in their own `try`; an error is recorded with its script
  line and the run continues. Error preference and test environment variables are reset after a
  failed section.
* Report: tool, version, build, start/completion time, totals (total, passed, failed, skipped,
  timed out, sections completed / required, native calls, nonzero exits), every check with its
  section and time since the previous check, every native call, artifact SHA-256, the host's peak
  working set, hardware-dependent status (GPU not tested by this script). `passed` requires every
  section to complete, no failed check, no timeout.
* On failure the work folder (files ≤ 64 MiB; larger ones listed) is copied to
  `Windows-self-test-evidence-<time>` beside the report.
* The wrapper moves an older report aside first (no stale result), records the child's exit code,
  and writes a report with the console tail if the self-test ends without one.
* **Not executed here** (no PowerShell). `tools/ps_balance.py` checked bracket and string balance of
  every `.ps1` (validated on the 4.5 scripts and on injected errors). It is not a parser: a mistake
  it cannot see would show up as a failed section in your report, not as a silent pass.

## 3. Process-wide memory (Priority 3)

`native/em_ledger.h`, hooked into `server.c`, `checkpoint_store.h`, `ev_jobs.h`.

| Reservation | Size reserved | When |
|---|---|---|
| tables | the open study's table budget (`budgetBytes`, which bounds tables, betting states, row index and training scratch inside the engine) | `mw/init` (capped to what is free), restore; released on close or replacement |
| restore | the restore budget (the new study coexists with the open one until it replaces it) | for the whole restore; moved to *tables* on success, released on failure or cancellation |
| eval | `memoryMiB + coverageMiB` (engine defaults when absent) | each synchronous `mw/ev` / `mw/response-gain` |
| jobs | `memoryMiB + coverageMiB` | while a background job runs; a job that does not fit waits at the head of the queue (re-checked every 250 ms); a job larger than the whole budget is refused (413) |

Budget: `EIGHTMAX_PROCESS_MIB` (default 6,144 MiB, never above the application limit
min(RAM/2, 8,192)) minus 256 MiB for ungoverned items; `EIGHTMAX_LEDGER_MIB` overrides it (tests).
Arithmetic is clamped and done under one lock; a refusal allocates nothing.

**Not governed (measured, not reserved):** allocator overhead and fragmentation, thread stacks,
the embedded interface and HTTP buffers, the QuickJS checkpoint verifier, the CUDA driver and its
pinned host buffers (device memory is bounded separately by `gpuMiB`), the legacy river solver
(checked against resident memory as before), and the browser. Therefore **no hard process-wide
RAM ceiling is claimed**. `GET /api/mw/memory` reports the reservations and the operating system's
current and peak resident memory side by side.

Tests (`tests/v46.test.js`, all passing, also under ASan+UBSan and ThreadSanitizer):
oversized evaluations refused with 503 and a reason, the study byte-identical afterwards, no
reservation leaked; refused evaluations in the middle of training leave the final state
byte-identical to uninterrupted training; two 664 MiB jobs with 836 MiB free run one after the
other (observed waiting); a 4,064 MiB job refused (413); eight simultaneous 576 MiB evaluations: at
most two run, reservations never above the budget; a restore with no room fails without touching
the open study and succeeds once the study is closed. Training under table pressure, checkpoint
save, interrupted saves and cancellation are covered by section 1 and the inherited tests.

## 4. Coverage memory budgets (Priority 4)

Preserved unchanged. New: 1, 2, 8 and 32 MiB with 16 and 24 workers on the eight-player exact
EV: peak ≤ budget, `withinBudget`, exact counts equal to the independent audit, identical EV bits.
The inherited `coverage44/45.cpp` (1–16 workers, growth, cancellation, exhaustion, failed
allocation, collisions) pass under TSan and ASan+UBSan.

## 5. Automatic CPU/GPU scheduling (Priority 5)

Your 4.5 cold measurements (3 runs per mode, run in blocks: all CPU runs, then GPU, hybrid, Automatic):

| Workload | CPU-only runs (ms) | Automatic runs (ms) |
|---|---|---|
| exact root EV | 12.4 / 12.6 / 32.6 | 13.7 / 13.8 / 29.7 |
| eight-seat exact gains | 23.4 / 27.7 / 28.7 | 18.0 / 33.5 / 37.1 |

Automatic's fastest gains run beat every CPU run; three non-interleaved samples on a hybrid
P/E-core CPU cannot separate the modes. In both workloads Automatic chose the CPU (376,992 CPU
boards, 0 GPU boards). In a cold process the Automatic rule keeps the first tables on the CPU and
opens CUDA only after 0.1 s of CPU table time, in the background. Verified here: a cold Automatic
request makes **no attempt to load the CUDA driver** (traced; reported `cuda.attempted=false`,
`opens=0`, `backgroundOpens=0`), and its results are bit-identical to CPU-only
(`tests/v46.test.js`). Interleaved timing here (15 rounds, no GPU): exact EV 29.9 vs 30.0 ms,
gains 48.3 vs 49.2 ms (Automatic vs CPU-only). **No scheduler change was made** because no overhead
exists to remove on this path, and no GPU measurement could justify a change elsewhere.
`Validate CUDA hardware.bat` section 11 now runs the modes interleaved (order rotated each round),
9 rounds, records the scheduling counters of every run, and only calls Automatic slower when the
whole bootstrap 95% interval of Automatic / best fixed mode is above 1.15.

The 100 ms GPU-preferred times in your report are cold CUDA start-up (driver, primary context,
module: 63–73 ms measured in 4.3) paid inside a one-request process; that is expected for an
explicit GPU request in a cold process and is why Automatic does not do it.

## 6. CUDA for longer workloads (Priority 6)

Not done. No GPU was available, and no end-to-end GPU speed-up is claimed. Training remains
CPU-driven, as your device-results show: CPU scoring was chosen in every mode for the small
training workload, with identical strategy hashes.

## 7. Convergence (Priority 7)

`tools/convergence46.js` (derived from the 4.4/4.5 study): six games (heads-up river and heads-up
turn+river with **exact exploitability** = NashConv / 2; three-player river with side pots; four-player
ICM bubble with weighted ranges; six-player flop with 3–50 bb stacks; eight-player final-table ICM),
checkpoints 4k–1M deals (250k for the four multiway games), exact best response of every seat,
**seeds 101–110** (independent of 4.4/4.5), identical abstraction, evaluator and 512 MiB table budget
for every variant; paired comparisons at equal sampled deals and at equal training time, both on
log NashConv; Holm over all 216 comparisons.

Candidate: `opponentExploration` 0.05 / 0.075 / 0.15 (default 0.1), chosen because the 4.5 study
showed 0.05 as the only variant with any supported improvement (4 equal-time checkpoints on the
final table).

Result: **0 supported better, 0 supported worse for every variant** (72 comparisons each). Geometric-
mean NashConv ratio to the default at the largest checkpoint: 0.05 → hu-river 1.03, hu-turn 1.10,
river3 1.13, bubble4 0.40, flop6 0.64, final8 0.35; 0.15 → final8 4.62. The pattern (less exploration
looks better in fixed-hand ICM push/fold, worse heads-up) is not significant on independent seeds,
and the 4.5 final-table result did not replicate. A re-analysis of the 4.5 data on the log scale
(`validation/4.6/convergence/reanalysis45-log.json`) gives the same tally as 4.5 (0.05: 4 better / 0
worse of 72, equal time only). **The validated default is kept; no improvement in strategy quality is
claimed.** Multiplayer values are sums of exact unilateral gains inside the abstraction, not
exploitability, and say nothing about unrestricted eight-player No-Limit Hold'em. Equal-sample
results are deterministic. Low-priority (nice 19) sanitizer builds shared the machine during part of
the run, which adds noise to equal-time results only.

## 8–9. Multiway postflop and response gains

`tests/v46.test.js`, five games, each trained for 2,000 and 20,000 deals: every exact unilateral
best-response gain ≥ 0; NashConv = the sum of seat gains; the sum of seat policy values is the same for
both strategies (chips, or the ICM prize pool, conserved through side pots, all-ins and blockers); exact
gains bit-identical for 1, 2, 4, 8, 16 and 24 threads; exploitability reported only for two-player chip
EV. The inherited rules walk (`v44_postflop`), the 3–6 player side-pot property test (`v45`) and the
stability study are kept. Every response-gain answer states its class: full best response (exact),
restricted best response (a lower bound), or sampled one-shot deviation.

## 10–11. Tournament rules and deterministic continuation

No rule, utility or training change. `tests/mtt.test.js` (blinds, individual antes, 2.3 bb pot,
big-blind ante option) passes. The default trainer writes the golden state `aa809741…` (300 updates
of the eight-player linked ICM study) on Linux and on Windows/Wine.

## 12. Regression suite (Priority 12)

Final build `169a67d1905adb32`, Linux, clean build, `node tools/run_tests.js` (every `tests/*.test.js` in its own process):

| | passed | failed | skipped | timed out | hardware-dependent run / skipped |
|---|---|---|---|---|---|
| 4.5 source, rebuilt here (baseline) | 434 | 0 | 0 | 0 | 44 / 0 |
| **4.6** | **449** | **0** | **0** | **0** | 45 / 0 |

4.6 = 434 inherited + 15 in `tests/v46.test.js` (333 s). Reports: `validation/4.6/regression-tests.json`,
`validation/4.6/regression-tests-4.5-baseline.json`. "Hardware-dependent" means tests that need a compiler, the native host or the
Linux CUDA driver test double (simulated CUDA, not a GPU).

Two inherited tests failed during development and were investigated:
* `4.4 Windows self-test script compares bit patterns`: a static check of `test_windows.ps1` (the failure must be recorded within
  200 characters of `Assert-Check`'s start; the report must contain `v44=$v44`). The 4.6 rewrite moved those lines. The script
  was changed to satisfy the unchanged test.
* `4.4 partial sampled results`: failed in 7 of 12 runs **with the 4.5 binaries as well as the 4.6 ones** on this idle 4-CPU
  machine. The 400 ms partial run completed about 65,400 samples, four times the 16,000 of the "longer" comparison run, so its
  standard error was correctly about half; the test assumed the partial run had fewer samples. The bound now scales with
  sqrt(sample ratio). For a partial run with fewer samples it is at least as strict as before. 0 of 12 failures afterwards.

Other release checks on the final build (all passed): `release.sh` post-build steps (restore sizes, 3.7 continuation utility,
explorer host, checkpoint stress, package/MTT/checkpoint UI smoke tests, native host, native multiway); Windows executables
reproducible byte for byte across two builds; `tools/wine45.js` 22/22 on the 4.6 `mwcli.exe`; 4.6 continuation suite under
Wine 25/25 (`validation/4.6/wine/`); the 4.6 `EightMax.exe` host under Wine (version, build, `/api/mw/memory`, a ledger refusal).

Sanitizers and static analysis (`validation/4.6/sanitizers/`):
* `tools/sanitize46.sh`: UBSan+ASan continuation suite (24/24 at quick), `tests/v46.test.js` non-timing tests 8/8 on the
  UBSan+ASan host and CLI, ThreadSanitizer host 4/4 ledger tests with the host's stderr captured (no report), TSan training
  cancellation. **It found two undefined-behaviour sites in the vendored QuickJS** (checkpoint verifier), reached only when a
  checkpoint is restored through the host: an out-of-range double-to-int conversion in `JS_NewFloat64` (fixed with a range check;
  same results) and `memcpy` from NULL with length 0 (guarded). A third QuickJS-internal site (a signed shift) showed that the
  vendored library has more such code; QuickJS sources are therefore compiled without UBSan checks in sanitizer builds
  (`tools/build_sanitized_host.sh`, documented), keeping ASan/TSan. EightMax's own code keeps every check.
* `tools/sanitize45.sh` (inherited: v44/v45 tests on sanitized builds, TSan coverage and stop paths, coverage44/45, icm45) on 4.6:
  all passed.
* cppcheck 2.13 on the host and `mwcli`: one finding (a NULL request that the host never passes), now guarded; none in 4.6 code.
* The sanitizer runs used the build before two final changes (the cppcheck NULL guard and the two test-shape edits above);
  neither touches the code paths the sanitizers exercised.

## 13. Physical Windows and RTX 4060 Ti validation (Priority 13)

Pending on your PC: run `Run self-tests.bat` (now including the continuation suite) and `Validate
CUDA hardware.bat`, and keep `Windows-self-test.json`, `hardware-validation.json` and
`device-results.json` (and any `Windows-self-test-evidence-*` folder). If the continuation fails
again, the report will contain the native error text, the exit code (3, 4 or 1), the stage, and
the header and SHA-256 of every file involved.

## 14. Version 4.5 versus 4.6 (Priority 14)

`tools/bench46.js`: the 4.5 `mwcli` (rebuilt from the 4.5 source; its Windows build is byte-identical to your download) and the
4.6 `mwcli`, Linux, 4 logical CPUs, no GPU, 7 interleaved rounds (version order alternating), 4 threads, seed 11 for training.
Results: strategy SHA-256 (training), EV/gain IEEE 754 bit patterns (evaluation) and resumed-state SHA-256 (continuation)
are **identical between versions in every scenario and every round** (`validation/4.6/bench46.json` also records requested and observed device,
CPU/GPU boards, peak RSS, peak evaluation memory and coverage peak per run).

| Scenario | 4.5 median [min–max] | 4.6 median [min–max] | 4.6/4.5 | identical results |
|---|---|---|---|---|
| training: heads-up river (chip EV) | 110.3 [108.5–119.2] | 110.7 [109.3–135.0] | 1.004 | yes |
| training: three-player river (side pots) | 180.7 [172.0–205.4] | 175.4 [172.5–217.7] | 0.971 | yes |
| training: six-player flop (unequal stacks, all-ins) | 283.9 [270.2–336.3] | 280.1 [270.6–284.1] | 0.987 | yes |
| training: multiway short-stack all-ins, bubble ICM | 76.8 [75.4–78.0] | 80.2 [75.8–100.8] | 1.044 | yes |
| training: eight-player preflop final table (ICM) | 335.4 [326.1–395.6] | 338.8 [320.2–367.1] | 1.010 | yes |
| training: eight-player linked training (random ranges, ICM) | 155.4 [146.0–167.8] | 151.1 [144.1–167.0] | 0.973 | yes |
| exact action EV, eight-player ICM root (CPU) | 26.2 [24.9–29.6] | 28.0 [25.2–30.5] | 1.068 | yes |
| exact action EV, eight-player ICM root (Automatic, no GPU present) | 27.8 [24.8–29.8] | 31.8 [25.8–37.5] | 1.144 | yes |
| sampled action EV, 20,000 samples (seeded) | 1532.1 [1491.0–1561.2] | 1559.2 [1509.5–1584.2] | 1.018 | yes |
| eight-seat exact response gains (CPU) | 39.4 [37.1–42.5] | 40.4 [38.5–45.2] | 1.025 | yes |
| large information-set coverage (exact EV, coverageMiB 1, audit) | 25.9 [23.1–32.7] | 26.4 [24.5–28.6] | 1.019 | yes |
| checkpoint continuation 150 + 150 vs 300 (eight-player linked ICM) | 216.0 [196.0–256.0] | 199.0 [191.0–219.0] | 0.921 | yes |

Times are within run-to-run noise except exact action EV, which a dedicated 30-round re-measure (random order) puts at
4.5 25.36 ms vs 4.6 26.63 ms (CPU) and 4.5 25.67 vs 4.6 26.68 ms (Automatic)
(`bench46-exact-ev-remeasure.json`): about 1 ms (4%) higher in the 4.6 CLI. The engine object (`mw.o`) compiled from the
4.5 and 4.6 sources is **byte-identical**, so this is not an engine change: it is binary layout of the larger CLI or residual
noise. **No 4.6 speed-up is claimed, and no engine regression exists.** Automatic equals CPU-only in both versions
(the 7-round 1.14 ratio was noise, as the 30-round re-measure shows).

Not measurable here: CUDA cold start, warm GPU evaluation, GPU board counts, VRAM, Automatic on a GPU (no GPU). These are in
`Validate CUDA hardware.bat` (section 11 now interleaved). Memory-pressure recovery and checkpoint reproducibility are covered
by sections 1 and 3 (byte-identical outcomes rather than timings).

## 15. Future formats

See `validation/4.6/ARCHITECTURE-REVIEW.md`. Rules, blinds, antes, player counts, stacks,
abstractions, algorithms, evaluation and the checkpoint format are already data-driven. The terminal
utility (chip EV vs ICM) is selected inline in 13 places; a `Utility` interface is recommended
before adding cash-game rake or knockout bounties. Not changed in 4.6, to keep training bytes
identical.

## Remaining limitations

* The native cause of the 4.5 continuation failure on your PC is not known; 4.6 will record it.
* The edited PowerShell scripts have not been executed by us (no PowerShell here).
* No GPU measurement of any kind; no CUDA change; no GPU acceleration of training claimed.
* The memory ledger governs the large allocations listed in section 3, not all resident memory.
* No training method with better strategy quality was found.
* Third-party QuickJS (checkpoint verifier) is compiled without UBSan checks in sanitizer builds
  (ASan/TSan still apply). Two QuickJS UB sites found by UBSan were fixed (section 12).
