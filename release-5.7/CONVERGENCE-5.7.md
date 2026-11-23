# Convergence — EightMax 5.7 against 5.6

Build `e4668abe7903f8b0`. Raw data, plans and analyses: `validation/5.7/convergence/` (`main/`, `flop6/`, `restricted/`, `pilot/`, `flop6-diagnosis.json`). Runner: `source/tools/research57.py`; every plan was written to `plan.json` before its first measurement, every row of `raw.jsonl` is kept, and nothing was stopped or selected on results.

**What 5.7 changed and what it did not.** The default trainer (one deal per update) is the 5.6 trainer: same estimator, same code path. Frozen-batch training (several deals per update against a frozen strategy, the mode that uses several threads) computes what 5.6 computed and does it faster on several threads. No new estimator was written. So the questions for this release are (a) is anything different at equal sampled deals (it must not be), (b) does the faster parallel mode get closer to equilibrium in the same wall-clock time than 5.6's, (c) is it closer than the default trainer, which would be a reason to change the default, and (d) the 5.6 result that was left unresolved on the six-player flop game.

NashConv below is exact inside each game's abstraction (an all-seat best response by the 5.7 evaluator, whose values equal 5.6's). With more than two players it is not exploitability, and reaching zero does not make a strategy unbeatable by coalitions.

## 1. Plan (written before measurement)

- Games: hu-river (heads-up river), hu-turn (heads-up turn and river), river3-chip (three-player river, side pots), turn4 (four-player turn and river), flop6 (six-player flop, all-in or fold), final8 (eight-handed ICM final table), bubble4 (four-player ICM bubble).
- Paired seeds: 30 (2001 to 2030), not used by any earlier release. A one-seed pilot (seed 901) checked that every arm runs; it is kept in `pilot/` and not analysed.
- Arms: `default56` (5.6 binary, default trainer, 1 thread offered); `default57` (5.7 binary, default trainer, 1 thread offered); `batch56t4` (5.6 binary, frozen batches of 64 deals with per-deal action streams, 4 threads offered); `batch57t4` (5.7 binary, frozen batches of 64 deals with per-deal action streams, 4 threads offered).
- Budgets: 19,200 sampled deals; 0.25 and 1.0 seconds of wall-clock training. Table budget 128 MiB. Arms of a seed run one after another in rotated order, one process at a time.
- Evaluation: exact all-seat best response (NashConv inside the abstraction; with more than two players it is not exploitability), CPU, one thread, 5.7 binary, separate process from training.
- Identity rule: At equal sampled deals the two arms of an identity contrast must write the same checkpoint file for every seed; any difference is a defect.
- Primary metric: paired difference of exact NashConv at the largest equal-wall-clock training budget (1.00 s). Family: 2 primary contrasts x 7 games = 14 tests at the largest time budget, Bonferroni over 14; the other budgets use the same penalty and are reported, not claimed.
- Tests: exact two-sided sign test on the paired differences (distribution-free for the median) AND paired Student-t interval (model-based), each Bonferroni-adjusted; "better"/"worse" needs both on the same side; pairs with equal NashConv are "identical"; anything else is "unresolved" and is not a result.
- Stopping rule: fixed: every arm x budget x seed of the plan is run once; no interim analysis; a failed process aborts the run and the directory is kept as it is.
- Promotion rule: Frozen-batch training becomes the default training mode only if batch57t4 vs default57 is "better" at the largest time budget in EVERY game. Otherwise it stays an option, and the report says in which games it helped.
- Limitations stated in the plan: Small games with exact evaluation only. NashConv is exact inside each abstraction. Equal-time budgets are wall-clock on a shared four-core virtual machine (the four-thread arms use all of it): timing noise enters those contrasts and is spread over the rotated arm order. Frozen batches (64 deals per update) are a different schedule of updates from the default trainer, so batch arms differ from default arms at equal deals by design.

Rows produced: 2520 of 2520 planned.

## 2. Equal sampled deals: are the updates the same?

| Game | default57 vs default56: identical checkpoint files | batch57t4 vs batch56t4: identical checkpoint files | NashConv at 19,200 deals: default / frozen batches (mean) |
|---|---|---|---|
| hu-river | 30 of 30 | 30 of 30 | 0.3061 / 0.4392 |
| hu-turn | 30 of 30 | 30 of 30 | 0.3578 / 0.4937 |
| river3-chip | 30 of 30 | 30 of 30 | 0.1389 / 0.2058 |
| turn4 | 30 of 30 | 30 of 30 | 0.1086 / 0.1175 |
| flop6 | 30 of 30 | 30 of 30 | 0.3688 / 0.4125 |
| final8 | 30 of 30 | 30 of 30 | 0.0029 / 0.0138 |
| bubble4 | 30 of 30 | 30 of 30 | 0.0036 / 0.0038 |

**Every checkpoint file is identical.** At equal sampled deals 5.7 is 5.6, for the default trainer and for frozen batches on four threads. (Frozen batches and the default trainer differ from each other at equal deals by design: 64 deals share one strategy update.)

## 3. Equal wall-clock time

### 3.1 Q1 — 5.7 frozen batches on four threads against 5.6 frozen batches on four threads (primary, 1.0 s)

| Game | Sampled deals in 1.0 s, 5.7 / 5.6 | NashConv candidate / reference (mean) | Ratio of means | Seeds lower / higher / equal | Sign test p (Bonferroni) | t interval of the difference (Bonferroni) | Verdict |
|---|---|---|---|---|---|---|---|
| hu-river | 1,922,050 / 1,787,484 | 0.0319 / 0.0304 | 1.05 | 12 / 18 / 0 | 1 | [-0.0045, 0.0074] | **unresolved** |
| hu-turn | 1,414,547 / 1,420,572 | 0.0550 / 0.0551 | 1.00 | 17 / 13 / 0 | 1 | [-0.0050, 0.0047] | **unresolved** |
| river3-chip | 1,343,661 / 962,758 | 0.0178 / 0.0219 | 0.82 | 21 / 9 / 0 | 0.6 | [-0.0087, 0.0006] | **unresolved** |
| turn4 | 992,435 / 552,090 | 0.0000 / 0.0001 | 0.31 | 30 / 0 / 0 | 2.6e-08 | [-0.0001, -0.0001] | **better** |
| flop6 | 698,839 / 409,231 | 0.0435 / 0.0621 | 0.70 | 21 / 9 / 0 | 0.6 | [-0.0436, 0.0064] | **unresolved** |
| final8 | 522,709 / 325,521 | 0.0000 / 0.0000 | 0.40 | 30 / 0 / 0 | 2.6e-08 | [-0.0001, 0.0000] | **unresolved** |
| bubble4 | 1,299,497 / 799,313 | 0.0000 / 0.0000 | 0.39 | 30 / 0 / 0 | 2.6e-08 | [-0.0000, -0.0000] | **better** |

Verdicts: hu-river unresolved, hu-turn unresolved, river3-chip unresolved, turn4 better, flop6 unresolved, final8 unresolved, bubble4 better. At 0.25 s: hu-river unresolved (ratio 0.94), hu-turn unresolved (ratio 0.99), river3-chip unresolved (ratio 1.02), turn4 better (ratio 0.35), flop6 unresolved (ratio 0.80), final8 unresolved (ratio 0.41), bubble4 better (ratio 0.47).

In final8 the sign test alone is significant after the adjustment (final8: 30 of 30 seeds lower) and the t interval is not: a few seeds with a large NashConv dominate the variance of the differences. The rule set in advance needs both tests, so these are reported as unresolved, not as improvements.

### 3.2 Q2 — 5.7 frozen batches on four threads against the default trainer on one thread (primary, 1.0 s)

| Game | Sampled deals in 1.0 s, frozen batches / default | NashConv candidate / reference (mean) | Ratio of means | Seeds lower / higher / equal | Sign test p (Bonferroni) | t interval of the difference (Bonferroni) | Verdict |
|---|---|---|---|---|---|---|---|
| hu-river | 1,922,050 / 1,679,242 | 0.0319 / 0.0267 | 1.19 | 10 / 20 / 0 | 1 | [-0.0019, 0.0121] | **unresolved** |
| hu-turn | 1,414,547 / 1,302,186 | 0.0550 / 0.0463 | 1.19 | 4 / 26 / 0 | 0.00083 | [0.0039, 0.0136] | **worse** |
| river3-chip | 1,343,661 / 905,702 | 0.0178 / 0.0167 | 1.07 | 13 / 17 / 0 | 1 | [-0.0036, 0.0058] | **unresolved** |
| turn4 | 992,435 / 563,018 | 0.0000 / 0.0001 | 0.49 | 24 / 6 / 0 | 0.02 | [-0.0001, -0.0000] | **better** |
| flop6 | 698,839 / 312,301 | 0.0435 / 0.0633 | 0.69 | 13 / 17 / 0 | 1 | [-0.0546, 0.0149] | **unresolved** |
| final8 | 522,709 / 206,418 | 0.0000 / 0.0000 | 0.70 | 17 / 13 / 0 | 1 | [-0.0000, 0.0000] | **unresolved** |
| bubble4 | 1,299,497 / 712,763 | 0.0000 / 0.0000 | 0.32 | 24 / 6 / 0 | 0.02 | [-0.0000, 0.0000] | **unresolved** |

Verdicts: hu-river unresolved, hu-turn worse, river3-chip unresolved, turn4 better, flop6 unresolved, final8 unresolved, bubble4 unresolved. At 0.25 s: hu-river unresolved (ratio 1.20), hu-turn worse (ratio 1.26), river3-chip unresolved (ratio 1.02), turn4 unresolved (ratio 0.58), flop6 unresolved (ratio 0.65), final8 unresolved (ratio 0.75), bubble4 unresolved (ratio 0.32).

### 3.3 Descriptive contrasts (1.0 s; same penalty, not claimed)

| Game | Sampled deals, 5.7 default / 5.6 default | NashConv candidate / reference (mean) | Ratio of means | Seeds lower / higher / equal | Sign test p (Bonferroni) | t interval of the difference (Bonferroni) | Verdict |
|---|---|---|---|---|---|---|---|
| hu-river | 1,679,242 / 1,729,781 | 0.0267 / 0.0253 | 1.06 | 15 / 15 / 0 | 1 | [-0.0030, 0.0059] | **unresolved** |
| hu-turn | 1,302,186 / 1,301,840 | 0.0463 / 0.0455 | 1.02 | 12 / 18 / 0 | 1 | [-0.0014, 0.0029] | **unresolved** |
| river3-chip | 905,702 / 914,690 | 0.0167 / 0.0192 | 0.87 | 21 / 9 / 0 | 0.6 | [-0.0048, -0.0001] | **unresolved** |
| turn4 | 563,018 / 582,826 | 0.0001 / 0.0001 | 1.09 | 15 / 15 / 0 | 1 | [-0.0000, 0.0000] | **unresolved** |
| flop6 | 312,301 / 307,853 | 0.0633 / 0.0634 | 1.00 | 13 / 17 / 0 | 1 | [-0.0156, 0.0155] | **unresolved** |
| final8 | 206,418 / 211,206 | 0.0000 / 0.0000 | 0.89 | 15 / 15 / 0 | 1 | [-0.0000, 0.0000] | **unresolved** |
| bubble4 | 712,763 / 682,066 | 0.0000 / 0.0000 | 0.83 | 17 / 13 / 0 | 1 | [-0.0000, 0.0000] | **unresolved** |

The default trainer of 5.7 is the default trainer of 5.6; this contrast measures the noise of an equal-time comparison between two programs doing the same work on this machine. Any verdict other than "unresolved" here would be a warning about the method.

| Game | Sampled deals, 5.6 frozen batches / 5.6 default | NashConv candidate / reference (mean) | Ratio of means | Seeds lower / higher / equal | Sign test p (Bonferroni) | t interval of the difference (Bonferroni) | Verdict |
|---|---|---|---|---|---|---|---|
| hu-river | 1,787,484 / 1,729,781 | 0.0304 / 0.0253 | 1.20 | 9 / 21 / 0 | 0.6 | [-0.0007, 0.0110] | **unresolved** |
| hu-turn | 1,420,572 / 1,301,840 | 0.0551 / 0.0455 | 1.21 | 4 / 26 / 0 | 0.00083 | [0.0049, 0.0144] | **worse** |
| river3-chip | 962,758 / 914,690 | 0.0219 / 0.0192 | 1.14 | 11 / 19 / 0 | 1 | [-0.0022, 0.0075] | **unresolved** |
| turn4 | 552,090 / 582,826 | 0.0001 / 0.0001 | 1.70 | 5 / 25 / 0 | 0.0045 | [0.0000, 0.0001] | **worse** |
| flop6 | 409,231 / 307,853 | 0.0621 / 0.0634 | 0.98 | 13 / 17 / 0 | 1 | [-0.0340, 0.0313] | **unresolved** |
| final8 | 325,521 / 211,206 | 0.0000 / 0.0000 | 1.56 | 11 / 19 / 0 | 1 | [-0.0000, 0.0001] | **unresolved** |
| bubble4 | 799,313 / 682,066 | 0.0000 / 0.0000 | 0.68 | 19 / 11 / 0 | 1 | [-0.0000, 0.0000] | **unresolved** |

### 3.4 Decision

- **Q1.** 5.7's parallel training is closer to equilibrium than 5.6's after the same 1.0 s in: turn4, bubble4. Not resolved in: hu-river, hu-turn, river3-chip, flop6, final8. Worse in: none.
- **Q2 and the promotion rule.** Frozen batches on four threads are better than the default trainer in: turn4; worse in: hu-turn; unresolved in: hu-river, river3-chip, flop6, final8, bubble4. The rule requires "better" in every game: it is **not met**. **The default trainer is unchanged.** Frozen-batch training stays an option (`batchDeals`, `actionStreams: "deal"`).
- No new training algorithm was promoted. An unresolved contrast is reported as unresolved and is not a result.

## 4. The six-player flop game (unresolved in 5.6)

### 4.1 Why 5.6 did not resolve it

From the 5.6 raw records (`flop6_diagnosis.py`, `flop6-diagnosis.json`). 5.6 trained 169,845 deals in 0.5 s against 86,052 for 5.5; the mean NashConv ratio was 0.70 and 40 of 60 seeds were lower, 20 higher.

| Game (5.6 against 5.5, 0.5 s, 60 pairs) | Ratio of means | Mean difference / its standard deviation | Seeds lower / higher | Pairs the 5.6 tests needed for 80% power at the measured effect (t interval / sign test) |
|---|---|---|---|---|
| hu-river | 0.70 | -0.85 | 50 / 10 | 23 / 33 |
| hu-turn | 0.74 | -1.90 | 58 / 2 | 5 / 14 |
| river3-chip | 0.71 | -0.94 | 48 / 12 | 19 / 42 |
| turn4 | 0.27 | -1.34 | 60 / 0 | 10 / 11 |
| flop6 | 0.70 | -0.36 | 40 / 20 | 125 / 143 |
| final8 | 0.26 | -0.64 | 60 / 0 | 41 / 11 |
| bubble4 | 0.35 | -0.62 | 60 / 0 | 43 / 11 |

- **Variance between seeds, relative to the effect.** On flop6 the mean improvement was 0.36 standard deviations of the paired difference; on the other six games it was 0.6 to 1.9. The NashConv of one flop6 training has a coefficient of variation of 0.62 at 0.5 s, and 64% of the variance of the paired differences sits in the six most extreme seeds.
- **Statistical power.** With that effect size the 5.6 tests (Bonferroni over 14) needed about 125 pairs (t interval) and 143 pairs (sign test) for 80% power; 60 were run. The unadjusted sign test had p = 0.013.
- **Training duration.** Both arms follow the same trajectory per seed (the trainer is identical per deal), so the paired difference compares two points of one noisy trajectory, about a factor two apart in deals. Mean NashConv fell by a factor 3.1 from 20,000 to 100,000 deals (about deals to the power -0.7), so a factor two in deals is an expected ratio of about 0.6, the same order as the trajectory's own fluctuations at that length.
- **Not the cause:** sampling inefficiency or information-set coverage specific to this game (its tree is small: all-in or fold, two hands a seat; every information set is visited within the first thousands of deals), and not training throughput (5.6 doubled it here as elsewhere).

### 4.2 New plan and result

Plan (written first): 160 paired seeds (3001 to 3160), arms `baseline55`, `default56`, `default57`, `batch57t4`, 0.5 and 2.0 s of training, family of 2 tests, the same two tests. Question: 5.6 measured a lower mean NashConv than 5.5 on flop6 after 0.5 s (ratio 0.70, 40 of 60 seeds lower) and its primary test did not resolve it. With 160 paired seeds and a second, four times longer budget: is the faster default trainer closer to equilibrium at equal time on flop6?

**0.5 s (the 5.6 budget).** Mean NashConv and sampled deals: `default56` 0.0752 (155,181 deals); `default57` 0.0729 (155,209 deals); `batch57t4` 0.0542 (344,081 deals); `baseline55` 0.1215 (77,339 deals).

| Contrast | Role | Ratio of means | Seeds lower / higher / equal | Sign test p (Bonferroni) | t interval (Bonferroni) | Pairs for 80% power at this effect | Verdict |
|---|---|---|---|---|---|---|---|
| default56 vs baseline55 | primary | 0.62 | 121 / 39 / 0 | 1.1e-10 | [-0.0602, -0.0325] | 27 | **better** |
| default57 vs baseline55 | primary | 0.60 | 125 / 35 / 0 | 9.1e-13 | [-0.0627, -0.0345] | 26 | **better** |
| default57 vs default56 | descriptive | 0.97 | 93 / 67 / 0 | 0.096 | [-0.0084, 0.0038] | 2146 | **unresolved** |
| batch57t4 vs default57 | descriptive | 0.74 | 103 / 57 / 0 | 0.00069 | [-0.0286, -0.0089] | 84 | **better** |

**2.0 s.** Mean NashConv and sampled deals: `default56` 0.0492 (643,086 deals); `default57` 0.0478 (644,073 deals); `batch57t4` 0.0406 (1,429,429 deals); `baseline55` 0.0637 (323,548 deals).

| Contrast | Role | Ratio of means | Seeds lower / higher / equal | Sign test p (Bonferroni) | t interval (Bonferroni) | Pairs for 80% power at this effect | Verdict |
|---|---|---|---|---|---|---|---|
| default56 vs baseline55 | primary | 0.77 | 96 / 64 / 0 | 0.028 | [-0.0256, -0.0035] | 175 | **better** |
| default57 vs baseline55 | primary | 0.75 | 101 / 59 / 0 | 0.0022 | [-0.0267, -0.0052] | 138 | **better** |
| default57 vs default56 | descriptive | 0.97 | 80 / 80 / 0 | 1 | [-0.0048, 0.0020] | 1750 | **unresolved** |
| batch57t4 vs default57 | descriptive | 0.85 | 99 / 61 / 0 | 0.0066 | [-0.0147, 0.0004] | 336 | **unresolved** |

**Conclusion for flop6.** At 0.5 s the faster default trainer against 5.5 is "better" (5.6 binary) and "better" (5.7 binary) with 160 pairs. The 5.6 statement "unresolved on flop6" is replaced: the faster trainer is closer to equilibrium at equal time on this game too. The cause of the earlier result was statistical power.

## 5. Measuring quality where exact NashConv is out of reach

Exact whole-game NashConv exists only for small games. Studies of the realistic fixtures report a **sampled response measure** (for each seat, one decision may deviate; the best action per hand is chosen on one sample stream and its gain measured on another), and the engine also has a **restricted best response** (the seat's decisions on the first street may deviate, later streets follow the trained strategy).

**Direction, and why.** Each measure is the gain of one fixed alternative strategy of one seat against the trained strategies of the others. A best response is the maximum over all alternatives, so for every seat: restricted gain ≤ best-response gain, and the expectation of the sampled gain ≤ best-response gain (the sampled figure is an unbiased estimate of the gain of the alternative it selected, because selection and measurement use independent samples). Summed over seats they are **lower bounds of NashConv**. Neither is an upper bound: a small value does not show that the strategy is close to equilibrium, only that this limited family of deviations found little.

**Check on 90 trained states of 9 games where the exact answer is known** (`restricted57.py`; default trainer, 5,000 and 50,000 deals, seeds 4001 to 4005):

- restricted gain above the exact gain (tolerance 1e-9): **0 of 400** seat values;
- sampled gain above the exact gain by more than four standard errors: **0 of 400** seat values.

How much of the exact NashConv each measure finds (sum over seats divided by exact NashConv; median and range over the seeds):

| Game | Deals | Exact NashConv (mean) | Restricted: median (min to max) | Sampled: median (min to max) |
|---|---|---|---|---|
| heads-up river | 5,000 | 0.5860 | 1.00 (1.00 to 1.00) | 0.50 (0.36 to 0.59) |
| heads-up river | 50,000 | 0.1661 | 1.00 (1.00 to 1.00) | 0.46 (0.42 to 0.57) |
| heads-up turn and river | 5,000 | 0.7462 | 0.31 (0.27 to 0.66) | 0.21 (0.20 to 0.50) |
| heads-up turn and river | 50,000 | 0.2154 | 0.35 (0.25 to 0.38) | 0.25 (0.10 to 0.29) |
| three-player river, side pots | 5,000 | 0.3228 | 1.00 (1.00 to 1.00) | 0.56 (0.47 to 0.66) |
| three-player river, side pots | 50,000 | 0.0759 | 1.00 (1.00 to 1.00) | 0.63 (0.48 to 0.68) |
| four-player turn and river | 5,000 | 2.1482 | 0.04 (0.02 to 0.05) | 0.05 (0.02 to 0.05) |
| four-player turn and river | 50,000 | 0.0101 | 0.57 (0.47 to 0.63) | 0.58 (0.48 to 0.64) |
| six-player flop, all-in or fold | 5,000 | 1.1950 | 1.00 (1.00 to 1.00) | 0.27 (0.09 to 0.42) |
| six-player flop, all-in or fold | 50,000 | 0.1506 | 1.00 (1.00 to 1.00) | 0.59 (0.29 to 0.72) |
| eight-handed ICM final table | 5,000 | 0.1035 | 1.00 (1.00 to 1.00) | 0.81 (0.43 to 0.92) |
| eight-handed ICM final table | 50,000 | 0.0005 | 1.00 (1.00 to 1.00) | 0.99 (0.77 to 1.00) |
| four-player ICM bubble | 5,000 | 0.0309 | 1.00 (1.00 to 1.00) | 0.58 (0.33 to 0.97) |
| four-player ICM bubble | 50,000 | 0.0003 | 1.00 (1.00 to 1.00) | 0.58 (0.33 to 0.98) |
| five-player flop | 5,000 | 0.8444 | 1.00 (1.00 to 1.00) | 0.32 (0.20 to 0.59) |
| five-player flop | 50,000 | 0.2238 | 1.00 (1.00 to 1.00) | 0.65 (0.14 to 0.85) |
| six-player flop, weighted ranges, two bet sizes | 5,000 | 2.1736 | 1.00 (1.00 to 1.00) | 0.28 (0.19 to 0.31) |
| six-player flop, weighted ranges, two bet sizes | 50,000 | 0.6087 | 1.00 (1.00 to 1.00) | 0.32 (0.19 to 0.45) |

**Reading.** The direction held in every case. The tightness did not: the sampled measure found between 5% and 99% of the exact NashConv (median of the per-game medians 53%), the restricted one between 4% and 100%. It depends on the game (in a push/fold game a seat has one decision, so a one-decision deviation is almost a full best response; in a game with several streets it is not) and on the length of training: from 5,000 to 50,000 deals the sampled share rose in 8 of 9 games and the restricted share ranged from 4% to 57% on the game where it moved most (four-player turn and river). **The share measured on small games cannot be carried over to the realistic fixtures**: there, the measure is a floor under an unknown NashConv.

### What would measure the large games

Not implemented in 5.7; listed in the order of what the evidence above suggests is worth doing:

1. **A deeper restricted response with a validated direction.** The restricted class can be widened street by street (first street, first two streets, …); each wider class is a larger lower bound, and on the small games the sequence can be checked against the exact value. The cost grows with the number of decision nodes of the seat; `maxNodes` already bounds it.
2. **Subgame decomposition.** Exact best responses inside sampled public subtrees (a fixed flop, or a fixed turn) with the trained strategy fixed above them are tractable for the three-player fixtures and give exact numbers for parts of the game; they bound nothing about the whole game unless the parts are weighted by reach and the trunk is included.
3. **Abstraction sensitivity.** Train the same spot with two bet-size sets and two hand groupings and compare the studied decision; a decision that changes with the abstraction is not established, whatever its in-abstraction quality. The study workflow already runs variants side by side; a report of the disagreement is the missing piece.
4. **An upper bound.** None is available cheaply for multiway games. Without one, no percentage of "GTO completeness" can be stated, and none is.
