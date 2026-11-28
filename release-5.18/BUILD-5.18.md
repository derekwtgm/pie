# Building EightMax 5.18

Final source/build identifier: `23205cbc12cae290` (5.17 was `6efe7970626b6460`).
**New identifier:** `map-5.18-v1`: the rule that maps a bet size the tree does not have onto the sizes it has, and
the states `mwcli --translate` writes with it. The identifiers of 5.10 to 5.17 (`rbes-5.10-v1`,
`streams-5.11-philox4x64-v1`, `satfield-5.13-v1`, `nrp-5.14-v1`, `nrpc-5.14-v1`, `tour-5.15-v1`, `ranked-5.16-v1`,
`brhu-5.17-v1`) are unchanged.
Checkpoint format: EMMW4, unchanged for every trained state. A **translated** state is an EMMW4 file with three more
header fields (`translated`, `mapping`, `translatedFrom`) and a study identifier of its own; RELEASE-5.18.md,
"Checkpoints". No training algorithm changed.

The Windows programs were cross-compiled on the development machine with the toolchain of BUILD-5.12.md
(`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, `libz-mingw-w64-dev` 1.3.1, gcc 13.3.0, Node v22.23.5, Python
3.13.18; Wine 9.0 and Chromium for tests; PoCL 5.0 for the device checks of 5.17). The 5.18 tree was built twice in
two directories: 9 of 9 artifacts identical (`validation/5.18/build/reproducible.txt`). Flags unchanged
(`-O2 -march=x86-64 -ffp-contract=off` for the engine).

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
node source/tools/verify_build.js .
```

The fingerprint covers 911 files (5.17: 903).

**Added (8):** `native/map518.hpp` (the rule; the study identifier and the header check of a translated state),
`native/translate518.hpp` (`mw_translate`: two betting trees walked together, the rows of the target assembled from
the rows of the source; `mw_offtree`: a line of real actions onto one tree), `native/mwcli_selftest518.hpp`;
`web/lib_offtree.js` (the JavaScript mirror of the rule); `tools/games518.js` (three heads-up games and one
three-player game, each with variants that add one size), `tools/offtree_ui518.js` (the explorer field in a browser
against the desktop host), `tools/validate_windows518.ps1`; `tests/v518.test.js`.

**Changed (21):** `VERSION`.
Engine: `native/mw.cpp` (the header of a state is written by one function, `esHeaderJson`, used by the exporter and
by `--translate`; the importer reads the three fields; a translated state is refused for training; `mw_info` shows
the fields), `native/checkpoint_native.hpp` (the streaming loader reads the three fields), `native/mw.h`,
`native/mwcli.cpp` (`--translate`, `--offtree`, `--selftest518`), `native/ckpt_suite.hpp` (`--state-info` prints the
three fields when present), `native/MW-PROTOCOL.md`.
Interface: `web/lib_explorer.js` and `web/lib_river_ui.js` (the strategy explorer's field for a size the tree does
not have), `web/lib_wide.js` (the JavaScript engine refuses a translated state with the reason), `tools/build.js`
(the new library in the page).
Tests: `tests/v59.test.js`, `v510`, `v511`, `v512`, `v513`, `v514`, `v515`, `v516`, `v517` (version lists; the name
of the current Windows script); `.github/workflows/windows.yml`.

**Not changed:** the trainers, the hand groupings, the streams, the payoff models, pruning, the evaluation methods
(`exact`, `exact-hu`, `restricted`, `sampled`), the trained response of 5.8, CUDA, OpenCL (`brhu_kernel.h` and its
embedded text have the SHA-256 of 5.17: `validation/5.18/selftest/engine-files.sha256`), `wasm/`, the 26 fixtures,
the libraries, `eqtime`. The identity runs of VALIDATION-5.18.md are the evidence that every study trains to the
states of 5.17, and `--selftest517` with its recorded bits that method `exact-hu` computes what it computed.

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---:|---|
| `EightMax.exe` | 5,911,040 | `887df729bbddf7fe06a3b024660ec4a623cb5da4f4af4d0d4d8bba967e169815` |
| `mwcli.exe` | 4,635,648 | `8ed7de8724433837a63a8cdcc4790ff1dadafbee3ffacbdfe1f6103d1a7dd6ac` |
| `gpustress.exe` | 2,781,184 | `d80958a9910c23e26f15ab5ea8e22bc7167bd5e4c6be7509b1a8662909df627e` |
| `eqtime.exe` | 2,867,712 | `1defd2c01896f6553175c767e886759a13f8041c7c9ec8f8600bb3d8d4d406c3` |
| `EightMax-Offline.html` | 1,658,284 | `731fa7ade2130e23acbe24db6c35c872861f53fbfea93c488cb341e9bde72543` |
| `validation/5.18/linux-bin/mwcli` | 3,877,872 | `672a142fa72ea461b01166c457b80a7a46978cc632ddf3a7cd01de9abbcc56f9` |

## Packaging

`validation/5.18/release518.py . <out> --wine --evidence <EightMax-5.12-evidence-2.3-to-5.8.zip>` writes
`EightMax-Windows-5.18.zip` and the identity file. The files of `validation/5.18/evidence-moved.txt` (the list of
5.12, 3,896 files) stay out of the ZIP; the script rebuilds the second archive from the 5.18 tree, requires the
SHA-256 of the archive delivered with 5.12, and does not deliver it again.

## Tests and tools

```sh
EM_TEST_MWCLI=$PWD/build/linux/mwcli EM_TEST_HOST=$PWD/build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap source/tests/*.test.js
python3 validation/5.18/measure518.py . validation/5.18/measure <game>   # the comparisons of the plan (resumable)
python3 validation/5.18/analyze518.py validation/5.18/measure/units validation/5.18/measure
bash validation/5.18/run_final518.sh . <5.17 mwcli> <work dir>   # self-tests, recorded values, fixtures, interface, earlier programs, identity against 5.17
bash validation/5.18/sanitize518.sh . <work dir>
bash validation/5.18/wine518.sh . <wrapper dir> <work dir>
node source/tools/games518.js list
node source/tools/games518.js spec <game> <variant|base> <compact|detailed|ranked|exact> <out.json> [seed]
python3 validation/5.18/make_reference518.py . build/linux/mwcli <work dir>   # the cases of the self-test
python3 validation/5.18/make_script518.py .
build/linux/mwcli --translate <spec A> <state A> <spec B> <out state> [nearest|harmonic|blend]
build/linux/mwcli --offtree <spec> <request.json>
node source/tools/offtree_ui518.js build/linux/eightmax <out.json> [screenshot dir]
```
