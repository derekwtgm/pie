# Building EightMax 5.10

Final source/build identifier: `7fa0e8c16d6c6ade` (5.9 was `00600c81455ead44`).
Training algorithm identifiers: the default trainer has none (its states are the states of 5.9); the experimental
estimator writes `rbes-5.10-v1` (an opponent's terminal children in expectation) or `rbes-5.10-v1-sampled-terminals`
into the `estimator` field of its state header. Statistics identifiers and evaluation streams: unchanged from 5.9.
Checkpoint formats: unchanged (study checkpoint version 1, tied to its build; solver states EMMW4 and EMZ1: a state
trained by the default trainer of 5.9 continues under 5.10 to the same bytes, and the reverse).

The complete source is included. The Windows programs are unsigned x64 PE executables with a statically linked
language runtime and zlib; they import only system DLLs (`KERNEL32.dll`, `msvcrt.dll`, `bcrypt.dll`, and for the
desktop host `SHELL32.dll`, `WINMM.dll`, `WS2_32.dll`).

## How the shipped executables were built

They were **cross-compiled on Linux** and were **not** built on Windows.

| Tool | Version used |
|---|---|
| Host | Ubuntu 24.04 container, x86-64, 4 logical processors, 15 GiB |
| Windows cross-compiler | x86_64-w64-mingw32-g++-posix (GCC) 13-posix (`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, POSIX threads) |
| Windows zlib | `libz-mingw-w64-dev` 1.3.1 (static) |
| Linux compiler | gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0 |
| Node | v22.23.5 |
| Python | Python 3.13.18 (standard library only) |
| Wine (tests only) | wine-9.0 (Ubuntu 9.0~repack-4build3) |
| PowerShell (tests only) | 7.4.6, installed as a .NET tool (`dotnet tool install --global PowerShell --version 7.4.6`, .NET SDK 8) |
| valgrind (profiles only) | callgrind, for instruction counts |

This is the 5.9 toolchain: before any change, the unmodified 5.9 source was rebuilt with it and gave the three
shipped Windows executables, the three shipped Linux programs and the interface byte for byte
(`validation/5.10/baseline/baseline-5.9.json`). Every difference between the 5.9 and 5.10 programs therefore comes
from the source changes. Compiler flags are unchanged: `-O2 -march=x86-64 -ffp-contract=off` for the multiway engine
(strict IEEE arithmetic, no FMA contraction).

## Reproducing the build

Requirements: Node, Python 3, GCC/G++ with C++20, zlib; a Linux host also needs the OpenSSL development libraries.
For Windows binaries: MinGW-w64 with POSIX threads and its static zlib
(`apt-get install g++-mingw-w64-x86-64-posix libz-mingw-w64-dev`), or MSYS2 on Windows with `CC=gcc CXX=g++`. These
are developer requirements; the Windows application needs none of them at run time.

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
```

Then copy `build/windows/*.exe`, `build/EightMax-Offline.html` and `build/build-info.json` (as `BUILD-INFO.json`) to
the release root, and the Linux programs to `validation/5.10/linux-bin`.

```sh
node source/tools/verify_build.js .
```

must print `Verified the executables, interface and source: 7fa0e8c16d6c6ade`.

The fingerprint covers `source/VERSION`, `source/native`, `web`, `wasm`, `tools`, `tests`, `studies` and the CI
workflow (405 files; 5.9: 391), so editing a test or a tool also changes it. Documents in the release root and
everything under `validation/` are outside it.

**Files added to the fingerprint in 5.10 (14):** `native/es_rbes510.hpp` (the estimator's structures),
`native/es_rbes510_walk.hpp` (its traversal, production and reference), `native/es_rbes510_check.hpp` (the exact
check), `native/mwcli_selftest510.hpp`, `native/selftest510_golden59.hpp`, `native/selftest510_golden510.hpp`,
`native/selftest510_reference.hpp` (the self-test's recorded states and reference values), `tests/rbes510.cpp`,
`tests/v510.test.js`, `tests/fixtures/golden510.json`, `tools/games510.js`, `tools/independent_rbes510.py`,
`tools/make_golden510.py`, `tools/validate_windows510.ps1`. **Files changed (16):** `VERSION`; `native/mw_es.hpp`,
`native/mw_es_impl.hpp` (the option, the preparation of a deal, the merge; in the default path: the Detailed
identifier cache and one hoisted division), `native/es_groups.hpp` (the identifier cache), `native/es_transaction.hpp`
(the estimator's cache is dropped with a rolled-back update), `native/mw.cpp`, `native/mw.h` (spec keys, refusals,
information output, the check's entry point), `native/checkpoint_native.hpp`, `native/ckpt_suite.hpp` (the algorithm
of a state is verified and shown), `native/response58.hpp`, `native/mwcli_response59.hpp` (`responseEstimator`),
`native/study52.hpp`, `native/mwcli_study52.hpp` (`estimator=`), `native/mwcli.cpp` (`--selftest510`,
`--estimator-check`), `tests/v59.test.js` (two assertions that named the version and the workflow of 5.9) and
`.github/workflows/windows.yml`. No CUDA source, no kernel, no scheduler file and no interface file changed.

**Reproducibility.** The final source tree was copied to another directory and built a second time with the same toolchain: all 7 artifacts (the three Windows executables, the three Linux programs and the interface) are byte-identical to the shipped ones (`validation/5.10/baseline/reproducible-build-5.10.json`).

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---|---|
| `EightMax.exe` | 5,122,560 | `a14af9c64c3cf58db0675093a80caafe337e4a7c902df2707bc9c36dffc0c4a6` |
| `mwcli.exe` | 3,466,240 | `516649c018ead0c8b954c9465959ff0ff34afe178a0c7664e8af0c2e1106ec0c` |
| `gpustress.exe` | 2,452,992 | `f2b21ee14aaa7924084c97127246833b25dc6d36bd4454f891a0cc2fc067c913` |
| `EightMax-Offline.html` | 1,224,106 | `1f38d0fb227ffe6389286bfebeb9f36c55c0216dd973cc603a549611c534bb07` |
| `validation/5.10/linux-bin/mwcli` | 2,541,488 | `992285be8441c47dff8be40f6dc3a1797ccb54eb5d140a22132b9b272a4c0183` |
| `validation/5.10/linux-bin/eightmax` | 4,204,472 | `ab0314a4c6acb8eb39f1f9c7d05375549c4f8678d9395a151947f9b6bf1004ec` |
| `validation/5.10/linux-bin/gpustress` | 1,605,008 | `440b795a0f604aabc39ce584a4542f8c979b27a4ab2af1b25dc6e230cafa824a` |

Build identifier embedded in all three executables and in `BUILD-INFO.json`: `7fa0e8c16d6c6ade` (version 5.10).

`SHA256SUMS.txt` lists every file of the archive except itself. The archive's own SHA-256 cannot be inside the
archive; it is in `EightMax-Windows-5.10.identity.json`, delivered beside the ZIP.

## Tests, experiments and packaging

```sh
EM_TEST_MWCLI=$PWD/build/linux/mwcli EM_TEST_HOST=$PWD/build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap source/tests/*.test.js    # the regression suite against the release's Linux programs (without the two variables the suite compiles and tests a build of its own, whose version is "development")
bash validation/5.10/run_final510.sh . <5.9 mwcli> <work dir>           # self-tests, desktop host, interface, stability, state identity against 5.9
python3 validation/5.10/estimator510.py . build/linux/mwcli <fresh dir> # the estimator: exact checks, independent Python, sampler, Monte Carlo, 4.7 cross-check
python3 validation/5.10/estimator/diagnose510.py . <harness> <work dir> <out.json>   # the two games the first Monte Carlo rule flagged
python3 validation/5.10/estimator/followup510.py . <harness> <work dir> <out.json>   # the entry the second run flagged
bash validation/5.10/sanitize510.sh . <work dir>                        # AddressSanitizer, UndefinedBehaviorSanitizer, ThreadSanitizer, LeakSanitizer
bash validation/5.10/wine510.sh . <wrapper dir> <work dir>              # the Windows programs under Wine
bash validation/5.10/powershell510.sh . <pwsh> <work dir>               # the Windows validation script under PowerShell 7 on Linux
bash validation/5.10/profile/profile510.sh . <5.9 mwcli> <work dir>     # instruction counts (callgrind)
python3 validation/5.10/convergence/convergence510.py exact . <5.9 mwcli> build/linux/mwcli <5.9 timed> <5.10 timed> <fresh dir> 3
python3 validation/5.10/convergence/convergence510.py fixtures . build/linux/mwcli <5.10 timed> <fresh dir> 2
python3 validation/5.10/convergence/reproduce510.py . build/linux/mwcli <exact dir> <out.json>   # the released program writes the experiment's states
python3 validation/5.10/convergence/tables510.py . <exact dir> <fixtures dir> > tables.md
python3 validation/5.10/performance/bench510.py . <5.9 mwcli> build/linux/mwcli <fresh dir>   # on an idle machine
python3 validation/5.10/summarize510.py .                               # validation/5.10/validation-summary.json from the evidence files
python3 validation/5.10/write_reports510.py .                           # the tables of the documents from the evidence files
python3 validation/5.10/release510.py . <out dir> --wine                # ZIP, clean extraction, manifest, smoke tests of the Windows programs under Wine
```

`<5.9 timed>` and `<5.10 timed>` are `validation/5.10/convergence/timed510.cpp` compiled against the engine source of
the respective release (the command is in the file's header); `<harness>` is `source/tests/rbes510.cpp` built as
`estimator510.py` builds it. The unchanged 5.9 Linux binary is `validation/5.9/linux-bin/mwcli` (a ZIP does not keep
the executable bit: `chmod +x` a copy). Each experiment runner writes its plan before measuring and refuses to reuse
an output directory; an interrupted run is continued with `--resume` (same arguments), which keeps the complete
units and records the resume.

Wine note (unchanged): Wine 9.0 aborts at start-up when given the session's very large environment; it runs with a
minimal one (`env -i HOME=... PATH=... WINEPREFIX=... LC_ALL=C.UTF-8`).
