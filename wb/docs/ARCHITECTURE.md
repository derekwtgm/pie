# EightMax Test Workbench 0.18.0

This is a separately packaged companion built around the user's uploaded
EightMax-Windows-5.1.zip. The uploaded archive is unchanged.

## Implemented components

| Component | Files | Scope |
| --- | --- | --- |
| Simulator | `src/engine.js`, `src/app.js` | Ten independent seeded eight-seat hand state machines; legal-action validation; pots; showdown; replay |
| Whole workspace | `src/workspace.js`, `src/workspace-ui.js` | Validated component envelope, optional embedded originals, separate metadata recovery, paused restore/rollback |
| Recovery | `src/session.js`, `src/session-ui.js` | Validated JSON continuation; bounded automatic local recovery; paused restore |
| Reviewed solver path | `src/reviewed-study.js`, `src/reviewed-demo.js` | Captured snapshot proof, exact action/chance matching, acting-seat policy query; portable CPU only |
| Solver adapter | `src/study-adapter.js` | Settings normalization, real protocol-4 spec generation, exact-hand root averages, native result import |
| Isolated CPU solving | `src/study-worker.js`, `src/study-queue.js`, `src/study-ui.js` | One disposable worker; ten independent study slots; deadlines, cancellation, stale-result suppression |
| Convergence checks | `src/convergence.js`, `native/Run-Native-Study.ps1` | Engine `--gain` (exact → restricted → sampled), validated summary, verdict and curve; see CONVERGENCE.md |
| Windows launch / native workflow | `windows/*.ps1`, `native/Run-Native-Study.ps1`, `src/native-jobs.js` | Diagnostics, bounded CPU chunks, progress/cancel/resume and bound job/result exchange; Windows execution unverified |
| Labeled image validation | `src/image-validation.js`, `src/image-validation-ui.js`, `src/image-validation-demo.js` | Guided ground truth, sequential user-file evaluation, coverage/error metrics and export |
| Image calibration | `src/vision.js`, `src/vision-ui.js` | User-loaded screenshots; normalized ROIs; reference templates; threshold/margin rejection; no live capture |
| Review recovery / inspection | `src/review-session.js`, `src/observations-ui.js` | Source/journal replay, separate local recovery, completed-hand snapshot inspection |
| Hand accounting | `src/settlement.js`, `src/completed-demo.js` | Explicit refunds/showdown/payout verification, bounded completed-hand archive and guarded next-hand continuity |
| Portable build | `tools/build.py`, `START.html` | Embedded source/style/worker; no application server or programming runtime for the end user |

`vendor/eightmax-5.1/provenance.json` records the original archive SHA-256, source
module hashes, native executable hash and supplied build 7d08acc7eb4577ee.
The vendor modules and mwcli.exe are byte-for-byte copies. No engine changes were
made. Native source is included alongside the binary. The original EightMax
installation remains independent.

## Engine integration

The portable study backend uses the actual 5.1 JavaScript reference libraries in a
Blob Worker. It does not pretend to connect to EightMax.exe or use CUDA. Every
study uses sampled private ranges, exact-card keys, external-sampling MCCFR,
linear weights, one deal per update, shared action streams and a 32 MiB strategy
budget. Unmodified EightMax builds the study and its protocol-4 native spec.

Results use `averageAt('r', board, 0, hand)` for root hands. Labels come from
EightMax's root action menu. A missing row is unavailable, never a fabricated GTO
answer. Stored root rows are not a convergence certificate. Neither root action
EVs nor unilateral response gains are evaluated here. Imported results undergo
structural validation, not independent authenticity or equilibrium validation.

The native manager accepts generated jobs, verifies the supplied executable hash
and build ID, and trains toward a total target of at most 10,000,000 updates (0.18; was 50,000). Each
completed chunk writes one of two alternating checkpoints; an active child can be
cancelled without discarding the previous completed checkpoint. Compatible resume
uses the same exported spec and fills the remaining target; an already complete
checkpoint is queried without retraining. One named Windows mutex serializes
runners in the same logon session. Build, restore, training and query budgets are separate (5/15/1–60/30 s).
The strategy-table budget is 32–256 MiB and is not a whole-process memory cap.
Progress reflects completed chunks, not updates inside the current child process.
Browser export bindings reject accidental wrong-slot/stale imports; they are not
signatures. The browser cannot control that separate Windows process. The GUI and
launcher scripts were not executed in this Linux environment.

Native source comparison uses a Linux CLI compiled from the supplied C++ source;
it is not execution of the Windows PE binary. Portable/reference and native root
frequencies matched on tested river3, flop6 and preflop8 configurations.

Study slots are separate from simulated table sessions. The ten-table simulator remains on
its labeled scripted test policy. A separate controlled-play mode now follows a
trained study through its source-engine action paths. No live recognition output or arbitrary poker
state is silently converted into a solved root; mid-street reconstruction, range
inputs, bet-history mapping and state-to-study equivalence still need an adapter.

## Cancellation and concurrency

The default study queue has one active solver worker. The pool supports up to two
workers, used by the capacity test when selected. Up to ten slots may queue independent
requests. A new request/input change cancels that slot's older generation.
Responses bind request IDs, and UI tickets prevent old Promise handlers from
replacing new status/results. A parent watchdog terminates workers after the
requested solve budget plus startup allowance. Simulation is paused when a study
is opened/run. A browser emergency stop cancels simulation and browser workers;
reset is required before a new browser study. The optional native runner is an
explicitly separate process.

Strategy-table budgets are not whole-process RAM caps. Single-iteration latency
may exceed a worker's internal time check; the parent can terminate it. No actual
8-GB VRAM/16-GB RAM target benchmark or ten-table solver SLA has been established.

## Simulation recovery

Session JSON stores each table's complete RNG, remaining deck, pending seats,
positions, contributions, actions, counters, stop/pause state and bounded logs.
Loading constructs new tables, checks types, card uniqueness, street/deck shape,
pending actors, conservation and counters, then replaces the old coordinator.
Every restored epoch is incremented to invalidate previously issued actions.
RNG/deck state is unchanged, so subsequent simulated decisions continue exactly.
Scheduling wall time is restarted and global running is always false on restore.

Automatic recovery excludes replay frames to reduce localStorage pressure;
manual session files include the rolling recording. Neither is a signed artifact.
Study worker state is not saved/resumed; saved results are strategy reports only.

## Recorded-image calibration

Regions use normalized coordinates and table/field identities. Each crop is
resampled to 24 x 32 grayscale values and contrast-normalized. The reader computes
1 - root mean squared pixel difference against labeled samples. It requires a
score of at least 0.92, a different-label margin of at least 0.04, at least two
labels, adequate contrast and a compatible image aspect ratio. These are heuristic
acceptance thresholds, not a probabilistic classifier. Equal-looking classes are
refused. Amount templates represent whole strings; there is no general digit OCR.

The schema bounds references to 128, regions to 32 per table, calibration files to
4 MB, input image files to 10 MB and decoded images to 20 MP. The pixel limit is
checked after browser decoding, not before allocation. These limits do not prove
end-to-end peak memory bounds. Tests use synthetic images only. Real KKPoker
recognition accuracy, layout scaling and animation behavior are unmeasured.

No computer-vision observation is passed into an executor, solver request or
simulator state. There is no poker-client capture, input injection, anti-cheat
bypass, input camouflage or account automation in this package.

## Remaining integration

1. Compile/validate the 0.17 first-launch desktop host and per-user installer on
   Windows; a signed prebuilt installer and additional guided fields remain pending.
2. Recorded-session datasets, OCR/card-model validation and temporal hand tracking.
3. Extend reviewed exact-menu mapping beyond the supported anchors/chip-EV subset.
   Unknown/missed histories and arbitrary unrecognized snapshots still cannot become
   solver requests; the ten-table dashboard retains its scripted policy.
4. Extend the sequential native batch queue to a measured priority/concurrency
   scheduler, cross-window browser/host ownership and full resource accounting.
   Current batches run one native study at a time; there is no shared strategy cache.
5. An approved test-interface executor with observed acknowledgments, per-account/
   table binding, stale-state cancellation and integrated emergency stopping.
6. Detection telemetry and measured 1/2/5/10-table latency on the target hardware.


## 0.3 additions

`src/forms.js` validates ordinary study fields while retaining previous wagers/ICM
and locking changes that would invalidate those inputs. `src/study-ui.js` applies
guided changes automatically at run time, keeps slots independent, and exposes
Advanced configuration for inputs outside the guided fields.

`src/study-play.js` samples private hands independently from weighted ranges and
rejects the entire joint draw on collision. It draws a compatible runout using a
separate seeded RNG. It then calls unmodified EightMax `game.view(path)` for state
transitions/action menus and `averageAt` for the actual acting hand. Study paths
use action slots and `c` for chance transitions. A null policy blocks the hand;
existing-row uniform-average behavior is inherited from EightMax and is not a
convergence certificate. Queries leave exported training state unchanged in tests.
The view internally computes sampled analysis; those EV estimates are not exposed
as certified action EVs by this companion. Replay uses continuous-BB pot layers
and source card ranking. It is chip-EV only, bounded to 128 transitions and an
internal practice budget, with the parent worker watchdog as an outer stop.

`src/cache.js` keys every normalized input, update/time request, source build and
backend. Only fully completed portable root studies are admitted. Entries are
cloned and bounded with LRU eviction. Its byte accounting covers UTF-16 strings,
not object overhead or the full process. Results do not gain quality by caching.

`src/study-queue.js` binds each request to slot/generation/ID, with at most two
workers. Optional end-to-end deadlines include waiting time. Queued requests that
are already late do not launch a worker; responses that complete late are rejected.
Timing separates queue, running and end-to-end latency. A Promise generation check
also prevents an old UI continuation from replacing newer settings or status.

`src/benchmark.js` / `src/benchmark-ui.js` measure fresh worker requests in bursts
of 1, 2, 5 and 10. They report success/failure, update-count completion, deadline
misses and completed-request latency percentiles. One burst per count is not a
sustained capacity test. Cached lookup is measured separately, when a completed
study exists. The test pauses the simulator and cancels portable studies to avoid
uncontrolled in-app load; it cannot control external native processes or other apps.
Browser CPU/RAM values are hints, not hardware validation. No KKPoker capture or
input costs are included. Reports explicitly keep `capacityEstablished: false`.


## 0.4 recorded-observation audit

`src/observations.js` is an independent read-only state/evidence audit, not the
simulator or solver state machine. Its per-table tracker accepts complete observation
snapshots only after two distinct frames agree for at least 100 ms. It canonicalizes
known state fields, so irrelevant JSON ordering cannot alter stability. It refuses
reused/out-of-order identities, gaps over 2 s, low aggregate evidence and hand-ID
changes without an explicit review reset. The caller supplies evidence quality;
imports do not authenticate its truth or calibrate classifier accuracy.

Snapshot checks cover unique visible cards, street/board length, acting-seat
eligibility, integer stack/bet/contribution units and pot=sum(contributions)+dead
money. Movement checks preserve every seat's stack+contribution balance, known
cards, fold status, table configuration and earlier street contributions. Multiple
seat changes in a single stabilized transition are refused. An isolated call or
fold can be labeled as an observed movement. Bet/raise candidates and no-chip
turn changes remain ambiguous and latch a table pause. Minimum raises, reopening,
blind/ante correctness and complete action order are not certified.

A first stable snapshot is an explicitly unknown-history anchor. Accepting it is
not proof of preceding betting. Street transitions retain a warning that round
completion is unproven. Every event/export sets decisionReady=false. Nothing is
forwarded to a solver, strategy cache, action executor or client.

State is isolated across up to ten tables. Audit history is capped at 500 events;
frame identities at 5,000 per table before a reviewed reset; imported sequences at
5,000 frames / 10 MB. The UI processes at most 250 frames per click. This is logical
bounded storage, not a measured whole-process heap ceiling. Audit sequences and
state are not included in simulation autosave. Exports are review reports, not
resumable authenticated checkpoints.

`src/observations-ui.js` imports recorded-observation JSON, steps/runs a synthetic
walkthrough, shows snapshots and recent events, permits reviewed table resets and
exports audit JSON. `vision-ui.js` forwards raw region results for inspection only;
there is no invented conversion from partial field templates to full hand state.


## 0.5 anchored betting reconstruction and manual study handoff

`src/round-audit.js` adds an optional postflop round model, enabled only by an
explicit street-start anchor with `roundStart.dealer`, zero street wagers and the
correct first actor. It tracks pending seats, price, last full raise and each
seat's last acted price. Short all-ins reopen a prior actor only when cumulative
price increases meet the last full raise. Closed rounds expose actor=-1; observed
closure flags must agree. Folded and all-in players are skipped in action order.

Each stabilized transition is applied to a clone of the round model, compared
against all observed stacks/contributions/folds/bets and expected actor, then
committed only if it matches. A final action plus next-street deal is allowed only
when that single action closes the prior round. Known-card and per-seat ledger
checks remain in effect. This does not prove that multiple invisible actions did
not occur between identical snapshots, authenticate source observations, certify
preflop history, or handle payouts/refunds. Unanchored mode retains 0.4 ambiguity
pauses. Every mode remains decisionReady=false with no client execution path.

The study bridge requires a stable open round with zero actions and zero street
bets. It rotates live seats into action order, requires explicit ranges, preserves
previous live/folded contributions and dead money, and divides chip values by the
observed BB. It omits dealt-seat ante generation because contributions already
include posted chips. It rejects live stacks outside the current adapter's 2–250
BB limits and more than six live seats. Opponent ranges and future bet menus are
not inferred. ICM, preflop, mid-street and payout/refund mapping remain absent.

`openReviewedStudy` loads a draft into the study UI but makes no solver request.
It cancels older work in that slot, clears its old result, shows original seat
mapping, and leaves explicit Run CPU study control with the user. A later imported
observation cannot automatically change an already prepared study. These are
copied offline inputs, not a persistent live-state connection.


## 0.6 explicit preflop posting anchors

The optional round model now accepts full-post preflop roots as well as zero-bet
postflop roots. A preflop anchor requires a dealer, SB/BB seat identities, dealt
count equal to listed seat count, ante exactly BB/10, correct per-seat live blind
bets, committed=ante+blind, positive chips behind and zero unassigned dead money.
The chip-unit BB must be divisible by ten. Heads-up uses dealer=SB and acts from
SB; other tables post SB/BB clockwise from the dealer and act left of BB. Short
posts, post-time all-ins, BBA, straddles and unidentified/missing seats are not
supported. This policy is conservative, not a general implementation of every
room's posting rules.

Position/posting evidence is retained across round cloning and street transitions.
If subsequently supplied posting fields contradict it, the tracker pauses. Fields
may be omitted after the anchor, but absence never establishes new evidence. A
preflop closure may be observed separately or combined with the first flop; only
a fully completed modeled round can advance. All previous known-card, stability,
turn, conservation and no-client-execution boundaries remain unchanged.

The initial preflop bridge permits 2–8 seats before any action. It restores each
seat's stack+committed amount to pre-post chips, scales by BB, and orders seats
left of BB through BB last. It supplies a linked preflop configuration with dealt
count and zero common pot; EightMax generates its own classic 0.1 BB individual
antes and 0.5/1 BB blinds once. It does not add prior/folded contributions to this
initial preflop request. Configured starting stacks must be within 2–250 BB.

Postflop study preparation remains limited to 2–6 live seats and supported stacks.
Future bet menus are explicit draft defaults, not observed-player predictions.
Caller-entered ranges are required and are subsequently validated by EightMax.
No study is solved or updated automatically by observation processing.

The observation UI now inventories import source, frame count and table identities
before processing and renders up to 50 recent reconstructed transitions in a plain
text timeline. The inventory is not an accuracy/authenticity certificate. JSON
observations remain the only replay import format; proprietary hand histories and
raw video-to-state recognition are not implemented. Audits remain bounded rolling
logs and exclude payouts/refunds and tournament elimination handling.


## 0.7 accounting phases and completed records

`settlement.js` checks explicit accounting transitions only after a reconstructed
round is closed. It validates visible-card uniqueness and seat identity, rejects
contradictory revealed cards, and preserves known evidence across transitions.
Showdown is a complete-river, no-chip-movement evidence phase; it alone is not a
verified payout. Hero-seat identity is explicit whenever showdown evidence is used.

Refunds are the unmatched excess of a unique highest contributor, provided that
player is live and the excess fits its current-street bet. Earlier unmatched
contributions, unsupported dead layers and ambiguous refunds stop the audit rather
than being guessed. Refunds update a cloned closed-round ledger. A payout may also
include this refund in one explicit settlement if it was not already separately
observed. Per-transition refund vectors prevent double crediting.

Settlement deducts uncalled excess, builds eligible contribution layers and adds
unassigned common/dead chips for all live players. Adjacent identical eligibility
layers are merged before rounding. Contested layers require a complete board and
known cards for every eligible seat; unknown/mucked cards block verification.
The companion's seven-card evaluator ranks exposed hands. Ties divide integer
chips evenly and award remainders clockwise from the dealer, independently per
merged pot. This is an explicit fixed zero-rake policy, not every site's rules.
Observed award/refund vectors and final stacks must equal the calculated result.
Uncontested fold wins need no invented opponent cards.

The tracker commits a payout only after all checks pass. It then archives the
anchor snapshot, bounded transition history, settlement plan, cumulative observed
refunds, gross pot awards and final state. Initial postflop anchors are explicitly
partial; no earlier history is manufactured. It retains 100 completed records and
256 transitions per hand, marking truncation, plus the existing 500-event/5,000-
frame-per-table bounds. Summary mode avoids copying full archives into the UI for
every step; full audit/hand exports retain the stored details. Record IDs are only
unique within the current review run. Reports are neither authenticated records nor
resumable tracker checkpoints and are not included in simulator autosave.

A new hand identity may proceed without reset only after verified settlement, with
unchanged seat count/BB, the next dealer, matching carry-forward stacks, and a fresh
supported preflop posting anchor. All seats must still cover full supported posts.
Blind increases, eliminations, seat changes and rebuys need explicit review/reset.
The new-hand gap bound defaults to 60 seconds; within-hand gaps retain the 2-second
bound. Hand identities cannot be reused in a continuous tracked table; 1,000 hand
identities per table is an additional review/reset cap. Duplicate final frames do
not archive again. An invalid payout affects only its table.

No accounting phase is accepted as the initial anchor, and the tracker does not
infer a missing final betting action from an already credited payout. Producers
must normalize client pot displays and supply stable snapshots at the necessary
boundaries. Every report remains decisionReady=false. No live recognition, wager
execution or tournament-prize payment is performed by this module.


## 0.8 observation review continuation and inspection

`review-session.js` owns one immutable-by-convention cloned source sequence, a
cursor and a bounded chronological journal of consumed source indices and explicit
reviewed resets. `serialize()` writes these inputs and settings, not Tracker
internals or derived acceptance claims. `load()` checks the exact envelope,
audit-rules identifier, UTF-8 size, supported settings, source limits and operation
shape/order/count, then creates a new Tracker and applies the journal in order.
No operation can skip/repeat a source index. Invalid evidence is replayed as the
same audit pause/rejection rather than silently repaired. The journal can contain
resets that explicitly establish a new anchor; these never certify the discarded
continuity. No unprocessed source frame is consumed during restoration.

The current rules identifier is `eightmax-review-0.8.0`; incompatible identifiers
are refused. Review files are editable evidence packages, not signed statements
or source-authentication checks. Altered evidence is re-audited, and a plausible
fabricated sequence may still pass the supported checks. Imported serialized
accepted-state or completed-record fields are refused by the exact envelope.

The UI attempts to save changed reviews every 3 seconds under a separate local
storage key. It retains the previous stored value if setItem fails and reports
failure; a failed revision is not retried until another change. Startup offers
recovery without opening or processing it automatically. Clearing the stored
value suppresses re-saving that revision; future changes can create a new save.
Portable manual files remain available independently of browser storage. An
import generation check prevents a late file read from replacing a newer review.
An invalid import is built/validated before replacing the current review.

`inspect(recordId)` replays the journal and gathers accepted transition snapshots
for the matching completion ordinal. It disambiguates reused hand labels across
review resets. It returns at most the last 256 accepted steps, marks omission and
retains the original anchor snapshot in the record. Inspectable completed records
remain limited to the most recent 100; source/journal replay can reconstruct the
saved review's same retention state. Exported inspection reports cannot resume a
review, and never launch a worker, change simulator state or execute an action.

Bounds: 10 MB UTF-8 / 5,000 source frames; 20 MB review file; 10,000 frame/reset
operations; 250 frames per processing click. Prefix replay and selected-hand
inspection run synchronously. File and object-count bounds do not measure whole-
process peak RAM, browser localStorage quota or Windows response time. Review
recovery excludes screenshot pixels/calibration, study drafts, ranges/cache,
worker state and simulator sessions, which retain their separate workflows.


## 0.9 labeled screenshot evaluation

`image-validation.js` parses a versioned labeled-image manifest and selected-file
inventory, snapshots the calibration/labels, groups cases by exact filename, and
runs one decoder at a time. A decoded image is reused across labeled tables in
that screenshot, then released from the runner before the next image. Decoder
failures, missing files/regions and type conflicts create unscored outcomes;
classification rejections remain separate. Current fixed-layout matching still
comes from unmodified `vision.js`; no digit OCR, card model or live capture was
added. The evaluator validates byte-sized RGBA views and decoded dimensions.

Metrics separate correct/wrong accepted labels, incorrect accepts on explicit
negative fields, rejected known labels and correct negative rejections. Every
known target contributes to coverage, including unscored evidence; false-accept
rate uses scored negatives only. Absent denominators are null. Exact normalized
reference overlap is reported alongside a no-exact-overlap scored subset. This
limited comparison cannot authenticate source files, detect near-duplicate leakage
or establish independent test accuracy. Ground truth remains caller-supplied.

A generation token invalidates cancelled work across decoder/yield boundaries;
old runs cannot clear a newer run's busy state or publish a completed report.
Selected labels and calibration are cloned before asynchronous work. UI mutations
invalidate earlier scores. A malformed manifest is validated before replacing
current labels; an asynchronous import cannot overwrite a newer selected dataset.
A pending browser decode itself is not forcibly interrupted by Stop; its bitmap
is closed by the decode wrapper and its late result is ignored.

`image-validation-ui.js` adds a guided field editor, explicit Known label versus
Must reject choices, label removal for unknown truth, preview of selected local
images, and separate manifest/report downloads. Each preview bitmap is closed;
starting validation clears the preview canvas. Manual input uses current Image
calibration; the deterministic demo uses separate in-memory references. Reports
contain labels/scores/outcomes but omit image/template pixels. Drafts and images
are not in either recovery workflow. Export labels, report and calibration
separately; keep original files for future evaluation.

During validation the simulator is paused and portable studies cancelled. New
simulation, study and capacity starts are blocked. Emergency stop/Escape cancels
the evaluator. This cannot stop optional native processes or other applications.
Bounds are 4 MB UTF-8 / 200 cases / 2,000 fields per manifest, 100 selected PNG/JPEG
files / 100 MB total, 10 MB each, 20 MP after decoding. They do not establish
whole-process memory bounds, target-PC speed or real recognition reliability.
EightMax solver/native bytes and the 0.8 observation review rules remain unchanged.


## 0.10 whole-workspace lifecycle and startup diagnostics

`workspace.js` validates one envelope before UI replacement: engine identity,
simulation session, study drafts/results/native exports, calibration, review
journal, expected labels/outcomes, benchmark report, diagnostics and image assets.
Unfinished text is structurally bounded and preserved as a draft, not evaluated.
Completed study results must match their stored draft. Recognition/benchmark
aggregates are rebuilt from validated outcomes/rows. Restore reconstructs fresh
simulation/review objects and invalidates old browser work. Unexpected apply errors
trigger a best-effort rollback to a separately validated prior snapshot; running
work is never restarted. A rollback error is explicitly reported.

Manual files optionally embed selected originals as canonical base64, with byte
counts, image metadata and reference bindings checked before Blob construction.
No image is decoded during restore. Automatic recovery uses a separate local key
and references only, omitting rolling simulation replay. Unchanged startup defaults
cannot overwrite an earlier recovery save. Failed writes retain it; a failed
revision is retried after further changes. Individual component saves remain
independent. Eligible completed study results rebuild a fresh exact-settings cache;
worker state and native binary checkpoints are outside this envelope.

Bounds: 220 MB UTF-8 envelope; 101 assets / 110 MB original bytes; existing 10-MB
individual image, selected-image/component limits remain enforced. These are
logical file bounds, not a measured heap limit. Prefix replay, validation, JSON and
base64 conversion can synchronously occupy the page. Native jobs/checkpoints and
Windows diagnostics live in their own AppData folders and are never auto-uploaded.

Windows startup scripts verify listed release bytes, locate a browser, read limited
hardware inventory and run bounded native identity/capability probes. Browser
checks request one 20-update CPU study. Diagnostic reports remain supplied evidence
with liveCapacityEstablished=false. Neither establishes independent accuracy, GPU
training performance or simultaneous-table capacity. Windows execution is pending.


## 0.11 reviewed-position study paths

Review-session trajectory extraction replays the journal and keeps only the selected
hand's accepted snapshots. Completed-hand extraction uses only the prefix through
an explicitly selected step; future exposures/settlement are excluded. Source frame
indices are retained but are references, not authenticated evidence. A standalone
proof replays the chip/turn/board model, not image recognition or original temporal
quality gates. Unknown anchors, gaps/missed actions within supplied transitions,
accounting states, closed targets and truncated prefixes are refused.

`reviewed-study.js` validates the proof and fixed root money/position assumptions.
Ranges and menus may be changed explicitly; root cards, stacks, contribution
ownership and posts must match. The worker calls the unmodified game's view for
candidate action paths, uses rounded labels only as a candidate-search hint, and
accepts exactly one path whose actual public ledgers/cards/actor match every
snapshot. Combined last-action/card observations produce an action plus a chance
step. Structural view data is cached; sampled analysis/EV fields are discarded.

Matching precedes training, with a 4-second mapping check and parent worker watchdog.
The same prepared game then trains for its selected budget and supplies averageAt
for the actual actor, path, board and each compatible root-range hand. Missing rows
remain null; existing-row normalization is inherited from EightMax. No reported
weights are range posteriors. Whole input-range support/joint reach is not inferred
from a returned row. No action EV, response gain or equilibrium bound is computed.

Original-anchor scope retains the prior path. Explicit current-street scope drops
that prefix and uses the reviewed contributions/positions as a fresh postflop root,
with user-supplied ranges at that root. Earlier strategy conditioning and folded
players' private ranges are not reconstructed. Range/menu mismatch never silently
snaps or re-roots a request. Native job export remains root-only and requires link
removal. Root-only cache admission excludes reviewed-node results.

Workspace v2 records per-slot proofs and reports plus the review anchor selector.
Version-1 files migrate to v2 in memory with null links and original-anchor scope.
Standalone draft/report imports validate structure, ledger/context and probabilities;
they do not independently rerun the solver or authenticate imported frequencies.
Restore remains paused and does not spawn a solver. Later review changes do not
rewrite a captured study. Logical limits are 128 accepted snapshots/128 path steps,
200,000 proof characters and a 1-MB reviewed draft; physical Windows performance,
whole-process RAM and real-client accuracy have not been established.


## 0.12 native reviewed-position exchange

`native-jobs.js` now follows `reviewed-study.js` in browser/worker module order.
A fresh worker maps a captured proof before issuing `native-review-job`; no training
is run. `reviewedJob` requires zero committed updates and stores the target template
with null policy rows, root labels, explicit native query and unmodified root spec.
Numeric action slots and dealt cards are projected from the already matched mixed
path. Root-only exchange stays version 1; reviewed exchange uses version 2.

The Windows manager retains CPU/resource/identity/mutex/checkpoint behavior. It
serializes the bounded query as data, uses only the bundled executable, and queries
both root and target from its last completed checkpoint. Each query has a separate
30-second bound. Cancellation/timeout retains the prior completed checkpoint and
publishes no partial result. Windows execution remains unverified here.

The browser normalizer keeps root context separate from `reviewedNode`. It checks
full captured history slots/cards/actors/amounts, public pot/stacks/bets/folds/board,
menu and full ordered acting-range identities/weights/blockers/probabilities.
Training/root/target counters and requested total must agree. Source spec weights
are retained, including tiny values rounded by the CLI's printed query. Native
reach/aggregate fields are discarded; no posterior or EV is inferred. Existing
native rows with no positive average mass remain unavailable, which differs from
portable zero-average-row normalization.

Native envelopes are at most 6 MB; normalized reports remain 2 MB, jobs 1 MB.
Version-2 native imports require the latest matching exported slot/token/complete
job. These are context/consistency checks, not authentication of supplied policies
or checkpoint provenance. The runtime Windows manager actually uses the same
checkpoint for both queries, but imported equal counters alone cannot prove that.

Workspace v3 permits a reviewed proof and matching native v2 export/result together,
checks target/draft consistency and migrates v1/v2 files. Every restore stays paused.
The native checkpoints remain separate files owned by the external manager.
The solver libraries/native source/Windows executable have not changed. Linux CLI
integration covers mixed streets, 2/6/8-seat linked preflop roots, tiny weights and
chunked non-root continuation. No Windows/GPU or live-table speed claim follows.


## 0.13 portable CPU continuation

`cpu-checkpoints.js` follows the pure reviewed-position module in browser and worker
bundles. It wraps the unmodified EMMW4 export in a binary container with strict
metadata, CRC32, exact settings/proof binding and bounded preflight. The original
engine validates its own native checksum, study ID, rows and RNG/counters in a fresh
disposable worker. Import must fit the portable 32-MiB strategy-table budget.

Fresh study retention is optional. Explicit inspection restores and queries without
training; explicit continuation trains from the restored committed count to the
requested total. Its time budget begins after restore/path validation. Fresh root
studies keep the prior budget behavior. Query and snapshot costs are included in
reported invocation elapsed time; this is not cumulative training time. Continuation
metadata distinguishes earlier updates from newly committed updates.

The queue copies typed bytes separately from JSON metadata. Cancellation/failure
leaves the prior main-thread retained state untouched; unfinished worker work is
lost. Late replies/imports are suppressed by tickets and import generations. Physical
input changes clear the slot's checkpoint, while target/time changes preserve it.
The shared 96-MiB accounted-byte store evicts oldest retained slots with feedback.
It is not a heap/process bound; copied inputs, exports, engine structures and browser
allocations are additional. Payloads are capped at 48 MiB and metadata at 600,000
UTF-8 bytes; preflight caps 200,000 states, 500,000 rows and 128 path transitions.

Runtime state is stripped before validating/persisting a strategy report or admitting
fresh root results to cache. Resumed/inspected results are excluded from the fresh-
settings cache. Whole-workspace v3 remains unchanged and clears retained CPU states
on restore. It stores reports/drafts, not solver bytes. A separate .emcpu file is
required to resume after closing or restoring. Native job checkpoints remain owned
by the separate Windows manager. No browser/Windows/GPU execution claim is added.


## 0.14 desktop implementation candidate

`desktop/DesktopHost.cs` supplies a Windows-only loopback host and control window.
`Start-Desktop.ps1` compiles it as x64 using Windows' CodeDOM C# provider and caches
output by source hash. No Windows C# compiler/runtime is available in this Linux
session, so compilation/Win32/PowerShell/installer behavior remains unexecuted.

The fixed 127.0.0.1:48713 service accepts authenticated prepared jobs only, with
strict bounded routes/bodies and foreign-Origin/Host refusal. Static START.html is
served locally. Session credentials are confined to the launch fragment, sessionStorage
and a temporary private ready file; they do not enter workspace/study serialization.
Native manager code is launched suspended, assigned to a kill-on-close Job Object,
then resumed. It uses the existing runner's new headless/managed-work-folder mode.
The unchanged CLI supplies training, checkpoint compatibility and root/target queries.

`desktop-host.js` handles health/bound status, in-flight cancellation, timed waits,
last-job resume and native result verification. Study tickets suppress stale commits;
input changes/emergency/workspace replacement request cancellation. Failed network
cancellation is reported as unconfirmed with the host Stop path. Capacity testing
refuses known active/unconfirmed managed work. Manual native GUI jobs stay separate.

Install scripts stage/check versioned per-user releases and add Start menu/uninstall
registration without administrator changes. Old releases remain on update; no automatic
rollback/update service is implemented. Uninstall preserves job/diagnostic/browser/study
data. The Windows acceptance script compiles the real host, tests auth/refusal/native
execution and cancel/resume, then writes a credential-free diagnostic report. It is
provided, not executed here. Linux tests exercise mock protocol/UI and package wiring;
they do not prove Windows compilation, process cleanup or install/uninstall correctness.


## 0.15 desktop recovery and delivery control

The authenticated current-job endpoint returns the host's prepared job plus a bound
status. Find is read-only. Recover rechecks identity/revision before restoring the
original slot, config, optional reviewed proof and native binding. It does not
start a worker or submit/resume training. Running jobs are polled, completed results
are fully validated and interrupted jobs are adopted for a later explicit Resume.
Tickets and discovery generations block stale drafts/previews/commits.

Host status v2 adds an attempt revision (1–256). Cancel and Resume use the expected
revision; a repeated resume returns the already-created next revision. A full-job
cancellation-intent route fences a binding/attempt before acknowledgment, including
an intended resume revision. Skipping a fenced immediate resume advances its
cancelled revision while preserving the completed checkpoint, so a later explicit
resume can use the following revision. Older fences cannot stop newer attempts.

A canonical semantic job hash binds each slot/token once per host session. Repeated
current submissions return their existing status; altered or displaced bindings
are refused. At most 256 bindings and 256 revisions per binding are retained with
no eviction. Unknown bindings are refused once full; closing the host resets its
ledger and private credential together. No POST training retry is automatic.

Unknown submission/cancellation state remains busy until cancellation is confirmed.
Find alone cannot clear it, because an earlier delayed POST could still arrive.
Recovery first fences the uncertain attempt, then rechecks the current record.
The session credential remains transient; blocked sessionStorage retains the valid
launch fragment rather than disabling the session. Workspace format v3 is unchanged.
C# and Windows acceptance remain pending; tests use a protocol model/in-memory DOM.


## 0.16 shared in-page compute ownership

`workloads.js` owns transient identity-bound reservations. Ordinary study slots may
share the browser study queue; native preparation/recovery, benchmark, diagnostics
and image evaluation are exclusive modes. Replacement/cancellation revokes only
its own lease or explicitly stopped kind. Old completion handlers cannot release
a newer lease. Snapshots expose kind/slot/phase only, without requests, state bytes
or credentials. `workloads-ui.js` displays this queue/phase information and known
unconfirmed/running native work; it is not a process/resource monitor.

Before browser CPU work starts in a desktop session, an explicit user action checks
authenticated host health/current-job status. A lease is held across that read, and
generations/ownership are rechecked before worker allocation. Failure or running/
unconfirmed native work blocks startup. Portable pages do not probe a host. The
host can still change from a different browser after the read: this is single-page
coordination, not a host-side cross-client scheduler. One dashboard per session is
recommended until that measured shared scheduler exists.

Capacity/images preserve their explicit ordinary-study preemption. Diagnostics
can replace browser studies/capacity/images; all refuse a native operation before
interrupting it. CPU checkpoint inspection also participates in ownership. Stop,
workspace restore and invalidated tickets prevent delayed startup after cancellation.
Native Stop now terminates pending browser preparation as well as known host work.
Ownership/queue activity is intentionally excluded from workspace schema v3.

The Windows runner keeps the original target throughout restore and promotes
restored counters/checkpoint only after validation. The acceptance script checks
status target/counter consistency while polling. Neither PowerShell nor the Windows
host was executed here; Linux/JavaScript tests do not establish those OS behaviors.


## 0.17 persistent native history and sequential batches

The host writes per-job Archive records and small summaries under NativeJobs before
launch and after completed checkpoint/state changes. Per-file replacement is atomic;
record/summary/work-folder files are not a single filesystem transaction. Summary
browsing is bounded; full record reads check engine/job/binding/path metadata and
an unchanged record hash before adoption. Reparse-file/managed-folder checks and
fixed checkpoint filenames limit file access. Actual engine compatibility is checked
on explicit Resume, not inferred from these metadata checks.

History opening adopts saved settings and a stopped job reference without launching
children. Completed results still pass existing full native context/policy validation
in the browser. Prior managed-folder import is explicit and bounded. Old data is never
automatically deleted. Native job/checkpoint paths remain separate from CPU .emcpu and
workspace-v3 reports. Session credentials remain ephemeral and absent from records.

A batch accepts one bounded full request with 1–10 unique bound slots. A lock-protected
host timer owns a single current NativeRun and starts the next study only after the
previous result/archive reached its target without a memory-limit/failure outcome.
Native process ownership remains the existing Windows Job Object. The queue can
advance without browser polling. Foreground native launch/resume/open conflicts are
refused while it runs. Global/host cancellation stops queued entries as well as the
active child. Batch-ID fences prevent late submission after cancellation; recorded
IDs are idempotent and cannot execute the same batch again.

Batch status/request snapshots persist separately. Host startup never resumes work;
previously running batches become paused. Unfinished snapshots may be copied to a
fresh explicit batch; saved checkpoints resume individually. Browser draft queues
use their own JSON files, not workspace schema v3. Known batch work blocks conflicting
page compute workflows. This is sequential native coordination, not measured parallel
capacity, a cross-window browser resource lease, a GPU scheduler or total RAM accounting.

The Windows history/restart/batch acceptance implementation is included but unrun.
Linux tests cover JavaScript protocol/UI and independent engine files/continuation;
they do not prove C#/PowerShell/timer/process/NTFS behavior.


## 0.19 to 0.23 additions

| Component | Files | Scope |
| --- | --- | --- |
| Hand-state reconstruction | `src/hand-state.js` | Observation to validated table state, explicit rejection, revisions (OBSERVATION-ENGINE.md) |
| Image observation | `src/vision-ocr.js` | Glyph OCR, layout profiles, image observer, metrics, replay; synthetic images only |
| Solver service | `src/solver-service.js` | Engine identity, negotiation, push/fold study decision source, bounded queue, cache (SOLVER-INTEGRATION.md) |
| Test executor | `src/test-executor.js` | Study/Simulation/QA modes and guarded execution (TEST-EXECUTOR.md) |
| Multi-table scheduler | `src/multitable.js`, `src/multitable-ui.js` | Ten isolated workers, budgets, faults, checkpoints, dashboard panel (MULTI-TABLE.md) |
| Hardware validation | `src/hardware-report.js`, `windows/Test-Hardware.ps1`, `tools/collect-hardware-facts.cjs` | Facts to report; never claims GPU acceleration |
| Windows host | `desktop/DesktopHost.cs`, `desktop/bin/`, `windows/Start-Desktop.ps1`, `windows/Rollback-Workbench.ps1` | Prebuilt host with compile fallback, rollback, startup log |
| Tooling | `tools/train-study.cjs`, `tools/multitable-benchmark.cjs`, `tools/acceptance-ten-table.cjs` | Study training (native CLI or JS), benchmark and acceptance runs |

The simulator's scripted policy remains only as an explicitly labelled fallback; fallback actions are never counted as solver decisions.
