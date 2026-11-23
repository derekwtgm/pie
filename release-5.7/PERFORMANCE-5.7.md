# Performance — EightMax 5.7 against 5.6

Build `e4668abe7903f8b0`. Every number on this page was measured with the final Linux build of 5.7 and the unchanged 5.6 Linux binary (sha256 `3e824466b76abdc7…`), rebuilt from the 5.6 source and byte-identical to the one shipped in 5.6.

**Conditions.** Intel(R) Xeon(R) Processor @ 2.10GHz, 4 logical processors, 16 GB, a shared cloud virtual machine: **not** the target Windows PC (13th-generation Core i7, RTX 4060 Ti). Nothing else ran beside a measurement. Run-to-run variation on this machine is large (the same single-thread training differs by up to 10% between repetitions), so every comparison alternates the two binaries and reports medians; differences of a few percent are not findings. No number here says how fast the program is on another machine, and no GPU was involved.

Raw data: `validation/5.7/performance/` (`threads.json`, `trainbench/`, `evaluation/`, `studies/`; every repetition is kept). Tools: `source/tools/threads57.py`, `trainbench56.py`, `evalbench57.py`, `studybench57.py`.

## 1. Summary

| What | 5.7 against 5.6 | Results |
|---|---|---|
| Training, one deal per update, one thread (how a study trains a seed) | 0.87x to 1.12x, median 0.98x: **unchanged** (this path was not modified; the spread is machine noise) | state files byte-identical in 10 of 10 fixtures |
| Training, frozen batches (64 deals per update), 4 threads offered, measured thread choice | **1.34x to 1.74x** faster, median 1.56x | state files byte-identical for every thread count |
| The same with every update forced onto 4 threads | 1.34x to 1.67x, median 1.44x | identical |
| Gain from 1 to 4 threads within one version | 5.7: 1.44x to 2.37x (median 1.97x); 5.6: 0.87x to 1.85x (median 1.42x) | |
| Sampled evaluation (response gains and action EVs), one thread | **1.25x to 3.27x** faster, median 1.81x (time reduced by 20% to 69%) | every reported number identical in 10 of 10 cases |
| Exact evaluation (all-seat best response) | 0.79x to 1.06x, median 0.98x | identical in 6 of 6 cases |
| Complete studies, 4 threads | wall time 0.96x to 1.94x, median 1.37x | every per-seed measurement identical in 8 of 8 studies |

## 2. Why several threads did not help in 5.6 (profile)

5.6 traversed the deals of a frozen batch on several threads and did everything else on the calling thread. Measured on the 5.6 binary (`threads.json`, arm `old`, stage seconds the engine reports):

| Game | Threads | deal stage s | traverse s | merge s | wall s (median) |
|---|---|---|---|---|---|
| turn4 | 1 | 0.058 | 0.436 | 0.037 | 0.561 |
| turn4 | 2 | 0.061 | 0.573 | 0.075 | 0.744 |
| turn4 | 4 | 0.059 | 0.470 | 0.088 | 0.647 |
| flop6-jack | 1 | 0.215 | 1.728 | 0.164 | 2.195 |
| flop6-jack | 2 | 0.206 | 1.095 | 0.182 | 1.593 |
| flop6-jack | 4 | 0.199 | 0.691 | 0.194 | 1.188 |
| btn25-open | 1 | 0.432 | 1.136 | 0.343 | 2.030 |
| btn25-open | 2 | 0.426 | 0.815 | 0.383 | 1.691 |
| btn25-open | 4 | 0.431 | 0.574 | 0.423 | 1.562 |
| icm8-bb-call | 1 | 0.775 | 0.348 | 0.035 | 1.230 |
| icm8-bb-call | 2 | 0.756 | 0.342 | 0.035 | 1.196 |
| icm8-bb-call | 4 | 0.753 | 0.341 | 0.035 | 1.222 |

Four causes were found and measured during development (`validation/5.7/profile/`, and the stage seconds above):

1. **Waking the helpers.** One batch of 64 deals is 100 to 1,500 microseconds of traversal. 5.6 woke its helper threads through a condition variable for every batch and put them back to sleep; that costs tens of microseconds per thread. With the 5.6 update unchanged and only the pool replaced (arm `new-legacy` in the development runs, `validation/5.7/performance-development/`), 4 threads went from 0.58 s to 0.49 s on the six-player game and from 0.69 s to 0.53 s on the four-player turn game.
2. **Deals moving between processors.** 5.6 handed deals to whichever thread asked next, so a deal's buffers were written by a different processor in almost every batch and each cache line had to be fetched from another core. With each thread keeping its own contiguous share of the deals (and taking leftover deals only when it is done), the traversal stage of the six-player game went from 0.62 s to 0.48 s with 2 threads and from 0.37 s to 0.26 s with 4.
3. **Serial preparation.** Sampling the deals, scoring the showdown hands and computing the hand-group keys ran on one thread: 9% to 71% of single-thread time on the fixtures (see the deal column above; the eight-handed ICM fixture spends most of its time there). 5.7 keeps only the deal sampling and the interning of keys that are new to the dictionary in order.
4. **Serial merge, reading other processors' caches.** The merge was 4% to 18% of single-thread time and grew with the thread count (the increments lie in the other processors' caches). 5.7 creates new states and rows in order and adds the increments on all threads, partitioned by table row.

What still does not scale: sampling the deals (one random stream, consumed in order), creating new betting states and table rows (their identifiers are assigned in deal order, which is what makes the saved state independent of the thread count), and reading the table rows that another thread has just updated. On a table that is still growing fast these are a large share (three-player preflop fixture: `resolve` below).

## 3. Frozen-batch training, 1, 2 and 4 threads

64 deals per update, per-deal action streams (the mode in which one training uses several threads); 5 repetitions per cell, alternating order, **median** sampled deals per second. "5.7 fixed": every update on all threads offered. "5.7": the measured thread choice (the count it settled on is in brackets).

| Game | Version | 1 thread | 2 threads | 4 threads | 4 threads / 1 thread | 5.7 / 5.6 at 4 threads | Same state |
|---|---|---|---|---|---|---|---|
| six-player flop, weighted ranges (small game) | 5.6 | 227,924 | 257,670 | 337,996 | 1.48x |  | yes |
|  | 5.7 fixed | 235,833 | 332,129 | 463,484 | 1.97x | **1.37x** | yes |
|  | 5.7 | 245,619 | 358,914 | 538,340 [4] | 2.19x | **1.59x** | yes |
| eight-handed ICM final table (small game) | 5.6 | 228,823 | 242,978 | 325,126 | 1.42x |  | yes |
|  | 5.7 fixed | 239,667 | 311,035 | 468,541 | 1.95x | **1.44x** | yes |
|  | 5.7 | 225,732 | 338,535 | 534,475 [4] | 2.37x | **1.64x** | yes |
| four-player turn (small game) | 5.6 | 684,502 | 516,216 | 593,675 | 0.87x |  | yes |
|  | 5.7 fixed | 670,519 | 697,693 | 963,137 | 1.44x | **1.62x** | yes |
|  | 5.7 | 692,542 | 809,481 | 956,521 [4] | 1.38x | **1.61x** | yes |
| five-player flop (small game) | 5.6 | 476,192 | 413,391 | 511,071 | 1.07x |  | yes |
|  | 5.7 fixed | 481,815 | 573,865 | 851,973 | 1.77x | **1.67x** | yes |
|  | 5.7 | 483,225 | 599,911 | 891,368 [4] | 1.84x | **1.74x** | yes |
| six-player flop fixture | 5.6 | 43,736 | 60,272 | 80,808 | 1.85x |  | yes |
|  | 5.7 fixed | 45,584 | 67,586 | 107,939 | 2.37x | **1.34x** | yes |
|  | 5.7 | 42,194 | 69,787 | 108,497 [4] | 2.57x | **1.34x** | yes |
| three-player flop fixture | 5.6 | 98,515 | 121,303 | 144,028 | 1.46x |  | yes |
|  | 5.7 fixed | 91,384 | 135,231 | 199,014 | 2.18x | **1.38x** | yes |
|  | 5.7 | 101,442 | 134,637 | 204,611 [4] | 2.02x | **1.42x** | yes |
| three-player preflop fixture | 5.6 | 94,595 | 113,540 | 122,921 | 1.30x |  | yes |
|  | 5.7 fixed | 95,532 | 140,995 | 193,230 | 2.02x | **1.57x** | yes |
|  | 5.7 | 99,080 | 137,795 | 177,811 [4] | 1.79x | **1.45x** | yes |
| eight-handed ICM fixture | 5.6 | 416,417 | 428,168 | 419,037 | 1.01x |  | yes |
|  | 5.7 fixed | 408,099 | 512,587 | 614,456 | 1.51x | **1.47x** | yes |
|  | 5.7 | 431,222 | 512,070 | 654,526 [4] | 1.52x | **1.56x** | yes |
| three-player flop fixture, Detailed hand groups | 5.6 | 38,335 | 46,594 | 55,560 | 1.45x |  | yes |
|  | 5.7 fixed | 40,214 | 60,923 | 79,251 | 1.97x | **1.43x** | yes |
|  | 5.7 | 40,282 | 55,979 | 77,898 [4] | 1.93x | **1.40x** | yes |

At one thread the frozen-batch update of 5.7 is 0.93x to 1.05x the speed of 5.6 (median 1.01x): the stages are separate passes over the deals, which costs a few percent on the smallest games and saves a little where key computation dominates.

**Stages of the 5.7 update** (seconds over the whole run, every update on the stated number of threads; `deal`, `fixup` and `resolve` are serial):

| Game | Threads | deal | prepare | fixup | traverse | resolve | accumulate | apply | deals whose keys were interned in order |
|---|---|---|---|---|---|---|---|---|---|
| flop6w | 1 | 0.028 | 0.029 | 0.000 | 0.662 | 0.002 | 0.019 | 0.004 | 0 |
| flop6w | 4 | 0.029 | 0.033 | 0.000 | 0.242 | 0.003 | 0.048 | 0.012 | 0 |
| final8w | 1 | 0.040 | 0.035 | 0.000 | 0.692 | 0.001 | 0.013 | 0.002 | 0 |
| final8w | 4 | 0.044 | 0.035 | 0.000 | 0.251 | 0.004 | 0.039 | 0.008 | 0 |
| turn4 | 1 | 0.027 | 0.036 | 0.000 | 0.429 | 0.003 | 0.023 | 0.004 | 0 |
| turn4 | 4 | 0.032 | 0.029 | 0.000 | 0.189 | 0.007 | 0.061 | 0.017 | 0 |
| flop5 | 1 | 0.026 | 0.032 | 0.000 | 0.428 | 0.002 | 0.014 | 0.002 | 0 |
| flop5 | 4 | 0.029 | 0.021 | 0.000 | 0.165 | 0.004 | 0.039 | 0.009 | 0 |
| flop6-jack | 1 | 0.113 | 0.093 | 0.001 | 1.658 | 0.043 | 0.081 | 0.015 | 446 |
| flop6-jack | 4 | 0.114 | 0.036 | 0.001 | 0.518 | 0.049 | 0.081 | 0.019 | 446 |
| flop3-kings | 1 | 0.059 | 0.098 | 0.001 | 1.478 | 0.029 | 0.119 | 0.025 | 464 |
| flop3-kings | 4 | 0.062 | 0.039 | 0.002 | 0.521 | 0.038 | 0.161 | 0.033 | 464 |
| btn25-open | 1 | 0.090 | 0.252 | 0.068 | 1.168 | 0.224 | 0.097 | 0.019 | 54,558 |
| btn25-open | 4 | 0.083 | 0.074 | 0.069 | 0.318 | 0.233 | 0.104 | 0.022 | 54,558 |
| icm8-bb-call | 1 | 0.203 | 0.482 | 0.085 | 0.342 | 0.003 | 0.023 | 0.009 | 84,852 |
| icm8-bb-call | 4 | 0.211 | 0.153 | 0.102 | 0.170 | 0.009 | 0.073 | 0.028 | 84,852 |
| flop3-kings-detailed | 1 | 0.030 | 0.483 | 0.052 | 1.082 | 0.306 | 0.086 | 0.017 | 73,206 |
| flop3-kings-detailed | 4 | 0.030 | 0.158 | 0.087 | 0.374 | 0.329 | 0.120 | 0.021 | 73,206 |

**Thread choice.** With the measured choice, every run above that was offered 4 threads settled on 4 threads. The choice is made from seconds per state visit of whole updates and is re-measured as training goes on; it never changes a result. On a machine where fewer threads are faster it settles on fewer (the in-engine check `mwcli --selftest57` drives it with synthetic costs).

**Memory.** Peak resident memory of these runs: flop6-jack 58 MiB (5.6) / 59 MiB (5.7); btn25-open 155 MiB (5.6) / 156 MiB (5.7); flop3-kings-detailed 220 MiB (5.6) / 221 MiB (5.7). The new per-thread structures (touched-row lists, hand-group keys of the 64 deals, the deal queue) are a few kilobytes to a few megabytes and are outside the table budget, whose accounting is unchanged.

## 4. Training, one deal per update, one thread

`trainbench56.py` with the 5.6 binary as baseline: 300000 sampled deals, 3 repetitions. This is how a study trains each seed; 5.7 did not change this path, and the table is here to show that it did not get slower.

| Fixture | 5.6 deals/s (best) | 5.7 deals/s (best) | Ratio (best) | Ratio (median) | Peak RSS MiB 5.6 / 5.7 | Same state |
|---|---|---|---|---|---|---|
| btn25-open | 104,687 | 102,611 | 0.98x | 0.87x | 176 / 176 | yes |
| btn25-open-small | 894,652 | 830,404 | 0.93x | 1.01x | 78 / 78 | yes |
| flop3-kings | 106,638 | 96,635 | 0.91x | 0.95x | 78 / 78 | yes |
| flop3-kings-detailed | 40,461 | 41,782 | 1.03x | 0.99x | 465 / 465 | yes |
| flop3-kings-small | 672,314 | 672,524 | 1.00x | 0.97x | 465 / 465 | yes |
| flop6-jack | 46,278 | 45,612 | 0.99x | 0.98x | 465 / 465 | yes |
| flop6-jack-small | 192,640 | 198,022 | 1.03x | 0.99x | 465 / 465 | yes |
| icm8-bb-call | 393,394 | 396,231 | 1.01x | 1.12x | 465 / 465 | yes |
| icm8-bb-call-small | 1,163,418 | 1,149,742 | 0.99x | 0.92x | 465 / 465 | yes |
| known-akq-river | 3,090,521 | 3,007,247 | 0.97x | 0.98x | 465 / 465 | yes |

(The JSON keys `v55`/`v56` in `trainbench/summary.json` are the tool's names for "baseline" and "current": here 5.6 and 5.7.)

## 5. Evaluation

The same trained state (both binaries write the same one; checked for every case), the same query, one evaluation thread, 3 repetitions, alternating. Wall seconds of the whole process, median.

| Case | 5.6 s | 5.7 s | Speed-up | Time saved | Results |
|---|---|---|---|---|---|
| 3-player flop (flop3-kings): sampled response gain | 28.78 | 15.27 | **1.88x** | 47% | identical (85 numbers) |
| 3-player preflop (btn25-open): sampled response gain | 22.69 | 15.83 | **1.43x** | 30% | identical (76 numbers) |
| 6-player flop (flop6-jack): sampled response gain | 1.88 | 1.24 | **1.52x** | 34% | identical (172 numbers) |
| 8-handed ICM (icm8-bb-call): sampled response gain | 1.02 | 0.59 | **1.73x** | 42% | identical (76 numbers) |
| 4-player turn (turn4): sampled response gain | 17.90 | 6.68 | **2.68x** | 63% | identical (117 numbers) |
| 5-player flop (flop5): sampled response gain | 21.10 | 6.45 | **3.27x** | 69% | identical (142 numbers) |
| 4-player ICM bubble (bubble4): sampled response gain | 1.32 | 0.65 | **2.02x** | 51% | identical (101 numbers) |
| 3-player flop (flop3-kings): sampled action EV of the study decision | 16.61 | 8.57 | **1.94x** | 48% | identical (152 numbers) |
| 6-player flop (flop6-jack): sampled action EV of the study decision | 1.46 | 0.87 | **1.69x** | 41% | identical (158 numbers) |
| 8-handed ICM (icm8-bb-call): sampled action EV of the study decision | 0.12 | 0.10 | **1.25x** | 20% | identical (106 numbers) |
| 3-player flop small (flop3-kings-small): exact NashConv | 0.02 | 0.02 | **0.95x** | -5% | identical (33 numbers) |
| 4-player turn (turn4): exact NashConv | 0.02 | 0.02 | **1.06x** | 6% | identical (41 numbers) |
| 5-player flop (flop5): exact NashConv | 0.02 | 0.03 | **0.79x** | -27% | identical (49 numbers) |
| 6-player flop (flop6w): exact NashConv | 1.12 | 1.11 | **1.01x** | 1% | identical (57 numbers) |
| 8-handed ICM final table (final8w): exact NashConv | 17.79 | 18.15 | **0.98x** | -2% | identical (73 numbers) |
| 4-player ICM bubble (bubble4): exact NashConv | 1.24 | 1.26 | **0.99x** | -1% | identical (41 numbers) |

**What was found.** A profile of a sampled response gain on the three-player flop fixture (callgrind, `validation/5.7/profile/`): 28% of the instructions rebuilt betting states (`Rules::advance` / `Rules::build`), 23% recomputed pot layouts at terminals (`Rules::pots`), about 10% computed the card code of the board with `std::sort` for every strategy lookup, about 10% was coverage bookkeeping, and 5% copied 440-byte betting states. A betting state depends only on its action path and a pot layout only on its terminal state, yet both were rebuilt on every visit. The trainer had kept such records since 3.8 and 5.6; the evaluators had not.

**What was changed.** Each evaluator keeps the part of the betting tree it has walked (`PathTree`, `action_ev.hpp`): a node is built once, by the same rules calls, and read afterwards, including the pot layout of terminals. The tree is private to one evaluator thread, bounded by 1/64 of the evaluator memory (256 KiB to 8 MiB), and a node that does not fit is rebuilt as before. The card code uses a three-element sorting network and written-out binomials (compared with the 5.6 function for every flop in every order). Instructions of the profiled case fell from 12.3 to 6.7 billion with the tree alone.

**What was not changed.** The sampling: the same random streams, the same draws, the same order of every floating-point operation. That is why the results are identical and not merely close, and why no statistical re-validation of the estimators was needed. The gains are largest where the betting tree below the decision is walked in full for every sample (the small games with two bet sizes) and smallest where a sample is dominated by showdown scoring. Coverage bookkeeping and showdown scoring were left alone. Exact evaluation gains little because 5.6 had already removed its dominant costs (showdown tables, passive runouts).

Sampled estimators against exact values: on the games small enough for an exact best response, the sampled response measure stayed below the exact gain in every case checked and found a share of it that varies widely by game (CONVERGENCE-5.7.md, section 5). A faster evaluator does not make that measure tighter.

## 6. Complete studies

The eight studies of the 5.6 report, identical options, 4 threads, 1 run per binary (alternating order). "Evaluation" is the sum of action-EV and quality seconds over the study's points.

| Study | Wall s 5.6 | Wall s 5.7 | Ratio | Training s 5.6 / 5.7 | Evaluation s 5.6 / 5.7 | Evaluation ratio | Peak RSS MiB 5.6 / 5.7 | Per-seed measurements |
|---|---|---|---|---|---|---|---|---|
| akq-river exact, standard preset | 0.13 | 0.08 | **1.58x** | 0.2 / 0.2 | 0.0 / 0.0 | 1.07x | 9 / 9 | identical (10 points, 260 numbers) |
| 3-player preflop small, sampled, standard preset | 2.30 | 1.31 | **1.76x** | 2.0 / 1.9 | 6.1 / 2.8 | 2.19x | 11 / 14 | identical (30 points, 900 numbers) |
| 3-player flop small, exact, standard preset | 0.95 | 0.94 | **1.02x** | 2.7 / 2.6 | 0.8 / 0.8 | 0.99x | 10 / 11 | identical (30 points, 1220 numbers) |
| 6-player flop, sampled, standard preset | 19.27 | 16.78 | **1.15x** | 33.8 / 36.5 | 35.4 / 23.9 | 1.48x | 228 / 241 | identical (30 points, 1160 numbers) |
| 3-player flop, sampled, standard preset | 183.16 | 94.27 | **1.94x** | 14.2 / 13.9 | 663.2 / 333.4 | 1.99x | 169 / 205 | identical (30 points, 1070 numbers) |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 6.81 | 7.10 | **0.96x** | 0.0 / 0.0 | 13.6 / 14.0 | 0.97x | 102 / 102 | identical (4 points, 112 numbers) |
| 6-player flop small, exact, 2 seeds x 2 budgets | 1.18 | 1.14 | **1.03x** | 0.1 / 0.1 | 2.2 / 2.1 | 1.02x | 21 / 21 | identical (4 points, 172 numbers) |
| 8-handed ICM, sampled, standard preset | 133.17 | 75.49 | **1.76x** | 6.3 / 6.4 | 412.1 / 235.6 | 1.75x | 180 / 181 | identical (40 points, 1080 numbers) |

The four studies that take about a second were measured again with 5 repetitions per binary, alternating (best of 5): akq-river exact, standard preset 0.08 s / 0.08 s (0.99x); 3-player flop small, exact, standard preset 0.90 s / 0.92 s (0.97x); 8-handed ICM small, exact, 2 seeds x 2 budgets 8.08 s / 7.41 s (1.09x); 6-player flop small, exact, 2 seeds x 2 budgets 1.37 s / 1.37 s (1.00x). A single run of a study this short moves by 10% to 30% on this machine.

The two large sampled studies that 5.6 could not speed up (three-player flop and eight-handed ICM: 0.98x and 1.00x against 5.5) are the ones that gain here, because their time is sampled evaluation. Checkpoint overhead: these runs used `checkpoint=off`, as the 5.6 measurements did; the checkpoint code is unchanged in 5.7 (recovery tests: VALIDATION-5.7.md).

## 7. Targets

| Target | Result |
|---|---|
| Meaningful multithreading improvement on representative larger workloads | Met on this machine: 1.34x to 1.56x over 5.6 at 4 threads on the five study fixtures; 1 to 4 threads now gives 1.44x to 2.37x. Not proportional to the thread count: sections 2 and 3 say what remains serial. Unmeasured on the target CPU. |
| At least 20% less sampled-evaluation time | Met: 20% to 69% less in the 10 sampled cases. |
| No unexplained mathematical differences | None found: states byte-identical, evaluations and study measurements identical. |
| No material regression in complete-study performance | Lowest study ratio 0.96x (8-handed ICM small, exact, 2 seeds x 2 budgets). |
| Deterministic checkpoint recovery preserved | Yes (VALIDATION-5.7.md). |

## 8. Regressions and limits

- Cells below 1.00x (median; best-of-repetitions ratio in brackets): 3-player flop small (flop3-kings-small): exact NashConv 0.95x [1.01x]; 5-player flop (flop5): exact NashConv 0.79x [0.96x]; btn25-open 0.87x [0.98x]; flop3-kings 0.95x [0.91x]; icm8-bb-call-small 0.92x [0.99x]. The single-thread training path and the exact evaluator of these cases execute the same code as 5.6 apart from the path tree; the best-of-three ratios of the same cases scatter on both sides of 1.00, which is this machine's noise, not a measured slowdown. Treat any ratio between 0.9x and 1.1x on this page as "no difference shown".
- Frozen-batch training at one thread is up to 7% slower than 5.6 on the smallest games (section 3). Frozen batches are meant for several threads; a study trains with one deal per update.
- Helper threads poll for up to 200 microseconds after their last piece of work before they sleep. On a machine with fewer free processors than threads offered this wastes processor time; the measured thread choice then settles on fewer threads, but the first updates of a call pay for it.
- Two threads gain less than four on some games (the caller and one helper share the serial stages between them); the thread choice measures 4, 2 and 1 and keeps the fastest.
- No measurement with more than 4 threads exists. The target CPU has 8 performance and 8 efficiency cores; nothing was tuned for that layout.
- No GPU measurement of any kind. No CUDA code changed in 5.7.
