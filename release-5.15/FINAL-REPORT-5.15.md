# EightMax 5.15: final development report (Phase 5: ICM and bounty formats)

Build `87b9f6e38b735cfb`, successor of 5.14 (`57befd67c7c86ebe`).

## 0. The short version

The brief for this phase: *extend future-game simulation beyond push/fold and beyond two hands deep; add bounty and
progressive-knockout payouts.*

| | | Status |
|---|---|---|
| Bounties (knockout, progressive) in native studies | payoff model `tour-5.15-v1`, own identifier, header key, refusals, self-test | **built**; code checked against an independent implementation |
| ... is the bounty value right? | the "pool rule": every bounty in play, by chip share | **a model, not established**; within 3.0% (mh) and 6.5% (duel) of the bounties in play of two other simple models on seven small tables |
| Future-game simulation for studies other than push/fold | any tournament study of the native engine can value its outcomes by future hands | **built** (the form offers it for preflop studies) |
| ... beyond two hands | up to 5 heads-up, 4 at three players, 3 at four or five, 2 at six to eight | **built**, limited by cost |
| ... are the future hands themselves more than push/fold? | no: every future hand is the push/fold game | **not done** (see section 5) |
| ... does more depth help? | values and ranges for 0 to 4 future hands on seven tables | **not established**: on one table nothing settles |
| Push/fold calculator | same model; bounties change; future hands up to 4 | **built**; its bounty results differ from 5.14 |
| Training under the model | the trainer of 5.14, exact NashConv on small games | **NOT MET**: 28 of 32 pairs pass; failing: bubble4 pko (FAIL), bubble4 ko (FAIL), bubble4 fgs1 (FAIL), bubble4 pko+fgs1 (FAIL) |
| Trainers and every earlier study | the unchanged 5.14 binary: 225 configurations and 208 fixture cases, 0 differences | **tested**, byte for byte |
| Four fixtures, self-test, Windows script, launchers, ZIP, identity file, reports, branch | | delivered |
| Your PC, the GPU | | **untested** - and 5.11 to 5.14 with it |

## 1. Baseline

Before the first change, the delivered 5.14 archive was extracted and its source rebuilt: all 9 artifacts are byte-identical to the delivered ones. On that tree the nine self-tests pass, and the regression suite gives 701 tests, 699 passed, 1 failed, 1 skipped; the failure was an extraction without execute permissions (my mistake; the test passes with the permission restored). Details: VALIDATION-5.15.md, section 1.

## 2. What was built

* **`tour-5.15-v1`** (`native/tour515.hpp`, mirrored in `web/lib_tour515.js`): the value of the stacks after a hand
  is ICM, plus bounty cash paid in the hand, plus the chip share of the bounties still in play; with future hands,
  the value of the next hands played as push/fold replaces the value of the stacks. One model, three users: the
  native engine, the browser engine and the push/fold calculator.
* **The push/fold game in C++**: a port of the calculator's solver, operation for operation except two discount
  factors (computed without `pow`, so that Linux and Windows agree to the bit). Agreement with the JavaScript
  original: 2.1e-14 on 182 values.
* **The engine** learns at every terminal who won the last pot of a busted seat (three evaluators and the
  protocol-3 walk). When the model is off, the old code path runs unchanged.
* **Specs, headers, refusals**: `"icm":{"model":"tour-5.15", ...}`; `payoffModel` and `payoffKey` in the state
  header; a derived study identifier; earlier programs refuse both spec and state.
* **Interface**: the calculator's controls; the study form; push/fold to study; a fourth group in the Study list.
* **Four fixtures**, **`mwcli --tour515`**, **`mwcli --selftest515`** (12 checks), **`validate_windows515.ps1`** (29
  sections), two launchers, `tests/v515.test.js` (7 tests), `tools/independent_tour515.py`, `tools/tour_ui515.js`.

## 3. Rules written before measuring, and their outcomes

| Rule | Outcome |
|---|---|
| The trainers write the states of 5.14 | met: 225 configurations and 208 fixture cases, 0 differences |
| R1 a: native against the JavaScript mirror within 1e-9 | 2.1e-14 on 182 values: **met** |
| R1 b: independent implementation within 1e-9; deviation gain at most 1e-3 of the unit | **met**: largest difference 1.4e-13 on 16 outcomes without and 34 future hands with simulation; a player gains at most 3.2e-06 of the unit by deviating in a future hand |
| R1 c: values add up | 2.8e-14 on 13 outcomes (the requests in which every player is a study seat: amendment 2) |
| R1 d: same bits on every platform | Linux and Wine: identical, Windows Server 2025 (hosted runner): identical |
| R2: training under the model converges (6 games; amendment 1 removed two variants of the eight-handed game for cost) | **NOT MET**: 28 of 32 pairs pass; failing: bubble4 pko (FAIL), bubble4 ko (FAIL), bubble4 fgs1 (FAIL), bubble4 pko+fgs1 (FAIL) |
| R3: report what future hands change; say so if nothing settles | reported; **on 1 of 5 tables with two or more future hands the last step changes more than the first (bubble4-even): no sign of settling there** |
| R4: the pool rule ships whatever the numbers; call it coarse above 10% | largest differences 3.0% (mh) and 6.5% (duel) of the bounties in play: **not called coarse by the rule**; the reference models differ from each other by up to 8.9% |

**R2 failed for:** bubble4 under pko; bubble4 under ko; bubble4 under fgs1; bubble4 under pko+fgs1. CONVERGENCE-5.15.md, section 2, has the numbers.

**One defect found late, on Windows only.** The first build crashed with a heap-corruption status in about half of
the continued multi-thread trainings with future hands on the hosted Windows runner, and nowhere else (Linux, Wine and
the sanitizers were clean). Removing the model's thread-local scratch memory ended it: 12 of 12 repeats clean
afterwards (VALIDATION-5.15.md, section 3). The cause inside the toolchain is not established. It is the strongest
argument in this release for running the launchers on your PC.

## 4. Proven, tested, untested

* **Follows from the definitions:** the values add up to prizes plus bounties; heads-up the winner of everything gets
  the first prize and both bounties; the value of an outcome is a function of the outcome alone (so threads and the
  order of work cannot change a state).
* **Tested:** the code against the definitions (independent implementation); native against JavaScript; Linux
  against Windows under Wine and on a hosted runner, to the bit; recorded states, thread counts, stop and continue,
  checkpoint rules; convergence of the unchanged trainer under the model on small games; the interface in Chromium;
  the trainers against the unchanged 5.14 program.
* **Not established:** that the pool rule values bounties correctly; that push/fold future hands describe the next
  hands; that more future hands are better; the equity table all of this reads (unchanged since version 2, not
  re-derived).
* **Untested:** everything on your PC and on the GPU.

## 5. Decisions I made that are yours to overrule

1. **"Beyond push/fold" was read as: studies other than push/fold get future-game simulation.** The future hands
   themselves are still push/fold hands. Simulating future hands with raises and postflop play would mean solving a
   full hand for every outcome of the studied hand; nothing in this program can do that at a usable cost. If you
   meant that, it is not done, and I do not see a cheap way to do it.
2. **The bounty rule.** I chose the pool rule (chip share of every bounty in play) over the calculator's old rule
   (own bounty only) and over the two reference models of the comparison. Reason: it distributes exactly the money
   that is in play, it is exact heads-up, it costs nothing to compute, and it lies between the two reference models
   on the tables compared. The reference models are computable only for a handful of players. This is a choice
   between models, not a finding.
3. **The calculator changed with it.** Keeping the old rule in the calculator and the new one in studies would have
   given two answers to one question. The price: calculator results with bounties differ from 5.14.
4. **The work limit of 2,000 future-hand solutions per outcome.** It sets how many future hands are allowed at each
   table size. It is a number I picked from measured solve times (10 to 35 ms), not a derived one.
5. **Future hands in the form for preflop studies only.** A postflop study does not say who sits where at the table;
   the native spec takes a table order, the form does not ask for one yet.
6. **The old satellite browser test was left as it ran**, with one check that now fails by construction (it counts
   three groups in the Study list). The alternative was to edit a test of a past release.
7. **Bounties and the satellite-field model cannot be combined.** A spec names one payoff model.

## 6. Unresolved, not done, or not established

* Whether any of the model's three assumptions holds in real tournaments.
* Future hands richer than push/fold (decision 1).
* Depth: no evidence that the sequence settles within what can be afforded; on `bubble4-even` it visibly does not.
* Eight-handed studies with future hands: they run, slowly; R2 did not cover them (amendment 1).
* A store of solved future hands on disk, so that a second run does not solve them again.
* Bounties in satellites; mystery bounties; bounties that pay a share other than the two usual ones through the form
  (the spec accepts any share in (0, 1]).
* Still open from Phase 4: `rbes` as automatic trainer (your run of the 5.13 kit), pruning and threads on your
  processor (the 5.14 equal-time launcher).
* From earlier phases, unchanged: ROADMAP.md.

## 7. What to run, and what to send back

WINDOWS-TESTS-5.15.md has the steps. In order of value:

1. `Run 5.15 focused validation.bat` (20 to 40 minutes): send `Windows-focused-validation-5.15.json`, `.txt`,
   `Windows-selftest515-5.15.json`.
2. The 5.13 `rbes` kit, if not yet run: its folder `rbes-equal-time-results`.
3. `Run 5.15 Windows validation.bat` (50 to 120 minutes, GPU included): `Windows-validation-5.15.json`, `.txt`, the
   ten `Windows-selftest*-5.15.json`, `hardware-validation.json`.
4. `Run 5.14 equal-time comparison.bat` (2 to 2.5 hours): the folder `equal-time-results` without `units`.
