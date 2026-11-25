# EightMax 5.10: validation

Build `7fa0e8c16d6c6ade`. Every test that was executed, failed, skipped or could not be executed. Evidence: `validation/5.10/`
(`validation-summary.json` is assembled from the evidence files by `summarize510.py` and embedded in
`EightMax-Windows-5.10.identity.json`).

Classes used below: **1** independently mathematically validated (a proof, an exhaustive enumeration, an independent
implementation, an exact reference, or the unchanged 5.9 binary agrees); **2** tested on Linux, under Wine or by
simulation; **3** implemented, awaiting physical Windows / GPU validation; **4** unresolved or not established.

## 1. Every test in one table

| Test | Where it ran | Result | Class | Evidence |
|---|---|---|---|---|
| 5.9 baseline: archive, manifest, identity, byte-identical rebuild | Linux | verified | 1 | `baseline/baseline-5.9.json` |
| Regression suite (`source/tests/*.test.js`) against the release's Linux programs | Linux | **656 tests: 655 passed, 0 failed, 1 skipped** (62 minutes, one test at a time) | 2 | `tests/full-regression.tap` |
| `mwcli --selftest510` | Linux | 21 of 21 | 1 / 2 | `selftest/selftest510-linux.json` |
| `mwcli --selftest59`, `--selftest58`, `--selftest571`, `--selftest57` | Linux | 32, 33, 24 and 28 checks, all passed | 2 | `selftest/` |
| Estimator: exact conditional checks | Linux | 28 of 28 passed; largest difference 9.4e-17 of the scale | 1 | `estimator/conditional/` |
| Estimator: exact, independent Python implementation | Linux | 11 of 11 passed; 2.8e-17 | 1 | `estimator/total/` |
| Estimator: sampler frequencies | Linux | passed (smallest p 0.0042, level 0.00038) | 1 | `estimator/sampler/` |
| Estimator: Monte Carlo agreement and variance, final run | Linux | 13 of 13 games passed; 2,417 entries, largest \|z\| 3.71 against 4.26 | 2 | `estimator/variance/` |
| Estimator: Monte Carlo comparison, first and second run | Linux | **2 of 12 and 1 of 13 games flagged**; followed up with larger samples; criterion revised (section 2, items 5) | - | `estimator/first-run/`, `second-run/`, `diagnosis.json`, `followup-rg-hu-turn.json` |
| Estimator: the 4.7 own-hand estimator as a second implementation | Linux | 12 of 12 games passed (first form of the check: 11 of 12) | 1 | `estimator/cross47.json` |
| Default trainer: states of the unchanged 5.9 program (1, 2, 4, 8 threads, measured choice, options, table limits) | Linux | 225 configurations, 1,782 trainings, 0 differences | 1 | `identity/` |
| Default trainer: states of 5.9 in the convergence experiment | Linux | 2,000 of 2,000 | 1 | `convergence/exact/summary.json` |
| Convergence experiment (exact NashConv) | Linux | 8,800 measurements, 0 errors; interrupted twice and resumed | 1 (the measure is exact) | `convergence/exact/` |
| Released program reproduces the experiment | Linux | 160 of 160 states, 80 of 80 NashConv values | 1 | `convergence/reproduce.json` |
| Fixtures: trained-response diagnostics | Linux | 32 analyses, 0 errors; two supplementary, exploratory runs: 48 and 48 analyses, 0 errors (a first attempt at the second one failed in all 48 analyses: the experiment's candidate program does not know `responseEstimator`; repeated with the released program) | 2 | `convergence/fixtures/`, `fixtures-times/`, `fixtures-response/` |
| Desktop host: refused studies, interface in a browser (Chromium), three-minute stability run | Linux | 9 of 9, 20 of 20 and 12 of 12 checks passed | 2 | `host-refusal59-with-the-5.10-host.json`, `ui/`, `stability/` |
| AddressSanitizer + UndefinedBehaviorSanitizer | Linux | self-test 5.10: 21 of 21; 10 of 10 tests of the 5.10 file; 0 reports | 2 | `sanitizers/` |
| ThreadSanitizer | Linux | 6 frozen-batch trainings on four threads (rbes with exact cards, Compact and Detailed groups, ICM; the default trainer with the new identifier cache) and a response trained by rbes with three seats side by side: 0 warnings; states and response bits equal the release program | 2 | `sanitizers/tsan-summary.txt` |
| LeakSanitizer | Linux | training, a table-limit stop, a refused configuration, a refused checkpoint, the exact check: 0 reports | 2 | `sanitizers/leak-summary.txt` |
| Windows executables under Wine | Linux (Wine) | the five self-tests (21 of 21, 32 of 32, 33 of 33, 24 of 24, 28 of 28), the `rbes` reference state for 1, 2 and 4 threads, the exact check and the 5.9 reference responses: all passed | 2 | `wine/` |
| `validate_windows510.ps1`, focused and full | Linux, PowerShell 7.4, Linux programs | focused: 50 passed, 0 failed, 1 skipped, 0 untested (skipped: integrity / SHA256SUMS.txt). Full: 215 passed, 0 failed, 2 skipped, 0 untested (skipped: integrity / SHA256SUMS.txt; GPU / CUDA validation) | 2 | `powershell/` |
| Release archive: clean extraction, manifest, smoke tests of the shipped executables | Linux (Wine) | passed (identity file) | 2 | `EightMax-Windows-5.10.identity.json` |
| Reproducible build | Linux | A second build of the final source in another directory gave the same seven artifacts byte for byte | 1 | `baseline/reproducible-build-5.10.json` |
| Instruction counts, 5.9 against 5.10 | Linux (callgrind) | default trainer +0.5% to +1.1% instructions (Detailed fixture -0.2%); states identical | 2 | `profile/` |
| Performance | Linux, idle machine | PERFORMANCE-5.10.md | 2 | `performance/` |
| Hosted Windows runner (GitHub Actions) on the delivered archive | Windows Server VM, no GPU | recorded beside the ZIP, if it ran: `WINDOWS-CI-5.10.md` | (2) | not in the archive |
| **Target PC: Windows 11, i7-13700F** | - | **NOT EXECUTED for 5.10** | 3 | WINDOWS-TESTS-5.10.md |
| **NVIDIA RTX 4060 Ti: CUDA paths** | - | **NOT EXECUTED for 5.10** (no CUDA code changed; the simulated driver ran) | 3 | WINDOWS-TESTS-5.10.md |

## 2. What the tests found during development (and what was done)

Nothing in this list is hidden behind a later green run; each item names its evidence.

| # | Found by | What was wrong | What was done |
|---|---|---|---|
| 1 | the full regression suite | `source/tests/v59.test.js` did not load: an edit that relaxed two 5.9-specific assertions for 5.10 had placed a `//` comment in the middle of a line, which removed the rest of the line, among it a closing brace. The 16 tests of that file had not run since the edit | the two lines were repaired (the comments moved to the end of the line); the file differs from the 5.9 file in those two assertions only; all 16 tests pass; every `.js` file of `source/tests` and `source/tools` now goes through `node --check`. The build identifier changed with the file (it is part of the fingerprint) |
| 2 | the same run | the suite had been started without `EM_TEST_MWCLI` / `EM_TEST_HOST` and so tested a build of its own (same source, version "development") instead of the release's programs; one test that compares the reported version failed for that reason | the run was repeated against the release's Linux programs; the first log is not used as evidence |
| 3 | inspection of the fingerprint | three tables compiled into `mwcli` (the self-test's recorded states and reference values) had the extension `.inc`, which the source fingerprint does not cover | renamed to `.hpp`; the fingerprint now covers every compiled file |
| 4 | the first run of `estimator510.py` | its last Monte Carlo case wrote every row of a large table as JSON and the script exhausted the machine's memory (the run was killed by the memory limit; a few minutes later the machine was restarted - the session does not know why - and the convergence experiment was interrupted) | the harness writes only rows that can qualify; the experiment runner gained `--resume` (complete units are kept, a cut-off unit is run again from its beginning, nothing is analysed in between) |
| 5 | the first and second run of `estimator510.py` | the Monte Carlo comparison of the two estimators' means flagged two games, then one: in both cases the criterion was at fault (too few effective samples for a normal test under heavy-tailed weights; a per-game error rate applied to thirteen games), shown by samples 4 to 32 times larger | MATHEMATICAL-VALIDATION-5.10.md, section 5.3; all three runs are kept |
| 6 | the second run of `estimator510.py` | the cross-check against the 4.7 estimator asked for 8 equal digits of exact NashConv after 40,000 deals; one ICM game had 6 (bit-identical after 100 deals, drifting smoothly: rounding amplified by the training dynamics) | the check compares at 100 to 40,000 deals and requires agreement where rounding has not been amplified; section 6 of the same document |
| 7 | a new regression test (processing modes) | none in the engine: the test asked for 2,560 deals of `rbes` on a six-player game with 208 exact hands a seat and the training stopped, as designed, at the 512 MiB table limit after 2,048 | the test trains 768 deals; the fast table growth of `rbes` with large exact ranges is a documented limitation |
| 8 | review of the 5.9 validation report sent with the assignment | the focused report's title still said "checkpoint integrity and the process memory budget only" (a 5.7.1 leftover) | the 5.10 script names what its focused mode covers |

No defect was found in the estimator's arithmetic, in the default trainer, or in checkpoint handling.

## 3. The regression suite

`EM_TEST_MWCLI=build/linux/mwcli EM_TEST_HOST=build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap
source/tests/*.test.js`: 656 tests, 655 passed, 0 failed, 1 skipped. 5.9 had 637 tests (636 passed,
1 skipped); 5.10 adds the 19 tests of `v510.test.js` and changes two assertions of `v59.test.js` (the version string
and the name of the workflow's validation script). The one skipped test is the one 5.9 skipped: "4.9 a checkpoint
save into a read-only folder fails with exit 4" needs a user who is not root.

What `v510.test.js` covers, by the list of the assignment: regret-increment correctness and bias (the exact check
on reference games of every kind; the independent Python implementation, including a dump that must be rejected),
sampling probabilities and rare actions (the sampler test, with a wrong claim that must be detected), variance
reduction (the Monte Carlo harness), numerical stability and multithreading (one state for 1 to 4 threads, the 5.6
batch update, caches off; stop and continue), average-strategy accumulation (every exact check compares regret and
average increments), exact NashConv (a regression reference per trainer), ICM and side pots (among the exact
checks), checkpoints of the new algorithm and resume after interruption (a study interrupted every 0.05 s until
complete equals the uninterrupted one; cross-trainer refusals), memory-budget recovery (a table limit stops cleanly
and resumes to the uninterrupted state), GPU compatibility (all four processing modes beside the simulated CUDA
driver), unsupported configurations (refused before training), the default trainer against 31 recorded 5.9 states,
the experiment runner (a dry run, and an interrupted run resumed), and the Windows script and launchers (static).

## 4. Self-tests of the Linux build

`mwcli --selftest510 studies <dir> all`: 21 checks in 44 s. estimator X1 to X8 (exact checks of eight
game and variant combinations); training D1 (14 states of the 5.9 program), D2 (the Detailed identifier cache on and
off), R1 to R6 (rbes: one state for repeated runs, thread counts, the 5.6 batch update and with its cache off;
stop and continue; 12 recorded states; exact NashConv references of both trainers; the trained response of a state
trained by rbes against exact values; a study with `estimator=rbes`); checkpoint C1 to C3 (every cross-algorithm
continuation refused with nothing written; header and study identifier; a compressed state continues); limits L1
(refused configurations), L2 (a table limit stops cleanly and resumes). The earlier self-tests pass unchanged (32, 33, 24, 28 checks).

## 5. Sanitizers (`sanitize510.sh`; `sanitizers/summary.txt`)

No report of any sanitizer. Not covered by sanitizer runs: the desktop host and the earlier regression files (they
were covered in the releases that changed them), and anything on Windows.

## 6. The Windows executables under Wine (`wine510.sh`)

`mwcli.exe` passed the five self-tests under Wine (wine-9.0 (Ubuntu 9.0~repack-4build3)): 21 of 21, 32 of 32, 33 of 33, 24 of 24 and 28 of 28 checks for 5.10, 5.9, 5.8, 5.7.1 and 5.7; wrote the `rbes` reference state of the Linux build with 1, 2 and 4 threads and passed the exact estimator check; reproduced the 7 reference responses of 5.9 bit for bit; and passed 9 of the 9 tests of the 5.10 regression file that were run against it. Wine is not Windows: this is evidence that the cross-compiled executables contain the logic of the
Linux programs, including bit-identical floating point for the trainers; it is not evidence about a Windows PC.

## 7. The validation script under PowerShell (`powershell510.sh`)

`validate_windows510.ps1` was parsed (0 errors) and executed by PowerShell 7.4.6 on Linux against the Linux
programs: focused 50 passed, 0 failed, 1 skipped, 0 untested (skipped: integrity / SHA256SUMS.txt); full 215 passed, 0 failed, 2 skipped, 0 untested (skipped: integrity / SHA256SUMS.txt; GPU / CUDA validation). This executes the script's own logic - the plan, every section that
needs neither Windows nor a GPU, the comparisons, the report writer - and found the script's two 5.10 sections
working. It is not a run with Windows PowerShell 5.1 and not a run on Windows.

## 8. Not executed, unavailable, or not passed - in one place

| Item | Status | Why |
|---|---|---|
| Any 5.10 program on the target PC | not executed | the owner was not available for testing; one double-click: WINDOWS-TESTS-5.10.md |
| CUDA on an NVIDIA GPU (all modes; rbes beside CUDA scoring) | not executed | no GPU in development; the scheduler and kernels are unchanged and ran in 5.9 on the target PC; rbes ran beside the SIMULATED driver only |
| Windows PowerShell 5.1 on the validation script | not executed in development | PowerShell 7.4 on Linux only |
| Thread counts above 4 on real cores | not executed | 4 logical processors in development (the identity tool runs 8 threads on 4 processors) |
| Runs of hours, tables of gigabytes with rbes | not executed | time; the table-limit stop and its resume are tested at small sizes |
| The exact check on large trees | not possible | the outcomes of one traversal cannot be enumerated; section 9 of MATHEMATICAL-VALIDATION-5.10.md |
| An independent implementation for ICM, preflop and hand-group games | not available | the Python reference plays postflop chip-EV games with exact cards |
| A mutation run of the self-test (engines with one behaviour broken, as 5.8 and 5.9 had) | not done | time; the regression file contains two negative controls instead (a scaled dump and a wrong sampler claim must be rejected) |
| A comparison with an external solver | not done | none found that plays these games without modification |
| An upper bound of NashConv for large games | does not exist | CONVERGENCE-5.10.md, section 9 |
