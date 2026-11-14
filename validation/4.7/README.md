# EightMax 4.7 validation evidence

Final build `4507f915d661cc3e` (source fingerprint; embedded in `EightMax.exe`, `mwcli.exe`,
`gpustress.exe`, `EightMax-Offline.html` and `BUILD-INFO.json`). Linux machine: 4 logical CPUs,
15 GiB, GCC 13.3, Node 22, no GPU. Windows executables cross-compiled with MinGW-w64 (GCC 13, posix
threads, static zlib) and exercised under Wine 9.0, which is **not** Windows.

## Test counts (Priority 15)

| Suite | Passed | Failed | Skipped | Timed out | Incomplete | Hardware-dependent |
|---|---|---|---|---|---|---|
| Regression, 4.7 final build (`regression-tests.json`) | **462** | 0 | 0 | 0 | 0 | 46 run, 0 skipped |
| of which inherited from 4.6 | 449 | 0 | 0 | 0 | 0 | |
| of which new `tests/v47.test.js` | 13 | 0 | 0 | 0 | 0 | |
| 4.6 baseline rebuilt here (`baseline-4.6/`) | 448 + 1 | 1 then 0 | 0 | 0 | 0 | 45 |
| Reference self-test (`reference/ref-selftest.json`) | 28 | 0 | | | | none |
| Reference unbiasedness, N = 200,000 and 1,000,000 | 25 + 25 families | 0 | | | | none |
| Engine unbiasedness (`unbiased/`), 4,000 seeds x 2 games | 6 candidate checks | 0 | | | | none |
| Independent best response (`tools/independent_br47.py`) | 3 studies | 0 | | | | none |
| `mwcli --selftest47` Linux / Wine (`wine/`) | 10 / 10 | 0 / 0 | | | | none (no GPU used) |
| Sanitizers (`sanitizers/sanitize47.log`) | all steps | 0 reports | | | | |
| cppcheck on the 4.7 native files | 0 findings | | | | | |
| Physical Windows, PowerShell, NVIDIA GPU | **not run** | | | | | **pending** |

"Hardware-dependent" follows `tools/run_tests.js`: tests that need a compiler, the native host or the
Linux CUDA driver *test double* (simulated CUDA, not a GPU).

Notes:
* 4.6 baseline: the 4.6 source rebuilt here gives the shipped build id `169a67d1905adb32`. In the full run
  one test of `v44.test.js` ("sampled-EV deadline under CPU load") failed while other jobs loaded the
  machine; rerun alone it passed (15/15, `baseline-4.6/v44-isolated-rerun.tap`), giving 449/449.
* During 4.7 development two infrastructure defects were found and fixed before the final run:
  (1) the test build cache, `v43` and the inherited sanitizer scripts linked `mwcli` without zlib, which
  made the suites *skip* native tests (24 skips in v29 in an interrupted run) - now linked, 0 skips;
  (2) the repository's Windows CI did not install the MSYS2 zlib package - added.
* The inherited `tools/sanitize29.sh` strict-warning gate (`-Wshadow -Werror`) already fails on the 4.6
  source (49 diagnostics in code that predates 4.7); it is obsolete and was not used. The 4.7 headers
  compile without warnings under `-Wall -Wextra -Wshadow`.
* Reference unbiasedness: at N = 40,000 one family failed on a component with 170 non-zero observations
  (normal approximation invalid); components with fewer than 100 non-zero observations are now counted as
  sparse and excluded from the z test. At N = 1,000,000 deterministic (zero-variance) components of the
  own-enumeration estimator differed from the exact value by about 1e-11 relative after a million
  summations; zero-variance components are now compared with a 1e-9 relative tolerance. Both are test
  procedure corrections; no estimator changed.

## Contents

| Folder / file | What |
|---|---|
| `reference/` | independent reference suite outputs: self-test, unbiasedness (200k, 1M), 10-seed study, full-width CFR family |
| `unbiased/` | engine estimator unbiasedness (`tools/unbiased47.js`) |
| `convergence/` | ten-seed engine study (`convergence47.json`, log, `convergence47-summary.txt`) |
| `continuation/` | continuation suite with the experimental trainer |
| `bench/` | 4.6 vs 4.7 training speed, 1 and 4 threads (`tools/bench47.js`) |
| `profile/` | callgrind instruction profiles (six-player flop, eight-player ICM) |
| `checkpoints/` | EMZ1 sizes, times, peak memory, round trips and resumes (`tools/checkpoint47.js`) |
| `sanitizers/` | ASan+UBSan and ThreadSanitizer pass (`tools/sanitize47.sh`), cppcheck |
| `wine/` | `Run 4.7 checks.bat` executed in Wine's `cmd` with the final Windows binaries |
| `fixtures/` | specs used by `mwcli --selftest47` / `Run 4.7 checks.bat` |
| `baseline-4.6/` | the 4.6 regression suite run on this machine |
| `ARCHITECTURE-REVIEW.md` | Priority 17 review |

## Byte-identity of the CPU change (Priority 9)

21 studies (six-player flop, three-player river, heads-up turn+river with two sizes, four-player ICM
bubble - each with the default trainer, Compact groups, DCFR, terminal baseline+expectation, RM+ - plus
the eight-player golden study), 3,000 updates, 1 and 4 threads: the 4.7 engine writes the same state
bytes as the 4.6 engine in all 42 runs. The golden state `aa809741...` is checked by the regression suite
and by `--selftest47`.

## Reproducing

```
node source/tools/build.js && sh source/native/build.sh linux && sh source/native/build.sh windows
EM_TEST_HOST=source/build/linux/eightmax EM_TEST_MWCLI=source/build/linux/mwcli node source/tools/run_tests.js out.json
g++ -std=c++20 -O2 -o refsuite source/reference/refmain.cpp && ./refsuite selftest && ./refsuite unbiased 1000000 && ./refsuite study 10
node source/tools/unbiased47.js source/build/linux/mwcli u.json 4000 --game=hu-river
node source/tools/convergence47.js source/build/linux/mwcli conv.json --threads=2      # about 2 hours on 4 CPUs
node source/tools/bench47.js <4.6 mwcli> source/build/linux/mwcli bench.json --rounds=9 --threads=1
node source/tools/checkpoint47.js source/build/linux/mwcli ckpt.json
python3 source/tools/independent_br47.py source/build/linux/mwcli spec.json state
sh source/tools/sanitize47.sh source
```
