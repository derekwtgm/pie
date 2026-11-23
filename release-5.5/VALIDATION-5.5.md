# Validation — EightMax 5.5

Final build `abe74607a4a0120b`. Everything below was run in a Linux container (Ubuntu 24.04, 4 logical processors, 15.7 GiB,
no GPU). **No test ran on physical Windows hardware and none on an NVIDIA GPU.** The Windows executables were
cross-compiled and exercised under Wine 9.0 only.

## Summary

| Area | Result |
|---|---|
| 5.4 archive audit | 3,726 files; 3,725/3,725 manifest entries verified; source rebuilt to `980f82b97a922d4d`; rebuilt interface byte-identical to the shipped one. |
| Full regression, final build | 568 tests: 567 passed, 0 failed, 1 skipped (`validation/5.5/tests/full-regression.tap`). |
| New 5.5 tests | 16 in `source/tests/v55.test.js`, all passing (included in the total). |
| AddressSanitizer + UndefinedBehaviorSanitizer | 38 tests (5.3, 5.4, 5.5 files): 38 passed, 0 failed; 0 sanitizer reports. |
| ThreadSanitizer | 0 warnings; the checkpointed, cancelled and resumed studies ran to completion. |
| Leak check | LeakSanitizer ran on one complete command-line study: exit 0, no leak reported. The desktop host was not leak-checked. |
| Statistical validation | All pass rules met; reproduced exactly by a probe built from the final source. |
| Final-binary reproduction | 48/48 convergence checkpoints reproduced by the final `mwcli`; default trainer state identical to 5.4 on 6/6 games. |
| Browser test of the recovery panel | 16 of 16 checks passed in Chromium 157.0.8103.78 against the Linux host (`validation/5.5/ui/`). |
| Long-running stability | 11 of 11 checks passed over 5.8 minutes in one host process (`validation/5.5/stability/`). |
| Windows executables under Wine | Smoke tests from the extracted final ZIP passed: build ids, known-game study, 4.9 self-test (15 checks), interrupted-and-resumed study equal to uninterrupted, desktop host answering with the recovery panel. |
| Native Windows | **Not tested.** |
| NVIDIA GPU (RTX 4060 Ti or any) | **Not tested.** No CUDA code was changed. |

## Regression suite

Command: see `BUILD-5.5.md`. Three complete runs were made; all are kept.

| Run | Build | Result | File |
|---|---|---|---|
| 1 | `6c39c588c735b9fe` | 568 tests: 564 passed, 3 failed, 1 skipped | `tests/full-regression-run1.tap` |
| 2 | `f0b5bb47b74054f1` | 568 tests: 567 passed, 0 failed, 1 skipped | `tests/full-regression-run2-build-f0b5bb47.tap` |
| 3 (final) | `abe74607a4a0120b` | 568 tests: 567 passed, 0 failed, 1 skipped | `tests/full-regression.tap` |

5.4 recorded 552 tests. 5.5 adds 16.

The three failures of run 1:

| Test | Cause | Resolution |
|---|---|---|
| 4.7 dashboard live monitor (`dealsPerSecond > 0`) | A timing measurement taken while two other test files loaded the machine. | Unchanged test passed in isolation and in runs 2 and 3. Same class of load-sensitive failure 5.4 recorded for a different test. |
| 5.2 native host study equals `mwcli --study` | The desktop now checkpoints every study, so its document has a `checkpoint` block the command-line run lacks. | The test's comparison now ignores session fields. Measurements are still compared exactly. |
| 5.3 deterministic interruption at seed and evaluation boundaries | The test stops a study at the n-th progress event and assumes seeds run one at a time; 5.5 runs them side by side. | The test now requests `parallelSeeds: 1`. Its assertions are unchanged. |

Skipped: `4.9 a checkpoint save into a read-only folder fails with exit 4` — the container runs as root, where file
permissions are not enforced. The test skips itself whenever it runs as root. 5.4's validation host was not root and ran it; it was not run for 5.5.

### Existing tests whose expectations were edited

Five tests asserted behaviour that 5.5 changes deliberately. Each edit keeps the original check where it still applies.

| Test | Edit |
|---|---|
| 5.3 reproduced zero-width defect | The synthetic input has no payoff bound, so the verdict is now `uncalibrated`. The test asserts that, and asserts the 5.3 result (`unresolved`) in `verdictFromModelBasedIntervalsAlone`. The 5.3 interval is read from `normalApproxConditionalCi95`. |
| 5.3 selection: a narrow top-two gap cannot rank over an uncertain third action | Same: `uncalibrated`, with `unresolved` asserted for the model-based rule. |
| 5.3 JSON, CSV and headline agree; old results retain measurements | A reviewed 5.2 document now carries `study-5.5-legacy-review-v1`; the test also asserts the 5.3 method is recorded. |
| 5.3 deterministic interruption | `parallelSeeds: 1` (above). |
| 5.2 native host study | Session fields ignored in the comparison (above). |

## New tests (`source/tests/v55.test.js`)

| # | Test | Category |
|---|---|---|
| 1 | Bounded-payoff interval: formula, union over replications, Bonferroni family, range doubling for differences | Statistics |
| 2 | No payoff bound: no interval published, no ranking, near tie or small edge | Statistics |
| 3 | Exactness is declared, never inferred from a zero SE; a bound violation withdraws calibration | Statistics |
| 4 | A ranking needs both intervals; tolerance needs calibration | Statistics |
| 5 | Evaluator payoff bounds: every sample and the exact values inside; chip and ICM; side pots | Solver mathematics |
| 6 | Study document: identifiers, bounds, intervals, command-line text | Application |
| 7 | Review of 5.4 and 5.2 documents | Compatibility |
| 8 | Default trainer unchanged; candidate opt-in, deterministic, exact continuation | Reproducibility |
| 9 | Seeds side by side, cache size and checkpointing never change a result | Reproducibility, performance |
| 10 | Time limit, cancellation and repeated hard kills: resumed equals uninterrupted | Recovery |
| 11 | Damaged checkpoints detected; fallback; nothing overwritten by default | Recovery |
| 12 | Process memory budget: safe stop, valid checkpoint, resume; bad options refused | Memory |
| 13 | Longer presets checkpoint by default | Application |
| 14 | Accuracy and recovery helpers from the stored document; no time estimate | Interface |
| 15 | Desktop: checkpoint, list, stop, resume, host killed, resume, discard | Application reliability |
| 16 | Candidate has the default's expected increments and lower variance | Solver mathematics |

## Required categories

| Category | Evidence |
|---|---|
| Known quantile calculations | 21 Student-t quantiles against SciPy; 400 empirical-Bernstein half-widths against an independent formula; 105 exact binomial checks of the inequality. 0 failures. |
| Confidence-interval calibration, rare tails, heavy tails, correlation, shared streams, small replication counts, multiplicity, false rankings | `STATISTICAL-VALIDATION-5.5.md`: 13 reproduced scenarios, 20 raw-sample scenarios, 8 training-variation scenarios, 14,400 real evaluations against the exact evaluator. |
| Optional stopping | Not supported; stated, not tested. |
| Exact reference games, regret updates, average strategy, best response, NashConv, side pots, chip EV, ICM, weighted ranges, legal actions | Existing suite (independent Python references, 4.x–5.4 tests) rerun; new tests 5 and 16; `CONVERGENCE-5.5.md`. |
| Fixed-seed training | Default states byte-identical to 5.4 on six games; 48 convergence checkpoints reproduced. |
| Interrupted and resumed training | Tests 8, 10, 15; stability tool. |
| Legacy checkpoints | Existing 5.1–5.4 checkpoint tests rerun unchanged, all passing. |
| Multiple thread configurations | Test 9; benchmark agreement check (178 measurements, 0 differing between 5.4 and 5.5 at 4 threads); thread-scaling runs. |
| Damaged checkpoint detection, transactional recovery | Test 11; kill tests. |
| Equal-time and equal-deal convergence | `CONVERGENCE-5.5.md`. |
| CPU scaling, throughput, memory, workflow latency | `PERFORMANCE-5.5.md`. |
| Windows build identity | `verify_build.js`; build ids of the executables under Wine. |
| Desktop-to-CLI consistency | 5.2 host test, test 15, browser test. |
| UI responsiveness | Stability tool: concurrent status polling while studies run. No human-perceived responsiveness measurement was made. |
| Study export compatibility | Test 7; stability tool (export, reload, re-export). |
| Cancellation | Tests 10, 15; stability tool (cancel during evaluation). |
| Memory exhaustion | Test 12 (process budget); existing table-budget tests. Physical out-of-memory was not provoked. |
| Long-duration operations | Stability tool, six minutes. Hours-long studies were not run. |

## Sanitizers

`validation/5.5/sanitize55.sh`; outputs in `validation/5.5/sanitizers/`.

- **ASan + UBSan + float-cast-overflow**, host and CLI: the 5.3, 5.4 and 5.5 test files. 38 of 38 tests passed against the instrumented build; 0 AddressSanitizer or UndefinedBehaviorSanitizer reports in the test output and the host's standard error.
- **ThreadSanitizer**, CLI: a checkpointed study with three seeds side by side, a cancelled and resumed study, and an
  exact study with four seeds. 0 ThreadSanitizer warnings; process exit codes 0, 0, 0, 0; the cancelled-and-resumed study equalled the uninterrupted one.
- **Leak check**: the ASan CLI with `detect_leaks=1` on one complete study exited 0 and reported no leak. LeakSanitizer was confirmed to work in this container with a deliberate leak. This covers one short command-line study only; the desktop host and long runs are unverified.

An earlier sanitized run against build `f0b5bb47b74054f1` is kept in `validation/5.5/sanitizers-run1-build-f0b5bb47/`:
37 of 38 passed. The failing test edited a checkpoint manifest in a way that was a no-op when the slow sanitized build
had completed no measurement yet; the test now edits a field that always changes.

## Defects found during development, with repair evidence

| Found by | Defect | Repair | Evidence kept |
|---|---|---|---|
| Statistical harness, run 1 | The harness scored action intervals as well as pairs, so the 5.4 numbers did not reproduce. Not a statistics defect. | Both measures reported; reproduction uses the 5.4 measure. | `statistics/run1-reproduction-scoring/` |
| Unbiasedness test, first version | Apparent bias of the candidate (z up to 11). Cause: within one update later seats read earlier seats' merged increments. | Test rewritten to traverse against a frozen table for every seat; control arm added. | Described in `source/tests/enum55.cpp` and `CONVERGENCE-5.5.md` |
| Kill-and-resume test | Engine states were restored with the wrong loader; the study fell back to retraining (results correct, work lost). | `mw_load_stream` for external-sampling engines. | Test 10 asserts no restore warning |
| Kill-and-resume test | Temporary file left by a killed writer. | Swept on resume. | Test 10 asserts the directory content |
| Review while implementing resume | A state trained past a budget whose evaluation had failed could be evaluated at the wrong deal count. | Such a state is discarded and the seed retrained. | `study52.hpp`, `CHECKPOINT-RECOVERY-5.5.md` |
| Resume comparison | Table megabytes and the device path differed after a restore. | Device path carried in the checkpoint; table megabytes classed as a memory reading. | `study_equivalence55.py` |
| Convergence runner | Timed runs asked for more updates than the CLI accepts. | Corrected. | `convergence/main-attempt1-harness-error/` |
| ICM completion | 44 s per evaluation. | Evaluator cache 1,024 MiB. | `convergence/icm-completion-attempt1-slow/` |
| Wine comparison | Windows and Linux differed in the 16th digit of paired standard errors (also in 5.4). | Direct value from the evaluator. | `validation/5.5/windows/wine-vs-linux.json` |
| Sanitized run | A 5.5 test's manifest edit could be a no-op. | Test edit. | `sanitizers-run1-build-f0b5bb47/` |

## Windows

- Cross-compiled with MinGW-w64 GCC 13 (5.4 used GCC 14.2).
- Under Wine 9.0, from a copy extracted from the final ZIP: `mwcli.exe` and `EightMax.exe` report build `abe74607a4a0120b`; the known A-K-Q study gives call frequency 0.5008 (closed form 0.5) and EV gap +0.0047 BB (closed form 0); the 4.9 compressed-checkpoint self-test passes 15 checks with 0 failures; a study interrupted by its time limit after 2 measurements is refused without `resume`, resumed, and equals the uninterrupted study (canonical SHA-256 `44d51fe72cf69eb8…`); `EightMax.exe` serves the application with the recovery panel and answers `/api/study/checkpoints`.
- Windows-under-Wine against Linux, same studies (`validation/5.5/windows/wine-vs-linux.json`): every per-seed measurement, every calibrated
  interval and every verdict is identical on a six-player sampled study, the exact known game and the eight-handed ICM
  fixture. On the ICM fixture one legacy model-based interval (`normalApproxConditionalCi95` of a sampled quality value)
  differs in its 13th significant digit, because the Student-t critical value of the 5.3 formula uses the C library's
  gamma and exponential functions, which differ between `msvcrt` and glibc. 5.4 has the same dependence.
- Not done under Wine: the full regression suite, the browser test, the stability tool.
- Wine is not Windows. File locking, antivirus interference, long paths, non-ASCII user names, the Windows scheduler
  and real memory pressure were not exercised. `tools/test_windows.ps1`, `tools/validate_hardware.ps1` and the GitHub
  workflow remain available for a Windows machine; none was run for 5.5.

## Skipped or unverified

- Physical Windows execution; the target i7 / 16 GB machine.
- Any GPU path on real hardware; RTX 4060 Ti performance.
- GPU-mode exact continuation of studies.
- Power-loss durability of checkpoints.
- Studies longer than a few minutes.
- Leak checking of the desktop host process.
- The WebAssembly offline page beyond the existing suite (it cannot run studies).
