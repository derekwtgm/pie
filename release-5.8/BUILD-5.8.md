# Building EightMax 5.8

Final source/build identifier: `d4001e2c0cd77f41` (5.7.1 was `65e835e6b7060960`).
Statistics identifiers: unchanged from 5.6 (`study-5.5-bounded-eb-v1`, `study-5.6-replication-v1`,
`study-5.3-tfloor-bonferroni-v1`); new for the trained response: `response-5.8-paired-v1`.
Study checkpoint format: `EightMax study checkpoint`, version 1 (unchanged; a study checkpoint is tied to its build,
so 5.7.1 study checkpoints are refused with the reason). Solver checkpoint formats (EMMW4, EMZ1) are unchanged; a
state trained by 5.7.1 continues under 5.8 to the same bytes.

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
| Python | Python 3.13.18 (standard library only) |
| Wine (tests only) | wine-9.0 (Ubuntu 9.0~repack-4build3) |

This is the 5.7.1 toolchain: before any change, the unmodified 5.7.1 source was rebuilt with it and gave the three
shipped Windows executables, the three shipped Linux programs and the interface byte for byte
(`validation/5.8/baseline/baseline-5.7.1.json`). Every difference between the 5.7.1 and 5.8 programs therefore comes
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
the release root, and the Linux programs to `validation/5.8/linux-bin`.

```sh
node source/tools/verify_build.js .
```

must print `Verified the executables, interface and source: d4001e2c0cd77f41`.

The fingerprint covers `source/VERSION`, `source/native`, `web`, `wasm`, `tools`, `tests`, `studies` and the CI
workflow (384 files; 5.7.1: 377), so editing a test or a tool also changes it. Documents in the release root and
everything under `validation/` are outside it.

**Files added to the fingerprint in 5.8 (7):** `native/response58.hpp`, `native/mwcli_response58.hpp`,
`native/mwcli_selftest58.hpp`, `tools/games58.js`, `tools/independent_response58.py`, `tools/validate_windows58.ps1`,
`tests/v58.test.js`. **Files changed:** `VERSION`, `native/mw.h`, `native/mw.cpp`, `native/mwcli.cpp`,
`native/mw_es.hpp`, `native/mw_es_impl.hpp`, `native/study52.hpp`, `native/icm.hpp`, `native/server.c` and
`native/checkpoint_store.h` (the desktop host's checkpoint lock), `tests/v571.test.js` (two version assertions) and
`tests/v54.test.js` (one study budget; both explained in VALIDATION-5.8.md, section 4) and
`.github/workflows/windows.yml`.

**Reproducibility.** The final source tree was copied to another directory and built a second time with the same
toolchain: all 7 artifacts (the three Windows executables, the three Linux programs and the interface) are
byte-identical to the shipped ones (`validation/5.8/baseline/reproducible-build-5.8.json`). Together with the
byte-identical rebuild of the unmodified 5.7.1 source, this means the build does not depend on the directory, the
time, or anything outside the source tree and the toolchain versions listed above.

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---|---|
| `EightMax.exe` | 5,019,648 | `db1f80dcbbf5efd5edfe124449d5c5d48c5e526852b5d38ff381f3ed62856cbc` |
| `mwcli.exe` | 3,158,528 | `9e0e4975d5f41dade7e888610d1cd1c373f58135634e9001d17930c12e25af14` |
| `gpustress.exe` | 2,352,128 | `54757acb2ef8fa401ad856a74b97510840955a8f44f938d55af9f7e46e89b0d6` |
| `EightMax-Offline.html` | 1,224,104 | `eb832fe435590d357bd5c98718185abf68cf9bff07183e583b01045c5ea66a3e` |
| `validation/5.8/linux-bin/mwcli` | 2,197,256 | `ef39d1fa24052e6e9fc36321760dcad99b92e5e783c8e5cc0ae49fdbd18d95e5` |
| `validation/5.8/linux-bin/eightmax` | 4,086,128 | `17b4e858a639456bc8dfafe390c0ac1b920eeebbfe4b8f474dc21ed85d68b633` |
| `validation/5.8/linux-bin/gpustress` | 1,490,856 | `e39a90851870e82e7d81088e7d55f115627495374242ed8d142e2a2c6f0a24d4` |

Build identifier embedded in all three executables and in `BUILD-INFO.json`: `d4001e2c0cd77f41` (version 5.8).

`SHA256SUMS.txt` lists every file of the archive except itself. The archive's own SHA-256 cannot be inside the
archive; it is in `EightMax-Windows-5.8.identity.json`, delivered beside the ZIP, and in the final report as delivered.

## Tests, experiments and packaging

```sh
bash validation/5.8/run_final58.sh . <work dir>          # regression, reruns of failed tests alone, the three self-tests, identity against 5.7.1
bash validation/5.8/sanitize58.sh . <work dir>            # AddressSanitizer, UndefinedBehaviorSanitizer, ThreadSanitizer, LeakSanitizer
bash validation/5.8/wine58.sh . <wrapper dir> <work dir>  # the Windows programs under Wine
python3 validation/5.8/convergence/response58.py . build/linux/mwcli <fresh dir>       # lower-bound measures against exact NashConv
python3 validation/5.8/convergence/realistic58.py . build/linux/mwcli <fresh dir>      # the trained response on the realistic fixtures
python3 validation/5.8/convergence/sampled_actions58.py . build/linux/mwcli <fresh dir> # the estimate with sampled opponent actions against exact gains
python3 validation/5.8/convergence/unbiased58.py . build/linux/mwcli <fresh dir>       # unbiasedness of that estimate on the eight-handed ICM game
bash validation/5.8/independent/run_independent58.sh . build/linux/mwcli <work dir>   # the independent Python check
python3 validation/5.8/performance/profile58.py . build/linux/mwcli <out.json>         # instruction and cache profile by number of players
python3 validation/5.8/convergence/convergence58.py <5.7.1 mwcli> build/linux/mwcli <fresh dir> --plan main|flop6   # on an idle machine
python3 source/tools/trainbench56.py <5.7.1 mwcli> build/linux/mwcli <fresh dir>       # on an idle machine
python3 source/tools/evalbench57.py <5.7.1 mwcli> build/linux/mwcli <fresh dir>
python3 source/tools/studybench57.py <5.7.1 mwcli> build/linux/mwcli <fresh dir>
python3 validation/5.8/limits/rng_period58.py . build/linux/mwcli <out.json>
python3 validation/5.8/performance/fixture_instructions58.py . <5.7.1 mwcli> build/linux/mwcli <out.json>   # instruction counts and peak memory per fixture
python3 validation/5.8/performance/icm_instructions58.py . <5.7.1 mwcli> build/linux/mwcli <out.json>
node validation/5.8/study_ui58.js build/linux/eightmax . <out dir>       # the desktop interface in a browser (needs Playwright)
node validation/5.8/stability58.js build/linux/eightmax . <out dir> --minutes=3
node validation/5.8/host_refusal58.js build/linux/eightmax . <out.json>  # the desktop host and an over-limit study
python3 validation/5.8/summarize58.py .                   # validation/5.8/validation-summary.json from the evidence files
python3 validation/5.8/make_golden58.py . build/linux/mwcli   # only to re-record the reference responses
python3 validation/5.8/release58.py . <out dir> --wine    # ZIP, clean extraction, manifest, smoke tests of the Windows programs under Wine
```

The unchanged 5.7.1 Linux binary is `validation/5.7.1/linux-bin/mwcli` (a ZIP does not keep the executable bit:
`chmod +x` a copy). Each experiment runner writes its plan before measuring and refuses to reuse an output directory.

Wine note (unchanged): Wine 9.0 aborts at start-up when given the session's very large environment; it runs with a
minimal one (`env -i HOME=... PATH=... WINEPREFIX=... LC_ALL=C.UTF-8`).

**PowerShell.** As for 5.7.1, PowerShell could not be executed where 5.8 was developed (downloading and running it was
refused by the development session's permission policy). `validate_windows58.ps1` was checked by the project's
static linter (`source/tools/ps_lint571.py`: balanced quoting and bracketing, no PowerShell 7-only syntax) and by
`tests/v58.test.js`; neither is a parser. Whether the GitHub Actions workflow ran is recorded in VALIDATION-5.8.md.
