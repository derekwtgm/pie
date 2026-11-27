# EightMax 5.15: the checks that remain to be made on the Windows PC

Build `87b9f6e38b735cfb`. Target: Windows 11 x64, Intel Core i7-13700F (24 logical processors), 16 GB RAM, NVIDIA GeForce
RTX 4060 Ti (8 GB).

**What has NOT been done.** No program of 5.15 was executed on the target PC, and none on an NVIDIA GPU. The Windows
executables ran under Wine 9.0 and on a hosted Windows runner (Windows Server 2025, a virtual machine with 4
processors and no NVIDIA GPU; Windows PowerShell 5.1). **5.11 to 5.14 had not been reported from the target PC
either** when 5.15 was made; the 5.15 launchers run their checks too, so one run of 5.15 covers all five. Your 5.10
result (220 passed, 0 failed, CUDA included) remains the last evidence from your hardware.

Nothing has to be installed. Nothing is written outside the release folder and a temporary folder that is removed at
the end. Saved studies under `Documents\EightMax` are not touched.

## 1. Integrity (1 minute)

Extract `EightMax-Windows-5.15.zip` into a new empty folder. In PowerShell:

    Get-FileHash .\EightMax-Windows-5.15.zip -Algorithm SHA256

must print the `archiveSha256` of `EightMax-Windows-5.15.identity.json` (delivered beside the ZIP). The launchers
check every file against `SHA256SUMS.txt` themselves.

## 2. The focused validation (about 20 to 40 minutes)

Double-click **`Run 5.15 focused validation.bat`**.

| Step | What runs | Report |
|---|---|---|
| 1 | `mwcli.exe --selftest515 studies <temp> all`: 12 checks. **model**: 83 values of the payoff model with the bits of the Linux build; the values add up; closed forms of the bounty rules; the plain ICM where no future hand can be played; refused requests. **training**: 16 states equal to the Linux build; 1 and 3 threads; stop and continue; exact NashConv as recorded; what the trainer reports. **checkpoint**: a state continues only under the model and parameters it was trained for; refused specs. | `Windows-selftest515-5.15.json` |
| 2 | `validate_windows515.ps1 -Focused`: machine; every file against `SHA256SUMS.txt`; golden states; threads (1, 2, 4, 8 and 24); the self-tests and sections of 5.11 to 5.14; **self-test 5.15**; **tournament 5.15**: `mwcli --tour515` prints the bits of the Linux build for four requests; a progressive-knockout study and a study with two future hands train with 1, 2, 4, 8 and 24 threads and with every processing mode to the state of the Linux build; the interface file carries the model and the four new fixtures. | `Windows-focused-validation-5.15.json`, `.txt` |

**Expected:** exit status 0, 0 failed, 0 untested. On the hosted Windows runner: 126 passed, 1 failed, 0 skipped, 0 untested (574.7 s) on the pre-release tree - the failed check is `integrity / SHA256SUMS.txt: file missing`, true of that tree; the delivered archive: WINDOWS-CI-5.15.md beside the ZIP.

## 3. The full validation (50 to 120 minutes)

Double-click **`Run 5.15 Windows validation.bat`**. Steps 1 to 10 are `mwcli.exe --selftest57`, `--selftest571`,
`--selftest58`, `--selftest59`, `--selftest510`, `--selftest511`, `--selftest512`, `--selftest513`, `--selftest514`,
`--selftest515` (28, 24, 33, 32, 21, 26, 8, 14, 7 and 12 checks). Step 11 is the script with all 29 sections, the GPU
section among them.

**Expected:** exit status 0. On the hosted Windows runner: 319 passed, 1 failed, 1 skipped, 0 untested (1266.9 s) on the pre-release tree (the same manifest check; the GPU section skipped); the delivered archive: WINDOWS-CI-5.15.md beside the ZIP. On your PC the GPU section runs as well.

Options (append to the `.bat` line): `-Quick`, `-SkipGpu`, `-SkipIntegrity`. A check is `passed`, `failed`,
`skipped` (with its reason) or `untested`; exit status 0 = no gate failed and none is untested; a missing report is
not a pass.

**What only your PC can show:** all states with 8 and 24 threads; Hybrid and GPU-Preferred with the RTX 4060 Ti
really scoring showdowns; that an Intel processor prints the bits of the payoff model that the AMD and Xeon machines
printed (the model uses additions, multiplications, divisions and square roots only, so it should).

## 4. Things to look at by hand (10 minutes)

The script cannot see what the interface draws. These were checked in a browser before release (14 of 14 checks in Chromium);
on your PC, in `EightMax.exe`:

1. **Preflop > Custom / ICM**, payoff ICM. *Future hands (FGS)* offers Off, Next hand, 2, 3 and 4 hands; with 8
   players only "Next hand" can be chosen, with 3 players up to 3 hands. The note says how many future hands are
   solved.
2. Same form, **Bounties: PKO**. A bounty field for every seat appears (and one for players at other tables when you
   entered any). The note says that results with bounties differ from earlier versions.
3. Solve a 3-handed ICM spot with PKO and "Next hand". The result line reads "... FGS 1 hand ... PKO bounties ...".
4. **Solve with overcalls** on that spot opens the Multiway tab with Tournament ICM, *Bounties: Progressive
   knockout*, the bounties you entered and one future hand.
5. **Multiway**, payoff Tournament ICM: the fields *Bounties*, *Bounty on each player* and *Future hands simulated*
   are there; for a postflop study the last one is greyed out.
6. **Study**: the list has a group "Bounties and future hands" with four fixtures. Open
   *Progressive knockout, six left ...*: the card names the payoff model `tour-5.15-v1`.
7. Run the study of the **small** progressive-knockout fixture (a few minutes) and of the small future-hands
   fixture. With future hands the first seconds are slow: the program is solving future hands. That is expected.

And one command:

    mwcli.exe --tour515 validation\5.15\windows\tournament\request-3.json

prints `"model":"tour-5.15-v1"` and, for the first outcome, the bits
`403c2dcc7ab4d5a0, 4042742592bb08d5, 404174f42fea8c5f` (two future hands at a table of three).

## 5. Still open from 5.14 (nothing in 5.15 replaces them)

* The **`rbes` equal-time kit** delivered with 5.13 (`release-5.13/rbes-equal-time/`): it decides whether `rbes`
  becomes the automatic trainer for games with wide ranges.
* **`Run 5.14 equal-time comparison.bat`** (about 2 to 2.5 hours, CPU only; the launcher and `eqtime.exe` are in this
  archive unchanged): pruning and threads on your processor.

Neither is needed to use 5.15. They decide what a later release does.

## 6. Files to send back

From the release folder, after the **full** validation:

    Windows-validation-5.15.json          Windows-validation-5.15.txt
    Windows-selftest515-5.15.json         Windows-selftest514-5.15.json
    Windows-selftest513-5.15.json         Windows-selftest512-5.15.json
    Windows-selftest511-5.15.json         Windows-selftest510-5.15.json
    Windows-selftest59-5.15.json          Windows-selftest58-5.15.json
    Windows-selftest571-5.15.json         Windows-selftest-5.15.json
    hardware-validation.json   (written by the GPU section when the GPU answers)

(and `Windows-focused-validation-5.15.json` / `.txt` if you ran the focused launcher first; the window text if a
launcher ends with a status other than 0).

If you run the open items of section 5: the folders `rbes-equal-time-results` and `equal-time-results` (without
`units`), as WINDOWS-TESTS-5.14.md lists them.

If time is short, the order of value is: the focused validation of 5.15, the rbes kit, the full validation, the
equal-time comparison.

## 7. If something fails

* **`model M1`, or `tournament 5.15 / mwcli --tour515 prints the bits of the Linux build`:** your processor computed
  another value of the payoff model than the Linux build. Send the reports; do not use bounties or future hands until
  it is understood. Studies without them are not affected.
* **`training T1` or a tournament state differs:** the same, for trained states.
* **A study with future hands seems to hang at the start:** it is solving future hands (up to 2,000 for one outcome
  of the hand; at a table of six to eight even one future hand needs thousands of solutions of about 30 ms each in the
  first deals). `mwcli` prints `futureHandsSolved` when it ends. If it is too slow, use fewer future hands.
* **A check of 5.14 or earlier fails:** 5.15 did not change that code path. Send the reports.
* **Hybrid or GPU-Preferred write another state:** use CPU Only and send `hardware-validation.json`.
* **Only rows of class `information` or `environment` differ:** not a failure.
