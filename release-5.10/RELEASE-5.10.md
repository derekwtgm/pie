# EightMax Windows 5.10

Build `7fa0e8c16d6c6ade`. Successor of 5.9 (build `00600c81455ead44`). Windows 11 x64; self-contained (no Python, Node.js,
compiler or runtime to install).

**Status in one paragraph.** 5.10 adds an experimental, opt-in training estimator, `rbes`. Its update rule was validated
exactly against brute-force and independent references before any strategy was measured, and in an experiment whose
plan was written first it trained strategies with lower exact NashConv than the 5.9 trainer **in the same training
time on 11 of 20 reference games, with no resolved difference on 9 and a higher value on none**. With exact
NashConv it was NOT shown to help on small six-player flop games or on eight-handed push-or-fold games; on the
shipped six-player flop fixture, where only lower bounds exist, the strongest available response search finds a
quarter as much against it after 30 s of training as against the default trainer (diagnostic evidence, not proof). **The default trainer is unchanged**: with the
same settings 5.10 writes the states 5.9 wrote, byte for byte, so nothing changes for a user who does not select the
new estimator. Everything was built and tested on Linux and, as Windows executables, under Wine; a run of the delivered archive on a hosted Windows runner (GitHub Actions, a virtual machine without a GPU), if it took place, is recorded beside the ZIP in `WINDOWS-CI-5.10.md`, not in it. **Nothing
in 5.10 has run on the target PC or on an NVIDIA GPU** (WINDOWS-TESTS-5.10.md says how to do that in one
double-click).

## What is new

### 1. An experimental training estimator: `rbes` (TRAINING-ENGINE-5.10.md, section 4)

Rao-Blackwellised external sampling, algorithm identifier `rbes-5.10-v1`. The default trainer updates, per deal and
seat, the one hand that seat was dealt. `rbes` updates **every hand of the seat's range that is compatible with the
deal**, each weighted by its conditional probability, in one vectorised traversal, and takes an opponent's terminal
actions (a fold that ends the hand, a closing call) in expectation instead of sampling them. The expected regret and
average-strategy increments are those of the default trainer; their variance is smaller.

* Select it with `"estimator": "rbes"` in an engine spec or `estimator=rbes` on `mwcli.exe --study`. Without the
  setting nothing changes.
* Works with two to eight seats, every start street, chip EV and ICM, exact cards and Compact or Detailed hand
  groups, one deal per update and frozen batches on several threads, studies and their checkpoints.
* **Refused before training** (not validated): DCFR, regret matching+, batch schedules, Latin and stratified deals,
  the representative groups of turn and river starts, an opponent exploration of zero, and any combination with the
  older experimental estimators (`ownHandEnumeration`, `opponentEnumeration`, `terminalBaseline`,
  `terminalExpectation`).
* Costs more time per sampled deal (it writes every row of the seat, not one) and reaches the table's final size
  earlier; the same table budget applies and stops it cleanly.
* The desktop interface does not offer it: it is a command-line and spec option in this release.

### 2. It was validated before it was measured (MATHEMATICAL-VALIDATION-5.10.md)

Before a single strategy was compared, the update rule was checked against references that do not share its
code (final run: 65 of 65 checks passed):

* **Exactly.** For 28 game and variant combinations - two to eight seats, chip EV and ICM, river to preflop starts,
  side pots, exact cards and Compact groups - the expectation of the estimator's increments over EVERY outcome of its
  sampling (4,907,672 outcomes enumerated, 1,982,802 table entries compared) equals a brute-force walk of the
  whole betting tree to 9.4e-17 of the scale. No statistics are involved.
* **Exactly and independently.** For 11 combinations an implementation in Python (its own betting rules, side pots
  and hand evaluator) computes the same expected increments from the definition: agreement to 2.8e-17.
* **The sampler.** 131 decisions, 2,000,000 draws each: the frequencies are the probabilities the weights use.
* **A second implementation.** With sampled terminal children `rbes` must reproduce the 4.7 own-hand estimator; the
  strategies both train agree to rounding on 12 games.
* **Monte Carlo.** On 13 games up to the shipped fixtures the two estimators agree in the mean (2,417 entries)
  and the variance of the regret increments of `rbes` is 0.0081 to 0.43 of the default's.
* **Determinism.** One state for every thread count, batch update and cache setting; stop and continue byte for byte;
  the Windows program (under Wine) writes the bytes of the Linux program.

The document also reports, with their evidence, two earlier runs of the Monte Carlo comparison that were flagged
and why the criterion, not the estimator, was at fault.

### 3. What it does to strategies (CONVERGENCE-5.10.md)

20 reference games with exact NashConv, 20 paired seeds, the unchanged 5.9 program beside both 5.10 trainers,
8,800 measurements, analysed by a rule fixed beforehand:

| | Result |
|---|---|
| Equal training time (4 s; the primary comparison) | `rbes` lower on **11 of 20** games (ratio 0.30 to 0.92), unresolved on 9, higher on none |
| Equal sampled deals | lower on 82 of 100 game-budget cells (ratio 0.08 to 0.87), unresolved on 18, higher on none |
| The eight games with ranges (5 to 59 hands a seat; six of them heads-up to four-player river and turn games) | better on 6 of 8 at equal time: **recommended** |
| Tournament-stage games (three streets, medium stacks, bubble, side pots, eight-handed short stacks) | better on 3 of 5 at equal time: **recommended** |
| Games with one to six hands a seat | better on 2 of 7: not recommended |
| **Six-player flop**, exact NashConv (two small games) | **unresolved** at equal time (0.88 and 0.87, intervals about 0.5 to 1.5) |
| **Six-player flop**, the shipped fixture (lower bounds; exploratory) | after 30 s a response trained by `rbes` certifies 0.73 to 1.06 BB against the default trainer's strategy and 0.15 to 0.25 BB against the strategy of `rbes`, in every seed |
| **Eight-handed push or fold** (two games) | **unresolved** at every budget (1.25 and 1.28 at equal time) |
| ICM | better on the two ICM river games; unresolved at equal time on the bubble and final-table games |
| Shipped fixtures with hand groups | diagnostics only (lower bounds from a trained response). With the default response search: nothing certified against either trainer after 30 s. With a stronger search (a response trained by `rbes`; exploratory): after 30 s 0.73 to 1.06 BB against the default trainer and 0.15 to 0.25 BB against `rbes` on the six-player fixture, 0.22 to 0.34 against 0.14 to 0.19 BB on the three-player fixture - lower against `rbes` in every seed |
| Default trainer 5.10 against 5.9 | identical states (2,000 of 2,000); indistinguishable at equal time |

`rbes` is therefore documented as the better choice, opt-in, for postflop games in which seats hold ranges (exact
cards or Compact groups), and as unproven for push-or-fold games and small multiway games. It should not be used
with Detailed groups or preflop starts, where it is far too slow and its table too large (PERFORMANCE-5.10.md). The rule written before the run did not allow it to
replace the default trainer in this release whatever the numbers, and the numbers would not have justified it.

### 4. Checkpoints know their algorithm

A state trained by `rbes` carries the algorithm in its header and has its own study identifier. The default trainer
refuses it, `rbes` refuses a state of the default trainer, the two `rbes` variants refuse each other, 5.9 and
earlier refuse it as "a different study", and a study checkpoint cannot be resumed with another trainer. Nothing is
written when a state is refused. The state FORMAT is unchanged (EMMW4, EMZ1). States of the default trainer are the
states of 5.9, in both directions.

### 5. A response trained by `rbes` (optional)

`mwcli.exe --response` accepts `"responseEstimator": "rbes"`: the response of each seat is then trained by the new
estimator. The measured quantity and every confidence statement are unchanged, because they never depended on how the
response was found; a better response makes the lower bound less loose. It is much better: at the same response
deals it finds 92 to 99% of exact NashConv on three small fixtures where the default response finds 70 to 92%, and
on the six-player flop fixture it certifies a NashConv of at least 2.29 BB where the default response certifies
0.02 BB (PERFORMANCE-5.10.md, section 4). **If you measure a large study, use it**: the lower bounds 5.9 reported
for such games were weak. Default: the 5.9 response, bit for bit.

### 6. The default trainer: same states, slightly faster with Detailed hand groups

The default trainer of 5.10 writes the states of 5.9 byte for byte (2,000 of 2,000 states of the convergence experiment and 225 of 225 configurations of the identity tool, with 1, 2, 4 and 8 threads and the measured thread choice). With Detailed hand groups
it caches the identifier of a hand's group key per (seat, street, public cards): on the Detailed fixture a deal takes 89% to 96% of the time it took in 5.9 (one deal per update and frozen batches on 1, 2 and 4 threads). Everything else
runs at the speed of 5.9 (PERFORMANCE-5.10.md).

### 7. Validation you can run

`mwcli.exe --selftest510 studies <folder> [all|estimator|training|checkpoint|limits]` (21 checks, machine-readable
report), `Run 5.10 focused validation.bat` (what 5.10 added or changed, about 4 to 10 minutes) and
`Run 5.10 Windows validation.bat` (everything, including the CUDA section, 25 to 70 minutes). WINDOWS-TESTS-5.10.md.

## What did not change

* The default trainer and every earlier optional trainer; all checkpoint formats (EMMW4, EMZ1, study checkpoint
  version 1); deterministic continuation; the memory budget; checkpoint corruption recovery and the checkpoint-commit
  repair; study locks; refused-study cleanup; study-budget validation.
* Tournament structure defaults (eight players, 0.5 / 1 blinds, 0.1 BB ante per player, 2.3 BB in the pot
  eight-handed, no big-blind ante substituted), stacks, weighted ranges, bet sizes, chip EV and ICM, side pots.
* CPU-only, Automatic, Hybrid and GPU-Preferred processing, the CPU fallback and the GPU memory budget. **No CUDA
  code and no scheduling changed.** As before, the traversal of every trainer runs on the CPU in every mode; CUDA can
  take over the showdown scoring of large batches and nothing else, so training is not "GPU-accelerated" in any
  general sense. This holds for `rbes` too: with the project's simulated CUDA driver all four modes write one state.
* The trained-response measure, its statistics and its evaluation streams (5.9), unless `responseEstimator` is set.
* The interface. The separate EightMax Test Workbench is not part of this release and was not modified.

## Compatibility

| | |
|---|---|
| trained states of the default trainer (EMMW4, EMZ1) | unchanged; 5.9 states load and continue to the same bytes, and 5.9 opens states of the 5.10 default trainer |
| trained states of `rbes` | new header field `estimator`; refused by the default trainer and by 5.9 and earlier |
| study checkpoints | format unchanged; tied to the build as before (a 5.9 study checkpoint is refused with the reason) |
| engine information (`trainer`) | for `rbes`: `algorithm`, `experimentalEstimator`, `rbes{...}`; for the default trainer no field is added, except `handGroups.keyCache` with Detailed groups |
| `mwcli --response` result | unchanged unless `responseEstimator` is set, which adds that field |
| study documents | `run.trainer.estimator` when `estimator=rbes` is given; otherwise unchanged |
| desktop host API | unchanged |
| command line | new: `--selftest510`, `--estimator-check`, `estimator=` for `--study`; everything else as in 5.9 |

## Known limitations

1. **Not run on the target PC or on an NVIDIA GPU.** The physical Windows results of 5.9 are not evidence for 5.10;
   Wine is not Windows. See WINDOWS-TESTS-5.10.md.
2. **`rbes` is experimental and opt-in.** It refuses the configurations listed above, is not implemented in the
   JavaScript reference trainer, and costs 1.5 to 17 times the time per sampled deal. Its table reaches full size
   early: with hand groups that is bounded, but with large EXACT ranges on a multiway flop it can fill the table
   budget within a few thousand deals (training then stops cleanly). With Detailed groups it is 36 times slower
   per deal than the default and its table 38 times larger; on the two preflop fixtures it is 210 to 250 times
   slower. With exact NashConv it was not shown to help at equal time on small six-player flops, eight-handed
   push-or-fold games and bubble games, and on three small games its point estimate was worse (unresolved).
3. **Large games still have no certificate.** Exact NashConv exists only for games small enough to walk. For the
   shipped fixtures with realistic ranges the only measure is the trained response, a LOWER bound of what a best
   response wins inside the abstraction. A small lower bound does not show that a strategy is close to equilibrium,
   and no percentage of optimality is claimed anywhere.
4. **Hand-group abstractions have a floor.** With Compact or Detailed groups, an exact best response that sees the
   cards finds gains no amount of training removes; such numbers measure the abstraction, not the trainer.
5. **The average strategy is still estimated with heavy-tailed weights** (TRAINING-ENGINE-5.10.md, section 2.3), by
   both trainers. This is the most promising item left open.
6. **The default response training is unchanged in algorithm and speed**; its table is a private copy per seat.
7. The training random generator, the update limit (10,000,000 updates per state) and the 2^32 stream states are
   unchanged.
8. The stronger response search (`"responseEstimator":"rbes"`) is opt-in and costs 1.6 to 7 times the response
   training time per deal; the default `--response` is the 5.9 search, whose lower bounds for large games are weak
   (PERFORMANCE-5.10.md, section 4).

## Files of this release

`FINAL-REPORT-5.10.md` (what was done and what was not; the twenty questions), `TRAINING-ENGINE-5.10.md`,
`MATHEMATICAL-VALIDATION-5.10.md`, `CONVERGENCE-5.10.md`, `PERFORMANCE-5.10.md`, `VALIDATION-5.10.md`,
`WINDOWS-TESTS-5.10.md`, `BUILD-5.10.md`; evidence under `validation/5.10/`. `USER-GUIDE-5.8.md` remains the guide to
studies and to the response measure, with STATISTICAL-CHANGES-5.9.md for the confidence statements.

To keep the archive below the 100 MiB limit of the repository that distributes it, ten Linux builds of the desktop
host and the GPU stress tool of releases 5.3 to 5.7, which no test or tool of 5.10 uses, are no longer carried
(`validation/5.10/ARCHIVE-NOTE.txt`). Nothing of the Windows application is affected.
