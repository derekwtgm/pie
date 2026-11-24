import json, pathlib, sys
root = pathlib.Path(sys.argv[1]); R = json.load(open(root / 'validation/5.9/performance/result.json')); W = json.load(open(root / 'validation/5.9/performance/walk-variants.json')); P = json.load(open(root / 'validation/5.9/performance/plan.json'))
names = {'flop3-kings': 'three-player flop fixture', 'flop6-jack': 'six-player flop fixture', 'btn25-open': 'three-player tournament preflop fixture (25 BB, multi-street)', 'icm8-bb-call': 'eight-handed ICM fixture (big blind call or fold)', 'turn4': 'four-player turn (reference game)', 'flop5': 'five-player flop (reference game)', 'final8': 'eight-handed ICM final table (reference game)'}
rs = R['response']
row = lambda r: '| %s | %d | %s | %.2f | %.2f | **%.2f** | %.2f | %.2f | %.2f | %.2f | **%+.0f%%** | %s |' % (names[r['fixture']], r['players'], r['opponentActions'], r['evaluation']['old'][0], r['evaluation']['new'][0], r['evaluationSpeedup'], r['training']['old'][0], r['training']['new'][0], r['wall']['old'][0], r['wall']['new'][0], -100 * r['wallReduction'], 'yes' if r['identicalNumbers'] else 'NO')
resp = '\n'.join(row(r) for r in rs)
dflt = '\n'.join('| %s | %.2f | %.2f (%d threads) | %.2f | %.2f | %s | %.3f | %.3f |' % (names[r['fixture']], r['wall']['old'][0], r['default59']['wallSeconds'], r['default59']['evaluationThreads'], r['default59']['wallSeconds'] / r['wall']['old'][0], r['sampled59']['wallSeconds'], r['sampled59']['opponentActions'], r['default59']['simultaneousNashConvLowerBound'], r['sampled59']['simultaneousNashConvLowerBound']) for r in rs)
tr = '\n'.join('| %s | %d | %s | %.3f (%.3f) | %.3f (%.3f) | %.3f | %s | %s |' % (r['case'], r['threads'], format(r['deals'], ','), r['seconds']['old'][0], r['seconds']['old'][1], r['seconds']['new'][0], r['seconds']['new'][1], r['ratio59Over58'], format(round(r['dealsPerSecond']['new']), ','), 'yes' if r['identicalStates'] else 'NO') for r in R['training'])
ev = '\n'.join('| %s | %s | %.3f (%.3f) | %.3f (%.3f) | %.2f | %s |' % (r['game'], r['measure'], r['seconds']['old'][0], r['seconds']['old'][1], r['seconds']['new'][0], r['seconds']['new'][1], r['ratio59Over58'], 'yes' if r['identicalValues'] else 'NO') for r in R['evaluation'])
stu = '\n'.join('| %s | %.3f (%.3f) | %.3f (%.3f) | %.2f | %s |' % (r['fixture'], r['seconds']['old'][0], r['seconds']['old'][1], r['seconds']['new'][0], r['seconds']['new'][1], r['ratio59Over58'], 'yes' if r['identicalMeasurements'] else 'NO') for r in R['study'])
ca = '\n'.join('| %s | %s | %s | %s | %s | %.0f%% | %s |' % (r['fixture'], format(r['evaluationDeals'], ','), format(r['walk58']['d1Misses'], ','), format(r['walk59NoIndex']['d1Misses'], ','), format(r['walk59']['d1Misses'], ','), 100 * (1 - r['walk59']['d1Misses'] / r['walk58']['d1Misses']), 'yes' if r['walk58']['gainBits'] == r['walk59']['gainBits'] == r['walk59NoIndex']['gainBits'] else 'NO') for r in R['cache'])
wv = lambda rows: '\n'.join('| %s | %s | %s | %d | %d (x%.2f) | %d (x%.2f) | %d (x%.2f) |' % (r['fixture'], format(r['evaluationDeals'], ','), r['opponentActions'], r['ms'][0], r['ms'][1], r['ms'][0] / r['ms'][1], r['ms'][2], r['ms'][0] / r['ms'][2], r['ms'][3], r['ms'][0] / r['ms'][3]) for r in rows)
sp = [r['evaluationSpeedup'] for r in rs]; wr = [r['wallReduction'] for r in rs]; met = [names[r['fixture']] for r in rs if r['wallReduction'] >= 0.20]; tratio = [r['ratio59Over58'] for r in R['training']]
SE = json.load(open(root / 'validation/5.9/performance/sample-vs-enumerate.json'))
se = '\n'.join('| %s | %s | %s | %.1f | %.0f | %.3f | **%.3f** | %.3f |' % (names[r['fixture']], mode, format(r[m]['evaluationDeals'], ','), r[m]['evaluationSeconds'], r[m]['visitsPerDeal'], r[m]['sumOfSeatGainsEstimate'], r[m]['simultaneousNashConvLowerBound'], r[m]['pooledNashConvLowerBound']) for r in SE['rows'] for m, mode in (('enumerate', 'enumerated'), ('sample', 'sampled')))
idx = {r['fixture']: r['sample']['offsetIndexBytes'] for r in SE['rows']}
rss = '\n'.join('| %s | %.1f | %.1f |' % (names[r['fixture']], r['peakRssMiB']['old'], r['peakRssMiB']['new']) for r in rs)
doc = f'''# EightMax 5.9: performance

Build `@BUILD@` against the unchanged 5.8 binary (build `d4001e2c0cd77f41`). Tool:
`validation/5.9/performance/bench59.py`; plan written before measurement (`plan.json`), results in `result.json`.

**Which build was measured.** The benchmark ran with build `{P['new']['build'].replace('EightMaxBuild=', '')}`. The release build differs from it
in two test tools only (`tools/host_refusal59.js`, `tools/validate_windows59.ps1`); every C and C++ source file is
byte-identical, so the programs differ in the embedded build identifier and in nothing that executes.

**Where these numbers come from.** A development container: {P['environment']}, {P['logicalProcessors']} logical
processors, no hardware performance counters. **Nothing was measured on the target PC** (i7-13700F, 24 logical
processors) **or on any GPU.** Ratios between the two programs on the same machine are the evidence; absolute times
will differ on other hardware, and the gains from fewer cache misses depend on the cache hierarchy. Every comparison
alternates the programs (one run of each per repetition); medians, with the minimum in brackets.

## 1. Summary

| Question | Answer | Section |
|---|---|---|
| Is the evaluation of a trained response faster? | **Yes: {min(sp):.2f} to {max(sp):.2f} times** at one thread with identical numbers; largest on tables that do not fit the processor's caches | 2 |
| Is the whole response analysis faster? | At one thread, same request: wall time {100 * min(wr):+.0f}% to {100 * max(wr):+.0f}% (negative: slower). **The 20% target is met on {len(met)} of {len(rs)} cases** ({'; '.join(met) if met else 'none'}); where the unchanged response training dominates, the total hardly moves. | 2 |
| What does a user get by default? | Evaluation on every logical processor: {min(r['default59']['wallSeconds'] / r['wall']['old'][0] for r in rs):.2f} to {max(r['default59']['wallSeconds'] / r['wall']['old'][0] for r in rs):.2f} of the 5.8 wall time on four processors | 2.3 |
| Is the response training faster? | **No.** It is the 5.8 trainer (ratios {min(r['trainingRatio'] for r in rs):.2f} to {max(r['trainingRatio'] for r in rs):.2f}, i.e. noise). | 2 |
| Did default training throughput change? | **No**: 5.9 / 5.8 seconds {min(tratio):.3f} to {max(tratio):.3f}; states byte-identical | 3 |
| Exact and sampled evaluation, complete studies | unchanged within noise; identical values | 4 |
| Strategy-table memory access | evaluation walk: {min(100 * (1 - r['walk59']['d1Misses'] / r['walk58']['d1Misses']) for r in R['cache']):.0f} to {max(100 * (1 - r['walk59']['d1Misses'] / r['walk58']['d1Misses']) for r in R['cache']):.0f}% fewer first-level data-cache misses and two dependent reads per lookup instead of four; trainer: unchanged (one experiment rejected) | 2.2, 5 |
| Peak memory | response analysis: unchanged or lower; the offset index is 4 bytes per hash slot for the duration of one evaluation call, charged to the evaluation budget | 6 |
| GPU | not involved: no CUDA code changed, nothing was run on a GPU | 7 |

## 2. Trained-response analysis

### 2.1 Same request, same numbers, one thread

`mwcli --response`, {P['responseRequest']['responseDeals']:,} response deals and {P['responseRequest']['samples']:,} evaluation deals per seat, seed 58, one thread; 5.9 with
`"randomStreams": "5.8"` so that both programs compute the same numbers (estimate bits, standard error and visit
count of every seat compared: column "identical"). States: 250,000 training deals for the study fixtures, 20,000 (5,000
for the ICM final table) for the reference games. {P['repetitions']['response']} alternating repetitions. Seconds, summed over the seats.

| Case | Seats | Opponent actions | Evaluation 5.8 | 5.9 | **speed-up** | Response training 5.8 | 5.9 | Wall 5.8 | 5.9 | **wall** | identical |
|---|---|---|---|---|---|---|---|---|---|---|---|
{resp}

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
{wv(W['largeTables']['rows'])}

Small tables (all seats):

| Game | Evaluation deals | Opponents | 5.8 walk | 1: lean walk | 1 + 2: with index | 1 + 2 + 3: with look-ahead |
|---|---|---|---|---|---|---|
{wv(W['smallTables']['rows'])}

The second table is why look-ahead is restricted to large tables: where every lookup is already in the cache the
extra pass over the children costs 10 to 20%. The release candidate that used look-ahead for every enumerated walk
was measured, found slower on these games, and corrected before release; the table above is that measurement.

First-level data-cache misses of the evaluation (valgrind cachegrind, deterministic counts; the 5.9 program with
`EIGHTMAX_RESPONSE_WALK=5.8`, with `EIGHTMAX_RESPONSE_INDEX=0`, and by default):

| Fixture | Evaluation deals | 5.8 walk | 5.9 walk without index | 5.9 walk | fewer misses | same estimate bits |
|---|---|---|---|---|---|---|
{ca}

The miss count falls by less than the time does: the index does not remove the misses on the values; it lets two of
the remaining misses overlap, which a miss count does not show.

### 2.3 What a user gets without asking

5.9 only, the same states: the default request (5.9 streams; `threads` absent, so the evaluation uses every logical
processor - four here) and the same with `"futureActions": "sample"`. Other random numbers than in 2.1, so times only.

| Case | 5.8 wall (one thread, 2.1) | 5.9 default wall | relative to 5.8 | 5.9 with sampled opponent actions, wall | (opponents) | simultaneous NashConv bound, default | with sampled actions |
|---|---|---|---|---|---|---|---|
{dflt}

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
{se}

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

{P['repetitions']['training']} alternating repetitions; seconds of the training call, median (minimum); frozen batches with every update on all
threads of the call (`EIGHTMAX_THREAD_CHOICE=fixed`).

| Case | Threads | Sampled deals | 5.8 s | 5.9 s | 5.9 / 5.8 | 5.9 deals per second | states identical |
|---|---|---|---|---|---|---|---|
{tr}

The ratios are within the run-to-run spread of one program (compare each median with its minimum). The trainer's
source is unchanged; so is its thread scaling. The prefetch experiment in the trainer's lookup
(`validation/5.9/experiments/prefetch-row-slot.md`) changed nothing measurable and was not adopted.

## 4. Other evaluators and complete studies (no change intended)

{P['repetitions']['evaluation']} alternating repetitions, process wall seconds, median (minimum).

| Game | Measure | 5.8 s | 5.9 s | 5.9 / 5.8 | identical values |
|---|---|---|---|---|---|
{ev}

| Study (`mwcli --study`, two seeds, budgets 20,000 and 60,000 deals, two threads) | 5.8 s | 5.9 s | 5.9 / 5.8 | identical measurements |
|---|---|---|---|---|
{stu}

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
{rss}

5.9 no longer keeps the probe copy of the state beside the first seat's copy. The offset index adds 4 bytes per hash
slot during an evaluation call ({idx['flop3-kings'] / 1048576:.0f} MiB for the three-player flop fixture, {idx['btn25-open'] / 1048576:.0f} MiB for the preflop fixture) and is
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
'''
(root / 'PERFORMANCE-5.9.md').write_text(doc); print('PERFORMANCE-5.9.md', len(doc.splitlines()), 'lines')
