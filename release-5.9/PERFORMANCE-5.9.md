# EightMax 5.9: performance

Build `00600c81455ead44` against the unchanged 5.8 binary (build `d4001e2c0cd77f41`). Tool:
`validation/5.9/performance/bench59.py`; plan written before measurement (`plan.json`), results in `result.json`.

**Which build was measured.** The benchmark ran with build `78497bdc80f1ef9c`. The release build differs from it
in two test tools only (`tools/host_refusal59.js`, `tools/validate_windows59.ps1`); every C and C++ source file is
byte-identical, so the programs differ in the embedded build identifier and in nothing that executes.

**Where these numbers come from.** A development container: Linux-6.18.44-fc-v819-x86_64-with-glibc2.39, 4 logical
processors, no hardware performance counters. **Nothing was measured on the target PC** (i7-13700F, 24 logical
processors) **or on any GPU.** Ratios between the two programs on the same machine are the evidence; absolute times
will differ on other hardware, and the gains from fewer cache misses depend on the cache hierarchy. Every comparison
alternates the programs (one run of each per repetition); medians, with the minimum in brackets.

## 1. Summary

| Question | Answer | Section |
|---|---|---|
| Is the evaluation of a trained response faster? | **Yes: 1.06 to 2.36 times** at one thread with identical numbers; largest on tables that do not fit the processor's caches | 2 |
| Is the whole response analysis faster? | At one thread, same request: wall time +2% to +52% (negative: slower). **The 20% target is met on 3 of 7 cases** (three-player flop fixture; three-player tournament preflop fixture (25 BB, multi-street); four-player turn (reference game)); where the unchanged response training dominates, the total hardly moves. | 2 |
| What does a user get by default? | Evaluation on every logical processor: 0.20 to 0.93 of the 5.8 wall time on four processors | 2.3 |
| Is the response training faster? | **No.** It is the 5.8 trainer (ratios 0.92 to 1.12, i.e. noise). | 2 |
| Did default training throughput change? | **No**: 5.9 / 5.8 seconds 0.958 to 1.012; states byte-identical | 3 |
| Exact and sampled evaluation, complete studies | unchanged within noise; identical values | 4 |
| Strategy-table memory access | evaluation walk: 17 to 18% fewer first-level data-cache misses and two dependent reads per lookup instead of four; trainer: unchanged (one experiment rejected) | 2.2, 5 |
| Peak memory | response analysis: unchanged or lower; the offset index is 4 bytes per hash slot for the duration of one evaluation call, charged to the evaluation budget | 6 |
| GPU | not involved: no CUDA code changed, nothing was run on a GPU | 7 |

## 2. Trained-response analysis

### 2.1 Same request, same numbers, one thread

`mwcli --response`, 200,000 response deals and 51,200 evaluation deals per seat, seed 58, one thread; 5.9 with
`"randomStreams": "5.8"` so that both programs compute the same numbers (estimate bits, standard error and visit
count of every seat compared: column "identical"). States: 250,000 training deals for the study fixtures, 20,000 (5,000
for the ICM final table) for the reference games. 3 alternating repetitions. Seconds, summed over the seats.

| Case | Seats | Opponent actions | Evaluation 5.8 | 5.9 | **speed-up** | Response training 5.8 | 5.9 | Wall 5.8 | 5.9 | **wall** | identical |
|---|---|---|---|---|---|---|---|---|---|---|---|
| three-player flop fixture | 3 | enumerated | 25.90 | 12.65 | **2.05** | 2.73 | 2.51 | 28.74 | 15.27 | **-47%** | yes |
| six-player flop fixture | 6 | sampled | 2.59 | 2.02 | **1.28** | 7.07 | 7.03 | 10.22 | 9.49 | **-7%** | yes |
| three-player tournament preflop fixture (25 BB, multi-street) | 3 | enumerated | 38.43 | 16.26 | **2.36** | 3.21 | 3.38 | 43.63 | 21.10 | **-52%** | yes |
| eight-handed ICM fixture (big blind call or fold) | 3 | enumerated | 0.16 | 0.13 | **1.22** | 1.25 | 1.26 | 1.47 | 1.44 | **-2%** | yes |
| four-player turn (reference game) | 4 | enumerated | 1.95 | 1.29 | **1.51** | 0.41 | 0.38 | 2.39 | 1.68 | **-30%** | yes |
| five-player flop (reference game) | 5 | enumerated | 2.24 | 1.79 | **1.25** | 0.56 | 0.62 | 2.82 | 2.41 | **-15%** | yes |
| eight-handed ICM final table (reference game) | 8 | enumerated | 34.08 | 32.24 | **1.06** | 1.44 | 1.44 | 35.55 | 33.69 | **-5%** | yes |

**Reading.**

* The gain is in the evaluation walk and grows with the size of the strategy table relative to the processor's
  caches: about 2 times on the three-player fixtures (136,000 and 1,070,000 information sets, opponents enumerated:
  over a thousand lookups per deal), 1.3 times on the six-player flop fixture (sampled opponents: about sixty node
  visits per deal, of which fewer are lookups), and little on games whose whole table fits the cache.
* On the eight-handed ICM final table the walk is dominated by prize-equity evaluations at the terminals, which 5.9
  did not touch: no gain.
* **Total wall time moves only as far as the evaluation's share allows.** With 200,000 response deals per seat the
  six-player fixture spends 7 of 10 seconds in response training, which is unchanged; its total falls by a few
  percent. The 20% objective of the brief is therefore met on the evaluation-heavy cases and not on the
  training-heavy ones. Larger evaluation budgets - which the new confidence statements call for - shift every case
  towards the evaluation's share.

### 2.2 Where the time went, and what was changed

Profile of the 5.8 walk (`perf`, three-player flop fixture; `walk-variants.json`): `Evaluator::policy` 37.5% and
`MW::findRow` 31.7% of the samples, coverage accounting 4.4%. Inside the walk without bookkeeping, four dependent
memory reads take 82%: the hash slot's key 31.9%, the slot's row number 7.1%, the row record (for the value offset)
21.8%, the values 21.1%. Each needs the result of the one before, so their cache misses cannot overlap.

Changes, each with identical results (the same nodes, the same random numbers, the same arithmetic; verified bit for
bit against the 5.8 walk and the 5.8 program: MATHEMATICAL-VALIDATION-5.9.md, section 6):

1. the strategy key of (seat, street) once per deal, and ONE row lookup for both profiles of the responding seat;
   no coverage accounting (never printed by this measure);
2. an offset index: one 32-bit value offset per hash slot, read together with the slot's key, so that a lookup waits
   for two reads instead of four;
3. look-ahead: when opponents are enumerated and the table has at least 131,072 hash slots, the index lines of a
   node's children are requested before the first child is walked.

Variants inside one program, median milliseconds of the evaluation (5 alternating repetitions; every variant printed
the same bits; `walk-variants.json`):

Tables that do not fit the caches (seat 0):

| Fixture | Evaluation deals | Opponents | 5.8 walk | 1: lean walk | 1 + 2: with index | 1 + 2 + 3: with look-ahead |
|---|---|---|---|---|---|---|
| flop6-jack | 409,600 | sampled | 5040 | 4538 (x1.11) | 3952 (x1.28) | 4191 (x1.20) |
| flop3-kings | 20,480 | enumerated | 3490 | 2242 (x1.56) | 1863 (x1.87) | 1743 (x2.00) |
| flop3-kings | 409,600 | sampled | 3483 | 2608 (x1.34) | 2084 (x1.67) | 2065 (x1.69) |
| btn25-open | 20,480 | enumerated | 4732 | 2802 (x1.69) | 2314 (x2.04) | 2015 (x2.35) |

Small tables (all seats):

| Game | Evaluation deals | Opponents | 5.8 walk | 1: lean walk | 1 + 2: with index | 1 + 2 + 3: with look-ahead |
|---|---|---|---|---|---|---|
| flop5 | 51,200 | enumerated | 2528 | 1909 (x1.32) | 2043 (x1.24) | 2320 (x1.09) |
| turn4 | 51,200 | enumerated | 2145 | 1500 (x1.43) | 1422 (x1.51) | 1677 (x1.28) |
| final8 | 20,480 | enumerated | 15252 | 13431 (x1.14) | 13664 (x1.12) | 14684 (x1.04) |
| icm8-bb-call | 204,800 | enumerated | 704 | 630 (x1.12) | 618 (x1.14) | 692 (x1.02) |

The second table is why look-ahead is restricted to large tables: where every lookup is already in the cache the
extra pass over the children costs 10 to 20%. The release candidate that used look-ahead for every enumerated walk
was measured, found slower on these games, and corrected before release; the table above is that measurement.

First-level data-cache misses of the evaluation (valgrind cachegrind, deterministic counts; the 5.9 program with
`EIGHTMAX_RESPONSE_WALK=5.8`, with `EIGHTMAX_RESPONSE_INDEX=0`, and by default):

| Fixture | Evaluation deals | 5.8 walk | 5.9 walk without index | 5.9 walk | fewer misses | same estimate bits |
|---|---|---|---|---|---|---|
| flop3-kings | 4,096 | 31,879,414 | 28,207,266 | 26,275,527 | 18% | yes |
| flop6-jack | 40,960 | 20,435,903 | 18,476,727 | 16,883,113 | 17% | yes |

The miss count falls by less than the time does: the index does not remove the misses on the values; it lets two of
the remaining misses overlap, which a miss count does not show.

### 2.3 What a user gets without asking

5.9 only, the same states: the default request (5.9 streams; `threads` absent, so the evaluation uses every logical
processor - four here) and the same with `"futureActions": "sample"`. Other random numbers than in 2.1, so times only.

| Case | 5.8 wall (one thread, 2.1) | 5.9 default wall | relative to 5.8 | 5.9 with sampled opponent actions, wall | (opponents) | simultaneous NashConv bound, default | with sampled actions |
|---|---|---|---|---|---|---|---|
| three-player flop fixture | 28.74 | 5.81 (4 threads) | 0.20 | 2.79 | sampled | 0.460 | 0.333 |
| six-player flop fixture | 10.22 | 7.96 (4 threads) | 0.78 | 7.55 | sampled | 0.188 | 0.188 |
| three-player tournament preflop fixture (25 BB, multi-street) | 43.63 | 8.89 (4 threads) | 0.20 | 5.53 | sampled | 0.000 | 0.000 |
| eight-handed ICM fixture (big blind call or fold) | 1.47 | 1.38 (4 threads) | 0.93 | 1.17 | sampled | 0.000 | 0.000 |
| four-player turn (reference game) | 2.39 | 0.90 (4 threads) | 0.38 | 0.42 | sampled | 0.006 | 0.006 |
| five-player flop (reference game) | 2.82 | 1.15 (4 threads) | 0.41 | 0.68 | sampled | 0.012 | 0.000 |
| eight-handed ICM final table (reference game) | 35.55 | 9.69 (4 threads) | 0.27 | 1.57 | sampled | 0.000 | 0.000 |

* 5.8's default was one evaluation thread; a 5.8 user could have asked for more. The comparison shows what the
  changed default is worth on four processors, not an algorithmic gain. On 24 logical processors the evaluation
  should scale further (the blocks are independent); this is unmeasured.
* At an EQUAL number of deals enumerated opponent actions give the tighter bound (less variance per deal): the last
  two columns. At equal TIME it is the other way round - next table.

**Enumerated against sampled opponent actions at about equal evaluation time** (`sample-vs-enumerate.json`; the same
responses, 200,000 response deals per seat, one evaluation thread, one run each, sizes fixed before measurement:
51,200 deals enumerated, 16 times as many sampled):

| Fixture | Opponent actions | Evaluation deals | Evaluation s | Node visits per deal | Estimated sum of gains | **NashConv >= (simultaneous, 95%)** | NashConv >= (pooled, 95%) |
|---|---|---|---|---|---|---|---|
| three-player flop fixture | enumerated | 51,200 | 14.4 | 1345 | 0.689 | **0.503** | 0.575 |
| three-player flop fixture | sampled | 819,200 | 12.7 | 57 | 0.695 | **0.634** | 0.657 |
| three-player tournament preflop fixture (25 BB, multi-street) | enumerated | 51,200 | 17.9 | 1197 | 0.082 | **0.016** | 0.008 |
| three-player tournament preflop fixture (25 BB, multi-street) | sampled | 819,200 | 17.8 | 17 | 0.099 | **0.089** | 0.098 |

Where the default enumerates the opponents' actions (betting trees of at most 4,096 states) a deal costs 20 to 70
times as many node visits. The 5.9 statements are valid either way, and in the same time sampled actions certified
1.3 times (three-player flop) and 5.7 times (three-player preflop) as much NashConv. **For a confidence statement,
prefer `"futureActions": "sample"` with more deals.** Two fixtures, one run each: an indication, not a law. The
default rule of `futureActions` was NOT changed in 5.9 (it would change what a default request computes).

### 2.4 What was not made faster

* **Response training**: the 5.8 trainer with one seat learning; one thread per seat with one deal per update.
  `parallelSeats` runs seats side by side, each with a private copy of the table.
* **Sharing the frozen opponents' strategies between seats**: not implemented (the response problem rewrites the
  table in place).
* **Serialisation**: the state file is read once per seat (5.8: once more); otherwise unchanged.

## 3. Default training throughput (no change intended, none found)

5 alternating repetitions; seconds of the training call, median (minimum); frozen batches with every update on all
threads of the call (`EIGHTMAX_THREAD_CHOICE=fixed`).

| Case | Threads | Sampled deals | 5.8 s | 5.9 s | 5.9 / 5.8 | 5.9 deals per second | states identical |
|---|---|---|---|---|---|---|---|
| flop3-kings | 1 | 250,000 | 2.652 (2.074) | 2.685 (2.304) | 1.012 | 93,101 | yes |
| flop6-jack | 1 | 250,000 | 6.255 (5.978) | 6.128 (5.729) | 0.980 | 40,796 | yes |
| btn25-open | 1 | 250,000 | 2.886 (2.629) | 2.826 (2.694) | 0.979 | 88,468 | yes |
| icm8-bb-call | 1 | 250,000 | 0.710 (0.655) | 0.681 (0.522) | 0.958 | 367,210 | yes |
| flop6-jack, 64 deals per update | 1 | 256,000 | 6.746 (6.445) | 6.817 (6.441) | 1.010 | 37,554 | yes |
| flop6-jack, 64 deals per update | 2 | 256,000 | 4.416 (4.183) | 4.425 (3.994) | 1.002 | 57,850 | yes |
| flop6-jack, 64 deals per update | 4 | 256,000 | 2.719 (2.560) | 2.628 (2.586) | 0.966 | 97,404 | yes |

The ratios are within the run-to-run spread of one program (compare each median with its minimum). The trainer's
source is unchanged; so is its thread scaling. The prefetch experiment in the trainer's lookup
(`validation/5.9/experiments/prefetch-row-slot.md`) changed nothing measurable and was not adopted.

## 4. Other evaluators and complete studies (no change intended)

3 alternating repetitions, process wall seconds, median (minimum).

| Game | Measure | 5.8 s | 5.9 s | 5.9 / 5.8 | identical values |
|---|---|---|---|---|---|
| turn4 | exact best response | 0.029 (0.021) | 0.022 (0.022) | 0.78 | yes |
| turn4 | sampled one-decision measure | 0.578 (0.547) | 0.515 (0.486) | 0.89 | yes |
| flop6 | exact best response | 0.083 (0.071) | 0.091 (0.076) | 1.10 | yes |
| flop6 | sampled one-decision measure | 1.694 (1.653) | 1.733 (1.643) | 1.02 | yes |
| bubble4 | exact best response | 1.145 (1.079) | 1.193 (1.175) | 1.04 | yes |
| bubble4 | sampled one-decision measure | 0.065 (0.050) | 0.068 (0.064) | 1.04 | yes |
| mid3-turn | exact best response | 0.053 (0.053) | 0.054 (0.046) | 1.02 | yes |
| mid3-turn | sampled one-decision measure | 0.648 (0.611) | 0.629 (0.521) | 0.97 | yes |

| Study (`mwcli --study`, two seeds, budgets 20,000 and 60,000 deals, two threads) | 5.8 s | 5.9 s | 5.9 / 5.8 | identical measurements |
|---|---|---|---|---|
| known-akq-river | 0.030 (0.030) | 0.027 (0.026) | 0.87 | yes |
| flop6-jack-small | 2.342 (2.273) | 2.583 (2.236) | 1.10 | yes |

Runs of a few hundredths of a second (the heads-up study, the ICM bubble's sampled measure) are dominated by process
start-up and scatter by 10 to 25%; the longer runs agree within their own spread (compare each median with its
minimum; the six-player study's minimum is lower for 5.9 while its median is higher). No evaluator other than the
trained-response walk was changed, and every value is identical.

## 5. Strategy-table memory in the trainer

Not changed. See FINAL-REPORT-5.9.md, section 4, and `validation/5.9/experiments/prefetch-row-slot.md`: the offset
index that works for a read-only table would have to be maintained while the trainer adds rows and grows its hash
table, and charged to the table budget, which moves the point at which a table limit is reached - a format-level
change. Checkpoint overhead is unchanged (no checkpoint code changed).

## 6. Peak resident memory of a response analysis

Process peak, MiB (one seat at a time, one thread):

| Case | 5.8 | 5.9 |
|---|---|---|
| three-player flop fixture | 53.3 | 41.0 |
| six-player flop fixture | 62.6 | 61.8 |
| three-player tournament preflop fixture (25 BB, multi-street) | 226.0 | 211.7 |
| eight-handed ICM fixture (big blind call or fold) | 24.1 | 24.3 |
| four-player turn (reference game) | 20.7 | 20.7 |
| five-player flop (reference game) | 20.7 | 20.7 |
| eight-handed ICM final table (reference game) | 20.7 | 20.7 |

5.9 no longer keeps the probe copy of the state beside the first seat's copy. The offset index adds 4 bytes per hash
slot during an evaluation call (2 MiB for the three-player flop fixture, 16 MiB for the preflop fixture) and is
freed with the call; it is not built when it would exceed a quarter of the evaluation memory budget.

## 7. CPU and GPU

The trained-response analysis is a CPU workload and stays one. The walk is a recursive traversal with dependent
table lookups - the profile above is a memory-latency profile - which is not a workload a GPU accelerates without a
different algorithm; no performance model that would justify CUDA work was found, and none was started. **No CUDA
kernel or scheduling code changed in 5.9, and no 5.9 program was run on an NVIDIA GPU**: Automatic, Hybrid and
GPU-Preferred processing are as in 5.8 and unverified on hardware for this build (WINDOWS-TESTS-5.9.md).

## 8. Limits of these measurements

* Four processors, a virtual machine, no hardware counters; cache sizes differ from the target PC.
* Three to five repetitions: differences of a few percent are not resolved; nothing below about 5% is claimed.
* Thread scaling of the evaluation beyond four threads: not measured.
* Long runs, large memory (above 250 MiB of tables): not measured.
