# EightMax Test Workbench 0.29.0 — final development report

Classification: **development build, not 1.0.** Linux numbers are from this development container
(Intel Xeon @ 2.10 GHz, 4 logical CPUs, Node v22.23.5). The Windows results come from GitHub-hosted Windows Server 2025 runners.
Neither is the target PC (Windows 11, i7-13700F, 16 GB, RTX 4060 Ti, 3840×2160 @ 150 %).

## A. Source archive verification
| Archive | SHA-256 | Manifest | Build |
|---|---|---|---|
| 0.26.0 (common ancestor) | `0df33894…3d5646` | 416/416 verify | VERSION 0.26.0 |
| 0.27.0 (repository `derekwtgm/pie`, branch `ccr-fa6d1dec-1dpyhl`, `releases/`) | `abe4d9e3c7fdc9424c97c8b623758e6b98c57e64d377429663d51d58a1b0c3ed` (= its `.sha256`) | 437/437 verify | VERSION 0.27.0 |
| 0.28.0 (built earlier in this work from 0.26) | `1de73b0e366c952e1293ad6d821d1f28c251d86646fa369363be0ae97c2c6692` | 454/454 verify | VERSION 0.28.0 |
| Engine | EightMax 5.1, build fingerprint `7d08acc7eb4577ee` (unchanged; 5.3 evaluated and not adopted, docs/ENGINE-5.3-EVALUATION.md) | | |

The 0.29.0 ZIP has a `SHA256SUMS.txt` covering every file. `desktop/COMPONENT-VERSIONS.json` records each executable's SHA-256,
version resource and compiler, and is generated from the shipped binaries by `tools/make-components.py`.

## B. Consolidation report
This was a three-way git merge: 0.26 as the base, 0.28 as "ours" (the repair baseline) and 0.27 as "theirs".
- 0.27 changed 60 files and 0.28 changed 80. 34 were changed by both, and 33 of those conflicted.
- Each conflict and its resolution is recorded in `docs/CONSOLIDATION-0.29.md`.
- Every file either side added after 0.26 is listed in `docs/CONSOLIDATION-INVENTORY-0.29.json`. `tests/consolidation-029.test.cjs` fails if any of them is lost without a recorded replacement.

Restored from 0.27:
- 2–8 seat image reading and layouts
- `tests/seats-027`, `tests/wgc-027`
- `tools/multitable-benchmark-027.cjs` (benchmark D)
- `docs/SEAT-COUNTS.md`, `ENGINE-5.3-EVALUATION.md`, `RUNTIME-AND-TOOLS.md`, the 0.27 validation report
- 0.27 benchmark-D and multi-seed scenario reports
- `tools/wgc-png-check`, `desktop/wgc/PngWriter.cs`
- the WGC manual-only rule
- Node v22.23.5 and `RUN-TOOL.cmd`

Preserved from 0.28:
- closed-handle capture fix and Expect: 100-continue handling
- structured errors, request log and concurrent request handling
- graceful shutdown
- persistent WGC helper sessions
- memory-pressure handling
- collector and dashboard test-results panel
- critical-acceptance table

Deliberately not carried forward (all documented):
- 0.28's duplicate host `WgcGrab` route
- 0.28's automatic selection of the unverified WGC backend
- 0.28's inline PNG encoder
- `NODE-RUNTIME.txt` (v22.23.4)

Consolidation also exposed and fixed a 0.27 regression: `variableStacks` was called with the hand number as the seat count.

## C. Windows defect repairs
| Defect | Status | Evidence |
|---|---|---|
| Capture self-test closed-handle defect | Fixed (0.28), **passes on Windows** | ci9: `detect-closed` PASS, `target-lost` |
| HTTP Expect: 100-continue | Fixed (0.28), **passes on Windows** | raw probe and Invoke-WebRequest PASS |
| **Initial health request HTTP 400 (unresolved in 0.28)** | **Root cause found and fixed** | Mono's class library let `Split(' ')` bind to `String.Split(char, StringSplitOptions)`, which does not exist in .NET Framework. Every request threw `MissingMethodException`, reported as 400. Seen on Windows (ci1); 0.26, 0.27 and 0.28 all contain the call. Now compiled against the .NET Framework 4.8 reference assemblies, with IL guard test `tests/netfx-029`. The request corpus (`tests/http-029`, `reports/0.29-http-corpus-026-vs-029.json`) also covers proxy absolute-form targets, now accepted for the host's own loopback authority only. |
| Shutdown | **Graceful on Windows** | ci9: shutdown request, process exit, no orphaned host, capture, WGC or mwcli processes |
| Diagnostics | Operational on Windows | collector ran in CI: 5 result files, 153 checks; shipped files excluded |
| Windows-only script defects found by CI | Fixed | hidden first ShowWindow; installer `$uninstall` vs `[switch]$Uninstall`; `-isnot [pscustomobject]`; `File.Replace(...,$null)`; `@(List)`; timeout killing only the parent process; CRLF from `build.py`; PrintWindow deadlock in the test window (docs/WINDOWS-CI.md) |

## D. Screen capture
| Method | Status |
|---|---|
| PrintWindow (default) | Self-test 8/8 on Windows, including resize, minimise, restore and closed-window detection. Host frame of a window owned by another process: 480×300. |
| Screen copy | Offered and unit-tested; not separately exercised on Windows. |
| Windows Graphics Capture (manual choice only) | WGC self-test 13/13 on Windows. **Persistent session through the host**: 4 frames through one session (frameIds 1,1,2,2, with duplicates marked not-fresh). First frame took 393 ms. Close ends the helper, and closing the window gives `target-lost`. Health still reports `windowsGraphicsCaptureVerified=false`, because the target PC (GPU, 150 % DPI, multi-monitor) has not been tested. |

Additional handling:
- Continuous capture on Linux: settling after window move or DPI change, duplicate marking, and an invalid-frame gate (`tests/capture-029`, `screen-capture` tests).
- **Not tested:**
  - 150 % or mixed DPI
  - multiple monitors
  - GPU-accelerated or protected windows
  - real poker clients (deliberately none)
  - FFmpeg recording: not bundled, for licence and size reasons
- WGC capture of a hardware-accelerated window on a real GPU remains unverified.

## E. Computer vision
- **Seat counts:** 2–8 seats with seat-count-aware layouts (`tests/seats-027`). Fewer than 2 or more than 8 is refused (`player-count-unsupported`).
- **Seat states (0.29):** vacant, sitting-out and in-hand are read per position. Departed players come from `SeatTracker`. Inconsistent pictures are rejected (`tests/seat-states-029`).
- **Strategy restriction:** a table with fewer than 8 players never receives an 8-handed strategy.
- **Recognition source:** recognition is measured only on the built-in renderer's pixels (`reports/0.29-stress-report.json`):
  - 1,000 hands at 8 tables with variable stacks
  - 0 rejected frames, 0 acknowledgement mismatches, 0 suspended hands
- **Gaps:** no real-client images, fonts, themes, animations or overlays; recognition of other software is unproven.

## F. Solver integration
EightMax 5.1 (`7d08acc7eb4577ee`), native CPU CLI. Coverage at 1,000,000 preflop updates, 30 hands per seed:

| Seed | Solver actions | Scripted (labelled) | Share | Unavailable reasons |
|---|---|---|---|---|
| 2024 | 253 | 0 | 100 % | — |
| 7 | 282 | 6 | 97.9 % | no-stored-row 5, street-not-covered 1 |
| 99 | 263 | 2 | 99.2 % | no-stored-row 2 |

Pooled: 798/806 = **99.01 %**.

- Unsupported spots are reported as `unavailable` with a reason code, never invented.
- Concurrent requests for a postflop study that is still training now share that run (`stats.coalesced`).
- Each decision carries its table, hand, actor, state revision, fingerprint, legal actions, timestamp and source. Stale or mismatched decisions are rejected (`tests/solver-029`).
- Native studies ran on Windows in ci9: submit, de-duplicate, cancel, resume, history and batches.

## G. Mathematical accuracy
Convergence is **unproven**: the reports say so in their `convergence` fields.
- Exploitability is measured only on the small reference games in the convergence tests.
- Coverage is not accuracy.
- Preflop studies are abstraction-based.
- Postflop studies use 8,000–20,000 iterations.
- No claim of GTO accuracy is made.
- 5.3 was not adopted because its compatibility was not demonstrated.

## H. Multi-table performance (Linux, simulated tables)
**A. Strategy lookup:**

| Tables | Hands | Solver / fallback actions | End-to-end P50 / P95 / P99 (ms) | Peak RSS |
|---|---|---|---|---|
| 1 | 40 | 317 / 2 | 0.12 / 7.98 / 11.0 | 204 MiB |
| 2 | 80 | 637 / 2 | 0.17 / 5.38 / 6.90 | 205 MiB |
| 5 | 200 | 1593 / 6 | 0.24 / 6.53 / 10.7 | 206 MiB |
| 8 | 320 | 2546 / 13 | 0.40 / 2.58 / 7.91 | 224 MiB |
| 10 | 400 | 3180 / 19 | 0.53 / 4.02 / 9.24 | 239 MiB |

All runs: 0 deadline misses, 0 crashes, 0 invalid observations.
Ten-table acceptance: 1,000 hands per seed, 99.4 % solver share, chip accounting exact.

**B. Native solver computation** (16 postflop requests from real simulated hands):

| Configuration | Iterations | Wall time | Latency P50 / P95 |
|---|---|---|---|
| Native CLI, async | 20k | 5.7 s | 1.2 s / 5.7 s |
| JS reference, in-thread | 2.5k | 3.6 s | — |
| JS reference, 1 / 2 / 4 workers | 2.5k | 3.8 / 2.1 / 1.95 s | — |

0 crashes or timeouts. This benchmark varies the worker pool size, not the table count. D covers the solver at 1–10 tables.

**C. Computer vision pipeline** (render → capture → recognise → reconstruct → execute → acknowledge):

| Tables | Worker threads | Decision cycle P50 / worst P95 (ms) |
|---|---|---|
| 1 | 1 | 29 / 39 |
| 2 | 2 | 29 / 42 |
| 5 | 4 | 31 / 99 |
| 8 | 4 | 62 / 100 |
| 10 | 4 | 82 / 132 |

On a single thread, 10 tables take 295 / 370 ms, and at 10 tables workers are 2.8× faster. All runs had 0 acknowledgement mismatches and 0 suspensions. Peak RSS was 619 MiB.

**D. Complete simulation with the real solver in the loop:**

| Tables | Hands | Solver / fallback | Cycle P50 / worst-worker P95 (ms) | Peak RSS |
|---|---|---|---|---|
| 1 | 8 | 65 / 5 | 36 / 57 | 475 MiB |
| 2 | 16 | 132 / 6 | 34 / 66 | 1.1 GiB |
| 5 | 40 | 337 / 22 | 40 / 209 | 2.1 GiB |
| 8 | 64 | 539 / 26 | 80 / 1458 | 2.2 GiB |
| 10 | 80 | 685 / 30 | 118 / 1529 | 2.4 GiB |

All runs had 0 stale decisions and 0 acknowledgement mismatches. 0.27 reported 1607 ms at 10 tables.

**Cause of the ~1.5 s P95:** it is the cost of training fresh postflop studies inside the decision path (0.5–2 s each on this CPU).
- Contention was ruled out: a cross-worker cap on native training did not lower the P95.
- Cross-worker duplication was ruled out: the training log shows distinct spots.
- Repeated requests from the same table now share the training run.
- **Ten concurrent fresh solves within a real-time budget are not demonstrated.** Live use at 8–10 tables needs pre-trained studies.

**Stress (all 10 criteria pass):**
- 1,000 pixel-pipeline hands
- 1,000 ten-table hands, including fault isolation, worker restart and memory pressure

**Target PC estimate:** the 16 GB target leaves roughly 10–12 GB in practice, so benchmark D's 2.4 GiB at 10 tables fits. Training time on an i7-13700F is not measured. No GPU path exists.

## I. Windows readiness
**Performed on Windows** (Server 2025 runner, run 44374396745, candidate ci9). `RUN-RELEASE-ACCEPTANCE` passed **81 of 81 checks, 0 skipped**, with every critical criterion passing. Covered:
- integrity and PowerShell 5.1 parsing
- capture 14/14, WGC self-test 13/13
- desktop host: health, foreign-origin refusal, consent, host capture sessions
- native solver jobs: cancel, resume, history and batches
- graceful shutdown, no orphaned processes
- install and uninstall, with user data (NativeJobs, Logs) preserved after uninstall
- rollback refusal with one installed release (a real rollback between two releases was not exercised)

The Node suite on Windows: 704 tests, 679 pass, 0 fail, 25 skipped (Linux-only compile tests, shell stubs, Playwright).

**Needs the target PC:**
- Windows 11 Home
- 150 % DPI and multiple monitors
- RTX 4060 Ti (GPU windows with WGC)
- third-party antivirus or proxies (relevant to the old HTTP 400)
- i7-13700F performance
- long-running sessions

## J. Application usability
- Extract the ZIP, then run `START-DESKTOP.cmd`.
- One-click `RUN-RELEASE-ACCEPTANCE.cmd` and `COLLECT-TEST-RESULTS.cmd`: the collector writes one ZIP to the Desktop.
- Optional per-user install and uninstall (`Install-Workbench.ps1`), verified on Windows; rollback refusal with one installed release (a real rollback between two releases was not exercised).
- Bundled Node v22.23.5 (checksum verified against nodejs.org).
- The .NET Framework 4.8 host needs no installation on Windows 10/11.
- The WGC helper is a self-contained .NET 8 single file.
- FFmpeg is not bundled.
- The dashboard has the seat-count, capture-method and test-results panels.

## K. Regression testing
Final local run (Linux, full suite, native CLI enabled; complete TAP output in `docs/0.29-test-results.txt`):
**704 tests, 704 pass, 0 fail, 0 cancelled, 0 skipped** (duration 179 s). It includes the Mono, .NET SDK, PowerShell 7, Playwright and native-CLI tests.

On Windows (ci9): 704 tests, 679 pass, 0 fail, 25 skipped. No test was removed: `wgc-026` was replaced by `wgc-028`, as recorded in the inventory.

## L. Remaining Version 1.0 requirements (prioritised)
1. Run `RUN-RELEASE-ACCEPTANCE.cmd` on the target PC and fix what it finds, especially DPI, GPU/WGC and security software.
2. Verify WGC on a GPU-accelerated window before `windowsGraphicsCaptureVerified` may become true.
3. Recognition on real, authorised client images. This needs a platform decision, which is deliberately out of scope.
4. Pre-trained postflop study library so 8–10 tables do not train in the decision path. Measure on the i7-13700F.
5. Convergence and exploitability evidence for the full-size games, not only reference games.
6. Real-time FFmpeg recording, if a licence-compatible build is chosen.
7. A GPU solver path, if ever needed; none exists today.
8. Long-duration soak test (hours) on Windows.
9. Code signing of executables.
10. Evaluate engine 5.3 again once an archive with proven compatibility exists.

## M. Final release
`EightMax-Test-Workbench-0.29.0.zip`. Its SHA-256 is in `EightMax-Test-Workbench-0.29.0.zip.sha256`, next to the ZIP.
