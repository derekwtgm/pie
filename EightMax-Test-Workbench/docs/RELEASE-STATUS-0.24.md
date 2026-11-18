# Release status 0.24.0 — what is and is not verified

This is **not Version 1.0**. Built and tested in a Linux container (4 logical Xeon CPUs @ 2.1 GHz, Node v22, Mono 6.8, MinGW, Chromium via Playwright). No Windows machine, no GPU, no
PowerShell, no external poker client were available.

## Verified here (Linux)
| Area | Evidence |
| --- | --- |
| Baseline preserved | all 440 baseline tests still pass (440/440 with the Linux native CLI built from `native/source`) |
| Screen-capture pipeline logic | `tests/screen-capture.test.cjs` (16): sequencing, timestamps, stale/lost/minimised/covered/resized/identity-change detection, recovery, recording, monitor geometry, mock desktop host speaking the C# JSON protocol |
| Image codec | `tests/image-codec.test.cjs` (7): PNG filters, BMP, corruption, shipped PNG fixtures |
| Hand rules | `tests/hand-ledger.test.cjs` (9): ledger vs simulator on 400 variable-stack hands; stress run: 4,000 hands / 44,607 actions / 19,483 all-in actions / 3,920 multiway showdowns, 0 mismatches |
| Hand-state reconstruction from screens | `tests/hand-tracker.test.cjs` (12): history derived over 60 hands equals the oracle's; gaps, ambiguity, missed starts, rule contradictions, side pots, configurable stakes, restart |
| Recognition | `tests/vision-024.test.cjs` (11); docs/RECOGNITION-ACCURACY.md: 0 false acceptances in 1,503 synthetic and 688 Chromium-rendered frames (real-client: not measured) |
| Solver mapping | `tests/solver-tree.test.cjs` (10): history walk, pot/chip/live validation, legality, pooling, unavailability, composite, native postflop training |
| Executor / QA | `tests/executor-024.test.cjs` (8), `tests/full-hand.test.cjs` (14) incl. complete hands over real HTTP in Authorized QA mode |
| Full hands | 1,000 complete hands from pixels with random 2.1–90 BB stacks, 0 suspended / rejected / mis-acknowledged (docs/0.24-stress-report.json); 30-hand EightMax scenario with exact attribution and replay audit (docs/0.24-full-hand-scenario.json) |
| Worker threads | `tests/solver-pool.test.cjs` (8): parallelism, runaway termination, stale kill, crash isolation, three-table isolation |
| Windows artefacts | C# sources compile with Mono (`-platform:x64`); `desktop/bin/*.exe` are x64 PE32+ (GUI host / console tool); no forbidden API used (`tests/windows-release.test.cjs`, 7) |

## NOT verified
* **Anything on Windows**: the capture service, PrintWindow/BitBlt/DWM behaviour on real applications, DPI and multi-monitor behaviour, the host's new routes, `RUN-CAPTURE-CHECK.cmd`, installer, rollback, every PowerShell script
  (PowerShell was not available: scripts were structurally linted only — balanced delimiters — which is not a parse).
* **Windows Graphics Capture** (not implemented). DirectX/GPU-composited windows may capture as flat colour (reported, not read).
* **Any external poker client**: no authorised screenshots, no client interface. Real-client recognition accuracy: not measured.
* **GPU**: no GPU code path exists or was measured. Target-hardware (i7-13th gen / RTX 4060 Ti) performance: not measured.
* **Convergence / equilibrium**: all strategies come from sampled training with `convergence: unproven`; nothing is GTO-certified.

## Solver coverage actually achieved (30-hand scenario, 100 k-update linked preflop study, 20 k-update native postflop studies)
255 of 288 executed actions (88.5 %) came from EightMax studies (226 preflop, 15 flop, 8 turn, 6 river); 33 were labelled scripted fallbacks (32 preflop where the study has no stored row or a
scripted raise left the tree, 1 turn). Postflop opponent ranges are an assumed model. Do not describe this as fully solver-driven play.
