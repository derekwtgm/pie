# EightMax 4.3 validation evidence

Generated in the development environment: Linux, 4 logical CPUs, GCC 13, MinGW-w64 GCC 13,
Wine 9.0. **No NVIDIA GPU and no physical Windows desktop.** Files marked *double* use the
Linux CUDA driver test double (simulated driver; NOT physical GPU validation).

| File | Content |
|---|---|
| `regression-tests.json` / `.txt` | full suite on the release build: 404 passed, 0 failed, 0 skipped, 0 timed out |
| `baseline42-regression.json` / `.txt` | the unmodified 4.2 suite on 4.2 in the same environment: 389 passed, 0 failed |
| `bench43.json` / `.log` | 4.2 vs 4.3 on identical workloads, 5 runs per row (CPU only) |
| `bench43-interleaved-ab.txt` | 11 interleaved runs for the rows that looked slower |
| `convergence43.json` / `.log` | 10-seed convergence study, exact NashConv, Holm over 160 comparisons |
| `coverage43.json` | 116 coverage checks, 100k-2M information sets, 1-16 workers |
| `table43-units.json` | fullPattern, FlatHist, Automatic cost model, cache eviction |
| `table43-lifecycle-double.json` | *double*: background open, idle buffer release, reuse |
| `session-ev-gpu-double.json`, `session-ev-hybrid-double.json`, `session-ev-auto-double.json`, `session-gain-gpu-double.json` | *double*: one process, cold/warm/sequential/concurrent/idle/cancelled/refused requests |
| `cuda-matrix-double.txt` | *double*: cpu/gpu/hybrid/auto x 1/2/4/8 threads and 9 injected faults x gpu/hybrid: identical EVs, 0 invalid-context calls |
| `native-continuation.json` | 128 MB eight-seat checkpoint: resumed SHA-256 = uninterrupted SHA-256 |
| `native-host-linux.json`, `native-mw-linux.json`, `explorer-host-linux.json`, `checkpoint-sizes.json`, `native-restore-sizes.json`, `*_smoke.log` | inherited release checks, re-run on 4.3 |
| `windows-release.ps1` | used by `Run self-tests.bat` |

Wine (Windows executables, CPU): 4.2 and 4.3 `mwcli.exe` give identical exact EVs and eight-seat
exact gains for 1 and 4 threads; 4.3 scores one table (376,992 boards) where 4.2 scored 753,984
on 4 threads; the 4.3 session mode runs.

## 4.2 vs 4.3 benchmark (median seconds, end-to-end process time, 4 CPUs)

| Workload | 4.2 | 4.3 | 4.2/4.3 | numbers identical |
|---|---:|---:|---:|---|
| Heads-up equity (preflop) | 0.544 | 0.548 | 0.99 | yes |
| Three-player equity (preflop) | 0.421 | 0.438 | 0.96 | yes |
| Six-player equity (preflop) | 0.186 | 0.184 | 1.01 | yes |
| Eight-player equity (preflop) | 0.100 | 0.098 | 1.02 | yes |
| Exact action EV, 8-player root (ICM), 1 thread(s) | 0.076 | 0.065 | 1.18 | yes |
| Exact action EV, 8-player root (ICM), 2 thread(s) | 0.075 | 0.045 | 1.65 | yes |
| Exact action EV, 8-player root (ICM), 4 thread(s) | 0.078 | 0.028 | 2.76 | yes |
| Exact action EV, three-player flop with linked turn/river, two hands | 0.217 | 0.204 | 1.06 | yes |
| Exact action EV, four-player turn, three hands (side pots) | 0.176 | 0.191 | 0.92 | yes |
| Exact action EV, 8-player after two shoves (ICM) | 0.066 | 0.024 | 2.80 | yes |
| Exact action EV, 2 hands per seat, root range (ICM) [1 run] | 22.314 | 10.216 | 2.18 | yes |
| Sampled action EV, 8-player (seed 4) | 0.411 | 0.418 | 0.98 | yes |
| Large weighted range, heads-up river exact | 0.004 | 0.004 | 1.05 | yes |
| Exact response gains, 8 seats (ICM), 1 thread(s) | 0.551 | 0.108 | 5.10 | yes |
| Exact response gains, 8 seats (ICM), 2 thread(s) | 0.301 | 0.063 | 4.78 | yes |
| Exact response gains, 8 seats (ICM), 4 thread(s) | 0.160 | 0.041 | 3.94 | yes |
| Exact response gains, three-player flop, all seats | 0.416 | 0.341 | 1.22 | yes |
| Exact response gains, four-player turn, all seats | 0.429 | 0.447 | 0.96 | yes |
| Restricted response gains, 8 seats (sampled selection) | 0.046 | 0.047 | 0.97 | yes |
| Sampled one-decision gains, 8 seats | 0.519 | 0.557 | 0.93 | yes |
| GPU requested, no usable GPU here: CPU fallback | 0.074 | 0.039 | 1.89 | yes |

| Training (state SHA-256 compared) | 4.2 | 4.3 | identical state |
|---|---:|---:|---|
| Six-player flop solving (2 hands per seat, side pots) | 0.020 | 0.020 | yes |
| Four-player turn solving (side pots) | 0.013 | 0.014 | yes |
| Heads-up river | 0.006 | 0.006 | yes |
| Three-player river | 0.009 | 0.009 | yes |
| Six-player flop (grouped fixture) | 0.017 | 0.017 | yes |
| Eight-player preflop (fixture, full ranges) | 0.161 | 0.150 | yes |
| Short-stack multiway all-ins (8 seats, ICM) | 0.023 | 0.022 | yes |
| Tournament bubble ICM (3 seats, side pots) | 0.007 | 0.008 | yes |
| Eight-player final-table ICM (fixture spec) | 0.018 | 0.019 | yes |

In-process sessions (4.3 only, `mwcli --session`):

* Exact EV session (cpu, 4 threads): first median 24.9 ms; ten sequential median 20.2 ms; four concurrent background evaluations median 64.5 ms (mismatches 0)
* Exact response-gain session (cpu, 4 threads): first median 37.2 ms; ten sequential median 34.2 ms; four concurrent background evaluations median 109.9 ms (mismatches 0)

Interleaved A/B (11 runs each, `bench43-interleaved-ab.txt`): four-player turn EV and gains and
three-player equity within +/-2%; **sampled one-decision gains about 5% slower in 4.3** (0.530 ->
0.558 s; about 2% of it measured to come from the coverage-table changes; the rest not isolated).
This is the one reproducible regression found.

## Convergence study summary (Holm-adjusted, family-wise 5%)

**Eight-player preflop push/fold, fixed hands (ICM)** (checkpoints 4000, 20000, 50000, 100000, 250000, 500000 sampled deals)

| Variant | NashConv at last checkpoint, mean (median) | equal samples | equal time |
|---|---|---|---|
| linear (default) | 5.5e-07 (2.11e-07) +/- 6e-07 | - | - |
| baseline | 3.49e-07 (1.03e-07) +/- 3.3e-07 | no supported difference | no supported difference |
| expectation | 4.96e-07 (1.26e-07) +/- 5.1e-07 | no supported difference | no supported difference |
| baseline+expectation | 3.49e-07 (1.03e-07) +/- 3.3e-07 | no supported difference | no supported difference |
| rm-plus | 0.042 (0.042) +/- 0.00041 | variant worse | variant worse |
| dcfr-1-1-2 | 1.59e-09 (1.93e-10) +/- 2.4e-09 | no supported difference | variant better |

**Three-player river, side pots (ICM)** (checkpoints 4000, 20000, 50000, 100000, 250000, 500000 sampled deals)

| Variant | NashConv at last checkpoint, mean (median) | equal samples | equal time |
|---|---|---|---|
| linear (default) | 0.0605 (0.0573) +/- 0.0098 | - | - |
| baseline | 0.0434 (0.0454) +/- 0.0068 | no supported difference | no supported difference |
| expectation | 0.0496 (0.0451) +/- 0.0083 | no supported difference | no supported difference |
| baseline+expectation | 0.0434 (0.0454) +/- 0.0068 | no supported difference | no supported difference |
| rm-plus | 0.198 (0.199) +/- 0.003 | variant worse | variant worse |
| dcfr-1-1-2 | 0.0915 (0.0926) +/- 0.017 | no supported difference, variant worse | no supported difference, variant worse |

**Four-player turn, unequal stacks, side pots (chip EV), two bet sizes** (checkpoints 2000, 10000, 40000, 100000 sampled deals)

| Variant | NashConv at last checkpoint, mean (median) | equal samples | equal time |
|---|---|---|---|
| linear (default) | 1.49 (1.5) +/- 0.072 | - | - |
| baseline | 1.46 (1.48) +/- 0.072 | no supported difference | no supported difference |
| expectation | 1.46 (1.48) +/- 0.057 | no supported difference | no supported difference |
| baseline+expectation | 1.47 (1.44) +/- 0.076 | no supported difference | no supported difference |
| rm-plus | 2.49 (2.47) +/- 0.034 | no supported difference, variant worse | no supported difference, variant worse |
| dcfr-1-1-2 | 1.6 (1.6) +/- 0.087 | no supported difference, variant worse | no supported difference, variant worse |

Verdict: no variant better on every game; the default is retained (training unchanged).
