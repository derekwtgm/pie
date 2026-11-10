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
