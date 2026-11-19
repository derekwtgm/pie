# EightMax Test Workbench 0.32.0 — final development report

Classification: **development build, not 1.0.** Everything below was measured in a Linux development container (Intel Xeon @ 2.10 GHz,
4 logical CPUs, 15 GiB RAM, Node v22.23.5, simulated tables, native EightMax 5.1 `mwcli` built from the bundled source). It is **not**
the target PC (Windows 11 Home, i7-13700F, 16 GB, RTX 4060 Ti 8 GB). **Nothing in 0.32 ran on Windows** (section K). Several long
measurements ran concurrently on the 4 cores; latency figures are therefore upper bounds for this machine (memory and accuracy figures
are not affected). Every number is in a file under `reports/` (named per section); historical 0.31 figures are labelled as such.

## A. Baseline verification
`docs/0.32-baseline-verification.md`. The 0.31.0 ZIP came from the user's repository (`claude/workbench-0.31.0-release`), SHA-256
`fcc6e7af…4f8621e8` = its `.sha256`; `unzip -t` clean; **600/600** manifest entries verify; app 0.31.0; EightMax 5.1 build
`7d08acc7eb4577ee` (a Linux mwcli compiled here prints the same id). **Unmodified 0.31 suite: 786 tests, 780 pass, 0 fail, 6 skipped**
(the six need PowerShell 7, which could not be installed in this session; 0.31 ran them). Reproduced here with the same methods: range
support 5.03 % / 53.66 % (0.31: 5.0 / 53.7 %), coverage recording 184 situations / 40 flop configurations (identical), out-of-sample
exact coverage 2.2 % and 15.4 % with on-demand rivers (identical), 10-table peak RSS 4.46 GB with per-worker preflop readers.

## B. Completed source-code changes
**New modules:** `src/fast-multistreet.js` (exact heads-up multi-street evaluator and CFR+ with chance enumeration),
`src/linked-study.js` (linked flop→turn→river records), `src/preflop-snapshot.js` (shared immutable preflop strategy),
`src/preflop-research.js` (coverage, deviation gains, stability, training modes), `src/approximate-lookup.js` (runtime chip-scale and
pot-bucket mappings), `src/research032-view.js` + `src/research032-ui.js` (dashboard Research panel).
**New tools:** `tools/preflop-research-032.cjs`, `tools/benchmark-032.cjs` (shared preflop, deep stacks, per-street accounting,
workloads F/G), `tools/coverage-032.cjs`, `tools/turn-solver-benchmark-032.cjs`, `tools/abstraction-validation-032.cjs`,
`tools/memory-check-032.cjs`, `tools/research-summary-032.cjs`; launchers `RUN-PREFLOP-RESEARCH.cmd`, `RUN-TURN-SOLVER-CHECK.cmd`,
`RUN-MEMORY-CHECK.cmd`, `REFRESH-RESEARCH-SUMMARY.cmd`, `RUN-032-ACCEPTANCE.cmd`.
**Modified:** `src/strategy-quality.js` (`evaluateLinked`, incomplete continuations never validate), `src/strategy-library.js`
(`putLinked/getLinked/hasLinked` with continuity check; **defect fix**, below), `src/adaptive-training.js` (exact turn CFR+ trainer,
linked evaluation of non-river heads-up studies), `src/library-source.js` (linked storage, on-demand heads-up turns, approximation
policy), `src/precompute.js` + worker (linked records), `src/coverage.js` (Wilson intervals, validated share), `tools/train-study.cjs`
(shared snapshot, continuation from a shorter study, research spec patches), `tools/native-training.cjs` (continuation),
`tools/solver-factory.cjs`, `tools/pipeline-worker.cjs` (fixed deep stacks), `desktop/DesktopHost.cs` (route `/api/research/summary`,
four launch tools), `dashboard.html` / `START.html`, Windows CI driver and workflow, collector, version 0.32.0 everywhere.
**Defects found and fixed:** (1) *0.30 defect:* worker threads opening a NEW strategy library at the same moment failed with ENOENT
because `LIBRARY.json` was written outside the write lock while another thread's recovery deleted temp files — found by the deep-stack
benchmark (3 of 5 runs failed), reproduced with 0.31 code (28 of 240 concurrent opens failed) and fixed (0 of 240; regression test).
(2) A measurement defect in my own first 0.32 coverage run (approximation and turn columns re-used rivers solved by the preceding
column on the same seeds) — those numbers were discarded and re-measured on separate library copies; the tool now isolates columns.
(3) The first seed-stability comparison used `mwcli --compare`, which refuses different seeds (the study id includes the seed); replaced
by a direct snapshot comparison.

## C. Preflop strategy coverage (reports/0.32-preflop-research.json)
Game: 8 seats, 25 bb, SB 0.5 / BB 1 / ante 0.1 per player, chip EV, linked tree to the river. Coverage counts are exact; reach is a
sampled estimate (12,000 deals per study).

| Study | Hand-class coverage (reach-weighted) | Combination coverage | Flop ranges within the 25 % limit (95 % CI) | Training (1 core) |
|---|---|---|---|---|
| seed 8, 500k | 91.2 % | 79.3 % | 5.0 % (2.9–7.2) | 60 s |
| seed 8, 2M | 96.0 % | 89.1 % | 53.7 % (49.1–58.2) | 4 min 56 s |
| seed 108, 500k | 91.1 % | 79.0 % | 8.2 % (5.6–10.8) | 76 s |
| seed 108, 2M | 96.1 % | 89.2 % | 51.4 % (46.9–55.8) | 5 min 57 s |
| explore20 (opponent exploration 0.2), seed 8, 2M | 96.3 % | — | 45.7 % | 6 min 3 s |
| seed 8, continued 2M → 3.80M (memory-limited at an 8 GiB budget) | **97.4 %** | **92.5 %** | **70.7 % (67.0–74.5)** | +8 min |

By position (seed 8, 2M): UTG 98.4 %, UTG+1 97.9 %, MP 97.0 %, HJ 96.4 %, CO 96.1 %, BTN 95.9 %, SB 94.3 %, BB 90.9 % hand-class
coverage; reached states with missing classes: 0/0/0/0/1/2/10/32 (500k: 1/3/1/1/40/103/118/164). Missing branches are listed by reach
in the report. **Findings:** support improves strongly with training (≈ 5 % at 500k → 52–54 % at 2M → 70.7 % at 3.80M; at 3.80M every position has ≥ 94.4 % class coverage and at most 1 reached state with a missing class) and is reproducible across seeds; the extra
exploration variant does not help; own-hand enumeration reached 92.7 % combination coverage after only 5,000 updates but needed 35 s and
a 1.44 GB state for that, so it is impractical. **More training is limited by memory, not time:** the linked study keeps adding postflop
rows — 2M updates = 1.18 GB state / 2.8 GB while training; continuing to 4M stopped at 2.0M with a 4 GiB budget and at 3.80M with an
8 GiB budget (5.0 GB table, 6.5 GB RSS). About 4M updates is the practical limit of this study design on a 16 GB PC. Continuing a study
is bit-identical to training it in one run (tested), so Continue Training never restarts.

## D. Preflop mathematical accuracy
*Not established.* What was measured (all inside the study's abstraction, chip EV):

* **First-in deviation gain per position** (`mwcli --gain method=sampled` at each position's first-in node; best one-shot deviation of
  every hand, later play following the study; **sampled estimate of a lower bound**, 1,000 evaluation samples, 95 % intervals).
  2M updates, seed 8 / seed 108, gain in bb per hand dealt (and per time the node is reached):
  BTN 0.053 [0.027, 0.078] (1.67 bb when reached) / 0.041 [0.014, 0.067] (1.24); CO 0.033 [−0.041, 0.106] / 0.095 [0.012, 0.179];
  SB 0.006 [0.002, 0.010] / 0.008 [0.004, 0.011]; BB 0.003 [0.002, 0.004] / 0.003 [0.002, 0.004]. UTG–HJ intervals include zero at this
  sample size (UTG 0.20 [−0.91, 1.31]) — **not resolved**, not "zero". Conclusion: the 2M strategy is measurably not an equilibrium at
  least at the BTN, SB and BB first-in decisions (both seeds) and the CO (seed 108).
* **3.80M updates (seed 8):** BTN 0.057 [0.007, 0.106] (0.84 bb when reached), SB 0.014 [0.004, 0.025], BB 0.005 [0.002, 0.009]; CO and
  UTG–HJ intervals include zero. The High-Accuracy targets were **not met** (coverage 97.4 % < 99.5 %; the restricted gain needed by the
  target is not computable here), so the study is reported as a High-Accuracy *run*, not a high-accuracy study.
* **Convergence trend:** late-position gains per hand did not fall from 500k to 2M (BTN 0.015 → 0.053, because the BTN node is reached
  more often: 0.9 % → 3.2 % of hands; per reach 1.79 → 1.67 → 0.84 bb at 3.80M). Seed-to-seed distance of the first-in strategies (total variation)
  fell for early positions (UTG 0.29 → 0.20, MP 0.41 → 0.28) but stays 0.2–0.5: the strategies are far from stable.
* **Continuation quality:** 20–35 % (UTG–HJ) to 97 % (SB/BB) of the evaluation's later lookups hit never-visited rows: the postflop part
  of the linked study is sparse, so late-position preflop play is trained against mostly untrained continuations.
* **Restricted best response** over all preflop decisions of a seat (`--verify method=restricted`): not feasible here — 8 seats did not
  finish in 900 s at 2,000 samples (engine time-out, reported as unavailable).
* **Full eight-handed exploitability / NashConv: unavailable** (not computed; never reported as 0). No two-player formula was used.

## E. Flop and turn solving (docs/LINKED-STUDIES.md)
Linked records store every later-street strategy losslessly (per-board sections, lazy, checksummed) and are bound to their street record
by a bit-for-bit continuity check. The exact evaluator equals an independent brute-force enumeration to 1e-9 and the 0.31 river evaluator
on rivers. Evaluating a stored record reproduces the trained study's exploitability exactly (turn 1.5609 bb = 1.5609; flop 2.9057 =
2.9057). **Findings:** a sampled 20,000-update heads-up turn study had 6.5 % of its river rows unvisited and a flop study 96 % — such
records are evaluated but stay **unverified** (they are never promoted). The exact turn CFR+ produces complete continuations and stores
**validated** turn records. Multiway: no independent multi-street evaluator; the native engine's exact best response (engine-internal,
not independent) measured a 3-player turn study at NashConv 60 → 28 → 14 → 7 % of the pot for 20k → 80k → 320k → 1.28M updates
(3 seeds, `reports/0.32-multiway-turn-nashconv.json`) — still above the 2.5 % multiway limit; multiway linked records remain unverified.

## F. Postflop coverage (reports/0.32-coverage.json; same seeds and workload as 0.31; any-two-cards ranges; 15-min build)
Build: 799 studies (0.31: 955 — this build shared the CPU with other jobs), 390 MB, 35 validated heads-up rivers.

| Postflop decisions on hands not used for training | total | exact | approximate | solved on demand | any strategy (95 % CI) |
|---|---|---|---|---|---|
| seeds 901-903, stored strategies only | 410 | 9 (2.2 %) | 0 | — | 2.2 % (1.2–4.1) |
| + validated approximations (opt-in) | 410 | 9 | **0** | — | 2.2 % |
| + on-demand heads-up rivers (0.31 column) | 423 | 39 | 0 | 26 | 15.4 % (12.2–19.1) |
| + on-demand rivers **and turns** + approximations | 421 | 40 | 0 | 25 | 15.4 % (12.3–19.2) |
| new unseen seeds 904-906, stored only | 390 | 6 | 0 | — | 1.5 % (0.7–3.3) |
| new unseen seeds, + on-demand rivers and turns + approximations | 391 | 41 | 0 | 28 | 17.7 % (14.2–21.7) |

Heads-up turns on unseen hands: 13 of 74 (seeds 901-903) and 12 of 59 (904-906) now get a strategy; 59 and 44 on-demand turn solves were
**refused by the quality gate** because any-two-cards turns did not reach the target within the 8 s cap — refused, not used. Exact
coverage did **not** improve over the 2.2 % baseline: the improvement is entirely from exact on-demand solving. Coverage gained per GB
stored: 2.2 % exact for 0.39 GB (no gain over 0.31). The approximations found no proportional or bucketed source in this library (any-two
ranges, 25 bb), so they added nothing here. Missing situations on unseen hands: 369 distinct; ≈ 0.23 single-thread hours to train exactly,
but those exact situations rarely recur.

## G. On-demand solving (reports/0.32-turn-solver-benchmark.json, docs/TURN-SOLVER.md)
Heads-up turn, pot 4 bb, exact turn + every river card, stop at 0.4 % of the pot:

| Range (combos) | 1 size, SPR 1.5 / 4 | 2 sizes (library menu), SPR 1.5 / 4 | memory |
|---|---|---|---|
| narrow (42) | 0.9 s / 0.8 s | 1.8 s / 4.5 s | 0.8–1.9 MB |
| medium (109) | 1.7 s / 1.4 s | 2.7 s / 9.1 s | 2–5 MB |
| wide (216) | 2.0 s / 3.5 s | 7.8 s / 22.3 s | 4–10 MB |

All 12 reached the target (0.31–0.40 % of the pot) and the stored bytes re-evaluated to the same exploitability. Any-two-cards ranges
(1,128 combos) took 0.41 s per iteration on the library menu (30 iterations: 2.9 % of the pot in 12 s); by the iteration counts above,
the 0.4 % target would need roughly 150–200 iterations, i.e. 1–2 minutes (an extrapolation, not measured) — beyond decision deadlines: such turns stay
unavailable in the decision path (on-demand turn solving is opt-in). Heads-up rivers: unchanged from 0.31 (exact, sub-second to a few
seconds).

## H. Abstraction validation (reports/0.32-abstraction-validation.json; 30 new pairs, seed 320)
Approved for opt-in runtime use: **chip-scale** (rivers; p95 EV loss 0.052 % of the pot, max 0.056 %; 0.31: 0.026 %) and
**pot-bucket-10pct** (heads-up rivers before any wager; p95 0.73 %, max 0.78 %; 0.31: 0.46 %) — both within the 1 % limit; the larger
measurement is the stated bound. Rejected (0.31 measurements, not enabled): stack-bucket-2.5 (p95 2.15 %), stack-bucket-5 (2.48 %),
spr-bucket (4.35 %), river-blank-substitution (23.0 %). Runtime checks: proportional stacks to half a chip, mapped wagers legal and ≥ 1 BB,
the source passes the quality gate, every use labelled `library-approximate`; off by default; counted separately from exact coverage.

## I. Memory optimisation (reports/0.32-memory-comparison.json, docs/SHARED-PREFLOP-MEMORY.md)
Identical workload (B, 2M-update study, 4 workers, back-to-back runs), peak RSS: **1 table 1,274 → 474 MB; 2: 2,382 → 670; 5: 4,286 → 955;
8: 4,468 → 937; 10: 4,463 → 938 MB** — 79 % less at 10 tables (≈ 3.5 GB saved; the 0.31 estimate was 2.5 GB). Decisions identical in every
run (hands, decisions, solver/fallback counts; 0 stale, 0 mismatches, 0 duplicates). Memory per added worker ≈ 1,060 MB (0.31 path) vs
≈ 155 MB (shared). Shared strategy memory: one 264 MB snapshot (2M study). Snapshot loading: 0.49 s (cached file; first build ≈ 9 s for
500k). Correctness tests: bit-for-bit equality with the lazy reader on every stored row, SharedArrayBuffer read by several workers without
copying, corruption/identity refusal, crash-and-replace recovery, 5- and 10-worker scaling. Retrieval of postflop records (v2 service) is
unchanged: P50/P95/P99 at 1/2/5/8/10 tables 0.80/1.05/1.33, 0.67/0.92/1.27, 0.52/1.00/4.06, 0.52/1.10/3.88, 0.52/1.07/4.44 ms, misses
0.02–0.04 ms, 0 wrong answers (`reports/0.32-shared-cache-benchmark-linux.json`; a 40-record river library, not 0.31's lib-E-10).

## J. Multi-table performance (reports/0.32-benchmark-ten-table-linux-simulated.json, 0.32-memory-comparison.json, 0.32-deep-stack-simulation.json)
Complete pipeline (render → capture → recognise → reconstruct → decide + gate → execute → confirm), shared preflop snapshot. Ten tables ×
8 hands, seed 4127, every hand completed, **0 stale decisions, 0 acknowledgement mismatches, 0 duplicate actions, 0 decision timeouts, 0
worker errors** in every workload:

| Workload (10 tables) | decisions/s | cycle P50/P95/P99 ms | worst-table P95 | postflop library/trained/unavailable | gate refusals | peak RSS |
|---|---|---|---|---|---|---|
| E active solving | 32.4 | 103 / 300 / 1,994 | 456 | 21 / 11 / 6 | 0 | 1,070 MB |
| A cached | 38.8 | 159 / 372 / 647 | 429 | 32 / 0 / 6 | 0 | 1,006 MB |
| B unseen hands | 38.5 | 154 / 346 / 481 | 394 | 0 / 0 / 47 | 0 | 965 MB |
| C range-aware build | 28.3 | 110 / 366 / 2,553 | 611 | 22 / 9 / 0 | 0 | 1,173 MB |
| C replay | 48.2 | 113 / 276 / 549 | 338 | 31 / 0 / 0 | 0 | 991 MB |
| D quality-gated | 54.2 | 108 / 231 / 323 | 303 | 0 / 0 / 56 | 22 | 1,046 MB |
| G on-demand rivers + turns | 29.3 | 111 / 255 / 961 | 324 | 3 / 0 / 48 (+6 validated on demand) | 3 | 1,532 MB |

1/2/5/8/10 tables (workload B, 10 hands/table): cycle P95 50 / 52 / 128 / 172 / 223 ms, peak RSS 474 / 670 / 955 / 937 / 938 MB. These
runs shared the CPU with long research jobs (load 5–9 on 4 cores), so throughput is lower and tails are longer than 0.31's figures
(0.31: 73–77 decisions/s at 10 tables on an otherwise idle machine); they are not a regression measurement. Memory (unaffected by load):
0.31 reported 4.5–5.1 GB for these workloads; 0.32 0.97–1.53 GB.
**Deep stacks** (workload F, 4 tables × 12 hands, fixed equal stacks, on-demand heads-up rivers/turns): turn / river decisions 80 / 28 at
15 bb, 4 / 4 at 25 bb (preflop study playing: only 12 postflop decisions in 48 hands), 101 / 71 at 40 bb, 153 / 83 at 60 bb, 137 / 98 at
100 bb; validated river strategies used 0 / 0 / 11 / 9 / 13 times; no on-demand turn met the target within 8 s with any-two ranges (gate
refusals 5 / 0 / 6 / 9 / 8 per depth). At depths other than 25 bb the preflop study does not apply and the labelled scripted policy plays preflop, which
makes most pots multiway — counted, not hidden.

## K. Windows compatibility
* **Built (cross-compiled on Linux, Mono 6.8 + .NET 8 SDK):** host `050bfea4…`, capture `8afaf039…`, WGC `a5cefbfa…`, all PE32+ x64,
  embedding 0.32.0 (no 0.31.0 string). `desktop/COMPONENT-VERSIONS.json` (generated from evidence): cross-compiled, **not executed on
  Windows**. `mwcli.exe` and `node.exe` are byte-identical to 0.30/0.31 and keep their Windows CI / target-PC evidence.
* **Not run on Windows.** Hosted Windows CI needs a push to the repository; this session's GitHub token was invalid and attaching the
  repository with push access was refused by the session policy. `windows-ci/` is prepared for 0.32 (adds the shared-memory comparison,
  turn solver and fast preflop study to the 0.31 driver). PowerShell 7 was not available here, so PowerShell parsing tests were skipped
  (6 tests).
* For the target PC: `RUN-RELEASE-ACCEPTANCE.cmd`, `RUN-LONG-ACCEPTANCE.cmd` (ten tables, WGC at 150 % DPI on the RTX 4060 Ti, memory
  ceiling) and the new `RUN-032-ACCEPTANCE.cmd`, then `COLLECT-TEST-RESULTS.cmd`. GPU training is not available in EightMax 5.1.

## L. Regression testing
See `docs/0.32-test-results.txt` (final run, `xvfb-run node --test --test-concurrency=4 tests/*.test.cjs`, native CLI, Mono, .NET 8,
Playwright; no PowerShell): **823 tests: 817 pass, 0 fail, 0 cancelled, 6 skipped** (all six: PowerShell 7 not installed), 3 min 37 s. Baseline 0.31 suite in this container: 786 tests, 780 pass, 0 fail, 6 skipped
(`reports/0.32-baseline-tests-0.31.txt`). **New tests: 37** in tests/multistreet-032 (6), linked-032 (8), approx-032 (5),
preflop-032 (8), release-032 (10). **Removed: none.** Changed 0.31 tests: only the current-version assertions (0.31.0 → 0.32.0) in tests/release-031, wgc-027,
wgc-028, windows-025 and pwsh/Common.Tests, as 0.31 did for 0.30. Coverage of the brief's 30 test items: 1 coverage, 2-3 continuation/determinism, 5 seeds,
22-25 shared memory/crash/corruption/5-10 workers (preflop-032, release-032); 4 deviation-gain evaluation (preflop-032; the restricted
best response itself is infeasible, see D); 7-10 linked storage/continuations/identity, 12 classification, 14-16 turn solving/cancellation/
limits (linked-032, multistreet-032); 11 evaluation correctness (multistreet-032); 13 multiway (quality-031 NashConv + linked-032 multiway
classification); 17 coverage accounting, 26-27 deep stacks and river utilisation, 30 metadata (release-032); 19-21 approximations
(approx-032); 6, 18, 28, 29 by the preserved 0.31 tests (range engine, suit isomorphism, Windows PE/Mono build checks; installer/rollback
tests need PowerShell and were skipped here).

## M. Remaining work toward 1.0 (priority order)
1. Run the Windows acceptance (target PC or hosted CI) for the rebuilt 0.31/0.32 executables; until then they are cross-compiled only.
2. Preflop accuracy: the linked preflop study is memory-bound at ≈ 4M updates on 16 GB and its postflop continuation is mostly untrained.
   Next step: a preflop study whose postflop leaves use a compact evaluator (e.g. equity-realisation terminals or a coarse postflop
   abstraction) so training effort goes to preflop; then evaluate with more deviation samples (early positions are unresolved at 1,000).
3. Flop records: sampled flop studies leave most continuation rows unvisited; needed: exact flop solving for narrow ranges (the evaluator
   exists; full-width flop CFR+ is ~45× a turn) or targeted continuation training.
4. Coverage on new hands: exact coverage is still ≈ 2 %; the practical path is on-demand exact solving with narrower (derived) ranges —
   any-two-cards turns are too slow for decisions.
5. Multiway postflop accuracy: an independent multiway multi-street evaluator (native exact NashConv exists but is engine-internal).
6. ICM preflop studies were not run or verified in 0.32.
7. Full-game exploitability remains unmeasured; nothing here is GTO certification.

## N. Final archive
`EightMax-Test-Workbench-0.32.0.zip` with `SHA256SUMS.txt` (every file) and the ZIP's own `.sha256`.
