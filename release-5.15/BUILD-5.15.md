# Building EightMax 5.15

Final source/build identifier: `87b9f6e38b735cfb` (5.14 was `57befd67c7c86ebe`).
**New algorithm identifier:** `tour-5.15-v1`, a payoff model (knockout and progressive-knockout bounties; simulation
of future hands). A state trained under it carries `"payoffModel":"tour-5.15-v1"` and a `"payoffKey"` (16 hex digits
of FNV-1a over the model's parameters: start stacks, prizes, bounty share and heads, number of future hands, their
blinds, ante and table order) in its header, and a derived study identifier. The identifiers of 5.10 to 5.14
(`rbes-5.10-v1`, `streams-5.11-philox4x64-v1`, `satfield-5.13-v1`, `nrp-5.14-v1`, `nrpc-5.14-v1`) are unchanged.
Checkpoint formats: unchanged (EMMW4, EMZ1, study checkpoint version 1). No training algorithm changed.

The Windows programs were cross-compiled on the development machine with the toolchain of BUILD-5.12.md
(`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, `libz-mingw-w64-dev` 1.3.1, gcc 13.3.0, Node v22.23.5, Python
3.13.18; Wine 9.0 and Chromium for tests). The 5.15 tree was built twice in two directories: 9 of 9 artifacts identical
(`validation/5.15/build/reproducible.txt`). Flags unchanged (`-O2 -march=x86-64 -ffp-contract=off` for the engine).
The model uses additions, multiplications, divisions and `sqrt` only (no `pow`, `exp` or `log`), so that every
platform computes the same bits.

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
node source/tools/verify_build.js .
```

The fingerprint covers 886 files (5.14: 868).

**Added (18):**
`native/tour515.hpp` (the model: ICM with busts, the push/fold game, the pool rule, the table of solved future
hands), `native/pf515_tables.hpp` (generated: the equity table of `web/lib_eqdata.js` and the class pair counts),
`native/mwcli_tour515.hpp` (`mwcli --tour515`), `native/mwcli_selftest515.hpp`, `native/selftest515_values.hpp`,
`native/selftest515_golden.hpp`, `native/selftest515_reference.hpp`; `web/lib_tour515.js` (the JavaScript mirror);
`tools/gen_pf515.js`, `tools/independent_tour515.py`, `tools/fixtures515.js`, `tools/tour_ui515.js`,
`tools/validate_windows515.ps1`; `tests/v515.test.js`; four fixtures (`studies/pko6-bb-call`, `pko6-bb-call-small`,
`fgs4-bubble-bb-call`, `fgs4-bubble-bb-call-small`).

**Changed (26):** `VERSION`.
Engine: `native/icm.hpp` (the model as a member of the tournament; an evaluation that also takes the winners of the
last pot of a busted seat), `native/mw.cpp` (spec `"icm":{"model":"tour-5.15",...}`; the header fields; the trainer
information; who won the last pot at a terminal of the protocol-3 walk), `native/mw_es_impl.hpp` and
`native/action_ev.hpp` (the same at their terminals; the largest possible utility includes the bounties),
`native/checkpoint_native.hpp` (the continuation rule), `native/mwcli.cpp` (`--tour515`, `--selftest515`),
`native/build.sh` (the mirror is part of the checkpoint verifier's bundle).
Interface: `web/lib_pushfold.js` (bounties and future hands go through the model; an outcome-valuation hook),
`web/lib_icm.js` (the study utility under the model), `web/lib_wide.js` and `web/lib_runouts.js` (the pot list is
passed to the utility), `web/lib_river_ui.js` (the form fields), `web/lib_study_ui.js` (the fourth group of
fixtures), `web/app.js` (the calculator's controls; push/fold to study carries bounties and future hands; the
heads-up postflop bounty rule).
Tools and tests: `tools/build.js`, `tools/loadlib.js` (the new library), `tools/fixtures52.js` (the new definitions);
`tests/fgs.test.js` (the wording of the depth limit), `tests/v59.test.js`, `v510`, `v511`, `v512`, `v513`, `v514`
(version lists; `v513` counts 26 fixtures); `.github/workflows/windows.yml`.

**Not changed:** the trainers' sampling and update code (`mw_es.hpp`, `es_rbes510*.hpp`), `streams511.hpp`,
`satfield513.hpp`, the pruning of 5.14, the response measure, CUDA, hand grouping, `wasm/`, the 22 fixtures of 5.14,
the libraries, `eqtime`. `mw_es_impl.hpp` and `action_ev.hpp` changed only where a terminal is valued and only when
the model is on: the identity runs of VALIDATION-5.15.md are the evidence. `web/lib_fgs.js` is kept unchanged, but
its two-hand path now calls the calculator, which uses the model: it is no longer the 5.14 computation for two hands.

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---:|---|
| `EightMax.exe` | 5,766,144 | `bae6596f54f88907b56afd6dafc5b623dd36d155c0d6e1a6b31b0b6acbedd6ee` |
| `mwcli.exe` | 4,277,248 | `02db076227981c92e80513857e9ad3e535b057d7d1a46456bf6963a3bf86c8a9` |
| `gpustress.exe` | 2,646,528 | `740f499d175617f7f40c4dabe6600d0578e087815a0b02f59e667b41cde03ed4` |
| `eqtime.exe` | 2,734,592 | `7a9fe1e0c4f8757f1cf9196221c9f8770244150814ee8bc44fdd7fd56b7991ec` |
| `EightMax-Offline.html` | 1,650,295 | `8c24364dfae86729b2f036f471ef4ce58a2150b9e2260de555ff0a9f9c4294a0` |
| `validation/5.15/linux-bin/mwcli` | 3,458,024 | `0cee01a1e3d00a32180521aa69059103978c1deabcb0686acc1ac82a6eece1ef` |
| `linux-bin/eightmax (beside the ZIP)` | 4,864,872 | `8e7840245f1ba2d526bf000b4e85c69c60b403519a45cd3f169f181c9b1bf8d3` |
| `linux-bin/gpustress (beside the ZIP)` | 1,819,032 | `f844c6b48ba1848483868e97167276f6b8173b809dce712dbcfb13552e134d8a` |
| `linux-bin/eqtime (beside the ZIP)` | 1,918,848 | `6e441542361fcae8541604809cf1f9988c121c9f29ecb3ad6bf4b46707dc017e` |

## Packaging

`validation/5.15/release515.py . <out> --wine --evidence <EightMax-5.12-evidence-2.3-to-5.8.zip>` writes
`EightMax-Windows-5.15.zip` and the identity file. The files of `validation/5.15/evidence-moved.txt` (the list of
5.12, 3,896 files) stay out of the ZIP; the script rebuilds the second archive from the 5.15 tree, requires the
SHA-256 of the archive delivered with 5.12, and does not deliver it again.

## Tests and tools

```sh
EM_TEST_MWCLI=$PWD/build/linux/mwcli EM_TEST_HOST=$PWD/build/linux/eightmax node --test --test-concurrency=1 --test-reporter=tap source/tests/*.test.js
bash validation/5.15/run_final515.sh . <5.14 mwcli> <work dir>   # self-tests, recorded tables, the model (R1), fixtures, interface, studies, earlier programs, R3, R4, identity against 5.14
python3 validation/5.15/convergence515.py . <out dir> [jobs]      # R2: training under the model, exact NashConv
bash validation/5.15/sanitize515.sh . <work dir>
bash validation/5.15/wine515.sh . <wrapper dir> <work dir>
build/linux/mwcli --tour515 <request.json>                        # values of the model, 17 digits and bits
python3 source/tools/independent_tour515.py check build/linux/mwcli validation/5.15/model/requests.json <report.json>
node source/tools/gen_pf515.js [--check]                          # the data table of the native push/fold game
build/linux/mwcli --selftest515 studies <work dir> record         # after an intended change of the model
python3 validation/5.15/make_reference515.py . build/linux/mwcli  # the reference files of the Windows script
python3 validation/5.15/make_script515.py .
node source/tools/fixtures52.js build/linux/mwcli source/studies pko6-bb-call pko6-bb-call-small fgs4-bubble-bb-call fgs4-bubble-bb-call-small
```
