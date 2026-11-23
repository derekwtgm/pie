# EightMax 5.7.1 — patch notes

5.7.1 is a reliability patch to 5.7 (build `e4668abe7903f8b0`). It follows the first physical Windows run of the
5.7 validation (Windows 11 Home, Core i7-13700F, RTX 4060 Ti: 81 passed, 1 failed). Build identifier of 5.7.1:
`65e835e6b7060960`.

No training, evaluation, statistics, GPU or interface code was changed. The measurements of complete studies and
the training states are identical to those of the 5.7 binary (see "What did not change").

## What changed

### 1. The validator's checkpoint-corruption check was wrong and is replaced

`recovery / damaged manifest refused` (the one failed gate on Windows) changed `"resumeCount":` to `"resumeCount" :`
in the manifest — white space only — and expected a refusal. The manifest's `bodySha256` is the SHA-256 of the
**canonical serialisation of the parsed body**, not of the file's bytes (documented in
`source/native/study_checkpoint55.hpp`). Formatting is therefore not data, the checkpoint was intact, and the
engine was right to resume it. The same edit gives exit 0 with the unchanged 5.7 Linux binary too. The defect was
in the validator, not in the engine.

The check is replaced by 14 checks that damage what the integrity data really covers (`mwcli --selftest571`,
section `checkpoint`): an untouched copy (positive control); white space only (accepted); a recorded measurement
altered without updating the checksum; the stored checksum altered; an engine state with a flipped byte and a
truncated one; two committed generations with the newest destroyed; a kill during the first commit after a recovery;
missing state files and missing manifests; and a final check that the source checkpoint was never modified.

### 2. The validator's memory check passed without a memory stop and is replaced

`memory / a too-small process budget stops the study without losing it` gave the `flop3-kings-small` fixture a
24 MiB process budget. That fixture's tables are 0.07 MiB and the whole process peaked at 8.4 MiB on Windows, so
the budget was never reached; the study completed, `stoppedByProcessMemory` was `false`, and the check passed
because it accepted "stopped **or** complete". The following check ("resumed with the automatic budget and
completed") then resumed a finished study and passed as well.

Both are replaced by 6 checks (section `memory`) on `flop3-kings-detailed`, whose tables grow to about 96 MiB per
seed: a control that completes and reports no stop; a 48 MiB budget that **is** reached (the check fails if it is
not); the resume; memory accounting; invalid budgets; and a budget smaller than the idle process.

### 3. One engine defect, found while investigating, is repaired

After a recovery from `manifest.prev.json` (because `manifest.json` was damaged), the first commit of the resumed
study copied the current — damaged — `manifest.json` over `manifest.prev.json` **before** writing the new
`manifest.json`. A process killed, or a write that failed, between those two writes left **no usable manifest**,
although every measurement and state file was intact. This contradicted the checkpoint's stated guarantee and is
present in 5.5, 5.6 and 5.7 (reproduced with the unchanged 5.7 binary:
`validation/5.7.1/reproduction/reproduction-5.7-binary.json`, section E).

5.7.1 copies the current manifest to `manifest.prev.json` only when it still verifies (format and body checksum).
A damaged `manifest.json` is replaced in place and the verified previous generation is kept. One condition in
`Checkpoint::publish` and a 9-line helper; the checkpoint **format is unchanged**.

### 4. Supporting changes

| File | Change |
|---|---|
| `source/native/study_checkpoint55.hpp` | the repair of item 3 (`intactManifestText`, one condition in `publish`) |
| `source/native/state_file.hpp` | test hook `EM_TEST_SAVE_FAULT_FILE`: limits the existing injected save fault to one destination file. Without it, behaviour is as before |
| `source/native/mwcli_selftest571.hpp` (new), `mwcli.cpp` | `mwcli --selftest571 <studies> <work> [all\|checkpoint\|memory]`: the 24 checks, run by the shipped program |
| `source/tools/validate_windows571.ps1` (new) | the 5.7 script with the two defective checks removed, the self-test imported check by check, a `-Focused` mode, evidence kept with failed checks |
| `Run 5.7.1 focused validation.bat`, `Run 5.7.1 Windows validation.bat` (new) | the launchers |
| `source/tests/v571.test.js` (new) | 14 regression tests |
| `source/tests/v48.test.js` | one line corrected: the test compared the version as a number (`+"5.7.1"` is NaN) and now compares it part by part; its tournament-default assertions are untouched |
| `source/tools/ps_lint571.py` (new) | static checks of the PowerShell script |
| `.github/workflows/windows.yml` | runs `--selftest571` and `validate_windows571.ps1` (not executed: no runner was reachable) |
| `source/VERSION` | `5.7.1` |

Smaller corrections in the validation script: a process too short to be sampled no longer reports a peak of
"0 MiB" (it reports none); "time-limit interruption and resume" and "killed process, then resume" are `untested`
instead of `passed` if the study finished before it could be interrupted; reports of an earlier run are deleted
when a run starts.

`validate_windows57.ps1` and `Run 5.7 Windows validation.bat` are kept unchanged as a record. Do not use them with
5.7.1: they contain the two defective checks and expect version 5.7.

## What did not change

Verified, not assumed — see VALIDATION-5.7.1.md for the evidence of each line.

- **Training.** Default external-sampling MCCFR, CFR+ and DCFR options, regret and average-strategy arithmetic,
  sampling, frozen-batch multithreading, thread choice.
- **Evaluation.** Sampled and exact action values, exact best response, multiway evaluation, ICM.
- **Statistics.** `study-5.5-bounded-eb-v1`, `study-5.6-replication-v1`, `study-5.3-tfloor-bonferroni-v1`.
- **GPU.** No CUDA kernel, scheduling or device-selection code was touched; CPU-only, Automatic, Hybrid and
  GPU-Preferred modes and the CPU fall-back are as in 5.7.
- **Formats.** Solver state files (EMMW4, EMZ1), the study checkpoint format (version 1) and the study result
  format are unchanged.
- **Interface.** The desktop application and its pages are the 5.7 ones (rebuilt with the new version and build
  identifier only).
- **Game settings.** Eight-handed: small blind 0.5 BB, big blind 1 BB, ante 0.1 BB per player, starting pot 2.3 BB,
  no big-blind-ante substitution. Multiway, weighted ranges, variable stacks and multiple streets as in 5.7.
- **Memory-budget semantics.** The process budget is still a stop condition checked after every training chunk and
  evaluation, not an allocation cap; zero means automatic (70% of physical memory); any positive number is accepted.

## Compatibility

- **Solver states** written by 5.6 or 5.7 continue under 5.7.1 to the same bytes.
- **Saved studies (study checkpoints) of 5.7 are refused by 5.7.1**, with the reason, and left untouched. This is
  the existing policy (a study checkpoint is tied to the build that wrote it, because exact continuation is only
  defined within one build), not a new restriction. Finish a 5.7 study with 5.7 or start it again.
- The three executables were rebuilt (the version and build identifier are compiled in). They are not the 5.7
  binaries and have **not** been run on Windows hardware or on an NVIDIA GPU.

## What to do

Run `Run 5.7.1 focused validation.bat`, then `Run 5.7.1 Windows validation.bat`, and upload the files listed in
WINDOWS-TESTS-5.7.1.md.
