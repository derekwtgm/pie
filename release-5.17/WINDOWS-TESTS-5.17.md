# EightMax 5.17: the checks that remain to be made on the Windows PC

Build `6efe7970626b6460`. Target: Windows 11 x64, Intel Core i7-13700F (24 logical processors), 16 GB RAM, NVIDIA GeForce
RTX 4060 Ti (8 GB).

**What has NOT been done.** No program of 5.17 was executed on the target PC, and **no graphics card has run the new
method**: the development machine has none. The part of 5.17 that is about the GPU was run on a CPU implementation
of OpenCL (PoCL), natively and through the Windows executable under Wine. That exercises the program's device path;
it says nothing about an NVIDIA driver. The Windows executables also ran on a hosted Windows runner (Windows Server
2025, a virtual machine with 4 processors and no GPU; Windows PowerShell 5.1). **5.11 to 5.16 had not been reported
from the target PC either** when 5.17 was made; the 5.17 launchers run their checks too, so one run of 5.17 covers
all seven. Your 5.10 result (220 passed, 0 failed, CUDA included) remains the last evidence from your hardware.

Nothing has to be installed. Nothing is written outside the release folder and a temporary folder that is removed at
the end. Saved studies under `Documents\EightMax` are not touched. The GPU is reached through the OpenCL library
that the NVIDIA driver installs (`OpenCL.dll` in `System32`).

## 1. Integrity (1 minute)

Extract `EightMax-Windows-5.17.zip` into a new empty folder. In PowerShell:

    Get-FileHash .\EightMax-Windows-5.17.zip -Algorithm SHA256

must print the `archiveSha256` of `EightMax-Windows-5.17.identity.json` (delivered beside the ZIP). The launchers
check every file against `SHA256SUMS.txt` themselves.

## 2. The focused validation (about 30 to 55 minutes)

Double-click **`Run 5.17 focused validation.bat`**.

| Step | What runs | Report |
|---|---|---|
| 1 | `mwcli.exe --selftest517 validation\5.17\windows\brhu studies <temp> all`: 7 CPU checks and 6 device checks. **cpu**: twelve heads-up studies (river, turn, flop; 10 to 1176 hands a seat) train to the states of the Linux build; exact-hu gives the bits recorded on Linux, on 1, 2, 3 and 4 threads; agreement with method exact; fallbacks; policy current; refusals. **gpu**: the OpenCL device, the kernel compiled by the driver, the arithmetic probe; the bits of the CPU for every study; every item repeated on the CPU; batch sizes; an altered result is found; the unprotected kernel | `Windows-selftest517-5.17.json` |
| 2 | `validate_windows517.ps1 -Focused`: machine; every file against `SHA256SUMS.txt`; golden states; threads (1, 2, 4, 8 and 24); the self-tests and sections of 5.11 to 5.16; **self-test 5.17** (the CPU checks again, imported one by one); **exact best response 5.17**: the device checks on the GPU of this PC, then three whole-range studies three times each on the CPU (24 threads) and on the GPU, with the seconds of both | `Windows-focused-validation-5.17.json`, `.txt` |

**Expected:** exit status 0, 0 failed, 0 untested, and **no check of "exact best response 5.17" skipped** (on your PC
the GPU must answer; "skipped" there means the driver showed no OpenCL GPU with double precision, and the reason is
in the report). On the hosted Windows runner: 149 passed, 1 failed, 1 skipped, 0 untested (606.4 s) on the pre-release tree - the failed check is `integrity / SHA256SUMS.txt: file missing`, true of that tree; the skipped one is the OpenCL GPU section (no OpenCL platform on the runner); the delivered archive: WINDOWS-CI-5.17.md beside the ZIP.

## 3. The full validation (60 to 135 minutes)

Double-click **`Run 5.17 Windows validation.bat`**. Steps 1 to 12 are `mwcli.exe --selftest57`, `--selftest571`,
`--selftest58`, `--selftest59`, `--selftest510`, `--selftest511`, `--selftest512`, `--selftest513`, `--selftest514`,
`--selftest515`, `--selftest516`, `--selftest517` (28, 24, 33, 32, 21, 26, 8, 14, 7, 12, 6 and 13 checks). Step 13
is the script with all 33 sections, the two GPU sections among them (CUDA as before; OpenCL for exact-hu).

**Expected:** exit status 0. On the hosted Windows runner: 342 passed, 1 failed, 2 skipped, 0 untested (1206.3 s) on the pre-release tree (the same manifest check; the OpenCL GPU section and the CUDA section skipped); the delivered archive: WINDOWS-CI-5.17.md beside the ZIP.

Options (append to the `.bat` line): `-Quick`, `-SkipGpu`, `-SkipIntegrity`. A check is `passed`, `failed`,
`skipped` (with its reason) or `untested`; exit status 0 = no gate failed and none is untested; a missing report is
not a pass.

**What only your PC can show:**

* whether the RTX 4060 Ti, through NVIDIA's OpenCL compiler, gives the bits of the CPU (checks G1 to G5 and the
  timed runs). This is the one claim of 5.17 that has no evidence yet;
* whether the GPU is faster than 24 CPU threads on the three timed studies. The report gives both, three runs each,
  and says "GPU faster" only if the slowest GPU run beats the fastest CPU run;
* the CPU path on 8 and 24 threads.

## 4. Using the method by hand (5 minutes, optional)

In a command prompt in the release folder (the study is one of the validation cases; 1128 hands a seat):

    mwcli.exe validation\5.17\windows\brhu\wr-turn-compact.spec.json 200000 1 %TEMP%\wr.state 2048
    echo {"method":"exact-hu","threads":24} > %TEMP%\rq.json
    mwcli.exe --gain validation\5.17\windows\brhu\wr-turn-compact.spec.json %TEMP%\wr.state %TEMP%\rq.json 4096
    echo {"method":"exact-hu","brDevice":"gpu"} > %TEMP%\rq.json
    mwcli.exe --gain validation\5.17\windows\brhu\wr-turn-compact.spec.json %TEMP%\wr.state %TEMP%\rq.json 4096

Both answers must contain `"nashConvBits":"3fe3b47499adb2de"`. `mwcli.exe --opencl-info` shows the device.

## 5. Still open from earlier phases (nothing in 5.17 replaces them)

* The **`rbes` equal-time kit** delivered with 5.13 (`release-5.13/rbes-equal-time/`).
* **`Run 5.14 equal-time comparison.bat`** (about 2 to 2.5 hours, CPU only; in this archive unchanged).

Neither is needed to use 5.17. They decide what a later release does.

## 6. Files to send back

From the release folder, after the **full** validation:

    Windows-validation-5.17.json          Windows-validation-5.17.txt
    Windows-selftest517-5.17.json         Windows-selftest516-5.17.json
    Windows-selftest515-5.17.json         Windows-selftest514-5.17.json
    Windows-selftest513-5.17.json         Windows-selftest512-5.17.json
    Windows-selftest511-5.17.json         Windows-selftest510-5.17.json
    Windows-selftest59-5.17.json          Windows-selftest58-5.17.json
    Windows-selftest571-5.17.json         Windows-selftest-5.17.json
    hardware-validation.json   (written by the CUDA section when the GPU answers)

(and `Windows-focused-validation-5.17.json` / `.txt` if you ran the focused launcher first; the window text if a
launcher ends with a status other than 0). The OpenCL device, the device checks and the seconds are inside
`Windows-validation-5.17.json` (`openclDevice`, `selftest517gpu`, `exactHuTiming`).

If you run the open items of section 5: the folders `rbes-equal-time-results` and `equal-time-results` (without
`units`), as WINDOWS-TESTS-5.14.md lists them.

If time is short, the order of value is: the focused validation of 5.17 (it contains everything about the GPU), the
rbes kit, the full validation, the equal-time comparison.

## 7. If something fails

* **`exact best response 5.17 / OpenCL GPU` is skipped:** the reason is in the line. "no OpenCL library": the
  NVIDIA driver's OpenCL is missing (reinstalling the driver restores it). "the arithmetic of this device differs":
  the card computed other bits in the probe; the program will not use it. Send the report: that is a finding, and
  the CPU results are unaffected.
* **G1 fails with "the driver could not compile the kernel":** the message carries the compiler's log. Send it.
* **G2, G3 or G4 fail, or a timed run has other bits:** the card passed the probe and still returned another
  number somewhere. The program refuses such a result when it finds it (every 16th item is repeated on the CPU;
  all of them with `"brDevice":"both"`). Use `"brDevice":"cpu"` and send the reports.
* **`cpu S1` or `cpu B1` fail:** your PC trained a study to another state, or computed another best response on
  the CPU, than the Linux build. Send the reports; do not use exact-hu until it is understood.
* **A check of 5.16 or earlier fails:** 5.17 did not change that code path. Send the reports.
* **The window stops responding for seconds during the GPU checks:** the program sizes its batches to about a
  fifth of a second each; if the screen still stutters, say so. It is not an error.
* **Only rows of class `information` or `environment` differ:** not a failure.
