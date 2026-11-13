# EightMax 3.9 validation

Environment: Ubuntu 24.04, 4 logical CPUs (Intel Xeon @ 2.10 GHz), Node 22,
GCC 13, MinGW-w64 GCC 13 (posix), Wine 9.0. No physical Windows machine and no
NVIDIA GPU were available. Reproduce with `sh validation/3.9/reproduce.sh
<mwcli built from the 3.8 source>`.

| File | Content |
|---|---|
| baseline-3.8-regression-tests.json | uploaded 3.8 source, suite re-run here: 327 passed |
| regression-tests.json | 3.9 release gate (tools/release.sh): 341 passed, 0 failed/skipped/timed out |
| sanitizers-asan-ubsan.log | v38 + v39 native suites with an ASan+UBSan mwcli: 22 passed, no reports |
| explorer-host-linux.json / explorer-host-wine.json | HTTP explorer, malformed-request 400s, action EVs, cache, response gains; Linux host and Windows EightMax.exe under Wine (105 checks each) |
| wine-parity.js / wine-parity.json | Windows mwcli.exe under Wine vs Linux mwcli: 4 trained states byte-identical, 14 EV/gain/validation answers identical (18/18) |
| wine-v39-full-file-timeout.log | the whole v39 file against mwcli.exe under Wine TIMED OUT at 50 min (hundreds of Wine launches); not counted as passed |
| scenarios39.json | ten scenarios × 3 seeds, 3.8 vs 3.9: 30/30 states byte-identical; quality per seat |
| timing39.json | 5 longer cases × 7 interleaved pairs: training time unchanged within noise, 35/35 identical |
| convergence39.json | exact exploitability / per-seat gains at 4k–500k deals, 3 seeds, both versions |
| native-*.json, checkpoint-*.json, *_smoke.log | unchanged 3.7/3.8 recovery, continuation, host and packaging utilities re-run on 3.9 |
| windows-release.ps1 | used by Run self-tests.bat on Windows |

Classification: Linux-native execution (all tests); Windows cross-compilation
(both executables, repeat link byte-identical); Wine testing (host HTTP test,
Windows/Linux parity); simulated CUDA (the CUDA driver test double in v31/v35 tests);
physical Windows testing: none; physical NVIDIA GPU testing: none.
