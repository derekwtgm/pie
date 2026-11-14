# EightMax Windows 4.8

Build **4c1bfe857f0941b1** (EightMax.exe, mwcli.exe, gpustress.exe and the source fingerprint agree).

Release focus: fixing the Windows test infrastructure so Windows results can actually be produced
without your PC, repairing the inherited four-player checkpoint fixture, making exact multiway
response evaluation (the "is this strategy good?" measurement) 4-9x faster on five- and six-player
games without changing a single result bit, an independent check of exact six-player results, and
the planned dashboard / comparison / self-test additions.

## What has and has not run where

| Environment | What ran | Result |
|---|---|---|
| Linux build machine (4 logical CPUs, 15 GiB, GCC 13.3, no GPU) | full regression suite, new tests, benchmarks, independent best responses, static analysis | see sections 6-7 |
| **GitHub Actions `windows-latest` runner (real Windows Server, no GPU)** | MSYS2/MinGW build from source, `test_windows.ps1` (PowerShell), `--selftest47`, `--selftest48`, full regression suite | run 45 (commit 4178d4c) and run 46 (commit 6c36d9c), section 5 |
| Wine 9.0 on Linux (not Windows) | the shipped executables: `--build-id`, `EightMax.exe --version`, `--selftest47` 10/10, `--selftest48` 9/9 | `validation/4.8/wine` |
| Your PC (i7 13th gen, RTX 4060 Ti) | nothing | pending (optional; not a release prerequisite) |
| Any physical NVIDIA GPU | nothing | **not tested; no CUDA code changed** |

A Windows CI pass verifies execution on that hosted runner only, not on your computer.

## Summary

| Priority | Result |
|---|---|
| 12 Windows validation | **Found and fixed the defect that made every 4.7 Windows CI run fail** (and would have failed `Run self-tests.bat` on your PC): `End-Section([string]$errorText)` - PowerShell converts `$null` to `''` for a `[string]` parameter, so `$null -eq $errorText` was never true and every completed section was recorded as FAILED with an empty message ("126 passed, 0 failed ... 0 of 8 sections completed"). After the fix the same harness on the real Windows runner reports **126 passed, 0 failed, 8 of 8 sections**. The CI then exposed a second inherited defect: **`validate_hardware.ps1` (behind `Validate CUDA hardware.bat`) did not even parse in Windows PowerShell 5.1** (`@(for (...) {...} \| Sort-Object)`, "An empty pipe element is not allowed"); fixed. New CI step runs `--selftest47` and `--selftest48` on Windows; job time limit 90 -> 180 min so the full suite can finish. |
| 5 Four-player fixture | Root cause: `--continuation-suite` hard-coded evaluation requests `hands:[3]` / `hands:[0]` from the 4.5 eight-player study; on the four-player bubble study the seat acting at the root has 2 hands, so the engine (correctly) refused `hands[3]` with HTTP 400 -> 24/25. The test was wrong, not the engine. The suite now asks the engine (`--node`, path `[]`) which seat acts at the root, reads that seat's range size from the spec, keeps the preferred index when valid and otherwise uses the last valid index, and records the choice (`evaluationHands`). **25/25** on the four-player study; on the 4.5 eight-player study the requests are byte-for-byte the 4.6/4.7 strings (tested). The assertion was not weakened; an invalid index is still refused (tested). No solver or checkpoint-format change. |
| 4 Response-evaluation speed | Profiling (callgrind) of the exact six-player best response found redundant work: 36.8 M seven-card evaluations and 6.1 M side-pot layouts for one seat, and showdown-table caches limited to 4 tables, so tables were rebuilt continuously (528 table builds for the 16 deals of the bubble study). Changes: per-board rank cache, pot layout computed once per terminal node, chip-EV utility of the acting seat only, table-cache caps 1,024 (small) / 64 (shared) bounded by the request memory budget, contiguous key index. **Every exact, restricted and sampled result is bit-identical to the 4.7 code path** (tests on 2-8 player games, 1-4 threads, environment switches reproduce 4.7). Matched benchmark, final build (section 2). |
| 4/10 Memory | The larger caches first let evaluation memory exceed `memoryMiB` (18.7 MiB at a 16 MiB budget, found by the new test). Root cause, partly inherited: rank-pattern histograms were charged unconditionally. Now the full-seat histogram is reserved with each table and subset histograms are cached only if they fit (otherwise used once, uncached). Result: 16.0 MiB peak at 16 MiB with identical gains. The ledger still governs the large evaluation allocations, **not** all process memory. |
| 3/14 Best-response verification | New `tools/independent_br48.py` (no shared code): multi-street postflop rules, explicit turn/river chance enumeration with card removal, dead money, independent side pots, information-set-consistent best responses. Agrees with the engine's exact values on heads-up river/turn, three-player river, **four-player turn, five-player flop and six-player flop** to <= 7.1e-15, using every stored strategy row; chips conserved (sum of policy values = root pot) in every game. |
| 8 Checkpoint comparison | `--compare` adds `qualityChange`: *meaningful improvement / meaningful regression / no change (equal within rounding)* for exact gains (exact difference, 1e-9 relative rounding tolerance), *improvement / regression / statistically inconclusive* for sampled gains (independent streams, 95% interval of the NashConv difference), *not comparable (lower bounds)* for restricted gains. Later checkpoints are never assumed stronger. |
| 7 Dashboard | New charts (real run documents only): 1b NashConv vs training time, 7 algorithm comparison at equal training time (imported runs, log-log interpolation, ratio to this run), 8 training efficiency (improvement factor vs time, peak memory per point). Trainer labels on every series. Chart values tested against hand computation from a real monitor run. |
| 11 Checkpoints | EMZ1 levels 1 and 9 tested byte-exact with deterministic resume (tests). No default change: a level study (`tools/checkpoint48.js`) was written but **not run**. |
| 1/2/6 Six-player convergence | **Not established. No trainer change; the validated default is unchanged** (golden state `aa809741...` reproduced on Linux, Windows CI and Wine). Code audit: regret increments `t (pi_-i/q_-i)(v(a)-v)` and average increments `t pi_i sigma(a)/q_-i` are unbiased; no defect found. Identified (not measured) variance mechanism: the average-strategy importance weight `1/q_-i` grows up to `(k/epsilon)^m` along m opponent decisions, which is largest in six-player trees. The 10-seed study tool `tools/convergence48.js` (exploration 0/0.05/0.2/0.4, simultaneous batches, own hands + baseline, Holm over all comparisons, equal deals and equal time) was written and smoke-tested but **the full study was not run before packaging**. No accuracy improvement is claimed for 4.8. |
| 9 CPU training | Training code unchanged; no training speed-up claimed. |
| 13 CUDA | No CUDA code changed. A GPU request without a usable device falls back to the CPU with bit-identical exact gains (tested). GPU runtime/performance: **pending, unverified**. |
| 15 Tournament defaults | Unchanged and tested: 8 players, 0.5/1 blinds, 0.1 bb individual antes, 2.3 bb starting pot, UTG ... BB; optional BB ante unchanged. |
| 18 Future formats | No engine change; `validation/4.8/ARCHITECTURE-REVIEW.md`. |

## 2. Response evaluation: 4.7 vs 4.8 (matched workloads)

`tools/brbench48.js`, same checkpoint and request for both builds, rounds interleaved, exact best
response of every seat, 4 threads, 512 MiB, Linux machine above. Every round of every game printed
**identical gain bit patterns** for both builds. Ratio = 4.8 time / 4.7 time, paired 95% interval.

| Game (`tools/games48.js`) | 4.7 | 4.8 | ratio [95%] | peak RSS 4.7 / 4.8 |
|---|---|---|---|---|
| heads-up river | 0.004 s | 0.004 s | 1.06 [0.91, 1.23] n.s. | 5.2 / 5.2 MiB |
| three-player river | 0.004 s | 0.004 s | 0.91 [0.85, 0.97] | 5.1 / 5.2 MiB |
| four-player turn | 0.018 s | 0.010 s | 0.58 [0.51, 0.66] | 7.1 / 7.3 MiB |
| four-player bubble, ICM | 3.32 s | 0.32 s | 0.11 [0.08, 0.13] | 403 / 271 MiB |
| five-player flop | 0.572 s | 0.124 s | 0.22 [0.21, 0.22] | 5.6 / 7.7 MiB |
| six-player flop | 3.07 s | 0.54 s | 0.18 [0.17, 0.18] | 5.6 / 11.9 MiB |
| six-player flop, weighted 3-hand ranges, 2 bet sizes (2 rounds) | 55.4 s | 8.4 s | 0.15 [0.15, 0.16] | 5.7 / 63.2 MiB |

5 rounds except the last row. Scope: exact response evaluation of these abstracted study games;
this is a measurement-speed improvement, **not** a strategy-quality improvement. Quick (2-round)
restricted and sampled comparisons are in `validation/4.8/response-eval`; restricted six-player flop
0.56x, sampled no consistent change. A weighted eight-player final table exact evaluation did not
finish within 10 minutes on 4.7 and was not retried on 4.8.

## 3. Independent best response (`validation/4.8/independent-br`)

| Game | seats | max abs difference engine vs independent | rows used |
|---|---|---|---|
| heads-up river | 2 | 2.6e-16 | 48 / 48 |
| heads-up turn + river | 2 | 8.9e-16 | 751 / 752 |
| three-player river | 3 | 4.4e-16 | 150 / 150 |
| four-player turn + river | 4 | 1.0e-17 | 3020 / 3020 |
| five-player flop (all-in or fold) | 5 | 7.1e-15 | 159 / 159 |
| six-player flop (all-in or fold) | 6 | 2.7e-15 | 360 / 360 |

All values are exact unilateral best-response gains **inside each abstraction**; for more than two
seats they are NashConv-style measurements, not exploitability and not a Nash-equilibrium certificate.

## 4. New tools and checks

`mwcli --selftest48` + `Run 4.8 checks.bat` (also called by `Run self-tests.bat`): golden state, the
4.5 sequence (150 updates, deadline-limited evaluation, 150 more = 300), four-player continuation
suite, 4.8 vs 4.7 evaluation paths, deadline stop, comparison classes, EMZ1 levels.
`tools/games48.js` (study games), `tools/brbench48.js`, `tools/independent_br48.py`,
`tools/convergence48.js` and `tools/checkpoint48.js` (written, not run in full), `tools/sanitize48.sh`
(written, **not run**). Environment switches reproducing the 4.7 evaluation path:
`EM_EV_NO_RANK_CACHE=1 EM_BR_NO_HOIST=1 EM_EV_SMALL_TABLE_CAP=4 EM_EV_TABLE_CAP=0`.

## 5. Windows (GitHub Actions, real Windows runner, no GPU)

* Run 45 (commit 4178d4c): build OK; `test_windows.ps1` **126 passed, 0 failed, 8/8 sections**;
  full regression suite passed; concurrency stress 5 x 9/9; failed at "Parse every PowerShell
  script" -> the `validate_hardware.ps1` parse defect (fixed in 6c36d9c).
* Run 46 (commit 6c36d9c, **build 4c1bfe857f0941b1 = the shipped build**; the only later change is the test file below):
  build OK; `test_windows.ps1` 126 / 0, 8/8 sections, the three executables report the same build id;
  **`--selftest47` and `--selftest48` passed on Windows**; full regression **448 passed, 1 failed,
  34 skipped, 0 timed out**, `v48.test.js` 21/21. The one failure was the inherited 4.7 test that
  counts dashboard charts (expects 7; 4.8 adds three); the expected count was updated to the exact
  new number (10) after this run. Skips are tests that need the Linux compiler / CUDA test double.
* The run for the final commit had not completed when this package was made; check the
  repository's Actions tab for it.

## 6. Regression (Linux)

| Run | passed | failed | skipped | timed out | hw-dependent run |
|---|---|---|---|---|---|
| 4.7 source rebuilt here (baseline) | 462 | 0 | 0 | 0 | 46 |
| 4.8 full suite (build 2c01340963236a30) | 482 | 1 | 0 | 0 | 48 |
| 4.8 final build: v47 + v48 files re-run after the chart-count fix | 34 | 0 | 0 | 0 | - |

Build 2c01340963236a30 differs from the final build only in `tools/validate_hardware.ps1`
(PowerShell, not executed on Linux). 4.8 = 462 inherited + 21 new (`tests/v48.test.js`). The single
failure is the chart-count test described above; nothing was skipped or excluded. The full suite
was not re-run on the final build. Counts overlap with the other evidence groups and are not to be
added together.

## 7. Not done in 4.8 (honest list)

* Ten-seed convergence study and any trainer-default change (P1/P2/P6) - tools ready, not run.
* 4.7 vs 4.8 training-speed benchmarks, eight-player linked ICM training speed (P9/P17): not run; training code unchanged.
* EMZ1 level study (P11): not run; default level unchanged (6).
* Sanitizer pass `tools/sanitize48.sh` (P16): written, not run. cppcheck on `mwcli.cpp` and the headers it includes (selftest48, continuation suite, showdown tables): 0 findings; `action_ev.hpp` (via `mw.cpp`) was not analysed separately.
* Physical Windows PC and NVIDIA GPU validation: not done; CUDA unchanged.
* Exact evaluation of large weighted eight-player games remains intractable (use restricted/sampled).
* No method here certifies a Nash equilibrium of unrestricted eight-player No-Limit Hold'em.
