# EightMax Windows 5.13

Build `e9ce3436fa829e47`. Successor of 5.12 (`913dc2280e5088ae`). This is **Phase 3** of the ten-phase plan: satellites.

First thing to do on your PC: **WINDOWS-TESTS-5.13.md** (`Run 5.13 focused validation.bat`, 10 to 25 minutes; then
`Run 5.13 Windows validation.bat`). One run of 5.13 covers 5.11 and 5.12 as well. Reports: FINAL-REPORT-5.13.md,
MATHEMATICAL-VALIDATION-5.13.md, VALIDATION-5.13.md, BUILD-5.13.md. There is no CONVERGENCE report: no trainer
changed and nothing was compared at equal time or equal deals.

## What is new

### 1. A satellite setup

A satellite pays N equal prizes ("seats"). Two cases:

| Field | How | What computes it |
|---|---|---|
| **16 players or fewer in all** | type **`satellite 4`** (or `4 seats`) wherever payouts are entered: ICM tab, Custom / ICM push/fold, custom 15-100 BB spot, postflop ICM, Multiway "Tournament ICM" | the ICM the program always had (exact Malmuth-Harville recursion) with four equal prizes of 1. Nothing new is computed. |
| **Larger fields** | ICM tab, card "Satellite, large field"; Multiway tab, payoff "Satellite, large field": seats awarded, and the players at other tables as `count x stack` groups (`82x25`, or `24x8, 38x18, 34x30, 22x52`) | a new payoff model, `satfield-5.13-v1` |

In both cases a seat is worth 1 and every EV is a **probability of winning a seat**.

### 2. The large-field model (`satfield-5.13-v1`)

For each seat at your table: the probability, under the Malmuth-Harville model, of finishing among the top N of the
whole field, with the players at other tables holding the stacks you entered. It is the same quantity the exact
recursion gives for small fields, computed another way (one integral over independent exponential clocks;
MATHEMATICAL-VALIDATION-5.13.md proves the formula), so it works for up to 5,000 players and 2,000 seats.

* **It agrees with the exact recursion where both exist:** to 2e-14 on 240 fields against exact rational
  arithmetic, and to 4e-16 in the action values of one bubble spot specified both ways.
* **It is deterministic across platforms:** it calls no library exponential; Linux and Windows builds print the same
  bits and write the same trained states (tested under Wine and on Windows Server 2025).
* **What is approximate, and it is not small.** The model needs the stacks at the other tables. If you enter only
  their number and the average stack, a seat probability moved by **1.3 points in the median and by up to 35
  points** in 36 synthetic fields; entering three groups (short, middle and big thirds) kept it within 11 points,
  0.3 in the median. The more unequal the other stacks, the more a summary costs. The interface says this beside
  the input. Players at other tables are also assumed not to change stacks during the hand.

### 3. Satellite study fixtures, checked against exact answers

| Fixture | What it is | Checked against |
|---|---|---|
| `sat5-bubble-bb-call` (+ `-small`) | five left, four seats: big blind 16 BB facing a button all-in (ordinary ICM, equal prizes); variants: regular prizes, chip EV | exact evaluation and exact NashConv on the companion; the same bytes as the unchanged 5.12 program |
| `satfield-bb-call` (+ `-small`) | 124 left, 40 seats, the large-field model; variants: the field entered as average only, 30 seats, chip EV | exact evaluation on the companion; the model against the exact recursion |
| `sat3-fold-aces` | three left, two seats: the big blind folds aces to an all-in | a closed form: fold 0.9408, call 0.8092 (seat probability), to 1e-9 |
| `known-sat-akq-river` | a river spot with a mixed equilibrium under satellite values | a closed form: the kings call 0.3258 of the time (chip game: 0.5); trained 0.3261 |

Run one from the Study tab (group "Satellites") or: `mwcli.exe --study studies\sat3-fold-aces.emfix.json result.json`.

### 4. `mwcli --selftest513`, `mwcli --satfield`, and the Windows validation of 5.13

`mwcli.exe --selftest513 studies <work-dir>`: 14 checks - the model against the exact recursion (400 fields), its
sum rule, the bits recorded from the Linux build, its refusals; the six fixtures; 24 recorded states; thread counts
and resume; three exact NashConv references; both closed forms; one spot under both payoff models; checkpoint rules.
`mwcli.exe --satfield request.json` prints the model's values and their bit patterns for any table and field.
`validate_windows513.ps1` is the 5.12 script with two more sections and one repair (below).

## A defect of 5.12, repaired

**The 5.12 launchers return exit status 1 on every PC**, with one failed check: `integrity / SHA256SUMS.txt: every
file matches (1949 files)`. Every file does match. The script inherited a floor of 3,000 manifest entries from 5.11,
and 5.12 moved the evidence of old releases out of the archive. It was found when the delivered 5.12 archive ran on
a hosted Windows runner (WINDOWS-CI-5.12.md beside the 5.12 ZIP). 5.13's script has the floor at 1,000; the delivered
5.13 archive ran on the runner with the manifest check passing (WINDOWS-CI-5.13.md). If you have not run 5.12 yet,
run 5.13 instead.

## What did not change

* **The default trainer, `rbes`, both kinds of training streams, chip-EV utilities and the ordinary ICM.** The
  unchanged 5.12 program and 5.13 train 225 configurations and 80 fixture cases, 0 differences to the same bytes; the self-tests of 5.7 to 5.12 pass with
  their recorded tables untouched.
* **Checkpoints.** A state trained under `satfield-5.13-v1` names the model, the seats and the field in its header
  (`payoffModel`, `satelliteSeats`, `satelliteFieldPlayers`, `satelliteFieldChips`) and has a derived study
  identifier; it continues only under the same model, seats and field, and every other continuation is refused with
  the reason and nothing written. Its specification has no payout table, so 5.12 and earlier refuse it ("Invalid ICM
  configuration"). Every other state and checkpoint loads and continues as before. No file format changed.
* **Engine files touched:** `icm.hpp` (one branch that hands the evaluation to the model when a study asks for it),
  `mw.cpp` (the spec fields, the header, the information), `checkpoint_native.hpp` and `action_ev.hpp` (the
  continuation rule; the unit of the reported utility). The training algorithms were not touched.
* The 8-max and 6-max libraries and the table-size switch.

## The archive

`EightMax-Windows-5.13.zip` (about 55 MiB). The second archive of 5.12, `EightMax-5.12-evidence-2.3-to-5.8.zip`, is
unchanged and not delivered again: 5.13 leaves the same files out, and the packaging script rebuilt that archive
from the 5.13 tree and found the SHA-256 of the delivered one.

## Validation status

Classes: (1) independently validated; (2) tested on Linux, under Wine or on a hosted Windows runner; (3) awaiting
the target PC or an NVIDIA GPU; (4) unresolved or not established.

| Item | Class | Evidence |
|---|---|---|
| The formula of the large-field model | 1 | proof (MATHEMATICAL-VALIDATION-5.13.md, 1 to 3); exact rational brute force; the program's own exact recursion; sampled finishing orders |
| Its numerical error | 2 | measured, not bounded: at most 2.1e-14 (small fields, exact), 2.0e-10 (up to 5,000 players, against an independent integration known to 3.0e-09) |
| Existing trainers and utilities untouched | 1 | the unchanged 5.12 binary: 225 configurations and 80 fixture cases, 0 differences |
| Two closed-form fixtures | 1 | values derived by hand and computed independently in `tests/v513.test.js` |
| Satellite fixtures, checkpoint rules, self-test | 2 | Linux, Wine, Windows Server 2025 |
| The interface (payout shorthand, the satellite card, the Multiway payoff, the Study group) | 2 | 12 checks in Chromium; not looked at on Windows |
| Regression suite | 2 | 693 tests: 691 passed, 1 failed, 1 skipped (5.12 on the same machine: 682 / 680 / 1 / 1; the 11 new tests are those of v513.test.js; the failure is the timed test that fails for 5.11 and 5.12 here too) |
| Both launchers on a hosted Windows runner | 2 | pre-release tree: every check passed but the manifest check that tree cannot pass (93 + 286 passed); the delivered archive: WINDOWS-CI-5.13.md beside the ZIP |
| Anything on the target PC; CUDA with satellite studies | 3 | not run; 5.11 and 5.12 not reported either |
| Entering other tables in summary | 4 | measured as large (up to 35 points); no remedy but better input |
| Whether Malmuth-Harville describes real satellites near the bubble | 4 | not examined; the model ignores blinds going up, who is next in the blinds, and that play ends when the bubble bursts |
| Postflop satellite studies with the large-field model | 4 | the model works for any study of the Multiway engine, but only push-or-fold fixtures were made and its cost per evaluation in trees with many distinct outcomes was not measured |

## Compatibility

Settings, specs, states, study checkpoints and fixtures of 5.12: as before. A study checkpoint is tied to its build.
