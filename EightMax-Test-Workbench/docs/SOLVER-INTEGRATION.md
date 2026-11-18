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

## 0.24 (EightMax 5.1 build 7d08acc7eb4577ee, unchanged; no newer engine was supplied, none is claimed)
* Capability list now: preflop push/fold (0.21), **linked preflop tree** (fold / call / raise sizes / all-in, up to 3 bets), **flop / turn / river studies built on demand** from the reconstructed state.
  `unsupported`: weighted ranges *observed* from play, side-pot trees with an all-in player at street start, more than six live postflop players, unequal-stack preflop trees, per-hand EV where the node view does not expose it, GPU.
* `src/solver-tree.js` — `TreeStudy.decide()` checks, in order: per-seat chips present; history walks the tree action by action (type and size must be a menu entry); the node is a decision for the acting seat;
  tree pot = table pot; every seat's chips behind and live flag equal the table; the legal-action description exists; menu entries that are illegal at the table are excluded only if they carry < 2 % of the strategy
  (otherwise `unavailable`); the hero's exact hand has a stored row (preflop: suit-equivalent pooling, flagged); probabilities sum to 1. Anything else is `unavailable` with the reason. Nothing is approximated.
* Version negotiation (`identifyEngine`, `negotiate`) is unchanged: unknown builds are refused and the validated 5.1 is named as the fallback.
* Quality fields on every decision: `engine`, `trainingUpdates`, `convergence` (`unproven`), `certification:'none'`, `assumptions`, `warnings`, `evByAction` (sampled, when the node view has it),
  `builtAt` (result age = now − builtAt), cache identity (`studyId`, path, exact-input cache key in `SolverService`).
* Opponent ranges for on-demand studies are an **assumed range model** (default `DEFAULT_RANGE`, configurable `rangeModel`); the hero's actual hand is added to its own range at 100 % weight.
  These are not observed ranges and the decision says so.
* Strategy-memory limit: an eight-seat linked preflop tree trained with exact cards reached the engine's strategy budget at ~146 k updates; the shipped benchmark study uses 100 k updates and therefore has
  unvisited nodes (reported as unavailable, never filled in).

## 0.25 additions
* **Decision record** (every `ok` decision): `recommended`, `labels` + `probabilities`, `evByAction` (sampled, per hand, when the node exposes it), `studyId`, `engine` (EightMax 5.1, build), `solverVersion`, `trainingUpdates`, `convergence`, `warnings`, `assumptions`, `coverage {exactState, pooled, translated, translations, evAvailable}`, `decidedAt`, `inputFingerprint` (= request `stateKey`), `certification: "none"`.
* **Structured unavailable**: `status:'unavailable'`, `code` (`off-tree-wager`, `no-stored-row`, `hand-not-in-range`, `street-not-covered`, `stakes-or-stack-mismatch`, `state-mismatch`, `training-failed`, `translation-too-approximate`, `unsupported-state`, …), `missingCapability` (plain language), `executable:false`. The executor never runs an unavailable decision; fallbacks run only in Simulation mode and are labelled.
* **Off-tree translation** (`translateOffTree`, default **off**): a recorded wager that is not a tree size is mapped to the nearest tree wager by log distance (max ratio 1.6), the pot/stack mismatch must stay within 35 %, and the result is flagged `exactState:false` with `translations`, `stateDeviations`, an `APPROXIMATE STATE` warning and an assumption. It is a heuristic, not a solved answer for the real state.
* **Tree-aligned fallback**: when the node is known but the hand has no stored row, the unavailable result carries the tree menu and the scripted fallback chooses among its legal entries so later decisions stay on the tree.
* **Limits that remain**: coverage is bounded by sampled training (the study adapter caps strategy memory at 256 MiB; 250,000 preflop updates already exceed it); postflop opponent ranges are assumed; multiway beyond the trained player set, other blind/ante structures and stacks other than the study root are reported unavailable, not approximated.
