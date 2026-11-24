# EightMax 5.9: the checks that remain to be made on the Windows PC

Build `@BUILD@`. Target: Windows 11 x64, Intel Core i7-13700F (16 cores, 24 logical processors), 16 GB RAM, NVIDIA
GeForce RTX 4060 Ti (8 GB).

**What has NOT been done.** No program of 5.9 was executed on Windows hardware, and none on an NVIDIA GPU. Everything
reported as tested was tested on Linux or, for the Windows executables, under Wine 9.0 (Wine is not Windows). The
PowerShell validation script was executed with PowerShell 7.4 on Linux against the Linux programs - not with Windows
PowerShell 5.1, not on Windows. The GitHub Actions Windows workflow was not run (no access to a Windows runner from
the development session). Physical results of 5.7 exist; they are not evidence for 5.8 or 5.9.

Nothing has to be installed. Nothing is written outside the release folder (the reports) and a temporary folder that
is removed at the end. Saved studies under `Documents\EightMax` are not touched: the one check that starts the
desktop host gives it a private profile folder inside the temporary folder.

## 1. Before anything else: integrity (1 minute)

Extract `EightMax-Windows-5.9.zip` into a new empty folder. In PowerShell:

    Get-FileHash .\EightMax-Windows-5.9.zip -Algorithm SHA256

must print the `archiveSha256` of `EightMax-Windows-5.9.identity.json` (delivered beside the ZIP). The validation
launchers check every file against `SHA256SUMS.txt` themselves.

## 2. The focused validation (5 to 12 minutes): what 5.9 added

Double-click **`Run 5.9 focused validation.bat`**.

| Step | What runs | Report |
|---|---|---|
| 1 | `mwcli.exe --selftest59 studies <temp> all`: 32 checks - the evaluation generator against its known answers, the confidence statements against reference numbers and exact binomial coverage, `mwcli --response` against exact values on four fixtures (every bound at most the exact value; threads, parallel seats and all evaluation walks give the same bits; the 5.8 streams reproduce 5.8; an evaluation that cannot finish; malformed requests) | `Windows-selftest59-5.9.json` |
| 2 | `validate_windows59.ps1 -Focused`: machine description; every file against `SHA256SUMS.txt`; the 5.8 self-test (33 checks, including the over-limit study refused before training); the 5.9 self-test imported check by check; seven 5.9 reference responses and seven 5.8 reference responses reproduced bit for bit; the desktop host refusing an over-limit study and leaving no folder | `Windows-focused-validation-5.9.json`, `.txt` |

**Expected:** exit status 0, "Every required check of the script passed", 0 failed, 0 untested. On Linux the same
script gave 94 passed, 0 failed, 1 skipped by option (`validation/5.9/powershell/`); on Windows the count is higher
by the integrity check and may differ by environment rows.

## 3. The full validation (20 to 60 minutes)

Double-click **`Run 5.9 Windows validation.bat`**. Steps 1 to 4 are `mwcli.exe --selftest57`, `--selftest571`,
`--selftest58`, `--selftest59` (28, 24, 33 and 32 checks; reports `Windows-selftest-5.9.json`,
`Windows-selftest571-5.9.json`, `Windows-selftest58-5.9.json`, `Windows-selftest59-5.9.json`). Step 5 is the script
with all 17 sections: environment, integrity, self-test 5.7, golden states, threads, evaluator, study, recovery,
self-test 5.7.1, self-test 5.8, self-test 5.9, trained response, configuration, throughput, desktop host, GPU,
refused study. Reports: `Windows-validation-5.9.json`, `.txt`, and `hardware-validation.json` when the GPU answers.

Options (append to the `.bat` line or run the script directly): `-Quick` (skips throughput, shortens recovery),
`-SkipGpu`, `-SkipIntegrity`.

**Reading the result.** Every check is `passed`, `failed`, `skipped` (with its reason) or `untested` (planned but not
reached, with its reason; never counted as passed). Classes: `gate` (must pass on every Windows PC), `environment`,
`hardware` (needs the GPU), `information` (measurements). Exit status 0 = no gate failed and none is untested;
1 = a gate failed or was not reached; 2 = the script itself did not finish. A missing report is not a pass: the
launchers turn it into a failure.

**Known Wine-only behaviour that should NOT appear on Windows:** under Wine the 5.7.1 self-test's three
process-memory checks do not pass (Wine does not report a working set the way Windows does; 21 of 24). On Windows
all 24 are expected to pass, as 5.7.1's physical run did.

## 4. What only this PC can show

| Item | How | Why it is open |
|---|---|---|
| the Windows executables on real Windows | sections 2 and 3 above | Wine only so far |
| Windows PowerShell 5.1 running `validate_windows59.ps1` | sections 2 and 3 | parsed and executed by PowerShell 7.4 on Linux only |
| CUDA paths (Automatic, Hybrid, GPU-Preferred, CPU/GPU numerical agreement, device errors) | section "GPU" of the full validation; `Validate CUDA hardware.bat`; `Compare processing modes.bat` | no NVIDIA GPU in development. **5.9 changed no CUDA code**, so the expectation is the 5.7 physical result; it is still unverified for the 5.9 build |
| performance on the i7-13700F | section "throughput" of the full validation; for the response evaluation see below | every timing in PERFORMANCE-5.9.md is from a 4-processor development container |
| evaluation on 24 logical processors | below | not available in development (4 processors) |
| long runs (hours), full memory (16 GB) | a real study of your own | not attempted |

### 4.1 The response example (1 to 3 minutes)

Double-click **`Run 5.9 response example.bat`**. It trains the small six-player flop fixture for 200,000 deals and
writes `EightMax-5.9-response-example.json`. Look at `summary.simultaneous`: `nashConvLowerBound` must be at most
`summary.exactNashConv`, and `summary.againstExact` must show every statement holding.

### 4.2 Evaluation speed and thread scaling on this PC (optional, 5 minutes)

In a command prompt in the release folder:

    mwcli.exe validation\5.9\windows\response\flop6-jack-small.spec.json 200000 1 %TEMP%\em59.state 256
    echo {"responseDeals":200000,"samples":2048000,"seed":59,"futureActions":"sample","threads":1} > %TEMP%\em59-1.json
    echo {"responseDeals":200000,"samples":2048000,"seed":59,"futureActions":"sample"} > %TEMP%\em59-all.json
    mwcli.exe --response validation\5.9\windows\response\flop6-jack-small.spec.json %TEMP%\em59.state %TEMP%\em59-1.json 256 > one-thread.json
    mwcli.exe --response validation\5.9\windows\response\flop6-jack-small.spec.json %TEMP%\em59.state %TEMP%\em59-all.json 256 > all-threads.json

`wallSeconds` and, per seat, `sampled.elapsedMs` are in both files; `evaluationThreads` says how many threads were
used. **The gain bits (`sampled.gain.gainBits`) of every seat must be identical in the two files**: the thread count
may only change the time. With 2,048,000 evaluation deals the simultaneous bound should certify most of exact
NashConv of this fixture (about 0.6 BB after 20,000 training deals in the self-test; compare `exactNashConv`
if you add `"exact":true`).

## 5. What to send back

The report files named above (JSON and text). They contain the machine description, every check with its status and,
for anything not passed, the exit status and output of the processes involved. If a launcher window says the script
did not finish (exit status 2), the text in the window and whatever report files exist are the evidence; the
self-test reports of the earlier steps stand on their own.

## 6. Not validated by any of the above

A validation run shows that this build computes on this PC what it computed in development. It does not show that a
trained strategy is close to equilibrium: see RELEASE-5.9.md, "Known limitations", and MATHEMATICAL-VALIDATION-5.9.md,
section 9.
