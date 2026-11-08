# EightMax Windows 3.3

Extract the complete ZIP and start EightMax.exe. CPU Only is the default. To collect results from your PC (Core i7 13th gen, RTX 4060 Ti 8 GB, 16 GB), run **Run self-tests.bat**, then **Validate CUDA hardware.bat**. The second script writes hardware-validation.json next to the executables. EightMax-Offline.html is the browser-only entry point.

What was and was not tested: Linux builds ran every test here. The Windows x64 executables were cross-compiled with MinGW-w64. GitHub's hosted Windows Server runner compiled the same source natively and ran the regression, host and release scripts (see "Windows validation"). No physical NVIDIA GPU and no interactive Windows desktop were available, and none of the GPU results below came from real hardware.

## 1. Fixed: negative antes and other invalid tournament input

**Defect (reproduced).** The native spec field `anteOf` (per-seat antes subtracted at terminals) was never validated. With `anteOf[2] = -0.1`, the 3.2 `mwcli` trained the six-seat fixture and exited 0. Its sibling `rules.ownAnte` was already checked. Separately, `mwcli` read `abc` iterations as 0 and accepted negative thread counts. The heads-up parser silently dropped negative range weights and truncated fractional card ids.

**Repair.** All entry paths now refuse invalid input before any solver state is built: native spec (`mw.cpp`), CLI (`mwcli.cpp`), host routes that call them (`server.c`), heads-up parser (`cfg.c`), JavaScript (`lib_river.js` setup, `lib_wide.js`, `lib_postflop.js`), checkpoint import (`.emstudy` restore rebuilds and revalidates the game; EMMW1/EMMW4 counters must be whole numbers).

| Checked | Rule |
|---|---|
| Antes | finite, 0–10 BB, one per seat; protocol 4: equal to the rules' own antes preflop, zero postflop |
| Blinds | a posted blind cannot exceed the seat's stack; no blinds at a postflop root |
| Stacks, prior and folded wagers, common pot | finite, nonnegative, correct lengths; folded ≤ largest live contribution |
| Chip conservation | `pot0` = common + Σ prior + Σ folded (+ Σ own antes preflop), within 1e-9 relative |
| Counters, seats, batch sizes, protocol | whole numbers in range |
| Terminal pots (full traversal) | finite, nonnegative, unique eligible seats |
| Hands | finite positive weights, no duplicates, combo id must match the cards, weight sum finite |
| Heads-up | whole card ids 0–51, finite pot > 0 and stack ≥ 0, 1,326 finite nonnegative weights, maxBets 0–8 |
| CLI | iterations 0–10,000,000, threads 1–256, memory (0, 65,536] MiB |

Valid zero antes, nonuniform per-seat antes (when the rules, ante list and starting pot agree), optional big-blind antes and short stacks are accepted. **Default eight-handed structure, verified by test:** 0.5/1 BB blinds, 0.1 BB ante per dealt player, 0.8 BB total, 2.3 BB initial pot. Stacks are 24.9 BB behind after the ante. A 0.05 BB stack posts 0.05 BB and is all-in. A 0.3 BB small blind posts a 0.1 BB ante and a 0.2 BB blind.

Tests (tests/v33.test.js, part 1): every rejection case on both the native and JavaScript paths; native/JS agreement over eight ante values; 10 malformed files and 10 bad argument sets (no crash, exit codes 1 and 2); forged checkpoint headers and tampered `.emstudy` configurations; chip conservation over more than 100 random terminals in five structures. An earlier fix to the JS frozen-batch commit is also covered. In 3.2 it could apply part of a batch before a non-finite value threw, and the partial batch survived the rollback.

## 2. Mathematical audit

| Component | Finding |
|---|---|
| External-sampling estimator | Opponents sample from q = 0.9σ + 0.1/k and return σ/q × child value. Regret increments are scaled by π₋ᵢ/q₋ᵢ above the node. The estimate is unbiased; no defect found. |
| Average strategy | Stochastically weighted (own reach × σ / q₋ᵢ). It is unbiased up to a per-information-set constant, which normalization removes. Correct. |
| CFR+ (sampled) | max(0, R) before and after the increment, identical in JS and native. Correct as specified, but it measures worst of all methods under sampling (below). |
| Frozen batches | Increments are averaged over the batch and committed atomically. 3.2 JavaScript could keep a partial batch (fixed). |
| Terminal and side-pot utilities | Layered pots, ties and returned uncalled chips. ICM is applied after awarding every layer. Rechecked by chip-conservation and existing ICM tests. |
| Native full-traversal DCFR (3.2, experimental) | Eager discount of every visited row. Unchanged. |
| 3.1 → 3.2 heads-up turn regression (0.599 → 0.657 BB at 400 ms) | 3.2 and 3.3 linear external sampling are bit-identical at equal deals (0.000 paired difference at all deal counts). The 400 ms difference is consistent with throughput and seed noise, not an algorithmic change. |

## 3. Native external-sampling DCFR

`weighting: 'dcfr'` with `dcfrAlpha` (default 1.5), `dcfrBeta` (0) and `dcfrGamma` (2). After iteration u, positive regrets are multiplied by u^α/(u^α+1) and negative regrets by u^β/(u^β+1).

- **Sparse and late information sets.** Each row stores the iteration through which its regrets are discounted and catches up exactly when it is next updated: R ← R·∏ f_u. The products come from prefix tables kept as a mantissa plus a binary exponent, so β = 0 (½ per iteration) never underflows. A new row starts current. Regret matching ignores the common factor on positive regrets, so the policy read from a row that has not caught up is unchanged. This is not a fixed multiplier per batch.
- **Average strategy.** Iteration t's contribution is weighted by t^γ, which equals the (t/(t+1))^γ discount after normalization.
- **Transactions.** Discount iterations are journaled and rolled back with the regrets. They are stored in EMMW4 files (`rowSync`) and `.emstudy` snapshots. The schedule's memory (48 bytes per iteration) is charged to the table budget before the update journal.
- **Validation** (part 2 tests):
  - Bit-identical to the JavaScript reference in 6 configurations: river, CFR+, frozen batches, 6-seat flop with 2 threads, 8-seat linked preflop, and α 2 / β 0.5 / γ 3. With non-integer exponents (std::pow) the two agree to 1e-12.
  - Equal to an independent textbook eager implementation (every row discounted every iteration) within 1e-9, on rows that were sparsely visited.
  - DCFR(1, 1, 1) reproduces linear MCCFR within 1e-9, a closed-form identity.
  - Resume continues bit for bit across native → JS → native.
  - Memory stops roll back to the uninterrupted state and resume to the uninterrupted result.
  - Allocation fault injection on every allocation of an update rolls back exactly and resumes.
  - Mismatched weighting files are refused.
- **Measured accuracy (section 7).** Textbook DCFR(1.5, 0, 2) converges *worse* than linear MCCFR under external sampling. Linear remains the default. DCFR is an explicit option.

## 4. Native Compact and Detailed hand groups

3.2 trained grouped flops, grouped preflop and grouped turns above 32,768 entries in JavaScript. 3.3 ports the abstraction to C++ (`source/native/es_groups.hpp`):

- **Key mapping**, as in lib_wide.js `seatKey()`:
  - `256 + combo id` on the starting street for ranges of 12 hands or fewer;
  - the 169-class index preflop;
  - `strengthGroup()` for Compact: category, top rank, flush draw, straight draw;
  - `handFeatures().key` for Detailed: class, score, straight outs, backdoors, blockers, board texture and suit-aware flush features;
  - chained as `prev·2048 + signal` (Compact) or `prev/signal` (Detailed).
- Keys are interned per study. The dictionary is charged to the table budget and truncated on rollback. Deals, card removal, weighted ranges, runouts, showdowns, side pots, chip EV and ICM always use the physical cards. Only the strategy lookup is grouped, so grouped strategies are abstractions and are not exact-card solutions.
- **Parity.** Bit-identical tables to JavaScript in 7 configurations: Compact and Detailed 3-seat flops, Detailed 6-seat flop with parallel per-deal batches, Compact 8-seat linked preflop to river, Detailed 8-seat shove/call with ICM, a Compact turn above the 3.2 limit, and Detailed with DCFR. Evaluated EV, metrics and the explorer root view also match, and resume and memory stops are exact.
- **Benchmark** (validation/3.3/grouped-native.json; 3 seeds, Linux):

| Configuration | JS deals/s | Native deals/s | Speedup | JS peak RSS | Native peak RSS |
|---|---:|---:|---:|---:|---:|
| Compact 3-seat flop | 6,383 | 62,338 | 9.7× | 94 MiB | 7.3 MiB |
| Detailed 3-seat flop | 5,897 | 47,853 | 8.0× | 116 MiB | 13.1 MiB |
| Detailed 6-seat flop, 4 deals/update | 1,852 | 15,051 | 8.0× | 148 MiB | 16.5 MiB |
| Same, 4 threads | 1,837 | 16,201 | 8.8× | 148 MiB | 16.6 MiB |
| Compact 8-seat linked preflop, 2 deals/update | 779 | 7,674 | 9.9× | 162 MiB | 14.3 MiB |

Native and JavaScript tables are identical after every update, so the time to reach any response-gain target is the JS time divided by this speedup.

**Limitation:** grouped *full* traversal still trains in JavaScript, and the progress line says so. Detailed keys are long strings. An 8-seat Detailed preflop study used 9 MB of key dictionary within a 16 MiB table budget.

## 5. Automatic algorithm selection

Automatic traversal chooses full traversal when `states ≤ sampled visits × r²`. This is a time-to-accuracy cost model: r is the ratio of the external-sampling to full-traversal error constants at equal wall time. 3.2 used priors from a single 4,096-deal run (r = 2.82 for rivers, 1.63 otherwise).

3.3 measured r with exact best responses on four turn trees and three river games (5 seeds, 1 s and 4 s): rivers 2.4–3.5, turns 2.3–4.1 (validation/3.3/traversal-calibration.json). On a heads-up turn with 516 states and a three-way turn with 299 states, 3.2 chose external sampling. Full traversal reached significantly lower exact gain at equal time on both:

| Tree | 1 s | 4 s |
|---|---|---|
| Heads-up turn, 516 states | 0.45 ± 0.20 BB lower | 0.12 ± 0.10 BB lower |
| Three-way turn, 299 states | 0.30 ± 0.08 BB lower | 0.27 ± 0.04 BB lower |

3.3 uses r = 3.0 for turn and river starts with up to three seats, the conservative end of the measured range, and now chooses full traversal there. For flops, preflop and 4+ seats no exact reference is tractable, so the 3.2 prior is kept and documented as uncalibrated.

The decision, its inputs (states, sampled visits per deal, r) and its reason appear in `diagnostics().traversalSelection` and in the progress line. Manual Full / External choices and checkpoint-restored traversals are never changed, and DCFR selects external sampling. Memory and CPU enter through the existing full-tree state limit, which is derived from the strategy budget, and the thread-independent cost model.

## 6. CUDA, hybrid scheduling and memory

**CUDA audit (no defects found).**
- Driver probe and compute capability ≥ 7.5.
- SASS selection with PTX JIT fallback.
- Every allocation leaves max(1 GiB, 25%) of VRAM free (2 GiB on an 8 GB card) and stays under the user's buffer cap.
- Buffers are reusable and freed on allocation failure, cancellation and destruction.
- Hybrid calibration validates every GPU result against the CPU before use.
- Chunked equity launches stay under the Windows display watchdog.

The kernels and embedded PTX/SASS are unchanged from 3.2 and were not recompiled.

**External sampling and the GPU.** 3.3 times hand scoring separately inside external-sampling training. It takes 0.3–0.6% of training time on the 6-seat flop and 8-seat preflop fixtures. By Amdahl's law, moving it to the GPU could save at most that share before any PCIe transfer, so it stays on the CPU. When a GPU mode is requested the engine reports the measured bound (`gpuStageBound`) and the reason in `devicePath`. The irregular betting-tree traversal is not moved to the GPU. A worthwhile GPU workload would be a vectorised all-hands river or turn solver, which does not exist yet (ROADMAP).

**Memory.**
- Native tables, indices, DCFR schedules and hand-group dictionaries share the table budget. Scratch has its own budget, as in 3.2.
- `mwcli` reports process peak RSS.
- RAM and VRAM budgets are separate settings and are not interchangeable.
- Session stress (validation/3.3/session-stress.json): 12 host rounds on 6- and 8-seat flops and 8-seat linked preflop, covering exact, DCFR and Detailed groups. Each ran under a 16 MiB table cap while a second JS solver was held, then stopped, checkpointed, recovered and freed. Peak host RSS was 39.7 MiB and the JS process high-water mark 487 MiB. Four malformed specs were refused with HTTP 400 while the host kept serving.
- There is still no hard process-wide memory limit.

**Transactional recovery.** The 3.2 recovery suite was run against 3.3 (validation/3.3/recovery.json): six-seat flop and eight-seat linked preflop at 1, 2, 4, 8 and 16 MiB. All 10 scenarios stop at the same update as 3.2. Their stopped and resumed checkpoint files have **the same SHA-256 digests as 3.2's**, and resuming equals uninterrupted training. Allocation fault injection passes on the 3.2 fixture and on three DCFR fixtures.

## 7. Accuracy: 3.2 against 3.3

Finite games with exact best responses (validation/3.3/accuracy-3.2-vs-3.3.json): 5 seeds; 4k, 20k, 50k, 100k, 250k and 500k deals; equal time at 250 ms, 1 s and 4 s; single thread except where stated. Metric: largest exact unilateral gain in BB; lower is better. The heads-up figures in the JSON also include the exploitability sum.

| 500k deals, gain (BB) | HU turn | HU river | 3-way river |
|---|---:|---:|---:|
| 3.2 external sampling, linear | 0.298 ± 0.038 | 0.038 ± 0.005 | 0.061 ± 0.028 |
| 3.3 external sampling, linear | 0.298 ± 0.038 | 0.038 ± 0.005 | 0.061 ± 0.028 |
| 3.3 DCFR (1.5, 0, 2) | 0.438 ± 0.021 | 0.091 ± 0.011 | 0.106 ± 0.003 |
| 3.3 DCFR (2, 1, 1) | 0.319 ± 0.039 | 0.055 ± 0.008 | 0.052 ± 0.004 |
| 3.3 CFR+ linear | 0.650 ± 0.010 | 0.158 ± 0.012 | 0.204 ± 0.007 |
| 3.3 full traversal, linear | 0.198 ± 0.019 | 0.034 ± 0.006 | 0.038 ± 0.005 |

| 4 s equal time, gain (BB) | HU turn | HU river | 3-way river |
|---|---:|---:|---:|
| 3.2 external sampling, linear | 0.208 ± 0.016 | 0.027 ± 0.010 | 0.044 ± 0.019 |
| 3.3 external sampling, linear | 0.209 ± 0.033 | 0.024 ± 0.007 | 0.051 ± 0.016 |
| 3.3 DCFR (1.5, 0, 2) | 0.288 ± 0.008 | 0.049 ± 0.006 | 0.086 ± 0.006 |
| 3.3 full traversal (automatic choice) | 0.100 ± 0.009 | 0.010 ± 0.002 | 0.031 ± 0.005 |

- 3.3 linear is identical to 3.2 at equal deals. Paired equal-time differences are not significant: HU turn 1 s +0.020 ± 0.027, HU river 4 s +0.002 ± 0.013. Speed is unchanged.
- Textbook DCFR is significantly worse, for example −0.140 ± 0.024 BB at 500k on the HU turn and −0.024 ± 0.011 BB at 4 s on the HU river. DCFR (2, 1, 1) is not significantly different from linear in 24 of 27 paired comparisons. Of the other three, one favours DCFR (2, 1, 1): +0.079 ± 0.068 BB at 50k deals on the HU turn. Two favour linear: −0.060 ± 0.038 BB at 1 s on the HU turn and −0.017 ± 0.006 BB at 500k on the HU river. No DCFR setting showed a consistent improvement over linear.
- The measured improvement in accuracy per second for automatic studies is the traversal recalibration (section 5).
- Benchmarks ran on a 4-core Linux virtual machine, not the target PC.

**Large multiway scenarios** (validation/3.3/scenarios-3.2-vs-3.3.json): see section 8.

## 8. Ten-scenario comparison

SCENARIO_TABLE

## 9. Interface diagnostics

The progress line and `diagnostics()` show:
- the algorithm, including "external-sampling DCFR", weighting and DCFR parameters;
- native or JavaScript execution and why;
- the CPU/GPU path and the measured GPU bound;
- players, street, betting states, sampled deals, completed updates, elapsed time and deals per second;
- RAM (native tables + browser strategy), VRAM buffers, and checkpoint status;
- CUDA availability and fallback reason;
- the traversal decision and its reason;
- a statement that speed figures are throughput, not solution quality.

Multiway gains are labelled approximate unilateral estimates. The Wide-ranges settings add an **Iteration weighting** selector: Linear (default), Uniform, DCFR.

## 10. Tests

| Suite | Result |
|---|---|
| Regression (tools/run_tests.js) | REGRESSION_RESULT |
| v33.test.js under ASan+UBSan mwcli | 34 passed, 0 failed |
| ThreadSanitizer | 3.2 fixtures plus DCFR 6-seat, Detailed+DCFR 6-seat, Compact 8-seat preflop, 4 threads: no reports |
| ASan+UBSan | training, export, resume and memory-stop paths: no reports |
| cppcheck 2.13 (newly enabled; 3.2 skipped it) | no findings after initializing three members |
| Strict warnings (-Wall -Wextra -Wshadow -Werror) | none. 3.2's script did not stop on a warning failure; fixed |
| Recovery (10 scenarios) | identical to 3.2 bytes |
| Allocation fault injection | 4 fixtures, every allocation |

Hardware-dependent tests: the CUDA driver test double runs on Linux, and compiler-dependent tests run where g++ exists. No test is skipped on this host.

Two 3.2 assertions described limitations that 3.3 removes: "external-sampling DCFR is refused" and "grouped flops are JavaScript-only". They now assert the new behaviour and still cover the refusal paths (invalid DCFR parameters; grouped full traversal). No test was deleted.

## 11. Windows validation

WINDOWS_RESULT

## Reproduction

```sh
node source/tools/build.js build
sh source/native/build.sh linux build/native.html build/linux
sh source/native/build.sh windows build/native.html build/windows      # MinGW-w64 (posix threads)
node source/tools/run_tests.js regression.json
sh source/tools/sanitize33.sh source
python3 source/tools/recovery32.py build/linux/mwcli recovery.json
node validation/3.3/session-stress.js build/linux/eightmax session-stress.json
gcc -O2 -o peak_rss source/tools/peak_rss.c
# drivers built from 3.2's and 3.3's mw.cpp (see RELEASE-3.2.md for the timed driver build line)
node source/tools/bench33.js mwcli-3.2 timed-3.2 mwcli-3.3 timed-3.3 accuracy.json
node source/tools/grouped33.js build/linux/mwcli ./peak_rss grouped.json
node source/tools/scenarios33.js mwcli-3.2 timed-3.2 mwcli-3.3 timed-3.3 ./peak_rss scenarios.json
sh source/tools/release.sh
```

On Windows: `Run self-tests.bat`, `Compare processing modes.bat`, `Validate CUDA hardware.bat`. Verify extracted files with `sha256sum -c SHA256SUMS.txt`.
