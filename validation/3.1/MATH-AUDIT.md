# EightMax 3.1 mathematical audit

Scope: the JavaScript reference (`source/web/lib_wide.js`, `lib_river.js`,
`lib_pots.js`, `lib_icm.js`) and the native engine (`source/native/mw.cpp`,
`mw_es.hpp`, `mw_es_impl.hpp`, `icm.hpp`, `score.cu`). Each item lists what
was checked, how, and the outcome. "Verified by test" names the regression
that now guards it.

## Estimators

| Item | Finding | Evidence |
|---|---|---|
| Chance-sampled CFR, full betting traversal (`walk`) | Regret increment `step · w · π₋ᵢ(h) · (v(h,a) − v(h))` uses the product of all other seats' reach; the average increment uses own reach `πᵢ(h) · σ(a)`. Correct counterfactual weighting for n players. | Code review; 3.0/3.1 native and JS bit-identical (v29, v31). |
| External-sampling MCCFR (`learn`) | Opponents sample from q = 0.9σ + 0.1/k. An opponent node returns σ(a)/q(a) times the child value; the updating seat's regret uses π₋ᵢ(h)/q₋ᵢ(h) for opponent nodes **before** h. Each opponent ratio is applied once, so the regret estimate is unbiased. No double counting. | Derivation below; native port bit-identical (v31, 12 configurations). |
| ES average strategy | Increment `πᵢ(h) σ(a) / q₋ᵢ(h)` at the updating seat. Its expectation is πᵢ(I) σ(a) times the chance probability of I's private and public cards, a constant per information set, so the average is correctly own-reach weighted. | Derivation below. |
| Regret matching | σ(a) = max(0,R(a)) / Σ max(0,R), uniform if the sum is 0. JS `Math.max(0,x)` maps −0 to +0; the 3.1 native code uses the same rule (`jsMax0`). | v31 bit parity. |
| CFR+ | Clipping is applied after each committed update (immediately for one deal per update, at commit for frozen batches). | v29/v31 parity. |
| Linear weighting | Iteration t contributes with weight t to regrets and averages (Brown & Sandholm 2019). | Code review. |
| DCFR (native CLI only) | Discounts are applied to every row ever visited before iteration t's update. Rows first created later held zeros, so skipping them is exact. Positive regrets scale uniformly, so the policy of the current iteration is unchanged. Implementation correct. Not exposed in the UI: measured worse than linear CFR at equal time (0.084 ± 0.002 vs 0.073 ± 0.021 BB at 1 s; 2.9 reached the same conclusion). Refused for external sampling. | `variants` run in RELEASE-3.1.md. |
| Frozen batches | Every deal in a batch reads the committed policy; increments are divided by the batch size and committed once, in deal order. Thread-count independent. | v29/v31 thread tests, TSan. |
| Own-hand enumeration | Each compatible hand of the updating seat is weighted by its conditional probability given the other seats' sampled cards and the board. Unbiased. | v29 parity. |
| Stratified river batches | x = (index + U)·M/B selects one tuple per equal-mass stratum; the batch mean is unbiased for a frozen policy. | v28/v29. |

## Chance, blockers and utilities

| Item | Finding | Evidence |
|---|---|---|
| Card removal | The dealer rejects the entire seat tuple on any collision. This samples exactly the conditional joint distribution ∝ Π wᵢ·1{compatible}; per-seat retries would bias earlier seats. | v29 weighted-range test; v31 card-uniqueness property test. |
| Board cards | Drawn uniformly from the cards not held by any dealt live seat. Folded seats' unknown cards are marginalised (documented limitation). | Code review. |
| Side pots | `EM.potLayers` builds one layer per distinct contribution level. A single contributor's excess is refunded; fully dead layers go to the largest live contributors. Ported to C++ operation for operation. | v31 properties: 3,000 random layer sets conserve chips; every terminal of 25 random multiway trees conserves chips. |
| Chip EV | u = −(chips wagered in the study) − own ante + winnings. Earlier wagers are a constant per seat and do not change strategies. | Code review. |
| ICM | Finishing-set dynamic program over remaining players (≤16); simultaneous busts are ordered by hand-start stacks, exact ties split. Applied to each complete chip outcome, never to averaged stacks. | v29 reference DP; v31 properties: totals equal paid places, monotone in stack, equal stacks equal. |
| Minimum raises | A raise must exceed the price by at least the last full raise; a short all-in does not reopen betting (`raiseIsOpen`). Bet sizes are clamped to [price + full raise, stack], so presets never create illegal sizes. | v29 minimum-raise test; native port bit-identical. |
| CUDA hand scoring | `score7` matches `evalMasks` category by category (straight flush, quads, full house via `two & ~trip`, flush, straight, trips, two pair, pair). Integer only. | Driver test double runs the kernel source and compares every score (v29, v31). |
| Exact equity | 840 share units per board (divisible by 1..8 winners): exact integers, independent of reduction order. | v31: equals an independent JS enumeration. |

## Derivation sketch (external sampling)

Let h be a history at an information set I of updating seat i, σ the current
profile and q the sampling profile of the other seats (q = σ for chance). The
traversal reaches h with probability q₋ᵢ(h)·c(h), where c is chance. The
sampled regret for action a is
r̂(a) = π₋ᵢ(h)/q₋ᵢ(h) · (ṽ(h,a) − Σ_b σ(b) ṽ(h,b)), where ṽ(h,a) carries the
ratios σ/q of the opponent nodes after h. E[ṽ(h,a)] = v(h,a), so
E[r̂(a)·1{reach h}] = c(h)·π₋ᵢ(h)·(v(h,a) − v(h)), the counterfactual regret
contribution of h. The average-strategy increment
πᵢ(h)σ(a)/q₋ᵢ(h)·1{reach h} has expectation c(h)·πᵢ(I)·σ(a). Summed over h ∈ I
this is πᵢ(I)σ(a) times the chance probability of I, which is constant for I.

## Defects found and fixed in 3.1

1. GPU, Hybrid and Automatic scoring packed, uploaded and scored river-start
   batches although the CPU path reads precomputed river scores. River starts now
   use the CPU directly and report why (`score_schedule.hpp`).
2. The automatic native full-tree attempt built and discarded up to 250,000 JS
   states (~290 MiB, ~1.3 s) before falling back. Replaced by a counting pass and
   a measured 20,000-state limit (`lib_river.js`).
3. `mw_equity` initially read the parsed JSON after freeing it (caught in review
   before release, never shipped).
4. A GPU-only equity request that failed returned zeros; it now falls back to the
   CPU answer and states the reason.

No error was found in the CFR, CFR+, linear-averaging, ES, chance-probability,
blocker or terminal-utility mathematics of 3.0. JavaScript and native results
were already identical in 3.0 for full traversal; 3.1 extends the identity to
external sampling.
