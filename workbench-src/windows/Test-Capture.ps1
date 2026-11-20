# EightMax Test Workbench 0.35.0 - Windows screen-capture acceptance (PrintWindow / BitBlt backends of EightMaxCapture.exe).
# Checks: monitors + DPI reported, windows enumerated, and the self-test: create -> capture -> verify pixels -> resize -> capture ->
# verify -> minimise (detected) -> restore (captured) -> close (detected as target-lost) -> clean-up.
#
# 0.26.0 failure on the target PC (fixed here): the tool's stderr was piped through PowerShell ("*>&1") while
# $ErrorActionPreference was 'Stop'. Windows PowerShell 5.1 converts every native stderr line into an ErrorRecord, so the
# first stderr line (the tool's unhandled ObjectDisposedException after closing its window) aborted the script, the exit code
# was lost and the report said "acceptance-run" with an EMPTY detail. Native tools now run through Invoke-EmTool (output
# redirected to files, hard timeout) and each self-test stage is reported separately from selftest-result.json.
param([string]$OutDir,[string]$Tool)  # -Tool: alternate capture executable (used by the automated harness tests; default is the shipped tool)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root = Get-WorkbenchRoot
if (-not $OutDir) { $OutDir = New-EmRunFolder 'CaptureAcceptance' } else { [IO.Directory]::CreateDirectory($OutDir) | Out-Null }
$tool = $(if ($Tool) { $Tool } else { Join-Path $root 'desktop\bin\EightMaxCapture.exe' })
$report = New-EmReport 'capture-acceptance' $OutDir
$report.executables['EightMaxCapture.exe'] = Get-EmFileVersion $tool
try {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { Add-EmCheck $report 'capture-tool-present' 'fail' 'desktop\bin\EightMaxCapture.exe is missing from this release.' 'setup' 'missing-executable' 'capture-tool-missing'; throw 'stop' }
    try {
    $t0 = [DateTime]::UtcNow.ToString('o')
    $v = Invoke-EmTool $tool @('version') $OutDir 'version' 20
    if ($v.exit -eq 0 -and $v.stdout -match '"version":"([^"]+)"') { Add-EmCheck $report 'capture-tool-version' 'pass' ('EightMaxCapture ' + $Matches[1] + '; ' + $v.stdout.Trim()) 'version' -StartedAt $t0; $report.executables['EightMaxCapture.exe'] += ' tool:' + $Matches[1] }
    else { Add-EmCheck $report 'capture-tool-version' 'fail' ('The capture tool did not report a version (exit ' + $v.exit + '). It may be an outdated build. stderr: ' + $v.stderr.Trim()) 'version' 'configuration-error' 'capture-tool-outdated' @($v.stdoutPath, $v.stderrPath) $t0 }
    } catch { Add-EmCheck $report ('version-harness') 'fail' ($_.Exception.GetType().Name + ': ' + $_.Exception.Message) 'version' 'harness-error' 'version-harness-exception' }

    try {
    $t0 = [DateTime]::UtcNow.ToString('o')
    $m = Invoke-EmTool $tool @('list-monitors') $OutDir 'list-monitors' 30
    if ($m.timedOut) { Add-EmCheck $report 'monitors-listed' 'fail' 'list-monitors exceeded 30 s.' 'list-monitors' 'timeout' 'list-monitors-timeout' @($m.stdoutPath, $m.stderrPath) $t0 }
    elseif ($m.exit -ne 0) { Add-EmCheck $report 'monitors-listed' 'fail' ('list-monitors exit ' + $m.exit + ': ' + $m.stderr.Trim()) 'list-monitors' 'application-error' 'list-monitors-failed' @($m.stdoutPath, $m.stderrPath) $t0 }
    else {
        $monitors = $m.stdout | ConvertFrom-Json
        $primary = $monitors.monitors | Where-Object { $_.primary } | Select-Object -First 1
        Add-EmCheck $report 'monitors-listed' $(if (@($monitors.monitors).Count -ge 1) { 'pass' } else { 'fail' }) ('monitors=' + @($monitors.monitors).Count + ' virtual=' + $monitors.virtual.width + 'x' + $monitors.virtual.height + ' dpiScale(primary)=' + $primary.dpiScale) 'list-monitors' -StartedAt $t0
        if ($primary) { Add-EmCheck $report 'display-scaling-recorded' 'pass' ('Primary display scaling ' + [math]::Round([double]$primary.dpiScale * 100) + ' %. Other scaling factors are only tested if you change Windows display scaling and run this check again.') 'dpi' -StartedAt $t0 }
    }
    } catch { Add-EmCheck $report ('list-monitors-harness') 'fail' ($_.Exception.GetType().Name + ': ' + $_.Exception.Message) 'list-monitors' 'harness-error' 'list-monitors-harness-exception' }

    try {
    $t0 = [DateTime]::UtcNow.ToString('o')
    $w = Invoke-EmTool $tool @('list-windows') $OutDir 'list-windows' 30
    if ($w.exit -eq 0) { $windows = $w.stdout | ConvertFrom-Json; Add-EmCheck $report 'windows-listed' $(if (@($windows.windows).Count -ge 1) { 'pass' } else { 'fail' }) ('visible titled windows=' + @($windows.windows).Count) 'list-windows' -StartedAt $t0 }
    else { Add-EmCheck $report 'windows-listed' 'fail' ('list-windows exit ' + $w.exit + $(if ($w.timedOut) { ' (timed out)' } else { '' }) + ': ' + $w.stderr.Trim()) 'list-windows' $(if ($w.timedOut) { 'timeout' } else { 'application-error' }) 'list-windows-failed' @($w.stdoutPath, $w.stderrPath) $t0 }
    } catch { Add-EmCheck $report ('list-windows-harness') 'fail' ($_.Exception.GetType().Name + ': ' + $_.Exception.Message) 'list-windows' 'harness-error' 'list-windows-harness-exception' }

    try {
    $t0 = [DateTime]::UtcNow.ToString('o')
    $s = Invoke-EmTool $tool @('selftest', $OutDir) $OutDir 'selftest' 120 -Visible
    $resultPath = Join-Path $OutDir 'selftest-result.json'
    $files = @($s.stdoutPath, $s.stderrPath, $resultPath)
    if ($s.timedOut) { Add-EmCheck $report 'selftest-completed' 'fail' 'The capture self-test exceeded 120 s and was stopped.' 'selftest' 'timeout' 'selftest-timeout' $files $t0 }
    elseif (-not (Test-Path -LiteralPath $resultPath)) {
        $tail = ($s.stdout + "`n" + $s.stderr).Trim(); if ($tail.Length -gt 1500) { $tail = $tail.Substring($tail.Length - 1500) }
        Add-EmCheck $report 'selftest-completed' 'fail' ('The self-test exited with code ' + $s.exit + ' without writing selftest-result.json (crash or outdated tool). Last output: ' + $tail) 'selftest' 'application-error' 'selftest-no-result' $files $t0
    } else {
        $res = [IO.File]::ReadAllText($resultPath) | ConvertFrom-Json
        foreach ($st in $res.stages) {
            Add-EmCheck $report ('selftest:' + $st.stage) $(if ($st.status -eq 'pass') { 'pass' } else { 'fail' }) $st.detail $st.stage $(if ($st.detail -like 'harness exception*') { 'harness-error' } else { 'application-error' }) ('capture-' + $st.stage + '-failed') $files $t0
        }
        foreach ($missing in @($res.missingStages)) { if ($missing) { Add-EmCheck $report ('selftest:' + $missing) 'fail' ('Stage did not run (an earlier stage stopped the self-test).') $missing 'application-error' ('capture-' + $missing + '-not-run') $files $t0 } }
        Add-EmCheck $report 'selftest-completed' $(if ($s.exit -eq 0 -and $res.passed) { 'pass' } else { 'fail' }) ('exit ' + $s.exit + ', ' + @($res.stages).Count + ' stages, ' + $res.failures + ' failed, dpiScale ' + $res.dpiScale + ', ' + $res.durationMs + ' ms') 'selftest' 'application-error' 'selftest-failed' $files $t0
    }
    } catch { Add-EmCheck $report 'selftest-harness' 'fail' ($_.Exception.GetType().Name + ': ' + $_.Exception.Message) 'selftest' 'harness-error' 'selftest-harness-exception' }
    $left = @(Get-Process -Name 'EightMaxCapture' -ErrorAction SilentlyContinue)
    Add-EmCheck $report 'capture-tool-exited' $(if ($left.Count -eq 0) { 'pass' } else { 'fail' }) $(if ($left.Count) { 'EightMaxCapture.exe is still running after the self-test.' } else { 'No capture tool process left running.' }) 'cleanup' 'application-error' 'capture-process-left'
} catch {
    if ($_.Exception.Message -ne 'stop') { Add-EmCheck $report 'capture-acceptance-harness' 'fail' ($_.Exception.GetType().Name + ': ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.PositionMessage) 'harness' (Get-EmErrorClass $_) 'capture-harness-exception' }
}
$path = Join-Path $OutDir 'capture-acceptance.json'
$final = Complete-EmReport $report $path
Write-Output ('Capture acceptance ' + $(if ($final.passed) { 'PASSED' } else { 'FAILED' }) + ' (' + $final.counts.passed + ' passed, ' + $final.counts.failed + ' failed, ' + $final.counts.skipped + ' skipped) - report: ' + $path)
if (-not $final.passed) { exit 1 }
