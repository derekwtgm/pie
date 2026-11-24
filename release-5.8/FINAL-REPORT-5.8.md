# EightMax 5.8 — final report

Build `d4001e2c0cd77f41`, successor of 5.7.1 (build `65e835e6b7060960`). Windows x64 package:
`EightMax-Windows-5.8.zip`; its SHA-256 is in `EightMax-Windows-5.8.identity.json`, delivered beside it (a file cannot
contain its own archive's hash).

Every statement below belongs to one of four classes, and says which:

| Class | Meaning |
|---|---|
| **1** | independently mathematically validated: a proof plus an independent implementation, an exact reference, or the unchanged 5.7.1 binary agrees |
| **2** | tested on Linux, under Wine, or by simulation |
| **3** | implemented, awaiting physical Windows / GPU validation |
| **4** | unsuccessful, incomplete, or not implemented |

## 1. Summary

**What 5.8 is.** 5.7.1 with (a) a new, proven lower bound of NashConv that works where the old measures were weak —
studies with several betting streets and studies too large to enumerate; (b) five more reference games with exact
answers; (c) over-limit studies refused before training instead of after; (d) a better exact ICM cache; (e) a repair
of a real defect in the desktop host's checkpoint lock; (f) the self-test, tests, Windows script and launchers for
all of it. The trainer is the 5.7.1 trainer, bit for bit.

**What 5.8 is not.** It is not faster at multiway training (profiled; one optimisation tried and rejected). It has
no CUDA change. It did not raise the update limit. It has no upper bound of NashConv for large games and therefore
supports no statement of how close a full-range multiway strategy is to equilibrium. It has not run on Windows
hardware or on a GPU.

| Objective of the brief | Outcome | Class |
|---|---|---|
| 1. stronger, more transparent strategy-quality measurement | **delivered**: the trained response, with proof, exact checks on 130 states, an independent implementation and mutation tests; every measure audited and labelled | 1 |
| 2. multiway postflop calculations | **profiled, not improved**: flat profile bound by memory access; one optimisation rejected; six-player flop experiment run as planned | 4 for speed; 2 for the measurements |
| 3. eight-handed tournament and ICM | **partly**: exact ICM cache improved (up to 10% fewer instructions, identical bits); three new ICM / eight-handed reference games; no new tournament model | 1 for identical results; 2 for the speed |
| 4. CPU/GPU utilisation | **no change to scheduling or CUDA**; reasons and the 5.7 hardware data in PERFORMANCE-5.8.md, section 6; hardware script supplied | 4 for optimisation; 3 for the validation tools |
| 5. large-study limit | **enforced at configuration** (refused in under a millisecond); limit kept at 10,000,000 updates for a stated, measured reason | 2 |
| reliability of 5.7.1 preserved | all 24 checkpoint and memory checks pass; `study_checkpoint55.hpp` untouched; training states identical | 1 / 2 |
| Windows release | built, packaged, run under Wine; **physical acceptance pending** | 3 |

## 2. Baseline (phase 1)

The supplied 5.7.1 archive was verified before any change: SHA-256 `1dd44b55...d57477ef`, 4,639 members, 4,638
manifest entries all matching, version 5.7.1, build `65e835e6b7060960` in the identity file, in `BUILD-INFO.json` and
embedded in the three executables. The unmodified source was rebuilt with the development toolchain and gave the
three Windows executables, the three Linux programs and the interface **byte for byte**, so every difference of 5.8
comes from source changes. Its regression suite: 606 tests, 605 passed, 1 skipped. An untouched copy was kept
throughout. (`validation/5.8/baseline/`; VALIDATION-5.8.md, section 1.)

The archive was not attached to the development session; at the owner's instruction it was taken from the
repository branch `eightmax-5.7.1` and checked against the hash given in the brief.

What is on record for 5.7.1 from Windows hardware is the *focused* validation only (36 passed). Its full Windows
and GPU validation was never reported, and this report does not treat the 5.7 run as a 5.7.1 result.

## 3. Changes implemented

### 3.1 Strategy-quality measurement (objective 1)

**Audit (phase 2).** 5.7.1 had three quality measures: the exact best response (NashConv itself, small games only);
a best response restricted to the first street of the study; and a one-decision deviation estimated from samples.
The two that work on large games are lower bounds, and 5.7 had measured them finding 4% to 100% and 5% to 99% of
exact NashConv. The precise limitations: the restricted measure cannot express a deviation on a later street; the
one-decision measure changes a single decision per seat. Neither can find an improvement that needs coordinated
changes across streets, which is where an unconverged multi-street strategy loses most.

**The trained response (phase 3).** For each seat, the other seats are frozen at their trained strategies and the
engine's own trainer is run for that seat alone; the result is a full response strategy over all streets. Its gain
against the frozen profile cannot exceed the best-response gain (by definition of the maximum), so the sum over the
seats is a lower bound of NashConv — whatever the quality of the response. The gain is measured exactly on small
games and on independent deals otherwise, with a distribution-free interval beside the usual one.
(`source/native/response58.hpp`; `mwcli --response`; MATHEMATICAL-VALIDATION-5.8.md, sections 1 and 2.)

**Labels.** Every measure is now documented with what it is, its direction, assumptions, units and scope, and
whether it is exact, restricted or statistical (MATHEMATICAL-VALIDATION-5.8.md, section 0). The output of the new
command states the direction in words in every result. Multiplayer or ICM NashConv is called exploitability
nowhere.

**Reference games.** Fifteen with exact answers, covering the seven situations the brief names and five new
tournament-stage games, each with its abstraction documented (`source/tools/games58.js`).

### 3.2 Multiway postflop (objective 2)

A deterministic profile from three to eight players (PERFORMANCE-5.8.md, section 2): the traversal, strategy lookup
and child lookup are 60% to 75% of the instructions at every player count; cost grows with state visits per deal;
on realistic tables the time is in cache misses of dependent reads. One optimisation (compact row offsets) was
implemented, measured on an idle machine, found to give nothing measurable, and reverted. **No multiway speed-up
ships.** The six-player flop experiment was run with independent seeds as planned (section 5 below).

### 3.3 Tournament and ICM (objective 3)

The exact prize-equity cache is four-way set-associative (same entries, same memory, identical values). Three of
the five new reference games are tournament games with ICM or eight seats. Eight-handed defaults are unchanged and
tested: 0.5 / 1 blinds, 0.1 ante per seat, 2.3 BB, no big-blind ante. No new approximation of tournament value was
introduced.

### 3.4 CPU and GPU (objective 4)

Nothing changed in training scheduling or in CUDA. The new evaluation walk and `parallelSeats` use threads and give
identical bits for any number of them. PERFORMANCE-5.8.md, section 6, gives the measured costs from the 5.7 run on
the target PC and why they did not point to a change that could be made and validated without a GPU.

### 3.5 Large studies (objective 5)

The exact limit: 10,000,000 committed updates of one engine state (10,000,000 deals with the default trainer,
640,000,000 with 64-deal batches). Numeric types were reviewed and are adequate far beyond it. What binds is the
32-bit random-number generator: on the six-player flop fixture one deal draws 132 numbers from the action stream, so
ten million deals use 0.31 of the generator's cycle (measured on every shipped fixture). The limit could not be
raised by more than a factor of about three without a stream repeating, and a longer generator changes every
trained state and the state format. **The limit is kept and now enforced when the study is configured**: status
400, nothing trained, the largest supported budget in the message, and from the command line no checkpoint
directory. Through the desktop host the refusal takes 6 ms and appears as the study's error; the folder the host
creates for a new study is left behind with only its `request.json` (unlisted and harmless; section 9).

## 4. Defects repaired

| Defect | Since | Repair | Evidence |
|---|---|---|---|
| The desktop host released its checkpoint lock after sending the answer; an immediate next checkpoint request could be refused (409 / 503) although the host had finished. Cause of the occasional load-sensitive test failures | 5.6 | lock released before the answer | deterministic reproduction on the unmodified 5.7.1 source, repaired host, new test (`validation/5.8/host-lock/`) |
| A study above the update limit trained to the limit (minutes to hours) and then failed | 5.6 | refused at configuration | self-test L1 to L4 |
| The 5.8 validation launchers (as first written, and those of 5.7.1) took PowerShell's exit status as the result: a PowerShell ending with 0 without writing a report was announced as passed | 5.7 | 5.8 launchers delete old reports first and return status 2 when the report is missing | run under Wine's command interpreter before and after (`validation/5.8/wine/launchers-under-wine-cmd.md`) |
| Two tests wrong about 5.8 (a 100,000,000-deal study that is now refused; a version literal) | — | tests corrected, not weakened | VALIDATION-5.8.md, section 2.1 |

Found and documented, not changed: with 64-deal batches a state may hold up to 640,000,000 deals, and the deal
stream repeats after 187 to 470 million deals on six of the ten shipped fixtures (5.6 to 5.7.1 behave the same).

## 5. Results

### 5.1 Regression and self-tests (class 2)

| | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| 5.7.1 (rebuilt baseline) | 606 | 605 | 0 | 1 |
| **5.8 final build** | **621** | **620** | **0** | **1** |

The skip is a folder-permission test that cannot fail for an administrator. `mwcli --selftest58`: 33 of 33;
`--selftest571`: 24 of 24; `--selftest57`: 28 of 28. Three earlier full runs of 5.8 had failures (one host defect,
since repaired; two tests wrong about 5.8, since corrected; one document not yet written): VALIDATION-5.8.md,
section 2.1.

### 5.2 Mathematical accuracy (class 1)

| Finding | Evidence |
|---|---|
| 5.8 trains exactly what 5.7.1 trains | 225 cases and 1,782 runs with identical state files; 400 of 400 checkpoint pairs identical in the convergence experiment |
| the trained response never exceeds the exact best response | 0 of 1,120 seat gains; proof in MATHEMATICAL-VALIDATION-5.8.md, section 1 |
| it is far tighter than the 5.7 measures on multi-street games | heads-up turn: 0.99 against 0.33 and 0.16 of exact NashConv; four-player turn: 1.00 against 0.06 and 0.06; three streets: 0.75 against 0.06 and 0.02 |
| it is not tighter where the restricted measure is already exact | single-street games: 0.96 to 1.00 against 1.00 |
| its estimate is unbiased and its distribution-free interval holds | 0 failures in 2,178 estimates against exact values; no bias in 120 independent evaluations |
| its normal-approximation interval is **not** reliable with sampled opponent actions | on the eight-handed ICM game single estimates were up to 1,183 reported standard errors from the exact value |
| an independent implementation agrees | Python: 8 cases, 21 seats, values equal to 1.8e-15 |
| the checks can fail | 10 of 10 deliberately broken engines detected |
| cached ICM values are the computed values | 50,400 comparisons bit for bit; identical states and evaluations |

### 5.3 Strategy quality against 5.7.1 (class 2, prespecified)

Equal deals: identical. Equal time, ten games, 20 seeds: ten of ten "unresolved", none worse. Six-player flop, 60
seeds: unresolved at 0.5 s and 2.0 s on both games — unchanged. Nothing was promoted. (CONVERGENCE-5.8.md.)

### 5.4 Performance (class 2; four-processor Linux container)

(The last column gives sections of PERFORMANCE-5.8.md.)

| Question | Answer | Where |
|---|---|---|
| Is training faster than in 5.7.1? | **No.** Same states; timed speed ratio 0.91 to 1.05 (not resolved by timing); in instructions 0.02% fewer to 1.05% more on the shipped fixtures (median 0.16% more) | 3 |
| Except? | Eight-handed ICM final tables with a small table budget: 10% and 4% fewer instructions; 0.7% to 2.2% fewer with larger budgets | 5.1 |
| Is evaluation faster? | **No.** Identical results; timed ratio 0.86 to 1.08, median 0.99; the exact evaluation of the eight-handed ICM final table is 5.8% faster | 4 |
| Are complete studies faster? | No measurable change (identical measurements; the long studies 1.5% to 6.5% faster in single runs) | 7 |
| Were multiway postflop calculations optimised? | Profiled from three to eight players; one optimisation tried and rejected; **no speed-up** | 2 |
| Is CPU multithreading more efficient? | Unchanged for training (frozen batches on four threads: 0.97 to 1.06 times the deals per second of 5.7.1). The new evaluation runs on several threads with identical bits; its speed-up was not benchmarked | 6 |
| Was CUDA changed? | No | 6 |
| What is new and costs time? | The trained response: 2 seconds to 2 minutes for all seats of a shipped fixture with 1,000,000 response deals per seat | 4.1 |
| What became much faster? | The failure of an over-limit study: under a millisecond instead of minutes to hours | 8 |
| Regressions | up to 1.05% more instructions per training on small ICM games | 3, 5.1 |

### 5.5 Reliability (class 2)

All 24 checkpoint-integrity and memory-budget checks of 5.7.1 pass on Linux and for `mwcli.exe` under Wine.
Sanitizers (AddressSanitizer, UndefinedBehaviorSanitizer, ThreadSanitizer, LeakSanitizer): 0 reports over the 5.8
test file, the 5.5 and 5.6 files, the checkpoint tests of 5.7.1, the self-tests and threaded response runs. The
desktop host's stability run (3 minutes: 17 pause-and-resume cycles, 25 sequential studies, cancellation during
evaluation, 150,000 concurrent status polls, a 133 s study with 56 checkpoint commits): every check about the
running program passed; one new check failed on a clause about a leftover request file, which is reported as a
limitation (VALIDATION-5.8.md, section 11.1).

### 5.6 The Windows programs (class 2 under Wine; class 3 on Windows)

Under Wine 9.0 the final `mwcli.exe` and `EightMax.exe` pass the three self-tests (33, 24 and 28 checks), reproduce
seven reference games bit for bit (trained state, estimated gain, exact gain, exact best-response gain of every
seat), and pass 68 of 69 tests of the 5.5 to 5.8 test files (one of them only when rerun alone; the one failure is a
Wine-only limitation documented since 5.7.1). The three launchers were run by Wine's command interpreter; that run
found and led to the correction of a launcher defect (a script ending without a report was announced as passed).

**None of this is a Windows result.** The PowerShell validation script has never executed (running PowerShell in
development was refused by the session's permission policy); the GitHub Actions Windows workflow did not run (no
push access); no CUDA code path ran. Physical acceptance on the Windows 11 / Core i7-13700F / RTX 4060 Ti PC is
pending: section 8.

## 6. Acceptance criteria of the brief

The brief's section 12, criterion by criterion. "Met" means met by evidence of the class shown; a criterion that
needs Windows hardware is not called met.

**Mathematical correctness**

| Criterion | Status | Evidence |
|---|---|---|
| existing supported calculations remain correct | met (class 1) | training states identical to the 5.7.1 binary (225 cases, 1,782 runs); evaluation results identical on every benchmark case; regression suite |
| new evaluation algorithms checked against independent references | met (class 1) | exact values on 130 states; independent Python on 8 cases, 21 seats |
| sampling changes validated for bias | met (class 1 / 2) | no sampling of the trainer changed. The new estimator: proof of unbiasedness; 1,120 + 98 estimates against exact; a bias test of 120 independent evaluations (no bias, largest t 1.31) |
| exact evaluator results agree within declared tolerances | met | engine against Python: largest difference 1.8e-15 (declared 1e-9); response states against original states: 7.6e-15 |
| no unsupported GTO or exploitability claims | met | no percentage of GTO anywhere; "exploitability" only for two-player chip EV; every lower bound labelled as one |

**Strategy quality**

| Criterion | Status | Evidence |
|---|---|---|
| prespecified comparisons against 5.7.1 complete | met: both plans ran in full (1,600 and 720 rows, no failures) | CONVERGENCE-5.8.md, sections 4 and 5 |
| improvements measured with appropriate metrics | met | exact NashConv on the reference games |
| statistical uncertainty reported | met | sign test and paired t interval with Bonferroni adjustment; standard errors and distribution-free intervals for the estimates |
| unresolved results remain unresolved | met | verdicts are reported as computed, "unresolved" included |
| no unvalidated algorithm promoted to default | met | no trainer changed; the trained response was not made the default study column because its own promotion rule was not met on single-street games |

**Performance**

| Criterion | Status | Evidence |
|---|---|---|
| training throughput measured | met: 10 fixtures, timed and in instruction counts | PERFORMANCE-5.8.md, section 3 |
| evaluation throughput measured | met: 16 cases | section 4 |
| complete-study performance measured | met: 8 studies | section 7 |
| CPU and GPU time separated | **not applicable to 5.8 measurements**: no GPU was available, so every 5.8 time is CPU time; the 5.7 hardware run separates them and is quoted as a 5.7 result | section 6 |
| peak memory reported | met | peak resident memory per fixture and binary (PERFORMANCE-5.8.md, section 3; the benchmark tool's own memory figures were found invalid and discarded); per trained-response run in CONVERGENCE-5.8.md, section 3 |
| performance regressions documented | met | up to 1.05% more instructions per training on the shipped fixtures (sections 3 and 5.1); timing differences inside the measurement spread are reported as such |

**Reliability**

| Criterion | Status | Evidence |
|---|---|---|
| checkpoint integrity tests pass | met (class 2) | `--selftest571`: all 24 checks, on Linux and for `mwcli.exe` under Wine |
| memory-budget tests pass | met on Linux (class 2); under Wine see VALIDATION-5.8.md, section 9 | the same |
| study continuation remains deterministic | met (class 1 / 2) | identity run "saved and continued" cases; `v58.test.js`; stability run |
| unsupported budgets rejected early | met (class 2) | self-test L1 to L4 |
| no regression in Windows application start-up | **class 3**: `EightMax.exe` starts and answers under Wine with the right build (packager smoke test, `v55`/`v56`/`v58` host tests under Wine); not run on Windows | VALIDATION-5.8.md, sections 9 and 10 |

**Packaging**

| Criterion | Status | Evidence |
|---|---|---|
| complete ZIP archive | met | built by `validation/5.8/release58.py`, extracted into an empty directory and checked from the extracted copy |
| reproducible build identity | met | second build in another directory byte-identical (7 artifacts); `verify_build.js` |
| individual file checksum manifest | met | `SHA256SUMS.txt`, every entry verified in the extracted copy |
| verified executable checksums | met | identity file; BUILD-5.8.md |
| complete source and documentation | met | `source/`, the documents of this release and of every earlier one |
| machine-readable validation evidence | met | `validation/5.8/validation-summary.json` and the raw files it is computed from |

**Whether 5.8 may be called a validated release.** For mathematics, Linux and Wine: yes, with the limits of section
9. As a Windows release for the target PC: **not yet** — physical acceptance is pending (class 3), as the brief
provides for when native Windows and NVIDIA testing cannot be performed.

## 7. Required final assessment

**1. What mathematical capabilities were added or improved?**
(a) A new quality measure, the trained response: a full response strategy per seat, trained against the other
seats frozen at their strategies, whose gain is a proven lower bound of the seat's best-response gain; summed over
the seats, a lower bound of NashConv (class 1). (b) An unbiased estimator of that gain from independent deals with
a distribution-free 95% interval (class 1 for the interval; the normal-approximation interval beside it is not
reliable with sampled opponent actions). (c) Fifteen reference games with exact NashConv instead of ten. (d) An
exact ICM cache that wastes fewer entries, with bit-identical values (class 1). (e) An audit that states, for
every measure, what it is, its direction, assumptions, units and scope. Not added: any upper bound for large games;
any new trainer; any new tournament-value model.

**2. Is EightMax better able to evaluate realistic tournament strategies?**
Yes, in one precise sense: it can now show that a strategy is *not* close to equilibrium where it previously could
not. On the shipped six-player flop fixture after 1,000,000 deals the 5.7 measure reported -0.22 ± 0.19 BB (nothing);
the 5.8 measure establishes a NashConv of at least 0.77 to 0.93 BB per hand. The same holds for the three-player
flop (at least 0.35 to 0.40 BB) and the 25 BB preflop fixture (at least 0.22 to 0.25 BB). It is not better able to
show that a strategy *is* close: a lower bound cannot do that (class 2: measured on Linux, three seeds per fixture).

**3. How accurately can the new evaluator measure multiway strategy quality?**
On multiway games small enough for an exact answer (three to eight seats, two to six hands a seat): with 2,000,000
response deals per seat it found 70% to 100% of exact NashConv (median 100%; at least 90% in 122 of 130 states); with
200,000, 19% to 100% (median 96%). It never exceeded the exact value. Its accuracy on full-range multiway studies is
**unknown**: no exact value exists there, the share found depends on the response budget, and on the largest
reference game (three streets) two million response deals found only 75%. The measured number itself (the gain of
the response actually trained) is accurate to its stated distribution-free interval in all 2,178 estimates checked
against exact values.

**4. What exact NashConv measurements are available?**
For any study small enough to enumerate — in practice the fifteen reference games (heads-up river; heads-up turn
and river; three-player river with side pots; four-player turn and river; five- and six-player flops; eight-handed
ICM final tables; four- and five-player ICM bubbles; a three-street three-player game; a three-player turn game;
eight-handed push or fold; a three-player ICM river) and the small shipped fixtures (`known-akq-river`, the
`-small` fixtures). The exact evaluator refuses a game that is too large; it never returns a truncated value.
Exploitability (NashConv / 2) is reported only for two-player chip-EV games.

**5. Which larger-game measurements are only restricted best responses or statistical estimates?**
All of them. For a game too large to enumerate, 5.8 has: the trained response (restricted: one response, not the
best one; statistical: its gain is estimated from sampled deals); the 5.7 restricted best response (restricted to
first-street deviations; exact where it can be enumerated, otherwise sampled); the 5.7 one-decision measure
(restricted and statistical). Each is a lower bound of NashConv. The study statistics (action frequencies, EV
differences, replication intervals) describe variation between trainings and are not measures of distance from
equilibrium. Nothing for large games is an upper bound.

**6. Did the six-player flop convergence result improve?**
No. Unchanged: the primary contrast (5.8 against 5.7.1 default trainer) is "unresolved" at 0.5 s and at 2.0 s on
both six-player flop games with 60 independent seeds, and at equal deals the two binaries write identical
checkpoints. What improved for the six-player flop is the measurement of quality (answer 2), not the strategies.

**7. Did eight-handed tournament and ICM performance improve?**
Slightly, and only for training with a small table budget. Deterministic instruction counts of eight-handed ICM
final-table trainings: 10% fewer (fixed hands) and 4% fewer (weighted ranges) with a 16 MiB budget; 0.7% to 2.2%
fewer with larger budgets; identical states. At equal wall-clock time the eight-handed final table completed 5.5%
more deals than 5.7.1 (not a resolved difference in NashConv). Small ICM games whose cache never missed execute
0.8% to 1.0% **more** instructions. Exact ICM evaluation is bound by board scoring, not by ICM, and did not change
materially. No tournament model changed.

**8. How much faster is training than 5.7.1?**
It is not faster. With the same seed 5.8 performs the same updates and writes the same state as 5.7.1. Timed on
the ten shipped fixtures, the speed ratio 5.8 / 5.7.1 was 0.91 to 1.05 (median 0.98 to 0.99), which this machine's
run-to-run spread does not resolve; counted in instructions, 5.8 executes 0.02% fewer to 1.05% more (median 0.16%
more). The exception is eight-handed ICM final-table training with a small table budget (up to 10% fewer
instructions). No multiway optimisation was found that passed validation. What became faster is failing: an
over-limit study is refused in under a millisecond instead of after minutes or hours.

**9. How much faster is evaluation?**
It is not faster. All 16 evaluation cases return identical results at a timed ratio of 0.86 to 1.08 (median
0.99); the exact evaluation of the eight-handed ICM final table is 5.8% faster. Complete studies are unchanged to
the precision of the measurement. The new measure is additional work: 2 seconds to 2 minutes for all seats of a
shipped fixture.

**10. Is CPU multithreading more efficient?**
Not for training: nothing in the threading of training changed, and frozen batches on four threads complete 0.97
to 1.06 times the deals per second of 5.7.1 (median 1.00). They complete 1.04 to 2.27 times the deals of the
one-thread default trainer in the same time, as in 5.7, and are still not better than it on every game. New
threaded code (the response evaluation; seats side by side) returns identical bits for any number of threads and is
clean under ThreadSanitizer; its speed-up was not benchmarked. Scaling beyond four threads, and on the target CPU's
performance and efficiency cores, was not measured (class 3).

**11. Were CUDA calculations changed or optimized?**
No. No CUDA kernel, device selection, transfer or scheduling rule was changed, and none was executed for 5.8.
The measured costs from the 5.7 run on the target PC did not point at a change that could be validated without a
GPU, and none was made blind (PERFORMANCE-5.8.md, section 6). Class 4 for optimisation.

**12. Do CPU and GPU results remain mathematically consistent?**
Not re-measured for 5.8: there was no GPU (class 3). What is known: the CUDA source is unchanged from 5.7.1; the
5.7 run on the target PC showed exact integer agreement of CPU and GPU; in 5.8 CPU-only and GPU-Preferred studies
give identical measurements when no GPU is present (the fallback path, packager smoke test under Wine). The full
Windows validation of 5.8 repeats the CPU/GPU agreement checks on the RTX 4060 Ti and must be run to answer this
for 5.8.

**13. Is checkpoint recovery still reliable?**
Yes on Linux and for the Windows programs under Wine (class 2): all 24 checks of `--selftest571` pass (SHA-256
integrity, previous-generation recovery, damaged manifests and engine states, the kill during the first commit after
a recovery, directory locking, the memory-budget stop and its resume, incompatible checkpoints refused with the
reason); `study_checkpoint55.hpp` is byte-identical to 5.7.1; continuation is deterministic (saved-and-continued
trainings give the bytes of uninterrupted ones). In addition a real defect of the desktop host's checkpoint lock
was found and repaired. Not yet run on Windows hardware for 5.8 (class 3).

**14. Was the large-study iteration limit corrected?**
The *behaviour* was corrected; the limit was not raised. A study above 10,000,000 updates per seed is refused when
it is configured, in under a millisecond, with nothing trained and the largest supported budget in the message
(before: it trained to the limit and then failed). The limit stays because the engine's 32-bit random streams
would repeat: ten million deals already use 0.31 of the generator's cycle on the six-player flop fixture. Raising
it needs a new generator and a new state format.

**15. How many regression tests passed, failed or were skipped?**
Final build, Linux: **621 tests: 620 passed, 0 failed, 1 skipped** (a folder-permission test that cannot fail when
run as administrator). 5.7.1 had 606; the 15 new ones are the 5.8 file. Self-tests: 33 of 33 (5.8), 24 of 24
(5.7.1), 28 of 28 (5.7). Three earlier full runs during development had failures; each is listed with its cause in
VALIDATION-5.8.md, section 2.1. Under Wine: the Windows executables: 33 of 33, 24 of 24 and 28 of 28
in the self-tests; seven reference results bit-identical to Linux; of 69 tests in five test files, 68 passed (one
passed only when rerun alone) and 1 failed for a documented Wine-only reason (VALIDATION-5.8.md, section 9). Windows hardware: not run.

**16. What remains before stronger full-game GTO claims can be supported?**
(a) An **upper bound** of NashConv for games too large to enumerate; nothing less can show closeness to
equilibrium. (b) Evidence of how the trained response behaves as games grow from the small exact ones toward full
ranges. (c) A measure of the **abstraction error** — every figure here is inside the study's own bet sizes and
ranges. (d) For three or more players and for ICM, a decision about what "GTO" should mean at all: NashConv = 0
identifies an equilibrium but does not protect against joint deviations, equilibria are not unique or
interchangeable, and ICM is a model of tournament value. (e) Longer training than the 10,000,000-update limit
allows, which needs a new generator. (f) Physical validation on Windows and the GPU.

No percentage of GTO completion is given, because no defensible definition of one exists for these games with the
measurements available: what is established is a floor under NashConv, exact on small games; what is not
established is any ceiling on large ones.

## 8. Remaining Windows and GPU tests

Nothing of 5.8 has run on Windows hardware. In order (WINDOWS-TESTS-5.8.md has the details and the files to send):

1. `Run 5.8 focused validation.bat` — 3 to 8 minutes; the 33 checks of the 5.8 self-test without PowerShell, then
   the focused script (expected 54 passed, counted from the script).
2. `Run 5.8 Windows validation.bat` — 15 to 50 minutes; everything, including CUDA against the CPU on the RTX 4060
   Ti (expected 151 passed). This run also supplies the full validation that 5.7.1 never had.
3. Push the release to the repository so the GitHub Actions Windows workflow runs.

The PowerShell script has never been executed: its sections 10 and 11 are new and only statically checked. If it
stops with an error, the self-test report written before it still holds every result of the 33 checks.

## 9. Limitations

1. **No upper bound of NashConv for large games; no "percentage of GTO".** A lower bound, however tight on small
   games, cannot show that a large strategy is close to equilibrium.
2. The trained response depends on its response budget, and on a three-street reference game found three quarters
   of exact NashConv with two million response deals.
3. With sampled opponent actions the normal-approximation interval of the estimate can be wrong by orders of
   magnitude when strategies contain rare actions; the distribution-free bound must be used for conclusions.
4. The independent Python implementation covers postflop chip-EV games up to four seats; ICM, preflop and
   six-player responses are checked against the engine's own exact evaluator.
5. No multiway training speed-up; no CUDA change; update limit unchanged.
6. Training executes up to about 1% more instructions than 5.7.1 on the shipped fixtures (median 0.16%), most on
   small ICM games.
7. All timings are from a four-processor Linux container. Nothing was measured on the target PC.
8. Not executed: Windows hardware, PowerShell, CUDA, the CI workflow, a full 10,000,000-update training.
9. The study workflow's built-in quality column is still the 5.7 one-decision measure; the trained response is a
   separate command.
10. Saved studies of 5.7.1 cannot be continued by 5.8 (existing policy; solver states can).
11. In the desktop application a refused study (over-limit budget, or any configuration error) leaves a folder
    holding only `request.json` under the saved studies; it is not listed and can be deleted. Present since 5.5.

## 10. Deliverables

| File | What |
|---|---|
| `EightMax-Windows-5.8.zip` | the complete application: three executables, interface, source, fixtures, validation scripts and evidence, documents |
| `EightMax-Windows-5.8.identity.json` | version, build identifier (= source fingerprint), archive SHA-256 and size, manifest entry count and hash, executable hashes, smoke-test results from a clean extraction, validation status |
| `FINAL-REPORT-5.8.md` | this report |
| `CONVERGENCE-5.8.md` | plans, games, paired measurements, uncertainty, conclusions |
| `PERFORMANCE-5.8.md` | 5.8 against 5.7.1 |
| `MATHEMATICAL-VALIDATION-5.8.md` | definitions, proofs, independent references, tolerances, limits |
| `VALIDATION-5.8.md` | every executed, failed, skipped and unavailable test |
| `WINDOWS-TESTS-5.8.md` | what to run on the Windows PC and what to send back |
| `RELEASE-5.8.md` | release notes |

Also in the archive: `USER-GUIDE-5.8.md`, `BUILD-5.8.md` (toolchain, reproduction, artifact hashes), `CHANGELOG.md`,
`ROADMAP.md`, and all raw evidence under `validation/5.8/` with the machine-readable
`validation/5.8/validation-summary.json`.

## Delivery addendum (not in the archived copy: an archive cannot contain its own hash)

Recalculated after packaging, from the delivered file and from a fresh extraction of it:

| Item | Value |
|---|---|
| `EightMax-Windows-5.8.zip` SHA-256 | `2c80ca33734c8d289ea3e73e436ca96ac0098f92d1bcd0b8327aa980e6fc6b41` |
| size | 97,640,600 bytes |
| archive members / manifest entries | 4,922 / 4,921 (`SHA256SUMS.txt` lists every file but itself); every entry verified with `sha256sum -c` in a fresh extraction |
| `SHA256SUMS.txt` SHA-256 | `2b39c5523919ea3e5563061a52b2111d681138c9955a2d0d631ddfe52435a317` |
| version / build identifier (= source fingerprint, 384 files) | 5.8 / `d4001e2c0cd77f41` |
| `EightMax.exe` SHA-256 | `db1f80dcbbf5efd5edfe124449d5c5d48c5e526852b5d38ff381f3ed62856cbc` |
| `mwcli.exe` SHA-256 | `9e0e4975d5f41dade7e888610d1cd1c373f58135634e9001d17930c12e25af14` |
| `gpustress.exe` SHA-256 | `54757acb2ef8fa401ad856a74b97510840955a8f44f938d55af9f7e46e89b0d6` |
| smoke tests of the extracted Windows programs under Wine | passed: build identifiers, a study of the known game, the desktop host answering with build and version, an interrupted and resumed study, the 5.5-trainer golden states, `--selftest57` 28 of 28, `--selftest571` 24 of 24, `--selftest58` 33 of 33, the seven reference responses, the refusal of an over-limit study |

The first packaging attempt stopped at a smoke check ("the saved-study list is empty"): the Wine profile still held
a study left behind by an earlier Wine test run (the Wine-only folder behaviour of VALIDATION-5.8.md, section 9).
That leftover was removed from the Wine profile and the packaging repeated; no file of the release was changed in
between.

Except for this addendum, this file is byte-identical to `FINAL-REPORT-5.8.md` inside the archive. The other six
reports beside the archive are byte-identical copies of the archived ones.

**Repository.** During development the session had read access to `derekwtgm/pie` only (a request for push access
was refused by the session's permission policy), so nothing was pushed and the GitHub Actions Windows workflow did
not run; the archived documents say so and are unchanged. After delivery the owner asked for the release to be
pushed: it is in the folder `release-5.8` of the branch `eightmax-5.8`, laid out like the earlier releases. That push
does not run the 5.8 Windows workflow: the repository root holds an older source tree with its own workflow, and the
5.8 workflow is inside the archive (`EightMax/.github/workflows/windows.yml`). The 5.8 workflow therefore remains
**not executed**.
