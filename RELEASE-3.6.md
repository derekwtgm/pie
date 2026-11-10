# EightMax Windows 3.6

Build `900e85e1f0ddf2b1`. Extract the ZIP and double-click **EightMax.exe**. Keep its console open. Use **EightMax-Offline.html** for the JavaScript application. Both run locally. The original 3.5 ZIP passed CRC and all 550 SHA-256 checks.

## Save and recover

Use **Save training** to download a portable .emstudy file. Set the automatic checkpoint interval to enable recovery. Desktop autosave shows preparation and write progress and reports success only after the host confirms the commit. Open **Checkpoint recovery details** to see the size, generation, time, slot and index health, error or storage limit. **Recover automatic checkpoint** restores the latest usable study. Desktop storage is in Documents\EightMax. The offline application uses IndexedDB in the same browser profile.

The desktop host accepts Content-Length or strict HTTP chunked framing, receives in 64 KiB buffers and incrementally hashes and writes to an exclusive temporary file. It validates byte counts, compression, per-block and final SHA-256, solver metadata and solver-state semantics. Native checks replay the betting rules and use disk-backed sorting to verify unique row and edge identities. The verified slot is reread before publication. Previous valid generations remain recoverable through disk errors, cancellations and process death. Three slots, sequence metadata and a reconstructible index preserve recovery. A crash immediately after slot publication can leave a complete generation available before the application has received its acknowledgement.

Windows uses file flush, `_commit` and replace-with-write-through. Linux uses file and directory fsync. Cold recovery checks the file hash and semantics. Progress and cancellation use separate routes. Scratch is cleaned under the store lock. On supported browsers the desktop worker stages data in origin-private files, keeps an active file locked, and removes abandoned files on subsequent staging. Offline and manual-download paths may retain the encoded Blob.

| Desktop setting | Default | Accepted range | Unit |
|---|---:|---:|---|
| EIGHTMAX_CHECKPOINT_MIB | 2048 | 1–16384 | MiB per file and per decoded payload |
| EIGHTMAX_CHECKPOINT_RESERVE_MIB | 128 | 0–1048576 | MiB of storage kept free |
| EIGHTMAX_CHECKPOINT_IDLE_SECONDS | 15 | 1–300 | Seconds without input |
| EIGHTMAX_CHECKPOINT_SECONDS | 900 | 1–7200 | Transfer deadline checked again before publication |

Set these in a Command Prompt before starting EightMax.exe. For example, `set EIGHTMAX_CHECKPOINT_MIB=4096`. Allow space for all generations, staging, decoded data and uniqueness-sort runs. Cold validation can also need scratch space. The browser's new-format decoded restore ceiling is 2 GiB. Raising host policy above 2 GiB enables larger storage and downloads. Interactive restore above that ceiling remains unverified and is refused by the current browser reader. Legacy browser JSON is limited to 512 MiB. Old JavaScript table JSON can exceed the bounded compatibility verifier's working allowance. Large native 3.5 envelopes have a disk-backed validation path and a bounded base64 decoder in the current browser.

### Transfer tests on the release host

Each synthetic study uses unique, legal native rows on a genuine training topology. Raw wire blocks force the advertised size. Each run saved, downloaded and compared SHA-256, verified the previous generation, corrupted the index, restarted the host, reconstructed the index and downloaded again. The 128 MiB upload used chunked HTTP. Peak RSS is for the native host. The file generator and interactive explorer are separate processes.

| Nominal MiB | Stored bytes | Commit s | Warm download s | Cold rebuild and download s | Peak save MiB | Peak cold MiB |
|---:|---:|---:|---:|---:|---:|---:|
| 16 | 16,780,559 | 0.61 | 0.07 | 0.68 | 14.51 | 14.59 |
| 64 | 67,119,883 | 1.88 | 0.28 | 2.22 | 14.45 | 14.36 |
| 128 | 134,238,967 | 4.40 | 0.43 | 4.19 | 14.38 | 14.38 |
| 256 | 268,477,179 | 8.25 | 0.67 | 7.28 | 14.64 | 14.50 |
| 512 | 536,953,603 | 15.24 | 1.50 | 15.25 | 14.54 | 14.67 |
| 1024 | 1,073,906,451 | 29.14 | 2.64 | 30.87 | 14.44 | 14.46 |

### Complete solver-state equivalence

A real eight-seat linked calculation trained for **20,000 updates and 80,000 committed deals**, creating 2,157,037 betting states and 2,536,359 strategy rows. After loss of the index and a host restart, the reader regenerated the original native bytes. A further seven updates produced exactly the same entire binary state as an uninterrupted 20,007-update run. SHA-256 was `706d96d53f507f2062c4ec22e5866809398b557d258c303f6f61452f1719e121`. The real archive committed in 14.08 s. Cold index reconstruction and download took 13.45 s.

EMCP36 v1 records metadata and raw size, then losslessly encodes 256 KiB blocks with decoded SHA-256. A final SHA-256 covers the header, metadata and ordered descriptors. Each block uses raw bytes or a smaller zero-run representation. The native EMMW4 payload preserves the original floating-point values, ordering and RNG state. JavaScript row streams retain storage-pool order, average strategy, regrets, DCFR synchronization and counters. No lossy numerical encoding is used. The same reader supports manual files and automatic recovery.

| Trained-state operation | Stored MiB | Wall s | CPU s | Peak process MiB |
|---|---:|---:|---:|---:|
| 3.5 JSON writer | 170.29 | 11.91 | 13.87 | 2265.9 |
| 3.6 archive writer | 111.14 | 0.95 | 0.78 | 1269.3 |
| 3.6 reading 3.5 JSON | 170.29 | 18.16 | 21.88 | 1556.5 |
| 3.6 reading EMCP36 | 111.14 | 15.87 | 19.68 | 1196.8 |

The raw trained native payload was 127.71 MiB. The new file was 34.7% smaller than the 3.5 envelope. Each measurement used a fresh Node process. Writer RSS includes a live restored game. Both 3.6 reader measurements reproduced the same native SHA-256. An isolated run of the original 3.5 reader exhausted its V8 heap on this legacy file with a 4 GiB old-space setting. Browser restore necessarily allocates the live game as well as validation buffers. File streaming alone does not set the explorer's total memory footprint.

## Native performance

The comparison used Linux x64 on AMD EPYC 9V74 80-Core Processor. Native CPU runs used the same spec, seed, worker request, optimization flags, abstraction, range weights and deals. Each eight-seat linked profile ran 80 updates at 16 deals per update, four requested threads and a 2 GiB table limit. Nine interleaved runs per release covered three seeds. Original 3.4 and 3.5 `mw.cpp`, `mw_es.hpp`, `mw_es_impl.hpp` and `mwcli.cpp` were byte-identical. All three releases produced the same complete native state for each seed. The historical 189.9 ms result did not reproduce here. Its original cause remains unresolved.

| Version | Median training ms | Median complete CLI ms | Median process RSS MiB |
|---|---:|---:|---:|
| 3.4 | 53.03 | 78.24 | 20.3 |
| 3.5 | 53.10 | 77.67 | 20.3 |
| 3.6 | 50.29 | 75.04 | 20.3 |

3.6 avoids small bet-list allocations, reuses early public betting transitions in bounded worker scratch, and evaluates eligible pot shares for the traverser in chip EV. ICM still uses the terminal stack vector. The profile includes deal, traversal, merge and sampled scoring times. Hardware cache counters, separate PCIe and lock contention measurements were unavailable.

### Ten configurations with matched work

The full specifications, seeds, betting and hand abstractions, state visits, samples, CPU path, RSS and uncertainty estimates are in scenarios.json. All 30 equal-work native table-body hashes matched. Equal-time comparisons used 150 ms of native training per run. Each worker update may slightly overshoot the time budget.

| Scenario | Mean training ms, 3.5 | Mean training ms, 3.6 | Equal-time gain, 3.5 | Equal-time gain, 3.6 |
|---|---:|---:|---:|---:|
| Eight-player final-table ICM (linked preflop) | 150.4 | 150.6 | -0.0413 | -0.0413 |
| Eight-player linked preflop to river | 98.3 | 79.0 | 0.4164 | 0.3691 |
| Eight-player preflop shove/call | 48.0 | 73.6 | -0.0874 | 0.0138 |
| Four-player flop (3 sizes) | 32.9 | 34.1 | -0.3317 | -1.0563 |
| Heads-up river | 42.4 | 45.4 | 0.1155 | 0.1452 |
| Heads-up turn | 92.7 | 62.3 | 1.6380 | 1.5042 |
| Short-stack multiway all-ins (6-seat flop) | 15.2 | 17.5 | 0.0406 | -0.9188 |
| Six-player flop | 133.8 | 105.5 | 0.2110 | -0.2880 |
| Three-player river | 112.6 | 111.6 | 0.2345 | 0.2215 |
| Tournament bubble ICM (4 left, 3 paid, shove/call) | 15.0 | 11.0 | -0.6300 | -0.6528 |

Heads-up and three-player enumerable games report the largest exact seat gain within their betting and private-card abstraction. The other scenarios report a signed held-out estimate for one trained seat-0 deviation. Negative values mean that the tested deviation lost expected value. Units are BB in chip EV and prize units in ICM. Three replicates per scenario give substantial uncertainty. The separately run JavaScript and native reference comparison matched realized EVs and response gains at equal committed work across all ten scenarios and three additional seeds. Per-engine training time and observed process RSS are in reference-engines.json.

### Mathematical accuracy

Both private ranges and the full finite river action tree were enumerated to evaluate each trained strategy. Heads-up exploitability below is the average of the two exact best-response gains. Results are means and two-sided 95% Student intervals over nine independent seeds. Full traversal here enumerates betting actions on each sampled private deal.

| Algorithm | Exact exploitability at 4,000 deals, BB | Exact exploitability after 100 ms of training, BB |
|---|---:|---:|
| full standard linear | 0.3072 ± 0.0373 | 0.0667 ± 0.0062 |
| external linear | 0.4698 ± 0.0719 | 0.1255 ± 0.0169 |
| external conditional terminals | 0.4221 ± 0.1261 | 0.1231 ± 0.0131 |
| full CFR+ linear | 0.6987 ± 0.0272 | 0.1599 ± 0.0070 |
| full CFR uniform | 0.3245 ± 0.0439 | 0.0590 ± 0.0099 |
| external DCFR | 0.7280 ± 0.0544 | 0.2338 ± 0.0192 |

The optional **Average terminal outcomes and settled folds** setting conditions on an opponent's two terminal alternatives and shortcuts a folded traverser's fixed chip payoff when covered. It uses the current strategy, the same sampled deal and the established importance weights. The paired mean reduction against ordinary external sampling was 0.0477 BB (95% interval -0.1156 to +0.2111) at equal deals and 0.0024 BB (95% interval -0.0125 to +0.0172) at equal time. The evidence does not establish a general convergence improvement.

The opt-in measured selector in lib_select.js times candidates at the same abstraction and backend, uses three pilot seeds and applies a conservative paired uncertainty margin. It uses exact finite response values where feasible and a held-out response probe otherwise. Tree estimates, ranges, memory, utility model, measured backend and preset affect eligibility or the observed gain. Manual choices and restored studies are preserved. Pilot training is discarded. In the seven-seed validation, the decision was “Pilot evidence retained the starting algorithm”. Pilot setup and measurements took 2.02 s. The report includes the first observed 0.15 BB target crossing at four tested horizons, plus process and training time. Pilot overhead matters on short studies. No general time-to-target advantage on the specified i7 is established.

The regression tests cover CFR and CFR+, DCFR schedules, regret matching, counterfactual weights, external sampling, average strategies, weighted range and blocker handling, numerical guards, per-deal random streams and deterministic parallel aggregation. Multiway ICM, finite chip utilities, unequal all-ins, independent pot eligibility, tied winners, stack conservation, streets, raises and short posting are checked using tournament fixtures and independent oracles. The default positions are UTG, UTG+1, MP, HJ, CO, BTN, SB, BB. Blinds are 0.5/1 BB with an individual 0.1 BB ante and a 2.3 BB eight-player starting pot. Big-blind ante remains optional.

## CPU, CUDA and resource policy

The new sampled scoring kernel shares five community cards per deal. Eight two-card hands use 21 input bytes per deal, compared with 56 for replicated seven-card hands. Exact-equity board enumeration and work sizing were updated. Host scheduling measures preparation, transfers, launch, synchronization and result placement, checks GPU scores against the CPU on the same batch, and requires a 10% measured scoring advantage. Disjoint batch ranges prevent duplicate work. CPU Only, Automatic, GPU Preferred and Hybrid remain available. Allocation or verification failure selects CPU. Irregular traversal, regret updates and ICM remain on the host.

CUDA rechecks actual free VRAM, reserves the larger of 1 GiB or 25% of device capacity (2 GiB on an 8 GiB card), and enforces the configured buffer cap, initially 512 MiB. The release embeds PTX and sm_75, sm_80, sm_86 and sm_89 cubins. cuda-images.json records their verified SHA-256 and ELF architecture, and cuda-build.txt records compilation. Software driver tests exercise parity, batching, allocation failures, slow GPU fallback and deterministic complete-state comparisons. Physical CUDA numerical agreement, launch and hybrid end-to-end speedup on an RTX 4060 Ti remain unverified.

Native strategy memory, worker scratch, process RSS, attempted and committed deals, and GPU buffer usage have separate accounting. The default application budget is half of system memory, capped at 8 GiB. EIGHTMAX_APP_MIB and EIGHTMAX_PROCESS_MIB control host budget and native process budget, alongside per-study table and GPU limits. Whole-system memory across unrelated tabs, the display driver and other processes cannot be hard-capped. Detailed long-session peak usage on the target machine remains unverified.

## Validation and reproduction

**308 regressions passed, 0 failed, 0 skipped and 0 timed out** on Linux. This includes the 286 inherited cases and 22 new cases. The hardware-tag count in the regression JSON includes software fixtures. Large-file, browser, sanitizer and performance experiments are separate from that total. AddressSanitizer and UndefinedBehaviorSanitizer covered checkpoint parsing and native training. ThreadSanitizer exercised parallel native batches. LeakSanitizer was disabled in the traced environment. Suite-level results are retained alongside the raw measurements.

Tests include missing and corrupted indexes, interrupted uploads, bad checksums, forged outer hashes, short reads, malformed chunks, insufficient disk reserve, writer contention, explicit cancellation, process death during upload and before/after atomic publication, malformed input, failed jobs, memory exhaustion and exact continuation. Chromium exercised the actual native and offline workers, native fallback and cancellation, download/import, IndexedDB restart and previous-generation recovery. Controlled reserve tests enforce a real filesystem free-space rule. There was no physical NTFS power-cut test.

The two Windows executables were cross-compiled twice with MinGW-w64, with byte-identical results. Both are unsigned PE32+ AMD64 files. Their source and offline UI build identifiers match. Wine could not start its own command interpreter in this environment. Physical Windows launch and RTX 4060 Ti tests remain for your PC. Run **Run self-tests.bat** for **Windows-self-test.json** and **Validate CUDA hardware.bat** for **hardware-validation.json**. The former trains and streams a real checkpoint above 64 MiB. The latter reports GPU identity, driver, VRAM, physical execution flag, equity parity and end-to-end CPU, GPU and hybrid mode timings. Look at the recorded route and gpuExecutionVerified.

Two running desktop hosts shared a single checkpoint directory and received simultaneous valid uploads of 170.29 MiB and 111.14 MiB. Both commits succeeded on Linux. A subsequent cold-start write under an unattainable disk reserve returned HTTP 507. All slot and index files remained byte-identical, and both large studies were recovered under normal disk conditions. See concurrent-pressure.json and concurrent-pressure.py.

The real Chromium desktop worker also wrote a native study using origin-private staging, removed an abandoned stage, restored the committed generation, manually exported and reimported its .emstudy file, and continued training. Its two exact unilateral gains matched the JavaScript reference. See browser-archive.json and verify-opfs.js.

The inherited artificial 64 MiB boundary test sets that limit explicitly. Existing hybrid-routing assertions allow a CPU result when calibration measures it faster and continue to verify equality with the CPU reference and actual fixture allocation. Defaults for mathematical training were retained. Adaptive importance sampling and GPU regret updates were not enabled. The current release does not establish a full eight-player Nash solution.

The packaged Run self-tests.bat invokes validation/3.6/windows-release.ps1. It checks the SHA-256 manifest, the running desktop and CLI build identifiers, and records the result alongside the isolated native tests in Windows-self-test.json.

### Source and evidence

| Change | Principal source | Evidence in validation/3.6 |
|---|---|---|
| HTTP streaming, policy, progress, checksum, rotation and recovery | source/native/server.c, checkpoint_io.h, checkpoint_sha.h, checkpoint_store.h | checkpoint-sizes.json, real-continuation.json, regression-tests.json |
| Lossless archive, semantic validation and legacy restore | source/native/checkpoint_archive.h, checkpoint_native.hpp, checkpoint_legacy_file.h, checkpoint_verify.c and .js, source/web/lib_archive.js, lib_checkpoint.js, lib_wide.js, lib_river.js | serialization-*.json, load-*.json, legacy-large.json, checkpoint_ui_smoke.log |
| Desktop and offline UI | source/web/lib_river_ui.js, worker.js | native-ui.json, browser-recovery.json, desktop-recovery.json |
| Native traversal, conditional terminals, rules and utilities | source/native/mw.cpp, mw_es.hpp, mw_es_impl.hpp, source/web/lib_wide.js, lib_icm.js, lib_pots.js | profile-linked.json, scenarios.json, reference-engines.json, accuracy-river.json |
| Measured algorithm selection | source/web/lib_select.js, worker.js | time-to-target.json, source/tests/v36.test.js |
| CUDA and hybrid | source/native/score.cu, score_ptx.hpp, cuda_score.hpp, score_schedule.hpp | cuda-build.txt, cuda-images.json, cuda-host-probe.json, source/tests/cuda_driver_fixture.cpp |
| Build and target PC checks | source/native/build.sh, source/tools/release.sh, package36.py, test_windows.ps1, test_large_checkpoint.ps1, validate_hardware.ps1 | build-verification.json |

Build and repeat measurements from the extracted EightMax directory. Use Node 22 or later, Python 3.11 or later, GCC/G++, pthreads and OpenSSL development files on Linux. The Windows build requires a MinGW-w64 POSIX toolchain. Large validation runs need several GiB of free temporary space. Set TMPDIR to a disk-backed directory if the system temporary folder is small.

```sh
node source/tools/build.js
sh source/native/build.sh linux
sh source/native/build.sh windows
node source/tools/run_tests.js regression-local.json
python3 validation/3.6/reproduce.py sizes local-sizes
python3 validation/3.6/reproduce.py study local-trained-study
python3 validation/3.6/reproduce.py performance local-perf --v34 /path/to/3.4/EightMax --v35 /path/to/3.5/EightMax
python3 validation/3.6/reproduce.py math local-math --v35 /path/to/3.5/EightMax
python3 validation/3.6/reproduce.py reference local-js
sh validation/3.6/sanitizers.sh
sh source/tools/release.sh /path/to/output
```

For CUDA rebuilds see source/native/gen_ptx.py. For browser checks use Playwright Chromium and source/tools/native_ui_test.js, browser_recovery.js and desktop_recovery.js. Historical reports remain in their versioned validation folders.
