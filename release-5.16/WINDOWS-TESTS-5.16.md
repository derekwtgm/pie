# EightMax 5.16: the checks that remain to be made on the Windows PC

Build `39600509cc5a98e8`. Target: Windows 11 x64, Intel Core i7-13700F (24 logical processors), 16 GB RAM, NVIDIA GeForce
RTX 4060 Ti (8 GB).

**What has NOT been done.** No program of 5.16 was executed on the target PC, and none on an NVIDIA GPU. The Windows
executables ran under Wine 9.0 and on a hosted Windows runner (Windows Server 2025, a virtual machine with 4
processors and no NVIDIA GPU; Windows PowerShell 5.1). **5.11 to 5.15 had not been reported from the target PC
either** when 5.16 was made; the 5.16 launchers run their checks too, so one run of 5.16 covers all six. Your 5.10
result (220 passed, 0 failed, CUDA included) remains the last evidence from your hardware.

Nothing has to be installed. Nothing is written outside the release folder and a temporary folder that is removed at
the end. Saved studies under `Documents\EightMax` are not touched.

## 1. Integrity (1 minute)

Extract `EightMax-Windows-5.16.zip` into a new empty folder. In PowerShell:

    Get-FileHash .\EightMax-Windows-5.16.zip -Algorithm SHA256

must print the `archiveSha256` of `EightMax-Windows-5.16.identity.json` (delivered beside the ZIP). The launchers
check every file against `SHA256SUMS.txt` themselves.

## 2. The focused validation (about 25 to 45 minutes)

Double-click **`Run 5.16 focused validation.bat`**.

| Step | What runs | Report |
|---|---|---|
| 1 | `mwcli.exe --selftest516 studies <temp> all`: 6 checks. **training**: 8 states of Ranked studies with the SHA-256 of the Linux build; one state for 1 and 3 threads; stop and continue; the trainer names the grouping. **checkpoint**: the header field; a Ranked state refused by other groupings and the other way round; refused specs | `Windows-selftest516-5.16.json` |
| 2 | `validate_windows516.ps1 -Focused`: machine; every file against `SHA256SUMS.txt`; golden states; threads (1, 2, 4, 8 and 24); the self-tests and sections of 5.11 to 5.15; **self-test 5.16**; **grouping 5.16**: a three-seat and a six-seat flop study with the Ranked grouping, every thread count and every processing mode, one state each, the state of the Linux build; the interface file offers the grouping | `Windows-focused-validation-5.16.json`, `.txt` |

**Expected:** exit status 0, 0 failed, 0 untested. On the hosted Windows runner: 139 passed, 1 failed, 0 skipped, 0 untested (585.1 s) on the pre-release tree - the failed check is `integrity / SHA256SUMS.txt: file missing`, true of that tree; the delivered archive: WINDOWS-CI-5.16.md beside the ZIP.

## 3. The full validation (55 to 125 minutes)

Double-click **`Run 5.16 Windows validation.bat`**. Steps 1 to 11 are `mwcli.exe --selftest57`, `--selftest571`,
`--selftest58`, `--selftest59`, `--selftest510`, `--selftest511`, `--selftest512`, `--selftest513`, `--selftest514`,
`--selftest515`, `--selftest516` (28, 24, 33, 32, 21, 26, 8, 14, 7, 12 and 6 checks). Step 12 is the script with all
31 sections, the GPU section among them.

**Expected:** exit status 0. On the hosted Windows runner: 332 passed, 1 failed, 1 skipped, 0 untested (1281.3 s) on the pre-release tree (the same manifest check; the GPU section skipped); the delivered archive: WINDOWS-CI-5.16.md beside the ZIP. On your PC the GPU section runs as well.

Options (append to the `.bat` line): `-Quick`, `-SkipGpu`, `-SkipIntegrity`. A check is `passed`, `failed`,
`skipped` (with its reason) or `untested`; exit status 0 = no gate failed and none is untested; a missing report is
not a pass.

**What only your PC can show:** all states with 8 and 24 threads (with Ranked, 24 threads compute the strengths of a
range on a board at the same time and must all arrive at one table); Hybrid and GPU-Preferred with the RTX 4060 Ti
really scoring showdowns.

## 4. Things to look at by hand (5 minutes)

Checked in a browser before release (8 of 8 checks in Chromium); on your PC, in `EightMax.exe`:

1. **Multiway**, a flop study with wide ranges and sampled deals: *Hand grouping* offers Compact, Ranked (5.16),
   Detailed and Exact cards. Detailed is still preselected.
2. Choose **Ranked**, train for a minute. The result note reads "Ranked groups (ranked-5.16-v1)".
3. Choose Ranked for a **preflop** study: the form refuses it and says that Ranked needs a flop, turn or river start.
4. If you have a spot where Detailed runs out of memory: train it with Compact and with Ranked and watch the
   memory line. On the fixture `flop3-kings` Ranked needed 7.7 times the rows of Compact and
   about 20% of Detailed's.

## 5. Still open from earlier phases (nothing in 5.16 replaces them)

* The **`rbes` equal-time kit** delivered with 5.13 (`release-5.13/rbes-equal-time/`).
* **`Run 5.14 equal-time comparison.bat`** (about 2 to 2.5 hours, CPU only; in this archive unchanged).

Neither is needed to use 5.16. They decide what a later release does.

## 6. Files to send back

From the release folder, after the **full** validation:

    Windows-validation-5.16.json          Windows-validation-5.16.txt
    Windows-selftest516-5.16.json         Windows-selftest515-5.16.json
    Windows-selftest514-5.16.json         Windows-selftest513-5.16.json
    Windows-selftest512-5.16.json         Windows-selftest511-5.16.json
    Windows-selftest510-5.16.json         Windows-selftest59-5.16.json
    Windows-selftest58-5.16.json          Windows-selftest571-5.16.json
    Windows-selftest-5.16.json
    hardware-validation.json   (written by the GPU section when the GPU answers)

(and `Windows-focused-validation-5.16.json` / `.txt` if you ran the focused launcher first; the window text if a
launcher ends with a status other than 0).

If you run the open items of section 5: the folders `rbes-equal-time-results` and `equal-time-results` (without
`units`), as WINDOWS-TESTS-5.14.md lists them.

If time is short, the order of value is: the focused validation of 5.16, the rbes kit, the full validation, the
equal-time comparison.

## 7. If something fails

* **`training T1`, or `grouping 5.16 / Ranked state equals the Linux build`:** your PC trained a Ranked study to
  another state than the Linux build. Send the reports; do not use the Ranked grouping until it is understood.
  Studies with Compact, Detailed or Exact cards are not affected.
* **`identical Ranked state for every thread count` fails but one thread equals Linux:** the same, and it points at
  the shared table of range strengths. Send the reports.
* **A check of 5.15 or earlier fails:** 5.16 did not change that code path. Send the reports.
* **Hybrid or GPU-Preferred write another state:** use CPU Only and send `hardware-validation.json`.
* **Only rows of class `information` or `environment` differ:** not a failure.
