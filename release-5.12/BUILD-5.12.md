# Building EightMax 5.12

Final source/build identifier: `913dc2280e5088ae` (5.11 was `af452eaa0ea731be`).
Training algorithm identifiers: unchanged. No training code changed in 5.12, so there is no new identifier and no new
checkpoint header: `streams-5.11-philox4x64-v1` and `rbes-5.10-v1` mean what they meant in 5.11, and a state without
an identifier is a state of the 5.10 streams and the default trainer.
Checkpoint formats: unchanged (EMMW4, EMZ1, study checkpoint version 1 tied to its build).

The complete source is included. The Windows programs are unsigned x64 PE executables with a statically linked
language runtime and zlib; they import only system DLLs.

## How the shipped executables were built

They were **cross-compiled on Linux**, as every release since 5.3 - and, unlike 5.11, **on the development machine
itself**: this phase's machine could install the distribution's cross-compiler, the one BUILD-5.10.md and
BUILD-5.11.md name.

| Tool | Version used |
|---|---|
| Host | development machine: Ubuntu 24.04 container, x86-64, 4 virtual processors, 15 GiB |
| Windows cross-compiler | x86_64-w64-mingw32-g++-posix (GCC) 13-posix (`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, POSIX threads) |
| Windows zlib | `libz-mingw-w64-dev` 1.3.1+dfsg-1 (static) |
| Linux compiler | gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0 |
| Node | v22.23.5 |
| Python | Python 3.13.18 |
| Wine (tests only) | wine-9.0 (Ubuntu 9.0~repack-4build3), 64-bit only |
| Chromium (interface tests only) | the Playwright build preinstalled on the machine |
| PowerShell | none on the development machine; Windows PowerShell 5.1 on the hosted Windows runner |

**That this is the 5.11 toolchain was checked first:** before any change, the unmodified 5.11 source from the
delivered 5.11 archive was rebuilt here and gave `EightMax.exe`, `mwcli.exe` and `gpustress.exe` with the SHA-256 of
the shipped 5.11 files (`2f86dac8...`, `4fe5a916...`, `4e806d59...`), the three Linux programs and the interface,
byte for byte (`validation/5.12/baseline/baseline-5.11.json`). Every difference between the 5.11 and 5.12 programs
therefore comes from the source.

**Reproducibility.** The tree was built twice, in two directories: all 7 artifacts byte-identical
(`validation/5.12/build/reproducible.txt`).

Compiler flags are unchanged: `-O2 -march=x86-64 -ffp-contract=off` for the multiway engine (strict IEEE arithmetic).

## Reproducing the build

As BUILD-5.11.md (Node, Python 3, GCC/G++ with C++20, zlib; for Windows binaries MinGW-w64 with POSIX threads and its
static zlib: `apt-get install g++-mingw-w64-x86-64-posix libz-mingw-w64-dev`):

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
node source/tools/verify_build.js .     # after copying the programs to the release root: "Verified the executables, interface and source: 913dc2280e5088ae"
```

The fingerprint covers `source/VERSION`, `source/native`, `web`, `wasm`, `tools`, `tests`, `studies` and the CI
workflow (432 files; 5.11: 415).

**Files added to the fingerprint in 5.12 (17):** `web/lib_charts6.js`, `web/lib_deeplib6.js` (the 6-max library);
six fixtures `studies/*-6max*.emfix.json`, `studies/icm6-bb-call*.emfix.json`; `tools/fixtures512.js` (their
definitions); `native/mwcli_selftest512.hpp`, `native/selftest512_golden.hpp`, `native/selftest512_reference.hpp`
(the self-test and its recorded values); `tests/v512.test.js`; `tools/library512.js`, `tools/chart_validation512.js`,
`tools/table_ui512.js`, `tools/validate_windows512.ps1`.
**Files changed (19):** `VERSION`; `web/app.js`, `web/app.css`, `web/index.template.html` (the switch and what follows
it), `web/lib_river_ui.js` (the multiway example deals in the table size), `web/lib_study_ui.js` (the fixture list
by table size); `tools/gen_charts.js`, `tools/gen_deep.js` (the number of seats as a parameter), `tools/build.js`
(both libraries packed into the page), `tools/fixtures52.js` (a fixture may name its table; registers the 6-max
definitions), `tools/package_smoke.js`, `tools/mtt_ui_smoke.js`, `tools/checkpoint_ui_smoke.js` (the 6-max library is
compared too); `native/mwcli.cpp` (three lines: `--selftest512`); `tests/v59.test.js`, `tests/v510.test.js`,
`tests/v511.test.js` (assertions that named the version or the workflow's script); `tests/v52.test.js` (its list of the
fixture folder leaves out the six new fixtures: see VALIDATION-5.12.md, section 3); `.github/workflows/windows.yml`.
**Not changed:** every other file of `source/native` - the engine (`mw.cpp`, `mw.h`, `mw_es*.hpp`), both trainers,
`streams511.hpp`, the checkpoint code, the evaluators, the response measure, CUDA, the kernels, the scheduler - and
`web/lib_charts.js`, `web/lib_deeplib.js`, `wasm/`. Their SHA-256 are in
`validation/5.12/selftest/unchanged-engine-files.sha256`.

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---:|---|
| `EightMax.exe` | 5,388,288 | `b23fad162aaa6b77e0c060f558c47a6dac4d2d029c09b1fece7a3178bfa95cca` |
| `mwcli.exe` | 3,724,800 | `c4259b8f97aeb6b706e75bf2478f8525aa51f78ddf69d5d1a6c2bb9019419fd5` |
| `gpustress.exe` | 2,486,784 | `b7e06ae9cdc7bfdece1e5eed5fed0cf1795dd6a5bde5928c70000c4ef7970180` |
| `EightMax-Offline.html` | 1,457,318 | `20e55c629a22251a17781e649a001425090dcc84b9d29ab8ee8b486debc24218` |
| `validation/5.12/linux-bin/mwcli` | 2,833,376 | `e37bb06388a3f4c5d118cc39d9c1aae369e78ca07e1faa7053d2ecd7d3a59c8d` |
| `linux-bin/eightmax (beside the ZIP)` | 4,473,176 | `b08c49f77732cc3c555a437fc779598cbfb95f9b177df68e555cedd73eb07e9f` |
| `linux-bin/gpustress (beside the ZIP)` | 1,644,384 | `60ab9fda74694b131a9ac04868f4cc2bdd3b60e1bcc9d39867f3e6aae537874e` |

Build identifier embedded in all three executables and in `BUILD-INFO.json`: `913dc2280e5088ae` (version 5.12).
`EightMax.exe` and `EightMax-Offline.html` are larger than in 5.11 by the 6-max library and the six fixtures
(233 KB of page text).

`SHA256SUMS.txt` lists every file of the archive except itself. The archive's own SHA-256 is in
`EightMax-Windows-5.12.identity.json`, delivered beside the ZIP.

## The two archives

`validation/5.12/release512.py` writes `EightMax-Windows-5.12.zip` and, from the files listed in
`validation/5.12/evidence-moved.txt` (3,896 files), `EightMax-5.12-evidence-2.3-to-5.8.zip`. The list was made
mechanically: a file of `validation/2.3` to `validation/5.8` stays in the release ZIP if its folder (or the file) is
named by a test, a tool, a native source file, a launcher, the workflow or a script of `validation/5.9` to `5.12`;
everything else moves. What stays of the old releases, by release:

* `validation/3.3`: `traversal-calibration.json`
* `validation/3.6`: `linked-fixture`
* `validation/3.7`: `fixtures`, `native-continuation.py`, `restore-sizes.py`
* `validation/3.8`: `cache-tuning.json`, `native-timing.json`
* `validation/4.0`: `README.md`, `bench40.json`, `bench40.log`, `checkpoint-sizes.json`, `checkpoint_ui_smoke.log`, `convergence40.json`, `convergence40.log`, `explorer-host-linux.json`, `fixtures`, `mtt_ui_smoke.log`, `native-continuation.json`, `native-host-linux.json`, `native-mw-linux.json`, `native-restore-sizes.json` and 9 more
* `validation/4.3`: `README.md`, `baseline42-regression.json`, `baseline42-regression.txt`, `bench43-interleaved-ab.txt`, `bench43.json`, `bench43.log`, `checkpoint-sizes.json`, `checkpoint_ui_smoke.log`, `convergence43.json`, `convergence43.log`, `coverage43.json`, `cuda-matrix-double.txt`, `explorer-host-linux.json`, `mtt_ui_smoke.log` and 14 more
* `validation/4.4`: `NUMERIC-POLICY.md`, `README.md`, `deadline`
* `validation/4.5`: `convergence`, `fixtures`
* `validation/4.6`: `windows-release.ps1`
* `validation/4.7`: `checkpoints`, `convergence`, `fixtures`
* `validation/4.8`: `fixtures`
* `validation/4.9`: `fixtures`
* `validation/5.0`: `fixtures`, `scheduling`
* `validation/5.1`: `README.md`, `bench`, `build-linux.log`, `build-windows.log`, `deadline`, `fixtures`, `regression-linux-f94a1d7-missing-release-notes.log`, `regression-linux.json`, `regression-linux.log`, `sanitizers`, `scheduling`, `six-player`, `v40-v51-final-commit.tap`, `windows-ci` and 1 more
* `validation/5.2`: `fixtures`, `release`, `six-player`, `studies`
* `validation/5.3`: `fixtures`, `linux-bin`, `sanitizers`
* `validation/5.4`: `statistics`, `studies`
* `validation/5.5`: `linux-bin`
* `validation/5.6`: `convergence`, `linux-bin`, `statistics`, `unbiasedness`, `windows`, `wine`
* `validation/5.7`: `fixtures`, `identity`, `linux-bin`, `profile`, `windows`
* `validation/5.7.1`: `checkpoint`, `validation-summary.json`, `windows-5.7-physical`
* `validation/5.8`: `convergence`, `host_refusal58.js`, `identity`, `linux-bin`, `windows`
* nothing stays of: 2.3, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.4, 3.5, 3.9, 4.1, 4.2

The rule can keep too much, never too little that matters without being noticed: the complete regression suite, the
seven self-tests, the Wine runs and the packaging checks were executed in a tree without the moved files
(VALIDATION-5.12.md).

## Tests, experiments and packaging

```sh
EM_TEST_MWCLI=$PWD/build/linux/mwcli EM_TEST_HOST=$PWD/build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap source/tests/*.test.js
bash validation/5.12/run_final512.sh . <5.11 mwcli> <work dir>            # self-tests, recorded tables, the library measured and regenerated twice, fixtures, the interface in a browser, identity against 5.11
bash validation/5.12/sanitize512.sh . <work dir>                          # AddressSanitizer, UndefinedBehaviorSanitizer, ThreadSanitizer, LeakSanitizer
bash validation/5.12/wine512.sh . <wrapper dir> <work dir>                # the Windows programs under Wine
node source/tools/chart_validation512.js build/linux/mwcli <out.json>     # the charts beside two other solvers (information)
node source/tools/fixtures52.js build/linux/mwcli source/studies          # the sixteen fixtures (--check <dir> compares)
build/linux/mwcli --selftest512 studies <work dir> record                 # the recorded tables of the self-test, after an intended change of a fixture
python3 validation/5.12/make_reference512.py . build/linux/mwcli          # the reference files of the Windows script, likewise
python3 validation/5.12/make_script512.py .                               # validate_windows512.ps1 and the launchers from the 5.11 ones
python3 validation/5.12/release512.py . <out dir> --wine                  # both archives, clean extraction, manifest, smoke tests of the Windows programs under Wine
```

The unchanged 5.11 Linux binary is `validation/5.11/linux-bin/mwcli` (`chmod +x` a copy).
`.github/workflows/windows.yml` (the in-tree MSYS2 workflow) was updated for 5.12 and, as for 5.10 and 5.11, not run.
The workflow that ran the launchers on a hosted Windows runner is kept in `validation/5.12/ci/`.
