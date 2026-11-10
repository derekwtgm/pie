# Large-game benchmark 3.2

Each run includes one independently trained unilateral response for the seat identified in its JSON record. The interval covers holdout sampling uncertainty. Root frequency dispersion is the mean across actions of the sample standard deviation across seeds. It measures stability. Elapsed time is training only. RSS is a process high-water mark.

| Scenario | Engine | Target ms | Seeds | Mean deals/s | Root dispersion |
|---|---|---:|---:|---:|---:|
| six-player flop, unequal stacks | JavaScript external sampling | 2000 | 5 | 1166.0 | 0.01091 |
| six-player flop, unequal stacks | JavaScript external sampling | 8000 | 5 | 1162.9 | 0.01476 |
| six-player flop, unequal stacks | 3.2 native external sampling, shared stream, 1 thread | 2000 | 5 | 8527.7 | 0.01794 |
| six-player flop, unequal stacks | 3.2 native external sampling, shared stream, 1 thread | 8000 | 5 | 7567.2 | 0.02858 |
| six-player flop, unequal stacks | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 2000 | 5 | 14246.4 | 0.01103 |
| six-player flop, unequal stacks | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 8000 | 5 | 11842.1 | 0.01190 |
| eight-player linked preflop to river, 25 bb | JavaScript external sampling | 2000 | 5 | 1302.6 | 0.01750 |
| eight-player linked preflop to river, 25 bb | JavaScript external sampling | 8000 | 5 | 1459.5 | 0.00840 |
| eight-player linked preflop to river, 25 bb | 3.2 native external sampling, shared stream, 1 thread | 2000 | 5 | 11127.7 | 0.01642 |
| eight-player linked preflop to river, 25 bb | 3.2 native external sampling, shared stream, 1 thread | 8000 | 5 | 10317.7 | 0.01420 |
| eight-player linked preflop to river, 25 bb | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 2000 | 5 | 16245.0 | 0.01977 |
| eight-player linked preflop to river, 25 bb | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 8000 | 5 | 16529.7 | 0.01185 |
| eight-player final table shove/call ICM | JavaScript external sampling | 2000 | 5 | 3000.5 | 0.01799 |
| eight-player final table shove/call ICM | JavaScript external sampling | 8000 | 5 | 2963.7 | 0.01107 |
| eight-player final table shove/call ICM | 3.2 native external sampling, shared stream, 1 thread | 2000 | 5 | 12520.6 | 0.01436 |
| eight-player final table shove/call ICM | 3.2 native external sampling, shared stream, 1 thread | 8000 | 5 | 14592.2 | 0.01306 |
| eight-player final table shove/call ICM | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 2000 | 5 | 13974.5 | 0.02309 |
| eight-player final table shove/call ICM | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 8000 | 5 | 14750.2 | 0.00919 |
| bubble ICM, five left, four paid, shove/call | JavaScript external sampling | 2000 | 5 | 9301.4 | 0.01689 |
| bubble ICM, five left, four paid, shove/call | JavaScript external sampling | 8000 | 5 | 9507.7 | 0.01048 |
| bubble ICM, five left, four paid, shove/call | 3.2 native external sampling, shared stream, 1 thread | 2000 | 5 | 101375.3 | 0.01573 |
| bubble ICM, five left, four paid, shove/call | 3.2 native external sampling, shared stream, 1 thread | 8000 | 5 | 116954.3 | 0.01326 |
| bubble ICM, five left, four paid, shove/call | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 2000 | 5 | 127811.5 | 0.01380 |
| bubble ICM, five left, four paid, shove/call | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 8000 | 5 | 129729.2 | 0.01637 |
| four-way short-stack flop all-ins | JavaScript external sampling | 2000 | 5 | 15005.3 | 0.02069 |
| four-way short-stack flop all-ins | JavaScript external sampling | 8000 | 5 | 15422.4 | 0.01687 |
| four-way short-stack flop all-ins | 3.2 native external sampling, shared stream, 1 thread | 2000 | 5 | 59246.4 | 0.01286 |
| four-way short-stack flop all-ins | 3.2 native external sampling, shared stream, 1 thread | 8000 | 5 | 55287.4 | 0.01065 |
| four-way short-stack flop all-ins | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 2000 | 5 | 66298.5 | 0.01202 |
| four-way short-stack flop all-ins | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 8000 | 5 | 52870.1 | 0.01167 |
| six-player linked preflop to river with ICM | JavaScript external sampling | 2000 | 5 | 2238.6 | 0.01848 |
| six-player linked preflop to river with ICM | JavaScript external sampling | 8000 | 5 | 2229.8 | 0.01561 |
| six-player linked preflop to river with ICM | 3.2 native external sampling, shared stream, 1 thread | 2000 | 5 | 18580.7 | 0.01303 |
| six-player linked preflop to river with ICM | 3.2 native external sampling, shared stream, 1 thread | 8000 | 5 | 16035.9 | 0.02076 |
| six-player linked preflop to river with ICM | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 2000 | 5 | 21692.8 | 0.01274 |
| six-player linked preflop to river with ICM | 3.2 native external sampling, per-deal streams, batch 16, 4 threads | 8000 | 5 | 20306.6 | 0.01411 |
