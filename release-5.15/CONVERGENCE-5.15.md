# EightMax 5.15: measurements

Build `87b9f6e38b735cfb`. Everything in this file was measured on the development machine (an Ubuntu container, 4 logical
processors), not on the target PC. NashConv is **exact** (an exact best response of every seat on games small enough
for one). For more than two seats NashConv is not exploitability, and **no percentage of GTO follows from any number
here**.

5.15 changes no trainer, so there is no contest between training algorithms in this release and no equal-time
comparison to decide. What was measured: that the unchanged trainer converges under the new payoff model (R2), what
future hands change (R3), and what the bounty rule changes (R4, and the calculator). Rules:
`validation/5.15/plan.json`, written at 2026-11-26T21:21:02Z before any of these runs, with two amendments made before the
runs they concern (both listed in the file and below).

## 1. Rules, written before measuring

* **R2 (training converges).** Six tournament games of the reference set, each as it is ("plain") and under the
  model: progressive bounties (`pko`), knockout bounties (`ko`), one future hand (`fgs1`), two (`fgs2`), bounties and
  one future hand (`pko+fgs1`). Five seeds, the same for every variant. 20,000, 200,000 and 2,000,000 deals, default
  trainer, one thread. Measure: exact NashConv divided by the prizes (plus all bounties where the variant has
  them). **PASS for a game and variant** when the geometric mean over seeds at 2,000,000 deals is below the one at
  20,000 deals, and at 2,000,000 deals is at most 3 times that of plain (paired by seed). R2 passes when every pair
  passes.
* **Amendment 1, before any R2 run:** the two future-hand variants of the eight-handed game `final8` are not run. A
  cost pilot showed 1,531 future-hand solutions of about 33 ms in its first 2,000 deals, and every training is a
  separate process that solves them again. (`fgs2` was already excluded for `final8` and `bubble5-icm` in the plan.)
* **R3 (future hands; information).** The push/fold calculator with 0 to the most future hands it allows, on seven
  tables fixed in advance. No claim that more hands are more accurate. If the last step changes more than the first
  on a table, the report must say that nothing settles there.
* **R4 (the bounty rule; information).** MATHEMATICAL-VALIDATION-5.15.md, section 5.
* **Pilots, not part of any verdict:** two games of one seed under four variants at up to 500,000 deals, to see that
  the trainer runs and the values add up; one training of `final8` and one of `bubble5-icm` for the cost.

## 2. R2: the trainer under the model

480 trainings, 0 errors.

```
R2: relative NashConv (geometric mean over 5 seeds) by deals; ratio to plain at 2000000 deals, paired by seed

game           variant          20000       200000      2000000     ratio  verdict
bubble4        plain        1.396e-06    1.397e-08    1.398e-10     1.000  PASS
bubble4        pko          1.092e-04    1.439e-05    2.382e-06  17043.628  FAIL
bubble4        ko           1.808e-05    1.608e-05    3.536e-07  2529.887  FAIL
bubble4        fgs1         4.291e-05    6.020e-07    6.032e-09    43.163  FAIL
bubble4        fgs2         8.258e-07    8.255e-09    8.258e-11     0.591  PASS
bubble4        pko+fgs1     7.618e-06    7.644e-08    7.646e-10     5.471  FAIL
bubble5-icm    plain        7.683e-07    7.682e-09    7.676e-11     1.000  PASS
bubble5-icm    pko          2.275e-07    2.275e-09    2.276e-11     0.296  PASS
bubble5-icm    ko           2.240e-07    2.238e-09    2.237e-11     0.291  PASS
bubble5-icm    fgs1         3.630e-07    3.635e-09    3.635e-11     0.474  PASS
bubble5-icm    pko+fgs1     3.109e-07    3.103e-09    3.101e-11     0.404  PASS
final8         plain        2.140e-06    2.139e-08    2.139e-10     1.000  PASS
final8         pko          1.395e-07    1.394e-09    1.394e-11     0.065  PASS
final8         ko           9.751e-08    9.751e-10    9.750e-12     0.046  PASS
rg-bubble4     plain        1.597e-03    3.151e-04    7.433e-05     1.000  PASS
rg-bubble4     pko          1.009e-03    2.785e-04    7.209e-05     0.970  PASS
rg-bubble4     ko           9.258e-04    1.617e-04    5.824e-05     0.784  PASS
rg-bubble4     fgs1         1.227e-03    2.366e-04    7.512e-05     1.011  PASS
rg-bubble4     fgs2         1.005e-03    2.468e-04    6.961e-05     0.937  PASS
rg-bubble4     pko+fgs1     1.079e-03    2.538e-04    9.116e-05     1.226  PASS
rg-icm3-river  plain        5.604e-03    1.376e-03    3.154e-04     1.000  PASS
rg-icm3-river  pko          5.624e-03    1.324e-03    3.903e-04     1.238  PASS
rg-icm3-river  ko           5.894e-03    1.413e-03    3.337e-04     1.058  PASS
rg-icm3-river  fgs1         5.354e-03    1.283e-03    3.322e-04     1.054  PASS
rg-icm3-river  fgs2         6.001e-03    1.288e-03    3.286e-04     1.042  PASS
rg-icm3-river  pko+fgs1     5.273e-03    1.443e-03    3.218e-04     1.020  PASS
sidepot3-icm   plain        3.174e-03    1.000e-03    3.516e-04     1.000  PASS
sidepot3-icm   pko          2.923e-03    9.075e-04    3.313e-04     0.942  PASS
sidepot3-icm   ko           3.351e-03    1.012e-03    3.473e-04     0.988  PASS
sidepot3-icm   fgs1         3.048e-03    9.869e-04    3.861e-04     1.098  PASS
sidepot3-icm   fgs2         3.062e-03    1.163e-03    3.594e-04     1.022  PASS
sidepot3-icm   pko+fgs1     2.751e-03    1.233e-03    3.776e-04     1.074  PASS

R2: FAIL
```

**R2 is NOT met.** 28 of 32 pairs pass. Failing pairs: bubble4 under pko:  ratio to plain 17043.63 (limit 3); bubble4 under ko:  ratio to plain 2529.89 (limit 3); bubble4 under fgs1:  ratio to plain 43.16 (limit 3); bubble4 under pko+fgs1:  ratio to plain 5.47 (limit 3). The rule was written beforehand and is reported as it came out; the notes below say what the failing pairs show.

What this does and does not say:

* The four failing pairs are all the one game `bubble4`, and all fail the same half of the rule: the ratio to plain
  ICM. In every one of them NashConv does fall from 20,000 to 2,000,000 deals. Plain `bubble4` is solved almost
  exactly (relative NashConv 1.4e-10 after 2,000,000 deals), so under the model it ends 5 to 17,000 times further
  from equilibrium, at 7.6e-10 to 2.4e-06 of the prize money. Those are small numbers, but the rule compared ratios
  and the ratios are far over the limit. The rule is not changed after the fact: R2 is a failure.
* What the failure shows: bounties (and one future hand) turn `bubble4` from a game the trainer solves at a fast,
  regular rate into one it solves at a slow rate, like the larger games in the table. Under progressive knockout
  NashConv fell only 46 times for 100 times the deals. Why this game changes character was not investigated in this
  release; it is carried forward. With two future hands the same game passes.
* The other 28 pairs pass; in the three larger games the ratios are between 0.78 and 1.24.
* The first attempt at these runs produced no result: the measuring script asked the exact check for a time limit
  above what the program accepts, and all 480 checks were refused. The limit in the script was corrected and all 480
  units were run again from the start; nothing in the program changed.
* Six small games, five seeds, a threshold of 3 chosen beforehand without a pilot behind it. It is a check that
  nothing is broken, not a measurement of a convergence rate.
* With future hands the *game being solved* contains the model's approximate solutions of the future hands as fixed
  numbers. NashConv says how well the studied hand is solved against those numbers. It says nothing about the future
  hands themselves (MATHEMATICAL-VALIDATION-5.15.md, section 4, does).

**The price of the model** (seconds for 2,000,000 deals, mean over seeds; the first deals pay for the future hands):

```
cost of the model: seconds for 2000000 deals (mean over seeds), variant / plain
bubble4        pko           12.5 s /     11.0 s =   1.14   future hands solved 0
bubble4        ko            12.1 s /     11.0 s =   1.10   future hands solved 0
bubble4        fgs1          13.2 s /     11.0 s =   1.20   future hands solved 62
bubble4        fgs2          25.6 s /     11.0 s =   2.34   future hands solved 1060
bubble4        pko+fgs1      13.9 s /     11.0 s =   1.26   future hands solved 62
bubble5-icm    pko           17.9 s /     15.0 s =   1.19   future hands solved 0
bubble5-icm    ko            18.0 s /     15.0 s =   1.20   future hands solved 0
bubble5-icm    fgs1          32.2 s /     15.0 s =   2.15   future hands solved 250
bubble5-icm    pko+fgs1      32.1 s /     15.0 s =   2.14   future hands solved 250
final8         pko           38.8 s /     31.0 s =   1.25   future hands solved 0
final8         ko            40.8 s /     31.0 s =   1.32   future hands solved 0
rg-bubble4     pko           13.8 s /     11.7 s =   1.18   future hands solved 0
rg-bubble4     ko            13.6 s /     11.7 s =   1.16   future hands solved 0
rg-bubble4     fgs1          14.8 s /     11.7 s =   1.27   future hands solved 84
rg-bubble4     fgs2          28.7 s /     11.7 s =   2.46   future hands solved 1347
rg-bubble4     pko+fgs1      15.5 s /     11.7 s =   1.33   future hands solved 84
rg-icm3-river  pko            3.1 s /      2.8 s =   1.13   future hands solved 0
rg-icm3-river  ko             3.0 s /      2.8 s =   1.08   future hands solved 0
rg-icm3-river  fgs1           5.9 s /      2.8 s =   2.14   future hands solved 28
rg-icm3-river  fgs2           7.5 s /      2.8 s =   2.69   future hands solved 261
rg-icm3-river  pko+fgs1       5.8 s /      2.8 s =   2.09   future hands solved 28
sidepot3-icm   pko            2.6 s /      2.2 s =   1.18   future hands solved 0
sidepot3-icm   ko             2.6 s /      2.2 s =   1.17   future hands solved 0
sidepot3-icm   fgs1           5.2 s /      2.2 s =   2.31   future hands solved 24
sidepot3-icm   fgs2           6.8 s /      2.2 s =   3.03   future hands solved 224
sidepot3-icm   pko+fgs1       5.5 s /      2.2 s =   2.45   future hands solved 24
```

## 3. R3: what future hands change

```
R3: the push/fold calculator with 0 .. max future hands (values in prize units; frequencies in percent of hands)

hu-12-8: stacks 12, 8; prizes 70, 30; at most 4 future hands
   0 hands: values 53.99 46.01 | first-in all-in 61.9 | BB calls first seat 45.0 | gain left 9.0e-8 | 0.1 s
   1 hands: values 53.97 46.03 | first-in all-in 61.1 | BB calls first seat 43.6 | gain left 6.6e-8 | 0.1 s | change: value 0.019, all-in 0.8 points
   2 hands: values 53.98 46.02 | first-in all-in 61.6 | BB calls first seat 44.6 | gain left 5.5e-8 | 0.2 s | change: value 0.010, all-in 0.5 points
   3 hands: values 53.97 46.03 | first-in all-in 61.4 | BB calls first seat 44.0 | gain left 9.8e-8 | 0.6 s | change: value 0.012, all-in 0.2 points
   4 hands: values 53.98 46.02 | first-in all-in 61.2 | BB calls first seat 44.4 | gain left 3.2e-8 | 1.0 s | change: value 0.008, all-in 0.2 points
   the last step changes less than the first
bubble3-6-12-9: stacks 6, 12, 9; prizes 50, 30, 20; at most 3 future hands
   0 hands: values 30.98 37.09 31.93 | first-in all-in 27.5 97.8 | BB calls first seat 25.6 | gain left 6.4e-8 | 0.1 s
   1 hands: values 29.57 38.10 32.33 | first-in all-in 36.4 100.0 | BB calls first seat 32.4 | gain left 7.9e-8 | 0.4 s | change: value 1.411, all-in 8.9 points
   2 hands: values 29.68 37.27 33.05 | first-in all-in 38.6 100.0 | BB calls first seat 31.7 | gain left 5.8e-8 | 2.7 s | change: value 0.825, all-in 2.3 points
   3 hands: values 30.37 37.40 32.23 | first-in all-in 30.7 95.3 | BB calls first seat 37.2 | gain left 3.5e-8 | 16.4 s | change: value 0.818, all-in 7.9 points
   the last step changes less than the first
bubble4-short-bb-next: stacks 4, 20, 15, 11; prizes 50, 30, 20; at most 2 future hands
   0 hands: values 12.20 34.81 29.80 23.19 | first-in all-in 29.6 100.0 100.0 | BB calls first seat 53.8 | gain left 5.1e-8 | 0.1 s
   1 hands: values 9.55 35.51 30.87 24.07 | first-in all-in 55.1 100.0 100.0 | BB calls first seat 53.0 | gain left 3.9e-8 | 1.4 s | change: value 2.655, all-in 25.5 points
   2 hands: values 9.50 34.73 31.25 24.53 | first-in all-in 54.5 100.0 100.0 | BB calls first seat 50.5 | gain left 8.5e-8 | 13.5 s | change: value 0.788, all-in 0.6 points
   the last step changes less than the first
bubble4-even: stacks 12, 12, 12, 12; prizes 50, 30, 20; at most 2 future hands
   0 hands: values 26.04 26.00 25.19 22.77 | first-in all-in 41.6 54.7 100.0 | BB calls first seat 7.1 | gain left 8.3e-8 | 0.2 s
   1 hands: values 24.16 26.90 26.10 22.84 | first-in all-in 63.6 69.8 100.0 | BB calls first seat 10.5 | gain left 9.8e-8 | 1.2 s | change: value 1.885, all-in 22.1 points
   2 hands: values 24.25 25.03 26.85 23.88 | first-in all-in 65.5 100.0 100.0 | BB calls first seat 7.1 | gain left 8.9e-8 | 9.7 s | change: value 1.877, all-in 30.2 points
   NO SIGN OF SETTLING: the last step changes more than the first (value 1.877 against 1.885, all-in 30.2 against 22.1 points)
five-left: stacks 10, 25, 14, 8, 30 (elsewhere 40, 22); prizes 40, 25, 15, 10, 6, 4; at most 2 future hands
   0 hands: values 9.13 16.77 11.63 7.32 18.02 | first-in all-in 19.7 35.8 38.9 57.5 | BB calls first seat 10.8 | gain left 9.7e-8 | 0.2 s
   1 hands: values 8.08 16.94 11.89 7.69 18.04 | first-in all-in 28.6 40.7 39.1 53.8 | BB calls first seat 12.7 | gain left 7.9e-8 | 2.5 s | change: value 1.048, all-in 8.9 points
   2 hands: values 8.00 16.34 12.04 7.95 18.17 | first-in all-in 29.8 40.7 38.9 50.3 | BB calls first seat 12.7 | gain left 8.6e-8 | 40.7 s | change: value 0.597, all-in 3.5 points
   the last step changes less than the first
six-left: stacks 10, 25, 14, 8, 30, 18; prizes 40, 25, 15, 10, 6, 4; at most 1 future hand
   0 hands: values 12.74 20.85 15.37 11.28 22.66 17.09 | first-in all-in 14.2 20.6 22.4 32.1 100.0 | BB calls first seat 7.2 | gain left 6.1e-8 | 0.2 s
   1 hands: values 12.26 20.97 15.53 11.47 22.79 16.99 | first-in all-in 18.0 20.8 22.4 31.1 100.0 | BB calls first seat 7.5 | gain left 8.7e-8 | 4.4 s | change: value 0.472, all-in 3.8 points
   one future hand at most at this table size: nothing can be said about settling
final8: stacks 30, 22, 15, 40, 9, 18, 25, 12; prizes 30, 20, 14, 11, 9, 7, 5, 4; at most 1 future hand
   0 hands: values 15.02 13.09 10.98 16.97 8.69 11.96 13.76 9.53 | first-in all-in 10.8 12.0 13.1 42.5 28.1 38.2 96.3 | BB calls first seat 3.4 | gain left 1.6e-7 | 1.6 s
   1 hands: values 14.88 13.12 11.02 17.00 8.75 12.00 13.80 9.42 | first-in all-in 10.8 11.7 13.2 42.1 27.3 36.1 90.3 | BB calls first seat 4.5 | gain left 9.9e-8 | 13.3 s | change: value 0.135, all-in 6.0 points
   one future hand at most at this table size: nothing can be said about settling
```

* **The first future hand matters.** It moves a first-in frequency by up to 25.5 points (`bubble4-short-bb-next`) and a value by up to 2.65 prize units; the seat that posts the big blind next loses value and pushes wider.
* **Nothing settles on `bubble4-even`.** By the rule written beforehand: on this table the last step changes more than the first. The other tables with two or more hands change less at the last step than at the first, but not little: frequencies still move by several points, and on `bubble3-6-12-9` the first seat's all-in frequency goes up, up and down again over three hands.
* **A likely reason, not shown:** each future hand moves the button one seat, so the sequence follows the orbit of the blinds; a number of hands that is not a whole orbit favours whoever has not yet posted. Nothing in this release tests that explanation.
* **What follows for use:** one future hand is a correction for the next big blind and is cheap. More hands are available, cost roughly 5 to 20 times more with each added hand, and are not shown to be better. No number of future hands is recommended here.
* The solver leaves a gain of about 1e-7 of the prize pool for one player in the studied hand (the "gain left" column), so the differences between rows are not solver noise.

## 4. What the new bounty rule changes in the push/fold calculator

Two tables, progressive knockout with 10 on every player (same file as section 3):

```
Bounties (progressive knockout, 10 on every player): the pool rule of 5.15 against the rule of the 5.14 calculator (own bounty times chip share)
   bubble4-short-bb-next, no bounties: first-in all-in 29.6 100.0 100.0 | BB calls first seat 53.8 | values 12.20 34.81 29.80 23.19
   bubble4-short-bb-next, 5.14 rule: first-in all-in 44.6 100.0 100.0 | BB calls first seat 100.0 | values 13.64 39.91 32.74 25.20
   bubble4-short-bb-next, 5.15 pool rule: first-in all-in 20.1 85.6 100.0 | BB calls first seat 83.8 | values 16.42 50.74 41.89 30.95
   bubble4-short-bb-next: largest change of a first-in frequency from the 5.14 rule to the pool rule 24.6 points; BB call 16.2 points
   six-left, no bounties: first-in all-in 14.2 20.6 22.4 32.1 100.0 | BB calls first seat 7.2 | values 12.74 20.85 15.37 11.28 22.66 17.09
   six-left, 5.14 rule: first-in all-in 7.8 13.2 10.6 33.0 100.0 | BB calls first seat 17.3 | values 13.78 23.31 16.79 12.22 26.17 18.80
   six-left, 5.15 pool rule: first-in all-in 12.7 20.2 20.9 28.1 75.9 | BB calls first seat 12.4 | values 18.51 35.10 23.44 16.00 39.72 27.24
   six-left: largest change of a first-in frequency from the 5.14 rule to the pool rule 24.1 points; BB call 5.0 points
```

The calculator of 5.14 counted only the bounty on a player himself. The pool rule counts every bounty still out, by
chip share, so chips are worth more to everybody and a covered opponent's bounty counts for more than its cash. On these two
tables the first-in frequencies move by up to about 25 points against the old rule, in both directions, and the big
blind's call of the first seat's all-in is wider than without bounties but narrower than under the old rule. **Results of the calculator with bounties are not comparable between 5.14 and
5.15.** Which rule is nearer to a real tournament is not established; MATHEMATICAL-VALIDATION-5.15.md, section 5,
gives the reason for the change (the old rule leaves most of the bounty money out).

## 5. The two small fixtures (exact inside their model; five trainings each)

At 2,000,000 deals, hero is the big blind with AdTc facing the button's all-in:

| Fixture | Variant | Leader | Call frequency | EV gap of the leader | Unit |
|---|---|---|---:|---:|---|
| pko6-bb-call-small | baseline | Call 11.9 | 100.0% | 1.7626 | percent of the prize pool |
| pko6-bb-call-small | knockout | Call 11.9 | 100.0% | 2.4168 | percent of the prize pool |
| pko6-bb-call-small | no-bounties | Fold | 48.6% | 0.0195 | percent of the prize pool |
| pko6-bb-call-small | chip-ev | Call 11.9 | 100.0% | 1.3550 | BB |
| fgs4-bubble-bb-call-small | baseline | Fold | 0.0% | 3.2805 | percent of the prize pool |
| fgs4-bubble-bb-call-small | one-hand | Fold | 0.0% | 3.7738 | percent of the prize pool |
| fgs4-bubble-bb-call-small | three-hands | Fold | 0.0% | 3.5039 | percent of the prize pool |
| fgs4-bubble-bb-call-small | plain-icm | Fold | 0.0% | 3.7260 | percent of the prize pool |
| fgs4-bubble-bb-call-small | chip-ev | Call 10.9 | 100.0% | 0.7415 | BB |

* **pko6-bb-call-small:** with bounties the call is ahead by a clear margin in all five trainings; without them the
  two actions are within 0.02 of each other and the trainings do not agree on the leader. The bounty on the button
  (10, half of it paid at once) is what makes the call. The study does not declare a best action (five trainings are
  too few for the program's own rule), and the EV difference is exact only inside the fixture's model.
* **fgs4-bubble-bb-call-small:** the fold leads in every variant. Future hands move the size of the gap by a few
  tenths of a percent of the prize pool and not its sign. This fixture does not show a decision that future hands
  change; it shows the mechanism running. (The calculator tables of section 3 show larger effects, on first-in
  ranges.)

## 6. Limits

* Small games, few seeds, short budgets: as in every release, the exact measure exists only where the game is small.
* The cost of future hands grows fast: at a table of six to eight even one future hand means thousands of solutions
  in the first deals of a study, each about 30 ms. Solutions are shared inside one run of the program and are not
  kept between runs.
* Nothing here was measured on the target PC.
