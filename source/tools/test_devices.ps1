# Run without installing Node or the CUDA Toolkit. Compare the exact frozen-batch state.
# 5.1: -Repeats N runs the four modes N times, interleaved (mode order rotated each round), and reports medians.
param([int]$Repeats = 1)
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
  $modes = @('cpu','auto','gpu','hybrid')
  for ($round = 0; $round -lt [Math]::Max(1,$Repeats); $round++) {
  foreach ($k in 0..3) {
    $mode = $modes[($k + $round) % 4]
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
      decision=$sc.decision; reason=$sc.reason;
      round=$round; batchesScored=$sc.batchesScored; batchUnitsMin=$sc.batchUnitsMin; batchUnitsMax=$sc.batchUnitsMax;
      calibrationReuses=$sc.calibrationReusesThisCall; recalibrationReasons=$sc.recalibrationReasons; routeReuseRule=$sc.routeReuseRule;
      driverInitSeconds=$sc.driverInitSecondsThisCall; scoringSeconds=$sc.scoringSecondsThisCall; deviceTransferAndKernelSeconds=$sc.deviceTransferAndKernelSecondsThisCall}
  }
  }
  # 5.1: medians per mode over the rounds (a single round reports that round)
  $median = { param($v) $s = @($v | Sort-Object); if ($s.Count % 2) { $s[($s.Count-1)/2] } else { ($s[$s.Count/2-1] + $s[$s.Count/2]) / 2 } }
  $summary = foreach ($mode in $modes) { $m = @($rows | Where-Object { $_.requested -eq $mode })
    [pscustomobject]@{requested=$mode; rounds=$m.Count; medianTrainingSeconds=(& $median ($m | ForEach-Object { $_.trainingSeconds })); medianProcessSeconds=(& $median ($m | ForEach-Object { $_.processSeconds }));
      calibrations=$m[0].calibrations; calibrationReuses=$m[0].calibrationReuses; medianCalibrationSeconds=(& $median ($m | ForEach-Object { [double]$_.calibrationSeconds }));
      medianDriverInitSeconds=(& $median ($m | ForEach-Object { [double]$_.driverInitSeconds })); gpuBufferPeakBytes=$m[0].gpuBufferPeakBytes; decision=$m[0].decision} }
  $report = [ordered]@{build=(& $exe --build-id); cpu=$env:PROCESSOR_IDENTIFIER;
    graphics=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion); repeats=[Math]::Max(1,$Repeats); summary=@($summary); runs=$rows}
  $output = Join-Path $root 'device-results.json'
  $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $output
  $summary | Format-Table requested,rounds,medianTrainingSeconds,medianProcessSeconds,calibrations,calibrationReuses,medianDriverInitSeconds,gpuBufferPeakBytes,decision
  Write-Host "All four states match. Results saved to $output"
} finally { Remove-Item $tmp -Recurse -Force }
