# EightMax 5.17: validation

Build `6efe7970626b6460`. "Development machine": an Ubuntu 24.04 container with 4 processors and no GPU. "Runner": a hosted
GitHub Actions machine. "The OpenCL device" on the development machine is PoCL, an OpenCL implementation that runs
on the CPU: it exercises the program's device path and says nothing about a graphics card. Nothing here ran on the
target PC or on a GPU. Decision rules: `validation/5.17/plan.json`. The comparisons are in CONVERGENCE-5.17.md; what
is computed and why the two paths must agree, in MATHEMATICAL-VALIDATION-5.17.md.

## 1. Baseline: 5.16

The delivered 5.16 archive (SHA-256 `e22eabf9...0c3e`) was extracted into an empty folder and its source rebuilt on
the development machine: all 9 artifacts byte-identical to the delivered files (`validation/5.17/baseline/`). On that rebuilt tree:

* the eleven self-tests (5.7 to 5.16): all exit 0;
* the regression suite: 715 tests, 714 passed, 0 failed, 1 skipped (a permissions test that cannot work as root).

The rebuild was finished and compared before the first change of Phase 7. The self-tests and the regression suite
of that separate tree were started then and ran for about 80 minutes; by the time they ended I was already writing
the new code in the development tree. The baseline tree itself was never touched.

## 2. Nothing that trained before trains differently, nothing that was evaluated before is evaluated differently

| Check | Result |
|---|---|
| The unchanged 5.16 binary against 5.17, `tools/identity57.py` | 225 configurations, 1782 trainings, 0 differences |
| The unchanged 5.16 binary against 5.17, every study fixture (26; two also regrouped as Detailed): default trainer and `rbes`, both kinds of streams, one deal per update and frozen batches | 224 cases (112 of them `rbes`; by grouping: compact 88, detailed 8, detailed (regrouped) 16, exact 112), 0 different |
| Self-tests 5.7 to 5.16 with their recorded tables untouched | all passed on Linux (28 / 24 / 33 / 32 / 21 / 26 / 8 / 14 / 7 / 12 / 6 checks); under Wine: every one exit 0; on the hosted Windows runner: every one passed, inside both launchers |
| Method `exact`: 5.16 and 5.17 give the same gain bits for the same request (four heads-up games) | `tests/v517.test.js`; every earlier test of methods exact, restricted and sampled passes unchanged (section 6) |
| The equal-time tool of 5.14: a fresh recording of its reference values; quick trials | recording exit 0, 2 of 2 files identical to the shipped ones; pruning: exit 0, equal-deals check passed; threads: exit 0, equal-deals check passed |
| The Ranked grouping of 5.16, JavaScript against native | identical tables in 9 of 9 runs |
| The 26 fixtures | regenerate byte for byte (`fixtures52.js --check`: 26 identical; `studies/` equals `source/studies` (exit 0)) |
| The programs of 5.10 to 5.16 given a request with method exact-hu, and the state they train for the same spec | the request is refused by every one of them (5.16, 5.15, 5.14, 5.13, 5.12, 5.11, 5.10) and each trains the state 5.17 trains |

## 3. The comparisons of the plan

| Rule | Result |
|---|---|
| Units | 39 (a game with a grouping; trained, and trained for one deal), 0 with an error |
| R1: agreement with method `exact`, 1e-9 relative, every value | **met**: within the bound on 66 of 66 evaluations, largest relative difference 2.91e-14; method `exact` refused on 12 more, where no check is possible |
| R2: one result for every way of running it | **met**: 624 of 624 runs (2, 3 and 4 threads; `brDevice` gpu and both; device batches of 48, 64 and 4096) have the bits of one CPU thread; 2,042,200 items worked on the device (an OpenCL implementation on the CPU, not a GPU), 1,084,960 repeated on the CPU, 0 with other bits |
| R3a: the probe must be able to refuse a device | shown on this device: the kernel with unprotected products, compiled with `-cl-mad-enable`, is refused (the arithmetic of this device differs from the CPU in 2989 of 20480 probe values (first: a product followed by a sum (the device fuses them))). The protected kernel passes on the same device |
| R3b: an altered device result must be found | shown: with one bit of one device result altered (`EM_BRHU_TEST=flip`) the request fails and reports no value (`--selftest517` G5, natively and under Wine) |
| R4: seconds against method `exact` | compared on 33 games: exact-hu faster on 30; not faster by the rule on `rg-hu-river-exact`, `ho-hu-river-compact`, `ho-hu-river-ranked` (a few milliseconds each, where starting the process dominates); ratio of medians 1.1 to 1080 |
| R5: nothing else changed | section 2 |
| Independent program against exact-hu (five games with Exact cards, 100,000 deals) | 5 of 5 games agree within 1e-9 |

**Mistakes of mine in this phase, for the record.** (1) While adding a comment I cut a line of the probe's expected
values in half; the probe then refused the device for every kernel. Found the same hour by the device being refused,
before anything was measured. (2) The result block of the new method was first called `work`, a name the response
already used; the tests found the collision. (3) The first Windows build failed: two names I had chosen are macros
of the Windows headers. (4) The game `mid-flop` was first too wide for method `exact` (amendment 1, before results).
(5) A regression test of mine gave method `exact` the default time limit on a whole-range turn and failed on a
loaded machine; the test now uses a smaller game.

## 4. The new method

| Check | Result |
|---|---|
| `mwcli --selftest517` (7 CPU checks, 6 device checks) | Linux: 13 passed, 0 failed, 0 skipped (the device checks on the OpenCL CPU device); under Wine: 13 passed, 0 failed, 0 skipped; on the hosted Windows runner: 7 CPU checks passed, the 6 device checks skipped (no OpenCL platform), twice |
| A fresh recording of the cases against the shipped reference | recording exit 0, comparison exit 0 (12 of 12 cases identical to the shipped reference) |
| One source for both paths | the embedded kernel text equals `brhu_kernel.h` (`gen_brhu.py --check`, in `tests/v517.test.js`); the kernel calls no floating-point library function; every product that feeds a sum goes through `BR_MUL` |
| Threads | 1, 2, 3, 4 give the same bits (R2; `--selftest517` B2); ThreadSanitizer below |
| Fallbacks, policy current, refusals | `--selftest517` B4, B5, B6; `tests/v517.test.js` |
| The OpenCL device of the development machine | `cpu-skylake-avx512-Intel(R) Xeon(R) Processor @ 2.10GHz`, OpenCL 3.0 PoCL HSTR: cpu-x86_64-pc-linux-gnu-skylake-avx512: not a GPU, taken only with `EM_BRHU_ALLOW_CPU_DEVICE=1`; the probe passes with the shipped kernel and refuses the unprotected one |
| The Windows executable under Wine, through Wine's `OpenCL.dll` to the same CPU device | device `cpu-skylake-avx512-Intel(R) Xeon(R) Processor @ 2.10GHz` (a CPU implementation); `--selftest517`: 13 passed, 0 failed, 0 skipped; the 5.17 test file through `mwcli.exe`: exit 0 |

## 5. The interface

5.17 did not change the page. The browser tests of earlier releases were run unchanged:

| Check | Result |
|---|---|
| The Ranked grouping (5.16) | 8 of 8 checks |
| Bounties and future hands (5.15) | 14 of 14 checks |
| The satellite test of 5.13 | 11 of 12 checks (the one that counts three groups fails: there are four since 5.15; the test is run as it was written) |
| Table-size switch and 8-max library views against the 5.12 page | 21 of 21 checks |
| Study tab against the desktop host; refused studies | 20 of 20 checks passed; refused studies: exit 0 |

The satellite test counts the groups of the Study list and expects three; there are four since 5.15. That one check
fails by construction; the test is left as it ran for 5.13.

## 6. Regression suite (`validation/5.17/tests/`)

| | 5.16, this machine (baseline of section 1) | 5.17, this machine |
|---|---|---|
| Tests | 715 | 724 (the 9 of `v517.test.js` are new) |
| Passed | 714 | 723 |
| Failed | 0 | 0 |
| Skipped | 1 | 1 |

Failed in 5.17:

* none

Skipped in 5.17:

* `4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissi` - running as root: permissions are not enforced


## 7. Sanitizers, Wine, runner, build

| | Result |
|---|---|
| Sanitizers (address, undefined behaviour; thread; leak) | 0 reports of the address and undefined-behaviour sanitizers on `--selftest517 cpu` and the 5.17 test file; ThreadSanitizer 0 warnings on exact-hu with four threads on 6 cases (river, turn and flop, up to 1176 hands a seat), NashConv bits equal to the release program on one thread in 6 of 6; LeakSanitizer 0 reports on an answered and on a refused request |
| Windows programs under Wine | every step exit 0: twelve self-tests, the reference states of 5.16, 5.15, 5.13 and 5.12 with 1, 2 and 4 threads, the bits of `mwcli --tour515` and `--satfield`, `eqtime.exe` quick trials, the 5.17 test file through `mwcli.exe` |
| Both launchers on a hosted Windows runner, pre-release tree | focused 149 passed, 1 failed, 1 skipped, 0 untested (606.4 s); full 342 passed, 1 failed, 2 skipped, 0 untested (1206.3 s); `--selftest517` 7 CPU checks passed and 6 device checks skipped in both launchers; the one failure is the manifest a pre-release tree does not have; the skips are the OpenCL GPU section (the runner has no OpenCL platform) and the CUDA section (run 46060574786, Windows Server 2025, Xeon Platinum 8573C, 4 logical processors, Windows PowerShell 5.1) |
| The same on the delivered archive | WINDOWS-CI-5.17.md beside the ZIP |
| Two builds in two directories | 9 of 9 artifacts identical |

The pre-release tree has no `SHA256SUMS.txt`, so its manifest check fails by construction; that check is exercised
by the delivered archive.

## 8. Not validated

* **A graphics card.** No NVIDIA driver has compiled the kernel; no GPU has returned a value. Bit identity with the
  CPU on a GPU, and the speed of a GPU, are untested.
* The target PC; more than 4 processors.
* The values of the games on which method `exact` does not finish (CONVERGENCE-5.17.md, section 2), beyond
  agreement on every game where it does.
* Trees with many more river nodes than the games measured (up to 390 river nodes, 61,152 items).
* The method through the page or the background-job route of the desktop host.
* The in-tree MSYS2 workflow: updated, not run.
