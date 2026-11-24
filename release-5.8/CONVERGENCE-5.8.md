# Convergence and strategy quality — EightMax 5.8

Build `d4001e2c0cd77f41`, compared with the unchanged 5.7.1 binary (build `65e835e6b7060960`) where a comparison is
made. All measurements on the development machine: a Linux container with 4 logical processors (Intel Xeon,
2.1 GHz), no GPU. None on the target Windows PC.

Vocabulary, used strictly:

- **NashConv**: the sum over the seats of the exact best-response gain inside the study's abstraction. In two-player
  chip-EV games NashConv / 2 is exploitability. With three or more seats, or with ICM, it is **not** exploitability
  and is never called that here.
- **Lower bound**: a number that cannot exceed NashConv. A small lower bound proves nothing.
- No figure in this document is a "percentage of GTO". Shares are stated only where exact NashConv is known, and
  they describe a *measure* (how much of NashConv it finds), not a strategy.

## 1. Summary

| Question | Answer | Section |
|---|---|---|
| Does each lower-bound measure stay below exact NashConv? | Yes: 0 violations in 560 seat gains per measure (130 states, 14 games) | 2 |
| How much of exact NashConv does the new trained response find? | With 2,000,000 response deals per seat: at least 70% in every state, at least 90% in 122 of 130, median 100%. With 200,000: median 96%, minimum 19% | 2 |
| And the 5.7 measures? | One-decision: median 41%, below half in 81 states. Restricted: exact on single-street games, 4% to 57% on multi-street games | 2 |
| Is the trained response promoted as *the* quality measure? | No. Its promotion rule was not met on single-street games (the restricted measure is exact there). It is added for multi-street and large studies | 2, 6 |
| On the realistic fixtures (no exact answer)? | The trained response establishes a NashConv of at least 0.77 to 0.93 BB (six-player flop), 0.35 to 0.40 BB (three-player flop) and 0.22 to 0.25 BB (25 BB preflop) after 1,000,000 deals, where the 5.7 measure showed nothing distinguishable from zero. No upper bound exists | 3 |
| Does 5.8 train what 5.7.1 trains? | Yes: 400 of 400 checkpoint pairs byte-identical at equal deals | 4 |
| Is 5.8 better or worse than 5.7.1 at equal wall-clock time? | Neither: ten of ten games "unresolved", none "worse" | 4 |
| Did the six-player flop result improve? | No: unchanged (primary contrast unresolved at 0.5 s and 2.0 s on both games, 60 seeds) | 5 |
| Was a new training algorithm promoted? | No. None was proposed; the default trainer is the 5.7.1 trainer | 6 |

What the mathematics establishes: the direction of every lower bound, and their values on games small enough to
enumerate. What remains uncertain: the distance from equilibrium of any strategy for a game too large to enumerate —
only a floor is known.

## 2. How much of exact NashConv does each lower-bound measure find? (prespecified)

**Plan** (`validation/5.8/convergence/response/plan.json`, written 2026-11-24T02:10Z, before the first measurement):
14 reference games with exact NashConv; training budgets 5,000 and 50,000 deals with the default trainer; training
seeds 5001 to 5005 (5001 to 5003 for the three-street game, 5001 and 5002 for the eight-handed push-or-fold game,
whose exact evaluations are slow); for every trained state the exact NashConv and three lower bounds: the 5.7
one-decision measure (200,000 evaluation samples), the 5.7 restricted best response, and the 5.8 trained response
with 200,000 and with 2,000,000 response deals per seat, each evaluated exactly and also estimated from 204,800
independent deals. Direction rule, estimate rule, tightness definition, promotion rule and stopping rule are in the
plan and are quoted in MATHEMATICAL-VALIDATION-5.8.md, section 3. The response budgets were fixed from a pilot on
seed 4001, which is not part of these results.

**Deviation from the plan:** the run was stopped by the two-hour limit of a background job after 109 of 130 states
and continued with `--resume` (same plan, same binary, same output files; `resumed.json`). No state was measured
twice, none was dropped, and no state failed.

| Game | Deals | Exact NashConv (mean) | Sampled (5.7): median (min to max) | Restricted (5.7): median (min to max) | Trained, 200,000 response deals | Trained, 2,000,000 response deals |
|---|---|---|---|---|---|---|
| heads-up river | 5,000 | 0.642 | 0.54 (0.43 to 0.73) | 1.00 (1.00 to 1.00) | 0.99 (0.98 to 0.99) | 1.00 (0.99 to 1.00) |
| heads-up river | 50,000 | 0.1808 | 0.28 (-0.04 to 0.51) | 1.00 (1.00 to 1.00) | 0.93 (0.87 to 0.96) | 0.99 (0.97 to 1.00) |
| heads-up turn and river | 5,000 | 0.7448 | 0.16 (0.08 to 0.32) | 0.35 (0.27 to 0.47) | 0.98 (0.97 to 0.98) | 1.00 (1.00 to 1.00) |
| heads-up turn and river | 50,000 | 0.2155 | 0.18 (0.10 to 0.19) | 0.33 (0.25 to 0.38) | 0.85 (0.83 to 0.93) | 0.99 (0.97 to 0.99) |
| three-player river, side pots | 5,000 | 0.2736 | 0.49 (0.39 to 0.55) | 1.00 (1.00 to 1.00) | 0.99 (0.98 to 1.00) | 1.00 (1.00 to 1.00) |
| three-player river, side pots | 50,000 | 0.07823 | 0.51 (0.36 to 0.62) | 1.00 (1.00 to 1.00) | 0.88 (0.85 to 0.97) | 0.99 (0.94 to 1.00) |
| four-player turn and river | 5,000 | 2.014 | 0.06 (0.05 to 0.09) | 0.06 (0.05 to 0.09) | 0.98 (0.98 to 0.98) | 1.00 (1.00 to 1.00) |
| four-player turn and river | 50,000 | 0.01111 | 0.50 (0.26 to 0.57) | 0.50 (0.25 to 0.57) | 0.87 (0.78 to 0.91) | 0.98 (0.86 to 0.99) |
| six-player flop, all-in or fold | 5,000 | 1.205 | 0.31 (0.17 to 0.38) | 1.00 (1.00 to 1.00) | 0.99 (0.98 to 0.99) | 1.00 (1.00 to 1.00) |
| six-player flop, all-in or fold | 50,000 | 0.1908 | 0.30 (-0.09 to 0.40) | 1.00 (1.00 to 1.00) | 0.96 (0.82 to 0.96) | 0.99 (0.93 to 1.00) |
| eight-handed ICM final table | 5,000 | 0.08593 | 0.97 (0.43 to 0.98) | 1.00 (1.00 to 1.00) | 1.00 (1.00 to 1.00) | 1.00 (1.00 to 1.00) |
| eight-handed ICM final table | 50,000 | 0.0008018 | 0.99 (0.71 to 1.00) | 1.00 (1.00 to 1.00) | 1.00 (1.00 to 1.00) | 1.00 (1.00 to 1.00) |
| four-player ICM bubble | 5,000 | 0.0174 | 0.50 (0.43 to 0.93) | 1.00 (1.00 to 1.00) | 1.00 (0.99 to 1.00) | 1.00 (1.00 to 1.00) |
| four-player ICM bubble | 50,000 | 0.001078 | 0.48 (0.02 to 0.52) | 1.00 (1.00 to 1.00) | 0.86 (0.64 to 0.99) | 1.00 (1.00 to 1.00) |
| five-player flop | 5,000 | 0.783 | 0.42 (0.20 to 0.56) | 1.00 (1.00 to 1.00) | 0.99 (0.94 to 0.99) | 1.00 (1.00 to 1.00) |
| five-player flop | 50,000 | 0.1677 | 0.36 (0.06 to 0.72) | 1.00 (1.00 to 1.00) | 0.96 (0.79 to 0.98) | 0.96 (0.70 to 1.00) |
| six-player flop, weighted ranges, two bet sizes | 5,000 | 2.483 | 0.26 (0.22 to 0.31) | 1.00 (1.00 to 1.00) | 0.97 (0.96 to 0.98) | 1.00 (1.00 to 1.00) |
| six-player flop, weighted ranges, two bet sizes | 50,000 | 0.6089 | 0.24 (0.19 to 0.46) | 1.00 (1.00 to 1.00) | 0.89 (0.82 to 0.91) | 0.99 (0.97 to 0.99) |
| early stage: three-player flop, three streets of betting | 5,000 | 26.64 | 0.02 (0.01 to 0.03) | 0.06 (0.05 to 0.06) | 0.39 (0.39 to 0.39) | 0.75 (0.75 to 0.75) |
| early stage: three-player flop, three streets of betting | 50,000 | 20.41 | 0.01 (0.01 to 0.01) | 0.04 (0.04 to 0.04) | 0.31 (0.31 to 0.31) | 0.76 (0.75 to 0.76) |
| medium stacks: three-player turn and river | 5,000 | 5.671 | 0.09 (0.06 to 0.13) | 0.23 (0.21 to 0.29) | 0.95 (0.95 to 0.95) | 1.00 (0.99 to 1.00) |
| medium stacks: three-player turn and river | 50,000 | 2.06 | 0.07 (0.04 to 0.11) | 0.21 (0.15 to 0.25) | 0.84 (0.80 to 0.85) | 0.98 (0.98 to 0.98) |
| short stacks: eight-handed push or fold (chip EV) | 5,000 | 0.1876 | 0.35 (0.28 to 0.41) | 1.00 (1.00 to 1.00) | 0.92 (0.90 to 0.94) | 0.99 (0.98 to 1.00) |
| short stacks: eight-handed push or fold (chip EV) | 50,000 | 0.04021 | 0.33 (0.13 to 0.53) | 1.00 (1.00 to 1.00) | 0.51 (0.19 to 0.82) | 0.96 (0.92 to 1.00) |
| five-player ICM bubble | 5,000 | 0.0892 | 0.65 (0.60 to 0.79) | 1.00 (1.00 to 1.00) | 1.00 (0.97 to 1.00) | 1.00 (0.99 to 1.00) |
| five-player ICM bubble | 50,000 | 0.0009652 | 0.88 (0.53 to 0.99) | 1.00 (1.00 to 1.00) | 0.96 (0.85 to 0.98) | 1.00 (1.00 to 1.00) |
| three-player river with side pots (ICM) | 5,000 | 0.7247 | 0.64 (0.52 to 0.72) | 1.00 (1.00 to 1.00) | 0.97 (0.95 to 0.98) | 1.00 (0.99 to 1.00) |
| three-player river with side pots (ICM) | 50,000 | 0.1899 | 0.66 (0.65 to 0.74) | 1.00 (1.00 to 1.00) | 0.89 (0.79 to 0.91) | 0.99 (0.96 to 1.00) |

| Measure | Seat gains checked | Above the exact gain | States | Median share | Smallest share | States below half | States at 90% or more |
|---|---|---|---|---|---|---|---|
| sampled | 560 | 0 | 130 | 0.41 | -0.09 | 81 | 10 |
| restricted | 560 | 0 | 130 | 1.00 | 0.04 | 34 | 94 |
| trained200000 | 560 | 0 | 130 | 0.96 | 0.19 | 7 | 91 |
| trained2000000 | 560 | 0 | 130 | 1.00 | 0.70 | 0 | 122 |

Estimate from independent deals: 1120 seat estimates; exact gain outside the distribution-free interval: 0; beyond 3 standard errors: 15; beyond 4: 0; largest distance 3.85 standard errors; opponent actions enumerated in 1120 and sampled in 0; estimates with zero standard error that differ from the exact value: 0.

| Game | Deals | Seconds: exact | sampled | restricted | trained 200000 | trained 2000000 |
|---|---|---|---|---|---|---|
| heads-up river | 50,000 | 0.0 | 0.2 | 0.0 | 0.3 | 0.9 |
| heads-up turn and river | 50,000 | 0.0 | 0.3 | 0.0 | 0.3 | 1.1 |
| three-player river, side pots | 50,000 | 0.0 | 1.0 | 0.0 | 1.6 | 3.7 |
| four-player turn and river | 50,000 | 0.0 | 5.6 | 0.0 | 6.5 | 8.4 |
| six-player flop, all-in or fold | 50,000 | 0.1 | 17.1 | 0.2 | 15.3 | 18.7 |
| eight-handed ICM final table | 50,000 | 0.1 | 32.8 | 0.2 | 61.0 | 67.9 |
| four-player ICM bubble | 50,000 | 1.2 | 0.5 | 1.2 | 5.6 | 7.7 |
| five-player flop | 50,000 | 0.0 | 5.6 | 0.1 | 4.2 | 6.4 |
| six-player flop, weighted ranges, two bet sizes | 50,000 | 1.2 | 35.9 | 2.7 | 24.1 | 27.9 |
| early stage: three-player flop, three streets of betting | 50,000 | 21.1 | 85.1 | 71.8 | 69.6 | 86.2 |
| medium stacks: three-player turn and river | 50,000 | 0.1 | 6.2 | 0.2 | 3.8 | 5.5 |
| short stacks: eight-handed push or fold (chip EV) | 50,000 | 16.0 | 37.4 | 21.7 | 197.7 | 220.8 |
| five-player ICM bubble | 50,000 | 1.7 | 1.5 | 1.8 | 15.4 | 19.2 |
| three-player river with side pots (ICM) | 50,000 | 0.0 | 1.1 | 0.0 | 1.5 | 3.3 |

**Result.**

1. *Direction*: no lower bound exceeded the exact value (0 of 560 seat gains for each measure).
2. *The 5.8 trained response is much tighter than both 5.7 measures on every game with more than one betting
   street.* Heads-up turn and river: 0.16 to 0.18 (one decision), 0.33 to 0.35 (restricted), 0.99 to 1.00 (trained,
   2,000,000 response deals). Four-player turn and river after 5,000 deals: 0.06, 0.06, 1.00. Three-player turn with
   medium stacks: 0.07 to 0.09, 0.21 to 0.23, 0.98 to 1.00. Three-street early-stage game: 0.01 to 0.02, 0.04 to
   0.06, 0.75 to 0.76.
3. *On single-street games the 5.7 restricted measure is already exact* (the first street is the whole game), and
   the trained response finds 0.96 to 1.00 of it. Nothing is gained there by the new measure.
4. *The trained response depends on its response budget.* 200,000 response deals: median 0.96, as low as 0.19
   (eight-handed push or fold, 50,000 training deals) and 0.31 (three-street game). 2,000,000: median 1.00, minimum
   0.70. On the three-street game even 2,000,000 response deals leave a quarter of NashConv unfound.
5. *Cost*: last table. A trained response for all seats costs seconds to a few minutes on these games; on the
   single-street games it is slower than the exact evaluator, which should be used there.

**Decision under the plan's promotion rule.** The rule asked for a median share at least equal to both 5.7 measures
in every game. That holds against the one-decision measure everywhere and against the restricted measure on the four
multi-street games, and does not hold on the ten single-street games, where the restricted measure is exact
(shares 1.00 against 0.96 to 1.00). The trained response is therefore **not** declared the single quality measure.
It is added as the measure for studies with more than one betting street or too large for the exact and restricted
evaluators; the exact and restricted evaluators remain what to use where they apply. The study workflow's built-in
quality column is unchanged (the 5.7 one-decision measure); the trained response is a separate command
(`mwcli --response`), because it costs a response training per seat.

## 3. The trained response on the shipped realistic fixtures (prespecified)

These fixtures have full ranges and no exact answer. **Nothing in this section says how far a strategy is from
equilibrium.** It compares two lower bounds of the same unknown NashConv.

**Plan** (`validation/5.8/convergence/realistic/plan.json`, written before measurement): fixtures `flop6-jack`
(six-player flop), `flop3-kings` (three-player flop), `btn25-open` (three-handed preflop with 25 BB) and
`icm8-bb-call` (eight-handed ICM, big blind facing an all-in); seeds 5811 to 5813; training budgets 50,000, 250,000
and 1,000,000 deals with the default trainer (each seed trained once, measured at the three budgets); the 5.7
one-decision measure with the study workflow's settings (20,000 samples) and the 5.8 trained response (1,000,000
response deals per seat, 409,600 evaluation deals, opponent actions sampled). Expectation stated in the plan: the
trained response finds more on the multi-street fixtures; on `icm8-bb-call` the two may be close.

| Fixture | Deals | Table MiB | One-decision measure (5.7): mean of seeds (largest sum of the seats' standard errors) | Trained response (5.8): mean of seeds | Trained, per seed (standard error) | Sum of the seats' distribution-free 95% lower bounds: per seed | Seeds where trained is larger | Opponent actions | Seconds: one-decision / trained | Peak resident MiB of the trained-response run |
|---|---|---|---|---|---|---|---|---|---|---|
| flop6-jack | 50,000 | 11.7 | 0.205 (0.22) | 7.06 | 6.61 (0.037), 7.16 (0.041), 7.42 (0.041) | 6.3, 6.82, 7.08 | 3 of 3 | sampled | 1 / 45 | 194 |
| flop6-jack | 250,000 | 20.0 | -0.213 (0.22) | 2.83 | 2.74 (0.032), 2.89 (0.035), 2.85 (0.031) | 2.47, 2.6, 2.58 | 3 of 3 | sampled | 1 / 45 | 194 |
| flop6-jack | 1,000,000 | 31.4 | -0.216 (0.19) | 1.08 | 0.997 (0.026), 1.19 (0.029), 1.05 (0.027) | 0.765, 0.934, 0.822 | 3 of 3 | sampled | 1 / 46 | 250 |
| flop3-kings | 50,000 | 8.1 | 0.135 (0.039) | 3.67 | 3.73 (0.013), 3.74 (0.012), 3.52 (0.012) | 3.66, 3.67, 3.45 | 3 of 3 | enumerated | 13 / 128 | 145 |
| flop3-kings | 250,000 | 14.4 | 0.028 (0.043) | 1.4 | 1.45 (0.01), 1.34 (0.0086), 1.42 (0.0098) | 1.38, 1.29, 1.36 | 3 of 3 | enumerated | 14 / 94 | 186 |
| flop3-kings | 1,000,000 | 17.2 | 0.016 (0.05) | 0.428 | 0.4 (0.0088), 0.44 (0.0076), 0.443 (0.0065) | 0.347, 0.391, 0.399 | 3 of 3 | enumerated | 15 / 116 | 198 |
| btn25-open | 50,000 | 36.4 | 0.248 (0.063) | 2.68 | 2.64 (0.012), 2.73 (0.012), 2.66 (0.013) | 2.57, 2.66, 2.59 | 3 of 3 | enumerated | 48 / 97 | 660 |
| btn25-open | 250,000 | 125.9 | 0.0395 (0.056) | 1.38 | 1.37 (0.011), 1.42 (0.011), 1.35 (0.011) | 1.3, 1.36, 1.28 | 3 of 3 | enumerated | 57 / 102 | 760 |
| btn25-open | 1,000,000 | 291.5 | -0.029 (0.049) | 0.276 | 0.258 (0.0082), 0.297 (0.0082), 0.274 (0.0084) | 0.215, 0.246, 0.224 | 3 of 3 | enumerated | 70 / 116 | 1239 |
| icm8-bb-call | 50,000 | 6.6 | 0.0629 (0.011) | 0.135 | 0.122 (0.002), 0.134 (0.0021), 0.148 (0.0022) | 0.108, 0.119, 0.133 | 3 of 3 | enumerated | 1 / 3 | 78 |
| icm8-bb-call | 250,000 | 11.4 | 0.0121 (0.011) | 0.0322 | 0.0309 (0.0015), 0.0336 (0.0013), 0.032 (0.0014) | 0.0187, 0.0223, 0.0206 | 3 of 3 | enumerated | 1 / 2 | 78 |
| icm8-bb-call | 1,000,000 | 17.2 | 0.000979 (0.0097) | 0.00345 | 0.00347 (0.0013), 0.00427 (0.0014), 0.00261 (0.0014) | 0, 0, 0 | 2 of 3 | enumerated | 1 / 2 | 78 |

Cells measured: 36 of 36 planned. Errors recorded: none.

Units: BB per hand for the three chip-EV fixtures; the fixture's prize units for `icm8-bb-call`. All 36 planned
cells were measured, none failed, and the run was not interrupted.

**Reading.**

1. **The trained response finds far more than the 5.7 one-decision measure on every fixture.** Six-player flop
   after 1,000,000 deals: the one-decision measure reports -0.22 with a standard error of 0.19 — nothing
   distinguishable from zero — while the trained responses gain 1.0 to 1.2 BB per hand in total, and the
   distribution-free bounds alone establish a **NashConv of at least 0.77, 0.93 and 0.82 BB** for the three seeds.
   Three-player flop: 0.016 against 0.43 (at least 0.35 to 0.40). Preflop with 25 BB: -0.03 against 0.28 (at least
   0.22 to 0.25). It was larger in 35 of the 36 cells; the exception is one seed of the ICM fixture at 1,000,000
   deals, where both are small (0.006 against 0.003, standard errors 0.01 and 0.001).
2. **The expectation written in the plan was met** for the three multi-street fixtures. For `icm8-bb-call` the plan
   said the two "may be close"; the trained response was about twice as large at 50,000 and 250,000 deals; at
   1,000,000 deals its estimates (0.003 to 0.004) are two to three standard errors above zero while the
   distribution-free bounds are 0, 0, 0: a positive gain is likely and not established.
3. **What the 5.7 study column told a user of these fixtures was therefore much too favourable**: a "quality" value
   near zero after a million deals on the six-player flop study did not mean a strategy near equilibrium. The true
   NashConv of that strategy is at least 0.77 BB per hand and may be considerably more.
4. **The bound falls as training goes on** on every fixture and seed (six-player flop: 7.1, 2.8, 1.1 BB at 50,000,
   250,000 and 1,000,000 deals). That is consistent with convergence. It does not prove it: these are lower bounds
   from a response with a fixed budget of 1,000,000 deals, and on the three-street reference game a response of twice
   that budget found only three quarters of the true value (section 2).
5. **Seeds agree.** The three independent trainings of a cell differ by 3% to 18% of their mean, several times the
   evaluation standard errors: the variation between trainings is real and is larger than the measurement error of
   one training. Three seeds do not give a useful interval for it, and none is stated.
6. **Which interval.** The six-player flop fixture is evaluated with sampled opponent actions, where only the
   distribution-free bound is a guarantee (MATHEMATICAL-VALIDATION-5.8.md, section 3.4); that is why the table
   prints it. On the other three fixtures the opponents' actions are enumerated.
7. **Cost.** 2 seconds (the ICM fixture) to about two minutes for all seats of a fixture, three seats side by side
   on this machine, against 1 to 70 seconds for the one-decision measure; up to 1.2 GiB of resident memory for the largest table
   (three copies of the state, one per seat in progress).

**What this section does not show:** an upper bound. "At least 0.77 BB" is established; "at most" anything is not.

## 4. Against 5.7.1: equal sampled deals and equal wall-clock time (prespecified)

5.8 changed no trainer. The plan (`validation/5.8/convergence/main/plan.json`) therefore asks whether the 5.8 binary
writes the 5.7.1 binary's checkpoint at equal deals (it must), and whether it is worse at equal time (a "worse"
verdict would be a regression). Ten reference games, 20 paired seeds from 5801, four arms (the default trainer and
frozen 64-deal batches on four threads, each with both binaries), 19,200 deals and 1.0 s; every checkpoint evaluated
by the exact best response. Statistics unchanged from 5.7 (`research57.py`): exact sign test and paired Student-t
interval, both Bonferroni-adjusted; "better" or "worse" needs both on the same side; anything else is "unresolved".

| Game | Budget | Contrast | Role | Mean NashConv: candidate / reference | Ratio | Seeds lower / higher / equal | Sign test p (Bonferroni) | t interval (Bonferroni) | Identical files | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| hu-river | 19200 deals | default58 vs default571 | primary | 0.306 / 0.306 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| hu-river | 19200 deals | batch58t4 vs batch571t4 | descriptive | 0.437 / 0.437 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| hu-river | 19200 deals | batch58t4 vs default58 | descriptive | 0.437 / 0.306 | 1.428 | 1 / 19 / 0 | 0.0004 | [0.0574, 0.205] |  | **worse** |
| hu-river | 1.0 s | default58 vs default571 | primary | 0.02504 / 0.02694 | 0.929 | 13 / 7 / 0 | 1 | [-0.00663, 0.00282] |  | **unresolved** |
| hu-river | 1.0 s | batch58t4 vs batch571t4 | descriptive | 0.03384 / 0.03556 | 0.951 | 12 / 8 / 0 | 1 | [-0.00814, 0.00469] |  | **unresolved** |
| hu-river | 1.0 s | batch58t4 vs default58 | descriptive | 0.03384 / 0.02504 | 1.352 | 4 / 16 / 0 | 0.12 | [0.00135, 0.0163] |  | **unresolved** |
| hu-turn | 19200 deals | default58 vs default571 | primary | 0.3694 / 0.3694 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| hu-turn | 19200 deals | batch58t4 vs batch571t4 | descriptive | 0.5035 / 0.5035 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| hu-turn | 19200 deals | batch58t4 vs default58 | descriptive | 0.5035 / 0.3694 | 1.363 | 0 / 20 / 0 | 1.9e-05 | [0.0969, 0.171] |  | **worse** |
| hu-turn | 1.0 s | default58 vs default571 | primary | 0.04557 / 0.04649 | 0.980 | 9 / 11 / 0 | 1 | [-0.00602, 0.00419] |  | **unresolved** |
| hu-turn | 1.0 s | batch58t4 vs batch571t4 | descriptive | 0.05683 / 0.05401 | 1.052 | 8 / 12 / 0 | 1 | [-0.00227, 0.00791] |  | **unresolved** |
| hu-turn | 1.0 s | batch58t4 vs default58 | descriptive | 0.05683 / 0.04557 | 1.247 | 1 / 19 / 0 | 0.0004 | [0.00598, 0.0165] |  | **worse** |
| river3-chip | 19200 deals | default58 vs default571 | primary | 0.1338 / 0.1338 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| river3-chip | 19200 deals | batch58t4 vs batch571t4 | descriptive | 0.194 / 0.194 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| river3-chip | 19200 deals | batch58t4 vs default58 | descriptive | 0.194 / 0.1338 | 1.450 | 4 / 16 / 0 | 0.12 | [0.0272, 0.0932] |  | **unresolved** |
| river3-chip | 1.0 s | default58 vs default571 | primary | 0.02117 / 0.01967 | 1.076 | 10 / 10 / 0 | 1 | [-0.0055, 0.00849] |  | **unresolved** |
| river3-chip | 1.0 s | batch58t4 vs batch571t4 | descriptive | 0.01954 / 0.0214 | 0.913 | 11 / 9 / 0 | 1 | [-0.00605, 0.00233] |  | **unresolved** |
| river3-chip | 1.0 s | batch58t4 vs default58 | descriptive | 0.01954 / 0.02117 | 0.923 | 10 / 10 / 0 | 1 | [-0.0098, 0.00654] |  | **unresolved** |
| turn4 | 19200 deals | default58 vs default571 | primary | 0.09855 / 0.09855 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| turn4 | 19200 deals | batch58t4 vs batch571t4 | descriptive | 0.09677 / 0.09677 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| turn4 | 19200 deals | batch58t4 vs default58 | descriptive | 0.09677 / 0.09855 | 0.982 | 9 / 11 / 0 | 1 | [-0.0648, 0.0612] |  | **unresolved** |
| turn4 | 1.0 s | default58 vs default571 | primary | 6.494e-05 / 6.501e-05 | 0.999 | 15 / 5 / 0 | 0.41 | [-1.32e-05, 1.3e-05] |  | **unresolved** |
| turn4 | 1.0 s | batch58t4 vs batch571t4 | descriptive | 6.726e-05 / 6.479e-05 | 1.038 | 9 / 11 / 0 | 1 | [-1.55e-05, 2.05e-05] |  | **unresolved** |
| turn4 | 1.0 s | batch58t4 vs default58 | descriptive | 6.726e-05 / 6.494e-05 | 1.036 | 9 / 11 / 0 | 1 | [-4.76e-05, 5.23e-05] |  | **unresolved** |
| flop6 | 19200 deals | default58 vs default571 | primary | 0.371 / 0.371 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| flop6 | 19200 deals | batch58t4 vs batch571t4 | descriptive | 0.4187 / 0.4187 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| flop6 | 19200 deals | batch58t4 vs default58 | descriptive | 0.4187 / 0.371 | 1.129 | 8 / 12 / 0 | 1 | [-0.104, 0.2] |  | **unresolved** |
| flop6 | 1.0 s | default58 vs default571 | primary | 0.05662 / 0.05435 | 1.042 | 7 / 13 / 0 | 1 | [-0.0135, 0.0181] |  | **unresolved** |
| flop6 | 1.0 s | batch58t4 vs batch571t4 | descriptive | 0.05669 / 0.05461 | 1.038 | 9 / 11 / 0 | 1 | [-0.00882, 0.013] |  | **unresolved** |
| flop6 | 1.0 s | batch58t4 vs default58 | descriptive | 0.05669 / 0.05662 | 1.001 | 12 / 8 / 0 | 1 | [-0.0507, 0.0509] |  | **unresolved** |
| flop6w | 19200 deals | default58 vs default571 | primary | 0.9903 / 0.9903 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| flop6w | 19200 deals | batch58t4 vs batch571t4 | descriptive | 1.084 / 1.084 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| flop6w | 19200 deals | batch58t4 vs default58 | descriptive | 1.084 / 0.9903 | 1.094 | 6 / 14 / 0 | 1 | [-0.0633, 0.25] |  | **unresolved** |
| flop6w | 1.0 s | default58 vs default571 | primary | 0.2595 / 0.26 | 0.998 | 10 / 10 / 0 | 1 | [-0.0327, 0.0317] |  | **unresolved** |
| flop6w | 1.0 s | batch58t4 vs batch571t4 | descriptive | 0.1944 / 0.1967 | 0.988 | 8 / 12 / 0 | 1 | [-0.0335, 0.0288] |  | **unresolved** |
| flop6w | 1.0 s | batch58t4 vs default58 | descriptive | 0.1944 / 0.2595 | 0.749 | 16 / 4 / 0 | 0.12 | [-0.155, 0.0248] |  | **unresolved** |
| final8 | 19200 deals | default58 vs default571 | primary | 0.004612 / 0.004612 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| final8 | 19200 deals | batch58t4 vs batch571t4 | descriptive | 0.005272 / 0.005272 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| final8 | 19200 deals | batch58t4 vs default58 | descriptive | 0.005272 / 0.004612 | 1.143 | 7 / 13 / 0 | 1 | [-0.00759, 0.00891] |  | **unresolved** |
| final8 | 1.0 s | default58 vs default571 | primary | 2.699e-05 / 3.343e-05 | 0.807 | 16 / 4 / 0 | 0.12 | [-1.71e-05, 4.19e-06] |  | **unresolved** |
| final8 | 1.0 s | batch58t4 vs batch571t4 | descriptive | 7.79e-06 / 8.375e-06 | 0.930 | 14 / 6 / 0 | 1 | [-3.23e-06, 2.06e-06] |  | **unresolved** |
| final8 | 1.0 s | batch58t4 vs default58 | descriptive | 7.79e-06 / 2.699e-05 | 0.289 | 9 / 11 / 0 | 1 | [-5.66e-05, 1.82e-05] |  | **unresolved** |
| bubble4 | 19200 deals | default58 vs default571 | primary | 0.004094 / 0.004094 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| bubble4 | 19200 deals | batch58t4 vs batch571t4 | descriptive | 0.003371 / 0.003371 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| bubble4 | 19200 deals | batch58t4 vs default58 | descriptive | 0.003371 / 0.004094 | 0.823 | 10 / 10 / 0 | 1 | [-0.00454, 0.00309] |  | **unresolved** |
| bubble4 | 1.0 s | default58 vs default571 | primary | 2.621e-06 / 2.675e-06 | 0.980 | 11 / 9 / 0 | 1 | [-3.79e-07, 2.7e-07] |  | **unresolved** |
| bubble4 | 1.0 s | batch58t4 vs batch571t4 | descriptive | 9.515e-07 / 1.085e-06 | 0.877 | 8 / 12 / 0 | 1 | [-6.03e-07, 3.36e-07] |  | **unresolved** |
| bubble4 | 1.0 s | batch58t4 vs default58 | descriptive | 9.515e-07 / 2.621e-06 | 0.363 | 16 / 4 / 0 | 0.12 | [-3.95e-06, 6.14e-07] |  | **unresolved** |
| mid3-turn | 19200 deals | default58 vs default571 | primary | 3.012 / 3.012 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| mid3-turn | 19200 deals | batch58t4 vs batch571t4 | descriptive | 3.167 / 3.167 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| mid3-turn | 19200 deals | batch58t4 vs default58 | descriptive | 3.167 / 3.012 | 1.051 | 6 / 14 / 0 | 1 | [-0.105, 0.415] |  | **unresolved** |
| mid3-turn | 1.0 s | default58 vs default571 | primary | 0.7538 / 0.7209 | 1.046 | 10 / 10 / 0 | 1 | [-0.0235, 0.0893] |  | **unresolved** |
| mid3-turn | 1.0 s | batch58t4 vs batch571t4 | descriptive | 0.7376 / 0.7928 | 0.930 | 15 / 5 / 0 | 0.41 | [-0.122, 0.0117] |  | **unresolved** |
| mid3-turn | 1.0 s | batch58t4 vs default58 | descriptive | 0.7376 / 0.7538 | 0.979 | 11 / 9 / 0 | 1 | [-0.125, 0.0929] |  | **unresolved** |
| sidepot3-icm | 19200 deals | default58 vs default571 | primary | 0.337 / 0.337 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| sidepot3-icm | 19200 deals | batch58t4 vs batch571t4 | descriptive | 0.3145 / 0.3145 | 1.000 | 0 / 0 / 20 | n/a |  | 20 of 20 | **identical** |
| sidepot3-icm | 19200 deals | batch58t4 vs default58 | descriptive | 0.3145 / 0.337 | 0.933 | 11 / 9 / 0 | 1 | [-0.104, 0.0587] |  | **unresolved** |
| sidepot3-icm | 1.0 s | default58 vs default571 | primary | 0.05539 / 0.05433 | 1.020 | 10 / 10 / 0 | 1 | [-0.00637, 0.0085] |  | **unresolved** |
| sidepot3-icm | 1.0 s | batch58t4 vs batch571t4 | descriptive | 0.04533 / 0.04556 | 0.995 | 8 / 12 / 0 | 1 | [-0.00602, 0.00555] |  | **unresolved** |
| sidepot3-icm | 1.0 s | batch58t4 vs default58 | descriptive | 0.04533 / 0.05539 | 0.818 | 14 / 6 / 0 | 1 | [-0.0223, 0.00215] |  | **unresolved** |

| Game | Budget | Arm | Mean NashConv | Mean sampled deals |
|---|---|---|---|---|
| hu-river | deals:19200 | default58 | 0.306 | 19,200 |
| hu-river | deals:19200 | batch571t4 | 0.437 | 19,200 |
| hu-river | deals:19200 | batch58t4 | 0.437 | 19,200 |
| hu-river | deals:19200 | default571 | 0.306 | 19,200 |
| hu-river | time:1.0 | default58 | 0.02504 | 1,721,472 |
| hu-river | time:1.0 | batch571t4 | 0.03556 | 1,789,040 |
| hu-river | time:1.0 | batch58t4 | 0.03384 | 1,782,512 |
| hu-river | time:1.0 | default571 | 0.02694 | 1,699,512 |
| hu-turn | deals:19200 | default58 | 0.3694 | 19,200 |
| hu-turn | deals:19200 | batch571t4 | 0.5035 | 19,200 |
| hu-turn | deals:19200 | batch58t4 | 0.5035 | 19,200 |
| hu-turn | deals:19200 | default571 | 0.3694 | 19,200 |
| hu-turn | time:1.0 | default58 | 0.04557 | 1,263,407 |
| hu-turn | time:1.0 | batch571t4 | 0.05401 | 1,334,205 |
| hu-turn | time:1.0 | batch58t4 | 0.05683 | 1,331,286 |
| hu-turn | time:1.0 | default571 | 0.04649 | 1,255,380 |
| river3-chip | deals:19200 | default58 | 0.1338 | 19,200 |
| river3-chip | deals:19200 | batch571t4 | 0.194 | 19,200 |
| river3-chip | deals:19200 | batch58t4 | 0.194 | 19,200 |
| river3-chip | deals:19200 | default571 | 0.1338 | 19,200 |
| river3-chip | time:1.0 | default58 | 0.02117 | 851,255 |
| river3-chip | time:1.0 | batch571t4 | 0.0214 | 1,056,061 |
| river3-chip | time:1.0 | batch58t4 | 0.01954 | 1,054,269 |
| river3-chip | time:1.0 | default571 | 0.01967 | 873,471 |
| turn4 | deals:19200 | default58 | 0.09855 | 19,200 |
| turn4 | deals:19200 | batch571t4 | 0.09677 | 19,200 |
| turn4 | deals:19200 | batch58t4 | 0.09677 | 19,200 |
| turn4 | deals:19200 | default571 | 0.09855 | 19,200 |
| turn4 | time:1.0 | default58 | 6.494e-05 | 594,524 |
| turn4 | time:1.0 | batch571t4 | 6.479e-05 | 723,370 |
| turn4 | time:1.0 | batch58t4 | 6.726e-05 | 702,064 |
| turn4 | time:1.0 | default571 | 6.501e-05 | 588,687 |
| flop6 | deals:19200 | default58 | 0.371 | 19,200 |
| flop6 | deals:19200 | batch571t4 | 0.4187 | 19,200 |
| flop6 | deals:19200 | batch58t4 | 0.4187 | 19,200 |
| flop6 | deals:19200 | default571 | 0.371 | 19,200 |
| flop6 | time:1.0 | default58 | 0.05662 | 315,513 |
| flop6 | time:1.0 | batch571t4 | 0.05461 | 603,619 |
| flop6 | time:1.0 | batch58t4 | 0.05669 | 606,579 |
| flop6 | time:1.0 | default571 | 0.05435 | 322,521 |
| flop6w | deals:19200 | default58 | 0.9903 | 19,200 |
| flop6w | deals:19200 | batch571t4 | 1.084 | 19,200 |
| flop6w | deals:19200 | batch58t4 | 1.084 | 19,200 |
| flop6w | deals:19200 | default571 | 0.9903 | 19,200 |
| flop6w | time:1.0 | default58 | 0.2595 | 229,393 |
| flop6w | time:1.0 | batch571t4 | 0.1967 | 417,440 |
| flop6w | time:1.0 | batch58t4 | 0.1944 | 424,800 |
| flop6w | time:1.0 | default571 | 0.26 | 221,535 |
| final8 | deals:19200 | default58 | 0.004612 | 19,200 |
| final8 | deals:19200 | batch571t4 | 0.005272 | 19,200 |
| final8 | deals:19200 | batch58t4 | 0.005272 | 19,200 |
| final8 | deals:19200 | default571 | 0.004612 | 19,200 |
| final8 | time:1.0 | default58 | 2.699e-05 | 227,591 |
| final8 | time:1.0 | batch571t4 | 8.375e-06 | 485,824 |
| final8 | time:1.0 | batch58t4 | 7.79e-06 | 516,931 |
| final8 | time:1.0 | default571 | 3.343e-05 | 215,720 |
| bubble4 | deals:19200 | default58 | 0.004094 | 19,200 |
| bubble4 | deals:19200 | batch571t4 | 0.003371 | 19,200 |
| bubble4 | deals:19200 | batch58t4 | 0.003371 | 19,200 |
| bubble4 | deals:19200 | default571 | 0.004094 | 19,200 |
| bubble4 | time:1.0 | default58 | 2.621e-06 | 751,210 |
| bubble4 | time:1.0 | batch571t4 | 1.085e-06 | 1,134,378 |
| bubble4 | time:1.0 | batch58t4 | 9.515e-07 | 1,124,534 |
| bubble4 | time:1.0 | default571 | 2.675e-06 | 761,017 |
| mid3-turn | deals:19200 | default58 | 3.012 | 19,200 |
| mid3-turn | deals:19200 | batch571t4 | 3.167 | 19,200 |
| mid3-turn | deals:19200 | batch58t4 | 3.167 | 19,200 |
| mid3-turn | deals:19200 | default571 | 3.012 | 19,200 |
| mid3-turn | time:1.0 | default58 | 0.7538 | 403,947 |
| mid3-turn | time:1.0 | batch571t4 | 0.7928 | 481,155 |
| mid3-turn | time:1.0 | batch58t4 | 0.7376 | 496,522 |
| mid3-turn | time:1.0 | default571 | 0.7209 | 416,902 |
| sidepot3-icm | deals:19200 | default58 | 0.337 | 19,200 |
| sidepot3-icm | deals:19200 | batch571t4 | 0.3145 | 19,200 |
| sidepot3-icm | deals:19200 | batch58t4 | 0.3145 | 19,200 |
| sidepot3-icm | deals:19200 | default571 | 0.337 | 19,200 |
| sidepot3-icm | time:1.0 | default58 | 0.05539 | 808,564 |
| sidepot3-icm | time:1.0 | batch571t4 | 0.04556 | 1,067,357 |
| sidepot3-icm | time:1.0 | batch58t4 | 0.04533 | 1,053,757 |
| sidepot3-icm | time:1.0 | default571 | 0.05433 | 846,545 |

(Plan written 2026-11-24T11:16Z; the measurements followed. 1,600 rows; nothing failed; the machine ran nothing
else. Units: BB per hand, or prize units for `final8`, `bubble4` and `sidepot3-icm`.)

**Equal sampled deals.** In all ten games and for both trainers the 5.8 binary wrote the checkpoint file of the
5.7.1 binary: **400 of 400 pairs byte-identical**. At equal deals 5.8 *is* 5.7.1; there is no difference to test.

**Equal wall-clock time, primary contrast (5.8 default trainer against 5.7.1 default trainer, 1.0 s).** Ten of ten
"unresolved"; none "worse", none "better". Ratios of mean NashConv 0.81 to 1.08. Since both binaries perform the
same updates, any difference at equal time can only come from the number of deals completed in the second: 5.8
completed 0.955 to 1.055 times the deals of 5.7.1 (median 0.997), most on the eight-handed ICM final table (+5.5%,
the game the ICM cache helps), which is also where the NashConv ratio is lowest (0.81; 16 of 20 seeds lower; not
resolved by the test). **5.8 is not worse than 5.7.1 at equal time in any game, and is not shown to be better in
any.** That is the expected result of a release that changed no trainer.

**Descriptive contrasts (same penalty; not claims).**

- Frozen 64-deal batches on four threads, 5.8 against 5.7.1: identical at equal deals; unresolved in all ten games at
  equal time; deals per second 0.97 to 1.06 times those of 5.7.1 (median 1.00).
- Frozen batches on four threads against the default trainer on one thread (both 5.8): at equal deals **worse** on
  the two heads-up games (NashConv 1.36 and 1.43 times the default's: 64 deals share one strategy update) and
  unresolved on the other eight; at equal time **worse** on the heads-up turn game (1.25 times), unresolved on the
  other nine, with ratios from 0.29 to 1.35. Four threads complete 1.04 to 2.27 times the deals of one thread in the
  same second (median 1.27). This repeats the finding of CONVERGENCE-5.7.md: frozen batches on several threads are
  an option that helps on some multiway and ICM games and hurts on small heads-up games, and are not the default.

## 5. The six-player flop games (prespecified, independent seeds)

Plan (`validation/5.8/convergence/flop6/plan.json`): `flop6` and `flop6w`, 60 paired seeds from 5901 (not used by
any earlier experiment), 0.5 s and 2.0 s of training, arms: 5.7.1 default trainer, 5.8 default trainer, 5.8 frozen
batches on four threads. Primary contrast: 5.8 default against 5.7.1 default. Promotion rule: none — the result is
"unchanged" unless the primary contrast is "better" or "worse" at 2.0 s.

| Game | Budget | Contrast | Role | Mean NashConv: candidate / reference | Ratio | Seeds lower / higher / equal | Sign test p (Bonferroni) | t interval (Bonferroni) | Identical files | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| flop6 | 0.5 s | default58 vs default571 | primary | 0.08787 / 0.08692 | 1.011 | 30 / 30 / 0 | 1 | [-0.0105, 0.0124] |  | **unresolved** |
| flop6 | 0.5 s | batch58t4 vs default58 | descriptive | 0.06534 / 0.08787 | 0.744 | 40 / 20 / 0 | 0.027 | [-0.0487, 0.00367] |  | **unresolved** |
| flop6 | 2.0 s | default58 vs default571 | primary | 0.05035 / 0.04563 | 1.103 | 26 / 34 / 0 | 0.73 | [-0.00173, 0.0112] |  | **unresolved** |
| flop6 | 2.0 s | batch58t4 vs default58 | descriptive | 0.04306 / 0.05035 | 0.855 | 31 / 29 / 0 | 1 | [-0.0195, 0.00488] |  | **unresolved** |
| flop6w | 0.5 s | default58 vs default571 | primary | 0.3663 / 0.3806 | 0.962 | 35 / 25 / 0 | 0.49 | [-0.0369, 0.00839] |  | **unresolved** |
| flop6w | 0.5 s | batch58t4 vs default58 | descriptive | 0.2978 / 0.3663 | 0.813 | 37 / 23 / 0 | 0.18 | [-0.115, -0.0217] |  | **unresolved** |
| flop6w | 2.0 s | default58 vs default571 | primary | 0.1636 / 0.1613 | 1.014 | 28 / 32 / 0 | 1 | [-0.00721, 0.0119] |  | **unresolved** |
| flop6w | 2.0 s | batch58t4 vs default58 | descriptive | 0.1364 / 0.1636 | 0.833 | 35 / 25 / 0 | 0.49 | [-0.0513, -0.00325] |  | **unresolved** |

| Game | Budget | Arm | Mean NashConv | Mean sampled deals |
|---|---|---|---|---|
| flop6 | time:0.5 | default571 | 0.08692 | 161,956 |
| flop6 | time:0.5 | default58 | 0.08787 | 162,615 |
| flop6 | time:0.5 | batch58t4 | 0.06534 | 320,163 |
| flop6 | time:2.0 | default571 | 0.04563 | 679,687 |
| flop6 | time:2.0 | default58 | 0.05035 | 654,034 |
| flop6 | time:2.0 | batch58t4 | 0.04306 | 1,322,607 |
| flop6w | time:0.5 | default571 | 0.3806 | 114,330 |
| flop6w | time:0.5 | default58 | 0.3663 | 114,663 |
| flop6w | time:0.5 | batch58t4 | 0.2978 | 210,119 |
| flop6w | time:2.0 | default571 | 0.1613 | 472,810 |
| flop6w | time:2.0 | default58 | 0.1636 | 466,188 |
| flop6w | time:2.0 | batch58t4 | 0.1364 | 891,579 |

(Plan written 2026-11-24T11:39Z; 720 rows; nothing failed.)

**Primary contrast: unresolved at both budgets on both games.** At 2.0 s the ratio of mean NashConv is 1.10 on
`flop6` (26 seeds lower, 34 higher; interval [-0.0017, 0.0112] BB) and 1.01 on `flop6w` (28 lower, 32 higher).
By the plan's rule **the six-player flop result of 5.8 is "unchanged"**. This is the expected result: at equal deals
the two binaries write identical checkpoints (section 4), and in 2.0 s they completed 654,000 against 680,000 deals
on `flop6` and 466,000 against 473,000 on `flop6w`, differences of 1% to 4% that come from the machine and not from
the program.

**Descriptive: frozen batches on four threads against the default trainer (both 5.8).** Lower mean NashConv in all
four cells (ratios 0.74 to 0.86, with twice the deals in the same time), and "unresolved" in all four: on `flop6`
at 0.5 s the sign test is below 0.05 after adjustment (40 of 60 seeds lower) but the t interval includes zero; on
`flop6w` the t interval excludes zero at both budgets but the sign test does not reject. The rule requires both, so
no claim is made. The direction agrees with what 5.7 found for these games.

**Did the six-player flop convergence result improve in 5.8?** No. It is unchanged, by construction and by
measurement. What 5.8 changed for the six-player flop is the *measurement* of quality (section 3), not the
strategy that training produces.

## 6. What was and was not promoted

| Candidate | Decision | Why |
|---|---|---|
| trained response as a quality measure for multi-street and large studies | **added** (`mwcli --response`), not made the default study column | direction proven and never violated; much tighter than the 5.7 measures on multi-street games; not tighter than the restricted measure on single-street games; costs a response training per seat |
| a different default trainer | **none proposed** | 5.8 has no new trainer; the default trainer is the 5.7.1 trainer, bit for bit |
| frozen batches on several threads as default | **not promoted** (unchanged from 5.7) | section 4 and 5: descriptive contrasts only; see the readings above |
| ICM cache (four-way) | **adopted** | a performance change with bit-identical values (PERFORMANCE-5.8.md, section 5); not a convergence change |
| compact row offsets | **rejected** | no measurable gain (`validation/5.8/experiments/compact-row-offsets.md`) |

## 7. Raw data

Everything is in the archive, including runs that failed or were interrupted:

| Experiment | Folder under `validation/5.8/convergence/` | Files |
|---|---|---|
| lower bounds against exact NashConv | `response/` | `plan.json`, `raw.jsonl` (one line per state), `resumed.json`, `summary.json` |
| sampled opponent actions against exact gains | `sampled-actions/` | `plan.json`, `raw.jsonl`, `summary.json` |
| unbiasedness of the sampled-action estimate | `unbiased/` | `plan.json`, `raw.jsonl`, `summary.json` |
| realistic fixtures | `realistic/` | `plan.json`, `raw.jsonl`, `summary.json` (and `resumed.json` if the run was continued) |
| against 5.7.1, ten games | `main/` | `plan.json`, `raw.jsonl`, `analysis.json` |
| six-player flop | `flop6/` | `plan.json`, `raw.jsonl`, `analysis.json` |

Each runner writes its plan before it measures and refuses to reuse an output directory. Seeds, budgets and
thresholds were fixed in the plans; none was chosen after looking at results.

## 8. What would support a stronger statement

1. **An upper bound of NashConv for large games.** None exists here. Candidates: exact best responses inside
   sampled public subtrees with a proven bound on the remainder; or a response whose sub-optimality is itself
   bounded. Without one, "close to equilibrium" cannot be claimed for a full-range multiway study.
2. **Reference games between the small exact ones and the fixtures**: tens of hands a seat, still enumerable with
   more time, to see how the share found by a trained response behaves as the game grows.
3. **Response budgets that scale with the game**, with a stopping rule based on the response's own measured
   improvement, and replication of the response training (several response seeds) to show its variability.
4. **The abstraction error**: bet-size and range sensitivity measured across abstractions, which no figure here
   addresses.
