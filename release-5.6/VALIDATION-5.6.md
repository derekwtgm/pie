# Validation — EightMax 5.6

Build `7ee054b44c409149`. What was executed, with which commands, where, and what was not. Classes: 1 independently tested; 2 verified by the project's tests, simulation or Wine; 3 written, awaiting physical hardware; 4 not implemented or unsuccessful. Machine-readable: `validation/5.6/validation-summary.json`.

## Environment

| | |
|---|---|
| Machine | shared cloud container, 4 logical processors (Intel Xeon 2.1 GHz), 16 GB, Ubuntu 24.04, running as root |
| Compilers | gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0; x86_64-w64-mingw32-g++-posix (GCC) 13-posix |
| Node, Python | v22.23.5; Python 3.13.18 with NumPy and SciPy |
| Windows execution | wine-9.0 (Ubuntu 9.0~repack-4build3) only. No Windows machine. |
| GPU | none. The CUDA driver test double (a simulated driver) on Linux only. |
| Browser | Chromium through Playwright, for the Study tab |

## Summary of every item

| Area | Item | Class | Result |
|---|---|---|---|
| baseline | 5.5 archive, manifest, build identity and regression suite reproduced | 1 | passed |
| regression | full regression suite on the final Linux build | 2 | passed |
| trainer | final binary reproduces the convergence checkpoints (5.5 arms included) and the golden states | 1 | passed |
| trainer | default trainer and 5.5 options: state bytes identical to the 5.5 binary (10 games x 17 configurations, one-part and two-part) | 1 | passed |
| checkpoints | solver checkpoints continue across 5.5 and 5.6 in both directions | 1 | passed |
| mathematics | expected regret and average-strategy increments of every estimator against an independent exact CFR update | 1 | passed |
| convergence | fixed-plan comparison completed (exact NashConv, equal deals and equal time) | 1 | passed |
| convergence | candidate river-cross promoted to default | 4 | not passed / not met |
| statistics | replication verdicts: formulas, refusal, null scenarios, adversarial training failures | 2 | passed |
| statistics | 5.5 bounded-payoff validation re-run against the 5.6 probe | 2 | passed |
| sanitizers | AddressSanitizer + UndefinedBehaviorSanitizer on the 5.3-5.6 regression files: no sanitizer report (1 of 53 tests failed, on a time budget the instrumented build exceeds) | 2 | passed |
| sanitizers | ThreadSanitizer: parallel studies, checkpoints, frozen-batch training, parallel exact best response | 2 | passed |
| sanitizers | LeakSanitizer on one complete command-line study | 2 | passed |
| interface | Study tab driven in Chromium against the desktop host (Linux build) | 2 | passed |
| stability | long-running studies against the desktop host: pause/resume cycles, kills, memory readings | 2 | passed |
| performance | training throughput 5.5 vs 5.6 on the study fixtures | 2 | passed |
| performance | complete studies 5.5 vs 5.6: same measurements | 1 | passed |
| evaluator | exact best response 5.5 vs 5.6: same NashConv | 1 | passed |
| cpu | frozen-batch training with 1, 2 and 4 threads: identical state for every thread count and both versions | 1 | passed |
| build | Windows executables byte-reproducible (built twice) | 2 | passed |
| windows | 5.6 regression file against the Windows executables under Wine | 2 | passed |
| windows | whole regression suite against the Windows executables under Wine, file by file: no failure that the 5.5 Windows executables do not show as well (68 of 583 tests fail under Wine with both) | 2 | passed |
| hardware | physical Windows 11 execution of the three executables | 3 | not executed |
| hardware | NVIDIA RTX 4060 Ti (CUDA) execution and timings | 3 | not executed |
| hardware | validate_windows56.ps1 (the Windows validation script itself) | 3 | not executed |
| hardware | GitHub Actions Windows workflow with the 5.6 steps | 3 | not executed |
| hardware | checkpoint durability under real power loss | 3 | not executed |

## 1. Baseline (before any change)

```sh
sha256sum EightMax-Windows-5.5.zip                 # 3853b34aa2f97d8087fa619cb12468d9fe98fc17337a1e15679fb350567894c9 = identity file
unzip -q EightMax-Windows-5.5.zip && cd EightMax
sha256sum -c SHA256SUMS.txt                        # 3939 OK, 0 failed
node source/tools/build.js build                   # EightMax 5.5 build abe74607a4a0120b
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
node --test --test-concurrency=3 source/tests/*.test.js   # 568 tests, 567 passed, 0 failed, 1 skipped
```

The untouched extraction is kept read-only; its Linux and Windows 5.5 programs are the reference in every comparison below. Evidence: `validation/5.6/baseline/`. A first attempt at the baseline regression was started in the working copy and stopped when source edits began there; it is kept, marked aborted, and not used.

## 2. Regression suite

```sh
EM_TEST_MWCLI=build/linux/mwcli EM_TEST_HOST=build/linux/eightmax node --test --test-concurrency=3 --test-reporter=tap source/tests/*.test.js
```

**Final build: 583 tests, 582 passed, 0 failed, 1 skipped.** `validation/5.6/tests/full-regression.tap`.

- Skipped: "4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissions)": running as root: permissions are not enforced. It needs a non-root account; the limitation is the container's.

Complete runs made before the recorded one are kept, with the cause of every failure:

| Run | Tests | Passed | Failed | Cause of the failures |
|---|---|---|---|---|
| development build 15da3c3c, other jobs running, tests still being added | 583 | 577 | 5 | two desktop-host tests answered 503 while a 4 GiB evaluator comparison and a 5.5 study ran beside the suite; one test requires RELEASE-5.6.md, not yet written; two 5.6 tests were newer than the binary |
| build 0a680c41 (the final engine; before the last change to the Windows validation script) | 583 | 582 | 0 | no failure; the log was deleted when that build was replaced, so this run is reported from the session record only |
| final build 7ee054b4, first run, with the Wine regression suite running on the fourth processor | 583 | 580 | 2 | "HTTP streaming refuses missing declared bytes" (v36): the desktop host answered 503 instead of 200 to the preceding upload; "5.1 crossover inside one job" (v51): a route decision that depends on measured timings chose the CPU for every batch. Both passed in the two earlier complete runs and pass when their files are run alone; both depend on machine load |

New tests (`source/tests/v56.test.js`, 15): golden states of the 5.5 trainer with two-part continuation; identity with the archived 5.5 binary on fresh seeds and on grouped fixtures; the training report; the experimental estimators (options, refusals, effect on other games); deterministic continuation of the candidates and refusal of another trainer's state; shared walk against 5.5's enumeration, entry by entry; every estimator against the independent exact CFR update, including a deliberately biased dump that must fail; compact tables and passive runouts against the 5.5 code paths with 32 and 1,024 MiB caches; an exact study against the 5.5 evaluator paths; the replication formulas and verdicts; certificates with sampled evaluation; the study document, printed summary and interface helpers; interrupted and resumed study with a candidate, another build and another trainer refused; the checkpoint lock; seed counts beyond the fixture list.

Existing tests edited: one. `v52.test.js` expected `seeds=99` to be refused with "seeds must be 1 to the number of seeds"; a count beyond the fixture's list is now allowed up to 64, so the expected message is "seeds must be a count from 1 to 64". No assertion was removed.

| Required category | Where it is covered |
|---|---|
| Mathematical correctness | identity matrix and golden states against 5.5; `enum56.cpp` + `independent_cfr56.py`; `independent_br48.py` (4.8); 5.5 payoff-bound tests |
| Training convergence | CONVERGENCE-5.6.md (fixed plan); `v56` candidate tests |
| Independent evaluation | exact NashConv by `mwcli --gain`; Python best-response and CFR references |
| Statistical calibration | `statistical_validation56.py` and the re-run of `statistical_validation55.py`; probe tests in `v53`-`v56` |
| ICM and multiway | `v56` evaluator tests on four-player ICM, eight-player ICM, five- and six-player flops; `bench56.py` evaluation section; 4.5 ICM kernel tests |
| CPU parallelism | identity matrix with 1-4 threads; `threads56.py`; ThreadSanitizer runs |
| Checkpoint recovery | `v55` and `v56` study checkpoint tests; `stability55.js`; cross-version continuation |
| Memory limits | 1 MiB table budget in the identity matrix; process memory budget test (`v55`); compact tables with a 32 MiB cache |
| File corruption handling | damaged manifests and states (`v55`, `v56`), hash-valid manifest of another build, 3.x-4.x checkpoint store fault injection |
| Cross-platform reproducibility | golden states and the 5.6 test file under Wine; Windows and Linux states compared byte for byte |
| Application startup | desktop host in the regression suite, in the browser-driven run and in the packaged smoke test under Wine |
| Desktop host and command line | both drive `study52.hpp`; `v52`-`v56` use both |

## 3. Trainer identity, final-binary checks, expected increments

```sh
python3 source/tools/identity56.py <5.5 mwcli> build/linux/mwcli validation/5.6/identity      # 170 cases, 0 failures
python3 validation/5.6/final_checks.py . build/linux/mwcli <5.5 mwcli> validation/5.6/final-checks.json   # 210 checkpoints, 0 differing; 11 golden states, 0 differing
sh validation/5.6/unbiasedness.sh . validation/5.6/unbiasedness                                 # 13 estimator-game runs, all passed
```

The identity matrix records one bookkeeping difference from 5.5 and does not require it to match: the high-water mark of transient allocations (`scratchPeakBytes`) moves by up to a few kilobytes because the undo journal is now kept for the whole training call. The transient budget and the per-deal limit are unchanged. Tables are in CONVERGENCE-5.6.md.

## 4. Convergence

```sh
taskset -c 0 python3 source/tools/research56.py <5.5 mwcli> <5.6 mwcli> convA --games hu-river,hu-turn,river3-chip,turn4
taskset -c 1 python3 source/tools/research56.py <5.5 mwcli> <5.6 mwcli> convB --games flop6,final8,bubble4
python3 source/tools/research56.py <5.5 mwcli> <5.6 mwcli> convA convB validation/5.6/convergence/main --analyze-only
```

10,500 checkpoints, plan complete: yes. The two processes ran while other development work used the other processors; the equal-time contrasts are paired by seed with rotated arm order. Result and decision: CONVERGENCE-5.6.md.

## 5. Statistics

```sh
python3 source/tools/statistical_validation56.py <probe built from the release source> validation/5.6/statistics/formal    # passed
python3 source/tools/statistical_validation55.py <the same probe> validation/5.6/statistics/v55-rerun                  # passed
```

Two development passes of the 5.6 script (800 trials) are kept in `validation/5.6/statistics/development-pass*`. They led to two corrections of the pass rules for the adversarial scenarios, recorded in the protocol under `ruleHistory`; no threshold was changed and no scenario removed. STATISTICAL-VALIDATION-5.6.md has the results.

## 6. Sanitizers

```sh
bash validation/5.6/sanitize56.sh . <work dir>
```

- AddressSanitizer + UndefinedBehaviorSanitizer on the 5.3-5.6 regression files: no sanitizer report (1 of 53 tests failed, on a time budget the instrumented build exceeds): **passed** {"tests": 53, "passed": 52, "failed": 1, "skipped": 0, "sanitizerReports": 0, "failures": ["5.6 a study with an experimental trainer is interrupted and resumed to the uninterrupted result; a checkpoint of another build or trainer is refused"], "note": "the one failing test allows 40 resumes of 0.4 s, which the instrumented build exceeds; the same scenario run to completion (54 resumes) equals the 
- ThreadSanitizer: parallel studies, checkpoints, frozen-batch training, parallel exact best response: **passed** {"warnings": 0, "runExitCodes": ["0", "0", "0", "0", "0", "0", "0", "0"]}
- LeakSanitizer on one complete command-line study: **passed** {"exit": "0"}

Leak checking is limited to that one study, as in 5.5: LeakSanitizer needs process tracing, which this container restricts for the test harness.

## 7. Interface and stability

```sh
node source/tools/study_ui56.js build/linux/eightmax . validation/5.6/ui          # 20 of 20 checks
node source/tools/stability55.js build/linux/eightmax . validation/5.6/stability --minutes=6   # passed
```

The browser run starts a study in the Study tab, stops it, kills the host, resumes in a new host, compares with an uninterrupted command-line study, checks the 5.6 replication line and warnings in the panel, discards the study and opens a 5.4 result file. Linux host only; the Windows host was not driven by a browser.

## 8. Performance measurements

```sh
python3 source/tools/trainbench56.py <5.5 mwcli> build/linux/mwcli validation/5.6/performance/trainbench
python3 source/tools/bench56.py <5.5 mwcli> build/linux/mwcli validation/5.6/performance/bench --eval-timeout 300
python3 validation/5.6/threads56.py . <5.5 mwcli> build/linux/mwcli validation/5.6/performance/threads.json
```

Results: PERFORMANCE-5.6.md. The three benchmark programs were run one after another with nothing else running in the container (2026-11-23, 07:08 to 08:04 UTC), on the final build. They are Linux measurements on shared cloud hardware; absolute times on the target Windows PC will differ.

## 9. Windows programs (cross-compiled, run under Wine)

```sh
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
EM_TEST_MWCLI=<wrapper: wine mwcli.exe> EM_TEST_HOST=<wrapper: wine EightMax.exe> node --test --test-concurrency=1 source/tests/*.test.js
python3 validation/5.6/release56.py . output --wine
```

- Built twice from the same tree: the three executables are byte-identical.
- 5.6 test file against the Windows programs: 15 tests, 15 passed, 0 failed (`validation/5.6/wine/`).
- Whole suite against the Windows programs, one node --test process per test file, concurrency 1 inside the file, 3 files at a time, 720 s limit per file: 41 of 41 test files ran to completion; 583 tests recorded, 514 passed, 68 failed, 1 skipped.
- Control: the 18 files with a failure or a timeout, run the same way with the **5.5** Windows programs: 309 tests recorded, 238 passed, 70 failed. In the three-files-at-a-time run, 4 tests of v37.test.js failed with the 5.6 Windows programs and passed with the 5.5 ones. Run alone, three times per version, that file fails the same 3 tests with both versions, so the 4 were interference between test files sharing one Wine save folder. With that, every test that fails with the 5.6 Windows programs under Wine also fails with the 5.5 Windows programs under the same harness.

| Cause of failure under Wine | Tests (5.6 programs) | Also failing with the 5.5 programs |
|---|---|---|
| needs the Linux CUDA driver test double (a Linux library that a Windows program under Wine cannot load) | 27 | 27 |
| the test reads or edits the host's save folder directly; under Wine the host reports a Windows path that the Linux test process cannot open | 16 | 16 |
| other | 25 | 21 |

The 4 failures without a 5.5 counterpart in the table are the `v37.test.js` tests explained above (isolated reruns: `validation/5.6/wine/isolated/`).

An earlier attempt ran the whole suite in one process; it stalled inside `v39.test.js` and was stopped (`validation/5.6/wine/suite-files-before-v39-then-stopped.tap`). These Wine results are a simulation of Windows, not Windows.

- Packaged archive, extracted into an empty folder, programs run under Wine: passed. Manifest 4261 entries verified; build ids {"mwcli.exe": "EightMaxBuild=7ee054b44c409149", "EightMax.exe": "EightMaxBuild=7ee054b44c409149", "gpustress.exe": "usage printed, exit 2"}; known game call frequency 0.5008, EV gap 0.0047 BB (closed form 1/2 and 0); self-test 15 passed, 0 failed; host answered with build 7ee054b44c409149; study interrupted and resumed equals the uninterrupted one; golden states {"checked": 11, "identical": 11, "seconds": 28.8}; candidates and refusal {"riverSharedVisitsPerDeal": 21.0, "riverVisitsPerDeal": 42.0, "candidatesCoincideOnRiverGame": true, "stateOfAnotherTrainerRefused": true}; exact evaluation {"g04-bubble4": {"nashConv": 0.5771548281111227, "seconds32MiB": 3.26, "seconds1024MiB": 3.4, "seconds55Paths1024MiB": 3.19, "relativeDifferenceFrom55Paths": 0.0}, "g05-flop6": {"nashConv": 0.8339057825399248, "seconds32MiB": 2.64, "seconds1024MiB": 2.52, "seconds55Paths1024MiB": 4.14, "relativeDifferenceFrom55Paths": 5.325412284556268e-16}}; replication {"trainings": 3, "minimumTrainings": 8, "verdict": "trainingsDisagree", "bestActionDeclared": false, "warnings": ["trainingsDisagree", "insufficientReplication", "rareTrainingFailuresNotExcluded"]}; checkpoint lock {"secondProcessRefusedWhileFirstRuns": true, "firstProcessKilled": true, "resumedEqualsUninterrupted": true, "lockFileRemoved": true}.

Wine is not Windows. It shows that the PE executables load, that the Windows code paths (file locking, process memory readings, sockets, threads) run, and that results equal the Linux build's. It does not show behaviour on NTFS, under Windows Defender, with real drivers, or on the target CPU.

## 10. Not executed

| Item | Why | What to do |
|---|---|---|
| physical Windows 11 execution of the three executables | no Windows machine was available; run "Run 5.6 Windows validation.bat" | WINDOWS-TESTS-5.6.md |
| NVIDIA RTX 4060 Ti (CUDA) execution and timings | no NVIDIA GPU was available; no CUDA code changed; the driver test double was used on Linux | WINDOWS-TESTS-5.6.md |
| validate_windows56.ps1 (the Windows validation script itself) | written for Windows PowerShell 5.1; never executed: no PowerShell was available to the development session | WINDOWS-TESTS-5.6.md |
| GitHub Actions Windows workflow with the 5.6 steps | updated; not run: no runner was reachable from the development session | WINDOWS-TESTS-5.6.md |
| checkpoint durability under real power loss | never tested (as in 5.5) | WINDOWS-TESTS-5.6.md |
| Whole regression suite on real Windows | no runner reachable | the new CI step runs it |
| Leak checking beyond one study | process tracing restricted in the container | run the ASan build with detect_leaks=1 on an unrestricted host |
| The read-only-folder test | cannot fail as root | runs on any non-root account |
| Browser-driven test of the Windows host | Chromium was run against the Linux host only | part of the manual steps |
| Studies longer than a few minutes | time | Deep and Research presets on the target PC |

## 11. Unresolved failures

None in the recorded Linux regression run. Under Wine, the failures listed in section 9 remain; each is attributed there.

