# EightMax 5.16: final development report (Phase 6: card-grouping error)

Build `39600509cc5a98e8`, successor of 5.15 (`87b9f6e38b735cfb`).

## 0. The short version

The brief for this phase: *solve the same spots with Compact, Detailed and Exact cards and report the difference in
exact NashConv and in strategy. If the error is large, propose a better grouping.*

| | | Status |
|---|---|---|
| The same spots under the three groupings | eight small range games, five seeds, five budgets, one measure | **done** |
| ... in exact NashConv | the exact best response already sees physical cards, so one number compares all groupings | **reported**: CONVERGENCE-5.16.md, sections 2 to 4 |
| ... in strategy | per physical hand on the first street, against the seed-to-seed distance of Exact cards | **reported**: section 5 there |
| Is Compact's error large? | rule written beforehand | **yes**: **large** on 6 of 8 games (0.11 to 17.42% of the pot a player; 2.2 to 108 times Exact cards) |
| Is Detailed's error large? | same rule | **no**: **not large**: large on 0 of 8 games (0.00 to 5.00% of the pot a player; 0.6 to 3 times Exact cards) |
| A better grouping | "Ranked", `ranked-5.16-v1`; the second of two candidates | **built**; better than Compact by the rule written beforehand; **worse than Detailed** |
| ... its own error | same rule as for the others | **large** on 2 of 8 games (0.01 to 12.99% of the pot a player; 1.3 to 9 times Exact cards) |
| The same question for the shipped fixtures and for preflop | no exact best response exists at that size | **not measured** |
| Trainers and every earlier study | the unchanged 5.15 binary: 225 configurations and 224 fixture cases, 0 differences | **tested**, byte for byte |
| Self-test, Windows script, launchers, ZIP, identity file, reports, branch | | delivered |
| Your PC, the GPU | | **untested** - and 5.11 to 5.15 with it |

## 1. Baseline

Before the first change, the delivered 5.15 archive was extracted and its source rebuilt: all 9 artifacts are byte-identical to the delivered ones. On that tree the ten self-tests pass, and the regression suite gives 708 tests, 704 passed, 3 failed, 1 skipped. Two failures were an extraction without execute permissions (mine; the two tests pass with the permissions restored); the third is the timed test `5.3 timed CLI reproduction`, which fails on this machine for 5.11 to 5.15 whenever it finishes a time-limited study in time. VALIDATION-5.16.md, section 1.

## 2. What was built

* **The measurement** (`validation/5.16`): plan, amendments, unit runner, analysis, every unit. It needed no change
  to the engine: `mwcli --gain` with method `exact` has always let the responder see the cards.
* **`tools/games516.js`**: the eight games in four groupings each, and two held-out games.
* **The Ranked grouping** (`native/es_groups.hpp`, mirrored in `web/lib_wide.js`): a numeric key like Compact's,
  with another signal. Its own identifier, a header field, refusals, a choice in the form.
* **`mwcli --selftest516`** (6 checks), **`validate_windows516.ps1`** (31 sections), two launchers,
  `tests/v516.test.js` (7 tests), `tools/grouped516.js`, `tools/grouping_ui516.js`.

## 3. Rules written before measuring, and their outcomes

| Rule | Outcome |
|---|---|
| The trainers and the three groupings write the states of 5.15 | met: 225 configurations and 224 fixture cases, 0 differences |
| R1: a grouping's error is large when above 0.5% of the pot a player and above 3 times Exact cards on at least 2 of 8 games | Compact **large** (6 of 8); Detailed **not large** (0 of 8); Ranked **large** (2 of 8) |
| R2: equal time, a verdict only when all five seeds agree | reported; at the largest time Compact is worse than Exact cards on 8 of 8 games, Detailed on 3 and better on 2 |
| R3: a grouping moves the strategy when its distance to Exact cards exceeds every Exact-to-Exact distance | Compact on 8 of 8 games, Detailed on 4, Ranked on 6 |
| R4: the proposal against Compact (lower floor on 6 of 8, none above 1.25 times, rows not above Detailed, not worse at equal time) | **met** against Compact (floor lower on 8 of 8 games, none above 1.25 times, not worse at equal time) |
| Held-out games: lower than Compact on both | **passed** (`ho-hu-river`: Ranked 1.00, Compact 3.54, Detailed 0.07, Exact cards 0.09; `ho-hu-turn`: Ranked 0.78, Compact 1.29, Detailed 0.08, Exact cards 0.09; percent of the pot a player) |
| Size: at most a quarter of Detailed's rows on `flop3-kings` | **passed**: 0.197 of Detailed's rows (limit 0.25), 7.7 times Compact's |

Amendments: four (CONVERGENCE-5.16.md, section 7). One of them, the repair of R2, was written **after** results
were seen. The first candidate for the proposal **failed** the size check and was dropped.

## 4. Proven, tested, untested

* **Follows from the definitions:** the measure is NashConv in the game with exact cards for every grouping; a
  grouping's equilibrium generally has a positive value there that training cannot remove; the Ranked key is a
  function of the spec and the cards alone and uses integers only.
* **Tested:** the eight games and two held-out games; the JavaScript key against the native key; recorded states,
  thread counts, stop and continue, checkpoint rules; Linux against Windows under Wine and on a hosted runner; the
  interface in Chromium; everything earlier against the unchanged 5.15 program.
* **Not established:** the error of any grouping in games with hundreds of hands a seat or in preflop studies;
  whether Ranked helps there; whether 16 levels and eight card classes are good choices beyond the games measured.
* **Untested:** everything on your PC and on the GPU.

## 5. Decisions I made that are yours to overrule

1. **"The same spots" are small games, not the shipped fixtures.** An exact NashConv needs an exact best response,
   and that exists only for ranges of tens of hands. The fixtures have hundreds. So the phase's question is answered
   for games of 10 to 60 hands a seat, and not for the studies you actually run. I know of no exact measure at that
   size; Phase 7 (a full best response on the GPU for heads-up games) is what could give one for two players.
2. **What "large" means.** 0.5 percent of the pot a player, and 3 times Exact cards, on 2 of 8 games. Chosen after a
   one-seed pilot whose numbers I had seen. With these thresholds the verdict on Compact is not close; the verdict
   on Ranked (large on 2 of 8) would change with a threshold of 3 games.
3. **Ranked is offered although its own error is large by R1.** The rule for offering it (written
   before it existed) compared it with Compact, not with zero. It is in the form as a fourth choice with the release
   number in its name, not as a default.
4. **Size before accuracy.** The first candidate was more accurate on turn games and was dropped for its table
   size, by a limit (a quarter of Detailed's rows) that I set without a measurement behind it. If memory matters less
   to you than accuracy, Detailed is the answer where it fits, and the first candidate is the direction to reopen
   where it does not.
5. **No fixture and no default was changed.** The fast preset of the form still uses Compact, and the shipped
   fixtures keep Compact. Changing them would change recorded results on the strength of a measurement that does not
   reach their size.
6. **Ranked is refused for preflop studies.** There the flop is sampled from 22,100 boards and the range strengths
   cannot be kept in a table; computing them every deal was not built.
7. **The 10,000,000-deal ceiling.** The default trainer with its 5.10 streams refuses more on these games. The
   philox64 streams of 5.11 have no such limit; the plan named the default trainer, so I kept to it.

## 6. Unresolved, not done, or not established

* Grouping error at the size of the shipped fixtures, and for preflop studies (decision 1).
* Whether the fast preset should stop using Compact. On the evidence here Compact is the wrong choice whenever
  Detailed or Ranked fits, but the evidence is from small games.
* A grouping between Ranked and Detailed (the first candidate), and a cap that adapts to the size of the range.
* Ranked for preflop studies.
* Results with more than one thread, with `rbes`, and at more than 10,000,000 deals.
* Still open from Phase 4: `rbes` as automatic trainer (your run of the 5.13 kit), pruning and threads on your
  processor (the 5.14 equal-time launcher).
* From earlier phases, unchanged: ROADMAP.md.

## 7. What to run, and what to send back

WINDOWS-TESTS-5.16.md has the steps. In order of value:

1. `Run 5.16 focused validation.bat` (25 to 45 minutes): send `Windows-focused-validation-5.16.json`, `.txt`,
   `Windows-selftest516-5.16.json`.
2. The 5.13 `rbes` kit, if not yet run: its folder `rbes-equal-time-results`.
3. `Run 5.16 Windows validation.bat` (55 to 125 minutes, GPU included): `Windows-validation-5.16.json`, `.txt`, the
   eleven `Windows-selftest*-5.16.json`, `hardware-validation.json`.
4. `Run 5.14 equal-time comparison.bat` (2 to 2.5 hours): the folder `equal-time-results` without `units`.
