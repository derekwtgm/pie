# EightMax Windows 5.11

Build `af452eaa0ea731be`. Successor of 5.10 (`7fa0e8c16d6c6ade`). This is **Phase 1** of the ten-phase plan: the 64-bit
training generator. One thing changed in the trainer; nothing else did.

First thing to do on your PC: **WINDOWS-TESTS-5.11.md** (`Run 5.11 focused validation.bat`, 5 to 12 minutes; then
`Run 5.11 Windows validation.bat`). Reports: FINAL-REPORT-5.11.md, MATHEMATICAL-VALIDATION-5.11.md,
CONVERGENCE-5.11.md, PERFORMANCE-5.11.md, VALIDATION-5.11.md, BUILD-5.11.md.

## What is new

### 1. Counter-based 64-bit training streams (`"trainingStreams":"philox64"`)

Every random number of a training now has an address - (seed, update, deal, purpose, position) - and is computed
from it by Philox4x64-10, the generator the 5.9 evaluation streams already use. The address of a number is used once
in the life of a training state. Consequences (MATHEMATICAL-VALIDATION-5.11.md):

* **Proven:** within a state, no two random numbers come from the same generator input, for any number of updates,
  deals, threads, stops and continuations. There is no cycle to run around and nothing to overlap.
* A state stores no generator state. Stopping and continuing cannot change a number; the thread count cannot either.
* 53 random bits per number instead of 32; a 64-bit seed (`"trainingSeed"`, optional).

The 32-bit streams of 5.10 and earlier are segments of one cycle of 2^32 states. With frozen batches their per-deal
action streams coincide in counted cases (for seed 101: 34 of 640,000 streams after 10,000 updates repeat an earlier
stream exactly; 412,458 of 64,000,000 after 1,000,000 updates). That is a fact about the streams, established by
arithmetic; this release found no measurable harm from it (section 3).

### 2. The 10,000,000-update limit is gone for states trained with the new streams

| Streams of the state | Limit of one training state |
|---|---|
| philox64 | 140,737,488,355,327 updates (set by exact integer counters; 10,000,000 with DCFR weighting) |
| 5.10 | 10,000,000 updates, as before |

A study may now ask for up to 2,000,000,000 sampled deals per seed at one deal per update (the study's own input
bound; it was 10,000,000). The self-test trains a state to 10,000,200 updates and a state whose update index is above
2^32, on every platform, to recorded bytes.

### 3. Convergence: no worse than 5.10 (CONVERGENCE-5.11.md)

The decision rule was written before anything was measured. 17 reference games with exact NashConv, 32 seeds, the
unchanged 5.10 program against 5.11 with philox64.

| Comparison | NashConv with philox64 / with the 5.10 streams | Interval | Verdict by the rule |
|---|---:|---|---|
| equal training time, 2 s (primary) | 1.030 | 0.985 to 1.078 | no worse (margin 10%) |
| equal sampled deals, 500,000 | 0.957 | 0.921 to 0.995 | better - recorded, not claimed as an improvement |
| frozen batches of 64, 512,000 deals (where the 5.10 streams coincide) | 1.008 | 0.977 to 1.039 | no worse |

The 5.11 program with the 5.10 streams wrote the states of the 5.10 program in 544 of 544 cases. None of the 58
single cells is worse. The rule is met.

**What it costs.** The new generator does more arithmetic per number. Per sampled deal, measured: about 2 to 3% more time on the study fixtures and 5 to 15% on small reference games in an alternating benchmark on the build machine; 0.89 to 1.01 of the deals per second in single runs on two hosted runners (PERFORMANCE-5.11.md). That is why the equal-time result is "no worse within 10%" and not "equal". With `trainingStreams=5.10` the speed is that of 5.10.

### 4. Which streams are used

* **New studies** (Study tab, `mwcli --study`) train with **the counter-based 64-bit streams (philox64)**, because the rule of section 3 was met. `trainingStreams=5.10` selects the
  streams of 5.10, and then a 5.11 study gives the measurements of 5.10 and earlier, number for number (tested against
  the archived 5.6 and 5.7 programs).
* **A spec decides for the command-line trainer.** A spec without `"trainingStreams"` - every spec written by 5.10 or
  earlier - trains with the 5.10 streams and writes the 5.10 states, byte for byte.
* **A saved state or study checkpoint continues under the streams that trained it**, always.
* **The interactive multiway panel** keeps the 5.10 streams and its 10,000,000-update bound in this release (it hands
  states between the JavaScript engine and the native one, and the JavaScript engine has the 32-bit generator only).

### 5. Checkpoints know their streams

A philox64 state names its streams (`streams-5.11-philox4x64-v1`) and its seed in the header, carries no 32-bit
generator state, and has its own study identifier. A 5.10 state is refused by a philox64 engine, a philox64 state by
a 5.10 engine and by another seed, each with the reason and nothing written. **The unchanged 5.10 program refuses a
philox64 state** (tested with the 5.10 binary). No file format changed; 5.10 states have the 5.10 header.

### 6. Validation you can run

`mwcli.exe --selftest511 studies <folder> [all|streams|training|checkpoint|limits]`: 26 checks, among them a **counter
audit** - every counter handed to the generator in seven real trainings is recorded and none occurs twice - and 17
recorded states that every platform must reproduce. `validate_windows511.ps1` is the 5.10 script with two sections
added; `Run 5.11 focused validation.bat` and `Run 5.11 Windows validation.bat` run them.

## What did not change

The training algorithm (external sampling MCCFR; `rbes` stays experimental and opt-in, and works with either kind of
streams), every training option, the evaluators and their statistics, the trained response and its evaluation
streams, CUDA kernels and scheduling, hand grouping, file formats, the interface, the preflop charts. With the 5.10
streams the trainer writes the states of 5.10: 14 recorded states, 225 configurations against the unchanged 5.10
program, and 544 states of the experiment, all identical.

## Compatibility

* States and checkpoints of 5.10 and earlier load and continue as before, under their own rules, to the same bytes.
* A philox64 state cannot be opened by 5.10 or earlier (refused with a reason).
* Study results of 5.11 are not the numbers of 5.10 unless the study asks for `trainingStreams=5.10`: other random
  numbers, the same distribution. A study result records its streams (`run.trainingStreams`).
* Study checkpoints are tied to their build, as before. A checkpoint of another build is now refused with that reason
  first ("written by build ...") whatever its plan.

## Known limitations

* **Nothing of 5.11 has run on your PC or on an NVIDIA GPU.** The Windows programs ran under Wine and on a hosted
  Windows runner (4 virtual processors, no GPU): see VALIDATION-5.11.md and WINDOWS-CI-5.11.md.
* The convergence evidence is for small games with exact NashConv on the build machine. Nothing was measured for hand
  groups or for games too large for the exact best response (same limitation as every release).
* The cost of the generator on your CPU is unmeasured; the Windows script prints it (section "streams 5.11").
* Statistical quality of the numbers rests on the published record of Philox4x64-10, not on a proof (none exists for
  any generator).
* The interactive panel, DCFR and the training of a response keep a 10,000,000-update bound.
* The browser-only edition (EightMax-Offline.html) trains in JavaScript with the 32-bit streams.
* The archive is within 4% of the 100 MiB limit of the repository that distributes it; later phases will have to
  move old evidence out of the archive.

## Files of this release

`EightMax-Windows-5.11.zip` and, beside it, `EightMax-Windows-5.11.identity.json` (the archive's SHA-256, the build,
the smoke tests made on an extracted copy), `SHA256SUMS-delivery.txt`, the reports, and `WINDOWS-CI-5.11.md` (the
delivered archive on a hosted Windows runner).
