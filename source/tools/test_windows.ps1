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
  $engineProcess = Start-Process -FilePath $Exe -ArgumentList @('--no-browser', "--port=$port") -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $work 'stdout.txt') -RedirectStandardError (Join-Path $work 'stderr.txt')
  $deadline = [datetime]::UtcNow.AddSeconds(20); $info = $null
  while ([datetime]::UtcNow -lt $deadline) {
    if ($engineProcess.HasExited) { throw 'EightMax exited before its server was ready' }
    try { $info = Api 'info'; break } catch { Start-Sleep -Milliseconds 100 }
  }
  Assert-Check ($null -ne $info -and $info.native -eq $true -and $info.version -eq $ExpectedVersion) 'Native server starts and reports the expected version'
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
  $passed = $true
} catch {
  $failure = $_.Exception.Message
  Write-Host ('FAIL  ' + $failure) -ForegroundColor Red
} finally {
  if ($engineProcess -and -not $engineProcess.HasExited) { Stop-Process -Id $engineProcess.Id -Force -ErrorAction SilentlyContinue }
  $env:EIGHTMAX_GPU = $oldGpu; $env:EIGHTMAX_THREADS = $oldThreads
  $reportData = [ordered]@{ version=$ExpectedVersion; passed=$passed; checks=$checks.ToArray(); error=$failure; os=[Environment]::OSVersion.VersionString; powershell=$PSVersionTable.PSVersion.ToString(); gpuTested=$false; freshChecks=[bool]$Fresh }
  $reportData | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding UTF8
  Write-Host "Report: $Report"
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not $passed) { exit 1 }
