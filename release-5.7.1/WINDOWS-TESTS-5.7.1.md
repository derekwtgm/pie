# EightMax 5.7.1 — checks to run on your Windows PC

5.7 ran on your PC (Windows 11 Home, Core i7-13700F, 15.8 GiB, RTX 4060 Ti 8 GB): 81 checks passed, 1 failed. 5.7.1
repairs the failed check and a second check that passed without testing anything, and one engine defect found while
doing so. **The 5.7.1 programs have not run on Windows hardware.** They were built on Linux and run under Wine; the
PowerShell script could not be executed during development at all. This page says what to run and what to send back.
Nothing needs to be installed.

Extract `EightMax-Windows-5.7.1.zip` into a **new** folder you can write to (for example `Desktop\solver\EightMax-5.7.1`).
Do not run it from inside the ZIP and do not extract it over the 5.7 folder.

## 1. The focused validation (about 2 to 5 minutes) — run this first

Double-click **`Run 5.7.1 focused validation.bat`**.

It tests only what 5.7.1 changed: checkpoint integrity and the process memory budget. No GPU test, no throughput
benchmark. It runs two steps and writes three files into the release folder:

| File | Written by | Needs PowerShell |
|---|---|---|
| `Windows-selftest571-5.7.1.json` | step 1: `mwcli.exe --selftest571` | no |
| `Windows-focused-validation-5.7.1.json` | step 2: `source\tools\validate_windows571.ps1 -Focused` | yes |
| `Windows-focused-validation-5.7.1.txt` | step 2, the same as text | yes |

**Please upload all three files.** If step 2 stops with a red PowerShell error, also send a photo or copy of the
window: the 5.7.1 parts of the script have never run, so that would be a defect of the script, and step 1's file
still holds every result.

The window ends with `Overall exit status: 0` when every required check passed, and `1` when a check failed or could
not be made.

### What step 1 checks (24 checks; no PowerShell)

`mwcli.exe` runs small studies as separate processes in a temporary folder and damages **copies** of one interrupted
study's checkpoint. Your saved studies are never touched, and the last check verifies that even the temporary source
checkpoint is byte-identical at the end.

| Check | What is done | What must happen |
|---|---|---|
| checkpoint P | an untouched copy is resumed | resumes from `manifest.json`, same result as an uninterrupted study |
| checkpoint A | white space added to both manifests, no value changed | **accepted**: formatting is not data; same result |
| checkpoint B1 / B2 | a recorded measurement altered, checksum not updated (newest manifest / both) | detected: previous manifest used / refused with exit 5, nothing written |
| checkpoint C1 / C2 | the stored checksum altered, data untouched (newest / both) | detected: previous manifest used / refused |
| checkpoint D1 / D2 | one byte of an engine state flipped / the state truncated | the state is discarded by its SHA-256 and length, the seed retrained, same result |
| checkpoint E1 | newest of two committed generations destroyed | the verified previous generation is used |
| checkpoint E2 | the process is killed during the first commit after such a recovery | the previous generation is still intact and resumes (the engine repair of 5.7.1) |
| checkpoint F1 / F2 / F3 | state files / `manifest.json` / both manifests removed | retrained / previous manifest used / not treated as a checkpoint |
| checkpoint S | — | the source checkpoint was not modified |
| memory E | the study with the automatic budget (control) | completes, **no** memory stop reported |
| memory A | the same study with a 48 MiB process budget (its tables grow to about 96 MiB per seed) | **stopped by the budget**, incomplete, resumable, checkpoint verified |
| memory B | resumed with the automatic budget | completes with the measurements of the control |
| memory C | memory accounting | budget, peak, table and evaluator figures reported; only completed work committed |
| memory D1 / D2 | invalid budgets (-1, nan, inf, abc) / a 0.5 MiB budget | refused, nothing written / stops at once, keeps a valid checkpoint, resumes |
| controls N1 to N4 | the verdicts above applied to observations they must reject | a normal completion is **not** a memory stop; exit 0 is **not** a refusal |

Each check is `passed`, `failed` or `untested` (a step it depends on could not be carried out; the reason is given).
`untested` is never counted as passed. Under Wine and on Linux all 24 passed.

### What step 2 adds

The script records the machine, verifies every file of the release against `SHA256SUMS.txt`, runs the self-test again
and imports its 24 checks one by one with their evidence (corruption method, checksums before and after, exit status,
manifest generation used, whether the result file was written, standard output and error of the processes of a failed
check). It also checks that all 24 expected checks are in the report and that the report agrees with the exit status
of `mwcli.exe`.

## 2. The full validation (10 to 40 minutes) — after the focused one

Close other heavy programs, then double-click **`Run 5.7.1 Windows validation.bat`**.

This is the 5.7 validation with the two defective checks replaced by the 24 checks above: environment, integrity,
the 5.7 self-test, 11 golden training states, thread determinism up to all 24 logical processors, exact evaluation,
the known game, recovery (time limit, kill, second process refused), configuration handling, throughput, the desktop
host and the GPU (CUDA against the CPU on your RTX 4060 Ti). It writes:

| File | Written by | Needs PowerShell |
|---|---|---|
| `Windows-selftest-5.7.1.json` | step 1: `mwcli.exe --selftest57` | no |
| `Windows-selftest571-5.7.1.json` | step 2: `mwcli.exe --selftest571` | no |
| `Windows-validation-5.7.1.json` | step 3: `source\tools\validate_windows571.ps1` | yes |
| `Windows-validation-5.7.1.txt` | step 3, the same as text | yes |
| `hardware-validation.json` | the GPU section of step 3 | yes |

**Please upload all five files.**

Options (add them after the file name in a Command Prompt): `-Quick` (skips the throughput section and shortens the
recovery study), `-SkipGpu`, `-SkipIntegrity` (skips re-hashing all files).

## 3. What to upload

| After | Files |
|---|---|
| the focused validation | `Windows-selftest571-5.7.1.json`, `Windows-focused-validation-5.7.1.json`, `Windows-focused-validation-5.7.1.txt` |
| the full validation | `Windows-selftest-5.7.1.json`, `Windows-selftest571-5.7.1.json`, `Windows-validation-5.7.1.json`, `Windows-validation-5.7.1.txt`, `hardware-validation.json` |

All are written into the release folder, next to `EightMax.exe`. Reports of an earlier run are deleted at the start
of each run, so a file you find afterwards was written by that run. (`Windows-selftest571-5.7.1.json` is written by
both launchers; the later run replaces it.)

## 4. Reading the result

Every check has a status and a class.

| Status | Meaning |
|---|---|
| passed | the check ran, produced the condition it is about, and the program reacted as documented |
| failed | the program did not react as documented, **or the condition the check is about did not occur** |
| skipped | deliberately not run: an option you gave, or hardware that is not present; the reason is stated |
| untested | planned but not possible: a step it depends on failed, or the script stopped; the reason is stated |
| info | a measurement (throughput, thread scaling), not a pass/fail check |

Classes: `gate` (must pass on every Windows PC), `environment`, `hardware` (needs an NVIDIA GPU), `information`.
The exit status is 0 only when no gate check failed and none is untested; 1 otherwise; 2 if the script itself failed.

Compared with your 5.7 report you should see: `recovery / damaged manifest refused` and the two `memory / ...` checks
are gone; in their place are 14 `checkpoint integrity`, 6 `memory budget` and 4 `verdict controls` checks and three
`self-test 5.7.1` checks. The expected totals of a full run on your PC are 106 passed, 0 failed (5.7: 81 passed,
1 failed); of a focused run, 36 passed.

Two checks of the recovery section are stricter than in 5.7: "time-limit interruption and resume" and "killed
process, then resume" are reported as `untested`, not `passed`, if the study had already finished before it could be
interrupted. On your PC the 5.7 run interrupted both (first run complete: False; killed while running: True), so
both should pass again.

## 5. Things that are expected

- **A 5.7 saved study cannot be resumed by 5.7.1.** A study checkpoint is tied to the build that wrote it; 5.7.1
  refuses a 5.7 checkpoint with "the checkpoint was written by build e4668abe7903f8b0; this is build ..." and leaves
  it untouched. Finish it with 5.7, or start it again with 5.7.1. Solver state files (`.state`) are not affected.
- The memory check uses about 350 MiB of RAM for a few seconds (the control study) and writes up to about 300 MB of
  temporary checkpoint files to `%TEMP%`, which are removed.
- The focused validation does not use the GPU. GPU results come only from the full validation.

## 6. If something fails

Keep the report files and upload them: a failed or untested check carries its evidence (exit status, standard output,
standard error, checksums, the manifest generation used). To repeat only the self-test, in a Command Prompt in the
release folder:

```bat
mwcli.exe --selftest571 studies "%TEMP%\em571" all
```

(`checkpoint` or `memory` instead of `all` runs one half.) Its report is `%TEMP%\em571\selftest571.json`.
