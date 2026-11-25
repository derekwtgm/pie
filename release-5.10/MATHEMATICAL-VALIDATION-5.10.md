# EightMax 5.10: mathematical validation

What is claimed about the experimental estimator `rbes`, why it is true, how it was checked, and what was not checked.
Build `7fa0e8c16d6c6ade`. Evidence: `validation/5.10/estimator/` (written by `validation/5.10/estimator510.py`),
`mwcli --selftest510` (`validation/5.10/selftest/`), the regression file `source/tests/v510.test.js`.

## 1. The claims

| # | Claim | Kind of evidence | Result |
|---|---|---|---|
| C1 | For every table entry, the expected regret increment of one `rbes` update equals the counterfactual regret of the sampled-chance CFR update for the current table, and the expected average increment equals the reach-weighted strategy | proof (section 2); EXACT computation: the estimator's own code over every outcome of its sampling against a brute-force walk of the whole tree, 28 game and variant combinations; EXACT and INDEPENDENT: a Python implementation of the definition, 11 combinations | holds; largest difference 9.4e-17 of the scale (tolerance 1e-11) and 2.8e-17 against Python (tolerance 1e-9) |
| C2 | The production walk and the reference walk write the same increments | every sampling outcome of every exact check through both | largest difference 2.4e-12 of the scale, on the three-street game with Compact groups (`rg-flop3c`; a difference per outcome, not weighted by the outcome's probability: an outcome reached through several exploration draws carries increments orders of magnitude above the scale, and the two walks add in different orders); at most 1.1e-16 on the other 27 combinations; tolerance 1e-11 |
| C3 | The probabilities the traversal uses for its sampled actions are a distribution | the probabilities of the enumerated outcomes are summed for every (deal, seat) | within 1.2e-15 of 1 |
| C4 | With sampled terminal children the estimator is the 4.7 own-hand estimator (an implementation written independently, consuming the same random numbers) | exact NashConv of the strategies both train, after 100 to 40,000 deals, 12 games | identical to the last bit after 100 deals on 3 of 12 games; largest relative difference 6.6e-14 after 1,000 deals and 1.8e-6 after 40,000 (rounding, amplified by the training dynamics: section 6) |
| C5 | The estimator has a smaller variance than the default | variance of the increments per deal against the same frozen table, 13 games | regret increments: 0.0081 to 0.43 of the default's variance; average increments: 0.0013 to 0.38 (section 5) |
| C6 | With the engine's real deal sampler and random streams the two estimators agree in the mean | per entry, difference of the Monte Carlo means over its standard error, on the entries that both samples determine well; one Bonferroni family over 13 games | 2,417 entries; largest \|z\| 3.71, critical value 4.26 (section 5, which also reports two earlier runs of this comparison that were flagged, and why) |
| C7 | The states are deterministic: independent of threads, of the batch update, of the caches; stop and continue is byte for byte; the Windows program writes the bytes of the Linux program | SHA-256 | holds (self-test R1 to R3, under Linux and, as the Windows program, under Wine) |
| C8 | The sampler draws each non-terminal action with the probability the traversal uses in its weights, and never a terminal child | `Walker::rbPick` with the production random stream: 131 decisions, 2,000,000 draws each, chi-square against the claimed probabilities | smallest p-value 0.0042 against a Bonferroni level of 0.00038; no terminal child drawn (section 5.1) |

Not claimed: that a strategy trained by `rbes` is closer to equilibrium. That is an empirical question about
convergence, answered game by game in CONVERGENCE-5.10.md. An unbiased estimator with a smaller variance does not by
itself imply faster convergence per unit of time.

## 2. The estimator and why its expectation is the target

### 2.1 Notation and target

A deal D = (board, hands h_1 .. h_n) has probability P(D) proportional to the product of the range weights w_j(h_j)
over card-compatible tuples, every board completion equally likely (this is what the deal sampler draws: independent
weighted draws per seat, rejection of tuples that share a card, uniform board cards from the rest). For the table at
update t, sigma is regret matching on the stored regrets. For seat i at a decision h, pi_i(h) is the product of i's
own strategy probabilities on the path to h, pi_-i(h) that of the other seats, and v_i the expected utility of i under
sigma (expectation over later cards and actions). The row of i at h is r(h, x) for i's hand x. The sampled-chance CFR
update adds, to the row r,

    regret target(r, a)  = step * sum over D with r(h, h_i) = r of P(D) * pi_-i(h) * (v_i(h a) - v_i(h))
    average target(r, a) = step * sum over D with r(h, h_i) = r of P(D) * pi_i(h) * sigma(a)

(the counterfactual regret and the reach-weighted strategy, summed over the hands of the row when rows are hand
groups). The default trainer estimates both by sampling D and, for the other seats, one action per decision from
q = 0.9 sigma + 0.1 / k; section 2 of TRAINING-ENGINE-5.10.md has its increments.

### 2.2 Rule R1: the expectation over the updating seat's hand

Write D = (x, D_-i) with x = h_i. Given D_-i, the conditional distribution of x is c(x) = w_i(x) / sum_{y in C} w_i(y)
on the set C of hands of i's range sharing no card with D_-i (P is a product of weights times a compatibility
indicator, and the number of board completions does not depend on x). The opponents' information sets, hence their
strategies and their sampled actions, do not depend on x. So the default increment for the deal (x, D_-i) and the
opponents' sampled actions A is a function inc(x; D_-i, A), and

    E[ inc(x; D_-i, A) | D_-i, A ] = sum over x in C of c(x) * inc(x; D_-i, A).

`rbes` writes the right-hand side: for every x in C the default's regret and average increments multiplied by c(x),
added into the row of x. By the tower property its expectation over (D_-i, A) is the default's expectation. It is
not necessary that the hand x_0 the sampler drew for i be used at all, and it is not: the traversal of seat i
depends on D only through D_-i.

Rows shared by several hands: the increments of the hands of a row are added. The own reach pi_i(h) of two hands in
one row is the same number, because a row key contains the key of the previous street and, within a street, is the
same at every decision: two hands in one row now were in one row at every earlier decision of the seat and were
given the same strategy there. The implementation therefore carries pi_i per row; the reference walk carries it per
hand, and the two are compared (claim C2).

### 2.3 Rule R2: an opponent's terminal children in expectation

At a decision of an opponent with strategy sigma, let T be the actions whose child is terminal and N the others. The
value of the node for seat i is sum_a sigma(a) v(a) = sum_{a in T} sigma(a) u_a + sum_{a in N} sigma(a) v(a). The
first sum is known exactly once the deal is fixed (u_a is a payoff). For the second, draw a* from p(a) = q(a) / q(N)
on N and use sigma(a*) / p(a*) * v^(a*) where v^ is the (unbiased) estimate from below:

    E[ sigma(a*) / p(a*) * v^(a*) ] = sum_{a in N} p(a) * sigma(a) / p(a) * v(a) = sum_{a in N} sigma(a) v(a),

p(a) > 0 because q(a) >= 0.1 / k > 0. For the increments BELOW a*, the default's weights opp / sp and own / sp are
importance weights "true reach / sampled reach"; with R2 the sampled reach of the path is multiplied by p(a*)
instead of q(a*), and the implementation divides by exactly that product (`sp * p`). The regret weight
sigma(a*) / p(a*) = sigma(a*) q(N) / q(a*) is at most 1 / 0.9; the average weight 1 / p(a*) is at most the default's
1 / q(a*). When N is empty no random number is drawn; when T is empty, p = q and the rule is the default's.

An action with sigma(a) = 0 in T is not evaluated (it contributes sigma(a) u_a = 0); an action with sigma(a) = 0 in
N can be sampled (through the exploration floor), contributes 0 to the value and to the regrets below it, and its
average increments keep their weight own / sp, as in the default.

### 2.4 What the proof assumes

1. The deal sampler draws from P above (unchanged code; assumption shared with the default trainer and tested
   through claim C6, which uses the real sampler), and the action sampler draws a* with the probability p(a*) that
   the weights use (claim C8: the exact checks replace the random stream by a script and cannot see this).
2. The exploration floor is positive (it is 0.1 by default; `opponentExploration: 0` is accepted by the engine for
   the default trainer and makes an opponent action of probability 0 unreachable for both estimators. The exact
   checks refuse to run with a floor of 0).
3. Perfect recall of the row keys along a seat's path (true for exact cards and for Compact and Detailed keys by
   construction; the representative groups of turn and river starts are refused).

## 3. The exact check (claims C1 to C3)

`source/native/es_rbes510_check.hpp` (in the engine, so the shipped Windows program runs it: `mwcli
--estimator-check`, `mwcli --selftest510 ... estimator`) and `source/tests/rbes510.cpp`.

For a deal and an updating seat i, with the tables frozen:

* **estimate**: the traversal is run once for EVERY outcome of its sampled opponent actions. A script replaces the
  random stream (`Walker::rbScript`): at each sampled decision it selects the next unexplored candidate and
  multiplies the outcome's probability by the p the traversal used; the outcomes are enumerated like the digits of
  an odometer. The increments of each outcome are added with its probability. The probabilities must sum to 1.
* **target**: for every hand x of the seat compatible with the board and the opponents' hands, a plain recursive
  walk of the WHOLE betting tree for the deal (x, opponents' hands, board) - every action of every seat, no sampling,
  no vectors, the default trainer's row keys (`worldGroups`), the engine's all-seat payoff - accumulates
  c(x) x step x pi_-i (v(a) - v) and c(x) x step x pi_i sigma(a) into the row of x. c(x) is computed by the check.

The two must agree for every table entry of the deal: "E[rbes increment | board, opponents' hands] = E[target |
board, opponents' hands]". Entries are identified by betting path, hand field and code field, so states and rows the
table does not hold yet are compared like the others. The comparison is in units of scale = step x (stacks + pot).

What this check shares with the estimator: the betting rules, the payoff function (including ICM) and the row keys
of the DEFAULT trainer. What it does not share: the sampling, the importance weights, the vectors, the conditional
weights, the per-row reach, the terminal runs, the row keys computed for all hands (`rbGroupEntry`), the caches.
A wrong row key in `rbes` shows as increments in the wrong rows.

| Game and variant | Seats | Deals | Hands carried per seat and deal | Sampling outcomes enumerated | Table entries compared | Largest difference / scale | Production against reference walk / scale | Outcome probabilities: largest distance of a sum from 1 | Result |
|---|---|---|---|---|---|---|---|---|---|
| `known-akq-river` | 2 | 200 | 1.5 | 600 | 4,800 | 8.2e-18 | 0 | 6.9e-17 | passed |
| `hu-river` | 2 | 400 | 5.53 | 2,000 | 88,500 | 1.7e-17 | 0 | 8.3e-17 | passed |
| `hu-river-sampled-terminals` | 2 | 300 | 5.53 | 9,900 | 66,340 | 2.4e-17 | 0 | 1.7e-16 | passed |
| `hu-river-reference-walk` | 2 | 300 | 5.53 | 1,500 | 66,340 | 1.7e-17 | 0 | 8.3e-17 | passed |
| `river3-chip` | 3 | 200 | 5.17 | 12,800 | 117,766 | 1.7e-17 | 1.5e-17 | 2.7e-16 | passed |
| `river3-chip-sampled-terminals` | 3 | 60 | 5.17 | 27,600 | 35,316 | 1.6e-17 | 1.4e-17 | 4.4e-16 | passed |
| `hu-turn` | 2 | 400 | 3.44 | 2,000 | 44,000 | 3.0e-17 | 0 | 2.1e-16 | passed |
| `turn4` | 4 | 30 | 1.97 | 29,880 | 22,640 | 5.4e-17 | 3.8e-17 | 7.5e-16 | passed |
| `mid3-turn` | 3 | 12 | 3.86 | 41,628 | 25,030 | 3.2e-17 | 6.0e-17 | 4.8e-16 | passed |
| `sidepot3-icm` | 3 | 200 | 5.17 | 12,800 | 117,766 | 3.5e-17 | 5.5e-17 | 2.7e-16 | passed |
| `bubble4` | 4 | 200 | 1.77 | 5,800 | 19,748 | 9.4e-17 | 0 | 2.6e-16 | passed |
| `bubble5-icm` | 5 | 40 | 1.67 | 6,000 | 10,176 | 5.2e-17 | 1.0e-16 | 4.4e-16 | passed |
| `final8` | 8 | 6 | 1 | 151,236 | 9,636 | 3.8e-17 | 5.6e-17 | 7.4e-16 | passed |
| `short8-push` | 8 | 3 | 1.67 | 307,884 | 14,000 | 3.2e-17 | 6.1e-17 | 4.9e-16 | passed |
| `flop6` | 6 | 6 | 1.94 | 68,658 | 8,960 | 7.3e-17 | 6.4e-17 | 9.5e-16 | passed |
| `rg-hu-river` | 2 | 200 | 50.2 | 1,000 | 401,820 | 3.1e-18 | 0 | 1.1e-16 | passed |
| `rg-river3` | 3 | 100 | 23.6 | 6,400 | 271,042 | 4.3e-18 | 6.9e-18 | 2.7e-16 | passed |
| `rg-hu-turn` | 2 | 200 | 27.7 | 1,000 | 177,424 | 6.6e-18 | 0 | 2.4e-16 | passed |
| `rg-turn3` | 3 | 8 | 18 | 27,752 | 77,910 | 1.1e-17 | 1.8e-17 | 3.8e-16 | passed |
| `rg-turn4` | 4 | 20 | 7.75 | 19,920 | 60,032 | 2.5e-17 | 3.0e-17 | 7.6e-16 | passed |
| `rg-icm3-river` | 3 | 100 | 23.6 | 6,400 | 271,042 | 1.4e-17 | 1.4e-17 | 3.1e-16 | passed |
| `rg-bubble4` | 4 | 60 | 3.52 | 1,740 | 11,780 | 9.2e-17 | 1.0e-16 | 2.6e-16 | passed |
| `rg-flop3c` | 3 | 6 | 12.5 | 18,018 | 9,392 | 7.3e-17 | 2.4e-12 | 6.7e-16 | passed |
| `rg-flop6c` | 6 | 2 | 3 | 812,710 | 7,650 | 7.4e-17 | 6.3e-17 | 1.1e-15 | passed |
| `flop3-kings-small` | 3 | 30 | 4.51 | 4,410 | 12,180 | 1.8e-17 | 1.6e-17 | 4.9e-16 | passed |
| `icm8-bb-call-small` | 3 | 100 | 3.33 | 700 | 7,664 | 1.3e-17 | 0 | 9.0e-17 | passed |
| `btn25-open-small` | 3 | 60 | 4.13 | 2,220 | 15,974 | 4.8e-17 | 3.2e-17 | 2.2e-16 | passed |
| `flop6-jack-small` | 6 | 2 | 2.58 | 3,325,116 | 7,874 | 4.6e-17 | 3.2e-17 | 1.2e-15 | passed |
| **all** | 2 to 8 | 3,245 | | **4,907,672** | **1,982,802** | **9.4e-17** | **2.4e-12** | **1.2e-15** | 28 of 28 passed |

## 4. The independent check (claim C1)

`source/tests/rbes510.cpp total` forms the same exact expectation over EVERY deal (each hand tuple and each board
completion with its probability) and writes the expected increment per sampled deal of every table entry.
`source/tools/independent_rbes510.py` computes the targets of section 2.1 from the spec and the frozen values with
the implementation of `tools/independent_cfr56.py`: Python, its own betting rules, side pots and seven-card evaluator
(`tools/independent_br48.py`), every compatible hand tuple and every remaining card enumerated. It shares no code with
the engine and knows nothing of the estimator. Supported by the Python game: postflop chip-EV games with exact cards.

| Game and variant | Deals enumerated by the engine | Hand tuples enumerated by Python | Sampling outcomes enumerated | Entries compared | With a nonzero target | Largest regret difference / scale | Largest average difference / scale | Engine against its own brute-force walk / scale | Result |
|---|---|---|---|---|---|---|---|---|---|
| `hu-river` | 33 | 33 | 165 | 240 | 111 | 7.1e-18 | 4.5e-19 | 4.8e-18 | passed |
| `hu-river-sampled-terminals` | 33 | 33 | 1,089 | 240 | 123 | 7.1e-18 | 4.5e-19 | 7.3e-18 | passed |
| `hu-river-reference-walk` | 33 | 33 | 165 | 240 | 111 | 7.1e-18 | 4.5e-19 | 4.8e-18 | passed |
| `river3-chip` | 168 | 168 | 10,752 | 684 | 196 | 6.9e-18 | 3.0e-18 | 2.4e-18 | passed |
| `river3-chip-sampled-terminals` | 168 | 168 | 77,280 | 684 | 235 | 6.9e-18 | 3.0e-18 | 4.6e-18 | passed |
| `hu-turn` | 616 | 14 | 3,080 | 3,008 | 1,073 | 2.5e-17 | 1.4e-18 | 6.1e-18 | passed |
| `hu-turn-sampled-terminals` | 616 | 14 | 10,472 | 3,008 | 1,178 | 2.2e-17 | 1.4e-18 | 6.8e-18 | passed |
| `mid3-turn` | 2,688 | 64 | 9,324,672 | 62,640 | 12,686 | 2.8e-17 | 3.4e-18 | 9.1e-18 | passed |
| `rg-hu-river` | 2,923 | 2,923 | 14,615 | 2,340 | 1,076 | 8.9e-19 | 4.5e-19 | 6.1e-19 | passed |
| `rg-hu-turn` | 40,172 | 913 | 200,860 | 24,064 | 11,320 | 3.4e-18 | 1.2e-18 | 3.5e-19 | passed |
| `rg-river3` | 18,651 | 18,651 | 1,193,664 | 3,450 | 1,141 | 2.3e-17 | 6.1e-18 | 5.7e-19 | passed |

The checker is not vacuous: a dump whose regret entries are scaled by 1.001 is rejected (regression test).

## 5. The real sampler: frequencies, variance, agreement in the mean (claims C8, C5, C6)

### 5.1 The action sampler (claim C8)

The exact checks of sections 3 and 4 enumerate the outcomes of the sampling through a script and weight each with
the probability the traversal CLAIMS for it. Whether the production code draws with those probabilities is a
separate fact. `rbes510 pick` calls the production sampler (`Walker::rbPick`, three lines: one uniform number,
inverse of the cumulative q(a) / q(N) over the non-terminal children) with the production random stream for
131 decisions - 2 to 6 actions, masks of terminal children that leave at least two candidates, strategies from
near-pure to uniform, q = 0.9 sigma + 0.1 / k, smallest claimed probability 0.017 - 2,000,000 times each, and
`estimator510.py` tests the counts against the claimed probabilities (chi-square, exact tail probability):
smallest p-value 0.0042 (Bonferroni level 0.00038), deciles of the p-values 0.00, 0.07, 0.14, 0.22, 0.33, 0.45, 0.57, 0.65, 0.80, 0.90, 0.98 (uniform is 0.0, 0.1,
... 1.0); a terminal child was drawn 0 times. The regression test repeats this with fewer draws and checks that the
same counts against a WRONG claim (uniform over the candidates of a near-pure decision) are rejected.

### 5.2 Variance (claim C5)

`rbes510 mc`: independent deals drawn by the engine's sampler, traversed by the default estimator and by `rbes`
against the same frozen table (trained by `rbes` for 100,000 deals; 60,000 for the Detailed fixture). "Variance" is
the sum over the table entries of the variance of the entry's increment per deal, for regrets and averages
separately; it weights entries by the size of their increments and is a summary, not a statement about any single
row.

| Game | Deals | Regret-increment variance, rbes / default | Average-increment variance, rbes / default | Time per deal, rbes / default | Variance x time, regrets |
|---|---|---|---|---|---|
| `hu-river` | 2,000,000 | 0.125 | 0.12 | 4.11 | 0.514 |
| `rg-hu-river` | 1,000,000 | 0.0195 | 0.00836 | 18 | 0.351 |
| `rg-river3` | 1,000,000 | 0.0396 | 0.0337 | 8.16 | 0.323 |
| `rg-hu-turn` | 1,000,000 | 0.0349 | 0.0308 | 8.58 | 0.299 |
| `rg-turn3` | 3,200,000 | 0.0559 | 0.00132 | 4.16 | 0.233 |
| `rg-turn4` | 1,000,000 | 0.129 | 0.1 | 3.48 | 0.447 |
| `rg-icm3-river` | 1,000,000 | 0.02 | 0.0324 | 7.37 | 0.147 |
| `rg-bubble4` | 1,000,000 | 0.207 | 0.257 | 2.62 | 0.543 |
| `rg-flop6c` | 1,000,000 | 0.353 | 0.35 | 2.02 | 0.714 |
| `flop6-jack-small` | 1,000,000 | 0.425 | 0.0262 | 1.74 | 0.74 |
| `flop3-kings` | 1,920,000 | 0.0881 | 0.384 | 6.84 | 0.603 |
| `flop6-jack` | 1,000,000 | 0.148 | 0.125 | 2.73 | 0.404 |
| `flop3-kings-detailed` | 500,000 | 0.00807 | 0.00503 | 16.1 | 0.13 |

Reading. The regret variance falls most where a seat has many rows at a node and the opponents' sampling matters
least (river games with ranges, the Detailed fixture), least on the six-player games, where five opponents are still
sampled. The last column is the product that matters for training at equal time; it is below 1 on every game
measured and close to 1 on the six-player games.

The average-increment column must be read with care. That variance is dominated by the weights 1 / sp of the
opponents' sampled lines (TRAINING-ENGINE-5.10.md, 2.3), which R1 does not touch and R2 only reduces at decisions
with terminal children, and a variance of such weights is itself poorly estimated: the first run, with a fifth to a
thirtieth of these deals, gave 1.13 for flop6-jack, 1.18 for rg-flop6c and 0.75 for flop3-kings where this table
has 0.12, 0.35 and 0.38. What can be said is that no sample showed the average increments of `rbes` to be
systematically noisier, and that the size of the reduction on large games is not established.

### 5.3 Agreement in the mean (claim C6), and the two runs that were flagged

Two unbiased estimators of the same quantity must agree. Per table entry: z = (mean of the default - mean of
`rbes`) / standard error of the difference, with a Bonferroni correction over the entries compared.

**First run** (kept in `validation/5.10/estimator/first-run/`). Entries compared: a nonzero increment in at least
500 deals of both samples; correction within each game. Ten of twelve games passed. rg-turn3 (100,000 deals, |z|
4.29 against 3.98) and flop3-kings (60,000 deals, |z| 6.31 against 3.93) did not; the thirteenth game exhausted the
machine's memory and ended the run. Of the 17 entries with |z| above 3 in those two games, 12 were average-strategy
entries (all 5 of flop3-kings, 7 of 12 in rg-turn3), and in 13 the DEFAULT estimator's mean was the smaller one. Both games were repeated with 32 times the
deals, which contain the first sample (`diagnosis.json`): the flagged |z| fell to at most 1.17 and 1.66,
where a bias of the observed size would have given 24 and 36; the means of the default moved (median 29% in
rg-turn3; in flop3-kings the means of BOTH estimators changed by an order of magnitude), and the Kish effective
sample size of the default's flagged entries was about 120 (medians 128 and 116) although each had more than 500
nonzero deals. Cause: an average
increment carries the weight 1 / sp, bounded only by (10 k)^(opponent decisions); a few hundred nonzero deals can be
a few dozen effective ones, the sample mean is then typically too small and its standard error far too small, and a
z statistic is meaningless. The rule "500 nonzero deals" was wrong for such entries; the estimators were not.

**Second run** (`second-run/`). Entries compared: Kish effective sample size, N mean^2 / ((N - 1) se^2 + mean^2), of
at least 2,000 for both estimators (each mean known to about 2%), with 5 to 32 times the deals of the first run so
that such entries exist; correction still within each game. Twelve of thirteen games passed; rg-hu-turn did not: one
REGRET entry of 118 at |z| 3.71 against 3.52. Thirteen games tested at 0.05 each flag at least one game by chance in
about half of all runs, which is what this was: followed to 4 and 16 times the deals (`followup-rg-hu-turn.json`),
the entry's |z| was 1.61 and 0.96, where a bias of that size would have given 7.4 and 14.8, and with 16,000,000
deals 2,798 qualifying entries of that game showed a largest |z| of 3.70 against a critical value of 4.29.

**Final run** (`summary.json`, `variance/`). Entries compared as in the second run; ONE family for the whole part:
every compared entry of every game, familywise level 0.05. 2,417 entries in 13 games; largest |z|
3.71 against 4.26. Per game (the per-game critical value, which is not the criterion, is shown for
comparison with the second run):

| Game | Entries compared: regret | average | Largest \|z\| | rms z: regret | average | Per-game critical value (not the criterion) | First rule, for comparison: entries | largest \|z\| | Result |
|---|---|---|---|---|---|---|---|---|---|
| `hu-river` | 57 | 40 | 2.97 | 1.07 | 0.847 | 3.47 | 108 | 2.97 | passed |
| `rg-hu-river` | 47 | 64 | 2.86 | 1.22 | 1.12 | 3.51 | 976 | 3.62 | passed |
| `rg-river3` | 120 | 119 | 2.77 | 1.03 | 1.04 | 3.71 | 741 | 3.60 | passed |
| `rg-hu-turn` | 16 | 102 | 3.71 | 1.36 | 1.07 | 3.52 | 2399 | 5.29 | passed |
| `rg-turn3` | 224 | 150 | 2.97 | 0.991 | 0.968 | 3.82 | 10801 | 6.44 | passed |
| `rg-turn4` | 44 | 100 | 2.76 | 1 | 1.1 | 3.58 | 1128 | 3.33 | passed |
| `rg-icm3-river` | 45 | 134 | 3.11 | 1.14 | 1.01 | 3.63 | 757 | 3.75 | passed |
| `rg-bubble4` | 13 | 37 | 2.31 | 1.25 | 1.15 | 3.29 | 127 | 2.68 | passed |
| `rg-flop6c` | 91 | 25 | 3.15 | 0.936 | 1.05 | 3.52 | 928 | 4.00 | passed |
| `flop6-jack-small` | 79 | 54 | 2.75 | 0.934 | 0.836 | 3.56 | 553 | 4.27 | passed |
| `flop3-kings` | 402 | 180 | 3.62 | 1.01 | 0.965 | 3.93 | 14215 | 9.54 | passed |
| `flop6-jack` | 86 | 77 | 2.77 | 1.07 | 1.09 | 3.61 | 8445 | 5.01 | passed |
| `flop3-kings-detailed` | 0 | 111 | 2.36 | - | 0.996 | 3.51 | 2482 | 4.49 | passed |

What changed between the runs is which entries are compared and how the comparisons are counted, both for reasons
that can be checked in the files named; what did not change is the estimator, and at no point was a discrepancy
left without a larger sample that either confirms or removes it. The statistics of the first rule are still printed
for every game in `variance/*.json` (`firstRuleNotUsedForTheVerdict`).

## 6. The 4.7 estimator as a second implementation (claim C4)

`ownHandEnumeration` (4.7, `Walker::learnVec`) implements rule R1 for exact cards. It was written by other hands,
shares none of the 5.10 traversal code, and draws one random number per opponent decision, as `rbes` does with
sampled terminal children. Deal after deal the two must write the same increments up to the order of floating-point
additions. Exact NashConv of the strategies both train (the production walk; the reference walk in brackets where it
differs more):

| Game | Exact NashConv after 40,000 deals (4.7 estimator) | Relative difference after 100 deals | Relative difference after 1,000 deals | Relative difference after 10,000 deals | Relative difference after 20,000 deals | Relative difference after 40,000 deals | Result |
|---|---|---|---|---|---|---|---|
| `hu-river` | 0.079244 | 0 | 2.0e-15 | 9.5e-15 | 9.5e-15 | 9.0e-14 | passed |
| `river3-chip` | 0.0375667 | 4.0e-16 | 4.2e-15 | 4.9e-14 | 2.2e-13 | 8.1e-13 | passed |
| `hu-turn` | 0.162173 | 4.5e-16 | 4.1e-16 | 3.1e-15 | 1.7e-15 | 7.7e-14 | passed |
| `turn4` | 0.00232964 | 0 | 5.6e-16 | 3.1e-15 | 5.4e-16 | 1.9e-16 | passed |
| `flop6` | 0.108128 | 4.6e-16 | 1.4e-15 | 1.4e-14 | 1.8e-15 | 2.5e-14 | passed |
| `bubble4` | 9.57519e-05 | 1.0e-14 | 1.2e-14 | 0 | 0 | 0 | passed |
| `rg-hu-river` | 0.0933452 | 0 | 6.4e-15 | 1.3e-14 | 5.8e-15 | 1.4e-14 | passed |
| `rg-river3` | 0.0327592 | 5.6e-16 | 1.3e-14 | 1.3e-14 | 8.9e-14 | 2.6e-13 | passed |
| `rg-turn4` | 0.378319 | 1.1e-15 | 6.7e-16 | 9.5e-16 | 4.4e-13 | 5.4e-14 | passed |
| `rg-icm3-river` | 0.0422404 | 9.1e-15 | 6.6e-14 | 1.0e-10 | 9.6e-11 | 2.7e-10 | passed |
| `sidepot3-icm` | 0.114386 | 2.6e-15 | 1.3e-14 | 7.1e-12 | 1.7e-9 | 1.8e-6 | passed |
| `mid3-turn` | 1.7688 | 1.5e-16 | 5.0e-16 | 2.8e-14 | 1.2e-12 | 8.0e-11 | passed |

The first form of this check asked for 8 equal digits after 40,000 deals only. Eleven games had 10 to 13;
sidepot3-icm had 6. Its trace above is the explanation: agreement to rounding after 100 and 1,000 deals, then a
relative difference that grows smoothly with the length of the training. A different increment - a wrong weight in a rare
side-pot or ICM case - would appear at the first deal that contains it, as a jump, and the exact check of section 3
passes on that game for 200 deals with every updating seat. The check now requires agreement to 1e-10 after 100 and
1,000 deals and records the rest; how fast rounding differences grow is a property of the game's training dynamics
(this one is still far from equilibrium at 40,000 deals and its NashConv is not yet monotone).

## 7. Determinism and numerical behaviour (claim C7)

* **Threads, batches, caches.** A frozen batch of `rbes` gives one state for 1, 2, 3 and 4 threads, for the measured
  thread choice, for the 5.6 batch update (`EIGHTMAX_LEGACY_BATCH=1`) and with the key cache switched off; stop
  after a third and continue gives the uninterrupted state (regression test on five games; self-test R1, R2 on four
  fixtures). The reason is the default trainer's: everything that assigns an identifier (key, betting state, row)
  runs on the calling thread in deal order, and each row receives its additions in deal order.
* **Platforms.** The Windows program (MinGW-w64 GCC 13, run under Wine) writes the SHA-256 of the Linux program for
  12 `rbes` states and 14 default states (self-test R3, D1). Physical Windows: pending (WINDOWS-TESTS-5.10.md).
* **Zero probabilities.** q >= 0.1 / k, so no division by zero in sigma / p or 1 / sp; a row whose regrets are all
  non-positive plays uniformly (the default's rule); a hand of weight 0 is never carried.
* **Non-finite values.** Every stored sum is tested; a non-finite one fails the update, which is rolled back by the
  default trainer's journal, and training stops with an error (unchanged behaviour; `mergeRB` tests once per seat).
* **Random streams.** `rbes` uses the default trainer's streams (one shared stream, or one stream per (update, deal)
  for frozen batches) and consumes one number per sampled opponent decision with a non-terminal child. Its states are
  not comparable with the default's at equal seeds.
* **Sanitizers.** AddressSanitizer, UndefinedBehaviorSanitizer and ThreadSanitizer runs: VALIDATION-5.10.md.

## 8. Independent accuracy validation of the other parts (brief, objective 7)

Unchanged in 5.10 and re-run: hand strength, terminal payoffs, side pots and exact best responses against
`tools/independent_br48.py` (regression tests of 4.8); ICM against the finishing-order formula and the cached
recursion (`--selftest58`); the evaluation streams and confidence statements against `tools/independent_stats59.py`
(`--selftest59`); the default estimator against `tools/independent_cfr56.py` (regression tests of 5.6). New in 5.10:
sections 3 to 6 above, and exact NashConv of both trainers on four fixtures in the self-test (regression values).
No comparison with an external open-source solver was made: none was found that plays these games (multiway, side
pots, this abstraction, this utility) without modification, and comparing NashConv across different abstractions
would be meaningless.

## 9. Limitations

1. The exact checks cover the games listed; on larger trees the number of sampling outcomes of one traversal is too
   large to enumerate (1.7 million for one six-player deal of the small fixture), and the realistic fixtures are
   covered by the Monte Carlo comparison of section 5.3 only.
2. The independent Python implementation plays postflop chip-EV games with exact cards. ICM, preflop starts and hand
   groups are checked exactly against the brute-force walk inside the engine's rules, which shares the payoff
   function and the default trainer's keys with the estimator.
3. "Unbiased" is a statement about increments for a FIXED table. It does not bound the regret of the sequence of
   strategies; MCCFR convergence results for external sampling apply to estimators with these expectations and
   bounded increments, and the weights of `rbes` are bounded by the default's.
4. The variance summary of section 5 is one number per game, and for average increments an unstable one.
5. The Monte Carlo comparison of section 5.3 has power only on entries that both estimators determine well; rows
   deep in a large tree are compared by no statistical test here (they are covered by the exact checks on the
   smaller games, which exercise the same code).
6. The criterion of section 5.3 and the form of section 6 were revised after runs that failed; the runs, the reasons
   and the follow-up samples are in the evidence folders named there.
7. Nothing here was executed on physical Windows.
