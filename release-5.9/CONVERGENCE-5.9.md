# EightMax 5.9: convergence

Build `00600c81455ead44`, compared with the unchanged 5.8 binary (build `d4001e2c0cd77f41`,
`validation/5.8/linux-bin/mwcli`) where a comparison is made.

## 1. Summary

| Question | Answer | Section |
|---|---|---|
| Did 5.9 change a trainer? | **No.** 56 of 56 states byte-identical to the 5.8 binary at equal sampled deals. | 2 |
| Does 5.9 converge faster than 5.8 at equal deals? | **No - identically.** The states are the same bytes, so every NashConv is the same number. | 2 |
| At equal wall-clock time? | **No difference established.** Training time per deal is the same within the noise of the measurements. | 2, PERFORMANCE-5.9.md |
| Is one of the optional trainers better than the default? | **No.** Discounted CFR and regret matching+ are significantly worse (27 of 28 corrected comparisons); the terminal-baseline estimator is not distinguishable from the default and costs more time per deal. | 3 |
| Was an experimental algorithm promoted, or a new one added? | **No.** The default trainer is the 5.8 default trainer. No new estimator was implemented in 5.9. | 3, 5 |
| Did six-player flop convergence improve? | **No.** Unchanged training; on the fixture the trained responses certify a NashConv of at least 0.75 to 1.17 BB after 250,000 deals, for the default and for the baseline estimator alike. | 4 |
| What did improve? | The MEASUREMENT: lower bounds with a confidence statement, and a cheaper evaluation. An unchanged trainer with a better measurement is not a convergence improvement. | STATISTICAL-CHANGES-5.9.md |

Plans were written before measurement (`plan.json` in each folder of `validation/5.9/convergence/`), with fresh seeds
(5911 to 5933) that no earlier release used; raw rows are in `raw.jsonl.gz`; nothing was repeated or selected;
0 runs failed. Tool: `validation/5.9/convergence/convergence59.py`.

## 2. The default trainer of 5.9 is the default trainer of 5.8

`identity/`: seven reference games, budgets 20,000 and 100,000 sampled deals, seeds 5921 and 5922, one and three
threads; each state trained by the unchanged 5.8 program and by 5.9 and compared by SHA-256.

| Game | Identical states | Median training seconds 5.9 / 5.8 |
|---|---|---|
| heads-up river | 8 of 8 | 0.92 |
| heads-up turn | 8 of 8 | 0.94 |
| three-player river | 8 of 8 | 0.96 |
| four-player turn | 8 of 8 | 1.11 |
| six-player flop | 8 of 8 | 1.01 |
| eight-handed ICM final table | 8 of 8 | 1.02 |
| four-player ICM bubble | 8 of 8 | 1.04 |
| **all** | **56 of 56** | 1.01 |

Identical bytes mean identical regrets and average strategies: at equal sampled deals 5.9 has exactly the NashConv
5.8 has, on every game, without any statistics. (The time ratios were measured while other jobs ran on the same four
processors and scatter by about 10%; the alternating benchmark of PERFORMANCE-5.9.md, section 3, is the timing
evidence.) The same identity is asserted in the regression suite against golden states of the 5.5 and 5.7.1
binaries, and held in every training benchmark of this release.

**Equal wall-clock.** With identical states per deal, equal-time convergence differs only by deals per second, which
did not change (PERFORMANCE-5.9.md: ratios 0.97 to 1.03 on the study fixtures). No convergence difference between
5.8 and 5.9 exists to be reported at equal deals or at equal time.

## 3. Do the optional trainers converge faster? (a test that could have promoted one)

**Why this experiment.** The engine contains trainers that earlier releases added as experimental options and never
compared with the default under one prespecified rule on tournament games: the terminal-sibling control variate
("terminalBaseline": a variance-reduction estimator with the default's expected regret increments, an option
since an earlier release), discounted CFR weighting, and regret matching+. If one of them were clearly better it should become the
default; if not, the release should say so.

**Plan** (`options/plan.json`). Seven games small enough for EXACT NashConv - heads-up river, heads-up turn,
three-player river, four-player turn, six-player flop, eight-handed ICM final table, four-player ICM bubble; budgets
20,000 and 100,000 sampled deals; eight seeds (5911 to 5918), the same for every arm (paired); measure: exact
NashConv of the average strategy (`mwcli --gain`, method exact). Statistic: mean over seeds of
ln(NashConv candidate / NashConv default) with a paired Student-t interval. 7 x 2 x 3 = 42 intervals, Bonferroni:
each at level 0.05 / 42 (t critical 5.25 with 7 degrees of freedom). Verdicts: **better** (whole interval below 1),
**worse** (above 1), **unresolved**. **Promotion rule, fixed before measurement:** better on at least 4 of the 7 games
at 100,000 deals, worse on none at either budget, median time per deal within 10% of the default's.

**Result** (`options/summary.json`; 448 training runs, 0 failed). Ratio interval = candidate / default,
corrected for 42 comparisons:

| Game | Deals | Candidate | Median exact NashConv, default | candidate | Corrected interval of the ratio | Verdict | Candidate lower in seeds | Time per deal vs default |
|---|---|---|---|---|---|---|---|---|
| heads-up river | 20,000 | terminalBaseline | 0.274 | 0.271 | [0.457, 1.64] | **unresolved** | 6 of 8 | 1.35 |
| heads-up river | 20,000 | dcfr | 0.274 | 0.464 | [0.897, 2.58] | **unresolved** | 1 of 8 | 1.27 |
| heads-up river | 20,000 | plus | 0.274 | 0.695 | [1.3, 4] | **worse** | 0 of 8 | 1.34 |
| heads-up river | 100,000 | terminalBaseline | 0.138 | 0.116 | [0.486, 1.4] | **unresolved** | 7 of 8 | 1.29 |
| heads-up river | 100,000 | dcfr | 0.138 | 0.231 | [1.23, 2.4] | **worse** | 0 of 8 | 1.08 |
| heads-up river | 100,000 | plus | 0.138 | 0.368 | [1.93, 3.78] | **worse** | 0 of 8 | 1.16 |
| heads-up turn | 20,000 | terminalBaseline | 0.347 | 0.314 | [0.715, 1.22] | **unresolved** | 5 of 8 | 0.92 |
| heads-up turn | 20,000 | dcfr | 0.347 | 0.498 | [1.22, 1.7] | **worse** | 0 of 8 | 0.99 |
| heads-up turn | 20,000 | plus | 0.347 | 0.66 | [1.51, 2.39] | **worse** | 0 of 8 | 0.88 |
| heads-up turn | 100,000 | terminalBaseline | 0.171 | 0.148 | [0.653, 1.2] | **unresolved** | 7 of 8 | 1.03 |
| heads-up turn | 100,000 | dcfr | 0.171 | 0.245 | [1.09, 1.88] | **worse** | 0 of 8 | 1.12 |
| heads-up turn | 100,000 | plus | 0.171 | 0.35 | [1.64, 2.7] | **worse** | 0 of 8 | 0.90 |
| three-player river | 20,000 | terminalBaseline | 0.121 | 0.143 | [0.66, 1.67] | **unresolved** | 4 of 8 | 1.39 |
| three-player river | 20,000 | dcfr | 0.121 | 0.312 | [1.58, 3.48] | **worse** | 0 of 8 | 1.12 |
| three-player river | 20,000 | plus | 0.121 | 0.506 | [2.64, 5.7] | **worse** | 0 of 8 | 1.22 |
| three-player river | 100,000 | terminalBaseline | 0.0611 | 0.0552 | [0.629, 1.15] | **unresolved** | 7 of 8 | 1.34 |
| three-player river | 100,000 | dcfr | 0.0611 | 0.149 | [1.8, 3.17] | **worse** | 0 of 8 | 1.15 |
| three-player river | 100,000 | plus | 0.0611 | 0.244 | [2.9, 5.33] | **worse** | 0 of 8 | 1.27 |
| four-player turn | 20,000 | terminalBaseline | 0.0705 | 0.101 | [0.334, 5.37] | **unresolved** | 3 of 8 | 1.52 |
| four-player turn | 20,000 | dcfr | 0.0705 | 0.215 | [1.15, 7.3] | **worse** | 0 of 8 | 1.14 |
| four-player turn | 20,000 | plus | 0.0705 | 0.473 | [2.59, 15.7] | **worse** | 0 of 8 | 1.18 |
| four-player turn | 100,000 | terminalBaseline | 0.00221 | 0.0017 | [0.281, 3.6] | **unresolved** | 5 of 8 | 1.53 |
| four-player turn | 100,000 | dcfr | 0.00221 | 0.0756 | [20.6, 67.8] | **worse** | 0 of 8 | 1.09 |
| four-player turn | 100,000 | plus | 0.00221 | 0.17 | [47, 150] | **worse** | 0 of 8 | 1.06 |
| six-player flop | 20,000 | terminalBaseline | 0.217 | 0.264 | [0.617, 1.75] | **unresolved** | 3 of 8 | 1.86 |
| six-player flop | 20,000 | dcfr | 0.217 | 1.43 | [2.17, 14.1] | **worse** | 0 of 8 | 1.17 |
| six-player flop | 20,000 | plus | 0.217 | 2.48 | [3.6, 24.3] | **worse** | 0 of 8 | 1.17 |
| six-player flop | 100,000 | terminalBaseline | 0.0702 | 0.0506 | [0.28, 2.73] | **unresolved** | 5 of 8 | 2.08 |
| six-player flop | 100,000 | dcfr | 0.0702 | 0.583 | [2.89, 22.2] | **worse** | 0 of 8 | 1.22 |
| six-player flop | 100,000 | plus | 0.0702 | 1.14 | [5.21, 45.9] | **worse** | 0 of 8 | 1.36 |
| eight-handed ICM final table | 20,000 | terminalBaseline | 0.000141 | 5.9e-05 | [0.148, 3.15] | **unresolved** | 5 of 8 | 2.59 |
| eight-handed ICM final table | 20,000 | dcfr | 0.000141 | 0.0839 | [13.9, 61,018] | **worse** | 0 of 8 | 1.11 |
| eight-handed ICM final table | 20,000 | plus | 0.000141 | 0.261 | [46.8, 183,515] | **worse** | 0 of 8 | 1.08 |
| eight-handed ICM final table | 100,000 | terminalBaseline | 5.65e-06 | 2.36e-06 | [0.148, 3.15] | **unresolved** | 5 of 8 | 2.65 |
| eight-handed ICM final table | 100,000 | dcfr | 5.65e-06 | 0.0312 | [145, 543,625] | **worse** | 0 of 8 | 0.97 |
| eight-handed ICM final table | 100,000 | plus | 5.65e-06 | 0.102 | [464, 1,747,185] | **worse** | 0 of 8 | 1.06 |
| four-player ICM bubble | 20,000 | terminalBaseline | 7.7e-05 | 4.47e-05 | [0.108, 4.89] | **unresolved** | 5 of 8 | 1.46 |
| four-player ICM bubble | 20,000 | dcfr | 7.7e-05 | 0.133 | [408, 5,776] | **worse** | 0 of 8 | 1.03 |
| four-player ICM bubble | 20,000 | plus | 7.7e-05 | 0.294 | [932, 12,594] | **worse** | 0 of 8 | 1.03 |
| four-player ICM bubble | 100,000 | terminalBaseline | 3.08e-06 | 1.78e-06 | [0.108, 4.86] | **unresolved** | 5 of 8 | 1.45 |
| four-player ICM bubble | 100,000 | dcfr | 3.08e-06 | 0.0567 | [4,413, 61,307] | **worse** | 0 of 8 | 1.06 |
| four-player ICM bubble | 100,000 | plus | 3.08e-06 | 0.128 | [9,873, 140,822] | **worse** | 0 of 8 | 1.05 |

| Candidate | Better at 100,000 deals (of 7 games) | Worse (of 14 comparisons) | Unresolved | Median time per deal vs default | Promoted |
|---|---|---|---|---|---|
| terminalBaseline | 0 | 0 | 14 | 1.45 | **no** |
| dcfr | 0 | 13 | 1 | 1.12 | **no** |
| plus | 0 | 14 | 0 | 1.12 | **no** |

**Reading.**

* **Discounted CFR and regret matching+ are worse than the default with external sampling**, on every game, often by
  orders of magnitude on the push-or-fold ICM games (where the default reaches a NashConv of a few millionths of a
  payout unit and these stay at hundredths). Their discounts and resets are designed for full-width traversals; with
  sampled, importance-weighted increments they discard or clip information the linear average keeps. They remain
  available as options; nothing here recommends them.
* **The terminal-baseline estimator is not established as better.** Its point estimates are below the default's in
  10 of 14 comparisons (ratios 0.68 to 0.88 at 100,000 deals on six of seven games), and one unadjusted 95% interval
  (three-player river, 100,000 deals: 0.74 to 0.98) excludes 1; after the correction for 42 comparisons no interval
  does. With eight seeds the experiment could not have established an effect of this size (the corrected intervals
  span factors of 2 to 20). It also costs a median 45% more time per deal, so at equal wall-clock its apparent
  advantage of 10 to 30% in NashConv would be roughly cancelled. Verdict under the rule: **unresolved, not promoted**.
* What this does not show: that no better trainer exists, or that the baseline estimator is useless (a larger
  experiment aimed at it alone could resolve a 15% effect; whether that pays at +45% time is doubtful).

## 4. The six-player flop fixture (no exact NashConv exists)

`flop6/`: the shipped fixture `flop6-jack` (about 210,000 information sets after 250,000 deals), default against
terminalBaseline, three seeds; the trained-response measure with its 5.9 confidence statements (200,000 response
deals per seat, 409,600 evaluation deals, sampled opponent actions).

| Seed | Trainer | Information sets | Estimated sum of response gains (BB) | **NashConv >= (simultaneous, 95%)** | NashConv >= (pooled, 95%) | 5.8 normal sum (no guarantee) | Training s | Response analysis s |
|---|---|---|---|---|---|---|---|---|
| 5931 | default | 211,116 | 0.980 | **0.749** | 0.869 | 0.893 | 6.1 | 14.2 |
| 5931 | terminalBaseline | 209,933 | 1.307 | **1.028** | 1.170 | 1.196 | 9.4 | 15.4 |
| 5932 | default | 211,974 | 1.133 | **0.862** | 1.002 | 1.027 | 6.6 | 13.8 |
| 5932 | terminalBaseline | 210,367 | 1.138 | **0.886** | 1.016 | 1.041 | 8.9 | 15.8 |
| 5933 | default | 214,054 | 1.439 | **1.170** | 1.307 | 1.333 | 5.0 | 14.7 |
| 5933 | terminalBaseline | 208,639 | 1.265 | **1.001** | 1.138 | 1.162 | 9.8 | 14.5 |

Mean certified lower bound (simultaneous): default 0.927 BB, terminalBaseline 0.972 BB.

**Reading.** With 95% confidence each of these six strategies has a NashConv of at least 0.75 to 1.17 BB inside the
fixture's abstraction: after 250,000 deals a six-player flop strategy is measurably far from equilibrium, for either
trainer. The two trainers do not differ consistently (the default's bound is lower in two of three seeds). These are
LOWER bounds: a smaller one is consistent with a better strategy and does not establish it, so no verdict is drawn.
5.8 reported a sampled sum of about 7.1 BB after 50,000 deals on this fixture; the present numbers at 250,000 deals
are lower, as expected of more training, and say nothing about how fast the true NashConv falls.

## 5. Bottlenecks examined, and what was not done

| Item of the 5.9 brief | What was done |
|---|---|
| variance of sampled regret updates | compared the default with the one variance-reduction estimator the engine has (section 3). No new control variate was implemented. |
| information-set visitation, rare-action coverage | not changed. The evaluation side now protects its statements against rare actions (MATHEMATICAL-VALIDATION-5.9.md); the trainer's exploration (0.9 strategy + 0.1 uniform for opponents) is the 5.8 one. |
| average-strategy weighting, regret normalisation | linear (default), discounted and regret matching+ compared (section 3): the default is best of the three |
| batch size, training time per update | unchanged; throughput in PERFORMANCE-5.9.md |
| number of independent training seeds | eight per cell in section 3; the corrected intervals show that eight seeds resolve factors of 2, not 15% |
| single-street against multi-street | the seven games include both; no trainer's ranking depended on it |
| a new experimental estimator with its own identifier and checkpoint policy | **not implemented.** The time went to the statistical repair, the evaluation speed and the tests, in the order of priority the brief gave. |

## 6. What remains before stronger equilibrium claims

1. **An upper bound of NashConv for large games.** Everything measured in large games bounds NashConv from below.
2. **A trainer that provably or measurably converges faster in multiway multi-street games**, tested with enough
   seeds to resolve effects of 10 to 20% and with time per deal accounted for.
3. **More training than one engine state allows** (10,000,000 updates) with a generator whose period supports it.
4. **Physical runs on the target PC**, so that "equal wall-clock" means its 24 logical processors, not four.
