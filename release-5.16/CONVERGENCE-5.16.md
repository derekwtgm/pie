# EightMax 5.16: the error of the hand groupings

Build `39600509cc5a98e8`. Plan: `validation/5.16/plan.json`, written 2026-11-27T06:55:32Z, with five amendments (section 7 lists
them and says which were written after results were seen). Units: `validation/5.16/grouping/units` (800 units,
0 errors), `validation/5.16/heldout/units` (200). Analysis: `validation/5.16/analyze516.py`.

## 1. What was measured, and how

* **Games.** Eight small games with ranges: three on the river, three on the turn, two on the flop; two to four
  players; one with ICM (`source/tools/games516.js` lists them). 10 to 60 hands a seat, one or two bet sizes a
  street. Each game exists in the three groupings of the form and in the proposed fourth; nothing else differs.
* **Seeds and budgets.** Seeds 5161 to 5165, the same for every grouping of a game. 200,000 to 10,000,000 deals of
  the default trainer on one thread; every unit is a fresh training.
* **The measure.** `mwcli --gain`, method `exact`: for each seat, the best response over physical hands and exact
  boards against the trained average strategy. The responder is never restricted to a grouping. So one number is
  comparable across groupings: the exact NashConv of the strategy in the Exact-cards game. It is given as percent of
  the starting pot (the prize pool for the ICM game) a player.
* **What a grouping's number contains.** Two things that cannot be separated at one budget: what training has not
  yet removed, and what the grouping cannot express. Training removes the first; Exact cards has only the first. A
  grouping whose number stops falling has reached the second: its floor.
* **Before the plan.** A feasibility pilot (seed 1, 200,000 deals) was run and seen before the thresholds were
  chosen; the plan says so.

## 2. The numbers

```
Exact NashConv of the average strategy in the Exact-cards game, percent of the pot a player (geometric mean, 5 seeds)

game           grouping      200000     632000    2000000    6320000   10000000   rows at 10000000   seconds
rg-hu-river    compact       8.4765     8.5379     8.6474     8.7001     8.6106             56       5.9
rg-hu-river    detailed      0.5475     0.3591     0.2767     0.2900     0.2645            200       6.8
rg-hu-river    exact         0.6761     0.3255     0.1813     0.0907     0.0795            468       7.3
rg-hu-river    ranked        0.5132     0.4580     0.3735     0.3702     0.3687            108       6.5

rg-river3      compact       1.0377     1.2782     1.4389     0.9550     0.9933             84      11.8
rg-river3      detailed      0.2100     0.0859     0.0408     0.0176     0.0143            342      12.1
rg-river3      exact         0.2458     0.1141     0.0487     0.0214     0.0156            752      11.9
rg-river3      ranked        0.1660     0.0701     0.0597     0.0604     0.0510            175      11.5

rg-icm3-river  compact       0.1088     0.1108     0.1057     0.1087     0.1111             84      11.9
rg-icm3-river  detailed      0.0342     0.0165     0.0074     0.0052     0.0039            342      13.9
rg-icm3-river  exact         0.0408     0.0222     0.0109     0.0057     0.0048            752      14.3
rg-icm3-river  ranked        0.0244     0.0137     0.0118     0.0068     0.0062            175      13.0

rg-hu-turn     compact       2.7655     2.8526     2.8937     2.9577     2.9602            120       7.7
rg-hu-turn     detailed      0.9046     0.6093     0.5428     0.4806     0.4649           1288       8.5
rg-hu-turn     exact         1.3403     0.6918     0.3706     0.2074     0.1661           6016       9.0
rg-hu-turn     ranked        1.3891     1.2999     1.3498     1.3740     1.4153            242       8.3

rg-turn3       compact       4.8851     4.6452     4.5351     4.4766     4.4249           4102      26.3
rg-turn3       detailed      3.2579     1.7636     0.9644     0.5806     0.4807          45027      39.9
rg-turn3       exact         4.2008     2.3294     1.2413     0.6459     0.5345          86179      39.8
rg-turn3       ranked        2.3761     1.6821     1.3542     1.1861     1.1856          10347      29.1

rg-turn4       compact       0.7981     0.7046     0.6731     0.6380     0.6284           2759      21.4
rg-turn4       detailed      0.4225     0.1518     0.1000     0.0559     0.0567          13714      21.4
rg-turn4       exact         0.6227     0.2459     0.1233     0.0586     0.0519          33219      24.7
rg-turn4       ranked        0.4782     0.3365     0.3247     0.3125     0.3405           3581      21.6

rg-hu-flop     compact        17.22      16.72      16.80      17.23      17.42           9235      29.1
rg-hu-flop     detailed       28.72      16.46     9.2524     5.7768     5.0046         414316      69.2
rg-hu-flop     exact          51.90      37.43      22.24      10.90     8.0217        1827427      97.5
rg-hu-flop     ranked         14.62      12.86      12.90      12.80      12.99          29331      36.8

rg-flop3c      compact       4.5821     4.6830     4.6319     4.7166     4.8184           2152      27.0
rg-flop3c      detailed      3.0807     1.7511     1.0873     0.8606     0.7893          24690      34.3
rg-flop3c      exact         4.6004     2.3650     1.1238     0.5669     0.4275          54237      38.3
rg-flop3c      ranked        3.0451     2.7914     2.7435     2.7899     2.7871           2831      31.1
```

## 3. R1: is the error large?

Rule: large on a game when the value at 10,000,000 deals is above 0.5 percent of the pot a player **and** above 3
times that of Exact cards; large overall when large on at least 2 of 8 games.

```
R1: the floor of a grouping at 10000000 deals; LARGE = above 0.5 percent of the pot a player and above 3 times Exact cards

game           grouping       floor      exact    ratio  settled      verdict
rg-hu-river    compact       8.6106     0.0795   108.31  settled      LARGE
rg-hu-river    detailed      0.2645     0.0795     3.33  settled      not large
rg-hu-river    ranked        0.3687     0.0795     4.64  settled      not large
rg-river3      compact       0.9933     0.0156    63.75  still falling LARGE
rg-river3      detailed      0.0143     0.0156     0.92  still falling not large
rg-river3      ranked        0.0510     0.0156     3.27  settled      not large
rg-icm3-river  compact       0.1111     0.0048    23.17  settled      not large
rg-icm3-river  detailed      0.0039     0.0048     0.81  still falling not large
rg-icm3-river  ranked        0.0062     0.0048     1.28  still falling not large
rg-hu-turn     compact       2.9602     0.1661    17.82  settled      LARGE
rg-hu-turn     detailed      0.4649     0.1661     2.80  settled      not large
rg-hu-turn     ranked        1.4153     0.1661     8.52  settled      LARGE
rg-turn3       compact       4.4249     0.5345     8.28  settled      LARGE
rg-turn3       detailed      0.4807     0.5345     0.90  still falling not large
rg-turn3       ranked        1.1856     0.5345     2.22  settled      not large
rg-turn4       compact       0.6284     0.0519    12.10  settled      LARGE
rg-turn4       detailed      0.0567     0.0519     1.09  still falling not large
rg-turn4       ranked        0.3405     0.0519     6.56  settled      not large
rg-hu-flop     compact        17.42     8.0217     2.17  settled      not large
rg-hu-flop     detailed      5.0046     8.0217     0.62  still falling not large
rg-hu-flop     ranked         12.99     8.0217     1.62  settled      not large
rg-flop3c      compact       4.8184     0.4275    11.27  settled      LARGE
rg-flop3c      detailed      0.7893     0.4275     1.85  still falling not large
rg-flop3c      ranked        2.7871     0.4275     6.52  settled      LARGE

compact: large on 6 of 8 games (rg-hu-river, rg-river3, rg-hu-turn, rg-turn3, rg-turn4, rg-flop3c) -> LARGE OVERALL
detailed: large on 0 of 8 games (none) -> not large overall
ranked: large on 2 of 8 games (rg-hu-turn, rg-flop3c) -> LARGE OVERALL
```

* **Compact: large on 6 of 8 games (`rg-hu-river`, `rg-river3`, `rg-hu-turn`, `rg-turn3`, `rg-turn4`, `rg-flop3c`); 0.11 to 17.42 percent of the pot a player after 10,000,000 deals, 2.2 to 108 times Exact cards; settled on 7 games, still falling on 1.** Its values do not fall with training: this is a floor. The two games where the
  rule does not call it large: the ICM river game, where every number is small against the prize pool (Compact is
  still 23 times Exact cards there), and the heads-up flop game, where Exact cards itself is far
  from solved at 10,000,000 deals; Compact's value there is the highest of the four groupings.
* **Detailed: large on 0 of 8 games; 0.00 to 5.00 percent of the pot a player after 10,000,000 deals, 0.6 to 3 times Exact cards; settled on 2 games, still falling on 6.** In most games its value is still falling at 10,000,000 deals, so its floor is below
  what was measured.
* **Ranked: large on 2 of 8 games (`rg-hu-turn`, `rg-flop3c`); 0.01 to 12.99 percent of the pot a player after 10,000,000 deals, 1.3 to 9 times Exact cards; settled on 7 games, still falling on 1.** Its values are settled: these are floors.

## 4. R2: equal time

The practical question: after the same seconds of training, which grouping is closest to equilibrium? Times are the
seconds Exact cards needed for 200,000, 2,000,000 and 10,000,000 deals. Rule: BETTER or WORSE than Exact cards only
when all five seeds agree.

```
R2 (amendment 2): equal time. NashConv (BB or prize units, geometric mean) at the seconds Exact cards needed, seed by seed, for
    200,000, 2,000,000 and 10000000 deals. A grouping against Exact cards: BETTER / WORSE when all 5 seeds agree, otherwise
    unresolved. * = the grouping had reached its 10000000 deals before that time (value at its limit). n/a = not yet at its first point.

game             seconds  compact                             detailed                            exact                               ranked                              
rg-hu-river         0.20  1.698 WORSE                         0.1056 BETTER                       0.1352                              n/a                                 
rg-hu-river         1.41  1.73 WORSE                          0.05642 WORSE                       0.03626                             0.07634 WORSE                       
rg-hu-river         7.32  1.722* WORSE                        0.05291* WORSE                      0.0159                              0.07373* WORSE                      

rg-river3           0.28  n/a                                 n/a                                 0.04424                             n/a                                 
rg-river3           2.56  0.2429 WORSE                        0.007494 unresolved (3 of 5 lower)  0.008772                            0.01068 unresolved (1 of 5 lower)   
rg-river3          11.85  0.1795* WORSE                       0.002652* unresolved (3 of 5 lower) 0.002805                            0.009235* WORSE                     

rg-icm3-river       0.33  n/a                                 n/a                                 0.1224                              n/a                                 
rg-icm3-river       3.10  0.3181 WORSE                        0.02198 BETTER                      0.03283                             0.03391 unresolved (2 of 5 lower)   
rg-icm3-river      14.33  0.3334* WORSE                       0.01179* unresolved (4 of 5 lower)  0.01439                             0.01846* unresolved (1 of 5 lower)  

rg-hu-turn          0.26  n/a                                 n/a                                 0.2144                              n/a                                 
rg-hu-turn          2.12  0.4644 WORSE                        0.08709 WORSE                       0.05929                             0.2158 WORSE                        
rg-hu-turn          9.03  0.4736* WORSE                       0.07439* WORSE                      0.02658                             0.2264* WORSE                       

rg-turn3            0.73  2.075 WORSE                         n/a                                 1.802                               n/a                                 
rg-turn3            8.13  1.936 WORSE                         0.4007 BETTER                       0.5325                              0.5589 WORSE                        
rg-turn3           39.85  1.898* WORSE                        0.2072* BETTER                      0.2293                              0.5086* WORSE                       

rg-turn4            0.67  0.4284 WORSE                        0.1776 BETTER                       0.3388                              n/a                                 
rg-turn4            5.11  0.359 WORSE                         0.05067 unresolved (4 of 5 lower)   0.06709                             0.1744 WORSE                        
rg-turn4           24.74  0.3418* WORSE                       0.03084* unresolved (2 of 5 lower)  0.02824                             0.1853* WORSE                       

rg-hu-flop          1.45  1.672 BETTER                        n/a                                 5.19                                1.375 BETTER                        
rg-hu-flop         18.61  1.726 BETTER                        0.8431 BETTER                       2.224                               1.281 BETTER                        
rg-hu-flop         97.48  1.742* WORSE                        0.5005* BETTER                      0.8022                              1.299* WORSE                        

rg-flop3c           0.86  1.357 unresolved (2 of 5 lower)     n/a                                 1.353                               n/a                                 
rg-flop3c           8.32  1.371 WORSE                         0.3105 unresolved (4 of 5 lower)    0.3304                              0.8082 WORSE                        
rg-flop3c          38.29  1.417* WORSE                        0.2322* WORSE                       0.1257                              0.8194* WORSE
```

* **At the largest time** (Exact cards trained to 10,000,000 deals): Compact is WORSE than Exact cards on 8 of 8 games and BETTER on 0; Detailed is WORSE on 3 and BETTER on 2; Ranked is WORSE on 7 and BETTER on 0. The rest are unresolved (the seeds disagree).
* **At the middle time** (2,000,000 deals of Exact cards): Compact WORSE on 7, BETTER on 1; Detailed WORSE on 2, BETTER on 3; Ranked WORSE on 5, BETTER on 1.
* **Reading.** A coarse grouping learns fast and then stops at its floor. Compact is ahead only where Exact cards has hardly started (the heads-up flop game at the short and middle times). Detailed is never clearly behind Exact cards by much and is ahead in the games with the most rows, where Exact cards spends its deals on rows it rarely visits again. Where Detailed fits in memory, these games give no reason to prefer Exact cards for a training of this length, and none to prefer Compact.

Limits: one thread; seconds measured while three units ran side by side on four processors; 10,000,000 deals is the
most the default trainer accepts on these games, and a grouping that got there early keeps its last value (marked
`*`). The table as the plan first defined it (times as means over seeds, no value outside a grouping's own measured
times) had values at the middle time only; it is kept as `grouping/summary-as-planned.txt`. Amendment 2 repaired that
after the results were seen and changed no verdict of R1 or R3.

## 5. R3: does the strategy move?

Distance between first-street strategies at 10,000,000 deals, per physical hand, against Exact cards of the same
seed; compared with the distance between Exact-cards strategies of different seeds.

```
R3: first-street strategies at 10000000 deals: distance to Exact cards of the same seed (mean total variation, 0 to 1), against
    the distances between Exact-cards strategies of different seeds. Root decision: largest change of an aggregate frequency, points.

game           grouping    distance  root only  root freq pts      noise max  verdict
rg-hu-river    exact*        0.0408     0.0323           0.58         0.0460  (between seeds; 8 decisions)
rg-hu-river    compact       0.4623     0.6653          50.47                 MOVES the strategy
rg-hu-river    detailed      0.0675     0.0869           1.47                 MOVES the strategy
rg-hu-river    ranked        0.0773     0.0969           2.37                 MOVES the strategy

rg-river3      exact*        0.0125     0.0023           0.15         0.0143  (between seeds; 25 decisions)
rg-river3      compact       0.1087     0.0026           0.26                 MOVES the strategy
rg-river3      detailed      0.0117     0.0018           0.15                 within seed noise
rg-river3      ranked        0.0162     0.0022           0.20                 MOVES the strategy

rg-icm3-river  exact*        0.0524     0.0032           0.11         0.0722  (between seeds; 25 decisions)
rg-icm3-river  compact       0.1425     0.0041           0.13                 MOVES the strategy
rg-icm3-river  detailed      0.0477     0.0026           0.21                 within seed noise
rg-icm3-river  ranked        0.0669     0.0029           0.28                 within seed noise

rg-hu-turn     exact*        0.0217     0.0132           0.62         0.0274  (between seeds; 4 decisions)
rg-hu-turn     compact       0.0899     0.0837           3.09                 MOVES the strategy
rg-hu-turn     detailed      0.0559     0.0505           2.66                 MOVES the strategy
rg-hu-turn     ranked        0.0629     0.0506           2.93                 MOVES the strategy

rg-turn3       exact*        0.0523     0.0779           0.99         0.0641  (between seeds; 44 decisions)
rg-turn3       compact       0.2315     0.3201          19.36                 MOVES the strategy
rg-turn3       detailed      0.0464     0.0635           0.50                 within seed noise
rg-turn3       ranked        0.0504     0.0657           1.79                 within seed noise

rg-turn4       exact*        0.0091     0.0084           0.42         0.0113  (between seeds; 32 decisions)
rg-turn4       compact       0.0149     0.0240           2.12                 MOVES the strategy
rg-turn4       detailed      0.0082     0.0055           0.23                 within seed noise
rg-turn4       ranked        0.0138     0.0216           1.81                 MOVES the strategy

rg-hu-flop     exact*        0.0144     0.0189           0.55         0.0170  (between seeds; 4 decisions)
rg-hu-flop     compact       0.1496     0.1043           6.71                 MOVES the strategy
rg-hu-flop     detailed      0.0412     0.0432           4.11                 MOVES the strategy
rg-hu-flop     ranked        0.1366     0.1138           2.45                 MOVES the strategy

rg-flop3c      exact*        0.0199     0.0231           1.21         0.0233  (between seeds; 12 decisions)
rg-flop3c      compact       0.1128     0.0868           4.97                 MOVES the strategy
rg-flop3c      detailed      0.0408     0.0437           1.06                 MOVES the strategy
rg-flop3c      ranked        0.0753     0.0819           3.09                 MOVES the strategy
```

* By the rule, Compact moves the strategy on 8 of 8 games, Detailed on 4, Ranked on 6.
* The largest change of a frequency at the first decision: Compact 50.5 points (`rg-hu-river`), Detailed 4.1 (`rg-hu-flop`), Ranked 3.1 (`rg-flop3c`); two Exact-cards seeds differ by at most 2.3 points there.
* The rule is strict: any mean distance above the largest seed-to-seed distance counts, so "moves" includes small movements. The sizes are in the table. Compact's are the large ones.

With three or more players equilibria are not unique, so a distance there is a difference, not an error. And the
Exact-cards strategy it is compared with is itself not converged in the larger games.

## 6. R4: the proposal

**How it was found.** After R1 called Compact large, candidates were tried on the five river and turn games only,
with seeds 1 and 2 at 2,000,000 deals (`validation/5.16/explore`). About twenty variants were tried. What they
showed:

* refining Compact's fixed scale (exact top rank, a kicker class) roughly halves its error and no more;
* ranking the hand inside the seat's own range removes most of the error on river games;
* on turn games that is not enough: the row must also know something about the new card. Its exact rank helps most;
* ranking the hand against the other seats' ranges instead did not help.

**The first candidate failed.** 32 levels of rank in range plus the exact rank of each new card. It was built into
the program and failed the size check at once: 2,691,557 rows against 7,031,821 of Detailed after 1,000,000 deals on
the fixture `flop3-kings` (0.383; the limit written beforehand was 0.25). It was dropped; its units were not run.

**The second candidate** replaces the card's rank by a class of eight and uses 16 levels. It was frozen before any
unit of the plan was run for any candidate (amendment 4), and the size check was used as a design constraint when
choosing it. This is the Ranked grouping of the release.

**The judgement** (rules written before any candidate existed, amendment 3):

```
R4: ranked against compact: floor lower on 8 of 8 games; above 1.25 times on: none; rows not above Detailed on 8; worse at the largest equal time on: none -> BETTER (rule met)
R4: ranked against detailed: floor lower on 0 of 8 games; above 1.25 times on: rg-hu-river, rg-river3, rg-icm3-river, rg-hu-turn, rg-turn3, rg-turn4, rg-hu-flop, rg-flop3c; rows not above Detailed on 8; worse at the largest equal time on: rg-hu-river, rg-river3, rg-icm3-river, rg-hu-turn, rg-turn3, rg-turn4, rg-hu-flop, rg-flop3c -> rule NOT met
```

* **Against Compact: floor lower on 8 of 8 games, above 1.25 times Compact on none, rows not above Detailed on 8 of 8, worse at the largest equal time on none: **the rule is met**.**
* **Against Detailed: floor lower on 0 of 8 games; worse at the largest equal time on 8 of 8.** Ranked is not a replacement for Detailed.
* **Held-out games** (two games on other boards, defined before the design and not used in it):

```
Held-out games: exact NashConv in the Exact-cards game, percent of the pot a player (geometric mean, 5 seeds)

game         grouping      200000     632000    2000000    6320000   10000000   rows at 10000000
ho-hu-river  compact       3.8340     3.6878     3.5761     3.5549     3.5447           52
ho-hu-river  ranked        1.2711     1.1167     1.0834     1.0258     0.9999          108
ho-hu-river  detailed      0.6304     0.3210     0.1830     0.0975     0.0726          232
ho-hu-river  exact         0.7105     0.3697     0.2094     0.1113     0.0928          348
  Ranked lower than Compact at 10000000 deals: yes (in 5 of 5 seeds)

ho-hu-turn   compact       1.0431     1.1506     1.1507     1.2570     1.2887          230
ho-hu-turn   ranked        0.8916     0.8661     0.7117     0.7870     0.7750          636
ho-hu-turn   detailed      0.5206     0.3080     0.1632     0.0902     0.0755         2340
ho-hu-turn   exact         0.6940     0.3786     0.2200     0.1219     0.0911         5170
  Ranked lower than Compact at 10000000 deals: yes (in 5 of 5 seeds)

held-out check: PASSED (Ranked is lower than Compact on both games)
units 200, errors 0
```

  The held-out check is **passed**: Ranked is below Compact on both games, in 5 and 5 of 5 seeds. It is also well above Detailed on both.
* **Size on the large fixture** (`flop3-kings`, 109 to 360 hands a seat, 1,000,000 deals, one seed):

  | Grouping | Rows | Table MiB | Keys |
  |---|---:|---:|---:|
  | Compact | 181,072 | 17 | 618 |
  | Ranked | 1,385,718 | 134 | 12,132 |
  | Detailed | 7,031,821 | 672 | 248,029 |

  The size check is **passed**: 0.197 of Detailed's rows (limit 0.25). Ranked needs 7.7 times the rows of Compact.

**What a pass means here.** Ranked is offered as a fourth choice. It is not the default, and no fixture was moved to
it. By rule R1 its own error is large: it is a smaller error than Compact's, not a small one.

**Weaknesses seen.** On the turn games the class of the card loses much of what its rank gave in exploration (the
first candidate reached 0.33 percent of the pot on the heads-up turn game at 2,000,000 deals; the released one stays
near 1.4). With ranges of hundreds of hands, 16 levels merge hands that these games never merge; what
that costs is not measured.

## 7. The amendments

| | When | What |
|---|---|---|
| 1 | before any result was read | the largest budget is 10,000,000 deals, not 20,000,000: the default trainer refused all 120 units of 20,000,000 deals on these games |
| 2 | **after** the results of the three groupings were read | R2 takes its times seed by seed and lets a grouping that reached 10,000,000 deals keep its value; as written, R2 had values at one of three times only |
| 3 | after R1 called Compact large, before any candidate was written | how a proposal is developed and judged: development games and seeds, two held-out games, the size check, what a pass means |
| 4 | after the first candidate failed the size check, before any unit was run for any candidate | the second candidate, frozen |
| 5 | after the first complete run on the frozen build `3490f9edf48ec1db`, before the run reported here | that build was withdrawn (earlier programs continued a Ranked state under the Compact study; Ranked states now also write `"rowKeys":2`, which they refuse). No rule, game, seed, budget or key changed. Everything was run again on the released build; all 800 units of the withdrawn build gave the same NashConv and row counts |

## 8. What is not established

* The error of any grouping in games with hundreds of hands a seat, or in preflop studies.
* Whether Ranked is better than Compact there. The size check says what it costs (7.7 times
  Compact's rows on `flop3-kings`), not what it buys.
* Whether the eight games are typical. They were built in 5.10 to be small enough for an exact best response, with
  one or two bet sizes a street.
* Results on more than one thread or with the `rbes` estimator.
