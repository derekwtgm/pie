# EightMax 5.9: final development report

Build `00600c81455ead44`, successor of 5.8 (build `d4001e2c0cd77f41`). Windows x64 package:
`EightMax-Windows-5.9.zip`; its SHA-256 is in `EightMax-Windows-5.9.identity.json`, delivered beside it (the archive's
hash cannot be inside the archive).

This report separates what was **verified** (with where the evidence is) from what is an **estimate** or a
**development objective that was not reached**. Classes as in 5.8: **1** independently mathematically validated;
**2** tested on Linux, under Wine or by simulation; **3** implemented, awaiting physical Windows / GPU validation;
**4** unsuccessful, incomplete, not implemented or not executed.

## 0. The short version

| Objective of the 5.9 brief | Outcome |
|---|---|
| 1. Correct and strengthen statistical confidence reporting | **Done.** A simultaneous distribution-free lower bound with a proof; per-seat one-sided bounds; a pooled alternative; explicit field names; the 5.8 field kept and deprecated. Class 1 (proofs, exact coverage, independent implementation) and 2 (0 violations in 3,240 runs against exact values). |
| 2. Trained-response evaluation speed | **Done for the evaluation, not for the response training.** Evaluation walk 1.06 to 2.36 times faster with identical bits; total analysis wall time changed by -2% to -52% at one thread, same request (seven cases); the 20% target is met on 3 of 7 cases (three-player flop fixture; three-player preflop fixture; four-player turn). Response training speed is unchanged. |
| 3. Strategy-table memory performance | **Partly.** A per-call offset index removes two of four dependent memory reads in the EVALUATION (adopted). A prefetch in the TRAINER's lookup gave no gain and was rejected; a real change there needs a format-level change and was not made. Default training throughput is unchanged. |
| 4. Convergence | **Investigated; nothing promoted.** Three optional trainers tested against the default under a prespecified rule: two are worse, one is unresolved and slower per deal. No new estimator was implemented. **5.9 does not converge faster than 5.8; six-player flop convergence is not improved.** |
| 5. Evaluation random streams | **Done.** Counter-based streams with a proven partition; the 5.8 streams selectable and bit-identical. The TRAINING generator was not changed (class 4 for that item). |
| 6. Rejected-study cleanup | **Done.** Nine checks including existing folders, existing checkpoints, concurrent requests and a failed removal. |
| Windows release engineering | **Built, packaged, tested under Wine; not run on Windows.** The validation script was executed by PowerShell 7.4 on Linux for the first time in this project's history; it was not executed on Windows. Class 3. |
| CUDA | **No CUDA code changed; nothing executed on a GPU.** Class 3. |

## 1. Baseline verification (Phase 1)

Verified before any change (`validation/5.9/baseline/baseline-5.8.json`):

* ZIP CRC of all 4,922 members; archive SHA-256 `2c80ca33...6b41` as expected; all 4,921 manifest entries.
* Version 5.8, build `d4001e2c0cd77f41` in `BUILD-INFO.json` and embedded in the three executables; executable
  hashes equal the identity file.
* The unmodified source rebuilt with the 5.8 toolchain (MinGW-w64 GCC 13 posix, GCC 13.3) gives the three Windows
  executables, the three Linux programs and the interface **byte for byte**.
* Regression suite of the rebuild: 621 tests, 620 passed, 0 failed, 1 skipped - the totals 5.8 reported.
* Self-tests of the rebuild: 33 of 33 (5.8), 24 of 24 (5.7.1), 28 of 28 (5.7).
* No physical Windows or GPU evidence exists for 5.8; earlier physical evidence concerns 5.7 and is not counted for
  5.8 or 5.9.

An untouched extraction of the 5.8 archive was kept read-only and its `mwcli` was the reference of every comparison.

## 2. Statistical confidence reporting (Phase 2; the primary objective)

**Audit.** `response58.hpp` computed, per seat, a normal interval, a two-sided distribution-free interval and two
floored lower bounds; `mwcli_response58.hpp` summed the per-seat one-sided NORMAL bounds into
`sumOfSeatLowerBounds95`. The arithmetic was right and the prose beside it said it was not a 95% statement, but (a)
the terms were normal-approximation bounds, which fail under rare actions, and (b) no field was a confidence
statement about the multiplayer total.

**Implemented** (`response_stats59.hpp`, `response59.hpp`, `mwcli_response59.hpp`):

* per seat, a ONE-SIDED empirical-Bernstein lower bound (Maurer-Pontil 2009, Theorem 4) at the seat's share of the
  family level (`seats[i].sampled.lowerBound`);
* `summary.simultaneous`: error budget `alpha / analyses / seats` per seat, union bound, no independence between
  seats; a lower bound of the sum of response gains and - with the floor at 0 applied seat by seat - of NashConv;
  explicit confidence, allocation, family, assumptions, units, sample counts, calibration flag and reason;
* `summary.pooledIndependent`: Bernstein over independent seats with variance bounds, simultaneous over all subsets
  of seats (so a seat whose response loses can be left out legitimately); labelled as assuming independence;
* negative gains, incomplete evaluations (trivial bound 0; never a shortened sample), subsets of seats, chip EV and
  ICM units, and `analyses` for prespecified multiple analyses are handled explicitly;
* `evaluationSeed` separates the evaluation deals from the response training, so a fixed response can be evaluated
  repeatedly on independent deals;
* the 5.8 field keeps its value and meaning, is also written as `sumOfNormalApproximationLowerBounds95`, and is
  deprecated with a migration path. No legacy field changed its meaning silently.

**Validation.** Proofs: MATHEMATICAL-VALIDATION-5.9.md, section 2. Exact coverage on two-point distributions (117
cases, binomial sums): the new bound never misses above its level; the 5.8 normal bound misses with probability 0.815
where a small value has probability 1e-6. Against exact values: the 5.8 limitation reproduced with the unchanged 5.8
program (193 of 960 estimates beyond four standard errors); 0 of 15,920 seat bounds, 0 of 3,240 simultaneous
statements and 0 pooled statements above the truth; every printed bound equal to an independent Python recomputation.

**What it costs.** The certified amount is smaller than the estimate: a median 49% (simultaneous) and 67% (pooled) of
exact NashConv at 51,200 evaluation deals on the reference games, and nothing on the five games whose NashConv is a
few hundredths of a unit or less. This is inherent in a distribution-free statement (section 2.5 of the mathematical
report) and is answered by more evaluation deals, which the faster evaluation makes affordable.

## 3. Trained-response evaluation speed (Phase 3)

**Profile** (`perf`, three-player flop fixture, 5.8): with equal budgets the EVALUATION dominates, not the response
training (3.8 s against 156 s for 200,000 response deals and 204,800 evaluation deals), and 82% of the evaluation
walk is four dependent memory reads per strategy lookup (hash key, row number, row record, values). Coverage
accounting and a second lookup of the same row at the responding seat's decisions add to it.

**Implemented** (all with identical results):

* `pairValue59`: the strategy key once per deal and street; one row lookup for both profiles of the responding seat;
  no coverage accounting (the response result never printed it);
* `SlotIndex59`: one 32-bit value offset per hash slot, built per evaluation call, charged to the evaluation memory
  budget (4 bytes per slot; skipped above a quarter of the budget): a lookup waits for two reads instead of four;
  with enumerated opponent actions the children's index lines are fetched ahead;
* evaluation threads default to every logical processor (5.8: one), divided among seats handled side by side;
* the state file is loaded once per seat instead of once more than that.

**Not done:** sharing the frozen opponents' tables between seats (the response problem rewrites the table in place;
each seat still holds a private copy), a faster response TRAINING (it is the 5.8 trainer: one thread per seat with
one deal per update), a compact frozen-policy format.

**Measured** (PERFORMANCE-5.9.md; 4-processor development container; alternating runs; the same numbers from both
programs, checked bit for bit):

| Case | Seats | Evaluation speed-up | Response training 5.9 / 5.8 | Total wall time | Same numbers |
|---|---|---|---|---|---|
| three-player flop fixture | 3 | x2.05 | 0.92 | -47% | yes |
| six-player flop fixture | 6 | x1.28 | 0.99 | -7% | yes |
| three-player preflop fixture | 3 | x2.36 | 1.05 | -52% | yes |
| eight-handed ICM fixture | 3 | x1.22 | 1.01 | -2% | yes |
| four-player turn | 4 | x1.51 | 0.92 | -30% | yes |
| five-player flop | 5 | x1.25 | 1.12 | -15% | yes |
| eight-handed ICM final table | 8 | x1.06 | 1.00 | -5% | yes |

The 20% target for total wall time is met on 3 of 7 cases (three-player flop fixture; three-player preflop fixture; four-player turn) and not on the others, where the unchanged response
training dominates. By default (all processors, 5.9 streams) the same analyses take 0.20 to 0.93 of the 5.8
wall time on four processors; on the 24 logical processors of the target PC the evaluation should scale further, which
is unmeasured (class 3).

## 4. Strategy-table memory performance (Phase 4)

* **Adopted (evaluation):** the offset index above. First-level data-cache misses of the evaluation walk
  (cachegrind): three-player flop fixture: 31,879,414 (5.8 walk) to 26,275,527 (18% fewer); six-player flop fixture: 20,435,903 (5.8 walk) to 16,883,113 (17% fewer).
* **Rejected (trainer):** a prefetch of the row-number slot beside the key slot in `MW::findRow`. Prespecified rule
  (3% on two of three large fixtures): not met on any; differences inside the run-to-run spread; states identical.
  Removed from the source (`validation/5.9/experiments/prefetch-row-slot.md`).
* **Not attempted:** a new table layout for the trainer (interleaved key/offset slots, hot/cold separation). It would
  change the memory accounting and with it the point at which a table limit is reached - a format-level change that
  needs its own release and compatibility plan. The 5.8 conclusion stands.
* Default training throughput: 5.9 / 5.8 seconds 0.958 to 1.012 over 7 cases (one deal per update on four fixtures; 64 deals per update with 1, 2 and 4 threads). States byte-identical in every run.

## 5. Convergence (Phase 5)

CONVERGENCE-5.9.md. In one paragraph: the 5.9 default trainer writes the states of 5.8 (56 of 56 byte-identical; the
golden states of 5.5 and 5.7.1 in the regression suite); discounted CFR and regret matching+ are significantly worse
than the default in 27 of 28 corrected comparisons on seven games with exact NashConv; the terminal-baseline
estimator is not distinguishable from the default (0 of 14 corrected comparisons resolved) and costs a median 45%
more time per deal; on the six-player flop fixture both certify a NashConv of at least 0.75 to 1.17 BB after 250,000
deals. **Nothing was promoted and no new estimator was implemented.**

## 6. Evaluation random streams (Phase 6)

MATHEMATICAL-VALIDATION-5.9.md, section 5. Philox4x64-10 with the address (seed; seat, block, purpose, position) as
its counter: a proven partition within a seed (the generator is a bijection of its counter; the inverse is executed
in the self-test), known-answer vectors, numpy and a big-integer Python implementation agreeing, the engine's streams
dumped (`mwcli --streams59`) and compared. The sampling method is versioned in every result; the 5.8 method is
selectable and reproduces 5.8 on 960 estimates and every reference. Statistical independence remains the generator's
empirical property and is stated as an assumption. The 32-bit TRAINING generator is unchanged, with the limitation
5.8 documented.

## 7. Rejected-study cleanup (Phase 7)

`native/study_jobs.h`. The folder is created only after the host's own refusals (another study running, an existing
checkpoint), under the study mutex, and the host remembers what the request created. When the study ends with an
error - or the request cannot be stored, or the thread cannot be started - `study_undo_refused` removes
`request.json` if this request created it and the folder if this request created it and it is empty; it does nothing
at all if a manifest exists, and nothing in a folder it created that holds anything unexpected. It never recurses.
`/api/study/status` reports `refusedStudyFolder` (`removed` / `kept: reason` / null); the refusal message is unchanged.

`tools/host_refusal59.js`, nine checks, all passed on Linux and 9 of 9 as `EightMax.exe` under Wine: an over-limit budget (refused in
milliseconds, no folder); invalid configurations; a pre-existing folder with a user's file (kept byte for byte, the
host's own request removed); a pre-existing folder with only a request (untouched); an existing checkpoint (409, no
file changed); eight simultaneous over-limit requests (nothing left); refused requests during a running study (its
folder untouched, it completes); a simulated removal failure (reported, files kept, message unchanged); an ordinary
study afterwards (complete, listed, discardable).

Not done: removing folders that 5.8 left behind on a user's disk (they pre-exist, so the rule is to leave them).

## 8. Tests and validation (Phase 8)

VALIDATION-5.9.md lists every test with failed, skipped and unavailable checks. Totals:

| Test | Result | Class | Evidence (under `validation/5.9/` unless a full path is given) |
|---|---|---|---|
| Baseline: the 5.8 archive, manifest, executables, byte-identical rebuild | all verified | 1 | `validation/5.9/baseline/` |
| Baseline: regression suite of the rebuilt 5.8 | 621 tests: 620 passed, 0 failed, 1 skipped | 2 | `baseline/regression-of-rebuilt-5.8.tap.gz` |
| Regression suite of the final 5.9 build (Linux) | 637 tests: 636 passed, 0 failed, 1 skipped | 2 | `tests/full-regression.tap` |
| Self-test 5.9 (`mwcli --selftest59`), Linux | 32 passed, 0 failed, 0 untested | 2 (its exact and independent references: 1) | `selftest/selftest59-linux.json` |
| Self-test 5.8, Linux | 33 passed, 0 failed, 0 untested | 2 | `selftest/selftest58-linux.json` |
| Self-test 5.7.1 (checkpoints, memory budget), Linux | 24 passed, 0 failed, 0 untested | 2 | `selftest/selftest571-linux.json` |
| Self-test 5.7, Linux | 28 passed, 0 failed, 0 untested | 2 | `selftest/selftest57-linux.json` |
| Independent Python implementation (generator, streams, bounds, exact coverage) | 5 checks, 0 not passed | 1 | `independent/` |
| Statistics against exact values (prespecified) | 3,360 runs, 0 failed runs; 0 distribution-free statements violated | 1 / 2 | `statistics/` |
| Training identity against the unchanged 5.8 binary (prespecified) | 56 of 56 states byte-identical | 1 | `convergence/identity/` |
| Training identity, trainer options, thread counts, hand groups, table limits (`identity57.py` against 5.8) | 225 cases, 0 failures, 1782 training runs | 1 | `identity/` |
| Mutation check of the 5.9 self-test | 15 mutants, 15 detected; control clean: True | 2 | `mutation59.json` |
| Desktop host, refused studies (`host_refusal59.js`), Linux | 9 of 9 checks passed | 2 | `host-refusal59.json` |
| Desktop interface in a browser (Chromium, Playwright) | 20 of 20 checks passed | 2 | `ui/` |
| Stability (pause/resume cycles, long training, cancellation; 3 minutes) | passed: True; 12 checks, 0 not passed | 2 | `stability/` |
| AddressSanitizer + UndefinedBehaviorSanitizer: self-tests 5.9 and 5.8, 5.9 response / stream / host tests | self-test 5.9: 32 passed, 0 failed, 0 untested; self-test 5.8: 33 passed, 0 failed, 0 untested; tests: 12 tests: 12 passed, 0 failed, 0 skipped; sanitizer reports (ERROR: AddressSanitizer / runtime error) in all outputs: 0 | 2 | `sanitizers/` |
| ThreadSanitizer: parallel seats, evaluation threads, frozen batches, both stream kinds | ThreadSanitizer warnings: 0; response bits of the instrumented program equal the release program: 5.9 streams True 5.8 streams True (6 seats) | 2 | `sanitizers/tsan.log` |
| LeakSanitizer: complete response, unfinished evaluation, refused study | leak check: --response with parallel seats exit 0 (0 expected), evaluation that cannot finish exit 0 (0 expected), refused over-limit study exit 1 (1 expected); LeakSanitizer reports: 0 | 2 | `sanitizers/leak-*.log` |
| Windows executables under Wine: self-test 5.9 | 32 passed, 0 failed, 0 untested | 2 | `wine/selftest59-wine.json` |
| Windows executables under Wine: self-test 5.8 | 33 passed, 0 failed, 0 untested | 2 | `wine/selftest58-wine.json` |
| Windows executables under Wine: self-test 5.7.1 | 24 passed, 0 failed, 0 untested | 2 | `wine/selftest571-wine.json` |
| Windows executables under Wine: self-test 5.7 | 28 passed, 0 failed, 0 untested | 2 | `wine/selftest57-wine.json` |
| Windows executables under Wine: reference responses (5.9 and 5.8 streams) | 14 cases, all identical: True | 2 | `wine/reference-responses-wine.json` |
| Windows executables under Wine: independent implementation against `mwcli.exe` | exit 0 | 2 | `wine/independent-stats-wine.json` |
| Windows executables under Wine: desktop host, refused studies | 9 of 9 checks passed | 2 | `wine/host-refusal-wine.json` |
| Windows executables under Wine: 5.9 regression file | 16 tests: 16 passed, 0 failed, 0 skipped | 2 | `wine/v59.test.tap` |
| Windows executables under Wine: 5.8 regression file | 15 tests: 15 passed, 0 failed, 0 skipped | 2 | `wine/v58.test.tap` |
| PowerShell parser on every `.ps1` of the release | test_devices.ps1: 0 parse errors, 901 tokens; test_large_checkpoint.ps1: 0 parse errors, 517 tokens; test_windows.ps1: 0 parse errors, 11554 tokens; validate_hardware.ps1: 0 parse errors, 9180 tokens; validate_windows56.ps1: 0 parse errors, 4945 tokens; validate_windows57.ps1: 0 parse errors, 8671 tokens; validate_windows571.ps1: 0 parse errors, 9591 tokens; validate_windows58.ps1: 0 parse errors, 10900 tokens; validate_windows59.ps1: 0 parse errors, 13516 tokens | 2 | `powershell/parser.txt` |
| `validate_windows59.ps1 -Focused`, PowerShell 7.4.6, Linux programs | 94 passed, 0 failed, 1 skipped, 0 untested (2 information rows); script ran to its end: True | 2 (the script's logic; not Windows) | `powershell/Windows-focused-validation-5.9.json` |
| `validate_windows59.ps1` (all sections), same | 187 passed, 0 failed, 2 skipped, 0 untested (24 information rows); script ran to its end: True | 2 (the script's logic; not Windows) | `powershell/Windows-validation-5.9.json` |
| Native Windows: the executables, the launchers, Windows PowerShell 5.1 | **NOT EXECUTED** | 3 | `WINDOWS-TESTS-5.9.md` |
| GitHub Actions Windows workflow | **NOT EXECUTED** (updated and statically checked only) | 3 | `.github/workflows/windows.yml` |
| NVIDIA CUDA: every GPU path | **NOT EXECUTED** (no CUDA code changed) | 3 | `WINDOWS-TESTS-5.9.md` |

## 9. Windows release engineering (Phase 9)

* `EightMax.exe`, `mwcli.exe`, `gpustress.exe`: cross-compiled with the 5.8 toolchain, static runtime, importing
  only system DLLs; build id `00600c81455ead44` embedded; `verify_build.js` confirms executables, interface and source.
  (The cross-compile caught one portability defect during development - a helper named `near`, a macro of the Windows
  headers - before any release build existed.)
* `validate_windows59.ps1` (17 sections), `Run 5.9 focused validation.bat`, `Run 5.9 Windows validation.bat`,
  `Run 5.9 response example.bat`; machine-readable JSON and text reports; passed / failed / skipped / untested kept
  apart; mandatory failures propagate; a missing report is a failure (launchers and workflow).
* **For the first time the validation script was executed before release**: PowerShell 7.4 (installed through the
  .NET SDK) on Linux, against the Linux programs under Windows names: focused mode 94 passed, 0 failed, 1 skipped, 0 untested (2 information rows); script ran to its end: True; all sections 187 passed, 0 failed, 2 skipped, 0 untested (24 information rows); script ran to its end: True. Every `.ps1` of the release
  passes the PowerShell parser. This is evidence about the script's logic; it is not a Windows run.
* The Windows CI workflow (`.github/workflows/windows.yml`) was updated for 5.9 (self-test 5.9 as a gate, the 5.9
  script, the report artifacts, a missing report fails the job). **It was not executed**: the development session has
  no Windows runner.
* Packaging: `validation/5.9/release59.py` builds the deterministic ZIP, extracts it into an empty directory and,
  from the extracted copy only, verifies the manifest, the build identity and smoke-tests the Windows executables
  under Wine, including the 5.9 self-test, the reference responses and a refused study in the desktop host.

## 10. The seventeen questions

1. **Were the statistical confidence reporting problems corrected?** Yes. The summary now separates estimates,
   normal-approximation bounds and proven confidence statements; the field that was easy to misread is deprecated
   under an explicit name; a simultaneous statement exists. (Verified: classes 1 and 2.)
2. **Does the new simultaneous lower bound have a defensible coverage guarantee?** Yes: one-sided empirical-Bernstein
   bounds per seat (distribution-free for bounded i.i.d. samples with a fixed sample count) combined by the union
   bound with budgets alpha / seats; no independence between seats, no normal approximation. The guarantee is
   conditional on five stated conditions that the program enforces or checks, and on the pseudo-random numbers
   behaving as random numbers.
3. **How was that guarantee tested against exact values?** By exact binomial coverage on two-point distributions
   (never above the level on 117 cases); on the 15 reference games with exact gains and exact NashConv (3,000 runs,
   14,000 seat statements: 0 violations); on the eight-handed ICM game where the normal interval fails (240 runs: 0
   violations); by an independent Python recomputation of every printed bound (0 differences); inside the shipped
   self-test. No violation in a finite experiment is not a proof; the proof is the proof.
4. **Are rare-action ICM estimates handled more reliably?** They are no longer overstated: every statement about them
   is distribution-free, and the failure of the normal interval is documented with its reproduction. They are not
   handled more *precisely*: on those games the bounds certify nothing at the default sample count, because their
   NashConv is far below what any distribution-free method can resolve with that many deals.
5. **Is trained-response evaluation faster?** Yes: the evaluation walk is 1.06 to 2.36 times faster at one
   thread with identical bits, and uses all processors by default.
6. **How much faster are multiway response calculations?** At one thread, same request, same numbers: three-player flop fixture x2.05 in evaluation, -47% total wall time; six-player flop fixture x1.28 in evaluation, -7% total wall time; three-player preflop fixture x2.36 in evaluation, -52% total wall time; eight-handed ICM fixture x1.22 in evaluation, -2% total wall time; four-player turn x1.51 in evaluation, -30% total wall time; five-player flop x1.25 in evaluation, -15% total wall time; eight-handed ICM final table x1.06 in evaluation, -5% total wall time.
   The response TRAINING part is not faster.
7. **Were strategy-table memory accesses improved?** In the evaluation, yes (two dependent reads instead of four per
   lookup). In the trainer, no: the one candidate that changes nothing else showed no gain and was rejected.
8. **Did CPU training throughput improve?** No. It is unchanged within measurement noise (5.9 / 5.8 time 0.958 to 1.012).
9. **Did six-player flop convergence improve?** No. Training is byte-identical to 5.8.
10. **Were any experimental algorithms promoted?** No. Three existing optional trainers were tested under a
    prespecified rule; none met it. No new algorithm was added.
11. **Did the default solver's mathematical results change?** No. Trained states are byte-identical to 5.8
    (56 of 56 states in the prespecified comparison; 225 cases, 0 failures, 1782 training runs in `identity57.py`; the golden states of the 5.5 and 5.7.1 binaries in the regression suite). The only default numbers that differ from 5.8 are the sampled estimates of
    `mwcli --response`, which are computed from other (versioned) random numbers; `"randomStreams": "5.8"` restores
    the 5.8 numbers exactly.
12. **Are checkpoints still deterministic and recoverable?** Yes: no checkpoint code or format changed; the 5.7.1
    self-test (24 checkpoint and memory checks) passes on Linux; the golden states, continuation and recovery tests
    of the regression suite pass; the 5.7.1 commit repair is untouched (`study_checkpoint55.hpp` unchanged).
13. **Was the rejected-study folder issue repaired?** Yes (section 7).
14. **Were the existing 5.7, 5.7.1 and 5.8 tests preserved?** Yes. Self-tests: 28 of 28, 24 of 24, 33 of 33 on Linux.
    Three assertions of `v58.test.js` were updated for strings that name the release or the default streams, and its
    reference-response test now asks for the 5.8 streams (VALIDATION-5.9.md, section 3); no test was removed, skipped
    or weakened.
15. **How many regression tests passed, failed or were skipped?** 637 tests: 636 passed, 0 failed, 1 skipped on the final Linux build (621 tests of 5.8 and 16 new ones). The skipped test needs enforced file permissions (the suite runs as root), as in 5.8. Self-tests on Linux: 5.9 32 passed, 0 failed, 0 untested; 5.8 33 passed, 0 failed, 0 untested; 5.7.1 24 passed, 0 failed, 0 untested; 5.7 28 passed, 0 failed, 0 untested. A first run of the same build, made while the sanitizer builds were compiling on the same processors, had 635 passed and 1 failed - a timing-dependent test the project lists as load-sensitive since 5.6; it is kept in the archive beside the run made alone (VALIDATION-5.9.md, section 3). Under Wine and under sanitizers: VALIDATION-5.9.md.
16. **Which Windows and CUDA checks remain unperformed?** All of them on real hardware: the Windows executables on
    Windows, Windows PowerShell 5.1 running the script, the CI workflow, every CUDA path, performance and thread
    scaling on the i7-13700F, long runs at 16 GB (WINDOWS-TESTS-5.9.md).
17. **What remains before stronger full-game equilibrium-accuracy claims can be made?** (a) An upper bound of
    NashConv for large games - nothing in EightMax bounds it from above there; (b) responses strong enough that the
    lower bound is close to the truth (41% on the three-street reference game with 200,000 response deals); (c) a
    trainer that demonstrably converges in large multiway games within the update limit, or a higher limit with a
    longer-period training generator; (d) evaluation budgets large enough for the distribution-free statements to be
    tight on real studies; (e) physical validation on the target PC. Until then no percentage of GTO optimality can
    be assigned, and none is.

## 11. Unsuccessful, rejected or not done (class 4), in one place

* Trainer lookup prefetch: no gain, rejected.
* Promotion of an optional trainer: none qualified.
* A new experimental estimator with its own identifier and checkpoint policy: not implemented.
* Faster response training; sharing frozen opponent tables between seats: not implemented.
* Betting-based (tighter) confidence bounds: not implemented.
* A longer-period training generator; a higher update limit: not changed.
* GPU use for the response evaluation: not investigated beyond the profile (the walk is pointer-heavy and
  memory-latency-bound; the brief's own criterion - a concrete performance model before any CUDA work - is not met).
* Native Windows execution, Windows PowerShell 5.1, the CI workflow, every CUDA check: not executed.


## 12. Files

`EightMax-Windows-5.9.zip`, `EightMax-Windows-5.9.identity.json`, and the reports FINAL-REPORT, MATHEMATICAL-VALIDATION,
CONVERGENCE, PERFORMANCE, VALIDATION, WINDOWS-TESTS, RELEASE, STATISTICAL-CHANGES and BUILD (all `-5.9.md`), each also
inside the ZIP. Evidence: `validation/5.9/` inside the ZIP.
