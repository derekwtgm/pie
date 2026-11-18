# Save and continue browser CPU training — 0.13.0

A CPU checkpoint contains the trained strategy sums, committed update count and
random-number state needed for continuation. It is a separate `.emcpu` file.
Ordinary policy reports and workspace backups cannot recreate that state.

## Use the controls

1. Open **Study workspace** and leave **Retain training state after a fresh browser
   CPU study** checked. Run a supported root or reviewed-position study.
2. The checkpoint panel shows the last retained committed count for that slot.
3. Increase **Updates** to the desired **total**, then choose **Continue to total
   update target**. A state with 100 updates and a target of 300 adds 200 updates.
4. Choose **Save CPU checkpoint** before closing the page or restoring a workspace.
5. Choose **Open CPU checkpoint** to validate and reopen it later. Opening queries
   the saved policies but does not train. Continue explicitly when ready.

`examples/cpu-root-demo.emcpu` and `cpu-reviewed-demo.emcpu` each hold 100 committed
updates toward a 300-update target. The reviewed example preserves the half-pot
river decision at `r1`, with the original hero facing the bet.

Continue requires the same normalized configuration and captured proof: ranges,
menus, seed, board, stacks, contributions and position cannot silently change.
The total target and per-invocation time budget may change. A target below the
saved count is refused. A target already reached is queried without training.
The existing maximum total remains 50,000 updates.

Fresh **Run CPU study** starts a new study, subject to the existing exact-settings
report cache. **Continue** uses the last retained training state. A cached report
contains no state and cannot make an absent checkpoint available. Clear the retained
state explicitly with **Clear retained CPU checkpoint**; its completed report stays.

## Cancellation and slot behavior

Each slot can retain its own state. Cancellation, worker errors, deadline expiry
or an invalid file leave its previous retained state intact. Work in the current
unfinished worker invocation is lost. There is no automatic periodic solver save
inside an invocation. Retention occurs after a completed worker response.

Changing physical study inputs, preparing another position, loading an example or
importing a strategy result clears that slot's retained state. Changing only the
total target/time preserves it. Checkpoint imports use worker validation before
replacing inputs/results, and late file reads/replies cannot overwrite later edits.

The page accounts for at most 96 MiB of retained state/metadata bytes across slots.
When necessary, it removes the oldest retained states and identifies their slots.
Save files when you need durable continuation. Browser shutdown/reload, workspace
restore and clearing a retained state remove these in-memory bytes.

The retention checkbox controls fresh root/reviewed browser studies. Continue retains
its next completed state. Native job exports, benchmarks and controlled synthetic
play use their existing workflows. Native checkpoint files remain separate and are
managed by the external Windows runner.

## What is saved

The container starts with `EMWBCP1` plus a newline, followed by three little-endian
32-bit integers: metadata length, state length and CRC32 of metadata plus state.
UTF-8 JSON metadata and the original EightMax EMMW4 bytes follow. Trailing or missing
bytes are refused. No base64 expansion or external crypto/runtime dependency is used.

Metadata format is `eightmax-workbench-cpu-checkpoint`, version 1, with these exact
fields: `format`, `version`, `engine`, `config`, `reviewedProof`, `updates`,
`trainingDeals`, `requestedUpdates`, `timeMs`, `decisionReady`.

The importer checks normalized inputs, engine build, proof, container CRC, allocation
counts/path depth and update/deal consistency. In a fresh disposable worker, the
original engine also checks its native row checksum, study identity and row semantics.
Restored strategy tables must fit the existing 32-MiB portable budget. A file can
have a valid container CRC and still fail the engine checks. Checksums detect damage
and inconsistency; they do not authenticate supplied policies or certify convergence.

| Bound | Limit |
| --- | --- |
| Native state bytes | 48 MiB |
| UTF-8 metadata | 600,000 bytes |
| Complete file | 50,931,668 bytes |
| Retained state and metadata bytes across slots | 96 MiB |
| Native state entries | 200,000 |
| Native policy rows | 500,000 |
| Native state-path depth | 128 transitions |
| Total committed updates | 50,000 |

These are logical data bounds, not a total browser or worker RAM ceiling. Copies,
decoded metadata, native-continuation bytes, engine tables and browser allocations
add to peak memory. Large exports/validation can occupy the page. The parent worker
watchdog bounds restore/training/query work; target-PC timing and peak memory have
not been measured. If a completed study cannot retain a bounded new snapshot, its
report remains available and the previous retained state is kept with feedback.

## Reports and recovery

Results record `cpuContinuation` with version, operation (`fresh`, `resume` or
`inspect`), prior committed count and updates added. Elapsed time describes this
invocation, including restore/query/snapshot work, rather than total historical
training time. Inspection is labeled `checkpoint-opened` and adds zero updates.
Resume's training budget begins after restore and reviewed-path validation.

Runtime checkpoint bytes are removed before report export, caching and workspace
capture. Resumed/inspected results do not enter the fresh-study cache. Whole-workspace
format stays version 3; v1/v2/v3 backups remain readable. Restore clears retained CPU
states and never resumes training. Save/open a separate `.emcpu` file for continuation.

Deterministic checks matched uninterrupted final state bytes on two-, three-, six-
and eight-player examples, retained the reviewed actor's exact path/policies, and
continued an exported CPU state through an independent Linux native CLI. These tests
do not establish convergence or full-game GTO. The engine libraries/C++/Windows binary
are unchanged. Actual Windows execution, visual browser/file dialogs, large-file
target-PC behavior, GPU scheduling and live-client integration remain unvalidated.
