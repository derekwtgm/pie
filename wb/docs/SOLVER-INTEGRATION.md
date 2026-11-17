# Solver integration (0.21)

Bundled engine: **EightMax 5.1, build 7d08acc7eb4577ee** (unchanged; hashes in `vendor/eightmax-5.1/provenance.json`; Windows `native/mwcli.exe` SHA-256 b3e675bf…2ab2f72).
No newer engine was supplied, so none is bundled or invented. `identifyEngine` accepts only listed builds, flags provenance mismatches and names the validated 5.1 fallback.

* `negotiate(offer)` — protocol 1 range and the required query `preflop-shove-root-and-path`.
* `validateRequest` / `requestFromState` — table, revision, state key, actor, hole cards, board, action history, eight stacks, priority, deadline. Missing cards or history are refused.
* `StudyDecisionSource.decide(req)` → `{status:'ok', labels, probabilities, recommended, evByAction:null, trainingUpdates, convergence, warnings, assumptions, engine, studyId, certification:'none'}` or `unavailable` with the reason.
  Verified mapping: 8 seats, equal 25 BB stacks, SB 0.5 / BB 1 / ante 0.1 BB, push/fold menus. Anything else (board cards, unequal stacks, history not in the tree, hand without a stored row) is `unavailable`.
* Per-hand action EV is **not exposed** by the reference path used; it is reported as null, never estimated.
* Convergence: defaults to `unproven`. The 0.18 convergence tooling (exact / restricted / sampled / unavailable) is unchanged; for eight seats the exact check is unavailable, so no result here is called converged or GTO-certified.
* `SolverService` — bounded priority queue, concurrency budget, exact-input cache (byte-bounded LRU, memory-pressure shrink), timeouts that free the worker, cancellation of superseded requests, stale discard (a decision that finishes after the table revision changed is dropped and counted).
* GPU: not used; capability list states `gpu` unsupported. A CPU-only path is the only path.
