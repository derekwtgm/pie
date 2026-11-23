# EightMax 5.7

Build `e4668abe7903f8b0`. Windows x64, self-contained (nothing to install). Target: Windows 11, 13th-generation Core i7, 16 GB RAM, RTX 4060 Ti 8 GB.

**Start here:** extract the ZIP into a new folder, open `EightMax.exe`. To check the release on your PC, run `Run 5.7 Windows validation.bat` (WINDOWS-TESTS-5.7.md).

## What changed

- **One training uses several cores.** With several deals per update (`batchDeals` above 1 and per-deal action streams), preparing, traversing and merging the deals now run on all threads, and the program chooses the number of threads by measurement. On the four-processor development machine this was 1.34x to 1.74x (median 1.56x) faster than 5.6 with four threads. The saved state is the one 5.6 writes, for every thread count.
- **Sampled evaluation is 1.25x to 3.27x (median 1.81x) faster** with identical results: action values and the quality measure of large studies. Complete studies: 0.96x to 1.94x (median 1.37x).
- **The dashboard shows throughput for very short training segments** (the host reported elapsed time in milliseconds).
- **`mwcli.exe --selftest57`**: the program checks its new parts against states and values written by 5.6.
- **Windows validation**: a new script and launcher that distinguish passed, failed, skipped and untested, and a CI workflow without steps that may fail silently.

## What works

Everything 5.6 did, unchanged: eight-handed tables with 0.5 / 1 blinds and a 0.1 BB ante per player (2.3 BB initial pot, no big-blind ante substituted), configurable stacks, weighted ranges, several bet sizes per street, multiway and multi-street games, chip EV and ICM, final-table calculations, checkpoint import and export, CPU-only, Automatic, Hybrid and GPU-Preferred processing, decision studies with replication statistics and recovery. The interface and the command line are unchanged; every 5.6 command works.

Verified on Linux, and for the Windows programs under Wine: regression suite 592 tests: 591 passed, 0 failed, 1 skipped; states byte-identical to 5.6; evaluations bit-identical to 5.6 (VALIDATION-5.7.md).

## Compatibility

- Solver checkpoints of 5.6 continue in 5.7 and give the same bytes, with any number of threads.
- Saved **studies** of 5.6 cannot be continued (a study checkpoint is tied to its build); they are refused with the reason. Start them again.
- Result files of 5.4 to 5.6 open as before.
- No new runtime requirement. The executables import only Windows system DLLs.

## New switches (all optional)

| Environment variable | Effect |
|---|---|
| `EIGHTMAX_THREAD_CHOICE=fixed` | every frozen-batch update uses all the threads offered (validation and benchmarks) |
| `EIGHTMAX_LEGACY_BATCH=1` | the 5.6 frozen-batch update (same results; for comparison) |
| `EM_EV_NO_PATHS=1` | the 5.6 evaluator path (same results; for comparison) |

Training output (`mwcli` and the host's engine information) has two new objects, `batchStages` and `threadChoice`. `threads` now reports the largest number of threads a call used.

## Limits

- **Not tested on Windows hardware or on an NVIDIA GPU.** The Windows programs ran under Wine. The validation script and the CI workflow have never been executed.
- The default trainer is unchanged; so is the quality of what it computes per sampled deal. Training on several threads samples more deals per second but was not better than the default trainer at equal time in every small game (CONVERGENCE-5.7.md), so it is an option, not the default.
- Thread scaling is partial and was measured only up to four threads.
- With a table budget of one or two megabytes the update at which training stops depends on the thread count (as in 5.6).
- A study whose budget exceeds 10,000,000 deals per seed (one deal per update) fails with "Iteration count must fit the 10 million iteration limit" when a seed reaches the limit, instead of being refused when it starts. (As in 5.6; found during 5.7 validation.) Workaround: keep study budgets at or below 10,000,000 deals per seed (the shipped fixtures stop at 4,000,000); with frozen batches the limit is 10 million updates, that is 640 million deals at 64 deals per update.
- Exact equilibrium distance (NashConv) is available only for small games. For realistic tournament spots the program reports lower bounds from limited deviations; it does not report, and cannot support, a percentage of GTO accuracy.

Reports: FINAL-REPORT-5.7.md, PERFORMANCE-5.7.md, CONVERGENCE-5.7.md, VALIDATION-5.7.md, WINDOWS-TESTS-5.7.md, BUILD-5.7.md.
