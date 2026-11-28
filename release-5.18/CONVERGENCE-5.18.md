# EightMax 5.18: what a missing bet size costs, and how much results move when one is added

Build `23205cbc12cae290`. Plan: `validation/5.18/plan.json`, written 2026-11-28T01:30:32Z, with three amendments (section 8; all
three written after something had been seen). Units: `validation/5.18/measure/units` (45 units,
0 with an error). Runner: `validation/5.18/measure518.py`; analysis: `analyze518.py`; its output:
`measure/summary.txt`.

## 1. What was measured, and how

* **Games** (`source/tools/games518.js`). Three heads-up postflop games: `ot-river` (whole ranges, 1081 hands a seat,
  exact cards; bets of 33% and 100% of the pot, a pot-sized raise), `ot-turn` (whole ranges, 1128 hands, Ranked
  grouping; one bet a street: 66%, 75%), `ot-flop` (about 80 hands a seat, Ranked grouping; 50%, 66%, 75%).
* **Variants.** Each game with one size added, twelve in all: two between two tree sizes, four above the largest,
  five below the smallest, one raise size.
* **Three strategies for every variant.** (1) The base game's solution, written as a strategy of the variant by
  `mwcli --translate` under each rule. (2) The variant solved directly for the same number of deals. (3) The variant
  solved directly for the same seconds.
* **The measure.** Method `exact-hu`: the exact NashConv over physical hands, in the tree **with** the added size.
  The best responder may use the size; a translated strategy answers it through the rule. Numbers are percent of the
  starting pot a player.
* **Seeds and budgets.** Seeds 5181 to 5185; 1,000,000, 4,000,000 and 10,000,000 deals of the default trainer on
  one thread.
* **Before the plan** a smoke test had been run and seen (the plan lists its numbers). **Before this run** an earlier
  build was measured once with the same script (`validation/5.18/first-run`): its verdicts on the cost (T1) are the same in 36 of 36 (variant, rule) pairs, and by the rule it chose the same default (blend).

## 2. T0: what must hold

```
T0 (what must hold):
   a strategy translated into its own tree has the bits of the source: 135 of 135 (units x rules)
   with a size added, no seat gains less and every policy value is the same (1e-9; fallback callCheck, amendment 1): 540 of 540 (units x variants x rules)
   the same statement with the default fallback (uniform), which amendment 1 explains is not guaranteed: violated in 66 cases
   -> T0 MET
```

The third line is not a failure: it is the reason for amendment 1. With the default fallback a hand without a
stored row plays uniformly over the node's actions, and the larger tree has one more action there.

## 3. T1: the cost of a missing size

```
T1 (the cost of a missing size): NashConv of the translated strategy in the tree with the size, minus NashConv of the source strategy in its own tree; percent of the pot a player; 10,000,000 deals; seeds 5181 to 5185
   LARGE: above 0.5 in all five seeds. SMALL: below 0.5 in all five.

game      variant where            source | nearest                      | harmonic                     | blend                       
                                   own NC | mean (min..max) verdict      | mean (min..max) verdict      | mean (min..max) verdict     
ot-river  +66     between            0.37 |  3.68 ( 3.65.. 3.70) LARGE      |  4.40 ( 4.28.. 4.58) LARGE      |  0.31 ( 0.30.. 0.31) SMALL     
ot-river  +50     between            0.37 |  1.67 ( 1.64.. 1.69) LARGE      |  1.67 ( 1.64.. 1.69) LARGE      |  0.28 ( 0.28.. 0.29) SMALL     
ot-river  +200    above              0.37 |  5.35 ( 5.30.. 5.41) LARGE      |  5.35 ( 5.30.. 5.41) LARGE      |  5.35 ( 5.30.. 5.41) LARGE     
ot-river  +15     below              0.37 |  3.22 ( 3.16.. 3.27) LARGE      |  3.22 ( 3.16.. 3.27) LARGE      |  3.22 ( 3.16.. 3.27) LARGE     
ot-river  +r50    below (raise)      0.37 |  6.61 ( 6.31.. 6.85) LARGE      |  6.61 ( 6.31.. 6.85) LARGE      |  6.61 ( 6.31.. 6.85) LARGE     
ot-turn   +t33    below              1.16 |  6.38 ( 6.29.. 6.45) LARGE      |  6.38 ( 6.29.. 6.45) LARGE      |  6.38 ( 6.29.. 6.45) LARGE     
ot-turn   +t150   above              1.16 |  6.40 ( 6.28.. 6.45) LARGE      |  6.40 ( 6.28.. 6.45) LARGE      |  6.40 ( 6.28.. 6.45) LARGE     
ot-turn   +r33    below              1.16 | 14.38 (14.13..14.59) LARGE      | 14.38 (14.13..14.59) LARGE      | 14.38 (14.13..14.59) LARGE     
ot-turn   +r150   above              1.16 |  5.27 ( 5.19.. 5.39) LARGE      |  5.27 ( 5.19.. 5.39) LARGE      |  5.27 ( 5.19.. 5.39) LARGE     
ot-flop   +f100   above              5.00 | 16.19 (16.07..16.30) LARGE      | 16.19 (16.07..16.30) LARGE      | 16.19 (16.07..16.30) LARGE     
ot-flop   +f25    below              5.00 |  5.26 ( 5.18.. 5.39) LARGE      |  5.26 ( 5.18.. 5.39) LARGE      |  5.26 ( 5.18.. 5.39) LARGE     
ot-flop   +t33    below              5.00 |  7.96 ( 7.83.. 8.11) LARGE      |  7.96 ( 7.83.. 8.11) LARGE      |  7.96 ( 7.83.. 8.11) LARGE     

   nearest: LARGE on 12 of 12 variants, SMALL on 0, unresolved on 0; harmonic: LARGE on 12 of 12 variants, SMALL on 0, unresolved on 0; blend: LARGE on 10 of 12 variants, SMALL on 2, unresolved on 0
```

"source own NC" is the NashConv of the base solution in its own tree: what training had left. The cost is what
comes on top of it when the opponent may use the added size.

* **Outside the tree's sizes** (ten variants) there is one rule: the smallest or the largest tree size. The cost is 3.2 to 16.2 percent of the pot a player. More training of the base tree does not remove it: section 5 shows the translated strategy at 1, 4 and 10 million deals.
* **Between two tree sizes** (two variants, both on `ot-river`) the rules differ. Choosing one neighbour costs 1.7 to 3.7 percent (nearest) or 1.7 to 4.4 (harmonic); blending both costs 0.28 to 0.31, which is below the 0.5 that the plan calls large.
* **For scale:** the base solutions themselves are 0.37 to 5.00 percent from equilibrium in their own trees at this budget. The flop game is the least converged, so its costs come on top of a larger number.
* The cost is against the *best* use of the added size by an opponent who knows the strategy. It is an upper limit on what a real opponent wins with that size, not an estimate of it.

## 4. T2: the rules against each other, and the default

```
T2 (the rules against each other; BETTER = lower cost in all five seeds):
   ot-river+66        harmonic vs nearest: nearest BETTER; blend vs nearest: blend BETTER; blend vs harmonic: blend BETTER
   ot-river+50        harmonic vs nearest: same strategy; blend vs nearest: blend BETTER; blend vs harmonic: blend BETTER
   ot-river+200       harmonic vs nearest: same strategy; blend vs nearest: same strategy; blend vs harmonic: same strategy
   ot-river+15        harmonic vs nearest: same strategy; blend vs nearest: same strategy; blend vs harmonic: same strategy
   ot-river+r50       harmonic vs nearest: same strategy; blend vs nearest: same strategy; blend vs harmonic: same strategy
   ot-turn+t33        harmonic vs nearest: same strategy; blend vs nearest: same strategy; blend vs harmonic: same strategy
   ot-turn+t150       harmonic vs nearest: same strategy; blend vs nearest: same strategy; blend vs harmonic: same strategy
   ot-turn+r33        harmonic vs nearest: same strategy; blend vs nearest: same strategy; blend vs harmonic: same strategy
   ot-turn+r150       harmonic vs nearest: same strategy; blend vs nearest: same strategy; blend vs harmonic: same strategy
   ot-flop+f100       harmonic vs nearest: same strategy; blend vs nearest: same strategy; blend vs harmonic: same strategy
   ot-flop+f25        harmonic vs nearest: same strategy; blend vs nearest: same strategy; blend vs harmonic: same strategy
   ot-flop+t33        harmonic vs nearest: same strategy; blend vs nearest: same strategy; blend vs harmonic: same strategy
   nearest is BETTER than harmonic on 1 variants and WORSE on 0; blend is BETTER than harmonic on 2 variants and WORSE on 0
   -> by the rule of the plan the default is: blend
```

The default of `mwcli --translate`, `mwcli --offtree` and the explorer field is **blend**, by the rule of the plan. Read the evidence for what it is:

* The three rules can only differ when a size lies between two tree sizes. That is 2 of the 12 variants, both on one river game. On both, blend is better than each threshold rule in all five seeds, by a factor of 5 to 15.
* Between the two threshold rules there is one verdict: on the 66% bet (where they choose different neighbours) nearest is better than harmonic. One case decides nothing.
* **Supplement** (amendment 3, added after the first run, outside the rule): on its two between-sizes blend costs 0.49 and 0.05% of the pot a player, harmonic 4.81 and 4.10, nearest 6.14 and 2.26; blend is BETTER than both other rules on 2 of 2.
```
Supplement (amendment 3, added after the first run; not part of the counts above): a second game with sizes between two tree sizes; 10,000,000 deals
game      variant where       source | nearest                      | harmonic                     | blend                        |  direct
                              own NC | cost: mean (min..max)        | cost: mean (min..max)        | cost: mean (min..max)        | eq.time
ot-turn2  +t66    between       2.81 |  6.14 ( 6.01.. 6.35) LARGE      |  4.81 ( 4.60.. 5.02) LARGE      |  0.49 ( 0.33.. 0.62) unresolved |    3.00
   harmonic vs nearest: harmonic BETTER; blend vs nearest: blend BETTER; blend vs harmonic: blend BETTER; 5 seeds; against the directly trained strategy at equal time: direct better / direct better / direct better
ot-turn2  +r75    between       2.81 |  2.26 ( 2.22.. 2.33) LARGE      |  4.10 ( 3.85.. 4.24) LARGE      |  0.05 ( 0.04.. 0.05) SMALL      |    3.19
   harmonic vs nearest: nearest BETTER; blend vs nearest: blend BETTER; blend vs harmonic: blend BETTER; 5 seeds; against the directly trained strategy at equal time: direct better / direct better / translated better
```

## 5. T3: equal time (the primary comparison)

```
T3 (equal time, the primary comparison): NashConv in the tree with the size, percent of the pot a player; the directly trained strategy got the seconds of the base training
   DIRECT BETTER: lower in all five seeds. TRANSLATED BETTER: higher in all five. Pairs whose seconds differ by more than 15 percent are left out.

game      variant      deals | nearest   harm.   blend |  direct  sec % | verdict against nearest / harmonic / blend | eq.deals
ot-river  +66      1,000,000 |    4.89    4.55    1.55 |    1.85    113 | too few equal pairs / too few equal pairs / too few equal pairs |    1.60
ot-river  +66      4,000,000 |    4.23    4.67    0.87 |    0.85    102 | direct / direct / unresolved       |    0.76
ot-river  +66     10,000,000 |    4.05    4.77    0.68 |    0.52    101 | direct / direct / direct           |    0.47
ot-river  +50      1,000,000 |    2.86    2.86    1.53 |    1.80    120 | too few equal pairs / too few equal pairs / too few equal pairs |    1.64
ot-river  +50      4,000,000 |    2.22    2.22    0.86 |    0.84    114 | too few equal pairs / too few equal pairs / too few equal pairs |    0.76
ot-river  +50     10,000,000 |    2.04    2.04    0.65 |    0.50    111 | too few equal pairs / too few equal pairs / too few equal pairs |    0.45
ot-river  +200     1,000,000 |    6.79    6.79    6.79 |    2.08    105 | too few equal pairs / too few equal pairs / too few equal pairs |    1.75
ot-river  +200     4,000,000 |    5.98    5.98    5.98 |    0.89     97 | direct / direct / direct           |    0.77
ot-river  +200    10,000,000 |    5.72    5.72    5.72 |    0.53     98 | direct / direct / direct           |    0.46
ot-river  +15      1,000,000 |    3.58    3.58    3.58 |    1.69    118 | too few equal pairs / too few equal pairs / too few equal pairs |    1.56
ot-river  +15      4,000,000 |    3.51    3.51    3.51 |    0.80    113 | too few equal pairs / too few equal pairs / too few equal pairs |    0.73
ot-river  +15     10,000,000 |    3.59    3.59    3.59 |    0.47    113 | too few equal pairs / too few equal pairs / too few equal pairs |    0.43
ot-river  +r50     1,000,000 |    4.32    4.32    4.32 |    1.58    104 | direct / direct / direct           |    1.45
ot-river  +r50     4,000,000 |    6.08    6.08    6.08 |    0.73    104 | direct / direct / direct           |    0.68
ot-river  +r50    10,000,000 |    6.98    6.98    6.98 |    0.44    100 | direct / direct / direct           |    0.40
ot-turn   +t33     1,000,000 |    7.70    7.70    7.70 |    1.83     91 | too few equal pairs / too few equal pairs / too few equal pairs |    1.65
ot-turn   +t33     4,000,000 |    7.60    7.60    7.60 |    1.31    102 | direct / direct / direct           |    1.27
ot-turn   +t33    10,000,000 |    7.54    7.54    7.54 |    1.18    101 | direct / direct / direct           |    1.16
ot-turn   +t150    1,000,000 |    8.17    8.17    8.17 |    1.83    116 | too few equal pairs / too few equal pairs / too few equal pairs |    1.84
ot-turn   +t150    4,000,000 |    7.59    7.59    7.59 |    1.45    112 | too few equal pairs / too few equal pairs / too few equal pairs |    1.46
ot-turn   +t150   10,000,000 |    7.60    7.60    7.60 |    1.38    116 | too few equal pairs / too few equal pairs / too few equal pairs |    1.39
ot-turn   +r33     1,000,000 |   15.45   15.45   15.45 |    1.84     99 | direct / direct / direct           |    1.73
ot-turn   +r33     4,000,000 |   15.65   15.65   15.65 |    1.32     95 | direct / direct / direct           |    1.29
ot-turn   +r33    10,000,000 |   15.54   15.54   15.54 |    1.15     97 | direct / direct / direct           |    1.13
ot-turn   +r150    1,000,000 |    6.59    6.59    6.59 |    2.57     98 | direct / direct / direct           |    2.55
ot-turn   +r150    4,000,000 |    6.46    6.46    6.46 |    2.03    104 | direct / direct / direct           |    1.99
ot-turn   +r150   10,000,000 |    6.43    6.43    6.43 |    1.82     99 | direct / direct / direct           |    1.81
ot-flop   +f100    1,000,000 |   22.01   22.01   22.01 |   11.65     98 | direct / direct / direct           |   10.59
ot-flop   +f100    4,000,000 |   20.93   20.93   20.93 |    6.78    109 | too few equal pairs / too few equal pairs / too few equal pairs |    6.30
ot-flop   +f100   10,000,000 |   21.19   21.19   21.19 |    5.27    107 | direct / direct / direct           |    5.05
ot-flop   +f25     1,000,000 |   13.15   13.15   13.15 |   12.79    101 | direct / direct / direct           |   11.17
ot-flop   +f25     4,000,000 |   10.83   10.83   10.83 |    7.71    104 | direct / direct / direct           |    6.88
ot-flop   +f25    10,000,000 |   10.26   10.26   10.26 |    5.98    100 | direct / direct / direct           |    5.54
ot-flop   +t33     1,000,000 |   16.34   16.34   16.34 |   12.51     93 | direct / direct / direct           |   10.94
ot-flop   +t33     4,000,000 |   13.67   13.67   13.67 |    7.41     93 | direct / direct / direct           |    6.63
ot-flop   +t33    10,000,000 |   12.96   12.96   12.96 |    5.67     97 | direct / direct / direct           |    5.19
   against nearest: direct better on 23 of 36 (variant, budget) pairs, translated better on 0, unresolved 0, not equal in time 13
   against harmonic: direct better on 23 of 36 (variant, budget) pairs, translated better on 0, unresolved 0, not equal in time 13
   against blend: direct better on 22 of 36 (variant, budget) pairs, translated better on 0, unresolved 1, not equal in time 13
```

* **Against the threshold rules** solving with the size wins on 23 of 36 pairs and loses on 0.
* **Against blend** it wins on 22 and loses on 0; 1 are unresolved (`ot-river+66-4000000`).
* 13 pairs were left out because the seconds of the two trainings differed by more than 15 percent in at least one seed. The column "sec %" is the mean ratio of the seconds. Equal deals (last column) are the secondary comparison: the tree with the size has more rows and learns a little more slowly per deal, and still ends lower.
* What this compares: a solution of the smaller tree, mapped, against a solution of the larger tree, both after the same training time on one thread. It does not compare against a solution of the smaller tree that is trained longer; more training does not remove the cost (section 3).

## 6. T4: how much results move when a size is added

```
T4 (how much results move when a size is added; 10,000,000 deals, the tree with the size trained directly for the same deals)
   value of the game for seat 0, chips: it lies between (pot - best response of seat 1) and (best response of seat 0). MOVED in a seed if the two intervals do not overlap.
   first decision: mean absolute change of the frequencies of the base actions, points; MOVED if above every seed-to-seed difference inside either tree.

game      variant | value A (mean lo..hi) value B (mean lo..hi) moved     |  change   noise moved    new size |  own NC A  own NC B
ot-river  +66     |  2.817  2.794.. 2.840   2.812  2.783.. 2.841  0 of 5    |    2.71    0.72 MOVED        7.7% |      0.37      0.47
ot-river  +50     |  2.817  2.794.. 2.840   2.810  2.782.. 2.838  0 of 5    |    3.50    0.72 MOVED        9.9% |      0.37      0.45
ot-river  +200    |  2.817  2.794.. 2.840   2.815  2.786.. 2.843  0 of 5    |    0.45    0.72 no           0.5% |      0.37      0.46
ot-river  +15     |  2.817  2.794.. 2.840   2.820  2.793.. 2.848  0 of 5    |    4.65    0.73 MOVED       13.9% |      0.37      0.43
ot-river  +r50    |  2.817  2.794.. 2.840   2.807  2.782.. 2.832  0 of 5    |    2.63    0.72 MOVED   elsewhere |      0.37      0.40
ot-turn   +t33    |  2.744  2.670.. 2.816   2.755  2.682.. 2.826  0 of 5    |   13.45    1.53 MOVED       26.9% |      1.16      1.16
ot-turn   +t150   |  2.744  2.670.. 2.816   2.734  2.647.. 2.822  0 of 5    |    3.46    0.56 MOVED        6.9% |      1.16      1.39
ot-turn   +r33    |  2.744  2.670.. 2.816   2.834  2.756.. 2.904  0 of 5    |    6.48    1.36 MOVED   elsewhere |      1.16      1.13
ot-turn   +r150   |  2.744  2.670.. 2.816   2.749  2.625.. 2.870  0 of 5    |    0.91    0.91 MOVED   elsewhere |      1.16      1.81
ot-flop   +f100   |  2.079  1.822.. 2.338   2.076  1.820.. 2.341  0 of 5    |    1.71    4.67 no           3.0% |      5.00      5.05
ot-flop   +f25    |  2.079  1.822.. 2.338   2.063  1.776.. 2.350  0 of 5    |   22.88    3.96 MOVED       45.8% |      5.00      5.54
ot-flop   +t33    |  2.079  1.822.. 2.338   2.138  1.867.. 2.405  0 of 5    |    8.04    3.96 MOVED   elsewhere |      5.00      5.19
```

* **The value of the game.** Each solution brackets the value between what the two best responses leave. The brackets of the two trees overlap in 60 of 60 cases. The added size may well change the value; these solutions are not exact enough to show it. The honest statement is "no movement established", not "no movement".
* **The first decision** moves on 10 of 12 variants by the rule. The largest change is 23 points a base action (`ot-flop+f25`). A size added on a later street or as a raise ("elsewhere") still moves the first decision in some games.
* **The added size is used.** Where it is available at the first decision it takes 0.5 to 46 percent of the range. The small sizes are used most.
* **Exploitability reached at equal deals** ("own NC"): the larger tree ends about where the smaller one does, mostly slightly above.

## 7. Reading

1. **A solution is a solution of its tree.** Against a bet size it does not contain it can lose several percent of the pot a player, many times what it loses inside its tree. More training of the same tree does not help.
2. **Where the tree has sizes on both sides of the real bet, blend the two.** The cost then stays small on the games measured. Choosing one neighbour does not.
3. **Where the real bet is smaller than every tree size or larger than every tree size, no mapping helps.** If opponents use such sizes, the tree needs them: a small bet and an overbet on the streets where it matters.
4. **Adding the size and solving is better than mapping, for the same time.** The tree with one more size is slower per deal and still ends lower in every resolved comparison against the threshold rules.
5. **These are three games with one or two sizes a street, two players, after the flop.** Real studies with more sizes have smaller gaps; the cost of a size between two of them should be smaller. That is an expectation. Nothing here measures it, and nothing here says anything about three or more players or about preflop.

## 8. Amendments

1. **After the self-test's check of T0 had failed on three of fifteen cases, before any unit was read.** T0's second
   statement (no seat gains less; the same policy value) is false with the default fallback and true with a fallback
   that is the same in both trees. It is checked with `callCheck`. Everything else keeps the default fallback.
2. **After the first run had produced the two smaller budgets for two games (seen).** The largest budget is
   10,000,000 deals, not 16,000,000: the default trainer refuses more. Every 16,000,000-deal unit had ended with
   that refusal and no result.
3. **After the first run was complete (seen).** A supplementary game, `ot-turn2`, with two sizes between tree sizes, because the choice of the default rested on two variants of one game. Outside the counts of T1 to T4 and outside the rule of T2; reported in section 4.
