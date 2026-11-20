# EightMax Test Workbench 0.35.0 - Windows Graphics Capture acceptance (desktop\bin\EightMaxWgc.exe).
# The helper was cross-compiled on Linux and has NEVER been executed on Windows before this check; every result below is
# measured on THIS machine (it was NOT RUN on Windows by the build). The self-test also checks that a wrong process id is refused
# (refuse-wrong-process) and that a closed window is refused (refuse-closed-handle). Unlike 0.27 (Notepad) it captures only its
# own test window: on Windows 11 the new Notepad can hand its window to another process. Stages: tool present + version, WGC supported (probe), self-test with the tool's own window
# (first frame, pixels, resize detection, minimise, restore/recovery, frame sequence, five repeated sessions + memory,
# close -> target lost), invalid-handle refusal and argument refusal. Nothing else on the desktop is captured.
param([string]$OutDir,[string]$Tool)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root = Get-WorkbenchRoot
if (-not $OutDir) { $OutDir = New-EmRunFolder 'WgcAcceptance' } else { [IO.Directory]::CreateDirectory($OutDir) | Out-Null }
$exe = $(if ($Tool) { $Tool } else { Join-Path $root 'desktop\bin\EightMaxWgc.exe' })
$report = New-EmReport 'wgc-acceptance' $OutDir
$report.executables['EightMaxWgc.exe'] = Get-EmFileVersion $exe
try {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Add-EmCheck $report 'wgc-tool-present' 'fail' 'desktop\bin\EightMaxWgc.exe is missing. Extract the complete release or rebuild it with BUILD-WGC.cmd.' 'setup' 'missing-executable' 'wgc-tool-missing'; throw 'stop' }
    $t0 = [DateTime]::UtcNow.ToString('o'); $v = Invoke-EmTool $exe @('--version') $OutDir 'wgc-version' 30
    if ($v.exit -eq 0 -and $v.stdout -match '"version":"([^"]+)"') { Add-EmCheck $report 'wgc-tool-version' 'pass' $v.stdout.Trim() 'version' -StartedAt $t0 }
    else { Add-EmCheck $report 'wgc-tool-version' 'fail' ('The helper did not start or report a version (exit ' + $v.exit + $(if ($v.timedOut) { ', timed out' } else { '' }) + '). ' + $v.stderr.Trim()) 'version' $(if ($v.timedOut) { 'timeout' } else { 'application-error' }) 'wgc-tool-start-failed' @($v.stdoutPath, $v.stderrPath) $t0; throw 'stop' }
    $t0 = [DateTime]::UtcNow.ToString('o'); $p = Invoke-EmTool $exe @('--probe') $OutDir 'wgc-probe' 30
    $probe = $null; try { $probe = $p.stdout | ConvertFrom-Json } catch {}
    if ($probe -and $probe.supported) { Add-EmCheck $report 'wgc-supported' 'pass' ('Windows Graphics Capture is supported on ' + $probe.os) 'probe' -StartedAt $t0 }
    else { Add-EmCheck $report 'wgc-supported' 'fail' ('Windows Graphics Capture is unavailable or unsupported: ' + $p.stdout.Trim() + ' ' + $p.stderr.Trim()) 'probe' 'unsupported-environment' 'wgc-unsupported' @($p.stdoutPath, $p.stderrPath) $t0; throw 'stop' }
    $t0 = [DateTime]::UtcNow.ToString('o'); $s = Invoke-EmTool $exe @('--selftest', '--out-dir', $OutDir) $OutDir 'wgc-selftest' 180 -Visible
    $resultPath = Join-Path $OutDir 'wgc-selftest-result.json'; $files = @($s.stdoutPath, $s.stderrPath, $resultPath)
    if ($s.timedOut) { Add-EmCheck $report 'wgc-selftest-completed' 'fail' 'The WGC self-test exceeded 180 s and was stopped.' 'selftest' 'timeout' 'wgc-selftest-timeout' $files $t0 }
    elseif (-not (Test-Path -LiteralPath $resultPath)) { Add-EmCheck $report 'wgc-selftest-completed' 'fail' ('Exit ' + $s.exit + ' without wgc-selftest-result.json. Output: ' + ($s.stdout + ' ' + $s.stderr).Trim()) 'selftest' 'application-error' 'wgc-selftest-no-result' $files $t0 }
    else {
        $res = [IO.File]::ReadAllText($resultPath) | ConvertFrom-Json
        foreach ($st in $res.stages) { Add-EmCheck $report ('wgc:' + $st.stage) $(if ($st.status -eq 'pass') { 'pass' } else { 'fail' }) $st.detail $st.stage $(if ($st.detail -like 'harness exception*') { 'harness-error' } else { 'application-error' }) ('wgc-' + $st.stage + '-failed') $files $t0 }
        foreach ($m in @($res.missingStages)) { if ($m) { Add-EmCheck $report ('wgc:' + $m) 'fail' 'Stage did not run (an earlier stage stopped the self-test).' $m 'application-error' ('wgc-' + $m + '-not-run') $files $t0 } }
        Add-EmCheck $report 'wgc-selftest-completed' $(if ($s.exit -eq 0 -and $res.passed) { 'pass' } else { 'fail' }) ('exit ' + $s.exit + ', ' + @($res.stages).Count + ' stages, ' + $res.failures + ' failed, ' + $res.durationMs + ' ms') 'selftest' 'application-error' 'wgc-selftest-failed' $files $t0
    }
    $t0 = [DateTime]::UtcNow.ToString('o'); $bad = Invoke-EmTool $exe @('--hwnd', '0x1', '--out', (Join-Path $OutDir 'never.png')) $OutDir 'wgc-invalid-handle' 30
    $j = $null; try { $j = $bad.stdout | ConvertFrom-Json } catch {}
    Add-EmCheck $report 'wgc-invalid-handle-refused' $(if ($j -and -not $j.ok -and $j.code -eq 'target-lost') { 'pass' } else { 'fail' }) ('invalid window is refused: exit ' + $bad.exit + ': ' + $bad.stdout.Trim()) 'refusal' 'application-error' 'wgc-invalid-handle-not-refused' @($bad.stdoutPath) $t0
    $t0 = [DateTime]::UtcNow.ToString('o'); $arg = Invoke-EmTool $exe @('--nonsense') $OutDir 'wgc-bad-arguments' 30
    Add-EmCheck $report 'wgc-bad-arguments-refused' $(if ($arg.exit -eq 2) { 'pass' } else { 'fail' }) ('exit ' + $arg.exit + ': ' + $arg.stdout.Trim()) 'refusal' 'application-error' 'wgc-bad-arguments-not-refused' @($arg.stdoutPath) $t0
    $left = @(Get-Process -Name 'EightMaxWgc' -ErrorAction SilentlyContinue)
    Add-EmCheck $report 'wgc-process-cleanup' $(if ($left.Count -eq 0) { 'pass' } else { 'fail' }) $(if ($left.Count) { 'EightMaxWgc.exe is still running.' } else { 'No helper process left running.' }) 'cleanup' 'application-error' 'wgc-process-left'
} catch {
    if ($_.Exception.Message -ne 'stop') { Add-EmCheck $report 'wgc-acceptance-harness' 'fail' ($_.Exception.GetType().Name + ': ' + $_.Exception.Message) 'harness' (Get-EmErrorClass $_) 'wgc-harness-exception' }
}
$final = Complete-EmReport $report (Join-Path $OutDir 'wgc-acceptance.json')
Write-Output ('Windows Graphics Capture acceptance ' + $(if ($final.passed) { 'PASSED' } else { 'FAILED' }) + ' (' + $final.counts.passed + ' passed, ' + $final.counts.failed + ' failed) - report: ' + (Join-Path $OutDir 'wgc-acceptance.json'))
if (-not $final.passed) { exit 1 }
