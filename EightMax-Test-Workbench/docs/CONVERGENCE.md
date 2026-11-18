# Convergence checks and raised training limits (0.18.0)

## What it answers

"Has this study trained enough?" After native training, the runner asks the
unmodified EightMax 5.1 engine (`mwcli --gain`) how much each seat could win by
switching to its best response while every other seat keeps the trained strategy.
If no seat can gain more than your target (a % of the study's starting pot), the
strategy is close to equilibrium *inside the study's cards and bet sizes*.

The workbench does not compute these numbers itself. It saves the engine's answer,
validates it against the job and the final checkpoint, and summarizes it.

## Using it

Study workspace, then **Native CPU job controls**:

| Control | Default | Range | Meaning |
| --- | --- | --- | --- |
| Convergence check | Auto | Auto, Exact, Restricted, Sampled, Off | Auto tries exact, then restricted, then sampled |
| Check every N checkpoints | 0 | 0-1,000 | 0 = only after training ends; N > 0 also builds a curve (at most 50 intermediate checks) |
| Check time limit, seconds | 30 | 5-3,600 | Per method attempt. Not counted against the training time limit |
| Target, % of starting pot | 1 | 0.001-100 | The bar for the verdict |

Export the job and run it as before (RUN-NATIVE-STUDY.cmd, desktop host or a
batch). Import the result. The result panel shows a verdict, per-seat gains, the
trend between the last two checks and, if intermediate checks ran, a bar curve
with the target drawn as a dashed line.

## Reading the verdict

| Verdict | When | What to do |
| --- | --- | --- |
| Within target | Exact check, largest seat gain at or below target | Training is enough for this abstraction |
| Keep training | Exact gain above target, or a lower-bound check whose 95% interval is above target | Resume with a larger update target |
| Not proven | Restricted/sampled check at or below target | Nothing is confirmed: these methods only find *some* deviations. Use a smaller tree, or a longer time limit, to let exact run |
| Unavailable | Every method was refused or timed out | Training result is still valid; the reasons are listed |
| Measured (ICM) | ICM utility | Gains are in equity units; the % of pot target is not applied |

Heads-up chip-EV studies also show exploitability (NashConv / 2). Multiway studies
show per-seat gains and NashConv only. Multiway poker is not two-player zero-sum,
so a small NashConv means no seat gains much by deviating alone. It is not a
guarantee against seats deviating together.

## Methods

| Method | Engine mode | Bound | Cost on the tested examples |
| --- | --- | --- | --- |
| Exact | exactBestResponse | Exact (upper bound on any one-seat deviation) | About 10 ms for river spots. Refused (422) on the 6-player flop and 8-player preflop examples |
| Restricted | restrictedBestResponse | Lower bound | Timed out at 8-20 s on the 6-player flop |
| Sampled | sampledOneDecisionDeviation | Lower bound, with standard errors | About 2 s on the 6-player flop; timed out on 8-player preflop at 20 s |

## Raised limits

| Limit | 0.17 | 0.18 |
| --- | --- | --- |
| Native updates per study | 50,000 | 10,000,000 (engine maximum) |
| Native strategy memory | 32-256 MiB | 32-16,384 MiB, refused above 80% of the PC's RAM minus 512 MiB |
| Native training time limit (total) | 60 s | 7 days |
| Native checkpoint interval | 5,000 updates | 1,000,000 updates |
| Restore/query time budget | 15 / 30 s | 30 s + 1 s per 32 MiB of strategy memory (max 1 h) |
| Browser updates | 50,000 | 10,000,000 (still stopped by the time budget) |
| Browser time budget | 15 s | 10 min |
| Browser strategy memory | 32 MiB | unchanged (use native for big trees) |
| Threads | 1-4 | unchanged |

Example measured here (3-player river example, Linux build of the supplied source):
the largest seat gain was 1.90% of the pot at 50k updates (the old ceiling), 1.12%
at 100k and 0.45% at 350k-400k. Checks are not monotonic: one point (200k) rose to
0.92%. So the verdict uses the latest exact check, and the trend line compares the
last two.

## Compatibility

- Jobs without `convergence` settings use the defaults. Results from 0.17 and
  earlier import unchanged and are labelled as not checked.
- Saved workspaces from earlier versions open. The new controls take their defaults.
- Browser-only studies are not checked. Export them as native jobs to measure.
- Results keep `quality.convergenceVerified: false`. The convergence block is a
  separate, labelled measurement, not a certificate.

## Scope of verification

Verified on Linux with the CLI compiled from the supplied source: heads-up and
3-player exact checks, automatic fallback on a 6-player flop, unavailable reporting
on 8-player preflop, training to 60,000 and 400,000 updates through chunked
checkpoints, refusal of tampered convergence blocks, the dashboard export,
import and render path, and workspace round trip.

NOT executed: the PowerShell runner (`native/Run-Native-Study.ps1`), the C# desktop
host, the RAM check and the Windows binary. The Node test reproduces the runner's
steps (`tests/convergence.test.cjs`, `runNative`). The PowerShell code is reviewed,
not run. The EightMax 5.1 engine, its libraries and mwcli.exe are unchanged.
