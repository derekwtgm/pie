# EightMax 5.7 — checks to run on your Windows PC

Nothing in 5.7 has been executed on Windows hardware or on an NVIDIA GPU. Development ran on Linux, and the Windows
programs were run under Wine. This page lists what to run on the target PC (Windows 11 x64, 13th-generation Core i7,
16 GB RAM, RTX 4060 Ti 8 GB) and what to send back. Nothing needs to be installed.

## 1. The one-click validation (10 to 40 minutes)

1. Extract `EightMax-Windows-5.7.zip` into a folder you can write to (for example `Documents\EightMax-5.7`). Do not run
   it from inside the ZIP.
2. Close other heavy programs (the thread-scaling and throughput numbers are only meaningful on an idle PC).
3. Double-click **`Run 5.7 Windows validation.bat`**.

It runs two steps and writes three files into the release folder:

| File | Written by | Needs PowerShell |
|---|---|---|
| `Windows-selftest-5.7.json` | step 1: `mwcli.exe --selftest57` | no |
| `Windows-validation-5.7.json` | step 2: `source\tools\validate_windows57.ps1` | yes |
| `Windows-validation-5.7.txt` | step 2, the same as text | yes |

**Please send back all three files** (and, if step 2 stops with a red PowerShell error, a photo or copy of the window).

Options (add them after the file name in a Command Prompt): `-Quick` (skips the throughput section and shortens the
recovery study), `-SkipGpu`, `-SkipIntegrity` (skips re-hashing all files).

### What step 1 checks (about one minute; no PowerShell)

The program checks itself: the worker pool, deal queue and thread choice introduced in 5.7; that frozen-batch training
writes **the same state as the 5.6 binary** with 1, 2, 4 and 8 threads, with the measured thread choice, and when a
training is stopped and continued; and that evaluation gives the same result with and without the 5.7 path cache and
agrees with the 5.6 values. Under Wine all 28 checks passed.

### What step 2 checks

Thirteen sections: environment, file integrity, the self-test again, 11 golden training states, thread determinism up
to all logical processors, exact evaluation with small and large caches, a study of a game with a known solution,
recovery (time limit, killed process, second process refused, damaged checkpoint refused), a memory-budget stop,
configuration handling (CPU-only, GPU-Preferred fallback, invalid inputs refused), throughput, the desktop host, and
the GPU.

Every check has a **status**:

| Status | Meaning |
|---|---|
| passed | the check ran and held |
| failed | the check ran and did not hold |
| skipped | deliberately not run: an option you gave, or hardware that is not present; the reason is stated |
| untested | planned but not reached, because an earlier step it depends on failed or the script stopped |
| info | a measurement (throughput, thread scaling), not a pass/fail check |

and a **class**: `gate` (must pass on every Windows PC), `environment` (depends on this PC's configuration),
`hardware` (needs an NVIDIA GPU), `information`.

The window ends with one of:

- *Every required check passed.* (exit status 0)
- *At least one required check failed or could not be made.* (exit status 1)
- *The validation script itself did not finish.* (any other status)

**About the third outcome.** `validate_windows57.ps1` was written and reviewed on Linux where no PowerShell was
available, so it has never run. If it stops with a PowerShell error, that is a defect of the script, not necessarily of
EightMax: the report written so far says which section it reached, and the result of step 1 stands on its own.

### If no NVIDIA GPU answers

The GPU section is recorded as **skipped**, with the reason the driver gave. It is never recorded as passed. On your
PC with the RTX 4060 Ti it should run; if it is skipped there, the reason in the report is what we need.

## 2. GPU validation in detail (only if section 13 ran)

Section 13 runs `source\tools\validate_hardware.ps1` (CPU against CUDA bit for bit, memory budgets, cold and warm
device, cancellation) and then the same study in the four processing modes (CPU-only, Automatic, Hybrid,
GPU-Preferred), which must give identical measurements. It writes `hardware-validation.json` in the release folder:
please send that too. The field `physicalNvidiaExecution` must be `true` for the run to count as GPU validation.

Not tested by anything here: GPU speed against the CPU on your card (the report records times, but no target exists),
behaviour when another program holds most of the 8 GB of VRAM, and driver versions other than yours.

## 3. Manual checks (5 minutes)

1. Double-click `EightMax.exe`. A browser tab opens. The footer should show version **5.7** and the build id printed
   in `BUILD-INFO.json`.
2. Open the **Study** tab, choose the smallest fixture and start a quick study. Close the browser tab and the program
   while it runs, start `EightMax.exe` again: the Study tab should offer to resume the saved study, and resuming
   should finish it.
3. Double-click `Run 5.7 quick study.bat`. It should finish and write a result file.

## 4. Optional: thread scaling on your CPU

Section 5 of the report (`threadScaling`) and section 11 (`trainingThroughput`) record, for your i7, the time of the
same frozen-batch training with 1, 2, 4, 8 and all logical processors, and which thread count the program chose by
measurement. On the four-core development container, 4 threads gave 1.4x to 2.4x the single-thread throughput
depending on the game (PERFORMANCE-5.7.md). Your numbers are the first on a real desktop CPU with performance and
efficiency cores; nothing in 5.7 was tuned for that layout.

## 5. What is deliberately not in the automatic run

- **Power loss.** No check cuts power or kills anything except the processes the script itself started. Durability of
  a checkpoint across a real power failure on NTFS is untested. If you want to test it: start
  `Run 5.7 standard study.bat`, wait a few minutes, switch the PC off at the wall, restart, and run
  `Resume 5.7 standard study.bat`. A study that resumes or is refused with a clear message is acceptable; a study
  that resumes with wrong numbers is not. This risks only the study's own checkpoint folder.
- **Long runs.** Nothing here runs longer than a few minutes per step. A multi-hour training on the target PC has not
  been done by anyone.
- **Network drives.** The checkpoint lock relies on local file locking; a study saved to a network share that does not
  implement it is not protected against two programs using it at once.

## 6. What to send back

- `Windows-selftest-5.7.json`, `Windows-validation-5.7.json`, `Windows-validation-5.7.txt`
- `hardware-validation.json` if it was written
- the Windows build number and the NVIDIA driver version if the report's environment section is empty
- anything the three manual checks in section 3 showed that differs from the description
