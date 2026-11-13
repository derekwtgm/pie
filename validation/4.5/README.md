# EightMax 4.5 validation evidence

Each file is labelled with what actually ran. Labels:

* **Linux native** – the engine built for Linux on the build machine (Ubuntu 24.04,
  4 logical CPUs, 15 GiB RAM, GCC 13.3, MinGW-w64 GCC 13, Node 22, Python 3.13)
* **Wine** – the Windows `.exe` files run through Wine 9.0 on that machine (not Windows)
* **test double** – the Linux CUDA driver test double (simulated driver, no GPU)
* **Windows runner** – a GitHub-hosted `windows-latest` virtual machine (real
  Windows and Windows PowerShell 5.1; **no NVIDIA GPU**; not the target PC)

**Nothing in this folder comes from the RTX 4060 Ti PC or from any physical
NVIDIA GPU.** Run `Run self-tests.bat` and `Validate CUDA hardware.bat` on that PC
to produce `Windows-self-test.json`, `hardware-validation.json` and
`device-results.json`.

Read `../../RELEASE-4.5.md` for the conclusions; this file is the index.

| File | Label | Content |
|---|---|---|
| `regression-tests.json` | Linux native | complete suite from a clean build: per file passed / failed / skipped / timed out |
| `coverage45.json` | Linux native | `tests/coverage45.cpp`: the audited 1 MiB / 32,768-key scenario against the archived 4.4 table (1,425,408 bytes) and the 4.5 ledger; 1-32 MiB, 1-16 workers, collisions, cancellation, exhaustion, failed allocation, readers during resizing, repeated jobs |
| `sanitize45.txt` | Linux native | `tools/sanitize45.sh`: UBSan+ASan and ThreadSanitizer runs |
| `bench/bench45-memory-training.json`, `.txt` | Linux native | interleaved 4.4 / 4.5: coverage memory per budget (engine ledger, peak RSS), budget exhaustion, ICM training throughput, state hashes |
| `bench/bench-4.4-vs-4.5.json`, `.txt` | Linux native | `tools/bench44.js` with the unmodified 4.4 and 4.5: 17 evaluation and 3 training workloads |
| `bench/icm-kernel.jsonl` | Linux native | `tools/icm_bench45.cpp`: ICM kernel, 2-8 players, 4.4 routine against 4.5, bit identity |
| `deadline/deadline-4.4-vs-4.5.json`, `.txt` | Linux native | sampled-EV deadline overruns, 100 / 250 / 600 / 1000 ms x 1, 2, 4, 8 threads, 8 repetitions, both builds interleaved |
| `deadline/deadline-1MiB-coverage.json`, `.txt` | Linux native | the same with a 1 MiB coverage budget (growth and key limit inside the time limit) |
| `convergence/convergence45.json`, `-summary.txt`, `.log` | Linux native | ten-seed study of the candidate trainer options, six games, exact best responses, 288 Holm-adjusted comparisons |
| `stability/stability45.json`, `.txt` | Linux native | `tools/stability45.js`: NashConv and root-strategy spread across seeds for board textures, stack depths, betting abstractions, multiway flop/turn and ICM scenarios at two budgets |
| `wine/wine-windows-cli.json`, `.txt` | Wine | `tools/wine45.js`: the 4.4 checks plus IEEE sweep digest, coverage ledger, golden training hash, continuation, `coverage45` and `icm45` built for Windows |
| `ieee-sweep.json` | Linux native | `mwcli --ieee-sweep 200000 45` |
| `windows-runner/README.md` | Windows runner | which workflow runs failed and passed, and what they do and do not show (the runner's report files stay attached to the runs on GitHub) |
| `native-continuation.json`, `native-restore-sizes.json`, `checkpoint-sizes.json` | Linux native | 3.7 restoration / continuation utilities re-run on 4.5 |
| `native-host-linux.json`, `native-mw-linux.json`, `explorer-host-linux.json` | Linux native | desktop host checks |
| `package_smoke.log`, `mtt_ui_smoke.log`, `checkpoint_ui_smoke.log` | Linux native (packaged interface code in a Node `vm` context; no browser) | packaged interface checks |
| `fixtures/icm-final8.spec.json` | — | eight-seat linked preflop-to-river ICM specification used by the Windows self-test (golden state hash) |
| `NUMERIC-POLICY.md` | — | which comparisons are bit-exact and which use a stated tolerance (unchanged from 4.4) |
| `windows-release.ps1` | — | package verification + self-test wrapper used by `Run self-tests.bat` |

## Reproduce

```
node source/tools/build.js && sh source/native/build.sh linux
node source/tools/run_tests.js validation/4.5/regression-tests.json
sh source/tools/sanitize45.sh source
node source/tools/bench45.js out.json 5 4.4=<4.4 mwcli> 4.5=source/build/linux/mwcli
node source/tools/convergence44.js source/build/linux/mwcli out.json --seeds=10 --only-extra --extra='{"latin":{"chanceSampling":"latin"},"explore-0":{"opponentExploration":0},"explore-0.05":{"opponentExploration":0.05},"latin+baseline":{"chanceSampling":"latin","terminalBaseline":true}}'
node source/tools/stability45.js source/build/linux/mwcli out.json
WINE=<wine> node source/tools/wine45.js mwcli.exe source/build/linux/mwcli <build id> out.json
```
