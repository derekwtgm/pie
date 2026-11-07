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

## Eligibility

Native training is used when all of these hold (`wideGame.nativeSupport()` returns `null`):
sampled private ranges, Exact cards grouping, a full betting tree (up to 250,000
betting states with `engine: 'native'`), chip EV, no stratified river batches, and
a postflop start. Update schemes: simultaneous, alternating, or own-hand enumeration
(`updates: 'enumerate'`). Anything else trains in JavaScript, and the result
records why (`metrics.trainingEngine.fallbackReason`).

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
