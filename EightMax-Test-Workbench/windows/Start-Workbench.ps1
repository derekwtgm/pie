param([switch]$DiagnosticsOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Add-Type -AssemblyName System.Windows.Forms
$root = Get-WorkbenchRoot
$folder = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('EightMax-Test-Workbench\Diagnostics\' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($folder) | Out-Null
$checks = New-Object Collections.Generic.List[object]
function Add-Check([string]$Name, [bool]$Passed, [string]$Message, [bool]$Required = $true) {
    if ($Message.Length -gt 2000) { $Message = $Message.Substring(0,2000) }
    $checks.Add([ordered]@{name=$Name;passed=$Passed;message=$Message;required=$Required})
}
try {
    Add-Check '64-bit Windows' ([Environment]::Is64BitOperatingSystem) 'The bundled native executable requires Windows x64.'
    Add-Check 'PowerShell' ($PSVersionTable.PSVersion.Major -ge 5) $PSVersionTable.PSVersion.ToString()
    $failures = @(Get-WorkbenchHashFailures $root)
    Add-Check 'Release file checksums' ($failures.Count -eq 0) $(if ($failures.Count) { ($failures | Select-Object -First 5) -join '; ' } else { 'All listed release bytes match. This is an integrity check, not publisher authentication.' })
    $html = Join-Path $root 'START.html'
    Add-Check 'Dashboard file' (Test-Path -LiteralPath $html -PathType Leaf) 'Open the extracted release, not a file inside the ZIP preview.'
    $candidates = @("$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
    $browser = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    Add-Check 'Supported browser located' ([bool]$browser) $(if ($browser) { [IO.Path]::GetFileName($browser) } else { 'Edge/Chrome not found in standard locations; the default HTML handler will be tried.' }) $false
    $hardware = [ordered]@{cpu='unavailable';ramGiB=$null;graphics=@();vramMeasured=$false}
    try { $hardware.cpu = ((Get-CimInstance Win32_Processor -OperationTimeoutSec 5 | Select-Object -ExpandProperty Name) -join '; '); $hardware.ramGiB = [math]::Round((Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 5).TotalPhysicalMemory / 1GB,2); $hardware.graphics = @(Get-CimInstance Win32_VideoController -OperationTimeoutSec 5 | Select-Object -ExpandProperty Name); Add-Check 'Hardware inventory' $true 'CPU/RAM/graphics names read; no VRAM or performance validation.' $false } catch { Add-Check 'Hardware inventory' $false $_.Exception.Message $false }
    $cli = Join-Path $root 'native\mwcli.exe'
    $nativeHash = (Test-Path -LiteralPath $cli -PathType Leaf) -and ((Get-FileHash -LiteralPath $cli -Algorithm SHA256).Hash.ToLowerInvariant() -eq $ExpectedEightMaxHash)
    Add-Check 'EightMax binary identity' $nativeHash 'Compared with the supplied EightMax 5.1 binary SHA-256.' $false
    $native = [ordered]@{build=$null;ieee=$null;cuda=$null}
    if ($nativeHash) {
        try { $native.build = Invoke-WorkbenchProbe $cli '--build-id' $folder 'build' 5; Add-Check 'Native build execution' ($native.build -eq ('EightMaxBuild=' + $ExpectedEightMaxBuild)) $native.build $false } catch { Add-Check 'Native build execution' $false $_.Exception.Message $false }
        if ($DiagnosticsOnly) {
            foreach ($name in @('ieee','cuda')) {
                try { $argument = if ($name -eq 'ieee') { '--ieee' } else { '--cuda-info' }; $value = Invoke-WorkbenchProbe $cli $argument $folder $name 10; $native[$name] = $value | ConvertFrom-Json; Add-Check ($name + ' capability query') $true 'Query executed. This does not establish GPU acceleration, VRAM capacity or performance.' $false } catch { Add-Check ($name + ' capability query') $false $_.Exception.Message $false }
            }
        }
    }
    $report = [ordered]@{format='eightmax-windows-diagnostics';version=1;appVersion='0.25.0';build=$ExpectedEightMaxBuild;timestampUtc=[DateTime]::UtcNow.ToString('o');osVersion=[Environment]::OSVersion.VersionString;hardware=$hardware;native=$native;checks=$checks.ToArray();liveCapacityEstablished=$false;scope='Local startup and native capability probes only. No screenshot recognition, CUDA training benchmark or simultaneous-table capacity certification.'}
    $reportPath = Join-Path $folder 'EightMax-Windows-diagnostics.json'
    Write-WorkbenchUtf8 $reportPath ($report | ConvertTo-Json -Depth 30)
    Write-Host "Diagnostic report: $reportPath"
    $requiredFailures = @($checks | Where-Object { $_.required -and -not $_.passed })
    if ($DiagnosticsOnly) { Start-Process -FilePath 'explorer.exe' -ArgumentList (Quote-WorkbenchPath $folder) | Out-Null; [Windows.Forms.MessageBox]::Show("Report saved. In Diagnostics, choose Import Windows report and select:`n`n$reportPath", 'EightMax Windows checks') | Out-Null }
    if ($requiredFailures.Count) { throw (($requiredFailures | ForEach-Object { $_.name + ': ' + $_.message }) -join "`n") }
    if (-not $DiagnosticsOnly) { if ($browser) { Start-Process -FilePath $browser -ArgumentList (Quote-WorkbenchPath $html) | Out-Null } else { Start-Process -FilePath $html | Out-Null } }
} catch { [Windows.Forms.MessageBox]::Show($_.Exception.Message + "`n`nExtract the complete ZIP and try again. You can also open START.html directly.", 'EightMax startup could not finish', 'OK', 'Error') | Out-Null; exit 1 }
