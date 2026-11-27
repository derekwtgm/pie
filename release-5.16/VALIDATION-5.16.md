# EightMax 5.16: validation

Build `39600509cc5a98e8`. "Development machine": an Ubuntu 24.04 container with 4 processors. "Runner": a hosted GitHub
Actions machine. Nothing here ran on the target PC or on a GPU. Decision rules: `validation/5.16/plan.json`. The
measurement is in CONVERGENCE-5.16.md; what the measure and the Ranked key are, in MATHEMATICAL-VALIDATION-5.16.md.

## 1. Baseline: 5.15, before any change

The delivered 5.15 archive (SHA-256 `dbf88659...cf7a`) was extracted into an empty folder and its source rebuilt on
the development machine **before the first change of Phase 6**: all 9 artifacts byte-identical to the delivered files (`validation/5.16/baseline/`).
On that rebuilt tree:

* the ten self-tests (5.7 to 5.15): all exit 0;
* the regression suite: 708 tests, 704 passed, 3 failed, 1 skipped. Two failures were mine again: the ZIP was
  extracted without execute permissions, so the tests that start the stored 5.13 and 5.14 Linux programs could not
  start them. With the permission restored both pass. The third is `5.3 timed CLI reproduction`, the timed test that
  fails on this machine whenever it finishes a time-limited study in time; it failed in the rerun too. It is the
  same test, unchanged, that fails here for 5.11 to 5.15. The skip is a permissions test that cannot work as root.

## 2. Nothing that trained before trains differently

| Check | Result |
|---|---|
| The unchanged 5.15 binary against 5.16, `tools/identity57.py` | 225 configurations, 1782 trainings, 0 differences |
| The unchanged 5.15 binary against 5.16, every study fixture (26; Compact, Detailed and Exact cards as shipped, two also regrouped as Detailed): default trainer and `rbes`, both kinds of streams, one deal per update and frozen batches | 224 cases (112 of them `rbes`; by grouping: compact 88, detailed 8, detailed (regrouped) 16, exact 112), 0 different |
| Self-tests 5.7 to 5.15 with their recorded tables untouched | all passed on Linux (28 / 24 / 33 / 32 / 21 / 26 / 8 / 14 / 7 / 12 checks); under Wine: every one exit 0; on the hosted Windows runner: every one passed, inside both launchers |
| The equal-time tool of 5.14: a fresh recording of its reference values; quick trials | recording exit 0, 2 of 2 files identical to the shipped ones; pruning: exit 0, equal-deals check passed; threads: exit 0, equal-deals check passed |
| The 26 fixtures | regenerate byte for byte (`fixtures52.js --check`: 26 identical; `studies/` equals `source/studies` (exit 0)) |
| A Ranked river or small-turn study in the 5.15 program | trains to the same bytes (`tests/v516.test.js`): there the grouping is a table inside the spec, which 5.15 reads like any other |

## 3. The measurement

| Check | Result |
|---|---|
| Units of the plan | 800 units (8 games, 4 groupings, 5 seeds, 5 budgets), 0 errors; held-out games: 200 units |
| R1 | Compact: **large** on 6 of 8 games (0.11 to 17.42% of the pot a player; 2.2 to 108 times Exact cards). Detailed: **not large**: large on 0 of 8 games (0.00 to 5.00% of the pot a player; 0.6 to 3 times Exact cards). Ranked: **large** on 2 of 8 games (0.01 to 12.99% of the pot a player; 1.3 to 9 times Exact cards) |
| R2, R3 | CONVERGENCE-5.16.md, sections 4 and 5 |
| R4 | **met** against Compact (floor lower on 8 of 8 games, none above 1.25 times, not worse at equal time); held-out: **passed** (`ho-hu-river`: Ranked 1.00, Compact 3.54, Detailed 0.07, Exact cards 0.09; `ho-hu-turn`: Ranked 0.78, Compact 1.29, Detailed 0.08, Exact cards 0.09; percent of the pot a player); size: **passed**: 0.197 of Detailed's rows (limit 0.25), 7.7 times Compact's |
| All units were run with the final build | yes: every unit was run again after the build was frozen. The first run (three groupings with the 5.15 program, Ranked with an earlier 5.16 build) gave the same NashConv and row count, to the last digit, in 1000 of 1000 units; only the seconds differ |

**Mistakes of mine in this measurement, for the record.** (0) The first frozen build (`3490f9edf48ec1db`) let the programs of 5.10 to 5.15 continue a Ranked state under the Compact study of the same spot; my own final check found it, the build was withdrawn and everything was repeated on this one (amendment 5). (1) The plan asked for 20,000,000 deals; the default
trainer accepts 10,000,000 on these games (amendment 1, before results). (2) R2 as written could give values at one
of three times only (amendment 2, after results). (3) The first build with the Ranked grouping had a quotation mark
inside a text of the page, which stopped the page's script from loading; the browser test found it before anything
was measured through the page. (4) The first candidate was built before its size was measured; it failed the size
check.

## 4. The Ranked grouping

| Check | Result |
|---|---|
| `mwcli --selftest516` (6 checks) | 6 passed on Linux, under Wine and on Windows Server 2025 (6 of 6, twice) |
| A fresh recording of the self-test's table | recording exit 0, 1 of 1 file identical to the shipped one |
| JavaScript against native: identical tables, each continues the other's state (3 configurations, 3 seeds) | identical tables in 9 of 9 runs; every state loads in the other engine |
| The key recomputed from its definition on three river games | `tests/v516.test.js`: every pair of hands shares a row exactly when the definition says so |
| One state for every thread count; stop and continue | `--selftest516` T2; ThreadSanitizer run below |
| A Ranked state under another grouping, and the other way round | refused each time with a reason, nothing written (`--selftest516` C2) |
| The programs of 5.10 to 5.15 given a Ranked spec, and a Ranked state under the Compact spec | refused by every one of them (5.15, 5.14, 5.13, 5.12, 5.11, 5.10), nothing written |
| Size on `flop3-kings` | **passed**: 0.197 of Detailed's rows (limit 0.25), 7.7 times Compact's |

## 5. The interface

| Check | Result |
|---|---|
| The Ranked grouping in Chromium (`tools/grouping_ui516.js`): the list, the default, a study built and trained by the page, its state, refusals | 8 of 8 checks |
| Bounties and future hands, the 5.15 test, run unchanged | 14 of 14 checks |
| The satellite test of 5.13, run unchanged | 11 of 12 checks (the one that counts three groups fails, see below) |
| Table-size switch and 8-max library views against the 5.12 page | 21 of 21 checks |
| Study tab against the desktop host; refused studies | 20 of 20 checks passed; refused studies: exit 0 |

The satellite test counts the groups of the Study list and expects three; there are four since 5.15. That one check
fails by construction; the test is left as it ran for 5.13.

## 6. Regression suite (`validation/5.16/tests/`)

| | 5.15, this machine (baseline of section 1) | 5.16, this machine |
|---|---|---|
| Tests | 708 | 715 (the 7 of `v516.test.js` are new) |
| Passed | 704 (706 with the permissions restored) | 714 |
| Failed | 3 (two by an extraction mistake of mine, section 1; the timed test) | 0 |
| Skipped | 1 | 1 |

Failed in 5.16:

* none

Skipped in 5.16:

* `4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissi` - running as root: permissions are not enforced


## 7. Sanitizers, Wine, runner, build

| | Result |
|---|---|
| Sanitizers (address, undefined behaviour; thread; leak) | 0 reports of the address and undefined-behaviour sanitizers; ThreadSanitizer 0 warnings on 6 frozen-batch trainings with four threads (Ranked on two flop fixtures, with philox64, with `rbes`, on a turn with wide ranges; Compact; Detailed), 6 of 6 states equal to the release program on one thread; LeakSanitizer 0 reports |
| Windows programs under Wine | every step exit 0: eleven self-tests, the reference states of 5.16, 5.15, 5.13 and 5.12 with 1, 2 and 4 threads, the bits of `mwcli --tour515` and `--satfield`, `eqtime.exe` quick trials, the 5.16 test file through `mwcli.exe` |
| Both launchers on a hosted Windows runner, pre-release tree | focused 139 passed, 1 failed, 0 skipped, 0 untested (585.1 s); full 332 passed, 1 failed, 1 skipped, 0 untested (1281.3 s); `--selftest516` 6 of 6 in both launchers; the one failure is the manifest a pre-release tree does not have; the skip is the GPU section (run 46009333112, Windows Server 2025, AMD EPYC 7763, 4 logical processors, Windows PowerShell 5.1) |
| The same on the delivered archive | WINDOWS-CI-5.16.md beside the ZIP |
| Two builds in two directories | 9 of 9 artifacts identical |

The pre-release tree has no `SHA256SUMS.txt`, so its manifest check fails by construction; that check is exercised
by the delivered archive.

## 8. Not validated

* The target PC; an NVIDIA GPU; more than 4 processors.
* The error of any grouping where no exact best response exists: ranges of hundreds of hands, preflop studies.
* The Ranked grouping with more than four threads, and its memory on studies larger than `flop3-kings`.
* The Ranked grouping in the JavaScript engine beyond the three small configurations of the mirror check.
* The interface on Windows (WINDOWS-TESTS-5.16.md, section 4).
* The in-tree MSYS2 workflow: updated, not run.
