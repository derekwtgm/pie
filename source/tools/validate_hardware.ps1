# EightMax 4.5 hardware validation (Windows PowerShell 5.1+, no Node, Python or CUDA Toolkit needed).
# Produces hardware-validation.json next to the executables. Every number in it is
# measured on the machine that runs this script.
#   1. CUDA probe: driver, GPU name, compute capability, VRAM, loaded image (SASS or PTX).
#   2. Exact all-in equity: CPU (all logical processors) against CUDA, integer-exact comparison.
#   3. GPU budget (4.2, corrected): the equity kernel needs only a few KiB, so the
#      4.1 check "a 1 MiB budget must fall back" was wrong (a 1 MiB budget is
#      legitimately enough). 4.2 measures the real request (gpuRequestedBytes),
#      then sets gpuBudgetBytes to request-1 (must be refused and fall back with
#      the identical result) and to exactly the request (must run on the GPU).
#   4. Native external-sampling throughput with 1, 4 and all logical processors;
#      the strategy must be identical for every thread count.
#   5. The four scoring modes on the turn fixture (test_devices.ps1).
#   6. 4.0: exact action-EV showdown tables on the eight-player ICM fixture with
#      CPU only, GPU preferred, hybrid and automatic processing: wall time,
#      boards scored on the GPU, and bit-identical EVs; evaluation thread
#      scaling (1, 2, 4, 8, all logical processors); the 100 ms deadline.
#   7. 4.1: complete EV workloads (exact root and node evaluations of the
#      eight-player ICM fixture) with CPU only, GPU preferred, hybrid and
#      automatic processing: end-to-end time, numerical agreement, peak VRAM,
#      the scheduler's per-table decisions and cancellation latency while the
#      GPU is in use; parallel response gains (1, 2, 4, 8, all processors);
#      malformed-number refusal. "physicalNvidiaExecution" is true only when
#      CUDA scored boards on this PC and matched the CPU bit for bit;
#      "environment" records Wine and virtual-machine indicators so a report
#      from an emulator or VM is never mistaken for physical hardware.
#   8. 4.2: the 4.1 EV-table configurations re-run (requested vs observed device,
#      GPU/CPU boards, CUDA errors with driver codes, time, peak VRAM, EVs);
#      EV-table budget refusal and fallback; response gains with 1, 2, 4, 8, 12,
#      16 and all logical processors; and gpustress.exe: concurrent multithreaded
#      GPU jobs in one process, cancellation while the GPU is in use, repeated
#      CUDA re-initialisation, every result compared bit for bit with the CPU.
#   9. 4.3: COLD vs WARM CUDA in one process (mwcli --session): for CPU only, GPU
#      preferred, hybrid and automatic with 1, 2, 4, 8 and all logical
#      processors: the first evaluation after start-up, the second, ten
#      sequential, four concurrent, after 1.5 s idle (with idle buffer release),
#      cancelled, after cancellation, a recoverable budget refusal and the run
#      after it. Every value is compared with the first run; per session the
#      device must be opened and verified at most once. Shared showdown tables:
#      boards scored per request (4.2 scored one table per worker / per seat).
#  10. 4.4: AUTOMATIC ON A WARM DEVICE (mwcli --session): per thread count the device
#      is opened and verified, then 48 Automatic requests measure the three ways to
#      build a table (CPU, GPU pull, GPU preferred) and settle on the fastest; 6
#      CPU-only and 6 GPU-preferred requests give references from the same process;
#      the same plan runs again under the 4.3 rule (EM_GPU_AUTO_MODEL=4.3). Results
#      are compared as IEEE 754 bit patterns (a difference is a failure); timings are
#      recorded as findings (v44.findings), not failures.
#      4.4 also compares every "identical" result of sections 2-9 as bit patterns or
#      exact integers instead of re-formatted numbers (validation/4.4/NUMERIC-POLICY.md).
#      Eight-seat response gains in sessions (GPU preferred, automatic).
#  11. 4.5: SMALL / MEDIUM / LARGE evaluations per processing mode in fresh processes (cold
#      device): requested and observed device, CPU and GPU boards, time (median of 3), peak
#      VRAM against gpuMiB, coverage peak bytes against coverageMiB; exact results compared as
#      bit patterns between modes; whether cold Automatic is within 15% of the best fixed mode
#      (a finding, not a failure).
#      End-to-end times (queryMs) are reported, never kernel time alone.
param([string]$Exe = '', [string]$Report = '', [switch]$Quick)
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
  Write-Host 'EightMax 4.5 hardware validation'
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
      gpuFallbackReason = $r.gpuFallbackReason; equity = $r.equity; shareUnits = (@($r.shareUnits | ForEach-Object { [string]$_ }) -join ',') }
    if ($cuda.available -and -not $r.gpuMatchesCpu) { $failures += "GPU equity differs from CPU: $($c.name)" }
    $equity += [pscustomobject]$row
    Write-Host ("{0}: {1} boards, CPU {2:N3} s, GPU {3}" -f $c.name, $r.boards, $r.cpuSeconds, $(if ($r.gpuUsed) { '{0:N3} s, match={1}' -f $r.gpuSeconds, $r.gpuMatchesCpu } else { 'not used (' + $r.gpuFallbackReason + ')' }))
  }
  # 4.2: genuine budget test (see header, item 3)
  $spec = Join-Path $tmp 'cap.json'
  Write-Json $spec @{ hands = $cases[2].hands; board = @(); device = 'gpu'; threads = $logical; gpuMiB = 1 }
  $probe = (& $Exe --equity $spec) | ConvertFrom-Json
  $need = [long]$probe.gpuRequestedBytes
  $refEq = [string]$equity[2].shareUnits   # 4.4: exact integer share units, not re-formatted doubles
  $cap = $null; $atCap = $null; $capOk = $true
  if ($cuda.available -and $need -gt 1) {
    Write-Json $spec @{ hands = $cases[2].hands; board = @(); device = 'gpu'; threads = $logical; gpuBudgetBytes = ($need - 1) }
    $cap = (& $Exe --equity $spec) | ConvertFrom-Json
    Write-Json $spec @{ hands = $cases[2].hands; board = @(); device = 'gpu'; threads = $logical; gpuBudgetBytes = $need }
    $atCap = (& $Exe --equity $spec) | ConvertFrom-Json
    $sameEquity = { param($r) ((@($r.shareUnits | ForEach-Object { [string]$_ }) -join ',') -eq $refEq -and $refEq -ne '') }
    $capOk = (-not $cap.gpuUsed) -and ($cap.gpuError.name -eq 'EM_GPU_BUDGET_EXCEEDED') -and (& $sameEquity $cap) -and $atCap.gpuUsed -and (& $sameEquity $atCap) -and ([long]$atCap.gpuBufferPeakBytes -eq $need)
    if (-not $capOk) { $failures += "GPU budget check: budget $($need - 1) B must be refused with an identical CPU result and $need B must run on the GPU" }
    Write-Host ("GPU budget: request {0} bytes; budget {1} B -> GPU used {2}; budget {0} B -> GPU used {3}, peak {4} B" -f $need, ($need - 1), $cap.gpuUsed, $atCap.gpuUsed, $atCap.gpuBufferPeakBytes)
  }

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
  # 4.0: action-EV processing modes, thread scaling and deadline on the eight-player ICM fixture
  $fx = Join-Path $root 'validation/4.0/fixtures'; $fxSpec = Join-Path $fx 'push8-icm.spec.json'; $fxState = Join-Path $fx 'push8-icm.state'
  $evq = Join-Path $tmp 'ev40.json'; $v40 = [ordered]@{ devices = @(); threads = @() }
  $reference = $null
  foreach ($dev in @('cpu', 'gpu', 'hybrid', 'auto')) {
    Write-Json $evq @{ path = @(1, 1); hands = @(0); method = 'exact'; device = $dev; threads = $logical; timeLimitMs = 600000; maxVisits = 2000000000 }
    $clock = [Diagnostics.Stopwatch]::StartNew(); $r = (& $Exe --ev $fxSpec $fxState $evq) | ConvertFrom-Json; $clock.Stop()
    if ($LASTEXITCODE -ne 0) { $failures += "Action EV failed with device $dev"; continue }
    $evText = (@($r.hands[0].evBits) -join ',')
    if ($null -eq $reference) { $reference = $evText }
    $same = $evText -eq $reference
    if (-not $same) { $failures += "Action EV with device $dev differs from the CPU result" }
    $v40.devices += [ordered]@{ device = $dev; seconds = $clock.Elapsed.TotalSeconds; gpuBoards = $r.execution.gpuBoards; cpuBoards = $r.execution.cpuBoards; gpuNote = $r.execution.gpuNote; identicalToCpu = $same; ev = $r.hands[0].ev }
    Write-Host ("Action EV ({0}): {1:N3} s, {2} boards on the GPU, identical to CPU: {3}" -f $dev, $clock.Elapsed.TotalSeconds, $r.execution.gpuBoards, $same)
  }
  $v40.gpuEvExecutionVerified = [bool]($cuda.available -and ($v40.devices | Where-Object { $_.gpuBoards -gt 0 -and $_.identicalToCpu }))
  foreach ($t in @(1, 2, 4, 8, $logical) | Sort-Object -Unique) {
    if ($t -gt $logical) { continue }
    Write-Json $evq @{ path = @(); hands = @(0); method = 'exact'; device = 'cpu'; threads = $t; timeLimitMs = 600000; maxVisits = 2000000000 }
    $clock = [Diagnostics.Stopwatch]::StartNew(); $r = (& $Exe --ev $fxSpec $fxState $evq) | ConvertFrom-Json; $clock.Stop()
    $v40.threads += [ordered]@{ threads = $t; seconds = $clock.Elapsed.TotalSeconds; ev = $r.hands[0].ev }
    Write-Host ("Exact root EV with {0} evaluation threads: {1:N3} s" -f $t, $clock.Elapsed.TotalSeconds)
  }
  Write-Json $evq @{ path = @(); hands = @(0); method = 'exact'; timeLimitMs = 100; maxVisits = 2000000000 }
  # 4.2: the deadline and cancellation checks below need workloads slower than their
  # limits; the 4.2 pattern projection finishes them sooner, so the retained 4.1
  # per-board method (EM_EV_DIRECT_PATTERNS=1) is selected for them.
  $env:EM_EV_DIRECT_PATTERNS = '1'; $env:EM_QUERY_TIMING = '1'; $ErrorActionPreference = 'Continue'
  $lines = & $Exe --ev $fxSpec $fxState $evq 2>&1 | ForEach-Object { "$_" }
  $ErrorActionPreference = 'Stop'; Remove-Item Env:EM_QUERY_TIMING; Remove-Item Env:EM_EV_DIRECT_PATTERNS
  $v40.deadline100ms = $lines | Where-Object { $_ -match '^\{"queryMs"' } | Select-Object -First 1 | ConvertFrom-Json
  if ($v40.deadline100ms.status -ne 408 -or $v40.deadline100ms.queryMs -gt 250) { $failures += 'The 100 ms action-EV deadline was not honoured' }
  # 4.1: complete workloads, scheduling decisions, peak VRAM, cancellation, parallel gains, numeric safety
  $v41 = [ordered]@{ devices = @(); responseGainThreads = @() }
  $wine = (Test-Path 'HKLM:\Software\Wine') -or (Test-Path 'HKCU:\Software\Wine')
  $model = (Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).Model
  $v41.environment = [ordered]@{ wine = $wine; computerModel = $model; virtualMachineIndicated = [bool]($model -match 'Virtual|VMware|KVM|HVM|Xen|QEMU|VirtualBox') }
  $ref41 = $null
  foreach ($dev in @('cpu', 'gpu', 'hybrid', 'auto')) {
    Write-Json $evq @{ path = @(); hands = @(0); method = 'exact'; device = $dev; threads = $logical; timeLimitMs = 600000; maxVisits = 2000000000; gpuMiB = 2048 }
    $clock = [Diagnostics.Stopwatch]::StartNew(); $r = (& $Exe --ev $fxSpec $fxState $evq) | ConvertFrom-Json; $clock.Stop()
    if ($LASTEXITCODE -ne 0) { $failures += "4.1 complete EV workload failed with device $dev"; continue }
    $evText = (@($r.hands[0].evBits) -join ',')
    if ($null -eq $ref41) { $ref41 = $evText }
    if ($evText -ne $ref41) { $failures += "4.1 complete EV workload with device $dev differs from the CPU result" }
    $v41.devices += [ordered]@{ device = $dev; seconds = $clock.Elapsed.TotalSeconds; identicalToCpu = ($evText -eq $ref41); gpuBoards = $r.execution.gpuBoards; cpuBoards = $r.execution.cpuBoards; gpuPeakMiB = $r.execution.gpuPeakMiB; peakEvaluationMiB = $r.execution.peakEvaluationMiB; scheduling = $r.execution.scheduling; boardEvaluations = $r.work.boardEvaluations; gpuNote = $r.execution.gpuNote }
    Write-Host ("4.1 complete exact EV ({0}): {1:N3} s, {2} GPU boards, peak VRAM {3} MiB" -f $dev, $clock.Elapsed.TotalSeconds, $r.execution.gpuBoards, $r.execution.gpuPeakMiB)
  }
  $v41.physicalNvidiaExecution = [bool]($cuda.available -and -not $wine -and ($v41.devices | Where-Object { $_.gpuBoards -gt 0 -and $_.identicalToCpu }))
  $cpuRow = $v41.devices | Where-Object { $_.device -eq 'cpu' } | Select-Object -First 1
  foreach ($row in $v41.devices) { if ($cpuRow -and $row.seconds -gt 0) { $row.speedupVsCpu = [math]::Round($cpuRow.seconds / $row.seconds, 3) } }
  Write-Json $evq @{ path = @(); hands = @(0); method = 'exact'; device = 'gpu'; threads = $logical; timeLimitMs = 600000; maxVisits = 2000000000 }
  $env:EM_EV_DIRECT_PATTERNS = '1'; $env:EM_QUERY_TIMING = '1'; $env:EM_CANCEL_AFTER_MS = '300'; $ErrorActionPreference = 'Continue'
  $lines = & $Exe --ev $fxSpec $fxState $evq 2>&1 | ForEach-Object { "$_" }
  $ErrorActionPreference = 'Stop'; Remove-Item Env:EM_QUERY_TIMING; Remove-Item Env:EM_CANCEL_AFTER_MS; Remove-Item Env:EM_EV_DIRECT_PATTERNS
  $v41.cancelWhileGpu = $lines | Where-Object { $_ -match '^\{"queryMs"' } | Select-Object -First 1 | ConvertFrom-Json
  if ($v41.cancelWhileGpu.status -ne 409 -or $v41.cancelWhileGpu.cancelLatencyMs -gt 250) { $failures += '4.1 cancellation during GPU evaluation was not prompt' }
  foreach ($t in @(1, 2, 4, 8, $logical) | Sort-Object -Unique) {
    if ($t -gt $logical) { continue }
    Write-Json $evq @{ method = 'exact'; seats = @(0, 1, 2, 3, 4, 5, 6, 7); threads = $t; timeLimitMs = 600000 }
    $clock = [Diagnostics.Stopwatch]::StartNew(); $g = (& $Exe --gain $fxSpec $fxState $evq) | ConvertFrom-Json; $clock.Stop()
    $v41.responseGainThreads += [ordered]@{ threads = $t; seconds = $clock.Elapsed.TotalSeconds; gains = (@($g.seats | ForEach-Object { $_.gainBits }) -join ',') }
    Write-Host ("Exact response gains, 8 seats, {0} threads: {1:N3} s" -f $t, $clock.Elapsed.TotalSeconds)
  }
  if (@($v41.responseGainThreads | ForEach-Object { $_.gains } | Select-Object -Unique).Count -ne 1) { $failures += '4.1 response gains differ between thread counts' }
  [IO.File]::WriteAllText($evq, '{"path":[],"hands":[0],"memoryMiB":1e300}')
  $ErrorActionPreference = 'Continue'; $msg = (& $Exe --ev $fxSpec $fxState $evq 2>&1 | Out-String); $code = $LASTEXITCODE; $ErrorActionPreference = 'Stop'
  $v41.malformedNumberRefused = ($code -ne 0 -and $msg -match 'memoryMiB')
  if (-not $v41.malformedNumberRefused) { $failures += '4.1 memoryMiB 1e300 was not refused' }
  # ---------------- 4.2 ----------------
  $v42 = [ordered]@{ evTables = @(); responseGainThreads = @(); budget = $null; stress = $null }
  $ref42 = $null
  foreach ($t in @(1, 2, 4, 8, $logical) | Sort-Object -Unique) {
    if ($t -gt $logical) { continue }
    foreach ($dev in @('cpu', 'gpu', 'hybrid', 'auto')) {
      Write-Json $evq @{ path = @(); hands = @(0); method = 'exact'; device = $dev; threads = $t; timeLimitMs = 600000; maxVisits = 2000000000; gpuMiB = 2048 }
      $clock = [Diagnostics.Stopwatch]::StartNew(); $r = (& $Exe --ev $fxSpec $fxState $evq) | ConvertFrom-Json; $clock.Stop()
      if ($LASTEXITCODE -ne 0) { $failures += "4.2 EV table run failed: $dev, $t threads"; continue }
      $evText = (@($r.hands[0].evBits) -join ',')
      if ($null -eq $ref42) { $ref42 = $evText }
      $x = $r.execution
      $row = [ordered]@{ threads = $t; requestedDevice = $dev; observedDevice = $x.observedDevice; seconds = $clock.Elapsed.TotalSeconds; gpuBoards = $x.gpuBoards; cpuBoards = $x.cpuBoards;
        identicalToCpu = ($evText -eq $ref42); gpuPeakMiB = $x.gpuPeakMiB; cudaErrors = $x.gpuErrors; gpuNote = $x.gpuNote; scheduling = $x.scheduling; profileSeconds = $x.profileSeconds; cuda = $x.cuda }
      $v42.evTables += $row
      if ($evText -ne $ref42) { $failures += "4.2 EV with $dev on $t threads differs from the CPU" }
      $hardErr = @($x.gpuErrors | Where-Object { $_.name -notin @('EM_GPU_BUDGET_EXCEEDED', 'EM_VRAM_RESERVE', 'CUDA_ERROR_OUT_OF_MEMORY') })
      if ($cuda.available -and $hardErr.Count) { $failures += "4.2 CUDA error with $dev on $t threads: $($hardErr[0].operation) $($hardErr[0].name)" }
      if ($cuda.available -and $dev -eq 'gpu' -and $x.gpuBoards -le 65536) { $failures += "4.2 GPU-preferred mode on $t threads scored only $($x.gpuBoards) boards on the GPU (4.1 failure signature)" }
      Write-Host ("4.2 exact EV {0,-6} {1,2} threads: {2:N3} s, ran on {3}, GPU boards {4}, CPU boards {5}, identical {6}, errors {7}" -f $dev, $t, $clock.Elapsed.TotalSeconds, $x.observedDevice, $x.gpuBoards, $x.cpuBoards, ($evText -eq $ref42), @($x.gpuErrors).Count)
    }
  }
  # EV-table budget refusal: 4 KiB is below one table chunk
  Write-Json $evq @{ path = @(); hands = @(0); method = 'exact'; device = 'gpu'; threads = $logical; timeLimitMs = 600000; maxVisits = 2000000000; gpuBudgetBytes = 4096 }
  $r = (& $Exe --ev $fxSpec $fxState $evq) | ConvertFrom-Json
  $evText = (@($r.hands[0].evBits) -join ',')
  $v42.budget = [ordered]@{ budgetBytes = 4096; gpuBoards = $r.execution.gpuBoards; identicalToCpu = ($evText -eq $ref42); declined = $r.execution.scheduling.gpuDeclinedTransient; deviceStillAvailable = $r.execution.cuda.available; firstError = @($r.execution.gpuErrors)[0] }
  if ($evText -ne $ref42 -or $r.execution.gpuBoards -ne 0) { $failures += '4.2 EV-table budget refusal did not fall back to an identical CPU result' }
  foreach ($t in @(1, 2, 4, 8, 12, 16, $logical) | Sort-Object -Unique) {
    if ($t -gt $logical) { continue }
    Write-Json $evq @{ method = 'exact'; seats = @(0, 1, 2, 3, 4, 5, 6, 7); threads = $t; timeLimitMs = 600000 }
    $clock = [Diagnostics.Stopwatch]::StartNew(); $g = (& $Exe --gain $fxSpec $fxState $evq) | ConvertFrom-Json; $clock.Stop()
    $v42.responseGainThreads += [ordered]@{ threads = $t; seconds = $clock.Elapsed.TotalSeconds; gains = (@($g.seats | ForEach-Object { $_.gainBits }) -join ','); patternSeconds = $g.execution.profileSeconds.patternCounting }
    Write-Host ("4.2 exact response gains, 8 seats, {0} threads: {1:N3} s" -f $t, $clock.Elapsed.TotalSeconds)
  }
  if (@($v42.responseGainThreads | ForEach-Object { $_.gains } | Select-Object -Unique).Count -ne 1) { $failures += '4.2 response gains differ between thread counts' }
  if (@($v42.responseGainThreads | ForEach-Object { $_.gains } | Select-Object -First 1) -ne (@($v41.responseGainThreads | ForEach-Object { $_.gains } | Select-Object -First 1))) { $failures += '4.2 response gains differ from the 4.1-method values' }
  $stressExe = Join-Path $root 'gpustress.exe'
  if (Test-Path $stressExe) {
    $clock = [Diagnostics.Stopwatch]::StartNew(); $ErrorActionPreference = 'Continue'
    $stressText = (& $stressExe $fxSpec $fxState 3 $logical 2>&1 | ForEach-Object { "$_" }); $stressCode = $LASTEXITCODE; $ErrorActionPreference = 'Stop'; $clock.Stop()
    $stressJson = $stressText | Where-Object { $_ -match '^\{"tool"' } | Select-Object -First 1
    $v42.stress = if ($stressJson) { $stressJson | ConvertFrom-Json } else { [ordered]@{ output = ($stressText -join "`n") } }
    $v42.stressSeconds = $clock.Elapsed.TotalSeconds; $v42.stressExitCode = $stressCode
    if ($stressCode -ne 0) { $failures += "4.2 gpustress reported failures (exit $stressCode)" }
    Write-Host ("4.2 GPU stress: exit {0}, {1:N1} s" -f $stressCode, $clock.Elapsed.TotalSeconds)
  } else { $failures += 'gpustress.exe is missing' }
  $v42.physicalNvidiaExecution = [bool]($cuda.available -and -not $wine -and ($v42.evTables | Where-Object { $_.gpuBoards -gt 65536 -and $_.identicalToCpu }))


  # ---------------- 4.3: cold vs warm CUDA in one process, shared tables ----------------
  $v43 = [ordered]@{ sessions = @(); gainSessions = @(); summary = @() }
  $sessionPlan = Join-Path $tmp 'session43.json'
  function Run-Session($mode, $request, $label) {
    $bud = @{}; foreach ($k in $request.Keys) { $bud[$k] = $request[$k] }; $bud.gpuBudgetBytes = 4096
    $plan = [ordered]@{ mode = $mode; request = $request; steps = @(
      [ordered]@{ label = 'cold' }, [ordered]@{ label = 'warm' }, [ordered]@{ label = 'ten sequential'; repeat = 10 },
      [ordered]@{ label = 'four concurrent'; concurrent = 4; repeat = 2 }, [ordered]@{ label = 'after idle'; idleMs = 1500 },
      [ordered]@{ label = 'cancelled'; cancelAfterMs = 5 }, [ordered]@{ label = 'after cancellation' },
      [ordered]@{ label = 'budget refusal'; request = $bud }, [ordered]@{ label = 'after refusal' }) }
    Write-Json $sessionPlan $plan
    $env:EM_GPU_IDLE_RELEASE_S = '1'; $ErrorActionPreference = 'Continue'
    $text = (& $Exe --session $fxSpec $fxState $sessionPlan 2>&1 | ForEach-Object { "$_" }); $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'; Remove-Item Env:EM_GPU_IDLE_RELEASE_S
    $json = $text | Where-Object { $_ -match '^\{"tool":"mwcli session' } | Select-Object -First 1
    if (-not $json) { return [ordered]@{ label = $label; error = ($text -join "`n"); exitCode = $code } }
    $s = $json | ConvertFrom-Json
    $steps = @(); $hard = @()
    foreach ($st in $s.steps) {
      $res = @($st.runs | ForEach-Object { $_.results } | ForEach-Object { $_ })
      $ok = @($res | Where-Object { $_.status -eq 200 })
      $ms = @($ok | ForEach-Object { [double]$_.queryMs } | Sort-Object)
      $median = if ($ms.Count) { $ms[[int][math]::Floor(($ms.Count - 1) / 2)] } else { $null }
      foreach ($r in $ok) { $hard += @($r.gpuErrors | Where-Object { $_.name -notin @('EM_GPU_BUDGET_EXCEEDED', 'EM_VRAM_RESERVE', 'CUDA_ERROR_OUT_OF_MEMORY') }) }
      $first = $ok | Select-Object -First 1
      $steps += [ordered]@{ step = $st.label; runs = $res.Count; completed = $ok.Count; status = @($res | ForEach-Object { $_.status } | Select-Object -Unique);
        medianQueryMs = $median; minQueryMs = $(if ($ms.Count) { $ms[0] } else { $null }); maxQueryMs = $(if ($ms.Count) { $ms[-1] } else { $null });
        wallMs = @($st.runs | ForEach-Object { $_.wallMs }); observedDevice = $(if ($first) { $first.observedDevice } else { $null });
        gpuBoards = $(if ($first) { $first.gpuBoards } else { $null }); cpuBoards = $(if ($first) { $first.cpuBoards } else { $null });
        cudaStartupSeconds = $(if ($first) { $first.profileSeconds.cudaStartup } else { $null }); gpuVerificationSeconds = $(if ($first) { $first.profileSeconds.gpuVerification } else { $null });
        gpuLockWaitSeconds = @($ok | ForEach-Object { $_.profileSeconds.gpuLockWait }); uploadLaunchSeconds = $(if ($first) { $first.profileSeconds.gpuUploadAndLaunch } else { $null });
        kernelDownloadSeconds = $(if ($first) { $first.profileSeconds.gpuKernelAndDownload } else { $null }); tableSeconds = $(if ($first) { $first.profileSeconds.cpuTableScoring } else { $null });
        patternSeconds = $(if ($first) { $first.profileSeconds.patternCounting } else { $null }); scheduling = $(if ($first) { $first.scheduling } else { $null }); tables43 = $(if ($first) { $first.tables43 } else { $null });
        cancelLatencyMs = @($res | Where-Object { $_.cancelLatencyMs } | ForEach-Object { $_.cancelLatencyMs }); gpuErrors = @($ok | ForEach-Object { $_.gpuErrors } | Where-Object { $_ } | Select-Object -First 3);
        gpuAfter = $st.gpuAfter }
    }
    $last = $s.steps[-1].gpuAfter
    return [ordered]@{ label = $label; exitCode = $code; mismatches = $s.mismatches; values = (@($s.steps[0].runs[0].results[0].values) -join ','); valueBits = (@($s.steps[0].runs[0].results[0].valueBits) -join ','); opens = $last.opens; verifications = $last.verifications; idleBufferReleases = $last.idleBufferReleases;
      processPeakDeviceBytes = $last.processPeakDeviceBytes; hardCudaErrors = @($hard | Select-Object -First 3); sessionSeconds = $s.sessionSeconds; steps = $steps }
  }
  $threadSet = if ($Quick) { @(1, $logical) } else { @(1, 2, 4, 8, $logical) }
  $ref43 = $null
  foreach ($t in $threadSet | Sort-Object -Unique) {
    if ($t -gt $logical) { continue }
    foreach ($dev in @('cpu', 'gpu', 'hybrid', 'auto')) {
      $req = [ordered]@{ path = @(); hands = @(0); method = 'exact'; device = $dev; threads = $t; timeLimitMs = 600000; maxVisits = 2000000000; gpuMiB = 2048 }
      $r = Run-Session 'ev' $req ("ev {0} {1} threads" -f $dev, $t)
      $v43.sessions += $r
      if ($r.error) { $failures += "4.3 session failed: $($r.label)"; continue }
      if ($null -eq $ref43) { $ref43 = $r.valueBits }   # 4.4: IEEE 754 bit patterns
      if ($r.mismatches -ne 0 -or $r.valueBits -ne $ref43 -or $ref43 -ne '402e0a51470d8f36,402f57218439052d') { $failures += "4.3 $($r.label): values differ (bits $($r.valueBits))" }
      if ($r.hardCudaErrors.Count) { $failures += "4.3 $($r.label): CUDA error $($r.hardCudaErrors[0].operation) $($r.hardCudaErrors[0].name)" }
      if ($cuda.available -and $r.opens -gt 1) { $failures += "4.3 $($r.label): CUDA opened $($r.opens) times in one process" }
      if ($cuda.available -and $r.verifications -gt 1) { $failures += "4.3 $($r.label): device verified $($r.verifications) times in one process" }
      foreach ($st in $r.steps) { if ($st.completed -and ($st.gpuBoards + $st.cpuBoards) -ne 376992) { $failures += "4.3 $($r.label) $($st.step): $($st.gpuBoards + $st.cpuBoards) boards scored (expected one table, 376,992)" } }
      if ($cuda.available -and $dev -eq 'gpu') { $w = $r.steps | Where-Object { $_.step -eq 'warm' }; if ($w.gpuBoards -ne 376992) { $failures += "4.3 $($r.label): the warm run scored only $($w.gpuBoards) boards on the GPU" } }
      $c = $r.steps | Where-Object { $_.step -eq 'cold' }; $w = $r.steps | Where-Object { $_.step -eq 'warm' }; $sq = $r.steps | Where-Object { $_.step -eq 'ten sequential' }
      $v43.summary += [ordered]@{ device = $dev; threads = $t; coldMs = $c.medianQueryMs; warmMs = $w.medianQueryMs; sequentialMedianMs = $sq.medianQueryMs; coldObserved = $c.observedDevice; warmObserved = $w.observedDevice; cudaStartupSeconds = $c.cudaStartupSeconds; opens = $r.opens }
      Write-Host ("4.3 exact EV {0,-6} {1,2} threads: cold {2:N1} ms ({3}), warm {4:N1} ms ({5}), ten sequential median {6:N1} ms, opens {7}" -f $dev, $t, $c.medianQueryMs, $c.observedDevice, $w.medianQueryMs, $w.observedDevice, $sq.medianQueryMs, $r.opens)
    }
  }
  foreach ($dev in @('cpu', 'gpu', 'auto')) {
    $req = [ordered]@{ method = 'exact'; seats = @(0, 1, 2, 3, 4, 5, 6, 7); device = $dev; threads = [math]::Min(8, $logical); timeLimitMs = 600000 }
    $r = Run-Session 'gain' $req ("gain {0}" -f $dev); $v43.gainSessions += $r
    if ($r.error) { $failures += "4.3 session failed: $($r.label)"; continue }
    if ($r.mismatches -ne 0) { $failures += "4.3 $($r.label): values differ between runs" }
    if ($r.values -ne (@($v42.responseGainThreads | Select-Object -First 1).gains -replace ' ', '')) { $v43.gainNoteValues = 'compare values with v42.responseGainThreads (formatting of the two reports differs)' }
    $c = $r.steps | Where-Object { $_.step -eq 'cold' }; $w = $r.steps | Where-Object { $_.step -eq 'warm' }
    Write-Host ("4.3 response gains {0,-4}: cold {1:N1} ms, warm {2:N1} ms, boards {3}" -f $dev, $c.medianQueryMs, $w.medianQueryMs, ($w.gpuBoards + $w.cpuBoards))
  }
  $v43.physicalNvidiaExecution = [bool]($cuda.available -and -not $wine -and ($v43.sessions | Where-Object { $_.mismatches -eq 0 -and ($_.steps | Where-Object { $_.gpuBoards -gt 65536 }) }))
  # ---------------------------------------------------------------------------------
  # 10. (4.4) Automatic on a warm device: measured arm selection. One process per thread
  # count: the device is opened and verified by one GPU request, then 48 Automatic requests
  # (the selector measures cpu / gpuPull / gpuPreferred and settles), then 6 CPU-only and
  # 6 GPU-preferred requests as references measured in the same process, and the same 48
  # requests under the 4.3 rule (EM_GPU_AUTO_MODEL=4.3) in a second process.
  # Recorded: the arm statistics, the median of the last 16 Automatic requests, the
  # reference medians and the 4.3-rule median. Timing verdicts are recorded as findings
  # (v44.findings), not as failures: they depend on other load on the machine.
  # Results (bit patterns) must be identical in every run: that IS a failure otherwise.
  $v44 = [ordered]@{ autoSessions = @(); findings = @() }
  function Median($values) { $v = @($values | Sort-Object); if ($v.Count -eq 0) { return $null }; return $v[[int][math]::Floor(($v.Count - 1) / 2)] }
  function Run-Auto44($threads, $rule) {
    $mk = { param($dev) [ordered]@{ path = @(); hands = @(0); method = 'exact'; device = $dev; threads = $threads; timeLimitMs = 600000; maxVisits = 2000000000; gpuMiB = 2048 } }
    $plan = [ordered]@{ mode = 'ev'; request = (& $mk 'auto'); steps = @(
      [ordered]@{ label = 'open and verify'; request = (& $mk 'gpu') }, [ordered]@{ label = 'auto'; repeat = 48 },
      [ordered]@{ label = 'cpu reference'; request = (& $mk 'cpu'); repeat = 6 }, [ordered]@{ label = 'gpu reference'; request = (& $mk 'gpu'); repeat = 6 }) }
    Write-Json $sessionPlan $plan
    if ($rule -eq '4.3') { $env:EM_GPU_AUTO_MODEL = '4.3' }
    $ErrorActionPreference = 'Continue'
    $text = (& $Exe --session $fxSpec $fxState $sessionPlan 2>&1 | ForEach-Object { "$_" }); $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'; if ($rule -eq '4.3') { Remove-Item Env:EM_GPU_AUTO_MODEL }
    $json = $text | Where-Object { $_ -match '^\{"tool":"mwcli session' } | Select-Object -First 1
    if (-not $json) { return [ordered]@{ threads = $threads; rule = $rule; error = ($text -join "`n"); exitCode = $code } }
    $s = $json | ConvertFrom-Json
    $auto = @($s.steps[1].runs | ForEach-Object { $_.results[0] })
    $autoMs = @($auto | ForEach-Object { [double]$_.queryMs })
    $tail = @($autoMs | Select-Object -Last 16)
    $cpuMs = @($s.steps[2].runs | ForEach-Object { [double]$_.results[0].queryMs }); $gpuMs = @($s.steps[3].runs | ForEach-Object { [double]$_.results[0].queryMs })
    $lastAuto = $auto | Select-Object -Last 1
    $bits = @($s.steps | ForEach-Object { $_.runs } | ForEach-Object { $_.results } | ForEach-Object { (@($_.valueBits) -join ',') } | Select-Object -Unique)
    return [ordered]@{ threads = $threads; rule = $rule; exitCode = $code; mismatches = $s.mismatches; distinctValueBits = $bits;
      autoObserved = @($auto | ForEach-Object { $_.observedDevice }); autoQueryMs = $autoMs; autoSettledMedianMs = (Median $tail); autoAllMedianMs = (Median $autoMs);
      cpuReferenceMedianMs = (Median $cpuMs); gpuReferenceMedianMs = (Median $gpuMs); arms = $lastAuto.auto44; gpuAfter = $s.steps[-1].gpuAfter }
  }
  if ($cuda.available) {
    foreach ($t in $threadSet | Sort-Object -Unique) {
      if ($t -gt $logical) { continue }
      $a44 = Run-Auto44 $t '4.4'; $a43 = Run-Auto44 $t '4.3'
      $v44.autoSessions += $a44; $v44.autoSessions += $a43
      foreach ($x in @($a44, $a43)) {
        if ($x.error) { $failures += "4.4 Automatic session failed ($($x.threads) threads, rule $($x.rule))"; continue }
        if ($x.mismatches -ne 0 -or @($x.distinctValueBits).Count -ne 1 -or $x.distinctValueBits[0] -ne '402e0a51470d8f36,402f57218439052d') { $failures += "4.4 Automatic ($($x.threads) threads, rule $($x.rule)): results differ between arms or from the reference" }
      }
      if (-not $a44.error -and -not $a43.error) {
        $best = [math]::Min([double]$a44.cpuReferenceMedianMs, [double]$a44.gpuReferenceMedianMs)
        $v44.findings += [ordered]@{ threads = $t; autoSettledMedianMs = $a44.autoSettledMedianMs; rule43SettledMedianMs = $a43.autoSettledMedianMs; cpuReferenceMedianMs = $a44.cpuReferenceMedianMs; gpuReferenceMedianMs = $a44.gpuReferenceMedianMs;
          autoWithin15PercentOfBestReference = ([double]$a44.autoSettledMedianMs -le 1.15 * $best); fasterThan43Rule = ([double]$a44.autoSettledMedianMs -lt [double]$a43.autoSettledMedianMs) }
        Write-Host ("4.4 Automatic {0,2} threads: settled median {1:N1} ms (4.3 rule {2:N1} ms; CPU only {3:N1} ms; GPU preferred {4:N1} ms)" -f $t, $a44.autoSettledMedianMs, $a43.autoSettledMedianMs, $a44.cpuReferenceMedianMs, $a44.gpuReferenceMedianMs)
      }
    }
  } else { $v44.note = 'CUDA unavailable: the Automatic arm measurement needs a device' }
  $v44.physicalNvidiaExecution = [bool]($cuda.available -and -not $wine -and ($v44.autoSessions | Where-Object { -not $_.error -and ($_.autoObserved -contains 'gpu' -or $_.autoObserved -contains 'cpu+gpu') }))
  # 11. (4.5) Small / medium / large evaluations per processing mode, each in a fresh process (cold
  #     device), with the 4.5 memory ledgers: GPU peak against gpuMiB, coverage peak against
  #     coverageMiB. Results are compared as IEEE 754 bit patterns (a difference is a failure);
  #     times and the Automatic verdict are findings. Nothing here was run by the developers on a
  #     physical NVIDIA GPU: these numbers exist only once this script has run on your PC.
  $v45 = [ordered]@{ runs = @(); findings = @() }
  $q45 = Join-Path $tmp 'q45.json'
  $work45 = @(
    [ordered]@{ name = 'small (sampled EV, 4,000 samples)'; mode = '--ev'; body = '"path":[],"hands":[0],"method":"sampled","samples":4000,"seed":7' },
    [ordered]@{ name = 'medium (exact root EV, 376,992 boards)'; mode = '--ev'; body = '"path":[],"hands":[0],"method":"exact","maxVisits":2000000000' },
    [ordered]@{ name = 'large (exact response gains, eight seats)'; mode = '--gain'; body = '"method":"exact","seats":[0,1,2,3,4,5,6,7]' })
  # 4.6: the 4.5 cold comparison ran 3 repetitions per mode in blocks (all CPU runs, then GPU,
  # hybrid, Automatic). On the target PC the three Automatic gain timings were 18.0, 33.5 and
  # 37.1 ms against CPU-only 23.4, 27.7, 28.7 ms: Automatic's fastest run beat every CPU run,
  # so the "21% slower" verdict was not a measured difference. Automatic never loads the CUDA
  # driver for a single cold table (tests/v46.test.js), so it runs the CPU path. 4.6 runs
  # the modes INTERLEAVED (one round = one run of every mode, order rotated each round), 9
  # rounds, and reports a bootstrap 95% interval of Automatic / best fixed mode; a verdict
  # that Automatic is slower needs the whole interval above 1.15.
  $rounds45 = 9
  function Ratio-Interval([double[]]$a, [double[]]$b) {
    $rng = New-Object System.Random 46; $r = @()
    for ($k = 0; $k -lt 2000; $k++) {
      $sa = @(for ($x = 0; $x -lt $a.Count; $x++) { $a[$rng.Next($a.Count)] } | Sort-Object); $sb = @(for ($x = 0; $x -lt $b.Count; $x++) { $b[$rng.Next($b.Count)] } | Sort-Object)
      $r += $sa[[int][math]::Floor($sa.Count / 2)] / $sb[[int][math]::Floor($sb.Count / 2)]
    }
    $r = @($r | Sort-Object); return @($r[50], $r[1949])
  }
  foreach ($w in $work45) {
    $bitsSeen = @{}; $byDevice = @{}; $timesBy = @{}; $lastBy = @{}; $rawBy = @{}; $schedBy = @{}
    $devs = @('cpu', 'gpu', 'hybrid', 'auto')
    for ($rep = 0; $rep -lt $rounds45; $rep++) {
      for ($o = 0; $o -lt $devs.Count; $o++) {
        $dev = $devs[($o + $rep) % $devs.Count]
        [IO.File]::WriteAllText($q45, ('{' + $w.body + ',"device":"' + $dev + '","timeLimitMs":600000,"coverageMiB":8' + $(if ($w.mode -eq '--ev') { ',"gpuMiB":512' } else { '' }) + '}'))
        $env:EM_QUERY_TIMING = '1'; $ErrorActionPreference = 'Continue'
        $lines = & $Exe $w.mode $fxSpec $fxState $q45 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE; $ErrorActionPreference = 'Stop'; Remove-Item Env:EM_QUERY_TIMING
        $timing = $lines | Where-Object { $_ -match '^\{"queryMs"' } | Select-Object -First 1
        $raw = [string]($lines | Where-Object { $_ -match '^\{"engine"' } | Select-Object -First 1)
        if (-not $timesBy.ContainsKey($dev)) { $timesBy[$dev] = @(); $schedBy[$dev] = @() }
        if ($code -ne 0) { $failures += ("4.6 {0} ({1}) exited with code {2}: {3}" -f $w.name, $dev, $code, (($lines | Where-Object { $_ -notmatch '^\{' }) -join ' ')) }
        if ($timing) { $timesBy[$dev] += [double](($timing | ConvertFrom-Json).queryMs) }
        if ($raw) { try { $lastBy[$dev] = $raw | ConvertFrom-Json; $rawBy[$dev] = $raw; $ex0 = $lastBy[$dev].execution; $schedBy[$dev] += [ordered]@{ observedDevice = $ex0.observedDevice; gpuBoards = $ex0.gpuBoards; cudaAttempted = $ex0.cuda.attempted; cpuWarmup = $ex0.scheduling.cpuGpuWarmup; backgroundOpens = $ex0.scheduling.gpuBackgroundOpens } } catch { } }
      }
    }
    foreach ($dev in $devs) {
      $last = $lastBy[$dev]; $raw = $rawBy[$dev]; $times = @($timesBy[$dev])
      if ($null -eq $last -or $times.Count -eq 0) { $failures += "4.5 $($w.name) with device $dev returned no result"; continue }
      $sorted = @($times | Sort-Object); $median = $sorted[[int][math]::Floor($sorted.Count / 2)]
      $bits = (([regex]::Matches($raw, '"(?:evBits|gainBits)":(\[[^\]]*\]|"[0-9a-f]{16}")') | ForEach-Object { $_.Groups[1].Value }) -join ';')
      $bitsSeen[$bits] = 1; $byDevice[$dev] = $median
      $ex = $last.execution; $gpuPeak = [double]$ex.gpuPeakMiB
      $row = [ordered]@{ workload = $w.name; requestedDevice = $dev; observedDevice = $ex.observedDevice; rounds = $times.Count; order = 'interleaved, rotated each round'; queryMs = $times; medianQueryMs = $median; minQueryMs = $sorted[0]; maxQueryMs = $sorted[$sorted.Count - 1];
        cpuBoards = $ex.cpuBoards; gpuBoards = $ex.gpuBoards; gpuPeakMiB = $gpuPeak; gpuBudgetMiB = 512; gpuFailures = $ex.gpuFailures; gpuErrors = $ex.gpuErrors; peakEvaluationMiB = $ex.peakEvaluationMiB; scheduling = $schedBy[$dev] }
      if ($ex.coverageMemory) { $row.coveragePeakBytes = [long]$ex.coverageMemory.peakBytes; $row.coverageBudgetBytes = [long]$ex.coverageMemory.budgetBytes
        if ([long]$ex.coverageMemory.peakBytes -gt [long]$ex.coverageMemory.budgetBytes) { $failures += "4.5 $($w.name) ($dev): coverage peak above its budget" } }
      if ($gpuPeak -gt 512) { $failures += "4.5 $($w.name) ($dev): GPU peak $gpuPeak MiB above the 512 MiB budget" }
      $v45.runs += $row
      Write-Host ("4.6 {0,-44} {1,-6} -> {2,-8} median {3,8:N1} ms (min {4:N1}, max {5:N1}, {6} interleaved rounds)  gpu boards {7}" -f $w.name, $dev, $ex.observedDevice, $median, $sorted[0], $sorted[$sorted.Count - 1], $times.Count, $ex.gpuBoards)
    }
    if ($w.mode -eq '--ev' -and $w.body -match 'sampled') { } elseif ($bitsSeen.Count -ne 1) { $failures += "4.5 $($w.name): results differ between processing modes (IEEE 754 bit patterns)" }
    if ($byDevice.ContainsKey('auto') -and $byDevice.ContainsKey('cpu')) {
      $best = ($byDevice.GetEnumerator() | Where-Object { $_.Key -ne 'auto' } | Sort-Object Value | Select-Object -First 1)
      $ratio = $byDevice['auto'] / $best.Value
      $ci = Ratio-Interval ([double[]]@($timesBy['auto'])) ([double[]]@($timesBy[$best.Key]))
      $verdict = if ($ci[0] -gt 1.15) { 'Automatic slower than the best fixed mode by more than 15% (whole 95% interval above 1.15)' } elseif ($ci[1] -lt 1.15) { 'Automatic within 15% of the best fixed mode (whole 95% interval below 1.15)' } else { 'inconclusive: the 95% interval contains 1.15; more rounds are needed' }
      $v45.findings += [ordered]@{ workload = $w.name; bestFixedMode = $best.Key; bestFixedMs = $best.Value; automaticMs = $byDevice['auto']; automaticOverBest = $ratio; ratio95 = $ci; rounds = $rounds45; verdict = $verdict }
    }
  }
  $v45.physicalNvidiaExecution = [bool]($cuda.available -and -not $wine -and ($v45.runs | Where-Object { [long]$_.gpuBoards -gt 0 }))
  $v45.note = 'Cold processes (one request each). Warm-device behaviour of Automatic is section 10 (v44). gpuBoards > 0 on a physical NVIDIA GPU is the only evidence of real CUDA execution.'
  $devices = $null
  try { & (Join-Path $PSScriptRoot 'test_devices.ps1'); $devices = Get-Content (Join-Path $root 'device-results.json') -Raw | ConvertFrom-Json }
  catch { $failures += "Scoring-mode comparison failed: $($_.Exception.Message)" }

  $out = [ordered]@{ tool = 'EightMax 4.6 hardware validation'; build = $build; date = (Get-Date).ToString('s');
    os = [Environment]::OSVersion.VersionString; cpu = $env:PROCESSOR_IDENTIFIER; logicalProcessors = $logical;
    memoryGiB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1);
    graphics = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, AdapterRAM);
    cuda = $cuda; equity = $equity; v39 = $v39; v40 = $v40; v41 = $v41; v42 = $v42; v43 = $v43; v44 = $v44; v45 = $v45; physicalNvidiaExecution = [bool]($v41.physicalNvidiaExecution -or $v42.physicalNvidiaExecution -or $v43.physicalNvidiaExecution);
    gpuBudget = [ordered]@{ ok = $capOk; requestedBytes = $need; belowBudget = $(if ($cap) { [ordered]@{ budgetBytes = $cap.gpuBudgetBytes; gpuUsed = $cap.gpuUsed; error = $cap.gpuError; reason = $cap.gpuFallbackReason } } else { $null }); atBudget = $(if ($atCap) { [ordered]@{ budgetBytes = $atCap.gpuBudgetBytes; gpuUsed = $atCap.gpuUsed; peakBytes = $atCap.gpuBufferPeakBytes } } else { $null }) };
    gpuExecutionVerified = [bool]($cuda.available -and ($equity | Where-Object { $_.gpuUsed -and $_.gpuMatchesCpu }))
    checkpointRecovery = @{ identical = $same; stopped = $stopped; resumed = $continued; uninterrupted = $referenceRun }
    externalSampling = $training; version33 = $v33; externalBatchModes = $batchRuns; scoringModes = $devices; failures = $failures; passed = ($failures.Count -eq 0) }
  $out | ConvertTo-Json -Depth 14 | Set-Content -Encoding UTF8 $Report
  Write-Host "Saved $Report"
  if ($failures.Count) { $failures | ForEach-Object { Write-Host "FAILED: $_" }; exit 1 }
  Write-Host 'Completed available checks. See physicalNvidiaExecution and gpuExecutionVerified for physical CUDA status.'
} catch {
  [ordered]@{tool='EightMax 4.5 hardware validation';completed=$false;passed=$false;gpuExecutionVerified=$false;physicalNvidiaExecution=$false;error=$_.Exception.Message} | ConvertTo-Json | Set-Content -Encoding UTF8 $Report
  Write-Host ('Hardware check stopped: '+$_.Exception.Message)
  exit 1
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
