# EightMax 4.8 – architecture note for future formats (Priority 18)

**No cash-game, Sit & Go or bounty engine was implemented in 4.8**, and the MTT training path was
not changed (default training still writes the golden state `aa809741…`). The 4.7 review
(`validation/4.7/ARCHITECTURE-REVIEW.md`) and its recommended order remain valid. This note lists
what 4.8 changed in the layers a new format would touch.

| Layer | 4.8 change | Coupling to MTT |
|---|---|---|
| Response evaluation (`action_ev.hpp`) | per-board rank cache, pot layout hoisted per terminal, chip-only utility fast path, table-cache caps | The chip-only fast path is selected by the same `tour` flag as before (chip EV vs ICM). A future `Utility` interface would replace that flag; the fast path is valid for any utility that is "net chips of the actor", which includes a raked cash game **only if rake is applied before shares are added** — it must be re-derived, and the 4.8 bit-identity tests (`tests/v48.test.js`, `EM_EV_NO_RANK_CACHE` / `EM_BR_NO_HOIST`) are the template for that check. |
| Showdown tables (`showdown_table.hpp`) | contiguous key index, count caps (`countCap`) | none: tables are rank patterns of hands over boards, format independent |
| Independent verification (`tools/independent_br48.py`) | multi-street postflop chip-EV best responses with dead money and chance | Rules, pots and utilities are re-implemented from the spec; adding rake there first (an explicit `rake(pot)` hook in `payoff`) gives the independent check a cash engine needs |
| Study games (`tools/games48.js`) | one shared catalogue for studies, benchmarks and tests | games are data (players, stacks, blinds, ranges, sizes, payouts); cash presets would be entries without `icm` |
| Checkpoint comparison | `qualityChange` classes | identity fields already refuse comparisons across different games or utilities; a `rake` identity field would make cash and MTT checkpoints incomparable automatically |
| Continuation suite | evaluation hands derived from the spec's root actor | removes the last hard-coded dependency on the eight-player MTT fixture, so the suite runs on any format's spec |

Tournament defaults are unchanged: eight players, 0.5/1 blinds, 0.1 bb individual antes
(0.8 bb total), 2.3 bb starting pot, UTG, UTG+1, MP, HJ, CO, BTN, SB, BB; optional big-blind ante.
