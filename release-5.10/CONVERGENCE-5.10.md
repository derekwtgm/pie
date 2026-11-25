# EightMax 5.10: convergence

Does 5.10 train better strategies than 5.9? Build `7fa0e8c16d6c6ade`. Evidence: `validation/5.10/convergence/` (`exact/`: the
experiment with exact NashConv; `fixtures/`: the shipped fixtures; `convergence510.py`: the runner, whose docstring is
the plan; `tables510.py`: every table below is generated from the evidence files).

## 1. Summary

| Question | Answer | Basis |
|---|---|---|
| Default trainer, 5.10 against 5.9 | **Identical strategies.** The same states byte for byte at equal deals; no difference at equal time | 2,000 of 2,000 states (20 games x 20 seeds x 5 budgets); section 3 |
| `rbes` against the default trainer, **equal training time** (4 s, the primary comparison) | **Lower exact NashConv on 11 of 20 games, no resolved difference on 9, higher on none.** Geometric-mean ratio 0.30 to 0.92 on the eleven | 20 paired seeds per game, Bonferroni over the 20 games; section 4.1 |
| `rbes`, equal sampled deals | lower on 82 of 100 game-budget cells (ratio 0.08 to 0.87), unresolved on 18, higher on none | section 4.2 |
| Where it helps | games in which a seat holds many hands: heads-up to four-player river and turn games with ranges, the ICM river games, the three-street tournament games | section 4 |
| Where exact NashConv did NOT show it to help at equal time | **both small six-player flop games, both eight-handed push-or-fold games**, the three bubble games, and two small games | sections 5 and 6 |
| Shipped fixtures with hand groups (no exact NashConv exists) | Lower bounds from a trained response, not certificates. At 250,000 equal deals the search certifies 0.89 to 1.02 BB (six-player flop) and 0.45 to 0.57 BB (three-player flop) against the default trainer and at most 0.04 BB against `rbes`; after 30 s of training the default response search certifies nothing against either. **With a stronger response search (a response trained by `rbes`; exploratory) the bound certified after 30 s is 0.73 to 1.06 BB against the default trainer and 0.15 to 0.25 BB against `rbes` on the six-player fixture, and 0.22 to 0.34 against 0.14 to 0.19 BB on the three-player fixture: lower against `rbes` in every seed** | section 7; diagnostics only |
| Decision by the rule written before the run | `rbes` is **recommended, as an opt-in**, for games with ranges and for the tournament-stage games; **not** for games with a handful of hands a seat; **the default trainer is not replaced** | section 4.6 |

In one sentence: 5.10 contains a trainer that converges faster than 5.9's on a defined class of games, shown at equal
wall-clock time with exact NashConv; for six-player flops the exact evidence is unresolved and the best available
diagnostic on the shipped fixture favours the new trainer consistently without being a proof; for eight-handed
push-or-fold play there is no evidence of an improvement; and the default trainer is 5.9's.

## 2. The plan (written before the first measurement)

`validation/5.10/convergence/exact/plan.json` was written at 2026-11-25T00:40:07Z, before any training of the experiment
started; the runner refuses to reuse an output directory. Its content, in words:

* **Question.** Does `rbes` reach a lower exact NashConv than the default trainer at equal sampled deals and at
  equal wall-clock training time?
* **Games.** 20 reference games small enough for the exact best response of every seat AND played with the exact
  abstraction (a table row is one hand), so that NashConv falls to 0 with training and measures nothing but the
  distance to equilibrium inside the game. Three classes, fixed in the plan: "few hands" (the seven games of the 5.9
  experiment, one to six hands a seat), "ranges" (eight 5.10 games, 5 to 59 hands a seat), "tournament" (five 5.8
  tournament-stage games). Hand-group fixtures are excluded from this measure on purpose: an exact best response
  that sees the cards has a floor there that training cannot remove (TRAINING-ENGINE-5.10.md, 2.2, item 10). One
  game, `rg-flop6c`, uses Compact groups that happen to separate its three or four hands a seat.
* **Arms**, the same 20 seeds (5101 to 5120) for every arm: `d59`, the unchanged 5.9 program; `d510`, the 5.10
  program with the default trainer; `rbes`, the 5.10 program with `{"estimator":"rbes"}`. One thread, 512 MiB table.
* **Budgets.** Equal deals: 20,000 / 100,000 / 250,000 / 500,000 / 1,000,000 sampled deals. Equal time: 0.25 s, 1 s
  and 4 s of training, each a fresh run stopped by the clock (the deals each arm processed are recorded).
* **Measure.** Exact NashConv of the average strategy (the sum over the seats of exact best-response gain;
  `mwcli --gain`, method exact), in BB for chip-EV games and in the prize unit for ICM games. For more than two
  seats NashConv is not exploitability; it is the sum of what each seat could gain by deviating alone.
* **Statistic.** Per game and budget, the mean over seeds of ln(NashConv rbes / NashConv default), paired by seed,
  with a Student-t interval. **Primary family:** 4 s of training, one interval per game, each at level 0.05 / 20.
  **Secondary family:** all eight budgets of all games, 160 intervals, each at level 0.05 / 160. Verdicts: "better"
  (whole interval below 1), "worse" (above 1), "unresolved".
* **Rule.** R1: the exact checks of the estimator pass, otherwise nothing counts. R2: `rbes` is RECOMMENDED for a
  class when it is "better" in the primary family on at least half of the class's games and "worse" in no secondary
  interval of the class. R3: `rbes` REPLACES the default only if it is recommended in all three classes, "worse"
  nowhere, reaches no table limit the default does not reach, AND three conditions the experiment cannot establish
  hold: the JavaScript reference trainer implements it, it supports every configuration the default supports, and it
  has run on physical Windows. The plan states that those three are known not to hold in 5.10, so the strongest
  outcome available was "recommended (opt-in)".
* **Stopping rule.** Every game x seed x arm x budget once; no interim analysis.

**What happened during the run.** 8,800 measurements, 0 errors. The run was interrupted twice and continued with
`--resume` (the stored plan must equal the plan of the arguments; complete game-seed units are kept; a unit that was
cut off is run again from its beginning; nothing is analysed in between): once when the machine was restarted
(`resume-1.json`: 93 units complete, 3 cut off) and once when the session's limit for a background job ended the
runner (`resume-2.json`: 255 complete, 3 cut off). The files as they were before each resume are kept
(`raw.before-resume-*.jsonl.gz`). During the run, the rows of the first seed of one game (`flop6`) were looked at
while the runner was being watched; nothing else was read before the run was complete, and no plan, criterion or
code of the experiment was changed after the plan was written except the addition of `--resume`.

**The program.** The experiment ran with a candidate build of the 5.10 engine (`2ac7ac02dd7ca797`). Tests, tools and
documents were completed afterwards, which changes the build identifier but not the trainers:
the released program (build `7fa0e8c16d6c6ade`) was run on 160 cells of the experiment (the first and the last seed of every game, both 5.10 arms, 20,000 and 100,000 deals) and wrote 160 of 160 recorded states and 80 of 80 recorded NashConv values exactly (`validation/5.10/convergence/reproduce.json`).

**Limits of the design**, stated in the plan: small games with exact evaluation only; the equal-time budgets are
wall-clock on a shared four-processor machine on which three units ran at once and, for most of the run, one more
job of this development; the arm order rotates with the seed, so the load does not favour an arm, but it adds noise
to the equal-time cells.

| Game | Class | What it is |
|---|---|---|
| `hu-river` | few hands | Heads-up river, chip EV |
| `hu-turn` | few hands | Heads-up turn and river, chip EV |
| `river3-chip` | few hands | Three-player river, unequal stacks, side pots, chip EV |
| `turn4` | few hands | Four-player turn and river, unequal stacks, all-in or check/fold on the turn, half-pot river bet, two hands a seat, chip EV |
| `flop6` | few hands | Six-player flop, unequal stacks (3 to 50 bb), all-in or fold, two hands a seat, side pots, chip EV |
| `final8` | few hands | Eight-player final table push/fold, fixed hands (ICM: 8 paid) |
| `bubble4` | few hands | Four-player bubble push/fold, weighted two-hand ranges, short stack (ICM: 3 paid) |
| `rg-hu-river` | ranges | Heads-up river, ranges of about 58 hands a seat, half-pot bet or all-in and an all-in raise, chip EV |
| `rg-river3` | ranges | Three-player river, ranges of about 30 hands a seat, unequal stacks, side pots, chip EV |
| `rg-hu-turn` | ranges | Heads-up turn and river, ranges of about 30 hands a seat, chip EV |
| `rg-turn3` | ranges | Three-player turn and river, ranges of about 22 hands a seat, unequal stacks, two turn bet sizes and an all-in raise, chip EV |
| `rg-turn4` | ranges | Four-player turn and river, ranges of about 11 hands a seat, unequal stacks (6 to 40 BB), chip EV |
| `rg-icm3-river` | ranges | Final three: river with ranges of about 30 hands a seat, unequal stacks and side pots (ICM, three prizes) |
| `rg-bubble4` | ranges | Bubble: four players, three paid, push or fold, five weighted hands a seat (ICM) |
| `rg-flop6c` | ranges | Six-player flop with Compact hand groups, three or four hands a seat, half-pot bet or all-in, side pots, chip EV |
| `early3-flop` | tournament | Early stage, deep stacks: three-player flop, two flop bet sizes, turn and river bets, weighted ranges, chip EV |
| `mid3-turn` | tournament | Medium stacks: three-player turn and river, two turn bet sizes and an all-in raise, weighted ranges, unequal stacks, chip EV |
| `short8-push` | tournament | Short stacks: eight-handed push or fold, unequal stacks of 5 to 15 BB, weighted two-hand ranges, chip EV |
| `bubble5-icm` | tournament | Bubble: five players, four paid, unequal stacks, weighted two-hand ranges, push or fold (ICM) |
| `sidepot3-icm` | tournament | Final three: river with unequal stacks and side pots, two bet sizes and an all-in raise (ICM, three prizes) |

## 3. The default trainer of 5.10 is the default trainer of 5.9

At equal sampled deals `d510` wrote the state `d59` wrote, SHA-256 for SHA-256:

| Game | States compared (seeds x budgets) | Identical to the 5.9 program |
|---|---|---|
| `hu-river` | 100 | 100 |
| `hu-turn` | 100 | 100 |
| `river3-chip` | 100 | 100 |
| `turn4` | 100 | 100 |
| `flop6` | 100 | 100 |
| `final8` | 100 | 100 |
| `bubble4` | 100 | 100 |
| `rg-hu-river` | 100 | 100 |
| `rg-river3` | 100 | 100 |
| `rg-hu-turn` | 100 | 100 |
| `rg-turn3` | 100 | 100 |
| `rg-turn4` | 100 | 100 |
| `rg-icm3-river` | 100 | 100 |
| `rg-bubble4` | 100 | 100 |
| `rg-flop6c` | 100 | 100 |
| `early3-flop` | 100 | 100 |
| `mid3-turn` | 100 | 100 |
| `short8-push` | 100 | 100 |
| `bubble5-icm` | 100 | 100 |
| `sidepot3-icm` | 100 | 100 |
| **all** | **2000** | **2000** |

In addition `validation/5.10/identity/` compares the two programs on ten reference games and five fixtures with
hand groups for 1, 2, 4 and 8 threads, the measured thread choice, trainer options and table limits: 225 configurations, 1,782 trainings, 0 differences.

At equal time the two default trainers are not distinguishable (all 20 intervals contain 1). The 5.10 program
processed a median of 98% (87% to 106% over the 20 games) of the deals of the 5.9 program in 4 s on these small games (PERFORMANCE-5.10.md
has the measurement on an idle machine):

| Game | NashConv after 4 s: 5.9 default (median) | 5.10 default | Ratio 5.10 / 5.9 [interval at level 0.0025] | Deals in 4 s: 5.9 | 5.10 |
|---|---|---|---|---|---|
| `hu-river` | 0.0143 | 0.0134 | 0.979 [0.806, 1.19] unresolved | 6,262,528 | 5,970,816 |
| `hu-turn` | 0.0248 | 0.0252 | 0.979 [0.901, 1.06] unresolved | 4,891,232 | 4,794,528 |
| `river3-chip` | 0.0104 | 0.0101 | 1.04 [0.837, 1.29] unresolved | 3,691,648 | 3,558,432 |
| `turn4` | 3.71e-06 | 3.60e-06 | 1.1 [0.877, 1.37] unresolved | 2,311,808 | 2,237,120 |
| `flop6` | 0.0295 | 0.0383 | 1.2 [0.912, 1.57] unresolved | 1,324,576 | 1,230,048 |
| `final8` | 6.76e-07 | 7.07e-07 | 1.19 [0.902, 1.56] unresolved | 916,736 | 798,464 |
| `bubble4` | 8.03e-08 | 1.04e-07 | 1.03 [0.879, 1.2] unresolved | 2,702,592 | 2,615,296 |
| `rg-hu-river` | 0.0232 | 0.0228 | 0.99 [0.87, 1.13] unresolved | 4,900,224 | 5,171,808 |
| `rg-river3` | 0.0081 | 0.0078 | 1.01 [0.859, 1.2] unresolved | 2,938,080 | 2,972,384 |
| `rg-hu-turn` | 0.0430 | 0.0426 | 0.983 [0.899, 1.07] unresolved | 3,907,904 | 3,899,872 |
| `rg-turn3` | 0.7953 | 0.7880 | 0.983 [0.894, 1.08] unresolved | 1,045,920 | 1,022,656 |
| `rg-turn4` | 0.0759 | 0.0725 | 1.02 [0.872, 1.2] unresolved | 1,684,160 | 1,577,664 |
| `rg-icm3-river` | 0.0288 | 0.0302 | 0.995 [0.92, 1.08] unresolved | 2,553,920 | 2,446,784 |
| `rg-bubble4` | 0.0175 | 0.0166 | 0.956 [0.708, 1.29] unresolved | 2,325,760 | 2,463,872 |
| `rg-flop6c` | 0.1977 | 0.1994 | 1.01 [0.859, 1.18] unresolved | 663,840 | 676,576 |
| `early3-flop` | 14.8624 | 14.8923 | 0.99 [0.958, 1.02] unresolved | 321,376 | 331,712 |
| `mid3-turn` | 0.3888 | 0.4114 | 1.01 [0.944, 1.09] unresolved | 1,583,552 | 1,559,232 |
| `short8-push` | 0.0080 | 0.0097 | 0.975 [0.655, 1.45] unresolved | 792,576 | 813,568 |
| `bubble5-icm` | 2.77e-07 | 3.04e-07 | 1.07 [0.906, 1.26] unresolved | 1,965,696 | 1,884,800 |
| `sidepot3-icm` | 0.0316 | 0.0341 | 1.04 [0.87, 1.24] unresolved | 3,183,648 | 3,125,568 |

## 4. `rbes` against the default trainer: exact NashConv

### 4.1 Equal training time: 4 seconds (the primary family)

| Game | Class | NashConv after 4 s, default (median of 20 seeds) | rbes | Ratio of geometric means rbes / default [interval at level 0.0025] | Seeds with rbes lower | Deals in 4 s: default | rbes |
|---|---|---|---|---|---|---|---|
| `hu-river` | few hands | 0.0134 | 0.0100 | 0.743 [0.585, 0.945] **better** | 16 of 20 | 5,970,816 | 1,729,792 |
| `hu-turn` | few hands | 0.0252 | 0.0192 | 0.792 [0.678, 0.925] **better** | 17 of 20 | 4,794,528 | 2,372,256 |
| `river3-chip` | few hands | 0.0101 | 0.0150 | 1.32 [0.854, 2.05] unresolved | 6 of 20 | 3,558,432 | 1,219,136 |
| `turn4` | few hands | 3.60e-06 | 3.31e-06 | 0.828 [0.522, 1.31] unresolved | 12 of 20 | 2,237,120 | 1,141,824 |
| `flop6` | few hands | 0.0383 | 0.0314 | 0.877 [0.495, 1.56] unresolved | 11 of 20 | 1,230,048 | 733,888 |
| `final8` | few hands | 7.07e-07 | 1.07e-06 | 1.25 [0.376, 4.16] unresolved | 7 of 20 | 798,464 | 575,872 |
| `bubble4` | few hands | 1.04e-07 | 3.63e-08 | 0.46 [0.128, 1.65] unresolved | 14 of 20 | 2,615,296 | 1,543,680 |
| `rg-hu-river` | ranges | 0.0228 | 0.0140 | 0.626 [0.525, 0.746] **better** | 20 of 20 | 5,171,808 | 301,600 |
| `rg-river3` | ranges | 0.0078 | 0.0035 | 0.421 [0.31, 0.573] **better** | 19 of 20 | 2,972,384 | 373,792 |
| `rg-hu-turn` | ranges | 0.0426 | 0.0386 | 0.887 [0.79, 0.996] **better** | 17 of 20 | 3,899,872 | 483,296 |
| `rg-turn3` | ranges | 0.7880 | 0.5071 | 0.643 [0.603, 0.685] **better** | 20 of 20 | 1,022,656 | 241,696 |
| `rg-turn4` | ranges | 0.0725 | 0.0517 | 0.666 [0.508, 0.874] **better** | 17 of 20 | 1,577,664 | 495,936 |
| `rg-icm3-river` | ranges | 0.0302 | 0.0093 | 0.303 [0.243, 0.377] **better** | 20 of 20 | 2,446,784 | 333,728 |
| `rg-bubble4` | ranges | 0.0166 | 0.0131 | 0.731 [0.451, 1.18] unresolved | 14 of 20 | 2,463,872 | 1,010,688 |
| `rg-flop6c` | ranges | 0.1994 | 0.1674 | 0.874 [0.536, 1.43] unresolved | 12 of 20 | 676,576 | 355,168 |
| `early3-flop` | tournament | 14.8923 | 13.5531 | 0.919 [0.892, 0.947] **better** | 20 of 20 | 331,712 | 137,024 |
| `mid3-turn` | tournament | 0.4114 | 0.3581 | 0.86 [0.771, 0.96] **better** | 17 of 20 | 1,559,232 | 709,312 |
| `short8-push` | tournament | 0.0097 | 0.0119 | 1.28 [0.736, 2.22] unresolved | 4 of 20 | 813,568 | 429,440 |
| `bubble5-icm` | tournament | 3.04e-07 | 1.55e-07 | 0.544 [0.195, 1.52] unresolved | 13 of 20 | 1,884,800 | 1,139,328 |
| `sidepot3-icm` | tournament | 0.0341 | 0.0213 | 0.631 [0.465, 0.855] **better** | 18 of 20 | 3,125,568 | 1,011,520 |

Eleven games "better", nine "unresolved", none "worse". In 4 seconds `rbes` processes between a seventeenth and
three quarters of the deals the default processes (last two columns) and still ends lower where a seat holds many
hands. The three point estimates above 1 (`river3-chip` 1.32, `short8-push` 1.28, `final8` 1.25) are unresolved:
their intervals contain 1, and in each of them `rbes` was lower in 4 to 7 of 20 seeds. They are the games to keep
in mind as possible losses.

### 4.2 Every budget (the secondary family; ratio of geometric means, rbes / default)

✓ better, ~ unresolved, ✗ worse, each at level 0.05 / 160.

| Game | 20,000 deals | 100,000 deals | 250,000 deals | 500,000 deals | 1,000,000 deals | 0.25 s | 1 s | 4 s |
|---|---|---|---|---|---|---|---|---|
| `hu-river` | 0.334 ✓ | 0.311 ✓ | 0.32 ✓ | 0.358 ✓ | 0.355 ✓ | 0.697 ~ | 0.702 ~ | 0.743 ~ |
| `hu-turn` | 0.514 ✓ | 0.573 ✓ | 0.549 ✓ | 0.547 ✓ | 0.541 ✓ | 0.81 ~ | 0.784 ~ | 0.792 ✓ |
| `river3-chip` | 0.575 ✓ | 0.653 ✓ | 0.569 ✓ | 0.652 ✓ | 0.665 ~ | 0.956 ~ | 1.09 ~ | 1.32 ~ |
| `turn4` | 0.162 ✓ | 0.215 ✓ | 0.216 ✓ | 0.217 ✓ | 0.217 ✓ | 0.81 ~ | 0.809 ~ | 0.828 ~ |
| `flop6` | 0.528 ✓ | 0.667 ~ | 0.765 ~ | 0.658 ~ | 0.668 ~ | 0.878 ~ | 0.882 ~ | 0.877 ~ |
| `final8` | 0.599 ~ | 0.611 ~ | 0.611 ~ | 0.611 ~ | 0.611 ~ | 1.36 ~ | 1.28 ~ | 1.25 ~ |
| `bubble4` | 0.153 ✓ | 0.153 ✓ | 0.153 ✓ | 0.153 ✓ | 0.153 ✓ | 0.396 ~ | 0.46 ~ | 0.46 ~ |
| `rg-hu-river` | 0.132 ✓ | 0.11 ✓ | 0.116 ✓ | 0.131 ✓ | 0.126 ✓ | 0.612 ✓ | 0.55 ✓ | 0.626 ✓ |
| `rg-river3` | 0.18 ✓ | 0.135 ✓ | 0.108 ✓ | 0.127 ✓ | 0.107 ✓ | 0.612 ~ | 0.484 ✓ | 0.421 ✓ |
| `rg-hu-turn` | 0.258 ✓ | 0.286 ✓ | 0.292 ✓ | 0.285 ✓ | 0.276 ✓ | 0.94 ~ | 0.898 ~ | 0.887 ~ |
| `rg-turn3` | 0.311 ✓ | 0.29 ✓ | 0.301 ✓ | 0.303 ✓ | 0.323 ✓ | 0.647 ✓ | 0.654 ✓ | 0.643 ✓ |
| `rg-turn4` | 0.182 ✓ | 0.207 ✓ | 0.232 ✓ | 0.308 ✓ | 0.375 ✓ | 0.607 ✓ | 0.624 ✓ | 0.666 ✓ |
| `rg-icm3-river` | 0.0789 ✓ | 0.0821 ✓ | 0.0856 ✓ | 0.102 ✓ | 0.131 ✓ | 0.276 ✓ | 0.281 ✓ | 0.303 ✓ |
| `rg-bubble4` | 0.386 ✓ | 0.399 ✓ | 0.373 ✓ | 0.39 ✓ | 0.399 ✓ | 0.734 ~ | 0.637 ~ | 0.731 ~ |
| `rg-flop6c` | 0.488 ✓ | 0.638 ✓ | 0.698 ~ | 0.689 ~ | 0.736 ~ | 0.779 ~ | 0.892 ~ | 0.874 ~ |
| `early3-flop` | 0.87 ✓ | 0.789 ✓ | 0.739 ✓ | 0.719 ✓ | 0.684 ✓ | 1 ~ | 0.957 ✓ | 0.919 ✓ |
| `mid3-turn` | 0.615 ✓ | 0.578 ✓ | 0.59 ✓ | 0.629 ✓ | 0.666 ✓ | 0.771 ✓ | 0.78 ✓ | 0.86 ✓ |
| `short8-push` | 0.872 ~ | 0.806 ~ | 0.966 ~ | 0.935 ~ | 0.726 ~ | 1.1 ~ | 1.47 ~ | 1.28 ~ |
| `bubble5-icm` | 0.206 ✓ | 0.205 ✓ | 0.205 ✓ | 0.205 ✓ | 0.205 ✓ | 0.583 ~ | 0.559 ~ | 0.544 ~ |
| `sidepot3-icm` | 0.301 ✓ | 0.399 ✓ | 0.338 ✓ | 0.367 ✓ | 0.45 ✓ | 0.583 ✓ | 0.573 ✓ | 0.631 ✓ |

At equal deals the advantage is large and nearly universal (82 of 100 cells; none worse). At equal time it shrinks
to what section 4.1 shows, because a deal of `rbes` costs 1.5 to 17 times a deal of the default (section 4.4).
Equal deals is not the comparison a user faces; equal time is.

### 4.3 The NashConv values themselves (median over 20 seeds)

BB for chip-EV games, prize units for the ICM games (`final8`, `bubble4`, `rg-icm3-river`, `rg-bubble4`,
`bubble5-icm`, `sidepot3-icm`).

| Game | Trainer | 20,000 deals | 100,000 deals | 250,000 deals | 500,000 deals | 1,000,000 deals | 0.25 s | 1 s | 4 s |
|---|---|---|---|---|---|---|---|---|---|
| `hu-river` | default | 0.3108 | 0.1186 | 0.0718 | 0.0498 | 0.0326 | 0.0589 | 0.0274 | 0.0134 |
| `hu-river` | rbes | 0.1005 | 0.0375 | 0.0239 | 0.0180 | 0.0126 | 0.0381 | 0.0193 | 0.0100 |
| `hu-turn` | default | 0.3664 | 0.1609 | 0.1027 | 0.0740 | 0.0524 | 0.0954 | 0.0495 | 0.0252 |
| `hu-turn` | rbes | 0.1842 | 0.0927 | 0.0553 | 0.0423 | 0.0280 | 0.0806 | 0.0390 | 0.0192 |
| `river3-chip` | default | 0.1382 | 0.0509 | 0.0355 | 0.0240 | 0.0171 | 0.0340 | 0.0188 | 0.0101 |
| `river3-chip` | rbes | 0.0751 | 0.0318 | 0.0232 | 0.0149 | 0.0118 | 0.0333 | 0.0195 | 0.0150 |
| `turn4` | default | 0.0559 | 0.0018 | 2.87e-04 | 7.14e-05 | 1.78e-05 | 9.82e-04 | 5.98e-05 | 3.60e-06 |
| `turn4` | rbes | 0.0100 | 3.44e-04 | 5.43e-05 | 1.36e-05 | 3.38e-06 | 9.58e-04 | 5.74e-05 | 3.31e-06 |
| `flop6` | default | 0.3631 | 0.0942 | 0.0551 | 0.0473 | 0.0442 | 0.0977 | 0.0498 | 0.0383 |
| `flop6` | rbes | 0.1525 | 0.0581 | 0.0483 | 0.0332 | 0.0251 | 0.0861 | 0.0446 | 0.0314 |
| `final8` | default | 0.0011 | 4.56e-05 | 7.22e-06 | 1.80e-06 | 4.50e-07 | 1.74e-04 | 1.18e-05 | 7.07e-07 |
| `final8` | rbes | 8.29e-04 | 3.31e-05 | 5.29e-06 | 1.32e-06 | 3.31e-07 | 2.97e-04 | 1.93e-05 | 1.07e-06 |
| `bubble4` | default | 0.0017 | 6.87e-05 | 1.10e-05 | 2.75e-06 | 6.87e-07 | 2.39e-05 | 1.47e-06 | 1.04e-07 |
| `bubble4` | rbes | 2.80e-04 | 1.12e-05 | 1.79e-06 | 4.47e-07 | 1.12e-07 | 1.10e-05 | 5.76e-07 | 3.63e-08 |
| `rg-hu-river` | default | 0.4807 | 0.2061 | 0.1225 | 0.0801 | 0.0526 | 0.1144 | 0.0494 | 0.0228 |
| `rg-hu-river` | rbes | 0.0623 | 0.0232 | 0.0141 | 0.0107 | 0.0067 | 0.0720 | 0.0279 | 0.0140 |
| `rg-river3` | default | 0.2160 | 0.0698 | 0.0396 | 0.0244 | 0.0157 | 0.0497 | 0.0201 | 0.0078 |
| `rg-river3` | rbes | 0.0392 | 0.0091 | 0.0045 | 0.0033 | 0.0017 | 0.0279 | 0.0091 | 0.0035 |
| `rg-hu-turn` | default | 0.8255 | 0.3043 | 0.1864 | 0.1233 | 0.0864 | 0.1819 | 0.0855 | 0.0426 |
| `rg-hu-turn` | rbes | 0.2114 | 0.0865 | 0.0539 | 0.0357 | 0.0236 | 0.1736 | 0.0795 | 0.0386 |
| `rg-turn3` | default | 5.8061 | 2.6695 | 1.6243 | 1.1516 | 0.7941 | 3.1736 | 1.5482 | 0.7880 |
| `rg-turn3` | rbes | 1.8140 | 0.7846 | 0.4917 | 0.3444 | 0.2563 | 2.0705 | 1.0340 | 0.5071 |
| `rg-turn4` | default | 3.0213 | 0.6136 | 0.2607 | 0.1642 | 0.0983 | 0.6319 | 0.1821 | 0.0725 |
| `rg-turn4` | rbes | 0.5621 | 0.1234 | 0.0577 | 0.0461 | 0.0397 | 0.3950 | 0.1196 | 0.0517 |
| `rg-icm3-river` | default | 0.5972 | 0.2030 | 0.1180 | 0.0799 | 0.0538 | 0.1502 | 0.0772 | 0.0302 |
| `rg-icm3-river` | rbes | 0.0467 | 0.0142 | 0.0101 | 0.0078 | 0.0067 | 0.0427 | 0.0207 | 0.0093 |
| `rg-bubble4` | default | 0.2092 | 0.0912 | 0.0515 | 0.0395 | 0.0261 | 0.0787 | 0.0353 | 0.0166 |
| `rg-bubble4` | rbes | 0.0809 | 0.0392 | 0.0190 | 0.0162 | 0.0102 | 0.0588 | 0.0247 | 0.0131 |
| `rg-flop6c` | default | 1.3090 | 0.4748 | 0.2604 | 0.2178 | 0.1800 | 0.8093 | 0.3549 | 0.1994 |
| `rg-flop6c` | rbes | 0.6374 | 0.2880 | 0.2083 | 0.1464 | 0.1213 | 0.7135 | 0.3187 | 0.1674 |
| `early3-flop` | default | 22.6385 | 18.5901 | 15.8249 | 13.4236 | 11.1838 | 21.4080 | 18.6827 | 14.8923 |
| `early3-flop` | rbes | 19.5808 | 14.6899 | 11.6784 | 9.6495 | 7.6524 | 21.0673 | 17.8575 | 13.5531 |
| `mid3-turn` | default | 2.8241 | 1.3697 | 0.9111 | 0.6495 | 0.4956 | 1.4887 | 0.7592 | 0.4114 |
| `mid3-turn` | rbes | 1.7161 | 0.8012 | 0.5524 | 0.4113 | 0.3260 | 1.1484 | 0.5944 | 0.3581 |
| `short8-push` | default | 0.0827 | 0.0319 | 0.0167 | 0.0127 | 0.0098 | 0.0457 | 0.0189 | 0.0097 |
| `short8-push` | rbes | 0.0753 | 0.0277 | 0.0189 | 0.0111 | 0.0076 | 0.0563 | 0.0264 | 0.0119 |
| `bubble5-icm` | default | 0.0025 | 9.96e-05 | 1.60e-05 | 4.01e-06 | 1.00e-06 | 5.91e-05 | 4.96e-06 | 3.04e-07 |
| `bubble5-icm` | rbes | 5.06e-04 | 2.03e-05 | 3.24e-06 | 8.10e-07 | 2.03e-07 | 4.68e-05 | 3.59e-06 | 1.55e-07 |
| `sidepot3-icm` | default | 0.2926 | 0.1336 | 0.0866 | 0.0658 | 0.0457 | 0.1038 | 0.0563 | 0.0341 |
| `sidepot3-icm` | rbes | 0.0890 | 0.0499 | 0.0329 | 0.0228 | 0.0206 | 0.0559 | 0.0323 | 0.0213 |

`early3-flop` (three streets, deep stacks) is far from equilibrium with either trainer at these budgets (NashConv
of 7.7 to 11.2 BB after 1,000,000 deals): the experiment measures its early descent only.

### 4.4 Cost

| Game | Seconds for 1,000,000 deals: default | rbes | Time ratio | Information sets (rows): default | rbes | Table MiB: default | rbes | Peak RSS MiB: default | rbes |
|---|---|---|---|---|---|---|---|---|---|
| `hu-river` | 0.661 | 2.43 | 3.68 | 48 | 48 | 0.062 | 0.062 | 214 | 214 |
| `hu-turn` | 0.808 | 1.74 | 2.15 | 752 | 752 | 0.116 | 0.116 | 214 | 214 |
| `river3-chip` | 1.15 | 3.31 | 2.88 | 150 | 150 | 0.069 | 0.069 | 214 | 214 |
| `turn4` | 1.75 | 3.83 | 2.18 | 5073 | 5460 | 0.545 | 0.569 | 214 | 214 |
| `flop6` | 3.28 | 5.48 | 1.67 | 382 | 383 | 0.088 | 0.088 | 214 | 214 |
| `final8` | 4.7 | 7.06 | 1.5 | 366 | 361 | 0.096 | 0.096 | 214 | 214 |
| `bubble4` | 1.53 | 2.69 | 1.75 | 28 | 28 | 0.061 | 0.061 | 214 | 214 |
| `rg-hu-river` | 0.812 | 13.9 | 17.1 | 468 | 468 | 0.091 | 0.091 | 214 | 214 |
| `rg-river3` | 1.32 | 10.8 | 8.15 | 752 | 752 | 0.12 | 0.12 | 214 | 214 |
| `rg-hu-turn` | 0.991 | 8.16 | 8.23 | 6016 | 6016 | 0.602 | 0.602 | 214 | 214 |
| `rg-turn3` | 3.91 | 16.4 | 4.19 | 84212 | 86248 | 8.19 | 8.32 | 214 | 214 |
| `rg-turn4` | 2.62 | 8.14 | 3.11 | 29717 | 33584 | 2.61 | 3.6 | 214 | 214 |
| `rg-icm3-river` | 1.63 | 11.6 | 7.13 | 752 | 752 | 0.12 | 0.12 | 214 | 214 |
| `rg-bubble4` | 1.74 | 3.89 | 2.24 | 70 | 70 | 0.065 | 0.065 | 216 | 214 |
| `rg-flop6c` | 6.2 | 11.2 | 1.81 | 1204 | 1205 | 0.275 | 0.275 | 214 | 214 |
| `early3-flop` | 14 | 31.7 | 2.26 | 1857225 | 3197902 | 161 | 291 | 216 | 345 |
| `mid3-turn` | 2.61 | 5.47 | 2.09 | 15309 | 15602 | 1.36 | 1.38 | 214 | 214 |
| `short8-push` | 5.32 | 9.26 | 1.74 | 1184 | 1205 | 0.214 | 0.216 | 216 | 216 |
| `bubble5-icm` | 2.14 | 3.79 | 1.77 | 70 | 70 | 0.065 | 0.065 | 216 | 216 |
| `sidepot3-icm` | 1.31 | 4.12 | 3.15 | 150 | 150 | 0.069 | 0.069 | 216 | 216 |

`rbes` creates the rows of every hand of the updating seat, so on a game with many rows (`early3-flop`) its table is
larger at the same number of deals; no arm reached the 512 MiB table limit in this experiment.

### 4.5 Differences between seeds

| Game | Budget | Between-seed spread of ln NashConv (standard deviation): default | rbes |
|---|---|---|---|
| `hu-river` | 1,000,000 deals | 0.292 | 0.266 |
| `hu-river` | 4 s | 0.343 | 0.255 |
| `hu-turn` | 1,000,000 deals | 0.129 | 0.0978 |
| `hu-turn` | 4 s | 0.168 | 0.105 |
| `river3-chip` | 1,000,000 deals | 0.255 | 0.356 |
| `river3-chip` | 4 s | 0.337 | 0.417 |
| `turn4` | 1,000,000 deals | 0.43 | 0.52 |
| `turn4` | 4 s | 0.803 | 0.692 |
| `flop6` | 1,000,000 deals | 0.667 | 0.522 |
| `flop6` | 4 s | 0.447 | 0.635 |
| `final8` | 1,000,000 deals | 1.53 | 1.15 |
| `final8` | 4 s | 1.65 | 1.38 |
| `bubble4` | 1,000,000 deals | 1.1 | 1.1 |
| `bubble4` | 4 s | 1.2 | 1.21 |
| `rg-hu-river` | 1,000,000 deals | 0.112 | 0.161 |
| `rg-hu-river` | 4 s | 0.25 | 0.267 |
| `rg-river3` | 1,000,000 deals | 0.197 | 0.36 |
| `rg-river3` | 4 s | 0.221 | 0.431 |
| `rg-hu-turn` | 1,000,000 deals | 0.0471 | 0.0936 |
| `rg-hu-turn` | 4 s | 0.113 | 0.181 |
| `rg-turn3` | 1,000,000 deals | 0.0325 | 0.0563 |
| `rg-turn3` | 4 s | 0.086 | 0.0819 |
| `rg-turn4` | 1,000,000 deals | 0.165 | 0.264 |
| `rg-turn4` | 4 s | 0.192 | 0.248 |
| `rg-icm3-river` | 1,000,000 deals | 0.134 | 0.256 |
| `rg-icm3-river` | 4 s | 0.206 | 0.245 |
| `rg-bubble4` | 1,000,000 deals | 0.35 | 0.561 |
| `rg-bubble4` | 4 s | 0.284 | 0.622 |
| `rg-flop6c` | 1,000,000 deals | 0.408 | 0.464 |
| `rg-flop6c` | 4 s | 0.469 | 0.404 |
| `early3-flop` | 1,000,000 deals | 0.00735 | 0.00683 |
| `early3-flop` | 4 s | 0.0257 | 0.0317 |
| `mid3-turn` | 1,000,000 deals | 0.117 | 0.114 |
| `mid3-turn` | 4 s | 0.134 | 0.127 |
| `short8-push` | 1,000,000 deals | 0.446 | 0.524 |
| `short8-push` | 4 s | 0.537 | 0.494 |
| `bubble5-icm` | 1,000,000 deals | 1.09 | 1.5 |
| `bubble5-icm` | 4 s | 1.06 | 1.53 |
| `sidepot3-icm` | 1,000,000 deals | 0.232 | 0.289 |
| `sidepot3-icm` | 4 s | 0.256 | 0.272 |

### 4.6 The rule applied

| Class | Games | Primary (4 s): better | worse | unresolved | Secondary intervals: better | worse | of | Recommended by R2 |
|---|---|---|---|---|---|---|---|---|
| few hands | 7 | 2 | 0 | 5 | 26 | 0 | 56 | no |
| ranges | 8 | 6 | 0 | 2 | 51 | 0 | 64 | yes |
| tournament | 5 | 3 | 0 | 2 | 28 | 0 | 40 | yes |

* **R1** holds: MATHEMATICAL-VALIDATION-5.10.md (65 of 65 checks of the final run).
* **R2**: `rbes` is recommended for the classes "ranges" and "tournament" and not for "few hands" (2 of 7 primary
  intervals better).
* **R3**: not met statistically (one class is not recommended), and its three non-statistical conditions do not
  hold. **The default trainer is not replaced.**

## 5. Six-player postflop

The assignment names this as the practical benchmark. What the evidence says:

| Game | Equal time, 4 s | Equal deals |
|---|---|---|
| `flop6` (six players, all-in or fold on the flop, two hands a seat, side pots) | unresolved: 0.877, interval 0.495 to 1.56; lower in 11 of 20 seeds | better at 20,000 deals (0.53); unresolved from 100,000 to 1,000,000 (0.66 to 0.77) |
| `rg-flop6c` (six players, three or four hands a seat, half-pot bet or all-in, side pots) | unresolved: 0.874, interval 0.536 to 1.43; lower in 12 of 20 seeds | better at 20,000 and 100,000 deals (0.49, 0.64); unresolved from 250,000 (0.69 to 0.74) |
| `flop6-jack` (the shipped fixture, 59 to 125 hands a seat, Compact groups) | no exact NashConv exists; lower bounds only (section 7). Stronger search, exploratory: 0.73 to 1.06 BB certified against the default after 30 s, 0.15 to 0.25 BB against `rbes`; after 6 s 2.42 to 2.78 against 1.11 to 1.71 BB | stronger search: 2.52 to 2.67 BB against the default at 250,000 deals, 0.26 to 0.62 BB against `rbes` |

**With exact NashConv, six-player flop convergence is not shown to improve at equal time.** Both point estimates are
below 1 (0.88 and 0.87) and both intervals are wide (about 0.5 to 1.5). **On the shipped six-player fixture the
diagnostics of section 7.3 favour `rbes` in every seed and by a factor of two to four at equal time** - but they are
lower bounds from an exploratory comparison, and a lower bound cannot settle which strategy is closer to equilibrium.

Why the small games and the fixture may differ is visible in MATHEMATICAL-VALIDATION-5.10.md, section 5.2: on the
two small six-player games measured there (`rg-flop6c`, `flop6-jack-small`) the variance of the regret increments
falls to 0.35 and 0.43 of the default's while a deal costs 2.0 and 1.7 times as much, a product of about 0.7 where
the games with ranges have 0.1 to 0.4. The lever that `rbes` pulls - the updating seat's own hand - is the smaller
part of the noise when five other seats are sampled and each seat holds two to four hands. On the fixture a seat
holds 59 to 125 hands and the same product is 0.40.

## 6. Eight-handed tournament play and ICM

| Situation | Game | Equal time, 4 s | Equal deals (five budgets) |
|---|---|---|---|
| eight-handed final table, push or fold, ICM | `final8` | unresolved (1.25) | unresolved (0.60 to 0.61) |
| eight-handed short stacks, push or fold, chip EV | `short8-push` | unresolved (1.28) | unresolved (0.73 to 0.97) |
| bubble, four players, ICM | `bubble4` | unresolved (0.46) | better (0.15) |
| bubble, four players, five hands a seat, ICM | `rg-bubble4` | unresolved (0.73) | better (0.37 to 0.40) |
| bubble, five players, ICM | `bubble5-icm` | unresolved (0.54) | better (0.21) |
| final three, river, ranges, side pots, ICM | `rg-icm3-river` | **better (0.30)** | better (0.08 to 0.13) |
| final three, river, side pots, ICM | `sidepot3-icm` | **better (0.63)** | better (0.30 to 0.45) |
| medium stacks, turn and river, chip EV | `mid3-turn` | **better (0.86)** | better (0.58 to 0.67) |
| early stage, three streets, chip EV | `early3-flop` | **better (0.92)** | better (0.68 to 0.87) |
| side pots, three players, chip EV | `river3-chip` | unresolved (1.32) | better at four budgets (0.57 to 0.65), unresolved at 1,000,000 |

**Eight-handed push-or-fold convergence did not improve**: both games are unresolved at every budget, with point
estimates on the wrong side of 1 at equal time. In push-or-fold games a seat has two actions and one or two hands,
the default trainer already reaches a NashConv of about 1e-5 prize units after one second and below 1e-6 after
four on `final8`, and there is little variance of the kind `rbes` removes. **ICM** is not the dividing line: the two ICM river games with ranges
improve clearly, the push-or-fold ICM games do not at equal time. ICM and chip-EV values are never pooled: every
ratio above is within one game and one utility.

## 7. The shipped fixtures with hand groups: what a trained response finds

`validation/5.10/convergence/fixtures/`. The six-player flop fixture (`flop6-jack`, 59 to 125 hands a seat) and the
three-player flop fixture (`flop3-kings`, 109 to 360 hands) have no exact NashConv, and with hand groups an exact
best response would be measured outside the abstraction. Both trainers were therefore given the SAME response
search (`mwcli --response`: 200,000 response deals per seat, 409,600 evaluation deals, sampled opponent actions) at
250,000 sampled deals and after 30 s of training, four seeds (5131 to 5134).

**How to read this.** The sum of trained-response gains is a LOWER bound of NashConv inside the abstraction: what
this particular response search found. A smaller value is consistent with a better strategy and does not establish
it; a weaker search, more noise or fewer evaluation deals would also make it smaller. The plan draws no verdict from
these numbers and no rule depends on them.

### 7.1 The prespecified part: 250,000 deals and 30 seconds

| Fixture | Budget | Trainer | Seeds | Mean sampled deals | Mean sum of trained-response gains (BB) | Range of the simultaneous 95% lower bound of NashConv (BB) | Mean information sets (rows) | Largest peak RSS MiB |
|---|---|---|---|---|---|---|---|---|
| `flop6-jack` | 250,000 deals | default | 4 | 250,000 | 1.2046 | 0.8936 to 1.0234 | 213,026 | 56.2 |
| `flop6-jack` | 250,000 deals | rbes | 4 | 250,000 | -0.3753 | 0.0000 to 0.0383 | 411,647 | 80 |
| `flop6-jack` | 30 s | default | 4 | 1,245,536 | -0.2620 | 0.0000 to 0.0920 | - | - |
| `flop6-jack` | 30 s | rbes | 4 | 404,336 | -0.5230 | 0.0000 to 0.0176 | - | - |
| `flop3-kings` | 250,000 deals | default | 4 | 250,000 | 0.6118 | 0.4498 to 0.5706 | 134,861 | 26 |
| `flop3-kings` | 250,000 deals | rbes | 4 | 250,000 | -0.3535 | 0.0000 to 0.0000 | 258,913 | 44.8 |
| `flop3-kings` | 30 s | default | 4 | 2,668,992 | -0.3608 | 0.0000 to 0.0000 | - | - |
| `flop3-kings` | 30 s | rbes | 4 | 315,328 | -0.3741 | 0.0000 to 0.0000 | - | - |

Every run:

| Fixture | Budget | Trainer | Seed | Sampled deals | Training s | Deals / s | Information sets (rows) | Table MiB | Peak RSS MiB | Sum of trained-response gains (estimate, BB) | Simultaneous 95% lower bound of NashConv (BB) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `flop6-jack` | 250,000 deals | default | 5131 | 250,000 | 6.18 | 40,460 | 210,214 | 19.8 | 55.4 | 1.3018 | 1.0234 |
| `flop6-jack` | 250,000 deals | default | 5132 | 250,000 | 5.35 | 46,708 | 215,366 | 20.1 | 53.9 | 1.1621 | 0.8949 |
| `flop6-jack` | 250,000 deals | default | 5133 | 250,000 | 5.45 | 45,907 | 212,597 | 19.9 | 56.2 | 1.2070 | 0.9559 |
| `flop6-jack` | 250,000 deals | default | 5134 | 250,000 | 5.6 | 44,621 | 213,927 | 20 | 55.9 | 1.1474 | 0.8936 |
| `flop6-jack` | 250,000 deals | rbes | 5131 | 250,000 | 16.7 | 14,932 | 415,383 | 38.3 | 80 | -0.3115 | 0.0000 |
| `flop6-jack` | 250,000 deals | rbes | 5132 | 250,000 | 17.4 | 14,375 | 407,658 | 37.8 | 79.4 | -0.5215 | 0.0000 |
| `flop6-jack` | 250,000 deals | rbes | 5133 | 250,000 | 17 | 14,716 | 412,577 | 38.1 | 79.8 | -0.4328 | 0.0200 |
| `flop6-jack` | 250,000 deals | rbes | 5134 | 250,000 | 17.5 | 14,288 | 410,973 | 38.1 | 79.5 | -0.2355 | 0.0383 |
| `flop6-jack` | 30 s | default | 5131 | 1,246,720 | 30 | 41,556 | - | - | - | -0.1829 | 0.0920 |
| `flop6-jack` | 30 s | default | 5132 | 1,268,096 | 30 | 42,267 | - | - | - | -0.3340 | 0.0000 |
| `flop6-jack` | 30 s | default | 5133 | 1,195,904 | 30 | 39,862 | - | - | - | -0.2776 | 0.0000 |
| `flop6-jack` | 30 s | default | 5134 | 1,271,424 | 30 | 42,380 | - | - | - | -0.2536 | 0.0000 |
| `flop6-jack` | 30 s | rbes | 5131 | 434,240 | 30 | 14,473 | - | - | - | -0.6636 | 0.0000 |
| `flop6-jack` | 30 s | rbes | 5132 | 451,072 | 30 | 15,033 | - | - | - | -0.4531 | 0.0000 |
| `flop6-jack` | 30 s | rbes | 5133 | 379,648 | 30 | 12,654 | - | - | - | -0.4904 | 0.0176 |
| `flop6-jack` | 30 s | rbes | 5134 | 352,384 | 30 | 11,745 | - | - | - | -0.4850 | 0.0000 |
| `flop3-kings` | 250,000 deals | default | 5131 | 250,000 | 2.89 | 86,471 | 135,268 | 14.4 | 26 | 0.6143 | 0.5224 |
| `flop3-kings` | 250,000 deals | default | 5132 | 250,000 | 2.49 | 100,293 | 134,851 | 14.3 | 25.8 | 0.6635 | 0.5706 |
| `flop3-kings` | 250,000 deals | default | 5133 | 250,000 | 2.8 | 89,289 | 134,586 | 14.3 | 25.7 | 0.5337 | 0.4498 |
| `flop3-kings` | 250,000 deals | default | 5134 | 250,000 | 2.61 | 95,611 | 134,740 | 14.3 | 25.6 | 0.6356 | 0.5466 |
| `flop3-kings` | 250,000 deals | rbes | 5131 | 250,000 | 22.7 | 11,033 | 258,622 | 21.9 | 44.6 | -0.3569 | 0.0000 |
| `flop3-kings` | 250,000 deals | rbes | 5132 | 250,000 | 23.2 | 10,783 | 259,109 | 21.9 | 44.8 | -0.3561 | 0.0000 |
| `flop3-kings` | 250,000 deals | rbes | 5133 | 250,000 | 24 | 10,423 | 258,698 | 21.9 | 44.6 | -0.3126 | 0.0000 |
| `flop3-kings` | 250,000 deals | rbes | 5134 | 250,000 | 27.4 | 9,135 | 259,223 | 21.9 | 44.7 | -0.3881 | 0.0000 |
| `flop3-kings` | 30 s | default | 5131 | 2,739,392 | 30 | 91,312 | - | - | - | -0.3645 | 0.0000 |
| `flop3-kings` | 30 s | default | 5132 | 2,449,984 | 30 | 81,663 | - | - | - | -0.3834 | 0.0000 |
| `flop3-kings` | 30 s | default | 5133 | 2,710,144 | 30 | 90,337 | - | - | - | -0.3389 | 0.0000 |
| `flop3-kings` | 30 s | default | 5134 | 2,776,448 | 30 | 92,547 | - | - | - | -0.3564 | 0.0000 |
| `flop3-kings` | 30 s | rbes | 5131 | 327,168 | 30 | 10,904 | - | - | - | -0.3976 | 0.0000 |
| `flop3-kings` | 30 s | rbes | 5132 | 304,192 | 30 | 10,139 | - | - | - | -0.3964 | 0.0000 |
| `flop3-kings` | 30 s | rbes | 5133 | 309,696 | 30 | 10,321 | - | - | - | -0.3512 | 0.0000 |
| `flop3-kings` | 30 s | rbes | 5134 | 320,256 | 30 | 10,674 | - | - | - | -0.3514 | 0.0000 |

At 250,000 equal deals the search certifies 0.89 to 1.02 BB against the default trainer's six-player strategy (5.9
reported 0.75 to 1.17 BB for this fixture and budget) and 0.00 to 0.04 BB against the strategy of `rbes`; on the
three-player fixture 0.45 to 0.57 BB against 0.00. Those deals cost `rbes` about three times (17 s against 5.6 s) and
nine times (24 s against 2.7 s) the training time, and its table holds about twice the rows.

After 30 s of training the search certifies nothing against either trainer on either fixture (0.00 to 0.09 BB; the
estimated sums of gains are negative, i.e. the trained responses do worse than the strategies they were meant to
beat). **The prespecified equal-time budget cannot rank the trainers.** What it shows is that a response trained for
200,000 deals a seat has no power left at that point - not that either strategy is at equilibrium.

### 7.2 A supplementary look at shorter training times (exploratory)

Because 30 s told nothing, the same fixtures, seeds and response search were run at 2, 6 and 12 s
(`fixtures_times510.py`, `fixtures-times/`). **This run was specified after the numbers of 7.1 had been seen**; its
plan says so, it has no verdict, and no recommendation of the release rests on it.

| Fixture | Training time | Trainer | Mean sampled deals | Simultaneous 95% lower bound of NashConv (BB), seeds 5131, 5132, 5133, 5134 | Mean | Mean sum of trained-response gains (BB; a negative value: the search found nothing) | Run |
|---|---|---|---|---|---|---|---|
| `flop6-jack` | 2 s | default | 88,112 | 2.77, 3.15, 2.82, 3.23 | 2.99 | 3.29 | supplementary |
| `flop6-jack` | 2 s | rbes | 25,552 | 1.32, 1.40, 1.10, 1.28 | 1.28 | 1.55 | supplementary |
| `flop6-jack` | 6 s | default | 255,392 | 1.08, 0.97, 0.87, 0.70 | 0.90 | 1.17 | supplementary |
| `flop6-jack` | 6 s | rbes | 89,824 | 0.08, 0.11, 0.07, 0.40 | 0.17 | 0.18 | supplementary |
| `flop6-jack` | 12 s | default | 501,376 | 0.24, 0.10, 0.13, 0.08 | 0.14 | 0.31 | supplementary |
| `flop6-jack` | 12 s | rbes | 178,592 | 0.06, 0.03, 0.01, 0.12 | 0.06 | -0.23 | supplementary |
| `flop6-jack` | 30 s | default | 1,245,536 | 0.09, 0.00, 0.00, 0.00 | 0.02 | -0.26 | prespecified |
| `flop6-jack` | 30 s | rbes | 404,336 | 0.00, 0.00, 0.02, 0.00 | 0.00 | -0.52 | prespecified |
| `flop3-kings` | 2 s | default | 191,760 | 0.87, 0.70, 0.71, 0.75 | 0.76 | 0.85 | supplementary |
| `flop3-kings` | 2 s | rbes | 19,120 | 0.77, 0.67, 0.32, 0.33 | 0.52 | 0.62 | supplementary |
| `flop3-kings` | 6 s | default | 554,000 | 0.10, 0.19, 0.15, 0.08 | 0.13 | 0.13 | supplementary |
| `flop3-kings` | 6 s | rbes | 61,056 | 0.11, 0.11, 0.09, 0.07 | 0.09 | -0.05 | supplementary |
| `flop3-kings` | 12 s | default | 1,086,560 | 0.02, 0.00, 0.03, 0.00 | 0.01 | -0.15 | supplementary |
| `flop3-kings` | 12 s | rbes | 125,264 | 0.08, 0.00, 0.18, 0.00 | 0.06 | -0.18 | supplementary |
| `flop3-kings` | 30 s | default | 2,668,992 | 0.00, 0.00, 0.00, 0.00 | 0.00 | -0.36 | prespecified |
| `flop3-kings` | 30 s | rbes | 315,328 | 0.00, 0.00, 0.00, 0.00 | 0.00 | -0.37 | prespecified |

* **Six-player fixture.** The certified bound is smaller against `rbes` in every seed at 2 s (1.10 to 1.40 against
  2.77 to 3.23 BB) and at 6 s (0.07 to 0.40 against 0.70 to 1.08 BB), and in three of four seeds at 12 s; at 30 s
  nothing is found against either.
* **Three-player fixture.** Smaller against `rbes` in every seed at 2 s; no consistent difference at 6 s; at 12 s
  the bound against `rbes` is the larger one in two seeds. `rbes` processes a ninth of the default's deals per
  second on this fixture (109 to 360 hands a seat).

What can be said: on the shipped six-player flop fixture, for trainings of 2 to 12 seconds, one fixed response
search found less to win against the strategy of `rbes` than against the default trainer's after the same training
time, consistently over four seeds. That is consistent with faster convergence there, and it fits the variance
measurement (on this fixture the regret variance of `rbes` times its cost per deal is 0.40 of the default's, against
about 0.7 on the small six-player games of section 5). What cannot be said: that it is established. These are lower
bounds from one search, from a run designed after seeing data, on four seeds; a strategy can hide its weaknesses
from a weak search, and at 30 s this search could not tell the two apart at all.


### 7.3 The same comparison with a stronger response search (exploratory)

The response benchmark of PERFORMANCE-5.10.md, section 4, showed that the search of 7.1 and 7.2 was the weak part: a
response trained by `rbes` (`"responseEstimator":"rbes"`) certifies 2.29 BB against a strategy where the default
response certifies 0.02 BB. The comparison of the trainers was therefore repeated with that search
(`fixtures_response510.py`, `fixtures-response/`: 100,000 response deals a seat trained by `rbes`, 409,600 evaluation
deals, the same for both arms; 250,000 equal deals, and 6 s and 30 s of training; the same four seeds). **Also
specified after seeing data; no verdict; no recommendation rests on it.** A first attempt with the experiment's
candidate program failed at once in all 48 analyses because that program predates the request field; it was
repeated with the released program.

| Fixture | Training budget | Trainer | Mean sampled deals | Mean training s | Simultaneous 95% lower bound of NashConv (BB), seeds 5131, 5132, 5133, 5134 | Mean | Mean sum of trained-response gains (BB) |
|---|---|---|---|---|---|---|---|
| `flop6-jack` | 250,000 deals | default | 250,000 | 6.23 | 2.67, 2.59, 2.61, 2.52 | 2.60 | 2.91 |
| `flop6-jack` | 250,000 deals | rbes | 250,000 | 17.5 | 0.47, 0.26, 0.34, 0.62 | 0.42 | 0.67 |
| `flop6-jack` | 6 s | default | 246,048 | 6 | 2.42, 2.68, 2.78, 2.67 | 2.64 | 2.95 |
| `flop6-jack` | 6 s | rbes | 84,208 | 6 | 1.14, 1.11, 1.26, 1.71 | 1.31 | 1.58 |
| `flop6-jack` | 30 s | default | 1,098,544 | 30 | 0.73, 0.84, 0.80, 1.06 | 0.86 | 1.12 |
| `flop6-jack` | 30 s | rbes | 413,632 | 30 | 0.25, 0.24, 0.20, 0.15 | 0.21 | 0.43 |
| `flop3-kings` | 250,000 deals | default | 250,000 | 2.98 | 1.65, 1.76, 1.62, 1.67 | 1.68 | 1.79 |
| `flop3-kings` | 250,000 deals | rbes | 250,000 | 24.2 | 0.20, 0.21, 0.25, 0.17 | 0.21 | 0.30 |
| `flop3-kings` | 6 s | default | 491,952 | 6 | 0.96, 1.24, 1.15, 1.10 | 1.11 | 1.22 |
| `flop3-kings` | 6 s | rbes | 55,184 | 6.01 | 0.70, 0.73, 0.79, 0.74 | 0.74 | 0.84 |
| `flop3-kings` | 30 s | default | 2,387,776 | 30 | 0.25, 0.22, 0.32, 0.34 | 0.28 | 0.37 |
| `flop3-kings` | 30 s | rbes | 301,376 | 30 | 0.16, 0.14, 0.19, 0.19 | 0.17 | 0.26 |

* **Six-player fixture, equal time.** After 6 s the bound certified against `rbes` is 1.11 to 1.71 BB, against the
  default trainer 2.42 to 2.78 BB; after 30 s, 0.15 to 0.25 BB against 0.73 to 1.06 BB. Lower against `rbes` in every
  seed, by a factor of about two and about four.
* **Three-player fixture, equal time.** 0.70 to 0.79 against 0.96 to 1.24 BB after 6 s; 0.14 to 0.19 against 0.22 to
  0.34 BB after 30 s. Lower against `rbes` in every seed, although it processes an eighth of the deals.
* **Equal deals (250,000).** 0.26 to 0.62 against 2.52 to 2.67 BB (six players) and 0.17 to 0.25 against 1.62 to
  1.76 BB (three players).
* **What the stronger search says about 5.9.** A six-player strategy of the default trainer after 250,000 deals,
  which 5.9 described with lower bounds of 0.75 to 1.17 BB, is at least 2.5 BB from equilibrium inside its
  abstraction (95% bound, each of four seeds).

**How far this goes.** This is the most informative measurement of the six-player fixture that exists: the search
finds substantial gains against both trainers, so it has power, and the difference is large and has the same sign in
every seed. It is still a lower bound of NashConv. The same search is used for both arms, but nothing guarantees
that it is equally effective against both: a response trained by `rbes` could share blind spots with a strategy
trained by `rbes` (rows reached only through rarely sampled opponent lines). And the comparison was designed after
its predecessor's result was known. It is reported as strong diagnostic evidence that `rbes` converges faster on
this fixture at equal time, not as a demonstration.

## 8. What this does and does not establish

* It establishes, with exact NashConv and a prespecified analysis, that `rbes` trains strategies with lower NashConv
  than the 5.9 trainer in the same time on eleven named games, and that it was not worse on any of twenty.
* It does not establish an improvement on six-player flops with exact NashConv or on eight-handed push-or-fold
  games, where the comparison is unresolved; an unresolved interval is not evidence of equality either. For the
  six-player fixture it adds diagnostic evidence in favour of `rbes` (section 7.3) that is consistent, large, and
  not a proof.
* All twenty games are small. The largest has 3.2 million information sets; the fixtures a user studies use hand
  groups and realistic ranges, and for them only the lower bounds of section 7 exist.
* NashConv inside an abstraction says nothing about the abstraction. A strategy with NashConv 0 in a game with one
  bet size and Compact groups is an equilibrium of THAT game.
* No number in this document is a percentage of optimal play, and none should be turned into one.

## 9. What remains before stronger equilibrium claims

1. **The average strategy.** Both trainers accumulate it with weights 1 / (sampling reach) whose distribution is
   heavy-tailed (TRAINING-ENGINE-5.10.md, 2.3; measured in `validation/5.10/estimator/diagnosis.json`). An estimator
   that updates a seat's average where the seat is the sampled opponent, or separate average passes, is the most
   promising next step, and the exact-check harness of 5.10 can validate it the way it validated `rbes`.
2. **Six players.** With five sampled opponents the opponents' action sampling dominates. Candidates: control
   variates at opponent decisions (the pilot bound was x 0.53 to 0.87 from the river alone), or sampling fewer
   opponents per traversal.
3. **A certificate for large games.** An upper bound of NashConv - an abstraction-respecting exact best response
   for one seat at a time on a sampled public tree, or a provable bound from the regrets - is still missing; until
   then large-game statements are lower bounds.
4. **`rbes` in the reference trainer and on every configuration** (DCFR, regret matching+, stratified deals), and
   on physical Windows, before it can be considered as a default.
5. **Longer horizons.** 4 s and 1,000,000 deals on small games; the realistic fixtures at 30 s. Whether the
   advantage persists, grows or shrinks over hours on a 24-thread machine has not been measured.
