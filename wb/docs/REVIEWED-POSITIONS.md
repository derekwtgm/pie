# Reviewed positions — 0.13.0

This workflow captures a manually reviewed public betting history, matches it to
an explicit EightMax study, then queries the acting seat's stored hand policies.
Preparation never starts training. The study remains an offline experiment with
user-supplied ranges and menus.

## Try the example

1. Open `START.html`, then **Observation review**.
2. Choose **Load reviewed-position demo**, then **Process up to 250 frames**.
3. Choose **Prepare reviewed history study**. This synthetic demo supplies the
   explicit ranges `AsAd` and `KsKd`; recorded reviews require your own ranges.
4. Inspect the captured hand/frame, root inputs and bet menus in **Study workspace**.
5. Choose **Analyze reviewed position**. **Run CPU study** also uses the captured
   history while its link is attached.

The example starts on the river with a 4 BB pot. Original seat 2 bets 2 BB and
original seat 1, holding AsAd, faces the bet. With the default menu the exact path
is `r1`; the root actor is different from the target actor. The top report is the
target actor's policy, with the root report kept separately below it. Change the
menu to omit the half-pot bet and analysis is refused before training.

`examples/reviewed-position-demo.json` is the same observation sequence.
`examples/reviewed-study-demo.json` opens with **Open reviewed draft** without
processing observations or starting a solve. `examples/whole-workspace-demo.json`
also contains a completed synthetic mapped report. Its frequencies demonstrate
the workflow; they are not a strategy recommendation or convergence certificate.

For a completed hand, select an **open** accepted step in **Completed-hand
inspector**, then choose **Prepare selected-step study**. Only the prefix ending
at that step is copied. Later exposed opponent cards, awards and settlement do not
become information available at an earlier decision. Closed/accounting targets
and histories with missing/truncated anchors are refused.

## Choose the anchor

| Selection | What the study contains |
| --- | --- |
| Original accepted anchor | The original supported root and its accepted action/card history through the selected decision |
| Current street start | A new root at the first accepted snapshot of the selected street, plus later actions on that street |

The second option deliberately discards earlier strategy conditioning. Earlier
committed chips and folded contributions remain in the pot, but earlier ranges
are not converted to posterior ranges. Supply ranges at the chosen anchor, one
line per original seat. Use `-` only for a seat already folded at that anchor.
Unknown folded private cards/ranges are not reconstructed as blockers.

The captured proof belongs to its study slot. Later review frames or another
observation file do not rewrite it. Loading a normal example or preparing an
ordinary root study removes that slot's link. **Remove reviewed-position link**
allows an ordinary root-only study again. Editing ranges and menus invalidates
old results while keeping the captured proof. Changes to fixed physical root
fields are refused on the next mapped run.

## Matching the actual public state

The mapper replays the accepted legal round history and inspects the original
EightMax game's action/chance tree. English action labels narrow candidates only.
Each candidate must also match the board, actor, pot, behind stacks and live/folded
status in chips. It accounts for the recorded root ledger, dealer/seat rotation,
earlier contributions, later folds and supported short all-in reopening rules.
A snapshot that combines the last action and a new street is split into the
corresponding action and chance transitions.

Exactly one candidate must match. Off-menu bets, ambiguous actions, unknown
history and unsupported roots produce an error; there is no nearest-size snapping
or silent new root. Explicitly edit the relevant bet/raise menu to represent the
observed action. Guided fields edit the root street; use Advanced configuration
for other streets in a linked tree.

Supported roots are full-post, 2–8-seat preflop studies with individual 0.1 BB
antes, or 2–6-live-seat postflop studies. Reviewed postflop snapshots may contain
at most six live players. Each root stack must be 2–250 BB. Short posts and an
already all-in player at a new root are unsupported; an original supported root
can follow later short all-ins. Postflop re-rooting does not post antes/blinds
again. This workflow uses chip EV; linked ICM is refused.

## Reading the policy report

After matching, the portable CPU worker trains the same root study and queries
the actual acting seat's exact public-history/hand rows. Public-board-conflicting
hands are omitted. Each remaining hand retains its original input range weight.
Those weights are not probabilities conditioned on the observed actions. No
aggregate range strategy, action EV, exploitability bound or posterior is computed.

Missing rows remain unavailable. An existing row follows EightMax 5.1's own
normalization, including its behavior when accumulated average mass is zero.
Neither a returned row nor a large update count establishes convergence. Exact
later-street card histories can remain sparsely visited, especially with broad
preflop ranges. Choosing a current-street anchor makes a smaller, differently
conditioned study; it does not recover the original study's missing policy rows.

Hero is labeled only when an explicit original hero seat identifies the current
actor. A known hero hand outside the chosen range receives no invented policy.
The page displays up to 60 hands with the known hero first; exported reports retain
all eligible acting-range hands.

## Continue portable training

Retain a completed browser CPU state, save it as a separate `.emcpu` file, or raise
the total update target and choose **Continue to total update target**. The captured
proof and all normalized study settings must match. Only target/time may change.
Opening a CPU checkpoint restores the captured position and queries policies without
training. Whole-workspace backups and strategy reports do not contain these training
bytes. See `CPU-CHECKPOINTS.md` for bounds and cancellation behavior.

## Saving and restoring

| Format | Contents |
| --- | --- |
| `eightmax-reviewed-position`, version 1 | Source kind, table/hand, accepted source frame indices and canonical public snapshots |
| `eightmax-reviewed-study`, version 1 | Root configuration and reviewed-position proof; no partial training state |
| `eightmax-reviewed-node`, version 1 | Proof, root identity, mapped action/card steps, target actor/state, per-hand stored frequencies and explicit quality limits |
| `eightmax-workspace`, version 3 | Whole workspace including each slot's captured proof, completed report, native binding and anchor selector |

Version-1 workspace files from 0.10 migrate to version 3 with no reviewed links;
version-2 files from 0.11 retain their captured proofs/reports. New version-3 files
cannot be opened by those releases. Restoring a workspace/draft/report never starts
a solver. Mapped results stay out of the ordinary root-only cache. Controlled
synthetic play still requires removing the captured link.

**Export native job** now retains that link, checks the exact path in an untrained
worker, and exports a version-2 job. Run it through `RUN-NATIVE-STUDY.cmd` and import
the resulting bound version-2 envelope into its original slot. The Windows manager
queries the root and reviewed node from the same completed checkpoint. Both reports
share completed counters; the importer also checks the full action/card history,
public ledgers, menu, range order/weights and blocked hands. A native row with no
positive average mass remains unavailable. This can differ from the portable
engine's existing-row zero-mass normalization. Native reach/aggregate fields are
not used as a posterior or as an aggregate strategy. See `NATIVE-REVIEWED.md`.

Imported reports receive structural and context checks, including root/proof,
card-history, actor and probability consistency. Import does not independently
rerun EightMax, authenticate numerical action slots/frequencies or establish that
training occurred. A standalone proof contains snapshots and source frame indices,
not the original recognition/timing evidence. Treat imported data as supplied
evidence. New analysis performs actual engine path matching again.

## Bounds and validation

| Bound | Limit |
| --- | --- |
| Accepted snapshots per proof | 128 |
| Solver action/chance transitions | 128 |
| Canonical proof JSON | 200,000 characters |
| Reviewed draft file | 1 MB |
| Mapping check budget | 4 seconds, checked before/after engine view calls |

The parent worker watchdog remains the outer bound; a synchronous engine call can
occupy the worker until it returns or the parent terminates it. Training's selected
time budget begins after successful mapping. These bounds do not measure peak RAM
or guarantee latency on the target PC.

Automated cases cover exact chip matching, combined transitions, preflop seat order,
short all-ins, missing rows, state preservation, manual UI routing, workspace
migration and generated workers. The mapped river actor, pot, stacks and policy
rows match a separate Linux native CLI run with the same study. The EightMax 5.1
libraries, C++ source and supplied Windows executable are unchanged. Tests use an
in-memory DOM rather than a visual browser. Windows execution, target-PC capacity,
real-client recognition and live input integration remain unvalidated/pending.
