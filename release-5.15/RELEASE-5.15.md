# EightMax Windows 5.15

Build `87b9f6e38b735cfb`. Successor of 5.14 (`57befd67c7c86ebe`). This is **Phase 5** of the ten-phase plan: ICM and bounty
formats.

**The short version.** 5.15 adds one thing: a tournament payoff model, `tour-5.15-v1`, that can value the stacks
after a hand with **bounties** (knockout and progressive knockout) and with **future hands** (the next one to five
hands at the table, simulated as push/fold). Both existed before only inside the push/fold calculator, with a simpler
bounty rule and at most two future hands; now the studies of the native engine have them too, and the calculator
uses the same model. No trainer changed: every study that existed in 5.14 trains to the same bytes.

Two things you should know before using it:

* **Both are models, not measurements.** What a bounty is worth later, and what the next hands are worth, are
  assumptions with names and formulas (MATHEMATICAL-VALIDATION-5.15.md). The code was checked against the formulas;
  the formulas were not checked against real tournaments.
* **The push/fold calculator's results with bounties change.** The old rule counted only the bounty on a player
  himself. The new rule counts every bounty still in play. On two test tables that moves first-in frequencies by up
  to about 25 points (CONVERGENCE-5.15.md, section 4).

First thing to do on your PC: **WINDOWS-TESTS-5.15.md**. Reports: FINAL-REPORT-5.15.md, CONVERGENCE-5.15.md,
MATHEMATICAL-VALIDATION-5.15.md, VALIDATION-5.15.md, BUILD-5.15.md.

## What is new

### 1. Bounties in studies

A study with Tournament ICM can carry a bounty on every player.

* **Knockout:** busting a player pays the winner of that pot the whole bounty.
* **Progressive knockout:** half is paid at once; the other half is added to the winner's own bounty.
* A split pot splits the bounty. Who "the winner" is follows the pot the busted player's last chips were in.
* After the hand, every bounty still in play is counted for each player at **their share of the chips** (the "pool
  rule"). Heads-up this is exact inside the model; with more players it is an approximation that lies between two
  other simple models on the tables compared (at most 6.5% of the bounties in play away from either).

In the Multiway form: payoff *Tournament ICM*, then *Bounties* and *Bounty on each player* (one number for
everybody, or one per player: the seats in order, then the other players in the order of their stacks). From the
command line the spec carries `"icm":{"model":"tour-5.15","start":[..],"others":[..],"prizes":[..],"bounty":{"share":0.5,"heads":[..]}}`.

### 2. Future hands in studies, and more of them

Plain ICM values the stacks the moment the hand ends. With future hands, each result of the hand is valued by the
solution of the next hands at this table and blind level, with the button moving one seat: the player who posts the
big blind next is worth less than ICM says, and so on.

* The future hands are always **push-or-fold** hands (169 hand classes, heads-up all-ins), whatever the studied hand
  is. Future hands with raises or postflop play are not simulated.
* **How many:** up to 5 heads-up, 4 at a table of three, 3 at four or five, 2 at six to eight. The limit is work:
  at most 2,000 future-hand solutions for one result of the studied hand. The calculator allows one fewer (its own
  hand counts).
* **It is slow at the start of a study**, while future hands are solved (about 10 to 35 ms each). At a table of six
  to eight even one future hand needs thousands of them.
* **More future hands are not shown to be more accurate.** On one of seven test tables the result moves as much from
  one hand to two as from none to one (CONVERGENCE-5.15.md, section 3).

In the Multiway form: *Future hands simulated*, for preflop studies (the first "other" stacks are then the seats that
folded before the study, earliest position first). Spec: `"fgs":{"depth":2,"table":[..],"smallBlind":0.5,"bigBlind":1,"ante":0.1,"anteType":"classic"}`
inside the same `icm` object; `table` lists the players at the table in position order.

### 3. The push/fold calculator

*Preflop > Custom / ICM*: future hands up to 4 (by table size); bounties under the pool rule, with a field for the
bounty of players at other tables. *Solve with overcalls* carries bounties and future hands into the study.

### 4. Four study fixtures

| Fixture | What |
|---|---|
| `pko6-bb-call` and `-small` | six left at a progressive-knockout final table; the big blind (30 BB) covers a button all-in of 12 BB. Variants: knockout, no bounties, a bigger bounty, chip EV |
| `fgs4-bubble-bb-call` and `-small` | four left, three paid; a 4 BB stack posts the big blind next. Variants: one, two (baseline) and three future hands, plain ICM, chip EV |

The small companions have exact cards and exact evaluation. In the small bounty fixture the bounty turns a toss-up
into a call; in the small future-hands fixture the fold leads with or without future hands (CONVERGENCE-5.15.md,
section 5).

### 5. `mwcli --tour515`, `mwcli --selftest515`, and the Windows validation of 5.15

`mwcli.exe --tour515 request.json` prints the model's values with 17 digits and their bit patterns.
`mwcli.exe --selftest515 studies <work-dir>`: 12 checks (the model's recorded bits, its sum rule, closed forms,
refusals; 16 recorded states, threads, stop and continue; checkpoint rules). `validate_windows515.ps1` is the 5.14
script with two more sections (`self-test 5.15`, `tournament 5.15`).

## What did not change

* **Every trainer and every default.** The unchanged 5.14 program and 5.15 train 225 configurations and 208 fixture cases, 0 differences to the same bytes; the
  self-tests of 5.7 to 5.14 pass with their recorded tables untouched.
* **Studies without the model.** A spec, fixture or form state of 5.14 produces the same game.
* **Checkpoints.** A state trained under the model names `"payoffModel":"tour-5.15-v1"` and a key of its parameters
  in its header and has a derived study identifier. It continues only under the same model and parameters. The plain
  ICM study and the programs of 5.10 to 5.14 refuse it with the reason and write nothing; they also refuse the
  model's spec (tested with the programs of 5.14, 5.13, 5.12, 5.11, 5.10). Every other state and checkpoint loads and continues as before. No file format
  changed.
* The libraries, the satellite model, pruning, the equal-time tool, CUDA.

## Validation status

Classes: (1) independently validated; (2) tested on Linux, under Wine or on a hosted Windows runner; (3) awaiting
the target PC or an NVIDIA GPU; (4) unresolved or not established.

| Item | Class | Evidence |
|---|---|---|
| Trainers untouched | 1 | the unchanged 5.14 binary: 225 configurations and 208 fixture cases, 0 differences |
| The code computes the model as defined | 1 | an independent implementation (Python, no shared code): **met**: largest difference 1.4e-13 on 16 outcomes without and 34 future hands with simulation; a player gains at most 3.2e-06 of the unit by deviating in a future hand |
| Native and JavaScript give the same values | 2 | 182 values within 2.1e-14 |
| The same bits on Linux and Windows | 2 | `--selftest515` M1: Linux, Wine, Windows Server 2025 (hosted runner): identical |
| Training under the model converges on small exact games | 2 | rule R2: **NOT MET**: 28 of 32 pairs pass; failing: bubble4 pko (FAIL), bubble4 ko (FAIL), bubble4 fgs1 (FAIL), bubble4 pko+fgs1 (FAIL) |
| The pool rule is the right value of a bounty | 4 | **not established**; within 3.0% (mh) and 6.5% (duel) of the bounties in play of two other models on seven small tables |
| Push/fold future hands are the right model of the next hands | 4 | **not established** |
| More future hands are more accurate | 4 | **not established**; on one of seven tables nothing settles |
| Self-test, checkpoint rules, refusals | 2 | Linux, Wine, Windows Server 2025 |
| The interface | 2 | Chromium: 14 of 14 checks |
| Regression suite | 2 | 708 tests: 707 passed, 0 failed, 1 skipped (5.14 on the same machine: 701 tests; the 7 new ones are those of v515.test.js) |
| Both launchers on a hosted Windows runner | 2 | pre-release tree: every check passed but the manifest check that tree cannot pass (126 + 319 passed); the delivered archive: WINDOWS-CI-5.15.md beside the ZIP |
| Anything on the target PC | 3 | not run; 5.11 to 5.14 not reported either |
| `rbes` as automatic trainer; pruning and threads on your processor | 3 | still open from Phase 4 (WINDOWS-TESTS-5.15.md, section 5) |

## The archive

`EightMax-Windows-5.15.zip` (about 75 MiB). The second archive of 5.12, `EightMax-5.12-evidence-2.3-to-5.8.zip`, is
unchanged and not delivered again (the packaging script rebuilt it from the 5.15 tree and found the SHA-256 of the
delivered one).

## Compatibility

Settings, specs, states, study checkpoints and fixtures of 5.14: as before. A study checkpoint is tied to its build.
