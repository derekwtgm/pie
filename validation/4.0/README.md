# EightMax 4.0 validation evidence

Final build: see `BUILD-INFO.json` (Linux and Windows executables built from the same source; the Windows executables were built twice and compared byte for byte by `tools/release.sh`).

| File | What it shows | Where it ran |
|---|---|---|
| `regression-tests.json` | full suite: 358 passed, 0 failed, 0 skipped, 0 timed out (341 earlier + 17 in `tests/v40.test.js`) | Linux |
| `windows-runner.md` | GitHub Actions `windows-latest` run: host built on Windows, `test_windows.ps1` (incl. 4.0 deadline, exact-EV and job checks), full suite 349 passed / 0 failed / 9 skipped (Linux-only CUDA test double and Linux-only checks), `validate_hardware.ps1` CPU paths | Windows Server VM (no GPU) |
| `wine-checks.json` | final `mwcli.exe`: 100 ms deadline (101.6-102.2 ms, HTTP 408) and exact EVs bit-identical to the Linux reference | Wine 9.0 |
| `sanitizers.log` | `tools/sanitize40.sh`: TSan and ASan+UBSan (concurrency stress, CPU/GPU/hybrid tables), v39 (14/14) + v40 (14/14; the 3 desktop-host job tests run against the normal host) suites against an ASan+UBSan `mwcli`, cppcheck | Linux |
| `bench40.json/.log` | 3.9 vs 4.0, ten scenarios x three seeds (`tools/bench40.js`) | Linux, 4 logical CPUs |
| `threads40.json` | evaluation thread scaling, CPU use, RSS, cancellation latency, bit-identity (`tools/threads40.js`) | Linux |
| `convergence40.json/.log` | Priority 7: existing training variants vs the default, exact NashConv, five seeds (`tools/convergence40.js`) | Linux |
| `native-restore-sizes.json`, `native-continuation.json`, `checkpoint-sizes.json`, `explorer-host-linux.json`, `native-host-linux.json`, `native-mw-linux.json`, `*_smoke.log` | 3.7-3.9 utilities re-run on the 4.0 host by `tools/release.sh` | Linux |
| `release-run.log` | the complete `tools/release.sh` output | Linux |
| `fixtures/push8-icm.*` | the reproduced 3.9 deadline scenario with reference EVs, used by the Windows scripts | - |
| `windows-release.ps1` | started by `Run self-tests.bat` | your PC |

Not available: physical Windows desktop, NVIDIA GPU. CUDA kernels were compiled with NVRTC 12.9/ptxas (PTX + SASS sm_75/80/86/89) and executed only through the CUDA driver test double. Run `Validate CUDA hardware.bat` on the RTX 4060 Ti PC and keep `hardware-validation.json` (field `v40.gpuEvExecutionVerified`).

Reproduce on Linux: `sh validation/4.0/reproduce.sh <mwcli built from the 3.9 source>`.
