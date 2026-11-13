# EightMax Windows 4.7

Release focus: measuring strategy quality honestly and independently, a variance-reduced
experimental trainer evaluated against the validated default, a working convergence dashboard,
checkpoint comparison and adaptive monitoring, lossless checkpoint compression, and an engine
inner-loop optimisation that changes no result.

**What has and has not run where**

| Environment | What ran | Status |
|---|---|---|
| Linux build machine (4 logical CPUs, 15 GiB, GCC 13.3, no GPU) | builds, full regression suite, reference suite, studies, benchmarks, sanitizers, cppcheck | done |
| Windows executables of this release under **Wine 9.0 (not Windows)** | `mwcli.exe --selftest47` through `Run 4.7 checks.bat` in Wine's `cmd` (10/10), golden training hash, EMZ1 resume, `--verify` (bit-identical to Linux), `--monitor`, `EightMax.exe --version` | done (section 10) |
| Windows PowerShell | not available here (installation was not permitted in this environment); `Run self-tests.bat` still runs the 4.6 PowerShell harness, unchanged | **pending on your PC** |
| Your PC (i7 13th gen, 24 logical processors, RTX 4060 Ti, 16 GB) | nothing in 4.7 | **pending** |
| Any physical NVIDIA GPU | nothing in 4.7 | **pending**; no CUDA code changed |

No GPU timing, VRAM figure or CUDA result in this document was measured by us.

## Summary

| Priority | Result |
|---|---|
| 1 Mathematical audit | Training engine re-derived (reach weights, opponent importance ratios, chance sampling with card removal, stochastically weighted averaging, linear/DCFR weights, RM+, worker aggregation, transactional commits). **No defect found in the engine.** A new independent reference suite (no shared code) reproduces Kuhn -1/18 and Leduc -0.0856 and confirms unbiasedness of every sampled estimator (section 1). The reference suite itself had a buffering bug during development, found by its own known-value checks and fixed (section 1). |
| 2 Variance reduction | New opt-in estimator **own-hand enumeration** (Rao-Blackwellisation of the updating seat's hand; also with the terminal baseline as a vector control variate). Proven unbiased (law of total expectation) and tested unbiased against the default (4,000 seeds, two games). Regret-increment variance 10-29% of the default's (section 2). |
| 2/3/14 Study | Ten seeds (201-210), six games, exact best responses, 216 Holm-adjusted comparisons. own-hands + baseline: **11 better / 0 worse at equal deals, 4 better / 0 worse at equal time**; own-hands: 10/0 and 2/1. Gains are concentrated in heads-up and three-player studies; no supported gain on the six-player flop; slower per second on the fixed-hand final table. **Default unchanged**; the new trainer is experimental and recommended only for small-range heads-up / short-handed postflop studies (section 3). |
| 3 CFR+/DCFR | Reference study (full-width and sampled, 10 seeds): CFR+ and DCFR are much better than vanilla CFR **full-width**, but **worse than the default when sampled** (RM+ 0 better / 7 worse, DCFR 0 / 5 at equal time). The 4.4-4.6 engine studies agree. No parameter change made (section 3). |
| 4 Verification engine | `mwcli --verify` (modes A exact, B restricted = lower bound, C sampled = estimate of a lower bound, D local action deviations with family-wise intervals), positions, stacks, stage, utility, relative gains, Bonferroni-simultaneous intervals, coverage. **Independent Python best response** (separate rules, evaluator, side pots) agrees with the engine's exact gains to about 1e-15 (section 4). |
| 5 Six-player postflop | Inherited multiway rules/invariant tests (v44-v46) pass; 4.7 adds exact gain cross-checks on heads-up and three-player rivers, study games up to six players, and the reference side-pot/ICM property tests (section 4). |
| 6 Dashboard | New **Quality** tab connected to the native host: 14 live tiles, 7 charts with intervals, checkpoint history with comparison, CSV/JSON export and import, adaptive nonblocking schedule. Tested end to end against the host and visually in Chromium (section 5). |
| 7 Checkpoint comparison | `mwcli --compare`: game-identity check (refuses different games, exit 3), counters, strategy hashes, canonical row overlap, total-variation distances, per-seat gain differences with the correct statistical statement for each class (section 6). |
| 8 Adaptive monitoring | `mwcli --monitor`: geometric schedule stretched so evaluation stays below a set share of training time, independent evaluation seeds, stops on updates / deals / time / memory / quality target (exact target = "certified inside the abstraction"; sampled target = alpha-spending rule, never called verification). Monitored training ends byte-identical to uninterrupted training (section 6). |
| 9 CPU | Profiled with callgrind. Betting states are read in place from the state store instead of copied. 42 studies byte-identical to 4.6; 9 interleaved rounds: **0.805x and 0.785x time** (supported) on six-player flop and ICM bubble with one thread, no supported difference elsewhere, never slower (section 7). |
| 10 Memory | Host reports peak resident memory (`/api/memory`); new code allocates scratch from the existing table budget; checkpoint restore from EMZ1 is streamed through a temporary file (+1.3 MiB peak on a 14 MiB state). No precision reduction (section 8). |
| 11 Checkpoints | **EMZ1** lossless compression: 45.5% of the size on the 14.2 MiB eight-player study; byte-exact round trips; resume from EMZ1 = uninterrupted (golden hash); CRC-32 per block + SHA-256; 300 fuzzed corruptions all refused. Same restore speed (not faster). EMMW4 unchanged (section 8). |
| 12 Tournament defaults | Unchanged: 0.5/1 blinds, 0.1 bb individual antes, 2.3 bb eight-player pot, optional BB ante; `tests/mtt.test.js` passes. |
| 13 Continuation | Golden state `aa809741...` unchanged; 4.6 continuation suite passes; new-option continuation 150+150 = 300 and thread-independence; EMZ1 resume; monitor resume (section 9). |
| 15 Regression | See section 11 (full counts). |
| 16 Windows | Built with MinGW-w64; Wine checks pass; physical Windows/GPU pending (section 10). |
| 17 Future formats | Review in `validation/4.7/ARCHITECTURE-REVIEW.md`; no engine change, reasons given. |

## 1. Mathematical audit and the independent reference suite (Priorities 1, 14)

**Engine audit (reading the code, `native/mw_es.hpp`, `mw_es_impl.hpp`, `mw.cpp`).** External sampling:
the updating seat enumerates its actions, every other seat samples from `q = 0.9 sigma + 0.1/k`;
opponent nodes return `sigma(a)/q(a) * v(child)`; the regret increment is
`t * (pi_-i / q_-i) * (v(a) - v)` and the average increment `t * pi_i * sigma(a) / q_-i`. Private hands
are drawn from the weighted ranges with rejection of card collisions and board cards uniformly from
the remaining deck, i.e. from the exact chance distribution, so chance needs no importance weight.
Expectation of the regret increment = `t * sum_{h in I} pi_c(h) pi_-i(h) (v(ha) - v(h))` (the
counterfactual regret); expectation of the average increment is proportional to `pi_i(I) sigma(I,a)`
with an iteration-independent constant, so the average strategy is correct. DCFR: lazy per-row
discounting by exact prefix-product ratios is equivalent to eager discounting (4.3 test kept);
average weight t^gamma. RM+ clips after each committed traversal. Increments are buffered per traversal
and merged in deal order (thread-independent), and an update is committed transactionally. The
terminal baseline and terminal expectation estimators are unbiased (exact terminal contributions plus an
importance-weighted residual). **No defect found.**

**Independent reference (`source/reference`, `refsuite`, no shared code, explicit trees):** Kuhn
(2 and 3 players), Leduc, three-player push/fold with side pots in chip EV and Malmuth-Harville ICM,
and a weighted-range game with card removal. Exact values, reach probabilities, counterfactual regrets,
exact unilateral best responses and NashConv; vanilla CFR, CFR+, LCFR, DCFR, and external-sampling
MCCFR with the engine's estimator and the 4.7 candidates.

* `refsuite selftest`: **28/28** (`validation/4.7/reference/ref-selftest.json`): the analytic Kuhn
  equilibrium family has value -1/18 and NashConv 0; CFR+ on Leduc reaches -0.08559 (published -0.0856);
  chip conservation at every terminal; 20,000 random 2-6 player side-pot showdowns conserve chips;
  three-player ICM equals the closed form; 2,000 random ICM tables with busts conserve the prize pool;
  best response >= policy value on 120 random profiles; ES-MCCFR is deterministic per seed.
* **A defect in the reference itself during development:** its first CFR updated regrets in the middle of a
  traversal (other histories of the same information set then saw a changed policy, and RM+ clipped per
  history). The Leduc known-value checks failed (NashConv 0.10 after 1,000 CFR+ iterations); after
  buffering per traversal they pass (5e-4). The engine buffers correctly (checked in the audit above).
* `refsuite unbiased`: for a fixed random profile, the mean of N independent sampled increments of every
  (information set, action) component is compared with its exact expectation (z test, Bonferroni,
  family-wise 0.001). **All 25 estimator x game families pass at N = 200,000 and 1,000,000.** At N =
  40,000 one family (Leduc, on-policy sampling) failed on a component with only 170 non-zero
  observations, where the normal approximation does not hold; components with fewer than 100 non-zero
  observations are now reported as sparse and excluded from the z test, and the test uses N = 200,000.

## 2. Variance reduction: own-hand enumeration (Priority 2)

Candidates evaluated: Latin-hypercube chance sampling and opponent exploration (4.5/4.6: no supported
effect), terminal baseline and terminal expectation (4.4-4.6: none), and the new **own-hand
enumeration**: for each sampled deal and updating seat, the traversal carries a vector over every
hand of the seat's range compatible with the sampled opponents' hands and board, weighted
`w(h) / sum w`. Opponent decisions are sampled once and shared (an opponent's information never
depends on the updating seat's hand). Mathematical justification: the deal is drawn by the unchanged
sampler, so `(h_-p, board)` has its usual marginal, and the increment equals
`E[default increment | h_-p, board]` - the same expectation, lower variance (Rao-Blackwell). The
terminal baseline is also implemented in vector form. Option `"ownHandEnumeration": true`
(spec protocol 4); part of `studyId`; refused with grouped keys, turn/river groups, stratified or Latin
sampling and terminal expectation.

Evidence of unbiasedness in the **engine** (`tools/unbiased47.js`, `validation/4.7/unbiased`): one update
from the uniform profile with 4,000 independent seeds per estimator; every component of seat 0's
regrets and average increments compared with the default estimator (Welch z, Bonferroni over 240-256
comparisons, family-wise 0.001):

| Game | Estimator | max abs z (critical) | regret variance / default |
|---|---|---|---|
| heads-up river, weighted ranges | own hands | 2.58 (4.69) | 0.155 |
| | own hands + baseline | 2.78 (4.69) | 0.099 |
| | baseline | 1.99 (4.69) | 0.675 |
| three-player river, side pots | own hands | 1.74 (4.70) | 0.286 |
| | own hands + baseline | 1.74 (4.70) | 0.259 |
| | baseline | 0.56 (4.70) | 0.910 |

The reference suite shows the same on explicit trees (variance 14-32% of the default's). With one hand
per seat the option reproduces the default trainer's gains (tested). Deterministic continuation and
thread independence hold (tested; continuation suite 24/24 relevant checks, section 9).

## 3. Convergence studies (Priorities 2, 3, 14)

**Engine study** (`tools/convergence47.js`, `validation/4.7/convergence`): the 4.4-4.6 games and method
(heads-up river and turn+river with exact exploitability; three-player river with side pots; four-player
bubble ICM with weighted ranges; six-player flop with 3-50 bb stacks; eight-player final-table ICM),
**new seeds 201-210**, exact best response of every seat after each checkpoint (independent of training),
512 MiB table budget for every variant, 2 training threads, paired comparisons of log NashConv at equal
sampled deals and at equal training time, **Holm over all 216 comparisons**.

| Variant | Equal deals: better / worse / n.s. | Equal time: better / worse / n.s. |
|---|---|---|
| own hands | 10 / 0 / 26 | 2 / **1** / 33 |
| own hands + baseline | **11 / 0 / 25** | **4 / 0 / 32** |
| baseline (control) | 0 / 0 / 36 | 0 / 0 / 36 |

Geometric-mean NashConv ratio to the default at the largest checkpoint (equal deals / equal time):
heads-up river 0.50 / 0.78, heads-up turn 0.60 / 0.77, three-player river 0.72 / 0.86, bubble 0.20 / 0.57,
six-player flop 1.14 / 1.76, final table 0.25 / 0.90 (own hands + baseline). The cost per deal is about 2x.
Supported equal-time gains occur at early checkpoints of the heads-up games and the six-player flop;
own hands alone is significantly **slower per second** on the fixed-hand final table (one hand per seat:
nothing to enumerate, only overhead). **Conclusion: better strategy quality per sampled deal is
established; better quality per second is established only in some situations and is not
consistent, so the validated default is kept.** The option is offered as experimental, recommended for
heads-up and short-handed postflop studies with small ranges, where it never lost.

**Reference study** (`refsuite study`, 10 seeds, Kuhn 2/3, Leduc, three-player ICM, weighted ranges, 180
Holm-adjusted comparisons): own enumeration + baseline 4 better / 0 worse at equal iterations, 2 / 0 at
equal time; own enumeration 2 / 0 and 1 / 0; terminal baseline and exploration 0.05: 0 / 0; **RM+ 0 / 7 and
DCFR(1.5, 0, 2) 0 / 5 worse at equal time**. Full-width (`refsuite fullwidth`): CFR+ and DCFR reach
NashConv 30-300x below vanilla CFR in 3,000 iterations, i.e. their advantage is a full-width phenomenon
that does not carry over to external sampling here - consistent with the 4.4-4.6 engine studies (RM+ and
DCFR never better). CFR+ averaging delay 50 was marginally better than 0 full-width; not applicable to the
sampled default. **No CFR+/DCFR parameter or schedule change is made.** Multiplayer note: for three or more
players or ICM, CFR has no convergence guarantee to Nash equilibrium; NashConv is reported as a
measurement, not as distance to an equilibrium.

## 4. Strategy verification (Priorities 4, 5)

`mwcli --verify spec state [method=auto|exact|restricted|sampled] ...` reports per seat the position
(UTG ... BB at preflop roots), stack, policy value, best deviation value, absolute gain, relative gain
(percent of the starting pot for chip EV; of the seat's ICM equity for ICM), engine 95% interval and a
Bonferroni-simultaneous interval over seats (sampled), coverage (policy and fallback lookups, exact
counts), restrictions, and the class of the result:

* **A exact** - exact unilateral best response inside the abstraction; NashConv = sum; exploitability
  only for two-player chip EV;
* **B restricted** - a lower bound on the gain; the sum is a lower bound on NashConv;
* **C sampled** - a one-decision deviation selected and evaluated on independent streams: an estimate of
  a lower bound (it can be negative from noise; intervals are reported);
* **D local deviations** - `node=` and `board=`: every legal action of one decision for every hand of the
  range, with the engine's simultaneous family-wise comparisons (`multipleComparisons`).

`auto` tries A, then B, then C and records every attempt. Restricted and sampled results are never
labelled exploitability. Statistical note: sampled evaluations use a fixed sample size; a deadline-stopped
evaluation is reported as partial by the engine and its interval uses the samples actually taken.

**Independent cross-check** (`tools/independent_br47.py`): rebuilds the river betting tree from the spec
rules (pot-fraction, all-in, absolute and raise-multiple sizes, minimum raises, caps, short all-in calls),
ranks hands with its own evaluator, settles side pots itself, reads the average strategy from the EMMW4
file and enumerates every compatible weighted deal. Policy values, best-response values and gains agree
with `mwcli --gain` to **1.3e-15** (heads-up river, weighted ranges), **4.4e-16** (three-player river,
side pots) and on an own-hand-enumeration study; every stored row is used.

## 5. Convergence dashboard (Priority 6)

`web/lib_dashboard.js`, tab **Quality**. Studies: the six study games or a pasted native spec; trainer:
default or the experimental options; evaluation auto/exact/restricted/sampled/none; workers, table
budget, samples, seed, first evaluation, growth, maximum evaluation share; stops: updates, seconds,
NashConv target. Training runs in the host's own thread; the page polls `/api/mw/status` every 250 ms
and renders at most twice a second; evaluations run between segments. Tiles: updates, deals, training
time, throughput, algorithm (validated/experimental), workers, current and peak memory, information sets
and betting states (exact), fallback share (exact counts), strategy change, NashConv with interval and
class, samples, strategy hash, trend. Charts (one y-axis each, validated colours, hover values):
1 quality vs deals with intervals and imported runs overlaid, 2 gain per seat, 3 strategy stability,
4 throughput, 5 resident memory current/peak, 6a stored rows (exact), 6b fallback share (exact).
History table with strategy hashes, evaluation class and intervals; pick two rows for a measurement
comparison (exact differences, or Bonferroni intervals for sampled, no ordering for lower bounds).
Export JSON (`eightmax-analytics/1`, the same schema as `mwcli --monitor`) and CSV; import JSON files.

Tests: the live controller against the native host (real measurements; final host state equals
uninterrupted `mwcli` training byte for byte; same exact NashConv as `mwcli --verify`; user
cancellation); the JS analytics equal the native ones bit for bit (parse, strategy hash, distances, game
hash, `%.17g` formatting); rendered in Chromium against the host with no console errors.

## 6. Checkpoint comparison and adaptive monitoring (Priorities 7, 8)

`mwcli --compare specA stateA stateB [specB=] [gains=] [csv=]`: compares only when the game fields
(`protocol, algorithm, n, board, anteOf, hands, rules, icm, groupKeys, turnGroups, riverGroups,
abstraction`) are equal and each checkpoint belongs to its spec's study (otherwise exit 3 with the
differing fields and no statistics). Trainer settings and seeds may differ and are listed. Reports
counters, file and strategy hashes, canonical row overlap (Jaccard), total-variation distances of the
normalised average strategies (mean, mass-weighted, max with the row, per seat, union with the uniform
fallback, current strategies), memory (restore estimate), and both checkpoints' gains on independent
evaluation streams with per-seat differences. Exact: exact differences; sampled: Bonferroni intervals of
the difference; restricted: no ordering inferred. "A later checkpoint is not automatically better."

`mwcli --monitor spec dir [...]`: see the summary table; `analytics.json`, `analytics.csv`, checkpoints
(`keep=last|all`), descriptive log-log trend. Evaluation k uses seed `evalSeed + 7919k`; evaluations only
read the strategy. Tested: final checkpoint = uninterrupted training; resume from a monitor checkpoint =
uninterrupted; exact target stops certified; sampled target stops uncertified with the alpha-spending
statement; elapsed-time stop keeps exactly the committed updates.

## 7. CPU (Priority 9)

callgrind profiles (`validation/4.7/profile`): six-player flop - traversal 20%, betting-state copies in
`descend` 12%, side-pot layout 7%; eight-player ICM - `Tournament::evaluate` 40% (already cached and
SSE2-paired since 3.8/4.5). Change: the traversal references betting states held in the read-only state
store instead of copying them (about 430 bytes per visited state). Values read are the same objects, so
results are bit-identical: **42 checks** (21 studies: five games x default, grouped keys, DCFR, both
terminal estimators, RM+, plus the golden study; 1 and 4 threads; 3,000 updates) produce the same state
bytes as 4.6.

`tools/bench47.js` (`validation/4.7/bench`), 9 interleaved rounds, state files identical in every round:

| Workload | 1 thread: 4.7/4.6 time [95%] | 4 threads |
|---|---|---|
| six-player flop, chip EV | **0.805 [0.669, 0.970]** | 0.919 [0.841, 1.004] |
| three-player river | 1.047 [0.908, 1.207] | 0.961 [0.862, 1.071] |
| heads-up turn + river | 1.016 [0.829, 1.246] | 0.936 [0.810, 1.082] |
| four-player bubble, ICM | **0.785 [0.664, 0.927]** | 0.905 [0.749, 1.093] |
| eight-player linked ICM study | 1.023 [0.876, 1.194] | 0.979 [0.889, 1.078] |

Supported speed-ups on 2 of 10 combinations, no supported slowdown. Runs are short (0.15-0.4 s), so
intervals are wide; no general speed-up is claimed. The ICM kernel was not changed further (largest
remaining hotspot; a rewrite would need new bit-identity evidence).

## 8. Memory and checkpoints (Priorities 10, 11)

EMZ1 (`native/emz.hpp`): blocks of at most about 8 MiB, deflate (zlib), per-block CRC-32, length and
SHA-256 of the whole EMMW4 file in the end block; row blocks stored in original order or with
byte-shuffled values, whichever is smaller (the shuffle alone was measured to be **worse** than plain
deflate on the golden state, 0.50 vs 0.43, so it is never forced). `tools/checkpoint47.js`:

| Study | EMMW4 | EMZ1 | ratio | restore raw / EMZ1 | restore peak RSS raw / EMZ1 |
|---|---|---|---|---|---|
| eight-player linked ICM, 3,000 updates | 14.19 MiB | 6.46 MiB | 0.455 | 0.576 / 0.600 s | 54.8 / 56.1 MiB |
| six-player flop, two streets | 2.63 MiB | 1.13 MiB | 0.430 | 0.034 / 0.072 s | 21.6 / 21.6 MiB |
| heads-up turn+river, DCFR | 0.48 MiB | 0.35 MiB | 0.742 | 0.007 / 0.017 s | 24.2 / 24.2 MiB |
| heads-up river, Compact groups | small | | 0.836 | | |

All round trips byte-exact; resumes from raw and from EMZ1 equal uninterrupted training. Compression is a
size improvement only; loading is not faster. Memory: no numeric precision was reduced anywhere. New 4.7
scratch (vector traversal frames, state pointers) is allocated from the existing training scratch budget;
`/api/memory` adds `peakResidentMiB`. The 4.6 statement stands: the ledger governs the large allocations,
**not** all resident memory.

## 9. Determinism and continuation (Priorities 12, 13)

Golden state `aa809741...` (300 updates, eight-player linked ICM) unchanged, also under Wine and when
resumed from an EMZ1 checkpoint. The inherited 4.6 continuation suite (150+150, 500+500, 1000+1000,
generations, re-saves, 1/8 threads, three interrupted-save faults, cancellation, missing/truncated inputs)
is part of the regression run. With own-hand enumeration (three-player river): 25/25; four-player
bubble: 24/25 - the failing check is the suite's built-in evaluation request, hard-coded with hand
indices of the 4.5 eight-player study, and the 4.6 binary fails it identically on that spec.

## 10. Windows (Priority 16)

Built with MinGW-w64 (GCC, posix threads, static zlib); the build id of every executable equals the
source fingerprint. Under **Wine 9.0** (not Windows): `Run 4.7 checks.bat` in Wine's `cmd` - 10/10
(`--selftest47`: golden hash, EMZ1 round trip / resume / corruption, own-hand continuation, verify exact
and sampled, compare, monitor); `--verify` result bit-identical to Linux; `EightMax.exe --version`.
`Run self-tests.bat` runs the 4.6 PowerShell harness (unchanged) and then the 4.7 checks.
**Pending on your PC:** `Run self-tests.bat` and `Validate CUDA hardware.bat`; keep
`Windows-self-test.json`, `EightMax-4.7-self-test.json`, `hardware-validation.json`, `device-results.json`.

## 11. Regression and safety (Priority 15)

See `validation/4.7/regression-tests.json` and section "Test counts" in `validation/4.7/README.md`.

## Remaining limitations

* No physical Windows or GPU run; PowerShell scripts unchanged and not executed by us.
* The experimental trainer is not consistently better per second; the default is unchanged.
* No method here verifies a Nash equilibrium of unrestricted eight-player No-Limit Hold'em; multiplayer
  and ICM NashConv values are measurements inside the abstraction.
* Speed-ups are small and workload-dependent; the ICM kernel remains the main cost of ICM training.
* EMZ1 saves disk space, not loading time; the desktop host's own `.emstudy` archive format is unchanged
  (EMZ1 is supported by mwcli).
