# EightMax 5.13: the checks that remain to be made on the Windows PC

Build `e9ce3436fa829e47`. Target: Windows 11 x64, Intel Core i7-13700F (24 logical processors), 16 GB RAM, NVIDIA GeForce
RTX 4060 Ti (8 GB).

**What has NOT been done.** No program of 5.13 was executed on the target PC, and none on an NVIDIA GPU. The Windows
executables ran under Wine 9.0 and on a hosted Windows runner (Windows Server 2025, a virtual machine with 4
processors and no NVIDIA GPU; both launchers, Windows PowerShell 5.1). Nobody has looked at the 5.13 interface on
Windows. **Neither 5.11 nor 5.12 had been reported from the target PC** when 5.13 was made, so the 5.13 launchers run
their checks too: one run of 5.13 covers all three. **Do not run the 5.12 launchers:** they end with exit status 1
on every PC because of a defect in their script (RELEASE-5.13.md). Your 5.10 result (220 passed, 0 failed, CUDA
included) remains the last evidence from your hardware.

Nothing has to be installed. Nothing is written outside the release folder (the reports) and a temporary folder that
is removed at the end. Saved studies under `Documents\EightMax` are not touched.

## 1. Integrity (1 minute)

Extract `EightMax-Windows-5.13.zip` into a new empty folder. In PowerShell:

    Get-FileHash .\EightMax-Windows-5.13.zip -Algorithm SHA256

must print the `archiveSha256` of `EightMax-Windows-5.13.identity.json` (delivered beside the ZIP). The launchers
check every file against `SHA256SUMS.txt` themselves.

## 2. The focused validation (about 10 to 25 minutes)

Double-click **`Run 5.13 focused validation.bat`**.

| Step | What runs | Report |
|---|---|---|
| 1 | `mwcli.exe --selftest513 studies <temp> all`: 14 checks in five sections. **model**: the large-field satellite model against the exact recursion on 400 fields, its sum rule, the bits recorded from the Linux build, what it refuses. **fixtures**: six satellite fixtures, every advertised decision reached. **training**: 24 states equal to the Linux build; thread counts; stop and continue; exact NashConv as recorded. **closed**: folding aces on the bubble and a mixed river spot against their closed forms; one spot under both payoff models. **checkpoint**: a state continues only under its payoff model, seats and field. | `Windows-selftest513-5.13.json` |
| 2 | `validate_windows513.ps1 -Focused`: machine; every file against `SHA256SUMS.txt`; **golden states**, **threads** (the 5.10-stream trainer with 1, 2, 4, 8 and 24 threads); **self-test 5.11**, **streams 5.11**; **self-test 5.12**, **table 5.12**; **self-test 5.13**; **satellite 5.13**: `mwcli --satfield` prints the bits of the Linux build for three fields; a large-field satellite study and a five-handed one train with 1, 2, 4, 8 and 24 threads and with CPU Only, Automatic, Hybrid and GPU-Preferred to one state each, the state of the Linux build; the interface file carries the satellite card. | `Windows-focused-validation-5.13.json`, `.txt` |

**Expected:** exit status 0, 0 failed, 0 untested. On the hosted Windows runner: 93 passed, 1 failed, 0 skipped, 0 untested (133.4 s) on the pre-release tree - the failed check is `integrity / SHA256SUMS.txt: file missing`, true of that tree; the delivered archive: WINDOWS-CI-5.13.md beside the ZIP.

**What only your PC can show:** all states with 8 and 24 threads; **Hybrid and GPU-Preferred with the RTX 4060 Ti
really scoring showdowns**, on the reference studies of 5.11, 5.12 and 5.13 (on every machine so far these modes fell
back to the CPU); that an Intel processor prints the same bits for the satellite model as the AMD machines did.

## 3. The full validation (40 to 100 minutes)

Double-click **`Run 5.13 Windows validation.bat`**. Steps 1 to 8 are `mwcli.exe --selftest57`, `--selftest571`,
`--selftest58`, `--selftest59`, `--selftest510`, `--selftest511`, `--selftest512`, `--selftest513` (28, 24, 33, 32,
21, 26, 8 and 14 checks). Step 9 is the script with all 25 sections, the GPU section among them.

**Expected:** exit status 0. On the hosted Windows runner: 286 passed, 1 failed, 1 skipped, 0 untested (552.2 s) on the pre-release tree (the same manifest check; the GPU section skipped); the delivered archive: WINDOWS-CI-5.13.md beside the ZIP. On your PC the GPU section runs as well.

Options (append to the `.bat` line): `-Quick`, `-SkipGpu`, `-SkipIntegrity`. Statuses, classes and exit statuses are
as in 5.11: a check is `passed`, `failed`, `skipped` (with its reason) or `untested`; exit status 0 = no gate failed
and none is untested; a missing report is not a pass.

## 4. Six things to look at by hand (5 minutes)

Open `EightMax.exe`.

1. **ICM tab, top card.** Stacks `30, 9, 16, 22, 14`, payouts `satellite 4`: the $EV column reads **0.94, 0.59,
   0.81, 0.89, 0.77** (each player's probability of a seat).
2. **ICM tab, card "Satellite, large field".** As it opens (table `25, 18, 40, 12, 31, 22`, other tables `82x25`, 40
   seats): "Wins a seat" reads **45.57%, 35.43%, 62.26%, 25.26%, 52.99%, 41.44%**.
3. **Multiway tab.** The Payoff list offers "Satellite, large field"; choosing it shows "Seats awarded" and "Players
   at other tables".
4. **Study tab.** The list ends with a group "Satellites" (six studies). Pick "Known small game: folding aces on the
   satellite bubble" and run it with the preset Quick: Fold **+0.9408**, Call 24.9 **+0.8092**.
5. **Table switch** (5.12): `8-max | 6-max` at the top; 6-max shows the seats MP, HJ, CO, BTN, SB, BB; push/fold 10 BB
   seat MP reads 20.2%; back on 8-max seat UTG reads 15.2%.
6. Close and reopen: the table you chose and the satellite entries are still there.

If one of these is not as described, a screenshot of the window is the most useful thing to send.

## 5. Files to send back

After the **full** run, from the release folder:

    Windows-validation-5.13.json          Windows-validation-5.13.txt
    Windows-selftest513-5.13.json         Windows-selftest512-5.13.json
    Windows-selftest511-5.13.json         Windows-selftest510-5.13.json
    Windows-selftest59-5.13.json          Windows-selftest58-5.13.json
    Windows-selftest571-5.13.json         Windows-selftest-5.13.json
    hardware-validation.json              (written by the GPU section when the GPU answers)

and, if you ran the focused launcher first, `Windows-focused-validation-5.13.json` and `.txt`; the window text if a
launcher ends with a status other than 0; one line about section 4.

**Before Phase 4** the plan needs your equal-time results for `rbes` against the default trainer. They need a
launcher that does not exist yet (the validation only measures deals per second of both trainers). Tell me when you
want it: it is a small delivery of its own and does not have to wait for anything.

## 6. If something fails

* **`model M4`, or `satellite 5.13 / mwcli --satfield prints the bits of the Linux build`:** your processor or
  Windows build computed other bits than Linux for the satellite model. The model would still be right to about
  1e-14, but states would no longer be comparable across machines. Send the reports; this is the check most worth
  seeing from an Intel CPU.
* **A satellite state differs from the recorded one, the bits being equal:** a defect in how the engine uses the
  model. Send the reports; satellite studies with at most 16 players (`satellite N`) do not use it.
* **A check of 5.12 or earlier fails:** 5.13 did not change that code. Send the reports.
* **Hybrid or GPU-Preferred write another state:** use CPU Only and send `hardware-validation.json`.
* **Only rows of class `information` or `environment` differ:** not a failure.
