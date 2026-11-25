# EightMax 5.12: the checks that remain to be made on the Windows PC

Build `913dc2280e5088ae`. Target: Windows 11 x64, Intel Core i7-13700F (24 logical processors), 16 GB RAM, NVIDIA GeForce
RTX 4060 Ti (8 GB).

**What has NOT been done.** No program of 5.12 was executed on the target PC, and none on an NVIDIA GPU. The Windows
executables were executed under Wine 9.0 and on a hosted Windows runner (GitHub Actions: Windows Server 2025, a virtual machine with 4 processors and no NVIDIA GPU; both launchers, Windows PowerShell 5.1). Nobody has looked at the 5.12 interface on Windows: the
table-size switch was tested in Chromium on Linux. **5.11 was not reported from the target PC either** when 5.12 was
made, so the 5.12 launchers run the 5.11 checks too: one run of 5.12 covers both releases. Your 5.10 result (220
passed, 0 failed, CUDA included) remains the last evidence from your hardware.

Nothing has to be installed. Nothing is written outside the release folder (the reports) and a temporary folder that
is removed at the end. Saved studies under `Documents\EightMax` are not touched.

## 1. Integrity (1 minute)

Extract `EightMax-Windows-5.12.zip` into a new empty folder. In PowerShell:

    Get-FileHash .\EightMax-Windows-5.12.zip -Algorithm SHA256

must print the `archiveSha256` of `EightMax-Windows-5.12.identity.json` (delivered beside the ZIP). The launchers
check every file against `SHA256SUMS.txt` themselves. You do not need `EightMax-5.12-evidence-2.3-to-5.8.zip`.

## 2. The focused validation (about 8 to 20 minutes): what 5.12 added, and the trainer checks of 5.11

Double-click **`Run 5.12 focused validation.bat`**.

| Step | What runs | Report |
|---|---|---|
| 1 | `mwcli.exe --selftest512 studies <temp> all`: 8 checks in three sections. **fixtures**: the six 6-max fixtures describe a six-handed table, the engine accepts all 20 variants and reaches every advertised decision; the ten fixtures of 5.11 are there. **training**: 24 six-handed states equal the SHA-256 of the Linux build (5.10 streams and philox64, one deal per update and frozen batches); 1 thread = 3 threads; stopped and continued = uninterrupted; exact NashConv of two companions as recorded. **study**: a study of each small companion completes, twice to the same measurements. | `Windows-selftest512-5.12.json` |
| 2 | `validate_windows512.ps1 -Focused`: machine; every file against `SHA256SUMS.txt`; **golden states** and **threads** (the 5.10-stream trainer against the recorded states with 1, 2, 4, 8 and 24 threads); **self-test 5.11** (26 checks) and **streams 5.11** (philox64 with every thread count and processing mode: the checks of the 5.11 focused launcher); **self-test 5.12** (the 8 checks again, imported one by one); **table 5.12**: the delivered interface carries the 6-max library, the switch and the six studies; its four library lines are the lines of the Linux build, in the file and in the page EightMax.exe serves; two six-handed studies (flop, ICM) train with 1, 2, 4, 8 and 24 threads and with CPU Only, Automatic, Hybrid and GPU-Preferred to one state each, the state of the Linux build; deals per second. | `Windows-focused-validation-5.12.json`, `.txt` |

**Expected:** exit status 0, "Every required check of the script passed", 0 failed, 0 untested. On the hosted Windows
runner: 71 passed, 1 failed, 0 skipped, 0 untested (142.9 s) on the pre-release tree - the failed check is `integrity / SHA256SUMS.txt`, a file only the packaged archive has; the run of the delivered archive is in WINDOWS-CI-5.12.md beside the ZIP.

**What only your PC can show** in this step: the six-handed states and the philox64 state with 8 and 24 threads;
**Hybrid and GPU-Preferred with the RTX 4060 Ti really scoring showdowns**, on the 8-max reference study of 5.11 and
on the two six-handed ones (on every machine so far these modes fell back to the CPU); deals per second on the
i7-13700F (rows of class `information`).

## 3. The full validation (35 to 90 minutes)

Double-click **`Run 5.12 Windows validation.bat`**. Steps 1 to 7 are `mwcli.exe --selftest57`, `--selftest571`,
`--selftest58`, `--selftest59`, `--selftest510`, `--selftest511`, `--selftest512` (28, 24, 33, 32, 21, 26 and 8
checks). Step 8 is the script with all 23 sections: the 21 sections of the 5.11 script, unchanged, plus "self-test
5.12" and "table 5.12". The GPU section (`validate_hardware.ps1`) is the one that passed on your PC for 5.10.

**Expected:** exit status 0. On the hosted Windows runner: 264 passed, 1 failed, 1 skipped, 0 untested (753.1 s) on the pre-release tree (the same manifest check failed; the GPU section was skipped); the delivered archive: WINDOWS-CI-5.12.md beside the ZIP. On your PC the integrity check and the
GPU section run as well, so the count of passed checks is higher.

Options (append to the `.bat` line): `-Quick` (skips throughput, shortens recovery), `-SkipGpu`, `-SkipIntegrity`.

**Reading the result.** Every check is `passed`, `failed`, `skipped` (with its reason) or `untested` (planned but not
reached; never counted as passed). Classes: `gate`, `environment`, `hardware` (needs the GPU), `information`
(measurements). Exit status 0 = no gate failed and none is untested; 1 = a gate failed or was not reached; 2 = the
script itself did not finish. A missing report is not a pass.

## 4. Five things to look at by hand (5 minutes; no script can see them)

Open `EightMax.exe`.

1. **The switch.** Beside the name, at the top: `8-max | 6-max`. Click **6-max**. The line under the name reads
   "6-max MTT solver · 5.12"; the Preflop tab shows the seats MP, HJ, CO, BTN, SB, BB.
2. **A number to compare.** Push/fold, 10 BB, seat MP, folded to you: **20.2%** of hands. Seat SB: **67.7%**.
   15-100 BB, 100 BB, first in CO: raise 2.3, **30.0%**.
3. **Trainer.** Every spot says "6-max" and names one of the six seats.
4. **Study.** The list starts with a group "6-max" (six studies); pick "Six-handed final table, small exact
   companion", press Run study with the preset "quick": it finishes in well under a minute and shows Fold and Call
   17.9 for AdTc.
5. **Back.** Click **8-max**: seats UTG to BB again, push/fold 10 BB seat UTG reads **15.2%** (the number 5.11
   shows). Close and reopen the application: it opens on the table you chose last.

If one of these is not as described, a screenshot of the window is the most useful thing to send.

## 5. Files to send back

After the **full** run, from the release folder (all small text files):

    Windows-validation-5.12.json          Windows-validation-5.12.txt
    Windows-selftest512-5.12.json         Windows-selftest511-5.12.json
    Windows-selftest510-5.12.json         Windows-selftest59-5.12.json
    Windows-selftest58-5.12.json          Windows-selftest571-5.12.json
    Windows-selftest-5.12.json            hardware-validation.json   (written by the GPU section when the GPU answers)

and, if you ran the focused launcher first, `Windows-focused-validation-5.12.json` and `.txt`. If a launcher ends
with a status other than 0, also the text it printed in its window (select all, copy). And one line about section 4:
"as described", or what differed.

**For Phase 4** (not needed for this release): the plan says you will send equal-time results for `rbes` against the
default trainer from your PC before that phase. The estimator section of the full run already measures deals per
second of both trainers; the equal-time comparison itself needs its own launcher, which I will deliver with Phase 3
unless you want it sooner.

## 6. If something fails

* **A six-handed state differs from the recorded one** (`training T1`, `table 5.12 / 6-max state equals the Linux
  build`): the Windows program computes other numbers than the Linux build on a six-handed game - a real defect.
  Keep the reports. The 8-max checks tell whether it is particular to six seats.
* **A check of 5.11 or earlier fails** (`golden states`, `threads`, `self-test 5.11`, `streams 5.11`, ...): 5.12 did
  not change that code; the same check would fail with 5.11 on your PC. Send the reports; do not continue 5.10
  checkpoints with 5.11 or 5.12 until it is understood.
* **Hybrid or GPU-Preferred write another state** (8-max or 6-max): use CPU Only and send `hardware-validation.json`.
* **`table 5.12 / EightMax.exe serves the same library and the switch` fails but the file checks pass:** the host did
  not start or did not answer on a local port (a firewall prompt, a port in use). Run the launcher again; if it
  repeats, send the report.
* **Only rows of class `information` or `environment` differ**: not a failure.

## 7. Which streams your work uses

Unchanged from 5.11 (WINDOWS-TESTS-5.11.md, section 6): new studies train with the counter-based 64-bit streams,
`trainingStreams=5.10` gives the numbers of 5.10, a spec without the key and the interactive multiway panel use the
5.10 streams, and a saved state continues under the streams that trained it. The six 6-max fixtures follow the same
rules.
