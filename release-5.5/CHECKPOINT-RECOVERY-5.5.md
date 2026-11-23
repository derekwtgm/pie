# Checkpoints and study recovery — EightMax 5.5

5.4 could save a solver checkpoint and export a partial study, but an interrupted study could not be continued.
5.5 saves decision studies automatically and resumes them with the same result as an uninterrupted run.

Implementation: `source/native/study_checkpoint55.hpp` (format, commit protocol, loading), `source/native/study52.hpp`
(scheduling and restore), `source/native/study_jobs.h` (desktop endpoints), `source/web/lib_study_ui.js` (panel).

## What is saved

A study checkpoint is a folder:

| File | Content |
|---|---|
| `manifest.json` | The committed description of the study so far. |
| `manifest.prev.json` | The manifest committed before it. |
| `job-V-S.gN.state` | Engine state of variant V, seed S, generation N. The two newest generations of each seed are kept. |
| `request.json` | Desktop only: the fixture and options, so the study can be resumed without re-entering them. |

The manifest holds:

| Requirement | Where |
|---|---|
| Training algorithm and configuration | Each recorded measurement stores the engine's complete `trainer` object; the study fingerprint covers the fixture, variants and any trainer override. |
| RNG state, regret state, average-strategy state, completed deal count | Inside the engine state file. These are the existing EMMW4 solver checkpoint bytes, the same ones `mwcli spec n threads out.state` writes. No new solver format was introduced. |
| Current study stage | Per seed: the budget index being trained, deals and updates reached, cumulative training seconds, observed device path. |
| Completed seeds and evaluation budgets | Per seed: the full measurement record of every completed budget (action EVs, frequencies, standard errors, payoff bounds, quality, seeds of the evaluation streams). |
| Statistical metadata | `calculationVersion` (`study-5.5-bounded-eb-v1`); evaluation and quality seeds per measurement. |
| Study configuration fingerprint | `studyFingerprint`: SHA-256 over the fixture, variants, seeds, budgets, table budget, processing mode, trainer override and evaluation sample overrides. Threads, time limits and checkpoint settings are deliberately excluded: they do not change results. |
| Checkpoint format and calculation versions | `format: "EightMax study checkpoint"`, `formatVersion: 1`, `calculationVersion`, `version`, `build`. |

## When it is saved

| Trigger | Default | Option |
|---|---|---|
| Elapsed training time | every 60 s | `checkpointSeconds` (0 = off) |
| Training updates | off | `checkpointUpdates` |
| A seed finished training a budget (before its evaluation) | on | `checkpointStages` |
| A measurement completed | always | — |
| Stop, time limit, process memory limit | always, at the point reached | — |

Desktop studies are always checkpointed, into `Documents\EightMax\studies\<id>`. On the command line Standard, Deep and
Research presets checkpoint into `<result>.checkpoint`; `checkpoint=DIR` enables it for any study and `checkpoint=off`
disables it.

## Commit protocol

One mutex serialises commits.

1. The engine state is written to a temporary file beside its destination, flushed, committed to disk and renamed
   (the 4.6 transactional writer in `state_file.hpp`).
2. Its SHA-256 and length are read back from the file.
3. The current manifest is copied to `manifest.prev.json`; the new manifest, naming the new state and hash, replaces
   `manifest.json` through the same writer. The manifest carries the SHA-256 of its own body.
4. Only then is the seed's generation N−2 deleted.

A process killed at any step leaves a manifest whose named state files exist and match their hashes. Work since
that commit is lost. Nothing committed is damaged.

## Loading

Resume verifies, in order: format and version, the body hash, the study fingerprint, the calculation version, the
build, and the SHA-256 and length of every named state file.

| Finding | Behaviour |
|---|---|
| `manifest.json` unreadable or its hash wrong | `manifest.prev.json` is used; the result records this. |
| Both manifests unusable | Refused (exit code 5). Nothing is changed. |
| Different study (fingerprint) or different build | Refused. Nothing is changed. |
| An engine state missing or not matching its hash | That state is discarded, never used. The seed is retrained from its start; its recorded measurements are kept. A warning is reported. |
| An engine state trained past a budget whose measurement is missing | Discarded and the seed retrained, so every budget is evaluated at exactly its own deal count. |
| Temporary files left by a killed writer | Removed on resume. |
| A checkpoint already exists and resume was not requested | Refused. Existing checkpoints are never overwritten unless `replaceCheckpoint` is given (command line) or the saved study is discarded (desktop). |

## Exact continuation

**Contract.** Two study results are the same result when they are byte-identical after removing *session fields*:
wall-clock timings, memory readings (including table megabytes, which depend on allocation history after a restore),
worker counts, and checkpoint bookkeeping. Every measurement, standard error, interval, verdict, seed and identifier
must match exactly. `source/tools/study_equivalence55.py` implements this and prints the canonical SHA-256 of each
document.

Why this holds:

- Training results do not depend on the worker count or on how updates are split into calls; 5.5 relies on
  `train(a)` then `train(b)` equalling `train(a+b)`, which the existing continuation tests establish.
- Every evaluation stream is derived from the plan (base seed, training seed, budget, variant, purpose), not from
  the order of execution.
- Exact and sampled evaluation results do not depend on the worker count or cache size.
- Seeds share no state.

**Scope.** Tested on CPU, with one to four threads and one to three seeds side by side. GPU-assisted modes could not
be exercised (no GPU in the development environment); the engine's existing claim that device results equal CPU
results was not re-verified here. No bitwise claim is made for GPU modes.

**Not identical by design:** timing, memory and thread fields, and the `checkpoint` block.

## Test evidence

`source/tests/v55.test.js` (all passing; see `VALIDATION-5.5.md`):

| Test | What it establishes |
|---|---|
| seeds side by side, evaluator cache size and checkpointing never change a result | One seed at a time, three side by side, a 64 MiB evaluator cache, and checkpoints every 0.05 s or 3,000 updates all equal the reference. A finished study keeps only its manifests. |
| time limit, cancellation and repeated hard kills | A time-limited study resumed twice, a cancelled study resumed, and a study killed with SIGKILL at four different moments then resumed, each equal the uninterrupted result with no warnings. After every kill the manifest parses and every named state matches its hash. |
| damaged checkpoints | Refusal without resume; refusal for another study; an edited manifest fails its hash; a flipped byte in a state is detected and the seed retrained; a truncated manifest falls back to the previous commit; destroyed manifests are refused; `replaceCheckpoint` starts over. Results equal the reference. |
| process memory budget | A study over its budget stops with `processMemoryLimit`, keeps a valid checkpoint and resumes to the reference result. |
| longer presets checkpoint by default | Standard checkpoints beside the result; Quick does not; the default checkpoint is not overwritten; resuming a finished study restores every measurement. |
| desktop | Start, live progress with checkpoint commits, Stop, saved-study list, refusal to reuse an id, resume, host process killed mid-study, resume in a new process, completion equal to the command-line reference, discard. |

`source/tools/study_ui55.js` repeats the desktop sequence in a real browser (Chromium) against the host; results in
`validation/5.5/ui/`.

Two defects were found and repaired during this testing; both are recorded in `VALIDATION-5.5.md`:
the first restore path used the wrong loader for external-sampling engines (the study silently retrained instead of
continuing — results were still correct), and a killed writer left a temporary file behind.

## Backward compatibility

- Raw and EMZ1 solver checkpoints are unchanged. The engine state inside a study checkpoint is an ordinary raw state.
- The existing regression tests for 5.1–5.4 solver checkpoints were rerun unchanged (`VALIDATION-5.5.md`).
- Study checkpoints are new in 5.5; there is no older study-checkpoint format to read.
- Study result documents from 5.2–5.4 still open. Their statistics are reviewed, not rewritten
  (`STATISTICAL-VALIDATION-5.5.md`).

## Limits

- Resume requires the same build. A checkpoint from another build is listed and refused.
- Time and cancellation limits are cooperative. Training reacts within one chunk (adaptive, at most about 0.1 s of
  work); an evaluation in progress reacts at its own polling points.
- A stop during an evaluation discards that evaluation; it is repeated on resume.
- The process memory budget is a stop condition checked between training chunks and evaluations, not an allocation
  cap. A single evaluation that grows quickly can exceed it before the next check.
- After a finished study the engine states are deleted; only the manifests remain. If `manifest.json` of a finished
  study is damaged, the previous manifest names states that no longer exist and those seeds are retrained.
- Not tested: power loss (as opposed to process kill), network drives, and native Windows file semantics. The
  Windows code path uses the same transactional writer as the solver checkpoints.
