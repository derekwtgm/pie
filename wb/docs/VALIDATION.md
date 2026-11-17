# Validation record — 0.17.0

Executed on Linux x64 with Node 24.22.1 and a native CLI compiled from the supplied
EightMax 5.1 source (g++ 14.2.0, strict floating-point settings). No NVIDIA hardware.

## Passed

- **353 Node test cases**, zero failures/skips. See `0.17-test-results.txt`.
- **20 simulation regression cases**, including 200,000 scheduler ticks over ten
  tables and 9,884 completed hands without table faults. See `core-test-results.txt`.
- The original UI handler check passed separately (`ui-logic-test-results.txt`).
- Every application JavaScript source passed `node --check`.
- Generated standalone HTML contains unique IDs and embedded scripts/styles/worker;
  it requires no external script/style asset. The final ZIP is checksum/CRC checked.

## Native history and batch validation

Twenty-eight added cases exercise saved-record/summary/quality validation, read-only
history, unchanged-record opening, interrupted adoption, stale versions, import bounds,
unique-slot/count/byte limits, strict batch outcomes, idempotence, lost replies,
cancellation before POST/connection, unresolved cancellation, stale polls, paused/
completed rediscovery, old-batch cancellation, original-slot UI opening, late edits,
zero-training draft preparation, draft Save/Open, compute exclusion/global Stop,
no automatic report commits, invalid/stale imports, portable fallback, runtime-free
backups and copying only unfinished entries into a new draft.

Twenty-six are protocol-model/in-memory UI tests. They exercise the actual
JavaScript client/validators/handlers, not the C# backend. Two additional tests use
the compiled Linux EightMax CLI: a disk-saved checkpoint opens without byte mutation
and explicitly continues to matching 300-update policies; separate root/reviewed
native runs save distinct accepted result files. Those tests do not execute the
Windows archive writer, timer, file replacement, restart loader or PowerShell runner.

RUN-DESKTOP-CHECKS.cmd now includes actual host history/restart/checkpoint open/resume,
stale record refusal, sequential batches and pre-delivery batch cancellation. This
expanded Windows acceptance script was provided, not run. C# compilation, NTFS atomic
writes, Windows Job Object cleanup, installer and visual browser execution remain
unverified. Source/transport checks are not evidence of Windows execution.

## Shared compute workflow validation

Twenty-two new cases cover ten browser slot reservations, exclusive ownership,
stale/forged releases, atomic invalid requests, immutable snapshots, display failure,
queued/running activity, native-preparation exclusion, diagnostic/image/capacity
coordination, retained-checkpoint opening refusal, host-current discovery after
reload, read-only startup checks, emergency cancellation during pending discovery,
late cleanup versus newer owners, disconnected hosts, native recovery exclusion,
transient workspace state, restoring target/counter refusal and native Stop during
browser preparation. UI tests execute actual handlers against the in-memory DOM;
desktop HTTP replies are controlled fixtures, not execution of the Windows host.

The native PowerShell restore path was corrected in source and the Windows acceptance
script now checks original target/counters at every observed status poll. PowerShell
and that acceptance script were not executed here. The JavaScript status contract
refuses contradictory restore targets; actual Windows restore/process behavior remains
pending. Resource ownership is per page and does not measure RAM/VRAM, arbitrate other
browser windows or certify simultaneous native/table capacity. See COMPUTE-WORKFLOWS.md.

## Desktop recovery validation scope

Twenty-nine added cases exercise a JavaScript host protocol model and the actual
JavaScript client/dashboard handlers: empty/malformed/read-only discovery, reload
attachment to running/completed/interrupted jobs, explicit revisioned resume,
idempotent delivery, changed bindings, lost replies, cancellation before delayed
submission/resume delivery, unresolved-state exclusion/recovery, stale cancels,
replaced jobs, preflight cancellation, revision and ledger bounds, blocked session
storage, original-slot/proof restoration, legacy root recovery, draft/slot changes,
credential-free backups and emergency/capacity behavior.

The model is a test fixture implementing the intended contract. It does not execute
or independently prove the C# backend. The Windows acceptance script was updated to
exercise those routes on the actual host, but was not run here. No Windows hardware
check is needed to receive this implementation; target-Windows acceptance remains
outstanding. The 0.14 desktop tests below also remain in the full regression run.

## Desktop candidate validation scope

Twenty added cases exercise the JavaScript client and in-memory dashboard with a
simulated HTTP transport: exact origin/session context, read-only health, protocol/
build/binding/stage refusal, valid result exchange, concurrent connection/submission
races, in-flight/early/cross-slot cancellation, resume binding, unconfirmed cancellation,
deadline/size/route limits, portable fallback, manual root/reviewed routing, credential-
free backups, stale edits, global emergency behavior and capacity exclusion. Package
checks confirm entry points/source wiring and intended build/containment controls.

These tests DO NOT compile/execute the C# host, PowerShell, Win32 Job Objects,
installer/registry/Start menu or the Windows executable. No Windows/.NET/C# compiler
was available here. RUN-DESKTOP-CHECKS.cmd is supplied for actual Windows build,
headless-host/native/cancel/resume acceptance; it was not run. It does not replace
visual browser/host-window or installer/update/uninstall acceptance. No prebuilt or
signed EXE/MSI installer was generated. See DESKTOP-WINDOWS.md for exact scope.

## Portable CPU checkpoint validation

Twenty-two added cases cover binary CRC32/container and metadata round trips,
engine/settings/counter refusal, allocation bounds, original row checksums despite
valid container CRC, changed study identity, cumulative targets and fresh restores,
byte-exact continuation on two-/three-/six-/eight-player profiles, reviewed actor/path
policies, owned bounded state storage/eviction, report/cache separation, UI Save/Open/
Continue, target/time edits, cancellation, independent slots, atomic invalid imports,
stale reads/replies, workspace clearing/cache behavior and optional retention.

Two added queue cases cover typed-byte copying without JSON expansion and refusal
of invalid state without superseding valid work. Four generated-worker cases execute
actual retention, exact cumulative continuation, reviewed inspection without training
and later continuation, and refusal of corrupt/implicit/below-target state.

The independent Linux CLI resumed a 100-update CPU export by 200 updates to the same
300-update root policies. Four direct examples resumed to byte-identical full native
exports at 300 total updates. These are deterministic-continuation checks, not a
convergence, strategic-strength, target-PC performance or real-client capacity claim.
Windows startup/executable execution and actual browser rendering, file selection,
downloads and large-checkpoint behavior remain unverified.

## Native reviewed-position validation

Twenty-one added cases cover zero-training exports/state preservation, exact mixed
path projection, root/target separation, invalid job/spec/menu/proof data, complete
range/blocker/weight/probability checks, full history and public ledgers, equal
completed counters, native zero-average rows, legacy v1 root import/refusal, file
bounds, manual export/import/status, latest binding and stale-worker refusal,
workspace-v3 target consistency and migration from the preserved 0.10/v1 and
0.11/v2 examples. Two additional generated-worker cases exercise real v2 export and
off-menu refusal through the embedded bundle.

Linux native integration compares 100/350/550-update continuation with uninterrupted
1,000-update policies at the non-root river decision, and compares its stored rows
to the portable reference. Multi-street queries retain the actual turn card and
exclude newly blocked private hands. Two-, six- and eight-seat preflop paths reach
the same flop actor. Tiny explicit weights survive CLI query rounding. Native
queries leave checkpoint bytes unchanged. These tests validate the exchange; they
do not certify convergence, real-client recognition or target-PC capacity.

The Windows manager was adapted to issue root and target queries from one completed
checkpoint and emit the version-2 envelope. It has not been run here. PowerShell,
Windows Forms/process cancellation, native PE execution, dialogs, downloaded-file
behavior and visual browser layout still require target-Windows acceptance.
Imported counters/path/context can be checked for consistency but do not authenticate
policy values or prove checkpoint provenance. See `NATIVE-REVIEWED.md` and
`0.17-release-verification.json` for scope and unchanged engine identity.

## Reviewed-position mapping validation

Twenty-one added cases cover rotated/non-root actor policies, menu-derived action
indices, off-tree and same-rounded-label one-chip refusal, root ledger/ante/ICM
invariants, root-folded contributions, later folds, short all-in reopening,
combined action/card transitions, 2/6/8-seat preflop-to-flop order, explicit street
re-rooting, missing rows, input weights, out-of-range hero, unchanged training/RNG
state, malformed/closed/oversized evidence, selected-step future-evidence exclusion,
report consistency, mapping deadlines, cache isolation, real control IDs, manual UI,
slot isolation, workspace-v2/version-1 migration, standalone drafts and native
comparison at the mapped non-root river node.

Two generated-worker tests execute the actual bundled reviewed mode in a separate
JavaScript thread and reject an off-menu bet before returning a result. The Linux
C++ CLI actor/pot/stacks and non-root hand frequencies match the same configured
reference study. This checks extraction/matching/query plumbing, not convergence
or real recognition. The engine library/source/binary are unchanged. Version 0.12 adds the mapped native exchange documented below. Windows execution
and CUDA integration remain unverified/pending.

Imported reviewed reports receive structural/context validation, not an independent
solver run or authenticity check. Original temporal recognition evidence is not
recreated from a standalone snapshot proof. Missing later-street rows remain an
important practical limit, especially for broad preflop exact-card studies.

## Whole-workspace and native-management validation

Eighteen new workspace/diagnostic cases cover mixed authoring-state round trips,
unfinished invalid JSON and guided edits, embedded/external originals, automatic
recovery startup/quota behavior, atomic invalid imports, per-component validation,
base64/reference/byte bounds, stale calculations/imports, report recomputation,
rollback, bounded browser-check requests/cancellation, imported Windows reports,
all selected image assets, and a late calibration-image decode.

Eight native-management cases cover numeric controls, slot/token binding, status
validation, bound export persistence, stale/wrong result refusal, input invalidation
and actual CLI continuation/refusal. On the Linux CLI, 30/40/80-update chunks match
an uninterrupted 150-update policy on river3 and flop6; restored counts and root
averages agree. A mismatched spec is refused without changing the checkpoint.

These tests do not execute PowerShell, Windows Forms, the Windows PE executable,
launcher/browser discovery, real file dialogs or Windows cancellation/timeouts.
No PowerShell/.NET/Wine runtime was available here. Windows scripts were manually
reviewed and their package references checked; acceptance on the target PC remains
necessary. Browser UI cases use the in-memory DOM, not a visual renderer.

## Labeled image validation

Twenty-eight added tests check scoring/denominators, explicit negative cases,
missing evidence and reduced coverage, decode/image limits and isolation, exact
reference overlap, layout/duplicate-card rejection, exact amount labels, ten-table
identity with single-decode reuse, strict schemas/count/byte bounds, cancellation,
run generations, input snapshots, sequential decode and pixel-free reports.

In-memory UI cases check synthetic and manually imported data, mocked browser
bitmap decoding/closure, oversized decode cleanup, emergency stopping and CPU-work
exclusion, calibration invalidation, stale imports, atomic bad imports, guided
label creation/update/removal/export, contradictory card labels, preview clearing,
empty drafts, table-ten labels and safe text rendering. Actual browser decoding,
canvas display, native dialogs/downloads and Windows launch remain unverified.

The six synthetic PNGs exercise an evaluation pipeline. The deliberate 60%
accepted-label accuracy (six correct / ten accepted), four wrong accepts including
two negatives, two correct rejections and two exact-reference overlaps are fixture
properties, not measurements of KKPoker or a trained model. The 50% no-exact-
reference-overlap score is also a fixture property. No real-client dataset was
provided, and no live recognition accuracy or holdout independence was established.

## Review continuation and inspection validation

Twenty-three additional tests cover every save boundary of synthetic fold/refund
and side-pot hands; preservation of one-frame candidates, custom settings, paused
payouts, changed source evidence and reviewed resets; ten-table fault isolation;
strict schemas/rules/journal ordering; UTF-8/frame/operation bounds; data isolation;
accepted-snapshot inspection; reused hand IDs after reset; 105-hand archive
retention; and a long-hand inspector that explicitly truncates beyond 256 steps.

In-memory DOM cases cover manual partial-review export/import, separate local
recovery with no startup processing, quota failure and clear behavior, atomic bad
imports, a late asynchronous import, selected-hand export, and a malformed source
frame. They check that no solver worker or simulation action starts. Tests use
supplied synthetic observations only. Re-audit can detect supported contradictions
but cannot authenticate or prove the truth of a recording. Local recovery's actual
file-origin behavior, native file dialogs/downloads and browser rendering remain
unverified here; these tests use an in-memory DOM/storage implementation.

## Settlement and hand-record validation

Twenty added tests cover uncalled refunds, main/side pots, split/odd chips, common
layer merging, exposed-card requirements, fold wins, payout/refund/stack rejection,
closed-round prerequisites, guarded next-hand admission, duplicate settlement,
bounded retention, schema checks, review UI/export, wrong-but-balanced winner
payments, later contradictory evidence, posting metadata, gap bounds and isolation.

One test compares 100 seeded 2–8-player chip allocations with the supplied EightMax
pot-layer function and independent source card ranking, including common chips and
odd-chip distribution. The seeded comparison uses all live seats; separate cases
cover folded contributors and uncontested winners. A 105-hand synthetic session
checks archive retention and record IDs. A side-pot demo awards a 600-chip main pot
and 200-chip side pot; a fold demo separately returns 50 uncalled chips and awards
120 matched-pot chips before validating the next hand's posts.

These are checks of supplied integer-chip evidence under the stated fixed payout
policy. There is no real-client footage/recognition validation, rake model, hidden-
card inference or authentication. UI tests use an in-memory DOM, not a visual
browser renderer. Completed-hand exports are reports only.

## Preflop and preflop-to-flop validation

Ten added tests cover posting pot/order, heads-up behavior, rejection of bad posts,
preflop-to-flop sequences, initial and later street study mapping, incompatible
posting changes, import inventory/timeline, and manual UI handoff without a worker.
One case compares betting movements with the separate simulator across 100 seeded
2/8-seat hands, before final payout. Actual EightMax specs were built for 2/6/8
preflop roots and a six-live-player flop reached from an eight-seat preflop history;
blind/ante pots and preserved folded contributions matched.

These are synthetic input and code-equivalence checks, not real-client observation
accuracy or general blind-posting validation. Unsupported short posts/BBA/straddles
are rejected, not emulated. No physical Windows/GPU validation was added.

## Anchored round and handoff validation

Ten new tests passed: checks/bets/calls and expected actor order; full versus short
raises; cumulative reopening; rejection without mutation; final-call / next-street
combination; 100 seeded postflop-round comparisons against the scripted simulator;
contribution and seat mapping in study preparation; UI handoff without launching a
worker; wrong-turn rejection; and typed closure evidence. The independent simulator
settles final payouts whereas the reconstruction model stops before payout, so
comparisons cover betting movements before settlement only.

This validates the tested anchored postflop subset. It does not establish correct
recognition of real-client observations or complete preflop-to-showdown history.

## Observation audit validation

Eleven new tests passed for stable evidence gating; calls/folds; low-quality,
duplicate-card and pot checks; sequence/gap/hand boundaries; ambiguity pauses;
missed actions; conservation; street continuity; ten-table isolation; explicit
resets; canonical ordering; file bounds; and the review UI demo/export. Fixtures
are synthetic only. They do not establish real-client recognition or complete
betting-history accuracy. Caller-supplied quality values are not authenticated.

## What the other tests establish

Guided inputs produce supported real studies; previous wagers and ICM fields
survive form edits, and incompatible changes are rejected. Invalid boards, amounts,
empty ranges and contradictory imported policies are refused.

Fifty controlled toy hands used frequencies equal to direct EightMax policy queries,
settled their full pots, and reproduced from fixed seeds. Exported training bytes
were unchanged after practice. All-in runouts were card-consistent. Missing policies
blocked actions. ICM play and malformed practice files were refused. These tests
exercise a configured abstraction, not full-game equilibrium accuracy.

The worker pool stayed within its logical two-job limit, rejected queued/late
requests, and cancelled running and pending work. Cache tests covered exact input
matching, copied results, incompatible-result exclusion, eviction and byte limits.
Benchmark tests separated failures, deadline misses, partial-update results and
completed-request percentiles. UI handlers covered the entire benchmark/export,
stop behavior, guided edits, cache hits and controlled-hand replay.

The actual worker source embedded in START.html ran in isolated Node worker
threads and produced real strategies, native specs and controlled hands. This tests
worker logic but does not validate browser Blob Worker launch/security behavior.

## Native/source comparison and recovery

The bundled source modules and Windows mwcli.exe retain their recorded 5.1 SHA-256
hashes and build provenance. Native root policies were compared against the browser
reference after 150 updates for every bundled example, including the new heads-up
practice example. Root frequencies matched, with missing rows kept unavailable.
A direct river comparison also used 500 updates.

The comparison CLI was built locally from the supplied source and identifies as a
Linux development build. It is not execution of the bundled Windows PE binary.
These checks validate adapter equivalence for the tested settings, not independent
proof of a complete-game Nash equilibrium.

Ten saved simulator tables continued for 1,000 additional steps each with matching
RNG states, decks, scripted decisions and snapshots. Restore deliberately changes
action epochs and pauses scheduling; it is not solver-training continuation.

## Laboratory benchmark

`benchmark-linux-0.3.json` retains the earlier 0.3 laboratory runs of the generated worker source using
one and two workers, 1,000 updates per three-player river study, fresh worker
startup, 1/2/5/10 request bursts and a 10-second end-to-end deadline. Its environment
metadata identifies the development machine. The narrow-ranged fixture is not a
representative complete workload for six-way poker or ten live tables.

This is one burst per count, without repeated trials or a convergence target. It
excludes capture, OCR, client execution, full practice playback, native/CUDA work
and unrelated desktop load. It is NOT a benchmark of the user's Windows i7 /
RTX 4060 Ti 8-GB / 16-GB-RAM computer. No live table count is certified.

## Remaining validation limits

- Browser visual rendering, file-picker/download behavior and Windows launch are
  unverified. Prior local preview attempts were blocked by browser policy.
- Windows launcher/check scripts and the PowerShell native progress/cancel/resume
  manager have not been executed here. Linux CLI tests validate engine continuation
  and protocol use, not the Windows GUI or OS-level process cancellation.
- This remains a portable HTML application, Windows script launcher and optional
  native CLI workflow, plus Windows desktop-host source, first-run compilation
  and per-user install scripts. No prebuilt/signed installer or validated Windows
  desktop binary was built in this environment.
- No physical NVIDIA/CUDA/VRAM or whole-process RAM validation was performed.
- Image calibration/evaluation tests use labeled synthetic pixels and mocked UI
  decoding, not a real KKPoker screenshot dataset. Whole-workspace recovery can
  retain evaluation drafts/reports; original image bytes require a manual backup
  or reattachment. Older component recovery formats stay separate.
- There is no trained live recognizer, observed-hand reconstruction, unrestricted
  mid-street mapping, client execution or detector integration in this release.
- Guided forms retain an Advanced editor for settings they do not expose.
- Exact-settings caching does not establish convergence or strategic quality.
- Component recovery remains separate. The new whole-workspace recovery includes
  drafts/results/calibration/labels/review metadata. Automatic recovery excludes image
  bytes and rolling simulation replay; manual backups can embed available originals.
  In-flight worker state and native binary checkpoints use separate workflows.
  Target-PC peak memory, large-backup latency and local file-origin storage behavior
  remain unmeasured.

## Developer reproduction

End users need no developer runtime to open START.html. Developers can run:

```
python3 tools/build.py
node tests/core.test.cjs
node tests/ui-logic.test.cjs
node --test tests/session.test.cjs tests/solver.test.cjs tests/queue.test.cjs tests/worker.test.cjs tests/vision.test.cjs tests/extended-ui.test.cjs tests/forms.test.cjs tests/play.test.cjs tests/cache.test.cjs tests/benchmark.test.cjs tests/observations.test.cjs tests/round.test.cjs tests/preflop.test.cjs tests/settlement.test.cjs tests/review-session.test.cjs tests/image-validation.test.cjs tests/workspace.test.cjs tests/native-management.test.cjs tests/reviewed-study.test.cjs tests/native-reviewed.test.cjs tests/cpu-checkpoints.test.cjs tests/desktop-host.test.cjs tests/desktop-recovery.test.cjs tests/workloads.test.cjs tests/native-archive.test.cjs
node tools/node-benchmark.cjs
```

Set EIGHTMAX_TEST_CLI to a compiled native CLI to run, rather than skip, the native
comparison test. Included native source can be built on Linux using:

```
gcc -O2 -c native/source/json.c -o /tmp/eightmax-json.o
g++ -std=c++20 -O2 -ffp-contract=off -Inative/source native/source/mw.cpp native/source/mwcli.cpp /tmp/eightmax-json.o -lpthread -ldl -lz -o /tmp/eightmax-mwcli
EIGHTMAX_TEST_CLI=/tmp/eightmax-mwcli node --test tests/solver.test.cjs
```

`tests/ui.test.cjs` is an optional Playwright smoke test for an unrestricted
browser environment. It has not passed here and is not counted above.


## 0.18.0 convergence checks and raised limits

Linux CLI compiled from the supplied source (`native/source`, g++, strict FP flags as above).
`EIGHTMAX_TEST_CLI=/tmp/eightmax-mwcli node --test <all test files> tests/convergence.test.cjs`:
364 pass, 0 fail, 0 skipped; core simulation 20 pass; UI handler check pass.

New native-engine cases (tests/convergence.test.cjs):
- heads-up exact checks every 500 updates fall more than 10x from 500 to 3,000 updates; exploitability = NashConv/2;
- 3-player river exact per-seat gains in % of the 12 BB pot; verdict "keep training" below an unmet target;
- 6-player flop: exact refused (422), automatic fallback to a lower-bound method, never "within target";
- 8-player preflop exact-only: reported unavailable, study result still imported;
- 60,000 updates (past the former cap) through chunked checkpoints, final check at the final checkpoint;
- tampered blocks refused (counters, seat count, settings, ordering, missing final, unknown mode, disabled-but-measured);
- dashboard export of convergence controls, result import/render, workspace save and restore.
The PowerShell runner and C# host were reviewed but not executed; `runNative` in the test mirrors the runner's steps.
