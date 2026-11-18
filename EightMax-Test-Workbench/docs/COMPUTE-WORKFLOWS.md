# Compute workflows — 0.16.0

The Study workspace now shows current compute activity. Browser study slots share
one worker and queue independently. Other expensive workflows reserve the page until
they finish or are cancelled. This prevents separate worker queues from overlapping
by accident; it does not change the EightMax 5.1 solver.

| Workflow | Admission and cancellation |
| --- | --- |
| Browser root/reviewed study, practice, native export and CPU checkpoint inspection | Shares the one-worker study queue; up to ten slots. A new request for the same slot supersedes that browser request. |
| Managed native Run/Resume/preparation or Recover | Requires other page compute work to be stopped. Native Stop cancels preparation too. |
| Capacity test | Stops ordinary browser study work; refuses native, image or diagnostic work. Its own one/two-worker pool stays exclusive. |
| Image validation | Stops ordinary browser study work; refuses native, capacity or diagnostic work. |
| Browser checks | Explicitly stops ordinary study, capacity and image workflows; refuses native work. |

In a desktop session, the browser workflows read authenticated health/current-job
status before allocating workers. A known running or uncertain native job blocks
startup. An unreachable host also blocks startup; the failed reservation is released.
Find/Recover/Stop remain available to resolve native work. Portable START.html never
probes localhost as part of this check.

The reservation is acquired before asynchronous startup checks. Emergency stop,
workspace replacement or an operation's Stop invalidates its ownership/generation;
a late read cannot start a worker afterward. Completion/cancellation releases only
the exact operation's lease. A stale handler cannot clear a newer workflow.

Native preparation and recovery are reserved before a new host training request
exists. This closes the gap where capacity tests or browser checks could previously
start during job mapping/preparation. The native Stop button now cancels that queued
or running mapping worker. Completed checkpoints/results are not deleted.

Activity is transient. It is not written into workspace files and reopening a
workspace never restores reservations or starts work. Existing drafts, reports,
reviewed proofs and separate checkpoint workflows keep their formats.

The display covers this page and host work it has observed. It does not schedule
across two dashboard windows, measure whole-process RAM/VRAM, or manage a separate
manual native GUI process. Keep one dashboard open per managed host session. The
configured 32-MiB browser strategy-table budget, native memory controls and retained
CPU-state accounting remain narrower than a process memory cap. No simultaneous
live-table capacity or native throughput result is established by these controls.

The new tests execute JavaScript ownership logic and real dashboard handlers using
in-memory DOM/HTTP fixtures. They do not execute Windows C#, PowerShell, Job Objects,
the installer or a visual browser. The runner's restore-target repair and expanded
Windows acceptance script are included in source, with real Windows execution pending.
