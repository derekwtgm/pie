# EightMax Test Workbench 0.35.0 - desktop host acceptance (actual Windows; NOT executed by the Linux unit tests).
# 0.26.0 failures on the target PC and what changed:
#  * "The remote server returned an error: (400) Bad Request." with no request recorded. Every request now goes through API, which
#    records step, method, route, HTTP status, structured server error code, safe message and duration in desktop-requests.json
#    (never the session token or request bodies). Failed requests raise an error naming the exact step and request.
#    Confirmed server defect: POSTs with a body from Windows PowerShell 5.1 carry "Expect: 100-continue", which 0.26 refused (400).
#  * "Graceful desktop shutdown: FAILED". The finally block always asks for an authenticated shutdown, waits up to 20 s and records
#    why it fell back to terminating the process; owned mwcli.exe processes are checked and reported.
param([string]$OutDir)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root=Get-WorkbenchRoot
$folder=$(if($OutDir){[IO.Directory]::CreateDirectory($OutDir)|Out-Null;$OutDir}else{New-EmRunFolder 'Diagnostics\desktop'})
$checks=New-Object Collections.Generic.List[object];$session=$null;$hostProcess=$null;$headers=$null
$trace=New-Object Collections.Generic.List[object];$script:Step='startup';$script:StepStarted=[DateTime]::UtcNow.ToString('o')
function Set-Step([string]$Name){$script:Step=$Name;$script:StepStarted=[DateTime]::UtcNow.ToString('o')}
function Add-DesktopCheck([string]$Name,[bool]$Passed,[string]$Message,[string]$ErrorClass='',[string]$ErrorCode=''){
    if([string]::IsNullOrWhiteSpace($Message)){$Message="No message was produced at step '$($script:Step)'; see desktop-requests.json."}
    $checks.Add([ordered]@{name=$Name;passed=$Passed;required=$true;message=$Message.Substring(0,[math]::Min(2000,$Message.Length));status=$(if($Passed){'pass'}else{'fail'});stage=$script:Step;startedAt=$script:StepStarted;completedAt=[DateTime]::UtcNow.ToString('o');errorClass=$(if($Passed){$null}elseif($ErrorClass){$ErrorClass}else{'application-error'});errorCode=$(if($Passed){$null}elseif($ErrorCode){$ErrorCode}else{($Name -replace '[^A-Za-z0-9]+','-').ToLowerInvariant()+'-failed'})})
    try{Write-Host (('{0,-50} {1}  {2}' -f $Name,$(if($Passed){'PASS'}else{'FAIL'}),$Message))}catch{}
}
function Read-ErrorBody($Response){try{$reader=New-Object IO.StreamReader($Response.GetResponseStream());$text=$reader.ReadToEnd();$reader.Dispose();return $text}catch{return ''}}
function API([string]$Path,[string]$Method='GET',$Body=$null){
    $requestHeaders=@{};if($headers){foreach($k in $headers.Keys){$requestHeaders[$k]=$headers[$k]}};$requestHeaders['X-EightMax-Step']=($script:Step -replace '[^\x20-\x7e]','?')
    $requestOptions=@{Uri=$session.origin+$Path;Method=$Method;Headers=$requestHeaders;UseBasicParsing=$true;TimeoutSec=30}
    if($null -ne $Body){$requestOptions.ContentType='application/json';$requestOptions.Body=($Body|ConvertTo-Json -Depth 70 -Compress)}
    $watch=[Diagnostics.Stopwatch]::StartNew();$entry=[ordered]@{step=$script:Step;method=$Method;path=$Path;status=$null;code=$null;error=$null;ms=$null;at=[DateTime]::UtcNow.ToString('o')}
    try{
        $response=Invoke-WebRequest @requestOptions;$entry.status=[int]$response.StatusCode;$entry.ms=$watch.ElapsedMilliseconds;$trace.Add($entry)
        return $response.Content|ConvertFrom-Json
    }catch [Net.WebException]{
        $web=$_.Exception;$entry.ms=$watch.ElapsedMilliseconds
        if($web.Response){
            $entry.status=[int]$web.Response.StatusCode;$text=Read-ErrorBody $web.Response;$parsed=$null;try{$parsed=$text|ConvertFrom-Json}catch{}
            if($parsed){$entry.code=[string]$parsed.code;$entry.error=[string]$parsed.error;$entry.requestId=[string]$parsed.requestId}else{$entry.error=$text.Substring(0,[math]::Min(500,$text.Length))}
        }else{$entry.code='no-response';$entry.error=[string]$web.Status+': '+$web.Message}
        $trace.Add($entry)
        $detail='Step "'+$script:Step+'": '+$Method+' '+$Path+' -> HTTP '+$(if($entry.status){$entry.status}else{'none'})+' '+$(if($entry.code){'['+$entry.code+'] '}else{''})+$(if($entry.error){$entry.error}else{$web.Message})+' ('+$entry.ms+' ms)'
        throw (New-Object Net.WebException($detail,$web,$web.Status,$web.Response))
    }
}
function Await-Job([string]$Id,[int]$Seconds=120,[int]$Target=0){$watch=[Diagnostics.Stopwatch]::StartNew();do{$s=API ('/api/native/jobs/'+$Id);if($Target -gt 0 -and ($s.targetUpdates -ne $Target -or ($s.nativeStatus -and ($s.nativeStatus.targetUpdates -ne $Target -or $s.nativeStatus.committedUpdates -gt $Target)))){throw 'Native status changed its original cumulative target or reported counters beyond it'};if(-not $s.running){return $s};if($watch.Elapsed.TotalSeconds -gt $Seconds){throw (New-Object TimeoutException("Managed native run $Id exceeded its $Seconds s wait bound at step '$($script:Step)'"))};Start-Sleep -Milliseconds 200}while($true)}
# Raw-socket probe: proves which bytes the host answers with, independently of Invoke-WebRequest (which hides error bodies).
function Invoke-RawProbe([string]$Request){
    $client=New-Object Net.Sockets.TcpClient;try{$client.ReceiveTimeout=8000;$client.SendTimeout=8000;$client.Connect('127.0.0.1',48713);$stream=$client.GetStream();$bytes=[Text.Encoding]::ASCII.GetBytes($Request);$stream.Write($bytes,0,$bytes.Length);$client.Client.Shutdown([Net.Sockets.SocketShutdown]::Send)
        $ms=New-Object IO.MemoryStream;$buffer=New-Object byte[] 8192;while(($n=$stream.Read($buffer,0,$buffer.Length)) -gt 0){$ms.Write($buffer,0,$n)};$text=[Text.Encoding]::UTF8.GetString($ms.ToArray());if($text.StartsWith("HTTP/1.1 100 ")){$text=$text.Substring($text.IndexOf("`r`n`r`n")+4)};$status=0;if($text -match '^HTTP/1\.1 (\d{3})'){$status=[int]$Matches[1]};$at=$text.IndexOf("`r`n`r`n");return [pscustomobject]@{status=$status;body=$(if($at -ge 0){$text.Substring($at+4)}else{$text})}}finally{$client.Close()}
}
function Get-OwnedNativeProcesses{try{return @(Get-CimInstance Win32_Process -Filter "Name='mwcli.exe'" -ErrorAction Stop)}catch{return @(Get-Process -Name 'mwcli' -ErrorAction SilentlyContinue)}}
$preexistingNative=@(Get-OwnedNativeProcesses|ForEach-Object {$_.ProcessId})
try {
    Set-Step 'release-integrity'
    $failures=@(Get-WorkbenchHashFailures $root);Add-DesktopCheck 'Release integrity' ($failures.Count -eq 0) $(if($failures.Count){$failures[0]}else{'Release files match their manifest.'});if($failures.Count){throw 'Release verification failed'}
    $parseErrors=New-Object Collections.Generic.List[string]
    foreach($file in Get-ChildItem (Join-Path $root 'windows'),(Join-Path $root 'native') -Filter '*.ps1'){$tokens=$null;$errors=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors);foreach($e in $errors){$parseErrors.Add($file.Name+': '+$e.Message)}}
    Add-DesktopCheck 'Windows PowerShell parsing' ($parseErrors.Count -eq 0) $(if($parseErrors.Count){$parseErrors[0]}else{'Windows scripts parsed without errors.'});if($parseErrors.Count){throw 'Fix PowerShell parse errors before launching'}
    Set-Step 'host-launch'
    $ready=Join-Path $folder 'private-session.json';$starter=Join-Path $root 'windows\Start-Desktop.ps1'
    $launcherArgs='-NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File '+(Quote-WorkbenchPath $starter)+' -Headless -ReadyFile '+(Quote-WorkbenchPath $ready)
    $start=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $launcherArgs -RedirectStandardOutput (Join-Path $folder 'desktop-build.stdout.txt') -RedirectStandardError (Join-Path $folder 'desktop-build.stderr.txt') -PassThru
    $null=$start.Handle;if(-not $start.WaitForExit(45000)){$start.Kill();throw (New-Object TimeoutException('Desktop build/launch exceeded 45 seconds'))};$start.WaitForExit();if($start.ExitCode -ne 0){throw 'Desktop build/launch failed; review desktop-build.stderr.txt'}
    $timer=[Diagnostics.Stopwatch]::StartNew();while(-not (Test-Path -LiteralPath $ready)){if($timer.Elapsed.TotalSeconds -gt 20){$err='';try{$err=[IO.File]::ReadAllText((Join-Path $folder 'desktop-build.stderr.txt')).Trim()}catch{};throw (New-Object TimeoutException('Desktop session was not ready within 20 s; close any existing desktop host first. Launcher stderr: '+$err))};Start-Sleep -Milliseconds 100}
    $session=[IO.File]::ReadAllText($ready)|ConvertFrom-Json
    if($session.format -ne 'eightmax-desktop-session' -or $session.origin -ne 'http://127.0.0.1:48713' -or $session.token -notmatch '^[a-f0-9]{64}$'){throw 'Invalid private desktop session metadata'}
    $hostProcess=Get-Process -Id $session.processId;$null=$hostProcess.Handle;$headers=@{'X-EightMax-Session'=[string]$session.token}
    Add-DesktopCheck 'Private session initialised' $true ('Host process '+$session.processId+' wrote its private session (app '+$session.appVersion+').')
    Set-Step 'protocol-probe'
    $probe=Invoke-RawProbe ("GET /api/desktop/health HTTP/1.1`r`nHost: 127.0.0.1:48713`r`nX-EightMax-Session: "+[string]$session.token+"`r`nConnection: close`r`n`r`n")
    $probeHealthStatus=$probe.status
    Add-DesktopCheck 'Raw protocol probe (health)' ($probe.status -eq 200) ('HTTP '+$probe.status+': '+$probe.body.Substring(0,[math]::Min(400,$probe.body.Length)))
    $probe=Invoke-RawProbe ("POST /api/native/cancel-intent HTTP/1.1`r`nHost: 127.0.0.1:48713`r`nX-EightMax-Session: "+[string]$session.token+"`r`nContent-Type: application/json`r`nExpect: 100-continue`r`nContent-Length: 2`r`n`r`n{}")
    Add-DesktopCheck 'Expect: 100-continue accepted (0.26 HTTP 400 regression)' ($probe.status -ne 0 -and $probe.body -notmatch 'framing' -and $probe.body -match '"code"') ('HTTP '+$probe.status+' (a validation refusal of the empty job is expected; a framing refusal is the 0.26 defect): '+$probe.body.Substring(0,[math]::Min(400,$probe.body.Length)))
    # 0.29: decisive first-request diagnosis (the target PC's 0.26 run got HTTP 400 on this very first GET; not reproducible on Linux,
    # where Windows PowerShell's exact request format succeeds even against the 0.26 host). Three independent paths are compared:
    # raw socket (above, no proxy possible) / Invoke-WebRequest with the system proxy settings / Invoke-WebRequest with no proxy.
    Set-Step 'loopback-proxy'
    $healthUri=[Uri]($session.origin+'/api/desktop/health');$sysProxy=[Net.WebRequest]::DefaultWebProxy;$bypassed=$true;$proxyFor=''
    try{if($sysProxy){$bypassed=$sysProxy.IsBypassed($healthUri);if(-not $bypassed){$proxyFor=[string]$sysProxy.GetProxy($healthUri)}}}catch{$proxyFor='unreadable: '+$_.Exception.Message}
    Add-DesktopCheck 'Loopback proxy bypass' $bypassed $(if($bypassed){'The Windows/.NET proxy settings send 127.0.0.1 directly (no proxy).'}else{'Requests to 127.0.0.1 would go through the proxy '+$proxyFor+'. A proxy that forwards loopback requests can explain the 0.26 HTTP 400; 0.29 accepts its absolute-form requests.'}) 'configuration-error' 'loopback-proxy-active'
    $av=@();try{$av=@(Get-CimInstance -Namespace 'root\SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction Stop|ForEach-Object {[string]$_.displayName})}catch{}
    Add-DesktopCheck 'Security software (information)' $true $(if($av.Count){'Registered antivirus/security products: '+($av -join ', ')+'. Some web-protection features inspect loopback HTTP.'}else{'No product listed in Windows Security Center (or not readable).'})
    $viaSystem=$null;$viaDirect=$null;$errSystem='';$errDirect=''
    try{$viaSystem=API '/api/desktop/health'}catch{$errSystem=$_.Exception.Message}
    $savedProxy=[Net.WebRequest]::DefaultWebProxy
    try{[Net.WebRequest]::DefaultWebProxy=[Net.GlobalProxySelection]::GetEmptyWebProxy();try{$viaDirect=API '/api/desktop/health'}catch{$errDirect=$_.Exception.Message}}finally{[Net.WebRequest]::DefaultWebProxy=$savedProxy}
    $rawOk=($probeHealthStatus -eq 200)
    $diagnosis=$(if($rawOk -and $viaSystem -and $viaDirect){'All three request paths succeeded: the 0.26 first-request HTTP 400 does not occur with this build.'}
        elseif($rawOk -and -not $viaSystem -and $viaDirect){'CAUSE FOUND: requests fail only through the system proxy settings ('+$errSystem+'). Something configured as a proxy intercepts loopback traffic. The remaining checks run without the proxy.'}
        elseif($rawOk -and -not $viaDirect){'The host answers raw requests but rejects Invoke-WebRequest even without a proxy: '+$errDirect+' (see desktop-requests.json for the refused request and its code).'}
        else{'Even a raw socket request was refused or got no answer: something between this PC and 127.0.0.1:48713 (security software or another program on the port) interferes. '+$errSystem})
    Add-DesktopCheck 'First-request diagnosis (0.26 HTTP 400)' ($rawOk -and ($viaSystem -or $viaDirect)) $diagnosis 'application-error' 'first-request-refused'
    if(-not $viaSystem -and $viaDirect){[Net.WebRequest]::DefaultWebProxy=[Net.GlobalProxySelection]::GetEmptyWebProxy();Add-DesktopCheck 'Proxy disabled for remaining requests' $true 'This test process now talks to the host directly.'}
    if($viaSystem -and $viaSystem.request -and $viaSystem.request.viaProxy){Add-DesktopCheck 'Request arrived through a proxy' $false 'The host saw proxy headers or an absolute-form target on the health request: local software is forwarding loopback HTTP.' 'configuration-error' 'loopback-proxy-forwarding'}
    Set-Step 'health'
    $h=API '/api/desktop/health';Add-DesktopCheck 'Desktop build and local health' ($h.build -eq $ExpectedEightMaxBuild -and $h.nativeCPU -eq $true -and $h.liveClientConnected -eq $false -and $h.currentJob -eq $true -and $h.cancelIntents -eq $true -and $h.revisionedJobs -eq $true) 'Compiled host launched and answered its authenticated local protocol.'
    Set-Step 'capture-enumeration'
    $m=API '/api/capture/monitors';$w=API '/api/capture/windows';Add-DesktopCheck 'Screen-capture service answers' ($h.screenCapture -eq $true -and ($h.windowsGraphicsCapture -is [bool]) -and (($h.windowsGraphicsCapture -eq $true) -eq (@($h.captureMethods) -contains 'windows-graphics-capture')) -and $m.monitors.Count -ge 1 -and $w.format -eq 'eightmax-capture-windows') ('Monitors and windows were enumerated through documented Win32 calls. Capture methods offered: '+(@($h.captureMethods) -join ', ')+'.')
    Set-Step 'capture-authorization'
    $refused=$false;try{$null=API '/api/capture/open' 'POST' ([pscustomobject]@{target=[pscustomobject]@{kind='region';x=0;y=0;width=64;height=64}})}catch{$refused=$true};Add-DesktopCheck 'Capture needs explicit consent' $refused 'A capture request without operator consent was refused.'
    $blocked=$false;try{$null=Invoke-WebRequest -Uri ($session.origin+'/api/desktop/health') -UseBasicParsing -TimeoutSec 5}catch{$blocked=([int]$_.Exception.Response.StatusCode -eq 403)};Add-DesktopCheck 'Unauthenticated API refusal' $blocked 'API requests require the current private desktop session.'
    $blocked=$false;try{$wrong=@{'X-EightMax-Session'=[string]$session.token;Origin='https://example.invalid'};$null=Invoke-WebRequest -Uri ($session.origin+'/api/desktop/health') -Headers $wrong -UseBasicParsing -TimeoutSec 5}catch{$blocked=([int]$_.Exception.Response.StatusCode -eq 403)};Add-DesktopCheck 'Foreign origin refusal' $blocked 'A foreign Origin was refused; no external network request was made.'
    # 0.29: persistent capture sessions THROUGH THE HOST, on the test's own window (no other program is captured).
    Set-Step 'capture-session'
    # The window lives in its own process (windows\Capture-TestWindow.ps1): a window owned by this thread cannot answer PrintWindow
    # while this thread waits for the host's reply (deadlock seen on a Windows runner).
    $winInfo=Join-Path $folder 'capture-window.json';$winControl=Join-Path $folder 'capture-window.control';foreach($f in @($winInfo,$winControl)){if(Test-Path -LiteralPath $f){Remove-Item -LiteralPath $f -Force}}
    $winArgs='-NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File '+(Quote-WorkbenchPath (Join-Path $root 'windows\Capture-TestWindow.ps1'))+' -InfoFile '+(Quote-WorkbenchPath $winInfo)+' -ControlFile '+(Quote-WorkbenchPath $winControl)
    $winProc=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $winArgs -WindowStyle Normal -PassThru
    try{
        $w=[Diagnostics.Stopwatch]::StartNew();while(-not (Test-Path -LiteralPath $winInfo) -and -not $winProc.HasExited -and $w.ElapsedMilliseconds -lt 20000){Start-Sleep -Milliseconds 100}
        if(-not (Test-Path -LiteralPath $winInfo)){throw ('The capture test window did not start (exited='+$winProc.HasExited+').')}
        Start-Sleep -Milliseconds 500
        $info=[IO.File]::ReadAllText($winInfo)|ConvertFrom-Json
        $tgt=[pscustomobject]@{kind='window';hwnd=[string]$info.hwnd;pid=[int]$info.pid;title=[string]$info.title;method='print-window'}
        $pw=API '/api/capture/frame' 'POST' ([pscustomobject]@{target=$tgt})
        Add-DesktopCheck 'Host capture: PrintWindow frame of an own window' ($pw.ok -eq $true -and $pw.method -eq 'print-window' -and $pw.width -ge 400) ('method '+$pw.method+' '+$pw.width+'x'+$pw.height+' dpiScale '+$pw.dpiScale+$(if(-not $pw.ok){' refused: '+$pw.code+' '+$pw.reason}else{''}))
        if($h.windowsGraphicsCapture){
            $tgt.method='windows-graphics-capture'
            $open=API '/api/capture/open' 'POST' ([pscustomobject]@{target=$tgt;consent=$true})
            $frames=@();for($k=0;$k -lt 4;$k++){if($k -eq 2){[IO.File]::WriteAllText($winControl,'red')};Start-Sleep -Milliseconds 250;$frames+=API '/api/capture/frame' 'POST' ([pscustomobject]@{target=$tgt})}
            $hs=API '/api/desktop/health'
            $okFrames=@($frames|Where-Object {$_.ok -eq $true -and $_.method -eq 'windows-graphics-capture' -and $_.session.persistent -eq $true})
            $ids=@($frames|ForEach-Object {[long]$_.frameId});$fresh=@($frames|Where-Object {$_.session.fresh -eq $true}).Count
            Add-DesktopCheck 'Host capture: Windows Graphics Capture persistent session' ($open.ok -eq $true -and $okFrames.Count -eq 4 -and $hs.activeCaptureSessions -eq 1 -and $ids[3] -gt $ids[0]) ('4 frames through ONE session: frameIds '+($ids -join ',')+'; fresh '+$fresh+'; active sessions '+$hs.activeCaptureSessions+'; first frame '+$frames[0].session.firstFrameMs+' ms'+$(if($okFrames.Count -lt 4){' refused: '+(@($frames|Where-Object {-not $_.ok}|ForEach-Object {$_.code+' '+$_.reason}) -join ' | ')}else{''}))
            $cl=API '/api/capture/close' 'POST' ([pscustomobject]@{target=$tgt});$hs2=API '/api/desktop/health'
            $helperGone=$false;$w=[Diagnostics.Stopwatch]::StartNew();do{$helperGone=(@(Get-Process -Name EightMaxWgc -ErrorAction SilentlyContinue).Count -eq 0);if(-not $helperGone){Start-Sleep -Milliseconds 100}}while(-not $helperGone -and $w.ElapsedMilliseconds -lt 3000)
            Add-DesktopCheck 'Host capture: session closes and its helper exits' ($cl.closedSessions -eq 1 -and $hs2.activeCaptureSessions -eq 0 -and $helperGone) ('closed '+$cl.closedSessions+'; active after close '+$hs2.activeCaptureSessions+'; helper exited '+$helperGone)
            $again=API '/api/capture/frame' 'POST' ([pscustomobject]@{target=$tgt})
            [IO.File]::WriteAllText($winControl,'close');$null=$winProc.WaitForExit(10000);Start-Sleep -Milliseconds 300
            $lost=API '/api/capture/frame' 'POST' ([pscustomobject]@{target=$tgt})
            Add-DesktopCheck 'Host capture: closed window reported, session ended' ($again.ok -eq $true -and $lost.ok -eq $false -and $lost.code -eq 'target-lost' -and (API '/api/desktop/health').activeCaptureSessions -eq 0) ('reopened frame ok='+$again.ok+'; after close: '+$lost.code)
        }else{Add-DesktopCheck 'Host capture: Windows Graphics Capture persistent session' $false 'The host does not offer Windows Graphics Capture (desktop\bin\EightMaxWgc.exe missing).' 'missing-executable' 'wgc-helper-missing'}
    }finally{
        try{[IO.File]::WriteAllText($winControl,'close')}catch{};if(-not $winProc.WaitForExit(5000)){try{$winProc.Kill()}catch{}}
        foreach($f in @($winInfo,$winControl)){if(Test-Path -LiteralPath $f){Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue}}
    }
    Set-Step 'native-submission'
    $job=[IO.File]::ReadAllText((Join-Path $root 'examples\native-reviewed-demo-job.json'))|ConvertFrom-Json
    $job.id='desktop-acceptance';$job.workbench=[pscustomobject]@{slot=2;token='accept-'+[guid]::NewGuid().ToString('N')}
    $s=API '/api/native/jobs' 'POST' $job;$firstId=$s.id
    $same=API '/api/native/jobs' 'POST' $job
    Add-DesktopCheck 'Idempotent native submission' ($same.id -eq $firstId -and $same.revision -eq 1) 'A repeated bound submission returned its existing attempt.'
    $found=API '/api/native/current';Add-DesktopCheck 'Read-only current study recovery' ($found.format -eq 'eightmax-desktop-current' -and $found.status.id -eq $firstId -and $found.job.workbench.token -eq $job.workbench.token) 'Current study discovery returned the bound job without submitting or resuming it.'
    $s=Await-Job $firstId 120 $job.iterations
    if($s.stage -ne 'complete'){throw ('Managed reviewed native run did not complete: stage '+$s.stage+', message: '+$s.message+$(if($s.nativeStatus){' (native: committed '+$s.nativeStatus.committedUpdates+' of '+$s.nativeStatus.targetUpdates+', '+$s.nativeStatus.stage+')'}else{''}))}
    $result=API ('/api/native/jobs/'+$s.id+'/result')
    $valid=$result.version -eq 2 -and $result.training.iterations -eq $job.iterations -and $result.rootQuery.study.updates -eq $result.query.study.updates -and $result.query.node.actor -eq $job.reviewed.actor -and $result.rootQuery.node.actor -eq 0 -and [math]::Abs($result.query.node.pot-$job.reviewed.pot) -lt 1e-9
    Add-DesktopCheck 'Managed reviewed CPU workflow' $valid 'Real Windows native execution returned separate root/target queries at the captured actor and completed count.'
    if(-not $valid){throw 'Managed native result context disagrees with its fixture'}
    Set-Step 'native-cancel-resume'
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
    Set-Step 'native-fenced-submission'
    $job.id='desktop-fenced-submission';$job.workbench.token='fenced-'+[guid]::NewGuid().ToString('N')
    $headers['X-EightMax-Revision']='1';try{$fence=API '/api/native/cancel-intent' 'POST' $job}finally{$headers.Remove('X-EightMax-Revision')}
    $blocked=$false;try{$null=API '/api/native/jobs' 'POST' $job}catch{$blocked=([int]$_.Exception.Response.StatusCode -eq 409)}
    Add-DesktopCheck 'Cancel before submission acknowledgment' ($fence.fenced -eq $true -and $fence.revision -eq 1 -and $blocked) 'A cancelled binding was refused when its delayed initial submission arrived.'

    Set-Step 'native-history'
    . (Join-Path $PSScriptRoot 'Test-Native-History.ps1')

    Set-Step 'acceptance-complete'
    Add-DesktopCheck 'Desktop acceptance completed' $true 'Every desktop protocol and native step above ran to completion.'
} catch {
    $class=Get-EmErrorClass $_;$msg=$_.Exception.Message;if([string]::IsNullOrWhiteSpace($msg)){$msg=$_.Exception.GetType().FullName}
    Add-DesktopCheck 'Desktop acceptance completed' $false ($msg+' [step '+$script:Step+'; '+$_.InvocationInfo.PositionMessage.Split("`n")[0].Trim()+']') $class ('desktop-'+$script:Step+'-failed')
}
finally {
    Set-Step 'shutdown'
    $shutdownDetail='No host was started.';$graceful=$false;$forced=$false
    if($session -and $headers){
        try{$recent=API '/api/desktop/requests';Write-WorkbenchUtf8 (Join-Path $folder 'host-requests.json') ($recent|ConvertTo-Json -Depth 5)}catch{}
        try{$bye=API '/api/desktop/shutdown' 'POST';$shutdownDetail='Shutdown accepted (nativeWorkStopped='+$bye.nativeWorkStopped+').'}catch{$shutdownDetail='Shutdown request failed: '+$_.Exception.Message}
    }
    if($hostProcess){
        if($hostProcess.WaitForExit(20000)){$graceful=$true;$shutdownDetail+=' Host exited by itself (exit code '+$hostProcess.ExitCode+').'}
        else{$forced=$true;try{$hostProcess.Kill();$null=$hostProcess.WaitForExit(5000)}catch{};$shutdownDetail+=' Host did not exit within 20 s and was terminated as a last resort.'}
        Add-DesktopCheck 'Graceful desktop shutdown' $graceful $shutdownDetail $(if($forced){'timeout'}else{''}) 'host-shutdown-not-graceful'
        $hostProcess.Dispose()
    }
    Start-Sleep -Milliseconds 500
    $left=@(Get-OwnedNativeProcesses|Where-Object {$preexistingNative -notcontains $_.ProcessId})
    if($session){Add-DesktopCheck 'Native process cleanup' ($left.Count -eq 0) $(if($left.Count){'mwcli.exe still running after shutdown: PIDs '+(($left|ForEach-Object {$_.ProcessId}) -join ', ')}else{'No mwcli.exe started by this test is left running.'}) '' 'native-process-left'}
    try{$log=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EightMax-Test-Workbench\Logs\desktop-requests.log';if(Test-Path -LiteralPath $log){Copy-Item -LiteralPath $log -Destination (Join-Path $folder 'desktop-requests.log') -Force}}catch{}
    Write-WorkbenchUtf8 (Join-Path $folder 'desktop-requests.json') (@($trace.ToArray())|ConvertTo-Json -Depth 5)
    if(Test-Path -LiteralPath (Join-Path $folder 'private-session.json')){Remove-Item -LiteralPath (Join-Path $folder 'private-session.json') -Force}
    $report=[ordered]@{format='eightmax-windows-diagnostics';version=1;appVersion=$WorkbenchVersion;build=$ExpectedEightMaxBuild;timestampUtc=[DateTime]::UtcNow.ToString('o');machine=$env:COMPUTERNAME;os=[Environment]::OSVersion.VersionString;hostExecutable=(Get-EmFileVersion (Join-Path $root 'desktop\bin\EightMaxWorkbench.exe'));checks=$checks.ToArray();requestTrace='desktop-requests.json';failedRequests=@($trace|Where-Object {$_.status -ge 400 -or $_.code -eq 'no-response'}).Count;liveCapacityEstablished=$false;scope='Windows desktop build, private local protocol and synthetic native CPU acceptance only; not live recognition, GPU performance or table capacity.'}
    $path=Join-Path $folder 'EightMax-desktop-acceptance.json';Write-WorkbenchUtf8 $path ($report|ConvertTo-Json -Depth 30)
    Write-Host ('Acceptance report: '+$path);if(-not $env:EIGHTMAX_NO_EXPLORER){Start-Process -FilePath 'explorer.exe' -ArgumentList (Quote-WorkbenchPath $folder)|Out-Null}
}
if(@($checks|Where-Object {-not $_.passed}).Count){exit 1}
