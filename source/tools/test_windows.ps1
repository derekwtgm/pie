# Native CPU checks. Windows PowerShell 5.1 or PowerShell 7; no extra packages.
param(
  [string]$Exe = (Join-Path $PSScriptRoot '..\..\EightMax.exe'),
  [string]$Report = (Join-Path $PSScriptRoot '..\..\Windows-self-test.json'),
  [string]$ExpectedVersion = ((Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\VERSION') -TotalCount 1).Trim()),
  # checks for host fixes added in 2.5 and later (every 2.6 host is compiled from source)
  [switch]$Fresh = $true
)
$ErrorActionPreference = 'Stop'
# 3.3: Windows PowerShell 5.1 serializes arrays returned from functions as {"value":[...],"Count":n}
# through extended type data; removing it keeps JSON arrays plain (no effect on PowerShell 7).
Remove-TypeData System.Array -ErrorAction SilentlyContinue
$checks = [System.Collections.Generic.List[string]]::new()
$engineProcess = $null
$oldProfile=$env:USERPROFILE
$oldGpu = $env:EIGHTMAX_GPU
$oldThreads = $env:EIGHTMAX_THREADS
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('EightMax-check-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
$passed = $false
$failure = $null
function Assert-Check([bool]$ok, [string]$message) {
  if (-not $ok) { throw $message }
  $checks.Add($message)
  Write-Host ('PASS  ' + $message)
}
function Api([string]$route, $payload = $null) {
  $requestArgs = @{ Uri = "$script:base/api/$route"; UseBasicParsing = $true; TimeoutSec = 30; Headers = @{ 'X-EightMax' = '1' } }
  if ($null -ne $payload) { $requestArgs.Method = 'POST'; $requestArgs.ContentType = 'application/json'; $requestArgs.Body = ($payload | ConvertTo-Json -Depth 20 -Compress) }
  try { return ((Invoke-WebRequest @requestArgs).Content | ConvertFrom-Json) }
  catch {
    # 3.3: show the server's reason (expected rejections are still detected by the caller).
    $response = $_.Exception.Response
    if ($response) { try { $reader = New-Object IO.StreamReader($response.GetResponseStream()); Write-Host ("  /api/{0} -> HTTP {1}: {2}" -f $route, [int]$response.StatusCode, $reader.ReadToEnd()) } catch {} }
    if ($requestArgs.Body) { Write-Host ("  request body starts: " + $requestArgs.Body.Substring(0, [math]::Min(300, $requestArgs.Body.Length))) }
    throw
  }
}
function Card([string]$text) { return 4 * '23456789TJQKA'.IndexOf($text[0]) + 'cdhs'.IndexOf($text[1]) }
function HandId([string]$text) {
  $a = Card $text.Substring(0,2); $b = Card $text.Substring(2,2)
  if ($a -gt $b) { $a,$b = $b,$a }
  return [int]($a * (103 - $a) / 2 + $b - $a - 1)
}
function Weights([string[]]$hands) {
  $weights = New-Object double[] 1326
  foreach ($hand in $hands) { $weights[(HandId $hand)] = 1.0 }
  return ,$weights
}
try {
  $Exe = (Resolve-Path $Exe).Path
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
  $script:base = "http://127.0.0.1:$port"
  $env:EIGHTMAX_GPU = 'off'; $env:EIGHTMAX_THREADS = '2'
  $env:USERPROFILE=$work
  $engineProcess = Start-Process -FilePath $Exe -ArgumentList @('--no-browser', "--port=$port") -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $work 'stdout.txt') -RedirectStandardError (Join-Path $work 'stderr.txt')
  $deadline = [datetime]::UtcNow.AddSeconds(20); $info = $null
  while ([datetime]::UtcNow -lt $deadline) {
    if ($engineProcess.HasExited) { throw 'EightMax exited before its server was ready' }
    try { $info = Api 'info'; break } catch { Start-Sleep -Milliseconds 100 }
  }
  Assert-Check ($null -ne $info -and $info.native -eq $true -and $info.version -eq $ExpectedVersion) 'Native server starts and reports the expected version'
  $expected=Join-Path $work 'Documents\EightMax'
  Assert-Check ($info.saveDir -eq $expected) 'Checkpoint tests use an isolated profile'
  $fixtures=Get-Content -Raw (Join-Path $PSScriptRoot '../tests/fixtures/checkpoints-2.5.json') | ConvertFrom-Json
  foreach ($text in @($fixtures.wide.text,$fixtures.exact.text)){
    $r=Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/checkpoint/write" -Method POST -Headers @{'X-EightMax'='1'} -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($text))
    Assert-Check ($r.StatusCode -eq 200) 'Checkpoint persisted'
  }
  foreach($fault in @('missing','corrupt')){
    $index=Join-Path $expected 'autosave.index'
    if($fault -eq 'missing'){Remove-Item -LiteralPath $index}else{[IO.File]::WriteAllText($index,'bad')}
    $health=Api 'checkpoint/status'
    Assert-Check ($health.reconstructed -and $health.generation -eq '2') "Rebuilt $fault index"
    foreach($key in @('latest','previous')){
      $r=Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/checkpoint/$key"
      $v=if($key -eq 'latest'){$fixtures.exact.text}else{$fixtures.wide.text}
      Assert-Check ($r.Content -ceq $v) "Recovered $key after $fault index"
    }
  }
  $page = (Invoke-WebRequest -UseBasicParsing -Uri $script:base -TimeoutSec 15).Content
  Assert-Check ($page.Contains('window.EM_NATIVE = true;') -and $page.Contains('multi-resume') -and $page.Contains('rv-abstraction')) 'Embedded app includes multiway training and grouping controls'
  $cfg = @{
    board = @((Card '2c'),(Card '4d'),(Card '7h'),(Card '9s'),(Card 'Jc')); pot = 10; stack = 10
    ranges = @((Weights @('QhQd')),(Weights @('AsAd','KsTh')))
    sizes = @{ bet = @(@('',''),@('',''),@('','100')); raise = @(@('',''),@('',''),@('','')) }
    compress = 0; iso = 0; gpu = 0; forceAllin = 0; maxBets = 1
  }
  $meta = Api 'build' $cfg
  $null = Api 'solve' @{ maxIter = 10000; target = 0.000001; power = 0 }
  $deadline = [datetime]::UtcNow.AddSeconds(60); $status = $null
  do {
    $status = Api 'status'
    if ($status.done -and -not $status.running) { break }
    Start-Sleep -Milliseconds 30
  } while ([datetime]::UtcNow -lt $deadline)
  Assert-Check ($status.done -and -not $status.running -and $null -eq $status.error) 'CPU river solve completes without an engine error'
  $aggressor = Api 'node' @{path = @(0)}; $defender = Api 'node' @{path = @(0,1)}
  $strong = -1; $weak = -1
  for ($i=0; $i -lt $meta.combos[1].Count; $i++) {
    if ([int]$meta.combos[1][$i] -eq (HandId 'AsAd')) { $strong=$i }
    if ([int]$meta.combos[1][$i] -eq (HandId 'KsTh')) { $weak=$i }
  }
  Assert-Check ($strong -ge 0 -and $weak -ge 0 -and $aggressor.strategy[2+$strong] -gt 0.995 -and [math]::Abs($aggressor.strategy[2+$weak] - 0.5) -lt 0.015 -and [math]::Abs($defender.strategy[1] - 0.5) -lt 0.015) 'Known river equilibrium: value bets, half-frequency bluffs and calls'
  $bad = $cfg.Clone(); $bad.board = @(0,0,22,31,36); $rejected = $false
  try { $null = Api 'estimate' $bad } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 400) { $rejected = $true } else { throw }
  }
  Assert-Check $rejected 'Duplicate board cards are rejected'
  if ($Fresh) {
    function StatusOf([string]$route, [string]$body) {
      try { $null = Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/$route" -Method POST -Headers @{ 'X-EightMax' = '1' } -ContentType 'application/json' -Body $body -TimeoutSec 15; return 200 }
      catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { throw } }
    }
    foreach ($route in @('build','estimate','report','save','load')) {
      Assert-Check ((StatusOf $route '') -eq 400) "Empty $route request is refused without crashing the host"
    }
    foreach ($name in @('con','NUL.txt','Com3','lpt9','aux.em8')) {
      Assert-Check ((StatusOf 'save' (@{ name = $name } | ConvertTo-Json -Compress)) -eq 400) "Reserved Windows name '$name' is refused for saves"
    }
    $null = Api 'info'
    Assert-Check (-not $engineProcess.HasExited) 'Host is still running after the refused requests'
  }
  $large=& (Join-Path $PSScriptRoot 'test_large_checkpoint.ps1') -Base $script:base -Work $work -Cli (Join-Path (Split-Path $Exe) 'mwcli.exe') -Store $expected
  Assert-Check ($large.bytes -gt 64MB) 'Streamed a trained checkpoint larger than 64 MiB and recovered its SHA-256 after index removal'
  $file=Join-Path (Split-Path $Exe) 'validation/3.7/fixtures/eight-seat-3.6.emstudy'
  if(-not(Test-Path $file)){$file=Join-Path $PSScriptRoot '../../validation/3.7/fixtures/eight-seat-3.6.emstudy'}
  $null=Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/checkpoint/native-upload" -Method POST -Headers @{'X-EightMax'='1'} -InFile $file
  Assert-Check ((Api 'mw/status').engine.iterations -eq 8) 'Restored genuine 3.6 native fixture'
  $null=Api 'mw/desktop-train' @{iterations=7;threads=2}
  do{Start-Sleep -Milliseconds 100;$status=Api 'mw/status'}while($status.running)
  Assert-Check ($status.engine.iterations -eq 15) 'Committed seven more updates'
  foreach($route in @('checkpoint/native-save','mw/desktop-release','checkpoint/native-latest')){
    $null=Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/$route" -Method POST -Headers @{'X-EightMax'='1'}
  }
  Assert-Check ((Api 'mw/status').engine.rng -eq $status.engine.rng) 'Reopened native generation with the saved RNG'
  # 3.8: native strategy explorer on the restored desktop study
  $node=Api 'mw/node' @{path=@();limit=1326}
  Assert-Check ($node.node.kind -eq 'decision' -and $node.actions.Count -ge 2 -and $node.hands.items.Count -gt 0 -and $node.ev.available -eq $false) 'Explorer reads the root decision of the restored native study'
  $sum=0.0;foreach($p in $node.aggregate.average){$sum+=$p}
  Assert-Check ([math]::Abs($sum-1) -lt 1e-9) 'Explorer aggregate strategy is normalized'
  $deeper=Api 'mw/node' @{path=@(1);limit=10}
  Assert-Check ($deeper.history.Count -eq 1 -and $deeper.hands.items.Count -le 10) 'Explorer follows an action branch with a bounded page'
  $code=0;try{$null=Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/mw/node" -Method POST -Headers @{'X-EightMax'='1'} -Body '{"path":[7]}'}catch{$code=[int]$_.Exception.Response.StatusCode}
  Assert-Check ($code -eq 400) 'Explorer refuses a branch outside the solved abstraction'
  # 3.9: strict request validation (HTTP 400) and action EVs / response gains on the restored study
  foreach($body in @('{"rangeSeat":"nonsense"}','{"offset":-1}','{"limit":"5"}','{"path":[0.5]}','{"foo":1}')){
    $code=0;try{$null=Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/mw/node" -Method POST -Headers @{'X-EightMax'='1'} -Body $body}catch{$code=[int]$_.Exception.Response.StatusCode}
    Assert-Check ($code -eq 400) ('Explorer rejects malformed request '+$body)
  }
  $ev=Api 'mw/ev' @{path=@();hands=@(0,1);range=$true;samples=500;seed=1}
  Assert-Check ($ev.hands.Count -eq 2 -and $ev.actions.Count -eq $node.actions.Count -and $ev.hands[0].ev.Count -eq $node.actions.Count -and ($ev.method -eq 'exact' -or $ev.hands[0].stdErr.Count -eq $node.actions.Count)) 'Action EVs computed for every legal action with method and uncertainty'
  $again=Api 'mw/ev' @{path=@();hands=@(0,1);range=$true;samples=500;seed=1}
  Assert-Check ($again.cache.hit -eq $true -and $again.hands[0].ev[0] -eq $ev.hands[0].ev[0]) 'Repeated action-EV request is served from the cache'
  $gain=Api 'mw/response-gain' @{method='sampled';samples=200;selectionSamples=16;reachSamples=500;seed=1;futureActions='sample'}
  Assert-Check ($gain.seats.Count -ge 2) 'Per-seat sampled response gains computed'
  $code=0;try{$null=Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/mw/ev" -Method POST -Headers @{'X-EightMax'='1'} -Body '{"hands":["0"]}'}catch{$code=[int]$_.Exception.Response.StatusCode}
  Assert-Check ($code -eq 400) 'Action-EV endpoint rejects a string hand index'
  # 4.0: EV deadline enforcement (the reproduced 3.9 defect: 8-player preflop ICM,
  # fixed hands, exact, 100 ms), exact EV values against the Linux reference,
  # background evaluation jobs, cancellation and malformed job requests.
  $cli = Join-Path (Split-Path $Exe) 'mwcli.exe'
  $fx = Join-Path (Split-Path $Exe) 'validation/4.0/fixtures'
  if (-not (Test-Path $fx)) { $fx = Join-Path $PSScriptRoot '../../validation/4.0/fixtures' }
  $fxSpec = Join-Path $fx 'push8-icm.spec.json'; $fxState = Join-Path $fx 'push8-icm.state'; $q = Join-Path $work 'ev40.json'
  [IO.File]::WriteAllText($q, '{"path":[],"hands":[0],"method":"exact","timeLimitMs":100,"maxVisits":2000000000}')
  $env:EM_QUERY_TIMING = '1'; $ErrorActionPreference = 'Continue'; $times = @(); $statuses = @()
  for ($i = 0; $i -lt 5; $i++) {
    $lines = & $cli --ev $fxSpec $fxState $q 2>&1 | ForEach-Object { "$_" }
    $timing = $lines | Where-Object { $_ -match '^\{"queryMs"' } | Select-Object -First 1 | ConvertFrom-Json
    $times += [double]$timing.queryMs; $statuses += [int]$timing.status
  }
  $ErrorActionPreference = 'Stop'; Remove-Item Env:EM_QUERY_TIMING
  $v40 = [ordered]@{ deadlineTimeLimitMs = 100; deadlineQueryMs = $times; deadlineStatuses = $statuses }
  $worst = ($times | Measure-Object -Maximum).Maximum
  Assert-Check ((@($statuses | Where-Object { $_ -ne 408 }).Count -eq 0) -and $worst -lt 250) ('Exact EV with a 100 ms limit stops with HTTP 408 and no result (slowest of 5: {0:N1} ms)' -f $worst)
  $expected = Get-Content -Raw -LiteralPath (Join-Path $fx 'push8-icm.expected.json') | ConvertFrom-Json; $evRows = @()
  foreach ($node in $expected.nodes) {
    [IO.File]::WriteAllText($q, (@{ path = @($node.path); hands = @(0); method = 'exact'; timeLimitMs = 600000; maxVisits = 2000000000 } | ConvertTo-Json -Compress))
    $clock = [Diagnostics.Stopwatch]::StartNew(); $r = (& $cli --ev $fxSpec $fxState $q) | ConvertFrom-Json; $clock.Stop()
    $diff = 0.0; for ($a = 0; $a -lt $node.ev.Count; $a++) { $diff = [math]::Max($diff, [math]::Abs([double]$r.hands[0].ev[$a] - [double]$node.ev[$a]) / [math]::Max(1, [math]::Abs([double]$node.ev[$a]))) }
    $evRows += [ordered]@{ path = @($node.path); seconds = $clock.Elapsed.TotalSeconds; maxRelativeDifference = $diff; threads = $r.threads; tables = $r.execution.showdownTables }
    Assert-Check ($r.status -eq 'completed' -and $diff -lt 1e-12) ('Exact 8-player ICM action EVs equal the reference at path [' + ($node.path -join ',') + ']')
  }
  $v40.exactEv = $evRows
  $job = Api 'mw/jobs/ev' @{ path = @(); hands = @(0, 1); range = $true; method = 'sampled'; samples = 2000000; timeLimitMs = 600000 }
  do { Start-Sleep -Milliseconds 50; $st = Api ('mw/jobs/' + $job.jobId) } while ($st.status -eq 'pending')
  $clock = [Diagnostics.Stopwatch]::StartNew(); $nodeDuring = Api 'mw/node' @{ path = @(); limit = 5 }; $statusDuring = Api 'mw/status'; $clock.Stop()
  Assert-Check ($st.status -eq 'running' -and $nodeDuring.node.kind -eq 'decision' -and $clock.ElapsedMilliseconds -lt 2000) ('Explorer and status answer while a background evaluation runs ({0} ms)' -f $clock.ElapsedMilliseconds)
  $clock = [Diagnostics.Stopwatch]::StartNew(); $null = Api ('mw/jobs/' + $job.jobId + '/cancel') @{}
  do { Start-Sleep -Milliseconds 20; $st = Api ('mw/jobs/' + $job.jobId) } while ($st.status -eq 'running')
  $clock.Stop(); $v40.jobCancelMs = $clock.ElapsedMilliseconds
  Assert-Check ($st.status -eq 'cancelled' -and $clock.ElapsedMilliseconds -lt 3000) ('Cancelled background evaluation stops ({0} ms)' -f $clock.ElapsedMilliseconds)
  $code = 0; try { $null = Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/mw/jobs/ev" -Method POST -Headers @{ 'X-EightMax' = '1' } -Body '{"hands":["x"]}' } catch { $code = [int]$_.Exception.Response.StatusCode }
  Assert-Check ($code -eq 400) 'Malformed evaluation job is rejected without creating a job'
  $small = Api 'mw/jobs/ev' @{ path = @(); hands = @(0); method = 'sampled'; samples = 400; seed = 1 }
  do { Start-Sleep -Milliseconds 50; $st = Api ('mw/jobs/' + $small.jobId) } while ($st.status -eq 'pending' -or $st.status -eq 'running')
  $res = Api ('mw/jobs/' + $small.jobId + '/result')
  Assert-Check ($st.status -eq 'completed' -and $res.hands[0].classification.Count -eq $res.actions.Count -and $null -ne $res.coverage) 'Background evaluation job completes with classifications and coverage'
  foreach ($id in @($job.jobId, $small.jobId)) { $null = Api ('mw/jobs/' + $id + '/release') @{} }
  Assert-Check (@((Api 'mw/jobs').jobs).Count -eq 0) 'Released evaluation jobs free their results'
  # 4.1: numeric input safety, concurrent-start reliability, queued-job deadlines,
  # work budgets, parallel response gains and adjusted action statistics.
  $v41 = [ordered]@{}
  function Status-Of([string]$route, [string]$body) {
    try { $null = Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/$route" -Method POST -Headers @{ 'X-EightMax' = '1' } -Body $body; return 200 }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { return -1 } }
  }
  $bad = [ordered]@{
    'mw/jobs/ev memoryMiB 1e300' = @('mw/jobs/ev', '{"hands":[0],"memoryMiB":1e300}');
    'mw/jobs/ev timeLimitMs -1e300' = @('mw/jobs/ev', '{"hands":[0],"timeLimitMs":-1e300}');
    'mw/jobs/response-gain memoryMiB 1e19' = @('mw/jobs/response-gain', '{"method":"sampled","memoryMiB":1e19}');
    'mw/jobs/config workers 1e300' = @('mw/jobs/config', '{"workers":1e300}');
    'mw/node offset 2^64' = @('mw/node', '{"path":[],"offset":18446744073709551616}');
    'mw/train iterations 0.5' = @('mw/train', '{"iterations":0.5}');
    'equity threads 1e300' = @('equity', '{"hands":[[0,1],[2,3]],"threads":1e300}');
    'node path 1e300' = @('node', '{"path":[1e300]}');
    'solve maxIter 1e300' = @('solve', '{"maxIter":1e300}')
  }
  $codes = [ordered]@{}
  foreach ($k in $bad.Keys) { $codes[$k] = Status-Of $bad[$k][0] $bad[$k][1] }
  $v41.malformedNumberStatus = $codes
  $alive = Api 'info'
  Assert-Check ((@($codes.Values | Where-Object { $_ -lt 400 -or $_ -ge 500 }).Count -eq 0) -and $null -ne $alive.build) ('Malformed numbers (1e300, 2^64, fractions) are refused with 4xx before conversion and the host keeps running (' + (($codes.Values | ForEach-Object { $_ }) -join ',') + ')')
  Assert-Check (@((Api 'mw/jobs').jobs).Count -eq 0) 'Refused requests created no evaluation job'
  # concurrent training starts: exactly one of eight simultaneous requests wins, repeatedly
  Add-Type -AssemblyName System.Net.Http
  $http = [System.Net.Http.HttpClient]::new(); $http.DefaultRequestHeaders.Add('X-EightMax', '1'); $rounds = @()
  for ($round = 0; $round -lt 10; $round++) {
    $tasks = @(); for ($i = 0; $i -lt 8; $i++) { $tasks += $http.PostAsync("$script:base/api/mw/train", [System.Net.Http.StringContent]::new('{"iterations":20000,"threads":2}')) }
    [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]$tasks)
    $sc = @($tasks | ForEach-Object { [int]$_.Result.StatusCode }); $rounds += ($sc -join ',')
    $null = Api 'mw/stop' @{}
    $deadline = [DateTime]::UtcNow.AddSeconds(15); do { Start-Sleep -Milliseconds 20; $ms = Api 'mw/status' } while ($ms.running -and [DateTime]::UtcNow -lt $deadline)
    Assert-Check (@($sc | Where-Object { $_ -eq 200 }).Count -eq 1 -and @($sc | Where-Object { $_ -ne 200 -and $_ -ne 409 }).Count -eq 0 -and -not $ms.running) ("Concurrent training start round {0}: exactly one of 8 requests started, none stuck ({1})" -f $round, ($sc -join ','))
  }
  $http.Dispose(); $v41.concurrentStartRounds = $rounds
  # a queued job receives its full time limit from when it starts (4.0 counted queue time)
  $null = Api 'mw/jobs/config' @{ workers = 1; threadsPerJob = 1 }
  $blocker = Api 'mw/jobs/ev' @{ path = @(); hands = @(0, 1); range = $true; method = 'sampled'; samples = 2000000; timeLimitMs = 600000 }
  do { Start-Sleep -Milliseconds 20; $st = Api ('mw/jobs/' + $blocker.jobId) } while ($st.status -eq 'pending')
  $queued = Api 'mw/jobs/ev' @{ path = @(); hands = @(0); method = 'sampled'; samples = 300; seed = 2; timeLimitMs = 500 }
  Start-Sleep -Milliseconds 1200; $null = Api ('mw/jobs/' + $blocker.jobId + '/cancel') @{}
  do { Start-Sleep -Milliseconds 20; $q2 = Api ('mw/jobs/' + $queued.jobId) } while ($q2.status -eq 'pending' -or $q2.status -eq 'running')
  $v41.queuedJob = [ordered]@{ status = $q2.status; queuedMs = $q2.queuedMs; runningMs = $q2.runningMs; partial = $q2.partial }
  Assert-Check ($q2.status -eq 'completed' -and -not $q2.partial -and $q2.queuedMs -ge 1000) ('A job queued for {0:N0} ms still received its 500 ms time limit' -f $q2.queuedMs)
  foreach ($id in @($blocker.jobId, $queued.jobId)) { $null = Api ('mw/jobs/' + $id + '/release') @{} }
  $null = Api 'mw/jobs/config' @{ workers = 2 }
  $res41 = Api 'mw/ev' @{ path = @(); hands = @(0); method = 'sampled'; samples = 2000; seed = 3 }
  $mc = $res41.hands[0].multipleComparisons
  Assert-Check ($null -ne $mc -and [double]$mc.criticalValue -gt 1.96 -and $null -ne $res41.work -and $res41.statistics.comparison -match 'simultaneous') ('Sampled action EVs carry simultaneous comparisons (critical value {0:N3}) and work counters' -f [double]$mc.criticalValue)
  # work budget and parallel response gains on the eight-player fixture (CLI)
  [IO.File]::WriteAllText($q, '{"path":[1,1],"hands":[0],"method":"exact","maxVisits":2000000000,"maxBoardEvaluations":100000}')
  $ErrorActionPreference = 'Continue'; $budgetOut = (& $cli --ev $fxSpec $fxState $q 2>&1 | Out-String); $budgetCode = $LASTEXITCODE; $ErrorActionPreference = 'Stop'
  Assert-Check ($budgetCode -ne 0 -and $budgetOut -match 'maxBoardEvaluations') 'Exact EV past maxBoardEvaluations is refused with no numbers'
  [IO.File]::WriteAllText($q, '{"path":[1,1],"hands":[0],"method":"exact","maxVisits":2000000000}')
  $full = (& $cli --ev $fxSpec $fxState $q) | ConvertFrom-Json
  Assert-Check ([long]$full.work.boardEvaluations -ge 376992) ('Board enumeration is counted ({0} board evaluations)' -f $full.work.boardEvaluations)
  $gainRows = @()
  foreach ($t in @(1, 2, [Math]::Min(8, [Environment]::ProcessorCount)) | Sort-Object -Unique) {
    [IO.File]::WriteAllText($q, ('{"method":"exact","seats":[0,3,6],"threads":' + $t + '}'))
    $clock = [Diagnostics.Stopwatch]::StartNew(); $g = (& $cli --gain $fxSpec $fxState $q) | ConvertFrom-Json; $clock.Stop()
    $gainRows += [ordered]@{ threads = $t; seconds = $clock.Elapsed.TotalSeconds; gains = @($g.seats | ForEach-Object { '{0:R}' -f [double]$_.gain }) -join ',' }
  }
  $v41.parallelResponseGain = $gainRows
  Assert-Check (@($gainRows | ForEach-Object { $_.gains } | Select-Object -Unique).Count -eq 1) ('Exact response gains identical for 1, 2 and more threads (' + (($gainRows | ForEach-Object { '{0} thr {1:N2} s' -f $_.threads, $_.seconds }) -join ', ') + ')')
  $passed = $true
} catch {
  $failure = $_.Exception.Message
  Write-Host ('FAIL  ' + $failure) -ForegroundColor Red
} finally {
  $env:USERPROFILE=$oldProfile
  if ($engineProcess -and -not $engineProcess.HasExited) { Stop-Process -Id $engineProcess.Id -Force -ErrorAction SilentlyContinue }
  $env:EIGHTMAX_GPU = $oldGpu; $env:EIGHTMAX_THREADS = $oldThreads
  $reportData = [ordered]@{ version=$ExpectedVersion; build=$info.build; largeCheckpoint=$large; v40=$v40; v41=$v41; passed=$passed; checks=$checks.ToArray(); error=$failure; os=[Environment]::OSVersion.VersionString; powershell=$PSVersionTable.PSVersion.ToString(); gpuTested=$false; freshChecks=[bool]$Fresh }
  $reportData | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding UTF8
  Write-Host "Report: $Report"
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not $passed) { exit 1 }
