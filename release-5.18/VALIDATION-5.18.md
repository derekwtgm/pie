# EightMax 5.18: validation

Build `23205cbc12cae290`. "Development machine": an Ubuntu 24.04 container with 4 processors and no GPU. "Runner": a hosted
GitHub Actions machine. Nothing here ran on the target PC or on a GPU. Decision rules: `validation/5.18/plan.json`.
The comparisons are in CONVERGENCE-5.18.md; what a translated strategy is and what follows from that, in
MATHEMATICAL-VALIDATION-5.18.md.

## 1. Baseline: 5.17

The delivered 5.17 archive (SHA-256 `c46b7e82...8eb0`) was extracted into an empty folder and its source rebuilt on
the development machine: all 9 artifacts byte-identical to the delivered files (`validation/5.18/baseline/`). On that rebuilt tree:

* the twelve self-tests (5.7 to 5.17): all exit 0;
* the regression suite: 724 tests: 723 passed, 0 failed, 1 skipped (a permissions test that cannot work as root).

The rebuild was finished and compared before the first change of Phase 8. The self-tests of that separate tree
ended before the first change as well; its regression suite was started then and was still running while I wrote
the new code in the development tree. The baseline tree itself was never touched.

## 2. Nothing that trained before trains differently, nothing that was evaluated before is evaluated differently

| Check | Result |
|---|---|
| The unchanged 5.17 binary against 5.18, `tools/identity57.py` | 225 configurations, 1782 trainings, 0 differences |
| The unchanged 5.17 binary against 5.18, every study fixture (26; two also regrouped as Detailed): default trainer and `rbes`, both kinds of streams, one deal per update and frozen batches | 224 cases (112 of them `rbes`; by grouping: compact 88, detailed 8, detailed (regrouped) 16, exact 112), 0 different |
| Self-tests 5.7 to 5.17 with their recorded tables untouched | all passed on Linux (28 / 24 / 33 / 32 / 21 / 26 / 8 / 14 / 7 / 12 / 6 / 13 checks); under Wine: every one exit 0; on the hosted Windows runner: every one passed, inside both launchers |
| Method `exact-hu`: a fresh recording of the twelve cases of 5.17 against the reference shipped with 5.17; its kernel files | recording exit 0, comparison exit 0 (12 of 12 cases identical to the reference shipped with 5.17); the SHA-256 of `brhu_kernel.h`, `brhu_kernel_src.hpp`, `brhu517.hpp` and `brhu_ocl.hpp` are those of 5.17 (`selftest/engine-files.sha256`) |
| The header of a trained state: written by a function that 5.18 split out of the exporter | the identity rows above compare whole files, header included |
| The equal-time tool of 5.14: a fresh recording of its reference values; quick trials | recording exit 0, 2 of 2 files identical to the shipped ones; pruning: exit 0, equal-deals check passed; threads: exit 0, equal-deals check passed |
| The Ranked grouping of 5.16, JavaScript against native | identical tables in 9 of 9 runs |
| The 26 fixtures | regenerate byte for byte (`fixtures52.js --check`: 26 identical; `studies/` equals `source/studies` (exit 0)) |
| The programs of 5.10 to 5.17: the state each trains for a 5.18 game; a translated state given to each | each of them (5.17, 5.16, 5.15, 5.14, 5.13, 5.12, 5.11, 5.10) trains the state 5.18 trains, refuses the translated state for evaluation and refuses to train from it; 5.18 evaluates it and refuses to train from it |

## 3. The comparisons of the plan

| Rule | Result |
|---|---|
| Units | 45 (a game, a seed and a budget; each with every variant and rule), 0 with an error |
| T0: what must hold | **met**: a strategy in its own tree has the bits of the source in 135 of 135 cases; with a size added and the same fallback in both trees, no seat gains less and every policy value is the same in 540 of 540. With the default fallback (uniform) the second statement is violated in 66 cases, which is what amendment 1 is about |
| T1: the cost of a missing size | nearest: LARGE on 12 of 12 variants; harmonic: LARGE on 12; blend: LARGE on 10, SMALL on 2. The ten sizes outside the tree's sizes (where the three rules coincide) cost 3.2 to 16.2% of the pot a player; the two between tree sizes cost 1.7 to 3.7% under nearest, 1.7 to 4.4% under harmonic and 0.28 to 0.31% under blend |
| T2: the rules against each other; the default | nearest is BETTER than harmonic on 1 variants and WORSE on 0; blend is BETTER than harmonic on 2 variants and WORSE on 0. By the rule the default is **blend**. The three rules give the same strategy on 10 of 12 variants (the size lies outside the tree's sizes) |
| T3: equal time (primary) | against nearest: direct better on 23 of 36 (variant, budget) pairs, translated better on 0, unresolved 0, left out as not equal in time 13; against harmonic: direct better on 23 of 36 (variant, budget) pairs, translated better on 0, unresolved 0, left out as not equal in time 13; against blend: direct better on 22 of 36 (variant, budget) pairs, translated better on 0, unresolved 1, left out as not equal in time 13 |
| T4: how much results move when a size is added | the value of the game: the exact intervals of the two solutions overlap in 60 of 60 (variant, seed) pairs, so no movement of the value is established; the first decision: moved on 10 of 12 variants (by up to 23 points a base action, `ot-flop+f25`); where the added size is available at the first decision it gets 0.5 to 46% of the range |

Amendments: three (CONVERGENCE-5.18.md, section 8). All three were written after something had been seen.

**Mistakes of mine in this phase, for the record.** (1) The plan stated as certain that no seat's gain can fall
when a size is added. It can, by the evaluator's fallback for hands without a row; the self-test found it on three
of fifteen cases the first time it ran (amendment 1). (2) The plan's largest budget was 16,000,000 deals; the
default trainer stops at 10,000,000, which Phase 6 had already met (amendment 2). (3) While setting the default rule
I put a comment in the middle of a line and commented out the rest of it; the build failed. The same slip as in
Phase 7. (4) A refusal said "different ranges" where the hand groupings differed; a test found it. (5) The first
version of a test of mine required the weights of a mapped line to add to 1; they do not when the tree's hand ends
before the real one, and the tool now reports the missing weight.

## 4. What 5.18 adds

| Check | Result |
|---|---|
| `mwcli --selftest518` (8 checks) | Linux: 8 passed, 0 failed; under Wine: 8 passed, 0 failed; on the hosted Windows runner: 8 of 8 checks passed, twice |
| A fresh recording of its cases against the shipped reference | recording exit 0, comparison exit 0 (34 of 34 recorded items identical to the shipped reference) |
| The rule, native against JavaScript | the 192 recorded rows bit for bit in both (`--selftest518` M1; `tests/v518.test.js`) |
| A translated state is one file | written twice: the same SHA-256 (`tests/v518.test.js`); the SHA-256 recorded on Linux under Wine and on the runner (T3) |
| Refusals | training from a translated state; translating one; different games, groupings, an unknown rule; an altered header; the JavaScript engine (`--selftest518` T6; `tests/v518.test.js`) |
| Three seats | translation, and gains not below the source under method `exact` (`--selftest518` T4, T5; `tests/v518.test.js`) |
| `mwcli --offtree` | 14 recorded lines; nine kinds of impossible line refused |

## 5. The interface

5.18 adds one control: in the strategy explorer of the desktop program, a field for a bet or raise the tree does
not have.

| Check | Result |
|---|---|
| The explorer field, in Chromium against the desktop host: a river study solved by the host, the three rules between two sizes, below the smallest size, refusals, following the mapped action, a raise | 11 of 11 checks |
| The Ranked grouping (5.16) | 8 of 8 checks |
| Bounties and future hands (5.15) | 14 of 14 checks |
| The satellite test of 5.13 | 11 of 12 checks (the one that counts three groups fails: there are four since 5.15; the test is run as it was written) |
| Table-size switch and 8-max library views against the 5.12 page | 21 of 21 checks |
| Study tab against the desktop host; refused studies | 20 of 20 checks passed; refused studies: exit 0 |

The satellite test counts the groups of the Study list and expects three; there are four since 5.15. That one check
fails by construction; the test is left as it ran for 5.13.

## 6. Regression suite (`validation/5.18/tests/`)

| | 5.17, this machine (baseline of section 1) | 5.18, this machine |
|---|---|---|
| Tests | 724 | 733 (the 9 of `v518.test.js` are new) |
| Passed | 723 | 731 |
| Failed | 0 | 1 |
| Skipped | 1 | 1 |

Failed in 5.18:

* `5.10 processing modes: rbes beside the CUDA scoring route (simulated driver): CPU Only, Automatic, Hybrid and `

Skipped in 5.18:

* `4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissi` - running as root: permissions are not enforced

The one failure is a timing decision: the test expects the scheduler to choose Hybrid after measuring the simulated driver, and it chose "CPU after measuring CUDA" while the final checks of this release were running on the same four processors. Run alone on the idle machine afterwards, the same test passed (`validation/5.18/tests/rerun-v510.tap`). The state it writes was not in question; the suite was not run a second time in full.


## 7. Sanitizers, Wine, runner, build

| | Result |
|---|---|
| Sanitizers (address, undefined behaviour; thread; leak) | 0 reports of the address and undefined-behaviour sanitizers on `--selftest518`, `--selftest517 cpu` and the 5.18 test file; ThreadSanitizer 0 warnings on six translations and on exact-hu with four threads against the translated states, the instrumented program wrote the same six files, NashConv bits equal to the release program in 6 of 6; LeakSanitizer 0 reports on a translation, a refused translation and a line |
| Windows programs under Wine | every step exit 0: thirteen self-tests (the files and bits of `--selftest518` as recorded on Linux), the reference states of 5.16, 5.15, 5.13 and 5.12 with 1, 2 and 4 threads, the bits of `mwcli --tour515` and `--satfield`, `eqtime.exe` quick trials, the 5.18 test file through `mwcli.exe` |
| Both launchers on a hosted Windows runner, pre-release tree | focused 160 passed, 1 failed, 1 skipped, 0 untested (the launcher step took 14 minutes); full 353 passed, 1 failed, 2 skipped, 0 untested (39 minutes); `--selftest518` 8 of 8 checks passed in both launchers; the one failure is the manifest a pre-release tree does not have; the skips are the OpenCL GPU section (the runner has no OpenCL platform) and the CUDA section (run 46111583534, Windows Server 2025, AMD EPYC 7763, 4 logical processors) |
| The same on the delivered archive | WINDOWS-CI-5.18.md beside the ZIP |
| Two builds in two directories | 9 of 9 artifacts identical |

The pre-release tree has no `SHA256SUMS.txt`, so its manifest check fails by construction; that check is exercised
by the delivered archive.

## 8. Not validated

* The target PC; a graphics card (everything 5.17 left open there is still open); more than 4 processors.
* The cost of a missing size for three or more seats, for preflop studies and for tournament payoffs: the
  translation runs there, the exact measure does not.
* The cost with two sizes missing at once, and on trees with more than two sizes a street.
* The draw-once randomised mapping (MATHEMATICAL-VALIDATION-5.18.md, section 2).
* The explorer field on Windows, and in a study that starts before the flop.
* A translated state opened in the desktop program (its loader is the one `mwcli` uses; the route was not
  exercised), through the page (the JavaScript engine refuses it) or through the Study tab.
* The in-tree MSYS2 workflow: updated, not run.
