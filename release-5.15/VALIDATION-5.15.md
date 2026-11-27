# EightMax 5.15: validation

Build `87b9f6e38b735cfb`. "Development machine": an Ubuntu 24.04 container with 4 processors. "Runner": a hosted GitHub
Actions machine. Nothing here ran on the target PC or on a GPU. Decision rules: `validation/5.15/plan.json`, written
before the runs. The measurements themselves are in CONVERGENCE-5.15.md; what the model is, in
MATHEMATICAL-VALIDATION-5.15.md.

## 1. Baseline: 5.14, before any change

The delivered 5.14 archive (SHA-256 `434e05cd...3485`) was extracted into an empty folder and its source rebuilt on
the development machine **before the first change of Phase 5**: all 9 artifacts byte-identical to the delivered files (`validation/5.15/baseline/`).
On that rebuilt tree:

* the nine self-tests (5.7 to 5.14): all exit 0. (`--selftest57` was first started with a folder that does not exist
  and returned a usage error; started again with the right folder it passed 28 of 28. Both are in the record.)
* the regression suite: 701 tests, 699 passed, 1 failed, 1 skipped. The failure was mine: the ZIP was extracted
  without execute permissions, so the test that starts the 5.13 Linux program could not start it. With the
  permission restored that test passes. The skip is a permissions test that cannot work as root. The timed test
  `5.3 timed CLI reproduction`, which fails on this machine when it is idle, passed (other jobs were running).

## 2. Nothing that trained before trains differently

| Check | Result |
|---|---|
| The unchanged 5.14 binary against 5.15, `tools/identity57.py` | 225 configurations, 1782 trainings, 0 differences |
| The unchanged 5.14 binary against 5.15, every study fixture without the model (the 22 of 5.14; the four new ones as plain ICM): default trainer and `rbes`, both kinds of streams, one deal per update and frozen batches on three threads (`identity515.py`) | 208 cases (104 of them `rbes`), 0 different |
| Self-tests 5.7 to 5.14 with their recorded tables untouched | all passed on Linux (28 / 24 / 33 / 32 / 21 / 26 / 8 / 14 / 7 checks); under Wine: every one exit 0; on the hosted Windows runner: every one passed, inside both launchers |
| The equal-time tool of 5.14: a fresh recording of its reference values; quick trials | recording exit 0, 2 of 2 files identical to the shipped ones; pruning: exit 0, equal-deals check passed; threads: exit 0, equal-deals check passed |
| The 22 fixtures of 5.14 | regenerate byte for byte (`fixtures52.js --check`: 26 identical; `studies/` equals `source/studies` (exit 0)) |

## 3. The payoff model

| Check | Result |
|---|---|
| R1 a to d | MATHEMATICAL-VALIDATION-5.15.md, section 4: **met**: largest difference 1.4e-13 on 16 outcomes without and 34 future hands with simulation; a player gains at most 3.2e-06 of the unit by deviating in a future hand |
| `mwcli --selftest515` (12 checks) | 12 passed on Linux, under Wine and on Windows Server 2025 (12 of 12, twice; and the training section twelve more times) |
| A fresh recording of the self-test's three tables | recording exit 0, 3 of 3 files identical to the shipped ones |
| The data table of the native push/fold game | equals the generator's output (`gen_pf515.js --check`, exit 0) |
| One state for every thread count; stop and continue | `--selftest515` T2; ThreadSanitizer run below |
| A state of the model continued by the plain ICM study, a plain state continued under the model, other bounties, another number of future hands | refused each time with the reason, nothing written (`--selftest515` C2, `tests/v515.test.js`) |
| The programs of 5.10 to 5.14 given a spec of the model, and a state of the model under the plain spec | refused by every one of them (5.14, 5.13, 5.12, 5.11, 5.10), nothing written |

**A defect found on the Windows runner and removed.** The first pre-release build passed everything on Linux and
under Wine, and on the runner its self-test check T2 failed in three of four runs: a training with future hands,
continued on three threads, ended with the Windows status 0xC0000374 (heap corruption) instead of writing a state. A
diagnostic job repeated the training section: 3 of 6 runs failed, always in a continued three-thread training with
future hands, never elsewhere. The model kept the scratch memory of its ICM routine in thread-local vectors; that was
the only memory of the new code tied to a thread. With plain local buffers instead, the same job passed 12 of 12
(`windows-ci/` beside the ZIP has the three logs). No value changed (the recorded bits and states are the same). What
is established: the status disappeared with that change. What is not: why thread-local vectors fail with this
toolchain; and twelve clean runs do not prove absence. Neither Linux, Wine, the address sanitizer nor the thread
sanitizer showed anything, before or after: **only real Windows found it.**

**Why earlier programs refuse the spec.** 5.13 and 5.14 refuse an unknown `icm.model`. The programs before 5.13 do
not read that key, so the model's spec carries its prizes under `"prizes"` instead of `"payouts"`: without
`"payouts"` they report an invalid ICM configuration instead of training a plain ICM study in silence. (This is the
lesson of 5.14, where an older program ignores the pruning key.)

## 4. Training under the model

| Check | Result |
|---|---|
| R2 (exact NashConv, six games, five seeds, three budgets) | **NOT MET**: 28 of 32 pairs pass; failing: bubble4 pko (FAIL), bubble4 ko (FAIL), bubble4 fgs1 (FAIL), bubble4 pko+fgs1 (FAIL) |
| Studies of the two small fixtures, complete (`mwcli --study`) | pko6-bb-call-small: exit NOT RUN, complete; fgs4-bubble-bb-call-small: exit NOT RUN, complete |
| Studies of the two large fixtures, two seeds and short budgets (a run, not a result) | pko6-bb-call: exit 0; fgs4-bubble-bb-call: exit 0 |

## 5. The interface

| Check | Result |
|---|---|
| Bounties and future hands in Chromium (`tools/tour_ui515.js`): the calculator's controls and limits, a solve through the page, push/fold to study, the study form, the Study list, the fixtures rebuilt from their form state | 14 of 14 checks |
| The satellite test of 5.13, run unchanged | 11 of 12 checks (the one that counts three groups fails, see below) |
| Table-size switch and 8-max library views against the 5.12 page | 21 of 21 checks |
| Study tab against the desktop host; refused studies | 20 of 20 checks passed; refused studies: exit 0 |
| The JavaScript engine trains with bounties (who won a pot comes from the pot list) | `tests/v515.test.js` |

The satellite test counts the groups of the Study list and expects three; 5.15 has four ("Bounties and future
hands"). That one check fails by construction. The test was left as it ran for 5.13; its other checks pass.

## 6. Regression suite (`validation/5.15/tests/`)

| | 5.14, this machine (baseline of section 1) | 5.15, this machine |
|---|---|---|
| Tests | 701 | 708 (the 7 of `v515.test.js` are new) |
| Passed | 699 (700 with the permission restored) | 707 |
| Failed | 1 (an extraction mistake of mine, section 1) | 0 |
| Skipped | 1 | 1 |

Failed in 5.15:

* none

Skipped in 5.15:

* `4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissi` - running as root: permissions are not enforced

The suite ran while other validation jobs used the machine; `5.3 timed CLI reproduction` passed in this run (it depends on how much the machine does within its time limit).

## 7. Sanitizers, Wine, runner, build

| | Result |
|---|---|
| Sanitizers (address, undefined behaviour; thread; leak) | 0 reports of the address and undefined-behaviour sanitizers; ThreadSanitizer 0 warnings on 8 frozen-batch trainings with four threads (bounties; one, two and three future hands; default and `rbes`), 8 of 8 states equal to the release program on one thread; LeakSanitizer 0 reports |
| Windows programs under Wine | every step exit 0: ten self-tests, the reference states of 5.15, 5.13 and 5.12 with 1, 2 and 4 threads, the bits of `mwcli --tour515` and `--satfield`, `eqtime.exe` quick trials, the 5.15 test file through `mwcli.exe` |
| Both launchers on a hosted Windows runner, pre-release tree | focused 126 passed, 1 failed, 0 skipped, 0 untested (574.7 s); full 319 passed, 1 failed, 1 skipped, 0 untested (1266.9 s); `--selftest515` 12 of 12 in both launchers; the one failure is the manifest a pre-release tree does not have; the skip is the GPU section (run 45916776925, Windows Server 2025, AMD EPYC 7763, 4 logical processors, Windows PowerShell 5.1) |
| The same on the delivered archive | WINDOWS-CI-5.15.md beside the ZIP |
| Two builds in two directories | 9 of 9 artifacts identical |

The pre-release tree has no `SHA256SUMS.txt`, so its manifest check fails by construction; that check is exercised
by the delivered archive.

## 8. Not validated

* The target PC; an NVIDIA GPU; more than 4 processors.
* Whether the model describes a real tournament: the pool rule, push/fold future hands, and the equity table they
  use (MATHEMATICAL-VALIDATION-5.15.md, sections 3 to 6).
* Future hands at tables of six to eight inside a trained study beyond the short runs above: they work and are slow.
* Bounties or future hands together with the satellite-field model of 5.13: not offered (a spec names one model).
* Future hands for postflop studies through the form (the native spec takes a table order; the form offers future
  hands for preflop studies only).
* The interface on Windows (WINDOWS-TESTS-5.15.md, section 4, lists what to look at).
* The in-tree MSYS2 workflow: updated, not run.
