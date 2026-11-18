# One controlled table, end to end (0.24)

```
render/screen -> CaptureSession -> ImageObserver (vision-ocr) -> HandStateEngine(track) -> SolverService(decide) -> TestExecutor
     ^                                                                                                                  |
     +------------------- next frame must show the action just executed (acknowledgement) <----------------------------+
```
`src/full-hand.js` (`SingleTablePipeline`) reads **only pixels** (plus the client's revision counter). The simulator is touched only to start hands and, in
tests, to audit the outcome. `tools/stress-024.cjs` and `tests/full-hand.test.cjs` run it.

## Hand-state reconstruction (`src/hand-state.js` + `src/hand-ledger.js`)
* The **ledger** is an independent betting-rules engine (blinds, antes, min-raise, short all-in does not reopen, betting-round completion, side pots, uncalled-bet
  refund, split pots, settlement feasibility). It agrees with the simulator on 400 randomized variable-stack hands in the test-suite and 4,000 in the stress run.
* **Tracking** derives the action history, per-seat contributions, legal actions and side pots from consecutive screen readings. Every reading is explained by a
  sequence of legal actions or **rejected**: the table pauses, the reason is recorded, and it resumes only after two consistent readings.
* Rejected, never guessed: a hand first seen mid-way (`missed-hand-start` / `untracked-hand`), a seat that would have acted twice between readings, a raise followed by
  another seat's call in one gap (hidden re-raise cannot be excluded), pot / stack / bet / board / control disagreements (`controls-disagree`), impossible
  settlements (`bad-settlement`), unfolding, missing hand number.
* Configurable stakes (`sb`, `bb`, `ante`) and arbitrary starting stacks; units are chips (100 = 1 BB).
* Restart: `exportCheckpoint()` / `restoreCheckpoint()` (ledger JSON, re-validated for chip conservation); the table stays paused until fresh readings agree.

## Decisions
`CompositeDecisionSource` tries, in order: the **linked preflop tree** study (fold / call / raise sizes / all-in; fixed 8 × 25 BB, SB 0.5 / BB 1 / ante 0.1) and **on-demand
flop / turn / river studies** built from the reconstructed state (live players in action order, remaining chips, pot, board, assumed ranges, tree sizes). A decision is
returned only if the recorded betting walks the tree size by size and the node's pot, every seat's chips and live flags equal the table (`src/solver-tree.js`).
Otherwise `unavailable` with the reason; the pipeline suspends the hand (strict) or — only in Simulation Mode and only if allowed — executes a **SCRIPTED FALLBACK**
that is labelled, counted separately and never reported as a solver decision.

Assumptions stated with every decision: opponent ranges are an *assumed range model*, not observed ranges; preflop strategies come from sampled training with an
update count and `convergence: unproven`; nothing is called equilibrium or GTO-certified. Preflop hands with no stored row use the pooled strategy of the same
suit-equivalent class (e.g. all suited AK combos), flagged in `pooled`.

## Execution and acknowledgement
Before execution: table, hand, actor, state revision, legal action, size, chips, decision age, duplicate in flight, mode / authorization. After execution the **next screen
reading** must show that exact action in the reconstructed history (bet/raise/all-in matched by size); otherwise the hand is suspended (`ackMismatches`).

## Known limits
* Solver coverage is partial: unvisited preflop nodes, off-menu bet sizes (after a scripted raise), more than six live players or an all-in player at the start of a postflop street
  are `unavailable`. The reports state the share of solver vs scripted actions; nothing is "fully solver-driven".
* Hole cards are read only for the acting seat (each seat has its own client view); showdown cards of others are never read.
* Real external-client accuracy is not measured. Browser-rendered and synthetic accuracy are measured and reported separately (docs/RECOGNITION-ACCURACY.md).
