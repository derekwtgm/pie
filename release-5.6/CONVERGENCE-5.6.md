# Convergence — EightMax 5.6

Version 5.5 left one question open: its opt-in river opponent enumeration converged better per sampled deal and not per second. Version 5.6 did three things: it made the unchanged default trainer faster without changing a number it computes, it built a cheaper form of the enumeration, and it compared all of them under a plan fixed before measurement.

## Summary

| Question | Answer |
|---|---|
| Is the 5.6 default trainer the 5.5 estimator? | Yes. At equal seeds and sampled deals it wrote the same checkpoint file as the unchanged 5.5 binary in every one of 1260 paired runs (7 games, 60 seeds, 3 deal budgets), and in the 170-case identity matrix. |
| Is the default closer to equilibrium at equal wall-clock time? | **Yes, on 6 of 7 games.** With 0.5 s of training the 5.6 default had lower exact NashConv than 5.5 in 6 of 7 games under the primary test (sign test and t interval, Bonferroni over 14): hu-river, hu-turn, river3-chip, turn4, final8, bubble4. Mean NashConv ratios (5.6 / 5.5): hu-river 0.70, hu-turn 0.74, river3-chip 0.71, turn4 0.27, flop6 0.70, final8 0.26, bubble4 0.35. It processed hu-river 2.17x, hu-turn 1.91x, river3-chip 1.94x, turn4 1.90x, flop6 1.97x, final8 2.04x, bubble4 1.70x the sampled deals in the same time. |
| Was a new estimator implemented? | Yes, two, both opt-in: `"opponentEnumeration":"river-shared"` and `"river-cross"`. |
| Do they have the right expectation? | Checked against an independently computed exact CFR update (Python) on four games; see "Correctness". Every estimator passed. |
| Does the 5.6 candidate (river-cross) beat the 5.6 default at equal time? | hu-river: unresolved (ratio 0.84); hu-turn: unresolved (ratio 0.97); river3-chip: worse (ratio 1.29); turn4: better (ratio 0.45) |
| Was it promoted to the default? | **No.** P2 (better at 0.5 s in every game it changes): not met. P3 (worse nowhere): not met. P4 (no equal-time mean more than 5% above the default): not met. |
| Is 5.6 closer to equilibrium than 5.5 by default? | At equal time, on the games above, yes, because it does more of the same work per second. At equal sampled deals it is identical to 5.5. No claim is made for games that were not measured. |

NashConv is the sum over seats of the exact unilateral best-response gain inside each game's abstraction. With more than two players it is not exploitability. All NashConv values in this document are exact (`mwcli --gain`, method `exact`), never sampled and never a restricted response.

## What changed in the trainer

### The default trainer: same numbers, less work per deal

Profiling the 5.5 trainer (`validation/5.6/profile/`) showed that on small games a sampled deal cost about ten thousand instructions for some fifteen state visits, most of it bookkeeping around the traversal:

- every update allocated and freed its undo journal (several times, as it grew);
- every terminal state (half of all visits) was rebuilt by the betting rules or copied, 440 bytes at a time, from a per-worker cache, and its pot layout looked up again;
- every child state was found through a hash lookup although the parent was already stored;
- every information set was looked up in the row hash twice, once to read the strategy and once to merge the increment;
- the clock was read 3n + 2 times per deal for stage timing;
- the flop was sorted three times per deal to compute card codes;
- Compact hand-group keys were built as decimal text and hashed as strings for every seat and street.

5.6 removes each of these (`source/native/mw_es.hpp`, `mw_es_impl.hpp`, `es_transaction.hpp`, `es_groups.hpp`): stored states carry direct links to their children and to terminal records built once by the same rules calls; the row index found when the strategy is read travels with the increment; one journal serves the whole training call; stage timing is sampled on one update in sixteen (the reported stage seconds of one-deal updates are now estimates); the flop code is computed once; Compact keys are looked up by number. None of this changes which states are visited, which random numbers are drawn or any arithmetic, and the state files are byte-identical to 5.5 (golden hashes in `source/tests/fixtures/golden56.json`, `validation/5.6/identity/`).

The link records use up to 16 MiB more memory per engine than 5.5 (the same allowance as the state store, not charged to the table budget, reported as `linkCache`).

### The candidates: shared traversals of the enumerated final street

5.5's river enumeration walks the whole final-street betting tree for the sampled deal once per updating seat. Inside that subtree nothing is sampled, so one walk already knows every seat's value at every node.

- **river-shared**: when the whole game is on the final street, one walk per deal updates every seat (5.5: n walks). For the same deal and table it writes exactly the increments of 5.5's enumeration for every seat (compared entry by entry, see below); the seats are updated together instead of in turn. Games that start earlier are trained as by 5.5's `river`.
- **river-cross**: as river-shared, and in games that start earlier each seat's traversal also updates the other seats' final-street information sets, importance-weighted by the probability with which the traversal reached them; each of the n traversals contributes weight 1/n. This is the 5.6 candidate.

Both are refused in combination with own-hand enumeration and the terminal estimators (not implemented for the vector walk), and a checkpoint trained with one estimator is refused by another (the study id in the state header covers the trainer options).

## Correctness: expected increments against an independent exact target

5.5 compared its candidate with the default estimator (two estimators sharing the engine). 5.6 compares **every** estimator, the default included, with the quantity it is supposed to estimate, computed by different code: `source/tools/independent_cfr56.py` enumerates every compatible hand tuple and every board card in Python, with the betting rules, side pots and seven-card evaluator of the independent best-response checker, applies regret matching to the frozen regrets, and computes the exact counterfactual regret and reach-weighted strategy increment of every table entry. `source/tests/enum56.cpp` measures the Monte Carlo mean of the engine's increments against the same frozen table.

| Game | Estimator | Deals | Entries tested | Regret: max abs z, rms z | Average: max abs z, rms z | Bonferroni critical z | Deterministic mismatches | State visits per deal | Result |
|---|---|---|---|---|---|---|---|---|---|
| hu-river | none | 20,000,000 | 157 | 2.54, 0.89 | 1.98, 0.87 | 3.60 | 0 | 15.1 | pass |
| hu-river | river | 20,000,000 | 156 | 2.23, 0.96 | 1.20, 0.63 | 3.60 | 0 | 42.0 | pass |
| hu-river | river-shared | 20,000,000 | 156 | 1.81, 0.89 | 1.39, 0.60 | 3.60 | 0 | 21.0 | pass |
| hu-river | river-cross | 20,000,000 | 156 | 2.94, 1.25 | 2.90, 1.59 | 3.60 | 0 | 21.0 | pass |
| river3-chip | none | 10,000,000 | 179 | 2.30, 0.97 | 3.18, 1.07 | 3.63 | 0 | 26.9 | pass |
| river3-chip | river | 10,000,000 | 179 | 2.67, 1.06 | 1.83, 0.99 | 3.63 | 0 | 174.0 | pass |
| river3-chip | river-cross | 10,000,000 | 179 | 2.54, 1.08 | 2.45, 1.07 | 3.63 | 0 | 58.0 | pass |
| hu-turn | none | 30,000,000 | 1419 | 3.40, 1.00 | 3.13, 0.98 | 4.14 | 0 | 16.8 | pass |
| hu-turn | river | 10,000,000 | 1337 | 2.81, 0.96 | 3.74, 1.02 | 4.12 | 0 | 21.8 | pass |
| hu-turn | river-cross | 10,000,000 | 1337 | 3.28, 1.02 | 3.17, 1.04 | 4.12 | 0 | 21.8 | pass |
| turn4 | none | 10,000,000 | 1236 | 3.19, 0.99 | 3.57, 0.99 | 4.10 | 0 | 43.0 | pass |
| turn4 | river | 5,000,000 | 3817 | 2.76, 1.00 | 3.41, 0.98 | 4.36 | 0 | 99.1 | pass |
| turn4 | river-cross | 5,000,000 | 4369 | 3.36, 0.99 | 4.11, 0.99 | 4.39 | 0 | 99.1 | pass |

- Same deal, same frozen table, `river` against `river-shared` on river3-chip: 12,453,696 entries compared over 500,000 deals, largest relative difference 0.
- Same deal, same frozen table, `river` against `river-shared` on hu-river: 20,060,440 entries compared over 1,000,000 deals, largest relative difference 0.

A z statistic compares the Monte Carlo mean with the exact target in units of its standard error; a bias would make it grow with the square root of the number of deals. The root-mean-square z should be near 1. Entries touched by fewer than 500 deals are not tested (their standard error is not estimable) and are listed in the per-game reports. This is a statistical check at the stated resolution, not a proof. The default estimator's increments are heavy-tailed on the multi-street games (importance weights up to 1/0.05 per sampled decision): in development a 400,000-deal run showed a z of 12 on the heads-up turn game that fell to 4.4 at 2 million and 3.4 at 30 million deals of the same stream, which is why the formal runs are long.

## The fixed plan

Written to `plan.json` before any measurement (`validation/5.6/convergence/main/plans/`), by `source/tools/research56.py`, which refuses to reuse an output directory.

- **Games** (exact all-seat best response is feasible in each): hu-river (heads-up river); hu-turn (heads-up turn and river); river3-chip (three-player river with side pots); turn4 (four-player turn and river); flop6 (six-player (multiway) flop, all-in or fold); final8 (eight-handed ICM final table, push/fold); bubble4 (four-player ICM bubble, push/fold).
- **Arms**: `baseline55` = 5.5 binary, default trainer; `river55` = 5.5 binary, {"opponentEnumeration": "river"}; `default56` = 5.6 binary, default trainer; `river56` = 5.6 binary, {"opponentEnumeration": "river"}; `cross56` = 5.6 binary, {"opponentEnumeration": "river-cross"}.
- **Seeds**: 60 paired training seeds (1001-1060). Budgets: 4000, 20000, 100000 sampled deals; 0.1, 0.5 seconds of training. One training thread, 128 MiB.
- **Evaluation**: exact all-seat best response (NashConv inside the abstraction; with more than two players it is not exploitability), CPU, 5.6 binary, separate process from training.
- **Primary metric**: paired difference of exact NashConv at the largest equal-wall-clock training budget (0.5 s).
- **Primary family**: default56 vs baseline55 and cross56 vs default56 at 0.5 s in each of the 7 games: 14 contrasts, Bonferroni over 14.
- **Secondary family**: all 4 declared contrasts x 7 games x 5 budgets = 140, Bonferroni over 140 (reported for every contrast; the two descriptive replications use the same penalty).
- **Tests**: exact two-sided sign test on the paired differences (distribution-free for the median) AND paired Student-t interval (model-based), each Bonferroni-adjusted over the stated family; "better"/"worse" needs both on the same side; pairs with equal NashConv are "identical".
- **Stopping rule**: fixed: every arm x budget x seed of the plan is run once; no interim analysis; a failed process aborts the run and the directory is kept as it is.
- **Claim rule for the default trainer**: The 5.6 default trainer is reported as closer to equilibrium at equal time on a game only where default56 vs baseline55 is "better" in the primary family. At equal deals default56 must reproduce baseline55 exactly (identical NashConv and identical checkpoint files); any difference is a defect.
- **Promotion rule**: cross56 replaces the default trainer only if ALL hold: (P1) the independent expected-increment check (independent_cfr56.py) passes for river-cross on hu-river, river3-chip, hu-turn and turn4; (P2) cross56 vs default56 is "better" in the primary family in every game where it changes the traversal (hu-river, hu-turn, river3-chip, turn4); (P3) cross56 vs default56 is "worse" in no contrast of the secondary family, and in the games it does not change (flop6, final8, bubble4) its equal-deal checkpoints are identical to default56 in every table byte (the state file without its JSON header, which carries a study id derived from the trainer options); (P4) regression limit: at no equal-time budget of any game is the mean NashConv of cross56 more than 5% above that of default56; (P5) deterministic continuation and checkpoint tests pass with the candidate enabled. Otherwise the default is unchanged and the candidate stays opt-in.
- **Pilot**: Before this plan was written, single-seed pilot runs (seed 901, 50,000 deals, all five games then available) were looked at to check that the candidates run; they are kept in validation/5.6/convergence/pilot and their seeds are not reused here.
- **Limitations stated in the plan**: Small games with exact evaluation only. NashConv is exact inside each abstraction. Equal-time budgets are wall-clock on a shared four-core container, with up to two game streams running at once on separate cores: timing noise enters those contrasts but is spread over the rotated arm order.

10500 checkpoints were trained and evaluated (7 games x 60 seeds x 5 arms x 5 budgets). The plan ran once, to its end, in two processes (four games and three games) on separate cores. Every row is in `validation/5.6/convergence/main/raw-merged.jsonl`.

## Results

### 5.6 default against the 5.5 default (the engine)

| Game | Budget | baseline55 NashConv | default56 NashConv | Ratio | Simultaneous t interval of the difference | Seeds lower / higher | Sign test p (Bonferroni) | Sampled deals, reference / candidate | Verdict (all 140 contrasts) | Primary verdict (14 contrasts) |
|---|---|---|---|---|---|---|---|---|---|---|
| hu-river | 4000 deals | 0.7397 | 0.7397 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |  |
| hu-river | 20000 deals | 0.3312 | 0.3312 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |  |
| hu-river | 100000 deals | 0.1268 | 0.1268 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |  |
| hu-river | 0.1 s | 0.1478 | 0.0949 | 0.64 | [-0.0733, -0.0325] | 54 / 6 | 1.4e-08 | 77292 / 167251 | **better** |  |
| hu-river | 0.5 s | 0.06027 | 0.04199 | 0.70 | [-0.0288, -0.00772] | 50 / 10 | 2.3e-05 | 385046 / 834288 | **better** | **better** |
| hu-turn | 4000 deals | 0.8504 | 0.8504 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |  |
| hu-turn | 20000 deals | 0.3606 | 0.3606 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |  |
| hu-turn | 100000 deals | 0.1567 | 0.1567 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |  |
| hu-turn | 0.1 s | 0.1916 | 0.1389 | 0.72 | [-0.0649, -0.0406] | 58 / 2 | 4.4e-13 | 68982 / 129989 | **better** |  |
| hu-turn | 0.5 s | 0.08781 | 0.06483 | 0.74 | [-0.0289, -0.0171] | 58 / 2 | 4.4e-13 | 343320 / 657359 | **better** | **better** |
| river3-chip | 4000 deals | 0.3403 | 0.3403 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |  |
| river3-chip | 20000 deals | 0.141 | 0.141 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |  |
| river3-chip | 100000 deals | 0.05742 | 0.05742 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |  |
| river3-chip | 0.1 s | 0.08393 | 0.05984 | 0.71 | [-0.039, -0.0092] | 49 / 11 | 0.00011 | 51892 / 99141 | **better** |  |
| river3-chip | 0.5 s | 0.0354 | 0.02526 | 0.71 | [-0.0154, -0.00486] | 48 / 12 | 0.00045 | 257809 / 499521 | **better** | **better** |
| turn4 | 4000 deals | 2.763 | 2.763 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |  |
| turn4 | 20000 deals | 0.1073 | 0.1073 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |  |
| turn4 | 100000 deals | 0.002214 | 0.002214 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |  |
| turn4 | 0.1 s | 0.03044 | 0.006063 | 0.20 | [-0.0409, -0.00785] | 60 / 0 | 2.4e-16 | 32827 / 60934 | **better** |  |
| turn4 | 0.5 s | 0.0008009 | 0.0002189 | 0.27 | [-0.000794, -0.00037] | 60 / 0 | 2.4e-16 | 166986 / 317338 | **better** | **better** |
| flop6 | 4000 deals | 1.369 | 1.369 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |  |
| flop6 | 20000 deals | 0.3349 | 0.3349 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |  |
| flop6 | 100000 deals | 0.1082 | 0.1082 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |  |
| flop6 | 0.1 s | 0.4007 | 0.2348 | 0.59 | [-0.253, -0.0786] | 53 / 7 | 1.1e-07 | 16596 / 32050 | **better** |  |
| flop6 | 0.5 s | 0.1204 | 0.08443 | 0.70 | [-0.0846, 0.0127] | 40 / 20 | 1 | 86052 / 169845 | **unresolved** | **unresolved** |
| final8 | 4000 deals | 0.08962 | 0.08962 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |  |
| final8 | 20000 deals | 0.003142 | 0.003142 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |  |
| final8 | 100000 deals | 0.0001218 | 0.0001218 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |  |
| final8 | 0.1 s | 0.01176 | 0.003401 | 0.29 | [-0.0156, -0.00108] | 60 / 0 | 2.4e-16 | 10918 / 20995 | **better** |  |
| final8 | 0.5 s | 0.0003782 | 9.665e-05 | 0.26 | [-0.000498, -6.5e-05] | 60 / 0 | 2.4e-16 | 54488 / 111134 | **better** | **better** |
| bubble4 | 4000 deals | 0.05244 | 0.05244 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |  |
| bubble4 | 20000 deals | 0.004098 | 0.004098 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |  |
| bubble4 | 100000 deals | 0.0001648 | 0.0001648 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |  |
| bubble4 | 0.1 s | 0.000814 | 0.0002936 | 0.36 | [-0.000983, -5.81e-05] | 60 / 0 | 2.4e-16 | 45924 / 77322 | **better** |  |
| bubble4 | 0.5 s | 3.257e-05 | 1.148e-05 | 0.35 | [-3.78e-05, -4.34e-06] | 60 / 0 | 2.4e-16 | 224190 / 381965 | **better** | **better** |

At equal deals every pair is identical (0 seeds lower, 0 higher) and every checkpoint file is the same: hu-river yes, hu-turn yes, river3-chip yes, turn4 yes, flop6 yes, final8 yes, bubble4 yes.

### 5.6 candidate (river-cross) against the 5.6 default (promotion)

| Game | Budget | default56 NashConv | cross56 NashConv | Ratio | Simultaneous t interval of the difference | Seeds lower / higher | Sign test p (Bonferroni) | Sampled deals, reference / candidate | Verdict (all 140 contrasts) | Primary verdict (14 contrasts) |
|---|---|---|---|---|---|---|---|---|---|---|
| hu-river | 4000 deals | 0.7397 | 0.533 | 0.72 | [-0.281, -0.133] | 54 / 6 | 1.4e-08 | 4000 / 4000 | **better** |  |
| hu-river | 20000 deals | 0.3312 | 0.217 | 0.66 | [-0.155, -0.0736] | 55 / 5 | 1.5e-09 | 20000 / 20000 | **better** |  |
| hu-river | 100000 deals | 0.1268 | 0.0856 | 0.68 | [-0.059, -0.0234] | 55 / 5 | 1.5e-09 | 100000 / 100000 | **better** |  |
| hu-river | 0.1 s | 0.0949 | 0.0884 | 0.93 | [-0.0221, 0.00916] | 35 / 25 | 1 | 167251 / 105977 | **unresolved** |  |
| hu-river | 0.5 s | 0.04199 | 0.03523 | 0.84 | [-0.0152, 0.00163] | 38 / 22 | 1 | 834288 / 513879 | **unresolved** | **unresolved** |
| hu-turn | 4000 deals | 0.8504 | 0.7075 | 0.83 | [-0.204, -0.0814] | 52 / 8 | 7.3e-07 | 4000 / 4000 | **better** |  |
| hu-turn | 20000 deals | 0.3606 | 0.3003 | 0.83 | [-0.0846, -0.0361] | 54 / 6 | 1.4e-08 | 20000 / 20000 | **better** |  |
| hu-turn | 100000 deals | 0.1567 | 0.1326 | 0.85 | [-0.0352, -0.0129] | 50 / 10 | 2.3e-05 | 100000 / 100000 | **better** |  |
| hu-turn | 0.1 s | 0.1389 | 0.1397 | 1.01 | [-0.0127, 0.0144] | 24 / 36 | 1 | 129989 / 93499 | **unresolved** |  |
| hu-turn | 0.5 s | 0.06483 | 0.063 | 0.97 | [-0.00833, 0.00467] | 31 / 29 | 1 | 657359 / 464104 | **unresolved** | **unresolved** |
| river3-chip | 4000 deals | 0.3403 | 0.256 | 0.75 | [-0.128, -0.0409] | 49 / 11 | 0.00011 | 4000 / 4000 | **better** |  |
| river3-chip | 20000 deals | 0.141 | 0.09986 | 0.71 | [-0.0628, -0.0194] | 49 / 11 | 0.00011 | 20000 / 20000 | **better** |  |
| river3-chip | 100000 deals | 0.05742 | 0.04392 | 0.76 | [-0.0221, -0.00487] | 49 / 11 | 0.00011 | 100000 / 100000 | **better** |  |
| river3-chip | 0.1 s | 0.05984 | 0.0728 | 1.22 | [0.000166, 0.0258] | 18 / 42 | 0.37 | 99141 / 34813 | **unresolved** |  |
| river3-chip | 0.5 s | 0.02526 | 0.0325 | 1.29 | [0.00116, 0.0133] | 15 / 45 | 0.019 | 499521 / 172467 | **worse** | **worse** |
| turn4 | 4000 deals | 2.763 | 0.04542 | 0.02 | [-2.89, -2.54] | 60 / 0 | 2.4e-16 | 4000 / 4000 | **better** |  |
| turn4 | 20000 deals | 0.1073 | 0.002109 | 0.02 | [-0.144, -0.0662] | 60 / 0 | 2.4e-16 | 20000 / 20000 | **better** |  |
| turn4 | 100000 deals | 0.002214 | 9.53e-05 | 0.04 | [-0.00285, -0.00138] | 60 / 0 | 2.4e-16 | 100000 / 100000 | **better** |  |
| turn4 | 0.1 s | 0.006063 | 0.002344 | 0.39 | [-0.00591, -0.00153] | 57 / 3 | 8.8e-12 | 60934 / 18838 | **better** |  |
| turn4 | 0.5 s | 0.0002189 | 9.957e-05 | 0.45 | [-0.000209, -2.94e-05] | 56 / 4 | 1.3e-10 | 317338 / 98219 | **better** | **better** |
| flop6 | 4000 deals | 1.369 | 1.369 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |  |
| flop6 | 20000 deals | 0.3349 | 0.3349 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |  |
| flop6 | 100000 deals | 0.1082 | 0.1082 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |  |
| flop6 | 0.1 s | 0.2348 | 0.2678 | 1.14 | [-0.00507, 0.0711] | 16 / 44 | 0.055 | 32050 / 30251 | **unresolved** |  |
| flop6 | 0.5 s | 0.08443 | 0.08052 | 0.95 | [-0.0163, 0.00846] | 32 / 28 | 1 | 169845 / 158250 | **unresolved** | **unresolved** |
| final8 | 4000 deals | 0.08962 | 0.08962 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |  |
| final8 | 20000 deals | 0.003142 | 0.003142 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |  |
| final8 | 100000 deals | 0.0001218 | 0.0001218 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |  |
| final8 | 0.1 s | 0.003401 | 0.002762 | 0.81 | [-0.00198, 0.000699] | 28 / 32 | 1 | 20995 / 21212 | **unresolved** |  |
| final8 | 0.5 s | 9.665e-05 | 0.0001053 | 1.09 | [-3.86e-06, 2.12e-05] | 18 / 42 | 0.37 | 111134 / 107821 | **unresolved** | **unresolved** |
| bubble4 | 4000 deals | 0.05244 | 0.05244 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |  |
| bubble4 | 20000 deals | 0.004098 | 0.004098 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |  |
| bubble4 | 100000 deals | 0.0001648 | 0.0001648 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |  |
| bubble4 | 0.1 s | 0.0002936 | 0.000314 | 1.07 | [-0.000107, 0.000148] | 25 / 35 | 1 | 77322 / 76443 | **unresolved** |  |
| bubble4 | 0.5 s | 1.148e-05 | 1.133e-05 | 0.99 | [-1.58e-06, 1.28e-06] | 27 / 33 | 1 | 381965 / 379374 | **unresolved** | **unresolved** |

### 5.6 candidate against the 5.5 default

| Game | Budget | baseline55 NashConv | cross56 NashConv | Ratio | Simultaneous t interval of the difference | Seeds lower / higher | Sign test p (Bonferroni) | Sampled deals, reference / candidate | Verdict (all 140 contrasts) |
|---|---|---|---|---|---|---|---|---|---|
| hu-river | 4000 deals | 0.7397 | 0.533 | 0.72 | [-0.281, -0.133] | 54 / 6 | 1.4e-08 | 4000 / 4000 | **better** |
| hu-river | 20000 deals | 0.3312 | 0.217 | 0.66 | [-0.155, -0.0736] | 55 / 5 | 1.5e-09 | 20000 / 20000 | **better** |
| hu-river | 100000 deals | 0.1268 | 0.0856 | 0.68 | [-0.059, -0.0234] | 55 / 5 | 1.5e-09 | 100000 / 100000 | **better** |
| hu-river | 0.1 s | 0.1478 | 0.0884 | 0.60 | [-0.0823, -0.0366] | 57 / 3 | 8.8e-12 | 77292 / 105977 | **better** |
| hu-river | 0.5 s | 0.06027 | 0.03523 | 0.58 | [-0.0334, -0.0167] | 57 / 3 | 8.8e-12 | 385046 / 513879 | **better** |
| hu-turn | 4000 deals | 0.8504 | 0.7075 | 0.83 | [-0.204, -0.0814] | 52 / 8 | 7.3e-07 | 4000 / 4000 | **better** |
| hu-turn | 20000 deals | 0.3606 | 0.3003 | 0.83 | [-0.0846, -0.0361] | 54 / 6 | 1.4e-08 | 20000 / 20000 | **better** |
| hu-turn | 100000 deals | 0.1567 | 0.1326 | 0.85 | [-0.0352, -0.0129] | 50 / 10 | 2.3e-05 | 100000 / 100000 | **better** |
| hu-turn | 0.1 s | 0.1916 | 0.1397 | 0.73 | [-0.066, -0.0378] | 58 / 2 | 4.4e-13 | 68982 / 93499 | **better** |
| hu-turn | 0.5 s | 0.08781 | 0.063 | 0.72 | [-0.0306, -0.019] | 59 / 1 | 1.5e-14 | 343320 / 464104 | **better** |
| river3-chip | 4000 deals | 0.3403 | 0.256 | 0.75 | [-0.128, -0.0409] | 49 / 11 | 0.00011 | 4000 / 4000 | **better** |
| river3-chip | 20000 deals | 0.141 | 0.09986 | 0.71 | [-0.0628, -0.0194] | 49 / 11 | 0.00011 | 20000 / 20000 | **better** |
| river3-chip | 100000 deals | 0.05742 | 0.04392 | 0.76 | [-0.0221, -0.00487] | 49 / 11 | 0.00011 | 100000 / 100000 | **better** |
| river3-chip | 0.1 s | 0.08393 | 0.0728 | 0.87 | [-0.0243, 0.00206] | 42 / 18 | 0.37 | 51892 / 34813 | **unresolved** |
| river3-chip | 0.5 s | 0.0354 | 0.0325 | 0.92 | [-0.00956, 0.00376] | 38 / 22 | 1 | 257809 / 172467 | **unresolved** |
| turn4 | 4000 deals | 2.763 | 0.04542 | 0.02 | [-2.89, -2.54] | 60 / 0 | 2.4e-16 | 4000 / 4000 | **better** |
| turn4 | 20000 deals | 0.1073 | 0.002109 | 0.02 | [-0.144, -0.0662] | 60 / 0 | 2.4e-16 | 20000 / 20000 | **better** |
| turn4 | 100000 deals | 0.002214 | 9.53e-05 | 0.04 | [-0.00285, -0.00138] | 60 / 0 | 2.4e-16 | 100000 / 100000 | **better** |
| turn4 | 0.1 s | 0.03044 | 0.002344 | 0.08 | [-0.0459, -0.0103] | 60 / 0 | 2.4e-16 | 32827 / 18838 | **better** |
| turn4 | 0.5 s | 0.0008009 | 9.957e-05 | 0.12 | [-0.000987, -0.000416] | 59 / 1 | 1.5e-14 | 166986 / 98219 | **better** |
| flop6 | 4000 deals | 1.369 | 1.369 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| flop6 | 20000 deals | 0.3349 | 0.3349 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| flop6 | 100000 deals | 0.1082 | 0.1082 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| flop6 | 0.1 s | 0.4007 | 0.2678 | 0.67 | [-0.229, -0.037] | 52 / 8 | 7.3e-07 | 16596 / 30251 | **better** |
| flop6 | 0.5 s | 0.1204 | 0.08052 | 0.67 | [-0.0897, 0.0099] | 44 / 16 | 0.055 | 86052 / 158250 | **unresolved** |
| final8 | 4000 deals | 0.08962 | 0.08962 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| final8 | 20000 deals | 0.003142 | 0.003142 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| final8 | 100000 deals | 0.0001218 | 0.0001218 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| final8 | 0.1 s | 0.01176 | 0.002762 | 0.23 | [-0.0169, -0.00108] | 60 / 0 | 2.4e-16 | 10918 / 21212 | **better** |
| final8 | 0.5 s | 0.0003782 | 0.0001053 | 0.28 | [-0.000481, -6.49e-05] | 60 / 0 | 2.4e-16 | 54488 / 107821 | **better** |
| bubble4 | 4000 deals | 0.05244 | 0.05244 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| bubble4 | 20000 deals | 0.004098 | 0.004098 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| bubble4 | 100000 deals | 0.0001648 | 0.0001648 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| bubble4 | 0.1 s | 0.000814 | 0.000314 | 0.39 | [-0.000922, -7.83e-05] | 60 / 0 | 2.4e-16 | 45924 / 76443 | **better** |
| bubble4 | 0.5 s | 3.257e-05 | 1.133e-05 | 0.35 | [-3.85e-05, -3.93e-06] | 60 / 0 | 2.4e-16 | 224190 / 379374 | **better** |

### 5.6 candidate against the 5.5 experimental river enumeration

| Game | Budget | river55 NashConv | cross56 NashConv | Ratio | Simultaneous t interval of the difference | Seeds lower / higher | Sign test p (Bonferroni) | Sampled deals, reference / candidate | Verdict (all 140 contrasts) |
|---|---|---|---|---|---|---|---|---|---|
| hu-river | 4000 deals | 0.4618 | 0.533 | 1.15 | [0.016, 0.127] | 17 / 43 | 0.15 | 4000 / 4000 | **unresolved** |
| hu-river | 20000 deals | 0.2017 | 0.217 | 1.08 | [-0.00663, 0.0372] | 20 / 40 | 1 | 20000 / 20000 | **unresolved** |
| hu-river | 100000 deals | 0.08287 | 0.0856 | 1.03 | [-0.00756, 0.013] | 27 / 33 | 1 | 100000 / 100000 | **unresolved** |
| hu-river | 0.1 s | 0.1407 | 0.0884 | 0.63 | [-0.0666, -0.0379] | 56 / 4 | 1.3e-10 | 37942 / 105977 | **better** |
| hu-river | 0.5 s | 0.05736 | 0.03523 | 0.61 | [-0.0289, -0.0154] | 56 / 4 | 1.3e-10 | 190804 / 513879 | **better** |
| hu-turn | 4000 deals | 0.692 | 0.7075 | 1.02 | [-0.0439, 0.075] | 25 / 35 | 1 | 4000 / 4000 | **unresolved** |
| hu-turn | 20000 deals | 0.2843 | 0.3003 | 1.06 | [-0.0109, 0.0429] | 22 / 38 | 1 | 20000 / 20000 | **unresolved** |
| hu-turn | 100000 deals | 0.1266 | 0.1326 | 1.05 | [-0.00537, 0.0175] | 24 / 36 | 1 | 100000 / 100000 | **unresolved** |
| hu-turn | 0.1 s | 0.1665 | 0.1397 | 0.84 | [-0.0379, -0.0156] | 53 / 7 | 1.1e-07 | 58135 / 93499 | **better** |
| hu-turn | 0.5 s | 0.07175 | 0.063 | 0.88 | [-0.0142, -0.00331] | 47 / 13 | 0.0017 | 292563 / 464104 | **better** |
| river3-chip | 4000 deals | 0.1936 | 0.256 | 1.32 | [0.0322, 0.0926] | 8 / 52 | 7.3e-07 | 4000 / 4000 | **worse** |
| river3-chip | 20000 deals | 0.08489 | 0.09986 | 1.18 | [0.00111, 0.0288] | 15 / 45 | 0.019 | 20000 / 20000 | **worse** |
| river3-chip | 100000 deals | 0.03458 | 0.04392 | 1.27 | [0.00261, 0.0161] | 14 / 46 | 0.0059 | 100000 / 100000 | **worse** |
| river3-chip | 0.1 s | 0.1078 | 0.0728 | 0.68 | [-0.0493, -0.0208] | 52 / 8 | 7.3e-07 | 11891 / 34813 | **better** |
| river3-chip | 0.5 s | 0.04529 | 0.0325 | 0.72 | [-0.0206, -0.00498] | 48 / 12 | 0.00045 | 60125 / 172467 | **better** |
| turn4 | 4000 deals | 0.2391 | 0.04542 | 0.19 | [-0.267, -0.121] | 58 / 2 | 4.4e-13 | 4000 / 4000 | **better** |
| turn4 | 20000 deals | 0.005345 | 0.002109 | 0.39 | [-0.00547, -0.001] | 54 / 6 | 1.4e-08 | 20000 / 20000 | **better** |
| turn4 | 100000 deals | 0.0003024 | 9.53e-05 | 0.32 | [-0.00046, 4.63e-05] | 53 / 7 | 1.1e-07 | 100000 / 100000 | **unresolved** |
| turn4 | 0.1 s | 0.01102 | 0.002344 | 0.21 | [-0.0144, -0.00292] | 57 / 3 | 8.8e-12 | 14345 / 18838 | **better** |
| turn4 | 0.5 s | 0.0004357 | 9.957e-05 | 0.23 | [-0.000554, -0.000119] | 57 / 3 | 8.8e-12 | 75473 / 98219 | **better** |
| flop6 | 4000 deals | 1.369 | 1.369 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| flop6 | 20000 deals | 0.3349 | 0.3349 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| flop6 | 100000 deals | 0.1082 | 0.1082 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| flop6 | 0.1 s | 0.4328 | 0.2678 | 0.62 | [-0.27, -0.0601] | 52 / 8 | 7.3e-07 | 15958 / 30251 | **better** |
| flop6 | 0.5 s | 0.1197 | 0.08052 | 0.67 | [-0.0868, 0.00833] | 45 / 15 | 0.019 | 85784 / 158250 | **unresolved** |
| final8 | 4000 deals | 0.08962 | 0.08962 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| final8 | 20000 deals | 0.003142 | 0.003142 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| final8 | 100000 deals | 0.0001218 | 0.0001218 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| final8 | 0.1 s | 0.01159 | 0.002762 | 0.24 | [-0.017, -0.000603] | 60 / 0 | 2.4e-16 | 10735 / 21212 | **better** |
| final8 | 0.5 s | 0.0003972 | 0.0001053 | 0.27 | [-0.000572, -1.19e-05] | 60 / 0 | 2.4e-16 | 55693 / 107821 | **better** |
| bubble4 | 4000 deals | 0.05244 | 0.05244 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| bubble4 | 20000 deals | 0.004098 | 0.004098 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| bubble4 | 100000 deals | 0.0001648 | 0.0001648 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| bubble4 | 0.1 s | 0.0007993 | 0.000314 | 0.39 | [-0.000819, -0.000152] | 60 / 0 | 2.4e-16 | 45638 / 76443 | **better** |
| bubble4 | 0.5 s | 3.267e-05 | 1.133e-05 | 0.35 | [-3.82e-05, -4.51e-06] | 60 / 0 | 2.4e-16 | 224808 / 379374 | **better** |

### Descriptive replications (same Bonferroni penalty; not part of the declared family)

5.5's river enumeration against the 5.5 default (the 5.5 comparison, repeated with 60 fresh seeds):

| Game | Budget | baseline55 NashConv | river55 NashConv | Ratio | Simultaneous t interval of the difference | Seeds lower / higher | Sign test p (Bonferroni) | Sampled deals, reference / candidate | Verdict (all 140 contrasts) |
|---|---|---|---|---|---|---|---|---|---|
| hu-river | 4000 deals | 0.7397 | 0.4618 | 0.62 | [-0.347, -0.209] | 60 / 0 | 2.4e-16 | 4000 / 4000 | **better** |
| hu-river | 20000 deals | 0.3312 | 0.2017 | 0.61 | [-0.17, -0.0895] | 58 / 2 | 4.4e-13 | 20000 / 20000 | **better** |
| hu-river | 100000 deals | 0.1268 | 0.08287 | 0.65 | [-0.0629, -0.025] | 56 / 4 | 1.3e-10 | 100000 / 100000 | **better** |
| hu-river | 0.1 s | 0.1478 | 0.1407 | 0.95 | [-0.0275, 0.0132] | 35 / 25 | 1 | 77292 / 37942 | **unresolved** |
| hu-river | 0.5 s | 0.06027 | 0.05736 | 0.95 | [-0.0117, 0.00588] | 30 / 30 | 1 | 385046 / 190804 | **unresolved** |
| hu-turn | 4000 deals | 0.8504 | 0.692 | 0.81 | [-0.206, -0.111] | 56 / 4 | 1.3e-10 | 4000 / 4000 | **better** |
| hu-turn | 20000 deals | 0.3606 | 0.2843 | 0.79 | [-0.104, -0.0488] | 55 / 5 | 1.5e-09 | 20000 / 20000 | **better** |
| hu-turn | 100000 deals | 0.1567 | 0.1266 | 0.81 | [-0.0408, -0.0194] | 54 / 6 | 1.4e-08 | 100000 / 100000 | **better** |
| hu-turn | 0.1 s | 0.1916 | 0.1665 | 0.87 | [-0.0394, -0.011] | 52 / 8 | 7.3e-07 | 68982 / 58135 | **better** |
| hu-turn | 0.5 s | 0.08781 | 0.07175 | 0.82 | [-0.0227, -0.00945] | 50 / 10 | 2.3e-05 | 343320 / 292563 | **better** |
| river3-chip | 4000 deals | 0.3403 | 0.1936 | 0.57 | [-0.19, -0.104] | 60 / 0 | 2.4e-16 | 4000 / 4000 | **better** |
| river3-chip | 20000 deals | 0.141 | 0.08489 | 0.60 | [-0.0756, -0.0365] | 55 / 5 | 1.5e-09 | 20000 / 20000 | **better** |
| river3-chip | 100000 deals | 0.05742 | 0.03458 | 0.60 | [-0.0312, -0.0145] | 57 / 3 | 8.8e-12 | 100000 / 100000 | **better** |
| river3-chip | 0.1 s | 0.08393 | 0.1078 | 1.28 | [0.00774, 0.0401] | 15 / 45 | 0.019 | 51892 / 11891 | **worse** |
| river3-chip | 0.5 s | 0.0354 | 0.04529 | 1.28 | [0.00196, 0.0178] | 16 / 44 | 0.055 | 257809 / 60125 | **unresolved** |
| turn4 | 4000 deals | 2.763 | 0.2391 | 0.09 | [-2.7, -2.34] | 60 / 0 | 2.4e-16 | 4000 / 4000 | **better** |
| turn4 | 20000 deals | 0.1073 | 0.005345 | 0.05 | [-0.141, -0.0626] | 60 / 0 | 2.4e-16 | 20000 / 20000 | **better** |
| turn4 | 100000 deals | 0.002214 | 0.0003024 | 0.14 | [-0.0027, -0.00112] | 58 / 2 | 4.4e-13 | 100000 / 100000 | **better** |
| turn4 | 0.1 s | 0.03044 | 0.01102 | 0.36 | [-0.0384, -0.000448] | 53 / 7 | 1.1e-07 | 32827 / 14345 | **better** |
| turn4 | 0.5 s | 0.0008009 | 0.0004357 | 0.54 | [-0.00073, -3.91e-08] | 49 / 11 | 0.00011 | 166986 / 75473 | **better** |
| flop6 | 4000 deals | 1.369 | 1.369 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| flop6 | 20000 deals | 0.3349 | 0.3349 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| flop6 | 100000 deals | 0.1082 | 0.1082 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| flop6 | 0.1 s | 0.4007 | 0.4328 | 1.08 | [-0.0272, 0.0913] | 26 / 34 | 1 | 16596 / 15958 | **unresolved** |
| flop6 | 0.5 s | 0.1204 | 0.1197 | 0.99 | [-0.024, 0.0227] | 29 / 31 | 1 | 86052 / 85784 | **unresolved** |
| final8 | 4000 deals | 0.08962 | 0.08962 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| final8 | 20000 deals | 0.003142 | 0.003142 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| final8 | 100000 deals | 0.0001218 | 0.0001218 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| final8 | 0.1 s | 0.01176 | 0.01159 | 0.99 | [-0.00509, 0.00474] | 31 / 29 | 1 | 10918 / 10735 | **unresolved** |
| final8 | 0.5 s | 0.0003782 | 0.0003972 | 1.05 | [-9.82e-05, 0.000136] | 30 / 30 | 1 | 54488 / 55693 | **unresolved** |
| bubble4 | 4000 deals | 0.05244 | 0.05244 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| bubble4 | 20000 deals | 0.004098 | 0.004098 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| bubble4 | 100000 deals | 0.0001648 | 0.0001648 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| bubble4 | 0.1 s | 0.000814 | 0.0007993 | 0.98 | [-0.000239, 0.00021] | 31 / 29 | 1 | 45924 / 45638 | **unresolved** |
| bubble4 | 0.5 s | 3.257e-05 | 3.267e-05 | 1.00 | [-3.03e-06, 3.24e-06] | 35 / 25 | 1 | 224190 / 224808 | **unresolved** |

5.5's river enumeration on the 5.6 engine against the 5.6 default:

| Game | Budget | default56 NashConv | river56 NashConv | Ratio | Simultaneous t interval of the difference | Seeds lower / higher | Sign test p (Bonferroni) | Sampled deals, reference / candidate | Verdict (all 140 contrasts) |
|---|---|---|---|---|---|---|---|---|---|
| hu-river | 4000 deals | 0.7397 | 0.4618 | 0.62 | [-0.347, -0.209] | 60 / 0 | 2.4e-16 | 4000 / 4000 | **better** |
| hu-river | 20000 deals | 0.3312 | 0.2017 | 0.61 | [-0.17, -0.0895] | 58 / 2 | 4.4e-13 | 20000 / 20000 | **better** |
| hu-river | 100000 deals | 0.1268 | 0.08287 | 0.65 | [-0.0629, -0.025] | 56 / 4 | 1.3e-10 | 100000 / 100000 | **better** |
| hu-river | 0.1 s | 0.0949 | 0.0919 | 0.97 | [-0.0174, 0.0114] | 32 / 28 | 1 | 167251 / 85370 | **unresolved** |
| hu-river | 0.5 s | 0.04199 | 0.03764 | 0.90 | [-0.014, 0.00528] | 32 / 28 | 1 | 834288 / 419641 | **unresolved** |
| hu-turn | 4000 deals | 0.8504 | 0.692 | 0.81 | [-0.206, -0.111] | 56 / 4 | 1.3e-10 | 4000 / 4000 | **better** |
| hu-turn | 20000 deals | 0.3606 | 0.2843 | 0.79 | [-0.104, -0.0488] | 55 / 5 | 1.5e-09 | 20000 / 20000 | **better** |
| hu-turn | 100000 deals | 0.1567 | 0.1266 | 0.81 | [-0.0408, -0.0194] | 54 / 6 | 1.4e-08 | 100000 / 100000 | **better** |
| hu-turn | 0.1 s | 0.1389 | 0.1176 | 0.85 | [-0.0338, -0.00872] | 46 / 14 | 0.0059 | 129989 / 114649 | **better** |
| hu-turn | 0.5 s | 0.06483 | 0.05286 | 0.82 | [-0.0174, -0.00659] | 52 / 8 | 7.3e-07 | 657359 / 571697 | **better** |
| river3-chip | 4000 deals | 0.3403 | 0.1936 | 0.57 | [-0.19, -0.104] | 60 / 0 | 2.4e-16 | 4000 / 4000 | **better** |
| river3-chip | 20000 deals | 0.141 | 0.08489 | 0.60 | [-0.0756, -0.0365] | 55 / 5 | 1.5e-09 | 20000 / 20000 | **better** |
| river3-chip | 100000 deals | 0.05742 | 0.03458 | 0.60 | [-0.0312, -0.0145] | 57 / 3 | 8.8e-12 | 100000 / 100000 | **better** |
| river3-chip | 0.1 s | 0.05984 | 0.08184 | 1.37 | [0.0106, 0.0334] | 11 / 49 | 0.00011 | 99141 / 23240 | **worse** |
| river3-chip | 0.5 s | 0.02526 | 0.03152 | 1.25 | [-0.000164, 0.0127] | 20 / 40 | 1 | 499521 / 115222 | **unresolved** |
| turn4 | 4000 deals | 2.763 | 0.2391 | 0.09 | [-2.7, -2.34] | 60 / 0 | 2.4e-16 | 4000 / 4000 | **better** |
| turn4 | 20000 deals | 0.1073 | 0.005345 | 0.05 | [-0.141, -0.0626] | 60 / 0 | 2.4e-16 | 20000 / 20000 | **better** |
| turn4 | 100000 deals | 0.002214 | 0.0003024 | 0.14 | [-0.0027, -0.00112] | 58 / 2 | 4.4e-13 | 100000 / 100000 | **better** |
| turn4 | 0.1 s | 0.006063 | 0.002382 | 0.39 | [-0.00597, -0.00139] | 54 / 6 | 1.4e-08 | 60934 / 30937 | **better** |
| turn4 | 0.5 s | 0.0002189 | 0.0001151 | 0.53 | [-0.000221, 1.33e-05] | 51 / 9 | 4.3e-06 | 317338 / 160882 | **unresolved** |
| flop6 | 4000 deals | 1.369 | 1.369 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| flop6 | 20000 deals | 0.3349 | 0.3349 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| flop6 | 100000 deals | 0.1082 | 0.1082 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| flop6 | 0.1 s | 0.2348 | 0.2425 | 1.03 | [-0.0212, 0.0365] | 31 / 29 | 1 | 32050 / 31550 | **unresolved** |
| flop6 | 0.5 s | 0.08443 | 0.08183 | 0.97 | [-0.0148, 0.00961] | 35 / 25 | 1 | 169845 / 166291 | **unresolved** |
| final8 | 4000 deals | 0.08962 | 0.08962 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| final8 | 20000 deals | 0.003142 | 0.003142 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| final8 | 100000 deals | 0.0001218 | 0.0001218 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| final8 | 0.1 s | 0.003401 | 0.003457 | 1.02 | [-0.00192, 0.00203] | 26 / 34 | 1 | 20995 / 20987 | **unresolved** |
| final8 | 0.5 s | 9.665e-05 | 0.0001145 | 1.19 | [-2.29e-05, 5.86e-05] | 26 / 34 | 1 | 111134 / 107906 | **unresolved** |
| bubble4 | 4000 deals | 0.05244 | 0.05244 | 1.00 | [0, 0] | 0 / 0 | 1 | 4000 / 4000 | **identical** |
| bubble4 | 20000 deals | 0.004098 | 0.004098 | 1.00 | [0, 0] | 0 / 0 | 1 | 20000 / 20000 | **identical** |
| bubble4 | 100000 deals | 0.0001648 | 0.0001648 | 1.00 | [0, 0] | 0 / 0 | 1 | 100000 / 100000 | **identical** |
| bubble4 | 0.1 s | 0.0002936 | 0.0002867 | 0.98 | [-0.000112, 9.8e-05] | 34 / 26 | 1 | 77322 / 77851 | **unresolved** |
| bubble4 | 0.5 s | 1.148e-05 | 1.19e-05 | 1.04 | [-1.86e-06, 2.7e-06] | 30 / 30 | 1 | 381965 / 376966 | **unresolved** |

## Reading

- **Default trainer.** The primary verdict is "better" in 6 of 7 games (hu-river, hu-turn, river3-chip, turn4, final8, bubble4). It is "unresolved" on flop6 (ratio 0.70, lower in 40 of 60 seeds): mean NashConv was lower there too, a larger spread between seeds than the tests allow after adjustment. At 0.1 s the secondary verdicts are: hu-river better, hu-turn better, river3-chip better, turn4 better, flop6 better, final8 better, bubble4 better.
- **Candidate at equal deals** (largest budget): hu-river better (ratio 0.68), hu-turn better (ratio 0.85), river3-chip better (ratio 0.76), turn4 better (ratio 0.04), flop6 identical (ratio 1.00), final8 identical (ratio 1.00), bubble4 identical (ratio 1.00).
- **Candidate at equal time** (0.5 s): hu-river unresolved (ratio 0.84, 62% of the default's deals), hu-turn unresolved (ratio 0.97, 71% of the default's deals), river3-chip worse (ratio 1.29, 35% of the default's deals), turn4 better (ratio 0.45, 31% of the default's deals), flop6 unresolved (ratio 0.95, 93% of the default's deals), final8 unresolved (ratio 1.09, 97% of the default's deals), bubble4 unresolved (ratio 0.99, 99% of the default's deals).
- The candidate needs fewer deals for the same NashConv wherever the final street has betting (better in 12 of 12 equal-deal contrasts against the 5.6 default on those four games), as 5.5's enumeration did, and it costs less per deal than 5.5's enumeration on final-street games (one walk instead of n). At equal time, on those four games, it is better than the 5.5 default in 6 of 8 contrasts and better than 5.5's enumeration in 8 of 8. Against the 5.6 default it is better in 2 of 8 and worse in 1: the default became about twice as fast per deal, because the bookkeeping that 5.6 removed was a larger share of a cheap sampled deal than of an expensive enumerated one.
- On the heads-up turn game the cross-seat updates did not help: at equal deals the candidate was not better than 5.5's plain enumeration on the same engine (`cross56` vs `river55`, and `river56` vs `default56` above), and at equal time 5.5's enumeration on the 5.6 engine did better against the default than the candidate did. The importance weights of the cross-seat updates add variance there. On the four-player turn game they helped.
- Games without final-street betting (the six-player all-in flop, both push/fold ICM games) are not changed by any enumeration; their candidate rows are the default's trajectory measured again (equal-deal table bytes identical: flop6 yes, final8 yes, bubble4 yes), and their equal-time contrasts measure timing noise.

## Decision

**Default trainer.** By the claim rule, the 5.6 default is reported as closer to equilibrium than the 5.5 default at equal wall-clock time on: hu-river, hu-turn, river3-chip, turn4, final8, bubble4. At equal sampled deals it is the 5.5 trainer.

**Promotion of river-cross.**

| Condition | Outcome |
|---|---|
| P1 independent expected-increment check | met |
| P2 "better" than the 5.6 default at 0.5 s in every game it changes | **not met**: hu-river unresolved, hu-turn unresolved, river3-chip worse, turn4 better |
| P3 "worse" in no contrast; unchanged games identical | **not met**; worse in: river3-chip at 0.5 s |
| P4 no equal-time mean NashConv more than 5% above the default | **not met**; above in: river3-chip at 0.1 s (ratio 1.22), river3-chip at 0.5 s (ratio 1.29), flop6 at 0.1 s (ratio 1.14), final8 at 0.5 s (ratio 1.09), bubble4 at 0.1 s (ratio 1.07) |
| P5 deterministic continuation and checkpoint tests with the candidate | met (`source/tests/v56.test.js`; see VALIDATION-5.6.md) |

**Result: the default is unchanged. `river-shared` and `river-cross` remain opt-in experimental settings, like 5.5's `river`.**

No further candidate was tried after these results were seen. P4 as written also flags equal-time ratios above 1.05 in games the candidate does not change (flop6 at 0.1 s: 1.14, final8 at 0.5 s: 1.09, bubble4 at 0.1 s: 1.07), where the two arms run the same computation and can differ only by timing. Those flags are listed as measured. They did not decide anything, since P2 and P3 already fail, but they show how large timing noise is in these equal-time means: up to 14% between two runs of the same computation. The equal-time verdicts above rest on paired tests over 60 seeds, not on these means.

## Ties to the released binary

The run used an earlier 5.6 build. The trainer sources of the release have the hashes recorded when the run started (`validation/5.6/convergence/trainer-sources.sha256`: all identical). The released Linux binary (EightMaxBuild=7ee054b44c409149) retrained 210 sampled rows of the run (7 games, seeds 1001, 1031, 1060, all five arms, 4,000 and 20,000 deals) and reproduced the recorded checkpoint SHA-256 in 210; differing: 0. Because two of the arms were written by the 5.5 binary, this is also a direct equal-deal identity check of the released trainer against 5.5 for the default and the river estimator. Golden states: 11 of 11 reproduced.

## What this does not show

- Seven small games with exact evaluation. The realistic study fixtures (grouped hands, hundreds of thousands of information sets) have no feasible exact NashConv; for them 5.6 reports training throughput (the trajectory per deal is identical to 5.5) and the study's restricted quality measure, which is not exploitability. See PERFORMANCE-5.6.md.
- Equal-time contrasts are wall-clock on a shared four-core container with other work running; the arm order was rotated per seed so that noise does not favour an arm, but the deal counts reached in a given time are this machine's.
- "Closer to equilibrium at equal time" follows from doing the same computation faster. It is a statement about this implementation on this hardware, not a better algorithm. The algorithmic question 5.5 posed, an estimator that wins at equal time everywhere, remains open: the candidate won on one of the four games it changes, was unresolved on two and lost on one.
- Nothing here measures abstraction error or says how far any strategy is from equilibrium of the full game.

