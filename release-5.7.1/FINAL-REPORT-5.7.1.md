# EightMax 5.7.1 — final report

Release: **5.7.1**, build `65e835e6b7060960`. A reliability patch to 5.7 (build `e4668abe7903f8b0`).
Date: 2026-11-23.

## 1. Summary

The physical Windows run of the 5.7 validation (Windows 11 Home, Core i7-13700F, 15.8 GiB, RTX 4060 Ti) reported 81
checks passed and 1 failed, and showed a second check that passed without testing anything.

| Finding | Root cause | Where the defect was | Repair |
|---|---|---|---|
| `recovery / damaged manifest refused` failed (exit 0) | the check changed white space only; the manifest checksum covers the canonical form of the data, so nothing was damaged | the validation script | replaced by 14 checks that damage copies of a checkpoint for real |
| `memory / a too-small process budget ...` passed with `stoppedByProcessMemory: false` | the fixture needs 8 MiB and was given 24 MiB; the check accepted "stopped **or** complete" | the validation script | replaced by 6 checks on a fixture that grows to 96 MiB per seed under a 48 MiB budget; a completed study cannot pass |
| (found while investigating) after a recovery from the previous manifest, a kill during the next commit left no usable manifest | the damaged current manifest was copied over the intact previous one before the new one was written | **the engine** (5.5, 5.6, 5.7) | the current manifest is copied only when it verifies |

The engine's handling of real corruption and of a real memory stop was already correct in 5.7; both were covered
by the Linux regression suite and are confirmed again here with the unchanged 5.7 binary. The two validator checks
were wrong, and one narrow engine defect in the fall-back path was real.

**What was executed.** Everything below ran in a Linux container: the Linux programs natively, the Windows programs
under Wine. Results: regression suite 606 tests: 604 passed, 1 failed in the full run and passed when run again alone, 1 skipped
(5.7: 592 tests, 591 passed, 0 failed, 1 skipped); `mwcli --selftest571` 24 of 24 on Linux and 24 of 24 with `mwcli.exe` under Wine;
6 engine mutations each detected by exactly the expected checks; training states identical to the 5.7 binary
in 225 of 225 cases (1,085 states); no sanitizer report.

**What was not executed.** The 5.7.1 programs have not run on Windows hardware or on an NVIDIA GPU. The PowerShell
script `validate_windows571.ps1` was **not executed at all**: running PowerShell was refused by the development
session's permission policy, and the session could not push to the repository, so the Windows CI workflow could not
run either. The script was checked statically only. **Native Windows acceptance is pending** (section 9).

## 2. Baseline (phase 1)

Source of the release: repository `derekwtgm/pie`, branch `eightmax-5.7`, folder `release-5.7`.

| Check | Result |
|---|---|
| `EightMax-Windows-5.7.zip` SHA-256 | `283df7c4464b37524f9682cf715c8895dc97e16a0493f2f835f36e0293ef9d5e`, equal to the identity file |
| `SHA256SUMS.txt`, extracted copy | 4,534 entries, every file present and matching; manifest hash equal to the identity file |
| `EightMax.exe`, `mwcli.exe`, `gpustress.exe` | hashes equal to the identity file; `mwcli.exe --build-id` under Wine: `EightMaxBuild=e4668abe7903f8b0` |
| Rebuild of the **unmodified** 5.7 source with this session's toolchain | the three Windows executables, the three Linux programs and the interface are **byte-identical** to the shipped files |

The last line matters for a patch: the toolchain reproduces 5.7 exactly, so every difference between the 5.7 and
5.7.1 programs comes from the source changes listed in section 5. Evidence: `validation/5.7.1/baseline/baseline-5.7.json`.
The uploaded Windows reports are kept in `validation/5.7.1/windows-5.7-physical/`.

## 3. Root cause: the checkpoint check

`validate_windows57.ps1`, section `recovery`, part (c):

```powershell
Write-Text $m.FullName ($t -replace '"resumeCount":', '"resumeCount" :')
... Check 'recovery' 'damaged manifest refused' ($r5.exit -ne 0 -and ...)
```

One space is inserted after a key. The study checkpoint (`source/native/study_checkpoint55.hpp`) is a directory:

| Part | Integrity data | What it covers |
|---|---|---|
| `manifest.json` | `bodySha256` | the SHA-256 of the **canonical serialisation of the parsed `body`** (the engine's JSON writer applied to the parsed value, numbers with 17 significant digits) — not the bytes of the file |
| inside the body | `studyFingerprint`, `build`, `calculationVersion` | which study, which build and which statistics the checkpoint belongs to |
| inside the body, per seed | `state.sha256`, `state.bytes` | the raw bytes and length of that seed's engine state file `job-V-S.gN.state` |
| `manifest.prev.json` | the same | the manifest committed before the newest one |

Loading verifies, in order: JSON, format and version, `bodySha256`, the fingerprint, the calculation, the build,
then each referenced state file. `manifest.json` is tried first, then `manifest.prev.json`. A state file that fails
its hash or length is **discarded** (never used) and that seed is retrained from its start; recorded measurements
are kept, because the manifest that holds them has verified.

Because the checksum is over the canonical form, two manifests that differ only in formatting are the same
checkpoint. The script's edit changed no value, the engine resumed correctly and completed with the right result,
and the check failed for expecting otherwise. Reproduced with the unchanged 5.7 Linux binary: exit 0, resumed from
`manifest.json`, result equal to an uninterrupted study (`validation/5.7.1/reproduction/reproduction-5.7-binary.json`,
section A). The same file shows what 5.7 does with real damage (section B): a changed value or a changed checksum
in `manifest.json` → the previous manifest is used; in both → exit 5, "no usable manifest"; a damaged, truncated or
missing state → discarded with a warning; in every case the final result equals the uninterrupted study.

## 4. Root cause: the memory check

`validate_windows57.ps1`, section `memory`:

```powershell
$fixture = ... 'studies\flop3-kings-small.emfix.json' ... 'processMemoryMiB=24'
Check 'memory' 'a too-small process budget stops the study without losing it' ($null -ne $d -and ($stopped -or (Study-Complete $d)))
```

How the budget works (`source/native/study52.hpp`): `processMemoryMiB` is zero (automatic: 70% of physical memory) or
any positive number; there is no positive minimum. It limits how many seeds run side by side, and the resident set
of the whole process (tables, evaluator caches, worker buffers, runtime) is compared with it **after every training
chunk and after every evaluation**. When it is exceeded the study stops, saves the engine state it interrupted,
records `stoppedByProcessMemory: true` and status `processMemoryLimit`, and stays resumable. It is a stop condition,
not a cap on allocation: the peak exceeds the budget by what one training chunk adds.

`flop3-kings-small` has 0.07 MiB of tables. The whole process peaked at 8.4 MiB on Windows (15 MiB on Linux), far
below 24 MiB. The budget was never reached, the study completed, and `$stopped -or (Study-Complete $d)` was true.
The next check resumed a study that was already complete and passed too (its "peak 0 MiB" is a third, small defect:
the script samples the peak every 100 ms and reported an unsampled process as 0). Reproduced with the 5.7 binary:
complete, `stoppedByProcessMemory: false` (same file, section C). With a workload that does exceed its budget the
5.7 engine stops, checkpoints and resumes correctly (section D). The defect was in the validator.

## 5. The engine defect, and what was modified

**Defect.** `Checkpoint::publish` copies the current `manifest.json` to `manifest.prev.json`, then writes the new
`manifest.json`. After a recovery from `manifest.prev.json` the current `manifest.json` is the damaged file, so the
first commit of the resumed study replaced the only intact manifest with the damaged one. Until the second write
completed, the directory held no usable manifest. A kill, a power loss or a failed write in that interval lost the
checkpoint ("no usable manifest"), although every measurement and state file was intact. Reproduced with the
unchanged 5.7 binary by ending the process at that rename (section E of the reproduction file: the previous
manifest's SHA-256 after the kill equals the damaged manifest's; the next resume exits with 5).

**Repair.** The current manifest becomes `manifest.prev.json` only if it verifies (format and `bodySha256`).
Otherwise `manifest.prev.json` is left alone and the damaged `manifest.json` is replaced in place. With the 5.7.1
binary the same steps leave the previous manifest unchanged and the next resume completes with the uninterrupted
result. Normal operation is unchanged: a verified manifest is copied exactly as before.

| File | Kind | Change |
|---|---|---|
| `source/native/study_checkpoint55.hpp` | engine | `intactManifestText` (new, 9 lines); one condition in `publish` |
| `source/native/state_file.hpp` | engine, test hook | `EM_TEST_SAVE_FAULT_FILE` limits the existing `EM_TEST_SAVE_FAULT` to destinations ending with the given text; unset, nothing changes |
| `source/native/mwcli_selftest571.hpp` | new, in `mwcli` | `--selftest571`: 24 checks |
| `source/native/mwcli.cpp` | CLI | dispatch of `--selftest571` (3 lines) |
| `source/VERSION` | | `5.7.1` |
| `source/tools/validate_windows571.ps1` | new | derived from the 5.7 script: 420 of its 459 code lines unchanged, 85 new or changed |
| `source/tools/ps_lint571.py` | new | static checks of PowerShell scripts |
| `source/tests/v571.test.js` | new | 14 regression tests |
| `source/tests/v48.test.js` | existing test corrected | one line: the version is compared part by part instead of as a number (section 7.1) |
| `.github/workflows/windows.yml` | CI | runs the new self-test and script (never executed) |
| `Run 5.7.1 focused validation.bat`, `Run 5.7.1 Windows validation.bat` | new | launchers |
| `validation/5.7.1/` | new | scripts and evidence of this report |

Nothing else under `source/native`, `source/web` or `source/wasm` was touched. The three executables were rebuilt
because the version and the build identifier are compiled into them; they are new binaries.

## 6. The repairs

### 6.1 `mwcli --selftest571`

The checks are part of the shipped program, so the same code ran on Linux, ran as `mwcli.exe` under Wine, and will
run on the Windows PC without depending on PowerShell. Every study is a separate `mwcli` process, recorded with its
command, exit status, standard output and standard error. All corruption is applied to copies of one source
checkpoint inside the work directory.

Checkpoint (14): P untouched copy · A white space only · B1/B2 a recorded frequency altered (newest / both
manifests) · C1/C2 `bodySha256` altered · D1/D2 state byte flipped / state truncated · E1 newest generation
destroyed · E2 kill during the first commit after a recovery · F1/F2/F3 state files / `manifest.json` / both
manifests missing · S source unchanged.
Memory (6): E control · A the stop · B the resume · C accounting (13 statements) · D1 invalid budgets · D2 a budget
below the idle process.
Controls (4): the verdict functions applied to observations they must reject.

Each checkpoint check reports: corruption method, SHA-256 before and after, engine exit status, error
classification, whether the previous generation was used and which manifest sequence number, whether the result
file was written, whether the study completed, and whether its measurements equal the uninterrupted reference.

Three rules prevent the false positives of 5.7:

1. A check records whether the condition it is about was **produced** (`exercised`). The memory stop is `failed`
   when the budget is not reached; the corruption checks verify that the file's SHA-256 changed.
2. `untested` exists as a status and is never counted as passed; the program exits with 1 if any check is failed
   or untested.
3. The verdicts are pure functions of an observation, and four controls give them observations they must reject —
   among them the exact observation the 5.7 script accepted (a normally completed study, as a memory stop).

The source checkpoint is produced by a time limit that is a fraction of what the uninterrupted study needed on the
same machine, lowered automatically if the study still finished; the memory workload is checked to exceed the
budget by a deterministic quantity (the tables of one seed, 95.6 MiB against 48 MiB) before the stop is judged.

### 6.2 `validate_windows571.ps1` and the launchers

The script is the 5.7 script with: the white-space check and the two memory checks removed; a section that runs
`--selftest571`, imports its 24 checks one by one, verifies that all 24 expected checks are present and that the
report agrees with the program's exit status; a `-Focused` switch (environment, integrity and the self-test only,
with report files of their own); evidence (exit status, standard output, standard error) kept with failed and
untested checks, in the JSON and in the text report; an unsampled peak reported as absent instead of 0; and two
recovery checks that report `untested` instead of `passed` when nothing was interrupted. Exit status 0 / 1 / 2 as
before. The launchers run the self-test first, without PowerShell, so its report exists whatever happens to the
script.

## 7. Results

### 7.1 Regression suite (Linux)

| | tests | passed | failed | skipped |
|---|---|---|---|---|
| 5.7 (recorded) | 592 | 591 | 0 | 1 |
| 5.7.1 | 606 | 604 | 1 | 1 |

The 14 tests added are those of `v571.test.js` (14 of 14 passed); 592 + 14 = 606.

Failed in the full run (three test files at a time): "disk forecast with compressed expansion preserves predecessor". Each was run again alone on the idle machine: passed alone (v37.test.js): disk forecast with compressed expansion preserves predecessor.

Counting a test that passed alone as passed: 605 passed, 0 failed, 1 skipped.

Classification of that failure: timing under load, not a defect. "disk forecast with compressed expansion preserves predecessor" (`v37.test.js`) uploads two checkpoints to the desktop host and expects HTTP 507 for the second; it received 503 ("busy") because the host was still finishing the preceding upload while three test files shared four processors. Evidence: it passed when run alone; the host code (`server.c`) is unchanged in 5.7.1; 5.6 recorded the same 503 for the neighbouring test "HTTP streaming refuses missing declared bytes" (`source/tests/load_sensitive.json`). In the first full run of 5.7.1 (before the test correction below) this test passed.

Skipped: "4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissions)" — the same test 5.7 skipped (it needs POSIX permissions that the container's root user overrides).

**One existing test was corrected, not weakened.** The first full run of the suite with version `5.7.1` had one
reproducible failure: `4.8 tournament defaults are unchanged: 8 players, 0.5/1 blinds, 0.1 bb antes, 2.3 bb starting
pot, UTG..BB`. Its assertions about the defaults passed (starting pot 2.3 BB, UTG first to act). It failed at its
version assertion (line 239), `assert.ok(+VERSION >= 4.8, 'version 4.8 or later')`: the unary plus turns `"5.7.1"` into NaN.
This is the first release with a three-part version. Classification: a defect of the test, not of the engine and
not of the tournament settings (evidence: the assertion that failed, and the same test passing unchanged in every
other respect once the version is compared part by part: major > 4, or major = 4 and minor ≥ 8). No other code
compares the version numerically (searched: `source/tests`, `source/tools`, `source/web`, `source/native`). The run
that showed this is recorded in `validation/5.7.1/tests/first-run-before-the-test-correction.md`.

The 14 new tests (`v571.test.js`): the self-test and its evidence fields; its modes and usage; failure reporting
when nothing can be saved (0 passed, exit 1) and when the workload does not reach the budget (the 5.7 false
positive: `untested`, exit 1); formatting accepted, including a manifest re-serialised by another JSON library;
altered data and altered checksums; damaged, truncated, emptied and missing files; the engine repair (kill and
failed write during the first commit after a recovery); the fault filter; the memory stop and resume; static checks
of the PowerShell script with five seeded mistakes that the checker must find; the script's structure; the
launchers; and, against the archived 5.7 binary, identical study measurements and a 5.7 study checkpoint refused
with the reason and left untouched.

### 7.2 Checkpoint integrity

| Check | Linux | `mwcli.exe` under Wine |
|---|---|---|
| P, A, B1, B2, C1, C2, D1, D2, E1, E2, F1, F2, F3, S | 14 passed | 14 passed |

Observed: white space → resumed from `manifest.json`, identical result. Altered value or checksum in the newest
manifest → "the manifest body does not match its SHA-256", previous manifest used, identical result; in both →
exit 5, no result file, directory unchanged. Damaged state → "does not match its recorded SHA-256 or length",
discarded, seed retrained, identical result, the saved measurements kept. Kill during the first commit after a
recovery → exit 86, previous manifest's SHA-256 unchanged, next resume complete and identical. Source checkpoint
digest unchanged.

### 7.3 Memory budget

| | Linux | Wine |
|---|---|---|
| Control (automatic budget) | complete, no stop, peak 325 MiB | complete, no stop, peak 270 MiB |
| 48 MiB budget | stopped at 18384 of 60000 deals, peak 64.2 MiB | stopped at 18384 of 60000 deals, peak 63.6 MiB |
| Checkpoint after the stop | verified; holds all deals trained | verified; holds all deals trained |
| Resume (automatic budget) | complete, equals the control | complete, equals the control |
| Invalid budgets (-1, nan, inf, abc) | refused, nothing written | refused, nothing written |
| 0.5 MiB budget | stops after 256 deals, resumes, equals the control | the same |

Soft stop: the peak exceeds the budget by about 16 MiB here, which is what one training chunk of this fixture adds
before the next reading. This is the documented behaviour, not a cap.

### 7.4 Can the self-test detect a broken engine? (mutations)

The self-test was run by engines with one verified behaviour broken (`validation/5.7.1/mutation571.py`):

| | Mutation (one line of the engine) | Self-test exit | Checks not passed | As expected |
|---|---|---|---|---|
| M0 | none (control): the unmodified 5.7.1 source | 0 | none: 24 of 24 passed | yes |
| M1 | the 5.7.1 repair removed: the current manifest is copied to manifest.prev.json without being verified (the 5.5 to 5.7 behaviour) | 1 | checkpoint E2 (failed) | yes |
| M2 | the manifest body is not compared with its SHA-256 | 1 | checkpoint B1 (failed), checkpoint B2 (failed), checkpoint C1 (failed), checkpoint C2 (failed), checkpoint E2 (failed), controls N3 (untested) | yes |
| M3 | an engine state is not compared with its recorded SHA-256 and length (only its presence is checked) | 1 | checkpoint D1 (failed), checkpoint D2 (failed) | yes |
| M4 | no fall-back: a damaged or missing manifest.json is never replaced by manifest.prev.json | 1 | checkpoint B1 (failed), checkpoint C1 (failed), checkpoint E1 (failed), checkpoint E2 (failed), checkpoint F2 (failed), controls N3 (untested) | yes |
| M5 | the process memory budget is never enforced (every study completes: what the 5.7 script accepted as a pass) | 1 | memory A (failed), memory B (untested), memory C (untested), memory D2 (failed) | yes |
| M6 | a memory stop does not save the engine state it interrupts | 1 | memory A (failed), memory B (untested), memory C (untested), memory D2 (failed) | yes |

The first version of the self-test did **not** detect the last mutation (a memory stop that does not save the
training it interrupts: an earlier stage state existed and the resume still gave the right result). The memory
check was tightened to require that the saved state holds every deal trained before the stop; the table is the
result after that change.

### 7.5 Nothing mathematical changed

| Evidence | Result |
|---|---|
| Training states, 5.7 binary against 5.7.1 (`identity57.py`: games, fixtures with hand groups, trainer options, 1 to 16 threads, table limits) | 225 of 225 cases identical, 1,085 states compared |
| States trained by 5.7 and continued by 5.7.1, and the reverse (`continuation571.py`) | 15 of 15 byte-identical to the golden states |
| Complete studies by both binaries (4 fixtures: known game, exact 3-way, exact 8-handed ICM, sampled 3-way) | identical measurements (`v571.test.js`) |
| `mwcli --selftest57` (28 checks: states of the 5.6 binary for 1 to 8 threads, evaluation) | 28 passed on Linux, 28 under Wine |
| 11 golden states of the 5.5 trainer, through the packaged `mwcli.exe` under Wine | identical (release smoke test) |

### 7.6 Sanitizers

AddressSanitizer + UBSan: the 5.5 and 5.6 regression files (31 tests, 31 passed, 0 failed, 0 skipped), the five checkpoint tests of the 5.7.1 file (5 of 5) and the self-test in checkpoint mode (17 of 17); 0 sanitizer reports. ThreadSanitizer: a checkpointed study with three seeds side by side, a cancelled study resumed from the previous manifest, and the self-test in checkpoint mode (17 of 17); 0 warnings. LeakSanitizer on a study resumed from the previous manifest: 0 leak reports.

The memory checks were not run with instrumented programs: the sanitizers change the resident set those checks
measure.

### 7.7 Windows programs under Wine

wine-9.0 (Ubuntu 9.0~repack-4build3). `mwcli.exe --selftest571`: 24 of 24; `--selftest57`: 28 of 28. Regression files with the Windows programs in place of the Linux ones: `v571`: 14 of 14 passed; `v57`: 9 of 9 passed; `v56`: 15 of 15 passed; `v55`: 15 of 16 passed. The one failing test (a desktop-host test of the 5.5 file that reads the host's save folder from disk) fails again alone, and fails at the same assertion with the unmodified 5.7 Windows programs: under Wine the host saves into the Wine profile, not into the folder the test gives it. It passes on Linux, also with the AddressSanitizer build. A limitation of that test under Wine, not a regression (`validation/5.7.1/wine/control-v55-desktop.json`). Wine is not Windows; this is evidence about the executables, not about a Windows PC.

### 7.8 Desktop application

The desktop host was rebuilt, not changed. Driven in Chromium 157.0.8103.78: 20 of 20 checks passed. Stability run: 11 of 11 checks passed.

## 8. Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Harmless white space behaves as the format documents | met (Linux, Wine) | checkpoint A; `v571` "formatting is not corruption" |
| Meaningful data corruption is detected | met | B1, B2 |
| Incorrect stored checksums are detected | met | C1, C2 |
| Damaged engine states are not silently accepted | met | D1, D2, F1 |
| Previous generations are used only after verification | met, and repaired for the commit after a recovery | E1, E2, F2 |
| Recovery results match uninterrupted studies | met | every resuming check compares the measurements |
| No valid original checkpoint is modified by the harness | met | S |
| A real memory-budget interruption is reproduced, `stoppedByProcessMemory` true | met | memory A |
| The checkpoint is resumable; recovery completes; result matches | met | memory A, B |
| A normally completed study cannot pass the memory-stop check | met | memory E, control N4, mutation "budget never enforced", `v571` |
| Existing mathematical results unchanged | met | section 7.5 |
| Existing regression tests pass | met | section 7.1 |
| Focused validation runs independently; full validation remains | built; **not executed on Windows** | launchers, static checks |
| Scripts propagate failures | self-test: executed (exit 1, 0 passed with every save failing); PowerShell script: **static only** | `v571`, section 9 |
| Physical Windows acceptance | **pending** | section 9 |

## 9. Remaining Windows tests

None of the following has been done; it needs the target PC (WINDOWS-TESTS-5.7.1.md):

1. `Run 5.7.1 focused validation.bat`: the 24 checks by `mwcli.exe` on Windows, and the first execution of the
   5.7.1 parts of the PowerShell script.
2. `Run 5.7.1 Windows validation.bat`: everything the 5.7 run covered, repeated for the rebuilt executables —
   integrity, golden states, thread determinism on 24 logical processors, the desktop host, and CUDA against the CPU
   on the RTX 4060 Ti.

What can differ on Windows and was considered: the working set is read with `K32GetProcessMemoryInfo`; processes
with small tables peaked at 5 to 18 MiB there (5.7 report), against a 48 MiB budget and a workload of 96 MiB of tables per seed, so
the stop should fall inside the second budget as it does on Linux and under Wine. If the first budget's evaluation
already exceeded 48 MiB the check would still require the stop, the checkpoint and the equal resume. The file
replacement on Windows (`MoveFileExW`) is the 4.6 writer that the 5.7 run exercised.

## 10. Limitations

- **PowerShell not executed.** 85 code lines of `validate_windows571.ps1` are new or changed and have never run.
  They passed a balance check and a linter written for this release (undefined commands, unassigned variables,
  PowerShell 7 syntax), which is not a parser. A syntax error there would stop the script before it writes a
  report (the launcher then says that the report file was not written); a runtime error inside a section is
  recorded as that section's error and its remaining checks are reported `untested`, which fails the run. Either
  way the self-test report written by the launcher's first step would still be complete.
- **No Windows hardware, no GPU** for the rebuilt programs. No CUDA source file changed, but that is an argument,
  not a test.
- **CI not run.** `.github/workflows/windows.yml` was updated and has never executed (for 5.7 or 5.7.1).
- **A discarded state is retrained from the start**, not from the older state file that is still on disk: the
  manifest records only the newest state's checksum, so the older file cannot be verified. Results are identical;
  only time is lost. Not changed.
- **A directory with state files but no manifest** is treated as "no checkpoint": with `resume=1` the study runs
  from its start and reports `resumed: false`; the orphaned state files are not read and not deleted. Not changed.
- **A 5.7 saved study cannot be resumed by 5.7.1** (existing build-compatibility policy).
- The known 5.7 limitation remains: a study budget above 10,000,000 deals per seed fails at the engine's update limit.
- `validate_hardware.ps1` still labels its report "EightMax 4.6 hardware validation" (cosmetic; the script that ran
  on the GPU was left untouched).
- The mutation set is small (6 mutations of the behaviours under test); it shows that these checks can fail,
  not that no other defect could pass.

## 11. Deliverables

| File | Content |
|---|---|
| `EightMax-Windows-5.7.1.zip` | the complete application, source, validation evidence and both launchers |
| `EightMax-Windows-5.7.1.identity.json` | version, build, archive SHA-256, manifest checksum, executable checksums, source fingerprint, smoke-test results of the packaged files, validation status |
| `FINAL-REPORT-5.7.1.md` | this report |
| `VALIDATION-5.7.1.md` | each executed test, its environment, result and evidence |
| `WINDOWS-TESTS-5.7.1.md` | what to run on the PC and which files to upload |
| `PATCH-NOTES-5.7.1.md` | changes from 5.7 and what is unchanged |

The archive's SHA-256 cannot be inside the archive; it is in the identity file and in the copy of this report
delivered beside the ZIP.
