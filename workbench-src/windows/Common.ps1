# Windows PowerShell 5.1 helpers. No downloaded modules or administrator changes.
$ExpectedEightMaxBuild = '7d08acc7eb4577ee'
$ExpectedEightMaxHash = 'b3e675bfe2ae231e7d637de07886af6b511905d5225db96fe12ce2c3ccab2f72'
function Write-WorkbenchUtf8([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function Quote-WorkbenchPath([string]$Value) {
    if ($Value.Contains('"') -or $Value.EndsWith('\')) { throw 'Unsupported generated file path' }
    return '"' + $Value + '"'
}
function Get-WorkbenchInteger($Value, [int]$Minimum, [int]$Maximum, [string]$Name) {
    if ($null -eq $Value -or $Value -is [bool] -or $Value -is [string]) { throw "Invalid $Name" }
    $n = [double]$Value
    if ([double]::IsNaN($n) -or [double]::IsInfinity($n) -or $n -ne [math]::Floor($n) -or $n -lt $Minimum -or $n -gt $Maximum) { throw "Invalid $Name" }
    return [int]$n
}
function Get-WorkbenchRoot { return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
function Get-WorkbenchHashFailures([string]$Root) {
    $manifest = Join-Path $Root 'SHA256SUMS.txt'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return @('SHA256SUMS.txt missing; extract the complete ZIP') }
    $failures = New-Object Collections.Generic.List[string]
    $entries = 0
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    foreach ($line in [IO.File]::ReadAllLines($manifest)) {
        if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { $failures.Add('Malformed checksum entry'); continue }
        $hash = $Matches[1]; $relative = $Matches[2]; $entries++
        $path = [IO.Path]::GetFullPath((Join-Path $Root $relative))
        if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $failures.Add('Checksum path outside the release'); continue }
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $failures.Add($relative + ' missing'); continue }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { $failures.Add($relative + ' differs from release checksum') }
    }
    if ($entries -eq 0) { $failures.Add('Checksum manifest contains no release files') }
    return $failures.ToArray()
}
function Invoke-WorkbenchProbe([string]$Executable, [string]$Arguments, [string]$Folder, [string]$Name, [int]$Seconds) {
    $stdout = Join-Path $Folder ($Name + '.stdout.txt'); $stderr = Join-Path $Folder ($Name + '.stderr.txt')
    $p = Start-Process -FilePath $Executable -ArgumentList $Arguments -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    $null = $p.Handle
    try {
        if (-not $p.WaitForExit($Seconds * 1000)) { $p.Kill(); $p.WaitForExit(); throw "$Name exceeded $Seconds seconds" }
        $p.WaitForExit()
        if ($p.ExitCode -ne 0) { throw "$Name exited with code $($p.ExitCode)" }
        $text = [IO.File]::ReadAllText($stdout)
        if ($text.Length -gt 100000) { throw 'Probe output exceeded its report bound' }
        return $text.Trim()
    } finally { if (-not $p.HasExited) { try { $p.Kill() } catch {} }; $p.Dispose() }
}

# ---------------------------------------------------------------------------------------------------------------------
# 0.28.0 structured test reporting (shared by Test-Capture, Test-Desktop, Test-Wgc, Test-Release and the collector).
# Every check records: name, stage, start/end time, status (pass|fail|skip), errorClass, errorCode, message (never
# empty), diagnostic files, executable version and application version. Error classes separate an application error
# from a harness error, a missing dependency/executable, a timeout, an unsupported environment and a configuration error.
# ---------------------------------------------------------------------------------------------------------------------
$WorkbenchVersion = '0.35.0'
$EmErrorClasses = @('application-error','harness-error','missing-dependency','timeout','unsupported-environment','missing-executable','configuration-error')
function New-EmReport([string]$Name, [string]$OutDir) {
    return [pscustomobject]@{ format='eightmax-test-report'; version=2; test=$Name; appVersion=$WorkbenchVersion; outDir=$OutDir
        machine=$env:COMPUTERNAME; os=[Environment]::OSVersion.VersionString; startedAt=[DateTime]::UtcNow.ToString('o'); completedAt=$null
        checks=(New-Object Collections.Generic.List[object]); passed=$false; counts=$null; executables=@{} }
}
function Add-EmCheck($Report, [string]$Name, [string]$Status, [string]$Message, [string]$Stage = '', [string]$ErrorClass = '', [string]$ErrorCode = '', [string[]]$Files = @(), $StartedAt = $null) {
    if ($Status -notin @('pass','fail','skip')) { $Status = 'fail'; $ErrorClass = 'harness-error'; $Message = "Invalid status for ${Name}: $Message" }
    if ([string]::IsNullOrWhiteSpace($Message)) { $Message = $(if ($Status -eq 'pass') { 'Passed.' } else { "No message was produced by stage '$Stage'; see the diagnostic files listed for this check." }) }
    if ($Status -eq 'fail' -and [string]::IsNullOrWhiteSpace($ErrorClass)) { $ErrorClass = 'application-error' }
    if ($Status -eq 'fail' -and [string]::IsNullOrWhiteSpace($ErrorCode)) { $ErrorCode = ($Name -replace '[^A-Za-z0-9]+','-').ToLowerInvariant() + '-failed' }
    $now = [DateTime]::UtcNow.ToString('o'); if (-not $StartedAt) { $StartedAt = $now }
    $Report.checks.Add([pscustomobject]@{ check=$Name; stage=$(if($Stage){$Stage}else{$Name}); status=$Status; passed=($Status -eq 'pass'); startedAt=$StartedAt; completedAt=$now
        errorClass=$(if($Status -eq 'fail'){$ErrorClass}else{$null}); errorCode=$(if($Status -eq 'fail'){$ErrorCode}else{$null}); detail=$Message.Substring(0,[math]::Min(4000,$Message.Length)); files=@($Files | Where-Object { $_ }) })
    $colour = switch ($Status) { 'pass' {'Green'} 'skip' {'Yellow'} default {'Red'} }
    try { Write-Host (('{0,-46} {1,-5} {2}' -f $Name, $Status.ToUpperInvariant(), $Message)) -ForegroundColor $colour } catch {}
}
function Get-EmErrorClass($ErrorRecord) {
    $e = $ErrorRecord; if ($e -is [System.Management.Automation.ErrorRecord]) { $e = $e.Exception }
    if ($e -is [TimeoutException]) { return 'timeout' }
    if ($e -is [System.IO.FileNotFoundException] -or $e -is [System.Management.Automation.CommandNotFoundException]) { return 'missing-executable' }
    if ($e -is [System.Net.WebException]) { if ($e.Status -eq [System.Net.WebExceptionStatus]::Timeout) { return 'timeout' }; return 'application-error' }
    return 'harness-error'
}
function Complete-EmReport($Report, [string]$Path) {
    $Report.completedAt = [DateTime]::UtcNow.ToString('o')
    $all = $Report.checks.ToArray()
    $fail = @($all | Where-Object { $_.status -eq 'fail' }).Count; $skip = @($all | Where-Object { $_.status -eq 'skip' }).Count; $pass = @($all | Where-Object { $_.status -eq 'pass' }).Count
    $Report.counts = [pscustomobject]@{ total=$all.Count; passed=$pass; failed=$fail; skipped=$skip }
    $Report.passed = ($fail -eq 0 -and $pass -gt 0)
    $out = [pscustomobject]@{ format=$Report.format; version=$Report.version; test=$Report.test; appVersion=$Report.appVersion; machine=$Report.machine; os=$Report.os
        startedAt=$Report.startedAt; completedAt=$Report.completedAt; executables=$Report.executables; checks=$all; counts=$Report.counts; passed=$Report.passed }
    Write-WorkbenchUtf8 $Path ($out | ConvertTo-Json -Depth 12)
    return $out
}
# Runs a native tool with stdout/stderr redirected to FILES (never through the PowerShell pipeline), a hard timeout and
# guaranteed cleanup. Windows PowerShell 5.1 turns any stderr line of a native command into an ErrorRecord; with
# $ErrorActionPreference='Stop' that aborted Test-Capture.ps1 in 0.26.0 and hid the tool's exit code (empty detail).
function Invoke-EmTool([string]$Executable, [string[]]$Arguments, [string]$Folder, [string]$Name, [int]$Seconds, [switch]$Visible) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return [pscustomobject]@{ exit=$null; timedOut=$false; missing=$true; stdout=''; stderr=''; stdoutPath=$null; stderrPath=$null; ms=0 } }
    $stdout = Join-Path $Folder ($Name + '.stdout.txt'); $stderr = Join-Path $Folder ($Name + '.stderr.txt')
    $argLine = ($Arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"','\"') + '"' } else { $_ } }) -join ' '
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $start = @{ FilePath=$Executable; RedirectStandardOutput=$stdout; RedirectStandardError=$stderr; PassThru=$true }
    if ($argLine) { $start.ArgumentList = $argLine }
    if ($IsWindows -ne $false -and -not $Visible) { $start.WindowStyle = 'Hidden' }   # $IsWindows is undefined (null) in Windows PowerShell 5.1; tools that open a test window run -Visible
    $p = Start-Process @start
    $null = $p.Handle; $timedOut = $false
    try {
        # 0.29 (seen on a Windows runner): Kill() ends only the top process; its children kept running and kept the log files open.
        # On a timeout the whole process tree is ended (taskkill /T on Windows).
        if (-not $p.WaitForExit($Seconds * 1000)) { $timedOut = $true; if ($PSVersionTable.PSVersion.Major -ge 6) { try { $p.Kill($true) } catch {} } else { try { & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /T /F /PID $p.Id 2>&1 | Out-Null } catch {} }; try { if (-not $p.HasExited) { $p.Kill() } } catch {}; $null = $p.WaitForExit(5000) } else { $p.WaitForExit() }
        $code = $(if ($timedOut) { $null } else { $p.ExitCode })
    } finally { if (-not $p.HasExited) { try { $p.Kill() } catch {} }; $p.Dispose() }
    $o = ''; $e = ''; try { $o = [IO.File]::ReadAllText($stdout) } catch {}; try { $e = [IO.File]::ReadAllText($stderr) } catch {}
    return [pscustomobject]@{ exit=$code; timedOut=$timedOut; missing=$false; stdout=$o; stderr=$e; stdoutPath=$stdout; stderrPath=$stderr; ms=[int]$watch.ElapsedMilliseconds }
}
function Get-EmFileVersion([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return 'missing' }
    try { $v = (Get-Item -LiteralPath $Path).VersionInfo; $h = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.Substring(0,16).ToLowerInvariant(); return ('{0} sha256:{1}' -f $(if($v.ProductVersion){$v.ProductVersion}else{'n/a'}), $h) } catch { return 'unreadable' }
}
function New-EmRunFolder([string]$Kind) {
    # Unique per run: timestamp + short random suffix, so repeated or concurrent runs never overwrite earlier results.
    $base = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('EightMax-Test-Workbench\' + $Kind)
    $dir = Join-Path $base ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
    [IO.Directory]::CreateDirectory($dir) | Out-Null; return $dir
}
