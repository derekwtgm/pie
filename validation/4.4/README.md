# EightMax 4.4 validation evidence

Everything here was produced on the Linux build machine (Ubuntu 24.04, 4
logical CPUs, 15 GiB RAM, GCC 13.3, MinGW-w64 GCC 13, Node 22, Python 3.13,
Wine 9.0). **No file in this folder comes from Windows, from Windows
PowerShell or from an NVIDIA GPU.** Each file is labelled with what ran:

* **Linux native** – the engine built for Linux
* **Wine** – the Windows `.exe` files run through Wine 9.0 (not Windows)
* **test double** – the Linux CUDA driver test double (simulated driver)
* **model** – exact arithmetic reproducing a PowerShell 5.1 conversion (not a
  PowerShell run)

Read `../../RELEASE-4.4.md` for the conclusions; this file is the index.

| File | Label | Content |
|---|---|---|
| `NUMERIC-POLICY.md` | — | cause of the 4.3 last-digit failure, which comparisons are bit-exact and which use a stated tolerance, precision guarantee |
| `regression-tests.json` | Linux native | full suite from a clean build: per file passed / failed / skipped / timed out, hardware-dependent tests |
| `sanitize44.txt` | Linux native | `tools/sanitize44.sh`: UBSan+ASan and ThreadSanitizer runs, cppcheck |
| `deadline/deadline-4.3-vs-4.4.json`, `.txt` | Linux native | interleaved sampled-EV deadline benchmark, unmodified 4.3 against 4.4: limits 100 / 250 / 600 / 1000 / 3000 ms × 1, 2, 4, 8, 16, 24 threads × 8 repetitions; every run with `deadline.phasesMs`; overrun minimum / median / 90th percentile / maximum |
| `deadline/phases-4.3-path.json` | Linux native | the phase timings that located the regression (4.3 coverage merge path) |
| `deadline/repeated-timing-tests.txt` | Linux native | the timing-sensitive tests of `tests/v40.test.js` (including the one that failed in the 4.3 audit) and of `tests/v44.test.js`, 12 independent runs each on 4.4 |
| `deadline/repeated-timing-tests-4.3.txt` | Linux native | the audit's failing test, 12 runs on the unmodified 4.3 |
| `bench/bench-4.3-vs-4.4.json`, `.txt` | Linux native | interleaved 4.3 / 4.4 benchmark, 7 repetitions: exact EV, exact and sampled response gains, sampled EV, deadline and cancellation response, training (with state SHA-256) |
| `convergence/convergence44.json`, `-summary.txt`, `.log` | Linux native | ten-seed convergence study, six games, six variants, exact best responses, 360 Holm-adjusted comparisons |
| `convergence/candidates44.json` | Linux native | four further candidate schedules on two games |
| `wine/wine-windows-cli.json`, `.txt` | Wine | `mwcli.exe`: build id, IEEE probe round trip, exact EV / gain bit patterns, coverage counts, training bytes equal to Linux, sampled deadline, cancellation |
| `wine/native-host-wine.json`, `native-mw-wine.json`, `explorer-host-wine.json` | Wine | `EightMax.exe` desktop host: start-up, checkpoints, multiway routes, explorer |
| `session-auto-double.json` | test double | warm Automatic session (three arms measured, identical results); timings are those of a simulated device and mean nothing |
| `ps-number-model.json` | model | `tools/ps_number_model.py` on the self-test references and on the probe table |
| `ieee-probe.json`, `ieee-verify.json` | Linux native | `mwcli --ieee` and `mwcli --ieee-verify` |
| `native-continuation.json`, `native-restore-sizes.json`, `checkpoint-sizes.json` | Linux native | 3.7 restoration / continuation utilities re-run on 4.4 (134 MB eight-seat state: streamed restore, continuation, byte and RNG equivalence) |
| `native-host-linux.json`, `native-mw-linux.json`, `explorer-host-linux.json` | Linux native | desktop host checks |
| `package_smoke.log`, `mtt_ui_smoke.log`, `checkpoint_ui_smoke.log` | Linux native (the packaged interface code run in a Node `vm` context, as in earlier releases; no browser) | packaged interface checks |
| `windows-release.ps1` | — | package verification + self-test wrapper used by `Run self-tests.bat` (unchanged from 4.3; **not run here**) |

## Reproduce

```
cd source
node tools/build.js && sh native/build.sh linux && CC=x86_64-w64-mingw32-gcc-posix sh native/build.sh windows
EM_TEST_HOST=build/linux/eightmax EM_TEST_MWCLI=build/linux/mwcli node tools/run_tests.js report.json
sh tools/sanitize44.sh .
node tools/deadline44.js out.json <dir with spec.json + state> 8 100,250,600,1000,3000 1,2,4,8,16,24 v4.3=<4.3 mwcli> v4.4=build/linux/mwcli
node tools/bench44.js out.json 7 v4.3=<4.3 mwcli> v4.4=build/linux/mwcli
node tools/convergence44.js build/linux/mwcli out.json --seeds=10 [--games=hu-river,...]
node tools/wine44.js build/windows/mwcli.exe build/linux/mwcli <build id> out.json
python3 tools/ps_number_model.py [probe.json]
```

The 4.3 `mwcli` used as the baseline was rebuilt from the unmodified
`EightMax-Windows-4.3.zip` sources (build id `cb158d2375848dd8`; its Windows
executables rebuild byte-identically to the shipped ones).

## What is missing

* `Windows-self-test.json`, `hardware-validation.json`, `device-results.json`
  for 4.4: these are written on your PC by `Run self-tests.bat` and
  `Validate CUDA hardware.bat`. None exists yet.
* Any CUDA timing, VRAM figure or physical-driver result.
* A 4.2 baseline (sources not supplied).
