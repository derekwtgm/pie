# 0.23.0

Integration release covering the planned 0.19 to 0.23 work. **It is not 1.0**: nothing in
this release has been run on Windows, and the installer, prebuilt host and PowerShell
scripts are unexecuted. See docs/RELEASE-STATUS-0.23.md for what is and is not verified.

- 0.19 Windows reliability: host reports a port conflict in plain words, writes a bounded
  `Logs\desktop-host.log` on startup failure, ships a prebuilt x64 host (`desktop/bin`,
  built with Mono `mcs`, unverified on Windows) that START-DESKTOP prefers, with automatic
  fallback to compiling the shipped source; new `ROLLBACK-WINDOWS.cmd` re-verifies and
  re-activates the previous installed release; every .ps1 parse-checked with PowerShell 7.4.
- 0.20 Observation and hand state: `src/hand-state.js` reconstructs the eight-seat table
  from observations or a structured feed with confidence gates and explicit rejection
  (layout, cards, pot/stack accounting, continuity, history); never invents data and pauses
  the table. `src/vision-ocr.js` adds glyph OCR, layout profiles, marker reading, an image
  observer, precision/recall reporting and recorded-observation replay (synthetic simulator
  renderings only; no real client screenshots were available).
- 0.21 Solver integration: `src/solver-service.js` engine identification, capability
  negotiation, request validation, a decision source mapping the eight-seat 25 BB preflop
  push/fold study (the only verified mapping), bounded priority queue, exact-input cache with
  byte budget, timeouts, cancellation and stale-decision discard. Results carry updates,
  convergence verdict (default "unproven"), warnings and `certification: none`.
- 0.22 Test executor: `src/test-executor.js` with Study (default), Simulation and
  Authorized QA modes, QA authorization record, stale/duplicate/age/legal checks, retries
  with idempotency keys, per-table pause, global emergency stop, replayable log.
- 0.23 Multi-table: `src/multitable.js` ten isolated cooperative workers sharing one
  solver service, resource budgets, fault isolation and recovery, checkpoint/restore,
  latency/deadline/CPU/memory metrics. Benchmarks and an acceptance run are in docs/.
- Dashboard: new "Ten-table solver run" panel (ten table cards, global controls, monitor,
  diagnostics export, self-test, hardware view) and a standalone hardware validation utility
  (`RUN-HARDWARE-CHECK.cmd`, `windows/Test-Hardware.ps1`, `src/hardware-report.js`).
- Tests: 438 Node cases (was 367) run against a Linux build of the supplied engine source.
  Engine files and the Windows mwcli.exe are unchanged. Older workspaces/checkpoints open
  unchanged; no stored format was altered.

# 0.18.0

- Added convergence checks for native studies using the unmodified engine's own
  response-gain query (`mwcli --gain`): exact best response, with automatic fallback
  to restricted and sampled lower bounds when a tree is too large or slow.
- New native controls: method, check every N checkpoints (curve), per-check time
  limit and a target in % of the starting pot. Checks pause the training clock and
  never fail a study.
- Results show a verdict (within target / keep training / not proven / unavailable),
  per-seat gains in BB and % of pot, heads-up exploitability, a trend line and a
  curve. Summaries are validated against the job, checkpoint counters and seat count,
  and kept in workspace backups.
- Raised limits: native updates to 10,000,000 (engine maximum), strategy memory to
  16,384 MiB with a RAM check, total training time to 7 days, checkpoint interval
  to 1,000,000 updates. Restore/query budgets scale with memory. Browser time
  budget raised to 10 minutes.
- Earlier jobs, results and workspaces remain readable. Missing settings use defaults.
- Added 11 tests (8 using the Linux native engine) and updated 2 bound tests. Total:
  364 Node cases plus 20 core simulation cases (384), and the original UI handler check.
- PowerShell runner and C# host changes are not executed here. Engine files unchanged.

# 0.17.0

- Added persistent native job records/summaries with atomic record replacement,
  bounded history browsing, explicit prior-folder import and version-checked opening.
- Reopen completed results or interrupted checkpoint references after host restart
  without training. Restore the original slot/proof through existing result checks;
  compatibility remains checked by the original engine on explicit Resume.
- Added 1–10-slot native draft batches with zero-training preparation, separate JSON
  Save/Open, fresh bindings and a 1-MB combined request bound.
- Added a host-owned sequential batch pump, per-study result archives, duplicate-
  delivery refusal/reuse, cancellation-before-delivery fencing and fail-fast partial/
  failure handling. Closing the dashboard does not stop an accepted host batch.
- Keep batch metadata across restart with queued work stopped. Unfinished snapshots
  can be copied into a fresh draft; existing checkpoints continue individually.
- Add host history/queue controls, background progress reads, stale reply protection,
  resource exclusion and runtime/credential-free workspace separation.
- Extended the actual Windows acceptance script with host restart, archive open/
  resume/stale-record and sequential batch/delivery checks; these remain unexecuted.
- Added 28 tests, including two Linux native-engine integrations. Total: 353 Node
  cases plus 20 core simulation cases (373), and the original UI handler check.
- No C#/PowerShell/Windows/installer/browser visual execution or signed installer
  is claimed. The original EightMax 5.1 libraries, C++ and Windows binary are unchanged.

# 0.16.0

- Added shared in-page compute ownership and an activity panel for running/queued
  study slots, native preparation/recovery, capacity tests, diagnostics and images.
- Prevent conflicting workflows before worker allocation, keep the one-worker study
  queue, and protect newer work from a cancelled operation's late cleanup.
- Added read-only desktop-idle preflight for browser CPU studies, checkpoint opening,
  capacity testing, image validation and diagnostics, including after dashboard reload.
  Unreachable/active hosts block startup; stopped preflights cannot start late work.
- Preserve explicit preemption of ordinary studies for capacity/image checks and of
  study/capacity/image workflows for browser diagnostics. Native work stays explicit.
- Native Stop also cancels browser job preparation. Ownership remains transient and
  absent from workspace backups; no cross-window scheduler or RAM/VRAM meter is claimed.
- Fixed Windows runner restore status to keep the original cumulative update target
  and validate counters before promoting a restored checkpoint. Extended the supplied
  Windows acceptance polling checks; those Windows paths remain unexecuted here.
- Added 22 ownership/protocol/in-memory UI cases. Total: 325 Node cases plus 20 core
  simulation regressions (345), with the original UI handler check separately.
- Engine libraries, C++ source and the supplied EightMax 5.1 Windows binary unchanged.

# 0.15.0

- Added read-only Find and explicit Recover controls for the live host's current
  native job after reload, including original slot/config/proof restoration, result
  collection and interrupted checkpoint adoption without starting training.
- Added canonical bound-job submission deduplication, changed/older-binding refusal
  and a bounded per-session submission/cancellation ledger with no silent eviction.
- Added attempt revisions, conditional Cancel/Resume and idempotent duplicate resume.
  Pre-acknowledgment cancellation fences both initial jobs and intended resumes.
- Keep unconfirmed native submissions busy, exclude new runs/capacity tests and
  confirm cancellation before resolving uncertainty through recovery. Stale recovery
  previews and late replies cannot overwrite changed drafts. Blocked session storage
  no longer prevents a valid private launch fragment from opening the session.
- Expanded the provided Windows acceptance script for actual host recovery,
  deduplication, stale cancellation and cancellation-before-delivery/resume checks.
- Added 29 protocol-model/in-memory UI cases. Total: 303 Node cases plus 20 core
  simulation regressions (323), and the original UI handler check separately.
- C# compilation, Windows/Win32/PowerShell execution, install/update/uninstall and
  browser visuals remain unexecuted here. The original EightMax 5.1 engine is unchanged.

# 0.14.0

- Added Windows C# desktop-host source and a first-launch x64 build through built-in
  Windows PowerShell/.NET components; no additional runtime download is used.
- Added per-user versioned install/update/uninstall scripts and Start menu/registry
  registration, with release verification, manager locks and user-data preservation.
- Added direct dashboard Run/Stop/Resume controls over a session-bound loopback API,
  retaining exact prepared job bindings and existing native result validation.
- Added suspended native-manager creation in a kill-on-close Windows Job Object,
  headless runner mode, completed-checkpoint resume and owned process cancellation.
- Added stale/in-flight submission cancellation, global emergency hooks and refusal
  of capacity testing while a managed native request remains active/unconfirmed.
- Added RUN-DESKTOP-CHECKS.cmd for actual Windows compilation/protocol/native/cancel/
  resume acceptance and an importable diagnostic report without session credentials.
- Added 20 protocol/UI/package tests using mock transport/in-memory DOM/source checks.
  Total: 274 Node cases plus 20 core simulation regressions (294).
- C# compilation, Windows/Win32/PowerShell execution, installer behavior and visual
  browser checks remain UNEXECUTED here. No prebuilt/signed installer was produced.
  Engine libraries, C++ and supplied native Windows executable remain unchanged.

# 0.13.0

- Added separate binary CPU checkpoints with Save/Open/Continue controls for
  portable root and captured reviewed studies; no training starts on opening.
- Continue toward a cumulative target with exact normalized settings/proof and
  preserve the prior retained state on cancellation, failures and stale responses.
- Bound retained state bytes across slots, validate container/native checksums,
  identity/counters/parser allocations/path depth, and report eviction/failure.
- Preserve typed bytes through the queue without JSON expansion or ownership loss.
- Keep training bytes out of result files, caches and workspace recovery; workspace
  v3 remains compatible, and reports record added-versus-prior update counts.
- Added 22 checkpoint/UI/native cases, 2 queue cases and 4 generated-worker cases.
  Total: 254 Node cases plus 20 core simulation regressions (274).
- Resumed final states matched uninterrupted examples byte-for-byte; the independent
  Linux CLI also resumed exported state to matching policies. Engine files unchanged.
- Actual Windows, visual browser/file-dialog behavior, target-PC memory/speed,
  installer, GPU scheduling and live-client integration remain unverified/pending.

# 0.12.0

- Added native CPU export for exact matched reviewed positions without browser
  training, reusing the unchanged EightMax 5.1 CLI and existing resource controls.
- Added version-2 native jobs/results with captured path/card queries and separate
  root/target queries from one completed checkpoint in the Windows manager.
- Validate latest slot/token/job, full histories, public ledgers/menus, ordered
  ranges, blocker flags, probabilities and consistent completed counters on import.
- Keep unavailable/zero-average native rows unavailable, preserve original input
  weights and discard native reach/aggregate estimates from displayed policies.
- Added workspace version 3 for bound reviewed native exports/results, with v1/v2
  migration, target/draft consistency checks and paused restoration.
- Preserve version-1 root exchange; reject non-root queries disguised as v1 roots.
- Added 21 native exchange/UI/continuation cases and 2 generated-worker cases.
  Total: 226 Node cases plus 20 core simulation regressions (246).
- Linux CLI and in-memory UI validation passed. Windows PowerShell/PE execution,
  visual browser testing, target-PC speed and live integration remain unverified.

# 0.11.0

- Added captured reviewed-position drafts and exact menu/path matching before
  portable training, including preflop-to-postflop and combined action/card steps.
- Query the actual acting seat's stored hand policies at the matched node; preserve
  missing rows and distinguish root input weights from posterior probabilities.
- Added explicit original/current-street anchor selection and selected-step study
  preparation from completed-hand inspection without importing future evidence.
- Added slot-bound links, reviewed draft/report exchange, hero labeling, native-root
  restrictions and exclusion of mapped results from the root-only cache.
- Added workspace version 2 with reviewed links/reports and version-1 migration.
- Added 21 mapping/UI/native-comparison tests and 2 generated-worker cases.
  Total: 203 Node cases plus 20 core simulation regressions (223).
- EightMax 5.1 libraries/C++/Windows binary remain unchanged. Windows/browser visual
  execution, real recognition and live client integration remain unverified/pending.

# 0.10.0

- Added whole-workspace backups with optional embedded source screenshots, pending
  form edits, results, calibration, labels, review progress and diagnostics.
- Added separate automatic metadata recovery, validated/paused restore, rollback,
  stale-import suppression and image reattachment reporting.
- Added Windows launch/check scripts and browser diagnostics with report exchange.
- Added bounded native CPU controls, per-slot export bindings and status imports.
- Replaced the Windows runner with a progress/cancel manager using alternating
  checkpoints and compatible resume toward a total target, including query-only
  recovery when a checkpoint is already complete.
- Added 26 tests: 18 workspace/diagnostic cases and 8 native-management cases.
  Total: 180 Node cases plus 20 core simulation regressions (200).
- Native continuation/refusal checks ran on Linux; Windows PowerShell/Forms/launcher
  execution remains unverified. EightMax 5.1 source/executable are unchanged.

# 0.9.0

- Added labeled recorded-image evaluation, guided expected-field creation/editing,
  local image preview and manifest/report export without editing JSON.
- Added per-table/field outcomes, confusion counts, wrong labels, false accepts,
  known-field coverage, explicit missing-evidence accounting and null denominators.
- Flag exact normalized reference-crop overlap and report a separate scored subset;
  no holdout independence or real-client accuracy claim is made.
- Added bounded sequential image decoding, cancellation/stale-result suppression,
  calibration-change invalidation and browser CPU-work exclusion/emergency stopping.
- Added six synthetic PNG examples, manifest and calibration with deliberate errors.
- Added 28 tests. Total: 154 Node cases plus 20 core simulation regressions (174).
- Preserved EightMax 5.1 solver/native files and 0.8 review-format compatibility.

# 0.8.0

- Added resumable observation-review files containing original frames, cursor,
  supported settings and an ordered frame/reset journal.
- Rebuild reviews by re-auditing the processed prefix; preserve candidates, pauses,
  reset boundaries, refunds and completed records without advancing remaining frames.
- Added separate automatic review recovery, manual reopening, clear controls and
  storage-failure feedback. Startup never processes an earlier review automatically.
- Added a completed-hand selector and accepted-snapshot inspector with original
  frame indices, bounded history, partial-anchor labels and report export.
- Added bounded UTF-8 file validation, journal/rules checks, atomic imports and
  cancellation of stale asynchronous imports; render batches once per click.
- Added a saved-progress synthetic example and 23 continuation/recovery tests.
  Total: 127 Node cases plus 20 core simulation regressions (147).

# 0.7.0

- Added explicit refund, showdown and settled accounting phases.
- Added uncalled current-street bet refunds, main/side pots and exposed-card ranking.
- Added split-pot integer rounding, merged eligible layers and a fixed odd-chip policy.
- Added exact award/refund/stack checks, with missing/contradictory evidence pauses.
- Added bounded completed-hand records with initial snapshots, retained transitions,
  gross awards, cumulative refunds, final balances and partial-anchor/truncation labels.
- Added guarded automatic next-hand admission after verified payouts only.
- Added summary rendering to avoid cloning full archives on every frame.
- Added synthetic accounting demos and completed-hand export.
- Added 20 tests, including 100 seeded comparisons against EightMax pot layers/ranking
  and a 105-hand retention scenario. Total: 104 Node cases plus 20 core regressions.

# 0.6.0

- Added explicit full-post preflop anchors with verified dealer/SB/BB positions,
  dealt-seat count and 0.1 BB individual antes; heads-up order handled separately.
- Connected preflop round completion to correctly ordered flop reconstruction.
- Added initial-preflop study handoff with restored pre-post stacks and canonical
  action-order mapping, preventing doubled blinds/antes.
- Added 2/6/8-seat synthetic sequences, import inventory and readable action timeline.
- Added ten tests including 100 seeded preflop simulator comparisons and actual
  EightMax spec pot checks; 104 total test cases including simulator regressions.

# 0.5.0

- Added an explicitly anchored postflop betting-round reconstruction model.
- Added checks, action order, minimum raises, short all-in reopening and round closure.
- Added transactionally checked combined final-action / next-street transitions.
- Retained conservative legacy auditing when position/history evidence is absent.
- Added manual reviewed street-start study preparation with explicit ranges,
  chip/BB conversion, prior/folded contribution preservation and original seat mapping.
- Added a new synthetic walkthrough and ten tests, including 100 seeded comparisons
  against the independent scripted simulator's betting rules.
- Expanded validation to 74 Node cases plus 20 simulator regressions (94 total).

# 0.4.0

- Added a ten-table read-only temporal observation audit and review workspace.
- Requires distinct stable frames and thresholds before accepting snapshot evidence.
- Added visible-card, pot/contribution, per-seat conservation and continuity checks.
- Added conservative call/fold movement audit; ambiguous bets/raises and turn changes pause.
- Added per-table fault isolation, explicit review resets and bounded audit export.
- Connected raw template results to review without inventing missing game-state fields.
- Added a synthetic walkthrough, sequence schema and 11 new regression cases.
- All audit output retains decisionReady=false; no client action path was added.

# 0.3.0

- Added guided study settings with validation and preservation of advanced inputs.
- Added deterministic controlled study play using real EightMax policy rows,
  source-engine betting paths, replay frames and pot settlement; missing rows stop play.
- Added exact-settings LRU caching for completed portable studies, with labeled hits.
- Added a bounded two-worker pool, end-to-end deadlines and queue timing.
- Added fresh-study burst benchmarks for 1/2/5/10 slots and separate cache probes.
- Added exportable reports without a live-capacity certification or GPU claim.
- Added import checks for contradictory strategy rows and invalid study metadata.
- Preserved completed benchmark reports when no active test is being stopped.
- Expanded validation to 53 Node test cases plus 20 simulator regressions.

# 0.2.0

- Integrated the unmodified EightMax 5.1 reference engine into disposable workers.
- Added configurable root studies, explicit missing strategies, paginated hand
  frequencies, source identity, CPU resource limits and result export/import.
- Added a serialized ten-slot study queue with cancellation and stale-UI protection.
- Included the user's unmodified native mwcli.exe and a bounded Windows job runner.
- Added validated simulation checkpoints and paused automatic/local recovery.
- Added experimental recorded-image ROI calibration and labeled-template matching,
  with rejection of ambiguous, low-similarity, blank, mismatched-layout and duplicate-card fields.
- Preserved the independent scripted simulator and its original 20 regression cases.
- Added 29 tests and actual native/reference comparisons from supplied source.

# 0.1.0

Initial offline ten-table simulation dashboard, independent table state, betting,
showdown evaluation, side pots, stop/pause controls and read-only replay.
