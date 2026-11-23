# Final development report — EightMax 5.5

Build `abe74607a4a0120b`. Implementation and validation are kept apart throughout: "implemented" means the code exists and is
exercised by tests; "validated" names the evidence and its limits.

## 1. Defects repaired

- Conditional confidence intervals that under-covered with rare large payoffs.
- A sampled evaluation with zero standard error could be treated as exact.
- Interrupted studies could not be continued.
- Exact ICM evaluations ran many times slower than necessary because of a small evaluator cache.
- Training-dominated studies did not use additional threads.
- Windows and Linux results differed in the last digit of paired standard errors.

## 2. Did statistical confidence calibration improve?

Yes, for the statement the software can support. Rankings now rest on bounded-payoff intervals for the strategies
that were trained and measured. In 20 raw-sample scenarios (4,000 trials each) the new intervals covered in every
trial where they were published, where the 5.4 formula covered as little as 56.5%. Against the exact evaluator on
seven real games (14,400 sampled evaluations) the new intervals covered in 14,399 and made no false "best action"
statement; the normal-approximation intervals covered in 95.4% and made 25.

The price is width: the new intervals are 4 to 30 times wider in the synthetic scenarios, so more evaluation samples
are needed to resolve small EV gaps.

## 3. Was the rare-tail failure resolved under validated assumptions?

Yes, under these assumptions: evaluation samples are independent, identically distributed and equally weighted; every
sample lies inside the payoff bound derived from the betting rules; the sample count is fixed before sampling. The
guarantee is the Maurer–Pontil theorem; the simulations check the implementation. The 5.4 figure (2,597 of 3,000)
reproduces exactly from the 5.4 formula, and on those inputs, which carry no payoff bound, 5.5 states no ranking.

Not resolved: confidence across independent trainings. A scenario in which 5% of trainings fail badly produces a
`ranked` verdict in 79% of studies that is true for the measured strategies and false for the population. No method
can detect that with five to ten replications; the interval is labelled model-based and the limitation is stated.
Sampled quality is likewise uncalibrated.

## 4. Training algorithms implemented

One: river opponent enumeration, opt-in. Its expected regret and average-strategy increments match the default's in a
frozen-table test at 20 to 60 million deals per estimator, with regret-increment variance about 0.54–0.58 of the
default's.

## 5. Did convergence improve compared with 5.4?

- Default trainer: no. It is the 5.4 trainer and produces the same state bytes.
- Candidate at equal sampled deals: yes, statistically supported in 11 of 12 contrasts on four exact games with 20
  paired seeds (sign test and t interval, both Bonferroni-adjusted).
- Candidate at equal time: not established. Better in 1 of 8 contrasts, unresolved in 7; on the three-player river
  game most seeds were worse.
- The promotion rule was not met, so the default is unchanged.
- The 24 ICM comparisons 5.4 could not finish are complete: 12 worse, 12 unresolved, none better. The whole
  72-contrast family now stands at 0 better, 32 worse, 40 unresolved.

## 6. How much faster did the solver become?

Measured on a four-core Linux container against the unchanged 5.4 binary, four threads:

| Complete study | 5.4 | 5.5 | Ratio |
|---|---|---|---|
| Six-player flop, Standard preset | 66.0 s | 24.8 s | 2.67x |
| Eight-handed ICM, Standard preset | 238.5 s | 113.7 s | 2.10x |
| Three-player flop, Standard preset | 266.8 s | 170.6 s | 1.56x |
| Eight-handed ICM, exact, small | 22.4 s | 8.7 s | 2.58x |
| Six-player flop, exact, small | 61.8 s | 49.7 s | 1.24x |
| Three-player preflop, small, Standard | 5.0 s | 2.1 s | 2.42x |
| Three-player flop, exact, small, Standard | 9.0 s | 5.3 s | 1.69x |
| A-K-Q river, Standard | 0.56 s | 0.15 s | 3.63x |

All 178 measurements compared between the two versions were identical. The gain comes from running seeds side by
side and from a larger evaluator cache. **Training itself is not faster**: deals per second of the default trainer
are unchanged within noise, and peak memory is higher. These figures are not predictions for the target computer.

## 7. Does automatic checkpoint recovery work?

Yes, on Linux and under Wine. A study stopped by Stop, a time limit or the process memory budget, or killed with
SIGKILL at several moments, resumes to a result identical to the uninterrupted one apart from timing, memory and
bookkeeping fields. Damaged manifests and engine states are detected by hash. In the stability run one study was
paused and resumed 14 times and matched the uninterrupted result. Resume requires the same build.

## 8. Did ICM and multiway evaluation become more efficient?

The evaluator's code is unchanged. The slow ICM evaluations were caused by cache thrash: the same exact evaluation
takes 44 s with a 128 MiB cache and 1.2 s with 1,024 MiB, with the identical result. Studies now size the cache from
the process memory budget. Six-player exact evaluation was profiled but not restructured and remains expensive.

## 9. Mathematical tests that passed

- 568 regression tests on the final build: 567 passed, 1 skipped, 0 failed. 16 are new.
- Formula checks: 21 Student-t quantiles, 400 half-widths, 105 exact binomial checks of the inequality.
- Payoff bounds: every sample and every exact EV inside the bound in 14,400 evaluations across chip and ICM games
  with side pots.
- Unbiasedness of the candidate; exact NashConv comparisons on four games; the final binary reproduces 48 of 48
  recorded training checkpoints and the 5.4 default state on six games.
- AddressSanitizer and UndefinedBehaviorSanitizer: 38 of 38 tests, no report. ThreadSanitizer on parallel,
  checkpointed, cancelled and resumed studies: no warning.

## 10. Tests that failed or remain unverified

- The first full regression run had three failures: one load-sensitive timing test that passes unchanged alone and in
  later runs, and two older tests that assumed desktop studies have no checkpoint and that seeds run one at a time.
  Five existing tests were edited in total; `VALIDATION-5.5.md` lists each.
- One skipped: a file-permission test that cannot run as root.
- Unverified: leak checking beyond one short command-line study; GPU-mode continuation; power-loss durability;
  studies longer than a few minutes; the read-only-folder test.

## 11. Physical Windows and NVIDIA GPU testing

**Neither was performed.** The Windows executables were cross-compiled with MinGW-w64 GCC 13 and run under Wine 9.0
only: build identity, a known-game study, the compressed-checkpoint self-test, an interrupted and resumed study, and
the desktop host. Under Wine, per-seed measurements equal the Linux build's on three fixtures. No GPU was present; no
CUDA code was added or changed; RTX 4060 Ti performance is unknown. The hardware validation utility is included for
testing on the target computer.

## 12. What remains necessary to establish stronger GTO accuracy

- A calibrated statement across trainings: many more replications, or exact evaluation with a distribution-free test.
- A training improvement that holds at equal time and on ICM and linked-street games.
- Whole-game evaluation for the large tournament fixtures; today only restricted one-decision responses exist there.
- Measurement of abstraction error (bet sizes, ranges, hand grouping).
- Physical validation on Windows and on the GPU.

EightMax 5.5 is not claimed to have reached GTO, and no percentage of optimality is assigned.
