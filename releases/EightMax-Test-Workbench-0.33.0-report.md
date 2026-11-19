# EightMax Test Workbench 0.33.0 — final development report

Classification: **development build, not 1.0.** Measurements were taken in a Linux development container (Intel Xeon @ 2.10 GHz,
4 logical CPUs, 15 GiB RAM, Node v22.23.5, native EightMax 5.1 `mwcli` built from the bundled source) unless stated otherwise; Windows
results come from GitHub-hosted Windows Server 2025 runners (no GPU, 1024 x 768 virtual display). **Neither is the target PC**
(Windows 11, i7-13700F, 16 GB, RTX 4060 Ti 8 GB, 3840 x 2160 at 150 %). Several research jobs shared the 4 cores; timings are upper
bounds for this machine; memory and accuracy figures are unaffected. Every number is in a file under `reports/`.

## A. Baseline verification
`docs/0.33-baseline-verification.md`. 0.32.0 ZIP from the user's repository (branch `claude/workbench-0.32.0-release`), SHA-256
`ee21e3af…85bdb3` = its `.sha256`; `unzip -t` clean; **645/645** manifest entries verify; app 0.32.0; EightMax 5.1 build
`7d08acc7eb4577ee`. **Unmodified 0.32 suite here: 823 tests, 802 pass, 0 fail, 21 skipped** (6 PowerShell 7, 15 Mono/.NET — neither
could be installed: the Ubuntu mirror is unreachable from this session). Reproduced: Mode A 2M = 1,176 MB state / 2,864 MiB peak
(0.32: 1.18 GB / 2.8 GB); BTN/SB/BB first-in gains significant; 3-player turn NashConv 60.75 → 7.52 %; 264 MB preflop snapshot.

## B. Source modifications
**New:** `src/preflop-compact.js` (modes A/B/B169/C, compact reader, position coverage, distances, class-keyed snapshot builder),
`src/flop-solver.js` + `src/flop-solver-worker.js` (exact heads-up flop CFR+), `src/independent-eval.js` (independent N-player
evaluator), `src/research033-view.js` + `src/research033-ui.js` (dashboard panel); tools `preflop-modes-033`, `state-anatomy-033`,
`preflop-reach-coverage-033`, `checkdown-calibration-033`, `flop-solver-benchmark-033`, `multiway-validation-033`,
`research-summary-033`; `windows/Build-Executables.ps1`; launchers `RUN-PREFLOP-MODES.cmd`, `RUN-FLOP-SOLVER-CHECK.cmd`,
`RUN-MULTIWAY-VALIDATION.cmd`, `RUN-033-ACCEPTANCE.cmd`; tests `preflop-033` (5), `flop-033` (7), `multiway-033` (8), `release-033` (5).
**Modified:** `src/preflop-snapshot.js` (format version 2: class keys), `src/strategy-quality.js` (independent multiway linked
evaluation), `src/linked-study.js` (stores betting rules), `tools/native-training.cjs` (CRC verification of class-keyed states),
`tools/solver-factory.cjs` (compact snapshots labelled approximate), `tools/benchmark-032.cjs` (`--preflopSnapshotFile`),
`desktop/DesktopHost.cs` (three launch tools, 0.33.0), `dashboard.html`/`START.html`, `tools/build.py`, `windows/Collect-TestResults.ps1`,
version 0.33.0 in launchers, scripts and C# sources; `windows-ci/`, CI workflows (repository).
**Defects found and fixed in 0.33 work:** (1) native-state verification refused the class-keyed layout before checking its checksum;
(2) two memory limits written as `6 << 30` / `8 << 30` overflowed JavaScript's 32-bit shift (refused every flop solve / no limit) —
caught by the first benchmark run; (3) PowerShell argument construction in the Windows build script (`@(a, 'x' + y)` splits) — caught
by the first Windows run; (4) the first compact reader kept every shallow state's class strategies and ran Node out of heap on two
Mode A states — rewritten with typed arrays.

## C. Preflop architecture
`docs/PREFLOP-MODES.md`. Anatomy: at 2M, 51 % of Mode A's rows are postflop and 99.98 % of those are alone in their (state, board)
context. Modes: A (unchanged reference), B (check-down), **B169 (check-down, 169 class keys — lossless for that game)**, C (one flop
round). The EightMax engine is unchanged: modes are game definitions (single-action nodes create no rows).

| 2M updates | Peak RSS | State | EMZ checkpoint | Updates/s |
|---|---|---|---|---|
| A | 2,864 MiB | 1,176 MB | 501 MB | 7,503 |
| B | 1,488 MiB | 605 MB | 301 MB | 8,752 |
| **B169** | **904 MiB** | **310 MB** | **153 MB** | 6,830 |
| C | 2,654 MiB | 891 MB | 411 MB | 8,079 |

B169 continued to 8M (1,415 MiB) and to **10M — the engine's per-study limit — at 1,734 MiB** (603 MB state). Snapshot: 151 MB
(class-keyed, shared) vs 264 MB. Assumption, measured: **check-down misprices position** — against exact flop equilibria (three flops,
research-assumption ranges, BTN open vs BB call) the out-of-position caller realises 68 % and the in-position opener 120 % of the
check-down value; mean error 12.3 % of the pot. B/B169/C are labelled *approximate* everywhere.

## D. Preflop strategy accuracy (each mode inside its own game)
Reach-weighted own-row availability: A@2M 89.3 % (BB 71.9 %), B169@2M 97.7 % (BB 94.8 %), B169@10M 99.6 % (BB 99.15 %). First-in deviation gains (2,000 samples,
lower-bound estimates, 95 %): **A@2M** BTN 0.039 [0.021, 0.058], SB 0.0065 [0.0037, 0.0093], BB 0.0026 [0.0017, 0.0034] — profitable
deviations exist; UTG–CO unresolved. **B169 @ 2M / 8M / 10M**: no position's interval excludes zero (e.g. BTN 0.010 [−0.030, 0.050],
−0.015 [−0.077, 0.047], 0.011 [−0.051, 0.072]); later lookups hitting unvisited rows fall from 2–32 % to 1–24 %. Seed noise (TV) A
0.08–0.18 vs B169 0.10–0.33; A vs B and A vs C indistinguishable from noise at 2M; B169 vs exact-key modes 0.23–0.50 (convergence,
not game difference — B and B169 are the same game). **Full eight-handed exploitability / NashConv: unavailable** (never 0). No
convergence or GTO claim: B169's absence of detected one-shot gains is evidence only about first-in one-decision deviations in an
approximate game.

## E. Flop solver
`docs/FLOP-SOLVER.md`. Seven configurations (46–169 combinations, 1–2 sizes, SPR 2/4): all reached ≤ 0.5 % of the pot (0.275–0.468 %)
in 22 s – 157 s with 67–299 MiB; every linked record complete (0 unvisited rows) and re-evaluated to the solver value; independent
evaluators agree to 1.3e-15; checkpoint resume bit-identical; 2 threads 1.37x (loaded machine). ~6–7x faster per iteration than 0.32.

## F. Linked strategies
`.emlk` format unchanged (version kept); 0.33 adds optional `rules` metadata (older records stay readable). Flop solves produce complete
flop→turn→river continuations; `evaluateLinked` validates them exactly. Sampled studies' incomplete records stay *unverified*.

## G. Multiway evaluation
`docs/MULTIWAY-VALIDATION.md`. Analytic references pass (Kuhn 2-player value −1/18, NashConv 0; Kuhn 3-player passive NashConv 6;
3-player hold'em passive NashConv = 2 x pot). Engine cross-check on the 0.32 three-player turn game: independent NashConv equals the
engine's exact best response to ≤ 2.2e-16 bb at every length (60.750 / 27.662 / 13.725 / 7.519 % of the pot); still above the 2.5 %
limit and incomplete → unverified. NashConv is not an exploitability with three players; no full-game conclusion.

## H. Postflop coverage
`reports/0.33-coverage.json` (raw runs: `0.33-coverage-derived500k-raw.json`, `0.33-coverage-derived-b169-raw.json`). Same seeds (train
11–13, test 901–903 and new unseen 904–906), 4 tables x 60 hands, 3 flop configurations, 15-minute build; only the range model and
preflop source differ. "Validated" = the strategy passed the exact quality check; exact/on-demand/approximate are separate columns;
strategies refused by the gate are counted as refused, never as coverage.

| Workload (unseen hands) | Decisions | Exact | On demand | Any strategy (95 % CI) | **Validated (95 % CI)** | Gate refusals |
|---|---|---|---|---|---|---|
| 0.32: any-two ranges, stored only | 410 | 2.2 % | — | 2.2 % (1.2–4.1) | 0 % | 0 |
| 0.32: any-two, + on-demand rivers/turns + approximations | 421 | 9.5 % | 5.9 % | 15.4 % (12.3–19.2) | 14.0 % (11.0–17.7) | 59 |
| 0.33: derived ranges from the 500k Mode A study | 421 | 9.5 % | 5.9 % | 15.4 % | 14.0 % | 59 |
| 0.33: derived ranges from **B169 @ 2M**, stored only | 1,505 | 5.4 % | — | 5.4 % (4.4–6.6) | 0 % | 0 |
| 0.33: derived ranges from B169 @ 2M, + on-demand + approximations | 1,575 | 17.7 % | 8.8 % | **26.5 %** (24.4–28.8) | **21.4 %** (19.4–23.5) | 321 |
| same, new unseen seeds 904–906 | 1,577 | 19.7 % | 9.6 % | 29.3 % (27.1–31.6) | 23.8 % (21.7–25.9) | 350 |

Findings. (1) With the 500,000-update Mode A study the derived range model found adequate support almost nowhere and used its labelled
any-two fallback (11 of 12 identities stayed any-two), so the result equals 0.32's — range-aware coverage needs a well-supported
preflop study. (2) With B169 (97.7 % own-row availability) derived ranges were used in 11 of the 12 most frequent flop configurations
and validated availability rose from 14–16 % to 21–24 %; the gain comes from heads-up rivers solved on demand with narrower ranges
(135 solves) and from a recurring heads-up flop configuration covered by the flop catalogue (81 exact flop hits, all **unverified**
sampled records — counted as exact availability, not validated). (3) **This is a different workload**: B169's limp-heavy strategy
produces 3.7x more postflop decisions (more multiway and limped pots), the B169-derived ranges are *approximate strategy-derived*, and
heads-up turns are still mostly refused by the gate (321 refusals: turn solves did not reach the target in the 8 s bound). Multiway
flop/turn/river decisions remain unavailable (0 %). Coverage per hour: 1,752 studies in the 15-minute build (446 MB library for the
500k run; see raw files). Exact solving of common heads-up flops (section E) is the next lever but is too slow for the decision path.

## I. Memory performance
Native training: see C (A 2,864 MiB → B169 904 MiB at 2M). Shared strategy RAM: A snapshot 264 MB, B169 151 MB. Checkpoints (EMZ1):
501 → 153 MB. Simulation RAM, 10 tables (workload B): 899 MiB (A snapshot), 865 MiB (B169 snapshot) — the 0.32 shared-memory
architecture is preserved (0.32: 938 MiB). Flop solver: 67–299 MiB per solve. GPU: the engine's measured scoring share is 0.3–0.4 % of
preflop training (`gpuStageBound`), so GPU offload could save at most 0.4 %; no GPU code was added; CPU-only operation unchanged.

## J. Ten-table performance
`reports/0.33-benchmark-ten-table-linux-simulated.json` (workload B, unseen seed, shared preflop, 10 hands/table, 4 workers):

| Tables | A: decisions/s · cycle P50/P95/P99 ms · peak RSS | B169: decisions/s · P50/P95/P99 · RSS |
|---|---|---|
| 1 | 17.4 · 33/51/114 · 469 MiB | 20.9 · 32/55/58 · 502 MiB |
| 2 | 36.6 · 28/50/95 · 604 MiB | 40.0 · 31/52/89 · 717 MiB |
| 5 | 48.6 · 43/115/189 · 888 MiB | 68.6 · 38/79/133 · 813 MiB |
| 8 | 74.9 · 64/126/233 · 880 MiB | 88.0 · 60/114/194 · 816 MiB |
| 10 | 73.5 · 87/156/219 · 899 MiB | 75.0 · 85/166/215 · 865 MiB |

Every hand completed; **0 stale decisions, 0 acknowledgement mismatches, 0 duplicate actions, 0 timeouts, 0 worker errors** in both.
The postflop library was empty in this workload (postflop decisions unavailable → labelled scripted policy); the B169 strategy limps
far more, so 238 vs 61 postflop decisions occurred in 100 hands.

## K. Windows compatibility
Executed on GitHub-hosted **Windows Server 2025** runners (no GPU, 1024 x 768 virtual display at 100 %) — not the target PC. Logs and
outputs: branch `claude/workbench-0.33.0-ci-results`; facts in `evidence/windows-ci-runs.json`, copies in `evidence/windows-ci-0.33/`.
* **Build stage, run 44531610774:** `EightMaxWorkbench.exe` and `EightMaxCapture.exe` compiled on Windows with the .NET Framework C#
  compiler 4.8.9221, `EightMaxWgc.exe` with the .NET 8 SDK; all report 0.33.0; capture self-test 8/8, WGC self-test 13/13 PASS. These
  exact files ship (`evidence/build-evidence.json`; `crossCompiled: false`). Two earlier build runs failed on my script errors (fixed).
* **Validation stage, run 44575197928**, candidate ZIP `ecfd20e4…b95596` (checksum MATCH): **release acceptance 81/81 PASS**
  (integrity, PowerShell parsing of every script, executable versions, capture and WGC, desktop host: health, consent, refusals, host
  capture, native jobs, cancellation/resume, history, graceful shutdown, no leftover processes; install, uninstall, rollback).
  **Node suite on Windows: 848 tests, 822 pass, 0 fail, 26 skipped** (Mono 13, FFmpeg 6, Playwright 4, Linux-only stubs 3; the
  PowerShell and .NET tests that are skipped on Linux ran here). 0.33 tools on Windows: preflop modes A/B/B169 (state sizes identical to
  Linux), flop solver (3 boards, 0.28–0.38 % of the pot), multiway cross-check (60.750 %), state anatomy, research summary — all exit 0.
* **Not passed on the candidate:** (1) `strategy-library ranges` exit 1 — `EPERM mkdir 'C:\\'` because the CI library lives at a drive
  root. (2) `Test-LongDuration -Quick` exit 1 while its report said "passed" (pre-existing reporting defect: a stage threw and the report
  listed only finished checks).
* **Second validation, run 44581998216** (pre-final ZIP `c8a6f312…`): release acceptance PASS, Node suite again 848 / 822 / 0 / 26.
  The reporting fix worked — the long-duration report now **fails** and names the cause: a pre-existing `Substring` length error in the
  stage-5 quality check (output was trimmed, then cut with the untrimmed length). `ranges` exited 1 again with "Unknown command" — a
  regression from my own first fix (a `//` comment cut the rest of a one-line handler). Both are fixed in the final ZIP; `ranges` is now
  covered by a test that runs the command end to end (it passed here). **The final ZIP's fixes to these two scripts have not yet run on
  Windows**: a third validation run was started on the final ZIP (see the repository report).
* The final ZIP's executables are identical (same SHA-256) to those validated in both runs.
* **Target-PC checks not run** (cannot be on hosted runners): 3840 x 2160 at 150 %, RTX 4060 Ti, long-duration capture, ten-table memory
  pressure on 16 GB, sustained solver load, worker recovery under load → `RUN-033-ACCEPTANCE.cmd`, `RUN-LONG-ACCEPTANCE.cmd`,
  `RUN-RELEASE-ACCEPTANCE.cmd`, then `COLLECT-TEST-RESULTS.cmd`.

## L. Regression testing
`docs/0.33-test-results.txt` (final run, `xvfb-run node --test --test-concurrency=4 tests/*.test.cjs`, native CLI, Playwright; no Mono, .NET
or PowerShell here): **848 tests: 827 pass, 0 fail, 0 cancelled, 21 skipped** (6 PowerShell 7, 15 Mono/.NET SDK — the same 21 as the
unmodified 0.32 baseline in this container: 823 / 802 / 0 / 21, `reports/0.33-baseline-tests-0.32.txt`), 258 s. **New tests: 26** in
tests/preflop-033 (5), flop-033 (7), multiway-033 (8), release-033 (6; the `ranges` end-to-end test was added after this run and passed on its own). **Removed: none.** Changed older tests only where they assert
the current version (release-031, release-032, wgc-027, wgc-028, windows-025, pwsh/Common.Tests), the Windows-execution status (now
evidence-based, release-032) and the compiler description (netfx-029: Linux cross-build → Windows .NET Framework compiler). The
Windows validation stage runs the whole suite on Windows with the bundled Node runtime and PowerShell (section K). Coverage of the
brief's 30 items: 1–2, 7–8 preflop-033 (modes, reference vs compact, sparse/compact keys, budget); 3–5 preflop-033 + reports; 6
preflop-033 (continuation bit-identity, keyed layout); 9–13 flop-033 (CFR+, chance enumeration, continuity, linked serialisation,
complete continuation); 14–17 multiway-033 + flop-033 (terminal utilities, side pots, independent heads-up and 3-player best response,
NashConv vs engine); 18 flop-033/multiway-033 (gate); 19–20 0.32 tests (coverage, abstractions) + reports; 21 preflop-033 (shared
class snapshot) + 0.32 shared-memory tests; 22–24 0.32 tests + reports/0.33-benchmark-ten-table; 25–28 Windows CI (section K); 29–30
release-033 (manifest, metadata).

## M. Remaining work toward 1.0 (priority order)
1. Run the 0.33 acceptance on the target PC (RUN-RELEASE-ACCEPTANCE, RUN-LONG-ACCEPTANCE, RUN-033-ACCEPTANCE): 4K at 150 %, RTX 4060 Ti,
   long capture, ten-table memory pressure — hosted runners cannot test these.
2. A preflop continuation that is both compact **and** strategically calibrated (e.g. position-dependent realisation fitted to exact
   flop solves across lines and stack depths), then compare against Mode A at equal memory; B/B169 are approximate by construction.
3. Mode A convergence remains memory- and sampling-limited (exact-hand rows); a native postflop-free linked study with a solved
   continuation table would need engine changes (EightMax 6).
4. Exact flop solves for precomputation of common heads-up spots with derived ranges (storage ≈ 30–125 MB per flop record; needs a
   compact linked format or quantisation, with measured error).
5. Multiway: the three-player study needs far more training (7.5 % > 2.5 %); independent evaluation of larger multiway games needs a
   vectorised evaluator.
6. Full eight-handed exploitability remains unmeasured; ICM preflop studies were not run in 0.33.

## N. Final archive
`EightMax-Test-Workbench-0.33.0.zip` with `SHA256SUMS.txt` (every file) and the ZIP's own `.sha256`.
