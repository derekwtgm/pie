# GUI manager for the unchanged EightMax 5.1 CPU CLI. Windows execution unverified here.
param([string]$JobFile, [string]$ResumeCheckpoint, [switch]$ChooseCheckpoint, [switch]$Headless, [string]$WorkDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\windows\Common.ps1')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$cli = Join-Path $PSScriptRoot 'mwcli.exe'
$script:child=$null; $script:work=$null; $script:cancel=$false; $script:running=$true; $script:latest=''
$script:committed=0; $script:target=1; $script:startUpdates=0; $script:stage='starting'; $script:job=$null
$watch=[Diagnostics.Stopwatch]::StartNew(); $mutex=$null; $locked=$false
$form=New-Object Windows.Forms.Form; $form.Text='EightMax native CPU study'; $form.Size=New-Object Drawing.Size(640,400); $form.StartPosition='CenterScreen'
$label=New-Object Windows.Forms.Label; $label.Location=New-Object Drawing.Point(18,18); $label.Size=New-Object Drawing.Size(590,45); $form.Controls.Add($label)
$progress=New-Object Windows.Forms.ProgressBar; $progress.Location=New-Object Drawing.Point(18,70); $progress.Size=New-Object Drawing.Size(590,22); $form.Controls.Add($progress)
$log=New-Object Windows.Forms.TextBox; $log.Location=New-Object Drawing.Point(18,106); $log.Size=New-Object Drawing.Size(590,195); $log.Multiline=$true; $log.ReadOnly=$true; $log.ScrollBars='Vertical'; $form.Controls.Add($log)
$cancelButton=New-Object Windows.Forms.Button; $cancelButton.Text='Cancel'; $cancelButton.Location=New-Object Drawing.Point(18,315); $cancelButton.Add_Click({$script:cancel=$true}); $form.Controls.Add($cancelButton)
$folderButton=New-Object Windows.Forms.Button; $folderButton.Text='Open job folder'; $folderButton.Size=New-Object Drawing.Size(140,28); $folderButton.Location=New-Object Drawing.Point(125,315); $folderButton.Add_Click({if($script:work){Start-Process -FilePath 'explorer.exe' -ArgumentList (Quote-WorkbenchPath $script:work) | Out-Null}}); $form.Controls.Add($folderButton)
$form.Add_FormClosing({param($sender,$e) if($script:running){$script:cancel=$true;$e.Cancel=$true}})
function Update-Display([string]$Message) {
    $label.Text = "$script:stage | $script:committed / $script:target committed updates | $([math]::Round($watch.Elapsed.TotalSeconds,1)) seconds elapsed"
    $denominator=[math]::Max(1,$script:target-$script:startUpdates)
    $progress.Value=if($script:committed -ge $script:target){100}else{[math]::Max(0,[math]::Min(100,[math]::Floor(100*($script:committed-$script:startUpdates)/$denominator)))}
    if($Message){if($log.TextLength -gt 30000){$log.Text=$log.Text.Substring($log.TextLength-20000)};$log.AppendText($Message+"`r`n")}
    [Windows.Forms.Application]::DoEvents()
}
function Write-Status([string]$Message) {
    if($Message.Length -gt 2000){$Message=$Message.Substring(0,2000)}
    Update-Display $Message
    if(-not $script:work){return}
    $id=if($script:job){[string]$script:job.id}else{''}
    $binding=if($script:job){$script:job.workbench}else{$null}
    $status=[ordered]@{format='eightmax-native-job-status';version=1;build=$ExpectedEightMaxBuild;id=$id;workbench=$binding;stage=$script:stage;committedUpdates=$script:committed;targetUpdates=$script:target;elapsedMs=$watch.Elapsed.TotalMilliseconds;message=$Message;checkpoint=$script:latest}
    $path=Join-Path $script:work 'job-status.json';$temporary=$path+'.tmp'
    Write-WorkbenchUtf8 $temporary ($status | ConvertTo-Json -Depth 8)
    if([IO.File]::Exists($path)){[IO.File]::Replace($temporary,$path,$null)}else{[IO.File]::Move($temporary,$path)}
}
function Invoke-Native([string]$Arguments,[string]$Name,[double]$Timeout) {
    if($script:cancel){throw [OperationCanceledException]::new('Study cancelled; last completed checkpoint retained.')}
    if($Timeout -le 0){throw 'Training timeout reached; last completed checkpoint retained.'}
    $stdout=Join-Path $script:work ($Name+'.stdout.json');$stderr=Join-Path $script:work ($Name+'.stderr.txt')
    $script:child=Start-Process -FilePath $cli -ArgumentList $Arguments -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    $null=$script:child.Handle
    $timer=[Diagnostics.Stopwatch]::StartNew()
    while(-not $script:child.HasExited){
        Update-Display ''
        if($script:cancel){$script:child.Kill();$script:child.WaitForExit();throw [OperationCanceledException]::new('Study cancelled; last completed checkpoint retained.')}
        if($timer.Elapsed.TotalSeconds -gt $Timeout){$script:child.Kill();$script:child.WaitForExit();throw "$Name exceeded its time budget; last completed checkpoint retained."}
        Start-Sleep -Milliseconds 50;$script:child.Refresh()
    }
    $script:child.WaitForExit()
    if($script:child.ExitCode -ne 0){$reason=[IO.File]::ReadAllText($stderr);if($reason.Length -gt 2000){$reason=$reason.Substring(0,2000)};throw "Native $Name failed ($($script:child.ExitCode)): $reason"}
    $text=[IO.File]::ReadAllText($stdout);if($text.Length -gt 4000000){throw 'Native output exceeded 4 MB'};return $text
}
# 0.18: one convergence check on the latest completed checkpoint with the engine's own `mwcli --gain`.
# Auto tries exact best response, then restricted, then sampled (lower bounds). A failed check never fails the study.
function Measure-Convergence([int]$Updates,[string]$SpecPath){
    $clock=[Diagnostics.Stopwatch]::StartNew();$attempts=New-Object Collections.Generic.List[object];$response=$null
    foreach($method in $convMethods){
        Write-Status "Measuring convergence at $Updates updates ($method best response). Checkpoint is not modified."
        $requestPath=Join-Path $script:work 'gain-request.json'
        Write-WorkbenchUtf8 $requestPath (([ordered]@{method=$method;timeLimitMs=[int]$conv.timeLimitSeconds*1000;threads=$threads})|ConvertTo-Json -Compress)
        try{
            $text=Invoke-Native ('--gain '+(Quote-WorkbenchPath $SpecPath)+' '+(Quote-WorkbenchPath $script:latest)+' '+(Quote-WorkbenchPath $requestPath)+" $memory") ('gain-'+$Updates+'-'+$method) ([double]$conv.timeLimitSeconds+$sideTimeout)
            $response=$text|ConvertFrom-Json
            if($null -ne $response.execution){$response.PSObject.Properties.Remove('execution')}
            if($null -ne $response.utility -and $null -ne $response.utility.convention){$response.utility.PSObject.Properties.Remove('convention')}
            break
        }catch [OperationCanceledException]{throw}
        catch{$message=[string]$_.Exception.Message;if($message.Length -gt 600){$message=$message.Substring(0,600)};$attempts.Add([ordered]@{method=$method;error=$message.Trim()});$response=$null}
    }
    return [ordered]@{updates=$Updates;elapsedMs=$clock.Elapsed.TotalMilliseconds;attempts=@($attempts);response=$response}
}
try {
    if($Headless -and -not $JobFile){throw 'Headless native jobs require an explicit job file'}
    if(-not $JobFile){$dialog=New-Object Windows.Forms.OpenFileDialog;$dialog.Title='Select the exported EightMax native job';$dialog.Filter='Native job JSON (*.json)|*.json';if($dialog.ShowDialog() -ne 'OK'){exit 0};$JobFile=$dialog.FileName}
    if((Get-Item -LiteralPath $JobFile).Length -gt 1000000){throw 'Native job exceeds 1 MB'}
    $script:job=[IO.File]::ReadAllText([IO.Path]::GetFullPath($JobFile)) | ConvertFrom-Json
    if($script:job.format -ne 'eightmax-workbench-native-job' -or $script:job.version -notin @(1,2) -or $script:job.engine.build -ne $ExpectedEightMaxBuild){throw 'Unsupported native job/build'}
    $null=Get-WorkbenchInteger $script:job.version 1 2 'job version'
    $iterations=Get-WorkbenchInteger $script:job.iterations 1 10000000 'updates';$threads=Get-WorkbenchInteger $script:job.threads 1 4 'threads';$memory=Get-WorkbenchInteger $script:job.memoryMiB 32 16384 'strategy memory';$timeout=Get-WorkbenchInteger $script:job.timeoutSeconds 1 604800 'training time limit'
    $chunk=1000;if($null -ne $script:job.chunkUpdates){$chunk=Get-WorkbenchInteger $script:job.chunkUpdates 1 1000000 'checkpoint interval'}
    # 0.18: refuse a strategy budget the PC cannot hold (80% of physical RAM, leaving 512 MiB). Skipped only if Windows cannot report memory.
    try{$totalMiB=[math]::Floor((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory/1MB)}catch{$totalMiB=0}
    if($totalMiB -gt 0 -and $memory -gt [math]::Floor($totalMiB*0.8)-512){throw "Strategy budget $memory MiB is too large for this PC ($totalMiB MiB RAM). Use at most $([math]::Max(32,[math]::Floor($totalMiB*0.8)-512)) MiB."}
    $sideTimeout=[math]::Min(3600,30+[math]::Ceiling($memory/32))
    # 0.18 convergence settings; a job without them uses the defaults (auto, final check only, 30 s, 1% of pot).
    $conv=[ordered]@{method='auto';everyChunks=0;timeLimitSeconds=30;targetPctPot=1}
    if($null -ne $script:job.convergence){foreach($p in $script:job.convergence.PSObject.Properties){if(-not $conv.Contains($p.Name)){throw 'Unknown convergence setting'};$conv[$p.Name]=$p.Value}}
    if($conv.method -notin @('auto','exact','restricted','sampled','off')){throw 'Invalid convergence method'}
    $null=Get-WorkbenchInteger $conv.everyChunks 0 1000 'convergence interval';$null=Get-WorkbenchInteger $conv.timeLimitSeconds 5 3600 'convergence time limit'
    if(-not ($conv.targetPctPot -is [double] -or $conv.targetPctPot -is [int] -or $conv.targetPctPot -is [decimal] -or $conv.targetPctPot -is [long]) -or [double]$conv.targetPctPot -lt 0.001 -or [double]$conv.targetPctPot -gt 100){throw 'Invalid convergence target'}
    $convMethods=@(switch($conv.method){'auto'{'exact';'restricted';'sampled'}'off'{}default{[string]$conv.method}})
    $script:measurements=New-Object Collections.Generic.List[object]
    if($script:job.spec.protocol -ne 4 -or $script:job.spec.algorithm -ne 'external' -or $script:job.spec.device -ne 'cpu'){throw 'Only CPU protocol-4 external-sampling jobs are supported'}
    if($script:job.query.path -isnot [array] -or $script:job.query.board -isnot [array] -or @($script:job.query.path).Count -gt 128 -or @($script:job.query.board).Count -gt 5){throw 'Invalid native action/card query'}
    foreach($a in $script:job.query.path){$null=Get-WorkbenchInteger $a 0 6 'query action'}
    foreach($c in $script:job.query.board){$null=Get-WorkbenchInteger $c 0 51 'query card'}
    $null=Get-WorkbenchInteger $script:job.query.offset 0 0 'query offset';$null=Get-WorkbenchInteger $script:job.query.limit 1326 1326 'query limit'
    if($script:job.version -eq 1){if(@($script:job.query.path).Count -ne 0 -or @($script:job.query.board).Count -ne 0 -or $null -ne $script:job.reviewed){throw 'Version-1 jobs accept root queries only'}}
    else{
        $node=$script:job.reviewed
        if($node.format -ne 'eightmax-reviewed-node' -or $node.version -ne 1 -or $node.engine.build -ne $ExpectedEightMaxBuild -or $node.decisionReady -ne $false -or $null -eq $node.steps -or @($node.steps).Count -gt 128){throw 'Invalid reviewed native target'}
        if($null -eq $script:job.workbench -or $script:job.workbench.token -notmatch '^[a-zA-Z0-9_-]{1,80}$'){throw 'Reviewed jobs must retain their exported study binding'}
        $null=Get-WorkbenchInteger $script:job.workbench.slot 1 10 'study slot'
        $actions=@($node.steps | Where-Object {$_ -isnot [pscustomobject]})
        if(($actions -join ',') -cne (@($script:job.query.path) -join ',')){throw 'Query path differs from reviewed target'}
        $cards=@($node.board | Select-Object -Skip @($script:job.spec.board).Count)
        if(($cards -join ',') -cne (@($script:job.query.board) -join ',')){throw 'Query cards differ from reviewed target'}
    }
    if((Get-FileHash -LiteralPath $cli -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedEightMaxHash){throw 'Bundled native binary identity differs from EightMax 5.1'}
    $mutex=New-Object Threading.Mutex($false,'Local\EightMaxWorkbenchNativeJob');try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true};if(-not $locked){throw 'Another native study is running'}
    $nativeRoot=[IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EightMax-Test-Workbench\NativeJobs'))
    if($WorkDirectory){$full=[IO.Path]::GetFullPath($WorkDirectory);if(-not $Headless -or -not $full.StartsWith($nativeRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $full -Leaf) -notmatch '^desktop-[a-f0-9]{32}$'){throw 'Invalid managed native work folder'};$script:work=$full}
    else{$script:work=Join-Path $nativeRoot ([guid]::NewGuid().ToString('N'))}
    [IO.Directory]::CreateDirectory($script:work)|Out-Null
    Write-Host ('Job folder: '+$script:work)
    Write-WorkbenchUtf8 (Join-Path $script:work 'job.json') ($script:job | ConvertTo-Json -Depth 70)
    $specPath=Join-Path $script:work 'spec.json';$queryPath=Join-Path $script:work 'query.json'
    Write-WorkbenchUtf8 $specPath ($script:job.spec | ConvertTo-Json -Depth 60 -Compress)
    $safeQuery=[ordered]@{path=@($script:job.query.path);board=@($script:job.query.board);offset=0;limit=1326}
    Write-WorkbenchUtf8 $queryPath ($safeQuery | ConvertTo-Json -Depth 5 -Compress)
    $rootQueryPath=Join-Path $script:work 'root-query.json';Write-WorkbenchUtf8 $rootQueryPath '{"path":[],"board":[],"offset":0,"limit":1326}'
    $script:target=$iterations;if(-not $Headless){$form.Show()};Write-Status 'Validating the bundled engine. No poker client is accessed.'
    if((Invoke-Native '--build-id' 'build' 5).Trim() -ne ('EightMaxBuild='+$ExpectedEightMaxBuild)){throw 'Native build identity mismatch'}
    if($ChooseCheckpoint){$dialog=New-Object Windows.Forms.OpenFileDialog;$dialog.Title='Select a compatible completed checkpoint';$dialog.Filter='EightMax checkpoints (*.state;*.emmw;*.emz)|*.state;*.emmw;*.emz|All files (*.*)|*.*';$dialog.InitialDirectory=Split-Path $script:work -Parent;if($dialog.ShowDialog() -ne 'OK'){throw [OperationCanceledException]::new('Checkpoint selection cancelled.')};$ResumeCheckpoint=$dialog.FileName}
    if($ResumeCheckpoint){
        $script:stage='restoring';$candidate=[IO.Path]::GetFullPath($ResumeCheckpoint);Write-Status 'Checking checkpoint against this exact study spec.'
        $restore=(Invoke-Native ('--restore '+(Quote-WorkbenchPath $specPath)+' '+(Quote-WorkbenchPath $candidate)+" $memory") 'restore' $sideTimeout)|ConvertFrom-Json
        $restoredUpdates=Get-WorkbenchInteger $restore.iterations 0 10000000 'checkpoint updates'
        if($restoredUpdates -gt $iterations){throw 'Checkpoint contains more updates than this job requests. Export a larger total update target.'}
        $script:latest=$candidate;$script:committed=$restoredUpdates;$script:startUpdates=$restoredUpdates
    }
    $script:target=$iterations;$script:stage='training';$trainingWatch=[Diagnostics.Stopwatch]::StartNew();$batch=0;$training=if($script:latest){$restore}else{$null}
    while($script:committed -lt $script:target){
        $count=[math]::Min($chunk,$script:target-$script:committed);$statePath=Join-Path $script:work ('checkpoint-'+($batch%2)+'.state')
        Write-Status "Training up to $count additional updates. Last completed checkpoint remains intact."
        $arguments=(Quote-WorkbenchPath $specPath)+" $count $threads "+(Quote-WorkbenchPath $statePath)+" $memory";if($script:latest){$arguments+=' '+(Quote-WorkbenchPath $script:latest)}
        $before=$script:committed;$training=(Invoke-Native $arguments ('training-'+$batch) ($timeout-$trainingWatch.Elapsed.TotalSeconds))|ConvertFrom-Json
        $actual=Get-WorkbenchInteger $training.iterations $before $script:target 'committed updates'
        if($actual -eq $before -and -not $training.limitReached){throw 'Training made no progress'}
        $script:latest=$statePath;$script:committed=$actual;$batch++;Write-Status 'Completed checkpoint saved.'
        if($training.limitReached){break}
        if($convMethods.Count -and [int]$conv.everyChunks -gt 0 -and ($batch % [int]$conv.everyChunks) -eq 0 -and $script:committed -lt $script:target -and $script:measurements.Count -lt 50){
            $trainingWatch.Stop();try{$script:measurements.Add((Measure-Convergence $script:committed $specPath))}finally{$trainingWatch.Start()};$script:stage='training'
        }
    }
    $training | Add-Member -NotePropertyName requestedTotalUpdates -NotePropertyValue $script:target -Force
    $script:stage='querying';Write-Status 'Querying stored policies from the last completed checkpoint.'
    $rootQuery=$null
    if($script:job.version -eq 2){$rootQuery=(Invoke-Native ('--node '+(Quote-WorkbenchPath $specPath)+' '+(Quote-WorkbenchPath $script:latest)+' '+(Quote-WorkbenchPath $rootQueryPath)+" $memory") 'root-query' $sideTimeout)|ConvertFrom-Json}
    $query=(Invoke-Native ('--node '+(Quote-WorkbenchPath $specPath)+' '+(Quote-WorkbenchPath $script:latest)+' '+(Quote-WorkbenchPath $queryPath)+" $memory") 'query' $sideTimeout)|ConvertFrom-Json
    if($convMethods.Count){$script:measurements.Add((Measure-Convergence $script:committed $specPath));$script:stage='querying'}
    $convergence=[ordered]@{format='eightmax-native-convergence';version=1;settings=$conv;measurements=@($script:measurements)}
    $result=[ordered]@{format='eightmax-workbench-native-result';version=$script:job.version;build=$ExpectedEightMaxBuild;job=$script:job;training=$training;query=$query;elapsedMs=$watch.Elapsed.TotalMilliseconds}
    $result.Add('convergence',$convergence)
    if($script:job.version -eq 2){$result.Add('rootQuery',$rootQuery)}
    if($script:cancel){throw [OperationCanceledException]::new('Study cancelled; last completed checkpoint retained.')}
    $resultText=$result|ConvertTo-Json -Depth 70
    if([Text.Encoding]::UTF8.GetByteCount($resultText) -gt 6000000){throw 'Native result exceeds 6 MB; checkpoint retained. Use narrower explicit ranges or a smaller reviewed proof.'}
    $output=Join-Path $script:work 'result.native-result.json';Write-WorkbenchUtf8 $output $resultText
    $script:stage='complete';Write-Status 'Result ready. Import it into the original study slot.';$script:running=$false;$cancelButton.Enabled=$false
    if(-not $Headless){Start-Process -FilePath 'explorer.exe' -ArgumentList (Quote-WorkbenchPath $script:work) | Out-Null
    [Windows.Forms.MessageBox]::Show("Result ready. Import this file in the Study workspace:`n`n$output`n`nCheckpoints and job-status.json are in the same folder.",'EightMax native study complete')|Out-Null}
} catch [OperationCanceledException] { $script:stage='cancelled';Write-Status $_.Exception.Message;Write-Host $_.Exception.Message;exit 2
} catch { $script:stage='failed';try{Write-Status $_.Exception.Message}catch{};if(-not $Headless){[Windows.Forms.MessageBox]::Show($_.Exception.Message,'EightMax native job failed','OK','Error')|Out-Null}else{Write-Host $_.Exception.Message};exit 1
} finally {
    if($script:child -and -not $script:child.HasExited){try{$script:child.Kill();$script:child.WaitForExit()}catch{}}
    $script:running=$false;$form.Dispose();if($locked -and $mutex){$mutex.ReleaseMutex()};if($mutex){$mutex.Dispose()}
}
