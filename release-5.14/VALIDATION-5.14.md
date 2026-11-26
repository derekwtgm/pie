# EightMax 5.14: validation

Build `57befd67c7c86ebe`. "Development machine": an Ubuntu 24.04 container with 4 processors. "Runner": a hosted GitHub
Actions machine. Nothing here ran on the target PC or on a GPU. Decision rules: `validation/5.14/plan.json` and the
`plan.json` each equal-time run writes; all written before the confirmatory runs. The equal-time results themselves
are in CONVERGENCE-5.14.md.

## 1. Baseline: 5.13, before any change

The source in the delivered 5.13 archive (SHA-256 `e9ce4400...9ef7c`) was rebuilt on the development machine: all 7 artifacts byte-identical to the delivered files (`validation/5.14/baseline/rebuild-of-5.13.txt`). This rebuild was made during the validation of 5.14, not before the first change; the 5.13 binary every identity run compares against (`mwcli513`) is that same file by SHA-256.

The regression suite and the eight self-tests of 5.13 had run on this machine on the unmodified 5.13 build when it
was released (693 tests: 691 passed, 1 failed, 1 skipped; the failure is `5.3 timed CLI reproduction`, which expects
a time-limited study not to finish and fails here for 5.11, 5.12 and 5.13 alike; the skip is a permissions test that
cannot work as root; self-tests 28 / 24 / 33 / 32 / 21 / 26 / 8 / 14, all passed), and the delivered archive passed
both launchers on the runner (WINDOWS-CI-5.13.md). They were not run a second time before Phase 4 began.

## 2. The default trainer and `rbes` are untouched

| Check | Result |
|---|---|
| The unchanged 5.13 binary against 5.14, `tools/identity57.py` | 225 configurations, 1782 trainings, 0 differences |
| The unchanged 5.13 binary against 5.14, every study fixture: default trainer and `rbes`, both kinds of streams, one deal per update and frozen batches on three threads (`identity514.py`) | 176 cases (88 of them `rbes`), 0 different |
| Self-tests 5.7 to 5.13 with their recorded tables untouched | all passed on Linux, under Wine and on Windows Server 2025. One exception, reported as it happened: in the first Linux run, made while four validation jobs shared the machine, `--selftest571` failed its check A and left B and C untested (the study was stopped by the 48 MiB process budget with a peak of 47.7 MiB, where the check requires the peak to have reached the budget). Run alone, the same binary passes all 24 checks, as does the 5.13 binary; both reports are in `validation/5.14/selftest/`. The check measures the process's memory as the operating system reports it and is sensitive to what else runs; 5.14 did not touch it |
| `"pruning":"none"` and a spec without the key | the same state (`--selftest514` P6) |
| The 20 games x 3 arms of the equal-time tool after 20,000 deals, recorded on Linux | reproduced to the last bit under Wine and on the runner (the tool's equal-deals check) |

## 3. Pruning

| Check | Result |
|---|---|
| `nrpc` has the default estimator's expected increments | proof: MATHEMATICAL-VALIDATION-5.14.md, section 3 |
| Frozen-table comparison, four games (`tests/prune514.cpp`) | `nrpc`: 0 entries above the critical value on 4 of 4 games (444, 1654, 193, 180 entries compared); `nrp`: rejected on 3 of 4. Regret variance of `nrpc`: 2.9 to 7.3 times the default's |
| `mwcli --selftest514` (7 checks): 40 recorded states, headers, 1 / 2 / 4 threads, stop and continue, refusals, `none` | 7 passed on Linux, under Wine, on Windows Server 2025 |
| A fresh recording of the self-test's tables | recording exit 0, 2 of 2 files identical to the shipped ones |
| A pruned state continued by the default trainer, by `rbes`, with other settings, by the 5.13 program | refused each time, with the reason, nothing written (`tests/v514.test.js`, `--selftest514` P5) |
| Combinations that were never run (`rbes`, enumeration, DCFR, RM+, batch schedule, representative groups, stratified deals) | refused when the spec is read |
| A 5.13 program given a spec with `"pruning"` | **trains the default and says nothing** (it does not know the key). Documented in RELEASE-5.14.md; the state it writes is a correct default-trainer state |

**What the frozen-table test is worth.** It compares mean increments per table entry between estimators on a frozen
table (one Bonferroni statement per game and estimator). For `nrpc` no entry is above the critical value on any of
the four games (the closest: mid3-turn, 4.13 against 4.17). The same test rejects `nrp` on three of the four games
(3, 8 and 10 entries, z up to 598), which is the bias `nrp` has by construction and shows that the test can see
one. It is a check of the implementation of the correction, not a measurement of what the bias costs.

## 4. The grouped merge

| Check | Result |
|---|---|
| Frozen batches on three threads, every fixture, both trainers, against 5.13 | in the identity runs of section 2 |
| `--selftest514` G1: 1, 2, 3 and 4 threads against recorded states, default trainer and `rbes` | passed (Linux, Wine, runner) |
| ThreadSanitizer on batch trainings | 0 reports; ThreadSanitizer 0 warnings on seven frozen-batch trainings with four threads (default, `rbes`, both pruning algorithms), 7 of 7 states equal to the release program on one thread; LeakSanitizer 0 reports |

## 5. The equal-time tool

| Check | Result |
|---|---|
| A fresh recording of its reference values | recording exit 0, 2 of 2 files identical to the shipped ones |
| Quick trials (`--quick`) of both parts on Linux | pruning: exit 0, equal-deals check passed; threads: exit 0, equal-deals check passed |
| `eqtime.exe` under Wine and on the runner: build identifier; quick trial with the equal-deals check | Wine: eqtime.exe --build-id exit 0 (EightMaxBuild=57befd67c7c86ebe); eqtime.exe pruning --quick exit 0 (1 equal-deals check passed); eqtime.exe threads --quick exit 0 (1 equal-deals check passed); eqtime.exe scaling --quick exit 0. Runner: build identifier equal; quick trials 9 of 9 and 4 of 4 values identical to the Linux build |
| The statistic of the Linux runs recomputed from `raw.jsonl` by another implementation (`validation/5.14/convergence/independent_statistic.py`: Python, its own Student-t quantile) | 92 contrasts, 144 intervals: ratios and bounds equal to the 6 digits the tool prints, 0 verdicts different |
| Linux confirmatory runs | 2,460 + 312 rows, 0 errors, every seed valid; equal-deals checks 60 of 60 and 24 of 24 |

## 6. Regression suite (`validation/5.14/tests/`)

| | 5.13, this machine | 5.14, this machine |
|---|---|---|
| Tests | 693 | 701 (the 8 of `v514.test.js` are new) |
| Passed | 691 | 700 |
| Failed | 1 | 0 |
| Skipped | 1 | 1 |

Failed in 5.14:

* none. `5.3 timed CLI reproduction`, the one failure of 5.11 to 5.13 on this machine, passed in this run. It expects a time-limited study not to finish; the suite ran while the long satellite check used one processor, which is the likely reason (not examined). The test is unchanged and nothing about it was repaired.

Skipped in 5.14:

* `4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissi` - running as root: permissions are not enforced


The suite ran while three other validation jobs used the machine.

## 7. Unchanged code, run again

| | Result |
|---|---|
| Fixture generator `--check`; `studies/` equals `source/studies` | 22 identical; equal (exit 0) |
| The satellite model against its independent implementation (rules A and C of 5.13) | rules met again: largest difference 2.1e-14 on 240 small fields, 2.0e-10 on 42 large fields; field summaries as in 5.13 (up to 0.348 average-only, 0.106 three groups) |
| Satellite controls and table switch in Chromium; 8-max library views against the 5.12 page | 12 of 12 and 21 of 21 checks |
| Study tab against the desktop host; refused studies | 20 of 20 checks passed; refused studies: exit 0 |

## 8. Sanitizers, Wine, runner, build

| | Result |
|---|---|
| Sanitizers (address, undefined behaviour; thread; leak) | 0 reports; ThreadSanitizer 0 warnings on seven frozen-batch trainings with four threads (default, `rbes`, both pruning algorithms), 7 of 7 states equal to the release program on one thread; LeakSanitizer 0 reports |
| Windows programs under Wine | every step exit 0: nine self-tests, reference states with 1, 2 and 4 threads, the satellite bits, `eqtime.exe` quick trials, the 5.14 test file through `mwcli.exe` |
| Both launchers and the equal-time quick trial on a hosted Windows runner, pre-release tree | focused 106 passed, 1 failed, 0 skipped, 0 untested (345.1 s); full 299 passed, 1 failed, 1 skipped, 0 untested (962.7 s); equal-time quick trial exit 0 (equal-deals checks 9 of 9 and 4 of 4); the one failure is the manifest a pre-release tree does not have; the skip is the GPU section |
| The same on the delivered archive | WINDOWS-CI-5.14.md beside the ZIP |
| Two builds in two directories | 9 of 9 artifacts identical |

The pre-release tree has no `SHA256SUMS.txt`, so its manifest check fails by construction; that check is exercised
by the delivered archive.

## 9. Not validated

* The target PC; an NVIDIA GPU; more than 4 processors (every thread result here is from 4).
* Pruning on any game without an exact NashConv, and on trees with many actions per decision.
* Whether any ordering at 1 s or 4 s holds for long trainings.
* Pruning combined with anything in the list of refusals.
* The interface on Windows (unchanged since 5.13, where it was not looked at either).
* The in-tree MSYS2 workflow: updated, not run.
