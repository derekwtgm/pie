# Final development report — EightMax 5.7

Build `e4668abe7903f8b0`, upgraded from 5.6 (`7ee054b44c409149`). The SHA-256 of the archive cannot be written inside the archive; it is in `EightMax-Windows-5.7.identity.json`, delivered beside the ZIP.

Classes used below: **1** independently tested (the unchanged 5.6 binary, an exact reference or an independent implementation agrees); **2** verified by the project's own tests on Linux or by the Windows programs under Wine; **3** implemented, never executed on Windows hardware or an NVIDIA GPU; **4** not implemented, unsuccessful or not executed.

Nothing was run on a Windows machine or on an NVIDIA GPU. Measurements are from a four-processor Linux container, not the target PC.

## 0. The 5.6 baseline

Archive, manifest (4,261 entries), executables and source fingerprint equal the supplied identity. The unmodified source rebuilt to byte-identical Windows and Linux programs. The regression suite on the rebuilt programs gave 580 passed, 2 failed, 1 skipped against the reported 582 / 0 / 1: one desktop-host test is load-sensitive (passes alone) and one failed for a real, small defect of the 5.6 host (section 2). Details: VALIDATION-5.7.md section 1. (Class 1.)

## 1. Implemented changes

| Change | What it does | Class |
|---|---|---|
| Worker pool that stays runnable | Helper threads poll for work for up to 200 microseconds after their last piece of work instead of sleeping between the stages of consecutive updates; the caller wakes only helpers it needs | 1 (states identical) |
| Deal shares | Each thread keeps a contiguous share of an update's deals from update to update and takes leftover deals when it is done | 1 |
| Parallel preparation | Showdown scores, card codes and hand-group keys (Compact numbers and Detailed texts) are computed on all threads; only keys new to the dictionary are interned, in deal order | 1 |
| Ordered resolve, parallel merge | New betting states and table rows get their identifiers in deal order; increments are then added on all threads, table rows partitioned among them, each thread walking the deals in order, so every row receives its additions in the 5.6 order; the delta is applied row by row in parallel | 1 |
| Measured thread choice | The number of threads of an update, and whether the short stages are spread, are chosen from seconds per unit of work of the running workload and re-measured; they never change a result | 2 |
| Evaluator path tree | An evaluator builds each betting state and terminal pot layout once instead of on every visit; private per thread, bounded by evaluator memory | 1 (results bit-identical) |
| Card code | Three-element sorting network and written-out binomials instead of `std::sort` and loops | 1 (compared exhaustively) |
| `mwcli --selftest57` | In-engine checks and comparisons with states and values written by the 5.6 binary | 2 |
| Windows validation script, launcher, CI workflow | Rewritten (section 10) | 3 |

Not changed: the default trainer (one deal per update), the experimental estimators, the statistics, checkpoint formats, ICM, every CUDA path, the interface. `EIGHTMAX_LEGACY_BATCH=1` selects the 5.6 frozen-batch update and `EM_EV_NO_PATHS=1` the 5.6 evaluator path, for comparison.

## 2. Repaired defects

| Defect | Effect | Repair | Class |
|---|---|---|---|
| The desktop host reported elapsed training time with three decimals | A training segment shorter than half a millisecond had no throughput in the dashboard; the 4.7 live-monitor test failed on a fast machine with the unmodified 5.6 programs | Microseconds | 2 |
| Several threads rarely helped one training (5.6: 0.87x to 1.85x (median 1.42x) from 1 to 4 threads) | Helpers were woken per batch; deals changed processor every batch; preparation and merge were serial | Section 1 | 1 |
| The evaluators rebuilt betting states and pot layouts on every visit | More than half of the instructions of a sampled evaluation | Path tree | 1 |
| The Windows thread check of `validate_windows56.ps1` compared single-threaded runs with each other | It could not have detected a thread-dependent state | A 64-deal spec with every update forced onto all threads | 3 |
| CI steps with `continue-on-error: true` | A failing validation could end in a green run | No such step; one regression gate; listed load-sensitive tests retried once, alone, and reported | 3 |
| A 5.6 test bounded its resume loop by a fixed count | Failed under the sanitizer build although the result was right | Bound follows the test's own reference run | 2 |

No error was found in 5.6's mathematics.

## 3. Mathematical validation

- **Trainer.** 1085 of 1085 saved states are byte-identical to the unchanged 5.6 binary's over 225 applicable configurations (10 games and 5 fixtures with hand groups; one deal per update and frozen batches of 4 to 64 deals; 1 to 16 threads, measured and forced; DCFR, CFR+, uniform weighting, warm-up schedule, terminal estimators, own-hand and river enumeration, river-shared and river-cross, exploration 0.3, table budgets of 1 and 2 MiB), and 208 trainings stopped and continued with other thread counts equal the uninterrupted ones. This covers chance sampling, reach probabilities, regret and average-strategy updates, normalisation, terminal utilities, side pots, all-in handling, fold/call/raise logic, zero-probability actions, chip EV and ICM in training: any of them would change the bytes. (Class 1.)
- **Evaluators.** Sampled and exact response gains, sampled action EVs and complete studies give the documents the 5.6 binary gives (10 of 10 sampled and 6 of 6 exact benchmark cases identical in every number; 8 of 8 studies identical in every per-seed measurement). The sampling distribution is unchanged because the random streams and every arithmetic operation are. (Class 1.)
- **Independent implementations.** The Python best-response checker (4.7, 4.8) and the independent exact CFR increments (5.5, 5.6) are part of the regression suite and agree with the engine. They were not extended in 5.7 because no formula changed.
- **Numerical stability.** Non-finite increments are refused at the same point of the same update as in 5.6 (the test moved from the merge to the traversing thread; the first failing increment in deal order decides). ASan, UBSan with float-cast-overflow and ThreadSanitizer: VALIDATION-5.7.md section 4.
- **Not required to match, and recorded:** the high-water marks of transient and table allocations (`scratchPeakBytes`, `tablePeakBytes`), which move by up to a few hundred bytes (kilobytes on the largest tables) because the list of touched rows grows after the update's new rows exist. The table size a study's limit is compared with is unchanged.

## 4. CPU performance and parallel scaling

Details and raw data: PERFORMANCE-5.7.md.

| Measurement | Result |
|---|---|
| Frozen-batch training, 4 threads offered, 5.7 against 5.6 | **1.34x to 1.74x (median 1.56x)** faster |
| 1 to 4 threads | 5.7: 1.44x to 2.37x (median 1.97x); 5.6: 0.87x to 1.85x (median 1.42x) |
| Frozen-batch training at 1 thread, 5.7 against 5.6 | 0.93x to 1.05x (median 1.01x) |
| Default trainer, one thread | 0.87x to 1.12x (median 0.98x): unchanged within the noise of the machine |
| Same saved state for every thread count and both versions | yes, in every benchmark cell |

What still runs on one thread: sampling the deals, interning new hand-group keys, creating new betting states and rows. Scaling is therefore not proportional to the thread count and is weakest while a table grows fast. No measurement exists above 4 threads or on a CPU with performance and efficiency cores.

## 5. Evaluation

| Measurement | Result |
|---|---|
| Sampled evaluation, 5.7 against 5.6 | **1.25x to 3.27x (median 1.81x)** faster (20% to 69% less time), 10 of 10 cases bit-identical |
| Exact evaluation | 0.79x to 1.06x (median 0.98x) (no measurable change; the low end is a 23-millisecond evaluation), 6 of 6 cases bit-identical |
| Complete studies (4 threads) | wall time 0.96x to 1.94x (median 1.37x); 8 of 8 identical in every measurement |

By study: akq-river exact, standard preset 1.58x; 3-player preflop small, sampled, standard preset 1.76x; 3-player flop small, exact, standard preset 1.02x; 6-player flop, sampled, standard preset 1.15x; 3-player flop, sampled, standard preset 1.94x; 8-handed ICM small, exact, 2 seeds x 2 budgets 0.96x; 6-player flop small, exact, 2 seeds x 2 budgets 1.03x; 8-handed ICM, sampled, standard preset 1.76x.
The four studies that take about a second were measured again with five repetitions each (best of five): akq-river exact, standard preset 0.99x; 3-player flop small, exact, standard preset 0.97x; 8-handed ICM small, exact, 2 seeds x 2 budgets 1.09x; 6-player flop small, exact, 2 seeds x 2 budgets 1.00x.

## 6. Multiway and ICM

Exact multiway and ICM evaluation was already fast in 5.6 (showdown tables, passive runouts) and gains little in 5.7; values are identical. **Sampled** multiway and ICM evaluation, which dominates the large studies, is what improved (three-player flop, four-player turn, five- and six-player flop, eight-handed ICM and the four-player ICM bubble are all in the table of PERFORMANCE-5.7.md section 5). The ICM prize-equity kernel and the side-pot code were not touched.

## 7. Convergence

Details: CONVERGENCE-5.7.md. Fixed plans written before measurement; exact NashConv; paired seeds; exact sign test and paired t interval, both Bonferroni-adjusted.

- **Equal sampled deals:** 210 of 210 checkpoint files identical for the default trainer and 210 of 210 for frozen batches on four threads. 5.7 is 5.6.
- **Equal time (1.0 s), 5.7 frozen batches on four threads against 5.6 frozen batches on four threads:** better in turn4, bubble4; unresolved in hu-river, hu-turn, river3-chip, flop6, final8; worse in no game.
- **Equal time, frozen batches on four threads against the default trainer on one thread:** better in turn4; unresolved in hu-river, river3-chip, flop6, final8, bubble4; worse in hu-turn. The promotion rule (better in every game) is **not met**.
- **Equal time, default trainer 5.7 against default trainer 5.6** (the same code; a check of the method): hu-river unresolved, hu-turn unresolved, river3-chip unresolved, turn4 unresolved, flop6 unresolved, final8 unresolved, bubble4 unresolved.
- **Six-player flop game (unresolved in 5.6).** The cause was statistical power: the effect was 0.36 standard deviations of the paired difference against 0.6 to 1.9 in the other games, and the 5.6 tests needed about 125 to 145 pairs where 60 were run. With 160 pairs the faster default trainer against 5.5 at 0.5 s is "better" (ratio of means 0.62; 121 seeds lower, 39 higher) with the 5.6 binary and "better" with the 5.7 binary.
- **Quality measures for games without exact NashConv.** On 90 trained states with a known exact answer the restricted best response exceeded the exact gain in 0 of 400 seat values and the sampled measure exceeded it by more than four standard errors in 0 of 400: both are lower bounds, as they must be. How much of the exact NashConv they find varies from a few percent to all of it, by game and by training length.

## 8. Checkpoints, memory and reliability

| Situation | Result | Where |
|---|---|---|
| Normal completion; stop and resume; time limit; process-memory budget; hard kills; many consecutive restarts; damaged manifest or state; another build; another trainer; a second process on the same checkpoint | the 5.5 and 5.6 tests, all passing on 5.7 | regression suite |
| A training stopped and continued with a different number of threads | equals the uninterrupted training (208 cases) | `identity/`, `v57.test.js`, self-test |
| A solver checkpoint of 5.6 continued by 5.7 | byte-identical to 5.6 alone (the states are the same bytes at every point) | `identity/` |
| A study paused and resumed repeatedly through the desktop host; 25 sequential studies; cancellation during evaluation; a training study with a checkpoint every 5 s | 11 of 11 checks passed (three-minute run; the six-minute run of 5.6 reaches a limit described in section 12) | `stability/` |
| Table budget reached during a frozen batch | the state and every counter equal 5.6 at the same thread count; nothing of the failed update remains | `identity/`, `v57.test.js` |
| Interrupted checkpoint writes, power loss, NTFS | not tested (as in 5.6) | — |

Memory: the new per-thread structures are outside the table budget and small (lists of touched rows, hand-group keys of at most 64 deals, a deal queue). An evaluator's path tree is at most 8 MiB and at most 1/64 of the evaluator memory. Peak resident memory of the studies is in PERFORMANCE-5.7.md section 6. GPU memory: no change, nothing measured. A table or dictionary limit ends an update without partial writes, as before. Study checkpoints of 5.6 cannot be continued by 5.7 (a study checkpoint is tied to its build); they are refused with the reason.

## 9. Regression results

**592 tests: 591 passed, 0 failed, 1 skipped on the final build.** After every failed test was run again alone: 591 passed, 0 failed, 1 skipped. 5.6 had 583 tests; 9 are new (`source/tests/v57.test.js`). One existing test was edited (the resume bound of a 5.6 test, section 2).

## 10. Windows validation and CI

- `source/tools/validate_windows57.ps1` replaces the 5.6 script: every check has a status (passed, failed, skipped, untested, info) and a class (gate, environment, hardware, information); every planned check that is not reached is reported as untested; arguments are quoted by the Windows rules; every child process has a time limit and is stopped at the end; requests to the local host bypass the system proxy; numbers are compared at full precision; the temporary folder is removed in a `finally` block; no NVIDIA device gives a GPU **skip with the reason**, never a pass. Exit status 0, 1 (a gate failed or was not reached) or 2 (the script failed).
- `Run 5.7 Windows validation.bat` first runs `mwcli.exe --selftest57`, which needs no PowerShell, then the script.
- `.github/workflows/windows.yml`: steps classified in the file header; no `continue-on-error`; the regression suite runs once, as a gate; evidence is uploaded with `if: always()`.
- **None of this has been executed.** PowerShell could not be installed and the repository was read-only for the session. What was executed: the self-test through the Windows program under Wine (28 of 28 checks passed), and the packaged smoke tests under Wine.

## 11. GPU

Not validated. No CUDA code changed in 5.7. The GPU paths ran only against the simulated driver inside the Linux regression suite, which is not GPU execution. On a machine without a GPU, the GPU-Preferred, Automatic and Hybrid modes fall back to the CPU and give the CPU-only measurements (checked on the packaged Windows programs under Wine).

## 12. Remaining issues

- Nothing validated on Windows hardware or a GPU; the PowerShell script and the CI workflow are unexecuted.
- **Defect found and not repaired** (present in 5.6 and 5.7): A study whose budget exceeds 10,000,000 deals per seed (one deal per update) fails with "Iteration count must fit the 10 million iteration limit" when a seed reaches the limit, instead of being refused when it starts. Workaround: keep study budgets at or below 10,000,000 deals per seed (the shipped fixtures stop at 4,000,000); with frozen batches the limit is 10 million updates, that is 640 million deals at 64 deals per update.
- Frozen-batch scaling is partial (section 4) and unmeasured beyond four threads.
- Frozen-batch training is not better than the default trainer at equal time in every game, so the faster parallel mode does not by itself give better strategies per second; see section 7.
- With a table budget of one or two megabytes, the update at which training stops depends on the number of threads (5.6 and 5.7 alike).
- Exact NashConv exists only for small games; the measures available for the realistic fixtures are lower bounds of unknown tightness; abstraction error is not measured.
- Sampled quality has no calibrated interval; across trainings only the typical training is addressed (unchanged from 5.6).
- No estimator beats the default at equal time on every game (unchanged from 5.6; no estimator research was done in 5.7 beyond the comparison of the two training modes).
- The formal statistical simulations and the long expected-increment runs of 5.6 were not rerun.

## 13. Recommended priorities for 5.8

See ROADMAP.md: physical validation first; the serial parts of a frozen-batch update; a training mode that wins at equal time; quality measurement for the realistic fixtures.

## 14. The fourteen questions

1. **How much faster is 5.7 than 5.6?** On the development container: frozen-batch training with four threads 1.34x to 1.74x (median 1.56x); sampled evaluation 1.25x to 3.27x (median 1.81x); complete studies 0.96x to 1.94x (median 1.37x) in wall time (the two large sampled studies gain the most); the default single-thread trainer and exact evaluation are unchanged. Nothing was measured on the target PC.

2. **Does the solver scale better across cores?** Yes, within one frozen-batch training: from 1 to 4 threads 5.7 gains 1.44x to 2.37x (median 1.97x) where 5.6 gained 0.87x to 1.85x (median 1.42x), with the same saved state. It is not proportional: deal sampling and the creation of new states and rows stay on one thread. Studies still use cores by running seeds side by side, as before.

3. **How much faster is sampled evaluation?** 1.25x to 3.27x (median 1.81x), that is 20% to 69% less time, with every reported number identical to 5.6.

4. **Were exact multiway and ICM calculations improved?** No measurable change: 0.79x to 1.06x (median 0.98x), values identical; the spread is machine noise on evaluations that take from 20 milliseconds to 20 seconds (PERFORMANCE-5.7.md section 8). 5.6 had already removed their main costs. Sampled multiway and ICM evaluation is what improved.

5. **Does 5.7 converge faster at equal wall-clock time?** With the default trainer: no change (it is the same trainer; identical at equal deals). With frozen batches on four threads against 5.6's frozen batches on four threads: better in turn4, bubble4; unresolved in hu-river, hu-turn, river3-chip, flop6, final8; worse in no game. Against the default trainer the parallel mode is better in turn4, unresolved in hu-river, river3-chip, flop6, final8, bubble4 and worse in hu-turn, so it is not a general improvement in strategy quality per second. Separately, the six-player flop comparison that 5.6 left unresolved (the faster 5.6 default trainer against 5.5 at 0.5 s) is resolved with 160 paired seeds: "better".

6. **Did the mathematical outputs remain correct?** Yes, as far as tested: every trained state compared is byte-identical to 5.6's, and every evaluation and study measurement compared is bit-identical. No unexplained difference was found.

7. **Does checkpoint recovery remain deterministic?** Yes on Linux: every 5.5 and 5.6 recovery test passes, and a training stopped and continued with another thread count equals the uninterrupted one. Not tested on NTFS or under power loss.

8. **Were any new training algorithms promoted to the default?** No. The only candidate, frozen-batch training on several threads, did not meet the rule set in advance.

9. **How many regression tests passed, failed or were skipped?** 592 tests: 591 passed, 0 failed, 1 skipped in one run on the final Linux build; after each failed test was run again alone: 591 passed, 0 failed, 1 skipped.

10. **Were Windows CI and validation scripts repaired?** They were rewritten and statically checked; neither has been executed, so "repaired" is not established. The part of the validation that does not need PowerShell (`mwcli.exe --selftest57`) passes under Wine.

11. **What was actually tested on physical Windows hardware?** Nothing.

12. **Was GPU execution independently validated?** No. Not on any GPU, by anyone, for this release.

13. **The strongest defensible statement about GTO accuracy.** On seven small games with an exact all-seat best response, the default trainer's exact NashConv inside each game's abstraction falls with training as measured in CONVERGENCE-5.6.md and CONVERGENCE-5.7.md, and 5.7 computes exactly what 5.6 computed. For the realistic eight-handed tournament fixtures there is no exploitability figure: only lower bounds from restricted and sampled deviations, whose tightness on those games is unknown. With more than two players NashConv is not exploitability in any case. No percentage of GTO completeness can be given.

14. **What remains before more realistic full-game strategies can be evaluated accurately?** (a) A stronger lower bound with a checked direction (a restricted response widened street by street) and exact best responses inside sampled subgames; (b) a measurement of abstraction error (bet sizes, ranges, hand grouping); (c) an upper bound, for which no cheap method exists in multiway games; (d) replication large enough to bound training failures; (e) physical validation of the Windows and GPU paths.


## Delivery record (added to the delivered copy; it cannot be inside the archive)

The text above is byte for byte the `FINAL-REPORT-5.7.md` inside the archive. What follows was computed after the final archive existed.

| Item | Value |
|---|---|
| Archive | `EightMax-Windows-5.7.zip`, 79,168,498 bytes |
| Archive SHA-256 | `283df7c4464b37524f9682cf715c8895dc97e16a0493f2f835f36e0293ef9d5e` |
| Version and build (source fingerprint) | 5.7, `e4668abe7903f8b0` |
| Archive members / manifest entries | 4535 / 4534, every entry re-hashed in a clean extraction |
| `SHA256SUMS.txt` SHA-256 | `347aec3a15778c291744ca2e229a013f3f9f52b51979ec04640eb5193746658a` |
| `EightMax.exe` | `83c090cf63defa0444dbae2b324af8d86ff1ccd95c6488c6e88f7b0167e671b9` |
| `mwcli.exe` | `eb599ea01702c1bdd487958c030790d4d8cb843b1a9cd6222f8a28cd09db384c` |
| `gpustress.exe` | `f8f6f9f34ea3b6dcba990c1e3e77693939455d368d63a3ed8cfc5a51e357c5b1` |
| Smoke tests of the extracted archive | passed, through the Windows programs under Wine (not on Windows) |

The same record, with every smoke-test result and the validation status, is `EightMax-Windows-5.7.identity.json`, delivered beside the ZIP.
