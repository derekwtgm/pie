# Building EightMax 5.6

Final source/build identifier: `7ee054b44c409149`.
Statistics identifiers: `study-5.5-bounded-eb-v1` (calibrated conditional intervals, unchanged), `study-5.6-replication-v1` (across-trainings verdicts, new) and `study-5.3-tfloor-bonferroni-v1` (model-based interval across trainings, unchanged).
Study checkpoint format: `EightMax study checkpoint`, version 1 (unchanged; a checkpoint is tied to its build, so 5.5 study checkpoints are refused with the reason). Solver checkpoint formats are unchanged; a state trained by 5.5 with the default trainer continues under 5.6 to the same bytes.

The complete source is included. The Windows programs are unsigned x64 PE executables with a statically linked language runtime and zlib; `EightMax.exe` imports only `KERNEL32.dll`, `SHELL32.dll`, `WINMM.dll`, `WS2_32.dll`, `bcrypt.dll`, `msvcrt.dll`.

## How the shipped executables were built

They were **cross-compiled on Linux** and were **not** built or run on Windows.

| Tool | Version used |
|---|---|
| Host | Ubuntu 24.04 container, x86-64, 4 logical processors, 16 GB |
| Windows cross-compiler | x86_64-w64-mingw32-g++-posix (GCC) 13-posix (`g++-mingw-w64-x86-64-posix`, POSIX threads) |
| Windows zlib | `libz-mingw-w64-dev` 1.3.1 (static) |
| Linux compiler | gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0 |
| Node | v22.23.5 |
| Python | Python 3.13.18 (NumPy and SciPy for the research and validation scripts only) |
| Wine (tests only) | wine-9.0 (Ubuntu 9.0~repack-4build3) |

This is the 5.5 toolchain. The compiler flags are those of 5.5: `-O2 -march=x86-64 -ffp-contract=off` for the multiway engine (strict IEEE arithmetic, no FMA contraction), AVX2 and SSE builds of the heads-up solver selected at run time.

## Reproducing the build

Requirements: Node, Python 3, GCC/G++ with C++20, zlib; a Linux host also needs the OpenSSL development libraries. For Windows binaries: MinGW-w64 with POSIX threads **and** its static zlib (`apt-get install mingw-w64 libz-mingw-w64-dev`; without the second package `mwcli.exe` does not link), or MSYS2 on Windows with `CC=gcc CXX=g++`. These are developer requirements. The Windows application needs none of them at run time.

From the release root:

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
```

Then copy `build/windows/*.exe`, `build/EightMax-Offline.html` and `build/build-info.json` (as `BUILD-INFO.json`) to the release root, and the Linux programs to `validation/5.6/linux-bin`.

```sh
node source/tools/verify_build.js .
```

must print `Verified the executables, interface and source: 7ee054b44c409149`.

The fingerprint covers `source/native`, `web`, `wasm`, `tools`, `tests`, `studies` and the CI workflow, so editing a test or a tool also changes it. Documents in the release root and everything under `validation/` are outside it.

**Reproducibility.** The three Windows executables were built a second time from the same tree into a different directory: all three are byte-identical to the shipped files.

## Artifact fingerprints

| File | SHA-256 |
|---|---|
| `EightMax.exe` | `170e826f0b560c979d5798ecf54c488a047e6b9f2467fc77cfae4bda12f57bbe` |
| `mwcli.exe` | `f78888954f2617a5133ca1ceb1766bfaa6ae5072fae7a24c5fd9417c9327b361` |
| `gpustress.exe` | `c55b2924949ae626002b4318db67842a989c6f111f1fdf678c8951e8f4d9caa9` |
| `EightMax-Offline.html` | `e6fabeb28b3af290ff8efed2872c94b0eee2cc746f56ef0b0158b0f9b1beffe3` |
| `BUILD-INFO.json` | `807c847b4833744c94ffcad5736050458bb0feec6c6fc6ffbe443c4002aa5544` |
| `validation/5.6/linux-bin/mwcli` | `3e824466b76abdc7d44d443cd311209ab334fda213df117369e18d58275f5366` |
| `validation/5.6/linux-bin/eightmax` | `c24a22156dfbc389da5c356097f8215b635449837063560af8b202f76cffe07a` |
| `validation/5.6/linux-bin/gpustress` | `ff6c325c5d9c8d67a992690dfa4cf9db3962d9112331dd58616de45d35028b89` |

`SHA256SUMS.txt` lists every file of the archive except itself. The archive's own SHA-256 cannot be inside the archive; it is in `EightMax-Windows-5.6.identity.json`, delivered beside the ZIP, and in the final report.

## Tests and packaging

```sh
bash validation/5.6/run_final.sh . <5.5 linux mwcli> /tmp/em56-final      # regression, final checks, identity matrix, sanitizers,
                                                                      # expected increments, statistics, browser-driven UI, stability
python3 source/tools/trainbench56.py <5.5 mwcli> build/linux/mwcli <fresh dir>   # on an idle machine
python3 source/tools/bench56.py <5.5 mwcli> build/linux/mwcli <fresh dir>
python3 validation/5.6/threads56.py . <5.5 mwcli> build/linux/mwcli <out.json>
python3 validation/5.6/release56.py . output --wine                   # ZIP, clean extraction, manifest, smoke tests of the Windows programs under Wine
```

`release56.py` writes `SHA256SUMS.txt`, builds the ZIP, verifies its CRC, extracts that exact file into a new directory, checks every checksum and build identity there, and runs the smoke tests from the extracted copy.

Wine note (unchanged from 5.5): in the development container Wine 9.0 aborts at start-up when given the session's very large environment. It runs normally with a minimal environment (`env -i HOME=... PATH=... WINEPREFIX=...`). The packaging smoke test also sets `LC_ALL=C.UTF-8`: without a UTF-8 locale Wine cannot create the Unicode-named temporary folder of one 4.9 self-test check, with the 5.5 and the 5.6 program alike. The wrappers used for the per-file regression run did not set it, which is why that self-test is among the Wine failures listed in VALIDATION-5.6.md while the packaged smoke test passes it. The regression suite was run against the Windows programs through small wrapper scripts that do this and pass on EightMax's own variables.

The GitHub Actions workflow in `.github/workflows/windows.yml` builds and tests natively on a Windows runner. 5.6 adds two steps to it: `validate_windows56.ps1` and the whole regression suite on Windows. **The workflow was not run for 5.6** (no runner was reachable from the development session), so those two steps have never executed.

## Reproducing the research

- Convergence: `python3 source/tools/research56.py <5.5 mwcli> <5.6 mwcli> <fresh dir> --games ...` (one process per group of games), then `--analyze-only <dirs...> <out dir>`; `python3 validation/5.6/write_convergence.py .`.
- Expected increments: `sh validation/5.6/unbiasedness.sh . <dir>`.
- State identity with 5.5: `python3 source/tools/identity56.py <5.5 mwcli> <5.6 mwcli> <fresh dir>`.
- Statistics: `python3 source/tools/statistical_validation56.py <probe> <fresh dir>`; `python3 validation/5.6/write_statistics.py .`.

The unchanged 5.3, 5.4 and 5.5 Linux binaries are in `validation/5.3/linux-bin`, `validation/5.4/linux-bin` and `validation/5.5/linux-bin` (a ZIP does not keep the executable bit: `chmod +x` a copy). Each runner writes its plan before measuring and refuses to reuse an output directory.

