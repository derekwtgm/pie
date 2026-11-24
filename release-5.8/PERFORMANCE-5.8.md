# Performance — EightMax 5.8 against 5.7.1

Build `d4001e2c0cd77f41` against the unchanged 5.7.1 binary (build `65e835e6b7060960`).

**Where everything in this document was measured:** a shared Linux cloud container, 4 logical processors (Intel
Xeon, 2.1 GHz), 15 GiB, **no GPU**. Not the target PC (Windows 11, Core i7-13700F with 16 cores and 24 threads,
16 GB, RTX 4060 Ti 8 GB). Seconds measured here do not transfer to that PC; ratios between two binaries on the same
machine transfer better, and deterministic instruction counts transfer exactly. **No GPU figure in this document was
measured for 5.8**; section 6 quotes the 5.7 run on the target PC and says so each time.

## 1. Summary

| Question | Answer | Where |
|---|---|---|
| Is training faster than in 5.7.1? | **No.** Same states; timed speed ratio 0.91 to 1.05 (not resolved by timing); in instructions 0.02% fewer to 1.05% more on the shipped fixtures (median 0.16% more) | 3 |
| Except? | Eight-handed ICM final tables with a small table budget: 10% and 4% fewer instructions; 0.7% to 2.2% fewer with larger budgets | 5.1 |
| Is evaluation faster? | **No.** Identical results; timed ratio 0.86 to 1.08, median 0.99; the exact evaluation of the eight-handed ICM final table is 5.8% faster | 4 |
| Are complete studies faster? | No measurable change (identical measurements; the long studies 1.5% to 6.5% faster in single runs) | 7 |
| Were multiway postflop calculations optimised? | Profiled from three to eight players; one optimisation tried and rejected; **no speed-up** | 2 |
| Is CPU multithreading more efficient? | Unchanged for training (frozen batches on four threads: 0.97 to 1.06 times the deals per second of 5.7.1). The new evaluation runs on several threads with identical bits; its speed-up was not benchmarked | 6 |
| Was CUDA changed? | No | 6 |
| What is new and costs time? | The trained response: 2 seconds to 2 minutes for all seats of a shipped fixture with 1,000,000 response deals per seat | 4.1 |
| What became much faster? | The failure of an over-limit study: under a millisecond instead of minutes to hours | 8 |
| Regressions | up to 1.05% more instructions per training on small ICM games | 3, 5.1 |

## 2. Where a training spends its work, from three to eight players

Deterministic counts (valgrind callgrind and cachegrind; default trainer, one thread, 20,000 deals; 5,000 for the
eight-handed game). `validation/5.8/performance/profile58.py`, `profile.json`.

| Game | Seats | Table MiB | State visits per deal | Instructions per deal | per visit | First-level data-cache misses per deal | Last-level misses per deal | Largest shares of the instructions |
|---|---|---|---|---|---|---|---|---|
| mid3-turn | 3 | 1.0 | 45 | 20,172 | 450 | 92 | 2.9 | Walker::learn 33%, Walker::policy 15%, Walker::descendP 11%, merge 9% |
| turn4 | 4 | 0.3 | 46 | 19,194 | 420 | 51 | 1.6 | Walker::learn 36%, Walker::policy 17%, Walker::descendP 11%, merge 8% |
| flop5 | 5 | 0.1 | 73 | 24,592 | 338 | 39 | 1.3 | Walker::learn 38%, Walker::policy 17%, Walker::descendP 14%, merge 7% |
| flop6w | 6 | 0.1 | 135 | 39,076 | 290 | 240 | 2.7 | Walker::learn 39%, Walker::policy 18%, Walker::descendP 17%, merge 5% |
| flop3-kings | 3 | 5.0 | 117 | 51,609 | 439 | 545 | 9.5 | Walker::learn 35%, Walker::policy 13%, Walker::descendP 12%, merge 9% |
| flop6-jack | 6 | 9.1 | 237 | 98,704 | 417 | 1097 | 31.1 | Walker::learn 35%, Walker::policy 14%, Walker::descendP 12%, merge 5% |
| final8w | 8 | 0.1 | 109 | 49,643 | 456 | 153 | 2.1 | Walker::learn 35%, Walker::policy 18%, Walker::descendP 10%, evaluate 9% |

Reading:

1. **The profile is flat and has the same shape for every number of players.** The traversal itself
   (`Walker::learn`), the strategy lookup (`Walker::policy`) and the child-state lookup (`Walker::descendP`) are
   60% to 75% of the instructions from three to eight seats; merging the increments 5% to 9%; ICM 9% on the
   eight-handed game. No single routine is a bottleneck that could be removed.
2. **Work per deal grows with the number of state visits**, not with the number of seats as such: 45 visits per
   deal on the three-player turn game, 237 on the six-player flop fixture. Instructions per visit stay between 290
   and 460.
3. **On the realistic fixtures memory access dominates, not instructions.** The six-player flop fixture has about a
   thousand first-level cache misses per deal after only 20,000 deals (9 MiB of tables); longer studies have tables
   of 15 to 320 MiB (section 3), and every strategy lookup is then a chain of dependent reads that miss the caches.
   During development a state visit cost about 90 ns on a 16 MiB table and 23 ns on a table that fits the cache
   (`validation/5.8/experiments/compact-row-offsets.md`); section 3 shows the resulting deals per second: 32,000 on
   the six-player flop fixture against 200,000 on its small version.

**What was tried.** A compact copy of the row offsets, so that an opponent's strategy lookup reads one cache line
less. On an idle machine it gave -2.3% on the six-player flop fixture and +3.0% and +3.8% on two three-player
fixtures, all inside the 10% run-to-run spread, and the simulated first-level misses did not fall
(`validation/5.8/experiments/compact-row-offsets.md`; the first, apparently favourable, measurement was taken while
another process was running and was discarded). **Not adopted.**

**What was not done.** No multiway optimisation of the trainer was found that passed validation, and none ships.
The remaining candidates change the table layout (fewer dependent reads per lookup) and with it the memory
accounting — the update at which a table budget is reached — so they are not bit-compatible optimisations and need
their own validation plan. This objective of 5.8 produced a profile and a rejected experiment, not a speed-up.

## 3. Training throughput against 5.7.1 (default trainer, one thread)

`source/tools/trainbench56.py`: every shipped fixture, 300,000 deals, both binaries alternating, wall seconds.
Output: `validation/5.8/performance/train/`. Expectation before measurement: no difference except on ICM fixtures
(5.8 changed no trainer code path other than the ICM cache); every state must be byte-identical.

| Fixture | Seats | Deals | Table MiB | 5.7.1: best seconds (median) | 5.8: best seconds (median) | 5.8 deals per second (best) | Speed 5.8 / 5.7.1: best | median | Identical state |
|---|---|---|---|---|---|---|---|---|---|
| btn25-open | 3 | 300,000 | 136.2 | 3.92 (4.00) | 3.88 (3.92) | 77,391 | 1.010 | 1.019 | yes |
| btn25-open-small | 3 | 300,000 | 0.1 | 0.32 (0.33) | 0.32 (0.32) | 948,785 | 0.999 | 1.015 | yes |
| flop3-kings | 3 | 300,000 | 14.8 | 3.40 (3.66) | 3.55 (3.78) | 84,591 | 0.958 | 0.967 | yes |
| flop3-kings-detailed | 3 | 300,000 | 323.8 | 9.85 (10.76) | 10.15 (10.28) | 29,570 | 0.971 | 1.046 | yes |
| flop3-kings-small | 3 | 300,000 | 0.1 | 0.43 (0.46) | 0.44 (0.49) | 681,744 | 0.967 | 0.940 | yes |
| flop6-jack | 6 | 300,000 | 20.5 | 9.31 (9.55) | 9.25 (9.47) | 32,440 | 1.007 | 1.009 | yes |
| flop6-jack-small | 6 | 300,000 | 0.2 | 1.41 (1.50) | 1.50 (1.54) | 199,371 | 0.938 | 0.976 | yes |
| icm8-bb-call | 3 | 300,000 | 13.2 | 0.86 (0.90) | 0.90 (0.99) | 332,666 | 0.951 | 0.907 | yes |
| icm8-bb-call-small | 3 | 300,000 | 0.1 | 0.24 (0.26) | 0.25 (0.25) | 1,214,821 | 0.980 | 1.030 | yes |
| known-akq-river | 2 | 300,000 | 0.1 | 0.10 (0.10) | 0.10 (0.10) | 3,145,973 | 0.999 | 0.965 | yes |

Speed ratio 5.8 / 5.7.1 over the 10 fixtures: best-of-repetitions 0.938 to 1.010 (median 0.976); median-of-repetitions 0.907 to 1.046 (median 0.992). 5 repetitions per binary, order alternated.

Reading: every state is byte-identical to 5.7.1's. The timed ratios scatter between 0.91 and 1.05 with a median of
0.98 to 0.99; the run-to-run spread of one binary on this machine is of the same size (compare the best and the
median seconds of one column). **These timings do not resolve a difference between the two binaries.** Because
"probably the same" is not a measurement, the same trainings were counted in instructions, which are deterministic:

| Fixture | Seats | Instructions for 20,000 deals: 5.7.1 | 5.8 | Ratio 5.8 / 5.7.1 | Peak resident MiB after 300,000 deals: 5.7.1 / 5.8 | Table MiB | Identical states |
|---|---|---|---|---|---|---|---|
| btn25-open-small | 3 | 245,792,140 | 246,428,203 | 1.0026 | 15.3 / 15.4 | 0.1 | yes |
| btn25-open | 3 | 876,625,419 | 876,905,297 | 1.0003 | 175.5 / 175.4 | 136.2 | yes |
| flop3-kings-detailed | 3 | 2,159,290,673 | 2,158,829,547 | 0.9998 | 356.2 / 356.2 | 323.8 | yes |
| flop3-kings-small | 3 | 342,777,893 | 343,414,295 | 1.0019 | 17.8 / 17.8 | 0.1 | yes |
| flop3-kings | 3 | 1,031,681,913 | 1,032,187,476 | 1.0005 | 25.8 / 26.0 | 14.8 | yes |
| flop6-jack-small | 6 | 946,668,665 | 947,923,137 | 1.0013 | 17.8 / 17.8 | 0.2 | yes |
| flop6-jack | 6 | 1,973,007,082 | 1,974,080,998 | 1.0005 | 56.0 / 56.3 | 20.5 | yes |
| icm8-bb-call-small | 3 | 193,277,530 | 195,308,180 | 1.0105 | 17.8 / 17.8 | 0.1 | yes |
| icm8-bb-call | 3 | 382,474,359 | 384,382,594 | 1.0050 | 20.0 / 20.2 | 13.2 | yes |
| known-akq-river | 2 | 93,449,432 | 93,881,871 | 1.0046 | 19.5 / 19.5 | 0.1 | yes |

Instruction ratio 5.8 / 5.7.1 over the 10 fixtures: 0.9998 to 1.0105, median 1.0016.

**Training speed is that of 5.7.1.** On the shipped fixtures 5.8 executes between 0.02% fewer and 1.05% more
instructions (median 0.16% more); the largest increases are the two ICM fixtures (+0.5% and +1.05%), whose ICM cache
never missed in 5.7.1 and now costs a four-way search (section 5.1). The eight-handed final tables that the new
cache helps are in section 5.1 (up to 10% fewer instructions) and are not among the shipped study fixtures. Peak
resident memory is unchanged (the table layout and its accounting did not change).

Note on memory figures: the timed benchmark tool (`trainbench56.py`) also records a peak resident size per run. In
this run those figures were found to be wrong — on Linux a child process inherits its parent's peak resident size
as a floor, and the tool had read large state files — and they are not shown. The table above uses a driver that
loads no state file (`validation/5.8/performance/fixture_instructions58.py`; the first run of that script had the
same flaw and is kept under `performance/discarded/`).

## 4. Evaluation speed

`source/tools/evalbench57.py`: the 5.7 evaluation cases (sampled and exact action values, the one-decision quality
measure, restricted and exact best responses) with both binaries on the same trained states. Output:
`validation/5.8/performance/eval/`. Expectation before measurement: no difference except exact evaluations of ICM
games; every result identical.

| Case | Kind | 5.7.1: median seconds | 5.8: median seconds | Speed 5.8 / 5.7.1 (median) | Identical results (numbers compared) |
|---|---|---|---|---|---|
| 3-player flop (flop3-kings): sampled response gain | sampled | 25.43 | 25.80 | 0.986 | yes (85) |
| 3-player preflop (btn25-open): sampled response gain | sampled | 22.45 | 22.55 | 0.996 | yes (76) |
| 6-player flop (flop6-jack): sampled response gain | sampled | 1.52 | 1.45 | 1.046 | yes (172) |
| 8-handed ICM (icm8-bb-call): sampled response gain | sampled | 0.58 | 0.57 | 1.013 | yes (76) |
| 4-player turn (turn4): sampled response gain | sampled | 6.21 | 6.18 | 1.005 | yes (117) |
| 5-player flop (flop5): sampled response gain | sampled | 6.42 | 5.93 | 1.083 | yes (142) |
| 4-player ICM bubble (bubble4): sampled response gain | sampled | 0.61 | 0.71 | 0.862 | yes (101) |
| 3-player flop (flop3-kings): sampled action EV of the study decision | sampled-ev | 11.61 | 12.00 | 0.967 | yes (152) |
| 6-player flop (flop6-jack): sampled action EV of the study decision | sampled-ev | 1.12 | 1.17 | 0.953 | yes (158) |
| 8-handed ICM (icm8-bb-call): sampled action EV of the study decision | sampled-ev | 0.09 | 0.09 | 0.993 | yes (106) |
| 3-player flop small (flop3-kings-small): exact NashConv | exact | 0.02 | 0.02 | 0.990 | yes (33) |
| 4-player turn (turn4): exact NashConv | exact | 0.03 | 0.03 | 1.068 | yes (41) |
| 5-player flop (flop5): exact NashConv | exact | 0.02 | 0.03 | 0.860 | yes (49) |
| 6-player flop (flop6w): exact NashConv | exact | 1.37 | 1.34 | 1.017 | yes (57) |
| 8-handed ICM final table (final8w): exact NashConv | exact | 22.26 | 21.03 | 1.058 | yes (73) |
| 4-player ICM bubble (bubble4): exact NashConv | exact | 1.28 | 1.32 | 0.965 | yes (41) |

Speed ratio 5.8 / 5.7.1 over the 16 cases: 0.860 to 1.083, median 0.994. ICM cases: 1.013, 0.862, 0.993, 1.058, 0.965.

Reading: every one of the 16 cases returned results identical to 5.7.1 (every number compared equal). **Evaluation
is not faster in 5.8**: the ratios scatter around 1 (median 0.994). The cases that take under two seconds vary by
±14% between the binaries in either direction, which is the spread of this machine at that duration, not a
property of the programs. Of the longer cases, the exact NashConv of the eight-handed ICM final table is 5.8% faster
(22.3 s to 21.0 s), the one place where the ICM cache is expected to help an evaluation; the two long sampled cases
are 0.4% and 1.4% slower, inside the noise. No evaluator code changed in 5.8.

### 4.1 The cost of the new measure

The trained response is a new computation, not a faster old one. Its cost on the reference games is in the last
table of CONVERGENCE-5.8.md, section 2 (0.3 s to 3.7 minutes for all seats); on the realistic fixtures, with
1,000,000 response deals per seat, three seats side by side, see CONVERGENCE-5.8.md, section 3 (the last column).
It is dominated by the response training, which runs at the trainer's speed; the evaluation walk uses the threads
it is given and returns the same bits for any number of them.

## 5. ICM

### 5.1 The cache

The prize-equity cache was direct-mapped: one slot per hash value. On eight-handed final tables two stack vectors
that alternate during a traversal often shared a slot and evicted each other. It is now four-way set-associative
with the same number of entries and the same memory. Deterministic instruction counts of complete trainings
(`validation/5.8/performance/icm_instructions58.py`, `icm-instructions.json`):

| Game | Updates | Table budget (ICM cache entries) | Instructions 5.7.1 | Instructions 5.8 | Ratio | Share of instructions in the ICM routine: 5.7.1 | 5.8 | Identical state |
|---|---|---|---|---|---|---|---|---|
| final8 | 5,000 | 16 MiB (4,093) | 1,122,274,780 | 1,005,206,760 | 0.8957 | 0.190 | 0.096 | yes |
| final8 | 5,000 | 256 MiB (16,381) | 1,018,264,345 | 996,079,597 | 0.9782 | 0.108 | 0.087 | yes |
| final8 | 5,000 | 1024 MiB (32,749) | 1,003,061,057 | 995,839,678 | 0.9928 | 0.095 | 0.087 | yes |
| final8w | 5,000 | 16 MiB (4,093) | 1,043,401,371 | 999,893,182 | 0.9583 | 0.137 | 0.098 | yes |
| final8w | 5,000 | 256 MiB (16,381) | 1,006,463,979 | 992,885,666 | 0.9865 | 0.105 | 0.092 | yes |
| bubble4 | 5,000 | 256 MiB (16,381) | 293,311,699 | 295,989,480 | 1.0091 | 0.064 | 0.070 | yes |
| bubble5-icm | 5,000 | 256 MiB (16,381) | 422,954,437 | 426,213,302 | 1.0077 | 0.062 | 0.067 | yes |
| sidepot3-icm | 20,000 | 256 MiB (16,381) | 265,969,768 | 268,658,405 | 1.0101 | 0.066 | 0.073 | yes |
| short8-push | 3,000 | 256 MiB (no ICM) | 555,134,792 | 556,018,011 | 1.0016 | 0.000 | 0.000 | yes |

Reading: with a 16 MiB table budget (a small cache) the eight-handed final table needs 10% fewer instructions
(4% with weighted ranges) and the share spent in the ICM recursion falls from 19% to 10%; with larger budgets the
gain is 0.7% to 2.2%. **On games whose
cache never missed (the bubbles and the three-player ICM river), 5.8 executes 0.8% to 1.0% more instructions** —
the cost of looking through four ways — and 0.2% more on the eight-handed chip-EV game, which has no ICM (the
one-seat switch added to the training loop). That is a small regression, reported here and not hidden; the ICM part
could be removed by precomputing the set count. Section 3 has the same count for every shipped fixture. Every state file is
identical to 5.7.1's.

### 5.2 Exact ICM evaluation

The exact evaluation of an eight-handed ICM game spends about 86% of its time scoring boards and 1% in the ICM
recursion (profile during development), so the cache cannot speed it up materially; the timed cases are in section
4. No new approximation of ICM was introduced: prize equities are the exact Malmuth-Harville recursion as before,
and every cached value equals the recursion bit for bit (MATHEMATICAL-VALIDATION-5.8.md, section 7).

## 6. CPU threads and the GPU

### 6.1 What changed in 5.8

**Nothing in the scheduling of training, and nothing in CUDA.** No kernel, no device selection, no transfer, no rule
of the Automatic, Hybrid or GPU-Preferred modes was touched. The four processing modes exist as before. New code
that uses threads: the evaluation walk of the trained response (blocks of 1,024 deals on any number of threads,
added in block order: identical bits) and `parallelSeats` of `mwcli --response` (seats side by side, each on its own
copy of the state; identical bits, tested under ThreadSanitizer).

### 6.2 Why no CUDA optimisation was made

The brief asked for workload decisions based on measured costs. The measured costs on the target PC are those of
the 5.7 validation run (`validation/5.7.1/windows-5.7-physical/hardware-validation.json`); they are **5.7 results on
that PC, not 5.8 results**:

| Measurement on the target PC (5.7) | Result |
|---|---|
| exact all-in equity, 377,000 to 1,700,000 boards, GPU against 24 CPU threads | 27 to 84 times faster on the GPU |
| the same with 820 boards | 2.4 times |
| CUDA start-up | 65 to 100 ms |
| a small training job: CPU-only / Automatic / GPU-Preferred / Hybrid | 0.065 s / 0.064 s (CUDA not opened) / 0.151 s / 0.148 s |
| warm action-value table, 1, 2, 4, 8, 24 threads: CPU | 42.6, 24.1, 16.2, 12.6, 12.4 ms |
| the same with the GPU | 30.8, 18.7, 14.1, 11.5, 11.8 ms |
| Automatic against the best fixed mode (three comparisons, nine rounds) | one conclusive (within 15% of the best); two inconclusive |

These say: (a) the GPU is used where it helps by a large factor (board enumeration) and Automatic already keeps
small jobs on the CPU without paying the start-up cost; (b) the part of the engine that 5.8's objectives concern —
the MCCFR traversal of section 2, which is pointer-chasing through a hash table — is not a GPU workload in this
architecture; (c) warm action-value tables stop scaling at about eight threads on that PC, with or without the GPU.
There was no measured cost pointing at a scheduling rule to change, and no GPU to measure a change on. **A CUDA
change made without a GPU could only have been validated by guessing; none was made.**

### 6.3 What is supplied instead

`Run 5.8 Windows validation.bat` (full mode) runs the 5.7 hardware section on the target PC and writes
`hardware-validation.json`: CUDA execution, CPU/GPU agreement by exact integer comparison, timings per mode, the
Automatic-against-best comparisons. WINDOWS-TESTS-5.8.md, section 3, says what to look at. Two of the three
Automatic comparisons were inconclusive with nine rounds on 5.7; a second run can be pooled with the first.

### 6.4 CPU threading: what is and is not known

| Question | Status |
|---|---|
| frozen-batch training on 1 to 4 threads gives the 5.7.1 state | verified on Linux (identity run, section 5 of VALIDATION-5.8.md) |
| throughput of frozen batches on four threads, 5.8 against 5.7.1 | CONVERGENCE-5.8.md, section 4 (mean sampled deals in 1.0 s per arm) |
| scaling beyond four threads, and on performance and efficiency cores | **not measured**: the development machine has four processors. The 5.7 physical run recorded thread determinism up to 24 threads and the action-value timings above, not training scaling |
| trained-response evaluation on several threads | same bits for 1 and 3 threads (self-test R5); speed-up not benchmarked |

## 7. Complete studies

`source/tools/studybench57.py`: complete studies (training, action values, quality measure, statistics) with both
binaries; every measurement must be identical. Output: `validation/5.8/performance/study/`.

| Study | 5.7.1 wall seconds | 5.8 wall seconds | Ratio 5.7.1 / 5.8 | Identical measurements (numbers compared) |
|---|---|---|---|---|
| akq-river exact, standard preset | 0.28 | 0.08 | 3.452 | yes (260) |
| 3-player preflop small, sampled, standard preset | 1.40 | 1.25 | 1.123 | yes (900) |
| 3-player flop small, exact, standard preset | 0.92 | 1.00 | 0.924 | yes (1220) |
| 6-player flop, sampled, standard preset | 23.87 | 23.22 | 1.028 | yes (1160) |
| 3-player flop, sampled, standard preset | 142.53 | 133.79 | 1.065 | yes (1070) |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 7.15 | 6.87 | 1.042 | yes (112) |
| 6-player flop small, exact, 2 seeds x 2 budgets | 1.27 | 1.17 | 1.084 | yes (172) |
| 8-handed ICM, sampled, standard preset | 95.38 | 94.00 | 1.015 | yes (1080) |

Wall-time ratio 5.7.1 / 5.8 over the 8 studies: 0.924 to 3.452, median 1.053 (above 1: 5.8 faster). One run per binary per study.

Reading: all measurements identical (5,974 numbers compared in total). One run per binary per study, so single
differences mean little: the 3.5 ratio of the first study is 0.2 s of process start-up on the first run of the
series, not a speed-up. The three studies that run for more than 20 seconds are 1.5% to 6.5% faster with 5.8, in the
direction of, and of the size of, this machine's drift during a run. **Complete studies take the same time as in
5.7.1** to the precision of this measurement.

## 8. Regressions and limits

1. Up to 1.05% more instructions per training on the shipped fixtures (median 0.16%; sections 3 and 5.1), largest
   on small ICM games whose cache never missed.
2. Everything timed here ran on four shared virtual processors; run-to-run spread of one binary is about 10%, so
   differences of a few percent between the binaries are not resolved by these timings. The instruction counts are.
3. No timing on Windows, on the target CPU, or on any GPU exists for 5.8.
4. The large-study limit is unchanged (10,000,000 updates per engine state); what changed is that an over-limit
   study is refused in under a millisecond instead of after training to the limit.
