# EightMax 5.6 user guide

What changed for you since 5.5: studies train faster with the same results; exact multiway and ICM evaluations need far less memory and time; every result now says what its number of trainings does and does not support; two programs can no longer work on the same saved study at once. The default training method is the one of 5.5.

## Running a study

1. Extract the complete ZIP into a new folder. Keep your old folder and saved studies.
2. On Windows open `EightMax.exe`. No separate Python or Node installation is needed to run the application.
3. Open **Decision study**. Choose a fixture or open your saved fixture.
4. Choose Quick, Standard, Deep or Research. Quick is preliminary (two trainings). Standard requests five independent trainings, Deep ten. Research leaves the current settings under your control. A preset does not guarantee accuracy.
   **New in 5.6:** five trainings describe the five trained strategies and nothing more. A statement about trainings in general needs at least six agreeing trainings for a study with one variant and one budget, seven for two variant-budget cells, nine for three variants at three budgets (the result tells you the number). Deep's ten trainings are enough for up to twenty cells. Use Deep, or set the seed count, when you want that statement.
5. Set seed count, increasing deal budgets, worker threads, time limit, memory and evaluation samples. Sample counts apply to sampled evaluation only.
6. Choose CPU only, Automatic, Hybrid or GPU preferred. CPU fallback remains available. The observed device can be CPU even when another mode was requested.
7. Click **Run study**.
8. Watch the **Study accuracy and recovery** panel (below the study form).
9. Export JSON for full diagnostics, CSV for tables. Existing saved studies and solver checkpoint formats remain supported.

## The Study accuracy and recovery panel

While a study runs it shows:

| Line | Meaning |
|---|---|
| Measurements complete | Finished measurements out of those planned (one per variant, seed and budget). The percentage is a share of that count. It is not a time estimate; exact evaluations have unpredictable durations and no finish time is shown. |
| Training seeds complete | Seeds that finished every budget, and how many run side by side. |
| Current seed | The seed that last reported, with its sampled-deal count. |
| Stage | Training, saving a checkpoint, evaluating action EVs, evaluating quality. |
| Checkpoint | Number of commits and how long ago the last one succeeded. A failed write is shown in capitals. |
| Memory | Resident memory now, its peak, and the process memory budget. |
| Processing | The mode you requested and the device actually observed. |

After a study it shows, for every variant:

| Column | Meaning |
|---|---|
| Training | Every requested seed reached every budget. |
| Evaluation | Every requested evaluation finished. |
| Confidence calibrated | **yes** only when the evaluation is exact or the bounded-payoff interval applies. **NO** means no ranking is stated; the reason is listed underneath. |
| Best action supported | **yes** only when a best action is *declared*: the measured strategies rank it first by the declared margin in calibrated intervals **and** an exact sign test over the independent trainings supports it for the typical training. Underneath: the verdict for the measured strategies, then `across trainings:` with its verdict, the number of trainings and the number needed. (For a result file made by 5.5 the column keeps its 5.5 meaning.) |
| Tolerance met | The declared tolerance was met at some budget, with calibrated evaluation uncertainty. |
| Quality metric | `exact (inside the abstraction)` or `restricted (sampled one-decision gain)`. The restricted metric is a lower bound and never exploitability. |
| Checkpoint / Can resume | Whether the study was saved and whether work remains. |

### Reading the verdict

A result has two verdicts. The first is about the strategies that were trained and measured (unchanged from 5.5). The second, new in 5.6, is about trainings in general.

- `ranked`: for the strategies that were trained and measured, the selected action beats every other action by the declared margin in calibrated intervals, and the model-based interval across trainings agrees. It is not a guarantee about a new training run.
- `smallEdge`: a positive edge is supported, smaller than the declared margin.
- `nearTie`: the two leading actions are within the margin. This does not validate a mixed strategy.
- `unresolved`: the evidence does not establish a ranking.
- `uncalibrated`: the evaluation uncertainty cannot be calibrated (for example a result file from 5.4 or earlier). Nothing is ranked. Re-run the study.
- `incomplete`: requested work is missing. Resume the study.

Across trainings (`confidence.replication.verdict` in the JSON, `across trainings:` in the panel and the printed summary):

- `insufficientReplication`: too few independent trainings for any statement about trainings in general. This is what a Quick or Standard study reports. It is not a defect of the result; it is its scope.
- `ranked`: more than half of all trainings would rank the leader first by the margin (exact sign test; no assumption about how training results are distributed). This is a statement about the *typical* training. It is not a statement about the average over trainings and not a promise about the next training.
- `smallEdge`: the same for a positive edge smaller than the margin.
- `trainingsDisagree`: at least one training is certain, for itself, that a different action is better. No best action is declared, whatever the others say. Look at the per-seed table.
- `unresolved`: the trainings do not agree often enough.
- `uncalibrated`, `incomplete`: as above.

**Best action declared** is yes only when both verdicts are `ranked`. The headline then reads "Prefer ..."; otherwise it reads "Leader among the measured trainings: ... (no best action declared)".

Every result also lists, under **What this study does not establish**, the things it cannot tell you: too few trainings, the share of trainings that could fail without any of them appearing in the study (45% with five trainings, 26% with ten, 14% with twenty), sampled evaluation, an uncalibrated quality figure. These lines are information about the study's reach, not errors.

The calibrated intervals are wider than the 5.4 intervals, often several times wider. If a study stays `unresolved`, raise **Action evaluation samples**, or use exact evaluation where the fixture allows it. If it reports `insufficientReplication`, raise the seed count.

## Saving and resuming

Desktop studies are saved automatically:

- after every completed measurement;
- when a seed finishes training a budget;
- at least once a minute while training (set `checkpointSeconds` or `checkpointUpdates` in the options to change this).

Saved studies are kept in `Documents\EightMax\studies\`, one folder per study.

A study stops early when you press **Stop**, when its time limit or the process memory budget is reached, when the application is closed, or when the process ends unexpectedly. In every case:

1. Open **Decision study**.
2. Find the study under **Saved studies** in the Study accuracy and recovery panel.
3. Press **Resume**.

The resumed study continues from its last committed checkpoint and produces the same result as an uninterrupted run. After a crash the work since the last commit is repeated; nothing committed is lost. A study saved by a different build of EightMax (including 5.5) is listed but cannot be resumed; start it again in 5.6.

**New in 5.6:** only one program can work on a saved study at a time. If the desktop application is continuing a study and you start the same study from a command prompt (or start a batch file twice), the second one stops with `error 409: the study checkpoint ... is in use` and changes nothing. The lock disappears when the first program ends, however it ends.

**Discard** deletes a saved study folder. A finished study keeps a small record there until you discard it.

An exported JSON result is a report, not a checkpoint. Resume from the saved-study list.

## Memory

- **Training table limit** applies to one seed's tables.
- Several seeds train and evaluate side by side. How many depends on the worker threads and on the **process memory budget**, which defaults to 70% of installed memory. On a 16 GB computer that is about 11 GB.
- The evaluation cache uses what the process budget leaves. In 5.6 exact ICM and multiway evaluations no longer need a large cache: a table is reduced to a few kilobytes once it is built, a 32 MiB cache gives the same values as a 1,024 MiB one (tested), and a 128 MiB cache took about the same time as a 1,024 MiB one on the development machine.
- If resident memory exceeds the process budget the study stops safely, keeps its checkpoint, and can be resumed with a larger budget or fewer threads.

The process budget is checked while running; it is not a hard cap on allocations. Keep headroom for Windows and other programs.

## Quality and uncertainty

Exact NashConv sums all seats' unilateral best-response gains inside the configured game. Largest unilateral gain is the largest seat's gain. Two-player chip-EV exploitability uses NashConv / 2. A sampled one-decision response is a restricted response test; a small value cannot certify near-GTO play.

`STATISTICAL-VALIDATION-5.5.md` describes the calibrated intervals for the measured strategies, their assumptions and what they refuse to state. `STATISTICAL-VALIDATION-5.6.md` describes the across-trainings verdicts and how they were tested against trainings that fail.

Physical RTX 4060 Ti performance and native Windows execution were not validated in the development environment. `WINDOWS-TESTS-5.6.md` lists what to run on your PC.

## Included launchers

- **Run 5.6 Windows validation.bat** repeats the release validation on your PC and writes a report (see `WINDOWS-TESTS-5.6.md`). Run this first.
- **Run 5.6 quick study.bat** and **Run 5.6 standard study.bat** run the known A-K-Q study and save the result beside the application.
- **Run 5.6 replicated study.bat** runs it with nine trainings, enough for that fixture to be judged across trainings.
- **Resume 5.6 standard study.bat** resumes that standard study if it was interrupted.
- **Validate CUDA hardware.bat** and **GPU self-test.bat** check an NVIDIA GPU on your computer.

## Command line

From the extracted folder:

```bat
mwcli.exe --study studies\known-akq-river.emfix.json my-study.json preset=standard processingMode=cpu timeLimitSeconds=600 threads=4
```

Standard, Deep and Research studies are checkpointed into `my-study.json.checkpoint` by default. To continue an interrupted study, repeat the same command with `resume=1`:

```bat
mwcli.exe --study studies\known-akq-river.emfix.json my-study.json preset=standard processingMode=cpu timeLimitSeconds=600 threads=4 resume=1
```

An existing checkpoint is never overwritten unless you pass `replaceCheckpoint=1`.

| Option | Meaning |
|---|---|
| `seeds`, `budgets`, `variants`, `memoryMiB`, `evaluationSamples`, `qualitySamples`, `threads`, `timeLimitSeconds`, `preset`, `processingMode`, `quiet` | As in 5.4. Explicit options override preset defaults. |
| `checkpoint=DIR` or `checkpoint=off` | Checkpoint folder for any study, or no checkpoint. |
| `resume=1` | Continue the study in the checkpoint folder. |
| `replaceCheckpoint=1` | Discard an existing checkpoint in that folder and start again. |
| `checkpointSeconds=S`, `checkpointUpdates=N`, `checkpointStages=0` | Save every S seconds or N training updates (0 turns either off); `checkpointStages=0` stops saving when a budget finishes training. |
| `parallelSeeds=N` or `auto` | Seeds trained and evaluated side by side. |
| `processMemoryMiB=X` | Process memory budget (0: 70% of installed memory). |
| `evaluationMemoryMiB=X` | Evaluation cache (0: automatic). |
| `requireComplete=1` | Exit code 3 when the study is incomplete. |
| `opponentEnumeration=river`, `river-shared` or `river-cross` | Experimental trainers; see `CONVERGENCE-5.6.md`. None is the default: in the fixed-plan comparison the 5.6 candidate was better on a four-player turn game, worse on a three-player river game and unresolved on two heads-up games at equal time. |

Exit codes: 0 written (the text says COMPLETE or INCOMPLETE), 1 failed, 2 usage, 3 incomplete with `requireComplete=1`, 4 result not saved, 5 checkpoint refused.

`seeds=N` takes the first N seeds of the fixture; in 5.6 a count larger than the fixture's list (up to 64) continues with the whole numbers after its last seed, so `seeds=9` works with every fixture. An explicit comma-separated list is still accepted.

Environment variables for comparisons with 5.5 (not needed in normal use): `EM_EV_KEEP_SCORES=1` keeps showdown tables as 5.5 did; `EM_EV_NO_PASSIVE=1` enumerates passive runouts card by card as 5.5 did. Both give the same values to at least nine significant digits and are slower.
