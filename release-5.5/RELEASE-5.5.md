# EightMax 5.5 — release report

Build `abe74607a4a0120b`. Upgraded from 5.4 (`980f82b97a922d4d`), whose archive was verified first: 3,726 files, all 3,725
manifest entries matching, and the source rebuilding to the same fingerprint.

## Outcome by priority

| Priority | Outcome |
|---|---|
| 1. Confidence calibration | **Repaired, with a refusal branch.** The cause of the 86.57% rare-tail coverage is identified. Rankings now use bounded-payoff intervals that are valid under stated assumptions, or no ranking is stated. Intervals across trainings remain model-based and are labelled. |
| 2. Convergence | **One candidate built; default unchanged.** The candidate is statistically better per sampled deal on the tested river games, not reliably better per second. The promotion rule set in advance was not met. |
| 3. Training performance | **Complete studies are faster; the trainer is not.** Seeds run side by side and evaluators get more cache. Deals per second of the default trainer are unchanged. |
| 4. Checkpoints and recovery | **Implemented and tested.** Automatic saving; resume after stop, limits, shutdown and process kill reproduces the uninterrupted result. |
| 5. ICM and multiway evaluation | **Cause of the slow ICM evaluation found and removed by configuration; the evaluator itself is unchanged.** The 24 unfinished ICM comparisons are complete. |
| 6. GPU | **Preserved, not extended, not physically tested.** |
| 7. Resource-aware execution | Process memory budget, safe stop on overrun, richer progress. |
| 8. Interface | Study accuracy and recovery panel; resume and discard without the command line. |

## What changed

### Statistics (`STATISTICAL-VALIDATION-5.5.md`)

- New calculation `study-5.5-bounded-eb-v1`: empirical-Bernstein intervals for the mean true value of the measured
  strategies, a union bound over strategies, Bonferroni over the declared family.
- The action evaluator derives a payoff bound from the betting rules (chips) or the payout table (ICM), reports it,
  and checks every sample against it. A violation withdraws the interval.
- `ranked`, `nearTie` and `smallEdge` need the calibrated interval and the model-based interval to agree. A new
  verdict `uncalibrated` replaces them when no calibrated statement exists. A tolerance cannot be met with
  uncalibrated evaluation uncertainty or with sampled quality.
- Result files from 5.2–5.4 open with every measurement intact; statements that rested on uncalibrated intervals are
  withdrawn and the originals kept beside them.
- The paired standard errors are now taken directly from the evaluator. The 5.3/5.4 derivation made Windows and
  Linux results differ in the sixteenth digit.

### Training (`CONVERGENCE-5.5.md`)

- Experimental `opponentEnumeration: "river"` (command line: `opponentEnumeration=river`). Off by default.
- With the option absent the trainer writes the same state bytes as 5.4.

### Study execution and performance (`PERFORMANCE-5.5.md`)

- Seeds of a study train and evaluate side by side (`parallelSeeds`, automatic).
- Process memory budget (`processMemoryMiB`, 70% of installed memory by default); the study stops safely if resident
  memory exceeds it.
- Evaluator cache sized from that budget (`evaluationMemoryMiB`).
- Training chunks inside a study adapt instead of staying at 256 updates.

### Checkpoints (`CHECKPOINT-RECOVERY-5.5.md`)

- Study checkpoints: manifest with a body hash, previous manifest, hashed engine states, transactional publication.
- Command line: `checkpoint`, `resume`, `replaceCheckpoint`, `checkpointSeconds`, `checkpointUpdates`,
  `checkpointStages`, `requireComplete`. Standard, Deep and Research presets checkpoint by default.
- Desktop: every study is checkpointed; `/api/study/checkpoints`, `/api/study/resume`, `/api/study/discard`.
- Result documents carry a `completion` object and a `run.checkpoint` block.

### Interface

- **Study accuracy and recovery** panel: live counts, stage, checkpoint and memory status, processing mode; per
  variant whether training and evaluation are complete, whether confidence is calibrated, whether the best action is
  supported, whether the tolerance is met, which quality metric was used, and whether the study can be resumed;
  warnings; saved studies with Resume and Discard.
- No completion time is shown. The only percentage is the share of planned measurements that are finished.

### Launchers and documents

- `Run 5.5 quick study.bat`, `Run 5.5 standard study.bat`, `Resume 5.5 standard study.bat`.
- `USER-GUIDE-5.5.md`, this report, the six reports named above and in `VALIDATION-5.5.md`, `BUILD-5.5.md`.

## Defects repaired

| Defect | Repair |
|---|---|
| Conditional confidence intervals under-covered with rare large payoffs (5.4: 86.57%). | Bounded-payoff intervals, or an explicit `uncalibrated` verdict. |
| A zero standard error from a sampled evaluation could be read as exact. | Exactness is declared by the evaluator, never inferred. |
| An interrupted study could not be continued. | Automatic checkpoints and resume. |
| Exact ICM evaluations in studies and research were slowed many times over by a small evaluator cache. | Cache sized from the process budget; research runner uses 1,024 MiB. |
| Training-dominated studies did not benefit from threads. | Seeds run side by side. |
| Windows and Linux results differed in the last digit of paired standard errors. | Direct value used. |

Found and repaired during 5.5 development (details in `VALIDATION-5.5.md`): the first checkpoint restore used the
wrong loader and silently retrained; a killed writer left a temporary file; a state trained past an unmeasured budget
could have been evaluated at the wrong deal count.

## Preserved

Eight-handed tournament support, six-player postflop solving, weighted ranges, multiple bet and raise sizes, the
CFR-family training methods, chip EV, ICM, side pots, all-in situations, linked preflop-to-river solving, individual
antes, tournament presets, exact and sampled evaluation, raw and EMZ1 solver checkpoints, CPU-only, Automatic, Hybrid
and GPU-preferred modes, the desktop interface, the command-line interface, JSON and CSV exports, the Quick, Standard,
Deep and Research presets, and the hardware validation utility. Default structure: small blind 0.5 BB, big blind 1 BB,
antes 0.1 BB per player, eight-player starting pot 2.3 BB.

The complete 5.4 regression suite was rerun. Five of its tests were edited because they asserted behaviour that 5.5
changed on purpose; each edit is listed in `VALIDATION-5.5.md`.

## Behaviour changes to be aware of

- Studies that 5.4 called `ranked` may now be `unresolved` or `uncalibrated`. The calibrated intervals are several
  times wider; more evaluation samples are needed to resolve small EV gaps.
- A declared quality tolerance can no longer be met with sampled quality.
- Peak memory during a study is higher: several seeds are resident together and the evaluator cache is larger.
- Standard, Deep and Research studies on the command line create a `<result>.checkpoint` folder and refuse to
  overwrite it.
- Result documents have new fields; older ones remain readable.

## Remaining limitations

See `validation/5.5/NOT-IMPLEMENTED.md`. The most important:

- No calibrated confidence across independent trainings, and none for sampled quality.
- The default trainer is not faster and not closer to equilibrium than in 5.4.
- Exact six-player and eight-handed evaluation is as expensive as before apart from cache effects.
- No physical Windows or NVIDIA GPU testing.
- Nothing here certifies equilibrium play in full eight-handed no-limit Hold'em.
