# EightMax Test Workbench 0.24 - Windows screen-capture acceptance (run on the target PC; NOT run in the build environment).
# Verifies, with the shipped helper, that: monitors/DPI are reported, a known window is captured with the right pixels at two sizes,
# a minimised window is reported (not captured), and a closed window is reported lost. Writes a JSON report next to the PNG evidence.
param([string]$OutDir)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root=Get-WorkbenchRoot
if(-not $OutDir){$OutDir=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('EightMax-Test-Workbench\CaptureAcceptance\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))}
[IO.Directory]::CreateDirectory($OutDir)|Out-Null
$tool=Join-Path $root 'desktop\bin\EightMaxCapture.exe'
$checks=@()
function Add-Check($name,$pass,$detail){$script:checks+=[pscustomobject]@{check=$name;pass=[bool]$pass;detail=$detail}}
try{
    if(-not (Test-Path -LiteralPath $tool -PathType Leaf)){throw 'desktop\bin\EightMaxCapture.exe is missing from this release.'}
    $monitors=(& $tool list-monitors) | ConvertFrom-Json
    Add-Check 'monitors-listed' ($monitors.monitors.Count -ge 1) ('monitors='+$monitors.monitors.Count+' virtual='+$monitors.virtual.width+'x'+$monitors.virtual.height+' dpiScale(primary)='+(($monitors.monitors|Where-Object primary|Select-Object -First 1).dpiScale))
    $windows=(& $tool list-windows) | ConvertFrom-Json
    Add-Check 'windows-listed' ($windows.windows.Count -ge 1) ('visible titled windows='+$windows.windows.Count)
    $log=Join-Path $OutDir 'selftest.log'
    & $tool selftest $OutDir *>&1 | Tee-Object -FilePath $log | Out-Null
    $code=$LASTEXITCODE
    Add-Check 'selftest-window-capture-resize-minimize-lost' ($code -eq 0) ('exit code '+$code+'; see '+$log)
}catch{Add-Check 'acceptance-run' $false $_.Exception.Message}
$report=[pscustomobject]@{format='eightmax-capture-acceptance';version=1;appVersion='0.25.0';generatedAt=(Get-Date).ToUniversalTime().ToString('o');machine=$env:COMPUTERNAME;os=[Environment]::OSVersion.VersionString;checks=$checks;passed=(@($checks|Where-Object {-not $_.pass}).Count -eq 0)}
$path=Join-Path $OutDir 'capture-acceptance.json'
[IO.File]::WriteAllText($path,($report|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
Write-Output ('Capture acceptance '+$(if($report.passed){'PASSED'}else{'FAILED'})+' - report: '+$path)
if(-not $report.passed){exit 1}
