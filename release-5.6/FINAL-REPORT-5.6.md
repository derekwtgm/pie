# Final development report — EightMax 5.6

Build `7ee054b44c409149`, upgraded from 5.5 (`abe74607a4a0120b`). The SHA-256 of the archive cannot be written inside the archive; it is in `EightMax-Windows-5.6.identity.json`, delivered beside the ZIP.

Every statement below carries one of four classes:

1. **Implemented and independently tested**: an independent implementation, an exact reference, or the unchanged 5.5 binary agrees.
2. **Implemented and verified by simulation or Wine**: the project's own tests and simulations on Linux, and the Windows programs under Wine.
3. **Implemented, awaiting physical hardware validation**: written, never executed on Windows hardware or an NVIDIA GPU.
4. **Not implemented or unsuccessful.**

Nothing was run on a Windows machine or on an NVIDIA GPU. No test is reported as passed that was not executed. The machine-readable form of this report is `validation/5.6/validation-summary.json`.

## 0. The 5.5 baseline

The supplied archive was taken from the `eightmax-5.5` branch of the repository. Before any change: archive SHA-256 `3853b34aa2f97d8087fa619cb12468d9fe98fc17337a1e15679fb350567894c9` equals the identity file; all 3,939 manifest entries verified (0 failed); `EightMax.exe`, `mwcli.exe` and `gpustress.exe` hashes equal the identity file; the unmodified source rebuilds to fingerprint `abe74607a4a0120b`; the regression suite on the rebuilt Linux programs gave 568 tests, 567 passed, 0 failed, 1 skipped, the totals of the 5.5 report. The extraction is kept untouched. (Class 1.)

## 1. Defects discovered and repaired

| Defect in 5.5 | Effect | Repair in 5.6 | Class |
|---|---|---|---|
| Showdown tables kept every seat's score on every board for their whole life; the shared cache was capped at 64 tables | Exact best responses rebuilt the same tables continuously. With its default 1,024 MiB cache 5.5 did not finish the exact NashConv of an eight-handed ICM game with two-hand ranges within its 30-minute limit | Scores are released once the rank-pattern histogram exists; the cap is 4,096; each table is built once | 1 |
| Passive runouts were enumerated card by card for every opponent-hand tuple | Six-player flop best responses spent most of their time scoring the same boards | The single terminal state is evaluated through the deal's showdown table | 1 |
| Nothing prevented two processes from continuing the same saved study | Both would pass every check and then overwrite and delete each other's checkpoint generations | An operating-system lock on the checkpoint directory; the second process is refused and changes nothing | 2 |
| A `ranked` verdict from five trainings was shown as "Prefer X" | A recommendation without support beyond the trainings that were run (5.5 documented the gap) | A best action is declared only if an exact sign test over the trainings supports it; otherwise the leader is reported as the leader among the measured trainings, with explicit warnings | 2 |
| `seeds=N` could not exceed the fixture's seed list | A study could not be given more trainings without typing a list | A larger count continues with consecutive seeds | 2 |
| The trainer spent a large share of every cheap sampled deal on bookkeeping (allocation per update, repeated hash lookups, rebuilding terminal states, clock reads) | Training throughput well below what the algorithm needs | Removed without changing a computed number (section 2) | 1 |
| Build notes did not name the MinGW zlib development package | `mwcli.exe` does not link without `libz-mingw-w64-dev` | BUILD-5.6.md names it | 2 |

No error was found in 5.5's mathematics. Its default estimator and its river enumeration both agree with an independently computed exact CFR update (section 3), and its checkpoints, payoffs and intervals passed every re-test.

## 2. Algorithms implemented

- **Default trainer (external-sampling MCCFR), same estimator, less work per deal.** Child links and terminal records for stored betting states; the table row carried from the strategy read to the merge; one undo journal per training call; stage timing sampled on one update in sixteen; one flop code per deal; number lookup for Compact hand-group keys. State files are byte-identical to 5.5. (Class 1.)
- **`opponentEnumeration: "river-shared"`** (opt-in): on a final-street game one walk per deal updates every seat. (Class 1 for its increments, which equal 5.5's enumeration entry by entry.)
- **`opponentEnumeration: "river-cross"`** (opt-in, the 5.6 candidate): additionally, in games that start earlier, each seat's traversal updates the other seats' final-street information sets, importance-weighted, each traversal with weight 1/n. (Class 1 for its expectation; **class 4 as a new default**: the promotion rule was not met.)
- **Compact showdown tables and passive runouts** in the exact evaluator. (Class 1.)
- **Replication statistics** `study-5.6-replication-v1`: per-training certificates, exact sign test for the typical training, minimum trainings, undetectable failure rate, warnings, and a gated best-action declaration. (Class 2.)
- **Checkpoint directory lock.** (Class 2 on Linux and under Wine; class 3 on NTFS.)

## 3. Mathematically verified changes

**Expected increments against an independent exact target.** `source/tools/independent_cfr56.py` recomputes, in Python and with its own betting rules, side pots, hand evaluator and chance enumeration, the exact counterfactual-regret and average-strategy increment of every table entry of a frozen table. `source/tests/enum56.cpp` measures the engine's Monte Carlo mean. 13 estimator-game combinations (default, 5.5 river, river-shared, river-cross on a heads-up river, a three-player river with side pots, a heads-up turn-and-river and a four-player turn-and-river game), 5,000,000 to 30,000,000 deals each: all passed. Largest regret |z| 3.40 and average |z| 4.11 against Bonferroni limits of 3.60 to 4.39; no deterministic mismatch. On the two river games `river-shared` wrote the same increments as 5.5's `river` for the same deal in 32,514,136 compared entries (largest relative difference 0). (Class 1.)

**Trainer identity with 5.5.** 170 cases (10 games x 17 configurations: one deal per update, frozen batches with 1 to 4 threads, warm-up schedule, DCFR, uniform weighting, CFR+, terminal estimators, own-hand enumeration, 5.5 river enumeration, exploration 0.3, a 1 MiB table budget), each also trained in two parts: 0 differences from the 5.5 binary. 210 checkpoints of the convergence run retrained by the released binary: 0 differing. 11 golden states: 0 differing. Solver checkpoints continued across versions in both directions: 16 of 16 identical. (Class 1.) This covers reach probabilities, chance sampling, strategy normalisation, average-strategy accumulation, terminal utilities, side pots, fold/call/raise/all-in handling, chip EV and ICM in training: every one of them would change the bytes.

**Evaluator.** Exact NashConv of 5.5 and 5.6 on the same states: 14 comparisons, 8 bit-identical, largest relative difference 2.8e-15 (tolerance set in advance: 1e-9). Complete studies of both versions: 178 per-seed measurement points compared, 144 bit-identical, 34 within 1e-9, 0 differing. (Class 1.) The independent Python best-response checker of 4.8 (`independent_br48.py`) still agrees with the engine in the regression suite.

**Statistics.** Binomial tails, minimum trainings, undetectable failure rates and order-statistic coverage agree with SciPy to 2e-16; 20 scenarios, 4000 trials each for exact evaluation: every pass rule held. (Class 2: simulations of the shipped aggregation code against truths generated independently; see section 6 of this report and STATISTICAL-VALIDATION-5.6.md.)

Zero-probability actions, numerical stability and determinism: zero-probability opponent actions are still traversed under enumeration (the independent target includes paths the opponent never plays, and the average-strategy entries agree); non-finite increments are refused as before; AddressSanitizer and UndefinedBehaviorSanitizer with float-cast-overflow reported nothing (section 9).

## 4. Convergence results and comparison against 5.5

Fixed plan written before measurement: 7 games with exact all-seat best response, 60 paired seeds, 5 arms, 3 equal-deal and 2 equal-time budgets, 10,500 checkpoints, exact sign test and paired t interval, both Bonferroni-adjusted. Full tables: CONVERGENCE-5.6.md.

| Game | Equal deals: 5.6 default vs 5.5 | 0.5 s: NashConv ratio 5.6 / 5.5 | Sampled deals in 0.5 s, 5.5 -> 5.6 | Seeds lower / higher | Primary verdict | Candidate vs 5.6 default at 0.5 s |
|---|---|---|---|---|---|---|
| hu-river | identical (60 of 60 checkpoints) | 0.70 | 385,046 -> 834,288 | 50 / 10 | **better** | unresolved (ratio 0.84) |
| hu-turn | identical (60 of 60 checkpoints) | 0.74 | 343,320 -> 657,359 | 58 / 2 | **better** | unresolved (ratio 0.97) |
| river3-chip | identical (60 of 60 checkpoints) | 0.71 | 257,809 -> 499,521 | 48 / 12 | **better** | worse (ratio 1.29) |
| turn4 | identical (60 of 60 checkpoints) | 0.27 | 166,986 -> 317,338 | 60 / 0 | **better** | better (ratio 0.45) |
| flop6 | identical (60 of 60 checkpoints) | 0.70 | 86,052 -> 169,845 | 40 / 20 | **unresolved** | not changed by the candidate (ratio 0.95) |
| final8 | identical (60 of 60 checkpoints) | 0.26 | 54,488 -> 111,134 | 60 / 0 | **better** | not changed by the candidate (ratio 1.09) |
| bubble4 | identical (60 of 60 checkpoints) | 0.35 | 224,190 -> 381,965 | 60 / 0 | **better** | not changed by the candidate (ratio 0.99) |

- The default trainer is the 5.5 estimator: identical at equal deals. At equal wall-clock time it is closer to equilibrium on 6 of 7 games under the primary test (hu-river, hu-turn, river3-chip, turn4, final8, bubble4); unresolved on flop6. (Class 1.)
- The candidate is better per sampled deal on all four games it changes, better than 5.5's default and 5.5's enumeration at equal time in most contrasts, and **not** reliably better than the faster 5.6 default: hu-river unresolved, hu-turn unresolved, river3-chip worse, turn4 better. The promotion rule was not met; the default is unchanged. (Class 4 for promotion; the experiment itself is complete.)

## 5. CPU performance

Development container (four logical processors), against the unchanged 5.5 binary. Not the target PC.

**Training throughput** (default trainer, one thread, 300,000 deals, best of 5): 1.15x to 2.81x faster, median 1.67x; same state bytes in all 10 fixtures.

| Fixture | 5.5 deals/s | 5.6 deals/s | Speed-up |
|---|---|---|---|
| btn25-open | 58,730 | 85,699 | 1.46x |
| btn25-open-small | 528,412 | 857,805 | 1.62x |
| flop3-kings | 57,423 | 86,138 | 1.50x |
| flop3-kings-detailed | 29,656 | 34,129 | 1.15x |
| flop3-kings-small | 396,084 | 684,957 | 1.73x |
| flop6-jack | 24,108 | 36,218 | 1.50x |
| flop6-jack-small | 126,448 | 217,908 | 1.72x |
| icm8-bb-call | 203,162 | 378,204 | 1.86x |
| icm8-bb-call-small | 663,130 | 1,158,802 | 1.75x |
| known-akq-river | 1,105,693 | 3,103,630 | 2.81x |

**Complete studies** (4 threads, best of 2):

| Study | 5.5 wall s | 5.6 wall s | Ratio | Training s 5.5 -> 5.6 | Peak RSS MiB 5.5 -> 5.6 |
|---|---|---|---|---|---|
| akq-river exact, standard preset | 0.19 | 0.08 | **2.43x** | 0.5 -> 0.2 | 19 -> 19 |
| 3-player preflop small, sampled, standard preset | 2.52 | 2.06 | **1.22x** | 3.4 -> 1.9 | 19 -> 19 |
| 3-player flop small, exact, standard preset | 6.55 | 0.88 | **7.45x** | 4.2 -> 2.4 | 19 -> 19 |
| 6-player flop, sampled, standard preset | 28.85 | 23.38 | **1.23x** | 65.8 -> 45.4 | 171 -> 219 |
| 3-player flop, sampled, standard preset | 230.77 | 235.94 | **0.98x** | 26.3 -> 20.6 | 166 -> 184 |
| 8-handed ICM small, exact, 2 seeds x 2 budgets | 11.06 | 7.40 | **1.50x** | 0.0 -> 0.0 | 2423 -> 102 |
| 6-player flop small, exact, 2 seeds x 2 budgets | 68.88 | 1.18 | **58.58x** | 0.2 -> 0.1 | 19 -> 21 |
| 8-handed ICM, sampled, standard preset | 154.49 | 155.18 | **1.00x** | 12.7 -> 7.8 | 168 -> 180 |

**Threads.** Frozen-batch training with 1, 2 and 4 threads gives the identical state for every thread count and both versions (all games). Four-thread speed-up over one thread, 5.6: flop6w 1.09x, final8w 1.17x, turn4 0.70x, flop5 0.94x; 5.5: flop6w 1.49x, final8w 1.64x, turn4 0.74x, flop5 1.06x. Thread scaling was not improved: 5.6 is faster at every thread count measured, and the single-threaded merge is a larger share of what remains; studies use processors by running seeds side by side.

**Memory.** Training alone, 1,000,000 deals: flop3-kings 26 -> 26 MiB; flop6-jack 62 -> 72 MiB; icm8-bb-call 23 -> 29 MiB; btn25-open 332 -> 338 MiB; flop3-kings-detailed 682 -> 682 MiB. Training uses slightly more (link records, at most 16 MiB per engine, and a key index); exact evaluation uses much less. No default assumes more than 70% of installed memory.

Regressions in time: none beyond run-to-run variation. The lowest ratios measured were 0.98x for the three-player sampled study (its time is almost all unchanged sampled evaluation) and 0.8x to 0.9x on two exact evaluations that take 0.03 s and 0.15 s. Memory of training is slightly higher, as stated. Details and the profile: PERFORMANCE-5.6.md.

## 6. Multiway and ICM improvements

| Exact all-seat best response | Cache | 5.5 | 5.6 | Same value |
|---|---|---|---|---|
| bubble4 | 128 MiB | 56.46 s | 1.26 s | bit-identical |
| bubble4 | 1024 MiB | 1.49 s | 1.25 s | bit-identical |
| final8 | 128 MiB | 0.19 s | 0.13 s | bit-identical |
| final8 | 1024 MiB | 0.13 s | 0.15 s | bit-identical |
| flop5 | 128 MiB | 0.39 s | 0.03 s | to 2e-16 |
| flop5 | 1024 MiB | 0.37 s | 0.03 s | to 2e-16 |
| flop6 | 128 MiB | 2.13 s | 0.10 s | to 6e-16 |
| flop6 | 1024 MiB | 2.08 s | 0.10 s | to 6e-16 |
| flop6w | 128 MiB | 32.43 s | 1.20 s | to 3e-15 |
| flop6w | 1024 MiB | 32.58 s | 1.04 s | to 3e-15 |
| final8w | 128 MiB | not finished in 300 s | 19.66 s | n/a |
| final8w | 1024 MiB | not finished in 300 s | 20.23 s | n/a |
| turn4 | 128 MiB | 0.04 s | 0.03 s | bit-identical |
| turn4 | 1024 MiB | 0.03 s | 0.03 s | bit-identical |
| river3-chip | 128 MiB | 0.01 s | 0.00 s | bit-identical |
| river3-chip | 1024 MiB | 0.01 s | 0.00 s | bit-identical |

5.5 answered slow exact ICM evaluation with a larger cache. 5.6 removes the need: tables shrink to their histograms, and runouts in which nobody can act use them. Six-player flop best responses and four- and eight-handed ICM best responses are the cases that gain; values are unchanged. The ICM prize-equity kernel was profiled (about 3.5% of training instructions on the eight-handed fixture) and deliberately left alone. No new ICM model was introduced. (Class 1.)

## 7. Checkpoint test results

| Situation | Result | Where |
|---|---|---|
| Normal completion; Stop and resume; time limit; process memory budget; hard kills at several moments; many consecutive restarts | resumed result equals the uninterrupted one (5.5 tests, all passing on 5.6) | `v55.test.js`, `stability/` |
| The same with an experimental 5.6 trainer | equal to the uninterrupted study, replication verdicts and warnings included | `v56.test.js` |
| Damaged manifest, damaged or missing engine state | detected by hash; falls back to the previous commit or refuses; nothing overwritten | `v55.test.js`, `v56.test.js` |
| Checkpoint written by another build (hash-valid) | refused: "written by build ...; this is build ..." | `v56.test.js` |
| Checkpoint of another trainer or study | refused (study fingerprint / study id); nothing written | `v56.test.js` |
| A second process on the same checkpoint while the first runs (resume, start, replace) | refused with status 409; nothing read or changed | `v56.test.js`, release smoke test under Wine |
| The lock after its holder is killed | gone with the process; resume succeeds and equals the uninterrupted study | `v56.test.js` |
| Repeated resume of a finished study | same document content each time | `v56.test.js` |
| Solver checkpoint of 5.5 continued by 5.6, and of 5.6 by 5.5 | byte-identical to one version alone | `cross-version-continuation.json` |
| Trainer configuration and random streams in the state | a state continues to the same bytes as one uninterrupted run for every trainer, deal streams and thread counts | `identity/`, `v56.test.js` |

Excluded from equality by design, as in 5.5: wall-clock timings, memory readings, worker counts and checkpoint bookkeeping. Study checkpoints of 5.5 cannot be migrated; they are refused with the reason. All of this ran on Linux; the 5.6 test file, lock included, also passed against the Windows programs under Wine. Real NTFS and power loss: not tested (class 3).

## 8. Regression test results

**583 tests on the final build: 582 passed, 0 failed, 1 skipped.** 5.5 had 568; 15 are new (`source/tests/v56.test.js`). One existing expectation was edited: `v52.test.js` expected `seeds=99` to be refused with the old message; the count is now refused above 64 with a new message.

- Skipped: "4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissions)" (running as root: permissions are not enforced).

Earlier complete runs are kept with the cause of every failure (`validation/5.6/tests/`): development build 15da3c3c, other jobs running, tests still being added: 577 passed, 5 failed (two desktop-host tests answered 503 while a 4 GiB evaluator comparison and a 5.5 study ran beside the suite; one test requires RELEASE-5.6.md, not yet written; two 5.6 tests were newer than the binary). build 0a680c41 (the final engine; before the last change to the Windows validation script): 582 passed, 0 failed (no failure; the log was deleted when that build was replaced, so this run is reported from the session record only). final build 7ee054b4, first run, with the Wine regression suite running on the fourth processor: 580 passed, 2 failed ("HTTP streaming refuses missing declared bytes" (v36): the desktop host answered 503 instead of 200 to the preceding upload; "5.1 crossover inside one job" (v51): a route decision that depends on measured timings chose the CPU for every batch. Both passed in the two earlier complete runs and pass when their files are run alone; both depend on machine load).

## 9. Security and stability observations

- AddressSanitizer + UndefinedBehaviorSanitizer (+ float-cast-overflow) build, the 5.3 to 5.6 regression files: 53 tests, 52 passed, 1 failed; sanitizer reports: 0. The failure is a time budget, not a defect: the one failing test allows 40 resumes of 0.4 s, which the instrumented build exceeds; the same scenario run to completion (54 resumes) equals the uninterrupted study with no sanitizer report.
- ThreadSanitizer: three seeds side by side with 50 ms checkpoints, a cancelled and resumed study, exact studies with the default and the river-cross trainer, frozen-batch training on four threads with both, and a four-thread exact best response over compact tables: 0 warnings; run exit codes 0, 0, 0, 0, 0, 0, 0, 0.
- LeakSanitizer on one complete command-line study: exit 0.
- Stability run against the desktop host (Linux build 7ee054b44c409149, 6 minutes requested): 11 of 11 checks passed, among them a study paused and resumed 201 times that equals the uninterrupted study.
- Study tab driven in Chromium against the desktop host: 20 of 20 checks passed.
- The checkpoint lock closes a real race between two processes. It relies on local file locking; network file systems that do not implement it are not protected.
- Experimental trainer options are refused in combinations that are not implemented instead of silently training something else, and a state trained with one trainer cannot be continued by another.
- The desktop host listens on 127.0.0.1 only and its request handling is unchanged. No new network code, no new file formats, no new dependencies. The executables are unsigned, as before.
- The Windows programs import only system DLLs; nothing is installed and nothing is written outside the application folder, `Documents\EightMax` and the temporary folder.

## 10. Windows and GPU validation status

| Item | Status | Class |
|---|---|---|
| Windows executables built (MinGW-w64 GCC 13, static), byte-reproducible | built twice, identical | 2 |
| 5.6 regression file against `mwcli.exe` / `EightMax.exe` under Wine 9.0 | 15 tests, 15 passed, 0 failed | 2 |
| Whole regression suite against the Windows programs under Wine, one file at a time | 41 of 41 files completed; 583 tests recorded: 514 passed, 68 failed, 1 skipped. Control with the 5.5 Windows programs on the affected files: In the three-files-at-a-time run, 4 tests of v37.test.js failed with the 5.6 Windows programs and passed with the 5.5 ones. Run alone, three times per version, that file fails the same 3 tests with both versions, so the 4 were interference between test files sharing one Wine save folder. With that, every test that fails with the 5.6 Windows programs under Wine also fails with the 5.5 Windows programs under the same harness. | 2 |
| Packaged ZIP extracted into an empty folder; smoke tests through the shipped Windows programs under Wine | passed | 2 |
| Golden states (5.5 trainer) reproduced by `mwcli.exe` under Wine | 11 of 11 | 2 |
| Execution on Windows 11 hardware | **not performed** | 3 |
| `validate_windows56.ps1` | **never executed** (no PowerShell was available to the development session; it could not even be syntax-checked) | 3 |
| GitHub Actions workflow with the new 5.6 steps | **not run** | 3 |
| CUDA on the RTX 4060 Ti: correctness and speed | **not performed.** No CUDA code changed. GPU paths ran against the simulated driver (test double) on Linux only. No GPU benchmark exists and none is quoted | 3 |
| Power-loss durability | **not tested** | 3 |

`WINDOWS-TESTS-5.6.md` gives the steps and `Run 5.6 Windows validation.bat` runs them.

## 11. Unresolved limitations

- No estimator that beats the default at equal time on every game. The candidate lost on the three-player river game.
- Exact NashConv exists only for small games. The realistic fixtures are measured by training throughput and one-decision responses, not by exploitability.
- The equal-time improvement of the default is this implementation doing the same work faster on the development machine. On flop6 it was not resolved by the primary test.
- Across trainings only the typical (median) training is addressed. The mean over trainings remains model-based, and rare training failures cannot be excluded by a few trainings; the result now says how rare.
- Sampled quality has no calibrated interval.
- Thread scaling of one training was not improved (5.6 gains less from extra threads than 5.5); sampled evaluation is unchanged and dominates the large studies.
- Training memory is slightly higher.
- The reported stage seconds of one-deal training are now sampled estimates.
- Nothing was validated on Windows hardware or a GPU, and the Windows validation script is unexecuted.
- Abstraction error (bet sizes, ranges, hand grouping) is not measured.

## 12. Recommended priorities for 5.7

1. Run the physical validation and the Windows CI; repair what they find, starting with the script itself.
2. An estimator that wins at equal time everywhere: alternating updates inside the shared walk, a baseline or variance-based weights for the cross-seat updates, enumeration limited to small subtrees. Same protocol, fresh seeds.
3. Whole-game (or calibrated lower-bound) evaluation for the realistic fixtures.
4. Sampled evaluation speed.
5. Exact evaluator: one utility per rank pattern per terminal; parallel own hands.
6. Deterministic parallel merge for single-training thread scaling.
7. A sequential replication design with a valid stopping rule; a calibrated statement for sampled quality.
8. Abstraction-error measurement.
9. Power-loss durability on NTFS.

Details: ROADMAP.md.

## 13. The eleven questions

1. **Did the default training algorithm improve?** The algorithm did not change; its implementation did. It computes exactly what 5.5 computed (byte-identical states) with 1.15x to 2.81x the throughput on the study fixtures. No new algorithm was promoted: the candidate did not meet the rule set in advance.

2. **Is the solver measurably closer to equilibrium on any validated games?** At equal wall-clock training time, yes: on hu-river, hu-turn, river3-chip, turn4, final8, bubble4 (exact NashConv, 60 paired seeds, primary test). On flop6 the mean was lower too (ratio 0.70) and the test did not resolve it. At equal sampled deals it is identical to 5.5.

3. **What improvement occurred at equal wall-clock training time?** After 0.5 s of single-thread training the mean exact NashConv of 5.6 relative to 5.5 was: hu-river 0.70, hu-turn 0.74, river3-chip 0.71, turn4 0.27, flop6 0.70, final8 0.26, bubble4 0.35 (lower is better), from 1.7x to 2.2x the sampled deals. After 0.1 s: hu-river 0.64, hu-turn 0.72, river3-chip 0.71, turn4 0.20, flop6 0.59, final8 0.29, bubble4 0.36. These are measurements on the development container.

4. **Did the mathematical calculations remain accurate?** Yes, as far as tested: trainer output byte-identical to 5.5 in 170 + 210 + 11 cases; every estimator agrees with an independent exact CFR update; exact evaluations agree with 5.5 to 3e-15 or better; the 5.5 statistical validation passes again. No unexplained divergence.

5. **Were multiway and ICM evaluations improved?** Yes, in the evaluator itself, not by cache size: see the table in section 6. Values unchanged.

6. **How did memory usage and CPU performance change?** Training: 1.15x to 2.81x faster, slightly more memory. Exact evaluation: much faster where tables were rebuilt or runouts were passive, with far less memory. Complete studies: wall-time ratio 5.5/5.6 from 0.98 to 58.58 (the large sampled studies, whose time is almost all unchanged sampled evaluation, did not get faster). Thread scaling: not improved (5.6 is faster at each thread count measured and gains less from extra threads).

7. **Does checkpoint recovery still work reliably?** Yes on Linux and under Wine: every 5.5 recovery test passes, and 5.6 adds refusal of concurrent use, of another build and of another trainer. Not tested on NTFS hardware or under power loss.

8. **How many regression tests passed, failed or were skipped?** 582 passed, 0 failed, 1 skipped, of 583, on the final Linux build. Against the Windows programs under Wine (41 of 41 test files completed): 514 passed, 68 failed, 1 skipped of 583 recorded; see section on Windows.

9. **Which tests were performed directly on the final packaged executables?** From the ZIP extracted into an empty folder, through `mwcli.exe`, `EightMax.exe` and `gpustress.exe` under Wine: every checksum of the manifest; build identity of the programs; a study of the known game against its closed form (call frequency 0.5008, EV gap 0.0047 BB); the compressed-checkpoint self-test (15 passed, 0 failed); the desktop host serving the interface, `/api/info` and the saved-study list; a study interrupted by its time limit and resumed to the uninterrupted result; 11 of 11 golden states of the 5.5 trainer; the experimental estimators and the refusal of another trainer's state; exact evaluation with 32 and 1,024 MiB caches and against the 5.5 code paths; the replication fields and warnings; the checkpoint lock with a killed holder. The regression suite and the 5.6 test file ran against the same executables before packaging (same hashes).

10. **Which Windows and GPU checks remain outstanding?** All of them on real hardware: execution on Windows 11, the validation script, the CI workflow, CUDA correctness and speed on the RTX 4060 Ti, NTFS behaviour of the lock and of recovery, power loss, and real throughput on the Core i7.

11. **What remains before EightMax can support stronger whole-game GTO accuracy claims?** (a) A whole-game or calibrated lower-bound exploitability measurement for the realistic fixtures; today only small games have exact NashConv. (b) A measurement of abstraction error. (c) An estimator, or simply enough training, shown to reach a stated NashConv on those fixtures. (d) Replication large enough to bound training failures, or exact evaluation of every training. (e) Physical validation of the Windows and GPU paths. No percentage of GTO completion is given: no defensible metric for it exists here.

