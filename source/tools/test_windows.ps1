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
# 4.4: a failed check is recorded and the run continues, so one failure no longer hides
# every later check (in 4.3 the run stopped at the first failed assertion). The run passes
# only if no check failed and no step threw; "error" is the first failure, "failures" all.
$failures = [System.Collections.Generic.List[string]]::new()
function Assert-Check([bool]$ok, [string]$message) {
  if (-not $ok) { $failures.Add($message); Write-Host ('FAIL  ' + $message) -ForegroundColor Red; return }
  $checks.Add($message)
  Write-Host ('PASS  ' + $message)
}
# 4.4 numerical comparison policy (validation/4.4/NUMERIC-POLICY.md):
#  * BIT-EXACT results (exact EVs and exact response gains across thread counts, table
#    modes and releases) are compared as the engine's own IEEE 754 bit patterns
#    ("evBits"/"gainBits": 16 hex digits in a JSON string). Strings are never re-rounded.
#  * Numbers that went through ConvertFrom-Json are NOT used for bit-exact checks:
#    Windows PowerShell 5.1 reads a JSON fraction as System.Decimal and Decimal -> Double
#    rounds twice (15.670177585564113 became 15.670177585564112 in the 4.3 report).
#  * Tolerance checks state their tolerance (relative 1e-12 against the Linux reference file).
function BitsOfDouble([double]$x) { return ([BitConverter]::DoubleToInt64Bits($x)).ToString('x16') }
function UlpDistance([string]$hexA, [string]$hexB) {
  $a = [Convert]::ToInt64($hexA, 16); $b = [Convert]::ToInt64($hexB, 16)
  if ($a -lt 0) { $a = -($a -band [Int64]::MaxValue) }
  if ($b -lt 0) { $b = -($b -band [Int64]::MaxValue) }
  return [decimal]::Abs(([decimal]$a) - ([decimal]$b))
}
function EvBits($result) { return (@($result.hands[0].evBits) -join ',') }
function GainBits($result) { return (@($result.seats | ForEach-Object { $_.gainBits }) -join ',') }
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
  # 4.2: this 4.0 deadline check needs a workload slower than 100 ms; the 4.2 pattern
  # projection finishes it sooner, so the retained 4.1 per-board method is selected.
  $env:EM_EV_DIRECT_PATTERNS = '1'; $env:EM_QUERY_TIMING = '1'; $ErrorActionPreference = 'Continue'; $times = @(); $statuses = @()
  for ($i = 0; $i -lt 5; $i++) {
    $lines = & $cli --ev $fxSpec $fxState $q 2>&1 | ForEach-Object { "$_" }
    $timing = $lines | Where-Object { $_ -match '^\{"queryMs"' } | Select-Object -First 1 | ConvertFrom-Json
    $times += [double]$timing.queryMs; $statuses += [int]$timing.status
  }
  $ErrorActionPreference = 'Stop'; Remove-Item Env:EM_QUERY_TIMING; Remove-Item Env:EM_EV_DIRECT_PATTERNS
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
    'mw/desktop-train iterations 0.5' = @('mw/desktop-train', '{"iterations":0.5}');
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
  # concurrent training starts: exactly one of eight simultaneous requests wins, repeatedly.
  # The open study is a restored desktop study, which trains through mw/desktop-train
  # (mw/train is refused with 409 for it by design).
  Add-Type -AssemblyName System.Net.Http
  $http = [System.Net.Http.HttpClient]::new(); $http.DefaultRequestHeaders.Add('X-EightMax', '1'); $rounds = @()
  for ($round = 0; $round -lt 10; $round++) {
    $tasks = @(); for ($i = 0; $i -lt 8; $i++) { $tasks += $http.PostAsync("$script:base/api/mw/desktop-train", [System.Net.Http.StringContent]::new('{"iterations":20000,"threads":2}')) }
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
    $gainRows += [ordered]@{ threads = $t; seconds = $clock.Elapsed.TotalSeconds; gains = (GainBits $g) }
  }
  $v41.parallelResponseGain = $gainRows
  Assert-Check (@($gainRows | ForEach-Object { $_.gains } | Select-Object -Unique).Count -eq 1) ('Exact response gains identical for 1, 2 and more threads (' + (($gainRows | ForEach-Object { '{0} thr {1:N2} s' -f $_.threads, $_.seconds }) -join ', ') + ')')
  # 4.2: coverage accounting, exact pattern projection, new request fields (CPU only)
  $v42 = [ordered]@{}
  $covRows = @()
  foreach ($t in @(1, 2, [Math]::Min(8, [Environment]::ProcessorCount)) | Sort-Object -Unique) {
    [IO.File]::WriteAllText($q, ('{"path":[],"hands":[0],"method":"exact","device":"cpu","maxVisits":2000000000,"threads":' + $t + '}'))
    $env:EM_COVERAGE_AUDIT = '1'; $c = (& $cli --ev $fxSpec $fxState $q) | ConvertFrom-Json; Remove-Item Env:EM_COVERAGE_AUDIT
    $cv = $c.coverage
    $covRows += [ordered]@{ threads = $t; distinct = $cv.distinctInformationSets; stored = $cv.distinctStoredInformationSets; fallback = $cv.distinctFallbackInformationSets; lookups = $cv.policyLookups; audit = $cv.audit; ev = (EvBits $c) }
    Assert-Check ($cv.accounting -eq '4.2' -and $cv.distinctInformationSets -eq $cv.audit.distinctInformationSets -and $cv.distinctFallbackInformationSets -eq $cv.audit.distinctFallbackInformationSets -and $cv.distinctStoredInformationSets -eq $cv.audit.distinctStoredInformationSets) ("4.2 coverage with {0} threads equals the independent audit ({1} distinct information sets)" -f $t, $cv.distinctInformationSets)
  }
  $v42.coverage = $covRows
  Assert-Check (@($covRows | ForEach-Object { '{0}|{1}|{2}|{3}|{4}' -f $_.distinct, $_.stored, $_.fallback, $_.lookups, $_.ev } | Select-Object -Unique).Count -eq 1) '4.2 coverage counts and EVs are identical for every thread count'
  [IO.File]::WriteAllText($q, '{"path":[],"hands":[0],"method":"exact","device":"cpu","maxVisits":2000000000}')
  $clock = [Diagnostics.Stopwatch]::StartNew(); $proj = (& $cli --ev $fxSpec $fxState $q) | ConvertFrom-Json; $clock.Stop(); $projS = $clock.Elapsed.TotalSeconds
  $env:EM_EV_DIRECT_PATTERNS = '1'; $clock = [Diagnostics.Stopwatch]::StartNew(); $perBoard = (& $cli --ev $fxSpec $fxState $q) | ConvertFrom-Json; $clock.Stop(); $dirS = $clock.Elapsed.TotalSeconds; Remove-Item Env:EM_EV_DIRECT_PATTERNS
  $v42.patternProjection = [ordered]@{ projectionSeconds = $projS; perBoardSeconds = $dirS; projectionEv = $proj.hands[0].ev; perBoardEv = $perBoard.hands[0].ev; projectionEvBits = (EvBits $proj); perBoardEvBits = (EvBits $perBoard) }
  Assert-Check ((EvBits $proj) -ne '' -and (EvBits $proj) -eq (EvBits $perBoard)) ('4.2 exact EV by pattern projection is bit-identical to the 4.1 per-board method ({0:N2} s vs {1:N2} s)' -f $projS, $dirS)
  Assert-Check ($proj.execution.observedDevice -eq 'cpu' -and $proj.execution.requestedDevice -eq 'cpu') '4.2 the result reports the requested and the observed device'
  $badBudget = @()
  foreach ($v in @('0', '-1', '1.5', '1e300', '"4096"')) {
    [IO.File]::WriteAllText($q, ('{"path":[],"hands":[0],"gpuBudgetBytes":' + $v + '}'))
    $ErrorActionPreference = 'Continue'; $null = (& $cli --ev $fxSpec $fxState $q 2>&1 | Out-String); $badBudget += $LASTEXITCODE; $ErrorActionPreference = 'Stop'
  }
  Assert-Check (@($badBudget | Where-Object { $_ -eq 0 }).Count -eq 0) '4.2 malformed gpuBudgetBytes values are refused'
  # 4.3: shared showdown tables (one table per request), bit-identical results, coverage capacity, session mode (CPU only)
  $v43 = [ordered]@{ sharedTables = @() }
  foreach ($t in @(1, 2, 4, [Math]::Min(8, [Environment]::ProcessorCount), [Environment]::ProcessorCount) | Sort-Object -Unique) {
    [IO.File]::WriteAllText($q, ('{"path":[],"hands":[0],"method":"exact","device":"cpu","maxVisits":2000000000,"threads":' + $t + '}'))
    $clock = [Diagnostics.Stopwatch]::StartNew(); $c = (& $cli --ev $fxSpec $fxState $q) | ConvertFrom-Json; $clock.Stop()
    $v43.sharedTables += [ordered]@{ threads = $t; seconds = $clock.Elapsed.TotalSeconds; boardsScored = $c.execution.boardsScored; helperThreads = $c.execution.tables43.helperThreads; ev = (EvBits $c) }
  }
  Assert-Check (@($v43.sharedTables | Where-Object { $_.boardsScored -ne 376992 }).Count -eq 0) ('4.3 one shared showdown table per request: 376,992 boards for every thread count (' + (($v43.sharedTables | ForEach-Object { '{0} thr {1:N3} s' -f $_.threads, $_.seconds }) -join ', ') + ')')
  Assert-Check (@($v43.sharedTables | ForEach-Object { $_.ev } | Select-Object -Unique).Count -eq 1 -and $v43.sharedTables[0].ev -eq '402e0a51470d8f36,402f57218439052d') '4.3 exact EVs bit-identical to 4.2 for every thread count (IEEE 754 patterns 402e0a51470d8f36,402f57218439052d = 15.020151348500445, 15.670177585564113)'
  $env:EM_EV_PRIVATE_TABLES = '1'; [IO.File]::WriteAllText($q, '{"path":[],"hands":[0],"method":"exact","device":"cpu","maxVisits":2000000000,"threads":4}')
  $p = (& $cli --ev $fxSpec $fxState $q) | ConvertFrom-Json; Remove-Item Env:EM_EV_PRIVATE_TABLES
  Assert-Check ((EvBits $p) -eq $v43.sharedTables[0].ev) '4.3 private per-worker tables (4.2 behaviour) give the same EVs'
  $gRows = @()
  foreach ($t in @(1, [Math]::Min(8, [Environment]::ProcessorCount))) {
    [IO.File]::WriteAllText($q, ('{"method":"exact","seats":[0,1,2,3,4,5,6,7],"threads":' + $t + '}'))
    $clock = [Diagnostics.Stopwatch]::StartNew(); $g = (& $cli --gain $fxSpec $fxState $q) | ConvertFrom-Json; $clock.Stop()
    $gRows += [ordered]@{ threads = $t; seconds = $clock.Elapsed.TotalSeconds; boards = $g.execution.boardsScored; gains = (GainBits $g) }
  }
  $v43.responseGains = $gRows
  Assert-Check (@($gRows | ForEach-Object { $_.gains } | Select-Object -Unique).Count -eq 1 -and $gRows[0].gains -eq '3fe15d3f18fd8430,3fadfb44a17da100,3f7e93e0e23e9000,3fa28aad598de200,3fc1d3a932e4eb40,3facf6d893a40500,3fbb34236bb44e80,3fc12dd7abd36dc0' -and @($gRows | Where-Object { $_.boards -ne 376992 }).Count -eq 0) ('4.3 eight-seat exact response gains bit-identical to 4.2, one table for all seats (' + (($gRows | ForEach-Object { '{0} thr {1:N3} s' -f $_.threads, $_.seconds }) -join ', ') + ')')
  $badCov = @()
  foreach ($v in @('0', '4097', '1.5', '1e300', '"8"')) {
    [IO.File]::WriteAllText($q, ('{"path":[],"hands":[0],"coverageMiB":' + $v + '}'))
    $ErrorActionPreference = 'Continue'; $null = (& $cli --ev $fxSpec $fxState $q 2>&1 | Out-String); $badCov += $LASTEXITCODE; $ErrorActionPreference = 'Stop'
  }
  Assert-Check (@($badCov | Where-Object { $_ -eq 0 }).Count -eq 0) '4.3 malformed coverageMiB values are refused'
  [IO.File]::WriteAllText($q, '{"path":[],"hands":[0],"method":"exact","device":"cpu","maxVisits":2000000000,"coverageMiB":1}')
  $env:EM_COVERAGE_AUDIT = '1'; $c = (& $cli --ev $fxSpec $fxState $q) | ConvertFrom-Json; Remove-Item Env:EM_COVERAGE_AUDIT
  Assert-Check ($c.coverage.distinctCountKind -eq 'exact' -and $c.coverage.capacity.exactKeyLimit -eq 32768 -and $c.coverage.distinctInformationSets -eq $c.coverage.audit.distinctInformationSets) '4.3 coverage capacity reported (exact, 32,768-key limit at coverageMiB 1) and equal to the audit'
  $plan = Join-Path $work 'session43.json'
  [IO.File]::WriteAllText($plan, '{"mode":"ev","request":{"path":[],"hands":[0],"method":"exact","device":"cpu","maxVisits":2000000000},"steps":[{"label":"first"},{"label":"repeat","repeat":3},{"label":"concurrent","concurrent":3},{"label":"cancelled","cancelAfterMs":2},{"label":"after"}]}')
  $sess = (& $cli --session $fxSpec $fxState $plan) | ConvertFrom-Json
  $v43.session = [ordered]@{ mismatches = $sess.mismatches; seconds = $sess.sessionSeconds }
  Assert-Check ($LASTEXITCODE -eq 0 -and $sess.mismatches -eq 0 -and $sess.steps.Count -eq 5) '4.3 in-process session (first, repeated, concurrent, cancelled, after) gives identical results'
  # ---------------------------------------------------------------------------------
  # 4.4: IEEE 754 value preservation: native print/parse, CLI, desktop API, and what
  # this PowerShell does to JSON numbers. Bit patterns are the reference throughout.
  $v44 = [ordered]@{}
  $probeText = ((& $cli --ieee) | Out-String).Trim()
  $probeFile = Join-Path $work 'ieee-probe.json'
  [IO.File]::WriteAllText($probeFile, $probeText)
  $ErrorActionPreference = 'Continue'; $verifyText = ((& $cli --ieee-verify $probeFile 2>&1) | Out-String).Trim(); $verifyCode = $LASTEXITCODE; $ErrorActionPreference = 'Stop'
  $verify = $null; if ($verifyCode -eq 0) { $verify = $verifyText | ConvertFrom-Json }
  $v44.nativeRoundTrip = [ordered]@{ exitCode = $verifyCode; probeCount = $verify.probeCount; mismatches = $verify.mismatches; textMismatches = $verify.textMismatches }
  Assert-Check ($verifyCode -eq 0 -and $null -ne $verify -and [int]$verify.probeCount -ge 20 -and [int]$verify.mismatches -eq 0 -and [int]$verify.textMismatches -eq 0) ('4.4 native doubles printed with 17 significant digits parse back to identical IEEE 754 bit patterns ({0} probes: 1-ULP neighbours, negative, subnormal, tiny, huge)' -f $verify.probeCount)
  # raw tokens: the digits in the JSON text, with no numeric conversion at all
  $tokens = [regex]::Matches($probeText, '"bits":"([0-9a-f]{16})","value":([^,}]+),"text":"([^"]+)"')
  $tokenDiff = 0; foreach ($m in $tokens) { if ($m.Groups[2].Value -cne $m.Groups[3].Value) { $tokenDiff++ } }
  Assert-Check ($tokens.Count -eq [int]$verify.probeCount -and $tokenDiff -eq 0) ('4.4 CLI JSON carries every probe value as the same digit string as its text field ({0} raw tokens compared without numeric conversion)' -f $tokens.Count)
  $apiText = ((Invoke-WebRequest -UseBasicParsing -Uri "$script:base/api/mw/ieee-probe" -Headers @{ 'X-EightMax' = '1' } -TimeoutSec 30).Content).Trim()
  Assert-Check ($apiText -ceq $probeText) '4.4 desktop API probe document is character-identical to the CLI document'
  # what this PowerShell does to the numbers (recorded; these conversions are not used by any bit-exact check)
  # Every conversion below is wrapped: a PowerShell that cannot convert a probe is a finding about
  # PowerShell (recorded per probe), not about the engine.
  $castOff = 0; $parseOff = 0; $convertErrors = 0; $worstCast = [decimal]0; $psRows = @()
  $inv = [Globalization.CultureInfo]::InvariantCulture
  $doc = $null; $docError = $null
  try { $doc = $probeText | ConvertFrom-Json } catch { $docError = $_.Exception.Message }
  foreach ($m in $tokens) {
    $bits = $m.Groups[1].Value; $text = $m.Groups[3].Value
    $row = [ordered]@{ bits = $bits; text = $text; parsedType = $null; castBits = $null; castUlp = $null; parseBits = $null; parseUlp = $null; roundTripR = $null; g17 = $null; error = $null }
    try {
      $parsed = [double]::Parse($text, [Globalization.NumberStyles]::Float, $inv)
      $row.parseBits = BitsOfDouble $parsed; $d = UlpDistance $row.parseBits $bits; $row.parseUlp = [string]$d
      if ($d -ne 0) { $parseOff++ }
      $row.roundTripR = $parsed.ToString('R', $inv); $row.g17 = $parsed.ToString('G17', $inv)
    } catch { $row.error = 'double.Parse: ' + $_.Exception.Message; $convertErrors++ }
    try {
      # the 4.3 path: one JSON number through ConvertFrom-Json, then a [double] cast
      $one = ('{"v":' + $m.Groups[2].Value + '}') | ConvertFrom-Json
      $row.parsedType = $one.v.GetType().Name
      $row.castBits = BitsOfDouble ([double]$one.v); $d = UlpDistance $row.castBits $bits; $row.castUlp = [string]$d
      if ($d -ne 0) { $castOff++ }; if ($d -gt $worstCast) { $worstCast = $d }
    } catch { $row.error = ([string]$row.error) + ' ConvertFrom-Json: ' + $_.Exception.Message; $convertErrors++ }
    $psRows += $row
  }
  # PowerShell-parsed and PowerShell-serialized bit patterns: strings must come back unchanged
  $bitsRaw = (@($tokens | ForEach-Object { $_.Groups[1].Value }) -join ',')
  $bitsDoc = ('{"bits":["' + ($bitsRaw -replace ',', '","') + '"]}') | ConvertFrom-Json
  $bitsA = (@($bitsDoc.bits) -join ',')
  $again = (($bitsDoc | ConvertTo-Json -Depth 4 -Compress) | ConvertFrom-Json)
  $bitsB = (@($again.bits) -join ',')
  $bitsFile = Join-Path $work 'bits.json'; ($bitsDoc | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $bitsFile -Encoding UTF8
  $bitsC = (@((Get-Content -Raw -LiteralPath $bitsFile | ConvertFrom-Json).bits) -join ',')
  $bitsKept = @($bitsDoc.bits).Count
  $ref = $psRows | Where-Object { $_.bits -eq '402f57218439052d' } | Select-Object -First 1
  $v44.powershell = [ordered]@{ version = $PSVersionTable.PSVersion.ToString(); wholeDocumentParseError = $docError; probes = $psRows; castMismatches = $castOff; parseMismatches = $parseOff; conversionErrors = $convertErrors; worstCastUlp = [string]$worstCast; referenceParsedType = $ref.parsedType; referenceCastBits = $ref.castBits; referenceCastUlp = $ref.castUlp
    explanation = 'castMismatches > 0 means this PowerShell changes some JSON numbers when they are converted to [double] (Windows PowerShell 5.1: ConvertFrom-Json yields System.Decimal and Decimal to Double rounds twice). That is the cause of the 4.3 report showing 15.670177585564112; the engine value was 402f57218439052d. Bit-exact checks therefore use evBits/gainBits strings.' }
  Assert-Check ($bitsKept -eq $tokens.Count -and $bitsA -ceq $bitsRaw -and $bitsB -ceq $bitsRaw -and $bitsC -ceq $bitsRaw) ('4.4 IEEE 754 bit patterns survive PowerShell parsing, re-serialization and a file round trip unchanged ({0} patterns; [double] casts of the parsed numbers differed for {1}, worst {2} ULP: recorded, not used for exact checks)' -f $bitsKept, $castOff, $worstCast)
  Assert-Check ((UlpDistance '402f57218439052d' '402f57218439052c') -eq 1 -and (UlpDistance '402f57218439052d' '402f57218439052e') -eq 1 -and (UlpDistance 'c02f57218439052d' '402f57218439052d') -gt 1000000 -and (UlpDistance '0000000000000001' '8000000000000000') -eq 1 -and '402f57218439052d' -cne '402f57218439052c') '4.4 the bit-pattern comparison separates a value from its one-ULP neighbours (distance 1) and from its negation'
  # the exact EV of the 4.3 failure, re-evaluated: bits against the 4.2 reference, plus the digits the engine printed
  [IO.File]::WriteAllText($q, '{"path":[],"hands":[0],"method":"exact","device":"cpu","maxVisits":2000000000,"threads":2}')
  $rawEv = ((& $cli --ev $fxSpec $fxState $q) | Out-String)
  $evDigits = ''; $mm = [regex]::Match($rawEv, '"ev":\[([^\]]*)\],"evBits":\[([^\]]*)\]'); if ($mm.Success) { $evDigits = $mm.Groups[1].Value }
  $v44.referenceEv = [ordered]@{ printedDigits = $evDigits; bits = $mm.Groups[2].Value; expectedDigits = '15.020151348500445,15.670177585564113'; expectedBits = '"402e0a51470d8f36","402f57218439052d"' }
  Assert-Check ($mm.Success -and $evDigits -ceq '15.020151348500445,15.670177585564113' -and $mm.Groups[2].Value -ceq '"402e0a51470d8f36","402f57218439052d"') '4.4 exact EV reference: the engine prints 15.020151348500445,15.670177585564113 and the bit patterns 402e0a51470d8f36,402f57218439052d (raw output, no PowerShell number conversion)'
  # sampled-EV deadline: the 4.3 audit's regression (8 handed, range sampled). Limits and tolerance: validation/4.4/README.md
  $dl = @()
  foreach ($ms in @(100, 250, 600, 1000)) {
    [IO.File]::WriteAllText($q, ('{"path":[],"hands":[0],"range":true,"method":"sampled","samples":2000000,"timeLimitMs":' + $ms + '}'))
    $env:EM_QUERY_TIMING = '1'; $ErrorActionPreference = 'Continue'
    for ($i = 0; $i -lt 5; $i++) {
      $lines = & $cli --ev $fxSpec $fxState $q 2>&1 | ForEach-Object { "$_" }
      $timing = $lines | Where-Object { $_ -match '^\{"queryMs"' } | Select-Object -First 1 | ConvertFrom-Json
      $body = $lines | Where-Object { $_ -match '^\{"engine"' } | Select-Object -First 1
      $partial = $false; if ($body) { $partial = ($body -match '"status":"partial"') }
      $dl += [ordered]@{ limitMs = $ms; queryMs = [double]$timing.queryMs; overrunMs = ([double]$timing.queryMs - $ms); status = [int]$timing.status; partial = $partial }
    }
    $ErrorActionPreference = 'Stop'; Remove-Item Env:EM_QUERY_TIMING
  }
  $v44.sampledDeadline = $dl
  $worstOver = ($dl | ForEach-Object { $_.overrunMs } | Measure-Object -Maximum).Maximum
  # a run that reached its limit must be a labelled partial estimate; a run that finished all samples first is complete
  $badDl = @($dl | Where-Object { $_.status -ne 200 -or ($_.overrunMs -ge 0 -and -not $_.partial) }).Count
  $reached = @($dl | Where-Object { $_.partial }).Count
  Assert-Check ($badDl -eq 0 -and $worstOver -lt 50) ('4.4 sampled EV honours 100, 250, 600 and 1000 ms limits within 50 ms; runs that reached the limit are labelled partial (worst overrun of {0} runs: {1:N1} ms, {2} reached the limit)' -f $dl.Count, $worstOver, $reached)
  $passed = ($failures.Count -eq 0)
  if (-not $passed) { $failure = $failures[0] }
} catch {
  $failures.Add('stopped by an error: ' + $_.Exception.Message)
  $failure = $failures[0]
  Write-Host ('FAIL  ' + $_.Exception.Message) -ForegroundColor Red
} finally {
  $env:USERPROFILE=$oldProfile
  if ($engineProcess -and -not $engineProcess.HasExited) { Stop-Process -Id $engineProcess.Id -Force -ErrorAction SilentlyContinue }
  $env:EIGHTMAX_GPU = $oldGpu; $env:EIGHTMAX_THREADS = $oldThreads
  $reportData = [ordered]@{ version=$ExpectedVersion; build=$info.build; largeCheckpoint=$large; v40=$v40; v41=$v41; v42=$v42; v43=$v43; v44=$v44; passed=$passed; checks=$checks.ToArray(); error=$failure; failures=$failures.ToArray(); os=[Environment]::OSVersion.VersionString; powershell=$PSVersionTable.PSVersion.ToString(); gpuTested=$false; freshChecks=[bool]$Fresh }
  $reportData | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding UTF8
  Write-Host "Report: $Report"
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not $passed) { exit 1 }
