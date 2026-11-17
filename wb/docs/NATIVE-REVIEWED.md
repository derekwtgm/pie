# Native CPU reviewed positions — 0.12.0

Reviewed decisions can now use the existing native CPU study manager. The browser
checks the exact path without training, then exports a job for the unchanged
EightMax 5.1 executable. No Python, Node.js, additional modules or administrator
setup is required for the end-user workflow. Windows execution remains unverified
in this Linux development session.

## Run a captured decision

1. Extract the entire release and open `START-WINDOWS.cmd` or `START.html`.
2. In **Observation review**, load/process the reviewed-position demo and choose
   **Prepare reviewed history study**. For recorded histories, enter explicit ranges.
3. In **Study workspace**, keep the reviewed link attached. Check the root settings,
   ranges and menus. Choose the desired total updates and native CPU controls.
4. Choose **Export native job**. This validates the path and downloads a bound job;
   it does not train or start an operating-system process.
5. Run `RUN-NATIVE-STUDY.cmd` and select that new job. The manager owns training,
   progress, checkpointing and cancellation.
6. When the job folder opens, import `result.native-result.json` into the original
   Study slot. The top report shows **Native CPU** policies for the captured actor;
   the root context remains separate below.
7. Export a workspace backup to retain the proof, result and job binding together.
   The native binary checkpoints remain in the Windows job folder.

Removing the reviewed link produces an ordinary root-only native export again.
Controlled synthetic play still requires removing the link. Changes to study
inputs, a new captured proof or a new example invalidate the prior export. Export
again before importing results for those changed inputs.

## Checkpoint and query behavior

The existing resource controls remain: 1–4 CPU threads, 32–256 MiB of strategy-table
budget, 1–60 seconds of training time per invocation, 1–5,000 updates per completed
checkpoint chunk, and a total target of 1–50,000 updates. Strategy-table memory is
not a whole-process RAM limit. The engine may use fewer training threads internally.

`RESUME-NATIVE-STUDY.cmd` takes the original exported job and a compatible completed
checkpoint. It trains only the remaining updates. A checkpoint already at the
target is queried without training. A checkpoint beyond that target requires a
larger total target and a fresh export. Native compatibility checks still apply.

For a reviewed job, the manager runs two queries against its same last completed
checkpoint: root context and the exact captured target. Each query has a separate
30-second timeout. The target query carries numeric action slots plus the cards
dealt after the study root; chance transitions remain part of the captured proof.
There is no new nearest-size matching or inference in the native runner.

Cancellation kills the active child and retains the prior completed checkpoint.
Interrupted chunks are not reported as committed. A timeout/failure does not
publish a partial result. The browser's emergency stop cannot control this separate
Windows process. Use the native manager's Cancel button for native work.

## Result checks and limits

The browser requires the latest exported slot/token/complete job for version-2
native results. It also checks:

- Root and target actors, boards, pots, behind stacks, current-street bets and folds.
- The full action/card history, action menus and complete ordered acting ranges.
- Range identities, original weights, public-board blocker flags and probability rows.
- Matching completed-update/sample counters and the job's cumulative update target.

These checks reject contradictory data; they do not authenticate frequencies,
establish convergence or prove the provenance of an imported checkpoint. Equal
counters alone cannot prove that two supplied queries came from the same file.
The supplied manager actually queries the same checkpoint path for both.

Only per-hand stored average policies are copied. Native `reach`, `reachUsesUniform`
and aggregate estimates are not used as posterior ranges or aggregate strategies.
Public-board-blocked hands are omitted from the target report. Missing policies
and native rows with no positive accumulated average mass remain unavailable;
portable zero-average-row normalization can differ. Tiny input weights come from
the original spec, since printed native query weights can round to zero.

| File | Limit |
| --- | --- |
| Native job, root or reviewed | 1 MB |
| Native result envelope | 6 MB |
| Normalized standalone study result | 2 MB |
| Captured proof | Existing 128 snapshots, 128 transitions and 200,000 characters |

Large ranges/proofs can exceed those limits. No truncation or partial-range result
is silently substituted. Narrow explicit ranges or choose an appropriate new
street root when that reflects the study you intend to model. A new street root
discards earlier strategy conditioning; it does not compute posterior ranges.

## Formats and examples

| Format | Version | Meaning |
| --- | --- | --- |
| `eightmax-workbench-native-job` | 1 | Existing root-only job |
| `eightmax-workbench-native-job` | 2 | Root spec, captured null-policy target, root labels, explicit target query and optional export binding |
| `eightmax-workbench-native-result` | 1 | Existing root-only training/query envelope |
| `eightmax-workbench-native-result` | 2 | Bound reviewed job, training metadata, target `query` and separate `rootQuery` |
| `eightmax-workspace` | 3 | Whole workspace allowing a captured proof and matching native export/result together |

The Windows runner requires an export binding for reviewed jobs. The browser also
requires the latest matching binding to import their raw envelopes. Version-1 root
exchange remains compatible; non-root queries cannot masquerade as version-1 roots.
Normalized saved reports can still be explicitly reopened as supplied evidence.
Workspace versions 1 and 2 migrate on opening; restores never start work. Previous
releases cannot open version-3 workspace files.

`examples/native-reviewed-demo-job.json` and `native-reviewed-demo-result.json`
are a synthetic half-pot river study and its **Linux-generated** native result.
`examples/whole-workspace-demo.json` retains their matching slot-2 binding alongside
other authoring examples. Open that workspace to inspect the result, or prepare
the demo yourself and export a fresh job for Windows execution. The fixture is not
a Windows performance measurement or a strategy recommendation.

Linux checks cover actual CLI exchange, mixed-street cards/blockers, 2/6/8-seat
preflop paths, tiny weights and chunked non-root continuation. Generated workers
and an in-memory DOM exercise export/import routing and paused recovery. Actual
Windows startup, Forms, cancellation/timeouts, PE execution, browser rendering,
target-PC speed, GPU scheduling and live-client integration remain unvalidated.
