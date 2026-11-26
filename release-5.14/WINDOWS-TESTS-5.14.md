# EightMax 5.14: the checks that remain to be made on the Windows PC

Build `57befd67c7c86ebe`. Target: Windows 11 x64, Intel Core i7-13700F (24 logical processors), 16 GB RAM, NVIDIA GeForce
RTX 4060 Ti (8 GB).

**What has NOT been done.** No program of 5.14 was executed on the target PC, and none on an NVIDIA GPU. The Windows
executables ran under Wine 9.0 and on a hosted Windows runner (Windows Server 2025, a virtual machine with 4
processors and no NVIDIA GPU; Windows PowerShell 5.1). **5.11, 5.12 and 5.13 had not been reported from the target PC
either** when 5.14 was made; the 5.14 launchers run their checks too, so one run of 5.14 covers all four. Your 5.10
result (220 passed, 0 failed, CUDA included) remains the last evidence from your hardware.

Nothing has to be installed. Nothing is written outside the release folder and a temporary folder that is removed at
the end. Saved studies under `Documents\EightMax` are not touched.

There are **two different things to run**: the validation (sections 2 and 3: is the program the program that was
tested?) and the equal-time experiments (section 4: what does your processor say about speed?). Phase 4 needs both.

## 1. Integrity (1 minute)

Extract `EightMax-Windows-5.14.zip` into a new empty folder. In PowerShell:

    Get-FileHash .\EightMax-Windows-5.14.zip -Algorithm SHA256

must print the `archiveSha256` of `EightMax-Windows-5.14.identity.json` (delivered beside the ZIP). The launchers
check every file against `SHA256SUMS.txt` themselves.

## 2. The focused validation (about 15 to 30 minutes)

Double-click **`Run 5.14 focused validation.bat`**.

| Step | What runs | Report |
|---|---|---|
| 1 | `mwcli.exe --selftest514 studies <temp> all`: 7 checks. **pruning**: 32 pruned states equal to the Linux build; their headers; 1, 2 and 4 threads; stop and continue; what is refused; `"pruning":"none"` equal to the default trainer. **merge**: frozen batches on 1 to 4 threads, default trainer and `rbes`, against recorded states. | `Windows-selftest514-5.14.json` |
| 2 | `validate_windows514.ps1 -Focused`: machine; every file against `SHA256SUMS.txt`; golden states; threads (1, 2, 4, 8 and 24); the self-tests and sections of 5.11, 5.12 and 5.13; **self-test 5.14**; **equal time 5.14**: `eqtime.exe` is of this build, and its quick trial passes the equal-deals check (the program trains the states of the Linux build to the last bit of their NashConv). | `Windows-focused-validation-5.14.json`, `.txt` |

**Expected:** exit status 0, 0 failed, 0 untested. On the hosted Windows runner: 106 passed, 1 failed, 0 skipped, 0 untested (345.1 s) on the pre-release tree - the failed check is `integrity / SHA256SUMS.txt: file missing`, true of that tree; the delivered archive: WINDOWS-CI-5.14.md beside the ZIP.

## 3. The full validation (45 to 110 minutes)

Double-click **`Run 5.14 Windows validation.bat`**. Steps 1 to 9 are `mwcli.exe --selftest57`, `--selftest571`,
`--selftest58`, `--selftest59`, `--selftest510`, `--selftest511`, `--selftest512`, `--selftest513`, `--selftest514`
(28, 24, 33, 32, 21, 26, 8, 14 and 7 checks). Step 10 is the script with all 27 sections, the GPU section among them.

**Expected:** exit status 0. On the hosted Windows runner: 299 passed, 1 failed, 1 skipped, 0 untested (962.7 s) on the pre-release tree (the same manifest check; the GPU section skipped); the delivered archive: WINDOWS-CI-5.14.md beside the ZIP. On your PC the GPU section runs as well.

Options (append to the `.bat` line): `-Quick`, `-SkipGpu`, `-SkipIntegrity`. A check is `passed`, `failed`,
`skipped` (with its reason) or `untested`; exit status 0 = no gate failed and none is untested; a missing report is
not a pass.

**What only your PC can show:** all states with 8 and 24 threads; Hybrid and GPU-Preferred with the RTX 4060 Ti
really scoring showdowns (on every machine so far these modes fell back to the CPU); that an Intel processor writes
the pruned states and the satellite bits of the AMD and Xeon machines.

## 4. The equal-time experiments (about 2 to 2.5 hours; CPU only)

Close other heavy programs, then double-click **`Run 5.14 equal-time comparison.bat`** and leave the PC alone. If you
want to see first that it works: `Run 5.14 equal-time quick trial.bat` (a few minutes; never a result).

| Part | Question | Size |
|---|---|---|
| pruning | default trainer against `nrp` and `nrpc`: lower exact NashConv in the same time? | 20 games, 20 seeds, 4 s and 16 s, 6 units at a time |
| threads | `rbes` on one thread against `rbes` with frozen batches of 8 and 32 deals on 8 threads | 6 games, 12 seeds, 4 s, one unit at a time |
| scaling | sampled deals per second by batch size with 1, 2, 4, 8, 12, 16 and 24 threads, two fixtures | 3 s a run |

Each part prints its rule before it starts and its verdict at the end, into `equal-time-results\<part>\`. The program
prints an estimate of the time. It can be interrupted (close the window): started again, it continues with the units
that are missing. **No outcome changes anything in 5.14**; the results decide what a later release does with
threads, and whether pruning is worth another look.

**And the one that Phase 4 was waiting for:** the `rbes` equal-time kit delivered with 5.13
(`release-5.13/rbes-equal-time/EightMax-5.13-rbes-equal-time.zip`, its own folder and launcher, about 1.5 to 2
hours). It decides, by its rules P1 to P5, whether `rbes` becomes the automatic trainer for games with wide ranges.
It is independent of 5.14 and can run before or after it, but not at the same time as anything else.

## 5. Things to look at by hand (3 minutes)

The interface did not change in 5.14 apart from the version. If you have not done the six checks of
WINDOWS-TESTS-5.13.md (satellite card, table switch), they are still the ones to do. One new check:

    mwcli.exe --study studies\flop6-jack-small.emfix.json out.json pruning=nrp-5.14-v1 preset=quick

ends with exit status 0, and `out.json` contains `"algorithm":"nrp-5.14-v1;threshold=0.02;evidence=50;skip=0.94999999999999996"`
and `"experimentalPruning":true`.

## 6. Files to send back

From the release folder, after the **full** validation:

    Windows-validation-5.14.json          Windows-validation-5.14.txt
    Windows-selftest514-5.14.json         Windows-selftest513-5.14.json
    Windows-selftest512-5.14.json         Windows-selftest511-5.14.json
    Windows-selftest510-5.14.json         Windows-selftest59-5.14.json
    Windows-selftest58-5.14.json          Windows-selftest571-5.14.json
    Windows-selftest-5.14.json            hardware-validation.json   (written by the GPU section when the GPU answers)

(and `Windows-focused-validation-5.14.json` / `.txt` if you ran the focused launcher first; the window text if a
launcher ends with a status other than 0).

After the **equal-time comparison**, the folder `equal-time-results` without its `units` subfolders:

    equal-time-results\pruning\summary.txt  summary.json  raw.jsonl  plan.json  machine.txt
    equal-time-results\threads\summary.txt  summary.json  raw.jsonl  plan.json  machine.txt
    equal-time-results\scaling\scaling.txt  scaling.json

After the **5.13 rbes kit**: its folder `rbes-equal-time-results` (`summary.txt`, `summary.json`, `raw.jsonl`,
`plan.json`, `machine.txt`).

If time is short, the order of value is: the rbes kit, the focused validation, the equal-time comparison, the full
validation.

## 7. If something fails

* **`pruning P1` or `merge G1` (a state differs from the recorded one):** your processor or Windows build wrote
  another state than Linux. Send the reports. The default trainer is not affected unless golden states fail too.
* **`equal time 5.14 / equal-deals check`**, or an equal-time summary that says the check did not pass: the timing
  results of that run do not count (the program says so itself). Send `summary.txt`.
* **An equal-time run reports errors or fewer than 18 valid seeds:** most likely memory (each unit may use up to
  512 MiB; six run at once). Run `eqtime.exe all --jobs 3`; finished units are kept.
* **A check of 5.13 or earlier fails:** 5.14 did not change that code path. Send the reports.
* **Hybrid or GPU-Preferred write another state:** use CPU Only and send `hardware-validation.json`.
* **Only rows of class `information` or `environment` differ:** not a failure.
