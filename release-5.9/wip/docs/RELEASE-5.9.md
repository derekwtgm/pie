# EightMax Windows 5.9

Build `@BUILD@`. Successor of 5.8 (build `d4001e2c0cd77f41`). Windows 11 x64; self-contained (no Python, Node.js,
compiler or runtime to install).

**Status in one paragraph.** 5.9 corrects how the trained-response quality measure reports confidence, makes its
evaluation 1.1 to 2.4 times faster (most on tables that do not fit the processor's caches) without changing a bit of its results, gives its evaluation random streams a
provable partition, and removes the folder a refused study used to leave behind. **It does not train strategies
differently**: with the same settings 5.9 writes the states 5.8 wrote, byte for byte, so nothing here is a
convergence improvement. Everything was built and tested on Linux and, as Windows executables, under Wine. **Nothing
in 5.9 was executed on Windows hardware or on an NVIDIA GPU** (WINDOWS-TESTS-5.9.md says how to do that in one
double-click).

## What is new

### 1. Confidence statements you can quote (STATISTICAL-CHANGES-5.9.md)

`mwcli --response` now prints, in `summary`:

* **`simultaneous.nashConvLowerBound`** - a lower bound of NashConv that holds for all seats at once with the
  requested confidence (default 95%), without a normal approximation and without assuming that the seats are
  independent. This is the number to quote.
* `pooledIndependent.nashConvLowerBound` - a tighter bound for several seats that additionally assumes independent
  seat evaluations.
* per seat, `sampled.lowerBound` - the one-sided distribution-free bound of that seat at its share of the level.
* the 5.8 number `sumOfSeatLowerBounds95` is kept with its value and meaning, also under the explicit name
  `sumOfNormalApproximationLowerBounds95`, and is marked deprecated: it is a sum of normal-approximation bounds and
  not a confidence statement.

New request fields: `confidence`, `analyses` (when you will report the best of several prespecified analyses),
`evaluationSeed`, `randomStreams`.

Measured against exact values (MATHEMATICAL-VALIDATION-5.9.md): 0 of 15,920 seat bounds and 0 of 3,240 simultaneous
statements above the truth; the 5.8 normal-interval failure (193 of 960 estimates more than four standard errors
off) reproduced with the unchanged 5.8 program. The price: a distribution-free bound certifies less than the
estimate suggests - a median 49% (simultaneous) and 67% (pooled) of exact NashConv at 51,200 evaluation deals on the
reference games, and nothing on games whose whole NashConv is a few hundredths of a unit. Use more evaluation deals.

### 2. Faster evaluation of a trained response (PERFORMANCE-5.9.md)

The evaluation walk spent four fifths of its time in four dependent memory reads per strategy lookup. 5.9 looks a
row up once instead of twice at the responding seat's decisions, computes strategy keys once per deal, and builds a
32-bit offset per hash slot for the duration of an evaluation call so that a lookup waits for two reads instead of
four. Same nodes, same random numbers, same arithmetic: **the estimates have the bits 5.8 printed** (with the 5.8
streams). When `threads` is not given, the evaluation now uses every logical processor (5.8 used one); the result
does not depend on the thread count.

### 3. Evaluation random streams with a provable partition

The default evaluation streams are now counter-based (Philox4x64-10): every random number has an address (seed,
seat, block, purpose, position), and two addresses never receive the same number. The overlap risk 5.8 documented
for very large evaluation budgets is gone. `"randomStreams": "5.8"` selects the 5.8 streams and reproduces 5.8 bit
for bit. A default request therefore prints other sampled estimates than 5.8 did (as another seed would); exact
values and trained responses are identical.

### 4. A refused study leaves no folder (desktop host)

When the engine refuses a study (a budget above the update limit, an invalid configuration), the host now removes
what that request created - and only that. Existing folders, files that are not EightMax's, existing checkpoints and
running studies are never touched; nothing is removed recursively. `GET /api/study/status` reports the outcome in
`refusedStudyFolder`. Folders that 5.8 left behind (holding only `request.json`) are not removed automatically; they
can be deleted by hand.

### 5. Validation you can run

* `Run 5.9 focused validation.bat` (5 to 12 minutes): what 5.9 added.
* `Run 5.9 Windows validation.bat` (20 to 60 minutes): everything, including the 5.7, 5.7.1 and 5.8 self-tests.
* `Run 5.9 response example.bat`: a worked example of the new confidence statement.
* `mwcli.exe --selftest59` (32 checks) needs no PowerShell.

## What did not change

* The default trainer and every optional trainer; all checkpoint formats (EMMW4, EMZ1, study checkpoint version 1);
  deterministic continuation; the memory budget; checkpoint corruption recovery; the 5.7.1 checkpoint-commit repair.
  A state trained by 5.8 continues under 5.9 to the same bytes. (A STUDY checkpoint is tied to its build, as before:
  5.8 study checkpoints are refused with the reason.)
* Tournament structure defaults (0.5 / 1 blinds, 0.1 BB ante per player, 2.3 BB in the pot eight-handed), stacks,
  ranges, bet sizes, chip EV and ICM, CFR / CFR+ / DCFR options, experimental estimators.
* CPU-only, Automatic, Hybrid and GPU-Preferred processing. **No CUDA code changed.**
* The interface. The separate EightMax Test Workbench is not part of this release and was not modified.

## Research results that changed nothing in the product

* **Convergence** (CONVERGENCE-5.9.md): three optional trainers were tested against the default on seven games with
  exact NashConv (448 training runs, 42 corrected comparisons). Discounted CFR and regret matching+ were
  significantly worse in 27 of 28 comparisons; the terminal-baseline estimator was not distinguishable from the
  default and costs about 45% more time per deal. **No trainer was promoted; six-player flop convergence is not
  improved in 5.9.**
* **Strategy-table memory access in the trainer**: a prefetch experiment gave no measurable gain and was not adopted
  (`validation/5.9/experiments/prefetch-row-slot.md`). The offset index that works for evaluation would change the
  trainer's memory accounting and is left for a release that changes the state format deliberately.

## Compatibility

| | |
|---|---|
| trained states (EMMW4, EMZ1) | unchanged; 5.8 states load and continue identically |
| study checkpoints | format unchanged; tied to the build as before |
| `mwcli --response` result | every 5.8 field still written with its meaning; new fields added; `tool` and `sampled.version` name 5.9; default sampled estimates use other random numbers (`"randomStreams": "5.8"` restores them) |
| 5.8 result files | not touched; still valid as written |
| desktop host API | `/api/study/status` gains `refusedStudyFolder`; nothing removed |
| command line | new: `--selftest59`, `--streams59`; everything else as in 5.8 |

## Known limitations

1. **Not run on Windows hardware or an NVIDIA GPU.** Wine is not Windows. See WINDOWS-TESTS-5.9.md.
2. **Lower bounds only.** No number in EightMax bounds NashConv from above in large games. A small lower bound does
   not show that a strategy is close to equilibrium, and no percentage of optimality is claimed anywhere.
3. **Distribution-free bounds need many deals** when the gains are small against the stacks (STATISTICAL-CHANGES-5.9.md,
   section 6). On ICM games with tiny NashConv they certify nothing at the default sample count.
4. **The response training is unchanged** in algorithm and speed: one thread per seat with one deal per update. Its
   table is a private copy per seat (`parallelSeats` multiplies memory).
5. **The training random generator is unchanged** (2^32 states per stream): the 5.8 limitation for frozen batches
   near the update limit stands.
6. **Convergence in large multiway games is not improved**; the update limit (10,000,000 updates per state) stands.
7. The validation script was executed with PowerShell 7.4 on Linux, not with Windows PowerShell 5.1 on Windows.

## Files of this release

`FINAL-REPORT-5.9.md` (what was done and what was not), `MATHEMATICAL-VALIDATION-5.9.md`, `STATISTICAL-CHANGES-5.9.md`,
`CONVERGENCE-5.9.md`, `PERFORMANCE-5.9.md`, `VALIDATION-5.9.md`, `WINDOWS-TESTS-5.9.md`, `BUILD-5.9.md`; evidence
under `validation/5.9/`. `USER-GUIDE-5.8.md` remains the guide to studies and to the response measure;
STATISTICAL-CHANGES-5.9.md is its supplement for the new fields.
