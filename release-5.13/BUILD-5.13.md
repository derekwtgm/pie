# Building EightMax 5.13

Final source/build identifier: `e9ce3436fa829e47` (5.12 was `913dc2280e5088ae`).
**New identifier:** payoff model `satfield-5.13-v1` (large-field satellites). A state trained under it carries
`"payoffModel":"satfield-5.13-v1"`, `"satelliteSeats"`, `"satelliteFieldPlayers"` and `"satelliteFieldChips"` in its
header and a derived study identifier. Training algorithm identifiers (`streams-5.11-philox4x64-v1`, `rbes-5.10-v1`)
are unchanged and combine with it. Checkpoint formats: unchanged (EMMW4, EMZ1, study checkpoint version 1).

The Windows programs were cross-compiled on the development machine with the toolchain of BUILD-5.12.md
(`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, `libz-mingw-w64-dev` 1.3.1, gcc 13.3.0, Node v22.23.5, Python
3.13.18; Wine 9.0 and Chromium for tests). **That this toolchain reproduces 5.12 was checked first:** the source of
the delivered 5.12 archive rebuilt to its seven artifacts byte for byte. The 5.13 tree was built twice in two
directories: 7 of 7 artifacts identical (`validation/5.13/build/reproducible.txt`). Flags unchanged
(`-O2 -march=x86-64 -ffp-contract=off` for the engine; the satellite model depends on `-ffp-contract=off`, as the
rest of the engine does, for bit-identical results).

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
node source/tools/verify_build.js .
```

The fingerprint covers 448 files (5.12: 432).

**Added (16):** `native/satfield513.hpp` (the model, its mathematics in the header comment), `native/mwcli_selftest513.hpp`,
`native/selftest513_golden.hpp`, `_reference.hpp`, `_values.hpp`; six fixtures (`studies/sat*.emfix.json`,
`studies/known-sat-akq-river.emfix.json`); `tools/fixtures513.js`; `tools/independent_satfield513.py`;
`tools/sat_ui513.js`; `tools/validate_windows513.ps1`; `tests/v513.test.js`.
**Changed (18):** `VERSION`; engine: `native/icm.hpp` (includes the model; one branch in `evaluate`),
`native/mw.cpp` (spec fields `icm.model`, `seats`, `field`; header fields; information; the continuation rule),
`native/checkpoint_native.hpp` (the continuation rule for restored checkpoints), `native/action_ev.hpp` (the unit of
the reported utility); `native/mwcli.cpp` (`--selftest513`, `--satfield`); interface: `web/lib_icm.js` (the
JavaScript mirror, `parsePayouts`, `parseField`), `web/app.js` (payout shorthand, the satellite card),
`web/lib_river_ui.js` (the Multiway payoff), `web/lib_study_ui.js` (the "Satellites" group; a payout row without
places); `tools/fixtures52.js` (registers the satellite fixtures; a fixture names its EV unit),
`tools/table_ui512.js` (accepts a third group in the Study list); `tests/v52.test.js`, `v59`, `v510`, `v511`, `v512`
(lists and version assertions); `.github/workflows/windows.yml`.
**Not changed:** the trainers (`mw_es*.hpp`, `es_*.hpp`), `streams511.hpp`, the evaluators' algorithms, the response
measure, CUDA, hand grouping, the libraries (`lib_charts*.js`, `lib_deeplib*.js`), `wasm/`.

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---:|---|
| `EightMax.exe` | 5,495,296 | `991875f0bbfb4ffd574daa7c7a59b9c6e19f85d897cad88609da342160c7971f` |
| `mwcli.exe` | 3,861,504 | `4243dafd047972a55b62f71260ddd881b8b30cb91671ecbfe3a83c3684afe7b9` |
| `gpustress.exe` | 2,499,072 | `b91a3d3f6eb4c83595b9754209842688dc710561a39cafc76c5c0b524c480832` |
| `EightMax-Offline.html` | 1,543,446 | `45cfbefb75e6a28fcab9776e02e6204de0d9ab09c13767e5927bd55333f28af1` |
| `validation/5.13/linux-bin/mwcli` | 2,994,928 | `5109e6819ca5fd0311dcb84e8b4c61cffaed0eccda855d92bca1ab9834388494` |
| `linux-bin/eightmax (beside the ZIP)` | 4,580,344 | `af655246e8438a7fcd58c886b6cae5aee1106518e57b41e0a8ee9171f8deaf1a` |
| `linux-bin/gpustress (beside the ZIP)` | 1,653,240 | `650a2d0f0687f3d832adf6f357106b612fba48ec194cca65728c0e370f7b1127` |

## Packaging

`validation/5.13/release513.py . <out> --wine --evidence <EightMax-5.12-evidence-2.3-to-5.8.zip>` writes
`EightMax-Windows-5.13.zip` and the identity file. The files of `validation/5.13/evidence-moved.txt` (the list of
5.12, 3,896 files) stay out of the ZIP; the script rebuilds the second archive from the 5.13 tree, requires the
SHA-256 of the archive delivered with 5.12, and does not deliver it again.

## Tests and tools

```sh
EM_TEST_MWCLI=$PWD/build/linux/mwcli EM_TEST_HOST=$PWD/build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap source/tests/*.test.js
bash validation/5.13/run_final513.sh . <5.12 mwcli> <work dir>     # self-tests, recorded tables, the model against the independent implementation, field summaries, fixtures, the interface, identity against 5.12
bash validation/5.13/sanitize513.sh . <work dir>
bash validation/5.13/wine513.sh . <wrapper dir> <work dir>
python3 source/tools/independent_satfield513.py check build/linux/mwcli out.json     # rules A and C (about 40 minutes); SATFIELD_QUICK=1 for a short form
python3 source/tools/independent_satfield513.py summary build/linux/mwcli out.json   # rule D
build/linux/mwcli --selftest513 studies <work dir> record                            # after an intended change of a fixture or of the model
python3 validation/5.13/make_reference513.py . build/linux/mwcli; python3 validation/5.13/make_script513.py .
```
