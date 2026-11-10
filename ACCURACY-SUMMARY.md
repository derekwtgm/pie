# Version 3.8 measurements

3.8 exports byte-identical states to 3.7 for equal settings (240 paired runs), so accuracy at equal sampled deals is unchanged. At equal time (2 s, 3 seeds) 3.8 completed 13-28% more deals in the heads-up river, heads-up turn and three-player river studies; mean exact exploitability or largest unilateral gain was lower (0.0354 to 0.0343 BB, 0.3205 to 0.3152 BB, 0.0645 to 0.0519), but every paired 95% interval includes zero. Multiway values are approximate one-seat response gains, not exploitability. The fold control variate remains optional and off by default. See RELEASE-3.8.md and validation/3.8/scenarios-accuracy.json.

# Version 3.7 measurements

At 500,000 deals, the seven-seed mean exact heads-up river exploitability was 0.0358 BB in 3.6 and 0.0389 BB with the optional 3.7 fold baseline. The paired 95% interval for the reduction includes zero at every tested budget. The new fold-payoff estimator remains optional. The default uses the previous estimator. Equal-deal and equal-time benchmarks use exact best responses in the finite heads-up river and sampled unilateral gains in large multiway games. See validation/3.7 and RELEASE-3.7.md.

# Version 3.6 measurements

See RELEASE-3.6.md and validation/3.6 for per-seed exact exploitability, approximate multiway response gains, matched-work and matched-time results.

## Historical results

# EightMax 3.4 accuracy measurements

The Linux benchmark machine reported an Intel Xeon Platinum 8573C. All timings below are CPU timings. The target in the weighted heads-up turn study was a largest exact unilateral response gain of at most 0.7 BB in its finite betting game. Each point started a fresh solve and included setup, training, strategy export and import. Exact evaluation ran outside the timer. The first measured crossing can occur later than the true crossing.

| Version and execution | Seed 1 | Seed 2 | Seed 3 | Median |
|---|---:|---:|---:|---:|
| 3.3 native automatic | 303 ms | 408 ms | 175 ms | 303 ms |
| 3.4 native automatic | 121 ms | 113 ms | 159 ms | 121 ms |
| 3.3 JavaScript automatic | 1,416 ms | 1,651 ms | 458 ms | 1,416 ms |
| 3.4 JavaScript automatic | 2,536 ms | 3,392 ms | 489 ms | 2,536 ms |

For this case, native 3.4 met the threshold at 4,000 updates on all three seeds. The JavaScript timing regressed on all three seeds. Build and test activity shared the host during these short timing runs. Repeat locally before using these ratios for hardware planning. Raw values and the runner are in validation/3.4/time-to-target.json and time-to-target.js.

The equal-time and equal-deal sweeps in convergence.json compare linear MCCFR, CFR+ regret matching, two DCFR parameter sets and full betting traversal. The preferred configuration depends on the game and horizon. For heads-up zero-sum fixtures the average of the two unilateral gains is exploitability, and their sum is NashConv. Multiway exact checks report the largest individual deviation gain in the specified finite game.

The ten scenario comparisons cover all requested tournament situations at three seeds each. Linear external sampling produced identical strategy table bodies at equal updates on all thirty matched comparisons. Large scenarios use a short trained response for seat zero evaluated on held-out deals. Those estimates can be negative and do not certify equilibrium or bound the best attainable deviation. See scenarios.json for each abstraction, timing, seed and observed variability. grouped.json reports strategy gain, visits, time and memory for the grouped benchmarks.

Direct GPU measurements, cross-device time-to-target and universal multiplayer convergence bounds remain unavailable.
