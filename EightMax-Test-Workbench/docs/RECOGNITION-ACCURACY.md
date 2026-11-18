# Recognition accuracy (0.24) — three domains, kept apart

| Domain | What it is | Frames measured | Claim allowed |
| --- | --- | --- | --- |
| `synthetic` | the built-in pixel renderer (`src/sim-display.js`) | 1503 | accuracy on that renderer only |
| `browser-render` | the same controlled client drawn by Chromium (real font rasterisation, anti-aliasing, device-pixel-ratio scaling; `tools/browser-client.cjs`) | 688 | accuracy on that rendering of our own client only |
| `real-client` | genuine, authorised screenshots of an external poker client | **0** | **none: not measured** |

**Real-client accuracy was not measured and must not be inferred from the other two.** No genuine authorised screenshots were available. The only PNG files shipped
(`examples/image-validation/*.png`) are validation fixtures that are not poker tables; the observer rejects them (`tests/vision-024.test.cjs`).

Definitions (`src/vision-metrics.js`): *accuracy of read* = correct / (correct + wrong) over fields the observer produced; *rejection rate* = frames not accepted by the hand-state engine / frames;
*accepted-state accuracy* = accepted frames equal to the truth in every field / accepted frames; *false acceptance* = an accepted frame that differs from the truth in any field a decision depends on.
Categories: card (board + hero), stack (8 per frame), bet (8 per frame), pot, seat (button, actor, hand id, folded flags), action (controls, call amount, minimum raise).

## Synthetic renderer (docs/0.24-recognition-synthetic.json; 10 hands per condition, random legal play)
| Condition | Frames | Accepted | Rejection rate | False acceptances | Accepted-state accuracy | Accuracy of what was read |
| --- | --- | --- | --- | --- | --- | --- |
| clean 960 | 175 | 175 | 0.0 % | 0 | 100.0 % | card 100.0 %, stack 100.0 %, bet 100.0 %, pot 100.0 %, seat 100.0 %, action 100.0 % |
| clean 1920 | 191 | 191 | 0.0 % | 0 | 100.0 % | card 100.0 %, stack 100.0 %, bet 100.0 %, pot 100.0 %, seat 100.0 %, action 100.0 % |
| bilinear 1200 (125% DPI), calibrated at that scale | 190 | 190 | 0.0 % | 0 | 100.0 % | card 100.0 %, stack 100.0 %, bet 100.0 %, pot 100.0 %, seat 100.0 %, action 100.0 % |
| bilinear 1440 (150% DPI), calibrated at that scale | 232 | 232 | 0.0 % | 0 | 100.0 % | card 100.0 %, stack 100.0 %, bet 100.0 %, pot 100.0 %, seat 100.0 %, action 100.0 % |
| bilinear 1200 (125% DPI), templates from clean 960 only | 190 | 0 | 100.0 % | 0 | — | card 100.0 %, stack 100.0 %, bet 100.0 %, pot 100.0 %, seat 100.0 %, action 100.0 % |
| noise ±12 | 175 | 175 | 0.0 % | 0 | 100.0 % | card 100.0 %, stack 100.0 %, bet 100.0 %, pot 100.0 %, seat 100.0 %, action 100.0 % |
| noise ±40 | 175 | 0 | 100.0 % | 0 | — | nothing readable |
| noise ±90 (stress) | 175 | 0 | 100.0 % | 0 | — | nothing readable |

How to read this: geometry is resolution independent but glyph/card templates are not — they must be calibrated at the capture scale (`calibrateFromLabeled`). Templates from a different scale
produce readings that the rules layer then **rejects** (125 % row without recalibration: 100 % rejected, 0 false acceptances); noise at ±40 and above is rejected wholesale. Conservative rejection is preserved.

## Browser rendering of the controlled client (docs/0.24-browser-render-recognition.json; held-out play, templates calibrated on labelled screenshots at each ratio)
| Device pixel ratio | Frames | Accepted | Rejection rate | False acceptances | Accepted-state accuracy | Accuracy of what was read |
| --- | --- | --- | --- | --- | --- | --- |
| dpr 1 (960 px wide) | 172 | 172 | 0.0 % | 0 | 100.0 % | card 100.0 %, stack 100.0 %, bet 100.0 %, pot 100.0 %, seat 100.0 %, action 100.0 % |
| dpr 1.25 (1200 px wide) | 172 | 171 | 0.6 % | 0 | 100.0 % | card 100.0 %, stack 100.0 %, bet 100.0 %, pot 100.0 %, seat 100.0 %, action 100.0 % |
| dpr 1.5 (1440 px wide) | 172 | 172 | 0.0 % | 0 | 100.0 % | card 100.0 %, stack 100.0 %, bet 100.0 %, pot 100.0 %, seat 100.0 %, action 100.0 % |
| dpr 2 (1920 px wide) | 172 | 172 | 0.0 % | 0 | 100.0 % | card 100.0 %, stack 100.0 %, bet 100.0 %, pot 100.0 %, seat 100.0 %, action 100.0 % |

The one rejected frame (dpr 1.25) was a board card whose rank/suit score (0.69) fell below the acceptance floor: refused, not guessed. Calibration used ~15 labelled screenshots per ratio (all 52 cards, all digits in every
numeral box). Browser fonts: DejaVu Sans / Sans Mono. A different client font needs its own calibration.

## Limits
* Cards in the browser client are rank + suit glyphs read separately (rank corner, suit pip, colour cross-check); real clients with artwork, animations, tablecloth patterns, overlays, or chat text are untested.
* Digits only: no word reading (action buttons are recognised by calibrated position and lit/dim state, not by their labels).
* A single stable misreading that is also self-consistent with the rules (for example a misread stack at the first frame of a hand) is only caught at the next frame; require `stability`/consensus before acting on real clients.

## 0.25 reports (same three domains, still kept apart; real-client measured: **0 frames**)
* `reports/0.25-recognition-synthetic.json` — controlled renderer: 1,503 frames, 0 false acceptances (same conditions as 0.24).
* `reports/0.25-browser-render-recognition.json` — Chromium rendering of the controlled client: 688 frames, 0 false acceptances.
* `reports/0.25-recognition-calibration.json` — **new**: calibration generalisation with the profile/calibration system (labelled-sample learning, evaluation on frames not used for learning): same layout, three **unseen layouts**, three extra resolutions with and without recalibration, a profile calibrated for another layout, pixel noise. 878 frames, 0 false acceptances. Acceptance rates are modest because each row calibrates on only 6 hands (templates for some digits/cards are missing; the reader rejects what it has no template for rather than guessing). A profile calibrated for the original layout accepts **0 of 175** frames of a shifted layout (rejected, not misread).
