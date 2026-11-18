# Platform-independent architecture (0.25)

Nothing in the solver, the simulator or the hand-state engine knows any poker site. A *platform* is a **profile** (data) plus, if it can be operated at all, an **authorised execution adapter**.
No external platform has been selected, inspected or authorised; none is integrated; the shipped profiles describe only this application's own controlled test-table renderer.

## The ten components and where they live

| # | Component | Module(s) | Interface (what other components may rely on) |
|---|---|---|---|
| 1 | Screen capture | `src/screen-capture.js` (sources, `CaptureSession`), `src/capture-manager.js` (`CATALOG`, `selectBackend`, `CaptureManager`, `FrameQueue`), `desktop/CaptureService.cs` | `source.open() / grab() -> {ok,image,meta}|{ok:false,code,reason} / close()`; `CaptureManager.start / switchTo / nextFrame / health` |
| 2 | Image recognition | `src/vision-ocr.js` (`ImageObserver`, templates), `src/vision-track.js` | `observer.observe(image, {heroSeat}) -> {ok, observation, reads}|{ok:false, reasons}` |
| 3 | Table-layout calibration | `src/platform-profile.js`, `src/calibration.js`, dashboard *Platform workspace → Calibration* | profile JSON; `CalibrationSession.addSample / learn / preview / evaluate / export` |
| 4 | Hand-state reconstruction | `src/hand-state.js`, `src/hand-ledger.js` | `engine.ingest(observation) -> {accepted, state, issues}`; a state that cannot be reconstructed is **rejected, never guessed** |
| 5 | Rules and legal actions | `src/hand-ledger.js`, `src/engine.js` | `state.legal` (`canFold/canCheck/canCall/canRaise/minRaiseTo/maxRaiseTo/toCall`) |
| 6 | EightMax solver integration | `src/solver-tree.js`, `src/solver-service.js`, `src/study-adapter.js`, `vendor/eightmax-5.1`, `native/mwcli.exe` | `source.decide(request) -> eightmax-decision` (`ok` or structured `unavailable`) |
| 7 | Decision validation | `src/solver-service.js` (`validateRequest`), `src/test-executor.js` (`concretize`) | request fingerprint `stateKey`, revision, legality, freshness |
| 8 | Authorised test execution | `src/test-executor.js`, `src/execution-adapters.js` | adapter: `{kind, id, submit(action) -> {accepted, reason?}}`; kinds `simulator`, `approved-client` |
| 9 | Action confirmation | `src/execution-adapters.js` (`confirmAction`), `src/full-hand.js` | `confirmAction(sent, before, after) -> confirmed | rejected | ambiguous` |
| 10 | Diagnostics and performance | `src/execution-adapters.js` (`DiagnosticsRecorder`), `src/resource-monitor.js`, `src/capture-manager.js` (`health`) | bounded ordered event log; validated resource report |

## Data flow and gates

```
platform profile ──► capture backend ──► frame (validated: fresh, non-blank, size-stable, same window)
                                              │
                                  ImageObserver (profile layout + calibrated templates)
                                              │  observation (confidence per field)
                                        ObservationGate  ── rejects stale / low-confidence / out-of-order / unhealthy-capture input
                                              │
                                  hand-state engine (rules, chip conservation) ── rejects what it cannot reconstruct
                                              │  state + legal actions + revision + fingerprint
                                      SolverService / decision source ── ok | unavailable{code, missingCapability}
                                              │  decision (bound to revision + fingerprint, timestamped)
                                         TestExecutor ── mode, pause, e-stop, freshness, legality, duplicates, authorisation
                                              │
                                      execution adapter ── simulator | test-server API | approved UI automation
                                              │
                          next frame ──► confirmAction ──► confirmed | rejected | ambiguous (ambiguous suspends the table)
```

## Observation adapter / layout adapter / rules adapter / execution adapter / acknowledgment adapter / diagnostics adapter

| Adapter | Status in 0.25 | Where |
|---|---|---|
| Observation (frames or approved state feed) | complete: screenshot files, frame replay, simulated window, host window/region, structured feed (labelled non-optical) | `screen-capture.js`, `capture-manager.js` |
| Layout (geometry, regions, scaling) | complete: profile `layout` + editor + validation + save/load with checksum | `platform-profile.js` |
| Rules (betting structure → EightMax model) | **partial**: no-limit, 2–8 players configurable in the profile and rules engine; the image reader still has eight seat slots; other structures are not modelled | `hand-ledger.js`, `hand-state.js`, profile `structure` |
| Execution | complete as interface; simulator adapter, authorised test-server adapter (HTTP, exercised against a local test server), generic UI-automation adapter (exercised **only with a mock driver**) | `execution-adapters.js`, `test-executor.js`, `qa-client.js` |
| Acknowledgment | complete (pure function over reconstructed states) | `execution-adapters.js` |
| Diagnostics | complete (bounded recorder, capture health, resource report) | `execution-adapters.js`, `capture-manager.js`, `resource-monitor.js` |

## Rules that never change
* Study mode never executes. Simulation mode acts only on the controlled simulator. Authorised external QA needs a time-limited authorisation record for a test environment you own (`validateAuthorization`), loopback or individually allow-listed hosts, no real money; it is disabled in the dashboard.
* Capture uses documented mechanisms only. No process-memory access, injection, hooks, hidden input, anti-cheat or detection evasion — enforced by a source scan in `tests/windows-release.test.cjs`.
* An invalid, stale, low-confidence or unconfirmed observation is never presented as current state.
