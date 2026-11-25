# EightMax 5.10: final development report

Build `7fa0e8c16d6c6ade`, successor of 5.9 (`00600c81455ead44`). Companion documents: TRAINING-ENGINE-5.10.md (the trainer and
the new estimator), MATHEMATICAL-VALIDATION-5.10.md (why its updates are right), CONVERGENCE-5.10.md (what it does to
strategies), PERFORMANCE-5.10.md, VALIDATION-5.10.md (every test), WINDOWS-TESTS-5.10.md (what remains to be run on
the PC), RELEASE-5.10.md, BUILD-5.10.md. Evidence: `validation/5.10/`.

## 0. The short version

* **What was built.** One experimental training estimator, `rbes` (Rao-Blackwellised external sampling), as an
  explicitly named opt-in with its own algorithm identifier and checkpoint rules. The default trainer was not
  changed: it writes the states of 5.9 byte for byte.
* **Is its mathematics right?** Yes, by evidence that does not depend on statistics: the expectation of its regret
  and average-strategy increments over every outcome of its sampling equals a brute-force walk of the whole betting
  tree on 28 game and variant combinations (two to eight seats, chip EV and ICM, exact cards and hand groups), and
  an independent Python implementation agrees on 11.
* **Does it train better strategies?** On a defined class of games, yes, at equal wall-clock time: lower exact
  NashConv on 11 of 20 reference games in an experiment whose plan and decision rule were written first; unresolved
  on 9; worse on none.
* **Where it did not.** Eight-handed push-or-fold games: unresolved, no sign of an improvement. Six-player flop,
  the practical benchmark of the assignment: with exact NashConv on two small games, **unresolved at equal time**.
  On the shipped six-player fixture only lower bounds exist; the strongest search available certifies 0.15 to 0.25
  BB against `rbes` after 30 s of training and 0.73 to 1.06 BB against the default trainer, in every seed - strong
  diagnostic evidence from an exploratory comparison, not a demonstration.
* **Promotion.** Not promoted. By the prespecified rule it is recommended, opt-in, for games with ranges and for
  tournament-stage games; the default trainer of 5.10 is the trainer of 5.9.
* **Speed.** The default trainer runs at the 5.9 speed, a little faster with Detailed hand groups. A deal of `rbes`
  costs 1.6 to 16 times a deal of the default on the reference games and far more with Detailed groups or preflop
  starts, where it should not be used. Used as the RESPONSE trainer, `rbes` makes the quality measure much sharper:
  on the six-player fixture it certifies a NashConv lower bound of 2.29 BB where the default response certifies
  0.02 BB.
* **Tests.** 656 regression tests: 655 passed, 0 failed, 1 skipped. Self-tests 5.10 / 5.9 / 5.8 / 5.7.1 /
  5.7: 21, 32, 33, 24, 28 checks passed on Linux and, as the Windows program, under Wine. Sanitizers clean.
* **Not done.** Nothing of 5.10 has run on the target PC or on an NVIDIA GPU. Your 5.9 results do not carry over.

## 1. Baseline verification (Phase 1)

`validation/5.10/baseline/baseline-5.9.json` (written by `baseline510.py`).

| Check | Result |
|---|---|
| Archive `EightMax-Windows-5.9.zip` | 101,780,491 bytes, SHA-256 `c014d67bb904f875aacfd80cea278a78c8e8ce55966fab36e1a165a09b822633`: the expected value and the value of its identity file; CRC of all 5,108 members passed |
| Manifest | 5,107 entries, every file matches, nothing unlisted in a fresh extraction |
| Identity | version 5.9, build `00600c81455ead44` in `BUILD-INFO.json` and embedded in the three executables; executable hashes equal the identity file |
| Rebuild of the unmodified source with this session's toolchain | `EightMax.exe`, `mwcli.exe`, `gpustress.exe`, the three Linux programs and the interface: all seven byte-identical to the shipped files |
| Reference binary kept | the rebuilt (= shipped) Linux `mwcli` of 5.9, SHA-256 `782c3493...1087b4822c`; it is the "unchanged 5.9 program" of every comparison below |
| Physical Windows results of 5.9 (supplied with the assignment) | kept unaltered in `validation/5.10/baseline/windows-5.9-physical/`: focused 95 passed, 0 failed; full 192 passed, 0 failed, CUDA section included; Windows 11 Home, i7-13700F, RTX 4060 Ti. Evidence for 5.9, not for 5.10 |

Because the rebuilt programs are the shipped programs bit for bit, every difference between 5.9 and 5.10 comes from
the source changes of this release, and the test evidence of the 5.9 archive applies to the reference binary unchanged.

## 2. Training-engine audit (Phase 2)

TRAINING-ENGINE-5.10.md, section 2, answers the ten questions of the assignment with evidence. The findings that
shaped the release:

1. **The dominant sampling variance is the updating seat's own hand.** Per deal and seat the default trainer updates
   one hand; every other row of that seat receives nothing. Taking the expectation over the hand (given the board
   and the opponents' hands) is exact, cheap in vector form, and removes most of the variance of the regret
   increments (section 4 below).
2. **Sampled folds waste a traversal.** When an opponent's sampled action ends the hand, the traversal stops, although
   the payoffs of all terminal children are known once the deal is fixed.
3. **The average strategy is accumulated with heavy-tailed weights.** Its increment carries 1 / (sampling reach of the
   opponents' actions), bounded only by (10 k)^(opponent decisions). This was measured, not assumed: on the
   three-player flop fixture, entries with more than 500 nonzero deals out of 60,000 had an effective sample size
   near 120, and their sample means changed by an order of magnitude when the sample grew 32-fold
   (`validation/5.10/estimator/diagnosis.json`). Neither trainer of 5.10 changes this; it is the first item of
   "what remains".
4. **The trainer is bound by dependent memory reads, not by one hot function.** About 370 instructions per state visit
   at an IPC near 1.2; no single item above 16% that earlier releases had not already reduced
   (`validation/5.10/profile/`).
5. **Hand-group abstractions put a floor under exact NashConv** that no training removes (the best response sees the
   cards). Exact NashConv is therefore a measure of the TRAINER only on games played with exact cards; this decided
   the design of the convergence experiment.
6. The hand-group key of every seat and street was recomputed for every deal although it is a pure function of
   (hand, public cards): cached in 5.10 where it pays (Detailed keys).

## 3. Estimator development (Phase 3)

Candidates were compared in pilot runs (seeds 9001 to 9012, used by no formal experiment; `validation/5.10/pilot/`)
before one was built. Relative to the default trainer at equal sampled deals (exact NashConv, geometric mean):

| Candidate | Pilot effect | Decision |
|---|---|---|
| Control variates at opponent decisions (bounded by removing all river action sampling) | x 0.53 to 0.87 | not built: smaller gain, a second table |
| Terminal-sibling control variate (4.3) | x 0.81 to 1.12 | superseded by rule R2 |
| Own-hand enumeration (4.7; refused with hand groups) | x 0.40 to 0.71 | generalised: rule R1 |
| More opponent exploration; uniform weighting | not better / worse | rejected |
| Expectation over the updating seat's whole range, with hand groups, vectorised, threaded | x 0.08 to 0.32 on six games with ranges | **built: `rbes`** |

**`rbes` (identifier `rbes-5.10-v1`)** is external sampling with two sampled quantities replaced by conditional
expectations. R1: one traversal carries every hand of the updating seat that is compatible with the sampled board
and the opponents' sampled hands, weighted by its conditional probability; increments are added per table row (a
hand, or a hand group). R2: at an opponent decision the terminal children are taken exactly and one non-terminal
child is sampled with probability q(a) / q(non-terminal), with the importance weight that keeps the expectation.

It is isolated as the assignment requires: an explicit option (`"estimator": "rbes"`), a unique algorithm identifier
stored in its states, the default trainer's deal and action streams, deterministic states for every thread count,
its own checkpoint rules (a state continues only under the algorithm that trained it), memory and throughput in its
information output, and a refusal for every configuration it was not validated with. The default trainer is
untouched: it writes the states of 5.9.

Implementation: `source/native/es_rbes510.hpp` (structures), `es_rbes510_walk.hpp` (the production traversal and a
straightforward reference traversal), `es_rbes510_check.hpp` (the exact check, in the engine so that the shipped
Windows program can run it), together 596 lines, and 333 added lines in 13 existing engine files (17 removed).

## 4. Independent mathematical validation (Phase 4)

MATHEMATICAL-VALIDATION-5.10.md. Final run of `validation/5.10/estimator510.py`: 65 of 65 checks passed.

| Check | Scope | Result |
|---|---|---|
| Exact: expectation over every sampling outcome against a brute-force walk of the whole tree | 28 game and variant combinations, 3,245 deals, 4,907,672 outcomes, 1,982,802 table entries; regrets and averages; reach and chance weights; zero-probability and rare actions | largest difference 9.4e-17 of the scale; outcome probabilities sum to 1 within 1.2e-15 |
| Exact and independent: Python implementation of the definition | 11 combinations, every deal of each game (66,101 deals), 100,598 entries | 2.8e-17 |
| The sampler | 131 decisions x 2,000,000 draws | frequencies equal the claimed probabilities (smallest p 0.0042, level 0.00038) |
| A second implementation (the 4.7 own-hand estimator, same random numbers) | 12 games, 100 to 40,000 deals | agreement to rounding at 100 and 1,000 deals on all twelve; afterwards rounding amplified by the training dynamics on a few (largest relative difference 1.8e-6, an ICM game after 40,000 deals) |
| Monte Carlo: both estimators against the same frozen table | 13 games up to the shipped fixtures | means agree (2,417 entries, largest \|z\| 3.71 against 4.26); regret-increment variance 0.0081 to 0.43 of the default's |
| Determinism | threads, batch update, caches, stop and continue, Linux against Windows (Wine) | one state |

**Two things went wrong on the way and are documented where they belong.** The Monte Carlo comparison was flagged
in its first run (two games) and in its second (one game). Both times a sample 4 to 32 times larger showed the
criterion to be at fault - a normal test applied to heavy-tailed average-strategy weights, then a per-game error
rate applied to thirteen games - and not the estimator; the three runs and the follow-up samples are kept
(MATHEMATICAL-VALIDATION-5.10.md, 5.3). And the cross-check against the 4.7 estimator had to be restated after one
game showed rounding amplified by the training dynamics (section 6 there). Neither episode changed a line of the
estimator.

**Did it reduce variance?** Of the regret increments, yes, on every game measured: to 2 to 6% of the default's on
river and turn games with ranges, 9 and 15% on the two Compact flop fixtures, 35 to 43% on small six-player games.
Of the average-strategy increments, the samples say yes (0.1% to 38%) but that ratio is unstable on large games and
is not claimed there.

## 5. Training performance (Phase 5)

PERFORMANCE-5.10.md; TRAINING-ENGINE-5.10.md, section 5.

| | Result |
|---|---|
| Default trainer, states | identical to 5.9 in 20 of 20 benchmark rows (1, 2, 4 threads), 225 configurations, 1,782 trainings, 0 differences of the identity tool (1, 2, 4, 8 threads and the measured choice), 2,000 of 2,000 in the experiment |
| Default trainer, time per deal against 5.9 | 0.97 to 1.10 (median 1.00) without Detailed keys; 0.89 to 0.96 with Detailed keys (the one optimisation that was kept: a cache of group-key identifiers) |
| Instructions for the same work | +0.5% to +1.1% (the fields of the new option in the walker); Detailed fixture -0.2% including program start and state load |
| `rbes`, time per sampled deal against the default | 1.6 to 16 on the reference games, 2.9 and 9.7 on the two Compact flop fixtures, 36 with Detailed groups, 210 to 250 on the preflop fixtures |
| `rbes` on 4 threads (frozen batches) | 1.9 to 2.5 times one thread; one state for every thread count |

What the audit asked for and what was done: the trainer was profiled by instruction counts and stage times on the
realistic multiway fixtures (not only on games that fit the caches); one layout-neutral optimisation of the default
path paid and was kept (Detailed identifiers); one did not pay and was dropped (Compact identifiers); the
strategy-table layout was left alone, because every candidate either changes all readers of the table or moves the
point at which a table limit is reached, and "do not introduce a new serialised state format for a speculative
optimisation" applies. In `rbes` the rows of a decision are looked up together with prefetching, which is where a
batched lookup is possible at all. **The default trainer did not become materially faster.**

## 6. Multiway convergence experiments (Phase 6)

CONVERGENCE-5.10.md. Plan written at 2026-11-25T00:40:07Z before the first measurement (`validation/5.10/convergence/exact/plan.json`):
20 games with exact NashConv in three classes, 20 paired seeds, three arms (the unchanged 5.9 program, the 5.10
default trainer, `rbes`), five equal-deals budgets from 20,000 to 1,000,000 and three equal-time budgets; primary
family: 4 s, Bonferroni over the 20 games; secondary: all 160 cells; decision rule R1 to R3 fixed in advance.
8,800 measurements, 0 errors; the run was interrupted twice and resumed without any analysis in between.

| | Better | Unresolved | Worse |
|---|---|---|---|
| Equal time, 4 s (20 games) | **11** | 9 | **0** |
| Equal deals (100 cells) | 82 | 18 | 0 |
| Equal time, all three budgets (60 cells, stricter level) | 23 | 37 | 0 |

| Class | Primary better | Recommended by the rule |
|---|---|---|
| games with ranges (8) | 6 | yes |
| tournament-stage games (5) | 3 | yes |
| games with one to six hands a seat (7) | 2 | no |

* **Six-player flop:** `flop6` unresolved: 0.877, interval 0.495 to 1.56; lower in 11 of 20 seeds; `rg-flop6c` unresolved: 0.874, interval 0.536 to 1.43; lower in 12 of 20 seeds. Better only at the smallest equal-deals
  budgets. On the shipped six-player fixture no exact NashConv exists; the trained-response diagnostics are lower bounds, not certificates. With the response search of 5.9 they cannot rank the trainers after 30 s; with a stronger search (a response trained by `rbes`, an exploratory comparison) the bound certified after 30 s is 0.15 to 0.25 BB against `rbes` and 0.73 to 1.06 BB against the default trainer, lower in each of four seeds.
* **The default trainer:** 2,000 of 2,000 states identical to 5.9; indistinguishable at equal time.
* **The released program** reproduces the experiment: 160 of 160 states.

## 7. Eight-handed tournament validation (Phase 7)

Tournament defaults are unchanged (eight players, 0.5 / 1 blinds, 0.1 BB ante each, 2.3 BB pot, no big-blind ante
substituted), and so are stacks, weighted ranges, bet sizes, chip EV, ICM and side pots. Each situation the
assignment lists has a game in the experiment; ICM and chip-EV results are never pooled.

| Situation | Game | `rbes` at equal time | At equal deals |
|---|---|---|---|
| eight-handed preflop, short stacks (chip EV) | `short8-push` | unresolved (1.28) | unresolved |
| eight-handed final table (ICM) | `final8` | unresolved (1.25) | unresolved |
| medium stacks | `mid3-turn` | better (0.86) | better |
| bubble ICM | `bubble4`, `rg-bubble4`, `bubble5-icm` | unresolved (0.46, 0.73, 0.54) | better (0.15 to 0.40) |
| multiway all-in | `flop6`, `turn4` | unresolved (0.88, 0.83) | `turn4`: better at every budget (0.16 to 0.22); `flop6`: better at 20,000 deals only |
| side pots | `river3-chip`, `sidepot3-icm`, `rg-icm3-river` | unresolved (1.32), better (0.63), better (0.30) | better |
| three- and six-player postflop | `early3-flop`, `rg-turn3`, `rg-flop6c` | better (0.92), better (0.64), unresolved (0.87) | better; six players: only at small budgets |

**Eight-handed tournament convergence did not improve; ICM improved where seats hold ranges and betting continues,
not on push-or-fold games.** The exact check of the estimator covers eight seats and ICM (`final8`, `short8-push`,
`bubble5-icm`, `icm8-bb-call-small` and others), so `rbes` is correct there; it is simply not faster. With a preflop
start and hand groups (the shipped `icm8-bb-call` and `btn25-open` fixtures) `rbes` is slow and is not recommended.

## 8. Response-training optimisation (Phase 8)

PERFORMANCE-5.10.md, section 4.

* **The default trained response is the 5.9 response**: identical bits in six games, the same training time within
  noise. It was not accelerated. The fixed cost of loading one copy of the state per seat was measured (a few
  percent of a realistic analysis) and left: removing it means sharing engine tables between seats.
* **An opt-in response trainer, `"responseEstimator":"rbes"`.** The measured gain of a response is evaluated on deals
  independent of its training whatever trained it, so the measure and its confidence statements are untouched; a
  better response trainer only makes the lower bound less loose. At the same response deals it finds 99%, 92%, 98%
  and 74% of exact NashConv on the four games with exact values (default: 92%, 77%, 70%, 0%) for 1.6 to 2.8 times
  the training time; on the two flop fixtures it certifies 1.66 and 2.29 BB where the default response certifies
  0.14 and 0.02 BB. At a quarter of the response deals it needs no more training time than the default on five of
  six games and still finds more on five of six.
* **What it revealed.** For large games the quality measure of 5.8 and 5.9 was limited by the response search more
  than by the statistics: the six-player strategies that 5.9 described with lower bounds of about 1 BB are at least
  2.3 BB from equilibrium inside their abstraction. CONVERGENCE-5.10.md, section 7.3, uses the stronger search to
  compare the two trainers.

## 9. Regression and stability (Phase 9)

VALIDATION-5.10.md.

| | Result |
|---|---|
| Regression suite, release programs | 656 tests: 655 passed, 0 failed, 1 skipped (the root-permission test 5.9 also skipped) |
| Self-tests on Linux | 5.10: 21; 5.9: 32; 5.8: 33; 5.7.1: 24; 5.7: 28 - all passed |
| States of the default trainer against the unchanged 5.9 binary | 225 configurations, 1,782 trainings, 0 differences; 2,000 of 2,000 in the experiment |
| Sanitizers | AddressSanitizer / UndefinedBehaviorSanitizer / ThreadSanitizer / LeakSanitizer: 0 reports |
| Checkpoints and reliability | every 5.7.1 checkpoint and memory check passes; `rbes` states: cross-algorithm continuation refused with nothing written, stop-and-continue byte for byte, compressed states, table-limit stop and resume, an interrupted study resumed to the uninterrupted result |
| Desktop host, interface, stability | 9 of 9 refused-study checks, 20 of 20 interface checks in Chromium, 12 of 12 checks of a three-minute run |
| Windows executables under Wine | the five self-tests (21 of 21, 32 of 32, 33 of 33, 24 of 24, 28 of 28), the `rbes` reference state for 1, 2 and 4 threads, the exact check and the 5.9 reference responses: all passed |
| Validation script under PowerShell 7 (Linux) | focused: 50 passed, 0 failed, 1 skipped, 0 untested (skipped: integrity / SHA256SUMS.txt); full: 215 passed, 0 failed, 2 skipped, 0 untested (skipped: integrity / SHA256SUMS.txt; GPU / CUDA validation) |

The tests found defects in this release's own work before it shipped - a test file broken by an edit, compiled
tables outside the source fingerprint, a validation script that exhausted memory, two statistical criteria that
were wrong - and VALIDATION-5.10.md, section 2, lists them with what was done.

## 10. Windows release engineering (Phase 10)

* `EightMax.exe`, `mwcli.exe`, `gpustress.exe`: cross-compiled with the 5.9 toolchain (which reproduces the 5.9
  executables byte for byte), statically linked, no runtime to install. A second build of the final source in another directory gave the same seven artifacts byte for byte.
* `mwcli.exe --selftest510 studies <folder> [all|estimator|training|checkpoint|limits]`: 21 checks, a JSON report,
  exit status 0 only if every check passed. `--selftest57`, `--selftest571`, `--selftest58`, `--selftest59` are
  preserved and pass.
* `Run 5.10 focused validation.bat`: the 5.10 self-test, then `validate_windows510.ps1 -Focused` (integrity, the
  golden states, thread counts of the default trainer, the 5.10 self-test imported check by check, and "estimator
  5.10": the `rbes` reference state for 1, 2, 4, 8 and all logical processors and for all four processing modes, the
  exact check on this PC, throughput of both trainers).
* `Run 5.10 Windows validation.bat`: the five self-tests, then all 19 sections including the physical CUDA tests.
  JSON and text reports with version, machine and GPU details, execution times, and passed / failed / skipped /
  untested counts; a missing report is a failure.
* `EightMax-Windows-5.10.identity.json`: version, build identifier (the source fingerprint), archive SHA-256,
  manifest checksum, executable checksums, the smoke tests made on a clean extraction of that exact file, and the
  validation status.
* Native Windows: a GitHub Actions workflow that extracts the DELIVERED archive on a hosted Windows runner and
  runs both launchers is delivered beside the ZIP; its result, if it ran, is in `WINDOWS-CI-5.10.md` there. A hosted
  runner is a virtual machine without a GPU and is not the target PC.

## 11. The twenty questions

1. **Did version 5.10 produce better strategies than version 5.9?** With the default trainer: the same strategies,
   byte for byte. With the new opt-in estimator `rbes`: yes on 11 of 20 reference games at equal training time (exact
   NashConv, 20 paired seeds, ratio of geometric means 0.30 to 0.92), not distinguishable on 9, worse on none.
2. **Which training algorithm achieved the best results?** `rbes` on games in which seats hold ranges and betting
   continues over one or two streets (heads-up to four-player river and turn games, ICM river games, the three-street
   tournament games). On games with a handful of hands a seat, push-or-fold games and six-player flops, `rbes` and
   the default trainer were not distinguishable at equal time. DCFR and regret matching+ were worse than the default
   in the 5.9 experiment and were not re-run.
3. **Was a new estimator independently validated?** Yes. Exactly: its expected increments equal a brute-force walk of
   the whole tree on 28 game and variant combinations (largest difference 9.4e-17 of the scale) and an independent
   Python implementation of the definition on 11 (2.8e-17). Its sampler's frequencies, a second implementation
   (the 4.7 estimator) and a Monte Carlo comparison on 13 games agree. 65 of 65 checks of the final run passed.
4. **Did the experimental estimator reduce variance?** Of the regret increments: yes on every game measured, to
   0.0081 to 0.43 of the default's (2 to 6% on river and turn games with ranges; 35 to 43% on small six-player games).
   Of the average-strategy increments: the samples say yes, but that ratio is unstable on large games and is not
   claimed there.
5. **Did reduced variance improve actual convergence?** Where the variance falls by much more than the cost per deal
   rises, yes (question 1). Where the two roughly cancel - five sampled opponents, or seats with two actions and one
   or two hands - no improvement was resolved. Lower variance per deal did not by itself mean better strategies per
   second, as the assignment warned.
6. **What were the exact NashConv results on reference games?** CONVERGENCE-5.10.md, section 4.3, has every median.
   After 4 s of training, default against `rbes`: heads-up river with ranges 0.0228 against 0.0140 BB; three-player
   river with ranges 0.0078 against 0.0035; three-player turn with ranges 0.788 against 0.507; ICM river with ranges
   0.0302 against 0.0093 prize units; six-player flop (`rg-flop6c`) 0.199 against 0.167 BB (unresolved);
   eight-handed final table 7.1e-7 against 1.1e-6 (unresolved); three streets with deep stacks 14.9 against 13.6 BB
   (both far from equilibrium).
7. **Did six-player flop convergence improve?** Not demonstrated; probably yes on realistic ranges. With exact
   NashConv the two small six-player flop games are unresolved at equal time (ratios 0.88 and 0.87, intervals about
   0.5 to 1.5) and better only at the smallest equal-deals budgets. On the shipped six-player fixture (59 to 125
   hands a seat) no exact value exists. There, a response trained by `rbes` - the strongest search available -
   certifies after 30 s of training 0.73 to 1.06 BB against the default trainer and 0.15 to 0.25 BB against `rbes`,
   and after 6 s 2.42 to 2.78 against 1.11 to 1.71 BB, lower in each of four seeds. These are lower bounds from an
   exploratory comparison: consistent, large, and not a proof.
8. **Did eight-handed tournament convergence improve?** No. Both eight-handed push-or-fold games are unresolved at
   every budget, with point estimates of 1.25 and 1.28 at equal time.
9. **Did ICM convergence improve?** On the two ICM river games with ranges or side pots, yes (0.30 and 0.63 at
   equal time). On the bubble and final-table push-or-fold games: better at equal deals for the bubbles, unresolved
   at equal time for all four.
10. **Were improvements demonstrated at equal training budgets?** Yes: lower exact NashConv in 82 of 100 game-budget
    cells from 20,000 to 1,000,000 deals, higher in none.
11. **Were improvements demonstrated at equal wall-clock time?** Yes, on 11 of 20 games at 4 s (the primary
    comparison); at the stricter level of the secondary family, in 23 of 60 time cells; worse in none.
12. **Did default training become faster?** Only with Detailed hand groups: on the Detailed fixture a deal takes 89% to 96% of the time it took in 5.9 (one deal per update and frozen batches on 1, 2 and 4 threads). Otherwise no: the default
    trainer of 5.10 is the 5.9 trainer at the 5.9 speed (time ratios of 0.97 to 1.10 (median 1.00) on sixteen measurements;
    +0.5% to +1.1% instructions for the same work), and one small fixture measured 7 to 10% slower.
13. **Were strategy-table lookups optimized?** In the default trainer, no: what was cached is the computation of
    hand-group identifiers (Detailed keys), not the lookup; a 12-byte hash record and a maintained offset index were
    examined and not attempted (they change every reader of the table or the point at which a table limit is
    reached). In `rbes` the rows of a decision are looked up together with each stage prefetched.
14. **Was trained-response training accelerated?** The default response training is unchanged: the same bits and the same time as 5.9. What 5.10
    adds is an opt-in response trainer (`"responseEstimator":"rbes"`) that finds much more per response deal - 92 to
    99% of exact NashConv on three small fixtures against 70 to 92%, and a certified 2.29 BB against 0.02 BB on the
    six-player fixture - and, at a quarter of the deals, more than the default in no more training time on four of
    six games. Sharing one copy of the state between seats (a fixed cost of a few percent) was examined and left.
15. **What is the peak memory requirement?** The table, bounded by the table budget for both trainers; both stop
    cleanly at it and resume under a larger one. At the same deals the `rbes` table is larger because it creates rows
    sooner: 38 against 20 MiB of table and 80 against 56 MiB of process peak on the six-player fixture after 250,000
    deals; 291 against 161 MiB on the largest exact game after 1,000,000 deals. With Detailed groups (1.46 GiB after
    30,000 deals) or preflop starts it grows one to two orders of magnitude faster, and `rbes` is not recommended
    there. No run of this release used more than 1.5 GiB; nothing was measured on the 16 GB target PC.
16. **Are saved states deterministic and recoverable?** Yes. The default trainer writes the 5.9 states for every
    thread count (225 configurations, 1,782 trainings, 0 differences); `rbes` writes one state for every thread count, batch
    update and cache setting, on Linux and (as the Windows program) under Wine; stop and continue is byte for byte,
    also from a compressed state and after a table-limit stop; a state is refused by a trainer that did not write it,
    with nothing written; every checkpoint-corruption, previous-generation, commit-repair and memory-stop check of
    5.7.1 passes unchanged.
17. **Were Windows and CUDA capabilities preserved?** No CUDA source, kernel or scheduler file changed, and the
    default trainer is bit-identical, so the capabilities validated physically for 5.9 are untouched in the source.
    The 5.10 Windows executables pass all five self-tests and the reference checks under Wine, and both trainers
    write one state in all four processing modes beside the simulated CUDA driver. On the target PC and on the GPU,
    5.10 has not run: that is the one double-click of WINDOWS-TESTS-5.10.md.
18. **How many regression tests passed, failed and were skipped?** 656 tests: 655 passed, 0 failed, 1 skipped (a
    file-permission test that cannot run as root, also skipped in 5.9).
19. **Which tests could not be executed?** Everything on the target PC; every CUDA path on an NVIDIA GPU; Windows
    PowerShell 5.1 in development; more than four real threads; runs of hours and tables of gigabytes with `rbes`;
    the exact estimator check on trees too large to enumerate. A mutation run of the self-test and a comparison with
    an external solver were not made. VALIDATION-5.10.md, section 8.
20. **What remains before near-equilibrium performance can be credibly claimed for larger tournament games?**
    (a) An upper bound: today every statement about a large game is a LOWER bound of NashConv from a trained
    response. How loose such a bound can be was seen in this release: the 5.9 search certified about 1 BB against a
    six-player strategy for which a better search certifies 2.5 BB, and after 30 s the 5.9 search finds nothing
    where the better one still finds 0.2 to 1 BB. (b) A better estimator of the average strategy, whose weights are heavy-tailed for both
    trainers. (c) Variance reduction for the opponents' sampled actions, which dominate with five or seven
    opponents - the reason six-player and eight-handed games did not improve. (d) Exact reference games nearer in
    size to the fixtures. (e) Hand-group abstractions measured for what they lose: an equilibrium of the abstraction
    is not an equilibrium of the game. (f) `rbes` on the configurations it refuses and in the reference trainer.
    (g) Long runs on the 24-thread PC. Until then no percentage of optimal play can be attached to any strategy
    EightMax trains, and none is.

## 12. Unsuccessful, rejected or not done (class 4), in one place

| Item | Outcome |
|---|---|
| Improving six-player flop convergence | **not demonstrated**: unresolved at equal time on both exact games; on the shipped fixture the lower bounds of a stronger, exploratory response search favour `rbes` by a factor of four after 30 s, which is evidence and not proof |
| Improving eight-handed push-or-fold convergence | not achieved (unresolved, point estimates above 1 at equal time) |
| Promoting a new default trainer | not done, by the prespecified rule |
| Faster default training | only with Detailed hand groups; elsewhere unchanged |
| Faster default response training | not done (same bits, same speed); the gain offered is the opt-in `responseEstimator` |
| Compact-key identifier cache in the default trainer | tried, no gain, not kept |
| 12-byte hash record / maintained row-offset index | not attempted: every reader of the table, or the point at which a table limit is reached, would change |
| Control variates at opponent decisions; more exploration; uniform weighting | pilot only; rejected (TRAINING-ENGINE-5.10.md, section 3) |
| A lower-variance average-strategy estimator | identified as the main open problem; not built |
| `rbes` in the JavaScript reference trainer, with DCFR / regret matching+ / stratified deals, in the interface | not done |
| `rbes` with preflop starts and hand groups at a usable speed | not done (the group keys of 1,326 hands a seat per deal) |
| GPU acceleration of training | not attempted: no performance model justifies it for a traversal bound by dependent table reads, and no hardware to test it |
| A mutation run of the 5.10 self-test | not done |
| Physical Windows and CUDA validation of 5.10 | not possible in this session |

## 13. Files

`EightMax-Windows-5.10.zip`, `EightMax-Windows-5.10.identity.json` (beside the ZIP), the ten documents named at the
top, `Run 5.10 focused validation.bat`, `Run 5.10 Windows validation.bat`; in the archive `validation/5.10/`:
`baseline/` (5.9 verified; your physical 5.9 reports), `pilot/`, `profile/`, `estimator/` (three runs and the
follow-ups), `convergence/` (plan, raw results, summaries, the runner), `performance/`, `identity/`, `tests/`,
`selftest/`, `sanitizers/`, `wine/`, `powershell/`, `ui/`, `stability/`, `windows/estimator/` (reference state for the
validator), `linux-bin/`, `validation-summary.json`.
