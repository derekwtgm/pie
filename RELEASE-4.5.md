# EightMax Windows 4.5

Release focus: the audited coverage memory-budget overrun (release blocker),
process memory accounting, Windows numerical validation, an ICM speed-up with
identical bits, and an honest negative result on training convergence.

**What has and has not run where**

| Environment | What ran | Status |
|---|---|---|
| Linux build machine (4 logical CPUs, 15 GiB, GCC 13.3) | everything in this document unless stated otherwise | done |
| Windows executables under Wine 9.0 (not Windows) | `tools/wine45.js`, desktop-host checks | done, see section 13 |
| GitHub-hosted `windows-latest` virtual machine (real Windows, Windows PowerShell 5.1, MinGW-w64 UCRT build of this source, **no GPU**) | the repository's Windows workflow: `test_windows.ps1` (the script behind `Run self-tests.bat`), regression suite, hardware script on CPU paths | see section 13 for the exact status of each step |
| Your PC (i7 13th gen, 24 logical processors, RTX 4060 Ti 8 GB, 16 GB RAM) | nothing | **pending** |
| Any physical NVIDIA GPU | nothing | **pending** |

No GPU timing, VRAM figure or CUDA result in this release is measured. CUDA
code paths were exercised only with the Linux driver test double (simulated).

## Summary

| Priority | Result |
|---|---|
| 1 Coverage memory budget (blocker) | **Repaired.** The 4.4 defect is reproduced against the archived 4.4 code (1 MiB allowance, 32,768 information sets: 1,425,408 bytes, +35.9%) and at the evaluator (4.4 reports 3,522,560 bytes for 2 MiB and 89,505,792 for 64 MiB). 4.5: `coverageMiB` is a hard ceiling on live bytes, enforced before every allocation; peak ≤ budget in every test, build and budget measured; counts stay exact up to the documented capacity. |
| 2 Process memory | Background jobs now charge `memoryMiB + coverageMiB` to the evaluation pool (4.4 ignored the coverage budget: up to 4,096 MiB per job unseen). Evaluations with exhausted budgets leave the study byte-identical and training continues bit-identically. Audit of the other components in section 2. |
| 3 Windows numbers | New 200,000-value sweep. It found a real defect in the Windows build: the MinGW-w64 `strtod` is one ULP off for some extreme values. The engine now parses with `std::from_chars` (0 mismatches). The sweep and all 4.4 bit-pattern checks **passed on real Windows PowerShell 5.1** (hosted runner). A 4.4 script error that stopped the self-test on Windows was found there and fixed. Not yet run on your PC. |
| 4 Sampled-EV deadlines | Preserved. Worst overrun 11.5 ms over 128 runs (4.4: 44.1 ms worst, 14.2 ms otherwise); tolerances unchanged (50 ms idle / 150 ms loaded). Small regression: cancellation latency 2.2 → 4.1 ms and +0–3 ms median overrun at the default 64 MiB budget (cause known, section 4). |
| 5 GTO convergence | **No improvement in equilibrium quality is claimed.** Two new opt-in trainer options (Latin-hypercube chance sampling, opponent exploration) were implemented and tested: ten seeds, six games (two with exact exploitability), 288 Holm-adjusted comparisons. None is better across games. The default trainer is unchanged and writes the 4.4 state bytes. |
| 6 Multiway postflop | Stability study across seeds, board textures, stack depths, betting abstractions and budgets (`tools/stability45.js`); property test of 16 generated 3–6 player side-pot games (chip EV and ICM). The 4.4 rules walk and value checks are kept. |
| 7 RTX 4060 Ti scheduling | **No code change** — nothing can be justified without measurements on the GPU. The validator gained a cold small/medium/large section. Pending on your PC. |
| 8 Native performance | ICM kernel 1.4–1.5× for 6–8 live players with identical bits; eight-seat linked ICM training 1.13× (1 thread) – 1.19× (4 threads); sampled evaluation throughput +11–13% samples in 3 s; several exact evaluations 2–14% faster. Regressions: section 8. |
| 9 Response-gain evaluation | Per-seat coverage tables now keep sketches inside the pool; results bit-identical for 1 and 4 threads in all new tests; evaluation methods and their labels unchanged. |
| 10 Tournament mathematics | Unchanged (0.5/1 blinds, 0.1 bb individual antes, 2.3 bb eight-player pot, optional big-blind ante). ICM kernel bit-identical to 4.4 on 240,000 random evaluations. |
| 11 Checkpoints | Unchanged formats. New tests: evaluation with exhausted coverage budget / deadline between two training runs gives the same state bytes as an uninterrupted run (Linux, Wine, Windows runner). |
| 12 Regression suite | @@TESTS@@ |
| 13 Windows / hardware | Executables rebuilt (`EightMax.exe`, `mwcli.exe`, `gpustress.exe`). Wine and hosted-Windows results in section 13. Physical RTX 4060 Ti: pending. |
| 14 Benchmarks | `validation/4.5/bench/`, `deadline/`: interleaved 4.4 / 4.5, medians and ranges, regressions listed. CUDA rows (cold/warm start, VRAM) are **not measured**. |

Build identifier: `@@BUILD@@`.

---

## 1. Coverage memory budget (Priority 1)

### The defect, reproduced

`native/coverage.hpp` (4.4) kept one concurrent set per request as a sequence of
table generations ("tiers"): 4,096 slots, then four times larger each, 16 bytes a
slot. The evaluator set the key limit to `coverageMiB · 2^20 / 32` and sized the
**largest** generation alone to the whole allowance (2 slots a key). Not counted:

1. the smaller generations, which stay allocated until the request ends because
   lock-free readers may still be reading them;
2. the three HyperLogLog sketches (49,152 bytes), allocated unconditionally;
3. a replacement generation prepared for a promotion that a stop (deadline,
   cancellation) abandoned — it stayed allocated and the next promotion
   allocated the same generation again;
4. each worker's observation filter (512 KiB per worker, 12 MiB for 24 workers);
5. in the response-gain / merged path: sketches, and a second unpooled table.

`tests/coverage45.cpp` compiles the archived 4.4 header
(`tests/fixtures/coverage44_reference.hpp`, unmodified except its namespace) next
to the 4.5 one and runs the audit's scenario on it:

| | allowance | information sets | bytes live |
|---|---:|---:|---:|
| 4.4 (archived code) | 1,048,576 | 32,768 | **1,425,408** (+35.9%) = 65,536 + 262,144 + 1,048,576 + 49,152 |
| 4.5, 1–16 workers, with and without filters | 1,048,576 | 32,768 (exact) | peak **≤ 1,045,680** |

The same test built for Windows and run under Wine gives the same 1,425,408.

At the evaluator (eight-seat linked ICM study, sampled range EV, 30,000 samples;
`validation/4.5/bench/bench45-memory-training.json`; 4.4's figure is its own
`execution.coverageSetBytes`):

| coverageMiB | budget bytes | 4.4 slot + sketch bytes | 4.4 over | 4.5 ledger peak (1 / 4 threads) | exact key limit (both) |
|---:|---:|---:|---:|---:|---:|
| 1 | 1,048,576 | 1,425,408 | +35.9% | 1,045,744 / 1,045,744 | 32,768 |
| 2 | 2,097,152 | 3,522,560 | +68.0% | 2,094,336 / 2,094,336 | 65,536 |
| 8 | 8,388,608 | 14,008,320 | +67.0% | 8,385,808 / 8,385,808 | 262,144 |
| 32 | 33,554,432 | 55,951,360 | +66.7% | 31,978,784 / 33,551,648 | 1,048,576 |
| 64 (default) | 67,108,864 | 89,505,792 | +33.4% | 63,436,064 / 65,008,928 | 2,097,152 |

(4.4 worker filters come on top of its figures.) EV bit patterns are identical
between the builds and for every budget.

### The repair

* **Semantics.** `coverageMiB` is the **maximum live allocated bytes** of the
  request's coverage component — not reserved capacity, not logical contents.
* **Ledger** (`emcov::Budget`): `reserve(bytes)` succeeds only if
  `live + bytes ≤ limit`, tested as `bytes > limit || live > limit − bytes` (no
  overflow), by compare-and-swap; `peak` is updated by the same step. Every
  allocation is reserved first; a refused reservation allocates nothing.
* **What is counted while allocated:** every generation (current, replacement
  under construction, retired), rounded up to whole 4 KiB pages; generation
  descriptors and the generation list; the sketches; the set object including
  its 64 lock cells and mutexes; every worker filter; a parked replacement.
* **Planning** (`planFor`): generation sizes are fixed when the set is created so
  that the whole sequence fits: 1,024 slots, ×4 each, and a last generation that
  takes what remains; a further ×4 generation is inserted only while the last one
  stays ≥ 4× larger, so retired generations cost at most a third of it. The
  last generation may be filled to 3/4 (earlier ones to 1/2 as before), which is
  what keeps the documented capacity `coverageMiB · 2^20 / 32` exact keys inside
  the ceiling. Checked for 20,000 allowances from 0 bytes to 4 GiB.
* **Worker filters:** 1/16 of the budget, divided among the workers (power of
  two entries, at most 32,768; below 256 entries no filter — every observation
  then goes to the set, same result).
* **Abandoned promotions:** the prepared generation is parked and reused by the
  next promotion — never allocated twice, always inside the plan.
* **Reader safety:** unchanged design (retired generations are never freed while
  the set lives); it is now budgeted instead of hidden. Epoch-based reclamation
  was considered and rejected: growth needs the old and the new generation at
  once in any case (1.25× the final table), so reclaiming older ones would save
  about 1/12 of the budget at the price of a write on every lock-free lookup.
* **4.4 key-limit interface** (tests): now has a private ledger with the implied
  ceiling (fixed bytes + every generation), so it cannot exceed its documented
  bound either.
* **Per-seat tables** (response gains) and `EM_EV_MERGED_COVERAGE`: slots and
  sketches from one pool; the merged table no longer has a second allowance.

### Exhaustion and failure

| Situation | Behaviour |
|---|---|
| More information sets than the capacity | `status: keyLimitReached`; set capped; `distinct*` are exact lower bounds (= the limit); labelled HyperLogLog estimates cover every key; EVs unaffected |
| Ledger overdrawn by another consumer during growth | reservation refused before allocating; present generation stays current and becomes the last; `status: budgetExhausted`; lower bounds; no key invented or duplicated |
| Operating system refuses the allocation (fault injection after 0, 1, 2 promotions) | reservation returned (ledger unchanged); `status: allocationFailed`; lower bounds |
| Budget below the minimum (about 60 KiB) | no table, no sketch; capped from the first observation; `distinct = 0` (a true lower bound) |
| Stop during growth | promotion abandoned, replacement parked, nothing published; set consistent |

In every case: nothing half-built is published, workers never wait on the budget
code, the study is not touched (state bytes identical before and after), and
completed EV numbers are returned unchanged.

### Tests

`tests/coverage45.cpp` (46 checks; also under ThreadSanitizer and ASan+UBSan;
also built for Windows and run under Wine): the scenario above; 1, 2, 8, 32 MiB
below and above capacity with 1 and 8 workers; the plan for 20,000 allowances;
ledger overflow cases and 16-thread contention; forced hash collisions; a stop
raised and cleared continuously during growth; a stop into a 64 MiB fill
(workers return within 60 ms); exhaustion; failed allocation; four lock-free
readers during resizing; destruction; 200 repeated jobs on one ledger (returns to
exactly 0 each time); worker filters; the 4.4 interface; pooled per-seat tables.

`tests/v45.test.js`: `coverage.memory.peakBytes ≤ budget` for 1, 2, 8, 32 MiB ×
1, 2, 4, 8 threads on the eight-seat linked study; counts identical for every
thread count; EVs identical for every budget; timeouts during growth; merged
path; response gains.

**Every "within budget" statement reads the ledger's peak, which the code under
test maintains.** As an outside cross-check the unit test recomputes the bytes
from the generation list; process peak RSS is recorded in the benchmark but is
dominated by showdown tables and is not a proof.

---

## 2. Process-wide memory (Priority 2)

| Component | Budget / accounting (4.5) | Changed in 4.5 |
|---|---|---|
| Regret and average-strategy tables, row and state lookup | study `memoryMiB` (reserve-before-allocate, checked in restore estimate) | no |
| Training scratch (walkers, units, ICM workspaces) | `ScratchBudget` (pmr resource: reserve before allocation) | no |
| Strategy-coverage tables, filters, sketches | `coverageMiB` hard ceiling (section 1) | **yes** |
| Showdown tables, memo, pattern histograms | request `memoryMiB`; over budget → per-board enumeration | no |
| Response-gain per-seat coverage | shared pool of `coverageMiB`, sketches included | **yes** |
| Background evaluation jobs | pool (¼ of available RAM, ≤ 2,048 MiB); each job charged `memoryMiB + coverageMiB`; over pool → 413; does not fit now → waits | **yes** |
| CUDA device buffers | `gpuMiB` / `gpuBudgetBytes`, VRAM reserve; refusal → CPU for that table | no (not measured on a GPU) |
| Checkpoint save / restore | streamed; restore estimate checked before allocation | no |
| Whole application | half of physical RAM ≤ 8 GiB (`EIGHTMAX_APP_MIB`) | no |
| JavaScript workers / browser reader | 2 GiB decoded ceiling for full-traversal restores | no (limitation) |

**Defect fixed:** `ev_jobs.h` charged only `memoryMiB`. A job with
`{"memoryMiB":16,"coverageMiB":4096}` was admitted as a 16 MiB job. Now refused
(413) with a message naming both values; job status reports `coverageMiB` and
`chargedMiB`. Verified on Linux and in the Windows self-test.

**Recovery test** (`tests/v45.test.js`, also in `Run self-tests.bat` and
`wine45.js`): train 120 updates; run a capped evaluation, a 16 MiB-table
evaluation, a deadline-limited evaluation and a response gain; the state file is
byte-identical; train 120 more; the result is byte-identical to 240 uninterrupted
updates (same counters and RNG states).

Not implemented: a single process-wide allocator budget, memory-pressure
polling during evaluations, adaptive job concurrency beyond the existing pool.

---

## 3. Windows numerical validation (Priority 3)

Preserved from 4.4: `evBits`, `gainBits`, bit-pattern comparisons, `%.17g`
output, the probe table, the numeric policy (exact fields compared as bit
patterns; tolerances stated where a tolerance is the right comparison).

**New: `mwcli --ieee-sweep [count] [seed]`.** `count` doubles from a fixed
generator in six classes (any finite pattern; EV-sized of both signs;
subnormals; ±3 ULP around every power of two; huge; around 2^53). Each is
printed with 17 significant digits and parsed back by the engine's parser and by
the JSON reader (must be identical bits); its one-ULP neighbour must print
differently and parse back to itself. `digest` hashes every printed character.

| Build | 200,000 values, seed 45 | digest | C-runtime `strtod` off by one ULP |
|---|---|---|---:|
| Linux | 0 mismatches | `94fc3f6ed8426909` | 0 |
| Windows build under Wine | 0 mismatches | `94fc3f6ed8426909` | 12 |
| Windows build on the hosted Windows runner | 0 mismatches, digest equal (self-test check passed) | `94fc3f6ed8426909` | see `windows-runner/` |

**Defect found by the sweep.** Before the fix the Windows build failed it: the
MinGW-w64 runtime's `strtod` — and `__mingw_strtod` — return the neighbouring
double for some values just below a power of two (16 of the 28,630 values within
3 ULP of a power of two; magnitudes below 1e-150 or above 1e195; e.g.
`4.3225817678266131e-224`). 4.4 parsed every JSON number with it. Such magnitudes
do not occur in EVs, stacks or weights, so no 4.4 result is known to be affected,
but an "exact" reader must be exact: `em_parse_double` (`std::from_chars`,
correctly rounded, independent of the C runtime) now parses JSON numbers and CLI
numeric arguments. Printing never differed (equal digests).

**4.4 self-test defect found on Windows.** `tools/test_windows.ps1` used
`[decimal]::Abs`, which does not exist in Windows PowerShell 5.1 (.NET Framework).
On the hosted Windows runner the 4.4 script passed every check up to that line
and then stopped. Fixed with `[math]::Abs`. This is the kind of error that only a
real PowerShell run can show; it is the reason the remaining unexecuted script
(`validate_hardware.ps1` sections needing a GPU) must be treated as untested.

Not validated: your physical PC (the hosted runner is a virtual machine with a
different CPU), and PowerShell 7.

---

## 4. Sampled-EV deadline and cancellation (Priority 4)

Tolerances are unchanged (limit + 50 ms idle, + 150 ms loaded).

`validation/4.5/deadline/deadline-4.4-vs-4.5.json` — eight-seat linked ICM study,
range sampled, 8 repetitions, builds interleaved, overrun past the limit in ms
(median / maximum):

| Limit | Threads | 4.4 | 4.5 |
|---:|---:|---:|---:|
| 100 | 1 / 2 / 4 / 8 | 4.2/6.0 · 5.6/7.5 · 5.2/5.9 · 5.1/5.6 | 4.1/5.8 · 8.8/10.5 · 7.1/11.5 · 7.5/7.9 |
| 250 | 1 / 2 / 4 / 8 | 5.5/7.6 · 5.1/7.4 · 5.5/6.9 · 5.8/7.0 | 6.7/8.1 · 7.0/7.7 · 8.0/11.1 · 7.6/8.5 |
| 600 | 1 / 2 / 4 / 8 | 4.7/7.2 · 8.1/8.9 · 9.3/14.2 · 8.2/9.3 | 6.9/9.5 · 7.3/7.7 · 7.5/10.7 · 7.5/7.9 |
| 1000 | 1 / 2 / 4 / 8 | 5.1/44.1 · 9.1/11.6 · 10.0/12.5 · 8.9/10.7 | 6.6/7.0 · 7.0/7.7 · 7.8/10.8 · 8.2/9.3 |

Worst of 128 runs: 4.5 11.5 ms; 4.4 44.1 ms (one outlier; otherwise 14.2 ms).
With a 1 MiB coverage budget (growth, key limit and sketch back-fill inside the
limit; `deadline-1MiB-coverage.json`): 4.5 median 4.8–5.0 ms, worst 11.0 ms;
4.4 median 4.7–5.2 ms, worst 7.8 ms.

**Regression, stated plainly.** At the default 64 MiB budget 4.5 is 0–3 ms later
than 4.4 for 100–250 ms limits, and cancellation latency rose from a median of
2.2 ms to 4.1 ms (`bench-4.4-vs-4.5`: `cancel-150-linked8-4t`). Cause, measured
by budget: 4 MiB 1.5 vs 1.8 ms, 16 MiB 1.9 vs 2.1 ms, 64 MiB 5.7 vs 2.2 ms
(4.5 vs 4.4). To hold 2,097,152 exact keys inside 64 MiB the plan goes from a
4 MiB generation straight to a 54 MiB one, which is touched when created and
unmapped when the request ends; 4.4 reached that size in two steps (and exceeded
the budget). The ledger itself adds no wait: workers never block on it, and a
capped request is not slower than an uncapped one (376 vs 411 ms). Not fixed in
4.5; lowering `coverageMiB` removes it.

Checked again in the regression suite: 100 / 250 / 600 / 1000 ms limits with
1–24 threads, weighted ranges, partial-result labels and sample counts, statistics
of partial results, cancellation during sampling and during growth (4.4 tests,
unchanged, all passing), plus the 4.5 timeout-during-growth test.

---

## 5. Convergence (Priority 5)

**Audit.** The external-sampling update (`native/mw_es_impl.hpp`) was re-read
with the 4.4 audit's checklist (opponent sampling with importance weights,
counterfactual reach, average-strategy weighting, chance probabilities through
the deal sampler, weighted ranges, frozen-batch aggregation, terminal utilities,
ICM). No inconsistency was found. 4.4 had already tested regret matching+, DCFR
variants, quadratic/cubic averaging, linear CFR and two control variates without
a consistent gain, and named stratified chance sampling as the untested class.

**Implemented for the study (opt-in, native only, default untouched):**

* `chanceSampling: "latin"` — Latin-hypercube private hands. Within an epoch of
  S deals (S = largest range size, ≤ 4,096) every seat's hand is drawn from a
  different one of S equal-probability strata of its range, with independent
  permutations per seat and epoch derived from the seed. A candidate tuple is
  uniformly distributed over the product of the ranges, so a compatible one has
  exactly the default conditional distribution; an incompatible one (shared
  card) is replaced by the ordinary independent sampler. **Each deal's marginal
  distribution is exactly the default; only the dependence between deals
  changes.** Deterministic, resumable (80 + 120 updates = 200 updates byte for
  byte), identical for 1 and 4 threads.
* `opponentExploration` e — opponents sampled from `(1 − e)σ + e/k`
  (default 0.1).

**Study** (`validation/4.5/convergence/`): the 4.4 protocol — ten seeds, exact
best response of every seat after each checkpoint (independent of training),
paired comparisons with the default at equal sampled deals and at equal training
time, Holm adjustment over all 288 comparisons. The default's numbers reproduce
the 4.4 report exactly.

| Game | Metric | Default, last checkpoint | latin | latin + baseline | exploration 0 | exploration 0.05 |
|---|---|---:|---:|---:|---:|---:|
| Heads-up river, 1,000,000 deals | NashConv (exploitability = half, exact) | 0.0323 ± 0.0067 | 0.0355 | 0.0333 | 0.114 | 0.0454 |
| Heads-up turn + river, 1,000,000 | NashConv (exploitability = half, exact) | 0.0544 ± 0.0052 | 0.0514 | 0.0480 | 0.0525 | 0.0581 |
| Three-player river, side pots, 1,000,000 | NashConv (not exploitability) | 0.0168 ± 0.0025 | 0.0172 | 0.0142 | 0.146 | 0.0189 |
| Four-player ICM bubble, 250,000 | NashConv (not exploitability) | 2.17e-6 | 2.14e-6 | 2.13e-6 | 1.61e-6 | 1.40e-6 |
| Six-player flop, 250,000 | NashConv (not exploitability) | 0.0656 ± 0.026 | 0.0861 | 0.0751 | 0.0746 | 0.0467 |
| Eight-player final table ICM, 250,000 | NashConv (not exploitability) | 2.2e-6 | 2.2e-6 | 1.4e-6 | 0.0333 | 1.4e-7 |

| Variant | Supported better | Supported worse | of comparisons |
|---|---:|---:|---:|
| latin | 0 | 0 | 72 |
| latin + terminal baseline | 0 | 0 | 72 |
| exploration 0 | 0 | 1 | 72 |
| exploration 0.05 | 4 | 0 | 72 |

**Verdict.** No candidate improves strategy quality across these games.
Exploration 0 stalls on three games (an action that is never sampled is never
revisited). Exploration 0.05 is supported better only on a few final-table
checkpoints and is not better on the postflop games. Latin sampling has no
supported effect; in eight-handed random-range deals only about 9% of candidate
tuples are free of card conflicts, so it mostly falls back to the default there.
**The validated default is kept, and 4.5 does not produce stronger strategies
than 4.4** — they are the same strategies (identical state bytes; the hash is a
regression test).

What did improve is cost at equal quality for ICM studies: the trainer does the
same updates in less time (section 8), so at equal elapsed time an ICM study is
13–19% further along the same convergence curve. That is a throughput gain, not
a better algorithm.

Limits: NashConv with more than two players or ICM is a sum of unilateral
deviation gains inside the abstraction, not exploitability; all six games use
small explicit ranges; equal-time results carry noise from other work on the
machine; nothing here is a statement about full eight-handed No-Limit Hold'em,
and no exact equilibrium is claimed.

---

## 6. Multiway postflop (Priority 6)

Kept from 4.4 and passing: rules walk of about 700 explorer nodes in ten trees
(chips, actors, legal actions, minimum raises, transitions, chance cards,
blockers, strategy normalization), chip conservation, prize-pool sums, two
independent evaluators, sampling against exact enumeration.

New in 4.5:

* **Property test** (`tests/v45.test.js`): 16 generated all-in-or-fold river
  games, 3–6 players, random unequal stacks (1–30.5 bb), earlier wagers, folded
  money, weighted ranges; every fourth with ICM payouts. Exact seat values sum to
  the starting pot (chip EV) or the prize pool (ICM) within 1e-9 relative;
  every unilateral gain ≥ 0; 1 and 4 threads bit-identical.
* **Stability study** (`tools/stability45.js`,
  `validation/4.5/stability/`): see the table written there. @@STABILITY@@

Approximation limits: explicit small ranges, the stated bet menus, and at most
six players after the flop. A low NashConv in a multiplayer or ICM game does not
show closeness to an equilibrium in strategy space, and seeds may approach
different equilibria.

---

## 7. RTX 4060 Ti scheduling (Priority 7)

Audit only. Automatic mode is the 4.4 design: the 4.3 cost model decides
whether an unverified device is worth opening; once verified, three arms (CPU,
GPU pull, GPU preferred) are timed per (thread budget, table size) class on
whole tables and the fastest is used, with bounded re-probing; one context,
module and verification per process; buffers reused; idle release after 60 s.

Candidates considered and **not implemented**, because their value can only be
shown on the GPU: persisting measured arm times between runs (saves at most six
tables per class and process), larger batches, a different small-table
threshold. Changing any of these blind would risk exactly the kind of regression
the 4.3 report showed.

`Validate CUDA hardware.bat` section 11 (new): small, medium and large
evaluations with CPU only, GPU preferred, hybrid and Automatic in fresh
processes; requested and observed device, CPU and GPU boards, median of three
times, VRAM peak against `gpuMiB`, coverage peak against `coverageMiB`, exact
results compared as bit patterns; whether cold Automatic is within 15% of the
best fixed mode (a finding, not a failure). Section 10 (4.4) remains the warm
comparison. The script ran on the hosted Windows runner on CPU paths only
(status in section 13); its GPU branches have never executed anywhere.

---

## 8. Native performance (Priority 8)

**Profile** (callgrind, eight-seat linked ICM training, one thread): 45% of
instructions in `Tournament::evaluate` (exact ICM finishing-set recursion), 11%
in building betting states, 5% in side pots, 4% in the regret update.

**ICM kernel.** The recursion performs one division per unfinished player and
finishing set (1,024 for eight players) and is bound by them. With five or more
live players 4.5 visits the unfinished players through the set bits of the mask
and computes two products and two quotients per SSE2 instruction. Each lane does
the scalar operations `(pm · stack) / (total − removed)`; for one mask every
player writes its own accumulators. Result: identical bit patterns
(`tests/icm45.cpp`, 240,000 random evaluations against the archived 4.4 routine,
also under ASan+UBSan and built for Windows under Wine). Four or fewer live
players run the unchanged loop.

`validation/4.5/bench/icm-kernel.jsonl` (ns per evaluation, median of 11):

| Live players | 4.4 | 4.5 | Speed-up |
|---:|---:|---:|---:|
| 8 | 3,339 | 2,220 | 1.50× |
| 7 | 1,458 | 1,023 | 1.43× |
| 6 | 768 | 495 | 1.55× |
| 5 | 294 | 257 | 1.14× |
| 4 | 152 | 143 | 1.06× |
| 3 | 82 | 80 | 1.02× |
| 2 | 59 | 62 | 0.95× |

(2–4 players execute the same loop in both versions; the differences there are
noise of a few ns.)

**Training** (`bench45`, 5 interleaved repetitions, median seconds, state SHA-256
identical between builds in every row):

| Study | Sampled deals | Threads | 4.4 | 4.5 | Speed-up |
|---|---:|---:|---:|---:|---:|
| Eight-seat linked preflop-to-river, ICM, random ranges | 12,000 | 1 | 1.916 | 1.691 | 1.13× |
| same | 12,000 | 4 | 1.959 | 1.641 | 1.19× |
| same with chip EV (control: no ICM) | 12,000 | 1 / 4 | 1.003 / 1.012 | 0.995 / 1.018 | 1.01× / 0.99× |
| Four-player ICM bubble | 400,000 | 1 / 4 | 0.822 / 0.838 | 0.775 / 0.795 | 1.06× / 1.06× |
| Eight-player final table push/fold, fixed hands | 400,000 | 1 / 4 | 3.721 / 3.869 | 3.723 / 3.790 | 1.00× / 1.02× |

The fixed-hand final table reuses a small set of stack vectors (ICM cache hits),
so the kernel hardly runs there. Note that 1 and 4 threads take the same time on
these studies in both versions: with 4 deals per update there is too little work
per update to split (inherited; listed in ROADMAP).

**Evaluation** (`bench-4.4-vs-4.5`, 5 interleaved repetitions, median ms;
identical results in every row):

| Workload | 4.4 | 4.5 | 4.5 / 4.4 |
|---|---:|---:|---:|
| Exact EV, final-table ICM, 1 / 2 / 4 threads | 91.5 / 49.2 / 31.8 | 82.8 / 42.4 / 31.3 | 0.90 / 0.86 / 0.99 |
| Exact gains, eight seats, final-table ICM, 4 threads | 52.3 | 46.1 | 0.88 |
| Exact gains, four-player bubble, 4 threads | 4,458 [1,760–4,945] | 2,236 [1,905–4,744] | (bimodal in both builds; not a supported difference) |
| Exact gains, six-player flop, 4 threads | 3,781 | 3,732 | 0.99 |
| Exact gains, eight-player short-stack all-ins, 4 threads | 44.2 | 47.9 | **1.08** |
| Exact range EV, three-player river | 1.8 | 1.8 | 1.00 |
| Sampled range EV, linked eight-seat, 4 / 1 threads | 32.6 / 31.9 | 32.2 / 28.0 | 0.99 / 0.88 |
| Sampled range EV, three-player flop, wide ranges | 1,075 | 1,057 | 0.98 |
| Sampled gains, linked eight-seat ICM | 7,858 | 6,724 | 0.86 |
| Samples completed in 3 s, 4 / 1 threads | 435,643 / 106,948 | 483,770 / 120,526 | 1.11× / 1.13× more |
| Cancellation latency | 2.2 | 4.1 | **1.89** (section 4) |
| Training, six-player flop, 20,000 updates | 141.6 | 152.5 | **1.08** (ranges overlap: 134–188 vs 146–165) |
| Training, linked eight-seat ICM, 300 updates | 180.9 | 156.7 | 0.87 |

Regressions in bold. The short-stack all-in and six-player-flop rows are chip-EV
workloads whose code did not change except for the coverage ledger; their ranges
overlap between builds and they were not investigated further.

Tried and not adopted: a larger ICM result cache (hit rate 44% → 70%, no time
gain in the measurement); AVX2 for the kernel (no expected gain on the measured
CPUs because the divider is the bottleneck).

---

## 9. Response-gain evaluation (Priority 9)

Unchanged: exact best response (tractable games), restricted best response
(first street), sampled one-decision deviation; every answer names its
`responseClass` and its limits; `exploitability` is printed only for two seats
with chip EV, otherwise `null` with the reason. Per-seat random streams,
statistical uncertainty and the multiple-comparison handling are those of 4.1–4.4.

Changed: coverage memory of the per-seat tables (sketches inside the pool).
Speed: sampled gains on the linked ICM study 14% faster through the ICM kernel.
Agreement across worker counts: all new tests compare 1 and 4 threads as bit
patterns.

Not done: a coverage ledger in the response-gain answer (the pool is enforced
and unit-tested, but only action-EV answers print `coverage.memory`).

---

## 10–11. Tournament mathematics and checkpoints

No rule, utility or format changed. Evidence that the ICM kernel change is
invisible: 240,000 bit-identical evaluations; the 4.2 reference bit patterns of
the eight-player ICM fixture (`402e0a51470d8f36`, `402f57218439052d` and the
eight gain patterns) still pass in every inherited test; the trained state of
the eight-seat linked ICM study has the SHA-256 the 4.4 build produces
(`aa80974199182afa…`), on Linux, under Wine and on the Windows runner.

Checkpoint recovery tests inherited from 3.6–4.4 (interrupted save, corrupted or
missing index, truncated file, failed restoration, incompatible import, worker
failure, GPU failure on the test double) are part of the suite and pass. New:
coverage-budget exhaustion and deadline-limited evaluation between training
runs (section 2).

---

## 12. Regression suite

@@TESTDETAIL@@

---

## 13. Windows and hardware validation

@@WINDOWS@@

---

## Remaining limitations

* **Not run on your PC or on any physical NVIDIA GPU.** GPU scheduling,
  VRAM enforcement, CPU/GPU parity, cold/warm GPU performance: untested in 4.5,
  as in 4.2–4.4. `validate_hardware.ps1` GPU branches have never executed.
* **No convergence improvement.** Strategies are those of 4.4.
* Full eight-player tournament equilibrium accuracy remains unverified; only
  small abstractions have exact measurements, and multiplayer NashConv is not
  exploitability. Eight-handed No-Limit Hold'em is not solved.
* +2 ms cancellation / short-deadline latency at the default coverage budget.
* Response-gain answers print no coverage ledger.
* Training does not scale with threads on small-batch linked studies.
* Complex multiway and linked studies remain expensive (minutes for exact
  responses with several hands per seat).
* JavaScript full-traversal checkpoint restoration keeps its 2 GiB ceiling.
* No single process-wide allocator budget; budgets are per component.
