# EightMax 5.11 validation on a Windows PC. Windows PowerShell 5.1 or PowerShell 7; nothing to install.
# Run from the release folder:  "Run 5.11 Windows validation.bat"   (every section, 30 to 80 minutes)
#                          or:  "Run 5.11 focused validation.bat"   (-Focused: what 5.11 added, 5 to 12 minutes)
#   (or: powershell -NoProfile -ExecutionPolicy Bypass -File source\tools\validate_windows511.ps1 [-Focused])
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
# WHAT 5.10 ADDED TO THIS SCRIPT. Sections 1 to 12 and 15 to 19 are the 5.9 script (validate_windows59.ps1, which
# passed 192 of 192 checks on physical Windows 11 with an RTX 4060 Ti). New in 5.10:
#   * section 13, "self-test 5.10": the checks of "mwcli.exe --selftest510", imported one by one:
#       estimator   the experimental training estimator "rbes" against the quantity it must estimate, EXACTLY: the
#                   expectation of its increments over every outcome of its sampling equals a brute-force walk of the
#                   whole betting tree (eight fixture and variant combinations; chip EV, ICM, two to six players);
#       training    the DEFAULT trainer writes the states of 5.9 (14 states, SHA-256); the Detailed key cache changes
#                   nothing; rbes is deterministic, independent of threads, of its key cache and of the batch update,
#                   continues byte for byte, writes the states of the Linux build, reproduces the recorded exact
#                   NashConv of four reference fixtures; the trained response of an rbes state; a study with rbes;
#       checkpoint  a state continues only under the algorithm that trained it; headers; compressed states;
#       limits      unsupported configurations refused; the table limit stops cleanly and is resumable.
#   * section 14, "estimator 5.10": on THIS PC, a frozen-batch rbes training with 1, 2, 4, 8 and all logical
#     processors gives one state, the state the Linux build wrote; the exact check of the estimator on a table trained
#     here (mwcli --estimator-check); sampled deals per second of the default trainer and of rbes on two fixtures
#     (this PC's numbers; information).
#
# STATUS OF THIS SCRIPT. It was parsed by the PowerShell parser and executed to its end with PowerShell 7.4 on Linux
# against the Linux build of the three programs (validation\5.10\powershell: every section that does not need
# Windows itself or an NVIDIA GPU). It was NOT executed on Windows: sections 13 and 14 run there for the first time
# (the other sections are the 5.9 script, which did run on Windows). The checks of "mwcli.exe --selftest510"
# themselves need no PowerShell: they ran on Linux and, as the Windows program, under Wine; the launchers run them
# first and keep their report (Windows-selftest510-5.10.json) whatever happens to this script.
#
# Reports (next to the executables, or in -OutDir):
#   full run      Windows-validation-5.10.json          Windows-validation-5.10.txt
#   -Focused      Windows-focused-validation-5.10.json  Windows-focused-validation-5.10.txt
# Nothing is installed; nothing is written outside the release folder (the reports) and one temporary folder,
# which is removed at the end. Saved studies are never touched: every corruption check works on copies inside that
# temporary folder. No check cuts the power or kills anything but the processes this script started.
#
#   1  environment      Windows version, CPU, RAM, GPU, virtual-machine and Wine indicators
#   2  integrity        the three programs start and report this build; every file against SHA256SUMS.txt
#   3  self-test 5.7    mwcli --selftest57: worker pool, deal queue, card code, thread choice; frozen-batch states of
#                       the 5.6 binary for 1 to 8 threads; evaluation with and without the path tree
#   4  golden states    11 training runs must reproduce, byte for byte, the states the 5.5 Linux binary wrote
#   5  threads          frozen-batch training with 1, 2, 4, 8 and all logical processors, every update on all of them:
#                       identical state; the times and the measured thread choice are reported
#   6  evaluator        exact best response with a 32 MiB and a 1,024 MiB cache: identical values
#   7  study            a complete study of the known game: version, statistics fields, closed form
#   8  recovery         time-limit interruption and resume, a killed process and resume, a second process refused
#   9  self-test 5.7.1  mwcli --selftest571 (checkpoint integrity, memory budget, verdict controls): 24 checks
#  10  self-test 5.8    mwcli --selftest58: engine 5.8, trained response (self-test), large-study limit: 33 checks
#  11  self-test 5.9    mwcli --selftest59: engine 5.9, statistics 5.9, response 5.9: 32 checks
#  12  trained response mwcli --response on reference games: the Linux build's bits for 5.9 and, with the 5.8
#                       streams, for 5.8; parallel seats give the same bits
#  13  self-test 5.10   mwcli --selftest510, recorded under four section names: estimator 5.10 (self-test),
#                       training 5.10 (self-test), checkpoint 5.10 (self-test), limits 5.10 (self-test): 21 checks
#  14  estimator 5.10   rbes on this PC: one state for every thread count and every processing mode (CPU Only,
#                       Automatic, Hybrid, GPU-Preferred), the state of the Linux build; the exact
#                       check on a table trained here; deals per second of both trainers
#  15  configuration    CPU-only mode, GPU-Preferred falling back to the CPU, invalid specs and options refused
#  16  throughput       sampled deals per second on the study fixtures, one thread and all threads (this PC's numbers)
#  17  desktop host     EightMax.exe starts without a browser, reports version and build, serves the Study tab
#  18  GPU              validate_hardware.ps1 and the processing modes (skipped with the reason when no NVIDIA GPU answers)
#  19  refused study    the desktop host refuses an over-limit study and leaves no folder; existing folders are kept
#  20  self-test 5.11   mwcli --selftest511, recorded under four section names: streams 5.11 (self-test),
#                       training 5.11 (self-test), checkpoint 5.11 (self-test), limits 5.11 (self-test): 26 checks
#  21  streams 5.11     philox64 on this PC: one state for every thread count and every processing mode, the state
#                       of the Linux build; deals per second with both kinds of streams
# -Focused runs sections 1, 2, 4, 5, 20 and 21 only: the 5.10-stream trainer against the recorded states with every
# thread count, and everything 5.11 added.
#
# Every check has a status and a class.
#   status  passed | failed | skipped (not run on purpose: an option, or hardware that is not there; the reason is
#           given) | untested (planned, but not reached or not possible: a step it depends on failed, or the
#           condition it needs could not be produced; the reason is given) | info (a measurement)
#   class   gate (deterministic: must pass on every Windows PC) | environment (depends on this PC's configuration) |
#           hardware (needs an NVIDIA GPU) | information
# A failed or untested check carries "evidence": the exit status, standard output and standard error of the
# processes it ran.
# Exit status: 0 when no gate check failed and none is untested; 1 otherwise; 2 when the script itself failed.
# -Quick skips 16 and shortens 8; -SkipGpu skips 18; -SkipIntegrity skips the checksum pass over every file.
param([switch]$Quick, [switch]$SkipGpu, [switch]$SkipIntegrity, [switch]$Focused, [string]$Root = '', [string]$OutDir = '')
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1: extended type data on System.Array (added by some modules) makes ConvertTo-Json write
# arrays as objects with "value" and "Count"; removing it restores plain JSON arrays.
Remove-TypeData System.Array -ErrorAction SilentlyContinue
$Release = '5.11'
if (-not $Root) { $Root = Join-Path $PSScriptRoot '..\..' }
$Root = (Resolve-Path -LiteralPath $Root).Path
if (-not $OutDir) { $OutDir = $Root }
$mwcli = Join-Path $Root 'mwcli.exe'; $hostExe = Join-Path $Root 'EightMax.exe'; $stress = Join-Path $Root 'gpustress.exe'
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('EightMax-' + $Release + '-validation-' + [guid]::NewGuid().ToString('N'))
$records = New-Object System.Collections.Generic.List[object]
$sections = New-Object System.Collections.Generic.List[object]
$children = New-Object System.Collections.Generic.List[object]
$started = Get-Date
$logical = [Environment]::ProcessorCount
$mode = 'full'; if ($Focused) { $mode = 'focused' }
$report = [ordered]@{ tool = 'validate_windows511.ps1'; release = $Release; mode = $mode; started = $started.ToString('o'); root = $Root; quick = [bool]$Quick; scriptCompleted = $false }
$reportName = 'Windows-validation-'; if ($Focused) { $reportName = 'Windows-focused-validation-' }
$jsonPath = Join-Path $OutDir ($reportName + $Release + '.json'); $txtPath = Join-Path $OutDir ($reportName + $Release + '.txt')
# A report of an earlier run must not be mistaken for this run's: both files are removed before anything is checked.
foreach ($old in @($jsonPath, $txtPath)) { if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue } }
# -Focused: only these sections are planned and run.
$focusSections = @('environment', 'integrity', 'golden states', 'threads', 'self-test 5.11', 'streams 5.11')

# ---- the plan: every check this script intends to make. A planned check that is never recorded is reported as
# ---- 'untested' at the end, so a section that stops early cannot make the report look complete.
$plan = New-Object System.Collections.Generic.List[object]
# $group is the section of Run-Section a check belongs to when its own section label differs (the self-tests).
function Plan([string]$section, [string]$name, [string]$class, [string]$group = '') {
  if (-not $group) { $group = $section }
  if ($Focused -and ($focusSections -notcontains $group)) { return }
  $plan.Add([pscustomobject]@{ section = $section; name = $name; class = $class })
}
Plan 'environment' 'machine' 'information'
Plan 'environment' '64-bit Windows' 'gate'
Plan 'environment' 'physical hardware' 'information'
Plan 'integrity' 'mwcli.exe present' 'gate'
Plan 'integrity' 'EightMax.exe present' 'gate'
Plan 'integrity' 'gpustress.exe present' 'gate'
Plan 'integrity' 'BUILD-INFO.json version' 'gate'
Plan 'integrity' 'mwcli.exe build id' 'gate'
Plan 'integrity' 'EightMax.exe build id' 'gate'
Plan 'integrity' 'gpustress.exe starts' 'gate'
Plan 'integrity' 'SHA256SUMS.txt' 'gate'
Plan 'self-test 5.7' 'mwcli --selftest57 ran and wrote its report' 'gate'
Plan 'golden states' 'every golden state reproduced' 'gate'
Plan 'threads' 'identical state for every thread count' 'gate'
Plan 'threads' 'state equals the 5.6 binary' 'gate'
Plan 'threads' 'thread scaling on this PC' 'information'
Plan 'evaluator' 'exact NashConv with 32 and 1,024 MiB caches' 'gate'
Plan 'study' 'study of the known game completes' 'gate'
Plan 'study' 'version and build in the result' 'gate'
Plan 'study' 'replication statistics present' 'gate'
Plan 'study' 'closed form of the known game' 'gate'
Plan 'recovery' 'uninterrupted reference' 'gate'
Plan 'recovery' 'time-limit interruption and resume' 'gate'
Plan 'recovery' 'second process refused while the first runs' 'gate'
Plan 'recovery' 'killed process, then resume' 'gate'
Plan 'self-test 5.7.1' 'mwcli --selftest571 ran and wrote its report' 'gate'
Plan 'self-test 5.7.1' 'every expected 5.7.1 check is in the report' 'gate'
Plan 'self-test 5.7.1' 'the report agrees with the exit status of mwcli' 'gate'
Plan 'self-test 5.8' 'mwcli --selftest58 ran and wrote its report' 'gate'
Plan 'self-test 5.8' 'every expected 5.8 check is in the report' 'gate'
Plan 'self-test 5.8' 'the 5.8 report agrees with the exit status of mwcli' 'gate'
Plan 'self-test 5.9' 'mwcli --selftest59 ran and wrote its report' 'gate'
Plan 'self-test 5.9' 'every expected 5.9 check is in the report' 'gate'
Plan 'self-test 5.9' 'the 5.9 report agrees with the exit status of mwcli' 'gate'
Plan 'trained response' 'every 5.9 reference response reproduced' 'gate'
Plan 'trained response' 'the 5.8 streams reproduce the 5.8 reference responses' 'gate'
Plan 'trained response' 'parallel seats give the same bits' 'gate'
Plan 'trained response' 'every statement of the references holds against the exact values' 'gate'
Plan 'self-test 5.10' 'mwcli --selftest510 ran and wrote its report' 'gate'
Plan 'self-test 5.10' 'every expected 5.10 check is in the report' 'gate'
Plan 'self-test 5.10' 'the 5.10 report agrees with the exit status of mwcli' 'gate'
Plan 'estimator 5.10' 'identical rbes state for every thread count' 'gate'
Plan 'estimator 5.10' 'rbes state equals the Linux build' 'gate'
Plan 'estimator 5.10' 'rbes thread scaling on this PC' 'information'
Plan 'estimator 5.10' 'rbes: every processing mode writes the same state' 'gate'
Plan 'estimator 5.10' 'rbes processing modes on this PC' 'information'
Plan 'estimator 5.10' 'exact check of the estimator on a table trained on this PC' 'gate'
Plan 'estimator 5.10' 'default and rbes training throughput on this PC' 'information'
Plan 'self-test 5.11' 'mwcli --selftest511 ran and wrote its report' 'gate'
Plan 'self-test 5.11' 'every expected 5.11 check is in the report' 'gate'
Plan 'self-test 5.11' 'the 5.11 report agrees with the exit status of mwcli' 'gate'
Plan 'streams 5.11' 'identical philox64 state for every thread count' 'gate'
Plan 'streams 5.11' 'philox64 state equals the Linux build' 'gate'
Plan 'streams 5.11' 'philox64 thread scaling on this PC' 'information'
Plan 'streams 5.11' 'philox64: every processing mode writes the same state' 'gate'
Plan 'streams 5.11' 'philox64 processing modes on this PC' 'information'
Plan 'streams 5.11' 'training throughput with the 5.10 streams and with philox64 on this PC' 'information'
Plan 'configuration' 'CPU-only study completes on the CPU' 'gate'
Plan 'configuration' 'GPU-Preferred gives the CPU measurements' 'gate'
Plan 'configuration' 'invalid training spec refused, nothing written' 'gate'
Plan 'configuration' 'unreadable spec refused' 'gate'
Plan 'configuration' 'unknown study option refused' 'gate'
Plan 'configuration' 'invalid study option value refused' 'gate'
Plan 'throughput' 'training throughput' 'information'
Plan 'desktop host' 'starts without a browser and answers /api/info' 'gate'
Plan 'desktop host' '/api/info version and build' 'gate'
Plan 'desktop host' 'interface served with the Study tab and this build' 'gate'
Plan 'desktop host' 'saved-study list answers' 'gate'
Plan 'desktop host' 'host process ends when stopped' 'environment'
Plan 'GPU' 'CUDA validation' 'hardware'
Plan 'refused study' 'the host starts with a private profile folder' 'gate'
Plan 'refused study' 'an over-limit study is refused and leaves no folder' 'gate'
Plan 'refused study' 'a folder that existed before is kept with its files' 'gate'
Plan 'refused study' 'an ordinary study completes after the refusal' 'gate'

function Text($detail) { if ($null -eq $detail) { return '' } if ($detail -is [string]) { return $detail } try { return ($detail | ConvertTo-Json -Compress -Depth 6) } catch { return [string]$detail } }
# Evidence of one finished process: what a failed check needs to be understood without running it again.
function Clip([string]$t, [int]$max = 4000) { if ($null -eq $t) { return '' }; if ($t.Length -le $max) { return $t }; return ($t.Substring(0, [int]($max / 2)) + "`n...[" + ($t.Length - $max) + " characters omitted]...`n" + $t.Substring($t.Length - [int]($max / 2))) }
function Run-Evidence($r, [string]$what = '') {
  if ($null -eq $r) { return $null }
  return [ordered]@{ process = $what; exitCode = $r.exit; timedOut = [bool]$r.timedOut; seconds = $r.seconds; standardOutput = (Clip ([string]$r.out)); standardError = (Clip ([string]$r.err)) }
}
function Add-Check([string]$section, [string]$name, [string]$status, $detail, [string]$class = '', $evidence = $null) {
  if (-not $class) { $p = $plan | Where-Object { $_.section -eq $section -and $_.name -eq $name } | Select-Object -First 1; if ($p) { $class = $p.class } else { $class = 'gate' } }
  # evidence is kept for every check that carries it; a passed check without evidence has null
  $records.Add([pscustomobject]@{ section = $section; name = $name; status = $status; class = $class; detail = $detail; evidence = $evidence })
  $mark = 'PASS'
  if ($status -eq 'failed') { $mark = 'FAIL' } elseif ($status -eq 'skipped') { $mark = 'SKIP' } elseif ($status -eq 'info') { $mark = 'INFO' } elseif ($status -eq 'untested') { $mark = 'UNTESTED' }
  Write-Host ('  [{0}] {1}: {2}' -f $mark, $name, (Text $detail))
}
function Check([string]$section, [string]$name, [bool]$ok, $detail, [string]$class = '', $evidence = $null) { $s = 'failed'; if ($ok) { $s = 'passed' }; Add-Check $section $name $s $detail $class $evidence }
function Run-Section([string]$name, [scriptblock]$body) {
  if ($Focused -and ($focusSections -notcontains $name)) { return }
  Write-Host ''; Write-Host ('== ' + $name)
  $t = Get-Date; $err = $null
  try { & $body } catch { $err = $_.Exception.Message + ' (line ' + $_.InvocationInfo.ScriptLineNumber + ')'; Write-Host ('  [ERROR] section stopped: ' + $err) }
  $sections.Add([pscustomobject]@{ section = $name; seconds = [math]::Round(((Get-Date) - $t).TotalSeconds, 2); error = $err })
  Save-Report
}
function Sha256([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
# One argument for a Windows command line (CommandLineToArgvW rules: backslashes are literal unless they precede a quote).
function Quote-Arg([string]$a) {
  if ($a -ne '' -and $a -notmatch '[\s"]') { return $a }
  $backslash = [char]92; $quote = [char]34
  $sb = New-Object System.Text.StringBuilder; [void]$sb.Append($quote); $bs = 0
  foreach ($c in $a.ToCharArray()) {
    if ($c -eq $backslash) { $bs++; continue }
    if ($c -eq $quote) { [void]$sb.Append($backslash, ($bs * 2 + 1)); [void]$sb.Append($quote); $bs = 0; continue }
    if ($bs -gt 0) { [void]$sb.Append($backslash, $bs); $bs = 0 }
    [void]$sb.Append($c)
  }
  if ($bs -gt 0) { [void]$sb.Append($backslash, ($bs * 2)) }
  [void]$sb.Append($quote); return $sb.ToString()
}
function Join-Args([string[]]$arguments) { (@($arguments) | ForEach-Object { Quote-Arg $_ }) -join ' ' }
# Runs a program to completion. Returns exit code, stdout, stderr, seconds, peak working set and whether it timed out.
function Invoke-Exe([string]$exe, [string[]]$arguments, [hashtable]$environment = @{}, [int]$timeoutSeconds = 3600) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true; $psi.WorkingDirectory = $work
  $psi.Arguments = Join-Args $arguments
  foreach ($k in $environment.Keys) { $psi.EnvironmentVariables[$k] = [string]$environment[$k] }
  $p = New-Object System.Diagnostics.Process; $p.StartInfo = $psi
  $t = Get-Date
  try { [void]$p.Start() } catch { return [pscustomobject]@{ exit = -998; out = ''; err = ('could not start: ' + $_.Exception.Message); seconds = 0; timedOut = $false; peakMiB = 0 } }
  $outTask = $p.StandardOutput.ReadToEndAsync(); $errTask = $p.StandardError.ReadToEndAsync()
  # Wait in short steps so that the peak working set can be read while the process is alive (it is not available afterwards).
  $peakBytes = 0; $finished = $false; $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while (-not $finished) {
    $finished = $p.WaitForExit(100)
    if (-not $finished) { try { $p.Refresh(); if ($p.PeakWorkingSet64 -gt $peakBytes) { $peakBytes = $p.PeakWorkingSet64 } } catch {}; if ((Get-Date) -gt $deadline) { break } }
  }
  if (-not $finished) { try { $p.Kill() } catch {}; [void]$p.WaitForExit(15000) } else { $p.WaitForExit() }
  $o = ''; $e = ''
  try { if ($outTask.Wait(15000)) { $o = $outTask.Result } } catch {}
  try { if ($errTask.Wait(15000)) { $e = $errTask.Result } } catch {}
  $code = -999; if ($finished) { $code = $p.ExitCode }
  # 5.7.1: a process that ended before the first 100 ms reading has no sampled peak; 5.7 reported that as 0 MiB.
  $peak = $null; if ($peakBytes -gt 0) { $peak = [math]::Round($peakBytes / 1MB, 1) }
  [pscustomobject]@{ exit = $code; out = $o; err = $e; seconds = [math]::Round(((Get-Date) - $t).TotalSeconds, 3); timedOut = (-not $finished); peakMiB = $peak }
}
# Starts a program that keeps running; it is stopped by Stop-Child or, at the latest, when the script ends.
function Start-Child([string]$exe, [string[]]$arguments) {
  # 5.9: -WindowStyle exists on Windows only. Windows PowerShell 5.1 has no IsWindows variable (it is always Windows);
  # PowerShell 7 on another system (where this script was executed in development) must not pass the parameter.
  $platformVariable = Get-Variable -Name 'IsWindows' -ErrorAction SilentlyContinue
  $onWindows = ($null -eq $platformVariable) -or [bool]$platformVariable.Value
  if ($onWindows) { $p = Start-Process -FilePath $exe -ArgumentList (Join-Args $arguments) -WorkingDirectory $work -PassThru -WindowStyle Hidden }
  else { $p = Start-Process -FilePath $exe -ArgumentList (Join-Args $arguments) -WorkingDirectory $work -PassThru }
  $children.Add($p); return $p
}
function Stop-Child($p) { if ($p) { try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; [void]$p.WaitForExit(15000) } } catch {} } }
function Read-Json([string]$path) { if (-not (Test-Path -LiteralPath $path)) { return $null }; try { return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json) } catch { return $null } }
function Parse-Json([string]$text) { if (-not $text) { return $null }; try { return ($text | ConvertFrom-Json) } catch { return $null } }
function Write-Text([string]$path, [string]$text) { [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false))) }
# A number as text that distinguishes every value (Windows PowerShell prints a double with 15 digits by default).
function Num($x) {
  if ($null -eq $x) { return 'null' }
  if ($x -is [double]) { return $x.ToString('R', [System.Globalization.CultureInfo]::InvariantCulture) }
  if ($x -is [single]) { return ([double]$x).ToString('R', [System.Globalization.CultureInfo]::InvariantCulture) }
  if ($x -is [System.IFormattable]) { return $x.ToString($null, [System.Globalization.CultureInfo]::InvariantCulture) }
  return [string]$x
}
# The measurements of a study, one line per (variant, seed, budget).
function Study-Points($doc) {
  if (-not $doc) { return '' }
  $rows = @()
  foreach ($v in @($doc.variants)) { foreach ($s in @($v.perSeed)) { foreach ($p in @($s.budgets)) {
    $rows += ('' + $v.name + '|' + $s.seed + '|' + $p.budgetDeals + '|' + $p.deals + '|' + ((@($p.ev) | ForEach-Object { Num $_ }) -join ',') + '|' + ((@($p.frequency) | ForEach-Object { Num $_ }) -join ',') + '|' + (Num $p.quality))
  } } }
  return ($rows -join "`n")
}
function Study-Complete($doc) { return [bool]($doc -and $doc.completion -and $doc.completion.complete) }
function Http-Get([string]$url, [int]$timeoutMs = 5000) {
  # A direct request to this PC (no system proxy), usable in Windows PowerShell 5.1 and PowerShell 7.
  $req = [System.Net.HttpWebRequest]::Create($url); $req.Proxy = $null; $req.Timeout = $timeoutMs; $req.ReadWriteTimeout = $timeoutMs; $req.Method = 'GET'
  $resp = $req.GetResponse()
  try { $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8); $body = $reader.ReadToEnd(); $reader.Close(); return [pscustomobject]@{ status = [int]$resp.StatusCode; body = $body } } finally { $resp.Close() }
}
# 5.9: a POST to this PC. Returns the status and the body also for 4xx and 5xx answers (which .NET raises as exceptions).
function Http-Post([string]$url, [string]$json, [int]$timeoutMs = 30000) {
  $req = [System.Net.HttpWebRequest]::Create($url); $req.Proxy = $null; $req.Timeout = $timeoutMs; $req.ReadWriteTimeout = $timeoutMs; $req.Method = 'POST'; $req.ContentType = 'application/json'
  $req.Headers.Add('X-EightMax', '1'); $bytes = [System.Text.Encoding]::UTF8.GetBytes($json); $req.ContentLength = $bytes.Length
  $stream = $req.GetRequestStream(); $stream.Write($bytes, 0, $bytes.Length); $stream.Close()
  $resp = $null
  try { $resp = $req.GetResponse() } catch [System.Net.WebException] { $resp = $_.Exception.Response; if (-not $resp) { throw } }
  try { $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8); $body = $reader.ReadToEnd(); $reader.Close(); return [pscustomobject]@{ status = [int]$resp.StatusCode; body = $body } } finally { $resp.Close() }
}
# 5.9: a program that keeps running, started with additional environment variables (Start-Process cannot set them
# in Windows PowerShell 5.1). Stopped by Stop-Child or, at the latest, when the script ends.
function Start-ChildWith([string]$exe, [string[]]$arguments, [hashtable]$environment) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.WorkingDirectory = $work; $psi.Arguments = Join-Args $arguments
  foreach ($k in $environment.Keys) { $psi.EnvironmentVariables[$k] = [string]$environment[$k] }
  $p = New-Object System.Diagnostics.Process; $p.StartInfo = $psi; [void]$p.Start(); $children.Add($p); return $p
}
# The evidence of a check as indented text lines (hash tables written by this script, objects read from JSON).
function Evidence-Lines($e) {
  $out = New-Object System.Collections.Generic.List[string]
  if ($null -eq $e) { return $out }
  if ($e -is [System.Collections.IDictionary]) { foreach ($k in @($e.Keys)) { $out.Add('      ' + $k + ': ' + (Text $e[$k])) } }
  elseif ($e -is [string]) { $out.Add('      ' + $e) }
  else { foreach ($p in @($e.PSObject.Properties)) { $out.Add('      ' + $p.Name + ': ' + (Text $p.Value)) } }
  return $out
}
function Save-Report {
  $failed = @($records | Where-Object { $_.status -eq 'failed' }); $skipped = @($records | Where-Object { $_.status -eq 'skipped' }); $untested = @($records | Where-Object { $_.status -eq 'untested' })
  $passed = @($records | Where-Object { $_.status -eq 'passed' })
  $gateFailed = @($failed | Where-Object { $_.class -eq 'gate' }); $gateUntested = @($untested | Where-Object { $_.class -eq 'gate' })
  $report.finished = (Get-Date).ToString('o'); $report.seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  $report.summary = [ordered]@{ passed = $passed.Count; failed = $failed.Count; skipped = $skipped.Count; untested = $untested.Count; gateFailed = $gateFailed.Count; gateUntested = $gateUntested.Count
    environmentFailed = @($failed | Where-Object { $_.class -eq 'environment' }).Count; hardwareFailed = @($failed | Where-Object { $_.class -eq 'hardware' }).Count
    allGatesPassed = ($gateFailed.Count -eq 0 -and $gateUntested.Count -eq 0 -and [bool]$report.scriptCompleted) }
  $report.sections = $sections; $report.checks = $records
  try {
    Write-Text $jsonPath ($report | ConvertTo-Json -Depth 12)
    $title = 'EightMax ' + $Release + ' Windows validation'; if ($Focused) { $title = 'EightMax ' + $Release + ' focused Windows validation (the 5.11 trainer checks: the 5.10 streams against the recorded states, the counter-based training streams, thread counts, the update limit)' }
    $lines = @($title, ('Started ' + $report.started + ', ' + $report.seconds + ' s'), ('Script ran to its end: ' + $report.scriptCompleted),
      ('Physical Windows (no Wine or virtual-machine indicator): ' + $report.physicalWindows),
      ('Passed ' + $passed.Count + ', failed ' + $failed.Count + ' (gate ' + $gateFailed.Count + '), skipped ' + $skipped.Count + ', untested ' + $untested.Count), '')
    foreach ($c in $records) {
      $lines += ('[' + $c.status.ToUpper() + '] (' + $c.class + ') ' + $c.section + ' / ' + $c.name + ': ' + (Text $c.detail))
      if (($c.status -eq 'failed' -or $c.status -eq 'untested') -and $null -ne $c.evidence) { foreach ($l in (Evidence-Lines $c.evidence)) { $lines += $l } }
    }
    Write-Text $txtPath ($lines -join "`r`n")
  } catch { Write-Host ('  could not write the report: ' + $_.Exception.Message) }
}

$exitCode = 2
try {
New-Item -ItemType Directory -Path $work | Out-Null

Run-Section 'environment' {
  $os = $null; $cs = $null; $cpu = $null; $gpus = @()
  try { $os = Get-CimInstance Win32_OperatingSystem; $cs = Get-CimInstance Win32_ComputerSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 } catch {}
  # Win32_VideoController.AdapterRAM is a 32-bit field: a card with more than 4 GiB is reported as 4,095 MiB.
  try { $gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name = $_.Name; driver = $_.DriverVersion; adapterRamMiBAtMost4GiBField = [math]::Round([double]$_.AdapterRAM / 1MB) } }) } catch {}
  $smi = $null
  try { $cmd = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue; if ($cmd) { $r = Invoke-Exe $cmd.Source @('--query-gpu=name,memory.total,driver_version', '--format=csv,noheader') @{} 30; if ($r.exit -eq 0) { $smi = $r.out.Trim() } } } catch {}
  $wine = $false; try { $wine = [bool](Get-ItemProperty -Path 'HKLM:\Software\Wine' -ErrorAction SilentlyContinue) } catch {}
  $vm = $false; if ($cs) { $vm = ($cs.Model -match 'Virtual|VMware|KVM|HVM|VirtualBox') -or ($cs.Manufacturer -match 'QEMU|Xen|innotek|Parallels') }
  $arch = ''; if ($os) { $arch = [string]$os.OSArchitecture }
  $cpuName = ''; $cores = $null; if ($cpu) { $cpuName = ([string]$cpu.Name).Trim(); $cores = $cpu.NumberOfCores }
  $ram = $null; if ($cs) { $ram = [math]::Round([double]$cs.TotalPhysicalMemory / 1GB, 1) }
  $caption = [System.Environment]::OSVersion.VersionString; $osVersion = [System.Environment]::OSVersion.Version.ToString(); $osBuild = ''
  if ($os) { $caption = $os.Caption; $osVersion = $os.Version; $osBuild = $os.BuildNumber }
  $manufacturer = ''; $model = ''; if ($cs) { $manufacturer = $cs.Manufacturer; $model = $cs.Model }
  $envInfo = [ordered]@{ windows = $caption; windowsVersion = $osVersion; build = $osBuild; architecture = $arch; is64BitProcess = [Environment]::Is64BitProcess; is64BitOperatingSystem = [Environment]::Is64BitOperatingSystem
    cpu = $cpuName; physicalCores = $cores; logicalProcessors = $logical; ramGiB = $ram; gpus = $gpus; nvidiaSmi = $smi; manufacturer = $manufacturer; model = $model
    wineDetected = $wine; virtualMachineIndicators = [bool]$vm; hardwareQueriesAnswered = [bool]($os -and $cs -and $cpu); powershell = $PSVersionTable.PSVersion.ToString() }
  $report.environment = $envInfo
  Add-Check 'environment' 'machine' 'info' ('{0}; {1}; {2} logical processors; {3} GiB RAM; GPU: {4}' -f $caption, $cpuName, $logical, $ram, ((@($gpus) | ForEach-Object { $_.name }) -join ', '))
  Check 'environment' '64-bit Windows' ([Environment]::Is64BitOperatingSystem) ('64-bit operating system: ' + [Environment]::Is64BitOperatingSystem + ' ' + $arch)
  $report.physicalWindows = ((-not $wine) -and (-not $vm) -and [bool]($os -and $cs))
  if ($report.physicalWindows) { Add-Check 'environment' 'physical hardware' 'info' 'no Wine or virtual-machine indicator' }
  else { Add-Check 'environment' 'physical hardware' 'info' 'Wine or a virtual machine was detected, or the hardware queries did not answer: this report does NOT count as physical Windows validation' }
}

Run-Section 'integrity' {
  foreach ($f in @($mwcli, $hostExe, $stress)) { Check 'integrity' ((Split-Path $f -Leaf) + ' present') (Test-Path -LiteralPath $f) $f }
  $info = Read-Json (Join-Path $Root 'BUILD-INFO.json')
  if (-not $info) { Add-Check 'integrity' 'BUILD-INFO.json version' 'failed' 'BUILD-INFO.json is missing or unreadable'; return }
  $report.build = $info.build; $report.version = $info.version
  Check 'integrity' 'BUILD-INFO.json version' ($info.version -eq $Release) ([string]$info.version)
  $a = Invoke-Exe $mwcli @('--build-id') @{} 60; $b = Invoke-Exe $hostExe @('--build-id') @{} 60
  Check 'integrity' 'mwcli.exe build id' ($a.exit -eq 0 -and $a.out.Trim() -eq ('EightMaxBuild=' + $info.build)) ('exit ' + $a.exit + ': ' + $a.out.Trim() + $a.err.Trim())
  Check 'integrity' 'EightMax.exe build id' ($b.exit -eq 0 -and $b.out.Trim() -eq ('EightMaxBuild=' + $info.build)) ('exit ' + $b.exit + ': ' + $b.out.Trim() + $b.err.Trim())
  $g = Invoke-Exe $stress @() @{} 60
  Check 'integrity' 'gpustress.exe starts' ((-not $g.timedOut) -and (($g.out + $g.err) -match 'usage: gpustress')) ('exit ' + $g.exit + ' (it prints its usage and exits when given no arguments)')
  $sums = Join-Path $Root 'SHA256SUMS.txt'
  if ($SkipIntegrity) { Add-Check 'integrity' 'SHA256SUMS.txt' 'skipped' '-SkipIntegrity was given' }
  elseif (-not (Test-Path -LiteralPath $sums)) { Add-Check 'integrity' 'SHA256SUMS.txt' 'failed' 'file missing' }
  else {
    $bad = New-Object System.Collections.Generic.List[string]; $count = 0
    foreach ($line in [System.IO.File]::ReadAllLines($sums)) {
      if ($line.Length -lt 67) { continue }
      $hash = $line.Substring(0, 64); $rel = $line.Substring(66); $count++
      # the two reports of this script are written into the release folder after the manifest was made
      $p = Join-Path $Root $rel
      if (-not (Test-Path -LiteralPath $p)) { $bad.Add('missing: ' + $rel) } elseif ((Sha256 $p) -ne $hash) { $bad.Add('changed: ' + $rel) }
    }
    $shown = @($bad | Select-Object -First 10); $detail = 'every file matches (' + $count + ' files)'
    if ($bad.Count) { $detail = ('' + $bad.Count + ' of ' + $count + ' files: ' + ($shown -join '; ')) }
    Check 'integrity' 'SHA256SUMS.txt' ($bad.Count -eq 0 -and $count -gt 3000) $detail
  }
}

Run-Section 'self-test 5.7' {
  $dir = Join-Path $work 'st57'; $fixtures = Join-Path $Root 'validation\5.7\fixtures'
  $r = Invoke-Exe $mwcli @('--selftest57', $fixtures, $dir) @{} 3600
  $doc = Read-Json (Join-Path $dir 'selftest57.json')
  Check 'self-test 5.7' 'mwcli --selftest57 ran and wrote its report' ($null -ne $doc -and -not $r.timedOut) ('exit ' + $r.exit + ', ' + $r.seconds + ' s' + $(if (-not $doc) { '; no report: ' + $r.err.Trim() } else { '; passed ' + $doc.passed + ', failed ' + $doc.failed }))
  if ($doc) {
    foreach ($c in @($doc.checks)) { Check 'self-test 5.7' ('selftest57: ' + $c.name) ([bool]$c.passed) $c.detail 'gate' }
    $report.selftest57 = [ordered]@{ passed = $doc.passed; failed = $doc.failed; seconds = $doc.seconds }
  }
}

Run-Section 'golden states' {
  $dir = Join-Path $Root 'validation\5.7\windows\golden'; $g = Read-Json (Join-Path $dir 'golden.json'); $rows = @(); $bad = 0
  if (-not $g) { Add-Check 'golden states' 'every golden state reproduced' 'failed' ('golden.json is missing or unreadable in ' + $dir); return }
  foreach ($c in @($g.cases)) {
    $state = Join-Path $work ($c.name + '.state')
    $r = Invoke-Exe $mwcli @((Join-Path $dir $c.spec), [string]$c.updates, [string]$c.threads, $state, [string]$c.memoryMiB) @{} 1800
    $hash = ''; if ($r.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $hash = Sha256 $state }
    $same = ($hash -eq $c.stateSha256); if (-not $same) { $bad++ }
    $rows += [pscustomobject]@{ name = $c.name; exit = $r.exit; seconds = $r.seconds; identical = $same; sha256 = $hash; expected = $c.stateSha256; error = $r.err.Trim() }
    Check 'golden states' ('golden state ' + $c.name) $same $(if ($same) { 'identical to the 5.5 trainer (' + $r.seconds + ' s)' } else { 'exit ' + $r.exit + ', sha256 ' + $hash + ', expected ' + $c.stateSha256 + ' ' + $r.err.Trim() }) 'gate'
  }
  $report.goldenStates = $rows
  Check 'golden states' 'every golden state reproduced' ($bad -eq 0 -and $rows.Count -ge 11) ('' + ($rows.Count - $bad) + ' of ' + $rows.Count)
}

Run-Section 'threads' {
  # A frozen-batch study (64 deals per update, per-deal action streams): the only mode in which one training uses
  # several threads. EIGHTMAX_THREAD_CHOICE=fixed puts every update on all the threads of the run, so each thread
  # count is really exercised; the last run uses the measured choice and reports what it chose.
  $fixtures = Join-Path $Root 'validation\5.7\fixtures'; $golden = Read-Json (Join-Path $fixtures 'golden57.json')
  $case = $null; if ($golden) { $case = @($golden.training) | Where-Object { $_.name -eq 'flop3-kings-compact-batch64' } | Select-Object -First 1 }
  if (-not $case) { Add-Check 'threads' 'identical state for every thread count' 'failed' 'golden57.json or its flop3-kings-compact-batch64 entry is missing'; return }
  $spec = Join-Path $fixtures $case.spec
  $counts = @(@(1, 2, 4, 8, $logical) | Where-Object { $_ -le $logical } | Sort-Object -Unique); $hashes = @(); $rows = @()
  foreach ($n in $counts) {
    $state = Join-Path $work ('threads-' + $n + '.state'); $r = Invoke-Exe $mwcli @($spec, [string]$case.updates, [string]$n, $state, [string]$case.memoryMiB) @{ EIGHTMAX_THREAD_CHOICE = 'fixed' } 1800
    $h = ''; if ($r.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $h = Sha256 $state }; $hashes += $h
    $i = Parse-Json $r.out; $wall = $null; $used = $null; if ($i) { $wall = $i.wallSeconds; $used = $i.threads }
    $rows += [pscustomobject]@{ threads = $n; mode = 'every update on all threads'; exit = $r.exit; wallSeconds = $wall; threadsUsed = $used; sha256 = $h }
  }
  $state = Join-Path $work 'threads-auto.state'; $r = Invoke-Exe $mwcli @($spec, [string]$case.updates, [string]$logical, $state, [string]$case.memoryMiB) @{} 1800
  $h = ''; if ($r.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $h = Sha256 $state }; $hashes += $h
  $i = Parse-Json $r.out; $wall = $null; $chosen = $null; if ($i) { $wall = $i.wallSeconds; if ($i.threadChoice) { $chosen = $i.threadChoice.selected } }
  $rows += [pscustomobject]@{ threads = $logical; mode = 'measured thread choice'; exit = $r.exit; wallSeconds = $wall; threadsChosen = $chosen; sha256 = $h }
  $distinct = @($hashes | Sort-Object -Unique)
  Check 'threads' 'identical state for every thread count' ($distinct.Count -eq 1 -and $distinct[0] -ne '') (($counts -join ', ') + ' threads and the measured choice: ' + $distinct.Count + ' distinct state(s)')
  Check 'threads' 'state equals the 5.6 binary' ($distinct.Count -eq 1 -and $distinct[0] -eq $case.stateSha256) ('' + $distinct[0] + ' (expected ' + $case.stateSha256 + ')')
  Add-Check 'threads' 'thread scaling on this PC' 'info' (($rows | ForEach-Object { '' + $_.threads + ' threads (' + $_.mode + '): ' + $_.wallSeconds + ' s' }) -join '; ')
  $report.threadScaling = $rows
}

Run-Section 'evaluator' {
  $dir = Join-Path $Root 'validation\5.7\windows\golden'; $rows = @(); $ok = $true; $done = 0
  foreach ($name in @('g04-bubble4', 'g05-flop6', 'g06-final8')) {
    $spec = Join-Path $dir ($name + '.spec.json'); $state = Join-Path $work ($name + '.state')
    if (-not (Test-Path -LiteralPath $state)) { Add-Check 'evaluator' ($name + ': exact NashConv') 'untested' 'its golden state was not produced' 'gate'; $ok = $false; continue }
    $values = @{}
    foreach ($mem in @(32, 1024)) {
      $q = Join-Path $work ('q' + $mem + '.json'); Write-Text $q ('{"method":"exact","device":"cpu","threads":1,"timeLimitMs":900000,"maxVisits":2000000000,"memoryMiB":' + $mem + '}')
      $r = Invoke-Exe $mwcli @('--gain', $spec, $state, $q, '128') @{} 1800; $d = Parse-Json $r.out; $nc = $null; if ($d) { $nc = $d.nashConv }
      $values[$mem] = Num $nc; $rows += [pscustomobject]@{ game = $name; cacheMiB = $mem; exit = $r.exit; seconds = $r.seconds; peakMiB = $r.peakMiB; nashConv = $nc }
    }
    $same = ($values[32] -ne 'null' -and $values[32] -eq $values[1024]); if (-not $same) { $ok = $false }; $done++
    Check 'evaluator' ($name + ': exact NashConv') $same ('' + $values[32] + ' / ' + $values[1024]) 'gate'
  }
  $report.evaluator = $rows
  Check 'evaluator' 'exact NashConv with 32 and 1,024 MiB caches' ($ok -and $done -eq 3) ('' + $done + ' of 3 games evaluated with both caches')
}

Run-Section 'study' {
  $fixture = Join-Path $Root 'studies\known-akq-river.emfix.json'; $out = Join-Path $work 'known.json'
  $r = Invoke-Exe $mwcli @('--study', $fixture, $out, 'quiet=1', 'seeds=3', 'budgets=1000,100000,1000000', 'processingMode=cpu', 'checkpoint=off') @{} 1800
  $d = Read-Json $out
  Check 'study' 'study of the known game completes' ($r.exit -eq 0 -and (Study-Complete $d)) ('exit ' + $r.exit + ', ' + $r.seconds + ' s ' + $r.err.Trim())
  if (-not $d) { return }
  $v = @($d.variants)[0]; $b = @($v.budgets)[@($v.budgets).Count - 1]
  Check 'study' 'version and build in the result' ($d.version -eq $Release -and $d.build -eq $report.build) ('' + $d.version + ' ' + $d.build)
  Check 'study' 'replication statistics present' ($d.replicationCalculation -eq 'study-5.6-replication-v1' -and $null -ne $b.bestAction -and $null -ne $b.confidence.replication) ([string]$d.replicationCalculation)
  $call = @($b.actions) | Where-Object { $_.label -eq 'Call 10' } | Select-Object -First 1
  $freq = $null; $gap = $null; if ($call) { $freq = [double]$call.frequency.mean }; if ($b.gap) { $gap = [double]$b.gap.mean }
  Check 'study' 'closed form of the known game' (($null -ne $freq) -and ($null -ne $gap) -and ([math]::Abs($freq - 0.5) -lt 0.03) -and ([math]::Abs($gap) -lt 0.05)) ('call frequency ' + (Num $freq) + ' (closed form 1/2), EV gap ' + (Num $gap) + ' BB (closed form 0)')
  $report.knownGameStudy = [ordered]@{ seconds = $r.seconds; peakMiB = $r.peakMiB; callFrequency = $freq; evGapBB = $gap; verdict = $b.verdict }
}

Run-Section 'recovery' {
  $fixture = Join-Path $Root 'studies\known-akq-river.emfix.json'; $budgets = 'budgets=20000,400000,6000000'; if ($Quick) { $budgets = 'budgets=20000,400000,1500000' }
  $opts = @('seeds=2', $budgets, 'threads=2', 'quiet=1', 'processingMode=cpu')
  $ref = Join-Path $work 'ref.json'; $r = Invoke-Exe $mwcli (@('--study', $fixture, $ref) + $opts + @('checkpoint=off')) @{} 3600
  $refDoc = Read-Json $ref
  Check 'recovery' 'uninterrupted reference' ($r.exit -eq 0 -and (Study-Complete $refDoc)) ('exit ' + $r.exit + ', ' + $r.seconds + ' s ' + $r.err.Trim()) '' (Run-Evidence $r 'the uninterrupted study')
  if (-not (Study-Complete $refDoc)) { return }
  $want = Study-Points $refDoc
  # (a) time limit, then resume until complete. Every resume must add to the work that is saved, so the loop is
  # bounded by the reference run's own duration instead of by a fixed number of rounds (a slow or busy PC needs
  # more rounds, not a different result).
  $ck = Join-Path $work 'ck-time'; $out = Join-Path $work 'time.json'; $rounds = 0; $limitSeconds = 0.5
  $maxRounds = [int][math]::Max(60, [math]::Ceiling(8 * $r.seconds / $limitSeconds) + 40)
  $r1 = Invoke-Exe $mwcli (@('--study', $fixture, $out) + $opts + @(('checkpoint=' + $ck), ('timeLimitSeconds=' + $limitSeconds), 'checkpointSeconds=0.1')) @{} 600
  $doc = Read-Json $out; $firstComplete = Study-Complete $doc; $lastExit = $r1.exit; $lastRun = $r1
  while ($doc -and -not (Study-Complete $doc) -and $rounds -lt $maxRounds) {
    $rounds++; $rr = Invoke-Exe $mwcli (@('--study', $fixture, $out) + $opts + @(('checkpoint=' + $ck), 'resume=1', ('timeLimitSeconds=' + $limitSeconds), 'checkpointSeconds=0.1')) @{} 600
    $lastExit = $rr.exit; $lastRun = $rr; $doc = Read-Json $out
  }
  $equal = ((Study-Points $doc) -eq $want)
  # 5.7.1: a study that finished inside its first time limit was never interrupted, so nothing was resumed. 5.7
  # passed that case; it is now reported as untested with the reason (it cannot happen unless the PC is far faster
  # than the one this was written for: the limit is 0.5 s and the reference study took over a second there).
  $timeDetail = ('first run complete: ' + $firstComplete + '; resumes: ' + $rounds + ' of at most ' + $maxRounds + '; complete: ' + (Study-Complete $doc) + '; equals the uninterrupted study: ' + $equal + '; last exit ' + $lastExit)
  if ($firstComplete) { Add-Check 'recovery' 'time-limit interruption and resume' 'untested' ('the study finished inside its ' + $limitSeconds + ' s time limit, so there was no interruption to resume from; ' + $timeDetail) '' (Run-Evidence $r1 'the first, time-limited run') }
  else { Check 'recovery' 'time-limit interruption and resume' ((Study-Complete $doc) -and $equal -and $rounds -ge 1) $timeDetail '' (Run-Evidence $lastRun 'the last resume') }
  # (b) a second process is refused while the first runs; the first is killed; resume completes the study
  $ck2 = Join-Path $work 'ck-kill'; $out2 = Join-Path $work 'kill.json'
  $p = Start-Child $mwcli (@('--study', $fixture, $out2) + $opts + @(('checkpoint=' + $ck2), 'checkpointSeconds=0.1'))
  $waited = 0; while (-not (Test-Path -LiteralPath (Join-Path $ck2 'manifest.json')) -and $waited -lt 400 -and -not $p.HasExited) { Start-Sleep -Milliseconds 50; $waited++ }
  if ($p.HasExited) { Add-Check 'recovery' 'second process refused while the first runs' 'skipped' 'the first study finished before the second could be started (a very fast PC); run without -Quick' }
  else {
    $second = Invoke-Exe $mwcli (@('--study', $fixture, (Join-Path $work 'second.json')) + $opts + @(('checkpoint=' + $ck2), 'resume=1')) @{} 600
    if ($p.HasExited) { Add-Check 'recovery' 'second process refused while the first runs' 'skipped' 'the first study finished during the attempt' }
    else { Check 'recovery' 'second process refused while the first runs' ($second.exit -ne 0 -and (($second.err + $second.out) -match 'in use')) ('exit ' + $second.exit + ': ' + $second.err.Trim()) '' (Run-Evidence $second 'the second process') }
  }
  $killed = (-not $p.HasExited); Stop-Child $p
  $r3 = Invoke-Exe $mwcli (@('--study', $fixture, $out2) + $opts + @(('checkpoint=' + $ck2), 'resume=1')) @{} 3600
  $done2 = Read-Json $out2
  # 5.7.1: the resume must really have followed a kill. If the first process had already finished there was nothing
  # to recover, and the check says so instead of passing.
  $killDetail = ('the first process was killed while running: ' + $killed + '; resume exit ' + $r3.exit + ' ' + $r3.err.Trim())
  if (-not $killed) { Add-Check 'recovery' 'killed process, then resume' 'untested' ('the first study had finished before it could be killed, so no interrupted checkpoint was resumed; ' + $killDetail) '' (Run-Evidence $r3 'the resume') }
  else { Check 'recovery' 'killed process, then resume' ($r3.exit -eq 0 -and (Study-Complete $done2) -and ((Study-Points $done2) -eq $want)) $killDetail '' (Run-Evidence $r3 'the resume after the kill') }
  # (c) 5.7 changed white space in manifest.json here and expected a refusal. That is not damage (the checksum covers
  # the manifest's data, not its formatting) and the check is gone; real damage is tested in section 9.
}

Run-Section 'self-test 5.7.1' {
  # Checkpoint integrity and the process memory budget, tested by mwcli itself: every study is a separate mwcli
  # process, every corruption is made on a copy inside this run's temporary folder, and each check says whether the
  # condition it is about was really produced. This section records what the report says, check by check, and adds
  # nothing of its own to the verdicts.
  $dir = Join-Path $work 'st571'; $studies = Join-Path $Root 'studies'
  $r = Invoke-Exe $mwcli @('--selftest571', $studies, $dir, 'all') @{} 3600
  $reportFile = Join-Path $dir 'selftest571.json'; $written = Test-Path -LiteralPath $reportFile
  $doc = Read-Json $reportFile
  $ran = ($null -ne $doc -and -not $r.timedOut -and $null -ne $doc.checks)
  $ranDetail = 'exit ' + $r.exit + ', ' + $r.seconds + ' s; report file written: ' + $written
  if ($ran) { $ranDetail += '; passed ' + $doc.passed + ', failed ' + $doc.failed + ', untested ' + $doc.untested } else { $ranDetail += '; no readable report: ' + $r.err.Trim() }
  Check 'self-test 5.7.1' 'mwcli --selftest571 ran and wrote its report' $ran $ranDetail '' (Run-Evidence $r 'mwcli --selftest571')
  if (-not $ran) { return }
  $report.selftest571 = $doc
  $labels = @{ checkpoint = 'checkpoint integrity'; memory = 'memory budget'; controls = 'verdict controls' }
  $seen = @{}; $notPassed = 0
  foreach ($c in @($doc.checks)) {
    $label = [string]$c.section; if ($labels.ContainsKey($label)) { $label = $labels[$label] }
    $status = [string]$c.status; if (@('passed', 'failed', 'untested') -notcontains $status) { $status = 'failed' }
    if ($status -ne 'passed') { $notPassed++ }
    $seen[([string]$c.section + ' ' + [string]$c.id)] = $true
    # the evidence of the check itself and, when it did not pass, of every process it ran
    $ev = [ordered]@{ id = [string]$c.id; exercisedTheIntendedCondition = [bool]$c.exercised; evidence = $c.evidence }
    if ($status -ne 'passed') {
      $wanted = @($c.steps); $runs = @()
      foreach ($s in @($doc.steps)) { if ($wanted -contains $s.label) { $runs += [ordered]@{ process = $s.label; command = $s.command; exitCode = $s.exitCode; timedOut = $s.timedOut; resultFileWritten = $s.resultFileWritten; errorClassification = $s.errorClassification; standardOutput = $s.stdout; standardError = $s.stderr } } }
      $ev.processes = $runs
    }
    Add-Check $label ([string]$c.id + ': ' + [string]$c.name) $status ([string]$c.detail) 'gate' $ev
  }
  # every check the 5.7.1 release defines must be there: a report that is shorter than expected is not a pass
  $expected = @('checkpoint P', 'checkpoint A', 'checkpoint B1', 'checkpoint B2', 'checkpoint C1', 'checkpoint C2', 'checkpoint D1', 'checkpoint D2', 'checkpoint E1', 'checkpoint E2', 'checkpoint F1', 'checkpoint F2', 'checkpoint F3', 'checkpoint S',
    'memory E', 'memory A', 'memory B', 'memory C', 'memory D1', 'memory D2', 'controls N1', 'controls N2', 'controls N3', 'controls N4')
  $missing = @($expected | Where-Object { -not $seen.ContainsKey($_) })
  foreach ($m in $missing) { Add-Check 'self-test 5.7.1' ('expected check ' + $m) 'untested' 'this check is not in the report of mwcli --selftest571' 'gate' }
  $missingText = 'none'; if ($missing.Count) { $missingText = ($missing -join ', ') }
  Check 'self-test 5.7.1' 'every expected 5.7.1 check is in the report' ($missing.Count -eq 0) ('' + ($expected.Count - $missing.Count) + ' of ' + $expected.Count + ' expected checks reported; missing: ' + $missingText)
  # mwcli exits with 0 only when every check passed; the report and the exit status must tell the same story
  $agree = (($r.exit -eq 0) -eq ($notPassed -eq 0 -and $missing.Count -eq 0)) -and (([int]$doc.failed + [int]$doc.untested) -eq $notPassed)
  Check 'self-test 5.7.1' 'the report agrees with the exit status of mwcli' $agree ('exit ' + $r.exit + '; checks not passed in the report: ' + $notPassed + ' (failed ' + $doc.failed + ', untested ' + $doc.untested + ')')
}

Run-Section 'self-test 5.8' {
  # The mathematics added in 5.8, tested by mwcli itself (see source\native\mwcli_selftest58.hpp). This section
  # records what the report says, check by check, and adds nothing of its own to the verdicts.
  $dir = Join-Path $work 'st58'; $studies = Join-Path $Root 'studies'
  $r = Invoke-Exe $mwcli @('--selftest58', $studies, $dir, 'all') @{} 3600
  $reportFile = Join-Path $dir 'selftest58.json'; $written = Test-Path -LiteralPath $reportFile
  $doc = Read-Json $reportFile
  $ran = ($null -ne $doc -and -not $r.timedOut -and $null -ne $doc.checks)
  $ranDetail = 'exit ' + $r.exit + ', ' + $r.seconds + ' s; report file written: ' + $written
  if ($ran) { $ranDetail += '; passed ' + $doc.passed + ', failed ' + $doc.failed + ', untested ' + $doc.untested } else { $ranDetail += '; no readable report: ' + $r.err.Trim() }
  Check 'self-test 5.8' 'mwcli --selftest58 ran and wrote its report' $ran $ranDetail '' (Run-Evidence $r 'mwcli --selftest58')
  if (-not $ran) { return }
  $report.selftest58 = $doc
  $labels = @{ engine = 'engine 5.8'; response = 'trained response (self-test)'; limits = 'large-study limit' }
  $seen = @{}; $notPassed = 0
  foreach ($c in @($doc.checks)) {
    $label = [string]$c.section; if ($labels.ContainsKey($label)) { $label = $labels[$label] }
    $status = [string]$c.status; if (@('passed', 'failed', 'untested') -notcontains $status) { $status = 'failed' }
    if ($status -ne 'passed') { $notPassed++ }
    $seen[([string]$c.section + ' ' + [string]$c.id)] = $true
    Add-Check $label ([string]$c.id + ': ' + [string]$c.name) $status ([string]$c.detail) 'gate' ([ordered]@{ id = [string]$c.id })
  }
  # every check the 5.8 release defines must be there: a report that is shorter than expected is not a pass
  $expected = @('engine E1', 'engine E2', 'engine E3', 'engine E4', 'response life-cycle')
  foreach ($f in @('known-akq-river', 'flop3-kings-small', 'flop6-jack-small', 'icm8-bb-call-small')) { foreach ($k in @('R1', 'R2', 'R3', 'R4', 'R5', 'R6')) { $expected += ('response ' + $f + ' ' + $k) } }
  $expected += @('limits L1', 'limits L2', 'limits L3', 'limits L4')
  $missing = @($expected | Where-Object { -not $seen.ContainsKey($_) })
  foreach ($m in $missing) { Add-Check 'self-test 5.8' ('expected check ' + $m) 'untested' 'this check is not in the report of mwcli --selftest58' 'gate' }
  $missingText = 'none'; if ($missing.Count) { $missingText = ($missing -join ', ') }
  Check 'self-test 5.8' 'every expected 5.8 check is in the report' ($missing.Count -eq 0) ('' + ($expected.Count - $missing.Count) + ' of ' + $expected.Count + ' expected checks reported; missing: ' + $missingText)
  $agree = (($r.exit -eq 0) -eq ($notPassed -eq 0 -and $missing.Count -eq 0)) -and (([int]$doc.failed + [int]$doc.untested) -eq $notPassed)
  Check 'self-test 5.8' 'the 5.8 report agrees with the exit status of mwcli' $agree ('exit ' + $r.exit + '; checks not passed in the report: ' + $notPassed + ' (failed ' + $doc.failed + ', untested ' + $doc.untested + ')')
}

Run-Section 'self-test 5.9' {
  # What 5.9 added to the mathematics of the trained response, tested by mwcli itself (see
  # source\native\mwcli_selftest59.hpp). This section records what the report says, check by check, and adds nothing
  # of its own to the verdicts.
  $dir = Join-Path $work 'st59'; $studies = Join-Path $Root 'studies'
  $r = Invoke-Exe $mwcli @('--selftest59', $studies, $dir, 'all') @{} 3600
  $reportFile = Join-Path $dir 'selftest59.json'; $written = Test-Path -LiteralPath $reportFile
  $doc = Read-Json $reportFile
  $ran = ($null -ne $doc -and -not $r.timedOut -and $null -ne $doc.checks)
  $ranDetail = 'exit ' + $r.exit + ', ' + $r.seconds + ' s; report file written: ' + $written
  if ($ran) { $ranDetail += '; passed ' + $doc.passed + ', failed ' + $doc.failed + ', untested ' + $doc.untested } else { $ranDetail += '; no readable report: ' + $r.err.Trim() }
  Check 'self-test 5.9' 'mwcli --selftest59 ran and wrote its report' $ran $ranDetail '' (Run-Evidence $r 'mwcli --selftest59')
  if (-not $ran) { return }
  $report.selftest59 = $doc
  $labels = @{ engine = 'engine 5.9'; statistics = 'statistics 5.9'; response = 'response 5.9 (self-test)' }
  $seen = @{}; $notPassed = 0
  foreach ($c in @($doc.checks)) {
    $label = [string]$c.section; if ($labels.ContainsKey($label)) { $label = $labels[$label] }
    $status = [string]$c.status; if (@('passed', 'failed', 'untested') -notcontains $status) { $status = 'failed' }
    if ($status -ne 'passed') { $notPassed++ }
    $seen[([string]$c.section + ' ' + [string]$c.id)] = $true
    Add-Check $label ([string]$c.id + ': ' + [string]$c.name) $status ([string]$c.detail) 'gate' ([ordered]@{ id = [string]$c.id })
  }
  # every check the 5.9 release defines must be there: a report that is shorter than expected is not a pass
  $expected = @('engine E1', 'engine E2', 'engine E3', 'statistics S1', 'statistics S2', 'statistics S3', 'statistics S4', 'statistics S5', 'statistics S6')
  foreach ($f in @('known-akq-river', 'flop3-kings-small', 'flop6-jack-small', 'icm8-bb-call-small')) { foreach ($k in @('R1', 'R2', 'R3', 'R6')) { $expected += ('response ' + $f + ' ' + $k) } }
  $expected += @('response known-akq-river R4', 'response flop3-kings-small R4', 'response known-akq-river R5', 'response flop6-jack-small R5', 'response incomplete', 'response family', 'response requests')
  $missing = @($expected | Where-Object { -not $seen.ContainsKey($_) })
  foreach ($m in $missing) { Add-Check 'self-test 5.9' ('expected check ' + $m) 'untested' 'this check is not in the report of mwcli --selftest59' 'gate' }
  $missingText = 'none'; if ($missing.Count) { $missingText = ($missing -join ', ') }
  Check 'self-test 5.9' 'every expected 5.9 check is in the report' ($missing.Count -eq 0) ('' + ($expected.Count - $missing.Count) + ' of ' + $expected.Count + ' expected checks reported; missing: ' + $missingText)
  $agree = (($r.exit -eq 0) -eq ($notPassed -eq 0 -and $missing.Count -eq 0)) -and (([int]$doc.failed + [int]$doc.untested) -eq $notPassed)
  Check 'self-test 5.9' 'the 5.9 report agrees with the exit status of mwcli' $agree ('exit ' + $r.exit + '; checks not passed in the report: ' + $notPassed + ' (failed ' + $doc.failed + ', untested ' + $doc.untested + ')')
}

Run-Section 'trained response' {
  # Reference games small enough for exact values: this PC must compute, bit for bit, what the Linux build recorded.
  # Training, response training and both evaluations use only IEEE 754 additions, multiplications, divisions,
  # square roots and comparisons, and the random numbers are integer arithmetic, so the bits do not depend on the
  # platform. (The logarithm inside a confidence bound is the C library's: the summary bounds are compared bit for
  # bit as well, and a difference there alone would name the C library, not the measure.)
  #   golden59.json  the 5.9 streams: estimate, sample variance, exact gain and exact best-response gain of every
  #                  seat, and the four bounds of the summary
  #   golden58.json  the 5.8 streams (request-58-streams.json): the bits the 5.8 release recorded
  $dir = Join-Path $Root 'validation\5.9\windows\response'; $g = Read-Json (Join-Path $dir 'golden59.json'); $rows = @(); $bad = 0; $parallelBad = 0; $parallelRuns = 0; $statementsBad = 0; $statementRuns = 0
  if (-not $g) { Add-Check 'trained response' 'every 5.9 reference response reproduced' 'failed' ('golden59.json is missing or unreadable in ' + $dir); return }
  $states = @{}
  foreach ($c in @($g.cases)) {
    $spec = Join-Path $dir $c.spec; $state = Join-Path $work ($c.name + '.r59.state'); $request = Join-Path $dir $c.request
    $t = Invoke-Exe $mwcli @($spec, [string]$c.updates, '1', $state, [string]$c.memoryMiB) @{} 1800
    $hash = ''; if ($t.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $hash = Sha256 $state }
    $r = $null; $doc = $null; $got = @(); $sum = @(); $same = $false
    if ($hash -eq $c.stateSha256) {
      $states[[string]$c.name] = $state
      $r = Invoke-Exe $mwcli @('--response', $spec, $state, $request, [string]$c.memoryMiB) @{} 3600
      $doc = Parse-Json $r.out
      if ($r.exit -eq 0 -and $doc -and $doc.seats) {
        foreach ($s in @($doc.seats)) { $got += ([string]$s.seat + ':' + [string]$s.sampled.gain.gainBits + ':' + [string]$s.sampled.statistics.sampleVarianceBits + ':' + [string]$s.exact.gainBits + ':' + [string]$s.exact.bestResponseGainBits) }
        $sum = @([string]$doc.summary.simultaneous.bits.sumOfResponseGainsLowerBound, [string]$doc.summary.simultaneous.bits.nashConvLowerBound, [string]$doc.summary.pooledIndependent.bits.sumOfResponseGainsLowerBound, [string]$doc.summary.pooledIndependent.bits.bestSubset)
        $same = ((($got -join ' ') -eq (@($c.seatBits) -join ' ')) -and (($sum -join ' ') -eq (@($c.summaryBits) -join ' ')))
        $statementRuns++
        $a = $doc.summary.againstExact
        if (-not ($a -and $a.simultaneousHolds -eq $true -and $a.simultaneousNashConvBoundHolds -eq $true -and $a.pooledAllSeatsHolds -eq $true -and $a.pooledBestSubsetHolds -eq $true -and $a.seatBoundsHolding -eq $a.seatBoundsChecked)) { $statementsBad++ }
      }
    }
    if (-not $same) { $bad++ }
    $detail = 'identical to the Linux build (' + $got.Count + ' seats, 4 summary bounds)'
    if (-not $same) {
      $detail = 'training exit ' + $t.exit + ', state sha256 ' + $hash + ' (expected ' + $c.stateSha256 + ')'
      if ($r) { $detail += '; response exit ' + $r.exit + '; got ' + ($got -join ' ') + ' | ' + ($sum -join ' ') + '; expected ' + (@($c.seatBits) -join ' ') + ' | ' + (@($c.summaryBits) -join ' ') + ' ' + $r.err.Trim() } else { $detail += '; ' + $t.err.Trim() }
    }
    $ev = $null; if (-not $same) { if ($r) { $ev = Run-Evidence $r 'mwcli --response' } else { $ev = Run-Evidence $t 'mwcli (training)' } }
    Check 'trained response' ('5.9 reference response ' + $c.name) $same $detail 'gate' $ev
    $rows += [pscustomobject]@{ name = $c.name; streams = '5.9'; identical = $same; stateSha256 = $hash; seatBits = $got; summaryBits = $sum }
    # the same request with the seats handled side by side
    if ($same -and $c.parallelRequest) {
      $parallelRuns++
      $p = Invoke-Exe $mwcli @('--response', $spec, $state, (Join-Path $dir $c.parallelRequest), [string]$c.memoryMiB) @{} 3600
      $pd = Parse-Json $p.out; $pg = @()
      if ($p.exit -eq 0 -and $pd -and $pd.seats) { foreach ($s in @($pd.seats)) { $pg += ([string]$s.seat + ':' + [string]$s.sampled.gain.gainBits + ':' + [string]$s.sampled.statistics.sampleVarianceBits + ':' + [string]$s.exact.gainBits + ':' + [string]$s.exact.bestResponseGainBits) } }
      if (($pg -join ' ') -ne ($got -join ' ')) { $parallelBad++ }
    }
  }
  Check 'trained response' 'every 5.9 reference response reproduced' ($bad -eq 0 -and $rows.Count -ge 4) ('' + ($rows.Count - $bad) + ' of ' + $rows.Count)
  Check 'trained response' 'parallel seats give the same bits' ($parallelBad -eq 0 -and $parallelRuns -ge 1) ('' + ($parallelRuns - $parallelBad) + ' of ' + $parallelRuns + ' requests with parallelSeats gave the bits of the sequential request')
  Check 'trained response' 'every statement of the references holds against the exact values' ($statementsBad -eq 0 -and $statementRuns -ge 4) ('' + ($statementRuns - $statementsBad) + ' of ' + $statementRuns + ' results: every seat bound, the simultaneous bounds and the pooled bounds are at most the exact values')
  # the 5.8 references, with the 5.8 streams
  $dir58 = Join-Path $Root 'validation\5.8\windows\response'; $g58 = Read-Json (Join-Path $dir58 'golden58.json'); $bad58 = 0; $n58 = 0; $legacy = Join-Path $dir 'request-58-streams.json'
  if (-not $g58) { Add-Check 'trained response' 'the 5.8 streams reproduce the 5.8 reference responses' 'failed' ('golden58.json is missing or unreadable in ' + $dir58) }
  else {
    foreach ($c in @($g58.cases)) {
      $n58++; $spec = Join-Path $dir58 $c.spec; $state = Join-Path $work ($c.name + '.r58.state')
      $t = Invoke-Exe $mwcli @($spec, [string]$c.updates, '1', $state, [string]$c.memoryMiB) @{} 1800
      $hash = ''; if ($t.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $hash = Sha256 $state }
      $got = @(); $r = $null
      if ($hash -eq $c.stateSha256) {
        $r = Invoke-Exe $mwcli @('--response', $spec, $state, $legacy, [string]$c.memoryMiB) @{} 3600; $doc = Parse-Json $r.out
        if ($r.exit -eq 0 -and $doc -and $doc.seats) { foreach ($s in @($doc.seats)) { $got += ([string]$s.seat + ':' + [string]$s.sampled.gain.gainBits + ':' + [string]$s.exact.gainBits + ':' + [string]$s.exact.bestResponseGainBits) } }
      }
      $same = (($got.Count -gt 0) -and (($got -join ' ') -eq (@($c.seatBits) -join ' ')))
      if (-not $same) { $bad58++; $ev = $null; if ($r) { $ev = Run-Evidence $r 'mwcli --response (5.8 streams)' } else { $ev = Run-Evidence $t 'mwcli (training)' }
        Add-Check 'trained response' ('5.8 reference response ' + $c.name) 'failed' ('state sha256 ' + $hash + ' (expected ' + $c.stateSha256 + '); got ' + ($got -join ' ') + '; expected ' + (@($c.seatBits) -join ' ')) 'gate' $ev }
      $rows += [pscustomobject]@{ name = $c.name; streams = '5.8'; identical = $same; stateSha256 = $hash; seatBits = $got }
    }
    Check 'trained response' 'the 5.8 streams reproduce the 5.8 reference responses' ($bad58 -eq 0 -and $n58 -ge 4) ('' + ($n58 - $bad58) + ' of ' + $n58 + ' reference responses of the 5.8 release reproduced with {"randomStreams":"5.8"}')
  }
  $report.trainedResponse = $rows
}

Run-Section 'self-test 5.10' {
  # What 5.10 added to the trainer, tested by mwcli itself (see source\native\mwcli_selftest510.hpp). This section
  # records what the report says, check by check, and adds nothing of its own to the verdicts.
  $dir = Join-Path $work 'st510'; $studies = Join-Path $Root 'studies'
  $r = Invoke-Exe $mwcli @('--selftest510', $studies, $dir, 'all') @{} 3600
  $reportFile = Join-Path $dir 'selftest510.json'; $written = Test-Path -LiteralPath $reportFile
  $doc = Read-Json $reportFile
  $ran = ($null -ne $doc -and -not $r.timedOut -and $null -ne $doc.checks)
  $ranDetail = 'exit ' + $r.exit + ', ' + $r.seconds + ' s; report file written: ' + $written
  if ($ran) { $ranDetail += '; passed ' + $doc.passed + ', failed ' + $doc.failed + ', untested ' + $doc.untested } else { $ranDetail += '; no readable report: ' + $r.err.Trim() }
  Check 'self-test 5.10' 'mwcli --selftest510 ran and wrote its report' $ran $ranDetail '' (Run-Evidence $r 'mwcli --selftest510')
  if (-not $ran) { return }
  $report.selftest510 = $doc
  $labels = @{ estimator = 'estimator 5.10 (self-test)'; training = 'training 5.10 (self-test)'; checkpoint = 'checkpoint 5.10 (self-test)'; limits = 'limits 5.10 (self-test)' }
  $seen = @{}; $notPassed = 0
  foreach ($c in @($doc.checks)) {
    $label = [string]$c.section; if ($labels.ContainsKey($label)) { $label = $labels[$label] }
    $status = [string]$c.status; if (@('passed', 'failed', 'untested') -notcontains $status) { $status = 'failed' }
    if ($status -ne 'passed') { $notPassed++ }
    $seen[([string]$c.section + ' ' + [string]$c.id)] = $true
    Add-Check $label ([string]$c.id + ': ' + [string]$c.name) $status ([string]$c.detail) 'gate' ([ordered]@{ id = [string]$c.id })
  }
  # every check the 5.10 release defines must be there: a report that is shorter than expected is not a pass
  $expected = @('estimator X1', 'estimator X2', 'estimator X3', 'estimator X4', 'estimator X5', 'estimator X6', 'estimator X7', 'estimator X8',
                'training D1', 'training D2', 'training R1', 'training R2', 'training R3', 'training R4', 'training R5', 'training R6',
                'checkpoint C1', 'checkpoint C2', 'checkpoint C3', 'limits L1', 'limits L2')
  $missing = @($expected | Where-Object { -not $seen.ContainsKey($_) })
  foreach ($m in $missing) { Add-Check 'self-test 5.10' ('expected check ' + $m) 'untested' 'this check is not in the report of mwcli --selftest510' 'gate' }
  $missingText = 'none'; if ($missing.Count) { $missingText = ($missing -join ', ') }
  Check 'self-test 5.10' 'every expected 5.10 check is in the report' ($missing.Count -eq 0) ('' + ($expected.Count - $missing.Count) + ' of ' + $expected.Count + ' expected checks reported; missing: ' + $missingText)
  $agree = (($r.exit -eq 0) -eq ($notPassed -eq 0 -and $missing.Count -eq 0)) -and (([int]$doc.failed + [int]$doc.untested) -eq $notPassed)
  Check 'self-test 5.10' 'the 5.10 report agrees with the exit status of mwcli' $agree ('exit ' + $r.exit + '; checks not passed in the report: ' + $notPassed + ' (failed ' + $doc.failed + ', untested ' + $doc.untested + ')')
}

Run-Section 'estimator 5.10' {
  # The experimental estimator on this PC. Frozen batches (64 deals per update, per-deal action streams) are the mode
  # in which one training uses several threads; EIGHTMAX_THREAD_CHOICE=fixed puts every update on all the threads of
  # the run, so each thread count is really exercised. The state must be the one the Linux build of this release
  # wrote (validation\5.10\windows\estimator\reference.json): the estimator promises the same bytes on every platform.
  $dir = Join-Path $Root 'validation\5.10\windows\estimator'; $ref = Read-Json (Join-Path $dir 'reference.json')
  if (-not $ref) { Add-Check 'estimator 5.10' 'identical rbes state for every thread count' 'failed' 'validation\5.10\windows\estimator\reference.json is missing or unreadable'; return }
  $case = $ref.threads; $spec = Join-Path $dir ([string]$case.spec)
  $counts = @(@(1, 2, 4, 8, $logical) | Where-Object { $_ -le $logical } | Sort-Object -Unique); $hashes = @(); $rows = @()
  foreach ($n in $counts) {
    $state = Join-Path $work ('rbes-threads-' + $n + '.state'); $r = Invoke-Exe $mwcli @($spec, [string]$case.updates, [string]$n, $state, [string]$case.memoryMiB) @{ EIGHTMAX_THREAD_CHOICE = 'fixed' } 1800
    $h = ''; if ($r.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $h = Sha256 $state }; $hashes += $h
    $i = Parse-Json $r.out; $wall = $null; if ($i) { $wall = $i.wallSeconds }
    $rows += [pscustomobject]@{ threads = $n; mode = 'every update on all threads'; exit = $r.exit; wallSeconds = $wall; sha256 = $h }
  }
  $state = Join-Path $work 'rbes-threads-auto.state'; $r = Invoke-Exe $mwcli @($spec, [string]$case.updates, [string]$logical, $state, [string]$case.memoryMiB) @{} 1800
  $h = ''; if ($r.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $h = Sha256 $state }; $hashes += $h
  $i = Parse-Json $r.out; $wall = $null; $chosen = $null; if ($i) { $wall = $i.wallSeconds; if ($i.threadChoice) { $chosen = $i.threadChoice.selected } }
  $rows += [pscustomobject]@{ threads = $logical; mode = 'measured thread choice'; exit = $r.exit; wallSeconds = $wall; threadsChosen = $chosen; sha256 = $h }
  $distinct = @($hashes | Sort-Object -Unique)
  Check 'estimator 5.10' 'identical rbes state for every thread count' ($distinct.Count -eq 1 -and $distinct[0] -ne '') (($counts -join ', ') + ' threads and the measured choice: ' + $distinct.Count + ' distinct state(s)')
  Check 'estimator 5.10' 'rbes state equals the Linux build' ($distinct.Count -eq 1 -and $distinct[0] -eq [string]$case.stateSha256) ('' + $distinct[0] + ' (expected ' + $case.stateSha256 + ')')
  Add-Check 'estimator 5.10' 'rbes thread scaling on this PC' 'info' (($rows | ForEach-Object { '' + $_.threads + ' threads (' + $_.mode + '): ' + $_.wallSeconds + ' s' }) -join '; ')
  $report.rbesThreadScaling = $rows
  # CPU Only, Automatic, Hybrid and GPU-Preferred. The traversal of rbes runs on the CPU in every mode; what a mode
  # decides is where the showdowns of a batch are scored (the scheduler of the default trainer, unchanged). With an
  # NVIDIA GPU the last two modes open CUDA; without one they fall back to the CPU. The state must be the reference
  # state either way. The spec is the reference spec with a "device" field put in front (it has none).
  $text = [System.IO.File]::ReadAllText($spec); $mh = @(); $ml = @(); $modes = @()
  foreach ($mode in @('cpu', 'auto', 'hybrid', 'gpu')) {
    $ms = Join-Path $work ('rbes-mode-' + $mode + '.spec.json'); $state = Join-Path $work ('rbes-mode-' + $mode + '.state')
    $at = $text.IndexOf('{'); Write-Text $ms ($text.Substring(0, $at + 1) + '"device":"' + $mode + '",' + $text.Substring($at + 1))
    $r = Invoke-Exe $mwcli @($ms, [string]$case.updates, '4', $state, [string]$case.memoryMiB) @{} 1800
    $h = ''; if ($r.exit -eq 0 -and (Test-Path -LiteralPath $state)) { $h = Sha256 $state }; $mh += $h
    $i = Parse-Json $r.out; $decision = ''; $opened = $null; if ($i -and $i.scheduling) { $decision = [string]$i.scheduling.decision; $opened = $i.scheduling.cudaOpenedThisCall }
    $ml += ('' + $mode + ': ' + $decision + ' (CUDA opened: ' + $opened + ')'); $modes += [pscustomobject]@{ mode = $mode; exit = $r.exit; sha256 = $h; decision = $decision; cudaOpened = $opened }
  }
  $md = @($mh | Sort-Object -Unique)
  Check 'estimator 5.10' 'rbes: every processing mode writes the same state' ($md.Count -eq 1 -and $md[0] -eq [string]$case.stateSha256) ('cpu, auto, hybrid, gpu: ' + $md.Count + ' distinct state(s); ' + $md[0] + ' (expected ' + $case.stateSha256 + ')')
  Add-Check 'estimator 5.10' 'rbes processing modes on this PC' 'info' ($ml -join '; ')
  $report.rbesProcessingModes = $modes
  # the exact check of the estimator on a table trained by this program on this PC
  $x = $ref.exactCheck; $xs = Join-Path $dir ([string]$x.spec)
  $r = Invoke-Exe $mwcli @('--estimator-check', $xs, [string]$x.updates, [string]$x.deals) @{} 1800
  $d = Parse-Json $r.out
  $okx = ($r.exit -eq 0 -and $null -ne $d -and [bool]$d.passed -and [double]$d.largestDifferenceOverScale -le 1e-11 -and [long]$d.entriesCompared -gt 0)
  $dx = 'exit ' + $r.exit; if ($d) { $dx += '; ' + $d.deals + ' deals, ' + $d.traversalOutcomesEnumerated + ' traversal outcomes enumerated, ' + $d.entriesCompared + ' table entries compared; largest difference / scale ' + $d.largestDifferenceOverScale + ' (tolerance 1e-11); production against reference walk ' + $d.largestProductionReferenceDifferenceOverScale } else { $dx += '; ' + $r.err.Trim() }
  Check 'estimator 5.10' 'exact check of the estimator on a table trained on this PC' $okx $dx '' (Run-Evidence $r 'mwcli --estimator-check')
  # deals per second of both trainers (information: this PC's numbers, one thread and all threads)
  $lines = @(); $tp = @()
  foreach ($t in @($ref.throughput)) {
    foreach ($arm in @('default', 'rbes')) {
      $sf = Join-Path $dir ([string]$t.($arm + 'Spec')); $st = Join-Path $work ('tp-' + $arm + '.state'); $upd = [string]$t.($arm + 'Updates')
      foreach ($n in @(1, $logical)) {
        $r = Invoke-Exe $mwcli @($sf, $upd, [string]$n, $st, '2048') @{} 1800; $i = Parse-Json $r.out
        if ($r.exit -eq 0 -and $i -and [double]$i.wallSeconds -gt 0) {
          $rate = [math]::Round([double]$i.trainingDeals / [double]$i.wallSeconds); $lines += ('' + $t.name + ', ' + $arm + ', ' + $n + ' thread(s) offered: ' + $rate + ' sampled deals per second (' + $i.rows + ' rows)')
          $tp += [pscustomobject]@{ fixture = [string]$t.name; trainer = $arm; threadsOffered = $n; deals = $i.trainingDeals; wallSeconds = $i.wallSeconds; dealsPerSecond = $rate; rows = $i.rows; tableMiB = $i.tableMiB; processPeakRssMiB = $i.processPeakRssMiB }
        } else { $lines += ('' + $t.name + ', ' + $arm + ', ' + $n + ' thread(s): exit ' + $r.exit) }
      }
    }
  }
  Add-Check 'estimator 5.10' 'default and rbes training throughput on this PC' 'info' ($lines -join '; ')
  $report.estimatorThroughput = $tp
}

Run-Section 'self-test 5.11' {
  # What 5.11 added to the trainer, tested by mwcli itself (see source\native\mwcli_selftest511.hpp). This section
  # records what the report says, check by check, and adds nothing of its own to the verdicts.
  $dir = Join-Path $work 'st511'; $studies = Join-Path $Root 'studies'
  $r = Invoke-Exe $mwcli @('--selftest511', $studies, $dir, 'all') @{} 3600
  $reportFile = Join-Path $dir 'selftest511.json'; $written = Test-Path -LiteralPath $reportFile
  $doc = Read-Json $reportFile
  $ran = ($null -ne $doc -and -not $r.timedOut -and $null -ne $doc.checks)
  $ranDetail = 'exit ' + $r.exit + ', ' + $r.seconds + ' s; report file written: ' + $written
  if ($ran) { $ranDetail += '; passed ' + $doc.passed + ', failed ' + $doc.failed + ', untested ' + $doc.untested } else { $ranDetail += '; no readable report: ' + $r.err.Trim() }
  Check 'self-test 5.11' 'mwcli --selftest511 ran and wrote its report' $ran $ranDetail '' (Run-Evidence $r 'mwcli --selftest511')
  if (-not $ran) { return }
  $report.selftest511 = $doc
  $labels = @{ streams = 'streams 5.11 (self-test)'; training = 'training 5.11 (self-test)'; checkpoint = 'checkpoint 5.11 (self-test)'; limits = 'limits 5.11 (self-test)' }
  $seen = @{}; $notPassed = 0
  foreach ($c in @($doc.checks)) {
    $label = [string]$c.section; if ($labels.ContainsKey($label)) { $label = $labels[$label] }
    $status = [string]$c.status; if (@('passed', 'failed', 'untested') -notcontains $status) { $status = 'failed' }
    if ($status -ne 'passed') { $notPassed++ }
    $seen[([string]$c.section + ' ' + [string]$c.id)] = $true
    Add-Check $label ([string]$c.id + ': ' + [string]$c.name) $status ([string]$c.detail) 'gate' ([ordered]@{ id = [string]$c.id })
  }
  # every check the 5.11 release defines must be there: a report that is shorter than expected is not a pass
  $expected = @('streams G1', 'streams G2', 'streams G3', 'streams A1', 'streams A2', 'streams N1', 'streams L1', 'streams U1', 'streams U2',
                'training D1', 'training W1', 'training W2', 'training W3', 'training W4', 'training W5', 'training W6', 'training W7', 'training W8',
                'checkpoint C1', 'checkpoint C2', 'checkpoint C3', 'limits L1', 'limits L2', 'limits L3', 'limits L4', 'limits L5')
  $missing = @($expected | Where-Object { -not $seen.ContainsKey($_) })
  foreach ($m in $missing) { Add-Check 'self-test 5.11' ('expected check ' + $m) 'untested' 'this check is not in the report of mwcli --selftest511' 'gate' }
  $missingText = 'none'; if ($missing.Count) { $missingText = ($missing -join ', ') }
  Check 'self-test 5.11' 'every expected 5.11 check is in the report' ($missing.Count -eq 0) ('' + ($expected.Count - $missing.Count) + ' of ' + $expected.Count + ' expected checks reported; missing: ' + $missingText)
  $agree = (($r.exit -eq 0) -eq ($notPassed -eq 0 -and $missing.Count -eq 0)) -and (([int]$doc.failed + [int]$doc.untested) -eq $notPassed)
  Check 'self-test 5.11' 'the 5.11 report agrees with the exit status of mwcli' $agree ('exit ' + $r.exit + '; checks not passed in the report: ' + $notPassed + ' (failed ' + $doc.failed + ', untested ' + $doc.untested + ')')
}

Run-Section 'streams 5.11' {
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

Run-Section 'configuration' {
  $fixture = Join-Path $Root 'studies\icm8-bb-call-small.emfix.json'; $points = @{}; $paths = @{}
  foreach ($mode in @('cpu', 'gpu')) {
    $o = Join-Path $work ('cfg-' + $mode + '.json'); $r = Invoke-Exe $mwcli @('--study', $fixture, $o, 'seeds=2', 'budgets=2000,8000', 'threads=2', 'quiet=1', 'checkpoint=off', ('processingMode=' + $mode)) @{} 1800
    $d = Read-Json $o
    if ($r.exit -eq 0 -and (Study-Complete $d)) { $points[$mode] = Study-Points $d; $paths[$mode] = [string](@(@(@($d.variants)[0].perSeed)[0].budgets)[0].trainingDevicePath) } else { $points[$mode] = 'failed: exit ' + $r.exit + ' ' + $r.err.Trim(); $paths[$mode] = '' }
  }
  Check 'configuration' 'CPU-only study completes on the CPU' ((-not ($points['cpu'] -like 'failed*')) -and ($paths['cpu'] -like 'CPU*')) ('training device: ' + $paths['cpu'] + ' ' + $(if ($points['cpu'] -like 'failed*') { $points['cpu'] } else { '' }))
  # With an NVIDIA GPU this compares the GPU-Preferred mode with the CPU; without one it checks the fall-back to the CPU.
  Check 'configuration' 'GPU-Preferred gives the CPU measurements' ((-not ($points['gpu'] -like 'failed*')) -and $points['gpu'] -eq $points['cpu']) ('GPU-Preferred training device: ' + $paths['gpu'] + ' ' + $(if ($points['gpu'] -like 'failed*') { $points['gpu'] } else { '' }))
  $bad = Join-Path $work 'bad-spec.json'; Write-Text $bad '{"protocol":4,"n":99}'; $state = Join-Path $work 'bad.state'
  $r = Invoke-Exe $mwcli @($bad, '10', '1', $state, '64') @{} 120
  Check 'configuration' 'invalid training spec refused, nothing written' ($r.exit -eq 1 -and ($r.err -match 'error') -and -not (Test-Path -LiteralPath $state)) ('exit ' + $r.exit + ': ' + $r.err.Trim())
  $r = Invoke-Exe $mwcli @((Join-Path $work 'no such spec.json'), '10', '1', $state, '64') @{} 120
  Check 'configuration' 'unreadable spec refused' ($r.exit -eq 2 -and -not (Test-Path -LiteralPath $state)) ('exit ' + $r.exit + ': ' + $r.err.Trim())
  $known = Join-Path $Root 'studies\known-akq-river.emfix.json'; $o = Join-Path $work 'cfg-option.json'
  $r = Invoke-Exe $mwcli @('--study', $known, $o, 'nonsense=1', 'quiet=1') @{} 120
  Check 'configuration' 'unknown study option refused' ($r.exit -eq 2 -and ($r.err -match 'unknown option') -and -not (Test-Path -LiteralPath $o)) ('exit ' + $r.exit + ': ' + $r.err.Trim())
  $r = Invoke-Exe $mwcli @('--study', $known, $o, 'seeds=0', 'quiet=1') @{} 120
  Check 'configuration' 'invalid study option value refused' ($r.exit -eq 1 -and ($r.err -match 'seeds') -and -not (Test-Path -LiteralPath $o)) ('exit ' + $r.exit + ': ' + $r.err.Trim())
}

Run-Section 'throughput' {
  if ($Quick) { Add-Check 'throughput' 'training throughput' 'skipped' '-Quick was given'; return }
  $rows = @(); $dir = Join-Path $Root 'validation\5.7\windows\specs'; $index = Read-Json (Join-Path $dir 'index.json')
  if (-not $index) { Add-Check 'throughput' 'training throughput' 'failed' ('index.json is missing in ' + $dir) 'information'; return }
  foreach ($s in @($index.specs)) {
    # one deal per update on one thread (how a study trains a seed), and 64 deals per update on all threads
    foreach ($arm in @(@{ file = $s.spec; threads = 1; updates = 300000; label = 'one deal per update, 1 thread' }, @{ file = $s.frozenSpec; threads = $logical; updates = 4688; label = ('64 deals per update, ' + $logical + ' threads offered') })) {
      if (-not $arm.file) { continue }
      $best = $null; $info = $null
      foreach ($rep in 1..3) { $r = Invoke-Exe $mwcli @((Join-Path $dir $arm.file), [string]$arm.updates, [string]$arm.threads, (Join-Path $work 'tp.state'), [string]$s.memoryMiB) @{} 1800; if ($r.exit -ne 0) { break }; $i = Parse-Json $r.out; if ($i -and ($null -eq $best -or $i.wallSeconds -lt $best)) { $best = $i.wallSeconds; $info = $i } }
      if ($null -eq $best) { Add-Check 'throughput' ($s.id + ', ' + $arm.label) 'failed' 'training did not run' 'information'; continue }
      $chosen = $null; if ($info.threadChoice) { $chosen = $info.threadChoice.selected }
      $row = [pscustomobject]@{ fixture = $s.id; mode = $arm.label; deals = $info.trainingDeals; bestSeconds = $best; dealsPerSecond = [math]::Round($info.trainingDeals / $best); stateVisitsPerSecond = [math]::Round($info.stateVisits / $best); threadsChosen = $chosen; tableMiB = $info.tableMiB; processPeakRssMiB = $info.processPeakRssMiB }
      $rows += $row; Add-Check 'throughput' ($s.id + ', ' + $arm.label) 'info' ('' + $row.dealsPerSecond + ' sampled deals per second (' + $best + ' s for ' + $info.trainingDeals + ' deals; threads chosen: ' + $chosen + ')') 'information'
    }
  }
  $report.trainingThroughput = $rows
  Add-Check 'throughput' 'training throughput' 'info' ('' + $rows.Count + ' measurements; see trainingThroughput in the JSON report')
}

Run-Section 'desktop host' {
  # A fixed local port is asked for, so nothing has to be read from the host's console output.
  $proc = $null; $port = Get-Random -Minimum 20000 -Maximum 45000; $base = 'http://127.0.0.1:' + $port
  try {
    $proc = Start-Child $hostExe @('--no-browser', ('--port=' + $port))
    $info = $null; $tries = 0
    while (-not $info -and $tries -lt 150 -and -not $proc.HasExited) { $tries++; try { $info = Parse-Json (Http-Get ($base + '/api/info') 5000).body } catch { Start-Sleep -Milliseconds 100 } }
    if (-not $info) { Add-Check 'desktop host' 'starts without a browser and answers /api/info' 'failed' ('no answer on ' + $base + ' (host exited: ' + $proc.HasExited + ')'); return }
    Check 'desktop host' 'starts without a browser and answers /api/info' $true $base
    Check 'desktop host' '/api/info version and build' ($info.version -eq $Release -and $info.build -eq $report.build) ('' + $info.version + ' ' + $info.build + '; studyApi ' + $info.studyApi + '; studyCheckpoints ' + $info.studyCheckpoints)
    $page = Http-Get ($base + '/') 30000
    Check 'desktop host' 'interface served with the Study tab and this build' ($page.status -eq 200 -and $page.body -match 'data-tab="study"' -and $page.body.Contains([string]$report.build)) ('' + $page.body.Length + ' characters')
    $saved = Http-Get ($base + '/api/study/checkpoints') 30000
    Check 'desktop host' 'saved-study list answers' ($saved.status -eq 200 -and $null -ne (Parse-Json $saved.body)) ('status ' + $saved.status)
  } finally {
    Stop-Child $proc
    if ($proc) { $ended = $false; try { $ended = $proc.HasExited } catch {}; Check 'desktop host' 'host process ends when stopped' $ended ('process ' + $proc.Id + ' exited: ' + $ended) }
  }
}

Run-Section 'GPU' {
  if ($SkipGpu) { Add-Check 'GPU' 'CUDA validation' 'skipped' '-SkipGpu was given'; $report.physicalNvidiaExecution = $false; return }
  $r = Invoke-Exe $mwcli @('--cuda-info') @{} 120; $cuda = Parse-Json $r.out
  $report.cudaInfo = $cuda
  $available = [bool]($cuda -and $cuda.available)
  if (-not $available) {
    $reason = $r.out.Trim(); if ($cuda -and $cuda.reason) { $reason = [string]$cuda.reason }
    Add-Check 'GPU' 'CUDA validation' 'skipped' ('no usable NVIDIA CUDA device answered on this PC (' + $reason + '): nothing about the GPU was tested')
    $report.physicalNvidiaExecution = $false; return
  }
  Add-Check 'GPU' 'CUDA device' 'info' $r.out.Trim() 'information'
  $script = Join-Path $Root 'source\tools\validate_hardware.ps1'; $hw = Join-Path $Root 'hardware-validation.json'
  $t = Get-Date; $code = -1
  try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script | Out-Host; $code = $LASTEXITCODE } catch { $code = -1 }
  $doc = Read-Json $hw
  Check 'GPU' 'validate_hardware.ps1 (CPU against CUDA, bit for bit; budgets; cold and warm device; cancellation)' ($code -eq 0) ('exit ' + $code + ' after ' + [math]::Round(((Get-Date) - $t).TotalSeconds) + ' s; see hardware-validation.json') 'hardware'
  $ran = [bool]($doc -and $doc.physicalNvidiaExecution); $report.physicalNvidiaExecution = $ran
  Check 'GPU' 'CUDA scored boards on this PC and matched the CPU' $ran ('physicalNvidiaExecution: ' + $ran) 'hardware'
  # the four processing modes must give the same study measurements
  $fixture = Join-Path $Root 'studies\icm8-bb-call-small.emfix.json'; $points = @{}
  foreach ($mode in @('cpu', 'auto', 'hybrid', 'gpu')) { $o = Join-Path $work ('mode-' + $mode + '.json'); $rr = Invoke-Exe $mwcli @('--study', $fixture, $o, 'seeds=2', 'budgets=2000,8000', 'threads=4', 'quiet=1', 'checkpoint=off', ('processingMode=' + $mode)) @{} 1800; if ($rr.exit -eq 0) { $points[$mode] = Study-Points (Read-Json $o) } else { $points[$mode] = 'failed: ' + $rr.err.Trim() } }
  $same = (@($points.Values | Sort-Object -Unique).Count -eq 1 -and -not ($points['cpu'] -like 'failed*'))
  Check 'GPU' 'CPU, Automatic, Hybrid and GPU-Preferred give identical study measurements' $same ((@($points.Keys) | Sort-Object) -join ', ') 'hardware'
  $gpuFailed = @($records | Where-Object { $_.section -eq 'GPU' -and $_.status -eq 'failed' }).Count
  Check 'GPU' 'CUDA validation' ($gpuFailed -eq 0) ('' + $gpuFailed + ' GPU check(s) failed')
}

Run-Section 'refused study' {
  # 5.9: a study the engine refuses must leave nothing behind in the desktop host's study folder (native\study_jobs.h).
  # The host is started with a private profile folder inside the temporary folder: its "Documents\EightMax" is there,
  # so the user's saved studies are not even looked at.
  $profile59 = Join-Path $work 'profile59'; [void](New-Item -ItemType Directory -Force -Path $profile59)
  $proc = $null; $port = Get-Random -Minimum 20000 -Maximum 45000; $base = 'http://127.0.0.1:' + $port
  $fixture = [System.IO.File]::ReadAllText((Join-Path $Root 'studies\flop6-jack-small.emfix.json'), [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
  $over = '{"variants":"baseline","seeds":[1,2],"budgets":[1000,20000000],"threads":2,"trainingStreams":"5.10"}'; $small = '{"variants":"baseline","seeds":[1,2],"budgets":[1000,4000],"threads":2,"evaluationSamples":256,"qualitySamples":64}'
  try {
    $proc = Start-ChildWith $hostExe @('--no-browser', ('--port=' + $port)) @{ USERPROFILE = $profile59; HOME = $profile59; EIGHTMAX_GPU = 'off' }
    $info = $null; $tries = 0
    while (-not $info -and $tries -lt 150 -and -not $proc.HasExited) { $tries++; try { $info = Parse-Json (Http-Get ($base + '/api/info') 5000).body } catch { Start-Sleep -Milliseconds 100 } }
    $list = $null; if ($info) { try { $list = Parse-Json (Http-Get ($base + '/api/study/checkpoints') 30000).body } catch {} }
    $private = ($null -ne $list -and ([string]$list.directory).StartsWith($profile59, [System.StringComparison]::OrdinalIgnoreCase))
    $dirText = ''; if ($list) { $dirText = [string]$list.directory }
    Check 'refused study' 'the host starts with a private profile folder' ($null -ne $info -and $private) ('' + $base + '; study folder: ' + $dirText)
    if (-not $info -or -not $private) { return }   # never continue against the user's own study folder
    $studiesDir = [string]$list.directory
    function Wait-Study { $s = $null; for ($i = 0; $i -lt 3000; $i++) { $s = Parse-Json (Http-Get ($base + '/api/study/status') 30000).body; if ($s -and -not $s.running) { return $s }; Start-Sleep -Milliseconds 20 }; return $s }
    function Folders { if (Test-Path -LiteralPath $studiesDir) { return @(Get-ChildItem -LiteralPath $studiesDir -Force | ForEach-Object { $_.Name }) }; return @() }
    # 1. a budget above the update limit
    $t = Get-Date; $start = Http-Post ($base + '/api/study/start') ('{"fixture":' + $fixture + ',"options":' + $over + '}'); $st = Wait-Study; $ms = [int]((Get-Date) - $t).TotalMilliseconds; $left = @(Folders)
    $refused = ($st -and ([string]$st.error) -match 'study budget too large' -and ([string]$st.error) -match 'Nothing was trained')
    Check 'refused study' 'an over-limit study is refused and leaves no folder' ($start.status -eq 200 -and $refused -and $left.Count -eq 0 -and ([string]$st.refusedStudyFolder) -eq 'removed') ('start ' + $start.status + '; refused after ' + $ms + ' ms; refusedStudyFolder: ' + [string]$st.refusedStudyFolder + '; folders left: ' + $left.Count + ' ' + ($left -join ', ') + '; ' + [string]$st.error)
    # 2. a folder that existed before, with a file that is not EightMax's
    $own = Join-Path $studiesDir 'my-own-folder'; [void](New-Item -ItemType Directory -Force -Path $own); $note = Join-Path $own 'notes.txt'; Write-Text $note 'my notes, not EightMax data'; $before = Sha256 $note
    $start2 = Http-Post ($base + '/api/study/start') ('{"fixture":' + $fixture + ',"options":' + $over + ',"checkpointId":"my-own-folder"}'); $st2 = Wait-Study
    $names = @(); if (Test-Path -LiteralPath $own) { $names = @(Get-ChildItem -LiteralPath $own -Force | ForEach-Object { $_.Name }) }
    $kept = ((Test-Path -LiteralPath $note) -and ((Sha256 $note) -eq $before) -and $names.Count -eq 1)
    Check 'refused study' 'a folder that existed before is kept with its files' ($start2.status -eq 200 -and $kept -and ([string]$st2.error) -match 'study budget too large' -and ([string]$st2.refusedStudyFolder) -like 'kept: the folder existed before*') ('start ' + $start2.status + '; files in the folder afterwards: ' + ($names -join ', ') + '; refusedStudyFolder: ' + [string]$st2.refusedStudyFolder)
    Remove-Item -LiteralPath $own -Recurse -Force -ErrorAction SilentlyContinue
    # 3. an ordinary study afterwards
    $start3 = Http-Post ($base + '/api/study/start') ('{"fixture":' + $fixture + ',"options":' + $small + '}'); $id = [string](Parse-Json $start3.body).checkpointId; $st3 = Wait-Study
    $doc = Parse-Json (Http-Get ($base + '/api/study/result') 60000).body; $files = @(); if ($id -and (Test-Path -LiteralPath (Join-Path $studiesDir $id))) { $files = @(Get-ChildItem -LiteralPath (Join-Path $studiesDir $id) -Force | ForEach-Object { $_.Name }) }
    $okStudy = ($start3.status -eq 200 -and $st3 -and -not $st3.error -and (Study-Complete $doc) -and ($files -contains 'manifest.json') -and ($files -contains 'request.json') -and $null -eq $st3.refusedStudyFolder)
    Check 'refused study' 'an ordinary study completes after the refusal' $okStudy ('start ' + $start3.status + '; error: ' + [string]$st3.error + '; complete: ' + (Study-Complete $doc) + '; files: ' + ($files -join ', '))
  } finally { Stop-Child $proc }
}

$report.scriptCompleted = $true
} catch {
  $report.scriptError = $_.Exception.Message + ' (line ' + $_.InvocationInfo.ScriptLineNumber + ')'
  Write-Host ('SCRIPT ERROR: ' + $report.scriptError)
} finally {
  foreach ($c in $children) { Stop-Child $c }
  # every planned check that was not reached
  foreach ($p in $plan) { if (-not ($records | Where-Object { $_.section -eq $p.section -and $_.name -eq $p.name })) { Add-Check $p.section $p.name 'untested' 'not reached: an earlier step of this section, or the script, stopped before it' $p.class } }
  Save-Report
  try { if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue } } catch {}
}
$failed = @($records | Where-Object { $_.status -eq 'failed' }); $untested = @($records | Where-Object { $_.status -eq 'untested' }); $skipped = @($records | Where-Object { $_.status -eq 'skipped' }); $passed = @($records | Where-Object { $_.status -eq 'passed' })
$gateBad = @($records | Where-Object { $_.class -eq 'gate' -and ($_.status -eq 'failed' -or $_.status -eq 'untested') })
Write-Host ''
Write-Host ('Passed ' + $passed.Count + ', failed ' + $failed.Count + ', skipped ' + $skipped.Count + ', untested ' + $untested.Count + '. Report: ' + $jsonPath)
if ($failed.Count) { Write-Host 'FAILED checks:'; foreach ($c in $failed) { Write-Host ('  (' + $c.class + ') ' + $c.section + ' / ' + $c.name) } }
if ($untested.Count) { Write-Host 'UNTESTED checks:'; foreach ($c in $untested) { Write-Host ('  (' + $c.class + ') ' + $c.section + ' / ' + $c.name) } }
if ($skipped.Count) { Write-Host 'SKIPPED checks:'; foreach ($c in $skipped) { Write-Host ('  ' + $c.section + ' / ' + $c.name + ': ' + (Text $c.detail)) } }
if (-not $report.scriptCompleted) { $exitCode = 2 } elseif ($gateBad.Count) { $exitCode = 1 } else { $exitCode = 0 }
exit $exitCode
