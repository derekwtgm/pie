# EightMax Windows 3.8

Extract the entire ZIP and open EightMax.exe. Choose **Multiway**, then **Native checkpoint recovery**, and open a saved native study (**Open latest on desktop** or a portable `.emstudy`). Choose **Explore strategy (preflop to river)**.

Build `fb81c492ed20320d`. Everything below was measured on Linux (4 logical CPUs, AMD EPYC, 15 GiB RAM) unless it says otherwise. The Windows executables were cross-compiled with MinGW-w64 GCC 13 and run under Wine 9.0 on Linux. **They were not run on physical Windows and no NVIDIA GPU was available.** Run **Run self-tests.bat** and **Validate CUDA hardware.bat** on your PC to produce `Windows-self-test.json` and `hardware-validation.json`.

## What changed, at a glance

| Area | 3.8 result | Evidence (validation/3.8) |
|---|---|---|
| Native speed | 3-player river 21% faster; 8-player final-table ICM 11–28% faster; heads-up, 8-player preflop and bubble 10–21% faster. 8-player linked study **not** improved (+3.5% to +5.5% at 4 threads). Results are byte-identical to 3.7. | native-timing*.json, parity below |
| Strategy explorer | Native-backed preflop, flop, turn and river exploration with a 13×13 matrix, combos, ranges and navigation. | explorer-reference.json, explorer-host-*.json, v38 tests |
| Restore memory | Pre-allocation estimate with exact agreement on five genuine trained states from 157 MiB to 1.55 GiB. Early refusal reports the required and available MiB. | large-restore.json |
| Accuracy | Identical at equal samples. At equal time 3.8 completes 13–28% more deals; lower exploitability on average, but not statistically significant with 3 seeds. | scenarios-accuracy.json |
| Tests | 327 passed, 0 failed, 0 skipped, 0 timed out (319 inherited + 8 new). ASan/UBSan and TSan clean on the new code. | regression-tests.json, sanitizers.json |
| GPU | No change. Hand scoring is 0.2–3.8% of external-sampling time, so a GPU cannot materially speed it up. No physical NVIDIA test. | gpu-scope.json |

## 1. Native performance regressions

### What could and could not be reproduced

The uploaded package contains the 3.7 source only, so the 3.6 engine could not be rebuilt for a fresh 3.6-versus-3.7 profile. The release-supplied raw data in `validation/3.7/scenarios.json` show that each "regression" is a median of **3 runs with very large spread on byte-identical work**. For example, the 3.7 eight-player ICM runs took 78.7, 98.2 and 120.4 ms, and the 3.6 runs took 68.9, 85.0 and 80.3 ms. Those numbers alone do not establish a code regression. Instead, 3.8 profiles the 3.7 engine directly (valgrind callgrind, deterministic instruction counts) and repairs the hotspots it finds. It then re-measures 3.7 and 3.8 with 21 interleaved repetitions per configuration.

### Measured causes (3.7, single thread)

| Study | Hotspot in 3.7 | Share of instructions |
|---|---|---:|
| Eight-player final-table ICM | `Tournament::evaluate`: per-mask O(n) rescan of removed chips | 54% |
| | `__popcountdi2`: libgcc call, because `-march=x86-64` has no POPCNT | 7% |
| | 127-entry ICM result cache: 23% hit rate | – |
| Three-player river | `Rules::build`: every betting state rebuilt on every visit (the 3.7 transition cache was disabled for fewer than four seats) | 26% |
| | `Rules::pots`: terminal pot layouts rebuilt on every visit | 8% |
| Eight-player linked / six-player flop | `Rules::build` for states below the 64 cached parents | 19–26% |

### Repairs (source/native/icm.hpp, mw_es.hpp, mw_es_impl.hpp)

- **ICM:** builds removed-chip sums and finishing places incrementally from the mask without its lowest bit. The summation order (highest set bit to lowest) is unchanged, so every value is bit-identical. The exact result cache scales with the study budget: 4,093 entries at 16 MiB and 32,749 entries at 1 GiB or more, with a 56% hit rate on the benchmark. Only validity bytes are initialized.
- **Betting transitions:** two- and three-seat studies use a hashed per-worker cache over every committed parent. Four or more seats keep the 3.7 direct map of the first 64 parents, which measured faster on wide trees. Child state ids are cached too.
- **Terminal pot layouts:** cached per committed edge as dealt-seat bitmasks. The utilities are bit-identical.
- **Betting-state store:** the betting state of hot committed states is built once during the single-threaded merge and read by workers. The store is limited to 1/32 of the table budget, at most 16 MiB, and is not charged to the table budget, so a study reaches its RAM limit at the same point as before. It turns on only once states are revisited (state visits ≥ 16 × states). Activating it on first-visit-dominated runs measurably cost wall time through page faults.
- Rejected after measurement (validation/3.8/cache-tuning.json, st*.json): larger hashed caches for 4+ seats (L1/L2 thrashing) and storing every state (2.8× the table's RAM, slower on the 1-million-state linked tree).

### Correctness of the repairs

- **240 paired runs** (10 studies × 2 seeds × 6 settings: default, fold control variate, terminal expectation, CFR+, DCFR, uniform; 1 and 4 threads) produced exported states byte-identical to 3.7.
- Every timing run in the tables below also compared the SHA-256 of both states, and all were identical.
- The new regression test also compares the native 3.8 state canonically with the JavaScript reference engine for 3-way river, ICM final table, 6-seat flop and bubble, with and without the control variate. Every row matches.

### Timings: 3.7 versus 3.8, same compiler, flags, specs, seeds and threads

These use the 3.7 benchmark specs: identical stacks, blinds, antes, ranges, bet trees, algorithm (linear external-sampling MCCFR), seeds and a 2,048 MiB budget. Runs alternate between versions. The change is the geometric mean of paired ratios, with a 95% interval. Negative means 3.8 is faster.

| Study | Updates | Threads | 3.7 ms | 3.8 ms | Change | 95% interval |
|---|---:|---:|---:|---:|---:|---|
| Three-player river | 20,000 | 1 | 109.4 | 87.8 | −21.1% | [−28.6%, −12.8%] |
| Three-player river | 20,000 | 4 | 101.3 | 88.7 | −20.6% | [−28.7%, −11.5%] |
| Eight-player final-table ICM | 80 | 1 | 282.1 | 229.4 | −21.1% | [−26.5%, −15.4%] |
| Eight-player final-table ICM | 80 | 4 | 129.3 | 113.1 | −11.4% | [−15.8%, −6.8%] |
| Eight-player linked preflop to river | 80 | 1 | 163.1 | 159.5 | −0.2% | [−6.6%, +6.7%] |
| Eight-player linked preflop to river | 80 | 4 | 78.7 | 84.1 | +3.5% | [−1.9%, +9.2%] |
| Heads-up river | 20,000 | 4 | 49.9 | 39.2 | −13.7% | [−21.3%, −5.5%] |
| Heads-up turn | 20,000 | 1 | 79.6 | 61.0 | −20.9% | [−28.2%, −12.9%] |
| Eight-player preflop shove/call | 80 | 4 | 53.3 | 46.2 | −13.7% | [−19.7%, −7.4%] |
| Tournament bubble ICM | 80 | 1 | 6.5 | 5.7 | −12.7% | [−18.8%, −6.2%] |
| Four-player flop | 80 | 4 | 35.6 | 33.4 | −5.3% | [−11.6%, +1.4%] |
| Six-player flop | 80 | 1 | 114.8 | 128.3 | +7.1% | [−1.9%, +17.0%] |
| Short-stack multiway all-ins | 80 | 1 | 15.4 | 16.9 | **+10.0%** | [+1.3%, +19.5%] |

Longer runs (1,500 multiway updates, 100,000 heads-up and three-player updates, 7 interleaved repetitions):

| Study | Threads | Change | 95% interval |
|---|---:|---:|---|
| Three-player river | 4 | −30.5% | [−36.9%, −23.4%] |
| Eight-player final-table ICM | 1 / 4 | −27.7% / −17.9% | [−30.7%, −24.7%] / [−19.9%, −15.9%] |
| Eight-player preflop | 1 / 4 | −17.7% / −9.5% | [−21.3%, −13.9%] / [−13.5%, −5.4%] |
| Six-player flop | 1 / 4 | −5.3% / −2.7% | [−10.2%, −0.2%] / [−5.1%, −0.3%] |
| Eight-player linked preflop to river | 1 / 4 | +3.5% / **+5.5%** | [−1.8%, +9.0%] / [+2.2%, +8.9%] |
| Four-player flop, short stack | 1 and 4 | −1.5% to +0.5% | all intervals include 0 |

All rows are in `native-timing.json` and `native-timing-long.json`.

**Remaining limitations**

- The eight-player linked study is not faster. At 4 threads on long runs it is 2–9% slower. This 1-million-state tree is dominated by first visits, the store stays inactive, and no remaining hotspot was isolated.
- Short-stack all-ins at 80 updates on one thread is 1–20% slower.
- Peak RSS rises by up to 17 MiB where the store or ICM caches are active, for example from 18 to 32 MiB on the 4-thread ICM run.
- Hardware cache-miss and lock-contention counters were not available (no `perf`).

## 2. Strategy explorer (preflop to river)

The host answers `POST /api/mw/node` with one decision point of the open native study:

```json
{"path":[0,0,0,0,0,0,1,0], "board":[51,30,7], "rangeSeat":6, "offset":0, "limit":1326}
```

- `path` holds the action slots at decision nodes. `board` holds the cards dealt after the study's own board: flop, then turn, then river.
- The response is bounded to one node and at most 1,326 hands. A full eight-player root query took 11–65 ms. It never exports or copies the study.
- `POST /api/mw/node-cancel` cancels a running query. Queries run under the engine lock and are refused while training or restoring.

**How a node is resolved (source/native/explorer.hpp)**

- Each step replays the same `Rules::advance` and `nextStreet` functions that training uses.
- Each step's committed state id is looked up in the state table. That id, the hand key and the board code form the stable information-set identifier, which is shown as `betting state #id`.
- Only the rows of the selected node are read.
- Actions outside the solved abstraction are refused with an explanation. Legal branches that were never sampled are labelled "not visited" and show no strategy.
- When a street ends, the response asks for the next card(s) instead of guessing.

**What is displayed**

- Node: street, acting position, board, pot, amount to call, effective stack, stacks behind, active, folded and all-in seats, betting history (clickable), and legal actions with bet and raise sizes.
- Terminal nodes: their pots with eligible seats.
- **Average strategy** (normalized stored average sums, the solver output) and **current strategy** (regret matching of stored regrets) are listed separately and never substituted for each other.
- Grouped studies label the shared group row.
- Range reach: weight × the seat's own average probabilities along the path. Hands where a missing row forced a uniform factor are flagged.
- 13×13 matrix with reach-weighted mixed-strategy bars, and per-combo lists.
- Board-blocked combos are marked impossible. Coverage counts are shown.

**EVs are not displayed.** External-sampling checkpoints store cumulative regrets and average-strategy sums, not action values.

**Independent verification**

- `explorer-reference.py` parses raw EMMW4 states with its own code, reconstructs paths and boards, and compares average and current strategies, reach, aggregates, state ids and actors. Result: **397 nodes on all ten studies (preflop, flop, turn and river), 0 mismatches.**
- The host test does the same over HTTP: 92 checks, 25 river nodes, for both the Linux host and `EightMax.exe` under Wine.

Interface: Multiway → Native checkpoint recovery → **Explore strategy (preflop to river)**. The host API also serves an idle live native study. The interface button appears with desktop studies.

## 3. Large-state restoration and memory estimates

- Before allocating the strategy tables, the loader computes an estimate from the archive's state, row and value counts. It covers values, frozen-batch deltas and reserve headroom, row metadata, the row hash, betting-state arrays and the state hash.
- When the estimate exceeds the restore budget (available RAM, process and application limits, `EIGHTMAX_RESTORE_MIB`), the restore is refused with the numbers. For example: *"needs an estimated 95 MiB … 70 MiB is available"*.
- The checkpoint files and the open study are untouched.
- The existing progress, cancellation and cleanup of failed partial loads are retained.
- The 3.7 budget rule for the target PC is unchanged: half of physical RAM, capped at 8,192 MiB for the application.

**Genuine trained eight-player linked states**

Each state was trained by the solver, restored in a new process, trained one more update and compared with an uninterrupted run (`large-restore.json`):

| Updates | Rows | States | File MiB | Live tables MiB | Estimate MiB | Estimate error | Restore s | Restore peak RSS MiB | Resume = uninterrupted |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|:-:|
| 2,300 | 728,951 | 1,385,243 | 45.9 | 157.5 | 163.9 | 0.0% | 1.9 | 171 | yes |
| 4,600 | 1,369,507 | 2,151,517 | 82.0 | 300.0 | 318.0 | 0.0% | 3.5 | 323 | yes |
| 9,300 | 2,580,604 | 3,297,495 | 147.5 | 478.3 | 487.0 | 0.0% | 5.4 | 498 | yes |
| 19,000 | 4,895,586 | 5,002,807 | 268.4 | 915.3 | 946.1 | 0.0% | 10.0 | 954 | yes |
| 38,500 | 9,111,223 | 7,285,251 | 481.9 | 1,546.8 | 1,558.8 | 0.0% | 17.5 | 1,579 | yes |

- "Estimate error" compares the estimate with the restored table capacity.
- "Resume = uninterrupted" means byte equality of regrets, averages, states, RNGs, counters and CRC.
- These were raw CLI restores. The desktop restore of an archive adds decoding and staging; 3.7 measured those separately and they are unchanged.

## 4. Mathematical accuracy

- **Equal samples:** 3.8 is byte-identical to 3.7, so strategies and exploitability are identical at any number of sampled deals.
- **Equal time** (2 s, 4 threads, 3 seeds, `scenarios-accuracy.json`):

| Study | Deals 3.7 → 3.8 | Quality 3.7 → 3.8 | Paired reduction (95% half-width) |
|---|---|---|---|
| Heads-up river (exact BB) | 750,635 → 940,907 | 0.0354 → 0.0343 | +0.0010 (±0.045) |
| Heads-up turn (exact BB) | 477,931 → 577,621 | 0.3205 → 0.3152 | +0.0053 (±0.043) |
| Three-player river (exact largest unilateral gain) | 373,056 → 478,293 | 0.0645 → 0.0519 | +0.0125 (±0.043) |
| Eight-player final-table ICM (approximate seat-0 probe) | 18,432 → 20,821 | −0.051 → −0.147 | +0.097 (±0.208) |
| Eight-player linked (approximate seat-0 probe) | 27,648 → 29,013 | 0.016 → 0.031 | −0.015 (±0.181) |

- The direction favours 3.8 where throughput rose, but **no interval excludes zero**. A convergence improvement is therefore not claimed.
- The multiway values are approximate one-seat trained-response gains on held-out deals. They are not exploitability and not Nash certificates.

**Variance reduction**

- The 3.7 optional fold control variate was audited and kept as is. Each known terminal sibling contributes once, and only the sampled unresolved continuation carries the residual importance weight. The importance weights and descendant reach are unchanged.
- It remains **off by default**. The 3.7 seven-seed study found no significant improvement at any budget (every interval included zero), and 3.8 adds no new evidence for it.
- No new estimator was enabled.

## 5. Tests

- `regression-tests.json`: **327 passed, 0 failed, 0 skipped, 0 timed out** on Linux with the final build. That is 319 inherited tests plus 8 new ones in `source/tests/v38.test.js`:
  - JavaScript-reference parity of the caches
  - thread and store invariance
  - deterministic continuation with the store, ICM, DCFR and CFR+
  - explorer per-street agreement with an independent parser
  - explorer refusals, chance cards, terminals and blockers
  - matrix aggregation
  - restore estimate accuracy and early refusal
  - the host explorer route
- Hardware-dependent tests run: 12. These use the 3.7 CUDA driver test double. **They are not physical GPU tests.**
- `sanitizers.json`: ASan+UBSan and TSan (4 workers), each over 80 training runs, 80 resumes, 80 restores and 320 explorer queries plus refusal paths. 0 diagnostics.
- Package, MTT and checkpoint UI smoke tests passed: `*.log`.
- Native host tests passed on Linux (27 + 9 checks) and for `EightMax.exe` under Wine (27 + 9 checks). The explorer host test (92 checks) passed on both.
- `wine-parity.json`: `mwcli.exe` under Wine produced byte-identical states, explorer responses and restore estimates to the Linux build on all ten studies.
- `Run self-tests.bat` now also checks the explorer on the restored 3.6 fixture.

## 6. CUDA, hybrid scheduling and the RTX 4060 Ti

- No GPU, NVIDIA driver or CUDA toolkit was available, so **no CUDA code was changed or executed**.
- The inherited PTX and sm_89 images and all four processing modes (Automatic, CPU Only, GPU Preferred, Hybrid) are unchanged.
- The engine's own profile shows hand scoring takes 0.22–3.8% of external-sampling training time across the ten studies (`gpu-scope.json`). Moving scoring to the GPU could therefore save at most about 4% before PCIe and synchronization costs.
- Traversal, regret matching and commits are irregular, sequential-per-deal work that stays on the CPU.
- Hybrid mode is not advertised as faster.
- `Validate CUDA hardware.bat` still records the model, driver, compute capability, VRAM, kernel execution, CPU/GPU agreement, allocation handling, fallback and end-to-end timing on your PC.

## 7. Unchanged in 3.8

- JavaScript full-traversal checkpoint restoration still has the 2 GiB decoded browser ceiling. Use the native external-sampling path for large studies.
- The automatic algorithm selector is unchanged from 3.7. Manual overrides are preserved.
- Tournament defaults are unchanged:
  - SB 0.5 BB, BB 1 BB, ante 0.1 BB per dealt player
  - eight-player pot 2.3 BB
  - positions UTG, UTG+1, MP, HJ, CO, BTN, SB, BB
  - big-blind ante remains a separate option
- No exact Nash equilibrium of eight-player No-Limit Hold'em is claimed.

## Reproduce

```sh
node source/tools/build.js && sh source/native/build.sh linux && sh source/native/build.sh windows
node source/tools/verify_build.js .
EM_TEST_HOST=$PWD/source/build/linux/eightmax EM_TEST_MWCLI=$PWD/source/build/linux/mwcli node source/tools/run_tests.js out.json
```

`validation/3.8/README.md` lists every measurement command.
