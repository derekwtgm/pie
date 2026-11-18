# Windows acceptance checklist (to be run by a person on Windows 10/11 x64)

None of these steps has been run: the release has NOT been run on Windows (0.24.0 was built and tested on Linux). Each step lists the expected result; record anything else as a defect.

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

## 0.24 additions (all still NOT run on Windows)
11. **Capture self-test.** `RUN-CAPTURE-CHECK.cmd` (runs `desktop\bin\EightMaxCapture.exe selftest`) → `Capture acceptance PASSED`, report `%LOCALAPPDATA%\EightMax-Test-Workbench\CaptureAcceptance\<time>\capture-acceptance.json`.
    Expected checks: `monitors-listed` (monitor count, virtual desktop size and DPI scale of the primary monitor are plausible), `windows-listed`,
    `selftest-window-capture-resize-minimize-lost` (the tool opens its own window with four coloured quadrants, captures its client area at 640x400 and again after a resize to 800x500,
    verifies the quadrant colours, then reports a minimised window as `target-minimized` and a closed window as `target-lost`). Repeat once with Windows display scaling at 100 %, 150 % and 200 %
    (Settings → Display) and, if available, with a second monitor of a different scale: record the DPI values the report prints. Any `FAIL` is a defect, not a configuration problem.
12. **Window capture in the dashboard.** `START-DESKTOP.cmd` → *Capture & one-table run* → Source *Windows window* → *Refresh windows* → pick Notepad (or any ordinary window you own) →
    tick the consent box → *Start capture*. Expected: the preview shows the window's client area, `Capture live`, ~2 fps at 500 ms; resize the window → frames pause briefly (`resolution-settling`)
    and resume at the new size; minimise it → status shows `target-minimized` and no image is shown; restore → recovers. Cover it partly with another window: with PrintWindow the preview stays correct.
    Stop capture; the preview clears.
13. **Region capture.** Source *Desktop region*, `0,0,960,600`, consent, Start. Expected: the top-left desktop area. A region partly off-screen is refused with `region-offscreen`.
14. **One-table run on the target PC.** Source *Offline controlled client*, mode Simulation, 5 hands, scripted fallback ticked → *Play hands*. Expected: hands complete, history shows solver vs scripted counts,
    *Emergency stop* during a run freezes the table. Export diagnostics and hand history and keep them.
15. **Timing.** Record the capture interval, frames per second and decision cycle time shown by the dashboard; compare with docs/0.24-benchmark-pipeline-linux-simulated.json (Linux, simulated).

Not covered by any step above: Windows Graphics Capture (not implemented), capture of DirectX/GPU-composited game windows (PrintWindow may return a flat image: reported as `invalid-frame`), any external poker client,
GPU use. Those remain open.

## 0.25 additions (all still NOT run on Windows)
16. **One-command acceptance.** `RUN-RELEASE-ACCEPTANCE.cmd` → `Release acceptance PASSED (n checks, k skipped)`, report `%LOCALAPPDATA%\EightMax-Test-Workbench\ReleaseAcceptance\<time>\release-acceptance.json`.
    Checks: `release-integrity`, `powershell-parse-all-scripts` (the first real PowerShell parse of these scripts — expect to find and report defects), `platform-workspace-present`,
    `capture-selftest-printwindow-bitblt`, `desktop-host-native-diagnostics`, `shutdown-leaves-no-native-process`; with `-IncludeInstall`: `install`, `rollback`, `uninstall` (current-user profile only;
    rollback exits 1 when only one release is installed, which counts as expected). Skipped checks are reported as `skipped`, never as passed.
17. **Platform workspace.** `START-DESKTOP.cmd` → *Platform workspace*: Capture tab → *Start capture (controlled client)* → health shows `healthy`, preview shows frames with the region overlay, recognition shows `admitted · image-based`.
    Calibration tab → *Add labelled controlled-client samples* → *Learn templates* → *Preview recognition* → `read`. Applying a region outside the image is refused. Execution tab → Simulation, 3 hands → *Start*; *Pause table 1*,
    *Emergency stop* freeze the table; mode *Authorized external QA* is disabled. Performance tab lists GPU as *not used*.
18. **Emergency stop and shutdown.** During a run press *Emergency stop* (Execution tab, or the ten-table panel), then close the host window: no `mwcli.exe` may remain (also checked by step 16). Worker-crash recovery is exercised by the Linux tests only; there is no Windows result for it.
19. **Windows Graphics Capture** is not implemented: the capture catalogue and the host both say so; record any attempt to use it as a defect only if the UI offers it (it must not).
20. **Record** the capture mean latency, recognition latency and decision cycle shown on the Performance tab at 100/150/200 % display scaling, and compare with `reports/0.25-benchmark-pipeline-linux-simulated.json` (Linux, simulated; different hardware).
