# EightMax Test Workbench 0.31.0 — final development report

Classification: **development build, not 1.0.** All measurements below come from the Linux development container (Intel Xeon
@ 2.10 GHz, 4 logical CPUs, 15 GiB, Node v22.23.5, simulated tables, native EightMax 5.1 `mwcli` built from the bundled source).
It is **not** the target PC (Windows 11 Home, i7-13700F, 16 GB, RTX 4060 Ti). **Nothing in 0.31 has run on Windows** (section J).

## A. Baseline verification
docs/0.31-baseline-verification.md. 0.30.0 ZIP taken from the user's repository (it was not attached): SHA-256
`fd2ac52e…5d99b8` matches; `unzip -t` clean; **550/550** manifest entries verify; app 0.30.0; EightMax 5.1 build `7d08acc7eb4577ee`
(a Linux mwcli compiled from `native/source` reports the same id); **0.30 suite unmodified: 734 tests, 734 pass, 0 fail, 0 skipped**.
The user's Windows archive ("test results.zip") was **not received**; its summary is recorded as user-reported only.

## B. Completed development
**New modules:** `src/fast-river.js` (vectorised exact evaluation + CFR+), `src/strategy-quality.js` (classifications, policies,
ledger, gate), `src/adaptive-training.js` (quality-targeted training), `src/range-engine.js`, `src/range-model.js` (opponent
ranges), `src/strategy-abstraction.js`, `src/coverage.js`, `src/strategy-directory.js`, `src/strategy-service-worker.js`,
`src/research-view.js`, `src/research-ui.js`.
**New tools:** `tools/training-variants-031.cjs`, `tools/math-validation-031.cjs`, `tools/abstraction-validation-031.cjs`,
`tools/range-support-031.cjs`, `tools/coverage-031.cjs`, `tools/benchmark-031.cjs`, `tools/shared-cache-benchmark-031.cjs`;
`tools/strategy-library.cjs` gains `quality`, `refine`, `common`, `ranges`.
**Modified:** `src/library-source.js` (quality gate, derived ranges, quality-targeted identity and training, on-demand heads-up
rivers), `src/strategy-identity.js` (training-policy identity, full-width abstraction), `src/strategy-library.js` (quality in
header and index, refinement replacement with `superseded/`), `src/precompute.js` + worker (quality-targeted and refinement jobs),
`src/shared-strategy-cache.js` (v2 service + synchronous client), `src/study-adapter.js` (validated trainer variants; range-text
limit), `src/full-hand.js` + `tools/pipeline-worker.cjs` (quality / range model / fingerprint per action), `tools/solver-factory.cjs`,
dashboard (`dashboard.html`, `src/strategy-library-view.js`, `src/style.css`, `START.html` rebuilt), `desktop/DesktopHost.cs`
(two read-only routes, six launch tools), Windows scripts (`Test-LongDuration.ps1` new, collector), version 0.31.0 everywhere.
**Defects found and fixed in 0.31 work:** (1) per-combination postflop ranges (≈12,800 characters) were refused by the adapter's
2,000-character limit — found by the 10-table benchmark (14 failed inline trainings); (2) adaptive resume did not load a checkpoint
that already covered the first block — found by a test; (3) a validation-harness error (suit isomorphism translated without the
card permutation) — found because an exact mapping showed loss. (4) **0.30 defect:** `PrecomputeQueue.drain()` never resolved when the
queue was paused with jobs left, so a `--minutes` budget or Ctrl+C could end the process silently without the final status —
found when the first coverage run ended without output; fixed and covered by a test.

## C. Opponent-range modelling
docs/OPPONENT-RANGES.md. Weighted 1,326-combination ranges; exact Bayesian conditioning on the stored preflop strategy
(class-pooled); flop → turn → river continuity using the stored street strategies actually used for the hand (with suit
permutations); card removal; multiway with folded players leaving the live set; provenance on every range; unsupported
combinations kept at their prior and reported; labelled fallback. **Validation:** 15 analytic tests (posterior weights computed by
hand for raise / call / fold, 3- and 4-way, card removal, street conditioning with permutation, invalid/impossible observations,
missing rows, off-tree history, tendency estimates, quantisation round trip, per-combination ranges through the study builder).
**Support measured** (reports/0.31-range-support.json): with the 500,000-update preflop study only **5.0 %** of flops had all live
ranges within the 25 % unsupported limit; with **2,000,000** updates **53.7 %** (heads-up 66 %, 3-way 55 %, 4-way 45 %, 5-way 22 %).
2,000,000 is the 0.31 default. **In the simulator** (10 tables × 30 hands, workload C): of 89 postflop decisions with derived
ranges, 83 used a stored or trained strategy: **38 with preflop-line ranges, 15 with street-conditioned ranges (flop → turn → river
continuity) and 30 with a labelled any-two-cards fallback** (insufficiently supported preflop rows); 0 inline trainings failed
after the fix in section B. The preflop study itself is **not validated**, so every derived range is `derived-approximate-strategy`.

## D. Mathematical accuracy (reports/0.31-math-validation.json; independent evaluation code)
Re-run of the 0.30 validation unchanged: **pass** (evaluator 19,999/19,999 agree; sampled-CI coverage 0.95).
Exact exploitability of EightMax native training, **5 seeds, mean [95 % CI]**, heads-up rivers:

| Game | ref. CFR+ | 20 k | 100 k | 400 k | 1.6 M updates |
|---|---|---|---|---|---|
| narrow ranges, pot 10, stacks 20 | 0.0002 | 0.295 [0.282, 0.307] | 0.130 [0.122, 0.137] | 0.054 [0.048, 0.061] | 0.024 [0.022, 0.027] |
| any-two, pot 6, stacks 24 | 0.0003 | 1.716 [1.644, 1.789] | 0.476 [0.466, 0.487] | 0.180 [0.173, 0.187] | 0.074 [0.072, 0.077] |
| medium/wide, pot 5.5, 2 sizes, 3 bets | 0.0006 | 0.638 [0.620, 0.655] | 0.181 [0.172, 0.190] | 0.078 [0.075, 0.081] | 0.040 [0.039, 0.042] |
| short uneven, pot 8, stacks 6/14 | 0.0001 | 0.500 [0.484, 0.516] | 0.184 [0.179, 0.189] | 0.072 [0.069, 0.074] | 0.034 [0.033, 0.035] |
| polar vs condensed, 3 sizes | 0.0003 | 0.087 [0.075, 0.099] | 0.028 [0.024, 0.032] | 0.016 [0.014, 0.017] | 0.008 [0.006, 0.010] |

Mean exploitability decreases monotonically in every game. Seed-to-seed strategy distance stays 0.12–0.34 (mean L1) even at low
exploitability: equilibrium mixes are not unique, so stability is not used as an accuracy measure.
**Multiplayer (NashConv, 3 seeds):** 3-way 0.568 → 0.266 → 0.094 → 0.038 bb (0.43 % of pot at 400 k); 4-way 1.001 → 0.440 → 0.191 →
0.106 bb (0.89 %). NashConv is not an exploitability and zero would not mean safety against coalitions.
**Trainer variants** (reports/0.31-training-variants.json): the 0.30 variant (MCCFR, standard regret matching, linear averaging) is
best; RM+ and DCFR significantly worse at ≥ 100 k updates in all four games; no variant significantly better. Unchanged.
**Limitations:** only single-street games are evaluated; flop/turn studies and the full eight-handed tournament game are not.

## E. Strategy quality
docs/STRATEGY-QUALITY.md. Default policy `research`: heads-up ≤ 1 % of the pot (exploitability), multiway ≤ 2.5 % (NashConv).
| Situation | 0.30 fixed 20,000 updates | 0.31 quality-targeted |
|---|---|---|
| HU river any-two, pot 6 | 1.72 bb = 28.7 % → **failed** | vector CFR+ 0.029 bb (0.48 %) **validated**, 0.44 s; EightMax 0.053 bb (0.88 %) validated, 2.56 M updates |
| HU river medium ranges | 0.69 bb = 12.5 % → **failed** | CFR+ 0.64 % validated, 0.16 s; EightMax 0.79 % validated, 1.28 M |
| 3-way river | NashConv 0.86 bb = 9.6 % → **failed** | EightMax NashConv validated, 640 k updates, 31 s |
Flop and turn records: **unverified** (cannot be evaluated from a street snapshot). Gate in the simulator (workload D, decision use,
10 tables × 30 hands): **50** strategies refused (all unverified flop/turn records), none silently used. In this simulator the hero
almost never reaches the river with 25 bb stacks, so validated river strategies were rarely needed: the quality gate mostly
demonstrates that the strategies used in short-stack simulated play are not yet verifiable.

## F. Postflop coverage
reports/0.31-coverage.json (`tools/coverage-031.cjs`; 4 tables × 60 hands per seed; training seeds 11/12/13, **unseen seeds
901/902/903**; any-two-cards ranges for comparability with 0.30; 15-minute build budget on 3 worker threads).
Training data: 581 postflop street starts, 184 distinct situations, 40 distinct flop configurations (top four = 8.8 / 8.4 / 5.5 /
5.5 % of flop decisions). Built: 955 studies (473 MB): 848 of the 1,755 canonical flops of the most frequent configuration plus every
turn/river seen, highest frequency first; 35 heads-up rivers validated, 920 flop/turn/multiway records unverified.

| Postflop decisions | total | exact match | abstracted | solved on demand (exact) | unavailable |
|---|---|---|---|---|---|
| In-sample (training seeds, replayed) | 532 | 97 (18.2 %) | 0 | — | 435 |
| **Out-of-sample** (unseen seeds) | 410 | **9 (2.2 %)** | 0 | — | 401 |
| Out-of-sample + on-demand heads-up rivers | 423 | 39 | 0 | 26 | 358 (**15.4 %** with a strategy) |
| — of which heads-up river | 64 | 33 | 0 | 26 | **5** (59/64 covered, all *validated*) |

Reading: exact out-of-sample coverage is **unchanged from 0.30** (2 of 86 = 2.3 %); a stored flop study only helps if the same
preflop line *and* the same canonical flop recur, and turn/river boards almost never recur. In-sample coverage is 18 %, not
100 %, because once stored strategies replace the scripted fallback the replayed hands diverge into new situations. The real
gain is on heads-up rivers: solving them exactly on demand covers 92 % of them with validated strategies (river exact hits in
that run are later decisions on the same street reusing the study solved moments before). No approximate mapping is enabled,
so the abstracted column is 0. Cost to go further: the full catalogue of one 3-player flop configuration is ≈ 1,755 × 1.9 s ≈
56 min single-threaded (≈ 5 min on 16 threads of the i7-13700F); 0.30 found the top 9 configurations cover ≈ 51 % of flop
decisions, i.e. ≈ 8 single-thread hours for half of the flops — while turns and rivers stay uncovered except heads-up rivers.

## G. Strategy precomputation
Quality-targeted and refinement jobs in the persistent queue (worker threads, checkpoints, cancellation, resume) — tests in
tests/quality-031 (queue stores quality; Continue Training refines and only replaces a better record; native checkpoint
continuation resumes from 10,000 to ≥ 20,000 updates). Throughput and storage of the coverage build: coverage build: 955 studies in 903 s on 3 worker threads (≈ 1.1 studies/s; median 3-player flop 1.9 s, heads-up turn 0.42 s,
heads-up river 0.93 s, 3-player river to target 12 s), 473 MB stored, no failed or memory-limited job.
Training cost per study (single thread): heads-up river CFR+ 0.16–0.44 s; heads-up river EightMax to target 2–6 s; 3-way river
to target ≈ 31 s; flop studies at 20,000 updates ≈ 0.5–1 s (0.30). Memory: the JavaScript export budget (256 MiB) limits adaptive
flop studies with any-two-cards ranges at ≈ 160,000 updates — reported as a stop reason, never stored as more than it is.

## H. Shared-cache performance (reports/0.31-shared-cache-benchmark-linux.json)
Same library (lib-E-10, real records), same load (30 ms of CPU work per table cycle, tables spread over min(4, tables) worker
threads, 20 % misses), 20 s per point, every request a real cross-thread fetch:

| Tables | 0.30 host (v1) P50 / P95 / P99 ms | 0.31 service (v2) P50 / P95 / P99 ms | v2 miss P50 | wrong answers |
|---|---|---|---|---|
| 1 | 0.68 / 1.19 / 2.13 | 0.72 / 1.16 / 1.58 | 0.018 | 0 / 0 |
| 2 | 0.57 / 0.96 / 1.17 | 0.63 / 1.09 / 1.44 | 0.016 | 0 / 0 |
| 5 | 0.65 / 30.8 / 31.1 | 0.57 / 1.15 / 3.37 | 0.016 | 0 / 0 |
| 8 | 30.4 / 31.1 / 35.3 | 0.59 / 1.28 / 3.91 | 0.017 | 0 / 0 |
| 10 | 30.6 / 61.0 / 61.8 | 0.52 / 1.20 / 3.95 | 0.013 | 0 / 0 |

Targets (10 / 25 / 50 ms) **met by v2 at every table count**; v1 misses them from 5 tables (its replies wait behind other tables'
work on the same thread). In the complete pipeline (workload A, few fetches per run because workers cache locally): 10 tables
v1 P95 64.7 ms vs v2 2.3 ms; 8 tables 94.4 vs 0.84 ms (0.30 reported 107–126 ms). Identity, checksum, engine and completeness
checks remain in the service; the client re-checks the identity; a timeout is a miss.

## I. Ten-table simulation (reports/0.31-benchmark-linux-simulated.json; 30 hands per table; seeds 4127 and 9001)
Every run is the complete pipeline (render → capture → recognise → reconstruct → decide (+gate) → execute → confirm).
**6,240 complete simulated hands** (v2 and v1 runs), every hand completed; **0 stale decisions, 0 acknowledgement mismatches,
0 duplicate actions, 0 decision timeouts, 0 worker errors.**

| Tables | workload | hands | decisions/s | cycle P50 / P95 / P99 ms | worst-table P95 | postflop: library / trained / unavailable | peak RSS |
|---|---|---|---|---|---|---|---|
| 1 | A cached | 30 | 18.6 | 28 / 44 / 66 | 44 | 0 / 0 / 0 | 1.3 GB |
| 5 | A cached | 150 | 53.3 | 38 / 87 / 138 | 112 | 40 / 0 / 7 | 5.0 GB |
| 8 | A cached | 240 | 77.1 | 62 / 117 / 170 | 119 | 51 / 0 / 7 | 5.1 GB |
| 10 | A cached | 300 | 73.4 | 82 / 157 / 210 | 177 | 76 / 0 / 11 | 4.5 GB |
| 10 | B unseen hands | 300 | 75.2 | 81 / 153 / 204 | 176 | 0 / 0 / 193 | 5.1 GB |
| 10 | C range-aware (build) | 300 | 54.5 | 81 / 198 / 1,531 | 228 | 57 / 26 / 6 | 4.8 GB |
| 10 | C replay | 300 | 76.6 | 81 / 148 / 194 | 168 | 83 / 0 / 6 | 4.5 GB |
| 10 | D quality-gated | 300 | 74.0 | 82 / 157 / 220 | 180 | 0 / 0 / 139 (50 refused by the gate) | 4.9 GB |
| 10 | E active solving | 300 | 54.7 | 84 / 186 / 864 | 224 | 51 / 25 / 11 | 4.7 GB |

0.30 comparison at 10 tables: worst-table P95 221 ms (disk) / 244 ms (pre-loaded) in 0.30; 168–180 ms in 0.31 for the
lookup workloads (same machine class, more hands). **Memory rose**: 4.5–5.1 GB peak at 5–10 tables versus 2.3–2.5 GB in 0.30,
because each of the four workers reads the 2,000,000-update preflop study (670 MB state) needed by derived ranges. It stays well
inside 16 GB but is the main resource cost of 0.31; sharing the preflop study across workers is listed for 1.0. Training (E, C
build) causes multi-second P99 tails; Decision Mode does not train. Sustainable here: 10 tables at ≈ 75 decisions/s with the
library in Decision Mode; CPU 87 % of 4 cores.

## J. Windows reliability
* **Built (cross-compiled on Linux, same toolchain as 0.30):** host `b0cd248c…`, capture `101f4745…`, WGC `1053fd08…`, all x64,
  all embed 0.31.0 and no 0.30.0 string. `desktop/COMPONENT-VERSIONS.json` (generated from evidence): these three are
  *cross-compiled, not executed on Windows*. `mwcli.exe` and `node.exe` are byte-identical to 0.30 and keep their Windows CI
  evidence (mwcli also ran on the target PC with 0.26).
* **Not run on Windows in 0.31.** The session could not push to the user's repository (permission not granted), so the prepared
  Windows CI (`windows-ci/`) did not run. The user's 0.30 target-PC results apply to the 0.30 executables.
* PowerShell scripts parse (PowerShell 7.4 parser); the 0.30 Linux-side Windows tests (Mono builds, PowerShell harness tests,
  PE checks, host equals a fresh Mono build of its source) pass with the 0.31 files.
* Outstanding on the target PC: RUN-RELEASE-ACCEPTANCE.cmd with the rebuilt executables; RUN-LONG-ACCEPTANCE.cmd (ten tables,
  large library, sustained precomputation, continuous WGC capture at 150 % DPI on the RTX 4060 Ti, memory ceiling); GPU training
  is not available in EightMax 5.1.

## K. Regression testing
Final Linux run (`xvfb-run node --test --test-concurrency=4 tests/*.test.cjs`, native CLI, Mono, .NET 8 SDK, PowerShell 7,
Playwright present): **786 tests, 786 pass, 0 fail, 0 cancelled, 0 skipped**, 162 s (`docs/0.31-test-results.txt`). Baseline 0.30
suite in the same container: 734/734 (`reports/0.31-baseline-tests-0.30.txt`). **New tests: 52** — range engine 15
(tests/range-engine-031), quality / exact evaluation / adaptive training / refinement / cancellation / checkpoint continuation /
queue drain 15 (tests/quality-031), decision path, quality gate, on-demand rivers, v2 service concurrency / corruption / timeout,
directory, ten-table pipeline 10 (tests/library-031), abstraction and coverage accounting 6 (tests/abstraction-031), dashboard,
host routes, launchers, Windows scripts, release metadata, real-browser range calculator 6 (tests/release-031). **Removed: none.**
0.30 tests changed only where they assert the current version (wgc-027, wgc-028, windows-025, pwsh/Common.Tests) and in
tests/cpu-checkpoints, whose metadata bound moved from 2,000 to 24,000 characters per range together with the adapter fix.
Measurement runs (not unit tests, every command and output file listed in the reports): 6,240 complete simulated hands across
1–10 tables and seeds 4127 / 9001 (sections H–I), coverage over 6 seeds (section F), 192 native training runs for the variant study,
5-seed convergence curves and multiway NashConv (section D), 210 abstraction reference pairs.

## L. Remaining work toward 1.0 (priority order)
1. Run RUN-RELEASE-ACCEPTANCE and RUN-LONG-ACCEPTANCE on the target PC (or push `windows-ci/` for a hosted Windows run first).
2. Flop/turn accuracy: store or re-derive later-street strategies so flop/turn records can be evaluated exactly (or bounded); until
   then they remain unverified and the decision-use gate refuses them.
3. Preflop study quality: validate or bound the eight-handed preflop strategy (all derived ranges inherit its unverified status) and
   train it further (2 M updates still leaves 46 % of flops with a fallback).
4. Coverage on new hands: turn and river boards almost never repeat; on-demand exact solving covers heads-up rivers only. Needed:
   fast on-demand turn solving, or an abstraction that passes the error limits (none of the board abstractions tested does).
5. Memory: share the preflop study between table workers (≈ 2.5 GB saved at 10 tables).
6. Runtime use of the two accepted approximate mappings (chip scale, 10 % pot bucket) with scaled histories and legality checks.
7. Deeper stacks in simulation (rivers are rarely reached at 25 bb, so validated river strategies are rarely exercised).
8. Full-game exploitability remains unmeasured; nothing here is GTO certification.

## M. Final archive
`EightMax-Test-Workbench-0.31.0.zip` with `SHA256SUMS.txt` (every file) and the ZIP's own `.sha256`.
