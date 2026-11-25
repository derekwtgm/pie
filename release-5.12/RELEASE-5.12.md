# EightMax Windows 5.12

Build `913dc2280e5088ae`. Successor of 5.11 (`af452eaa0ea731be`). This is **Phase 2** of the ten-phase plan: 6-max
tournaments. The interface and the libraries changed; the trainer did not.

First thing to do on your PC: **WINDOWS-TESTS-5.12.md** (`Run 5.12 focused validation.bat`, 8 to 20 minutes; then
`Run 5.12 Windows validation.bat`). Reports: FINAL-REPORT-5.12.md, LIBRARY-5.12.md, VALIDATION-5.12.md, BUILD-5.12.md.
There is no CONVERGENCE or PERFORMANCE report in this release, because no training code changed and nothing was
compared at equal time or equal deals.

## What is new

### 1. A 6-max preflop library

* **Push/fold**, 3 to 25 BB in steps of 1 BB: first-in all-in ranges for MP, HJ, CO, BTN and SB and every calling
  range behind them (23 charts).
* **15-100 BB** preflop charts at 15, 20, 25, 30, 40, 50, 60, 80 and 100 BB: opens, 3-bets, 4-bets, calls and limps,
  with the same sizes per depth as the 8-max charts (9 charts).
* The game is the 8-max library's game with six seats: blinds 0.5/1, 0.1 BB ante per dealt player (0.6 BB of antes,
  2.1 BB in the pot before anyone acts), equal stacks, chip EV.
* **Made by the 8-max generators** with the number of seats as their only new parameter. With eight seats the same
  generators rewrite the two shipped 8-max files byte for byte; with six seats two separate runs write the same
  files. Every chart met the acceptance rule that was written before it was generated (LIBRARY-5.12.md).

Two limits of these charts, measured in this release and stated on purpose:

1. **The 15-100 BB charts are an approximate model** (as the 8-max ones: flop values are an estimate, not solved
   play). Against the program's linked preflop-to-river solver, first-in raises differ by 11 to 18 points at 15 and
   25 BB, six-handed as eight-handed. Which is nearer to the truth is not established. The label "Approximate preflop
   model" and the button "Re-solve with postflop play" are on every one of these charts.
2. **The push/fold charts ignore the cards of the players who folded.** Against the native engine with real cards for
   all six seats, MP to BTN agree within 2.3 points; the small blind moves all-in about 6 points less often at 8 BB
   and 4 points less at 15 BB. With no cards in the folded seats the engine agrees with the chart to about 1 point.

### 2. A table-size switch

**8-max | 6-max** in the header, remembered between sessions. With **8-max** every view is the view of 5.11 (checked
in a browser: the HTML of 18 library views is identical to the 5.11 page's). With **6-max**:

| Tab | What follows the table |
|---|---|
| Preflop, Push/fold and 15-100 BB | the 6-max library; seats MP, HJ, CO, BTN, SB, BB; "Solve a flop from here", "Set up a multiway flop" and "Re-solve with postflop play" carry six seats and six antes |
| Preflop, Custom / ICM | the form starts with six players and a six-place payout example (35 / 24 / 16 / 11 / 8 / 6) |
| Trainer | drills from the 6-max push/fold charts |
| Postflop | the sample pots carry six antes (0.2 BB less); the sample **ranges** are still the 8-max starting points for the same seats and the note under them says so |
| Multiway | the example deals six players in (an example you have edited or solved is left alone) |
| ICM | starts with six stacks and six prizes (unless you have typed your own) |
| Study | the six 6-max fixtures are listed first |

The switch has two sizes. Any other number of players is available where it always was: in the custom forms.
The first six-handed seat is called **MP**: the program names seats by their distance from the button, and the seat
other tools call UTG or LJ at a six-handed table is the third seat of an eight-handed one.

### 3. Six 6-max study fixtures

| Fixture | Decision | Kind |
|---|---|---|
| `btn25-open-6max` | 25 BB, folded to the button six-handed: Kd8c, fold or raise to 2.2 BB (variants: no bunching weights; an all-in open) | realistic; Compact groups, linked postflop |
| `btn25-open-6max-small` | the same with four to six listed hands per seat, exact cards, no postflop betting | small companion |
| `flop3-queens-6max` | 30 BB: CO opens, BTN and BB call; flop Qs 7d 3h, BB checks; CO holds AhQc: check, bet 33% or bet 75% (variants: a wider big blind; a 125% overbet) | realistic; Compact groups |
| `flop3-queens-6max-small` | the same with five listed hands per seat, flop betting only | small companion, exact evaluation |
| `icm6-bb-call` | six left, all paid 35 / 24 / 16 / 11 / 8 / 6: BTN (40 BB) all-in, SB folds, BB (18 BB) holds AdTc: call or fold (variants: no bunching weights; a 2.2 BB raise; chip EV) | realistic; ICM |
| `icm6-bb-call-small` | the same with four or five listed hands per seat | small companion, exact evaluation |

They are built by the 5.2 fixture generator, which writes a fixture only if the native engine reaches the advertised
decision with the advertised legal actions. The ten fixtures of 5.11 are unchanged, byte for byte. The ranges of the
six-handed fixtures are inputs written for them (and say so); they are not taken from the 6-max charts.

Run one from the Study tab, or: `mwcli.exe --study studies\icm6-bb-call-small.emfix.json result.json`.

### 4. `mwcli --selftest512` and the Windows validation of 5.12

`mwcli.exe --selftest512 studies <work-dir>`: 8 checks - the six fixtures describe a six-handed table and the engine
reaches every advertised decision (20 variants); 24 trained states equal the SHA-256 recorded from the Linux build
(both kinds of streams, one deal per update and frozen batches); the same state on 1 and 3 threads and after a stop;
exact NashConv of two companions as recorded; a study of each companion completes, twice to the same measurements.

`validate_windows512.ps1` is the 5.11 script with two more sections ("self-test 5.12", "table 5.12"); the focused
launcher now also runs the 5.11 trainer checks, because 5.11 had not been validated on the target PC when 5.12 was
made. WINDOWS-TESTS-5.12.md says what to run, what to look at by hand, and what to send back.

## What did not change

* **No training code.** Of `source/native`, one file changed (`mwcli.cpp`: three lines that register the new
  self-test) and three were added (the self-test and its two recorded tables). The engine, both trainers, both kinds
  of training streams, the evaluators, the response measure, CUDA and the checkpoint formats are the files of 5.11.
* **No new algorithm identifier and no new checkpoint header**, because no algorithm and no format changed. States
  and study checkpoints of 5.11 and earlier load and continue under the rules that made them; the self-tests of 5.7 to
  5.11 pass with their recorded tables untouched, and the unchanged 5.11 program and 5.12 train every fixture -
  eight-handed and six-handed - to the same bytes (225 configurations and 64 fixture cases, 0 differences).
* **A study checkpoint is tied to its build**, as before: a 5.12 study does not resume a 5.11 study checkpoint, and
  says so (5.11 behaved the same towards 5.10).
* **The 8-max library and the 8-max interface.**

## The archive

5.11 stood at the 100 MiB limit of the repository. From 5.12 on, evidence of old releases that nothing in the current
release reads is delivered in a second archive beside the ZIP:

| File | Size | Contents |
|---|---:|---|
| `EightMax-Windows-5.12.zip` | about 54 MiB | the application, its source, the evidence of 5.9 to 5.12, and every older file that a test, self-test, validation script or packaging check of 5.12 reads |
| `EightMax-5.12-evidence-2.3-to-5.8.zip` | about 50 MiB | 3,896 files of `validation/2.3` to `validation/5.8` (logs, experiment data, old binaries that nothing reads any more); extracts into the same folder; you do not need it |

That nothing needed was moved was tested by running the complete regression suite in a tree without those files
(VALIDATION-5.12.md, section 3).

One defect of 5.11 is repaired: the introduction printed by `Run 5.11 focused validation.bat` named 5.11 in two lines
where the 5.10 streams were meant (WINDOWS-CI-5.11.md). The 5.12 launcher's introduction was written anew.

## Validation status

Classes as in 5.11: (1) independently validated; (2) tested on Linux, under Wine or on a hosted Windows runner; (3)
implemented, awaiting validation on the target PC or an NVIDIA GPU; (4) unresolved or not established.

| Item | Class | Evidence |
|---|---|---|
| The trainers write the states of 5.11 | 1 | the unchanged 5.11 binary against 5.12: 225 configurations and 64 fixture cases, 0 differences; self-tests 5.7 to 5.11 with their tables untouched |
| The 6-max library is the 8-max generator's output for six seats | 2 | both 8-max files regenerated byte for byte; two 6-max runs identical |
| Every 6-max chart solves its model game to the stated tolerance | 2 | LIBRARY-5.12.md, section 2; `tests/v512.test.js` |
| The switch: 8-max is 5.11, 6-max follows six seats, the choice persists | 2 | 21 checks in Chromium (`tools/table_ui512.js`); not looked at on Windows |
| The 6-max fixtures: decisions, recorded states, studies | 2 | `mwcli --selftest512` on Linux, under Wine and on Windows Server (pre-release tree: every check passed but the manifest check that tree cannot pass; the delivered archive: WINDOWS-CI-5.12.md beside the ZIP) |
| The Windows validation script and both launchers | 2 | a hosted Windows runner: pre-release tree: every check passed but the manifest check that tree cannot pass; the delivered archive: WINDOWS-CI-5.12.md beside the ZIP |
| Regression suite | 2 | 682 tests: 680 passed, 1 failed, 1 skipped (baseline 5.11 on the same machine: 668 tests, 666 passed, 1 failed, 1 skipped; the 14 new tests are those of v512.test.js) |
| Anything on the target PC; CUDA with six-handed studies | 3 | not run |
| 5.11 on the target PC | 3 | not reported yet; the 5.12 launchers repeat its checks |
| The 15-100 BB charts against played-out postflop | 4 | unresolved (LIBRARY-5.12.md, 5.2) |
| The effect of the folded players' cards on push/fold ranges, in BB | 4 | measured in range points for the small blind only; not established in BB |
| Six-handed sample postflop ranges | 4 | not derived |

## Compatibility

Settings saved by 5.11 are read by 5.12; the page opens on 8-max until you choose 6-max. Custom forms you had filled
in keep their numbers. Specs, states, study checkpoints and fixture files: as 5.11.
