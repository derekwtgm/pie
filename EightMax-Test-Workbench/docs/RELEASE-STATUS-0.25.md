# Release status 0.25.0 — what is and is not verified

This is **not Version 1.0**. Built and tested in a Linux container (4 logical Xeon CPUs @ 2.1 GHz, Node v22, Mono 6.8, Chromium via Playwright). No Windows machine, no GPU, no PowerShell, no external poker client were available.

## Verified here (Linux)
| Area | Evidence |
| --- | --- |
| Baseline preserved | all 542 tests of 0.24.0 still pass; 594 / 594 with the Linux native CLI (52 new), 575 pass + 19 skipped (need the native CLI) / 0 fail without it — docs/0.25-test-results.txt |
| Resource accounting | `tests/resource-monitor.test.cjs` (11): double-counted CPU/RSS, impossible utilisation, negative elapsed, invalid, stale, missing worker data, real 6-thread run, scheduler integration; corrected benchmark: 2 workers now report 1.6 cores (0.24: 4.0) |
| Platform profiles | `tests/platform-profile.test.cjs` (8): schema validation, checksum round trip, tamper detection, region editing, template, store, profile drives the observer |
| Capture manager | `tests/capture-manager.test.cjs` (11): catalogue honesty, backend selection/fallback/switching, window identity, bounded queue, health, observation gate, structured feed |
| Calibration | `tests/calibration.test.cjs` (6): advisory detection, learning, held-out evaluation, **unseen layout**, resolutions, export/import, preview; `reports/0.25-recognition-calibration.json` (878 frames, 0 false acceptances) |
| Solver coverage | `tests/solver-coverage-025.test.cjs` (5): strict vs translated off-tree wagers, bounds, decision record fields, unavailable classification, on-tree fallback |
| Adapters | `tests/execution-adapters.test.cjs` (6): contract, profile-selected adapters, UI-automation adapter (**mock driver only**), acknowledgment outcomes, diagnostics |
| Dashboard | `tests/platform-ui.test.cjs`: Chromium drives capture, calibration (edit / learn / preview / refused edit), simulation run, solver, performance tabs with no page errors |
| Full hands | `reports/0.25-stress-report.json` and `-solver240.json`: 1,000 complete hands from pixels (variable 2.1–90 BB stacks, 0 suspended / rejected / mis-acknowledged); 240 complete hands from pixels with EightMax decisions; ten tables × 100 hands (1,000 hands, structured feed, lookups); 4,000-hand rules differential (44,607 actions, 0 mismatches) |
| Acceptance | `reports/0.25-acceptance-linux-simulated.json`: 19 / 19 criteria (three seeds, fault isolation, emergency stop, checkpoint restart) |
| Windows artefacts | host and capture tool rebuilt with Mono for 0.25.0 (x64 PE32+); sources compile; PE metadata and banned-API source scan pass — compilation/cross-compilation only |

## NOT verified
* **Anything on Windows**: host, capture service (PrintWindow/BitBlt/DWM on real windows), DPI and multi-monitor behaviour, installer, rollback, uninstall, launchers, `Test-Release.ps1`. **No PowerShell script was parsed or run** (only the structural lint).
* **Windows Graphics Capture** (not implemented).
* **Any external poker client or site** — none chosen, inspected or authorised. Real-client recognition accuracy: not measured. The UI-automation adapter has only run against a mock driver.
* **GPU**: no GPU code path; target-hardware performance (i7 13th gen, 16 GB, RTX 4060 Ti) not measured.
* **Convergence / equilibrium**: all strategies are sampled; `convergence: unproven`; nothing is GTO-certified.

## Solver coverage actually achieved (EightMax 5.1; linked preflop 100,000 updates + 20,000-update on-demand postflop studies)
| Run | Hands | Solver actions | Scripted fallbacks | Solver share |
| --- | --- | --- | --- | --- |
| 0.24.0, seed 2024 (baseline) | 30 | 255 | 33 | 88.5 % |
| 0.25.0, seed 2024 | 30 | 256 | 28 | 90.1 % |
| 0.25.0, seeds 2024 / 7 / 99 combined | 90 | 768 | 94 | 89.1 % |
| 0.25.0, pixel pipeline, 240 hands (stress, 4 tables) | 240 | 2,045 | 243 | 89.4 % |
Every remaining fallback is `no-stored-row` (sampled training never visited that information set) except 3 in seed 99. The gain from 0.24 is small: it comes from keeping fallbacks on the tree (the 0.24 off-tree cascades are gone). Further coverage needs more training than the adapter's 256 MiB strategy cap allows at this tree size — see docs/0.25-validation-report.md (E).
