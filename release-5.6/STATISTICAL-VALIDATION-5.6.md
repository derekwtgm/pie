# Statistical validation — EightMax 5.6

5.5 made the statement about the *measured* strategies calibrated: bounded-payoff intervals that hold for any payoff distribution, or no ranking at all. It left one thing open and said so: confidence across independent trainings. In its own adversarial scenario, where one training in twenty fails badly, a `ranked` verdict was issued in 79% of studies. Each such verdict was true for the five to ten strategies that had been measured and said nothing reliable about trainings in general.

5.6 keeps the 5.5 intervals unchanged (`study-5.5-bounded-eb-v1`) and adds a second calculation, `study-5.6-replication-v1` (`source/native/study_stats56.hpp`), that answers a narrower question honestly: **what does this number of independent trainings support?**

## 1. What is reported, and what each part means

| Field (per variant and budget) | Meaning | Kind of statement |
|---|---|---|
| `confidence.evaluationKind` | `exact` or `sampled` | Declared by the evaluator, never inferred from a zero standard error |
| `confidence.evaluationUncertainty` | How well each trained strategy's action values are known: standard error and calibrated half-width of the leading gap | Bounded-payoff (5.5), distribution-free given its assumptions; none for exact evaluation |
| `confidence.trainingVariation` | How much the leading gap differs between independently trained strategies: standard deviation, minimum, maximum | Descriptive. With sampled evaluation the spread contains evaluation noise as well, and the field says so |
| `confidence.replication` | Trainings run, trainings needed, per-training certificates, sign-test p-values, an order-statistic interval for the median gap, the undetectable failure rate, and a verdict | Distribution-free (see 2) |
| `bestAction.declared` | True only when the measured-strategies verdict is `ranked` **and** the across-trainings verdict is `ranked` | The only place where the software recommends an action |
| `statisticalWarnings` (study level) | Plain-language list of what the study does not establish | Always present when something is not established |
| `verdict`, `gap.conditionalEvaluationCi95`, `gap.ci95` | As in 5.5: calibrated for the measured strategies; the interval for the mean over trainings is model-based (Student t) and labelled so | Unchanged |

The quality figure is unchanged: exact inside the abstraction, or a sampled restricted response without a calibrated interval. It is never presented as a probability of being near equilibrium, and 5.6 adds a warning line whenever it is not calibrated.

## 2. The across-trainings calculation

Trainings with different seeds are independent draws from one unknown distribution of training outcomes. Nothing is assumed about that distribution: not normality, not a finite variance, not a bound.

1. **Certificates.** For every trained strategy and every action other than the leader, the bounded-payoff interval of EV(leader) - EV(other) is computed at level 0.2 alpha' / (n (k - 1)), where alpha' = 0.05 / family, n is the number of trainings and k the number of actions. All of them hold together with probability at least 1 - 0.2 alpha'. A training *certifies the leader by the margin* if every lower limit exceeds the declared EV margin, *a positive edge* if every lower limit exceeds zero, and *another action* if some upper limit is below zero. Exact evaluations are their own certificates.
2. **Sign test.** If at most half of all trainings truly favoured the leader by the margin, the number of certified trainings among n would be stochastically smaller than Binomial(n, 1/2). The claim is made when P(Bin(n, 1/2) >= s) <= 0.4 alpha'. The leader is chosen from the same data, which is why the level is 0.4 alpha' and not 0.8 alpha': a training can favour at most one action by a positive margin, so over all actions the error is at most twice the one-sided tail. Total error: 2 x 0.4 alpha' + 0.2 alpha' = alpha'.
3. **Minimum replication.** The smallest tail, all n trainings agreeing, is 2^-n. Below the n at which 2^-n <= 0.4 alpha' no data can support the claim, and the verdict is `insufficientReplication`.
4. **A training that disagrees.** If any training certifies another action, the verdict is `trainingsDisagree` and nothing is declared, however many others agree.
5. **What could hide.** If a fraction f of trainings fails, the chance that none of n fails is (1 - f)^n. The report states u(n) = 1 - 0.05^(1/n): a failure mode rarer than that has more than a 1 in 20 chance of leaving no trace.

The claim is about the **median** training: more than half of all trainings. It is not about the mean over trainings, which a single rare catastrophic training can move arbitrarily and which no method can bound from a handful of replications, and it is not a prediction for the next training.

| Family (variant-budget cells) | 1 | 2 | 3 | 6 | 9 | 12 | 20 | 40 |
|---|---|---|---|---|---|---|---|---|
| Minimum trainings (all agreeing) | 6 | 7 | 8 | 9 | 9 | 10 | 10 | 11 |

The family of this statement is the number of (variant, budget) cells of the study, because each cell can carry at most one declaration; the comparisons with the other actions inside a cell are covered by the certificates' union bound and by the argument in step 2. (The 5.5 intervals keep their own, larger family, which counts every action value, pair and quality slot.) One variant at one budget needs 6 agreeing trainings, three variants at three budgets need 9. The Quick (2 trainings) and Standard (5) presets can never declare a best action; Deep (10) can for studies of up to 20 cells.

| Trainings | 1 | 2 | 3 | 5 | 6 | 8 | 10 | 15 | 20 | 30 | 50 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A failure rarer than this probably leaves no trace | 95% | 78% | 63% | 45% | 39% | 31% | 26% | 18% | 14% | 10% | 6% |

## 3. Protocol

`source/tools/statistical_validation56.py`, run against `source/tests/study53_probe.cpp` compiled from the release source, so every verdict comes from the shipped aggregation code. Data and truths are generated with NumPy; reference probabilities come from SciPy. The protocol was written to `validation/5.6/statistics/formal/protocol.json` before the first trial.

- Trials: 4000 per exact-evaluation scenario, 500 per sampled-evaluation scenario. Seed 5601. Margin 0.05. Payoffs in [-20, 20].
- Truth for a declaration: P(theta > margin) > 1/2 for a random training (theta: the true leading gap of that training); the leader is action 0 in every generator unless the data select action 1, in which case the declaration is scored against P(-theta > margin) > 1/2.
- Evaluation model `exact`: no evaluation error.
- Evaluation model `normal`: N i.i.d. samples of a payoff in [-20, 20] with mean theta and standard deviation 2 (clipped normal).
- Evaluation model `rare_tail`: N i.i.d. samples: 20 with probability 0.0005, otherwise theta - 0.01 (so the mean is within 0.0001 of theta for |theta| < 1); the rare payoff is usually not drawn.
- Pass rules:
  - **F**: every formula value agrees with SciPy to 1e-12 (binomial upper tail for n <= 40, minimum trainings, undetectable failure rate) and the order-statistic interval has the coverage it reports
  - **R**: in every R scenario a best action is declared in 0 trials and the across-trainings verdict is insufficientReplication in every trial
  - **N**: in every N scenario the Wilson 95% LOWER limit of the frequency of a false declaration is <= 0.05, and of a false across-trainings "ranked" verdict likewise
  - **A**: in every A scenario: (1) no trial whose trainings contain BOTH a failed and a sound training declares a best action; (2) every such trial with exact evaluation reports trainingsDisagree; (3) the stated undetectable failure rate u(n) = 1 - 0.05^(1/n) is honest: where the true failure fraction is below u(n) the reported bound exceeds it (so nothing rarer is ever implied to be excluded), and where it is at or above u(n) the frequency of trials in which no failure was drawn has a Wilson lower limit <= 0.05; (4) false declarations (truth as above; this covers the trials in which every drawn training failed alike, where nothing can be seen to disagree) have a Wilson lower limit <= 0.05
  - **P**: descriptive: declaration frequency reported, no threshold
- Rule history (recorded before the formal run): A first development pass (800 trials, seed 77, kept in validation/5.6/statistics/development-pass) used rule (1) "no trial with a failed training declares". It flagged 7 of 800 trials of A_forty_percent_fail_n10 in which 9 or 10 of the 10 drawn trainings had failed: the trainings then agree with each other and the failed action leads. Such trials are sign-test errors, bounded by rule (4); rules (1)-(3) were restated in terms of what a study can observe (a mixture of failed and sound trainings) before the formal run. A second development pass (800 trials, seed 78) showed that rule (3), then worded "whenever the sound action is declared the bound is >= the true fraction", was itself wrong for a 40% failure rate at n = 10: the bound (26%) is below 40% by design and the 0.6% of studies that draw no failure are exactly the ones the bound allows for. Rule (3) now tests the statement the bound makes. No threshold was changed and no scenario was removed.

## 4. Results

**Overall: every pass rule held.**

### F. Formulas

Binomial tail against SciPy for 1 to 40 trainings: largest absolute difference 2.2e-16. Minimum trainings, undetectable failure rate and order-statistic coverage agree with their reference values in every case.

### R. Refusal below the minimum

| Scenario | Trainings | Family | Evaluation | Trials | Best action declared | Verdict `insufficientReplication` | 5.5 verdict `ranked` (for comparison) |
|---|---|---|---|---|---|---|---|
| R_five_good_trainings | 5 | 1 | exact | 4000 | 0 of 4000 | 4000 of 4000 | 100.00% |
| R_eight_good_family7 | 8 | 7 | exact | 4000 | 0 of 4000 | 4000 of 4000 | 100.00% |
| R_one_training | 1 | 1 | exact | 4000 | 0 of 4000 | 4000 of 4000 | 0.00% |

With five agreeing trainings, or eight in a family of seven, 5.5's verdict was `ranked` in essentially every study; 5.6 keeps that verdict for the measured strategies and declares nothing.

### N. The typical training does not favour the leader by the margin

| Scenario | Trainings | Family | Evaluation | Trials | False declaration (95% Wilson) | False across-trainings `ranked` | `trainingsDisagree` | 5.5 `ranked`, false for the population mean |
|---|---|---|---|---|---|---|---|---|
| N_margin_n6 | 6 | 1 | exact | 4000 | 1.60% [1.26%, 2.04%] | 1.95% [1.57%, 2.43%] | 96.85% | 0.70% |
| N_margin_n10 | 10 | 1 | exact | 4000 | 0.30% [0.17%, 0.52%] | 0.30% [0.17%, 0.52%] | 99.70% | 0.57% |
| N_cauchy_n10 | 10 | 1 | exact | 4000 | 0.15% [0.07%, 0.33%] | 0.20% [0.10%, 0.39%] | 99.80% | 0.92% |
| N_cauchy_n20 | 20 | 1 | exact | 4000 | 0.00% [0.00%, 0.10%] | 0.00% [0.00%, 0.10%] | 100.00% | 1.18% |
| N_below_margin_n8 | 8 | 1 | exact | 4000 | 0.00% [0.00%, 0.10%] | 0.00% [0.00%, 0.10%] | 0.00% | 0.00% |
| N_majority_fail_n10 | 10 | 1 | exact | 4000 | 0.03% [0.00%, 0.14%] | 0.03% [0.00%, 0.14%] | 99.35% | 0.03% |
| N_margin_sampled_rare_tail_n8 | 8 | 1 | rare_tail | 500 | 0.00% [0.00%, 0.76%] | 0.00% [0.00%, 0.76%] | 73.00% | 0.20% |
| N_below_margin_sampled_n8 | 8 | 1 | normal | 500 | 0.00% [0.00%, 0.76%] | 0.00% [0.00%, 0.76%] | 0.00% | 0.00% |

The nominal level is 5% divided by the family. The scenarios with a Cauchy distribution of training outcomes have no mean at all; the sign test is unaffected. `N_majority_fail_n10` has 60% of trainings failing: the typical training is a failed one, and declaring the sound action would be false.

### A. A fraction of trainings fails catastrophically

| Scenario | Trainings | Family | Evaluation | Trials | A failure was drawn | Failed and sound trainings both present | ... and a best action declared | ... and not reported as `trainingsDisagree` | Declared (no failure seen) | False declaration | Stated undetectable rate | 5.5 `ranked`, false for the population mean |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A_five_percent_fail_n6 | 6 | 1 | exact | 4000 | 25.35% | 1014 | 0 | 0 | 74.65% | 0.00% [0.00%, 0.10%] | 39% | 74.67% |
| A_five_percent_fail_n10 | 10 | 1 | exact | 4000 | 40.17% | 1607 | 0 | 0 | 59.82% | 0.00% [0.00%, 0.10%] | 26% | 59.85% |
| A_five_percent_fail_n20 | 20 | 1 | exact | 4000 | 64.85% | 2594 | 0 | 0 | 35.15% | 0.00% [0.00%, 0.10%] | 14% | 35.23% |
| A_forty_percent_fail_n10 | 10 | 1 | exact | 4000 | 99.50% | 3980 | 0 | 0 | 0.50% | 0.00% [0.00%, 0.10%] | 26% | 0.50% |
| A_five_percent_fail_sampled_n10 | 10 | 1 | normal | 500 | 38.60% | 193 | 0 | 0 | 61.40% | 0.00% [0.00%, 0.76%] | 26% | 61.40% |

This is the scenario 5.5 could not resolve. What 5.6 does with it:

- **Whenever a failed training is among the trainings together with sound ones, it is reported and nothing is declared** (zero exceptions in every scenario; with sampled evaluation the failed training is certified as favouring another action by its own interval).
- **When no failure is drawn, a best action is declared, and that declaration is true**: with a 5% failure rate, 95% of all trainings do favour the leader. What used to be wrong was reading it as a statement about every training or about the average. In 75% of six-training studies and 35% of twenty-training studies no failure was drawn.
- **The report says how much could be hidden.** With six trainings the stated rate is 39%; with twenty, 14%. A 5% failure rate is far below either, and the result says so in words (`rareTrainingFailuresNotExcluded`). Detecting a 5% failure rate with 95% probability takes 59 trainings; no statistic computed from ten can do it.
- The population mean in these scenarios is below the margin (one failure outweighs twenty successes). 5.5's `ranked`, whose second half is a model-based interval for that mean, was issued and false for the mean in the share of studies shown in the last column. 5.6 does not make a statement about the mean at all.

### P. Power (descriptive)

| Scenario | Trainings | Family | Evaluation | Trials | Best action declared | False declaration |
|---|---|---|---|---|---|---|
| P_good_n6 | 6 | 1 | exact | 4000 | 100.00% | 0.00% |
| P_good_n9_family7 | 9 | 7 | exact | 4000 | 100.00% | 0.00% |
| P_good_sampled_n8 | 8 | 1 | normal | 500 | 100.00% | 0.00% |
| P_good_sampled_rare_tail_n8 | 8 | 1 | rare_tail | 500 | 100.00% | 0.00% |

A clear, consistent edge is declared as soon as the minimum number of trainings is reached, with exact evaluation and with sampled evaluation including a rare large payoff.

## 5. The 5.5 intervals, re-tested

`source/tools/statistical_validation55.py` (the complete 5.5 validation: formulas, the 13 scenarios of 5.4, 20 raw-sample scenarios, exact evaluation with non-Gaussian training variation) was run again against the probe built from the 5.6 source: all of its pass rules held. Its output is in `validation/5.6/statistics/v55-rerun/`. The 5.5 calculation identifier and code are unchanged; the probe now also emits the 5.6 fields, which that script ignores.

## 6. What remains unresolved

- **The mean over trainings.** Still model-based (Student t), still labelled so, still not calibrated. 5.6 does not improve it; it stops relying on it for the declaration and reports the median statement beside it.
- **Rare training failures.** They cannot be excluded by a handful of trainings. 5.6 quantifies what could hide; it does not detect what is not in the sample.
- **Sampled quality.** No calibrated interval; the figure is a restricted response measure, not exploitability, and not a probability of anything.
- **Independence of trainings.** The sign test assumes trainings with different seeds are independent draws. They are by construction (separate random streams), but they share the abstraction, the fixture and the code: a defect common to all trainings is invisible to any replication-based method. Only an exact evaluation or an independent implementation can catch that.
- **Multiplicity across budgets and variants.** The family is per budget, as in 5.5. A study that looks at many budgets and variants and reports the most favourable one is outside what these levels cover.
- **Selection of the margin.** The EV margin is declared by the fixture before the study. Changing it after seeing results invalidates the levels.

## References

- Maurer, A. and Pontil, M. (2009). Empirical Bernstein bounds and sample variance penalization. COLT. (The per-training certificates; see STATISTICAL-VALIDATION-5.5.md.)
- Dixon, W. J. and Mood, A. M. (1946). The statistical sign test. Journal of the American Statistical Association 41.
- Bahadur, R. R. and Savage, L. J. (1956). The nonexistence of certain statistical procedures in nonparametric problems. Annals of Mathematical Statistics 27. (Why the mean has no distribution-free interval here.)

