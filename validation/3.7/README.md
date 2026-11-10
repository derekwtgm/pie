# Release validation

Run from the extracted EightMax directory. The repository includes the Windows binaries, JavaScript fallback, all sources, and all earlier versioned reports. Use the current version directory for 3.7 measurements.

```sh
node source/tools/build.js
sh source/native/build.sh linux
sh source/native/build.sh windows
node source/tools/verify_build.js .
EM_TEST_HOST="$PWD/source/build/linux/eightmax" EM_TEST_MWCLI="$PWD/source/build/linux/mwcli" node source/tools/run_tests.js regression-local.json
```

Use disk-backed scratch storage with at least 16 GiB free when running multi-gigabyte tests. A RAM-backed temporary directory can legitimately fail disk preflight. Do not run the two multi-gigabyte memory stress tests concurrently on a 16 GB machine.

```sh
mkdir -p test-work
export TMPDIR="$PWD/test-work"
python3 validation/3.7/native-continuation.py source/build/linux/eightmax source/build/linux/mwcli continued.json
python3 validation/3.7/restore-sizes.py source/build/linux/eightmax synthetic.json 128 256 512 1024 2050
python3 validation/3.7/large-generation.py source/build/linux/eightmax generation.json 2050 "$TMPDIR"
ASAN_OPTIONS=detect_leaks=0:halt_on_error=1 UBSAN_OPTIONS=halt_on_error=1 sh validation/3.7/sanitizers.sh
```

On Windows, double-click Run self-tests.bat and Validate CUDA hardware.bat. The former writes Windows-self-test.json and the latter writes hardware-validation.json. Physical results depend on the machine that runs them.

## Repeating the solver comparisons

Use Linux, Node 24, Python 3.11 or newer, and a GCC C++20 compiler. The comparison runner builds each version of the native engine, CLI and deadline harness with the same optimization and floating-point flags. Pass paths to the extracted original EightMax directories.

```sh
python3 validation/3.7/compare.py accuracy results --v36 /path/to/3.6/EightMax
python3 validation/3.7/compare.py scenarios results --v36 /path/to/3.6/EightMax
python3 validation/3.7/compare.py profile results --v36 /path/to/3.6/EightMax --v35 /path/to/3.5/EightMax
python3 validation/3.7/compare.py selector results --v36 /path/to/3.6/EightMax
python3 validation/3.7/compare.py continuation results --v36 /path/to/3.6/EightMax
python3 validation/3.7/compare.py faults results --v36 /path/to/3.6/EightMax
python3 validation/3.7/compare.py trained results --table-mib 5300
python3 validation/3.7/compare.py reference results
python3 validation/3.7/compare.py algorithms results
python3 validation/3.7/compare.py devices results
node validation/3.7/desktop-controls.js source/build/linux/eightmax controls-local.json
```

## Implementation and evidence

| Implementation | Evidence in this directory |
|---|---|
| Desktop upload, atomic slot handling, free-disk forecast and policy in source/native/checkpoint_io.h, checkpoint_store.h and checkpoint_archive.h | large-generation.json, restore-faults.json, concurrent-pressure.json, regression-tests.json |
| Native reconstruction, topology replay and sparse table validation in source/native/checkpoint_native.hpp, mw.cpp and mwcli.cpp | trained-recovery.json, native-continuation.json, native-restore-sizes.json, serialization.json |
| Lossless EMCP36 export from a live host in source/native/checkpoint_export.h and state_file.hpp | native-continuation.json, serialization.json and 3.7 regression tests |
| Native hand policy and normal desktop controls in source/native/server.c, mw.cpp and source/web/lib_river_ui.js | desktop-controls.json, native-host.json, native-mw.json, package_smoke.log, checkpoint_ui_smoke.log |
| External-sampling control variate, discounts, betting and terminal work in source/native/mw_es_impl.hpp, mw_es.hpp and source/web/lib_wide.js | accuracy.json, scenarios.json, algorithm-comparison.json, profile-linked.json, reference-engines.json |
| Selector and pilot reuse in source/web/lib_select.js and worker.js | selector.json and source/tests/v37.test.js |
| Measured scoring route reuse in source/native/score_schedule.hpp | device-fallback.json, cuda-host.json, build.json and GPU driver-double regressions |
| Tournament blinds, antes, blockers, one or more all-ins, pot splits, payouts and ICM | Existing source/tests/mtt.test.js, fgs.test.js, oracle.test.js, v26.test.js and v31.test.js plus scenario and parity reports |

Regressions and host/CLI runs were executed on Linux. The npm-free smoke tests run the shipped interface code in a DOM/worker harness. The visual Windows browser workflow and actual NVIDIA execution require a target-machine run. Earlier versioned validation directories contain historical measurements.

For an optional graphical browser test on a compatible machine with Playwright Chromium installed, run `node validation/3.7/browser-desktop.js path/to/EightMax.exe browser-result.json`. The included DOM test verifies the same controls and records native HTTP requests. The separate graphical test requires a working renderer.

The GCC address/undefined behavior build instruments the multiway engine, desktop checkpoint code and JSON parser. The legacy heads-up C kernel and bundled QuickJS interpreter use ordinary objects in this run. LeakSanitizer was disabled because tracing is unavailable here. The focused TSan run used the four-worker linked fixture and the same GCC C++20 module with `-O1 -fsanitize=thread -fno-omit-frame-pointer -ffp-contract=off -no-pie`. Syntax and GCC analyzer scope are recorded in syntax.json. Release compilers issued a linkage warning for the internal replay cache type and a Linux attribute warning for the stdio deleter. No diagnostic from these checks establishes correctness outside the exercised inputs.

## Mathematical evaluation scope

- Full traversal CFR, full CFR+, uniform and linear averaging, external MCCFR, optional terminal conditioning and external DCFR were evaluated on the same tractable river game. See algorithm-comparison.json for all nine seeds, exact two-seat gains, fixed-work and fixed-time results.
- External sampling enumerates the updating seat’s legal actions, samples opponent actions and divides changes by the actual sampling probabilities. Under the optional fold baseline, a known fold value contributes once to the expectation, and only the sampled unresolved continuation receives the residual importance weight. It uses the same random draw and the same frozen strategy for that committed update. Cross-language agreement, exact finite best responses, rollback after a memory limit, and equality after checkpoint continuation exercise separate failure modes.
- The larger-game probe trains a restricted deviation for one seat and evaluates it against held-out deals. Its estimate can be negative. The exact best-response solver handles the smaller finite games. Samples per second and state visits per second are stored separately from gains.
- The direct native loader validates betting predecessors against the already reconstructed live topology. The storage-only semantic verifier keeps a bounded disk-backed index. This removes repeated file seeks on live restore while retaining the same rule replay and duplicate/CRC checks.
- A graphical Chromium run was attempted here. The renderer could not create its process-singleton socket under this environment's permissions. Shipped HTML/worker and desktop-control integration passed under the recorded DOM harnesses.
