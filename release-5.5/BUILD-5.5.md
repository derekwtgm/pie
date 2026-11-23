# Building EightMax 5.5

Final source/build identifier: `abe74607a4a0120b`.
Statistics identifiers: `study-5.5-bounded-eb-v1` (calibrated conditional intervals) and
`study-5.3-tfloor-bonferroni-v1` (model-based interval across trainings, unchanged).
Study checkpoint format: `EightMax study checkpoint`, version 1. Solver checkpoint formats are unchanged.

The complete source is included. The Windows programs are unsigned x64 PE executables with a statically linked
language runtime and zlib; they import only `KERNEL32.dll`, `SHELL32.dll`, `WINMM.dll`, `WS2_32.dll`, `bcrypt.dll`
and `msvcrt.dll`.

## How the shipped executables were built

They were **cross-compiled on Linux** and were **not** built or run on Windows.

| Tool | Version used |
|---|---|
| Host | Ubuntu 24.04 container, x86-64, 4 logical processors |
| Windows cross-compiler | MinGW-w64 POSIX-threads GCC 13 (`g++-mingw-w64-x86-64-posix 13.2.0-6ubuntu1+26.1`), `mingw-w64-common 11.0.1` |
| Windows zlib | `libz-mingw-w64-dev 1.3.1` (static) |
| Linux compiler | GCC 13.3.0 |
| Node | 22.23.5 |
| Python | 3.13 (NumPy 2.5, SciPy 1.18 for the research and validation scripts only) |

5.4 was built with MinGW-w64 GCC 14.2.0. The compiler version differs, so the 5.5 executables are not expected to be
byte-identical to a GCC 14 build of the same source. The source fingerprint, not the executable hash, identifies the
code.

## Reproducing the build

Requirements: Node, Python 3, GCC/G++ with C++20, zlib; a Linux host also needs the OpenSSL development libraries.
For Windows binaries: MinGW-w64 with POSIX threads and its static zlib (or MSYS2 on Windows with `CC=gcc CXX=g++`).
These are developer requirements. The Windows application needs none of them at run time.

From the release root:

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
```

Then copy `build/windows/*.exe`, `build/EightMax-Offline.html` and `build/build-info.json` (as `BUILD-INFO.json`) to
the release root, and the Linux programs to `validation/5.5/linux-bin`.

```sh
node source/tools/verify_build.js .
```

must print `Verified the executables, interface and source: abe74607a4a0120b`.

Compiler flags are those of 5.4: strict IEEE arithmetic and no FMA contraction in the multiway engine. Do not change
source after building without regenerating the interface and binaries; the builder and verifier enforce fingerprint
agreement. The fingerprint covers `source/native`, `web`, `wasm`, `tools`, `tests`, `studies` and the CI workflow, so
editing a test or tool also changes it.

## Artifact fingerprints

| File | SHA-256 |
|---|---|
| `EightMax.exe` | `c00ee3c6e9b2fc523dd616182ed5534ff16272c658ccf82e35c80e2e50ad51b2` |
| `mwcli.exe` | `544816b2e5977f0037be48f9665f56d9fa2939de494c6774e730bc2d058af928` |
| `gpustress.exe` | `28849143a76ecb9125ff41c10d6b61d903ace35ce5cdaef33d7bf057d0e2dcbb` |
| `EightMax-Offline.html` | `1bcbc9090956faaa8ae63e87224f8f538e6ed06767fa99b1385d6ce1bdccf036` |
| `BUILD-INFO.json` | `8719c8dbbbca53aa150fbd0e82375de4dbde097e500f2c6a1a00e45c1091d1d8` |

`SHA256SUMS.txt` lists every file of the archive except itself. The archive's own SHA-256 cannot be inside the archive;
it is in `EightMax-Windows-5.5.identity.json`, delivered beside the ZIP, and in the final report.

## Tests and packaging

```sh
EM_TEST_MWCLI="$PWD/build/linux/mwcli" EM_TEST_HOST="$PWD/build/linux/eightmax" ASAN_OPTIONS=detect_leaks=0 \
  NODE_OPTIONS="--require=$PWD/validation/5.3/sanitizers/no-leaks.cjs" \
  node --test --test-concurrency=3 --test-reporter=tap source/tests/*.test.js
bash validation/5.5/sanitize55.sh . /tmp/em55-sanitized
python3 validation/5.5/final_checks.py . <5.4 linux mwcli> build/linux/mwcli <probe built from source/tests/study53_probe.cpp>
node source/tools/study_ui55.js build/linux/eightmax . validation/5.5/ui          # needs Playwright with Chromium
node source/tools/stability55.js build/linux/eightmax . validation/5.5/stability --minutes=6
python3 validation/5.5/write_reports.py .
python3 validation/5.5/release55.py . output            # add --wine to exercise the Windows executables under Wine
```

`release55.py` writes `SHA256SUMS.txt`, builds the ZIP, verifies its CRC, extracts that exact file into a new
directory, checks every checksum and build identity there, and runs smoke tests from the extracted copy, including an
interrupted and resumed study compared with an uninterrupted one.

Wine note: in the development container Wine 9.0 aborted at start-up when given the session's very large environment.
It ran normally with a minimal environment (`env -i HOME=... PATH=... WINEPREFIX=...`). This is a property of that
container, not of EightMax; the unchanged 5.4 executables showed the same behaviour.

The GitHub Actions workflow in `.github/workflows/windows.yml` (unchanged since 5.3) builds and tests natively on a
Windows runner. It was **not** run for 5.5.

## Reproducing the research

- Statistics: `python3 source/tools/statistical_validation55.py <probe> <fresh dir>`;
  `python3 source/tools/poker_calibration55.py <mwcli> <fresh dir>`.
- Convergence: `python3 source/tools/research55.py <5.4 mwcli> <5.5 mwcli> <fresh dir>`;
  `--plan icm` with the 5.3 and 5.4 binaries completes the 5.4 family;
  `sh validation/5.5/unbiasedness.sh . <dir>`; `python3 source/tools/tournament55.py <mwcli> <dir>`.
- Performance: `python3 source/tools/bench55.py <5.4 mwcli> <5.5 mwcli> <fresh dir>` on an idle machine.

The unchanged 5.3 and 5.4 Linux binaries are in `validation/5.3/linux-bin` and `validation/5.4/linux-bin`.
Each runner writes its plan before measuring and refuses to reuse an output directory.
