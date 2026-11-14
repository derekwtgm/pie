# Run without installing Node or the CUDA Toolkit. Compare the exact frozen-batch state.
$ErrorActionPreference = 'Stop'
# 3.3: Windows PowerShell 5.1 serializes arrays returned from functions as {"value":[...],"Count":n}
# through extended type data; removing it keeps JSON arrays plain (no effect on PowerShell 7).
Remove-TypeData System.Array -ErrorAction SilentlyContinue
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$exe = Join-Path $root 'mwcli.exe'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
$spec = Get-Content (Join-Path $root 'source/tests/fixtures/device-turn.json') -Raw | ConvertFrom-Json
$rows = @()
try {
  $reference = $null
  foreach ($mode in 'cpu','auto','gpu','hybrid') {
    $spec.device = $mode
    $specPath = Join-Path $tmp 'spec.json'
    $statePath = Join-Path $tmp 'study.state'
    [IO.File]::WriteAllText($specPath,($spec | ConvertTo-Json -Depth 16 -Compress),[Text.UTF8Encoding]::new($false))
    Write-Host "Measuring $mode scoring..."
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $result = & $exe $specPath 100 4 $statePath 1024
    if ($LASTEXITCODE -ne 0) { throw "Solver failed in $mode mode" }
    $clock.Stop()
    $info = $result | ConvertFrom-Json
    if ($info.limitReached -or $info.iterations -ne 100) { throw "Incomplete training in $mode mode" }
    $state = [IO.File]::ReadAllBytes($statePath)
    $at = 12 + [BitConverter]::ToUInt32($state,8)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($state,$at,$state.Length-$at)).Replace('-','') }
    finally { $sha.Dispose() }
    $signature = "$hash/$($info.rng)/$($info.trainingDeals)/$($info.stateVisits)"
    if ($null -eq $reference) { $reference = $signature }
    if ($signature -ne $reference) { throw "Training state differs from CPU in $mode mode" }
    # 5.0: the scheduling block of the training report (per call; absent before 5.0)
    $sc = $info.scheduling
    $rows += [pscustomobject]@{requested=$mode; observed=$info.devicePath; trainingSeconds=$info.wallSeconds;
      processSeconds=$clock.Elapsed.TotalSeconds; sampledDeals=$info.trainingDeals; stateVisits=$info.stateVisits;
      gpuBufferPeakBytes=$info.gpuBufferPeakBytes; strategySHA256=$hash; rng=$info.rng;
      trainingPath=$sc.trainingPath; plannedUpdates=$sc.plannedUpdates; projectedCpuScoreSeconds=$sc.projectedCpuScoreSeconds;
      thresholdSeconds=$sc.thresholdSeconds; automaticSkippedCuda=$sc.automaticSkippedCuda; cudaOpened=$sc.cudaOpenedThisCall;
      calibrations=$sc.calibrationsThisCall; calibrationSeconds=$sc.calibrationSecondsThisCall; gpuBufferPeakBytesThisCall=$sc.gpuBufferPeakBytesThisCall;
      decision=$sc.decision; reason=$sc.reason}
  }
  $report = [ordered]@{build=(& $exe --build-id); cpu=$env:PROCESSOR_IDENTIFIER;
    graphics=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion); runs=$rows}
  $output = Join-Path $root 'device-results.json'
  $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $output
  $rows | Format-Table requested,observed,trainingSeconds,processSeconds,gpuBufferPeakBytes
  Write-Host "All four states match. Results saved to $output"
} finally { Remove-Item $tmp -Recurse -Force }
