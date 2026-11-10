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
