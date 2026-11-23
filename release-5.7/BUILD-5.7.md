# Building EightMax 5.7

Final source/build identifier: `e4668abe7903f8b0` (5.6 was `7ee054b44c409149`).
Statistics identifiers: unchanged from 5.6 (`study-5.5-bounded-eb-v1`, `study-5.6-replication-v1`, `study-5.3-tfloor-bonferroni-v1`).
Study checkpoint format: `EightMax study checkpoint`, version 1 (unchanged; a study checkpoint is tied to its build, so 5.6 study checkpoints are refused with the reason). Solver checkpoint formats are unchanged; a state trained by 5.6 continues under 5.7 to the same bytes, with the default trainer and with frozen batches on any number of threads.

The complete source is included. The Windows programs are unsigned x64 PE executables with a statically linked language runtime and zlib; they import only system DLLs (`KERNEL32.dll`, `msvcrt.dll`, `bcrypt.dll`, and for the desktop host `SHELL32.dll`, `WINMM.dll`, `WS2_32.dll`).

## How the shipped executables were built

They were **cross-compiled on Linux** and were **not** built or run on Windows.

| Tool | Version used |
|---|---|
| Host | Ubuntu 24.04 container, x86-64, 4 logical processors, 16 GB |
| Windows cross-compiler | x86_64-w64-mingw32-g++-posix (GCC) 13-posix (`g++-mingw-w64-x86-64-posix`, POSIX threads) |
| Windows zlib | `libz-mingw-w64-dev` (static) |
| Linux compiler | gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0 |
| Node | v22.23.5 |
| Python | Python 3.13.18 (standard library only for the 5.7 tools) |
| Wine (tests only) | wine-9.0 (Ubuntu 9.0~repack-4build3) |

This is the 5.6 toolchain: before any change, the unmodified 5.6 source was rebuilt with it and gave the three shipped Windows executables and the three shipped Linux programs byte for byte (`validation/5.7/baseline/baseline-5.6.json`). Compiler flags are unchanged: `-O2 -march=x86-64 -ffp-contract=off` for the multiway engine (strict IEEE arithmetic, no FMA contraction).

## Reproducing the build

Requirements: Node, Python 3, GCC/G++ with C++20, zlib; a Linux host also needs the OpenSSL development libraries. For Windows binaries: MinGW-w64 with POSIX threads and its static zlib (`apt-get install g++-mingw-w64-x86-64-posix libz-mingw-w64-dev`), or MSYS2 on Windows with `CC=gcc CXX=g++`. These are developer requirements; the Windows application needs none of them at run time.

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
```

Then copy `build/windows/*.exe`, `build/EightMax-Offline.html` and `build/build-info.json` (as `BUILD-INFO.json`) to the release root, and the Linux programs to `validation/5.7/linux-bin`.

```sh
node source/tools/verify_build.js .
```

must print `Verified the executables, interface and source: e4668abe7903f8b0`.

The fingerprint covers `source/VERSION`, `source/native`, `web`, `wasm`, `tools`, `tests`, `studies` and the CI workflow (373 files), so editing a test or a tool also changes it. Documents in the release root and everything under `validation/` are outside it.

**Reproducibility.** The three Windows executables were built a second time from a copy of the same tree in a different directory: all three are byte-identical to the shipped files.

## Artifact fingerprints

| File | SHA-256 |
|---|---|
| `EightMax.exe` | `83c090cf63defa0444dbae2b324af8d86ff1ccd95c6488c6e88f7b0167e671b9` |
| `mwcli.exe` | `eb599ea01702c1bdd487958c030790d4d8cb843b1a9cd6222f8a28cd09db384c` |
| `gpustress.exe` | `f8f6f9f34ea3b6dcba990c1e3e77693939455d368d63a3ed8cfc5a51e357c5b1` |
| `EightMax-Offline.html` | `25215f123a46e68c48f9b2031d78d92088b4f3baa45927d75471f40d0534c324` |
| `BUILD-INFO.json` | `c1a02e1531a87071ebc43e03fe89d36a81f37b89e58dc0c0c4adba45888947db` |
| `validation/5.7/linux-bin/mwcli` | `d878054b08fa0909285e66dfded8860f5f06aa708096f24395179512c593af4d` |
| `validation/5.7/linux-bin/eightmax` | `24201e6741e6810394228af590bc644ffd78ac4240e8d5724dd9a7f4d2dc7a59` |
| `validation/5.7/linux-bin/gpustress` | `05fda8fd699405349bedcd70070e9b82ba5d375ee0c67b298eee731836503b65` |

`SHA256SUMS.txt` lists every file of the archive except itself. The archive's own SHA-256 cannot be inside the archive; it is in `EightMax-Windows-5.7.identity.json`, delivered beside the ZIP, and in the final report as delivered.

## Tests and packaging

```sh
bash validation/5.7/run_final57.sh . <work dir>          # regression, reruns of failed tests alone, sanitizers, browser-driven UI, stability
python3 source/tools/identity57.py <5.6 mwcli> build/linux/mwcli <fresh dir>
python3 source/tools/threads57.py <5.6 mwcli> build/linux/mwcli <out.json> <game:updates,...>     # on an idle machine
python3 source/tools/trainbench56.py <5.6 mwcli> build/linux/mwcli <fresh dir>
python3 source/tools/evalbench57.py <5.6 mwcli> build/linux/mwcli <fresh dir>
python3 source/tools/studybench57.py <5.6 mwcli> build/linux/mwcli <fresh dir>
python3 source/tools/research57.py <5.6 mwcli> build/linux/mwcli <fresh dir> --plan main|flop6
python3 validation/5.7/convergence/restricted57.py . build/linux/mwcli <fresh dir>
python3 validation/5.7/release57.py . <out dir> --wine    # ZIP, clean extraction, manifest, smoke tests of the Windows programs under Wine
python3 source/tools/make_golden57.py . <5.6 mwcli> validation/5.7/fixtures   # only to regenerate the self-test fixtures
```

The unchanged 5.6 Linux binary is `validation/5.6/linux-bin/mwcli` (a ZIP does not keep the executable bit: `chmod +x` a copy). Each runner writes its plan before measuring and refuses to reuse an output directory.

Wine note (unchanged): Wine 9.0 aborts at start-up when given the session's very large environment; it runs with a minimal one (`env -i HOME=... PATH=... WINEPREFIX=... LC_ALL=C.UTF-8`).

The GitHub Actions workflow in `.github/workflows/windows.yml` builds and tests natively on a Windows runner. **It was not run for 5.7** (the development session had no permission to push to the repository), so its 5.7 steps, among them `validate_windows57.ps1`, have never executed. PowerShell could not be installed in the development session either; the script was checked for balanced quoting and bracketing and for PowerShell 7-only syntax by a small Python scanner, which is not a parser.
