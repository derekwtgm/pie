# Recorded-observation sequence format

Use `examples/observation-demo.json` as the complete reference file. Open it through
Observation review → Open observation sequence, or use Load synthetic demo.

Top-level fields: `format: "eightmax-observation-sequence"`, `version: 1`,
`source: "synthetic" | "recorded-observation"`, and a `frames` array (1–5,000).

Each frame contains:

| Field | Meaning |
| --- | --- |
| table | Table identity, integer 1–10 |
| hand | Stable hand identity, 1–64 letters/digits/underscore/hyphen |
| frame | Unique frame identity, 1–80 letters/digits/underscore/hyphen |
| sequence | Strictly increasing integer per table |
| timeMs | Strictly increasing millisecond observation time per table |
| quality | accepted=true, minScore >= 0.92, minMargin >= 0.04; both <= 1 |
| state | Complete snapshot described below |

`quality` is the producer's aggregate minimum field evidence. The audit trusts
neither it as an accuracy certificate nor a stable snapshot as proof of earlier
betting. Repeated observations must come from distinct actual frames/images;
copying one screenshot with new IDs does not supply independent evidence.

State fields:

- `street`: preflop, flop, turn or river.
- `board`: respectively 0/3/4/5 card strings, e.g. `"As"` or `"Td"`.
- `hero`: two visible hole-card strings. Unknown opponent cards are not required.
- `actor`: zero-based acting seat index.
- `bigBlind`: positive integer chip amount.
- `pot`: total pot INCLUDING all currently visible wagers.
- `deadMoney`: fixed chips in the pot not assigned to the listed seat contributions.
- `seats`: 2–8 ordered objects, each with integer `stack`, `committed`, `bet` and
  boolean `folded`. `committed` is the full hand contribution, including antes;
  `bet` is only the current-street contribution, excluding antes.

Use one consistent integer chip unit. The tracker does not interpret currency,
convert BB, infer missing contributions or reconcile a client's different display
convention. A client displaying bets separately from the pot needs normalization
upstream. No normalization is silently guessed here.

Only movement between stable snapshots is audited. Calls/folds can be observed,
but checks, aggregate missed actions, betting-round completion, minimum raises,
reopening rights, side-pot eligibility and actual turn order are not fully
reconstructed. Aggressive/turn-only changes pause rather than becoming actionable.
Without the explicit 0.7 accounting phases below, new hands and payout transitions need review/reset. Evidence below the
threshold latches a pause; later good frames do not silently undo that pause.

Reports retain the last accepted snapshot alongside any pause, so a reviewer can
see what was last stable. A paused or stable report is always decisionReady=false.
Image calibration forwards only raw labeled-field results to the review panel;
these partial fields do not satisfy this complete snapshot schema automatically.


## Optional 0.5 postflop reconstruction

Add `roundStart: {dealer: <zero-based seat>}` to the first stable snapshot, with
all street bets zero and actor equal to the next live, non-all-in seat clockwise
from the dealer. This is a caller-supplied anchor assertion, not independently
recognized position evidence. A mid-street anchor is rejected in this mode.

Subsequent snapshots are matched to exactly one legal modeled action, or a closed
round followed by a street change. An observed final action can also coincide with
the new board/street if it closes the old round. Do not omit intermediate raises,
calls or checks: unmatched transitions latch a pause. If a closed round is shown
before dealing the next street, use `roundClosed: true` and `actor: -1`. An open
round may omit roundClosed or set it to false. A changed dealer is rejected.

Use `examples/verified-round-demo.json` for the complete synthetic sequence. Its
last snapshot is a turn start eligible for manual study preparation. Earlier
streets and all evidence-generation accuracy remain outside the verified claim.


## Optional 0.6 preflop anchors

For a complete pre-action posting root, supply:

```
"roundStart": {"dealer": 0, "smallBlind": 1, "bigBlindSeat": 2,
               "dealt": 8, "ante": 10}
```

Here BB=100 chips, SB=50, and each seat has contributed 10 ante chips plus its
live blind. `bet` excludes ante, `committed` includes it, `deadMoney` is zero,
all seats are unfolded with chips still behind, and actor=3. Pot=230. Heads-up
instead uses dealer=SB=0, BB=1 and actor=0, with a 170-chip initial pot.

Use a BB unit divisible by ten. Dealt must equal the number of listed seats.
Anchors with missing identity/position evidence, short/all-in posts, BBA or
straddles are outside this format's supported reconstruction mode. After an
explicit initial anchor, individual actions can be reconstructed through a valid
flop transition; full observed snapshots and independent frame evidence are still
required. No screenshot metadata or classifier evidence is invented by this layer.

Examples: `preflop-2-demo.json`, `preflop-6-demo.json`, `preflop-8-demo.json`.
The initial preflop study draft restores chips before posts and lets EightMax post
its blinds/antes once. Postflop drafts preserve already-posted contributions.


## 0.7 accounting evidence

All amounts are integer chips. Supply a stable observed closed round before any
accounting phase: actor=-1, roundClosed=true. Keep known board/hero cards and seat
identities consistent. Partial or changed evidence cannot be silently reconciled.

Optional fields added to snapshots:

| Field | Meaning |
| --- | --- |
| phase | betting (default), showdown, refund, or settled |
| heroSeat | Explicit zero-based seat owning the known hero cards |
| showdown | Array of {seat, cards:[card,card]} for exposed hands; known hero may be omitted |
| refunds | Integer vector, one per original seat, for THIS transition only |
| awards | Integer gross-pot award vector, required for settled only |

`phase: "showdown"` requires a five-card river board, heroSeat and an explicit
showdown list. Empty/partial lists can record limited evidence, but contested
settlement still requires cards for every eligible player. No chips move in this
phase. Previously exposed cards must remain consistent in subsequent snapshots.

`phase: "refund"` requires refunds, no awards, the exact unmatched current-street
excess and a matching stack increase/contribution decrease. Pot decreases by that
refund; deadMoney and all other seats remain unchanged. It is not a player action.

`phase: "settled"` requires awards and refunds, pot=deadMoney=0 and zero bets/
committed amounts. Stacks equal the previous stacks plus THIS transition's awards
and refunds, with fold statuses retained. Refunds must be zero if already separately
returned. Include the exposed-card evidence needed to rank each contested pot;
known hero cards are attached through heroSeat. An uncontested win needs no
opponent showdown. Room-specific rake, fees and alternate odd-chip policies are
outside this contract and will not be silently applied.

The completed record's accounting.refunds is the cumulative observed refund vector;
settlement.refunds is only the final payout step's refund vector. Neither is profit.
Main/common chips are eligible to all live players; matched contribution layers
restrict eligibility. Equivalent adjacent layers merge before odd-chip rounding.
Remainders are allocated clockwise from the dealer. Invalid or unsupported earlier
unmatched contributions pause for review rather than being assigned a guessed owner.

Examples: completed-session-demo.json and sidepot-showdown-demo.json. The session
example follows a separate refund, payout and next preflop hand. The side-pot
example starts at a partial river anchor and supplies exposed cards before paying.

After verified settlement, a new hand ID can begin through a fresh supported
preflop anchor if stacks carry forward, the dealer rotates and seat count/BB stay
unchanged. Its default gap allowance is 60 seconds. Changes outside this supported
continuity model require an explicit reset; that reset breaks the continuous-chain
claim. Hand IDs may not be reused within that tracked table. Exports retain at most
100 completed records and 256 transitions per hand and mark truncation.

The completed-hand JSON export is a read-only report. It is not an accepted input
for Open observation sequence, and does not restore the tracker. Retain/reopen the
original sequence to repeat the audit. Loading a different sequence resets the
current review run, including its archive, so export first when needed.


## Resuming review in 0.8

Observation sequences retain their existing format. The separate resumable file
uses `format: "eightmax-observation-review"`, version 1. Open it with **Open saved
review**, rather than the sequence importer. It contains the original sequence,
processed cursor, supported settings and ordered frame/reset operations. Loading
re-audits the prefix; the next source frame waits for manual processing. It can
restore collecting candidates and paused failures, not only completed hands.

**Save review progress** and the separate automatic review save use this format.
The audit, completed-hands and selected-hand exports remain reports. A selected
hand inspection shows only accepted transition snapshots, bounded to its final
256 steps and marked if truncated. All cards/stacks remain supplied evidence,
with no client authentication or execution eligibility. See REVIEW-SESSIONS.md.
