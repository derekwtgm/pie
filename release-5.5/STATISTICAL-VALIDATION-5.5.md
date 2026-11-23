# Statistical validation — EightMax 5.5

Calculation identifier: `study-5.5-bounded-eb-v1` (calibrated conditional intervals, `source/native/study_stats55.hpp`).
The 5.3/5.4 calculation `study-5.3-tfloor-bonferroni-v1` (`study_stats53.hpp`, unchanged) is retained as the model-based
interval across trainings.

## 1. What was wrong in 5.4

5.4 measured 86.57% simultaneous coverage (2,597/3,000) for a nominal 95% conditional interval in its rare-tail
scenario. The interval was `mean ± t(df, 0.05/M) × SE`.

Diagnosis, by the ten points of the brief:

1. **Between-seed variability** is not involved in the conditional interval; the failure appears with zero training
   variation (scenario `identical_strategies_independent` behaves the same way with rare tails).
2. **Within-evaluation sampling variability** is the cause. A Student-t or normal quantile is a statement about the
   shape of the sampling distribution of the evaluation mean, not only its spread.
3. **Heavy tails / 4. skew / 5. rare high-value outcomes.** In the rare-tail generator each evaluation error is a
   standardized Bernoulli(0.01) draw: −0.1 SE with probability 0.99 and +9.95 SE with probability 0.01. The mean of five
   such errors exceeds the 5.4 half-width (about 1.27 SE of one evaluation) whenever any of the draws is the rare one.
   With four correlated actions that happens in roughly one trial in six to seven. The known SE was correct; the
   quantile was not. In the application it is worse: the SE is *estimated*, and an evaluation that did not draw the
   rare event reports an SE that is too small (zero if all samples agree). Part B below reproduces this with raw
   samples: 57.0% coverage at N·p = 0.4.
6. **Correlated action values** and 7. **shared streams** are handled correctly by the paired standard errors and the
   Cauchy–Schwarz bound; they are not the cause (correlated Gaussian scenarios cover).
8. **Small numbers of replications**: 2–10 trainings cannot rescue a wrong quantile, and for the across-training
   interval they cannot support any distribution-free statement (section 5).
9. **Multiplicity**: Bonferroni is valid whatever the dependence, but only if each component interval is valid at its
   own level. Bonferroni pushes each interval far into the tail (alpha/M with M = 11 here), exactly where a normal
   approximation of a skewed mean is worst.
10. **Conditional vs population**: the failure is in the conditional interval. The population interval in the same
    scenario covered 100% because the evaluation-SE floor makes it much wider.

No interval that sees only a mean and a standard error can be valid for every distribution (Bahadur and Savage, 1956).
Widening by a factor would repair one scenario and fail the next; it was not done.

## 2. The 5.5 procedure

Poker utilities are bounded. For n i.i.d. samples in an interval of width R with unbiased sample variance V, Maurer and
Pontil (2009, Theorem 4) prove, for every delta, with probability at least 1 − delta:

    mean − E <= sqrt(2 V ln(2/delta) / n) + 7 R ln(2/delta) / (3 (n − 1))

Applied to both tails this gives the two-sided half-width at level delta
`h = sqrt(2 V ln(4/delta)/n) + 7 R ln(4/delta)/(3(n−1))`, capped at R.

- **One trained strategy, one action or pair:** that half-width, with R from the betting rules and 2R for a difference
  of two actions evaluated on the same sample.
- **m trained strategies:** each gets delta/m. By the union bound all m intervals hold together with probability at
  least 1 − delta, so `mean ± sum(h_r)/m` covers the mean of the true values of the measured strategies. No
  independence between the strategies' evaluation streams is needed, so shared streams are covered.
- **Multiplicity:** delta = 0.05 / M, M fixed before measurement (every action EV, every pair, quality and sensitivity
  contrasts, every budget and variant), as in 5.3.
- **Exact evaluation:** zero sampling error. Exactness is declared by the evaluator and never inferred from SE = 0.

### Assumptions (all must hold for the calibrated claim)

| Assumption | How it is established |
|---|---|
| Samples are independent and identically distributed | The action evaluator draws each sample world independently from the exact posterior by rejection, in fixed 256-sample blocks with derived streams (`action_stats.hpp` header). Pseudorandom streams are not a mathematical proof of independence. |
| Equal weights | Every completed sample has weight 1. |
| Sample count fixed in advance | The study requests a fixed count; an evaluation that stops early is an error, not a shorter interval. The runner never stops on observed values. |
| Every sample lies in a known range | `utilityBounds` in `action_ev.hpp`: chips — a seat loses at most its stack and ante, and wins at most the starting pot plus, from each other seat, the smaller of the two stacks when all seats enter with equal earlier wagers (otherwise that seat's whole stack); ICM — between the smallest (or zero) and largest payout. Every sample is compared with the bound; a violation withdraws the interval (`payoffBoundViolated`). |

It is **not** described as distribution-free without qualification: it is free of distributional shape assumptions
*given* the four conditions above.

### What is refused

| Situation | Result |
|---|---|
| Evaluation without a payoff bound or sample count (documents from 5.2–5.4, synthetic inputs with SE only) | `conditionalEvaluationCi95: null`, verdict `uncalibrated`, tolerance not met. The old interval remains as `normalApproxConditionalCi95`. |
| Sampled quality (a conditional gain times an estimated reach probability, after a data-dependent selection) | `qualityCalibrated: false`; a declared quality tolerance cannot be met with sampled quality. Use exact quality. |
| Interval across independent trainings | Published as `ci95` with `ci95Basis: model-based`; never sufficient for a ranking. |
| A sample outside the declared bound | Interval withdrawn. |

### Verdicts

`ranked`, `nearTie` and `smallEdge` now require the calibrated conditional interval **and** the model-based interval
to agree. The calibrated part of the claim concerns the *measured strategies*. `confidence.verdictFromModelBasedIntervalsAlone`
records what the 5.4 rule would have said.

## 3. Protocol

`source/tools/statistical_validation55.py` writes `validation/5.5/statistics/protocol.json` (scenarios, seeds, trial
counts, pass rules) before measuring. All data and true values come from NumPy/SciPy; the shipped C++ aggregation is
driven through `source/tests/study53_probe.cpp`. Results: `validation/5.5/statistics/coverage.json` and `coverage.log`.

Run 1 is retained in `validation/5.5/statistics/run1-reproduction-scoring/`. It passed every coverage, false-ranking,
refusal and formula rule, but failed the reproduction rule because the harness scored single-action intervals as well
as pairs while 5.4 scored pairs only. The harness now reports both; the statistics code, scenarios, seeds and trial
counts were not changed. Run 2 is the result of record: **all pass rules met**.

Formula checks: 21 Student-t quantiles against SciPy and 400 empirical-Bernstein half-widths against an independent
formula, 0 failures. The Maurer–Pontil inequality itself was checked by exact binomial enumeration on 105 Bernoulli
cases (n 16–4,000, p 0.0002–0.9, delta 0.05–0.0005): 0 violations; the largest exact failure probability was
0.029 × delta.

## 4. Results

Intervals in brackets are Wilson 95% intervals for the empirical rate.

### Part A — the 13 scenarios of 5.4, reproduced (3,000 trials, same generator and seed)

The 5.4 formula's pairwise conditional coverage, population coverage, ranked and false-ranking counts equal
`validation/5.4/statistics/coverage.json` exactly in all 13 scenarios. The rare-tail figure reproduces at 2,597/3,000.
The stricter measure (every action interval as well) is lower still.

| Scenario | 5.4 formula, pairs only (as 5.4 scored) | 5.4 formula, actions and pairs | Model-based population coverage | 5.4-rule ranked / false | 5.5 interval published | 5.5 verdicts |
|---|---|---|---|---|---|---|
| independent_null | 97.63% (2929/3000) [97.03, 98.12] | 97.20% (2916/3000) [96.55, 97.73] | 100.00% (3000/3000) [99.87, 100.00] | 0 / 0 | 0/3000 | uncalibrated 3000 |
| identical_strategies_independent | 97.10% (2913/3000) [96.44, 97.64] | 96.40% (2892/3000) [95.67, 97.01] | 100.00% (3000/3000) [99.87, 100.00] | 0 / 0 | 0/3000 | uncalibrated 3000 |
| shared_identical | 97.43% (2923/3000) [96.80, 97.94] | 96.57% (2897/3000) [95.85, 97.16] | n/a | 0 / 0 | 0/3000 | uncertaintyUnavailable 3000 |
| shared_with_training_variation | 97.50% (2925/3000) [96.88, 98.00] | 96.27% (2888/3000) [95.53, 96.89] | n/a | 0 / 0 | 0/3000 | uncertaintyUnavailable 3000 |
| correlated_actions_null | 98.07% (2942/3000) [97.51, 98.50] | 97.20% (2916/3000) [96.55, 97.73] | 99.83% (2995/3000) [99.61, 99.93] | 0 / 0 | 0/3000 | uncalibrated 3000 |
| negative_correlated_actions | 98.40% (2952/3000) [97.89, 98.79] | 97.67% (2930/3000) [97.06, 98.15] | 100.00% (3000/3000) [99.87, 100.00] | 0 / 0 | 0/3000 | uncalibrated 3000 |
| positive_gap | 98.27% (2948/3000) [97.73, 98.68] | 97.23% (2917/3000) [96.58, 97.76] | 98.93% (2968/3000) [98.50, 99.24] | 3000 / 0 | 0/3000 | uncalibrated 3000 |
| exact_evaluation | 100.00% (3000/3000) [99.87, 100.00] | 100.00% (3000/3000) [99.87, 100.00] | 97.57% (2927/3000) [96.95, 98.06] | 0 / 0 | 3000/3000 | unresolved 2999, smallEdge 1 |
| two_replications | 98.13% (2944/3000) [97.58, 98.56] | 96.20% (2886/3000) [95.45, 96.83] | 100.00% (3000/3000) [99.87, 100.00] | 0 / 0 | 0/3000 | uncalibrated 3000 |
| one_replication | 98.23% (2947/3000) [97.70, 98.65] | 96.70% (2901/3000) [96.00, 97.28] | n/a | 0 / 0 | 0/3000 | singleSeed 3000 |
| heavy_t3 | 95.70% (2871/3000) [94.91, 96.37] | 94.30% (2829/3000) [93.41, 95.07] | 100.00% (3000/3000) [99.87, 100.00] | 0 / 0 | 0/3000 | uncalibrated 3000 |
| skew_lognormal | 94.90% (2847/3000) [94.05, 95.63] | 92.87% (2786/3000) [91.89, 93.73] | 99.93% (2998/3000) [99.76, 99.98] | 0 / 0 | 0/3000 | uncalibrated 3000 |
| rare_tail_mixture | 86.57% (2597/3000) [85.30, 87.74] | 81.97% (2459/3000) [80.55, 83.30] | 100.00% (3000/3000) [99.87, 100.00] | 0 / 0 | 0/3000 | uncalibrated 3000 |

These inputs carry a standard error but no payoff bound, so 5.5 publishes no conditional interval and no ranking for
the sampled scenarios (0/3,000 everywhere; `positive_gap`, which the 5.4 rule ranked 3,000 times, is now `uncalibrated`).
This is the refusal branch of the acceptance requirement, not a coverage claim.

### Part B — raw bounded samples with estimated standard errors (4,000 trials each)

| Scenario | n x N | 5.5 simultaneous conditional coverage | 5.4 formula on the same data | 5.5 ranked / false | near tie / false | small edge / false | Leading-pair half-width 5.5 vs 5.4 | us per aggregate |
|---|---|---|---|---|---|---|---|---|
| uniform_bounded | 5 x 2000 | 100.00% (4000/4000) [99.90, 100.00] | 96.33% (3853/4000) [95.70, 96.87] | 0 / 0 | 1748 / 0 | 0 / 0 | 0.0383 vs 0.0058 | 390 |
| rare_jackpot_Np1 | 5 x 1000 | 100.00% (4000/4000) [99.90, 100.00] | 86.52% (3461/4000) [85.43, 87.55] | 0 / 0 | 4000 / 0 | 0 / 0 | 0.0454 vs 0.0020 | 361 |
| rare_jackpot_Np0.4 | 5 x 2000 | 100.00% (4000/4000) [99.90, 100.00] | 57.00% (2280/4000) [55.46, 58.53] | 0 / 0 | 4000 / 0 | 0 / 0 | 0.0214 vs 0.0007 | 321 |
| rare_discordant_pair | 5 x 2000 | 100.00% (4000/4000) [99.90, 100.00] | 96.35% (3854/4000) [95.72, 96.89] | 0 / 0 | 4000 / 0 | 0 / 0 | 0.0185 vs 0.0000 | 255 |
| rare_tail_mixture_raw | 5 x 1000 | 100.00% (4000/4000) [99.90, 100.00] | 95.78% (3831/4000) [95.11, 96.36] | 0 / 0 | 0 / 0 | 0 / 0 | 0.0581 vs 0.0059 | 379 |
| skew_beta | 10 x 1000 | 100.00% (4000/4000) [99.90, 100.00] | 96.25% (3850/4000) [95.62, 96.80] | 0 / 0 | 0 / 0 | 0 / 0 | 0.0576 vs 0.0032 | 491 |
| heavy_power | 5 x 1000 | 100.00% (4000/4000) [99.90, 100.00] | 96.08% (3843/4000) [95.43, 96.63] | 0 / 0 | 0 / 0 | 0 / 0 | 0.0831 vs 0.0136 | 382 |
| heavy_t3_clipped | 5 x 1000 | 100.00% (4000/4000) [99.90, 100.00] | 97.12% (3885/4000) [96.56, 97.60] | 0 / 0 | 0 / 0 | 0 / 0 | 0.0537 vs 0.0045 | 378 |
| correlated_actions_crn | 5 x 2000 | 100.00% (4000/4000) [99.90, 100.00] | 96.95% (3878/4000) [96.37, 97.44] | 0 / 0 | 3336 / 0 | 0 / 0 | 0.0254 vs 0.0018 | 397 |
| nonidentical_replications | 5 x 500-4000 | 100.00% (4000/4000) [99.90, 100.00] | 96.73% (3869/4000) [96.13, 97.23] | 0 / 0 | 1783 / 0 | 0 / 0 | 0.0492 vs 0.0065 | 387 |
| shared_stream | 5 x 1000 | 100.00% (4000/4000) [99.90, 100.00] | 56.53% (2261/4000) [54.98, 58.05] | 0 / 0 | 0 / 0 | 0 / 0 | 0.0489 vs 0.0067 | 333 |
| small_count_64 | 5 x 64 | 100.00% (4000/4000) [99.90, 100.00] | 84.80% (3392/4000) [83.65, 85.88] | 0 / 0 | 0 / 0 | 0 / 0 | 0.6959 vs 0.0268 | 358 |
| one_replication | 1 x 2000 | 100.00% (4000/4000) [99.90, 100.00] | 64.95% (2598/4000) [63.46, 66.41] | 0 / 0 | 0 / 0 | 0 / 0 | 0.0187 vs 0.0030 | 190 |
| two_replications | 2 x 2000 | 100.00% (4000/4000) [99.90, 100.00] | 96.67% (3867/4000) [96.07, 97.19] | 0 / 0 | 0 / 0 | 0 / 0 | 0.0258 vs 0.0048 | 268 |
| positive_gap_power | 5 x 20000 | 100.00% (4000/4000) [99.90, 100.00] | 96.95% (3878/4000) [96.37, 97.44] | 4000 / 0 | 0 / 0 | 0 / 0 | 0.0144 vs 0.0039 | 393 |
| positive_gap_small | 5 x 20000 | 100.00% (4000/4000) [99.90, 100.00] | 98.88% (3955/4000) [98.50, 99.16] | 4000 / 0 | 0 / 0 | 0 / 0 | 0.0098 vs 0.0024 | 373 |
| gap_at_margin | 5 x 20000 | 100.00% (4000/4000) [99.90, 100.00] | 98.40% (3936/4000) [97.96, 98.74] | 0 / 0 | 0 / 0 | 4000 / 0 | 0.0080 vs 0.0019 | 281 |
| wide_range_small_spread | 5 x 20000 | 100.00% (4000/4000) [99.90, 100.00] | 96.78% (3871/4000) [96.18, 97.28] | 0 / 0 | 0 / 0 | 0 / 0 | 0.1184 vs 0.0063 | 385 |
| exact_evaluation | 5 x 0 | 100.00% (4000/4000) [99.90, 100.00] | 100.00% (4000/4000) [99.90, 100.00] | 0 / 0 | 0 / 0 | 1 / 0 | 0.0000 vs 0.0000 | 318 |
| understated_bound | 5 x 1000 | 100.00% (2684/2684) [99.86, 100.00] | 0.00% (0/4000) [0.00, 0.10] | 0 / 0 | 2684 / 0 | 0 / 0 | 0.0196 vs 0.0000 | 288 |

- 5.5 coverage was 100% in every scenario where an interval was published. That is expected: the bound is conservative.
  It is evidence that the implementation matches the theorem, not the source of the guarantee.
- The 5.4 formula on the same data fell to 86.5% (N·p = 1), 57.0% (N·p = 0.4), 56.5% (shared stream), 84.8% (64
  samples) and 65.0% (one replication).
- No false ranking, false near tie or false small edge occurred in any scenario.
- **Power:** a true gap of 0.25 R and of 0.08 R (margin 0.05) was ranked in 4,000/4,000 trials at 5 × 20,000 samples.
  A gap exactly at the margin was never ranked and was reported as a small edge.
- **Width:** the calibrated interval is 4 to 30 times wider than the normal approximation. With a declared range of 50
  and a sample spread near 1 (`wide_range_small_spread`) the half-width was 0.118 against 0.006. This is the price of
  the guarantee and the main practical cost of the change: more evaluation samples are needed to resolve small gaps.
- **Cost:** 0.2–0.5 ms per aggregate including process I/O; negligible.
- **`understated_bound`** (deliberately wrong input, excluded from the pass rule): the per-sample check withdrew
  calibration in 1316/4,000 trials. In the others no sample exceeded the false bound, so the error was undetectable.
  The check is a guard, not a substitute for a correct bound.

### Part C — exact evaluation, non-Gaussian training variation (4,000 trials each)

| Training-effect distribution | n | Model-based population coverage | Ranked | False vs population truth | False vs conditional truth |
|---|---|---|---|---|---|
| gaussian_training | 5 | 97.30% (3892/4000) [96.75, 97.76] | 0 | 0 | 0 |
| t3_training | 5 | 98.35% (3934/4000) [97.91, 98.70] | 0 | 0 | 0 |
| lognormal_training | 10 | 99.48% (3979/4000) [99.20, 99.66] | 0 | 0 | 0 |
| rare_training_event_p0.05 | 5 | 100.00% (4000/4000) [99.90, 100.00] | 0 | 0 | 0 |
| rare_training_event_n10 | 10 | 100.00% (4000/4000) [99.90, 100.00] | 0 | 0 | 0 |
| bimodal_training | 5 | 99.20% (3968/4000) [98.87, 99.43] | 0 | 0 | 0 |
| rare_training_failure_action0 | 5 | 22.62% (905/4000) [21.36, 23.95] | 0 | 0 | 0 |
| rare_training_reversal | 5 | 21.00% (840/4000) [19.77, 22.29] | 3151 | 3151 | 0 |

The model-based interval is adequate for Gaussian, t(3), lognormal and bimodal training effects, and fails badly when a
training run occasionally lands on a very different strategy (21–23% coverage). In `rare_training_reversal`, 79% of
studies issue a `ranked` verdict that is **true for the measured strategies and false for the population of
trainings**. Five to ten replications cannot detect a 5% training failure rate by any method. This is why the
across-training interval is labelled model-based and why the calibrated claim is restricted to the measured strategies.

### Part E — the real evaluator against the exact evaluator

`source/tools/poker_calibration55.py` trains each reference game, computes exact action EVs, and runs the sampled
evaluator with 300 independent seeds at 256, 2,000 and 20,000 samples. Results:
`validation/5.5/statistics/poker/poker-calibration.json`.

<!--POKER-TABLE-BEGIN-->
| Game | Utility, proven bound | Samples | Evaluations | All samples inside the bound | Bounded-payoff coverage | Normal-approximation (5.4 style) coverage | False "supported best": bounded / normal | "Supported best" stated: bounded / normal | Mean half-width: bounded / normal |
|---|---|---|---|---|---|---|---|---|---|
| hu-river | chip [-20, 30] | 256 | 900 | 900/900 | 900/900 | 852/900 (94.7%) | 0 / 3 | 0 / 14 | 6.817 / 1.252 |
| hu-river | chip [-20, 30] | 2,000 | 900 | 900/900 | 900/900 | 847/900 (94.1%) | 0 / 1 | 0 / 94 | 1.284 / 0.446 |
| hu-river | chip [-20, 30] | 20,000 | 900 | 900/900 | 900/900 | 854/900 (94.9%) | 0 / 0 | 235 / 586 | 0.268 / 0.141 |
| hu-turn | chip [-12, 20] | 256 | 900 | 900/900 | 900/900 | 858/900 (95.3%) | 0 / 0 | 0 / 617 | 3.374 / 0.548 |
| hu-turn | chip [-12, 20] | 2,000 | 900 | 900/900 | 900/900 | 858/900 (95.3%) | 0 / 0 | 372 / 897 | 0.616 / 0.195 |
| hu-turn | chip [-12, 20] | 20,000 | 900 | 900/900 | 899/900 | 858/900 (95.3%) | 0 / 0 | 900 / 900 | 0.124 / 0.062 |
| river3-chip | chip [-4, 14] | 256 | 900 | 900/900 | 900/900 | 855/900 (95.0%) | 0 / 7 | 0 / 502 | 1.941 / 0.338 |
| river3-chip | chip [-4, 14] | 2,000 | 900 | 900/900 | 900/900 | 855/900 (95.0%) | 0 / 9 | 600 / 615 | 0.362 / 0.120 |
| river3-chip | chip [-4, 14] | 20,000 | 900 | 900/900 | 900/900 | 865/900 (96.1%) | 0 / 4 | 600 / 610 | 0.075 / 0.038 |
| flop6 | chip [-20, 85.8] | 256 | 600 | 600/600 | 600/600 | 575/600 (95.8%) | 0 / 1 | 0 / 151 | 11.158 / 1.820 |
| flop6 | chip [-20, 85.8] | 2,000 | 600 | 600/600 | 600/600 | 572/600 (95.3%) | 0 / 0 | 2 / 378 | 2.038 / 0.647 |
| flop6 | chip [-20, 85.8] | 20,000 | 600 | 600/600 | 600/600 | 572/600 (95.3%) | 0 / 0 | 509 / 594 | 0.410 / 0.204 |
| turn4 | chip [-10, 39.6] | 256 | 600 | 600/600 | 600/600 | 565/600 (94.2%) | 0 / 0 | 0 / 539 | 4.969 / 0.669 |
| turn4 | chip [-10, 39.6] | 2,000 | 600 | 600/600 | 600/600 | 581/600 (96.8%) | 0 / 0 | 478 / 600 | 0.863 / 0.238 |
| turn4 | chip [-10, 39.6] | 20,000 | 600 | 600/600 | 600/600 | 573/600 (95.5%) | 0 / 0 | 600 / 600 | 0.163 / 0.075 |
| bubble4 | icm [0, 50] | 256 | 600 | 600/600 | 600/600 | 581/600 (96.8%) | 0 / 0 | 0 / 600 | 4.153 / 0.097 |
| bubble4 | icm [0, 50] | 2,000 | 600 | 600/600 | 600/600 | 572/600 (95.3%) | 0 / 0 | 600 / 600 | 0.563 / 0.034 |
| bubble4 | icm [0, 50] | 20,000 | 600 | 600/600 | 600/600 | 573/600 (95.5%) | 0 / 0 | 600 / 600 | 0.067 / 0.011 |
| final8 | icm [0, 30] | 256 | 300 | 300/300 | 300/300 | 294/300 (98.0%) | 0 / 0 | 0 / 300 | 2.406 / 0.000 |
| final8 | icm [0, 30] | 2,000 | 300 | 300/300 | 300/300 | 288/300 (96.0%) | 0 / 0 | 300 / 300 | 0.307 / 0.000 |
| final8 | icm [0, 30] | 20,000 | 300 | 300/300 | 300/300 | 290/300 (96.7%) | 0 / 0 | 300 / 300 | 0.031 / 0.000 |

Totals over 14,400 sampled evaluations (48 game/hand/sample-count cells, 300 seeds each):

- every sample and every exact EV lay inside the payoff bound derived from the betting rules (14,400/14,400);
- the bounded-payoff simultaneous intervals covered the exact differences in 14,399/14,400 evaluations; the pass rule (no cell with a Wilson upper limit below 95%) was met in every cell;
- the normal-approximation intervals covered in 13,738/14,400 (95.4%) and made 25 false "supported best" statements; the bounded intervals made 0;
- the cost is power at small sample counts: at 256 samples the bounded intervals supported a best action 0 times, the normal approximation 2723 times; at 20,000 samples 3744 against 4190.

An earlier run of this tool was interrupted on purpose because the binary it was using was about to be rebuilt; its
completed cells are kept in `validation/5.5/statistics/poker-interrupted-run1/`.
<!--POKER-TABLE-END-->

## 5. What remains unresolved

- **Across-training (population) confidence is not calibrated** and cannot be with the replication counts the presets
  use. A distribution-free interval for the median across trainings needs about ten or more replications under
  Bonferroni and exact evaluation; it is not implemented.
- **Sampled quality has no calibrated bound.** Exact quality is required for a calibrated quality statement.
- **The payoff bound is conservative for differences** (twice the range). Tighter per-pair bounds or betting-style
  confidence sequences would narrow the intervals; neither is implemented.
- **Optional stopping is not supported.** Intervals are fixed-sample; budget-to-budget stability checks remain
  descriptive.
- **Independence of pseudorandom streams** is assumed, as in every Monte Carlo method.
- The exact evaluator used as truth in Part E shares betting and showdown code with the sampler.

## References

- A. Maurer, M. Pontil. Empirical Bernstein Bounds and Sample Variance Penalization. COLT 2009.
- R. R. Bahadur, L. J. Savage. The Nonexistence of Certain Statistical Procedures in Nonparametric Problems. Ann. Math. Statist. 27 (1956).
- E. B. Wilson. Probable Inference, the Law of Succession, and Statistical Inference. JASA 22 (1927).
