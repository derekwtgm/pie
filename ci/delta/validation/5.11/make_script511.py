#!/usr/bin/env python3
"""EightMax 5.11: writes source/tools/validate_windows511.ps1 and the two launchers from their 5.10 predecessors.
Usage: make_script511.py <release root>
The 5.10 script passed on physical Windows 11 (220 of 220 with the 5.10 release). 5.11 keeps every one of its sections
and adds two, written from the constructs of the two 5.10 sections that did run there:
  "self-test 5.11"   the checks of mwcli.exe --selftest511, imported one by one (26 checks)
  "streams 5.11"     the counter-based training streams on this PC: one state for every thread count and processing
                     mode, the state of the Linux build; deals per second with the 5.10 streams and with philox64
and changes one request: the over-limit study of section "refused study" names the 5.10 streams, whose limit it tests."""
import sys, pathlib, re
root = pathlib.Path(sys.argv[1]).resolve(); tools = root / 'source/tools'; s = (tools / 'validate_windows510.ps1').read_text(encoding='ascii')
def rep(a, b, n=1):
    global s
    assert s.count(a) == n, (a[:70], s.count(a)); s = s.replace(a, b)
head_end = s.index('# WHAT 5.10 ADDS TO THIS SCRIPT.')
s = '''# EightMax 5.11 validation on a Windows PC. Windows PowerShell 5.1 or PowerShell 7; nothing to install.
# Run from the release folder:  "Run 5.11 Windows validation.bat"   (every section, 30 to 80 minutes)
#                          or:  "Run 5.11 focused validation.bat"   (-Focused: what 5.11 added, 5 to 12 minutes)
#   (or: powershell -NoProfile -ExecutionPolicy Bypass -File source\\tools\\validate_windows511.ps1 [-Focused])
#
# WHAT 5.11 ADDS TO THIS SCRIPT. Every section of validate_windows510.ps1 is kept (that script passed 220 of 220
# checks on physical Windows 11 with an RTX 4060 Ti, for the 5.10 release). New in 5.11:
#   * section "self-test 5.11": the checks of "mwcli.exe --selftest511", imported one by one:
#       streams     the counter-based 64-bit training generator against its reference vectors and its inverse, the
#                   address rule, and a COUNTER AUDIT of real trainings: no counter is handed to the generator twice;
#       training    "trainingStreams":"5.10" writes the states of 5.10; philox64 is reproducible, independent of the
#                   thread count, resumable byte for byte, and writes the states of the Linux build;
#       checkpoint  a state continues only under the streams and the seed that trained it;
#       limits      a 5.10 state keeps the 10,000,000-update limit; a philox64 state is trained past it and past
#                   update index 2^32, to the states of the Linux build.
#   * section "streams 5.11": on THIS PC, a frozen-batch philox64 training with 1, 2, 4, 8 and all logical processors
#     and with every processing mode (CPU Only, Automatic, Hybrid, GPU-Preferred): one state, the state of the Linux
#     build; deals per second with the 5.10 streams and with philox64 (information).
#   * section "refused study": the over-limit study asks for the 5.10 streams by name (a study that does not choose
#     trains with philox64, which has no such limit).
# These two sections were executed before release with PowerShell 7 on Linux against the Linux programs and on a
# hosted Windows runner (see VALIDATION-5.11.md); their first run on a physical Windows PC is the user's.
#
''' + s[head_end:].replace('# WHAT 5.10 ADDS TO THIS SCRIPT.', '# WHAT 5.10 ADDED TO THIS SCRIPT.', 1)
rep("# -Focused runs sections 1, 2, 4, 5, 13 and 14 only: the default trainer against the recorded states with every\n# thread count, and everything 5.10 added.",
    "#  20  self-test 5.11   mwcli --selftest511, recorded under four section names: streams 5.11 (self-test),\n#                       training 5.11 (self-test), checkpoint 5.11 (self-test), limits 5.11 (self-test): 26 checks\n#  21  streams 5.11     philox64 on this PC: one state for every thread count and every processing mode, the state\n#                       of the Linux build; deals per second with both kinds of streams\n# -Focused runs sections 1, 2, 4, 5, 20 and 21 only: the 5.10-stream trainer against the recorded states with every\n# thread count, and everything 5.11 added.")
rep("$Release = '5.10'", "$Release = '5.11'")
rep("tool = 'validate_windows510.ps1'", "tool = 'validate_windows511.ps1'")
rep("$focusSections = @('environment', 'integrity', 'golden states', 'threads', 'self-test 5.10', 'estimator 5.10')", "$focusSections = @('environment', 'integrity', 'golden states', 'threads', 'self-test 5.11', 'streams 5.11')")
rep("if ($Focused) { $title = 'EightMax ' + $Release + ' focused Windows validation (the 5.10 trainer checks: default trainer against the 5.9 states, the experimental estimator, thread counts)' }",
    "if ($Focused) { $title = 'EightMax ' + $Release + ' focused Windows validation (the 5.11 trainer checks: the 5.10 streams against the recorded states, the counter-based training streams, thread counts, the update limit)' }")
rep("Plan 'configuration' 'CPU-only study completes on the CPU' 'gate'", """Plan 'self-test 5.11' 'mwcli --selftest511 ran and wrote its report' 'gate'
Plan 'self-test 5.11' 'every expected 5.11 check is in the report' 'gate'
Plan 'self-test 5.11' 'the 5.11 report agrees with the exit status of mwcli' 'gate'
Plan 'streams 5.11' 'identical philox64 state for every thread count' 'gate'
Plan 'streams 5.11' 'philox64 state equals the Linux build' 'gate'
Plan 'streams 5.11' 'philox64 thread scaling on this PC' 'information'
Plan 'streams 5.11' 'philox64: every processing mode writes the same state' 'gate'
Plan 'streams 5.11' 'philox64 processing modes on this PC' 'information'
Plan 'streams 5.11' 'training throughput with the 5.10 streams and with philox64 on this PC' 'information'
Plan 'configuration' 'CPU-only study completes on the CPU' 'gate'""")
rep('''$over = '{"variants":"baseline","seeds":[1,2],"budgets":[1000,20000000],"threads":2}';''', '''$over = '{"variants":"baseline","seeds":[1,2],"budgets":[1000,20000000],"threads":2,"trainingStreams":"5.10"}';''')
# the two new sections, placed before 'configuration'
a = s.index("Run-Section 'self-test 5.10' {"); b = s.index("Run-Section 'estimator 5.10' {"); c = s.index("Run-Section 'configuration' {")
st = s[a:b]
for x, y in (("self-test 5.10", "self-test 5.11"), ("selftest510", "selftest511"), ("st510", "st511"), ("What 5.10 added to the trainer", "What 5.11 added to the trainer"), ("the 5.10 release defines", "the 5.11 release defines"),
             ("expected 5.10 check", "expected 5.11 check"), ("the 5.10 report agrees", "the 5.11 report agrees")): st = st.replace(x, y)
i = st.index("$labels = @{"); j = st.index("\n", i)
st = st[:i] + "$labels = @{ streams = 'streams 5.11 (self-test)'; training = 'training 5.11 (self-test)'; checkpoint = 'checkpoint 5.11 (self-test)'; limits = 'limits 5.11 (self-test)' }" + st[j:]
i = st.index("$expected = @("); j = st.index("\n  $missing", i)
st = st[:i] + """$expected = @('streams G1', 'streams G2', 'streams G3', 'streams A1', 'streams A2', 'streams N1', 'streams L1', 'streams U1', 'streams U2',
                'training D1', 'training W1', 'training W2', 'training W3', 'training W4', 'training W5', 'training W6', 'training W7', 'training W8',
                'checkpoint C1', 'checkpoint C2', 'checkpoint C3', 'limits L1', 'limits L2', 'limits L3', 'limits L4', 'limits L5')""" + st[j:]
assert 'estimator' not in st and '5.10' not in st.replace('5.10 streams', ''), [l for l in st.splitlines() if '5.10' in l or 'estimator' in l][:3]
streams = r'''Run-Section 'streams 5.11' {
  # The counter-based training streams on this PC. Frozen batches (64 deals per update) are the mode in which one
  # training uses several threads; EIGHTMAX_THREAD_CHOICE=fixed puts every update on all the threads of the run, so
  # each thread count is really exercised. Every number of a philox64 training is a function of its address (seed,
  # update, deal, purpose), so the state must be the one the Linux build of this release wrote
  # (validation\5.11\windows\streams\reference.json), whatever the thread count, the processor or the operating system.
  $dir = Join-Path $Root 'validation\5.11\windows\streams'; $ref = Read-Json (Join-Path $dir 'reference.json')
  if (-not $ref) { Add-Check 'streams 5.11' 'identical philox64 state for every thread count' 'failed' 'validation\5.11\windows\streams\reference.json is missing or unreadable'; return }
  $case = $ref.threads; $spec = Join-Path $dir ([string]$case.spec)
  $counts = @(@(1, 2, 4, 8, $logical) | Where-Object { $_ -le $logical } | Sort-Object -Unique); $hashes = @(); $rows = @()
  foreach ($n in $counts) {
    $state = Join-Path $work ('wide-threads-' + $n + '.state'); $r = Invoke-Exe $mwcli @($spec, [string]$case.updates, [string]$n, $state, [string]$case.memoryMiB) @{ EIGHTMAX_THREAD_CHOICE = 'fixed' } 1800
    $h = ''; if ($r.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $h = Sha256 $state }; $hashes += $h
    $i = Parse-Json $r.out; $wall = $null; if ($i) { $wall = $i.wallSeconds }
    $rows += [pscustomobject]@{ threads = $n; mode = 'every update on all threads'; exit = $r.exit; wallSeconds = $wall; sha256 = $h }
  }
  $state = Join-Path $work 'wide-threads-auto.state'; $r = Invoke-Exe $mwcli @($spec, [string]$case.updates, [string]$logical, $state, [string]$case.memoryMiB) @{} 1800
  $h = ''; if ($r.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $h = Sha256 $state }; $hashes += $h
  $i = Parse-Json $r.out; $wall = $null; $chosen = $null; $named = ''; if ($i) { $wall = $i.wallSeconds; $named = [string]$i.trainingStreams; if ($i.threadChoice) { $chosen = $i.threadChoice.selected } }
  $rows += [pscustomobject]@{ threads = $logical; mode = 'measured thread choice'; exit = $r.exit; wallSeconds = $wall; threadsChosen = $chosen; sha256 = $h }
  $distinct = @($hashes | Sort-Object -Unique)
  Check 'streams 5.11' 'identical philox64 state for every thread count' ($distinct.Count -eq 1 -and $distinct[0] -ne '' -and $named -eq [string]$ref.algorithm) (($counts -join ', ') + ' threads and the measured choice: ' + $distinct.Count + ' distinct state(s); streams named by the program: ' + $named)
  Check 'streams 5.11' 'philox64 state equals the Linux build' ($distinct.Count -eq 1 -and $distinct[0] -eq [string]$case.stateSha256) ('' + $distinct[0] + ' (expected ' + $case.stateSha256 + ')')
  Add-Check 'streams 5.11' 'philox64 thread scaling on this PC' 'info' (($rows | ForEach-Object { '' + $_.threads + ' threads (' + $_.mode + '): ' + $_.wallSeconds + ' s' }) -join '; ')
  $report.wideThreadScaling = $rows
  # CPU Only, Automatic, Hybrid and GPU-Preferred. The traversal runs on the CPU in every mode; what a mode decides is
  # where the showdowns of a batch are scored. With an NVIDIA GPU the last two modes open CUDA; without one they fall
  # back to the CPU. The state must be the reference state either way. The spec is the reference spec with a "device"
  # field put in front (the fixture's own "device" is removed by make_reference511.py).
  $text = [System.IO.File]::ReadAllText($spec); $mh = @(); $ml = @(); $modes = @()
  foreach ($mode in @('cpu', 'auto', 'hybrid', 'gpu')) {
    $ms = Join-Path $work ('wide-mode-' + $mode + '.spec.json'); $state = Join-Path $work ('wide-mode-' + $mode + '.state')
    $at = $text.IndexOf('{'); Write-Text $ms ($text.Substring(0, $at + 1) + '"device":"' + $mode + '",' + $text.Substring($at + 1))
    $r = Invoke-Exe $mwcli @($ms, [string]$case.updates, '4', $state, [string]$case.memoryMiB) @{} 1800
    $h = ''; if ($r.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $h = Sha256 $state }; $mh += $h
    $i = Parse-Json $r.out; $decision = ''; $opened = $null; if ($i -and $i.scheduling) { $decision = [string]$i.scheduling.decision; $opened = $i.scheduling.cudaOpenedThisCall }
    $ml += ('' + $mode + ': ' + $decision + ' (CUDA opened: ' + $opened + ')'); $modes += [pscustomobject]@{ mode = $mode; exit = $r.exit; sha256 = $h; decision = $decision; cudaOpened = $opened }
  }
  $md = @($mh | Sort-Object -Unique)
  Check 'streams 5.11' 'philox64: every processing mode writes the same state' ($md.Count -eq 1 -and $md[0] -eq [string]$case.stateSha256) ('cpu, auto, hybrid, gpu: ' + $md.Count + ' distinct state(s); ' + $md[0] + ' (expected ' + $case.stateSha256 + ')')
  Add-Check 'streams 5.11' 'philox64 processing modes on this PC' 'info' ($ml -join '; ')
  $report.wideProcessingModes = $modes
  # deals per second with both kinds of streams (information: this PC's numbers, one thread and all threads)
  $lines = @(); $tp = @()
  foreach ($t in @($ref.throughput)) {
    foreach ($arm in @('streams510', 'philox64')) {
      $sf = Join-Path $dir ([string]$t.($arm + 'Spec')); $st = Join-Path $work ('tp511-' + $arm + '.state'); $upd = [string]$t.updates
      foreach ($n in @(1, $logical)) {
        if ($n -gt 1 -and -not [bool]$t.batch) { continue }
        $r = Invoke-Exe $mwcli @($sf, $upd, [string]$n, $st, '2048') @{} 1800; $i = Parse-Json $r.out
        if ($r.exit -eq 0 -and $i -and [double]$i.wallSeconds -gt 0) {
          $rate = [math]::Round([double]$i.trainingDeals / [double]$i.wallSeconds); $lines += ('' + $t.name + ', ' + $arm + ', ' + $n + ' thread(s) offered: ' + $rate + ' sampled deals per second')
          $tp += [pscustomobject]@{ fixture = [string]$t.name; streams = $arm; threadsOffered = $n; deals = $i.trainingDeals; wallSeconds = $i.wallSeconds; dealsPerSecond = $rate; rows = $i.rows; processPeakRssMiB = $i.processPeakRssMiB }
        } else { $lines += ('' + $t.name + ', ' + $arm + ', ' + $n + ' thread(s): exit ' + $r.exit) }
      }
    }
  }
  Add-Check 'streams 5.11' 'training throughput with the 5.10 streams and with philox64 on this PC' 'info' ($lines -join '; ')
  $report.streamsThroughput = $tp
}

'''
s = s[:c] + st + streams + s[c:]
assert all(ord(ch) < 128 for ch in s)
(tools / 'validate_windows511.ps1').write_bytes(s.replace('\r\n', '\n').replace('\n', '\r\n' if '\r\n' in (tools / 'validate_windows510.ps1').read_bytes().decode('ascii') else '\n').encode('ascii'))
# ---- launchers ----
full = (root / 'Run 5.10 Windows validation.bat').read_bytes().decode('ascii').replace('\r\n', '\n')
full = full.replace('5.10', '5.11').replace('validate_windows510', 'validate_windows511')
assert 'Windows-selftest510-5.11.json' in full
full = full.replace('This takes 25 to 70 minutes.', 'This takes 30 to 80 minutes.')
full = full.replace('echo   Windows-selftest510-5.11.json    the 5.11 checks made by mwcli.exe itself (no PowerShell needed)', 'echo   Windows-selftest510-5.11.json     the 5.10 checks made by mwcli.exe itself (no PowerShell needed)\necho   Windows-selftest511-5.11.json     the 5.11 checks made by mwcli.exe itself (no PowerShell needed)')
full = full.replace('if exist "Windows-selftest510-5.11.json" del /q "Windows-selftest510-5.11.json"\n', 'if exist "Windows-selftest510-5.11.json" del /q "Windows-selftest510-5.11.json"\nif exist "Windows-selftest511-5.11.json" del /q "Windows-selftest511-5.11.json"\n')
for n in range(1, 7): full = full.replace('Step %d of 6' % n, 'Step %d of 7' % (n if n < 6 else 7))
full = full.replace('if "%selftest510_result%"=="0" (echo Self-test 5.11: every check passed.) else (echo Self-test 5.11: exit status %selftest510_result%: a check failed or could not be made. See Windows-selftest510-5.11.json.)',
                    'if "%selftest510_result%"=="0" (echo Self-test 5.10: every check passed.) else (echo Self-test 5.10: exit status %selftest510_result%: a check failed or could not be made. See Windows-selftest510-5.11.json.)')
step6 = '''echo Step 6 of 7: mwcli.exe --selftest511 (the counter-based training streams: generator, counter audit, recorded states, checkpoint rules, the update limit)
set "em_st6=%TEMP%\\EightMax-5.11-selftest511-%RANDOM%%RANDOM%"
mwcli.exe --selftest511 "studies" "%em_st6%" all
set "selftest511_result=%errorlevel%"
if exist "%em_st6%\\selftest511.json" copy /y "%em_st6%\\selftest511.json" "Windows-selftest511-5.11.json" >nul
if exist "%em_st6%" rmdir /s /q "%em_st6%"
if "%selftest511_result%"=="0" (echo Self-test 5.11: every check passed.) else (echo Self-test 5.11: exit status %selftest511_result%: a check failed or could not be made. See Windows-selftest511-5.11.json.)
if not exist "Windows-selftest511-5.11.json" if "%selftest511_result%"=="0" set "selftest511_result=2"
echo.
'''
i = full.index('echo Step 7 of 7: the validation script'); full = full[:i] + step6 + full[i:]
full = full.replace('Its 5.11 sections have not run on Windows before this release', 'Its 5.11 sections have not run on a physical Windows PC before this release').replace('The self-test results of steps 1 to 5 stand on their own.', 'The self-test results of steps 1 to 6 stand on their own.')
full = full.replace('if not "%selftest510_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"\n', 'if not "%selftest510_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"\nif not "%selftest511_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"\n')
(root / 'Run 5.11 Windows validation.bat').write_bytes(full.replace('\n', '\r\n').encode('ascii'))
foc = (root / 'Run 5.10 focused validation.bat').read_bytes().decode('ascii').replace('\r\n', '\n')
i = foc.index('echo EightMax 5.10 focused validation'); j = foc.index('echo Saved studies are not touched')
foc = foc[:i] + '''echo EightMax 5.11 focused validation on this Windows PC: what 5.11 added or changed in the trainer.
echo   - the counter-based 64-bit training streams: the generator against its reference vectors and its inverse,
echo     and a counter audit of real trainings (no counter is handed to the generator twice)
echo   - "trainingStreams" 5.10: the states of 5.10, byte for byte, with 1, 2, 4, 8 and all logical processors
echo   - philox64: one state for every thread count and processing mode, the state of the Linux build;
echo     stop and continue; checkpoint rules; a 64-bit seed
echo   - the 10,000,000-update limit: kept by 5.10 states, absent for philox64 states (trained past it here)
echo   - reference fixtures: exact NashConv after a fixed budget; the trained response of a philox64 state
echo No GPU test. Nothing is installed. This takes about 5 to 12 minutes.
''' + foc[j:]
foc = foc.replace('5.10', '5.11').replace('selftest510', 'selftest511').replace('validate_windows510', 'validate_windows511').replace('Its 5.11 sections have not run on Windows before this release', 'Its 5.11 sections have not run on a physical Windows PC before this release')
(root / 'Run 5.11 focused validation.bat').write_bytes(foc.replace('\n', '\r\n').encode('ascii'))
print('written: validate_windows511.ps1 (%d lines), two launchers' % s.count('\n'))
