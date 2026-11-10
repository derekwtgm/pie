# EightMax Windows 3.2

Extract the complete ZIP and start EightMax.exe. CPU Only is the default. To collect results from a Windows machine, run **Run self-tests.bat**, then **Validate CUDA hardware.bat**. The latter writes hardware-validation.json next to the executables. EightMax-Offline.html provides the browser-only entry point.

## Checkpoint repair

On the six-player weighted flop, with four deals per update, per-deal streams, two threads requested and 2 MiB for tables, 3.1 stopped at 149 updates with 600 deals and 16,385 states. The uninterrupted reference had 596 deals and 16,380 states. Version 3.2 rejects that inconsistent legacy checkpoint. It successfully continues a valid 3.1 checkpoint from update 149 to update 154 with the original payload, counters and random state.

The stricter allocator in 3.2 stops this fixture at 136 updates. It reports 548 attempted deals, 544 committed deals, 8,172 strategy rows and 15,522 betting states. Five more updates with additional memory give 564 deals, 8,421 rows and 15,763 states. The uninterrupted and resumed checkpoint files have identical SHA-256 digests, including both random streams, counters, betting states, regrets and averages. The same comparison passed at 1, 2, 4, 8 and 16 MiB on both the six-seat flop and eight-seat linked fixture. Actual workers depend on batch shape and budget.

The native trainer journals changes to existing single-deal rows and rolls back new states, new rows, incomplete deltas and RNG movement on failure. Frozen batches stage their results and validate increments before applying them. Hash indices can be rebuilt without further allocation. Both strategies avoid copying the full table on each update. Native checkpoint imports stage tables before replacing live state. The study file can carry the full native state through the worker. The command-line checkpoint writer uses a temporary file and replacement. See es_transaction.hpp, mw_es_impl.hpp, mw.cpp, state_file.hpp, lib_wide.js, worker.js and validation/3.2/recovery.json.

## Memory and diagnostics

One capacity budget covers native persistent tables and indices. A second, equally sized budget covers tracked sampled workspaces across the batch, including reallocation overlap. The host considers physical memory, process usage and reported browser usage before admitting the requested table size. Fixed worker reservations can reduce parallelism. The diagnostics distinguish committed deals, session attempts, table usage, scratch peaks, state visits and memory stops. The table setting is only one component of total RAM. Browser allocations, operating-system stacks, allocator overhead and checkpoint copies outside the engine have separate lifetimes. The combined process memory is estimated and monitored. There is no hard process-wide allocation guarantee.

Across the 180 large-game runs, the highest trainer process RSS was 269.3 MiB for JavaScript, 321.4 MiB for single-thread native and 526.3 MiB for batched native. Nine further host sessions ran a second JavaScript solver while exercising six- and eight-seat flops and eight-seat linked preflop. Each native session had a 16 MiB table cap, exported a recoverable checkpoint and freed the tables. Peak sampled host RSS was 30.8 MiB and the JS process high-water mark reached 530.4 MiB. These are bounded Linux stress tests. Multi-hour soak testing and simultaneous physical browser/Windows RAM measurements remain open. See session-stress.json and native-mw.json.

## Strategy and mathematical coverage

Automatic traversal now explores the betting tree up to a budget cap and estimates sampled visits from the probabilities of reaching each branch under a uniform opponent policy. It considers seat count, action branching, street, range cardinality and finite-game gain measurements. Explicit Full Traversal and External Sampling remain available. Direct machine calibration, time-to-target prediction and tuning for every convergence method remain open.

Native external sampling supports Compact and Detailed groups on a fixed river and turn-to-river when the group lookup fits 32,768 entries. Physical cards determine deal probabilities, blockers, runouts and showdown values. Only policy lookup is grouped. At the starting street, a seat with up to 12 physical hands retains a hand-specific key. Larger ranges use the original strength group or detailed hand features. Later keys retain the previous street's group. The JS feature implementation supplies canonical representatives for the native table. Larger grouped turns, grouped flops, grouped preflop and grouped full traversal retain JavaScript execution.

A separate opt-in stratified joint-range sampler supports bounded simultaneous frozen batches on a fixed river. Five seeds gave mean exact maximum unilateral gain of 0.2900 BB with stratification and 0.2072 BB with independent sampling at 8,192 deals on the measured fixture. Independent sampling remains the default. External-sampling DCFR remains unsupported. The tournament default remains 0.5/1 BB with individual 0.1 BB antes, an initial 2.3 BB at eight seats. Existing big-blind ante, side-pot, linked-game and ICM paths remain available.

## Accuracy and benchmark interpretation

Mean largest exact unilateral gain in BB after a 400 ms training target on the Linux test host is shown below. Lower values mean the best unilateral deviation earned less. Intervals are two-sided 95% Student intervals over three seeds.

| Game and method | 3.1 | 3.2 |
|---|---:|---:|
| Three-seat river, full | 0.108 ± 0.085 | 0.087 ± 0.013 |
| Three-seat river, external, shared | 0.159 ± 0.086 | 0.150 ± 0.007 |
| Heads-up turn, full | 0.448 ± 0.157 | 0.404 ± 0.081 |
| Heads-up turn, external, shared | 0.599 ± 0.021 | 0.657 ± 0.097 |

On the Compact river comparison, 3.1 JavaScript averaged 100,429 deals per 400 ms training target and 3.2 native averaged 270,080. The paired 95% interval for the reduction in exact gain ranged from −0.084 to +0.096 BB. The measured increase in training throughput did not establish an improvement in accuracy per second. Raw records for equal-deal and timed runs are in accuracy-comparison.json, grouped-accuracy.json and grouped32.json. ACCURACY.txt includes the independent push/fold oracle and known river solution.

The six-scenario benchmark completed all 180 unique runs with five seeds, three execution modes and two training deadlines. Each record includes the configuration, actual elapsed training time, memory, visits and a paired holdout estimate for one sampled unilateral deviation. Its interval covers evaluation sampling conditional on the fitted policies. Other deviations can perform better. Multiplayer Nash exploitability remains unknown. Root strategy dispersion describes across-seed stability. Four jobs ran concurrently on a shared AMD EPYC Linux host. Individual runs used about 84–104% of the requested duration, including early stops. Compare actual elapsed times when interpreting a result. large-games.json and its companion Markdown table contain the results. The historical 3.1 benchmark remains incomplete.

## Validation and open hardware work

All 214 regression tests passed with zero skips or timeouts. The original 201 tests are included. Twelve targeted cases passed under AddressSanitizer and UndefinedBehaviorSanitizer with leak detection disabled. A four-worker native run completed under ThreadSanitizer. The fault injector forced each tracked aligned allocation in three warmed updates to fail in sequence. All 447 stops and subsequent resumes matched the reference bytes. Tests cover shared and per-deal RNG, batches of 1, 4 and 16, worker changes, weighted ranges, ICM, CFR+, linear averaging, grouped parity and corrupt files. These checks are specific to the tested configurations.

Both unsigned Windows x64 executables were cross-compiled. Their build identifiers match the source and offline interface. The native Linux HTTP server passed malformed-input, numerical parity, checkpoint and cancellation checks. All three packaged interface tests passed using a DOM fixture and a real worker thread. The separate Chromium integration check was blocked by a denied socket during browser startup. Wine did not initialize successfully. Desktop operation on physical Windows and physical CUDA execution remain unverified for 3.2.

CUDA scoring and exact-equity components were rebuilt as PTX and sm_75/80/86/89 binaries. Driver test doubles cover dispatch and fallback. CPU Only, Automatic, GPU Preferred and Hybrid modes remain available. External-sampling traversal runs on the CPU. The exact-equity kernel remains available through the CLI/API. Physical GPU memory pressure, reusable buffers after cancellation, hybrid time-to-accuracy and end-to-end acceleration on the 8 GB RTX 4060 Ti still require hardware measurements. A physical-device result is intentionally absent from this package.

## Reproduction

From the extracted EightMax directory, use Node, Python 3, a POSIX shell and a C++20 compiler. For Windows cross builds install x64 MinGW-w64 with winpthreads. On Windows an MSYS2 MinGW-w64 shell can select CC=gcc and CXX=g++. Keep the packaged source tree and .github/workflows directory together for fingerprint generation.

```sh
node source/tools/build.js build
sh source/native/build.sh windows build/native.html "$PWD"
cp build/EightMax-Offline.html .
cp build/build-info.json BUILD-INFO.json
node source/tools/verify_build.js .
node source/tools/run_tests.js regression.json
node source/tools/package_smoke.js .
node source/tools/checkpoint_ui_smoke.js .
sh source/native/build.sh linux build/native.html build/linux
python3 source/tools/recovery32.py build/linux/mwcli recovery.json
node validation/3.2/session-stress.js build/linux/eightmax session-stress.json
gcc -O2 -c source/native/json.c -o json.o
g++ -std=c++20 -O2 -ffp-contract=off -c source/native/mw.cpp -o mw.o
g++ -std=c++20 -O2 -Isource/native source/tools/timed_training.cpp mw.o json.o -pthread -ldl -o timed
node source/tools/large32.js ./timed large-games.json
```

Rerun the same large benchmark command with the same output, binary and concurrency to continue an interrupted run. Supply a 3.1 CLI as the third argument to recovery32.py to repeat the legacy comparison. source/tools/bench32.js accepts the two release CLIs, the two timed drivers, an output path and --quick for the reported finite-game suite. CUDA rebuilding instructions are in source/native/gen_ptx.py. Verify extracted file hashes with sha256sum -c SHA256SUMS.txt.
