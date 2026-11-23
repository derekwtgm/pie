# Performance — EightMax 5.5

Measured with `source/tools/bench55.py` against the **unchanged 5.4 Linux binary**, on the development host:
Intel(R) Xeon(R) Processor @ 2.30GHz, 4 logical processors, 15.7 GiB, Linux-6.18.44-fc-v726-x86_64-with-glibc2.39. This is a shared cloud
container, **not** the target Windows i7 / RTX 4060 Ti computer. No GPU was present. Every run is in
`validation/5.5/performance/runs.jsonl`; nothing here is a prediction for another machine.

## What changed

| Change | Effect on results |
|---|---|
| Seeds of a study train and evaluate side by side (`parallelSeeds`, automatic). 5.4 ran them one after another, and training a single-deal-batch study cannot use more than one thread. | None: results are identical (see agreement below). |
| The evaluator cache is sized from the process memory budget instead of being tied to the table budget. | None: an evaluation's value does not depend on its cache size. |
| Training chunks inside a study adapt (256 to 65,536 updates) instead of a fixed 256 whenever a limit exists. | None: `train(a)` then `train(b)` equals `train(a+b)`. |
| Process memory budget (70% of installed memory by default) bounds the seeds running together and stops a study that exceeds it. | None. |
| **Not changed:** the default trainer. Raw training throughput is the same code as 5.4. | — |

## Complete studies, 4 threads requested

Median of 2 runs each, binaries alternated. "Measurements" are completed of requested (variant x seed x budget).

| Workload | 5.4 wall s | 5.5 wall s | 5.4 / 5.5 | Measurements 5.4 / 5.5 | 5.4 train / EV / quality s (summed) | 5.5 train / EV / quality s (summed) | Peak RSS MiB 5.4 / 5.5 | Seeds side by side (5.5) | Evaluator cache MiB (5.5) |
|---|---|---|---|---|---|---|---|---|---|
| akq-river exact, standard preset | 0.56 | 0.15 | 3.63x | 10/10 / 10/10 | 0.5 / 0.0 / 0.0 | 0.4 / 0.0 / 0.0 | 18 / 18 | 4 | 2239 |
| 3-player preflop small, sampled, standard preset | 5.02 | 2.08 | 2.42x | 30/30 / 30/30 | 2.7 / 0.7 / 1.4 | 2.8 / 2.4 / 2.5 | 18 / 18 | 4 | 2239 |
| 3-player flop small, exact, standard preset | 8.97 | 5.31 | 1.69x | 30/30 / 30/30 | 3.4 / 0.4 / 5.0 | 3.6 / 1.6 / 14.2 | 18 / 18 | 4 | 2239 |
| 6-player flop, sampled, standard preset | 66.00 | 24.76 | 2.67x | 30/30 / 30/30 | 53.5 / 1.3 / 9.2 | 56.2 / 4.5 / 26.8 | 69 / 171 | 4 | 2239 |
| 3-player flop, sampled, standard preset | 266.81 | 170.62 | 1.56x | 30/30 / 30/30 | 20.1 / 10.7 / 235.1 | 19.9 / 41.9 / 567.4 | 117 / 182 | 4 | 2239 |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 22.43 | 8.69 | 2.58x | 4/4 / 4/4 | 0.0 / 2.0 / 20.3 | 0.0 / 3.2 / 13.9 | 1105 / 2360 | 2 | 4096 |
| 6-player flop small, exact, 2 seeds x 2 budgets | 61.80 | 49.72 | 1.24x | 4/4 / 4/4 | 0.2 / 13.5 / 48.1 | 0.1 / 26.1 / 72.9 | 18 / 18 | 2 | 4096 |
| 8-handed ICM, sampled, standard preset | 238.45 | 113.70 | 2.10x | 40/40 / 40/40 | 10.1 / 0.3 / 227.4 | 8.9 / 0.4 / 342.2 | 82 / 167 | 4 | 2239 |

The summed training, EV and quality seconds are per-seed times added up; with seeds running side by side they exceed
the wall time. Peak memory rises because several seeds are resident together and the evaluator cache is larger.

**Numerical agreement.** For every workload both versions' per-seed action EVs, frequencies, standard errors, quality
values, deal counts, row counts and evaluation seeds were compared wherever both completed the measurement:
178 measurements compared, 0 differing.

## Thread scaling of complete studies

| Workload | Threads | 5.4 wall s | 5.5 wall s | 5.4 speed-up vs 1 thread | 5.5 speed-up vs 1 thread | 5.5 seeds side by side | Measurements 5.4 / 5.5 |
|---|---|---|---|---|---|---|---|
| 6-player flop, sampled, standard preset | 1 | 77.26 | 80.73 | 1.00x | 1.00x | 1 | 30/30 / 30/30 |
| 6-player flop, sampled, standard preset | 2 | 66.10 | 41.64 | 1.17x | 1.94x | 2 | 30/30 / 30/30 |
| 6-player flop, sampled, standard preset | 4 | 60.14 | 23.08 | 1.28x | 3.50x | 4 | 30/30 / 30/30 |
| 6-player flop, sampled, standard preset | 8 | 61.99 | 22.50 | 1.25x | 3.59x | 8 | 30/30 / 30/30 |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 1 | 51.84 | 33.87 | 1.00x | 1.00x | 1 | 4/4 / 4/4 |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 2 | 30.01 | 17.40 | 1.73x | 1.95x | 2 | 4/4 / 4/4 |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 4 | 24.56 | 8.72 | 2.11x | 3.89x | 2 | 4/4 / 4/4 |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 8 | 22.88 | 6.41 | 2.27x | 5.28x | 2 | 4/4 / 4/4 |

The host has 4 logical processors, so 8 threads oversubscribe it; that row shows behaviour, not scaling.
Where 5.4's training-dominated studies do not speed up with threads, 5.5 does because whole seeds run in parallel.
Scaling is limited by the number of seeds that fit in the process memory budget and by memory bandwidth.

## Checkpoint overhead (six-player flop, Standard preset)

| Checkpointing | Wall s (median) | Commits | Engine states written | MiB written | Seconds writing |
|---|---|---|---|---|---|
| off | 23.60 | 0 | 0 | 0.0 | 0.00 |
| default (60 s + stage boundaries) | 23.75 | 62 | 30 | 155.0 | 1.55 |
| every 1 s + stage boundaries | 25.36 | 110 | 78 | 461.0 | 4.73 |

## Raw training throughput (one thread, default trainer)

| Fixture | Deals | 5.4 deals/s (median of 3) | 5.5 deals/s (median of 3) | 5.5 / 5.4 | State files identical |
|---|---|---|---|---|---|
| btn25-open | 200,000 | 71,370 | 69,912 | 0.98 | yes |
| flop6-jack | 100,000 | 36,594 | 29,997 | 0.82 | yes |
| icm8-bb-call | 200,000 | 268,913 | 278,948 | 1.04 | yes |
| flop3-kings | 200,000 | 71,290 | 79,717 | 1.12 | yes |

The default trainer was not optimised in 5.5: the ratio is noise around 1. Deals per second of training did not improve.

## Exact evaluation and the evaluator cache

Single exact all-seat best-response evaluations (`mwcli --gain`, one thread), same state, same result to the last digit:

| Game | Evaluator cache 128 MiB | 256 MiB | 1,024 MiB |
|---|---|---|---|
| Four-player ICM bubble (research game `bubble4`) | 44.1 s | 3.0 s | 1.2 s |
| Eight-handed ICM, small companion fixture | 50.8 s | 26.5 s | 7.6 s |

(`validation/5.5/performance/evaluator-cache.md` holds the commands and outputs.) With a small cache the showdown
tables are evicted and rebuilt. This is why 5.4 measured 64–71 s per ICM checkpoint. 5.5 studies now give the
evaluator the unused share of the process budget; the research runner uses 1,024 MiB.

## Profile

Function-level profiles (`gprof`, `-O2 -pg`, one thread; instrumentation inflates absolute times):

| Workload | Where the time goes |
|---|---|
| Exact all-seat response, six-player flop companion fixture | `Evaluator::seatScore` 31%, `brRec` (best-response recursion) 24%, `Evaluator::scored` 22%, `utilityWithScores` 13%, betting-state construction 3%, hand ranking 4%. About 1.2 billion terminal utility evaluations over joint opponent holdings. |
| Exact all-seat response, eight-handed ICM companion fixture (256 MiB cache) | `Evaluator::scoreChunk` (showdown-table construction: board enumeration, rank patterns, histogram) 71%, `evalMasks` (seven-card ranking, 1.74 billion calls) 29%. ICM equity itself is negligible (3,969 calls). |
| A Standard study on the large sampled fixtures (5.4) | Training 74% on the six-player flop fixture; exact quality 75–91% on the small exact companions (time-limited). |
| Training inside a study | Single-threaded for every shipped fixture (single-deal batches with a shared action stream), which is why threads did not help 5.4 studies. |

Stages not separately profiled: chance sampling, card-conflict rejection, information-set lookup, regret and
average-strategy accumulation, memory allocation and thread synchronisation inside the trainer. The engine's own
stage timers for training are only populated on profiled updates and were not broken down further, because the
default trainer was left unchanged. Checkpoint serialisation is measured in the checkpoint-overhead table.


## Equal-time strategy quality

The default trainer is unchanged, so default strategy quality at equal time is unchanged (the 5.5 default against the
5.4 baseline is unresolved in every equal-time contrast and identical at equal deals; `CONVERGENCE-5.5.md`). The
opt-in candidate is better per deal and not reliably better per second.

## Negative and inconclusive results

- Training throughput (deals per second): no improvement; none was attempted in the trainer's inner loop.
- The six-player exact response profile is dominated by terminal utility evaluation over joint opponent holdings; no
  restructuring was attempted, so a single exact six-player evaluation is as slow as in 5.4 apart from cache effects.
- The showdown scoring kernel (about 70% of exact eight-handed ICM evaluation with a large cache) was profiled but not
  rewritten.
- Peak memory is higher in 5.5 by design.
- No GPU was available: GPU and hybrid performance are unmeasured, and no CUDA kernel was added or changed.
- Windows timings were not measured.
