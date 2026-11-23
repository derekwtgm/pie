# Convergence — EightMax 5.5

Version 5.4 found no statistically supported improvement over its default trainer. Version 5.5 implemented and
evaluated **one** candidate, completed the ICM comparisons 5.4 left unfinished, and kept the default trainer unchanged.

## Summary

| Question | Answer |
|---|---|
| Is the 5.5 default trainer the 5.4 trainer? | Yes. At equal seeds and deals the 5.5 default produced the same exact NashConv as the unchanged 5.4 binary in all 12 equal-deal contrasts (all identical); state files are byte-identical. |
| Was a new algorithm implemented? | Yes, one: river opponent enumeration (`"opponentEnumeration":"river"`), opt-in and experimental. |
| Is it mathematically correct? | Its regret and average-strategy increments have the same expectation as the default's (frozen-table test below). |
| Does it converge better at equal sampled deals? | Yes, with statistical support: better in 11 of 12 equal-deal contrasts, unresolved in 1, worse in 0. |
| Does it converge better at equal time? | Not established: better in 1 of 8 equal-time contrasts, unresolved in 7, worse in 0. On the three-player river game most seeds were worse at equal time. |
| Was it promoted to the default? | **No.** The promotion rule written before measurement was not met. |
| Did anything else improve on the default? | No. The completed 5.4 family has 0 better, 12 worse and 12 unresolved ICM contrasts. |

No claim is made that EightMax is closer to equilibrium by default in 5.5 than in 5.4. With the opt-in candidate it
is closer per sampled deal on the tested river games, and not reliably closer per second.

## The candidate: river opponent enumeration

External-sampling MCCFR samples one action at every opponent decision and reweights it. On the final street
(river) the candidate instead traverses **every** opponent action and combines the child values with the opponent's
current strategy. This replaces a one-sample estimate of the sum over the opponent's river actions by the sum itself
(Rao–Blackwellisation). The sampling reach is unchanged at those nodes, so regret increments below action a are scaled
by the opponent's true probability of a, and average-strategy increments are scaled exactly as in the default.
Zero-probability actions are still traversed, because the average-strategy weight of the updating seat's information
sets must not depend on the opponent's strategy. Earlier streets, chance and the updating seat are sampled or
enumerated as before. Games without river betting are unaffected.

Code: `Walker::learn` and `Walker::learnVec` in `source/native/mw_es_impl.hpp`; option parsed in `mw.cpp`.

### Correctness: same expected increments

`source/tests/enum55.cpp` trains a table with the default estimator, freezes it, and traverses independent deals
with each estimator for every updating seat without merging anything. It compares the mean increment of every table
entry. (A first version of this test went through whole updates and showed a discrepancy; within one update the
second seat reads the first seat's freshly merged increments, so later seats legitimately differ at second order.
The test was rewritten to use a frozen table for every seat. Both versions are described in the source.)

| Game | Deals per estimator | Regret entries: largest abs(z), share above 1.96 | Average entries: largest abs(z), share above 1.96 | Regret-increment variance, candidate / default | Average-increment variance, candidate / default | State visits per deal, default / candidate |
|---|---|---|---|---|---|---|
| hu-river | 60,000,000 | 1.90, 0.0% | 3.04, 5.9% | 0.584 | 0.0694 | 15.1 / 42.0 |
| river3-chip | 20,000,000 | 2.27, 4.8% | 2.62, 6.1% | 0.538 | 0.0040 | 26.5 / 174.0 |

Control (default against default, different streams): hu-river at 60,000,000 deals: regret largest abs(z) 1.85, average largest abs(z) 3.43; river3-chip at 20,000,000 deals: regret largest abs(z) 2.12, average largest abs(z) 2.67.

The z statistics do not grow with the number of deals (a bias would grow with its square root), and the control
behaves the same way. The average-strategy increments of the default estimator are heavy-tailed, so its z statistics
are not exactly normal; the control row shows the size of that effect. This is a statistical check at the stated
resolution, not a proof.

### Fixed-plan comparison against 5.4

`source/tools/research55.py`, plan `main`. Written before measurement (`validation/5.5/convergence/main/plan.json`):

- games: hu-river, hu-turn, river3-chip, turn4 (exact all-seat best response is feasible in each);
- 20 paired training seeds (901–920); budgets 4000, 20000, 100000 sampled deals and 0.1, 0.5 seconds of training;
- arms: the unchanged 5.4 binary (baseline), the 5.5 default, the candidate; one training thread, 128 MiB;
- family: 40 contrasts; a verdict needs BOTH an exact sign test (distribution-free for the median paired difference) and a paired Student-t interval, each Bonferroni-adjusted over the family;
- promotion rule: The candidate may replace the default trainer only if, in EVERY game of this plan, it is "better" at the largest equal-TIME budget and at the largest equal-DEAL budget, and "worse" in no contrast. Otherwise the default is unchanged and the candidate stays an opt-in experimental setting.

1200 checkpoints were trained and evaluated. NashConv is exact inside each abstraction; with more than two
players it is not exploitability.

**Candidate against the 5.4 baseline**

| Game | Budget kind | Budget | 5.4 baseline NashConv | Candidate NashConv | Simultaneous t interval of the difference | Seeds lower / higher | Sign test p (Bonferroni) | Deals, baseline / candidate | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| hu-river | deals | 4000 | 0.850818 | 0.451942 | [-0.6979, -0.09987] | 20 / 0 | 7.6e-05 | 4000 / 4000 | **better** |
| hu-river | deals | 20000 | 0.326266 | 0.194885 | [-0.2282, -0.03452] | 20 / 0 | 7.6e-05 | 20000 / 20000 | **better** |
| hu-river | deals | 100000 | 0.132414 | 0.0848556 | [-0.0816, -0.01351] | 19 / 1 | 0.0016 | 100000 / 100000 | **better** |
| hu-river | time | 0.1 | 0.135081 | 0.1213 | [-0.06593, +0.03836] | 11 / 9 | 1 | 95483 / 44511 | **unresolved** |
| hu-river | time | 0.5 | 0.0519799 | 0.0521751 | [-0.01351, +0.0139] | 6 / 14 | 1 | 492955 / 239990 | **unresolved** |
| hu-turn | deals | 4000 | 0.852544 | 0.696626 | [-0.2356, -0.07623] | 20 / 0 | 7.6e-05 | 4000 / 4000 | **better** |
| hu-turn | deals | 20000 | 0.371473 | 0.284722 | [-0.1323, -0.04125] | 19 / 1 | 0.0016 | 20000 / 20000 | **better** |
| hu-turn | deals | 100000 | 0.163109 | 0.129157 | [-0.05065, -0.01725] | 20 / 0 | 7.6e-05 | 100000 / 100000 | **better** |
| hu-turn | time | 0.1 | 0.174637 | 0.150919 | [-0.04545, -0.001983] | 15 / 5 | 1 | 87782 / 71874 | **unresolved** |
| hu-turn | time | 0.5 | 0.0778056 | 0.0620495 | [-0.02505, -0.006466] | 19 / 1 | 0.0016 | 441948 / 375771 | **better** |
| river3-chip | deals | 4000 | 0.349552 | 0.199799 | [-0.2193, -0.0802] | 20 / 0 | 7.6e-05 | 4000 / 4000 | **better** |
| river3-chip | deals | 20000 | 0.147737 | 0.0808364 | [-0.1048, -0.029] | 20 / 0 | 7.6e-05 | 20000 / 20000 | **better** |
| river3-chip | deals | 100000 | 0.0589269 | 0.0385961 | [-0.03597, -0.004694] | 18 / 2 | 0.016 | 100000 / 100000 | **better** |
| river3-chip | time | 0.1 | 0.0785554 | 0.104469 | [+0.002866, +0.04896] | 4 / 16 | 0.47 | 61206 / 13793 | **unresolved** |
| river3-chip | time | 0.5 | 0.031041 | 0.0439604 | [+0.0005602, +0.02528] | 5 / 15 | 1 | 318977 / 74309 | **unresolved** |
| turn4 | deals | 4000 | 2.87731 | 0.271399 | [-2.967, -2.245] | 20 / 0 | 7.6e-05 | 4000 / 4000 | **better** |
| turn4 | deals | 20000 | 0.140474 | 0.00689872 | [-0.2331, -0.034] | 20 / 0 | 7.6e-05 | 20000 / 20000 | **better** |
| turn4 | deals | 100000 | 0.00369511 | 0.000332358 | [-0.009292, +0.002567] | 19 / 1 | 0.0016 | 100000 / 100000 | **unresolved** |
| turn4 | time | 0.1 | 0.0212115 | 0.00702384 | [-0.03228, +0.003902] | 18 / 2 | 0.016 | 40611 / 19193 | **unresolved** |
| turn4 | time | 0.5 | 0.000832089 | 0.000364447 | [-0.001913, +0.0009779] | 18 / 2 | 0.016 | 211258 / 100720 | **unresolved** |

**5.5 default against the 5.4 baseline** (equal deals: identical by construction and by measurement; equal time: timing noise only)

| Game | Budget kind | Budget | 5.4 baseline NashConv | 5.5 default NashConv | Simultaneous t interval of the difference | Seeds lower / higher | Sign test p (Bonferroni) | Deals, baseline / candidate | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| hu-river | deals | 4000 | 0.850818 | 0.850818 | [+0, +0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| hu-river | deals | 20000 | 0.326266 | 0.326266 | [+0, +0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| hu-river | deals | 100000 | 0.132414 | 0.132414 | [+0, +0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| hu-river | time | 0.1 | 0.135081 | 0.137216 | [-0.02082, +0.02509] | 11 / 9 | 1 | 95483 / 90754 | **unresolved** |
| hu-river | time | 0.5 | 0.0519799 | 0.0553953 | [-0.009666, +0.0165] | 8 / 12 | 1 | 492955 / 485408 | **unresolved** |
| hu-turn | deals | 4000 | 0.852544 | 0.852544 | [+0, +0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| hu-turn | deals | 20000 | 0.371473 | 0.371473 | [+0, +0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| hu-turn | deals | 100000 | 0.163109 | 0.163109 | [+0, +0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| hu-turn | time | 0.1 | 0.174637 | 0.175921 | [-0.01183, +0.0144] | 10 / 10 | 1 | 87782 / 86419 | **unresolved** |
| hu-turn | time | 0.5 | 0.0778056 | 0.0788127 | [-0.00601, +0.008025] | 9 / 11 | 1 | 441948 / 431958 | **unresolved** |
| river3-chip | deals | 4000 | 0.349552 | 0.349552 | [+0, +0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| river3-chip | deals | 20000 | 0.147737 | 0.147737 | [+0, +0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| river3-chip | deals | 100000 | 0.0589269 | 0.0589269 | [+0, +0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| river3-chip | time | 0.1 | 0.0785554 | 0.0808685 | [-0.02056, +0.02518] | 13 / 7 | 1 | 61206 / 62302 | **unresolved** |
| river3-chip | time | 0.5 | 0.031041 | 0.0328342 | [-0.002768, +0.006354] | 8 / 12 | 1 | 318977 / 316831 | **unresolved** |
| turn4 | deals | 4000 | 2.87731 | 2.87731 | [+0, +0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| turn4 | deals | 20000 | 0.140474 | 0.140474 | [+0, +0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| turn4 | deals | 100000 | 0.00369511 | 0.00369511 | [+0, +0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| turn4 | time | 0.1 | 0.0212115 | 0.0205153 | [-0.007031, +0.005639] | 8 / 12 | 1 | 40611 / 41145 | **unresolved** |
| turn4 | time | 0.5 | 0.000832089 | 0.000815084 | [-7.316e-05, +3.915e-05] | 9 / 11 | 1 | 211258 / 214217 | **unresolved** |

Reading:

- At equal deals the candidate's NashConv was lower in every game and budget, with both tests agreeing in 11 of 12 contrasts.
- At equal time the candidate processes roughly half to a quarter as many deals. It was better on the heads-up turn-and-river game at 0.5 s, unresolved elsewhere, and on the three-player river game its mean NashConv was higher at both time budgets (not significant after adjustment).
- Decision: **default unchanged; candidate remains opt-in experimental**.
- Equal-time budgets are wall-clock on a shared four-core container; timing noise enters those contrasts.

An earlier attempt of this run stopped after three rows because the runner asked for more updates than `mwcli`
accepts in timed runs. It is kept in `validation/5.5/convergence/main-attempt1-harness-error/`.

## The ICM comparisons 5.4 could not finish

5.4 declared 72 contrasts and completed 48; the 24 four-player ICM (bubble) contrasts were abandoned because each exact
evaluation took 64–71 s. The cause is now known: the evaluation request used a 128 MiB evaluator cache, too small for
that game's showdown tables, which were rebuilt repeatedly. With 1,024 MiB the same evaluation takes about 1.2 s and
returns the identical value (`PERFORMANCE-5.5.md`).

`research55.py --plan icm` completed the family exactly as declared: same game, seeds 901–910, the six candidate arms,
the 5.3 binary as baseline, the 5.4 binary for candidates and evaluation, training memory 128 MiB, and the **original
72-contrast** Bonferroni penalty with the paired Student-t rule 5.4 declared. Only the evaluator cache changed.
280 checkpoints. The first attempt (128 MiB cache, stopped after 20 checkpoints) is kept in
`validation/5.5/convergence/icm-completion-attempt1-slow/`.

| Arm | Budget kind | Budget | 5.3 baseline NashConv | Candidate NashConv | Simultaneous t interval (family 72) | Seeds lower / higher | Verdict (5.4 rule) |
|---|---|---|---|---|---|---|---|
| default54 | deals | 4000 | 0.0877473 | 0.0877473 | [+0, +0] | 0 / 0 | **unresolved** |
| default54 | deals | 20000 | 0.00644124 | 0.00644124 | [+0, +0] | 0 / 0 | **unresolved** |
| default54 | deals | 100000 | 0.000265691 | 0.000265691 | [+0, +0] | 0 / 0 | **unresolved** |
| default54 | time | 0.1 | 0.000818845 | 0.000784702 | [-0.0004185, +0.0003502] | 6 / 4 | **unresolved** |
| terminal-baseline | deals | 4000 | 0.0877473 | 0.0476372 | [-0.1477, +0.06751] | 6 / 4 | **unresolved** |
| terminal-baseline | deals | 20000 | 0.00644124 | 0.00202358 | [-0.0218, +0.01296] | 6 / 4 | **unresolved** |
| terminal-baseline | deals | 100000 | 0.000265691 | 8.17072e-05 | [-0.0009149, +0.0005469] | 6 / 4 | **unresolved** |
| terminal-baseline | time | 0.1 | 0.000818845 | 0.000356154 | [-0.002189, +0.001264] | 5 / 5 | **unresolved** |
| dcfr | deals | 4000 | 0.0877473 | 0.77995 | [+0.4484, +0.936] | 0 / 10 | **worse** |
| dcfr | deals | 20000 | 0.00644124 | 0.316603 | [+0.29, +0.3304] | 0 / 10 | **worse** |
| dcfr | deals | 100000 | 0.000265691 | 0.141183 | [+0.1355, +0.1463] | 0 / 10 | **worse** |
| dcfr | time | 0.1 | 0.000818845 | 0.186886 | [+0.1799, +0.1922] | 0 / 10 | **worse** |
| dcfr-average3 | deals | 4000 | 0.0877473 | 0.753741 | [+0.4135, +0.9185] | 0 / 10 | **worse** |
| dcfr-average3 | deals | 20000 | 0.00644124 | 0.300608 | [+0.2688, +0.3195] | 0 / 10 | **worse** |
| dcfr-average3 | deals | 100000 | 0.000265691 | 0.135218 | [+0.1291, +0.1408] | 0 / 10 | **worse** |
| dcfr-average3 | time | 0.1 | 0.000818845 | 0.191838 | [+0.1513, +0.2308] | 0 / 10 | **worse** |
| cfr-plus | deals | 4000 | 0.0877473 | 1.2531 | [+0.8438, +1.487] | 0 / 10 | **worse** |
| cfr-plus | deals | 20000 | 0.00644124 | 0.604084 | [+0.5678, +0.6275] | 0 / 10 | **worse** |
| cfr-plus | deals | 100000 | 0.000265691 | 0.280387 | [+0.2737, +0.2865] | 0 / 10 | **worse** |
| cfr-plus | time | 0.1 | 0.000818845 | 0.367467 | [+0.3353, +0.3979] | 0 / 10 | **worse** |
| uniform | deals | 4000 | 0.0877473 | 0.149855 | [-0.03935, +0.1636] | 1 / 9 | **unresolved** |
| uniform | deals | 20000 | 0.00644124 | 0.0334422 | [-0.00774, +0.06174] | 0 / 10 | **unresolved** |
| uniform | deals | 100000 | 0.000265691 | 0.00739932 | [-0.006723, +0.02099] | 0 / 10 | **unresolved** |
| uniform | time | 0.1 | 0.000818845 | 0.0124054 | [-0.00942, +0.03259] | 0 / 10 | **unresolved** |

With the 48 contrasts of 5.4 (20 worse, 28 unresolved) the completed family is: 0 better, 32 worse,
40 unresolved of 72. DCFR, DCFR with cubic averaging and CFR+ were worse on ICM at every budget.
The terminal baseline had lower mean NashConv at every budget but the difference is unresolved. Uniform weighting was
higher in nearly every seed, also unresolved under the declared interval. No default change is supported.

The sign-test columns are reported for information; they decide nothing in this family.

## Larger tournament situations (restricted metrics)

Exact whole-game evaluation is not feasible for these configurations. `source/tools/tournament55.py` ran the shipped
study fixtures through the study runner with the default trainer and with the candidate, on the same seeds, and
recorded what each fixture can measure. **These are restricted measurements**: a sampled one-decision deviation gain
is a lower bound on what a seat could gain, it is not exploitability, and its uncertainty is not calibrated. They
describe one decision each, not the whole game.

Plan: `validation/5.5/convergence/tournament/plan.json` (written before measurement). 5 seeds,
budgets 20000, 100000 deals, one variant per fixture.

| Fixture | Situation | River betting in the tree | Quality metric | Budget | Default: quality mean | Candidate: quality mean | Paired difference, seeds lower / higher | Default / candidate training s per seed | Leading action by EV, default / candidate |
|---|---|---|---|---|---|---|---|---|---|
| btn25-open | eight-handed MTT, button open folded to, linked preflop to river, weighted ranges | yes | sampled one-decision gain (restricted) | 20000 | not evaluated | not evaluated | not evaluated at this budget, 0 / 0 | 0.18 / 0.25 | Fold / Fold |
| btn25-open | eight-handed MTT, button open folded to, linked preflop to river, weighted ranges | yes | sampled one-decision gain (restricted) | 100000 | 0.15857 | 0.095266 | -0.0633, 3 / 2 | 1.08 / 1.26 | Fold / Fold |
| flop3-kings | three-player postflop, two flop bet sizes, linked flop to river | yes | sampled one-decision gain (restricted) | 20000 | not evaluated | not evaluated | not evaluated at this budget, 0 / 0 | 0.24 / 0.35 | Check / Bet to 2.442 |
| flop3-kings | three-player postflop, two flop bet sizes, linked flop to river | yes | sampled one-decision gain (restricted) | 100000 | 0.20626 | 0.21182 | +0.005563, 3 / 2 | 1.04 / 1.58 | Bet to 2.442 / Bet to 2.442 |
| flop6-jack | six-player postflop, side pots possible, flop and turn betting | no | sampled one-decision gain (restricted) | 20000 | not evaluated | not evaluated | not evaluated at this budget, 0 / 0 | 0.62 / 0.55 | Check / Check |
| flop6-jack | six-player postflop, side pots possible, flop and turn betting | no | sampled one-decision gain (restricted) | 100000 | 0.31289 | 0.31289 | +0, 0 / 0 | 2.55 / 2.39 | Check / Check |
| icm8-bb-call | eight-handed final table, ICM, big blind facing an all-in, preflop and flop | no | sampled one-decision gain (restricted) | 20000 | 0.12684 | 0.12684 | +0, 0 / 0 | 0.09 / 0.08 | Call 17.9 / Call 17.9 |
| icm8-bb-call | eight-handed final table, ICM, big blind facing an all-in, preflop and flop | no | sampled one-decision gain (restricted) | 100000 | 0.035928 | 0.035928 | +0, 0 / 0 | 0.32 / 0.34 | Fold / Fold |

Fixtures without river betting: the candidate produced identical measurements to the default in every row, as expected (it only acts on river decisions). Fixtures with river betting: btn25-open at 100,000 deals: restricted quality 0.1586 (default) vs 0.09527 (candidate), lower in 3 of 5 seeds, training 1.2x the time; flop3-kings at 100,000 deals: restricted quality 0.2063 (default) vs 0.2118 (candidate), lower in 3 of 5 seeds, training 1.5x the time. Five seeds and a restricted, uncalibrated metric support no conclusion about equilibrium quality in these games; the rows show cost and direction only. Verdicts of the action ranking: unresolved.

## What would establish stronger GTO accuracy

- A candidate that wins at equal time as well as equal deals across games, including ICM and linked streets.
- Exact or tightly bounded whole-game evaluation for the large tournament fixtures; today only one-decision
  restricted responses are available there.
- More training replications than 10–20 for the model-based comparisons, or exact evaluation with enough
  replications for distribution-free tests throughout.
- Evaluation of abstraction error (bet sizes, ranges, hand grouping), which none of these measurements address.
