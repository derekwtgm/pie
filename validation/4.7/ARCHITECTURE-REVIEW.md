# EightMax 4.7 – architecture review for future formats (Priority 17)

Scope: six-max, nine-max and heads-up cash games, Sit & Go and progressive-knockout
tournaments. **No cash-game or bounty engine was implemented in 4.7**, and nothing in the
MTT training path was changed for this review (default training still writes the golden state
`aa809741…`; 42 further studies are byte-identical to 4.6, see `validation/4.7/README.md`).
This review updates the 4.6 review (`validation/4.6/ARCHITECTURE-REVIEW.md`), which remains valid.

## Coupling table (10 areas named in the brief)

| # | Area | Where | Coupled to MTT? | 4.7 status |
|---|---|---|---|---|
| 1 | Betting rules | `es::Rules` (`mw_es.hpp`), `lib_river.js` | No: rules are generic NLHE (min raises, all-ins, caps) | unchanged; independently re-implemented in `tools/independent_br47.py` for river games and agreed to 1e-15 |
| 2 | Player counts | spec `n` (2-8) | No | 4.7 tools (`--verify/--compare/--monitor`, dashboard) take `n` from the spec; seat labels come from a table (`emana::seatLabel`) and fall back to "seat k" |
| 3 | Blinds | spec `rules.posted`, `pre` | No | unchanged |
| 4 | Antes | spec `anteOf[]`, `rules.ownAnte` | No (individual and big-blind ante are data) | unchanged; `tests/mtt.test.js` keeps 0.5/1 blinds, 0.1 bb antes, 2.3 bb pot |
| 5 | Stack structures | spec `rules.stacks`, `prior`, `folded` | No | unchanged |
| 6 | Terminal utilities | `Walker::payoff/seatPayoff` (`mw_es_impl.hpp`), `MW::walk`, `action_ev.hpp` | **Yes, inline**: chip EV vs ICM chosen by `tournament.start.empty()` | not refactored (see below) |
| 7 | ICM payouts | `icm.hpp` (`Tournament`) | Only ICM is implemented | unchanged; independently checked against a separate Malmuth-Harville implementation (`source/reference`, closed form for 3 players, 2,000 random tables with busts) |
| 8 | Training algorithms | `es::train` + options | No: options are orthogonal to the utility | new option `ownHandEnumeration` works for chip EV and ICM |
| 9 | Evaluation methods | `action_ev.hpp`, `mwcli_analytics.hpp` | Exploitability is reported only for two-player chip EV (correct for any zero-sum format) | 4.7 reports relative gains per utility model (pot share for chip EV, equity share for ICM) |
| 10 | Checkpoint formats | EMMW4, EMZ1 | No: EMMW4 is rules-derived and EMZ1 is a format-agnostic container | 4.7 separates **game identity** (`IDENTITY_KEYS`) from **trainer settings** for comparisons; a cash format would add identity fields (rake), so cash and MTT checkpoints can never be compared by mistake |

## Why the Utility interface was not introduced in 4.7

The 4.6 recommendation (a `Utility` interface with `ChipEv` and `Icm` implementations) is still
the right first step. It was not done in 4.7 because:

* the payoff code is the innermost loop of training (the eight-player ICM profile spends about 40% of
  its instructions in `Tournament::evaluate`, see `validation/4.7/profile`), so an indirect call per terminal
  needs its own benchmark evidence;
* there is no second implementation yet whose correctness could be tested through it; adding the
  abstraction alone would change code on the critical path for no user-visible benefit;
* the brief forbids compromising MTT accuracy or checkpoint compatibility for future formats.

## Recommended order for the cash-game release

1. `Utility` interface (`terminal(potLayout, stacks) -> values`, `zeroSum()`, `workspaceBytes()`), gated on the
   golden hashes and the 42-study byte-identity check used in 4.7 (`validation/4.7/README.md`, section CPU).
2. `CashGame{rakePercent, rakeCapBB, noFlopNoDrop}`: rake taken where pots are awarded; `zeroSum()` false
   once rake is non-zero (then report NashConv, not exploitability, exactly as for ICM).
3. Presets: six-max / nine-max / heads-up cash = player count + blinds + stacks (all data today).
4. Sit & Go = ICM preset (payout tables); progressive knockout = `Bounty` utility (bounty value moves on
   elimination; needs per-seat bounty state in the spec and in the game identity).
5. Add each new format to the reference suite (`source/reference`) before the engine: an explicit-tree
   game with rake and one with bounties, so the engine can be checked against an independent best response.
