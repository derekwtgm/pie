# EightMax 5.18: the checks that remain to be made on the Windows PC

Build `23205cbc12cae290`. Target: Windows 11 x64, Intel Core i7-13700F (24 logical processors), 16 GB RAM, NVIDIA GeForce
RTX 4060 Ti (8 GB).

**What has NOT been done.** No program of 5.18 was executed on the target PC. What 5.18 adds needs no graphics
card and no particular processor: it is arithmetic on one thread, and the files and bits it produces were recorded
on Linux and reproduced by the Windows executables under Wine and on a hosted Windows runner (Windows Server 2025, a
virtual machine with 4 processors; Windows PowerShell 5.1). **5.11 to 5.17 had not been reported from the target PC
either** when 5.18 was made; the 5.18 launchers run their checks too, so one run of 5.18 covers all eight. In
particular the open question of 5.17 (does the RTX 4060 Ti give the bits of the CPU for method exact-hu?) is
answered by the same run. Your 5.10 result (220 passed, 0 failed, CUDA included) remains the last evidence from your
hardware.

Nothing has to be installed. Nothing is written outside the release folder and a temporary folder that is removed at
the end. Saved studies under `Documents\EightMax` are not touched.

## 1. Integrity (1 minute)

Extract `EightMax-Windows-5.18.zip` into a new empty folder. In PowerShell:

    Get-FileHash .\EightMax-Windows-5.18.zip -Algorithm SHA256

must print the `archiveSha256` of `EightMax-Windows-5.18.identity.json` (delivered beside the ZIP). The launchers
check every file against `SHA256SUMS.txt` themselves.

## 2. The focused validation (about 30 to 60 minutes)

Double-click **`Run 5.18 focused validation.bat`**.

| Step | What runs | Report |
|---|---|---|
| 1 | `mwcli.exe --selftest518 validation\5.18\windows\offtree <temp> all`: 8 checks. The rule against its recorded table; four base studies (two and three seats; river, turn, flop) train to the states of the Linux build; each translated into its own tree is unchanged to the bit; 15 translated states are the files recorded on Linux and their exact best responses have the recorded bits; no seat gains less with a size added; six refusals; 14 recorded lines of real actions | `Windows-selftest518-5.18.json` |
| 2 | `validate_windows518.ps1 -Focused`: machine; every file against `SHA256SUMS.txt`; golden states; threads (1, 2, 4, 8 and 24); the self-tests and sections of 5.11 to 5.17, **the GPU checks of method exact-hu among them**; **self-test 5.18** (the eight checks again, imported one by one) | `Windows-focused-validation-5.18.json`, `.txt` |

**Expected:** exit status 0, 0 failed, 0 untested, and no check of "exact best response 5.17" skipped (on your PC
the GPU must answer). On the hosted Windows runner: 160 passed, 1 failed, 1 skipped, 0 untested on the pre-release tree - the failed check is `integrity / SHA256SUMS.txt: file missing`, true of that tree; the skipped one is the OpenCL GPU section (no OpenCL platform on the runner); the delivered archive: WINDOWS-CI-5.18.md beside the ZIP.

## 3. The full validation (60 to 140 minutes)

Double-click **`Run 5.18 Windows validation.bat`**. Steps 1 to 13 are `mwcli.exe --selftest57`, `--selftest571`,
`--selftest58`, `--selftest59`, `--selftest510`, `--selftest511`, `--selftest512`, `--selftest513`, `--selftest514`,
`--selftest515`, `--selftest516`, `--selftest517`, `--selftest518` (28, 24, 33, 32, 21, 26, 8, 14, 7, 12, 6, 13 and
8 checks). Step 14 is the script with all 34 sections.

**Expected:** exit status 0. On the hosted Windows runner: 353 passed, 1 failed, 2 skipped, 0 untested on the pre-release tree (the same manifest check; the OpenCL GPU section and the CUDA section skipped); the delivered archive: WINDOWS-CI-5.18.md beside the ZIP.

Options (append to the `.bat` line): `-Quick`, `-SkipGpu`, `-SkipIntegrity`. A check is `passed`, `failed`,
`skipped` (with its reason) or `untested`; exit status 0 = no gate failed and none is untested; a missing report is
not a pass.

**What only your PC can show** is unchanged from 5.17: whether the RTX 4060 Ti gives the bits of the CPU for method
exact-hu, whether it is faster than 24 threads, and the CPU paths on 8 and 24 threads. For 5.18 itself your PC adds
one thing: that a third machine writes the same translated files.

## 4. Using it by hand (5 minutes, optional)

In a command prompt in the release folder. A river study with whole ranges and bets of 33% and 100% of the pot is
solved, then scored in the same game with a 66% bet added, where the opponent may use the size it was not solved
for:

    set D=validation\5.18\windows\offtree
    mwcli.exe %D%\ot-river.base.spec.json 1000000 1 %TEMP%\a.state 1024
    echo {"method":"exact-hu"} > %TEMP%\rq.json
    mwcli.exe --gain %D%\ot-river.base.spec.json %TEMP%\a.state %TEMP%\rq.json
    mwcli.exe --translate %D%\ot-river.base.spec.json %TEMP%\a.state %D%\ot-river.plus-66.spec.json %TEMP%\b.state blend
    mwcli.exe --gain %D%\ot-river.plus-66.spec.json %TEMP%\b.state %TEMP%\rq.json

The two answers must contain `"nashConvBits":"3fc4f0b9d40dc14b"` (the strategy in its own tree) and
`"nashConvBits":"3fc7d363b7a3bc4e"` (in the tree with the 66% bet). With `harmonic` in place of `blend` the second is
`"3fe18f1d5c3fd67b"`: NashConv 0.164 chips in its own tree, 0.186 against the 66% bet with blend, 0.549 with harmonic (pot 6).

A line of real actions, mapped onto the tree (check, a bet of 66% of the pot, a raise to 12, call):

    echo {"actions":["check",{"pot":0.66},12,"call"]} > %TEMP%\line.json
    mwcli.exe --offtree %D%\ot-river.base.spec.json %TEMP%\line.json

ends on the tree paths `0121` and `0221` with weights 0.4066 and 0.5934.

**In the program window:** Multiway, a study with wide ranges trained by the desktop program, "Open latest on
desktop", "Explore strategy". Under the action buttons there is a field "A size the tree does not have". Type an
amount, choose the rule, "Map onto the tree": the tree sizes it is taken as appear as buttons, with their weights.

## 5. Still open from earlier phases (nothing in 5.18 replaces them)

* The **`rbes` equal-time kit** delivered with 5.13 (`release-5.13/rbes-equal-time/`).
* **`Run 5.14 equal-time comparison.bat`** (about 2 to 2.5 hours, CPU only; in this archive unchanged).

Neither is needed to use 5.18. They decide what a later release does.

## 6. Files to send back

From the release folder, after the **full** validation:

    Windows-validation-5.18.json          Windows-validation-5.18.txt
    Windows-selftest518-5.18.json         Windows-selftest517-5.18.json
    Windows-selftest516-5.18.json         Windows-selftest515-5.18.json
    Windows-selftest514-5.18.json         Windows-selftest513-5.18.json
    Windows-selftest512-5.18.json         Windows-selftest511-5.18.json
    Windows-selftest510-5.18.json         Windows-selftest59-5.18.json
    Windows-selftest58-5.18.json          Windows-selftest571-5.18.json
    Windows-selftest-5.18.json
    hardware-validation.json   (written by the CUDA section when the GPU answers)

(and `Windows-focused-validation-5.18.json` / `.txt` if you ran the focused launcher first; the window text if a
launcher ends with a status other than 0).

If you run the open items of section 5: the folders `rbes-equal-time-results` and `equal-time-results` (without
`units`), as WINDOWS-TESTS-5.14.md lists them.

If time is short, the order of value is: the focused validation of 5.18 (it contains everything about the GPU and
everything 5.18 added), the rbes kit, the full validation, the equal-time comparison.

## 7. If something fails

* **`off-tree T1` fails:** your PC trained a base study to another state than the Linux build. Then T3 and T4 fail
  with it. Send the reports; it would be a finding about the trainer, not about 5.18.
* **`off-tree T3` fails and T1 passes:** `mwcli --translate` wrote another file from the same state. Send the
  reports and do not rely on translated states.
* **`off-tree T4` fails and T3 passes:** the same file scored differently: a finding about method exact-hu (two
  seats) or exact (three) on your processor. Send the reports.
* **`off-tree M1` fails:** the rule gave another double than on Linux. Send the report.
* **A check of 5.17 or earlier fails:** 5.18 did not change that code path. WINDOWS-TESTS-5.17.md, section 7, lists
  what each failure of the GPU checks means.
* **Only rows of class `information` or `environment` differ:** not a failure.
