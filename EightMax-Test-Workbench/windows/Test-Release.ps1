# EightMax Test Workbench 0.25 - Windows release acceptance orchestrator.
# RUN ON THE TARGET WINDOWS 10/11 x64 PC. It was NOT run in the build environment (Linux); no Windows machine was available there.
# Steps: release integrity -> PowerShell parse of every shipped script -> capture self-test -> desktop host/native/diagnostics checks ->
# platform-workspace markers in START.html -> optional install / rollback / uninstall cycle (-IncludeInstall; changes only the current user's profile).
# Every step is recorded as pass / fail / skipped with its detail in a JSON report. Nothing is reported as passed unless it actually ran.
param([string]$OutDir,[switch]$IncludeInstall,[switch]$SkipDesktop)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root=Get-WorkbenchRoot
if(-not $OutDir){$OutDir=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('EightMax-Test-Workbench\ReleaseAcceptance\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))}
[IO.Directory]::CreateDirectory($OutDir)|Out-Null
$checks=New-Object Collections.Generic.List[object]
function Add-Check([string]$Name,[string]$Status,[string]$Detail){$checks.Add([pscustomobject]@{check=$Name;status=$Status;detail=$Detail.Substring(0,[math]::Min(1500,$Detail.Length))})}
function Invoke-Child([string]$Script,[string[]]$ArgumentList,[string]$LogName,[int]$TimeoutSeconds){
    $log=Join-Path $OutDir $LogName
    $argLine='-NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File '+(Quote-WorkbenchPath $Script)
    foreach($a in $ArgumentList){$argLine+=' '+$a}
    $p=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $argLine -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError ($log+'.err')
    $null=$p.Handle
    if(-not $p.WaitForExit($TimeoutSeconds*1000)){try{$p.Kill()}catch{};return [pscustomobject]@{exit=-1;log=$log;timedOut=$true}}
    $p.WaitForExit()
    return [pscustomobject]@{exit=$p.ExitCode;log=$log;timedOut=$false}
}
try{
    $failures=@(Get-WorkbenchHashFailures $root)
    Add-Check 'release-integrity' $(if($failures.Count -eq 0){'pass'}else{'fail'}) $(if($failures.Count){$failures[0]}else{'Every file matches SHA256SUMS.txt.'})
    if($failures.Count){throw 'Release integrity failed; extract the complete ZIP again.'}

    $parseErrors=New-Object Collections.Generic.List[string]
    foreach($file in Get-ChildItem (Join-Path $root 'windows'),(Join-Path $root 'native') -Filter '*.ps1'){
        $tokens=$null;$errors=$null
        $null=[System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
        foreach($e in $errors){$parseErrors.Add($file.Name+': '+$e.Message)}
    }
    Add-Check 'powershell-parse-all-scripts' $(if($parseErrors.Count -eq 0){'pass'}else{'fail'}) $(if($parseErrors.Count){$parseErrors[0]}else{'All shipped .ps1 files parse in Windows PowerShell.'})

    $html=[IO.File]::ReadAllText((Join-Path $root 'START.html'))
    $markers=@('id="pf-panel"','id="pf-capture"','id="pf-calibration"','id="pf-solver"','id="pf-execution"','id="pf-performance"',"VERSION='0.25.0'")
    $missing=@($markers|Where-Object {-not $html.Contains($_)})
    Add-Check 'platform-workspace-present' $(if($missing.Count -eq 0){'pass'}else{'fail'}) $(if($missing.Count){'Missing: '+($missing -join ', ')}else{'START.html contains the platform workspace and version 0.25.0.'})

    $cap=Invoke-Child (Join-Path $PSScriptRoot 'Test-Capture.ps1') @('-OutDir',(Quote-WorkbenchPath (Join-Path $OutDir 'capture'))) 'capture-acceptance.log' 180
    Add-Check 'capture-selftest-printwindow-bitblt' $(if(-not $cap.timedOut -and $cap.exit -eq 0){'pass'}else{'fail'}) ('exit '+$cap.exit+$(if($cap.timedOut){' (timed out)'}else{''})+'; log '+$cap.log+'. Windows Graphics Capture is NOT implemented in 0.25 and is not tested.')

    if($SkipDesktop){Add-Check 'desktop-host-native-diagnostics' 'skipped' 'Skipped by -SkipDesktop.'}
    else{
        $d=Invoke-Child (Join-Path $PSScriptRoot 'Test-Desktop.ps1') @() 'desktop-checks.log' 600
        Add-Check 'desktop-host-native-diagnostics' $(if(-not $d.timedOut -and $d.exit -eq 0){'pass'}else{'fail'}) ('exit '+$d.exit+$(if($d.timedOut){' (timed out)'}else{''})+'; log '+$d.log)
        $left=@(Get-Process -Name 'mwcli' -ErrorAction SilentlyContinue)
        Add-Check 'shutdown-leaves-no-native-process' $(if($left.Count -eq 0){'pass'}else{'fail'}) $(if($left.Count){'mwcli.exe still running after the desktop checks'}else{'No mwcli.exe left after shutdown.'})
    }

    if($IncludeInstall){
        $i=Invoke-Child (Join-Path $PSScriptRoot 'Install-Workbench.ps1') @() 'install.log' 300
        Add-Check 'install' $(if($i.exit -eq 0){'pass'}else{'fail'}) ('exit '+$i.exit+'; log '+$i.log)
        $r=Invoke-Child (Join-Path $PSScriptRoot 'Rollback-Workbench.ps1') @() 'rollback.log' 120
        Add-Check 'rollback' $(if($r.exit -eq 0 -or $r.exit -eq 1){'pass'}else{'fail'}) ('exit '+$r.exit+' (exit 1 is expected when only one release is installed); log '+$r.log)
        $u=Join-Path $root 'UNINSTALL-WINDOWS.cmd'
        $up=Start-Process -FilePath $u -PassThru -WindowStyle Hidden -Wait
        Add-Check 'uninstall' $(if($up.ExitCode -eq 0){'pass'}else{'fail'}) ('exit '+$up.ExitCode)
    }
    else{Add-Check 'install-rollback-uninstall' 'skipped' 'Run again with -IncludeInstall to exercise the current-user install cycle.'}
}catch{Add-Check 'acceptance-run' 'fail' $_.Exception.Message}
$failed=@($checks|Where-Object {$_.status -eq 'fail'})
$report=[pscustomobject]@{format='eightmax-release-acceptance';version=1;appVersion='0.25.0';generatedAt=(Get-Date).ToUniversalTime().ToString('o');machine=$env:COMPUTERNAME;os=[Environment]::OSVersion.VersionString;checks=$checks;passed=($failed.Count -eq 0);skipped=@($checks|Where-Object {$_.status -eq 'skipped'}).Count;note='GPU acceleration, external poker clients and Windows Graphics Capture are not part of this acceptance: none is implemented or verified in 0.25.'}
$path=Join-Path $OutDir 'release-acceptance.json'
[IO.File]::WriteAllText($path,($report|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
Write-Output ('Release acceptance '+$(if($report.passed){'PASSED'}else{'FAILED'})+' ('+$checks.Count+' checks, '+$report.skipped+' skipped) - report: '+$path)
if(-not $report.passed){exit 1}
