# EightMax 5.14: mathematical validation

Build `57befd67c7c86ebe`. What is new in the training mathematics of 5.14, what is proven about it, and what was only tested.
Evidence: `validation/5.14/pruning/` (frozen-table runs, 3 to 6 million deals a game), `source/tests/prune514.cpp`, `mwcli --selftest514`.

## 1. Summary

| Statement | Status | Basis |
|---|---|---|
| The default trainer and `rbes` write the states of 5.13 | tested, byte for byte | 225 configurations and 176 fixture cases, 0 differences; section 5 |
| `nrpc-5.14-v1` (pruning with the correction) has the expected increments of the default estimator | **proven** (section 3), and consistent with a frozen-table test | four games, 3 to 6 million deals each: no entry above the critical value |
| `nrp-5.14-v1` (pruning without the correction) | **biased by construction** (section 4); no convergence guarantee | the frozen-table test shows the bias on three of four games: section 4 |
| Either algorithm converges faster | **not shown** | CONVERGENCE-5.14.md |
| The grouped merge of frozen batches changes no number | tested, byte for byte, for 1 to 4 threads | section 5 |

## 2. The rule both algorithms share

External sampling walks the tree once per deal and seat. At a decision of the updating seat it walks every action,
which is where pruning can save work. Let a row be the table entry of that decision (the seat's hand or hand group at
that betting state), with stored regrets R(a) and stored average-strategy sums S(a).

An action a is a **candidate** in a visit when all four hold:

1. the stored strategy gives it probability 0: some regret of the row is positive and R(a) <= 0;
2. a decision follows the action before the hand ends: its child is not terminal, and not a board that only runs out;
3. the row has evidence: A = sum of S(b) over the row's actions is at least E times w, where w = step x own / sp is
   the average-strategy weight this visit adds (own: the seat's reach of the decision; sp: the probability with which
   the path was sampled; step: the update weight). With linear weights this is roughly 2E visits spread over the run;
4. R(a) < -theta x U x A / own, where U is the utility scale of the game (the largest stack behind at the root in BB,
   or the largest prize; 1 for a satellite seat). A / own estimates the visit weight the row has collected, so the
   test reads: over those visits the action lost on average more than the fraction theta of U.

No test is made when own = 0 or when the row does not exist yet. Released settings: theta = 0.02, E = 50, and a
candidate is **skipped** with probability p = 0.95 (drawn from the traversal's action stream, so a training is
reproducible, does not depend on the thread count, and continues to the same state after a stop).

Because a candidate has probability 0 in the strategy that is being evaluated, the value of the decision does not
need the value of the action: skipping it changes nothing above the decision and nothing in the other actions'
regrets. What it leaves out is the regret increment of the action itself and every regret increment below it.
(Average-strategy increments below it are zero anyway: they carry the seat's reach, which is 0 there.)

## 3. `nrpc-5.14-v1` is unbiased

When a candidate is not skipped (probability 1 - p), `nrpc` multiplies the regret increment of the action and every
regret increment below it by 1 / (1 - p). The program does this through the sampling probability it carries down
the tree: it passes sp x (1 - p) into the subtree, and a regret increment is step x opp / sp x (a difference of
values), so every increment below is divided by 1 - p.

Claim. For every table entry, the expectation of the `nrpc` increment over its own coin flips equals the default
estimator's increment for the same deal and the same sampled opponent actions.

Proof. Fix a deal, the opponents' sampled actions, and a decision h of the updating seat with a candidate a. The
default estimator writes x for an entry at or below a. `nrpc` writes 0 with probability p and x / (1 - p) with
probability 1 - p, provided the subtree below a is walked as the default walks it; its expectation is x. Inside the
subtree the same argument applies at each further candidate, with the factor already accumulated; by induction over
the depth of nested candidates the expectation of what is written to an entry under k nested candidates is
(1 - p)^k x x / (1 - p)^k = x. The coin flips are independent of the deal and of the opponents' actions, and whether
an action is a candidate depends only on the stored table, which is fixed during a traversal; so the conditional
expectation given (deal, opponent actions) is the default increment, and the unconditional expectation is the
default estimator's expectation, which is the counterfactual regret (regrets) and the reach-weighted strategy
(averages). Entries outside every candidate subtree are untouched. QED.

Two remarks. (a) The skip flips consume random numbers from the action stream, so the opponents' sampled actions
after a flip differ from the default run's; they are still drawn with the same probabilities, which is all the proof
needs. (b) Unbiasedness has a price: the increments of a candidate subtree are 20 times larger when they happen. On
the frozen tables below the sum of the regret variances was 2.9 to 7.3 times the default's (and `nrp`'s was
smaller than the default's: it leaves the noisy increments out).

**Frozen-table test** (`tests/prune514.cpp`; `validation/5.14/pruning/`). A default-trained table is frozen; the
default estimator, `nrpc` and `nrp` each traverse independent deals; per table entry the mean increment of a pruned
estimator is compared with the default's (z statistic; entries with a Kish effective sample size of at least 2,000
for both; one Bonferroni statement at 0.05 over the entries compared).

| Game | Algorithm | Deals | Candidates a deal | State visits / default | Entries compared | Largest abs. z | Critical | Entries above | Regret variance / default |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rg-turn3 | `nrpc` | 6,000,000 | 1.39 | 0.906 | 444 | 3.06 | 3.86 | 0 | 4.2 |
| rg-turn3 | `nrp` | 6,000,000 | 1.39 | 0.906 | 455 | 187.19 | 3.87 | 3 | 0.8 |
| mid3-turn | `nrpc` | 6,000,000 | 1.00 | 0.934 | 1654 | 4.13 | 4.17 | 0 | 3.6 |
| mid3-turn | `nrp` | 6,000,000 | 1.00 | 0.934 | 1655 | 597.61 | 4.17 | 8 | 0.9 |
| rg-flop6c | `nrpc` | 3,000,000 | 1.97 | 0.890 | 193 | 3.26 | 3.65 | 0 | 7.3 |
| rg-flop6c | `nrp` | 3,000,000 | 1.97 | 0.890 | 196 | 341.81 | 3.66 | 10 | 0.7 |
| sidepot3-icm | `nrpc` | 6,000,000 | 0.41 | 0.958 | 180 | 3.09 | 3.64 | 0 | 2.9 |
| sidepot3-icm | `nrp` | 6,000,000 | 0.41 | 0.958 | 180 | 2.84 | 3.64 | 0 | 0.9 |

This is a consistency check, not a proof. That it has power is shown by the `nrp` rows: the same test rejects the
uncorrected algorithm. For `nrpc` the largest statistic of one game (mid3-turn) is close to its critical value; with
four games and one statement each, one such value is not remarkable, and it is reported as it came out.

## 4. `nrp-5.14-v1` is biased

`nrp` skips with the same probability and corrects nothing: a candidate's regret and the regrets below it move in
one visit of twenty and by the ordinary amount, so their expected increments are 1/20 of the default's. This is the
form published large-scale solvers use; it has no convergence guarantee here. The entries concerned are those of
actions that currently have probability 0 and a clearly negative regret, and the decisions below them.

The frozen-table test **shows this bias** where pruning is frequent enough (the rows `nrp` in the table above): on
three of the four games some entries have means many standard errors away from the default estimator's (z up to
several hundred), while the corrected algorithm has none above the critical value on any game. On the fourth game
(sidepot3-icm, 0.4 candidates a deal) nothing is detected for either. The test says that the bias exists and that the
correction removes it; it does not say how much the bias matters for the strategy a training ends with.
CONVERGENCE-5.14.md is the only evidence on that, and there `nrp` did no resolved harm.

## 5. What did not change

* **Default trainer, `rbes`, both kinds of streams, every payoff model.** The unchanged 5.13 program and 5.14 train 225 configurations and 176 fixture cases, 0 differences to the same bytes (`validation/5.14/identity/`).
* **The merge of frozen batches.** 5.7 to 5.13 let every merging thread read every increment of every deal and skip
  the rows of the other threads. 5.14 first groups each deal's increments by the thread that owns their row (a
  stable counting sort, done in parallel over the deals) and each thread then reads only its own. Every table entry
  receives the same additions in the same order. Evidence: the identity runs above (frozen batches on three threads
  with every update spread over the threads), `--selftest514` G1 (1, 2, 3 and 4 threads against recorded states,
  default trainer and `rbes`), and the recorded tables of `--selftest57` to `--selftest513`, which 5.14 did not touch
  and still reproduces.
* **`"pruning":"none"`** and a spec without the key are the default trainer (`--selftest514` P6).

## 6. Not proven, not tested

* No bound on how much slower `nrpc` may converge because of its variance, and none on the effect of `nrp`'s bias.
* Pruning with DCFR, regret matching+, a batch schedule, stratified or Latin deals, representative groups, `rbes`,
  own-hand or opponent enumeration: refused, never run.
* Nothing in this file was measured on Windows hardware; the recorded states are compared there by the self-test.
