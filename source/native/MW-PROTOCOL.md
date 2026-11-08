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
