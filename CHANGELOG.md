# EightMax Windows 4.9

- **Windows compressed-checkpoint restoration repaired** (release blocker from the 4.8 field report: "150 + 150 resumed from EMZ1" failed with "cannot create a temporary file for decompression"). Cause: `std::tmpfile()` of msvcrt (MinGW) creates its file in the root of the drive, which a standard account may not write; CI ran elevated. New `native/temp_file.hpp`: exclusive creation (CREATE_NEW / mkstemp), unpredictable names (PID, counter, BCryptGenRandom), share mode 0, FILE_FLAG_DELETE_ON_CLOSE (unlink on POSIX), UTF-16 directories, `\\?\` long paths; candidates EM_TEMP_DIR, system temp (GetTempPathW / TMPDIR), the checkpoint folder; every failed attempt is named in the error. Total decompressed size limited (16 GiB, EM_EMZ_MAX_MIB). `mwcli --selftest49` + `Run 4.9 checks.bat` (15 checks); CI step with a write-denied TMP/TEMP folder.
- Clang: `leave{T, {}}` copy-list-initialised a FlatHist through its explicit constructor; now `FlatHist()` (same 64-slot histogram). mw.cpp and mwcli.cpp compile with Clang 18 and GCC 13 (C++20, -Wall -Wextra), tested.
- Automatic device mode no longer opens CUDA for training calls whose projected scoring work is below 0.5 s (EM_AUTO_MIN_SCORE_SECONDS); GPU Preferred and Hybrid unchanged (open, measure, may fall back to the CPU). Same strategy bytes in every mode. `automaticDeviceSkipped`, `automaticProjectedScoreSeconds` in the training report.
- Exact best response: the private small-table cache is sized to the opponent-tuple working set (tuples + 16, 64-4096) instead of 1,024: weighted six-player flop 64.7 -> 28.9 MiB peak RSS, same table builds, time and result bits.
- Dashboard: an empty chart shows its note (chart 7 explains that it needs a second, imported run).
- Ten-seed convergence study (7 games, 8 trainer variants, 518 Holm-adjusted comparisons): no variant is supported as better on the six-player flop at equal time; DCFR and RM+ worse under sampling; opponent exploration 0.4 worse; own hands + baseline better at equal deals in small games only. **Default trainer unchanged.**
- EMZ1 level study: default level 6 kept.
- Tests: `tests/v49.test.js` (8). Unchanged: tournament rules, training code and state bytes (golden hash), checkpoint formats, CUDA kernels.

# EightMax Windows 4.8

- Windows test harness: `End-Section([string]$errorText)` turned `$null` into `''`, so every completed section was recorded as failed (all 4.7 Windows CI runs; `Run self-tests.bat` on a PC). Fixed; real Windows runner now 126 passed, 0 failed, 8/8 sections. `validate_hardware.ps1` did not parse in Windows PowerShell 5.1 (piped `for` statement); fixed.
- Continuation suite: evaluation hand indices come from the spec's root actor (4.7 used indices of the 4.5 eight-player study; four-player bubble 24/25 -> 25/25); the 4.5 sequence is unchanged byte for byte; choices recorded in `evaluationHands`.
- Exact/restricted/sampled response evaluation: per-board rank cache, pot layout once per terminal, chip-only utility path, table-cache caps (1,024 small / 64 shared) with a key index; results bit-identical to 4.7 (switches `EM_EV_NO_RANK_CACHE`, `EM_BR_NO_HOIST`, `EM_EV_SMALL_TABLE_CAP=4`, `EM_EV_TABLE_CAP=0` restore the 4.7 path). Exact gains 0.18x time on the six-player flop, 0.15x weighted six-player flop, 0.22x five-player flop, 0.11x four-player bubble.
- Evaluation memory: table histograms reserved/checked against `memoryMiB` (16.0 MiB peak at a 16 MiB budget).
- `tools/independent_br48.py`: independent multi-street best response; agrees with the engine to <= 7.1e-15 up to the six-player flop.
- `--compare`: `qualityChange` classes (improvement / regression / no change / inconclusive / not comparable).
- Dashboard: charts 1b (quality vs time), 7 (algorithm comparison at equal time), 8 (efficiency); trainer labels.
- `mwcli --selftest48`, `Run 4.8 checks.bat`; CI runs selftest47/48 on Windows; CI time limit 180 min.
- Tests: `tests/v48.test.js` (21). Tools: games48, brbench48, convergence48, checkpoint48, sanitize48.
- Unchanged: tournament rules/defaults, training code and state bytes (golden hash), checkpoint formats, CUDA.
- Not done: ten-seed convergence study (no trainer change), training benchmarks, EMZ1 level study, sanitizer pass, physical Windows PC / GPU validation.

# EightMax Windows 4.7

- Mathematical audit: the external-sampling estimator (opponent importance ratios, chance sampling with card removal, stochastically weighted averaging, linear and DCFR weights, RM+, buffered and transactional merges) re-derived; no engine defect found. New independent reference suite `source/reference` (explicit trees, no shared code): Kuhn 2/3, Leduc, three-player push/fold with side pots in chip EV and ICM, weighted ranges; CFR, CFR+, LCFR, DCFR, ES-MCCFR; exact best responses; 28/28 self-checks (Kuhn -1/18, Leduc -0.0856, ICM closed form, side-pot and ICM properties) and z-tests of estimator unbiasedness. A buffering bug in the reference CFR during development was caught by its own known-value checks and fixed.
- Experimental trainer option `ownHandEnumeration` (protocol 4, native only, opt-in): enumerates the updating seat's compatible hands with conditional weights (Rao-Blackwellisation), with an optional vector form of the terminal baseline. Unbiased against the default (`tools/unbiased47.js`, 4,000 seeds, two games); regret variance 10-29% of the default's. Ten-seed study (`tools/convergence47.js`, seeds 201-210, 216 Holm comparisons): with the baseline 11 better / 0 worse at equal deals, 4 / 0 at equal time; alone 10 / 0 and 2 / 1 (slower per second on the fixed-hand final table). Default unchanged.
- CFR+/DCFR: reference studies show their full-width advantage does not carry over to sampling (RM+ 0/7 and DCFR 0/5 worse at equal time); no parameter change.
- `info.trainer` metadata (estimator, weighting, regret matching, exploration, estimators, experimental/validatedDefault).
- `mwcli --verify` (exact, restricted lower bound, sampled estimate of a lower bound, local action deviations; positions, stacks, relative gains, Bonferroni-simultaneous intervals, coverage), `--compare` (game identity, strategy hashes, row overlap, TV distances, per-seat gain differences; exit 3 for different games), `--monitor` (adaptive evaluations, stopping rules, `eightmax-analytics/1` JSON + CSV; final state = uninterrupted training), `--selftest47` and `Run 4.7 checks.bat`.
- `tools/independent_br47.py`: independent river best response (own rules, evaluator, side pots) agrees with the engine's exact gains to about 1e-15.
- Quality tab (`web/lib_dashboard.js`): live training with measured quality, 14 tiles, 7 charts with intervals, checkpoint history and comparison, CSV/JSON export/import; JS analytics equal the native ones bit for bit.
- EMZ1 lossless compressed checkpoints (`native/emz.hpp`, zlib): `--compress`/`--decompress`, every command reads EMZ1; 0.455 of the size on a 14.2 MiB study; CRC-32 per block + SHA-256; 300 fuzzed corruptions refused; resume = uninterrupted. Restore not faster.
- CPU: betting states referenced in the state store instead of copied; 42 studies byte-identical to 4.6; 0.805x and 0.785x time on two of five workloads (1 thread), no supported difference elsewhere.
- Host: `/api/memory` reports `peakResidentMiB`. Build: mwcli links zlib (Linux `-lz`, MinGW static); test build cache, v43 and the inherited sanitizer scripts link it too; CI installs the MSYS2 zlib package.
- Tests: `tests/v47.test.js` (13 tests); `tools/sanitize47.sh` (ASan+UBSan, TSan) clean; see RELEASE-4.7.md for full counts.
- Unchanged: tournament rules and defaults, default trainer and its state bytes (golden hash), EMMW4, CUDA kernels and scheduling, PowerShell harness.
- Not done: physical Windows/GPU validation; PowerShell execution; promotion of a new default trainer; cash-game engine (review only).

# EightMax Windows 4.6

- Windows checkpoint continuation (release blocker): the 4.5 self-test on the target PC stopped with "icm45b.state does not exist". The script had discarded mwcli's output, ignored its exit codes and hashed icm45a.state while errors were set to continue, so the native reason was lost (confirmed harness defect). The same sequence passes with the byte-identical 4.5 binaries under Wine, on Linux (also under ASan+UBSan) and on 4.5's hosted Windows CI; the native cause on the PC is still unknown and will now be recorded.
- mwcli: exit 3 (input checkpoint missing/unreadable, with path and OS reason), 1 (refused input, engine reason), 4 (save failed: stage create-temp/open-temp/write/flush/commit/close/replace and the Win32/errno code and text; previous file untouched). Windows replace retried up to ~3 s on access-denied/sharing/lock violations (reported as saveReplaceRetries). `--state-info`, `--continuation-suite` (25 checks, each segment a separate process, full per-process records). Test hooks: EM_TEST_SAVE_FAULT, EM_TRAIN_CANCEL_AFTER_MS.
- Windows self-test: Invoke-Native (command, folder, exit code, stdout, stderr, duration, timeout), existence checks before hashing, eight isolated sections, structured totals/timestamps/artifacts, evidence folder on failure, required-section check; wrapper validation/4.6/windows-release.ps1 never reads a stale report and records a missing one.
- Process-wide memory reservation ledger (native/em_ledger.h): tables, restore, synchronous evaluations, background jobs; refusals (503/413 or queue wait) leave state byte-identical; GET /api/mw/memory with OS resident/peak. Governs the large allocations only; exclusions documented; no hard RSS ceiling claimed.
- Automatic scheduling: no code change. The 4.5 "21% slower" finding came from 3 blocked samples (Automatic's best run beat every CPU run); cold Automatic does not touch the CUDA driver (tested). validate_hardware.ps1 section 11: interleaved modes, 9 rounds, bootstrap 95% interval, scheduling counters per run.
- Convergence: tools/convergence46.js, seeds 101-110, opponentExploration 0.05/0.075/0.15 vs 0.1, six games, 216 Holm-adjusted comparisons on log NashConv: 0 better, 0 worse. Default unchanged; no strategy-quality improvement claimed. 4.5 data re-analysed on the log scale.
- Tests: tests/v46.test.js (continuation suite, state-info, exit codes and save faults, cancellation, memory ledger x4, cold Automatic, multiway invariants on five games with 1-24 thread bit-identity, coverage budgets at 16/24 workers). tools/sanitize46.sh (ASan+UBSan, TSan incl. host stderr capture), tools/bench46.js, tools/ps_balance.py.
- Sanitizers found two undefined-behaviour sites in the vendored QuickJS (float-to-int cast of out-of-range doubles in JS_NewFloat64; memcpy from NULL with length 0) when a checkpoint is restored through the host: fixed (results unchanged). Further QuickJS-internal UB (signed shifts) is excluded from UBSan in sanitizer builds (ASan/TSan still apply). cppcheck: a defensive NULL guard for checkpoint uploads.
- Unchanged: tournament rules, training algorithm and state bytes (golden hash), checkpoint formats, CUDA kernels, Automatic rule, deadline tolerances.
- Not done: any run on Windows PowerShell or a physical GPU; CUDA acceleration of longer workloads; a better-converging trainer; cash-game support (architecture review only).

# EightMax Windows 4.5

- Coverage memory budget (release-blocking): the audited overrun is reproduced against the archived 4.4 table (`tests/coverage45.cpp`: 1 MiB allowance, 32,768 information sets, 1,425,408 bytes live, +35.9%) and repaired. Cause: the key limit was `coverageMiB / 32 bytes`, the largest table generation alone was sized to the whole allowance, and the retired generations (kept for lock-free readers), the three sketches, a replacement abandoned by a stop, and every worker's 512 KiB filter were not counted. 4.4's own figure for a 64 MiB budget is 89.5 MB of slots.
- `coverageMiB` is now a hard ceiling on LIVE bytes (`emcov::Budget`): every generation including retired ones, descriptors, sketches, the set object with its lock cells and all worker filters are reserved before they are allocated (overflow-checked compare-and-swap; a refusal allocates nothing). Generation sizes are planned to fit; the documented capacity `coverageMiB * 2^20 / 32` exact keys is kept inside the ceiling (the last generation may be filled to 3/4). Abandoned replacements are released at once. Exhaustion or a failed allocation never corrupts the set: `coverage.memory.status` = `keyLimitReached` / `budgetExhausted` / `allocationFailed`, counts become labelled exact lower bounds, EVs are unaffected.
- `coverage.memory` in every action-EV answer: budget, peak, live, table, retired-generation and worker-filter bytes, generations, refused reservations, `withinBudget`, `status`, `countsExact`. Per-seat response-gain tables and the `EM_EV_MERGED_COVERAGE` path draw slots and sketches from one pool (4.4: sketches outside; merged table had a second allowance).
- Process memory: background jobs are charged `memoryMiB + coverageMiB` against the evaluation pool (4.0-4.4: `memoryMiB` only, so two jobs with `coverageMiB` 4096 could hold 8 GiB unseen); `coverageMiB` is validated at submission; job status shows `coverageMiB` and `chargedMiB`.
- Windows numbers: `mwcli --ieee-sweep` (200,000 generated doubles, digest of all printed characters). It found that the MinGW-w64 runtime `strtod` (and `__mingw_strtod`) returns the neighbouring double for some values just below a power of two (|x| < 1e-150 or > 1e195; 41 of 600,000 swept values). JSON numbers and CLI arguments are now parsed with `std::from_chars` (correctly rounded, runtime-independent): 0 mismatches in the Windows build. Printing was already identical (same digest as Linux).
- 4.4 self-test defect found on real Windows: `[decimal]::Abs` does not exist in Windows PowerShell 5.1, so the 4.4 `Run self-tests.bat` stopped at its first one-ULP check. Fixed (`[math]::Abs`).
- ICM kernel: 45% of eight-player ICM training instructions were in the finishing-set recursion, bound by divisions. Five or more live players now use a two-lane SSE2 kernel performing the same IEEE operations (bit-identical: `tests/icm45.cpp`, 240,000 evaluations against the archived 4.4 routine; trained states byte-identical). Kernel 1.4-1.5x for 6-8 players; eight-seat linked ICM training 1.13x (1 thread) to 1.19x (4 threads); chip-EV and fixed-hand push/fold training unchanged.
- Convergence (no improvement claimed): two new opt-in trainer options, `chanceSampling: "latin"` (Latin-hypercube private hands, exactly the default marginal distribution per deal) and `opponentExploration`. Ten seeds, six games, exact best responses, 288 Holm-adjusted comparisons: latin 0 better / 0 worse of 72, latin+baseline 0 / 0, exploration 0.05: 4 / 0, exploration 0: 0 / 1 (and stalls on several games). The default trainer is unchanged and writes the 4.4 state bytes (golden hash in the tests).
- Multiway postflop: `tools/stability45.js` (NashConv and root-strategy spread across seeds for board textures, stack depths, betting abstractions, 4-6 player flop/turn, bubble and final-table ICM at two budgets); property test of 16 generated 3-6 player all-in river games (side pots, weighted ranges, chip EV and ICM): seat values sum to the pot / prize pool.
- CUDA scheduling: no code change (nothing could be measured on a GPU). `Validate CUDA hardware.bat` section 11: small / medium / large evaluations per mode in cold processes, VRAM peak against `gpuMiB`, coverage peak against `coverageMiB`, bit-pattern agreement, cold Automatic against the best fixed mode.
- Tools: `tools/bench45.js`, `tools/icm_bench45.cpp`, `tools/stability45.js`, `tools/wine45.js`, `tools/sanitize45.sh`; `Run self-tests.bat` section v45 (sweep digest, coverage budgets, golden training hash, continuation after a capped evaluation, job-pool refusal).
- Tests: 434 passed, 0 failed, 0 skipped, 0 timed out on Linux from a clean build (424 inherited + 10 in tests/v45.test.js), plus tests/coverage45.cpp (46 checks) and tests/icm45.cpp; ASan+UBSan and ThreadSanitizer clean (`tools/sanitize45.sh`); 22 Wine checks pass; the repository's Windows workflow passes on a hosted Windows runner (real Windows and PowerShell 5.1, no GPU; 34 Linux-only tests skipped there). One inherited test (`4.2 coverage`) failed during development because the first 4.5 report put worker-count-dependent bytes into the `coverage` object; the report was changed, not the test.
- Unchanged: tournament rules (0.5/1 blinds, 0.1 bb individual antes, 2.3 bb eight-player pot, optional big-blind ante), default training algorithm, checkpoint formats, CUDA kernels, Automatic arm selection, deadline tolerances.
- Not done: physical RTX 4060 Ti validation; scheduling changes; a training method that improves strategy quality; thread scaling of small-batch linked training; browser checkpoint ceiling.

# EightMax Windows 4.4

- Windows numerical validation (release-blocking): the 4.3 self-test failure `15.670177585564112` vs `15.670177585564113` came from the test harness, not the solver. Windows PowerShell 5.1 reads a JSON fraction as System.Decimal and the test cast it to `[double]`; Decimal to Double rounds twice (integer above 2^53, then the division) and lands one ULP below. Shown by the report itself (the uncast field prints `...113`), by an exact-arithmetic model (`tools/ps_number_model.py`: of the ten reference values it changes exactly that one, by exactly one ULP) and by the Windows build under Wine printing the reference bits. Not yet re-run on Windows.
- IEEE 754 bit patterns: `evBits` beside `ev`, `gainBits` beside `gain`, `valueBits` in `mwcli --session`; `mwcli --ieee`, `mwcli --ieee-verify`, `GET /api/mw/ieee-probe` (26 probes: one-ULP neighbours, negative, subnormal, 1e+-300, above 2^53). `tools/test_windows.ps1` and `tools/validate_hardware.ps1` compare bit strings (equity: exact integer share units); no comparison of re-formatted numbers remains; a failed self-test check is recorded and later checks still run. No assertion removed, no tolerance added. Policy: `validation/4.4/NUMERIC-POLICY.md`.
- Sampled-EV deadline (release-blocking): after the stop 4.3 merged every worker's coverage table (measured 8 ms after a 100 ms limit on 1 thread, 98 ms after 600 ms on 4 threads). 4.4 fills one lock-free request-wide set while the workers run (`SharedCoverage`, `WorkerFilter`); nothing proportional to the work remains after the stop. See RELEASE-4.4.md section 2 for the interleaved 4.3/4.4 overrun distributions. Two further post-stop costs removed: the approximate-count sketches of a capped coverage set are back-filled when the key limit is reached (not after the stop) and updated lock-free; the per-worker key memo is a direct-mapped cache released in one call (4.3: up to 262,144 heap nodes per worker freed after the response). Tolerances unchanged (50 ms idle, 150 ms loaded). `deadline.phasesMs` reports where the time of a request went; `partialResult` reports completed and discarded-in-progress samples, weights and the residual limitation.
- Coverage: counts identical to the 4.3 merge and to the independent audit for every thread count; exactness now depends on the union of keys, not on the number of workers; lower memory. `EM_EV_MERGED_COVERAGE=1` keeps the 4.3 path. The set and the memo start small and grow with use; new tables are touched once by the thread that creates them; inserting threads share no lock word or per-key counter (two candidate builds that were slower than 4.3 on short requests and on a two-million-key four-thread request were rejected by the interleaved benchmark and corrected before release). A larger table is prepared while other threads keep inserting, and no promotion is started or continued while a stop is pending. `tests/coverage44.cpp` (55 checks, also under TSan and ASan+UBSan).
- Automatic device mode: your 4.3 hardware report shows warm Automatic staying on the CPU (48.4 ms at 1 thread) where GPU-preferred took 28.3 ms, and using only the slower pull split when it did use the device. Once the device is verified, 4.4 measures whole-table time for CPU, GPU pull and GPU preferred per (thread budget, table size) class and uses the fastest, re-measuring 2 of every 32 tables; warm-up estimate 0.1 s (measured start-up 0.064-0.098 s). `EM_GPU_AUTO_MODEL=4.3` restores the old rule. Validated by decision unit tests (`tests/auto44.cpp`) and the CUDA driver test double only: no GPU timing was measured and no GPU speed-up is claimed.
- Convergence: ten seeds, six games (heads-up river and heads-up turn with exact exploitability; three-player river; four-player ICM bubble with weighted ranges; six-player flop; eight-player final table), six variants, exact best responses, 360 Holm-adjusted comparisons, checkpoints to 1,000,000 deals where practical, plus four further candidate schedules. No variant is better on every game (DCFR(1,1,2): better only at equal time on the two ICM push/fold games, worse heads-up postflop; RM+ worse everywhere; variance-reduction options: no supported difference). The default trainer is unchanged and no improvement in strategy quality is claimed.
- Multiway postflop accuracy: `tests/v44_postflop.test.js` - rules walk of about 700 explorer nodes in ten trees against independently coded rules (chips, legal actions, minimum raises, all-ins, transitions, chance, blockers, strategy normalization), chip conservation, ICM prize-pool sums, agreement of the best-response and action-EV evaluators (1e-10), tables vs per-board enumeration (1e-12), sampling vs exact. No engine defect found.
- Shared showdown tables, tournament rules (individual 0.1 bb antes, 2.3 bb eight-player pot, optional big-blind ante), checkpoint formats, CUDA kernels and context handling: unchanged. Exact evaluations and training measure within noise of 4.3; 4.3 and 4.4 write byte-identical states.
- Tests: 424 passed, 0 failed, 0 skipped, 0 timed out (404 inherited + 15 in tests/v44.test.js + 5 in tests/v44_postflop.test.js); ASan+UBSan and ThreadSanitizer clean (`tools/sanitize44.sh`).
- Windows tools: `Run self-tests.bat` (section v44, continue after failure), `Validate CUDA hardware.bat` (bit-pattern comparisons; section 10: Automatic on a warm device against CPU-only, GPU-preferred and the 4.3 rule). Windows executables checked under Wine only. No physical Windows desktop, Windows PowerShell or NVIDIA GPU was available: nothing in 4.4 has been run on Windows or on a GPU.
- Not done: no CPU speed-up of exact evaluations (profile: scoring 82% of a one-thread request, already parallel), no persistent worker pool, no kernel or transfer changes, no new training algorithm, no 4.2 rebuild (sources not supplied).

# EightMax Windows 4.3

- Shared showdown tables: one table per request instead of one per worker and per response-gain seat (the RTX 4060 Ti report showed 753,984 boards scored for a 376,992-board exact EV on >= 2 threads and 3,015,936 for eight-seat gains). Tables are built cooperatively in 16,384-board chunks by the owner, helper threads within the request's thread budget and other workers that need them; the device pulls batches of chunks; CPU threads count rank patterns of device-scored chunks. Tables below one chunk stay per worker. Bit-identical EVs and gains (integer histograms; order-independent). `EM_EV_PRIVATE_TABLES=1` restores 4.2 behaviour.
- Fused full-seat rank patterns: branch-free dense rank (`fullPattern`, 5.8x faster than 4.2's per-board code), flat open-addressing histogram, board suit masks shared by all seats. Pattern counting on the eight-player fixture: 38 ms -> 6 ms per table (1 thread).
- Measured (4 CPUs, CPU only, 5 runs, identical numbers): exact eight-player ICM root EV 1.18x (1 thread), 1.65x (2), 2.76x (4); after two shoves 2.80x; two hands per seat range EV 22.3 s -> 10.2 s; exact eight-seat response gains 5.10x (1 thread) to 3.94x (4). Training states byte-identical; equity, sampled EVs and restricted gains unchanged within noise. Regression: sampled one-decision response gains about 5% slower (interleaved A/B).
- GPU lock contention: the 4.2 waits came from duplicate tables (a second worker waiting for the first worker's CUDA start-up and verification). Driver double, GPU-mode eight-seat gains: 2.48 s summed lock wait -> 0.
- CUDA lifecycle (4.2 context guard unchanged): one context, module and verification per process; Automatic opens the device on a background thread once its warm-up is spent and never stalls a table on start-up; `EM_GPU_PREWARM=1` (desktop host); idle release of pooled buffers after `EM_GPU_IDLE_RELEASE_S` (default 60 s); `GET /api/mw/gpu-status`; `mwcli --session` for cold/warm, sequential, concurrent, idle, cancelled and budget-refused runs in one process. Verification and the first device batch are reserved before CPU helpers start (GPU/hybrid always get a share).
- Automatic cost model (`autoChoice43`): CPU table time (measured ns per evaluation / building threads) against one measured device batch; device joins when > 1.25x; busy or opening device -> CPU without waiting.
- Coverage capacity: `coverageMiB` (default 64 MiB = 2,097,152 exact keys; 4.2: fixed 524,288), 16-byte slots, shared byte pool, `distinctCountKind` exact/lowerBound and labelled HyperLogLog `distinctEstimates` once capped. Verified to 2,000,000 information sets with 1-16 workers against sorted references (116 checks).
- Convergence study (10 seeds, 3 games, 6 variants, exact NashConv, equal samples and equal time, Holm over 160 comparisons): DCFR(1,1,2) better on eight-player push/fold but worse on the three-player river and four-player turn; RM+ worse everywhere; terminal baseline/expectation no supported difference. Default retained; training unchanged.
- Fixed during development: a ThreadSanitizer data race on the table cache's LRU clock; wait polls counted as table work; hybrid giving the device no share.
- Tests: 404 passed, 0 failed (389 inherited + 15 in tests/v43.test.js), plus tests/table43.cpp, tests/coverage43.cpp; ASan+UBSan and TSan builds clean. Two assertions describing replaced 4.2 Automatic behaviour amended (see RELEASE-4.3.md section 7).
- Windows tools: `Validate CUDA hardware.bat` section 9 (cold vs warm CUDA per mode and thread count, lifecycle scenarios); `Run self-tests.bat` 4.3 checks. No physical Windows desktop or NVIDIA GPU was available; CUDA timing on the RTX 4060 Ti is pending your validator run.
- Unchanged: CUDA kernels (score.cu / score_ptx.hpp), training, tournament rules, checkpoint formats.

# EightMax Windows 4.2

- Fixed strategy-coverage accounting (release-blocking reporting defect): the 4.1 table stored `key | 1` and re-inserted stored values on merge (probe start from a different hash), so an information set observed, merged and observed again counted twice (reproduced: 2 instead of 1); `key | 1` merged keys 2k and 2k+1 when their probes met; and the caller XOR-ed the seat into bits 62-63 of `rowKey`, whose state field uses bits 37-63. New `native/coverage.hpp`: unmodified 128-bit keys (row identity / synthetic key space), probe start from the original key, merge = set union, growable table (cap 524,288 keys, flagged), distinct sets with a stored row / with the fallback reported separately from lookups. Verified against a `std::set` reference (forced collisions, 1/2/4/8 workers, random merge orders, repeated merges, 300,000 keys; ASan/UBSan/TSan) and end to end against the new `EM_COVERAGE_AUDIT=1` reference for exact and sampled EVs and response gains (e.g. 8-player push/fold exact EV: 4.1 reported 318 distinct sets, 4.2 and the audit 319, identical for 1-8 threads). Regrets, strategies and EV arithmetic were not affected.
- Fixed the multithreaded CUDA EV-table failure (reproduced with a driver test double that enforces per-thread current contexts; not yet confirmed on physical hardware): 4.1 created its context with `cuCtxCreate` (current only on the creating thread) and called the driver from EV worker threads without a current context, so memory-info/allocation/launch failed with CUDA_ERROR_INVALID_CONTEXT and buffers could not be freed. The double reproduces the 4.1 hardware report exactly (message, 65,536 GPU boards = verification only, identical EVs) plus 2 MB of unreleased device memory. 4.2 retains the primary context (cuCtxCreate + pop as fallback) and makes it current through a balanced RAII push/pop for every call; verification now runs under the device lock (removing a two-worker race); device state is atomic; buffers are released on the owning context. With the double: 0 invalid-context calls, balanced pushes/pops, 0 bytes at exit, GPU-preferred mode scores 688,448 of 753,984 boards on the device (the rest is the CPU verification), identical EVs for 1-24 threads and every mode.
- CUDA diagnostics: every failure records driver call, result code, error name and description, host thread, context state, requested bytes, free/total VRAM, budget, reserve, launch geometry and whether the CPU took over (`execution.gpuErrors`). Budget, VRAM-reserve and out-of-memory refusals send one table to the CPU; other driver failures or a CPU mismatch disable the device for the process. Board counts are committed only after a range succeeds (no double counting, nothing omitted).
- GPU budget validation corrected: the 4.1 validator expected a 1 MiB budget to force CPU fallback, but the equity kernel requests 2,671 bytes. New `gpuBudgetBytes` (equity and EV requests) and `gpuRequestedBytes`; budgets are checked before any driver call; the validator tests request-1 (refused, identical CPU result, no allocation) and exactly the request (GPU, peak = request). VRAM protection (budget and max(1 GiB, 25%) reserve) unchanged.
- Exact EVs and exact/restricted best responses: rank-pattern histograms per seat subset are projected from one full-seat histogram per table instead of re-counting every board per subset (profiling: 96% of an eight-player seat's exact best response was pattern counting, 3% board scoring). Bit-identical results; `EM_EV_DIRECT_PATTERNS=1` keeps the 4.1 method. Eight-seat exact response gains 19.3 s -> 0.81 s (1 thread), 4.9 s -> 0.24 s (4 threads); eight-player exact root EV 1.26 s -> 0.08 s.
- Automatic device selection: CUDA is started only after the process has spent at least the expected start-up time (0.3 s, `EM_GPU_INIT_ESTIMATE_S`) on CPU table work; then verified bit for bit and used only when measured >= 10% faster than one CPU worker. GPU-preferred waits at most `gpuWaitMs` (default 2,000 ms, cancellable) for a busy device. Results report requested and observed device, CUDA state, a per-phase time profile and process device-memory peak.
- Tests: `tests/v42.test.js` (16 tests), `tests/coverage42.cpp`, `tests/cuda42.cpp`, `tools/gpu_stress42.cpp` (plain, TSan, ASan). The CUDA driver test double now enforces context rules and tracks allocations. v40/v41 tests whose workloads became faster than their deadlines run with the retained 4.1 pattern method (assertions unchanged); one v41 decision-accounting sum includes the new warm-up category.
- Hardware utilities: `Validate CUDA hardware.bat` re-runs the 4.1 failing configurations (requested vs observed device, CUDA errors, boards, time, VRAM), budget checks, response gains with 1-24 workers and `gpustress.exe`. `Run self-tests.bat` adds coverage-audit, thread-invariance and pattern-projection parity checks. No physical Windows desktop or NVIDIA GPU was available; see RELEASE-4.2.md for what is and is not verified.
- Unchanged: training (byte-identical states), tournament rules, CUDA kernels (score.cu / score_ptx.hpp), checkpoint formats.

# EightMax Windows 4.1

- Fixed unsafe numeric conversions (release-blocking): the background-job API converted JSON numbers such as `memoryMiB: 1e300` to 64-bit integers before validation (UBSan: `ev_jobs.h:153 ... outside the range of representable values`, host aborted). An audit with a sanitized desktop host found undefined behaviour in 10 of 16 probed input paths in 4.0 (job API, equity, build, solve, node path, report weights) plus further unchecked casts (float narrowing, legacy checkpoint fields, `--port`, `EIGHTMAX_GPU`, infinities accepted as integers, `(double)LLONG_MAX` bounds). New `native/num_safe.h` checks type, finiteness, integrality, representability and range before every conversion; requests are validated before anything is converted; invalid values return 400 with the field named (413 for memory above the pool), never a silent clamp or default. 4.1: 16/16 paths refused, 0 UBSan reports.
- Investigated the intermittent 4.0 Windows CI failure of "solve startup failure rolls back and supports concurrent retry/cancel": reproduced under load on Linux (1 of 12 runs); the test compared `/api/status` including the live `residentMiB` measurement. Test corrected (job state still compared exactly). Fixed two real job defects found in the audit: queued jobs had their queue time subtracted from `timeLimitMs` (the evaluation clock started at submission), and a cancel during requeue re-queued the job. New stress tests (concurrent starts, rapid create/cancel, shutdown with running jobs) pass under ThreadSanitizer with 0 reports; CI repeats them five times on Windows.
- Action-EV statistics: sampled comparisons now use simultaneous paired intervals for all action pairs (max-|t| from the estimated joint covariance of the common-random-number estimates) and Hsu MCB bounds against the best of the other actions, which account for picking the highest estimate; Holm-adjusted p-values as a cross-check. New classes `supportedBest` and `highestEstimate` (not established); equivalence only with a margin and inside the simultaneous interval. Simulated family-wise error 4.3-5.9% versus 20-50% for the 4.0 rule with 4-8 equal actions (tests/stats41.cpp). EV numbers unchanged.
- Work accounting: every EV and response-gain result reports tree visits, board runouts, board evaluations, tables, ICM evaluations, samples, rejected draws, best-response work, GPU batches and worker tasks. New `maxBoardEvaluations` budget (exact: 422 with no numbers; sampled: labelled partial).
- Response gains run seats in parallel with bit-identical results for every thread count (8-seat exact best response 19.1 s -> 4.7 s on 4 threads; six-player flop sampled gain 2.59 -> 0.87 s).
- Explorer: board-evaluation and memory limits, work summary, adjusted labels with simultaneous intervals, and a Strategy quality panel (background per-seat response gains with evaluator, interval, samples, seed, history).
- CPU/GPU: per-table scheduling decisions and peak VRAM reported; GPU verification no longer counted as a GPU table. CUDA kernels unchanged.
- Convergence study of DCFR(1,1,1)/(1,1,2)/(1,1,3)/(3,1,2) with exact NashConv, five seeds, Holm over 64 comparisons: none better than the default, some worse; training unchanged and byte-identical to 4.0.
- Measured regressions: single-threaded sampled EVs 2-22% slower; heavy exact traversal (linked preflop-to-river, 4 threads) about 2% slower; peak RSS +0.2-0.4 MiB.
- Hardware utilities: `Validate CUDA hardware.bat` adds complete-workload CPU/GPU/hybrid/auto timing, peak VRAM, GPU-time cancellation, parallel gains and `physicalNvidiaExecution` with Wine/VM indicators; `Run self-tests.bat` adds 4.1 checks. No physical Windows desktop or NVIDIA GPU was available. See RELEASE-4.1.md and validation/4.1.

# EightMax Windows 4.0

- Fixed the action-EV time-limit defect: an eight-player preflop ICM exact EV with fixed hands and a 100 ms limit ran 10.2 s in 3.9 (and returned an "exact" result after 8 s at another node). A shared monotonic deadline, cooperative cancellation and adaptive polling now cover every expensive loop (runouts, showdown tables, opponent and best-response tuples, chance cards, ICM terminals, rejection retries, subtree sizing, CUDA batches); measured 101-103 ms for a 100 ms limit on Linux, under Wine and on a GitHub Windows runner, cancellation in about 1-2 ms. Timed-out exact evaluations return HTTP 408 with no numbers; partial sampled results need at least minSamples samples and are labelled partial.
- Added background evaluation jobs to the desktop host (`/api/mw/jobs/...`): validation before queueing, bounded worker pool, FIFO queue with a memory pool, progress, results, cancel, release, configuration. Explorer queries and status keep working during evaluations; mutations of the study are refused while it is read; solver state is provably unchanged (byte-identical exports, deterministic continuation around jobs).
- Exact EVs: per-deal showdown tables reduced to integer rank-pattern histograms (CPU, CUDA, hybrid; GPU verified against the CPU before use), multithreaded work items with item-order reduction; sampled EVs in fixed per-seed blocks. Results are bit-identical for every thread count and device. 3.9 vs 4.0 exact EVs agree to <= 7e-13 relative. Eight-player push/fold root 24.5 s -> 2.0-2.4 s (1 thread, several measurements), 1.3 s with threads; linked preflop-to-river exact case finishes in 91 s with 4 threads (3.9: not finished in 300 s).
- Statistics: `equivalentToBest` no longer means "within 1.96 SE". Per-action classifications from paired differences (differenceSupported, differenceUncertain, practicallyEquivalent only with an explicit margin via two one-sided tests, insufficientSamples; exact: highest/exactTie/withinMargin/lower), difference intervals and plain-language interpretations.
- Coverage: policy lookups, stored/fallback rows, distinct untrained information sets, probability-weighted fallback shares (actions, opponent ranges, samples), warning levels with thresholds, selectable fallback policy and fallback sensitivity analysis.
- Response gains: new restricted best response (first street, backward induction; equals the exact best response on single-street studies to 1e-8), mode labels, per-seat timing and lookups.
- Explorer: evaluations run as jobs with status/progress/cancel; controls for method, utility (ICM or chip EV), time limit, visit budget, CPU/GPU/hybrid processing, equivalence margin and fallback; classification labels and coverage warnings.
- Investigated convergence (four games, five seeds, exact NashConv): no existing variant beats the default linear averaging at practical budgets; training unchanged and byte-identical to 3.9.
- Measured regressions: single-threaded sampled evaluation up to ~10-15% slower in three- and six-player spots; peak RSS +0.1-0.7 MiB.
- Tests: 17 new tests in tests/v40.test.js (all 341 earlier tests unchanged); TSan/ASan/UBSan and cppcheck pass; Windows runner: 349 passed, 0 failed, 9 skipped. Windows self-test and hardware validation scripts extended. No NVIDIA GPU was available: CUDA EV acceleration is untested on real hardware. See RELEASE-4.0.md and validation/4.0.

# EightMax Windows 3.9

- Fixed the explorer defect where numeric fields were silently coerced (`"rangeSeat":"nonsense"` read as "acting seat"; strings, booleans and null in `offset`/`limit` read as defaults). Explorer, action-EV and response-gain requests are validated against a strict schema: wrong JSON types, null, fractions, out-of-range or negative integers, unknown/duplicate fields, malformed arrays, unsupported action paths, duplicate or board-blocked cards, invalid hand indices, mismatched study/state identifiers and requests over 64 KiB return HTTP 400/409/413 with the offending field named. The desktop host and `mwcli --node` share the validator.
- Added native action-specific EVs (`native/action_ev.hpp`, `POST /api/mw/ev`, `mwcli --ev`): EV of every legal action, the stored mixed strategy and their differences, per exact hand and for the reach-weighted range, under a named continuation policy (average or current). Opponent ranges are conditioned on their own path strategy and card removal; future cards, later actions, side pots, unmatched-chip returns, eliminations and ICM are evaluated with the engine's own rules. Exact enumeration when the work fits a visit budget, otherwise Monte Carlo with exact-posterior rejection sampling, common random numbers, seeds, standard errors, 95% intervals, paired standard errors, time limits and cancellation. Missing strategy rows are either substituted uniformly with the affected probability share reported, or refused. Bounded results cache, cleared by training and imports.
- Added per-seat response gains (`POST /api/mw/response-gain`, `mwcli --gain`): exact best responses over exact private cards inside the betting abstraction (exact exploitability for heads-up chip EV; NashConv otherwise, without an exploitability claim), and for large multiway studies a sampled one-shot deviation gain per seat with independent selection and evaluation streams, reach probability and standard errors. Every seat is reported; the summary does not replace them.
- Explorer interface: EV tables with method, policy, samples, ± intervals, best/equivalent actions and fallback markers; matrix modes for strategy, EV of an action, EV minus mixed-strategy EV and EV standard error. Classes without computed EVs stay empty.
- Training code is unchanged: 3.9 produces byte-identical states to 3.8 in all ten benchmark scenarios. No CUDA code changed.
- Added 14 regression tests (341 total) including an independent JavaScript EV and best-response reference, a hand-built heads-up game, Compact/Detailed group-mapping parity against the JavaScript implementation, sampled-versus-exact coverage, host HTTP 400 checks and cache invalidation; ASan/UBSan runs; ten-scenario 3.8/3.9 benchmark; convergence measurements from 4,000 to 500,000 sampled deals. See RELEASE-3.9.md and validation/3.9.
- Rebuilt EightMax.exe, mwcli.exe and the offline interface (cross-compiled; tested under Wine, not on physical Windows or an NVIDIA GPU).

# EightMax Windows 3.8

- Profiled the 3.7 native external-sampling engine (instruction-level) on the ten benchmark studies. Repaired the measured hotspots without changing any result: ICM finishing-set sums and places are built incrementally (no per-mask rescan, no libgcc popcount call), terminal ICM results use a budget-scaled exact cache, betting transitions and terminal pot layouts are cached per worker, and the betting states of hot committed states are stored once. Every exported state is byte-identical to 3.7 for equal settings (240 paired runs, 1 and 4 threads, all estimators).
- Added a native-backed strategy explorer for open native studies (the interface control is in Native checkpoint recovery for desktop studies; the host API also serves an idle live native study): preflop, flop, turn and river decision points, validated action paths, chance-card selection, legal actions and bet sizes, pots, stacks, live/folded/all-in seats, 13x13 matrix, per-combo frequencies, range reach, aggregate frequencies, average versus current strategies, card blockers and coverage. The host returns one node per request (at most 1,326 hands). Unsolved branches are refused, never synthesized. EVs are not shown because the stored state does not contain them.
- Added a restoration memory estimate computed from the archive counts before the large allocations. Restores that cannot fit are refused immediately with the required and available MiB. The estimate matched the restored live tables exactly on five genuine trained states from 157 MiB to 1.55 GiB.
- Added 8 regression tests (327 total), an independent explorer reference checker, a genuine trained-state restoration series, an interleaved native timing harness, sanitizer runs and Windows self-test explorer checks. See RELEASE-3.8.md and validation/3.8.
- Rebuilt EightMax.exe, mwcli.exe and the offline interface. The executables were cross-compiled on Linux and were not executed on Windows or on an NVIDIA GPU for this release.

# EightMax Windows 3.7

- Added streamed reconstruction of a live C++ external-sampling study from a portable or stored generation. The prior state survives failed imports, and the resumed engine can train, expose per-hand root averages, stop and save again.
- Added spending limits for restore RAM and checkpoint storage, available-memory detection, conservative disk forecasting, progress, cancellation, and configurable retention of two or three validated generations.
- Added streamed CLI native import/export, preallocated row indexes, and lossless host-side export. Protected RNG, average tables, regrets, state identifiers and deterministic continuation.
- Reduced repeated work in native betting-state traversal and equal-contribution pots. Added an optional external-sampling fold control variate and corrected long-horizon DCFR discount arithmetic.
- Reduced repeated pilot calculations and exposed measured CPU scoring calibration data. CPU-only and CUDA-assisted routes share the same sampled deals.
- Rebuilt the Windows executables and offline interface. Added native restoration, memory pressure, deterministic continuation, mathematical comparisons and hardware validation procedures. See RELEASE-3.7.md and validation/3.7.

# EightMax Windows 3.6

- Replaced the desktop checkpoint request buffer with bounded streaming, incremental hashes, temporary-file verification, disk reserves, cancellation, timeouts and protected slot publication.
- Added EMCP36 v1 lossless native and JavaScript table archives. Updated large legacy base64 decoding, desktop file staging, offline import, adoption and recovery diagnostics.
- Added bounded public-edge reuse, allocation-free small bet sorting, traverser-specific chip utilities and optional conditional terminal evaluation. Existing tournament defaults and the JavaScript fallback are preserved.
- Added opt-in timed algorithm trials with response or exact finite-game measurements and retained manual selection.
- Added shared-board deal scoring, improved exact-equity enumeration, verified free-VRAM checks and CPU fallback on slower CUDA batches. Rebuilt the embedded sm_89 image.
- Rebuilt the unsigned Windows x64 binaries and offline app. Added 22 regression cases and reproducible size, fault, continuation, accuracy and performance utilities. See RELEASE-3.6.md for results and open hardware checks.

# EightMax Windows 3.5



The native host scans three autosave.N.em35 files. Each contains the original study envelope, a monotonic generation number, the save time and a SHA-256 seal over the generation fields and envelope. It validates the payload checksum, schema and restore semantics before admitting a candidate. Timestamps are for display. A checksummed index caches rotation order and retains the highest issued sequence when a slot disappears.

Saving writes to a same-directory temporary file, flushes and closes it, then replaces the unused or oldest safe slot. Slot publication commits the new generation. The host verifies the published bytes and rebuilt index before acknowledging success. A process killed after publication can leave a complete new generation even if the caller never received a reply. Check recovery details before retrying an unacknowledged write.

Open Multiway → Checkpoint recovery details to inspect index health, generation numbers and failed validation. Download generation returns a portable .emstudy. The old 3.4 .emstudy slots stay untouched. An intact legacy index supports automatic migration. When order is ambiguous, download candidates or choose Use this checkpoint to start the numbered store. For multiple damaged numbered files with incomplete history, export the survivors, close all hosts, archive the complete autosave file set together, then restart and load the chosen export.

Linux publication uses fsync on the file and parent directory. Windows uses _commit and a same-directory MoveFileExA replacement with MOVEFILE_WRITE_THROUGH. Power-loss behavior on a particular device, controller, network share or filesystem requires measurement there.

## Solver changes

Small grouped fixed-turn JavaScript studies reuse hand evaluations and history keys for identical seat, physical hand and river. Cache admission is bounded by the range sizes and configured strategy memory. A narrowly calibrated JavaScript automatic decision selects full traversal for small two-seat Detailed 60%-pot turn trees. Manual selection and checkpoint traversal are preserved.

Native Detailed grouping appends features directly to the destination string and counts suit blockers with rank masks. GPU scoring recalibrates when the actual batch length changes, avoids duplicate rounded partitions and checks the current VRAM cap even when device buffers already exist. All four processing modes remain available. The eight-seat opening pot is 2.3 BB with 0.1 BB individual antes.


# EightMax Windows 3.4

- Added server-side checkpoint integrity and restore validation, bounded verification memory, a flushed third slot and atomic publication of the generation index.
- Checked thread startup for solve, report and multiway training. Job-start failures preserve prior diagnostics and return a recoverable error.
- Added native grouped full traversal, sparse staged imports, and shared dictionary key storage. Added native/JavaScript parity tests over all starting streets.
- Extended automatic traversal to grouped studies and connected sufficiently large external-sampling batches to CPU/GPU scoring. Rebuilt CUDA images and both Windows x64 executables.
- Added 14 regression cases, fault-injection coverage, cross-version continuation checks and paired convergence measurements. Detailed implementation and reproduction instructions are in RELEASE-3.4.md.

# EightMax Windows 3.3

- **Fixed: negative individual antes were accepted.** The native spec field `anteOf` was not
  validated; a seat with a −0.1 BB ante trained successfully. All native, CLI, heads-up and
  JavaScript entry paths now refuse negative, non-finite, out-of-range and malformed values,
  and the native engine checks chip conservation (`pot0` = common pot + every contribution),
  blinds against stacks, integer counters, pot seats, duplicate hands and combo identifiers.
  `mwcli` refuses non-numeric arguments (3.2 read `abc` iterations as 0). Heads-up configs
  refuse negative weights (3.2 silently dropped them) and fractional card ids.
- **Fixed (JavaScript): a frozen batch could be partly applied** before a non-finite value
  threw, and that partial batch survived the rollback. The batch is now validated first.
- **Native external-sampling DCFR** (`weighting: 'dcfr'`, α/β/γ configurable) with per-row
  lazy discounting, bit-identical to the JavaScript reference for the standard exponents,
  equal to textbook eager DCFR within 1e-9, journaled, checkpointed and fault-injection tested.
  Measured: DCFR(1.5, 0, 2) converges *worse* than linear MCCFR under sampling; linear stays
  the default.
- **Native Compact and Detailed hand groups** for flop and preflop starts and large turns
  (previously JavaScript only): the engine computes the same keys as `seatKey()`; tables are
  bit-identical to JavaScript in 7 configurations, 8–10× faster in measured deals per second (validation/3.3/grouped-native.json).
- **Calibrated automatic traversal:** the cost-model ratio for ≤3-seat turn and river starts is
  refitted from exact equal-time measurements; on two turn trees 3.2 chose external sampling
  where full traversal gave significantly lower exact gain. Decisions are shown in diagnostics.
- **Diagnostics:** algorithm and weighting, traversal decision and reason, native hand groups,
  process peak RSS, a measured bound on GPU benefit for external sampling, and a separation
  of throughput from solution quality. UI: iteration-weighting selector.
- **Validation:** 34 new regression tests (248 total; 2 existing tests updated for lifted 3.2 limitations), sanitizers on all 3.3 paths, cppcheck
  enabled, 10 recovery scenarios byte-identical to 3.2, host stress, 3.2-vs-3.3 benchmarks.
  CUDA kernels unchanged; no physical GPU or physical Windows desktop was available.

See RELEASE-3.3.md and validation/3.3.

# EightMax Windows 3.2

- Made native external-sampling updates transactional and protected checkpoint import and continuation.
- Added aggregate scratch and persistent-capacity limits, host admission checks and committed-deal diagnostics.
- Added tree-cost selection, bounded native river/turn grouping and optional fixed-river batch stratification.
- Rebuilt the executables, offline interface and CUDA images. Added resumable benchmarks, allocation fault injection, cross-version comparisons and a Windows hardware report.

See RELEASE-3.2.md and validation/3.2 for source references, reproducible results and outstanding validation.

# EightMax Windows 3.1

Full details, measurements and limitations: RELEASE-3.1.md; raw results: validation/3.1/.

- **Native external-sampling MCCFR with native betting rules (spec protocol 4).** New
  `source/native/mw_es.hpp` / `mw_es_impl.hpp` generate betting states on demand from the
  study's rules (stacks, earlier and folded wagers, blinds and antes, per-street bet/raise
  abstraction, raise caps, minimum raises, all-ins, side pots, opening permissions) and train
  them with the external-sampling update of `lib_wide.js`. Studies that 3.0 sent to
  JavaScript (sampled betting, trees above the full-tree cap, all preflop studies) now train
  natively: preflop linked and shove/call, flop, turn and river, 2-8 seats, chip EV and ICM.
  Bit-identical to JavaScript in 12 tested configurations, under Linux and (Windows build)
  under Wine.
- **Per-deal action streams** (`actionStreams: 'deal'`, also in JavaScript): deals of a frozen
  batch traverse in parallel with thread-count-independent results. 8-seat linked preflop:
  about 8,900 deals/s on one thread and 16,400 on four (JavaScript: about 950).
- **EMMW4 training state**: parent-first state table plus rows, CRC32, study tag, and a full
  replay of every state through the betting rules before import. JS -> native -> native
  resume is identical to uninterrupted JavaScript training.
- **Automatic full-tree limit replaced**: the tree is counted without being kept; full traversal
  is used up to 20,000 states and native external sampling beyond. The 3.0 attempt allocated
  about 290 MiB of browser heap and 1.3 s before abandoning a 250,000-state tree. 3.0 checkpoints
  restore with the traversal they were trained with.
- **Accuracy per second**: on exactly evaluable benchmark games, native external sampling reaches
  2.2-2.5x lower exact response gain than the 3.0 JavaScript path at equal time (5 seeds,
  95% intervals in RELEASE-3.1.md). Full traversal is unchanged and remains the better choice for
  small trees; no tested variant (CFR+, DCFR, enumeration, stratification) beat the 3.0 default
  with non-overlapping intervals, so defaults are unchanged.
- **CUDA**: kernels rebuilt with NVRTC 12.9 and assembled to SASS for sm_75/80/86/89 (RTX 4060 Ti
  is sm_89), so a CUDA 12 driver suffices; PTX JIT is the fallback. Device probe (name, compute
  capability, VRAM, driver) in `/api/info` and `mwcli --cuda-info`; GPUs below 7.5 are refused.
  New exact multiway all-in equity kernel (integer share units) with CPU reference,
  `/api/equity` and `mwcli --equity`. River starts no longer send work to the GPU. Every GPU
  failure falls back to the CPU with the reason. Physical GPU execution remains unverified.
- **Hardware validation utility**: `Validate CUDA hardware.bat` / `source/tools/validate_hardware.ps1`.
- **Diagnostics**: training progress shows engine, algorithm, players, street, utility,
  device path, threads, native and browser memory, VRAM buffers, visited states, CUDA status and
  the JavaScript fallback reason. No completion percentage is shown for sampled training.
- **Tests**: 201 automated regressions (172 retained, 29 new in `tests/v31.test.js`), counted by
  `tools/run_tests.js` with per-file limits; timeouts and skips are reported separately. Native
  builds are shared across suites (`tests/native_build.js`). Two 2.9 assertions were updated for
  the intended 3.1 behaviour (see RELEASE-3.1.md).
- **Host**: `/api/mw/import` accepts states up to half the application budget (2 GiB maximum).
  Strategy budgets up to 2,048 MiB in the desktop app.

# EightMax Windows 3.0

- Embedded a source and build-configuration identifier in both executables and the offline interface. Packaging checks all three against a fresh fingerprint.
- Added exact native ICM terminal utility, weighted stratified river sampling and linked preflop full-tree training with complete public-card histories.
- Added optional integer CUDA hand scoring with CPU cross-checks, score-stage timing, adaptive device partitions and fallback. Kept CPU Only as the initial device.
- Added advance reservation for sparse immediate updates, frozen-batch RNG rollback on budget failure, native state integrity checks and atomic CLI state replacement.
- Included matched-deal, equal-training-time and worker-count measurements. See RELEASE-3.0.md for release scope and test limitations.

# EightMax changelog

## 2.9 (2026-11-07)

Full details, measurements and limitations: RELEASE-2.9.md; raw results: validation/2.9/.

- **Native C++20 multiway engine** (`source/native/mw.cpp`, protocol in `MW-PROTOCOL.md`)
  for sampled studies with Exact cards, chip EV and full betting trees, used
  automatically by the desktop app. JavaScript stays the reference, evaluator
  and fallback. Training state is bit-identical to JavaScript (tested across
  streets, update schemes, batch sizes, CFR+/uniform options and thread counts;
  the Windows build matches the Linux build byte for byte under Wine).
  7.5× (2-player river), 7.2× (3-player river) and 10.6× (8-player river) faster
  on one thread.
- **Multithreading** within frozen-policy updates (adaptive fan-out, parallel
  merge in deal order; results independent of thread count; ThreadSanitizer
  clean). 8-player river: 2.15× from 1 to 4 threads on this 4-core machine.
- **Accuracy per second:** 2.8's default sampler runs bit-identically and 6.1×
  faster (500k deals: 17.1 s → 2.8 s at 0.038 ± 0.004 bb). **Per sampled deal:**
  own-hand enumeration is the most accurate scheme measured (100k deals:
  0.055 ± 0.011 vs 0.081 ± 0.009 bb, 6 seeds) and is now selectable as
  *Update scheme*. DCFR was evaluated and rejected (worse at every budget).
- Bit-identical sparse ICM sweep (1.9× at 8 players, 18× at 16 players, 3 paid).
- Application-wide memory budget (native host + browser-reported memory,
  default half of RAM, max 8 GiB), pre-allocation refusal for native tables,
  `/api/memory`.
- Browser IndexedDB recovery tested in real Chromium (restart, worker kill,
  aborted and truncated writes, version mismatch, storage quota). Clearer
  recovery and incompatible-version messages.
- Eight-handed validation tests. The third position is now labelled MP.
  Chart validation report (charts unchanged).
- 2.8 → 2.9 JS throughput reproduced under controlled conditions: no
  regressions (all within ±5%, identical EVs).
- Not done: CUDA (no NVIDIA GPU or toolkit available), Windows hardware tests,
  code signing.


## 2.8

Sparse batched regret updates, optional stratified river sampling, accepted-deal counters, cheaper progress checks, durable automatic checkpoint recovery, native process monitoring, checked tree allocation growth and JSON parser/formatter repairs. All nine preflop charts regenerated identically. See RELEASE-2.8.md for measurements and limitations.


## 2.7 (2026-11-06)

Frozen-policy batched MCCFR with reusable, budgeted scratch storage; optional
experimental CFR+; explicit precision presets; periodic stability diagnostics;
expanded iteration limits; native allocation guard and thread-input validation;
safe baseline x64 and runtime AVX2/FMA builds without fast-math; native checkpoint
header validation. See RELEASE-2.7.md for scope and ACCURACY-SUMMARY.md for results.

This release does not claim CUDA, unrestricted eight-player equilibrium, new
chart calibration, or physical Windows hardware validation.


## 2.6 (2026-11-07)

Measured numbers below come from `validation/2.6/` in this package (Linux
x86-64 build machine, 4 cores). The Windows executable was **not run on
Windows** for this release; see "Validation scope".

### Priority 1 – Seven- and eight-player postflop presets
- **Bug:** `multiwayExample()` set `privateMode: n===6 ? 'sampled' : 'exact'`,
  so the 7- and 8-player Flop/Turn/River presets asked for exact deal
  enumeration and all six failed with *"This betting tree exceeds the desktop
  budget"*. (2–5 players used exact; 6 used sampled.)
- **New `privateMode: 'auto'`** (now the default for every postflop preset,
  shown as *Automatic · exact when it fits*). `planMultiwayMode()` runs the
  exact solver's own checks without allocating strategies: betting-tree size,
  joint-deal enumeration with card removal (≤ 4,096 deals, ≤ 2 M search
  steps), public states across the board runouts, state×deal pairs, the
  150 MiB storage estimate, and an estimated per-iteration cost (≤ 2.5 M
  deal-node visits, about a minute for 500 iterations). It picks exact
  enumeration if all of these fit, otherwise sampled deals, and says which
  limit decided it. Preflop studies always use sampled deals.
- Exact enumeration is still used where it is practical: in the shipped
  presets that means 2–5 players at the turn and river and 2–5 players at the
  flop (the flop presets still sample runout cards). 6–8 players use sampled deals.
- The result card shows the chosen mode and why. Checkpoints store the
  resolved mode, so they reload exactly. Auto runs with exact enumeration are
  capped at 5,000 iterations and stop at the target gain.
- Explicitly choosing *Enumerate compatible deals* for a spot that is too big
  still gives the clear budget error (tested).
- Regression tests: every preset, 2–8 players × Flop/Turn/River, builds, trains,
  conserves chips and has normalized strategies (`tests/v26.test.js`).

### Priority 2 – Native Windows engine rebuilt from source
- **Audit:** the 2.5 `EightMax.exe` was the 2.3 host binary with the 2.5 HTML
  patched in by `tools/package_windows.py`. It lacked the 2.5 native fixes:
  messages such as *"Solve the spot before saving it"*, the reserved
  Windows-name check text and *"Averaging exponent must be between 0 and 10"*
  are in `source/native` but not in the old binary.
- `EightMax.exe` is now compiled from `source/native` with MinGW-w64 GCC 13
  (x86-64, static, AVX2 + SSE4.2 engines, CPU picked at start-up). Two builds
  from the same source are byte-identical (`-Wl,--no-insert-timestamp`,
  stripped). `release.sh` checks this every time.
- `source/VERSION` (2.6) is the single version source. `build.js` computes a
  build id (SHA-256 over the engine and interface sources) and puts it in
  both HTML files and `BUILD-INFO.json`. `native/build.sh` compiles the same
  id into the host and will not build if the HTML and build info disagree.
  `/api/info` reports `version` and `build`, and the interface shows a warning
  if they don't match its own.
- `tools/package_windows.py` (the binary patcher) was **removed**. The GitHub
  workflow compiles the host on Windows, tests it with `test_windows.ps1`
  and `test_native_host.js`, records the Authenticode status, writes
  `SHA256SUMS.txt` and zips the release around the fresh host.
- New `tools/test_native_host.js` covers start-up, version and build id, the
  embedded UI being byte-identical to `native.html`, request validation,
  Host-header checks, a known river equilibrium, save → list → load
  (identical strategy), missing and corrupted files, staying responsive
  during a long solve, Stop, and shutdown. It passed against the Linux build
  and against `EightMax.exe` **under Wine 9.0**.

### Priority 3 – GTO accuracy and convergence
- **New measurement:** `exactCheckSampled()` copies a sampled (Wide ranges)
  study's average strategy into the enumerated game and computes each seat's
  exact best response. It runs as part of *Check accuracy* whenever the spot
  can be enumerated.
- **Finding:** on the three-player river from the 2.5 report, the 2.5 "tested
  response" figure (0.242 bb for one seed, 0.000 for the others at 12,000
  iterations) **understated** the true gain. The exact gains of those sampled
  strategies were 0.29–0.45 bb (sampled betting traversal). The old probe
  scored the response's *average* strategy, which still included its early
  uniform play.
- **Response probe fixed:** the response now plays greedily from its
  accumulated values. On full-traversal trees it trains with the opponents'
  actions enumerated instead of sampled, and is scored by exact expectation
  over actions instead of rollouts. On the reference spot its gains are now
  of the same order as the exact gains and stay below them (as a lower bound
  should).
- **Convergence (exact unilateral gain, mean ± 95% CI over 5 seeds,
  `validation/2.6/ACCURACY.txt` §5):**

  | Training | 3,000 it | 12,000 it | 48,000 it |
  |---|---|---|---|
  | sampled deals, sampled betting (2.5 report setting) | 0.905 ± 0.148 | 0.345 ± 0.084 | 0.219 ± 0.085 |
  | sampled deals, full betting (what Automatic traversal uses on a river) | 0.479 ± 0.141 | 0.224 ± 0.041 | 0.099 ± 0.023 |
  | sampled deals, full betting, alternating updates | 0.444 ± 0.106 | 0.204 ± 0.057 | 0.108 ± 0.022 |

  Exact deal enumeration on the same spot: 0.0039 bb after 500, 0.0006 after
  2,000 and 0.0003 bb after 5,000 iterations (6.8 s). Automatic mode
  enumerates this spot, which is the effective fix here. Pot is 12 bb.
- Algorithm variants evaluated against the exact gain (`updates` option,
  default unchanged so 2.5 checkpoints resume bit-for-bit). Alternating
  updates: slightly better per iteration, about the same per second.
  Own-hand enumeration (unbiased, conditional weights): about 8× fewer
  iterations, about the same per second. Regret-matching+ flooring with
  chance sampling: worse, so it was not kept. Conclusion: the remaining
  sampled error is Monte Carlo noise in the deals, falling at about 1/√T.
  None of these variants changes that much.
- Audit results (no change needed): CFR+ regret floor and linear averaging in
  the exact engine; linear MCCFR regret and average weights in the sampled
  engine; the importance-sampling ratios for sampled opponents in external
  traversal (unbiased; the average-strategy weight is unbiased but
  high-variance); collision-rejecting deal sampling (no seat bias); blockers
  and folded-hand card removal (existing tests and new exact cross-checks).

### Priority 4 – Eight-player linked solving
- The pipeline (8-player linked preflop → river, random ranges, 25 bb, 3
  preflop raises, 1 size per postflop street) builds and trains; benchmarks
  are in `validation/2.6/benchmark.json`. Its accuracy is **not certified**.
  Exact enumeration is impossible, and tested responses are lower bounds (8-player
  section of `ACCURACY.txt`).
- Sampled betting traversal now keeps a bounded cache of betting states near
  the root (8,000 states, path depth ≤ 9, postflop only). States are a
  deterministic function of their action path, so results are bit-identical
  to 2.5 (checked on the 8-player flop preset).

### Priority 5 – Tournament antes
- Default stays 0.1 bb per dealt player (0.8 bb with eight dealt). Totals
  scale with the dealt count (tests for 2–8 dealt players, postflop and preflop pots).
- Short stacks preflop: a seat that cannot cover the ante now posts what it
  has and is all-in. Before, it was rejected. Live seats' antes count toward
  their side-pot contributions, so an all-in-for-the-ante player wins only
  what it matched. Antes of other dealt seats are dead money.
- Big blind ante (separate setting): the big blind is posted first and the
  ante from what is left.
- ICM, chip EV and pot display use the same itemized pot.

### Priority 6 – Accuracy testing
- `tools/accuracy_report.js` no longer prints recorded calibration values. Every
  number is recomputed: push/fold vs the independent oracle, heads-up JS/WASM
  exploitability, a known-solution reference game (value 1, bluff ½, call ½,
  EV 2.5), exact multiway gains vs iterations, sampled-vs-exact convergence
  over seeds with 95% intervals, tested-vs-exact responses, 8-player tested
  responses, and FGS invariants. Parameters, seeds, timings and hardware are
  recorded in `ACCURACY.json`. The deep-chart realization fit is listed as
  *not regenerated* instead of being repeated.

### Priority 7 – Performance and stability
- Profiling (V8 CPU profile, 8-player flop): with sampled betting, 26% of the
  time went to rebuilding betting states, 25% to garbage collection and 6% to
  side-pot layering. The bounded state cache above targets that.
- `tools/benchmark.js` runs each configuration in a fresh process (median of 3
  runs, peak RSS) and can run against an older source tree for before/after
  comparisons (`--source=`). Same machine, both run alone
  (`validation/2.6/benchmark-2.5-baseline.json` and `benchmark.json`):

  | Configuration (sampled) | 2.5 it/s | 2.6 it/s | Peak RSS 2.5 → 2.6 |
  |---|---|---|---|
  | 6-player flop, 2 sizes + raise | 964 | 1,032 (+7%) | 113 → 116 MiB |
  | 7-player flop | 923 | 997 (+8%) | 118 → 119 MiB |
  | 8-player flop | 647 | 735 (+14%) | 127 → 126 MiB |
  | 8-player river | 2,232 | 2,940 (+32%) | 99 → 105 MiB |
  | 6-player linked preflop→river, random ranges, 25 bb | 1,240 | 1,157 (−7%) | 136 → 133 MiB |
  | 8-player linked preflop→river | 860 | 858 (±0%) | 142 → 140 MiB |
  | 8-player linked, ICM 50/30/20 | 626 | 606 (−3%) | 154 → 154 MiB |

  Preflop studies don't use the cache (an earlier, larger cache tried during
  development made them slower and tripled their memory). The small
  linked-study differences come from run-to-run noise and the itemized ante
  layers. Every 2.6 run was deterministic across its three repeats.
- The 8-player studies use 16–29 MiB of strategy storage and under 160 MiB
  of process memory at these sizes. Larger trees stop at the configurable
  strategy budget (1–256 MiB) with a visible reason instead of crashing.
- Existing safeguards kept: worker time slices (≤ 55 ms) so the UI stays
  responsive, Stop, checkpoint save/resume (now also tested against files
  saved by 2.5). In the native host test it answered in 2–9 ms during a long
  solve and stopped on request.
- Not done: SIMD or multithreading for the multiway JavaScript engines (they
  stay single-threaded in a Web Worker). The heads-up native engine is
  already multithreaded with AVX2/SSE builds.

### Priority 8 – Packaging and security
- Host check: the native server compared the `Host` header with a
  **prefix** match, so it accepted `127.0.0.1:8708.example.com`. It now
  requires an exact match (tested). Added out-of-memory checks on request
  buffers and JSON strings (cppcheck finding), and a missing `calloc` check
  in the GPU pinned-buffer path.
- Static analysis: `gcc -Wall -Wextra -Wshadow -Wformat=2` is clean in the
  host C files (two shadowing warnings remain in OpenCL kernel code). cppcheck
  reported one real issue (fixed) and one false positive.
- Imported files: `.emstudy` checkpoints are size-limited, checksummed and
  validated field by field, and contain only data. Saved `.em8` solutions are
  checked against the rebuilt tree. Save names are limited to safe characters
  and refuse Windows device names. Nothing from an imported file is run as code
  or passed to a shell.
- `EightMax.exe` is **not digitally signed** (no code-signing certificate was
  available). Windows SmartScreen may warn. Check the file with
  `SHA256SUMS.txt`.
- Old reports moved to `validation/2.3/` and `validation/2.5/`. The obsolete
  patcher was removed.

### Priority 9 – Tests
- 127 regression tests (85 from 2.5 + 42 new) and three packaged UI/worker
  smoke tests. Native host integration tests ran on Linux and under Wine.
- 2.5 compatibility: `tests/fixtures/checkpoints-2.5.json` holds trainings saved
  by the unmodified 2.5 code (sampled, exact, linked). They load in 2.6 with
  identical values and continue identically (linked preflop matches to 1e-9,
  because antes are now itemized).

### Validation scope and remaining limitations
- **Windows:** the 2.6 `EightMax.exe` was cross-compiled on Linux and run
  under Wine 9.0, not on Windows. Run `Run self-tests.bat` on a Windows PC, or
  the included GitHub workflow, before relying on it. Physical-GPU solving was
  not tested. The GPU path was checked only with the CPU emulator.
- Multiway results are **not** certified GTO. Exact unilateral gains are exact
  only for the configured tree, ranges and runouts. In games with three or
  more players, a profile with small gains is still not a unique or
  "unexploitable" strategy. Sampled studies converge at roughly 1/√T. For
  spots that can't be enumerated, the only checks are tested responses (lower
  bounds) and seed spread.
- Full-range 8-player preflop-to-river solving uses abstractions (hand
  groups, a few bet sizes, sampled deals and betting). Its error is
  unmeasured.
- The 15–100 bb chart realization fit was not regenerated.
- The shipped exe has no icon resource (the 2.3 binary had one; no `.rc` file
  was in the source).
