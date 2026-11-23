# Validation — EightMax 5.7

Build `e4668abe7903f8b0`. Machine-readable form: `validation/5.7/validation-summary.json`. Every statement carries one of four classes:

1. **Class 1**: implemented and independently tested (an independent implementation, an exact reference, or the unchanged 5.6 binary agrees).
2. **Class 2**: implemented and verified by the project's own tests on Linux, or by the Windows programs under Wine.
3. **Class 3**: implemented, awaiting physical hardware validation (never executed on Windows hardware or an NVIDIA GPU).
4. **Class 4**: not implemented, unsuccessful, or not executed.

Nothing was run on a Windows machine or on an NVIDIA GPU. No test is reported as passed that was not executed. Evidence is under `validation/5.7/`; where a figure is quoted, the file it comes from is named.

## 1. The 5.6 baseline, before any change

Source: branch `eightmax-5.6` of the repository named for this work, folder `release-5.6`. Details: `validation/5.7/baseline/baseline-5.6.json`.

| Check | Expected | Found |
|---|---|---|
| Archive SHA-256 | `7c46e762f6f8ce366c3b06f7efbd7980e35788e7baab286f92deab25a7bbba2b` | identical |
| Archive members | 4262 | 4262 |
| Manifest entries, each file re-hashed in a clean extraction | 4261 | 4261 entries, 0 mismatches |
| `EightMax.exe`, `mwcli.exe`, `gpustress.exe` | hashes of the identity file | identical |
| Version, build, source fingerprint (`verify_build.js`) | 5.6, `7ee054b44c409149` | Verified the executables, interface and source: 7ee054b44c409149 |
| Unmodified source rebuilt with the 5.6 toolchain | not claimed by 5.6 for a second machine | the three Windows executables and the three Linux programs are **byte-identical** to the shipped ones |
| Regression suite on the rebuilt Linux programs | 583 tests: 582 passed, 0 failed, 1 skipped | 583 tests: 580 passed, 2 failed, 1 skipped |

**Discrepancies found before editing:**

1. **Regression totals.** Reported: 583 tests: 582 passed, 0 failed, 1 skipped. Found: 583 tests: 580 passed, 2 failed, 1 skipped. Two desktop-host tests failed. One (v41, concurrent starts) passes when its file runs alone: it depends on machine load, as 5.6 reported for two other host tests. The other (v47, dashboard live monitor) fails alone too, with the unmodified 5.6 programs, on this machine.
2. **v47 dashboard live monitor (a defect of 5.6, not of the test).** The desktop host reports the elapsed training time of /api/mw/status with three decimals. A training segment shorter than half a millisecond is reported as 0, the dashboard then has no throughput for it (null), and the test requires a positive throughput. 5.6 made training fast enough for the first 100 updates of the three-player river game to take less than that on this machine.  *In 5.7:* server.c reports the elapsed time with six decimals (microseconds). The 5.7 host passes the test.
3. **Windows thread check of validate_windows56.ps1 (found by reading the script).** Section 4 trained golden spec g05-flop6 (8 deals per update) with 1 to N threads. 5.6 used several threads for an update only when state visits per deal times deals per update reached 2,000, which this spec never does after its first update, so the check compared single-threaded runs with each other.  *In 5.7:* validate_windows57.ps1 uses a 64-deal spec with hand groups and forces every update onto all threads (EIGHTMAX_THREAD_CHOICE=fixed); the engine reports the threads used.
4. **Thread-count dependence under a very small table budget (5.6 behaviour, documented in 5.7).** The workers' transient memory comes out of the table budget. With a budget of 1 to 2 MiB the update at which training stops depends on the number of worker threads (for example flop3-kings with 64 deals per update and 2 MiB: 12 updates with 1 to 4 threads, 0 with 8). States are identical for every thread count as long as the budget is not reached.  *In 5.7:* none (behaviour preserved); 5.7 reproduces 5.6 at every thread count, and the 5.7 tests compare stopped trainings at equal thread counts.

The 5.6 extraction and the rebuilt 5.6 binaries were kept unchanged and are the reference of every comparison below. (Class 1.)

## 2. Tests executed on the final build

| # | Test | Where | Result | Class |
|---|---|---|---|---|
| 1 | Regression suite, Linux, three test files at a time | `tests/full-regression.tap` | 592 tests: 591 passed, 0 failed, 1 skipped — of which the 9 tests of the 5.7 file: 9 passed | 2 |
| 2 | Every test that failed in that run, again, alone | `tests/rerun-alone.txt` | nothing failed | 2 |
| 3 | State identity against the unchanged 5.6 binary: 225 applicable configurations, 1085 training runs compared, thread counts 1, 2, 3, 4, 8, 16 | `identity/` | 1085 of 1085 saved states byte-identical; 225 of 225 configurations identical in state and counters; stopped-and-continued trainings: 208 identical, 17 not comparable (stopped by the table budget) | 1 |
| 4 | `mwcli --selftest57`, Linux program | `selftest/selftest57-linux.json` | 28 passed, 0 failed | 1 |
| 5 | `mwcli.exe --selftest57`, Windows program under Wine | `wine/selftest57-wine.json` | 28 passed, 0 failed | 2 |
| 6 | Regression file against the Windows programs under Wine: `v56.test` | `wine/v56.test.tap` | 15 tests: 15 passed, 0 failed, 0 skipped | 2 |
| 7 | Regression file against the Windows programs under Wine: `v57.test` | `wine/v57.test.tap` | 9 tests: 9 passed, 0 failed, 0 skipped | 2 |
| 8 | AddressSanitizer + UndefinedBehaviorSanitizer, 5.3 to 5.6 test files | `sanitizers/v53-v56-asan-ubsan.tap` | 53 tests: 53 passed, 0 failed, 0 skipped | 2 |
| 9 | AddressSanitizer + UndefinedBehaviorSanitizer, four tests of the 5.7 file | `sanitizers/v57-asan-ubsan.tap` | 4 tests: 4 passed, 0 failed, 0 skipped | 2 |
| 10 | Sanitizer reports in those runs | `sanitizers/sanitizer-report-counts.txt` | 0 | 2 |
| 11 | ThreadSanitizer: 16 runs (studies, cancel and resume, frozen batches forced onto 4 and 8 threads with every merge stage, hand groups, a table-budget stop, sampled and exact evaluation on 4 threads) | `sanitizers/tsan-parallel.log` | 0 warnings; exit codes 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 | 2 |
| 12 | LeakSanitizer: a complete study, and a frozen-batch training on 4 threads | `sanitizers/leak-summary.txt` | leak check exits: study 0, frozen-batch training 0; validation/5.7/sanitizers/leak-study.log:0; validation/5.7/sanitizers/leak-frozen-batch.log:0 | 2 |
| 13 | Study tab driven in Chromium against the desktop host | `ui/study-ui56.json` | 20 of 20 checks passed | 2 |
| 14 | The same with the unchanged 5.6 tool (`study_ui56.js`) | `ui-5.6-tool/` | 19 of 20; failed: "the host is 5.6 and announces study checkpoints" (the tool expects version 5.6; the host answered 5.7) | 2 |
| 15 | Stability run with the 5.6 setting (six minutes) | `stability/stability55-six-minutes.json`, `stability/README.md` | 10 of 11; failed: "E: a 322 s training study stops at its time limit with perio". Cause: the tool's long study has a budget of 20,000,000 deals per seed; with 322 s left a seed reached the engine's limit of 10 million updates per training and the study ended with an error instead of at its time limit. The unchanged 5.6 binary fails in the same way with the same command (validation/5.7/stability/README.md). | 2 |
| 16 | Stability run against the desktop host (three minutes) | `stability/stability55.json` | 11 of 11 checks passed in 166 s, among them a study paused and resumed 13 times that equals the uninterrupted study | 2 |
| 17 | Packaged ZIP extracted into an empty folder; every manifest entry; build identity; smoke tests through the shipped Windows programs under Wine | `EightMax-Windows-5.7.identity.json` (beside the ZIP) | see section 6 | 2 |

**Regression totals.** In one run: 592 tests: 591 passed, 0 failed, 1 skipped. After each failed test was run again alone: 591 passed, 0 failed, 1 skipped.

**Skipped:** "4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissions)" (running as root: permissions are not enforced, as in 5.6).

## 3. What each required category rests on

| Category | Evidence | Class |
|---|---|---|
| Mathematical accuracy | Trainer output byte-identical to 5.6 (row 3); evaluations bit-identical to 5.6 (PERFORMANCE-5.7.md sections 5 and 6, `v57.test.js`); the independent Python best-response checker and the independent exact CFR increments run inside the regression suite (4.7, 4.8, 5.5 and 5.6 tests) and pass | 1 |
| CPU parallelism | In-engine checks of the worker pool and deal queue (`--selftest57`); ThreadSanitizer; thread counts 1 to 16 in the identity matrix | 2 |
| Training determinism | Identity matrix; `v57.test.js` (every trainer option, hand groups, table limits, stop and continue with other thread counts); golden states of the 5.6 binary in the self-test | 1 |
| Sampled evaluation | With and without the path tree, and against the 5.6 binary: identical documents (`v57.test.js`, self-test, `performance/evaluation`) | 1 |
| Exact evaluation | The same; exact NashConv identical to 5.6 in every benchmark case | 1 |
| Multiway calculations | Three- to eight-player games in the identity matrix, the benchmarks and the convergence plans; side pots and unequal stacks are part of those games | 1 |
| ICM | final8, final8w, bubble4 and the icm8 fixtures in the same comparisons | 1 |
| Convergence comparisons | CONVERGENCE-5.7.md | 1 |
| Checkpoint recovery | The 5.5 and 5.6 recovery tests in the suite; stop-and-continue with different thread counts; the stability run; packaged smoke test (interrupt, refuse without resume, resume, lock) | 2 |
| Memory-budget handling | Table-budget stops at equal thread counts equal 5.6 (identity matrix, `v57.test.js`); the process-memory stop of the 5.5 tests; evaluator memory bounds the path tree (`v57.test.js`) | 2 |
| Statistical reporting | Unchanged code; the 5.3 to 5.6 statistics tests in the suite pass; study documents equal 5.6's. The formal simulations of 5.6 (`statistical_validation56.py`) were **not** rerun | 2 / 4 |
| Windows compatibility | Windows programs under Wine only (section 5) | 2 / 3 |
| GPU fallback | GPU-Preferred, Automatic and Hybrid give the CPU-only measurements on a machine without a GPU (packaged smoke test); the simulated-driver tests of the suite | 2 |
| Source and executable identity | `verify_build.js` on the extracted archive | 2 |
| File integrity | Every manifest entry re-hashed in the extracted archive | 2 |

## 4. Sanitizers

- **ASan + UBSan** (with float-cast-overflow): 53 tests: 53 passed, 0 failed, 0 skipped for the 5.3 to 5.6 files, 4 tests: 4 passed, 0 failed, 0 skipped for the four 5.7 tests; sanitizer reports: 0.
- **The 5.6 time-budget failure.** One 5.6 test ("a study with an experimental trainer is interrupted and resumed") allowed 40 resumes of 0.4 s; the instrumented program is several times slower and needed 54. The assertion that matters (the resumed study is complete and equals the uninterrupted one) was never at fault. 5.7 bounds the loop by the test's own uninterrupted run (eight times its duration in 0.4 s slices, at least 40); the requirement on the result is unchanged. The test passes under the sanitizer build.
- **ThreadSanitizer:** 0 warnings in 16 runs; exit codes: 0 (study), 0 (cancelled study), 0 (resumed study), 0 (exact study), 0 (river-cross study), 0 (frozen-batch training (default, 4 threads, measured choice)), 0 (frozen-batch training (default, every update on 4 threads)), 0 (frozen-batch training (default, every update on 8 threads)), 0 (frozen-batch training (river-cross, every update on 4 thread), 0 (frozen-batch training (DCFR, 64 deals, every update on 4 thr), 0 (frozen-batch training (Compact hand groups, every update on ), 0 (frozen-batch training (Detailed hand groups, every update on), 0 (frozen-batch training (ICM, hand groups, every update on 4 t), 0 (frozen-batch training stopped by a 2 MiB table budget (4 thr), 0 (sampled response gain (4 threads, one path tree per worker)), 0 (parallel exact best response (compact tables, path trees, 4 ).
  - EQUIVALENT
  - distinct states of the turn4 frozen-batch trainings under ThreadSanitizer (1 expected): 1
  - Compact-group state under ThreadSanitizer (4 threads) equals the release build (1 thread): yes
- **LeakSanitizer:** leak check exits: study 0, frozen-batch training 0; validation/5.7/sanitizers/leak-study.log:0; validation/5.7/sanitizers/leak-frozen-batch.log:0.

## 5. Windows and GPU

| Item | Status | Class |
|---|---|---|
| Windows executables built (MinGW-w64 GCC 13, static) | built; byte-reproducible (BUILD-5.7.md) | 2 |
| `mwcli.exe --selftest57` under Wine 9.0 | 28 passed, 0 failed | 2 |
| `v56.test` against `mwcli.exe` / `EightMax.exe` under Wine | 15 tests: 15 passed, 0 failed, 0 skipped | 2 |
| `v57.test` against `mwcli.exe` / `EightMax.exe` under Wine | 9 tests: 9 passed, 0 failed, 0 skipped | 2 |
| Whole regression suite against the Windows programs under Wine | **not run for 5.7** (5.6: 514 passed, 68 failed for reasons of the Wine harness, 1 skipped; each of those also failed with the 5.5 programs) | 4 |
| Packaged ZIP, clean extraction, smoke tests through the shipped Windows programs under Wine | see section 6 | 2 |
| Execution on Windows 11 hardware | **not performed** | 3 |
| `validate_windows57.ps1` | **never executed.** No PowerShell in the development session (its download was refused by the session's permission policy). Static checks only: balanced quoting and bracketing, every called helper defined, no PowerShell 7-only syntax (a Python scanner, not a parser) | 3 |
| `Run 5.7 Windows validation.bat` | never executed (its first step, `mwcli.exe --selftest57`, was run under Wine with the same arguments) | 3 |
| GitHub Actions workflow | **not run**: the session had read-only access to the repository. The YAML parses; no step carries `continue-on-error` | 3 |
| CUDA on the RTX 4060 Ti: correctness and speed | **not performed.** No CUDA code changed. GPU paths ran against the simulated driver (a test double) on Linux only | 3 |
| Power-loss durability, NTFS behaviour of the checkpoint lock | **not tested** | 3 |

`WINDOWS-TESTS-5.7.md` gives the steps for the target PC.

## 6. The packaged archive

`validation/5.7/release57.py` builds the ZIP, extracts that exact file into an empty folder, re-hashes every manifest entry, verifies executables, interface and source fingerprint, and runs the smoke tests through the shipped Windows programs under Wine. Its record is `EightMax-Windows-5.7.identity.json`, delivered beside the ZIP (it cannot be inside the archive it describes). The archive SHA-256 is in that file and in the delivery message.

The archive was built twice. The record of the **first** archive (identical procedure, the reports of this folder not yet final) is `validation/5.7/release-smoke-first-archive.json`; its smoke tests, run through the Windows programs under Wine from a clean extraction:

| Check on the extracted archive | Result |
|---|---|
| Manifest entries re-hashed | 4533, all matching |
| Build identity of `mwcli.exe`, `EightMax.exe`; `gpustress.exe` starts | mwcli.exe: EightMaxBuild=e4668abe7903f8b0; EightMax.exe: EightMaxBuild=e4668abe7903f8b0; gpustress.exe: usage printed, exit 2 |
| Study of the game with a known solution | call frequency 0.5008 (closed form 1/2), EV gap 0.0047 BB (closed form 0) |
| Compressed-checkpoint self-test (4.9) | 15 passed, 0 failed |
| Desktop host: version, build, Study tab, saved-study list | answered with this build |
| Study interrupted by its time limit, refused without `resume`, resumed | equals the uninterrupted study: True |
| Golden states of the 5.5 trainer | 11 of 11 identical |
| Checkpoint lock: second process refused; killed study resumed | refused: True; resumed equals uninterrupted: True |
| `mwcli.exe --selftest57` | 28 passed, 0 failed |
| Frozen-batch training, every update on 1 and on 4 threads | the state of the 5.6 binary: 1 threads: True, 4 threads: True |
| CPU-only, GPU-Preferred, Automatic, Hybrid without a GPU | all on the CPU: True; same measurements as CPU-only: True |
| Invalid spec, unreadable spec, unknown option, invalid option value | exit status 1, 2, 2, 1, 2; nothing written |

The final archive went through the same procedure; its record is the identity file. (Class 2: Wine is not Windows.)

## 7. Failed, skipped, unavailable, unresolved

- **Failed:** none in the regression run.
- **Skipped:** the read-only-folder checkpoint test (root); tests that need an NVIDIA device or Windows skip themselves by design.
- **Unavailable in the development session:** Windows, PowerShell, an NVIDIA GPU, a GitHub Actions runner, `perf` (profiles were taken with callgrind).
- **Not rerun for 5.7:** the formal statistical simulations of 5.6; the 13 expected-increment runs of `unbiasedness.sh` (5 to 30 million deals each; the estimators are unchanged and their states are byte-identical to 5.6); the whole suite under Wine.
- **Unresolved defects:** A study whose budget exceeds 10,000,000 deals per seed (one deal per update) fails with "Iteration count must fit the 10 million iteration limit" when a seed reaches the limit, instead of being refused when it starts. Present in 5.6 and 5.7; not repaired in 5.7. Workaround: keep study budgets at or below 10,000,000 deals per seed (the shipped fixtures stop at 4,000,000); with frozen batches the limit is 10 million updates, that is 640 million deals at 64 deals per update. Evidence: `validation/5.7/stability/README.md`. Known limits that are not defects are in FINAL-REPORT-5.7.md section 12.
