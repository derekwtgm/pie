# Windows desktop candidate — 0.17.0

This release adds a Windows desktop host, per-user installer scripts and direct
dashboard control of native CPU studies. The host is compiled on first launch
using Windows PowerShell 5.1 and the .NET Framework C# provider already present on
standard Windows 10/11 installations. No Python, Node.js, downloaded runtime or
administrator setup is part of this workflow. A current Edge/Chrome is used for
the dashboard window.

**The Windows host has not been compiled or executed in this Linux development
environment. Installer/registry behavior and Windows process containment have not
been tested here.** This is a desktop implementation candidate with an actual
Windows acceptance script, not a prebuilt/signed EXE or MSI installer. The existing
portable `START.html` and manual native runner remain available.

## Start and install

1. Extract the complete ZIP to a normal folder.
2. Run `START-DESKTOP.cmd`. The first launch verifies release files, compiles an
   x64 host into the user's DesktopCache, and opens its control window/dashboard.
3. In **Study workspace**, use **Check desktop connection** and **Run native CPU
   here**. A reviewed link keeps its exact captured target.
4. The browser prepares/checks a native job without training, then submits it to
   the local host. Progress and the validated result return to the same study slot.

`INSTALL-WINDOWS.cmd` stages a checksum-verified release under the current user's
LocalAppData, adds a Start menu shortcut and registers a per-user uninstall entry.
It keeps prior release folders on updates. Close desktop/native managers before
installing/updating/uninstalling. Activation is refused for a corrupted installed
copy. There is no automatic update download or automatic version rollback.

`UNINSTALL-WINDOWS.cmd` or the registered uninstall entry removes managed releases,
the shortcut, registration and generated DesktopCache/session files. It preserves
NativeJobs, Diagnostics, browser recovery and separately saved study files. Only
recorded release directories immediately under Installed are eligible for removal.
These install/uninstall operations still need real Windows acceptance.

## Native control and recovery

One native job is managed at a time. The existing CPU thread, strategy-table memory,
training timeout and checkpoint interval bounds apply. The headless manager is the
same native runner used by the manual workflow, with the original EightMax 5.1
executable/build identity. Reviewed results retain separate root/target queries.

Input changes, a new study on the same slot, workspace replacement and browser
emergency stop request cancellation. Cancellation before acknowledgment fences the full bound job and intended attempt,
even if the training request has not arrived yet. Late replies cannot overwrite newer
drafts. Revisioned control prevents an old cancellation from stopping a newer resume.
The host uses a Windows Job Object for the PowerShell manager and its native children,
with kill-on-close configured before the suspended manager is resumed. The host's
**Stop native study** button and closing the host operate on that owned process group.
Actual Windows containment/cleanup behavior remains unverified here.

Browser cancellation is asynchronous. If the connection fails and cancellation
cannot be confirmed, use the host's Stop button or close the host. The separate
manual GUI runner retains its own Cancel control; the desktop host does not own it.
Capacity testing refuses to start while a managed run/cancellation remains active.

**Resume last native job** continues a cancelled/failed managed job from its last
completed checkpoint toward the original total target. It requires the unchanged
job/binding and the same live desktop session. Starting another native job or closing
the host removes that in-memory managed-job reference. Version 0.17 also retains
managed jobs in Saved native studies for explicit reopening after restart; prior
managed folders can be imported. On-disk folders retain the manual resume workflow. An interrupted chunk
is not promoted as committed. Complete jobs cannot use this resume button to raise
their target; export a new compatible total target through the manual workflow.

### Reload recovery

After reloading the dashboard in the same live desktop session:

1. Choose **Find managed study**. This only reads the host. Inspect its original
   slot, stage, attempt revision and captured hand/root before recovery.
2. Choose **Recover managed study**. The client rechecks the same job/revision,
   restores its config, update target, native controls and reviewed proof into its
   original slot, and clears that slot's prior report and retained CPU state.
3. A running attempt is followed without restarting it. A completed result is
   collected and validated. Cancelled/failed jobs are adopted without training;
   use **Resume last native job** explicitly if a completed checkpoint remains.

Recovery replaces the original slot's draft/result. Save a workspace first when
those edits need to be kept. Other slots stay independent. Input/slot changes and
workspace replacement invalidate recovery previews; stale discovery cannot replace
new drafts. Discovery does not prove that a result came from a trusted source.

Find/Recover managed study covers the host's CURRENT job in its live session. The
separate Saved native studies panel added in 0.17 provides persistent browsing. A new job replaces that reference; host restart invalidates
the session. Older disk files retain the existing manual resume/import workflow.
No result, workspace or recovery operation automatically starts training.

### Lost replies and attempt revisions

The host status format is now `eightmax-desktop-job` version 2 with revision 1–256.
Cancel compares the revision before touching owned work. Resume compares the prior
revision and starts its successor once; repeated delivery of that same Resume
returns the successor. Old cancellation/resume requests cannot advance another
unrelated attempt. Legacy v1 statuses remain readable for an older host, but that
host lacks the new recovery, fencing and attempt guarantees.

A cancellation intent includes the full original job, its slot/token binding and
intended revision. The host remembers the fence before responding. A delayed initial
submission is then refused. A fenced immediate resume advances to a cancelled
revision without starting training, retaining its completed checkpoint for the next
explicit Resume. Fencing an earlier revision never cancels a newer attempt.

Initial submission is idempotent for the current semantic job hash and binding.
Changed settings under a used binding are refused; displaced older bindings cannot
be submitted again. Each host session retains at most 256 bindings and 256 attempt
revisions per binding, with no eviction of earlier cancellation records. If full,
unknown bindings are refused; close/restart the host to create a new session.

The client never automatically retries a training POST. It attempts cancellation
when a reply or subsequent observation fails. If confirmation fails, uncertain work
remains busy and blocks a new managed run and capacity testing. **Find** alone does
not clear uncertainty: a delayed POST could still arrive. **Stop managed native
study** confirms cancellation using the original attempt; **Recover** first resolves
that uncertainty and may require finding again if the fence advanced its revision.
If the connection is unavailable, use **Stop native study** in the host or close it.

CPU `.emcpu` files, workspace backups and native binary checkpoints remain different
formats. Workspace files contain drafts/reports/bindings, not the host process/session
credential. They never resume native work automatically. Save CPU training states
and workspace files before closing when needed.

## Local protocol

The host binds only `127.0.0.1:48713`. A fixed port keeps the browser origin stable
across desktop launches. If it is occupied, launch fails instead of silently moving
workspace storage to another origin. Desktop-origin recovery is separate from earlier
`file://` portable recovery; use a workspace file to move existing work explicitly.

The launcher creates a random session credential. It reaches the dashboard in the
URL fragment, is moved to sessionStorage for reloads, and is removed from the visible
URL when session storage is available. If it is blocked, the valid private fragment
is retained so reload can reconnect. API requests require it in a header and reject foreign Origins/incorrect Host
headers. There is no CORS allowance, arbitrary executable selection, arbitrary file
route or client input/capture capability. Only the static dashboard is public locally.

| Route | Purpose |
| --- | --- |
| `GET /api/desktop/health` | Check host/protocol/engine identity without starting work |
| `GET /api/native/history` | Read saved study summaries; inspect/open routes adopt unchanged records without training |
| `GET /api/native/batch` | Read the latest persisted batch status |
| `POST /api/native/batch` | Run 1–10 prepared unique-slot studies sequentially, within the combined 1-MB body bound |
| `POST /api/native/batch/{id}/cancel` | Stop/fence that batch and keep completed files |
| `GET /api/native/current` | Read the current bound job/status; no training |
| `POST /api/native/jobs` | Submit one prepared CPU job; repeated binding/settings returns current status |
| `POST /api/native/cancel-intent` | Fence the full job and `X-EightMax-Revision` before acknowledgment |
| `GET /api/native/jobs/{id}` | Read current managed status |
| `POST /api/native/jobs/{id}/cancel` | Stop the owned attempt using `{revision:n}` |
| `POST /api/native/jobs/{id}/resume` | Continue the unchanged checkpoint using `{revision:n}`; repeated delivery reuses n+1 |
| `GET /api/native/jobs/{id}/result` | Read its completed result envelope |
| `POST /api/desktop/shutdown` | Close the host and its owned native work |

Request headers are bounded to 16 KiB and job bodies to 1 MB. Results are bounded
to 6 MB; status files to 20 KB. Socket reads/writes have 2.5-second bounds. The client
has per-request aborts and a 180-second managed-run wait, with cancellation on expiry.
These do not establish whole-process memory or target-PC performance limits.

## Compute coordination in 0.16

The Compute activity panel shows queued/running browser study slots and exclusive
native/capacity/diagnostic/image workflows. Native preparation reserves the workflow
before a host job exists, so another CPU task cannot bypass it. **Stop managed native
study** also cancels this preparation. Recovery requires the browser study queue and
other exclusive workflows to be stopped first.

Starting a browser CPU study, CPU checkpoint inspection, benchmark, image validation
or browser diagnostic in a desktop session checks the live host read-only first.
A running/unconfirmed job or unavailable host blocks worker allocation. Cancellation
while that read is pending prevents later allocation. No such check runs on portable
file pages, and no read starts, resumes or cancels native training.

These reservations are per page, absent from backups and do not arbitrate a second
dashboard window. Use one workbench dashboard per host session. They are not whole-
process memory accounting, a shared native strategy cache or table-capacity evidence.
Manual native GUI jobs retain their separate mutex and Cancel workflow.

The runner's restore status now keeps the original total target instead of a
temporary 50,000 target. Restored counters are checked before checkpoint promotion.
The acceptance script checks target/counter invariants on each observed poll, but
it and the PowerShell restore path remain unexecuted in this Linux environment.

## Persistent history and batches in 0.17

Saved native studies reopens job settings and completed results/checkpoint references
after host restart. Inspect/open is version checked; neither starts training. The
same engine checks compatibility on explicit Resume. Prior-folder import is explicit
and bounded. See NATIVE-HISTORY-BATCHES.md for record/file/scan and recovery limits.

Sequential native batch prepares saved/current slot snapshots without training, saves
or opens a separate draft JSON, then submits explicitly. A host timer runs one study
at a time and saves each result. Closing the dashboard leaves accepted work running;
the host Stop/Close control or browser batch/emergency Stop halts queued/active work.
Failure/partial/limit/persistence outcomes halt advancement. No batch restarts itself
on host launch. Unfinished snapshots can be copied to fresh drafts; checkpoints resume
individually. This native queue does not arbitrate other windows' browser CPU workers.

The extended acceptance script includes history across idle host restart, unchanged
checkpoint opening, explicit continuation, stale record refusal and two-study batches.
Those C#/PowerShell/NTFS/process/timer operations remain unexecuted here. No compiled
Windows archive/queue behavior or measured native capacity is claimed.

## Actual Windows acceptance

Close existing desktop/native managers and run `RUN-DESKTOP-CHECKS.cmd`. It:

1. Verifies release bytes and parses PowerShell scripts on Windows.
2. Compiles/starts the real headless desktop host.
3. Checks authenticated health and refusal of unauthenticated/foreign-origin calls.
4. Runs the supplied synthetic reviewed native study and checks root/target context.
5. Checks read-only current-job recovery and duplicate initial submission identity.
6. Cancels after a committed chunk, fences an intended resume before delivery,
   explicitly resumes toward its target, tests duplicate resume/stale cancellation
   and checks the retained input checkpoint remains unchanged.
7. Fences a fresh job before submission and confirms the delayed submission is refused.
8. Shuts down the owned host and writes `EightMax-desktop-acceptance.json` under
   Diagnostics. Import that file using the dashboard's existing Windows report control.

The private session file is removed; credentials are excluded from the report. The
acceptance script does not install/uninstall the application or test browser rendering,
native file dialogs, the normal host window layout, GPU speed, real recognition or
live table capacity. Installer/update/uninstall behavior needs a separate Windows run.

Linux tests use simulated HTTP, a JavaScript protocol model and in-memory DOM for
protocol/UI checks.
They do not execute C#, PowerShell, Win32 process control or Windows binaries. The
existing native-engine comparisons remain Linux CLI checks. All engine libraries,
C++ source and the Windows native executable remain unchanged.

Implementation references: Microsoft's [Windows Job Objects documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
and [suspended process assignment guidance](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject).
