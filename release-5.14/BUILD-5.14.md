# Building EightMax 5.14

Final source/build identifier: `57befd67c7c86ebe` (5.13 was `e9ce3436fa829e47`).
**New algorithm identifiers:** `nrp-5.14-v1` and `nrpc-5.14-v1` (experimental pruning). A state trained under one of
them carries the identifier with its settings in the `estimator` field of its header, for example
`"estimator":"nrp-5.14-v1;threshold=0.02;evidence=50;skip=0.94999999999999996"`, and a derived study identifier. The
identifiers of 5.10 to 5.13 (`rbes-5.10-v1`, `streams-5.11-philox4x64-v1`, `satfield-5.13-v1`) are unchanged.
Checkpoint formats: unchanged (EMMW4, EMZ1, study checkpoint version 1).

The Windows programs were cross-compiled on the development machine with the toolchain of BUILD-5.12.md
(`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, `libz-mingw-w64-dev` 1.3.1, gcc 13.3.0, Node v22.23.5, Python
3.13.18; Wine 9.0 and Chromium for tests). The 5.14 tree was built twice in two directories: 9 of 9 artifacts identical
(`validation/5.14/build/reproducible.txt`). Flags unchanged (`-O2 -march=x86-64 -ffp-contract=off` for the engine).

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
node source/tools/verify_build.js .
```

There is a fourth program now: `eqtime` / `eqtime.exe` (the equal-time tool; the engine linked into one executable,
as in `mwcli`). `verify_build.js` checks its build identifier with the others.

The fingerprint covers 868 files (5.13: 448). 413 of the new ones are the specifications and reference
values of the equal-time tool (`tools/eqtime-specs/`: 20 games x 20 seeds, 9 quick specs, 2 fixtures, 2 reference
files), which are in the fingerprint so that the tool cannot be run against other games than the ones recorded.

**Added (7 + 413):** `native/mwcli_selftest514.hpp`, `native/selftest514_golden.hpp`, `native/selftest514_reference.hpp`;
`tools/eqtime514.cpp`, `tools/eqtime-specs/`; `tools/validate_windows514.ps1`; `tests/prune514.cpp` (the frozen-table
harness), `tests/v514.test.js`.
**Changed (15):** `VERSION`; engine: `native/mw_es.hpp` (the pruning fields and statistics of a game; its algorithm
name; the continuation rule; the per-thread order of a deal's increments), `native/mw_es_impl.hpp` (the pruning
branch of the traversal; the grouped merge), `native/mw.cpp` (spec keys `pruning`, `pruneThreshold`, `pruneEvidence`,
`pruneSkip`; refusals; header; information), `native/study52.hpp` and `native/mwcli_study52.hpp` (a study may name a
pruning algorithm; `pruning=` on the command line), `native/mwcli.cpp` (`--selftest514`), `native/build.sh` (the
fourth program); `tools/verify_build.js`; `tests/v59.test.js`, `v510`, `v511`, `v512`, `v513` (version lists);
`.github/workflows/windows.yml`.
**Not changed:** `es_rbes510*.hpp` (the `rbes` estimator), `streams511.hpp`, `satfield513.hpp`, `icm.hpp`, the
evaluators, the response measure, CUDA, hand grouping, everything under `web/` and `wasm/`, the fixtures, the
libraries. (`validation/5.14/selftest/unchanged-engine-files.sha256` lists hashes to compare with 5.13.)

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---:|---|
| `EightMax.exe` | 5,504,000 | `5e90fa8905f8d5456a4fa990a00680b3820c1f81962cdb0143997863af1ba282` |
| `mwcli.exe` | 3,943,424 | `cccf9b6ae9da1dfee26e2935dc36c358af0b3a71845a4613fc5e46830dcaa5d7` |
| `gpustress.exe` | 2,507,264 | `09e624869b45a00319e3babffaedc88d86c4419dfee82d6f4e4fdb23e97549c9` |
| `eqtime.exe` | 2,595,328 | `d5d7cb251d0bf2bff0e2575c923b3c3db3f5549fb33193f3adc8412e4c4662dd` |
| `EightMax-Offline.html` | 1,543,446 | `4beb044fab384fd703757638ae7e240e22fb03fc571c821cc3124cc80f9aa33a` |
| `validation/5.14/linux-bin/mwcli` | 3,096,824 | `5943c06a115f03235b49ddaddf101e74fd9482b166838a8d535f4065b4fd4f68` |
| `linux-bin/eightmax (beside the ZIP)` | 4,589,496 | `6952f26a970d8f67864caa56970bea11853e3530864d74bc430b776a32345b6b` |
| `linux-bin/gpustress (beside the ZIP)` | 1,666,496 | `7d4cc028758d46b1dc10174e41f433f01d36fbd0d32897878fc2af82c27de920` |
| `linux-bin/eqtime (beside the ZIP)` | 1,766,312 | `c12a8ef6ce1a17868f7fc96fc258b6c7306eaf093088b9f6e8f6fb0a0ad37aae` |

## Packaging

`validation/5.14/release514.py . <out> --wine --evidence <EightMax-5.12-evidence-2.3-to-5.8.zip>` writes
`EightMax-Windows-5.14.zip` and the identity file. The files of `validation/5.14/evidence-moved.txt` (the list of
5.12, 3,896 files) stay out of the ZIP; the script rebuilds the second archive from the 5.14 tree, requires the
SHA-256 of the archive delivered with 5.12, and does not deliver it again.

## Tests and tools

```sh
EM_TEST_MWCLI=$PWD/build/linux/mwcli EM_TEST_HOST=$PWD/build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap source/tests/*.test.js
bash validation/5.14/run_final514.sh . <5.13 mwcli> <work dir>   # self-tests, recorded tables, frozen-table test, eqtime reference and quick trials, fixtures, interface, identity against 5.13
bash validation/5.14/run_satfield514.sh .                        # the long independent check of the satellite model (unchanged code; run again)
bash validation/5.14/sanitize514.sh . <work dir>
bash validation/5.14/wine514.sh . <wrapper dir> <work dir>
build/linux/eqtime pruning --times 1,4 --jobs 4 --out <dir>      # the Linux runs of CONVERGENCE-5.14.md
build/linux/eqtime threads --threads 4 --out <dir>; build/linux/eqtime scaling --out <dir>
build/linux/eqtime analyze <dir>                                 # the summary again from raw.jsonl
build/linux/mwcli --selftest514 studies <work dir> record        # after an intended change of the pruning rule
build/linux/eqtime reference source/tools/eqtime-specs           # after an intended change of a trainer the tool runs
python3 validation/5.14/make_script514.py .
```
