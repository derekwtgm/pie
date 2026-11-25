# EightMax 5.12: final development report (Phase 2: 6-max tournaments)

Build `913dc2280e5088ae`, successor of 5.11 `af452eaa0ea731be`. One phase, one release: this report covers Phase 2 only.

## 0. The short version

**Asked:** generate a 6-max preflop range library (the current one is 8-max only), add a table-size switch to the
interface, and add 6-max study fixtures.

**Delivered:**

| | | Status |
|---|---|---|
| 6-max library: 23 push/fold charts (3 to 25 BB), 9 charts for 15 to 100 BB | `web/lib_charts6.js`, `web/lib_deeplib6.js` | done; every chart met the rule written first |
| ... made by the 8-max generators, seats as the only new parameter | with eight seats they rewrite both 8-max files byte for byte | **tested** |
| Table-size switch, 8-max / 6-max | header of the interface; library, trainer, forms, sample pots, multiway example, Study list follow it | done; **tested** in Chromium (21 checks) |
| ... with 8-max the interface of 5.11 | 18 library views identical to the 5.11 page as HTML | **tested** |
| Six 6-max study fixtures (three spots, each with a small exact companion) | `studies/` | done; the engine reaches all 20 advertised decisions |
| The trainer writes the states of 5.11 | no engine file changed; 225 + 64 configurations against the unchanged 5.11 binary, 0 differences | **tested** |
| Self-test, Windows script, two launchers | `mwcli --selftest512`, `validate_windows512.ps1` | passed on Linux, under Wine and on Windows Server |
| Windows ZIP, identity file, checksums, reports, branch | | delivered |
| Anything on your PC or on the RTX 4060 Ti; anyone looking at the switch on Windows | | **untested** - yours (WINDOWS-TESTS-5.12.md) |

**Four things you should know before anything else.**

1. **The 15-100 BB charts are not confirmed by the program's own postflop solver - six-handed or eight-handed.** The
   linked preflop-to-river solver raises first in 11 to 18 points more often than the charts at 15 and 25 BB. That
   gap was reported for 8-max in 2.9 and is the same size now. I do not know which side is right: the charts value
   flops with a fitted estimate, and the linked solver was far from converged. The 6-max charts are exactly as
   trustworthy as the 8-max ones you already have, and no more. Phase 9 is where this gets decided.
2. **The push/fold charts ignore what the folded players held.** With real cards in all six seats the native engine
   agrees with the charts within 2.3 points for MP to BTN, but has the small blind moving in about 6 points less
   often at 8 BB and 4 points less at 15 BB. A diagnostic I added after seeing that (and labelled as added
   afterwards) shows the difference disappears when the folded seats hold no cards. The same is true of the 8-max
   charts; it had not been measured before.
3. **The ZIP was reorganised.** 5.11 was at the repository's 100 MiB limit. Evidence of releases 2.3 to 5.8 that
   nothing in 5.12 reads (3,896 files) is now a second archive beside the ZIP; the ZIP is about 54 MiB. I
   decided this before packaging and wrote it into the plan; say so if you want everything back in one file - it no
   longer fits under the limit, so it would need another host.
4. **5.11 had not come back from your PC when I built this.** The 5.12 focused launcher therefore runs the 5.11
   checks as well: one run answers for both.

## 1. Baseline verification (before any change)

The 5.11 archive on branch `claude/eightmax-5.11-phase1-generator` has the SHA-256 of its identity file. Rebuilt from
its source on the development machine - which this time could install the cross-compiler - all seven artifacts are
byte-identical to the shipped files. Regression suite: 668 tests, 666 passed, 1 failed, 1 skipped; the failure is a
test that expects a time-limited study not to finish (this machine finishes it), the skip is a permissions test that
cannot work as root; both on the unmodified program. Six self-tests: all passed. Evidence:
`validation/5.12/baseline/`.

## 2. What was built

* **Library.** `gen_charts.js` and `gen_deep.js` take the number of seats (8 or 6). Same solver, tolerances,
  quantisation and coding. Game: the 8-max library's with six seats (0.1 BB ante per dealt seat, 2.1 BB before
  action, equal stacks, chip EV). The build packs both libraries into the page.
* **Switch.** One state (`table.n`, 8 or 6) in `app.js`; the library views, the trainer and the caches are keyed by
  it; the custom forms, the ICM calculator, the sample pots and the multiway example take their defaults from it;
  the Study list groups fixtures by table. Things you have typed or solved are not overwritten by the switch.
* **Fixtures.** `btn25-open-6max`, `flop3-queens-6max`, `icm6-bb-call`, each with a `-small` companion, defined in
  `tools/fixtures512.js` and built by the 5.2 generator through the application's own workflow.
* **Checks.** `mwcli --selftest512` (8 checks), `tests/v512.test.js` (14 tests), `tools/table_ui512.js` (the page in
  Chromium), `tools/library512.js`, `tools/chart_validation512.js`, `validate_windows512.ps1` and two launchers.

Not built: six-handed sample postflop ranges; sizes other than 8 and 6 in the switch; a card-removal-exact push/fold
library.

## 3. Rules written before measuring (`validation/5.12/plan.json`)

| Rule | Outcome |
|---|---|
| Push/fold chart accepted at 5e-6 BB or less inside the push/fold game | 23 of 23; largest 1.98e-6 |
| 15-100 BB chart accepted at 0.002 BB or less inside the model game | 9 of 9; largest 0.00170 |
| Two generator runs byte-identical; 8-max files unchanged | met |
| Chart comparisons are information; over 5 / 10 points is listed as unresolved | 11 rows listed (LIBRARY-5.12.md, section 5) |
| Fixtures written only if the engine reaches the decision; all sixteen regenerate byte for byte | met |
| With 8-max the library views are those of 5.11 | met (HTML identical) |
| Old evidence leaves the ZIP only where nothing of 5.12 reads it | met; verified by the whole suite in a tree without it |

There is no equal-time or equal-deals comparison in this phase, because no trainer changed. No number in this
release is, or can be turned into, a percentage of GTO.

One departure from the plan, stated: the plan's push/fold comparison was to be reported as measured. I added a second
measurement (only the blinds dealt cards) after seeing the first, to find the cause of the small blind's difference.
It is marked as added afterwards wherever it appears.

## 4. Proven, tested, untested

* **Proven:** nothing new. This phase adds no mathematics.
* **Tested:** section 0's table; details in VALIDATION-5.12.md.
* **Untested on your hardware:** everything. In particular Hybrid and GPU-Preferred with the GPU really scoring
  showdowns - on the 5.11 reference study and on two six-handed ones - and the look of the switch on Windows.

## 5. Validation (VALIDATION-5.12.md)

| | Result |
|---|---|
| Regression suite, development machine, tree without the moved evidence | 682 tests: 680 passed, 1 failed, 1 skipped (baseline 5.11 on the same machine: 668 tests, 666 passed, 1 failed, 1 skipped; the 14 new tests are those of v512.test.js) |
| `mwcli --selftest512` (8 checks) | passed on Linux, under Wine, on Windows Server 2025 |
| Self-tests of 5.11, 5.10, 5.9, 5.8, 5.7.1, 5.7 | 26 / 21 / 32 / 33 / 24 / 28, all passed, same three platforms |
| Identity against the 5.11 program | 225 configurations (1,782 trainings) and 64 fixture cases, 0 differences |
| Sanitizers (address, undefined behaviour, thread, leak) | 0 reports |
| Interface in Chromium: the switch; the Study tab against the host | 21 of 21; 20 of 20 |
| Both launchers on a hosted Windows runner, pre-release tree | every check passed except the manifest check a pre-release tree cannot pass (71 + 264 passed) |
| Both launchers on a hosted Windows runner, the delivered archive | pre-release tree: every check passed but the manifest check that tree cannot pass; the delivered archive: WINDOWS-CI-5.12.md beside the ZIP |
| Your PC; CUDA | **not run** |

## 6. Decisions I made that are yours to overrule

1. **Old evidence in a second archive** (section 0, item 3).
2. **The first six-handed seat is called MP**, because the program names seats by their distance from the button and
   every state, fixture and chart uses those names. Renaming it UTG or LJ for six-handed tables only is a small
   change to the interface; say so.
3. **Antes stay "0.1 BB per dealt seat"** (0.6 BB six-handed), the library's existing convention, not a big-blind
   ante of 1 BB. The custom forms and the multiway panel already offer a big-blind ante; the library does not.
4. **The switch has two sizes** and does not change what you have typed, solved or saved.
5. **Six-handed payout example 35 / 24 / 16 / 11 / 8 / 6** (ICM fixture and form default): an example, not a standard.
6. **Fixture ranges are written by hand** (as the 5.2 fixtures), not taken from the 6-max charts, so a fixture does
   not change when a chart is regenerated. Bunching weights after three folds (1.00 / 0.97 / 0.94) are an assumption.
7. **The sample postflop pots follow the table; the sample ranges do not** (the note under them says so).
8. **The focused launcher is longer** (8 to 20 minutes) because it repeats the 5.11 checks.
9. **No charts were changed because of section 5 of LIBRARY-5.12.md.** The plan said they would not be.

## 7. Unresolved, not done, or not established - in one place

* Nothing ran on your PC or on a GPU; 5.11 has not been reported from it either.
* The 15-100 BB charts against played-out postflop: a gap of 11 to 18 points in first-in raises, cause not established.
* The cost in BB of ignoring folded players' cards in the push/fold charts: not measured; in range points it was
  measured for the small blind at two depths, two seeds, no interval.
* The equity-realization estimate was fitted on heads-up solves and not refitted for six seats.
* The Windows validation script could not be executed on the development machine (running a downloaded PowerShell
  was not permitted there); it ran on the hosted runner only.
* A workflow at the root of the repository that dates from 2.9 ("Windows build, release and verification") runs on
  every push and fails, as it did for the 5.10 and 5.11 pushes. I did not touch it.
* The in-tree MSYS2 workflow was updated and not run (as for 5.10 and 5.11).
* The first full regression run failed one old test that listed the fixture folder; the test was corrected, which
  made a new build identifier, and all evidence was produced again with the final build (VALIDATION-5.12.md, 3).
* One test of the suite fails on a fast machine on 5.11 and 5.12 alike (section 1). I did not change it in this phase.

## 8. What to run, and what to send back

WINDOWS-TESTS-5.12.md. In short: `Run 5.12 focused validation.bat` (8 to 20 minutes), then `Run 5.12 Windows
validation.bat` (35 to 90 minutes), five things to look at in the application, and the report files listed there.

## 9. Files

In the archive: this report, RELEASE-5.12.md, WINDOWS-TESTS-5.12.md, LIBRARY-5.12.md, VALIDATION-5.12.md,
BUILD-5.12.md, the two launchers, `validation/5.12/` (the plan, evidence, runners, the 5.12 Linux mwcli). Beside the
archive: the identity file, `EightMax-5.12-evidence-2.3-to-5.8.zip`, `SHA256SUMS-delivery.txt`, copies of the
reports, WINDOWS-CI-5.12.md with the raw log of the Windows run, and the Linux host and stress programs.
