# EightMax Windows 5.14

Build `57befd67c7c86ebe`. Successor of 5.13 (`e9ce3436fa829e47`). This is **Phase 4** of the ten-phase plan: faster
multiway convergence.

**The short version: 5.14 makes nothing faster by default, and says so.** Phase 4 had three parts. (1) `rbes` as the
automatic trainer for games with ranges: waits for your PC, as planned; 5.14 changes no default. (2) Pruning: built,
measured on Linux at equal time on the 20 reference games, and **no benefit resolved**; one of the two variants is
worse on some games. Both stay opt-in and experimental. (3) Multithreading: the merge of frozen batches was
restructured without changing a bit of any state; on the 4-processor development machine threads gave 1.5 to 3 times
the deals per second on large fixtures and **no resolved gain in quality per second** on the small exact games,
with one exception in each direction. What threads do on 24 logical processors only your PC can show; the launcher
for that is in this archive.

First thing to do on your PC: **WINDOWS-TESTS-5.14.md**. Reports: FINAL-REPORT-5.14.md, CONVERGENCE-5.14.md,
MATHEMATICAL-VALIDATION-5.14.md, VALIDATION-5.14.md, BUILD-5.14.md.

## What is new

### 1. Two experimental pruning algorithms (opt-in)

External sampling walks every action of the updating seat. Pruning skips, most of the time, an action that the
current strategy never plays and whose regret is clearly negative.

| Spec key | Algorithm identifier | What it does | Guarantee |
|---|---|---|---|
| `"pruning":"nrp-5.14-v1"` | `nrp-5.14-v1;threshold=..;evidence=..;skip=..` | skips a candidate with probability 0.95; corrects nothing | **none: biased by construction** |
| `"pruning":"nrpc-5.14-v1"` | `nrpc-5.14-v1;...` | the same skip; when it does walk a candidate, weights its increments by 20 | **unbiased (proven)**; higher variance |
| absent, or `"none"` | (none) | the default trainer | the states of 5.13, byte for byte |

An action is a candidate only when the strategy gives it probability 0, a decision follows it, the row has collected
evidence (`pruneEvidence`, default 50 visit weights), and its regret is below `-pruneThreshold` (default 0.02) times
the utility scale times the evidence. MATHEMATICAL-VALIDATION-5.14.md has the exact rule and the proof for `nrpc`.

From the command line: `mwcli.exe --study <fixture> result.json pruning=nrp-5.14-v1`. The interface does not offer
pruning: nothing measured justifies a button.

**Measured (Linux, 20 games, 20 paired seeds, 1 s and 4 s, exact NashConv; rules written beforehand):**

* `nrp`: better on 0 of 20 games, worse on none. **EXPERIMENTAL, no resolved benefit.**
* `nrpc`: better on 0 of 20, worse on 3 at 4 s (bubble4: NashConv 6 times the default's; rg-hu-turn: 1.08 times;
  bubble5-icm: 3 times). **NOT RECOMMENDED.**

These games have one to three bet sizes a street; pruning has little to skip there, and it bought 0 to 30% more deals
per second. Nothing was measured on trees with many actions per decision, where published solvers use it.

### 2. The merge of frozen batches, restructured

Training with `batchDeals` > 1 and several threads has three stages: deal, traverse (parallel), merge. Until 5.13
every merging thread read every increment of every deal. 5.14 groups each deal's increments by the thread that owns
their row first. **Every state is byte-identical to 5.13 for every thread count** (tested against the unchanged 5.13
program). The merge stage itself got about 20% faster on the development machine; it is memory-bound, and with `rbes`
it remains the stage that limits scaling (CONVERGENCE-5.14.md, section 5).

### 3. `eqtime.exe`: equal-training-time experiments on your PC

A new program in the archive, with two launchers:

* **`Run 5.14 equal-time comparison.bat`** (about 2 to 2.5 hours, CPU only): pruning against the default (20 games,
  20 seeds, 4 s and 16 s); `rbes` with frozen batches on 8 threads against `rbes` on one (6 games, 12 seeds, 4 s);
  deals per second by batch size and thread count up to 24 threads. Each part prints its rule first and its verdict
  last. It can be interrupted and continued.
* `Run 5.14 equal-time quick trial.bat` (a few minutes): shows that the tool works; never a result.

Before it measures anything the tool checks that the program trains the 20,000-deal states of the Linux build to the
last bit of their NashConv; if not, nothing counts.

### 4. `mwcli --selftest514` and the Windows validation of 5.14

`mwcli.exe --selftest514 studies <work-dir>`: 7 checks - 32 pruned states equal to the Linux build, their
headers, thread counts, stop and continue, refusals (a pruned state continues only under its algorithm and settings),
`"pruning":"none"` equal to the default; the grouped merge on 1 to 4 threads against recorded states.
`validate_windows514.ps1` is the 5.13 script with two more sections (`self-test 5.14`, `equal time 5.14`).

## What did not change

* **The default trainer, `rbes`, both kinds of training streams, every payoff model.** The unchanged 5.13 program
  and 5.14 train 225 configurations and 176 fixture cases, 0 differences to the same bytes; the self-tests of 5.7 to 5.13 pass with their recorded tables
  untouched.
* **Every default.** No trainer, batch size or thread count is chosen differently from 5.13.
* **Checkpoints.** A pruned state names its algorithm and settings in the `estimator` field of its header and has a
  derived study identifier. It continues only under the same algorithm and settings; the default trainer, `rbes` and
  5.13 refuse it with the reason and write nothing. Every other state and checkpoint loads and continues as before.
  No file format changed.
* The interface (apart from the version), the libraries, the satellite model, CUDA.

## One limit you should know

**A 5.13 or older program given a spec with `"pruning"` ignores the key and trains with the default trainer,** without
a message: those programs do not know the key. Nothing wrong is written (the state is an honest default-trainer
state, labelled as one), but it is not what the spec asked for. 5.14 cannot repair programs already delivered. A
pruned *state*, on the other hand, is refused by them.

## Validation status

Classes: (1) independently validated; (2) tested on Linux, under Wine or on a hosted Windows runner; (3) awaiting
the target PC or an NVIDIA GPU; (4) unresolved or not established.

| Item | Class | Evidence |
|---|---|---|
| Default trainer and `rbes` untouched | 1 | the unchanged 5.13 binary: 225 configurations and 176 fixture cases, 0 differences |
| `nrpc` is unbiased | 1 (proof) / 2 (test) | proof in MATHEMATICAL-VALIDATION-5.14.md; a frozen-table test consistent with it |
| `nrp` | 4 | biased by construction (and measurably: the frozen-table test rejects it on three of four games); no convergence guarantee |
| Pruning converges faster | 4 | **not shown**: 0 of 20 games better at equal time on Linux |
| Grouped merge writes the same states | 2 | identity against 5.13, `--selftest514` G1, self-tests 5.7 to 5.13 |
| Threads improve quality per second | 4 | 4-processor machine: one game better with batch 16, one worse with batch 4; otherwise unresolved |
| `rbes` as the automatic trainer for wide games | 3 | your run of the 5.13 rbes kit; on Linux (information only) `rbes` was lower on all six wide games at 4 s |
| Self-test, checkpoint rules, `eqtime` | 2 | Linux, Wine, Windows Server 2025 |
| Regression suite | 2 | 701 tests: 700 passed, 0 failed, 1 skipped (5.13 on the same machine: 693 / 691 / 1 / 1; the 8 new tests are those of v514.test.js; the timed test that fails for 5.11 to 5.13 here passed this time: it depends on how much the machine does in its time limit, and the suite ran beside another job) |
| Both launchers and the quick trial on a hosted Windows runner | 2 | pre-release tree: every check passed but the manifest check that tree cannot pass (106 + 299 passed; quick trial exit 0); the delivered archive: WINDOWS-CI-5.14.md beside the ZIP |
| Anything on the target PC; thread scaling beyond 4 processors | 3 | not run; 5.11, 5.12 and 5.13 not reported either |

## The archive

`EightMax-Windows-5.14.zip` (about 67 MiB). The second archive of 5.12, `EightMax-5.12-evidence-2.3-to-5.8.zip`, is
unchanged and not delivered again (the packaging script rebuilt it from the 5.14 tree and found the SHA-256 of the
delivered one).

## Compatibility

Settings, specs, states, study checkpoints and fixtures of 5.13: as before. A study checkpoint is tied to its build.
