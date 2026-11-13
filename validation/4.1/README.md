# EightMax 4.1 validation evidence

All files were produced by the tools named below on Linux (Ubuntu 24.04, 4
logical CPUs, Intel Xeon 2.1 GHz, GCC 13) unless stated otherwise. Nothing here
was produced on a physical Windows desktop or an NVIDIA GPU.

| File | Produced by | Contents |
|---|---|---|
| `numeric-ub-probe-4.0.json` | `tools/numeric_ub_probe41.js` against the **4.0** host built with UBSan (+float-cast-overflow) | 16 malformed-number requests; 10 caused undefined behaviour (host aborted) |
| `numeric-ub-probe-4.1.json` | same, 4.1 host | 16/16 refused with HTTP 400, 0 UBSan reports |
| `v34-intermittent-repro-4.0.log` | 4.0 v34 test under CPU load | the reproduced intermittent failure (`residentMiB` 6.63 vs 6.66) |
| `tsan-concurrency.log` | concurrency/job/startup tests against a ThreadSanitizer desktop host | 9 tests, 0 reports (log capture verified with a planted race) |
| `statistics41.json` | `tests/stats41.cpp` (2,000 replications) | family-wise error, simultaneous coverage, power, winner's curse, sequential stopping; 4.1 procedure vs the 4.0 rule |
| `convergence41.json`, `.log` | `tools/convergence41.js` | DCFR parameter sets vs the default, exact NashConv, 5 seeds, Holm-adjusted |
| `bench41.json`, `.log` | `tools/bench41.js` (4.0 `mwcli` vs 4.1 `mwcli`) | ten scenarios × three seeds: training identity, EV/gain times and identity, RSS, deadline, cancellation, work counters |
| `regression-tests.json`, `.txt` | `tools/run_tests.js` | full suite on Linux |
| `sanitizers.log` | `tools/sanitize41.sh` | UBSan+ASan host/CLI suites, TSan host and parallel gains |
| `windows-runner.md` | GitHub Actions `windows-latest` | Windows Server VM results (no GPU) |
| `windows-release.ps1` | — | release verification used by `Run self-tests.bat` |

Reproduce: `sh source/tools/release.sh` (builds, runs the suite and the 3.7/4.0
utilities), `sh source/tools/sanitize41.sh source`,
`node source/tools/convergence41.js <mwcli> out.json`,
`node source/tools/bench41.js <mwcli-4.0> <mwcli-4.1> <peak_rss> out.json`,
`g++ -std=c++20 -O2 -Isource/native source/tests/stats41.cpp -o stats41 && ./stats41`.
