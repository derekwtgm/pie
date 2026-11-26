# EightMax 5.13: validation

Build `e9ce3436fa829e47`. "Development machine": an Ubuntu 24.04 container with 4 processors. "Runner": a hosted GitHub
Actions machine. Nothing here ran on the target PC or on a GPU. The decision rules quoted are those of
`validation/5.13/plan.json`, written before any satellite code existed.

## 1. Baseline: 5.12, before any change

The delivered 5.12 archive (SHA-256 `5a1246b0...490c8`) was extracted and its source rebuilt on the development
machine: all 7 artifacts byte-identical to the delivered files. The regression suite and the seven self-tests of
5.12 had run on this machine on that unmodified build the same day: 682 tests, 680 passed, 1 failed, 1 skipped (the
failure: `5.3 timed CLI reproduction`, a test that expects a time-limited study not to finish and fails on this
machine for 5.11 and 5.12 alike; the skip: a permissions test that cannot work as root); self-tests 28 / 24 / 33 / 32
/ 21 / 26 / 8, all passed. Evidence: `validation/5.12/`.

## 2. Existing trainers and utilities are untouched (rule E)

| Check | Result |
|---|---|
| The unchanged 5.12 binary against 5.13, `tools/identity57.py` | 225 configurations, 1782 trainings, 0 differences |
| The unchanged 5.12 binary against 5.13, the sixteen fixtures of 5.12 and the four ordinary-ICM satellite fixtures (`identity513.py`) | 80 cases (16 of them satellite fixtures; both kinds of streams; one deal per update and frozen batches), 0 different |
| Self-tests 5.7 to 5.12 with their recorded tables untouched | all passed: Linux, Wine, Windows Server 2025 |
| The 5.12 program given a satellite-field specification | refuses it ("Invalid ICM configuration"), nothing written (`tests/v513.test.js`) |

## 3. The large-field payoff model

| Rule | Limit | Result |
|---|---|---|
| A: against exact rational Malmuth-Harville values, at most 12 players | 1e-9 per player, at least 200 fields | 240 fields, largest difference **2.1e-14**: met |
| B: against the program's exact recursion with N equal prizes, at most 16 players | 1e-9, at least 200 fields | 400 fields in `--selftest513` (M2), largest difference 7.2e-15: met. (The plan named "the engine's recursion"; the self-test calls it in-process.) |
| C: fields of 50 to 5,000 players against an independent integration | 1e-8, at least 40 fields; all values add up to N within 1e-7 | 42 fields, largest difference **2.0e-10**, largest sum error 2.0e-15: met |
| C: 1,000,000 sampled finishing orders | the value inside the 99.9% interval, 5 fields | 5 of 5 fields inside the interval |
| G: one spot under both payoff models | action values to 1e-8, NashConv to 1e-7 | 4.4e-16 and 5.6e-17 (`--selftest513`, K3): met |

**About the reference of rule C.** Its first version integrated in u = exp(-t / tau); its own results for two step
sizes differed by 2e-8, so it could not test a 1e-8 rule. I changed the reference's variable to y = t / (t + tau)
(the program's values did not change, and the rule did not). With the new reference its own two step sizes differ
by at most 3.0e-09; where that is larger than the difference from the program, the comparison says the program agrees
with the reference as well as the reference agrees with itself, not more.

## 4. What entering the field in summary costs (rule D: information)

36 synthetic fields of 40 to 500 players (log-normal stacks, narrow and wide, and two camps of short and big
stacks), seats for 10% to 80% of the field, five table stacks from 0.2 to 4 average stacks. The probability with the
true stack list against the probability with a summary:

| Summary | Largest difference | Median |
|---|---:|---:|
| "K players with the average stack" | **0.348** | 0.0125 |
| three groups (short, middle and big thirds with their averages) | **0.106** | 0.0029 |

By table stack (largest difference, average-only / three groups): 0.2 average stacks 0.312 / 0.106, 0.5 average stacks 0.348 / 0.091, 1.0 average stacks 0.211 / 0.054, 2.0 average stacks 0.109 / 0.039, 4.0 average stacks 0.055 / 0.017.

The rule written beforehand: no statement that a summary is good enough unless the largest difference is below
0.01. It is not; these numbers are the size of the approximation. The fixture `satfield-bb-call` carries an
"average-only" variant so that the effect can be seen on a decision.

## 5. Fixtures and closed forms (rule F)

| Check | Result |
|---|---|
| The generator rebuilds all 22 fixtures; `studies/` equals `source/studies` | 22 identical; equal |
| `mwcli --selftest513` (14 checks) | 14 passed on Linux, under Wine, on Windows Server 2025 |
| Folding aces: both action values against values computed independently (ICM written out; equity over 1,712,304 boards with the JavaScript evaluator) | fold to 1e-12, call to 1e-9; folding worth 0.1316 more |
| Mixed river spot: fold value; calling frequency of the kings; betting frequency of the queens | F to 1e-12; 0.3261 against 0.3258; within 0.03 of 0.3053 |
| Exact NashConv of three small fixtures after 20,000 deals | as recorded (regression values, one seed, no convergence claim) |

## 6. Regression suite (`validation/5.13/tests/`)

| | 5.12, this machine | 5.13, this machine |
|---|---|---|
| Tests | 682 | 693 (the 11 of `v513.test.js` are new) |
| Passed | 680 | 691 |
| Failed | 1 | 1 |
| Skipped | 1 | 1 |

Failed in 5.13:

* `5.3 timed CLI reproduction: all 100 requested seeds are counted and incomplete budgets cannot meet tolerance` - fails on the unmodified 5.11 and 5.12 programs here too (it expects a time-limited study not to finish; this machine finishes it)

Skipped in 5.13:

* `4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissi` - running as root: permissions are not enforced


The suite ran in a copy of the release tree without the files that are not in the archive.

**What the suite caught before release.** Its first complete run (build `26daa04566e9466a`) failed three older tests.
I had added the satellite fields to the default example of the Multiway form; the fixture generator copies that
example into every fixture, so it no longer rebuilt the sixteen fixtures of 5.12 byte for byte (the shipped fixture
files had not changed; their regeneration had). The two fields were taken out of the example - the form supplies
their defaults - and the sixteen fixtures are again the files of 5.12 and regenerate identically; one 5.12 test that
counted six-handed fixtures now leaves the satellite fixtures out. Two earlier builds of 5.13 were made and dropped
for the manifest floor of the Windows script (`f8fe4c476fb608c8`) and for this (`26daa04566e9466a`); every result in
this file is of the final build.

## 7. Interface, sanitizers, Wine, runner, build

| | Result |
|---|---|
| Satellite controls in Chromium (`tools/sat_ui513.js`) | 12 of 12 |
| Table switch in Chromium; 8-max library views against the 5.12 page | 21 of 21 (18 library views identical to the 5.12 page as HTML) |
| Study tab against the desktop host; refused studies | 20 of 20 checks passed; refused studies: exit 0 |
| Sanitizers (address, undefined behaviour; thread; leak) on the self-test, four tests and satellite trainings | 0 reports; ThreadSanitizer 0 warnings, 4 of 4 states equal to the release program; LeakSanitizer 0 reports |
| Windows programs under Wine: eight self-tests; satellite and six-handed states with 1, 2, 4 threads; the bits of `--satfield`; five tests through `mwcli.exe` | every step exit 0 |
| Both launchers on a hosted Windows runner, pre-release tree | focused 93 passed, 1 failed, 0 skipped, 0 untested (133.4 s); full 286 passed, 1 failed, 1 skipped, 0 untested (552.2 s); the one failure is the manifest a pre-release tree does not have; the skip is the GPU section |
| Both launchers on a hosted Windows runner, the delivered archive | WINDOWS-CI-5.13.md beside the ZIP |
| Two builds in two directories | 7 of 7 artifacts identical |
| Speed (information) | satfield-bb-call-small: baseline (satellite-field) 1,383,509 deals/s, chip-ev 1,506,557 deals/s; satfield-bb-call: baseline (satellite-field) 423,230 deals/s, chip-ev 446,957 deals/s; sat5-bubble-bb-call: baseline (ordinary ICM) 419,595 deals/s, chip-ev 442,579 deals/s; set-up plus one evaluation: 121 players / 40 seats 0.01 s, 2000 players / 500 seats 1.85 s, 2000 players / 900 seats 3.63 s |

The pre-release tree has no `SHA256SUMS.txt`, so its manifest check fails by construction; the repaired manifest
floor (RELEASE-5.13.md) is exercised only by the delivered archive.

## 8. Not validated

* The target PC; an NVIDIA GPU; CUDA with satellite studies.
* The interface on Windows (WINDOWS-TESTS-5.13.md, section 4).
* The quadrature error is measured, not bounded by a proof.
* Postflop studies under the large-field model (only push-or-fold fixtures were made).
* Whether the Malmuth-Harville model fits real satellites.
* The in-tree MSYS2 workflow: updated, not run.
