#!/usr/bin/env python3
"""Fills VALIDATION-5.9.md, BUILD-5.9.md and FINAL-REPORT-5.9.md from validation/5.9/validation-summary.json and the
evidence files, and puts the build identifier into the other 5.9 documents. Usage: gen_reports.py <release root> <template dir>"""
import sys, json, pathlib, hashlib, re, subprocess
root = pathlib.Path(sys.argv[1]).resolve(); tdir = pathlib.Path(sys.argv[2]).resolve(); V = root / 'validation/5.9'
S = json.loads((V / 'validation-summary.json').read_text()); build = S['build']
sha = lambda p: hashlib.sha256((root / p).read_bytes()).hexdigest(); size = lambda p: (root / p).stat().st_size
def J(p):
    try: return json.loads((V / p).read_text())
    except Exception: return None
reg = S['regressionLinux']; st = {k: S['selftest%sLinux' % k] for k in ('59', '58', '571', '57')}
san = S['sanitizers']; wine = S['wine']; ps = S['powershell']; host = S['desktopHostRefusedStudies']; ui = S['ui']; stab = S['stability']; ident = S.get('identityAgainst58') or {}
mut = J('mutation59.json') or {}
def stline(d, total=None):
    if 'missing' in d: return 'NOT RUN (%s)' % d['missing']
    return '%s passed, %s failed, %s untested' % (d['passed'], d['failed'], d['untested'] if d['untested'] is not None else 0) + ('' if not d.get('notPassed') else '; not passed: ' + ', '.join(str(x) for x in d['notPassed'][:8]))
def tapline(d):
    if 'missing' in d: return 'NOT RUN'
    return '%s tests: %s passed, %s failed, %s skipped' % (d['tests'], d['passed'], d['failed'], d['skipped'])
def psline(d):
    if 'missing' in d: return 'NOT RUN'
    return '%d passed, %d failed, %d skipped, %d untested (%d information rows); script ran to its end: %s' % (d['passed'], d['failed'], d['skipped'], d['untested'], d['info'], d['scriptCompleted'])
sanitizer_reports = next((l for l in san['summary'] if l.startswith('sanitizer reports')), 'missing'); tsan_w = next((l for l in san['summary'] if l.startswith('ThreadSanitizer warnings')), 'missing'); leak = next((l for l in san['summary'] if l.startswith('leak check')), 'missing'); tsan_bits = next((l for l in san['summary'] if l.startswith('response bits of the instrumented')), 'missing')
wine_tests = wine['tests']
idline = ('%s cases, %s failures, %s training runs' % (ident.get('cases'), ident.get('failures'), ident.get('trainingRuns'))) if ident else 'NOT RUN'
rows = [
 ('Baseline: the 5.8 archive, manifest, executables, byte-identical rebuild', 'all verified', '1', 'validation/5.9/baseline/'),
 ('Baseline: regression suite of the rebuilt 5.8', '621 tests: 620 passed, 0 failed, 1 skipped', '2', 'baseline/regression-of-rebuilt-5.8.tap.gz'),
 ('Regression suite of the final 5.9 build (Linux)', tapline(reg), '2', 'tests/full-regression.tap'),
 ('Self-test 5.9 (`mwcli --selftest59`), Linux', stline(st['59']), '2 (its exact and independent references: 1)', 'selftest/selftest59-linux.json'),
 ('Self-test 5.8, Linux', stline(st['58']), '2', 'selftest/selftest58-linux.json'),
 ('Self-test 5.7.1 (checkpoints, memory budget), Linux', stline(st['571']), '2', 'selftest/selftest571-linux.json'),
 ('Self-test 5.7, Linux', stline(st['57']), '2', 'selftest/selftest57-linux.json'),
 ('Independent Python implementation (generator, streams, bounds, exact coverage)', ('%d checks, %d not passed' % (len(S['independentImplementation']['checks']), sum(1 for c in S['independentImplementation']['checks'] if c['passed'] is False))) if S.get('independentImplementation') else 'NOT RUN', '1', 'independent/'),
 ('Statistics against exact values (prespecified)', '3,360 runs, 0 failed runs; 0 distribution-free statements violated', '1 / 2', 'statistics/'),
 ('Training identity against the unchanged 5.8 binary (prespecified)', '56 of 56 states byte-identical', '1', 'convergence/identity/'),
 ('Training identity, trainer options, thread counts, hand groups, table limits (`identity57.py` against 5.8)', idline, '1', 'identity/'),
 ('Mutation check of the 5.9 self-test', ('%s mutants, %s detected; control clean: %s%s' % (mut.get('mutants'), mut.get('detected'), mut.get('controlClean'), ('; NOT detected: ' + ', '.join(mut['notDetected'])) if mut.get('notDetected') else '')) if mut else 'NOT RUN', '2', 'mutation59.json'),
 ('Desktop host, refused studies (`host_refusal59.js`), Linux', ('%s of %s checks passed' % (host.get('checksPassed'), host.get('checksTotal'))) if 'missing' not in host else 'NOT RUN', '2', 'host-refusal59.json'),
 ('Desktop interface in a browser (Chromium, Playwright)', ('%s of %s checks passed' % (ui.get('checksPassed'), ui.get('checksTotal'))) if 'missing' not in ui else 'NOT RUN', '2', 'ui/'),
 ('Stability (pause/resume cycles, long training, cancellation; 3 minutes)', ('passed: %s; %d checks, %d not passed' % (stab.get('passed'), len(stab.get('checks', [])), sum(1 for c in stab.get('checks', []) if not c['passed']))) if 'missing' not in stab else 'NOT RUN', '2', 'stability/'),
 ('AddressSanitizer + UndefinedBehaviorSanitizer: self-tests 5.9 and 5.8, 5.9 response / stream / host tests', 'self-test 5.9: %s; self-test 5.8: %s; tests: %s; %s' % (stline(san['selftest59']), stline(san['selftest58']), tapline(san['v59']), sanitizer_reports), '2', 'sanitizers/'),
 ('ThreadSanitizer: parallel seats, evaluation threads, frozen batches, both stream kinds', tsan_w + '; ' + tsan_bits, '2', 'sanitizers/tsan.log'),
 ('LeakSanitizer: complete response, unfinished evaluation, refused study', leak, '2', 'sanitizers/leak-*.log'),
 ('Windows executables under Wine: self-test 5.9', stline(wine['selftest59']), '2', 'wine/selftest59-wine.json'),
 ('Windows executables under Wine: self-test 5.8', stline(wine['selftest58']), '2', 'wine/selftest58-wine.json'),
 ('Windows executables under Wine: self-test 5.7.1', stline(wine['selftest571']), '2', 'wine/selftest571-wine.json'),
 ('Windows executables under Wine: self-test 5.7', stline(wine['selftest57']), '2', 'wine/selftest57-wine.json'),
 ('Windows executables under Wine: reference responses (5.9 and 5.8 streams)', ('%s cases, all identical: %s' % (wine['referenceResponses'].get('cases'), wine['referenceResponses'].get('allIdentical'))) if 'missing' not in wine['referenceResponses'] else 'NOT RUN', '2', 'wine/reference-responses-wine.json'),
 ('Windows executables under Wine: independent implementation against `mwcli.exe`', 'exit %s' % wine['independentImplementationExit'], '2', 'wine/independent-stats-wine.json'),
 ('Windows executables under Wine: desktop host, refused studies', ('%s of %s checks passed%s' % (wine['hostRefusal'].get('checksPassed'), wine['hostRefusal'].get('checksTotal'), ('; not passed: ' + '; '.join(wine['hostRefusal']['notPassed'])) if wine['hostRefusal'].get('notPassed') else '')) if 'missing' not in wine['hostRefusal'] else 'NOT RUN', '2', 'wine/host-refusal-wine.json'),
 ('Windows executables under Wine: 5.9 regression file', tapline(wine_tests['v59']), '2', 'wine/v59.test.tap'),
 ('Windows executables under Wine: 5.8 regression file', tapline(wine_tests['v58']), '2', 'wine/v58.test.tap'),
 ('PowerShell parser on every `.ps1` of the release', '; '.join(ps['parser']) if isinstance(ps['parser'], list) else 'NOT RUN', '2', 'powershell/parser.txt'),
 ('`validate_windows59.ps1 -Focused`, PowerShell %s, Linux programs' % ps['version'].split(' on ')[0], psline(ps['focused']), '2 (the script\'s logic; not Windows)', 'powershell/Windows-focused-validation-5.9.json'),
 ('`validate_windows59.ps1` (all sections), same', psline(ps['full']), '2 (the script\'s logic; not Windows)', 'powershell/Windows-validation-5.9.json'),
 ('Native Windows: the executables, the launchers, Windows PowerShell 5.1', '**NOT EXECUTED**', '3', 'WINDOWS-TESTS-5.9.md'),
 ('GitHub Actions Windows workflow', '**NOT EXECUTED** (updated and statically checked only)', '3', '.github/workflows/windows.yml'),
 ('NVIDIA CUDA: every GPU path', '**NOT EXECUTED** (no CUDA code changed)', '3', 'WINDOWS-TESTS-5.9.md'),
]
table = '| Test | Result | Class | Evidence (under `validation/5.9/` unless a full path is given) |\n|---|---|---|---|\n' + '\n'.join('| %s | %s | %s | `%s` |' % r for r in rows)
def not_passed_block(title, d):
    if 'missing' in d or not d.get('notPassed'): return ''
    return '\n**%s - checks not passed:**\n\n' % title + '\n'.join('* %s (%s, class %s): %s / %s - %s' % (x['status'], x['status'], x['class'], x['section'], x['name'], x['detail'].replace('\n', ' ')[:260]) for x in d['notPassed']) + '\n'
def failed_tests(title, d):
    if 'missing' in d or not (d.get('failedTests') or d.get('skippedTests')): return ''
    return '\n**%s:**\n\n' % title + ''.join('* FAILED: %s\n' % t for t in d['failedTests']) + ''.join('* skipped: %s\n' % t for t in d['skippedTests'])
steps = '\n'.join('    ' + l for l in S.get('runFinalSteps', []))
mutrows = '\n'.join('| %s | %s | %s | %s | %s |' % (r['mutant'], r['what'], ', '.join(r['expectedToFail']) or '(none: every check must pass)', ', '.join(r.get('kindsNotPassed', [])) or '-', 'clean' if r['mutant'] == 'control' and r['detected'] else 'detected' if r['detected'] else 'did not compile' if r['detected'] is None else '**NOT DETECTED**') for r in mut.get('rows', []))
w571 = wine['selftest571']
wine571_row = '' if 'missing' not in w571 and not w571.get('notPassed') and not w571.get('failed') else '| the 5.7.1 process-memory checks under Wine | not passed under Wine (a Wine property; passed on Linux) |\n'
wine571_note = ('**The 5.7.1 self-test under Wine** passed completely in this run (%s). 5.8 recorded 21 of 24 under Wine (its three process-memory checks need the working set that the operating system reports; Wine\'s report depends on the Wine build and the load), so a later Wine run that shows those three as not passed would be a property of Wine, not a change of the program.' % stline(w571)) if 'missing' not in w571 and not w571.get('notPassed') and not w571.get('failed') else ('**The 5.7.1 self-test under Wine: %s.** Its process-memory checks need the operating system to report a working set that grows with the tables; Wine does not do so reliably (5.8 recorded 21 of 24 under Wine). They pass on Linux (section 4) and passed on the physical Windows run of 5.7.1. Recorded as not passed, not hidden.' % stline(w571))
val = f'''# EightMax 5.9: validation

Build `{build}`. Every test that was run, with failed, skipped and unavailable checks; and every test that was NOT
run. Evidence files are under `validation/5.9/` inside the archive. `validation/5.9/validation-summary.json` is this
document as data (built by `summarize59.py` from the evidence files only) and is embedded in
`EightMax-Windows-5.9.identity.json`.

**Read this first.** No 5.9 program was executed on Windows hardware or on an NVIDIA GPU. "Wine" below means the
shipped Windows executables running under Wine 9.0 on Linux; "PowerShell" means PowerShell 7.4 on Linux running the
validation script against the Linux programs. Neither is a Windows PC.

## 1. Every test in one table

{table}

## 2. Baseline (before any change)

`baseline/baseline-5.8.json`: archive SHA-256 as expected, CRC of 4,922 members, 4,921 manifest entries, executable
hashes, embedded build identifiers; the unmodified source rebuilt to byte-identical Windows executables, Linux
programs and interface; regression 621 / 620 / 0 / 1 (the totals 5.8 reported); self-tests 33 / 24 / 28.

## 3. The regression suite

`node --test --test-concurrency=3 --test-reporter=tap source/tests/*.test.js` with the Linux programs of the final
build: **{tapline(reg)}**. 621 tests are those of 5.8; 16 are new (`tests/v59.test.js`).
{failed_tests('Tests not passed in the full run', reg)}
The one skipped test is the one 5.8 skipped: it needs file permissions to be enforced, and the suite runs as root.

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
| `--selftest59` (32 checks: engine 3, statistics 6, response 23) | {stline(st['59'])} |
| `--selftest58` (33 checks) | {stline(st['58'])} |
| `--selftest571` (24 checks: checkpoint integrity, previous-generation recovery, process-memory budget) | {stline(st['571'])} |
| `--selftest57` (28 checks) | {stline(st['57'])} |

The 5.7.1 checkpoint-commit repair is untouched: `source/native/study_checkpoint55.hpp` has the SHA-256 it had in
5.7.1 and 5.8 (`{sha('source/native/study_checkpoint55.hpp')[:16]}...`).

The remaining steps of `run_final59.sh` (exit codes as recorded):

{steps}

### 4.1 Does the self-test notice a broken engine? (`mutation59.py`)

{('%d mutants (one 5.9 behaviour broken each), %d detected; control clean: %s; seconds: %s.' % (mut['mutants'], mut['detected'], mut['controlClean'], mut['seconds'])) if mut else 'NOT RUN.'}

| Mutant | What is broken | Checks expected to notice | Checks not passed | Outcome |
|---|---|---|---|---|
{mutrows}

## 5. Sanitizers (`sanitize59.sh`; `sanitizers/summary.txt`)

    {chr(10).join('    ' + l for l in san['summary']).strip()}

AddressSanitizer and UndefinedBehaviorSanitizer (with float-cast-overflow) ran the 5.9 and 5.8 self-tests, the
response, stream, statistics, desktop-host and reference tests of the 5.9 file, and the nine host checks against the
instrumented host with its standard error kept. ThreadSanitizer ran responses with seats side by side and several
evaluation threads sharing the offset index, frozen-batch response training, an ICM game and both stream kinds, and
the instrumented program's response bits were compared with the release program's. LeakSanitizer ran a complete
response analysis, an evaluation that cannot finish, and a refused study.

## 6. The Windows executables under Wine (`wine59.sh`; {wine['wineVersion']})

Build identifier printed by `mwcli.exe`: `{wine['buildId']}`.

| | Result |
|---|---|
| `mwcli.exe --selftest59` | {stline(wine['selftest59'])} |
| `mwcli.exe --selftest58` | {stline(wine['selftest58'])} |
| `mwcli.exe --selftest571` | {stline(wine['selftest571'])} |
| `mwcli.exe --selftest57` | {stline(wine['selftest57'])} |
| reference responses: 7 of 5.9 (5.9 streams, with summary bounds) and 7 of 5.8 (5.8 streams) | {('all identical: %s (%s cases)' % (wine['referenceResponses'].get('allIdentical'), wine['referenceResponses'].get('cases'))) if 'missing' not in wine['referenceResponses'] else 'NOT RUN'} |
| independent Python implementation against the streams of `mwcli.exe` | exit {wine['independentImplementationExit']} |
| `EightMax.exe`: refused studies (nine checks) | {('%s of %s passed' % (wine['hostRefusal'].get('checksPassed'), wine['hostRefusal'].get('checksTotal'))) if 'missing' not in wine['hostRefusal'] else 'NOT RUN'} |
| `tests/v59.test.js` with the Windows programs | {tapline(wine_tests['v59'])} |
| `tests/v58.test.js` with the Windows programs | {tapline(wine_tests['v58'])} |
{failed_tests('5.9 test file under Wine', wine_tests['v59'])}{failed_tests('5.8 test file under Wine', wine_tests['v58'])}
{wine571_note}

## 7. The validation script under PowerShell (`powershell59.sh`)

{ps['version']}. Every `.ps1` of the release through `[System.Management.Automation.Language.Parser]::ParseFile`:

    {chr(10).join('    ' + l for l in (ps['parser'] if isinstance(ps['parser'], list) else [str(ps['parser'])])).strip()}

`validate_windows59.ps1` executed on a copy of the release tree in which the three `.exe` names are the Linux
programs:

| Mode | Result |
|---|---|
| `-Focused -SkipIntegrity` | {psline(ps['focused'])} |
| all sections, `-SkipIntegrity` | {psline(ps['full'])} |
{not_passed_block('Focused run', ps['focused'])}{not_passed_block('Full run', ps['full'])}
What this shows: the script parses, its plan and its sections execute, its comparisons and its report work, and its
verdicts are right for a build that is known to be right. What it does not show: anything about Windows PowerShell
5.1, about the Windows-only parts (the machine description by CIM, hidden process windows, the GPU section), or about
the Windows executables on Windows. `-SkipIntegrity` was necessary because the copy's executables are not the
shipped ones.

## 8. Desktop host, interface, stability

* `host-refusal59.json`: {('%s of %s checks' % (host.get('checksPassed'), host.get('checksTotal'))) if 'missing' not in host else 'NOT RUN'} (FINAL-REPORT-5.9.md, section 7, lists them).
* `host-refusal58-with-the-5.9-host.json`: the 5.8 driver of the same situation against the 5.9 host (its record of
  the leftover folder is now empty).
* `ui/`: the study interface in Chromium: {('%s of %s checks' % (ui.get('checksPassed'), ui.get('checksTotal'))) if 'missing' not in ui else 'NOT RUN'}{('; not passed: ' + '; '.join(ui['notPassed'])) if ui.get('notPassed') else ''}.
* `stability/`: {('passed: %s' % stab.get('passed')) if 'missing' not in stab else 'NOT RUN'}{('; not passed: ' + '; '.join(c['name'] for c in stab.get('checks', []) if not c['passed'])) if 'missing' not in stab and not stab.get('passed') else ''}.

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
{wine571_row}| one regression test (read-only folder) | skipped: needs enforced file permissions (runs as root) |
| hardware performance counters | unavailable in the development container; cachegrind used instead |
| long runs (hours), tables above 250 MiB | not run |
'''
(root / 'VALIDATION-5.9.md').write_text(val)

# ---- BUILD-5.9.md ----
info = json.loads((root / 'BUILD-INFO.json').read_text())
arts = [('EightMax.exe', 'EightMax.exe'), ('mwcli.exe', 'mwcli.exe'), ('gpustress.exe', 'gpustress.exe'), ('EightMax-Offline.html', 'EightMax-Offline.html'), ('validation/5.9/linux-bin/mwcli', 'validation/5.9/linux-bin/mwcli'), ('validation/5.9/linux-bin/eightmax', 'validation/5.9/linux-bin/eightmax'), ('validation/5.9/linux-bin/gpustress', 'validation/5.9/linux-bin/gpustress')]
arttab = '\n'.join('| `%s` | %s | `%s` |' % (n, format(size(p), ','), sha(p)) for n, p in arts)
repro = J('baseline/reproducible-build-5.9.json')
bld = f'''# Building EightMax 5.9

Final source/build identifier: `{build}` (5.8 was `d4001e2c0cd77f41`).
Statistics identifiers: unchanged from 5.8 for studies (`study-5.5-bounded-eb-v1`, `study-5.6-replication-v1`,
`study-5.3-tfloor-bonferroni-v1`); for the trained response: `response-5.9-paired-v2` (the estimate with the 5.9
evaluation streams), `response-5.8-paired-v1` (with the 5.8 streams), `response-5.9-eb-one-sided-v1` (seat bound),
`response-5.9-simultaneous-union-v1`, `response-5.9-pooled-bernstein-subsets-v1`. Evaluation streams:
`philox4x64-10-counter-v1` (default), `splitmix64-hashed-block-seeds-5.8`.
Checkpoint formats: unchanged (study checkpoint version 1, tied to its build; solver states EMMW4 and EMZ1: a state
trained by 5.8 continues under 5.9 to the same bytes).

The complete source is included. The Windows programs are unsigned x64 PE executables with a statically linked
language runtime and zlib; they import only system DLLs (`KERNEL32.dll`, `msvcrt.dll`, `bcrypt.dll`, and for the
desktop host `SHELL32.dll`, `WINMM.dll`, `WS2_32.dll`).

## How the shipped executables were built

They were **cross-compiled on Linux** and were **not** built or run on Windows.

| Tool | Version used |
|---|---|
| Host | Ubuntu 24.04 container, x86-64, 4 logical processors, 15 GiB |
| Windows cross-compiler | x86_64-w64-mingw32-g++-posix (GCC) 13-posix (`g++-mingw-w64-x86-64-posix` 13.2.0-6ubuntu1+26.1, POSIX threads) |
| Windows zlib | `libz-mingw-w64-dev` 1.3.1 (static) |
| Linux compiler | gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0 |
| Node | v22.23.5 |
| Python | Python 3.13.18 (standard library only; numpy 2.5.3 was used for one optional cross-check of the generator) |
| Wine (tests only) | wine-9.0 (Ubuntu 9.0~repack-4build3) |
| PowerShell (tests only) | 7.4.6, installed as a .NET tool (`dotnet tool install --global PowerShell --version 7.4.6`, .NET SDK 8) |

This is the 5.8 toolchain: before any change, the unmodified 5.8 source was rebuilt with it and gave the three
shipped Windows executables, the three shipped Linux programs and the interface byte for byte
(`validation/5.9/baseline/baseline-5.8.json`). Every difference between the 5.8 and 5.9 programs therefore comes from
the source changes. Compiler flags are unchanged: `-O2 -march=x86-64 -ffp-contract=off` for the multiway engine
(strict IEEE arithmetic, no FMA contraction).

## Reproducing the build

Requirements: Node, Python 3, GCC/G++ with C++20, zlib; a Linux host also needs the OpenSSL development libraries.
For Windows binaries: MinGW-w64 with POSIX threads and its static zlib
(`apt-get install g++-mingw-w64-x86-64-posix libz-mingw-w64-dev`), or MSYS2 on Windows with `CC=gcc CXX=g++`. These
are developer requirements; the Windows application needs none of them at run time.

```sh
node source/tools/build.js build
sh source/native/build.sh linux "$PWD/build/native.html" "$PWD/build/linux"
CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix sh source/native/build.sh windows "$PWD/build/native.html" "$PWD/build/windows"
```

Then copy `build/windows/*.exe`, `build/EightMax-Offline.html` and `build/build-info.json` (as `BUILD-INFO.json`) to
the release root, and the Linux programs to `validation/5.9/linux-bin`.

```sh
node source/tools/verify_build.js .
```

must print `Verified the executables, interface and source: {build}`.

The fingerprint covers `source/VERSION`, `source/native`, `web`, `wasm`, `tools`, `tests`, `studies` and the CI
workflow ({len(info['files'])} files; 5.8: 384), so editing a test or a tool also changes it. Documents in the release root and
everything under `validation/` are outside it.

**Files added to the fingerprint in 5.9 (7):** `native/response59.hpp`, `native/response_stats59.hpp`,
`native/mwcli_selftest59.hpp`, `tools/independent_stats59.py`, `tools/host_refusal59.js`,
`tools/validate_windows59.ps1`, `tests/v59.test.js`. **Renamed:** `native/mwcli_response58.hpp` to
`native/mwcli_response59.hpp` (the `--response` command; rewritten summary). **Files changed:** `VERSION`,
`native/mw.h`, `native/mw.cpp` (one include line), `native/mwcli.cpp`, `native/response58.hpp` (the evaluation moved to
`response59.hpp`; the deal and walk helpers take any random stream), `native/study_jobs.h` (the desktop host's undo
of a refused study), `tests/v58.test.js` (four assertions: VALIDATION-5.9.md, section 3) and
`.github/workflows/windows.yml`.

**Reproducibility.** {('The final source tree was copied to another directory and built a second time with the same toolchain: ' + str(repro.get('summary'))) if repro else 'A second build of the final source tree in another directory was not recorded for 5.9.'}

## Artifact fingerprints

| File | Bytes | SHA-256 |
|---|---|---|
{arttab}

Build identifier embedded in all three executables and in `BUILD-INFO.json`: `{build}` (version 5.9).

`SHA256SUMS.txt` lists every file of the archive except itself. The archive's own SHA-256 cannot be inside the
archive; it is in `EightMax-Windows-5.9.identity.json`, delivered beside the ZIP.

## Tests, experiments and packaging

```sh
node --test --test-concurrency=3 --test-reporter=tap source/tests/*.test.js    # the regression suite (EM_TEST_MWCLI, EM_TEST_HOST: the Linux programs)
bash validation/5.9/run_final59.sh . <work dir>            # self-tests, independent implementation, desktop host, interface, stability, identity against 5.8
bash validation/5.9/sanitize59.sh . <work dir>             # AddressSanitizer, UndefinedBehaviorSanitizer, ThreadSanitizer, LeakSanitizer
bash validation/5.9/wine59.sh . <wrapper dir> <work dir>   # the Windows programs under Wine
bash validation/5.9/powershell59.sh . <pwsh> <work dir>    # the Windows validation script under PowerShell 7 on Linux
python3 validation/5.9/mutation59.py . <work dir>          # the self-test against engines with one behaviour broken
python3 validation/5.9/statistics/coverage59.py final8 . <5.8 mwcli> build/linux/mwcli <fresh dir>
python3 validation/5.9/statistics/coverage59.py games . build/linux/mwcli <fresh dir>
python3 validation/5.9/convergence/convergence59.py identity . <5.8 mwcli> build/linux/mwcli <fresh dir>
python3 validation/5.9/convergence/convergence59.py options . build/linux/mwcli <fresh dir>
python3 validation/5.9/convergence/convergence59.py flop6 . build/linux/mwcli <fresh dir>
python3 validation/5.9/performance/bench59.py . <5.8 mwcli> build/linux/mwcli <fresh dir>   # on an idle machine
python3 validation/5.9/make_golden59.py . build/linux/mwcli    # only to re-record the reference responses
python3 validation/5.9/summarize59.py .                    # validation/5.9/validation-summary.json from the evidence files
python3 validation/5.9/release59.py . <out dir> --wine     # ZIP, clean extraction, manifest, smoke tests of the Windows programs under Wine
```

The unchanged 5.8 Linux binary is `validation/5.8/linux-bin/mwcli` (a ZIP does not keep the executable bit:
`chmod +x` a copy). Each experiment runner writes its plan before measuring and refuses to reuse an output directory.

Wine note (unchanged): Wine 9.0 aborts at start-up when given the session's very large environment; it runs with a
minimal one (`env -i HOME=... PATH=... WINEPREFIX=... LC_ALL=C.UTF-8`).
'''
(root / 'BUILD-5.9.md').write_text(bld)

# ---- FINAL-REPORT-5.9.md from the template ----
P = S.get('performance') or {}; rs = P.get('response', [])
names = {'flop3-kings': 'three-player flop fixture', 'flop6-jack': 'six-player flop fixture', 'btn25-open': 'three-player preflop fixture', 'icm8-bb-call': 'eight-handed ICM fixture', 'turn4': 'four-player turn', 'flop5': 'five-player flop', 'final8': 'eight-handed ICM final table'}
sp = [r['evaluationSpeedup'] for r in rs]; wr = [r['wallReduction'] for r in rs]; met = [names[r['fixture']] for r in rs if r['wallReduction'] >= 0.20]
resp_table = '| Case | Seats | Evaluation speed-up | Response training 5.9 / 5.8 | Total wall time | Same numbers |\n|---|---|---|---|---|---|\n' + '\n'.join('| %s | %d | x%.2f | %.2f | %+.0f%% | %s |' % (names[r['fixture']], r['players'], r['evaluationSpeedup'], r['trainingRatio'], -100 * r['wallReduction'], 'yes' if r['identicalNumbers'] else 'NO') for r in rs)
tr = P.get('training', []); tratios = [r['ratio59Over58'] for r in tr]
ca = P.get('cache', [])
rep = {
 '@BUILD@': build,
 '@EVAL_SPEEDUP_RANGE@': '%.2f to %.2f' % (min(sp), max(sp)) if sp else 'NOT MEASURED',
 '@WALL_REDUCTION_RANGE@': ('%+.0f%% to %+.0f%% (wall time change)' % (-100 * min(wr), -100 * max(wr))) if wr else 'NOT MEASURED',
 '@WALL_TARGET_MET@': ('%d of %d cases (%s)' % (len(met), len(rs), '; '.join(met))) if rs else 'NOT MEASURED',
 '@RESPONSE_TABLE@': resp_table,
 '@DEFAULT_WALL_RANGE@': ('%.2f to %.2f' % (min(r['default59']['wallSeconds'] / r['wall']['old'][0] for r in rs), max(r['default59']['wallSeconds'] / r['wall']['old'][0] for r in rs))) if rs else 'NOT MEASURED',
 '@CACHE_SUMMARY@': '; '.join('%s: %s (5.8 walk) to %s (%.0f%% fewer)' % (names[r['fixture']], format(r['walk58']['d1Misses'], ','), format(r['walk59']['d1Misses'], ','), 100 * (1 - r['walk59']['d1Misses'] / r['walk58']['d1Misses'])) for r in ca) if ca else 'NOT MEASURED',
 '@TRAINING_SUMMARY@': ('5.9 / 5.8 seconds %.3f to %.3f over %d cases (one deal per update on four fixtures; 64 deals per update with 1, 2 and 4 threads).' % (min(tratios), max(tratios), len(tr))) if tr else 'NOT MEASURED.',
 '@TRAINING_SHORT@': ('5.9 / 5.8 time %.3f to %.3f' % (min(tratios), max(tratios))) if tr else 'not measured',
 '@MULTIWAY_SUMMARY@': '; '.join('%s x%.2f in evaluation, %+.0f%% total wall time' % (names[r['fixture']], r['evaluationSpeedup'], -100 * r['wallReduction']) for r in rs if r['players'] >= 3) + '.' if rs else 'NOT MEASURED.',
 '@HOST_WINE@': (' and %s of %s as `EightMax.exe` under Wine' % (wine['hostRefusal'].get('checksPassed'), wine['hostRefusal'].get('checksTotal'))) if 'missing' not in wine['hostRefusal'] else '',
 '@PS_SUMMARY@': 'focused mode %s; all sections %s' % (psline(ps['focused']), psline(ps['full'])),
 '@IDENTITY_SUMMARY@': '56 of 56 states in the prespecified comparison; ' + idline + ' in `identity57.py`; the golden states of the 5.5 and 5.7.1 binaries in the regression suite',
 '@REGRESSION_SUMMARY@': tapline(reg) + ' on the final Linux build (621 tests of 5.8 and 16 new ones). The skipped test needs enforced file permissions (the suite runs as root), as in 5.8. Self-tests on Linux: 5.9 ' + stline(st['59']) + '; 5.8 ' + stline(st['58']) + '; 5.7.1 ' + stline(st['571']) + '; 5.7 ' + stline(st['57']) + '. Under Wine and under sanitizers: VALIDATION-5.9.md.',
 '@VALIDATION_TABLE@': table,
 '@EXTRA_CLASS4@': ''.join('* %s\n' % x for x in ([('Mutants of the self-test not detected: ' + ', '.join(mut['notDetected'])) if mut.get('notDetected') else None] + [('Tests failing under Wine: ' + '; '.join(wine_tests[k]['failedTests'][:6])) if wine_tests[k].get('failedTests') else None for k in ('v59', 'v58')]) if x),
}
t = (tdir / 'FINAL-REPORT-5.9.template.md').read_text()
for k, v in rep.items(): t = t.replace(k, v)
left = sorted(set(re.findall(r'@[A-Z_0-9]+@', t))); assert not left, left
(root / 'FINAL-REPORT-5.9.md').write_text(t)
for f in ('MATHEMATICAL-VALIDATION-5.9.md', 'CONVERGENCE-5.9.md', 'RELEASE-5.9.md', 'WINDOWS-TESTS-5.9.md', 'PERFORMANCE-5.9.md', 'STATISTICAL-CHANGES-5.9.md'):
    p = root / f
    if p.exists(): p.write_text(p.read_text().replace('@BUILD@', build))
print('reports written for build', build)
