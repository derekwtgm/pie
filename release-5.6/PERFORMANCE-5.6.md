# Performance — EightMax 5.6

Every figure here was measured on the development machine, a shared cloud container with four logical processors (Intel(R) Xeon(R) Processor @ 2.10GHz, 16 GiB), against the unchanged 5.5 Linux binary, alternating the two programs. **None of it was measured on Windows hardware or on the target Core i7 / RTX 4060 Ti**; `Run 5.6 Windows validation.bat` measures the same quantities on your PC. Ratios between versions carry over better than absolute times.

5.5 made complete studies faster by running seeds side by side and enlarging the evaluator cache; its trainer was not faster. 5.6 makes the trainer and the exact evaluator themselves faster. Training throughput and study throughput are reported separately below.

## 1. Where the time went (profile of 5.5)

Instruction counts and simulated cache misses (Valgrind Callgrind, one training thread, 30,000 sampled deals):

| Fixture | Version | Instructions | D1 read miss | D1 write miss | Last-level data misses |
|---|---|---|---|---|---|
| flop3-kings | 5.5 | 2.22 billion | 4.35% | 2.40% | 0.22 million |
| flop3-kings | 5.6 | 1.55 billion | 3.49% | 0.80% | 0.23 million |
| flop6-jack | 5.5 | 4.31 billion | 3.79% | 1.40% | 0.48 million |
| flop6-jack | 5.6 | 2.86 billion | 3.70% | 0.94% | 0.64 million |

5.6 executes about a third fewer instructions for the same deals and writes far less to memory (the 440-byte betting-state copies are gone). Last-level cache misses are essentially unchanged: they come from reading and updating the strategy table at random positions, which is the work itself.

Shares of the 5.5 trainer's instructions on small games (`validation/5.6/profile/callgrind-5.5-*.txt`): the traversal proper about 60%; merging increments 15-18%, of which most was allocating the per-update journal; finding child states and rebuilding terminal states about 20%; reading strategies 8-12%; dealing and scoring 3-6%; clock reads 2% of instructions and more of the time. On the grouped fixtures, building hand-group keys as text took 10% (three-way flop) to 47% (eight-handed ICM) of the instructions.

Throughput of the 5.6 default trainer by kind of work (one thread, 300,000 deals, instrumented development build of the same source):

| Fixture | Sampled deals / s | State visits / s | State visits per deal | Information-set updates per deal | Information-set updates / s | Regret and average values written / s | Row found when the strategy was read |
|---|---|---|---|---|---|---|---|
| known-akq-river | 3,048,873 | 28,752,838 | 9.4 | 2.1 | 6,333,984 | 25,335,935 | 100.0% |
| flop3-kings-small | 680,561 | 56,408,357 | 82.9 | 4.6 | 3,100,637 | 14,830,343 | 100.0% |
| flop6-jack-small | 216,071 | 46,145,347 | 213.6 | 7.9 | 1,716,769 | 7,761,488 | 100.0% |
| icm8-bb-call-small | 1,137,294 | 19,803,995 | 17.4 | 3.0 | 3,380,288 | 13,521,154 | 100.0% |
| flop3-kings | 90,065 | 11,223,229 | 124.6 | 23.4 | 2,109,395 | 8,787,817 | 98.0% |
| flop6-jack | 35,815 | 8,909,302 | 248.8 | 23.9 | 854,322 | 3,621,189 | 96.9% |
| icm8-bb-call | 327,277 | 5,502,810 | 16.8 | 2.8 | 924,780 | 3,699,119 | 99.9% |
| btn25-open | 81,475 | 4,940,898 | 60.6 | 12.0 | 976,939 | 4,084,096 | 65.8% |

Each information-set update writes k regret increments and k average-strategy increments, so regret-update and average-update throughput are each half of the "values written" column. The last column is the share of updates whose table row was already known when the increment was merged (5.5 looked every one up a second time). These rates were measured while other work was running and are lower than the idle-machine figures of section 2.

Locks: with one deal per update (every study) the trainer takes no lock. With frozen batches the workers share one atomic counter and write to private buffers; merging is single-threaded by design, because it assigns state identifiers in deal order so that results do not depend on the thread count.

## 2. Training throughput (default trainer, study fixtures)

`source/tools/trainbench56.py`: variant 0 of every study fixture, one training thread (as a study trains a seed), 300,000 sampled deals, 5 repetitions alternating the two binaries. No evaluation is run.

| Fixture | Seats | Rows | Table MiB | 5.5 best / median seconds | 5.6 best / median seconds | Speed-up (best, median) | 5.6 sampled deals / s | 5.6 state visits / s | Same state bytes |
|---|---|---|---|---|---|---|---|---|---|
| btn25-open | 3 | 1,230,895 | 136.2 | 5.11 / 5.32 | 3.50 / 3.67 | **1.46x**, 1.45x | 85,699 | 5,197,069 | yes |
| btn25-open-small | 3 | 74 | 0.1 | 0.57 / 0.59 | 0.35 / 0.38 | **1.62x**, 1.57x | 857,805 | 41,946,673 | yes |
| flop3-kings | 3 | 142,355 | 14.8 | 5.22 / 5.64 | 3.48 / 3.91 | **1.50x**, 1.44x | 86,138 | 10,733,899 | yes |
| flop3-kings-detailed | 3 | 3,038,428 | 323.8 | 10.12 / 10.91 | 8.79 / 9.02 | **1.15x**, 1.21x | 34,129 | 3,955,294 | yes |
| flop3-kings-small | 3 | 105 | 0.1 | 0.76 / 0.78 | 0.44 / 0.46 | **1.73x**, 1.71x | 684,957 | 56,772,706 | yes |
| flop6-jack | 6 | 222,084 | 20.5 | 12.44 / 12.61 | 8.28 / 8.71 | **1.50x**, 1.45x | 36,218 | 9,009,441 | yes |
| flop6-jack-small | 6 | 1,091 | 0.2 | 2.37 / 2.55 | 1.38 / 1.49 | **1.72x**, 1.71x | 217,908 | 46,537,677 | yes |
| icm8-bb-call | 3 | 1,014 | 13.2 | 1.48 / 1.63 | 0.79 / 0.82 | **1.86x**, 1.98x | 378,204 | 6,359,092 | yes |
| icm8-bb-call-small | 3 | 25 | 0.1 | 0.45 / 0.51 | 0.26 / 0.26 | **1.75x**, 1.94x | 1,158,802 | 20,178,521 | yes |
| known-akq-river | 2 | 6 | 0.1 | 0.27 / 0.30 | 0.10 / 0.11 | **2.81x**, 2.78x | 3,103,630 | 29,269,230 | yes |

Speed-up range 1.15x to 2.81x (median 1.67x). It is largest where a deal is cheap and the table small (bookkeeping dominated) and smallest where the table is hundreds of megabytes and most of the time is cache misses on the table itself. The saved states are byte-identical in every row, so this is the same training, sooner.

### Thread scaling of frozen-batch training

Studies train one deal per update on one thread per seed and use the other processors for other seeds. The trainer itself uses several threads only with frozen batches (64 deals per update here, per-deal action streams). Best of three runs:

| Game | Version | 1 thread, s | 2 threads, s | 4 threads, s | 4-thread speed-up | State identical across thread counts and versions |
|---|---|---|---|---|---|---|
| flop6w | 5.5 | 1.238 | 1.132 | 0.830 | 1.49x | yes |
| flop6w | 5.6 | 0.722 | 0.811 | 0.663 | 1.09x | yes |
| final8w | 5.5 | 1.543 | 1.265 | 0.944 | 1.64x | yes |
| final8w | 5.6 | 0.814 | 0.949 | 0.693 | 1.17x | yes |
| turn4 | 5.5 | 0.770 | 1.070 | 1.047 | 0.74x | yes |
| turn4 | 5.6 | 0.544 | 0.791 | 0.780 | 0.70x | yes |
| flop5 | 5.5 | 0.768 | 0.886 | 0.726 | 1.06x | yes |
| flop5 | 5.6 | 0.544 | 0.685 | 0.576 | 0.94x | yes |

5.6 did not change how batches are split among threads. 5.6 is faster than 5.5 at every thread count measured, but its gain is in the per-thread traversal, so the single-threaded merge is a larger share of what remains and the relative benefit of extra threads is smaller than in 5.5 (and on the smallest game both versions are slower with more threads). Thread scaling was not improved. More threads do not by themselves mean faster convergence: a frozen batch of 64 deals also makes fewer strategy updates per deal than one deal per update.

## 3. Complete studies

`source/tools/bench56.py`: identical options for both versions, 4 threads, 2 repetitions, checkpoints off. "Training", "action EV" and "quality" are sums over the study's points (seeds run side by side, so they exceed wall time).

| Study | Version | Wall s (best) | Training s | Action-EV s | Quality s | Peak RSS MiB | Points |
|---|---|---|---|---|---|---|---|
| akq-river exact, standard preset | 5.5 | 0.19 | 0.54 | 0.00 | 0.00 | 19 | 10 of 10 |
| akq-river exact, standard preset | 5.6 | 0.08 | 0.22 | 0.00 | 0.00 | 19 | 10 of 10 |
| 3-player preflop small, sampled, standard preset | 5.5 | 2.52 | 3.44 | 3.05 | 3.11 | 19 | 30 of 30 |
| 3-player preflop small, sampled, standard preset | 5.6 | 2.06 | 1.88 | 2.75 | 2.90 | 19 | 30 of 30 |
| 3-player flop small, exact, standard preset | 5.5 | 6.55 | 4.20 | 1.99 | 17.17 | 19 | 30 of 30 |
| 3-player flop small, exact, standard preset | 5.6 | 0.88 | 2.41 | 0.06 | 0.66 | 19 | 30 of 30 |
| 6-player flop, sampled, standard preset | 5.5 | 28.85 | 65.82 | 5.48 | 33.08 | 171 | 30 of 30 |
| 6-player flop, sampled, standard preset | 5.6 | 23.38 | 45.39 | 5.69 | 34.43 | 219 | 30 of 30 |
| 3-player flop, sampled, standard preset | 5.5 | 230.77 | 26.27 | 56.22 | 759.29 | 166 | 30 of 30 |
| 3-player flop, sampled, standard preset | 5.6 | 235.94 | 20.63 | 60.27 | 793.34 | 184 | 30 of 30 |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 5.5 | 11.06 | 0.04 | 3.89 | 17.58 | 2423 | 4 of 4 |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 5.6 | 7.40 | 0.02 | 3.67 | 10.97 | 102 | 4 of 4 |
| 6-player flop small, exact, 2 seeds x 2 budgets | 5.5 | 68.88 | 0.22 | 34.88 | 101.07 | 19 | 4 of 4 |
| 6-player flop small, exact, 2 seeds x 2 budgets | 5.6 | 1.18 | 0.11 | 0.22 | 1.97 | 21 | 4 of 4 |
| 8-handed ICM, sampled, standard preset | 5.5 | 154.49 | 12.72 | 0.59 | 470.80 | 168 | 40 of 40 |
| 8-handed ICM, sampled, standard preset | 5.6 | 155.18 | 7.82 | 0.58 | 466.22 | 180 | 40 of 40 |

| Study | Wall-time ratio 5.5 / 5.6 | Training-time ratio | Peak RSS 5.5 -> 5.6 MiB |
|---|---|---|---|
| akq-river exact, standard preset | **2.43x** | 2.50x | 19 -> 19 |
| 3-player preflop small, sampled, standard preset | **1.22x** | 1.83x | 19 -> 19 |
| 3-player flop small, exact, standard preset | **7.45x** | 1.74x | 19 -> 19 |
| 6-player flop, sampled, standard preset | **1.23x** | 1.45x | 171 -> 219 |
| 3-player flop, sampled, standard preset | **0.98x** | 1.27x | 166 -> 184 |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | **1.50x** | 1.93x | 2423 -> 102 |
| 6-player flop small, exact, 2 seeds x 2 budgets | **58.58x** | 1.95x | 19 -> 21 |
| 8-handed ICM, sampled, standard preset | **1.00x** | 1.63x | 168 -> 180 |

**Same measurements.** Every per-seed measurement of the two versions was compared (action EVs, frequencies, standard errors, quality, deals, rows, evaluation seed):

| Study | Points compared | Bit-identical | Within 1e-9 relative | Differing | Largest relative difference |
|---|---|---|---|---|---|
| akq-river exact, standard preset | 10 | 10 | 0 | 0 | 0 |
| 3-player preflop small, sampled, standard preset | 30 | 30 | 0 | 0 | 0 |
| 3-player flop small, exact, standard preset | 30 | 0 | 30 | 0 | 4.3e-15 |
| 6-player flop, sampled, standard preset | 30 | 30 | 0 | 0 | 0 |
| 3-player flop, sampled, standard preset | 30 | 30 | 0 | 0 | 0 |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 4 | 4 | 0 | 0 | 0 |
| 6-player flop small, exact, 2 seeds x 2 budgets | 4 | 0 | 4 | 0 | 8.7e-16 |
| 8-handed ICM, sampled, standard preset | 40 | 40 | 0 | 0 | 0 |

Sampled evaluations are bit-identical. Exact evaluations can differ in the last bits where 5.6 sums a passive runout through a showdown table instead of card by card (section 4); that is a different order of the same additions.

## 4. Exact evaluation (multiway and ICM)

Exact all-seat best response (`mwcli --gain`) on a state trained once, one thread. A run that had not finished after 300 s is shown as not finished.

| Game | Evaluator cache | 5.5 seconds | 5.6 seconds | Ratio | Peak RSS MiB, 5.5 / 5.6 | NashConv 5.6 | Agreement |
|---|---|---|---|---|---|---|---|
| bubble4 | 128 MiB | 56.46 | 1.26 | **44.9x** | 122 / 39 | 8.85665e-06 | bit-identical |
| bubble4 | 1024 MiB | 1.49 | 1.25 | **1.2x** | 271 / 39 | 8.85665e-06 | bit-identical |
| final8 | 128 MiB | 0.19 | 0.13 | **1.5x** | 17 / 17 | 2.673e-05 | bit-identical |
| final8 | 1024 MiB | 0.13 | 0.15 | **0.9x** | 17 / 17 | 2.673e-05 | bit-identical |
| flop5 | 128 MiB | 0.39 | 0.03 | **12.5x** | 6 / 6 | 0.157893 | relative difference 1.8e-16 |
| flop5 | 1024 MiB | 0.37 | 0.03 | **14.8x** | 6 / 6 | 0.157893 | relative difference 1.8e-16 |
| flop6 | 128 MiB | 2.13 | 0.10 | **21.1x** | 7 / 6 | 0.117118 | relative difference 5.9e-16 |
| flop6 | 1024 MiB | 2.08 | 0.10 | **20.2x** | 7 / 6 | 0.117118 | relative difference 5.9e-16 |
| flop6w | 128 MiB | 32.43 | 1.20 | **27.1x** | 11 / 8 | 0.391621 | relative difference 2.8e-15 |
| flop6w | 1024 MiB | 32.58 | 1.04 | **31.3x** | 11 / 8 | 0.391621 | relative difference 2.8e-15 |
| final8w | 128 MiB | not finished (300 s) | 19.66 | more than 15x | 98 / 56 | 0.00657238 | 5.5 did not finish |
| final8w | 1024 MiB | not finished (300 s) | 20.23 | more than 15x | 760 / 56 | 0.00657238 | 5.5 did not finish |
| turn4 | 128 MiB | 0.04 | 0.03 | **1.5x** | 6 / 6 | 0.00150217 | bit-identical |
| turn4 | 1024 MiB | 0.03 | 0.03 | **0.8x** | 6 / 6 | 0.00150217 | bit-identical |
| river3-chip | 128 MiB | 0.01 | 0.00 | **1.1x** | 6 / 6 | 0.0858015 | bit-identical |
| river3-chip | 1024 MiB | 0.01 | 0.00 | **1.2x** | 6 / 6 | 0.0858015 | bit-identical |

Two changes, both in `source/native/action_ev.hpp`:

- **Compact showdown tables.** A table of all seats' scores on every board completion (up to 12 MiB for an eight-seat preflop deal) is read after its construction only through rank-pattern histograms. 5.5 kept the scores for the life of the table, so the cache held a few dozen tables, and an exact best response, which visits the table of every opponent-hand tuple at every terminal in turn, kept evicting and rebuilding them. 5.5's answer was a larger cache. 5.6 frees the scores once the histogram exists; a resident table is then a few kilobytes, the count cap of the shared cache is 4,096 instead of 64, and each table is built once. The histograms, and so every value, are unchanged.
- **Passive runouts.** When no seat has a real decision after a chance node, 5.5 dealt the remaining cards one at a time and scored every seat on every completed board for every opponent-hand tuple. 5.6 evaluates the single terminal state through the deal's showdown table. Same expectation, a different order of additions (agreement column).

The eight-handed ICM game with two-hand ranges (`final8w`, 256 hand tuples) is the case 5.5 could not evaluate: with its default 1,024 MiB cache the 5.5 binary stopped at its own 30-minute limit (`validation/5.6/performance/final8w-5.5-default.txt`); given 4,096 MiB and a raised table cap it needed 20.3 s and returned the value 5.6 returns in about the same time with a quarter of the memory.

The ICM prize-equity kernel itself (`icm.hpp`) was profiled and left alone: it accounts for about 3.5% of training instructions on the eight-handed fixture, and its exact-key cache already serves the evaluator; the cost that mattered was table construction.

## 5. Memory

Peak resident memory of training alone, one thread, 1,000,000 sampled deals (measured by `tools/peak_rss.c`):

| Fixture | 5.5 peak RSS MiB | 5.6 peak RSS MiB | Difference | Table MiB | 5.6 link cache MiB | Training seconds 5.5 / 5.6 |
|---|---|---|---|---|---|---|
| flop3-kings | 26 | 26 | -0 | 17.2 | 0.7 | 19.5 / 14.2 |
| flop6-jack | 62 | 72 | +10 | 31.4 | 11.0 | 45.5 / 30.7 |
| icm8-bb-call | 23 | 29 | +6 | 18.5 | 0.0 | 6.1 / 2.9 |
| btn25-open | 332 | 338 | +6 | 292.8 | 0.7 | 21.8 / 14.4 |
| flop3-kings-detailed | 682 | 682 | +0 | 672.3 | 0.7 | 42.2 / 33.7 |

Training uses slightly more memory in 5.6: the child links and terminal records of the stored states (at most the state store's own allowance, 16 MiB per engine, not charged to the table budget) and the number index of Compact hand-group keys (16 bytes per slot, at most half full). Exact evaluation uses much less (section 4). Study peaks are in section 3. The process memory budget still defaults to 70% of installed memory (about 11 GB on a 16 GB PC); no default assumes more than that.

## 6. What did not get faster

- Sampled evaluation (action EVs and the restricted quality measure) is unchanged; on the large sampled studies it is most of the wall time, which is why their study ratios are smaller than their training ratios.
- Thread scaling of the trainer was not improved (section 2).
- The largest tables are bound by memory latency, not by instructions; 5.6 gains least there.
- No GPU code changed and no GPU was measured.

