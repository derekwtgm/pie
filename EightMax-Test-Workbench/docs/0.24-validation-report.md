# EightMax Test Workbench 0.24.0 — software validation report

Generated from the measurements in this release (docs/0.24-*.json). Environment: Linux container, 4 logical Xeon CPUs @ 2.1 GHz, 16 GB, Node v22, no GPU, **no Windows, no PowerShell, no external poker client**.
All table results are SIMULATED controlled tables. Nothing here is a Windows result, a real-client result or a GPU result. Version 1.0 is not claimed.

## A. Baseline verification
* `EightMax-Test-Workbench-0.23.0.zip` extracted (300 files); SHA-256 manifest: **299 / 299 entries verified**.
* Engine identity: EightMax 5.1, build 7d08acc7eb4577ee (12 vendor libraries + provenance; `native/mwcli.exe` PE32+ x64). Unchanged in 0.24.0 (test-enforced).
* Native source (`mw.cpp`, `json.c`, `mwcli.cpp`) compiled on Linux (g++ 13, C++20, `-ffp-contract=off`): succeeded.
* Baseline tests: **440 run; 440 pass with the Linux native CLI; 422 pass + 18 skipped without it** (skips need the native CLI). (The brief said 439.)
* Existing ten-table benchmark re-run on the 0.24 tree: 10 tables / 1,000 hands, 0 crashes, 0 deadline misses, ~99.4 % of actions from stored solver strategy (precomputed lookups, structured feed).
* Previous study data and checkpoint formats are untouched; their tests (workspace 0.10/0.11 compatibility, multitable checkpoint, CPU checkpoints) still pass. Details: docs/0.24-baseline-verification.md.
* Baseline gaps found: no screen capture; vision only synthetic and hero-at-seat-0; no history from screens; push/fold-only solver mapping; no acknowledgement from an independent reading; single-thread cooperative scheduling.

## B. Implemented functionality (all in the archive)
Screen capture pipeline + Windows capture service + stand-alone capture tool + acceptance script; vision v2 (hand id, all-in, controls, call/min-raise, hero views, split card reader, labelled calibration, stability gate, consensus, metrics);
independent hand-rules ledger; frame-to-frame reconstruction with ambiguity rejection, configurable stakes and restart; solver mapping (linked preflop, on-demand flop/turn/river, strict node validation, EV, pooling);
executor upgrades (bet/raise, labelled scripted path, acknowledgement, latency); Authorized QA protocol client + reference test server; one-table pipeline; worker-thread solver pool; dashboard panel; reproducible scenario / stress / benchmark / recognition tools;
documentation and Windows acceptance steps. See docs/CHANGELOG.md.
**Not implemented:** Windows Graphics Capture; GPU; vision on worker threads; real-client adapters (none will be accepted without authorization).

## C. Screen recognition
| Domain | Frames | Result |
| --- | --- | --- |
| synthetic renderer | 1503 (7 conditions) | 0 false acceptances; 100 % of accepted frames exactly right; clean / ±12 noise / calibrated 125 % and 150 % DPI: 100 % accepted; mismatched-scale templates and noise ≥ ±40: 100 % rejected |
| Chromium-rendered controlled client (real rasterisation) | 688 (dpr 1, 1.25, 1.5, 2; held-out play) | 0 false acceptances; accepted-state accuracy 100 %; 1 frame (0.15 %) rejected as unreadable |
| real external client | **0** | **not measured** |
Categories (card, stack, bet, pot, seat, action) are scored separately in docs/RECOGNITION-ACCURACY.md. The shipped PNG fixtures are not poker tables and are rejected cleanly.

## D. Solver integration
* Engine: **EightMax 5.1 build 7d08acc7eb4577ee** (no newer engine supplied; version negotiation unchanged; unknown builds refused).
* Supported decisions: preflop push/fold (0.21), **linked preflop tree** (fold/call/open 2.2 bb/raise/all-in; 8 × 25 BB, SB 0.5/BB 1/ante 0.1), **flop/turn/river** studies built on demand from the reconstructed state (2–6 live players; sizes from the configured tree).
* Mapping checks (tested): history walks the tree size by size; acting seat; pot; every seat's chips behind and live flag; legality of every menu entry; hero hand stored. Failures return `unavailable` with the reason (tests: off-menu size, pot/stack/actor mismatch, more than six live players, all-in at street start, preflop request, missing legal description).
* Quality fields: engine/build/backend, training updates, convergence `unproven`, `certification:'none'`, assumptions (opponent ranges are an assumed model), warnings, sampled per-action EV when exposed, result age (`builtAt`), cache identity.
* Unsupported: observed ranges, side-pot trees with an all-in player at street start, > 6 live postflop players, unequal-stack preflop trees, GPU. The 8-seat linked preflop tree hit the engine's strategy budget at ~146 k updates; the shipped study uses 100 k and has unvisited nodes (reported unavailable).

## E. Automated execution (one table, pixels only)
* **Scenario** (docs/0.24-full-hand-scenario.json): 30 complete hands, 255 EightMax actions + 33 labelled scripted fallbacks (88.5 % solver), by street: {"preflop/solver": 226, "preflop/scripted": 32, "flop/solver": 15, "turn/solver": 8, "turn/scripted": 1, "river/solver": 6}; 0 rejected frames, 0 acknowledgement mismatches, chips conserved, independent replay audit identical.
* **Stress P1** (docs/0.24-stress-report.json): **1000 complete hands** from pixels, random stacks 2.1–90 BB, 19,659 acknowledged actions, 0 suspended hands, 0 rejected frames, 0 duplicates, 0 stale decisions (207 s on 4 worker threads; scripted decisions isolate the capture/recognition/state/execution path).
* **Stress P2**: 48 hands with EightMax decisions: 385 solver + 62 scripted actions; attribution {"preflop/solver": 365, "preflop/scripted": 54, "flop/scripted": 8, "flop/solver": 17, "turn/solver": 3}; 0 suspended.
* **Stress P3** (structured feed, lookups): 10 tables × 100 hands = 1000 hands, 7910 solver / 64 fallback actions, 0 crashes; injected worker crash recovered, corrupt table and stalled solver isolated, garbage observation paused and recovered, healthy tables unaffected; checkpoint restart identical.
* **Stress P4**: ledger vs simulator on 4000 random hands / 44,607 actions / 19,483 all-in actions / 3,920 multiway showdowns: 0 mismatches.
* Authorized QA mode: complete hands executed over real HTTP against the reference test client (solver decisions only; scripted refused); idempotency, stale revision, wrong hand, dropped acknowledgement and bad token tested.
* **Non-solver fallbacks are never hidden**: every action carries `source` (`solver` / `scripted`), counts are kept in the executor and the report, and scripted actions are refused in QA mode. Postflop is **not** fully solver-driven: see the attribution above.

## F. Multi-table performance (simulated; this machine only)
**Lookup benchmark** (structured feed, precomputed lookups, one thread; NOT the image path) — docs/0.24-benchmark-lookup-linux-simulated.json, 40 hands per table, 500 k-update push/fold study:
| Tables | Hands | Wall ms | Hands/s | End-to-end p50 / p95 / p99 ms | Solver p95 ms | Deadline misses | Solver share | Peak RSS MB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 40 | 689 | 58 | 0.12 / 8.2 / 12.3 | 8 | 0 | 99.4 % | 209 |
| 2 | 80 | 341 | 234 | 0.14 / 5.3 / 6.3 | 5 | 0 | 99.7 % | 206 |
| 5 | 200 | 486 | 412 | 0.22 / 6.2 / 7.7 | 6 | 0 | 99.6 % | 225 |
| 8 | 320 | 382 | 838 | 0.38 / 2.7 / 7.7 | 3 | 0 | 99.5 % | 248 |
| 10 | 400 | 452 | 885 | 0.47 / 3.8 / 8.6 | 4 | 0 | 99.4 % | 266 |

**Pipeline benchmark** (every decision: render → capture → recognise → reconstruct → execute → acknowledge; scripted decisions; 4 hands per table) — docs/0.24-benchmark-pipeline-linux-simulated.json:
| Tables | Hands (1 thread) | Wall ms | Hands/s | Cycle p50 / p95 ms | Workers | Wall ms | Hands/s | Speed-up | CPU cores busy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 4 | 3452 | 1.16 | 42 / 49 | 1 | 3476 | 1.15 | x0.99 | 1.0 |
| 2 | 8 | 6437 | 1.24 | 81 / 102 | 2 | 3564 | 2.24 | x1.81 | 4.0 |
| 5 | 20 | 15758 | 1.27 | 202 / 257 | 4 | 7163 | 2.79 | x2.20 | 7.7 |
| 8 | 32 | 26106 | 1.23 | 325 / 387 | 4 | 7574 | 4.23 | x3.45 | 14.0 |
| 10 | 40 | 32866 | 1.22 | 407 / 483 | 4 | 11563 | 3.46 | x2.84 | 10.4 |
All runs: 0 suspended hands, 0 rejected frames, 0 acknowledgement mismatches, 0 worker failures, 0 deadline misses recorded by the executor.

**Actual solving benchmark** (16 postflop requests taken from real hands; separate from lookups):
| Mode | Updates | Requests | Wall ms | Latency p95 ms |
| --- | --- | --- | --- | --- |
| jsReferenceInThread | 2500 | 16 | 3504 | 3504 |
| nativeCliAsyncInThread | 20000 | 16 | 5048 | 4936 |
| jsReferenceWorkerThreads1 | 2500 | 16 | 3479 | 3479 |
| jsReferenceWorkerThreads2 | 2500 | 16 | 2265 | 2265 |
| jsReferenceWorkerThreads4 | 2500 | 16 | 1832 | 1832 |
Reading: a one-thread solver blocks the thread while it trains; the worker-thread pool overlaps requests (up to ~1.9× on 4 threads here) and can kill runaway or stale jobs, which the cooperative scheduler cannot.
Resource use and worker failures: peak RSS and CPU in the JSON files; worker failures in the benchmark runs: 0; deliberate failures (runaway, crash, stale) are exercised in tests/solver-pool.test.cjs and are isolated.
**Not measured:** Windows timing, real-client latency, GPU utilisation / VRAM, the target i7 + RTX 4060 Ti machine.

## G. Windows readiness
| Item | Compiled | Ran on Windows | Status |
| --- | --- | --- | --- |
| `desktop/DesktopHost.cs` + `CaptureService.cs` → `desktop/bin/EightMaxWorkbench.exe` (x64 PE32+, GUI) | yes (Mono 6.8) | **no** | unverified |
| `desktop/capture/EightMaxCapture.cs` → `desktop/bin/EightMaxCapture.exe` (x64 PE32+, console) | yes | **no** | unverified |
| `native/mwcli.exe`, EightMax engine | prebuilt, unchanged | **no** | unverified |
| `windows/*.ps1`, `*.cmd` launchers, installer, rollback, `Test-Capture.ps1` | n/a | **no** | structural lint only; PowerShell not available to parse |
| Screen capture (PrintWindow / BitBlt / DWM) | yes | **no** | unverified; Windows Graphics Capture not implemented |
A cross-compiled or Mono-built executable has not been tested on Windows. The ordered acceptance checklist is docs/WINDOWS-ACCEPTANCE.md (steps 1–15); `RUN-CAPTURE-CHECK.cmd` is the capture entry point.

## Test totals (exact)
* **With the Linux native CLI: 542 tests, 542 pass, 0 fail, 0 skipped** (440 baseline + 102 new).
* **Without the native CLI: 542 tests, 523 pass, 0 fail, 19 skipped** — skips are environment-dependent (need `EIGHTMAX_TEST_CLI`), not functional failures; the missing validation is native-engine parity and native postflop training.
* Chromium/Playwright tests ran (browser rendering); Mono `mcs` compile tests ran; PowerShell parsing could not run (not installed).
* Logs: docs/0.24-test-results.txt.

## H. Remaining blockers
**Before authorized external play-money testing:** (1) Windows acceptance run (capture self-test, host routes, installer, DPI/multi-monitor); (2) written authorization from the client's operator and an adapter for its permitted interface;
(3) real authorised screenshots to calibrate and measure recognition (fonts, artwork, animations, overlays) and a stability/consensus policy tuned on them; (4) Windows Graphics Capture for DirectX-rendered windows; (5) observed-range modelling instead of assumed ranges;
(6) denser strategy coverage (the preflop study is partial; ~12 % of actions needed fallbacks) and convergence evidence; (7) a policy for resuming after an ambiguous gap mid-hand (today the table pauses until the next hand).
**Before 1.0:** Windows-validated installer and desktop host, target-hardware capacity (ten tables on the i7 / RTX 4060 Ti), GPU path (none exists), real-client accuracy figures, long-run soak tests on Windows.

## I. Final release
`EightMax-Test-Workbench-0.24.0.zip` (SHA-256 in the accompanying `.sha256` file and in the final message). Contains the updated application, vendor engine 5.1, Windows launchers and compiled binaries, source, tests, reports, benchmarks, documentation, changelog,
`SHA256SUMS.txt` manifest and Windows acceptance instructions.
