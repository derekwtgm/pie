# EightMax 3.9 hardware validation (Windows PowerShell 5.1+, no Node, Python or CUDA Toolkit needed).
# Produces hardware-validation.json next to the executables. Every number in it is
# measured on the machine that runs this script.
#   1. CUDA probe: driver, GPU name, compute capability, VRAM, loaded image (SASS or PTX).
#   2. Exact all-in equity: CPU (all logical processors) against CUDA, integer-exact comparison.
#   3. VRAM cap: a 1 MiB GPU budget must fall back to the CPU with the same answer.
#   4. Native external-sampling throughput with 1, 4 and all logical processors;
#      the strategy must be identical for every thread count.
#   5. The four scoring modes on the turn fixture (test_devices.ps1).
param([string]$Exe = '', [string]$Report = '')
$ErrorActionPreference = 'Stop'
# 3.3: Windows PowerShell 5.1 serializes arrays returned from functions as {"value":[...],"Count":n}
# through extended type data; removing it keeps JSON arrays plain (no effect on PowerShell 7).
Remove-TypeData System.Array -ErrorAction SilentlyContinue
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $Exe) { $Exe = Join-Path $root 'mwcli.exe' }
if (-not $Report) { $Report = Join-Path $root 'hardware-validation.json' }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
$logical = [Environment]::ProcessorCount
$failures = @()
function Write-Json($path, $value) { [IO.File]::WriteAllText($path, ($value | ConvertTo-Json -Depth 16 -Compress), [Text.UTF8Encoding]::new($false)) }
function Body-Hash($path) {
  $state = [IO.File]::ReadAllBytes($path); $at = 0 # 3.2 includes committed counters and both RNGs in its deterministic header
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($state, $at, $state.Length - $at)).Replace('-', '') } finally { $sha.Dispose() }
}
try {
  Write-Host 'EightMax 3.9 hardware validation'
  $build = (& $Exe --build-id)
  $cuda = (& $Exe --cuda-info) | ConvertFrom-Json
  if ($cuda.available) { Write-Host ("CUDA: {0}, compute capability {1}, {2} MiB total, {3} MiB free, image {4}" -f $cuda.name, $cuda.computeCapability, $cuda.totalMiB, $cuda.freeMiB, $cuda.image) }
  else { Write-Host ("CUDA unavailable: {0}. GPU checks are reported as not run." -f $cuda.reason) }

  # Card ids: rank*4+suit, rank 0=2 .. 12=A, suits c d h s.
  $cases = @(
    @{ name = 'heads-up preflop AA vs KK'; hands = @(@(48,49), @(44,45)); board = @() },
    @{ name = '3-way preflop'; hands = @(@(48,49), @(44,45), @(40,36)); board = @() },
    @{ name = '6-way preflop'; hands = @(@(48,49), @(44,45), @(40,36), @(0,5), @(1,9), @(2,30)); board = @() },
    @{ name = '8-way preflop'; hands = @(@(48,49), @(44,45), @(40,36), @(0,5), @(1,9), @(2,30), @(3,31), @(20,24)); board = @() },
    @{ name = '4-way flop'; hands = @(@(48,49), @(44,45), @(40,36), @(0,5)); board = @(46, 30, 13) }
  )
  $equity = @()
  foreach ($c in $cases) {
    $spec = Join-Path $tmp 'equity.json'
    Write-Json $spec @{ hands = $c.hands; board = $c.board; device = 'both'; threads = $logical; gpuMiB = 512 }
    $r = (& $Exe --equity $spec) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "Equity failed: $($c.name)" }
    $row = [ordered]@{ case = $c.name; boards = $r.boards; cpuSeconds = $r.cpuSeconds; cpuThreads = $r.cpuThreads; gpuUsed = $r.gpuUsed;
      gpuSeconds = $(if ($r.gpuUsed) { $r.gpuSeconds } else { $null }); gpuMatchesCpu = $r.gpuMatchesCpu;
      speedup = $(if ($r.gpuUsed -and $r.gpuSeconds -gt 0) { [math]::Round($r.cpuSeconds / $r.gpuSeconds, 2) } else { $null });
      gpuFallbackReason = $r.gpuFallbackReason; equity = $r.equity }
    if ($cuda.available -and -not $r.gpuMatchesCpu) { $failures += "GPU equity differs from CPU: $($c.name)" }
    $equity += [pscustomobject]$row
    Write-Host ("{0}: {1} boards, CPU {2:N3} s, GPU {3}" -f $c.name, $r.boards, $r.cpuSeconds, $(if ($r.gpuUsed) { '{0:N3} s, match={1}' -f $r.gpuSeconds, $r.gpuMatchesCpu } else { 'not used (' + $r.gpuFallbackReason + ')' }))
  }
  $spec = Join-Path $tmp 'cap.json'
  Write-Json $spec @{ hands = $cases[2].hands; board = @(); device = 'gpu'; threads = $logical; gpuMiB = 1 }
  $cap = (& $Exe --equity $spec) | ConvertFrom-Json
  $capOk = (-not $cap.gpuUsed) -and ((($cap.equity | ForEach-Object { '{0:R}' -f [double]$_ }) -join ',') -eq (($equity[2].equity | ForEach-Object { '{0:R}' -f [double]$_ }) -join ','))
  if (-not $capOk -and $cuda.available) { $failures += 'A 1 MiB GPU budget did not fall back to an identical CPU result' }

  $fixture = Join-Path $root 'source/tests/fixtures/es-preflop8.json'
  $training = @(); $reference = $null
  foreach ($t in @(1, 4, $logical) | Select-Object -Unique) {
    $state = Join-Path $tmp "es$t.state"
    $info = (& $Exe $fixture 400 $t $state 2048) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $info.iterations -ne 400) { throw "External-sampling training failed with $t threads" }
    $hash = Body-Hash $state
    if ($null -eq $reference) { $reference = $hash } elseif ($hash -ne $reference) { $failures += "External-sampling strategy differs with $t threads" }
    $training += [pscustomobject]@{ requestedThreads = $t; workerThreads = $info.threads; seconds = $info.wallSeconds; deals = $info.trainingDeals;
      dealsPerSecond = [math]::Round($info.trainingDeals / $info.wallSeconds, 0); states = $info.states; tableMiB = $info.tableMiB; strategySHA256 = $hash }
    Write-Host ("External sampling, {0} threads: {1:N0} deals/s" -f $t, ($info.trainingDeals / $info.wallSeconds))
  }
  $six = Join-Path $root 'source/tests/fixtures/es-six-weighted.json'
  $low = Join-Path $tmp 'low.state'
  $resumed = Join-Path $tmp 'resumed.state'
  $direct = Join-Path $tmp 'direct.state'
  $stopped = (& $Exe $six 500 2 $low 2) | ConvertFrom-Json
  if ($LASTEXITCODE -or !$stopped.limitReached) { throw 'Expected a recoverable memory stop' }
  $continued = (& $Exe $six 5 4 $resumed 128 $low) | ConvertFrom-Json
  if ($LASTEXITCODE) { throw 'Checkpoint resume failed' }
  $count = $stopped.iterations + 5
  $referenceRun = (& $Exe $six $count 1 $direct 128) | ConvertFrom-Json
  if ($LASTEXITCODE) { throw 'Reference run failed' }
  $same = (Body-Hash $resumed) -eq (Body-Hash $direct)
  if (!$same -or $stopped.trainingDeals -ne 4*$stopped.iterations) { $failures += 'Checkpoint continuation mismatch' }
  # 3.3 checks: input validation, external-sampling DCFR, native hand groups, GPU stage bound.
  $v33 = [ordered]@{}
  $negative = Join-Path $root 'source/tests/fixtures/invalid-negative-ante.json'
  # The expected refusal writes to stderr; PowerShell 5.1 would turn that into a terminating error under 'Stop'.
  $ErrorActionPreference = 'Continue'
  $refusal = (& $Exe $negative 3 1 (Join-Path $tmp 'neg.state') 2>&1 | Out-String); $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  $v33.negativeAnteRejected = ($code -ne 0); $v33.negativeAnteMessage = $refusal.Trim()
  if (-not $v33.negativeAnteRejected) { $failures += 'A negative ante was accepted' }
  foreach ($name in @('es-dcfr-six', 'es-grouped-six')) {
    $fx = Join-Path $root "source/tests/fixtures/$name.json"; $hashes = @(); $runs = @()
    foreach ($t in @(1, $logical) | Select-Object -Unique) {
      $st = Join-Path $tmp "$name-$t.state"; $info = (& $Exe $fx 300 $t $st 1024) | ConvertFrom-Json
      if ($LASTEXITCODE -ne 0 -or $info.iterations -ne 300) { throw "$name training failed with $t threads" }
      $hashes += (Body-Hash $st); $runs += [pscustomobject]@{ threads = $t; workerThreads = $info.threads; seconds = $info.wallSeconds; dealsPerSecond = [math]::Round($info.trainingDeals / $info.wallSeconds, 0); processPeakRssMiB = $info.processPeakRssMiB; weighting = $info.weighting; handGroups = $info.handGroups }
    }
    if (($hashes | Select-Object -Unique).Count -ne 1) { $failures += "$name strategy differs between thread counts" }
    $part = Join-Path $tmp "$name-part.state"; $res = Join-Path $tmp "$name-res.state"
    $null = (& $Exe $fx 120 2 $part 1024); $null = (& $Exe $fx 180 2 $res 1024 $part)
    $resumeOk = (Body-Hash $res) -eq $hashes[0]; if (-not $resumeOk) { $failures += "$name checkpoint resume differs" }
    $v33[$name] = [ordered]@{ runs = $runs; identicalAcrossThreads = (($hashes | Select-Object -Unique).Count -eq 1); resumeIdentical = $resumeOk }
  }
  $gpuSpec = Join-Path $tmp 'es-gpu.json'
  $g = Get-Content $six -Raw | ConvertFrom-Json; $g.device = 'gpu'; Write-Json $gpuSpec $g
  $gi = (& $Exe $gpuSpec 300 $logical (Join-Path $tmp 'gpu.state') 1024) | ConvertFrom-Json
  $v33.externalSamplingGpuRequest = [ordered]@{ devicePath = $gi.devicePath; gpuStageBound = $gi.gpuStageBound; seconds = $gi.seconds }
  # Frozen ES deals share one scoring batch. Compare the complete deterministic
  # state across routes. Device bytes and route identify actual hardware use.
  $g.batchDeals = 64
  $batchRuns = @()
  $cpuHash = ''
  foreach ($mode in @('cpu','auto','gpu','hybrid')) {
    $g.device = $mode
    Write-Json $gpuSpec $g
    $state = Join-Path $tmp "batch-$mode.state"
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $info = (& $Exe $gpuSpec 40 $logical $state 512) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $info.iterations -ne 40) { throw "Incomplete ES batch in $mode" }
    $hash = Body-Hash $state
    if ($mode -eq 'cpu') { $cpuHash = $hash }
    if ($hash -ne $cpuHash) { $failures += "External sampling state differs in $mode" }
    $clock.Stop()
    $batchRuns += [pscustomobject]@{trainingDeals=$info.trainingDeals; stateVisits=$info.stateVisits; sha256=$hash; mode=$mode; path=$info.devicePath; gpuPeakBytes=$info.gpuBufferPeakBytes; seconds=$info.wallSeconds; processSeconds=$clock.Elapsed.TotalSeconds; processPeakMiB=$info.processPeakRssMiB; calibrationSeconds=$info.scoreCalibrationSeconds; cpuProbeSeconds=$info.cpuScoreProbeSeconds; deviceProbeSeconds=$info.bestDeviceScoreSeconds; sameState=($hash -eq $cpuHash)}
  }
  # 3.9: end-to-end action-EV and response-gain timing on the eight-handed
  # preflop fixture (CPU engine; these calculations do not use the GPU), and
  # malformed-request rejection by the native explorer.
  $v39 = [ordered]@{}
  $es8 = Join-Path $tmp 'es1.state'
  $evReq = Join-Path $tmp 'ev.json'
  Write-Json $evReq @{ path = @(); hands = @(0, 200, 600); range = $true; samples = 2000; seed = 1 }
  $clock = [Diagnostics.Stopwatch]::StartNew(); $ev = (& $Exe --ev $fixture $es8 $evReq) | ConvertFrom-Json; $clock.Stop()
  if ($LASTEXITCODE -ne 0 -or $ev.hands.Count -ne 3) { $failures += 'Action-EV request failed' }
  $v39.actionEv = [ordered]@{ seconds = $clock.Elapsed.TotalSeconds; method = $ev.method; utility = $ev.utility.model; samplesPerHand = $ev.hands[0].samples; actions = $ev.actions.Count; maxStdErr = ($ev.hands | ForEach-Object { $_.stdErr } | Measure-Object -Maximum).Maximum }
  $gainReq = Join-Path $tmp 'gain.json'
  Write-Json $gainReq @{ method = 'sampled'; samples = 400; selectionSamples = 16; reachSamples = 2000; seed = 1; futureActions = 'sample' }
  $clock = [Diagnostics.Stopwatch]::StartNew(); $gain = (& $Exe --gain $fixture $es8 $gainReq) | ConvertFrom-Json; $clock.Stop()
  if ($LASTEXITCODE -ne 0) { $failures += 'Response-gain request failed' }
  $v39.responseGain = [ordered]@{ seconds = $clock.Elapsed.TotalSeconds; seats = @($gain.seats | ForEach-Object { [ordered]@{ seat = $_.seat; gain = $_.gain.mean; stdErr = $_.gain.stdErr } }) }
  $badReq = Join-Path $tmp 'bad.json'; Set-Content -LiteralPath $badReq -Value '{"rangeSeat":"nonsense"}' -Encoding ASCII
  $ErrorActionPreference = 'Continue'
  $refusal = (& $Exe --node $fixture $es8 $badReq 2>&1 | Out-String); $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  $v39.malformedRequestRejected = ($code -ne 0 -and $refusal -match 'rangeSeat must be an integer'); $v39.malformedRequestMessage = $refusal.Trim()
  if (-not $v39.malformedRequestRejected) { $failures += 'A malformed explorer request was accepted' }
  $devices = $null
  try { & (Join-Path $PSScriptRoot 'test_devices.ps1'); $devices = Get-Content (Join-Path $root 'device-results.json') -Raw | ConvertFrom-Json }
  catch { $failures += "Scoring-mode comparison failed: $($_.Exception.Message)" }

  $out = [ordered]@{ tool = 'EightMax 3.9 hardware validation'; build = $build; date = (Get-Date).ToString('s');
    os = [Environment]::OSVersion.VersionString; cpu = $env:PROCESSOR_IDENTIFIER; logicalProcessors = $logical;
    memoryGiB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1);
    graphics = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, AdapterRAM);
    cuda = $cuda; equity = $equity; v39 = $v39; vramCapFallback = [ordered]@{ ok = $capOk; gpuUsed = $cap.gpuUsed; reason = $cap.gpuFallbackReason };
    gpuExecutionVerified = [bool]($cuda.available -and ($equity | Where-Object { $_.gpuUsed -and $_.gpuMatchesCpu }))
    checkpointRecovery = @{ identical = $same; stopped = $stopped; resumed = $continued; uninterrupted = $referenceRun }
    externalSampling = $training; version33 = $v33; externalBatchModes = $batchRuns; scoringModes = $devices; failures = $failures; passed = ($failures.Count -eq 0) }
  $out | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $Report
  Write-Host "Saved $Report"
  if ($failures.Count) { $failures | ForEach-Object { Write-Host "FAILED: $_" }; exit 1 }
  Write-Host 'Completed available checks. See gpuExecutionVerified for physical CUDA status.'
} catch {
  [ordered]@{tool='EightMax 3.9 hardware validation';completed=$false;passed=$false;gpuExecutionVerified=$false;error=$_.Exception.Message} | ConvertTo-Json | Set-Content -Encoding UTF8 $Report
  Write-Host ('Hardware check stopped: '+$_.Exception.Message)
  exit 1
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
