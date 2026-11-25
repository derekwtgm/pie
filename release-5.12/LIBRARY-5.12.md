# EightMax 5.12: the 6-max preflop library

What the six-handed charts are, how they were made, what was measured about them, and what is not known. No number
in this file is a percentage of GTO, and none can be turned into one.

## 1. What was generated

| | 8-max (unchanged) | 6-max (new) |
|---|---|---|
| Push/fold charts | 23 (3 to 25 BB), `web/lib_charts.js`, `EM.CHARTS` | 23 (3 to 25 BB), `web/lib_charts6.js`, `EM.CHARTS6` |
| 15-100 BB charts | 9 (15, 20, 25, 30, 40, 50, 60, 80, 100 BB), `web/lib_deeplib.js`, `EM.DEEP_LIB` | the same 9 depths, `web/lib_deeplib6.js`, `EM.DEEP_LIB6` |
| Seats | UTG, UTG+1, MP, HJ, CO, BTN, SB, BB | MP, HJ, CO, BTN, SB, BB |
| Game | blinds 0.5/1, 0.1 BB ante per dealt seat (2.3 BB before voluntary action), equal stacks, chip EV | the same with six seats: 0.6 BB of antes, 2.1 BB before voluntary action |

**The generators are the 8-max generators with the number of seats as their only new parameter**
(`node tools/gen_charts.js 6`, `node tools/gen_deep.js solve <depths> 6`, `merge 6`): the same solver, stopping
tolerances, 6-bit quantisation and coding. Two facts support that sentence:

* run with eight seats, the changed generators reproduce the two shipped 8-max files **byte for byte**
  (`lib_charts.js` `807840ea...`, `lib_deeplib.js` `310e3a34...`: the files of 5.11);
* run twice in separate processes, they write the same 6-max files byte for byte
  (`validation/5.12/library/regeneration.txt`).

The first six-handed seat is named **MP**. The program names seats by their distance from the button, so six-handed
play starts at the seat that is third at an eight-handed table; elsewhere the same seat is called UTG or LJ.

## 2. Acceptance rules (written before the first chart was generated: `validation/5.12/plan.json`)

| Rule | Limit | Result |
|---|---|---|
| Push/fold: the solver's exploitability inside the push/fold game | at most 5e-6 BB (the largest value in the shipped 8-max library is 4.46e-6) | largest of 23: **1.98e-06 BB**. All accepted, none re-solved. |
| 15-100 BB: exploitability inside the preflop model game, after quantisation | at most 0.002 BB (8-max: 0.00167) | largest of 9: **0.00170 BB** (25 BB). All accepted, none re-solved. |
| Reproducibility | two runs byte-identical | identical |
| 8-max files | the SHA-256 they have in 5.11 | identical |
| Structure | every chart decodes to the expected number of values, loads, and evaluates to its published metric within 5.1e-6 | 32 of 32 (`tests/v512.test.js`) |

**What these exploitabilities mean.** The push/fold number is the most any one seat can gain by deviating *inside the
push/fold game* (first in: all-in or fold; later seats: call or fold; the first caller ends the action heads-up; card
removal by pairs of hands). The 15-100 BB number is the same inside the *preflop model game* (169 hand classes, fixed
sizes per depth, at most three players to a flop, flop values from a fitted equity-realization estimate). They say
how well the model game was solved. They do not say how far the charts are from the equilibrium of six-handed poker.
The realization coefficients were fitted on EightMax's own heads-up flop solves and are used unchanged; they were not
refitted for six seats.

Reported, not part of a rule: after the 6-bit quantisation the interface loads, the push/fold charts are within
**6.5e-06 BB** of equilibrium in the push/fold game (8-max: 9.7e-06 BB).

## 3. The charts in numbers

First-in all-in frequency (push/fold), percent of hands:

| Stack | MP | HJ | CO | BTN | SB | iterations | exploitability (BB) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 BB | 82.2 | 82.2 | 82.2 | 82.8 | 92.2 | 250 | 1.44e-06 |
| 4 BB | 46.0 | 48.7 | 52.6 | 59.9 | 82.8 | 450 | 1.85e-06 |
| 5 BB | 32.4 | 35.6 | 43.3 | 50.2 | 79.4 | 400 | 1.89e-06 |
| 6 BB | 28.9 | 32.6 | 38.5 | 46.7 | 76.2 | 350 | 1.87e-06 |
| 7 BB | 26.7 | 30.6 | 35.2 | 45.1 | 74.1 | 350 | 1.63e-06 |
| 8 BB | 23.2 | 28.9 | 33.5 | 43.0 | 72.8 | 450 | 1.19e-06 |
| 9 BB | 22.2 | 26.9 | 31.8 | 41.4 | 70.3 | 350 | 1.93e-06 |
| 10 BB | 20.2 | 25.4 | 31.5 | 38.1 | 67.7 | 3600 | 1.81e-06 |
| 11 BB | 19.7 | 23.8 | 30.4 | 36.6 | 63.8 | 850 | 1.57e-06 |
| 12 BB | 17.5 | 21.9 | 29.2 | 35.7 | 63.5 | 500 | 1.82e-06 |
| 13 BB | 16.9 | 20.7 | 27.8 | 34.6 | 61.0 | 900 | 1.75e-06 |
| 14 BB | 15.9 | 20.1 | 26.0 | 33.5 | 60.2 | 800 | 1.33e-06 |
| 15 BB | 15.0 | 18.4 | 24.8 | 33.5 | 57.2 | 1000 | 1.91e-06 |
| 16 BB | 13.6 | 17.7 | 23.8 | 33.0 | 55.2 | 1250 | 1.80e-06 |
| 17 BB | 13.5 | 17.0 | 22.7 | 32.4 | 53.4 | 950 | 1.57e-06 |
| 18 BB | 13.1 | 16.2 | 21.6 | 30.9 | 52.3 | 1050 | 1.97e-06 |
| 19 BB | 12.5 | 15.1 | 21.2 | 30.6 | 50.2 | 700 | 1.88e-06 |
| 20 BB | 11.7 | 14.2 | 19.4 | 29.4 | 48.4 | 800 | 1.98e-06 |
| 21 BB | 10.8 | 14.0 | 18.8 | 29.1 | 46.3 | 1200 | 1.71e-06 |
| 22 BB | 10.2 | 13.7 | 18.4 | 27.3 | 45.7 | 3550 | 1.92e-06 |
| 23 BB | 9.9 | 13.3 | 18.1 | 27.0 | 43.9 | 1250 | 1.57e-06 |
| 24 BB | 9.2 | 12.9 | 17.2 | 26.3 | 43.6 | 1300 | 1.85e-06 |
| 25 BB | 9.2 | 12.0 | 16.4 | 23.6 | 43.2 | 1050 | 1.98e-06 |

First-in raise frequency (15-100 BB charts), percent of hands; the small blind also limps (in brackets):

| Stack | MP | HJ | CO | BTN | SB [limp] | open / SB open | iterations | model exploitability (BB) |
|---:|---:|---:|---:|---:|---:|---|---:|---:|
| 15 BB | 17.0 | 20.9 | 25.9 | 36.5 | 32.6 [46.1] | 2 / 3 | 375 | 0.00107 |
| 20 BB | 18.4 | 22.0 | 27.3 | 36.6 | 24.2 [57.7] | 2 / 3 | 475 | 0.00092 |
| 25 BB | 20.0 | 24.1 | 29.6 | 39.7 | 22.1 [60.2] | 2 / 3 | 725 | 0.00170 |
| 30 BB | 21.5 | 25.6 | 31.6 | 42.3 | 24.2 [57.1] | 2 / 3 | 1100 | 0.00151 |
| 40 BB | 22.7 | 26.6 | 33.0 | 46.0 | 30.5 [49.1] | 2.2 / 3 | 1075 | 0.00150 |
| 50 BB | 22.5 | 26.7 | 34.5 | 47.6 | 33.8 [44.2] | 2.2 / 3 | 1025 | 0.00124 |
| 60 BB | 22.0 | 26.2 | 34.4 | 50.2 | 35.2 [41.6] | 2.2 / 3 | 900 | 0.00096 |
| 80 BB | 17.9 | 23.0 | 30.4 | 49.7 | 32.6 [44.7] | 2.3 / 3 | 950 | 0.00103 |
| 100 BB | 17.4 | 22.4 | 30.0 | 47.3 | 28.2 [49.8] | 2.3 / 3 | 1100 | 0.00121 |

## 4. Six seats beside eight (information)

Same seat name, same depth, 6-max chart minus 8-max chart, 160 pairs (115 push/fold, 45 at 15-100 BB). The rule written
beforehand: information only; expected, not proven, "equal or slightly tighter six-handed", because two antes less
are in the pot.

* Tighter six-handed in **158** pairs, wider in **2** (both in the 15-100 BB small blind: +0.68 points at most).
* The differences are large where the antes are a large part of the pot and small where they are not. Push/fold: at
  3 and 4 BB the six-handed seats move all-in 2.1 to 17.0 points less often (BTN at 3 BB: 82.8% against 99.8%); at 5
  to 9 BB 0.7 to 5.1 points less; from 10 BB up 0.5 to 4.0 points less. 15-100 BB charts, MP to BTN: 0.4 to 1.5
  points less at 15 BB, 0.0 to 2.7 points less at 20 BB and deeper. The small blind's first-in raise moves by -6.5
  points at 15 BB (its limps take the difference) and by -1.4 to +0.7 points at the other depths.

They are two different games. Nothing in the program uses one chart in place of the other.

## 5. Two other solvers of this program beside the charts (information; rule written beforehand)

The plan said: no chart is changed or rejected by these comparisons, because the other solvers play other games and
their results are sampled; every position is printed; a first-in difference above 5 points (push/fold) or 10 points
(15-100 BB) is listed as unresolved. **11 rows are unresolved by that rule.** They are below, with what is known
about each.

### 5.1 Push/fold chart against the native multiway engine

The six-handed shove/call game in the native engine: all six seats are dealt real cards, any later seat may call,
Compact hand groups (169 classes before the flop), 2,000,000 sampled deals per seed with the counter-based streams.

| Stack | Seat | Chart | Engine, seed 601 / 602 | Difference |
|---:|---|---:|---|---:|
| 8 BB | MP | 23.2 | 23.9 / 24.4 | +0.9 |
| 8 BB | HJ | 28.9 | 28.9 / 30.1 | +0.6 |
| 8 BB | CO | 33.5 | 33.1 / 32.8 | -0.6 |
| 8 BB | BTN | 43.0 | 40.0 / 41.4 | -2.3 |
| 8 BB | SB | 72.8 | 66.4 / 66.6 | -6.3 **(unresolved by the rule)** |
| 15 BB | MP | 15.0 | 15.4 / 15.4 | +0.4 |
| 15 BB | HJ | 18.4 | 17.4 / 19.3 | -0.1 |
| 15 BB | CO | 24.8 | 24.7 / 24.9 | -0.0 |
| 15 BB | BTN | 33.5 | 32.8 / 33.2 | -0.5 |
| 15 BB | SB | 57.2 | 53.5 / 53.0 | -3.9 |

MP to BTN agree within 2.3 points. The small blind does not: the engine has it moving all-in 6.3 points less often at
8 BB (above the 5-point line) and 3.9 points less at 15 BB.

**A diagnostic added after these numbers were seen** (not in the plan; labelled so in the tool's output): the same
engine and stacks, but only the two blinds are dealt cards.

| Stack | Chart | Engine, six seats dealt | Engine, only the blinds dealt |
|---:|---:|---|---|
| 8 BB | 72.8 | 66.4 / 66.6 | 72.1 / 71.5 |
| 15 BB | 57.2 | 53.5 / 53.0 | 58.0 / 56.5 |

With no cards in the folded seats the engine is within about 1 point of the chart. The difference therefore comes
from the cards of the four players who folded: they folded their weak hands, so the big blind holds a strong hand
more often than a random one, and the small blind moves in less. **The push/fold charts do not model that** - the
8-max charts never did. For the small blind at 8 BB the effect is about 6 points of range in this measurement; the
measurement is two seeds of a sampled training and carries no confidence interval. What the effect costs in BB was
not measured.

### 5.2 15-100 BB chart against the linked preflop-to-river solver

As `tools/chart_validation29.js` did for 8-max in 2.9: the JavaScript solver that plays the flop, turn and river
with real cards (one bet size per street, opens of the chart's sizes, 3x or all-in raises, no limps, Detailed hand
groups), six seats, seeds 17 and 29, 20,000 updates.

| Stack | Seat | Chart raise [limp] | Linked solver, seed 17 / 29 | Difference |
|---:|---|---|---|---:|
| 15 BB | MP | 17.0 [0.0] | 35.0 / 33.1 | +17.0 |
| 15 BB | HJ | 20.9 [0.0] | 36.4 / 40.6 | +17.6 |
| 15 BB | CO | 25.9 [0.0] | 41.7 / 46.7 | +18.3 |
| 15 BB | BTN | 36.5 [0.0] | 53.1 / 49.8 | +15.0 |
| 15 BB | SB | 32.6 [46.1] | 69.8 / 70.8 | +37.7 |
| 25 BB | MP | 20.0 [0.0] | 37.4 / 36.5 | +16.9 |
| 25 BB | HJ | 24.1 [0.0] | 40.2 / 42.3 | +17.1 |
| 25 BB | CO | 29.6 [0.0] | 44.5 / 43.6 | +14.4 |
| 25 BB | BTN | 39.7 [0.0] | 53.4 / 48.4 | +11.1 |
| 25 BB | SB | 22.1 [60.2] | 69.5 / 72.0 | +48.7 |

**All ten rows are above the 10-point line: unresolved.** What is known:

* The same disagreement was reported for the 8-max charts in 2.9 (`validation/2.9/chart-validation.json`, 150,000
  updates: the linked solver opened 29 to 30% under the gun at 15 BB against the chart's 13%, "about twice above the
  charts"). It is not new and not particular to six seats.
* The small blind rows are not comparable: the linked game has no limps, the chart's small blind limps 46 to 60%.
* The linked solver is not a reference answer either: 20,000 updates of a sampled trainer on a six-handed tree with
  three streets is far from converged, and early in training such a solver opens too wide. The chart's flop values
  are an estimate fitted on heads-up solves.
* **Which of the two is nearer to six-handed equilibrium is not established by this release.** The interface says
  "Approximate preflop model" on every one of these charts and offers "Re-solve with postflop play"; that label
  stays. Phase 9 of the plan (preflop from real postflop solves) is where this is to be settled.

## 6. What is proven, tested, not known

| | |
|---|---|
| Proven | nothing new: this phase adds no mathematics |
| Tested (deterministic, repeatable) | the 6-max files are what the 8-max generator writes for six seats; each chart solves its model game to the stated tolerance; the interface shows the numbers of the file (the percentage on the page was compared with the chart decoded independently) |
| Measured, information only | section 4, section 5 |
| Not known | how far any chart, six-handed or eight-handed, is from the equilibrium of the full game; the cost in BB of ignoring the folded players' cards; whether the realization estimate is right for six seats |

## 7. Reproducing

```sh
node source/tools/gen_charts.js 6                                   # web/lib_charts6.js (15 s)
node source/tools/gen_deep.js solve 15,20,25,30,40,50,60,80,100 6   # build/charts/deeplib6_<S>.json (about 3 minutes)
node source/tools/gen_deep.js merge 6                               # web/lib_deeplib6.js
node source/tools/library512.js out.json                            # sections 3 and 4
node source/tools/chart_validation512.js build/linux/mwcli out.json # section 5 (about 6 minutes)
```
