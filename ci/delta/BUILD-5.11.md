# Building EightMax 5.11

Final source/build identifier: `af452eaa0ea731be` (5.10 was `7fa0e8c16d6c6ade`).
Training algorithm identifiers: a state trained with the counter-based streams names them in its header:
`"trainingStreams":"streams-5.11-philox4x64-v1"` (with `"trainingSeed"`); a state of the 5.10 streams has the 5.10
header and no identifier, as before. `rbes-5.10-v1` is unchanged and combines with either kind of streams.
Checkpoint formats: unchanged (EMMW4, EMZ1, study checkpoint version 1 tied to its build).

The complete source is included. The Windows programs are unsigned x64 PE executables with a statically linked
language runtime and zlib; they import only system DLLs.

## How the shipped executables were built

They were **cross-compiled on Linux** and were **not** built on Windows - as every release since 5.3 - but not on
the development machine: that machine has no Windows cross-compiler and may not install one. They were built by a
GitHub Actions job on a hosted Ubuntu 24.04 runner with the toolchain BUILD-5.10.md names:

| Tool | Version used |
|---|---|
| Host | GitHub Actions hosted runner, Ubuntu 24.04, x86-64, 4 virtual processors |
| Windows cross-compiler | x86_64-w64-mingw32-g++-posix (GCC) 13-posix (`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, POSIX threads) |
| Windows zlib | `libz-mingw-w64-dev` 1.3.1+dfsg-1 (static) |
| Linux compiler | gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0 |
| Node | v22.23.5 |
| Python | Python 3.12.3 |
| Wine (tests only) | wine-9.0 (Ubuntu 9.0~repack-4build3) |
| PowerShell (tests only) | 7.6.10 (preinstalled on the runner); Windows PowerShell 5.1 on the Windows runner |

**That this is the 5.10 toolchain was checked first:** before any change, the same job rebuilt the unmodified 5.10
source from the delivered 5.10 archive and produced `EightMax.exe`, `mwcli.exe` and `gpustress.exe` with the SHA-256
of the shipped 5.10 files (`a14af9c6...`, `516649c0...`, `f2b21ee1...`), the three Linux programs and the interface,
byte for byte (workflow run 45618606007). The development machine rebuilt the three 5.10 Linux programs and the
interface byte for byte as well. Every difference between the 5.10 and 5.11 programs therefore comes from the source.

**Reproducibility.** The job builds the tree twice, in two directories: all 7 artifacts byte-identical
(`validation/5.11/build/reproducible.txt`). The development machine built the three Linux programs and the interface
from the same source: byte-identical to the runner's (`c31652d291cbcc3a...` for mwcli).

Compiler flags are unchanged: `-O2 -march=x86-64 -ffp-contract=off` for the multiway engine (strict IEEE arithmetic).

## Reproducing the build

As BUILD-5.10.md (Node, Python 3, GCC/G++ with C++20, zlib; for Windows binaries MinGW-w64 with POSIX threads and its
static zlib: `apt-get install g++-mingw-w64-x86-64-posix libz-mingw-w64-dev`):

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
node source/tools/verify_build.js .     # after copying the programs to the release root: "Verified the executables, interface and source: af452eaa0ea731be"
```

The fingerprint covers `source/VERSION`, `source/native`, `web`, `wasm`, `tools`, `tests`, `studies` and the CI
workflow (415 files; 5.10: 405).

**Files added to the fingerprint in 5.11 (10):** `native/streams511.hpp` (the generator, the address rule and its
proof), `native/streams511_check.hpp` (engine checks, stream printer, counter audit), `native/mwcli_selftest511.hpp`,
`native/selftest511_golden.hpp`, `native/selftest511_reference.hpp`, `native/selftest511_limits.hpp` (recorded
values), `tests/v511.test.js`, `tools/independent_streams511.py`, `tools/streams511_overlap.c`,
`tools/validate_windows511.ps1`.
**Files changed (21):** `VERSION`; `native/mw.cpp`, `native/mw.h` (the stream mode of the generator, spec keys,
limits, header, information, public interface), `native/mw_es.hpp`, `native/mw_es_impl.hpp` (three call sites that
address the action stream of a deal; the refusal rule), `native/checkpoint_native.hpp` (the streams of a state are
verified), `native/response58.hpp` (response training of a philox64 state uses its own key domain),
`native/es_rbes510_check.hpp` (the exact check keeps its own generator), `native/study52.hpp`,
`native/mwcli_study52.hpp` (the study's choice of streams, its limit, its record), `native/study_checkpoint55.hpp`
(the build is compared before the plan), `native/mwcli.cpp` (`--selftest511`, `--streams511`, the trainer's bound),
`native/mwcli_selftest58.hpp` (four study requests name the 5.10 streams), `tests/v52.test.js`, `tests/v57.test.js`,
`tests/v571.test.js`, `tests/v58.test.js` (studies compared with older programs or with the 5.10 limit name the 5.10
streams), `tests/v59.test.js`, `tests/v510.test.js` (assertions that named the version or the workflow),
`tools/host_refusal59.js` (as the tests), `.github/workflows/windows.yml`. No CUDA source, no kernel, no scheduler
file, no evaluator and no interface file changed.

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---:|---|
| `EightMax.exe` | 5,155,328 | `2f86dac83809155a4fa49e0ceacab5ca3d8d88c8bae673d44bcfc7960227cefc` |
| `mwcli.exe` | 3,660,288 | `4fe5a916717250eb94afcfdb980d146546ca6ea92ca5ae194fff8cb1579a124c` |
| `gpustress.exe` | 2,486,784 | `4e806d59fc5bd84659230bf330d4a0ec0ea63701f2ad89e3a493fe8a91c81c92` |
| `EightMax-Offline.html` | 1,224,106 | `8354f97fd230480b95e93fda38c006ed58b28a64a63854a5132fb505938e6b78` |
| `validation/5.11/linux-bin/mwcli` | 2,757,176 | `c31652d291cbcc3ac480d1bccc3a8384e2978ec4f4322be73b00d75db4766b06` |
| `validation/5.11/linux-bin/eightmax` | 4,239,704 | `17febb0fc77a9ecc9c3fdd0c4d2925d1ce08ed6a234ba95d88dd9d24e8a420a4` |
| `validation/5.11/linux-bin/gpustress` | 1,644,384 | `03fbf3f0119020f43174bd7cde0403fcc713615c5914efccb05b0dbf098d6c9d` |

Build identifier embedded in all three executables and in `BUILD-INFO.json`: `af452eaa0ea731be` (version 5.11).

`SHA256SUMS.txt` lists every file of the archive except itself. The archive's own SHA-256 is in
`EightMax-Windows-5.11.identity.json`, delivered beside the ZIP.

## Tests, experiments and packaging

```sh
EM_TEST_MWCLI=$PWD/build/linux/mwcli EM_TEST_HOST=$PWD/build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap source/tests/*.test.js
bash validation/5.11/run_final511.sh . <5.10 mwcli> <work dir>            # self-tests, recorded tables, independent implementations, desktop host, interface, stability, identity against 5.10
bash validation/5.11/sanitize511.sh . <work dir>                          # AddressSanitizer, UndefinedBehaviorSanitizer, ThreadSanitizer, LeakSanitizer
bash validation/5.11/wine511.sh . <wrapper dir> <work dir>                # the Windows programs under Wine
bash validation/5.11/powershell511.sh . <pwsh> <work dir>                 # the Windows validation script under PowerShell 7 on Linux
python3 validation/5.11/convergence/convergence511.py run . <5.10 mwcli> build/linux/mwcli <5.10 timed> <5.11 timed> <fresh dir> 2
python3 validation/5.11/convergence/reproduce511.py . build/linux/mwcli validation/5.11/convergence/exact <out.json>
python3 validation/5.11/convergence/tables511.py validation/5.11/convergence/exact > tables.md
python3 validation/5.11/performance/bench511.py . build/linux/mwcli <out.json> 5     # on an idle machine
python3 validation/5.11/make_reference511.py . build/linux/mwcli          # only after an intended change of the streams
build/linux/mwcli --selftest511 studies <work dir> record                 # the recorded tables of the self-test, likewise
python3 validation/5.11/make_script511.py .                               # validate_windows511.ps1 and the launchers from the 5.10 ones
python3 validation/5.11/release511.py . <out dir> --wine                  # ZIP, clean extraction, manifest, smoke tests of the Windows programs under Wine
```

`<5.10 timed>` and `<5.11 timed>` are `validation/5.10/convergence/timed510.cpp` and
`validation/5.11/convergence/timed511.cpp` compiled against the engine source of the respective release. The
unchanged 5.10 Linux binary is `validation/5.10/linux-bin/mwcli` (`chmod +x` a copy).
The jobs that ran these on hosted runners are described in VALIDATION-5.11.md; their definition is kept in
`validation/5.11/ci/`.
