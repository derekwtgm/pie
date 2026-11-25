# EightMax 5.12: validation

Build `913dc2280e5088ae`. What was checked, where, and with what result. "Development machine" is an Ubuntu 24.04 container
with 4 processors; "runner" is a hosted GitHub Actions machine. Nothing here ran on the target PC or on a GPU.

## 1. Baseline: 5.11, before any change (`validation/5.12/baseline/`)

| Check | Result |
|---|---|
| The delivered 5.11 archive against its identity file | SHA-256 `df014e80...` in both |
| Rebuild of the unmodified 5.11 source | all 7 artifacts byte-identical to the shipped files (3 Windows executables, the interface, 3 Linux programs) |
| Regression suite | 668 tests: 666 passed, 1 failed, 1 skipped (the release's own record on a runner: 668 / 0 / 0) |
| The failure | `5.3 timed CLI reproduction`: it asserts that a study with a time limit does not finish all 100 seeds; this machine finishes them. On the unmodified 5.11 program. |
| The skip | `4.9 a checkpoint save into a read-only folder`: the suite ran as root, where permissions are not enforced |
| Self-tests 5.7 / 5.7.1 / 5.8 / 5.9 / 5.10 / 5.11 | 28 / 24 / 33 / 32 / 21 / 26, all passed |

Order: the rebuild was compared before any file changed; the suite and self-tests of the baseline ran in a separate
copy of the unmodified tree while development began elsewhere. The first selftest57 run was started with wrong
arguments (a usage error, exit 2) and repeated.

## 2. The trainer is the trainer of 5.11

| Check | Result |
|---|---|
| Engine source | of `source/native`, only `mwcli.cpp` changed (three lines) and three self-test files were added; hashes of the engine files in `selftest/unchanged-engine-files.sha256` |
| Self-tests 5.7 to 5.11 with their recorded tables untouched | all passed: Linux, Wine, Windows Server 2025 |
| The unchanged 5.11 binary against 5.12, `tools/identity57.py` | 225 configurations, 1,782 trainings, 0 differences |
| The unchanged 5.11 binary against 5.12, all sixteen fixtures (`identity512.py`) | 64 cases (24 six-handed; both kinds of streams; one deal per update and frozen batches on three threads), 64 identical |
| The same for the 24 recorded six-handed states, as a regression test | `v512.test.js`, passed |

## 3. Regression suite (`validation/5.12/tests/`)

| | 5.11 baseline, this machine | 5.12, this machine |
|---|---|---|
| Tests | 668 | 682 (the 14 of `v512.test.js` are new) |
| Passed | 666 | 680 |
| Failed | 1 | 1 |
| Skipped | 1 | 1 |

Failed in 5.12:

* `5.3 timed CLI reproduction: all 100 requested seeds are counted and incomplete budgets cannot meet tolerance` - the test that fails on the unmodified 5.11 program here too (it expects a time-limited study not to finish; this machine finishes it)

Skipped in 5.12:

* `4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissi` - running as root: permissions are not enforced


**One existing test had to change.** The first complete run of the suite (build `75384ec5af6d4fb1`) failed `5.2
fixtures: the four studies, their companions and the over-limit fixture ...`: that test lists the fixture folder and
expected exactly the ten fixtures of 5.2. It now leaves the six 6-max fixtures out of its list and checks the ten as
before (`v512.test.js` checks the six and the list of all sixteen). Because tests are part of the source fingerprint,
the correction made a new build, `913dc2280e5088ae`, and every run reported in this file was repeated with it. Nothing else
differs between the two builds.

The suite ran in a copy of the release tree **without the 3,896 evidence files that moved to the second
archive**. The count of skipped tests is the baseline's, so no test went quiet for want of a moved file.

## 4. What 5.12 added

| Check | Where | Result |
|---|---|---|
| `mwcli --selftest512` (8 checks) | Linux; Wine; Windows Server 2025 | 8 passed, 0 failed, 0 untested on each |
| A fresh recording of its tables equals the shipped ones | Linux | 2 of 2 files |
| Library: acceptance rules of `plan.json` | Linux | 32 of 32 charts accepted (LIBRARY-5.12.md) |
| Library: two regenerations in separate processes, six seats and eight | Linux | 8 of 8 files identical to the shipped ones |
| Fixtures: the generator rebuilds all sixteen; `studies/` equals `source/studies` | Linux; through `mwcli.exe` under Wine | 16 identical |
| The switch in Chromium (`tools/table_ui512.js`) | Linux | 21 of 21, among them: 18 library views of 8-max are the HTML of the 5.11 page; the percentage shown six-handed equals the chart decoded independently; persistence; no script error |
| Study tab against the desktop host (`validation/5.9/study_ui59.js`) | Linux | 20 of 20 |
| Desktop host, refused studies (`tools/host_refusal59.js`) | Linux | exit 0 |
| `tests/v512.test.js` | Linux | 14 of 14 |
| Chart comparisons (information) | Linux | LIBRARY-5.12.md, section 5: 11 rows unresolved by the rule written beforehand |

## 5. Sanitizers (`validation/5.12/sanitizers/summary.txt`)

AddressSanitizer + UndefinedBehaviorSanitizer: `--selftest512` (all sections) and three tests of the 5.12 file: 0
reports. ThreadSanitizer: frozen-batch trainings of the three large six-handed fixtures on four threads, both kinds
of streams: 0 warnings, 6 of 6 states equal to the release program on one thread. LeakSanitizer: a six-handed ICM
training and a six-handed study: 0 reports.

## 6. The Windows programs under Wine 9.0 (`validation/5.12/wine/`)

Self-tests 5.12 / 5.11 / 5.10 / 5.9 / 5.8 / 5.7.1 / 5.7: 8 / 26 / 21 / 32 / 33 / 24 / 28 passed, none failed. The two
six-handed reference states and the philox64 reference state of 5.11 with 1, 2 and 4 threads: the SHA-256 of the
Linux build. Three tests of the 5.12 regression file with `mwcli.exe`: passed. Wine is not Windows.

## 7. A hosted Windows runner (`validation/5.12/windows-runner/`, WINDOWS-CI-5.12.md)

Windows Server 2025, 4 processors, Windows PowerShell 5.1, no NVIDIA GPU.

| Run | Focused launcher | Full launcher |
|---|---|---|
| Pre-release tree (no `SHA256SUMS.txt`) | 71 passed, 1 failed, 0 skipped, 0 untested (142.9 s) | 264 passed, 1 failed, 1 skipped, 0 untested (753.1 s) |
| The delivered archive | 71 passed, 1 failed, 0 skipped, 0 untested (142.9 s) on the pre-release tree - the failed check is `integrity / SHA256SUMS.txt`, a file only the packaged archive has; the run of the delivered archive is in WINDOWS-CI-5.12.md beside the ZIP | 264 passed, 1 failed, 1 skipped, 0 untested (753.1 s) on the pre-release tree (the same manifest check failed; the GPU section was skipped); the delivered archive: WINDOWS-CI-5.12.md beside the ZIP |

The one failure of the pre-release run is `integrity / SHA256SUMS.txt: file missing`, which is true of that tree. The
skip is the GPU section. The script could not be executed on the development machine (no PowerShell there), so the
runner is the only place its 5.12 sections have run; they passed on their first execution.

## 8. Build and packaging

Two builds in two directories: 7 of 7 artifacts identical. `verify_build.js`: executables, interface and source carry
`913dc2280e5088ae`. Packaging checks on a clean extraction of the delivered ZIP, with the Windows programs under Wine: see
the identity file (`smokeTest`: every earlier block, and `checks512`).

## 9. Not validated

* The target PC; an NVIDIA GPU; CUDA scoring of six-handed studies (Hybrid and GPU-Preferred fell back to the CPU on
  every machine so far).
* What the interface looks like on Windows (WINDOWS-TESTS-5.12.md, section 4).
* The in-tree MSYS2 workflow (`.github/workflows/windows.yml`): updated, not run.
* Anything about how close the charts are to equilibrium play (LIBRARY-5.12.md, section 6).
