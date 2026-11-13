# EightMax 4.6 – architecture review for future formats (Priority 15)

Scope: whether the current design separates the concerns a cash-game, Sit & Go or
progressive-knockout format would need. **No cash-game code was added**, and the
MTT solver was not changed for this review. Training must keep writing byte-identical
states (golden hash `aa809741…` in `tests/v46.test.js`), and a refactor of the
traversal could not be proven neutral without that guarantee.

## What is already separated

| Concern | Where it lives | Separation |
|---|---|---|
| Player count (2-8) | `MultiwayGame` (`web/lib_wide.js`), native spec `n` | Parameter everywhere; no 8-seat constant in the solver core (`SEATS8` is only a label table in tools). |
| Stacks, blinds, antes | spec `stacks`, `anteOf[]` (per-seat), `prior`, `folded` | Data, not code. Individual antes (default 0.1 bb x 8 = 0.8 bb, 2.3 bb pot) and the optional big-blind ante are both expressed through `anteOf`/blind fields; `tests/mtt.test.js` checks both. |
| Betting rules | `es::Rules` (`mw_es.hpp`): `advance`, `nextStreet`, minimum raises, all-ins | One implementation shared by training, explorer, checkpoint verification (`checkpoint_native.hpp` replays it) and evaluation. |
| Betting abstraction | spec `streets.{flop,turn,river}.{bets,raises,maxBets}`, `preflop.mode` | Data. |
| Training algorithm | `es::train` with options (`weighting`, `regretMatching`, DCFR, `terminalBaseline`, `chanceSampling`, `opponentExploration`) | Options select behaviour; the utility does not depend on them. |
| Evaluation | `action_ev.hpp` (exact / restricted / sampled), `showdown_table.hpp` | Reads the trained policy and the same utility function as training. |
| Checkpoint format | EMMW4 (`mw.cpp` export, `checkpoint_native.hpp` verify/restore) | Header carries `studyId`, counters and RNGs; the body is rules-derived. A new format would need a new `specProtocol` and study id, nothing else. |

## Coupling found

1. **Terminal utility is selected inline.** Chip EV versus ICM is decided in 13 places in
   `mw.cpp` / `mw_es_impl.hpp` by `m.tournament.start.empty()`. Examples: the terminal
   payoff, the `terminalExpectation` shortcut (disabled for ICM), the ICM workspace
   sizing in `es::train`, and the evaluator's `chip` flag (two-player exploitability is
   only reported for chip EV).
2. **ICM is the only non-chip model.** `icm.hpp` (`Tournament`) holds start stacks,
   payouts and its cache, and the payoff code calls it directly. A knockout-bounty or
   rake model would add a third branch at each of those points.
3. **Pots and side pots** (`CPot`, terminal pot layouts) are shared and format-neutral;
   rake would need a hook where the pot is awarded.

## Recommended low-risk path (not done in 4.6)

* Introduce a `Utility` interface (`terminal(potLayout, stacks) -> per-seat value`, `isZeroSumChips()`,
  `workspaceBytes()`) with two implementations that call exactly today's code:
  `ChipEv` and `Icm`. Gate the change on byte-identical states for all six convergence
  games and the golden hashes, which the existing tests check.
* Add `CashGame{rakePercent, rakeCapBB, noFlopNoDrop}` and `Bounty{...}` as further
  implementations. Cash studies would also need their own `studyId` namespace and
  independently trained strategies, because MTT strategies are not valid for cash play.
* Keep blinds and antes as data (`anteOf`, blinds). Six-max, nine-max and heads-up cash
  are player-count and stack presets, apart from rake.
