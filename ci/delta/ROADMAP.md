# The ten-phase plan (set by the user after 5.10; one phase per release)

| Phase | Subject | Status |
|---|---|---|
| 1 | 64-bit training generator: a counter-based generator, no 10,000,000-update limit, streams proven not to overlap, convergence no worse than 5.10 | **done in 5.11** (awaiting validation on the target PC) |
| 2 | 6-max tournaments: a 6-max preflop range library, a table-size switch in the interface, 6-max study fixtures | next |
| 3 | Satellites: equal prizes for the top N, bubble fixtures against exact answers on small cases, an approximation for large fields with players at other tables | |
| 4 | Faster multiway convergence: decide by a prespecified rule whether `rbes` becomes the default where seats hold ranges (the user's equal-time results from the target PC come first); regret-based pruning; multithreading inside one update | |
| 5 | ICM and bounty formats: future-game simulation beyond push/fold and beyond two hands; bounty and progressive-knockout payouts | |
| 6 | Card-grouping error: the same spots with Compact, Detailed and Exact cards, in exact NashConv and in strategy; a better grouping if the error is large | |
| 7 | Exact exploitability on the GPU: a full best response over whole ranges for heads-up postflop games, bit for bit against the CPU | |
| 8 | Off-tree bet sizes: mapping onto the solved sizes; how much results move when a size is added | |
| 9 | Preflop with real postflop solves in place of the equity-realization estimate; cold 3-bets and four-way pots | |
| 10 | Cash games: rake, a no-ante default, straddles, stacks deeper than 100 bb (depends on Phase 9) | |

Rules of the plan: the baseline is verified before anything changes; the default trainer keeps writing the states of
the previous release unless a phase says otherwise; every change to training or checkpoints gets its own algorithm
identifier and header; decision rules are written before measuring, with paired seeds and equal-time results first;
no percentage of GTO is ever stated; proven, tested and untested-on-the-target-PC are kept apart.

## Carried forward from Phase 1

* **The interactive multiway panel and the JavaScript engine** still train with the 32-bit streams and the
  10,000,000-update bound. Moving them needs the generator in JavaScript (64-bit multiplication by BigInt or by
  16-bit limbs) and a decision about states that are handed between the two engines.
* **The generator's cost** (2 to 3% of a deal on the fixtures, more on small games). Seven rounds, or 32-bit action
  samples, would each be a new stream algorithm; a subject for Phase 4.
* **The archive is at the 100 MiB limit** of the repository that distributes it. Evidence of old releases
  (validation/5.2 to 5.8: 55 MB compressed) will have to move out of the ZIP in one of the next phases.
* **DCFR** keeps 32-bit per-row discount counters and therefore the 10,000,000-update bound.
* Still open from earlier lists: an upper bound of NashConv for games too large to enumerate; code signing.

# Version 5.8 status

Current release: RELEASE-5.8.md. What to run on your own PC: WINDOWS-TESTS-5.8.md.
Reports: FINAL-REPORT-5.8.md, CONVERGENCE-5.8.md, PERFORMANCE-5.8.md, MATHEMATICAL-VALIDATION-5.8.md, VALIDATION-5.8.md,
BUILD-5.8.md.

5.8 added a proven lower bound of NashConv that works on multi-street and large studies (the trained response), five
reference games, the early refusal of over-limit studies, a better ICM cache and a repair of the desktop host's
checkpoint lock. The trainer is the 5.7.1 trainer. There is still no upper bound of NashConv for large games, and
nothing of 5.8 has run on Windows hardware or a GPU.

What 5.8 did with the 5.8 priorities of the previous list: 1 (physical validation) could not be done in development
and is still first; 4 (quality measurement for realistic fixtures) is the trained response; 7 (refuse a study budget
the engine cannot reach) is done; 2, 3, 5, 6 and 8 were not addressed.

# Priorities for 5.9

1. **Physical validation, still first.** `Run 5.8 focused validation.bat`, then `Run 5.8 Windows validation.bat`, on
   the Windows 11 / Core i7 / RTX 4060 Ti PC; the GitHub Actions workflow on a Windows runner. Sections 10 and 11 of
   `validate_windows58.ps1` have never executed: expect to repair them first. A full run also closes the gap left by
   5.7.1, whose full validation was never reported.
2. **An upper bound of NashConv for games too large to enumerate.** Without one, no statement that a full-range
   multiway strategy is close to equilibrium can be supported. Candidates: exact best responses inside sampled
   public subtrees with a proven bound on the rest; a response with a certified sub-optimality.
3. **The trained response as a first-class result.** A `summary` field with the sum of the distribution-free seat
   bounds (now added by hand from the per-seat fields); a stopping rule for the response training based on its own
   measured improvement; several response seeds; the measure in the desktop interface and in study documents. An
   estimator whose interval is honest when strategies contain rare actions (stratify or enumerate the rare branches)
   so that the narrow interval can be used on large studies.
4. **Reference games between the exact ones and the fixtures** (tens of hands a seat), to see how the share a
   response finds changes with the size of the game.
5. **A generator with a longer period**, as a new state format with its own validation, so that the update limit can
   be raised and frozen batches no longer reuse deals beyond a few hundred million. Until then the limit stays.
6. **Multiway training speed.** The profile is flat and bound by dependent memory reads (PERFORMANCE-5.8.md, section
   2). A table layout with fewer reads per lookup changes the memory accounting and needs its own validation plan.
   Thread scaling on 16 cores with performance and efficiency cores has never been measured.
7. **ICM cache**: precompute the set count (removes the 0.2% to 1.0% extra instructions on small ICM games).
8. The 5.7 list that 5.8 did not touch: a per-deal deal stream; a training mode that wins at equal time; coverage
   bookkeeping and showdown scoring in evaluation; thread-independent stopping under tiny table budgets; the
   remaining entries of `source/tests/load_sensitive.json` that concern solver jobs.

# Version 5.7 status

Current release: RELEASE-5.7.md. What to run on your own PC: WINDOWS-TESTS-5.7.md.
Reports: FINAL-REPORT-5.7.md, PERFORMANCE-5.7.md, CONVERGENCE-5.7.md, VALIDATION-5.7.md, BUILD-5.7.md.

One training now uses several cores for the whole frozen-batch update, with the 5.6 result bit for bit; sampled evaluation
is much faster with the 5.6 result bit for bit. The default trainer is the 5.6 trainer. Exact NashConv still exists only
for small games, and nothing has run on Windows hardware or a GPU.

# Priorities for 5.8

1. **Physical validation, first.** Run `Run 5.7 Windows validation.bat` on the Windows 11 / Core i7 / RTX 4060 Ti PC and
   the GitHub Actions workflow on a Windows runner. `validate_windows57.ps1` has never executed: expect to repair it
   first. `mwcli.exe --selftest57` needs no PowerShell and is the result to look at if the script fails. Record thread
   scaling on a CPU with performance and efficiency cores (nothing was tuned for it) and the first GPU timings.
2. **What still runs on one thread in a frozen-batch update.** Sampling the deals (one random stream), creating new
   betting states and table rows (identifiers in deal order), and the cache traffic of rows written by one thread and
   read by all. A per-deal deal stream (as the action streams already are) would remove the first; it changes the
   sampled deals, so it is a new trainer option to be validated, not an optimisation.
3. **A training mode that wins at equal time.** Frozen batches on several threads sample more deals per second than the
   default trainer but use each deal less well (64 deals share one strategy update); CONVERGENCE-5.7.md has the
   comparison. Candidates: smaller batches with the 5.7 pipeline, batches that grow during training, or asynchronous
   updates with a bound on staleness (not deterministic: would need a different validation standard).
4. **Quality measurement for the realistic fixtures.** Widen the restricted best response street by street and check
   each step against exact values on the small games; exact best responses inside sampled public subtrees; a report of
   how the studied decision moves between bet-size sets and hand groupings. No upper bound is in sight for multiway
   games, so no completeness percentage will be stated.
5. **Evaluation.** Coverage bookkeeping (about a tenth of sampled evaluation) and showdown scoring are the next costs;
   the exact evaluator's passive-runout search could use the path tree.
6. **Thread-independent stopping under tiny table budgets.** The workers' transient memory comes out of the table
   budget, so with a budget of a megabyte or two the update at which training stops depends on the thread count (5.6
   and 5.7 alike). Budget the transient memory separately.
7. **Refuse a study budget the engine cannot reach.** A training has a limit of 10 million updates. A study whose budget
   exceeds 10,000,000 deals per seed (one deal per update) is accepted and fails with an error when a seed reaches the
   limit, minutes or hours later (5.6 and 5.7; found by the 5.7 stability run, `validation/5.7/stability/README.md`).
   Refuse it when the study starts, or raise the limit.
8. The 5.6 list that 5.7 did not touch: an estimator that beats the default at equal time on every game; a sequential
   replication design; a calibrated statement for sampled quality; power-loss durability on NTFS.

# Version 5.6 status

Current release: RELEASE-5.6.md. User instructions: USER-GUIDE-5.6.md. What to run on your own PC: WINDOWS-TESTS-5.6.md.
Reports: FINAL-REPORT-5.6.md, CONVERGENCE-5.6.md, STATISTICAL-VALIDATION-5.6.md, PERFORMANCE-5.6.md, VALIDATION-5.6.md, BUILD-5.6.md.

The default trainer is the 5.5 estimator, 1.6 to 2.8 times as fast per sampled deal on small tables and 1.15 to 1.9 times on
the full-size study fixtures (Linux development machine), with byte-identical results. Exact multiway and ICM evaluation no longer depends on a large cache.
Two experimental shared-traversal estimators are opt-in; the fixed-plan comparison did not support making either the
default. Every study result states what its number of trainings supports.

# Priorities for 5.7

1. **Physical validation.** Run `Run 5.6 Windows validation.bat` on the Windows 11 / Core i7 / RTX 4060 Ti PC and the
   GitHub Actions workflow on a Windows runner. Neither has been executed. The PowerShell script itself has never run;
   expect to fix it first. Record real training throughput and GPU timings; no GPU number exists for 5.5 or 5.6.
2. **An estimator that wins at equal time everywhere.** 5.6's candidate beat the faster default on a four-player turn
   game, lost on a three-player river game and was unresolved on two heads-up games. What the data suggest:
   - the shared river walk updates the seats simultaneously; an alternating form (seat by seat inside one walk, re-reading
     the table) would recover the per-deal advantage of 5.5's enumeration at the shared walk's cost;
   - the cross-seat updates carry importance weights up to 1/0.05 per sampled decision; a baseline (control variate)
     on those terms, or weighting the n estimates by their measured variances instead of 1/n, keeps them unbiased and
     should remove the heads-up turn regression;
   - on three or more seats the full river tree is large; enumerate only where the subtree is small (a rule on the
     betting state, hence reproducible) and sample elsewhere.
   Use the 5.6 protocol unchanged (`research56.py`, `independent_cfr56.py`) with fresh seeds.
3. **Whole-game evaluation of the realistic fixtures.** Exact NashConv exists only for small games. The study fixtures
   are judged by one-decision responses. A calibrated lower bound on exploitability for grouped-hand studies (a best
   response inside the abstraction with bounded sampling error, or exact on a reduced board set) is the missing
   measurement behind any stronger accuracy claim.
4. **Sampled evaluation speed.** After 5.6 it is most of the wall time of the large studies.
5. **Exact evaluator.** At a terminal the utility of a rank pattern is the same for every opponent-hand tuple; computing
   it once per terminal (instead of once per tuple) would cut eight-handed ICM best responses further. Own hands of a
   best response can run in parallel.
6. **Parallel training.** Merging increments is single-threaded so that results do not depend on the thread count;
   a deterministic parallel merge (per-state ownership) is needed before more threads help one training.
7. **Statistics.** A sequential design (add trainings until the sign test resolves or a cap is reached) with a valid
   stopping rule; today the number of trainings is fixed in advance. A calibrated statement for sampled quality.
8. **Abstraction error.** Bet sizes, ranges and hand grouping are not measured against a finer model.
9. **Durability.** Checkpoint recovery after real power loss on NTFS has never been tested.

# Version 5.4 status

Current release: RELEASE-5.4.md. User instructions: USER-GUIDE-5.4.md. Measured accuracy, convergence, performance and limitations are in the 5.4 reports. Default trainer and checkpoint formats are unchanged.

# Remaining validation after 4.5

- Run `Run self-tests.bat` and `Validate CUDA hardware.bat` on the RTX 4060 Ti PC and keep the three JSON reports. 4.5 has run on a GitHub-hosted Windows virtual machine (real Windows and PowerShell 5.1, no GPU) and under Wine, never on the target PC and never on a physical NVIDIA GPU. `v45` in `hardware-validation.json` gives small / medium / large evaluations per processing mode in cold processes with VRAM and coverage peaks; `v44` gives the warm Automatic comparison.
- Automatic CPU/GPU scheduling is unchanged in 4.5: no change is justified without the measurements above. If cold Automatic is more than 15% behind the best fixed mode on the RTX 4060 Ti (finding in `v45.findings`), consider persisting the measured arm times per GPU, driver and thread count between runs.
- Training convergence: Latin-hypercube chance sampling and other opponent-exploration values did not improve exact NashConv (ten seeds, six games). Untested ideas that need more trainer code: stratification that survives card-conflict rejection in eight-handed deals (the 4.5 sampler falls back to independent draws for about 91% of eight-seat random-range deals), per-street weighting schedules, and a predictive regret update. Use the exact-NashConv protocol of `tools/convergence44.js` before enabling anything.
- Training does not scale with threads on the eight-seat linked study at 4 deals per update (1 and 4 threads take the same time in `bench45`): larger batches or a finer split of one deal's traversals would be needed.
- The ICM kernel is division-bound (1,024 divisions for eight players). 4.5 pairs them with SSE2 (1.4-1.5x); AVX2 would not help on the measured CPUs. A larger exact cache did not reduce time.
- Response-gain answers do not yet print a coverage ledger (the per-seat tables are pool-bounded and unit-tested; the action-EV answer prints `coverage.memory`).
- JavaScript full-traversal checkpoint restoration keeps its 2 GiB decoded ceiling in the browser (unchanged); the native engine streams large states.
- Exact best responses with several hands per seat in eight-player games and six-player flop exact EVs still take minutes.

# Remaining validation after 4.3

- Run Run self-tests.bat and Validate CUDA hardware.bat on the RTX 4060 Ti PC. v43 in hardware-validation.json reports cold vs warm GPU times per mode and thread count, opens/verifications per process (must be 1), idle release, cancellation and refusal recovery. Shared tables, lifecycle and scheduling were verified only with the Linux driver test double.
- If the warm GPU beats 24 CPU threads only for larger tables, tune EM_GPU_BATCH_CHUNKS and the 1.25x cost-model margin from the measured batchFixedSeconds / gpuNsPerEval; consider a fused on-device pattern kernel (needs the CUDA toolkit to rebuild the embedded module).
- DCFR(1,1,2) was much better on eight-player push/fold and worse on postflop river/turn games: study an automatic per-game choice (street-dependent weighting) with the convergence43 protocol before changing any default.
- Exact coverage beyond the in-memory limit (sorted external runs) if studies exceed 2-30 million information sets.
- Exact best responses with several hands per seat in eight-player games and six-player flop exact EVs still take minutes; consider caching subset utilities across terminals.

# Remaining validation after 4.2

- Run Run self-tests.bat and Validate CUDA hardware.bat on the RTX 4060 Ti PC. The 4.2 CUDA context fix is verified with a driver test double that enforces per-thread contexts; v42.evTables in hardware-validation.json confirms or refutes it physically (GPU-preferred rows must score far more than 65,536 boards on the GPU with no cudaErrors).
- With pattern counting fixed, board scoring is about half of an exact EV's remaining time; if the RTX measurements show a GPU gain, consider fusing pattern histograms into the board kernel (needs the CUDA toolkit to rebuild the embedded module).
- Exact NashConv for eight-player studies with real ranges remains expensive (about 2,000 showdown tables per evaluation with two hands per seat); a shared per-request table cache across seats would cut it further.

# Remaining validation after 4.1 (historical)

- Run Run self-tests.bat and Validate CUDA hardware.bat on the Windows PC with the RTX 4060 Ti 8 GB. No physical Windows desktop and no NVIDIA GPU were available for 4.1; hardware-validation.json reports physicalNvidiaExecution, complete-workload CPU/GPU/hybrid times, peak VRAM and the scheduler's decisions.
- If the RTX measurements show GPU tables are slower end to end, keep auto on the CPU (it decides from its own measurement); if they are faster, consider moving pattern counting (the larger share of push/fold evaluations) to the GPU.
- Sampled one-decision response gains scale only to ~2 threads on push/fold studies because a few seats dominate; split a seat's samples into blocks for finer parallelism.
- The 8-action simultaneous comparison measured 5.9% family-wise error (95% CI 5.0-7.1%) at n = 1,000; a bootstrap of the covariance estimate could bring it closer to 5%.
- Training convergence: no DCFR setting beat linear averaging; remaining candidates need code (variance-reduced external sampling, stratified chance sampling) and the same exact-NashConv protocol.
- Extend the browser reader beyond its 2 GiB decoded ceiling for JavaScript full-traversal studies (unchanged).

# Remaining validation after 3.9

- Run Run self-tests.bat and Validate CUDA hardware.bat on the Windows PC with the RTX 4060 Ti 8 GB; 3.9 was exercised only under Wine.
- Extend sampled multiway response gains beyond one node per seat (e.g. trained responses over a seat's whole subtree) and run 8-player studies past 50,000 deals with more seeds.
- Run equal-time convergence comparisons of candidate variance-reduction schemes using the 3.9 exact best-response tool before enabling any of them.
- Add a strategy-quality dashboard and hardware diagnostics panel to the interface (data already available from the host API).
- Move long EV/response-gain requests off the engine lock so other explorer queries stay responsive.
- Extend the browser reader beyond its 2 GiB decoded ceiling for JavaScript full-traversal studies.

# Remaining validation after 3.8

- Run Run self-tests.bat and Validate CUDA hardware.bat on the Windows PC with the RTX 4060 Ti 8 GB. 3.8 executables were cross-compiled and exercised only under Wine on Linux.
- Find the remaining cost in the eight-player linked preflop-to-river study (2-9% slower than 3.7 at 4 threads on long runs) with hardware cache and contention counters on the 13th-generation Core i7.
- Repeat the equal-time accuracy comparison with more seeds; 3 seeds did not establish a significant gain despite 13-28% more deals per second.
- Add an independent reference for grouped-hand (Compact/Detailed) explorer lookups.
- Extend the browser reader beyond its 2 GiB decoded ceiling for JavaScript full-traversal studies.

# Remaining validation after 3.6

- Run the two hardware validation batches on Windows with the RTX 4060 Ti 8 GB, including end-to-end timing and NTFS recovery under actual power loss.
- Extend independent response measurements to more seats, seeds and longer multiway ICM training horizons. Verify gains inclusive of algorithm calibration overhead.
- Extend the browser reader beyond its current 2 GiB decoded ceiling and reduce the live interactive strategy footprint.
- Profile cache misses, thread contention and transfer costs on the 13th-generation Core i7. Measure complete application and driver memory over long sessions.
