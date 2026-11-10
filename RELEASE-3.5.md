# EightMax Windows 3.5

Extract the complete ZIP and open EightMax.exe. The offline browser entry point is EightMax-Offline.html. Run self-tests.bat checks the desktop CPU path. Validate CUDA hardware.bat generates hardware-validation.json using your local NVIDIA driver.

## Checkpoint recovery

The native host scans three autosave.N.em35 files. Each contains the original study envelope, a monotonic generation number, the save time and a SHA-256 seal over the generation fields and envelope. It validates the payload checksum, schema and restore semantics before admitting a candidate. Timestamps are for display. A checksummed index caches rotation order and retains the highest issued sequence when a slot disappears.

Saving writes to a same-directory temporary file, flushes and closes it, then replaces the unused or oldest safe slot. Slot publication commits the new generation. The host verifies the published bytes and rebuilt index before acknowledging success. A process killed after publication can leave a complete new generation even if the caller never received a reply. Check recovery details before retrying an unacknowledged write.

Open Multiway → Checkpoint recovery details to inspect index health, generation numbers and failed validation. Download generation returns a portable .emstudy. The old 3.4 .emstudy slots stay untouched. An intact legacy index supports automatic migration. When order is ambiguous, download candidates or choose Use this checkpoint to start the numbered store. For multiple damaged numbered files with incomplete history, export the survivors, close all hosts, archive the complete autosave file set together, then restart and load the chosen export.

Linux publication uses fsync on the file and parent directory. Windows uses _commit and a same-directory MoveFileExA replacement with MOVEFILE_WRITE_THROUGH. Power-loss behavior on a particular device, controller, network share or filesystem requires measurement there.

## Solver changes

Small grouped fixed-turn JavaScript studies reuse hand evaluations and history keys for identical seat, physical hand and river. Cache admission is bounded by the range sizes and configured strategy memory. A narrowly calibrated JavaScript automatic decision selects full traversal for small two-seat Detailed 60%-pot turn trees. Manual selection and checkpoint traversal are preserved.

Native Detailed grouping appends features directly to the destination string and counts suit blockers with rank masks. GPU scoring recalibrates when the actual batch length changes, avoids duplicate rounded partitions and checks the current VRAM cap even when device buffers already exist. All four processing modes remain available. The eight-seat opening pot is 2.3 BB with 0.1 BB individual antes.

## Validation

Current-version results and reproduction scripts are in validation/3.5. Older version directories contain historical evidence. Physical Windows, real GPU kernel parity and end-to-end RTX 4060 Ti speed remain to be measured on the target PC.

## Five-seed JavaScript time to a response-gain target

The weighted heads-up Detailed turn fixture uses four sampled deals per frozen update. Each seed starts in a fresh Node process. The exact best-response evaluator runs outside the timer. Times include constructing the game and training through the first tested horizon where the larger of the two unilateral gains was at most 0.7 BB. The tested horizons were 1,000, 4,000, 16,000 and 64,000 updates. The JSON rows include both seats' mean gain as exact heads-up exploitability.

| Comparison | Baseline median | Candidate median |
|---|---:|---:|
| 3.3 / 3.4 automatic, profiler active | 1290 ms | 1490 ms |
| 3.4 / 3.5, fixed external sampling | 1241 ms | 511 ms |
| 3.4 / 3.5, automatic traversal | 1510 ms | 364 ms |

The earlier 1,416 / 2,536 ms result did not recur at that magnitude. Both original versions chose external sampling, and both profiles showed substantial time in hand features. File I/O, worker messaging and checkpoint export are absent from this JavaScript timed path. Repeated seat/river feature work accounts for a removable cost in both releases. The historical slowdown has no established single cause. The fixed-traversal benchmark isolates the cache. Automatic also changes the traversal. Timings are development-host observations and carry shared-machine timing noise.

## Native benchmarks

All 30/30 paired equal-update runs produced identical strategy-table payload digests. Each row below is the median of three seeds. The run used external sampling with physical hands. The fixed-time budget was 150 ms with stopping at progress boundaries. Large games used at most 80 updates in the equal-work run. Columns give measured training time and mean paired change in the equal-time response-gain estimate (3.4 minus 3.5). Positive values favor 3.5. Heads-up metrics use exhaustive finite-game responses. The three-player river row also uses exhaustive unilateral responses. Every other row uses a trained seat-0 response with paired holdout sampling. Chip-EV gains are in BB. ICM gains are in prize units. Short horizons and three seeds limit interpretation.

| Scenario | 3.4 ms | 3.5 ms | Change in equal-time gain |
|---|---:|---:|---:|
| Eight-player final-table ICM (linked preflop) | 181.2 | 200.4 | +0.0077 |
| Eight-player linked preflop to river | 60.9 | 189.9 | +0.1258 |
| Eight-player preflop shove/call | 36.6 | 36.8 | +0.1218 |
| Four-player flop (3 sizes) | 28.6 | 31.5 | -0.0307 |
| Heads-up river | 30.1 | 32.0 | +0.0061 |
| Heads-up turn | 48.9 | 53.0 | -0.0170 |
| Short-stack multiway all-ins (6-seat flop) | 19.9 | 20.7 | -0.3141 |
| Six-player flop | 53.0 | 47.9 | +0.0985 |
| Three-player river | 74.4 | 72.5 | +0.0117 |
| Tournament bubble ICM (4 left, 3 paid, shove/call) | 12.1 | 9.6 | -0.0856 |

scenarios.json contains the configurations, counts, visits per second, observed RSS, GPU bytes, per-seed results, uncertainty and exact heads-up exploitability. It includes faster and slower cases. Equal-time native results do not establish a general multiway convergence advantage. GPU usage was zero in this CPU matrix.

The four-seat river ICM selector check used two physical hands per seat, five seeds and 250 ms per run. Median largest finite-game unilateral gain was 0.04049 prize units for full traversal and 0.03755 for external sampling. The existing selector chose full traversal. This one small ICM tree does not establish the best algorithm for an eight-seat final table. grouped.json compares native full and external traversal with the JavaScript reference for both Compact and Detailed grouping at equal work and with a timed native budget.

## Verification on the development host

- The uploaded 3.4 archive SHA-256 was d0f4ba6a41dd331e1cda7f7c22ae623ae166e1deb196d404b46303dbc6b19324. All 495 input manifest entries verified.
- The six-player flop test uses a 2 MiB table cap, two workers, four deals per update and per-deal action streams. After a memory stop it saves the native state through HTTP, interrupts another save, deletes the index, recovers the payload, resumes at 256 MiB and checks exact binary equality against an uninterrupted calculation. Ten further six- and eight-seat limited-memory cases are in memory-continuation.json.
- The storage tests exercise missing, invalid, truncated and stale indexes, missing and damaged slots, duplicate sequences, unreadable destinations, two concurrent hosts, legacy adoption and fault injection before and after publication. Real OS file-size-limit and directory-permission errors returned HTTP 500 and preserved both previous payloads. Actual power failures and full disks on a physical Windows volume remain unverified.
- Headless Chromium ran the native worker with 80,000 deals, checked JavaScript EV parity, cancellation, grouped native execution and JavaScript fallback. The offline IndexedDB restart and recovery tests also ran in Chromium. recovery-ui.log records interaction with the desktop recovery panel.
- Twelve desktop job creation, training, cancellation or completion, state export and free cycles used 8 MiB native table caps. Peak sampled host RSS was 18.5 MiB. Sampling can miss transient peaks. Process-wide host memory and browser-reported usage are separate. An exact system-wide peak covering every concurrent browser, CUDA and CPU allocation remains unverified.
- CUDA source regenerated compute_75 PTX and four architecture-specific cubins, including sm_89. The complete header was byte-identical. Linux driver fixtures exercise scoring, fallback and buffer caps. The test double evaluates the kernel source on CPU. Driver simulation and kernel compilation supply no physical GPU timing.
- CFR, CFR+, DCFR and MCCFR update equations remain compatible. The release changes hand-key reuse and a bounded automatic traversal choice. No new variance-reduced estimator, general multiplayer error bound, adaptive accuracy preset, or physical-GPU time-to-target claim is included.

## Release test totals

The final regression run passed **286 tests**, comprising all 262 inherited cases and 24 new tests. Failures, skips and timeouts were zero. The disk-failure regression was updated to inspect the new slot frame and the surviving generation through the current API. The original 3.4 host reproduction is in original-index.json. The two Windows executables were each built twice and compared byte for byte. Build ID **2c966e16bec735bc** is embedded in both executables and the offline UI.

Native TSan and ASan/UBSan training checks completed for grouped, DCFR, low-memory and resume paths. The legacy combined sanitizer runner exited before its reporting tail. A separate explicit TAP replay passed all 34 v33 tests under ASan/UBSan, and cppcheck ran separately at its normal branch-analysis level. LeakSanitizer was disabled in this environment. The physical Windows and NVIDIA categories are outside the 286 automated results.

## Reproduce

1. From the extracted root, run `node source/tools/build.js`. On Linux use `sh source/native/build.sh linux`. With a MinGW-w64 POSIX toolchain on PATH use `sh source/native/build.sh windows`. The outputs are under source/build. Run `node source/tools/verify_build.js .` on an assembled package.
2. Run `node source/tools/run_tests.js regression-tests.json`. To run the fault matrix alone use `node --test --test-reporter=tap source/tests/v35.test.js` on Linux. The native suites require GCC/G++ and pthreads. The desktop fixtures isolate their save directories.
3. Run `python3 source/tools/recovery32.py source/build/linux/mwcli memory.json` and `python3 validation/3.5/filesystem-faults.py source/build/linux/eightmax filesystem.json`. For the browser recovery panel set EM_TEST_HOST to the absolute host path and CHROMIUM_PATH to a Playwright-compatible Chromium executable, then run `node validation/3.5/recovery-ui.js`.
4. For the JavaScript comparison run `node validation/3.5/compare-js.js /path/to/3.4/source source results.json`. Add --fixed for external sampling. For 3.3 versus 3.4 use their respective source directories and add --profile. The original release fixture is in validation/3.4/time-to-target.js.
5. Compile source/tools/timed_training.cpp against each release's own native/mw.cpp and native/json.c (compile json.c with gcc, then use g++ -std=c++20 -O2 -ffp-contract=off -Isource/native and link pthread and dl). Compile source/tools/peak_rss.c with gcc. Pass the two CLI/timer pairs, peak_rss and output JSON to `sh validation/3.5/run-scenarios.sh`. See the per-run parameters and actual elapsed times in scenarios.json.
6. On Windows run **Run self-tests.bat**, then **Validate CUDA hardware.bat**. The first exercises CPU solving and both index recovery cases in an isolated profile. The second records the actual GPU model, driver, compute capability, free and total VRAM, exact equity parity, low-VRAM behavior, mode timing and deterministic continuation. Keep Windows-self-test.json and hardware-validation.json with the build ID. To study without CUDA select **CPU Only**.

Windows durability API references: [Microsoft _commit](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/commit) and [Microsoft MoveFileExA](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexa).
