# Actual Windows acceptance; this script is not executed by Linux unit tests.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root=Get-WorkbenchRoot
$folder=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('EightMax-Test-Workbench\Diagnostics\desktop-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($folder)|Out-Null
$checks=New-Object Collections.Generic.List[object];$session=$null;$hostProcess=$null;$headers=$null
function Add-DesktopCheck([string]$Name,[bool]$Passed,[string]$Message){$checks.Add([ordered]@{name=$Name;passed=$Passed;required=$true;message=$Message.Substring(0,[math]::Min(2000,$Message.Length))})}
function API([string]$Path,[string]$Method='GET',$Body=$null){$requestOptions=@{Uri=$session.origin+$Path;Method=$Method;Headers=$headers;UseBasicParsing=$true;TimeoutSec=15};if($null -ne $Body){$requestOptions.ContentType='application/json';$requestOptions.Body=($Body|ConvertTo-Json -Depth 70 -Compress)};return (Invoke-WebRequest @requestOptions).Content|ConvertFrom-Json}
function Await-Job([string]$Id,[int]$Seconds=120,[int]$Target=0){$watch=[Diagnostics.Stopwatch]::StartNew();do{$s=API ('/api/native/jobs/'+$Id);if($Target -gt 0 -and ($s.targetUpdates -ne $Target -or ($s.nativeStatus -and ($s.nativeStatus.targetUpdates -ne $Target -or $s.nativeStatus.committedUpdates -gt $Target)))){throw 'Native status changed its original cumulative target or reported counters beyond it'};if(-not $s.running){return $s};if($watch.Elapsed.TotalSeconds -gt $Seconds){throw 'Managed native acceptance run exceeded its wait bound'};Start-Sleep -Milliseconds 200}while($true)}
try {
    $failures=@(Get-WorkbenchHashFailures $root);Add-DesktopCheck 'Release integrity' ($failures.Count -eq 0) $(if($failures.Count){$failures[0]}else{'Release files match their manifest.'});if($failures.Count){throw 'Release verification failed'}
    $parseErrors=New-Object Collections.Generic.List[string]
    foreach($file in Get-ChildItem (Join-Path $root 'windows'),(Join-Path $root 'native') -Filter '*.ps1'){$tokens=$null;$errors=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors);foreach($e in $errors){$parseErrors.Add($file.Name+': '+$e.Message)}}
    Add-DesktopCheck 'Windows PowerShell parsing' ($parseErrors.Count -eq 0) $(if($parseErrors.Count){$parseErrors[0]}else{'Windows scripts parsed without errors.'});if($parseErrors.Count){throw 'Fix PowerShell parse errors before launching'}
    $ready=Join-Path $folder 'private-session.json';$starter=Join-Path $root 'windows\Start-Desktop.ps1'
    $launcherArgs='-NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File '+(Quote-WorkbenchPath $starter)+' -Headless -ReadyFile '+(Quote-WorkbenchPath $ready)
    $start=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $launcherArgs -RedirectStandardOutput (Join-Path $folder 'desktop-build.stdout.txt') -RedirectStandardError (Join-Path $folder 'desktop-build.stderr.txt') -PassThru
    $null=$start.Handle;if(-not $start.WaitForExit(45000)){$start.Kill();throw 'Desktop build/launch exceeded 45 seconds'};$start.WaitForExit();if($start.ExitCode -ne 0){throw 'Desktop build/launch failed; review desktop-build.stderr.txt'}
    $timer=[Diagnostics.Stopwatch]::StartNew();while(-not (Test-Path -LiteralPath $ready)){if($timer.Elapsed.TotalSeconds -gt 20){throw 'Desktop session was not ready; close any existing desktop host first'};Start-Sleep -Milliseconds 100}
    $session=[IO.File]::ReadAllText($ready)|ConvertFrom-Json
    if($session.format -ne 'eightmax-desktop-session' -or $session.origin -ne 'http://127.0.0.1:48713' -or $session.token -notmatch '^[a-f0-9]{64}$'){throw 'Invalid private desktop session metadata'}
    $hostProcess=Get-Process -Id $session.processId;$null=$hostProcess.Handle;$headers=@{'X-EightMax-Session'=[string]$session.token}
    $h=API '/api/desktop/health';Add-DesktopCheck 'Desktop build and local health' ($h.build -eq $ExpectedEightMaxBuild -and $h.nativeCPU -eq $true -and $h.liveClientConnected -eq $false -and $h.currentJob -eq $true -and $h.cancelIntents -eq $true -and $h.revisionedJobs -eq $true) 'Compiled host launched and answered its authenticated local protocol.'
    $m=API '/api/capture/monitors';$w=API '/api/capture/windows';Add-DesktopCheck 'Screen-capture service answers' ($h.screenCapture -eq $true -and $h.windowsGraphicsCapture -eq $false -and $m.monitors.Count -ge 1 -and $w.format -eq 'eightmax-capture-windows') 'Monitors and windows were enumerated through documented Win32 calls; Windows Graphics Capture is not implemented.'
    $refused=$false;try{$null=API '/api/capture/open' 'POST' ([pscustomobject]@{target=[pscustomobject]@{kind='region';x=0;y=0;width=64;height=64}})}catch{$refused=$true};Add-DesktopCheck 'Capture needs explicit consent' $refused 'A capture request without operator consent was refused.'
    $blocked=$false;try{$null=Invoke-WebRequest -Uri ($session.origin+'/api/desktop/health') -UseBasicParsing -TimeoutSec 5}catch{$blocked=([int]$_.Exception.Response.StatusCode -eq 403)};Add-DesktopCheck 'Unauthenticated API refusal' $blocked 'API requests require the current private desktop session.'
    $blocked=$false;try{$wrong=@{'X-EightMax-Session'=[string]$session.token;Origin='https://example.invalid'};$null=Invoke-WebRequest -Uri ($session.origin+'/api/desktop/health') -Headers $wrong -UseBasicParsing -TimeoutSec 5}catch{$blocked=([int]$_.Exception.Response.StatusCode -eq 403)};Add-DesktopCheck 'Foreign origin refusal' $blocked 'A foreign Origin was refused; no external network request was made.'
    $job=[IO.File]::ReadAllText((Join-Path $root 'examples\native-reviewed-demo-job.json'))|ConvertFrom-Json
    $job.id='desktop-acceptance';$job.workbench=[pscustomobject]@{slot=2;token='accept-'+[guid]::NewGuid().ToString('N')}
    $s=API '/api/native/jobs' 'POST' $job;$firstId=$s.id
    $same=API '/api/native/jobs' 'POST' $job
    Add-DesktopCheck 'Idempotent native submission' ($same.id -eq $firstId -and $same.revision -eq 1) 'A repeated bound submission returned its existing attempt.'
    $found=API '/api/native/current';Add-DesktopCheck 'Read-only current study recovery' ($found.format -eq 'eightmax-desktop-current' -and $found.status.id -eq $firstId -and $found.job.workbench.token -eq $job.workbench.token) 'Current study discovery returned the bound job without submitting or resuming it.'
    $s=Await-Job $firstId 120 $job.iterations
    if($s.stage -ne 'complete'){throw 'Managed reviewed native run did not complete'}
    $result=API ('/api/native/jobs/'+$s.id+'/result')
    $valid=$result.version -eq 2 -and $result.training.iterations -eq $job.iterations -and $result.rootQuery.study.updates -eq $result.query.study.updates -and $result.query.node.actor -eq $job.reviewed.actor -and $result.rootQuery.node.actor -eq 0 -and [math]::Abs($result.query.node.pot-$job.reviewed.pot) -lt 1e-9
    Add-DesktopCheck 'Managed reviewed CPU workflow' $valid 'Real Windows native execution returned separate root/target queries at the captured actor and completed count.'
    if(-not $valid){throw 'Managed native result context disagrees with its fixture'}
    $job.id='desktop-cancel-resume';$job.iterations=200;$job.chunkUpdates=1;$job.workbench.token='accept-'+[guid]::NewGuid().ToString('N')
    $s=API '/api/native/jobs' 'POST' $job;$id=$s.id;$timer.Restart()
    do{$s=API ('/api/native/jobs/'+$id);if($s.nativeStatus -and $s.nativeStatus.committedUpdates -gt 0){break};if(-not $s.running -or $timer.Elapsed.TotalSeconds -gt 30){throw 'Could not observe a completed native checkpoint before cancellation'};Start-Sleep -Milliseconds 100}while($true)
    $s=API ('/api/native/jobs/'+$id+'/cancel') 'POST' @{revision=$s.revision};$cancelled=$s.stage -eq 'cancelled' -and $s.resumable -and -not $s.running;Add-DesktopCheck 'Native cancellation and checkpoint retention' $cancelled 'Managed process group stopped and retained a completed checkpoint.';if(-not $cancelled){throw 'Cancellation was not confirmed'}
    $checkpoint=[string]$s.nativeStatus.checkpoint;$savedHash=(Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash
    $headers['X-EightMax-Revision']=[string]($s.revision+1);try{$fence=API '/api/native/cancel-intent' 'POST' $job}finally{$headers.Remove('X-EightMax-Revision')}
    $skipped=API ('/api/native/jobs/'+$id+'/resume') 'POST' @{revision=$s.revision}
    Add-DesktopCheck 'Cancel resume before acknowledgment' ($fence.fenced -eq $true -and $skipped.revision -eq ($s.revision+1) -and $skipped.stage -eq 'cancelled' -and $skipped.resumable -and -not $skipped.running) 'A fenced resume attempt was skipped without losing its completed checkpoint.'
    $s=$skipped
    $previousRevision=$s.revision;$s=API ('/api/native/jobs/'+$id+'/resume') 'POST' @{revision=$previousRevision}
    $same=API ('/api/native/jobs/'+$id+'/resume') 'POST' @{revision=$previousRevision};Add-DesktopCheck 'Idempotent checkpoint resume' ($same.id -eq $id -and $same.revision -eq ($previousRevision+1)) 'Repeating the same resume revision returned its already-created attempt.'
    $blocked=$false;try{$null=API ('/api/native/jobs/'+$id+'/cancel') 'POST' @{revision=$previousRevision}}catch{$blocked=([int]$_.Exception.Response.StatusCode -eq 409)}
    Add-DesktopCheck 'Stale attempt cancellation refusal' $blocked 'An older attempt could not cancel its resumed successor.'
    $s=Await-Job $id 120 $job.iterations;$result=API ('/api/native/jobs/'+$id+'/result')
    Add-DesktopCheck 'Stable restore and training targets' ($s.targetUpdates -eq $job.iterations -and $s.nativeStatus.targetUpdates -eq $job.iterations) 'Every observed restore/training status retained the job target and bounded committed counters.'
    $resumed=$s.stage -eq 'complete' -and $result.training.iterations -eq 200 -and (Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash -eq $savedHash;Add-DesktopCheck 'Native resume to cumulative target' $resumed 'Resume completed the same bound job without modifying its input checkpoint.'
    $job.id='desktop-fenced-submission';$job.workbench.token='fenced-'+[guid]::NewGuid().ToString('N')
    $headers['X-EightMax-Revision']='1';try{$fence=API '/api/native/cancel-intent' 'POST' $job}finally{$headers.Remove('X-EightMax-Revision')}
    $blocked=$false;try{$null=API '/api/native/jobs' 'POST' $job}catch{$blocked=([int]$_.Exception.Response.StatusCode -eq 409)}
    Add-DesktopCheck 'Cancel before submission acknowledgment' ($fence.fenced -eq $true -and $fence.revision -eq 1 -and $blocked) 'A cancelled binding was refused when its delayed initial submission arrived.'

    . (Join-Path $PSScriptRoot 'Test-Native-History.ps1')

} catch {Add-DesktopCheck 'Desktop acceptance completed' $false $_.Exception.Message}
finally {
    if($session -and $headers){try{$null=API '/api/desktop/shutdown' 'POST'}catch{}}
    if($hostProcess){if(-not $hostProcess.WaitForExit(5000)){$hostProcess.Kill();$hostProcess.WaitForExit();Add-DesktopCheck 'Graceful desktop shutdown' $false 'The test had to terminate its owned host process.'}else{Add-DesktopCheck 'Graceful desktop shutdown' $true 'Desktop host exited after its authenticated shutdown request.'};$hostProcess.Dispose()}
    if(Test-Path -LiteralPath (Join-Path $folder 'private-session.json')){Remove-Item -LiteralPath (Join-Path $folder 'private-session.json') -Force}
    $report=[ordered]@{format='eightmax-windows-diagnostics';version=1;appVersion='0.25.0';build=$ExpectedEightMaxBuild;timestampUtc=[DateTime]::UtcNow.ToString('o');checks=$checks.ToArray();liveCapacityEstablished=$false;scope='Windows desktop build, private local protocol and synthetic native CPU acceptance only; not live recognition, GPU performance or table capacity.'}
    $path=Join-Path $folder 'EightMax-desktop-acceptance.json';Write-WorkbenchUtf8 $path ($report|ConvertTo-Json -Depth 30)
    Write-Host ('Acceptance report: '+$path);Start-Process -FilePath 'explorer.exe' -ArgumentList (Quote-WorkbenchPath $folder)|Out-Null
}
if(@($checks|Where-Object {-not $_.passed}).Count){exit 1}
