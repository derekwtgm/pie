# EightMax 5.7.1 — validation record

Build `65e835e6b7060960`. Every line names what was run, where, the result, and the file that holds the evidence. Paths are
relative to the release folder. Nothing in this record was run on Windows hardware or on an NVIDIA GPU.

## Environments

| Name | What it is |
|---|---|
| **Linux** | Ubuntu 24.04 container, x86-64, 4 logical processors, 15 GiB RAM. GCC 13.3.0, Node 22.23.5, Python 3.13.18 |
| **Wine** | the Windows executables of this release (cross-compiled with MinGW-w64 GCC 13, POSIX threads, static) run by wine-9.0 (Ubuntu 9.0~repack-4build3) in the same container. Wine is not Windows |
| **Windows (5.7 only)** | the user's PC: Windows 11 Home 10.0.26300, Core i7-13700F (24 logical processors), 15.8 GiB, RTX 4060 Ti 8 GB, driver 621.01, Windows PowerShell 5.1. It ran **5.7**, not 5.7.1 |

Classes used below: **1** independently tested (an exact reference or the unchanged 5.7 binary agrees) · **2** the
project's own tests on Linux, or the Windows programs under Wine · **3** implemented, awaiting physical Windows or
GPU validation · **4** not executed.

## 1. Baseline: the supplied 5.7 release (before any change)

| Test | Environment | Result | Evidence |
|---|---|---|---|
| SHA-256 of `EightMax-Windows-5.7.zip` against its identity file | Linux | equal (`283df7c4…ef9d5e`) | `validation/5.7.1/baseline/baseline-5.7.json` |
| Every file of the extracted archive against `SHA256SUMS.txt` | Linux | 4,534 of 4,534 match, nothing unlisted | same |
| Hashes of the three executables against the identity file | Linux | equal | same |
| `mwcli.exe --build-id` | Wine | `EightMaxBuild=e4668abe7903f8b0` | same |
| Rebuild of the unmodified 5.7 source | Linux | 3 Windows executables, 3 Linux programs and the interface byte-identical to the shipped files | same |
| The physical Windows run of 5.7 | Windows (5.7) | 81 passed, 1 failed, 0 skipped, 0 untested; CUDA matched the CPU | `validation/5.7.1/windows-5.7-physical/` |

## 2. Reproduction of the findings with the unchanged 5.7 binary

`python3 validation/5.7.1/reproduction/reproduce57.py . <work>` — Linux, binary `validation/5.7/linux-bin/mwcli`
(SHA-256 `d878054b…593af4d`, build `e4668abe7903f8b0`). Evidence: `validation/5.7.1/reproduction/reproduction-5.7-binary.json`.

| Step | Result with 5.7 |
|---|---|
| A. The script's white-space edit in both manifests, then resume | exit 0, resumed from `manifest.json`, equals the uninterrupted study — the Windows "failure" reproduced; the engine is right |
| B. A recorded value changed in `manifest.json` / in both | previous manifest used, equal / exit 5 "no usable manifest" |
| B. The stored checksum changed in `manifest.json` / in both | previous manifest used, equal / exit 5 |
| B. A state byte flipped, a state truncated, a state removed | discarded with a warning, seed retrained, equal |
| B. `manifest.json` removed | previous manifest used, equal |
| C. The script's memory command (`flop3-kings-small`, 24 MiB) | exit 0, **complete**, `stoppedByProcessMemory: false`, peak 15.3 MiB, largest table 0.067 MiB — the false positive reproduced |
| D. `flop3-kings-detailed` (95.6 MiB of tables per seed), 48 MiB | stopped (`processMemoryLimit`), peak 64 MiB, 1 measurement done; resume complete and equal — the engine's memory stop works |
| E. `manifest.json` damaged; the resuming process ended at the rename of its first commit | exit 86; `manifest.prev.json` now **is the damaged manifest**; next resume: exit 5 "no usable manifest" — the engine defect |

The same steps with the 5.7.1 binary (`validation/5.7.1/reproduction/reproduction-5.7.1-binary.json`): A to D
unchanged; E: `manifest.prev.json` unchanged by the killed process, next resume exit 0, complete, equal to the uninterrupted study.

## 3. The 5.7.1 self-test

`mwcli --selftest571 studies <work> all` — 24 checks; each study a separate process.

| Environment | Passed | Failed | Untested | Seconds | Evidence |
|---|---|---|---|---|---|
| Linux, `build/linux/mwcli` | 24 | 0 | 0 | 37 | `validation/5.7.1/selftest/selftest571-linux.json` |
| Wine, `mwcli.exe` | 24 | 0 | 0 | 51 | `validation/5.7.1/wine/selftest571-wine.json` |
| Wine, `mwcli.exe` from the packaged ZIP (clean extraction) | 24 | 0 | 0 | | `EightMax-Windows-5.7.1.identity.json`, `smokeTest.checks571` |

### 3.1 Checkpoint integrity (Linux run; the Wine run agrees check by check)

| Check | Corruption method | Exit | What the engine reported | Generation used | Completed | Equals the uninterrupted study |
|---|---|---|---|---|---|---|
| P (passed) | none (an exact copy of the source checkpoint) | 0 | none: the checkpoint was accepted as intact | manifest.json (sequence 35) | yes | yes |
| A (passed) | white space inserted outside strings in manifest.json and manifest.prev.json (after every ':' and ',', line breaks after '{' and '['); no value changed | 0 | none: the checkpoint was accepted as intact | manifest.json (sequence 35) | yes | yes |
| B1 (passed) | manifest.json: the first action frequency of the first recorded measurement (body.jobs[0].points[0].frequency[0]) changed to another value; bodySha256 not updated; manifest.prev.json intact | 0 | integrity failure of manifest.json detected; the verified previous manifest was used | manifest.prev.json (sequence 34) | yes | yes |
| B2 (passed) | manifest.json and manifest.prev.json: the first action frequency of the first recorded measurement (body.jobs[0].points[0].frequency[0]) changed to another value; bodySha256 not updated | 5 | refused (exit 5, error 409): no usable manifest; both manifest generations failed verification | — | no (refused) | not applicable |
| C1 (passed) | manifest.json: the stored checksum bodySha256 (first hexadecimal digit) changed; the body it covers is untouched; manifest.prev.json intact | 0 | integrity failure of manifest.json detected; the verified previous manifest was used | manifest.prev.json (sequence 34) | yes | yes |
| C2 (passed) | manifest.json and manifest.prev.json: the stored checksum bodySha256 (first hexadecimal digit) changed; the body it covers is untouched | 5 | refused (exit 5, error 409): no usable manifest; both manifest generations failed verification | — | no (refused) | not applicable |
| D1 (passed) | job-0-0.g15.state (generation 15): one bit of the middle byte flipped; manifests intact | 0 | an engine state failed its SHA-256/length check: discarded, the seed retrained from its start | manifest.json (sequence 35) | yes | yes |
| D2 (passed) | job-0-0.g15.state (generation 15) truncated to half its length; manifests intact | 0 | an engine state failed its SHA-256/length check: discarded, the seed retrained from its start | manifest.json (sequence 35) | yes | yes |
| E1 (passed) | manifest.json (generation 35) truncated to half its length; manifest.prev.json (generation 34) intact | 0 | integrity failure of manifest.json detected; the verified previous manifest was used | manifest.prev.json (sequence 34) | yes | yes |
| E2 (passed) | manifest.json: body.sequence changed, bodySha256 not updated; then the resuming process is ended (exit 86) at the moment it would replace manifest.json with its first new commit | 0 | integrity failure of manifest.json detected; the verified previous manifest was used | manifest.prev.json (sequence 34) | yes | yes |
| F1 (passed) | every engine state file named by manifest.json deleted; manifests intact | 0 | an engine state is missing: the seed retrained from its start | manifest.json (sequence 35) | yes | yes |
| F2 (passed) | manifest.json deleted; manifest.prev.json and the state files intact | 0 | integrity failure of manifest.json detected; the verified previous manifest was used | manifest.prev.json (sequence 34) | yes | yes |
| F3 (passed) | manifest.json and manifest.prev.json deleted; the state files left in the directory | 0 | no checkpoint was found in the directory: the study ran from its start | — | yes | yes |
| S (passed) | none: the source checkpoint the copies were made from | — | every file of the source checkpoint has the SHA-256 it had before the first copy was made | — | — | — |

E2 in detail: the killed process exited with 86; SHA-256 of `manifest.prev.json` before `500dec326a6e5c2b…` and after the kill `500dec326a6e5c2b…` (unchanged); files after the kill: manifest.json, manifest.prev.json.

### 3.2 Process memory budget

| Check | Observation | Linux | Wine (`mwcli.exe`) |
|---|---|---|---|
| E control | complete / stopped by the budget | yes / no | yes / no |
| E control | peak resident set; automatic budget | 325.2 MiB; 11261 MiB | 270.1 MiB; 11261 MiB |
| E control | tables of one seed at the last budget | 95.6 MiB | 95.6 MiB |
| A stop | `stoppedByProcessMemory`, status, resumable | true, `processMemoryLimit`, yes | true, `processMemoryLimit`, yes |
| A stop | where the study stopped | seed 5211: 18384 of 60000 deals | seed 5211: 18384 of 60000 deals |
| A stop | measurements completed of requested | 1 of 4 | 1 of 4 |
| A stop | peak against the 48 MiB budget (overshoot) | 64.2 MiB (+16.2 MiB) | 63.6 MiB (+15.6 MiB) |
| A stop | checkpoint: manifest status; states verified; deals saved of deals trained | `processMemoryLimit`; yes; 18384 of 18384 | `processMemoryLimit`; yes; 18384 of 18384 |
| B resume | exit; complete; measurements restored; state continued; equals the control | 0; yes; 1; yes; yes | 0; yes; 1; yes; yes |
| C accounting | statements not satisfied | 0 of 13 | 0 of 13 |
| D1 invalid budgets | -1, nan, inf, abc | -1: exit 2; nan: exit 2; inf: exit 2; abc: exit 2; nothing written | -1: exit 2; nan: exit 2; inf: exit 2; abc: exit 2; nothing written |
| D2 0.5 MiB budget | where it stopped; peak; resumed, complete, equal | seed 5211: 256 of 2000 deals; 8.1 MiB; yes | seed 5211: 256 of 2000 deals; 16.0 MiB; yes |

Memory accounting (check C), all satisfied: peak resident set reported; the requested budget reflected (48, not
automatic); physical memory reported; table budget reported; evaluator cache size reported; per-seed allowance
covers tables, evaluator cache and working allowance; a budget smaller than one seed's allowance admits one seed at
a time; threads per seed reported; table size of trained points reported; the document states that the budget is a
stop condition, not an allocation cap; the stop followed the excess closely; the checkpoint records only completed
measurements; every state named by the checkpoint matches its SHA-256 and length.

### 3.3 Controls of the verdicts

| Control | Observation given to the verdict | Result |
|---|---|---|
| N1 | the successful resume of P → "refused" | rejected |
| N2 | the untouched resume of P → "fell back" and "state discarded" | rejected by both |
| N3 | the fall-back resume of B1 → "intact checkpoint" | rejected |
| N4 | the completed control of memory E → "stopped by the budget" (what the 5.7 script accepted) | rejected |

## 4. Failure reporting

| Test | Environment | Result | Evidence |
|---|---|---|---|
| Self-test with every save failing (`EM_TEST_SAVE_FAULT=create`) | Linux | exit 1; 0 passed, 1 failed, 23 untested; the failing process recorded with exit 4 and its error text | `source/tests/v571.test.js`; regression tap |
| The same, with `mwcli.exe` from the packaged ZIP (checkpoint mode) | Wine | exit 1; 0 passed, 0 failed, 17 untested | identity file, `smokeTest.checks571.failureReporting` |
| Self-test, memory mode, with `flop3-kings-small` in place of the large fixture (the 5.7 situation) | Linux | exit 1; control passed; A, B, C, D1, D2 **untested** ("the fixture no longer grows past the budget") | `v571.test.js` |
| Mutations (section 5) | Linux | every broken engine reported, exit 1 | `validation/5.7.1/mutation571.json` |
| `validate_windows571.ps1`: exit status 1 on a failed or untested gate | — | **not executed**; the exit-status logic is the unchanged 5.7 code, which returned 1 on the user's PC when its one gate failed | section 9 |

## 5. Mutations: the self-test run by broken engines

`python3 validation/5.7.1/mutation571.py . <work>` — Linux. Each row is a build of `mwcli` with one line changed.

| | Mutation (one line of the engine) | Self-test exit | Checks not passed | As expected |
|---|---|---|---|---|
| M0 | none (control): the unmodified 5.7.1 source | 0 | none: 24 of 24 passed | yes |
| M1 | the 5.7.1 repair removed: the current manifest is copied to manifest.prev.json without being verified (the 5.5 to 5.7 behaviour) | 1 | checkpoint E2 (failed) | yes |
| M2 | the manifest body is not compared with its SHA-256 | 1 | checkpoint B1 (failed), checkpoint B2 (failed), checkpoint C1 (failed), checkpoint C2 (failed), checkpoint E2 (failed), controls N3 (untested) | yes |
| M3 | an engine state is not compared with its recorded SHA-256 and length (only its presence is checked) | 1 | checkpoint D1 (failed), checkpoint D2 (failed) | yes |
| M4 | no fall-back: a damaged or missing manifest.json is never replaced by manifest.prev.json | 1 | checkpoint B1 (failed), checkpoint C1 (failed), checkpoint E1 (failed), checkpoint E2 (failed), checkpoint F2 (failed), controls N3 (untested) | yes |
| M5 | the process memory budget is never enforced (every study completes: what the 5.7 script accepted as a pass) | 1 | memory A (failed), memory B (untested), memory C (untested), memory D2 (failed) | yes |
| M6 | a memory stop does not save the engine state it interrupts | 1 | memory A (failed), memory B (untested), memory C (untested), memory D2 (failed) | yes |

## 6. Regression suite

`EM_TEST_MWCLI=build/linux/mwcli EM_TEST_HOST=build/linux/eightmax node --test --test-concurrency=3 source/tests/*.test.js`
— Linux. Evidence: `validation/5.7.1/tests/full-regression.tap`, `rerun-alone.txt`.

| | tests | passed | failed | skipped |
|---|---|---|---|---|
| 5.7 (recorded in its identity file) | 592 | 591 | 0 | 1 |
| 5.7.1 | 606 | 604 | 1 | 1 |

The 14 tests added are those of `v571.test.js` (14 of 14 passed); 592 + 14 = 606.

Failed in the full run (three test files at a time): "disk forecast with compressed expansion preserves predecessor". Each was run again alone on the idle machine: passed alone (v37.test.js): disk forecast with compressed expansion preserves predecessor.

Counting a test that passed alone as passed: 605 passed, 0 failed, 1 skipped.

Classification of that failure: timing under load, not a defect. "disk forecast with compressed expansion preserves predecessor" (`v37.test.js`) uploads two checkpoints to the desktop host and expects HTTP 507 for the second; it received 503 ("busy") because the host was still finishing the preceding upload while three test files shared four processors. Evidence: it passed when run alone; the host code (`server.c`) is unchanged in 5.7.1; 5.6 recorded the same 503 for the neighbouring test "HTTP streaming refuses missing declared bytes" (`source/tests/load_sensitive.json`). In the first full run of 5.7.1 (before the test correction below) this test passed.

Skipped: "4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissions)" — the same test 5.7 skipped (it needs POSIX permissions that the container's root user overrides).

## 7. Unchanged mathematics

| Test | Environment | Result | Evidence |
|---|---|---|---|
| `identity57.py`: the 5.7 binary against the 5.7.1 binary; 10 games and 5 fixtures, trainer options, hand groups, 1 to 16 threads, measured and forced thread use, table limits, stop and continue | Linux | 225 of 225 cases identical; 1,085 of 1,085 states byte-identical | `validation/5.7.1/identity/` |
| `continuation571.py`: a state trained by 5.7 continued by 5.7.1, the reverse, and 5.7.1 alone, against the golden states of the 5.5 trainer (11 games) and of the 5.6 binary (4 frozen-batch fixtures) | Linux | 15 of 15 identical | `validation/5.7.1/continuation/continuation-against-5.7.json` |
| Complete studies by the 5.7 and the 5.7.1 binary: known game; three-way flop, exact; eight-handed ICM, exact; three-way flop, sampled | Linux | identical measurements; same calculation identifiers | `v571.test.js` |
| The same test with `mwcli.exe` | Wine | 14 of 14 tests of the file passed, the comparison with the 5.7 Linux binary among them | `validation/5.7.1/wine/v571.test.tap` |
| `mwcli --selftest57` (28 checks) | Linux / Wine | 28 / 28 passed | `validation/5.7.1/selftest/selftest57-linux.json`, `validation/5.7.1/wine/selftest57-wine.json` |
| A 5.7 study checkpoint given to 5.7.1 | Linux, Wine | refused: "the checkpoint was written by build e4668abe7903f8b0; this is build …", exit 5, directory unchanged; 5.7 itself still resumes it | `v571.test.js` |

## 8. Sanitizers

`bash validation/5.7.1/sanitize571.sh . <work>` — Linux, GCC. Evidence: `validation/5.7.1/sanitizers/`.

| Run | Result |
|---|---|
| ASan + UBSan build (host and CLI) | exit 0 |
| 5.5 and 5.6 regression files (study checkpoints, recovery, lock) with the instrumented programs | 31 tests: 31 passed, 0 failed, 0 skipped |
| The five checkpoint tests of the 5.7.1 file | 5 tests: 5 passed, 0 failed |
| `mwcli --selftest571 … checkpoint` with the instrumented program | 17 passed, 0 failed, 0 untested |
| AddressSanitizer or UBSan reports in all of the above | **0** |
| ThreadSanitizer build of the CLI | exit 0 |
| ThreadSanitizer: a checkpointed study, three seeds committing side by side | exit 0 |
| ThreadSanitizer: the same study cancelled after 1.5 s | exit 0 |
| ThreadSanitizer: that study resumed after its newest manifest was cut short (recovery from manifest.prev.json, then commits by three seeds) | exit 0 |
| ThreadSanitizer: `mwcli --selftest571 … checkpoint` | exit 0 |
| ThreadSanitizer: the self-test in checkpoint mode | 17 passed, 0 failed, 0 untested |
| ThreadSanitizer warnings | **0** |
| The resumed study under ThreadSanitizer | resumed from `manifest.prev.json`: yes; its measurements equal those of the uninterrupted study: yes |
| LeakSanitizer on a study resumed from the previous manifest | exit 0; 0 LeakSanitizer reports; resumed from `manifest.prev.json`: yes |

## 9. PowerShell script and launchers — static only

PowerShell could not be executed in development. Evidence: `validation/5.7.1/powershell/static-checks.json`.

| Check | Result |
|---|---|
| Balance of brackets, quotes and here-strings (`ps_balance.py`) | ok |
| `ps_lint571.py`: syntax newer than Windows PowerShell 5.1; commands neither defined nor allowed built-ins; variables read but never assigned | 0 findings in `validate_windows571.ps1`; 0 in the two scripts that ran on Windows (no false alarm) |
| The linter finds seeded mistakes (misspelt variable, undefined function, missing brace, `??`, unterminated string) | 5 of 5 found (`v571.test.js`) |
| Code lines taken over unchanged from the script that ran on Windows | 420 of 459; new or changed: 85 |
| Sections 3 to 7 and 10 to 13 | byte-identical to the 5.7 script (`v571.test.js`) |
| The expected-check list in the script equals the checks the program reports | equal, 24 (`v571.test.js`) |
| Launchers: CRLF, ASCII, self-test before the script, non-zero exit on failure, report names | as specified (`v571.test.js`) |

**Class 3 / 4:** the script's new lines and both launchers have never run on Windows.

## 10. Windows programs under Wine

`bash validation/5.7.1/wine571.sh . <wrappers> <work>`. Evidence: `validation/5.7.1/wine/`.

| Run | Result |
|---|---|
| `mwcli.exe --build-id` | `EightMaxBuild=65e835e6b7060960` |
| `mwcli.exe --selftest571 … all` | 24 passed, 0 failed, 0 untested |
| `mwcli.exe --selftest57` | 28 passed, 0 failed |
| 5.7.1 regression file (`v571.test.js`) with the Windows programs | 14 tests: 14 passed, 0 failed, 0 skipped |
| 5.7 regression file (`v57.test.js`) with the Windows programs | 9 tests: 9 passed, 0 failed, 0 skipped |
| 5.6 regression file (`v56.test.js`) with the Windows programs | 15 tests: 15 passed, 0 failed, 0 skipped |
| 5.5 regression file (`v55.test.js`) with the Windows programs | 16 tests: 15 passed, 1 failed, 0 skipped; failed: "5.5 desktop: studies are checkpointed, listed, resumed after Stop and after the host process is killed, and discarded, without the command line" |
| Tests that failed above, run again alone | FAILED AGAIN ALONE (v55.test.js): 5.5 desktop: studies are checkpointed, listed, resumed after Stop and after the host process is killed, and discarded, without the command line |
| Control: that test alone, from an empty save folder, with the **unmodified 5.7** Windows programs and with the 5.7.1 ones | 5.7: failed; 5.7.1: failed; same assertion: yes (`assert.ok(fs.existsSync(path.join(dir, 'request.json')))`). The test gives the desktop host a private folder through HOME and USERPROFILE and then reads the saved study from that folder on disk. Under Wine the host did not use that folder: the study was found in the Wine profile (drive_c/users/root/Documents/EightMax/studies), and the folder the test reads stayed empty. A second run then also finds the study left by the first (the shared save folder that validation/5.6/wine/per-file.json describes for earlier releases). On Linux the same test passes with the 5.7.1 host, in the full regression run and with the AddressSanitizer build. Classification: a limitation of running this test through Wine, present with the 5.7 programs too; not a regression of 5.7.1 |

## 11. Desktop application

| Test | Environment | Result | Evidence |
|---|---|---|---|
| The Study tab driven in a browser against the desktop host (run, stop, saved-study list, resume after the host was killed, result flags, discard, review of a 5.4 result) | Linux, Chromium 157.0.8103.78 | 20 of 20 checks passed | `validation/5.7.1/ui/` |
| Stability run against the desktop host (pause and resume cycles, cancel during evaluation, a long checkpointed study) | Linux | 11 of 11 checks passed in 166 s (3 minutes requested) | `validation/5.7.1/stability/` |

## 12. The package

`python3 validation/5.7.1/release571.py . <out> --wine`: the ZIP is built, hashed, extracted into an empty
directory, and everything below is done with the extracted copy only.

| Check | Result |
|---|---|
| Archive | `EightMax-Windows-5.7.1.zip`, 86,049,044 bytes |
| Archive SHA-256 | `1dd44b552a9f3eafe1c11f6e627d69fc37cd466772b8f17b7b178865d57477ef` |
| Manifest | 4,638 entries, every extracted file present and matching, nothing unlisted; `SHA256SUMS.txt` SHA-256 `665832ce3d55d631b433a661f84eb5e98fbd2a35acdd3f25ec541454d348596a` |
| Build identifier = source fingerprint | `65e835e6b7060960`, recomputed from the extracted source and found in the three executables and the interface |
| `EightMax.exe` | 4,982,272 bytes, SHA-256 `884d2d71ca7ca20cbb10cbb451f04e6af5cf76707afd5aacff2dd1fc7ec848cf` |
| `mwcli.exe` | 3,045,376 bytes, SHA-256 `a9bafd1789f9541b7d7e0468af656ae885770421095695911fe6c678d29b4a8c` |
| `gpustress.exe` | 2,314,752 bytes, SHA-256 `f8d2b7e3f036e109d6b48e46576ce5564586927c7eb0d3d97539d0c9073f5cdd` |
| Smoke tests of the extracted executables | Windows executables under Wine |
| Build identifiers reported | mwcli.exe: EightMaxBuild=65e835e6b7060960; EightMax.exe: EightMaxBuild=65e835e6b7060960; gpustress.exe: usage printed, exit 2 |
| Study of the known game | call frequency 0.5008 (closed form 1/2), EV gap 0.0047 BB (closed form 0) |
| Desktop host | version 5.7.1, build 65e835e6b7060960, Study tab served, saved-study list answered |
| Interrupted and resumed study | resumed equals uninterrupted: yes |
| 11 golden states of the 5.5 trainer | 11 of 11 identical |
| Checkpoint lock | second process refused: True; killed study resumed equal: yes |
| `mwcli.exe --selftest57` | 28 passed, 0 failed |
| CPU-only, Automatic, Hybrid and GPU-Preferred without a GPU | all on the CPU, identical measurements (16 points) |
| `mwcli.exe --selftest571 … all` | 24 passed, 0 failed, 0 untested |
| Memory stop through the packaged `mwcli.exe` | `stoppedByProcessMemory` true at 18384 of 60000 deals, peak 63.7 MiB of a 48 MiB budget; resumed equals the control: yes |
| Failure reporting through the packaged `mwcli.exe` (every save failing) | exit 1; 0 passed, 0 failed, 17 untested |

## 13. Not executed

| Item | Why | Class |
|---|---|---|
| The 5.7.1 programs on Windows hardware | no Windows machine in development | 3 |
| `validate_windows571.ps1` and both launchers | PowerShell could not be run; the repository could not be pushed to, so no CI runner either | 3 |
| CUDA with the 5.7.1 executables | no NVIDIA GPU; no CUDA source changed | 3 |
| `.github/workflows/windows.yml` | no runner reachable | 4 |
| Performance and convergence measurements | not repeated: no training or evaluation code changed (section 7) | — |
