# Observation and hand-state engine (0.20)

`src/hand-state.js` — `HandStateEngine(table)`. Input: `eightmax-observation` v1 (structured simulator feed via `observeSimulator`, recorded frames, or output of the image observer).
Accepted output: a state with all eight seats, stacks, wagers, totals, folded/all-in, board, street, button, actor, pot, optional hole cards, action history, legal actions (exact only when
`lastRaise` is observed) and a content `key` / `revision` used to reject stale decisions. Opening pot must be 230 chips (2.3 BB: eight 0.1 BB antes + 0.5 + 1).

Explicit rejections (each pauses that table; two consecutive consistent frames resume it): `unsupported-format`, `wrong-table`, `unrecognized-layout`, `bad-sequence`, `stale-observation`,
`missing-confidence`, `low-confidence` (overall ≥ 0.90, per field ≥ 0.85), `missing-field`, `invalid-card`, `contradiction`, `ambiguous-seats`, `inconsistent-pot`, `inconsistent-stacks`,
`inconsistent-start-pot`, `incomplete-history`, `malformed`. Continuity checks: board prefix fixed, street never regresses, button fixed, folds permanent, committed chips never decrease, chips conserved, history append-only.
Missing hole cards stay `null`.

`src/vision-ocr.js` — column-projection glyph segmentation, Pearson-correlation template matching with a score floor and a margin over the runner-up, presence markers, a scale-independent layout profile
(`eightmax-8max-v1`, aspect 1.6, ≥ 800 px wide), `ImageObserver`, `scoreReads` (precision / recall / error / rejection rates) and `replayObservations`.
Image observations carry the lowest template correlation as confidence; chip conservation is checked against the expected bankroll because screenshots carry no per-seat totals.

Scope: tested on **synthetic renderings of the controlled simulator** at 800, 960, 1440 and 1920 px (zero wrong accepted states, including with noise and at an uncalibrated 1200 px width, where unreadable frames
are rejected). Real poker-client skins, fonts, animations and anti-aliasing are untested. Templates must be calibrated per layout and resolution. No screen capture or client access exists in this code.
