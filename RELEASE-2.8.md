# EightMax Windows 2.8

Extract the ZIP and open EightMax.exe on a Windows x64 computer. The offline HTML entry point is EightMax-Offline.html. Run self-tests.bat exercises the native application on your machine. The executable is unsigned.

## Sampled river results

The comparison used the shipped 2.7 source and the 2.8 source, the same 12 BB pot, 30/30/30 BB stacks, weighted-compatible private deals from eight listed hands per seat, 50% and 125% river bets and a 2.5x raise. The ranges in this benchmark use equal individual hand weights. Each number measures the largest seat gain available to an exact best response against the learned average strategy in this restricted game. Lower is better. The three training seeds were 1, 2 and 3. The ± values are 95% Student-t interval half-widths across those seeds.

| Training budget | 2.7 frozen four | 2.8 frozen four | 2.8 stratified four | 2.8 sequential |
|---|---:|---:|---:|---:|
| 4,000 deals | 0.3862 ± 0.1015 | 0.3862 ± 0.1015 | 0.3872 ± 0.0435 | 0.4485 ± 0.0992 |
| 20,000 deals | 0.2003 ± 0.1048 | 0.2003 ± 0.1048 | 0.1679 ± 0.0825 | 0.1614 ± 0.0893 |
| 50,000 deals | 0.1093 ± 0.0382 | 0.1093 ± 0.0382 | 0.1071 ± 0.0124 | 0.1005 ± 0.0206 |
| 100,000 deals | 0.0856 ± 0.0221 | 0.0856 ± 0.0221 | 0.0883 ± 0.0178 | 0.0815 ± 0.0718 |
| 250,000 deals | 0.0439 ± 0.0120 | 0.0439 ± 0.0120 | 0.0414 ± 0.0110 | 0.0438 ± 0.0107 |
| 1 s | 0.2117 ± 0.1036 | 0.3404 ± 0.5032 | 0.1868 ± 0.0834 | 0.1427 ± 0.1330 |
| 3 s | 0.0839 ± 0.0338 | 0.1822 ± 0.3366 | 0.1016 ± 0.0492 | 0.0781 ± 0.0449 |

The independent four-deal mode reproduced the 2.7 response gains at every fixed deal budget. Stratification improved the measured mean at 20,000 and 250,000 deals, with mixed results at the other budgets and time limits. The opt-in checkbox enables it for full simultaneous river traversals with at most 1,024 possible joint tuples before blockers. Results identify the selected sampler. Setting Deals per update to 1 selects sequential training. The default Balanced preset retains four deals because these comparisons establish no uniform winner.

For stratification, enumerate the compatible complete river deals once with mass proportional to the product of seat weights. Partition their cumulative mass into equal intervals and draw independently inside each interval. The mean increment under one frozen profile has the correct conditional expectation. The experiment changes the correlation and variance of samples. Sequential updates change the profile after each deal. Standard external sampling still uses exploration probabilities and importance ratios on both sides of the traverser node. The average strategy uses own reach and compensates for sampled opponent actions. Clipped sampled CFR+ stays experimental. Outcome sampling and adaptive opponent proposals would require additional variance and bias tests.

Each benchmark JSON records individual response gains, CPU time, updates, accepted deals, seconds, peak process RSS and throughput. Timed tests use cumulative training-only budgets with a final granularity of eight updates. Initialization and exact evaluation are excluded. Measurements were taken on a shared Linux INTEL(R) XEON(R) PLATINUM 8573C; concurrent activity affected timings. Three seeds support limited precision. No unrestricted multiplayer Nash equilibrium has been established.

## Multiway performance

| Game | 2.7 updates/s | 2.8 updates/s | 2.8 peak RSS, MiB |
|---|---:|---:|---:|
| 6-player flop, 2 sizes + raise per street | 578 | 499 | 138 |
| 7-player flop, 2 sizes + raise per street | 430 | 433 | 143 |
| 8-player flop, 2 sizes + raise per street | 412 | 452 | 152 |
| 8-player river, 2 sizes + raise | 1264 | 1461 | 93 |
| 6-player linked preflop-river, random ranges, 25 bb | 833 | 876 | 153 |
| 8-player linked preflop-river, random ranges, 25 bb | 475 | 511 | 229 |
| 8-player linked ICM 50/30/20, random ranges, 25 bb | 259 | 427 | 241 |

The seven repeated-workload configurations returned identical EV vectors across versions. These throughput figures use the existing two-run harness and vary with machine load. The six-player flop throughput regressed on this run.

The long UI test runs several real 10,000-update studies, explores actions, repeats seeds, runs trained responses and solves the full-range 25 BB example. On this host the original package completed in about 169 seconds. Much of the cost comes from solving and evaluating real games. A specific avoidable cost was computing every child action EV when a progress checkpoint only needed root action frequencies. The optimized checkpoint samples 256 holdout deals and evaluates root strategies directly. Final EV and action reports use the configured holdout budget. All reported diagnostic root frequencies matched 2.7 exactly at the same 256 evaluation deals in the comparison below.

| Active seats | 2.7 root diagnostic, ms | 2.8 root diagnostic, ms |
|---:|---:|---:|
| 6 | 31.01 | 16.82 |
| 7 | 35.76 | 23.64 |
| 8 | 85.68 | 20.55 |

Frozen batches now commit only visited information-set rows. The solver reuses card-marking storage, caches immutable starting-board hand scores and keys, and caches up to 8,192 terminal utilities on small chip-EV river trees by terminal and showdown order, including ties. Neither the betting tree nor ownership of the pot changes. Independent sampling retains whole-tuple rejection after a blocker collision. All live seats keep their sampled private cards after folding. Players already absent at the configured root have no sampled private cards.

## Checkpoints and resources

In Multiway, enter a checkpoint interval from 1 to 3,600 seconds. Zero disables autosaving. Recover automatic checkpoint loads the newest valid generation. The desktop host writes a temporary file, flushes it, rotates the preceding checkpoint, and renames the replacement. On Windows it uses write-through replacement. The two files are autosave.emstudy and autosave.previous.emstudy in the EightMax save folder. Desktop automatic saves use the existing 64 MiB HTTP limit. A failed write is reported, and manual export is available for larger studies. In the offline HTML application, saves use a two-generation IndexedDB transaction in the same browser profile and origin.

Desktop recovery was tested by interrupting the worker and killing the native Linux host, then restarting both, validating the digest and resuming. The resumed training state matched uninterrupted training exactly. A corrupted newest generation recovered the prior generation. Browser-only IndexedDB restart verification is outstanding because this environment blocked Chromium’s startup socket. A runnable browser recovery test and the actual failure log are included.

Progress reports accepted training deals, completed updates, elapsed time, training deals per elapsed second and estimated strategy storage. Holdout evaluation deals are separate. Seat-alternating and own-hand enumeration now count each independent private deal actually drawn. Checkpoints saved before 2.8 can reconstruct completed historical work but cannot reconstruct partially attempted old batches.

On a 16 GB PC the desktop host defaults to a 6,144 MiB native process threshold and a 4,096 MiB native solver allocation estimate. EIGHTMAX_PROCESS_MIB accepts 64–32,768. EIGHTMAX_MEMORY_MIB accepts 32–8,192. Pre-allocation and periodic RSS checks provide conservative guards. The browser runs in a separate process and its total memory is outside this limit. Wide-range strategy storage has a separate selectable limit and includes batch scratch bookkeeping. These thresholds cannot guarantee recovery from every OS allocation failure.

Windows detects process-affinity logical CPUs and queries physical core efficiency classes. EIGHTMAX_THREADS is clamped to available logical CPUs. Windows schedules the heterogeneous cores. The AVX2/FMA and baseline x64 code paths remain available. Native parallelism applies to heads-up solves. Multiway CFR runs in one JavaScript worker.

## Charts and tournament rules

Regenerated all nine original model charts at 15, 20, 25, 30, 40, 50, 60, 80 and 100 BB. All packed strategy values matched. The generator, comparison script, iteration counts and hashes are bundled. This validates the chart-generation procedure. Independent recalibration of the underlying flop continuation-value fit is still outstanding. The chart model uses 169 hand classes, pairwise card removal, stack-dependent preflop sizes, jam thresholds, and a maximum of three voluntary entrants. Position, stack-to-pot ratio, aggression and nine hand features affect estimated continuation value. See BONUS_DEFAULT, BONUS_FIT, RZ, MAXIN and RAISECAP in source/web/lib_deep.js. The linked solver can explicitly play all streets with up to eight live seats.

Default antes remain 0.1 BB per dealt player. Eight individual antes and both blinds produce 2.3 BB. The regression suite covers short antes, optional BBA, uneven all-ins, side pots, ICM and blocker effects. The new weighted MTT exercise covers two through eight seats, unequal stacks, multiple sizes, jams, three textures and chip/ICM utilities.

## GPU, build and remaining limitations

The existing optional OpenCL river backend and CPU fallback are included. Its emulator passed the turn reference comparison. No CUDA backend was integrated. Neither an NVIDIA device nor nvcc was present. No RTX 3060 Ti throughput, transfer overhead, power use or GPU correctness measurement was obtained. Public-deal hand evaluation is parallelizable; cross-deal regret synchronization and JS/native transfer costs still require hardware measurements before selecting a GPU implementation.

The Windows x64 binary was cross-compiled from the same source as the tested Linux host. Windows 10/11 execution, signing, and physical testing on the specified i7/RTX/16 GB desktop remain outstanding. Linux native tests, packaged worker integration and raw reports are under validation/2.8. The Windows workflow builds and runs real Windows tests when invoked. Prior version reports are historical.

## Reproduce

Run node --test source/tests/*.test.js, then node source/tools/build.js and sh source/native/build.sh windows with MinGW-w64. To compare a separate 2.7 source directory with this release, run source/tools/bench28.js with Node and arguments SOURCE OUTPUT.json MODE. Choose legacy, stratified or sequential. The default 2.7 comparison uses legacy. Run source/tools/gen_deep.js solve 15,20,25,30,40,50,60,80,100 and source/tools/verify_charts28.js source/build/charts result.json to repeat chart generation.

## Final package verification

Build 8e13def82b9d8e18 passed all 140 JavaScript regression tests. The packaged UI and worker integration test completed in 98.299 seconds on the Linux host. A second cross-compilation produced a byte-identical Windows executable. SHA256SUMS.txt covers the files in this distribution except the manifest itself.
