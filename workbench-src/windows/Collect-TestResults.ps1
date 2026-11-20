# EightMax Test Workbench 0.35.0 - one-click test-results collector (COLLECT-TEST-RESULTS.cmd).
# Finds EightMax test reports in the known EightMax folders, copies recent report-like files (originals are only READ, never
# changed or deleted), redacts secrets and personal names, writes a machine-readable summary and saves ONE ZIP on the Desktop.
#
# Looked in (only these): %LOCALAPPDATA%\EightMax-Test-Workbench\{ReleaseAcceptance, Diagnostics, CaptureAcceptance,
#   WgcAcceptance, Reports, Benchmarks, Logs, LongAcceptance (0.31), Acceptance-0.32 (0.32), Acceptance-0.33 (0.33), Acceptance-0.35 (0.35: input self-test, input acceptance,
#   cursor-movement checks, calibration reports, focus tests, confirmation tests, multi-table benchmark, simulator diagnostics)} and the release folder's reports\ directory.
# Never collected: private session files (session.json / private-session.json), native checkpoints and job state, saved
#   studies, browser data, files outside those folders, files larger than 8 MB.
# Redacted in every collected text file: desktop session tokens (64-hex values next to "token" / X-EightMax-Session), any
#   "authorization"/"password"/"secret"/"apiKey" value, the Windows user name (C:\Users\<name>) and the computer name.
param(
    [int]$Days = 45,
    [string]$Destination,              # folder for the ZIP (default: the Desktop)
    [string[]]$SearchRoot,             # override the folders searched (used by the automated tests)
    [switch]$SummaryOnly,              # print the summary JSON and do not create a ZIP (used by the desktop host)
    [switch]$NoUi,                     # do not open Explorer / show a message box
    [switch]$KeepNames,                # keep user and computer names (off by default)
    [string]$UserNameOverride,         # automated tests only: name to redact instead of the current Windows user
    [string]$MachineOverride           # automated tests only
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root = Get-WorkbenchRoot
$local = [Environment]::GetFolderPath('LocalApplicationData'); $appData = Join-Path $local 'EightMax-Test-Workbench'
if ($SearchRoot) { $SearchRoot = @($SearchRoot | ForEach-Object { $_ -split ',' } | Where-Object { $_ }) }   # 'a,b' arrives as one string through -File
if (-not $SearchRoot) {
    $SearchRoot = @('ReleaseAcceptance','Diagnostics','CaptureAcceptance','WgcAcceptance','Reports','Benchmarks','Logs','LongAcceptance','Acceptance-0.32','Acceptance-0.33','Acceptance-0.35') | ForEach-Object { Join-Path $appData $_ }
    $SearchRoot += (Join-Path $root 'reports')
}
$includeExt = @('.json','.log','.txt','.png','.csv','.md')
# 0.29 (seen on the Windows CI runner): the release's own reports\ folder ships Linux benchmark files; they are not results from this
# PC. Every file listed in the release manifest is therefore skipped; only reports created on this PC are collected.
$shipped = @{}; try { foreach ($line in [IO.File]::ReadAllLines((Join-Path $root 'SHA256SUMS.txt'))) { if ($line.Length -gt 66) { $shipped[[IO.Path]::GetFullPath((Join-Path $root $line.Substring(66))).ToLowerInvariant()] = $true } } } catch {}
$excludeNames = @('session.json','private-session.json')
$excludePattern = '(?i)(\\|/)(NativeJobs|DesktopSessions|DesktopCache|Installed|Archive|library|bench-work|capture-session|preflop-cache|inline-work)(\\|/)|\.emsl$|\.state$|\.ckpt|checkpoint|\.emz$|\.tmp$'
$maxFile = 8MB; $maxTotal = 300MB; $since = (Get-Date).AddDays(-$Days)
$userName = $(if ($UserNameOverride) { $UserNameOverride } else { [Environment]::UserName }); $machine = $(if ($MachineOverride) { $MachineOverride } else { [Environment]::MachineName })

function Protect-Text([string]$Text) {
    $t = $Text
    $t = [regex]::Replace($t, '(?i)("?(token|sessionToken|desktopToken)"?\s*[:=]\s*"?)[a-f0-9]{32,}', '$1[REDACTED]')
    $t = [regex]::Replace($t, '(?i)(X-EightMax-Session\s*[:=]\s*)[^\s",;]+', '$1[REDACTED]')
    $t = [regex]::Replace($t, '(?i)(\x23desktop-token=)[a-f0-9]+', '$1[REDACTED]')
    $t = [regex]::Replace($t, '(?i)("?(authorization|password|passwd|secret|apiKey|api_key|credential)"?\s*[:=]\s*)("[^"]*"|[^\s,;]+)', '$1"[REDACTED]"')
    if (-not $KeepNames) {
        if ($userName -and $userName.Length -ge 2) { $t = [regex]::Replace($t, '(?i)(Users(\\\\|\\|/))' + [regex]::Escape($userName) + '(?=(\\|/|"|$))', '${1}USER') }
        if ($machine -and $machine.Length -ge 2) { $t = [regex]::Replace($t, '(?i)\b' + [regex]::Escape($machine) + '\b', 'MACHINE') }
    }
    return $t
}
function Read-AnyText([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) { return [Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2) }
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { return [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3) }
    return [Text.Encoding]::UTF8.GetString($bytes)
}

# ---- find files -------------------------------------------------------------------------------------------------------
$found = New-Object Collections.Generic.List[object]; $skipped = New-Object Collections.Generic.List[string]; $total = 0
foreach ($dir in $SearchRoot) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
    $label = Split-Path -Leaf $dir; if ($dir -like (Join-Path $root '*')) { $label = 'Release-reports' }
    foreach ($f in Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue) {
        if ($includeExt -notcontains $f.Extension.ToLowerInvariant()) { continue }
        if ($excludeNames -contains $f.Name.ToLowerInvariant()) { $skipped.Add($f.Name + ' (private session file)'); continue }
        if ($f.FullName -match $excludePattern) { continue }
        if ($shipped.ContainsKey($f.FullName.ToLowerInvariant())) { continue }
        if ($f.LastWriteTime -lt $since) { continue }
        if ($f.Length -gt $maxFile) { $skipped.Add($f.Name + ' (larger than 8 MB)'); continue }
        if ($total + $f.Length -gt $maxTotal) { $skipped.Add($f.Name + ' (archive size limit reached)'); continue }
        $relative = $f.FullName.Substring($dir.Length).TrimStart('\','/') -replace '\\','/'
        $found.Add([pscustomobject]@{ source=$f.FullName; entry=($label + '/' + $relative); size=$f.Length; modified=$f.LastWriteTimeUtc.ToString('o'); ext=$f.Extension.ToLowerInvariant() })
        $total += $f.Length
    }
}

# ---- summarise reports ---------------------------------------------------------------------------------------------------
$tests = New-Object Collections.Generic.List[object]
foreach ($f in $found) {
    if ($f.ext -ne '.json') { continue }
    $j = $null; try { $j = (Read-AnyText $f.source) | ConvertFrom-Json } catch { continue }
    if (-not $j -or -not $j.format) { continue }
    $entry = $null
    switch -Regex ([string]$j.format) {
        '^eightmax-test-report$' {
            $fails = @($j.checks | Where-Object { $_.status -eq 'fail' } | ForEach-Object { [pscustomobject]@{ check=$_.check; stage=$_.stage; errorClass=$_.errorClass; errorCode=$_.errorCode; detail=(Protect-Text ([string]$_.detail)) } })
            $entry = [pscustomobject]@{ test=$j.test; appVersion=$j.appVersion; at=$j.completedAt; passed=[bool]$j.passed; total=$j.counts.total; passedChecks=$j.counts.passed; failed=$j.counts.failed; skipped=$j.counts.skipped; failures=$fails } }
        '^eightmax-release-acceptance$' {
            $c = @($j.checks); $fails = @($c | Where-Object { $_.status -eq 'fail' } | ForEach-Object { [pscustomobject]@{ check=$_.check; stage=$_.stage; errorClass=$_.errorClass; errorCode=$_.errorCode; detail=(Protect-Text ([string]$_.detail)) } })
            $entry = [pscustomobject]@{ test='release-acceptance'; appVersion=$j.appVersion; at=$(if($j.completedAt){$j.completedAt}else{$j.generatedAt}); passed=[bool]$j.passed; total=$c.Count; passedChecks=@($c | Where-Object { $_.status -eq 'pass' }).Count; failed=$fails.Count; skipped=@($c | Where-Object { $_.status -in @('skip','skipped') }).Count; failures=$fails } }
        '^eightmax-capture-acceptance$' {
            $c = @($j.checks); $fails = @($c | Where-Object { -not $_.pass } | ForEach-Object { [pscustomobject]@{ check=$_.check; stage=$_.check; errorClass=$null; errorCode=$null; detail=$(if([string]::IsNullOrEmpty($_.detail)){'(empty detail - 0.26 harness defect)'}else{Protect-Text ([string]$_.detail)}) } })
            $entry = [pscustomobject]@{ test='capture-acceptance'; appVersion=$j.appVersion; at=$j.generatedAt; passed=[bool]$j.passed; total=$c.Count; passedChecks=@($c | Where-Object { $_.pass }).Count; failed=$fails.Count; skipped=0; failures=$fails } }
        '^eightmax-windows-diagnostics$' {
            $c = @($j.checks); $fails = @($c | Where-Object { -not $_.passed } | ForEach-Object { [pscustomobject]@{ check=$_.name; stage=$_.stage; errorClass=$_.errorClass; errorCode=$_.errorCode; detail=(Protect-Text ([string]$_.message)) } })
            $entry = [pscustomobject]@{ test=$(if($f.entry -match 'desktop'){'desktop-acceptance'}else{'windows-diagnostics'}); appVersion=$j.appVersion; at=$j.timestampUtc; passed=($fails.Count -eq 0); total=$c.Count; passedChecks=@($c | Where-Object { $_.passed }).Count; failed=$fails.Count; skipped=0; failures=$fails } }
        '^eightmax-wgc-acceptance$' {
            $c = @($j.checks); $fails = @($c | Where-Object { -not $_.passed } | ForEach-Object { [pscustomobject]@{ check=$_.name; stage=$_.name; errorClass=$null; errorCode=$null; detail=(Protect-Text ([string]$_.detail)) } })
            $entry = [pscustomobject]@{ test='wgc-acceptance'; appVersion=$null; at=$f.modified; passed=($fails.Count -eq 0); total=$c.Count; passedChecks=$c.Count - $fails.Count; failed=$fails.Count; skipped=0; failures=$fails } }
        '^eightmax-hardware-facts$' {
            $entry = [pscustomobject]@{ test='hardware-check'; appVersion=$null; at=$j.collectedAt; passed=[bool]$j.nativeSolver.selfTest.passed; total=1; passedChecks=$(if($j.nativeSolver.selfTest.passed){1}else{0}); failed=$(if($j.nativeSolver.selfTest.passed){0}else{1}); skipped=0; failures=@() } }
    }
    if ($entry) { $entry | Add-Member -NotePropertyName report -NotePropertyValue $f.entry; $tests.Add($entry) }
}
$ordered = @($tests | Sort-Object { [string]$_.at } -Descending)
$failReasons = @{}
foreach ($t in $ordered) { foreach ($x in @($t.failures)) { $k = $(if ($x.errorCode) { $x.errorCode } else { $x.check }); if (-not $failReasons.ContainsKey($k)) { $failReasons[$k] = [pscustomobject]@{ code=$k; check=$x.check; test=$t.test; detail=([string]$x.detail).Substring(0, [math]::Min(300, ([string]$x.detail).Length)); count=0 } }; $failReasons[$k].count++ } }

$hardware = [ordered]@{ collected=$false }
try {
    $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1; $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $hardware = [ordered]@{ collected=$true; cpu=$cpu.Name.Trim(); cores=$cpu.NumberOfCores; logicalProcessors=$cpu.NumberOfLogicalProcessors; ramTotalGiB=[math]::Round($os.TotalVisibleMemorySize/1MB,2); ramAvailableGiB=[math]::Round($os.FreePhysicalMemory/1MB,2)
        gpus=@(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }); osCaption=$os.Caption; osBuild=$os.BuildNumber }
} catch { $hardware.note = 'Hardware details unavailable on this system: ' + $_.Exception.Message }
$appVersion = $WorkbenchVersion
$summary = [ordered]@{
    format='eightmax-test-results-summary'; version=1; collectorVersion=$WorkbenchVersion; appVersion=$appVersion; collectedAtUtc=[DateTime]::UtcNow.ToString('o')
    os=[Environment]::OSVersion.VersionString; is64Bit=[Environment]::Is64BitOperatingSystem; hardware=$hardware; daysSearched=$Days
    testsCompleted=$ordered.Count; testsPassed=@($ordered | Where-Object { $_.passed }).Count; testsFailed=@($ordered | Where-Object { -not $_.passed }).Count
    checksPassed=[int](($ordered | ForEach-Object { [int]$_.passedChecks } | Measure-Object -Sum).Sum); checksFailed=[int](($ordered | ForEach-Object { [int]$_.failed } | Measure-Object -Sum).Sum); checksSkipped=[int](($ordered | ForEach-Object { [int]$_.skipped } | Measure-Object -Sum).Sum)
    lastTest=$(if ($ordered.Count) { [ordered]@{ test=$ordered[0].test; at=$ordered[0].at; passed=$ordered[0].passed; report=$ordered[0].report } } else { $null })
    mainFailureReasons=@($failReasons.Values | Sort-Object count -Descending | Select-Object -First 15)
    tests=$ordered; files=@($found | ForEach-Object { [pscustomobject]@{ path=$_.entry; bytes=$_.size; modifiedUtc=$_.modified } }); excluded=$skipped.ToArray()
    redaction=$(if ($KeepNames) { 'tokens and secrets redacted; user/computer names kept (-KeepNames)' } else { 'tokens, secrets, Windows user name and computer name redacted' })
    note='Originals were only read; nothing was deleted or modified. No tests were run by the collector.'
}
if ($SummaryOnly) { Write-Output ($summary | ConvertTo-Json -Depth 8 -Compress); exit 0 }

# ---- write the ZIP ---------------------------------------------------------------------------------------------------------
if (-not $Destination) { $Destination = [Environment]::GetFolderPath('Desktop'); if (-not $Destination) { $Destination = $local } }
[IO.Directory]::CreateDirectory($Destination) | Out-Null
$zipPath = Join-Path $Destination ('EightMax-Windows-Test-Results-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
$zipStream = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew)
try {
    $zip = New-Object IO.Compression.ZipArchive($zipStream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        function Add-ZipText([string]$Name, [string]$Text) { $e = $zip.CreateEntry($Name, [IO.Compression.CompressionLevel]::Optimal); $w = New-Object IO.StreamWriter($e.Open(), (New-Object Text.UTF8Encoding($false))); try { $w.Write($Text) } finally { $w.Dispose() } }
        foreach ($f in $found) {
            if ($f.ext -eq '.png') { $e = $zip.CreateEntry($f.entry, [IO.Compression.CompressionLevel]::Optimal); $s = $e.Open(); try { $in = [IO.File]::OpenRead($f.source); try { $in.CopyTo($s) } finally { $in.Dispose() } } finally { $s.Dispose() } }
            else { Add-ZipText $f.entry (Protect-Text (Read-AnyText $f.source)) }
        }
        Add-ZipText 'collect-summary.json' ($summary | ConvertTo-Json -Depth 8)
        $lines = @('EightMax Windows test results', ('Collected: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + ' by collector ' + $WorkbenchVersion), ('Tests found: ' + $summary.testsCompleted + ' (passed ' + $summary.testsPassed + ', failed ' + $summary.testsFailed + '); checks passed ' + $summary.checksPassed + ', failed ' + $summary.checksFailed + ', skipped ' + $summary.checksSkipped), ('Files: ' + $found.Count + '. ' + $summary.redaction + '.'), $summary.note, '', 'MAIN FAILURE REASONS:')
        foreach ($r in $summary.mainFailureReasons) { $lines += ('  [' + $r.code + '] x' + $r.count + ' (' + $r.test + '): ' + $r.detail) }
        $lines += ''; $lines += 'TESTS (newest first):'; foreach ($t in $ordered) { $lines += ('  ' + $t.at + '  ' + $(if ($t.passed) { 'PASS' } else { 'FAIL' }) + '  ' + $t.test + '  (' + $t.report + ')') }
        $lines += ''; $lines += 'FILES:'; foreach ($f in $found) { $lines += ('  ' + $f.entry + '  (' + $f.size + ' bytes, modified ' + $f.modified + ')') }
        Add-ZipText 'README-RESULTS.txt' ($lines -join "`r`n")
    } finally { $zip.Dispose() }
} finally { $zipStream.Dispose() }
Write-Output ('Collected ' + $found.Count + ' files from ' + $summary.testsCompleted + ' test reports.')
Write-Output ('ZIP saved to: ' + $zipPath)
if (-not $NoUi) {
    try { Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"' + $zipPath + '"') | Out-Null } catch {}
    try { Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.MessageBox]::Show("Your EightMax test results were saved to:`n`n$zipPath`n`nSend this ZIP file. No original report was changed or deleted.", 'EightMax test results collected', 'OK', 'Information') | Out-Null } catch {}
}
exit 0
