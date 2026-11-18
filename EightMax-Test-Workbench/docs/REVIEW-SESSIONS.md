# Observation review progress — 0.8.0

1. Open `START.html` and **Observation review**.
2. Load a sequence or demo and process a few frames.
3. Choose **Save review progress** to download a portable JSON file.
4. Choose **Open saved review** to rebuild that progress later.
5. Continue manually with **Next frame** or **Process up to 250 frames**.

`examples/review-progress-demo.json` is a synthetic side-pot review saved after
three source frames. Open it with **Open saved review** and process the remainder.
On completion, use **Completed-hand inspector** to inspect its accepted snapshots.

## File formats

| File/control | Format | Can resume review? |
| --- | --- | --- |
| Open observation sequence | `eightmax-observation-sequence`, version 1 | Begins a new review at frame zero |
| Save review progress / Open saved review | `eightmax-observation-review`, version 1 | Yes, from the processed cursor |
| Recover review | Same review format in separate browser storage | Yes, after manual reopening |
| Export audit | `eightmax-observation-audit`, version 1 | No, report only |
| Export completed hands | `eightmax-completed-hands`, version 1 | No, report only |
| Export selected hand review | `eightmax-completed-hand-review`, version 1 | No, report only |
| Save session file in Save / recover | `eightmax-simulation-session`, version 1 | Separate simulator workflow |

## Resumable envelope

The envelope accepts exactly the following fields. Extra derived-state claims
are refused rather than treated as proof of acceptance.

| Field | Required value or meaning |
| --- | --- |
| `format` | `eightmax-observation-review` |
| `version` | `1` |
| `rules` | `eightmax-review-0.8.0`; other audit rules are refused |
| `settings` | Exactly `stableFrames`, `stableMs`, `maxGapMs`, `maxHandGapMs`; validated by Tracker |
| `sequence` | Complete original sequence, including unprocessed source frames |
| `operations` | Ordered frame consumption and reviewed reset operations |
| `cursor` | Number of source frames consumed; must agree with operations |
| `decisionReady` | `false` |

A frame operation is exactly `{"kind":"frame","index":0}`. Source indices
must run from zero in order, once each. A reset operation is exactly
`{"kind":"reset","table":1}`, with a table identity from 1 to 10. Resets may
be interleaved with frame operations. They break that table's continuity and permit
a new reviewed anchor; they do not erase prior audit events or completed records.

Opening validates the envelope and constructs a fresh Tracker by replaying every
operation. It reconstructs pending stability candidates, seen frame identities,
pauses, accepted rounds, refunds, completed-record ordinals and bounded archives.
It does not import Tracker objects or trust a serialized accepted state. Invalid
source evidence reproduces a rejection/pause. The unprocessed remainder waits for
the user's next processing click. No solver, client or simulator action starts.

Replaying checks consistency under the supported rules; it does not establish
source authenticity. Editing a source sequence into another plausible sequence can
change the resulting audit. The rules identifier is a compatibility guard, not a
digital signature or an independent integrity certificate.

## Automatic recovery

Changed reviews are attempted every 3 seconds in browser localStorage under a
separate key from simulation recovery. Startup offers an existing save without
opening it. **Recover review** replays it only after the user chooses that control.

If a write fails, the UI reports the failure and leaves the previous stored value
in place; that same revision is not retried until a further review change. Manual
review-file export remains available. **Clear automatic review save** removes the
stored value and suppresses re-saving the current revision; further changes can
create a new save. No save occurs with no loaded review. Browser storage quotas,
private modes, user cleanup and moving an extracted folder can affect recovery.
Closing before the next successful save can lose recent changes. Keep a portable
review file when the progress matters.

Review recovery excludes screenshot pixels, calibration templates, solver ranges,
study drafts/cache/results, running workers and simulator sessions. Those keep
their existing separate export/recovery workflows. It does not reopen a screenshot
or client window.

## Completed-hand inspector

The selector identifies a completed record by its local ordinal, table and hand
label. Reused labels after reviewed resets remain separate completion ordinals.
The inspector rebuilds accepted material state changes from the source journal;
repeated stable frames and collecting/rejected frames are not additional steps.
Every step includes its zero-based `sourceIndex` and `operationIndex`, original
sequence/time, verified transition description and accepted snapshot. The UI shows
source-frame numbers starting at one for readability.

The final state includes the observed refunds, gross awards and final stack
balances. A postflop anchor stays explicitly partial; no earlier streets are
invented. The inspector uses the same integer-chip, no-rake and fixed odd-chip
policy as accounting. Exported inspection reports retain `decisionReady:false`.

## Bounds

| Item | Bound |
| --- | --- |
| Original observation sequence | 10,000,000 UTF-8 bytes and 5,000 frames |
| Review file | 20,000,000 UTF-8 bytes |
| Frame/reset journal | 10,000 operations total |
| Processing batch | 250 source frames per click |
| Selectable completed archive | Most recent 100 records |
| Inspector snapshots | Last 256 accepted changes, with explicit omission flag |

The complete source/journal remains in a saved review within those limits, even
when derived records or events have rolled out of their bounded archives. Restore
recreates the same retention behavior; it does not expose old completed records
outside the latest 100. The original anchor snapshot remains in each retained
completed record even when its transition/inspection tail is truncated.

Replay and selected-hand inspection are synchronous and can briefly occupy the
page on larger inputs. These file/count limits do not establish peak RAM bounds,
browser storage capacity or target-PC latency. Automated tests here use synthetic
inputs and an in-memory DOM; visual browser behavior and Windows launch remain
unverified.
