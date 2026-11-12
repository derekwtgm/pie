# EightMax 4.1 on the GitHub Actions Windows runner

Workflow `.github/workflows/windows.yml`, runner label `windows-latest`
(Windows Server virtual machine, no GPU). Each run compiles a fresh
`EightMax.exe`/`mwcli.exe` from the pushed source with MSYS2 UCRT64 GCC,
runs `source/tools/test_windows.ps1` against it, assembles the release,
runs the full regression suite (`tools/run_tests.js`), the 4.1 repeated
concurrency stress step, a PowerShell parse check and
`validate_hardware.ps1` on CPU paths. This is a **virtual machine without an
NVIDIA GPU, not a physical Windows desktop**.

| Run | Commit | Result | Notes |
|---|---|---|---|
| [22](https://github.com/derekwtgm/pie/actions/runs/42910274588) | numeric-safety and concurrency fixes | success | all steps |
| [23](https://github.com/derekwtgm/pie/actions/runs/42914713866) | + statistics, budgets, parallel gains, scheduling | success | all steps |
| [24](https://github.com/derekwtgm/pie/actions/runs/42915512449) | + new `test_windows.ps1` 4.1 checks | **failure** | the new concurrent-start check used `mw/train` on a *restored desktop study*, which the host refuses by design (409; such studies train through `mw/desktop-train`). Test error, not an engine error; fixed in the next commit. The malformed-number checks in the same run passed on Windows: `400,400,400,400,400,409,400,400,400` (the 409 was the same restored-study rule) and the host kept running. |
| [25](https://github.com/derekwtgm/pie/actions/runs/42919860152) | + docs, corrected Windows test | success | **but** the concurrency-stress step parsed no totals (the default Node reporter prints no `# pass` lines on a non-terminal) and therefore checked nothing; it is not counted as evidence. |
| [26](https://github.com/derekwtgm/pie/actions/runs/42923670858) | stress step with TAP totals, requires all 9 tests to run and pass | success | all steps; **concurrency stress: 5 consecutive repetitions, each 9 passed, 0 failed, 0 skipped, exit 0** (v34 startup-failure ×3, v40 desktop jobs ×2, v41 concurrency ×4), no reruns |

Measured on run 25 (`validate_hardware.ps1`, CPU paths; CUDA reported
"NVIDIA driver library not found", so no GPU check ran):

- exact root EV of the eight-player ICM fixture: 1.80 s (1 thread), 1.18 s (2), 1.19 s (4);
  complete exact EV with device cpu/gpu/hybrid/auto 1.11-1.13 s, identical EVs, 0 GPU boards;
- exact response gains, 8 seats: 14.20 s (1 thread), 7.80 s (2), 6.96 s (4), identical gains;
- `test_windows.ps1` 4.1 checks passed: malformed numbers refused, 10 rounds of 8 concurrent
  `desktop-train` starts (exactly one 200 per round), queued-job deadline, board budget,
  thread-identical gains, simultaneous statistics.

Measured on run 26 (CPU paths): exact root EV 1.44 s / 0.92 s / 0.89 s with 1 / 2 / 4
threads; complete exact EV cpu/gpu/hybrid/auto 0.88-0.92 s, identical; exact response
gains, 8 seats: 11.43 s / 6.04 s / 5.61 s with 1 / 2 / 4 threads, identical; external
sampling 16,314 deals/s (1 thread), 29,208 (4).

Regression suite on run 26 (fresh Windows host, `tools/run_tests.js`): **362 passed,
0 failed, 11 skipped, 0 timed out** (373 tests; the 11 self-skip on Windows because
they need Linux, a host compiler or the Linux CUDA driver test double; names are listed
in that run's `validation/regression-tests.json` artifact). Package built on the runner:
805 SHA-256 entries verified, ZIP CRC passed.
