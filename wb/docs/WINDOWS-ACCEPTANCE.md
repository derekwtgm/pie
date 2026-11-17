# Windows acceptance checklist (to be run by a person on Windows 10/11 x64)

None of these have been run. Each step lists the expected result; record anything else as a defect.

1. **Verify the download.** Extract the full ZIP. `RUN-DESKTOP-CHECKS.cmd` → ends with a report whose checks all say PASS and exit code 0.
   It writes `%LOCALAPPDATA%\EightMax-Test-Workbench\Diagnostics\*.json`.
2. **Hardware validation.** `RUN-HARDWARE-CHECK.cmd` → prints `Hardware facts written to …\Reports\hardware-facts.json`. In the dashboard open
   *Ten-table solver run → Load hardware facts…* and select the file. Expected: OS/CPU/RAM/GPU listed; "Native CPU solver ran a short study here";
   `GPU acceleration verified: NO` (always, in this release).
3. **Desktop host.** `START-DESKTOP.cmd`. Expected: a small host window and the dashboard opens in an app-style Edge/Chrome window within ~5 s.
   If the prebuilt host does not become ready in 20 s, the launcher prints a warning and compiles from source (first run needs a few extra seconds).
   Starting a second copy shows "The desktop host is already running". Occupying port 48713 first shows a plain-language port message and adds a line to
   `%LOCALAPPDATA%\EightMax-Test-Workbench\Logs\desktop-host.log`.
4. **Native job cancel / cleanup.** In the dashboard start a native study, press Stop, then close the host window. Expected: no `mwcli.exe` remains in Task Manager.
5. **Install / update.** `INSTALL-WINDOWS.cmd` → "Installed for this Windows user."; Start menu entry *EightMax Test Workbench* launches the host.
   Installing a second (different) release keeps the first folder under `…\Installed`.
6. **Rollback.** `ROLLBACK-WINDOWS.cmd` → "Rolled back to <earlier release>."; Start menu entry now targets the earlier release. A tampered earlier release is refused.
7. **Uninstall.** `UNINSTALL-WINDOWS.cmd` → release files and Start menu entry removed; `NativeJobs` and saved studies preserved.
8. **Ten-table run.** Dashboard → *Ten-table solver run* → Train quick study (or Import native state…) → Start with 10 tables, 20 hands, "Allow labelled scripted fallback" ticked.
   Expected: ten cards advance, `Run summary` appears, `Worker crashes: 0`, deadline misses recorded honestly. Record the summary text and the machine's measured figures.
9. **Emergency stop.** During a long run press *Emergency stop*: all cards stop, status says "Emergency stop latched".
10. **Self-test.** *Run self-test* → `RESULT: all checks passed`.

Linux reference results for comparison: docs/0.23-benchmark-linux-simulated.json and docs/0.23-acceptance-linux-simulated.json.
