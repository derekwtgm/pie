# EightMax 5.8 — validation record

Build `d4001e2c0cd77f41`. Every test that was executed, failed, skipped or could not be run, with where its evidence
is. The machine-readable form is `validation/5.8/validation-summary.json` (written by `validation/5.8/summarize58.py`
from the evidence files; a missing file gives `null`, never a default).

**Rule used throughout:** a test is reported as passed only if it executed and passed in the run named beside it.
Where something was not executed, it says "not executed" and why.

Validation classes (used in every table):

| Class | Meaning |
|---|---|
| 1 | independently mathematically validated (an independent implementation, an exact reference, or the unchanged 5.7.1 binary agrees) |
| 2 | tested on Linux, under Wine, or by simulation |
| 3 | implemented, awaiting physical Windows / GPU validation |
| 4 | unsuccessful, incomplete, not implemented, or not executed |

## Environments

| Environment | What ran there |
|---|---|
| Linux x86-64 container (Ubuntu 24.04, 4 logical processors, 15 GiB, no GPU) | everything in sections 1 to 8 and 11 |
| Wine 9.0 in the same container | the Windows executables (section 9) |
| Windows hardware | **nothing** |
| NVIDIA GPU | **nothing** |
| PowerShell | **nothing** (section 10) |
| GitHub Actions (Windows runner) | **nothing** (section 10) |

## 1. Baseline: the supplied 5.7.1 release, before any change

Evidence: `validation/5.8/baseline/`. The archive was not attached to the development session; it was taken from the
repository branch the owner named (`derekwtgm/pie`, branch `eightmax-5.7.1`, commit `68d9bc6f`) and checked against the
SHA-256 given in the task before anything was done with it. An untouched extraction was kept read-only for
comparison throughout.

| Check | Expected | Found | |
|---|---|---|---|
| archive SHA-256 | `1dd44b55...d57477ef` | the same (also equal to the identity file's) | passed |
| ZIP integrity test | no errors | no errors | passed |
| archive members | 4,639 | 4,639 | passed |
| manifest entries (`SHA256SUMS.txt`) | 4,638 | 4,638; every listed file present with the listed hash; no unlisted file | passed |
| version / build | 5.7.1 / `65e835e6b7060960` | the same in `BUILD-INFO.json`, in the identity file and embedded in the three executables; `verify_build.js` recomputes it from the 377 fingerprinted source files | passed |
| executables | hashes of the identity file | `EightMax.exe`, `mwcli.exe`, `gpustress.exe` equal | passed |
| rebuild from the unmodified source | — | three Windows executables, three Linux programs and the interface **byte-identical** to the shipped ones | passed |
| regression suite of 5.7.1 on the rebuild | 606 tests | 606 run: 605 passed, 0 failed, 1 skipped (`full-regression-5.7.1.tap`) | passed |
| `--selftest571` of 5.7.1 | 24 checks | 24 passed | passed |
| `--selftest57` of 5.7.1 | 28 checks | 28 passed | passed |

The skipped test is "an unwritable results folder is reported": the suite ran as root, for whom no folder is
unwritable; it skips itself with that reason. It is the same one skip in every run below.

**What the baseline is not.** The physical-Windows result on record for 5.7.1 is the *focused* validation: 36 passed,
0 failed, 0 skipped, 0 untested. The *full* Windows/GPU validation of 5.7.1 was never reported, and nothing in this
document treats the 5.7 full run (81 passed, 1 failed) as if it were a 5.7.1 result.

**Preserved.** `source/native/study_checkpoint55.hpp` (the checkpoint-commit repair of 5.7.1) is byte-identical to
5.7.1; all 24 checks of `--selftest571` pass on 5.8 (section 3).

## 2. Regression suite (Linux)

Final build, `validation/5.8/tests/full-regression.tap` (three test files side by side, as in every release since 5.3):

| | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| 5.7.1 (rebuilt, section 1) | 606 | 605 | 0 | 1 |
| **5.8, build `d4001e2c0cd77f41`** | **621** | **620** | **0** | **1** |

621 = 606 + the 15 tests of `source/tests/v58.test.js`. No test was removed. Nothing failed, so nothing was rerun
alone (`tests/rerun-alone.txt` is empty). The skip is the one explained above.

The 5.7.1 release itself recorded its suite as 606 tests with 604 passed in the full run, one load-sensitive failure
that passed alone, and one skip. Run again on the rebuilt 5.7.1 at the start of this work it gave 605 passed and
one skip (section 1); the load-sensitive failure did not occur in that run. Section 2.2 explains what it was.

### 2.0 The test categories the brief requires

| Category of the brief | Tests of the suite whose name mentions it (an index, not a partition: a test can count in several rows) | What 5.8 added |
|---|---|---|
| Regret-update correctness | 7 | response training updates one seat only: self-test R1, R2 (the other seats' rows keep their bytes); mutation "every-seat-learns" |
| Chance probabilities | 15 | the evaluation deals use the study's deal distribution (rejection on shared cards): independent Python values agree |
| Strategy normalization | 9 | frozen strategies equal the stored averages to 0 difference (Python reader) |
| Average-strategy calculations | 4 | self-test R1 (policy "current" of a response state reproduces the trained average exactly) |
| Weighted range handling | 20 | the five 5.8 reference games use weighted ranges; exact against sampled |
| Multiway terminal payoffs | 41 | independent Python on three- and four-player games; six-player responses against exact values |
| Side pots | 18 | reference games river3-chip, mid3-turn, short8-push, sidepot3-icm |
| ICM calculations | 46 | self-test E3 (cache against recursion, bit for bit), E4 (formula); identity on ICM games |
| Exact and sampled evaluation | 112 | estimate against exact gain: 1,120 + 98 + 960 seat estimates |
| Best-response calculations | 15 | direction of the trained response: 1,120 seat gains against the exact best response |
| Convergence measurement | 7 | prespecified experiments of CONVERGENCE-5.8.md |
| CPU multithreading | 48 | same bits for 1 and 3 evaluation threads and for seats side by side; ThreadSanitizer |
| CUDA compatibility | 39 | no CUDA code changed; CPU-only and GPU-Preferred studies agree without a GPU (packager smoke test). **Not executed on a GPU** |
| Checkpoint recovery | 88 | the 24 checks of --selftest571; the host-lock repair and its test |
| Process memory limits | 30 | the memory checks of --selftest571 (unchanged) |
| Long-study accounting | 79 | self-test L1 to L4; measured random-stream usage per deal |
| Invalid configurations | 62 | response life-cycle and malformed requests refused before anything is trained |
| Numerical stability | 83 | bit-identical reference responses on Linux and under Wine; strict IEEE build flags unchanged |

621 tests passed or were skipped in the final run; the counts above come from their names (`validation/5.8/tests/full-regression.tap`).

### 2.1 Earlier full runs of 5.8 that failed, and what was done

The final run was the fourth. The earlier ones are part of the record:

| Run | Build | Result | Failure | Cause | Action |
|---|---|---|---|---|---|
| 1 | `cc28ac78...` | 1 failed | `v37`: "insufficient live table RAM leaves the generation available" (409 instead of 503), passed alone | a defect of the desktop host, present since 5.6 (section 2.2) | host repaired; new test |
| 2 | (rebuilt after the repair) | stopped | — | stopped by hand to correct source comments found wrong on review; not a test result | rebuilt |
| 3 | `3773f3f494b41de5` | 617 passed, 3 failed, 1 skipped | `v48` release-notes test; `v54` "publishes complete large progress JSON"; `v571` "5.7.1 against the unchanged 5.7 binary" | see below | two tests corrected, one document created |
| 4 | `d4001e2c0cd77f41` | 620 passed, 0 failed, 1 skipped | — | — | final |

The output of run 3 is kept: `validation/5.8/tests/earlier-builds/build-3773f3f494b41de5/`. The output file of run 1
was overwritten by the next run; what remains of it is the failing test's name and message, recorded when it
happened (`validation/5.8/host-lock/README.md`).

The three failures of run 3, each rerun alone at the time (`rerun-alone.txt` in that folder):

| Test | Alone | Cause | Correction |
|---|---|---|---|
| `v48`: the release notes of the current version exist and are listed | passed | `RELEASE-5.8.md` had not been written yet when the run started | the document exists; no test change |
| `v54`: desktop publishes complete large progress JSON and remains cancellable | failed again | the test started a study with a budget of 100,000,000 deals per seed and cancelled it. 5.8 refuses that budget when the study is configured (the purpose of the change, section 6), so the study the test wanted to cancel never started | the test's budget is now 10,000,000, the largest the engine supports; what it tests (large progress documents, cancellation) is unchanged |
| `v571`: 5.7.1 against the unchanged 5.7 binary | failed again | two assertions compared the running program's version with the literal `5.7.1` | they now read `source/VERSION`; the comparison with the 5.7 binary is unchanged |

Both corrected tests were wrong about 5.8, not weakened: the engine behaviour they met is the intended one. They are
listed in BUILD-5.8.md as changed files, and their change is why the build identifier changed between runs 3 and 4.

### 2.2 The recurring load-sensitive failures: root cause found

Since 5.6, full regression runs had occasionally failed one checkpoint test of the desktop host (a different one
each time, always passing alone). Previous releases recorded them as load-sensitive. In 5.8 the cause was found, in
the program and not in the tests: the host released its checkpoint lock **after** sending the answer, so a client
that sent its next checkpoint request immediately could be refused (409 or 503) by a host that had already finished.

| Step | Evidence (`validation/5.8/host-lock/`) | Result |
|---|---|---|
| reproduce deterministically on the unmodified 5.7.1 source (250 ms of work inserted between answer and unlock) | `reproduction-host.patch`, `reproduction-5.7.1-order.tap` | refused every time: "Another checkpoint operation is active" (409) |
| repair: release the lock before the first byte of the answer | `repair.patch` | — |
| the same 250 ms with the repair | `repaired-host.tap` | four write-then-restore rounds accepted; a write and a restore are still refused while another write is really in progress |
| regression test | `v58.test.js`: "after an answered checkpoint request the next one is accepted at once" | passed (Linux, Wine, AddressSanitizer) |

No timeout was raised and no test was relaxed. `source/tests/load_sensitive.json` is unchanged; its entries about
solver jobs have other causes and were not investigated in 5.8 (none of them failed in the final run).

## 3. Self-tests (Linux)

| Self-test | Checks | Passed | Failed | Untested | Evidence |
|---|---|---|---|---|---|
| `mwcli --selftest58` (new) | 33 | 33 | 0 | 0 | `validation/5.8/selftest/selftest58-linux.json` |
| `mwcli --selftest571` (checkpoint integrity and memory budget, 5.7.1) | 24 (and 4 controls of the verdicts) | all | 0 | 0 | `selftest571-linux.json` |
| `mwcli --selftest57` | 28 | 28 | 0 | 0 | `selftest57-linux.json` |

The 33 checks of `--selftest58` are listed one by one in WINDOWS-TESTS-5.8.md, section 1. What each shows:

| Section | Checks | Shows |
|---|---|---|
| engine E1, E2 | 2 | the evaluation generator reproduces published SplitMix64 outputs; 321,000 block streams are distinct |
| engine E3, E4 | 2 | 50,400 cached ICM values equal the uncached recursion bit for bit (25,605 hits, 20,484 evictions); three-player ICM equals the formula |
| response life-cycle | 1 | wrong order of calls and malformed requests are refused (409 / 400) |
| response R1 to R6 on four shipped fixtures | 24 | the response state holds the trained strategy exactly; the other seats are frozen exactly; exact response gain <= exact best-response gain; the estimate contains the exact gain; same bits for 1 and 3 threads and for a second run |
| limits L1 to L4 | 4 | 10,000,001 deals refused in under a millisecond with no checkpoint created; 640,000,001 at 64 deals per update refused; the largest budgets accepted; the command-line trainer refuses before reading its input |

## 4. The trained response: mathematical validation (class 1)

MATHEMATICAL-VALIDATION-5.8.md has the proofs and the full tables. In summary:

| Check | Result | Evidence |
|---|---|---|
| direction: a trained-response gain never exceeds the exact best-response gain | 0 violations in 1,120 seat gains (130 states, 14 games, two response budgets) | `validation/5.8/convergence/response/` |
| the response state reproduces the trained state's exact NashConv | largest difference 7.6e-15 | the same |
| the estimate from independent deals | exact gain outside the distribution-free interval: 0 of 1,120; beyond 3 standard errors: 15; beyond 4: 0 | the same |
| the estimate with **sampled** opponent actions (the walk large fixtures use) | exact gain outside the distribution-free interval: 0 of 98; **the normal interval failed on the eight-handed ICM game** (table below) | `validation/5.8/convergence/sampled-actions/` |
| is that estimator unbiased? (120 independent evaluations on the game where it failed) | no bias indicated (largest t 1.31); 960 of 960 exact gains inside the distribution-free interval; 193 of 960 single estimates beyond four reported standard errors | `validation/5.8/convergence/unbiased/` |
| an independent Python implementation | 8 of 8 cases, 21 seats: stored probabilities identical, exact values agree to 1.8e-15, direction holds | `validation/5.8/independent/` |
| mutations: the self-test run by 10 deliberately broken engines | all 10 detected by the expected checks; the control passes | `validation/5.8/mutation58.json` |

Estimate with sampled opponent actions against the exact gain of the same response (plan: `plan.json`; 22 states, 98 seat estimates, all with sampled actions):

| Game | Seat estimates | Exact gain outside the distribution-free interval | Beyond 3 reported standard errors | Beyond 4 | Largest distance (reported standard errors) | Estimates below / above exact |
|---|---|---|---|---|---|---|
| hu-turn | 4 | 0 | 0 | 0 | 1.7 | 2 / 2 |
| river3-chip | 6 | 0 | 0 | 0 | 1.4 | 5 / 1 |
| turn4 | 8 | 0 | 0 | 0 | 1.1 | 4 / 4 |
| flop5 | 10 | 0 | 0 | 0 | 2.0 | 4 / 6 |
| flop6 | 12 | 0 | 0 | 0 | 1.8 | 6 / 6 |
| flop6w | 12 | 0 | 0 | 0 | 1.7 | 6 / 6 |
| mid3-turn | 6 | 0 | 0 | 0 | 1.2 | 4 / 2 |
| final8 | 16 | 0 | 8 | 8 | 1183.1 | 10 / 6 |
| bubble4 | 8 | 0 | 0 | 0 | 1.5 | 3 / 5 |
| bubble5-icm | 10 | 0 | 1 | 1 | 12.6 | 5 / 5 |
| sidepot3-icm | 6 | 0 | 0 | 0 | 1.2 | 4 / 2 |
| **all** | 98 | 0 | 9 | 9 | 1183.1 | |

## 5. Training identity against the unchanged 5.7.1 binary (class 1)

`validation/5.8/identity/`: 225 cases, 1,782 training runs, **0 differences** in the state files (the ten reference
games of 4.8 and five shipped fixtures; default trainer and frozen batches in several configurations; 1 to 16
threads offered; trained in one piece and saved and continued; two cases with table budgets of 1 and 2 MiB that
stop training early). `v58.test.js` repeats eight games against SHA-256 values recorded from the
5.7.1 binary. The convergence experiment (CONVERGENCE-5.8.md, section 4) compared checkpoint files again, on other
seeds.

Consequences: the default trainer is unchanged; checkpoint compatibility is unchanged (a 5.7.1 solver state
continues under 5.8 to the same bytes; a 5.7.1 *study* checkpoint is refused with the reason, as every release since
5.5 refuses the study checkpoints of another build — tested in `v571.test.js`).

## 6. The large-study limit

| Check | Result | Class |
|---|---|---|
| a study above 10,000,000 updates is refused when configured, nothing trained, no checkpoint directory | self-test L1, L2; `v58.test.js`; desktop host through `v54.test.js` | 2 |
| the largest supported budgets are accepted | self-test L3 | 2 |
| the same through the desktop host | refused in 6 ms; the error appears in the study status ("study budget too large ... Nothing was trained"); no manifest and no engine state written; **the folder the host creates for a new study is left behind holding only `request.json`** (not listed among saved studies, harmless, removable; the same happens for any configuration error since 5.5); an ordinary study afterwards completes (`validation/5.8/limits/host-refusal.json`, 4 of 4 checks) | 2 |
| accounting types are adequate at the limit | reviewed in the source; MATHEMATICAL-VALIDATION-5.8.md, section 5 | 2 (review, not a test at the limit) |
| random streams do not repeat within the limit | measured draws per deal on every shipped fixture: MATHEMATICAL-VALIDATION-5.8.md, section 6.3 | 2 |
| a full training of 10,000,000 updates | **not executed** in 5.8 (hours per fixture on the development machine); the 5.7 stability run reached the limit and is where the late failure was found | 4 |

The limit was **not raised**: section 5 of the mathematical validation explains why (a 32-bit generator; a longer
one changes every trained state).

## 7. Sanitizers

`validation/5.8/sanitize58.sh`; outputs in `validation/5.8/sanitizers/`. Summary file, verbatim:

```
asan build exit 0
asan tests (5.8 file) exit 0
asan tests (5.5 and 5.6 files) exit 0
asan tests (5.7.1 file, the five checkpoint tests) exit 0
asan selftest58 exit 0
asan selftest571 (checkpoint mode) exit 0
tsan build exit 0
# tests 15 # pass 15 # fail 0 # skipped 0 (v58-asan-ubsan)
# tests 31 # pass 31 # fail 0 # skipped 0 (v55-v56-asan-ubsan)
# tests 5 # pass 5 # fail 0 # skipped 0 (v571-asan-ubsan)
sanitizer reports (ERROR: AddressSanitizer / runtime error) in all outputs: 0
ThreadSanitizer warnings: 0
frozen-batch training on four threads exit 0
six seats, three side by side, four threads each exit 0
ICM frozen-batch training exit 0
ICM response, four seats side by side exit 0
ICM study, three seeds side by side exit 0
selftest58 (engine) exit 0
[passed] limits L4: the command-line trainer refuses 10,000,001 updates before it reads its input -- exit 2; error: iterations must be a whole number from 0 to 10,000,000
selftest58 (limits) exit 0
response bits of the instrumented program equal the release program: True (6 seats)
leak check: --response with parallel seats exit 0 (0 expected), refused over-limit study exit 1 (1 expected); LeakSanitizer reports: 0
```

What was instrumented: AddressSanitizer + UndefinedBehaviorSanitizer (with float-cast-overflow) builds of the desktop
host and the command line, running the whole 5.8 test file, the 5.5 and 5.6 files (study checkpoints, recovery,
the host lock), the five checkpoint tests of the 5.7.1 file, `--selftest58` (all sections) and `--selftest571`
(checkpoint mode); a ThreadSanitizer build of the command line running response training and evaluation with seats
and threads side by side, ICM training and an ICM study with seeds side by side; LeakSanitizer on a complete
`--response` run and on a refused over-limit study.

Not instrumented: the CUDA code (no GPU), the Windows executables (MinGW has no sanitizer runtime), the browser
interface, and the test files older than 5.5 (they ran under sanitizers in the releases that added them and their
code paths did not change).

## 8. Reproducible build, static checks, package

| Check | Result | Evidence |
|---|---|---|
| the final source built a second time in another directory | all 7 artifacts byte-identical (three Windows executables, three Linux programs, the interface) | `validation/5.8/baseline/reproducible-build-5.8.json` |
| `verify_build.js` on the release root | "Verified the executables, interface and source: d4001e2c0cd77f41" | run by the packager |
| package: clean extraction, manifest, smoke tests | see `EightMax-Windows-5.8.identity.json` (`package` and `smoke`), written by `validation/5.8/release58.py` | RELEASE-5.8.md has the hashes |

## 9. The Windows executables under Wine (class 2)

`validation/5.8/wine58.sh`; outputs in `validation/5.8/wine/`. Wine 9.0; `mwcli.exe` and `EightMax.exe` of the final
build (`build-id.txt`: `d4001e2c0cd77f41`; hashes in `executables.sha256`). Wine is not Windows: this shows that the
Windows executables compute the same numbers as the Linux build, not that they work on a Windows PC.

| Check | Result |
|---|---|
| `mwcli.exe --selftest58` | 33 of 33 passed |
| `mwcli.exe --selftest571` | every check passed in this run |
| `mwcli.exe --selftest57` | 28 of 28 passed |
| seven reference games: trained state, estimated gain, exact gain, exact best-response gain of every seat, seats one after another and side by side | **bit-identical to the Linux build** in all 7 |
| `v58.test.js` with the Windows programs | 15 of 15 passed |
| `v57.test.js` | 9 of 9 passed |
| `v56.test.js` | 15 of 15 passed |
| `v571.test.js` | 13 of 14 passed, **1 failed** in the run that shared the machine with two other jobs; it passed when rerun alone: see below |
| `v55.test.js` | 15 of 16 passed, **1 failed**, and failed again alone (a Wine-only limitation documented since 5.7.1): see below |

The two failures, each rerun alone afterwards (`validation/5.8/wine/rerun-alone.txt`, `v571.rerun-alone.tap`,
`v55.rerun-alone.tap`):

| Test | In the full Wine run | Alone | Assessment |
|---|---|---|---|
| `v571`: "selftest571 modes and usage: checkpoint and memory run alone" | failed: memory check A reported "the condition this check is about was not produced" (the 48 MiB budget was not reached: Wine reported a peak working set of 47.7 MiB) while two other heavy jobs shared the machine; checks B and C then "untested" | **passed** | load-dependent under Wine: the check needs the process to exceed 48 MiB of working set, and what Wine reports as working set depends on what else the machine is doing. The check did what it is designed to do — it refused to count a stop that did not happen as a pass. The same self-test passed 24 of 24 in the three other Wine runs of this release (the full self-test run, the alone rerun, and the full-validation launcher of section 9.1). It passes on Linux. Whether it passes on Windows is for the physical run to show |
| `v55`: "5.5 desktop: studies are checkpointed, listed, resumed after Stop and after the host process is killed, and discarded, without the command line" | failed: `assert.ok(fs.existsSync(path.join(dir, 'request.json')))` | **failed again** (now on the saved-study list not being empty at the start: it found the study the first run had left) | a limitation of running this test through Wine, not of the program: the test gives the host a private save folder through HOME and USERPROFILE; under Wine the host uses the Wine profile's Documents folder instead, so the folder the test reads stays empty and a second run finds the first run's study. VALIDATION-5.7.1.md, section 10, documents the same two symptoms for the unmodified 5.7 and 5.7.1 programs (control run there). On Linux the test passes, also under AddressSanitizer |

`gpustress.exe` under Wine: start-up and `--build-id` only (the packager's smoke test); it has no CUDA device to use.

### 9.1 The launchers under Wine's command interpreter

The three `.bat` files were run by `wine cmd /c` in scratch copies of the release
(`validation/5.8/wine/launchers-under-wine-cmd.md`). Wine has no real PowerShell (its `powershell.exe` is a stub that
does nothing and ends with status 0), so the validation script did not execute; the steps that need no PowerShell did.

| Launcher | Result |
|---|---|
| `Run 5.8 response example.bat` | exit 0, result document written |
| `Run 5.8 focused validation.bat` as first written | self-test 33 of 33; then **announced "Every required check of the script passed" although the script had written no report** |
| the same, corrected, with a stale report planted | stale report deleted; self-test 33 of 33; script result status 2, "nothing of the script is counted as passed" |
| `Run 5.8 Windows validation.bat`, corrected | `--selftest57` 28 of 28, `--selftest571` 24 of 24, `--selftest58` 33 of 33, three report files written; script result status 2 |

**Defect found and corrected:** a launcher took PowerShell's exit status as the validation result, so a PowerShell
that ended with 0 without running the script counted as a pass. Both launchers now delete earlier report files at
the start and return status 2 when the script's JSON report is missing afterwards. The launchers are outside the
source fingerprint; the build identifier did not change. The launchers of 5.7.1 and earlier have the same weakness
and were left as shipped.

## 10. Windows, PowerShell, GPU, CI: not executed (class 3)

| Item | Status | Why |
|---|---|---|
| any 5.8 program on Windows hardware | **not executed** | no Windows machine was available to the development session |
| `validate_windows58.ps1` | **never executed**; static checks only | downloading and running PowerShell in the development container was refused by the session's permission policy. This was not worked around |
| CUDA / any GPU code path | **not executed** for 5.8 | no NVIDIA GPU. No CUDA code changed in 5.8; the evidence on record is the 5.7 run on the target PC (`validation/5.7.1/windows-5.7-physical/`), which is not a 5.8 result |
| GitHub Actions Windows workflow (`.github/workflows/windows.yml`) | **not executed** | the session had read access to the repository only; a request for push access was refused by the same policy. The workflow file is updated for 5.8 and will run on the first push that includes it |
| full Windows/GPU validation of 5.7.1 | **never reported** (only the focused one: 36 passed) | a full run of the 5.8 script contains every check of the 5.7.1 full script, so one run closes both gaps |

Static checks of the script and launchers (`validation/5.8/powershell/static-checks.json`): the project's linter
(`ps_lint571.py`: balanced quotes, brackets and here-strings; no syntax newer than Windows PowerShell 5.1; no
undefined command; no variable read before assignment) reports 0 findings; 484 of the script's 559 code lines are
taken unchanged from the 5.7.1 script, 75 are new or changed (sections 10 and 11). The three launchers are ASCII
with CRLF line ends. `v58.test.js` checks that the script plans and imports every 5.8 check and that the launchers
run the self-tests before PowerShell. **A linter is not a parser and neither is an execution**: expect that the
first real run may find a defect in sections 10 and 11 of the script. For that reason every launcher runs
`mwcli.exe --selftest58` first and writes its report without PowerShell (WINDOWS-TESTS-5.8.md).

Expected totals of the script if every check passes, **counted from the script, not from a run**: focused 54, full
151.

## 11. Experiments, performance, interface, stability

| Item | Result | Where |
|---|---|---|
| lower-bound measures against exact NashConv (prespecified) | completed; one interruption by the job time limit, continued by `--resume` | CONVERGENCE-5.8.md, section 2 |
| trained response on the shipped realistic fixtures (prespecified) | 36 of 36 planned cells measured, 0 errors | CONVERGENCE-5.8.md, section 3 |
| convergence against the 5.7.1 binary, ten games, 20 seeds (prespecified) | completed, 1600 rows; verdicts: 20 identical, 37 unresolved, 3 worse; identical checkpoint files in 400 of 400 pairs | CONVERGENCE-5.8.md, section 4 |
| six-player flop, 60 seeds (prespecified) | completed, 720 rows; verdicts: 8 unresolved | CONVERGENCE-5.8.md, section 5 |
| training, evaluation and study throughput against 5.7.1 | completed: 10 fixtures (states identical: all), 16 evaluation cases (results identical: all), 8 studies (measurements identical: all) | PERFORMANCE-5.8.md |
| ICM instruction counts (deterministic) | 9 cases, every state identical | PERFORMANCE-5.8.md, section 5 |
| desktop interface driven through a browser against the host | 20 checks: 20 passed, 0 failed (build d4001e2c0cd77f41, Chromium 158.0.8127.36) | `validation/5.8/ui/` (driver: `validation/5.8/study_ui58.js`) |
| stability run of the desktop host (3 minutes) | 12 checks: 11 passed, 1 failed: E0: a study of 20,000,000 deals per seed is refused at once by the desktop host, with the limit in the message, and nothing is saved (build d4001e2c0cd77f41) | `validation/5.8/stability/` (driver: `validation/5.8/stability58.js`) |
| an optimisation that was tried and rejected (compact row offsets) | no measurable gain; reverted | `validation/5.8/experiments/compact-row-offsets.md` |

### 11.1 The interface and stability drivers: first runs that failed, and why

Both were first run with the drivers of earlier releases. Their outputs are kept.

| First run | Result | Cause | What was done |
|---|---|---|---|
| interface, driver of 5.7.1 (`validation/5.8/ui-first-run-with-the-5.7.1-driver/`) | 18 of 20 | (1) the check "the host is 5.7.1" compares with a literal; (2) "a 5.4 result: calibration shown as NO" read the panel before the 5.4 file was rendered: the driver waited for an element that the previously shown study already had (a race in the driver; the run followed the benchmarks on a busy machine) | `study_ui58.js`: the version is read from `source/VERSION`; the driver waits for the text that only a pre-5.5 result produces, and the check still fails if it never appears. Result: 20 of 20 |
| stability, tool of 5.5 (`validation/5.8/stability-first-run-with-the-5.5-tool/`) | 9 of 11 | step E asks for 20,000,000 deals per seed and expects the study to run until its time limit. 5.8 refuses that budget at once — the intended change — so there was no study to observe | `stability58.js`: step E uses 10,000,000, the largest supported budget, and a new step E0 asks for 20,000,000 and expects the refusal |
| stability, `stability58.js` | 11 of 12 | E0 failed on one clause: it required that nothing at all be left in the save folder. The refusal itself was correct (6 ms, the documented message), but the host had already created the study's folder with `request.json` | not rerun to turn it green. The behaviour was characterised separately (`validation/5.8/limits/host-refusal.json`, section 6) and is listed as a limitation: a refused study leaves an unlisted folder holding only its request |

Step E of the stability run with the supported budget: a 133 s study on four seeds stopped at its time limit with 56
checkpoint commits, 708 MiB of engine states written, no write error, and every engine state named by the final
manifest matching its SHA-256.

## 12. Summary by class

| Class | What is in it |
|---|---|
| **1** independently validated | the direction of the trained response (proof; exact values; independent Python); the response state's exactness; the estimate's distribution-free interval (proof; 0 failures); training identity with 5.7.1; cached ICM values |
| **2** tested on Linux / Wine / simulation | regression suite 620 of 621 passed, 1 skipped; the three self-tests; sanitizers; mutations; the early refusal of over-limit studies; the host-lock repair; the Windows executables under Wine, bit-identical reference responses; reproducible build; all performance and convergence measurements (on a 4-processor Linux container, not on the target PC) |
| **3** awaiting physical validation | everything on Windows hardware; `validate_windows58.ps1` and the launchers; all CUDA paths and CPU/GPU agreement for 5.8; thread scaling on the 16-core target; the CI workflow |
| **4** not done or unsuccessful | no upper bound of NashConv for large games; the update limit not raised; no trainer change (none was found that passed validation; the one optimisation tried was rejected); no CUDA optimisation; a full 10,000,000-update training not run; the full 5.7.1 Windows validation still unreported |
