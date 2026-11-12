# EightMax native multiway protocol, version 1

The desktop host (`EightMax.exe`) trains sampled multiway studies in native C++
(`mw.cpp`). The JavaScript game in the browser worker stays the reference
implementation, the evaluator and the user interface. It builds the betting
tree and sends it to the host. After each training chunk it copies the
host's state back into its own profile, so the explorer, accuracy checks,
exact cross-checks and `.emstudy` checkpoints use unchanged JavaScript code.

`GET /api/info` reports `"multiwayProtocol": 1` when the host supports this protocol.
POST requests need the `X-EightMax: 1` header and a `Host` of `127.0.0.1:<port>`
or `localhost:<port>` (same rules as every other host route).

## Eligibility (3.1)

Native training is used when `wideGame.nativeSupport()` returns `null`: sampled
private ranges and Exact cards grouping, with chip EV or ICM, from any street
(preflop linked or shove/call, flop, turn, river), two to eight live seats.

- Full betting traversal (spec protocols 1 and 3): the JavaScript tree is sent as
  `nodes`. Automatic native traversal first COUNTS the tree without keeping it
  and uses full traversal up to 20,000 states. An explicit full traversal still
  accepts up to 250,000.
- Sampled betting traversal (external-sampling MCCFR, spec protocol 4): the
  betting RULES are sent and the engine generates states on demand. There is no
  tree-size limit other than the memory budget.

Compact and Detailed hand groups train in JavaScript and the result records
why (`metrics.trainingEngine.fallbackReason`).

## Routes

| Route | Method | Body | Result |
|---|---|---|---|
| `/api/mw/init` | POST | spec JSON (below) | `{ok, budgetMiB, engine: info}`; 400 with a message if invalid or over the memory budget |
| `/api/mw/import` | POST | EMMW1 bytes | `{ok:true}`; replaces the training state (resume) |
| `/api/mw/train` | POST | `{iterations: 1..10,000,000, threads: 1..256}` | starts training in the background; 409 while a job runs |
| `/api/mw/status` | GET | — | `{protocol, loaded, running, iterations, trainingDeals, target, elapsed, threads, error, engine}` (`engine` = info when idle) |
| `/api/mw/stop` | POST | `{}` | asks the job to stop after the current update |
| `/api/mw/state` | GET | — | EMMW1 bytes (409 while training) |
| `/api/mw/free` | POST | `{}` | releases the native tables |
| `/api/memory` | GET/POST | POST `{browserMiB}` | `{appLimitMiB, processLimitMiB, residentMiB, multiwayTablesMiB, browserReportedMiB, availableForTablesMiB, systemRamMiB}` |

`info` = `{protocol, iterations, trainingDeals, stateVisits, rng, rows, tableMiB, limitReached, threads, batchDeals, seconds:{deal, traverse, merge}}`.

## Spec (JSON, protocol 1)

```
{ "protocol": 1, "n": 2..8, "board": [3-5 cards 0..51],
  "hands": [ [[comboId, cardA, cardB, weight], ...] per seat ],     // the seat's sampled range, in JavaScript order
  "anteOf": [per-seat chips subtracted at terminals],
  "nodes": [ [0, actor, streetLength, [child ids]]                   // decision
           | [1, streetLength, child id]                             // next street (cards come from the sampled deal)
           | [2, [total committed per seat], [[amount, [eligible seats]], ...]] ],   // terminal pots
  "batchDeals": 1..64, "weighting": "linear"|"uniform", "regretMatching": "standard"|"plus",
  "updates": "simultaneous"|"alternating"|"enumerate",
  "state": { "rng": uint32, "iterations": n, "trainingDeals": n, "stateVisits": n } }
```

Node 0 is the root, and children always have larger ids than their parents.
The engine checks every field. Seats, cards, weights, tree shape, pot
eligibility, batch sizes and option names out of range are refused.

## State (EMMW1, little-endian)

```
"EMMW1\0\0\0" | u32 headerLength | header JSON (info above) | u32 rowCount |
rowCount x ( u32 node | u16 hand index in the seat's range | u8 extra public card 1 (+1, 0 none) |
             u8 extra public card 2 | u8 k | k x f64 cumulative regret | k x f64 cumulative average weight )
```

The extra cards are the turn/river cards dealt after the starting board, for
information sets on later streets. Imports are fully validated before any
value changes. Rejected: wrong magic, truncation, trailing bytes, rows that
don't match the tree, non-finite values, negative averages, rows over the
memory budget.

## Compatibility guarantees

- **Same results.** With equal settings, native training gives bit-identical
  regrets and averages to `lib_wide.js` at any thread count. It uses the same
  random stream, deal sampler, operation order and frozen-batch rules, built
  with `-ffp-contract=off` and no fast-math. This is checked by
  `tests/v29.test.js` across river, turn and flop starts, all update schemes,
  CFR+ clipping and uniform weighting. JavaScript also stores empty rows for
  information sets it only reads; empty and missing rows both mean uniform play.
- **Checkpoints.** `.emstudy` files are written by JavaScript from its own
  profile, so the native engine adds no new checkpoint format. A study can
  move JavaScript → native → JavaScript and continue identically (tested).
  2.8 and earlier checkpoints load unchanged. A file from an unknown engine is
  refused and the message names its engine and writer.
- **Versioning.** A different `protocol` number is refused by both sides. A
  future incompatible change will bump it.

## Version 3.0 extensions

The service continues to advertise transport protocol 1. A spec using native ICM,
a preflop root, or stratified sampling declares spec protocol 3. A 2.9 host
rejects that spec. The UI can train the selected utility in JavaScript.
For ICM the spec includes start stacks for every remaining player, off-table
stacks, and descending payouts. Each terminal also supplies chips behind before
pot awards. The engine awards every layer before calculating tournament prizes.

Linked roots use EMMW3 row records with three additional bytes immediately after
the action count. Five card slots retain the sorted flop, then turn and river.
Zero represents an unrevealed card; a revealed card uses card ID plus one.
Postflop EMMW1 records retain the two-card extension. New headers include a
study tag and CRC32 over the count and row payload. The portable .emstudy
envelope continues to use SHA-256. Legacy chip-EV rows have no study identity
or row checksum.

Execution fields are device (cpu, auto, gpu, hybrid) and gpuMiB (1–8192).
Training counters, RNG draws and regret reduction order are independent of the
scoring device. GPU batches finish before traversal, checkpoint export or cancellation.

## Version 3.1: spec protocol 4 (native betting rules + external sampling)

```
{ "protocol": 4, "algorithm": "external", "n", "board", "hands", "anteOf", "icm"?,
  "rules": { "stacks":[n], "prior":[n], "folded":[...], "common", "pot0", "ownAnte":[n],
             "posted":[n], "open":[bool n], "pre", "shove", "noLimp",
             "sizes": { "0"|"3"|"4"|"5": { "cap", "bets":[[kind,value]], "raises":[[kind,value]] } } },
  "batchDeals", "weighting": "linear"|"uniform", "regretMatching", "actionStreams": "shared"|"deal",
  "actionSeed": uint32, "device", "gpuMiB",
  "state": { "rng", "actionRng", "iterations", "trainingDeals", "stateVisits" } }
```

Size kinds: 0 all-in, 1 geometric, 2 pot fraction, 3 raise multiple, 4 absolute
(preflop opens). `mw_es.hpp` regenerates every state with the operations of
`lib_river.js` `build()`, `advance()`, `nextStreet()` and `EM.potLayers()`, and
trains with the update of `lib_wide.js` `learn()`. Results are bit-identical to
JavaScript (tests/v31.test.js covers 12 configurations, including 8-seat linked
preflop to river, ICM, shove/call, all-ins, CFR+ and uniform weighting).

`actionStreams: "shared"` reproduces JavaScript's single opponent-action stream
and traverses one deal at a time. `"deal"` gives each (iteration, deal) its own
stream seeded with `actionSeed ^ (it+1)*0x9e3779b1 ^ (deal+1)*0x85ebca6b`
(also implemented in JavaScript), so the deals of a frozen batch are traversed
in parallel. Results never depend on the thread count. DCFR and stratified
sampling are refused in protocol 4.

### EMMW4 state

```
"EMMW4\0\0\0" | u32 header length | header JSON (info + rowCrc32) | u32 state count |
states x (u32 parent, 0xffffffff for the root | u8 action slot, 7 = next street |
          u8 kind 0 decision / 1 chance | u8 actor | u8 street length | u8 actions) |
u32 row count | rows x (u32 state | u16 hand index | u8 x5 public cards +1, 0 unrevealed,
                        flop sorted | u8 k | k f64 regrets | k f64 average weights)
```

States are listed parent-first and reproduce the JavaScript action paths
(`'r' + slots`, `'c'` for a street change). `rowCrc32` covers everything after
the header. The engine rejects an import unless every state replays from the
rules with the stored description, every row's cards match the board and street,
and the estimated tables fit the budget; nothing changes before validation
completes. JavaScript checks every state (up to 20,000, otherwise an evenly
spaced sample) against its own tree.

### Other 3.1 routes

| Route | Method | Result |
|---|---|---|
| `/api/info` | GET | adds `multiwaySpecProtocols: [1,3,4]` and `cuda` (probe, cached) |
| `/api/equity` | POST `{hands:[[a,b],...], board?, device: cpu/gpu/both, threads?, gpuMiB?}` | exact all-in equity by complete board enumeration |
| `/api/mw/import` | POST | body limit raised to half the application budget (at most 2 GiB) |

`cuda` = `{available, reason, name, computeCapability, driverVersion, image,
totalMiB, freeMiB, reserveMiB, defaultBufferCapMiB}`. Devices below compute
capability 7.5 are refused. The module loads the embedded SASS for the device's
architecture family (sm_75, sm_80, sm_86, sm_89) when available, otherwise JIT
compiles the compute_75 PTX. Every GPU allocation leaves max(1 GiB, 25% of the
device) free and stays under `gpuMiB`.

Equity accumulates 840 share units per board (divisible by 1..8 winners), so CPU
and GPU totals are exact integers and must be equal. A GPU failure returns the
CPU answer with `gpuFallbackReason`.

## Version 3.3 extensions

The transport protocol stays 1 and spec protocol 4 is unchanged for existing
studies: 3.3 writes byte-identical EMMW4 files for every 3.2 configuration.

### Stricter validation

`mw_create` now refuses: an `anteOf` that is not an array of one finite number
from 0 to 10 BB per seat (3.2 ignored malformed arrays and accepted negative
entries); for protocol 4, an `anteOf` that differs from `rules.ownAnte` preflop
or from zero postflop; a `rules.pot0` that differs from `common + sum(prior) +
sum(folded) (+ sum(ownAnte) preflop)` (chips not conserved); a `posted` blind
larger than the seat's stack, or any blind postflop; non-boolean `open` entries;
folded wagers larger than the largest live contribution; non-integer
`protocol`, `n`, `batchDeals`, state counters, pot seats or chance lengths;
negative or non-finite terminal contributions and pots; duplicate pot seats,
duplicate hands, hand identifiers that do not match their cards, and range
weights whose sum overflows. EMMW1 imports refuse fractional counters. `mwcli`
refuses non-numeric, fractional or out-of-range iterations, threads and memory.

### External-sampling DCFR (`"weighting": "dcfr"`)

Optional `dcfrAlpha` (default 1.5, >= 0), `dcfrBeta` (default 0) and `dcfrGamma`
(default 2, >= 0), finite and within ±16. After iteration u, positive cumulative
regrets are multiplied by u^a/(u^a+1) and negative ones by u^b/(u^b+1). Each row
stores the iteration through which its regrets are discounted and catches up
when it is next updated (identical to eager discounting in exact arithmetic;
regret matching is unaffected by the common factor on positive regrets).
Average-strategy contributions of iteration t are weighted by t^g, which equals
the (t/(t+1))^g discount after normalization. `dcfrEager: true` selects the
textbook eager schedule for validation only (O(rows) per update).

EMMW4 headers of DCFR states contain `"rowSync": 1` and every row record ends
with `u32` discount iteration (at most the header's iteration count). States
with and without `rowSync` are not interchangeable.

### Native Compact and Detailed hand groups (`"groupKeys"`)

```
"abstraction": "compact"|"detailed",
"groupKeys": { "abstraction": "compact"|"detailed", "small": [bool per seat] }
```

`small[p]` is true when the seat's JavaScript range has at most 12 hands (those
keep a hand-specific key on the starting street). The engine computes the keys
of lib_wide.js `seatKey()` itself (`es_groups.hpp`): `256 + combo id`, the
169-class index preflop, `strengthGroup()` (Compact) or `handFeatures().key`
(Detailed), chained as `previous * 2048 + signal` or `previous + '/' + signal`.
Deals, blockers, showdowns, side pots, chip EV and ICM use the physical cards.
Used for external-sampling studies that 3.2 trained in JavaScript: flop and
preflop starts and turn starts above the 32,768-entry representative table.
`turnGroups`/`riverGroups` studies keep their 3.2 representation.

EMMW4 headers of grouped-key states contain `"rowKeys": 1`; each row record is
`u32 state | u16 key length | key bytes | u8 k | k f64 regrets | k f64 averages
(| u32 discount iteration)`. Compact keys are canonical decimal integers below
2^53; Detailed keys start with `0/` and carry one `/` per street so far.

### Diagnostics added to `info`

`weighting`, `dcfr {alpha, beta, gamma, scheduleBytes, lazyRowDiscount}`,
`handGroups {abstraction, keys, dictionaryBytes, native}`, `requestedDevice`,
`gpuStageBound {scoringShare, maxSavingFraction}` (the measured share of training
time spent scoring hands, which bounds any GPU offload of that stage),
`seconds.profiledUpdates` and `seconds.scoreInProfiledUpdates` (one update in 16 is timed, to keep clock reads off the hot path); `mwcli` adds `processPeakRssMiB`.

## 3.9: explorer, action-EV and response-gain requests

All three requests are JSON objects, at most 64 KiB, validated against a fixed
schema (`explorer.hpp` `Fields`). Unknown or duplicate fields, a non-object
body, `null`, a string/boolean/array/object where an integer is expected,
fractional or out-of-range integers, oversized arrays and duplicate or
board-blocked cards return HTTP 400 (413 when too large) with a message naming
the field. Omitted optional fields take the defaults listed below; nothing is
coerced. Optional `studyId` (string) and `stateId` (integer) must match the
open study and the resolved decision, otherwise 409.

POST /api/mw/node (mwcli --node): `path` int[0..7] (<= 480), `board` int[0..51]
(<= 5, distinct, not on the study board), `rangeSeat` 0..n-1 (default: actor),
`offset` 0..range size (default 0), `limit` 1..1326 (default 1326).

POST /api/mw/ev (mwcli --ev): `path`, `board` as above, ending at a decision;
`hands` (<= 64 distinct indices of the acting seat's range, not board-blocked)
and/or `range: true`; `policy` "average" (default) | "current"; `missing`
"uniform" (default; substitution reported as fallbackShare) | "refuse" (422);
`method` "auto" (default) | "exact" | "sampled"; `futureActions` "auto" |
"enumerate" | "sample"; `samples` 16..2,000,000 (default 20,000); `seed`
0..2^32-1 (default 1); `maxVisits` 1,000..2e9 (default 2e7, exact budget);
`timeLimitMs` 100..3,600,000 (default 60,000). Response: node, policy,
utility {model chip|icm, unit, convention}, actions, method, per hand: ev[],
stdErr[]/ci95[] (sampled) or null (exact), mixed, diff[], best,
equivalentToBest[], fallbackShare[], strategy[], reach, samples; optional range
aggregate; cache {hit}. The cache holds at most 32 results per engine and is
cleared by training and imports.

POST /api/mw/response-gain (mwcli --gain): `method` "sampled" (default) |
"exact"; `seats` (distinct, default all); `path`/`board` (sampled, one seat);
`policy`, `missing`, `samples` (64..2e6), `selectionSamples` (16..1e5),
`reachSamples`, `seed`, `maxVisits` (default 2e8), `timeLimitMs` (default
120,000), `futureActions`. Exact: per-seat best-response value, policy value
and gain; nashConv for all seats; exploitability only for two seats with chip
EV. Sampled: per seat the node, conditional gain, reach probability and gain
with standard errors (one-shot deviation class; a lower bound).

The node-cancel endpoint also cancels EV and response-gain calculations.

## 4.0: deadlines, cancellation, background evaluation jobs

### Deadline and cancellation semantics (action EV and response gain)

* `timeLimitMs` (100 .. 3,600,000) is measured on the monotonic clock
  (`std::chrono::steady_clock`), from the moment the request is parsed. Wall
  clock changes cannot move it.
* Every expensive loop polls a shared control (ev_control.hpp): game-tree
  traversal, board runouts, showdown-table construction, rank-pattern counting,
  chance-card enumeration, opponent-hand enumeration, reach weights, rejection
  retries, ICM terminals, best-response traversal and tuple enumeration,
  deviation selection, subtree sizing, CUDA batches. The poll interval adapts to
  the measured cost of the loop (target: one clock check per 0.125-1 ms).
* **Tolerance:** the evaluation returns within `timeLimitMs + 50 ms` on an idle
  machine; measured on the reproduced eight-player case: +1.4 to +2.0 ms (Linux)
  and +1.4 to +1.8 ms (Windows build under Wine). The response reports
  `deadline.maxCheckGapMs`, the longest measured interval between two checks.
  A deadline is resource control, not a promise that an exact result completes.
* Exact evaluations that time out return **HTTP 408** and no numbers ("an
  incomplete exact result is never reported"). Cancelled evaluations return
  **HTTP 409** naming the phase in which the cancellation was observed.
* Sampled evaluations stopped by the time limit return their completed samples
  with `"status":"partial"` / `stoppedEarly:true`, but only when at least
  `minSamples` (default 100) samples were completed; otherwise the hand is
  reported unavailable.
* `maxVisits` remains an independent work budget for exact evaluations: it
  counts game-tree nodes and terminal evaluations (not showdown-table boards,
  which every worker may build for itself and which are reported as
  `execution.boardsScored`), so `visits` and the budget decision are identical
  for every thread count (checked against the exact total after the workers join).
* All worker threads are joined before the request returns; temporary showdown
  tables and caches are released; the engine state is never modified.

### New action-EV request fields (all optional)

| Field | Values | Default | Meaning |
|---|---|---|---|
| `threads` | 1..64 | min(8, host cap) | evaluation threads; results do not depend on it |
| `memoryMiB` | 16..4096 | 512 | budget for showdown tables and caches (over budget: per-board enumeration) |
| `device` | `auto`, `cpu`, `gpu`, `hybrid` | `auto` | processing of showdown tables (see below) |
| `gpuMiB` | 16..6144 | 512 | VRAM budget for showdown tables |
| `utility` | `study`, `chip`, `icm` | `study` | `chip` evaluates net chips in an ICM study; `icm` requires a payout table |
| `minSamples` | 16..2,000,000 | 100 | samples needed for a partial estimate and for statistical classification |
| `equivalenceMargin` | > 0 | none | enables the TOST equivalence test, in utility units |
| `fallback` | `uniform`, `foldCheck`, `callCheck` | `uniform` | policy substituted where no strategy is stored |
| `fallbackWarnShare`, `fallbackSevereShare` | 0..1 | 0.05, 0.25 | coverage warning thresholds |
| `fallbackSensitivity` | boolean | false | recompute exact EVs under all three fallback policies |

### New action-EV response fields

`status` (`completed`/`partial`), `threads`, `minSamples`, `statistics`,
`coverage` (`policyLookups`, `storedLookups`, `fallbackLookups`,
`distinctInformationSets`, `distinctFallbackInformationSets`, `rowCoverage`,
`maxActionFallbackShare`, `opponentReachFallbackShare[]`,
`maxOpponentReachFallbackShare`, `samplesEvaluated`, `samplesWithFallback`,
`sampleFallbackShare`, `influence` = none/minor/notable/substantial,
`warning`), optional `fallbackSensitivity`, `execution` (device, showdown
tables, boards scored on CPU/GPU, hybrid tables, peak evaluation memory,
`gpuNote`), `deadline`, `subtreeNodesIsLowerBound`. Per hand: `status`,
`vsBest`, `vsBestCi95`, `classification[]`, `interpretation[]`,
`differenceSupported[]`, `practicallyEquivalent[]` (null without a margin),
`samplesWithFallback`. `equivalentToBest` is kept for compatibility with the
narrower 4.0 meaning (best action, exact tie, exact difference within the
margin, or a passed equivalence test).

Classifications: exact `highest | exactTie | withinMargin | lower`; sampled
`highestEstimate | differenceSupported | differenceUncertain |
practicallyEquivalent | insufficientSamples`. "differenceUncertain" means the
95% interval of the paired difference contains zero and is never presented as
equivalence.

### Showdown tables and CUDA scheduling

Exact runouts score each deal's board completions once (all seats) and reduce
them to integer histograms of rank patterns per set of contesting seats.
`auto` uses CUDA only for tables of at least 262,144 seven-card evaluations,
after verifying the device against the CPU on the first 65,536 boards
(integer-exact) and measuring it at least 10% faster; `gpu` uses it whenever
it works; `hybrid` splits a table between the GPU and the CPU in proportion
to measured speed; a busy device leaves a table to the CPU. Any failure
(missing driver, compute capability below 7.5, VRAM reserve, allocation,
launch, download, mismatch) falls back to the CPU for the remaining boards and
is reported in `execution.gpuNote`. EVs are bit-identical for every device.

### Response gains

`method`: `exact` (`mode` `exactBestResponse`), `restricted`
(`restrictedBestResponse`; fields `selection` = auto/exact/sampled, `maxNodes`
1..4096), `sampled` (`sampledOneDecisionDeviation`). Per seat: `elapsedMs`,
`policyLookups`, `fallbackLookups`; restricted seats also `decisionNodes`,
`nodesTruncated`, `handDecisions`, `handDecisionsChanged`, `gain{mean,
stdErr, ci95, samples}`.

### Evaluation jobs (desktop host)

| Route | Method | Result |
|---|---|---|
| `/api/mw/jobs/ev` | POST, body = action-EV request | 202 job summary; 400/409/413/422 for invalid requests (validated before a job exists); 503 queue full or worker start failure |
| `/api/mw/jobs/response-gain` | POST, body = response-gain request | as above |
| `/api/mw/jobs` | GET | `{config, jobs[]}` in submission order |
| `/api/mw/jobs/<id>` | GET | job summary + `progress` + `request` |
| `/api/mw/jobs/<id>/result` | GET | the stored result (200) or 409 if the job is not completed |
| `/api/mw/jobs/<id>/cancel` | POST | pending: cancelled at once; running: cancellation requested |
| `/api/mw/jobs/<id>/release` | POST | frees a finished job (409 for pending/running jobs) |
| `/api/mw/jobs/config` | GET/POST `{workers 1..8, threadsPerJob 1..64, memoryPoolMiB 64..16384}` | current configuration |

Job summary: `jobId`, `kind`, `status` (pending, running, completed,
cancelled, timedOut, failed), `studyId`, `createdUnix`, `queuedMs`,
`runningMs`, `memoryMiB`, `timeLimitMs`, `cancelRequested`, `overdue`, and for
finished jobs `httpStatus`, `partial`, `resultBytes`, `error`. Progress:
`stage`, `elapsedMs`, `visits`, `samples`, `unitsDone`, `unitsTotal` (work
items scheduled so far; not a completion percentage), `showdownTables`,
`boardsScored`, `gpuBoards`, `evaluationMiB`, `peakEvaluationMiB`.

Defaults: 2 workers, threads per job = logical CPUs / 2 (at most 8), memory
pool = a quarter of available RAM (256..2,048 MiB), 16 pending jobs, 32
retained jobs (the oldest finished job is evicted first). Running jobs and the
explorer read the study concurrently; training, imports, restores, `free` and
`init` are refused (409) while any evaluation reads it, and a queued job whose
study changed fails with an explanation instead of evaluating another study.

## 4.1: input safety, statistics, work budgets, parallel response gains

### Numeric input validation (all routes)

Every numeric field is checked **before** it is converted to an integer or a
float (`native/num_safe.h`): JSON type (numbers only; `null`, numeric strings,
booleans, arrays and objects are refused, except where a route documents
booleans), finiteness (the JSON parser already refuses literals such as `1e999`),
the integer requirement, representability in the destination type (compared
with exact powers of two), and the documented minimum and maximum. Invalid
values are answered with HTTP 400 (413 when a valid memory request exceeds the
evaluation pool) and a message naming the field; nothing is clamped and no
default replaces a present-but-invalid value. Omitted fields take the
documented defaults. In 4.0, 10 of 16 probed input paths performed an
out-of-range conversion before validation (`validation/4.1/numeric-ub-probe-4.0.json`).

Ranges that were previously implicit are now explicit:

| Route | Field | Accepted |
|---|---|---|
| `jobs/ev`, `jobs/response-gain` | `memoryMiB` | integer 16-4096 (default 512); above the pool: 413 |
| | `timeLimitMs` | integer 100-3,600,000 (defaults 60,000 / 120,000) |
| `jobs/config` | `workers`, `threadsPerJob`, `memoryPoolMiB` | integers 1-8, 1-64, 64-16,384 (the pool is capped at half the available RAM and the response reports the value in force) |
| `mw/init` | `tableLimitMiB` | number > 0 and <= 1,048,576 (4.0 ignored invalid values) |
| `mw/train` | `iterations`, `threads` | integers 1-10,000,000 and 1-256 (booleans are no longer accepted) |
| `/api/node`, `/api/lock` | `path` entries | integers 0-255, at most 64 |
| `/api/lock` | `strategy` entries | numbers 0-1 |
| `/api/solve`, `/api/report` | `maxIter` | integer 1-1e9; values above 49,000 are capped at 49,000 (documented legacy behaviour, unchanged) |
| | `target` | number 0-1e6; `power` integer 0-2; `reset` 0/1 or boolean |
| `/api/report` | `flops[i]` | `[card, card, card, weight?]`, cards 0-51, weight integer 0-1e9 (default 1) |
| `/api/build` | `compress`, `iso`, `gpu` | integers -1..1, 0..1, 0..1 or booleans; ICM utilities must fit in a float |
| `/api/equity` | cards, `threads`, `gpuMiB` | integers 0-51, 1-256, number 1-8192 |
| command line | `--port=` | integer 1-65535 |

### Background jobs

* A job's `timeLimitMs` counts from when the job **starts**, not from its
  submission (4.0 counted queue time, so a queued job could time out at once);
  `progress.elapsedMs` likewise excludes queue time (`queuedMs` reports it).
* A cancel that arrives while a job is being returned to the queue finishes it
  as `cancelled` immediately.
* `progress.boardEvaluations` is reported while a job runs.

### Action-EV statistics (sampled results)

Classes now come from simultaneous, family-wise 95% comparisons
(`native/action_stats.hpp`): `supportedBest`, `highestEstimate` (advantage
not established), `practicallyEquivalent` (only with `equivalenceMargin`),
`differenceSupported`, `differenceUncertain`, `insufficientSamples`. Exact
results are unchanged (`highest`, `exactTie`, `withinMargin`, `lower`). New
per-hand field for sampled results:

```
"multipleComparisons": {
  "familyConfidence": 0.95, "criticalValue": c, "unadjustedCriticalValue": 1.96,
  "pairs": k(k-1)/2, "simulationDraws": 20000,
  "supportedBest": a | null,
  "vsBestOfOthers": [mu_a - max_{b!=a} mu_b estimates],
  "vsBestOfOthersCi": [[lo, hi], ...],          // simultaneous
  "holmAdjustedPvsHighest": [...],
  "pairwiseCi": [[null, [lo, hi], ...], ...]   // simultaneous, row a column b: mu_a - mu_b
}
```

`stdErr`, `ci95`, `vsBestStdErr` and `vsBestCi95` keep their 4.0 meaning and
are labelled unadjusted. `statistics` describes the design, the method, the
stopping rule and the limitations.

### Work accounting and budgets (action EV and response gain)

New optional request field `maxBoardEvaluations` (integer 1,000-1e15; absent:
unlimited). One board evaluation = one board scored for every seat of the hand
(a showdown-table row, a GPU-scored board or a single scored runout). Tables
are charged in full before they are built; single boards every 256. When the
budget is exhausted an exact evaluation returns **422** with no numbers; a
sampled evaluation publishes a `partial` estimate only with at least
`minSamples` samples and reports `"stoppedBy": "maxBoardEvaluations"`
(`"timeLimit"` for the deadline).

Every response carries:

```
"work": { "units": "...", "treeVisits", "treeNodePolls", "chanceCards", "opponentTuples",
          "reachWeights", "boardRunouts", "boardEvaluations", "showdownTables", "tableCacheHits",
          "tableBoardsCpu", "patternCounts", "terminalUtilities", "icmEvaluations", "samples",
          "rejectedSamplingAttempts", "bestResponseNodes", "responseTuples", "selectionSteps",
          "subtreeSizingNodes", "gpuBatches", "gpuBoards", "workerTasks" },
"budgets": { "maxVisits", "maxBoardEvaluations", "samples", "timeLimitMs", "memoryMiB", "boardBudgetExhausted" }
```

Counts of different kinds are never added together. `maxVisits` is unchanged
(tree visits of exact evaluations).

### CPU/GPU scheduling report

`execution.gpuPeakMiB` (largest device allocation during the request) and
`execution.scheduling` with per-table decisions: `cpuForced`, `cpuSmallTable`,
`cpuGpuSlower`, `cpuGpuUnavailable`, `cpuGpuBusy`, `cpuAfterGpuFailure`, and
`gpuVerificationBoards` (the one-time bit-exact CPU/GPU check; not counted as a
GPU table).

### Response gains

Optional `threads` (1-64; default as for action EVs) and
`maxBoardEvaluations`. Seats are evaluated concurrently, each with its own
random streams (derived from seed and seat) and control block; results are
bit-identical for every thread count. The response reports `"version": "4.1"`
and `"threads"`.

## 4.4: IEEE 754 bit patterns, deadline phases, partial results, concurrent coverage, Automatic arms

Nothing was removed; every field below is an addition. Training, the state
formats (EMMW4 and earlier), betting rules and the default algorithm are
unchanged from 4.3: a 4.3 state continues in 4.4 with identical bytes.

### Bit patterns (exact comparisons)

| Field | Where | Meaning |
|---|---|---|
| `evBits` | every `hands[i]` and `range` object of an action-EV response, next to `ev` | array of strings, one per action: the IEEE 754 binary64 pattern of the corresponding `ev` entry as 16 lowercase hex digits; `null` where `ev` is `null` |
| `gainBits` | every seat of an exact response-gain response, next to `gain` | the pattern of `gain` |
| `valueBits` | every result of `mwcli --session`, next to `values` | the patterns of the compared values |

Compare these strings when results must be identical bit for bit. Decimal
`ev`/`gain` values are printed with `%.17g` and round-trip through any
correctly rounding reader; some readers are not (Windows PowerShell 5.1 reads
JSON fractions as System.Decimal, and Decimal to Double rounds twice). See
`validation/4.4/NUMERIC-POLICY.md`.

`mwcli --ieee` prints a probe table `{probes:[{name,bits,value,text}]}`;
`mwcli --ieee-verify <file>` parses such a document with the engine's JSON
reader and prints `{entries:[{bits,parsedBits,ulpDistance,textUlpDistance,identical}],probeCount,mismatches,textMismatches,worstUlpDistance}`
(exit 0 when every entry is identical, 1 otherwise, 2 for a malformed
document; a UTF-8 byte-order mark is accepted). `GET /api/mw/ieee-probe`
returns the same probe document from the desktop host (no engine lock).

### Deadline report

`deadline.phasesMs` (action EV and response gain): milliseconds after the start
of the request at which each phase ended; `null` when a phase was not reached.

| Key | Meaning |
|---|---|
| `workBegin` | validation, reach weights and cost estimate done; evaluation starts |
| `stopRaised` | a worker first published a stop condition (time limit, cancellation, budget) |
| `workEnd` | every worker has returned and per-hand statistics are computed |
| `statistics` | fallback-influence summary done |
| `coverageMerged` | coverage totals available (4.4: no merge; this follows `statistics` within microseconds) |
| `responseBuilt` | response body written |

Deadline tolerance (unchanged since 4.0): a request returns within
`timeLimitMs + 50 ms` on an idle machine and `+ 150 ms` under load. What remains
after the stop is a fixed amount of work (joining workers, the simulated
critical value of the simultaneous comparison, building the response,
releasing memory); it no longer grows with the limit or the thread count.

### Partial sampled results

A sampled action-EV response stopped by the time limit or the board budget
(`status: "partial"`) adds

    "partialResult": { "samplesCompleted": n, "samplesDiscardedInProgress": d,
                       "weights": "...", "uncertainty": "...", "limitation": "..." }

Only completed samples are counted, each with weight 1. Samples that were
being evaluated when the stop arrived are discarded whole (`d`, at most one per
worker per evaluated hand). Standard errors and simultaneous intervals use the
completed count. `limitation` states the residual length bias and its bound. A
partial result is never cached and an exact evaluation never returns one.

### Coverage

`coverage.structure` names how distinct information sets were counted:
`request-wide concurrent set (4.4)` (default) or `per-worker tables merged
after the workers stop` (`EM_EV_MERGED_COVERAGE=1`, the 4.3 path, kept for A/B
tests). Counts, `distinctCountKind` (`exact` / `lowerBound`), `capacity` and
`distinctEstimates` have their 4.3 meaning. With the concurrent set the exact
key limit applies to the union of all workers (in 4.3 the workers' tables
shared one byte pool, so several workers observing the same keys could exhaust
it and report `lowerBound` although the union was below the limit).
`capacity.tableBytes` is the slot memory the growth rule needs for the reported
number of keys (a function of that number only, so it does not depend on the
thread count); `execution.coverageSetBytes` is what was actually allocated and
can be one tier larger. The set starts
with 64 KiB and is promoted to a table four times larger whenever it is half
full (at most 8 slots of 16 bytes a key while growing, 2 slots a key at the
limit; earlier tiers are kept until the request ends, about one third more).
Allocated tiers are fully touched.

### Automatic device mode

`execution.auto44`: `rule`, `thisRequest` (how many tables of this request were
built by each arm: `cpu`, `gpuPull`, `gpuPreferred`, and `cpuMeasuredFaster`)
and `classes`, the process-wide statistics per (thread budget, log2 of
seat-board evaluations): decisions, the fastest arm and per arm the number of
measurements, times chosen and the mean nanoseconds per evaluation of whole
tables. `EM_GPU_AUTO_MODEL=4.3` selects the 4.3 rule. `EM_GPU_INIT_ESTIMATE_S`
now defaults to 0.1 (4.3: 0.3). `device: "cpu" | "gpu" | "hybrid"` behave as in
4.3.
