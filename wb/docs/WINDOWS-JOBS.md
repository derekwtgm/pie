# Windows launcher, diagnostics and native jobs — 0.17.0

This release includes portable Windows scripts using the operating system's
PowerShell/Windows Forms components. No Python/Node installation, downloaded module
or administrator setup is used. A compiled installer/desktop host remains pending.
The scripts were not executed in this Linux development environment.

## Desktop candidate

START-DESKTOP.cmd now supplies first-run x64 C# host compilation and dashboard
Run/Stop/Resume controls for a single managed native CPU study. INSTALL-WINDOWS.cmd
adds a per-user versioned installation; RUN-DESKTOP-CHECKS.cmd performs actual Windows
host/native acceptance. These Windows paths were not compiled or executed here.
See DESKTOP-WINDOWS.md. The manual launcher/job workflow below remains available.

## Start and diagnose

1. Extract the complete ZIP.
2. Double-click `START-WINDOWS.cmd` for release checks and browser launch.
3. `START.html` remains the direct portable entry point.
4. Run `RUN-WINDOWS-CHECKS.cmd` for the fuller diagnostic report.
5. In **Diagnostics**, import `EightMax-Windows-diagnostics.json` from its output
   folder. Run browser checks separately to exercise a bounded CPU-worker request.

The launcher checks listed release hashes, dashboard presence, OS architecture and
standard browser locations. A checksum match checks consistency with the supplied
manifest; it does not authenticate the publisher. Edge/Chrome are used when found;
otherwise the default HTML handler is attempted. Native identity failure is recorded
as optional for portable browser startup; required release/OS failures stop launch.

The diagnostic run reads CPU/RAM/graphics names, then invokes verified bundled native
build, IEEE and CUDA capability queries with timeouts. Graphics-name discovery and
CUDA capability output are not GPU training benchmarks or VRAM/performance
certification. Reports retain `liveCapacityEstablished:false`. They are stored in
LocalAppData/EightMax-Test-Workbench/Diagnostics and are not automatically uploaded.

Browser checks request a 20-update CPU study, record readable storage and source
markers, and export a report. A storage read cannot guarantee future write quota.
An imported Windows report remains supplied evidence, not an authenticated hardware
or independent accuracy certificate.

## Native study workflow

Configure a supported study, expand **Native CPU job controls**, and export a job.
`RUN-NATIVE-STUDY.cmd` selects that job and starts the separate Windows manager.
A captured reviewed link now produces a version-2 job: export checks its exact path
without training, and the manager queries both root and target from its same last
completed checkpoint. Version-1 jobs remain root-only. See `NATIVE-REVIEWED.md` for
the full reviewed workflow and examples.

| Control | Accepted range |
| --- | --- |
| Total updates | 1–50,000, from the study request |
| CPU threads | 1–4 |
| Strategy-table budget | 32–256 MiB; not total process RAM |
| Training timeout per invocation | 1–60 seconds |
| Completed checkpoint interval | 1–5,000 updates |

The manager verifies the executable SHA-256 and build, accepts CPU protocol-4
external sampling with bounded root/reviewed queries, and uses a named mutex so one
manager owns a native job at a time in the same Windows logon session. Imported
JSON cannot select executables or shell commands.
The bundled engine source/executable are unchanged EightMax 5.1.

Progress displays actual completed checkpoint counts and elapsed time. Counts
change at chunk boundaries; elapsed time updates between them. Smaller chunks
increase subprocess/checkpoint overhead. A fresh AppData NativeJobs folder keeps
the exported job/spec, alternating checkpoint files, query/result, status and logs.

**Cancel** kills the active child and keeps the previous completed checkpoint.
An interrupted chunk is not claimed as committed. A timeout/refusal does not publish
a partial strategy result. The GUI's Cancel belongs to that separate process;
browser Emergency stop cannot reach it. Build and restore have 5/15-second limits;
each final query has its own 30-second limit. Reviewed jobs issue two final queries.
The training chunks share the selected training timeout.

## Resume toward the same target

Run `RESUME-NATIVE-STUDY.cmd`, select the exported job and a compatible completed
checkpoint. The engine validates checkpoint/spec compatibility before training.
If a job requests 1,000 updates and the checkpoint contains 400, it requests only
the remaining 600. A checkpoint already at 1,000 is queried without retraining.
A checkpoint beyond the requested target requires exporting a larger total target,
within the companion's 50,000-update result bound.

Alternating checkpoint outputs keep the previous completed input intact while the
next chunk runs. Cancellation can occur after native work starts; only a checkpoint
whose child completed successfully is promoted by the manager. Compatible resumed
engine policies matched uninterrupted policies in the Linux CLI tests. That does
not execute or validate the Windows GUI/process-control implementation.

At completion the job folder opens. Import `result.native-result.json` into the
original Study slot. Exported jobs bind slot, request token and complete job metadata.
Wrong/stale bound results are refused. Changing study inputs, loading another example
or preparing a new reviewed draft invalidates the old export. Version-2 reviewed
results also check the captured full history, public ledger, menu, ordered complete
acting range and consistent completed counters. Native reach/aggregate estimates
are not displayed as range posteriors. Native zero-average rows remain unavailable;
original input weights are retained despite printed-query rounding.

Native jobs are at most 1 MB and native result envelopes at most 6 MB. Normalized
standalone study reports retain their 2-MB bound. Contradictory/partial-range or
oversized results are refused. Bindings/counters check consistency, not authenticity
of policies or checkpoint provenance. Older unbound version-1 root results retain
their explicit import route; their query must still be at the root.

**Open native status snapshot** manually reads `job-status.json`. It accepts only
the latest matching exported job in the selected slot, and is a historical snapshot,
not a live bridge. Restored native exports/statuses do not restart Windows processes.
Native binary checkpoints are retained outside browser workspace backups.

Actual Windows launcher behavior, file dialogs, UI layout, native PE execution,
cancel/timeout cleanup and target-PC speed still require Windows acceptance testing.
The release does not establish live screenshot recognition, GPU study scheduling
or a supported simultaneous-table count.
