# EightMax 5.8 — checks to run on your Windows PC

**The 5.8 programs have not run on Windows hardware or on an NVIDIA GPU.** They were built on Linux and run under
Wine; the PowerShell script could not be executed during development at all (as for 5.7.1). The three launchers were run
by Wine's command interpreter, which has no real PowerShell: their self-test steps and report files worked there,
and that run led to a correction of the launchers (`validation/5.8/wine/launchers-under-wine-cmd.md`). This page says what to
run, in which order, and what to send back. Nothing needs to be installed.

What is already known from your PC, and what is not:

| Release | Physical result on the Windows 11 / Core i7-13700F / RTX 4060 Ti PC |
|---|---|
| 5.7 | full validation: 81 passed, 1 failed (the defective check that 5.7.1 replaced); CUDA executed, CPU and GPU agreed |
| 5.7.1 | focused validation: 36 passed, 0 failed, 0 skipped, 0 untested. **The full validation of 5.7.1 was never reported** |
| 5.8 | nothing yet: sections 1 to 3 below |

Extract `EightMax-Windows-5.8.zip` into a **new** folder you can write to (for example `Desktop\solver\EightMax-5.8`).
Do not run it from inside the ZIP and do not extract it over an older folder.

## 1. The focused validation (about 3 to 8 minutes) — run this first

Double-click **`Run 5.8 focused validation.bat`**.

It tests what 5.8 added and nothing else: no GPU test, no throughput benchmark. It writes three files into the
release folder:

| File | Written by | Needs PowerShell |
|---|---|---|
| `Windows-selftest58-5.8.json` | step 1: `mwcli.exe --selftest58` | no |
| `Windows-focused-validation-5.8.json` | step 2: `source\tools\validate_windows58.ps1 -Focused` | yes |
| `Windows-focused-validation-5.8.txt` | step 2, the same as text | yes |

**Please upload all three files.** If step 2 stops with a red PowerShell error, also send a photo or copy of the
window: sections 10 and 11 of the script have never run, so that would be a defect of the script, and step 1's file
still holds every result of the self-test.

The window ends with `Overall exit status: 0` when every required check passed, `1` when a check failed or could
not be made, and `2` when the script did not finish or wrote no report (a script that ends without its report is
never counted as passed).

### What step 1 checks (33 checks; no PowerShell)

| Check | What is done | What must happen |
|---|---|---|
| engine E1 | the evaluation random-number generator | reproduces the published SplitMix64 outputs; a million draws lie in [0, 1) |
| engine E2 | 321,000 block streams | every (seed, seat, block, purpose) has its own stream |
| engine E3 | 50,400 ICM evaluations with a small and a large cache, 2 to 8 seats | every cached prize equity equals the uncached recursion **bit for bit**, through hits, fills and evictions |
| engine E4 | three-player ICM | equals the finishing-order formula written out |
| response life-cycle | a response problem opened twice, finished twice, evaluated too early; malformed requests | each refused with its documented status |
| response `<fixture>` R1 | the trained strategy inside a response state | its values equal the trained state's **exactly** (difference 0) |
| response `<fixture>` R2 | the other seats | frozen: the same best-response value in both profiles (difference 0) |
| response `<fixture>` R3 | direction | exact gain of the response <= exact best-response gain, for every seat |
| response `<fixture>` R4 | the estimate from independent deals | contains the exact gain in its distribution-free interval |
| response `<fixture>` R5 | 1 and 3 evaluation threads | the same bits |
| response `<fixture>` R6 | a second run from a fresh load | the same bits |
| limits L1 | a study budget of 10,000,001 deals | refused when the study is configured, in well under a second, no checkpoint created |
| limits L2 | 640,000,001 deals with 64 deals per update | refused at once |
| limits L3 | 10,000,000 deals; 640,000,000 with 64 deals per update | accepted (each study is then ended by a 0.2 s time limit) |
| limits L4 | the command-line trainer with 10,000,001 updates | refused before it reads its input |

`<fixture>` is each of `known-akq-river`, `flop3-kings-small`, `flop6-jack-small` and `icm8-bb-call-small` (6 checks
each). Each check is `passed`, `failed` or `untested` (a step it depends on could not be carried out; the reason is
given). `untested` is never counted as passed. On Linux and under Wine all 33 passed.

### What step 2 adds

The script records the machine, verifies every file against `SHA256SUMS.txt`, runs the self-test again and imports
its 33 checks one by one, checks that all 33 expected checks are in the report and that the report agrees with the
exit status of `mwcli.exe`, and then runs section 11: **seven reference games on which your PC must compute, bit for
bit, the numbers the Linux build recorded** — the trained state (SHA-256), the response gain estimated from independent
deals, the exact response gain and the exact best-response gain of every seat — once with the seats one after another
and once with two side by side.

## 2. The full validation (15 to 50 minutes) — after the focused one

Close other heavy programs, then double-click **`Run 5.8 Windows validation.bat`**.

This is the 5.7.1 full validation — which has itself never been reported from a Windows PC — plus sections 10 and 11:
environment, integrity, the 5.7 self-test, 11 golden training states, thread determinism up to all 24 logical
processors, exact evaluation, the known game, recovery (time limit, kill, second process refused), the 24 checkpoint
and memory checks of 5.7.1, the 33 checks of 5.8, the reference responses, configuration handling, throughput, the
desktop host and the GPU (CUDA against the CPU on your RTX 4060 Ti; CPU-only, Automatic, Hybrid and GPU-Preferred
giving identical study measurements). It writes:

| File | Written by | Needs PowerShell |
|---|---|---|
| `Windows-selftest-5.8.json` | step 1: `mwcli.exe --selftest57` | no |
| `Windows-selftest571-5.8.json` | step 2: `mwcli.exe --selftest571` | no |
| `Windows-selftest58-5.8.json` | step 3: `mwcli.exe --selftest58` | no |
| `Windows-validation-5.8.json` | step 4: `source\tools\validate_windows58.ps1` | yes |
| `Windows-validation-5.8.txt` | step 4, the same as text | yes |
| `hardware-validation.json` | the GPU section of step 4 | yes |

**Please upload all six files.**

Options (add them after the file name in a Command Prompt): `-Quick` (skips the throughput section and shortens the
recovery study), `-SkipGpu`, `-SkipIntegrity` (skips re-hashing all files).

Because a full run of 5.8 contains every check of the 5.7.1 full validation, it also closes the gap left by 5.7.1:
there is no need to run the 5.7.1 package separately.

## 3. The GPU: what to look at in `hardware-validation.json`

No CUDA code changed in 5.8 (no kernel, no scheduling rule, no device selection). The GPU section is the 5.7 one. It
answers the questions that could not be answered without your card:

| Question | Where |
|---|---|
| Did CUDA really execute? | `physicalNvidiaExecution: true` and `gpuBoards > 0` in the device results |
| Do CPU and GPU agree? | `equity[*].gpuMatchesCpu` (exact integer comparison), `identicalToCpu` in every device row |
| Different hand counts and boards | `equity`: heads-up, 3-way, 6-way and 8-way preflop, 4-way flop |
| Insufficient GPU memory | `gpuBudget` (below and at the budget), `v42.budget` |
| CPU fallback | `scoringModes`, `externalBatchModes`: the decision and the reason of every mode |
| Cancellation and time limits | `v41.cancelWhileGpu`, `v40.deadline100ms` |
| CPU and GPU times, separately | `equity[*].cpuSeconds` / `gpuSeconds`; `v43.summary` (cold and warm, per thread count) |
| Does Automatic choose well? | `v44.findings`, `v45.findings` (Automatic against the best fixed mode) |

What your 5.7 run already showed (the numbers are in `validation/5.7.1/windows-5.7-physical/`): CUDA start-up cost
65 to 100 ms; Automatic left small jobs on the CPU without opening CUDA (0.064 s against 0.151 s for GPU-Preferred on
the small training job); exact all-in equity over 377,000 to 1.7 million boards was 27 to 84 times faster on the GPU
than on 24 CPU threads; and of the three Automatic-against-best-mode comparisons one was conclusive (within 15% of
the best) and two were inconclusive with nine rounds. PERFORMANCE-5.8.md, section 6, has the table. If you want the
two inconclusive comparisons resolved, run `Validate CUDA hardware.bat` a second time and send both
`hardware-validation.json` files: the rounds can be pooled.

## 4. What to upload

| After | Files |
|---|---|
| the focused validation | `Windows-selftest58-5.8.json`, `Windows-focused-validation-5.8.json`, `Windows-focused-validation-5.8.txt` |
| the full validation | `Windows-selftest-5.8.json`, `Windows-selftest571-5.8.json`, `Windows-selftest58-5.8.json`, `Windows-validation-5.8.json`, `Windows-validation-5.8.txt`, `hardware-validation.json` |

All are written into the release folder, next to `EightMax.exe`. Reports of an earlier run are deleted at the start
of each run, so a file you find afterwards was written by that run.

## 5. Reading the result

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

**Expected totals, if every check passes** (counted from the script, not from a run): the focused validation 54
passed (5.7.1 focused: 36; minus its 27 self-test checks, plus 36 for the 5.8 self-test and 9 for the reference
responses); the full validation 151 passed (the 106 of the 5.7.1 full script plus the same 45). If your totals
differ, the report files say which checks make the difference; a different total with no failed and no untested
check means this page miscounted, not that something is wrong.

## 6. Things that are expected

- **A 5.7 or 5.7.1 saved study cannot be resumed by 5.8.** A study checkpoint is tied to the build that wrote it; 5.8
  refuses it with the reason and leaves it untouched. Finish it with the release that started it, or start it again.
  Solver state files (`.state`) are not affected: a 5.7.1 state continues in 5.8 to the same bytes.
- The self-test of step 1 takes one to three minutes; its ICM fixture evaluates exactly and is the slowest part.
- The 5.7.1 memory check (in the full validation) uses about 350 MiB of RAM for a few seconds and writes up to about
  300 MB of temporary checkpoint files to `%TEMP%`, which are removed.
- The focused validation does not use the GPU. GPU results come only from the full validation.

## 7. If something fails

Keep the report files and upload them: a failed or untested check carries its evidence. To repeat only the 5.8
self-test, in a Command Prompt in the release folder:

```bat
mwcli.exe --selftest58 studies "%TEMP%\em58" all
```

(`engine`, `response` or `limits` instead of `all` runs one part.) Its report is `%TEMP%\em58\selftest58.json`.

To try the new quality measure itself, double-click **`Run 5.8 response example.bat`** (about a minute); it writes
`EightMax-5.8-response-example.json`, which USER-GUIDE-5.8.md explains field by field.
