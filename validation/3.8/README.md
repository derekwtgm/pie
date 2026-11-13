# 3.8 validation

Run these from the extracted EightMax directory on Linux with Node 22+, Python 3.11+, GCC 13 (C++20) and valgrind for profiling. Everything here was produced on Linux (4 logical CPUs, 15 GiB RAM).

The Windows executables were cross-compiled with MinGW-w64 GCC 13. They were exercised under Wine 9.0 (`*-wine.json`, `wine-parity.json`). **That is not a physical Windows test, and no NVIDIA GPU was used.**

## Build and regression suite

```sh
node source/tools/build.js
sh source/native/build.sh linux
sh source/native/build.sh windows
node source/tools/verify_build.js .
export EM_TEST_HOST=$PWD/source/build/linux/eightmax EM_TEST_MWCLI=$PWD/source/build/linux/mwcli
node source/tools/run_tests.js validation/3.8/regression-tests.json
```

## Files

| File | What it shows | How it was produced |
|---|---|---|
| regression-tests.json | 327 passed, 0 failed, 0 skipped, 0 timed out | `run_tests.js` (above) |
| native-timing.py | Interleaved A/B timing harness that also checks state equality | — |
| native-timing.json | 3.7 versus 3.8, 10 studies, 1 and 4 threads, 21 repetitions | `python3 validation/3.8/native-timing.py <specs> <mwcli-3.7> <mwcli-3.8> out.json 21 1 4` |
| native-timing-long.json | Same, 1,500 multiway and 100,000 two/three-seat updates, 7 repetitions | `EM_UPDATES_SHORT=1500 EM_UPDATES_LONG=100000 python3 … 7 4 1` |
| native-timing-1500.json | Intermediate long-run measurement before the final store threshold (superseded) | — |
| cache-tuning.json, st4/st16/st64.json | Measurements behind the cache and store sizes | `-DEM_EDGE_ENTRIES` / `-DEM_STATE_STORE_MIB` builds |
| scenarios.js, scenarios-accuracy.json | Equal-update and equal-time (2 s) quality, 3.7 versus 3.8, 3 seeds | `node validation/3.8/scenarios.js <cli37> <timed37> <cli38> <timed38> <peak_rss> out.json` (EM_SCENARIO selects a study) |
| explorer-reference.py, explorer-reference.json | Independent EMMW4 parser versus `mwcli --node`: 397 nodes, 0 mismatches | `python3 validation/3.8/explorer-reference.py <mwcli> <spec> <state> out.json 40 2` |
| explorer-host-linux.json, explorer-host-wine.json | HTTP explorer route, 92 checks each | `node source/tools/test_explorer_host.js <host> out.json` |
| large-restore.py, large-restore.json | Genuine trained states from 157 MiB to 1.55 GiB: estimate, restore time, RSS and resume equality | `python3 validation/3.8/large-restore.py <mwcli> <spec> <workdir> out.json` |
| sanitizers.sh, sanitizers.json | ASan+UBSan and TSan builds of the engine and CLI | See the note in the JSON |
| gpu-scope.json | Hand-scoring share of training time (upper bound on GPU scoring gains) | Engine profile from `mwcli` |
| wine-parity.json | `mwcli.exe` under Wine versus the Linux build: states, explorer and estimates identical | — |
| native-host-*.json, native-mw-*.json | Inherited host tests on Linux and under Wine | `test_native_host.js`, `test_native_mw.js` |
| *_smoke.log | Packaged UI, MTT and checkpoint UI smoke tests | `node source/tools/<name>.js .` |
| windows-release.ps1 | Target of Run self-tests.bat (manifest, build ids, test_windows.ps1) | — |

The benchmark specs are produced by `validation/3.7/scenarios.js` with `EM_SPEC_DIR=<dir>` and `EM_SCENARIO=<name>`.

**Byte-identity with 3.7.** Build the 3.7 tree's `mwcli` with the same flags. Then run every spec with each estimator setting at 1 and 4 threads and compare the output state files. 240 of 240 runs were identical. `native-timing.json` repeats the comparison for every timed run (`identicalStates`).

## Profiling method

Instruction counts come from valgrind callgrind on single-thread runs, for example:

```sh
valgrind --tool=callgrind mwcli <spec> 80 1 out.state 2048
```

Wall-clock comparisons use interleaved runs on an otherwise idle machine. Page-fault and cache effects show up only in the wall-clock numbers. That is why a store that cut instructions on short multiway runs was gated behind a revisit threshold.

## What was not validated here

- Physical Windows x64, the RTX 4060 Ti, CUDA kernels, VRAM limits and hybrid timing. Run `Validate CUDA hardware.bat` and `Run self-tests.bat` on the target PC.
- A fresh 3.6 versus 3.7 profile. The 3.6 source was not part of the uploaded package.
- Statistically significant equal-time accuracy gains, which need more seeds than the 3 used here.
- Grouped-hand (Compact or Detailed) explorer lookups against an independent parser. They use the same non-mutating key computation as training and are exercised through the host tests only.
