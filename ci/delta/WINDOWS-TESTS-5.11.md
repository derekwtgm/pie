# EightMax 5.11: the checks that remain to be made on the Windows PC

Build `@BUILD@`. Target: Windows 11 x64, Intel Core i7-13700F (24 logical processors), 16 GB RAM, NVIDIA GeForce
RTX 4060 Ti (8 GB).

**What has NOT been done.** No program of 5.11 was executed on the target PC, and none on an NVIDIA GPU. The Windows
executables were executed under Wine 9.0 and on a hosted Windows runner (GitHub Actions: Windows Server 2025, a
virtual machine with 4 processors and no NVIDIA GPU; both launchers, Windows PowerShell 5.1). Your 5.10 result on the
PC (220 passed, 0 failed, CUDA included) is evidence for the 5.10 programs. It is the reason to expect 5.11 to pass -
a spec without the new key takes the 5.10 code path and no CUDA code changed - and it is not evidence that it does.

Nothing has to be installed. Nothing is written outside the release folder (the reports) and a temporary folder that
is removed at the end. Saved studies under `Documents\EightMax` are not touched.

## 1. Integrity (1 minute)

Extract `EightMax-Windows-5.11.zip` into a new empty folder. In PowerShell:

    Get-FileHash .\EightMax-Windows-5.11.zip -Algorithm SHA256

must print the `archiveSha256` of `EightMax-Windows-5.11.identity.json` (delivered beside the ZIP). The launchers
check every file against `SHA256SUMS.txt` themselves.

## 2. The focused validation (about 5 to 12 minutes): what 5.11 added or changed

Double-click **`Run 5.11 focused validation.bat`**.

| Step | What runs | Report |
|---|---|---|
| 1 | `mwcli.exe --selftest511 studies <temp> all`: 26 checks in four sections. **streams**: the 64-bit generator against its reference vectors and its inverse, the address rule, and a counter audit of seven real trainings (no counter handed to the generator twice). **training**: `"trainingStreams":"5.10"` writes the 14 recorded states of 5.10; philox64 is reproducible, the same for 1 and 3 threads, resumable byte for byte, and writes the 15 states recorded from the Linux build. **checkpoint**: a state continues only under the streams and seed that trained it. **limits**: a 5.10 state keeps the 10,000,000-update limit; a philox64 state is trained to 10,000,200 updates and past update index 2^32, to the recorded states. | `Windows-selftest511-5.11.json` |
| 2 | `validate_windows511.ps1 -Focused`: machine; every file against `SHA256SUMS.txt`; **golden states** and **threads** (the 5.10-stream trainer against the recorded states with 1, 2, 4, 8 and 24 threads); the import of step 1's report; **streams 5.11**: a frozen-batch philox64 training with 1, 2, 4, 8 and 24 threads and with CPU Only, Automatic, Hybrid and GPU-Preferred - one state, the state of the Linux build (`515fa40c...9fe5eb`) - and deals per second with both kinds of streams. | `Windows-focused-validation-5.11.json`, `.txt` |

**Expected:** exit status 0, "Every required check of the script passed", 0 failed, 0 untested. On the hosted Windows
runner: @FOCUSED@ (the skipped check there was the integrity check, which the pre-release tree could not make; in the
delivered archive it runs: see WINDOWS-CI-5.11.md beside the ZIP).

**What only your PC can show** in this step: the philox64 state with 8 and 24 threads; **Hybrid and GPU-Preferred with
the RTX 4060 Ti really scoring showdowns** (on every machine so far these two modes fell back to the CPU); deals per
second of both kinds of streams on the i7-13700F (rows of class `information`).

## 3. The full validation (30 to 80 minutes)

Double-click **`Run 5.11 Windows validation.bat`**. Steps 1 to 6 are `mwcli.exe --selftest57`, `--selftest571`,
`--selftest58`, `--selftest59`, `--selftest510`, `--selftest511` (28, 24, 33, 32, 21 and 26 checks). Step 7 is the
script with all 21 sections: the 19 sections of the 5.10 script, unchanged in what they test, plus "self-test 5.11"
and "streams 5.11". One request changed: the over-limit study of "refused study" asks for the 5.10 streams by name.

**Expected:** exit status 0. On the hosted Windows runner: @FULL@. On your PC the integrity check and the GPU section
run as well, so the count of passed checks is higher (5.10: 216 on the runner, 220 on your PC).

Options (append to the `.bat` line): `-Quick` (skips throughput, shortens recovery), `-SkipGpu`, `-SkipIntegrity`.

**Reading the result.** Every check is `passed`, `failed`, `skipped` (with its reason) or `untested` (planned but not
reached; never counted as passed). Classes: `gate`, `environment`, `hardware` (needs the GPU), `information`
(measurements). Exit status 0 = no gate failed and none is untested; 1 = a gate failed or was not reached; 2 = the
script itself did not finish. A missing report is not a pass.

## 4. Files to send back

After the **full** run, from the release folder (all small text files):

    Windows-validation-5.11.json          Windows-validation-5.11.txt
    Windows-selftest511-5.11.json         Windows-selftest510-5.11.json
    Windows-selftest59-5.11.json          Windows-selftest58-5.11.json
    Windows-selftest571-5.11.json         Windows-selftest-5.11.json
    hardware-validation.json              (written by the GPU section when the GPU answers)

and, if you ran the focused launcher first, `Windows-focused-validation-5.11.json` and `.txt`. If a launcher ends
with a status other than 0, also the text it printed in its window (select all, copy) - the reports say which check,
the window says why a step could not start.

## 5. If something fails

* **A state differs from the recorded one** (`training W3`, `limits L2/L3`, `streams 5.11 / philox64 state equals the
  Linux build`): this would mean the Windows program computes other numbers than the Linux build - a real defect of
  5.11. Keep the reports; nothing trained with the 5.10 streams is affected. Until it is repaired, start studies with
  `trainingStreams=5.10` (section 6).
* **A check of the 5.10 streams fails** (`golden states`, `threads`, `training D1`, `self-test 5.10`): the promise that
  5.11 leaves the 5.10 trainer untouched is broken on your PC. Do not continue 5.10 checkpoints with 5.11; send the reports.
* **GPU section fails or Hybrid / GPU-Preferred write another state**: use CPU Only and send `hardware-validation.json`.
* **Only rows of class `information` or `environment` differ**: not a failure.

## 6. Which streams your work uses

| What you start | Streams in 5.11 | Limit of one training state |
|---|---|---|
| A study (Study tab, `mwcli --study`, the study launchers) | @DEFAULT@ | @DEFAULTLIMIT@ |
| ... with `trainingStreams=5.10` (option) | the 32-bit streams of 5.10: the numbers 5.10 trained with | 10,000,000 updates |
| ... with `trainingStreams=philox64` | counter-based 64-bit | 2,000,000,000 deals per seed (the study's own bound) |
| `mwcli spec.json ...` with a spec that says `"trainingStreams":"philox64"` | counter-based 64-bit | 140,737,488,355,327 updates |
| `mwcli spec.json ...` with any spec written by 5.10 or earlier | 5.10 | 10,000,000 updates |
| The interactive multiway panel (train, stop, explore) | 5.10 | 10,000,000 updates |
| A saved state or study checkpoint | the streams that trained it, always | theirs |
