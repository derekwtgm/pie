# EightMax 5.1 validation evidence

All timings are from one machine: Intel Xeon @ 2.10 GHz, 4 logical CPUs, Linux. Toolchain: GCC 13.3, Clang 18.1, Wine 9.0, Node 22.23, release build **7d08acc7eb4577ee**. There is **no NVIDIA GPU** on it. The "test double" is a simulated CUDA driver (`source/tests/cuda_driver_fixture.cpp`), not a GPU. Windows CI is GitHub Actions `windows-latest`, also without a GPU.

| Path | Contents |
|---|---|
| `six-player/preregistration.json` | Frozen candidate, metric, budgets, seeds, promotion rule. Committed as b2db957 before any confirmation result |
| `six-player/development-round1-update-weighted.json`, `.log` | Development seeds 601–610 with update-count weighting. All warm candidates were worse, which led to deal weighting |
| `six-player/development-round2.json`, `.log` | Development seeds 601–610, deal-weighted. The candidate was chosen here |
| `six-player/confirmation.json`, `.log` | Fresh seeds 701–740: default, parallel64 and warm-4-256 on flop6, flop6w, river3 and turn4. Raw per-seed and per-seat data, deals, committed updates, training and evaluation time, peak RSS |
| `six-player/decision.json` | `tools/decide51.js` applies the frozen rule. Outcome: keep the 5.0 default. Includes warm vs parallel64 and resources |
| `six-player/diagnosis.json` | `tools/diagnose51.js`: µs per deal, committed updates, threads used, phase seconds, and state identity on 1 vs 4 threads |
| `scheduling/devices51.json`, `.log` | 5.0 vs 5.1 device benchmark (`tools/devices51.js`, 9 interleaved rounds), turn 2,400 and ES 2,560 workloads, four modes, with no driver, with the test double, and with GPU-profitable and crossover costs. The last two use 5.1-only cost switches, so only the 5.1 rows are meaningful there |
| `scheduling/routesweep51.js`, `.txt` | Simulated CPU cost sweep on the original fixture: calibrations and measured ratios. 0 violations of the reuse invariant in 14 runs |
| `deadline/` | v40 deadline repeats (`tools/deadline51.js`): 20+20 trials, then 100+100 trials with the stall detector (`tests/stall51.c`), both idle and with 8 busy processes. Also 3,000 isolated runs of the failing query, and unlimited completion times of the exact workloads |
| `bench/brbench-flop6w-50-vs-51.json` | Weighted six-player exact response evaluation, 5.0 vs 5.1: identical bits, ×1.022 [0.994, 1.051], 28.5 vs 28.9 MiB |
| `fixtures/` | States written by the release 5.0 Linux binary (raw + EMZ1) and their specs, used by `tests/v51.test.js` |
| `sanitizers/` | `tools/sanitize51.sh` log (includes the whole 5.0 pass), v51 TAP under ASan+UBSan, and stderr of the route-reuse and schedule harnesses under ASan+UBSan and TSan |
| `build-linux.log`, `build-windows.log` | Final build. Windows was built twice, and the two builds are byte-identical |
| `regression-linux.json`, `.log` | Full Linux regression from a clean clone at 0cbe773 (same build as the release): **510 passed, 0 failed, 1 skipped** (read-only folder test: running as root) |
| `regression-linux-f94a1d7-missing-release-notes.log` | The earlier clean-clone run: 1 failure, because the workflow copied RELEASE-5.1.md before it existed. Fixed by adding the file |
| `v40-v51-final-commit.tap` | After the regression, only `tests/v40.test.js` and `tests/v51.test.js` changed. Both were rerun from a clean clone of the final source commit 7609665: 30 passed, 0 failed |
| `wine/` | `mwcli.exe --selftest47/48/49` under Wine with LANG=C.UTF-8 (10, 9 and 15 checks passed). The run without a locale is kept: its Unicode-folder check fails in 5.0 and 5.1 alike, because Wine cannot create the folder on the Linux side. Also the device turn through the Windows exe with the test-double DLL: 1 calibration and 99 reuses in GPU Preferred and Hybrid, identical bodies |
| `windows-ci/` | Windows CI totals and skip list for the final commit |
| `package-smoke.json` | ZIP extracted into a fresh folder: `sha256sum -c`, build IDs, smoke tests |
