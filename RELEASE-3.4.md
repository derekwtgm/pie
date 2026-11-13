# EightMax Windows 3.4

Extract the entire ZIP, open the EightMax folder and launch EightMax.exe. The desktop host opens the local study interface. Select CPU Only for a CPU solve. The independent browser edition is EightMax-Offline.html. The default eight-handed tournament posts 0.5/1 blinds plus 0.1 BB per dealt player, giving a 2.3 BB starting pot.

## Checkpoint storage

The desktop host validates the UTF-8 envelope, SHA-256, payload size, version, engine, required configuration and saved strategy before committing. Its memory-bounded JavaScript verifier runs the bundled restore logic. New files include a byte length. Compatible older files use their existing envelope. Desktop requests have a 64 MiB limit.

Three files hold checkpoint slots. The two-byte autosave.index selects the current and previous generation. A writer holds a process lock, flushes the unused slot, then replaces the index. Windows uses MoveFileEx with replacement and write-through. Recovery consults the index and tries the previous generation if the newest cannot be restored. Keep all the autosave files together when copying them. Manual export produces one portable .emstudy file. The offline browser edition uses IndexedDB.

The Linux HTTP tests submitted invalid checksums, invalid sizes, malformed state, unsupported versions, incomplete JSON, and oversized requests. Fault tests interrupted the process after the unused slot was flushed, denied a disk write, and failed index replacement. Both committed generations retained identical bytes. Five legacy native checkpoints resumed with matching strategy rows, counters and RNG state. Physical power-loss testing on NTFS remains outstanding.

## Background calculations

Solve, report and multiway training publish job status after successful thread creation. Their worker waits for initialization before reading its arguments. Failed startup releases the request allocations and reports HTTP 503. Concurrent admission still returns HTTP 409. Native tests injected startup failure in each route, retried, sent simultaneous requests and cancelled. The Linux integration tests also checked that the stopped multiway state could resume.

## Solver and devices

- Native full betting-tree traversal supports Compact and Detailed groups from preflop, flop, turn and river. Chance still samples physical hands and boards. Group keys affect policy lookup. Weighted ranges, blockers, chip EV and ICM use physical deals. Tests compared every saved strategy row with JavaScript, including continuation from an exported state.
- The grouped dictionary owns one copy of each key string. Detailed mode omits the parallel numeric key array. Grouped full traversal uses sparse strategy storage and stages imported sparse rows before replacement. Dynamic grouped full traversal uses the EMMWG native interchange format. Use a .emstudy export for portable browser training state.
- Automatic traversal now considers eligible grouped full trees. It uses range counts, tree cost, memory and measured response gains, with a narrow calibration for a short heads-up Detailed turn. Manual traversal and saved traversal are respected. Linear weighting remains the default. Automatic traversal does not optimize every discount parameter or select a proven best algorithm for every tournament.
- External-sampling batches with at least 128 hand evaluations on a non-river start can use the calibrated scoring scheduler. The implementation scores disjoint CPU and GPU portions of a frozen batch, compares calibration scores with the CPU, and uses CPU scoring on failure. Betting traversal and regret commits run on the CPU. Buffer peaks report allocated bytes, which differ from device-wide VRAM use and GPU occupancy.
- The bundled kernels were compiled with NVRTC and ptxas for compute_75 PTX and sm_75, sm_80, sm_86 and sm_89 machine code. Linux driver-test-double runs checked hybrid state parity and fallback. Actual performance on an RTX 4060 Ti 8 GB requires a local measurement.

## Evidence

All current records are in validation/3.4. Prior validation directories refer to the named earlier versions.

| Question | Evidence |
|---|---|
| Did the regression suite pass? | regression-tests.json and regression-tests.txt record 262 passes, 0 failures, 0 skips and 0 timeouts. |
| Can failed saves damage existing study files? | source/tests/v34.test.js exercises the HTTP endpoint, storage faults and crash recovery. desktop-recovery.json records a killed host and worker, fallback recovery, and resumed training. |
| What happens under memory pressure? | memory-continuation.json compares memory-limited runs with reference runs. session-stress.json records 12 concurrent browser/native study rounds. serialization-faults.txt records injected allocation failures and byte-identical retries. |
| Can existing studies resume? | version-continuation.json records 3.3-to-3.4 continuation for five native fixtures. The suite also exercises legacy .emstudy files. |
| How was strategy quality measured? | convergence.json, grouped.json, scenarios.json and time-to-target.json contain the configurations, timings and per-seed results. See ACCURACY-SUMMARY.md. |
| Which integration paths ran? | native-host.json and native-multiway.json cover Linux native CPU paths. The three successful smoke logs exercise the packaged JavaScript interface using simulated controls and workers. |
| Which checks were blocked? | native-ui.json and chromium-recovery.json record unavailable or blocked real-browser launches. Wine startup failed in this environment. Windows and physical NVIDIA execution remain unverified for this build. |

The full sanitizer script stopped at LeakSanitizer under ptrace after native thread-sanitized scenarios had run. Separate ASan/UBSan runs with leak detection disabled passed the 34 version-3.3 tests and 9 targeted grouped/hybrid tests. No full leak-analysis pass is claimed. The storage implementation has memory and time limits and can reject a valid large study when validation resources are exhausted. Process RAM limits are estimates and admission checks. A hard combined browser, host and GPU limit remains open.

## On your Windows PC

1. Extract the ZIP to a writable folder and double-click **Run self-tests.bat**. It writes Windows-self-test.json.
2. Run **Validate CUDA hardware.bat**. It writes hardware-validation.json with the detected device, CPU reference checks, actual GPU execution flag and the external batch mode comparisons. A CPU fallback is recorded in the route. Inspect failures and gpuExecutionVerified.
3. Run **Compare processing modes.bat** to write device-results.json for the supplied study. Compare runs with equivalent strategies. The Linux timing data does not predict the result on your 13th-generation Core i7.

## Rebuild and reproduce

Use Node 22 or later, Python 3, GCC/G++ with C++20, and a MinGW-w64 x64 POSIX-thread compiler for cross-building. The Linux host needs OpenSSL development headers and libcrypto. Windows uses the system BCrypt library. The included QuickJS sources are compiled into the desktop host.

From the release root:

```sh
node source/tools/build.js source/build
sh source/native/build.sh linux
sh source/native/build.sh windows
node source/tools/run_tests.js regression.json
node source/tools/verify_build.js .
python source/tools/recovery32.py source/build/linux/mwcli memory-recovery.json
node source/tools/desktop_recovery.js source/build/linux/eightmax desktop-recovery.json
sha256sum -c SHA256SUMS.txt
```

For paired benchmarks, compile source/tools/timed_training.cpp against each release's native/mw.cpp and native/json.c with -std=c++20 -O2 -ffp-contract=off, linking pthread and dl on Linux. Compile tools/peak_rss.c with gcc. The headers in tools/bench34.js, tools/scenarios34.js and tools/grouped34.js list their arguments. validation/3.4/time-to-target.js and version-continuation.py accept both release paths. Hardware-validation scripts run without a CUDA toolkit on Windows.
