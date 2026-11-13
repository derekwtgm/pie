# GitHub Actions Windows runner evidence (4.0)

Run: https://github.com/derekwtgm/pie/actions/runs/42884730326 (`windows-latest`, Windows Server VM, no GPU), commit 3d8cdf9.
The native host was compiled on Windows with MSYS2 UCRT64 GCC from this source.

- `test_windows.ps1` on the fresh host: all checks passed, including
  - "Exact EV with a 100 ms limit stops with HTTP 408 and no result (slowest of 5: 101.4 ms)"
  - "Exact 8-player ICM action EVs equal the reference at path [1,1]" and "[1,1,1]"
  - "Explorer and status answer while a background evaluation runs (26 ms)"
  - "Cancelled background evaluation stops (76 ms)" (status polled every 20 ms)
  - malformed job rejected; job completes with classifications and coverage; released jobs free their results
- Regression suite (`run_tests.js`): passed 349, failed 0, skipped 9, timed out 0; `v40.test.js` 16 passed, 1 skipped (CUDA driver test double is Linux-only).
- `validate_hardware.ps1`: CUDA unavailable (no NVIDIA driver); action EV identical in cpu/gpu/hybrid/auto modes (all on the CPU); exact root EV 1.83 s (1 thread), 1.21 s (2), 1.14 s (4).
- PowerShell parse check of every script: passed. Release package verified (SHA-256 manifest, ZIP CRC).

Later commits (visit accounting, documentation) are re-checked by the run on the final commit; see the branch's Actions history.

## Final commit

Runs 19 and 20 (final release commit 517fe6c and 60e3a59, identical source) each had one failure on the first
attempt: the 3.4 test "solve startup failure rolls back and supports concurrent retry/cancel" (legacy
postflop solve path, not changed in 4.0; it compares two status snapshots around concurrent restarts).
Totals on those attempts: 348 passed, 1 failed, 9 skipped. The same test passed in run 18, 10 of 10 local
Linux repetitions, and on the re-run of run 20 (attempt 2:
https://github.com/derekwtgm/pie/actions/runs/42892283975), where every step succeeded. It is recorded as an
intermittent Windows-runner failure of a pre-existing test, not removed or skipped.
