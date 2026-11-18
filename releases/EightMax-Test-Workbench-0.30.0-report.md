# EightMax Test Workbench 0.30.0 — final development report

Classification: **development build, not 1.0.** Linux numbers come from the development container (Intel Xeon @ 2.10 GHz,
4 logical CPUs, 16 GB, Node v22.23.5, simulated tables). It is **not** the target PC (Windows 11 Home, i7-13700F, 16 GB,
RTX 4060 Ti). Windows results are listed in section I with their exact source.

## A. Baseline verification (0.29.0)
| Item | Result |
|---|---|
| Archive | `EightMax-Test-Workbench-0.29.0.zip` from branch `claude/workbench-0.29.0-release`; SHA-256 `c9fd0114ed00ecb592e6f3e6d71c3debfef41bd717123f67dbead08c08df5c2b` = its `.sha256`; `unzip -t` clean |
| Manifest | `SHA256SUMS.txt`: **518 of 518** entries verify |
| Version | `src/engine.js` 0.29.0; host/capture/WGC 0.29.0 |
| Solver | EightMax 5.1, build `7d08acc7eb4577ee`; a Linux `mwcli` compiled here from `native/source` prints the same build id |
| Executables | host `2a874b54…`, capture `7079843d…`, WGC `960ed704…`, mwcli `b3e675bf…`, node `247e9693…` — **byte-identical to the files in the 0.29 ci9 candidate that ran on the Windows runner** (so 0.29's `executedOnWindows:false` metadata was out of date) |
| Linux regression, first run | 704 tests: 688 pass, 1 fail, 15 skipped — all caused by missing tools in this container (Mono, .NET SDK, PowerShell, openbox). With the tools installed the 0.29 suite passes as documented (`reports/0.30-baseline-tests-0.29.txt`). |
| Windows CI evidence | Job 135049518078 (run 44374396745) log re-read: Node suite 704 / 679 pass / 0 fail / 25 skipped, capture self-test 8 stages 0 failed, WGC self-test 13 stages 0 failed, collector 153 checks passed. Recorded in `evidence/windows-ci-runs.json`. |
| Reproduced bottleneck | 0.29's benchmark D re-run on this machine with its own tool and settings: **1,557 ms** worst-table P95 decision cycle at 10 tables (0.29 report: 1,529 ms). |

## B. Completed upgrades (modules)
New: `src/strategy-identity.js` (identity, canonical JSON, pure-JS SHA-256, suit isomorphism), `src/strategy-snapshot.js`
(compact bit-exact street snapshot), `src/strategy-library.js` (storage, integrity, recovery, cache, import/export, resource plan),
`src/library-source.js` (lookup-first decision source, decision/deadline/study modes, `trainSpot`), `src/precompute.js` +
`src/precompute-worker.js` (persistent priority queue, checkpoints, throttling, worker threads), `src/shared-strategy-cache.js`
(one SharedArrayBuffer copy for all table threads), `src/exploitability.js` (independent exact evaluation and CFR+),
`src/strategy-library-view.js` + `src/strategy-library-ui.js` (dashboard panel), `tools/strategy-library.cjs`,
`tools/library-benchmark-030.cjs`, `tools/math-validation-030.cjs`, `tools/build-windows-binaries.sh`, six `.cmd` launchers,
`evidence/*.json`, tests `strategy-library-030`, `precompute-030`, `library-ui-030`.
Modified: `tools/solver-factory.cjs` (library option), `tools/pipeline-worker.cjs` (action log), `src/full-hand.js` (per-action
players, stack, strategy source, decision latency), `src/solver-tree.js` (composite keeps the specific unavailable reason),
`desktop/DesktopHost.cs` (`GET /api/library/status`, library launch tools, `strategyLibrary` health flag), dashboard,
`tools/make-components.py` (evidence-based), version 0.30.0 everywhere.
**Defects fixed:** `tools/native-training.cjs` read the native engine's result on the child's `exit` event, which can fire before
stdout is read; under concurrent training 3 of 9 jobs failed with empty output (now `close`; same fix in `video-replay.js`,
`studies.cjs`). The precompute queue file was rewritten several MB per job state change (now debounced, finished jobs stored compactly).

## C. Strategy library
Design: docs/STRATEGY-LIBRARY.md. Exact identity (engine, rules, blinds/ante, street, canonical board, players, every stack
behind, pot, SPR, ranges, action tree, abstraction, training) hashed with SHA-256; lookups compare the whole identity.
Only suit isomorphism (exact) is applied; no bucketing or similarity substitution. Records are immutable, gzip-compressed,
checksummed; writes are temp-file + fsync + atomic rename + locked index update; recovery removes temp files, re-indexes,
rebuilds damaged indexes and quarantines damaged records. Tested (tests/strategy-library-030, 18 tests): exact retrieval after
restart, one-chip/one-card/tree/range/engine/iteration differences are different studies, wrong-fingerprint and forged-identity
records refused, flipped byte → `checksum`, truncation → `truncated`, foreign engine refused, interrupted write before rename
and before index update, damaged index, stale lock takeover, LRU eviction and budget change, bundle import/export with damaged
bundle rejection, four threads reading concurrently, snapshot equals the trained game on every node and row (bitwise).

## D. Precomputation
Jobs from the miss log (priority = observed frequency) or a flop catalogue (all 1,755 canonical flops of one configuration).
Measured here: heads-up flop study (20,000 updates) ≈ 0.5 s, 3-way ≈ 1.1 s train+export single-threaded; 4 concurrent
worker-thread jobs: 24 three-way flops in 22 s. Before worker threads the queue's own thread limited throughput to ~0.5 job/s.
Checkpointed resume is bit-identical to an uninterrupted run; training is deterministic per identity; cancellation of queued and
running jobs, memory/pressure throttling, interrupted-job resume after restart are tested (tests/precompute-030, 9 tests).
Frequency data (900 simulated hands, 3 seeds): 206 distinct missing postflop situations; the top 4 flop configurations are 34 % of
flop decisions, top 9 are 51 %. A catalogue run for the most frequent configuration (3 players, pot 4.3 bb, 23.9 bb each) stored
**699 of 1,755** flops (371 MB on disk) before it was stopped; the second configuration was not started.

## E. Solver coverage (10 tables, 80 hands, seed 4127; reports/0.30-library-benchmark-linux-simulated.json)
| | solver | fallback | share |
|---|---|---|---|
| Preflop | 656 | 27 | 96.1 % |
| Flop | 18 | 1 | 94.7 % |
| Turn | 10 | 0 | 100 % |
| River | 7 | 0 | 100 % |
| Postflop heads-up | 21 | 0 | 100 % |
| Postflop multiway | 14 | 1 | 93.3 % |
| Postflop short / medium / standard stacks | 3/0 · 7/0 · 25/1 | | |

These are Study Mode / replay numbers (the library held or trained each spot). **On unseen hands (seed 9001) postflop coverage
was 0 of 88 with the library from seed 4127 and 2 of 86 with the partial catalogue added** — the honest picture of exact-match
coverage today. Unsupported states: more than 6 live players postflop, players all-in at the street start (side-pot trees),
off-tree bet sizes, stacks below 2 bb, and preflop rows the preflop study never visited (`no-stored-row`, 35 decisions).

## F. Mathematical accuracy (reports/0.30-math-validation.json; independent code in src/exploitability.js)
| Check | Classification | Result |
|---|---|---|
| Independent 7-card evaluator vs EightMax ordering | exact | 19,999 / 19,999 agree |
| Independent CFR+ reference, HU river (TT+,AJs+,KTs+,QJs,AQo+,KQo; pot 10, stacks 20) | exact | exploitability 0.00046 bb after 1,000 iterations; game value 4.7211 bb |
| EightMax native, same game, 5 seeds | exact | exploitability 2.158 → 0.723 → 0.295 → 0.127 → **0.084 bb** at 1k/5k/20k/100k/200k updates (95 % CI at 200k 0.072–0.095); mean decreases monotonically; seed-to-seed strategy L1 0.67 → 0.25 |
| JavaScript reference engine (other implementation) | exact | 1.37 bb at 2k, 0.44 bb at 10k (native 1.41 / 0.44) |
| Snapshot vs trained game | exact | identical values and best responses (tolerance 0) |
| Sampled evaluation | estimated | 38 of 40 95 % intervals contain the exact value (95 %) |
| 3-player river (6 hands each) | exact | NashConv 4.45 → 1.09 → 0.50 → 0.18 bb at 1k/5k/20k/100k — **NashConv, not exploitability**; a zero would still not mean safety against coalitions |
| Stored library records (HU river, any-two-cards ranges, 20,000 updates) | exact | **1.66 bb (20.1 % pot), 1.67 bb (20.2 %), 0.88 bb (3.0 %)** |
The last row is the important limitation: default library studies are far from equilibrium for wide ranges. Turn/flop studies
(chance nodes) and the full 8-player tournament game are **unverified**. Iteration count, coverage and low latency are not used as
evidence of optimality anywhere.

## G. Decision latency (10 tables unless noted)
| Component | p50 | p95 | p99 |
|---|---|---|---|
| Fingerprint | 0.3 ms | 2.4 ms | — |
| Memory-cache lookup | 0.01 ms | 0.02 ms | 0.03 ms |
| Tree walk + validation | 0.23 ms | 1.3–4.5 ms | — |
| Disk load in the table thread (workload D) | 3.0 ms | 10.9 ms | — |
| Shared-host fetch under 10-table load (B / A) | 46 / 30 ms | 107 / 126 ms | — |
| Fresh native training in the path (D / E) | 699 / 1,598 ms | 6,313 / 3,781 ms | — |
Targets (10 / 25 / 50 ms) are met for memory hits and in-thread disk loads; the cross-thread shared host misses the P95/P99
targets under full load (the host thread competes with four busy table workers) — it saves memory, not time.

## H. Multi-table performance (complete pipeline: render → capture → recognise → reconstruct → decide → execute → acknowledge)
Worst-table P95 / P99 decision cycle (ms) and postflop solver decisions; 8 hands per table, 4 workers, seed 4127, 500k preflop:
| Tables | 0.29 D (re-run) P95 | 0.30 D Study | 0.30 B disk | 0.30 A cached | 0.30 C unseen | 0.30 E deadline |
|---|---|---|---|---|---|---|
| 1 | 60 | 63 | 63 | 64 | 64 | 52 |
| 2 | 66 | 68 | 64 | 63 | 54 | 63 |
| 5 | 227 | 179 | 155 | 126 | 161 | 406 (P99 2,131) |
| 8 | 1,459 | 508 | 146 | 154 | 157 | 429 (P99 2,491) |
| 10 | **1,557** | 432 (P99 1,188) | **221** (P99 251) | **244** (P99 260) | 218 | 429 (P99 2,894) |
All runs: all hands completed, 0 stale decisions executed, 0 acknowledgement mismatches, 0 suspended hands, 0 duplicate actions,
0 decision timeouts, 0 worker crashes, chip accounting verified by the settlement check of every hand. Peak process RSS ≈ 2.3–2.5 GB
at 10 tables. Differences to keep in mind: 0.30 uses 20,000 postflop updates and the any-two-cards range (0.29: 8,000, fixed range
plus hero hand). B and A replay the D hands, so they show retrieval cost, not coverage; C shows coverage on new hands.
Deadline mode at a 20 s request deadline trains often and has multi-second tails; it is not suitable for live timing.

## I. Windows reliability
Performed here: host and capture tool rebuilt with Mono 6.8 against .NET Framework 4.8 reference assemblies, WGC helper with
.NET SDK 8.0.134 (`tools/build-windows-binaries.sh`, hashes in `evidence/build-evidence.json`); IL guard, HTTP corpus replay,
capture-session, WinForms and PowerShell 7 tests run under Linux. `desktop/COMPONENT-VERSIONS.json` is generated from evidence:
mwcli.exe and node.exe are unchanged and validated in Windows CI (mwcli also ran on the target PC with 0.26); the three rebuilt
executables are built and cross-compiled only, until a Windows run records their hashes. A Windows CI workflow for this ZIP
(`.github/workflows/workbench-windows.yml`, `workbench-ci/ci.ps1`, adds library catalogue/precompute/verify/export and a 1–2
table library benchmark) is committed with the release; see the delivery note for its outcome. GPU-composited capture, 150 % DPI,
multi-monitor, antivirus and the i7-13700F are **not verified**.

## J. Memory
Snapshot records: heads-up ≈ 0.6 MB raw / 0.1 MB stored, 3-way ≈ 2.4 MB raw / 0.5 MB stored. Shared host at 10 tables held
10.8 MB of strategies once for four workers. Cache budget default 256 MiB with LRU eviction; `planResources` sizes cache and
training jobs from the machine's real totals with reservations for Windows, host, vision and solver workers. The native engine's
own memory is bounded by its budget (512 MiB per library job) and memory-limited runs are never stored.

## K. Regression testing
Final Linux run of the 0.30 suite (Mono, monodis, .NET 8 SDK, PowerShell 7, Xvfb/openbox, Playwright, native CLI all present):
**734 tests, 734 pass, 0 fail, 0 cancelled, 0 skipped** (`docs/0.30-test-results.txt`). The 0.29 suite in the same container: 704/704
(`reports/0.30-baseline-tests-0.29.txt`). New tests: 30 (strategy library 18, precompute/simulator 9, dashboard/host/metadata 3). Removed tests: none. 0.29 tests changed only where they asserted the 0.29.0 version string or the stale
"never executed on Windows" metadata.

## L. Remaining work toward 1.0 (priority order)
1. Run RUN-RELEASE-ACCEPTANCE.cmd on the target PC; fix what it finds (DPI, GPU/WGC, security software).
2. Postflop accuracy: ranges derived from the preflop study instead of any-two-cards; more updates; exploitability gates before a record is marked usable.
3. Coverage on new hands: long precomputation on the target PC, more configurations, and an explicit, labelled approximation layer (stack/pot bucketing) with its own error measurements.
4. Faster shared-host retrieval under load (dedicated thread or direct SharedArrayBuffer index).
5. Exact or bounded evaluation for flop/turn studies and the full game.
6. Windows CI evidence for the rebuilt executables; long Windows soak tests; code signing; FFmpeg decision.

## M. Final archive
`EightMax-Test-Workbench-0.30.0.zip` with `SHA256SUMS.txt` inside and its SHA-256 in `EightMax-Test-Workbench-0.30.0.zip.sha256`.
