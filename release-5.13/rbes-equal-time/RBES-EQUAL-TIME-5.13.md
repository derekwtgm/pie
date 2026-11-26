# EightMax 5.13 — `rbes` against the default trainer at equal training time (for your PC)

This is the launcher that Phase 4 needs before it can decide whether `rbes` becomes the automatic trainer for games
with ranges. It is a separate small package: it does not change release 5.13 and can be extracted anywhere.

## What to do

1. Extract `EightMax-5.13-rbes-equal-time.zip` into a new folder.
2. Optional, two minutes: double-click **`Run rbes equal-time quick trial.bat`**. It should end with
   "P1 equal-deals check ... PASSED" and "QUICK TRIAL: no decision".
3. Close other heavy programs and double-click **`Run rbes equal-time comparison.bat`**. Leave the PC alone while it
   runs: expect one and a half to two hours on the i7-13700F (six runs at a time, each on its own processor).
   If it is interrupted, start it again: finished units are kept.
4. Send back the folder **`rbes-equal-time-results`** (five small files: `summary.txt`, `summary.json`, `raw.jsonl`,
   `plan.json`, `machine.txt`; the `units` folder is not needed).

## What it is

`eqtime513.exe` is built from the unchanged engine source of release 5.13 (build `e9ce3436fa829e47`) plus one file,
`eqtime513.cpp` (included), which trains until the clock says stop and then computes the exact NashConv. `mwcli.exe`
has no training mode that is stopped by the clock; that is the only reason for a new program. It uses no GPU.

Before it reports anything it checks itself (rule P1): after 20,000 sampled deals both trainers must reproduce, in
all 20 games, the NashConv recorded from the Linux build, to the last bit (40 values).

## The plan, written before any measurement on your PC

* **Question.** Does `rbes` reach a lower exact NashConv than the default trainer in the same training time?
* **Games.** The 20 reference games of the 5.10 experiment: few hands (7), ranges (8), tournament (5). The subclass
  **WIDE** is the six games in which a seat holds at least 10 hands: `rg-hu-river`, `rg-river3`, `rg-hu-turn`,
  `rg-turn3`, `rg-turn4`, `rg-icm3-river`.
* **Arms.** Default trainer and `rbes`, same 20 seeds (5131 to 5150, not used before), one thread, 64-bit training
  streams in both (a fast PC would otherwise reach the 10,000,000-update bound of the old streams).
* **Budgets.** 1 s, 4 s and 16 s of training, each a fresh run.
* **Statistic.** Per game and budget the mean over seeds of ln(NashConv rbes / NashConv default), paired by seed,
  Student-t interval. Primary: 4 s, one interval per game at level 0.05/20. Secondary: all 60 game-budget intervals
  at level 0.05/60. Verdicts: better, worse, unresolved.
* **Rule.**
  * P1: the equal-deals check passes, otherwise nothing counts.
  * P2: at least 18 of 20 seeds valid in every WIDE game, otherwise nothing is decided.
  * P3: `rbes` becomes the trainer that studies choose automatically for games in which a seat holds at least 10
    hands **if** it is better in the primary family on at least 4 of the 6 WIDE games, worse in no interval of either
    family on any WIDE game, and reaches the table limit in no run in which the default does not.
  * P4: otherwise `rbes` stays opt-in; an interval that is worse is named, a lack of resolved intervals is reported
    as unresolved.
  * P5: the three classes are reported with the 5.10 rule as information; nothing outside WIDE changes a default.
  * Whatever P3 says, a spec without an estimator key keeps the default trainer and its states; `rbes` is never
    chosen where it is unsupported and never by the JavaScript panel.
* **Limits.** Small games with exact evaluation only. This says nothing direct about the shipped fixtures with hand
  groups, where no exact NashConv exists. Several units run at once; the arms of a unit run one after the other on the
  same processor and their order alternates with the seed, so load adds noise but does not favour an arm.

The full text of the plan is inside the program and is written to `plan.json` before the first run starts.

## What was tested before delivery

* Linux build and Windows build (under Wine, from a folder with a space in its name): the quick trial runs, resumes,
  and reproduces the recorded values bit for bit.
* One reference value was reproduced with `mwcli` of release 5.13 (train, then `--gain`): identical bits.
* A hosted Windows runner ran the quick trial (see `WINDOWS-CI` note in the delivery folder).
* Not tested: your PC. The six-at-a-time default assumes that even-numbered logical processors are separate
  performance cores, as on the i7-13700F. `--jobs N` (append to the line in the `.bat`) changes the number.

No percentage of GTO follows from this experiment.
