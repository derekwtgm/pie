# Building EightMax 5.17

Final source/build identifier: `6efe7970626b6460` (5.16 was `39600509cc5a98e8`).
**New identifier:** `brhu-5.17-v1`, an evaluation algorithm (request method `exact-hu`). It writes no state and
changes none. The identifiers of 5.10 to 5.16 (`rbes-5.10-v1`, `streams-5.11-philox4x64-v1`, `satfield-5.13-v1`,
`nrp-5.14-v1`, `nrpc-5.14-v1`, `tour-5.15-v1`, `ranked-5.16-v1`) are unchanged.
Checkpoint formats: unchanged (EMMW4, EMZ1, study checkpoint version 1). No training algorithm changed.

The Windows programs were cross-compiled on the development machine with the toolchain of BUILD-5.12.md
(`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, `libz-mingw-w64-dev` 1.3.1, gcc 13.3.0, Node v22.23.5, Python
3.13.18; Wine 9.0 and Chromium for tests). The 5.17 tree was built twice in two directories: 9 of 9 artifacts identical
(`validation/5.17/build/reproducible.txt`). Flags unchanged (`-O2 -march=x86-64 -ffp-contract=off` for the engine).

**OpenCL.** The program needs no OpenCL files to build: it declares the few entry points it uses and loads
`OpenCL.dll` (from `System32`) or `libOpenCL.so.1` at run time. The kernel is not compiled at build time. Its text,
`native/brhu_kernel.h`, is embedded by `native/gen_brhu.py` into `native/brhu_kernel_src.hpp` and compiled by the
driver of the PC when a request asks for the GPU (`-cl-std=CL1.2`, no option that relaxes floating point). For
tests on the development machine: PoCL 5.0 (`pocl-opencl-icd` of Ubuntu 24.04), an OpenCL implementation on the CPU.

**Why not CUDA.** The project's other GPU code is CUDA, with kernels compiled ahead of time by NVIDIA's compiler.
I downloaded that compiler for this phase; running it on the development machine was refused by the machine's
safety rules, and I did not work around that. OpenCL needs no compiler on my side. The kernel is plain C, so a CUDA
version of the same file is a small step if you prefer it later.

```sh
python3 source/native/gen_brhu.py                 # after a change of brhu_kernel.h (a test fails if it is stale)
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
node source/tools/verify_build.js .
```

The fingerprint covers 903 files (5.16: 893).

**Added (10):** `native/brhu_kernel.h` (one item: a river subtree on one complete board, for every hand of the
responder; compiled as C++ for the CPU and as OpenCL C by the driver), `native/brhu_kernel_src.hpp` (its text,
generated), `native/gen_brhu.py`, `native/brhu517.hpp` (the tables, the walk of the earlier streets in two passes,
the CPU runner, the device runner with the repetition on the CPU), `native/brhu_ocl.hpp` (OpenCL loaded at run
time, device choice, the arithmetic probe), `native/mwcli_selftest517.hpp`; `tools/games517.js` (twelve heads-up
games), `tools/independent_brhu517.py` (the independent check of 4.8 pointed at the new method),
`tools/validate_windows517.ps1`; `tests/v517.test.js`.

**Changed (15):** `VERSION`.
Engine: `native/action_ev.hpp` (the request method `exact-hu` and its two fields in the response-gain request; the
other methods refuse those fields), `native/mw.cpp` and `native/mw.h` (`mw_opencl_info`), `native/mwcli.cpp`
(`--selftest517`, `--opencl-info`), `native/MW-PROTOCOL.md`.
Tests: `tests/v59.test.js`, `v510`, `v511`, `v512`, `v513`, `v514`, `v515`, `v516` (version lists; the name of the
current Windows script); `.github/workflows/windows.yml`.

**Not changed:** the trainers, the hand groupings, the streams, the payoff models, pruning, methods `exact`,
`restricted` and `sampled`, the trained response of 5.8, CUDA (`cuda_score.hpp`, `score.cu`), the OpenCL solver of
the heads-up tab (`gpu.c`), `web/`, `wasm/`, the 26 fixtures, the libraries, `eqtime`. The identity runs of
VALIDATION-5.17.md are the evidence that every study trains to the states of 5.16.

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---:|---|
| `EightMax.exe` | 5,874,176 | `28a5cbdd30a2afe1d1e79a5c8a50aeeda2ab7e087e5bf41510c64da2a86d81e1` |
| `mwcli.exe` | 4,516,864 | `f89905914df8b63024c1b45af434f004d2f135ae4b6be00d0b744df12f6525df` |
| `gpustress.exe` | 2,750,464 | `a0847df8018568ac83c5ae09267ec0ff9ec9b7a30601ac72068caa5af5f400ce` |
| `eqtime.exe` | 2,837,504 | `3ed76c89613a411bace8c6d49d04746a178a454b5cd6d7bdd3888a34a27bb9a1` |
| `EightMax-Offline.html` | 1,653,130 | `def9baa129c2a01a6bea93eeebd07baecdd797ea77faa25288a31ff462139ce5` |
| `validation/5.17/linux-bin/mwcli` | 3,739,272 | `fa3b53202f2d9e50f51ac3b095da47bca7ddd07414b87b5e8357a47adf81a69b` |

## Packaging

`validation/5.17/release517.py . <out> --wine --evidence <EightMax-5.12-evidence-2.3-to-5.8.zip>` writes
`EightMax-Windows-5.17.zip` and the identity file. The files of `validation/5.17/evidence-moved.txt` (the list of
5.12, 3,896 files) stay out of the ZIP; the script rebuilds the second archive from the 5.17 tree, requires the
SHA-256 of the archive delivered with 5.12, and does not deliver it again.

## Tests and tools

```sh
EM_TEST_MWCLI=$PWD/build/linux/mwcli EM_TEST_HOST=$PWD/build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap source/tests/*.test.js
python3 validation/5.17/measure517.py . validation/5.17/measure       # the comparisons of the plan (resumable)
python3 validation/5.17/analyze517.py validation/5.17/measure/units validation/5.17/measure
bash validation/5.17/run_final517.sh . <5.16 mwcli> <work dir>   # self-tests, recorded values, fixtures, interface, OpenCL device, earlier programs, independent check, identity against 5.16
bash validation/5.17/sanitize517.sh . <work dir>
bash validation/5.17/wine517.sh . <wrapper dir> <work dir>
node source/tools/games517.js spec <game> <compact|detailed|ranked|exact> <out.json> [seed]
python3 source/tools/independent_brhu517.py build/linux/mwcli <spec> <state>
python3 validation/5.17/make_reference517.py . build/linux/mwcli  # the cases of the self-test and of the Windows script
python3 validation/5.17/make_script517.py .
EM_BRHU_ALLOW_CPU_DEVICE=1 build/linux/mwcli --opencl-info        # with PoCL installed: the device path on a CPU
```

Environment variables of the new method (tests): `EM_BRHU_DEVICE=<index>`, `EM_BRHU_ALLOW_CPU_DEVICE=1`,
`EM_BRHU_BATCH=<items>`, `EM_BRHU_TEST=unprotected|flip`, `EM_BRHU_DEBUG=1`.
