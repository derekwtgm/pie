# EightMax 5.14: final development report (Phase 4: faster multiway convergence)

Build `57befd67c7c86ebe`, successor of 5.13 `e9ce3436fa829e47`. This report covers Phase 4 only.

## 0. The short version

**Asked:** your equal-time `rbes` results from the PC first; a prespecified rule deciding whether `rbes` becomes the
default where seats hold ranges; pruning; multithreading.

**Delivered, and what came of it:**

| | | Status |
|---|---|---|
| Equal-time `rbes` launcher for your PC | delivered beside 5.13 (`release-5.13/rbes-equal-time`), with its rule (P1 to P5) inside | **waiting for your run** |
| `rbes` as automatic trainer | not switched on; no `estimator=auto` was built | **open**: decided on your PC, not here |
| Pruning: `nrp-5.14-v1`, `nrpc-5.14-v1` | opt-in spec key, own identifiers and headers, refusals, self-test | built; `nrpc` **proven** unbiased |
| ... does it converge faster? | 20 games, 20 paired seeds, 1 s and 4 s, exact NashConv | **no**: `nrp` better on 0 of 20 (experimental); `nrpc` worse on 3 (not recommended) |
| Multithreading: merge of frozen batches restructured | same bytes for every thread count | **tested** against 5.13 |
| ... is it faster? | deals per second 1.6 to 3.1 times with 4 threads on fixtures; quality per second on 6 small games | **unresolved on 4 processors**: one game better (batch 16), one worse (batch 4) |
| `eqtime.exe` with two launchers | pruning, threads and scaling on your PC, rules printed first | delivered |
| Default trainer and `rbes` | the unchanged 5.13 binary: 225 configurations and 176 fixture cases, 0 differences | **tested**, byte for byte |
| Self-test, Windows script, launchers, ZIP, identity file, reports, branch | | delivered |
| Your PC, the GPU | | **untested** - and 5.11, 5.12, 5.13 with it |

**Four things you should know before anything else.**

1. **Phase 4 did not make convergence faster.** Nothing that runs by default changed, and the two things I built to
   be faster did not show a benefit under the rules I wrote first. I expected this for pruning after the pilots and
   wrote that expectation into the plan before the run. I am releasing the negative result rather than tuning until
   something looks good: the settings were fixed before the confirmatory seeds were touched.
2. **The part of Phase 4 with real evidence behind it is the part I cannot decide.** On Linux, as a side arm of the
   threads experiment (information only, 12 seeds, 4 s), `rbes` reached 0.37 to 0.87 of the default trainer's
   NashConv on all six wide games. Your brief says your PC's equal-time results come first, so nothing was switched.
   The kit for it has been ready since 5.13; it takes 1.5 to 2 hours.
3. **Threads are a question for your processor, not mine.** With 4 processors and 4 threads there is no idle core,
   the games with exact NashConv are too small for threads to pay, and the one "not recommended" verdict (batch 4 on 4
   threads, one game, ratio 1.08) is a statement about that machine. `Run 5.14 equal-time comparison.bat` asks the
   same question with 8 threads on 24.
4. **Four releases are now waiting for your PC.** One run of the 5.14 focused launcher (15 to 30 minutes) covers
   5.11 to 5.14. Until something comes back, every phase is built on the 5.10 result plus Linux, Wine and a hosted
   Windows VM.

## 1. Baseline

The source of the delivered 5.13 archive rebuilds byte for byte (7 artifacts). Regression suite (693: 691 / 1 / 1) and self-tests of 5.13 as run at its release on this machine.

## 2. What was built

* **Pruning in the external-sampling traversal** (`mw_es_impl.hpp`). At a decision of the updating seat an action is
  a candidate when the strategy gives it probability 0, a decision follows it, the row has evidence (50 visit
  weights) and its regret is below -0.02 x utility scale x evidence. A candidate is skipped with probability 0.95,
  drawn from the action stream (reproducible, independent of the thread count, continues after a stop). `nrp`
  corrects nothing; `nrpc` divides the sampling probability it passes down by 0.05, which makes every increment
  unbiased and 20 times larger when it happens.
* **Identifiers, headers, refusals.** The algorithm with its settings is the `estimator` of the state; a pruned
  state continues only as itself; eight combinations that were never run are refused when the spec is read.
* **The grouped merge.** Each deal's increments are sorted by owning thread (stable, in parallel) before the merge.
* **`eqtime`**: the experiments as a shipped program, with plan text, equal-deals check, resumable units, analysis.
* **Checks:** `mwcli --selftest514` (7), `tests/v514.test.js` (8), `tests/prune514.cpp`, `validate_windows514.ps1`.

Not built: `estimator=auto`; pruning for `rbes`; pruning in the interface; threads inside one traversal; a merge
without the serial bottleneck for `rbes`.

## 3. Rules written before measuring, and their outcomes

| Rule | Outcome |
|---|---|
| The default trainer writes the states of 5.13 | met: 225 configurations and 176 fixture cases, 0 differences |
| Q1 / T1: equal-deals check | passed, 60 of 60 and 24 of 24 |
| Q2 / T2: enough valid seeds | 20 of 20 and 12 of 12 everywhere |
| Q3 / Q4, `nrp` | better 0, worse 0 of 20: **EXPERIMENTAL, no resolved benefit** |
| Q3 / Q4, `nrpc` | worse on bubble4 (1 s and 4 s), rg-hu-turn (1 s and 4 s), bubble5-icm (4 s): **NOT RECOMMENDED** |
| T3 / T4, `rbes` batch 4 on 4 threads | worse on rg-turn3: **NOT RECOMMENDED on this machine** |
| T3 / T4, `rbes` batch 16 on 4 threads | better on 1 of 6, worse on none: **unresolved** |
| Q5 / T5 | no default changed |
| P1 to P5 (`rbes` automatic) | not applied: no PC results |

**What did not go as first written.** The pruning rule that was tested is the third one. The first (a global
threshold) made NashConv 2.6 times worse on one game in a pilot at 20,000 deals, because it skipped actions after
one or two visits; the second still pruned the last action before a showdown, where nothing is saved. Both were
changed on pilot seeds (7001 to 7015) before the plan was written; CONVERGENCE-5.14.md, section 4, lists them. The
frozen-table test I built to check the estimators could not see the bias of `nrp` in its short form; the long form
run for this release (3 to 6 million deals a game) does: it rejects `nrp` on three of four games and `nrpc` on none.

## 4. Proven, tested, untested

* **Proven:** `nrpc` has the expected increments of the default estimator (MATHEMATICAL-VALIDATION-5.14.md).
* **Tested:** the default trainer and `rbes` are untouched; the grouped merge writes the same bytes; pruned states
  are reproducible across thread counts, stops and platforms (Linux, Wine, Windows Server 2025); checkpoint rules.
* **Measured, with a rule:** section 3.
* **Not proven and not shown:** that pruning helps anywhere; that `nrp` converges; any thread result beyond 4
  processors.
* **Untested on your hardware:** everything.

## 5. Decisions I made that are yours to overrule

1. **I released Phase 4 without a speed-up** rather than hold it until one appeared.
2. **`nrpc` ships although the rule says "not recommended".** It is the variant with a proof, it is opt-in, and its
   state says what made it. If you prefer, a later release removes it.
3. **No `estimator=auto`.** Building the switch before your results exist would have been building the decision.
4. **Pruning is not in the interface.**
5. **Pruning settings** (0.02, 50, 0.95) were chosen on pilots from six games and not tuned further.
6. **The Linux budgets were 1 s and 4 s** (yours: 4 s and 16 s), to keep the run to under two hours on 4 processors.
7. **The second archive was not delivered again**; the 5.3 timed test is still unchanged.

## 6. Unresolved, not done, or not established

* Whether `rbes` becomes automatic for wide games (your PC).
* Whether threads buy quality per second on a processor with idle cores (your PC).
* Whether pruning helps on trees with many bet sizes: there is no exact measure for them in the program yet. Phase 7
  (exact exploitability on the GPU for heads-up games) would give one for two seats.
* With `rbes` and frozen batches the merge takes 30 to 40% of the time at 4 threads and does not scale.
* A 5.13 program silently ignores `"pruning"` in a spec.
* From earlier phases, unchanged: the satellite model's input problem; the 15-100 BB charts against played-out
  postflop; the root-level 2.9 workflow that fails on every push.

## 7. What to run, and what to send back

WINDOWS-TESTS-5.14.md. In order of value: (1) the 5.13 rbes kit -> folder `rbes-equal-time-results`; (2) `Run 5.14
focused validation.bat` -> `Windows-focused-validation-5.14.json` / `.txt`, `Windows-selftest514-5.14.json`; (3) `Run
5.14 equal-time comparison.bat` -> folder `equal-time-results` without `units`; (4) `Run 5.14 Windows validation.bat`
-> the report files listed there.
