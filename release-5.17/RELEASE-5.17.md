# EightMax Windows 5.17

Build `6efe7970626b6460`. Successor of 5.16 (`39600509cc5a98e8`). This is **Phase 7** of the ten-phase plan: exact
exploitability on the GPU, a full best response over whole ranges for heads-up postflop games, bit for bit against
the CPU.

**The short version.**

* **There is now an exact best response for heads-up postflop studies with whole ranges.** Request method
  `exact-hu`. With every hand the board leaves for both players it takes 0.06 to 0.27 seconds for a turn (1128 hands a seat), 5 to 8 seconds for a flop (1176 hands a seat) and about 0.01 seconds for a river on one processor core of the
  development machine. The method of earlier releases (`exact`, unchanged) needs 67 to 229 seconds for the whole-range
  turn and gives up on the whole-range flops.
* **It gives the numbers of method `exact`.** On 66 evaluations where both finish, every value agrees within the bound of 1e-9 relative; the largest difference seen is 2.9e-14.
* **It runs on the CPU or on a graphics card, from one source, and the result must be the same down to the last
  bit.** Before the card is used the program tests its arithmetic; while it is used, part of its work is repeated on
  the CPU. If a bit differs, no number is reported.
* **No graphics card has run it yet.** I have none. The device path was run on a stand-in (an OpenCL implementation
  on the CPU), natively and through the Windows executable: 624 of 624 runs (2, 3 and 4 threads; `brDevice` gpu and both; device batches of 48, 64 and 4096) have the bits of one CPU thread. Whether the RTX 4060 Ti gives the same
  bits is the first thing the validation on your PC answers; whether it is faster than your 24 threads is the
  second. **Because the CPU version is already this fast, the GPU may bring little** on trees of this size; the
  script measures it and I make no claim.

No trainer changed, no grouping changed, no default changed. Every study trains to the states of 5.16.

First thing to do on your PC: **WINDOWS-TESTS-5.17.md**. Reports: FINAL-REPORT-5.17.md, CONVERGENCE-5.17.md (the
comparisons), MATHEMATICAL-VALIDATION-5.17.md, VALIDATION-5.17.md, BUILD-5.17.md.

## What is new

### 1. Method `exact-hu`

For a study with **two seats** that starts on the **flop, turn or river** with **chip** utility:

    mwcli.exe --gain <spec.json> <state> <request.json> [memoryMiB]

with the request

    {"method":"exact-hu"}                          the CPU, every logical processor
    {"method":"exact-hu","threads":8}              the CPU, eight threads
    {"method":"exact-hu","brDevice":"gpu"}         the graphics card; every 16th item repeated on the CPU
    {"method":"exact-hu","brDevice":"both"}        the graphics card; every item repeated on the CPU

The answer has, for each seat, the value of the stored strategy, the value of the best response against the other
seat's stored strategy, and their difference (the gain); and NashConv and the exploitability (NashConv / 2). Every
value is also given as its bit pattern (`gainBits`, `nashConvBits`, ...), which is what "the same result" means in
the checks. The best response sees real cards on every board; a hand grouping only decides which stored row a hand
reads.

The same request goes to the desktop host (`POST /api/mw/response-gain`). **There is no button for it in the
program window**, and the background-job route was not tested with it.

Refused, with the reason: three or more seats, a preflop start, a tournament payoff (use method `exact`); tables
that do not fit in `memoryMiB`; `"missing":"refuse"` when a hand has no stored strategy.

### 2. The graphics card

`mwcli.exe --opencl-info` lists what the program sees and whether it would use it. The card is reached through
OpenCL, which the NVIDIA driver installs; nothing else is needed. The program:

1. hands the driver the same source text the CPU path was compiled from;
2. runs a probe of 20,480 values and requires the bits of the CPU for each. A card that fails is not used;
3. sends the work in batches sized to about a fifth of a second, so the screen stays responsive;
4. repeats items on the CPU as the request says and compares every bit. One difference: the request fails, no
   number.

If no card can be used, `"brDevice":"gpu"` fails with the reason and `"brDevice":"cpu"` computes the same value.

**This is OpenCL, not CUDA.** The rest of the program's GPU code is CUDA. A new CUDA kernel has to be compiled with
NVIDIA's compiler before release, and running that compiler on the development machine was refused by its safety
rules. OpenCL is compiled by the driver on your PC. If you want a CUDA version, say so; the kernel is plain C.

### 3. What it makes possible: grouping error at whole-range size

Phase 6 could measure the error of Compact, Detailed and Ranked only on games of 10 to 60 hands a seat. With
`exact-hu` the same measure exists for two players with whole ranges. 5.17 did not repeat that measurement; it
reports one data point a game (one seed, one training length), in CONVERGENCE-5.17.md, section 5:
* `wr-river`: Compact 1.5, Detailed 2.1, Exact cards 4.1
* `wr-turn`: Compact 5.1, Detailed 11.0, Ranked 2.5, Exact cards 29.4
* `wr-turn-wide`: Compact 12.1, Ranked 12.0
* `wr-flop`: Compact 10.0, Ranked 7.7
* `wr-flop-allin`: Compact 9.4, Ranked 10.6

Percent of the starting pot a player; one seed, 200,000 deals (the flops 1,000,000). Not a floor and not a verdict.

## What did not change

* **Training.** 225 configurations and 224 fixture cases, 0 differences to the same bytes; the self-tests of 5.7 to 5.16 pass with their recorded tables
  untouched.
* **Methods `exact`, `restricted` and `sampled`.** Same code, same numbers.
* **Checkpoints and file formats.** The new method reads a state; it writes none.
* **The page, the fixtures, the libraries, CUDA.**

## Limits

* Two seats, postflop, chip EV.
* The whole table of the study must fit in memory (and, for the card, in the card's memory): a whole-range flop
  with Exact cards does not. A whole-range flop with Compact or Ranked does.
* On games where method `exact` does not finish there is no second computation of the same number
  (MATHEMATICAL-VALIDATION-5.17.md, section 3).
* The numbers are inside the study's betting tree, as for every evaluation in EightMax: bet sizes the study does
  not contain are not considered (Phase 8).

## Files

`EightMax-Windows-5.17.zip` (about 89 MiB). The second archive of 5.12, `EightMax-5.12-evidence-2.3-to-5.8.zip`, is
unchanged and not delivered again. Linux programs of this build, for reference: `linux-bin/` beside the ZIP.

`mwcli.exe --selftest517 validation\5.17\windows\brhu studies <folder> all` is the self-test of this release;
`validate_windows517.ps1` is the 5.16 script with two sections added.
