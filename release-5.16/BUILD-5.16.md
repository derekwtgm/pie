# Building EightMax 5.16

Final source/build identifier: `39600509cc5a98e8` (5.15 was `87b9f6e38b735cfb`).
**New identifier:** `ranked-5.16-v1`, a hand grouping. A state trained with it carries `"grouping":"ranked-5.16-v1"`
in its header; no other state has that field. The identifiers of 5.10 to 5.15 (`rbes-5.10-v1`,
`streams-5.11-philox4x64-v1`, `satfield-5.13-v1`, `nrp-5.14-v1`, `nrpc-5.14-v1`, `tour-5.15-v1`) are unchanged.
Checkpoint formats: unchanged (EMMW4, EMZ1, study checkpoint version 1). No training algorithm changed.

The Windows programs were cross-compiled on the development machine with the toolchain of BUILD-5.12.md
(`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, `libz-mingw-w64-dev` 1.3.1, gcc 13.3.0, Node v22.23.5, Python
3.13.18; Wine 9.0 and Chromium for tests). The 5.16 tree was built twice in two directories: 9 of 9 artifacts identical
(`validation/5.16/build/reproducible.txt`). Flags unchanged (`-O2 -march=x86-64 -ffp-contract=off` for the engine).
The Ranked key uses integer arithmetic only.

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
node source/tools/verify_build.js .
```

The fingerprint covers 893 files (5.15: 886).

**Added (7):** `native/mwcli_selftest516.hpp`, `native/selftest516_golden.hpp`; `tools/games516.js` (the games of the
measurement, four groupings each, and two held-out games), `tools/grouped516.js` (JavaScript against native for
Ranked), `tools/grouping_ui516.js`, `tools/validate_windows516.ps1`; `tests/v516.test.js`.

**Changed (19):** `VERSION`.
Engine: `native/es_groups.hpp` (`RankedGroups`: the key; a table of a range's distinct strengths per seat and board,
published with a compare-and-swap; `GroupKeys` routes the three places that computed Compact's signal through one
function that returns Compact's signal unless the grouping is Ranked), `native/mw.cpp` (the spec value `"ranked"`,
refused for studies that start before the flop; the header field when writing and when loading; the name in the
trainer information), `native/checkpoint_native.hpp` (the same rule in the streaming loader), `native/explorer.hpp`
(the name), `native/mwcli.cpp` (`--selftest516`).
Interface: `web/lib_wide.js` (`rankedGroup`, the mirror; numeric keys for Ranked as for Compact; the header field),
`web/lib_river.js` (the grouping is known to the exact cross-check), `web/lib_river_ui.js` (the fourth choice; the
note).
Tests: `tests/v59.test.js`, `v510`, `v511`, `v512`, `v513`, `v514`, `v515` (version lists; the name of the current
Windows script); `.github/workflows/windows.yml`.

**Not changed:** the trainers (`mw_es.hpp`, `mw_es_impl.hpp`, `es_rbes510*.hpp`), `strengthGroup()` and
`featureKey()` (the Compact and Detailed keys), the streams, the payoff models, pruning, the response measure, CUDA,
`wasm/`, the 26 fixtures, the libraries, `eqtime`. The identity runs of VALIDATION-5.16.md are the evidence that
Compact, Detailed and Exact cards write the states of 5.15.

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---:|---|
| `EightMax.exe` | 5,780,992 | `86b8cb1d81ba66ac7192991c66021bcc7a24746679cdccf3bc947be8d699e37f` |
| `mwcli.exe` | 4,338,176 | `b07d8e33948b89b16c7f6b47ee449f87233a04a9144a52fe4838b39405752411` |
| `gpustress.exe` | 2,656,768 | `2ce887ec1d415ae36d8697f153f2642107ed5929959905e864d45f294f11730e` |
| `eqtime.exe` | 2,744,832 | `42f8617d618ea72396058bbb5a4d9952015f9a13188f5bf0182c684cced6f104` |
| `EightMax-Offline.html` | 1,653,130 | `b2c9249d8b10acf6a2237f8d0e0cdaa3406cb927ffa3d0fa4dc2d35441552254` |
| `validation/5.16/linux-bin/mwcli` | 3,531,608 | `b0e54bb289bab925a5c3fd0029b10b0208f0360661de58b781ec2d86bab04839` |

## Packaging

`validation/5.16/release516.py . <out> --wine --evidence <EightMax-5.12-evidence-2.3-to-5.8.zip>` writes
`EightMax-Windows-5.16.zip` and the identity file. The files of `validation/5.16/evidence-moved.txt` (the list of
5.12, 3,896 files) stay out of the ZIP; the script rebuilds the second archive from the 5.16 tree, requires the
SHA-256 of the archive delivered with 5.12, and does not deliver it again.

## Tests and tools

```sh
EM_TEST_MWCLI=$PWD/build/linux/mwcli EM_TEST_HOST=$PWD/build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap source/tests/*.test.js
python3 validation/5.16/grouping516.py . validation/5.16/grouping 3 ranked      # the units of the plan (resumable)
EM_GAMES=ho-hu-river,ho-hu-turn python3 validation/5.16/grouping516.py . validation/5.16/heldout 3 ranked
python3 validation/5.16/analyze516.py . validation/5.16/grouping/units validation/5.16/grouping ranked
bash validation/5.16/run_final516.sh . <5.15 mwcli> <work dir>   # self-tests, recorded table, mirror, fixtures, interface, earlier programs, size check, identity against 5.15
bash validation/5.16/sanitize516.sh . <work dir>
bash validation/5.16/wine516.sh . <wrapper dir> <work dir>
node source/tools/games516.js spec <game> <compact|detailed|ranked|exact> <out.json> [seed]
node source/tools/grouped516.js build/linux/mwcli <out.json> [--quick]
build/linux/mwcli --selftest516 studies <work dir> record         # after an intended change of the key
python3 validation/5.16/make_reference516.py . build/linux/mwcli  # the reference files of the Windows script
python3 validation/5.16/make_script516.py .
```
