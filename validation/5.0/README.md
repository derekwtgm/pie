# EightMax 5.0 validation evidence

| Path | Contents |
|---|---|
| `scheduling/v50-on-4.9.tap` | `tests/v50.test.js` run against the 4.9 mwcli. Test 1 fails: the driver is loaded, with cuInit 1 (regression test proven) |
| `scheduling/devices50.json` | 4.9 vs 5.0 device benchmark (`tools/devices50.js`, 9 interleaved rounds, no driver and the simulated driver, turn 2,400 and ES 2,560 workloads) |
| `six-player/stageA-reproduction.json` | Seeds 401-403, flop6 default: reproduces the 4.9 convergence figures |
| `six-player/stageB-confirmation.json`, `.log`, `stageB-per-seed.log` | Fresh seeds 501-510, default vs parallel64, six games, exact best response for each seat, Holm over 64 comparisons, raw per-seed and per-seat data |
| `six-player/stageB-first-run-clamped-equal-time.json` | The same study with the 4.9 equal-time method, which clamped the faster arm (kept for transparency; NashConv values are identical) |
| `bench/brbench-*-49-vs-50.json` | Response-evaluation benchmark, 4.9 vs 5.0 (weighted six-player flop, exact suite, flop6 recheck) |
| `fixtures/` | 4.9-written 150-update state (raw + EMZ1) and its spec, used by v50 test 7 |
| `sanitizers/` | `tools/sanitize50.sh` log, the v49+v50 TAP under ASan+UBSan, and sched50 stderr under ASan+UBSan and TSan |
| `build-linux.log`, `build-windows.log` | Final clean build (build 9ee5a8be32f5146e) |
| `regression-linux.json`, `.log` | Full Linux regression from a clean checkout of the final commit |
| `windows-ci/` | Windows CI job logs and totals for the final commit (GitHub Actions `windows-latest`) |
| `package-smoke.json` | ZIP extracted into a fresh folder: `sha256sum -c`, build IDs and executable smoke tests (written after packaging, so it is in the repository and next to the ZIP, not inside it) |

Machine: Intel Xeon @ 2.10 GHz, 4 logical CPUs, Linux, GCC 13.3, Clang 18.1, Wine 9.0, Node 22. No NVIDIA GPU.
The "test double" is a simulated CUDA driver (`source/tests/cuda_driver_fixture.cpp`), not a GPU.
