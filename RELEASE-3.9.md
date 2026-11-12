# EightMax Windows 3.9

Version 3.9 repairs the explorer's input-validation defect, adds natively
computed action-specific EVs and per-seat response-gain measurements, and
shows both in the strategy explorer. The training engine is unchanged: 3.9
trains byte-identical strategies to 3.8.

Everything below was built and measured on Linux (Ubuntu 24.04, 4 logical
CPUs, Intel Xeon @ 2.10 GHz). The Windows executables were cross-compiled with
MinGW-w64 GCC 13 and executed under Wine 9.0. **Nothing was run on physical
Windows or on an NVIDIA GPU; the RTX 4060 Ti results are unverified.** Use
`Run self-tests.bat` and `Validate CUDA hardware.bat` on the target PC.

## 1. Explorer input validation (Priority 1) — fixed

Cause: `explorer.hpp` read `offset`, `limit` and `rangeSeat` with `jnum()`,
which returns the default for strings, null, arrays and objects and 1/0 for
booleans. `{"rangeSeat":"nonsense"}` therefore became "the acting seat".

Fix (`native/explorer.hpp`, `Fields`/`parseRequest`/`resolvePath`): a single
strict validator shared by the explorer, action-EV and response-gain requests,
in the desktop host and in `mwcli`:

- body must be a JSON object of at most 64 KiB (413 otherwise); malformed JSON,
  NaN/Infinity/overflowing numbers and nesting deeper than 64 are rejected;
- unknown and duplicate fields are rejected;
- integers must be JSON numbers with no fractional part inside an explicit
  range (`offset` 0..range size, `limit` 1..1326, `rangeSeat` 0..n-1, path
  slots 0..7, at most 480 steps, cards 0..51, seeds 0..2^32-1 ...); strings,
  booleans, arrays, objects and `null` are refused with the field named;
- board cards must be distinct and off the study board; EV hands must be in
  range, distinct and not share a card with the board;
- unsupported action paths, paths past terminals or past an undealt chance
  node, and too many cards are refused (unchanged 3.8 rules);
- optional `studyId`/`stateId` must match the open study and the resolved
  decision (409);
- array lengths are bounded before any allocation; integer conversions happen
  only after range checks.

The host returns HTTP 400 for every malformed request and never a strategy
page. Omitted optional fields keep their documented defaults (MW-PROTOCOL.md).

Evidence: `tests/v39.test.js` (≈45 malformed node requests, ≈25 EV/gain
requests, HTTP 400 over the host), `tools/test_explorer_host.js` (also run
against the Windows host under Wine), Windows self-test checks.

## 2. Action-specific EVs (Priority 2) — implemented

`native/action_ev.hpp`, `POST /api/mw/ev`, `mwcli --ev`. For a decision node
and a hand of the acting seat, EightMax computes the EV of every legal action
in the solved abstraction, the EV of the stored mixed strategy, and their
differences; optionally the reach-weighted range aggregate.

Definition: EV(a | h) = E[u_actor | actor holds h, node reached, a taken, then
every seat follows the continuation policy]. The expectation runs over

1. every other seat's private hand — folded seats included, because their
   cards are dealt — from the exact posterior `∏ w_j(x_j) · reach_j(x_j)` over
   mutually compatible hands that avoid the board and h, where reach_j is seat
   j's own policy probability of the actions it took on the path;
2. future board cards, uniform over the remaining deck;
3. every later decision of every seat, drawn from the policy.

Terminal utilities are those of the training engine: main and side pots,
unmatched chips returned, ties split, and with a tournament model the exact
ICM finishing-set recursion on final stacks (busted players ranked by start
stack). Utility convention, identical for all actions at a node:

- chip EV (BB): net chips relative to the study root (training utility).
  `fromDecision` adds back the chips the seat had already committed, i.e.
  chips collected minus additional chips put in from this decision. Sunk
  chips are never charged to an action;
- ICM: tournament equity in payout units. Chip EV is never substituted.

Continuation policy is named in the request and the response: `average`
(solver output) or `current` (regret matching). Where no strategy is stored,
the default substitutes the uniform policy and reports the affected
probability share per action (`fallbackShare`, plus per-seat counts of
path-reach substitutions); `missing:"refuse"` returns 422 instead.

Methods: `exact` (enumerates opponent tuples, runouts and later actions;
selected automatically when the estimated work fits `maxVisits`) and
`sampled` (rejection sampling from the exact posterior — no importance weights
needed — uniform runouts, later actions enumerated or sampled on-policy, all
actions sharing each sample's cards). Sampled results carry sample counts,
seed, standard errors, normal 95% intervals, paired standard errors against
the best action and against the mixed strategy, and an "equivalent to best"
flag (exactly equal, or within 1.96 paired SE). Requests honour time limits
(partial results are labelled `stoppedEarly`) and cancellation. Results are
cached per engine (≤ 32 entries) under a key containing the full request and
the training counters; training and imports clear the cache.

Values are computed from the game model, never derived from frequencies or
regrets. Grouped (Compact/Detailed) studies share a strategy row per group,
but EVs are computed per exact hand.

### Independent validation

| Check | Result |
|---|---|
| Heads-up river, chip EV, every decision to depth 3, all hands + range aggregate vs independent JS reference | equal to 1e-9 relative, ≥ 30 hand/node pairs |
| Three-way river, stacks 4/12/30 (side pots), chip EV and ICM | equal to 1e-9 |
| Heads-up turn (river enumeration, all-in on turn with runouts), and a river node after a chosen card | equal to 1e-9 |
| Hand-built heads-up river game (tree and pot arithmetic written by hand) | equal to 1e-9 |
| Compact and Detailed groups, river and turn: explorer strategies vs JavaScript group mapping (`averageAt`), EVs vs reference using JS policies | 0 strategy differences in ≥ 200 hand/node pairs per study; EVs equal to 1e-9 |
| Sampled vs exact, 3 seeds × 4 hands × all actions, mixed EV and range | all |z| < 4.5, > 80% inside 1.96 SE; SE ratio for 16× samples within 2.5–6.5 (√16 = 4) |
| On-policy action sampling | unbiased within 4.5 SE |

The JavaScript reference re-implements the posterior, expectation, runouts,
showdown (`lib_eval.js`), pots and ICM (`lib_icm.js`) and reads strategies
with its own state-file parser; it uses only the explorer's betting-tree
description from the native engine (whose rules are bit-identical to
`lib_river.js` per the 3.8 parity tests).

## 3. Strategy-quality measurement (Priority 3)

`POST /api/mw/response-gain`, `mwcli --gain`.

- **exact**: best response of one seat to the others' fixed policies over
  exact private hands and boards inside the study's betting abstraction. For
  two seats with chip EV the response reports the exact exploitability of the
  evaluated policy in that abstraction (NashConv/2). For three or more seats or
  ICM it reports per-seat gains and NashConv and explicitly no exploitability.
  Verified against an independent JS best-response computation (heads-up
  river, three-way side pots chip and ICM, heads-up turn) to 1e-8.
- **sampled**: for large multiway studies, a documented response class —
  one-shot deviations at each seat's first decision (lexicographically first
  path where the seat acts; the big blind's needs a small-blind call), the
  continuation unchanged. Best actions per hand are selected on one random
  stream and the gain is evaluated on an independent stream (no selection
  bias), multiplied by an independently sampled reach probability. Every seat
  is listed with its standard error and 95% interval. It is a lower bound on
  that seat's best-response gain, not exploitability.

### Convergence measurements (validation/3.9/convergence39.json)

Linear-weighted external-sampling MCCFR, 3 seeds (privateSeed 1–3), mean ±
t-based 95% half-width over seeds, 4 threads. 3.8 and 3.9 states were
byte-identical at every checkpoint, so the accuracy columns apply to both;
"wall" is cumulative training time.

Heads-up river (chip EV, BB; exact exploitability):

| Sampled deals | 4,000 | 20,000 | 50,000 | 100,000 | 250,000 | 500,000 |
|---|---|---|---|---|---|---|
| Exploitability | 0.437 ± 0.432 | 0.145 ± 0.036 | 0.121 ± 0.116 | 0.092 ± 0.031 | 0.056 ± 0.035 | 0.036 ± 0.011 |
| Wall 3.8 / 3.9 (s) | 0.01 / 0.01 | 0.03 / 0.04 | 0.09 / 0.10 | 0.17 / 0.18 | 0.42 / 0.43 | 0.82 / 0.85 |

Heads-up turn (chip EV, BB; exact exploitability): 4.88 ± 0.30 → 1.98 ± 0.40
→ 1.05 ± 0.20 → 0.65 ± 0.08 → 0.37 ± 0.04 → 0.25 ± 0.06 (same checkpoints;
1.39 s / 1.33 s at 500,000).

Three-player river (chip EV; largest exact per-seat gain, BB): 1.12 ± 1.65 →
0.25 ± 0.11 → 0.20 ± 0.13 → 0.13 ± 0.04 → 0.076 ± 0.058 → 0.045 ± 0.018.

Three-player river with side pots (ICM payout units; largest exact per-seat
gain): 0.281 ± 0.033 → 0.103 ± 0.005 → 0.086 ± 0.032 → 0.071 ± 0.042 →
0.047 ± 0.013 → 0.036 ± 0.035.

Eight-player final-table ICM, linked preflop to river (largest sampled
one-shot seat gain, payout units; lower bound): 0.79 ± 0.20 (4,000 deals),
0.58 ± 0.08 (20,000), 0.39 ± 0.13 (50,000). 100,000+ deals were not run for
this study (about 4 s of training per 50,000 deals but minutes of evaluation
per checkpoint in this environment).

No change to CFR, CFR+, DCFR, external sampling, sampling probabilities,
importance weights, reach, averaging or regret updates was made in 3.9. No
mathematical error was demonstrated in the audit of these paths during this
release (the new exact best-response measurements show monotone improvement
of the averaged strategy with more deals, as expected), so none was
"fixed". Consequently **3.9 is not claimed to be more GTO-accurate than 3.8**:
the strategies are identical; 3.9 measures their quality more rigorously.
Variance-reduction and sampling-scheme changes were not enabled because no
change was demonstrated to be both correct and beneficial within this release.

## 4. Explorer display (Priorities 4 and 13)

At a decision: *Calculate EVs of the selected class* and *Calculate EVs of
every hand (sampled, bounded)* (batches of ≤ 64 combos), sample count and
policy selectors, a cancel button, EV tables with ± intervals, strategy
frequency and Δ per action, the best action outlined, equivalent actions and
uniform-substitution markers in tooltips, and unavailable values labelled
with their reason. *Matrix shows* switches the 13×13 matrix between strategy
frequencies, EV of an action, EV minus mixed-strategy EV, and EV standard
error; a class shows the reach-weighted mean of its computed combos, empty
when none were computed. Navigation across streets, bet sizes, players and
runouts is the 3.8 explorer, unchanged; unvisited branches stay labelled.

Not implemented in 3.9: a separate strategy-quality dashboard tab and hardware
diagnostics panel in the UI (the data are available through the
response-gain endpoint, `mw/status` and `Validate CUDA hardware.bat`).

## 5. Performance (Priorities 6, 15)

Training code is unchanged. Ten-scenario comparison (validation/3.9/
scenarios39.json; heads-up river and turn, three-player river, four- and
six-player flop, eight-player shove/call, eight-player linked preflop to
river, short-stack multiway all-ins, bubble ICM, final-table ICM; 3 seeds,
paired, alternating order): **30 of 30 pairs byte-identical**; peak RSS
within 0.6 MiB. These runs are 30 ms – 1.2 s, so the per-scenario median
differences (−15% to +37%) are timer and scheduling noise.

Longer interleaved runs, 7 pairs each (validation/3.9/timing39.json):

| Case | 3.8 median | 3.9 median | paired ratio | 3.9 faster | identical |
|---|---|---|---|---|---|
| Heads-up river, 200,000 deals | 0.356 s | 0.322 s | 0.913 | 6/7 | 7/7 |
| Three-player river, 60,000 deals | 0.220 s | 0.199 s | 0.996 | 5/7 | 7/7 |
| Eight-player linked preflop→river, 24,000 deals | 1.563 s | 1.553 s | 1.015 | 3/7 | 7/7 |
| Eight-player final-table ICM, 16,000 deals | 1.303 s | 1.214 s | 0.946 | 6/7 | 7/7 |
| Short-stack multiway all-ins, 16,000 deals | 0.764 s | 0.781 s | 1.065 | 2/7 | 7/7 |

Interpretation: no training-speed change is claimed. The training source is
identical; differences reflect code layout of the larger binary and noise.
The new evaluators are not on the training path.

## 6. CUDA, hybrid scheduling, restoration, checkpoints (Priorities 7–10)

No CUDA, scheduling, checkpoint or restoration code changed. The new action-EV
and response-gain evaluators run on the CPU: their work is irregular tree
traversal with per-node policy lookups, and no GPU path was demonstrated to
help it. All 3.2–3.8 checkpoint, transactional-update, restoration and
recovery tests pass unchanged (they are part of the 341). Physical RTX 4060 Ti
performance remains unverified; `Validate CUDA hardware.bat` now also records
end-to-end action-EV and response-gain timings and the malformed-request check
in `hardware-validation.json`.

## 7. Tests

| Run | Passed | Failed | Skipped | Timed out |
|---|---|---|---|---|
| 3.8 baseline reproduced here | 327 | 0 | 0 | 0 |
| 3.9 full suite (Linux native) | 341 | 0 | 0 | 0 |
| v38 + v39 native suites under ASan + UBSan | 22 | 0 | 0 | 0 (0 sanitizer reports) |
| Windows mwcli.exe under Wine vs Linux build: trained states and EV / gain / malformed-request answers (wine-parity.json) | 18 | 0 | 0 | 0 |
| Explorer/EV/gain HTTP host test: Linux host and Windows EightMax.exe under Wine (explorer-host-*.json) | 105 + 105 | 0 | 0 | 0 |
| Full v39 file against mwcli.exe under Wine | — | — | — | 1 (file limit 50 min: the JS reference launches hundreds of Wine processes; replaced by wine-parity.json) |

Hardware-dependent: 13 tests ran with the CUDA driver *test double* (not a
GPU); no physical GPU or physical Windows test was run.

## 8. Remaining limitations

1. Full eight-player equilibrium accuracy is not established. Multiway gains
   are sampled one-shot lower bounds at one node per seat; exact best
   responses are only feasible for small river/turn studies.
2. Exact EVs are limited by `maxVisits`; preflop and wide multiway spots use
   sampled estimates whose precision depends on samples and time.
3. Where the solver never visited a branch, EVs use uniform substitution
   (reported) or are refused; they are not "the solver's" EVs there.
4. EV and gain requests hold the engine lock; long requests delay other
   explorer requests until done or cancelled (time limits apply).
5. No physical Windows, RTX 4060 Ti or CUDA execution; GPU acceleration is
   still limited to the scoring operations of 3.8.
6. Training performance and convergence algorithms are unchanged from 3.8.
7. The JavaScript full-traversal browser memory ceiling is unchanged.
