# EightMax changelog

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
