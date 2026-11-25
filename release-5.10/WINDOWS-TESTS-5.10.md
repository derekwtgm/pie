# EightMax 5.10: the checks that remain to be made on the Windows PC

Build `7fa0e8c16d6c6ade`. Target: Windows 11 x64, Intel Core i7-13700F (16 cores, 24 logical processors), 16 GB RAM, NVIDIA
GeForce RTX 4060 Ti (8 GB).

**What has NOT been done.** No program of 5.10 was executed on the target PC, and none on an NVIDIA GPU. Everything
reported as tested was tested on Linux or, for the Windows executables, under Wine 9.0 (Wine is not Windows); a run of the delivered archive on a hosted Windows runner (GitHub Actions, a virtual machine without a GPU), if it took place, is recorded beside the ZIP in `WINDOWS-CI-5.10.md`, not in it.
The PowerShell validation script was executed with PowerShell 7.4 on Linux against the Linux programs - not with
Windows PowerShell 5.1 on the PC. The physical results you sent for 5.9 (95 of 95 focused checks, 192 of 192 full
checks, CUDA included; kept in `validation/5.10/baseline/windows-5.9-physical/`) are evidence for the 5.9 programs.
They are the reason to expect 5.10 to pass - the default trainer writes the same bytes and no CUDA code changed -
and they are not evidence that it does.

Nothing has to be installed. Nothing is written outside the release folder (the reports) and a temporary folder that
is removed at the end. Saved studies under `Documents\EightMax` are not touched: the one check that starts the
desktop host gives it a private profile folder inside the temporary folder.

## 1. Before anything else: integrity (1 minute)

Extract `EightMax-Windows-5.10.zip` into a new empty folder. In PowerShell:

    Get-FileHash .\EightMax-Windows-5.10.zip -Algorithm SHA256

must print the `archiveSha256` of `EightMax-Windows-5.10.identity.json` (delivered beside the ZIP). The validation
launchers check every file against `SHA256SUMS.txt` themselves.

## 2. The focused validation (about 4 to 10 minutes): what 5.10 added or changed

Double-click **`Run 5.10 focused validation.bat`**.

| Step | What runs | Report |
|---|---|---|
| 1 | `mwcli.exe --selftest510 studies <temp> all`: 21 checks in four sections. **estimator**: the exact expectation of the experimental estimator's regret and average-strategy increments, over every outcome of its sampling, against a brute-force walk of the whole betting tree (eight game and variant combinations: chip EV and ICM, river to preflop starts, two to six players; no statistics). **training**: the default trainer writes 14 states recorded from the 5.9 program and `rbes` writes 12 states recorded from the Linux build; one state for 1, 2 and 4 threads, for the batch update of 5.6 and with the key caches off; stop and continue byte for byte; exact NashConv of both trainers on four reference fixtures. **checkpoint**: a state continues only under the algorithm that trained it; nothing is written when it is refused. **limits**: configurations the estimator was not validated for are refused before training; a table limit stops cleanly and the state resumes to the uninterrupted one | `Windows-selftest510-5.10.json` |
| 2 | `validate_windows510.ps1 -Focused`: machine description; every file against `SHA256SUMS.txt`; **golden states** (the eleven states of 5.5, which every release since has had to write) and **threads** (the frozen-batch state of the default trainer with 1, 2, 4, 8 and all logical processors: one SHA-256); the 5.10 self-test imported check by check; **estimator 5.10**: the `rbes` reference state of the Linux build with 1, 2, 4, 8 and all logical processors and in every processing mode (CPU Only, Automatic, Hybrid, GPU-Preferred: with your GPU the last two open CUDA for the showdown scoring of the batches; the state must not change), the exact estimator check through `mwcli.exe --estimator-check`, deals per second of both trainers | `Windows-focused-validation-5.10.json`, `.txt` |

**Expected:** exit status 0, "Every required check of the script passed", 0 failed, 0 untested. On Linux the same
script gave 50 passed, 0 failed, 1 skipped, 0 untested (skipped: integrity / SHA256SUMS.txt) in focused mode and 215 passed, 0 failed, 2 skipped, 0 untested (skipped: integrity / SHA256SUMS.txt; GPU / CUDA validation) with all sections (`validation/5.10/powershell/`); on Windows
the integrity check runs as well and environment rows may differ.

The rows of class `information` in the "estimator 5.10" section are the first measurements of `rbes` on 24 logical
processors: deals per second of both trainers with frozen batches. They decide nothing; PERFORMANCE-5.10.md has the
numbers of the 4-processor development machine for comparison.

## 3. The full validation (25 to 70 minutes)

Double-click **`Run 5.10 Windows validation.bat`**. Steps 1 to 5 are `mwcli.exe --selftest57`, `--selftest571`,
`--selftest58`, `--selftest59`, `--selftest510` (28, 24, 33, 32 and 21 checks; reports `Windows-selftest-5.10.json`,
`Windows-selftest571-5.10.json`, `Windows-selftest58-5.10.json`, `Windows-selftest59-5.10.json`,
`Windows-selftest510-5.10.json`). Step 6 is the script with all 19 sections: environment, integrity, self-test 5.7,
golden states, threads, evaluator, study, recovery, self-test 5.7.1, self-test 5.8, self-test 5.9, trained response,
self-test 5.10, estimator 5.10, configuration, throughput, desktop host, GPU, refused study. Reports:
`Windows-validation-5.10.json`, `.txt`, and `hardware-validation.json` when the GPU answers.

Options (append to the `.bat` line or run the script directly): `-Quick` (skips throughput, shortens recovery),
`-SkipGpu`, `-SkipIntegrity`.

**Reading the result.** Every check is `passed`, `failed`, `skipped` (with its reason) or `untested` (planned but not
reached, with its reason; never counted as passed). Classes: `gate` (must pass on every Windows PC), `environment`,
`hardware` (needs the GPU), `information` (measurements). Exit status 0 = no gate failed and none is untested;
1 = a gate failed or was not reached; 2 = the script itself did not finish. A missing report is not a pass: the
launchers turn it into a failure.

**What Wine showed, for comparison:** `mwcli.exe` passed the five self-tests under Wine (wine-9.0 (Ubuntu 9.0~repack-4build3)): 21 of 21, 32 of 32, 33 of 33, 24 of 24 and 28 of 28 checks for 5.10, 5.9, 5.8, 5.7.1 and 5.7; wrote the `rbes` reference state of the Linux build with 1, 2 and 4 threads and passed the exact estimator check; reproduced the 7 reference responses of 5.9 bit for bit; and passed 9 of the 9 tests of the 5.10 regression file that were run against it.

## 4. What only this PC can show

| Item | How | Why it is open |
|---|---|---|
| the 5.10 Windows executables on the target PC | sections 2 and 3 above | Wine (and a hosted Windows runner, if `WINDOWS-CI-5.10.md` beside the ZIP reports one) only so far |
| Windows PowerShell 5.1 running `validate_windows510.ps1` | sections 2 and 3 | parsed and executed by PowerShell 7.4 on Linux only (a hosted runner, if it ran, used Windows PowerShell 5.1: `WINDOWS-CI-5.10.md`) |
| CUDA paths (Automatic, Hybrid, GPU-Preferred, CPU/GPU numerical agreement, device errors) | section "GPU" of the full validation; `Validate CUDA hardware.bat`; `Compare processing modes.bat`; for `rbes`, the check "every processing mode writes the same state" of either validation | no NVIDIA GPU in development. **5.10 changed no CUDA code and no scheduling**, so the expectation is your 5.9 result; it is unverified for the 5.10 build |
| `rbes` and the default trainer on 24 logical processors (deals per second, thread scaling, one state for every thread count) | "estimator 5.10" and "threads" of either validation; section 4.1 below | 4 processors in development; determinism was checked there for 1 to 4 threads and, under PowerShell on Linux, for the thread counts the script asks for |
| performance on the i7-13700F | section "throughput" of the full validation | every timing in PERFORMANCE-5.10.md is from a 4-processor development container |
| long runs (hours), full memory (16 GB) | a real study of your own | not attempted |

### 4.1 Trying the experimental estimator (2 to 5 minutes, optional)

`rbes` is opt-in. From a command prompt in the release folder, the same fixture and seeds with both trainers:

    mwcli.exe --study studies\flop3-kings-small.emfix.json default.json variants=baseline seeds=3 budgets=20000,100000 quiet=1
    mwcli.exe --study studies\flop3-kings-small.emfix.json rbes.json variants=baseline seeds=3 budgets=20000,100000 quiet=1 estimator=rbes

Both documents contain, per seed and budget, the exact quality measure of this small fixture (`quality` with
`qualityKind` "exact": the sum of the exact best-response gains of the three seats, in BB) and
`trainingSecondsCumulative`. `rbes.json` names the trainer (`run.trainer.estimator`: `rbes`; in every point
`trainer.algorithm`: `rbes-5.10-v1`). A checkpoint written by one trainer is refused by the other, with the reason.

In a native spec the setting is `"estimator":"rbes"`; in a trained-response request it is
`"responseEstimator":"rbes"` (the response is then trained by the experimental estimator; the evaluation and its
confidence statements are unchanged). What it supports and what it refuses: RELEASE-5.10.md.

## 5. What to send back

The report files named above (JSON and text). They contain the machine description, every check with its status and,
for anything not passed, the exit status and output of the processes involved. If a launcher window says the script
did not finish (exit status 2), the text in the window and whatever report files exist are the evidence; the
self-test reports of the earlier steps stand on their own.

## 6. Not validated by any of the above

A validation run shows that this build computes on this PC what it computed in development. It does not show that a
trained strategy is close to equilibrium: see RELEASE-5.10.md, "Known limitations", CONVERGENCE-5.10.md and
MATHEMATICAL-VALIDATION-5.10.md, section 9.
