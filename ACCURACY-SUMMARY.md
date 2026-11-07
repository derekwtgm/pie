# Accuracy and performance — EightMax 2.9

Current results are in RELEASE-2.9.md §2–3 and validation/2.9/
(accuracy-per-deal.json: six seeds, exact best responses, 4k–500k sampled deals,
2.8 JS vs 2.9 native; performance-2.8-vs-2.9.json: nine configurations, three
fresh-process repeats, identical EVs). Measured on an Intel Xeon @ 2.1 GHz,
4 cores, Linux; not on the intended Windows i7/RTX desktop. The sections
below are the earlier 2.7 report, kept for reference.

# Accuracy and performance — EightMax 2.7

All values below were calculated in this session on INTEL(R) XEON(R) PLATINUM 8573C / linux. These are not measurements of the requested Intel i7 or RTX GPU.

## Three-player river: exact unilateral response gain (BB)

The original 2.6 configuration is preserved: pot 12 BB, stacks 30/30/30, eight listed hands per seat, 50%/125% bets, 2.5x raise, two-bet cap. Three seeds (1, 2, 3) for each sampled mode; mean ± 95% Student-t interval half-width. Every strategy is evaluated with exact best responses in that restricted game.

| Updates | 2.6, one deal | 2.7, four-deal batch | Experimental batch CFR+ | Exact solver |
|---:|---:|---:|---:|---:|
| 1,000 | 1.023126 ± 0.429336 | 0.386157 ± 0.101505 | 0.835273 ± 0.139514 | 0.001585 |
| 5,000 | 0.394345 ± 0.230852 | 0.200321 ± 0.104823 | 0.395751 ± 0.027703 | 0.000292 |
| 10,000 | 0.251409 ± 0.076479 | 0.108377 ± 0.051038 | 0.285561 ± 0.005545 | 0.000279 |
| 25,000 | 0.147424 ± 0.079034 | 0.085591 ± 0.022103 | 0.179161 ± 0.017096 | 0.000421 |
| 50,000 | 0.100517 ± 0.020623 | 0.050205 ± 0.018068 | 0.129702 ± 0.003588 | 0.000211 |
| 100,000 | 0.081510 ± 0.071846 | 0.036027 ± 0.014680 | 0.092532 ± 0.001925 | 0.000160 |
| 250,000 | 0.043770 ± 0.010669 | 0.027785 ± 0.016566 | 0.061642 ± 0.001132 | 0.000164 |

The four-deal batch has a lower observed mean gain at each tested update budget. It uses four times as many sampled deals per update. At 250,000 updates the intervals overlap; this small experiment does not establish a general accuracy or efficiency advantage. CFR+ performed worse and is not the default. The 2.7 one-deal compatibility mode reproduced all 21 original gain vectors exactly.

At 250,000 updates: 2.6 sampled mean training time 12.29 s; 2.7 batch mean 70.62 s; experimental CFR+ 75.48 s; exact solver 337.96 s. Timings were collected while other validation processes were running, so they are not controlled speedup comparisons.

The exact solver enumerates the chance space, while sampled modes only observe random subsets and therefore need many more updates. No incorrect sampling weight was established in the existing full/external traversal audit. Batched, frozen updates reduce variance of each increment; they do not remove card/betting abstraction error. Exact multiplayer gain need not decrease monotonically.

## CPU and memory

| Native threads | 200-update turn solve (seconds) | Reported exploitability (% pot) |
|---:|---:|---:|
| 1 | 5.639 | 0.0371 |
| 4 | 2.902 | 0.0370 |

One run per thread count, CPU only, with HTTP/polling overhead. Float32 parallel reductions can cause small differences. This is a functional parallelism benchmark, not an i7 speedup guarantee.

| Sampled study (existing one-deal mode) | Median updates/s, two runs | Peak process RSS (MiB) |
|---|---:|---:|
| 6-player flop, 2 sizes + raise per street | 195 | 138.8 |
| 7-player flop, 2 sizes + raise per street | 366 | 146.7 |
| 8-player flop, 2 sizes + raise per street | 260 | 151.6 |
| 8-player river, 2 sizes + raise | 974 | 95.4 |
| 6-player linked preflop-river, random ranges, 25 bb | 383 | 153.3 |
| 8-player linked preflop-river, random ranges, 25 bb | 516 | 226.4 |
| 8-player linked ICM 50/30/20, random ranges, 25 bb | 325 | 235.8 |

Those memory measurements are for the reported finite benchmarks, not a guarantee that every configuration fits 16 GB. A new batched eight-player stress test also verifies stopping at a 1 MiB strategy budget and deterministic recovery after raising the budget. Native allocation-limit rejection at 32 MiB is separately tested.

## Validation scope

* 136 automated JavaScript regression tests passed, including all original 127.
* Native Linux host: known river equilibrium, request validation, saved-file handling, cancellation and responsive server checks. AddressSanitizer/UndefinedBehaviorSanitizer integration run also passed on the same native source; its build predates the final UI-only budget correction.
* Three through eight players: 1,000 four-deal updates and 500 response-training updates per seat, plus exact checks for each compact river tree. Full configurations, gains and sampling standard errors are in multiplayer.json. These are small restricted games, not broad eight-player equilibrium validation.
* ACCURACY.json additionally checks independent push/fold and ICM oracles, known two-player equilibrium, JS/WebAssembly agreement, and sampled/exact river checks. The report was run in its quick mode, which is recorded in the JSON.
* Windows PE executable rebuilt from current source; native/UI build identifiers must match. No execution on physical Windows, Wine, Intel i7 or NVIDIA hardware is claimed.
* CUDA is not implemented. Any GPU-emulator results concern the retained OpenCL path on a CPU and cannot establish hardware correctness or speedup.
* No chart recalibration, new depth-limited solver, automatic durable autosave or full eight-player equilibrium certification is claimed. See RELEASE-2.7.md.

Raw logs and machine-readable results are in validation/2.7. Previous validation/2.6 results are historical only.

## Equal sampled-deal budgets

| Total sampled deals | 2.6 mean gain (BB) | 2.7 frozen batch mean gain (BB) |
|---:|---:|---:|
| 4,000 | 0.448456 ± 0.099210 | 0.386157 ± 0.101505 |
| 20,000 | 0.161409 ± 0.089330 | 0.200321 ± 0.104823 |
| 40,000 | 0.117177 ± 0.053902 | 0.108377 ± 0.051038 |
| 100,000 | 0.081510 ± 0.071846 | 0.085591 ± 0.022103 |
| 200,000 | 0.047355 ± 0.003778 | 0.050205 ± 0.018068 |
| 400,000 | 0.035968 ± 0.005581 | 0.036027 ± 0.014680 |
| 1,000,000 | 0.034639 ± 0.041999 | 0.027785 ± 0.016566 |

At equal sampled-deal budgets the results are mixed. Freezing a policy for a batch reduces the variance of that update but also makes fewer policy updates. This experiment establishes no general advantage per deal or per second. Keep one-deal mode for compatibility and compare measured gains for your own studies. The presets trade more work per update for the lower per-update gains shown above; they are not a speed improvement claim.
