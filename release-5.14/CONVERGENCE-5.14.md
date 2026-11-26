# EightMax 5.14: convergence at equal training time

Build `57befd67c7c86ebe`. Everything in this file was measured on the development machine (an Ubuntu container, Intel Xeon
2.1 GHz, **4 logical processors**), not on the target PC. The measure is the **exact NashConv** of the average
strategy on games small enough for an exact best response of every seat. For more than two seats NashConv is not
exploitability, and **no percentage of GTO follows from any number here**.

Raw results: `validation/5.14/convergence/` (`pruning-linux`, `threads-linux`, `scaling-linux`; each with
`plan.json`, `summary.txt`, `summary.json`, `raw.jsonl`). The tool: `eqtime` (`source/tools/eqtime514.cpp`).

## 1. Rules, written before measuring

`validation/5.14/plan.json` was written at 13:29 UTC on the day of the runs, before the first confirmatory unit; the
full text of each rule is printed by the tool into the `plan.json` of each result folder. In short:

* **Games:** the 20 reference games of the 5.10 experiment: few hands (7), ranges (8), tournament (5). "WIDE": the
  six games with ranges of at least 10 hands a seat.
* **Seeds:** 5141 to 5160 for pruning, 5141 to 5152 for threads; the same for every arm (paired); not used before.
* **Budgets:** wall-clock training time, each a fresh run. Linux: 1 s and 4 s (pruning), 4 s (threads). The plan
  for your PC is 4 s and 16 s (pruning) and 4 s (threads).
* **Statistic:** per game, budget and candidate, the mean over seeds of ln(NashConv candidate / NashConv baseline),
  Student-t interval, Bonferroni over the family. Primary family: the longest budget. Verdicts: better (the whole
  interval below 1), worse (above 1), unresolved.
* **Q1 / T1:** the equal-deals check passes (every arm reproduces the recorded NashConv after 20,000 deals to the last
  bit), or nothing counts.
* **Q3:** a pruning algorithm is RECOMMENDED (still opt-in) for a class when it is better on at least half of the
  class's games and worse in no interval. **Q4:** NOT RECOMMENDED when worse in any interval; otherwise EXPERIMENTAL.
* **T3:** a threaded arm is RECOMMENDED for `rbes` on wide games *on this machine* when better on at least 4 of 6
  and worse on none. **T4:** NOT RECOMMENDED when worse on any.
* **Q5 / T5:** no outcome changes a default in 5.14.
* **Stated expectation before the run:** the pilots gave no reason to expect a benefit of pruning on these games.

## 2. Pruning: result

Equal-deals check: 60 of 60 values identical. 2,460 rows, 0 errors, 20 valid seeds everywhere. Four units ran at
once, each bound to its own processor, the three arms of a unit one after the other in an order rotating with the
seed.

Primary family (4 s; 40 intervals, each at level 0.05/40). Ratio = geometric mean of NashConv(candidate) /
NashConv(default); below 1 favours the candidate. "deals" = median ratio of sampled deals in the same time.

| Game | Class | Candidate | Ratio | Interval | Verdict | deals | NashConv baseline | NashConv candidate |
|---|---|---|---:|---|---|---:|---:|---:|
| hu-river | few hands | `nrp` | 0.954 | [0.711, 1.281] | unresolved | 1.01 | 0.0128 | 0.0129 |
| hu-turn | few hands | `nrp` | 1.001 | [0.886, 1.130] | unresolved | 0.97 | 0.0245 | 0.0238 |
| river3-chip | few hands | `nrp` | 1.054 | [0.669, 1.659] | unresolved | 1.00 | 0.0115 | 0.0118 |
| turn4 | few hands | `nrp` | 1.010 | [0.529, 1.927] | unresolved | 1.06 | 3.38e-06 | 3.51e-06 |
| flop6 | few hands | `nrp` | 0.764 | [0.390, 1.496] | unresolved | 1.04 | 0.0469 | 0.033 |
| final8 | few hands | `nrp` | 0.733 | [0.173, 3.117] | unresolved | 1.16 | 3.24e-07 | 4.98e-07 |
| bubble4 | few hands | `nrp` | 0.820 | [0.388, 1.733] | unresolved | 1.10 | 5.57e-08 | 5.53e-08 |
| rg-hu-river | WIDE | `nrp` | 0.975 | [0.893, 1.064] | unresolved | 0.98 | 0.0215 | 0.0209 |
| rg-river3 | WIDE | `nrp` | 0.928 | [0.778, 1.106] | unresolved | 0.98 | 0.0083 | 0.00759 |
| rg-hu-turn | WIDE | `nrp` | 1.014 | [0.958, 1.074] | unresolved | 1.02 | 0.0419 | 0.0431 |
| rg-turn3 | WIDE | `nrp` | 0.983 | [0.915, 1.055] | unresolved | 1.04 | 0.823 | 0.81 |
| rg-turn4 | WIDE | `nrp` | 0.971 | [0.814, 1.158] | unresolved | 1.03 | 0.0717 | 0.072 |
| rg-icm3-river | WIDE | `nrp` | 1.043 | [0.923, 1.179] | unresolved | 0.98 | 0.0249 | 0.0275 |
| rg-bubble4 | ranges | `nrp` | 0.886 | [0.602, 1.305] | unresolved | 1.01 | 0.0165 | 0.017 |
| rg-flop6c | ranges | `nrp` | 0.933 | [0.682, 1.277] | unresolved | 1.01 | 0.216 | 0.19 |
| early3-flop | tournament | `nrp` | 1.001 | [0.987, 1.016] | unresolved | 1.00 | 15.2 | 15.2 |
| mid3-turn | tournament | `nrp` | 1.008 | [0.823, 1.233] | unresolved | 0.97 | 0.414 | 0.418 |
| short8-push | tournament | `nrp` | 0.874 | [0.564, 1.354] | unresolved | 1.22 | 0.00913 | 0.00789 |
| bubble5-icm | tournament | `nrp` | 0.988 | [0.269, 3.630] | unresolved | 1.15 | 3.74e-07 | 3.32e-07 |
| sidepot3-icm | tournament | `nrp` | 1.026 | [0.764, 1.377] | unresolved | 1.00 | 0.0307 | 0.0324 |
| hu-river | few hands | `nrpc` | 1.015 | [0.621, 1.659] | unresolved | 1.07 | 0.0128 | 0.0133 |
| hu-turn | few hands | `nrpc` | 0.991 | [0.867, 1.132] | unresolved | 1.02 | 0.0245 | 0.0237 |
| river3-chip | few hands | `nrpc` | 1.076 | [0.735, 1.576] | unresolved | 1.06 | 0.0115 | 0.0124 |
| turn4 | few hands | `nrpc` | 0.685 | [0.341, 1.375] | unresolved | 1.16 | 3.38e-06 | 2.62e-06 |
| flop6 | few hands | `nrpc` | 0.913 | [0.434, 1.922] | unresolved | 1.13 | 0.0469 | 0.0452 |
| final8 | few hands | `nrpc` | 1.756 | [0.434, 7.107] | unresolved | 1.19 | 3.24e-07 | 1.2e-06 |
| bubble4 | few hands | `nrpc` | 6.313 | [1.846, 21.591] | **worse** | 1.21 | 5.57e-08 | 4.91e-07 |
| rg-hu-river | WIDE | `nrpc` | 0.965 | [0.871, 1.069] | unresolved | 1.03 | 0.0215 | 0.0209 |
| rg-river3 | WIDE | `nrpc` | 0.907 | [0.733, 1.122] | unresolved | 1.07 | 0.0083 | 0.00793 |
| rg-hu-turn | WIDE | `nrpc` | 1.083 | [1.033, 1.134] | **worse** | 1.03 | 0.0419 | 0.0445 |
| rg-turn3 | WIDE | `nrpc` | 1.034 | [0.971, 1.101] | unresolved | 1.08 | 0.823 | 0.851 |
| rg-turn4 | WIDE | `nrpc` | 1.050 | [0.851, 1.297] | unresolved | 1.04 | 0.0717 | 0.075 |
| rg-icm3-river | WIDE | `nrpc` | 1.049 | [0.902, 1.219] | unresolved | 0.99 | 0.0249 | 0.0287 |
| rg-bubble4 | ranges | `nrpc` | 1.059 | [0.650, 1.728] | unresolved | 1.06 | 0.0165 | 0.0188 |
| rg-flop6c | ranges | `nrpc` | 1.045 | [0.703, 1.552] | unresolved | 1.05 | 0.216 | 0.217 |
| early3-flop | tournament | `nrpc` | 1.006 | [0.991, 1.021] | unresolved | 0.99 | 15.2 | 15.3 |
| mid3-turn | tournament | `nrpc` | 1.048 | [0.874, 1.258] | unresolved | 0.99 | 0.414 | 0.43 |
| short8-push | tournament | `nrpc` | 0.899 | [0.551, 1.466] | unresolved | 1.31 | 0.00913 | 0.00825 |
| bubble5-icm | tournament | `nrpc` | 3.085 | [1.048, 9.085] | **worse** | 1.27 | 3.74e-07 | 1.09e-06 |
| sidepot3-icm | tournament | `nrpc` | 1.052 | [0.845, 1.311] | unresolved | 1.02 | 0.0307 | 0.0331 |

| | better | unresolved | worse (4 s) | worse in any interval (1 s or 4 s) | Decision by the rule |
|---|---:|---:|---:|---|---|
| `nrp` | 0 | 20 | 0 | none | **EXPERIMENTAL, no resolved benefit** |
| `nrpc` | 0 | 17 | 3 | bubble4 (1 s, 4 s), rg-hu-turn (1 s, 4 s), bubble5-icm (4 s) | **NOT RECOMMENDED** |

What this does and does not say:

* **No benefit of pruning was resolved on any game.** The intervals are wide on the games with few hands (their
  NashConv after 4 s is 1e-6 or less and scatters over orders of magnitude between seeds), so "unresolved" there
  excludes little. On the six WIDE games the `nrp` intervals lie within 0.78 to 1.18: if there is an effect at 4 s,
  it is smaller than about 20% either way.
* **`nrpc` is worse where its variance bites:** bubble games with tiny regrets (bubble4, bubble5-icm) and rg-hu-turn.
  This is the price of the correction factor of 20 (MATHEMATICAL-VALIDATION-5.14.md, section 3), not a defect of the
  implementation: the algorithm is unbiased and noisier.
* **`nrp`, the biased variant, did no measurable harm here.** That is an observation on 20 games at 1 s and 4 s, not
  a guarantee; it has none.
* **These games are the wrong place to look for a gain.** One to three bet sizes a street leave little to skip:
  pruning bought a median of 0 to 30% more deals (most on short8-push, 1.2 to 1.3 times). Trees with many sizes per
  decision could not be measured, because no exact NashConv exists for games of that size in this program
  (Phase 7 is meant to change that).

## 3. Threads with frozen batches: result

Question: does `rbes` with frozen batches on N threads reach a lower NashConv than `rbes` on one thread in the same
time? Arms: `rbes-b1-t1` (baseline), `rbes-b4-t4` (batch N, N threads), `rbes-b16-t4` (batch 4N, N threads); N = 4.
**Limit, stated in the plan: the machine has 4 processors, so the threaded arms had no idle processor.** Units ran
one at a time. Equal-deals check: 24 of 24. 312 rows, 0 errors, 12 valid seeds everywhere.

| Game | Class | Candidate | Ratio | Interval | Verdict | deals | NashConv baseline | NashConv candidate |
|---|---|---|---:|---|---|---:|---:|---:|
| rg-hu-river | WIDE | `rbes-b4-t4` | 0.957 | [0.715, 1.281] | unresolved | 1.06 | 0.0141 | 0.0132 |
| rg-river3 | WIDE | `rbes-b4-t4` | 0.874 | [0.605, 1.263] | unresolved | 1.01 | 0.00361 | 0.00331 |
| rg-hu-turn | WIDE | `rbes-b4-t4` | 0.959 | [0.838, 1.097] | unresolved | 1.09 | 0.036 | 0.0342 |
| rg-turn3 | WIDE | `rbes-b4-t4` | 1.077 | [1.002, 1.158] | **worse** | 0.96 | 0.498 | 0.533 |
| rg-turn4 | WIDE | `rbes-b4-t4` | 1.072 | [0.742, 1.549] | unresolved | 0.96 | 0.05 | 0.0553 |
| rg-icm3-river | WIDE | `rbes-b4-t4` | 0.993 | [0.726, 1.357] | unresolved | 1.03 | 0.00917 | 0.00923 |
| rg-hu-river | WIDE | `rbes-b16-t4` | 0.766 | [0.627, 0.934] | **better** | 1.75 | 0.0141 | 0.01 |
| rg-river3 | WIDE | `rbes-b16-t4` | 0.676 | [0.433, 1.055] | unresolved | 1.51 | 0.00361 | 0.00239 |
| rg-hu-turn | WIDE | `rbes-b16-t4` | 0.907 | [0.777, 1.058] | unresolved | 1.16 | 0.036 | 0.032 |
| rg-turn3 | WIDE | `rbes-b16-t4` | 0.927 | [0.821, 1.048] | unresolved | 1.29 | 0.498 | 0.45 |
| rg-turn4 | WIDE | `rbes-b16-t4` | 0.946 | [0.562, 1.591] | unresolved | 1.15 | 0.05 | 0.044 |
| rg-icm3-river | WIDE | `rbes-b16-t4` | 0.846 | [0.545, 1.314] | unresolved | 1.60 | 0.00917 | 0.00839 |

| | better | unresolved | worse | Decision by the rule |
|---|---:|---:|---:|---|
| `rbes`, batch 4, 4 threads | 0 | 5 | 1 (rg-turn3, 1.08) | **NOT RECOMMENDED on this machine** |
| `rbes`, batch 16, 4 threads | 1 (rg-hu-river, 0.77) | 5 | 0 | **unresolved** |

Batch 16 on 4 threads made 1.2 to 1.7 times the deals of one thread and all six ratios are below 1 (0.68 to 0.95),
but only one interval excludes 1 with 12 seeds. Batch 4 on 4 threads made about as many deals as one thread (0.96 to
1.09 times): on games this small the fixed cost of a batch eats what the threads add, and a frozen batch updates the
strategy less often. Nothing here says what 8 threads do on a processor with 24.

### `rbes` against the default trainer (information; decides nothing)

The threads experiment also ran the default trainer on one thread, as a reference arm. This is **not** the
experiment that decides whether `rbes` becomes the automatic trainer for wide games (that is the 5.13 rbes kit on
your PC, with its own plan), and these intervals are plain 95% intervals without adjustment:

| Game (WIDE) | NashConv `rbes` / default at 4 s, 12 seeds | 95% interval | lower in seeds | deals `rbes` / default |
|---|---:|---|---:|---:|
| rg-hu-river | 0.63 | [0.57, 0.70] | 12 of 12 | 0.07 |
| rg-river3 | 0.49 | [0.43, 0.55] | 12 of 12 | 0.14 |
| rg-hu-turn | 0.87 | [0.81, 0.93] | 11 of 12 | 0.13 |
| rg-turn3 | 0.59 | [0.56, 0.63] | 12 of 12 | 0.25 |
| rg-turn4 | 0.69 | [0.58, 0.82] | 11 of 12 | 0.32 |
| rg-icm3-river | 0.37 | [0.30, 0.46] | 12 of 12 | 0.15 |

On this machine `rbes` reached a lower NashConv on all six games with 7% to 32% of the deals. It is consistent with
the 5.10 result and is the reason the question is worth your PC's time.

## 4. Pilots (not part of any verdict)

Reported because they shaped the rule that was then tested. Seeds 7001 to 7015; none reused.

| Pilot | Finding | Consequence |
|---|---|---|
| First rule: one global threshold; any non-terminal child | 1.1 to 2.4 times the deals per second, no better NashConv; **on rg-flop6c at 20,000 deals NashConv 2.6 times the default's** (actions skipped after one or two visits of a row) | rule replaced |
| Second rule: per-row evidence; thresholds 0.02 and 0.1, evidence 10 and 50 | ratios 0.83 to 1.10 on five games (5 seeds, unresolved); 1.3 to 1.9 on rg-flop6c; no gain in deals per second | 0.02 and 50 kept; candidates restricted to actions followed by a decision |
| Third rule (released) | rg-flop6c: `nrp` 1.26, `nrpc` 1.05 (5 seeds, unresolved) | design frozen, then the plan written |
| Work saved on shipped fixtures (300,000 deals, no quality measure exists) | 5 to 13% fewer state visits | reported; too little to matter |

The settings were therefore chosen on pilot data from six of the twenty games. The confirmatory seeds are fresh, and
since no benefit was found there is no selection effect to discount.

## 5. Deals per second by batch size and thread count (information)

`eqtime scaling`: two shipped fixtures too large for an exact NashConv, 3 s a run. **More deals per second is not
more quality per second**: a frozen batch writes the same state for every thread count, but a larger batch updates
the strategy less often.

```
EightMax 5.14, part scaling: sampled deals per second
Engine build 57befd67c7c86ebe. Processor: Intel(R) Xeon(R) Processor @ 2.10GHz (4 logical). 3 s per run; table limit 2048 MiB.
A frozen batch writes the same state for every thread count; more deals per second is not better quality per second.

fixture      trainer   batch threads      deals/s  x 1 thr   seconds by stage: deal, traverse, merge
flop6-jack   default       1       1        34329     1.00   0.31, 2.57, 0.21
flop6-jack   default      16       1        26385     1.00   0.24, 2.55, 0.21
flop6-jack   default      16       2        49101     1.86   0.33, 2.22, 0.41
flop6-jack   default      16       4        69060     2.62   0.47, 1.91, 0.55
flop6-jack   default      64       1        25892     1.00   0.22, 2.54, 0.21
flop6-jack   default      64       2        48128     1.86   0.34, 2.33, 0.35
flop6-jack   default      64       4        79435     3.07   0.48, 2.01, 0.48
flop6-jack   rbes          1       1        11430     1.00   0.31, 2.41, 0.49
flop6-jack   rbes         16       1         8720     1.00   0.25, 2.30, 0.47
flop6-jack   rbes         16       2        14122     1.62   0.31, 1.90, 0.76
flop6-jack   rbes         16       4        21938     2.52   0.37, 1.64, 0.89
flop6-jack   rbes         64       1        10898     1.00   0.25, 2.54, 0.55
flop6-jack   rbes         64       2        16881     1.55   0.28, 2.10, 0.72
flop6-jack   rbes         64       4        26971     2.47   0.38, 1.73, 0.80
flop3-kings  default       1       1        77456     1.00   0.28, 2.56, 0.23
flop3-kings  default      16       1        70567     1.00   0.21, 2.52, 0.27
flop3-kings  default      16       2        98284     1.39   0.27, 2.13, 0.57
flop3-kings  default      16       4       110767     1.57   0.33, 1.82, 0.78
flop3-kings  default      64       1        73421     1.00   0.22, 2.51, 0.28
flop3-kings  default      64       2       105702     1.44   0.25, 2.13, 0.61
flop3-kings  default      64       4       152232     2.07   0.32, 1.85, 0.78
flop3-kings  rbes          1       1        10598     1.00   0.29, 2.37, 0.45
flop3-kings  rbes         16       1         8960     1.00   0.23, 2.16, 0.68
flop3-kings  rbes         16       2        12087     1.35   0.25, 1.76, 1.02
flop3-kings  rbes         16       4        15862     1.77   0.31, 1.40, 1.15
flop3-kings  rbes         64       1         8433     1.00   0.23, 2.37, 0.77
flop3-kings  rbes         64       2        11716     1.39   0.27, 1.81, 1.02
flop3-kings  rbes         64       4        19627     2.33   0.24, 1.59, 1.17
```

* With 4 threads on 4 processors: 1.6 to 3.1 times the deals per second of one thread at the same batch size.
* A batch on one thread is slower than no batch (0.75 to 0.95 times): the price of freezing.
* With `rbes` the merge stage takes 30 to 40% of the time at 4 threads; it is the part that does not scale.
  The grouped merge of 5.14 shortened it by about 20% against the 5.13 code on this machine. It writes the same
  bytes.
* Beyond 4 threads nothing is known. `Run 5.14 equal-time comparison.bat` measures 1, 2, 4, 8, 12, 16 and 24 threads on
  your PC.

## 6. What Phase 4 has and has not delivered

| Part of Phase 4 | State |
|---|---|
| Equal-time `rbes` results from the PC | launcher delivered with 5.13 (`rbes-equal-time`); **results not yet received** |
| Prespecified rule for `rbes` as automatic trainer | written (P1 to P5 in that kit); **not applied**: it is decided on your PC only. No `estimator=auto` exists yet |
| Pruning | built, proven where provable, measured: **no resolved benefit; `nrpc` not recommended** |
| Multithreading | merge restructured, bit-identical; **no resolved quality gain on 4 processors**; your PC decides for 8 |

**Convergence is not faster in 5.14 than in 5.13 for anything that runs by default.** The one candidate with evidence
behind it is `rbes` on wide games, and that evidence is from Linux.

## 7. Limits

* Small games only, with exact evaluation; 1 s and 4 s. Whether an ordering holds after minutes of training was not
  measured.
* Four units at once on four processors share memory bandwidth and caches; arms of a unit ran in sequence on the
  same processor with rotating order, which protects the comparison within a unit but not the absolute numbers.
* 20 seeds (12 for threads) resolve ratios of roughly 0.9 on the range games and nothing finer; on the few-hand games
  far less.
* The pruning settings (0.02, 50, 0.95) are one point; other settings were only piloted.
