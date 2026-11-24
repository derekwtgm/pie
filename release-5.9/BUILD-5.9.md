# Building EightMax 5.9

Final source/build identifier: `00600c81455ead44` (5.8 was `d4001e2c0cd77f41`).
Statistics identifiers: unchanged from 5.8 for studies (`study-5.5-bounded-eb-v1`, `study-5.6-replication-v1`,
`study-5.3-tfloor-bonferroni-v1`); for the trained response: `response-5.9-paired-v2` (the estimate with the 5.9
evaluation streams), `response-5.8-paired-v1` (with the 5.8 streams), `response-5.9-eb-one-sided-v1` (seat bound),
`response-5.9-simultaneous-union-v1`, `response-5.9-pooled-bernstein-subsets-v1`. Evaluation streams:
`philox4x64-10-counter-v1` (default), `splitmix64-hashed-block-seeds-5.8`.
Checkpoint formats: unchanged (study checkpoint version 1, tied to its build; solver states EMMW4 and EMZ1: a state
trained by 5.8 continues under 5.9 to the same bytes).

The complete source is included. The Windows programs are unsigned x64 PE executables with a statically linked
language runtime and zlib; they import only system DLLs (`KERNEL32.dll`, `msvcrt.dll`, `bcrypt.dll`, and for the
desktop host `SHELL32.dll`, `WINMM.dll`, `WS2_32.dll`).

## How the shipped executables were built

They were **cross-compiled on Linux** and were **not** built or run on Windows.

| Tool | Version used |
|---|---|
| Host | Ubuntu 24.04 container, x86-64, 4 logical processors, 15 GiB |
| Windows cross-compiler | x86_64-w64-mingw32-g++-posix (GCC) 13-posix (`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, POSIX threads) |
| Windows zlib | `libz-mingw-w64-dev` 1.3.1 (static) |
| Linux compiler | gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0 |
| Node | v22.23.5 |
| Python | Python 3.13.18 (standard library only; numpy 2.5.3 was used for one optional cross-check of the generator) |
| Wine (tests only) | wine-9.0 (Ubuntu 9.0~repack-4build3) |
| PowerShell (tests only) | 7.4.6, installed as a .NET tool (`dotnet tool install --global PowerShell --version 7.4.6`, .NET SDK 8) |

This is the 5.8 toolchain: before any change, the unmodified 5.8 source was rebuilt with it and gave the three
shipped Windows executables, the three shipped Linux programs and the interface byte for byte
(`validation/5.9/baseline/baseline-5.8.json`). Every difference between the 5.8 and 5.9 programs therefore comes from
the source changes. Compiler flags are unchanged: `-O2 -march=x86-64 -ffp-contract=off` for the multiway engine
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
the release root, and the Linux programs to `validation/5.9/linux-bin`.

```sh
node source/tools/verify_build.js .
```

must print `Verified the executables, interface and source: 00600c81455ead44`.

The fingerprint covers `source/VERSION`, `source/native`, `web`, `wasm`, `tools`, `tests`, `studies` and the CI
workflow (391 files; 5.8: 384), so editing a test or a tool also changes it. Documents in the release root and
everything under `validation/` are outside it.

**Files added to the fingerprint in 5.9 (7):** `native/response59.hpp`, `native/response_stats59.hpp`,
`native/mwcli_selftest59.hpp`, `tools/independent_stats59.py`, `tools/host_refusal59.js`,
`tools/validate_windows59.ps1`, `tests/v59.test.js`. **Renamed:** `native/mwcli_response58.hpp` to
`native/mwcli_response59.hpp` (the `--response` command; rewritten summary). **Files changed:** `VERSION`,
`native/mw.h`, `native/mw.cpp` (one include line), `native/mwcli.cpp`, `native/response58.hpp` (the evaluation moved to
`response59.hpp`; the deal and walk helpers take any random stream), `native/study_jobs.h` (the desktop host's undo
of a refused study), `tests/v58.test.js` (four assertions: VALIDATION-5.9.md, section 3) and
`.github/workflows/windows.yml`.

**Reproducibility.** The final source tree was copied to another directory and built a second time with the same toolchain: all 7 artifacts (the three Windows executables, the three Linux programs and the interface) are byte-identical to the shipped ones

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---|---|
| `EightMax.exe` | 5,051,904 | `61778ca352d489a519f02e17d7e0ca95363bd987a7e090bc642780ad2ef6a991` |
| `mwcli.exe` | 3,288,064 | `82beb747fec09d71f29d190f65515d679851a101eef02eb40202204a1fbcec30` |
| `gpustress.exe` | 2,382,336 | `9372580c60dda0eb3106f2d4375af569dc0fbe57169bb5093f892960be68d502` |
| `EightMax-Offline.html` | 1,224,104 | `5d700589c498dc0d72e18da911d1c7490742bc006ef02fe6726d9c10c34dbf79` |
| `validation/5.9/linux-bin/mwcli` | 2,341,976 | `782c349362602c6dcc5bad6aa27bc4b2f720c0ac4333e1d546be9a1087b4822c` |
| `validation/5.9/linux-bin/eightmax` | 4,124,480 | `5880050ffd5c022f72011b7dead39a230dd1e65ece72f976e3b742927e7603b3` |
| `validation/5.9/linux-bin/gpustress` | 1,525,016 | `ebfead6468d27276c68bb87f0a8dd8bbd085b8c51b4761b7c2cfb69a1343fb5f` |

Build identifier embedded in all three executables and in `BUILD-INFO.json`: `00600c81455ead44` (version 5.9).

`SHA256SUMS.txt` lists every file of the archive except itself. The archive's own SHA-256 cannot be inside the
archive; it is in `EightMax-Windows-5.9.identity.json`, delivered beside the ZIP.

## Tests, experiments and packaging

```sh
node --test --test-concurrency=3 --test-reporter=tap source/tests/*.test.js    # the regression suite (EM_TEST_MWCLI, EM_TEST_HOST: the Linux programs)
bash validation/5.9/run_final59.sh . <work dir>            # self-tests, independent implementation, desktop host, interface, stability, identity against 5.8
bash validation/5.9/sanitize59.sh . <work dir>             # AddressSanitizer, UndefinedBehaviorSanitizer, ThreadSanitizer, LeakSanitizer
bash validation/5.9/wine59.sh . <wrapper dir> <work dir>   # the Windows programs under Wine
bash validation/5.9/powershell59.sh . <pwsh> <work dir>    # the Windows validation script under PowerShell 7 on Linux
python3 validation/5.9/mutation59.py . <work dir>          # the self-test against engines with one behaviour broken
python3 validation/5.9/statistics/coverage59.py final8 . <5.8 mwcli> build/linux/mwcli <fresh dir>
python3 validation/5.9/statistics/coverage59.py games . build/linux/mwcli <fresh dir>
python3 validation/5.9/convergence/convergence59.py identity . <5.8 mwcli> build/linux/mwcli <fresh dir>
python3 validation/5.9/convergence/convergence59.py options . build/linux/mwcli <fresh dir>
python3 validation/5.9/convergence/convergence59.py flop6 . build/linux/mwcli <fresh dir>
python3 validation/5.9/performance/bench59.py . <5.8 mwcli> build/linux/mwcli <fresh dir>   # on an idle machine
python3 validation/5.9/make_golden59.py . build/linux/mwcli    # only to re-record the reference responses
python3 validation/5.9/summarize59.py .                    # validation/5.9/validation-summary.json from the evidence files
python3 validation/5.9/release59.py . <out dir> --wine     # ZIP, clean extraction, manifest, smoke tests of the Windows programs under Wine
```

The unchanged 5.8 Linux binary is `validation/5.8/linux-bin/mwcli` (a ZIP does not keep the executable bit:
`chmod +x` a copy). Each experiment runner writes its plan before measuring and refuses to reuse an output directory.

Wine note (unchanged): Wine 9.0 aborts at start-up when given the session's very large environment; it runs with a
minimal one (`env -i HOME=... PATH=... WINEPREFIX=... LC_ALL=C.UTF-8`).
