# EightMax 5.11: validation

Build `af452eaa0ea731be`. Evidence: `validation/5.11/`. Mathematics of the streams: MATHEMATICAL-VALIDATION-5.11.md.
Convergence: CONVERGENCE-5.11.md.

**Where things ran.** The development machine of this release (Linux, 2 logical processors) has no Windows
cross-compiler, no Wine and no PowerShell, and may not install packages. The Windows programs were therefore built,
and every test that needs them or four processors was run, by GitHub Actions jobs on hosted runners (definitions:
`validation/5.11/ci/`); each job published its evidence, which is what `validation/5.11/` holds. The convergence
experiment, the benchmark, the interface test in a browser and the baseline regression ran on the development machine.
**Nothing ran on the target PC or on an NVIDIA GPU.**

## 1. Every test in one table

Class: 1 = independently validated (a proof, an independent implementation, an exact reference, or the unchanged
5.10 program agrees); 2 = tested on Linux, under Wine, with PowerShell 7 or on a hosted Windows runner; 3 = awaiting
the target PC / GPU; 4 = unresolved or not established.

| # | What | Result | Class | Evidence |
|---|---|---|---|---|
| 1 | 5.10 baseline: archive against its identity file; rebuild of the three Linux programs and the interface (development machine) and of the three Windows executables (hosted runner) | all byte-identical to the shipped 5.10 files | 1 | `baseline/baseline-5.10.json` |
| 2 | 5.10 baseline: regression suite and the five self-tests with the rebuilt programs | 656 tests: 653 passed, 2 failed, 1 skipped - both failures are this machine (2 processors; load), see section 3; self-tests 21 / 32 / 33 / 24 / 28, all passed | 2 | `baseline/` |
| 3 | Generator: reference vectors, a second source text, the inverse map, the address rule, moments | 7 of 7 | 1 | `selftest/selftest511-linux.json` (G1-G3, A1, A2, N1, L1) |
| 4 | Independent implementation of the streams in Python integers | 3 of 3 checks; 11,100 numbers of 300 addresses bit for bit | 1 | `independent/streams511-selfcheck.json` |
| 5 | Counter audit of real trainings (seven configurations; a state above update 2^32) | 240,263 + 5,913 counters, none twice, no gap, none invalid | 2 | selftest511 U1, U2 |
| 6 | The 5.10 streams are untouched: 14 recorded states, with and without the explicit key | 14 of 14, twice | 1 | selftest510 D1, selftest511 D1 |
| 7 | The 5.10 streams are untouched: the unchanged 5.10 program against this build (thread counts, trainer options, hand groups, table limits) | 225 cases, 1,782 trainings, 0 differences | 1 | `identity/` |
| 8 | The 5.10 streams are untouched: the experiment's identity arm | 544 of 544 states | 1 | `convergence/exact/summary.json` |
| 9 | philox64: reproducible; 1 and 3 threads; the 5.6 batch update; stopped and continued | 5 of 5 configurations each | 2 | selftest511 W1, W2 |
| 10 | philox64: 15 recorded states, a state at 10,000,200 updates, a state at update index 4,294,970,303 | all reproduced on Linux, under Wine and on Windows Server 2025 | 2 | selftest511 W3, L2, L3 (three platforms) |
| 11 | Checkpoint rules (streams, seed, compressed states); the unchanged 5.10 program refuses a philox64 state; a forged header is refused | all as required | 2 | selftest511 C1-C3; `tests/v511.test.js` |
| 12 | Limits and refusals (trainer, studies, DCFR, malformed settings) | all as required | 2 | selftest511 L1, L4, L5; `tests/v511.test.js` |
| 13 | Recorded tables of the self-test are what the release build writes | 3 of 3 files identical | 2 | `run-final511-steps.txt` |
| 14 | Self-tests of earlier releases with the 5.11 Linux programs | 5.10: 21, 5.9: 32, 5.8: 33, 5.7.1: 24, 5.7: 28 - all passed | 2 | `selftest/` |
| 15 | Regression suite, Linux programs, hosted runner (4 processors) | 668 tests: 668 passed, 0 failed, 0 skipped | 2 | `tests/` |
| 16 | Sanitizers: AddressSanitizer + UndefinedBehaviorSanitizer (self-tests 5.11 and 5.10, the 5.11 test file), ThreadSanitizer (counter audit from three threads; six frozen-batch philox64 trainings on four threads), LeakSanitizer | 0 reports; instrumented states = release states, 6 of 6 | 2 | `sanitizers/summary.txt` |
| 17 | Desktop host: refused studies leave no folder (the over-limit request names the 5.10 streams) | 9 of 9 | 2 | `host-refusal59-with-the-5.11-host.json` |
| 18 | Desktop host: a philox64 spec through `/api/mw` trains the state of mwcli; cross-import refused | passed | 2 | `tests/v511.test.js` |
| 19 | Interface in a real browser (Chromium), Study tab against the 5.11 host | 20 of 20 (development machine; see section 6) | 2 | `ui/` |
| 20 | Stability run of the desktop host, 3 minutes | 12 of 12 | 2 | `stability/` |
| 21 | Windows programs under Wine 9.0: self-tests 5.11, 5.10, 5.9, 5.8, 5.7.1, 5.7; the streams section; the 5.9 reference responses; the 5.11 test file | all exit 0 | 2 | `wine/summary.txt` |
| 22 | The Windows validation script with PowerShell 7.6 on Linux against the Linux programs | focused: 54 passed, 0 failed, 1 skipped, 0 untested (35.5 s); full: 247 passed, 0 failed, 2 skipped, 0 untested (446.9 s) | 2 | `powershell/` |
| 23 | **Both launchers on a hosted Windows runner** (Windows Server 2025, Windows PowerShell 5.1, 4 processors, no GPU), pre-release tree | focused launcher exit 0: 54 passed, 0 failed, 1 skipped, 0 untested (86.2 s); full launcher exit 0: 247 passed, 0 failed, 2 skipped, 0 untested (683.7 s) (skipped: the integrity check, which a pre-release tree cannot make, and the GPU section) | 2 | `windows-runner/` |
| 24 | The delivered archive on a hosted Windows runner, integrity included | see WINDOWS-CI-5.11.md beside the ZIP | 2 | (outside the archive) |
| 25 | Packaging: the ZIP extracted into an empty folder, manifest, build identity, smoke tests of the Windows programs under Wine | see `EightMax-Windows-5.11.identity.json` beside the ZIP | 2 | (outside the archive) |
| 26 | Convergence against 5.10 by a rule written first | rule met (CONVERGENCE-5.11.md) | 2 | `convergence/` |
| 27 | Released program writes the experiment's states | 72 of 72 | 2 | `convergence/reproduce.json` |
| 28 | Reproducible build: two builds of the tree on the runner; the Linux programs also on the development machine | byte-identical | 1 | `build/` |
| 29 | Target PC: Windows 11, i7-13700F, 24 threads | **not run** | 3 | WINDOWS-TESTS-5.11.md |
| 30 | CUDA: Hybrid and GPU-Preferred with philox64 on the RTX 4060 Ti | **not run** (no CUDA code changed; every machine so far fell back to the CPU) | 3 | WINDOWS-TESTS-5.11.md |
| 31 | Statistical quality of the generator beyond its published record | not established | 4 | MATHEMATICAL-VALIDATION-5.11.md, section 8 |
| 32 | Convergence on games with hand groups or too large for exact NashConv; beyond 500,000 deals | not established | 4 | CONVERGENCE-5.11.md, section 6 |

## 2. What the tests found during development (and what was done)

* **The study default broke eight existing checks, as it should.** Tests that compare a study with an older program
  (5.6, 5.7), with a manual training of the fixture's spec, or with the 10,000,000-update limit failed once studies
  trained with philox64. Each now names the 5.10 streams (`trainingStreams=5.10`): `tests/v52.test.js` (3 requests),
  `v57`, `v571`, `v58` (2), `mwcli --selftest58` limits L1 to L3 (4 requests), `tools/host_refusal59.js`, and the
  "refused study" section of the Windows script. With that option a 5.11 study gives the measurements of the 5.6 and
  5.7 programs number for number - which is the property those tests exist to show.
* **A study checkpoint of another build was reported as "a different study".** The plan of a study now includes its
  streams, and the plan was compared before the build. The build is now compared first, so the refusal names the
  build as before (`native/study_checkpoint55.hpp`).
* **A philox64 spec could not start from a fixture's state object**, which carries the 32-bit seed. A new training
  (update 0) now ignores the two 32-bit fields; a spec that starts later with them set is refused.
* **The first CI publish step published nothing** (a relative path after a directory change). Found on the first
  run, fixed; no evidence was lost because nothing had been collected yet.
* **The interface test cannot run on the hosted runner** (the browser automation library is not installed there).
  It ran on the development machine against the Linux host, which is byte-identical to the runner's build.

## 3. The regression suite

Hosted runner: 4 logical processors, Intel(R) Xeon(R) 6975P-C; g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0; Node v22.23.5. `source/tests/*.test.js` against the release's Linux programs, one file at a time: **668 tests: 668 passed, 0 failed, 0 skipped** in 42 minutes (`tests/full-regression.tap.gz`, `tests/full-regression.summary.txt`). The 5.10 suite had 656 tests; 5.11 adds the 12 of `v511.test.js`.

The two tests that fail on the development machine with the unmodified 5.10 program (section 1, row 2) are
environment-dependent: one asserts that three seats ran side by side, which needs three processors; the other
asserts a scoring-route decision that depends on measured timings. Neither is a change of 5.11.

## 4. Sanitizers (`sanitize511.sh`; `sanitizers/summary.txt`)

AddressSanitizer + UndefinedBehaviorSanitizer + float-cast-overflow: `--selftest511` (26 of 26), `--selftest510`
training, checkpoint and limits, six tests of the 5.11 file: 0 reports. ThreadSanitizer: `--selftest511 streams`
(the counter audit records from three threads) and six frozen-batch philox64 trainings on four threads: 0 warnings;
the six states equal the release program's on one thread. LeakSanitizer on a training, a refused setting and a
refused checkpoint: 0 reports.

## 5. Windows programs: Wine, PowerShell, a hosted Windows runner

* **Wine 9.0** (`wine/`): the six self-tests through `mwcli.exe` (26, 21, 32, 33, 24, 28 checks), the philox64
  reference state for 1, 2 and 4 threads (the bytes of the Linux build), the 5.9 reference responses, five tests of
  the 5.11 file with `mwcli.exe`. Wine is not Windows.
* **PowerShell 7.6 on Linux** against the Linux programs (`powershell/`): every `.ps1` through the parser (0 errors);
  the script in focused and full mode. Not Windows PowerShell 5.1 and not Windows.
* **A hosted Windows runner** (`windows-runner/`): `Run 5.11 focused validation.bat` and `Run 5.11 Windows
  validation.bat` as a user starts them, Windows PowerShell 5.1, Windows Server 2025, 4 virtual processors, no NVIDIA
  GPU. This is real Windows executing the real executables; it is not the target PC, has no GPU, and has 4 threads
  where the PC has 24. The pre-release tree had no manifest, so these two runs skipped the integrity check; the run
  of the delivered archive (row 24) makes it.

## 6. Not executed, unavailable, or not passed - in one place

* Nothing on the target PC; nothing on any NVIDIA GPU. CUDA code is unchanged, and no test of this release exercised it.
* The interface test in a browser ran on the development machine only (20 of 20); on the hosted runner the step
  ended with "module not found" before testing anything and is recorded as exit 1 in `run-final511-steps.txt`.
  The four screenshots of that test are not in the archive (space).
* The interactive multiway panel was not changed and was not tested with philox64 beyond the host API test (row 18).
* The Windows build of the in-tree workflow (`.github/workflows/windows.yml`, MSYS2 on a Windows runner) was updated
  for 5.11 and not run, as for every release since 5.7.
* The 5.10 baseline regression was run under load on a 2-processor machine (2 environment failures, row 2).
* The convergence experiment was interrupted once by a time limit and resumed (CONVERGENCE-5.11.md, section 2).
* No test compares philox64 with 5.10 beyond 500,000 deals; none uses hand groups in the convergence comparison.
