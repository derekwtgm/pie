# Tests to run on your Windows PC — EightMax 5.6

EightMax 5.6 was built and tested on Linux, and its Windows programs were run under Wine. **Nothing was run on
Windows hardware, and no NVIDIA GPU was available.** This page lists the tests that only your PC can do, and one
script that does almost all of them for you.

Nothing here installs software. Everything runs from the folder you extracted the ZIP into.

## The short version

1. Extract `EightMax-Windows-5.6.zip` into a new folder (for example `C:\EightMax-5.6`). Do not run it from inside the ZIP.
2. Double-click **`Run 5.6 Windows validation.bat`**.
   - If Windows SmartScreen asks, choose *More info* → *Run anyway*. The programs are unsigned.
   - It takes 10 to 40 minutes. A black window shows each check as it finishes: `[PASS]`, `[FAIL]`, `[SKIP]` or `[INFO]`.
3. When it ends, two files are in the folder:
   - `Windows-validation-5.6.txt` — one line per check, readable.
   - `Windows-validation-5.6.json` — the same with every measured number.
   - If your PC has the RTX 4060 Ti driver installed, `hardware-validation.json` is written as well.
4. Keep those files. If you want the results looked at, send those two or three files; nothing else is needed.

The script was written for Windows PowerShell 5.1 (included in Windows 11) and **has not been executed anywhere**:
no Windows machine and no PowerShell were available during development. If it stops with a red PowerShell error
before printing any check, that is a fault of the script, not of EightMax; the manual steps below cover the same
ground.

Options, if you start it from a command prompt in the release folder:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File source\tools\validate_windows56.ps1 -Quick
```

`-Quick` skips the throughput section and shortens the recovery test. `-SkipGpu` skips the GPU section.
`-SkipIntegrity` skips the checksum pass over all files.

## What the script checks, and what a failure would mean

| Section | What it does | Why it matters | If it fails |
|---|---|---|---|
| environment | Records Windows version, CPU, RAM, GPU; detects Wine or a virtual machine | Shows the report came from physical hardware | Informational |
| integrity | Every file against `SHA256SUMS.txt`; build id of the programs against `BUILD-INFO.json` | The files are the ones that were released | Extract the ZIP again into an empty folder |
| golden states | Trains 11 small games and compares the saved state's SHA-256 with what the 5.5 Linux program wrote | The Windows program on your CPU computes exactly the same numbers as the tested Linux program, and the 5.6 trainer still equals 5.5 | A real numerical difference on your CPU: keep the JSON, this is important |
| threads | Trains one game with 1, 2, 4, 8 and all logical processors | Results must not depend on the thread count; shows speed per thread count on your i7 | A threading defect on your CPU |
| evaluator | Exact best response with a 32 MiB and a 1,024 MiB cache | The new compact tables give the same value with any cache size | An evaluator defect |
| study | A complete quick study of the known A-K-Q game | The study workflow, the 5.6 statistics and warnings | A study defect |
| recovery | Interrupts a study by time limit and resumes it; kills the program and resumes; tries a second program on the same checkpoint; damages a manifest | Checkpoints survive on NTFS as they do on Linux | A recovery defect on Windows |
| memory | Gives a study a too-small memory budget, then resumes | The memory stop is safe | A memory-accounting difference on Windows |
| throughput | Sampled deals per second on the eight study fixtures | **Your PC's real training speed** (the report's numbers are from a cloud container) | Informational |
| desktop host | Starts `EightMax.exe` without a browser, reads `/api/info`, loads the page | The desktop application starts | A host defect |
| GPU | Runs `validate_hardware.ps1` (CPU against CUDA bit for bit, budgets, cold/warm device, cancellation) and compares the four processing modes on a study | The RTX 4060 Ti gives the same results as the CPU, and how fast | Skipped with the reason if no NVIDIA device answers |

## Manual tests (if you prefer, or if the script cannot run)

Open a command prompt in the release folder (type `cmd` in the folder's address bar).

### 1. The programs start and report the right build

```bat
mwcli.exe --build-id
```

```bat
EightMax.exe --build-id
```

Both must print `EightMaxBuild=` followed by the build id in `BUILD-INFO.json` (also at the top of `RELEASE-5.6.md`).

### 2. The existing self-tests

Double-click `Run self-tests.bat`. It writes `Windows-self-test.json` and prints a summary. These are the 4.6–4.9
checks; they are unchanged.

### 3. A quick study

Double-click `Run 5.6 quick study.bat`. It should finish in under a minute and print a table, then a section headed
**"What this study does not establish"**. With two trainings it must say that no best action is declared.

### 4. A study that can declare a best action

Double-click `Run 5.6 replicated study.bat` (nine trainings; a few minutes). For this known game the two actions
are exactly tied in theory, so the correct outcome is still *no* declaration (a near tie or unresolved). The purpose
is to see nine trainings run side by side on your CPU.

### 5. Interrupt and resume

1. Double-click `Run 5.6 standard study.bat`.
2. While it runs, close its window (or press Ctrl+C).
3. Double-click `Resume 5.6 standard study.bat`. It must continue, not start over, and finish with
   `Result written to EightMax-5.6-standard-study.json`.
4. While a study is running, double-click `Resume 5.6 standard study.bat` a second time. The second window must
   refuse with `error 409: the study checkpoint ... is in use`.

### 6. The desktop application

1. Double-click `EightMax.exe`. A console window and your browser open.
2. Open the **Study** tab, choose a built-in fixture, press **Run study**, then **Stop**, then resume it from the
   *Saved studies* list.
3. In the result, the *Study accuracy and recovery* panel must show, under *Best action supported*, a line
   `across trainings: ...` with the number of trainings and the number needed.

### 7. The GPU (RTX 4060 Ti)

1. Double-click `Validate CUDA hardware.bat` (a few minutes). It writes `hardware-validation.json`.
   The important field is `"physicalNvidiaExecution": true`: CUDA scored boards on your PC and matched the CPU bit
   for bit.
2. Double-click `Compare processing modes.bat` for CPU / Automatic / Hybrid / GPU-Preferred timings.
3. Double-click `GPU self-test.bat`.

No CUDA code changed in 5.6. What 5.6 changed near it: showdown tables free their per-board scores after their
histogram is built (CPU or GPU scored), so a GPU-scored table follows the same new path. That path was exercised
with the CUDA driver test double on Linux, not with a real driver.

### 8. Power loss (optional, only if you want to)

Checkpoint durability under real power loss was never tested (not in 5.5 either). If you want to try: start
`Run 5.6 standard study.bat`, wait a minute, hold the power button, restart, and run
`Resume 5.6 standard study.bat`. Expected: it resumes from the last committed checkpoint or reports precisely
which file is damaged and falls back to the previous one. Do this only on a machine where an abrupt power-off is
acceptable.

## What to send back

- `Windows-validation-5.6.txt` and `Windows-validation-5.6.json`
- `hardware-validation.json` (if the GPU section ran)
- For any failed check, the text of the line that failed is usually enough.
