# EightMax 5.11: final development report (Phase 1: the 64-bit training generator)

Build `af452eaa0ea731be`, successor of 5.10 `7fa0e8c16d6c6ade`. One phase, one release: this report covers Phase 1 only.

## 0. The short version

**Asked:** replace the 32-bit training random generator with a counter-based 64-bit one; remove the
10,000,000-update limit; prove the streams do not overlap; show convergence is no worse than 5.10 at equal deals.

**Delivered:**

| | | Status |
|---|---|---|
| Counter-based 64-bit generator (Philox4x64-10), every number addressed by (seed, update, deal, purpose, position) | `native/streams511.hpp` | done |
| No overlap within a training state | proof in MATHEMATICAL-VALIDATION-5.11.md, section 4 | **proven** |
| ... and the program really addresses its streams that way | counter audit of 246,176 generator calls, none repeated; independent Python implementation | **tested** |
| 10,000,000-update limit removed for states of the new streams | a state trained to 10,000,200 updates and one at update index 4,294,970,303, to recorded bytes on Linux, Wine and Windows Server | **tested** |
| Convergence no worse than 5.10 at equal deals | NashConv 0.957 of 5.10's (0.921 to 0.995), 32 seeds, 13 games, rule written first | **tested**; rule met |
| ... and at equal time (your primary comparison) | 1.030 (0.985 to 1.078): no worse within the 10% margin fixed beforehand; the generator costs time | **tested**; rule met |
| The 5.10 trainer still writes the 5.10 states | 14 recorded states; 225 configurations against the 5.10 program; 544 states of the experiment | **tested**, all identical |
| Old checkpoints load and continue under their own rules; new states have their own identifier and header | selftest511 C1-C3, L1 | **tested** |
| Windows ZIP, identity file, checksums, reports, validation script and launchers, new branch | | delivered |
| Anything on your PC or on the RTX 4060 Ti | | **untested** - yours to run (WINDOWS-TESTS-5.11.md) |

**Three things you should know before anything else.**

1. **New studies now train with the new streams by default**, so a 5.11 study prints other numbers than 5.10 for the
   same seeds (same distribution). I read "replace" as a phase that says otherwise about byte-identical defaults, and
   made the switch only where a training starts fresh (studies), behind the prespecified rule. `trainingStreams=5.10`
   gives the 5.10 numbers back exactly, and every existing spec, state and checkpoint keeps the 5.10 streams. If you
   wanted the new streams to be opt-in instead, that is one constant (`EM_STUDY_WIDE_DEFAULT` in
   `native/study52.hpp`) and a rebuild; say so.
2. **The new generator is slower per number.** Measured cost: about 2 to 3% of a deal on the study fixtures in an
   alternating benchmark on the build machine, 1 to 11% in single runs on two hosted runners, 5 to 15% on the small
   reference games. At equal time the result is "no worse within 10%", not "equal".
3. **The executables were not built on the development machine.** It has no Windows cross-compiler and may not
   install one. They were cross-compiled by a hosted Ubuntu job with the 5.10 toolchain - which was first shown to
   rebuild the three 5.10 executables byte for byte - and validated by further hosted jobs, one of them real Windows.

## 1. Baseline verification (before any change)

* The 5.10 archive on branch `claude/vigilant-lamport-ijdx7n` has the SHA-256 of its identity file (`532d6a63...`).
* Rebuilt from its source: the three Linux programs and the interface on the development machine, the three Windows
  executables on a hosted runner with the toolchain of BUILD-5.10.md: **all seven byte-identical to the shipped files.**
* Regression suite with the rebuilt Linux programs on the development machine: 656 tests, 653 passed, 2 failed,
  1 skipped. The release's own record is 655 / 0 / 1 on four processors. The two failures are this machine: one test
  asserts that three seats ran side by side (two processors here), one a timing-dependent scoring-route decision
  while other work was running. Neither involves anything 5.11 touches; on the 4-processor runner the 5.11 suite
  passes both.
* All five self-tests of the 5.10 Linux program: 21, 32, 33, 24, 28 checks, all passed.
* Order, stated plainly: the suite was started before any source file was changed and was still running when
  development began; the direct self-test run came later, with the unmodified binary in the unmodified tree.

Evidence: `validation/5.11/baseline/`.

## 2. What was built

* **The generator.** Philox4x64-10; key = (64-bit seed, domain), counter = (position, update, deal, purpose). Three
  purposes: the cards of a deal, the sampled actions of its traversals, a Latin permutation. Response training of a
  philox64 state uses its own key domain. 53 bits per number.
* **Where it sits.** `struct Rng` gained an addressed mode; the 32-bit arithmetic is untouched and is what runs when
  no address is set. The address is set in the deal sampler, at the three traversal call sites, and in the Latin
  shuffle. Nothing else in the trainer changed: same traversal, same updates, same merge order, same tables.
* **Selection.** Spec key `"trainingStreams"`: `"philox64"` or `"5.10"` (also when absent). Optional
  `"trainingSeed"` (64 bits, hexadecimal). External-sampling specs only; the enumerated trainers, which share their
  streams with the JavaScript engine, refuse the key.
* **Limit.** `mw_max_updates`: 140,737,488,355,327 for philox64 (so that 64 deals per update stay an exact integer
  below 2^53), 10,000,000 for the 5.10 streams and for DCFR (32-bit per-row discount counters). Every entry point
  checks its request against the engine's own bound before training.
* **State identity.** Header fields `trainingStreams` (`streams-5.11-philox4x64-v1`) and `trainingSeed`; no `rng`,
  no `actionRng`; a derived study identifier. A state continues only under its own streams and seed.
* **Studies.** Option `trainingStreams`; the result records the streams of every variant; the default by the rule of
  section 4.
* **Tools.** `mwcli --selftest511`, `--streams511` (prints a stream for independent checks), a counter audit inside
  the engine, `tools/independent_streams511.py`, `tools/streams511_overlap.c`.

Not built in this phase: the generator in JavaScript and the interactive panel on the new streams (section 8).

## 3. The proof, and what backs it (MATHEMATICAL-VALIDATION-5.11.md)

* **Proven by arithmetic about 5.10:** all its streams are segments of one cycle of 2^32 states. Counted for seed
  101 with frozen batches: 34 of 640,000 per-deal action streams repeat an earlier stream exactly after 10,000
  updates; 412,458 of 64,000,000 after 1,000,000; 43,880,754 of 640,000,000 at the old limit. The deal stream
  repeats after 2^32 draws, which 640,000,000 deals exceed at seven draws a deal. The old limit protected one deal
  per update only.
* **Proven about 5.11:** the generator is a bijection of its counter for a fixed key; the address is the counter,
  field by field; an address is drawn for one purpose, once; the update index is the committed count, which only
  grows. Hence no two numbers of a state share a generator input, whatever the number of updates.
* **Tested:** reference vectors; a second source text; the inverse; an independent implementation in Python
  integers (11,100 numbers bit for bit); and the counter audit - every counter handed to the generator during seven
  real trainings and one above update 2^32: 246,176 counters, no duplicate, no gap, none invalid.
* **Not proven, and said so:** statistical independence of the numbers (the published record of Philox, not a
  theorem), and anything between two seeds.

## 4. Convergence (CONVERGENCE-5.11.md)

The rule, the games, the seeds, the margin (10%) and the stopping rule were written to `plan.json` before the first
measurement. 17 reference games with exact NashConv; 32 seeds; the unchanged 5.10 program against 5.11 with philox64.

| Decisive comparison | NashConv philox64 / 5.10 | Interval | Verdict |
|---|---:|---|---|
| equal time, 2 s (primary) | 1.030 | 0.985 to 1.078 | no worse |
| equal deals, 500,000 (the phase's requirement) | 0.957 | 0.921 to 0.995 | better (not claimed as an improvement) |

Identity arm 544 of 544; no cell of 58 worse; frozen batches 1.008 (0.977 to 1.039); no table limit; 0 failed runs.
**The rule is met; philox64 is the default of new studies.**

Reported plainly, though not part of the rule: at equal time the "ranges" class alone is 1.046 with an interval
above 1 (unadjusted) - the generator's cost; with the four near-zero-NashConv games included, the pooled equal-time
ratio is 1.108 with an interval above 1 - those games were excluded from the pooled statistic before measuring
because their NashConv is 1e-6 or less and its logarithm is no scale; in them philox64 reaches an exact equilibrium
in slightly fewer seeds at 2 s (91% against 97% in the worst case). The run was interrupted once by a time limit and
resumed without analysing anything in between.

## 5. Performance (PERFORMANCE-5.11.md)

Per deal, philox64 against the 5.10 streams, one thread: +2.6% (median of five fixtures) and +7.5% (median of ten
small reference games) in an alternating benchmark on the build machine; 0.89 to 1.01 of the deals per second in
single runs on a hosted Windows and a hosted Linux runner. Not optimised in this phase; two ways to make it cheaper
are noted for Phase 4. With the 5.10 streams the cost is that of 5.10.

## 6. Checkpoints and compatibility

* 5.10 states and study checkpoints: load and continue as before, to the same bytes, with the 5.10 limit.
* philox64 states: own header fields, own study identifier; refused by a 5.10-stream engine, by another seed, and by
  the unchanged 5.10 program (tested with the 5.10 binary); a forged header is refused.
* One behaviour of study checkpoints changed: a checkpoint of another build is refused for its build before its plan
  is compared (the message that names the build is the useful one; the plan now includes the streams).
* Eight existing checks were changed to name the 5.10 streams (VALIDATION-5.11.md, section 2). No check was
  weakened: each tests what it tested, for the streams it was written for.

## 7. Validation (VALIDATION-5.11.md)

| | Result |
|---|---|
| Regression suite, Linux, 4-processor runner | 668 tests: 668 passed, 0 failed, 0 skipped |
| `mwcli --selftest511` (26 checks) | passed on Linux, under Wine, on Windows Server 2025 |
| Self-tests of 5.10, 5.9, 5.8, 5.7.1, 5.7 | 21 / 32 / 33 / 24 / 28, all passed, same three platforms |
| Identity against the 5.10 program | 225 cases, 1,782 trainings, 0 differences |
| Sanitizers (address, undefined behaviour, thread, leak) | 0 reports |
| Windows script, PowerShell 7 on Linux | focused 54 passed, 0 failed, 1 skipped, 0 untested (35.5 s); full 247 passed, 0 failed, 2 skipped, 0 untested (446.9 s) |
| **Both launchers on a hosted Windows runner** | focused launcher exit 0: 54 passed, 0 failed, 1 skipped, 0 untested (86.2 s); full launcher exit 0: 247 passed, 0 failed, 2 skipped, 0 untested (683.7 s) (skipped: the integrity check, which a pre-release tree cannot make, and the GPU section) |
| Delivered archive on a hosted Windows runner; packaging smoke tests under Wine | WINDOWS-CI-5.11.md and the identity file, beside the ZIP |
| Interface in a browser; desktop host stability; refused studies | 20 of 20; 12 of 12; 9 of 9 |
| Your PC; CUDA | **not run** |

## 8. Decisions I made that are yours to overrule

1. **Default of new studies: philox64** (section 0, item 1).
2. **Scope: the interactive multiway panel and the JavaScript engine were left on the 32-bit streams.** They hand
   states to each other and must draw the same numbers; moving them means implementing the generator in JavaScript
   and deciding what happens to states that cross. The panel therefore keeps its 10,000,000-update bound. Studies
   and the command-line trainer do not.
3. **Non-inferiority margin 10%, 17 of the 20 reference games, 32 seeds, and four near-zero games outside the pooled
   statistic** - all fixed before measuring, from cost and from the 5.10 data, and all visible in the plan. A
   different margin or game set is a different experiment; say so if you want one.
4. **A spec without the key means the 5.10 streams.** Every spec that exists today keeps training the way it did.
5. **Study budgets stop at 2,000,000,000 deals per seed** (the study's own input bound, unchanged); the trainer
   itself goes further.
6. **The generator was not made cheaper** (it would be a second stream algorithm in the same release).
7. **The archive carries no screenshots of the interface test**, to stay under the 100 MiB limit of the repository.

## 9. Unresolved, not done, or not established - in one place

* Nothing ran on your PC or on a GPU.
* Convergence beyond 500,000 deals, with hand groups, or on games too large for exact NashConv: not measured.
* Whether the stream coincidences of 5.10 ever harmed a training: not seen in this experiment, not excluded.
* Equal time: "no worse within 10%" is established; "as fast" is not, and on small games it is not true.
* The interactive panel, DCFR and response training keep a 10,000,000-update bound.
* The archive is at the 100 MiB limit of the repository (the first packaging came out at 100.68 MiB and was
  refused; the Linux host and stress programs of 5.11 were moved beside the ZIP). Phase 2 needs a decision about old
  evidence in the ZIP before it can add anything.
* The in-tree MSYS2 workflow was updated and not run (as for 5.10).

## 10. What to run, and what to send back

WINDOWS-TESTS-5.11.md. In short: `Run 5.11 focused validation.bat` (5 to 12 minutes), then `Run 5.11 Windows
validation.bat` (30 to 80 minutes), and send `Windows-validation-5.11.json` / `.txt`, the six
`Windows-selftest*-5.11.json`, and `hardware-validation.json`. The checks only your PC can make: the philox64 state
with 8 and 24 threads, Hybrid and GPU-Preferred with the GPU really scoring, and the speed of both kinds of streams
on the i7-13700F.

## 11. Files

In the archive: this report, RELEASE-5.11.md, WINDOWS-TESTS-5.11.md, MATHEMATICAL-VALIDATION-5.11.md,
CONVERGENCE-5.11.md, PERFORMANCE-5.11.md, VALIDATION-5.11.md, BUILD-5.11.md, the two launchers, `validation/5.11/`
(evidence, runners, the CI definitions, the 5.11 Linux mwcli). Beside the archive: the identity file,
`SHA256SUMS-delivery.txt`, copies of the reports, WINDOWS-CI-5.11.md and the raw log of the Windows run.
