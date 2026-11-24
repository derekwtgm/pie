# EightMax 5.9: mathematical validation

Build `@BUILD@`. Successor of 5.8 (build `d4001e2c0cd77f41`).

Classes used throughout (as in 5.8): **1** independently mathematically validated (a proof, an independent
implementation, an exact reference, or the unchanged 5.8 binary agrees); **2** tested on Linux, under Wine or by
simulation; **3** implemented, awaiting physical Windows / GPU validation; **4** unsuccessful, incomplete, not
implemented or not executed.

## 1. What 5.9 changed in the mathematics, and what it did not

| Part | Changed? |
|---|---|
| training (default trainer, every optional trainer, checkpoints, deal and action streams of training) | **no**: the states of the 5.8 binary, byte for byte (section 6) |
| training of a response (`mw_response_begin`, `mw_train`, `mw_response_end`) | **no**: the response 5.8 trained, value for value |
| exact evaluators, the 5.7 one-decision measure, study statistics (`study-5.5-bounded-eb-v1`, ...) | **no** |
| evaluation of a response: the estimator (one walk per deal, own actions enumerated under both strategies) | **no**: the same estimator; a faster walk with the same bits (section 6) |
| evaluation of a response: the random numbers of the default request | **yes**: counter-based streams (section 5); the 5.8 streams on request |
| confidence statements about a response analysis | **yes**: new statements with proofs (sections 2 to 4); the 5.8 numbers are kept |

## 2. The statements and their proofs

**Setting.** A trained profile sigma is fixed. For seat i a response R_i is trained with the other seats frozen at
sigma (5.8, unchanged). Its gain is `g_i = V_i(R_i, sigma_-i) - V_i(sigma)`. The seat's best-response gain is
`b_i = max over strategies of seat i of the same difference`; `b_i >= g_i` (definition of a maximum) and `b_i >= 0`
(the seat may keep sigma_i). `NashConv = sum over all seats of b_i`, inside the study's betting abstraction.

The evaluation draws N deals; deal j gives one number `d_ij = r - s` (the value of the seat under the response minus
its value under sigma on that deal, with the opponents' actions either sampled once and shared, or enumerated).
`E[d_ij] = g_i` (5.8, MATHEMATICAL-VALIDATION-5.8.md, section 2: unchanged). Both values lie in the seat's proven
utility range `[lo, hi]`, so `d_ij` lies in `[-(hi - lo), hi - lo]`, an interval of width `W_i = 2 (hi - lo)`.

**Conditions (C1 to C5), checked or enforced by the program:**

* C1 the N samples of one seat are independent and identically distributed with equal weights (each block of 1,024
  deals has its own streams; no weighting, no stratification);
* C2 every sample lies in the proven range (checked for every sample; a violation withdraws every statement:
  `calibrated: false`, reason `payoffBoundViolated`);
* C3 N is fixed before any value is seen (a time limit makes the evaluation fail; a partial sample is never used);
* C4 R_i is fixed before its evaluation samples are drawn (the response training uses the engine's training streams
  seeded from `seed`; the evaluation uses its own streams; the response does not depend on `evaluationSeed`: tested
  bit for bit, self-test R4);
* C5 the family (seats, confidence, `analyses`) is fixed in the request, before measurement.

Every probability below is over the evaluation deals (and sampled actions), for the responses that were trained.

### 2.1 (A) One seat, one-sided, distribution-free

**Theorem (Maurer & Pontil 2009, Theorem 4).** Let Z_1..Z_n be i.i.d. with values in [0, 1], V_n their unbiased
sample variance, delta in (0, 1). With probability at least 1 - delta:
`E Z - mean(Z) <= sqrt(2 V_n ln(2/delta) / n) + 7 ln(2/delta) / (3 (n - 1))`.

**Application.** Put `Z_j = (hi - lo - d_ij) / W_i`, in [0, 1] by C2. Then `E Z - mean(Z) = (mean(d) - g_i) / W_i` and
`V_n(Z) = V_n(d) / W_i^2`. Hence, with probability at least 1 - delta,

    g_i >= m_i - h(V_i, W_i, N, delta),    h = sqrt(2 V_i ln(2/delta) / N) + 7 W_i ln(2/delta) / (3 (N - 1)).     (A)

The program reports `min(h, W_i)` (the statement `|m_i - g_i| <= W_i` holds always). This is
`seats[i].sampled.lowerBound` (`ebOneSidedHalf` in response_stats59.hpp). The 5.8 field `bounded` is the two-sided
form (the theorem applied to Z and 1 - Z at delta/2 each: `ln(4/delta)`); it is unchanged.

### 2.2 (B) All seats at once (`summary.simultaneous`)

Family F of k seats, level alpha, `analyses` = a. Give every seat `delta = alpha / (a k)`. Let E_i be the event that
(A) fails for seat i: `P(E_i) <= delta`. By Boole's inequality `P(union of E_i) <= k delta = alpha / a`, **whatever the
dependence between the seats' samples**. On the complement, for every i in F, `g_i >= L_i := m_i - h_i`, hence

    sum_{i in F} g_i  >=  sum_{i in F} L_i                                   (`sumOfResponseGainsLowerBound`)
    b_i >= max(0, g_i) >= max(0, L_i)   for every i, so
    NashConv >= sum_{i in F} b_i >= sum_{i in F} max(0, L_i)                 (`nashConvLowerBound`)

The second line uses `b_i >= 0`, which needs no measurement; that is why the floor is applied seat by seat and why a
negative `L_i` (a response that may be worse than sigma) costs the NashConv statement nothing. When F is not every
seat the last inequality still bounds NashConv, since the seats left out have `b_i >= 0`.

**A seat without a completed evaluation.** Let C_i be the event that seat i's evaluation completed. The program then
uses `L_i` if C_i and the trivial bound 0 otherwise. The bound for seat i is wrong only on `C_i and E_i`, a subset of
`E_i`, so the union bound is unchanged - whatever decides completion, including the data. The statement about
`sum g_i` needs every seat and is withheld (`null`) when one is missing.

**Several analyses.** If a analyses of the same trained state are fixed in advance and each is run with
`"analyses": a`, each statement fails with probability at most alpha / a, so all hold together with probability at
least 1 - alpha and the largest of the a bounds is a valid bound at confidence 1 - alpha.

### 2.3 (C) Pooled over independent seats (`summary.pooledIndependent`)

Additional condition **C6: the samples of different seats are independent.**

**Bernstein's inequality** (Boucheron, Lugosi & Massart 2013, Theorem 2.10; for i.i.d. variables Maurer & Pontil's
Theorem 3). Let Y_1..Y_m be independent with `E Y = 0` and `Y <= c` almost surely, `v = sum Var(Y)`. For every t > 0:
`P(sum Y >= sqrt(2 v t) + c t / 3) <= exp(-t)`. (Proof sketch: `ln E exp(l Y) <= Var(Y) phi(l c) / c^2` with
`phi(u) = e^u - u - 1 <= u^2 / (2 (1 - u/3))`; the sum is sub-gamma with variance factor v and scale c/3.)

Take a set B of seats and `Y_ij = (g_i - d_ij) / N_i` for i in B, j = 1..N_i: independent by C1 and C6, mean 0,
`Y_ij <= W_i / N_i`, `sum Var = sum_{i in B} s_i^2 / N_i` with s_i^2 the true variance of seat i's samples. With
probability at least 1 - delta1:

    sum_{i in B} g_i >= sum_{i in B} m_i - sqrt(2 ln(1/delta1) sum_{i in B} s_i^2 / N_i) - max_{i in B}(W_i / N_i) ln(1/delta1) / 3.

**The variances** are not known. Maurer & Pontil 2009, Theorem 10: for independent variables in [0, 1], with
probability at least 1 - delta2, `sqrt(E V_n) <= sqrt(V_n) + sqrt(2 ln(1/delta2) / (n - 1))`; for i.i.d. samples
`E V_n` is the variance. Scaled: `s_i <= sqrt(V_i) + W_i sqrt(2 ln(1/delta2) / (N_i - 1))`, and always
`s_i <= W_i / 2` (Popoviciu); the program uses the smaller.

**The family.** All 2^k - 1 non-empty subsets B of the k seats (one Bernstein event each) and the k variance events:
`delta2 = alpha / (2 a k)`, `delta1 = alpha / (2 a (2^k - 1))`, total at most alpha / a. On the complement every subset
bound holds, so the largest may be reported: for every B, `NashConv >= sum_{i in B} b_i >= sum_{i in B} g_i >= bound(B)`,
and `NashConv >= 0`. With k = 1 the bound agrees with (A) to within its rounding of constants (self-test S5).

**Why not simply the sum over all seats.** A response can lose (g_i < 0). The all-seats bound is then lowered by that
seat, and dropping the seat after seeing the data is selection. Covering every subset in advance makes the selection
legitimate at the price of `ln(2^k - 1)` in the Bernstein term.

**Is C6 justified?** Each seat is evaluated by its own engine copy on streams addressed by its seat number; with the
5.9 streams no number is shared between two seats of one evaluation seed (section 5). Independence of pseudo-random
streams is not a theorem for any generator; it is the same idealisation as C1. The program therefore recommends (B),
which does not need C6, and labels (C) `ASSUMED INDEPENDENT`.

### 2.4 Selection

* The response is chosen by training, before and independently of the evaluation (C4): no selection bias.
* Reporting only some seats of one analysis is covered: both statements hold for all seats (or all subsets) at once.
* Choosing among analyses after seeing them is covered only through `analyses`.
* Reading the larger of (B) and (C): two statements at alpha each; the larger holds with probability at least
  1 - 2 alpha. The program says so (`withSimultaneous`).

### 2.5 Tighter alternatives that were considered

| Alternative | Verdict |
|---|---|
| Hoeffding (no variance): half-width `W sqrt(ln(1/delta) / (2N))` | valid; far wider whenever the standard deviation is small against W (always here: sample standard deviations of 0.05 to 3 BB against W of 100 to 800 BB) |
| pooled Bernstein over independent seats | adopted as (C): 1.2 to 2.3 times less slack on sums of several seats, at the price of C6 |
| betting / hedged-capital confidence bounds (Waudby-Smith & Ramdas 2023) | valid and tighter in the range term (about 1.3 `W ln(1/delta) / N` against 2.33 `W ln(2/delta) / N`); needs the samples in a fixed order with a predictable bet, i.e. either all samples in memory (8 GiB at the largest request) or a streaming merge of the evaluation blocks. **Not implemented in 5.9.** |
| a smaller proven range W | not available: `d` really takes values near both ends in rare deals (an all-in won or lost that the response avoids) |

**What no method can remove.** A two-point distribution that takes a value W lower with probability p is
indistinguishable from the constant distribution in N samples with probability `(1 - p)^N`. A lower bound that is
valid for both at level delta must therefore allow for `p = ln(1/delta) / N`, i.e. contain a term of at least about
`W ln(1/delta) / N`. The bound used here is within a factor `(7/3) ln(2/delta) / ln(1/delta)` (2.6 to 2.9 for the
levels used) of that floor in its range term. This is why a distribution-free bound certifies nothing on games whose
whole NashConv is below `W ln(k/alpha) / N` (section 4.2: the ICM games with NashConv of a few thousandths of a
payout unit at 51,200 deals), and why the remedy is more deals, not a different formula.

## 3. Exact coverage on two-point distributions (class 1)

For samples that are 1 with probability p and 0 otherwise the sample mean and variance are functions of the number K
of ones, `K ~ Binomial(n, p)`, so the probability that a lower bound exceeds the true mean is a finite sum of
binomial probabilities: no simulation and no sampling error. Computed in C++ (`stats59::twoPointMiss`, self-test S2,
S3) and independently in Python (`tools/independent_stats59.py coverage`) on 117 cases: n in {1,024; 20,480;
204,800}, p from 1e-6 (a rare large value) to 1 - 1e-6 (a rare small value), levels 0.05, 0.05/8 and 0.001.

| Bound | Result |
|---|---|
| one-sided empirical Bernstein (A) | never above its level: the largest miss probability is 0.059 times the level (n = 204,800, p = 0.5, level 0.05) |
| 5.8 normal approximation, `mean - 1.645 SE`, nominal 5% | a fair coin: 0.0499. A small value with probability 1e-6 and 204,800 samples: **0.815** (= exp(-0.2048): whenever the small value is not drawn, the sample has no variance and the "bound" is the largest value). Largest over the grid: 0.999. |

The second row is why 5.9 does not present any sum of normal-approximation bounds as a confidence statement.

## 4. Results against exact values on reference games

Plans were written before measurement (`plan.json` beside each `raw.jsonl.gz` and `summary.json` in
`validation/5.9/statistics/`); a timing pilot fixed the sizes (`timing-pilot.json`), no coverage number was looked at
to choose them; nothing was repeated or selected; 0 runs failed.

### 4.1 The limitation 5.8 reported, reproduced; and the new statements on the same runs

`validation/5.9/statistics/final8/`: the design of 5.8's experiment (eight-handed ICM final table, training seed
5851, 5,000 updates, response seeds 1 to 120, 10,000 response deals, 204,800 evaluation deals, sampled opponent
actions, exact gain of the same response), three arms, 360 runs.

| | A: the unchanged 5.8 program | B: 5.9 with `"randomStreams": "5.8"` | C: 5.9, its own streams |
|---|---|---|---|
| seat estimates | 960 | 960 | 960 |
| more than 4 reported standard errors from the exact gain | **193** (5.8 reported 193) | 193 | 206 |
| more than 3 | 205 | 205 | 219 |
| largest distance, in reported standard errors | 775 | 775 | 2,209 |
| exact gain outside the two-sided distribution-free interval (5.8 field `bounded`) | 0 | 0 | 0 |
| seat bound (A) above the exact gain | - | **0** | **0** |
| runs with any seat violation (simultaneous statement) | - | 0 of 120 | 0 of 120 |
| NashConv bound above exact NashConv | - | 0 | 0 |
| pooled bounds above the exact sums | - | 0 | 0 |
| normal one-sided 95% seat bound above the exact gain | 27 (2.8%) | 27 | 27 (2.8%) |
| 5.8 sum of floored normal bounds above the exact sum of positive gains | 0 | 0 | 1 of 120 |
| printed bounds that differ from the independent Python recomputation | - | 0 | 0 |

* **Arm A reproduces the 5.8 figure exactly**: 193 of 960. The normal standard error is not trustworthy on this game.
* **Arm B equals arm A in all 120 runs**, value for value (estimate bits, standard error, exact gain): with the 5.8
  streams 5.9 computes what 5.8 computed.
* **Arm C**: the same failure with other random numbers (206 of 960). The cause is the estimator's distribution (rare
  opponent actions), not a generator.
* **No distribution-free statement was violated** in 240 runs (1,920 seat bounds).
* **What the bounds certify here: nothing.** Median exact NashConv is 0.00044 payout units; with W of about 100 units
  and 204,800 deals the range term alone is 0.008 per seat. Both distribution-free NashConv bounds are 0 in the
  median run; the 5.8 normal sum "certified" 17% of exact NashConv without a guarantee. This is the honest answer to
  "are rare-action ICM estimates handled more reliably": they are never overstated any more; certifying gains this
  small needs of the order of 10^8 deals per seat.

### 4.2 Coverage on every reference game

`validation/5.9/statistics/games/`: the 15 reference games of `tools/games58.js` (the 14 of the 5.8 experiments are
among them; rare actions, large pots, eight-handed ICM, side pots, unequal stacks, weighted ranges, multi-street
continuations, near-zero gains), two training seeds, 5,000 updates, one response per seat (200,000 response deals),
exact gains and exact NashConv, and 100 independent evaluations of that fixed response (51,200 deals, sampled
opponent actions): 3,000 runs, 14,000 seat statements.

| Count over 3,000 runs / 14,000 seat estimates | |
|---|---|
| seat bound (A) above the exact gain | **0 of 14,000** (allowed: alpha / seats each) |
| runs with any seat violation (B) | **0 of 3,000** (allowed with probability 0.05 each) |
| NashConv bound of (B) above exact NashConv | **0 of 3,000** |
| pooled (C): all-seats bound above the exact sum; best-subset bound above its exact sum; NashConv bound above exact | **0, 0, 0** |
| printed numbers that differ from the independent Python recomputation | **0** |
| normal one-sided 95% seat bound above the exact gain | 663 of 14,000 (4.7%; per game 2.2% to 6.8%) |
| estimates more than 4 reported standard errors from the exact gain | 549 (final8: 483 of 1,600; bubble5-icm: 64 of 1,000) |
| 5.8 sum of floored normal bounds above the exact sum of positive gains / above exact NashConv | 11 / 3 of 3,000 |

Median share of exact NashConv that each number reaches (51,200 evaluation deals):

| Game | exact NashConv | exact sum of response gains | (B) simultaneous | (C) pooled | 5.8 normal sum (no guarantee) |
|---|---|---|---|---|---|
| hu-river | 0.82 | 0.99 | 0.78 | 0.84 | 0.90 |
| hu-turn | 0.77 | 0.98 | 0.82 | 0.86 | 0.91 |
| river3-chip | 0.34 | 0.98 | 0.55 | 0.68 | 0.82 |
| turn4 | 1.67 | 0.98 | 0.80 | 0.87 | 0.93 |
| flop5 | 1.03 | 0.99 | 0.57 | 0.74 | 0.85 |
| flop6 | 0.86 | 0.98 | 0.35 | 0.60 | 0.79 |
| flop6w | 2.32 | 0.97 | 0.65 | 0.81 | 0.88 |
| early3-flop | 28.4 | 0.41 | 0.37 | 0.38 | 0.39 |
| mid3-turn | 5.19 | 0.94 | 0.85 | 0.89 | 0.90 |
| sidepot3-icm | 0.64 | 0.98 | 0.80 | 0.87 | 0.94 |
| short8-push | 0.067 | 0.91 | 0.00 | 0.00 | 0.45 |
| final8w | 0.021 | 0.95 | 0.04 | 0.00 | 0.91 |
| bubble4 | 0.0054 | 0.97 | 0.00 | 0.00 | 0.73 |
| bubble5-icm | 0.0069 | 1.00 | 0.00 | 0.00 | 0.83 |
| final8 | 0.0017 | 0.98 | 0.00 | 0.00 | 0.95 |
| **all runs** | | 0.98 | **0.49** | **0.67** | 0.88 |

**Reading.**

* The proofs say the distribution-free bounds miss at most at their level; **0 violations in 3,000 runs agrees with
  the proofs and does not extend them** (it would also be observed for a bound that is merely very conservative on
  these games, which this one is). A violation rate clearly above the level would have falsified an assumption (the
  proven range, the independence of the samples); that is the outcome the experiment could have produced.
* The price of the guarantee is visible: (B) certifies a median 49% of exact NashConv and (C) 67%, where the response
  itself reaches 98% and the 5.8 normal sum 88%. On the five games whose NashConv is a few hundredths of a unit or
  less, 51,200 deals certify nothing. More deals is the remedy (STATISTICAL-CHANGES-5.9.md, section 6).
* The 5.8 normal sum was above the truth in 11 runs (above exact NashConv itself in 3). That is rare on these games -
  the floor at 0 and the sum make it conservative on average - but it is not bounded by anything: per-seat miss rates
  reach 6.8% against a nominal 5%, and section 3 shows a distribution on which the same formula fails with
  probability 0.8.
* early3-flop: the response finds 41% of exact NashConv (three streets, 200,000 response deals). The statistics are
  about the response that was trained; a better response needs a longer response training. This is the gap between
  "lower bound" and "NashConv" that no evaluation statistics close.

### 4.3 The same statements inside the shipped program and its tests

* `mwcli --selftest59` (32 checks; passed on Linux and, as `mwcli.exe`, under Wine: VALIDATION-5.9.md): R1 on four
  shipped fixtures compares every seat bound, the simultaneous bounds and the pooled bounds with the exact values of
  the same responses; S1, S4, S5 compare the functions with numbers computed by the independent Python
  implementation; S2, S3 are section 3; S6 checks order properties on 2,000 random families.
* `tests/v59.test.js`: 39 further independent evaluations on three games (no bound above the exact value); every
  bound of three results recomputed by the Python implementation.
* `validation/5.9/windows/response/golden59.json`: seven reference responses whose bounds must be reproduced bit for
  bit on Windows, each with `againstExact` true.

## 5. Evaluation random streams

### 5.1 What 5.8 left open

5.8 gave each block of 1,024 deals two SplitMix64 streams started at hashed 64-bit states. All streams lie on one
cycle of 2^64 states; B blocks drawing at most L numbers each overlap somewhere with probability about
`4 B^2 L / 2^64`: negligible for a default request, of order 0.1 for the largest request the engine accepts (10^9
deals). Nothing could be said about a particular run.

### 5.2 The 5.9 streams

**Generator.** Philox4x64-10 (Salmon, Moraes, Dror & Shaw, SC 2011), the counter-based generator of Random123, of
`numpy.random.Philox` and of C++26 `std::philox4x64`. One call maps a 256-bit counter and a 128-bit key to 256 bits.

**Addressing.** `key = (evaluation seed, 0x45694d6178353959)`; `counter = (j, block, seat, purpose)`, j = 0, 1, 2,
... counting groups of four 64-bit numbers of one stream; purpose 0 = cards, 1 = opponents' actions. A double is
`(bits >> 11) / 2^53`, as in 5.8.

**Theorem (partition).** For a fixed key, Philox4x64-10 is a bijection of the 256-bit counters. Hence, within one
evaluation seed, two different addresses (seat, block, purpose, j) never receive the same 256 output bits.

*Proof.* One round maps `(c0, c1, c2, c3)` to `(hi(M1 c2) xor c1 xor k0, lo(M1 c2), hi(M0 c0) xor c3 xor k1,
lo(M0 c0))` with odd multipliers M0, M1. It is invertible: `c2 = lo-word-1 * M1^-1 mod 2^64` and
`c0 = lo-word-3 * M0^-1 mod 2^64` (odd numbers are invertible modulo 2^64); the high halves follow from c0 and c2, and
then `c1` and `c3` from the remaining two words by xor. Ten invertible rounds (the key schedule adds constants to the
key, independent of the counter) compose to a bijection. Different addresses are different counters. QED.
The self-test executes this inverse on 20,000 random (counter, key) pairs and recovers every counter (E2).

**Consequences.** No stream can overlap another, for any number of blocks and any stream length: there is no cycle
to overlap on, and no probability to quote. A stream is a pure function of its address: it does not depend on the
thread, on other blocks, or on how many numbers another stream consumed (self-test E3; thread independence R3). A
stream cannot run out (2^64 groups per address).

**What is not a theorem.** That the numbers behave as independent uniform variables: this is the generator's
empirical property (it passes TestU01 BigCrush in its authors' tests) and the assumption under which every sampling
statement is made. Two different seeds use two different keys - two members of a family of bijections with no
theorem relating them.

### 5.3 Validation of the implementation (class 1)

| Check | Result |
|---|---|
| three known-answer vectors of the reference implementation (Random123 `kat_vectors`, "philox4x64 10": zeros, ones, digits of pi) | reproduced by the engine (self-test E1) and by a Python implementation with arbitrary-precision integers |
| `numpy.random.Philox` (an independent implementation; numpy 2.5.3) | 53 of 53 blocks equal the Python implementation (the three vectors and 50 engine addresses) |
| the engine's streams as the engine draws them (`mwcli --streams59`) against the Python implementation | 185 numbers of 5 addresses, bits and doubles: 0 differences (Linux build and `mwcli.exe` under Wine) |
| inversion round by round | 20,000 of 20,000 counters recovered (E2) |
| 320,000 streams (8 seats, 20,000 blocks, 2 purposes) | 320,000 distinct first pairs; 10^6 doubles in [0, 1), mean 0.49985, variance 0.083344 (E3) |
| estimates against exact values | sections 4.1 (arm C) and 4.2: every exact value inside the distribution-free intervals |
| bits independent of threads, parallel seats and the evaluation walk | self-test R3, R6; tests |

### 5.4 Compatibility and versioning

`seats[i].sampled.randomStreams` names the method (`philox4x64-10-counter-v1` or
`splitmix64-hashed-block-seeds-5.8`), the address and what is proven; `calculation` is `response-5.9-paired-v2` or
`response-5.8-paired-v1`. `"randomStreams": "5.8"` reproduces 5.8 bit for bit: 960 of 960 estimates in section 4.1,
seven reference responses of 5.8 (`validation/5.8/windows/response/golden58.json`), and two fixtures inside the
self-test (R5). Result files of 5.8 are not touched.

### 5.5 What was not changed: the training generator (class 4 for this item)

The trainer's deal and action streams are still the 32-bit generator with 2^32 states on one cycle. 5.8 documented
that the default trainer stays inside one cycle up to the engine's update limit and that frozen batches of 64 deals
can exceed a cycle near that limit. Replacing it would change every trained state and the checkpoint header; 5.9 did
not do that. The limitation stands as 5.8 stated it.

## 6. The evaluation walk and training are numerically unchanged (class 1)

**Evaluation walk.** `pairValue59` visits the nodes `pairValue` visits, in the same order, draws the same random
numbers and performs the same floating-point operations in the same order; it differs in how a table row is found
(the strategy key once per deal and street; one lookup for both profiles of the responding seat; an offset index
that is a copy of numbers the table holds; prefetch hints). Evidence that the bits are the same:

* against the unchanged 5.8 program: 960 estimates (section 4.1), seven fixtures and games in the performance runs
  (estimate bits, standard error and visit count: PERFORMANCE-5.9.md), the seven 5.8 reference responses;
* inside the program: `EIGHTMAX_RESPONSE_WALK=5.8` against the 5.9 walk without index, with index, with look-ahead
  and default, opponents enumerated and sampled, on four fixtures (self-test R6: 32 runs, 0 differences) and on
  three more games including ICM and frozen batches (tests).

**Training.** The 5.9 trainer source differs from 5.8 in nothing that executes. Evidence: 56 of 56 states
byte-identical to the unchanged 5.8 program (seven games, two seeds, two budgets, one and three threads:
`validation/5.9/convergence/identity/`); the eight golden states of the 5.7.1 binary and the eleven golden states of
the 5.5 binary in the regression suite; identical states in every training benchmark.

## 7. Independent implementations used

| What | Independent of the engine | Where |
|---|---|---|
| Philox4x64-10 | Python integers; numpy | `tools/independent_stats59.py selfcheck` |
| bounds (A), (B), (C) | Python floats, written from section 2 (subsets by `itertools.combinations`) | `independent_stats59.py check`; 3,240 results recomputed in sections 4.1 and 4.2 with 0 differences |
| exact two-point coverage | Python, `math.lgamma` | `independent_stats59.py coverage` |
| exact gains and exact NashConv | the engine's exact evaluator (validated since 4.8 against independent best-response implementations; unchanged) | every `exact` value above |
| the response training and estimator | `tools/independent_response58.py` (5.8; still passing against 5.9) | `tests/v58.test.js` |
| the 5.8 program | the unchanged binary | sections 4.1, 6 |

## 8. Summary by class

| Claim | Class | Evidence |
|---|---|---|
| (A) per-seat one-sided bound holds with probability >= 1 - delta | **1** proof (2.1); **1** exact two-point coverage (3); **2** 0 of 15,920 seat bounds above exact (4.1, 4.2) |
| (B) simultaneous statement at the stated confidence, no independence between seats | **1** proof (2.2); **2** 0 of 3,240 runs violated |
| (C) pooled statement, given independent seats | **1** proof (2.3) under C6; C6 itself is an assumption; **2** 0 violations |
| the summary's numbers are these formulas | **1** independent Python recomputation, 0 differences |
| the 5.8 normal sum is not a confidence statement | **1** exact counter-example (3); **2** observed above truth in 12 of 3,240 runs |
| the 5.9 streams never reuse a number within a seed | **1** proof (5.2), inversion executed |
| the generator is implemented correctly | **1** known answers, numpy, Python |
| the numbers are statistically independent | assumption (the generator's published tests); not proven for any generator |
| 5.9 with the 5.8 streams computes what 5.8 computed | **1** 960 of 960 and every reference |
| the faster walk computes the same bits | **1** against the 5.8 walk and the 5.8 program |
| training is unchanged | **1** 56 of 56 states, golden states |
| any of the above on Windows hardware | **3** not executed on Windows (Wine: class 2) |
| tighter betting-based bounds | **4** not implemented |
| a larger-period training generator | **4** not changed |

## 9. Limits

* Every statement is a LOWER bound of NashConv inside the study's betting abstraction. There is no upper bound in
  5.9, hence no statement that a strategy is close to equilibrium, and no percentage of optimality.
* The statements are conditional on the trained responses. A response that finds 41% of exact NashConv (early3-flop)
  yields a valid bound of at most 41%.
* Distribution-free bounds are expensive: half of exact NashConv at 51,200 deals on the reference games, nothing on
  games with tiny NashConv. Use more evaluation deals.
* Coverage was checked on games small enough for exact values. On large games the proofs are the evidence; the
  conditions C1 to C4 are properties of the program, not of the game.
* 0 violations in a finite experiment is not a proof of coverage and is not presented as one.
