# EightMax 5.17: final development report (Phase 7: exact exploitability on the GPU)

Build `6efe7970626b6460`, successor of 5.16 (`39600509cc5a98e8`).

## 0. The short version

The brief for this phase: *exact exploitability on GPU: a full best response over whole ranges for heads-up
postflop, bit for bit against the CPU.*

| | | Status |
|---|---|---|
| A full best response over whole ranges, heads-up postflop | method `exact-hu`, `brhu-5.17-v1`; river, turn and flop starts | **built**; 0.06 to 0.27 seconds for a turn (1128 hands a seat), 5 to 8 seconds for a flop (1176 hands a seat) and about 0.01 seconds for a river on one CPU thread here |
| ... is it the exact number? | against method `exact` wherever that finishes; rule written beforehand | **yes, tested**: On 66 evaluations where both finish, every value agrees within the bound of 1e-9 relative; the largest difference seen is 2.9e-14 |
| ... where method `exact` gives up (whole-range flops, the wide whole-range turn) | no second method exists | **not confirmed by a second method** |
| A GPU path | the same source handed to the OpenCL driver of the card | **built** |
| ... bit for bit against the CPU | enforced at run time: arithmetic probe, repetition on the CPU, failure on one bit | **tested on a stand-in only**: 624 of 624 runs (2, 3 and 4 threads; `brDevice` gpu and both; device batches of 48, 64 and 4096) have the bits of one CPU thread |
| ... on an NVIDIA card | I have none | **untested**: the validation script answers it on your PC |
| ... faster than the CPU? | | **unknown**. The CPU version takes seconds; the card may bring little at this size |
| Trainers and every earlier study | the unchanged 5.16 binary: 225 configurations and 224 fixture cases, 0 differences | **tested**, byte for byte |
| Self-test, Windows script, launchers, ZIP, identity file, reports, branch | | delivered |
| Your PC | | **untested** - and 5.11 to 5.16 with it |

## 1. Baseline

Before the first change, the delivered 5.16 archive was extracted and its source rebuilt: all 9 artifacts byte-identical to the delivered files. On that
tree the eleven self-tests pass, and the regression suite gives 715 tests: 714 passed, 0 failed, 1 skipped. The
rebuild was compared before the first change; the self-tests and the suite of that separate, untouched tree
finished while development had already begun. VALIDATION-5.17.md, section 1.

## 2. What was built

* **`native/brhu_kernel.h`**: the work of one river subtree on one complete board (an "item"), written once in the
  common subset of C++ and OpenCL C. The CPU path compiles it; the device path hands the same text to the driver.
* **`native/brhu517.hpp`**: the host side. Tables, the walk over the streets before the river, threads, batches,
  the repetition on the CPU, the fixed order in which items are added.
* **`native/brhu_ocl.hpp`**: OpenCL, loaded at run time (the program starts without it), the device choice, the
  arithmetic probe.
* **Request and answer**: `{"method":"exact-hu"}` with `brDevice`, `verifyEvery`, `threads`; the answer carries every
  value with its bits, a block `exactHu` (boards, items, seconds by stage) and a block `gpu` when a device worked.
* **`mwcli --selftest517`** (7 CPU checks, 6 device checks), **`mwcli --opencl-info`**, `validate_windows517.ps1`
  (33 sections), two launchers, `tests/v517.test.js` (9 tests), `tools/games517.js`,
  `tools/independent_brhu517.py`.

Method `exact` is untouched. The two methods add the same terms in a different order, so they agree to rounding and
not to the bit; that is why the new one has its own identifier.

## 3. Rules written before measuring, and their outcomes

| Rule | Outcome |
|---|---|
| R1: every value within 1e-9 relative of method `exact`, wherever it finishes | **met**: within the bound on 66 of 66 evaluations, largest relative difference 2.91e-14; method `exact` refused on 12 more, where no check is possible |
| R2: identical bits for 1 to 4 threads, `brDevice` cpu / gpu / both, batches of 48 / 64 / 4096 | **met**: 624 of 624 runs (2, 3 and 4 threads; `brDevice` gpu and both; device batches of 48, 64 and 4096) have the bits of one CPU thread; 2,042,200 items worked on the device (an OpenCL implementation on the CPU, not a GPU), 1,084,960 repeated on the CPU, 0 with other bits |
| R3a: the probe must be able to refuse a device | shown on this device: the kernel with unprotected products, compiled with `-cl-mad-enable`, is refused (the arithmetic of this device differs from the CPU in 2989 of 20480 probe values (first: a product followed by a sum (the device fuses them))). The protected kernel passes on the same device |
| R3b: an altered device result must be found | shown: with one bit of one device result altered (`EM_BRHU_TEST=flip`) the request fails and reports no value (`--selftest517` G5, natively and under Wine) |
| R4: seconds against method `exact` (reported; "faster" only if the slowest run beats the other's fastest) | compared on 33 games: exact-hu faster on 30; not faster by the rule on `rg-hu-river-exact`, `ho-hu-river-compact`, `ho-hu-river-ranked` (a few milliseconds each, where starting the process dominates); ratio of medians 1.1 to 1080 |
| R5: nothing else changes | met: 225 configurations and 224 fixture cases, 0 differences; self-tests 5.7 to 5.16 with their recorded tables |

Amendments: two (CONVERGENCE-5.17.md, section 7). The second was written **after** the results: the plan said a
table with 0 deals would be evaluated as well; the runner had used a table trained for one deal, for no good
reason. The 0-deal tables were then evaluated with the same checks: R1 within the bound on 33 of 33 (largest relative difference 1.3e-14; method `exact` refused on 6), R2 identical bits in 312 of 312 runs.

## 4. Proven, tested, untested

* **Follows from the definitions:** exact-hu computes the same sum as method `exact` (MATHEMATICAL-VALIDATION-5.17.md,
  sections 1 to 3); the result does not depend on threads, batches or device, because items are added on the host in
  a fixed order and each item is a fixed sequence of IEEE operations; a device result is never reported after a
  difference in a repeated item.
* **An argument, not a proof:** that a conforming OpenCL device gives the CPU's bits. It assumes the driver does
  what the standard says. The program checks instead of trusting: probe and repetition.
* **Tested:** twelve games, up to four groupings; method `exact` and an independent program as references; threads;
  batch sizes; the device path on an OpenCL CPU implementation, natively and through the Windows executable under
  Wine; both guards made to fail; sanitizers; the Windows launchers on a hosted runner (no OpenCL device there);
  everything earlier against the unchanged 5.16 program.
* **Not established:** the whole-range flop and wide-turn numbers by a second method; anything about a real card.
* **Untested:** everything on your PC and on the GPU.

## 5. Decisions I made that are yours to overrule

1. **OpenCL, not CUDA.** The engine's existing GPU code is CUDA. For this kernel I wanted the driver to compile the
   very text the CPU compiles, and I could not run NVIDIA's compiler on the development machine: running the
   downloaded NVIDIA tools was not permitted there, and I did not work around that. NVIDIA's driver ships OpenCL, so
   nothing needs installing. If you want CUDA, the kernel is plain C and the port is small - but it would again be
   code I cannot compile or run here.
2. **A new algorithm, not a GPU port of method `exact`.** The old method walks the tree once for every own hand.
   Moved to a card it would still do thousands of times the work. The new one carries all hands at once and is
   60 to 1000 times faster than the old one on the CPU alone for whole ranges. The consequence is uncomfortable for
   the phase's title: **the GPU may not be worth using** at these tree sizes. The script on your PC measures it. I
   make no claim either way.
3. **"Bit for bit" is enforced, not assumed.** The price: by default every 16th item is worked twice
   (`verifyEvery`), and `brDevice both` works everything twice. If your card passes for a while you may want a
   larger `verifyEvery`; I would not set it to 0.
4. **Scope: two seats, postflop start, chip values.** As the brief says. Preflop starts, three or more seats and
   tournament payoffs are refused with a reason. Method `exact` still serves the small multiway and ICM games.
5. **No button in the interface.** The method is reachable through `mwcli --gain` and the protocol
   (`MW-PROTOCOL.md`). The Study tab's exploitability display still uses the methods it used. Wiring it in changes
   what the interface shows for existing studies, and I did not want to do that before a card has run it.
6. **A stand-in device for the tests.** With `EM_BRHU_ALLOW_CPU_DEVICE=1` the program accepts an OpenCL device that
   is a CPU. Off by default; the answer always says whether the device was a GPU.
7. **No whole-range repeat of Phase 6.** The tool for it now exists; one data point a game is in
   CONVERGENCE-5.17.md, section 6. A proper measurement is its own piece of work with its own rules.

## 6. Unresolved, not done, or not established

* Whether the RTX 4060 Ti passes the probe, gives the CPU's bits, and is faster than 24 threads. All three: your PC.
* A second method for the whole-range flops.
* Trees with many more river nodes or bet sizes than those measured (up to 390 river nodes,
  61,152 items); memory on 8 GB of card memory for such trees. Batches adapt to memory; untested on a card.
* Whole-range flops with Exact cards: the table does not fit.
* exact-hu from the interface and through the desktop host's job routes.
* Grouping error at whole-range size, measured properly.
* Still open from Phase 4: `rbes` as automatic trainer (your run of the 5.13 kit), pruning and threads on your
  processor (the 5.14 equal-time launcher).
* From earlier phases, unchanged: ROADMAP.md.

## 7. What to run, and what to send back

WINDOWS-TESTS-5.17.md has the steps. In order of value:

1. `Run 5.17 focused validation.bat`: send `Windows-focused-validation-5.17.json`, `.txt`,
   `Windows-selftest517-5.17.json`. This is the run that says whether the card gives the CPU's bits.
2. `Run 5.17 Windows validation.bat` (GPU included): `Windows-validation-5.17.json`, `.txt`, the twelve
   `Windows-selftest*-5.17.json`, `hardware-validation.json`.
3. The 5.13 `rbes` kit, if not yet run: its folder `rbes-equal-time-results`.
4. `Run 5.14 equal-time comparison.bat`: the folder `equal-time-results` without `units`.
