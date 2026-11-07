# EightMax Windows 2.9

Extract the ZIP and run `EightMax.exe` on a Windows x64 PC (keep its console
window open). `EightMax-Offline.html` is the browser-only entry point.
`Run self-tests.bat` tests the native host on your machine. The executables
are **not digitally signed**; compare them with `SHA256SUMS.txt`.

**What was and was not tested.** Everything below was measured on a 4-core
Linux x86-64 build machine (Intel Xeon @ 2.1 GHz, no hyper-threading). The
Windows executables were cross-compiled with MinGW-w64 GCC 13 and run under
**Wine 9.0, not on Windows**. Nothing was run on an Intel 13th-generation
Core i7, an RTX 3060 Ti or Windows 10/11. Raw results are in `validation/2.9/`.

## 1. Native C++ multiway engine (new)

Sampled multiway training can now run in native C++20 (`source/native/mw.cpp`)
inside `EightMax.exe`. The JavaScript interface and engine are kept. JS builds
the game (betting tree, legal actions, pots, ranges) and sends it to the host
over a versioned local protocol (`source/native/MW-PROTOCOL.md`, protocol 1).
JS stays the reference and the fallback. After each training chunk the native
state is copied back into the JS game, so the explorer, EV estimates, accuracy
checks, exact cross-checks and `.emstudy` checkpoints all use the existing code.

- **Same results as JavaScript, exactly.** Native training uses the same
  random stream, deal sampler (whole-tuple rejection), regret-matching
  arithmetic, operation order, linear weighting, CFR+ option and frozen-batch
  rules. It is built without fast-math and with `-ffp-contract=off`. Regrets,
  averages, deal counts and state-visit counts are **bit-identical** to the JS
  engine. This is tested for river, turn and flop starts, 1–64 deals per
  update, simultaneous, alternating and own-hand-enumeration updates, CFR+
  clipping and uniform weighting, and with 1, 2, 3, 4, 7 and 8 threads.
  The Windows build gives byte-identical state to the Linux build under Wine.
- **Eligible studies:** sampled ranges, Exact cards grouping, chip EV, a full
  betting tree of up to 250,000 states, any postflop start. Everything else
  (Detailed/Compact groups, ICM, preflop-linked studies, trees that need
  sampled betting) trains in JavaScript. The result shows which engine trained
  the study and, for a fallback, why. Choose **Training engine** in Multiway
  (desktop app only).
- **Integration tested** in a real Chromium browser against the running host:
  worker → host training, progress, Stop (86 ms), fallback, and EVs equal to
  in-page JS training. Also tested over HTTP for initialization, training,
  status, cancellation (3–5 ms), refusal of concurrent jobs, state
  export/import, malformed input and memory reporting. Linux host and
  `EightMax.exe` under Wine.

### Speed (training deals per second, same exact-card game, 16 deals per update)

| Spot | JavaScript 2.9 | Native, 1 thread | Native, 2 threads | Native, 4 threads |
|---|---:|---:|---:|---:|
| 2-player river | 168,760 | 1,267,447 (7.5×) | 1,171,067 | 1,193,892 |
| 3-player river | 31,208 | 225,587 (7.2×) | 223,492 | 223,371 |
| 4-player flop (exact cards, hashed rows) | 55 | 181 (3.3×) | 219 | 242 |
| 8-player river (2 sizes + 2.5x raise, 134k states per deal) | 14 | 152 (10.6×) | 195 | 326 (23×) |

### Threads

The deals of one frozen-policy update are traversed in parallel, then merged
in deal order by row ownership, so results do not depend on the thread count.
Waking threads costs tens of microseconds, so an update is split only when its
measured work is large (≥ 60,000 state visits). Small trees (2–3 player
rivers) run on one thread at any thread setting. Scaling on large trees on
this 4-core machine: 8-player river 1 → 2 → 4 threads = 152 → 195 → 326
deals/s (2.15×). The serial part is the deal sampler and commit.
ThreadSanitizer reports no data races (`validation/2.9/sanitizers.log`).

Updates with one deal (sequential CFR) cannot be split without changing the
algorithm, and they are not. Parallel updates are **not** treated as
equivalent to sequential CFR: each batch freezes the policy, exactly as the
JS "Deals per update" setting defines it.

Thread count: the host uses all logical CPUs, or `EIGHTMAX_THREADS` (1–256).
Windows assigns work to performance and efficiency cores; no affinity is
forced. Runtime CPU detection selects the AVX2/FMA heads-up engine. The
multiway engine is portable x86-64 code without AVX requirements, so it runs on
any x64 Windows PC. Its time goes to irregular tree traversal, not to SIMD-able
loops.

## 2. Accuracy and convergence (Priority 1)

Three-player river from earlier reports (12 bb pot, 30 bb stacks, 8 hands per
seat, 50/125% bets and a 2.5x raise). The gain is the largest single-seat
improvement an **exact best response** finds against the learned average
strategy in this restricted game (bb, lower is better). Six training seeds;
± is a 95% Student-t half-width. Times are training only.

| Training | 4k deals | 20k | 50k | 100k | 250k | 500k |
|---|---:|---:|---:|---:|---:|---:|
| 2.8 JS, 4 deals/update (default) | 0.402 ± 0.041 | 0.187 ± 0.037 | 0.110 ± 0.014 | 0.081 ± 0.009 | 0.050 ± 0.008 | 0.038 ± 0.004 (17.1 s) |
| 2.8 JS, 1 deal/update | 0.420 ± 0.057 | 0.165 ± 0.025 | 0.101 ± 0.012 | 0.076 ± 0.021 | 0.053 ± 0.012 | 0.034 ± 0.008 (15.1 s) |
| 2.8 JS, stratified 4 | 0.387 ± 0.039 | 0.178 ± 0.029 | 0.115 ± 0.014 | 0.083 ± 0.015 | 0.046 ± 0.006 | 0.039 ± 0.006 (17.3 s) |
| **2.9 native, 4 deals/update** | 0.402 ± 0.041 | 0.187 ± 0.037 | 0.110 ± 0.014 | 0.081 ± 0.009 | 0.050 ± 0.008 | 0.038 ± 0.004 (**2.8 s**) |
| 2.9 native, 16 deals/update | 0.434 ± 0.078 | 0.217 ± 0.040 | 0.106 ± 0.008 | 0.073 ± 0.007 | 0.048 ± 0.008 | 0.035 ± 0.006 (2.7 s) |
| **2.9 own-hand enumeration, 4** | **0.303 ± 0.037** | **0.121 ± 0.023** | **0.075 ± 0.014** | **0.055 ± 0.011** | **0.037 ± 0.009** | **0.028 ± 0.005** (14.0 s) |

What this shows:

- **Per second:** the native engine gives the 2.8 default results bit-for-bit,
  6.1× faster. In 2.8 s of training, 2.8 reaches about 0.11 bb and native 2.9
  0.038 ± 0.004 bb. This is the measurable improvement in this release.
- **Per sampled deal:** own-hand enumeration (unbiased: every compatible hand
  of the updating seat is traversed with its exact conditional weight) has
  the lowest error at every budget. At 100k deals it is 0.055 ± 0.011 vs
  0.081 ± 0.009 bb. It costs about 5× more computation per deal, so per second
  the plain sampler is better. Choose it under **Update scheme** when sampled
  deals are the scarce resource. The 2.8 stratified and batch-size variants
  are within each other's intervals.
- **Evaluated and rejected:** DCFR (α 1.5, β 0, γ 2) was worse than linear
  averaging at every budget (500k deals: 0.045 vs 0.038 bb with 4 deals per
  update, 6 seeds). CFR+ clipping (2.7) and alternating seats were also worse.
  Batches of 64 deals per update were worse per deal (0.051 at 500k). Defaults
  are unchanged.
- **Audit:** regret increments `t·π₋ᵢ·(v(a) − v)`, own-reach-weighted
  averages, importance ratios in external sampling (both sides of the
  traverser's node, including the average-strategy sampling probability), and
  frozen-batch averaging were re-derived and checked against an exact best
  response. Native/JS bit-equality checks the implementation independently a
  second time. Non-finite increments stop training with an error rather than
  corrupting tables (instability detection). Root-strategy drift between
  diagnostics is reported, as before, as a stability signal, not a bound.
- **Seeds:** every run is determined by its seed (training deals, betting
  samples and evaluation each have their own seeded stream). Checkpoints store
  the random states.

None of this is a multiplayer Nash certificate. Exact best-response gains
apply only to the restricted three-player game. For spots too large to
enumerate, tested responses are lower bounds.

## 3. Performance (2.8 vs 2.9, controlled)

Each configuration ran in a fresh process with nothing else running, three
repeats, median reported. Both versions train the identical study and return
**identical EV vectors**, so updates per second are directly comparable.
"Visits/deal" is the work per sampled deal.

| Configuration (JS engine, preset settings) | 2.8 updates/s | 2.9 updates/s | Change | 2.9 deals/s | Visits/deal | Peak RSS 2.8 → 2.9 |
|---|---:|---:|---:|---:|---:|---:|
| 2-player river | 43,481 | 41,462 | −4.6% | 165,849 | 27 | 55 → 62 MiB |
| 3-player river | 8,319 | 8,059 | −3.1% | 32,235 | 148 | 57 → 64 MiB |
| 4-player flop | 649 | 631 | −2.8% | 2,524 | 188 | 136 → 140 MiB |
| 6-player flop | 210 | 210 | +0.3% | 842 | 411 | 152 → 157 MiB |
| 7-player flop | 169 | 167 | −0.9% | 670 | 511 | 163 → 167 MiB |
| 8-player flop | 127 | 123 | −3.2% | 491 | 628 | 178 → 191 MiB |
| 8-player river | 590 | 612 | +3.7% | 2,447 | 230 | 111 → 121 MiB |
| 8-player linked preflop–river | 170 | 170 | −0.1% | 681 | 379 | 211 → 214 MiB |
| 8-player linked ICM 50/30/20 | 110 | 113 | +2.4% | 451 | 394 | 219 → 226 MiB |

The scan's 2.7 → 2.8 "regressions" (8-player ICM 797 → 720, 8-player flop
857 → 847) did not reproduce. Separate runs of 2.6, 2.8 and 2.9 on the
8-player linked ICM study gave 519–555 it/s each, within ±5% run-to-run
variation. The JS engine's speed is unchanged in 2.9 (all differences within
±5%). The 7–13 MiB higher peak RSS comes from the larger interface bundle.

ICM evaluation: the Malmuth–Harville DP now visits only finishing sets smaller
than the number of paid places, in the same order and with the same
arithmetic (bit-identical, tested on 3,000 random cases). Measured: 1.9× faster
at 8 players with 3 paid places, 2.5× at 12 players, 18× at 16 players. Shapes
where most places pay keep the full sweep. On the 8-player linked ICM study
with no other tables, the gain is 2–5%.

Bottlenecks that remain (profiled): in JS sampled-betting traversal, rebuilding
betting states and side-pot layers takes about 30% and garbage collection
7–25%. The 6/7/8-player flop presets exceed the native engine's 250,000-state
full-tree limit, so they keep training in JavaScript.

## 4. CUDA: not implemented

There is no CUDA code in this release. The build environment has no NVIDIA
GPU and no CUDA toolkit, so no kernel could be compiled or checked against the
CPU. There is no RTX 3060 Ti measurement of any kind. The measurements also
argue against the obvious design. A GPU needs thousands of deals per
frozen-policy update, but accuracy per deal already gets worse at 64 deals
per update (0.051 vs 0.038 bb at 500k deals). Tree traversal is irregular and
branches on the policy. Hand evaluation is under 1% of native time
(evaluation runs once per seat per deal). The existing OpenCL heads-up river
backend and its CPU fallback are unchanged (emulator test passed). A hybrid
design worth testing on real hardware: GPU batched showdowns over many
private hands per public board, for own-hand enumeration.

## 5. Memory (16 GB systems)

- One **application budget** covers the native host plus the browser memory
  the interface reports (page JS heap where the browser exposes it, plus the
  multiway worker's strategy storage, sent every 5 s). The default is half of
  physical RAM, at most 8,192 MiB: 8,043 MiB on this 16 GB machine.
  `EIGHTMAX_APP_MIB` overrides it (256–65,536). The native process threshold
  (`EIGHTMAX_PROCESS_MIB`, default 6,144 MiB) and the heads-up allocation
  limit (`EIGHTMAX_MEMORY_MIB`, default 4,096 MiB) still apply within it.
- Native multiway tables are estimated **before allocation**. A study that
  doesn't fit is refused with the estimate, e.g. "Native strategy tables need
  about 7132 MiB, more than the 5850 MiB native budget" for an 8-player
  full-range river. Hashed (turn/flop) tables that reach the budget stop
  cleanly with "native memory budget reached". The current update is
  discarded and the state stays consistent and resumable (tested).
- `GET /api/memory` reports the application limit, process limit, resident
  memory, multiway tables, browser-reported memory and what is still
  available.
- Fast / Balanced (default) / High accuracy presets are unchanged. None of
  them bypasses a memory limit. A configuration that is too large is refused
  with a message; it is never shrunk silently.

## 6. Checkpoints and browser recovery

The offline application's IndexedDB recovery was tested in real Chromium with
a persistent profile (`tools/browser_recovery.js`,
`validation/2.9/browser-recovery.json`):

- an automatic checkpoint is written, then the worker is terminated mid-run;
- after a full browser restart, the newest checkpoint recovers the update
  count and the sampled-deal count;
- the recovered training continues bit-identically to uninterrupted training
  (regrets, averages, both random streams, counters);
- an aborted write leaves the newest checkpoint intact;
- a truncated newest checkpoint fails its SHA-256 check, and the previous
  generation is recovered with an explicit message;
- an unknown engine version is refused with a message naming it;
- a storage-quota failure reports "Browser storage is full or blocked" and
  leaves both stored generations unchanged.

Compatibility: native training adds no checkpoint format. `.emstudy` files
written by 2.3–2.8 load unchanged, and studies move between engines without
any loss of state (tested). Restarting from a checkpoint counts as
"continuing" only because the restored state is complete: regrets, averages,
random states and counters.

## 7. Eight-handed tournament validation

New tests cover:

- positions UTG, UTG+1, MP, HJ, CO, BTN, SB, BB (the third seat was labelled
  LJ before);
- the 0.1 bb ante per dealt seat giving a 2.3 bb starting pot at eight seats,
  with the optional big blind ante kept separate (2.5 bb);
- a full preflop → flop → turn → river line to showdown;
- eight-way all-ins with unequal stacks: side-pot layers conserve chips, and
  the shortest stack wins only the main pot;
- minimum-raise reopening rules;
- weighted ranges with blockers;
- ICM sums and agreement with the reference DP for 8 and 16 players.

These check rules and accounting. They do not establish equilibrium accuracy
for full-range eight-player play. That remains unmeasured beyond
tested-response lower bounds (accuracy report §6), because no exact
evaluation exists at that size.

## 8. Preflop charts

Report: `validation/2.9/chart-validation.json`, produced by
`source/tools/chart_validation29.js`. **No chart was changed.**

- **Audit.** Each 15–100 bb chart is the equilibrium of a *preflop model
  game*, not of full poker. The game uses 169 hand classes, pairwise card
  removal, at most three voluntary entrants and fixed sizes per depth. Its
  postflop values come from a **fitted equity-realization model** (an
  estimate: `BONUS_FIT` / `playFeatures` in `lib_deep.js`). Calculated parts:
  the preflop equilibrium of that model game, and the blinds and antes (0.1
  bb per dealt seat, 2.3 bb at eight seats, checked in tests). The stored
  "ex" values are the exploitability *of the model game* after quantization
  (0.0009–0.0017), not a distance to full-game equilibrium.
- **Reproducibility.** Re-solving the 25 bb chart from scratch with the
  shipped generator matched every one of its 63,258 packed values (identical
  SHA-256). 2.8 did the same for all nine depths.
- **Independent comparison: inconclusive.** First-in opening frequencies were
  compared with the linked preflop-to-river solver, which plays flop, turn and
  river with real cards instead of the realization model. With full
  1,326-combination ranges for eight seats, that solver hits its 256 MiB
  strategy-memory maximum after only 17–28 thousand updates, while still
  converging from its uniform start. Two seeds agree with each other (UTG
  29–30% at 15 bb, 37–38% at 25 bb) but sit about twice above the charts
  (13.1% and 15.4%). That reflects an unconverged reference, not chart error.
  The charts therefore remain **unvalidated against full-game play**. A
  converged full-range reference needs more memory, the native engine
  extended to preflop studies (roadmap), or narrower reference ranges.

## 9. Windows build, security and tests

- `EightMax.exe` and `mwcli.exe` (a command-line native engine for
  benchmarks) are built from this source by `source/native/build.sh`. Two
  builds are byte-identical. The interface, host and `BUILD-INFO.json` share
  version 2.9 and the same build id. DLL dependencies are only Windows system
  DLLs (`validation/2.9/windows-dependencies.txt`). There is no Authenticode
  certificate table (`validation/2.9/signature.txt`).
- Static analysis: `g++ -Wall -Wextra -Wshadow -Werror` is clean. cppcheck
  finds nothing in the native multiway engine. ThreadSanitizer,
  AddressSanitizer and UBSan are clean on threaded hashed-flop and dense
  6-player river training.
- Malformed input: native specs and states are validated field by field
  before use (tested: bad protocol, seats, cards, tree order, batch sizes,
  options, truncation, trailing bytes, NaN values, mismatched rows).
- Tests: 140 regression tests from 2.8 plus 22 new (2.9 parity, threading,
  memory, protocol and 8-handed validation) = 162, all passing. Also passing:
  the packaged UI/worker smoke tests, native host tests (Linux and Wine),
  native multiway protocol tests (Linux and Wine), the browser-integration
  test of native training (Linux and Wine) and the browser recovery test.

## Reproduce

```
node --test source/tests/*.test.js
node source/tools/build.js source/build && sh source/native/build.sh windows source/build/native.html source/build/windows
node source/tools/bench29.js <2.8 source> source/build/linux/mwcli out.json      # accuracy per deal and per second
node source/tools/perf29.js  <2.8 source> source/build/linux/mwcli out.json      # throughput 2.8 vs 2.9 and native scaling
sh source/tools/release.sh                                                       # full build, verification and packaging
```
