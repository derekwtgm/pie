# EightMax Test Workbench 0.35.0 - one-click Windows release acceptance (RUN-RELEASE-ACCEPTANCE.cmd).
# RUN ON THE TARGET WINDOWS 10/11 x64 PC. The 0.28.0 build environment was Linux: nothing here has run on Windows yet.
# Steps (each in its own output folder, nothing overwritten): release integrity -> PowerShell parse -> dashboard/version markers ->
# executable versions -> capture acceptance -> Windows Graphics Capture acceptance -> desktop host/API/native/shutdown acceptance
# -> native process cleanup -> hardware check -> optional install/rollback/uninstall (-IncludeInstall) -> results ZIP on the Desktop.
# The report maps every result onto the critical acceptance table; a criterion is only PASS if its checks actually ran and passed.
param([string]$OutDir,[switch]$IncludeInstall,[switch]$SkipDesktop,[switch]$SkipWgc,[switch]$SkipHardware,[switch]$NoCollect)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root=Get-WorkbenchRoot
if(-not $OutDir){$OutDir=New-EmRunFolder 'ReleaseAcceptance'}else{[IO.Directory]::CreateDirectory($OutDir)|Out-Null}
$env:EIGHTMAX_NO_EXPLORER='1'
$report=New-EmReport 'release-acceptance' $OutDir
$runStart=Get-Date
foreach($e in @('desktop\bin\EightMaxWorkbench.exe','desktop\bin\EightMaxCapture.exe','desktop\bin\EightMaxWgc.exe','native\mwcli.exe','runtime\node\node.exe')){$report.executables[$e]=Get-EmFileVersion (Join-Path $root $e)}
$children=@{}
function Invoke-Child([string]$Script,[string[]]$ArgumentList,[string]$Name,[int]$TimeoutSeconds){
    $log=Join-Path $OutDir ($Name+'.log')
    $argLine='-NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File '+(Quote-WorkbenchPath $Script);foreach($a in $ArgumentList){$argLine+=' '+$a}
    $p=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $argLine -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError ($log+'.err')
    $null=$p.Handle;$timedOut=$false
    if(-not $p.WaitForExit($TimeoutSeconds*1000)){$timedOut=$true;try{$p.Kill()}catch{}}else{$p.WaitForExit()}
    return [pscustomobject]@{exit=$(if($timedOut){$null}else{$p.ExitCode});log=$log;timedOut=$timedOut}
}
function Import-ChildReport([string]$Prefix,[string]$Path,$Run){
    if(-not (Test-Path -LiteralPath $Path)){Add-EmCheck $report ($Prefix+'report') 'fail' ('The '+$Prefix.TrimEnd('/')+' test produced no report (exit '+$Run.exit+$(if($Run.timedOut){', timed out'}else{''})+'). See '+$Run.log) $Prefix $(if($Run.timedOut){'timeout'}else{'harness-error'}) ($Prefix.TrimEnd('/')+'-no-report') @($Run.log,($Run.log+'.err'));return $null}
    $j=[IO.File]::ReadAllText($Path)|ConvertFrom-Json
    foreach($c in @($j.checks)){
        if($j.format -eq 'eightmax-windows-diagnostics'){Add-EmCheck $report ($Prefix+$c.name) $(if($c.passed){'pass'}else{'fail'}) $c.message $(if($c.stage){$c.stage}else{$Prefix}) $c.errorClass $c.errorCode @($Path)}
        else{Add-EmCheck $report ($Prefix+$c.check) $c.status $c.detail $c.stage $c.errorClass $c.errorCode @($Path)}
    }
    return $j
}
try{
    $t0=[DateTime]::UtcNow.ToString('o');$failures=@(Get-WorkbenchHashFailures $root)
    Add-EmCheck $report 'release-integrity' $(if($failures.Count -eq 0){'pass'}else{'fail'}) $(if($failures.Count){($failures|Select-Object -First 5) -join '; '}else{'Every file matches SHA256SUMS.txt.'}) 'integrity' 'configuration-error' 'release-integrity-failed' -StartedAt $t0
    if($failures.Count){throw 'Release integrity failed; extract the complete ZIP again.'}

    $t0=[DateTime]::UtcNow.ToString('o');$parseErrors=New-Object Collections.Generic.List[string]
    foreach($file in Get-ChildItem (Join-Path $root 'windows'),(Join-Path $root 'native') -Filter '*.ps1'){$tokens=$null;$errors=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors);foreach($e in $errors){$parseErrors.Add($file.Name+': '+$e.Message)}}
    Add-EmCheck $report 'powershell-parse-all-scripts' $(if($parseErrors.Count -eq 0){'pass'}else{'fail'}) $(if($parseErrors.Count){$parseErrors[0]}else{'All shipped .ps1 files parse in Windows PowerShell '+$PSVersionTable.PSVersion}) 'parse' 'configuration-error' 'powershell-parse-failed' -StartedAt $t0

    $html=[IO.File]::ReadAllText((Join-Path $root 'START.html'))
    $markers=@('id="pf-panel"','id="pf-capture"','id="pf-solver"','id="tr-panel"',("VERSION='"+$WorkbenchVersion+"'"))
    $missing=@($markers|Where-Object {-not $html.Contains($_)})
    Add-EmCheck $report 'dashboard-version-markers' $(if($missing.Count -eq 0){'pass'}else{'fail'}) $(if($missing.Count){'Missing: '+($missing -join ', ')}else{'START.html contains the platform and test-results workspaces and version '+$WorkbenchVersion+'.'}) 'dashboard' 'configuration-error' 'dashboard-markers-missing'

    $components=[IO.File]::ReadAllText((Join-Path $root 'desktop\COMPONENT-VERSIONS.json'))|ConvertFrom-Json;$stale=@()
    # The host and capture tool carry a Win32 version resource. EightMaxWgc.exe was cross-compiled on Linux, where the .NET SDK cannot
    # stamp the app version into the single-file host resource, so its file properties show the .NET host version: ask the tool itself.
    foreach($pair in @(@('desktop\bin\EightMaxWorkbench.exe','file'),@('desktop\bin\EightMaxCapture.exe','version'),@('desktop\bin\EightMaxWgc.exe','--version'))){
        $path=Join-Path $root $pair[0];if(-not (Test-Path -LiteralPath $path)){$stale+=($pair[0]+' missing');continue}
        if($pair[1] -eq 'file'){$pv=(Get-Item -LiteralPath $path).VersionInfo.ProductVersion}
        else{$probe=Invoke-EmTool $path @($pair[1]) $OutDir ('version-'+[IO.Path]::GetFileNameWithoutExtension($path)) 30;$pv=$(if($probe.stdout -match '"version":"([^"]+)"'){$Matches[1]}else{'(no version reply, exit '+$probe.exit+')'})}
        if(-not $pv -or -not $pv.StartsWith($WorkbenchVersion)){$stale+=($pair[0]+' reports version '+$pv)}
    }
    Add-EmCheck $report 'executable-versions' $(if($stale.Count -eq 0){'pass'}else{'fail'}) $(if($stale.Count){'Outdated or unidentified executables: '+($stale -join '; ')}else{'Host, capture and WGC executables all identify themselves as '+$WorkbenchVersion+' (components file: '+$components.appVersion+').'}) 'versions' 'configuration-error' 'executable-version-mismatch'

    $capDir=Join-Path $OutDir 'capture';$run=Invoke-Child -Script (Join-Path $PSScriptRoot 'Test-Capture.ps1') -ArgumentList @('-OutDir',(Quote-WorkbenchPath $capDir)) -Name 'capture-acceptance' -TimeoutSeconds 240
    $children.capture=Import-ChildReport 'capture/' (Join-Path $capDir 'capture-acceptance.json') $run

    if($SkipWgc){Add-EmCheck $report 'wgc/skipped' 'skip' 'Skipped by -SkipWgc.' 'wgc'}
    else{$wgcDir=Join-Path $OutDir 'wgc';$run=Invoke-Child -Script (Join-Path $PSScriptRoot 'Test-Wgc.ps1') -ArgumentList @('-OutDir',(Quote-WorkbenchPath $wgcDir)) -Name 'wgc-acceptance' -TimeoutSeconds 300;$children.wgc=Import-ChildReport 'wgc/' (Join-Path $wgcDir 'wgc-acceptance.json') $run}

    if($SkipDesktop){Add-EmCheck $report 'desktop/skipped' 'skip' 'Skipped by -SkipDesktop.' 'desktop'}
    else{
        $deskDir=Join-Path $OutDir 'desktop';$run=Invoke-Child -Script (Join-Path $PSScriptRoot 'Test-Desktop.ps1') -ArgumentList @('-OutDir',(Quote-WorkbenchPath $deskDir)) -Name 'desktop-acceptance' -TimeoutSeconds 900
        if($run.timedOut){
            # The child was stopped before its own clean-up; shut its host down through the private session it left behind.
            $sessionFile=Join-Path $deskDir 'private-session.json'
            if(Test-Path -LiteralPath $sessionFile){try{$sess=[IO.File]::ReadAllText($sessionFile)|ConvertFrom-Json;$null=Invoke-WebRequest -Uri ($sess.origin+'/api/desktop/shutdown') -Method POST -Headers @{'X-EightMax-Session'=[string]$sess.token} -UseBasicParsing -TimeoutSec 10;$hp=Get-Process -Id $sess.processId -ErrorAction SilentlyContinue;if($hp -and -not $hp.WaitForExit(20000)){$hp.Kill()}}catch{}}
        }
        $children.desktop=Import-ChildReport 'desktop/' (Join-Path $deskDir 'EightMax-desktop-acceptance.json') $run
    }
    Start-Sleep -Milliseconds 500
    $leftNative=@(Get-Process -Name 'mwcli' -ErrorAction SilentlyContinue|Where-Object {try{$_.StartTime -ge $runStart}catch{$false}})
    $leftHost=@(Get-Process -Name 'EightMaxWorkbench','EightMaxCapture','EightMaxWgc' -ErrorAction SilentlyContinue|Where-Object {try{$_.StartTime -ge $runStart}catch{$false}})
    Add-EmCheck $report 'no-orphaned-processes' $(if($leftNative.Count+$leftHost.Count -eq 0){'pass'}else{'fail'}) $(if($leftNative.Count+$leftHost.Count){'Still running after the tests: '+((@($leftNative)+@($leftHost)|ForEach-Object {$_.ProcessName+'('+$_.Id+')'}) -join ', ')}else{'No mwcli.exe, desktop host, capture or WGC process started by this run is still running.'}) 'cleanup' 'application-error' 'orphaned-processes'

    if($SkipHardware){Add-EmCheck $report 'hardware-check' 'skip' 'Skipped by -SkipHardware.' 'hardware'}
    else{$hwDir=Join-Path $OutDir 'hardware';$run=Invoke-Child -Script (Join-Path $PSScriptRoot 'Test-Hardware.ps1') -ArgumentList @('-OutputDirectory',(Quote-WorkbenchPath $hwDir)) -Name 'hardware-check' -TimeoutSeconds 180;Add-EmCheck $report 'hardware-check' $(if(-not $run.timedOut -and $run.exit -eq 0){'pass'}else{'fail'}) ('exit '+$run.exit+$(if($run.timedOut){' (timed out)'}else{''})+'; facts in '+$hwDir) 'hardware' $(if($run.timedOut){'timeout'}else{'application-error'}) 'hardware-check-failed' @($run.log)}

    if($IncludeInstall){
        $i=Invoke-Child -Script (Join-Path $PSScriptRoot 'Install-Workbench.ps1') -ArgumentList @() -Name 'install' -TimeoutSeconds 300;Add-EmCheck $report 'install' $(if($i.exit -eq 0){'pass'}else{'fail'}) ('exit '+$i.exit+'; log '+$i.log) 'install' -Files @($i.log)
        $r=Invoke-Child -Script (Join-Path $PSScriptRoot 'Rollback-Workbench.ps1') -ArgumentList @() -Name 'rollback' -TimeoutSeconds 120;Add-EmCheck $report 'rollback' $(if($r.exit -eq 0 -or $r.exit -eq 1){'pass'}else{'fail'}) ('exit '+$r.exit+' (exit 1 is expected when only one release is installed); log '+$r.log) 'rollback' -Files @($r.log)
        $userDataBefore=@('NativeJobs','Diagnostics','Reports','Logs')|Where-Object {Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('EightMax-Test-Workbench\'+$_))}
        $u=Invoke-Child -Script (Join-Path $PSScriptRoot 'Install-Workbench.ps1') -ArgumentList @('-Uninstall') -Name 'uninstall' -TimeoutSeconds 120;Add-EmCheck $report 'uninstall' $(if($u.exit -eq 0){'pass'}else{'fail'}) ('exit '+$u.exit+'; log '+$u.log) 'uninstall' -Files @($u.log)
        $kept=@($userDataBefore|Where-Object {Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('EightMax-Test-Workbench\'+$_))})
        # 0.29: compare with the user-data folders that existed BEFORE uninstalling (0.28 demanded a Diagnostics folder that a run may never create)
        Add-EmCheck $report 'user-data-preserved-after-uninstall' $(if($kept.Count -eq @($userDataBefore).Count){'pass'}else{'fail'}) ('Before uninstall: '+(@($userDataBefore) -join ', ')+'; still present after: '+($kept -join ', ')) 'uninstall'
    }else{Add-EmCheck $report 'install-rollback-uninstall' 'skip' 'Run RUN-RELEASE-ACCEPTANCE.cmd -IncludeInstall to exercise the current-user install cycle.' 'install'}
}catch{Add-EmCheck $report 'release-acceptance-harness' 'fail' ($_.Exception.Message+' ['+$_.InvocationInfo.PositionMessage.Split("`n")[0].Trim()+']') 'harness' (Get-EmErrorClass $_) 'release-harness-exception'}

# ---- critical acceptance table (section 15 of the 0.28 brief) ----
function Get-Criterion([string]$Name,[string[]]$Checks){
    $found=@($report.checks|Where-Object {$Checks -contains $_.check})
    $status=$(if($found.Count -lt $Checks.Count){'not-run'}elseif(@($found|Where-Object {$_.status -eq 'fail'}).Count){'fail'}elseif(@($found|Where-Object {$_.status -eq 'skip'}).Count){'skipped'}else{'pass'})
    return [pscustomobject]@{criterion=$Name;status=$status;checks=$Checks;detail=(@($found|Where-Object {$_.status -ne 'pass'}|ForEach-Object {$_.check+': '+$_.detail}) -join ' | ')}
}
$critical=@(
    (Get-Criterion 'Archive integrity' @('release-integrity')),
    (Get-Criterion 'PowerShell parsing' @('powershell-parse-all-scripts')),
    (Get-Criterion 'Monitor detection' @('capture/monitors-listed')),
    (Get-Criterion 'Window enumeration' @('capture/windows-listed')),
    (Get-Criterion 'Capture and resize' @('capture/selftest:capture-original','capture/selftest:verify-original-pixels','capture/selftest:capture-resized','capture/selftest:verify-resized-pixels')),
    (Get-Criterion 'Minimized-window detection' @('capture/selftest:detect-minimized')),
    (Get-Criterion 'Closed-window detection' @('capture/selftest:detect-closed')),
    (Get-Criterion 'Capture acceptance completion' @('capture/selftest-completed')),
    (Get-Criterion 'Desktop local API communication' @('desktop/Desktop build and local health','desktop/Expect: 100-continue accepted (0.26 HTTP 400 regression)','desktop/Desktop acceptance completed')),
    (Get-Criterion 'Native solver startup' @('desktop/Managed reviewed CPU workflow')),
    (Get-Criterion 'Authenticated graceful shutdown' @('desktop/Graceful desktop shutdown')),
    (Get-Criterion 'Native process cleanup' @('desktop/Native process cleanup','no-orphaned-processes')),
    (Get-Criterion 'Persistent capture session through the host (0.29)' @('desktop/Host capture: Windows Graphics Capture persistent session','desktop/Host capture: session closes and its helper exits','desktop/Host capture: closed window reported, session ended'))
)
$final=Complete-EmReport $report (Join-Path $OutDir 'release-acceptance.json')
$criticalPassed=@($critical|Where-Object {$_.status -ne 'pass'}).Count -eq 0
$summary=[pscustomobject]@{format='eightmax-release-acceptance-summary';version=1;appVersion=$WorkbenchVersion;machine=$env:COMPUTERNAME;os=[Environment]::OSVersion.VersionString;generatedAt=[DateTime]::UtcNow.ToString('o');criticalAcceptancePassed=$criticalPassed;critical=$critical;counts=$final.counts;report='release-acceptance.json'}
Write-WorkbenchUtf8 (Join-Path $OutDir 'critical-acceptance.json') ($summary|ConvertTo-Json -Depth 6)
Write-Host ''
Write-Host 'CRITICAL ACCEPTANCE' -ForegroundColor Cyan
foreach($c in $critical){Write-Host (('  {0,-36} {1}' -f $c.criterion,$c.status.ToUpperInvariant())) -ForegroundColor $(switch($c.status){'pass'{'Green'}'fail'{'Red'}default{'Yellow'}})}
Write-Output ('Release acceptance '+$(if($final.passed -and $criticalPassed){'PASSED'}else{'FAILED'})+' ('+$final.counts.passed+' passed, '+$final.counts.failed+' failed, '+$final.counts.skipped+' skipped) - report: '+(Join-Path $OutDir 'release-acceptance.json'))
if(-not $NoCollect){
    Write-Host 'Collecting all EightMax test results into one ZIP on your Desktop...'
    try{& (Join-Path $PSScriptRoot 'Collect-TestResults.ps1')}catch{Write-Host ('Result collection failed: '+$_.Exception.Message+' - run COLLECT-TEST-RESULTS.cmd.')}
}
if(-not ($final.passed -and $criticalPassed)){exit 1}
