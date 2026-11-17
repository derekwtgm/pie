# Dot-sourced by Test-Desktop.ps1 inside its owned headless test session.
if(-not (Get-Command API -ErrorAction SilentlyContinue)){throw 'Run RUN-DESKTOP-CHECKS.cmd for the complete owned-host acceptance workflow.'}
$history=API '/api/native/history';$saved=API ('/api/native/history/'+$firstId)
Add-DesktopCheck 'Persistent native result history' ($history.format -eq 'eightmax-native-history' -and $saved.id -eq $firstId -and $saved.status.resultAvailable) 'The completed managed result was retained after another study replaced the current job.'
$job.id='history-checkpoint';$job.iterations=200;$job.chunkUpdates=1;$job.workbench.slot=3;$job.workbench.token='history-'+[guid]::NewGuid().ToString('N')
$s=API '/api/native/jobs' 'POST' $job;$historyId=$s.id;$timer.Restart()
do{$s=API ('/api/native/jobs/'+$historyId);if($s.nativeStatus -and $s.nativeStatus.committedUpdates -gt 0){break};if(-not $s.running -or $timer.Elapsed.TotalSeconds -gt 30){throw 'No completed archive checkpoint observed'};Start-Sleep -Milliseconds 100}while($true)
$s=API ('/api/native/jobs/'+$historyId+'/cancel') 'POST' @{revision=$s.revision};if(-not $s.resumable){throw 'Archive checkpoint was not retained'}
$checkpoint=[string]$s.nativeStatus.checkpoint;$checkpointHash=(Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash
$oldToken=[string]$session.token;$null=API '/api/desktop/shutdown' 'POST'
if(-not $hostProcess.WaitForExit(5000)){throw 'Owned host did not exit before history restart'};$hostProcess.Dispose();$hostProcess=$null
$restartArgs='-NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File '+(Quote-WorkbenchPath $starter)+' -Headless -ReadyFile '+(Quote-WorkbenchPath $ready)
$restart=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $restartArgs -RedirectStandardOutput (Join-Path $folder 'history-restart.stdout.txt') -RedirectStandardError (Join-Path $folder 'history-restart.stderr.txt') -PassThru
$null=$restart.Handle;if(-not $restart.WaitForExit(45000)){$restart.Kill();throw 'History restart build/launch timed out'};$restart.WaitForExit();if($restart.ExitCode -ne 0){throw 'History restart failed'}
$timer.Restart();while(-not (Test-Path -LiteralPath $ready)){if($timer.Elapsed.TotalSeconds -gt 20){throw 'Restarted history host did not become ready'};Start-Sleep -Milliseconds 100}
$session=[IO.File]::ReadAllText($ready)|ConvertFrom-Json;$headers=@{'X-EightMax-Session'=[string]$session.token};$hostProcess=Get-Process -Id $session.processId;$null=$hostProcess.Handle
$current=API '/api/native/current';Add-DesktopCheck 'History restart is idle' ($session.token -ne $oldToken -and $null -eq $current.job -and (Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash -eq $checkpointHash) 'A fresh host credential was created; no saved study started and checkpoint bytes stayed unchanged.'
$saved=API ('/api/native/history/'+$historyId);$oldEtag=$saved.etag;$opened=API ('/api/native/history/'+$historyId+'/open') 'POST' @{etag=$saved.etag}
Add-DesktopCheck 'Open archived checkpoint without training' ($opened.status.resumable -and -not $opened.status.running -and $opened.status.id -eq $historyId -and (Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash -eq $checkpointHash) 'Archive selection restored the same job/binding without changing checkpoint bytes.'
$s=API ('/api/native/jobs/'+$historyId+'/resume') 'POST' @{revision=$opened.status.revision};$s=Await-Job $historyId 120 200
Add-DesktopCheck 'Resume archived checkpoint after host restart' ($s.stage -eq 'complete' -and (Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash -eq $checkpointHash) 'Explicit resume reached the original target and preserved its input checkpoint.'
$blocked=$false;try{$null=API ('/api/native/history/'+$historyId+'/open') 'POST' @{etag=$oldEtag}}catch{$blocked=([int]$_.Exception.Response.StatusCode -eq 409)};Add-DesktopCheck 'Stale archive record refusal' $blocked 'A changed saved revision could not be opened with its previous record token.'
$demo=[IO.File]::ReadAllText((Join-Path $root 'examples\native-batch-demo.json'))|ConvertFrom-Json;$demo.id=[guid]::NewGuid().ToString('N')
foreach($entry in $demo.jobs){$entry.iterations=80;$entry.chunkUpdates=20;$entry.workbench.token='batch-'+[guid]::NewGuid().ToString('N')}
$b=API '/api/native/batch' 'POST' $demo;$same=API '/api/native/batch' 'POST' $demo
Add-DesktopCheck 'Idempotent sequential batch submission' ($b.id -eq $same.id -and $same.items.Count -eq 2) 'Repeated delivery returned the same two-study batch.'
$timer.Restart();do{$currentBatch=API '/api/native/batch';$b=$currentBatch.batch;if(@($b.items|Where-Object {$_.stage -eq 'running'}).Count -gt 1){throw 'More than one native batch study was reported running'};if(-not $b.running){break};if($timer.Elapsed.TotalSeconds -gt 120){throw 'Two-study batch acceptance timed out'};Start-Sleep -Milliseconds 200}while($true)
$complete=$b.stage -eq 'complete' -and @($b.items|Where-Object {$_.stage -eq 'complete' -and $_.updates -eq 80}).Count -eq 2
Add-DesktopCheck 'Sequential native batch saved results' $complete 'Two root/reviewed studies completed sequentially with distinct saved result identities.'
if(-not $complete){throw 'Native batch did not complete both study targets'}
foreach($entry in $b.items){$archived=API ('/api/native/history/'+$entry.archiveId);if(-not $archived.status.resultAvailable -or $archived.quality.partial -or $archived.quality.completedUpdates -ne 80){throw 'Batch archive result/counters were inconsistent'}}
$demo.id=[guid]::NewGuid().ToString('N');foreach($entry in $demo.jobs){$entry.workbench.token='fenced-batch-'+[guid]::NewGuid().ToString('N')}
$fence=API ('/api/native/batch/'+$demo.id+'/cancel') 'POST';$blocked=$false;try{$null=API '/api/native/batch' 'POST' $demo}catch{$blocked=([int]$_.Exception.Response.StatusCode -eq 409)}
Add-DesktopCheck 'Batch cancellation before delivery' ($fence.cancelled -and $blocked) 'A cancelled batch identity could not start when its delayed submission arrived.'
