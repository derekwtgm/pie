# EightMax 5.8 — mathematical validation

Build `d4001e2c0cd77f41`. Successor of 5.7.1 (build `65e835e6b7060960`).

This document states what each quality measure of EightMax is, in which direction it bounds what, under which
assumptions, in which units and for which scope; proves the new measure of 5.8 (the *trained response*); and reports
the checks against exact values, against an independent implementation and against the unchanged 5.7.1 binary.

Three words are used with one meaning throughout:

- **exact** — computed by enumerating every deal, every board card and every action of the study's betting
  abstraction. No sampling error. Exact for the *abstract* game (the study's ranges, bet sizes and hand groups), not
  for full no-limit hold'em.
- **lower bound** — a number proven not to exceed the quantity it bounds. A small lower bound proves nothing.
- **estimate** — a number computed from sampled deals; it has a standard error and an interval.

Nothing here is an upper bound of NashConv for a game too large to enumerate. No such bound exists in this release,
and therefore no statement of the form "this strategy is X% of the way to equilibrium" is made for those games.

## 0. The quality measures of EightMax 5.8, audited

| Measure (how to get it) | What it is | Direction | Assumptions | Units | Scope | Kind |
|---|---|---|---|---|---|---|
| exact best-response gain per seat (`method: exact`) | `g_i = max_R V_i(R, sigma_-i) - V_i(sigma)` | equality | the abstract game is small enough to enumerate (visit limit; otherwise refused, never truncated) | BB per hand (chip EV) or prize units (ICM) | the study's root, ranges and betting abstraction | **exact** |
| exact NashConv | `sum_i g_i` | equality | as above | as above | as above | **exact** |
| exploitability | `NashConv / 2` | equality | **two seats and chip EV only** (constant-sum). Not reported for three or more seats or with ICM | BB per hand | as above | **exact**, two-player chip EV only |
| restricted best response (5.7, `method: restricted`) | gain of the best deviation confined to the seat's decisions on the first street of the study | **lower bound** of `g_i`; sum is a lower bound of NashConv | exact evaluation of the restricted problem; equals `g_i` when the game has one betting street | as above | as above | **restricted** (exact value of a smaller response class) |
| sampled one-decision deviation (5.7, `method: sampled`) | gain of changing the action at one decision, chosen on one sample and measured on an independent one | **lower bound** of `g_i` in expectation | independent selection and evaluation samples; normal-approximation interval | as above | as above | **restricted and statistical** |
| trained response (5.8, `mwcli --response`) | `gain_i(R) = V_i(R, sigma_-i) - V_i(sigma)` for a response `R` trained against the frozen other seats | **lower bound** of `g_i`; sum is a lower bound of NashConv. **Never an upper bound** | none for the direction (section 1); for the reported number: an exact evaluation, or the estimate of section 2 with its interval | as above | as above; with hand groups `R` is constant on a group | **restricted** (one response, not the best one); **statistical** when estimated |
| study statistics (5.3 to 5.6: action frequencies, EV per decision, replication intervals) | a property of the trained strategies across seeds | none: they describe variation between trainings | i.i.d. seeds; intervals as documented in STATISTICAL-VALIDATION-5.5.md and 5.6 | probability, BB | the study | **statistical**; **not a measure of distance from equilibrium** |

What none of them is: an upper bound of NashConv on a game that cannot be enumerated; a statement about the
unabstracted game; a statement about play after the modelled streets; a "GTO percentage".

In a game with three or more seats, or with ICM utilities, NashConv = 0 characterises a Nash equilibrium, but a
small NashConv does not bound what a seat loses against opponents who deviate together, and equilibria are not
interchangeable. For that reason NashConv is reported as NashConv and is called exploitability nowhere except for
two-player chip-EV games.

## 1. The trained response: definition, direction, and what it does not show

Notation: `n` seats; `sigma` the evaluated strategy profile (the trained average strategies, with uniform play where no
strategy is stored); `V_i(.)` the expected utility of seat `i` from the study root (BB of chips, or prize equity
with ICM) inside the study's betting abstraction, with exact private cards and exact boards.

**Best-response gain and NashConv.** `g_i = max_R V_i(R, sigma_-i) - V_i(sigma)` over all strategies `R` of seat `i`;
`NashConv = sum_i g_i`. `g_i >= 0` (the seat may keep `sigma_i`). `sigma` is a Nash equilibrium of the abstract game
exactly when `NashConv = 0`. With two seats and chip EV the game is constant-sum and `NashConv / 2` is exploitability;
with more seats, or with ICM, it is not, and nothing in this release calls it that.

**The measure.** For a response strategy `R` of seat `i`, `gain_i(R) = V_i(R, sigma_-i) - V_i(sigma)`. For every `R`,

    gain_i(R)  <=  g_i                                   (definition of the maximum)
    sum_i gain_i(R_i)  <=  NashConv

So the sum is a **lower bound of NashConv**. The inequality needs nothing about how `R` was produced. It is not an
upper bound: `gain_i(R)` small says that this `R` found little.

**How R is produced.** With `sigma_-i` fixed, seat `i` faces a one-player decision problem with perfect recall. The
engine's external-sampling trainer is run with only seat `i` learning; the other seats' table rows are overwritten so
that regret matching plays their average strategy (below), and are never written again. Regret minimisation in a
one-player problem converges to its optimum: for the seat's average strategy `R_T` after `T` updates,
`g_i - gain_i(R_T) <= (average regret of seat i)`, which tends to 0 (Zinkevich et al. 2007, Theorem 3 and 4 applied
to one player; Lanctot et al. 2009 for the sampled estimator, in expectation and with high probability). The engine
does not rely on that rate: how good `R` is, is measured.

**Freezing by rewriting, and why it is exact.** The trainer reads a seat's strategy by regret matching:
`p(a) = max(0, r(a)) / sum_b max(0, r(b))`, uniform when the sum is 0. `mw_response_begin` sets, for every row of
every other seat, `r(a) := avg(a)` (the stored average-strategy weights, which are non-negative) when their sum is
positive and `r(a) := 0` otherwise. Regret matching on these numbers performs the same additions and divisions, in
the same order, as the evaluators' `averageOf` (`avg(a) / sum_b avg(b)`, summed in index order), and gives uniform
play exactly where the evaluators' default fallback does. The trainer therefore samples the other seats from
`sigma_-i`, and because external sampling writes only the learning seat's rows (and `Game::onlySeat` restricts the
learning seat to `i`), those rows keep their bytes. After training, `mw_response_end` writes seat `i`'s own trained
average into its regret slots, so one state holds two profiles:

    policy "average"  =  (R_i, sigma_-i)            policy "current"  =  sigma

Checked exactly (not to a tolerance) on every reference game: the exact evaluator gives, for policy "current" of the
response state, the same `V_j` and the same best-response value for every seat `j` as for policy "average" of the
original state (difference 0 in every case of section 3.2), and an independent Python reader of the state files finds
every stored probability of every other seat unchanged to 1e-12 (section 4).

**Information sets the response never reached** keep `sigma_i` (their average slot is restored), so `R` differs from
`sigma_i` only where the response training produced something.

**Hand groups.** With grouped hands the response is constant on each group, like `sigma`. It is still a strategy of
the ungrouped game, so the direction of the bound is unchanged; the response class is smaller, so the bound can be
looser than an ungrouped response would give.

**Fallback.** Both profiles play uniformly where no strategy is stored. The evaluators' other fallbacks ("fold or
check", "call or check") would make "current" differ from `sigma` at stored rows with an all-zero average; the measure
is defined for the uniform fallback only and `mw_response_value` uses it.

## 2. Measuring gain(R) without an exact evaluation

**Estimator.** One deal `D` is drawn from the study's own deal distribution (every seat's hand from its range weights,
the whole tuple rejected on a shared card, then the remaining board cards without replacement: the distribution of
the trainer and of the 5.7 evaluators). One walk of the betting tree computes two numbers:

    r(D, w) = value of seat i under (R_i, sigma_-i)        s(D, w) = value of seat i under sigma

At a decision of seat `i` every action is walked once and the child's pair is combined with `R_i` for `r` and with
`sigma_i` for `s`. At a decision of another seat one action is sampled from `sigma` (randomness `w`) and serves both;
when the betting tree has at most 4,096 states those actions are enumerated instead and only the cards are random.
`E[r] = V_i(R, sigma_-i)` and `E[s] = V_i(sigma)` (the tower property over the opponents' sampled actions), so
`d = r - s` is an **unbiased sample of gain_i(R)**.

**No selection bias.** The deals and actions of the evaluation come from their own generator and seed (below) and
play no part in training `R`. `R` is a fixed strategy by the time the first evaluation deal is drawn, so the sample
mean is an unbiased estimate of `gain_i(R)` for that `R`. (The 5.7 one-decision measure obtains the same property by
separate selection and evaluation streams.)

**Bounded samples, and the interval that needs no distributional assumption.** `r` and `s` are convex combinations
of terminal utilities of seat `i`, which lie in `[lo, hi]` (`utilityBounds`: the seat cannot lose more than its stack
and ante, nor win more than the other seats can put in; ICM: between 0 and the first prize). Hence
`d` lies in `[-(hi - lo), hi - lo]`, a range of width `2 (hi - lo)`. The samples are i.i.d., equally weighted, and
their number is fixed before any value is seen (a time limit that would cut the sample makes the call fail instead
of reporting a shorter one). These are the conditions of the empirical-Bernstein bound of Maurer and Pontil (2009,
Theorem 4) as used since 5.5 (`study_stats55.hpp`): with probability at least 0.95,
`|mean - gain_i(R)| <= sqrt(2 V ln(4/0.05) / N) + 7 * 2 (hi - lo) * ln(4/0.05) / (3 (N - 1))`. The result reports this
half-width (`bounded.half`), the normal-approximation interval (`gain.ci95`, labelled as such), whether every sample
respected the proven bound (`bounded.withinBounds`; a violation withdraws the interval), and two lower bounds of the
seat's best-response gain: `mean - 1.645 SE` (one-sided, normal approximation) and `mean - half` (distribution-free),
each replaced by 0 when negative, because `g_i >= 0` holds without any measurement.

**Why two intervals.** The normal interval is narrow and is the one to read when the sample is large and the
strategies have no rare, large events. It fails where they do: on the eight-player final table a strategy trained
for 5,000 deals takes some actions with probability near 1e-5; 204,800 sampled walks that never drew such an action
gave a standard error of 1.6e-9 for an estimate that was 1.9e-6 from the exact value (the pilot run before the plan of section 3 was written). This
is the rare-tail failure described in STATISTICAL-VALIDATION-5.5.md, not a defect of the walk. Two things address it:
opponents' actions are enumerated whenever the tree is small (which removed the discrepancy on that game: all eight
seats within 1.1 standard errors), and the distribution-free interval is reported beside the normal one.

**Sum over seats.** Each seat has its own evaluation streams, so the seats' estimates are independent and the
standard error of their sum is the root of the sum of squares. `sumOfSeatLowerBounds95` adds the per-seat one-sided
bounds, each floored at 0; it is conservative and is not itself a 95% statement about the sum.

**Random numbers.** The evaluation uses SplitMix64 (64-bit state; outputs checked against the published values for
seeds 0 and 1234567, recomputed in Python). Each block of 1,024 deals has its own deal stream and action stream,
seeded from (seed, seat, block, purpose). The engine's training generator has 2^32 states on one cycle, so thousands
of block streams cut from it would overlap. SplitMix64 has 2^64 states on one cycle: `B` blocks (two streams each)
that draw at most `L` numbers per stream overlap somewhere with probability about `4 B^2 L / 2^64`. That is below
1e-8 for the default request (196 blocks) and below 1e-4 up to sixteen million deals. For the largest request the
engine accepts (a billion deals, about a million blocks) the same bound is of order 0.1: an overlap between two of
the million blocks cannot be excluded there, and would make those two blocks dependent. Blocks are evaluated on any
number of threads and added in block order, so the reported bits do not depend on the thread count (tested).

## 3. Results against exact values

All figures below come from `validation/5.8/convergence/response/` (plan written before measurement: `plan.json`; one
line per state: `raw.jsonl`; `summary.json`). 14 reference games, two training budgets (5,000 and 50,000 deals),
five training seeds per game (three for the three-street game and two for the eight-handed push-or-fold game, whose
exact evaluation is slow; fixed in the plan): 130 trained states, 560 seat gains per measure. The run was stopped by
the two-hour limit of one background job after 109 states and continued by `--resume` with the same plan, binary and
output files (`resumed.json`); no state was measured twice and none was dropped.

### 3.1 Training is the 5.7.1 training

5.8 did not change a trainer. With the same specification, seed and thread count, the 5.8 binary must write the
5.7.1 binary's state file. `validation/5.8/identity/`: 225 cases, 1,782 training runs (the ten reference games of 4.8
and five shipped fixtures; the default trainer and frozen batches in several configurations; 1 to 16 threads
offered; trained in one piece and saved and continued): **0 differences** (`summary.json`: `failures: 0`). The games
added in 5.8 are compared with the 5.7.1 binary in `tests/v58.test.js` and in the convergence experiment
(CONVERGENCE-5.8.md, section 4). The eight-handed ICM games are among them, so the changed ICM cache (section 7)
returns the numbers the old one returned.

### 3.2 Direction and tightness

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

Reading the first table: each cell is (sum over seats of the measure) / (exact NashConv) for one trained state;
median and range over the seeds. 1.00 means the measure found all of NashConv. The "Trained" columns are the exact
value of the trained responses (not an estimate), so they show how good the responses are, separately from how well
their value is estimated (3.3).

**Direction.** For each of the four measures, none of the 560 seat gains exceeded the exact best-response gain (the
5.7 sampled measure: none exceeded it by more than four standard errors). The exact NashConv recomputed from the
response states (policy "current") differed from the exact NashConv of the original states by at most 7.6e-15.

**Tightness.** With 2,000,000 response deals per seat the trained responses found at least 70% of exact NashConv in
every one of the 130 states, at least 90% in 122 of them, and a median of 100%. The 5.7 one-decision measure found
a median of 41% (less than half in 81 states; negative in some, as an estimate can be). The 5.7 restricted measure
equals the exact value on the ten games with a single betting street, where the first street is the whole game
(largest relative shortfall 2.1e-5), and found 4% to 57% on the four games with more than one street.

**Where the trained response is weakest.** (a) On the three-street game (`early3-flop`, exact NashConv 20 to 27 BB
after these short trainings) it found 75% to 76% with 2,000,000 response deals and 31% to 39% with 200,000: the
response has thousands of information sets on three streets and is itself not converged. (b) On the eight-handed
push-or-fold game after 50,000 deals, 200,000 response deals found a median of 51% (19% to 82%); 2,000,000 found 96%.
(c) One five-player flop state: 70%. **The measure depends on its response budget**, the budget is part of the
result, and a small trained-response gain from a small response budget is not evidence of a small NashConv.

**The plan's promotion rule, applied as written.** The plan required (a) no direction violation and (b) a median
share at the larger response budget at least equal to that of both 5.7 measures in every game. (a) holds. (b) holds
against the one-decision measure in all 28 cells, and against the restricted measure in the 8 cells of the four
multi-street games (smallest trained share 0.75; largest restricted share 0.57). It does **not** hold against the
restricted measure in the 20 cells of the ten single-street games: there the restricted measure *is* the exact best
response (share 1.00) and the trained response found 0.96 to 1.00 of it. The rule is therefore not met as written,
and the recommendation is the narrower one the data support:

- a game small enough for the exact evaluator: use it (it is the only one that gives NashConv itself);
- a study with one betting street that the restricted evaluator can enumerate: the restricted measure is exact there;
- every other case (several streets, or too large to enumerate): the trained response is the tightest lower bound
  this release has, by a wide margin on every multi-street reference game.

### 3.3 The estimate from independent deals

For every seat of every state the response gain was also estimated from 204,800 independent deals and compared with
its exact value (1,120 seat estimates, both response budgets):

| Check | Result |
|---|---|
| exact gain outside the distribution-free 95% interval | 0 of 1,120 |
| exact gain more than 3 standard errors from the estimate | 15 of 1,120 (1.3%; the normal approximation predicts 0.3%) |
| more than 4 standard errors | 0 (largest 3.85) |
| one-sided normal-approximation lower bound (`mean - 1.645 SE`) above the exact **best-response** gain | 10 of 1,120 (0.9%) |
| distribution-free lower bound above the exact best-response gain | 0 of 1,120 |
| distribution-free lower bound greater than 0 (the estimate proves a positive gain) | 361 of 560 at 2,000,000 response deals |
| normal-approximation lower bound greater than 0 | 556 of 560 |

Two honest readings. First, the normal-approximation interval is slightly too narrow in the tail on these games
(15 beyond 3 standard errors where about 3 are expected): heavy-tailed pots. It is labelled a normal approximation
in the output, and the distribution-free interval beside it had no failure. Second, the distribution-free interval
is wide: with 204,800 deals it could not separate 199 of 560 true gains from zero. Its width falls as
`1 / sqrt(samples)`; a sharper statement needs more evaluation deals, not a different formula.

In all 1,120 estimates the other seats' actions were enumerated (every reference game has at most 4,096 betting
states). The large fixtures cannot be enumerated and use the walk with **sampled** opponent actions; sections 3.4
and 3.5 test that walk.

### 3.4 The estimate with sampled opponent actions

Plan (`validation/5.8/convergence/sampled-actions/plan.json`, written before measurement): eleven reference games,
two training seeds (5851, 5852), 5,000 updates, 200,000 response deals, 204,800 evaluation deals with
`futureActions: "sample"` forced, against the exact gain of the same response.

Estimate with sampled opponent actions against the exact gain of the same response (plan: `plan.json`; 22 states, 98 seat estimates, all with sampled actions):

| Game | Seat estimates | Exact gain outside the distribution-free interval | Beyond 3 reported standard errors | Beyond 4 | Largest distance (reported standard errors) | Estimates below / above exact |
|---|---|---|---|---|---|---|
| hu-turn | 4 | 0 | 0 | 0 | 1.7 | 2 / 2 |
| river3-chip | 6 | 0 | 0 | 0 | 1.4 | 5 / 1 |
| turn4 | 8 | 0 | 0 | 0 | 1.1 | 4 / 4 |
| flop5 | 10 | 0 | 0 | 0 | 2.0 | 4 / 6 |
| flop6 | 12 | 0 | 0 | 0 | 1.8 | 6 / 6 |
| flop6w | 12 | 0 | 0 | 0 | 1.7 | 6 / 6 |
| mid3-turn | 6 | 0 | 0 | 0 | 1.2 | 4 / 2 |
| final8 | 16 | 0 | 8 | 8 | 1183.1 | 10 / 6 |
| bubble4 | 8 | 0 | 0 | 0 | 1.5 | 3 / 5 |
| bubble5-icm | 10 | 0 | 1 | 1 | 12.6 | 5 / 5 |
| sidepot3-icm | 6 | 0 | 0 | 0 | 1.2 | 4 / 2 |
| **all** | 98 | 0 | 9 | 9 | 1183.1 | |

**The distribution-free interval held in all 98 estimates. The normal-approximation interval failed badly on the
eight-handed ICM final table**: eight of sixteen estimates were between 61 and 1,183 reported standard errors from
the exact value (and one of ten on the five-player ICM bubble, 12.6). This is the rare-action effect of section 2,
now measured: a strategy trained for 5,000 updates takes some actions with probability near 1e-5; a sample that
never draws them has almost no variance, reports a tiny standard error, and misses their contribution. On the nine
other games every estimate was within 2.0 standard errors.

### 3.5 Is that estimator unbiased? (a test that could have failed)

If the cause is rare actions, single estimates are mostly too low but the *mean* error over many independent
evaluations is zero; a defect of the walk would give a non-zero mean. Plan
(`validation/5.8/convergence/unbiased/plan.json`, written before measurement): the same game and trained state
(seed 5851), 120 response seeds, each with its own response (10,000 response deals), 204,800 evaluation deals with
sampled actions, and the exact gain of that response; per seat the mean of (estimate - exact) across the 120 runs and
its standard error; bias indicated if |t| > 3.5 for any seat.

| Seat | Runs | Mean of (estimate - exact) | Standard error across runs | t | Estimates below / above exact | Median difference | Single estimates beyond 4 reported standard errors |
|---|---|---|---|---|---|---|---|
| 0 | 120 | -1.05e-07 | 8.00e-08 | -1.31 | 63 / 57 | -2.42e-09 | 0 |
| 1 | 120 | 4.92e-07 | 8.67e-07 | 0.57 | 60 / 60 | 5.77e-08 | 0 |
| 2 | 120 | -7.87e-07 | 9.34e-07 | -0.84 | 67 / 53 | -1.89e-07 | 0 |
| 3 | 120 | 3.31e-06 | 4.58e-06 | 0.72 | 59 / 61 | 1.27e-06 | 0 |
| 4 | 120 | 1.49e-07 | 1.09e-06 | 0.14 | 71 / 49 | -5.61e-06 | 49 |
| 5 | 120 | -3.54e-07 | 5.23e-07 | -0.68 | 96 / 24 | -5.06e-07 | 28 |
| 6 | 120 | 1.76e-06 | 1.40e-06 | 1.26 | 76 / 44 | -6.27e-06 | 68 |
| 7 | 120 | 9.26e-07 | 1.40e-06 | 0.66 | 63 / 57 | -7.92e-06 | 48 |

120 runs, 0 failed; 960 seat estimates, all with sampled opponent actions: yes; exact gain inside the distribution-free interval: 960 of 960; largest |t|: 1.31; bias indicated by the plan's rule: no.

**No bias is indicated** (largest |t| 1.31 over eight seats), while 193 of the 960 single estimates were more than
four *reported* standard errors from the exact value and all 960 exact values lay inside the distribution-free
interval. The estimator is unbiased; its reported standard error is not trustworthy when the frozen strategies
contain rare actions with large consequences.

**Consequence for reading a result.** With enumerated opponent actions (`opponentActions: "enumerated"` in the
output) the normal interval behaved nearly as stated. With sampled actions (`"sampled"`, every large study) use the
distribution-free bound (`bestResponseGainLowerBound.bounded95`) for any claim; the normal interval is a
description of the sample, not a guarantee. The realistic-fixture table of CONVERGENCE-5.8.md, section 3, prints the
distribution-free bounds for this reason.

## 4. An independent implementation

`source/tools/independent_response58.py` shares no code with the engine: its own reader of the state file (both table
slots), its own betting rules, side-pot settlement and seven-card evaluator (those of `independent_br48.py`, written
for 4.8 and independent of the engine), and its own tree walk in exact enumeration. For each seat it checks that the
other seats' stored strategies in the response state equal the original ones, recomputes `V_i(sigma)`,
`V_i(R, sigma_-i)` and the best-response value, and compares them with the engine's exact figures.
Reports: `validation/5.8/independent/`.

| Game | Training updates (seed) | Seats | Rows compared: other seats / own | Largest difference of a stored probability | Largest difference of an exact value (engine against Python) | Direction holds | Exact gain inside the estimate's distribution-free interval | Largest distance of the estimate (standard errors) |
|---|---|---|---|---|---|---|---|---|
| hu-river | 20,000 (1) | 2 | 48 / 48 | 0.0e+00 | 8.9e-16 | yes | 2 of 2 | 0.96 |
| hu-river | 5,000 (2) | 2 | 48 / 48 | 0.0e+00 | 8.9e-16 | yes | 2 of 2 | 0.62 |
| hu-turn | 5,000 (1) | 2 | 748 / 748 | 0.0e+00 | 8.9e-16 | yes | 2 of 2 | 1.04 |
| hu-turn | 20,000 (2) | 2 | 752 / 752 | 0.0e+00 | 8.9e-16 | yes | 2 of 2 | 1.83 |
| river3-chip | 5,000 (1) | 3 | 300 / 150 | 0.0e+00 | 8.9e-16 | yes | 3 of 3 | 0.72 |
| river3-chip | 20,000 (2) | 3 | 300 / 150 | 0.0e+00 | 4.4e-16 | yes | 3 of 3 | 1.44 |
| turn4 | 5,000 (1) | 4 | 7533 / 2511 | 0.0e+00 | 1.8e-15 | yes | 4 of 4 | 1.24 |
| mid3-turn | 3,000 (1) | 3 | 10252 / 5126 | 0.0e+00 | 1.8e-15 | yes | 3 of 3 | 1.26 |

8 of 8 cases passed every check (21 seats).

The Python implementation covers postflop chip-EV games. It does not cover ICM utilities or preflop starts, and the
six-player games take too long in pure Python; for those the cross-check is the engine's own exact evaluator
(sections 3.2 and 3.3), which was itself validated against the Python best response in 4.8 and against the known
game in 5.7. That is a weaker kind of independence and is listed in section 10.

## 5. The large-study limit: why it stays at 10,000,000 updates

**What is limited.** `MW_MAX_UPDATES = 10,000,000` committed training updates of one engine state. An update is
`batchDeals` sampled deals (1 by default, up to 64 with frozen batches), so a state holds at most 10,000,000 deals
with the default trainer and 640,000,000 with 64-deal batches. The limit is checked in the engine (`mw_train`, the
state readers), in the command line, in the JavaScript reference, and - new in 5.8 - when a study is configured.

**Accounting types (checked, all adequate at and far beyond the limit).** Updates, sampled deals and state visits
are 64-bit integers in the engine; in state headers and study documents they are JSON numbers, exact up to 2^53
(the reader enforces `trainingDeals <= 2^53 - 1`); the largest values reachable at the limit are 6.4e8 deals and
about 1e12 state visits. Table rows are indexed with 31 bits and betting states with 27; both are budget limits
reached long before the update limit and are reported as a table limit. Regret and average sums are doubles: with
linear weighting the largest weight is 1e7 and the sums stay below 1e17 for unit payoffs, 16 orders of magnitude
inside the double range, with increments at least 1e-10 of the sum (no loss of the increment). The DCFR row stamp is
a 32-bit update count. None of these is why the limit exists.

**What binds: the random-number generator.** The deal stream and the shared action stream are 32-bit generators
(`state += 0x6d2b79f5; output = hash(state)`): 2^32 = 4.29e9 states on a single cycle. After 2^32 draws a stream
repeats exactly. Section 6.3 measures how many numbers one sampled deal draws from each stream on every shipped
fixture: at 10,000,000 deals the default trainer uses at most 0.31 of a cycle (the action stream of the six-player
flop fixture, 132 numbers per deal), so the limit could grow by a factor of 3.3 at most before a stream repeats on a
shipped fixture, and ten times more would exceed a cycle on four of the ten fixtures. A higher limit therefore needs a generator with a
longer period - which changes every trained state (the bit-identity with 5.7.1, with the JavaScript reference and
with every saved state), and the state header (its `rng` fields are 32-bit). That is a format change with its own
validation plan, not a constant to edit. **The limit is kept.**

**What changed.** A study whose largest budget needs more than 10,000,000 updates for one of its variants is refused
when it is configured (status 400, exit 1), before any engine exists, with the limit and the largest supported
budget in the message. Through 5.7.1 such a study trained every seed up to the limit - ten million deals, minutes to
hours - and then failed.

**A consequence that 5.7.1 did not state.** With 64-deal batches the engine accepts 640,000,000 deals per state.
The per-deal action streams of frozen batches are derived from (seed, update, deal) and do not wrap, but the DEAL
stream is one 32-bit stream and section 6.3 shows that it passes its cycle within such a budget on six of the ten
shipped fixtures (after 187 million deals on the six-player flop fixture, after 350 to 470 million on five others):
after that point the same deals recur in the same order (with different action randomness). Training stays a valid
regret-minimisation run on a periodic deal sequence - an empirical game of 1.9e8 to 4.7e8 deals - but the later
deals are no longer new information about the deal distribution. This is a property of 5.6, 5.7 and 5.7.1 as well;
5.8 documents it and does not change it. Shipped presets and fixtures stay at
4,000,000 deals or below, where no stream wraps.

## 6. Reference games

### 6.1 The games

Fifteen games with exact NashConv (`source/tools/games58.js`; `node source/tools/games58.js describe` prints stacks,
ranges and abstraction). Ten are the games of 4.8; five are new and are small tournament situations.

| Key | Seats | Starts on | Utility | What is modelled | What is abstracted away |
|---|---|---|---|---|---|
| `hu-river` | 2 | river | chip EV | half-pot bet or all-in, all-in raise | six hands a seat |
| `hu-turn` | 2 | turn | chip EV | turn all-in or check, river half-pot bet | four hands a seat |
| `river3-chip` | 3 | river | chip EV | stacks 4, 12, 30 BB: side pots; two bet sizes, all-in raise | six hands a seat |
| `turn4` | 4 | turn | chip EV | stacks 6 to 40 BB; turn all-in or check/fold, river half-pot bet | two hands a seat |
| `flop5` | 5 | flop | chip EV | stacks 4 to 40 BB, all-in or fold, side pots | two hands a seat, one decision each |
| `flop6` | 6 | flop | chip EV | stacks 3 to 50 BB, all-in or fold, side pots | two hands a seat, one decision each |
| `flop6w` | 6 | flop | chip EV | weighted ranges, half-pot bet or all-in | three hands a seat, flop betting only |
| `bubble4` | 4 | preflop | ICM, 3 paid | push or fold on the bubble, short stack | two weighted hands a seat |
| `final8` | 8 | preflop | ICM, 8 paid | eight-handed push or fold, blinds 0.5/1, ante 0.1 each (2.3 BB) | one fixed hand a seat |
| `final8w` | 8 | preflop | ICM, 8 paid | as `final8` | two weighted hands a seat |
| `early3-flop` (5.8) | 3 | flop | chip EV | early stage, 97.5 BB behind; flop bet of a third or three quarters, turn and river bets: **three streets** | four weighted hands a seat, no raises, five folded seats are dead money |
| `mid3-turn` (5.8) | 3 | turn | chip EV | medium unequal stacks (14 to 30 BB), two turn sizes and an all-in raise, river bet, side pot | four weighted hands a seat |
| `short8-push` (5.8) | 8 | preflop | chip EV | eight-handed push or fold, stacks 5 to 15 BB, 0.5/1 blinds and 0.1 ante each (2.3 BB), layered side pots | two weighted hands a seat, no payout pressure |
| `bubble5-icm` (5.8) | 5 | preflop | ICM, 4 paid | bubble with unequal stacks, push or fold | two weighted hands a seat; future hands are not modelled (ICM never models them) |
| `sidepot3-icm` (5.8) | 3 | river | ICM, 3 paid | final three, stacks 4, 12, 30 BB, side pots, two bet sizes and an all-in raise | six hands a seat |

The seven situations the 5.8 brief names are all present: heads-up river, heads-up turn and river, three-player
river with side pots, four-player turn and river, six-player flop, eight-handed ICM final table, four-player ICM
bubble. Eight-handed games use the specified forced bets: small blind 0.5, big blind 1, an ante of 0.1 from each of
the eight seats, 2.3 BB before the first action, no big-blind ante.

**These games are small on purpose.** Exactness is bought with two to six hands a seat. They show whether a
measure or a trainer is correct and how tight a lower bound is on games of this size and shape; they do not show
how large NashConv is on a 1,326-hand range, and no share measured here carries over to one.

### 6.2 Exact evaluators: what makes them exact

`exactBestResponse` enumerates, for the responding seat's hand, every compatible tuple of the other seats' hands with
its weight, every remaining board card, and every action; it refuses (status 413, nothing reported) when the visit
limit would be exceeded, so a reported exact value is never a truncated one. Its independent checks: the Python best
response of 4.8 (`independent_br48.py`), the game with a known solution (`known-akq-river`: the analytic bluffing
frequencies, 5.7 self-test), and section 4 above.

### 6.3 Random numbers drawn per deal (measured)

| Fixture | Seats | Numbers drawn per deal: deal stream | action stream | Share of a cycle at 10,000,000 deals: deal stream | action stream | Deals until the deal stream repeats | until the action stream repeats |
|---|---|---|---|---|---|---|---|
| btn25-open-small | 3 | 9.08 | 10.56 | 0.021 | 0.025 | 473,091,652 | 406,775,472 |
| btn25-open | 3 | 9.63 | 24.49 | 0.022 | 0.057 | 446,020,912 | 175,376,441 |
| flop3-kings-detailed | 3 | 6.44 | 51.87 | 0.015 | 0.121 | 667,377,396 | 82,798,748 |
| flop3-kings-small | 3 | 5.58 | 15.38 | 0.013 | 0.036 | 769,878,485 | 279,186,945 |
| flop3-kings | 3 | 6.44 | 55.94 | 0.015 | 0.130 | 667,377,396 | 76,771,945 |
| flop6-jack-small | 6 | 12.22 | 66.74 | 0.028 | 0.155 | 351,585,980 | 64,349,333 |
| flop6-jack | 6 | 22.92 | 131.56 | 0.053 | 0.306 | 187,368,979 | 32,647,557 |
| icm8-bb-call-small | 3 | 9.42 | 8.44 | 0.022 | 0.020 | 455,750,221 | 508,616,021 |
| icm8-bb-call | 3 | 9.62 | 8.14 | 0.022 | 0.019 | 446,241,032 | 527,553,655 |
| known-akq-river | 2 | 2.00 | 3.28 | 0.005 | 0.008 | 2,147,483,648 | 1,310,996,058 |

Largest share of a cycle at the limit with the default trainer: 0.306; the limit could grow by a factor of at most 3.3 before a stream repeats on a shipped fixture.

Method: `validation/5.8/limits/rng_period58.py` trains each shipped fixture with the default trainer and reads the
generator positions the state header records before and after; draws per deal = position difference / deals.

## 7. The ICM cache: why a cached value is the computed value

`Tournament::evaluate` (the Malmuth-Harville finishing-order recursion over subsets of the live players, unchanged
since 4.5) is a deterministic function of the chip vector it is given: the same key gives the same operations in the
same order and therefore the same bits. The cache stores, per exact key (all `n` doubles compared for equality), the
result vector the recursion produced. 5.8 changes only where an entry may be stored: a set of four ways instead of
one slot, a new key taking an empty way or else the way after the one replaced last. The number of entries, the
memory and its accounting are unchanged, so a table budget is reached at the same update as before.

| Statement | Check |
|---|---|
| a hit returns the recursion's bits | `mwcli --selftest58`, engine check E3: 50,400 evaluations with 2 to 8 seats, a small and a large cache, busted seats and repeated keys, each compared with a fresh (empty-cache) evaluation by `memcmp`: 0 differ, with 25,605 hits and 20,484 evictions exercised |
| the recursion is still the formula | engine check E4: three players, prizes 50/30/20, against `P(i first) = s_i / S`, `P(j second given i first) = s_j / (S - s_i)` written out |
| training is unchanged | identical state files for the ICM games in the identity run against the 5.7.1 binary (section 3.1) and in `tests/v58.test.js` (final8, bubble4: SHA-256 recorded from the 5.7.1 binary) |
| exact evaluation is unchanged | identical gain bits, 5.7.1 against 5.8 (PERFORMANCE-5.8.md, section 5) |
| the test notices a wrong cache | mutations "icm-cache-returns-a-neighbour" and "icm-places-shifted" (section 8) |

No new tournament utility model was introduced: ICM is the model of 4.5 and before. ICM assigns a prize equity to a
chip distribution at the end of the hand; it does not model future blinds, position or skill, and nothing in 5.8
claims otherwise.

## 8. Can the checks fail? (mutations)

`validation/5.8/mutation58.py` builds the engine with one 5.8 behaviour broken and runs `mwcli --selftest58`. A check
that passes on a broken engine checks nothing. Result (`validation/5.8/mutation58.json`): the unmodified control
passes all 33 checks; **all 10 mutants are detected, each by the checks expected to fail and by no unexpected one**.

| Mutant | What is broken | Checks that failed |
|---|---|---|
| opponents-not-frozen | the other seats keep their regrets: the response trains against the wrong profile | R1, R2, R3, R4 |
| every-seat-learns | the one-seat switch is ignored: every seat keeps learning | R1, R2, R3, R4 |
| sigma-not-restored | the seat's regret slot keeps the response training's regrets: "current" is not sigma | R1 |
| estimate-ignores-the-response | both values weighted with sigma: estimated gain always 0 | R4 |
| estimate-biased-upward | a quarter of the absolute response value added to every sample | R4 |
| threads-change-the-streams | a block's deal stream depends on the thread count | R5, R6 |
| one-stream-for-every-block | every block gets the same random stream | E2 |
| icm-cache-returns-a-neighbour | a cache hit returns the next way's value | E3 |
| icm-places-shifted | every place is paid the next place's prize | E4 |
| budget-check-removed | a study above the limit is accepted (the 5.7.1 behaviour) | L1, L2 |

## 9. What was verified, by which kind of evidence

| Statement | Class | Evidence |
|---|---|---|
| a trained-response gain never exceeds the exact best-response gain | **1** proof (section 1) and independent check | 560 + 560 seat gains (3.2); Python (4); self-test R3 |
| the response state holds `sigma` and frozen opponents exactly | **1** | difference 0 in every case (3.2, self-test R1/R2); Python: every stored probability identical (4) |
| the estimate is unbiased and its distribution-free interval holds | **1** proof (section 2); **2** empirical | 0 of 1,120 outside with enumerated actions (3.3); 0 of 98 and 0 of 960 with sampled actions (3.4, 3.5); no bias in 120 runs (3.5) |
| the normal-approximation interval of the estimate | **4** not reliable with sampled actions and rare events | 9 of 98 and 193 of 960 beyond four reported standard errors (3.4, 3.5) |
| 5.8 trains the states of 5.7.1 | **1** (the unchanged 5.7.1 binary agrees) | 225 cases, 1,782 runs, 0 differences (3.1) |
| cached ICM values equal the recursion | **1** for the bits (fresh recursion); **2** | E3, E4, identity on ICM games (7) |
| the same numbers on Windows | **2** under Wine: seven reference responses and all 33 self-test checks bit-identical to Linux; **3** on Windows hardware | VALIDATION-5.8.md, sections 9 and 10 |
| a study above the limit is refused before training | **2** | self-test L1 to L4, tests |
| anything about CUDA | **3**: no CUDA code changed in 5.8 and none was executed | PERFORMANCE-5.8.md, section 6 |

Classes: 1 independently mathematically validated; 2 tested on Linux, under Wine or by simulation; 3 implemented,
awaiting physical Windows/GPU validation; 4 unsuccessful, incomplete or not implemented.

## 10. What this validation does not show

1. **No upper bound.** For a game that cannot be enumerated, EightMax 5.8 has lower bounds of NashConv only. A
   strategy with a small trained-response gain may still be far from equilibrium: the response may be poor. On the
   three-street reference game it found three quarters of NashConv with two million response deals.
2. **Tightness is known only where exact values exist**, on games with two to six hands a seat. How much of NashConv
   a trained response finds on a full-range six-player flop study is unknown and cannot be measured with this
   release.
3. **The abstraction is not validated.** Every statement is about the study's own bet sizes, ranges and hand groups.
   How far the abstract equilibrium is from play in the full game is not measured by any figure here.
4. **Multiplayer and ICM.** NashConv = 0 identifies an equilibrium, but a small NashConv gives no guarantee against
   joint deviations and says nothing about which equilibrium. ICM is a model of tournament value, not the value.
5. The independent Python check covers postflop chip-EV games with up to four seats (section 4). ICM, preflop and
   six-player responses are checked by the engine's exact evaluator only.
6. The estimate with sampled opponent actions was compared with exact gains on eleven small games (3.4) and tested
   for bias on one (3.5). It is unbiased there; nothing checks it against an exact value on a large fixture, where
   no exact value exists.
7. The normal-approximation interval of the estimate is too narrow in the tail with enumerated actions (3.3) and
   can be wrong by orders of magnitude with sampled actions when strategies contain rare actions (3.4). Only the
   distribution-free interval is a guarantee.
8. With hand groups the response is constant on each group: the bound is valid and can be looser.
9. Nothing here ran on Windows hardware or on a GPU.
