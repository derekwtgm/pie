# EightMax Windows 4.9

Build **278035e3bb5bcaa6** (EightMax.exe, mwcli.exe, gpustress.exe, BUILD-INFO.json and the source
fingerprint agree; two independent Windows builds are byte-identical).

## Where things ran

| Environment | What ran |
|---|---|
| Linux build machine (4 logical CPUs, GCC 13.3, Clang 18.1, no GPU) | clean build, full regression suite on the final binaries, convergence study, benchmarks |
| **GitHub Actions `windows-latest` (real Windows Server, no GPU)** | MSYS2/MinGW build, PowerShell harness, `--selftest47/48/49`, EMZ1 resume with a write-denied TMP/TEMP folder, full regression suite (section 6) |
| Wine 9.0 (not Windows) | final executables: `--selftest47` 10/10, `--selftest48` 9/9, `--selftest49` 15/15 (UTF-8 locale; see section 1) |
| Your PC / RTX 4060 Ti | your 4.8 reports (inputs to this release); nothing of 4.9 has run there |

## 1. Windows compressed-checkpoint restoration (Priority 1, release blocker)

**Your report:** `EightMax-4.7-self-test.json` (4.8 build on your PC): 9/10, the failing check
"150 + 150 resumed from EMZ1 = golden 300", `cannot create a temporary file for decompression`.

**Cause.** `openCheckpoint` (`native/mwcli.cpp`) decompressed EMZ1 into `std::tmpfile()`. The Windows
build links msvcrt.dll (MinGW), whose `tmpfile()` creates the file in the **root of the current drive**
(for example `C:\`), which a standard account may not write. The GitHub runner runs with administrator
rights, so CI passed; explicit `--decompress` worked on your PC because it writes next to the output.
Linux uses a real temporary directory, so it never failed there. No checkpoint was corrupt.

**Repair** (`native/temp_file.hpp`, used by every command that reads a checkpoint):

* exclusive creation (`CreateFileW(CREATE_NEW)` / `mkstemp`) - never overwrites a file;
* unpredictable name (process id, counter, `BCryptGenRandom`), share mode 0;
* automatic deletion: `FILE_FLAG_DELETE_ON_CLOSE` on Windows (also after a crash), `unlink` on POSIX;
* directory order: `EM_TEMP_DIR`, the system temporary folder (`GetTempPathW`: TMP, TEMP, USERPROFILE ...;
  `TMPDIR`/`/tmp`), then the checkpoint's own folder; every failed attempt is named in the error;
* Windows directories handled as UTF-16 (non-ASCII user names), `\\?\` for paths >= 240 characters;
* total decompressed size limited (16 GiB default, `EM_EMZ_MAX_MIB`); block CRC-32, length and SHA-256
  checks are unchanged; nothing is written unless every check passes; memory stays bounded (blocks <= 64 MiB).

**Tests.** `mwcli --selftest49` / `Run 4.9 checks.bat` (15 checks): uncompressed restore; EMZ1 levels 1/6/9
150+150 = golden; unusable system temp folder -> fallback; temp folder with spaces and Unicode
(`temp dir éü 日本`); 260-character temp folder; injected temp-file failure (exit 3, reason named, existing
output unchanged); corrupted block, truncated file and SHA-256 mismatch refused with nothing written;
four concurrent restorations; 500+500 = 1000 and 1000+1000 = 2000 from EMZ1; three compressed
generations = 300 uninterrupted; no temporary file left. Results: Linux 15/15, Wine 15/15, **Windows
runner: passed** (runs 48 and 49). New CI step: TMP and TEMP point to a folder with a *deny write* ACE for
Everyone, then training resumes from EMZ1 - passed on the runner (exit 0, golden hash, no leftover file;
whether the runner's administrator account honoured the deny ACE is recorded in
`windows-emz-denied-temp.json`). `tests/v49.test.js` adds the size limit, the fallback, compressed =
uncompressed canonical state for `--verify`, and a read-only output folder (skipped when running as
root, which ignores permissions).

Under Wine, Unicode file names need a UTF-8 locale (`LANG=C.UTF-8`); with an unset locale Wine itself
cannot create any non-ASCII name (shown with a 6-line test program). Real Windows has no such limit.
Input/output checkpoint paths given on the mwcli command line are still opened through the ANSI code
page (unchanged since 3.x); the temporary file itself is Unicode-safe.

## 2. Clang portability (Priority 2)

`action_ev.hpp`: `leave{T, {}}` copy-list-initialised a `FlatHist` whose default constructor is
`explicit` (ill-formed; GCC accepted it, Clang rejected it). Now `leave{T, FlatHist()}` - the same 64-slot
histogram, `explicit` kept. `mw.cpp` and `mwcli.cpp` compile with **Clang 18.1 and GCC 13.3** under
`-std=c++20 -Wall -Wextra` (test in `v49.test.js`). Remaining warnings: GCC `-Wmisleading-indentation` on
intentional one-line idioms (reviewed: none changes control flow), `-Wsubobject-linkage`,
`-Wignored-attributes`; Clang: one unused function. No numerical change (bit-identity tests pass).

## 3. Regression (Priority 3)

See section 6. The 4.8 chart-count fix was checked against behaviour: the dashboard draws ten charts
and, from one real `--monitor` run, every chart except chart 7 has data points; chart 7 (algorithm
comparison) needs a second, imported run - 4.8 showed only "No data yet." there, 4.9 also shows the
chart's explanation (`web/lib_dashboard.js`).

## 4. Six-player convergence (Priorities 4, 5) - negative result, default unchanged

`tools/convergence48.js`, seeds 401-410, 7 games (heads-up river, three-player river, four-player turn,
four-player bubble ICM, five-player flop, six-player flop, eight-player final table ICM), 8 trainer
configurations, exact best responses of every seat after 5-6 training budgets, one training thread, equal
512 MiB table budget, paired comparisons of ln NashConv at equal sampled deals and at equal training time,
**Holm over all 518 comparisons**. Data: `validation/4.9/convergence`.

| Variant | equal deals: better / worse / n.s. | equal time: better / worse / n.s. |
|---|---|---|
| opponent exploration 0.05 | 0 / 0 / 37 | 0 / 0 / 37 |
| opponent exploration 0.2 | 0 / 1 / 36 | 0 / 0 / 37 |
| opponent exploration 0.4 | 0 / 11 / 26 | 0 / 14 / 23 |
| simultaneous batches of 8 | 0 / 0 / 37 | 0 / 0 / 37 |
| own hands + terminal baseline (4.7 experimental) | **8 / 0 / 29** | 3 / 0 / 34 |
| DCFR (1.5, 0, 2) | 0 / 36 / 1 | 0 / 36 / 1 |
| RM+ | 0 / 37 / 0 | 0 / 37 / 0 |

Six-player flop specifically: no variant better at equal time at any budget; own hands + baseline better
at equal deals only at the first budget (geometric-mean NashConv ratio at 250,000 deals 0.80 at equal deals,
1.09 at equal time). DCFR and RM+ are 6-14x worse with sampling (their full-width advantage does not
transfer, as in 4.7). The default (linear-weighted external sampling, exploration 0.1) at 250,000 deals:
six-player flop NashConv 0.064 bb (95% interval +-0.023 over seeds), five-player flop 0.108 bb.

**Conclusion: no candidate improves six-player strategy quality per second; the validated default is
unchanged.** Code audit (unchanged from 4.8): regret increments `t (pi_-i/q_-i)(v(a) - v)` and average
increments `t pi_i sigma(a) / q_-i` are unbiased; no defect found. All values are measured inside each
study's abstraction; more than two players: NashConv, not exploitability.

## 5. Evaluation memory (Priority 6), Automatic scheduling (Priority 7), checkpoints (Priority 11)

**Adaptive small-table cache.** 4.8 kept up to 1,024 small showdown tables per evaluator; most were stale
tables of earlier own hands. 4.9 sizes the cache to the working set of the exact best response (opponent
tuples of the current own hand + 16, 64-4,096). `tools/brbench48.js`, 4.8 vs 4.9, same checkpoints,
interleaved, 4 threads; **every result bit-identical**:

| Game | 4.8 | 4.9 | time ratio [95%] | peak RSS 4.8 / 4.9 |
|---|---|---|---|---|
| heads-up river | 0.004 s | 0.004 s | 0.99 [0.86, 1.15] | 5.2 / 5.3 MiB |
| three-player river | 0.004 s | 0.004 s | 0.96 [0.92, 1.00] | 5.3 / 5.4 MiB |
| four-player turn | 0.010 s | 0.009 s | 0.97 [0.90, 1.04] | 7.2 / 7.3 MiB |
| four-player bubble, ICM | 0.310 s | 0.309 s | 1.00 [0.93, 1.08] | 271 / 271 MiB |
| five-player flop | 0.114 s | 0.110 s | **0.98 [0.96, 0.99]** | 7.9 / 7.9 MiB |
| six-player flop | 0.524 s | 0.485 s | **0.94 [0.91, 0.97]** | 11.9 / 11.8 MiB |
| six-player flop, weighted, two bet sizes (3 rounds) | 7.83 s | 7.50 s | **0.95 [0.93, 0.97]** | **63.2 / 28.3 MiB** |

Restricted and sampled response gains (four-player turn, six-player flop): no supported difference.
The four-player bubble's 271 MiB are the preflop all-in tables of 4.8's shared cache (bounded by the
request's `memoryMiB`, default 512). With `memoryMiB: 16` the six-player flops and four-player turn stay inside 16 MiB with identical results (test); one bubble table is 17 MiB, so a 16 MiB bubble evaluation falls back to per-board enumeration (exact, much slower).

**Automatic device mode.** Your `device-results.json` (4.8): 2,400 deals took 63.8 ms in CPU Only and
155-168 ms in Automatic, GPU Preferred and Hybrid, all ending on CPU scoring with the same strategy hash.
Cause: every non-CPU mode opened CUDA and ran a calibration (CPU + up to four device routes) before choosing
the CPU. 4.9: **Automatic** times the CPU scoring of the first batch and projects it over the call's
updates; below 0.5 s (`EM_AUTO_MIN_SCORE_SECONDS`) it stays on the CPU without opening the driver and says
so (`devicePath`, `automaticDeviceSkipped`, `automaticProjectedScoreSeconds`). **GPU Preferred and Hybrid
are unchanged**: they always open the device and measure, and may still choose the CPU when it measures
faster ("measured faster than CUDA for this batch size") - they do not guarantee GPU participation.
Verified with the Linux CUDA test double (a simulated driver): Automatic skips the driver for a small job,
GPU/Hybrid still calibrate, a job above the threshold is calibrated, all four modes write the same
strategy bytes. **The time saved on your RTX 4060 Ti has not been measured** (no NVIDIA hardware here);
expected from your report: about 0.1 s per small training call in Automatic.

**Training and checkpoints** (`validation/4.9/tools/bench49.js`, 7 interleaved rounds, identical strategy
bytes in every round): short CPU training 0.98x, Automatic on this GPU-less machine 0.97x, six-player flop
training 1.04x, eight-player linked ICM training 0.99x, EMZ1 restore + 150 updates 0.98x - all "no
supported difference" (training code unchanged). EMZ1 level study (`validation/4.9/checkpoint-levels.json`,
14.2 MiB eight-player state): level 1 0.495 of the size in 0.54 s, level 6 0.455 in 1.10 s, level 9 0.452 in
6.3 s; restore 0.43-0.47 s vs 0.30 s uncompressed; every level byte-exact and resume-identical. **Default
level 6 kept.**

## 6. Regression and validation (Priority 3, 15, 16)

Linux, final binaries (build 278035e3bb5bcaa6), `node tools/run_tests.js`:

| Run | passed | failed | skipped | timed out | hw-dependent run |
|---|---|---|---|---|---|
| run 1 (`validation/4.9/regression/regression-run1-final-build.*`) | 489 | 1 | 1 | 0 | 49 |
| **run 2 after the test-only fix** (`regression-run2-final-build.*`, 25.9 min) | **490** | **0** | **1** | **0** | 49 |

Run 1's failure was the 4.8 test's line `VERSION === '4.8'` (not a tournament default); it now requires
4.8 or later, every tournament-default assertion unchanged. The skip (both runs) is the read-only-folder test, which cannot be meaningful as root. Test files are not
part of the build fingerprint, so both runs used the same binaries. A first attempt of run 2 was stopped by a
container restart after v47 (all files passed up to that point; log kept) and was rerun from the start.
After run 2, only `tests/v49.test.js` changed again (the compiler test is skipped on Windows hosts, see
below); its file was re-run on the final binaries: 7 passed, 0 failed, 1 skipped (read-only folder, root).

Windows runner (GitHub Actions, real Windows Server, no GPU):

| Run | build | PowerShell harness | selftest47 / 48 / 49 | EMZ1 resume, write-denied TMP | full regression |
|---|---|---|---|---|---|
| 48 (commit 147ac2e) | pre-final 4.9 | passed (126/126, 8/8 sections) | passed | passed | 452 passed, 3 failed, 36 skipped |
| 49 (commit 59f13e1) | **278035e3bb5bcaa6 (shipped)** | passed | **passed** (incl. the 4.7 "150 + 150 resumed from EMZ1") | **passed** | **454 passed, 1 failed, 36 skipped**, 0 timed out |

Run 48's failures were test issues fixed for run 49 (the `VERSION === '4.8'` line, the empty chart-7 note -
fixed in `lib_dashboard.js` - and the compiler test picking up an old toolchain). Run 49's single failure
is the new compiler test on the Windows host: the `clang++`/`g++` found on that runner's PATH are not the
release toolchain (the hosted image also carries an MSVC-targeting LLVM without zlib), while the release
itself is compiled by MSYS2 GCC in the same job. The test is now skipped on Windows hosts with that reason
(test-only change after run 49; the CI run for that commit was not complete when this package was made).
The 36 skips on Windows are tests that need the Linux compiler cache or the Linux CUDA test double.

Static analysis and sanitizers: Clang and GCC builds as above. **Not run in 4.9**: ASan/UBSan/TSan
passes (`tools/sanitize48.sh`) and cppcheck over all native files.

## 7. Not done / limitations

* No trainer improvement for six-player postflop was found; nothing was promoted.
* Physical GPU validation of 4.9 (including the Automatic time saving) is pending; CUDA kernels unchanged.
* Sanitizer passes not run in 4.9.
* Command-line checkpoint paths must be representable in the Windows ANSI code page (inherited).
* No method here certifies a Nash equilibrium of unrestricted eight-player No-Limit Hold'em.
* Future formats (cash, PLO): no engine change; `validation/4.8/ARCHITECTURE-REVIEW.md` still applies.
  For PLO, hand evaluation (`evalSeven`, `rank7`) and the two-card hole-card representation (`Hand{a,b}`)
  are the places that need a format layer; betting, side pots, CFR and checkpoints are card-count-agnostic
  except for the 1,326-combination range index.
