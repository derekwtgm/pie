# EightMax 5.9: validation

Build `00600c81455ead44`. Every test that was run, with failed, skipped and unavailable checks; and every test that was NOT
run. Evidence files are under `validation/5.9/` inside the archive. `validation/5.9/validation-summary.json` is this
document as data (built by `summarize59.py` from the evidence files only) and is embedded in
`EightMax-Windows-5.9.identity.json`.

**Read this first.** No 5.9 program was executed on Windows hardware or on an NVIDIA GPU. "Wine" below means the
shipped Windows executables running under Wine 9.0 on Linux; "PowerShell" means PowerShell 7.4 on Linux running the
validation script against the Linux programs. Neither is a Windows PC.

## 1. Every test in one table

| Test | Result | Class | Evidence (under `validation/5.9/` unless a full path is given) |
|---|---|---|---|
| Baseline: the 5.8 archive, manifest, executables, byte-identical rebuild | all verified | 1 | `validation/5.9/baseline/` |
| Baseline: regression suite of the rebuilt 5.8 | 621 tests: 620 passed, 0 failed, 1 skipped | 2 | `baseline/regression-of-rebuilt-5.8.tap.gz` |
| Regression suite of the final 5.9 build (Linux) | 637 tests: 636 passed, 0 failed, 1 skipped | 2 | `tests/full-regression.tap` |
| Self-test 5.9 (`mwcli --selftest59`), Linux | 32 passed, 0 failed, 0 untested | 2 (its exact and independent references: 1) | `selftest/selftest59-linux.json` |
| Self-test 5.8, Linux | 33 passed, 0 failed, 0 untested | 2 | `selftest/selftest58-linux.json` |
| Self-test 5.7.1 (checkpoints, memory budget), Linux | 24 passed, 0 failed, 0 untested | 2 | `selftest/selftest571-linux.json` |
| Self-test 5.7, Linux | 28 passed, 0 failed, 0 untested | 2 | `selftest/selftest57-linux.json` |
| Independent Python implementation (generator, streams, bounds, exact coverage) | 5 checks, 0 not passed | 1 | `independent/` |
| Statistics against exact values (prespecified) | 3,360 runs, 0 failed runs; 0 distribution-free statements violated | 1 / 2 | `statistics/` |
| Training identity against the unchanged 5.8 binary (prespecified) | 56 of 56 states byte-identical | 1 | `convergence/identity/` |
| Training identity, trainer options, thread counts, hand groups, table limits (`identity57.py` against 5.8) | 225 cases, 0 failures, 1782 training runs | 1 | `identity/` |
| Mutation check of the 5.9 self-test | 15 mutants, 15 detected; control clean: True | 2 | `mutation59.json` |
| Desktop host, refused studies (`host_refusal59.js`), Linux | 9 of 9 checks passed | 2 | `host-refusal59.json` |
| Desktop interface in a browser (Chromium, Playwright) | 20 of 20 checks passed | 2 | `ui/` |
| Stability (pause/resume cycles, long training, cancellation; 3 minutes) | passed: True; 12 checks, 0 not passed | 2 | `stability/` |
| AddressSanitizer + UndefinedBehaviorSanitizer: self-tests 5.9 and 5.8, 5.9 response / stream / host tests | self-test 5.9: 32 passed, 0 failed, 0 untested; self-test 5.8: 33 passed, 0 failed, 0 untested; tests: 12 tests: 12 passed, 0 failed, 0 skipped; sanitizer reports (ERROR: AddressSanitizer / runtime error) in all outputs: 0 | 2 | `sanitizers/` |
| ThreadSanitizer: parallel seats, evaluation threads, frozen batches, both stream kinds | ThreadSanitizer warnings: 0; response bits of the instrumented program equal the release program: 5.9 streams True 5.8 streams True (6 seats) | 2 | `sanitizers/tsan.log` |
| LeakSanitizer: complete response, unfinished evaluation, refused study | leak check: --response with parallel seats exit 0 (0 expected), evaluation that cannot finish exit 0 (0 expected), refused over-limit study exit 1 (1 expected); LeakSanitizer reports: 0 | 2 | `sanitizers/leak-*.log` |
| Windows executables under Wine: self-test 5.9 | 32 passed, 0 failed, 0 untested | 2 | `wine/selftest59-wine.json` |
| Windows executables under Wine: self-test 5.8 | 33 passed, 0 failed, 0 untested | 2 | `wine/selftest58-wine.json` |
| Windows executables under Wine: self-test 5.7.1 | 24 passed, 0 failed, 0 untested | 2 | `wine/selftest571-wine.json` |
| Windows executables under Wine: self-test 5.7 | 28 passed, 0 failed, 0 untested | 2 | `wine/selftest57-wine.json` |
| Windows executables under Wine: reference responses (5.9 and 5.8 streams) | 14 cases, all identical: True | 2 | `wine/reference-responses-wine.json` |
| Windows executables under Wine: independent implementation against `mwcli.exe` | exit 0 | 2 | `wine/independent-stats-wine.json` |
| Windows executables under Wine: desktop host, refused studies | 9 of 9 checks passed | 2 | `wine/host-refusal-wine.json` |
| Windows executables under Wine: 5.9 regression file | 16 tests: 16 passed, 0 failed, 0 skipped | 2 | `wine/v59.test.tap` |
| Windows executables under Wine: 5.8 regression file | 15 tests: 15 passed, 0 failed, 0 skipped | 2 | `wine/v58.test.tap` |
| PowerShell parser on every `.ps1` of the release | test_devices.ps1: 0 parse errors, 901 tokens; test_large_checkpoint.ps1: 0 parse errors, 517 tokens; test_windows.ps1: 0 parse errors, 11554 tokens; validate_hardware.ps1: 0 parse errors, 9180 tokens; validate_windows56.ps1: 0 parse errors, 4945 tokens; validate_windows57.ps1: 0 parse errors, 8671 tokens; validate_windows571.ps1: 0 parse errors, 9591 tokens; validate_windows58.ps1: 0 parse errors, 10900 tokens; validate_windows59.ps1: 0 parse errors, 13516 tokens | 2 | `powershell/parser.txt` |
| `validate_windows59.ps1 -Focused`, PowerShell 7.4.6, Linux programs | 94 passed, 0 failed, 1 skipped, 0 untested (2 information rows); script ran to its end: True | 2 (the script's logic; not Windows) | `powershell/Windows-focused-validation-5.9.json` |
| `validate_windows59.ps1` (all sections), same | 187 passed, 0 failed, 2 skipped, 0 untested (24 information rows); script ran to its end: True | 2 (the script's logic; not Windows) | `powershell/Windows-validation-5.9.json` |
| Native Windows: the executables, the launchers, Windows PowerShell 5.1 | **NOT EXECUTED** | 3 | `WINDOWS-TESTS-5.9.md` |
| GitHub Actions Windows workflow | **NOT EXECUTED** (updated and statically checked only) | 3 | `.github/workflows/windows.yml` |
| NVIDIA CUDA: every GPU path | **NOT EXECUTED** (no CUDA code changed) | 3 | `WINDOWS-TESTS-5.9.md` |

## 2. Baseline (before any change)

`baseline/baseline-5.8.json`: archive SHA-256 as expected, CRC of 4,922 members, 4,921 manifest entries, executable
hashes, embedded build identifiers; the unmodified source rebuilt to byte-identical Windows executables, Linux
programs and interface; regression 621 / 620 / 0 / 1 (the totals 5.8 reported); self-tests 33 / 24 / 28.

## 3. The regression suite

`node --test --test-concurrency=3 --test-reporter=tap source/tests/*.test.js` with the Linux programs of the final
build: **637 tests: 636 passed, 0 failed, 1 skipped**. 621 tests are those of 5.8; 16 are new (`tests/v59.test.js`).

**Tests not passed in the full run:**

* skipped: 4.9 a checkpoint save into a read-only folder fails with exit 4 and leaves the input untouched (POSIX permissions)

The one skipped test is the one 5.8 skipped: it needs file permissions to be enforced, and the suite runs as root.

**An earlier run of the same build, kept.** The suite was first run while the sanitizer builds were compiling on the
same four processors: 637 tests, 635 passed, **1 failed**, 1 skipped
(`tests/full-regression-beside-the-sanitizer-build.tap`). The failed test - "5.1 crossover inside one job: the
profitable route changes with the batch size ..." - decides a processing route from measured timings and is one of the
four tests the project lists as load-sensitive since 5.6 (`source/tests/load_sensitive.json`: "a route decision that
depends on measured timings chose the CPU for every batch; passed alone"). Following the project's procedure the
suite was run again alone on the idle machine; that run is the one reported above. Both outcomes are in the archive.

**Tests of earlier releases that were edited** (`tests/v58.test.js`, four assertions; nothing removed or weakened):

| Test | Change | Why |
|---|---|---|
| "5.8 response: the result says what was measured ..." | `tool` is `mwcli response 5.9`; `sampled.calculation` is `response-5.9-paired-v2` | the tool names its release; the default evaluation streams changed and the calculation identifier says so |
| "5.8 reference responses: this build reproduces the recorded bits" | the request gets `"randomStreams": "5.8"` | the recorded bits are those of the 5.8 streams, which 5.9 draws on request. The test still requires every recorded bit. |
| "5.8 Windows validation: the script plans and imports every 5.8 check ..." | the script's `$Release` is compared with `'5.8'` instead of the current version; the workflow assertions that named the 5.8 script moved to the 5.9 test | `validate_windows58.ps1` is kept as shipped with 5.8; the workflow now runs the 5.9 script |

**New tests** (`tests/v59.test.js`): the self-test (all checks; sections; nothing passes without fixtures); the
independent Python implementation (generator, stream addresses, exact coverage, every bound of three results);
`--streams59`; the 5.9 result fields, levels, units and the deprecated field; `confidence` and `analyses`; malformed
requests; independence of threads, parallel seats and every evaluation walk, and the evaluation seed; the 5.8
streams; an evaluation that cannot complete; frozen batches, ICM and hand groups against exact values; 39 independent
evaluations against exact values; the desktop host (nine checks) and its undo rules in the source; the 5.9 reference
responses; the Windows validation script, launchers and workflow, with the PowerShell parser when one is installed.

## 4. Self-tests of the Linux build

| Self-test | Result |
|---|---|
| `--selftest59` (32 checks: engine 3, statistics 6, response 23) | 32 passed, 0 failed, 0 untested |
| `--selftest58` (33 checks) | 33 passed, 0 failed, 0 untested |
| `--selftest571` (24 checks: checkpoint integrity, previous-generation recovery, process-memory budget) | 24 passed, 0 failed, 0 untested |
| `--selftest57` (28 checks) | 28 passed, 0 failed, 0 untested |

The 5.7.1 checkpoint-commit repair is untouched: `source/native/study_checkpoint55.hpp` has the SHA-256 it had in
5.7.1 and 5.8 (`28ba6e7c47b71005...`).

The remaining steps of `run_final59.sh` (exit codes as recorded):

    build EightMaxBuild=00600c81455ead44 2026-11-24T19:24:16Z
    selftest59 (Linux) exit 0
    selftest58 (Linux) exit 0
    selftest571 (Linux) exit 0
    selftest57 (Linux) exit 0
    independent selfcheck exit 0
    exact two-point coverage table exit 0
    desktop host, refused studies exit 0
    5.8 host refusal driver against the 5.9 host exit 0
    interface in a browser exit 0
    stability (3 minutes) exit 0
    identity against 5.8 exit 0
    flop3-kings-detailed batch64-2MiB identical
    flop3-kings-detailed batch8-1MiB identical
    {"cases": 225, "failures": 0, "trainingRuns": 1782, "seconds": 1125.7, "baselineSha256": "ef39d1fa24052e6e9fc36321760dcad99b92e5e783c8e5cc0ae49fdbd18d95e5", "currentSha256": "782c349362602c6dcc5bad6aa27bc4b2f720c0ac4333e1d546be9a1087b4822c", "deals": 24000}
    == done 19:55:02

### 4.1 Does the self-test notice a broken engine? (`mutation59.py`)

15 mutants (one 5.9 behaviour broken each), 15 detected; control clean: True; seconds: 1792.8.

| Mutant | What is broken | Checks expected to notice | Checks not passed | Outcome |
|---|---|---|---|---|
| control | the unmodified engine | (none: every check must pass) | - | clean |
| log-of-one-over-delta | the seat bound uses ln(1/delta) instead of ln(2/delta) (a bound that is too narrow) | S1 | S1, S4, S5 | detected |
| no-range-term | the seat bound drops the term that protects against unseen rare values | S1, S2 | S1, S2, S4, S5 | detected |
| no-family-division | every seat gets the whole error budget alpha instead of alpha / seats (not simultaneous) | S4 | S4 | detected |
| no-floor | the NashConv bound adds negative seat bounds instead of flooring them at 0 | S4, S6 | S4, S6 | detected |
| unavailable-seat-ignored | a seat without evaluation no longer withholds the sum of response gains | S4 | S4 | detected |
| range-violation-ignored | a sample outside the proven range no longer withdraws the simultaneous statement | S4 | S4 | detected |
| pooled-one-subset-budget | the pooled bound spends its Bernstein budget as if there were one subset (not simultaneous over subsets) | S5 | S5 | detected |
| pooled-sample-variance | the pooled bound uses the sample variance where the proof needs an upper bound of the true variance | S5 | S5 | detected |
| philox-multiplier | one multiplier of the generator is wrong by one bit | E1 | E1, E2 | detected |
| philox-nine-rounds | the generator runs nine rounds instead of ten | E1, E2 | E1, E2 | detected |
| stream-ignores-seat | the stream address ignores the seat (two seats would be evaluated on the same numbers) | E3 | E3 | detected |
| index-off-by-one-slot | the offset index returns the values of the next hash slot | R6, R1 | R1, R4, R5, R6 | detected |
| response-profile-swapped | the lean walk reads the response strategy from the wrong half of the row at the responding seat | R6, R1 | R4, R5, R6 | detected |
| seat-alpha-not-divided | the command line gives every seat alpha / analyses instead of alpha / analyses / seats | R2 | R2, family | detected |
| legacy-field-changed | the deprecated 5.8 field silently changes its meaning (it would add the distribution-free bounds) | R2 | R2 | detected |

## 5. Sanitizers (`sanitize59.sh`; `sanitizers/summary.txt`)

    asan build exit 0
    asan selftest59 exit 0
    asan selftest58 exit 0
    asan tests (5.9 file: response, streams, statistics, desktop host, references) exit 0
    tsan build exit 0
    # tests 12 # pass 12 # fail 0 # skipped 0 (v59-asan-ubsan)
    sanitizer reports (ERROR: AddressSanitizer / runtime error) in all outputs: 0
    ThreadSanitizer warnings: 0
    frozen-batch training on four threads exit 0
    six seats, three side by side, four threads each (5.9 streams, offset index) exit 0
    the 5.8 streams, sampled opponent actions, four threads exit 0
    ICM frozen-batch training exit 0
    ICM response, four seats side by side exit 0
    selftest59 (engine) exit 0
    selftest59 (statistics) exit 0
    response bits of the instrumented program equal the release program: 5.9 streams True 5.8 streams True (6 seats)
    leak check: --response with parallel seats exit 0 (0 expected), evaluation that cannot finish exit 0 (0 expected), refused over-limit study exit 1 (1 expected); LeakSanitizer reports: 0

AddressSanitizer and UndefinedBehaviorSanitizer (with float-cast-overflow) ran the 5.9 and 5.8 self-tests, the
response, stream, statistics, desktop-host and reference tests of the 5.9 file, and the nine host checks against the
instrumented host with its standard error kept. ThreadSanitizer ran responses with seats side by side and several
evaluation threads sharing the offset index, frozen-batch response training, an ICM game and both stream kinds, and
the instrumented program's response bits were compared with the release program's. LeakSanitizer ran a complete
response analysis, an evaluation that cannot finish, and a refused study.

## 6. The Windows executables under Wine (`wine59.sh`; it looks like wine32 is missing, you should install it.
multiarch needs to be enabled first.  as root, please
execute "dpkg --add-architecture i386 && apt-get update &&
apt-get install wine32:i386"
wine-9.0 (Ubuntu 9.0~repack-4build3))

Build identifier printed by `mwcli.exe`: `EightMaxBuild=00600c81455ead44`.

| | Result |
|---|---|
| `mwcli.exe --selftest59` | 32 passed, 0 failed, 0 untested |
| `mwcli.exe --selftest58` | 33 passed, 0 failed, 0 untested |
| `mwcli.exe --selftest571` | 24 passed, 0 failed, 0 untested |
| `mwcli.exe --selftest57` | 28 passed, 0 failed, 0 untested |
| reference responses: 7 of 5.9 (5.9 streams, with summary bounds) and 7 of 5.8 (5.8 streams) | all identical: True (14 cases) |
| independent Python implementation against the streams of `mwcli.exe` | exit 0 |
| `EightMax.exe`: refused studies (nine checks) | 9 of 9 passed |
| `tests/v59.test.js` with the Windows programs | 16 tests: 16 passed, 0 failed, 0 skipped |
| `tests/v58.test.js` with the Windows programs | 15 tests: 15 passed, 0 failed, 0 skipped |

**Two earlier runs of the 5.8 file under Wine, kept** (`wine/v58.test-beside-four-other-jobs.tap`,
`wine/v58.test-rerun-alone-with-a-used-save-folder.tap`): 14 of 15 passed; the test "5.8 desktop host: after an
answered checkpoint request the next one is accepted at once" expected the first checkpoint generation and found the
seventh. Cause: Wine sets `USERPROFILE` itself, so every host started by these tests shares the save folder of the
Wine prefix, and that folder still held the autosaves of host tests that had run before; the test asks for a fresh
save folder, which it gets on Linux and on Windows. `wine59.sh` now empties the prefix's save folder before each test
file; with that the file passes (15 tests: 15 passed, 0 failed, 0 skipped). This is a property of the test environment under Wine,
found and recorded here; the program was not changed.

**The desktop host's refused-study checks under Wine** operate on the real study folder inside the Wine prefix
(`C:\users\root\Documents\EightMax\studies`), which the driver
accepts only when it is named explicitly and empty (`EM_TEST_HOST_STUDIES_ROOT`).

**The 5.7.1 self-test under Wine** passed completely in this run (24 passed, 0 failed, 0 untested). 5.8 recorded 21 of 24 under Wine (its three process-memory checks need the working set that the operating system reports; Wine's report depends on the Wine build and the load), so a later Wine run that shows those three as not passed would be a property of Wine, not a change of the program.

## 7. The validation script under PowerShell (`powershell59.sh`)

7.4.6 on Ubuntu 24.04.5 LTS. Every `.ps1` of the release through `[System.Management.Automation.Language.Parser]::ParseFile`:

    test_devices.ps1: 0 parse errors, 901 tokens
    test_large_checkpoint.ps1: 0 parse errors, 517 tokens
    test_windows.ps1: 0 parse errors, 11554 tokens
    validate_hardware.ps1: 0 parse errors, 9180 tokens
    validate_windows56.ps1: 0 parse errors, 4945 tokens
    validate_windows57.ps1: 0 parse errors, 8671 tokens
    validate_windows571.ps1: 0 parse errors, 9591 tokens
    validate_windows58.ps1: 0 parse errors, 10900 tokens
    validate_windows59.ps1: 0 parse errors, 13516 tokens

`validate_windows59.ps1` executed on a copy of the release tree in which the three `.exe` names are the Linux
programs:

| Mode | Result |
|---|---|
| `-Focused -SkipIntegrity` | 94 passed, 0 failed, 1 skipped, 0 untested (2 information rows); script ran to its end: True |
| all sections, `-SkipIntegrity` | 187 passed, 0 failed, 2 skipped, 0 untested (24 information rows); script ran to its end: True |

**Focused run - checks not passed:**

* skipped (skipped, class gate): integrity / SHA256SUMS.txt - -SkipIntegrity was given

**Full run - checks not passed:**

* skipped (skipped, class gate): integrity / SHA256SUMS.txt - -SkipIntegrity was given
* skipped (skipped, class hardware): GPU / CUDA validation - no usable NVIDIA CUDA device answered on this PC (NVIDIA driver library not found): nothing about the GPU was tested

What this shows: the script parses, its plan and its sections execute, its comparisons and its report work, and its
verdicts are right for a build that is known to be right. What it does not show: anything about Windows PowerShell
5.1, about the Windows-only parts (the machine description by CIM, hidden process windows, the GPU section), or about
the Windows executables on Windows. `-SkipIntegrity` was necessary because the copy's executables are not the
shipped ones.

## 8. Desktop host, interface, stability

* `host-refusal59.json`: 9 of 9 checks (FINAL-REPORT-5.9.md, section 7, lists them).
* `host-refusal58-with-the-5.9-host.json`: the 5.8 driver of the same situation against the 5.9 host (its record of
  the leftover folder is now empty).
* `ui/`: the study interface in Chromium (the run's screenshots are not in the archive, to keep it below the
  repository's 100 MiB file limit; `ui/README.txt`): 20 of 20 checks.
* `stability/`: passed: True.

## 9. Experiments

| Experiment | Plan written first | Result | Report |
|---|---|---|---|
| the 5.8 normal-interval failure and the new statements on the same runs (`statistics/final8`) | yes | 360 runs; 193 of 960 reproduced; 0 violations | MATHEMATICAL-VALIDATION-5.9.md, 4.1 |
| coverage on 15 reference games (`statistics/games`) | yes | 3,000 runs; 0 violations | 4.2 |
| training identity against 5.8 (`convergence/identity`) | yes | 56 of 56 | CONVERGENCE-5.9.md, 2 |
| optional trainers against the default (`convergence/options`) | yes | 448 runs; none promoted | 3 |
| six-player flop fixture (`convergence/flop6`) | yes | 6 runs; lower bounds only | 4 |
| performance against 5.8 (`performance/`) | yes | PERFORMANCE-5.9.md | |
| prefetch in the trainer's lookup (`experiments/prefetch-row-slot`) | yes | not adopted | FINAL-REPORT-5.9.md, 4 |

The statistics and convergence experiments ran with development builds of 24 November whose engine source is the
release's except for later changes that do not alter a number (the look-ahead rule, a renamed helper, comments);
their `plan.json` records the SHA-256 of the binary used. That the release build computes the same numbers is
asserted by the reference responses (recorded by the release build, unchanged in every bit from the development
build's), by the self-test's bits recorded from 5.8, and by the bit-identity tests of the regression suite.

## 10. Not executed, unavailable, or not passed - in one place

| Item | Status |
|---|---|
| the Windows executables on Windows 11 | not executed (class 3) |
| Windows PowerShell 5.1 running `validate_windows59.ps1`; the launchers under `cmd.exe` | not executed (class 3). The launchers were checked statically (ASCII, CRLF, the report rules) by the regression suite. |
| the GitHub Actions Windows workflow | not executed (class 3) |
| CUDA: Automatic, Hybrid, GPU-Preferred, CPU/GPU agreement, device errors, `gpustress.exe` on a GPU | not executed (class 3); no CUDA code changed |
| performance and thread scaling on the target PC | not measured (class 3) |
| one regression test (read-only folder) | skipped: needs enforced file permissions (runs as root) |
| hardware performance counters | unavailable in the development container; cachegrind used instead |
| long runs (hours), tables above 250 MiB | not run |
