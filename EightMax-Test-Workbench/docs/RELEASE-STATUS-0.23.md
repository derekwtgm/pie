# Release status 0.23.0 — what is and is not verified

This is **not Version 1.0**. The 1.0 gate ("Windows-validated, installer-tested, real ten-table
capacity on the target PC") could not be met from the build environment (Linux container, no Windows
machine, no GPU). Nothing below is reported as working on Windows.

Levels: **I** implemented · **U** unit-tested · **X** integration-tested (real modules, real EightMax 5.1
strategy data, simulated tables) · **B** run in a real browser (Playwright Chromium, Linux) ·
**W** Windows-validated · **R** release-ready.

| Capability | I | U | X | B | W | R | Notes |
| --- | - | - | - | - | - | - | --- |
| Eight-handed simulator, side pots, settlement (0.18 baseline) | ✔ | ✔ | ✔ | – | – | – | 367 baseline tests still pass |
| Hand-state reconstruction + rejection (`hand-state.js`) | ✔ | ✔ | ✔ | ✔ | – | – | structured feed and synthetic screenshots |
| Glyph OCR / layout profiles / image observer (`vision-ocr.js`) | ✔ | ✔ | ✔ | – | – | – | **synthetic renderings only**; no real client screenshots tested |
| Solver adapter: identity, negotiation, request validation | ✔ | ✔ | ✔ | ✔ | – | – | one engine (5.1); a newer engine was not supplied |
| Study decision source (8-seat 25 BB preflop push/fold) | ✔ | ✔ | ✔ | ✔ | – | – | the only verified state→solver mapping |
| Bounded queue, cache, timeout, cancel, stale discard | ✔ | ✔ | ✔ | ✔ | – | – | cooperative single thread |
| Test executor: Study / Simulation modes | ✔ | ✔ | ✔ | ✔ | – | – | |
| Test executor: Authorized QA mode | ✔ | ✔ | – | – | – | – | tested against a local HTTP stand-in server only; no real approved client existed |
| Ten-table scheduler, fault isolation, e-stop, checkpoint | ✔ | ✔ | ✔ | ✔ | – | – | see MULTI-TABLE.md |
| Dashboard "Ten-table solver run" panel | ✔ | – | – | ✔ | – | – | screenshots checked in Chromium; no Windows Edge/Chrome run |
| Hardware validation (facts → report) | ✔ | ✔ | – | ✔ | – | – | PowerShell collector parse-checked, **not executed** |
| C# desktop host | ✔ | ✔(JS side) | – | – | – | – | compiles with Mono `mcs`; never run (needs Windows APIs) |
| Prebuilt host `desktop/bin/EightMaxWorkbench.exe` | ✔ | – | – | – | – | – | built with Mono mcs; valid x64 PE; **unverified on Windows**; launcher falls back to compiling source |
| PowerShell runners, installer, uninstall, rollback | ✔ | – | – | – | – | – | all parse-checked with PowerShell 7.4.6; **none executed** |
| GPU / CUDA | – | – | – | – | – | – | **not implemented/not claimed**: bundled CLI runs CPU jobs only |
| Authenticity of strategy as "GTO" | – | – | – | – | – | – | never claimed; every result says `certification: none` |

## Release blockers for 1.0
1. Run `RUN-DESKTOP-CHECKS.cmd`, `RUN-HARDWARE-CHECK.cmd`, install / update / rollback / uninstall on Windows 10/11 x64 (docs/WINDOWS-ACCEPTANCE.md).
2. Confirm the Mono-built host starts on Windows (or rely on the compile fallback).
3. Real ten-table timings on the target PC (the Linux numbers are orchestration cost of simulated tables).
4. Real screenshots from an authorized test environment to measure OCR/template accuracy.
5. Decide and supply a newer EightMax engine archive if one exists; only 5.1 is bundled.
6. Postflop / multiway live-state mapping to solver roots (currently preflop push/fold only).
7. OS-level parallel table workers (current workers are cooperative on one thread).
