# Saved native studies and batches — 0.17.0

This release adds persistent managed native-job history and sequential batch work.
It uses the original EightMax 5.1 CPU executable. It does not increase solver accuracy,
add a GPU scheduler or establish live-table capacity.

The Windows implementation is a candidate: the C# host, PowerShell, timer, file
replacement and Windows restart/process behavior have not been executed in this
Linux environment. The provided Windows acceptance script covers those operations
when run on Windows. JavaScript/model and Linux native tests are described separately
in VALIDATION.md.

## Saved study workflow

1. Use START-DESKTOP.cmd and prepare/run a native root or reviewed study normally.
2. Choose Refresh saved studies, select a dated slot/status entry and Inspect it.
3. Open saved study restores its original settings, captured proof and native
   binding into the original slot. It replaces that slot's draft/report and clears
   retained browser CPU state; save the workspace first when those edits matter.
4. A completed result is collected through the existing native context/policy checks.
   Opening does not train. An interrupted record offers Resume explicitly when its
   completed checkpoint file is still present.

New managed jobs save records before child launch and after checkpoint/state changes.
They survive host replacement/restart. A new host starts idle with a fresh private
session credential. It does not automatically adopt, resume or query an old solver.
A completed saved result can be opened after another job replaced the current one.

Inspect reads a full record. Its record hash must still match on Open; a changed
attempt/record is refused. Checkpoint references are restricted to known managed
folders/files. The original engine verifies checkpoint compatibility/checksums when
Resume is explicitly requested. Metadata/file existence alone is not an engine
validation, authentication of supplied policy values or convergence certificate.

Import prior managed folders explicitly scans up to 64 recent folders from a bounded
4096-directory scan. It can index version-2 desktop statuses from earlier releases.
Duplicate archived IDs are left alone; unreadable/unsupported entries are skipped.
It does not index every manual native GUI folder or silently migrate unknown formats.
Older/manual folders remain available through their existing manual workflows.

History displays up to 128 readable summaries from a bounded 4096-file scan. A corrupt
summary is skipped; a stale summary can still be refused when its full record is read.
No data is automatically pruned/deleted. Lists may be limited; job folders remain.

## Draft batches

Add current study to batch checks/prepares the configured slot without training.
A reviewed study keeps its exact captured path. Add saved study to batch uses the
inspected job's original settings. There is one snapshot per slot; adding the same
slot replaces that draft entry. Later study edits do not change the snapshot.

A draft accepts 1–10 unique slots and at most 1 MB of combined prepared-job JSON.
Save draft batch writes a separate JSON file. Open draft batch validates all jobs
before replacement and never starts training. Drafts are separate from workspace
schema v3. examples/native-batch-demo.json provides a small root/reviewed example.
Portable START.html can prepare/save/open drafts, but execution requires the host.

Start native batch creates a new batch identity and fresh per-slot bindings. Accepted
batches run one native study at a time using the existing per-job CPU/thread/memory/
timeout/checkpoint controls. The host timer advances the queue without browser
polling. Closing the dashboard keeps accepted work running; closing the host stops
its active process group and remaining queue.

Each completed result is stored with its saved native job. Progress lists counters,
partial/limit outcomes and saved-study availability. Results do not overwrite open
study drafts automatically. Use saved history to inspect/open them explicitly.

## Failure, cancellation and restart

The batch halts when a study fails, is cancelled, reaches a memory limit, fails to
reach its requested updates or cannot persist its completed archive. Completed files
and checkpoints are kept. Remaining snapshots stay in batch metadata.

Stop native batch fences its identity, cancels active/queued work and keeps completed
entries. Browser emergency stop and the desktop host Stop/Close control stop batch
work too. An old batch ID cannot cancel a newer batch. A cancelled delayed initial
POST is refused. Repeated delivery of an existing batch ID returns its stored status
rather than starting it again; changed jobs under the same ID are refused.

The client does not automatically retry a training POST. A lost reply requests batch
cancellation by its original ID, including before acknowledgment. Unconfirmed state
stays busy until cancellation is confirmed. A late status poll cannot resurrect a
cancelled batch. If the connection is unavailable, the host Stop/Close control remains
the direct path to stopping its owned processes.

A host restart loads prior batch metadata with work stopped. A batch left running by
an abrupt previous exit becomes paused; normal Stop/Close records cancellation.
Neither state starts work automatically. Check batch progress, then Copy unfinished
studies to draft to create fresh runs of incomplete snapshots. Completed entries are
excluded. To continue existing training, open the individual saved job and Resume its
checkpoint explicitly instead. The batch queue does not automatically resume solver
checkpoints after restart.

## Storage and limits

Archive records/summaries and batch metadata live under the existing per-user
NativeJobs/Archive directory, with completed results/checkpoints in their managed
job folders. Per-file metadata replacement is atomic; record, summary, status and
checkpoint files are not one filesystem transaction. Full record reads and unchanged
record hashes protect adoption against stale summaries. Keep these folders together;
a metadata JSON file alone is not a portable native checkpoint container.

Native .state files, browser .emcpu files, strategy reports, draft-batch files and
workspace backups are distinct formats. No session credential is persisted in the
native archive or exported batch/workspace files. Installer/uninstaller scripts
preserve NativeJobs as before. There is no automatic data deletion or background
update service.

Request bodies remain 1 MB. Saved records/batch metadata are bounded to 1.2 MB,
summaries to 6000 bytes, native status files to 20 KB and result envelopes to 6 MB.
The existing 256-binding/256-attempt session limits remain; batch cancellation IDs
are also bounded. A full cancellation ledger refuses new unknown batch submissions,
so it can confirm cancellation without evicting an earlier fence. Restart creates a
new private session. These are protocol/storage limits, not process RAM/VRAM caps.

Native queue/foreground conflicts are refused by the host, including requests from
another dashboard. Browser worker ownership remains per page; use one dashboard per
host session. There is no measured parallel scheduler, native shared strategy cache,
cross-window browser CPU lease, GPU acceleration or table-capacity certification.

## Routes and validation

| Route | Behavior |
| --- | --- |
| GET /api/native/history | Read bounded saved summaries |
| POST /api/native/history/import | Explicitly import prior managed folders; no training |
| GET /api/native/history/{id} | Read validated saved settings/status/quality and record token |
| POST /api/native/history/{id}/open | Adopt unchanged record using its etag; no training |
| GET /api/native/batch | Read the latest persisted/current batch |
| POST /api/native/batch | Submit one bounded unique-slot batch; idempotent identity |
| POST /api/native/batch/{id}/cancel | Cancel/fence that batch identity before or after acknowledgment |

All use the existing private session, exact local Host/Origin checks and fixed routes.
History IDs are opaque selections, not user-selected executable/file paths. Existing
current-job, revisioned Cancel/Resume and result endpoints remain available.

RUN-DESKTOP-CHECKS.cmd now also exercises persistent history after another job,
idle host restart with a new credential, checkpoint Open without mutation, explicit
Resume after restart, stale-record refusal, two-study sequential batches and batch
cancellation before submission. It was not run here and does not replace installer,
visual browser, real-client recognition or target-PC performance acceptance.

The new JavaScript tests use controlled HTTP and an in-memory DOM. Two Linux CLI
checks additionally exercise disk checkpoint continuation and distinct root/reviewed
result files. They do not execute this Windows archive/timer/queue implementation.
