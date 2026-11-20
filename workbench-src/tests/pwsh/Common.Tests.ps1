# 0.28.0 - executable checks of windows/Common.ps1 reporting helpers (run with pwsh; on Linux this is PowerShell 7, not Windows PowerShell 5.1).
param([string]$Root)
$ErrorActionPreference = 'Stop'
. (Join-Path $Root 'windows/Common.ps1')
$fail = 0; function Assert([bool]$c, [string]$m) { if ($c) { Write-Output "ok - $m" } else { $script:fail++; Write-Output "not ok - $m" } }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('em-pwsh-' + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $tmp | Out-Null
try {
    $r = New-EmReport 'unit' $tmp
    Add-EmCheck $r 'a' 'pass' '' 'stage-a' 6>$null
    Add-EmCheck $r 'b' 'fail' '' 'stage-b' 6>$null
    Add-EmCheck $r 'c' 'skip' 'not applicable' 6>$null
    Add-EmCheck $r 'd' 'bogus' 'x' 6>$null
    $out = Complete-EmReport $r (Join-Path $tmp 'r.json')
    Assert ($out.counts.total -eq 4 -and $out.counts.passed -eq 1 -and $out.counts.failed -eq 2 -and $out.counts.skipped -eq 1) 'counts pass/fail/skip exactly'
    Assert (-not $out.passed) 'a report with a failure is not passed'
    $b = $out.checks | Where-Object { $_.check -eq 'b' }
    Assert (-not [string]::IsNullOrWhiteSpace($b.detail)) 'a failed check never has an empty message (0.26 capture report had detail "")'
    Assert ($b.errorClass -eq 'application-error' -and $b.errorCode -eq 'b-failed' -and $b.stage -eq 'stage-b') 'failed check carries class, code and stage'
    $d = $out.checks | Where-Object { $_.check -eq 'd' }
    Assert ($d.status -eq 'fail' -and $d.errorClass -eq 'harness-error') 'an invalid status is reported as a harness error'
    Assert ($out.checks[0].startedAt -and $out.checks[0].completedAt -and $out.startedAt -and $out.completedAt) 'start and completion times recorded'
    $json = Get-Content (Join-Path $tmp 'r.json') -Raw | ConvertFrom-Json
    Assert ($json.format -eq 'eightmax-test-report' -and $json.appVersion -eq $WorkbenchVersion -and $WorkbenchVersion -eq '0.35.0') 'report written with app version'
    # A tool that writes to stderr and exits non-zero must NOT abort the caller (the 0.26 Test-Capture defect).
    if ($IsWindows) { $shell = (Get-Command cmd.exe).Source; $errArgs = @('/c', 'echo out& echo boom 1>&2& exit 3'); $slowArgs = @('/c', 'ping -n 6 127.0.0.1 >nul') }
    else { $shell = (Get-Command sh -ErrorAction SilentlyContinue).Source; $errArgs = @('-c', 'echo out; echo boom >&2; exit 3'); $slowArgs = @('-c', 'sleep 5') }
    if ($shell) {
        $res = Invoke-EmTool $shell $errArgs $tmp 'stderr-tool' 10
        Assert ($res.exit -eq 3 -and $res.stderr.Trim() -eq 'boom' -and $res.stdout.Trim() -eq 'out' -and -not $res.timedOut) 'stderr output and exit code are captured to files, not thrown'
        $res = Invoke-EmTool $shell $slowArgs $tmp 'slow-tool' 1
        Assert ($res.timedOut -and $null -eq $res.exit) 'a hung tool is stopped at its timeout and reported as timed out'
        $released = $false; for ($k = 0; $k -lt 20 -and -not $released; $k++) { try { [IO.File]::Open($res.stderrPath, 'Open', 'ReadWrite', 'None').Dispose(); $released = $true } catch { Start-Sleep -Milliseconds 100 } }
        Assert $released 'the whole process tree was ended: no child process still holds the tool output files'
    } else { Write-Output 'ok - # SKIP no shell available' }
    $res = Invoke-EmTool (Join-Path $tmp 'missing.exe') @() $tmp 'missing' 5
    Assert ($res.missing) 'a missing executable is reported as missing, not as a crash'
    Assert ((Get-EmErrorClass ([TimeoutException]::new('x'))) -eq 'timeout') 'timeouts are classified'
    Assert ((Get-EmErrorClass ([IO.FileNotFoundException]::new('x'))) -eq 'missing-executable') 'missing files are classified'
} finally { Remove-Item -Recurse -Force $tmp }
Write-Output "pwsh-failures: $fail"; if ($fail) { exit 1 }
