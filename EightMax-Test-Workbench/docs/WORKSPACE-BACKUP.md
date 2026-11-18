# Whole-workspace backups — 0.17.0

Open **Workspace backup**, choose **Save workspace file**, then use **Open workspace
file** to restore it later. Manual backups include selected screenshot files by
default. The save status reports originals that remain external references.
Try `examples/whole-workspace-demo.json` for a synthetic authoring example with a
completed toy study, mapped Linux-native report/export binding, validation report
and partially processed hand review.

| Included | Restore behavior |
| --- | --- |
| Simulation state and manual rolling replay | Fresh validated coordinator; global running is false; old action epochs invalidated |
| Study slots, completed results and unfinished text/guided edits | Drafts and reports return; no worker resumes |
| Native controls, root/reviewed exported jobs and status snapshot | References/bindings return; Windows process/checkpoint remains separate |
| Calibration, templates, selection and editor | Calibration returns; Show saved image decodes the source only when chosen |
| Validation labels, pending label text, selected originals and historical report | Data returns; no evaluation starts |
| Observation sequence, cursor, reset journal and entered ranges | Processed prefix re-audited; remaining frames wait for manual processing |
| Benchmark settings/report and diagnostics | Historical reports return; no benchmark/probe starts |

Eligible completed root-only CPU study results repopulate a fresh exact-settings cache.
The prior cache's complete LRU order, in-flight training state, retained portable CPU
checkpoint bytes and native binary checkpoint files are not part of the backup. The deterministic synthetic
validation images/reference set are regenerated from their fixed pattern source.

Desktop credentials and managed-process handles are not saved. Restoring a workspace
requests cancellation of current managed desktop work; bindings/reports return as data
only. The host session/last-job resume reference must still exist separately.

Portable CPU checkpoints use separate .emcpu files. Workspace restore clears all
in-memory CPU training states; it does not reconstruct them from policy reports.
Open a saved CPU checkpoint separately to continue. The new continuation counters
in reports describe an earlier invocation, not a resumable state or cumulative time.

The file is an editable evidence package, not an authentication or convergence
certificate. Stored strategy results keep their existing quality limits. Recognition
and benchmark aggregates are rebuilt from validated outcomes/rows, rather than
trusted from saved headline scores.

## Automatic recovery

A separate whole-workspace key attempts changed data every 10 seconds. It stores
source-image references and omits rolling simulation replay. It preserves drafts,
reports, templates and review progress. Startup offers an existing save without
opening it or overwriting it with unchanged defaults. **Recover workspace** reopens
the save explicitly with processing stopped.

If storage is unavailable or full, the earlier value remains and the UI reports the
failure. That revision is retried only after a further change; manual export remains
available. Clearing the automatic value suppresses re-saving the current revision;
further edits can create a new save. Storage quotas, private browsing, browser cleanup
and moving the extracted release can affect recovery. Export a manual file before
closing when you need a durable copy.

Recovered image references do not contain original bytes. Reselect those images
before previewing or repeating validation. A manually exported file can embed
available originals, but cannot recover an original already missing from memory.
The save/restore status gives the missing count. Old simulation/review component
saves remain independent formats and cannot be opened as whole-workspace files.

## Envelope

Format is `eightmax-workspace`, version 3, with exact top-level fields:

`format`, `version`, `appVersion`, `engine`, `simulation`, `studies`, `calibration`,
`review`, `labels`, `benchmark`, `diagnostics`, `assets`, `decisionReady`.

Version-1 files from 0.10 and version-2 files from 0.11 migrate to version 3 in
memory. Version 1 receives null reviewed links and original-anchor scope; version
2 retains its captured proofs/reports. New files can retain a reviewed proof AND
its version-2 native export in one slot. The native target, draft settings, source
proof and any stored result must agree. A root-only export cannot bind a reviewed
position. Releases 0.10/0.11 cannot read v3; 0.12 and 0.13 use this same workspace version. Restoring any report/export never starts a
worker or native process.

The engine build must match EightMax 5.1 `7d08acc7eb4577ee`; decisionReady stays
false. Every component is validated before replacing the current workspace. Assets
have `id`, `name`, `type`, `size`, `base64`; null base64 denotes an external reference.
Image references must resolve, sizes must agree and embedded data must use canonical
base64. Blobs are constructed before committing; screenshots are not decoded then.

Restore cancels old browser work and validates fresh simulation/review objects.
It attempts to restore a separately validated prior snapshot if a component apply
unexpectedly fails. A rollback failure is explicitly reported. In-flight work is
never restarted during either restoration or rollback.

| Bound | Limit |
| --- | --- |
| Entire JSON file | 220,000,000 UTF-8 bytes |
| Original image bytes | 110,000,000 bytes total |
| Image assets | 101: one calibration original plus up to 100 selected validation images |
| Individual image | Existing 10 MB limit |
| Study result | 2 MB each; up to 10 slots |
| Simulation / review components | Existing 20 MB continuation limits |

Existing calibration, dataset and report bounds also apply. Base64 increases file
size. Large JSON/base64 validation and review replay can briefly occupy the page.
These are logical file/count bounds, not a measured whole-process RAM ceiling or
latency guarantee on the target Windows computer. Automatic saves can exceed a
browser's storage quota well below the manual-file limit.

Windows native checkpoints/logs remain in their NativeJobs folders. Resume them
through the Windows native manager and the original exported spec/job. Browser
workspace restore has no OS-process connection and cannot stop or resume them.

Automated coverage uses Node and an in-memory DOM with mock image decoding. Native
file picker/download behavior, actual browser rendering, large-backup target-PC
performance and Windows launch remain unverified here.
